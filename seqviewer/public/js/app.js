import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { parseSeq } from './seq.js';
import { ParticleNode } from './particles.js';
import { parseScn } from './scn.js';
import { assembleFull, mergeClips } from './scnSkin.js';
import { buildScene, buildCharacter, extentOf, disposeGroup } from './scnRender.js';

const $ = s => document.querySelector(s);
const wrap = $('#canvasWrap');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10000);
camera.position.set(0, 70, 210);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 30, 0);

let grid = new THREE.GridHelper(400, 20, 0x2a3442, 0x1a2028);
scene.add(grid);

let sysNodes = [];
let current = null;
let playing = true;
let tMs = 0;
let last = performance.now();
let lastExtent = 100;
let lastFull = 100;
let boost = 1;
let cameraPlaced = false;
let autoFit = false;

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  for (const s of sysNodes) s.setPixelScale(pixelScale());
}
new ResizeObserver(resize).observe(wrap);
resize();

const ddsLoader = new DDSLoader();
const tgaLoader = new TGALoader();
const texLoader = new THREE.TextureLoader();
const texCache = new Map();

function sniff(buf) {
  const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  const s = String.fromCharCode(...b);
  if (s.startsWith('DDS ')) return 'dds';
  if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'png';
  if (s.startsWith('BM')) return 'bmp';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  return 'tga';
}

