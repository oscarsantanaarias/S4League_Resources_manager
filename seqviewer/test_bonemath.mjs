// Guards the two conversions the bone gizmo depends on. If either breaks, a
// dragged bone silently lands in the wrong place instead of throwing.
//   1. local = world * inv(parentWorld)   in this codebase's row-vector layout
//   2. THREE.Matrix4.decompose round trips through buildTRS
// Run: node seqviewer/test_bonemath.mjs [path/to/file.scn]

import fs from 'fs';
import assert from 'assert';
import { pathToFileURL } from 'url';
import { parseScn } from './public/js/scn.js';
import { resolveBoneWorlds, mat4Mul, mat4InvAffine, buildTRS } from './public/js/scnSkin.js';

const THREE = await import(pathToFileURL('node_modules/three/build/three.module.js').href)
  .catch(() => import(pathToFileURL(new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname).href));

const file = [process.argv[2], 'C:/S4Plain/extracted_resources/resources/model/weapon/taserplasma.scn']
  .find(f => f && fs.existsSync(f));

if (!file) {
  console.log('skip: no .scn available (pass one as argument)');
  process.exit(0);
}

const scn = parseScn(fs.readFileSync(file).buffer);
assert.ok(scn.bones.length, 'file has no bones');

const clip = scn.animNames[0] || '';
const pose = { clipA: clip, clipB: '', tickA: 0, tickB: 0, blend: 0 };
const world = resolveBoneWorlds(scn, pose);
const idxOf = n => scn.bones.findIndex(b => b.name === n);

let worstLocal = 0;
for (let i = 0; i < scn.bones.length; i++) {
  const pi = idxOf(scn.bones[i].parent);
  const pw = pi >= 0 ? world[pi] : null;
  const local = pw ? mat4Mul(world[i], mat4InvAffine(pw)) : world[i];
  const back = pw ? mat4Mul(local, pw) : local;
  for (let k = 0; k < 16; k++) worstLocal = Math.max(worstLocal, Math.abs(back[k] - world[i][k]));
}
assert.ok(worstLocal < 1e-4, 'world<->local round trip drifted by ' + worstLocal);

let worstTrs = 0;
for (const c of [
  { T: [1, 2, 3], q: [0, 0, 0, 1], S: [1, 1, 1] },
  { T: [-5, 10, 0.5], q: [0.2, 0.3, 0.1, 0.927], S: [2, 2, 2] },
  { T: [0, 0, 0], q: [0.7071, 0, 0, 0.7071], S: [1, 3, 0.5] },
]) {
  const l = Math.hypot(...c.q);
  const q = c.q.map(v => v / l);
  const m = buildTRS(c.T, q, c.S);
  const t = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3();
  new THREE.Matrix4().fromArray(m).decompose(t, r, s);
  const back = buildTRS([t.x, t.y, t.z], [r.x, r.y, r.z, r.w], [s.x, s.y, s.z]);
  for (let i = 0; i < 16; i++) worstTrs = Math.max(worstTrs, Math.abs(back[i] - m[i]));
}
assert.ok(worstTrs < 1e-5, 'decompose round trip drifted by ' + worstTrs);

console.log('ok  ' + file);
console.log('    ' + scn.bones.length + ' bones, clip "' + clip + '"');
console.log('    world<->local err ' + worstLocal.toExponential(2) + ', TRS err ' + worstTrs.toExponential(2));
