'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../../src/main/modules/rate-limiter');
const { SendQueue } = require('../../src/main/modules/send-queue');

/** Fake clock: sleep advances time instantly, so tests are fast and deterministic. */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
    get t() {
      return t;
    }
  };
}

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, email: `u${i}@x.com`, payload: {} }));
const err = (kind, message = kind) => Object.assign(new Error(message), { kind, userMessage: message });

test('RateLimiter spaces sends evenly to the configured per-minute rate', async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter({ perMinute: 60, now: clock.now, sleep: clock.sleep });
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    await limiter.acquire();
    times.push(clock.t);
  }
  for (let i = 1; i < times.length; i += 1) {
    assert.equal(times[i] - times[i - 1], 1000, 'one send per second at 60/min');
  }
});

test('RateLimiter clamps invalid rates to a safe default', () => {
  const limiter = new RateLimiter({ perMinute: 'nope' });
  assert.equal(limiter.perMinute, 30);
  limiter.setRate(5000);
  assert.equal(limiter.perMinute, 1000);
});

test('RateLimiter.acquire returns false when aborted', async () => {
  const limiter = new RateLimiter({ perMinute: 1 });
  const res = await limiter.acquire({ aborted: true });
  assert.equal(res, false);
});

test('queue sends every job exactly once on success and reports progress', async () => {
  const clock = fakeClock();
  const sent = [];
  const q = new SendQueue({
    perMinute: 6000,
    now: clock.now,
    sleep: clock.sleep,
    send: async (job) => {
      sent.push(job.email);
      return { messageId: 'm-' + job.id };
    }
  });
  q.load(jobs(10));
  const final = await q.start();
  assert.equal(sent.length, 10);
  assert.equal(new Set(sent).size, 10, 'no duplicate sends');
  assert.equal(final.sent, 10);
  assert.equal(final.failed, 0);
  assert.equal(final.percent, 100);
  assert.equal(q.state, 'finished');
});

test('temporary errors are retried and eventually succeed', async () => {
  const clock = fakeClock();
  const attempts = {};
  const q = new SendQueue({
    perMinute: 6000,
    maxRetries: 3,
    retryDelaySeconds: [1, 2, 3],
    now: clock.now,
    sleep: clock.sleep,
    send: async (job) => {
      attempts[job.id] = (attempts[job.id] || 0) + 1;
      if (attempts[job.id] < 3) throw err('temporary', 'try later');
      return {};
    }
  });
  q.load(jobs(2));
  const final = await q.start();
  assert.equal(final.sent, 2);
  assert.equal(final.failed, 0);
  assert.equal(final.retries, 4);
  assert.ok(Object.values(attempts).every((a) => a === 3));
});

test('retries are capped by maxRetries and then marked failed', async () => {
  const clock = fakeClock();
  let calls = 0;
  const q = new SendQueue({
    perMinute: 6000,
    maxRetries: 2,
    retryDelaySeconds: [1],
    now: clock.now,
    sleep: clock.sleep,
    send: async () => {
      calls += 1;
      throw err('timeout', 'slow');
    }
  });
  q.load(jobs(1));
  const final = await q.start();
  assert.equal(calls, 3, 'initial attempt + 2 retries');
  assert.equal(final.failed, 1);
  assert.equal(q.jobs[0].failureKind, 'timeout');
});

test('permanent errors are not retried', async () => {
  const clock = fakeClock();
  let calls = 0;
  const q = new SendQueue({
    perMinute: 6000,
    maxRetries: 5,
    now: clock.now,
    sleep: clock.sleep,
    send: async () => {
      calls += 1;
      throw err('permanent', 'no such user');
    }
  });
  q.load(jobs(1));
  const final = await q.start();
  assert.equal(calls, 1);
  assert.equal(final.failed, 1);
});

