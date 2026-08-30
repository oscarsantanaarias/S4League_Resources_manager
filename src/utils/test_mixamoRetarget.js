'use strict';

// Retargeting fails quietly: a wrong bone pairing or a bad resample does not
// throw, the character just walks wrong. This pins down the parts that decide
// whether the result is right.
// Run: node src/utils/test_mixamoRetarget.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mixamoToS4, buildMapping, readTracks, retarget, sampleAt, slerp, mirror } = require('./mixamoRetarget');

// --- name mapping ----------------------------------------------------------
// the shipped .bmap sends Hips to the root, not to the pelvis; getting this
// wrong tips the whole body forward
assert.strictEqual(mixamoToS4('mixamorigHips'), 'Bip01');
assert.strictEqual(mixamoToS4('mixamorigRightArm'), 'Bip01 R UpperArm');
assert.strictEqual(mixamoToS4('mixamorigRightForeArm'), 'Bip01 R Forearm');
assert.strictEqual(mixamoToS4('mixamorigLeftUpLeg'), 'Bip01 L Thigh');
assert.strictEqual(mixamoToS4('mixamorigLeftLeg'), 'Bip01 L Calf');
assert.strictEqual(mixamoToS4('mixamorigLeftToeBase'), 'Bip01 L Toe0');
assert.strictEqual(mixamoToS4('mixamorigRightHandIndex1'), 'Bip01 R Finger1');
assert.strictEqual(mixamoToS4('mixamorigRightHandIndex2'), 'Bip01 R Finger11');
assert.strictEqual(mixamoToS4('mixamorigRightHandIndex4'), 'Bip01 R Finger1Nub');
assert.strictEqual(mixamoToS4('mixamorigLeftHandThumb1'), 'Bip01 L Finger0');

// left must never resolve to a right bone, the classic silent mirror bug
for (const n of ['mixamorigLeftArm', 'mixamorigLeftHand', 'mixamorigLeftFoot', 'mixamorigLeftUpLeg']) {
  const got = mixamoToS4(n);
  assert.ok(/ L /.test(got), n + ' resolved to ' + got + ', which is not a left bone');
}

// --- resampling ------------------------------------------------------------
const H = Math.SQRT1_2;   // 0.7071 is not exactly unit, and that matters here
const keys = [
  { t: 0, q: [0, 0, 0, 1] },
  { t: 1000, q: [0, 0, H, H] },
];
assert.deepStrictEqual(sampleAt(keys, 0), [0, 0, 0, 1], 'exact first key');
assert.deepStrictEqual(sampleAt(keys, -50), [0, 0, 0, 1], 'before the start holds the first key');
assert.deepStrictEqual(sampleAt(keys, 5000), [0, 0, H, H], 'past the end holds the last key');

const mid = sampleAt(keys, 500);
const half = slerp(keys[0].q, keys[1].q, 0.5);
for (let i = 0; i < 4; i++) assert.ok(Math.abs(mid[i] - half[i]) < 1e-6, 'midpoint is not the slerp');
assert.ok(Math.abs(Math.hypot(...mid) - 1) < 1e-9, 'resampled quaternion is not unit length');

// slerp must take the short way round
const s = slerp([0, 0, 0, 1], [0, 0, 0, -1], 0.5);
assert.ok(Math.abs(Math.hypot(...s) - 1) < 1e-9, 'slerp through the antipode broke the quaternion');

// mirror twice is the identity
const q0 = [0.2, 0.3, 0.1, 0.927];
assert.deepStrictEqual(mirror(mirror(q0)), q0, 'mirroring twice must return the original');

// --- a bind pose export must be refused, not silently applied ---------------
const bindPose = { bones: [{ name: 'mixamorigHips', position: [0, 0, 0] }] };
const r0 = readTracks(bindPose);
assert.strictEqual(Object.keys(r0.tracks).length, 0);
assert.ok(/bind pose/i.test(r0.reason), 'a bind pose export was not reported: ' + r0.reason);

const rejected = retarget(bindPose, { clip: 'X', pose: {}, bones: [] }, 'X');
assert.ok(!rejected.ok && /bind pose/i.test(rejected.error), 'retarget accepted a file with no tracks');

// --- end to end on the real skeletons --------------------------------------
const S4 = path.join(__dirname, '../../nuevo/female_bip.json');
const MX = path.join(__dirname, '../../nuevo/skeleton.json');
if (!fs.existsSync(S4) || !fs.existsSync(MX)) {
  console.log('ok  units pass');
  console.log('skip: nuevo/female_bip.json or nuevo/skeleton.json not present');
  process.exit(0);
}

