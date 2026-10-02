// Property list reading. launchd job files are XML property lists in almost every case, so the
// XML form is parsed here with no dependency and no platform tool, which keeps the parser
// testable on any OS. A binary property list (it starts with "bplist") is converted to XML by
// macOS's own plutil first.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function tokenize(xml) {
  const text = String(xml)
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tokens = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z][A-Za-z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) tokens.push({ t: 'text', v: m[1], raw: true });
    else if (m[6] !== undefined) tokens.push({ t: 'text', v: m[6] });
    else tokens.push({ t: m[2] ? 'close' : m[5] ? 'empty' : 'open', name: m[3] });
  }
  return tokens;
}

/** Parse the text of an XML property list into plain JavaScript values. Throws on malformed input. */
export function parsePlistXml(xml) {
  const tokens = tokenize(xml);
  let i = 0;
  const skipSpace = () => {
    while (i < tokens.length && tokens[i].t === 'text' && !tokens[i].raw && !tokens[i].v.trim()) i++;
  };
  const textUntilClose = (name) => {
    let s = '';
    while (i < tokens.length && !(tokens[i].t === 'close' && tokens[i].name === name)) {
      const tok = tokens[i];
      if (tok.t !== 'text') throw new Error(`plist: unexpected <${tok.name}> inside <${name}>`);
      s += tok.raw ? tok.v : decode(tok.v);
      i++;
    }
    if (i >= tokens.length) throw new Error(`plist: <${name}> is never closed`);
    i++;
    return s;
  };
  const EMPTY = { true: () => true, false: () => false, string: () => '', dict: () => ({}), array: () => [], data: () => Buffer.alloc(0) };
  const value = () => {
    skipSpace();
    const tok = tokens[i++];
    if (!tok) throw new Error('plist: the document ends before a value');
    if (tok.t === 'empty') {
      if (!EMPTY[tok.name]) throw new Error(`plist: <${tok.name}/> is not a value`);
      return EMPTY[tok.name]();
    }
    if (tok.t === 'close') throw new Error(`plist: unexpected </${tok.name}>`);
    if (tok.t === 'text') throw new Error('plist: text outside an element');
    switch (tok.name) {
      case 'plist': {
        const v = value();
        skipSpace();
        const end = tokens[i++];
        if (!end || end.t !== 'close' || end.name !== 'plist') throw new Error('plist: <plist> holds more than one value');
        return v;
      }
      case 'dict': {
        const out = {};
        for (;;) {
          skipSpace();
          const k = tokens[i];
          if (!k) throw new Error('plist: <dict> is never closed');
          if (k.t === 'close' && k.name === 'dict') { i++; return out; }
          if (k.t !== 'open' || k.name !== 'key') throw new Error('plist: every <dict> entry starts with a <key>');
          i++;
          const key = textUntilClose('key');
          out[key] = value();
        }
      }
      case 'array': {
        const out = [];
        for (;;) {
          skipSpace();
          const k = tokens[i];
          if (!k) throw new Error('plist: <array> is never closed');
          if (k.t === 'close' && k.name === 'array') { i++; return out; }
          out.push(value());
        }
      }
      case 'string': return textUntilClose('string');
      case 'integer': {
        const s = textUntilClose('integer').trim();
        if (!/^[-+]?(0x[0-9a-f]+|\d+)$/i.test(s)) throw new Error(`plist: "${s}" is not an integer`);
        return Number(s.replace(/^\+/, ''));
      }
      case 'real': {
        const n = Number(textUntilClose('real').trim());
        if (Number.isNaN(n)) throw new Error('plist: <real> is not a number');
        return n;
      }
      case 'date': return new Date(textUntilClose('date').trim());
      case 'data': return Buffer.from(textUntilClose('data').replace(/\s+/g, ''), 'base64');
      case 'true': textUntilClose('true'); return true;
      case 'false': textUntilClose('false'); return false;
      default: throw new Error(`plist: unknown element <${tok.name}>`);
    }
  };
  const root = value();
  skipSpace();
  if (i < tokens.length) throw new Error('plist: content after the root value');
  return root;
}

/** Read a property list file. Binary lists need macOS plutil; everything else is parsed here. */
export function readPlist(file, { plutil = '/usr/bin/plutil' } = {}) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 6).toString('latin1') === 'bplist') {
    if (process.platform !== 'darwin') throw new Error(`${file} is a binary property list, which needs macOS plutil`);
    const xml = execFileSync(plutil, ['-convert', 'xml1', '-o', '-', file], { encoding: 'utf8', timeout: 5000 });
    return parsePlistXml(xml);
  }
  return parsePlistXml(buf.toString('utf8'));
}
