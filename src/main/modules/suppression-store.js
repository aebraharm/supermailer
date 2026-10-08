'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { normalizeEmail } = require('./email-utils');

/**
 * Suppression list: addresses that permanently bounced (or were manually
 * suppressed) and must not be mailed again. Persisted to JSON.
 */
class SuppressionStore extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    /** @type {Map<string, {email:string, reason:string, at:number}>} */
    this.entries = new Map();
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry && entry.email) {
            this.entries.set(normalizeEmail(entry.email), {
              email: normalizeEmail(entry.email),
              reason: entry.reason || 'suppressed',
              at: entry.at || Date.now()
            });
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') this.entries.clear();
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...this.entries.values()]));
      fs.renameSync(tmp, this.filePath);
    } catch {
      /* persistence must never crash the app */
    }
  }

  _emitChange() {
    this._save();
    this.emit('change', this.list());
  }

  add(emails, reason = 'permanent_failure') {
    let count = 0;
    for (const raw of Array.isArray(emails) ? emails : [emails]) {
      const email = normalizeEmail(raw);
      if (!email) continue;
      if (!this.entries.has(email)) {
        this.entries.set(email, { email, reason, at: Date.now() });
        count += 1;
      }
    }
    if (count) this._emitChange();
    return count;
  }

  has(email) {
    return this.entries.has(normalizeEmail(email));
  }

  remove(emails) {
    let count = 0;
    for (const raw of Array.isArray(emails) ? emails : [emails]) {
      if (this.entries.delete(normalizeEmail(raw))) count += 1;
    }
    if (count) this._emitChange();
    return count;
  }

  list() {
    return [...this.entries.values()].sort((a, b) => b.at - a.at);
  }

  clear() {
    this.entries.clear();
    this._emitChange();
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { SuppressionStore };
