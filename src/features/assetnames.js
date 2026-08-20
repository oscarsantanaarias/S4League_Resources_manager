const path = require('path');


function escapeRegExp(value){
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanAssetBaseName(value){
  return path.basename(String(value || ''), path.extname(String(value || '')))
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .pop();
}

function assetNamesMatch(modelName, iconName){
  const modelBase = cleanAssetBaseName(modelName);
  const iconBase = cleanAssetBaseName(iconName);
  const cleanModelBase = modelBase.replace(/^icon_/i, '');
  const cleanIconBase = iconBase.replace(/^icon_/i, '');

  return modelBase === iconBase || cleanModelBase === cleanIconBase;
}

function splitRecolorBase(value){
  const base = cleanAssetBaseName(value).replace(/^icon_/i, '');
  const textureRecolor = base.match(/^(.*)_(?:a|e)tex_(\d+)$/i);
  if(textureRecolor){
    return { base: textureRecolor[1], index: Number.parseInt(textureRecolor[2], 10) || 0 };
  }

  const textureBase = base.match(/^(.*)_(?:a|e)tex$/i);
  if(textureBase){
    return { base: textureBase[1], index: 0 };
  }

  const match = base.match(/^(.*)_(\d+)$/);
  if(!match){
    return { base, index: 0 };
  }

  return { base: match[1], index: Number.parseInt(match[2], 10) || 0 };
}

function assetNamesMatchBase(modelName, assetName){
  const modelBase = cleanAssetBaseName(modelName).replace(/^icon_/i, '');
  return splitRecolorBase(assetName).base === modelBase;
}

function displayNameFromAssetName(value){
  return cleanAssetBaseName(value)
    .replace(/^icon_/i, '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function costumeModelAssetInfo(modelName, assetName){
  const modelBase = cleanAssetBaseName(modelName);
  const assetBase = cleanAssetBaseName(assetName);
  const escaped = escapeRegExp(modelBase);

  if(assetBase === modelBase || new RegExp(`^${escaped}_(?:a|e)tex$`, 'i').test(assetBase)){
    return { match: true, recolorIndex: 0 };
  }

  const recolor = assetBase.match(new RegExp(`^${escaped}_(?:a|e)tex_(\\d+)$`, 'i'));
  if(recolor){
    return { match: true, recolorIndex: Number.parseInt(recolor[1], 10) || 0 };
  }

  return { match: false, recolorIndex: 0 };
}

module.exports = { escapeRegExp,cleanAssetBaseName,assetNamesMatch,splitRecolorBase,assetNamesMatchBase,displayNameFromAssetName,costumeModelAssetInfo };
