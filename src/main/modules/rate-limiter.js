'use strict';

/**
 * Rate limiter enforcing a maximum send rate (messages per minute) by
 * spacing sends evenly. Uses an injectable clock and sleep so it can be
 * tested deterministically.
 */
class RateLimiter {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.setRate(options.perMinute || 30);
    this.nextAllowedAt = 0;
  }

  setRate(perMinute) {
    const n = Number(perMinute);
    this.perMinute = Number.isFinite(n) && n >= 1 ? Math.min(1000, Math.floor(n)) : 30;
    this.intervalMs = Math.ceil(60000 / this.perMinute);
  }

  /** Milliseconds that must elapse before the next send is allowed. */
  waitTimeMs() {
    return Math.max(0, this.nextAllowedAt - this.now());
  }

  /**
   * Wait until a send is permitted, then reserve the slot.
   * Honors `signal.aborted` so cancellation does not hang.
   */
  async acquire(signal) {
    const wait = this.waitTimeMs();
    if (wait > 0) await this.sleep(wait);
    if (signal && signal.aborted) return false;
    this.nextAllowedAt = Math.max(this.now(), this.nextAllowedAt) + this.intervalMs;
    return true;
  }

  /** Push the next allowed time out, e.g. after a provider "slow down" response. */
  backoff(ms) {
    this.nextAllowedAt = Math.max(this.nextAllowedAt, this.now() + ms);
  }
}

module.exports = { RateLimiter };
