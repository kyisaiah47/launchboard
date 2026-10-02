// The snapshot the board serves. It reads, and only reads:
//
//   the plists in the agent directories      what jobs exist, how they fire, where they log
//   launchctl list                           what is loaded, which pid holds it, its last exit
//   the ledger, breaker and running files    what the wrapper recorded (see ledger.js)
//   the job's log files                      the last lines each job wrote
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPlist } from './plist.js';
import { describeSchedule, nextRun } from './schedule.js';
import { launchctlList, exitWords } from './launchctl.js';
import { readRecent, summarize, readAllBreakers, readRunning, safeName, midnight } from './ledger.js';
import { tail } from './logs.js';
import { tildify, labelMatches } from './config.js';

export const STATE_ORDER = ['running', 'tripped', 'failed', 'held', 'ok', 'loaded', 'unloaded', 'unreadable'];

const plistCache = new Map();
function cachedPlist(file, read) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return { error: e.message }; }
  const hit = plistCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  let value;
  try { value = { plist: read(file) }; } catch (e) { value = { error: String(e.message || e).split('\n')[0] }; }
  plistCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

/**
 * Find the wrapper in a job's arguments: [..., "launchboard", "run", <label>, ..., "--", cmd...].
 * Returns { label, argv } for a wrapped job, or null.
 */
export function unwrap(args) {
  if (!Array.isArray(args)) return null;
  for (let i = 0; i < args.length - 2; i++) {
    const base = path.basename(String(args[i]));
    const isBoard = base === 'launchboard' || (base === 'cli.js' && /launchboard/.test(String(args[i])));
    if (!isBoard || args[i + 1] !== 'run') continue;
    const label = args[i + 2];
    const dash = args.indexOf('--', i + 3);
    return { label, argv: dash >= 0 ? args.slice(dash + 1) : [] };
  }
  return null;
}

/** Read every plist in the agent directories whose label is on the board. */
export function loadJobs(cfg, { read = readPlist, listDir = fs.readdirSync } = {}) {
  const jobs = [];
  const errors = [];
  const seen = new Set();
  for (const dir of cfg.agentsDirs) {
    let names = [];
    try { names = listDir(dir).filter((n) => n.endsWith('.plist')).sort(); } catch (e) {
      if (e.code !== 'ENOENT') errors.push({ where: tildify(dir, cfg.home), error: e.message });
      continue;
    }
    for (const n of names) {
      const file = path.join(dir, n);
      const guess = n.replace(/\.plist$/, '');
      const r = cachedPlist(file, read);
      const label = r.plist && typeof r.plist.Label === 'string' ? r.plist.Label : guess;
      if (!labelMatches(label, cfg) || seen.has(label)) continue;
      seen.add(label);
      jobs.push({ label, file, plist: r.plist || null, error: r.error || null });
    }
  }
  return { jobs, errors };
}

const shown = (argv, home) => argv.map((a) => tildify(String(a), home)).join(' ');

/**
 * Build one snapshot.
 * deps: { now, launchctl: () => ({ ok, jobs, error }), read, listDir, isAlive, tailLines }
 */
