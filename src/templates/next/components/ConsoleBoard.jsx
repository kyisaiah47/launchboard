'use client';
// THE CONSOLE. One bar, the summary in sentences, the filters, then the job table with the open
// job's details beside it: its schedule, launchd's view of it, the breaker, today's runs and the
// last lines of its logs.
import { useEffect } from 'react';
import { useBoard, useJob, useKept } from '../lib/useBoard';
import { ATTENTION, ranToday, plural, when, ago, dur, hm, sameDay, rowTime, runWord, runState, stateSentence, summarySentences, scopeWords } from '../lib/words';
import Pill from './Pill';

const FILTERS = [
  ['all', 'All', () => true],
  ['attention', 'Needs attention', (j) => ATTENTION.has(j.state)],
  ['running', 'Running', (j) => j.state === 'running'],
  ['today', 'Ran today', ranToday],
  ['unloaded', 'Not loaded', (j) => j.state === 'unloaded'],
];

function LastExit({ j, now }) {
  if (j.state === 'running') return <><span className="main">{j.runningSince ? `started ${ago(j.runningSince, now)}` : `pid ${j.pid}`}</span><span className="more">{j.lastExit ? `last ${j.lastExit.words}` : ''}</span></>;
  if (!j.lastExit) return <span className="more">none recorded</span>;
  return <><span className={`main${j.lastExit.code !== 0 ? ' code-bad' : ''}`}>{j.lastExit.words}</span><span className="more">{j.lastExit.at ? ago(j.lastExit.at, now) : 'from launchd'}</span></>;
}

function Today({ j, now }) {
  const t = j.today;
  if (t.runs) return <><span className="main">{t.runs === 1 ? 'ran once' : `ran ${t.runs} times`}</span><span className="more">{[t.failed ? `${t.failed} failed` : 'all ok', t.held ? `${t.held} held` : '', t.tripped ? `${t.tripped} skipped` : ''].filter(Boolean).join(', ')}</span></>;
  if (t.held || t.tripped) return <><span className="main">no runs</span><span className="more">{[t.held ? `${t.held} held` : '', t.tripped ? `${t.tripped} skipped` : ''].filter(Boolean).join(', ')}</span></>;
  if (!j.wrapped) {
    const fresh = j.logs.filter((l) => sameDay(l.modified, now)).sort((a, b) => b.modified - a.modified)[0];
    return fresh ? <><span className="main">log written</span><span className="more">{when(fresh.modified, now)}</span></> : <><span className="main">not recorded</span><span className="more">not wrapped</span></>;
  }
  return <span className="main">no runs</span>;
}

export function Runs({ rows, now, withLabel = false }) {
  if (!rows.length) return <p>No runs recorded today.</p>;
  return (
    <ul className={`runs${withLabel ? ' feed' : ''}`}>
      {rows.map((r, i) => (
        <li key={`${r.label || ''}${r.start}${i}`}>
          <span className="t">{hm(rowTime(r))}</span>
          {withLabel ? (
            <span className="said"><b>{r.label}</b> <Pill state={runState(r)}>{runWord(r)}</Pill>{r.ms > 0 ? ` in ${dur(r.ms)}` : ''}{r.said || r.reason ? <><br />{r.said || r.reason}</> : null}</span>
          ) : (
            <><Pill state={runState(r)}>{runWord(r)}</Pill><span className="said">{r.ms > 0 ? `${dur(r.ms)}. ` : ''}{r.said || r.reason}</span></>
          )}
        </li>
      ))}
    </ul>
  );
}

function Detail({ j, full, now, onClose }) {
  const d = full && full.label === j.label ? full : j;
  const br = j.breaker;
  const facts = [
    ['Schedule', j.schedule.text],
    ['Next run', j.next ? when(j.next, now) : j.disabled ? 'never, it is disabled in its plist' : j.schedule.kind === 'daemon' ? 'it stays running' : 'not scheduled'],
    ['Program', j.program || 'none', true],
    j.cwd ? ['Directory', j.cwd, true] : null,
    ['launchd', j.loaded ? (j.pid ? `loaded, running as pid ${j.pid}` : 'loaded, not running') : 'not loaded'],
    ['Last exit', j.lastExit ? `${j.lastExit.words}${j.lastExit.source === 'launchd' ? ' (from launchd)' : ''}` : 'none recorded'],
    ['Plist', j.plist, true],
  ].filter(Boolean);
  return (
    <>
      <div className="d-head">
        <button className="d-close" type="button" onClick={onClose}>Back to today</button>
        <h2>{j.label}</h2>
        <p><Pill state={j.state} /> {stateSentence(j, now)}</p>
      </div>
      <div className="d-sec">
        <dl className="facts">
          {facts.map(([k, v, mono]) => <div key={k} className="fact"><dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd></div>)}
        </dl>
      </div>
      {br ? (
        <div className="d-sec">
          <h3>Breaker</h3>
          <p>{plural(br.fails, 'failure', 'failures')} in a row, each with exit {br.code}{br.since ? `, since ${when(br.since, now)}` : ''}. {br.tripped ? <><b>Tripped.</b> Clear it with <code>launchboard reset {j.ledgerLabel || j.label}</code>.</> : br.next > now ? `The next attempt waits until ${when(br.next, now)}.` : 'The backoff has passed, so the next tick runs.'}</p>
        </div>
      ) : null}
      <div className="d-sec"><h3>Today</h3>{j.wrapped ? <Runs rows={j.today.rows} now={now} /> : <p>Not recorded, because this job does not run through the wrapper.</p>}</div>
      <div className="d-sec">
        <h3>Last lines of its logs</h3>
        {d.logs.length ? d.logs.map((l) => (
          <div className="log" key={l.path}><p>{l.path}, written {ago(l.modified, now)}</p><pre>{l.tail.join('\n') || '(empty)'}</pre></div>
        )) : <p>No log file found. Set StandardOutPath in its plist, or run it with <code>launchboard run --log</code>.</p>}
      </div>
      {!j.wrapped ? <div className="d-sec hint"><h3>Recording runs</h3><p>Start it with <code>launchboard run {j.label} -- {j.program || '<command>'}</code> in its plist to record each run and stop repeat failures.</p></div> : null}
    </>
  );
}

