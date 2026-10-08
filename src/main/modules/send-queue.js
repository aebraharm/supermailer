'use strict';

const { EventEmitter } = require('events');
const { RateLimiter } = require('./rate-limiter');

/**
 * Error kinds understood by the queue. Transports classify raw errors into
 * these kinds (see transport-smtp.classifyError).
 *
 *  - 'temporary' : retry later with backoff (4xx, greylisting, rate limits)
 *  - 'timeout'   : retry later (connection/greeting/socket timeout)
 *  - 'network'   : retry later; too many in a row pauses the campaign
 *  - 'auth'      : credentials rejected; pause the whole campaign
 *  - 'permanent' : do not retry (5xx, invalid recipient)
 */
const RETRYABLE = new Set(['temporary', 'timeout', 'network']);

/**
 * Background send queue with:
 *  - a single in-flight send by default (concurrency configurable, max 4)
 *  - rate limiting between sends
 *  - retry with per-attempt backoff for retryable errors
 *  - pause / resume / cancel
 *  - automatic pause after repeated network failures or auth failures
 *
 * Events: 'progress', 'sent', 'failed', 'retry', 'paused', 'resumed', 'alert',
 *         'cancelled', 'finished'
 */
class SendQueue extends EventEmitter {
  /**
   * @param {object}   options
   * @param {function} options.send  async (job) => { messageId } ; throws classified errors
   * @param {number}   options.perMinute
   * @param {number}   options.maxRetries
   * @param {number[]} options.retryDelaySeconds
   * @param {number}   options.concurrency
   * @param {number}   options.maxConsecutiveNetworkErrors
   * @param {function} options.now / options.sleep  injectable for tests
   */
  constructor(options = {}) {
    super();
    if (typeof options.send !== 'function') throw new Error('SendQueue requires a send function.');
    this.sendFn = options.send;
    this.maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 3;
    this.retryDelaysMs = (options.retryDelaySeconds || [10, 30, 90]).map((s) => s * 1000);
    this.concurrency = Math.min(4, Math.max(1, options.concurrency || 1));
    this.maxConsecutiveNetworkErrors = options.maxConsecutiveNetworkErrors || 5;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RateLimiter({ perMinute: options.perMinute || 30, now: this.now, sleep: this.sleep });

    this.jobs = [];
    this.state = 'idle'; // idle | running | paused | cancelled | finished
    this.pauseReason = null;
    this.controller = null;
    this.inFlight = 0;
    this.consecutiveNetworkErrors = 0;
    this.startedAt = null;
    this.finishedAt = null;
    this.counts = { total: 0, sent: 0, failed: 0, skipped: 0, retries: 0 };
    this._resumeWaiters = [];
  }

  /** Enqueue jobs: [{ id, email, payload }] */
  load(jobs) {
    this.jobs = jobs.map((j) => ({ ...j, attempts: 0, status: 'queued', nextAt: 0, error: null }));
    this.counts = { total: this.jobs.length, sent: 0, failed: 0, skipped: 0, retries: 0 };
  }

  get remaining() {
    return this.jobs.filter((j) => j.status === 'queued' || j.status === 'retrying').length;
  }

  progress() {
    const done = this.counts.sent + this.counts.failed + this.counts.skipped;
    const total = this.counts.total || 1;
    return {
      state: this.state,
      pauseReason: this.pauseReason,
      total: this.counts.total,
      sent: this.counts.sent,
      failed: this.counts.failed,
      skipped: this.counts.skipped,
      retries: this.counts.retries,
      remaining: this.remaining,
      percent: this.counts.total === 0 ? 100 : Math.round((done / total) * 1000) / 10,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt
    };
  }

  _emitProgress() {
    this.emit('progress', this.progress());
  }

  /** Start (or restart after finish). Resolves when the queue is finished or cancelled. */
  start() {
    if (this.state === 'running') return this._done;
    if (this.state === 'cancelled' || this.state === 'finished') {
      throw new Error('This queue has already finished. Create a new campaign to send again.');
    }
    this.state = 'running';
    this.pauseReason = null;
    this.controller = { aborted: false };
    if (!this.startedAt) this.startedAt = this.now();
    this._done = this._run();
    this._emitProgress();
    return this._done;
  }

  pause(reason = 'Paused by user') {
    if (this.state !== 'running') return false;
    this.state = 'paused';
    this.pauseReason = reason;
    this.emit('paused', { reason });
    this._emitProgress();
    return true;
  }

  resume() {
    if (this.state !== 'paused') return false;
    this.state = 'running';
    this.pauseReason = null;
    this.consecutiveNetworkErrors = 0;
    const waiters = this._resumeWaiters;
    this._resumeWaiters = [];
    waiters.forEach((w) => w());
    this.emit('resumed');
    this._emitProgress();
    return true;
  }

