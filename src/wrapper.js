// launchboard run <label> -- <command> [args...]
//
// Runs one launchd job, writes one ledger row for the run, and stops the job from failing the
// same way forever. The job does not need to know the wrapper is there: it gets the same argv,
// working directory and environment, its output passes through unchanged, and the wrapper exits
// with the job's own exit code, so `launchctl list` still shows the truth.
//
// THE BREAKER. A job that fails is retried by launchd on its next tick with the same inputs, so
// a failure that cannot fix itself repeats on every tick. Two rules stop that:
//
//   1. Backoff. Consecutive failures put a floor under the next attempt: 15 minutes, then 30,
//      1 hour, 2, 4, and at most 6 hours. A tick that lands before the floor is skipped and
//      recorded as held. A job whose own interval is longer than the floor is not affected.
//      Any success clears the state.
//   2. Trip. After max-fails consecutive failures with the same exit code (default 3) the job is
//      tripped: every later tick is skipped and recorded until `launchboard reset <label>`.
//      The same code every time is the sign of a run that cannot make progress. A job whose exit
//      code keeps changing only gets the backoff.
//
// Exit 75 (EX_TEMPFAIL, "try again later") is a deliberate deferral, not a failure: it is
// recorded as held and leaves the breaker alone. A run that passes its runtime ceiling is
// stopped with SIGTERM, then SIGKILL 30 seconds later, and is recorded as exit 124 every time so
// the trip rule can see it.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  appendRow, readBreaker, writeBreaker, clearBreaker, writeRunning, clearRunning, logFile,
} from './ledger.js';

export const EXIT_HELD = 75;
export const EXIT_TIMEOUT = 124;
export const BACKOFF_BASE_S = 900;
export const BACKOFF_MAX_S = 21600;

/** Seconds of backoff after `fails` consecutive failures. */
export const backoffSeconds = (fails) => Math.min(BACKOFF_BASE_S * 2 ** Math.max(0, Math.min(fails, 6) - 1), BACKOFF_MAX_S);

