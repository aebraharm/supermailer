'use strict';

/**
 * Navigation regression suite (jsdom).
 *
 * Covers the bug where clicking menu items could leave several feature pages in
 * #view at once, and where a slow page could paint over the page the user had
 * already navigated to. Every assertion here is about navigation only: no test
 * starts, cancels or otherwise mutates a campaign.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBridge, loadApp, go, settle, waitFor } = require('../helpers/renderer-harness');

/** The seven sidebar entries, with text unique to each page. */
const MENU = [
  ['dashboard', 'Total recipients'],
  ['extract', 'Drop documents or folders here'],
  ['recipients', 'Review recipients'],
  ['compose', 'Ready to send?'],
  ['campaign', 'No campaign is running'],
  ['history', 'October Newsletter'],
  ['settings', 'SMTP server']
];

/**
 * Bridge methods that change data or send mail. Navigating must never call one.
 * (Read-only calls such as recipients.stats or campaign.status are expected.)
 */
const DESTRUCTIVE = [
  'campaign.start', 'campaign.cancel', 'campaign.pause', 'campaign.resume',
  'recipients.clearAll', 'recipients.clearSelection', 'recipients.remove',
  'recipients.removeSelected', 'recipients.removeInvalid', 'recipients.importCsv',
  'recipients.addManual', 'recipients.exportCsv', 'recipients.setSelected',
  'documents.extract', 'documents.cancel', 'documents.approve',
  'history.remove', 'suppression.remove', 'suppression.add',
  'settings.update', 'settings.clear', 'compose.sendTest'
];

const views = (doc) => doc.querySelectorAll('#view > .view');
const viewText = (doc) => doc.getElementById('view').textContent;
const routeOf = (doc) => (views(doc)[0] ? views(doc)[0].getAttribute('data-route') : null);
const navLink = (doc, name) => doc.querySelector(`#nav a[data-route="${name}"]`);
const called = (bridge, key) => bridge.calls.filter((c) => c.key === key);

/** Returns a bridge value that resolves after `ms`, skipping the first `skip` calls. */
function slow(value, ms, skip = 0) {
  let n = 0;
  return () => {
    n += 1;
    if (n <= skip) return Promise.resolve(value);
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
  };
}

const STATS = { ok: true, stats: { total: 3, valid: 2, invalid: 1, suppressed: 0, selected: 2, selectedValid: 2, duplicatesRemoved: 1, imports: 0, extractions: 1 } };

test('menu: every item opens exactly one page, highlighted with aria-current', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  const doc = ctx.document;

  for (const [name, expected] of MENU) {
    navLink(doc, name).click();
    await waitFor(() => viewText(doc).includes(expected), 3000, ctx.dom);
    await settle(ctx, 120);

    assert.equal(views(doc).length, 1, `${name}: #view must hold exactly one page`);
    assert.ok(viewText(doc).includes(expected), `${name}: page content missing`);

    assert.ok(navLink(doc, name).classList.contains('active'), `${name}: menu item highlighted`);
    assert.equal(navLink(doc, name).getAttribute('aria-current'), 'page', `${name}: aria-current="page"`);
    assert.equal(
      doc.querySelectorAll('#nav a[aria-current]').length, 1,
      `${name}: exactly one menu item may be current`
    );
    assert.equal(doc.querySelectorAll('#nav a.active').length, 1, `${name}: exactly one active item`);
    assert.equal(routeOf(doc), name, `${name}: the mounted page must be the selected one`);
    assert.match(doc.title, new RegExp(name === 'compose' ? 'Create Campaign' : name[0].toUpperCase() + name.slice(1)));
  }
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), [], 'no uncaught errors');
});

test('menu: rapid clicks never leave more than one page in #view', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  const doc = ctx.document;

  // Fire the whole sequence without waiting for any page to finish loading.
  for (const [name] of MENU) navLink(doc, name).click();
  await settle(ctx, 900);

  assert.equal(views(doc).length, 1, 'rapid clicks must not stack pages');
  assert.equal(routeOf(doc), 'settings', 'the last item clicked must win');
  assert.ok(viewText(doc).includes('SMTP server'));
  assert.equal(navLink(doc, 'settings').getAttribute('aria-current'), 'page');

  // Nothing may appear late, after the dust has settled.
  await settle(ctx, 600);
  assert.equal(views(doc).length, 1, 'no page may appear after settling');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('mount: the previous view is removed synchronously, not on a timer', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  const { SM } = ctx.window;
  const doc = ctx.document;

  SM.beginNav('settings');
  SM.mount(doc.createElement('div'));
  SM.beginNav('history');
  SM.mount(doc.createElement('div'));
  SM.beginNav('compose');
  SM.mount(doc.createElement('div'));

  // Checked immediately: a deferred removal would still show three views here.
  assert.equal(views(doc).length, 1, 'mount must replace the previous view at once');
  assert.equal(routeOf(doc), 'compose');
  ctx.window.close();
});

