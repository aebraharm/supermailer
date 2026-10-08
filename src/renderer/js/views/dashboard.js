/* Dashboard view */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;

  async function load() {
    const [rec, hist, live, settings] = await Promise.all([
      SM.call(window.superMailer.recipients.stats(), { silent: true }),
      SM.call(window.superMailer.history.list(), { silent: true }),
      SM.call(window.superMailer.campaign.status(), { silent: true }),
      SM.call(window.superMailer.settings.get(), { silent: true })
    ]);
    const s = settings && settings.settings;
    return {
      stats: (rec && rec.stats) || { total: 0, valid: 0, invalid: 0, duplicatesRemoved: 0, selected: 0, selectedValid: 0 },
      campaigns: (hist && hist.campaigns) || [],
      agg: (hist && hist.aggregate) || { sent: 0, successful: 0, failed: 0 },
      live: live && live.status,
      configured: !!(s && s.senderEmail && s.smtpHost)
    };
  }

  function healthCard(stats) {
    const total = stats.total || 0;
    const validPct = total ? Math.round((stats.valid / total) * 100) : 0;
    return h('div.card.flat', { style: { height: '100%' } },
      h('div.card-head', h('div', h('div.card-title', 'Recipient health'), h('div.sub', 'Share of the list that can receive mail'))),
      h('div.row', { style: { alignItems: 'center', gap: '18px' } },
        SM.ring(validPct, 84),
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div.row', { style: { justifyContent: 'space-between', marginBottom: '8px' } },
            h('span.small.soft', `${fmt.int(stats.valid)} valid`),
            h('span.small.soft', `${fmt.int(stats.invalid)} invalid`)),
          h('div.progress', h('span', { style: { width: validPct + '%' } })),
          h('div.small.muted', { style: { marginTop: '10px', lineHeight: '1.5' } },
            total
              ? `${fmt.int(stats.selectedValid)} of ${fmt.int(stats.valid)} valid recipients are selected for the next campaign.`
              : 'No recipients yet. Extract emails or import a CSV to begin.'))));
  }

  function liveCard(live) {
    const pct = live.percent || 0;
    return h('div.card.hoverable', { style: { cursor: 'pointer', borderColor: '#b9d4ff' }, onclick: () => (location.hash = '#/campaign') },
      h('div.row', { style: { marginBottom: '10px' } },
        SM.pill(live.state),
        h('strong', { style: { marginLeft: '4px' } }, live.campaignName || 'Campaign'),
        h('span.spacer'),
        h('span.small.muted', 'Open live view →')),
      h('div.progress', h('span', { style: { width: pct + '%' } })),
      h('div.row', { style: { justifyContent: 'space-between', marginTop: '8px' } },
        h('span.small.soft', `${fmt.int(live.sent + live.failed)} of ${fmt.int(live.total)} processed`),
        h('strong.small', fmt.pct(pct))));
  }

  function recentList(campaigns) {
    if (!campaigns.length) {
      return SM.emptyState({ iconName: 'history', title: 'No campaigns yet', body: 'Completed campaigns will appear here with delivery results.' });
    }
    return h('div.col', { style: { gap: '4px' } }, campaigns.slice(0, 5).map((c) =>
      h('div.recent-row', {
        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 8px', borderRadius: '12px', cursor: 'pointer', transition: 'background .2s' },
        onclick: () => (location.hash = '#/history/' + c.id),
        onmouseenter: (e) => (e.currentTarget.style.background = '#f4f8ff'),
        onmouseleave: (e) => (e.currentTarget.style.background = 'transparent')
      },
        h('div', { style: { minWidth: '0', flex: '1' } },
          h('div', { style: { fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.name),
          h('div.small.muted', `${fmt.dateShort(c.createdAt)} · ${fmt.int(c.recipientCount)} recipients`)),
        SM.pill(c.status))));
  }

  async function importRecipients() {
    const res = await SM.call(window.superMailer.recipients.importCsv());
    if (res && res.ok && !res.canceled) {
      SM.toast('success', 'Recipients imported', `${fmt.int(res.summary.added)} added · ${fmt.int(res.summary.invalid)} need review`);
      location.hash = '#/recipients';
    }
  }

  SM.route('dashboard', async () => {
    SM.setActiveNav('dashboard');
    SM.setHeader('Dashboard', 'Overview', [
      h('button.btn', { onclick: () => (location.hash = '#/settings') }, icon('settings'), 'Settings')
    ]);
    const root = SM.mount(h('div.muted', 'Loading your workspace…'));
    const { stats, agg, live, campaigns, configured } = await load();

    const sent = agg.sent + (live ? live.sent + live.failed : 0);
    const successful = agg.successful + (live ? live.sent : 0);
    const failed = agg.failed + (live ? live.failed : 0);
    const queued = live ? live.remaining : 0;

    const actions = [
      { icon: 'upload', title: 'Extract Emails', desc: 'Pull addresses from PDF, Word, Excel, CSV and more.', onclick: () => (location.hash = '#/extract') },
      { icon: 'folder', title: 'Import Recipients', desc: 'Load a CSV with email, first name and last name.', onclick: importRecipients },
      { icon: 'history', title: 'Campaign History', desc: 'Review past campaigns and per-recipient results.', onclick: () => (location.hash = '#/history') },
      { icon: 'settings', title: 'Settings', desc: 'Sender account, SMTP server and secure credentials.', onclick: () => (location.hash = '#/settings') }
    ];

    const hero = h('section.hero',
      h('div', { style: { position: 'relative', zIndex: '1' } },
        h('div.small', { style: { opacity: '0.8', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: '650' } }, 'Permission-based email'),
        h('h2', { style: { marginTop: '8px' } }, stats.total ? 'Ready when you are.' : 'Start with your audience.'),
        h('p', stats.total
          ? `${fmt.int(stats.selectedValid)} valid recipients are selected. Review them, preview your message, send a test, then launch.`
          : 'Extract addresses from documents you are authorised to use, review every recipient, then create a campaign.'),
        h('div.cta-row',
          h('button.cta-big', { onclick: () => (location.hash = '#/compose'), 'aria-label': 'Create Campaign' }, icon('pen'), 'Create Campaign'),
          h('button.btn', {
            style: { background: 'rgba(255,255,255,0.14)', color: '#fff', borderColor: 'rgba(255,255,255,0.25)', boxShadow: 'none' },
            onclick: () => (location.hash = '#/recipients')
          }, icon('users'), 'Review recipients'))));

    const setupBanner = !configured
      ? SM.alert('warning', h('div', h('strong', 'Set up your sending account first. '), 'Add a sender address and SMTP server in Settings. Your password is stored in Windows secure storage.'))
      : null;

    const statsGrid = h('div.grid.grid-2', { style: { gap: '14px' } },
      SM.statCard({ label: 'Total recipients', value: stats.total, hint: `${fmt.int(stats.selected)} selected`, tone: 'info' }),
      SM.statCard({ label: 'Valid addresses', value: stats.valid, hint: 'Ready to receive mail', tone: 'success' }),
      SM.statCard({ label: 'Invalid addresses', value: stats.invalid, hint: 'Malformed; excluded from sending', tone: stats.invalid ? 'danger' : 'neutral' }),
      SM.statCard({ label: 'Duplicates removed', value: stats.duplicatesRemoved, hint: 'Merged automatically', tone: 'neutral' }),
      SM.statCard({ label: 'Emails queued', value: queued, hint: live ? 'In the active campaign' : 'No campaign running', tone: 'info' }),
      SM.statCard({ label: 'Emails sent', value: sent, hint: 'Attempted deliveries', tone: 'info' }),
      SM.statCard({ label: 'Successful sends', value: successful, hint: 'Accepted by your SMTP server', tone: 'success' }),
      SM.statCard({ label: 'Failed sends', value: failed, hint: 'Rejected or gave up after retries', tone: failed ? 'danger' : 'neutral' }));

    const deliverNote = h('div.small.muted', { style: { lineHeight: '1.55' } },
      'Successful sends means your mail server accepted the message. Inbox placement is decided by each recipient’s provider based on sender reputation, authentication (SPF, DKIM, DMARC) and recipient engagement. Super Mailer cannot guarantee inbox placement.');

    root.replaceWith(h('div.view.col', { style: { gap: '22px' } },
      hero,
      setupBanner,
      live ? liveCard(live) : null,
      h('div.grid.grid-4', { style: { gap: '14px' } }, actions.map((a) =>
        h('button.action-card', { onclick: a.onclick },
          h('div.ico', icon(a.icon)),
          h('div', h('div.t', a.title), h('div.d', a.desc))))),
      h('div.split',
        h('div.col', statsGrid),
        h('div.col',
          healthCard(stats),
          h('div.card.flat',
            h('div.card-head', h('div', h('div.card-title', 'Recent campaigns'), h('div.sub', 'Latest five campaigns'))),
            recentList(campaigns)))),
      h('div.card.flat', { style: { background: 'linear-gradient(180deg,#fff,#f5f9ff)' } }, deliverNote)));
  });
})();
