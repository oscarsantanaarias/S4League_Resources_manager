'use strict';

const SCENE_MAGIC = 0x6278D57A;
const MODEL_MAGIC = 0x081098F8;
const BOX_MAGIC = 0x25ADF0D1;
const BONE_MAGIC = 0x6D411AD1;
const LIGHT_MAGIC = 0xC3E8BE62;
const BONE_SYSTEM_MAGIC = 0x5E74333F;
const LINE_MAGIC = 0xADEE38A2;
const VERSION_2 = 1045220557;
const PADDING = 1024;

class Reader {
  constructor(buf){ this.b = buf; this.n = buf.length; this.o = 0; this.bad = false; }
  need(k){ if(this.o + k > this.n){ this.bad = true; return false; } return true; }
  U8(){ if(!this.need(1)) return 0; return this.b[this.o++]; }
  U16(){ if(!this.need(2)) return 0; const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  U32(){ if(!this.need(4)) return 0; const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  F32(){ if(!this.need(4)) return 0; const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  V3(){ return [this.F32(), this.F32(), this.F32()]; }
  Skip(k){ this.o += k; if(this.o > this.n) this.bad = true; }
  Str(){ let s = ''; while(this.o < this.n && this.b[this.o] !== 0){ s += String.fromCharCode(this.b[this.o++]); } if(this.o < this.n) this.o++; return s; }
  PaddedStr(){ const s0 = this.o; const s = this.Str(); this.o = s0 + PADDING; if(this.o > this.n) this.bad = true; return s; }
  Mat16(){ const m = new Array(16); for(let i = 0; i < 16; i++) m[i] = this.F32(); return m; }
}

function readTransformKeys(r){
  const trans = [], rot = [], scale = [];
  let k = r.U32(); for(let j = 0; j < k && !r.bad; j++){ trans.push({ t: r.U32(), v: r.V3() }); }
  k = r.U32();     for(let j = 0; j < k && !r.bad; j++){ rot.push({ t: r.U32(), q: [r.F32(), r.F32(), r.F32(), r.F32()] }); }
  k = r.U32();     for(let j = 0; j < k && !r.bad; j++){ scale.push({ t: r.U32(), v: r.V3() }); }
  return { trans, rot, scale };
}

function readModelAnims(r){
  const anims = [];
  const c = r.U32();
  for(let i = 0; i < c && !r.bad; i++){
    const a = { name: r.Str(), duration: r.U32(), hasTransform: false, initT: [0,0,0], initR: [0,0,0,1], initS: [1,1,1], trans: [], rot: [], scale: [], morph: [] };
    if(r.U8()){
      a.hasTransform = true;
      a.initT = r.V3();
      a.initR = [r.F32(), r.F32(), r.F32(), r.F32()];
      a.initS = r.V3();
      const k = readTransformKeys(r); a.trans = k.trans; a.rot = k.rot; a.scale = k.scale;
    }
    skipVis(r);
    const mc = r.U32();
    for(let j = 0; j < mc && !r.bad; j++){
      const key = { tick: r.U32(), verts: [] };
      const vc = r.U32();
      for(let v = 0; v < vc && !r.bad; v++){ key.verts.push({ index: r.U32(), pos: r.V3() }); }
      const uc = r.U32(); for(let v = 0; v < uc && !r.bad; v++) r.Skip(12);
      a.morph.push(key);
    }
    anims.push(a);
  }
  return anims;
}

function readBoneAnims(r, versionFlag){
  const anims = [];
  const c = r.U32();
  for(let i = 0; i < c && !r.bad; i++){
    const name = r.Str();
    if(versionFlag){ const copy = r.Str(); if(copy){ continue; } }
    const a = { name, duration: r.U32(), hasTransform: false, initT: [0,0,0], initR: [0,0,0,1], initS: [1,1,1], trans: [], rot: [], scale: [] };
    if(r.U8()){
      a.hasTransform = true;
      a.initT = r.V3();
      a.initR = [r.F32(), r.F32(), r.F32(), r.F32()];
      a.initS = r.V3();
      const k = readTransformKeys(r); a.trans = k.trans; a.rot = k.rot; a.scale = k.scale;
    }
    skipVis(r);
    anims.push(a);
  }
  return anims;
}

function skipVis(r){ const c = r.U32(); for(let k = 0; k < c && !r.bad; k++) r.Skip(8); }

function readBase(r){
  const name = r.Str();
  const parent = r.Str();
  r.U32();
  const matrix = r.Mat16();
  const mend = r.U32();
  return { name, parent, matrix, mend };
}

function parseModel(r, base){
  const renderFlag = r.U32();
  const texVersion = r.U32();
  let extraUv = 0;
  if(texVersion >= VERSION_2) extraUv = r.U32();
  const itemCount = r.U32();
  let texture = '', sideTexture = '';
  const texItems = [];
  for(let i = 0; i < itemCount && !r.bad; i++){
    const main = r.PaddedStr();
    let side = '';
    if(texVersion >= VERSION_2) side = r.PaddedStr();
    const faceStart = r.U32(), faceCount = r.U32();
    texItems.push({ name: main, side, faceStart, faceCount });
    if(i === 0){ texture = main; sideTexture = side; }
  }

  const vc = r.U32();
  const positions = new Array(vc * 3);
  for(let i = 0; i < vc && !r.bad; i++){ positions[i*3] = r.F32(); positions[i*3+1] = r.F32(); positions[i*3+2] = r.F32(); }

  const fc = r.U32();
  const indices = new Array(fc * 3);
  for(let i = 0; i < fc && !r.bad; i++){ indices[i*3] = r.U16(); indices[i*3+1] = r.U16(); indices[i*3+2] = r.U16(); }

  const nc = r.U32(); for(let i = 0; i < nc && !r.bad; i++) r.Skip(12);

  const uc = r.U32();
  const uvs = new Array(uc * 2);
  for(let i = 0; i < uc && !r.bad; i++){ uvs[i*2] = r.F32(); uvs[i*2+1] = r.F32(); }
  let uv2 = [];
  if(extraUv === 1){ uv2 = new Array(uc * 2); for(let i = 0; i < uc && !r.bad; i++){ uv2[i*2] = r.F32(); uv2[i*2+1] = r.F32(); } }

  const tc = r.U32(); for(let i = 0; i < tc && !r.bad; i++) r.Skip(12);

  const wb = r.U32();
  const skin = [];
  for(let i = 0; i < wb && !r.bad; i++){
    const bone = { name: r.Str(), bind: r.Mat16(), weights: [] };
    const wc = r.U32();
    for(let k = 0; k < wc && !r.bad; k++){ bone.weights.push({ vertex: r.U32(), weight: r.F32() }); }
    skin.push(bone);
  }

  const anims = readModelAnims(r);

  return { name: base.name, parent: base.parent, matrix: base.matrix, renderFlag, texture, sideTexture, texItems, positions, indices, uvs, uv2, skin, anims };
}

function parseScn(buffer){
  const r = new Reader(buffer);
  const version = r.U32();
  let v = r.U32(); let guard = 0;
  while(v !== SCENE_MAGIC && !r.bad && guard++ < 64) v = r.U32();
  if(v !== SCENE_MAGIC) throw new Error('no SCENE magic (file is not a decoded .scn?)');

  r.Str(); r.Str(); r.U32(); r.Skip(16 * 4);
  const matrixEnd = r.U32();
  const chunkCount = r.U32();
  if(matrixEnd >= VERSION_2) r.Str();

  const models = [];
  const bones = [];
  for(let i = 0; i < chunkCount && !r.bad; i++){
    const type = r.U32();
    const base = readBase(r);
    if(type === MODEL_MAGIC){
      models.push(parseModel(r, base));
    } else if(type === BONE_MAGIC){
      bones.push({ name: base.name, parent: base.parent, matrix: base.matrix, anims: readBoneAnims(r, base.mend >= VERSION_2) });
    } else if(type === BONE_SYSTEM_MAGIC){
    } else if(type === BOX_MAGIC){
      r.Skip(4*4 + 9*4 + 3*4);
    } else if(type === LIGHT_MAGIC){
      r.Skip(2*4 + 7*3*4);
    } else if(type === LINE_MAGIC){
      const c = r.U32(); r.Skip(c * 2 * 3 * 4);
    } else {
      break;
    }
  }

  const animNames = [];
  for(const b of bones) for(const a of b.anims) if(a.hasTransform && !animNames.includes(a.name)) animNames.push(a.name);

  const meshes = models.filter(m => m.positions.length && m.indices.length);
  return { version, models, bones, animNames, meshes };
}

module.exports = { parseScn };

if(require.main === module){
  const fs = require('fs');
  const file = process.argv[2];
  if(!file){ console.log('usage: node scn_geometry.js <file.scn>'); process.exit(0); }
  const res = parseScn(fs.readFileSync(file));
  console.log('version:', res.version, '| models:', res.models.length, '| bones:', res.bones.length, '| clips:', res.animNames.length);
  for(const m of res.models.slice(0, 8))
    console.log(`  model "${m.name}" verts=${m.positions.length/3} tris=${m.indices.length/3} skin=${m.skin.length} anims=${m.anims.length} tex="${m.texture}"`);
  if(res.animNames.length) console.log('  clips:', res.animNames.slice(0, 10).join(', '));
}
