'use strict';

// The pose editor rotates a parent bone so its child lands under the cursor.
// If the maths is wrong nothing throws, the limb just goes somewhere else, so
// this drives the real code with a stub renderer and checks where the bone ends.
// Run: node viewer/test_pose_editor.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const { resolveBoneWorlds } = require('../src/engine/scn_skin');

const CHAR_DIR = process.argv[2] || 'C:/S4Plain/extracted_resources/resources/model/character';
if (!fs.existsSync(path.join(CHAR_DIR, 'male_bip.scn'))) {
  console.log('skip: no male_bip.scn under ' + CHAR_DIR);
  process.exit(0);
}

const { loadCharacter } = require('../src/engine/loader');
const { createPoseEditor } = require('./pose_editor');

const CH = loadCharacter(CHAR_DIR, 'male');
const CLIP = '00008';
let tMs = 1200;

// Minimal stand-ins for the bits of the viewer the editor touches.
global.window = global.window || {};
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), addEventListener() {} };
const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.5, 1e6);
camera.position.set(0, 70, 210);
camera.lookAt(0, 30, 0);
camera.updateMatrixWorld(true);

const ed = createPoseEditor({
  THREE,
  scene: new THREE.Scene(),
  camera,
  renderer: { domElement: canvas },
  CH,
  charDir: CHAR_DIR,
  gender: 'male',
  getClip: () => CLIP,
  getTime: () => tMs,
  getDuration: () => 3200,
  onPoseChanged: () => {},
});
ed.buildMarkers(100);
ed.setRange(0, 3200);

const bones = CH.skel.bones;
const idxOf = n => bones.findIndex(b => b.name === n);

// Pick a bone that has a parent and rotation keys, e.g. a forearm.
const childName = bones.map(b => b.name).find(n =>
  /Forearm|L Hand|R Hand|Calf/i.test(n) && idxOf(bones[idxOf(n)].parent) >= 0);
assert.ok(childName, 'no suitable bone found');
const ci = idxOf(childName);
const pi = idxOf(bones[ci].parent);

const worldOf = () => resolveBoneWorlds(CH.skel, { clipA: CLIP, clipB: '', tickA: tMs | 0, tickB: 0, blend: 0 });
const renderPos = (w, i) => new THREE.Vector3(w[i][12], w[i][13], -w[i][14]);

const before = worldOf();
const pivot = renderPos(before, pi);
const start = renderPos(before, ci);
const armLen = start.distanceTo(pivot);
assert.ok(armLen > 1e-3, 'zero length bone');

// Aim at a point the same distance from the pivot, rotated within the view plane.
const view = camera.getWorldDirection(new THREE.Vector3()).negate().normalize();
const side = new THREE.Vector3().crossVectors(view, start.clone().sub(pivot)).normalize();
const target = pivot.clone().add(
  start.clone().sub(pivot).applyAxisAngle(side, 0.35)
);

const res = ed._rotateParentToward(pi, ci, target);
assert.ok(res, 'rotateParentToward returned nothing');

// Apply it the way onUp would, then re-resolve and see where the child landed.
const anim = CH.skel.bones[pi].anims.find(a => a.name === CLIP && a.hasTransform);
assert.ok(anim, 'parent bone has no transform for this clip');
if (anim.rot.length) for (const k of anim.rot) k.q = res.q.slice();
else anim.initR = res.q.slice();

const after = worldOf();
const landed = renderPos(after, ci);
const err = landed.distanceTo(target);

console.log('bone      ', childName, ' <- rotating ', bones[pi].name);
console.log('pivot     ', pivot.toArray().map(v => v.toFixed(1)).join(', '));
console.log('target    ', target.toArray().map(v => v.toFixed(1)).join(', '));
console.log('landed    ', landed.toArray().map(v => v.toFixed(1)).join(', '));
console.log('error     ', err.toFixed(3), ' (bone length ' + armLen.toFixed(1) + ')');