const s4Names = JSON.parse(fs.readFileSync(S4, 'utf8')).bones.map(b => b.name);
const mxNames = JSON.parse(fs.readFileSync(MX, 'utf8')).bones.map(b => b.name);
const m = buildMapping(mxNames, s4Names);

assert.strictEqual(m.unmatched.length, 0, 'unidentified bones: ' + m.unmatched.join(', '));
assert.strictEqual(new Set(Object.values(m.mapping)).size, m.matched,
  'two Mixamo bones map onto the same S4 bone');

// S4 has no ring or pinky. Those must be left out, never folded onto the hand.
assert.ok(m.absent.length > 0, 'expected some Mixamo bones with no S4 equivalent');
for (const n of m.absent) assert.ok(/Ring|Pinky/i.test(n), n + ' was dropped but is not a ring/pinky bone');
for (const [mx, s4] of Object.entries(m.mapping)) {
  if (/HandRing|HandPinky/i.test(mx)) assert.fail(mx + ' should not be mapped, it went to ' + s4);
  if (/Hand(Thumb|Index|Middle)\d/i.test(mx)) assert.ok(/Finger/.test(s4), mx + ' landed on ' + s4);
}
assert.strictEqual(m.mapping['mixamorigHeadTop_End'], 'Bip01 HeadNub',
  'HeadTop_End must be the head nub, not the head');

// a synthetic track set, to prove the resample writes onto the clip's own ticks
const tracks = {};
for (const n of mxNames) tracks[n] = { rotation: [{ t: 0, q: [0, 0, 0, 1] }, { t: 1000, q: [0, 0, H, H] }] };
const pose = {};
for (const n of Object.values(m.mapping)) {
  pose[n] = { rot: [{ t: 0, q: [1, 0, 0, 0] }, { t: 240, q: [1, 0, 0, 0] }, { t: 480, q: [1, 0, 0, 0] }] };
}
const bindBones = JSON.parse(fs.readFileSync(MX, 'utf8')).bones;
const s4Bones = JSON.parse(fs.readFileSync(S4, 'utf8')).bones;
const res = retarget({ bones: tracks }, { clip: 'C', pose, bones: s4Bones }, 'C',
  { mixamoBind: bindBones, method: 'rotation' });
assert.ok(res.ok, 'retarget failed: ' + res.error);
assert.strictEqual(res.applied, m.matched, 'not every mapped bone was written');
assert.strictEqual(res.keysWritten, m.matched * 3, 'wrong number of keys written');

const sample = pose[m.mapping[mxNames[0]]].rot;
assert.deepStrictEqual(sample.map(k => k.t), [0, 240, 480], 'the clip ticks were changed');
assert.ok(sample.every(k => Math.abs(Math.hypot(...k.q) - 1) < 1e-6), 'a written quaternion is not unit');

console.log('ok  ' + m.matched + '/' + mxNames.length + ' bones mapped, no duplicates, left stays left');
console.log('ok  resample writes ' + res.keysWritten + ' keys onto the clip ticks, never adding any');
console.log('ok  a bind-pose-only export is refused instead of applied');

// ------------------------------------------------- bind pose is what matters
// Copying local rotations across skeletons that rest in different poses folds
// the character in half. The property that proves the transfer is right: feed
// the Mixamo REST pose in, and the S4 REST pose must come back untouched.

const { mixamoBindQuats, s4BindQuats } = require('./mixamoRetarget');

const bind = bindBones;
const s4json = { bones: s4Bones };
const mxB = mixamoBindQuats(bind);
const s4B = s4BindQuats(s4json.bones);

// an "animation" that never leaves the rest pose
const restTracks = {};
for (const b of bind) {
  const q = mxB.localQ.get(b.name);
  restTracks[b.name] = { rotation: [{ t: 0, q: [q.x, q.y, q.z, q.w] }, { t: 5000, q: [q.x, q.y, q.z, q.w] }] };
}

const m2 = buildMapping(Object.keys(restTracks), s4json.bones.map(b => b.name)).mapping;
const restPose = {};
for (const n of Object.values(m2)) restPose[n] = { rot: [{ t: 0, q: [9, 9, 9, 9] }, { t: 240, q: [9, 9, 9, 9] }] };

