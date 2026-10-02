import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchctlList, exitWords } from '../src/launchctl.js';
import { fixtureLaunchctl } from './helpers.js';

test('parses launchctl list output', () => {
  const { jobs } = fixtureLaunchctl();
  assert.equal(jobs.size, 7);
  assert.equal(jobs.has('Label'), false);
  assert.deepEqual(jobs.get('com.example.daemon'), { pid: 4242, status: 0 });
  assert.deepEqual(jobs.get('com.example.unwrapped'), { pid: null, status: 2 });
  assert.deepEqual(jobs.get('com.example.killed'), { pid: null, status: -9 });
});

test('skips lines that are not job rows', () => {
  const jobs = parseLaunchctlList('PID\tStatus\tLabel\n\ngarbage\n12\t0\tcom.example.a\n');
  assert.deepEqual([...jobs.keys()], ['com.example.a']);
});

test('exit words', () => {
  assert.equal(exitWords(0), 'exit 0');
  assert.equal(exitWords(78), 'exit 78');
  assert.equal(exitWords(-9), 'killed by SIGKILL');
  assert.equal(exitWords(-15), 'killed by SIGTERM');
  assert.equal(exitWords(-31), 'killed by signal 31');
  assert.equal(exitWords(null), 'unknown');
});
