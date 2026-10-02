// The banned strings are assembled at run time from parts, so this file holds none of them and
// the gate can scan it like every other file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, tmpDir } from './helpers.js';

const GATE = path.join(ROOT, 'scripts', 'scrub-gate.mjs');
const gate = (root) => spawnSync(process.execPath, [GATE, root], { encoding: 'utf8' });
const j = (...parts) => parts.join('');

const SAMPLES = {
  'personal email address': j('someone', '@', 'gmail', '.com'),
  'home directory path': j('/Us', 'ers/', 'admin/project'),
  'private workspace name': j('~/Compound', 'Labs/x'),
  'private job namespace': j('compound', '.shared', '.thing'),
  'private repository name': j('compound', '-ops/tools'),
  'private database project id': j('xowek', 'qdsttxwb', 'hfxvusa'),
  'private secrets tool': j('compound', '-secret KEY'),
  'private vault tool': j('compound', '-vault get'),
  'account handle': j('@kyisa', 'iah47'),
  'decentralized identifier': j('did:', 'plc:', 'abcdefghij0123456789'),
  'payment account id': j('acct', '_1', 'AbCdEfGhIjKlMnOp'),
  'model API key': j('sk', '-ant-', 'a'.repeat(30)),
  'payment API key': j('sk', '_live_', 'b'.repeat(24)),
  'cloud access key': j('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
  'GitHub token': j('gh', 'p_', 'c'.repeat(36)),
  'private key': j('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'),
  'bot-detection bypass plugin': j('puppeteer-extra', '-plugin-stealth'),
  'automated challenge solving': j('2cap', 'tcha'),
  'webdriver flag override': j('Object.define', 'Property(navigator, ', "'web", "driver'"),
};

test('the repository itself passes the scrub gate', () => {
  const r = gate(ROOT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no findings/);
});

for (const [rule, sample] of Object.entries(SAMPLES)) {
  test(`the gate fails on a ${rule}`, () => {
    const dir = tmpDir('scrub');
    fs.writeFileSync(path.join(dir, 'clean.txt'), 'nothing here\n');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'leak.js'), `const x = 1;\nconst y = "${sample}";\n`);
    const r = gate(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`src/leak\\.js:2: ${rule}`));
    assert.doesNotMatch(r.stderr, new RegExp(sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the finding is masked');
  });
}

test('example.com addresses and noreply addresses pass', () => {
  const dir = tmpDir('scrub');
  fs.writeFileSync(path.join(dir, 'ok.md'), `${j('you', '@', 'example.com')} and ${j('1+bot', '@', 'users.noreply.github.com')}\n`);
  assert.equal(gate(dir).status, 0);
});

test('an empty tree fails closed', () => {
  const r = gate(tmpDir('scrub'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Nothing scanned is not a pass/);
});

test('a missing root fails closed', () => {
  assert.equal(gate(path.join(tmpDir('scrub'), 'nope')).status, 1);
});