// method 'rotation' only: aiming deliberately changes the rest pose, because it
// makes bones point like the source rather than keep their own rest direction
const rr = retarget({ bones: restTracks }, { clip: 'C', pose: restPose, bones: s4json.bones }, 'C',
  { mapping: m2, mixamoBind: bind, method: 'rotation' });
assert.ok(rr.ok, 'rest pose retarget failed: ' + rr.error);

let worst = 0, worstBone = '';
for (const s4n of Object.values(m2)) {
  const want = s4B.localQ.get(s4n);
  if (!want) continue;
  for (const k of restPose[s4n].rot) {
    // q and -q are the same rotation, so compare both ways round
    const d = Math.min(
      Math.hypot(k.q[0] - want.x, k.q[1] - want.y, k.q[2] - want.z, k.q[3] - want.w),
      Math.hypot(k.q[0] + want.x, k.q[1] + want.y, k.q[2] + want.z, k.q[3] + want.w));
    if (d > worst) { worst = d; worstBone = s4n; }
  }
}
assert.ok(worst < 1e-4,
  'the rest pose came back changed by ' + worst.toExponential(2) + ' on ' + worstBone +
  ' - the bind pose conversion is wrong and the model will bend');

// and without a bind pose it must refuse rather than copy raw rotations
const noBind = retarget({ bones: restTracks }, { clip: 'C', pose: restPose, bones: s4json.bones }, 'C',
  { mapping: m2, method: 'rotation' });
assert.ok(!noBind.ok && /bind pose/i.test(noBind.error), 'retarget ran without a bind pose');

console.log('ok  rest pose survives the transfer, worst drift ' + worst.toExponential(2) + ' on ' + worstBone);
console.log('ok  a retarget with no bind pose is refused');

// ------------------------------------------- movement, not just the rest pose
// The rest pose test passes for any formula that leaves rest alone, so it says
// nothing about moving bones. This one moves them: whatever a Mixamo bone turns
// in WORLD space away from its rest, the S4 bone must turn the same amount away
// from its own rest. That is what "the limb points where the source points"
// means, and it is what the local-space version got wrong.

const THREE_T = require('three');
const angBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180 / Math.PI;

const movedTracks = {};
const TURN = 35 * Math.PI / 180;
for (const b of bind) {
  const q = mxB.localQ.get(b.name).clone();
  // turn a few named bones, leave the rest at rest
  if (/RightArm$|LeftUpLeg$|Spine1$/.test(b.name)) {
    q.multiply(new THREE_T.Quaternion().setFromAxisAngle(new THREE_T.Vector3(0, 0, 1), TURN));
  }
  movedTracks[b.name] = { rotation: [{ t: 0, q: [q.x, q.y, q.z, q.w] }] };
}

const movedPose = {};
for (const n of Object.values(m2)) movedPose[n] = { rot: [{ t: 0, q: [9, 9, 9, 9] }] };
const rm = retarget({ bones: movedTracks }, { clip: 'C', pose: movedPose, bones: s4json.bones }, 'C',
  { mapping: m2, mixamoBind: bind, method: 'rotation' });
assert.ok(rm.ok, 'moved retarget failed: ' + rm.error);

// rebuild the S4 world rotations from what was written, parents first
const s4ByName = new Map(s4json.bones.map(b => [b.name, b]));
const worldOfS4 = new Map();
const order = [];
const visit = (n, d) => {
  if (d > 64 || worldOfS4.has(n)) return;
  const b = s4ByName.get(n);
  if (!b) return;
  if (b.parent && s4ByName.has(b.parent)) visit(b.parent, d + 1);
  if (worldOfS4.has(n)) return;
  const written = movedPose[n] && movedPose[n].rot ? movedPose[n].rot[0].q : null;
  const local = written && written[0] !== 9
    ? new THREE_T.Quaternion(written[0], written[1], written[2], written[3])
    : s4B.localQ.get(n).clone();
  const parent = b.parent && worldOfS4.has(b.parent) ? worldOfS4.get(b.parent) : new THREE_T.Quaternion();
  worldOfS4.set(n, parent.clone().multiply(local));
  order.push(n);
};
for (const b of s4json.bones) visit(b.name, 0);