test('retry delays follow the configured schedule (backoff)', async () => {
  const clock = fakeClock();
  const seenAt = [];
  const q = new SendQueue({
    perMinute: 6000,
    maxRetries: 2,
    retryDelaySeconds: [5, 20],
    now: clock.now,
    sleep: clock.sleep,
    send: async () => {
      seenAt.push(clock.t);
      throw err('temporary');
    }
  });
  q.load(jobs(1));
  await q.start();
  assert.equal(seenAt.length, 3);
  assert.ok(seenAt[1] - seenAt[0] >= 5000, 'first retry waits at least 5s');
  assert.ok(seenAt[2] - seenAt[1] >= 20000, 'second retry waits at least 20s');
});

test('pause stops new sends and resume continues the queue', async () => {
  const clock = fakeClock();
  let q;
  let sends = 0;
  q = new SendQueue({
    perMinute: 6000,
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms);
      await new Promise((r) => setImmediate(r));
    },
    send: async () => {
      sends += 1;
      if (sends === 3) q.pause('test pause');
      return {};
    }
  });
  q.load(jobs(6));
  const done = q.start();
  // Wait until the queue reports paused.
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (q.state === 'paused') {
        clearInterval(iv);
        resolve();
      }
    }, 2);
  });
  const sendsAtPause = sends;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sends, sendsAtPause, 'no sends while paused');
  assert.equal(q.progress().pauseReason, 'test pause');
  assert.equal(q.resume(), true);
  const final = await done;
  assert.equal(final.sent, 6);
});

test('cancel stops remaining work and marks queued jobs cancelled', async () => {
  const clock = fakeClock();
  let q;
  let sends = 0;
  q = new SendQueue({
    perMinute: 6000,
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms);
      await new Promise((r) => setImmediate(r));
    },
    send: async () => {
      sends += 1;
      if (sends === 2) q.cancel();
      return {};
    }
  });
  q.load(jobs(10));
  const final = await q.start();
  assert.equal(q.state, 'cancelled');
  assert.equal(sends, 2);
  assert.equal(final.sent, 2);
  assert.equal(final.skipped, 8);
  assert.equal(final.remaining, 0);
});

test('authentication errors pause the campaign instead of burning the list', async () => {
  const clock = fakeClock();
  let calls = 0;
  let q;
  q = new SendQueue({
    perMinute: 6000,
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms);
      await new Promise((r) => setImmediate(r));
    },
    send: async () => {
      calls += 1;
      throw err('auth', 'bad password');
    }
  });
  q.load(jobs(20));
  const done = q.start();
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (q.state === 'paused') {
        clearInterval(iv);
        resolve();
      }
    }, 2);
  });
  assert.equal(calls, 1, 'only one attempt before pausing for auth');
  assert.match(q.pauseReason, /Authentication failed/);
  q.cancel();
  await done;
});

test('repeated network failures auto-pause the queue', async () => {
  const clock = fakeClock();
  let q;
  q = new SendQueue({
    perMinute: 6000,
    maxRetries: 0,
    maxConsecutiveNetworkErrors: 3,
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms);
      await new Promise((r) => setImmediate(r));
    },
    send: async () => {
      throw err('network', 'offline');
    }
  });
  q.load(jobs(10));
  const done = q.start();
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (q.state === 'paused') {
        clearInterval(iv);
        resolve();
      }
    }, 2);
  });
  assert.match(q.pauseReason, /connection problems/);
  q.cancel();
  await done;
});

test('concurrency never exceeds the configured limit', async () => {
  const clock = fakeClock();
  let inFlight = 0;
  let maxSeen = 0;
  const q = new SendQueue({
    perMinute: 6000,
    concurrency: 3,
    now: clock.now,
    sleep: async (ms) => {
      clock.advance(ms);
      await new Promise((r) => setImmediate(r));
    },
    send: async () => {
      inFlight += 1;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return {};
    }
  });
  q.load(jobs(12));
  await q.start();
  assert.ok(maxSeen <= 3, `max in flight was ${maxSeen}`);
  assert.equal(q.progress().sent, 12);
});
