'use strict';

/**
 * End-to-end test: a controlled list of recipients is sent through the REAL
 * stack — CampaignManager → SendQueue → RateLimiter → nodemailer SMTP transport
 * → a local SMTP server that enforces AUTH and records what it received.
 *
 * Covers: successful send, personalization, authentication failure,
 * permanent rejection (suppression), temporary rejection (retry success),
 * test-email sending, connection failure, and the confirmation gate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { SMTPServer } = require('smtp-server');

const { CampaignManager } = require('../../src/main/modules/campaign-manager');
const { SettingsStore } = require('../../src/main/modules/settings');
const { CredentialManager } = require('../../src/main/modules/credential-manager');
const { HistoryStore } = require('../../src/main/modules/history-store');
const { SuppressionStore } = require('../../src/main/modules/suppression-store');
const { Logger } = require('../../src/main/modules/logger');
const { makeTempDir } = require('../helpers/fixtures');

const USER = 'mailer@test.local';
const PASSWORD = 'correct-horse-battery';
const REJECT_PERMANENT = 'nobody@rejected.test';
const REJECT_TEMPORARY_ONCE = 'busy@deferred.test';

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
};

/** Start a local SMTP server that behaves like a provider with rules. */
async function startSmtpServer() {
  const received = [];
  const deferredSeen = new Set();
  let authAttempts = 0;
  const server = new SMTPServer({
    secure: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    authOptional: false,
    logger: false,
    onAuth(auth, session, callback) {
      authAttempts += 1;
      if (auth.username === USER && auth.password === PASSWORD) return callback(null, { user: USER });
      const err = new Error('Invalid username or password');
      err.responseCode = 535;
      return callback(err);
    },
    onRcptTo(address, session, callback) {
      const addr = address.address.toLowerCase();
      if (addr === REJECT_PERMANENT) {
        const err = new Error('550 5.1.1 user unknown');
        err.responseCode = 550;
        return callback(err);
      }
      if (addr === REJECT_TEMPORARY_ONCE && !deferredSeen.has(addr)) {
        deferredSeen.add(addr);
        const err = new Error('451 4.3.0 try again later');
        err.responseCode = 451;
        return callback(err);
      }
      return callback();
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        received.push({
          rcpt: session.envelope.rcptTo.map((r) => r.address.toLowerCase()),
          from: session.envelope.mailFrom && session.envelope.mailFrom.address,
          raw
        });
        callback(null, 'queued');
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.server.address().port,
    received,
    get authAttempts() {
      return authAttempts;
    },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function setup(port, overrides = {}) {
  const dir = makeTempDir('sm-e2e-');
  const settings = new SettingsStore(path.join(dir, 'settings.json'));
  settings.update({
    senderName: 'Acme Newsletter',
    senderEmail: USER,
    replyTo: 'replies@test.local',
    smtpHost: '127.0.0.1',
    smtpPort: port,
    encryption: 'none',
    smtpUser: USER,
    sendingRatePerMinute: 6000,
    maxRetries: 2,
    retryDelaySeconds: [1, 1],
    connectionTimeoutSec: 5,
    greetingTimeoutSec: 5,
    socketTimeoutSec: 10,
    ...overrides
  });
  const credentials = new CredentialManager({ safeStorage: fakeSafeStorage, filePath: path.join(dir, 'credentials.json') });
  credentials.storeCredential('smtp-secret', PASSWORD);
  const suppression = new SuppressionStore(path.join(dir, 'suppressed.json'));
  const history = new HistoryStore(path.join(dir, 'history.json'));
  const logger = new Logger(path.join(dir, 'app.log'), { console: false });
  const manager = new CampaignManager({
    settings,
    credentials,
    suppression,
    history,
    logger,
    queueOptions: { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))), now: undefined }
  });
  return { dir, settings, credentials, suppression, history, logger, manager, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function waitForFinish(manager, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Campaign did not finish in time')), timeoutMs);
    manager.once('finished', (evt) => {
      clearTimeout(timer);
      resolve(evt);
    });
  });
}

function waitForEvent(emitter, name, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), timeoutMs);
    emitter.once(name, (evt) => {
      clearTimeout(timer);
      resolve(evt);
    });
  });
}

const DRAFT = {
  name: 'October Newsletter',
  subject: 'Hello {{first_name}}, news for you',
  bodyHtml: '<p>Hi {{first_name}}, your address is {{email}}.</p>',
  bodyText: ''
};

test('E2E: sends a controlled campaign with personalization, auth and Reply-To', async (t) => {
  const smtp = await startSmtpServer();
  const env = setup(smtp.port);
  t.after(async () => {
    await smtp.close();
    env.cleanup();
  });

  const recipients = [
    { email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', extra: {} },
    { email: 'ben@example.com', firstName: 'Ben', lastName: 'Ray', extra: {} },
    { email: 'cy@example.com', firstName: 'Cy', lastName: 'Ng', extra: {} }
  ];

  // Confirmation gate: wrong count must be rejected before anything is sent.
  const refused = env.manager.start(DRAFT, recipients, 2);
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0], /Confirmation mismatch/);
  assert.equal(smtp.received.length, 0);

  const started = env.manager.start(DRAFT, recipients, 3);
  assert.equal(started.ok, true, JSON.stringify(started.errors));
  const finished = await waitForFinish(env.manager);

  assert.equal(finished.status, 'completed');
  assert.equal(smtp.received.length, 3);
  const first = smtp.received.find((m) => m.rcpt.includes('ann@example.com'));
  assert.ok(first, 'Ann received a message');
  assert.match(first.raw, /Subject: Hello Ann, news for you/);
  assert.match(first.raw, /Hi Ann, your address is ann@example.com/);
  assert.match(first.raw, /Reply-To: replies@test\.local/i);
  assert.match(first.raw, /From: "?Acme Newsletter"? <mailer@test\.local>/);
  assert.equal(first.from, USER);
  assert.ok(first.raw.includes('text/plain'), 'includes plain-text fallback');

  const hist = env.history.get(started.campaignId);
  assert.equal(hist.status, 'completed');
  assert.equal(hist.recipientCount, 3);
  assert.equal(hist.successfulCount, 3);
  assert.equal(hist.failedCount, 0);
  assert.equal(hist.results.length, 3);
  assert.ok(hist.durationMs >= 0);
  // History must not contain the password or the message body.
  const histRaw = fs.readFileSync(path.join(env.dir, 'history.json'), 'utf8');
  assert.ok(!histRaw.includes(PASSWORD));
  assert.ok(!histRaw.includes('your address is'));
});