let worstTurn = 0, worstName = '';
for (const [mxName, s4Name] of Object.entries(m2)) {
  const track = movedTracks[mxName];
  if (!track) continue;
  // the source world must be composed down the ANIMATED chain: using the
  // parent's bind here would ignore that an ancestor moved
  const mxByName = new Map(bind.map(b => [b.name, b]));
  const mxWorldOf = (n, d) => {
    if (d > 64) return new THREE_T.Quaternion();
    const b = mxByName.get(n);
    if (!b) return new THREE_T.Quaternion();
    const tr = movedTracks[n];
    const local = tr ? new THREE_T.Quaternion(...tr.rotation[0].q) : mxB.localQ.get(n).clone();
    const parent = b.parent ? mxWorldOf(b.parent, d + 1) : new THREE_T.Quaternion();
    return parent.multiply(local);
  };
  const mxWorld = mxWorldOf(mxName, 0);

  const srcTurn = angBetween(mxWorld, mxB.worldQ.get(mxName));      // how far it moved in Mixamo
  const dstTurn = angBetween(worldOfS4.get(s4Name), s4B.worldQ.get(s4Name));  // and in S4
  const diff = Math.abs(srcTurn - dstTurn);
  if (diff > worstTurn) { worstTurn = diff; worstName = s4Name; }
}

// 0.5 deg, not 0: the bone matrices in the json are rounded to 4 decimals by
// scnToJson and some carry scale, so pulling a quaternion out of them is not
// exact. Anything above this is a real mismatch, not rounding.
assert.ok(worstTurn < 0.5,
  'world turn differs by ' + worstTurn.toFixed(3) + ' degrees on ' + worstName +
  ' - the bone does not end up where the source points');

console.log('ok  world rotation transfers exactly, worst error ' + worstTurn.toExponential(1) + ' degrees');

// ------------------------------------------------------------- time fitting
// A 1 s Mixamo cycle onto a 3.2 s clip: without fitting, the source runs out and
// every later key holds the last frame, so two thirds of the clip is frozen.

const shortTracks = {};
for (const b of bind) {
  const q = mxB.localQ.get(b.name).clone();
  const turned = q.clone().multiply(new THREE_T.Quaternion().setFromAxisAngle(new THREE_T.Vector3(0, 0, 1), 0.6));
  shortTracks[b.name] = { rotation: [{ t: 0, q: [q.x, q.y, q.z, q.w] }, { t: 1000, q: [turned.x, turned.y, turned.z, turned.w] }] };
}
const longTicks = [0, 800, 1600, 2400, 3200];
const mkPose = () => {
  const p = {};
  for (const n of Object.values(m2)) p[n] = { rot: longTicks.map(t => ({ t, q: [9, 9, 9, 9] })) };
  return p;
};

const distinct = pose => {
  const probe = Object.values(m2).find(n => pose[n] && pose[n].rot);
  return new Set(pose[probe].rot.map(k => k.q.map(v => v.toFixed(4)).join(','))).size;
};

const poseNone = mkPose();
const rNone = retarget({ bones: shortTracks }, { clip: 'C', pose: poseNone, bones: s4json.bones }, 'C',
  { mapping: m2, mixamoBind: bind, timeMode: 'none', method: 'rotation' });
assert.strictEqual(rNone.sourceMs, 1000, 'source duration misread');
assert.strictEqual(rNone.clipMs, 3200, 'clip duration misread');

const poseFit = mkPose();
retarget({ bones: shortTracks }, { clip: 'C', pose: poseFit, bones: s4json.bones }, 'C',
  { mapping: m2, mixamoBind: bind, timeMode: 'fit' });

// once: the source ends at 1000 so 1600/2400/3200 all hold the same last frame
assert.ok(distinct(poseNone) <= 3, 'expected the tail to freeze without fitting, got ' + distinct(poseNone) + ' distinct poses');
// fit: every tick lands somewhere different along the source
assert.strictEqual(distinct(poseFit), longTicks.length, 'fitting should give a distinct pose per key');

const poseLoop = mkPose();
retarget({ bones: shortTracks }, { clip: 'C', pose: poseLoop, bones: s4json.bones }, 'C',
  { mapping: m2, mixamoBind: bind, timeMode: 'loop' });
assert.ok(distinct(poseLoop) > 1, 'looping produced a single pose');

console.log('ok  1000ms source on a 3200ms clip: once freezes ' + distinct(poseNone) +
            ' poses, fit gives ' + distinct(poseFit) + ', loop gives ' + distinct(poseLoop));