assert.ok(err < armLen * 0.02, 'bone landed ' + err.toFixed(2) + ' away from the target, ' +
  'more than 2% of its length - the mirror or local/world conversion is wrong');
console.log('ok  drag lands the bone on the cursor');

// ---------------------------------------------------------------- user bones
// A bone dropped on the model must land where it was dropped, hang off the
// nearest existing bone, and keep a fixed distance to that parent on any clip
// or tick - otherwise it would drift away as soon as the animation moves.

const drop = renderPos(worldOf(), idxOf('Bip01 L Forearm'));
drop.x += 4; drop.y -= 3;
const nb = ed.addBoneAt(new THREE.Vector3(drop.x, drop.y, drop.z));
assert.ok(nb, 'addBoneAt returned nothing');
assert.ok(nb.parent, 'new bone has no parent');

const w0 = ed._userWorld(nb);
const landedAt = new THREE.Vector3(w0[0], w0[1], -w0[2]);
const dropErr = landedAt.distanceTo(drop);
assert.ok(dropErr < 1e-3, 'bone landed ' + dropErr.toFixed(3) + ' away from the drop point');

const pIdx = idxOf(nb.parent);
const distAt = t => {
  tMs = t;
  ed.sync();
  const w = ed._userWorld(nb);
  const pw = worldOf()[pIdx];
  return Math.hypot(w[0] - pw[12], w[1] - pw[13], w[2] - pw[14]);
};
const d0 = distAt(0), d1 = distAt(800), d2 = distAt(1900);
const spread = Math.max(d0, d1, d2) - Math.min(d0, d1, d2);
assert.ok(spread < 1e-3, 'distance to parent drifted by ' + spread.toFixed(4) + ' across ticks');

console.log('user bone', nb.name, 'parent', nb.parent);
console.log('    drop error ' + dropErr.toFixed(4) + ', parent distance ' + d0.toFixed(2) + 'u stable across ticks');
console.log('ok  user bones anchor to the nearest bone and follow it');

// ------------------------------------------------------------ bone linking
// Re-parenting must not move the bone on screen, a chain must propagate the
// parent's motion down it, and a cycle must be refused rather than hang the
// resolver.

const anchor = renderPos(worldOf(), idxOf('Bip01 L Hand'));
const b2 = ed.addBoneAt(new THREE.Vector3(anchor.x + 3, anchor.y + 2, anchor.z));
assert.ok(b2 && b2.name !== nb.name, 'second user bone not created');

const posOf = b => { const w = ed._userWorld(b); return new THREE.Vector3(w[0], w[1], -w[2]); };
const beforeLink = posOf(b2);
const lr = ed.linkBone(b2.name, nb.name);
assert.ok(lr.ok, 'link failed: ' + lr.msg);
assert.strictEqual(b2.parent, nb.name, 'parent was not updated');
const moved = posOf(b2).distanceTo(beforeLink);
assert.ok(moved < 1e-3, 're-parenting moved the bone by ' + moved.toFixed(4));

// the chain must ride the skeleton: both bones shift together across ticks
const chainDist = t => { tMs = t; ed.sync(); return posOf(b2).distanceTo(posOf(nb)); };
const c0 = chainDist(0), c1 = chainDist(1400);
assert.ok(Math.abs(c0 - c1) < 1e-3, 'chained bone drifted from its parent: ' + c0 + ' vs ' + c1);
tMs = 0; ed.sync();
const p0 = posOf(nb).clone();
tMs = 1400; ed.sync();
assert.ok(posOf(nb).distanceTo(p0) > 1e-3, 'chain root never moves, test proves nothing');

const cyc = ed.linkBone(nb.name, b2.name);
assert.ok(!cyc.ok, 'a cycle was accepted');

