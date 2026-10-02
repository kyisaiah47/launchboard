// Shared test setup. Nothing here runs launchctl: every test that needs launchd's view of the
// machine reads the fixture output in test/fixtures/launchctl-list.txt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLaunchctlList } from '../src/launchctl.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIX = path.join(ROOT, 'test', 'fixtures');
export const EXAMPLES = path.join(ROOT, 'examples');
export const NOW = Date.parse('2026-10-01T20:00:00Z');

export const fixtureLaunchctl = () => ({ ok: true, jobs: parseLaunchctlList(fs.readFileSync(path.join(FIX, 'launchctl-list.txt'), 'utf8')) });

export function tmpDir(name = 'lb') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

export function fixtureConfig(extra = {}) {
  return {
    prefix: ['com.example.'],
    exclude: [],
    logDir: path.join(FIX, 'logs'),
    agentsDirs: [EXAMPLES, path.join(FIX, 'agents')],
    port: 0,
    host: '127.0.0.1',
    home: os.homedir(),
    ...extra,
  };
}

export const deps = (extra = {}) => ({ now: NOW, launchctl: fixtureLaunchctl, isAlive: () => false, ...extra });

/** A writable stream that keeps what was written. */
export function sink() {
  const chunks = [];
  return { write: (c) => { chunks.push(String(c)); return true; }, text: () => chunks.join('') };
}
