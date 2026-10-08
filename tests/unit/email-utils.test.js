'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail,
  validateEmail,
  extractEmailsFromText,
  buildRecipientRecords,
  formatAddress
} = require('../../src/main/modules/email-utils');

test('normalizeEmail trims, lowercases and strips wrappers', () => {
  assert.equal(normalizeEmail('  John.Doe@Example.COM '), 'john.doe@example.com');
  assert.equal(normalizeEmail('mailto:a@b.co'), 'a@b.co');
  assert.equal(normalizeEmail('<user@example.org>,'), 'user@example.org');
  assert.equal(normalizeEmail(null), '');
});

test('validateEmail accepts well-formed addresses', () => {
  for (const e of ['a@b.co', 'first.last+tag@sub.example.com', 'o\'neil@example.io']) {
    assert.equal(validateEmail(e).valid, true, e);
  }
});

test('validateEmail rejects malformed addresses with a reason', () => {
  assert.equal(validateEmail('plainaddress').valid, false);
  assert.equal(validateEmail('a@b').reason, 'malformed');
  assert.equal(validateEmail('a..b@example.com').valid, false);
  assert.equal(validateEmail('.a@example.com').valid, false);
  assert.equal(validateEmail('a@-bad.com').valid, false);
  assert.equal(validateEmail('a b@example.com').reason, 'whitespace');
  assert.equal(validateEmail('a@example.c1').reason, 'invalid_tld');
  assert.equal(validateEmail('').reason, 'empty');
  assert.equal(validateEmail('x'.repeat(65) + '@example.com').reason, 'malformed');
});

test('extractEmailsFromText finds, normalizes and de-duplicates addresses', () => {
  const text = `Contact Alice@Example.com or alice@example.com; also bob@test.org.
    Email: <carol@sample.net>, mailto:dave@demo.io`;
  const { valid, invalid } = extractEmailsFromText(text);
  assert.deepEqual(valid.sort(), ['alice@example.com', 'bob@test.org', 'carol@sample.net', 'dave@demo.io'].sort());
  assert.deepEqual(invalid, []);
});

test('extractEmailsFromText reports malformed near-misses as invalid', () => {
  const { valid, invalid } = extractEmailsFromText('good@example.com broken@domain bad@x.c1');
  assert.deepEqual(valid, ['good@example.com']);
  assert.ok(invalid.includes('broken@domain'));
  assert.ok(invalid.includes('bad@x.c1'));
});

test('extractEmailsFromText handles empty and non-string input safely', () => {
  assert.deepEqual(extractEmailsFromText(''), { valid: [], invalid: [] });
  assert.deepEqual(extractEmailsFromText(undefined), { valid: [], invalid: [] });
  assert.deepEqual(extractEmailsFromText(42), { valid: [], invalid: [] });
});

test('buildRecipientRecords tags each record with its source document', () => {
  const recs = buildRecipientRecords('x@example.com y@bad', 'contacts.pdf');
  const valid = recs.find((r) => r.email === 'x@example.com');
  const invalid = recs.find((r) => r.email === 'y@bad');
  assert.equal(valid.status, 'valid');
  assert.equal(valid.source, 'contacts.pdf');
  assert.equal(invalid.status, 'invalid');
  assert.ok(invalid.reason);
});

test('formatAddress builds display-name headers safely', () => {
  assert.equal(formatAddress('Acme', 'hi@acme.com'), 'Acme <hi@acme.com>');
  assert.equal(formatAddress('', 'hi@acme.com'), 'hi@acme.com');
  assert.equal(formatAddress('Doe, Jane', 'j@x.com'), '"Doe, Jane" <j@x.com>');
});
