import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, jobDetail, unwrap } from '../src/collect.js';
import { fixtureConfig, deps, NOW } from './helpers.js';

const snap = collect(fixtureConfig(), deps());
const job = (label) => snap.jobs.find((j) => j.label === label);

test('reads the example plists and the fixture plists under the prefix', () => {
  assert.deepEqual(snap.jobs.map((j) => j.label).sort(), [
    'com.example.broken', 'com.example.daemon', 'com.example.flaky', 'com.example.killed',
    'com.example.launchboard.hello', 'com.example.launchboard.morning', 'com.example.unwrapped',
  ]);
  assert.equal(job('com.other.notours'), undefined);
});

test('states come from launchd, the ledger and the breaker', () => {
  assert.equal(job('com.example.daemon').state, 'running');
  assert.equal(job('com.example.daemon').pid, 4242);
  assert.equal(job('com.example.flaky').state, 'tripped');
  assert.equal(job('com.example.unwrapped').state, 'failed');
  assert.deepEqual(job('com.example.unwrapped').lastExit, { code: 2, words: 'exit 2', source: 'launchd', at: null });
  assert.equal(job('com.example.killed').state, 'failed');
  assert.equal(job('com.example.killed').lastExit.words, 'killed by SIGKILL');
  assert.equal(job('com.example.launchboard.hello').state, 'ok');
  assert.equal(job('com.example.launchboard.morning').state, 'ok');
  assert.equal(job('com.example.broken').state, 'unreadable');
  assert.ok(job('com.example.broken').error);
  assert.deepEqual(snap.jobs.slice(0, 2).map((j) => j.state), ['running', 'tripped'], 'sorted by state');
});

test('what each job did today', () => {
  const hello = job('com.example.launchboard.hello');
  assert.equal(hello.wrapped, true);
  assert.equal(hello.program, '/bin/echo hello from launchd, every five minutes');
  assert.deepEqual({ runs: hello.today.runs, ok: hello.today.ok, failed: hello.today.failed, held: hello.today.held }, { runs: 4, ok: 3, failed: 1, held: 1 });
  assert.equal(hello.today.rows[0].end, '2026-10-01T19:30:00.045Z', 'newest first');
  assert.equal(hello.lastExit.code, 0);
  assert.equal(hello.lastExit.source, 'ledger');
  assert.equal(job('com.example.launchboard.morning').today.runs, 0);
  assert.equal(snap.counts.runsToday, 5);
  assert.equal(snap.counts.failedToday, 2);
});

test('schedules and next runs', () => {
  const hello = job('com.example.launchboard.hello');
  assert.equal(hello.schedule.text, 'every 5 minutes, and once when it loads');
  assert.equal(hello.next, NOW + 300e3);
  const morning = job('com.example.launchboard.morning');
  const nine = new Date(NOW);
  nine.setHours(9, 0, 0, 0);
  if (nine.getTime() <= NOW) nine.setDate(nine.getDate() + 1);
  assert.equal(morning.next, nine.getTime());
  assert.equal(job('com.example.unwrapped').schedule.text, 'at 08:30 on Mondays');
  assert.equal(job('com.example.killed').schedule.text, 'when a watched path changes');
  assert.equal(job('com.example.daemon').schedule.kind, 'daemon');
});

test('the last lines of each log', () => {
  const hello = job('com.example.launchboard.hello');
  assert.equal(hello.logs.length, 1);
  assert.deepEqual(hello.logs[0].tail.slice(1, 2), ['hello from launchd, every five minutes']);
  const d = jobDetail(fixtureConfig(), 'com.example.launchboard.hello', deps());
  assert.equal(d.job.logs[0].tail.length, 3);
  assert.equal(jobDetail(fixtureConfig(), 'com.example.nope', deps()), null);
});

test('the feed holds today\'s rows for jobs on the board, newest first', () => {
  assert.equal(snap.feed[0].label, 'com.example.launchboard.hello');
  assert.ok(snap.feed.every((r) => r.label !== 'com.other.notours'));
  assert.equal(snap.feed.length, 7);
});

test('counts', () => {
  assert.deepEqual(
    { jobs: snap.counts.jobs, running: snap.counts.running, failed: snap.counts.failed, tripped: snap.counts.tripped, wrapped: snap.counts.wrapped },
    { jobs: 7, running: 1, failed: 2, tripped: 1, wrapped: 3 },
  );
});

test('exclude hides jobs and an empty prefix shows every plist', () => {
  assert.equal(collect(fixtureConfig({ exclude: ['com.example.launchboard.'] }), deps()).counts.jobs, 5);
  assert.equal(collect(fixtureConfig({ prefix: [] }), deps()).counts.jobs, 8);
});

test('without launchctl the board says so and still reads the ledger', () => {
  const s = collect(fixtureConfig(), deps({ launchctl: () => ({ ok: false, jobs: new Map(), error: 'launchctl exists only on macOS' }) }));
  assert.equal(s.launchctl.ok, false);
  const hello = s.jobs.find((j) => j.label === 'com.example.launchboard.hello');
  assert.equal(hello.state, 'ok');
});

test('finds the wrapper in program arguments', () => {
  assert.deepEqual(unwrap(['/usr/bin/env', 'launchboard', 'run', 'a.b', '--log', '--', '/bin/echo', 'hi']), { label: 'a.b', argv: ['/bin/echo', 'hi'] });
  assert.deepEqual(unwrap(['/usr/local/bin/node', '/opt/x/launchboard/src/cli.js', 'run', 'a.b', '--', 'x']), { label: 'a.b', argv: ['x'] });
  assert.equal(unwrap(['/bin/echo', 'run', 'launchboard']), null);
});
