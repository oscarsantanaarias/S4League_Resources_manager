'use strict';

// Retarget a Mixamo animation onto an S4 skeleton.
//
// Two things make this more than a name swap:
//
//   1. The bones are named nothing alike. mixamorigRightForeArm is
//      "Bip01 R Forearm" here, mixamorigHips is "Bip01 Pelvis". A plain
//      normalisation matches 5 of 65, so SYNONYMS below does the real work and
//      fuzzy matching only fills the gaps.
//
//   2. An S4 clip stores keys on a fixed grid of TICKS, 4800 to the second, and
//      the codec can only overwrite keys that already exist. A 30 fps Mixamo
//      track cannot be dropped in as is: it is resampled onto the ticks the
//      target clip already has. Times are ticks throughout, never milliseconds.
//
// The render space is mirrored (root scale.z = -1), so a rotation crossing over
// becomes (x, y, z, w) -> (-x, -y, z, w). Same conversion as the pose editor.

// Mixamo name (lowercase, mixamorig stripped) -> S4 bone name
const SYNONYMS = {
  hips: 'Bip01',        // the .bmap sends it to the root, not to the pelvis
  spine: 'Bip01 Spine',
  spine1: 'Bip01 Spine1',
  spine2: 'Bip01 Spine2',
  neck: 'Bip01 Neck',
  head: 'Bip01 Head',
  headtop_end: 'Bip01 HeadNub',
  headtopend: 'Bip01 HeadNub',   // normalising drops the underscores
};

// side + limb -> S4 suffix, applied for Left/Right variants
const LIMBS = {
  shoulder: 'Clavicle',
  arm: 'UpperArm',
  forearm: 'Forearm',
  hand: 'Hand',
  upleg: 'Thigh',
  leg: 'Calf',
  foot: 'Foot',
  toebase: 'Toe0',
  toe_end: 'Toe0Nub',
  toeend: 'Toe0Nub',        // Mixamo writes RightToe_End, normalising drops the underscore
};

// Mixamo names fingers Thumb/Index/Middle/Ring/Pinky 1..4,
// S4 names them Finger0..Finger4 with 1 and 2 as the joints and Nub as the tip.
const FINGERS = { thumb: '0', index: '1', middle: '2', ring: '3', pinky: '4' };

function stripPrefix(name) {
  return String(name || '').replace(/^mixamorig[:_]?/i, '').trim();
}

function normalize(name) {
  return stripPrefix(name).toLowerCase().replace(/[\s_:]/g, '');
}

// "RightHandIndex2" -> { side: 'R', rest: 'handindex2' }
function splitSide(name) {
  const n = normalize(name);
  if (n.startsWith('right')) return { side: 'R', rest: n.slice(5) };
  if (n.startsWith('left')) return { side: 'L', rest: n.slice(4) };
  return { side: '', rest: n };
}

function mixamoToS4(mixamoName) {
  const { side, rest } = splitSide(mixamoName);

  if (!side && SYNONYMS[rest]) return SYNONYMS[rest];

  if (side) {
    if (LIMBS[rest]) return 'Bip01 ' + side + ' ' + LIMBS[rest];

    // hand fingers: handindex2 -> Bip01 R Finger11
    const f = rest.match(/^hand(thumb|index|middle|ring|pinky)(\d)$/);
    if (f) {
      const digit = FINGERS[f[1]];
      const joint = Number(f[2]);
      if (joint === 4) return 'Bip01 ' + side + ' Finger' + digit + 'Nub';
      return 'Bip01 ' + side + ' Finger' + digit + (joint === 1 ? '' : String(joint - 1));
    }
  }
  return null;
}

