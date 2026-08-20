'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const seqcodec = require('../src/codecs/seqcodec');

const PUBLIC = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, '..', 'node_modules', 'three');

const PREF = ['dds', 'png', 'tga', 'jpg', 'jpeg', 'gif', 'bmp'];

function buildIndex(root){
  const byName = new Map();
  const byBase = new Map();
  const walk = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }
    for(const e of entries){
      const p = path.join(dir, e.name);
      if(e.isDirectory()){ walk(p); continue; }
      const low = e.name.toLowerCase();
      if(!byName.has(low)) byName.set(low, p);
      const base = low.replace(/\.[^.]+$/, '');
      if(!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(p);
    }
  };
  walk(root);
  return { root, byName, byBase };
}

function resolveFile(idx, name){
  const low = path.basename(String(name)).toLowerCase();
  const exact = idx.byName.get(low);
  if(exact) return { path: exact, swapped: false };
  const alts = idx.byBase.get(low.replace(/\.[^.]+$/, ''));
  if(!alts || !alts.length) return null;
  const score = p => { const i = PREF.indexOf(path.extname(p).slice(1).toLowerCase()); return i < 0 ? PREF.length : i; };
  return { path: [...alts].sort((a, b) => score(a) - score(b))[0], swapped: true };
}

const TEX_RE = /\.(dds|tga|bmp|png|jpg|jpeg)$/i;

function asciiStrings(buf, min = 4){
  const out = [];
  let i = 0;
  while(i < buf.length){
    if(buf[i] >= 0x20 && buf[i] <= 0x7e){
      let j = i;
      while(j < buf.length && buf[j] >= 0x20 && buf[j] <= 0x7e) j++;
      if(j - i >= min) out.push({ text: buf.toString('ascii', i, j), offset: i });
      i = j;
    } else i++;
  }
  return out;
}

function seqTextures(buf){
  const seen = new Map();
  for(const s of asciiStrings(buf)){
    const file = s.text.split(/[\\/]/).pop();
    if(TEX_RE.test(file) && !seen.has(s.text)) seen.set(s.text, { text: s.text, file, maxLen: Buffer.byteLength(s.text, 'ascii') });
  }
  return [...seen.values()];
}

function patchSeqStr(buffer, oldText, newText){
  const oldBytes = Buffer.from(String(oldText), 'ascii');
  const nt = String(newText).trim();
  if(!/^[\x20-\x7e]+$/.test(nt)) throw new Error('nombre no-ASCII');
  const newBytes = Buffer.from(nt, 'ascii');
  if(newBytes.length > oldBytes.length) throw new Error(`muy largo: máx ${oldBytes.length}, dado ${newBytes.length}`);
  const out = Buffer.from(buffer);
  let changed = 0, from = 0;
  while(true){
    const at = out.indexOf(oldBytes, from);
    if(at < 0) break;
    from = at + 1;
    const prev = at > 0 ? out[at - 1] : 0;
    const after = at + oldBytes.length < out.length ? out[at + oldBytes.length] : 0;
    if((prev >= 0x20 && prev <= 0x7e) || (after >= 0x20 && after <= 0x7e)) continue;
    newBytes.copy(out, at);
    out.fill(0, at + newBytes.length, at + oldBytes.length);
    changed++;
  }
  if(changed === 0) throw new Error('string no encontrado');
  return { buffer: out, changed };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};