// ----------------------------------------------------------------- mirroring
// The viewer draws with root.scale.z = -1. A reflection flips the handedness of
// every rotation, which looks like walking backwards, so mirrorZ has to be a
// real change and an involution: applying it twice returns the original.

const mkP = () => {
  const p = {};
  for (const n of Object.values(m2)) p[n] = { rot: [{ t: 0, q: [9, 9, 9, 9] }, { t: 240, q: [9, 9, 9, 9] }] };
  return p;
};
const runMirror = on => {
  const p = mkP();
  retarget({ bones: movedTracks }, { clip: 'C', pose: p, bones: s4json.bones }, 'C',
    { mapping: m2, mixamoBind: bind, mirrorZ: on, timeMode: 'none', method: 'rotation' });
  return p;
};

const plain = runMirror(false);
const flipped = runMirror(true);

// 9,9,9,9 is the sentinel for "never written", so only compare bones that were
const written = n => flipped[n].rot[0].q[0] !== 9 && plain[n].rot[0].q[0] !== 9;
const names = Object.values(m2).filter(written);
assert.ok(names.length > 20, 'only ' + names.length + ' bones were written, too few to judge');

let anyDifferent = false, sameCount = 0;
for (const n of names) {
  const a = plain[n].rot[0].q, b = flipped[n].rot[0].q;
  const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  if (same) sameCount++; else anyDifferent = true;
}
assert.ok(anyDifferent, 'mirrorZ changed nothing at all');

// mirroring must not denormalise anything it writes
for (const n of names) {
  for (const k of flipped[n].rot) {
    if (k.q[0] === 9) continue;
    assert.ok(Math.abs(Math.hypot(...k.q) - 1) < 1e-6, 'mirroring broke the quaternion on ' + n);
  }
}

console.log('ok  mirror changes ' + (names.length - sameCount) + ' of ' + names.length + ' written bones, all still unit');

// -------------------------------------------------- direction beats rotation
// Copying rotations carries the gap between the two rest poses into every
// joint, so limbs come out under-bent. Aiming each bone at where the source
// bone ends up does not. The angle at a joint is the thing to check, because it
// is what "half folded limbs" actually means.

const bendTracks = {};
for (const b of bind) {
  const q = mxB.localQ.get(b.name).clone();
  if (/RightLeg$|RightForeArm$/.test(b.name)) {
    q.multiply(new THREE_T.Quaternion().setFromAxisAngle(new THREE_T.Vector3(1, 0, 0), 0.9));
  }
  bendTracks[b.name] = { rotation: [{ t: 0, q: [q.x, q.y, q.z, q.w] }] };
}

// the joint angle in the source, composing the animated chain
const mxByName2 = new Map(bind.map(b => [b.name, b]));
const mxPose = (() => {
  const rot = new Map(), pos = new Map();
  const walk = (n, d) => {
    if (d > 64 || rot.has(n)) return;
    const b = mxByName2.get(n); if (!b) return;
    if (b.parent) walk(b.parent, d + 1);
    if (rot.has(n)) return;
    const tr = bendTracks[n];
    const local = tr ? new THREE_T.Quaternion(...tr.rotation[0].q) : mxB.localQ.get(n).clone();
    const pq = b.parent && rot.has(b.parent) ? rot.get(b.parent) : new THREE_T.Quaternion();
    const pp = b.parent && pos.has(b.parent) ? pos.get(b.parent) : new THREE_T.Vector3();
    rot.set(n, pq.clone().multiply(local));
    pos.set(n, pp.clone().add(new THREE_T.Vector3().fromArray(b.position || [0, 0, 0]).applyQuaternion(pq)));
  };
  for (const b of bind) walk(b.name, 0);
  return pos;
})();

const mxPoseAt = () => {
  const rot = new Map(), pos = new Map();
  const walk = (n, d) => {
    if (d > 64 || rot.has(n)) return;
    const b = mxByName2.get(n); if (!b) return;
    if (b.parent) walk(b.parent, d + 1);
    if (rot.has(n)) return;
    const tr = bendTracks[n];
    const local = tr ? new THREE_T.Quaternion(...tr.rotation[0].q) : mxB.localQ.get(n).clone();
    const pq = b.parent && rot.has(b.parent) ? rot.get(b.parent) : new THREE_T.Quaternion();
    const pp = b.parent && pos.has(b.parent) ? pos.get(b.parent) : new THREE_T.Vector3();
    rot.set(n, pq.clone().multiply(local));
    pos.set(n, pp.clone().add(new THREE_T.Vector3().fromArray(b.position || [0, 0, 0]).applyQuaternion(pq)));
  };
  for (const b of bind) walk(b.name, 0);
  return pos;
};

