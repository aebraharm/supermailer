'use strict';

/**
 * jsdom harness for the renderer. Loads the REAL index.html and the real
 * renderer scripts with a stubbed preload bridge that returns realistic data,
 * so UI behaviour can be asserted without launching Electron.
 *
 * Bridge values may be functions: returning a promise that resolves later makes
 * a route slow, which is how the navigation race tests are written.
 */

const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');

function makeBridge(overrides = {}) {
  const calls = [];
  /** Live IPC subscriptions, so tests can emit events at a running renderer. */
  const subs = [];
  const data = {
    'app.info': { name: 'Super Mailer', version: '1.0.0', author: 'aebraharm' },
    'settings.get': {
      ok: true,
      settings: { senderName: 'Acme', senderEmail: 'sales@acme.test', replyTo: '', smtpHost: 'smtp.acme.test', smtpPort: 587, encryption: 'starttls', smtpUser: 'sales@acme.test', sendingRatePerMinute: 30, maxRetries: 3, retryDelaySeconds: [10, 30, 90], connectionTimeoutSec: 30, verifyTls: true, listUnsubscribe: '' },
      hasSecret: true,
      secureStorage: true
    },
    'recipients.stats': { ok: true, stats: { total: 3, valid: 2, invalid: 1, suppressed: 0, selected: 2, selectedValid: 2, duplicatesRemoved: 1, imports: 0, extractions: 1 } },
    'recipients.list': {
      total: 3,
      page: 1,
      pageSize: 100,
      items: [
        { email: 'ann@example.com', status: 'valid', selected: true, sources: ['people.txt'], source: 'people.txt', firstName: 'Ann', lastName: '', reason: null },
        { email: 'ben@example.com', status: 'valid', selected: true, sources: ['a.csv'], source: 'a.csv', firstName: '', lastName: '', reason: null },
        { email: 'broken@domain', status: 'invalid', selected: false, sources: ['a.csv'], source: 'a.csv', firstName: '', lastName: '', reason: 'missing_tld' }
      ]
    },
    'compose.preview': { ok: true, preview: { from: 'Acme <sales@acme.test>', to: 'jane.doe@example.com', subject: 'Hello Jane', html: '<p>Hi Jane</p>', text: 'Hi Jane' } },
    'compose.preflight': { ok: true, errors: [], warnings: [], stats: { selected: 2, eligible: 2 }, count: 2 },
    'campaign.status': { ok: true, status: null },
    'history.list': {
      ok: true,
      campaigns: [
        { id: 'c1', name: 'October Newsletter', createdAt: Date.now() - 86400000, startedAt: Date.now() - 86400000, finishedAt: Date.now(), durationMs: 65000, recipientCount: 2, sentCount: 2, successfulCount: 2, failedCount: 0, skippedCount: 0, status: 'completed', error: null }
      ],
      aggregate: { campaigns: 1, successful: 2, failed: 0, sent: 2, recipients: 2 }
    },
    'history.get': {
      ok: true,
      campaign: { id: 'c1', name: 'October Newsletter', status: 'completed', createdAt: Date.now(), startedAt: Date.now(), finishedAt: Date.now(), durationMs: 65000, recipientCount: 2, sentCount: 2, successfulCount: 2, failedCount: 0, skippedCount: 0, error: null, results: [{ email: 'ann@example.com', status: 'sent', attempts: 1, at: Date.now() }, { email: 'ben@example.com', status: 'failed', kind: 'permanent', attempts: 1, error: 'rejected', at: Date.now() }], resultsTotal: 2 }
    },
    'suppression.list': { ok: true, items: [{ email: 'gone@example.com', reason: 'permanent_failure', at: Date.now() }] },
    'settings.update': { ok: true, settings: {}, hasSecret: true },
    'recipients.setSelected': { ok: true, changed: 1 }
  };
  Object.assign(data, overrides);

  const handlerFor = (key) => (...args) => {
    calls.push({ key, args });
    if (key in data) {
      const v = data[key];
      return Promise.resolve(typeof v === 'function' ? v(...args) : v);
    }
    return Promise.resolve({ ok: true });
  };
  const api = {
    calls,
    app: { info: handlerFor('app.info') },
    settings: { get: handlerFor('settings.get'), update: handlerFor('settings.update'), clearPassword: handlerFor('settings.clear'), testConnection: handlerFor('settings.testConnection') },
    documents: { pick: handlerFor('documents.pick'), pathsFromFiles: async () => [], approvePaths: handlerFor('documents.approve'), extract: handlerFor('documents.extract'), cancel: handlerFor('documents.cancel') },
    recipients: {
      list: handlerFor('recipients.list'),
      stats: handlerFor('recipients.stats'),
      setSelected: handlerFor('recipients.setSelected'),
      selectAll: handlerFor('recipients.selectAll'),
      clearSelection: handlerFor('recipients.clearSelection'),
      remove: handlerFor('recipients.remove'),
      removeSelected: handlerFor('recipients.removeSelected'),
      removeInvalid: handlerFor('recipients.removeInvalid'),
      addManual: handlerFor('recipients.addManual'),
      importCsv: handlerFor('recipients.importCsv'),
      exportCsv: handlerFor('recipients.exportCsv'),
      clearAll: handlerFor('recipients.clearAll')
    },
    compose: { preview: handlerFor('compose.preview'), sendTest: handlerFor('compose.sendTest'), preflight: handlerFor('compose.preflight') },
    campaign: { start: handlerFor('campaign.start'), pause: handlerFor('campaign.pause'), resume: handlerFor('campaign.resume'), cancel: handlerFor('campaign.cancel'), status: handlerFor('campaign.status') },
    history: { list: handlerFor('history.list'), get: handlerFor('history.get'), remove: handlerFor('history.remove') },
    suppression: { list: handlerFor('suppression.list'), remove: handlerFor('suppression.remove'), add: handlerFor('suppression.add') },
    on: (channel, fn) => {
      const sub = { channel, fn };
      subs.push(sub);
      return () => {
        const i = subs.indexOf(sub);
        if (i !== -1) subs.splice(i, 1);
      };
    }
  };
  /** Deliver an event to every live subscriber of `channel`. */
  api.emit = (channel, payload) => {
    subs.filter((s) => s.channel === channel).forEach((s) => s.fn(payload));
  };
  api.subscriptions = () => subs.filter((s) => s.channel).map((s) => s.channel);
  return api;
}