async function textureFromBuffer(buf) {
  const type = sniff(buf);

  if (type === 'dds') {
    const d = ddsLoader.parse(buf, true);
    if (!d || !d.mipmaps?.length) return null;
    const t = new THREE.CompressedTexture(d.mipmaps, d.width, d.height, d.format);
    if (d.mipmapCount === 1) t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  if (type === 'tga') {
    const d = tgaLoader.parse(buf);
    if (!d || !d.data) return null;
    const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat);
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  const bmp = await createImageBitmap(new Blob([buf]));
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

function loadTexture(file) {
  if (texCache.has(file)) return texCache.get(file);
  const p = (async () => {
    try {
      const r = await fetch('/res/' + encodeURIComponent(file));
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const t = await textureFromBuffer(buf);
      if (t) {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (t.wrapS !== THREE.RepeatWrapping) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      }
      return t;
    } catch {
      return null;
    }
  })();
  texCache.set(file, p);
  return p;
}

let seqScnGroup = null;
let scnGroup = null;
let charaGroup = null;
let sceneAnimators = [];
let clipIdx = 0;

function allClips() { const s = new Set(); for (const a of sceneAnimators) for (const c of a.clips) s.add(c); return [...s]; }
function updateAnimHud() {
  const el = document.getElementById('animhud'); if (!el) return;
  const clips = allClips();
  el.textContent = clips.length ? `anim: ${clips[clipIdx % clips.length]}  (${(clipIdx % clips.length) + 1}/${clips.length})  ·  Q/E cycles` : '';
  el.style.display = clips.length ? 'block' : 'none';
}

function clearNodes() {
  for (const s of sysNodes) { scene.remove(s.points); s.dispose(); }
  sysNodes = [];
  for (const g of [seqScnGroup, scnGroup]) {
    if (g) { scene.remove(g); disposeGroup(g); }
  }
  seqScnGroup = scnGroup = null;
  sceneAnimators = [];
  clipIdx = 0;
  updateAnimHud();
}

window.addEventListener('keydown', e => {
  const clips = allClips();
  if (!clips.length) return;
  if (e.key.toLowerCase() === 'e') { clipIdx = (clipIdx + 1) % clips.length; updateAnimHud(); }
  else if (e.key.toLowerCase() === 'q') { clipIdx = (clipIdx - 1 + clips.length) % clips.length; updateAnimHud(); }
});

async function loadScn(file) {
  const r = await fetch('/res/' + encodeURIComponent(file));
  if (!r.ok) throw new Error(`could not read ${file} (${r.status})`);
  return parseScn(await r.arrayBuffer());
}

async function openScn(file) {
  clearNodes();
  current = null;
  const scn = await loadScn(file);
  scn.sharedSpace = new URLSearchParams(location.search).get('shared') === '1';
  const { group, stats, animate, clips, duration } = await buildScene(scn, f => loadTexture(f));
  scnGroup = group;
  sceneAnimators = animate ? [{ animate, clips: clips || [] }] : [];
  scnDuration = duration || 0;
  clipIdx = 0; updateAnimHud();
  scene.add(group);

  let radius, center, floorY = null;
  {
    const box = new THREE.Box3(), v = new THREE.Vector3();
    const clip = clips && clips.length ? clips[0] : '';
    const sweep = () => { for (const o of group.children) { const p = o.geometry.attributes.position.array; for (let i = 0; i + 2 < p.length; i += 3) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2])); } };
    if (animate && duration > 0) { for (let i = 0; i <= 12; i++) { animate(duration * i / 12, clip); sweep(); } animate(0, clip); }
    else sweep();
    if (!box.isEmpty()) { const s = box.getBoundingSphere(new THREE.Sphere()); if (isFinite(s.radius) && s.radius > 0) { radius = Math.max(1, s.radius); center = s.center; floorY = box.min.y; } }
  }
  if (radius == null) { const e = extentOf(group); radius = e.radius; center = e.center; }
  radius *= 1.6;
  lastExtent = radius; lastFull = radius;
  if (!cameraPlaced || autoFit) { fitCamera(radius, radius, center, floorY); cameraPlaced = true; }

  $('#hud').innerHTML = `<b>${file}</b><br>` +
    `${stats.meshes} meshes · ${Math.round(stats.tris)} triangles · ` +
    `${scn.bones.length} bones · ${scn.animNames.length} clips · ` +
    `${stats.textures} textures` +
    (stats.untextured ? ` · <span style="color:#ff64c8">${stats.untextured} untextured</span>` : '');

  $('#info').innerHTML = `
    <div class="node">
      <div class="kv">version <b>${scn.version}</b></div>
      <div class="kv">models <b>${scn.models.length}</b> · with geometry <b>${scn.meshes.length}</b></div>
      <div class="kv">bones <b>${scn.bones.length}</b> · clips <b>${scn.animNames.length}</b></div>
    </div>` + scn.meshes.slice(0, 60).map(m => `
    <div class="node">
      <div><span class="cls">${m.name || '(unnamed)'}</span></div>
      <div class="kv">verts <b>${m.positions.length / 3}</b> · tris <b>${m.indices.length / 3}</b>
           · skin <b>${m.skin.length}</b> · flags <b>${m.renderFlag}</b></div>
      ${m.texItems.filter(t => t.name).map(t => `<div class="asset">${t.name}</div>`).join('')}
    </div>`).join('') +
    (scn.animNames.length ? `<div class="node"><div class="kv">clips: ${scn.animNames.slice(0, 30).join(', ')}</div></div>` : '');
}

async function setCharacter(kind) {
  if (charaGroup) { scene.remove(charaGroup); disposeGroup(charaGroup); charaGroup = null; }
  if (!kind) return;
  try {
    const info = await (await fetch('/api/character/' + kind)).json();
    const { parts, skeleton, extraClips } = info;
    if (!parts?.length) return;

    if (kind.startsWith('bip_')) {
      const scn = await loadScn(parts[0]);
      const { group } = await buildScene(scn, f => loadTexture(f), charaPose());
      charaGroup = group; scene.add(group);
      return;
    }

    gender = kind;
    const skel = await loadScn(skeleton);
    if (extraClips) {
      try { mergeClips(skel, await loadScn(extraClips)); } catch {}
    }
    charaSkelClips = skel.animNames;
    charaData = { skel, partScns: [] };
    equipSel = {};
    await loadItemCatalog(kind);
    charaClip = pickClip(skel);
    charaClipDur = clipDuration(skel, charaClip);
    paintClips();
    await rebuildCharacter();
  } catch (e) {
    $('#err').textContent = 'character: ' + e.message;
  }
}

let scnDuration = 0;
let charaData = null;
let charaSkelClips = [];
let charaClip = '';
let charaClipDur = 0;
let lastPose = 0;

