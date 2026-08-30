'use strict';
const assert = require('assert');
const M = require('./mapsutil');


let r = M.parseBginfoText('limitPlayerCount=12\nenableMode1=d\n;enableMode2=sl\n;enableMode3=t\nbgm_play_list_name_key=719');
assert.deepStrictEqual(r.modes, [1], 'neden01h -> DM only');
assert.strictEqual(r.limit, 12);
assert.strictEqual(r.bgmKey, '719');

r = M.parseBginfoText('enableMode1=f\nlimitPlayerCount=8');
assert.deepStrictEqual(r.modes, [9], 'ffa -> BattleRoyal');
assert.strictEqual(r.limit, 8);

r = M.parseBginfoText('enableMode1=d\nenableMode2=t');
assert.deepStrictEqual(r.modes, [1, 2], 'multi-mode bginfo -> DM+TD');

r = M.parseBginfoText('enableMode1=zzz');
assert.deepStrictEqual(r.modes, [], 'unknown letter -> no mode');


assert.strictEqual(M.prettifyMapName('bginfo-neden01h'), 'Neden01h');
assert.strictEqual(M.prettifyMapName('bginfo-neden01h_ffa.ini'), 'Neden01h Ffa');


const usedClient = new Set([2, 3]);
const byMode = new Map([[1, new Set([4])]]);

assert.strictEqual(M.pickMapId(usedClient, byMode, [1]), 5);

assert.strictEqual(M.pickMapId(usedClient, byMode, [9]), 4);

assert.strictEqual(M.pickMapId(new Set(), byMode, [1], 256), null);


let gc = '<map>\n\t<data id="256" map_name_key="MAPNAME_256" bginfo_path="Resources/MapInfo/bginfo-neden01h.ini" />\n</map>';
assert.ok(!M.removeClientData(gc, 'Resources/MapInfo/bginfo-neden01h.ini').includes('id="256"'));
let sn = '<string_table>\n\t<string key="MAPNAME_256" eng="X" />\n</string_table>';
assert.ok(!M.removeMapName(sn, 256).includes('MAPNAME_256'));
let sm = '<maplist>\n\t<map id="1"><base map_name_key="MAPNAME_1" mode_number="1"/><resourse bginfo_path="a.ini"/></map>\n\t<map id="256"><base map_name_key="MAPNAME_256" mode_number="1"/><resourse bginfo_path="Resources/MapInfo/bginfo-neden01h.ini"/></map>\n</maplist>';
const smClean = M.removeServerMapsForBginfo(sm, 'Resources/MapInfo/bginfo-neden01h.ini');
assert.ok(!smClean.includes('id="256"'), 'bad map block removed');
assert.ok(smClean.includes('id="1"'), 'other map kept');
assert.ok(smClean.includes('</maplist>'), '</maplist> preserved');


const mapXml = '<maplist>\n<map id="2">\n<base map_name_key="MAPNAME_2" mode_number="1" limit_player="12" index_number="8"/>\n</map>\n</maplist>';
assert.strictEqual(M.serverUsedByMode(mapXml).get(1).has(2), true);
assert.strictEqual(M.clientUsedIds('<data id="1" x/><data id="7" y/>').has(7), true);


assert.strictEqual(M.mapNameKey('bginfo-neden01h.ini'), 'MAPNAME_NEDEN01H');
assert.strictEqual(M.mapNameKey('bginfo-neden01h_ffa.ini'), 'MAPNAME_NEDEN01HFFA');


const gi = '<map>\n\t<data id="1" map_name_key="MAPNAME_2" bginfo_path="a.ini" />\n\t<data id="2" map_name_key="MAPNAME_3" bginfo_path="b.ini" />\n</map>';
const gi2 = M.addClientData(gi, 26, 'MAPNAME_NEDEN01H', 'Resources/MapInfo/bginfo-neden01h.ini');
assert.ok(gi2.indexOf('id="26"') > gi2.indexOf('id="2"'), 'new data after last');
assert.ok(gi2.indexOf('</map>') > gi2.indexOf('id="26"'), 'still before </map>');
assert.ok(gi2.includes('map_name_key="MAPNAME_NEDEN01H"'), 'uses derived name key');


const giExist = '<data id="256" map_name_key="MAPNAME_256" bginfo_path="Resources/MapInfo/bginfo-neden01h.ini" />';
assert.strictEqual(M.clientIdForBginfo(giExist, 'Resources/MapInfo/bginfo-neden01h.ini'), 256);
assert.strictEqual(M.clientIdForBginfo(giExist, 'Resources/MapInfo/bginfo-other.ini'), null);


const smExist = '<maplist><map id="256"><base map_name_key="MAPNAME_256" mode_number="1"/><resourse bginfo_path="Resources/MapInfo/bginfo-neden01h.ini"/></map></maplist>';
assert.strictEqual(M.serverModesForBginfo(smExist, 'Resources/MapInfo/bginfo-neden01h.ini').has(1), true);
assert.strictEqual(M.serverModesForBginfo(smExist, 'Resources/MapInfo/bginfo-neden01h.ini').has(9), false);


const smIds = '<maplist>\n<map id="2"><base map_name_key="MAPNAME_2" mode_number="1"/><resourse bginfo_path="Resources/MapInfo/bginfo-Neden01.ini"/></map>\n<map id="26"><base map_name_key="X" mode_number="1"/><resourse bginfo_path="Resources/MapInfo/bginfo-neden01h.ini"/></map>\n</maplist>';
assert.strictEqual(M.serverUsedIds(smIds).has(2), true);
assert.strictEqual(M.serverUsedIds(smIds).has(26), true);
assert.strictEqual(M.serverUsedIds(smIds).has(3), false);
assert.strictEqual(M.serverBginfoForId(smIds, 2), 'Resources/MapInfo/bginfo-Neden01.ini');
assert.strictEqual(M.serverBginfoForId(smIds, 99), null);

const avoid = M.serverUsedIds(smIds); 
assert.strictEqual(M.pickMapId(avoid, new Map(), [9]), 3, 'skips global ids 2 and 26');


const st = '<string_table>\n<string key="A" eng="a" />\n</string_table>';
const st2 = M.insertBeforeClose(st, '</string_table>', M.serverNameString('MAPNAME_NEDEN01HFFA', 'Neden Halloween FFA'));
assert.ok(st2.indexOf('MAPNAME_NEDEN01HFFA') < st2.indexOf('</string_table>'));

console.log('mapsutil: all tests passed');
