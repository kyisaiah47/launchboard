'use client';
// THE SIMPLE VIEW. The outcome first: which jobs need attention, in sentences. Then what is running,
// what ran today, and everything else. Logs, runs and programs open on request.
import { useBoard } from '../lib/useBoard';
import { ATTENTION, STATE, ranToday, plural, when, ago, hm, rowTime, runWord, runState, stateSentence, nextStep, summarySentences, scopeWords } from '../lib/words';
import Disclosure from './Disclosure';
import Pill from './Pill';

function RunsList({ rows }) {
  if (!rows.length) return <p>No runs recorded today.</p>;
  return (
    <ul className="sv-runs">
      {rows.map((r, i) => (
        <li key={`${r.start}${i}`}>
          <span className="sv-time">{hm(rowTime(r))}</span>
          <Pill state={runState(r)}>{runWord(r)}</Pill>
          <span>{r.said || r.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function Logs({ j, now }) {
  if (!j.logs.length) return <p>No log file found. Set StandardOutPath in its plist, or run it with <code>launchboard run --log</code>.</p>;
  return j.logs.map((l) => (
    <div key={l.path} className="sv-log">
      <p>The last lines of {l.path}, written {ago(l.modified, now)}.</p>
      <pre className="sv-pre">{l.tail.join('\n') || '(empty)'}</pre>
    </div>
  ));
}

function JobCard({ j, now }) {
  const step = nextStep(j);
  return (
    <article className="sv-card sv-job" data-s={j.state}>
      <div className="sv-step"><span>{j.label}</span><Pill state={j.state} /></div>
      <h3>{stateSentence(j, now)}</h3>
      {step ? <p className="sv-card-sub">{step}</p> : null}
      <div className="sv-disclosures">
        <Disclosure title="Last lines of its log"><Logs j={j} now={now} /></Disclosure>
        <Disclosure title="Its runs today">{j.wrapped ? <RunsList rows={j.today.rows} /> : <p>Not recorded, because this job does not run through the wrapper.</p>}</Disclosure>
        <Disclosure title="Its schedule and program">
          <p>It runs {j.schedule.text}.{j.next ? ` Next ${when(j.next, now)}.` : ''}</p>
          <pre className="sv-pre">{j.program || 'no program'}</pre>
          <p>{j.loaded ? 'launchd has it loaded.' : 'launchd does not have it loaded.'} Its plist is {j.plist}.</p>
        </Disclosure>
      </div>
    </article>
  );
}

function todayLine(j, now) {
  const t = j.today;
  const last = t.rows[0];
  const parts = [t.runs ? (t.runs === 1 ? 'ran once today' : `ran ${t.runs} times today`) : 'had no runs today'];
  parts.push(t.failed ? `${t.failed} failed` : t.runs ? 'all ok' : '');
  if (t.held) parts.push(`${t.held} held back`);
  return `${parts.filter(Boolean).join(', ')}.${last ? ` Last ${when(rowTime(last), now)}.` : ''}`;
}

export default function SimpleBoard({ viewToggle } = {}) {
  const { snap, status } = useBoard();
  const nav = (
    <header className="sv-nav">
      {viewToggle ? <span className="sv-brand-stack"><span className="sv-brand">LaunchBoard</span>{viewToggle}</span> : <span className="sv-brand">LaunchBoard</span>}
      <p className="sv-live" data-state={status}><i aria-hidden="true" />{status === 'live' ? 'Live, updates every two seconds' : status}</p>
    </header>
  );
  if (!snap) return <>{nav}<main className="sv-home"><section className="sv-hero"><div className="sv-pitch"><h1>Reading launchd.</h1></div></section></main></>;

  const now = snap.now;
  const attention = snap.jobs.filter((j) => ATTENTION.has(j.state));
  const running = snap.jobs.filter((j) => j.state === 'running');
  const ran = snap.jobs.filter((j) => !attention.includes(j) && !running.includes(j) && ranToday(j));
  const rest = snap.jobs.filter((j) => !attention.includes(j) && !running.includes(j) && !ran.includes(j));
  const [first, second] = summarySentences(snap);
  const headline = !snap.jobs.length
    ? 'No job matches this board.'
    : attention.length ? `${plural(attention.length, 'job needs', 'jobs need')} your attention.`
      : 'Nothing failed on its last run.';

  return (
    <>
      {nav}
      <main className="sv-home">
        <section className="sv-hero">
          <div className="sv-pitch">
            <span className="sv-eyebrow">{scopeWords(snap)}</span>
            <h1>{headline}</h1>
            <p>{first} {second}</p>
            {!snap.launchctl.ok ? <p className="sv-qualifier">launchctl could not be read ({snap.launchctl.error}), so loaded and running states are unknown.</p> : null}
          </div>
        </section>

        <section className="sv-section" id="attention" aria-labelledby="h-attention">
          <div className="sv-section-intro">
            <h2 id="h-attention">Needs attention</h2>
            <p>Jobs whose last run failed, jobs the breaker tripped, and jobs it is holding back.</p>
          </div>
          {attention.length ? <div className="sv-cards">{attention.map((j) => <JobCard key={j.label} j={j} now={now} />)}</div> : <p className="sv-note">No job failed on its last run, tripped or is held back.</p>}
        </section>

        <section className="sv-section" id="running" aria-labelledby="h-running">
          <div className="sv-section-intro">
            <h2 id="h-running">Running now</h2>
            <p>Jobs with a process alive right now. A job that launchd keeps alive is always here.</p>
          </div>
          {running.length ? (
            <ul className="sv-lines">
              {running.map((j) => <li key={j.label}><b>{j.label}</b> <span>{stateSentence(j, now)} It runs {j.schedule.text}.</span></li>)}
            </ul>
          ) : <p className="sv-note">Nothing is running.</p>}
        </section>

        <section className="sv-section" id="today" aria-labelledby="h-today">
          <div className="sv-section-intro">
            <h2 id="h-today">Ran today</h2>
            <p>Jobs the wrapper recorded since midnight. Open one to see each run and the last line it printed.</p>
          </div>
          {ran.length ? ran.map((j) => (
            <Disclosure key={j.label} title={<><b className="sv-mono">{j.label}</b> {todayLine(j, now)}</>}><RunsList rows={j.today.rows} /></Disclosure>
          )) : <p className="sv-note">No other job recorded a run today.</p>}
        </section>

        {rest.length ? (
          <section className="sv-section" id="others" aria-labelledby="h-others">
            <div className="sv-section-intro">
              <h2 id="h-others">Everything else</h2>
              <p>Jobs that did not run today, or that LaunchBoard cannot see run because they do not go through the wrapper.</p>
            </div>
            <Disclosure title={`The other ${plural(rest.length, 'job', 'jobs')}`}>
              <ul className="sv-lines">
                {rest.map((j) => <li key={j.label}><b>{j.label}</b> <span>{STATE[j.state]}. Runs {j.schedule.text}.{j.lastExit ? ` Last ${j.lastExit.words}.` : ''}</span></li>)}
              </ul>
            </Disclosure>
          </section>
        ) : null}

        <section className="sv-section" id="record" aria-labelledby="h-record">
          <div className="sv-section-intro">
            <h2 id="h-record">Record every run</h2>
            <p>launchd keeps only a job's last exit code. Start a job through the wrapper and each run gets a ledger row, and a job that keeps failing the same way is stopped.</p>
          </div>
          <pre className="sv-pre">{'<key>ProgramArguments</key>\n<array>\n  <string>/usr/bin/env</string>\n  <string>launchboard</string>\n  <string>run</string>\n  <string>com.example.backup</string>\n  <string>--</string>\n  <string>/bin/echo</string>\n  <string>backing up</string>\n</array>'}</pre>
        </section>
      </main>
    </>
  );
}
