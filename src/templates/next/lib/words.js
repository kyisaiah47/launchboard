// The words both views use for states, times and counts.
export const STATE = { running: 'Running', tripped: 'Tripped', failed: 'Failed', held: 'Held', ok: 'OK', loaded: 'Loaded', unloaded: 'Not loaded', unreadable: 'Unreadable' };
export const ATTENTION = new Set(['failed', 'tripped', 'held', 'unreadable']);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const ranToday = (j) => j.today.runs + j.today.held + j.today.tripped > 0;

export const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
export const when = (t, now) => (sameDay(t, now) ? `at ${hm(t)}` : `on ${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${hm(t)}`);
export function ago(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function dur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
export const rowTime = (r) => Date.parse(r.end || r.start);
// "was killed by SIGKILL" for a signal, "ended with exit 3" for a code.
export const lastRunWords = (e) => (e.code < 0 ? `was ${e.words}` : `ended with ${e.words}`);
export const shortExit = (e) => (e.code < 0 ? e.words.replace(/^killed by /, '') : e.words);
export const runWord = (r) => (r.status === 'ok' || r.status === 'fail' ? `exit ${r.code}` : r.status === 'tripped' ? 'skipped' : 'held');
export const runState = (r) => (r.status === 'ok' ? 'ok' : r.status === 'fail' ? 'failed' : r.status === 'tripped' ? 'tripped' : 'held');

/** One sentence about where a job stands. */
export function stateSentence(j, now) {
  switch (j.state) {
    case 'running': return `It is running${j.pid ? ` as pid ${j.pid}` : ''}${j.runningSince ? `, started ${ago(j.runningSince, now)}` : ''}.`;
    case 'tripped': return `The breaker tripped after ${j.breaker.fails} failures in a row with exit ${j.breaker.code}. The wrapper skips every tick until you clear it.`;
    case 'failed': return j.lastExit ? `Its last run ${lastRunWords(j.lastExit)}${j.lastExit.at ? `, ${ago(j.lastExit.at, now)}` : ''}.` : 'Its last run failed.';
    case 'held': return j.breaker && j.breaker.next > now ? `The breaker holds it back until ${when(j.breaker.next, now)}.` : 'Its last tick was held back.';
    case 'ok': return `Its last run ended with exit 0${j.lastExit && j.lastExit.at ? `, ${ago(j.lastExit.at, now)}` : ''}.`;
    case 'loaded': return 'It is loaded and waiting for its next start.';
    case 'unloaded': return 'It is not loaded, so launchd will not start it.';
    case 'unreadable': return `Its plist could not be read: ${j.error}.`;
    default: return '';
  }
}

/** What to do next about a job that needs attention. */
export function nextStep(j) {
  if (j.state === 'tripped') return `Fix the cause, then clear the breaker with: launchboard reset ${j.ledgerLabel || j.label}`;
  if (j.state === 'failed') return j.logs.length ? 'Read the last lines of its log below to see why.' : 'It writes no log LaunchBoard can find. Set StandardOutPath in its plist, or run it through launchboard run --log, to see why it fails.';
  if (j.state === 'held') return 'The wrapper runs it again when the hold ends. Any successful run clears the breaker.';
  if (j.state === 'unreadable') return 'Check the plist with: plutil -lint <file>';
  return '';
}

/** The headline counts as sentences, with no figure standing alone. */
export function summarySentences(s) {
  const c = s.counts;
  if (!c.jobs) return ['No job matches this board.', ''];
  const parts = [c.running ? `${c.running} ${c.running === 1 ? 'is' : 'are'} running` : 'Nothing is running'];
  parts.push(c.failed ? `${c.failed} failed on ${c.failed === 1 ? 'its' : 'their'} last run` : 'none failed on its last run');
  if (c.tripped) parts.push(`${c.tripped} ${c.tripped === 1 ? 'is' : 'are'} tripped`);
  if (c.held) parts.push(`${c.held} ${c.held === 1 ? 'is' : 'are'} held back`);
  const first = `${plural(c.jobs, 'job', 'jobs')} on this board. ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
  const today = c.runsToday || c.heldToday
    ? `${plural(c.runsToday, 'run', 'runs')} recorded today: ${c.okToday} ok, ${c.failedToday} failed${c.heldToday ? `, ${c.heldToday} held back` : ''}.`
    : 'No runs recorded today.';
  return [first, `${today} ${c.loaded} of ${c.jobs} ${c.jobs === 1 ? 'job is' : 'jobs are'} loaded in launchd.`];
}

export function scopeWords(s) {
  const dirs = s.config.agentsDirs.join(' and ');
  return s.config.prefix.length ? `Jobs in ${dirs} whose label starts with ${s.config.prefix.join(' or ')}` : `Every job in ${dirs}`;
}