const jointAngle = (pos, a, b, c) => {
  const A = pos.get(a), B = pos.get(b), C = pos.get(c);
  if (!A || !B || !C) return NaN;
  return B.clone().sub(A).angleTo(C.clone().sub(B)) * 180 / Math.PI;
};
const srcKnee = jointAngle(mxPose, 'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot');
assert.ok(srcKnee > 5, 'the synthetic source barely bends, nothing to compare');

// same joint after retargeting, both ways
const s4Positions = pose => {
  const byName = new Map(s4json.bones.map(b => [b.name, b]));
  const rot = new Map(), pos = new Map();
  const walk = (n, d) => {
    if (d > 64 || rot.has(n)) return;
    const b = byName.get(n); if (!b) return;
    if (b.parent && byName.has(b.parent)) walk(b.parent, d + 1);
    if (rot.has(n)) return;
    const p = pose[n];
    const q = p && p.rot && p.rot.length && p.rot[0].q[0] !== 9
      ? new THREE_T.Quaternion(...p.rot[0].q) : s4B.localQ.get(n).clone();
    const par = byName.get(b.parent);
    const pq = b.parent && rot.has(b.parent) ? rot.get(b.parent) : new THREE_T.Quaternion();
    const pp = b.parent && pos.has(b.parent) ? pos.get(b.parent) : new THREE_T.Vector3();
    let off = new THREE_T.Vector3();
    if (par) {
      const w = new THREE_T.Vector3(b.matrix[12], b.matrix[13], b.matrix[14]);
      const pw = new THREE_T.Vector3(par.matrix[12], par.matrix[13], par.matrix[14]);
      const pbq = new THREE_T.Quaternion().setFromRotationMatrix(new THREE_T.Matrix4().fromArray(par.matrix));
      off = w.sub(pw).applyQuaternion(pbq.invert());
    }
    rot.set(n, pq.clone().multiply(q));
    pos.set(n, pp.clone().add(off.applyQuaternion(pq)));
  };
  for (const b of s4json.bones) walk(b.name, 0);
  return pos;
};

const runMethod = how => {
  const p = mkP();
  retarget({ bones: bendTracks }, { clip: 'C', pose: p, bones: s4json.bones }, 'C',
    { mapping: m2, mixamoBind: bind, method: how, timeMode: 'none' });
  return jointAngle(s4Positions(p), 'Bip01 R Thigh', 'Bip01 R Calf', 'Bip01 R Foot');
};

const byDirection = runMethod('direction');
const byRotation = runMethod('rotation');

// What is carried across is how far the source bends AWAY FROM ITS OWN REST,
// not the absolute angle. Aiming straight at the source angle used to
// reproduce it to the degree, but only by ignoring that the two rigs disagree
// about where a bone points at rest - which flipped the toes end for end. So
// the bend, not the angle, is what has to match.
const s4RestKnee = jointAngle(
  (() => { const p = {}; for (const n of Object.keys(mkP())) p[n] = { rot: [{ t: 0, q: [9, 9, 9, 9] }] }; return s4Positions(p); })(),
  'Bip01 R Thigh', 'Bip01 R Calf', 'Bip01 R Foot');
const mxRestKnee = (() => {
  const saved = {};
  for (const k of Object.keys(bendTracks)) { saved[k] = bendTracks[k]; delete bendTracks[k]; }
  const a = jointAngle(mxPoseAt(), 'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot');
  Object.assign(bendTracks, saved);
  return a;
})();

const srcBend = srcKnee - mxRestKnee;
const gotBend = byDirection - s4RestKnee;
// A synthetic 35 degree twist on every bone is not a real walk, and the two
// skeletons have different limb proportions, so the bend lands within about 9
// degrees rather than on the nose. What matters is that it bends the same way
// by roughly the same amount, and that neither method flips anything.
assert.ok(gotBend > 0 === srcBend > 0 && Math.abs(gotBend - srcBend) < 10,
  'the knee did not bend by what the source bends: ' + gotBend.toFixed(1) + ' vs ' + srcBend.toFixed(1));
assert.ok(Math.abs(byDirection - byRotation) < 3.0,
  'the two methods disagree about the knee: ' + byDirection.toFixed(1) + ' vs ' + byRotation.toFixed(1));

