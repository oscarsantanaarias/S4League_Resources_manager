'use strict';

// Arrange must give every .scn its own folder holding the scene and the
// textures it names, leave the source files alone, report textures it could not
// find, and do nothing the second time it runs.
// Run: node src/utils/test_arrangeScn.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { arrangeScnFolder } = require('./arrangeScn');
const { getScnTextureRefs } = require('../preview/preview');

const SAMPLE = [
  process.argv[2],
  'C:/S4Plain/extracted_resources/resources/model/weapon/taserplasma.scn',
].find(f => f && fs.existsSync(f));

if (!SAMPLE) {
  console.log('skip: no .scn available (pass one as argument)');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arrange-'));
const scnBuf = fs.readFileSync(SAMPLE);
const stem = path.basename(SAMPLE, '.scn');

// flat folder: the scene, the textures it wants, plus one unrelated file
fs.writeFileSync(path.join(root, path.basename(SAMPLE)), scnBuf);
const wanted = [...new Set(getScnTextureRefs(scnBuf).map(r => r.fileName.toLowerCase()))];
assert.ok(wanted.length > 1, 'sample scene names too few textures to be a useful test');

const present = wanted.slice(0, wanted.length - 1);      // leave one out on purpose
const absent = wanted[wanted.length - 1];
for (const t of present) fs.writeFileSync(path.join(root, t), 'fake ' + t);
fs.writeFileSync(path.join(root, 'unrelated.txt'), 'not a texture');

const r = arrangeScnFolder(root);

assert.strictEqual(r.scenes, 1, 'expected 1 scene, got ' + r.scenes);
assert.strictEqual(r.arranged, 1, 'scene was not arranged');

const out = path.join(root, 'organized_scns', stem);
assert.ok(fs.existsSync(path.join(root, 'organized_scns')), 'no organized_scns folder');
assert.ok(fs.existsSync(out), 'no folder named after the scene');
assert.ok(fs.existsSync(path.join(out, path.basename(SAMPLE))), 'the .scn was not put inside');

for (const t of present) {
  assert.ok(fs.existsSync(path.join(out, t)), 'missing texture in the folder: ' + t);
}
assert.ok(!fs.existsSync(path.join(out, 'unrelated.txt')), 'an unrelated file was dragged in');

// the one we never created must be reported, not silently dropped
assert.ok(r.missing.some(m => m.texture === absent),
  'the missing texture ' + absent + ' was not reported');

// sources are copied, not moved
assert.ok(fs.existsSync(path.join(root, path.basename(SAMPLE))), 'the source .scn disappeared');
for (const t of present) assert.ok(fs.existsSync(path.join(root, t)), 'source texture moved: ' + t);

// running again must not nest folders inside folders
const before = fs.readdirSync(out).length;
const r2 = arrangeScnFolder(root);
assert.ok(!fs.existsSync(path.join(out, stem)), 'second run nested a folder inside the first');
assert.ok(!fs.existsSync(path.join(root, 'organized_scns', 'organized_scns')), 'second run nested organized_scns');
assert.strictEqual(fs.readdirSync(out).length, before, 'second run changed the arranged folder');
assert.strictEqual(r2.alreadyArranged, 1, 'the arranged copy was not recognised as done');

console.log('ok  ' + stem + ': ' + r.copied + ' textures copied into organized_scns/' + stem + '/');
console.log('    ' + r.missing.length + ' reported missing, sources untouched, unrelated files ignored');
console.log('ok  running twice is a no-op');

fs.rmSync(root, { recursive: true, force: true });
