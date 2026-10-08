/* Review & clean recipients: search, filter, sort, select, remove, import/export */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;
  const api = () => window.superMailer.recipients;

  const state = {
    search: '',
    filter: 'all',
    sortBy: 'email',
    sortDir: 'asc',
    page: 1,
    pageSize: 100,
    data: null,
    stats: null
  };
  let root = null;
  let searchTimer = 0;

  function sortHeader(label, key, extra = '') {
    const active = state.sortBy === key;
    return h('th' + extra, {
      onclick: () => {
        if (state.sortBy === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else {
          state.sortBy = key;
          state.sortDir = 'asc';
        }
        state.page = 1;
        load();
      },
      class: active ? 'sorted' : ''
    }, label, h('span.sort', active ? (state.sortDir === 'asc' ? '▲' : '▼') : '↕'));
  }

  async function load() {
    const [list, stats] = await Promise.all([
      SM.call(api().list({ ...state }), { silent: true }),
      SM.call(api().stats(), { silent: true })
    ]);
    if (list && list.items) state.data = list;
    if (stats && stats.stats) state.stats = stats.stats;
    render();
  }

  function filterChip(id, label, count) {
    return h('button.chip' + (state.filter === id ? '.active' : ''), {
      onclick: () => {
        state.filter = id;
        state.page = 1;
        load();
      }
    }, label, h('span.n', fmt.int(count)));
  }

  function rowFor(r, pageSelectAllRef) {
    const isValid = r.status === 'valid';
    const row = h('tr', { class: (r.selected ? 'selected ' : '') + (isValid ? '' : 'is-invalid') },
      h('td', { style: { width: '44px' } },
        h('input.checkbox', {
          type: 'checkbox',
          checked: r.selected,
          disabled: !isValid,
          'aria-label': 'Select ' + r.email,
          title: isValid ? '' : 'Only valid addresses can be selected',
          onchange: async (e) => {
            const res = await SM.call(api().setSelected([r.email], e.target.checked), { silent: true });
            if (res && res.ok) load();
          }
        })),
      h('td.email', { title: r.email }, r.email),
      h('td', { style: { maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: (r.sources || []).join(', ') },
        h('span.small.soft', (r.sources && r.sources.length ? r.sources : [r.source || '—']).join(', '))),
      h('td', [r.firstName, r.lastName].filter(Boolean).join(' ') || h('span.muted', '—')),
      h('td', SM.pill(r.status), r.reason && r.status !== 'valid' ? h('div.small.muted', { style: { marginTop: '4px' } }, friendlyReason(r.reason)) : null),
      h('td.num', { style: { width: '60px' } },
        h('div.row-actions', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button.btn.sm.ghost.icon-only', {
            title: 'Remove recipient',
            'aria-label': 'Remove ' + r.email,
            onclick: async () => {
              const res = await SM.call(api().remove([r.email]));
              if (res && res.ok) {
                SM.toast('info', 'Recipient removed', r.email);
                load();
              }
            }
          }, icon('trash')))));
    return row;
  }

  function friendlyReason(reason) {
    return (
      {
        malformed: 'Malformed address',
        missing_tld: 'Missing domain extension',
        invalid_tld: 'Invalid domain extension',
        invalid_domain: 'Invalid domain',
        whitespace: 'Contains spaces',
        too_long: 'Too long',
        local_too_long: 'Local part too long',
        empty: 'Empty',
        suppressed: 'On suppression list'
      }[reason] || reason
    );
  }

  function table() {
    const data = state.data;
    if (!data || data.total === 0) {
      const hasAny = state.stats && state.stats.total > 0;
      return SM.emptyState({
        iconName: 'users',
        title: hasAny ? 'No recipients match these filters' : 'No recipients yet',
        body: hasAny
          ? 'Try a different search or filter.'
          : 'Extract addresses from your documents, or import a CSV with an "email" column.',
        action: hasAny
          ? h('button.btn', { onclick: () => { state.search = ''; state.filter = 'all'; load(); } }, 'Clear filters')
          : h('div.row', { style: { marginTop: '8px' } },
              h('button.btn.primary', { onclick: () => (location.hash = '#/extract') }, icon('upload'), 'Extract emails'),
              h('button.btn', { onclick: importCsv }, icon('folder'), 'Import CSV'))
      });
    }
    const pages = Math.max(1, Math.ceil(data.total / state.pageSize));
    const pageSelectable = data.items.filter((r) => r.status === 'valid');
    const allSelected = pageSelectable.length > 0 && pageSelectable.every((r) => r.selected);
    const someSelected = pageSelectable.some((r) => r.selected);
    const headerBox = h('input.checkbox', {
      type: 'checkbox',
      'aria-label': 'Select all on this page',
      checked: allSelected,
      onchange: async (e) => {
        await SM.call(api().setSelected(pageSelectable.map((r) => r.email), e.target.checked), { silent: true });
        load();
      }
    });
    headerBox.indeterminate = !allSelected && someSelected;

    return h('div.col', { style: { gap: '0' } },
      h('div.table-wrap',
        h('table.table',
          h('thead', h('tr',
            h('th.nosort', { style: { width: '44px' } }, headerBox),
            sortHeader('Email', 'email'),
            sortHeader('Source document', 'source'),
            sortHeader('Name', 'firstName'),
            sortHeader('Status', 'status'),
            h('th.nosort', { style: { width: '60px' } }, ''))),
          h('tbody', data.items.map((r) => rowFor(r)))),
      ),
      h('div.pager',
        h('span', `Showing ${fmt.int((data.page - 1) * data.pageSize + 1)}–${fmt.int(Math.min(data.total, data.page * data.pageSize))} of ${fmt.int(data.total)}`),
        h('span.spacer'),
        h('button.btn.sm', { disabled: data.page <= 1, onclick: () => { state.page -= 1; load(); } }, '← Previous'),
        h('span.small', `Page ${data.page} of ${pages}`),
        h('button.btn.sm', { disabled: data.page >= pages, onclick: () => { state.page += 1; load(); } }, 'Next →')));
  }

  async function importCsv() {
    const res = await SM.call(api().importCsv());
    if (res && res.ok && !res.canceled) {
      const s = res.summary;
      SM.toast('success', `Imported ${res.fileName}`, `${fmt.int(s.added)} added · ${fmt.int(s.duplicates)} duplicates · ${fmt.int(s.invalid)} invalid`);
      load();
    }
  }

  async function exportCsv(onlySelected) {
    const res = await SM.call(api().exportCsv(onlySelected));
    if (res && res.ok && !res.canceled) SM.toast('success', 'CSV exported', res.filePath);
  }

  function addManual() {
    const email = SM.h('input.input', { placeholder: 'name@company.com', type: 'email', autocomplete: 'off', 'aria-label': 'Email address' });
    const first = SM.h('input.input', { placeholder: 'First name (optional)', 'aria-label': 'First name' });
    const last = SM.h('input.input', { placeholder: 'Last name (optional)', 'aria-label': 'Last name' });
    const err = SM.h('div.small', { style: { color: 'var(--danger)', minHeight: '18px' } });
    const content = h('div.col', { style: { marginTop: '14px', gap: '12px' } },
      h('div.field', h('label', 'Email address'), email),
      h('div.grid.grid-2', { style: { gap: '12px' } },
        h('div.field', h('label', 'First name'), first),
        h('div.field', h('label', 'Last name'), last)),
      err,
      h('div.small.muted', 'Only add people who have agreed to receive your email or who have a legitimate relationship with you.'));
    SM.modal({
      title: 'Add a recipient',
      content,
      actions: [
        { id: 'cancel', label: 'Cancel' },
        {
          id: 'add',
          label: 'Add recipient',
          primary: true,
          onClick: async () => {
            const res = await SM.call(api().addManual(email.value.trim(), first.value.trim(), last.value.trim()), { silent: true });
            if (!res || !res.ok) {
              email.classList.add('invalid');
              err.textContent = (res && res.message) || 'Could not add this recipient.';
              return false;
            }
            SM.toast('success', 'Recipient added', email.value.trim());
            load();
            return true;
          }
        }
      ]
    });
    setTimeout(() => email.focus(), 80);
  }

  async function removeInvalid() {
    const n = state.stats ? state.stats.invalid : 0;
    if (!n) return SM.toast('info', 'No invalid addresses', 'Your list has nothing to clean up here.');
    const ok = await SM.confirm('Remove invalid addresses?', `This removes ${fmt.int(n)} malformed address(es) from the list. They will not be sent to in any case.`, { confirmLabel: 'Remove invalid', danger: true });
    if (!ok) return;
    const res = await SM.call(api().removeInvalid());
    if (res && res.ok) {
      SM.toast('success', 'Invalid addresses removed', `${fmt.int(res.removed)} removed.`);
      load();
    }
  }

  async function removeSelected() {
    const n = state.stats ? state.stats.selected : 0;
    if (!n) return SM.toast('info', 'Nothing selected', 'Select recipients first.');
    const ok = await SM.confirm('Remove selected recipients?', `${fmt.int(n)} selected recipient(s) will be removed from this list. Your source documents are not changed.`, { confirmLabel: 'Remove selected', danger: true });
    if (!ok) return;
    const res = await SM.call(api().removeSelected());
    if (res && res.ok) {
      SM.toast('success', 'Removed', `${fmt.int(res.removed)} recipients removed.`);
      load();
    }
  }

  async function clearAll() {
    const n = state.stats ? state.stats.total : 0;
    if (!n) return;
    const ok = await SM.confirm('Clear the entire list?', `All ${fmt.int(n)} recipients will be removed. This cannot be undone.`, { confirmLabel: 'Clear list', danger: true });
    if (!ok) return;
    await SM.call(api().clearAll());
    SM.toast('success', 'Recipient list cleared');
    load();
  }

  SM.route('recipients', async () => {
    SM.setActiveNav('recipients');
    SM.setHeader('Recipients', 'Review & clean', [
      h('button.btn.primary', {
        onclick: () => {
          if (!state.stats || state.stats.selectedValid === 0) {
            SM.toast('warning', 'No recipients selected', 'Select at least one valid recipient to continue.');
            return;
          }
          location.hash = '#/compose';
        }
      }, icon('pen'), 'Continue to Campaign')
    ]);
    root = SM.mount(h('div.col', { style: { gap: '18px' } }, h('div.muted', 'Loading recipients…'))).firstElementChild;
    // Live updates from other parts of the app (extraction, import); released on navigation.
    SM.listen('recipients:changed', (stats) => {
      state.stats = stats;
      if (root && root.isConnected) load();
    });
    await load();
  });

  function render() {
    if (!root || !root.isConnected || !state.stats) return;
    const s = state.stats;
    SM.clear(root);
    const chips = h('div.row', { style: { flexWrap: 'wrap', gap: '8px' } },
      filterChip('all', 'All', s.total),
      filterChip('valid', 'Valid', s.valid),
      filterChip('invalid', 'Invalid', s.invalid),
      filterChip('suppressed', 'Suppressed', s.suppressed || 0),
      filterChip('selected', 'Selected', s.selected));

    const search = h('div.search', { style: { minWidth: '260px', flex: '1' } }, icon('search'),
      h('input.input', {
        type: 'search',
        placeholder: 'Search email, name or source…',
        value: state.search,
        'aria-label': 'Search recipients',
        oninput: (e) => {
          clearTimeout(searchTimer);
          const v = e.target.value;
          searchTimer = setTimeout(() => {
            state.search = v;
            state.page = 1;
            load();
          }, 180);
        }
      }));

    const sortSel = h('select.select', {
      style: { width: '210px' },
      'aria-label': 'Sort by',
      onchange: (e) => {
        const [by, dir] = e.target.value.split(':');
        state.sortBy = by;
        state.sortDir = dir;
        load();
      }
    },
      ['email:asc', 'email:desc', 'status:asc', 'source:asc', 'firstName:asc'].map((v) => {
        const labels = { 'email:asc': 'Email A → Z', 'email:desc': 'Email Z → A', 'status:asc': 'Status', 'source:asc': 'Source document', 'firstName:asc': 'First name' };
        return h('option', { value: v, selected: state.sortBy + ':' + state.sortDir === v }, labels[v]);
      }));

    const selectionBar = h('div.card.flat', { style: { padding: '14px 16px' } },
      h('div.row', { style: { flexWrap: 'wrap', gap: '10px' } },
        h('div', h('strong', fmt.int(s.selectedValid)), h('span.muted', ` of ${fmt.int(s.valid)} valid recipients selected`)),
        h('span.spacer'),
        h('button.btn.sm', { onclick: async () => { const r = await SM.call(api().selectAll('valid')); if (r && r.ok) { SM.toast('success', 'All valid recipients selected', `${fmt.int(r.changed)} newly selected.`); load(); } } }, icon('check'), 'Select all valid'),
        h('button.btn.sm', { onclick: async () => { await SM.call(api().clearSelection()); load(); } }, 'Deselect all'),
        h('button.btn.sm', { onclick: removeSelected, disabled: !s.selected }, icon('trash'), 'Remove selected'),
        h('button.btn.sm.warn', { onclick: removeInvalid, disabled: !s.invalid }, 'Remove invalid')));

    const actions = h('div.row', { style: { flexWrap: 'wrap', gap: '8px' } },
      h('button.btn', { onclick: addManual }, icon('plus'), 'Add recipient'),
      h('button.btn', { onclick: importCsv }, icon('folder'), 'Import CSV'),
      h('button.btn', { onclick: () => exportCsv(false) }, icon('download'), 'Export CSV'),
      h('button.btn.ghost', { onclick: () => exportCsv(true), disabled: !s.selected }, 'Export selected'),
      h('span.spacer'),
      h('button.btn.ghost.danger', { onclick: clearAll, disabled: !s.total }, 'Clear list'));

    const explainer = s.invalid || s.duplicatesRemoved
      ? SM.alert('info', h('div',
          s.duplicatesRemoved ? `${fmt.int(s.duplicatesRemoved)} duplicate address(es) were merged. ` : '',
          s.invalid ? `${fmt.int(s.invalid)} address(es) look malformed and are excluded from sending until you fix or remove them.` : ''))
      : null;

    root.append(
      h('div.page-head', h('div', h('h1', 'Review recipients'), h('div.sub', 'Nothing is sent from this screen. Only selected valid recipients join a campaign, and you confirm the count before anything is sent.'))),
      h('div.grid.grid-4', { style: { gap: '12px' } },
        SM.statCard({ label: 'Unique recipients', value: s.total, tone: 'info' }),
        SM.statCard({ label: 'Valid', value: s.valid, tone: 'success' }),
        SM.statCard({ label: 'Invalid', value: s.invalid, tone: s.invalid ? 'danger' : 'neutral' }),
        SM.statCard({ label: 'Selected', value: s.selected, tone: 'info' })),
      explainer,
      h('div.card', { style: { padding: '16px' } },
        h('div.row', { style: { flexWrap: 'wrap', gap: '12px', marginBottom: '14px' } }, search, sortSel),
        h('div.row', { style: { marginBottom: '14px', flexWrap: 'wrap', gap: '8px' } }, chips),
        selectionBar,
        h('div', { style: { height: '14px' } }),
        table(),
        h('div', { style: { height: '14px' } }),
        actions));
  }

})();
