'use strict';
const fs = require('fs');

const ID_RANGE = {
  hair: [1000000, 1009999], face: [1010000, 1019999], top: [1020000, 1029999], pants: [1030000, 1039999],
  gloves: [1040000, 1049999], shoes: [1050000, 1059999], accessories: [1060000, 1069999], pets: [1070000, 1079999],
  melee: [2000000, 2009999], guns: [2010000, 2019999], heavies: [2020001, 2029999], snipers: [2030001, 2039999],
  sentries: [2040001, 2049999], thrown: [2050001, 2059999], special: [2060001, 2069999],
};
const CAT_SLOT = { hair: 'hair', face: 'face', top: 'body', pants: 'leg', gloves: 'hand', shoes: 'foot' };
const WEAPON_CATS = ['melee', 'guns', 'heavies', 'snipers', 'sentries', 'thrown', 'special'];

function categoryOf(key){
  for(const c in ID_RANGE){ const [a, b] = ID_RANGE[c]; if(key >= a && key <= b) return c; }
  return null;
}
function attr(tag, name){ const m = tag.match(new RegExp(name + '="([^"]*)"')); return m ? m[1] : null; }

function parseItemDb(file){
  const xml = fs.readFileSync(file, 'utf8');
  const items = [];
  const re = /<item item_key="(\d+)">([\s\S]*?)<\/item>/g;
  let m;
  while((m = re.exec(xml))){
    const key = +m[1], body = m[2];
    const cat = categoryOf(key);
    if(!cat) continue;
    const baseTag = (body.match(/<base [^>]*\/?>/) || [''])[0];
    const gTag = (body.match(/<graphic [^>]*\/?>/) || [''])[0];
    const nodes = [];
    for(let i = 1; i <= 6; i++){
      const f = attr(gTag, 'to_node_scene_file' + i);
      if(!f || f === '-') continue;
      nodes.push({ file: f, parent: attr(gTag, 'to_node_parent_node' + i) || 'Bip01', anim: attr(gTag, 'to_node_animation_part' + i) === '1' });
    }
    items.push({
      key, cat, slot: CAT_SLOT[cat] || null,
      sex: attr(baseTag, 'sex') || 'unisex',
      name: attr(baseTag, 'name') || ('#' + key),
      part: attr(gTag, 'to_part_scene_file'),
      icon: attr(gTag, 'icon_image'),
      hiding: attr(gTag, 'hiding_option'),
      nodes,
    });
  }
  return items;
}

module.exports = { parseItemDb, categoryOf, ID_RANGE, CAT_SLOT, WEAPON_CATS };

if(require.main === module){
  const items = parseItemDb(process.argv[2]);
  const by = {};
  for(const it of items) by[it.cat] = (by[it.cat] || 0) + 1;
  console.log('items equipables:', items.length, '\npor categoría:', JSON.stringify(by, null, 1));
  console.log('ejemplo top:', JSON.stringify(items.find(i => i.cat === 'top' && i.part)));
}
