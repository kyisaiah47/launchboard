import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../src/server.js';
import { fixtureConfig, deps } from './helpers.js';

const request = (port, path, { method = 'GET', host } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: host ? { host } : {} }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; if (path === '/events' && body.includes('\n\n')) { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body }); } });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end();
});

test('the board serves its page, its snapshot and nothing that writes', async (t) => {
  const board = await startServer(fixtureConfig(), deps());
  t.after(() => board.close());
  const page = await request(board.port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>LaunchBoard<\/title>/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  const js = await request(board.port, '/app.js');
  assert.match(js.headers['content-type'], /javascript/);
  const state = await request(board.port, '/api/state');
  const snap = JSON.parse(state.body);
  assert.equal(snap.counts.jobs, 7);
  assert.equal(typeof snap.version, 'string');
  const job = JSON.parse((await request(board.port, '/api/job?label=com.example.launchboard.hello')).body);
  assert.equal(job.job.label, 'com.example.launchboard.hello');
  assert.equal((await request(board.port, '/api/job?label=nope')).status, 404);
  assert.match((await request(board.port, '/health')).body, /^ok 7 jobs/);
  const events = await request(board.port, '/events');
  assert.equal(JSON.parse(events.body.split('data: ')[1]).counts.jobs, 7);
  assert.equal((await request(board.port, '/api/state', { method: 'POST' })).status, 405);
  assert.equal((await request(board.port, '/api/state', { method: 'DELETE' })).status, 405);
  assert.equal((await request(board.port, '/api/state', { host: 'evil.example' })).status, 421);
  assert.equal((await request(board.port, '/nope')).status, 404);
});
