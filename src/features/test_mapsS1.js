'use strict';

// Registering a map in Season 1 means editing four files by hand, and a wrong
// id shows up as a map that is missing, unnamed, or that quietly replaces
// another one. These run against the real server data when it is there.
// Run: node src/features/test_mapsS1.js [path/to/server/data]

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('./mapsS1');

const GAMEINFO = [
  '<gameinfo>',
  '\t<default>',
  '\t\t<map><data id="1" map_name_key="MAPNAME_2" bginfo_path="x.ini" /></map>',
  '\t</default>',
  '\t<map>',
  '\t\t<data id="-1" map_name_key="MAPNAME_1" require_level="0" respawn_type="0" bginfo_path="Resources/MapInfo/bginfo-Random.ini" />',
  '\t\t<data id="1" map_name_key="MAPNAME_2" require_level="0" respawn_type="1" bginfo_path="Resources/MapInfo/bginfo-Neden01.ini" />',
  '\t\t<data id="250" map_name_key="MAPNAME_206" require_level="0" respawn_type="0" bginfo_path="Resources/MapInfo/bginfo-Nightmare_sl.ini" />',
  '\t</map>',
  '</gameinfo>',
].join('\n');

const entries = M.parseGameinfoMaps(GAMEINFO);
assert.strictEqual(entries.length, 4, 'expected 4 entries, got ' + entries.length);
assert.strictEqual(M.nextMapId(entries), 251, 'next id must clear the highest, got ' + M.nextMapId(entries));
assert.ok(M.findByBginfo(entries, 'resources/mapinfo/bginfo-neden01.ini'), 'matching a bginfo has to ignore case');
assert.strictEqual(M.findByBginfo(entries, 'Resources/MapInfo/bginfo-new.ini'), null);

// the entry has to land in the real list, not the one line <map> inside <default>
const added = M.addGameinfoMap(GAMEINFO, { id: 251, nameKey: 'MAPNAME_218', bginfoPath: 'Resources/MapInfo/bginfo-cool.ini' });
assert.ok(added.ok, added.error);
const after = M.parseGameinfoMaps(added.text);
assert.strictEqual(after.length, 5);
assert.strictEqual(after[4].id, 251, 'the new entry is not last: ' + JSON.stringify(after.map(e => e.id)));
const defaultBlock = added.text.slice(added.text.indexOf('<default>'), added.text.indexOf('</default>'));
assert.ok(!defaultBlock.includes('bginfo-cool.ini'), 'the map was written into the <default> block');

const TABLE = [
  '<string_table>',
  '\t<string key="MAPNAME_2" kor="a" ger="a" eng="Neden-1" fre="a" spa="a" ita="a" rus="a" ame="a"/>',
  '\t<string key="MAPNAME_217" kor="b" ger="b" eng="Neoniac" fre="b" spa="b" ita="b" rus="b" ame="b"/>',
  '</string_table>',
].join('\n');
assert.strictEqual(M.nextMapNameKey(TABLE), 218);

const named = M.addMapName(TABLE, 'MAPNAME_218', 'Cool Map');
assert.ok(named.ok, named.error);
assert.ok(named.text.includes('eng="Cool Map"'));
assert.ok(named.text.trim().endsWith('</string_table>'), 'the entry went in after the closing tag');
for (const l of M.LANGS) assert.ok(named.text.includes(l + '="Cool Map"'), 'missing language ' + l);
assert.ok(M.addMapName(named.text, 'MAPNAME_218', 'Cool Map').already, 'adding the same key twice was allowed');

// a name with a quote in it must not break the attribute it sits in
const quoted = M.addMapName(TABLE, 'MAPNAME_9', 'He said "hi" & left');
assert.ok(quoted.text.includes('&quot;hi&quot;') && quoted.text.includes('&amp;'),
  'the name was not escaped: ' + quoted.text.split('\n').find(l => l.includes('MAPNAME_9')));

assert.strictEqual(M.bgmKeyFromBginfo('name=x\r\nbgm_play_list_name_key=703\r\nother=1'), 703);
assert.strictEqual(M.bgmKeyFromBginfo('nothing here'), null);

const STATIC = [
  '<string_table>',
  '\t<string key="516">', '\t\t<eng value="Old"/>', '\t</string>',
  '\t<string key="799">', '\t\t<eng value="Other"/>', '\t</string>',
  '</string_table>',
].join('\n');
assert.strictEqual(M.nextStaticKey(STATIC), 800);
assert.ok(M.staticKeyUsed(STATIC, 516) && !M.staticKeyUsed(STATIC, 800));
const st = M.addStaticString(STATIC, 800, 'Cool Map');
assert.ok(st.ok && st.text.includes('<cns value="Cool Map"/>'), 'cns missing from the static entry');
assert.strictEqual(M.nextStaticKey(st.text), 801, 'the new key is not counted');

