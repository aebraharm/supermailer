'use strict';

/**
 * Minimal, dependency-free CSV parser/serializer (RFC 4180 style).
 * Handles quoted fields, escaped quotes (""), commas and newlines inside
 * quoted fields, and both LF and CRLF line endings.
 */

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Flush trailing field/row when the file does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}

function escapeCell(cell) {
  const s = cell === null || cell === undefined ? '' : String(cell);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function stringifyCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

/** Parse CSV text into an array of objects keyed by the header row. */
function csvToObjects(text) {
  const rows = parseCsv(String(text || ''));
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => String(h).trim());
  const objects = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (row.length === 1 && row[0] === '') continue; // skip blank lines
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] !== undefined ? row[idx] : '';
    });
    objects.push(obj);
  }
  return objects;
}

/** Serialize an array of flat objects into CSV text using the given columns. */
function objectsToCsv(objects, columns) {
  const header = columns.map((c) => c.header || c.key);
  const rows = [header];
  for (const obj of objects) {
    rows.push(columns.map((c) => (obj[c.key] === undefined || obj[c.key] === null ? '' : obj[c.key])));
  }
  return stringifyCsv(rows);
}

module.exports = { parseCsv, stringifyCsv, csvToObjects, objectsToCsv };
