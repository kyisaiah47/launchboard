// The files the wrapper writes and the board reads, all under the log directory:
//
//   ledger/<YYYY-MM-DD>.jsonl   one row per run, by local day
//   breaker/<label>.json        consecutive failures, the backoff floor, and whether it tripped
//   running/<label>.json        a run in flight: its pid and when it started
//   <label>.log                 the job's output, when the wrapper runs with --log
//
// Every write is best effort. A ledger that cannot be written must never change the exit code of
// the job it describes.
import fs from 'node:fs';
import path from 'node:path';

export const safeName = (label) => String(label).replace(/[^A-Za-z0-9._-]/g, '_');
export const dirs = (logDir) => ({
  ledger: path.join(logDir, 'ledger'),
  breaker: path.join(logDir, 'breaker'),
  running: path.join(logDir, 'running'),
});
export const logFile = (logDir, label) => path.join(logDir, `${safeName(label)}.log`);

/** The local calendar day of a time, as YYYY-MM-DD. */
export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight before `t`, in ms. */
export function midnight(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
};
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

/** Append one run row to the day file of its end time. */
export function appendRow(logDir, row) {
  try {
    const { ledger } = dirs(logDir);
    fs.mkdirSync(ledger, { recursive: true });
    const at = Date.parse(row.end || row.start) || Date.now();
    fs.appendFileSync(path.join(ledger, `${dayKey(at)}.jsonl`), `${JSON.stringify(row)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Parse ledger text. Lines that are not JSON objects with a label are skipped. */
export function parseLedger(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && typeof r.label === 'string') rows.push(r);
    } catch { /* a torn or foreign line is not a run */ }
  }
  return rows;
}

export function readDay(logDir, day) {
  try { return parseLedger(fs.readFileSync(path.join(dirs(logDir).ledger, `${day}.jsonl`), 'utf8')); } catch { return []; }
}

/** Rows from the last `days` day files up to and including the day of `now`, oldest first. */
export function readRecent(logDir, { now = Date.now(), days = 7 } = {}) {
  const out = [];
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date(now);
    d.setDate(d.getDate() - k);
    out.push(...readDay(logDir, dayKey(d.getTime())));
  }
  return out;
}

const rowTime = (r) => Date.parse(r.end || r.start) || 0;

/**
 * Per label: today's runs and their outcomes, and the last row of any day.
 * `ok` counts exit 0, `failed` counts any other exit, `held` counts runs the breaker held back or
 * the job deferred, and `tripped` counts runs refused because the breaker tripped.
 */
export function summarize(rows, { now = Date.now() } = {}) {
  const since = midnight(now);
  const by = new Map();
  const get = (label) => {
    let s = by.get(label);
    if (!s) { s = { runs: 0, ok: 0, failed: 0, held: 0, tripped: 0, last: null, lastRun: null, today: [] }; by.set(label, s); }
    return s;
  };
  for (const r of [...rows].sort((a, b) => rowTime(a) - rowTime(b))) {
    const s = get(r.label);
    s.last = r;
    if (r.status === 'ok' || r.status === 'fail') s.lastRun = r;
    if (rowTime(r) < since || rowTime(r) > now + 60e3) continue;
    s.today.push(r);
    if (r.status === 'ok') { s.runs++; s.ok++; } else if (r.status === 'fail') { s.runs++; s.failed++; } else if (r.status === 'held') s.held++; else if (r.status === 'tripped') s.tripped++;
  }
  return by;
}

// ── breaker state ─────────────────────────────────────────────────────────────────────────────
export const breakerFile = (logDir, label) => path.join(dirs(logDir).breaker, `${safeName(label)}.json`);
export const readBreaker = (logDir, label) => readJson(breakerFile(logDir, label));
export function writeBreaker(logDir, label, state) {
  try { writeJson(breakerFile(logDir, label), { label, ...state }); return true; } catch { return false; }
}
export function clearBreaker(logDir, label) {
  try { fs.rmSync(breakerFile(logDir, label), { force: true }); return true; } catch { return false; }
}
export function readAllBreakers(logDir) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dirs(logDir).breaker).filter((n) => n.endsWith('.json')); } catch { return out; }
  for (const n of names) {
    const s = readJson(path.join(dirs(logDir).breaker, n));
    if (s && s.label) out.set(s.label, s);
  }
  return out;
}

// ── runs in flight ────────────────────────────────────────────────────────────────────────────
export const runningFile = (logDir, label) => path.join(dirs(logDir).running, `${safeName(label)}.json`);
export function writeRunning(logDir, label, rec) {
  try { writeJson(runningFile(logDir, label), { label, ...rec }); return true; } catch { return false; }
}
export function clearRunning(logDir, label) {
  try { fs.rmSync(runningFile(logDir, label), { force: true }); } catch { /* best effort */ }
}
export const alive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
/** Markers whose process is still alive. A marker left by a run that died is ignored. */
export function readRunning(logDir, { isAlive = alive } = {}) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dirs(logDir).running).filter((n) => n.endsWith('.json')); } catch { return out; }
  for (const n of names) {
    const s = readJson(path.join(dirs(logDir).running, n));
    if (s && s.label && isAlive(s.wrapper || s.pid)) out.set(s.label, s);
  }
  return out;
}
