'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, stringifyCsv, csvToObjects, objectsToCsv } = require('../../src/main/modules/csv');

test('parseCsv handles quotes, embedded commas, newlines and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'line1\nline2']
  ]);
});

test('parseCsv keeps a final row without trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('stringifyCsv round-trips values that need escaping', () => {
  const rows = [['name', 'note'], ['Doe, Jane', 'He said "ok"'], ['x', 'multi\nline']];
  const text = stringifyCsv(rows);
  assert.deepEqual(parseCsv(text), rows);
});

test('csvToObjects maps headers and skips blank lines', () => {
  const objs = csvToObjects('email,first_name\na@x.com,Ann\n\nb@x.com,Ben\n');
  assert.deepEqual(objs, [
    { email: 'a@x.com', first_name: 'Ann' },
    { email: 'b@x.com', first_name: 'Ben' }
  ]);
});

test('objectsToCsv writes the requested columns in order', () => {
  const text = objectsToCsv([{ email: 'a@x.com', extra: 'z' }], [
    { key: 'email', header: 'Email' },
    { key: 'missing', header: 'Missing' }
  ]);
  assert.equal(text, 'Email,Missing\r\na@x.com,\r\n');
});

test('parseCsv tolerates empty input', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(stringifyCsv([]), '');
});
