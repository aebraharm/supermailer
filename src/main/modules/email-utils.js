'use strict';

/**
 * Email extraction, normalization and validation utilities.
 *
 * These are pure functions so they can be unit tested without Electron.
 */

// Permissive candidate finder: matches tokens that look like they contain an
// email address (requires at least one dot in the domain).
const CANDIDATE_REGEX =
  /[A-Za-z0-9][A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/g;

// Looser pattern used to surface *malformed* near-misses (e.g. "a@b" with no
// dot in the domain, "a@b.c" with a one-letter TLD). Anything matched here
// that is not already a valid address is reported as invalid/malformed.
const LOOSE_REGEX =
  /[A-Za-z0-9][A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g;

// Strict validation of a fully-formed address.
const STRICT_REGEX =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~](?:[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{0,62}[A-Za-z0-9!#$%&'*+/=?^_`{|}~])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

/** Normalize an address: trim, lowercase, strip common wrappers. */
function normalizeEmail(raw) {
  let email = String(raw === null || raw === undefined ? '' : raw)
    .trim()
    .toLowerCase();
  email = email.replace(/^mailto:/i, '');
  // Strip surrounding punctuation/brackets commonly found in documents.
  email = email.replace(/^[<([{]+/, '').replace(/[>)\].,;:!?'"]+$/, '');
  return email;
}

/**
 * Validate an email address.
 * Returns { valid: boolean, reason: string|null }.
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'empty' };
  }
  const trimmed = email.trim();
  if (trimmed.length === 0) return { valid: false, reason: 'empty' };
  if (trimmed.length > MAX_EMAIL_LENGTH) return { valid: false, reason: 'too_long' };
  if (/\s/.test(trimmed)) return { valid: false, reason: 'whitespace' };
  if (!STRICT_REGEX.test(trimmed)) return { valid: false, reason: 'malformed' };

  const atIndex = trimmed.indexOf('@');
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  if (local.length > MAX_LOCAL_LENGTH) return { valid: false, reason: 'local_too_long' };
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { valid: false, reason: 'malformed' };
  }

  const labels = domain.split('.');
  if (labels.length < 2) return { valid: false, reason: 'missing_tld' };
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) return { valid: false, reason: 'invalid_tld' };
  for (const label of labels) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)) {
      return { valid: false, reason: 'invalid_domain' };
    }
  }
  return { valid: true, reason: null };
}

/**
 * Extract email addresses from a block of text.
 * Returns { valid: string[], invalid: string[] } — normalized, lowercased,
 * deduplicated within each list.
 */
function extractEmailsFromText(text) {
  const valid = [];
  const invalid = [];
  if (!text || typeof text !== 'string') {
    return { valid, invalid };
  }

  const validSet = new Set();
  CANDIDATE_REGEX.lastIndex = 0;
  let match;
  while ((match = CANDIDATE_REGEX.exec(text)) !== null) {
    const email = normalizeEmail(match[0]);
    if (!email || validSet.has(email)) continue;
    const result = validateEmail(email);
    if (result.valid) {
      validSet.add(email);
      valid.push(email);
    }
  }

  const invalidSet = new Set();
  LOOSE_REGEX.lastIndex = 0;
  while ((match = LOOSE_REGEX.exec(text)) !== null) {
    const email = normalizeEmail(match[0]);
    if (!email || validSet.has(email) || invalidSet.has(email)) continue;
    const result = validateEmail(email);
    if (!result.valid) {
      invalidSet.add(email);
      invalid.push(email);
    }
  }

  return { valid, invalid };
}

/**
 * Build recipient records from text for a given source document.
 * Each record: { email, source, status: 'valid'|'invalid', reason }.
 */
function buildRecipientRecords(text, source) {
  const { valid, invalid } = extractEmailsFromText(text);
  const records = [];
  for (const email of valid) {
    records.push({ email, source, status: 'valid', reason: null });
  }
  for (const email of invalid) {
    records.push({ email, source, status: 'invalid', reason: validateEmail(email).reason });
  }
  return records;
}

/** Format an address with a display name for SMTP headers. */
function formatAddress(name, email) {
  const n = String(name || '').trim();
  const e = String(email || '').trim();
  if (!n) return e;
  // Quote the display name if it contains specials.
  if (/[",.:;<>]/.test(n)) {
    return `"${n.replace(/"/g, '\\"')}" <${e}>`;
  }
  return `${n} <${e}>`;
}

module.exports = {
  normalizeEmail,
  validateEmail,
  extractEmailsFromText,
  buildRecipientRecords,
  formatAddress,
  MAX_EMAIL_LENGTH,
  MAX_LOCAL_LENGTH
};