function sendFile(res, filePath){
  if(!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()){ res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

function json(res, obj){
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function startSeqServer(root, opts = {}){
  const idx = buildIndex(root);
  let fbIdx = null, fbTried = false;
  const ensureFb = () => {
    if(!fbTried){ fbTried = true; if(opts.fallbackRoot && fs.existsSync(opts.fallbackRoot)) fbIdx = buildIndex(opts.fallbackRoot); }
    return fbIdx;
  };
  const resolveAny = name => resolveFile(idx, name) || (ensureFb() ? resolveFile(fbIdx, name) : null);

  const listOf = ext => [...idx.byName.entries()]
    .filter(([n]) => n.endsWith(ext))
    .map(([n, p]) => ({ name: n, size: fs.statSync(p).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const seqFiles = listOf('.seq');
  const scnFiles = listOf('.scn');

  const server = http.createServer((req, res) => {
    let p = '/';
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch(e) {}

    if(p === '/api/sequences') return json(res, { ok: true, dir: root, count: seqFiles.length, files: seqFiles });
    if(p === '/api/scenes') return json(res, { ok: true, dir: root, count: scnFiles.length, files: scnFiles });

    if(p.startsWith('/api/character/')) return json(res, { ok: false, parts: [] });
    if(p === '/api/weapons') return json(res, { ok: true, count: 0, files: [] });
    if(p === '/api/items') return json(res, { ok: true, count: 0, bySlot: {} });
    if(p === '/api/animset' || p === '/api/animstates') return json(res, { ok: false });

    if(p === '/api/have' && req.method === 'POST'){
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let names = [];
        try { names = JSON.parse(body || '{}').files || []; } catch(e) {}
        const have = {};
        for(const n of names){
          const hit = resolveAny(n);
          have[path.basename(n)] = hit ? { ok: true, as: path.basename(hit.path), swapped: hit.swapped } : { ok: false };
        }
        json(res, { ok: true, have });
      });
      return;
    }

    if(p === '/api/seqjson'){
      const file = new URL(req.url, 'http://x').searchParams.get('file') || '';
      const hit = resolveFile(idx, file);
      if(!hit) return json(res, { ok: false, error: 'no existe: ' + file });
      try { return json(res, { ok: true, seq: seqcodec.seqToJson(fs.readFileSync(hit.path)) }); }
      catch(e){ return json(res, { ok: false, error: e.message }); }
    }
    if(p === '/api/seqsave' && req.method === 'POST'){
      const file = new URL(req.url, 'http://x').searchParams.get('file') || '';
      const hit = resolveFile(idx, file);
      if(!hit) return json(res, { ok: false, error: 'no existe: ' + file });
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const j = JSON.parse(body || '{}');
          const { buf, patched } = seqcodec.applyJson(fs.readFileSync(hit.path), j);
          fs.writeFileSync(hit.path, buf);
          json(res, { ok: true, patched });
        } catch(e){ json(res, { ok: false, error: e.message }); }
      });
      return;
    }

    if(p === '/api/seqtextures'){
      const file = new URL(req.url, 'http://x').searchParams.get('file') || '';
      const hit = resolveFile(idx, file);
      if(!hit) return json(res, { ok: false, error: 'no existe: ' + file });
      try { return json(res, { ok: true, textures: seqTextures(fs.readFileSync(hit.path)) }); }
      catch(e){ return json(res, { ok: false, error: e.message }); }
    }
    if(p === '/api/seqtexlist'){
      const set = new Set();
      for(const [n] of idx.byName) if(TEX_RE.test(n)) set.add(n);
      if(ensureFb()) for(const [n] of fbIdx.byName) if(TEX_RE.test(n)) set.add(n);
      return json(res, { ok: true, files: [...set].sort().slice(0, 8000) });
    }
    if(p === '/api/seqtexpatch' && req.method === 'POST'){
      const file = new URL(req.url, 'http://x').searchParams.get('file') || '';
      const hit = resolveFile(idx, file);
      if(!hit) return json(res, { ok: false, error: 'no existe: ' + file });
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const j = JSON.parse(body || '{}');
          const { buffer, changed } = patchSeqStr(fs.readFileSync(hit.path), j.old, j.new);
          fs.writeFileSync(hit.path, buffer);
          json(res, { ok: true, changed });
        } catch(e){ json(res, { ok: false, error: e.message }); }
      });
      return;
    }

    if(p.startsWith('/res/')){
      const hit = resolveAny(p.slice(5));
      if(!hit){ res.statusCode = 404; return json(res, { ok: false, error: 'no existe: ' + p.slice(5) }); }
      if(hit.swapped) res.setHeader('X-Resolved-As', path.basename(hit.path));
      return sendFile(res, hit.path);
    }

    if(p.startsWith('/vendor/three/')){
      const rel = p.slice('/vendor/three/'.length);
      const fp = path.normalize(path.join(THREE_DIR, rel));
      if(!fp.startsWith(THREE_DIR)){ res.statusCode = 403; return res.end('no'); }
      return sendFile(res, fp);
    }

    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const fp = path.normalize(path.join(PUBLIC, rel));
    if(!fp.startsWith(PUBLIC)){ res.statusCode = 403; return res.end('no'); }
    return sendFile(res, fp);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => { try { server.close(); } catch(e) {} } }));
  });
}

module.exports = { startSeqServer };