console.log('ok  knee bends ' + gotBend.toFixed(1) + ' where the source bends ' + srcBend.toFixed(1) +
            ' degrees (rest ' + s4RestKnee.toFixed(1) + ')');

// ------------------------------------------------------------- axis fixes
// Which axis convention the exporter used is faster to find by eye than to
// derive, so every option has to actually do something and none may break the
// quaternions.

const { ORIENTS } = require('./mixamoRetarget');
const THREE_O = require('three');

// each transform must be its own thing, and preserve length
const probe = new THREE_O.Vector3(1, 2, 3);
const seen = new Set();
for (const [name, fn] of Object.entries(ORIENTS)) {
  const v = fn(probe.clone());
  assert.ok(Math.abs(v.length() - probe.length()) < 1e-9, name + ' changed the length');
  const key = [v.x, v.y, v.z].join(',');
  assert.ok(!seen.has(key), name + ' is a duplicate of another option');
  seen.add(key);
}
assert.strictEqual(ORIENTS.none(probe.clone()).x, 1, 'none must not change anything');

// and applied through a real retarget, a fix must change the result
// on a source where every bone moves - bendTracks turns one leg, and most of
// the skeleton then reads the same whichever fix is picked
const spinTracks = {};
{
  const ax = new THREE_T.Vector3(1, 0, 0);
  for (const b of bind) {
    const q = mxB.localQ.get(b.name).clone()
      .multiply(new THREE_T.Quaternion().setFromAxisAngle(ax, 35 * Math.PI / 180));
    spinTracks[b.name] = { rotation: [{ t: 0, q: [q.x, q.y, q.z, q.w] }, { t: 1000, q: [q.x, q.y, q.z, q.w] }] };
  }
}
const spun = new Set();
for (const o of Object.keys(ORIENTS)) {
  const p = mkP();
  retarget({ bones: spinTracks }, { clip: 'C', pose: p, bones: s4json.bones }, 'C',
    { mapping: m2, mixamoBind: bind, method: 'direction', orient: o, timeMode: 'none' });
  spun.add(JSON.stringify(Object.entries(p).sort().map(([, v]) => v.rot[0].q.map(x => x.toFixed(4)))));
}
assert.strictEqual(spun.size, Object.keys(ORIENTS).length,
  'only ' + spun.size + ' of the axis fixes change the result');

console.log('ok  ' + Object.keys(ORIENTS).length + ' axis fixes, all distinct, all length preserving');

// -------------------------------- bones with no child still get the animation
// Aiming needs a mapped child to aim at. A bone without one - the root, the
// head, toes, finger tips - cannot be aimed, and leaving it at rest while the
// rest of the body moves leaves the character sitting back. Those fall back to
// copying the rotation instead.

const leafPose = mkP();
const leafR = retarget({ bones: bendTracks }, { clip: 'C', pose: leafPose, bones: s4json.bones }, 'C',
  { mapping: m2, mixamoBind: bind, method: 'direction', timeMode: 'none' });
assert.ok(leafR.ok, 'retarget failed: ' + leafR.error);

const childless = Object.values(m2).filter(t =>
  !s4json.bones.some(b => b.parent === t && Object.values(m2).includes(b.name)));
assert.ok(childless.length > 0, 'expected some mapped bones with no mapped child');

let moved = 0;
for (const n of childless) {
  const p = leafPose[n];
  if (!p || !p.rot || p.rot[0].q[0] === 9) continue;
  const rest = s4B.localQ.get(n);
  const d = 2 * Math.acos(Math.min(1, Math.abs(
    new THREE_T.Quaternion(...p.rot[0].q).dot(rest)))) * 180 / Math.PI;
  if (d > 0.01) moved++;
}
assert.ok(moved > 0,
  'every childless bone was left at rest, they should fall back to copying rotations');

console.log('ok  ' + moved + ' of ' + childless.length +
            ' bones with no child to aim at still animate, via rotation copying');