// Anything the table missed: match on the normalised tail of the S4 name.
function fuzzyMatch(mixamoName, s4Names) {
  const { side, rest } = splitSide(mixamoName);
  const want = (side ? side.toLowerCase() : '') + rest;
  let best = null, bestLen = 0;
  for (const n of s4Names) {
    const c = n.toLowerCase().replace(/^bip01/, '').replace(/[\s_]/g, '');
    if (!c) continue;
    if (c === want) return n;
  }
  return best;   // exact only: "contains" matched handring1 to hand
}

function buildMapping(mixamoNames, s4Names) {
  const s4Set = new Set(s4Names);
  const mapping = {}, unmatched = [], absent = [];
  for (const m of mixamoNames) {
    const direct = mixamoToS4(m);
    if (direct) {
      // The table knows what this bone is. If the target skeleton does not have
      // it, leave it alone: S4 has no ring or pinky, and falling back to fuzzy
      // matching here put all eight of those finger bones onto "Bip01 R Hand".
      if (s4Set.has(direct)) mapping[m] = direct; else absent.push(m);
      continue;
    }
    const fuzzy = fuzzyMatch(m, s4Names);
    if (fuzzy) mapping[m] = fuzzy; else unmatched.push(m);
  }
  return { mapping, unmatched, absent, matched: Object.keys(mapping).length };
}


// --- bind pose aware retargeting -------------------------------------------
//
// Copying a local rotation straight across only works when both skeletons rest
// in the same pose, and they do not: Mixamo rests in a T-pose with its own axes,
// S4 rests in its own. Copying the value bent the character in half.
//
// What transfers is the MOVEMENT away from rest, expressed in the target bone's
// own space:
//
//   delta   = inv(bindLocal_mx) * animLocal_mx      how far it moved, mixamo space
//   C       = inv(bindWorld_s4) * bindWorld_mx      how the two rest spaces differ
//   result  = bindLocal_s4 * (C * delta * inv(C))   same movement, S4 space
//
// The property that pins this down: feeding the rest pose back in must return
// the S4 rest pose untouched. test_mixamoRetarget checks exactly that.

const THREE = require('three');

const Q = (x, y, z, w) => new THREE.Quaternion(x, y, z, w);
// normalise on the way out: composing a chain of quaternions drifts, and a
// slightly long quaternion becomes a slight scale on the bone
const arrQ = q => { const n = q.clone().normalize(); return [n.x, n.y, n.z, n.w]; };

function eulerToQuat(rot) {
  const order = typeof rot[3] === 'string' ? rot[3] : 'XYZ';
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], order));
}

// S4 bone matrices are absolute and row-vector, the same layout Matrix4 uses
function matrixToQuat(m) {
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  new THREE.Matrix4().fromArray(m).decompose(t, q, s);
  return q;
}

// Mixamo bind: local TRS per bone, so world rotation is the chain of parents
function mixamoBindQuats(bindBones) {
  const byName = new Map(bindBones.map(b => [b.name, b]));
  const localQ = new Map(), worldQ = new Map();
  for (const b of bindBones) localQ.set(b.name, eulerToQuat(b.rotation || [0, 0, 0, 'XYZ']));

  const resolve = (name, depth) => {
    if (worldQ.has(name)) return worldQ.get(name);
    if (depth > 64) return new THREE.Quaternion();
    const b = byName.get(name);
    if (!b) return new THREE.Quaternion();
    const local = localQ.get(name) || new THREE.Quaternion();
    const parent = b.parent && byName.has(b.parent) ? resolve(b.parent, depth + 1) : new THREE.Quaternion();
    const w = parent.clone().multiply(local);
    worldQ.set(name, w);
    return w;
  };
  for (const b of bindBones) resolve(b.name, 0);
  return { localQ, worldQ };
}

// S4 bind: matrices are already world, local is world * inv(parentWorld)
function s4BindQuats(bones) {
  const byName = new Map(bones.map(b => [b.name, b]));
  const worldQ = new Map(), localQ = new Map();
  for (const b of bones) worldQ.set(b.name, matrixToQuat(b.matrix));
  for (const b of bones) {
    const w = worldQ.get(b.name);
    const p = b.parent && byName.has(b.parent) ? worldQ.get(b.parent) : null;
    localQ.set(b.name, p ? p.clone().invert().multiply(w) : w.clone());
  }
  return { localQ, worldQ };
}

