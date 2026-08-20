const fs = require('fs');
const path = require('path');
const { id_range } = require('../utils/verifiers');

function inferLuaTool(filePath){
  const clean = filePath.toLowerCase();

  if(clean.includes(`${path.sep.toLowerCase()}luap-1139${path.sep.toLowerCase()}`)) return 'LuaP';
  if(clean.includes(`${path.sep.toLowerCase()}luaq-plus${path.sep.toLowerCase()}`)) return 'LuaQ-Plus';
  if(clean.includes(`${path.sep.toLowerCase()}luaq${path.sep.toLowerCase()}`)) return 'LuaQ';
  if(clean.includes(`${path.sep.toLowerCase()}luar${path.sep.toLowerCase()}`)) return 'LuaR';
  if(clean.includes(`${path.sep.toLowerCase()}luas${path.sep.toLowerCase()}`)) return 'LuaS';

  return 'LuaQ';
}

function detectLuaBytecodeTool(buffer, input){
  if(buffer.length >= 5 && buffer[0] === 0x1b && buffer.toString('ascii', 1, 4) === 'Lua'){
    if(buffer[4] === 0x50) return 'LuaP';
    if(buffer[4] === 0x51) return 'LuaQ';
    if(buffer[4] === 0x52) return 'LuaR';
    if(buffer[4] === 0x53) return 'LuaS';
  }

  return inferLuaTool(input);
}

function shopS4MetaKey(filePath){
  return path.basename(filePath).toLowerCase();
}

const costumeTypeAliases = {
  body: 'top', top: 'top', shirt: 'top', shirts: 'top',
  leg: 'pants', pants: 'pants', skirt: 'pants', skirts: 'pants',
  hand: 'gloves', gloves: 'gloves',
  foot: 'shoes', shoes: 'shoes',
  acc: 'accessories', accessory: 'accessories', accessories: 'accessories',
  hats: 'accessories', hat: 'accessories',
  hair: 'hair', face: 'face',
  pet: 'pets', pets: 'pets',
  skills_cards: 'skills_cards', skills: 'skills_cards', cards: 'skills_cards'
};

function normalizeCostumeType(value){
  return costumeTypeAliases[String(value || '').toLowerCase()] || String(value || '').toLowerCase();
}

function normalizeCostumeSex(value){
  const clean = String(value || '').toLowerCase();
  if(clean === 'female' || clean === 'woman' || clean === 'w') return 'woman';
  if(clean === 'male' || clean === 'man' || clean === 'm') return 'man';
  return 'unisex';
}

function hasCostumeTypeDirs(candidateRoot){
  if(!candidateRoot || !fs.existsSync(candidateRoot)){
    return false;
  }

  return fs.readdirSync(candidateRoot, { withFileTypes: true })
    .some(entry => entry.isDirectory() && id_range[normalizeCostumeType(entry.name)]);
}

function resolveCostumeRoot(sourceRoot){
  const candidates = [
    path.join(sourceRoot, 'costumes')
  ];

  const root = candidates.find(hasCostumeTypeDirs);
  if(root){
    return root;
  }

  return null;
}

module.exports = { normalizeCostumeType,normalizeCostumeSex,hasCostumeTypeDirs,resolveCostumeRoot,inferLuaTool,detectLuaBytecodeTool,shopS4MetaKey };