export default function ConsoleBoard() {
  const { snap, status } = useBoard();
  const [filter, setFilter] = useKept('console:filter', 'all');
  const [query, setQuery] = useKept('console:query', '');
  const [selected, setSelected] = useKept('board:selected', null);
  const full = useJob(selected);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const bar = (
    <header className="bar">
      <span className="brand">LaunchBoard</span>
      <p className="scope">{snap ? scopeWords(snap) : ''}</p>
      <p className="live" data-state={status}><i aria-hidden="true" />{status}{snap ? <span className="clock">{new Date(snap.now).toLocaleTimeString()}</span> : null}</p>
    </header>
  );
  if (!snap) return <>{bar}<main className="lb-main"><p className="lede">Reading launchd.</p></main></>;

  const now = snap.now;
  const [first, second] = summarySentences(snap);
  const f = FILTERS.find((x) => x[0] === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  const list = snap.jobs.filter((j) => f[2](j) && (!q || j.label.toLowerCase().includes(q) || (j.program || '').toLowerCase().includes(q)));
  const open = selected ? snap.jobs.find((j) => j.label === selected) : null;

  return (
    <>
      {bar}
      <main className="lb-main">
        <section className="summary" aria-live="polite">
          <p className="lede">{first}</p>
          <p className="sub">{second}</p>
          {!snap.launchctl.ok ? <p className="warn">launchctl could not be read ({snap.launchctl.error}), so loaded and running states are unknown.</p> : null}
        </section>
        <div className="tools">
          <div className="filters" role="group" aria-label="Show">
            {FILTERS.map(([key, word, fn]) => (
              <button key={key} type="button" aria-pressed={key === filter} onClick={() => setFilter(key)}>{word}<span>{snap.jobs.filter(fn).length}</span></button>
            ))}
          </div>
          <label className="search"><span className="vh">Filter jobs by label or program</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by label or program" autoComplete="off" spellCheck={false} /></label>
        </div>
        <div className="grid">
          <section className="list" aria-label="Jobs">
            <table>
              <thead><tr><th scope="col">State</th><th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">Last exit</th><th scope="col">Today</th></tr></thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.label} aria-selected={j.label === selected} onClick={() => setSelected(j.label === selected ? null : j.label)}>
                    <td><Pill state={j.state} /></td>
                    <td><button className="job-name" type="button" title={j.label}>{j.label}</button><span className="more prog" title={j.program}>{j.program || 'no program'}</span></td>
                    <td><span className="main" title={j.schedule.text}>{j.schedule.text}</span><span className="more">{j.next ? `next ${when(j.next, now)}` : j.disabled ? 'disabled in its plist' : ''}</span></td>
                    <td><LastExit j={j} now={now} /></td>
                    <td><Today j={j} now={now} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length ? <p className="empty">{snap.jobs.length ? 'No job matches this filter.' : `No job matches this board. ${scopeWords(snap)}: none found.`}</p> : null}
          </section>
          <aside className="detail" aria-live="polite">
            {open ? <Detail j={open} full={full} now={now} onClose={() => setSelected(null)} /> : (
              <>
                <div className="d-head"><h2>Today</h2><p>Every run the wrapper recorded since midnight, newest first. Pick a job for its schedule, its runs and the last lines of its logs.</p></div>
                <div className="d-sec">{snap.feed.length ? <Runs rows={snap.feed} now={now} withLabel /> : <p className="hint">No runs recorded today. Runs are recorded for jobs whose plist starts them with <code>launchboard run &lt;label&gt; -- &lt;command&gt;</code>.</p>}</div>
              </>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
