'use strict';

// Season 1 registers a map in a different place than the later clients do.
// There is no xml/map.x7 with a <maplist>: the map list lives inside the <map>
// section of xml/_eu_gameinfo.x7, and the names sit in an attribute style
// string table. Following the GameBanana tutorial (tuts/19514), a map needs
// four files touched on the client and two plus the .ini on the server.
//
// Everything here is text in, text out. Nothing reads or writes a file, so it
// can be tested against the real game files without touching them.

// <data id="1" map_name_key="MAPNAME_2" ... bginfo_path="Resources/MapInfo/bginfo-Neden01.ini" />
//
// map_name_key is optional: 13 of the 62 entries in the Season 1 file have no
// name at all. They still hold an id, so they have to be counted, or a new map
// gets handed an id another one is already using.
const ENTRY_RE = /<data\s+id="(-?\d+)"[^>]*?bginfo_path="([^"]*)"[^>]*?\/>/gi;
const NAME_KEY_RE = /map_name_key="([^"]*)"/i;

function parseGameinfoMaps(text) {
  const out = [];
  ENTRY_RE.lastIndex = 0;
  let m;
  while ((m = ENTRY_RE.exec(String(text || ''))) !== null) {
    const key = NAME_KEY_RE.exec(m[0]);
    out.push({ id: Number(m[1]), nameKey: key ? key[1] : '', bginfo: m[2], raw: m[0] });
  }
  return out;
}

// The file has two <map> blocks: a one line default inside <default>, and the
// real list further down. The list is the one that closes last.
function lastCloseIndex(text, tag) {
  return String(text || '').lastIndexOf(tag);
}

function nextMapId(entries) {
  // -1 is the random map, it is not a real id
  let top = 0;
  for (const e of entries) if (e.id > top) top = e.id;
  return top + 1;
}

function nextMapNameKey(stringTableText) {
  let top = 0;
  const re = /key="MAPNAME_(\d+)"/gi;
  let m;
  while ((m = re.exec(String(stringTableText || ''))) !== null) {
    const n = Number(m[1]);
    if (n > top) top = n;
  }
  return top + 1;
}

// already there? then adding it again would give the client two entries for one
// map, and it shows up twice in the list
function findByBginfo(entries, bginfoPath) {
  const want = String(bginfoPath || '').toLowerCase().replace(/\\/g, '/');
  return entries.find(e => e.bginfo.toLowerCase().replace(/\\/g, '/') === want) || null;
}

function gameinfoEntry(id, nameKey, bginfoPath, respawnType) {
  return '\t\t<data id="' + id + '" map_name_key="' + nameKey + '" require_level="0" ' +
    'require_server="0" require_channel="0" respawn_type="' + (respawnType == null ? 1 : respawnType) +
    '" bginfo_path="' + bginfoPath + '" />';
}

function insertBefore(text, marker, line) {
  const i = lastCloseIndex(text, marker);
  if (i < 0) return null;
  return text.slice(0, i) + line + '\n\t' + text.slice(i);
}

function addGameinfoMap(text, { id, nameKey, bginfoPath, respawnType }) {
  const out = insertBefore(text, '</map>', gameinfoEntry(id, nameKey, bginfoPath, respawnType));
  if (out == null) return { ok: false, error: 'no </map> in _eu_gameinfo.x7' };
  return { ok: true, text: out };
}

// attribute style, one line per string
const LANGS = ['kor', 'ger', 'eng', 'fre', 'spa', 'ita', 'rus', 'ame'];

function mapNameString(key, name) {
  const esc = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return '\t<string key="' + key + '" ' + LANGS.map(l => l + '="' + esc + '"').join(' ') + '/>';
}

function addMapName(text, key, name) {
  if (String(text).includes('key="' + key + '"')) return { ok: true, text, already: true };
  const out = insertBefore(text, '</string_table>', mapNameString(key, name));
  if (out == null) return { ok: false, error: 'no </string_table> in gameinfo_string_table.xml' };
  return { ok: true, text: out };
}

// the music key the map asks for, out of its own bginfo .ini
function bgmKeyFromBginfo(iniText) {
  const m = /^\s*bgm_play_list_name_key\s*=\s*(\d+)/mi.exec(String(iniText || ''));
  return m ? Number(m[1]) : null;
}