function activeDuration() {
  if (current?.duration) return current.duration;
  if (scnDuration) return scnDuration;
  if (charaClipDur) return charaClipDur;
  return 5000;
}

function clipDuration(skel, name) {
  for (const b of skel.bones) for (const a of b.anims) if (a.name === name && a.duration) return a.duration;
  return 0;
}

function pickClip(skel) {
  for (const pref of ['00074', '00008']) if (skel.animNames.includes(pref)) return pref;
  for (const n of skel.animNames) {
    if (n === 'BASE') continue;
    if (clipDuration(skel, n) > 200) return n;
  }
  return skel.animNames[0] || '';
}

function charaPose() {
  return { clipA: charaClip || charaSkelClips[0] || '', clipB: '', tickA: Math.round(tMs), tickB: 0, blend: 0 };
}

let weaponScn = null;
let anchorName = 'R_Hand_Dummy';
let equipSel = {};
let gender = 'male';

async function rebuildCharacter() {
  if (!charaData) return;
  if (charaGroup) { scene.remove(charaGroup); disposeGroup(charaGroup); charaGroup = null; }

  const partScns = [];
  const attach = [];
  for (const slot of ['body', 'leg', 'foot', 'hand', 'face', 'hair']) {
    const it = equipSel[slot];
    const file = it ? it.part : `00_${gender}_${slot}.scn`;
    if (file) {
      try { partScns.push(await loadScn(file)); } catch {}
    }
    for (const n of (it?.nodes || [])) {
      try { attach.push({ scene: await loadScn(n.file), anchor: n.parent }); } catch {}
    }
  }
  for (const cat of ['accessories', 'pets']) {
    for (const n of (equipSel[cat]?.nodes || [])) {
      try { attach.push({ scene: await loadScn(n.file), anchor: n.parent }); } catch {}
    }
  }
  if (weaponScn) attach.push({ scene: weaponScn, anchor: anchorName });

  charaData.partScns = partScns;
  const { group } = await buildCharacter(
    charaData.skel, partScns, f => loadTexture(f), charaPose(), attach);
  charaGroup = group;
  charaAttach = attach;
  scene.add(group);
}
let charaAttach = [];

function updateCharacterPose() {
  if (!charaData || !charaGroup || !charaSkelClips.length) return;
  const pieces = assembleFull(charaData.skel, charaData.partScns, charaAttach, charaPose());
  const meshes = charaGroup.children;
  const n = Math.min(pieces.length, meshes.length);
  for (let i = 0; i < n; i++) {
    const attr = meshes[i].geometry.attributes.position;
    if (!attr || attr.array.length !== pieces[i].positions.length) continue;
    attr.array.set(pieces[i].positions);
    attr.needsUpdate = true;
    meshes[i].geometry.computeVertexNormals();
  }
}

