// The board's server. Read-only by construction: it answers GET and HEAD and nothing else, it
// binds to 127.0.0.1 by default, it refuses requests whose Host header is not the address it
// listens on (so a web page cannot read it through DNS rebinding), and no route changes a job.
//
//   GET /              the page
//   GET /api/state     the snapshot, as JSON
//   GET /api/job?label=<label>   one job with longer log tails
//   GET /events        the snapshot as server-sent events, pushed every two seconds
//   GET /health        "ok" and the number of jobs on the board
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, jobDetail } from './collect.js';
import { VERSION } from './version.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['favicon.svg', 'image/svg+xml'],
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Start the board. Resolves to { server, url, port, close }.
 * deps are passed to collect() (tests inject launchctl output, a clock and plist readers).
 */
export function startServer(cfg, deps = {}) {
  const collectFn = deps.collect || ((c) => collect(c, deps));
  const detailFn = deps.jobDetail || ((c, label) => jobDetail(c, label, deps));
  const pushEvery = deps.pushEvery ?? 2000;
  let cached = null;
  let cachedAt = 0;
  const snapshot = () => {
    const t = Date.now();
    if (!cached || t - cachedAt >= 1000) {
      cached = { version: VERSION, ...collectFn(cfg) };
      cachedAt = t;
    }
    return cached;
  };
  const clients = new Set();
  let boundPort = cfg.port;

  const allowedHost = (host) => {
    if (!host) return false;
    const h = host.toLowerCase();
    const names = new Set(['127.0.0.1', 'localhost', '[::1]', String(cfg.host).toLowerCase()]);
    for (const n of names) if (h === `${n}:${boundPort}` || (boundPort === 80 && h === n)) return true;
    return false;
  };
  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'referrer-policy': 'no-referrer', ...extra });
    res.end(body);
  };
  const json = (res, status, value) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'LaunchBoard is read-only. It answers GET only.\n', { allow: 'GET, HEAD' });
    if (!allowedHost(req.headers.host)) return send(res, 421, 'text/plain; charset=utf-8', 'This board answers only on the address it listens on.\n');
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); } catch { return send(res, 400, 'text/plain; charset=utf-8', 'bad request\n'); }
    const file = STATIC[url.pathname];
    if (file) {
      return fs.readFile(path.join(WEB, file[0]), (err, buf) => (err ? send(res, 500, 'text/plain; charset=utf-8', `cannot read ${file[0]}\n`) : send(res, 200, file[1], buf)));
    }
    try {
      if (url.pathname === '/api/state') return json(res, 200, snapshot());
      if (url.pathname === '/api/job') {
        const label = url.searchParams.get('label') || '';
        const d = label ? detailFn(cfg, label) : null;
        return d ? json(res, 200, d) : json(res, 404, { error: `no job on this board is labelled ${label}` });
      }
      if (url.pathname === '/health') return send(res, 200, 'text/plain; charset=utf-8', `ok ${snapshot().counts.jobs} jobs\n`);
      if (url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
        res.write(`retry: 2000\ndata: ${JSON.stringify(snapshot())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return undefined;
      }
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
  });

  const timer = setInterval(() => {
    if (!clients.size) return;
    let data;
    try { data = `data: ${JSON.stringify(snapshot())}\n\n`; } catch { return; }
    for (const c of clients) { try { c.write(data); } catch { clients.delete(c); } }
  }, pushEvery);
  timer.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      boundPort = server.address().port;
      const shownHost = cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host;
      resolve({
        server,
        port: boundPort,
        url: `http://${shownHost}:${boundPort}/`,
        close: () => new Promise((done) => {
          clearInterval(timer);
          for (const c of clients) { try { c.end(); } catch { /* gone */ } }
          clients.clear();
          server.close(() => done());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}
