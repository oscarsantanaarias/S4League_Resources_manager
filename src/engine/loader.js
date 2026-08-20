'use strict';
const fs = require('fs');
const path = require('path');
const { parseScn } = require('./scn_geometry');
const { imageToDataUrl } = require('./scn_textures');

const IMG_EXTS = ['.dds', '.tga', '.png', '.jpg', '.jpeg', '.bmp'];

function findTextureFile(dir, texName){
  if(!texName) return null;
  const bn = path.basename(texName.replace(/\\/g, '/'));
  const base = bn.slice(0, bn.length - path.extname(bn).length).toLowerCase();
  let files;
  try { files = fs.readdirSync(dir); } catch(e){ return null; }
  for(const f of files) if(f.toLowerCase() === bn.toLowerCase()) return path.join(dir, f);
  for(const f of files){
    const e = path.extname(f).toLowerCase();
    if(!IMG_EXTS.includes(e)) continue;
    if(f.slice(0, f.length - e.length).toLowerCase() === base) return path.join(dir, f);
  }
  return null;
}

function loadScene(file){
  const s = parseScn(fs.readFileSync(file));
  s.dir = path.dirname(file).replace(/\\/g, '/');
  return s;
}

const CHAR_SLOTS = ['body', 'leg', 'hand', 'foot', 'face', 'hair'];

function addSceneTextures(sc, textures){
  for(const m of sc.models){
    if(!m.texture) continue;
    const key = sc.dir + '|' + m.texture;
    if(textures[key] !== undefined) continue;
    const file = findTextureFile(sc.dir, m.texture);
    textures[key] = file ? imageToDataUrl(fs.readFileSync(file), path.extname(file)) : null;
  }
}

function loadParts(charDir, gender, equip){
  const parts = [], textures = {};
  for(const slot of CHAR_SLOTS){
    const v = equip ? equip[slot] : undefined;
    if(v === null) continue;
    const name = v || ('00_' + gender + '_' + slot + '.scn');
    const f = path.join(charDir, slot, name);
    if(!fs.existsSync(f)) continue;
    let sc; try { sc = loadScene(f); } catch(e){ continue; }
    parts.push(sc);
    addSceneTextures(sc, textures);
  }
  return { parts, textures };
}

function loadCharacter(charDir, gender, equip){
  gender = gender || 'male';
  const skel = loadScene(path.join(charDir, gender + '_bip.scn'));
  const { parts, textures } = loadParts(charDir, gender, equip);
  addSceneTextures(skel, textures);
  return { skel, parts, textures, animNames: skel.animNames, gender };
}

function pieceTextureKey(dir, texture){ return (dir || '') + '|' + (texture || ''); }

function loadMap(mapDir, files){
  const scenes = [], textures = {};
  for(const f of files){
    const file = path.join(mapDir, f);
    if(!fs.existsSync(file)) continue;
    let s; try { s = loadScene(file); } catch(e){ continue; }
    s.file = f;
    scenes.push(s);
    for(const m of s.models){
      const wanted = [];
      for(const it of (m.texItems && m.texItems.length ? m.texItems : [{ name: m.texture, side: m.sideTexture }])){
        if(it.name) wanted.push(it.name);
        if(it.side) wanted.push(it.side);
      }
      for(const tex of wanted){
        const key = s.dir + '|' + tex;
        if(textures[key] !== undefined) continue;
        const tf = findTextureFile(s.dir, tex);
        textures[key] = tf ? imageToDataUrl(fs.readFileSync(tf), path.extname(tf)) : null;
      }
    }
  }
  return { scenes, textures };
}

module.exports = { loadCharacter, loadParts, CHAR_SLOTS, loadScene, loadMap, findTextureFile, pieceTextureKey };