function pixelScale() {
  const h = Math.max(1, wrap.clientHeight) * Math.min(devicePixelRatio, 2);
  return h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

function fitCamera(focus, full = focus, center = new THREE.Vector3(), floorY = null) {
  const r = Math.max(10, focus);
  camera.near = Math.max(0.1, r / 500);
  camera.far = Math.max(full, r) * 20;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  camera.position.set(center.x + r * 0.8, center.y + r * 1.1, center.z + r * 2.6);
  controls.update();

  scene.remove(grid);
  grid = new THREE.GridHelper(r * 2, 20, 0x2a3442, 0x1a2028);
  grid.position.set(center.x, floorY == null ? 0 : floorY, center.z);
  scene.add(grid);
}

async function build(seq) {
  clearNodes();
  const parts = seq.nodes.filter(n => n.emitters !== undefined);
  const texes = await Promise.all(
    parts.map(n => n.textures?.[0] ? loadTexture(n.textures[0].file) : Promise.resolve(null)));

  let loaded = 0, focus = 0, full = 0;
  parts.forEach((n, i) => {
    const sys = new ParticleNode(n, texes[i], 1);
    if (texes[i]) loaded++;
    focus = Math.max(focus, sys.focusExtent());
    full = Math.max(full, sys.fullExtent());
    scene.add(sys.points);
    sysNodes.push(sys);
  });

  lastExtent = focus; lastFull = full;
  if (!cameraPlaced || autoFit) { fitCamera(focus, full); cameraPlaced = true; }
  else { camera.far = Math.max(full, lastExtent) * 20; camera.updateProjectionMatrix(); }
  const ps = pixelScale() * boost;
  for (const s of sysNodes) s.setPixelScale(ps);

  const scnRefs = [...new Set(seq.nodes.flatMap(n =>
    (n.assets || []).filter(a => a.ext === 'scn').map(a => a.file)))];
  let scnOk = 0;
  if (scnRefs.length) {
    const g = new THREE.Group();
    for (const f of scnRefs) {
      try {
        const scn = await loadScn(f);
        const built = await buildScene(scn, t => loadTexture(t));
        g.add(built.group);
        if (built.animate) sceneAnimators.push({ animate: built.animate, clips: built.clips || [] });
        scnOk++;
      } catch {}
    }
    if (g.children.length) { seqScnGroup = g; scene.add(g); }
    updateAnimHud();
  }

  const missingTex = parts.length - loaded;
  $('#hud').innerHTML =
    `<b>${seq._file}</b><br>${seq.duration} ms · ${seq.nodes.length} nodes · ` +
    `${parts.length} particle nodes · ${loaded} textures` +
    (scnRefs.length ? ` · ${scnOk}/${scnRefs.length} .scn scenes` : '') +
    (missingTex ? ` · <span style="color:#ff64c8">${missingTex} UNTEXTURED (magenta)</span>` : '') +
    ` · emission ${Math.round(focus)} u · travel ${Math.round(full)} u`;
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = now - last; last = now;

  const dur = activeDuration();
  if (playing) {
    tMs = (tMs + dt) % Math.max(1, dur);
    $('#scrub').value = String(Math.round(1000 * tMs / dur));
  }
  $('#time').textContent = `${Math.round(tMs)} / ${Math.round(dur)} ms`;
  for (const a of sceneAnimators) a.animate(tMs, a.clips.length ? a.clips[clipIdx % a.clips.length] : '');
  if (current) {
    for (const s of sysNodes) s.update(tMs);
    if (now - lastDiag > 250) { lastDiag = now; updateDiag(); }
  }
  if (playing && charaData && now - lastPose > 40) { lastPose = now; updateCharacterPose(); }
  controls.update();
  renderer.render(scene, camera);
}

let lastDiag = 0;
function updateDiag() {
  const total = sysNodes.reduce((a, s) => a + s.stats.alive, 0);
  const s0 = sysNodes[0];
  const p = s0?.stats.first;
  const d = p ? camera.position.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) : 0;
  const px = p ? Math.max(2, s0.stats.size * pixelScale() * boost / Math.max(1, d)) : 0;
  $('#diag').innerHTML =
    `alive <b>${total}</b> · node0 <b>${s0?.stats.alive ?? 0}</b>/${s0?.count ?? 0}` +
    (p ? ` · pos <b>${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}</b>` +
         ` · size <b>${s0.stats.size.toFixed(1)}</b>u → <b>${px.toFixed(1)}</b>px` +
         ` · dist <b>${d.toFixed(0)}</b>` : ' · no live particles') +
    ` · cam <b>${camera.position.length().toFixed(0)}</b>`;
}
frame();

$('#play').onclick = () => {
  playing = !playing;
  $('#play').textContent = playing ? '❚❚ Pause' : '▶ Play';
};
$('#play').textContent = '❚❚ Pause';
$('#reset').onclick = () => { tMs = 0; };
$('#scrub').oninput = e => { if (current) tMs = current.duration * (e.target.value / 1000); };

$('#boost').oninput = e => {
  boost = Math.pow(2, e.target.value / 10);
  $('#boostV').textContent = boost.toFixed(1);
  for (const s of sysNodes) s.setPixelScale(pixelScale() * boost);
};
$('#fit').onclick = () => { if (current) fitCamera(lastExtent, lastFull); };
$('#autofit').onchange = e => { autoFit = e.target.checked; };

