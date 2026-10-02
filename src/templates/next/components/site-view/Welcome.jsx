'use client';
// START HERE. What LaunchBoard does, one labelled illustration of its output, and the choice of
// view. It opens by itself on / unless the visitor turned it off or ?welcome=0 is present. Closing
// or choosing never turns it off; the checkbox does.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSiteView, WELCOME_EVENT, WELCOME_OFF_KEY } from './SiteViewProvider';

function readOff() {
  try { return localStorage.getItem(WELCOME_OFF_KEY) === '1'; } catch { return false; }
}

export default function Welcome() {
  const mode = useSiteView();
  const path = usePathname();
  const dialog = useRef(null);
  const timer = useRef(null);
  const previous = useRef(null);
  const [off, setOff] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOff(readOff());
    const el = dialog.current;
    if (!el) return;
    setMounted(true);
    if (!el.open) {
      previous.current = document.activeElement;
      el.showModal();
    }
    requestAnimationFrame(() => {
      setVisible(true);
      if (!el.contains(document.activeElement) || document.activeElement === el) el.querySelector('.sv-welcome-top > button')?.focus();
    });
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setMounted(false);
      const back = previous.current;
      if (back && back.isConnected && back !== document.body) back.focus();
    }, reduced ? 0 : 220);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (path === '/' && !readOff() && q.get('welcome') !== '0') show();
    window.addEventListener(WELCOME_EVENT, show);
    return () => {
      window.removeEventListener(WELCOME_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path, show]);

  const select = (view) => { mode?.choose(view); close(); };

  return (
    <dialog
      ref={dialog}
      className="sv-welcome"
      data-visible={visible}
      aria-labelledby="sv-welcome-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dialog.current) close(); }}
    >
      {mounted ? (
        <>
          <header className="sv-welcome-top">
            <span className="sv-brand">LaunchBoard <small>/ START HERE</small></span>
            <button type="button" aria-label="Close welcome" onClick={close}>×</button>
          </header>
          <div className="sv-welcome-intro">
            <h2 id="sv-welcome-title">Did your scheduled jobs run today?</h2>
            <p>
              Your Mac runs jobs on a schedule through launchd. LaunchBoard reads them and shows which ones are running,
              which ones failed on their last run, and what each one did today. It only reads. It never starts or stops a job.
            </p>
          </div>
          <section className="sv-illustration" aria-label="Illustration of one job on the board">
            <div><span>ONE JOB. ONE DAY.</span><span>ILLUSTRATION</span></div>
            <p>A job that backs up a folder every hour, made up for this picture.</p>
            <dl className="sv-illustration-answer">
              <div><dt>job</dt><dd>com.example.backup</dd></div>
              <div><dt>state</dt><dd>Failed. Its last run ended with exit 1 at 09:00.</dd></div>
              <div><dt>today</dt><dd>Ran 9 times, 1 failed.</dd></div>
              <div><dt>its log</dt><dd>rsync: connection unexpectedly closed</dd></div>
            </dl>
            <p>The board shows every job like this one, with the last lines of its log.</p>
          </section>
          <section className="sv-welcome-choose">
            <div><h3>How would you like to explore?</h3><p>You can switch anytime.</p></div>
            <div className="sv-choices">
              <button type="button" onClick={() => select('console')}>
                <span>▦ <b>Console</b><span aria-hidden="true">↗</span></span>
                <strong>See more at once.</strong>
                <span>A compact layout with more data and controls on screen.</span>
              </button>
              <button type="button" onClick={() => select('simple')}>
                <span>☰ <b>Simple</b><span aria-hidden="true">↗</span></span>
                <strong>Start with the essentials.</strong>
                <span>A roomier overview with details you can open as you go.</span>
              </button>
            </div>
          </section>
          <footer>
            <label>
              <input
                type="checkbox"
                checked={off}
                onChange={(e) => {
                  const value = e.target.checked;
                  setOff(value);
                  try { if (value) localStorage.setItem(WELCOME_OFF_KEY, '1'); else localStorage.removeItem(WELCOME_OFF_KEY); } catch { /* the choice lasts this visit */ }
                }}
              />
              Don&rsquo;t open this when I come back
            </label>
          </footer>
        </>
      ) : null}
    </dialog>
  );
}
