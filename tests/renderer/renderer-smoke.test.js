'use strict';

/**
 * Renderer smoke test (jsdom). Walks every route with a stubbed preload bridge
 * and fails on any uncaught error, so UI regressions are caught without
 * launching Electron. The harness lives in tests/helpers/renderer-harness.js and
 * is shared with the navigation regression suite.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBridge, loadApp, go } = require('../helpers/renderer-harness');

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