// If the music key the .ini asks for is already taken by another map, the two
// share a name. Point the map at a free key instead, which means editing the
// .ini itself - it is being copied into the archive anyway.
function setBgmKey(iniText, key) {
  const t = String(iniText || '');
  if (/^\s*bgm_play_list_name_key\s*=/mi.test(t)) {
    return t.replace(/^(\s*bgm_play_list_name_key\s*=\s*)\d+/mi, '$1' + key);
  }
  return t.replace(/\s*$/, '') + '\r\nbgm_play_list_name_key=' + key + '\r\n';
}

// static_string_table.xml is the other shape: a block of child elements
function staticKeyUsed(text, key) {
  return new RegExp('<string\\s+key="' + key + '"', 'i').test(String(text || ''));
}

function nextStaticKey(text) {
  let top = 0;
  const re = /<string\s+key="(\d+)"/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const n = Number(m[1]);
    if (n > top) top = n;
  }
  return top + 1;
}

function staticString(key, name) {
  const esc = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const langs = LANGS.concat(['cns']);
  return '\t<string key="' + key + '">\n' +
    langs.map(l => '\t\t<' + l + ' value="' + esc + '"/>').join('\n') +
    '\n\t</string>';
}

function addStaticString(text, key, name) {
  if (staticKeyUsed(text, key)) return { ok: true, text, already: true };
  const close = /<\/string_table>/i.test(text) ? '</string_table>' : '</strings>';
  const out = insertBefore(text, close, staticString(key, name));
  if (out == null) return { ok: false, error: 'no closing tag in static_string_table.xml' };
  return { ok: true, text: out };
}

// _eu_option.xml: the song file goes in <bgmlist>, what plays on which map in
// <playlist>. Both are id lists of their own.
function nextDataId(text, section) {
  const block = new RegExp('<' + section + '\\b[^>]*>([\\s\\S]*?)</' + section + '>', 'i').exec(String(text || ''));
  if (!block) return null;
  let top = -1;
  const re = /<data\s+id="(-?\d+)"/gi;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const n = Number(m[1]);
    if (n > top) top = n;
  }
  return top + 1;
}

function insertInSection(text, section, line) {
  const re = new RegExp('([\\s\\S]*)(</' + section + '>)', 'i');
  if (!re.test(text)) return null;
  return text.replace(re, (all, head, close) => head + line + '\n\t' + close);
}

function addBgm(optionText, { song, file, bgmKey }) {
  let text = String(optionText || '');
  const bgmId = nextDataId(text, 'bgmlist');
  if (bgmId == null) return { ok: false, error: 'no <bgmlist> in _eu_option.xml' };

  if (!new RegExp('name="' + song + '"', 'i').test(text)) {
    const line = '\t\t<data id="' + bgmId + '" name="' + song + '" file="' + file + '" />';
    const t = insertInSection(text, 'bgmlist', line);
    if (t == null) return { ok: false, error: 'could not write into <bgmlist>' };
    text = t;
  }

  const playId = nextDataId(text, 'playlist');
  if (playId == null) return { ok: false, error: 'no <playlist> in _eu_option.xml' };
  if (new RegExp('map_name_key="' + bgmKey + '"', 'i').test(text)) {
    return { ok: true, text, bgmId, playId: null, already: true };
  }
  const play = '\t\t<data id="' + playId + '" map_name_key="' + bgmKey + '" defaultshuffle="false" ' +
    'defaultbgm1="' + song + '" defaultbgm2="" defaultbgm3="" shuffle="false" ' +
    'bgm1="' + song + '" bgm2="" bgm3="" />';
  const t2 = insertInSection(text, 'playlist', play);
  if (t2 == null) return { ok: false, error: 'could not write into <playlist>' };
  return { ok: true, text: t2, bgmId, playId };
}

module.exports = {
  parseGameinfoMaps, nextMapId, nextMapNameKey, findByBginfo, gameinfoEntry, addGameinfoMap,
  mapNameString, addMapName, bgmKeyFromBginfo, nextStaticKey, staticKeyUsed, addStaticString,
  staticString, nextDataId, addBgm, setBgmKey, LANGS,
};
