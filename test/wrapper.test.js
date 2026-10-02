import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runWrapped, resetBreaker, backoffSeconds } from '../src/wrapper.js';
import { readRecent, readBreaker, logFile } from '../src/ledger.js';
import { ROOT, tmpDir, sink } from './helpers.js';

const sh = (script) => ['/bin/sh', '-c', script];
const run = (logDir, label, script, extra = {}) => {
  const out = sink();
  const err = sink();
  return runWrapped({ label, argv: sh(script), logDir, stdout: out, stderr: err, forwardSignals: false, ...extra }).then((code) => ({ code, out: out.text(), err: err.text() }));
};
const rows = (dir) => readRecent(dir, { days: 2 });

test('backoff doubles from 15 minutes and stops at 6 hours', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds), [900, 1800, 3600, 7200, 14400, 21600, 21600]);
});

test('a clean run passes its output through and writes an ok row', async () => {
  const dir = tmpDir();
  const r = await run(dir, 'com.test.ok', 'echo first; echo second');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'first\nsecond\n');
  const [row] = rows(dir);
  assert.equal(row.status, 'ok');
  assert.equal(row.code, 0);
  assert.equal(row.said, 'second');
  assert.equal(readBreaker(dir, 'com.test.ok'), null);
  assert.equal(fs.readdirSync(path.join(dir, 'running')).length, 0, 'the running marker is cleared');
});

test('three failures with the same code trip the breaker, and reset clears it', async () => {
  const dir = tmpDir();
  for (let i = 1; i <= 3; i++) {
    const r = await run(dir, 'com.test.bad', 'echo no >&2; exit 3', { noBackoff: true });
    assert.equal(r.code, 3, 'the wrapper exits with the job code');
    assert.equal(readBreaker(dir, 'com.test.bad').fails, i);
  }
  assert.equal(readBreaker(dir, 'com.test.bad').tripped, true);
  const marker = path.join(dir, 'ran');
  const skipped = await run(dir, 'com.test.bad', `touch ${marker}`, { noBackoff: true });
  assert.equal(skipped.code, 0, 'a skipped tick exits 0');
  assert.equal(fs.existsSync(marker), false, 'a tripped job does not run');
  const all = rows(dir);
  assert.equal(all.at(-1).status, 'tripped');
  assert.equal(all.at(-2).tripped, true);
  assert.equal(resetBreaker(dir, 'com.test.bad'), true);
  const again = await run(dir, 'com.test.bad', `touch ${marker}`);
  assert.equal(again.code, 0);
  assert.equal(fs.existsSync(marker), true, 'after reset it runs');
  assert.equal(readBreaker(dir, 'com.test.bad'), null, 'success clears the state');
});

test('a moving exit code only backs off', async () => {
  const dir = tmpDir();
  for (const code of [3, 4, 3, 4]) await run(dir, 'com.test.moving', `exit ${code}`, { noBackoff: true });
  const s = readBreaker(dir, 'com.test.moving');
  assert.equal(s.fails, 1);
  assert.equal(s.tripped, false);
});

test('a failure holds the next tick back until the backoff passes', async () => {
  const dir = tmpDir();
  let t = Date.parse('2026-10-01T12:00:00Z');
  const now = () => t;
  await run(dir, 'com.test.hold', 'exit 2', { now });
  const marker = path.join(dir, 'ran');
  t += 60e3;
  const held = await run(dir, 'com.test.hold', `touch ${marker}`, { now });
  assert.equal(held.code, 0);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(readRecent(dir, { now: t, days: 1 }).at(-1).status, 'held');
  t += 16 * 60e3;
  const after = await run(dir, 'com.test.hold', `touch ${marker}`, { now });
  assert.equal(after.code, 0);
  assert.equal(fs.existsSync(marker), true, 'it runs once the 15 minute floor has passed');
});

test('exit 75 is a deferral, not a failure', async () => {
  const dir = tmpDir();
  const r = await run(dir, 'com.test.later', 'exit 75');
  assert.equal(r.code, 0);
  assert.equal(rows(dir).at(-1).status, 'held');
  assert.equal(readBreaker(dir, 'com.test.later'), null);
});

test('a run past its ceiling is stopped and recorded as exit 124', async () => {
  const dir = tmpDir();
  const r = await run(dir, 'com.test.slow', 'sleep 5', { maxRuntime: 1, killGraceMs: 500, noBackoff: true });
  assert.equal(r.code, 124);
  const row = rows(dir).at(-1);
  assert.equal(row.code, 124);
  assert.match(row.reason, /1s ceiling/);
});

test('a missing command is exit 127', async () => {
  const dir = tmpDir();
  const err = sink();
  const code = await runWrapped({ label: 'com.test.missing', argv: ['/no/such/program'], logDir: dir, stdout: sink(), stderr: err, forwardSignals: false });
  assert.equal(code, 127);
  assert.match(rows(dir).at(-1).said, /command not found/);
});

test('--log appends the output with a start and an exit line', async () => {
  const dir = tmpDir();
  await run(dir, 'com.test.log', 'echo logged', { log: true });
  const text = fs.readFileSync(logFile(dir, 'com.test.log'), 'utf8');
  assert.match(text, /^=== .* start: \/bin\/sh -c echo logged\nlogged\n=== .* exit 0 in /);
});

test('the command line wrapper exits with the job code', () => {
  const dir = tmpDir();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'run', 'com.test.cli', '--log-dir', dir, '--', '/bin/sh', '-c', 'echo from-cli; exit 5'], { encoding: 'utf8' });
  assert.equal(r.status, 5);
  assert.equal(r.stdout, 'from-cli\n');
  assert.equal(rows(dir).at(-1).code, 5);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.js'), 'run', 'com.test.cli', '--log-dir', dir], { encoding: 'utf8' });
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /put the command after --/);
});
