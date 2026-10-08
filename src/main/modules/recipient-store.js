'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { normalizeEmail, validateEmail } = require('./email-utils');
const { csvToObjects, objectsToCsv } = require('./csv');

const STORE_VERSION = 1;
const MAX_RECIPIENTS = 100000;

/** Canonicalize a CSV header name for column mapping. */
function canonicalHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

const EMAIL_HEADERS = new Set(['email', 'emailaddress', 'mail', 'e-mailaddress', 'address']);
const FIRST_NAME_HEADERS = new Set(['firstname', 'fname', 'givenname', 'forename', 'first']);
const LAST_NAME_HEADERS = new Set(['lastname', 'lname', 'surname', 'familyname', 'last']);

function mapColumns(headers) {
  const map = { email: null, firstName: null, lastName: null, extra: [] };
  headers.forEach((raw, idx) => {
    const key = canonicalHeader(raw);
    if (!key) return;
    if (!map.email && EMAIL_HEADERS.has(key)) map.email = idx;
    else if (!map.firstName && FIRST_NAME_HEADERS.has(key)) map.firstName = idx;
    else if (!map.lastName && LAST_NAME_HEADERS.has(key)) map.lastName = idx;
    else map.extra.push({ key: String(raw).trim() || `column_${idx + 1}`, idx });
  });
  return map;
}

/**
 * Central recipient store. Keeps the working recipient list in memory and
 * persists it to JSON. Never throws on bad input — invalid addresses are
 * stored with status 'invalid' so the user can review them.
 *
 * Events: 'change' (stats snapshot) after every mutation.
 */
