'use client';
// The snapshot, read every two seconds, and one job's detail while it is open. The interval and the
// last good snapshot live here, so switching between Console and Simple keeps what was read.
import { useEffect, useState } from 'react';

let lastSnap = null;

export function useBoard(every = 2000) {
  const [snap, setSnap] = useState(lastSnap);
  const [status, setStatus] = useState(lastSnap ? 'live' : 'connecting');
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        const body = await r.json();
        if (stop) return;
        if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
        lastSnap = body;
        setSnap(body);
        setStatus('live');
      } catch {
        if (!stop) setStatus('reconnecting');
      }
    };
    load();
    const t = setInterval(load, every);
    return () => { stop = true; clearInterval(t); };
  }, [every]);
  return { snap, status };
}

export function useJob(label, every = 3000) {
  const [job, setJob] = useState(null);
  useEffect(() => {
    setJob(null);
    if (!label) return undefined;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/job?label=${encodeURIComponent(label)}`, { cache: 'no-store' });
        if (!r.ok) return;
        const body = await r.json();
        if (!stop) setJob(body.job);
      } catch { /* the next poll tries again */ }
    };
    load();
    const t = setInterval(load, every);
    return () => { stop = true; clearInterval(t); };
  }, [label, every]);
  return job;
}

// State that survives a view switch and a remount, and never reaches browser storage: the open job,
// the filter and the search text.
const kept = new Map();
export function useKept(key, initial) {
  const [value, setValue] = useState(() => (kept.has(key) ? kept.get(key) : initial));
  const set = (next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      kept.set(key, v);
      return v;
    });
  };
  return [value, set];
}
