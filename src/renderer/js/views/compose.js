/* Create Campaign: composer, preview, test send, and mandatory confirmation */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;
  const api = () => window.superMailer;

  const VARIABLES = [
    { key: 'first_name', label: 'First name' },
    { key: 'last_name', label: 'Last name' },
    { key: 'email', label: 'Email' }
  ];

  let draft = SM.draft.load();
  let settings = null;
  let stats = null;
  let previewTimer = 0;
  let previewMode = 'html';
  let refs = {};

  function persist() {
    SM.draft.save(draft);
  }

  function toolbarButton(iconName, title, onClick) {
    return h('button.btn', {
      title,
      'aria-label': title,
      onmousedown: (e) => e.preventDefault(), // keep the editor selection
      onclick: onClick
    }, icon(iconName));
  }

  function exec(cmd, value) {
    refs.editor.focus();
    document.execCommand(cmd, false, value || null);
    syncBody();
  }

  function insertVariable(key) {
    const token = `{{${key}}}`;
    refs.editor.focus();
    document.execCommand('insertText', false, token);
    syncBody();
  }

  function syncBody() {
    draft.bodyHtml = refs.editor.innerHTML;
    persist();
    schedulePreview();
  }

  function insertSubjectVariable(key) {
    const input = refs.subject;
    const token = `{{${key}}}`;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    draft.subject = input.value;
    persist();
    schedulePreview();
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 350);
  }

  async function refreshPreview() {
    const res = await SM.call(api().compose.preview(draft), { silent: true });
    if (!res || !res.ok || SM.stale(refs.frame)) return;
    const p = res.preview;
    refs.meta.innerHTML = '';
    refs.meta.append(
      h('dt', 'From'), h('dd', p.from || '—'),
      h('dt', 'To'), h('dd', p.to + ' (sample)'),
      h('dt', 'Subject'), h('dd', p.subject || '(no subject)')
    );
    refs.frame.srcdoc = wrapPreview(p.html);
    refs.plain.textContent = p.text || '';
    refs.plain.dataset.empty = p.text ? '' : '1';
  }

  function wrapPreview(html) {
    return (
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https:; style-src \'unsafe-inline\'">' +
      '<style>body{font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b2a41;margin:0;padding:22px;background:#fff}img{max-width:100%}a{color:#1d5fc4}</style></head><body>' +
      (html || '<p style="color:#8594ad">Your message will appear here as you type.</p>') +
      '</body></html>'
    );
  }

  function senderBanner() {
    if (!settings || !settings.senderEmail) {
      return SM.alert('warning', h('div', h('strong', 'No sending account yet. '), 'Add your sender details in Settings before you can send a test or start a campaign. ',
        h('a', { href: '#/settings', style: { color: 'inherit', fontWeight: '650' } }, 'Open Settings →')));
    }
    return null;
  }

  function buildEditor() {
    refs.editor = h('div.rich', {
      contenteditable: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      'data-placeholder': 'Write your message. Use the variable buttons to personalize it.',
      oninput: () => syncBody(),
      onpaste: (e) => {
        // Paste as plain text to avoid importing foreign styles and scripts.
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      }
    });
    refs.editor.innerHTML = draft.bodyHtml || '';
    return h('div.col', { style: { gap: '0' } },
      h('div.editor-toolbar', { role: 'toolbar', 'aria-label': 'Formatting' },
        toolbarButton('bold', 'Bold', () => exec('bold')),
        toolbarButton('italic', 'Italic', () => exec('italic')),
        toolbarButton('underline', 'Underline', () => exec('underline')),
        h('span.sep'),
        h('button.btn', { title: 'Heading', 'aria-label': 'Heading', onmousedown: (e) => e.preventDefault(), onclick: () => exec('formatBlock', 'h2') }, 'H'),
        h('button.btn', { title: 'Paragraph', 'aria-label': 'Paragraph', onmousedown: (e) => e.preventDefault(), onclick: () => exec('formatBlock', 'p') }, '¶'),
        h('span.sep'),
        toolbarButton('listUl', 'Bulleted list', () => exec('insertUnorderedList')),
        toolbarButton('listOl', 'Numbered list', () => exec('insertOrderedList')),
        toolbarButton('quote', 'Quote', () => exec('formatBlock', 'blockquote')),
        h('span.sep'),
        toolbarButton('link', 'Insert link', () => {
          const url = window.prompt('Link address (https://…)', 'https://');
          if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) exec('createLink', url.trim());
          else if (url) SM.toast('warning', 'Link not added', 'Links must start with https:// or mailto:');
        }),
        toolbarButton('eraser', 'Clear formatting', () => exec('removeFormat')),
        h('span.sep'),
        h('span.small.muted', { style: { alignSelf: 'center', padding: '0 6px' } }, 'Insert:'),
        ...VARIABLES.map((v) => h('button.chip.var', { onmousedown: (e) => e.preventDefault(), onclick: () => insertVariable(v.key), title: `Insert {{${v.key}}}` }, `{{${v.key}}}`))),
      refs.editor);
  }

  function plainTextSection() {
    refs.plainArea = h('textarea.textarea', {
      rows: 7,
      placeholder: 'Plain-text version for email clients that do not show HTML',
      oninput: (e) => {
        draft.bodyText = e.target.value;
        persist();
        schedulePreview();
      }
    });
    refs.plainArea.value = draft.bodyText || '';
    const toggle = h('div.segmented', { role: 'group', 'aria-label': 'Plain-text version' },
      h('button' + (draft.plainAuto ? '.active' : ''), { onclick: () => setAuto(true) }, 'Generated from HTML'),
      h('button' + (!draft.plainAuto ? '.active' : ''), { onclick: () => setAuto(false) }, 'Write my own'));
    function setAuto(auto) {
      draft.plainAuto = auto;
      if (auto) draft.bodyText = '';
      persist();
      renderForm();
      schedulePreview();
    }
    return h('div.col', { style: { gap: '8px' } },
      h('div.row', toggle, h('span.spacer'), h('span.small.muted', 'Plain text improves deliverability')),
      draft.plainAuto ? h('div.small.muted', 'A plain-text part will be generated automatically from your formatted message.') : refs.plainArea);
  }

  function formCard() {
    refs.name = h('input.input', { value: draft.name || '', placeholder: 'e.g. October Newsletter', maxlength: '120', oninput: (e) => { draft.name = e.target.value; persist(); } });
    refs.senderName = h('input.input', { value: draft.senderName || (settings && settings.senderName) || '', placeholder: 'Acme Newsletter', maxlength: '200', oninput: (e) => { draft.senderName = e.target.value; persist(); schedulePreview(); } });
    refs.replyTo = h('input.input', { value: draft.replyTo || (settings && settings.replyTo) || '', placeholder: 'replies@yourcompany.com', type: 'email', oninput: (e) => { draft.replyTo = e.target.value.trim(); persist(); schedulePreview(); } });
    refs.subject = h('input.input', { value: draft.subject || '', placeholder: 'Hello {{first_name}}, here is our update', maxlength: '300', oninput: (e) => { draft.subject = e.target.value; persist(); schedulePreview(); } });
    refs.unsub = h('input.input', { value: draft.listUnsubscribe || (settings && settings.listUnsubscribe) || '', placeholder: '<mailto:unsubscribe@yourcompany.com> or <https://…>', oninput: (e) => { draft.listUnsubscribe = e.target.value; persist(); } });
    refs.bodyCol = h('div.field', h('label', 'Message'), buildEditor());
    return h('div.col', { style: { gap: '16px' } },
      h('div.card',
        h('div.card-head', h('div.card-title', 'Campaign'), h('span.spacer'), h('span.pill.neutral', 'Draft saved automatically')),
        h('div.grid.grid-2', { style: { gap: '14px' } },
          h('div.field', h('label', 'Campaign name'), refs.name),
          h('div.field', h('label', 'Sender account'),
            h('div.input', { style: { background: '#f7f9fd', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'default' } },
              icon('shield', 'muted'),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                settings && settings.senderEmail ? settings.senderEmail : 'Not configured'))),
          h('div.field', h('label', 'Sender name'), refs.senderName),
          h('div.field', h('label', 'Reply-to address'), refs.replyTo, h('span.hint', 'Replies go here. Leave blank to reply to the sender account.')),
          h('div.field', { style: { gridColumn: '1 / -1' } }, h('label', 'Subject'), refs.subject,
            h('div.row', { style: { flexWrap: 'wrap', gap: '6px', marginTop: '4px' } },
              h('span.small.muted', 'Personalize:'),
              ...VARIABLES.map((v) => h('button.chip.var', { onclick: () => insertSubjectVariable(v.key), title: v.label }, `{{${v.key}}}`)))))),
      h('div.card',
        h('div.card-head', h('div.card-title', 'Message'), h('span.spacer'), h('span.small.muted', 'Variables personalize each email with that recipient’s details.')),
        refs.bodyCol),
      h('div.card',
        h('div.card-head', h('div', h('div.card-title', 'Plain-text fallback'), h('div.sub', 'Shown by clients that cannot display HTML'))),
        plainTextSection()),
      h('div.card',
        h('div.card-head', h('div', h('div.card-title', 'Unsubscribe'), h('div.sub', 'Recommended for marketing mail. Sent as a List-Unsubscribe header.'))),
        h('div.field', refs.unsub, h('span.hint', 'Provide a mailto: or https: address where people can opt out. Unsubscribes are added to the suppression list in Settings.'))));
  }

  function previewCard() {
    refs.meta = h('dl.mail-meta');
    refs.frame = h('iframe.preview-frame', { title: 'Email preview', sandbox: '', srcdoc: wrapPreview('') });
    refs.plain = h('div.plain-view', { 'data-empty': '1' }, 'Plain-text version will appear here.');
    const seg = h('div.segmented', { role: 'tablist' },
      h('button' + (previewMode === 'html' ? '.active' : ''), { onclick: () => setMode('html') }, 'HTML preview'),
      h('button' + (previewMode === 'plain' ? '.active' : ''), { onclick: () => setMode('plain') }, 'Plain text'));
    function setMode(m) {
      previewMode = m;
      refs.frame.hidden = m !== 'html';
      refs.plain.hidden = m !== 'plain';
      seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', (i === 0) === (m === 'html')));
    }
    setTimeout(() => setMode(previewMode), 0);
    return h('div.card',
      h('div.card-head', h('div', h('div.card-title', 'Preview'), h('div.sub', 'Rendered with a sample recipient: Jane Doe')), h('span.spacer'),
        h('button.btn.sm', { onclick: refreshPreview, title: 'Refresh preview' }, icon('refresh'), 'Preview Email')),
      refs.meta,
      seg,
      h('div', { style: { marginTop: '12px' } }, refs.frame, refs.plain));
  }

  function testCard() {
    refs.testTo = h('input.input', { type: 'email', placeholder: 'your.address@yourcompany.com', value: (settings && settings.senderEmail) || '', 'aria-label': 'Test recipient address' });
    const btn = h('button.btn', {
      onclick: async () => {
        btn.disabled = true;
        btn.replaceChildren(h('span.spinner'), 'Sending test…');
        const res = await SM.call(api().compose.sendTest(draft, refs.testTo.value.trim()), { silent: true });
        btn.disabled = false;
        btn.replaceChildren(icon('send'), 'Send Test Email');
        if (res && res.ok) SM.toast('success', 'Test email sent', res.message);
        else SM.toast('error', 'Test email failed', (res && res.message) || 'Check your Settings and try again.');
      }
    }, icon('send'), 'Send Test Email');
    return h('div.card',
      h('div.card-head', h('div', h('div.card-title', 'Send a test'), h('div.sub', 'Check the layout and personalization in a real inbox you control.'))),
      h('div.input-group', refs.testTo, btn));
  }

  function readyCard() {
    refs.readyBody = h('div.col', { style: { gap: '12px' } });
    refs.sendBtn = h('button.btn.primary.lg', { onclick: startFlow, style: { width: '100%', justifyContent: 'center' } }, icon('send'), 'Review & send');
    return h('div.card.hoverable', { style: { borderColor: '#bcd5fb' } },
      h('div.card-head', h('div', h('div.card-title', 'Ready to send?'), h('div.sub', 'Recipients come from your reviewed, selected list.'))),
      refs.readyBody,
      refs.sendBtn);
  }

  async function refreshReady() {
    const [pre, rec] = await Promise.all([
      SM.call(api().compose.preflight(draft), { silent: true }),
      SM.call(api().recipients.stats(), { silent: true })
    ]);
    stats = rec && rec.stats;
    if (SM.stale(refs.readyBody)) return;
    SM.clear(refs.readyBody);
    const count = pre && pre.count !== undefined ? pre.count : 0;
    refs.readyBody.append(
      h('div.row', { style: { alignItems: 'baseline' } },
        h('div', { style: { fontSize: '40px', fontWeight: '750', letterSpacing: '-0.03em', color: 'var(--blue-800)', fontVariantNumeric: 'tabular-nums' } }, fmt.int(count)),
        h('div.soft', { style: { marginLeft: '8px' } }, count === 1 ? 'recipient selected' : 'recipients selected')));
    if (pre && pre.warnings && pre.warnings.length) refs.readyBody.append(SM.alert('warning', h('ul', pre.warnings.map((w) => h('li', w)))));
    if (pre && pre.errors && pre.errors.length) refs.readyBody.append(SM.alert('danger', h('ul', pre.errors.map((w) => h('li', w)))));
    if (count > 1000) refs.readyBody.append(SM.alert('danger', 'Campaigns are limited to 1,000 recipients. Deselect some recipients to continue.'));
    if (count === 0) refs.readyBody.append(SM.alert('info', 'Select valid recipients on the Recipients screen first.'));
    refs.readyCount = count;
    refs.sendBtn.disabled = !count;
    if (stats && stats.selectedValid !== count) {
      // Keep the count honest if the list changed elsewhere.
      refs.readyBody.append(h('div.small.muted', 'Selection updated from the Recipients screen.'));
    }
  }

  /**
   * Mandatory confirmation: re-validates, shows the exact recipient count, and
   * only starts sending after the user explicitly ticks the confirmation box.
   */
  async function startFlow() {
    const pre = await SM.call(api().compose.preflight(draft), { silent: true });
    if (!pre || !pre.ok) {
      SM.toast('error', 'Fix these before sending', (pre && pre.errors && pre.errors[0]) || 'Please review the campaign details.');
      refreshReady();
      return;
    }
    const count = pre.count;
    let agreed = false;
    let confirmBtn = null;
    const check = h('input.checkbox', {
      type: 'checkbox',
      onchange: (e) => {
        agreed = e.target.checked;
        if (confirmBtn) confirmBtn.disabled = !agreed;
      }
    });
    const content = h('div.col', { style: { marginTop: '16px', gap: '14px' } },
      h('div.alert.info', icon('info'),
        h('div',
          h('div', h('strong', draft.name || 'Untitled campaign')),
          h('div.small', `Subject: ${draft.subject || '—'}`),
          h('div.small', `From: ${(settings && settings.senderEmail) || '—'}`))),
      pre.warnings && pre.warnings.length ? SM.alert('warning', h('ul', pre.warnings.map((w) => h('li', w)))) : null,
      h('label.check-line', check,
        h('span.small', 'I confirm these recipients opted in or have a legitimate relationship with me, that I have reviewed this message, and that it complies with applicable anti-spam and privacy laws.')),
      h('div.small.muted', 'Emails are sent in the background at your configured rate. Inbox placement depends on each recipient’s email provider and your sender reputation; it cannot be guaranteed.'));

    const choice = await SM.modal({
      title: 'Confirm before sending',
      body: h('span', 'You are about to send this campaign to ', h('strong', fmt.int(count)), count === 1 ? ' recipient.' : ' recipients.'),
      content,
      actions: [
        { id: 'cancel', label: 'Cancel' },
        {
          id: 'send',
          label: `Send to ${fmt.int(count)} recipients`,
          primary: true,
          disabled: true,
          ref: (b) => (confirmBtn = b),
          onClick: () => agreed
        }
      ]
    });
    if (choice !== 'send' || !agreed) return;

    const res = await SM.call(api().campaign.start(draft, count), { errorTitle: 'Campaign could not start' });
    if (res && res.ok) {
      SM.toast('success', 'Campaign started', `Sending to ${fmt.int(res.total)} recipients${res.skipped ? ` (${fmt.int(res.skipped)} skipped)` : ''}.`);
      location.hash = '#/campaign';
    } else if (res && res.errors) {
      SM.toast('error', 'Campaign could not start', res.errors[0]);
    }
  }

  SM.route('compose', async () => {
    SM.setActiveNav('compose');
    SM.setHeader('Create Campaign', 'Compose', [
      h('button.btn', { onclick: () => (location.hash = '#/recipients') }, icon('users'), 'Recipients'),
      h('button.btn', { onclick: () => (location.hash = '#/campaign') }, icon('send'), 'Live campaign')
    ]);
    const body = SM.mount(h('div.col', { style: { gap: '20px' } })).firstElementChild;
    const [s, rec] = await Promise.all([SM.call(api().settings.get(), { silent: true }), SM.call(api().recipients.stats(), { silent: true })]);
    // The user may have navigated away while the composer was loading.
    if (SM.stale(body)) return;
    settings = s && s.settings;
    stats = rec && rec.stats;
    renderForm = () => {
      if (SM.stale(body)) return;
      SM.clear(body);
      body.append(
        senderBanner(),
        h('div.split',
          h('div.col', { style: { gap: '16px' } }, formCard()),
          h('div.col', { style: { gap: '16px', position: 'sticky', top: '0' } }, previewCard(), testCard(), readyCard()))
      );
    };
    renderForm();
    await refreshPreview();
    if (SM.stale(body)) return;
    await refreshReady();
  });

  let renderForm = () => {};
})();
