'use strict';

/** Small, dependency-free input validators for IPC payloads. */

const MAX_STRING = 200000;

function str(v, max = MAX_STRING, fallback = '') {
  if (v === null || v === undefined) return fallback;
  return String(v).slice(0, max);
}

function strArray(v, maxItems = 5000, maxLen = 1000) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).filter((x) => typeof x === 'string').map((x) => x.slice(0, maxLen));
}

function int(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Remove active content from user-authored HTML before it is sent as an email:
 * scripts, frames, embedded objects, forms, and inline event handlers.
 */
function sanitizeEmailHtml(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|frame|frameset|object|embed|applet|form|meta|link|base)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|frame|object|embed|applet|form|meta|link|base)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

/** Sanitize a campaign draft coming from the renderer. */
function sanitizeDraft(d) {
  const draft = d && typeof d === 'object' ? d : {};
  return {
    name: str(draft.name, 120),
    subject: str(draft.subject, 500),
    senderName: str(draft.senderName, 200),
    replyTo: str(draft.replyTo, 320),
    bodyHtml: sanitizeEmailHtml(str(draft.bodyHtml, 500000)),
    bodyText: str(draft.bodyText, 200000),
    footerHtml: sanitizeEmailHtml(str(draft.footerHtml, 20000)),
    listUnsubscribe: str(draft.listUnsubscribe, 1000)
  };
}

module.exports = { str, strArray, int, sanitizeDraft, sanitizeEmailHtml, MAX_STRING };
