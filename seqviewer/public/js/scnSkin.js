export const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mat4Mul(A, B) {
  const C = new Array(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      C[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c]
                   + A[r * 4 + 2] * B[8 + c] + A[r * 4 + 3] * B[12 + c];
  return C;
}

export function mat4InvAffine(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const C00 = e * i - f * h, C01 = -(d * i - f * g), C02 = d * h - e * g;
  const det = a * C00 + b * C01 + c * C02;
  if (Math.abs(det) < 1e-12) return m.slice();
  const id = 1 / det;
  const n0 = C00 * id, n1 = -(b * i - c * h) * id, n2 = (b * f - c * e) * id;
  const n3 = C01 * id, n4 = (a * i - c * g) * id, n5 = -(a * f - c * d) * id;
  const n6 = C02 * id, n7 = -(a * h - b * g) * id, n8 = (a * e - b * d) * id;
  const tx = m[12], ty = m[13], tz = m[14];
  return [n0, n1, n2, 0, n3, n4, n5, 0, n6, n7, n8, 0,
    -(tx * n0 + ty * n3 + tz * n6), -(tx * n1 + ty * n4 + tz * n7), -(tx * n2 + ty * n5 + tz * n8), 1];
}

export function buildTRS(T, q, S) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  return [
    S[0] * (1 - 2 * (y * y + z * z)), S[0] * (2 * (x * y + z * w)), S[0] * (2 * (x * z - y * w)), 0,
    S[1] * (2 * (x * y - z * w)), S[1] * (1 - 2 * (x * x + z * z)), S[1] * (2 * (y * z + x * w)), 0,
    S[2] * (2 * (x * z + y * w)), S[2] * (2 * (y * z - x * w)), S[2] * (1 - 2 * (x * x + y * y)), 0,
    T[0], T[1], T[2], 1,
  ];
}

function sampleVec(keys, def, t) {
  if (!keys.length) return def;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const t0 = keys[i - 1].t, t1 = keys[i].t;
      const a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const A = keys[i - 1].v, B = keys[i].v;
      return [A[0] + (B[0] - A[0]) * a, A[1] + (B[1] - A[1]) * a, A[2] + (B[2] - A[2]) * a];
    }
  }
  return keys[keys.length - 1].v;
}

function sampleQuat(keys, def, t) {
  if (!keys.length) return def.slice();
  if (t <= keys[0].t) return keys[0].q.slice();
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const A = keys[i - 1], B = keys[i];
      const a = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0;
      const d = A.q[0] * B.q[0] + A.q[1] * B.q[1] + A.q[2] * B.q[2] + A.q[3] * B.q[3];
      const s = d < 0 ? -1 : 1;
      const o = [
        A.q[0] + (B.q[0] * s - A.q[0]) * a, A.q[1] + (B.q[1] * s - A.q[1]) * a,
        A.q[2] + (B.q[2] * s - A.q[2]) * a, A.q[3] + (B.q[3] * s - A.q[3]) * a,
      ];
      const l = Math.hypot(o[0], o[1], o[2], o[3]);
      if (l > 1e-6) { o[0] /= l; o[1] /= l; o[2] /= l; o[3] /= l; }
      return o;
    }
  }
  return keys[keys.length - 1].q.slice();
}

function composeTRS(a, tick) {
  const t = a.duration ? (tick % a.duration) : tick;
  return buildTRS(sampleVec(a.trans, a.initT, t), sampleQuat(a.rot, a.initR, t), sampleVec(a.scale, a.initS, t));
}

export function sampleNode(m, tick) {
  if (!m.anims.length || !m.anims[0].hasTransform) return IDENT.slice();
  const a = m.anims[0];
  return mat4Mul(mat4InvAffine(buildTRS(a.initT, a.initR, a.initS)), composeTRS(a, tick));
}

const findAnim = (bone, name) => bone.anims.find(a => a.name === name) || null;

function sampleBoneTRS(bone, animName, tick) {
  const a = findAnim(bone, animName);
  if (!a || !a.hasTransform) return null;
  const t = a.duration ? (tick % a.duration) : tick;
  return { T: sampleVec(a.trans, a.initT, t), q: sampleQuat(a.rot, a.initR, t), S: sampleVec(a.scale, a.initS, t) };
}

function sampleBonePose(bone, p) {
  const A = sampleBoneTRS(bone, p.clipA, p.tickA);
  if (p.blend > 0.001 && p.clipB && p.clipB !== p.clipA && A) {
    const B = sampleBoneTRS(bone, p.clipB, p.tickB);
    if (B) {
      const w = Math.min(1, p.blend);
      const T = [0, 1, 2].map(i => A.T[i] + (B.T[i] - A.T[i]) * w);
      const S = [0, 1, 2].map(i => A.S[i] + (B.S[i] - A.S[i]) * w);
      const s = (A.q[0] * B.q[0] + A.q[1] * B.q[1] + A.q[2] * B.q[2] + A.q[3] * B.q[3]) < 0 ? -1 : 1;
      const q = [0, 1, 2, 3].map(i => A.q[i] + (B.q[i] * s - A.q[i]) * w);
      const l = Math.hypot(q[0], q[1], q[2], q[3]);
      if (l > 1e-6) for (let i = 0; i < 4; i++) q[i] /= l;
      return buildTRS(T, q, S);
    }
  }
  if (A) return buildTRS(A.T, A.q, A.S);
  const a = findAnim(bone, p.clipA);
  if (a && a.hasTransform) return composeTRS(a, p.tickA);
  return null;   // caller substitutes the bind local, see resolveBoneWorlds
}

