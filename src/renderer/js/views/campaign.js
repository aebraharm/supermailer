/* Live campaign progress: real-time stats, pause / resume / cancel */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;
  const api = () => window.superMailer;

  let root = null;
  let current = null; // latest progress snapshot
  let meta = null; // { campaignName, perMinute, startedAt }
  let refs = {};
  let lastFinished = null;
  let startedAtLocal = null;

  function stat(label, key, tone) {
    const value = h('div.v', { 'data-key': key }, '0');
    refs[key] = value;
    return h('div.stat-mini', { style: { borderLeft: '4px solid ' + toneColor(tone) } },
      h('div.k', label), value);
  }

  function toneColor(t) {
    return { success: 'var(--success)', danger: 'var(--danger)', info: 'var(--blue-500)', neutral: 'var(--ink-muted)' }[t] || 'var(--blue-500)';
  }

  function buildShell() {
    refs = {};
    refs.title = h('h2', 'Campaign');
    refs.state = h('span.pill.neutral', '—');
    refs.percent = h('div.big-progress', '0%');
    refs.bar = h('span', { style: { width: '0%' } });
    refs.progress = h('div.progress.thick', refs.bar);
    refs.eta = h('div.small.muted', '');
    refs.reason = h('div');
    refs.controls = h('div.row', { style: { flexWrap: 'wrap', gap: '10px' } });

    const card = h('div.card.campaign-hero', { style: { background: 'linear-gradient(180deg,#ffffff,#f5f9ff)' } },
      h('div.row', { style: { flexWrap: 'wrap', gap: '12px', marginBottom: '6px' } },
        refs.title, refs.state, h('span.spacer'), refs.controls),
      h('div.row', { style: { alignItems: 'flex-end', gap: '18px', marginTop: '14px' } },
        refs.percent,
        h('div', { style: { flex: '1', minWidth: '0', paddingBottom: '10px' } }, refs.progress, h('div.row', { style: { justifyContent: 'space-between', marginTop: '8px' } }, refs.eta, h('span.small.muted', 'Updated live')))),
      refs.reason);

    const stats = h('div.grid.grid-4', { style: { gap: '14px' } },
      stat('Sent (processed)', 'sent', 'info'),
      stat('Remaining', 'remaining', 'neutral'),
      stat('Successful', 'successful', 'success'),
      stat('Failed', 'failed', 'danger'));

    const details = h('div.card.flat',
      h('div.card-head', h('div', h('div.card-title', 'How delivery works'), h('div.sub', 'Read this before you judge the numbers'))),
      h('ul.insights.small', { style: { paddingLeft: '18px', margin: 0 } },
        h('li', 'Successful means your SMTP server accepted the message for delivery. It does not guarantee inbox placement.'),
        h('li', 'Temporary failures are retried automatically with increasing delays. Permanent rejections are not retried and the address is added to the suppression list.'),
        h('li', 'Pausing lets in-flight messages finish. Resume continues from the next recipient, so nobody receives the email twice.'),
        h('li', 'Results are saved to Campaign History as they arrive.')));

    refs.extra = h('div.col', { style: { gap: '14px' } });
    return h('div.col', { style: { gap: '18px' } }, card, stats, refs.extra, details);
  }

  function renderControls(state) {
    SM.clear(refs.controls);
    const running = state === 'running';
    const paused = state === 'paused';
    const active = running || paused;
    refs.controls.append(
      paused
        ? h('button.btn.success', { onclick: resume }, icon('play'), 'Resume')
        : h('button.btn', { disabled: !running, onclick: pause }, icon('pause'), 'Pause'),
      h('button.btn.danger', { disabled: !active, onclick: cancel }, icon('stop'), 'Cancel')
    );
  }

  function apply(p) {
    if (!refs.percent) return;
    current = p;
    const pct = Math.max(0, Math.min(100, p.percent || 0));
    refs.percent.textContent = fmt.pct(pct);
    refs.bar.style.width = pct + '%';
    refs.progress.classList.toggle('success', p.state === 'finished');
    refs.title.textContent = p.campaignName || (meta && meta.campaignName) || 'Campaign';
    const pill = SM.pill(p.state);
    refs.state.replaceWith(pill);
    refs.state = pill;
    SM.animateNumber(refs.sent, p.sent + p.failed);
    SM.animateNumber(refs.remaining, p.remaining);
    SM.animateNumber(refs.successful, p.sent);
    SM.animateNumber(refs.failed, p.failed);
    renderControls(p.state);

    // ETA from the configured rate.
    const perMinute = meta && meta.perMinute ? meta.perMinute : 30;
    const etaMs = p.remaining > 0 ? (p.remaining / perMinute) * 60000 : 0;
    refs.eta.textContent =
      p.state === 'running'
        ? `${fmt.int(p.sent + p.failed)} of ${fmt.int(p.total)} processed · about ${fmt.eta(etaMs)} left at ${perMinute}/min`
        : `${fmt.int(p.sent + p.failed)} of ${fmt.int(p.total)} processed`;

    SM.clear(refs.reason);
    if (p.state === 'paused' && p.pauseReason) {
      refs.reason.append(SM.alert('warning', h('div', h('strong', 'Paused. '), p.pauseReason)));
    }
    if (p.retries && p.state !== 'finished') {
      refs.reason.append(h('div.small.muted', { style: { marginTop: '10px' } }, `${fmt.int(p.retries)} retry attempt(s) so far.`));
    }
  }

  async function pause() {
    const res = await SM.call(api().campaign.pause());
    if (res && res.ok) SM.toast('info', 'Campaign paused', 'In-flight messages will finish first.');
  }
  async function resume() {
    const res = await SM.call(api().campaign.resume());
    if (res && res.ok) SM.toast('success', 'Campaign resumed');
  }
  async function cancel() {
    const ok = await SM.confirm(
      'Cancel this campaign?',
      'Remaining recipients will not receive this email. Messages already accepted by the server cannot be recalled.',
      { confirmLabel: 'Cancel campaign', danger: true }
    );
    if (!ok) return;
    const res = await SM.call(api().campaign.cancel());
    if (res && res.ok) SM.toast('warning', 'Campaign cancelled');
  }

  function finishedCard(evt) {
    const p = evt.progress || {};
    const tone = evt.status === 'completed' ? 'success' : evt.status === 'cancelled' ? 'neutral' : 'warning';
    return SM.alert(tone === 'success' ? 'success' : 'info', h('div',
      h('strong', { style: { display: 'block', marginBottom: '4px' } },
        evt.status === 'completed' ? 'Campaign complete' : `Campaign ${SM.statusLabel(evt.status).toLowerCase()}`),
      `${fmt.int(p.sent || 0)} accepted by the server, ${fmt.int(p.failed || 0)} failed, ${fmt.int(p.skipped || 0)} skipped. `,
      h('a', { href: '#/history/' + evt.campaignId, style: { fontWeight: '650', color: 'inherit' } }, 'View delivery results →')));
  }

  function render(status) {
    if (!root || !root.isConnected) return;
    SM.clear(root);
    if (!status && !lastFinished) {
      root.append(SM.emptyState({
        iconName: 'send',
        title: 'No campaign is running',
        body: 'When you start a campaign, live progress, pause, resume and cancel controls appear here.',
        action: h('div.row', { style: { marginTop: '10px' } },
          h('button.btn.primary', { onclick: () => (location.hash = '#/compose') }, icon('pen'), 'Create Campaign'),
          h('button.btn', { onclick: () => (location.hash = '#/history') }, icon('history'), 'View history'))
      }));
      return;
    }
    refs = {};
    const shell = buildShell();
    root.append(shell);
    if (lastFinished && !status) {
      refs.extra.append(finishedCard(lastFinished));
      refs.title.textContent = lastFinished.campaignName || 'Campaign';
      refs.state = SM.pill(lastFinished.status);
      SM.clear(refs.controls);
      refs.percent.textContent = fmt.pct(100);
      refs.bar.style.width = '100%';
      refs.eta.textContent = 'Finished';
      refs.controls.append(h('button.btn', { onclick: () => (location.hash = '#/compose') }, icon('pen'), 'New campaign'));
      return;
    }
    apply(status);
  }

  SM.route('campaign', async () => {
    SM.setActiveNav('campaign');
    SM.setHeader('Live Campaign', 'Sending', []);
    root = SM.mount(h('div.col', { style: { gap: '18px' } })).firstElementChild;
    const status = await SM.call(api().campaign.status(), { silent: true });
    const s = status && status.status;
    if (s) {
      meta = { campaignName: s.campaignName, perMinute: s.perMinute || 30 };
      if (!s.perMinute) {
        const settings = await SM.call(api().settings.get(), { silent: true });
        if (settings && settings.settings) meta.perMinute = settings.settings.sendingRatePerMinute;
      }
    }
    lastFinished = null;
    render(s || null);

    SM.listen('campaign:started', async (evt) => {
      lastFinished = null;
      const settings = await SM.call(api().settings.get(), { silent: true });
      meta = { campaignName: evt.campaignName || '', perMinute: settings && settings.settings ? settings.settings.sendingRatePerMinute : 30 };
      startedAtLocal = Date.now();
      setLiveBadge(true);
      const st = await SM.call(api().campaign.status(), { silent: true });
      render(st && st.status);
    });
    SM.listen('campaign:progress', (p) => {
      if (!refs.percent || !root || !root.isConnected) return;
      if (!meta) meta = { campaignName: p.campaignName, perMinute: 30 };
      if (!meta.campaignName && p.campaignName) meta.campaignName = p.campaignName;
      setLiveBadge(p.state === 'running' || p.state === 'paused');
      apply(p);
    });
    SM.listen('campaign:paused', () => {
      /* state is carried by campaign:progress */
    });
    SM.listen('campaign:alert', (a) => {
      if (a.kind === 'auth') SM.toast('error', 'Sign-in failed', a.message);
    });
    SM.listen('campaign:finished', (evt) => {
      lastFinished = evt;
      setLiveBadge(false);
      SM.toast(evt.status === 'completed' ? 'success' : 'info', 'Campaign ' + SM.statusLabel(evt.status).toLowerCase(),
        `${fmt.int(evt.progress.sent)} accepted · ${fmt.int(evt.progress.failed)} failed`);
      render(null);
    });
  });

  function setLiveBadge(live) {
    SM.setBadge('nav-live', live ? 'LIVE' : null, true);
  }
})();