// --- animation -------------------------------------------------------------

// Accepts { bones: { name: {rotation:[{t,q}]} } } or { animation: { bones } }.
// An array of bones is a bind pose export with no tracks in it.
function readTracks(mixamo) {
  if (!mixamo) return { tracks: {}, reason: 'no file loaded' };
  const b = mixamo.bones;
  if (Array.isArray(b)) {
    return { tracks: {}, reason: 'this file holds a bind pose only, no animation tracks (bones is an array)' };
  }
  if (b && typeof b === 'object') return { tracks: b, reason: null };
  if (mixamo.animation && mixamo.animation.bones) return { tracks: mixamo.animation.bones, reason: null };
  return { tracks: {}, reason: 'no bones object found' };
}

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) {
    const q = [0, 1, 2, 3].map(i => a[i] + (bb[i] - a[i]) * t);
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return q.map(v => v / l);
  }
  const th0 = Math.acos(d), th = th0 * t;
  const s0 = Math.sin(th0 - th) / Math.sin(th0), s1 = Math.sin(th) / Math.sin(th0);
  return [0, 1, 2, 3].map(i => a[i] * s0 + bb[i] * s1);
}

// value of a track at tick t, holding the ends
function sampleAt(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0].t) return keys[0].q.slice();
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.q.slice();
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].t < t) continue;
    const a = keys[i - 1], b = keys[i];
    const span = b.t - a.t;
    return slerp(a.q, b.q, span > 0 ? (t - a.t) / span : 0);
  }
  return last.q.slice();
}

// mirror across Z, the same conversion the pose editor uses
const mirror = q => [-q[0], -q[1], q[2], q[3]];


// Retarget in WORLD space, not in the bone's own space.
//
// The local-space version transferred "how much this bone rotated away from
// rest". That is only equivalent when both skeletons rest in the same physical
// posture, and they do not: Mixamo rests in a T-pose, S4 does not. The mismatch
// is then re-applied at every joint and compounds down the chain, which tilted
// the whole body forward and dropped the arms.
//
// What actually transfers is where the bone ENDS UP:
//
//   deltaWorld = animWorld_mx * inv(bindWorld_mx)     how it turned, in world
//   wantWorld  = deltaWorld * bindWorld_s4            S4 bone turned the same way
//   local      = inv(parentWantWorld_s4) * wantWorld  expressed for its parent
//
// Bones are walked parents first so parentWantWorld is ready when a child needs
// it. A bone with no track keeps its own animation, and its world is taken from
// what the clip already holds.

function topoOrder(bones) {
  const byName = new Map(bones.map(b => [b.name, b]));
  const seen = new Set(), out = [];
  const visit = (name, depth) => {
    if (depth > 64 || seen.has(name)) return;
    const b = byName.get(name);
    if (!b) return;
    if (b.parent && byName.has(b.parent)) visit(b.parent, depth + 1);
    if (seen.has(name)) return;
    seen.add(name);
    out.push(b);
  };
  for (const b of bones) visit(b.name, 0);
  return out;
}

// world rotation of every Mixamo bone at time t, composed down the hierarchy
function mixamoWorldAt(bindBones, tracks, mxBind, t) {
  const byName = new Map(bindBones.map(b => [b.name, b]));
  const world = new Map();
  for (const b of topoOrder(bindBones)) {
    const track = tracks[b.name];
    const keys = track && (track.rotation || track.rot);
    const sampled = keys && keys.length ? sampleAt(keys, t) : null;
    const local = sampled
      ? Q(sampled[0], sampled[1], sampled[2], sampled[3])
      : (mxBind.localQ.get(b.name) || new THREE.Quaternion()).clone();
    const parent = b.parent && world.has(b.parent) ? world.get(b.parent) : new THREE.Quaternion();
    world.set(b.name, parent.clone().multiply(local));
  }
  return world;
}