console.log('link      ', b2.name, '->', nb.name, '· movimiento', moved.toFixed(4));
console.log('chain     ', 'separacion', c0.toFixed(2) + 'u estable · ciclo rechazado:', cyc.msg);
console.log('ok  linking keeps position, chains follow, cycles refused');

// -------------------------------------------------- multi select and joining
// The last picked bone is the parent. Skeleton bones can be re-parented in
// memory, and "deshacer reenlaces" must put every one of them back.

const hand = renderPos(worldOf(), idxOf('Bip01 R Hand'));
const b3 = ed.addBoneAt(new THREE.Vector3(hand.x + 2, hand.y + 2, hand.z));
ed.clearMultiSelection();
ed.toggleSelect(new THREE.Vector3(posOf(b3).x, posOf(b3).y, posOf(b3).z));
ed.toggleSelect(new THREE.Vector3(posOf(b2).x, posOf(b2).y, posOf(b2).z));
let sel = ed.selectionNames();
assert.strictEqual(sel.length, 2, 'expected 2 selected, got ' + sel.length);
assert.strictEqual(sel[sel.length - 1], b2.name, 'last selected should be the parent');

const jr = ed.joinSelection();
assert.ok(jr.ok, 'join failed: ' + jr.msg);
assert.strictEqual(b3.parent, b2.name, 'child was not re-parented by join');
assert.strictEqual(ed.selectionNames().length, 0, 'selection should clear after joining');

// toggling the same bone twice deselects it
ed.toggleSelect(new THREE.Vector3(posOf(b3).x, posOf(b3).y, posOf(b3).z));
ed.toggleSelect(new THREE.Vector3(posOf(b3).x, posOf(b3).y, posOf(b3).z));
assert.strictEqual(ed.selectionNames().length, 0, 'second click should deselect');

// skeleton bone re-parenting, in memory only
const victim = 'Bip01 L ForeTwist', newDad = 'Bip01 R Hand';
const origDad = bones[idxOf(victim)].parent;
const sk = ed.linkBone(victim, newDad);
assert.ok(sk.ok, 'skeleton re-parent failed: ' + sk.msg);
assert.strictEqual(bones[idxOf(victim)].parent, newDad, 'skeleton parent not applied');

// victim now hangs off newDad, so hanging newDad off victim closes the loop
const bad = ed.linkBone(newDad, victim);
assert.ok(!bad.ok, 'a skeleton cycle was accepted: ' + bad.msg);

const undo = ed.resetReparents();
assert.ok(undo.ok, 'reset failed');
assert.strictEqual(bones[idxOf(victim)].parent, origDad, victim + ' was not restored to ' + origDad);

console.log('select    ', '2 elegidos, padre el ultimo · unir ok · deseleccion ok');
console.log('skeleton  ', victim, '->', newDad, '· deshacer devolvio a', origDad);
console.log('ok  multi selection, joining and skeleton re-parent undo');

// --------------------------------------------------------- clicking the bone
// The skeleton is drawn as segments child->parent. Clicking anywhere along a
// segment must select its CHILD bone, so a limb can be grabbed along its whole
// length instead of only on the little sphere at the joint.

ed.resetReparents();
tMs = 900; ed.sync();
assert.ok(ed._segCount() > 50, 'expected a segment per parented bone, got ' + ed._segCount());

const w = worldOf();
const ci2 = idxOf('Bip01 L Forearm');
const pi2 = idxOf(bones[ci2].parent);
const a = renderPos(w, ci2), b = renderPos(w, pi2);
const mid = a.clone().add(b).multiplyScalar(0.5);   // halfway down the bone

// aim the editor's own raycaster at that midpoint from the camera
ed._rayc.set(camera.position.clone(), mid.clone().sub(camera.position).normalize());
const gotIdx = ed._pickLine();
assert.ok(gotIdx >= 0, 'clicking the middle of a bone hit nothing');
const got = bones[gotIdx].name;
assert.strictEqual(got, 'Bip01 L Forearm',
  'clicking mid-bone selected ' + got + ' instead of the child bone');