const fmt = v => !Number.isFinite(v) ? '—'
  : (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) ? v.toExponential(2) : v.toFixed(2);

function renderInfo(seq, have) {
  const rows = seq.nodes.map(n => {
    const assets = n.assets.map(a => {
      const h = have[a.file];
      if (!h?.ok) return `<div class="asset missing">⚠ ${a.path}</div>`;
      const note = h.swapped ? ` <span class="swap">→ ${h.as}</span>` : '';
      return `<div class="asset">${a.path}${note}</div>`;
    }).join('');

    let detail = '';
    if (n.emitters !== undefined) {
      const e = n.emitters[0];
      detail = `<div class="kv">
        start <b>${n.beginTime}</b> ms · end <b>${n.endTime}</b> ms ·
        max <b>${n.maxParticles}</b> · blend <b>${n.blendType}</b>
        ${n.fieldsOk ? '' : `<span class="missing">· ${n.derail || 'incomplete'}</span>`}
        </div>` + (e ? `<div class="kv">
        cone <b>${fmt(e.coneTheta)}</b>° · vel <b>${fmt(e.speed)}</b> ·
        life <b>${e.lifetime}</b> ms · <b>${e.perSecond}</b>/s ·
        grav <b>${fmt(e.gravity.y)}</b></div>` : '')
        + `<div class="kv">scene keys <b>${n.keys.length}</b> ·
             emitters <b>${n.emitters.length}</b></div>`;
    } else if (n.nodeDuration !== undefined) {
      detail = `<div class="kv">duration <b>${n.nodeDuration}</b></div>`;
    }

    return `<div class="node">
      <div><span class="cls">${n.className}</span>
        ${n.nodeName ? `<span class="nm">"${n.nodeName}"</span>` : ''}</div>
      <div class="kv">body <b>${n.bodySize}</b> B · @0x${n.fileOffset.toString(16)}</div>
      ${detail}${assets}</div>`;
  }).join('');

  $('#info').innerHTML = `
    <div class="node">
      <div class="kv">name <b>${seq.name || '(empty)'}</b></div>
      <div class="kv">duration <b>${seq.duration}</b> ms · flag <b>${seq.flag}</b></div>
      <div class="kv">nodes <b>${seq.nodes.length}</b> (header says ${seq.nodeCount})</div>
    </div>${rows}`;
}

async function open(file, el) {
  try {
    const buf = await (await fetch('/res/' + encodeURIComponent(file))).arrayBuffer();
    const seq = parseSeq(buf);
    seq._file = file;
    current = seq;
    tMs = 0;

    const files = [...new Set(seq.nodes.flatMap(n => n.assets.map(a => a.file)))];
    const have = files.length ? (await (await fetch('/api/have', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    })).json()).have : {};

    renderInfo(seq, have);
    await build(seq);
  } catch (e) {
    $('#err').textContent = `Error opening ${file}\n${e.stack || e.message}`;
  }
}

const lists = { seq: [], scn: [] };
let tab = 'seq';

async function openItem(name, el) {
  document.querySelectorAll('.item.sel').forEach(e => e.classList.remove('sel'));
  el?.classList.add('sel');
  $('#err').textContent = '';
  try {
    if (name.toLowerCase().endsWith('.scn')) await openScn(name);
    else await open(name, el);
  } catch (e) {
    $('#err').textContent = `Error opening ${name}\n${e.stack || e.message}`;
  }
}

function paint(filter = '') {
  const f = filter.toLowerCase();
  const all = lists[tab];
  const shown = all.filter(x => x.name.toLowerCase().includes(f)).slice(0, 3000);
  $('#items').innerHTML = shown.map(x =>
    `<div class="item" data-n="${x.name}">${x.name} <small>${x.size}B</small></div>`).join('');
  $('#items').querySelectorAll('.item').forEach(el => {
    el.onclick = () => openItem(el.dataset.n, el);
  });
  $('#count').textContent = `${shown.length}/${all.length}`;
}