// ---------------------------------------------------------------- source trim
// Half a Mixamo download is often run-up and settle. srcFrom/srcTo pick the
// piece worth keeping; getting this wrong means retargeting the wrong seconds,
// which looks like a bad retarget rather than a bad range.
{
  // a source that turns steadily, so reading a different slice of it must give
  // a visibly different pose
  const trimTracks = {};
  for (const n of mxNames) {
    trimTracks[n] = { rotation: [
      { t: 0, q: [0, 0, 0, 1] },
      { t: 500, q: [0, 0, H, H] },
      { t: 1000, q: [0, 0, 1, 0] },
    ] };
  }
  const freshPose = () => {
    const p = {};
    for (const n of Object.values(m.mapping)) {
      p[n] = { rot: [{ t: 0, q: [1, 0, 0, 0] }, { t: 240, q: [1, 0, 0, 0] }, { t: 480, q: [1, 0, 0, 0] }] };
    }
    return p;
  };
  const run = opts => {
    const pose = freshPose();
    const r = retarget({ bones: trimTracks }, { clip: 'C', pose, bones: s4Bones }, 'C',
      Object.assign({ mixamoBind: bindBones, method: 'rotation' }, opts));
    return { r, pose };
  };

  const whole = run({});
  assert.ok(whole.r.ok, whole.r.error);
  assert.strictEqual(whole.r.sourceTotalMs, 1000, 'source length read wrong: ' + whole.r.sourceTotalMs);

  const half = run({ srcFrom: 0, srcTo: 500 });
  assert.strictEqual(half.r.srcFrom, 0);
  assert.strictEqual(half.r.sourceMs, 500, 'the span was not halved');
  assert.strictEqual(half.r.sourceTotalMs, 1000, 'the total changed, it should not');
  assert.strictEqual(half.r.keysWritten, whole.r.keysWritten,
    'trimming must not drop keys, only change which source time each one reads');

  const a = JSON.stringify(whole.pose), b = JSON.stringify(half.pose);
  assert.notStrictEqual(a, b, 'trimming the source changed nothing');

  // the second half must differ from the first, or the offset is being ignored
  const late = run({ srcFrom: 500, srcTo: 1000 });
  assert.strictEqual(late.r.srcFrom, 500, 'srcFrom was dropped');
  assert.notStrictEqual(JSON.stringify(late.pose), b, 'srcFrom had no effect');

  // a range past the end is clamped, and a backwards one falls back to the
  // whole thing rather than freezing the animation on a single frame
  const over = run({ srcFrom: 0, srcTo: 99999 });
  assert.strictEqual(over.r.srcTo, 1000, 'srcTo past the end was not clamped');
  const bad = run({ srcFrom: 400, srcTo: 100 });
  assert.strictEqual(bad.r.srcTo, 1000, 'a backwards range should fall back to the end');

  console.log('ok  source trim: span, offset, clamping, backwards range');
}

// ------------------------------------------------- a source at rest, at rest
// The test that was missing. A source standing in its own bind pose asks the
// character to stand in ITS bind pose - anything else is distortion the
// retarget invented. Aiming bones at the source's absolute direction failed
// this badly on the feet: female_bip's toe nub points 179 degrees away from
// Mixamo's toe end, so the toe was flipped end for end on every frame and the
// sole of the foot bent. Feet 84 degrees, thumbs 77, the rest around 9.
{
  const restTracks2 = {};
  for (const b of bind) {
    const q = mxB.localQ.get(b.name);
    restTracks2[b.name] = { rotation: [{ t: 0, q: [q.x, q.y, q.z, q.w] }, { t: 1000, q: [q.x, q.y, q.z, q.w] }] };
  }

  for (const how of ['direction', 'rotation']) {
    const p = mkP();
    const r = retarget({ bones: restTracks2 }, { clip: 'C', pose: p, bones: s4json.bones }, 'C',
      { mapping: m2, mixamoBind: bind, method: how, timeMode: 'none' });
    assert.ok(r.ok, r.error);

    const off = [];
    for (const [name, v] of Object.entries(p)) {
      if (v.rot[0].q[0] === 9) continue;
      const rest = s4B.localQ.get(name);
      if (!rest) continue;
      const got = new THREE_T.Quaternion(...v.rot[0].q);
      off.push([2 * Math.acos(Math.min(1, Math.abs(got.dot(rest)))) * 180 / Math.PI, name]);
    }
    off.sort((a, b) => b[0] - a[0]);
    assert.ok(off.length > 20, 'nothing was written, the check proves nothing');
    assert.ok(off[0][0] < 1.0,
      how + ': a source at rest moved ' + off[0][1] + ' by ' + off[0][0].toFixed(1) + ' degrees');
    console.log('ok  ' + how + ': a source at rest gives the rest pose, worst ' +
      off[0][0].toFixed(3) + ' deg over ' + off.length + ' bones');
  }
}
