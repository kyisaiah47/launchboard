import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scaffold, MODES } from '../src/scaffold.js';
import { VERSION } from '../src/version.js';
import { tmpDir } from './helpers.js';

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));

for (const mode of MODES) {
  test(`--app ${mode} writes a Next.js app wired to launchboard`, () => {
    const cwd = tmpDir('scaffold');
    const r = scaffold({ mode, out: 'my-board', cwd });
    const files = walk(r.dir).sort();
    assert.deepEqual(files, [...r.files].sort());
    const pkg = JSON.parse(fs.readFileSync(path.join(r.dir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'my-board');
    assert.equal(pkg.dependencies.launchboard, `^${VERSION}`);
    assert.ok(pkg.dependencies.next);
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(r.dir, f), 'utf8'), /__[A-Z_]+__/, `${f} has an unreplaced placeholder`);
    assert.ok(files.includes('app/api/state/route.js'));
    assert.ok(files.includes('app/layout.jsx') && files.includes('app/page.jsx'));
    assert.ok(files.includes('.gitignore'));
    const page = fs.readFileSync(path.join(r.dir, 'app/page.jsx'), 'utf8');
    assert.equal(files.includes('components/ConsoleBoard.jsx'), mode !== 'simple');
    assert.equal(files.includes('components/SimpleBoard.jsx'), mode !== 'console');
    assert.equal(files.includes('components/site-view/Welcome.jsx'), mode === 'both');
    if (mode === 'both') assert.match(page, /PageViews consoleView=\{<ConsoleBoard \/>\} simpleView=\{<SimpleBoard \/>\}/);
    else assert.match(page, mode === 'console' ? /<ConsoleBoard \/>/ : /<SimpleBoard \/>/);
    for (const f of files.filter((x) => /\.jsx?$/.test(x))) {
      const text = fs.readFileSync(path.join(r.dir, f), 'utf8');
      for (const m of text.matchAll(/from '(\.\.?\/[^']+)'/g)) {
        const target = path.resolve(path.dirname(path.join(r.dir, f)), m[1]);
        assert.ok(['', '.js', '.jsx', '.css'].some((ext) => fs.existsSync(target + ext)), `${f} imports ${m[1]}, which this mode does not write`);
      }
    }
  });
}

test('the scaffold refuses a directory with files in it and an unknown mode', () => {
  const cwd = tmpDir('scaffold');
  fs.mkdirSync(path.join(cwd, 'full'));
  fs.writeFileSync(path.join(cwd, 'full', 'x'), 'x');
  assert.throws(() => scaffold({ mode: 'both', out: 'full', cwd }), /not empty/);
  assert.throws(() => scaffold({ mode: 'fancy', out: 'x', cwd }), /--app takes/);
});