$('#search').oninput = e => paint(e.target.value);
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    tab = b.dataset.k;
    $('#search').value = '';
    paint();
  };
});
$('#chara').onchange = e => setCharacter(e.target.value);
$('#clip').onchange = e => {
  charaClip = e.target.value;
  charaClipDur = charaData ? clipDuration(charaData.skel, charaClip) : 0;
  tMs = 0;
  updateCharacterPose();
};
$('#anchor').onchange = e => { anchorName = e.target.value; rebuildCharacter(); };
let animSetClips = [];
let animSetScript = '';

function paintClips() {
  if (!charaData) return;
  const dur = c => clipDuration(charaData.skel, c);
  const opt = c => `<option value="${c}"${c === charaClip ? ' selected' : ''}>${c} (${dur(c)}ms)</option>`;
  const weaponClips = animSetClips.filter(c => charaSkelClips.includes(c));
  const rest = charaSkelClips.filter(c => !weaponClips.includes(c));
  $('#clip').innerHTML =
    (weaponClips.length ? `<optgroup label="weapon — ${animSetScript}">${weaponClips.map(opt).join('')}</optgroup>` : '') +
    `<optgroup label="all (${rest.length})">${rest.map(opt).join('')}</optgroup>`;
}

$('#weapon').onchange = async e => {
  const f = e.target.value;
  weaponScn = null;
  animSetClips = []; animSetScript = '';
  if (f) {
    try { weaponScn = await loadScn(f); } catch (err) { $('#err').textContent = 'weapon: ' + err.message; }
    try {
      const d = await (await fetch('/api/animset?weapon=' + encodeURIComponent(f))).json();
      if (d.ok) {
        animSetClips = d.clips; animSetScript = d.script;
        const first = d.clips.find(c => charaSkelClips.includes(c));
        if (first) {
          charaClip = first;
          charaClipDur = clipDuration(charaData.skel, first);
          tMs = 0;
        }
      }
    } catch {}
  }
  paintClips();
  await rebuildCharacter();
};

async function loadItemCatalog(kind) {
  try {
    const d = await (await fetch('/api/items?sex=' + kind)).json();
    if (!d.ok) throw new Error(d.error || 'no data');
    const order = ['hair', 'face', 'body', 'leg', 'hand', 'foot', 'accessories', 'pets'];
    const titles = {
      hair: 'hair', face: 'face', body: 'torso', leg: 'legs',
      hand: 'hands', foot: 'feet', accessories: 'accessories', pets: 'pet',
    };
    const html = order.filter(s => d.bySlot[s]?.length).map(slot => {
      const list = d.bySlot[slot];
      return `<div class="slotbox"><h3>${titles[slot]} (${list.length})</h3>
        <select data-slot="${slot}">
          <option value="">— default —</option>
          ${list.map(it => `<option value="${it.key}">${it.name}</option>`).join('')}
        </select></div>`;
    }).join('');
    $('#equip').innerHTML = html || '<div class="slotbox">no items</div>';

    const byKey = new Map();
    for (const s of Object.keys(d.bySlot)) for (const it of d.bySlot[s]) byKey.set(String(it.key), it);
    $('#equip').querySelectorAll('select').forEach(sel => {
      sel.onchange = async () => {
        const slot = sel.dataset.slot;
        equipSel[slot] = sel.value ? byKey.get(sel.value) : null;
        await rebuildCharacter();
      };
    });
  } catch (e) {
    $('#equip').innerHTML = `<div class="slotbox">could not read item.x7<br><small>${e.message}</small></div>`;
  }
  await rebuildCharacter();
}

document.querySelectorAll('.stab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.stab').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    const k = b.dataset.k;
    $('#info').hidden = k !== 'info';
    $('#equip').hidden = k !== 'equip';
    $('#editor').hidden = k !== 'edit';
    if (k === 'edit') renderEditor();
  };
});

let edData = null, edTimer = 0, edAllMode = false;