test('race: a slow page cannot paint over the page navigated to next', async () => {
  const bridge = makeBridge({ 'history.list': slow({ ok: true, campaigns: [], aggregate: {} }, 350) });
  const ctx = await loadApp({ bridge });
  const doc = ctx.document;

  ctx.window.location.hash = '#/history';
  await settle(ctx, 60); // history is still awaiting its list
  ctx.window.location.hash = '#/settings';
  await settle(ctx, 900); // long enough for the slow history load to resolve

  assert.equal(views(doc).length, 1, 'the slow page must not stack onto #view');
  assert.equal(routeOf(doc), 'settings', 'the selected page must be the one shown');
  assert.ok(viewText(doc).includes('SMTP server'));
  assert.ok(!viewText(doc).includes('No campaigns yet'), 'the abandoned page must not render');
  assert.equal(doc.title, 'Super Mailer — Settings');
  assert.equal(navLink(doc, 'settings').getAttribute('aria-current'), 'page');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('race: an abandoned composer does not render or call the bridge', async () => {
  // recipients.stats is slow for the composer, so it is still loading when we leave.
  const bridge = makeBridge({ 'recipients.stats': slow(STATS, 350, 1) });
  const ctx = await loadApp({ bridge });
  const doc = ctx.document;

  ctx.window.location.hash = '#/compose';
  await settle(ctx, 60);
  ctx.window.location.hash = '#/dashboard';
  await settle(ctx, 900);

  assert.equal(views(doc).length, 1);
  assert.equal(routeOf(doc), 'dashboard');
  assert.ok(!viewText(doc).includes('Ready to send?'), 'composer must not appear after navigating away');
  // The stale continuation is what would have issued these.
  assert.equal(called(bridge, 'compose.preview').length, 0, 'no preview for an abandoned composer');
  assert.equal(called(bridge, 'compose.preflight').length, 0, 'no preflight for an abandoned composer');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('race: an abandoned live-campaign page cannot subscribe or change the view', async () => {
  const bridge = makeBridge({ 'campaign.status': slow({ ok: true, status: null }, 350) });
  const ctx = await loadApp({ bridge });
  const doc = ctx.document;

  ctx.window.location.hash = '#/campaign';
  await settle(ctx, 60); // campaign subscribes only after its status resolves
  ctx.window.location.hash = '#/dashboard';
  await settle(ctx, 900);

  // campaign:paused and campaign:alert are registered by the campaign view only.
  const leaked = bridge.subscriptions().filter((c) => c === 'campaign:paused' || c === 'campaign:alert');
  assert.deepEqual(leaked, [], 'an abandoned campaign view must not keep subscriptions');

  const before = viewText(doc);
  bridge.emit('campaign:progress', { state: 'running', campaignName: 'Leak', sent: 5, failed: 0, total: 10, remaining: 5, percent: 50 });
  bridge.emit('campaign:paused', {});
  await settle(ctx, 200);

  assert.equal(viewText(doc), before, 'a stale campaign view must not redraw the page');
  assert.equal(views(doc).length, 1);
  assert.equal(routeOf(doc), 'dashboard');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('nested: history list, detail and back keep one page with history selected', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  const doc = ctx.document;

  await go(ctx, '#/history');
  assert.equal(routeOf(doc), 'history');
  assert.ok(viewText(doc).includes('October Newsletter'));

  const row = [...doc.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('October Newsletter'));
  row.click();
  await waitFor(() => viewText(doc).includes('Per-recipient results'), 3000, ctx.dom);
  await settle(ctx, 120);

  assert.equal(ctx.window.location.hash, '#/history/c1');
  assert.equal(views(doc).length, 1, 'the list must be replaced by the detail page');
  assert.ok(viewText(doc).includes('Per-recipient results'));
  assert.ok(!viewText(doc).includes('Acceptance rate'), 'the list page must be gone');
  assert.equal(navLink(doc, 'history').getAttribute('aria-current'), 'page', 'nested page keeps its menu item');
  assert.equal(routeOf(doc), 'history', 'the detail page is mounted under the history route');

  navLink(doc, 'history').click();
  await waitFor(() => viewText(doc).includes('Acceptance rate'), 3000, ctx.dom);
  await settle(ctx, 120);
  assert.equal(views(doc).length, 1);
  assert.ok(viewText(doc).includes('Acceptance rate'));
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('direct link: opening a nested URL renders that page alone', async () => {
  const ctx = await loadApp({ bridge: makeBridge(), hash: '#/history/c1' });
  const doc = ctx.document;
  await waitFor(() => viewText(doc).includes('Per-recipient results'), 4000, ctx.dom);

  assert.equal(views(doc).length, 1);
  assert.ok(viewText(doc).includes('Per-recipient results'));
  assert.equal(navLink(doc, 'history').getAttribute('aria-current'), 'page');
  assert.equal(doc.title, 'Super Mailer — Campaign History');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('direct link: an unknown route falls back to the dashboard', async () => {
  const ctx = await loadApp({ bridge: makeBridge(), hash: '#/nope' });
  const doc = ctx.document;
  await waitFor(() => viewText(doc).includes('Total recipients'), 4000, ctx.dom);
  assert.equal(views(doc).length, 1);
  assert.equal(navLink(doc, 'dashboard').getAttribute('aria-current'), 'page');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('draft: the email draft survives navigating away and back', async () => {
  const ctx = await loadApp({ bridge: makeBridge() });
  const doc = ctx.document;

  await go(ctx, '#/compose');
  const subject = () => [...doc.querySelectorAll('#view input')].find((i) => /first_name/.test(i.placeholder || ''));
  assert.ok(subject(), 'subject field present');

  subject().value = 'My October Draft';
  subject().dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  await settle(ctx, 150);

  await go(ctx, '#/settings');
  assert.ok(viewText(doc).includes('SMTP server'), 'settings page opened');
  assert.equal(routeOf(doc), 'settings');
  await go(ctx, '#/compose');

  assert.equal(views(doc).length, 1, 'the composer must replace the settings page');
  assert.equal(subject().value, 'My October Draft', 'navigation must not discard the draft');
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('selection: recipient selection survives navigating away and back', async () => {
  const bridge = makeBridge();
  const ctx = await loadApp({ bridge });
  const doc = ctx.document;

  await go(ctx, '#/recipients');
  const boxes = () => [...doc.querySelectorAll('tbody input.checkbox')];
  assert.equal(boxes().length, 3);
  assert.deepEqual(boxes().map((b) => b.checked), [true, true, false]);

  const enabled = boxes().find((b) => !b.disabled);
  assert.ok(enabled, 'a selectable recipient exists');
  enabled.click(); // toggling is a deliberate user action, not navigation
  await settle(ctx, 250);
  assert.equal(called(bridge, 'recipients.setSelected').length, 1, 'selection changes still reach the bridge');

  await go(ctx, '#/dashboard');
  await go(ctx, '#/recipients');

  assert.deepEqual(boxes().map((b) => b.checked), [true, true, false], 'selection is re-read from the store');
  assert.equal(views(doc).length, 1);
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});

test('error: a failing page shows an error state instead of the previous page', async () => {
  // A malformed history response makes the history route throw while rendering.
  const bridge = makeBridge({ 'history.list': { ok: true, campaigns: 'not-an-array' } });
  const ctx = await loadApp({ bridge });
  const doc = ctx.document;

  await go(ctx, '#/settings');
  assert.ok(viewText(doc).includes('SMTP server'));

  ctx.window.location.hash = '#/history';
  await waitFor(() => /could not be opened/i.test(viewText(doc)), 3000, ctx.dom);
  await settle(ctx, 150);

  assert.equal(views(doc).length, 1, 'the error state replaces the page, it does not stack');
  assert.ok(viewText(doc).includes('This page could not be opened'));
  assert.ok(viewText(doc).includes('Nothing was changed'), 'error state reassures nothing was sent');
  assert.ok(!viewText(doc).includes('SMTP server'), 'the previous page must be gone');
  assert.equal(routeOf(doc), 'history');
  assert.equal(navLink(doc, 'history').getAttribute('aria-current'), 'page');
  assert.equal(doc.title, 'Super Mailer — Campaign History');
  assert.ok(doc.getElementById('toasts').textContent.includes('Could not open this page'));

  // The app is still usable afterwards. (The dashboard also reads the campaign
  // list, so recovery is asserted on a page that does not.)
  await go(ctx, '#/settings');
  await waitFor(() => viewText(doc).includes('SMTP server'), 3000, ctx.dom);
  assert.equal(views(doc).length, 1);
  assert.equal(routeOf(doc), 'settings');
  assert.ok(!viewText(doc).includes('This page could not be opened'), 'recovered page replaces the error state');
  assert.equal(navLink(doc, 'settings').getAttribute('aria-current'), 'page');
});

test('safety: navigation never calls a destructive bridge method', async () => {
  const bridge = makeBridge();
  const ctx = await loadApp({ bridge });
  const doc = ctx.document;

  for (const [name] of MENU) navLink(doc, name).click(); // rapid pass
  await settle(ctx, 700);
  for (const [name] of MENU) { // deliberate pass
    navLink(doc, name).click();
    await settle(ctx, 160);
  }
  await go(ctx, '#/history/c1'); // nested navigation
  await go(ctx, '#/history');
  await settle(ctx, 300);

  const fired = bridge.calls.filter((c) => DESTRUCTIVE.includes(c.key)).map((c) => c.key);
  assert.deepEqual(fired, [], 'navigation must not start, cancel or delete anything');
  assert.equal(views(doc).length, 1);
  assert.deepEqual(ctx.pageErrors.map((e) => e.message), []);
});
