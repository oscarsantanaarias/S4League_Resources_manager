"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const s1 = require("./itemS1.js");

const root = process.argv[2] || "C:/Users/sneo/Desktop/s1/S1 Client/FumbiClient/extracted_resources";
const itemInfoPath = path.join(root, "xml", "iteminfo.x7");
const weaponPath = path.join(root, "xml", "weapon.x7");

const itemInfo = fs.readFileSync(itemInfoPath, "utf8");
const weapon = fs.readFileSync(weaponPath, "utf8");

assert.strictEqual(s1.detectFormat(itemInfo), "s1");
assert.strictEqual(s1.detectFormat('<?xml version="1.0"?>\n<itemlist>\n<item item_key="4031064">'), "s10");
assert.strictEqual(s1.detectFormat("<cualquier_cosa>"), null);

assert.deepStrictEqual(s1.splitId(1001002), { category: 1, subCategory: 0, number: 1002 });
assert.deepStrictEqual(s1.splitId(1022025), { category: 1, subCategory: 2, number: 2025 });
assert.deepStrictEqual(s1.splitId(2000001), { category: 2, subCategory: 0, number: 1 });
assert.strictEqual(s1.buildId(1, 2, 2025), 1022025);

assert.ok(s1.hasItem(itemInfo, 1001002), "no encontro el pelo 1001002");
assert.ok(s1.hasItem(itemInfo, 1021018), "no encontro el top 1021018");
assert.ok(s1.hasItem(itemInfo, 2000001), "no encontro la plasma sword 2000001");
assert.ok(!s1.hasItem(itemInfo, 1029999), "encontro un item que no deberia existir");

const freeTop = s1.nextFreeId(itemInfo, 1, 2);
assert.deepStrictEqual(s1.splitId(freeTop).category, 1);
assert.deepStrictEqual(s1.splitId(freeTop).subCategory, 2);
assert.ok(!s1.hasItem(itemInfo, freeTop), "el id libre ya estaba usado");

const costume = s1.makeCostumeItem(freeTop, "mishirt.tga", "Mi Shirt", "man", "mishirt.scn", "top");
assert.ok(costume.includes(`name_key="N${freeTop}"`));
assert.ok(costume.includes('<to_part scene_file="mishirt.scn" />'), "un top va con to_part, no to_node");

const withCostume = s1.insertItem(itemInfo, freeTop, costume);
assert.ok(s1.hasItem(withCostume, freeTop), "la prenda no quedo dentro de su sub_category");
assert.strictEqual(
    s1.itemBlocks(withCostume, 1, 2).length,
    s1.itemBlocks(itemInfo, 1, 2).length + 1
);
assert.strictEqual(s1.itemBlocks(withCostume, 1, 0).length, s1.itemBlocks(itemInfo, 1, 0).length);
assert.strictEqual(s1.itemBlocks(withCostume, 2, 0).length, s1.itemBlocks(itemInfo, 2, 0).length);

const hair = s1.makeCostumeItem(s1.nextFreeId(itemInfo, 1, 0), "h.tga", "Mi Hair", "woman", "h.scn", "hair");
assert.ok(hair.includes('parent_node="Bip01 Head"'), "el pelo tiene que ir con to_node");
assert.ok(hair.includes('<wearing sex="woman" />'));

const uni = s1.makeCostumeItem(freeTop, "x.tga", "X", "unisex", "x.scn", "top");
assert.ok(uni.includes('SEX="all"') && uni.includes('<wearing sex="unisex" />'));

const freeSword = s1.nextFreeId(itemInfo, 2, 0);
const skin = s1.cloneWeaponItem(itemInfo, 2000001, freeSword, {
    displayName: "Mi Sword",
    icon: "icon_misword.dds",
    sceneFile: "misword.scn",
});
assert.ok(skin.includes(`name_key="N${freeSword}"`));
assert.ok(skin.includes('NAME="Mi Sword"'));
assert.ok(skin.includes("resources/Model/Weapon/misword.scn"));
assert.ok(skin.includes('power="17.0"'), "un skin no debe cambiar los stats del arma base");
assert.ok(!skin.includes("<parent "), "el skin no debe heredar del arma base");

const withSkin = s1.insertItem(itemInfo, freeSword, skin);
assert.ok(s1.hasItem(withSkin, freeSword));

assert.ok(s1.hasWeaponEntry(weapon, 2000001));
assert.ok(!s1.hasWeaponEntry(weapon, freeSword));

const entry = s1.cloneWeaponEntry(weapon, 2000001, freeSword, {
    icon: "icon_misword.dds",
    sceneFile: "misword.scn",
});
assert.ok(entry.includes(`item_key="${freeSword}"`));
assert.ok(entry.includes('value1="misword.scn"'));
assert.ok(entry.includes('power="17"'), "el skin conserva los stats en weapon.x7");

const weaponAfter = s1.insertWeaponEntry(weapon, entry);
assert.ok(s1.hasWeaponEntry(weaponAfter, freeSword));
assert.ok(weaponAfter.trimEnd().endsWith("</weaponlist>"));

assert.strictEqual(s1.sceneBaseName("countersowrd_25july.png"), "countersowrd_25july");
assert.strictEqual(s1.sceneBaseName("countersowrd_25july_r.scn"), "countersowrd_25july");
assert.strictEqual(s1.sceneFileFor("counter_crow_r.scn", "x"), "x_r.scn");
assert.strictEqual(s1.sceneFileFor("counter_crow_l.scn", "x"), "x_l.scn");
assert.strictEqual(s1.sceneFileFor("sword.scn", "x"), "x.scn");

const dual = s1.cloneWeaponItem(itemInfo, 2000009, s1.nextFreeId(itemInfo, 2, 0), {
    displayName: "Mi Counter",
    icon: "mi_counter.png",
    sceneFile: "mi_counter.png",
});
assert.ok(dual.includes("Weapon/mi_counter_r.scn"), "falta la mano derecha");
assert.ok(dual.includes("Weapon/mi_counter_l.scn"), "falta la mano izquierda");
assert.ok(!/scene value="[^"]*counter_crow/.test(dual), "quedo un modelo del arma base");
assert.ok(!/scene value="[^"]*\.png"/.test(dual), "la textura acabo de modelo");

const dualEntry = s1.cloneWeaponEntry(weapon, 2000009, 2009999, { sceneFile: "mi_counter.png" });
assert.ok(dualEntry.includes('value1="mi_counter_r.scn"'));
assert.ok(dualEntry.includes('value2="mi_counter_l.scn"'));

for(const [type, baseId] of Object.entries(s1.WEAPON_BASE_ID)){
    assert.ok(s1.hasItem(itemInfo, baseId), `${type}: ${baseId} no esta en iteminfo.x7`);
    assert.ok(s1.hasWeaponEntry(weapon, baseId), `${type}: ${baseId} no esta en weapon.x7`);
}

assert.strictEqual(s1.weaponBaseId("Breaker"), null);
assert.strictEqual(s1.weaponBaseId("RocketLauncher"), null);

console.log(
    `ok - formato detectado, ${s1.itemBlocks(itemInfo, 1, 2).length} tops y ` +
    `${s1.itemBlocks(itemInfo, 2, 0).length} armas melee leidas, alta de prenda y de skin limpias`
);