class RecipientStore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.persistPath = options.persistPath || null;
    this.isSuppressed =
      typeof options.isSuppressed === 'function' ? options.isSuppressed : () => false;
    /** @type {Map<string, object>} keyed by normalized email */
    this.recipients = new Map();
    this.counters = { duplicatesRemoved: 0, imports: 0, extractions: 0 };
    if (this.persistPath) this._load();
  }

  // ---------------------------------------------------------------- persistence

  _load() {
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.version === STORE_VERSION && data.recipients) {
        for (const r of data.recipients) {
          this.recipients.set(r.email, {
            email: r.email,
            source: r.source || null,
            sources: Array.isArray(r.sources) ? r.sources : r.source ? [r.source] : [],
            status: r.status || 'valid',
            reason: r.reason || null,
            selected: r.selected !== false,
            firstName: r.firstName || '',
            lastName: r.lastName || '',
            extra: r.extra || {},
            occurrences: r.occurrences || 1,
            addedAt: r.addedAt || Date.now()
          });
        }
        this.counters = Object.assign(this.counters, data.counters || {});
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Corrupt store file: start fresh rather than crash.
        this.recipients.clear();
      }
    }
  }

  _save() {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const data = {
        version: STORE_VERSION,
        counters: this.counters,
        recipients: [...this.recipients.values()]
      };
      const tmp = this.persistPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.persistPath);
    } catch {
      /* persistence must never crash the app */
    }
  }

  _emitChange() {
    this._save();
    this.emit('change', this.stats());
  }

  // ---------------------------------------------------------------- ingestion

  /**
   * Ingest extracted/imported records.
   * records: [{ email, source?, status?, reason?, firstName?, lastName?, extra? }]
   * Returns { added, duplicates, valid, invalid }.
   */
  ingest(records, options = {}) {
    const summary = { added: 0, duplicates: 0, valid: 0, invalid: 0 };
    if (!Array.isArray(records)) return summary;
    for (const rec of records) {
      if (!rec) continue;
      const email = normalizeEmail(rec.email);
      if (!email) continue;

      const existing = this.recipients.get(email);
      if (existing) {
        summary.duplicates += 1;
        this.counters.duplicatesRemoved += 1;
        existing.occurrences += 1;
        if (rec.source && !existing.sources.includes(rec.source)) {
          existing.sources.push(rec.source);
          if (!existing.source) existing.source = rec.source;
        }
        // An address previously seen as invalid may arrive valid later.
        const check = validateEmail(email);
        const shouldBeValid = rec.status ? rec.status === 'valid' : check.valid;
        if (shouldBeValid && existing.status !== 'valid') {
          existing.status = 'valid';
          existing.reason = null;
          if (existing.selected !== true && !this.isSuppressed(email)) {
            existing.selected = true;
          }
        }
        continue;
      }

      if (this.recipients.size >= MAX_RECIPIENTS) break;

      const check = validateEmail(email);
      const valid = rec.status ? rec.status === 'valid' : check.valid;
      let status = valid ? 'valid' : 'invalid';
      let reason = valid ? null : rec.reason || check.reason;
      if (status === 'valid' && this.isSuppressed(email)) {
        status = 'suppressed';
        reason = 'suppressed';
      }
      const source = rec.source || options.source || null;
      this.recipients.set(email, {
        email,
        source,
        sources: source ? [source] : [],
        status,
        reason,
        selected: status === 'valid',
        firstName: rec.firstName || '',
        lastName: rec.lastName || '',
        extra: rec.extra && typeof rec.extra === 'object' ? { ...rec.extra } : {},
        occurrences: 1,
        addedAt: Date.now()
      });
      summary.added += 1;
      if (status === 'valid') summary.valid += 1;
      else summary.invalid += 1;
    }
    if (options.kind === 'import') this.counters.imports += 1;
    if (options.kind === 'extract') this.counters.extractions += 1;
    this._emitChange();
    return summary;
  }

  /** Manually add a single recipient. Returns { ok, reason?, recipient? }. */
  addManual(email, fields = {}) {
    const normalized = normalizeEmail(email);
    const check = validateEmail(normalized);
    if (!check.valid) {
      return { ok: false, reason: check.reason || 'malformed', message: `"${email}" is not a valid email address.` };
    }
    if (this.recipients.has(normalized)) {
      return { ok: false, reason: 'duplicate', message: `${normalized} is already in the recipient list.` };
    }
    const recipient = {
      email: normalized,
      source: fields.source || 'Manual entry',
      sources: fields.source ? [fields.source] : ['Manual entry'],
      status: this.isSuppressed(normalized) ? 'suppressed' : 'valid',
      reason: this.isSuppressed(normalized) ? 'suppressed' : null,
      selected: !this.isSuppressed(normalized),
      firstName: fields.firstName || '',
      lastName: fields.lastName || '',
      extra: {},
      occurrences: 1,
      addedAt: Date.now()
    };
    this.recipients.set(normalized, recipient);
    this._emitChange();
    return { ok: true, recipient };
  }

  // ---------------------------------------------------------------- queries

  /**
   * List recipients with search / filter / sort / pagination.
   * query: { search, filter, sortBy, sortDir, page, pageSize }
   */
  list(query = {}) {
    const {
      search = '',
      filter = 'all',
      sortBy = 'email',
      sortDir = 'asc',
      page = 1,
      pageSize = 100
    } = query;

    let items = [...this.recipients.values()];

    if (filter === 'valid') items = items.filter((r) => r.status === 'valid');
    else if (filter === 'invalid') items = items.filter((r) => r.status === 'invalid');
    else if (filter === 'suppressed') items = items.filter((r) => r.status === 'suppressed');
    else if (filter === 'selected') items = items.filter((r) => r.selected);

    const q = String(search).trim().toLowerCase();
    if (q) {
      items = items.filter(
        (r) =>
          r.email.includes(q) ||
          (r.firstName && r.firstName.toLowerCase().includes(q)) ||
          (r.lastName && r.lastName.toLowerCase().includes(q)) ||
          (r.source && r.source.toLowerCase().includes(q))
      );
    }

    const dir = sortDir === 'desc' ? -1 : 1;
    const by = sortBy || 'email';
    items.sort((a, b) => {
      let av = a[by];
      let bv = b[by];
      if (by === 'source') {
        av = a.source || '';
        bv = b.source || '';
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });

    const total = items.length;
    const start = (Math.max(1, page) - 1) * pageSize;
    return {
      total,
      page: Math.max(1, page),
      pageSize,
      items: items.slice(start, start + pageSize).map((r) => ({ ...r }))
    };
  }

  stats() {
    let valid = 0;
    let invalid = 0;
    let suppressed = 0;
    let selected = 0;
    let selectedValid = 0;
    for (const r of this.recipients.values()) {
      if (r.status === 'valid') valid += 1;
      else if (r.status === 'invalid') invalid += 1;
      else if (r.status === 'suppressed') suppressed += 1;
      if (r.selected) {
        selected += 1;
        if (r.status === 'valid') selectedValid += 1;
      }
    }
    return {
      total: this.recipients.size,
      valid,
      invalid,
      suppressed,
      selected,
      selectedValid,
      duplicatesRemoved: this.counters.duplicatesRemoved,
      imports: this.counters.imports,
      extractions: this.counters.extractions
    };
  }

  // ---------------------------------------------------------------- mutations

  setSelected(emails, selected) {
    let count = 0;
    for (const raw of emails || []) {
      const r = this.recipients.get(normalizeEmail(raw));
      if (r && r.selected !== selected) {
        // Never auto-select invalid/suppressed recipients.
        if (selected && r.status !== 'valid') continue;
        r.selected = selected;
        count += 1;
      }
    }
    if (count) this._emitChange();
    return count;
  }

  /** Select all recipients matching a filter. Returns number selected. */
  selectAllMatching(filter = 'all') {
    let count = 0;
    for (const r of this.recipients.values()) {
      if (filter === 'valid' && r.status !== 'valid') continue;
      if (filter === 'invalid' && r.status !== 'invalid') continue;
      if (filter === 'suppressed' && r.status !== 'suppressed') continue;
      if (r.status === 'valid' && !r.selected) {
        r.selected = true;
        count += 1;
      }
    }
    if (count) this._emitChange();
    return count;
  }

  clearSelection() {
    let count = 0;
    for (const r of this.recipients.values()) {
      if (r.selected) {
        r.selected = false;
        count += 1;
      }
    }
    if (count) this._emitChange();
    return count;
  }

  remove(emails) {
    let count = 0;
    for (const raw of emails || []) {
      if (this.recipients.delete(normalizeEmail(raw))) count += 1;
    }
    if (count) this._emitChange();
    return count;
  }

  removeInvalid() {
    let count = 0;
    for (const [email, r] of [...this.recipients.entries()]) {
      if (r.status === 'invalid') {
        this.recipients.delete(email);
        count += 1;
      }
    }
    if (count) this._emitChange();
    return count;
  }

  removeSelected() {
    let count = 0;
    for (const [email, r] of [...this.recipients.entries()]) {
      if (r.selected) {
        this.recipients.delete(email);
        count += 1;
      }
    }
    if (count) this._emitChange();
    return count;
  }

  clear() {
    this.recipients.clear();
    this.counters = { duplicatesRemoved: 0, imports: 0, extractions: 0 };
    this._emitChange();
  }

  /** Selected & valid recipients, ready to be queued for a campaign. */
  getSelectedValid() {
    const out = [];
    for (const r of this.recipients.values()) {
      if (r.selected && r.status === 'valid') out.push({ ...r });
    }
    return out;
  }

  // ---------------------------------------------------------------- CSV

  /** Import recipients from CSV text. Throws Error with a friendly message. */
  importCsvText(text) {
    let objects;
    try {
      objects = csvToObjects(text);
    } catch (err) {
      throw new Error(`Could not parse CSV: ${err.message}`);
    }
    if (objects.length === 0) {
      throw new Error('The CSV file contains no data rows.');
    }
    const headers = Object.keys(objects[0]);
    const map = mapColumns(headers);
    if (map.email === null) {
      throw new Error('No email column found. The CSV must include a column named "email" (or "Email address").');
    }
    const records = [];
    for (const row of objects) {
      const values = headers.map((h) => row[h]);
      const email = values[map.email];
      if (!email) continue;
      const extra = {};
      for (const col of map.extra) extra[col.key] = values[col.idx];
      records.push({
        email,
        source: 'CSV import',
        firstName: map.firstName !== null ? values[map.firstName] : '',
        lastName: map.lastName !== null ? values[map.lastName] : '',
        extra
      });
    }
    const summary = this.ingest(records, { kind: 'import' });
    return { ...summary, rows: records.length };
  }

  /**
   * Export recipients to CSV text. Cells that begin with a spreadsheet formula
   * trigger (=, +, -, @, tab, CR) are prefixed with an apostrophe so opening the
   * export in Excel cannot execute them (CSV formula injection).
   */
  toCsv(options = {}) {
    const onlySelected = options.onlySelected === true;
    let rows = [...this.recipients.values()];
    if (onlySelected) rows = rows.filter((r) => r.selected);
    rows.sort((a, b) => a.email.localeCompare(b.email));
    rows = rows.map((r) => {
      const out = { ...r };
      for (const key of ['firstName', 'lastName', 'source', 'status']) {
        if (/^[=+\-@\t\r]/.test(String(out[key] || ''))) out[key] = "'" + out[key];
      }
      return out;
    });
    return objectsToCsv(rows, [
      { key: 'email', header: 'email' },
      { key: 'firstName', header: 'first_name' },
      { key: 'lastName', header: 'last_name' },
      { key: 'source', header: 'source' },
      { key: 'status', header: 'status' },
      { key: 'selected', header: 'selected' }
    ]);
  }
}

module.exports = { RecipientStore, MAX_RECIPIENTS };
