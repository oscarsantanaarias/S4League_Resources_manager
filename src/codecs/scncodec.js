'use strict';

const SCENE_MAGIC = 0x6278D57A, MODEL_MAGIC = 0x081098F8, BOX_MAGIC = 0x25ADF0D1;
const BONE_MAGIC = 0x6D411AD1, LIGHT_MAGIC = 0xC3E8BE62, BONE_SYSTEM_MAGIC = 0x5E74333F;
const LINE_MAGIC = 0xADEE38A2, SPHERE_MAGIC = 0x4F1C2440, VERSION_2 = 1045220557, PADDING = 1024;

class R {
  constructor(b){ this.b = b; this.n = b.length; this.o = 0; this.bad = false; }
  need(k){ if(this.o + k > this.n){ this.bad = true; return false; } return true; }
  U8(){ if(!this.need(1)) return 0; return this.b[this.o++]; }
  U16(){ if(!this.need(2)) return 0; const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  U32(){ if(!this.need(4)) return 0; const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  F32(){ if(!this.need(4)) return 0; const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  V3(){ return [this.F32(), this.F32(), this.F32()]; }
  Skip(k){ this.o += k; if(this.o > this.n) this.bad = true; }
  Str(){ let s = ''; while(this.o < this.n && this.b[this.o] !== 0) s += String.fromCharCode(this.b[this.o++]); if(this.o < this.n) this.o++; return s; }
  PaddedStr(){ const s0 = this.o; const s = this.Str(); this.o = s0 + PADDING; if(this.o > this.n) this.bad = true; return s; }
  Mat16(){ const off = this.o; const m = new Array(16); for(let i = 0; i < 16; i++) m[i] = this.F32(); return { m, off }; }
}

function readXform(r, want){
  const x = { hasTransform: false };
  if(r.U8()){
    x.hasTransform = true;
    x.initTOff = r.o; x.initT = r.V3();
    x.initROff = r.o; x.initR = [r.F32(), r.F32(), r.F32(), r.F32()];
    x.initSOff = r.o; x.initS = r.V3();
    x.rot = []; x.trans = []; x.scale = [];
    let k = r.U32(); for(let j = 0; j < k && !r.bad; j++){ const tOff = r.o; const t = r.U32(); const off = r.o; x.trans.push({ t, tOff, off, v: r.V3() }); }
    k = r.U32();     for(let j = 0; j < k && !r.bad; j++){ const tOff = r.o; const t = r.U32(); const off = r.o; x.rot.push({ t, tOff, off, q: [r.F32(), r.F32(), r.F32(), r.F32()] }); }
    k = r.U32();     for(let j = 0; j < k && !r.bad; j++){ const tOff = r.o; const t = r.U32(); const off = r.o; x.scale.push({ t, tOff, off, v: r.V3() }); }
  }
  return x;
}
function skipVis(r){ const c = r.U32(); for(let k = 0; k < c && !r.bad; k++) r.Skip(8); }

function readBoneAnims(r, versionFlag){
  const anims = []; const c = r.U32();
  for(let i = 0; i < c && !r.bad; i++){
    const name = r.Str();
    if(versionFlag){ const copy = r.Str(); if(copy){ anims.push({ name, copy, hasTransform: false }); continue; } }
    const durationOff = r.o;
    const a = { name, durationOff, duration: r.U32() };
    Object.assign(a, readXform(r));
    skipVis(r);
    anims.push(a);
  }
  return anims;
}
function readModelAnims(r){
  const anims = []; const c = r.U32();
  for(let i = 0; i < c && !r.bad; i++){
    const nm = r.Str(); const durationOff = r.o;
    const a = { name: nm, durationOff, duration: r.U32() };
    Object.assign(a, readXform(r));
    skipVis(r);
    a.morph = [];
    const mc = r.U32();
    for(let j = 0; j < mc && !r.bad; j++){
      const key = { tick: r.U32(), verts: [] };
      const vc = r.U32();
      for(let v = 0; v < vc && !r.bad; v++){ const index = r.U32(); const off = r.o; key.verts.push({ index, off, pos: r.V3() }); }
      const uc = r.U32(); for(let v = 0; v < uc && !r.bad; v++) r.Skip(12);
      a.morph.push(key);
    }
    anims.push(a);
  }
  return anims;
}

function readBase(r){
  const name = r.Str(); const parent = r.Str();
  r.U32();
  const { m, off } = r.Mat16();
  const mend = r.U32();
  return { name, parent, matrix: m, matrixOff: off, mend };
}

function parseModel(r, base){
  r.U32();
  const texVersion = r.U32();
  let extraUv = 0; if(texVersion >= VERSION_2) extraUv = r.U32();
  const itemCount = r.U32(); let texture = '';
  for(let i = 0; i < itemCount && !r.bad; i++){
    const main = r.PaddedStr(); if(texVersion >= VERSION_2) r.PaddedStr(); r.U32(); r.U32();
    if(i === 0) texture = main;
  }
  const vc = r.U32(); const positions = vc * 3; for(let i = 0; i < positions && !r.bad; i++) r.F32();
  const fc = r.U32(); for(let i = 0; i < fc * 3 && !r.bad; i++) r.U16();
  const nc = r.U32(); for(let i = 0; i < nc && !r.bad; i++) r.Skip(12);
  const uc = r.U32(); for(let i = 0; i < uc * 2 && !r.bad; i++) r.F32();
  if(extraUv === 1){ for(let i = 0; i < uc * 2 && !r.bad; i++) r.F32(); }
  const tc = r.U32(); for(let i = 0; i < tc && !r.bad; i++) r.Skip(12);
  const wb = r.U32(); const skinBones = [];
  for(let i = 0; i < wb && !r.bad; i++){ skinBones.push(r.Str()); r.Mat16(); const wc = r.U32(); for(let k = 0; k < wc && !r.bad; k++){ r.U32(); r.F32(); } }
  const anims = readModelAnims(r);
  return { name: base.name, parent: base.parent, matrix: base.matrix, matrixOff: base.matrixOff, verts: vc, tris: fc, skinBones, texture, anims };
}

function parse(buf){
  const r = new R(buf);
  r.U32();
  let v = r.U32(), guard = 0;
  while(v !== SCENE_MAGIC && !r.bad && guard++ < 64) v = r.U32();
  if(v !== SCENE_MAGIC) throw new Error('no SCENE magic (.scn not decrypted?)');
  r.Str(); r.Str(); r.U32(); r.Skip(16 * 4);
  const matrixEnd = r.U32(); const chunkCount = r.U32();
  if(matrixEnd >= VERSION_2) r.Str();
  const models = [], bones = [];
  for(let i = 0; i < chunkCount && !r.bad; i++){
    const type = r.U32(); const base = readBase(r);
    if(type === MODEL_MAGIC) models.push(parseModel(r, base));
    else if(type === BONE_MAGIC) bones.push({ name: base.name, parent: base.parent, matrix: base.matrix, matrixOff: base.matrixOff, anims: readBoneAnims(r, base.mend >= VERSION_2) });
    else if(type === BONE_SYSTEM_MAGIC){ }
    else if(type === BOX_MAGIC) r.Skip(4*4 + 9*4 + 3*4);
    else if(type === LIGHT_MAGIC) r.Skip(2*4 + 7*3*4);
    else if(type === LINE_MAGIC){ const c = r.U32(); r.Skip(c * 2 * 3 * 4); }
    // CSphereNode: ver + center + radius. Sin esta rama el loop cortaba acá y se comía
    // EN SILENCIO el resto de los chunks (p.ej. model/character/leg/120_female_leg.scn
    // perdia su unico modelo). El round-trip seguia dando byte-identico igual, porque
    // solo reescribe lo que parseo: no alcanza para detectarlo.
    else if(type === SPHERE_MAGIC) r.Skip(4 + 3*4 + 4);
    else break;
  }
  const clipList = [];
  for(const b of bones) for(const a of b.anims) if(a.hasTransform && !clipList.includes(a.name)) clipList.push(a.name);
  return { models, bones, clipList };
}

const r4 = a => a.map(n => Math.round(n * 1e4) / 1e4);

function scnToJson(buf, clip){
  const s = parse(buf);
  const out = {
    _codec: 'scn-lossless-1', _note: 'edit matrix/pose/morph.pos and reimport against the SAME .scn',
    bones: s.bones.map(b => ({ name: b.name, parent: b.parent, matrix: r4(b.matrix), clips: b.anims.filter(a => a.hasTransform).map(a => a.name) })),
    models: s.models.map(m => {
      const o = { name: m.name, parent: m.parent, matrix: r4(m.matrix), verts: m.verts, tris: m.tris, skinBones: m.skinBones, texture: m.texture };
      const morphAnims = (m.anims || []).filter(a => a.morph && a.morph.length);
      if(morphAnims.length){
        o.morph = morphAnims.map(a => ({
          anim: a.name, duration: a.duration,
          keys: a.morph.map(k => ({ tick: k.tick, verts: k.verts.map(vt => ({ index: vt.index, pos: r4(vt.pos) })) })),
        }));
      }
      return o;
    }),
    clipList: s.clipList,
  };
  if(clip){
    out.clip = clip; out.pose = {};
    for(const b of s.bones){
      const a = b.anims.find(x => x.name === clip && x.hasTransform);
      if(!a) continue;
      out.pose[b.name] = {
        initT: r4(a.initT), initR: r4(a.initR), initS: r4(a.initS), duration: a.duration,
        rot: a.rot.map(k => ({ t: k.t, q: r4(k.q) })), trans: a.trans.map(k => ({ t: k.t, v: r4(k.v) })), scale: a.scale.map(k => ({ t: k.t, v: r4(k.v) })),
      };
    }
  }
  return out;
}

function wF(buf, off, arr){ for(let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i], off + i * 4); }
// Only rewrite the components that actually differ. scnToJson rounds to 4
// decimals, so writing a whole array back would quietly degrade every value the
// user did not touch.
function wFDiff(buf, off, orig, jarr){
  const o = r4(orig);
  let n = 0;
  for(let i = 0; i < jarr.length && i < o.length; i++){
    if(o[i] === jarr[i]) continue;
    buf.writeFloatLE(jarr[i], off + i * 4); n++;
  }
  return n;
}
// Key times and clip length are whole ticks, not floats, so they need their own
// writer - everything else in here is a float and wFDiff cannot touch them.
function wU32(buf, off, orig, val){
  const v = Math.max(0, Math.round(val));
  if(off == null || v === orig) return 0;
  buf.writeUInt32LE(v, off);
  return 1;
}
function changed(orig, jarr){ if(!jarr || jarr.length !== orig.length) return false; const o = r4(orig); for(let i = 0; i < o.length; i++) if(o[i] !== jarr[i]) return true; return false; }

// Play a clip slower or faster by moving its keys, which is the only way the
// game will ever see the change - the viewer's speed slider is preview only.
// factor 2 halves the times, 0.5 doubles them. Keys cannot be added or removed,
// so speeding up can land two on the same tick; they are nudged apart instead
// of silently collapsing into one.
function scaleClipTime(json, factor){
  if(!(factor > 0)) return { ok: false, error: 'speed has to be above zero' };
  let keys = 0, nudged = 0, end = 0;
  for(const p of Object.values(json.pose || {})){
    for(const which of ['rot', 'trans', 'scale']){
      const list = p[which];
      if(!list) continue;
      let prev = -1;
      for(const k of list){
        let t = Math.round(k.t / factor);
        if(t <= prev){ t = prev + 1; nudged++; }
        k.t = prev = t; keys++;
        if(t > end) end = t;
      }
    }
  }
  for(const p of Object.values(json.pose || {})){
    if(p.duration != null) p.duration = Math.max(end, Math.round(p.duration / factor));
  }
  return { ok: true, keys, nudged, duration: end };
}

function applyJson(origBuf, json){
  const s = parse(origBuf);
  const buf = Buffer.from(origBuf);
  let patched = 0;
  const byName = new Map(); for(const b of s.bones) byName.set('b:' + b.name, b); for(const m of s.models) byName.set('m:' + m.name, m);
  const jm = new Map(); for(const b of (json.bones || [])) jm.set('b:' + b.name, b); for(const m of (json.models || [])) jm.set('m:' + m.name, m);
  for(const [k, node] of byName){
    const je = jm.get(k); if(!je || !changed(node.matrix, je.matrix)) continue;
    patched += wFDiff(buf, node.matrixOff, node.matrix, je.matrix);
  }
  if(json.clip && json.pose){
    for(const b of s.bones){
      const a = b.anims.find(x => x.name === json.clip && x.hasTransform); const p = json.pose[b.name];
      if(!a || !p) continue;
      if(changed(a.initT, p.initT)) patched += wFDiff(buf, a.initTOff, a.initT, p.initT);
      if(changed(a.initR, p.initR)) patched += wFDiff(buf, a.initROff, a.initR, p.initR);
      if(changed(a.initS, p.initS)) patched += wFDiff(buf, a.initSOff, a.initS, p.initS);
      if(p.rot)   for(let i = 0; i < p.rot.length && i < a.rot.length; i++) if(changed(a.rot[i].q, p.rot[i].q)) patched += wFDiff(buf, a.rot[i].off, a.rot[i].q, p.rot[i].q);
      if(p.trans) for(let i = 0; i < p.trans.length && i < a.trans.length; i++) if(changed(a.trans[i].v, p.trans[i].v)) patched += wFDiff(buf, a.trans[i].off, a.trans[i].v, p.trans[i].v);
      if(p.scale) for(let i = 0; i < p.scale.length && i < a.scale.length; i++) if(changed(a.scale[i].v, p.scale[i].v)) patched += wFDiff(buf, a.scale[i].off, a.scale[i].v, p.scale[i].v);
      // and the timing, which is what makes a clip play slower or faster
      if(p.duration != null) patched += wU32(buf, a.durationOff, a.duration, p.duration);
      for(const which of ['rot', 'trans', 'scale']){
        if(!p[which]) continue;
        for(let i = 0; i < p[which].length && i < a[which].length; i++){
          if(p[which][i].t == null) continue;
          patched += wU32(buf, a[which][i].tOff, a[which][i].t, p[which][i].t);
        }
      }
    }
  }
  (json.models || []).forEach((jm2, mi) => {
    if(!jm2.morph) return;
    const model = s.models[mi];
    if(!model) return;
    const morphAnims = (model.anims || []).filter(a => a.morph && a.morph.length);
    jm2.morph.forEach((ja, ai) => {
      const a = morphAnims[ai]; if(!a) return;
      (ja.keys || []).forEach((jk, ki) => {
        const key = a.morph[ki]; if(!key) return;
        (jk.verts || []).forEach((jv, vi) => {
          const vt = key.verts[vi]; if(!vt) return;
          if(changed(vt.pos, jv.pos)) patched += wFDiff(buf, vt.off, vt.pos, jv.pos);
        });
      });
    });
  });
  return { buf, patched };
}

module.exports = { scaleClipTime, parse, scnToJson, applyJson };

if(require.main === module){
  const fs = require('fs'), file = process.argv[2];
  if(!file){ console.log('usage: node scncodec.js <file.scn> [CLIP]'); process.exit(0); }
  const orig = fs.readFileSync(file);
  const json = scnToJson(orig, process.argv[3]);
  const { buf, patched } = applyJson(orig, json);
  const same = buf.equals(orig);
  console.log('bones', json.bones.length, '| models', json.models.length, '| clips', json.clipList.length, '| patched', patched);
  console.log('round-trip byte-identical:', same ? 'OK' : 'FAIL');
  if(!same){ for(let i = 0; i < orig.length; i++) if(orig[i] !== buf[i]){ console.log('first differing byte @', i); break; } }
}
