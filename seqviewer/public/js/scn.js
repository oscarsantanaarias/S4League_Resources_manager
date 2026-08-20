

const SCENE_MAGIC = 0x6278D57A;
const MODEL_MAGIC = 0x081098F8;
const BOX_MAGIC = 0x25ADF0D1;
const BONE_MAGIC = 0x6D411AD1;
const LIGHT_MAGIC = 0xC3E8BE62;
const BONE_SYSTEM_MAGIC = 0x5E74333F;
const LINE_MAGIC = 0xADEE38A2;
const SPHERE_MAGIC = 0x4F1C2440;   // CSphereNode
const VERSION_2 = 1045220557;
const PADDING = 1024;

class R {
  constructor(ab) {
    this.bytes = new Uint8Array(ab);
    this.view = new DataView(ab);
    this.n = this.bytes.length;
    this.o = 0;
    this.bad = false;
  }
  need(k) { if (this.o + k > this.n) { this.bad = true; return false; } return true; }
  U8() { if (!this.need(1)) return 0; return this.bytes[this.o++]; }
  U16() { if (!this.need(2)) return 0; const v = this.view.getUint16(this.o, true); this.o += 2; return v; }
  U32() { if (!this.need(4)) return 0; const v = this.view.getUint32(this.o, true); this.o += 4; return v; }
  F32() { if (!this.need(4)) return 0; const v = this.view.getFloat32(this.o, true); this.o += 4; return v; }
  V3() { return [this.F32(), this.F32(), this.F32()]; }
  Skip(k) { this.o += k; if (this.o > this.n) this.bad = true; }
  Str() {
    let s = '';
    while (this.o < this.n && this.bytes[this.o] !== 0) s += String.fromCharCode(this.bytes[this.o++]);
    if (this.o < this.n) this.o++;
    return s;
  }
  PaddedStr() { const s0 = this.o; const s = this.Str(); this.o = s0 + PADDING; if (this.o > this.n) this.bad = true; return s; }
  Mat16() { const m = new Array(16); for (let i = 0; i < 16; i++) m[i] = this.F32(); return m; }
}

function skipVis(r) { const c = r.U32(); for (let k = 0; k < c && !r.bad; k++) r.Skip(8); }

function readTransformKeys(r) {
  const trans = [], rot = [], scale = [];
  let k = r.U32(); for (let j = 0; j < k && !r.bad; j++) trans.push({ t: r.U32(), v: r.V3() });
  k = r.U32(); for (let j = 0; j < k && !r.bad; j++) rot.push({ t: r.U32(), q: [r.F32(), r.F32(), r.F32(), r.F32()] });
  k = r.U32(); for (let j = 0; j < k && !r.bad; j++) scale.push({ t: r.U32(), v: r.V3() });
  return { trans, rot, scale };
}

function readModelAnims(r) {
  const anims = [];
  const c = r.U32();
  for (let i = 0; i < c && !r.bad; i++) {
    const a = { name: r.Str(), duration: r.U32(), hasTransform: false, trans: [], rot: [], scale: [], morph: [] };
    if (r.U8()) {
      a.hasTransform = true;
      a.initT = r.V3();
      a.initR = [r.F32(), r.F32(), r.F32(), r.F32()];
      a.initS = r.V3();
      Object.assign(a, readTransformKeys(r));
    }
    skipVis(r);

    const mc = r.U32();
    for (let j = 0; j < mc && !r.bad; j++) {
      const key = { tick: r.U32(), verts: [] };
      const vc = r.U32();
      for (let v = 0; v < vc && !r.bad; v++) key.verts.push({ index: r.U32(), pos: r.V3() });
      const uc = r.U32(); for (let v = 0; v < uc && !r.bad; v++) r.Skip(12);
      a.morph.push(key);
    }
    anims.push(a);
  }
  return anims;
}

function readBoneAnims(r, versionFlag) {
  const anims = [];
  const c = r.U32();
  for (let i = 0; i < c && !r.bad; i++) {
    const name = r.Str();
    if (versionFlag) { const copy = r.Str(); if (copy) continue; }
    const a = { name, duration: r.U32(), hasTransform: false, trans: [], rot: [], scale: [] };
    if (r.U8()) {
      a.hasTransform = true;
      a.initT = r.V3();
      a.initR = [r.F32(), r.F32(), r.F32(), r.F32()];
      a.initS = r.V3();
      Object.assign(a, readTransformKeys(r));
    }
    skipVis(r);
    anims.push(a);
  }
  return anims;
}

