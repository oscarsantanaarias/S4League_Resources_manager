

export const SEQ_VERSION_TAG = 0.1;

const CLASS_RE = /CAct[A-Za-z0-9_]+/g;

export class Reader {
  constructor(buffer) {
    this.buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.pos = 0;
  }
  get length() { return this.bytes.length; }
  get remaining() { return this.bytes.length - this.pos; }
  u8() { return this.view.getUint8(this.pos++); }
  bool() { return this.view.getUint8(this.pos++) !== 0; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  vec3() { return { x: this.f32(), y: this.f32(), z: this.f32() }; }

  str() {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0) this.pos++;
    const raw = this.bytes.subarray(start, this.pos);
    this.pos++;
    return decodeBytes(raw);
  }
}

function decodeBytes(raw) {
  let ascii = true;
  for (const b of raw) if (b > 0x7e) { ascii = false; break; }
  if (ascii) return String.fromCharCode(...raw);
  try {
    return new TextDecoder('euc-kr').decode(raw);
  } catch {
    return String.fromCharCode(...raw);
  }
}

export function findRecords(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  const out = [];
  CLASS_RE.lastIndex = 0;
  let m;
  while ((m = CLASS_RE.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end < bytes.length && bytes[end] === 0) out.push({ offset: m.index, className: m[0] });
  }
  return out;
}

