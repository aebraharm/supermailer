'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Small leveled logger that writes to a rolling log file and (in development)
 * to the console. It never writes credentials: any message is passed through
 * `redact()` which masks password/secret/token values.
 */

const MAX_LOG_BYTES = 5 * 1024 * 1024;

const SENSITIVE_PATTERN =
  /(password|passwd|pwd|secret|token|api[_-]?key|auth)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi;

function redact(text) {
  return String(text).replace(SENSITIVE_PATTERN, '$1=***');
}

class Logger {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.console = options.console !== false;
    if (filePath) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
  }

  _write(level, message, meta) {
    let line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${redact(message)}`;
    if (meta && typeof meta === 'object') {
      try {
        line += ' ' + redact(JSON.stringify(meta));
      } catch {
        /* ignore unserializable meta */
      }
    }
    if (this.filePath) {
      try {
        this._rotateIfNeeded();
        fs.appendFileSync(this.filePath, line + '\n');
      } catch {
        /* logging must never crash the app */
      }
    }
    if (this.console) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(line);
    }
  }

  /** Keep the log bounded: roll over to .1 once it exceeds MAX_LOG_BYTES. */
  _rotateIfNeeded() {
    try {
      if (fs.statSync(this.filePath).size > MAX_LOG_BYTES) {
        fs.renameSync(this.filePath, this.filePath + '.1');
      }
    } catch {
      /* file does not exist yet */
    }
  }

  info(message, meta) {
    this._write('info', message, meta);
  }

  success(message, meta) {
    this._write('success', message, meta);
  }

  warn(message, meta) {
    this._write('warn', message, meta);
  }

  error(message, meta) {
    this._write('error', message, meta);
  }
}

Logger.redact = redact;

module.exports = { Logger, redact };
