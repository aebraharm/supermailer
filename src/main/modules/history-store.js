'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAX_CAMPAIGNS = 500;

/**
 * Persistent campaign history. Stores campaign metadata and per-recipient
 * results. Deliberately does NOT store the email content or credentials.
 */
class HistoryStore extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.campaigns = [];
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) this.campaigns = data;
    } catch (err) {
      if (err.code !== 'ENOENT') this.campaigns = [];
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.campaigns));
      fs.renameSync(tmp, this.filePath);
    } catch {
      /* persistence must never crash the app */
    }
  }

  _emitChange() {
    this._save();
    this.emit('change', this.list());
  }

  add(record) {
    const campaign = {
      id: record.id || crypto.randomUUID(),
      name: record.name || 'Untitled campaign',
      createdAt: record.createdAt || Date.now(),
      startedAt: record.startedAt || null,
      finishedAt: record.finishedAt || null,
      durationMs: record.durationMs || 0,
      recipientCount: record.recipientCount || 0,
      sentCount: record.sentCount || 0,
      successfulCount: record.successfulCount || 0,
      failedCount: record.failedCount || 0,
      skippedCount: record.skippedCount || 0,
      status: record.status || 'running',
      error: record.error || null,
      results: Array.isArray(record.results) ? record.results : []
    };
    this.campaigns.unshift(campaign);
    if (this.campaigns.length > MAX_CAMPAIGNS) {
      this.campaigns.length = MAX_CAMPAIGNS;
    }
    this._emitChange();
    return campaign;
  }

  update(id, patch) {
    const campaign = this.campaigns.find((c) => c.id === id);
    if (!campaign) return null;
    Object.assign(campaign, patch);
    this._emitChange();
    return campaign;
  }

  get(id) {
    return this.campaigns.find((c) => c.id === id) || null;
  }

  /** Newest first. */
  list() {
    return [...this.campaigns].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  remove(id) {
    const before = this.campaigns.length;
    this.campaigns = this.campaigns.filter((c) => c.id !== id);
    if (this.campaigns.length !== before) {
      this._emitChange();
      return true;
    }
    return false;
  }

  clear() {
    this.campaigns = [];
    this._emitChange();
  }

  /** All-time aggregates for the dashboard. */
  aggregateStats() {
    const agg = { campaigns: 0, sent: 0, successful: 0, failed: 0, recipients: 0 };
    for (const c of this.campaigns) {
      if (c.status === 'running') continue;
      agg.campaigns += 1;
      agg.sent += c.sentCount || 0;
      agg.successful += c.successfulCount || 0;
      agg.failed += c.failedCount || 0;
      agg.recipients += c.recipientCount || 0;
    }
    return agg;
  }
}

module.exports = { HistoryStore };
