'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Document text extraction. Each parser turns a file into plain text, which
 * is then scanned for email addresses by email-utils. Parsers never throw:
 * they return { ok: false, error } with a human-readable message so one bad
 * file cannot stop a batch.
 *
 * All parsing happens locally. Nothing is sent over the network.
 */

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB safety cap per document

const SUPPORTED = {
  '.pdf': 'PDF',
  '.docx': 'Word (DOCX)',
  '.doc': 'Word (DOC)',
  '.xlsx': 'Excel (XLSX)',
  '.xlsm': 'Excel (XLSM)',
  '.xls': 'Excel (XLS)',
  '.csv': 'CSV',
  '.txt': 'Text',
  '.md': 'Markdown',
  '.markdown': 'Markdown',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.xml': 'XML',
  '.json': 'JSON',
  '.rtf': 'RTF'
};

function supportedExtensions() {
  return Object.keys(SUPPORTED);
}

function isSupportedFile(filePath) {
  return Object.prototype.hasOwnProperty.call(SUPPORTED, path.extname(filePath).toLowerCase());
}

function fail(message, code = 'PARSE_ERROR') {
  return { ok: false, text: '', error: message, code };
}

function succeed(text) {
  return { ok: true, text, error: null, code: null };
}

// ----------------------------------------------------------------- helpers

/** Decode common HTML entities. */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/gi, '&');
}

function safeFromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Strip HTML/XML tags, keeping text and separating blocks with newlines. */
function stripMarkup(markup) {
  return decodeEntities(
    markup
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table|section|article|header|footer|blockquote)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
}

// ----------------------------------------------------------------- parsers

async function parsePdf(buffer) {
  // Lazy-load: pdfjs is large and only needed when a PDF is present.
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0
  });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    const msg = /password/i.test(String(err && err.message))
      ? 'This PDF is password-protected and cannot be read.'
      : 'The PDF could not be opened. It may be corrupted.';
    return fail(msg, 'CORRUPT');
  }
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || '').join(' '));
    }
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
  const text = pages.join('\n');
  if (!text.trim()) {
    return fail('No text layer found in this PDF (it may be a scanned image).', 'NO_TEXT');
  }
  return succeed(text);
}

async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  try {
    const result = await mammoth.extractRawText({ buffer });
    return succeed(result.value || '');
  } catch {
    return fail('The DOCX file could not be read. It may be corrupted.', 'CORRUPT');
  }
}

/**
 * Legacy .doc (OLE2 binary). No full parser is bundled; we recover text runs
 * (ASCII and UTF-16LE) from the binary, which reliably captures plain email
 * addresses in most documents. Reported as best-effort in the UI.
 */
function parseDoc(buffer) {
  const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buffer.length < 8 || !OLE_MAGIC.every((b, i) => buffer[i] === b)) {
    return fail('This .doc file is not a valid Word document. It may be corrupted.', 'CORRUPT');
  }
  const runs = [];
  // ASCII runs
  let cur = '';
  for (let i = 0; i < buffer.length; i += 1) {
    const b = buffer[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x40) {
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 4) runs.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 4) runs.push(cur);
  // UTF-16LE runs
  let wide = '';
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const lo = buffer[i];
    const hi = buffer[i + 1];
    if (hi === 0 && ((lo >= 0x20 && lo < 0x7f) || lo === 0x0a || lo === 0x0d || lo === 0x40)) {
      wide += String.fromCharCode(lo);
    } else {
      if (wide.length >= 4) runs.push(wide);
      wide = '';
    }
  }
  if (wide.length >= 4) runs.push(wide);
  const text = runs.join('\n');
  if (!text.includes('@')) {
    return fail('No readable text containing email addresses was found in this .doc file. Re-saving it as .docx may help.', 'NO_TEXT');
  }
  return succeed(text);
}

function parseSpreadsheet(buffer) {
  const XLSX = require('xlsx');
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', dense: true, cellFormula: false, cellHTML: false });
  } catch {
    return fail('The spreadsheet could not be opened. It may be corrupted or password-protected.', 'CORRUPT');
  }
  const parts = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    parts.push(XLSX.utils.sheet_to_csv(sheet, { FS: '\t', RS: '\n', blankrows: false }));
  }
  return succeed(parts.join('\n'));
}

