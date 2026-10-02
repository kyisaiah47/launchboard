#!/usr/bin/env node
// launchboard: one page for every scheduled job on your Mac.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { collect } from './collect.js';
import { startServer } from './server.js';
import { runWrapped, resetBreaker } from './wrapper.js';
import { scaffold, MODES } from './scaffold.js';
import { VERSION } from './version.js';

const HELP = `LaunchBoard ${VERSION}
One page for every scheduled job on your Mac: what is running, what failed, what ran today.

Usage
  launchboard [serve] [options]          start the board (http://127.0.0.1:3990)
  launchboard status [--json] [options]  print the board once and exit
  launchboard run <label> [run options] -- <command> [args...]
                                         run a job, record it in the ledger, apply the breaker
  launchboard reset <label>              clear a job's breaker so the wrapper runs it again
  launchboard --app console|simple|both [--out <dir>]
                                         scaffold a Next.js version of the board

Options
  --prefix <p>       show jobs whose label starts with <p> (repeat or comma-separate)
  --exclude <p>      hide jobs whose label starts with <p>
  --log-dir <dir>    where the ledger and wrapper logs live (default ~/Library/Logs/launchboard)
  --agents-dir <dir> where plists are read from (default ~/Library/LaunchAgents; repeatable)
  --port <n>         the board's port (default 3990)
  --host <addr>      the address to bind (default 127.0.0.1)
  --config <file>    a JSON config file (default ~/.config/launchboard/config.json)

Run options
  --log              append the job's output to <log-dir>/<label>.log
  --max-fails <n>    trip after n failures in a row with the same exit code (default 3)
  --max-runtime <s>  stop a run after s seconds and record exit 124 (default 43200, 0 = none)
  --no-trip          back off but never trip
  --no-backoff       run every tick, still trips

Environment
  LAUNCHBOARD_PREFIX, LAUNCHBOARD_EXCLUDE, LAUNCHBOARD_LOG_DIR, LAUNCHBOARD_AGENTS_DIRS,
  LAUNCHBOARD_PORT, LAUNCHBOARD_HOST, LAUNCHBOARD_CONFIG, LAUNCHBOARD_MAX_FAILS,
  LAUNCHBOARD_MAX_RUNTIME, LAUNCHBOARD_NO_TRIP=1, LAUNCHBOARD_NO_BACKOFF=1, LAUNCHBOARD_LOG=1
`;

const BOOL = new Set(['json', 'log', 'no-trip', 'no-backoff', 'help', 'version']);
const MULTI = new Set(['prefix', 'exclude', 'agents-dir']);

/** Parse flags up to the first `--`. Returns { flags, positional, rest }. */
export function parseArgs(args) {
  const flags = {};
  const positional = [];
  let rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { rest = args.slice(i + 1); break; }
    if (a === '-h') { flags.help = true; continue; }
    if (a === '-v') { flags.version = true; continue; }
    if (!a.startsWith('--')) { positional.push(a); continue; }
    let name = a.slice(2);
    let value;
    const eq = name.indexOf('=');
    if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq); }
    if (BOOL.has(name)) { flags[name] = value === undefined ? true : !/^(0|false|no)$/i.test(value); continue; }
    if (value === undefined) {
      value = args[i + 1];
      if (value === undefined || value === '--') throw new Error(`launchboard: --${name} needs a value`);
      i++;
    }
    if (MULTI.has(name)) (flags[name] = flags[name] || []).push(value);
    else flags[name] = value;
  }
  return { flags, positional, rest };
}

const configFlags = (f) => ({ prefix: f.prefix, exclude: f.exclude, logDir: f['log-dir'], agentsDir: f['agents-dir'], port: f.port, host: f.host, config: f.config });
const envBool = (v) => v !== undefined && /^(1|true|yes)$/i.test(String(v));

