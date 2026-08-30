'use strict';

// The .bmap is the mapping the S4 tooling itself uses, so parsing it wrong is
// worse than having no map: it looks authoritative and sends bones elsewhere.
// Run: node src/utils/test_boneMap.js [path/to/file.bmap]

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseBoneMap, applyBoneMap, normalizeKey } = require('./boneMap');

const SAMPLE = [
  'Bip01 Head%False%ABSOLUTE%0.0,0.0,0.0%0.0,0.0,0.0%1.0%False%False%Y%',
  'mixamorig:Head',
  'False',
  'False',
  '',
  'None%False%ABSOLUTE%0.0,0.0,0.0%0.0,0.0,0.0%1.0%False%False%Y%',
  'mixamorig:HeadTop_End',
  'False',
  'False',
  '',
  'Bip01%False%ABSOLUTE%0.0,0.0,0.0%0.0,0.0,0.0%1.0%False%False%Y%',
  'mixamorig:Hips',
  'True',
  'False',
  '',
].join('\n');

const p = parseBoneMap(SAMPLE);
assert.strictEqual(p.count, 2, 'expected 2 real pairs, got ' + p.count);
assert.strictEqual(p.mapping['mixamorigHead'], 'Bip01 Head');

// the root goes to Bip01, not to the pelvis; this is the one that tips the body
assert.strictEqual(p.mapping['mixamorigHips'], 'Bip01', 'Hips must map to the root');
assert.deepStrictEqual(p.rootMotion, ['mixamorigHips'], 'root motion flag not read');

// "None" is a deliberate decision, not a gap: it must never be guessed at
assert.ok(p.unmapped.includes('mixamorigHeadTop_End'), 'None target not recorded as unmapped');
assert.ok(!('mixamorigHeadTop_End' in p.mapping), 'a None target became a mapping');

// names come with a colon in the file and often without one in a track
assert.strictEqual(normalizeKey('mixamorig:LeftArm'), normalizeKey('mixamorigLeftArm'));

const applied = applyBoneMap(p, ['mixamorig:Head', 'mixamorig:Hips', 'mixamorig:HeadTop_End', 'mixamorig:Nope'],
  ['Bip01 Head', 'Bip01']);
assert.strictEqual(applied.mapping['mixamorig:Head'], 'Bip01 Head', 'colon form did not resolve');
assert.strictEqual(applied.matched, 2);
assert.deepStrictEqual(applied.declaredUnmapped, ['mixamorig:HeadTop_End']);
assert.deepStrictEqual(applied.unknown, ['mixamorig:Nope'], 'a bone the file never mentions must be reported');

// a target the skeleton does not have is dropped, not forced
const missingTarget = applyBoneMap(p, ['mixamorig:Hips'], ['Bip01 Head']);
assert.strictEqual(missingTarget.matched, 0);
assert.deepStrictEqual(missingTarget.absent, ['mixamorig:Hips']);

console.log('ok  parses pairs, reads root motion, honours None, matches with or without the colon');

const REAL = [process.argv[2], path.join(__dirname, '../../nuevo/s4zen rght bones.bmap')].find(f => f && fs.existsSync(f));
if (!REAL) {
  console.log('skip: no real .bmap to check');
  process.exit(0);
}

const r = parseBoneMap(fs.readFileSync(REAL, 'utf8'));
assert.ok(r.count > 20, 'only ' + r.count + ' pairs parsed from the real file');
assert.strictEqual(r.mapping['mixamorigHips'], 'Bip01', 'the real file must send Hips to Bip01');
assert.strictEqual(new Set(Object.values(r.mapping)).size, r.count, 'two sources share one target');
for (const t of Object.values(r.mapping)) {
  assert.ok(t && t.toLowerCase() !== 'none', 'a None slipped into the mapping');
}

console.log('ok  ' + path.basename(REAL) + ': ' + r.count + ' pairs, ' + r.unmapped.length +
            ' unmapped, root motion on ' + r.rootMotion.join(', '));
