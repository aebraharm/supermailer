'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { CredentialManager } = require('../../src/main/modules/credential-manager');
const { SettingsStore } = require('../../src/main/modules/settings');
const { HistoryStore } = require('../../src/main/modules/history-store');
const { SuppressionStore } = require('../../src/main/modules/suppression-store');
const { makeTempDir } = require('../helpers/fixtures');
const { redact } = require('../../src/main/modules/logger');

/** Stand-in for Electron safeStorage (reversible, so we can test round-trips). */
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
};

test('CredentialManager refuses to run without OS encryption (no plaintext fallback)', () => {
  assert.throws(
    () => new CredentialManager({ safeStorage: { isEncryptionAvailable: () => false, encryptString() {}, decryptString() {} } }),
    /Refusing to store credentials in plaintext/
  );
  assert.throws(() => new CredentialManager({}), /requires a safeStorage/);
});

test('CredentialManager stores ciphertext on disk, never the plaintext secret', () => {
  const dir = makeTempDir('sm-cred-');
  const file = path.join(dir, 'credentials.json');
  const cm = new CredentialManager({ safeStorage: fakeSafeStorage, filePath: file });
  cm.storeCredential('smtp-secret', 'Sup3r-Secret-Pass!');
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes('Sup3r-Secret-Pass!'), 'plaintext must not be on disk');
  assert.equal(cm.getCredential('smtp-secret'), 'Sup3r-Secret-Pass!');

  const reloaded = new CredentialManager({ safeStorage: fakeSafeStorage, filePath: file });
  assert.equal(reloaded.getCredential('smtp-secret'), 'Sup3r-Secret-Pass!');
  assert.equal(reloaded.hasCredential('smtp-secret'), true);

  reloaded.storeCredential('smtp-secret', '');
  assert.equal(reloaded.hasCredential('smtp-secret'), false, 'empty value deletes');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CredentialManager returns null for undecryptable blobs instead of throwing', () => {
  const broken = { ...fakeSafeStorage, decryptString: () => { throw new Error('DPAPI failure'); } };
  const cm = new CredentialManager({ safeStorage: fakeSafeStorage });
  cm.storeCredential('x', 'value');
  cm.safeStorage = broken;
  assert.equal(cm.getCredential('x'), null);
});

test('logger redaction masks passwords, tokens and API keys', () => {
  const out = redact('user=bob password=hunter2 api_key: abc123 token="xyz"');
  assert.ok(!out.includes('hunter2'));
  assert.ok(!out.includes('abc123'));
  assert.ok(!out.includes('xyz'));
  assert.match(out, /password=\*\*\*/);
});

test('SettingsStore clamps numeric fields and ignores unknown keys', () => {
  const dir = makeTempDir('sm-set-');
  const store = new SettingsStore(path.join(dir, 'settings.json'));
  const s = store.update({ smtpPort: 99999999, sendingRatePerMinute: 0, encryption: 'bogus', hacked: true, senderEmail: 'a@b.co' });
  assert.equal(s.smtpPort, 65535);
  assert.equal(s.sendingRatePerMinute, 1);
  assert.equal(s.encryption, 'starttls');
  assert.equal('hacked' in s, false);
  assert.equal(s.senderEmail, 'a@b.co');
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!/password/i.test(raw), 'settings file must never contain a password field');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('HistoryStore persists campaigns and aggregates completed ones', () => {
  const dir = makeTempDir('sm-hist-');
  const file = path.join(dir, 'history.json');
  const h = new HistoryStore(file);
  h.add({ id: 'c1', name: 'One', status: 'completed', recipientCount: 10, sentCount: 10, successfulCount: 9, failedCount: 1 });
  h.add({ id: 'c2', name: 'Two', status: 'running', recipientCount: 5, sentCount: 1 });
  const again = new HistoryStore(file);
  assert.equal(again.list().length, 2);
  const agg = again.aggregateStats();
  assert.equal(agg.campaigns, 1, 'running campaigns excluded from totals');
  assert.equal(agg.successful, 9);
  assert.equal(again.get('c1').name, 'One');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SuppressionStore normalizes addresses and persists', () => {
  const dir = makeTempDir('sm-sup-');
  const file = path.join(dir, 'suppressed.json');
  const s = new SuppressionStore(file);
  assert.equal(s.add(['Bounce@Example.com', 'bounce@example.com']), 1);
  assert.equal(s.has('BOUNCE@example.com'), true);
  assert.equal(new SuppressionStore(file).size, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
