'use strict';

// Turn a three.js AnimationClip into the shape the retarget consumes.
//
// three gives one track per property, named "boneName.quaternion" with a flat
// values array (4 numbers per key) and times in SECONDS. S4 clips count in
// TICKS of 1/4800 s (see scn-format), not milliseconds, so a second of Mixamo
// is 4800 ticks. Getting this wrong mixes two units and the animation is
// sampled from the wrong part of the source.
//
// Only quaternion tracks are taken. Position tracks would move bones away from
// their parent and pull the mesh apart, the same reason the pose editor writes
// rotation only.

const TICKS_PER_SECOND = 4800;   // scn-format: 1 tick = 1/4800 s

function clipToTracks(clip, opts) {
  const o = Object.assign({ fps: 30, includePosition: false }, opts || {});
  if (!clip || !Array.isArray(clip.tracks)) {
    return { ok: false, error: 'not an AnimationClip' };
  }

  const bones = {};
  let quatTracks = 0, skipped = 0;

  for (const track of clip.tracks) {
    const name = String(track.name || '');
    const dot = name.lastIndexOf('.');
    if (dot < 0) { skipped++; continue; }

    const boneName = name.slice(0, dot);
    const prop = name.slice(dot + 1);
    const times = track.times || [];
    const values = track.values || [];

    if (prop === 'quaternion') {
      if (values.length !== times.length * 4) { skipped++; continue; }
      const rotation = [];
      for (let i = 0; i < times.length; i++) {
        rotation.push({
          t: Math.round(times[i] * TICKS_PER_SECOND),   // seconds -> S4 ticks
          q: [values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]],
        });
      }
      if (!bones[boneName]) bones[boneName] = {};
      bones[boneName].rotation = rotation;
      quatTracks++;
      continue;
    }

    if (prop === 'position' && o.includePosition) {
      if (values.length !== times.length * 3) { skipped++; continue; }
      const position = [];
      for (let i = 0; i < times.length; i++) {
        position.push({
          t: Math.round(times[i] * TICKS_PER_SECOND),
          v: [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]],
        });
      }
      if (!bones[boneName]) bones[boneName] = {};
      bones[boneName].position = position;
      continue;
    }

    skipped++;
  }

  if (!quatTracks) {
    return { ok: false, error: 'the clip has no quaternion tracks, nothing to retarget' };
  }

  return {
    ok: true,
    fps: o.fps,
    duration: Math.round((clip.duration || 0) * TICKS_PER_SECOND),
    name: clip.name || 'clip',
    bones,
    quatTracks,
    skipped,
  };
}

// The bind pose has to come along: a retarget transfers movement away from rest,
// so without knowing where rest is, rotations get copied raw and the model bends
// in half. three gives it as the Bone objects' local transforms.
function bindFromObject(root) {
  const bones = [];
  if (!root || typeof root.traverse !== 'function') return bones;
  root.traverse(o => {
    if (!o || !o.isBone) return;
    const e = o.rotation;
    bones.push({
      name: o.name,
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [e.x, e.y, e.z, e.order || 'XYZ'],
      scale: [o.scale.x, o.scale.y, o.scale.z],
      parent: o.parent && o.parent.isBone ? o.parent.name : null,
    });
  });
  return bones;
}

module.exports = { clipToTracks, bindFromObject };
