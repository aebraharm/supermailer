'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, BrowserWindow } = require('electron');
const { PathGuard } = require('./path-guard');
const { str, strArray, int, sanitizeDraft } = require('./validators');
const { validateEmail, normalizeEmail } = require('../modules/email-utils');
const { SMTP_SECRET_NAME } = require('../modules/campaign-manager');

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * Registers every IPC channel the renderer may call. Each handler validates
 * its input and returns plain JSON-serializable objects. Errors are returned
 * as { ok:false, message } instead of thrown across the bridge.
 */
function registerHandlers({ services, window, dialog, pathGuard = new PathGuard(), app }) {
  const { settings, credentials, recipients, campaigns, extraction, history, suppression, logger } = services;

  const safe = (fn) => async (event, payload) => {
    try {
      return await fn(payload || {});
    } catch (err) {
      logger.error('IPC handler failed', { message: err && err.message });
      return { ok: false, message: 'Something went wrong. Please try again. Details were written to the log.' };
    }
  };
  const handle = (channel, fn) => ipcMain.handle(channel, safe(fn));
  // Always target the current window (it can be recreated after 'activate').
  const send = (channel, data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, data);
    }
  };

  // ------------------------------------------------------------ app / settings
  handle('app:info', () => ({
    name: 'Super Mailer',
    version: app.getVersion(),
    author: 'aebraharm',
    platform: process.platform
  }));

  handle('settings:get', () => ({
    ok: true,
    settings: settings.getPublic(),
    hasSecret: credentials.hasCredential(SMTP_SECRET_NAME),
    secureStorage: true
  }));

  handle('settings:update', ({ patch, password, clearPassword }) => {
    const clean = patch && typeof patch === 'object' ? patch : {};
    if ('senderEmail' in clean && clean.senderEmail && !validateEmail(normalizeEmail(clean.senderEmail)).valid) {
      return { ok: false, message: 'The sender email address is not valid.' };
    }
    if ('replyTo' in clean && clean.replyTo && !validateEmail(normalizeEmail(clean.replyTo)).valid) {
      return { ok: false, message: 'The Reply-To address is not valid.' };
    }
    const updated = settings.update({
      ...clean,
      senderEmail: 'senderEmail' in clean ? normalizeEmail(clean.senderEmail) : undefined,
      replyTo: 'replyTo' in clean ? normalizeEmail(clean.replyTo) : undefined
    });
    // The password is handled separately and never returned to the renderer.
    if (typeof password === 'string' && password.length > 0) {
      credentials.storeCredential(SMTP_SECRET_NAME, password.slice(0, 1000));
      logger.info('SMTP credential updated (value not logged)');
    }
    if (clearPassword === true) credentials.deleteCredential(SMTP_SECRET_NAME);
    return { ok: true, settings: updated, hasSecret: credentials.hasCredential(SMTP_SECRET_NAME) };
  });

  handle('settings:testConnection', async ({ patch, password }) => {
    const overrides = patch && typeof patch === 'object' ? { ...patch } : {};
    if (typeof password === 'string' && password.length > 0) overrides.secret = password.slice(0, 1000);
    const result = await campaigns.testConnection(overrides);
    return { ok: result.ok, message: result.message, kind: result.kind || null };
  });

  // ------------------------------------------------------------ documents
  handle('documents:pick', async ({ mode }) => {
    const properties = mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'];
    const result = await dialog.showOpenDialog(window, {
      title: mode === 'folder' ? 'Choose a folder of documents' : 'Choose documents',
      properties,
      filters:
        mode === 'folder'
          ? undefined
          : [
              {
                name: 'Documents',
                extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'txt', 'md', 'markdown', 'html', 'htm', 'xml', 'json', 'rtf']
              },
              { name: 'All files', extensions: ['*'] }
            ]
    });
    if (result.canceled) return { ok: true, paths: [] };
    pathGuard.approveAll(result.filePaths);
    return { ok: true, paths: result.filePaths };
  });

  handle('documents:approveDropped', ({ paths }) => {
    const list = strArray(paths, 5000, 4096);
    pathGuard.approveAll(list);
    return { ok: true, count: list.length };
  });

  handle('documents:extract', async ({ paths }) => {
    if (extraction.current) return { ok: false, message: 'An extraction is already running. Please wait for it to finish.' };
    const approved = pathGuard.filter(strArray(paths, 5000, 4096));
    if (approved.length === 0) {
      return { ok: false, message: 'No documents were selected. Choose files or a folder first.' };
    }
    send('extraction:status', { state: 'running', total: 0 });
    const summary = await extraction.run(approved, {
      onProgress: (p) => send('extraction:progress', p)
    });
    const ingest = recipients.ingest(
      summary.records.map((r) => ({
        email: r.email,
        source: r.source,
        status: r.status,
        reason: r.reason
      })),
      { kind: 'extract' }
    );
    const result = {
      ok: true,
      documentsFound: summary.documentsFound,
      documentsProcessed: summary.documentsProcessed,
      documentsFailed: summary.documentsFailed,
      emailsFound: summary.emailsFound,
      uniqueEmails: summary.records.length,
      uniqueValid: summary.uniqueValid,
      invalidAddresses: summary.invalidAddresses,
      duplicatesRemoved: summary.duplicatesRemoved,
      addedToList: ingest.added,
      failures: summary.failures.slice(0, 200),
      skipped: summary.skipped.slice(0, 200),
      cancelled: summary.cancelled,
      durationMs: summary.durationMs
    };
    logger.info('Extraction finished', {
      documents: summary.documentsProcessed,
      failed: summary.documentsFailed,
      unique: summary.records.length
    });
    send('extraction:status', { state: 'done' });
    return result;
  });

  handle('documents:cancel', () => {
    extraction.cancel();
    return { ok: true };
  });

  // ------------------------------------------------------------ recipients
  handle('recipients:list', (q) =>
    recipients.list({
      search: str(q.search, 200),
      filter: str(q.filter, 20, 'all'),
      sortBy: ['email', 'status', 'source', 'firstName', 'lastName'].includes(q.sortBy) ? q.sortBy : 'email',
      sortDir: q.sortDir === 'desc' ? 'desc' : 'asc',
      page: int(q.page, 1, 100000, 1),
      pageSize: int(q.pageSize, 10, 500, 100)
    })
  );

  handle('recipients:stats', () => ({ ok: true, stats: recipients.stats() }));

  handle('recipients:setSelected', ({ emails, selected }) => ({
    ok: true,
    changed: recipients.setSelected(strArray(emails), selected === true)
  }));

  handle('recipients:selectAll', ({ filter }) => ({
    ok: true,
    changed: recipients.selectAllMatching(str(filter, 20, 'all'))
  }));

  handle('recipients:clearSelection', () => ({ ok: true, changed: recipients.clearSelection() }));

  handle('recipients:remove', ({ emails }) => ({ ok: true, removed: recipients.remove(strArray(emails)) }));

  handle('recipients:removeSelected', () => ({ ok: true, removed: recipients.removeSelected() }));

  handle('recipients:removeInvalid', () => ({ ok: true, removed: recipients.removeInvalid() }));

  handle('recipients:addManual', ({ email, firstName, lastName }) => {
    const res = recipients.addManual(str(email, 320), { firstName: str(firstName, 100), lastName: str(lastName, 100) });
    return res.ok ? { ok: true, message: 'Recipient added.' } : { ok: false, message: res.message };
  });

  handle('recipients:importCsv', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Import recipients from CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true };
    const file = result.filePaths[0];
    const stat = fs.statSync(file);
    if (stat.size > MAX_IMPORT_BYTES) return { ok: false, message: 'This CSV is larger than 20 MB. Split it into smaller files.' };
    try {
      const summary = recipients.importCsvText(fs.readFileSync(file, 'utf8'));
      return { ok: true, summary, fileName: path.basename(file) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  handle('recipients:exportCsv', async ({ onlySelected }) => {
    const result = await dialog.showSaveDialog(window, {
      title: 'Export recipients',
      defaultPath: `super-mailer-recipients-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(result.filePath, '\uFEFF' + recipients.toCsv({ onlySelected: onlySelected === true }), 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  handle('recipients:clearAll', () => {
    recipients.clear();
    return { ok: true };
  });

  // ------------------------------------------------------------ composer
  handle('compose:preview', (p) => ({ ok: true, preview: campaigns.preview(sanitizeDraft(p.draft)) }));

  handle('compose:sendTest', async ({ draft, to }) => {
    const res = await campaigns.sendTest(sanitizeDraft(draft), str(to, 320));
    return res;
  });

  handle('compose:preflight', ({ draft }) => {
    const selected = recipients.getSelectedValid();
    const check = campaigns.preflight(sanitizeDraft(draft), selected);
    return { ok: check.ok, errors: check.errors, warnings: check.warnings, stats: check.stats, count: selected.length };
  });

  // ------------------------------------------------------------ campaign
  handle('campaign:start', ({ draft, confirmedCount }) => {
    const selected = recipients.getSelectedValid();
    const res = campaigns.start(sanitizeDraft(draft), selected, int(confirmedCount, 0, 1000000, -1));
    return res;
  });

  handle('campaign:pause', () => ({ ok: campaigns.pause() }));
  handle('campaign:resume', () => ({ ok: campaigns.resume() }));
  handle('campaign:cancel', () => ({ ok: campaigns.cancel() }));
  handle('campaign:status', () => ({ ok: true, status: campaigns.status() }));

  // ------------------------------------------------------------ history / suppression
  handle('history:list', () => ({
    ok: true,
    campaigns: history.list().map(summarizeCampaign),
    aggregate: history.aggregateStats()
  }));

  handle('history:get', ({ id }) => {
    const c = history.get(str(id, 100));
    if (!c) return { ok: false, message: 'That campaign could not be found.' };
    return { ok: true, campaign: { ...summarizeCampaign(c), results: c.results.slice(0, 1000), resultsTotal: c.results.length } };
  });

  handle('history:remove', ({ id }) => ({ ok: history.remove(str(id, 100)) }));

  handle('suppression:list', () => ({ ok: true, items: suppression.list() }));
  handle('suppression:remove', ({ emails }) => ({ ok: true, removed: suppression.remove(strArray(emails)) }));
  handle('suppression:add', ({ emails }) => ({ ok: true, added: suppression.add(strArray(emails), 'unsubscribed') }));

  // ------------------------------------------------------------ live events
  campaigns.on('progress', (p) => send('campaign:progress', p));
  campaigns.on('paused', (p) => send('campaign:paused', p));
  campaigns.on('finished', (p) => send('campaign:finished', p));
  campaigns.on('alert', (p) => send('campaign:alert', p));
  campaigns.on('started', (p) => send('campaign:started', p));
  recipients.on('change', (stats) => send('recipients:changed', stats));
  history.on('change', () => send('history:changed', {}));

  return () => {
    for (const ch of [
      'app:info', 'settings:get', 'settings:update', 'settings:testConnection', 'documents:pick',
      'documents:approveDropped', 'documents:extract', 'documents:cancel', 'recipients:list', 'recipients:stats',
      'recipients:setSelected', 'recipients:selectAll', 'recipients:clearSelection', 'recipients:remove',
      'recipients:removeSelected', 'recipients:removeInvalid', 'recipients:addManual', 'recipients:importCsv',
      'recipients:exportCsv', 'recipients:clearAll', 'compose:preview', 'compose:sendTest', 'compose:preflight',
      'campaign:start', 'campaign:pause', 'campaign:resume', 'campaign:cancel', 'campaign:status',
      'history:list', 'history:get', 'history:remove', 'suppression:list', 'suppression:remove', 'suppression:add'
    ]) {
      ipcMain.removeHandler(ch);
    }
  };
}

function summarizeCampaign(c) {
  return {
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    durationMs: c.durationMs,
    recipientCount: c.recipientCount,
    sentCount: c.sentCount,
    successfulCount: c.successfulCount,
    failedCount: c.failedCount,
    skippedCount: c.skippedCount || 0,
    status: c.status,
    error: c.error || null
  };
}

module.exports = { registerHandlers };
