/* Super Mailer — shared UI kit (no framework). All user-supplied text is inserted
   as DOM text nodes, never as HTML. */
(function () {
  'use strict';

  const SM = (window.SM = window.SM || {});

  // ---------------------------------------------------------------- icons (static SVG markup only)
  const ICON_PATHS = {
    dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
    upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.2A6.5 6.5 0 0 1 21.5 20"/>',
    pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.01"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path d="M7 5v14l12-7Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1 1"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1-1"/>',
    bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
    italic: '<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/>',
    listUl: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    listOl: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.5V9M4 9h2.5"/><path d="M4 14.5c0-1 2.5-1 2.5 0 0 1.2-2.5 1.5-2.5 3h2.5"/>',
    quote: '<path d="M7 17h3l2-4V7H6v6h3zM14 17h3l2-4V7h-6v6h3z"/>',
    eraser: '<path d="m7 21-4-4 10-10 6 6-5 5"/><path d="M14 21h7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    sort: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M16 7l3 3M14 9l2 2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sparkles: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z"/><path d="M19 15l.8 1.9L22 18l-2.2.9L19 21l-.8-2.1L16 18l2.2-1.1Z"/>'
  };

  function icon(name, cls) {
    const span = document.createElement('span');
    span.className = 'ico-svg' + (cls ? ' ' + cls : '');
    span.innerHTML =
      '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICON_PATHS[name] || '') +
      '</svg>';
    span.style.display = 'inline-flex';
    span.style.width = '1em';
    span.style.height = '1em';
    span.style.flex = 'none';
    return span;
  }
  SM.icon = icon;

  // ---------------------------------------------------------------- DOM helper
  /**
   * h('div.card', { onclick, title, style: {...}, data: {...} }, child, [children], 'text')
   * Children that are strings become text nodes; null/false are skipped.
   */
  function h(sel, attrs, ...children) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel || 'div');
    const tag = (m && m[1]) || 'div';
    const el = document.createElement(tag);
    if (m && m[2]) {
      for (const part of m[2].match(/[.#][\w-]+/g) || []) {
        if (part[0] === '.') el.classList.add(part.slice(1));
        else el.id = part.slice(1);
      }
    }
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class' || k === 'className') el.className += ' ' + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'data' && typeof v === 'object') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') throw new Error('h(): raw html is not allowed');
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    } else if (attrs !== undefined && attrs !== null && attrs !== false) {
      children.unshift(attrs);
    }
    const append = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(append);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    children.forEach(append);
    return el;
  }
  SM.h = h;

  SM.$ = (sel, root) => (root || document).querySelector(sel);
  SM.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  SM.clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };

  // ---------------------------------------------------------------- formatting
  SM.fmt = {
    int: (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '0'),
    pct: (n) => `${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}%`,
    date: (ts) => {
      if (!ts) return '—';
      const d = new Date(ts);
      return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    },
    dateShort: (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'),
    duration: (ms) => {
      if (!ms || ms < 0) return '—';
      const s = Math.round(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ${s % 60}s`;
      return `${Math.floor(m / 60)}h ${m % 60}m`;
    },
    eta: (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) return '—';
      return SM.fmt.duration(ms);
    },
    bytes: (n) => {
      if (!n) return '0 B';
      const u = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let v = n;
      while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
    },
    plural: (n, one, many) => `${SM.fmt.int(n)} ${n === 1 ? one : many || one + 's'}`
  };

  SM.statusLabel = (s) =>
    ({
      valid: 'Valid',
      invalid: 'Invalid',
      suppressed: 'Suppressed',
      completed: 'Completed',
      running: 'Sending',
      paused: 'Paused',
      cancelled: 'Cancelled',
      failed: 'Failed',
      interrupted: 'Interrupted',
      sent: 'Delivered',
      retrying: 'Retrying'
    })[s] || s;

  SM.pill = (status) => h('span.pill.' + String(status || 'neutral'), SM.statusLabel(status) || 'Unknown');

  // ---------------------------------------------------------------- toasts
  SM.toast = (type, title, detail, timeout) => {
    const root = document.getElementById('toasts');
    const icons = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };
    const el = h('div.toast.' + (type || 'info'), { role: 'status' },
      icon(icons[type] || 'info', 'ti'),
      h('div', { style: { flex: '1', minWidth: 0 } }, h('div.t', title), detail ? h('div.d', detail) : null),
      h('button.x', { title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('x'))
    );
    el.querySelector('.ti').style.width = '18px';
    el.querySelector('.ti').style.height = '18px';
    el.querySelector('.ti').style.marginTop = '2px';
    el.querySelector('.ti').style.color = type === 'success' ? '#12a06a' : type === 'error' ? '#d6404f' : type === 'warning' ? '#d68a0b' : '#2f7ae5';
    root.appendChild(el);
    while (root.children.length > 4) root.firstChild.remove();
    let gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      el.classList.add('leave');
      setTimeout(() => el.remove(), 260);
    }
    setTimeout(dismiss, timeout || (type === 'error' ? 7000 : 4500));
    return dismiss;
  };

  // ---------------------------------------------------------------- modal
  /**
   * SM.modal({ title, body (Node|string), actions: [{label, primary, danger, onClick, keep}], wide, dismissable })
   * Resolves with the clicked action's id/label, or null if dismissed.
   */
  SM.modal = (opts) =>
    new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const box = document.getElementById('modal');
      SM.clear(box);
      box.className = 'modal' + (opts.wide ? ' wide' : '');
      let done = false;
      const close = (value) => {
        if (done) return;
        done = true;
        box.classList.add('closing');
        setTimeout(() => {
          root.classList.remove('open');
          box.classList.remove('closing');
          SM.clear(box);
          document.removeEventListener('keydown', onKey);
          resolve(value);
        }, 170);
      };
      const onKey = (e) => {
        if (e.key === 'Escape' && opts.dismissable !== false) close(null);
      };
      const actions = (opts.actions || []).map((a) => {
        const btn = h(
          'button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : '') + (a.warn ? '.warn' : ''),
          {
            disabled: a.disabled,
            onclick: async () => {
              if (a.onClick) {
                const r = await a.onClick();
                if (r === false) return;
              }
              close(a.id || a.label);
            }
          },
          a.label
        );
        if (typeof a.ref === 'function') a.ref(btn);
        return btn;
      });
      box.append(
        h('h2', opts.title || ''),
        opts.body ? h('div.soft', { style: { lineHeight: '1.55', marginTop: '6px' } }, opts.body) : null,
        opts.content || null,
        h('div.actions', actions)
      );
      root.classList.add('open');
      document.addEventListener('keydown', onKey);
      const scrim = root.querySelector('.scrim');
      scrim.onclick = () => opts.dismissable !== false && close(null);
      setTimeout(() => {
        const first = box.querySelector('input, textarea, .checkbox') || box.querySelector('.btn.primary');
        if (first) first.focus();
      }, 60);
      box._close = close;
    });

  SM.confirm = (title, body, { confirmLabel = 'Confirm', danger = false } = {}) =>
    SM.modal({
      title,
      body,
      actions: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: confirmLabel, primary: !danger, danger }
      ]
    }).then((r) => r === 'ok');

  // ---------------------------------------------------------------- progress ring
  SM.ring = (percent, size = 64) => {
    const r = 26;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, percent || 0));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', 'ring');
    svg.style.width = size + 'px';
    svg.style.height = size + 'px';
    svg.innerHTML =
      `<circle class="bg" cx="32" cy="32" r="${r}"></circle>` +
      `<circle class="fg" cx="32" cy="32" r="${r}" transform="rotate(-90 32 32)" stroke-dasharray="0 ${c}"></circle>` +
      `<text x="32" y="33">${Math.round(pct)}%</text>`;
    requestAnimationFrame(() => {
      const fg = svg.querySelector('.fg');
      if (fg) fg.setAttribute('stroke-dasharray', `${(pct / 100) * c} ${c}`);
    });
    return svg;
  };

  // ---------------------------------------------------------------- stat cards / empty states
  SM.statCard = ({ label, value, hint, tone = 'info', iconName, onclick }) =>
    h(
      'div.card.stat.tone-' + tone + (onclick ? '.hoverable' : ''),
      { onclick, style: onclick ? { cursor: 'pointer' } : null },
      h('span.accent'),
      h('div.label', h('span.dot'), label),
      h('div.value', { 'data-value': value }, SM.fmt.int(value)),
      hint ? h('div.hint', hint) : null
    );

  SM.emptyState = ({ iconName = 'inbox', title, body, action }) =>
    h('div.empty', h('div.ico', icon(iconName)), h('h3', title), h('p', body), action || null);

  SM.alert = (type, content) => {
    const names = { info: 'info', warning: 'alert', danger: 'alert', success: 'check' };
    return h('div.alert.' + type, icon(names[type] || 'info'), h('div', { style: { minWidth: 0, flex: '1' } }, content));
  };

  // Animate a numeric element towards a value (smooth counter).
  SM.animateNumber = (el, to, duration = 600) => {
    const from = Number(el.dataset.current || 0);
    const target = Number(to) || 0;
    el.dataset.current = String(target);
    if (from === target) {
      el.textContent = SM.fmt.int(target);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = SM.fmt.int(Math.round(from + (target - from) * eased));
      if (t < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ---------------------------------------------------------------- routing
  SM.routes = {};
  SM.currentRoute = null;

  /* Navigation generation counter. Every navigation is given a token; async work
     belonging to an earlier navigation is stale the moment a newer one starts. */
  SM.currentNav = 0;
  /* Token of the navigation that owns the view currently mounted in #view. */
  SM.mountNav = 0;

  SM.route = (name, handler) => {
    SM.routes[name] = handler;
  };

  /**
   * Start a navigation: drop the previous route's event subscriptions and return
   * the token identifying this navigation.
   */
  SM.beginNav = (name) => {
    SM.releaseSubs();
    SM.currentNav += 1;
    SM.currentRoute = name;
    return SM.currentNav;
  };

  /** True when a newer navigation superseded the one holding `token`. */
  SM.isStaleNav = (token) => token !== SM.currentNav;

  /**
   * True when `node` belongs to a navigation that is no longer current, so the
   * caller must not write to the DOM on its behalf.
   */
  SM.stale = (node) => !node || !node.isConnected || SM.mountNav !== SM.currentNav;

  /** Set the top bar title/crumb and optional actions. */
  SM.setHeader = (title, crumb, actions) => {
    document.getElementById('page-title').textContent = title;
    document.getElementById('crumb').textContent = crumb || 'Super Mailer';
    const bar = document.getElementById('topbar-actions');
    SM.clear(bar);
    (actions || []).forEach((a) => bar.appendChild(a));
  };

  SM.setActiveNav = (name) => {
    SM.$$('#nav a').forEach((a) => {
      const on = a.dataset.route === name;
      a.classList.toggle('active', on);
      // Expose the selected page to assistive technology as well as visually.
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };

  SM.setBadge = (id, value, live) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined || value === '' || value === 0) el.hidden = true;
    else {
      el.hidden = false;
      el.textContent = typeof value === 'number' ? SM.fmt.int(value) : value;
    }
    if (live !== undefined) el.classList.toggle('live', !!live);
  };

  /**
   * Mount a view. The previous view is removed synchronously, so #view holds
   * exactly one feature page at any time.
   *
   * Removal used to be deferred by a 160ms timer. That left the outgoing page in
   * the DOM alongside the incoming one, and because only `firstElementChild` was
   * ever scheduled for removal, a second click inside that window left a stale
   * page stacked over the selected one permanently.
   */
  SM.mount = (node) => {
    const view = document.getElementById('view');
    const wrap = document.getElementById('view-wrap');
    SM.mountNav = SM.currentNav;
    SM.clear(view);
    const wrapper = h('div.view', node);
    wrapper.dataset.route = SM.currentRoute || '';
    view.appendChild(wrapper);
    wrap.scrollTop = 0;
    return wrapper;
  };

  /**
   * Subscribe to a main-process event for the lifetime of the current route.
   * Subscriptions are released automatically on navigation.
   */
  SM.subs = [];
  SM.listen = (channel, fn, owner) => {
    /* Some routes subscribe only after their first await. If the user has already
       navigated away, that subscription would be registered after the next
       navigation released the previous ones and would outlive its page, able to
       mutate global UI (badges, toasts) long afterwards. Callers that subscribe
       asynchronously pass the node they mounted so this can be detected. */
    if (owner && SM.stale(owner)) return () => {};
    const off = window.superMailer.on(channel, fn);
    SM.subs.push(off);
    return off;
  };
  SM.releaseSubs = () => {
    while (SM.subs.length) {
      try {
        SM.subs.pop()();
      } catch {
        /* ignore */
      }
    }
  };

  /** Safe wrapper around window.superMailer calls: shows a toast on failure. */
  SM.call = async (promise, { silent = false, errorTitle = 'Something went wrong' } = {}) => {
    try {
      const res = await promise;
      if (res && res.ok === false && !silent) {
        SM.toast('error', errorTitle, res.message || 'Please try again.');
      }
      return res;
    } catch (err) {
      if (!silent) SM.toast('error', errorTitle, (err && err.message) || 'Unexpected error.');
      return { ok: false, message: (err && err.message) || 'Unexpected error.' };
    }
  };

  /** Simple memory/localStorage-backed draft shared by Compose and Campaign views. */
  SM.draft = {
    key: 'sm.draft.v1',
    load() {
      try {
        return Object.assign(
          { name: '', subject: '', senderName: '', replyTo: '', bodyHtml: '', bodyText: '', footerHtml: '', plainAuto: true },
          JSON.parse(localStorage.getItem(this.key) || '{}')
        );
      } catch {
        return { name: '', subject: '', senderName: '', replyTo: '', bodyHtml: '', bodyText: '', footerHtml: '', plainAuto: true };
      }
    },
    save(d) {
      try {
        localStorage.setItem(this.key, JSON.stringify(d));
      } catch {
        /* storage may be unavailable; drafts are a convenience */
      }
    }
  };
})();
