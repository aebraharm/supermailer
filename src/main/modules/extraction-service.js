'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const { isSupportedFile } = require('./document-parser');

const MAX_FILES = 5000;
const MAX_DEPTH = 8;

/**
 * Expand a mixed list of files and folders into supported document paths.
 * Folders are walked recursively (bounded by depth and file count). Symlinks
 * are skipped to avoid loops and reading files outside the chosen folder.
 * Returns { files: string[], skipped: [{path, reason}] }.
 */
function collectDocuments(inputPaths) {
  const files = [];
  const skipped = [];
  const seen = new Set();

  const walk = (p, depth) => {
    if (files.length >= MAX_FILES) return;
    let stat;
    try {
      stat = fs.lstatSync(p);
    } catch {
      skipped.push({ path: p, reason: 'Could not be accessed.' });
      return;
    }
    if (stat.isSymbolicLink()) {
      skipped.push({ path: p, reason: 'Symbolic links are skipped for safety.' });
      return;
    }
    if (stat.isDirectory()) {
      if (depth >= MAX_DEPTH) return;
      let entries = [];
      try {
        entries = fs.readdirSync(p);
      } catch {
        skipped.push({ path: p, reason: 'Folder could not be read.' });
        return;
      }
      for (const entry of entries.sort()) {
        if (entry.startsWith('.')) continue; // hidden/system entries
        walk(path.join(p, entry), depth + 1);
        if (files.length >= MAX_FILES) break;
      }
      return;
    }
    if (!stat.isFile()) return;
    const key = path.resolve(p).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (isSupportedFile(p)) files.push(p);
    else skipped.push({ path: p, reason: `Unsupported file type (${path.extname(p) || 'none'}).` });
  };

  for (const p of inputPaths || []) {
    if (typeof p === 'string' && p.length > 0) walk(path.resolve(p), 0);
  }
  return { files, skipped };
}

/**
 * Runs document extraction in a worker thread. Emits:
 *  - 'progress' { done, total, current }
 *  - 'file' per-file result (for live UI feedback)
 * run() resolves with a summary; it never rejects for per-file problems.
 */
class ExtractionService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workerPath = options.workerPath || path.join(__dirname, '..', 'workers', 'extraction-worker.js');
    this.worker = null;
    this.current = null;
    this.cancelled = false;
  }

  /**
   * @param {string[]} paths  files and/or folders selected by the user
   * @param {object} hooks    optional { onFile(result), onProgress(progress) }
   */
  async run(paths, hooks = {}) {
    if (this.current) throw new Error('An extraction is already running.');
    const started = Date.now();
    const { files, skipped } = collectDocuments(paths);

    const summary = {
      documentsFound: files.length,
      documentsProcessed: 0,
      documentsFailed: 0,
      emailsFound: 0,
      uniqueValid: 0,
      invalidAddresses: 0,
      duplicatesRemoved: 0,
      skipped,
      failures: [],
      records: [],
      cancelled: false,
      durationMs: 0
    };

    if (files.length === 0) {
      this.current = null;
      summary.durationMs = Date.now() - started;
      return summary;
    }

    this.current = { startedAt: started };
    this.cancelled = false;
    let worker = null;
    let pending = null; // { id, resolve }
    let counter = 0;

    const spawn = () => {
      const w = new Worker(this.workerPath);
      w.on('message', (msg) => {
        if (!pending || pending.id !== msg.id) return;
        const { resolve } = pending;
        pending = null;
        handleResult(msg);
        resolve({ ok: true });
      });
      w.on('error', () => {
        // Worker crashed: fail the in-flight file and respawn lazily.
        if (pending) {
          const { resolve, id } = pending;
          pending = null;
          resolve({ ok: false, id });
        }
        worker = null;
      });
      return w;
    };

    const handleResult = (res) => {
      if (res.ok) {
        summary.documentsProcessed += 1;
        summary.emailsFound += res.emailsFound;
        for (const rec of res.records) {
          summary.records.push({ ...rec, source: res.fileName });
        }
      } else {
        summary.documentsFailed += 1;
        summary.failures.push({ fileName: res.fileName, format: res.format || null, error: res.error, code: res.code });
      }
      if (hooks.onFile) hooks.onFile(res);
      this.emit('file', res);
    };

    const parseOne = (filePath) =>
      new Promise((resolve) => {
        if (!worker) worker = spawn();
        const id = ++counter;
        pending = { id, resolve };
        worker.postMessage({ type: 'parse', id, filePath });
      });

    try {
      for (let i = 0; i < files.length; i += 1) {
        if (this.cancelled) {
          summary.cancelled = true;
          break;
        }
        const filePath = files[i];
        const outcome = await parseOne(filePath);
        if (!outcome.ok) {
          handleResult({
            ok: false,
            fileName: path.basename(filePath),
            error: 'Processing engine stopped unexpectedly while reading this file. The file may be corrupted.',
            code: 'WORKER_ERROR'
          });
        }
        const progress = { done: i + 1, total: files.length, current: path.basename(filePath) };
        if (hooks.onProgress) hooks.onProgress(progress);
        this.emit('progress', progress);
        await new Promise((r) => setImmediate(r));
      }
    } finally {
      this.current = null;
      this.worker = null;
      if (worker) await worker.terminate().catch(() => {});
    }

    // De-duplicate across documents and count invalid addresses.
    const seen = new Map();
    for (const rec of summary.records) {
      const existing = seen.get(rec.email);
      if (existing) {
        summary.duplicatesRemoved += 1;
        existing.occurrences = (existing.occurrences || 1) + 1;
        if (rec.status === 'valid' && existing.status !== 'valid') {
          existing.status = 'valid';
          existing.reason = null;
        }
        if (rec.source && !existing.sources.includes(rec.source)) existing.sources.push(rec.source);
        continue;
      }
      seen.set(rec.email, { ...rec, sources: [rec.source], occurrences: 1 });
    }
    summary.records = [...seen.values()];
    summary.uniqueValid = summary.records.filter((r) => r.status === 'valid').length;
    summary.invalidAddresses = summary.records.filter((r) => r.status === 'invalid').length;
    summary.durationMs = Date.now() - started;
    return summary;
  }

  cancel() {
    this.cancelled = true;
  }
}

module.exports = { ExtractionService, collectDocuments };