function boneDelta(bone, pose) {
  const a = findAnim(bone, pose.clipA) || bone.anims[0];
  if (!a || !a.hasTransform) return IDENT.slice();
  return mat4Mul(mat4InvAffine(buildTRS(a.initT, a.initR, a.initS)), composeTRS(a, pose.tickA));
}

export function resolveBoneWorlds(sc, pose, deltaMode = false) {
  const nb = sc.bones.length;
  const local = new Array(nb), world = new Array(nb);
  const parent = new Array(nb).fill(-1), done = new Array(nb).fill(false);
  const byName = new Map();
  for (let i = 0; i < nb; i++) byName.set(sc.bones[i].name, i);
  for (let i = 0; i < nb; i++) {
    const p = sc.bones[i].parent;
    if (p && byName.has(p)) parent[i] = byName.get(p);
  }
  // Bone matrices are ABSOLUTE. A bone with no track for this clip keeps its
  // fixed relation to the parent: boneMatrix * inv(parentMatrix). Using an
  // absolute matrix as a local one applies the parent twice and throws the bone
  // across the map - that is what happened to every dummy and twist bone.
  for (let i = 0; i < nb; i++) {
    const posed = deltaMode ? boneDelta(sc.bones[i], pose) : sampleBonePose(sc.bones[i], pose);
    if (posed) { local[i] = posed; continue; }
    local[i] = parent[i] < 0
      ? sc.bones[i].matrix.slice()
      : mat4Mul(sc.bones[i].matrix, mat4InvAffine(sc.bones[parent[i]].matrix));
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < nb; i++) {
      if (done[i]) continue;
      if (parent[i] < 0) { world[i] = local[i]; done[i] = true; progress = true; }
      else if (done[parent[i]]) { world[i] = mat4Mul(local[i], world[parent[i]]); done[i] = true; progress = true; }
    }
  }
  for (let i = 0; i < nb; i++) if (!done[i]) world[i] = local[i];
  return world;
}

export function boneWorldByNameW(sc, boneName, world) {
  const idx = sc.bones.findIndex(b => b.name === boneName);
  return (idx < 0 || !world) ? null : world[idx];
}

export function boneWorldByName(sc, boneName, pose) {
  const idx = sc.bones.findIndex(b => b.name === boneName);
  return idx < 0 ? null : resolveBoneWorlds(sc, pose)[idx];
}

export function applyMatrix(pos, M) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = x * M[0] + y * M[4] + z * M[8] + M[12];
    out[i + 1] = x * M[1] + y * M[5] + z * M[9] + M[13];
    out[i + 2] = x * M[2] + y * M[6] + z * M[10] + M[14];
  }
  return out;
}

export function skinModelW(m, sc, world) {
  const n = m.positions.length;
  const out = new Float32Array(n);
  out.set(m.positions);
  if (!m.skin.length || !sc.bones.length || !world) return out;

  const boneIdx = new Map();
  for (let j = 0; j < sc.bones.length; j++) boneIdx.set(sc.bones[j].name, j);

  const nv = n / 3;
  const acc = new Float32Array(n);
  const wsum = new Float32Array(nv);

  for (const sb of m.skin) {
    const bi = boneIdx.has(sb.name) ? boneIdx.get(sb.name) : -1;
    const skin = bi >= 0 ? mat4Mul(sb.bind, world[bi]) : IDENT;
    for (const bw of sb.weights) {
      const vi = bw.vertex;
      if (vi >= nv) continue;
      const vx = m.positions[vi * 3], vy = m.positions[vi * 3 + 1], vz = m.positions[vi * 3 + 2];
      acc[vi * 3] += (vx * skin[0] + vy * skin[4] + vz * skin[8] + skin[12]) * bw.weight;
      acc[vi * 3 + 1] += (vx * skin[1] + vy * skin[5] + vz * skin[9] + skin[13]) * bw.weight;
      acc[vi * 3 + 2] += (vx * skin[2] + vy * skin[6] + vz * skin[10] + skin[14]) * bw.weight;
      wsum[vi] += bw.weight;
    }
  }
  for (let i = 0; i < nv; i++) {
    if (wsum[i] > 1e-4) {
      out[i * 3] = acc[i * 3] / wsum[i];
      out[i * 3 + 1] = acc[i * 3 + 1] / wsum[i];
      out[i * 3 + 2] = acc[i * 3 + 2] / wsum[i];
    }
  }
  return out;
}

export function assembleCharacter(skel, parts, pose) {
  const skelWorld = resolveBoneWorlds(skel, pose);
  const pieces = [];
  for (const scene of parts) gatherScene(skel, skelWorld, scene, pose, pieces);
  return pieces;
}

