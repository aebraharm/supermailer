/* Extract Emails view: select / drag-and-drop documents, extract, summarize */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;

  const FORMATS = ['PDF', 'DOCX', 'DOC', 'XLSX', 'XLS', 'CSV', 'TXT', 'HTML', 'XML', 'JSON', 'MD', 'RTF'];

  const state = {
    paths: [],
    running: false,
    progress: null,
    summary: null
  };
  let body = null; // mounted container for this view
  let frame = 0;

  function extOf(p) {
    const m = /\.([^.\\/]+)$/.exec(p);
    return m ? m[1].toUpperCase() : 'DIR';
  }
  function nameOf(p) {
    return p.split(/[\\/]/).filter(Boolean).pop() || p;
  }

  /** Re-render the view (throttled to one frame when called repeatedly). */
  function render() {
    if (!body || !body.isConnected) return;
    SM.clear(body);
    body.append(
      dropzone(),
      state.running ? progressCard() : null,
      selectedList(),
      state.summary ? summaryCard(state.summary) : null,
      h('div.split', formatsCard(), howItWorksCard())
    );
  }
  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function addPaths(list) {
    const seen = new Set(state.paths);
    let added = 0;
    for (const p of list) {
      if (!seen.has(p)) {
        seen.add(p);
        state.paths.push(p);
        added += 1;
      }
    }
    return added;
  }

  async function pickFiles() {
    const res = await SM.call(window.superMailer.documents.pick('files'));
    if (res && res.ok && res.paths && res.paths.length) {
      const n = addPaths(res.paths);
      SM.toast('info', 'Documents added', `${fmt.plural(n, 'document')} added to the list.`);
      render();
    }
  }

  async function pickFolder() {
    const res = await SM.call(window.superMailer.documents.pick('folder'));
    if (res && res.ok && res.paths && res.paths.length) {
      addPaths(res.paths);
      SM.toast('info', 'Folder added', 'Supported documents inside it (including subfolders) will be read.');
      render();
    }
  }

  async function handleDrop(fileList) {
    const paths = await window.superMailer.documents.pathsFromFiles(fileList);
    if (!paths.length) {
      SM.toast('warning', 'Nothing to add', 'Those items could not be read as local files.');
      return;
    }
    const n = addPaths(paths);
    SM.toast('success', 'Added by drag and drop', `${fmt.plural(n, 'item')} ready for extraction.`);
    render();
  }

  async function runExtraction() {
    if (!state.paths.length || state.running) return;
    state.running = true;
    state.summary = null;
    state.progress = { done: 0, total: state.paths.length, current: '' };
    render();
    const res = await SM.call(window.superMailer.documents.extract(state.paths));
    state.running = false;
    state.progress = null;
    if (res && res.ok) {
      state.summary = res;
      SM.toast(
        res.documentsFailed ? 'warning' : 'success',
        'Extraction complete',
        `${fmt.int(res.uniqueEmails)} unique addresses · ${fmt.int(res.addedToList)} new in your list`
      );
    } else {
      SM.toast('error', 'Extraction did not finish', res && res.message);
    }
    render();
  }

  async function cancel() {
    await window.superMailer.documents.cancel();
    SM.toast('info', 'Stopping after the current document…');
  }

  function dropzone() {
    const zone = h('div.dropzone', {
      role: 'button',
      tabindex: '0',
      'aria-label': 'Drop documents here or click to choose files',
      onclick: (e) => {
        if (!e.target.closest('button')) pickFiles();
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickFiles();
        }
      },
      ondragover: (e) => {
        e.preventDefault();
        zone.classList.add('over');
      },
      ondragleave: (e) => {
        if (e.target === zone) zone.classList.remove('over');
      },
      ondrop: (e) => {
        e.preventDefault();
        zone.classList.remove('over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleDrop(e.dataTransfer.files);
      }
    },
      h('div.big-ico', icon('upload')),
      h('h3', 'Drop documents or folders here'),
      h('p', 'Files are read locally on this computer. Nothing is uploaded.'),
      h('div.row', { style: { justifyContent: 'center', marginTop: '18px', gap: '10px' } },
        h('button.btn.primary.lg', { onclick: pickFiles }, icon('file'), 'Select files'),
        h('button.btn.lg', { onclick: pickFolder }, icon('folder'), 'Select folder')),
      h('div.format-chips', FORMATS.map((f) => h('span', f))));
    return zone;
  }

  function selectedList() {
    if (!state.paths.length) return null;
    return h('div.card.flat',
      h('div.card-head',
        h('div', h('div.card-title', `${fmt.plural(state.paths.length, 'item')} selected`), h('div.sub', 'Files and folders to read. Folders are scanned recursively.')),
        h('span.spacer'),
        h('button.btn.sm.ghost', {
          disabled: state.running,
          onclick: () => { state.paths = []; state.summary = null; render(); }
        }, icon('eraser'), 'Clear')),
      h('div.file-list', state.paths.map((p) =>
        h('div.file-item',
          h('span.ext', extOf(p)),
          h('span.name', { title: p }, nameOf(p)),
          h('button.btn.sm.ghost.icon-only', {
            title: 'Remove from list',
            'aria-label': 'Remove ' + nameOf(p),
            disabled: state.running,
            onclick: () => { state.paths = state.paths.filter((x) => x !== p); render(); }
          }, icon('x'))))),
      h('div.row', { style: { marginTop: '14px' } },
        state.running
          ? h('button.btn.danger', { onclick: cancel }, icon('stop'), 'Stop')
          : h('button.btn.primary.lg', { onclick: runExtraction }, icon('spark'), 'Extract emails'),
        h('span.small.muted', 'Duplicates are removed automatically across all documents.')));
  }

  function progressCard() {
    const p = state.progress || { done: 0, total: 0, current: '' };
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return h('div.card',
      h('div.row', { style: { marginBottom: '12px' } },
        h('div.card-title', 'Reading documents'),
        h('span.spacer'),
        h('strong', p.total ? `${p.done} / ${p.total}` : 'Preparing…')),
      h('div.progress.thick', { class: p.total ? '' : 'indeterminate' }, h('span', { style: { width: pct + '%' } })),
      h('div.small.muted', { style: { marginTop: '10px' } }, p.current ? `Now reading ${p.current}` : 'Preparing…'),
      h('div.small.muted', 'The window stays responsive while files are read in the background.'));
  }

  function summaryCard(s) {
    const failures = s.failures || [];
    const skipped = s.skipped || [];
    const stat = (label, value, tone) => SM.statCard({ label, value, tone });
    const issues = [];
    if (failures.length) {
      issues.push(SM.alert('warning', h('div',
        h('strong', `${fmt.plural(failures.length, 'document')} could not be read`),
        h('ul', failures.slice(0, 12).map((f) => h('li', h('strong', f.fileName + ': '), f.error))),
        failures.length > 12 ? h('div.small', `…and ${failures.length - 12} more.`) : null)));
    }
    if (skipped.length) {
      issues.push(SM.alert('info', h('div',
        h('strong', `${fmt.plural(skipped.length, 'item')} skipped`), ' — unsupported file types. See the supported formats below.')));
    }
    if (s.cancelled) {
      issues.push(SM.alert('warning', 'Extraction was stopped early. Results shown are for the documents read so far.'));
    }

    return h('div.col', { style: { gap: '18px' } },
      h('div.card.hoverable',
        h('div.row', { style: { marginBottom: '16px' } },
          h('div', { style: { width: '40px', height: '40px', borderRadius: '12px', display: 'grid', placeItems: 'center', background: 'var(--success-bg)', color: 'var(--success)' } }, icon('check')),
          h('div', h('div.card-title', 'Extraction summary'), h('div.sub.small.muted', `Completed in ${fmt.duration(s.durationMs)}`)),
          h('span.spacer'),
          h('button.btn.primary', { onclick: () => (location.hash = '#/recipients') }, icon('users'), 'Review recipients')),
        h('div.grid.grid-4', { style: { gap: '12px' } },
          stat('Documents processed', s.documentsProcessed, 'info'),
          stat('Emails found', s.emailsFound, 'info'),
          stat('Unique emails', s.uniqueEmails, 'success'),
          stat('Duplicates removed', s.duplicatesRemoved, 'neutral')),
        h('div.grid.grid-3', { style: { gap: '12px', marginTop: '12px' } },
          stat('Invalid addresses', s.invalidAddresses, s.invalidAddresses ? 'danger' : 'neutral'),
          stat('Documents failed', s.documentsFailed, s.documentsFailed ? 'danger' : 'neutral'),
          stat('New in your list', s.addedToList, 'success')),
        h('p.small.muted', { style: { marginTop: '14px', lineHeight: '1.5' } },
          'Invalid addresses are kept for review but are never selected for sending. Each address keeps the document it came from.')),
      issues.length ? h('div.col', { style: { gap: '10px' } }, issues) : null);
  }

  function formatsCard() {
    return h('div.card.flat',
      h('div.card-head', h('div', h('div.card-title', 'Supported formats'), h('div.sub', 'Read locally. Nothing leaves your computer.'))),
      h('div.small.soft', { style: { lineHeight: '1.7' } },
        'PDF (text layer), Word DOCX, legacy DOC (best effort), Excel XLSX/XLSM/XLS, CSV, TXT, Markdown, HTML, XML, JSON and RTF. Scanned PDFs without a text layer cannot be read; export them as text first. Password-protected or corrupted files are reported and skipped.'));
  }

  function howItWorksCard() {
    return h('div.card.flat',
      h('div.card-head', h('div', h('div.card-title', 'How extraction works'), h('div.sub', 'Built for lists you are authorised to use'))),
      h('ol.small.soft', { style: { lineHeight: '1.8', paddingLeft: '18px', margin: '0' } },
        h('li', 'Documents are parsed in a background worker.'),
        h('li', 'Addresses are normalised to lower case and de-duplicated.'),
        h('li', 'Malformed addresses are flagged as invalid.'),
        h('li', 'You review every recipient before any campaign is created.')));
  }

  SM.route('extract', () => {
    SM.setActiveNav('extract');
    SM.setHeader('Extract Emails', 'Import', [
      h('button.btn', { onclick: () => (location.hash = '#/recipients') }, icon('users'), 'Recipients')
    ]);
    body = SM.mount(h('div.col', { style: { gap: '20px' } })).firstElementChild;
    // Live progress from the main process (re-rendered at most once per frame).
    SM.listen('extraction:progress', (p) => {
      if (!state.running) return;
      state.progress = p;
      scheduleRender();
    });
    render();
  });

})();
