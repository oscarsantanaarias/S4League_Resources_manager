'use strict';

const MODE_LETTERS = { d: 1, t: 2, f: 9, sl: 8, sz: 11, a: 7, c: 10, m: 4 };

function prettifyMapName(fileBase){
  return fileBase
    .replace(/^bginfo[-_]/i, '')
    .replace(/\.ini$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function parseBginfoText(text){
  const modes = [];
  let limit = 12;
  let bgmKey = '';
  for(const raw of text.split(/\r?\n/)){
    const line = raw.trim();
    if(!line || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if(eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if(key.startsWith('enablemode')){
      const gr = MODE_LETTERS[val.toLowerCase()];
      if(gr && !modes.includes(gr)) modes.push(gr);
    } else if(key === 'limitplayercount'){
      const n = parseInt(val, 10);
      if(Number.isFinite(n) && n > 0) limit = n;
    } else if(key === 'bgm_play_list_name_key'){
      bgmKey = val;
    }
  }
  return { modes, limit, bgmKey };
}

function clientUsedIds(gameinfoText){
  const set = new Set();
  for(const m of gameinfoText.matchAll(/<data\s+id="(\d+)"/g)) set.add(Number(m[1]));
  return set;
}

function serverUsedByMode(mapText){
  const byMode = new Map();
  const re = /<map id="(\d+)">\s*<base map_name_key="[^"]*" mode_number="(\d+)"/g;
  for(const m of mapText.matchAll(re)){
    const mode = Number(m[2]);
    if(!byMode.has(mode)) byMode.set(mode, new Set());
    byMode.get(mode).add(Number(m[1]) & 0xFF);
  }
  return byMode;
}

function pickMapId(usedClient, usedServerByMode, modes, start = 2, maxId = 255){
  for(let id = start; id <= maxId; id++){
    if(usedClient.has(id)) continue;
    const byte = id & 0xFF;
    if(modes.every(mode => !(usedServerByMode.get(mode)?.has(byte)))) return id;
  }
  return null;
}

function removeClientData(text, bginfoPath){
  return text.replace(new RegExp(`[ \\t]*<data\\b[^>]*bginfo_path="${escapeReg(bginfoPath)}"[^>]*/>\\s*\\n?`, 'ig'), '');
}

function removeMapName(text, id){
  return text.replace(new RegExp(`[ \\t]*<string key="MAPNAME_${id}"[^>]*/>\\s*\\n?`, 'ig'), '');
}

function removeServerMapsForBginfo(mapText, bginfoPath){
  const low = `bginfo_path="${bginfoPath.toLowerCase()}"`;
  return mapText.replace(/[ \t]*<map\b[\s\S]*?<\/map>\s*/gi, block =>
    block.toLowerCase().includes(low) ? '' : block);
}

function escapeReg(s){
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clientIdForBginfo(text, bginfoPath){
  const m = text.match(new RegExp(`<data\\s+id="(\\d+)"[^>]*bginfo_path="${escapeReg(bginfoPath)}"`, 'i'));
  return m ? Number(m[1]) : null;
}

function serverUsedIds(mapText){
  const set = new Set();
  for(const m of mapText.matchAll(/<map id="(\d+)">/g)) set.add(Number(m[1]));
  return set;
}

function mapIdForBginfo(mapText, bginfoPath){
  const low = `bginfo_path="${bginfoPath.toLowerCase()}"`;
  for(const block of mapText.split(/(?=<map\b)/)){
    if(block.toLowerCase().includes(low)){
      const m = block.match(/<map id="(\d+)">/);
      if(m) return Number(m[1]);
    }
  }
  return null;
}

function stripAfterGameinfo(text){
  const tag = '</gameinfo>';
  const i = text.indexOf(tag);
  return i < 0 ? text : text.slice(0, i + tag.length) + '\n';
}

function serverBginfoForId(mapText, id){
  const m = mapText.match(new RegExp(`<map id="${id}">[\\s\\S]*?bginfo_path="([^"]+)"`, 'i'));
  return m ? m[1] : null;
}

function serverModesForBginfo(mapText, bginfoPath){
  const modes = new Set();
  const low = `bginfo_path="${bginfoPath.toLowerCase()}"`;
  for(const block of mapText.split(/<map\b/).slice(1)){
    if(block.toLowerCase().includes(low)){
      const mm = block.match(/mode_number="(\d+)"/);
      if(mm) modes.add(Number(mm[1]));
    }
  }
  return modes;
}

function insertAfterLast(text, globalRegex, insertText){
  const matches = [...text.matchAll(globalRegex)];
  if(!matches.length) return null;
  const last = matches[matches.length - 1];
  const pos = last.index + last[0].length;
  return text.slice(0, pos) + '\n' + insertText + text.slice(pos);
}

function insertBeforeClose(text, closeTag, insertText){
  const i = text.lastIndexOf(closeTag);
  if(i < 0) return text + '\n' + insertText + '\n';
  return text.slice(0, i) + insertText + '\n' + text.slice(i);
}

function mapNameKey(bginfoFile){
  const base = bginfoFile.replace(/^bginfo[-_]/i, '').replace(/\.ini$/i, '');
  return 'MAPNAME_' + base.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function clientDataLine(id, nameKey, bginfoPath){
  return `\t<data id="${id}" map_name_key="${nameKey}" require_level="0" require_server="0" require_channel="0" respawn_type="1" bginfo_path="${bginfoPath}" />`;
}

function clientNameString(nameKey, name){
  const n = name;
  return `\t<string key="${nameKey}" kor="${n}" ger="${n}" eng="${n}" fre="${n}" spa="${n}" ita="${n}" rus="${n}" ame="${n}"/>`;
}

function serverMapEntry(id, nameKey, mode, limit, bginfoPath, previewPath){
  return `\t<map id="${id}">\n` +
    `\t\t<base map_name_key="${nameKey}" mode_number="${mode}" limit_player="${limit}" index_number="${id}"/>\n` +
    `\t\t<resourse bginfo_path="${bginfoPath}" previewinfo_path="${previewPath}"/>\n` +
    `\t\t<switch kr="on" eu="on" cn="off" th="off" tw="off" jp="off" id="off" ph="off" sa="off"/>\n` +
    `\t</map>`;
}

function serverNameString(nameKey, name){
  return `\t<string key="${nameKey}" eng="${name}" />`;
}

function addClientData(text, id, nameKey, bginfoPath){
  const line = clientDataLine(id, nameKey, bginfoPath);
  const after = insertAfterLast(text, /<data\b[^>]*bginfo_path="[^"]*"[^>]*\/>/g, line);
  if(after) return after;
  if(text.includes('</map>')) return text.replace('</map>', `${line}\n</map>`);
  return text + '\n' + line + '\n';
}

module.exports = {
  MODE_LETTERS, prettifyMapName, parseBginfoText,
  clientUsedIds, serverUsedByMode, pickMapId,
  clientIdForBginfo, serverModesForBginfo, serverUsedIds, serverBginfoForId,
  mapIdForBginfo, stripAfterGameinfo,
  removeClientData, removeMapName, removeServerMapsForBginfo,
  insertAfterLast, insertBeforeClose, mapNameKey,
  clientDataLine, clientNameString, serverMapEntry, serverNameString, addClientData
};