async function renderEditor() {
  const ed = $('#editor');
  if (!current || !current._file) { ed.innerHTML = '<div class="slotbox">Open a sequence first.</div>'; return; }
  ed.innerHTML = '<div class="slotbox">loading…</div>';
  let r;
  try { r = await (await fetch('/api/seqjson?file=' + encodeURIComponent(current._file))).json(); }
  catch (e) { ed.innerHTML = '<div class="slotbox">error: ' + e.message + '</div>'; return; }
  if (!r.ok) { ed.innerHTML = '<div class="slotbox">' + (r.error || 'error') + '</div>'; return; }
  edData = r.seq;
  ed.innerHTML = '';

  const g = document.createElement('div'); g.className = 'edGlobal';
  const mode = document.createElement('label'); mode.className = 'edRow'; mode.style.marginBottom = '6px';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = edAllMode;
  cb.onchange = () => { edAllMode = cb.checked; renderEditor(); };
  const ms = document.createElement('span'); ms.textContent = 'Edit ALL nodes at once';
  mode.appendChild(ms); mode.appendChild(cb);
  g.appendChild(mode);
  g.appendChild(edRow('duration', edData.duration, 'duration'));
  g.appendChild(edRow('flag', edData.flag, 'flag'));
  ed.appendChild(g);

  const texSec = document.createElement('div'); texSec.id = 'edTex';
  ed.appendChild(texSec);
  renderTextures();

  if (edAllMode) {
    const keys = Object.keys(edData.nodes[0]?.fields || {});
    const det = document.createElement('details'); det.open = true;
    const sum = document.createElement('summary'); sum.textContent = `All nodes (${edData.nodes.length}) · ${keys.length} fields`;
    det.appendChild(sum);
    const body = document.createElement('div'); body.className = 'edBody';
    for (const k of keys) {
      const vals = edData.nodes.map(n => n.fields[k]);
      const diff = vals.some(v => v !== vals[0]);
      body.appendChild(edRow(k + (diff ? '  ≠' : ''), vals[0], 'all.' + k));
    }
    det.appendChild(body);
    ed.appendChild(det);
  } else {
    edData.nodes.forEach(n => {
      const keys = Object.keys(n.fields || {});
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = `#${n.i} ${n.className}${n.nodeName ? ' · ' + n.nodeName : ''} (${keys.length})`;
      det.appendChild(sum);
      const body = document.createElement('div'); body.className = 'edBody';
      for (const k of keys) body.appendChild(edRow(k, n.fields[k], 'n' + n.i + '.' + k));
      det.appendChild(body);
      ed.appendChild(det);
    });
  }

  const foot = document.createElement('div'); foot.className = 'edSave'; foot.id = 'edStatus';
  foot.textContent = edAllMode ? 'edit 1 field → applies to all ' + edData.nodes.length + ' nodes and restarts' : 'edit any value → applies and restarts automatically';
  ed.appendChild(foot);
}

function edRow(label, value, key) {
  const row = document.createElement('label'); row.className = 'edRow';
  const span = document.createElement('span'); span.textContent = label; span.title = label;
  const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.value = value; inp.dataset.key = key;
  inp.addEventListener('input', () => scheduleEdit(key, inp.value));
  row.appendChild(span); row.appendChild(inp);
  return row;
}

function scheduleEdit(key, raw) {
  if (!edData) return;
  const val = Number(raw);
  if (!Number.isFinite(val)) return;
  if (key === 'duration') edData.duration = val;
  else if (key === 'flag') edData.flag = val;
  else if (key.startsWith('all.')) { const fk = key.slice(4); for (const node of edData.nodes) if (fk in node.fields) node.fields[fk] = val; }
  else { const m = key.match(/^n(\d+)\.(.+)$/); if (m) { const node = edData.nodes.find(x => x.i === +m[1]); if (node) node.fields[m[2]] = val; } }
  clearTimeout(edTimer);
  edTimer = setTimeout(pushEdit, 250);
}

async function pushEdit() {
  if (!edData || !current || !current._file) return;
  const status = $('#edStatus');
  try {
    const res = await (await fetch('/api/seqsave?file=' + encodeURIComponent(current._file), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(edData),
    })).json();
    if (!res.ok) { if (status) status.textContent = 'error: ' + res.error; return; }
    if (status) status.textContent = `applied (${res.patched} fields) · restarted`;
    playing = true;
    await open(current._file);
  } catch (e) { if (status) status.textContent = 'error: ' + e.message; }
}

