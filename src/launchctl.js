// What launchd has loaded right now, read from `launchctl list`. Read-only: LaunchBoard never
// loads, unloads, starts or stops a job.
import { execFileSync } from 'node:child_process';

/**
 * Parse the tab-separated output of `launchctl list`: PID, last exit status, label.
 * A PID of "-" means the job is loaded and not running. A negative status means the last run was
 * ended by that signal number.
 */
export function parseLaunchctlList(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [pid, status, ...rest] = parts;
    const label = rest.join('\t').trim();
    if (!label || label === 'Label') continue;
    out.set(label, {
      pid: /^\d+$/.test(pid.trim()) ? Number(pid.trim()) : null,
      status: /^-?\d+$/.test(status.trim()) ? Number(status.trim()) : null,
    });
  }
  return out;
}

/** Run `launchctl list` once. Off macOS, or on any error, it returns an empty map and the reason. */
export function launchctlList({ bin = '/bin/launchctl', timeout = 5000 } = {}) {
  if (process.platform !== 'darwin') return { ok: false, jobs: new Map(), error: 'launchctl exists only on macOS' };
  try {
    const out = execFileSync(bin, ['list'], { encoding: 'utf8', timeout, maxBuffer: 32 << 20 });
    return { ok: true, jobs: parseLaunchctlList(out) };
  } catch (e) {
    return { ok: false, jobs: new Map(), error: String(e.message || e).split('\n')[0] };
  }
}

const SIGNAL_NAMES = { 1: 'SIGHUP', 2: 'SIGINT', 3: 'SIGQUIT', 4: 'SIGILL', 5: 'SIGTRAP', 6: 'SIGABRT', 8: 'SIGFPE', 9: 'SIGKILL', 10: 'SIGBUS', 11: 'SIGSEGV', 13: 'SIGPIPE', 14: 'SIGALRM', 15: 'SIGTERM' };

/** The words for a launchctl status value. */
export function exitWords(status) {
  if (status == null) return 'unknown';
  if (status < 0) return `killed by ${SIGNAL_NAMES[-status] || `signal ${-status}`}`;
  return `exit ${status}`;
}
