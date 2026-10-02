// The last lines of a log file, read from its end so a large log costs the same as a small one.
// Results are cached by path, size and modification time.
import fs from 'node:fs';

const cache = new Map();

/** { lines, size, modified } for the last `n` lines of `file`, or null when it cannot be read. */
export function tail(file, n = 20, { maxBytes = 64 * 1024 } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;
  const key = `${file}\0${n}`;
  const hit = cache.get(key);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.value;
  let text = '';
  try {
    const len = Math.min(maxBytes, st.size);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  let lines = text.split('\n');
  if (st.size > maxBytes) lines = lines.slice(1);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const value = { lines: lines.slice(-n).map((l) => (l.length > 500 ? `${l.slice(0, 499)}…` : l)), size: st.size, modified: st.mtimeMs };
  if (cache.size > 2000) cache.clear();
  cache.set(key, { size: st.size, mtimeMs: st.mtimeMs, value });
  return value;
}
