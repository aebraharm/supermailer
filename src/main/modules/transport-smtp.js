'use strict';

const nodemailer = require('nodemailer');

/**
 * SMTP transport.
 *
 * - Encryption: 'tls' (implicit TLS, usually port 465), 'starttls' (upgrade,
 *   usually 587; REQUIRED, so credentials are never sent in clear text), or
 *   'none' (only for local test servers; the UI warns about this).
 * - Authentication: AUTH with username + password/API credential.
 * - One pooled connection by default to avoid many simultaneous SMTP sessions.
 * - Timeouts for connection, greeting and socket so a stalled server cannot
 *   freeze a campaign.
 *
 * Credentials are passed in only at transport creation and are never logged.
 */

const DEFAULT_TIMEOUTS = {
  connectionTimeout: 30000,
  greetingTimeout: 15000,
  socketTimeout: 60000
};

/** Build nodemailer transport options from settings + secret. Pure, testable. */
function buildTransportOptions(settings, secret, overrides = {}) {
  const encryption = settings.encryption || 'starttls';
  const port = Number(settings.smtpPort) || (encryption === 'tls' ? 465 : 587);
  const options = {
    host: settings.smtpHost,
    port,
    secure: encryption === 'tls',
    requireTLS: encryption === 'starttls',
    ignoreTLS: encryption === 'none',
    tls: {
      rejectUnauthorized: settings.verifyTls !== false,
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: (settings.connectionTimeoutSec || 30) * 1000,
    greetingTimeout: (settings.greetingTimeoutSec || 15) * 1000,
    socketTimeout: (settings.socketTimeoutSec || 60) * 1000,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...overrides
  };
  if (settings.smtpUser) {
    options.auth = { user: settings.smtpUser, pass: secret || '' };
  }
  return options;
}

/**
 * Map a raw error from nodemailer to a queue error kind. Returns an Error with
 * { kind, userMessage, code, responseCode } — never includes credentials.
 */
function classifyError(err) {
  const code = err && err.code;
  const responseCode = Number(err && err.responseCode) || null;
  const raw = String((err && err.message) || '');
  let kind = 'permanent';
  let userMessage = 'The message was rejected by the mail server.';

  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 || responseCode === 530) {
    kind = 'auth';
    userMessage = 'Authentication failed. Check the username and password/API key in Settings.';
  } else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timed? ?out/i.test(raw)) {
    kind = 'timeout';
    userMessage = 'The mail server did not respond in time. The message will be retried.';
  } else if (['ECONNECTION', 'ECONNRESET', 'ESOCKET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EPROTOCOL'].includes(code)) {
    kind = code === 'EPROTOCOL' ? 'permanent' : 'network';
    userMessage =
      kind === 'network'
        ? 'Could not reach the mail server (network or connection problem). The message will be retried.'
        : 'The mail server sent an unexpected response (TLS/protocol error). Check the encryption setting.';
  } else if (responseCode && responseCode >= 400 && responseCode < 500) {
    kind = 'temporary';
    userMessage = 'The mail server reported a temporary problem. The message will be retried.';
  } else if (responseCode && responseCode >= 500) {
    kind = 'permanent';
    userMessage = 'The mail server permanently rejected this recipient or message.';
  } else if (code === 'EENVELOPE' || code === 'EMESSAGE') {
    kind = 'permanent';
    userMessage = 'The recipient address was rejected by the mail server.';
  }

  const error = new Error(scrub(raw) || userMessage);
  error.kind = kind;
  error.userMessage = userMessage;
  error.code = code || null;
  error.responseCode = responseCode;
  return error;
}

/** Remove anything that looks like a secret from an error string. */
function scrub(text) {
  return String(text || '')
    .replace(/(pass(word)?|secret|token|key)\s*[:=]\s*\S+/gi, '$1=***')
    .slice(0, 500);
}

class SmtpTransport {
  /**
   * @param {object} settings  non-secret settings
   * @param {string} secret    password or API credential (kept in memory only)
   * @param {object} options   { createTransport } injectable for tests
   */
  constructor(settings, secret, options = {}) {
    this.settings = { ...settings };
    this.createTransport = options.createTransport || nodemailer.createTransport;
    this.transporter = null;
    this._options = buildTransportOptions(this.settings, secret, options.overrides);
  }

  _ensure() {
    if (!this.transporter) {
      this.transporter = this.createTransport(this._options);
    }
    return this.transporter;
  }

  /** Verify the server, TLS and credentials. Resolves { ok, message, kind? }. */
  async verify() {
    if (!this.settings.smtpHost) {
      return { ok: false, kind: 'config', message: 'Enter an SMTP host in Settings.' };
    }
    try {
      await this._ensure().verify();
      return {
        ok: true,
        message: `Connected to ${this.settings.smtpHost}:${this._options.port} (${describeEncryption(this.settings.encryption)}). ${this.settings.smtpUser ? 'Authentication succeeded.' : 'No login was configured.'}`
      };
    } catch (err) {
      const classified = classifyError(err);
      return { ok: false, kind: classified.kind, message: classified.userMessage, detail: classified.message };
    } finally {
      this.close();
    }
  }

  /** Send one message. Throws classified errors. */
  async send(mail) {
    try {
      const info = await this._ensure().sendMail(mail);
      return { messageId: info.messageId, accepted: info.accepted || [] };
    } catch (err) {
      throw classifyError(err);
    }
  }

  close() {
    if (this.transporter) {
      try {
        this.transporter.close();
      } catch {
        /* ignore */
      }
      this.transporter = null;
    }
  }
}

function describeEncryption(enc) {
  switch (enc) {
    case 'tls':
      return 'SSL/TLS';
    case 'none':
      return 'no encryption';
    default:
      return 'STARTTLS';
  }
}

module.exports = {
  SmtpTransport,
  buildTransportOptions,
  classifyError,
  scrub,
  DEFAULT_TIMEOUTS
};