export function collect(cfg, deps = {}) {
  const now = deps.now ?? Date.now();
  const home = cfg.home || os.homedir();
  const tailLines = deps.tailLines ?? 5;
  const { jobs: found, errors } = loadJobs(cfg, deps);
  const lc = (deps.launchctl || launchctlList)();
  const loaded = lc.jobs || new Map();
  const rows = readRecent(cfg.logDir, { now, days: 7 });
  const sums = summarize(rows, { now });
  const breakers = readAllBreakers(cfg.logDir);
  const running = readRunning(cfg.logDir, { isAlive: deps.isAlive });

  const jobs = found.map(({ label, file, plist, error }) => {
    const p = plist || {};
    const args = Array.isArray(p.ProgramArguments) ? p.ProgramArguments.map(String) : p.Program ? [String(p.Program)] : [];
    const wrap = unwrap(args);
    const ledgerLabel = wrap && wrap.label ? wrap.label : label;
    const schedule = plist ? describeSchedule(p) : { kind: 'unknown', text: 'unknown, the plist could not be read', interval: null, calendar: null };
    const l = loaded.get(label) || null;
    const s = sums.get(ledgerLabel) || null;
    const br = breakers.get(ledgerLabel) || null;
    const run = running.get(ledgerLabel) || null;

    const logPaths = [...new Set([p.StandardOutPath, p.StandardErrorPath, path.join(cfg.logDir, `${safeName(ledgerLabel)}.log`)].filter((x) => typeof x === 'string' && x))];
    const logs = [];
    for (const f of logPaths) {
      const t = tail(f, tailLines);
      if (t) logs.push({ path: tildify(f, home), size: t.size, modified: t.modified, tail: t.lines });
    }

    const lastRun = s && s.lastRun ? s.lastRun : null;
    let lastExit = null;
    if (lastRun) lastExit = { code: lastRun.code, words: `exit ${lastRun.code}`, source: 'ledger', at: Date.parse(lastRun.end) || null };
    else if (l && l.status != null) lastExit = { code: l.status, words: exitWords(l.status), source: 'launchd', at: null };

    // A failure outranks a hold: a job held back after failing is still a job whose last run failed.
    const lastRow = s ? s.last : null;
    let state;
    if (error) state = 'unreadable';
    else if (run || (l && l.pid)) state = 'running';
    else if (br && br.tripped) state = 'tripped';
    else if (lastRun && lastRun.status === 'fail') state = 'failed';
    else if (!lastRun && l && l.status != null && l.status !== 0) state = 'failed';
    else if ((lastRow && lastRow.status === 'held') || (br && Number(br.next) > now)) state = 'held';
    else if (lastRun && lastRun.status === 'ok') state = l || !lc.ok ? 'ok' : 'unloaded';
    else if (l) state = 'loaded';
    else state = 'unloaded';

    const today = s ? s.today : [];
    const lastStart = lastRun ? Date.parse(lastRun.start) : null;
    return {
      label,
      ledgerLabel: ledgerLabel !== label ? ledgerLabel : undefined,
      plist: tildify(file, home),
      error: error || undefined,
      state,
      schedule: { kind: schedule.kind, text: schedule.text, interval: schedule.interval },
      next: plist && p.Disabled !== true ? nextRun(schedule, { now, lastStart }) : null,
      disabled: p.Disabled === true || undefined,
      program: shown(wrap ? wrap.argv : args, home),
      wrapped: !!wrap,
      cwd: p.WorkingDirectory ? tildify(p.WorkingDirectory, home) : null,
      loaded: !!l,
      pid: run ? run.pid : l ? l.pid : null,
      runningSince: run ? Date.parse(run.start) || null : null,
      lastExit,
      breaker: br ? { fails: br.fails, code: br.code, next: br.next || null, tripped: !!br.tripped, since: br.first || null } : null,
      today: {
        runs: s ? s.runs : 0,
        ok: s ? s.ok : 0,
        failed: s ? s.failed : 0,
        held: s ? s.held : 0,
        tripped: s ? s.tripped : 0,
        rows: today.slice(-12).reverse().map((r) => ({ start: r.start, end: r.end, ms: r.ms ?? null, code: r.code ?? null, status: r.status, said: r.said || '', reason: r.reason || '' })),
      },
      lastRun: lastRun ? { start: lastRun.start, end: lastRun.end, ms: lastRun.ms ?? null, code: lastRun.code, status: lastRun.status, said: lastRun.said || '' } : null,
      logs,
    };
  });
  jobs.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.label.localeCompare(b.label));

  const onBoard = new Set(jobs.map((j) => j.ledgerLabel || j.label));
  const since = midnight(now);
  const at = (r) => Date.parse(r.end || r.start) || 0;
  const feed = rows
    .filter((r) => onBoard.has(r.label) && at(r) >= since)
    .sort((a, b) => at(b) - at(a))
    .slice(0, 40)
    .map((r) => ({ label: r.label, start: r.start, end: r.end, ms: r.ms ?? null, code: r.code ?? null, status: r.status, said: r.said || '', reason: r.reason || '' }));
  const count = (st) => jobs.filter((j) => j.state === st).length;
  const sum = (k) => jobs.reduce((a, j) => a + j.today[k], 0);
  return {
    now,
    since,
    config: {
      prefix: cfg.prefix,
      exclude: cfg.exclude,
      logDir: tildify(cfg.logDir, home),
      agentsDirs: cfg.agentsDirs.map((d) => tildify(d, home)),
    },
    launchctl: { ok: !!lc.ok, error: lc.error || null },
    counts: {
      jobs: jobs.length,
      loaded: jobs.filter((j) => j.loaded).length,
      wrapped: jobs.filter((j) => j.wrapped).length,
      running: count('running'),
      failed: count('failed'),
      tripped: count('tripped'),
      held: count('held'),
      unloaded: count('unloaded'),
      runsToday: sum('runs'),
      okToday: sum('ok'),
      failedToday: sum('failed'),
      heldToday: sum('held'),
    },
    jobs,
    feed,
    errors,
  };
}

/** One job with longer log tails, for the detail view. */
export function jobDetail(cfg, label, deps = {}) {
  const snap = collect(cfg, { ...deps, tailLines: deps.tailLines ?? 60 });
  const job = snap.jobs.find((j) => j.label === label) || null;
  return job ? { now: snap.now, job } : null;
}
