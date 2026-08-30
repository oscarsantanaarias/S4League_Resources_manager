'use strict';

// Swapping a texture name inside a .scn writes into a fixed 1024 byte slot.
// This drives the real function: the name must land, the slot must be NUL
// padded after it, the file size must not move, and the scene must still parse.
// Run: node src/preview/test_scnTexturePatch.js [path/to/file.scn]

const assert = require('assert');
const fs = require('fs');
const { patchScnTextureName, getScnTextureRefs } = require('./preview');
const { parseScn } = require('../engine/scn_geometry');

const file = [
  process.argv[2],
  'C:/S4Plain/extracted_resources/resources/model/weapon/taserplasma.scn',
].find(f => f && fs.existsSync(f));

if (!file) {
  console.log('skip: no .scn available (pass one as argument)');
  process.exit(0);
}

const orig = fs.readFileSync(file);
const refs = getScnTextureRefs(orig);
assert.ok(refs.length, 'no texture refs found in ' + file);

const from = refs[0].fileName;
const to = 'renamed_by_test.dds';

const { buffer, changed } = patchScnTextureName(orig, from, to);
assert.ok(changed > 0, 'nothing was changed');
assert.strictEqual(buffer.length, orig.length, 'patch resized the file');

// the new name is there, and the slot is zeroed after it
const after = getScnTextureRefs(buffer);
assert.ok(after.some(r => r.fileName.toLowerCase() === to),
  'new name not found, got: ' + after.map(r => r.fileName).join(', '));
assert.ok(!after.some(r => r.fileName.toLowerCase() === from.toLowerCase()),
  'old name ' + from + ' survived the patch');

const off = after.find(r => r.fileName.toLowerCase() === to).offset;
const tail = buffer.subarray(off + Buffer.byteLength(to, 'ascii'), off + 1024);
assert.ok(tail.every(b => b === 0), 'slot is not NUL padded after the new name');

// and the scene still loads
const scn = parseScn(buffer);
assert.ok(scn.models.length, 'scene no longer parses after the patch');

// a name that cannot fit must be refused, not silently truncated
assert.throws(() => patchScnTextureName(orig, from, 'x'.repeat(1100) + '.dds'),
  /too long/i, 'an oversized name was accepted');

// an unknown texture must say so
assert.throws(() => patchScnTextureName(orig, 'not_here_at_all.dds', to),
  /not found/i, 'a missing texture did not raise');

console.log('ok  ' + file);
console.log('    ' + from + ' -> ' + to + ', ' + changed + ' slot(s), size unchanged, scene still parses');
console.log('ok  oversized and unknown names are refused');