// --- direction matching ----------------------------------------------------
//
// This is the default, and it is measurably better. On Walk.fbx against clip
// 00008 the source bends the right knee 35.2 deg and the right elbow 16.2 deg;
// direction matching reproduces both exactly, copying rotations gives 29.5 and
// 11.5 - a fifth to a third of the bend lost at every joint, which is what
// half-folded limbs look like.
//
// Instead of copying rotations, look at where each bone ENDS UP and turn the S4
// bone so it points the same way. Copying rotations carries the difference
// between the two rest poses and the two axis conventions into every joint;
// pointing at a direction carries neither, because a direction is a direction
// in anybody's skeleton.
//
// It also ignores twist around the bone's own axis, which cannot be recovered
// from a direction. For limbs that is what you want: the elbow bends where the
// source bends and the forearm does not corkscrew.
//
// Bones are solved parents first, so a child is aimed after its parent has
// already moved.

// local offset of each bone from its parent, from the bind pose
function mixamoOffsets(bindBones) {
  const out = new Map();
  for (const b of bindBones) out.set(b.name, new THREE.Vector3().fromArray(b.position || [0, 0, 0]));
  return out;
}

function s4Offsets(bones) {
  const byName = new Map(bones.map(b => [b.name, b]));
  const out = new Map();
  for (const b of bones) {
    const w = new THREE.Vector3(b.matrix[12], b.matrix[13], b.matrix[14]);
    const p = b.parent && byName.has(b.parent) ? byName.get(b.parent) : null;
    if (!p) { out.set(b.name, w.clone()); continue; }
    const pw = new THREE.Vector3(p.matrix[12], p.matrix[13], p.matrix[14]);
    // offset expressed in the parent's own frame
    const pq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(p.matrix));
    out.set(b.name, w.clone().sub(pw).applyQuaternion(pq.clone().invert()));
  }
  return out;
}

// world positions of every Mixamo bone at one tick
function mixamoPositionsAt(bindBones, tracks, mxBind, offsets, t) {
  const byName = new Map(bindBones.map(b => [b.name, b]));
  const pos = new Map(), rot = new Map();
  for (const b of topoOrder(bindBones)) {
    const track = tracks[b.name];
    const keys = track && (track.rotation || track.rot);
    const sampled = keys && keys.length ? sampleAt(keys, t) : null;
    const local = sampled
      ? Q(sampled[0], sampled[1], sampled[2], sampled[3])
      : (mxBind.localQ.get(b.name) || new THREE.Quaternion()).clone();

    const parentRot = b.parent && rot.has(b.parent) ? rot.get(b.parent) : new THREE.Quaternion();
    const parentPos = b.parent && pos.has(b.parent) ? pos.get(b.parent) : new THREE.Vector3();
    const off = (offsets.get(b.name) || new THREE.Vector3()).clone().applyQuaternion(parentRot);
    rot.set(b.name, parentRot.clone().multiply(local));
    pos.set(b.name, parentPos.clone().add(off));
  }
  return { pos, rot };
}

