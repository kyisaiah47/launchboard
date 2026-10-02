// The example plists are parsed here and never loaded: no test calls launchctl.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readPlist } from '../src/plist.js';
import { unwrap } from '../src/collect.js';
import { EXAMPLES, ROOT } from './helpers.js';

const plists = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.plist'));

test('there are two example plists', () => {
  assert.deepEqual(plists.sort(), ['com.example.launchboard.hello.plist', 'com.example.launchboard.morning.plist']);
});

for (const f of plists) {
  test(`${f} runs a harmless echo through the wrapper`, () => {
    const p = readPlist(path.join(EXAMPLES, f));
    assert.equal(`${p.Label}.plist`, f, 'the label matches the file name');
    const w = unwrap(p.ProgramArguments);
    assert.ok(w, 'it starts through launchboard run');
    assert.equal(w.label, p.Label, 'the ledger label is the launchd label');
    assert.equal(w.argv[0], '/bin/echo');
    assert.ok(p.ProgramArguments.includes('--log'));
    assert.match(p.EnvironmentVariables.PATH, /\/usr\/bin/);
  });
}

test('no test runs launchctl', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(ROOT, 'test', f), 'utf8');
    assert.doesNotMatch(text, /launchctlList\(|['"]\/bin\/launchctl['"]|launchctl (bootstrap|bootout|load|unload|kickstart)/, `${f} touches launchctl`);
  }
});