function printStatus(snap) {
  const c = snap.counts;
  const lines = [];
  lines.push(`${c.jobs} jobs, ${c.running} running, ${c.failed} failed on their last run, ${c.tripped} tripped, ${c.held} held. ${c.runsToday} runs recorded today.`);
  if (!snap.launchctl.ok) lines.push(`launchctl could not be read: ${snap.launchctl.error}`);
  const w = Math.min(60, Math.max(10, ...snap.jobs.map((j) => j.label.length)));
  for (const j of snap.jobs) {
    const exit = j.lastExit ? j.lastExit.words : '-';
    const today = j.today.runs ? `${j.today.runs} today${j.today.failed ? `, ${j.today.failed} failed` : ''}` : '';
    lines.push(`${j.state.padEnd(10)} ${j.label.padEnd(w)}  ${exit.padEnd(16)} ${j.schedule.text}${today ? `  (${today})` : ''}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(argv) {
  const first = argv[0];
  if (first === 'run') {
    const { flags, positional, rest } = parseArgs(argv.slice(1));
    const label = positional[0];
    if (!label) throw new Error('launchboard run: a label is required: launchboard run <label> -- <command>');
    if (!rest.length) throw new Error('launchboard run: put the command after --: launchboard run <label> -- <command>');
    const env = process.env;
    const cfg = loadConfig({ flags: { logDir: flags['log-dir'], config: flags.config } });
    const maxFails = Number(flags['max-fails'] ?? env.LAUNCHBOARD_MAX_FAILS ?? 3);
    const maxRuntime = Number(flags['max-runtime'] ?? env.LAUNCHBOARD_MAX_RUNTIME ?? 43200);
    if (!Number.isInteger(maxFails) || maxFails < 1) throw new Error('launchboard run: --max-fails must be a whole number of at least 1');
    if (!Number.isFinite(maxRuntime) || maxRuntime < 0) throw new Error('launchboard run: --max-runtime must be 0 or more seconds');
    return runWrapped({
      label,
      argv: rest,
      logDir: cfg.logDir,
      maxFails,
      maxRuntime,
      noTrip: !!flags['no-trip'] || envBool(env.LAUNCHBOARD_NO_TRIP),
      noBackoff: !!flags['no-backoff'] || envBool(env.LAUNCHBOARD_NO_BACKOFF),
      log: !!flags.log || envBool(env.LAUNCHBOARD_LOG),
    });
  }

  const { flags, positional } = parseArgs(argv);
  if (flags.version) { process.stdout.write(`${VERSION}\n`); return 0; }
  if (flags.help || first === 'help') { process.stdout.write(HELP); return 0; }

  if (flags.app !== undefined || first === 'app') {
    const mode = flags.app;
    if (!MODES.includes(mode)) throw new Error(`launchboard: --app takes ${MODES.join(', ')}`);
    const out = flags.out || positional.find((p) => p !== 'app') || 'launchboard-app';
    const r = scaffold({ mode, out });
    process.stdout.write(`Wrote a Next.js board (${mode}) to ${r.dir}: ${r.files.length} files.\nNext: cd ${r.rel} && npm install && npm run dev\n`);
    return 0;
  }

  if (first === 'reset') {
    const label = positional[1];
    if (!label) throw new Error('launchboard reset: a label is required');
    const cfg = loadConfig({ flags: configFlags(flags) });
    const had = resetBreaker(cfg.logDir, label);
    process.stdout.write(had ? `Cleared the breaker for ${label}. Its next tick runs.\n` : `${label} had no breaker state.\n`);
    return 0;
  }

  const cfg = loadConfig({ flags: configFlags(flags) });
  if (first === 'status') {
    const snap = collect(cfg);
    if (flags.json) process.stdout.write(`${JSON.stringify({ version: VERSION, ...snap }, null, 2)}\n`);
    else printStatus(snap);
    return 0;
  }
  if (first && first !== 'serve') throw new Error(`launchboard: unknown command "${first}". Run launchboard --help.`);

  const board = await startServer(cfg);
  process.stdout.write(`LaunchBoard ${VERSION} on ${board.url}\n${cfg.prefix.length ? `Jobs starting with ${cfg.prefix.join(', ')}` : 'Every job'} in ${cfg.agentsDirs.join(', ')}. Read-only.\n`);
  const stop = () => { board.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null;
}

// Run as a program (directly, or through the npm bin link, which is a symlink), not on import.
const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== null && code !== undefined) process.exitCode = code;
  }).catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 64;
  });
}

export { main };
