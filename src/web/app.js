// The LaunchBoard page. It reads the snapshot the server pushes over server-sent events and draws
// it. Nothing here changes a job; the server answers GET only.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const STATE = { running: 'Running', tripped: 'Tripped', failed: 'Failed', held: 'Held', ok: 'OK', loaded: 'Loaded', unloaded: 'Not loaded', unreadable: 'Unreadable' };
  const ATTENTION = new Set(['failed', 'tripped', 'held', 'unreadable']);
  const ranToday = (j) => j.today.runs + j.today.held + j.today.tripped > 0;
  const FILTERS = [
    ['all', 'All', () => true],
    ['attention', 'Needs attention', (j) => ATTENTION.has(j.state)],
    ['running', 'Running', (j) => j.state === 'running'],
    ['today', 'Ran today', ranToday],
    ['unloaded', 'Not loaded', (j) => j.state === 'unloaded'],
  ];

  // ── time words ────────────────────────────────────────────────────────────────────────────
  const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const when = (t, now) => (sameDay(t, now) ? `at ${hm(t)}` : `on ${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${hm(t)}`);
  function ago(t, now) {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  function dur(ms) {
    if (ms == null) return '';
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
  const rowTime = (r) => Date.parse(r.end || r.start);
  // "was killed by SIGKILL" for a signal, "ended with exit 3" for a code.
  const lastRunWords = (e) => (e.code < 0 ? `was ${e.words}` : `ended with ${e.words}`);
  const shortExit = (e) => (e.code < 0 ? e.words.replace(/^killed by /, '') : e.words);

  // ── state of the page ─────────────────────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  let filter = FILTERS.some((f) => f[0] === params.get('show')) ? params.get('show') : 'all';
  let query = '';
  let selected = decodeURIComponent((location.hash.match(/^#job=(.+)$/) || [])[1] || '') || null;
  let snap = null;
  let detail = null;
  let detailTimer = null;
  let lastRows = '';

  // ── the summary ───────────────────────────────────────────────────────────────────────────
  function scopeHtml(s) {
    const dirs = s.config.agentsDirs.map((d) => `<code>${esc(d)}</code>`).join(' and ');
    if (s.config.prefix.length) return `Jobs in ${dirs} whose label starts with ${s.config.prefix.map((p) => `<code>${esc(p)}</code>`).join(' or ')}`;
    return `Every job in ${dirs}`;
  }
  function lede(s) {
    const c = s.counts;
    if (!c.jobs) return 'No job matches this board.';
    const parts = [];
    parts.push(c.running ? `<b class="t-running">${c.running} ${c.running === 1 ? 'is' : 'are'} running</b>` : 'Nothing is running');
    parts.push(c.failed ? `<b class="t-failed">${c.failed} failed on ${c.failed === 1 ? 'its' : 'their'} last run</b>` : 'none failed on its last run');
    if (c.tripped) parts.push(`<b class="t-tripped">${c.tripped} ${c.tripped === 1 ? 'is' : 'are'} tripped</b>`);
    if (c.held) parts.push(`<b class="t-held">${c.held} ${c.held === 1 ? 'is' : 'are'} held back</b>`);
    const list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `${plural(c.jobs, 'job', 'jobs')} on this board. ${list}.`;
  }
  function sub(s) {
    const c = s.counts;
    if (!c.jobs) return '';
    const out = [];
    if (c.runsToday || c.heldToday) {
      out.push(`${plural(c.runsToday, 'run', 'runs')} recorded today: ${c.okToday} ok, ${c.failedToday} failed${c.heldToday ? `, ${c.heldToday} held back` : ''}.`);
    } else {
      out.push('No runs recorded today.');
    }
    out.push(`${c.loaded} of ${c.jobs} ${c.jobs === 1 ? 'job is' : 'jobs are'} loaded in launchd.`);
    if (c.wrapped < c.jobs) out.push(`${c.wrapped ? `${c.wrapped} of ${c.jobs}` : 'None'} ${c.wrapped === 1 ? 'runs' : 'run'} through <code>launchboard run</code>, which records each run.`);
    return out.join(' ');
  }

  // ── the table ─────────────────────────────────────────────────────────────────────────────
  function lastExitCell(j, now) {
    if (j.state === 'running') return { main: j.runningSince ? `started ${ago(j.runningSince, now)}` : `pid ${j.pid}`, more: j.lastExit ? `before this: ${shortExit(j.lastExit)}` : '' };
    if (!j.lastExit) return { main: '<span class="more">none recorded</span>', more: '', raw: true };
    const bad = j.lastExit.code !== 0;
    return { main: `<span class="${bad ? 'code-bad' : ''}">${esc(j.lastExit.words)}</span>`, more: j.lastExit.at ? ago(j.lastExit.at, now) : j.lastExit.source === 'launchd' ? 'from launchd' : '', raw: true };
  }
  function todayCell(j, now) {
    const t = j.today;
    if (t.runs) return { main: t.runs === 1 ? 'ran once' : `ran ${t.runs} times`, more: [t.failed ? `${t.failed} failed` : 'all ok', t.held ? `${t.held} held` : '', t.tripped ? `${t.tripped} skipped` : ''].filter(Boolean).join(', ') };
    if (t.held || t.tripped) return { main: 'no runs', more: [t.held ? `${t.held} held` : '', t.tripped ? `${t.tripped} skipped, tripped` : ''].filter(Boolean).join(', ') };
    if (!j.wrapped) {
      const fresh = j.logs.filter((l) => sameDay(l.modified, now)).sort((a, b) => b.modified - a.modified)[0];
      return fresh ? { main: 'log written', more: when(fresh.modified, now) } : { main: 'not recorded', more: 'not wrapped' };
    }
    return { main: 'no runs', more: '' };
  }
  function row(j, now) {
    const ex = lastExitCell(j, now);
    const td = todayCell(j, now);
    const next = j.next ? `next ${when(j.next, now)}` : j.disabled ? 'disabled in its plist' : '';
    return `<tr data-label="${esc(j.label)}" aria-selected="${j.label === selected}">
<td><span class="pill" data-s="${j.state}"><i></i>${STATE[j.state] || esc(j.state)}</span></td>
<td><button class="job-name" type="button" title="${esc(j.label)}">${esc(j.label)}</button><span class="more prog" title="${esc(j.program)}">${esc(j.program || 'no program')}</span></td>
<td><span class="main" title="${esc(j.schedule.text)}">${esc(j.schedule.text)}</span><span class="more">${esc(next)}</span></td>
<td><span class="main">${ex.raw ? ex.main : esc(ex.main)}</span><span class="more">${esc(ex.more)}</span></td>
<td><span class="main">${esc(td.main)}</span><span class="more">${esc(td.more)}</span></td>
</tr>`;
  }
  function visible(s) {
    const f = FILTERS.find((x) => x[0] === filter)[2];
    const q = query.trim().toLowerCase();
    return s.jobs.filter((j) => f(j) && (!q || j.label.toLowerCase().includes(q) || (j.program || '').toLowerCase().includes(q)));
  }
  function drawFilters(s) {
    $('filters').innerHTML = FILTERS.map(([key, word, f]) => `<button type="button" data-f="${key}" aria-pressed="${key === filter}">${word}<span>${s.jobs.filter(f).length}</span></button>`).join('');
  }

  // ── the detail panel ──────────────────────────────────────────────────────────────────────
  function stateSentence(j, now) {
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
  function runsList(rows, now, withLabel) {
    if (!rows.length) return '<p>No runs recorded today.</p>';
    return `<ul class="runs${withLabel ? ' feed' : ''}">${rows.map((r) => {
      const st = r.status === 'ok' ? 'ok' : r.status === 'fail' ? 'failed' : r.status === 'tripped' ? 'tripped' : 'held';
      const word = r.status === 'ok' || r.status === 'fail' ? `exit ${r.code}` : r.status === 'tripped' ? 'skipped' : 'held';
      const what = r.said || r.reason || '';
      if (withLabel) return `<li><span class="t">${hm(rowTime(r))}</span><span class="said"><b>${esc(r.label)}</b> <span class="pill" data-s="${st}"><i></i>${word}</span>${r.ms != null && r.ms > 0 ? ` in ${dur(r.ms)}` : ''}${what ? `<br>${esc(what)}` : ''}</span></li>`;
      return `<li><span class="t">${hm(rowTime(r))}</span><span class="pill" data-s="${st}"><i></i>${word}</span><span class="said">${r.ms != null && r.ms > 0 ? `${dur(r.ms)}. ` : ''}${esc(what)}</span></li>`;
    }).join('')}</ul>`;
  }
  function drawToday(s) {
    const now = s.now;
    return `<div class="d-head"><h2>Today</h2><p>Every run the wrapper recorded since midnight, newest first. Pick a job for its schedule, its runs and the last lines of its logs.</p></div>
<div class="d-sec">${s.feed.length ? runsList(s.feed, now, true) : `<p class="hint">No runs recorded today. Runs are recorded for jobs whose plist starts them with <code>launchboard run &lt;label&gt; -- &lt;command&gt;</code>.</p>`}</div>`;
  }
  function drawJob(j, s) {
    const now = s.now;
    const d = detail && detail.job && detail.job.label === j.label ? detail.job : j;
    const facts = [
      ['Schedule', esc(j.schedule.text)],
      ['Next run', j.next ? esc(when(j.next, now)) : j.disabled ? 'never, it is disabled in its plist' : j.schedule.kind === 'daemon' ? 'it stays running' : 'not scheduled'],
      ['Program', `<span class="mono">${esc(j.program || 'none')}</span>`, true],
      j.cwd ? ['Directory', esc(j.cwd), true] : null,
      ['launchd', j.loaded ? (j.pid ? `loaded, running as pid ${j.pid}` : 'loaded, not running') : 'not loaded'],
      ['Last exit', j.lastExit ? `${esc(j.lastExit.words)}${j.lastExit.source === 'launchd' ? ' (from launchd)' : ''}` : 'none recorded'],
      ['Plist', esc(j.plist), true],
    ].filter(Boolean);
    const br = j.breaker;
    const breaker = br ? `<div class="d-sec"><h3>Breaker</h3><p>${plural(br.fails, 'failure', 'failures')} in a row, each with exit ${br.code}${br.since ? `, since ${esc(when(br.since, now))}` : ''}. ${br.tripped ? `<b>Tripped.</b> Clear it with <code>launchboard reset ${esc(j.ledgerLabel || j.label)}</code>.` : br.next > now ? `The next attempt waits until ${esc(when(br.next, now))}.` : 'The backoff has passed, so the next tick runs.'}</p></div>` : '';
    const wrapHint = j.wrapped ? '' : `<div class="d-sec hint"><h3>Recording runs</h3><p>This job does not run through the wrapper, so LaunchBoard knows only what launchd reports. Start it with <code>launchboard run ${esc(j.label)} -- ${esc(j.program || '&lt;command&gt;')}</code> in its plist to record each run and stop repeat failures.</p></div>`;
    const logs = d.logs.length ? d.logs.map((l) => `<div class="log"><p>${esc(l.path)}, written ${esc(ago(l.modified, now))}</p><pre>${esc(l.tail.join('\n')) || '(empty)'}</pre></div>`).join('') : '<p>No log file found. Set StandardOutPath in its plist, or run it with <code>launchboard run --log</code>.</p>';
    return `<div class="d-head"><button class="d-close" type="button" data-close>Back to today</button><h2>${esc(j.label)}</h2><p><span class="pill" data-s="${j.state}"><i></i>${STATE[j.state]}</span> ${esc(stateSentence(j, now))}</p></div>
<div class="d-sec"><dl class="facts">${facts.map(([k, v, mono]) => `<dt>${k}</dt><dd${mono ? ' class="mono"' : ''}>${v}</dd>`).join('')}</dl></div>
${breaker}
<div class="d-sec"><h3>Today</h3>${j.wrapped ? runsList(j.today.rows, now, false) : '<p>Not recorded. See below.</p>'}</div>
<div class="d-sec"><h3>Last lines of its logs</h3>${logs}</div>
${wrapHint}`;
  }
  function drawDetail(s) {
    const j = selected ? s.jobs.find((x) => x.label === selected) : null;
    const box = $('detail');
    const keep = [...box.querySelectorAll('pre')].map((p) => p.scrollHeight - p.scrollTop - p.clientHeight < 8);
    box.innerHTML = j ? drawJob(j, s) : drawToday(s);
    box.querySelectorAll('pre').forEach((p, i) => { if (keep[i] !== false) p.scrollTop = p.scrollHeight; });
  }

  // ── drawing ───────────────────────────────────────────────────────────────────────────────
  function draw() {
    const s = snap;
    if (!s) return;
    $('scope').innerHTML = scopeHtml(s);
    $('lede').innerHTML = lede(s);
    $('sub').innerHTML = sub(s);
    const warns = [];
    if (!s.launchctl.ok) warns.push(`launchctl could not be read (${esc(s.launchctl.error)}), so loaded and running states are unknown.`);
    for (const e of s.errors) warns.push(`${esc(e.where)}: ${esc(e.error)}`);
    $('warn').hidden = !warns.length;
    $('warn').innerHTML = warns.join(' ');
    drawFilters(s);
    const list = visible(s);
    // Redraw the rows only when they change, and give focus back to the row that had it, so a
    // keyboard user is not thrown out of the table every two seconds.
    const html = list.map((j) => row(j, s.now)).join('');
    if (html !== lastRows) {
      const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('tr[data-label]') : null;
      const keep = focused ? focused.dataset.label : null;
      $('rows').innerHTML = html;
      lastRows = html;
      if (keep) {
        const again = [...$('rows').querySelectorAll('tr[data-label]')].find((tr) => tr.dataset.label === keep);
        if (again) again.querySelector('.job-name').focus({ preventScroll: true });
      }
    }
    const empty = $('empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.innerHTML = !s.jobs.length
        ? (s.config.prefix.length
          ? `No job in ${s.config.agentsDirs.map((d) => `<code>${esc(d)}</code>`).join(' or ')} has a label that starts with ${s.config.prefix.map((p) => `<code>${esc(p)}</code>`).join(' or ')}. Start the board with another <code>--prefix</code>.`
          : `No plist was found in ${s.config.agentsDirs.map((d) => `<code>${esc(d)}</code>`).join(' or ')}.`)
        : 'No job matches this filter.';
    }
    drawDetail(s);
    $('clock').textContent = new Date(s.now).toLocaleTimeString();
    $('foot').innerHTML = `<span>LaunchBoard ${esc(s.version || '')}</span><span>Read-only. It never loads, unloads or starts a job.</span><span>Ledger in <code>${esc(s.config.logDir)}</code></span><span>MIT, Compound Labs</span>`;
  }

  async function loadDetail() {
    if (!selected) { detail = null; return; }
    try {
      const r = await fetch(`/api/job?label=${encodeURIComponent(selected)}`, { cache: 'no-store' });
      detail = r.ok ? await r.json() : null;
    } catch { detail = null; }
    if (snap) drawDetail(snap);
  }
  function select(label) {
    selected = label;
    detail = null;
    history.replaceState(null, '', `${location.pathname}${location.search}${label ? `#job=${encodeURIComponent(label)}` : ''}`);
    clearInterval(detailTimer);
    if (label) { loadDetail(); detailTimer = setInterval(loadDetail, 3000); }
    draw();
    if (label && window.matchMedia('(max-width: 1100px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── events ────────────────────────────────────────────────────────────────────────────────
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-label]');
    if (tr) select(tr.dataset.label === selected ? null : tr.dataset.label);
  });
  $('detail').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) select(null); });
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    const u = new URL(location.href);
    if (filter === 'all') u.searchParams.delete('show'); else u.searchParams.set('show', filter);
    history.replaceState(null, '', u);
    draw();
  });
  $('q').addEventListener('input', (e) => { query = e.target.value; draw(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) select(null); });

  function connect() {
    const live = $('live');
    const es = new EventSource('/events');
    es.onmessage = (m) => {
      try { snap = JSON.parse(m.data); } catch { return; }
      live.dataset.state = 'live';
      $('live-word').textContent = 'live';
      draw();
    };
    es.onerror = () => {
      live.dataset.state = 'reconnecting';
      $('live-word').textContent = 'reconnecting';
    };
  }
  if (selected) { loadDetail(); detailTimer = setInterval(loadDetail, 3000); }
  connect();
})();
