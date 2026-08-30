'use strict';

// The generated SQL has to be right the first time: it is pasted into a live
// database. This checks the id ranges land on the right tabs, gender maps the
// way the shipped rows do, ids out of every range are skipped rather than
// guessed, and shop_iteminfos ids do not collide.
// Run: node src/utils/test_itemsToSql.js [path/to/item.x7]

const assert = require('assert');
const fs = require('fs');
const { parseItems, buildSql, categoryOf, itemsToSql } = require('./itemsToSql');

const XML = `
<items>
  <item item_key="1000000"><base name="A hair" name_key="X" sex="man" /><graphic icon_image="a.png" /></item>
  <item item_key="1020093"><base name="Neo-Shark Top (F)" name_key="Y" sex="woman" /><graphic icon_image="b.png" /></item>
  <item item_key="2010500"><base name="A gun" name_key="Z" sex="" /><graphic icon_image="c.png" /></item>
  <item item_key="9999999"><base name="Nowhere" name_key="W" sex="man" /><graphic icon_image="d.png" /></item>
</items>`;

const items = parseItems(XML);
assert.strictEqual(items.length, 4, 'expected 4 items, got ' + items.length);

// tabs come from the id range
assert.strictEqual(categoryOf(1000000).name, 'hair');
assert.strictEqual(categoryOf(1020093).name, 'top');
assert.strictEqual(categoryOf(2010500).name, 'guns');
assert.strictEqual(categoryOf(1009999).name, 'hair', 'range end is inclusive');
assert.strictEqual(categoryOf(1010000).name, 'face', 'next range starts right after');
assert.strictEqual(categoryOf(500), null, 'an id below every range must not match');

const r = buildSql(items, { colors: 5, priceGroupId: 6, effectGroupId: 866, startInfoId: 1 });

// 9999999 is above skills_cards' start, so only ids under every range are dropped
assert.strictEqual(r.inserted + r.skipped.length, 4, 'items went missing');
assert.ok(!r.sql.includes('undefined') && !r.sql.includes('NaN'), 'the SQL carries undefined/NaN');

// gender: man -> 1, woman -> 2, unstated -> 0
assert.ok(/\(1000000,1,/.test(r.sql), 'man did not map to 1');
assert.ok(/\(1020093,2,/.test(r.sql), 'woman did not map to 2');
assert.ok(/\(2010500,0,/.test(r.sql), 'an item with no sex did not map to 0');

// the top item must land on MainTab 1 / SubTab 3, like the shipped rows
assert.ok(/\(1020093,2,0,5,0,0,0,0,0,1,1,3,NULL\)/.test(r.sql),
  'top row does not match the expected column order/values');

// shop_iteminfos ids must be unique and consecutive
const infoIds = [...r.sql.matchAll(/^\s+\((\d+),(\d+),6,866,0,1\)/gm)].map(m => Number(m[1]));
assert.strictEqual(infoIds.length, r.inserted, 'one info row per item');
assert.strictEqual(new Set(infoIds).size, infoIds.length, 'duplicate ids in shop_iteminfos');
assert.strictEqual(infoIds[0], 1, 'startInfoId ignored');

// starting further along must not reuse ids
const r2 = buildSql(items, { startInfoId: 5000 });
assert.ok(r2.sql.includes('(5000,'), 'startInfoId 5000 was not honoured');

assert.ok(r.sql.includes('START TRANSACTION;') && r.sql.includes('COMMIT;'),
  'the script is not wrapped in a transaction');

console.log('ok  synthetic: ' + r.inserted + ' inserted, ' + r.skipped.length + ' skipped, ids unique');

// and against the real file, if it is around
// pass an item.x7 to check against a real one: node src/utils/test_itemsToSql.js <file>
const real = [process.argv[2]].find(f => f && fs.existsSync(f));
if (!real) {
  console.log('skip: no real item.x7 to check against');
  process.exit(0);
}
const rr = itemsToSql(real, { colors: 0 });
assert.ok(rr.inserted > 1000, 'only ' + rr.inserted + ' items parsed from the real file');
assert.ok(!rr.sql.includes('undefined'), 'the real SQL carries undefined');
console.log('ok  ' + real);
console.log('    ' + rr.inserted + ' of ' + rr.total + ' items, ' + rr.skipped.length + ' outside every range');
console.log('    ' + Object.entries(rr.byCategory).map(([k, v]) => k + ':' + v).join('  '));
