'use strict';

const fs = require('fs');
const path = require('path');

const ENCRYPTION_METHODS = ['starttls', 'tls', 'none'];

const DEFAULTS = {
  senderName: '',
  senderEmail: '',
  replyTo: '',
  smtpHost: '',
  smtpPort: 587,
  encryption: 'starttls',
  smtpUser: '',
  sendingRatePerMinute: 30,
  connectionTimeoutSec: 30,
  greetingTimeoutSec: 15,
  socketTimeoutSec: 60,
  maxRetries: 3,
  retryDelaySeconds: [10, 30, 90],
  listUnsubscribe: '',
  verifyTls: true
};

const LIMITS = {
  smtpPort: [1, 65535],
  sendingRatePerMinute: [1, 1000],
  connectionTimeoutSec: [5, 300],
  greetingTimeoutSec: [5, 300],
  socketTimeoutSec: [10, 600],
  maxRetries: [0, 10]
};

function clampNumber(value, [min, max], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Application settings store. Persists non-secret settings to JSON.
 * The SMTP password / API credential is NEVER stored here — it lives only in
 * the CredentialManager (OS secure storage).
 */
class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.settings = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      this.settings = { ...DEFAULTS, ...data };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.settings = { ...DEFAULTS };
      }
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch {
      /* persistence must never crash the app */
    }
  }

  get() {
    return { ...this.settings };
  }

  /** Public copy — guaranteed to contain no credentials. */
  getPublic() {
    return this.get();
  }

  isSendingConfigured() {
    const s = this.settings;
    return Boolean(s.senderEmail && s.smtpHost && s.smtpPort);
  }

  update(patch = {}) {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS)) continue; // ignore unknown keys
      if (key in LIMITS) {
        next[key] = clampNumber(value, LIMITS[key], DEFAULTS[key]);
      } else if (key === 'encryption') {
        next[key] = ENCRYPTION_METHODS.includes(value) ? value : this.settings.encryption;
      } else if (key === 'retryDelaySeconds') {
        const arr = Array.isArray(value) ? value : DEFAULTS.retryDelaySeconds;
        next[key] = arr
          .map((v) => clampNumber(v, [1, 3600], 10))
          .slice(0, LIMITS.maxRetries[1]);
        if (next[key].length === 0) next[key] = [...DEFAULTS.retryDelaySeconds];
      } else if (key === 'verifyTls') {
        next[key] = Boolean(value);
      } else {
        next[key] = typeof DEFAULTS[key] === 'number' ? clampNumber(value, [-1e9, 1e9], DEFAULTS[key]) : String(value ?? '');
      }
    }
    this.settings = next;
    this._save();
    return this.get();
  }
}

module.exports = { SettingsStore, DEFAULTS, ENCRYPTION_METHODS };
