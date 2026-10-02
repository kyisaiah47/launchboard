import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parsePlistXml, readPlist } from '../src/plist.js';
import { EXAMPLES, FIX } from './helpers.js';

test('parses the hello example plist', () => {
  const p = readPlist(path.join(EXAMPLES, 'com.example.launchboard.hello.plist'));
  assert.equal(p.Label, 'com.example.launchboard.hello');
  assert.equal(p.StartInterval, 300);
  assert.equal(p.RunAtLoad, true);
  assert.deepEqual(p.ProgramArguments.slice(0, 4), ['/usr/bin/env', 'launchboard', 'run', 'com.example.launchboard.hello']);
  assert.equal(p.EnvironmentVariables.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
});

test('parses the morning example plist', () => {
  const p = readPlist(path.join(EXAMPLES, 'com.example.launchboard.morning.plist'));
  assert.equal(p.Label, 'com.example.launchboard.morning');
  assert.deepEqual(p.StartCalendarInterval, { Hour: 9, Minute: 0 });
});

test('parses every value type', () => {
  const v = parsePlistXml(`<?xml version="1.0"?>
<!-- a comment -->
<plist version="1.0"><dict>
  <key>s</key><string>a &amp; b &lt;c&gt; &#65;&#x42;</string>
  <key>empty</key><string/>
  <key>i</key><integer>-42</integer>
  <key>r</key><real>2.5</real>
  <key>t</key><true/>
  <key>f</key><false/>
  <key>d</key><date>2026-10-01T12:00:00Z</date>
  <key>data</key><data>aGVs
  bG8=</data>
  <key>arr</key><array><integer>1</integer><array><string>x</string></array><dict/></array>
  <key>cdata</key><string><![CDATA[<raw> & text]]></string>
</dict></plist>`);
  assert.equal(v.s, 'a & b <c> AB');
  assert.equal(v.empty, '');
  assert.equal(v.i, -42);
  assert.equal(v.r, 2.5);
  assert.equal(v.t, true);
  assert.equal(v.f, false);
  assert.equal(v.d.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(v.data.toString(), 'hello');
  assert.deepEqual(v.arr, [1, ['x'], {}]);
  assert.equal(v.cdata, '<raw> & text');
});

test('rejects malformed plists', () => {
  assert.throws(() => parsePlistXml(fs.readFileSync(path.join(FIX, 'agents', 'com.example.broken.plist'), 'utf8')));
  assert.throws(() => parsePlistXml('<plist><dict><key>a</key><string>x</dict></plist>'));
  assert.throws(() => parsePlistXml('<plist><dict><string>no key</string></dict></plist>'));
  assert.throws(() => parsePlistXml('<plist><integer>1.5</integer></plist>'));
  assert.throws(() => parsePlistXml('<plist><widget/></plist>'));
});
