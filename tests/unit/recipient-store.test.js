'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { RecipientStore } = require('../../src/main/modules/recipient-store');
const { makeTempDir } = require('../helpers/fixtures');

const rec = (email, extra = {}) => ({ email, source: 'doc.pdf', ...extra });

test('ingest removes duplicates and tracks counts', () => {
  const store = new RecipientStore();
  const s = store.ingest([rec('a@x.com'), rec('A@x.com'), rec('b@x.com'), rec('bad@x')]);
  assert.equal(s.added, 3);
  assert.equal(s.duplicates, 1);
  const stats = store.stats();
  assert.equal(stats.total, 3);
  assert.equal(stats.valid, 2);
  assert.equal(stats.invalid, 1);
  assert.equal(stats.duplicatesRemoved, 1);
});

test('invalid addresses are kept for review but never selected', () => {
  const store = new RecipientStore();
  store.ingest([rec('bad@x')]);
  const [item] = store.list().items;
  assert.equal(item.status, 'invalid');
  assert.equal(item.selected, false);
  assert.equal(store.setSelected(['bad@x'], true), 0, 'invalid must not be selectable');
});

test('valid recipients are selected by default and selection can change', () => {
  const store = new RecipientStore();
  store.ingest([rec('a@x.com'), rec('b@x.com')]);
  assert.equal(store.stats().selected, 2);
  store.setSelected(['a@x.com'], false);
  assert.equal(store.stats().selected, 1);
  store.clearSelection();
  assert.equal(store.stats().selected, 0);
  store.selectAllMatching('valid');
  assert.equal(store.stats().selected, 2);
});

test('suppressed addresses are excluded from the sendable set', () => {
  const store = new RecipientStore({ isSuppressed: (e) => e === 'stop@x.com' });
  store.ingest([rec('ok@x.com'), rec('stop@x.com')]);
  const sendable = store.getSelectedValid().map((r) => r.email);
  assert.deepEqual(sendable, ['ok@x.com']);
});

test('list supports search, filter, sort and pagination', () => {
  const store = new RecipientStore();
  store.ingest([
    rec('charlie@x.com', { firstName: 'Charlie' }),
    rec('alpha@x.com'),
    rec('bravo@y.com'),
    rec('nope@x')
  ]);
  assert.deepEqual(store.list({ filter: 'invalid' }).items.map((r) => r.email), ['nope@x']);
  assert.equal(store.list({ search: 'x.com' }).total, 2);
  assert.equal(store.list({ search: 'charlie' }).total, 1, 'search includes first name');
  const sorted = store.list({ sortBy: 'email', sortDir: 'desc', filter: 'valid' }).items.map((r) => r.email);
  assert.deepEqual(sorted, ['charlie@x.com', 'bravo@y.com', 'alpha@x.com']);
  const page2 = store.list({ pageSize: 2, page: 2 });
  assert.equal(page2.items.length, 2);
  assert.equal(page2.total, 4);
});

test('manual add validates input and rejects duplicates', () => {
  const store = new RecipientStore();
  assert.equal(store.addManual('not-an-email').ok, false);
  assert.equal(store.addManual('me@example.com').ok, true);
  const dup = store.addManual('ME@example.com');
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
});

test('remove, removeSelected and removeInvalid update the list', () => {
  const store = new RecipientStore();
  store.ingest([rec('a@x.com'), rec('b@x.com'), rec('c@x.com'), rec('bad@x')]);
  assert.equal(store.remove(['a@x.com']), 1);
  assert.equal(store.removeInvalid(), 1);
  store.setSelected(['b@x.com'], false);
  assert.equal(store.removeSelected(), 1);
  assert.deepEqual(store.list().items.map((r) => r.email), ['b@x.com']);
});

test('CSV import maps columns, skips blanks and reports invalid rows', () => {
  const store = new RecipientStore();
  const csv = 'Email Address,First Name,Last Name,Company\nann@x.com,Ann,Lee,Acme\n,NoEmail,,\nbad@x,Bad,,\n';
  const s = store.importCsvText(csv);
  assert.equal(s.rows, 2);
  assert.equal(s.valid, 1);
  assert.equal(s.invalid, 1);
  const ann = store.list({ search: 'ann@' }).items[0];
  assert.equal(ann.firstName, 'Ann');
  assert.equal(ann.lastName, 'Lee');
  assert.equal(ann.extra.Company, 'Acme');
});

test('CSV import without an email column fails with a clear message', () => {
  const store = new RecipientStore();
  assert.throws(() => store.importCsvText('name,phone\nA,123'), /No email column/);
  assert.throws(() => store.importCsvText('email\n'), /no data rows/);
});

test('CSV export round-trips through import', () => {
  const a = new RecipientStore();
  a.ingest([{ email: 'x@example.com', firstName: 'X, Y', source: 'f.txt' }]);
  const csv = a.toCsv();
  const b = new RecipientStore();
  b.importCsvText(csv);
  const item = b.list().items[0];
  assert.equal(item.email, 'x@example.com');
  assert.equal(item.firstName, 'X, Y');
});

test('persistence survives reload and tolerates a corrupt file', () => {
  const dir = makeTempDir('sm-store-');
  const file = path.join(dir, 'recipients.json');
  const a = new RecipientStore({ persistPath: file });
  a.ingest([rec('keep@x.com')]);
  const b = new RecipientStore({ persistPath: file });
  assert.equal(b.stats().total, 1);

  fs.writeFileSync(file, '{not json');
  const c = new RecipientStore({ persistPath: file });
  assert.equal(c.stats().total, 0, 'corrupt store starts empty instead of crashing');
  fs.rmSync(dir, { recursive: true, force: true });
});
