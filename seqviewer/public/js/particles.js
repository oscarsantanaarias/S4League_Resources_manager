

import * as THREE from 'three';

const MAX_POOL = 600;

export function sampleKeys(keys, u) {
  if (!keys || keys.length === 0) {
    return { sizeX: 1, sizeY: 1, r: 1, g: 1, b: 1, a: 1, rotate: 0 };
  }
  if (keys.length === 1) return keys[0];

  const first = keys[0].frame, last = keys[keys.length - 1].frame;
  const span = last - first || 1;
  const f = first + u * span;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].frame < f) i++;
  const A = keys[i], B = keys[i + 1] || A;
  const d = (B.frame - A.frame) || 1;
  const t = Math.min(1, Math.max(0, (f - A.frame) / d));
  const mix = (x, y) => x + (y - x) * t;
  return {
    sizeX: mix(A.sizeX, B.sizeX), sizeY: mix(A.sizeY, B.sizeY),
    r: mix(A.r, B.r), g: mix(A.g, B.g), b: mix(A.b, B.b), a: mix(A.a, B.a),
    rotate: mix(A.rotate, B.rotate),
  };
}

function coneDirection(axis, thetaDeg, rnd) {
  const v = new THREE.Vector3(axis.x, axis.y, axis.z);
  if (v.lengthSq() < 1e-9) v.set(0, 1, 0);
  v.normalize();
  const theta = THREE.MathUtils.degToRad(Math.min(180, Math.abs(thetaDeg || 0)));
  if (theta <= 0) return v;

  const cosT = Math.cos(theta);
  const z = cosT + rnd() * (1 - cosT);
  const phi = rnd() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  const local = new THREE.Vector3(s * Math.cos(phi), s * Math.sin(phi), z);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
  return local.applyQuaternion(q);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class ParticleNode {

  constructor(node, tex, scale = 1) {
    this.node = node;
    this.scale = scale;
    this.emitter = (node.emitters && node.emitters[0]) || null;
    this.keys = node.keys || [];
    this.beginTime = node.beginTime || 0;
    this.endTime = node.endTime || 0;

    const em = this.emitter;
    this.lifetime = Math.max(1, em?.lifetime || node.endTime || 1000);
    const perSec = Math.max(1, em?.perSecond || 30);
    this.interval = 1000 / perSec;
    this.count = Math.min(MAX_POOL,
      Math.max(8, Math.ceil((this.lifetime / 1000) * perSec)));
    this.cycle = this.count * this.interval;

    const rnd = rng(0x9e3779b9 ^ (node.fileOffset || 1));
    const w0 = Math.min(em?.minWidth || 0, em?.maxWidth || 0);
    const w1 = Math.max(em?.minWidth || 0, em?.maxWidth || 0);
    const h0 = Math.min(em?.minHeight || 0, em?.maxHeight || 0);
    const h1 = Math.max(em?.minHeight || 0, em?.maxHeight || 0);

    this.dirs = [];
    this.spawn = [];
    for (let i = 0; i < this.count; i++) {
      this.dirs.push(coneDirection(em?.coneDir || { x: 0, y: 1, z: 0 },
                                   em?.coneTheta ?? 0, rnd));
      const rad = w0 + (w1 - w0) * Math.sqrt(rnd());
      const ang = rnd() * Math.PI * 2;
      this.spawn.push(new THREE.Vector3(
        Math.cos(ang) * rad,
        h0 + (h1 - h0) * rnd(),
        Math.sin(ang) * rad));
    }

    const pos = new Float32Array(this.count * 3);
    const col = new Float32Array(this.count * 4);
    const siz = new Float32Array(this.count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('psize', new THREE.BufferAttribute(siz, 1));

    // blendType 1 is additive: it holds every flash/lightning/glow effect in the
    // shipped .seq files, while 0 holds smoke, fog and cloud. blendType 2 appears
    // on 6 nodes only (pve_splinter) and falls back to normal alpha.
    // ponytail: derived from texture correlation over 618 .seq files, not from the
    // client binary. If a specific effect looks wrong, confirm blendType 2 in IDA.
    const additive = (node.blendType ?? 0) === 1;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex }, hasMap: { value: tex ? 1 : 0 },

        uPixelScale: { value: 800.0 },
        uMinPixels: { value: 2.0 },
      },
      vertexShader: `
        attribute vec4 pcolor; attribute float psize;
        varying vec4 vC;
        uniform float uPixelScale, uMinPixels;
        void main(){
          vC = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(0.001, -mv.z);
          gl_PointSize = max(uMinPixels, psize * uPixelScale / d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform float hasMap;
        varying vec4 vC;
        void main(){
          vec4 t;
          if (hasMap > 0.5) {
            t = texture2D(map, gl_PointCoord);
          } else {
            // Sin textura: disco magenta difuminado. Se distingue a simple
            // vista de un efecto real y avisa de que falta el recurso.
            float d = length(gl_PointCoord - vec2(0.5));
            t = vec4(1.0, 0.15, 0.8, smoothstep(0.5, 0.1, d) * 0.7);
          }
          gl_FragColor = vec4(t.rgb * vC.rgb, t.a * vC.a);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);

    this.points.frustumCulled = false;
    this.stats = { alive: 0, first: null, size: 0 };
  }

  update(tMs) {
    const g = this.points.geometry;
    const pos = g.attributes.position, col = g.attributes.pcolor, siz = g.attributes.psize;
    const em = this.emitter;
    const S = this.scale;

    const active = tMs >= this.beginTime && (this.endTime <= 0 || tMs <= this.endTime);
    const local = tMs - this.beginTime;

    const ox = (em?.origin.x || 0), oy = (em?.origin.y || 0), oz = (em?.origin.z || 0);
    const gx = (em?.gravity.x || 0), gy = (em?.gravity.y || 0), gz = (em?.gravity.z || 0);
    const speed = em?.speed || 0;
    let alive = 0, first = null, maxSize = 0;

    for (let i = 0; i < this.count; i++) {
      let age = -1;
      if (active) {
        age = (local - i * this.interval) % this.cycle;
        if (age < 0) age += this.cycle;
      }
      if (age < 0 || age > this.lifetime) {
        col.setXYZW(i, 0, 0, 0, 0);
        siz.setX(i, 0);
        continue;
      }
      const u = age / this.lifetime;
      const t = age / 1000;
      const d = this.dirs[i];
      const sp = this.spawn[i];

      const px = (ox + sp.x + d.x * speed * t + 0.5 * gx * t * t) * S;
      const py = (oy + sp.y + d.y * speed * t + 0.5 * gy * t * t) * S;
      const pz = (oz + sp.z + d.z * speed * t + 0.5 * gz * t * t) * S;

      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
        col.setXYZW(i, 0, 0, 0, 0); siz.setX(i, 0);
        continue;
      }
      pos.setXYZ(i, px, py, pz);

      const k = sampleKeys(this.keys, u);
      const a = Number.isFinite(k.a) ? k.a : 1;
      col.setXYZW(i, k.r || 0, k.g || 0, k.b || 0, a);

      const sz = Math.max(0.01, (Math.abs(k.sizeX) + Math.abs(k.sizeY)) * 0.5) * S;
      siz.setX(i, sz);

      if (a > 0.01) {
        alive++;
        maxSize = Math.max(maxSize, sz);
        if (!first) first = { x: px, y: py, z: pz };
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true; siz.needsUpdate = true;
    this.stats = { alive, first, size: maxSize };
  }

  setPixelScale(v) { this.material.uniforms.uPixelScale.value = v; }

  fullExtent() {
    const e = this.emitter;
    if (!e) return 10;
    const o = Math.hypot(e.origin.x, e.origin.y, e.origin.z);
    const t = (e.lifetime || 1000) / 1000;
    const v = (e.speed || 0) * t;
    const g = 0.5 * Math.hypot(e.gravity.x, e.gravity.y, e.gravity.z) * t * t;
    return o + v + g + this.maxKeySize();
  }

  maxKeySize() {
    let s = 0;
    for (const k of this.keys) s = Math.max(s, Math.abs(k.sizeX), Math.abs(k.sizeY));
    return s;
  }

  focusExtent() {
    const e = this.emitter;
    if (!e) return 50;
    const o = Math.hypot(e.origin.x, e.origin.y, e.origin.z);
    const emis = Math.max(Math.abs(e.maxWidth || 0), Math.abs(e.minWidth || 0),
                          Math.abs(e.maxHeight || 0), Math.abs(e.minHeight || 0));
    return Math.max(o + emis, this.maxKeySize() * 30, 50);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
