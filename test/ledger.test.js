import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLedger, readDay, readRecent, summarize, dayKey, midnight, appendRow, readAllBreakers, readRunning, writeRunning, clearRunning } from '../src/ledger.js';
import { FIX, NOW, tmpDir } from './helpers.js';

const LOGS = path.join(FIX, 'logs');

test('parses the fixture ledger and skips lines that are not runs', () => {
  const rows = parseLedger(fs.readFileSync(path.join(LOGS, 'ledger', '2026-10-01.jsonl'), 'utf8'));
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => typeof r.label === 'string'));
});

test('reads one day and the days before it', () => {
  assert.equal(readDay(LOGS, '2026-10-01').length, 8);
  assert.equal(readDay(LOGS, '2026-01-01').length, 0);
  const recent = readRecent(LOGS, { now: NOW, days: 7 });
  assert.equal(recent.length, 9);
  assert.equal(recent[0].label, 'com.example.launchboard.morning');
});

test('summarizes today per label', () => {
  const by = summarize(readRecent(LOGS, { now: NOW, days: 7 }), { now: NOW });
  const hello = by.get('com.example.launchboard.hello');
  assert.equal(hello.runs, 4);
  assert.equal(hello.ok, 3);
  assert.equal(hello.failed, 1);
  assert.equal(hello.held, 1);
  assert.equal(hello.today.length, 5);
  assert.equal(hello.lastRun.end, '2026-10-01T19:30:00.045Z');
  const morning = by.get('com.example.launchboard.morning');
  assert.equal(morning.runs, 0, 'yesterday is not today');
  assert.equal(morning.lastRun.status, 'ok', 'but it is still the last run');
  const flaky = by.get('com.example.flaky');
  assert.equal(flaky.failed, 1);
  assert.equal(flaky.tripped, 1);
  assert.equal(flaky.lastRun.status, 'fail');
});

test('day keys and midnight are local', () => {
  const t = new Date(2026, 9, 1, 23, 59).getTime();
  assert.equal(dayKey(t), '2026-10-01');
  assert.equal(midnight(t), new Date(2026, 9, 1).getTime());
});

test('appends rows to the day file of their end time', () => {
  const dir = tmpDir();
  const end = new Date(2026, 9, 2, 10, 0).toISOString();
  assert.equal(appendRow(dir, { label: 'a', start: end, end, code: 0, status: 'ok' }), true);
  assert.equal(readDay(dir, '2026-10-02').length, 1);
});

test('reads breakers, and running markers only while their process lives', () => {
  assert.equal(readAllBreakers(LOGS).get('com.example.flaky').tripped, true);
  const dir = tmpDir();
  writeRunning(dir, 'live', { pid: process.pid, wrapper: process.pid, start: new Date().toISOString() });
  writeRunning(dir, 'dead', { pid: 999999, wrapper: 999999, start: new Date().toISOString() });
  const running = readRunning(dir, { isAlive: (pid) => pid === process.pid });
  assert.deepEqual([...running.keys()], ['live']);
  clearRunning(dir, 'live');
  assert.equal(readRunning(dir).size, 0);
});