function gatherScene(skel, skelWorld, scene, pose, pieces) {
  const worldOf = nodeResolver(scene, pose);
  for (const m of scene.models) {
    if (!m.positions.length || !m.indices.length) continue;
    let positions;
    if (m.skin.length) {
      positions = skinModelW(m, skel, skelWorld);
    } else {
      const dummy = m.parent ? worldOf(m.parent) : null;
      const head = boneWorldByNameW(skel, 'Bip01 Head', skelWorld);
      let world;
      if (dummy && head) world = mat4Mul(mat4Mul(m.matrix, dummy), head);
      else if (dummy) world = mat4Mul(m.matrix, dummy);
      else {
        const bone = m.parent ? boneWorldByNameW(skel, m.parent, skelWorld) : null;
        const anchor = bone || head;
        world = anchor ? mat4Mul(m.matrix, anchor) : sampleNode(m, pose.tickA);
      }
      positions = applyMatrix(m.positions, world);
    }
    pieces.push({ ...m, positions });
  }
}

export function attachWeapon(skel, skelWorld, weapon, anchorName, pose) {
  const anchor = boneWorldByNameW(skel, anchorName, skelWorld);
  const wPose = { clipA: weapon.animNames[0] || '', clipB: '', tickA: pose.tickA, tickB: 0, blend: 0 };
  const worldOf = nodeResolver(weapon, wPose);
  const pieces = [];
  for (const m of weapon.models) {
    if (!m.positions.length || !m.indices.length) continue;
    const local = m.parent ? worldOf(m.parent) : null;
    let world = local ? mat4Mul(m.matrix, local) : m.matrix.slice();
    if (anchor) world = mat4Mul(world, anchor);
    pieces.push({ ...m, positions: applyMatrix(m.positions, world) });
  }
  return pieces;
}

export function assembleFull(skel, parts, weapons, pose) {
  const skelWorld = resolveBoneWorlds(skel, pose);
  const pieces = [];
  for (const scene of parts) gatherScene(skel, skelWorld, scene, pose, pieces);
  for (const w of weapons || []) {
    if (!w?.scene) continue;
    pieces.push(...attachWeapon(skel, skelWorld, w.scene, w.anchor, pose));
  }
  return pieces;
}

export function nodeResolver(scene, pose, clipOf = null) {
  const boneWorlds = scene.bones.length ? resolveBoneWorlds(scene, pose, !!scene.sharedSpace) : null;
  const boneIdx = new Map(scene.bones.map((b, i) => [b.name, i]));
  const modelByName = new Map(scene.models.map(m => [m.name, m]));
  const cache = new Map();

  return function worldOf(name, depth = 0) {
    if (!name || depth > 16) return null;
    if (scene.headerName && name === scene.headerName) return null;
    if (cache.has(name)) return cache.get(name);
    let w = null;
    if (boneIdx.has(name) && boneWorlds) {
      w = boneWorlds[boneIdx.get(name)];
    } else {
      const m = modelByName.get(name);
      if (m) {
        const parentName = m.parent && m.parent !== m.name ? m.parent : null;
        const p = parentName ? worldOf(parentName, depth + 1) : null;
        const local = nodeLocal(scene, m, pose.tickA, clipOf ? clipOf(m.name) : null);
        w = p ? mat4Mul(local, p) : local;
      }
    }
    cache.set(name, w);
    return w;
  };
}

export function mergeClips(base, extra) {
  if (!base?.bones || !extra?.bones) return base;
  const byName = new Map(base.bones.map(b => [b.name, b]));
  let added = 0;
  for (const eb of extra.bones) {
    const bb = byName.get(eb.name);
    if (!bb) continue;
    const existing = new Set(bb.anims.map(a => a.name));
    for (const a of eb.anims) {
      if (existing.has(a.name)) continue;
      bb.anims.push(a);
      added++;
    }
  }
  const names = new Set(base.animNames);
  for (const n of extra.animNames) if (!names.has(n)) { base.animNames.push(n); names.add(n); }
  base.mergedClips = added;
  return base;
}

function nodeLocal(scene, m, tick, clipName) {
  const anims = m.anims || [];
  const a = (clipName && anims.find(x => x.name === clipName && x.hasTransform)) || anims[0];
  if (!a || !a.hasTransform) return IDENT.slice();
  return scene.sharedSpace ? sampleNode(m, tick) : composeTRS(a, tick);
}

export function worldPositions(scene, m, pose, worldOf = null, clipOf = null) {
  if (m.skin.length && scene.bones.length) {
    return new Float32Array(m.positions);
  }
  const resolve = worldOf || nodeResolver(scene, pose, clipOf);
  const parentName = m.parent && m.parent !== m.name ? m.parent : null;
  const parentW = parentName ? resolve(parentName) : null;
  const local = nodeLocal(scene, m, pose.tickA, clipOf ? clipOf(m.name) : null);
  const world = parentW ? mat4Mul(local, parentW) : local;
  return applyMatrix(m.positions, world);
}