async function loadApp({ bridge, hash = '#/dashboard' }) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [];
  const pageErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => pageErrors.push(e));
  vc.on('error', (e) => pageErrors.push(new Error(String(e))));

  // Inline the local scripts so jsdom needs no file loader.
  const inlined = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    scripts.push(src);
    return `<script>${fs.readFileSync(path.join(ROOT, src), 'utf8')}</script>`;
  });

  const dom = new JSDOM(inlined, {
    url: 'https://app.local/index.html' + hash,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.superMailer = bridge;
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.prompt = () => null;
      window.document.execCommand = () => true;
    }
  });
  await waitFor(() => dom.window.document.getElementById('splash') === null || dom.window.document.getElementById('app').classList.contains('ready'), 6000, dom);
  return { dom, window: dom.window, document: dom.window.document, pageErrors, scripts };
}

async function waitFor(pred, timeout, dom) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred()) return true;
    await new Promise((r) => dom.window.setTimeout(r, 25));
  }
  return false;
}

async function go(ctx, hash) {
  ctx.window.location.hash = hash;
  await new Promise((r) => ctx.window.setTimeout(r, 120));
  await waitFor(() => ctx.document.querySelector('#view .view') !== null, 2000, ctx.dom);
  await new Promise((r) => ctx.window.setTimeout(r, 60));
}

/** Wait a fixed number of milliseconds in page time (for settling races). */
const settle = (ctx, ms = 250) => new Promise((r) => ctx.window.setTimeout(r, ms));

module.exports = { ROOT, makeBridge, loadApp, waitFor, go, settle };