  cancel(reason = 'Cancelled by user') {
    if (this.state === 'cancelled' || this.state === 'finished') return false;
    this.state = 'cancelled';
    this.pauseReason = reason;
    if (this.controller) this.controller.aborted = true;
    // Wake anything waiting on resume.
    const waiters = this._resumeWaiters;
    this._resumeWaiters = [];
    waiters.forEach((w) => w());
    for (const job of this.jobs) {
      if (job.status === 'queued' || job.status === 'retrying') {
        job.status = 'cancelled';
        this.counts.skipped += 1;
      }
    }
    this.emit('cancelled', { reason });
    this._emitProgress();
    return true;
  }

  _waitIfPaused() {
    if (this.state !== 'paused') return Promise.resolve();
    return new Promise((resolve) => this._resumeWaiters.push(resolve));
  }

  _nextJob() {
    const now = this.now();
    let soonest = null;
    for (const job of this.jobs) {
      if (job.status !== 'queued' && job.status !== 'retrying') continue;
      if (job.nextAt <= now) return { job };
      if (soonest === null || job.nextAt < soonest) soonest = job.nextAt;
    }
    return soonest === null ? null : { waitUntil: soonest };
  }

  async _run() {
    const workers = [];
    for (let i = 0; i < this.concurrency; i += 1) workers.push(this._worker());
    await Promise.all(workers);

    if (this.state !== 'cancelled') {
      if (this.remaining === 0) {
        this.state = 'finished';
        this.finishedAt = this.now();
        this.emit('finished', this.progress());
      }
    }
    this._emitProgress();
    return this.progress();
  }

  async _worker() {
    while (this.state !== 'cancelled') {
      if (this.state === 'paused') {
        await this._waitIfPaused();
        continue;
      }
      const next = this._nextJob();
      if (!next) return; // nothing left for this worker
      if (next.waitUntil !== undefined) {
        // All remaining jobs are backing off; sleep until the soonest one.
        const wait = Math.max(0, next.waitUntil - this.now());
        await this.sleep(Math.min(wait, 1000));
        continue;
      }

      const job = next.job;
      job.status = 'sending';
      const acquired = await this.limiter.acquire(this.controller);
      if (!acquired || this.state === 'cancelled') {
        if (job.status === 'sending') job.status = 'queued';
        return;
      }
      if (this.state === 'paused') {
        job.status = job.attempts > 0 ? 'retrying' : 'queued';
        continue;
      }
      await this._attempt(job);
      this._emitProgress();
    }
  }

  async _attempt(job) {
    job.attempts += 1;
    this.inFlight += 1;
    try {
      const result = await this.sendFn(job);
      job.status = 'sent';
      job.error = null;
      job.messageId = result && result.messageId ? result.messageId : null;
      this.counts.sent += 1;
      this.consecutiveNetworkErrors = 0;
      this.emit('sent', { job });
    } catch (err) {
      const kind = err && err.kind ? err.kind : 'permanent';
      const message = (err && err.userMessage) || (err && err.message) || 'Unknown error';
      job.error = message;
      if (kind === 'network' || kind === 'timeout') {
        this.consecutiveNetworkErrors += 1;
      } else {
        this.consecutiveNetworkErrors = 0;
      }

      if (kind === 'auth') {
        // Do not burn through the list with a bad password: stop and let the user fix it.
        job.status = 'queued';
        job.attempts -= 1;
        this.pause('Authentication failed. Check your sender credentials in Settings, then resume.');
        this.emit('alert', { kind, message });
      } else if (RETRYABLE.has(kind) && job.attempts <= this.maxRetries) {
        job.status = 'retrying';
        const delay = this.retryDelaysMs[Math.min(job.attempts - 1, this.retryDelaysMs.length - 1)] || 10000;
        job.nextAt = this.now() + delay;
        this.counts.retries += 1;
        this.limiter.backoff(Math.min(delay, 5000));
        this.emit('retry', { job, kind, delayMs: delay, message });
      } else {
        job.status = 'failed';
        job.failureKind = kind;
        this.counts.failed += 1;
        this.emit('failed', { job, kind, message });
      }

      // Connection-level trouble is a campaign-wide signal: stop hammering the server.
      if (
        (kind === 'network' || kind === 'timeout') &&
        this.consecutiveNetworkErrors >= this.maxConsecutiveNetworkErrors &&
        this.state === 'running'
      ) {
        this.pause(
          'Repeated connection problems detected. Check your internet connection and SMTP server, then resume.'
        );
      }
    } finally {
      this.inFlight -= 1;
    }
  }
}

module.exports = { SendQueue, RETRYABLE };
