'use strict';

// Turn an item.x7 into INSERT statements for shop_items and shop_iteminfos.
//
// What comes from the file:
//   Id                 <- item_key
//   RequiredGender     <- <base sex="man|woman">
//   MainTab / SubTab   <- derived from the id range (see CATEGORIES)
//
// What does NOT exist in item.x7 and is passed in instead:
//   Colors             the file has no colour attribute at all
//   PriceGroupId       a row id in another table
//   EffectGroupId      same
//
// Everything else defaults to the values a plain item carries: no license, no
// level requirement, destroyable, not single use.

const fs = require('fs');

// id ranges -> shop tabs. MainTab 1 is character, 2 is weapons, 3 is skills.
const CATEGORIES = [
  { name: 'hair',        from: 1000000, to: 1009999, mainTab: 1, subTab: 1 },
  { name: 'face',        from: 1010000, to: 1019999, mainTab: 1, subTab: 2 },
  { name: 'top',         from: 1020000, to: 1029999, mainTab: 1, subTab: 3 },
  { name: 'pants',       from: 1030000, to: 1039999, mainTab: 1, subTab: 4 },
  { name: 'gloves',      from: 1040000, to: 1049999, mainTab: 1, subTab: 5 },
  { name: 'shoes',       from: 1050000, to: 1059999, mainTab: 1, subTab: 6 },
  { name: 'accessories', from: 1060000, to: 1069999, mainTab: 1, subTab: 7 },
  { name: 'pets',        from: 1070000, to: 1079999, mainTab: 1, subTab: 8 },
  { name: 'melee',       from: 2000000, to: 2009999, mainTab: 2, subTab: 1 },
  { name: 'guns',        from: 2010000, to: 2019999, mainTab: 2, subTab: 2 },
  { name: 'heavies',     from: 2020001, to: 2029999, mainTab: 2, subTab: 3 },
  { name: 'snipers',     from: 2030001, to: 2039999, mainTab: 2, subTab: 4 },
  { name: 'sentries',    from: 2040001, to: 2049999, mainTab: 2, subTab: 5 },
  { name: 'thrown',      from: 2050001, to: 2059999, mainTab: 2, subTab: 6 },
  { name: 'special',     from: 2060001, to: 2069999, mainTab: 2, subTab: 7 },
  { name: 'skills_cards',from: 3000000, to: Number.MAX_SAFE_INTEGER, mainTab: 3, subTab: 1 },
];

// The shipped rows only ever hold 1 and 2, never 0, which is why man maps to 1
// and woman to 2, leaving 0 for an item that names neither.
const GENDER = { man: 1, woman: 2 };

function categoryOf(id) {
  return CATEGORIES.find(c => id >= c.from && id <= c.to) || null;
}

function readAttr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"', 'i'));
  return m ? m[1] : '';
}

function parseItems(xml) {
  const out = [];
  const re = /<item\b[^>]*item_key="([^"]+)"[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[2];
    const base = (body.match(/<base\b[^>]*>/i) || [''])[0];
    const id = Number(m[1]);
    if (!Number.isFinite(id)) continue;
    out.push({
      id,
      name: readAttr(base, 'name'),
      sex: readAttr(base, 'sex').toLowerCase(),
      category: categoryOf(id),
    });
  }
  return out;
}

const esc = v => (v === null || v === undefined ? 'NULL' : String(v));

function buildSql(items, opts) {
  const o = Object.assign({
    colors: 0, priceGroupId: 6, effectGroupId: 866,
    discountPercentage: 0, type: 1,
    shopItemsTable: 'shop_items', shopInfosTable: 'shop_iteminfos',
    startInfoId: 1, batchSize: 500,
  }, opts || {});

  const rows = items.filter(i => i.category);
  const skipped = items.filter(i => !i.category);
  const lines = [];

  lines.push('-- generated from item.x7 by ItemManager');
  lines.push('-- ' + rows.length + ' items' + (skipped.length ? ', ' + skipped.length + ' outside every known id range and skipped' : ''));
  lines.push('-- Colors, PriceGroupId and EffectGroupId are NOT in item.x7 and use the values given in the dialog');
  lines.push('');
  lines.push('START TRANSACTION;');
  lines.push('');

  const chunk = (arr, n) => arr.reduce((a, v, i) => (i % n ? a[a.length - 1].push(v) : a.push([v]), a), []);

  for (const part of chunk(rows, o.batchSize)) {
    lines.push('INSERT INTO `' + o.shopItemsTable + '`');
    lines.push('  (`Id`,`RequiredGender`,`RequiredLicense`,`Colors`,`UniqueColors`,`RequiredLevel`,`LevelLimit`,' +
               '`RequiredMasterLevel`,`IsOneTimeUse`,`IsDestroyable`,`MainTab`,`SubTab`,`RepairCost`)');
    lines.push('VALUES');
    lines.push(part.map(i =>
      '  (' + [i.id, GENDER[i.sex] || 0, 0, o.colors, 0, 0, 0, 0, 0, 1,
               i.category.mainTab, i.category.subTab, 'NULL'].map(esc).join(',') + ')'
    ).join(',\n') + ';');
    lines.push('');
  }

  let infoId = o.startInfoId;
  for (const part of chunk(rows, o.batchSize)) {
    lines.push('INSERT INTO `' + o.shopInfosTable + '`');
    lines.push('  (`Id`,`ShopItemId`,`PriceGroupId`,`EffectGroupId`,`DiscountPercentage`,`Type`)');
    lines.push('VALUES');
    lines.push(part.map(i =>
      '  (' + [infoId++, i.id, o.priceGroupId, o.effectGroupId, o.discountPercentage, o.type].map(esc).join(',') + ')'
    ).join(',\n') + ';');
    lines.push('');
  }

  lines.push('COMMIT;');
  lines.push('');

  const byCategory = {};
  for (const i of rows) byCategory[i.category.name] = (byCategory[i.category.name] || 0) + 1;

  return {
    sql: lines.join('\n'),
    total: items.length,
    inserted: rows.length,
    skipped: skipped.map(i => i.id),
    byCategory,
    nextInfoId: infoId,
  };
}

function itemsToSql(itemXmlPath, opts) {
  const xml = fs.readFileSync(itemXmlPath, 'utf8');
  const items = parseItems(xml);
  if (!items.length) throw new Error('no <item item_key="..."> found in ' + itemXmlPath);
  return buildSql(items, opts);
}

module.exports = { itemsToSql, parseItems, buildSql, categoryOf, CATEGORIES, GENDER };
