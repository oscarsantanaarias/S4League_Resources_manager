'use strict';

// Arrange Scn Files: give it a folder and every .scn inside gets its own
// subfolder holding the .scn plus the textures it names.
//
//   before                    after
//   weapons/                  weapons/organized_scns/
//     taserplasma.scn           taserplasma/
//     taserplasma.dds             taserplasma.scn
//     taser_effect_1.dds          taserplasma.dds
//     katana.scn                  taser_effect_1.dds
//     ...                       katana/
//                                 katana.scn
//                                 ...
//
// Everything lands under organized_scns/ so the source folder is left as it
// was and a second run has an obvious place to skip.
//
// Files are COPIED, never moved: a texture shared by two scenes has to land in
// both folders, and a half finished run must not leave the source folder gutted.

const fs = require('fs');
const path = require('path');
const { getScnTextureRefs } = require('../preview/preview');

const TEX_EXT = /\.(dds|tga|png|jpg|jpeg|bmp)$/i;
const OUT_DIR = 'organized_scns';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function arrangeScnFolder(root, opts) {
  const options = opts || {};
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error('not a folder: ' + root);
  }

  const outRoot = path.join(root, OUT_DIR);
  // ignore our own output: on a second run its copies would shadow the originals
  const inOutput = f => !path.relative(outRoot, f).startsWith('..');
  const all = walk(root, []).filter(f => !inOutput(f) || /\.scn$/i.test(f));

  // index every candidate texture by bare lowercase name so a .scn that says
  // "model/weapon/foo.dds" still finds foo.dds wherever it actually sits
  const byName = new Map();
  for (const f of all) {
    if (!TEX_EXT.test(f)) continue;
    const k = path.basename(f).toLowerCase();
    if (!byName.has(k)) byName.set(k, f);
  }

  const scenes = all.filter(f => /\.scn$/i.test(f));
  const done = [];
  const missing = [];

  for (const scnPath of scenes) {
    const stem = path.basename(scnPath, path.extname(scnPath));

    // already arranged by an earlier run: skip anything already inside the
    // output folder instead of arranging the copies again
    if (inOutput(scnPath)) {
      done.push({ scn: scnPath, folder: path.dirname(scnPath), copied: 0, skipped: true });
      continue;
    }

    const outDir = path.join(outRoot, stem);
    fs.mkdirSync(outDir, { recursive: true });

    const buf = fs.readFileSync(scnPath);
    fs.writeFileSync(path.join(outDir, path.basename(scnPath)), buf);

    let copied = 0;
    const wanted = new Set();
    for (const ref of getScnTextureRefs(buf)) wanted.add(ref.fileName.toLowerCase());

    for (const name of wanted) {
      const src = byName.get(name);
      if (!src) { missing.push({ scn: path.basename(scnPath), texture: name }); continue; }
      const dest = path.join(outDir, path.basename(src));
      if (path.resolve(src) === path.resolve(dest)) continue;
      fs.copyFileSync(src, dest);
      copied++;
    }

    done.push({ scn: scnPath, folder: outDir, textures: wanted.size, copied });
  }

  return {
    root,
    outRoot,
    scenes: scenes.length,
    arranged: done.filter(d => !d.skipped).length,
    alreadyArranged: done.filter(d => d.skipped).length,
    copied: done.reduce((a, d) => a + (d.copied || 0), 0),
    missing,
    details: options.details ? done : undefined,
  };
}

module.exports = { arrangeScnFolder };