function readBase(r) {
  const name = r.Str();
  const parent = r.Str();
  r.U32();
  const matrix = r.Mat16();
  const mend = r.U32();
  return { name, parent, matrix, mend };
}

function parseModel(r, base) {
  const renderFlag = r.U32();
  const texVersion = r.U32();
  let extraUv = 0;
  if (texVersion >= VERSION_2) extraUv = r.U32();

  const itemCount = r.U32();
  const texItems = [];
  let texture = '';
  for (let i = 0; i < itemCount && !r.bad; i++) {
    const main = r.PaddedStr();
    let side = '';
    if (texVersion >= VERSION_2) side = r.PaddedStr();
    const faceStart = r.U32(), faceCount = r.U32();
    texItems.push({ name: main, side, faceStart, faceCount });
    if (i === 0) texture = main;
  }

  const vc = r.U32();
  const positions = new Float32Array(vc * 3);
  for (let i = 0; i < vc && !r.bad; i++) {
    positions[i * 3] = r.F32(); positions[i * 3 + 1] = r.F32(); positions[i * 3 + 2] = r.F32();
  }

  const fc = r.U32();
  const indices = new Uint16Array(fc * 3);
  for (let i = 0; i < fc && !r.bad; i++) {
    indices[i * 3] = r.U16(); indices[i * 3 + 1] = r.U16(); indices[i * 3 + 2] = r.U16();
  }

  const nc = r.U32(); for (let i = 0; i < nc && !r.bad; i++) r.Skip(12);

  const uc = r.U32();
  const uvs = new Float32Array(uc * 2);
  for (let i = 0; i < uc && !r.bad; i++) { uvs[i * 2] = r.F32(); uvs[i * 2 + 1] = r.F32(); }
  if (extraUv === 1) for (let i = 0; i < uc && !r.bad; i++) { r.F32(); r.F32(); }

  const tc = r.U32(); for (let i = 0; i < tc && !r.bad; i++) r.Skip(12);

  const wb = r.U32();
  const skin = [];
  for (let i = 0; i < wb && !r.bad; i++) {
    const bone = { name: r.Str(), bind: r.Mat16(), weights: [] };
    const wc = r.U32();
    for (let k = 0; k < wc && !r.bad; k++) bone.weights.push({ vertex: r.U32(), weight: r.F32() });
    skin.push(bone);
  }

  const anims = readModelAnims(r);
  return {
    name: base.name, parent: base.parent, matrix: base.matrix,
    renderFlag, texture, texItems, positions, indices, uvs, skin, anims,
  };
}

export function parseScn(arrayBuffer) {
  const r = new R(arrayBuffer);
  const version = r.U32();
  let v = r.U32(), guard = 0;
  while (v !== SCENE_MAGIC && !r.bad && guard++ < 64) v = r.U32();
  if (v !== SCENE_MAGIC) throw new Error('no SCENE_MAGIC: is the .scn not decoded?');

  const headerName = r.Str(); r.Str(); r.U32(); r.Skip(16 * 4);
  const matrixEnd = r.U32();
  const chunkCount = r.U32();
  if (matrixEnd >= VERSION_2) r.Str();

  const models = [], bones = [], nodes = [];
  for (let i = 0; i < chunkCount && !r.bad; i++) {
    const type = r.U32();
    const base = readBase(r);
    if (type === MODEL_MAGIC) { const m = parseModel(r, base); m.kind = 'model'; models.push(m); nodes.push(m); }
    else if (type === BONE_MAGIC) { const b = { kind: 'bone', name: base.name, parent: base.parent, matrix: base.matrix, anims: readBoneAnims(r, base.mend >= VERSION_2) }; bones.push(b); nodes.push(b); }
    else if (type === BONE_SYSTEM_MAGIC) {  }
    else if (type === BOX_MAGIC) r.Skip(4 * 4 + 9 * 4 + 3 * 4);
    else if (type === LIGHT_MAGIC) r.Skip(2 * 4 + 7 * 3 * 4);
    else if (type === LINE_MAGIC) { const c = r.U32(); r.Skip(c * 2 * 3 * 4); }
    // CSphereNode: ver + center + radius. Sin esta rama el loop corta acá y se come
    // en silencio el resto de los chunks de la escena.
    else if (type === SPHERE_MAGIC) r.Skip(4 + 3 * 4 + 4);
    else break;
  }

  const animNames = [];
  for (const b of bones) for (const a of b.anims) if (a.hasTransform && !animNames.includes(a.name)) animNames.push(a.name);
  const meshes = models.filter(m => m.positions.length && m.indices.length);
  return { version, headerName, models, bones, nodes, animNames, meshes, truncated: r.bad };
}
