/* Settings: authorised sender account, SMTP server, sending limits, suppression list */
(function () {
  'use strict';
  const SM = window.SM;
  const { h, icon, fmt } = SM;
  const api = () => window.superMailer;

  const DEFAULT_LOOK = { senderName: '', senderEmail: '', replyTo: '', smtpHost: '', smtpPort: 587, encryption: 'starttls', smtpUser: '', sendingRatePerMinute: 30, maxRetries: 3, retryDelaySeconds: [10, 30, 90], connectionTimeoutSec: 30, verifyTls: true, listUnsubscribe: '' };

  function field(label, input, hint) {
    return h('div.field', h('label', label), input, hint ? h('span.hint', hint) : null);
  }

  function section(title, sub, iconName, body) {
    return h('div.card',
      h('div.card-head',
        h('div', { style: { width: '36px', height: '36px', borderRadius: '11px', display: 'grid', placeItems: 'center', background: 'var(--blue-100)', color: 'var(--blue-700)' } }, icon(iconName)),
        h('div', h('div.card-title', title), h('div.sub', sub))),
      body);
  }

  async function renderSuppression(host) {
    SM.clear(host);
    const res = await SM.call(api().suppression.list(), { silent: true });
    const items = (res && res.items) || [];
    const addInput = h('input.input', { placeholder: 'Add an address to suppress…', type: 'email', 'aria-label': 'Address to suppress' });
    host.append(
      h('div.row', { style: { gap: '8px', marginBottom: '12px' } },
        h('span.small.soft', `${fmt.plural(items.length, 'address')} suppressed`),
        h('span.spacer'),
        h('div.input-group', { style: { width: '320px' } }, addInput,
          h('button.btn.sm', {
            onclick: async () => {
              const email = addInput.value.trim();
              if (!email) return;
              const r = await SM.call(api().suppression.add([email]));
              if (r && r.ok) {
                SM.toast('success', 'Address suppressed', email);
                renderSuppression(host);
              }
            }
          }, 'Suppress'))),
      items.length
        ? h('div.table-wrap', { style: { maxHeight: '260px' } },
            h('table.table', h('thead', h('tr', h('th', 'Address'), h('th', 'Reason'), h('th', 'Added'), h('th.nosort', ''))),
              h('tbody', items.slice(0, 300).map((it) =>
                h('tr',
                  h('td.email', it.email),
                  h('td', h('span.pill.suppressed', it.reason === 'permanent_failure' ? 'Permanent failure' : it.reason === 'unsubscribed' ? 'Unsubscribed' : it.reason)),
                  h('td.small.muted', fmt.dateShort(it.at)),
                  h('td', h('button.btn.sm.ghost.icon-only', {
                    'aria-label': 'Remove suppression for ' + it.email,
                    title: 'Remove from suppression list',
                    onclick: async () => {
                      const ok = await SM.confirm('Allow sending to this address again?', `${it.email} will be eligible for future campaigns. Only do this if the person has asked to receive mail again.`, { confirmLabel: 'Remove suppression', danger: true });
                      if (!ok) return;
                      await SM.call(api().suppression.remove([it.email]));
                      renderSuppression(host);
                    }
                  }, icon('trash'))))))))
        : SM.emptyState({ iconName: 'shield', title: 'Nothing suppressed', body: 'Addresses that permanently reject mail or ask to unsubscribe are added here and are never sent to again.' }));
  }

  SM.route('settings', async () => {
    SM.setActiveNav('settings');
    SM.setHeader('Settings', 'Configuration', []);
    const view = SM.mount(h('div.col', { style: { gap: '18px' } })).firstElementChild;
    const res = await SM.call(api().settings.get(), { silent: true });
    const s = Object.assign({}, DEFAULT_LOOK, (res && res.settings) || {});
    const hasSecret = !!(res && res.hasSecret);
    let dirty = false;

    const inputs = {
      senderName: h('input.input', { value: s.senderName, maxlength: '200', placeholder: 'Acme Newsletter', oninput: () => (dirty = true) }),
      senderEmail: h('input.input', { value: s.senderEmail, type: 'email', placeholder: 'sender@yourcompany.com', oninput: () => (dirty = true) }),
      replyTo: h('input.input', { value: s.replyTo, type: 'email', placeholder: 'replies@yourcompany.com', oninput: () => (dirty = true) }),
      smtpHost: h('input.input', { value: s.smtpHost, placeholder: 'smtp.yourprovider.com', oninput: () => (dirty = true) }),
      smtpPort: h('input.input', { value: String(s.smtpPort), type: 'number', min: '1', max: '65535', oninput: () => (dirty = true) }),
      smtpUser: h('input.input', { value: s.smtpUser, autocomplete: 'off', placeholder: 'Usually your full email or API username', oninput: () => (dirty = true) }),
      encryption: h('select.select', { onchange: (e) => { dirty = true; encWarn(); } },
        [['starttls', 'STARTTLS (port 587) — recommended'], ['tls', 'SSL/TLS (port 465)'], ['none', 'None — local testing only']].map(([v, l]) =>
          h('option', { value: v, selected: s.encryption === v }, l))),
      password: h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: hasSecret ? '•••••••• (saved — leave blank to keep)' : 'Password or API key', 'aria-label': 'SMTP password or API key', oninput: () => (dirty = true) }),
      verifyTls: h('input', { type: 'checkbox', class: 'checkbox', checked: s.verifyTls !== false, onchange: () => (dirty = true) }),
      rate: h('input.input', { type: 'number', min: '1', max: '1000', value: String(s.sendingRatePerMinute), oninput: () => (dirty = true) }),
      retries: h('input.input', { type: 'number', min: '0', max: '10', value: String(s.maxRetries), oninput: () => (dirty = true) }),
      retryDelays: h('input.input', { value: (s.retryDelaySeconds || [10, 30, 90]).join(', '), placeholder: '10, 30, 90', oninput: () => (dirty = true) }),
      timeout: h('input.input', { type: 'number', min: '5', max: '300', value: String(s.connectionTimeoutSec), oninput: () => (dirty = true) }),
      unsub: h('input.input', { value: s.listUnsubscribe || '', placeholder: 'mailto:unsubscribe@yourcompany.com', oninput: () => (dirty = true) })
    };

    const encNote = h('div');
    function encWarn() {
      SM.clear(encNote);
      if (inputs.encryption.value === 'none') {
        encNote.append(SM.alert('danger', 'Without encryption, your password and messages can be read by anyone on the network path. Use STARTTLS or SSL/TLS for real campaigns.'));
      }
    }
    encWarn();

    const passwordHint = h('div.row', { style: { gap: '8px' } },
      h('span.pill', { class: 'pill ' + (hasSecret ? 'valid' : 'neutral') }, hasSecret ? 'Saved securely' : 'Not saved'),
      h('span.small.muted', 'Encrypted with Windows DPAPI for this user account. Never written to logs or exported.'),
      hasSecret ? h('button.btn.sm.ghost.danger', {
        onclick: async () => {
          const ok = await SM.confirm('Remove the saved password?', 'You will need to enter it again before sending.', { confirmLabel: 'Remove password', danger: true });
          if (!ok) return;
          await SM.call(api().settings.clearPassword());
          SM.toast('success', 'Saved password removed');
          renderSettings();
        }
      }, 'Remove') : null);

    const testOut = h('div', { style: { marginTop: '12px' } });
    const collect = () => {
      const patch = {
        senderName: inputs.senderName.value.trim(),
        senderEmail: inputs.senderEmail.value.trim(),
        replyTo: inputs.replyTo.value.trim(),
        smtpHost: inputs.smtpHost.value.trim(),
        smtpPort: Number(inputs.smtpPort.value) || 587,
        smtpUser: inputs.smtpUser.value.trim(),
        encryption: inputs.encryption.value,
        verifyTls: inputs.verifyTls.checked,
        sendingRatePerMinute: Number(inputs.rate.value) || 30,
        maxRetries: Number(inputs.retries.value),
        retryDelaySeconds: inputs.retryDelays.value.split(/[ ,]+/).map(Number).filter((n) => n > 0),
        connectionTimeoutSec: Number(inputs.timeout.value) || 30,
        listUnsubscribe: inputs.unsub.value.trim()
      };
      return patch;
    };

    const saveBtn = h('button.btn.primary', {
      onclick: async () => {
        const patch = collect();
        const password = inputs.password.value;
        const r = await SM.call(api().settings.update(patch, password || undefined));
        if (r && r.ok) {
          dirty = false;
          SM.toast('success', 'Settings saved', password ? 'Password stored securely.' : 'Your sending account is updated.');
          inputs.password.value = '';
          renderSettings();
        }
      }
    }, icon('check'), 'Save changes');

    const testBtn = h('button.btn', {
      onclick: async () => {
        testBtn.disabled = true;
        testBtn.replaceChildren(h('span.spinner'), 'Testing…');
        testOut.replaceChildren(SM.alert('info', 'Connecting to the server and checking encryption and login…'));
        const r = await SM.call(api().settings.testConnection(collect(), inputs.password.value || undefined), { silent: true });
        testBtn.disabled = false;
        testBtn.replaceChildren(icon('server'), 'Test Connection');
        if (r && r.ok) {
          testOut.replaceChildren(SM.alert('success', h('div', h('strong', 'Connection works. '), r.message)));
          SM.toast('success', 'Connection successful', r.message);
        } else {
          const hint = {
            auth: 'Check the username and password or API key, and that SMTP access is enabled for the account.',
            network: 'Check the host name, port and your internet connection. Some networks block port 25/587/465.',
            timeout: 'The server did not respond. Check the host and port, and try again.',
            config: 'Fill in the highlighted fields first.',
            temporary: 'The server is temporarily unavailable. Try again shortly.'
          }[r && r.kind] || 'Double-check the encryption setting for your provider’s port.';
          testOut.replaceChildren(SM.alert('danger', h('div', h('strong', (r && r.message) || 'Connection failed.'), h('div.small', { style: { marginTop: '4px' } }, hint))));
          SM.toast('error', 'Connection failed', (r && r.message) || '');
        }
      }
    }, icon('server'), 'Test Connection');

    const actionBar = h('div.card.flat', { style: { position: 'sticky', bottom: '0', zIndex: '2', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)' } },
      h('div.row', { style: { flexWrap: 'wrap', gap: '10px' } },
        h('span.small.muted', 'Changes are saved locally. Passwords are stored separately in secure storage.'),
        h('span.spacer'), testBtn, saveBtn),
      testOut);

    const suppressionHost = h('div');
    view.append(
      h('div.split',
        h('div.col', { style: { gap: '18px' } },
          section('Sender account', 'The address that appears in the From line. Use an address you own and that is authorised by your provider.', 'mail',
            h('div.grid.grid-2', { style: { gap: '14px' } },
              field('Sender name', inputs.senderName),
              field('Sender email', inputs.senderEmail, 'Must be a domain you control.'),
              field('Reply-to address', inputs.replyTo, 'Where replies are delivered. Optional.'),
              field('Unsubscribe address (List-Unsubscribe)', inputs.unsub, 'Recommended for marketing. mailto: or https:'))),
          section('SMTP server', 'Connection and login for your authorised sending account.', 'server',
            h('div.col', { style: { gap: '14px' } },
              h('div.grid.grid-2', { style: { gap: '14px' } },
                field('SMTP host', inputs.smtpHost),
                field('Port', inputs.smtpPort),
                field('Encryption', inputs.encryption),
                field('Username', inputs.smtpUser)),
              field('Password / API key', h('div.col', { style: { gap: '10px' } }, inputs.password, passwordHint)),
              encNote,
              h('div.toggle-row', { style: { borderBottom: 'none', padding: '4px 0' } },
                h('div', { style: { flex: '1' } }, h('div.t', 'Verify server certificates'), h('div.d', 'Keep this on. Turning it off accepts unknown or self-signed certificates and is not recommended.')),
                h('label.switch', inputs.verifyTls, h('span'))))),
          actionBar),
        h('div.col', { style: { gap: '18px' } },
          section('Sending limits', 'Keep volumes gradual to protect your sender reputation.', 'clock',
            h('div.grid.grid-2', { style: { gap: '14px' } },
              field('Messages per minute', inputs.rate, 'Up to 1,000. Start low for new senders.'),
              field('Retries for temporary failures', inputs.retries, 'Greylisting and busy servers are retried automatically.'),
              field('Retry delays (seconds)', inputs.retryDelays, 'Comma-separated; used in order.'),
              field('Connection timeout (seconds)', inputs.timeout))),
          section('Deliverability', 'What Super Mailer does and does not control.', 'shield',
            h('ul.insights.small', { style: { paddingLeft: '18px', margin: 0 } },
              h('li', 'Authenticate your domain with SPF, DKIM and DMARC through your DNS and provider. Super Mailer cannot set these for you.'),
              h('li', 'Send only to recipients who opted in or have a legitimate relationship with you, and honor unsubscribes promptly.'),
              h('li', 'Permanently rejected addresses are suppressed automatically so they are never retried.'),
              h('li', 'Super Mailer cannot guarantee inbox placement. Filtering decisions belong to the recipient’s email provider.'))),
          section('Suppression list', 'Addresses that will never be emailed by Super Mailer.', 'shield', suppressionHost))));
    renderSuppression(suppressionHost);
    void dirty;
    void view;
  });

  function renderSettings() {
    SM.routes.settings();
  }
})();
