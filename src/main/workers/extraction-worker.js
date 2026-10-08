'use strict';

/**
 * Worker thread: parses ONE document at a time and returns only the extracted
 * email records. Raw document text never leaves the worker, which keeps
 * imported content private and keeps the main/UI thread free.
 */

const { parentPort } = require('worker_threads');
const { parseDocument } = require('../modules/document-parser');
const { buildRecipientRecords } = require('../modules/email-utils');

parentPort.on('message', async (msg) => {
  if (!msg || msg.type !== 'parse') return;
  const { id, filePath } = msg;
  try {
    const parsed = await parseDocument(filePath);
    if (!parsed.ok) {
      parentPort.postMessage({
        id,
        ok: false,
        fileName: parsed.fileName,
        format: parsed.format,
        error: parsed.error,
        code: parsed.code
      });
      return;
    }
    const records = buildRecipientRecords(parsed.text, parsed.fileName);
    parentPort.postMessage({
      id,
      ok: true,
      fileName: parsed.fileName,
      format: parsed.format,
      bytes: parsed.bytes,
      records,
      // Count raw matches so the summary can report duplicates precisely.
      emailsFound: records.length
    });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      fileName: require('path').basename(filePath),
      error: 'Unexpected error while processing this file.',
      code: 'WORKER_ERROR'
    });
  }
});