console.log('line pick ', 'mitad de', bones[pi2].name, '->', bones[ci2].name, '· segmentos', ed._segCount());
console.log('ok  clicking along a bone selects that bone');

// ------------------------------------------------------------- whole line
// The chain solver must get the grabbed bone closer to the target than a single
// joint can, and it must report every bone it moved so they all get written.

ed.discardEdits();
tMs = 600; ed.sync();
ed.setChainLength(4);

const hi = idxOf('Bip01 L Hand');
const chain = ed._chainOf(hi);
assert.ok(chain.length >= 3, 'expected a chain above the hand, got ' + chain.length);

const startW = worldOf();
const handAt = renderPos(startW, hi);
// a target well out of reach of a single elbow rotation
const far = handAt.clone().add(new THREE.Vector3(35, 45, -25));

const single = ed._rotateParentToward(chain[0], hi, far);
assert.ok(single, 'single joint solve returned nothing');
const animS = bones[chain[0]].anims.find(a => a.name === CLIP && a.hasTransform);
const backup = animS.rot.map(k => k.q.slice());
for (const k of animS.rot) k.q = single.q.slice();
const singleErr = renderPos(worldOf(), hi).distanceTo(far);
animS.rot.forEach((k, i) => { k.q = backup[i]; });

const solved = ed._solveChain(hi, far, 6);
assert.ok(solved.length >= 2, 'chain solver moved only ' + solved.length + ' bone(s)');
const chainErr = renderPos(worldOf(), hi).distanceTo(far);

console.log('chain     ', chain.map(i => bones[i].name).join(' <- '));
console.log('reach err ', 'single joint ' + singleErr.toFixed(1) + 'u  ->  whole line ' + chainErr.toFixed(1) + 'u');
assert.ok(chainErr < singleErr,
  'whole line (' + chainErr.toFixed(1) + ') did no better than one joint (' + singleErr.toFixed(1) + ')');
console.log('ok  whole line bends the chain closer than a single joint');

// --------------------------------------------------------------- key frames
// The frame picker offers the clip's real keys. keyIndexAt must map any time to
// the key at or before it, so the list follows the playhead and "jump to key"
// lands exactly on an editable tick.

const ticks = ed.keyTicks();
assert.ok(ticks.length > 2, 'expected several keys, got ' + ticks.length);
for (let i = 1; i < ticks.length; i++) {
  assert.ok(ticks[i] > ticks[i - 1], 'key list is not sorted / has duplicates');
}
assert.strictEqual(ticks[0], 0, 'first key should be at 0, got ' + ticks[0]);

assert.strictEqual(ed.keyIndexAt(ticks[0]), 0, 'exact first key');
assert.strictEqual(ed.keyIndexAt(ticks[2]), 2, 'exact hit should return that key');
assert.strictEqual(ed.keyIndexAt(ticks[2] + 1), 2, 'just after a key stays on it');
assert.strictEqual(ed.keyIndexAt(ticks[3] - 1), 2, 'just before the next key stays on the previous');
assert.strictEqual(ed.keyIndexAt(ticks[ticks.length - 1] + 5000), ticks.length - 1, 'past the end clamps to last');

// landing on a key and narrowing the range to it must find something to write
const at = ticks[2];
const armIdx = idxOf('Bip01 L Forearm');
const armAnim = bones[armIdx].anims.find(a => a.name === CLIP && a.hasTransform);
assert.ok(armAnim.rot.some(k => k.t === at),
  'key ' + at + ' from the union is not a real key on a bone with rotation');

console.log('keys      ', ticks.length + ' in clip ' + CLIP + ', first ' + ticks[0] + ' last ' + ticks[ticks.length - 1] + ' ms');
console.log('ok  key list is sorted and keyIndexAt snaps to the key at or before a time');
