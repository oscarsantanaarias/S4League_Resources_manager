'use strict';

// Add Costumes must be driven by the icon folder, not the model folder:
//   * one icon = one item
//   * recolors (name_1, name_8, name_atex_2) are NOT items, they only raise Colors
//   * an icon with no .scn of its own name is skipped, never given another icon
//
// collectLiveCostumeFiles lives inside main.js, which cannot be required outside
// Electron, so this rebuilds the grouping from the same helpers main.js uses and
// checks it against a real costume folder.
// Run: node src/features/test_costumeCollect.js [path/to/resources/costumes/<type>/<gender>]

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { splitRecolorBase, assetNamesMatch, cleanAssetBaseName } = require('./assetnames');

// --- the grouping, mirroring collectLiveCostumeFiles
function group(imgs, models) {
  const groups = new Map();
  for (const img of imgs) {
    const info = splitRecolorBase(img);
    if (!groups.has(info.base)) groups.set(info.base, { base: info.base, icon: null, recolors: new Set() });
    const g = groups.get(info.base);
    if (info.index > 0) g.recolors.add(info.index);
    else if (!g.icon) g.icon = img;
  }
  const items = [], skipped = [];
  for (const g of groups.values()) {
    const model = models.find(f => cleanAssetBaseName(f) === g.base)
      || models.find(f => assetNamesMatch(f, g.base));
    if (!model) { skipped.push(g.base); continue; }
    items.push({ base: g.base, model, colors: 1 + g.recolors.size });
  }
  return { items, skipped, groups: groups.size };
}

// --- synthetic: the rules, stated plainly
{
  const imgs = [
    'acc_39_female_newglasses.png',        // item
    'acc_39_female_newglasses_1.png',      // recolor
    'acc_39_female_newglasses_8.png',      // recolor
    'acc_40_female_hat_atex.png',          // item, atex is the base not a recolor
    'acc_40_female_hat_atex_2.png',        // recolor
    'orphan_icon.png',                     // no model
  ];
  const models = [
    'acc_39_female_newglasses.scn',
    'acc_40_female_hat.scn',
    'has_no_icon_at_all.scn',              // must NOT become an item
  ];

  const r = group(imgs, models);

  assert.strictEqual(r.items.length, 2, 'expected 2 items, got ' + r.items.length);

  const glasses = r.items.find(i => i.base === 'acc_39_female_newglasses');
  assert.ok(glasses, 'the glasses item is missing');
  assert.strictEqual(glasses.colors, 3, 'two recolors should give Colors 3, got ' + glasses.colors);

  const hat = r.items.find(i => i.base === 'acc_40_female_hat');
  assert.ok(hat, 'the atex icon did not resolve to its model');
  assert.strictEqual(hat.colors, 2, 'one recolor should give Colors 2, got ' + hat.colors);

  assert.ok(!r.items.some(i => i.model === 'has_no_icon_at_all.scn'),
    'a model with no icon became an item');
  assert.deepStrictEqual(r.skipped, ['orphan_icon'], 'the icon with no model was not reported');

  console.log('ok  synthetic: 2 items, Colors 3 and 2, iconless model skipped, orphan icon reported');
}

// --- against a real folder
// pass a costume folder to check against real files: node src/features/test_costumeCollect.js <dir>
const DIR = process.argv[2] || '';
if (!fs.existsSync(path.join(DIR, 'imgs')) || !fs.existsSync(path.join(DIR, 'model'))) {
  console.log('skip: no imgs/ + model/ under ' + DIR);
  process.exit(0);
}

const imgs = fs.readdirSync(path.join(DIR, 'imgs')).filter(f => /\.(dds|tga|png|jpg|bmp)$/i.test(f));
const models = fs.readdirSync(path.join(DIR, 'model')).filter(f => /\.scn$/i.test(f));
// the folders can sit there empty, and comparing counts against nothing passes
// or fails for reasons that have nothing to do with the code
if (!imgs.length || !models.length) {
  console.log('skip: ' + DIR + ' has ' + imgs.length + ' icons and ' + models.length + ' models');
  process.exit(0);
}
const r = group(imgs, models);

assert.ok(r.items.length <= imgs.length, 'more items than icons, recolors leaked in as items');
assert.ok(r.items.length < models.length, 'items still track the model count, the loop did not flip');
for (const it of r.items) assert.ok(it.colors >= 1, 'Colors below 1 on ' + it.base);

console.log('ok  ' + DIR);
console.log('    icons ' + imgs.length + ', models ' + models.length +
            ' -> ' + r.items.length + ' items, ' + r.skipped.length + ' icons with no model');
console.log('    ' + r.items.filter(i => i.colors > 1).length + ' items carry recolors');
