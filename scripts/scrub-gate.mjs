#!/usr/bin/env node
// The scrub gate. It reads every file in the repository and fails if any of them carries
// something that must not be published: a personal email address, a home directory path, a
// private project or account identifier, a key-shaped string, or bot-detection bypass code.
//
//   node scripts/scrub-gate.mjs [root]
//
// It fails closed. A file it cannot read, a file too large to read, or a tree with no files in it
// is a failure, not a pass. There is no flag that skips a rule and no list of accepted findings:
// a finding is fixed by changing the file.
//
// The literal identifiers below are stored base64-encoded so that this file does not contain the
// strings it looks for, and can be scanned like every other file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const decode = (s) => Buffer.from(s, 'base64').toString('utf8');
const MAX_BYTES = 5 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next']);
const ALLOWED_EMAIL_DOMAINS = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i;

export const RULES = [
  { name: 'personal email address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, allow: (m) => ALLOWED_EMAIL_DOMAINS.test(m) },
  { name: 'home directory path', re: new RegExp(decode('L1VzZXJzL2FkbWlu'), 'gi') },
  { name: 'home directory path', re: /\/Users\/[A-Za-z0-9._-]+/g },
  { name: 'private workspace name', re: new RegExp(decode('Y29tcG91bmRsYWJz'), 'gi') },
  { name: 'private job namespace', re: new RegExp(decode('Y29tcG91bmRcLnNoYXJlZA=='), 'gi') },
  { name: 'private job namespace', re: new RegExp(decode('c3R1ZGlvXC5jb21wb3VuZA=='), 'gi') },
  { name: 'private repository name', re: new RegExp(decode('Y29tcG91bmQtb3Bz'), 'gi') },
  { name: 'private database project id', re: new RegExp(decode('eG93ZWtxZHN0dHh3YmhmeHZ1c2E='), 'gi') },
  { name: 'database project URL', re: /\b[a-z]{20}\.supabase\.co\b/g },
  { name: 'private secrets tool', re: new RegExp(decode('Y29tcG91bmQtc2VjcmV0'), 'gi') },
  { name: 'private vault tool', re: new RegExp(decode('Y29tcG91bmQtdmF1bHQ='), 'gi') },
  { name: 'account handle', re: new RegExp(decode('QGt5aXNhaWFoNDdcYnxreWlzYWlhaDQ3XC50aGVjb21wb3VuZFwudGVjaHxjb21wb3VuZGxhYnNpbmN8dGhlY29tcG91bmRsYWJzfHRoZS1jb21wb3VuZC1sYWJz'), 'gi') },
  { name: 'decentralized identifier', re: /\bdid:plc:[a-z0-9]{16,}/g },
  { name: 'payment account id', re: /\bacct_[A-Za-z0-9]{14,}/g },
  { name: 'model API key', re: /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'payment API key', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'webhook secret', re: /\bwhsec_[A-Za-z0-9]{20,}/g },
  { name: 'cloud access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'email API key', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g },
  { name: 'database access token', re: /\b(?:sbp_[a-f0-9]{40}|sb_secret_[A-Za-z0-9_-]{20,})/g },
  { name: 'private key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { name: 'signed token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'bot-detection bypass plugin', re: new RegExp(decode('cHVwcGV0ZWVyLWV4dHJhLXBsdWdpbi1zdGVhbHRofHBsYXl3cmlnaHQtZXh0cmF8U3RlYWx0aFBsdWdpbg=='), 'gi') },
  { name: 'automated challenge solving', re: new RegExp(decode('MmNhcHRjaGF8YW50aS0/Y2FwdGNoYXxjYXBzb2x2ZXJ8Y2FwdGNoYS4/c29sdg=='), 'gi') },
  { name: 'webdriver flag override', re: new RegExp(decode('ZGVmaW5lUHJvcGVydHlcKFxzKm5hdmlnYXRvclxzKixccypbJyJdd2ViZHJpdmVyfG5hdmlnYXRvclwud2ViZHJpdmVyXHMqPVtePV0='), 'gi') },
];

function walk(dir, root, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), root, out); continue; }
    out.push(path.relative(root, path.join(dir, e.name)));
  }
  return out;
}

/** Every file to scan: what git tracks plus what it would add, or the whole tree outside git. */
export function listFiles(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (fs.realpathSync(top) === fs.realpathSync(root)) {
      const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
      return [...new Set(out.split('\0').filter(Boolean))].filter((f) => fs.existsSync(path.join(root, f)));
    }
  } catch { /* not a git checkout: walk it */ }
  return walk(root, root, []);
}

const mask = (s) => (s.length <= 6 ? `${s[0]}***` : `${s.slice(0, 4)}***${s.slice(-2)}`);

/** Scan a tree. Returns { files, findings }. */
export function scan(root) {
  const files = listFiles(root);
  const findings = [];
  for (const rel of files) {
    const file = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(file); } catch (e) { findings.push({ file: rel, line: 0, rule: 'unreadable file', match: e.code || 'error' }); continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    if (st.size > MAX_BYTES) { findings.push({ file: rel, line: 0, rule: 'file too large to scan', match: `${st.size} bytes` }); continue; }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { findings.push({ file: rel, line: 0, rule: 'unreadable file', match: e.code || 'error' }); continue; }
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const m of text.matchAll(rule.re)) {
        if (rule.allow && rule.allow(m[0])) continue;
        const line = text.slice(0, m.index).split('\n').length;
        findings.push({ file: rel, line, rule: rule.name, match: mask(m[0]) });
      }
    }
  }
  return { files, findings };
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  let result;
  try {
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    result = scan(root);
  } catch (e) {
    console.error(`scrub-gate: cannot scan ${root}: ${e.message}`);
    process.exit(1);
  }
  if (!result.files.length) {
    console.error(`scrub-gate: no files found under ${root}. Nothing scanned is not a pass.`);
    process.exit(1);
  }
  if (result.findings.length) {
    for (const f of result.findings) console.error(`scrub-gate: ${f.file}:${f.line}: ${f.rule} (${f.match})`);
    console.error(`scrub-gate: ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'} in ${result.files.length} files. Fix the files; nothing is published until this passes.`);
    process.exit(1);
  }
  console.log(`scrub-gate: ${result.files.length} files scanned, ${RULES.length} rules, no findings.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