export function extractStrings(bytes, minLen = 3) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] >= 32 && bytes[i] <= 126) {
      let j = i;
      while (j < bytes.length && bytes[j] >= 32 && bytes[j] <= 126) j++;
      if (j < bytes.length && bytes[j] === 0 && j - i >= minLen) {
        out.push({ offset: i, value: String.fromCharCode(...bytes.subarray(i, j)) });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

const ASSET_RE = /\.(dds|tga|bmp|png|jpg|scn|elu|x)$/i;

export function asAsset(value) {
  if (!ASSET_RE.test(value)) return null;
  const file = value.split(/[\\/]/).pop();
  return { path: value, file, ext: file.split('.').pop().toLowerCase() };
}

export function parseSeq(arrayBuffer) {
  const r = new Reader(arrayBuffer);
  const version = r.f32();
  const name = r.str();
  const flag = r.u8();
  const duration = r.u32();
  const nodeCount = r.u32();

  const recs = findRecords(r.bytes);
  const nodes = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const bodyStart = rec.offset + rec.className.length + 1;
    const bodyEnd = i + 1 < recs.length ? recs[i + 1].offset : r.bytes.length;
    nodes.push(parseNode(rec.className, r.bytes.subarray(bodyStart, bodyEnd), bodyStart));
  }

  return {
    version, name, flag, duration, nodeCount,
    nodes,
    headerSize: r.pos,

    ok: nodeCount === nodes.length && Math.abs(version - SEQ_VERSION_TAG) < 1e-6,
  };
}

function parseNode(className, body, fileOffset) {
  const r = new Reader(body.slice().buffer);
  const node = { className, fileOffset, bodySize: body.length, raw: body };

  node.version = r.f32();
  node.a = r.u32();
  node.b = r.u32();
  node.nodeName = r.str();
  node.headerSize = r.pos;

  node.strings = extractStrings(body);
  node.assets = [];
  for (const s of node.strings) {
    const a = asAsset(s.value);
    if (a) node.assets.push({ ...a, offset: s.offset });
  }
  node.texture = node.assets.find(a => a.ext !== 'scn') || null;
  node.scene = node.assets.find(a => a.ext === 'scn') || null;

  if (className === 'CActNodeLoader' || className === 'CActNodeLoader_IF') {

    try {
      r.u32();
      node.nodeDuration = r.u32();
      node.k = r.f32();
    } catch {  }
  }

  if (className === 'CActParticle' || className === 'CActParticle_IF') {
    readParticle(r, node);
  }

  node.fields = tabulate(body, node.headerSize);
  return node;
}

function readParticle(r, node) {
  try {
    node.beginTime = r.u32();
    node.endTime = r.u32();
    node.header3 = r.f32();
    node.structureMod1 = r.f32();
    node.renderType = r.u32();
    node.textureAnimType = r.u32();
    node.blendType = r.u32();
    node.lifetimeVar = r.u32();
    node.emitterSpeedVar = r.f32();
    node.sizeVarX = r.f32();
    node.sizeVarY = r.f32();
    node.colorVarC = r.f32();
    node.colorVarM = r.f32();
    node.colorVarY = r.f32();
    node.colorVarA = r.f32();
    node.rotateVar = r.f32();
    node.attachTarget = r.bool();
    node.maxParticles = r.u32();
    node.scaleFlags = r.u8();
    node.textureAnimDelay = r.u32();
    node.fogState = r.bool();
    node.cullRadius = r.u32();
    node.sizeVar = r.f32();
    node.sizeLock = r.bool();
    node.colorLock = r.bool();
    node.alphaLock = r.bool();
    node.rotateLock = r.bool();
    node.minimumTimeDelta = r.u8();
    node.u2 = r.u8(); node.u3 = r.u8(); node.u4 = r.u8();

    const atHeader4 = () => r.pos + 4 <= r.length
      && Math.abs(r.view.getFloat32(r.pos, true) - 0.1) < 1e-6;
    node.glow = atHeader4() ? null : r.bool();
    node.haze = atHeader4() ? null : r.bool();
    node.variant = (node.glow === null ? 0 : 1) + (node.haze === null ? 0 : 1);

    node.header4 = r.f32();

    node.emitterTime = r.u32();
    node.keyLerp = r.bool();
    const nEmit = r.u32();
    node.emitters = [];
    for (let k = 0; k < nEmit; k++) {
      node.emitters.push({
        frame: r.u32(),
        continuance: r.bool(),
        origin: r.vec3(),
        coneDir: r.vec3(),
        coneTheta: r.f32(),
        speed: r.f32(),
        emitterType: r.u32(),
        minWidth: r.f32(), maxWidth: r.f32(),
        minHeight: r.f32(), maxHeight: r.f32(),
        gravity: r.vec3(),
        attractive: r.f32(),
        lifetime: r.u32(),
        perSecond: r.u32(),
        textureKey: r.u32(),
      });
    }
    node.header5 = r.f32();

    const nKey = r.u32();
    node.keys = [];
    for (let k = 0; k < nKey; k++) {
      node.keys.push({
        frame: r.f32(),
        sizeX: r.f32(), sizeY: r.f32(),
        r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32(),
        rotate: r.f32(),
      });
    }
    node.header6 = r.f32();

    const nTex = r.u32();
    node.textures = [];
    for (let t = 0; t < nTex; t++) {
      const path = r.str();
      const uv = [];
      for (let i = 0; i < 8; i++) uv.push(r.f32());
      node.textures.push({ path, file: path.split(/[\\/]/).pop(), uv });
    }

    const m = (v, exp) => Math.abs(v - exp) < 1e-6;
    node.markersOk = m(node.header3, 0.1) && m(node.header4, 0.1)
                  && m(node.header5, 0.1) && m(node.header6, 0.2);
    node.bytesLeft = r.length - r.pos;
    node.fieldsOk = node.markersOk && node.bytesLeft === 0;

    node.derail = !m(node.header3, 0.1) ? 'header3'
                : !m(node.header4, 0.1) ? 'fixed-block'
                : !m(node.header5, 0.1) ? 'emitters'
                : !m(node.header6, 0.2) ? 'scene-keys'
                : node.bytesLeft !== 0 ? 'textures' : null;
  } catch (e) {
    node.fieldsOk = false;
    node.parseError = e.message;
  }
}

export function tabulate(body, from = 0) {
  const dv = new DataView(body.slice().buffer);
  const out = [];
  for (let o = from; o + 4 <= body.length; o++) {
    const f = dv.getFloat32(o, true);
    const u = dv.getUint32(o, true);
    const plausible = (f === 0) || (Math.abs(f) >= 1e-4 && Math.abs(f) < 1e6);
    out.push({ offset: o, f32: f, u32: u, i32: dv.getInt32(o, true), plausibleFloat: plausible });
  }
  return out;
}