const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
const iso = (t) => new Date(t).toISOString();
const clip = (s, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rotate(file, maxBytes) {
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch { /* no file yet */ }
}

/**
 * Run a command under the breaker. Resolves to the exit code the wrapper should exit with.
 * opts: { label, argv, logDir, maxFails, maxRuntime (s, 0 = none), noTrip, noBackoff, log,
 *         env, cwd, stdout, stderr, now, killGraceMs }
 */
export async function runWrapped(opts) {
  const {
    label, argv, logDir,
    maxFails = 3, maxRuntime = 43200, noTrip = false, noBackoff = false, log = false,
    env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr,
    now = Date.now, killGraceMs = 30000, forwardSignals = true,
  } = opts;
  if (!label) throw new Error('launchboard run: a label is required');
  if (!argv || !argv.length) throw new Error('launchboard run: nothing to run; put the command after --');
  const note = (msg) => { try { stderr.write(`[launchboard] ${label}: ${msg}\n`); } catch { /* closed stream */ } };

  // ── before the run: a tripped or backed-off job does not fire ────────────────────────────
  const state = readBreaker(logDir, label);
  const t0 = now();
  if (state && state.tripped && !noTrip) {
    const reason = `tripped after ${state.fails} failures with exit ${state.code}; clear it with: launchboard reset ${label}`;
    note(`skipped, ${reason}`);
    appendRow(logDir, { label, start: iso(t0), end: iso(t0), ms: 0, code: null, status: 'tripped', reason });
    return 0;
  }
  if (state && !noBackoff && Number(state.next) > t0) {
    const reason = `backed off after ${state.fails} failure${state.fails === 1 ? '' : 's'}, next attempt after ${iso(state.next)}`;
    note(`skipped, ${reason}`);
    appendRow(logDir, { label, start: iso(t0), end: iso(t0), ms: 0, code: null, status: 'held', reason });
    return 0;
  }

  // ── the run ──────────────────────────────────────────────────────────────────────────────
  let logFd = null;
  if (log) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const file = logFile(logDir, label);
      rotate(file, 5 * 1024 * 1024);
      logFd = fs.openSync(file, 'a');
      fs.writeSync(logFd, `=== ${iso(t0)} start: ${argv.join(' ')}\n`);
    } catch (e) {
      note(`cannot open its log file: ${e.message}`);
      logFd = null;
    }
  }
  let lastLine = '';
  let partial = '';
  const sink = (stream) => (chunk) => {
    try { stream.write(chunk); } catch { /* the reader went away; keep the job running */ }
    if (logFd != null) { try { fs.writeSync(logFd, chunk); } catch { /* best effort */ } }
    const text = partial + chunk.toString('utf8');
    const lines = text.split('\n');
    partial = lines.pop();
    for (const l of lines) if (l.trim()) lastLine = l.trim();
  };

  const result = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd, env: { ...env, LAUNCHBOARD_LABEL: label }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: 127, error: e.message });
      return;
    }
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    const finish = (r) => { if (settled) return; settled = true; resolve(r); };
    child.stdout.on('data', sink(stdout));
    child.stderr.on('data', sink(stderr));
    child.on('error', (e) => finish({ code: e.code === 'ENOENT' ? 127 : 126, error: e.code === 'ENOENT' ? `command not found: ${argv[0]}` : e.message }));
    if (child.pid) writeRunning(logDir, label, { pid: child.pid, wrapper: process.pid, start: iso(t0), cmd: argv.join(' ') });
    const ceiling = maxRuntime > 0 ? setTimeout(() => {
      timedOut = true;
      note(`ran past its ${maxRuntime}s ceiling, stopping it`);
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, killGraceMs);
    }, maxRuntime * 1000) : null;
    const forward = (sig) => () => { try { child.kill(sig); } catch { /* gone */ } };
    const handlers = forwardSignals ? ['SIGTERM', 'SIGINT', 'SIGHUP'].map((sig) => [sig, forward(sig)]) : [];
    for (const [sig, h] of handlers) process.on(sig, h);
    child.on('close', (code, signal) => {
      if (ceiling) clearTimeout(ceiling);
      if (killTimer) clearTimeout(killTimer);
      for (const [sig, h] of handlers) process.removeListener(sig, h);
      finish({ code: code ?? 128 + (SIGNALS[signal] || 0), signal, timedOut });
    });
  });
  clearRunning(logDir, label);
  if (partial.trim()) lastLine = partial.trim();

  const t1 = now();
  const ms = t1 - t0;
  let code = result.code;
  if (result.timedOut && code !== 0) code = EXIT_TIMEOUT;
  const secs = `${(ms / 1000).toFixed(1)}s`;
  if (logFd != null) {
    try { fs.writeSync(logFd, `=== ${iso(t1)} exit ${code} in ${secs}\n`); fs.closeSync(logFd); } catch { /* best effort */ }
  }
  const base = { label, start: iso(t0), end: iso(t1), ms, code, said: clip(result.error || lastLine) };

  // ── after the run: success forgets everything, failure changes the next tick ───────────────
  if (code === 0) {
    clearBreaker(logDir, label);
    appendRow(logDir, { ...base, status: 'ok', reason: `exit 0 in ${secs}` });
    return 0;
  }
  if (code === EXIT_HELD) {
    note('deferred itself with exit 75, recorded as held; the breaker is unchanged');
    appendRow(logDir, { ...base, status: 'held', reason: 'the job deferred itself (exit 75)' });
    return 0;
  }
  const prev = state || {};
  const same = prev.code === code;
  const fails = same ? (Number(prev.fails) || 0) + 1 : 1;
  const first = same && prev.first ? prev.first : t1;
  const next = t1 + backoffSeconds(fails) * 1000;
  const trip = !noTrip && fails >= maxFails;
  writeBreaker(logDir, label, { fails, code, first, next, last: t1, tripped: trip });
  const why = result.timedOut ? `stopped at its ${maxRuntime}s ceiling` : result.error || `exit ${code} in ${secs}`;
  if (trip) {
    const reason = `${why}; ${fails} failures in a row with exit ${code}, tripped. Clear it with: launchboard reset ${label}`;
    note(reason);
    appendRow(logDir, { ...base, status: 'fail', tripped: true, reason });
  } else {
    note(`failed (${why}), ${fails} in a row; the next attempt waits until ${iso(next)}`);
    appendRow(logDir, { ...base, status: 'fail', reason: `${why}; ${fails} in a row` });
  }
  return code;
}

/** Clear a job's breaker state. Returns whether there was state to clear. */
export function resetBreaker(logDir, label) {
  const had = !!readBreaker(logDir, label);
  clearBreaker(logDir, label);
  return had;
}
