'use strict';

const { EventEmitter } = require('events');
const { SendQueue } = require('./send-queue');
const { SmtpTransport } = require('./transport-smtp');
const { buildMailOptions, renderForRecipient, SAMPLE_RECIPIENT } = require('./message-builder');
const { normalizeEmail, validateEmail } = require('./email-utils');
const { extractVariables } = require('./personalize');

const MAX_CAMPAIGN_RECIPIENTS = 1000;
const SMTP_SECRET_NAME = 'smtp-secret';
const PERSIST_EVERY = 25;

/**
 * Orchestrates campaigns: validation, confirmation, background sending through
 * the SendQueue, persistence to history, and suppression of permanent failures.
 *
 * Only one campaign may run at a time. Sending never starts without an
 * explicit confirmation whose recipient count matches the list exactly.
 */
class CampaignManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.settings       SettingsStore
   * @param {object} deps.credentials    CredentialManager
   * @param {object} deps.suppression    SuppressionStore
   * @param {object} deps.history        HistoryStore
   * @param {object} deps.logger         Logger
   * @param {function} [deps.transportFactory] (settings, secret) => transport-like
   * @param {object} [deps.queueOptions] overrides for SendQueue (tests)
   */
  constructor(deps) {
    super();
    this.settings = deps.settings;
    this.credentials = deps.credentials;
    this.suppression = deps.suppression;
    this.history = deps.history;
    this.logger = deps.logger;
    this.transportFactory =
      deps.transportFactory || ((settings, secret) => new SmtpTransport(settings, secret));
    this.queueOptions = deps.queueOptions || {};
    this.active = null; // { id, queue, transport, campaign, record, results }
  }

  // ------------------------------------------------------------ validation

  /** Returns { ok, errors[], warnings[] } without sending anything. */
  validateSender() {
    const s = this.settings.get();
    const errors = [];
    if (!s.senderEmail || !validateEmail(s.senderEmail).valid) {
      errors.push('Set a valid sender email address in Settings.');
    }
    if (!s.smtpHost) errors.push('Set the SMTP host in Settings.');
    if (!s.smtpPort) errors.push('Set the SMTP port in Settings.');
    if (s.smtpUser && !this.credentials.hasCredential(SMTP_SECRET_NAME)) {
      errors.push('No password or API key is stored. Enter it in Settings and save.');
    }
    const warnings = [];
    if (s.encryption === 'none') {
      warnings.push('Encryption is disabled. Credentials and messages may be sent in clear text.');
    }
    if (!s.smtpUser) {
      warnings.push('No SMTP username is set. Most providers require authenticated sending.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  /** Validate a campaign draft. Returns { ok, errors[], warnings[], stats }. */
  preflight(draft, recipients) {
    const errors = [];
    const warnings = [];
    const sender = this.validateSender();
    errors.push(...sender.errors);
    warnings.push(...sender.warnings);

    if (!draft || !String(draft.name || '').trim()) errors.push('Give the campaign a name.');
    if (!draft || !String(draft.subject || '').trim()) errors.push('Enter a subject line.');
    if (!draft || !String(draft.bodyHtml || '').trim()) errors.push('The email body is empty.');
    if (draft && draft.replyTo && !validateEmail(draft.replyTo).valid) {
      errors.push('The Reply-To address is not a valid email address.');
    }
    if (this.active) errors.push('Another campaign is already running. Wait for it to finish or cancel it.');

    const list = Array.isArray(recipients) ? recipients : [];
    if (list.length === 0) errors.push('No recipients are selected.');
    if (list.length > MAX_CAMPAIGN_RECIPIENTS) {
      errors.push(`A campaign can include at most ${MAX_CAMPAIGN_RECIPIENTS.toLocaleString()} recipients. You selected ${list.length.toLocaleString()}.`);
    }

    let suppressed = 0;
    let invalid = 0;
    const eligible = [];
    const seen = new Set();
    for (const r of list) {
      const email = normalizeEmail(r.email);
      if (!validateEmail(email).valid) {
        invalid += 1;
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      if (this.suppression.has(email)) {
        suppressed += 1;
        continue;
      }
      eligible.push({ ...r, email });
    }
    if (suppressed) warnings.push(`${suppressed} suppressed address(es) will be skipped.`);
    if (invalid) warnings.push(`${invalid} invalid address(es) will be skipped.`);
    if (list.length && eligible.length === 0) errors.push('None of the selected recipients can receive this campaign.');

    // Warn about placeholders that no recipient data can fill.
    const vars = new Set([...extractVariables(draft && draft.subject), ...extractVariables(draft && draft.bodyHtml)]);
    const known = new Set(['email', 'first_name', 'last_name']);
    const unknownVars = [...vars].filter((v) => !known.has(v));
    if (unknownVars.length) {
      const hasExtra = eligible.some((r) => r.extra && Object.keys(r.extra).length);
      if (!hasExtra) warnings.push(`Unrecognized variable(s): ${unknownVars.map((v) => `{{${v}}}`).join(', ')} will be blank.`);
    }
    const needsFirstName = vars.has('first_name') && eligible.every((r) => !r.firstName);
    if (needsFirstName) warnings.push('{{first_name}} is used but no recipient has a first name; it will be blank.');

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats: {
        selected: list.length,
        eligible: eligible.length,
        suppressed,
        invalid,
        duplicates: list.length - seen.size
      }
    };
  }

  // ------------------------------------------------------------ test + preview

  /** Render the campaign for a sample recipient. Pure. */
  preview(draft, recipient = SAMPLE_RECIPIENT) {
    const s = this.settings.get();
    const campaign = this._campaignFromDraft(draft, s);
    const rendered = renderForRecipient(campaign, recipient);
    return {
      from: `${s.senderName || ''} <${s.senderEmail || ''}>`.trim(),
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    };
  }

  /** Send a single test message to an address the user controls. */
  async sendTest(draft, toEmail) {
    const email = normalizeEmail(toEmail);
    if (!validateEmail(email).valid) {
      return { ok: false, message: 'Enter a valid address to receive the test email.' };
    }
    const sender = this.validateSender();
    if (!sender.ok) return { ok: false, message: sender.errors.join(' ') };
    if (!String(draft.subject || '').trim()) return { ok: false, message: 'Enter a subject before sending a test.' };

    const s = this.settings.get();
    const campaign = this._campaignFromDraft(draft, s);
    const recipient = { email, firstName: 'Test', lastName: 'Recipient', extra: {} };
    const { mail } = buildMailOptions(campaign, recipient);
    mail.subject = `[TEST] ${mail.subject}`;
    const transport = this._createTransport(s);
    try {
      const res = await transport.send(mail);
      this.logger.info('Test email sent', { to: email, messageId: res.messageId });
      return { ok: true, message: `Test email sent to ${email}.`, messageId: res.messageId };
    } catch (err) {
      this.logger.warn('Test email failed', { kind: err.kind, code: err.code });
      return { ok: false, message: err.userMessage || 'Test email failed.', kind: err.kind };
    } finally {
      transport.close();
    }
  }

  /** Verify the SMTP configuration. */
  async testConnection(overrides = {}) {
    const s = { ...this.settings.get(), ...overrides };
    const secret = overrides.secret !== undefined ? overrides.secret : this.credentials.getCredential(SMTP_SECRET_NAME);
    const transport = this.transportFactory(s, secret);
    const result = await transport.verify();
    this.logger.info(result.ok ? 'SMTP connection test passed' : 'SMTP connection test failed', {
      host: s.smtpHost,
      port: s.smtpPort,
      kind: result.kind || null
    });
    return result;
  }

  // ------------------------------------------------------------ campaign lifecycle

  _campaignFromDraft(draft, s) {
    return {
      subject: draft.subject || '',
      bodyHtml: draft.bodyHtml || '',
      bodyText: draft.bodyText || '',
      footerHtml: draft.footerHtml || '',
      senderName: draft.senderName || s.senderName || '',
      fromEmail: s.senderEmail,
      replyTo: draft.replyTo || s.replyTo || '',
      listUnsubscribe: draft.listUnsubscribe || s.listUnsubscribe || ''
    };
  }

  _createTransport(s) {
    const secret = this.credentials.getCredential(SMTP_SECRET_NAME);
    return this.transportFactory(s, secret);
  }

  /**
   * Start sending. `confirmedCount` must equal the recipient list length — the
   * user has explicitly confirmed exactly how many people will receive it.
   */
  start(draft, recipients, confirmedCount) {
    const check = this.preflight(draft, recipients);
    if (!check.ok) {
      return { ok: false, errors: check.errors, warnings: check.warnings };
    }
    if (Number(confirmedCount) !== recipients.length) {
      return {
        ok: false,
        errors: [`Confirmation mismatch: confirm sending to ${recipients.length} recipients to start.`],
        warnings: []
      };
    }

    const s = this.settings.get();
    const campaign = this._campaignFromDraft(draft, s);
    const eligible = [];
    const seen = new Set();
    for (const r of recipients) {
      const email = normalizeEmail(r.email);
      if (seen.has(email) || !validateEmail(email).valid || this.suppression.has(email)) continue;
      seen.add(email);
      eligible.push({ ...r, email });
    }

    const transport = this._createTransport(s);
    const id = require('crypto').randomUUID();
    const record = this.history.add({
      id,
      name: String(draft.name).trim().slice(0, 120),
      createdAt: Date.now(),
      startedAt: Date.now(),
      status: 'running',
      recipientCount: recipients.length,
      sentCount: 0,
      successfulCount: 0,
      failedCount: 0,
      skippedCount: recipients.length - eligible.length,
      perMinute: s.sendingRatePerMinute,
      results: []
    });

    const queue = new SendQueue({
      perMinute: s.sendingRatePerMinute,
      maxRetries: s.maxRetries,
      retryDelaySeconds: s.retryDelaySeconds,
      concurrency: 1,
      ...this.queueOptions,
      send: async (job) => {
        const { mail } = buildMailOptions(campaign, job.payload);
        return transport.send(mail);
      }
    });
    queue.load(
      eligible.map((r) => ({
        id: r.email,
        email: r.email,
        payload: { email: r.email, firstName: r.firstName || '', lastName: r.lastName || '', extra: r.extra || {} }
      }))
    );

    const results = [];
    const active = { id, queue, transport, campaign, record, results, draftName: record.name };
    this.active = active;

    const pushResult = (job, status, extra = {}) => {
      const entry = { email: job.email, status, attempts: job.attempts, at: Date.now(), ...extra };
      results.push(entry);
      return entry;
    };

    let sinceSave = 0;
    queue.on('sent', ({ job }) => {
      pushResult(job, 'sent', { messageId: job.messageId || null });
      record.successfulCount += 1;
      if (++sinceSave >= PERSIST_EVERY) this._persist(active, queue);
    });
    queue.on('failed', ({ job, kind, message }) => {
      pushResult(job, 'failed', { kind, error: message });
      if (kind === 'permanent') {
        // Suppress addresses that permanently bounced so they are never retried.
        this.suppression.add([job.email], 'permanent_failure');
      }
      record.failedCount += 1;
      if (++sinceSave >= PERSIST_EVERY) this._persist(active, queue);
    });
    queue.on('retry', ({ job, message }) => {
      this.logger.info('Retrying recipient', { attempt: job.attempts, reason: message });
    });
    queue.on('progress', (p) => {
      record.sentCount = p.sent + p.failed;
      this.emit('progress', { campaignId: id, ...p, campaignName: active.draftName });
    });
    queue.on('paused', ({ reason }) => {
      this.history.update(id, { status: 'paused', error: reason });
      this.emit('paused', { campaignId: id, reason });
    });
    queue.on('alert', ({ kind, message }) => this.emit('alert', { campaignId: id, kind, message }));

    this.logger.info('Campaign started', {
      id,
      recipients: eligible.length,
      skipped: recipients.length - eligible.length,
      perMinute: s.sendingRatePerMinute
    });
    this.emit('started', { campaignId: id, total: eligible.length });

    queue.start().then((final) => this._finish(active, final)).catch((err) => {
      this.logger.error('Campaign crashed', { id, message: err.message });
      this._finish(active, queue.progress(), 'failed', 'An internal error stopped the campaign.');
    });
    return { ok: true, campaignId: id, total: eligible.length, skipped: recipients.length - eligible.length };
  }

  _persist(active, queue) {
    const p = queue.progress();
    this.history.update(active.id, {
      sentCount: p.sent + p.failed,
      successfulCount: active.record.successfulCount,
      failedCount: active.record.failedCount,
      results: active.results.slice()
    });
  }

  _finish(active, progress, forcedStatus, forcedError) {
    if (!this.active || this.active.id !== active.id) return;
    const queue = active.queue;
    const finishedAt = Date.now();
    let status = forcedStatus || 'completed';
    if (!forcedStatus) {
      if (queue.state === 'cancelled') status = 'cancelled';
      else if (queue.state === 'paused') status = 'paused';
      else if (progress.failed > 0 && progress.sent === 0) status = 'failed';
    }
    this.history.update(active.id, {
      status,
      finishedAt,
      durationMs: finishedAt - active.record.startedAt,
      sentCount: progress.sent + progress.failed,
      successfulCount: progress.sent,
      failedCount: progress.failed,
      skippedCount: (active.record.skippedCount || 0) + progress.skipped,
      error: forcedError || (status === 'cancelled' ? 'Cancelled by user.' : null),
      results: active.results.slice()
    });
    try {
      active.transport.close();
    } catch {
      /* ignore */
    }
    this.active = null;
    this.logger.info('Campaign finished', { id: active.id, status, sent: progress.sent, failed: progress.failed });
    this.emit('finished', { campaignId: active.id, status, progress });
  }

  /** Pause the active campaign. */
  pause() {
    return this.active ? this.active.queue.pause('Paused by user') : false;
  }

  resume() {
    if (!this.active) return false;
    const ok = this.active.queue.resume();
    if (ok) {
      this.history.update(this.active.id, { status: 'running', error: null });
      this.emit('resumed', { campaignId: this.active.id });
    }
    return ok;
  }

  cancel() {
    return this.active ? this.active.queue.cancel('Cancelled by user') : false;
  }

  /** Current live status, or null when nothing is running. */
  status() {
    if (!this.active) return null;
    return {
      campaignId: this.active.id,
      campaignName: this.active.draftName,
      ...this.active.queue.progress()
    };
  }

  /** Mark campaigns that were running when the app closed as interrupted. */
  recoverInterrupted() {
    let count = 0;
    for (const c of this.history.list()) {
      if (c.status === 'running' || c.status === 'paused') {
        this.history.update(c.id, { status: 'interrupted', finishedAt: Date.now(), error: 'The application closed before this campaign finished.' });
        count += 1;
      }
    }
    return count;
  }
}

module.exports = { CampaignManager, MAX_CAMPAIGN_RECIPIENTS, SMTP_SECRET_NAME };