// A fixed transform applied to the direction the source points in.
//
// flipZ is the default and it is not a guess: S4 is a DirectX game and so
// LEFT handed, which is why UnityScnTool imports its .scn files with no
// conversion at all (Unity is left handed too). An FBX out of Mixamo is RIGHT
// handed. Comparing directions between two skeletons of opposite handedness
// without converting is a mirror, not a rotation, which is why the walk came
// out reversed with the arms and feet swapped. Negating one axis converts
// between the two.
//
// The rest are here because an exporter can still lay its axes out differently,
// and trying one is faster than deriving it.
const ORIENTS = {
  none:    v => v,
  flipX:   v => v.set(-v.x, v.y, v.z),
  flipY:   v => v.set(v.x, -v.y, v.z),
  flipZ:   v => v.set(v.x, v.y, -v.z),
  swapXZ:  v => v.set(v.z, v.y, v.x),
  rotY90:  v => v.set(v.z, v.y, -v.x),
  rotY180: v => v.set(-v.x, v.y, -v.z),
  rotY270: v => v.set(-v.z, v.y, v.x),
  rotX90:  v => v.set(v.x, -v.z, v.y),
  rotX180: v => v.set(v.x, -v.y, -v.z),
  rotZ90:  v => v.set(-v.y, v.x, v.z),
  rotZ180: v => v.set(-v.x, -v.y, v.z),
};

// ---------------------------------------------------------------- alignment
//
// The two rigs do not stand in the same space. Measured on female_bip against a
// Mixamo skeleton, the direction a bone points at in one bind pose sits a median
// of 87 degrees away from the same bone in the other, and none of the twelve
// fixed axis swaps brings that below 87 - because the disagreement is per bone,
// not one global flip. Aiming an S4 bone at a Mixamo direction therefore bakes
// that difference into every frame, which is what folded the character forward
// while the source ran upright.
//
// So do not use the source's absolute direction. Use how far it has turned from
// its OWN bind pose, and carry that turn across. Then the per-bone difference
// cancels on both sides and only one unknown is left: how the two worlds sit
// relative to each other, which is a single rotation read off the bind poses.
//
// Up comes from hips to head, across from one arm to the other. Two directions
// are enough to pin a rotation, and both rigs have them.
function bindWorldPositions(bindBones) {
  const by = new Map(bindBones.map(b => [b.name, b]));
  const pos = new Map(), rot = new Map();
  for (const b of topoOrder(bindBones.map(x => ({ name: x.name, parent: x.parent })))) {
    const bone = by.get(b.name);
    const pq = bone.parent && rot.has(bone.parent) ? rot.get(bone.parent) : new THREE.Quaternion();
    const pp = bone.parent && pos.has(bone.parent) ? pos.get(bone.parent) : new THREE.Vector3();
    const local = bone.quaternion ? new THREE.Quaternion().fromArray(bone.quaternion)
                                  : (bone.rotation ? eulerToQuat(bone.rotation) : new THREE.Quaternion());
    rot.set(b.name, pq.clone().multiply(local));
    pos.set(b.name, pp.clone().add(new THREE.Vector3().fromArray(bone.position || [0, 0, 0]).applyQuaternion(pq)));
  }
  return pos;
}

// an orthonormal frame from an up and an across direction
function frameOf(up, across) {
  const u = up.clone().normalize();
  const r = across.clone().sub(u.clone().multiplyScalar(across.dot(u)));
  if (r.lengthSq() < 1e-12) return null;
  r.normalize();
  const f = new THREE.Vector3().crossVectors(u, r);
  return new THREE.Matrix3().set(r.x, u.x, f.x, r.y, u.y, f.y, r.z, u.z, f.z);
}

// Resample every mapped track onto the ticks the S4 clip already has.
// targetTicks comes from the clip, never invented, because keys cannot be added.
// Longest key time across every track: how long the source animation really is.
function sourceDuration(tracks) {
  let end = 0;
  for (const t of Object.values(tracks)) {
    const keys = t && (t.rotation || t.rot);
    if (keys && keys.length) end = Math.max(end, keys[keys.length - 1].t);
  }
  return end;
}