test('E2E: permanent rejections are recorded as failed and suppressed; temporary ones are retried', async (t) => {
  const smtp = await startSmtpServer();
  const env = setup(smtp.port);
  t.after(async () => {
    await smtp.close();
    env.cleanup();
  });
  const recipients = [
    { email: 'good@example.com', firstName: 'G', extra: {} },
    { email: REJECT_PERMANENT, firstName: 'N', extra: {} },
    { email: REJECT_TEMPORARY_ONCE, firstName: 'B', extra: {} }
  ];
  const started = env.manager.start(DRAFT, recipients, 3);
  assert.equal(started.ok, true);
  await waitForFinish(env.manager);

  const hist = env.history.get(started.campaignId);
  assert.equal(hist.successfulCount, 2, 'good + deferred-then-delivered');
  assert.equal(hist.failedCount, 1);
  const failed = hist.results.find((r) => r.status === 'failed');
  assert.equal(failed.email, REJECT_PERMANENT);
  assert.equal(failed.kind, 'permanent');
  const retried = hist.results.find((r) => r.email === REJECT_TEMPORARY_ONCE);
  assert.equal(retried.status, 'sent');
  assert.ok(retried.attempts >= 2, 'temporary failure was retried');

  assert.equal(env.suppression.has(REJECT_PERMANENT), true, 'permanent bounce suppressed');
  // The suppressed address must be skipped by the next campaign.
  const preflight = env.manager.preflight(DRAFT, recipients);
  assert.equal(preflight.stats.suppressed, 1);
});

test('E2E: wrong password pauses the campaign and reports an authentication error', async (t) => {
  const smtp = await startSmtpServer();
  const env = setup(smtp.port);
  t.after(async () => {
    await smtp.close();
    env.cleanup();
  });
  env.credentials.storeCredential('smtp-secret', 'wrong-password');

  const alert = waitForEvent(env.manager, 'alert');
  const paused = waitForEvent(env.manager, 'paused');
  const started = env.manager.start(DRAFT, [
    { email: 'a1@example.com', firstName: 'A', extra: {} },
    { email: 'a2@example.com', firstName: 'B', extra: {} }
  ], 2);
  assert.equal(started.ok, true);
  const alertEvt = await alert;
  assert.equal(alertEvt.kind, 'auth');
  assert.match(alertEvt.message, /Authentication failed/);
  await paused;

  assert.equal(smtp.received.length, 0, 'nothing delivered with wrong credentials');
  assert.equal(env.manager.status().state, 'paused', 'campaign waits for the user');
  // Stop the stuck campaign cleanly.
  env.manager.cancel();
  await waitForFinish(env.manager);
  assert.equal(env.history.get(started.campaignId).status, 'cancelled');
});

test('E2E: test-email sends one message and reports success clearly', async (t) => {
  const smtp = await startSmtpServer();
  const env = setup(smtp.port);
  t.after(async () => {
    await smtp.close();
    env.cleanup();
  });
  const result = await env.manager.sendTest(DRAFT, 'me@example.com');
  assert.equal(result.ok, true, result.message);
  assert.equal(smtp.received.length, 1);
  assert.match(smtp.received[0].raw, /Subject: \[TEST\]/);
  assert.match(smtp.received[0].raw, /Hi Test, your address is me@example\.com/);
});

test('E2E: connection test reports success and authentication failure', async (t) => {
  const smtp = await startSmtpServer();
  const env = setup(smtp.port);
  t.after(async () => {
    await smtp.close();
    env.cleanup();
  });
  const ok = await env.manager.testConnection();
  assert.equal(ok.ok, true, ok.message);
  assert.match(ok.message, /Authentication succeeded/);

  const bad = await env.manager.testConnection({ secret: 'nope' });
  assert.equal(bad.ok, false);
  assert.equal(bad.kind, 'auth');
});

test('E2E: unreachable SMTP server is reported as a connection problem, not a crash', async (t) => {
  const env = setup(1, { smtpPort: 1 }); // port 1 is closed
  t.after(() => env.cleanup());
  const result = await env.manager.testConnection();
  assert.equal(result.ok, false);
  assert.ok(['network', 'timeout'].includes(result.kind), `kind was ${result.kind}`);
  assert.match(result.message, /mail server|network|connection/i);
});

test('E2E: preflight blocks campaigns over 1,000 recipients and invalid drafts', async (t) => {
  const env = setup(1);
  t.after(() => env.cleanup());
  const big = Array.from({ length: 1001 }, (_, i) => ({ email: `u${i}@example.com`, extra: {} }));
  const check = env.manager.preflight(DRAFT, big);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /at most 1,000/.test(e)));

  const noSubject = env.manager.preflight({ ...DRAFT, subject: '' }, [{ email: 'x@example.com', extra: {} }]);
  assert.ok(noSubject.errors.some((e) => /subject/i.test(e)));
});
