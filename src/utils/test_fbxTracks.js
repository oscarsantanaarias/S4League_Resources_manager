'use strict';

// three stores times in seconds and quaternions in one flat array; S4 clips work
// in milliseconds. Getting either wrong gives an animation that plays at the
// wrong speed or with scrambled rotations, without ever throwing.
// Run: node src/utils/test_fbxTracks.js

const assert = require('assert');
const { clipToTracks } = require('./fbxTracks');
const { readTracks, retarget } = require('./mixamoRetarget');

const H = Math.SQRT1_2;

const clip = {
  name: 'mixamo.com',
  duration: 1.0333,
  tracks: [
    {
      name: 'mixamorigHips.quaternion',
      times: [0, 0.5, 1.0],
      values: [0, 0, 0, 1, 0, 0, H, H, 0, 0, 0, 1],
    },
    {
      name: 'mixamorigHips.position',
      times: [0, 0.5],
      values: [0, 100, 0, 0, 105, 0],
    },
    { name: 'mixamorigSpine.quaternion', times: [0], values: [0, 0, 0, 1] },
    { name: 'noDotHere', times: [0], values: [0] },
  ],
};

const r = clipToTracks(clip);
assert.ok(r.ok, 'conversion failed: ' + r.error);

// seconds -> S4 ticks, 4800 per second. Using ms here silently samples the
// wrong part of the source, because the clip counts in ticks.
assert.deepStrictEqual(r.bones.mixamorigHips.rotation.map(k => k.t), [0, 2400, 4800],
  'times were not converted from seconds to ticks');
assert.strictEqual(r.duration, 4960, 'duration should be in ticks, got ' + r.duration);

// the flat values array must unpack 4 at a time, in order
assert.deepStrictEqual(r.bones.mixamorigHips.rotation[1].q, [0, 0, H, H],
  'quaternion unpacked wrong');
for (const k of r.bones.mixamorigHips.rotation) {
  assert.ok(Math.abs(Math.hypot(...k.q) - 1) < 1e-6, 'non unit quaternion at t=' + k.t);
}

// position is dropped unless asked for, and a track with no dot is ignored
assert.strictEqual(r.bones.mixamorigHips.position, undefined, 'position leaked in by default');
assert.strictEqual(r.quatTracks, 2, 'expected 2 quaternion tracks, got ' + r.quatTracks);
assert.ok(!('noDotHere' in r.bones), 'a malformed track name became a bone');

const withPos = clipToTracks(clip, { includePosition: true });
assert.deepStrictEqual(withPos.bones.mixamorigHips.position.map(k => k.t), [0, 2400]);

// a clip with only position tracks must be refused, not returned empty
const noQuat = clipToTracks({ duration: 1, tracks: [{ name: 'a.position', times: [0], values: [0, 0, 0] }] });
assert.ok(!noQuat.ok && /quaternion/i.test(noQuat.error), 'a clip with no rotations was accepted');
assert.ok(!clipToTracks(null).ok, 'null was accepted');

// and the result must be something the retarget actually eats
const probe = readTracks(r);
assert.strictEqual(probe.reason, null, 'retarget rejected the converted clip: ' + probe.reason);

// the retarget needs both rest poses, so the converted clip carries the Mixamo
// one and the .scn json supplies the S4 one
const pose = { 'Bip01': { rot: [{ t: 0, q: [1, 0, 0, 0] }, { t: 240, q: [1, 0, 0, 0] }] } };
const bind = [{ name: 'mixamorigHips', position: [0, 0, 0], rotation: [0, 0, 0, 'XYZ'], scale: [1, 1, 1], parent: null }];
const s4Bones = [{ name: 'Bip01', parent: null, matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }];
const applied = retarget(r, { clip: 'C', pose, bones: s4Bones }, 'C', { mixamoBind: bind });
assert.ok(applied.ok, 'retarget failed: ' + applied.error);
assert.strictEqual(applied.applied, 1, 'the hips track did not reach Bip01, the root');
assert.ok(pose['Bip01'].rot.every(k => Math.abs(Math.hypot(...k.q) - 1) < 1e-6));

console.log('ok  seconds -> ticks (4800/s), quaternions unpacked 4 at a time, unit length kept');
console.log('    ' + r.quatTracks + ' rotation tracks, duration ' + r.duration + ' ticks, ' + r.skipped + ' tracks skipped');
console.log('ok  position dropped by default, rotation-less clips refused');
console.log('ok  the converted clip feeds straight into the retarget');
