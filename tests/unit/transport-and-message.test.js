'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyError, buildTransportOptions, SmtpTransport } = require('../../src/main/modules/transport-smtp');
const { buildMailOptions, renderForRecipient } = require('../../src/main/modules/message-builder');
const { renderTemplate, extractVariables, buildRecipientData } = require('../../src/main/modules/personalize');

test('classifyError: SMTP auth failures are kind=auth', () => {
  const e = classifyError(Object.assign(new Error('535 5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }));
  assert.equal(e.kind, 'auth');
  assert.match(e.userMessage, /Authentication failed/);
});

test('classifyError: timeouts and network errors are retryable kinds', () => {
  assert.equal(classifyError(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })).kind, 'timeout');
  assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ECONNECTION' })).kind, 'network');
  assert.equal(classifyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).kind, 'network');
});

test('classifyError: 4xx is temporary, 5xx is permanent', () => {
  assert.equal(classifyError(Object.assign(new Error('421 try later'), { responseCode: 421 })).kind, 'temporary');
  assert.equal(classifyError(Object.assign(new Error('550 no such user'), { responseCode: 550 })).kind, 'permanent');
});

test('classifyError scrubs secrets from the raw message', () => {
  const e = classifyError(new Error('login failed password=SuperSecret123'));
  assert.ok(!e.message.includes('SuperSecret123'));
});

test('buildTransportOptions: STARTTLS requires TLS, implicit TLS uses port 465', () => {
  const starttls = buildTransportOptions({ smtpHost: 'h', smtpPort: 587, encryption: 'starttls', smtpUser: 'u' }, 'pw');
  assert.equal(starttls.requireTLS, true);
  assert.equal(starttls.secure, false);
  assert.deepEqual(starttls.auth, { user: 'u', pass: 'pw' });
  assert.equal(starttls.tls.rejectUnauthorized, true, 'certificates must be verified by default');

  const tls = buildTransportOptions({ smtpHost: 'h', smtpPort: 465, encryption: 'tls' }, '');
  assert.equal(tls.secure, true);
  assert.equal(tls.auth, undefined, 'no auth block without a username');
  assert.equal(tls.pool, true);
  assert.equal(tls.maxConnections, 1, 'one pooled connection, not many');
  assert.ok(tls.connectionTimeout > 0 && tls.greetingTimeout > 0 && tls.socketTimeout > 0);
});

test('SmtpTransport.verify reports config problems without connecting', async () => {
  const t = new SmtpTransport({ smtpHost: '' }, '');
  const r = await t.verify();
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'config');
});

test('SmtpTransport.send classifies provider errors', async () => {
  const fake = { sendMail: async () => { throw Object.assign(new Error('535 bad'), { responseCode: 535, code: 'EAUTH' }); }, close() {} };
  const t = new SmtpTransport({ smtpHost: 'h', smtpPort: 587, encryption: 'starttls' }, 'x', { createTransport: () => fake });
  await assert.rejects(() => t.send({}), (err) => err.kind === 'auth');
});

test('personalization fills first_name, last_name and email, and escapes HTML', () => {
  const data = buildRecipientData({ email: 'a@x.com', firstName: 'Ann', lastName: '<b>Lee</b>', extra: { Company: 'Acme & Co' } });
  assert.equal(renderTemplate('Hi {{ first_name }} {{last_name}} at {{company}} ({{email}})', data), 'Hi Ann &lt;b&gt;Lee&lt;/b&gt; at Acme &amp; Co (a@x.com)');
  assert.equal(renderTemplate('Hi {{first_name}}', data, { escape: false }), 'Hi Ann');
  assert.equal(renderTemplate('{{unknown}}', data), '');
  assert.deepEqual(extractVariables('{{first_name}} {{Email}} {{first_name}}').sort(), ['email', 'first_name']);
});

test('buildMailOptions sets From, Reply-To and List-Unsubscribe only from configured values', () => {
  const campaign = {
    subject: 'Hello {{first_name}}',
    bodyHtml: '<p>Hi {{first_name}}</p>',
    bodyText: '',
    senderName: 'Acme',
    fromEmail: 'sales@acme.com',
    replyTo: 'replies@acme.com',
    listUnsubscribe: '<https://acme.com/unsub?e={{email}}>'
  };
  const { mail } = buildMailOptions(campaign, { email: 'ann@x.com', firstName: 'Ann', extra: {} });
  assert.equal(mail.from, 'Acme <sales@acme.com>');
  assert.equal(mail.replyTo, 'replies@acme.com');
  assert.equal(mail.subject, 'Hello Ann');
  assert.match(mail.text, /Hi Ann/, 'plain-text fallback generated from HTML');
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(!('Bcc' in mail) && !('X-Mailer' in mail.headers), 'no spoofed or extra headers');
});

test('buildMailOptions refuses invalid recipient addresses', () => {
  assert.throws(() => buildMailOptions({ subject: 's', bodyHtml: 'b', fromEmail: 'a@b.co' }, { email: 'nope' }), /Invalid recipient/);
});

test('subject is single-line and capped', () => {
  const r = renderForRecipient({ subject: 'Line1\nLine2 ' + 'x'.repeat(400), bodyHtml: '', fromEmail: 'a@b.co' }, { email: 'a@b.co', extra: {} });
  assert.ok(!r.subject.includes('\n'));
  assert.ok(r.subject.length <= 300);
});
