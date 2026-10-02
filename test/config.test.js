import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, labelMatches, expandHome, tildify } from '../src/config.js';
import { parseArgs } from '../src/cli.js';
import { tmpDir } from './helpers.js';

test('defaults', () => {
  const home = tmpDir('home');
  const c = loadConfig({ env: {}, home });
  assert.deepEqual(c.prefix, []);
  assert.equal(c.port, 3990);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.logDir, path.join(home, 'Library/Logs/launchboard'));
  assert.deepEqual(c.agentsDirs, [path.join(home, 'Library/LaunchAgents')]);
});

test('flags beat the environment, which beats the config file', () => {
  const home = tmpDir('home');
  fs.mkdirSync(path.join(home, '.config', 'launchboard'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'launchboard', 'config.json'), JSON.stringify({ prefix: ['from.file.'], port: 4000, logDir: '~/file-logs', exclude: 'x.' }));
  const fromFile = loadConfig({ env: {}, home });
  assert.deepEqual(fromFile.prefix, ['from.file.']);
  assert.equal(fromFile.port, 4000);
  assert.equal(fromFile.logDir, path.join(home, 'file-logs'));
  assert.deepEqual(fromFile.exclude, ['x.']);
  const fromEnv = loadConfig({ env: { LAUNCHBOARD_PREFIX: 'a.,b.', LAUNCHBOARD_PORT: '4100' }, home });
  assert.deepEqual(fromEnv.prefix, ['a.', 'b.']);
  assert.equal(fromEnv.port, 4100);
  const fromFlags = loadConfig({ flags: { prefix: ['c.'], port: '4200' }, env: { LAUNCHBOARD_PREFIX: 'a.' }, home });
  assert.deepEqual(fromFlags.prefix, ['c.']);
  assert.equal(fromFlags.port, 4200);
});

test('a bad port or a broken config file is an error', () => {
  const home = tmpDir('home');
  assert.throws(() => loadConfig({ flags: { port: 'abc' }, env: {}, home }), /port/);
  const file = path.join(home, 'bad.json');
  fs.writeFileSync(file, '{not json');
  assert.throws(() => loadConfig({ flags: { config: file }, env: {}, home }), /cannot read config file/);
});

test('labels match the prefix and not the exclusions', () => {
  const cfg = { prefix: ['com.example.'], exclude: ['com.example.skip.'] };
  assert.equal(labelMatches('com.example.a', cfg), true);
  assert.equal(labelMatches('com.example.skip.a', cfg), false);
  assert.equal(labelMatches('org.other.a', cfg), false);
  assert.equal(labelMatches('anything', { prefix: [], exclude: [] }), true);
});

test('home paths', () => {
  assert.equal(expandHome('~/x', '/h'), '/h/x');
  assert.equal(expandHome('/abs', '/h'), '/abs');
  assert.equal(tildify('/h/x/y', '/h'), '~/x/y');
  assert.equal(tildify('/hx/y', '/h'), '/hx/y');
});

test('command line flags', () => {
  const r = parseArgs(['status', '--prefix', 'a.', '--prefix=b.', '--json', '--port', '1', '--', 'cmd', '--prefix']);
  assert.deepEqual(r.positional, ['status']);
  assert.deepEqual(r.flags.prefix, ['a.', 'b.']);
  assert.equal(r.flags.json, true);
  assert.equal(r.flags.port, '1');
  assert.deepEqual(r.rest, ['cmd', '--prefix']);
  assert.throws(() => parseArgs(['--port']), /needs a value/);
});
