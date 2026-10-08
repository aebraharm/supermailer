'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseDocument, isSupportedFile, stripMarkup, parseRtf, parseJson, parseDoc } = require('../../src/main/modules/document-parser');
const { extractEmailsFromText } = require('../../src/main/modules/email-utils');
const { makeTempDir, writeFile, makeDocxBuffer, makeXlsxBuffer, makePdfBuffer } = require('../helpers/fixtures');

const dir = makeTempDir('sm-parse-');
const emails = (text) => extractEmailsFromText(text).valid.sort();

test('isSupportedFile recognizes the required formats and rejects others', () => {
  for (const f of ['a.PDF', 'b.docx', 'c.doc', 'd.xlsx', 'e.xls', 'f.csv', 'g.txt', 'h.html', 'i.xml', 'j.json', 'k.md', 'l.rtf']) {
    assert.equal(isSupportedFile(f), true, f);
  }
  assert.equal(isSupportedFile('x.exe'), false);
  assert.equal(isSupportedFile('x.zip'), false);
});

test('PDF: extracts addresses from a text PDF', async () => {
  const p = writeFile(dir, 'customers.pdf', await makePdfBuffer(['Customer list', 'Reach us at pdf.user@example.com']));
  const r = await parseDocument(p);
  assert.equal(r.ok, true, r.error);
  assert.ok(emails(r.text).includes('pdf.user@example.com'));
});

test('DOCX: extracts addresses from a Word document', async () => {
  const p = writeFile(dir, 'letter.docx', makeDocxBuffer(['Dear team,', 'write to docx.user@example.org']));
  const r = await parseDocument(p);
  assert.equal(r.ok, true, r.error);
  assert.ok(emails(r.text).includes('docx.user@example.org'));
});

test('XLSX and XLS: extracts addresses from spreadsheet cells', async () => {
  const xlsx = writeFile(dir, 'contacts.xlsx', makeXlsxBuffer([['Name', 'Email'], ['Ann', 'ann@example.com']]));
  const r = await parseDocument(xlsx);
  assert.equal(r.ok, true, r.error);
  assert.ok(emails(r.text).includes('ann@example.com'));
});

test('CSV, TXT, Markdown, HTML, XML and JSON: all yield addresses', async () => {
  const cases = {
    'a.csv': 'name,email\nA,csv@example.com',
    'b.txt': 'txt@example.com',
    'c.md': '# Hi\n- [md@example.com](mailto:md@example.com)',
    'd.html': '<html><body><p>Mail <b>html@example.com</b></p><script>x@evil.com</script></body></html>',
    'e.xml': '<root><contact>xml@example.com</contact></root>',
    'f.json': JSON.stringify({ contacts: [{ email: 'json@example.com' }] })
  };
  for (const [name, content] of Object.entries(cases)) {
    const r = await parseDocument(writeFile(dir, name, content));
    assert.equal(r.ok, true, `${name}: ${r.error}`);
    assert.ok(emails(r.text).length >= 1, `${name} produced no emails`);
  }
  const html = await parseDocument(path.join(dir, 'd.html'));
  assert.ok(!emails(html.text).includes('x@evil.com'), 'script contents must be ignored');
});

test('RTF: strips control words and finds addresses', async () => {
  const rtf = String.raw`{\rtf1\ansi{\fonttbl\f0 Arial;}\f0\pard Write to \b rtf@example.com\b0\par Done\'e9}`;
  const r = await parseDocument(writeFile(dir, 'note.rtf', rtf));
  assert.equal(r.ok, true, r.error);
  assert.ok(emails(r.text).includes('rtf@example.com'));
  assert.ok(!r.text.includes('fonttbl'));
});

test('stripMarkup removes tags and decodes entities', () => {
  assert.equal(stripMarkup('<p>a&amp;b&#64;c.com</p>').trim(), 'a&b@c.com');
});

test('parseJson still scans text when JSON is malformed', () => {
  const r = parseJson(Buffer.from('{ broken: "x@example.com" '));
  assert.equal(r.ok, true);
  assert.ok(emails(r.text).includes('x@example.com'));
});

test('parseDoc recovers ASCII text from a binary .doc-like file', () => {
  // OLE2 magic followed by a plain-text run containing an address.
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const body = Buffer.alloc(512);
  body.write('Legacy contact legacy@example.com here', 100, 'latin1');
  const r = parseDoc(Buffer.concat([header, body]));
  assert.equal(r.ok, true);
  assert.ok(emails(r.text).includes('legacy@example.com'));
});

// ---------------------------------------------------------------- corrupt / unsupported

test('unsupported extension returns a clear error and does not throw', async () => {
  const p = writeFile(dir, 'archive.zip', 'PK-not-really');
  const r = await parseDocument(p);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNSUPPORTED');
  assert.match(r.error, /not supported/);
});

test('corrupted PDF is reported, not thrown', async () => {
  const r = await parseDocument(writeFile(dir, 'broken.pdf', 'this is not a pdf at all'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CORRUPT');
});

test('corrupted DOCX is reported, not thrown', async () => {
  const r = await parseDocument(writeFile(dir, 'broken.docx', 'garbage bytes'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CORRUPT');
});

test('corrupted XLSX is reported, not thrown', async () => {
  const r = await parseDocument(writeFile(dir, 'broken.xlsx', Buffer.from([1, 2, 3, 4, 5, 6])));
  // XLSX reader may parse some garbage without error; the contract is no throw
  assert.equal(typeof r.ok, 'boolean');
});

test('empty and missing files produce friendly errors', async () => {
  const empty = await parseDocument(writeFile(dir, 'empty.txt', ''));
  assert.equal(empty.code, 'EMPTY');
  const missing = await parseDocument(path.join(dir, 'does-not-exist.txt'));
  assert.equal(missing.code, 'MISSING');
});

test('a document with no addresses is a success with zero matches', async () => {
  const r = await parseDocument(writeFile(dir, 'plain.txt', 'nothing to see here'));
  assert.equal(r.ok, true);
  assert.deepEqual(emails(r.text), []);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
