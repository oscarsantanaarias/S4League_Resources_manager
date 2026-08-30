'use strict';

// Adding a folder must bring everything under it, however deep, with the
// subfolder structure preserved. Run: node src/utils/test_collectFiles.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectDroppedFiles } = require('./collectFiles');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-'));
const mk = (rel, body) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body || rel);
  return abs;
};

// effects/
//   top.dds
//   boss/
//     fx.dds
//     deep/
//       deeper/
//         buried.tga
//   empty/            <- no files, must not produce an entry
mk('effects/top.dds');
mk('effects/boss/fx.dds');
mk('effects/boss/deep/deeper/buried.tga');
fs.mkdirSync(path.join(root, 'effects', 'empty'), { recursive: true });
const loose = mk('loose.txt');

(async () => {
  const got = await collectDroppedFiles([path.join(root, 'effects')]);
  const names = got.map(f => f.relativeName).sort();

  assert.deepStrictEqual(names, [
    'effects/boss/deep/deeper/buried.tga',
    'effects/boss/fx.dds',
    'effects/top.dds',
  ], 'wrong file list: ' + JSON.stringify(names, null, 1));

  // every entry must point at a file that really exists
  for (const f of got) {
    assert.ok(fs.existsSync(f.filePath), 'missing source file ' + f.filePath);
    assert.ok(!f.relativeName.includes('\\'), 'backslash left in ' + f.relativeName);
  }

  // a plain file keeps just its name, no folder prefix
  const one = await collectDroppedFiles([loose]);
  assert.deepStrictEqual(one.map(f => f.relativeName), ['loose.txt']);

  // mixing a folder and a file in one call
  const both = await collectDroppedFiles([path.join(root, 'effects'), loose]);
  assert.strictEqual(both.length, 4, 'expected 3 + 1, got ' + both.length);

  console.log('ok  ' + names.length + ' files found, 3 levels deep');
  console.log('    ' + names.join('\n    '));
  console.log('ok  empty folders skipped, loose file kept its bare name');

  fs.rmSync(root, { recursive: true, force: true });
})().catch(e => {
  fs.rmSync(root, { recursive: true, force: true });
  console.error(e.message);
  process.exit(1);
});