function parseRtf(buffer) {
  const raw = buffer.toString('latin1');
  if (!raw.trimStart().startsWith('{\\rtf')) {
    return fail('This file does not look like a valid RTF document.', 'CORRUPT');
  }
  // Decode hex escapes (\'hh) and unicode (\uN?), then drop control words.
  let text = raw
    .replace(/\\'([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (m, n) => {
      let code = parseInt(n, 10);
      if (code < 0) code += 65536;
      return safeFromCodePoint(code);
    })
    .replace(/\\(par|line|row|tab)\b ?/g, '\n')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/\\[^a-zA-Z]/g, '')
    .replace(/[{}]/g, '');
  return succeed(text);
}

function parseJson(buffer) {
  const text = buffer.toString('utf8');
  try {
    const data = JSON.parse(text);
    const strings = [];
    const walk = (node, depth) => {
      if (depth > 200) return;
      if (typeof node === 'string') strings.push(node);
      else if (Array.isArray(node)) node.forEach((n) => walk(n, depth + 1));
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          strings.push(k);
          walk(v, depth + 1);
        }
      }
    };
    walk(data, 0);
    return succeed(strings.join('\n'));
  } catch {
    // Not valid JSON: still scan the raw text so a slightly malformed export
    // does not lose its addresses. Report it as a warning-level success.
    return succeed(text);
  }
}

function parseMarkupFile(buffer) {
  return succeed(stripMarkup(buffer.toString('utf8')));
}

function parseTextFile(buffer) {
  return succeed(buffer.toString('utf8'));
}

// ----------------------------------------------------------------- dispatcher

/**
 * Parse a document from disk.
 * Returns { ok, text, error, code, format, bytes, fileName }.
 */
async function parseDocument(filePath) {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const format = SUPPORTED[ext] || null;
  const base = { fileName, format, bytes: 0 };

  if (!format) {
    return {
      ...base,
      ...fail(
        `"${ext || 'no extension'}" files are not supported yet. Try exporting the document as PDF, DOCX, CSV, TXT or XLSX.`,
        'UNSUPPORTED'
      )
    };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { ...base, ...fail('The file could not be found or read.', 'MISSING') };
  }
  if (!stat.isFile()) {
    return { ...base, ...fail('This path is not a regular file.', 'MISSING') };
  }
  base.bytes = stat.size;
  if (stat.size > MAX_FILE_BYTES) {
    return {
      ...base,
      ...fail(`File is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB and was skipped.`, 'TOO_LARGE')
    };
  }
  if (stat.size === 0) {
    return { ...base, ...fail('The file is empty.', 'EMPTY') };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return { ...base, ...fail('The file could not be read (permission denied or in use).', 'IO_ERROR') };
  }

  let result;
  try {
    switch (ext) {
      case '.pdf':
        result = await parsePdf(buffer);
        break;
      case '.docx':
        result = await parseDocx(buffer);
        break;
      case '.doc':
        result = parseDoc(buffer);
        break;
      case '.xlsx':
      case '.xlsm':
      case '.xls':
        result = parseSpreadsheet(buffer);
        break;
      case '.csv':
      case '.txt':
      case '.md':
      case '.markdown':
        result = parseTextFile(buffer);
        break;
      case '.html':
      case '.htm':
      case '.xml':
        result = parseMarkupFile(buffer);
        break;
      case '.json':
        result = parseJson(buffer);
        break;
      case '.rtf':
        result = parseRtf(buffer);
        break;
      default:
        result = fail('Unsupported file type.', 'UNSUPPORTED');
    }
  } catch (err) {
    // Last-resort guard: a parser bug must never crash the application.
    result = fail('The file could not be processed. It may be corrupted or use an unsupported structure.', 'CORRUPT');
  }
  return { ...base, ...result };
}

module.exports = {
  parseDocument,
  isSupportedFile,
  supportedExtensions,
  SUPPORTED,
  MAX_FILE_BYTES,
  // exported for unit tests
  stripMarkup,
  parseRtf,
  parseJson,
  parseDoc
};
