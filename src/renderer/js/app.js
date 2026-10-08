/* Super Mailer — bootstrap, splash sequencing, hash router, global badges */
(function () {
  'use strict';
  const SM = window.SM;
  const ROUTES = ['dashboard', 'extract', 'recipients', 'compose', 'campaign', 'history', 'settings'];
  const TITLES = {
    dashboard: 'Dashboard',
    extract: 'Extract Emails',
    recipients: 'Recipients',
    compose: 'Create Campaign',
    campaign: 'Live Campaign',
    history: 'Campaign History',
    settings: 'Settings'
  };

  function parseHash() {
    const m = /^#\/([a-z]+)(?:\/(.+))?$/i.exec(location.hash || '');
    const name = m ? m[1].toLowerCase() : 'dashboard';
    return {
      name: ROUTES.includes(name) ? name : 'dashboard',
      param: m && m[2] ? decodeURIComponent(m[2]) : null
    };
  }

  async function navigate() {
    SM.releaseSubs();
    const { name, param } = parseHash();
    if (!SM.routes[name]) return;
    try {
      await SM.routes[name](param);
    } catch (err) {
      console.error(err);
      SM.toast('error', 'Could not open this page', 'Please try again. Details were written to the log.');
    }
    if (!SM.routes[name] || (location.hash && !location.hash.startsWith('#/' + name))) return;
    document.getElementById('crumb').dataset.route = name;
    document.title = 'Super Mailer — ' + (TITLES[name] || '');
  }

  function setStatus(text) {
    const el = document.getElementById('splash-status');
    if (el) el.textContent = text;
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Global listeners live for the whole session (not released per route). */
  function wireGlobalBadges() {
    const api = window.superMailer;
    api.on('recipients:changed', (stats) => {
      SM.setBadge('nav-recipients', stats.total > 0 ? stats.total : null);
    });
    api.on('campaign:started', () => SM.setBadge('nav-live', 'LIVE', true));
    api.on('campaign:progress', (p) => {
      const live = p.state === 'running' || p.state === 'paused';
      SM.setBadge('nav-live', live ? (p.state === 'paused' ? 'PAUSED' : 'LIVE') : null, live && p.state === 'running');
    });
    api.on('campaign:finished', () => SM.setBadge('nav-live', null));
  }

  async function boot() {
    const api = window.superMailer;
    if (!api) {
      setStatus('Preload bridge unavailable. Please restart Super Mailer.');
      return;
    }
    const started = Date.now();
    setStatus('Loading your workspace…');
    const [info, settings, rec] = await Promise.all([
      SM.call(api.app.info(), { silent: true }),
      SM.call(api.settings.get(), { silent: true }),
      SM.call(api.recipients.stats(), { silent: true })
    ]);
    setStatus('Checking secure storage…');
    if (info && info.version) {
      const meta = document.querySelector('.brand .by');
      if (meta) meta.textContent = 'created by aebraharm · v' + info.version;
    }
    if (settings && settings.ok && settings.secureStorage === false) {
      SM.toast('warning', 'Secure storage unavailable', 'Sending is disabled until Windows secure storage is available.');
    }
    if (rec && rec.stats) SM.setBadge('nav-recipients', rec.stats.total > 0 ? rec.stats.total : null);

    setStatus('Preparing dashboard…');
    wireGlobalBadges();
    const live = await SM.call(api.campaign.status(), { silent: true });
    if (live && live.status) SM.setBadge('nav-live', live.status.state === 'paused' ? 'PAUSED' : 'LIVE', live.status.state === 'running');

    if (!location.hash) location.hash = '#/dashboard';
    await navigate();

    // Keep the splash visible long enough for the brand moment, but never block for long.
    const remaining = Math.max(0, 1100 - (Date.now() - started));
    await delay(remaining);
    document.getElementById('splash').classList.add('leaving');
    document.getElementById('app').classList.add('ready');
    setTimeout(() => {
      const splash = document.getElementById('splash');
      if (splash) splash.remove();
    }, 700);
  }

  window.addEventListener('hashchange', navigate);
  window.addEventListener('error', (e) => {
    // Never let an unexpected UI error leave the user stuck on a blank screen.
    if (SM && SM.toast) SM.toast('error', 'Something unexpected happened', 'The app kept running. Try the action again.');
    console.error(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (SM && SM.toast) SM.toast('error', 'Something unexpected happened', 'The app kept running. Try the action again.');
    console.error(e.reason);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
})();
