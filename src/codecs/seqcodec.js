'use strict';

function findRecords(buf){
  let text = '';
  for(let i = 0; i < buf.length; i++) text += String.fromCharCode(buf[i]);
  const re = /CAct[A-Za-z0-9_]+/g;
  const out = [];
  let m;
  while((m = re.exec(text)) !== null){
    const end = m.index + m[0].length;
    if(end < buf.length && buf[end] === 0) out.push({ offset: m.index, className: m[0] });
  }
  return out;
}

class Rec {
  constructor(buf, base){ this.buf = buf; this.base = base; this.p = 0; this.fields = []; this.bad = false; }
  get abs(){ return this.base + this.p; }
  get left(){ return this.buf.length - this.abs; }
  _push(name, type, off, value){ if(name) this.fields.push({ name, off, type, value }); }
  u8(name){ const off = this.abs; const v = this.buf.readUInt8(off); this.p += 1; this._push(name, 'u8', off, v); return v; }
  bool(name){ const off = this.abs; const v = this.buf.readUInt8(off) ? 1 : 0; this.p += 1; this._push(name, 'u8', off, v); return v; }
  u32(name){ const off = this.abs; const v = this.buf.readUInt32LE(off); this.p += 4; this._push(name, 'u32', off, v); return v; }
  i32(name){ const off = this.abs; const v = this.buf.readInt32LE(off); this.p += 4; this._push(name, 'i32', off, v); return v; }
  f32(name){ const off = this.abs; const v = this.buf.readFloatLE(off); this.p += 4; this._push(name, 'f32', off, v); return v; }
  peekF32(){ return this.left >= 4 ? this.buf.readFloatLE(this.abs) : NaN; }
  vec3(prefix){ return { x: this.f32(prefix && prefix + '.x'), y: this.f32(prefix && prefix + '.y'), z: this.f32(prefix && prefix + '.z') }; }
  str(){
    const start = this.abs; let p = start;
    while(p < this.buf.length && this.buf[p] !== 0) p++;
    const s = this.buf.toString('latin1', start, p);
    this.p = (p + 1) - this.base;
    return s;
  }
}

function parseNode(className, buf, bodyStart, bodyEnd){
  const r = new Rec(buf, bodyStart);
  const node = { className, bodyStart, bodyEnd, ok: false, emitters: [], keys: [], textures: [], strings: {} };
  try {
    r.f32();
    r.u32(); r.u32();
    node.nodeName = r.str();

    if(className === 'CActNodeLoader' || className === 'CActNodeLoader_IF'){
      r.u32();
      node.fields = r.fields;
      node.strings.nodeDuration = null;
      const dOff = r.abs; node.nodeDuration = r.u32('nodeDuration'); node.nodeDurationOff = dOff;
      node.k = r.f32('k');
      node.ok = true;
      node.fields = r.fields;
      return node;
    }

    if(className === 'CActParticle' || className === 'CActParticle_IF'){
      readParticle(r, node);
    }
  } catch(e){
    node.parseError = e.message;
  }
  node.fields = r.fields;
  return node;
}

function readParticle(r, node){
  r.u32('beginTime'); r.u32('endTime');
  r.f32();
  r.f32('structureMod1');
  r.u32('renderType'); r.u32('textureAnimType'); r.u32('blendType'); r.u32('lifetimeVar');
  r.f32('emitterSpeedVar'); r.f32('sizeVarX'); r.f32('sizeVarY');
  r.f32('colorVarC'); r.f32('colorVarM'); r.f32('colorVarY'); r.f32('colorVarA');
  r.f32('rotateVar');
  r.bool('attachTarget');
  r.u32('maxParticles');
  r.u8('scaleFlags');
  r.u32('textureAnimDelay');
  r.bool('fogState');
  r.u32('cullRadius');
  r.f32('sizeVar');
  r.bool('sizeLock'); r.bool('colorLock'); r.bool('alphaLock'); r.bool('rotateLock');
  r.u8('minimumTimeDelta');
  r.u8('u2'); r.u8('u3'); r.u8('u4');

  const atMarker = () => Math.abs(r.peekF32() - 0.1) < 1e-6;
  if(!atMarker()) r.bool('glow');
  if(!atMarker()) r.bool('haze');

  r.f32();

  r.u32('emitterTime'); r.bool('keyLerp');
  const nEmit = r.u32();
  for(let k = 0; k < nEmit; k++){
    const e = k;
    r.u32(`emitters.${e}.frame`); r.bool(`emitters.${e}.continuance`);
    r.vec3(`emitters.${e}.origin`); r.vec3(`emitters.${e}.coneDir`);
    r.f32(`emitters.${e}.coneTheta`); r.f32(`emitters.${e}.speed`);
    r.u32(`emitters.${e}.emitterType`);
    r.f32(`emitters.${e}.minWidth`); r.f32(`emitters.${e}.maxWidth`);
    r.f32(`emitters.${e}.minHeight`); r.f32(`emitters.${e}.maxHeight`);
    r.vec3(`emitters.${e}.gravity`); r.f32(`emitters.${e}.attractive`);
    r.u32(`emitters.${e}.lifetime`); r.u32(`emitters.${e}.perSecond`);
    r.u32(`emitters.${e}.textureKey`);
    node.emitters.push(e);
  }
  r.f32();

  const nKey = r.u32();
  for(let k = 0; k < nKey; k++){
    r.f32(`keys.${k}.frame`);
    r.f32(`keys.${k}.sizeX`); r.f32(`keys.${k}.sizeY`);
    r.f32(`keys.${k}.r`); r.f32(`keys.${k}.g`); r.f32(`keys.${k}.b`); r.f32(`keys.${k}.a`);
    r.f32(`keys.${k}.rotate`);
    node.keys.push(k);
  }
  r.f32();

  const nTex = r.u32();
  for(let t = 0; t < nTex; t++){
    const path = r.str();
    const uv = [];
    for(let i = 0; i < 8; i++) uv.push(r.f32(`textures.${t}.uv.${i}`));
    node.textures.push({ path, uv });
  }
  node.ok = r.left === 0;
  node.bytesLeft = r.left;
}

