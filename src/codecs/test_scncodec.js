'use strict';

// Round trip guard for the .scn editor: scnToJson -> applyJson must be a no-op,
// and an edited value must land at the right offset without moving anything else.
// Run: node src/codecs/test_scncodec.js [path/to/file.scn]

const fs = require('fs');
const assert = require('assert');
const scncodec = require('./scncodec');

const CANDIDATES = [
  process.argv[2],
  'C:/S4Plain/extracted_resources/resources/model/weapon/taserplasma.scn',
].filter(Boolean);

const file = CANDIDATES.find(f => fs.existsSync(f));
if (!file) {
  console.log('skip: no .scn available (pass one as argument)');
  process.exit(0);
}

const orig = fs.readFileSync(file);
const parsed = scncodec.parse(orig);
const clip = (parsed.clipList || [])[0] || '';

const json = scncodec.scnToJson(orig, clip);
assert.ok(json.models.length > 0, 'parsed no models');

const same = scncodec.applyJson(orig, json);
assert.strictEqual(same.patched, 0, 'round trip patched ' + same.patched + ' fields, expected 0');
assert.ok(same.buf.equals(orig), 'round trip changed bytes');

const node = json.models.find(m => m.matrix && m.matrix.length === 16);
assert.ok(node, 'no model carries a matrix');
const before = node.matrix[12];
node.matrix[12] = before + 12.5;

const edited = scncodec.applyJson(orig, json);
assert.strictEqual(edited.patched, 1, 'one edit should patch exactly 1 field, got ' + edited.patched);
assert.strictEqual(edited.buf.length, orig.length, 'patch resized the file');

const back = scncodec.scnToJson(edited.buf, clip);
const readBack = back.models.find(m => m.name === node.name).matrix[12];
assert.ok(Math.abs(readBack - (before + 12.5)) < 1e-3, 'edit did not survive: ' + readBack);

let diff = 0;
for (let i = 0; i < orig.length; i++) if (orig[i] !== edited.buf[i]) diff++;
assert.ok(diff > 0 && diff <= 4, 'one float edit touched ' + diff + ' bytes, expected up to 4');

console.log('ok  ' + file);
console.log('    ' + json.models.length + ' models, ' + json.bones.length + ' bones, clip "' + clip + '"');
console.log('    round trip clean, single edit patched ' + diff + ' bytes');

// --- clip speed: the keys have to actually move, and survive a round trip
{
  const { scaleClipTime } = scncodec;
  // a weapon has a clip with no keys in it, so it proves nothing here
  const SRC = process.argv[3] || 'C:/S4Plain/extracted_resources/resources/model/character/male_bip.scn';
  if (fs.existsSync(SRC)) {
    const orig = fs.readFileSync(SRC);
    const s = scncodec.parse(orig);
    const clip = (s.clipList || []).find(c =>
      s.bones.some(b => (b.anims || []).some(a => a.name === c && a.hasTransform && a.rot && a.rot.length > 2)));
    assert.ok(clip, 'no clip with keys in ' + SRC);
    const j = scncodec.scnToJson(orig, clip);
    const before = JSON.parse(JSON.stringify(j.pose));

    const r = scaleClipTime(j, 2);
    assert.ok(r.ok, r.error);
    assert.ok(r.keys > 0, 'no keys were moved');

    // halved, and the rotations themselves untouched
    for (const [name, p] of Object.entries(j.pose)) {
      const b = before[name];
      for (const which of ['rot', 'trans', 'scale']) {
        if (!p[which]) continue;
        for (let i = 0; i < p[which].length; i++) {
          assert.ok(Math.abs(p[which][i].t - b[which][i].t / 2) <= 1,
            name + ' ' + which + ' key ' + i + ' is at ' + p[which][i].t + ', expected about ' + b[which][i].t / 2);
        }
      }
      if (p.rot) for (let i = 0; i < p.rot.length; i++) {
        // compared as text on purpose: the snapshot goes through JSON, which
        // turns -0 into 0, and deepStrictEqual calls those two different
        assert.strictEqual(JSON.stringify(p.rot[i].q), JSON.stringify(b.rot[i].q),
          'scaling the time changed a rotation: ' + name + ' key ' + i);
      }
    }

    // and it has to come back out of the file, not just the json
    const { buf, patched } = scncodec.applyJson(orig, j);
    assert.ok(patched > 0, 'nothing was written to the file');
    const back = scncodec.scnToJson(buf, clip);
    for (const [name, p] of Object.entries(j.pose)) {
      if (!p.rot) continue;
      for (let i = 0; i < p.rot.length; i++) {
        assert.strictEqual(back.pose[name].rot[i].t, p.rot[i].t,
          name + ' key ' + i + ' did not survive the write');
      }
    }

    // a time cannot run backwards, whatever the factor
    const j2 = scncodec.scnToJson(orig, clip);
    scaleClipTime(j2, 50);
    for (const p of Object.values(j2.pose)) {
      if (!p.rot) continue;
      for (let i = 1; i < p.rot.length; i++) {
        assert.ok(p.rot[i].t > p.rot[i - 1].t, 'keys collapsed onto the same tick at 50x');
      }
    }

    assert.strictEqual(scaleClipTime(j2, 0).ok, false, 'a speed of zero was accepted');
    console.log('ok  clip speed: ' + r.keys + ' keys moved, round trips through the file');
  }
}
