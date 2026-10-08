'use strict';

/**
 * Personalization (mail-merge) utilities.
 *
 * Supported variables include {{first_name}}, {{last_name}} and {{email}},
 * plus any additional columns imported from a recipient CSV (matched
 * case-insensitively, spaces/underscores interchangeable).
 */

const VAR_REGEX = /\{\{\s*([A-Za-z0-9_ ]+?)\s*\}\}/g;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Canonicalize a variable name: lowercase, spaces -> underscores. */
function canonicalKey(key) {
  return String(key).trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Render a template by replacing {{variable}} tokens with values from `data`.
 * Unknown variables are replaced with an empty string.
 * When `escape` is true (default) values are HTML-escaped — use for HTML
 * bodies and subjects rendered into HTML contexts. Pass escape:false for
 * plain-text bodies.
 */
function renderTemplate(template, data, options = {}) {
  if (!template) return '';
  const escape = options.escape !== false;
  const values = data || {};
  return String(template).replace(VAR_REGEX, (whole, key) => {
    const k = canonicalKey(key);
    const value = values[k];
    if (value === undefined || value === null) return '';
    const str = String(value);
    return escape ? escapeHtml(str) : str;
  });
}

/** List the distinct variable names used in a template. */
function extractVariables(template) {
  const found = new Set();
  if (!template) return [];
  String(template).replace(VAR_REGEX, (whole, key) => {
    found.add(canonicalKey(key));
    return whole;
  });
  return [...found];
}

/** Convert an HTML fragment to readable plain text (fallback body). */
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Build the personalization data object for a recipient record.
 * Always provides `email`; provides first_name/last_name when known;
 * merges any extra CSV columns (canonicalized).
 */
function buildRecipientData(recipient) {
  const data = { email: (recipient && recipient.email) || '' };
  if (!recipient) return data;
  if (recipient.firstName) data.first_name = String(recipient.firstName);
  if (recipient.lastName) data.last_name = String(recipient.lastName);
  if (recipient.extra && typeof recipient.extra === 'object') {
    for (const [key, value] of Object.entries(recipient.extra)) {
      data[canonicalKey(key)] = value === null || value === undefined ? '' : String(value);
    }
  }
  return data;
}

module.exports = {
  renderTemplate,
  extractVariables,
  htmlToText,
  buildRecipientData,
  escapeHtml,
  canonicalKey
};