function parse(buf){
  const r = new Rec(buf, 0);
  r.f32();
  const name = r.str();
  const flagOff = r.abs; const flag = r.u8();
  const durationOff = r.abs; const duration = r.u32();
  const nodeCount = r.u32();

  const recs = findRecords(buf);
  const nodes = [];
  for(let i = 0; i < recs.length; i++){
    const bodyStart = recs[i].offset + recs[i].className.length + 1;
    const bodyEnd = i + 1 < recs.length ? recs[i + 1].offset : buf.length;
    nodes.push(parseNode(recs[i].className, buf, bodyStart, bodyEnd));
  }
  return { name, flag, flagOff, duration, durationOff, nodeCount, nodes };
}

function seqToJson(buf){
  const s = parse(buf);
  return {
    _codec: 'seq-lossless-1',
    _note: 'edit duration/flag and each node\'s fields; reimport against the SAME .seq (decrypted). "count" values/markers and paths are not editable (length-locked).',
    duration: s.duration,
    flag: s.flag,
    nodeCount: s.nodeCount,
    nodes: s.nodes.map((n, i) => ({
      i,
      className: n.className,
      nodeName: n.nodeName,
      ok: n.ok,
      ...(n.className.startsWith('CActNodeLoader') ? { nodeDuration: n.nodeDuration, k: fieldVal(n, 'k') } : {}),
      fields: Object.fromEntries(n.fields.map(f => [f.name, f.value])),
      textures: n.textures.map(t => ({ path: t.path, uv: t.uv })),
    })),
  };
}

function fieldVal(n, name){ const f = n.fields.find(x => x.name === name); return f ? f.value : undefined; }

function writeField(buf, f, value){
  if(value === undefined || value === null || Number(value) === f.value) return false;
  const v = Number(value);
  if(f.type === 'u8') buf.writeUInt8(v & 0xff, f.off);
  else if(f.type === 'u32') buf.writeUInt32LE(v >>> 0, f.off);
  else if(f.type === 'i32') buf.writeInt32LE(v | 0, f.off);
  else buf.writeFloatLE(v, f.off);
  return true;
}

function applyJson(origBuf, json){
  const s = parse(origBuf);
  const buf = Buffer.from(origBuf);
  let patched = 0;

  if(json.duration !== undefined && Number(json.duration) !== s.duration){ buf.writeUInt32LE(Number(json.duration) >>> 0, s.durationOff); patched++; }
  if(json.flag !== undefined && Number(json.flag) !== s.flag){ buf.writeUInt8(Number(json.flag) & 0xff, s.flagOff); patched++; }

  for(const jn of (json.nodes || [])){
    const n = s.nodes[jn.i];
    if(!n) continue;
    const byName = new Map(n.fields.map(f => [f.name, f]));
    const jf = jn.fields || {};
    if(jn.nodeDuration !== undefined && byName.has('nodeDuration') && writeField(buf, byName.get('nodeDuration'), jn.nodeDuration)) patched++;
    for(const [name, val] of Object.entries(jf)){
      const f = byName.get(name);
      if(f && writeField(buf, f, val)) patched++;
    }
  }
  return { buf, patched };
}

module.exports = { parse, seqToJson, applyJson };
