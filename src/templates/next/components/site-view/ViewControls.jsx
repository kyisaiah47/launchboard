'use client';
import { useSiteView } from './SiteViewProvider';

// The Console / Simple switch, beside the name in both headers. The two glyphs are Phosphor Regular
// (MIT): terminal-window and article.
const TERMINAL = 'M128,128a8,8,0,0,1-3,6.25l-40,32a8,8,0,1,1-10-12.5L107.19,128,75,102.25a8,8,0,1,1,10-12.5l40,32A8,8,0,0,1,128,128Zm48,24H136a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16Zm56-96V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H216Z';
const ARTICLE = 'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200ZM184,96a8,8,0,0,1-8,8H80a8,8,0,0,1,0-16h96A8,8,0,0,1,184,96Zm0,32a8,8,0,0,1-8,8H80a8,8,0,0,1,0-16h96A8,8,0,0,1,184,128Zm0,32a8,8,0,0,1-8,8H80a8,8,0,0,1,0-16h96A8,8,0,0,1,184,160Z';
const Glyph = ({ d }) => <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d={d} /></svg>;

export default function ViewControls() {
  const mode = useSiteView();
  if (!mode) return null;
  return (
    <div className="sv-view-toggle" role="group" aria-label="Page view">
      <button type="button" onClick={() => mode.choose('console')} aria-pressed={mode.view === 'console'} title="Console view"><Glyph d={TERMINAL} />Console</button>
      <button type="button" onClick={() => mode.choose('simple')} aria-pressed={mode.view === 'simple'} title="Simple view"><Glyph d={ARTICLE} />Simple</button>
    </div>
  );
}
