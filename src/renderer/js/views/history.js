/* Campaign history: list of past campaigns and per-campaign results */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;
  const api = () => window.superMailer;

  function rateOf(c) {
    const processed = c.sentCount || 0;
    return processed ? Math.round(((c.successfulCount || 0) / processed) * 100) : 0;
  }

  async function renderList() {
    SM.setActiveNav('history');
    SM.setHeader('Campaign History', 'Records', [
      h('button.btn.primary', { onclick: () => (location.hash = '#/compose') }, icon('pen'), 'New campaign')
    ]);
    const view = SM.mount(h('div.col', { style: { gap: '18px' } })).firstElementChild;
    const res = await SM.call(api().history.list(), { silent: true });
    const list = (res && res.campaigns) || [];
    const agg = (res && res.aggregate) || { campaigns: 0, successful: 0, failed: 0, sent: 0 };

    if (!list.length) {
      view.append(SM.emptyState({
        iconName: 'history',
        title: 'No campaigns yet',
        body: 'Every campaign you send is saved here with its delivery results, so you always know what went out and what failed.',
        action: h('button.btn.primary', { onclick: () => (location.hash = '#/compose') }, icon('pen'), 'Create your first campaign')
      }));
      return;
    }

    view.append(
      h('div.grid.grid-4', { style: { gap: '12px' } },
        SM.statCard({ label: 'Campaigns sent', value: agg.campaigns, tone: 'info' }),
        SM.statCard({ label: 'Accepted by server', value: agg.successful, tone: 'success' }),
        SM.statCard({ label: 'Failed', value: agg.failed, tone: agg.failed ? 'danger' : 'neutral' }),
        SM.statCard({ label: 'Acceptance rate', value: agg.sent ? Math.round((agg.successful / agg.sent) * 100) : 0, hint: 'Accepted ÷ attempted', tone: 'info' })),
      h('div.card.flat', { style: { padding: '0', overflow: 'hidden' } },
        h('div.table-wrap', { style: { border: 'none', borderRadius: '0', maxHeight: 'none' } },
          h('table.table',
            h('thead', h('tr',
              h('th', 'Campaign'),
              h('th', 'Date & time'),
              h('th.num', 'Recipients'),
              h('th.num', 'Sent'),
              h('th.num', 'Failed'),
              h('th', 'Duration'),
              h('th', 'Status'))),
            h('tbody', list.map((c) =>
              h('tr', {
                style: { cursor: 'pointer' },
                tabindex: '0',
                onclick: () => (location.hash = '#/history/' + c.id),
                onkeydown: (e) => { if (e.key === 'Enter') location.hash = '#/history/' + c.id; }
              },
                h('td', h('div', { style: { fontWeight: '600' } }, c.name), h('div.small.muted', `${fmt.int(rateOf(c))}% accepted`)),
                h('td.nowrap', fmt.date(c.startedAt || c.createdAt)),
                h('td.num', fmt.int(c.recipientCount)),
                h('td.num', fmt.int(c.successfulCount)),
                h('td.num', { style: { color: c.failedCount ? 'var(--danger)' : 'inherit' } }, fmt.int(c.failedCount)),
                h('td.nowrap', c.durationMs ? fmt.duration(c.durationMs) : '—'),
                h('td', SM.pill(c.status))))))),
      ));
  }

  async function renderDetail(id) {
    SM.setActiveNav('history');
    SM.setHeader('Campaign details', 'Campaign History', [
      h('button.btn', { onclick: () => (location.hash = '#/history') }, icon('history'), 'All campaigns')
    ]);
    const view = SM.mount(h('div.col', { style: { gap: '18px' } })).firstElementChild;
    const res = await SM.call(api().history.get(id), { silent: true });
    if (!res || !res.ok) {
      view.append(SM.emptyState({ iconName: 'alert', title: 'Campaign not found', body: 'It may have been deleted.',
        action: h('button.btn', { onclick: () => (location.hash = '#/history') }, 'Back to history') }));
      return;
    }
    const c = res.campaign;
    let filter = 'all';
    let query = '';
    const resultsHost = h('div');

    const drawResults = () => {
      SM.clear(resultsHost);
      const rows = (c.results || []).filter((r) => (filter === 'all' || r.status === filter) && (!query || r.email.includes(query)));
      resultsHost.append(
        h('div.table-wrap', { style: { maxHeight: '420px' } },
          h('table.table',
            h('thead', h('tr', h('th', 'Recipient'), h('th', 'Result'), h('th.num', 'Attempts'), h('th', 'Details'), h('th', 'Time'))),
            h('tbody', rows.length ? rows.map((r) =>
              h('tr',
                h('td.email', r.email),
                h('td', SM.pill(r.status === 'sent' ? 'sent' : r.status === 'failed' ? 'failed' : 'neutral'), ' ',
                  h('span.small.muted', r.status === 'sent' ? 'Accepted' : r.status === 'failed' ? (r.kind === 'permanent' ? 'Rejected' : 'Gave up') : r.status)),
                h('td.num', r.attempts || 0),
                h('td.small.soft', { style: { maxWidth: '340px' } }, r.error || (r.messageId ? 'Server message ID recorded' : '')),
                h('td.nowrap.small.muted', r.at ? new Date(r.at).toLocaleTimeString() : '—')))
              : [h('tr', h('td.empty-cell', { colspan: '5' }, 'No results match this filter.'))])))
        ,
        c.resultsTotal > (c.results || []).length
          ? h('div.small.muted', { style: { marginTop: '10px' } }, `Showing the first ${fmt.int(c.results.length)} of ${fmt.int(c.resultsTotal)} results.`)
          : null);
    };

    const filterChips = [['all', 'All'], ['sent', 'Accepted'], ['failed', 'Failed']].map(([id, label]) =>
      h('button.chip' + (filter === id ? '.active' : ''), {
        onclick: (e) => {
          filter = id;
          e.currentTarget.parentNode.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
          drawResults();
        }
      }, label));

    const notAccepted = c.status === 'failed' || c.status === 'cancelled';
    view.append(
      h('div.card.campaign-hero',
        h('div.row', { style: { flexWrap: 'wrap', gap: '12px' } },
          h('h2', c.name), SM.pill(c.status), h('span.spacer'),
          h('button.btn.danger.sm', {
            onclick: async () => {
              const ok = await SM.confirm('Delete this campaign record?', 'The delivery results for this campaign will be removed from history. Emails that were already sent are not affected.', { confirmLabel: 'Delete record', danger: true });
              if (!ok) return;
              const r = await SM.call(api().history.remove(c.id));
              if (r && r.ok) {
                SM.toast('success', 'Campaign record deleted');
                location.hash = '#/history';
              }
            }
          }, icon('trash'), 'Delete record')),
        h('div.grid.grid-4', { style: { marginTop: '18px', gap: '12px' } },
          SM.statCard({ label: 'Recipients', value: c.recipientCount, tone: 'info' }),
          SM.statCard({ label: 'Sent (processed)', value: c.sentCount, tone: 'info' }),
          SM.statCard({ label: 'Accepted by server', value: c.successfulCount, tone: 'success' }),
          SM.statCard({ label: 'Failed', value: c.failedCount, tone: c.failedCount ? 'danger' : 'neutral' }))),
      notAccepted && c.error ? SM.alert('warning', c.error) : (c.error ? SM.alert('info', c.error) : null),
      h('div.split',
        h('div.card.flat',
          h('div.card-head', h('div.card-title', 'Campaign details')),
          h('dl.kv',
            h('dt', 'Started'), h('dd', fmt.date(c.startedAt || c.createdAt)),
            h('dt', 'Finished'), h('dd', fmt.date(c.finishedAt)),
            h('dt', 'Duration'), h('dd', c.durationMs ? fmt.duration(c.durationMs) : '—'),
            h('dt', 'Skipped'), h('dd', fmt.int(c.skippedCount || 0) + ' (suppressed, invalid or duplicate)'),
            h('dt', 'Success rate'), h('dd', rateOf(c) + '% of attempted messages were accepted'))),
        h('div.card.flat',
          h('div.card-head', h('div', h('div.card-title', 'What “accepted” means'))),
          h('p.small.soft', { style: { lineHeight: '1.6' } },
            'Accepted means your mail server took responsibility for delivery. Inbox placement, spam filtering and any later bounces are decided by the recipient’s provider. Bounces that arrive after acceptance are not tracked by this version; check your sending account’s bounce reports.'))),
      h('div.card',
        h('div.row', { style: { flexWrap: 'wrap', gap: '10px', marginBottom: '14px' } },
          h('div.card-title', 'Per-recipient results'), h('span.spacer'),
          h('div.row', { style: { gap: '6px' } }, filterChips),
          h('div.search', { style: { width: '240px' } }, icon('search'),
            h('input.input', { type: 'search', placeholder: 'Filter by email…', oninput: (e) => { query = e.target.value.trim().toLowerCase(); drawResults(); } }))),
        resultsHost));
    drawResults();
  }

  SM.route('history', (id) => (id ? renderDetail(id) : renderList()));

})();