const OPTION = [
  '<option>',
  '\t<bgmlist>',
  '\t\t<data id="27" name="Song" file="resources/bgm/song.ogg" />',
  '\t</bgmlist>',
  '\t<playlist>',
  '\t\t<data id="99" map_name_key="516" defaultbgm1="Song" bgm1="Song" />',
  '\t</playlist>',
  '</option>',
].join('\n');
assert.strictEqual(M.nextDataId(OPTION, 'bgmlist'), 28);
assert.strictEqual(M.nextDataId(OPTION, 'playlist'), 100);

const bgm = M.addBgm(OPTION, { song: 'CoolSong', file: 'resources/bgm/cool.ogg', bgmKey: 800 });
assert.ok(bgm.ok, bgm.error);
assert.strictEqual(bgm.bgmId, 28);
assert.strictEqual(bgm.playId, 100);
assert.ok(/<data id="28" name="CoolSong"[^>]*\/>\s*<\/bgmlist>/.test(bgm.text), 'the song did not land inside <bgmlist>');
assert.ok(/map_name_key="800"[^>]*\/>\s*<\/playlist>/.test(bgm.text), 'the playlist entry did not land inside <playlist>');
assert.strictEqual((bgm.text.match(/<data id="28"/g) || []).length, 1, 'the song was written twice');
assert.ok(M.addBgm(bgm.text, { song: 'CoolSong', file: 'x', bgmKey: 800 }).already,
  'the same music key was queued twice');

console.log('ok  synthetic: ids, escaping, both string table shapes, bgmlist and playlist');

// --- against the real Season 1 server data
const DATA = process.argv[2] ||
  'C:/Users/sneo/Desktop/s1/NetSphere-Plain/src/Game/bin/Debug/net10.0/data';
const gi = path.join(DATA, 'xml', '_eu_gameinfo.x7');
const gs = path.join(DATA, 'language', 'xml', 'gameinfo_string_table.xml');
if (!fs.existsSync(gi) || !fs.existsSync(gs)) {
  console.log('skip: no Season 1 server data at ' + DATA);
  process.exit(0);
}

const giText = fs.readFileSync(gi, 'utf8');
const gsText = fs.readFileSync(gs, 'utf8');
const real = M.parseGameinfoMaps(giText);
assert.ok(real.length > 20, 'only ' + real.length + ' maps parsed out of the real file');

// every map in the list has to name a string that exists, or it shows up blank
// reported, not asserted: this is the state of the data, not of the code. On
// the Season 1 server data here, three testlevel maps point at MAPNAME_100-102
// which are not in the table, so they show up with no name.
const missing = real.filter(e => e.nameKey && !gsText.includes('key="' + e.nameKey + '"'));
const unnamed = real.filter(e => !e.nameKey);
if (missing.length) {
  console.log('    note: ' + missing.length + ' maps have no name in the table: ' +
    missing.map(e => e.nameKey + ' (' + e.bginfo.split('/').pop() + ')').join(', '));
}

// and the id we would hand out has to be free on both sides
const id = M.nextMapId(real);
const key = 'MAPNAME_' + M.nextMapNameKey(gsText);
assert.ok(!real.some(e => e.id === id), 'the next id ' + id + ' is already taken');
assert.ok(!gsText.includes('key="' + key + '"'), 'the next name key ' + key + ' is already taken');

const grown = M.addGameinfoMap(giText, { id, nameKey: key, bginfoPath: 'Resources/MapInfo/bginfo-test.ini' });
assert.ok(grown.ok, grown.error);
assert.strictEqual(M.parseGameinfoMaps(grown.text).length, real.length + 1);
assert.ok(grown.text.startsWith(giText.slice(0, 400)), 'the head of the file changed');
assert.ok(grown.text.length > giText.length, 'nothing was added');

// an entry with no map_name_key still holds an id, so it has to be counted
assert.ok(unnamed.length > 0, 'expected some entries without a name key in the real file');
assert.ok(real.length >= (giText.match(/bginfo_path=/g) || []).length,
  'only ' + real.length + ' of ' + (giText.match(/bginfo_path=/g) || []).length + ' entries were parsed');

console.log('ok  real data: ' + real.length + ' entries (' + unnamed.length +
  ' with no name key); next free id ' + id + ' and ' + key);
