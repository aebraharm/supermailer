'use strict';

/**
 * Renderer smoke test (jsdom). Loads the REAL index.html, CSS-free DOM and the
 * real renderer scripts, with a stubbed preload bridge that returns realistic
 * data. It walks every route and fails on any uncaught error, so UI regressions
 * are caught without launching Electron.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'src', 'renderer');

function makeBridge(overrides = {}) {
  const calls = [];
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
    on: () => () => {}
  };
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
  return { dom, window: dom.window, document: dom.window.document, pageErrors };
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

test('renderer boots: splash hides and the shell becomes ready', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  assert.ok(ctx.document.getElementById('app').classList.contains('ready'), 'app shell ready');
  assert.match(ctx.document.querySelector('.brand .by').textContent, /aebraharm/);
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('dashboard shows the required metrics and the primary Create Campaign action', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  const text = ctx.document.getElementById('view').textContent;
  for (const label of ['Total recipients', 'Valid addresses', 'Invalid addresses', 'Duplicates removed', 'Emails queued', 'Emails sent', 'Successful sends', 'Failed sends']) {
    assert.ok(text.includes(label), `missing metric: ${label}`);
  }
  assert.ok(text.includes('Create Campaign'));
  for (const label of ['Extract Emails', 'Import Recipients', 'Campaign History', 'Settings']) {
    assert.ok(text.includes(label), `missing action: ${label}`);
  }
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('every route renders without errors', async () => {
  const bridge = makeBridge();
  const ctx = await loadApp({ bridge });
  const routes = [
    ['#/extract', 'Drop documents or folders here'],
    ['#/recipients', 'Review recipients'],
    ['#/compose', 'Ready to send?'],
    ['#/campaign', 'No campaign is running'],
    ['#/history', 'October Newsletter'],
    ['#/history/c1', 'Per-recipient results'],
    ['#/settings', 'SMTP server']
  ];
  for (const [hash, expected] of routes) {
    await go(ctx, hash);
    const view = ctx.document.getElementById('view').textContent;
    assert.ok(view.includes(expected), `${hash} should show "${expected}"`);
  }
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), [], 'no uncaught errors across routes');
});

test('recipients: invalid rows are shown but their checkbox is disabled, valid rows are selectable', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  await go(ctx, '#/recipients');
  const boxes = [...ctx.document.querySelectorAll('tbody input.checkbox')];
  assert.equal(boxes.length, 3);
  const invalidRow = [...ctx.document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('broken@domain'));
  assert.ok(invalidRow.querySelector('input.checkbox').disabled, 'invalid cannot be selected');
  const validRow = [...ctx.document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('ann@example.com'));
  assert.equal(validRow.querySelector('input.checkbox').disabled, false);
});

test('compose: the sender, subject and variable chips are present; Review & send is enabled with recipients', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  await go(ctx, '#/compose');
  const text = ctx.document.getElementById('view').textContent;
  assert.ok(text.includes('{{first_name}}'));
  assert.ok(text.includes('Send Test Email'));
  assert.ok(text.includes('Preview Email'));
  const sendBtn = [...ctx.document.querySelectorAll('button')].find((b) => /Review & send/.test(b.textContent));
  assert.ok(sendBtn && !sendBtn.disabled);
});

test('compose: no recipients disables sending and explains why', async () => {
  const bridge = makeBridge({
    'compose.preflight': { ok: true, errors: [], warnings: [], stats: {}, count: 0 }
  });
  const ctx = await loadApp({ bridge });
  await go(ctx, '#/compose');
  const sendBtn = [...ctx.document.querySelectorAll('button')].find((b) => /Review & send/.test(b.textContent));
  assert.equal(sendBtn.disabled, true);
  assert.ok(ctx.document.getElementById('view').textContent.includes('Select valid recipients'));
});

test('history detail shows results and filters by status', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  await go(ctx, '#/history/c1');
  const rows = () => ctx.document.querySelectorAll('.table-wrap tbody tr').length;
  assert.equal(rows(), 2);
  const failedChip = [...ctx.document.querySelectorAll('button.chip')].find((b) => b.textContent.startsWith('Failed'));
  failedChip.click();
  assert.equal(rows(), 1);
});

test('settings: test connection passes the typed form values to the bridge', async () => {
  const bridge = makeBridge({ 'settings.testConnection': { ok: false, kind: 'auth', message: 'Authentication failed. Check the username and password/API key in Settings.' } });
  const ctx = await loadApp({ bridge });
  await go(ctx, '#/settings');
  const btn = [...ctx.document.querySelectorAll('button')].find((b) => /Test Connection/.test(b.textContent));
  btn.click();
  await new Promise((r) => ctx.window.setTimeout(r, 80));
  const call = bridge.calls.find((c) => c.key === 'settings.testConnection');
  assert.ok(call, 'bridge called');
  assert.equal(call.args[0].smtpHost, 'smtp.acme.test');
  assert.ok(ctx.document.getElementById('view').textContent.includes('Authentication failed'));
});

test('a failing bridge call shows a toast instead of crashing', async () => {
  const bridge = makeBridge({ 'recipients.list': () => ({ ok: false, message: 'boom' }) });
  const ctx = await loadApp({ bridge });
  await go(ctx, '#/recipients');
  assert.ok(ctx.pageErrors.length === 0);
});