async function renderTextures() {
  const box = $('#edTex'); if (!box) return;
  box.innerHTML = '';
  let tj, tl;
  try {
    tj = await (await fetch('/api/seqtextures?file=' + encodeURIComponent(current._file))).json();
    tl = await (await fetch('/api/seqtexlist')).json();
  } catch (e) { return; }
  if (!tj.ok || !tj.textures.length) return;

  const det = document.createElement('details'); det.open = true;
  const sum = document.createElement('summary'); sum.textContent = `Textures (${tj.textures.length})`;
  det.appendChild(sum);
  const body = document.createElement('div'); body.className = 'edBody';

  const dl = document.createElement('datalist'); dl.id = 'texOptions';
  (tl.files || []).forEach(f => { const o = document.createElement('option'); o.value = f; dl.appendChild(o); });
  body.appendChild(dl);

  tj.textures.forEach(t => {
    const nameMax = t.maxLen - (t.text.length - t.file.length);
    const row = document.createElement('div'); row.className = 'edRow';
    const span = document.createElement('span'); span.textContent = t.file; span.title = t.text + '\nname max ' + nameMax + ' characters (same folder)';
    const inp = document.createElement('input'); inp.type = 'text'; inp.setAttribute('list', 'texOptions');
    inp.value = t.file; inp.style.width = '150px'; inp.maxLength = nameMax;
    inp.addEventListener('change', () => swapTexture(t, inp.value.trim(), inp));
    row.appendChild(span); row.appendChild(inp);
    body.appendChild(row);
  });
  det.appendChild(body);
  box.appendChild(det);
}

async function swapTexture(t, newFile, inp) {
  if (!newFile || newFile === t.file) return;
  const sep = t.text.includes('\\') ? '\\' : (t.text.includes('/') ? '/' : '');
  const dir = sep ? t.text.slice(0, t.text.lastIndexOf(sep) + 1) : '';
  const status = $('#edStatus');
  try {
    const res = await (await fetch('/api/seqtexpatch?file=' + encodeURIComponent(current._file), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ old: t.text, new: dir + newFile }),
    })).json();
    if (!res.ok) { if (status) status.textContent = 'texture: ' + res.error; inp.value = t.file; return; }
    if (status) status.textContent = `texture → ${newFile} (${res.changed}) · restarted`;
    playing = true;
    await open(current._file);
    renderTextures();
  } catch (e) { if (status) status.textContent = 'error: ' + e.message; inp.value = t.file; }
}

fetch('/api/weapons').then(r => r.json()).then(d => {
  if (!d.ok) return;
  $('#weapon').innerHTML = '<option value="">none</option>' +
    d.files.map(x => `<option value="${x.file}">${x.file.replace(/\.scn$/, '')}</option>`).join('');
}).catch(() => {});

Promise.all([
  fetch('/api/sequences').then(r => r.json()),
  fetch('/api/scenes').then(r => r.json()),
]).then(([s, c]) => {
  if (!s.ok) throw new Error(s.error);
  lists.seq = s.files;
  lists.scn = c.ok ? c.files : [];
  document.querySelector('.tab[data-k="seq"]').textContent = `Sequences (${lists.seq.length})`;
  document.querySelector('.tab[data-k="scn"]').textContent = `Scenes (${lists.scn.length})`;
  paint();
  const q = new URLSearchParams(location.search);
  const wantSeq = q.get('seq');
  const wantScn = q.get('scn');
  const hitSeq = wantSeq && lists.seq.find(f => f.name.toLowerCase() === wantSeq.toLowerCase());
  const hitScn = wantScn && lists.scn.find(f => f.name.toLowerCase() === wantScn.toLowerCase());
  if (hitScn) { document.querySelector('.tab[data-k="scn"]').click?.(); openItem(hitScn.name, null); }
  else if (hitSeq) openItem(hitSeq.name, null);
  else if (lists.seq.length) openItem(lists.seq[0].name, $('#items .item'));
}).catch(e => { $('#err').textContent = String(e); });
