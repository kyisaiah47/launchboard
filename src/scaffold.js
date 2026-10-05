// launchboard --app console|simple|both
//
// Writes a Next.js app wired to this package: API routes that call collect() and jobDetail(), and
// the board as a Console view, a Simple view, or both with a switch between them. The Console view
// is the dense working surface. The Simple view puts the jobs that need attention first and opens
// details on request. With both, each view's header carries the switch beside the name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';

export const MODES = ['console', 'simple', 'both'];
const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', 'next');
const ALL = MODES;
const CONSOLE = ['console', 'both'];
const SIMPLE = ['simple', 'both'];
const BOTH = ['both'];

/** [template path, output path, modes]. */
export const MANIFEST = [
  ['package.json', 'package.json', ALL],
  ['next.config.mjs', 'next.config.mjs', ALL],
  ['gitignore', '.gitignore', ALL],
  ['README.md', 'README.md', ALL],
  ['app/globals.css', 'app/globals.css', ALL],
  ['app/icon.svg', 'app/icon.svg', ALL],
  ['app/api/state/route.js', 'app/api/state/route.js', ALL],
  ['app/api/job/route.js', 'app/api/job/route.js', ALL],
  ['lib/words.js', 'lib/words.js', ALL],
  ['lib/useBoard.js', 'lib/useBoard.js', ALL],
  ['components/Pill.jsx', 'components/Pill.jsx', ALL],
  ['components/Footer.jsx', 'components/Footer.jsx', ALL],
  ['components/ConsoleBoard.jsx', 'components/ConsoleBoard.jsx', CONSOLE],
  ['components/SimpleBoard.jsx', 'components/SimpleBoard.jsx', SIMPLE],
  ['components/Disclosure.jsx', 'components/Disclosure.jsx', SIMPLE],
  ['app/simple.css', 'app/simple.css', SIMPLE],
  ['components/site-view/SiteViewProvider.jsx', 'components/site-view/SiteViewProvider.jsx', BOTH],
  ['components/site-view/PageViews.jsx', 'components/site-view/PageViews.jsx', BOTH],
  ['components/site-view/ViewControls.jsx', 'components/site-view/ViewControls.jsx', BOTH],
  ['app/layout.console.jsx', 'app/layout.jsx', ['console']],
  ['app/layout.simple.jsx', 'app/layout.jsx', ['simple']],
  ['app/layout.both.jsx', 'app/layout.jsx', BOTH],
  ['app/page.console.jsx', 'app/page.jsx', ['console']],
  ['app/page.simple.jsx', 'app/page.jsx', ['simple']],
  ['app/page.both.jsx', 'app/page.jsx', BOTH],
];

const npmName = (s) => (s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[-]+$/g, '') || 'launchboard-app').slice(0, 214);

/**
 * Write the app. Refuses a directory that already holds files.
 * Returns { dir, rel, files }.
 */
export function scaffold({ mode, out = 'launchboard-app', cwd = process.cwd(), version = VERSION } = {}) {
  if (!MODES.includes(mode)) throw new Error(`launchboard: --app takes ${MODES.join(', ')}, not ${mode}`);
  const dir = path.resolve(cwd, out);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`launchboard: ${dir} is not empty; pick another --out`);
  const vars = { __APP_NAME__: npmName(path.basename(dir)), __LAUNCHBOARD_VERSION__: version, __MODE__: mode };
  const files = [];
  for (const [from, to, modes] of MANIFEST) {
    if (!modes.includes(mode)) continue;
    let text = fs.readFileSync(path.join(TEMPLATES, from), 'utf8');
    for (const [k, v] of Object.entries(vars)) text = text.split(k).join(v);
    const dest = path.join(dir, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    files.push(to);
  }
  return { dir, rel: path.relative(cwd, dir) || '.', files };
}
