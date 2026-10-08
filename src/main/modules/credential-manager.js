'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Secure credential storage.
 *
 * Uses Electron's `safeStorage` API, which on Windows is backed by DPAPI —
 * the appropriate OS-level secure credential mechanism. Encrypted blobs are
 * kept in a JSON file inside the app's userData directory; the plaintext
 * secret only ever exists in memory.
 *
 * If the OS encryption facility is unavailable, this class refuses to store
 * anything rather than falling back to plaintext.
 *
 * The `safeStorage` implementation is injected so the class can be unit
 * tested without Electron (pass any object with the same 3 methods).
 */
class CredentialManager {
  constructor(options = {}) {
    const { safeStorage, filePath } = options;
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
      throw new Error('CredentialManager requires a safeStorage implementation.');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Secure credential storage is not available on this system (DPAPI unavailable). ' +
          'Refusing to store credentials in plaintext.'
      );
    }
    this.safeStorage = safeStorage;
    this.filePath = filePath;
    this.secrets = {};
    if (this.filePath) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.secrets && typeof data.secrets === 'object') {
          this.secrets = data.secrets;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') this.secrets = {};
      }
    }
  }

  _save() {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, secrets: this.secrets }, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch {
      /* persistence must never crash the app */
    }
  }

  /** Encrypt and store a secret. Empty value deletes the credential. */
  storeCredential(name, value) {
    if (!name) throw new Error('Credential name is required.');
    if (value === null || value === undefined || value === '') {
      return this.deleteCredential(name);
    }
    const encrypted = this.safeStorage.encryptString(String(value));
    this.secrets[name] = Buffer.from(encrypted).toString('base64');
    this._save();
    return true;
  }

  /** Retrieve and decrypt a secret, or null when absent/undecryptable. */
  getCredential(name) {
    const blob = this.secrets[name];
    if (!blob) return null;
    try {
      const decrypted = this.safeStorage.decryptString(Buffer.from(blob, 'base64'));
      return typeof decrypted === 'string' ? decrypted : null;
    } catch {
      return null;
    }
  }

  hasCredential(name) {
    return Object.prototype.hasOwnProperty.call(this.secrets, name);
  }

  deleteCredential(name) {
    if (name in this.secrets) {
      delete this.secrets[name];
      this._save();
      return true;
    }
    return false;
  }
}

module.exports = { CredentialManager };
