'use strict';

// Direct manipulation pose editor for character skeletons.
//
// Grab a bone marker and drag: the PARENT bone rotates so the grabbed bone
// follows the cursor. That is what "bend the arm" means in practice - you pull
// the forearm and the elbow rotates.
//
// On release, the parent's new rotation is written into every rotation key that
// falls inside the selected time range, both in the live skeleton (so the change
// shows immediately) and in the pending JSON patch. Nothing touches the file
// until Save is pressed: male_bip.scn is 32 MB and shared by every character.
//
// The .scn keys sit on a fixed grid (240 ms in the shipped clips) and applyJson
// patches values in place, so a pose can only land on keys that already exist.
// ponytail: no key insertion, that needs a full writer. Range editing covers it.

const fs = require('fs');
const path = require('path');
const scncodec = require('../src/codecs/scncodec');
const { mat4Mul, mat4InvAffine, resolveBoneWorlds } = require('../src/engine/scn_skin');

// root carries scale.z = -1, so markers live in world space with that flip
// folded in. FLIP is its own inverse, which keeps both directions symmetric.
const FLIP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];

function createPoseEditor(opts) {
  const { THREE, scene, camera, renderer, CH, charDir, gender, getClip, getTime, setTime, getDuration, onPoseChanged } = opts;

  const scnPath = path.join(charDir, (gender || 'male') + '_bip.scn');
  const argOf = k => (process.argv.find(a => a.startsWith(k)) || '').slice(k.length) || null;
  const resPath = argOf('--res=');
  const resEntry = argOf('--entry=');
  // absent outside Electron (the test harness runs under plain node)
  let ipc = null;
  try { ipc = require('electron').ipcRenderer || null; } catch (e) { ipc = null; }
  const bones = CH.skel.bones;
  const boneIdx = new Map(bones.map((b, i) => [b.name, i]));

  let json = null, jsonClip = null, dirty = 0;
  let markers = null, picked = null, drag = null;
  let skelLines = null, segBone = [];
  let range = { from: 0, to: 0 };
  const rayc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();

  // ---------------------------------------------------------------- markers

  const group = new THREE.Group();
  group.name = '__bone_markers';
  scene.add(group);

  let lastRadius = 100;
  function buildMarkers(radius) {
    lastRadius = radius;
    for (const m of group.children) { m.geometry.dispose(); m.material.dispose(); }
    group.clear();
    const size = Math.max(0.35, radius * 0.012);
    const geo = new THREE.SphereGeometry(size, 8, 6);
    markers = [];
    for (const b of bones) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x37c8ff, depthTest: false, transparent: true, opacity: 0.8 });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1e6;
      m.matrixAutoUpdate = false;
      m.userData.bone = b.name;
      group.add(m);
      markers.push(m);
    }
    buildSkelLines();
    sync();
    loadUserBones();
    buildUserMarkers();
  }

  // One segment per bone that has a parent, so the whole skeleton reads as a
  // chain. segBone maps a segment back to its child bone, which is what a click
  // on the line selects - grabbing a limb anywhere along it, not just on the
  // little sphere at its end.
  function buildSkelLines() {
    if (skelLines) {
      group.remove(skelLines);
      skelLines.geometry.dispose();
      skelLines.material.dispose();
    }
    segBone = [];
    for (let i = 0; i < bones.length; i++) {
      const p = bones[i].parent;
      if (p && boneIdx.has(p)) segBone.push(i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, segBone.length) * 6), 3));
    skelLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xff5a4a, depthTest: false, transparent: true, opacity: 0.75,
    }));
    skelLines.renderOrder = 1e6 - 1;
    skelLines.frustumCulled = false;
    group.add(skelLines);
  }

  function syncSkelLines() {
    if (!skelLines || !worlds) return;
    const pos = skelLines.geometry.getAttribute('position');
    let k = 0;
    for (const i of segBone) {
      const w = worlds[i], pw = worlds[boneIdx.get(bones[i].parent)];
      if (!w || !pw) { k += 6; continue; }
      pos.array[k++] = w[12];  pos.array[k++] = w[13];  pos.array[k++] = -w[14];
      pos.array[k++] = pw[12]; pos.array[k++] = pw[13]; pos.array[k++] = -pw[14];
    }
    pos.needsUpdate = true;
    skelLines.geometry.computeBoundingSphere();
  }

  function pose() {
    return { clipA: getClip(), clipB: '', tickA: getTime() | 0, tickB: 0, blend: 0 };
  }

  let worlds = null;
  function sync() {
    if (!markers) return;
    worlds = resolveBoneWorlds(CH.skel, pose());
    for (let i = 0; i < markers.length; i++) {
      if (drag && markers[i] === picked) continue;
      markers[i].matrix.fromArray(mat4Mul(worlds[i], FLIP));
      markers[i].matrixWorldNeedsUpdate = true;
    }
    syncSkelLines();
    syncUser();
  }

  function highlight() {
    for (const m of group.children) {
      if (!m.isMesh) continue;   // skelLines lives in this group too
      m.material.color.setHex(m === picked ? 0xffd24a : 0x37c8ff);
    }
  }

  // ------------------------------------------------------------------ math

  function parentIndexOf(i) {
    const p = bones[i].parent;
    return p && boneIdx.has(p) ? boneIdx.get(p) : -1;
  }

  function worldPos(i) {
    const w = worlds[i];
    return new THREE.Vector3(w[12], w[13], -w[14]); // -z: the root flip
  }

  // Rotate `pi` around its own origin so that the child at `ci` lands on target.
  function rotateParentToward(pi, ci, target) {
    const pivot = worldPos(pi);
    const from = worldPos(ci).sub(pivot);
    const to = target.clone().sub(pivot);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return null;
    from.normalize(); to.normalize();

    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    // Back out of the mirrored render space (root has scale.z = -1). Conjugating
    // a rotation by diag(1,1,-1) flips the axis z component and the angle sign,
    // which on a quaternion is exactly (x, y, z, w) -> (-x, -y, z, w).
    const qSkel = new THREE.Quaternion(-q.x, -q.y, q.z, q.w);

    const W = new THREE.Matrix4().fromArray(worlds[pi]);
    const pivotSkel = new THREE.Vector3(worlds[pi][12], worlds[pi][13], worlds[pi][14]);
    const R = new THREE.Matrix4()
      .makeTranslation(pivotSkel.x, pivotSkel.y, pivotSkel.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(qSkel))
      .multiply(new THREE.Matrix4().makeTranslation(-pivotSkel.x, -pivotSkel.y, -pivotSkel.z));
    const newWorld = R.multiply(W).toArray();

    const gpi = parentIndexOf(pi);
    const local = gpi >= 0 ? mat4Mul(newWorld, mat4InvAffine(worlds[gpi])) : newWorld;
    const t = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3();
    new THREE.Matrix4().fromArray(local).decompose(t, r, s);
    return { q: [r.x, r.y, r.z, r.w], T: [t.x, t.y, t.z] };
  }

  // ---------------------------------------------------------- mixamo retarget
  // Load a Mixamo animation exported to JSON and lay it over the current clip.
  // The tracks are resampled onto the ticks this clip already has, because keys
  // cannot be created, and mirrored across Z like every other rotation here.

  let lastRetarget = null;
  let boneMapText = null;      // an optional .bmap, authoritative when present
  let timeMode = 'fit';        // fit stretches the source, loop repeats it
  let srcFrom = 0, srcTo = 0;  // slice of the loaded animation to use, 0 = all
  let lastSource = null;       // so the slice can be changed without picking the file again
  let lastMapping = null;      // what the last load paired up, for the panel
  const disabledBones = new Set();
  let swapSides = false;
  let mirrorZ = false;      // for an animation that plays reversed
  let method = 'direction'; // aim bones like the source; 'rotation' copies angles
  let orient = 'flipZ';     // S4 is left handed (DirectX), an FBX is right handed

  // The pairing the panel shows, and the switches that act on it.
  function mappingRows() {
    if (!lastMapping) return [];
    return Object.keys(lastMapping.all).sort().map(src => ({
      source: src,
      target: lastMapping.all[src] || null,
      enabled: !disabledBones.has(src),
    }));
  }

  function setBoneEnabled(source, on) {
    if (on) disabledBones.delete(source); else disabledBones.add(source);
  }

  // Swaps Left and Right on the SOURCE side, for an animation that comes out
  // mirrored. Names are the only thing that carries sidedness here.
  function mirrorSides() {
    if (!lastMapping) return false;
    swapSides = !swapSides;
    return true;
  }

  function flipName(n) {
    if (/left/i.test(n)) return n.replace(/left/i, m => (m[0] === 'L' ? 'Right' : 'right'));
    if (/right/i.test(n)) return n.replace(/right/i, m => (m[0] === 'R' ? 'Left' : 'left'));
    return n;
  }

  function loadBoneMap(text, label) {
    const { parseBoneMap } = require('../src/utils/boneMap');
    const parsed = parseBoneMap(text);
    if (!parsed.count) return { ok: false, msg: 'no bone pairs found in that .bmap' };
    boneMapText = text;
    return { ok: true, msg: (label || 'bone map') + ': ' + parsed.count + ' pairs, ' +
             parsed.unmapped.length + ' deliberately unmapped' };
  }

  // Accepts a path on disk or the file contents: Electron 32+ dropped File.path,
  // so the picker can only hand over the text.
  function retargetMixamo(mixamoPathOrContent, label) {
    if (mixamoPathOrContent == null) {
      if (!lastSource) return { ok: false, msg: 'load an animation first' };
      mixamoPathOrContent = lastSource.content;
      label = lastSource.label;
    }
    const { retarget, buildMapping, readTracks } = require('../src/utils/mixamoRetarget');
    let mixamo, sourceName = label || 'the file';
    try {
      let content = mixamoPathOrContent;
      if (typeof content === 'string') {
        try {
          JSON.parse(content);
        } catch (e) {
          content = fs.readFileSync(content, 'utf8');
        }
      }
      mixamo = JSON.parse(content);
      sourceName = label || (content === mixamoPathOrContent ? 'the file' : path.basename(mixamoPathOrContent));
      lastSource = { content, label: sourceName };
    } catch (e) { return { ok: false, msg: 'could not read the file: ' + e.message }; }

    const probe = readTracks(mixamo);
    if (probe.reason) return { ok: false, msg: probe.reason };

    const j = ensureJson();
    const map = buildMapping(Object.keys(probe.tracks), Object.keys(j.pose || {}));
    // a loaded .bmap wins: it is the mapping the S4 tooling itself uses
    // resolve the pairing first so the panel can show it and act on it
    let resolved;
    if (boneMapText) {
      const { parseBoneMap, applyBoneMap } = require('../src/utils/boneMap');
      resolved = applyBoneMap(parseBoneMap(boneMapText), Object.keys(probe.tracks),
        j.bones.map(b => b.name)).mapping;
    } else {
      resolved = map.mapping;
    }

    const all = {};
    for (const src of Object.keys(probe.tracks)) all[src] = resolved[src] || null;
    lastMapping = { all };

    const active = {};
    for (const [src, dst] of Object.entries(resolved)) {
      if (disabledBones.has(src)) continue;
      const from = swapSides ? flipName(src) : src;
      if (!probe.tracks[from]) continue;
      active[from] = dst;
    }

    const r = retarget(mixamo, j, getClip(),
      { mapping: active, timeMode, mirrorZ, method, orient, srcFrom, srcTo });
    if (!r.ok) return { ok: false, msg: r.error };

    // push the result into the live skeleton so it plays straight away
    for (const [boneName, p2] of Object.entries(j.pose || {})) {
      const i = boneIdx.get(boneName);
      if (i === undefined) continue;
      const anim = (bones[i].anims || []).find(a => a.name === getClip() && a.hasTransform);
      if (!anim) continue;
      for (let k = 0; k < p2.rot.length && k < anim.rot.length; k++) anim.rot[k].q = p2.rot[k].q.slice();
    }
    dirty++;
    sync();
    onPoseChanged && onPoseChanged();

    lastRetarget = { ...r, mapped: map.matched, absent: map.absent.length };
    return {
      ok: true,
      sourceMs: r.sourceTotalMs,
      msg: r.applied + ' bones, ' + r.keysWritten + ' keys from ' + sourceName +
           ' (' + (r.srcFrom / 4800).toFixed(2) + '-' + (r.srcTo / 4800).toFixed(2) + 's of ' +
           (r.sourceTotalMs / 4800).toFixed(2) + 's source, ' +
           (r.clipMs / 4800).toFixed(2) + 's clip, ' + r.timeMode + ')' +
           (r.restored ? ', ' + r.restored + ' extra bones reset' : '') +
           ' - press Save to keep it',
    };
  }

  function retargetReport() { return lastRetarget; }

  // ------------------------------------------------------- whole line mode
  // "Edit whole line" bends the chain instead of a single joint. Grab any bone
  // and drag: CCD walks up a few ancestors, rotating each one a little so the
  // grabbed bone reaches the cursor. That is how you shape a limb rather than
  // pivot it around one elbow.
  //
  // Every bone the solver touches gets written on release, so the whole chain
  // lands in the keys, not just the parent.

  let wholeLine = false;
  let chainLen = 4;

  function setWholeLine(on) { wholeLine = !!on; return wholeLine; }
  function isWholeLine() { return wholeLine; }
  function setChainLength(n) { chainLen = Math.max(2, Math.min(12, n | 0)); return chainLen; }
  function getChainLength() { return chainLen; }

  // ancestors of `ci`, nearest first, skipping the root (nothing above to move)
  function chainOf(ci) {
    const out = [];
    let cur = parentIndexOf(ci);
    while (cur >= 0 && out.length < chainLen) {
      out.push(cur);
      cur = parentIndexOf(cur);
    }
    return out;
  }

  // One CCD pass per iteration, from the far end of the chain down to the
  // closest joint. Each step reuses rotateParentToward, which already handles
  // the mirrored render space and the local/world conversion.
  function solveChain(ci, target, iterations) {
    const chain = chainOf(ci);
    if (!chain.length) return [];
    const touched = new Map();
    for (let it = 0; it < (iterations || 4); it++) {
      for (let k = chain.length - 1; k >= 0; k--) {
        const pi = chain[k];
        const res = rotateParentToward(pi, ci, target);
        if (!res) continue;
        applyLive(pi, res.q);
        touched.set(pi, res.q);
        worlds = resolveBoneWorlds(CH.skel, pose());   // refresh for the next joint
      }
    }
    return [...touched.entries()].map(([pi, q]) => ({ pi, q }));
  }

  // Push a rotation into the live skeleton for the current range, so the drag
  // previews exactly what will be written.
  function applyLive(pi, q) {
    const anim = (bones[pi].anims || []).find(a => a.name === getClip() && a.hasTransform);
    if (!anim) return;
    if (!anim.rot.length) { anim.initR = q.slice(); return; }
    for (const k of anim.rot) if (k.t >= range.from && k.t <= range.to) k.q = q.slice();
  }

  // ------------------------------------------------------------ key frames
  // The clip does not store "frames", it stores keys, and different bones can
  // carry different ones. The union of every rotation key tick is what you can
  // actually land on and edit, so that is what the frame list offers.

  let keyCache = { clip: null, ticks: [] };

  function keyTicks() {
    const clip = getClip();
    if (keyCache.clip === clip) return keyCache.ticks;
    const set = new Set();
    for (const b of bones) {
      const a = (b.anims || []).find(x => x.name === clip && x.hasTransform);
      if (!a) continue;
      for (const k of a.rot) set.add(k.t);
      for (const k of (a.trans || [])) set.add(k.t);
    }
    keyCache = { clip, ticks: [...set].sort((x, y) => x - y) };
    return keyCache.ticks;
  }

  // Nearest key at or before t, so the list follows along while the clip plays.
  function keyIndexAt(t) {
    const ticks = keyTicks();
    if (!ticks.length) return -1;
    let lo = 0, hi = ticks.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ticks[mid] <= t) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

  // --------------------------------------------------------------- editing

  function ensureJson() {
    const clip = getClip();
    if (json && jsonClip === clip) return json;
    json = scncodec.scnToJson(fs.readFileSync(scnPath), clip);
    jsonClip = clip;
    dirty = 0;
    return json;
  }

  // Writes the rotation into every key of `boneName` inside [from, to].
  // Returns how many keys were touched; 0 means the range holds no key and the
  // drag would be lost, which the caller reports instead of silently dropping.
  function writeRange(boneName, q, from, to) {
    const j = ensureJson();
    const p = j.pose && j.pose[boneName];
    const live = CH.skel.bones[boneIdx.get(boneName)];
    const anim = (live.anims || []).find(a => a.name === getClip() && a.hasTransform);
    if (!p || !anim) return 0;

    let n = 0;
    for (let i = 0; i < p.rot.length; i++) {
      const t = p.rot[i].t;
      if (t < from || t > to) continue;
      p.rot[i].q = q.slice();
      if (anim.rot[i]) anim.rot[i].q = q.slice();
      n++;
    }
    if (!p.rot.length) {           // no keys at all: the init pose drives the clip
      p.initR = q.slice();
      anim.initR = q.slice();
      n = 1;
    }
    if (n) dirty++;
    return n;
  }

  // scnPath lives in a temp folder that ItemManager wipes when the window
  // closes, so writing there alone would lose the edit. When the viewer was
  // launched with --res/--entry we also push the bytes back into the resource
  // the user opened, container or loose folder alike.
  function save() {
    if (!json) return { ok: false, msg: 'nothing to save' };
    try {
      const orig = fs.readFileSync(scnPath);
      const { buf, patched } = scncodec.applyJson(orig, json);
      if (!patched) return { ok: true, msg: 'no changes to write' };
      fs.writeFileSync(scnPath, buf);
      dirty = 0;
      if (!resPath || !resEntry || !ipc) {
        return { ok: true, msg: `${patched} values written TO THE TEMP COPY ONLY, lost on close` };
      }
      return { ok: true, pending: true, patched, msg: `${patched} values, writing to ${resEntry}…` };
    } catch (e) {
      return { ok: false, msg: 'error: ' + e.message };
    }
  }

  // Second half of save(), async because it crosses into the main process.
  async function commitToResource(patched) {
    const bytes = Array.from(fs.readFileSync(scnPath));
    const r = await ipc.invoke('characterScnSave', { ruta: resPath, fullName: resEntry, bytes });
    if (!r || !r.ok) return { ok: false, msg: 'could not write the resource: ' + ((r && r.error) || 'no response') };
    const backup = r.backup ? ' - original backed up to ' + r.backup
                            : (r.backupExisting ? ' - original already backed up' : '');
    return { ok: true, msg: `saved, ${patched} values in ${resEntry} - now press Save changes in the tool` + backup };
  }

  // ------------------------------------------------------------ user bones
  // Bones the user adds on top of the skeleton. They are NOT written into the
  // .scn: adding a BONE chunk grows the file and applyJson only patches values
  // in place. They live in a sidecar next to the opened resource, follow their
  // parent through every clip, and carry no skin weights - same as the shipped
  // _Dummy bones, which also deform nothing.
  //
  // Parent is the nearest existing bone at drop time, so a new bone is never
  // orphaned and inherits a sensible animation.

  const userBonesPath = resPath
    ? path.join(path.dirname(resPath), path.basename(scnPath, '.scn') + '.userbones.json')
    : null;
  let userBones = [];
  let reparent = {};
  let userGroup = null, userLines = null;

  function loadUserBones() {
    if (!userBonesPath || !fs.existsSync(userBonesPath)) return;
    try {
      const j = JSON.parse(fs.readFileSync(userBonesPath, 'utf8'));
      userBones = Array.isArray(j.bones) ? j.bones : [];
      reparent = j.reparent && typeof j.reparent === 'object' ? j.reparent : {};
      // re-apply saved re-parents to the live skeleton
      for (const [k, v] of Object.entries(reparent)) {
        if (k.startsWith('__orig__')) continue;
        const i = boneIdx.get(k);
        if (i !== undefined && boneIdx.has(v)) bones[i].parent = v;
      }
    } catch (e) { userBones = []; reparent = {}; }
  }

  function saveUserBones() {
    if (!userBonesPath) return { ok: false, msg: 'no resource path, cannot save' };
    try {
      fs.writeFileSync(userBonesPath, JSON.stringify({ bones: userBones, reparent }, null, 1));
      const nr = Object.keys(reparent).filter(k => !k.startsWith('__orig__')).length;
      return { ok: true, msg: `${userBones.length} bones` + (nr ? ` and ${nr} re-links` : '') + ` en ${path.basename(userBonesPath)}` };
    } catch (e) { return { ok: false, msg: 'error: ' + e.message }; }
  }

  // row-vector transform: p' = p * M
  function xform(p, M) {
    return [
      p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12],
      p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13],
      p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14],
    ];
  }

  function nearestBone(pSkel) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < worlds.length; i++) {
      const w = worlds[i];
      const d = (w[12] - pSkel[0]) ** 2 + (w[13] - pSkel[1]) ** 2 + (w[14] - pSkel[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // point comes from a raycast against the rendered mesh, i.e. mirrored space
  function addBoneAt(renderPoint) {
    if (!worlds) return null;
    const pSkel = [renderPoint.x, renderPoint.y, -renderPoint.z];
    const pi = nearestBone(pSkel);
    if (pi < 0) return null;
    const offset = xform(pSkel, mat4InvAffine(worlds[pi]));
    let n = userBones.length + 1;
    while (userBones.some(b => b.name === 'user_' + n)) n++;
    const bone = { name: 'user_' + n, parent: bones[pi].name, offset };
    userBones.push(bone);
    buildUserMarkers();
    const d = Math.hypot(offset[0], offset[1], offset[2]);
    report(`${bone.name} parented to ${bone.parent} at ${d.toFixed(1)}u, unsaved`);
    return bone;
  }

  function removeNearestUserBone(renderPoint) {
    if (!userBones.length) return null;
    const pSkel = [renderPoint.x, renderPoint.y, -renderPoint.z];
    let best = -1, bd = Infinity;
    userBones.forEach((b, i) => {
      const w = userWorld(b);
      if (!w) return;
      const d = (w[0] - pSkel[0]) ** 2 + (w[1] - pSkel[1]) ** 2 + (w[2] - pSkel[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) return null;
    const gone = userBones.splice(best, 1)[0];
    buildUserMarkers();
    report(gone.name + ' deleted, unsaved');
    return gone;
  }

  // The parent can be a skeleton bone or another user bone, so this walks up
  // until it reaches the skeleton. depth caps a cycle that slipped through.
  function parentWorldMatrix(name, depth) {
    if ((depth || 0) > 32) return null;
    if (boneIdx.has(name)) return worlds ? worlds[boneIdx.get(name)] : null;
    const ub = userBones.find(x => x.name === name);
    if (!ub) return null;
    const pw = parentWorldMatrix(ub.parent, (depth || 0) + 1);
    if (!pw) return null;
    const t = xform(ub.offset, pw);
    // user bones carry no rotation of their own, they ride the parent's
    return [pw[0], pw[1], pw[2], 0, pw[4], pw[5], pw[6], 0, pw[8], pw[9], pw[10], 0, t[0], t[1], t[2], 1];
  }

  function userWorld(b) {
    const pw = parentWorldMatrix(b.parent, 0);
    if (!pw) return null;
    return xform(b.offset, pw);
  }

  function wouldCycle(childName, newParent) {
    let cur = newParent, hops = 0;
    while (cur && !boneIdx.has(cur) && hops++ < 64) {
      if (cur === childName) return true;
      const ub = userBones.find(x => x.name === cur);
      if (!ub) return false;
      cur = ub.parent;
    }
    return false;
  }

  // Skeleton bones can be re-parented too, but only in memory and in the
  // sidecar - never in the .scn, where the parent name lives inside the chunk
  // and applyJson cannot resize anything. Their pose comes from the clip and is
  // local to the parent, so unlike user bones they DO jump when moved: there is
  // no offset to recompute, the animation itself is what places them.
  function linkSkeletonBone(childName, newParent) {
    const i = boneIdx.get(childName);
    if (i === undefined) return { ok: false, msg: childName + ' does not exist' };
    if (childName === newParent) return { ok: false, msg: 'a bone cannot hang off itself' };
    if (!boneIdx.has(newParent)) return { ok: false, msg: 'a skeleton bone cannot hang off one of yours' };
    let cur = newParent, hops = 0;
    while (cur && hops++ < 128) {
      if (cur === childName) return { ok: false, msg: 'that would make a cycle' };
      const ci = boneIdx.get(cur);
      cur = ci === undefined ? null : bones[ci].parent;
    }
    if (!(childName in reparent)) reparent['__orig__' + childName] = bones[i].parent;
    reparent[childName] = newParent;
    bones[i].parent = newParent;          // the engine reads bone.parent directly
    sync();
    return { ok: true, msg: childName + ' now hangs off ' + newParent + ' (it jumps, its pose is parent local)' };
  }

  function resetReparents() {
    let n = 0;
    for (const k of Object.keys(reparent)) {
      if (k.startsWith('__orig__')) continue;
      const i = boneIdx.get(k);
      if (i !== undefined) { bones[i].parent = reparent['__orig__' + k]; n++; }
    }
    reparent = {};
    sync();
    return { ok: true, msg: n + ' bones restored to their original parent' };
  }

  // Re-parent without moving the bone: recompute the offset against the new
  // parent so it stays exactly where it is on screen.
  function linkBone(childName, newParent) {
    const b = userBones.find(x => x.name === childName);
    if (!b) return linkSkeletonBone(childName, newParent);
    if (childName === newParent) return { ok: false, msg: 'a bone cannot hang off itself' };
    if (wouldCycle(childName, newParent)) return { ok: false, msg: 'that would make a cycle' };
    const keep = userWorld(b);
    const np = parentWorldMatrix(newParent, 0);
    if (!keep || !np) return { ok: false, msg: 'cannot resolve ' + newParent };
    b.parent = newParent;
    b.offset = xform(keep, mat4InvAffine(np));
    buildUserMarkers();
    return { ok: true, msg: childName + ' now hangs off ' + newParent };
  }

  // Chain every user bone: each hangs off the nearest bone that is not one of
  // its own descendants, so they end up linked together instead of all hanging
  // straight off the skeleton.
  function chainUserBones() {
    if (userBones.length < 1) return { ok: false, msg: 'you have no bones' };
    let n = 0;
    for (const b of userBones) {
      const here = userWorld(b);
      if (!here) continue;
      let best = null, bd = Infinity;
      for (let i = 0; i < bones.length; i++) {
        const w = worlds[i];
        const d = (w[12]-here[0])**2 + (w[13]-here[1])**2 + (w[14]-here[2])**2;
        if (d < bd) { bd = d; best = bones[i].name; }
      }
      for (const o of userBones) {
        if (o === b || wouldCycle(b.name, o.name)) continue;
        const w = userWorld(o);
        if (!w) continue;
        const d = (w[0]-here[0])**2 + (w[1]-here[1])**2 + (w[2]-here[2])**2;
        if (d < bd) { bd = d; best = o.name; }
      }
      if (best && best !== b.parent && linkBone(b.name, best).ok) n++;
    }
    return { ok: true, msg: n + ' bones re-linked to the nearest one' };
  }

  function buildUserMarkers() {
    if (userGroup) {
      scene.remove(userGroup);
      userGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    userGroup = new THREE.Group();
    userGroup.name = '__user_bones';
    scene.add(userGroup);

    const size = Math.max(0.4, lastRadius * 0.014);
    for (const b of userBones) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(size),
        new THREE.MeshBasicMaterial({ color: 0x7bf58a, depthTest: false, transparent: true, opacity: 0.9 })
      );
      m.renderOrder = 1e6 + 1;
      m.matrixAutoUpdate = false;
      m.userData.userBone = b.name;
      userGroup.add(m);
    }
    const seg = new THREE.BufferGeometry();
    seg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, userBones.length) * 6), 3));
    userLines = new THREE.LineSegments(seg, new THREE.LineBasicMaterial({ color: 0x4a8f57, depthTest: false, transparent: true, opacity: 0.7 }));
    userLines.renderOrder = 1e6;
    userLines.frustumCulled = false;
    userGroup.add(userLines);
    syncUser();
    paintSelection();
  }

  function syncUser() {
    if (!userGroup || !worlds) return;
    const pos = userLines.geometry.getAttribute('position');
    let li = 0;
    userBones.forEach((b, i) => {
      const w = userWorld(b);
      const mesh = userGroup.children[i];
      if (!w || !mesh || !mesh.isMesh) return;
      mesh.matrix.makeTranslation(w[0], w[1], -w[2]);
      mesh.matrixWorldNeedsUpdate = true;
      // the parent may be another user bone, so resolve it the general way
      const pw = parentWorldMatrix(b.parent, 0);
      if (!pw) return;
      pos.array[li++] = w[0]; pos.array[li++] = w[1]; pos.array[li++] = -w[2];
      pos.array[li++] = pw[12]; pos.array[li++] = pw[13]; pos.array[li++] = -pw[14];
    });
    for (let k = li; k < pos.array.length; k++) pos.array[k] = 0;
    pos.needsUpdate = true;
  }

  // ------------------------------------------------------- multi selection
  // Pick several bones, then join them in one go. The LAST one picked is the
  // parent, everything else hangs off it - same convention as Blender's active
  // object, and it means you can keep adding children without re-picking.

  let selection = [];

  function toggleSelect(renderPoint) {
    const name = pickAnyBoneAt(renderPoint);
    if (!name) return null;
    const at = selection.indexOf(name);
    if (at >= 0) selection.splice(at, 1);
    else selection.push(name);
    paintSelection();
    return name;
  }

  function clearSelection2() { selection = []; paintSelection(); }

  // Delete whatever user bones are selected. Skeleton bones in the selection
  // are skipped: they belong to the .scn, not to us.
  function deleteSelection() {
    if (!selection.length) return { ok: false, msg: 'nothing selected' };
    const mine = selection.filter(n => userBones.some(b => b.name === n));
    const skipped = selection.length - mine.length;
    if (!mine.length) return { ok: false, msg: 'only your own bones (green) can be deleted' };
    // anything parented to a deleted bone falls back to that bone's parent
    for (const name of mine) {
      const gone = userBones.find(b => b.name === name);
      for (const b of userBones) if (b.parent === name) linkBone(b.name, gone.parent);
    }
    userBones = userBones.filter(b => !mine.includes(b.name));
    clearSelection2();
    buildUserMarkers();
    return { ok: true, msg: mine.length + ' bone(s) deleted' + (skipped ? ' (' + skipped + ' skeleton bones ignored)' : '') };
  }

  // Throw away pose edits that have not been saved, by re-reading the clip from
  // disk and pushing it back into the live skeleton.
  function discardEdits() {
    try {
      const fresh = scncodec.scnToJson(fs.readFileSync(scnPath), getClip());
      let n = 0;
      for (const [boneName, p2] of Object.entries(fresh.pose || {})) {
        const i = boneIdx.get(boneName);
        if (i === undefined) continue;
        const anim = (bones[i].anims || []).find(a => a.name === getClip() && a.hasTransform);
        if (!anim) continue;
        for (let k = 0; k < p2.rot.length && k < anim.rot.length; k++) anim.rot[k].q = p2.rot[k].q.slice();
        anim.initR = p2.initR.slice();
        n++;
      }
      json = fresh; jsonClip = getClip(); dirty = 0;
      sync();
      onPoseChanged && onPoseChanged();
      return { ok: true, msg: 'discarded, ' + n + ' bones reloaded from disk' };
    } catch (e) {
      return { ok: false, msg: 'error: ' + e.message };
    }
  }

  function paintSelection() {
    for (const m of group.children) {
      if (!m.isMesh) continue;
      const sel = selection.indexOf(m.userData.bone);
      m.material.color.setHex(
        sel < 0 ? (m === picked ? 0xffd24a : 0x37c8ff)
                : (sel === selection.length - 1 ? 0xff5aa8 : 0xffd24a));
    }
    if (userGroup) {
      for (const m of userGroup.children) {
        if (!m.isMesh) continue;
        const sel = selection.indexOf(m.userData.userBone);
        m.material.color.setHex(
          sel < 0 ? 0x7bf58a : (sel === selection.length - 1 ? 0xff5aa8 : 0xffd24a));
      }
    }
  }

  // Joins the selection: everything hangs off the last picked bone.
  function joinSelection() {
    if (selection.length < 2) return { ok: false, msg: 'select at least 2 bones' };
    const parent = selection[selection.length - 1];
    let done = 0;
    const errs = [];
    for (const name of selection.slice(0, -1)) {
      const r = linkBone(name, parent);
      if (r.ok) done++; else errs.push(name + ': ' + r.msg);
    }
    clearSelection2();
    return { ok: done > 0, msg: done + ' joined to ' + parent + (errs.length ? ' · ' + errs[0] : '') };
  }

  // Nearest bone to a clicked point. pickUserBoneAt only considers the user's
  // own bones (the link source must be one of those); pickAnyBoneAt also
  // considers the skeleton, since anything can be a link target.
  function pickUserBoneAt(renderPoint) {
    const p = [renderPoint.x, renderPoint.y, -renderPoint.z];
    let best = null, bd = Infinity;
    for (const b of userBones) {
      const w = userWorld(b);
      if (!w) continue;
      const d = (w[0]-p[0])**2 + (w[1]-p[1])**2 + (w[2]-p[2])**2;
      if (d < bd) { bd = d; best = b.name; }
    }
    return best;
  }

  function pickAnyBoneAt(renderPoint) {
    const p = [renderPoint.x, renderPoint.y, -renderPoint.z];
    let best = pickUserBoneAt(renderPoint), bd = Infinity;
    if (best) {
      const w = userWorld(userBones.find(b => b.name === best));
      bd = (w[0]-p[0])**2 + (w[1]-p[1])**2 + (w[2]-p[2])**2;
    }
    for (let i = 0; i < bones.length; i++) {
      const w = worlds[i];
      const d = (w[12]-p[0])**2 + (w[13]-p[1])**2 + (w[14]-p[2])**2;
      if (d < bd) { bd = d; best = bones[i].name; }
    }
    return best;
  }

  // ---------------------------------------------------------------- picking

  function toNdc(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  }

  function onDown(ev) {
    if (ev.button !== 0 || !markers) return false;
    toNdc(ev);
    rayc.setFromCamera(ndc, camera);
    let hit = rayc.intersectObjects(markers, false)[0];
    if (!hit) {
      // nothing on a sphere: try the bones themselves. A hit on a segment
      // selects its child bone, so you can grab a limb along its length.
      const boneHit = pickLine();
      if (boneHit < 0) return false;
      hit = { object: markers[boneHit] };
    }

    picked = hit.object;
    highlight();
    const ci = boneIdx.get(picked.userData.bone);
    const pi = parentIndexOf(ci);
    if (pi < 0) { drag = null; window.__poseGrab = false; report(picked.userData.bone + ' is a root bone, no parent to rotate'); return true; }

    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), worldPos(ci));
    drag = { ci, pi, moved: false };
    window.__poseGrab = true;   // stops the camera orbit handler for this gesture
    report('drag to pose, rotating ' + bones[pi].name);
    return true;
  }

  // Raycast against the skeleton lines. The threshold scales with the model so
  // it feels the same on a 5 unit prop and on a 170 unit character.
  function pickLine() {
    if (!skelLines || !segBone.length) return -1;
    const saved = rayc.params.Line ? rayc.params.Line.threshold : undefined;
    if (rayc.params.Line) rayc.params.Line.threshold = Math.max(0.5, lastRadius * 0.02);
    const hit = rayc.intersectObject(skelLines, false)[0];
    if (rayc.params.Line && saved !== undefined) rayc.params.Line.threshold = saved;
    if (!hit || hit.index === undefined) return -1;
    const seg = Math.floor(hit.index / 2);
    return segBone[seg] === undefined ? -1 : segBone[seg];
  }

  function onMove(ev) {
    if (!drag) return false;
    toNdc(ev);
    rayc.setFromCamera(ndc, camera);
    if (!rayc.ray.intersectPlane(plane, hitPoint)) return true;
    if (wholeLine) {
      const solved = solveChain(drag.ci, hitPoint, 4);
      if (solved.length) { drag.solved = solved; drag.moved = true; }
    } else {
      const res = rotateParentToward(drag.pi, drag.ci, hitPoint);
      if (!res) return true;
      drag.result = res;
      drag.moved = true;
      applyLive(drag.pi, res.q);          // live preview in the current range
    }
    onPoseChanged && onPoseChanged();
    sync();
    return true;
  }

  function onUp() {
    window.__poseGrab = false;
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) { sync(); return; }

    if (d.solved) {                       // whole line: write every joint moved
      let total = 0, bonesHit = 0;
      for (const { pi, q } of d.solved) {
        const n2 = writeRange(bones[pi].name, q, range.from, range.to);
        if (n2) { total += n2; bonesHit++; }
      }
      report(total ? `${bonesHit} bones, ${total} keys between ${range.from} and ${range.to} ms, unsaved (${dirty})`
                   : `no key between ${range.from} and ${range.to} ms, widen the range`);
      sync();
      return;
    }

    if (!d.result) { sync(); return; }
    const name = bones[d.pi].name;
    const n = writeRange(name, d.result.q, range.from, range.to);
    report(n ? `${name} · ${n} keys between ${range.from} and ${range.to} ms · unsaved (${dirty})`
             : `${name} has no key between ${range.from} and ${range.to} ms, widen the range`);
    sync();
  }

  let reporter = null;
  function report(msg) { if (reporter) reporter(msg); }

  return {
    group,
    buildMarkers,
    sync,
    onDown, onMove, onUp,
    save,
    commitToResource,
    addBoneAt, removeNearestUserBone, saveUserBones, linkBone, chainUserBones, resetReparents,
    toggleSelect, joinSelection, clearMultiSelection: clearSelection2,
    deleteSelection, discardEdits,
    setWholeLine, isWholeLine, setChainLength, getChainLength,
    retargetMixamo, retargetReport, loadBoneMap,
    setTimeMode: m => { timeMode = m; return timeMode; }, getTimeMode: () => timeMode,
    setSourceRange: (a, b) => { srcFrom = a || 0; srcTo = b || 0; },

    // Bake the preview speed into the clip, which is what the game reads.
    setClipSpeed(factor) {
      if (!(factor > 0)) return { ok: false, msg: 'speed has to be above zero' };
      const j = ensureJson();
      const r = scncodec.scaleClipTime(j, factor);
      if (!r.ok) return { ok: false, msg: r.error };

      // and move the live skeleton the same way, or the preview keeps playing
      // at the old timing until the file is reopened
      const clip = getClip();
      for (const b of bones) {
        for (const a of (b.anims || [])) {
          if (a.name !== clip || !a.hasTransform) continue;
          for (const which of ['rot', 'trans', 'scale']) {
            if (!a[which]) continue;
            let prev = -1;
            for (const k of a[which]) {
              let t = Math.round(k.t / factor);
              if (t <= prev) t = prev + 1;
              k.t = prev = t;
            }
          }
          a.duration = Math.max(r.duration, Math.round(a.duration / factor));
        }
      }
      dirty++;
      onPoseChanged && onPoseChanged();
      return { ok: true, msg: r.keys + ' keys moved, clip is now ' + (r.duration / 4800).toFixed(2) +
        's' + (r.nudged ? ' (' + r.nudged + ' keys landed on the same tick and were nudged apart)' : '') +
        ' - press Save to keep it' };
    },
    hasSource: () => !!lastSource,
    mappingRows, setBoneEnabled, mirrorSides,
    toggleMirror: () => { mirrorZ = !mirrorZ; return mirrorZ; }, isMirrored: () => mirrorZ,
    setMethod: m => { method = m; return method; }, getMethod: () => method,
    setOrient: o => { orient = o; return orient; }, getOrient: () => orient,
    keyTicks, keyIndexAt,
    _solveChain: solveChain, _chainOf: chainOf,
    selectionNames: () => selection.slice(),
    pickUserBoneAt, pickAnyBoneAt,
    userBoneCount: () => userBones.length,
    setRange(from, to) { range.from = from; range.to = to; },
    getRange() { return { from: range.from, to: range.to }; },
    setReporter(fn) { reporter = fn; },
    clearSelection() { picked = null; drag = null; highlight(); },
    isDragging() { return !!drag; },
    pendingEdits() { return dirty; },
    resetClip() { json = null; jsonClip = null; dirty = 0; },
    scnPath,
    _rotateParentToward: rotateParentToward,   // exposed for test_pose_editor.js
    _userWorld: userWorld,
    _pickLine: pickLine,
    _rayc: rayc,
    _segCount: () => segBone.length,
    _userBones: () => userBones,
  };
}

module.exports = { createPoseEditor };
