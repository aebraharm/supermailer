'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { ExtractionService, collectDocuments } = require('../../src/main/modules/extraction-service');
const { makeTempDir, writeFile, makeDocxBuffer, makeXlsxBuffer, makePdfBuffer } = require('../helpers/fixtures');

test('collectDocuments walks folders recursively and keeps only supported files', async () => {
  const dir = makeTempDir('sm-collect-');
  writeFile(dir, 'a.txt', 'x@example.com');
  writeFile(dir, 'sub/deep/b.csv', 'email\ny@example.com');
  writeFile(dir, 'skip.exe', 'nope');
  writeFile(dir, '.hidden.txt', 'secret@example.com');
  const { files, skipped } = collectDocuments([dir]);
  const names = files.map((f) => path.basename(f)).sort();
  assert.deepEqual(names, ['a.txt', 'b.csv']);
  assert.ok(skipped.some((s) => /Unsupported/.test(s.reason)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collectDocuments de-duplicates the same file given twice', () => {
  const dir = makeTempDir('sm-collect2-');
  const f = writeFile(dir, 'a.txt', 'x@example.com');
  const { files } = collectDocuments([f, f, dir]);
  assert.equal(files.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collectDocuments tolerates missing paths', () => {
  const { files, skipped } = collectDocuments(['/definitely/not/here.txt']);
  assert.equal(files.length, 0);
  assert.equal(skipped.length, 1);
});

test('ExtractionService: processes mixed formats in a worker, de-duplicates and flags bad files', async () => {
  const dir = makeTempDir('sm-extract-');
  writeFile(dir, 'people.txt', 'Ann <ann@example.com>, ben@example.com, broken@domain');
  writeFile(dir, 'more.csv', 'email,name\nann@example.com,Ann\ncy@example.org,Cy\n');
  writeFile(dir, 'letter.docx', makeDocxBuffer(['dan@example.net and ben@example.com']));
  writeFile(dir, 'sheet.xlsx', makeXlsxBuffer([['Email'], ['eve@example.io']]));
  writeFile(dir, 'bad.pdf', 'not a real pdf');
  writeFile(dir, 'page.html', '<p>fay@example.dev</p>');
  writeFile(dir, 'weird.exe', 'MZ');

  const service = new ExtractionService();
  const progress = [];
  const summary = await service.run([dir], { onProgress: (p) => progress.push(p) });

  assert.equal(summary.documentsFound, 6, 'six supported documents');
  assert.equal(summary.documentsFailed, 1, 'corrupt PDF reported');
  assert.equal(summary.documentsProcessed, 5);
  assert.ok(summary.failures.some((f) => f.fileName === 'bad.pdf'));
  assert.ok(summary.skipped.some((s) => /weird\.exe|Unsupported/.test(s.path + s.reason)));

  const valid = summary.records.filter((r) => r.status === 'valid').map((r) => r.email).sort();
  assert.deepEqual(valid, [
    'ann@example.com',
    'ben@example.com',
    'cy@example.org',
    'dan@example.net',
    'eve@example.io',
    'fay@example.dev'
  ]);
  assert.equal(summary.uniqueValid, 6);
  assert.equal(summary.invalidAddresses, 1, 'broken@domain flagged');
  assert.ok(summary.duplicatesRemoved >= 2, 'duplicates across documents removed');
  const ben = summary.records.find((r) => r.email === 'ben@example.com');
  assert.ok(ben.sources.length >= 2, 'source documents preserved');
  assert.equal(progress.at(-1).done, 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ExtractionService: a PDF with real text is extracted through the worker', async () => {
  const dir = makeTempDir('sm-extract-pdf-');
  writeFile(dir, 'real.pdf', await makePdfBuffer(['Reach pdfworker@example.com']));
  const summary = await new ExtractionService().run([path.join(dir, 'real.pdf')]);
  assert.equal(summary.uniqueValid, 1);
  assert.equal(summary.records[0].email, 'pdfworker@example.com');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ExtractionService: empty selection returns an empty summary without starting a worker', async () => {
  const summary = await new ExtractionService().run([]);
  assert.equal(summary.documentsFound, 0);
  assert.equal(summary.records.length, 0);
});

test('ExtractionService: cancel stops before the remaining documents', async () => {
  const dir = makeTempDir('sm-extract-cancel-');
  for (let i = 0; i < 8; i += 1) writeFile(dir, `f${i}.txt`, `user${i}@example.com`);
  const service = new ExtractionService();
  const summary = await service.run([dir], {
    onProgress: (p) => {
      if (p.done === 2) service.cancel();
    }
  });
  assert.equal(summary.cancelled, true);
  assert.ok(summary.documentsProcessed < 8);
  fs.rmSync(dir, { recursive: true, force: true });
});