function retarget(mixamo, scnJson, clipName, opts) {
  // 'fit' stretches the source over the whole target clip, which is what you
  // want when replacing one animation with another. 'loop' repeats it instead,
  // for a cycle shorter than the clip. 'none' plays it once and freezes, which
  // is what used to happen by accident: the source running out mid clip and
  // every later key holding its last frame.
  // unmappedMode 'rest': a bone with no source that hangs off a bone that HAS one
  // is put back to its rest pose. S4 carries extra arm bones (Bip01_Arm_01L and
  // friends) that the clip animates and Mixamo has no equivalent for; leaving
  // their old animation under a parent driven by the new one is what bends the
  // arms. 'keep' is the old behaviour.
  // mirrorZ: the viewer draws with root.scale.z = -1, so the model is shown
  // reflected. A reflection reverses the handedness of every rotation, which
  // reads as walking backwards with the arms crossed. A quaternion cannot hold
  // a reflection, so it is applied by negating x and y, which is conjugation by
  // diag(1,1,-1).
  const options = Object.assign(
    { mapping: null, mixamoBind: null, timeMode: 'fit', unmappedMode: 'rest',
      mirrorZ: false, method: 'direction', orient: 'flipZ' },
    opts || {});
  const { tracks, reason } = readTracks(mixamo);
  if (reason) return { ok: false, error: reason, applied: 0 };

  const pose = (scnJson.pose && scnJson.clip === clipName) ? scnJson.pose : null;
  if (!pose) return { ok: false, error: 'the .scn json was not exported for clip "' + clipName + '"', applied: 0 };

  // The bind poses are what make this a retarget instead of a copy. Without the
  // Mixamo one there is nothing to measure the movement against.
  const bindBones = options.mixamoBind || (Array.isArray(mixamo.bind) ? mixamo.bind : null);
  if (!bindBones || !bindBones.length) {
    return { ok: false, error: 'no Mixamo bind pose: without it the rotations are copied raw and the model bends apart', applied: 0 };
  }
  if (!Array.isArray(scnJson.bones) || !scnJson.bones.length) {
    return { ok: false, error: 'the .scn json carries no bones, cannot read the S4 bind pose', applied: 0 };
  }

  const mxBind = mixamoBindQuats(bindBones);
  const s4Bind = s4BindQuats(scnJson.bones);

  const s4Names = scnJson.bones.map(b => b.name);
  let map = options.mapping;
  if (!map && options.boneMapText) {
    // a .bmap from the S4 tooling is authoritative: it knows Hips belongs on
    // Bip01 and which bones are meant to stay unmapped
    const { parseBoneMap, applyBoneMap } = require('./boneMap');
    map = applyBoneMap(parseBoneMap(options.boneMapText), Object.keys(tracks), s4Names).mapping;
  }
  if (!map) map = buildMapping(Object.keys(tracks), s4Names).mapping;
  const s4ByName = new Map(scnJson.bones.map(b => [b.name, b]));

  // every tick the clip holds, and the S4 bones in parent-first order
  const ticks = new Set();
  for (const n of Object.values(map)) {
    const p = pose[n];
    if (p && p.rot) for (const k of p.rot) ticks.add(k.t);
  }
  // the WHOLE skeleton, parents first. Filtering to bones present in the clip
  // would orphan a child whose parent is missing, and its world rotation would
  // then be written as if it were a local one.
  const order = topoOrder(scnJson.bones);
  const targets = new Set(Object.values(map));
  const mixOf = new Map(Object.entries(map).map(([mx, s4]) => [s4, mx]));

  let keysWritten = 0;
  const touched = new Set(), skipped = [], restored = new Set();

  // bones with no source that sit below one that has a source
  const s4Parent = new Map(scnJson.bones.map(b => [b.name, b.parent]));
  const underRetarget = new Set();
  for (const b of order) {
    if (targets.has(b.name)) continue;
    let cur = s4Parent.get(b.name), hops = 0;
    while (cur && hops++ < 64) {
      if (targets.has(cur)) { underRetarget.add(b.name); break; }
      cur = s4Parent.get(cur);
    }
  }

  const sortedTicks = [...ticks].sort((a, b) => a - b);
  const clipEnd = sortedTicks.length ? sortedTicks[sortedTicks.length - 1] : 0;
  const srcTotal = options.duration || sourceDuration(tracks);

  // Only part of the loaded animation may be wanted: a Mixamo download is
  // often a run-up, the motion, and a settle. srcFrom/srcTo cut that down to
  // the piece worth keeping, and everything downstream sees only the piece.
  const srcFrom = Math.max(0, Math.min(options.srcFrom || 0, srcTotal));
  const srcTo = options.srcTo > srcFrom ? Math.min(options.srcTo, srcTotal) : srcTotal;
  const srcSpan = srcTo - srcFrom;

  const sourceTime = t => {
    if (!srcSpan || !clipEnd) return t;
    if (options.timeMode === 'fit') return srcFrom + t * (srcSpan / clipEnd);
    if (options.timeMode === 'loop') return srcFrom + (t % srcSpan);
    return srcFrom + Math.min(t, srcSpan);
  };

  // for direction matching: the first mapped child of each mapped bone, and the
  // rest-pose offset that reaches it
  const dirChild = new Map();
  if (options.method === 'direction') {
    const offS4 = s4Offsets(scnJson.bones);
    for (const b of scnJson.bones) {
      if (!b.parent || !targets.has(b.parent) || !targets.has(b.name)) continue;
      if (dirChild.has(b.parent)) continue;
      dirChild.set(b.parent, { s4: b.name, mix: mixOf.get(b.name), offset: offS4.get(b.name) || new THREE.Vector3() });
    }
  }
  const offMx = options.method === 'direction' ? mixamoOffsets(bindBones) : null;

  // How far each pair disagrees at rest, as a rotation from where the source
  // bone points to where the S4 one does. Worked out once, from the two bind
  // poses, with the same axis fix the animation gets so the two are comparable.
  if (offMx) {
    const mxRest = bindWorldPositions(bindBones);
    const s4Rest = new Map(scnJson.bones.map(b =>
      [b.name, new THREE.Vector3(b.matrix[12], b.matrix[13], b.matrix[14])]));
    for (const [parent, kid] of dirChild) {
      const mp = mxRest.get(mixOf.get(parent)), mc = mxRest.get(kid.mix);
      const sp = s4Rest.get(parent), sc = s4Rest.get(kid.s4);
      if (!mp || !mc || !sp || !sc) continue;
      const src = mc.clone().sub(mp), dst = sc.clone().sub(sp);
      if (src.lengthSq() < 1e-12 || dst.lengthSq() < 1e-12) continue;
      if (options.mirrorZ) src.z = -src.z;
      (ORIENTS[options.orient] || ORIENTS.none)(src);
      kid.bindTurn = new THREE.Quaternion().setFromUnitVectors(src.normalize(), dst.normalize());
    }
  }

  for (const t of sortedTicks) {
    const mxWorld = mixamoWorldAt(bindBones, tracks, mxBind, sourceTime(t));
    const mxPos = offMx
      ? mixamoPositionsAt(bindBones, tracks, mxBind, offMx, sourceTime(t))
      : { pos: new Map() };
    const wantWorld = new Map();

    for (const bone of order) {
      const s4Name = bone.name;
      const bindWorldS4 = s4Bind.worldQ.get(s4Name);
      const parentWant = bone.parent && wantWorld.has(bone.parent) ? wantWorld.get(bone.parent) : null;
      const mixName = mixOf.get(s4Name);
      const p = pose[s4Name];

      // nothing maps onto this bone
      if (!targets.has(s4Name) || !mixName || !mxWorld.has(mixName) || !bindWorldS4) {
        const rest = (s4Bind.localQ.get(s4Name) || new THREE.Quaternion()).clone();
        const driven = options.unmappedMode === 'rest' && underRetarget.has(s4Name);
        const own = driven
          ? rest
          : (p && p.rot && p.rot.length
              ? (function () { const k = p.rot.find(k2 => k2.t === t) || p.rot[0]; return Q(k.q[0], k.q[1], k.q[2], k.q[3]); })()
              : rest);
        wantWorld.set(s4Name, (parentWant ? parentWant.clone() : new THREE.Quaternion()).multiply(own));

        // and write it, otherwise the clip's own keys keep fighting the parent
        if (driven && p && p.rot) {
          const key = p.rot.find(k2 => k2.t === t);
          if (key) { key.q = arrQ(rest); keysWritten++; restored.add(s4Name); }
        }
        continue;
      }

      let want;
      if (options.method === 'direction' && dirChild.has(s4Name)) {
        // aim this bone so its mapped child sits where the source child sits
        const kid = dirChild.get(s4Name);
        const srcFrom = mxPos.pos.get(mixName);
        const srcTo = mxPos.pos.get(kid.mix);
        const restWorld = (parentWant ? parentWant.clone() : new THREE.Quaternion()).multiply(s4Bind.localQ.get(s4Name));
        const have = kid.offset.clone().applyQuaternion(restWorld);
        if (srcFrom && srcTo && have.lengthSq() > 1e-12) {
          const wantDir = srcTo.clone().sub(srcFrom);
          if (options.mirrorZ) wantDir.z = -wantDir.z;
          (ORIENTS[options.orient] || ORIENTS.none)(wantDir);
          // The two rigs do not always agree on where a bone points at rest.
          // Measured on female_bip against Mixamo the median disagreement is 9
          // degrees, which is nothing, but the toe nub sits at 179 and the foot
          // at 84. Aiming straight at the source direction there flips the bone
          // end for end - the bent sole, the twisted feet. Correcting by the
          // rest difference leaves the agreeing bones untouched and unflips the
          // rest, and a source at rest now gives the rest pose exactly.
          if (kid.bindTurn) wantDir.applyQuaternion(kid.bindTurn);
          if (wantDir.lengthSq() > 1e-12) {
            const turn = new THREE.Quaternion().setFromUnitVectors(
              have.clone().normalize(), wantDir.clone().normalize());
            want = turn.multiply(restWorld);
          }
        }
        if (!want) want = rotationWant();
      } else {
        want = rotationWant();
      }

      // Copying the rotation is the fallback for a bone that cannot be aimed:
      // one with no mapped child. The root is exactly that here - the .bmap
      // sends Hips to Bip01, whose children (Pelvis, Footsteps) are unmapped -
      // and leaving the root at rest while the body moves leaves the character
      // sitting back. Same for leaf bones: head, toes, finger tips.
      function rotationWant() {
        let deltaWorld = mxWorld.get(mixName).clone().multiply(mxBind.worldQ.get(mixName).clone().invert());
        if (options.mirrorZ) deltaWorld = Q(-deltaWorld.x, -deltaWorld.y, deltaWorld.z, deltaWorld.w);
        return deltaWorld.multiply(bindWorldS4);
      }
      wantWorld.set(s4Name, want);

      const key = p && p.rot ? p.rot.find(k2 => k2.t === t) : null;
      if (!key) continue;
      const local = parentWant ? parentWant.clone().invert().multiply(want) : want.clone();
      key.q = arrQ(local);
      keysWritten++;
      touched.add(s4Name);
    }
  }

  for (const mixName of Object.keys(map)) {
    if (!touched.has(map[mixName])) skipped.push(mixName);
  }

  return {
    ok: true, applied: touched.size, keysWritten, skipped,
    bones: Object.keys(map).length,
    restored: restored.size,
    sourceMs: srcSpan, sourceTotalMs: srcTotal, srcFrom, srcTo,
    clipMs: clipEnd, timeMode: options.timeMode, method: options.method,
  };
}

module.exports = { ORIENTS, bindWorldPositions, sourceDuration, mixamoBindQuats, s4BindQuats, mixamoToS4, buildMapping, fuzzyMatch, readTracks, retarget, sampleAt, slerp, mirror, SYNONYMS, LIMBS, FINGERS };
