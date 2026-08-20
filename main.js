const { app } = require('electron');

if (!app.isPackaged) {
  try {
    require('electron-reload')(__dirname, {
      electron: require(`${__dirname}/node_modules/electron`),
      watch: [
        `${__dirname}/resources/weapon`
      ],
      ignored: [
        /\.x7$/,
        /\.xml$/,
        /path\.init$/,
        /(^|[\\/])\.git([\\/]|$)/,
        /(^|[\\/])node_modules([\\/]|$)/,
        /(^|[\\/])resource_s4_todo([\\/]|$)/,
        /(^|[\\/])extracted_resources([\\/]|$)/,
        /(^|[\\/])_resources([\\/]|$)/,
        /(^|[\\/])_resources_loose_backup_/,
        /(^|[\\/])\.sneoz_cache([\\/]|$)/,
        /(^|[\\/])tmp([\\/]|$)/,
        /(^|[\\/])tools[\\/]ui_inspector([\\/]|$)/,
        /resources_\d+\.s4pack$/,
        /resources\.idx$/,
        /resource\.s4hd$/,
      ]
    });
  } catch (e) {}
}

const fsp = require('fs').promises;
const mysql = require('mysql2/promise');
const { getDirectories, ensureDefaultResourceDirectories, asegurarCarpetaMapaLibre, fs, path } = require('./src/utils/directory');
const { makeItemx7, makeCostumeItemx7, makeWeaponLua } = require('./src/builders/makeFile');
const itemS1 = require('./src/builders/itemS1');
const weaponsxml_funcs = require('./src/builders/makeWeaponXML');
const { BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const weapons_lua = require('./src/utils/weapon_lua_func');
const {setVerifierPaths, verifyFields, verifyItemX7, verifyInfox7, verifyWeaponLua, verifyWeaponsXML , verifyItem_xml, weaponlua, iteminfox7, weaponxml, weaponx7, itemx7, itemxml,  melee, special, sentries, guns, snipers, heavies, thrown, id_range, verifyString_tableXML, verifyString_tablex7, iteminfoStringX7, iteminfoStringXML } = require('./src/utils/verifiers');
const { read } = require('fs');
const { MakeTurrentDesc, MakeSubmachineDesc, MakeSparkRifleDesc,MakeBreakerDesc, MakeSmashDesc, MakeShotGunDesc, MakeSharpshootingDesc, MakeSentryStunDesc, MakeSentryGunDesc, MakeSemiRifleDesc, MakeRailGunDesc, MakeRocketLauncherDesc, 
MakeRevolverDesc, MakeRescueGunDesc, MakeMineGunDesc, MakeMindShockDesc, MakeMindHealDesc, MakeLightMachineGunDesc, MakeLightBombDesc, MakeHomingDesc, MakeHeavyMachineGunDesc, MakeHandGunDesc, MakeGaussDesc, MakeEarthBombDesc, MakeDualMagnumDesc, MakeCannonDesc, MakeAssaultDesc, MakeAirGunDesc, MakeVitalClawDesc, MakeTwinBladesDesc, MakeSigmaBladeDesc, MakeKatanaDesc, MakeIronBootsDesc, MakeFistDesc, MakeExoDesc, MakeDaggerDesc, MakeBatDesc, MakeCounterSwordDesc, MakePlasmaSwordDesc } = require('./src/builders/makeItemInfo');
const { addtodb, loadDbItemIds, repairWeaponShopRows, updateShopItemColors, shopItemExists } = require('./src/db/db')
const { testConnection } = require('./src/db/conexion');
const  { convertXmlFileToXbn, convertXbnFileToXml } = require('./src/codecs/xbnconverter');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const resourceDecoder = require('./s4zip/s4zip.cjs');
const mapsUtil = require('./src/utils/mapsutil');
const { parseScn } = require('./src/engine/scn_geometry');
const { PNG } = require('pngjs');
const prettyData = require('pretty-data').pd;
const { ddsToPngDataUrl, tgaToPngDataUrl } = require('./src/preview/imagecodec');
const ddsEncoder = require('./src/preview/ddsencoder');
const { analyzeScnTextures,analyzeSeqStrings,cleanScnDisplayString,decodeFontString,decodeSeqForPreview,decodeUtf16BE,detectTextEncoding,fontNameLabel,formatFloatTriplesSection,formatNumber,formatStringsSection,formatUIntSection,getAsciiStrings,getDecodedTextPreview,getFloatTriples,getFontType,getScnTextureRefs,getUIntRows,getUsefulStrings,isFontResource,isImageResource,isNavmeshResource,isOctResource,isPeBuffer,isScnResource,isSeqResource,isTextResource,isUsefulBinaryString,isUsefulScnString,isUsefulSeqString,isXemResource,parseFontNames,parseFontTables,parsePeInfo,patchScnTextureName,patchSeqString,previewFont,previewNavmesh,previewOct,previewPeModule,previewScn,previewSeq,previewSingleFont,readAsciiSafe,readCStringBuffer,readFontTag,readUInt16BE,readUInt32BE,rvaToOffset,scnInfoOf } = require('./src/preview/preview');
const { checksumHexToBigInt,writeUInt64LE,normalizePackKey,fnv64,packCipherTransform,normalizePackBaseName,normalizePackExtension,getPackFileName,readHexBuffer,swapBlocksLikeDll,patchResourceHeaderForBootstrap } = require('./src/resource/packcrypto');
const { escapeRegExp,cleanAssetBaseName,assetNamesMatch,splitRecolorBase,assetNamesMatchBase,displayNameFromAssetName,costumeModelAssetInfo } = require('./src/features/assetnames');
const { looksLikeSeq,seqPlaintext,scanSeqAssetNames,safeOutputPath,luaOutputPath,luaTextOutputPath,mapNameTableCloseTag } = require('./src/utils/toolhelpers');
const { normalizeCostumeType,normalizeCostumeSex,hasCostumeTypeDirs,resolveCostumeRoot,inferLuaTool,detectLuaBytecodeTool,shopS4MetaKey } = require('./src/features/misc');

let host = '';
let user = '';
let pass = '';
let db = '';

let dbConfig = {
  host: 'localhost',
  user: 'root',
  pass: '',
  db: 's4league'
};
const configPath = path.join(app.getPath('userData'), 'dbconfig.json');
const pathInitPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'path.init')
  : path.join(__dirname, 'path.init');
const UI_INSPECTOR_DIR_DEFECTO = path.join(app.getPath('userData'), 'ui_inspector');
let carpetaHookUi = UI_INSPECTOR_DIR_DEFECTO;

function rutaSnapshotUi(){
  return path.join(carpetaHookUi, 'rtool_ui_snapshot.tsv');
}

function rutaComandoUi(){
  return path.join(carpetaHookUi, 'rtool_ui_cmd.txt');
}

let weapon_files = false;
let weaponSourcePath = false;

let iteminfoID = 1;
let anclajesPet = {};
let nameID = 310;
let tipID = 310;

let useDB = false;
let itemAdded = false;
let dbRunIds = null;

let procesados = [];
let sqlError = false;
let resourceCache = {
  basePath: null,
  archive: null,
  dirty: false
};

const openedResourceTemps = new Map();
const defaultFilePaths = { itemx7, itemxml, weaponlua, weaponxml, weaponx7, iteminfox7, iteminfoStringX7, iteminfoStringXML };
let activeFilePaths = { ...defaultFilePaths };
let activePreviewRoot = null;
let skipWeaponsXml = false;
const SCN_TEXTURE_SLOT_SIZE = 1024;

function parseUiInspectorAddress(value){
  const raw = String(value || '').trim();
  if(!raw){
    return null;
  }

  const normalized = raw.toLowerCase().startsWith('0x')
    ? raw.slice(2)
    : raw;

  if(!/^[0-9a-f]+$/i.test(normalized)){
    return null;
  }

  return `0x${normalized.toUpperCase()}`;
}

async function readUiInspectorSnapshot(){
  const raw = await fsp.readFile(rutaSnapshotUi(), 'utf8');
  const lines = raw.replace(/\r/g, '').split('\n').filter(Boolean);

  if(lines.length < 2){
    return { version: 0, nodes: [], roots: [], state: null };
  }

  let startIndex = 0;
  let version = 0;
  const roots = [];
  let state = null;

  if(lines[0].startsWith('version\t')){
    version = Number(lines[0].split('\t')[1] || 0) || 0;
    startIndex = 1;
  }

  let tickAhora = 0;
  if(lines[startIndex] && lines[startIndex].startsWith('now\t')){
    tickAhora = Number(lines[startIndex].split('\t')[1] || 0) || 0;
    startIndex += 1;
  }

  if(lines[startIndex] && lines[startIndex].startsWith('state\t')){
    const cols = lines[startIndex].split('\t');
    state = {
      prevState: Number(cols[1] || 0) || 0,
      currentState: Number(cols[2] || 0) || 0,
      mainState: Number(cols[3] || 0) || 0,
      popupState: Number(cols[4] || 0) || 0,
      root: parseUiInspectorAddress(cols[5]),
      tick: Number(cols[6] || 0) || 0
    };
    startIndex += 1;
  }

  while(lines[startIndex] && lines[startIndex].startsWith('root\t')){
    const cols = lines[startIndex].split('\t');
    const address = parseUiInspectorAddress(cols[2]);
    if(address){
      roots.push({
        tag: cols[1] || 'Root',
        address,
        lastSeenTick: Number(cols[3] || 0) || 0
      });
    }
    startIndex += 1;
  }

  const archivosXui = [];
  while(lines[startIndex] && lines[startIndex].startsWith('xui\t')){
    archivosXui.push(lines[startIndex].split('\t')[1] || '');
    startIndex += 1;
  }

  let rectOffset = -1;
  if(lines[startIndex] && lines[startIndex].startsWith('rectoffset\t')){
    rectOffset = Number(lines[startIndex].split('\t')[1] || -1);
    startIndex += 1;
  }

  const header = (lines[startIndex] || '').split('\t');
  const indexes = {
    address: header.indexOf('address'),
    parent: header.indexOf('parent'),
    visible: header.indexOf('visible'),
    lastSeen: header.indexOf('lastseen'),
    x: header.indexOf('x'),
    y: header.indexOf('y'),
    w: header.indexOf('w'),
    h: header.indexOf('h'),
    name: header.indexOf('name'),
    className: header.indexOf('class')
  };

  const nodes = [];

  for(let i = startIndex + 1; i < lines.length; i += 1){
    const cols = lines[i].split('\t');
    const address = parseUiInspectorAddress(cols[indexes.address]);

    if(!address){
      continue;
    }

    const parent = parseUiInspectorAddress(cols[indexes.parent]) || 'ROOT';
    const visibleRaw = Number(cols[indexes.visible]);
    const visibleKnown = visibleRaw === 0 || visibleRaw === 1;

    nodes.push({
      address,
      parent,
      visibleKnown,
      visible: visibleKnown ? visibleRaw === 1 : null,
      lastSeenTick: Number(cols[indexes.lastSeen] || 0) || 0,
      x: indexes.x >= 0 ? Number(cols[indexes.x] || 0) || 0 : null,
      y: indexes.y >= 0 ? Number(cols[indexes.y] || 0) || 0 : null,
      ancho: indexes.w >= 0 ? Number(cols[indexes.w] || 0) || 0 : null,
      alto: indexes.h >= 0 ? Number(cols[indexes.h] || 0) || 0 : null,
      name: cols[indexes.name] || '',
      className: cols[indexes.className] || '<?>'
    });
  }

  return { version, tickAhora, nodes, roots, state, archivosXui, rectOffset };
}

function setActiveFilePaths(paths){
  activeFilePaths = { ...defaultFilePaths, ...paths };
  clientFormatCache = null;
  setVerifierPaths(activeFilePaths);
}

let clientFormatCache = null;

async function getClientFormat(){
  if(clientFormatCache) return clientFormatCache;

  try {
    const data = await fsp.readFile(activeFilePaths.iteminfox7, 'utf8');
    clientFormatCache = itemS1.detectFormat(data) === 's1' ? 's1' : 's10';
  } catch(e){
    clientFormatCache = 's10';
  }

  return clientFormatCache;
}

function resetActiveFilePaths(){
  setActiveFilePaths(defaultFilePaths);
  activePreviewRoot = null;
}

function getRequiredSourceResourcesRoot(sourceRoot){
  if(!sourceRoot){
    return null;
  }

  if(path.basename(sourceRoot).toLowerCase() === 'resources'){
    return null;
  }

  const resourcesRoot = path.join(sourceRoot, 'resources');
  ensureDefaultResourceDirectories(resourcesRoot);
  return resourcesRoot;
}

function getPreviewSrc(weaponName, weaType, item_dds){
  if(activePreviewRoot){
    const imgPath = path.join(activePreviewRoot, 'weapon', weaponName, weaType, 'imgs', item_dds);
    return 'file:///' + imgPath.replace(/\\/g, '/');
  }

  return `resources/weapon/${weaponName}/${weaType}/imgs/${item_dds}`;
}

function pushProcessedItem(id, weaName, status, weaponName, weaType, item_dds){
  const url = getPreviewSrc(weaponName, weaType, item_dds);

  if(procesados.some(item => item.src === url || (item.id === id && item.nombre === weaName))){
    return;
  }

  procesados.push({ id, nombre: weaName, status, src: url, evitar: false });
}

async function hydrateProcessedPreviewImages(items){
  return Promise.all(items.map(async item => {
    if(!item.src || !item.src.startsWith('file:///')){
      return item;
    }

    const filePath = decodeURIComponent(item.src.replace(/^file:\/\/\//, '')).replace(/\//g, path.sep);
    const ext = path.extname(filePath).toLowerCase();

    if(ext !== '.dds' && ext !== '.tga'){
      return item;
    }

    try {
      const data = await fsp.readFile(filePath);
      const previewSrc = ext === '.dds' ? ddsToPngDataUrl(data) : tgaToPngDataUrl(data);
      return { ...item, src: previewSrc, originalSrc: item.src };
    } catch(e) {
      console.warn(`Preview convert failed for ${filePath}:`, e.message);
      return item;
    }
  }));
}

async function findExistingItemIdByName(weaName){
  if(await getClientFormat() === 's1'){
    try {
      const data = await fsp.readFile(activeFilePaths.iteminfox7, 'utf8');
      const match = data.match(new RegExp(`<item[^>]*NAME="${escapeRegExp(weaName)}"[^>]*>[\\s\\S]*?name_key="N(\\d+)"`, 'i'));
      return match ? Number(match[1]) : null;
    } catch(e){
      return null;
    }
  }

  const files = [activeFilePaths.itemx7, activeFilePaths.itemxml];

  for(const file of files){
    try {
      const data = await fsp.readFile(file, 'utf8');
      const regex = new RegExp(`<item\\s+item_key="(\\d+)"[\\s\\S]*?<base\\s+name="${escapeRegExp(weaName)}"`, 'i');
      const match = data.match(regex);

      if(match){
        return Number(match[1]);
      }
    } catch(e) {}
  }

  return null;
}

async function syncSkippedItemToDb(id, final, weaName, weaType, weaponName, item_dds, host, user, pass, db){
  if(!useDB){
    return id;
  }

  const existingId = await findExistingItemIdByName(weaName);
  const dbId = Number.isFinite(existingId) ? existingId : id;

  if(dbId > final){
    return id;
  }

  if(dbRunIds && dbRunIds.has(Number(dbId))){
    return dbId;
  }

  const resAddDb = await addtodb(dbId, weaName, host, user, pass, db, dbRunIds, weaType, { clientFormat: await getClientFormat() });

  if(resAddDb === true){
    itemAdded = true;
    return dbId;
  }

  pushProcessedItem(dbId, weaName, 'NotAdded', weaponName, weaType, item_dds);
  return dbId;
}

async function verifyItemS1(id, weaName){
  const data = await fsp.readFile(activeFilePaths.iteminfox7, 'utf8');

  if(new RegExp(`NAME="${escapeRegExp(weaName)}"`).test(data)){
    return [false, 0];
  }

  return itemS1.hasItem(data, id) ? false : id;
}

async function addNewItem(id, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db){
    
 if(id > final) {
        console.error(`ID ${id} is out of range ${final} for weapon type: ${weaType}.`);
        return; 
    }
 
    try {

        const weaName = item_scn.split('.')[0].replace(/icon_/g, '').replace(/_/g, ' ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        
        const s1Mode = await getClientFormat() === 's1';

        const resItemX7 = s1Mode ? await verifyItemS1(id, weaName) : await verifyItemX7(id, weaName);

         const resItemXML = s1Mode ? id : await verifyItem_xml(id, weaType);

        const resWeaponlua = await verifyWeaponLua(id, weaType); 
        
        const resWeaponXML = skipWeaponsXml ? true : await verifyWeaponsXML(id, weaName);

        const resItemInfo = await verifyInfox7(nameID, tipID, weaName);

        const resItemInfoStringX7 = await verifyString_tablex7(nameID, tipID, weaName);
        const resItemInfoStringXML = await verifyString_tableXML(nameID, tipID, weaName);

        let resAddDb;
 
  if (resItemInfo === 'nombreEncontrado' || resItemInfoStringX7 === 'nombreEncontrado' || resItemInfoStringXML === 'nombreEncontrado' ){
  const dbId = await syncSkippedItemToDb(id, final, weaName, weaType, weaponName, item_dds, host, user, pass, db);
  pushProcessedItem(dbId, weaName, 'Skipped', weaponName, weaType, item_dds);
  return null;
}

else if(!resItemInfo){
       
            nameID += 1;
           return await addNewItem(id, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db);

        } else if(Array.isArray(resItemInfo) && !resItemInfo[0]){

            tipID += 1;

              return await addNewItem(id, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db);
        }
 
      if(!resItemX7){
      
        return await addNewItem(id + 1, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db)
      } else if(Array.isArray(resItemX7)){
        const dbId = await syncSkippedItemToDb(id, final, weaName, weaType, weaponName, item_dds, host, user, pass, db);
        pushProcessedItem(dbId, weaName, 'Skipped', weaponName, weaType, item_dds);
        return; 

      }
     
     if(!resWeaponXML){
        return await addNewItem(id + 1, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db)
      } else if(Array.isArray(resWeaponXML)){
        const dbId = await syncSkippedItemToDb(id, final, weaName, weaType, weaponName, item_dds, host, user, pass, db);
        pushProcessedItem(dbId, weaName, 'Skipped', weaponName, weaType, item_dds);
        return; 

      }

        if(!resItemXML){
            
        return await addNewItem(id + 1, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db)
      } else if(Array.isArray(await resItemXML)){
        const dbId = await syncSkippedItemToDb(id, final, weaName, weaType, weaponName, item_dds, host, user, pass, db);
        pushProcessedItem(dbId, weaName, 'Skipped', weaponName, weaType, item_dds);
        return; 

      }

        if(!resWeaponlua){
        return await addNewItem(id + 1, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db)
      } 

      if(useDB){

        if(dbRunIds && dbRunIds.has(Number(id))){
          return await addNewItem(id + 1, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db)
        }

        resAddDb = await addtodb(id, weaName, host, user, pass, db, dbRunIds, weaType, { clientFormat: await getClientFormat() });
        
      if(resAddDb === 2){
        return await addNewItem(id + 1, final, item_scn, item_dds, iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db)
      } 
      
      if(Array.isArray(resAddDb)){
        console.error('An error occured with the conexion to database, stopping...');
        pushProcessedItem(id, weaName, 'NotAdded', weaponName, weaType, item_dds);
        return;
      }

    }

      if(await getClientFormat() === 's1'){
        await appendWeaponItemS1(id, weaName, weaType, item_scn, item_dds);
      } else {
        const readItemx7 = await fsp.readFile(activeFilePaths.itemx7, 'utf8');
        
          let modifyItemX7 = readItemx7.replace(/<\/itemlist>\s*$/, await makeItemx7(id, item_dds, weaName, nameID, tipID, weaType) + '</itemlist>');
          
          if(!modifyItemX7 || modifyItemX7  === '' || modifyItemX7.length === 0){
          let newItemX7 = await makeItemx7(id, item_dds, weaName, nameID, tipID, weaType);
              modifyItemX7 = `
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<itemlist>
      ${newItemX7}
</itemlist>
            `;
          }

          await fsp.writeFile(activeFilePaths.itemx7, modifyItemX7, 'utf8');

        const readItemXML = await fsp.readFile(activeFilePaths.itemxml, 'utf8');
      
          let modifyItemXML = readItemXML.replace(/<\/itemlist>\s*$/, await makeItemx7(id, item_dds, weaName, nameID, tipID, weaType) + '</itemlist>');
        
          if(!modifyItemXML || modifyItemXML === '' || modifyItemXML.length === 0){
          let newItemXML = await makeItemx7(id, item_dds, weaName, nameID, tipID, weaType);
              modifyItemXML = `
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<itemlist>
      ${newItemXML}
</itemlist>
            `;
          }

          await fsp.writeFile(activeFilePaths.itemxml, modifyItemXML, 'utf8');
        
          const readItemInfo = await fsp.readFile(activeFilePaths.iteminfox7, 'utf8');

          const itemInfoFuncs = require('./src/builders/makeItemInfo');

          const buildMakeInfo = 'Make' + weaType + 'Desc';

           const callBuildInfo = itemInfoFuncs[buildMakeInfo];

           if(!callBuildInfo){
              return console.error('Call function does not exist.');
           }

           const newItemInfoDesc = callBuildInfo(nameID, tipID, weaName);
           
     let replaceItemInfo = readItemInfo.replace(`</string_table>`, `${newItemInfoDesc.NameDesc}` + `\n \t` + `\n \t` + `${newItemInfoDesc.TipDesc}` + `\n </string_table>`);

              if(!replaceItemInfo || replaceItemInfo === '' || replaceItemInfo.length === 0){
                  replaceItemInfo = `
<string_table>

   \t ${newItemInfoDesc.NameDesc} \n 

   \t ${newItemInfoDesc.TipDesc}

</string_table> 
                `;
              }

          await fsp.writeFile(activeFilePaths.iteminfox7, replaceItemInfo, 'utf8');
      }

      if(s1Mode){
        const stringEntries = { id, ...buildCostumeStringEntries(id, weaName) };
        await appendStringTable(activeFilePaths.iteminfoStringX7, stringEntries);
        await appendStringTable(activeFilePaths.iteminfoStringXML, stringEntries);
      } else {

        const readItemInfoStringX7 = await fsp.readFile(activeFilePaths.iteminfoStringX7, 'utf8');

        const itemInfoStringX7_Funcs = require('./src/builders/makeItemInfo');

        const buildMakeInfoStringX7 = 'Make' + weaType + 'Desc';

         const callBuildInfoStringX7 = itemInfoStringX7_Funcs[buildMakeInfoStringX7];

         if(!callBuildInfoStringX7){
            return console.error('Call function does not exist.');
         }

         const newItemInfoStringX7Desc = callBuildInfoStringX7(nameID, tipID, weaName);
         
   let replaceItemInfoStringX7 = readItemInfoStringX7.replace(`</string_table>`, `${newItemInfoStringX7Desc.NameDesc}` + `\n \t` + `\n \t` + `${newItemInfoStringX7Desc.TipDesc}` + `\n </string_table>`);

            if(!replaceItemInfoStringX7 || replaceItemInfoStringX7 === '' || replaceItemInfoStringX7.length === 0){
                replaceItemInfoStringX7 = `
<string_table>

 \t ${newItemInfoStringX7Desc.NameDesc} \n 

 \t ${newItemInfoStringX7Desc.TipDesc}

</string_table> 
                `;
            }

        await fsp.writeFile(activeFilePaths.iteminfoStringX7, replaceItemInfoStringX7, 'utf8');

        const readItemInfoStringXML = await fsp.readFile(activeFilePaths.iteminfoStringXML, 'utf8');

        const itemInfoStringXML_Funcs = require('./src/builders/makeItemInfo');

        const buildMakeInfoStringXML = 'Make' + weaType + 'Desc';

         const callBuildInfoStringXML = itemInfoStringXML_Funcs[buildMakeInfoStringXML];

         if(!callBuildInfoStringXML){
            return console.error('Call function does not exist.');
         }

         const newItemInfoStringXMLDesc = callBuildInfoStringXML(nameID, tipID, weaName);
         
   let replaceItemInfoStringXML = readItemInfoStringXML.replace(`</string_table>`, `${newItemInfoStringXMLDesc.NameDesc}` + `\n \t` + `\n \t` + `${newItemInfoStringXMLDesc.TipDesc}` + `\n </string_table>`);

            if(!replaceItemInfoStringXML || replaceItemInfoStringXML === '' || replaceItemInfoStringXML.length === 0){
                replaceItemInfoStringXML = `
<string_table>

 \t ${newItemInfoStringXMLDesc.NameDesc} \n 

 \t ${newItemInfoStringXMLDesc.TipDesc}

</string_table> 
                `;
            }

        await fsp.writeFile(activeFilePaths.iteminfoStringXML, replaceItemInfoStringXML, 'utf8');       
      }

        const readWeaponlua = await fsp.readFile(activeFilePaths.weaponlua, 'utf8');
            const newLuaDesc = await makeWeaponLua(resWeaponlua, weaType);
          
        let replaceInWeaponlua = readWeaponlua.replace('</weapon_lua_list>',  newLuaDesc + '</weapon_lua_list>');

        if(!replaceInWeaponlua || replaceInWeaponlua.length === 0 || replaceInWeaponlua === ''){
            replaceInWeaponlua = `
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<weapon_lua_list>
            ${newLuaDesc}
</weapon_lua_list>
            `;
        }

        await fsp.writeFile(activeFilePaths.weaponlua, replaceInWeaponlua, 'utf8');

     if(!skipWeaponsXml){
     const readWeaponXML = await fsp.readFile(activeFilePaths.weaponxml, 'utf8');

        const buildWeaponXML = weaponsxml_funcs['Make' + weaType + 'XML'];

        const callBuildWeaponXML = buildWeaponXML(id, item_scn, item_dds);

        let replaceWeaponXML = readWeaponXML.replace('</weaponlist>', callBuildWeaponXML + '</weaponlist>');

        if(!replaceWeaponXML || replaceWeaponXML.length === '' || replaceWeaponXML.length === 0){
            replaceWeaponXML = `
<weaponlist>
        ${callBuildWeaponXML}
</weaponlist>

            `;

        }

        await fsp.writeFile(activeFilePaths.weaponxml, replaceWeaponXML, 'utf8');
     }

        if(useDB && !itemAdded){
          itemAdded = true;
        }
    
      pushProcessedItem(id, weaName, 'Added', weaponName, weaType, item_dds);
         
    } catch(e){
        console.error(e); 
    }
}

async function Ejecutar(iteminfoID, weapon_files, host, user, pass, db){
  procesados = [];
  dbRunIds = null;
  const weaponColorByName = new Map();

  if(useDB){
    const connectionTest = await testConnection(host, user, pass, db);

    if(Array.isArray(connectionTest)){
      if(!sqlError){
        sqlError = true;
        dialog.showErrorBox('Database Error', `${connectionTest[1].error}`);
      }
      return;
    }

    dbRunIds = await loadDbItemIds(host, user, pass, db);
  }

    for(const [weaponName, weaponFiles] of Object.entries(weapon_files)){
           
        for(const [weaType, weaFiles] of Object.entries(weaponFiles)){
            
            const imgs = weaFiles.imgs;
            const models = weaFiles.model.sort();
         
            let inicio = null;
            let final = null;
            
            if(melee.includes(weaType)){
                [inicio, final] = id_range['melee'];
            }
            if(guns.includes(weaType)){
                [inicio, final] = id_range['guns'];
            }
            if(snipers.includes(weaType)){
                [inicio, final] = id_range['snipers'];
            }
            if(sentries.includes(weaType)){
                [inicio, final] = id_range['sentries']; 
            }
            if(heavies.includes(weaType)){
                [inicio, final] = id_range['heavies'];
            }
            if(thrown.includes(weaType)){
                [inicio, final] = id_range['thrown'];
            }

            if(special.includes(weaType)){
                [inicio, final] = id_range['special'];
            }
              
            65
            let i = 0;
            while(i < models.length){
            const elemento = models[i].split('.')[0];
            const recolors = new Set();
            for(const img of imgs){
              if(assetNamesMatchBase(elemento, img)){
                const info = splitRecolorBase(img);
                if(info.index > 0){
                  recolors.add(info.index);
                }
              }
            }
            const recolorCount = recolors.size;
            if(recolorCount > 0){
              weaponColorByName.set(displayNameFromAssetName(elemento), 1 + recolorCount);
            }
             
               const imgsrc = 'resources/weapon/' + weaponName + '/' + weaType  + '/' + 'imgs/'+ imgs[i];
             
                const ele_icon = 'icon_' + elemento;
                const ele_icono = 'Icon_' + elemento;
                
            for(let a = 0; a < imgs.length; a++){

                if(imgs[a].length > 0){

                   const cleanImg = imgs[a].split('.')[0];
                   const recolorInfo = splitRecolorBase(cleanImg);
                   if(recolorInfo.index > 0 && assetNamesMatchBase(elemento, cleanImg)){
                    continue;
                   }
                    if(assetNamesMatch(elemento, cleanImg)){
                        
                      await addNewItem(inicio, final,  models[i] ,imgs[a], iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db);

                    } else if(ele_icon === cleanImg || ele_icono === cleanImg){
        
                        await addNewItem(inicio, final, models[i] ,imgs[a], iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db);
                    } else {
                      const cleanBase = cleanAssetBaseName(cleanImg);
                      const modelNames = models.map(model => model.toLowerCase());
                      const hasPair = modelNames.includes(`${cleanBase}_r.scn`) && modelNames.includes(`${cleanBase}_l.scn`);
                      if(hasPair){
                        const scnName = cleanBase + '.scn';

                        if (!scnName) {
                          console.warn(`Could not extract file name from: ${imgs[a]}`);
                          continue; 
                        }

                        await addNewItem(inicio, final, scnName, imgs[a], iteminfoID, weaType, imgsrc, weaponName, host, user, pass, db);
                      }
                    }
                }
            }
                i++;
            } 
            
        }
    } 
    if (useDB && itemAdded) {
  const changeShopVersion = "UPDATE shop_version SET Version = Version + 1";
  let connect;

  try {
    connect = await mysql.createConnection({
      host: host,
      user: user,
      password: pass,
      database: db
    });

    await connect.beginTransaction();

    const [shopversion_result] = await connect.query(changeShopVersion);

    if (shopversion_result.affectedRows > 0) {
      await connect.commit();
    } else {
      await connect.rollback();
    }

  } catch (e) {
    if (connect) {
      try {
        await connect.rollback();
      } catch (rollbackErr) {
        console.error('Error reversing changes:', rollbackErr.message);
      }
    }

    console.error('An error occurred updating the shop version:', e.message);
  } finally {
    if (connect) {
      await connect.end(); 
    }
  }
}

    if(useDB){
      const idsToRepair = [...new Set(procesados.map(item => Number(item.id)).filter(id => Number.isFinite(id)))];
      if(idsToRepair.length > 0){
        await repairWeaponShopRows(idsToRepair, host, user, pass, db);
      }
      const colorUpdates = procesados
        .map(item => ({
          id: Number(item.id),
          colors: weaponColorByName.get(item.nombre)
        }))
        .filter(item => Number.isFinite(item.id) && Number.isFinite(item.colors) && item.colors > 1);
      if(colorUpdates.length > 0){
        await updateShopItemColors(colorUpdates, host, user, pass, db);
        if(!itemAdded){
          let connect;
          try {
            connect = await mysql.createConnection({
              host,
              user,
              password: pass,
              database: db
            });
            await connect.query("UPDATE shop_version SET Version = Version + 1");
          } finally {
            if(connect) await connect.end();
          }
        }
      }
    }

    sqlError = false;
    itemAdded = false;

}

const chokidar = require('chokidar');

let mainWindow = null;
let uiInspectorWindow = null;
let suppressResourceReload = false;

function crearVentana(){
  mainWindow = new BrowserWindow({
    width:1120,
    height:760,
    minWidth:700,
    minHeight:500,
    title:'Resources & Mods manager',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  ipcMain.on('win-minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('win-maximize', () => { if(mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
  ipcMain.on('win-close', () => mainWindow && mainWindow.close());

  mainWindow.loadFile('index.html');

  chokidar.watch(`${__dirname}/resources/weapon`, {
    ignored: /\.(x7|xml)$/i,
    persistent: true,
    ignoreInitial: true
  }).on('add', path => {
    if (mainWindow && !suppressResourceReload) {
      mainWindow.webContents.reload();
    }
  });
}

ipcMain.handle('selectFolder', async() => {
	
	const resultado = await dialog.showOpenDialog({
		properties: ['openDirectory']
	});
	
	if(resultado.canceled) return null;
	
	return resultado.filePaths[0];
});

ipcMain.handle('selectSeqFile', async() => {
	const resultado = await dialog.showOpenDialog({
		properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'SEQ Files', extensions: ['seq'] },
      { name: 'All Files', extensions: ['*'] }
    ]
	});
	
	if(resultado.canceled) return null;
	return resultado.filePaths;
});

ipcMain.handle('encryptSeqFiles', async() => {
  try {
    const resultado = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'SEQ Source Files', extensions: ['seq', 'txt', 'bin', '*'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if(resultado.canceled){
      return { ok: true, canceled: true, outputs: [] };
    }

    const outputs = [];

    for(const input of resultado.filePaths){
      const data = await fsp.readFile(input);
      const parsed = path.parse(input);
      const outputName = parsed.ext.toLowerCase() === '.seq' ? `${parsed.name}.crypted.seq` : `${parsed.name}.seq`;
      const outputPath = path.join(parsed.dir, outputName);
      const encoded = resourceDecoder.encodeStandaloneSeq(data);

      await fsp.writeFile(outputPath, encoded);
      outputs.push(outputPath);
    }

    return { ok: true, canceled: false, outputs };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

const scncodec = require('./src/codecs/scncodec');
const seqcodec = require('./src/codecs/seqcodec');

ipcMain.handle('scnToJson', async () => {
  try {
    const resultado = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'SCN Files', extensions: ['scn'] }, { name: 'All Files', extensions: ['*'] }]
    });
    if(resultado.canceled) return { ok: true, canceled: true, outputs: [] };
    const outputs = [];
    for(const input of resultado.filePaths){
      const data = await fsp.readFile(input);
      const json = scncodec.scnToJson(data);
      const out = input.replace(/\.scn$/i, '') + '.json';
      await fsp.writeFile(out, JSON.stringify(json, null, 2));
      outputs.push(out);
    }
    return { ok: true, canceled: false, outputs };
  } catch(e){ return { ok: false, error: e.message }; }
});

ipcMain.handle('scnFromJson', async () => {
  try {
    const jr = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
    });
    if(jr.canceled) return { ok: true, canceled: true, outputs: [] };
    const outputs = [];
    for(const jsonPath of jr.filePaths){
      const json = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      let scnPath = jsonPath.replace(/\.json$/i, '') + '.scn';
      try { await fsp.access(scnPath); }
      catch {
        const sr = await dialog.showOpenDialog({ title: 'Select the ORIGINAL .scn to patch', properties: ['openFile'], filters: [{ name: 'SCN Files', extensions: ['scn'] }] });
        if(sr.canceled) continue;
        scnPath = sr.filePaths[0];
      }
      const orig = await fsp.readFile(scnPath);
      const { buf, patched } = scncodec.applyJson(orig, json);
      const out = scnPath.replace(/\.scn$/i, '') + '.patched.scn';
      await fsp.writeFile(out, buf);
      outputs.push(out + '  (' + patched + ' valores)');
    }
    return { ok: true, canceled: false, outputs };
  } catch(e){ return { ok: false, error: e.message }; }
});

ipcMain.handle('seqToJson', async () => {
  try {
    const resultado = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'SEQ Files', extensions: ['seq'] }, { name: 'All Files', extensions: ['*'] }]
    });
    if(resultado.canceled) return { ok: true, canceled: true, outputs: [] };
    const outputs = [];
    for(const input of resultado.filePaths){
      const raw = await fsp.readFile(input);
      const data = seqPlaintext(raw);
      const json = seqcodec.seqToJson(data);
      const out = input.replace(/\.seq$/i, '') + '.json';
      await fsp.writeFile(out, JSON.stringify(json, null, 2));
      outputs.push(out);
    }
    return { ok: true, canceled: false, outputs };
  } catch(e){ return { ok: false, error: e.message }; }
});

ipcMain.handle('seqFromJson', async () => {
  try {
    const jr = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
    });
    if(jr.canceled) return { ok: true, canceled: true, outputs: [] };
    const outputs = [];
    for(const jsonPath of jr.filePaths){
      const json = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
      let seqPath = jsonPath.replace(/\.json$/i, '') + '.seq';
      try { await fsp.access(seqPath); }
      catch {
        const sr = await dialog.showOpenDialog({ title: 'Select the ORIGINAL .seq to patch', properties: ['openFile'], filters: [{ name: 'SEQ Files', extensions: ['seq'] }] });
        if(sr.canceled) continue;
        seqPath = sr.filePaths[0];
      }
      const raw = await fsp.readFile(seqPath);
      const wasEncrypted = !looksLikeSeq(raw);
      const plain = wasEncrypted ? resourceDecoder.decodeStandaloneSeq(raw) : raw;
      const { buf, patched } = seqcodec.applyJson(plain, json);
      const finalBuf = wasEncrypted ? resourceDecoder.encodeStandaloneSeq(buf) : buf;
      const out = seqPath.replace(/\.seq$/i, '') + '.patched.seq';
      await fsp.writeFile(out, finalBuf);
      outputs.push(out + '  (' + patched + ' valores)');
    }
    return { ok: true, canceled: false, outputs };
  } catch(e){ return { ok: false, error: e.message }; }
});

const luaToolRoot = path.join(__dirname, 'Lua decriptors');
const luaTools = [
  {
    id: 'auto',
    label: 'Auto',
  },
  {
    id: 'LuaP',
    label: 'LuaP 5.0',
    compiler: path.join(luaToolRoot, 'LuaP-1139', 'luac50.exe'),
    cwd: path.join(luaToolRoot, 'LuaP-1139')
  },
  {
    id: 'LuaQ',
    label: 'LuaQ 5.1',
    compiler: path.join(luaToolRoot, 'LuaQ', 'LuaWin', 'luac5.1.exe'),
    cwd: path.join(luaToolRoot, 'LuaQ')
  },
  {
    id: 'LuaQ-Plus',
    label: 'LuaQ-Plus',
    compiler: path.join(luaToolRoot, 'LuaQ-Plus', 'luaplusc.exe'),
    cwd: path.join(luaToolRoot, 'LuaQ-Plus')
  },
  {
    id: 'LuaR',
    label: 'LuaR 5.2',
    compiler: path.join(luaToolRoot, 'LuaR', 'luac52.exe'),
    cwd: path.join(luaToolRoot, 'LuaR')
  },
  {
    id: 'LuaS',
    label: 'LuaS 5.3',
    compiler: path.join(luaToolRoot, 'LuaS', 'luac53.exe'),
    cwd: path.join(luaToolRoot, 'LuaS')
  }
];

function runFile(file, args, options = {}){
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd: options.cwd || path.dirname(file),
      encoding: options.encoding || 'buffer',
      maxBuffer: options.maxBuffer || 1024 * 1024 * 120
    }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

function cleanToolError(result){
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
  return (stderr || result.error?.message || 'Unknown tool error').trim();
}

function getLuaTool(id){
  return luaTools.find(item => item.id === id);
}

async function selectLuaFiles(){
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Lua Files', extensions: ['lua', 'luac'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if(result.canceled){
    return null;
  }

  return result.filePaths;
}

async function chooseLuaCryptVersion(firstPath){
  const labels = luaTools.map(item => item.label).concat('Cancel');
  const result = await dialog.showMessageBox({
    type: 'question',
    title: 'Crypt Lua',
    message: 'Select Lua crypt/compiler version',
    detail: `Auto uses folder/version hint. Current guess: ${inferLuaTool(firstPath)}`,
    buttons: labels,
    cancelId: labels.length - 1,
    defaultId: 0
  });

  if(result.response === labels.length - 1){
    return null;
  }

  return luaTools[result.response].id;
}

async function disassembleLua(input){
  const data = await fsp.readFile(input);
  const tool = getLuaTool(detectLuaBytecodeTool(data, input));

  if(!tool || !tool.compiler || !fs.existsSync(tool.compiler)){
    throw new Error('No compatible Lua disassembler found.');
  }

  const result = await runFile(tool.compiler, ['-l', input], { cwd: tool.cwd });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout || ''), 'utf8');

  if(stdout.length === 0){
    throw new Error(cleanToolError(result));
  }

  return stdout;
}

async function compileLuaWithTool(input, toolId){
  const tool = getLuaTool(toolId);

  if(!tool || !tool.compiler || !fs.existsSync(tool.compiler)){
    throw new Error(`Lua compiler not found for ${toolId}.`);
  }

  const output = luaOutputPath(input, '.crypted', 'crypt');
  const result = await runFile(tool.compiler, ['-o', output, input], { cwd: tool.cwd });

  if(result.error || !fs.existsSync(output)){
    throw new Error(cleanToolError(result));
  }

  return output;
}

async function compileLuaAuto(input, selectedToolId){
  const ids = selectedToolId === 'auto'
    ? [inferLuaTool(input), 'LuaQ', 'LuaP', 'LuaQ-Plus', 'LuaR', 'LuaS'].filter((value, index, arr) => arr.indexOf(value) === index)
    : [selectedToolId];

  const errors = [];

  for(const id of ids){
    try {
      return { output: await compileLuaWithTool(input, id), version: id };
    } catch(e){
      errors.push(`${id}: ${e.message}`);
    }
  }

  throw new Error(errors.join(' | '));
}

ipcMain.handle('decryptLuaFiles', async () => {
  try {
    const inputs = await selectLuaFiles();

    if(!inputs){
      return { ok: true, canceled: true, converted: [], failed: [] };
    }

    const decompiler = path.join(luaToolRoot, 'LuadecP', 'Luadec', 'luadec.exe');

    if(!fs.existsSync(decompiler)){
      return { ok: false, error: 'luadec.exe not found.' };
    }

    const converted = [];
    const failed = [];

    for(const input of inputs){
      const output = luaOutputPath(input, '.decrypted', 'decrypt');
      const result = await runFile(decompiler, [input], { cwd: path.dirname(decompiler) });
      const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout || ''), 'utf8');

      if(stdout.length > 0){
        await fsp.writeFile(output, stdout);
        converted.push(output);
      } else {
        try {
          const disasm = await disassembleLua(input);
          const disasmOutput = luaTextOutputPath(input, '.disasm', 'decrypt');
          await fsp.writeFile(disasmOutput, disasm);
          converted.push(disasmOutput);
        } catch(e) {
          failed.push({ input, error: cleanToolError(result) || e.message });
        }
      }
    }

    return { ok: true, canceled: false, converted, failed };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('encryptLuaFiles', async () => {
  try {
    const inputs = await selectLuaFiles();

    if(!inputs){
      return { ok: true, canceled: true, converted: [], failed: [] };
    }

    const selectedToolId = await chooseLuaCryptVersion(inputs[0]);

    if(!selectedToolId){
      return { ok: true, canceled: true, converted: [], failed: [] };
    }

    const converted = [];
    const failed = [];
    const usedVersions = new Set();

    for(const input of inputs){
      try {
        const result = await compileLuaAuto(input, selectedToolId);
        converted.push(result.output);
        usedVersions.add(result.version);
      } catch(e){
        failed.push({ input, error: e.message });
      }
    }

    return {
      ok: true,
      canceled: false,
      converted,
      failed,
      version: [...usedVersions].join(', ') || selectedToolId
    };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('selectResourceFile', async() => {
	const resultado = await dialog.showOpenDialog({
		properties: ['openFile']
	});
	
	if(resultado.canceled) return null;
	return resultado.filePaths[0];
});

ipcMain.handle('selectResourceFiles', async() => {
	const resultado = await dialog.showOpenDialog({
		properties: ['openFile', 'multiSelections']
	});
	
	if(resultado.canceled) return [];
	return resultado.filePaths;
});

ipcMain.handle('selectExtractFolder', async(event, defaultPath = '') => {
	const options = {
		properties: ['openDirectory']
	};

	if(defaultPath && fs.existsSync(defaultPath)){
		options.defaultPath = defaultPath;
	}

	const resultado = await dialog.showOpenDialog(options);

	if(resultado.canceled) return null;
	return resultado.filePaths[0];
});

ipcMain.handle('dirLocation', async (event, ruta) => {

	if(ruta){
	
	const resourcesRoot = getRequiredSourceResourcesRoot(ruta);
	weapon_files = resourcesRoot ? getDirectories(resourcesRoot).weapon : {};
	weaponSourcePath = ruta;
	
	} else {	
		 return null
	}
});

ipcMain.handle('addItems', async (event, useDBS) => {
  procesados = []; 
  useDB = useDBS;
  resetActiveFilePaths();
  suppressResourceReload = true;

  try {
    await Ejecutar(iteminfoID, weapon_files, dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db);
  } finally {
    suppressResourceReload = false;
  }

  return [...procesados];
});

ipcMain.handle('show-confirm', async () => {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 0,
    title: 'Confirm',
    message: 'Would you like to apply changes?'
  });

  return result.response === 0; 
});

ipcMain.handle('XBNtoXML', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Select .xbn files to decrypt to XML (you can pick several)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'XBN', extensions: ['xbn'] }, { name: 'Todos', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const results = [];
  for (const input of r.filePaths) {
    const output = input.replace(/\.[^.\\/]+$/, '') + '.xml';
    try { await convertXbnFileToXml(input, output); results.push({ ok: true, input, output }); }
    catch (e) { results.push({ ok: false, error: e.message, input }); }
  }
  return { results };
});

ipcMain.handle('XMLtoXBN', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Select .xml files to convert to XBN (you can pick several)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'XML', extensions: ['xml'] }, { name: 'Todos', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const results = [];
  for (const input of r.filePaths) {
    const output = input.replace(/\.[^.\\/]+$/, '') + '.xbn';
    try { await convertXmlFileToXbn(input, output); results.push({ ok: true, input, output }); }
    catch (e) { results.push({ ok: false, error: e.message, input }); }
  }
  return { results };
});

const shopS4Dir = path.join(__dirname, 'shop');
const shopS4MetaPath = path.join(app.getPath('userData'), 'shop-s4-meta.json');

async function loadShopS4Meta(){
  try {
    return JSON.parse(await fsp.readFile(shopS4MetaPath, 'utf8'));
  } catch(e) {
    return {};
  }
}

async function saveShopS4Meta(meta){
  await fsp.mkdir(path.dirname(shopS4MetaPath), { recursive: true });
  await fsp.writeFile(shopS4MetaPath, JSON.stringify(meta, null, 2), 'utf8');
}

ipcMain.handle('decryptShopS4Files', async () => {
  try {
    const selected = await dialog.showOpenDialog({
      defaultPath: fs.existsSync(shopS4Dir) ? shopS4Dir : __dirname,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Shop S4 Files', extensions: ['s4'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if(selected.canceled || !selected.filePaths.length){
      return { ok: true, converted: [], canceled: true };
    }

    const converted = [];
    const meta = await loadShopS4Meta();

    for(const input of selected.filePaths){
      const outputDir = path.dirname(input);
      const output = path.join(outputDir, path.basename(input).replace(/\.s4$/i, '.xml'));
      const decoded = resourceDecoder.decodeShopS4(await fsp.readFile(input));

      await fsp.writeFile(output, prettyData.xml(decoded.xml.toString('utf8')), 'utf8');
      meta[shopS4MetaKey(input)] = decoded.meta;
      converted.push(output);
    }

    await saveShopS4Meta(meta);
    return { ok: true, converted };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('encryptShopS4Files', async () => {
  try {
    const selected = await dialog.showOpenDialog({
      defaultPath: fs.existsSync(shopS4Dir) ? shopS4Dir : __dirname,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Shop XML Files', extensions: ['xml'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if(selected.canceled || !selected.filePaths.length){
      return { ok: true, converted: [], canceled: true };
    }

    const converted = [];
    const meta = await loadShopS4Meta();

    for(const input of selected.filePaths){
      const outputDir = path.dirname(input);
      const outputName = path.basename(input).replace(/\.xml$/i, '.s4');
      const output = path.join(outputDir, outputName);
      let fileMeta = meta[shopS4MetaKey(outputName)];

      if(!fileMeta){
        try {
          const localMeta = JSON.parse(await fsp.readFile(path.join(outputDir, '.s4meta.json'), 'utf8'));
          fileMeta = localMeta[outputName] || localMeta[shopS4MetaKey(outputName)];
        } catch(e) {}
      }

      const xml = prettyData.xmlmin((await fsp.readFile(input, 'utf8')).trim());
      const encoded = resourceDecoder.encodeShopS4(xml, fileMeta || {});
      await fsp.writeFile(output, encoded);
      converted.push(output);
    }

    return { ok: true, converted };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

async function writeConvertedBinaryTextFiles(folder){
  const converted = [];

  async function walk(current){
    const items = await fsp.readdir(current, { withFileTypes: true });

    for(const item of items){
      const fullPath = path.join(current, item.name);

      if(item.isDirectory()){
        await walk(fullPath);
        continue;
      }

      if(!isOctResource(fullPath) && !isNavmeshResource(fullPath) && !isFontResource(fullPath)){
        continue;
      }

      const data = await fsp.readFile(fullPath);
      const textPreview = getDecodedTextPreview(fullPath, data);

      if(textPreview === null){
        continue;
      }

      const output = fullPath + '.txt';
      await fsp.writeFile(output, textPreview, 'utf8');
      converted.push(output);
    }
  }

  await walk(folder);
  return converted;
}

ipcMain.handle('extractResources', async (event, ruta) => {
  const basePath = ruta ? ruta : __dirname;
  const resourceFile = path.join(basePath, 'resource.s4hd');
  const resourceFolder = path.join(basePath, '_resources');
  const outputFolder = path.join(basePath, 'extracted_resources');
  const scriptPath = path.join(__dirname, 's4zip', 's4zip.cjs');

  try {
    await fsp.access(resourceFile);
    await fsp.access(resourceFolder);
    await fsp.access(scriptPath);
  } catch(e) {
    return {
      ok: false,
      error: 'resource.s4hd, _resources or s4zip/s4zip.cjs not found in the path.'
    };
  }

  return await new Promise((resolve) => {
    const nodePath = process.env.npm_node_execpath || process.env.NODE_EXE || 'node';
    let stdoutText = '';
    let stderrText = '';
    let progress = { extracted: 0, total: 0, remaining: 0 };
    const sendProgress = (patch = {}) => {
      progress = { ...progress, ...patch };
      if(progress.total > 0){
        progress.remaining = Math.max(progress.total - progress.extracted, 0);
      }
      event.sender.send('extractResourcesProgress', progress);
    };
    const parseProgress = (text) => {
      const totalMatch = text.match(/extracting:\s*(\d+)/i);
      if(totalMatch){
        sendProgress({ total: Number(totalMatch[1]), extracted: 0 });
      }

      const matches = [...text.matchAll(/ok\s+(\d+)\/(\d+)/gi)];
      for(const match of matches){
        sendProgress({ extracted: Number(match[1]), total: Number(match[2]) });
      }
    };

    sendProgress({ extracted: 0, total: 0, remaining: 0 });

    const child = spawn(nodePath, [scriptPath, resourceFile, resourceFolder, outputFolder], {
      cwd: __dirname,
      windowsHide: true
    });

    child.stdout.on('data', data => {
      const text = data.toString();
      stdoutText += text;
      parseProgress(text);
    });

    child.stderr.on('data', data => {
      const text = data.toString();
      stderrText += text;
      parseProgress(text);
    });

    child.on('error', error => {
      resolve({ ok: false, error: error.message, output: outputFolder });
    });

    child.on('close', async code => {
      if(code !== 0){
        console.error('Resource extract error:', stderrText || `node exited ${code}`);
        resolve({
          ok: false,
          error: stderrText || `node exited ${code}`,
          output: outputFolder
        });
        return;
      }

      let converted = [];
      let convertError = null;
      sendProgress({ phase: 'Converting previews' });

      try {
        converted = await writeConvertedBinaryTextFiles(outputFolder);
      } catch(e) {
        convertError = e.message;
      }

      resolve({
        ok: true,
        message: stdoutText + `converted text previews: ${converted.length}\n` + (convertError ? `convert preview error: ${convertError}\n` : ''),
        output: outputFolder
      });
    });
  });
});

async function walkFiles(root){
  const files = [];
  const stack = [root];

  while(stack.length){
    const folder = stack.pop();
    const children = await fsp.readdir(folder, { withFileTypes: true });

    for(const child of children){
      const childPath = path.join(folder, child.name);

      if(child.isDirectory()){
        stack.push(childPath);
      } else if(child.isFile()){
        files.push(childPath);
      }
    }
  }

  return files;
}

function createUiInspectorWindow(){
  if(uiInspectorWindow && !uiInspectorWindow.isDestroyed()){
    uiInspectorWindow.focus();
    return uiInspectorWindow;
  }

  uiInspectorWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    autoHideMenuBar: true,
    title: 'rtool UI Inspector',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  Menu.setApplicationMenu(null);
  uiInspectorWindow.setMenuBarVisibility(false);
  uiInspectorWindow.loadFile('ui_inspector.html');
  uiInspectorWindow.on('closed', () => {
    uiInspectorWindow = null;
  });

  return uiInspectorWindow;
}

async function loadExtractManifest(inputFolder){
  const manifestPath = path.join(inputFolder, 'manifest.json');

  if(!fs.existsSync(manifestPath)){
    return new Map();
  }

  try {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    return new Map(entries.map(entry => [
      String(entry.fullName || '').toLowerCase().replace(/\\/g, '/'),
      entry
    ]));
  } catch(e){
    return new Map();
  }
}

function randomResourceChecksumHex(used){
  let hex = '';
  do {
    hex = crypto.randomBytes(8).toString('hex');
  } while(used.has(hex));
  used.add(hex);
  return hex;
}

async function randomizeResourceNames(archive, resourceFolder){
  await fsp.mkdir(resourceFolder, { recursive: true });

  const existingFiles = await fsp.readdir(resourceFolder, { withFileTypes: true });
  const existingByLower = new Map();

  for(const item of existingFiles){
    if(item.isFile()){
      existingByLower.set(item.name.toLowerCase(), path.join(resourceFolder, item.name));
    }
  }

  const used = new Set();
  const written = new Set();
  const oldPaths = new Set();
  let renamed = 0;

  for(const entry of archive.entries){
    const candidates = resourceDecoder.checksumCandidates(entry.checksum);
    let sourcePath = null;

    for(const candidate of candidates){
      const found = existingByLower.get(candidate.toLowerCase());
      if(found){
        sourcePath = found;
        break;
      }
    }

    if(!sourcePath){
      throw new Error(`resource file missing while randomizing: ${candidates[0]}`);
    }

    const newHex = randomResourceChecksumHex(used);
    const targetPath = path.join(resourceFolder, newHex);
    await fsp.copyFile(sourcePath, targetPath);
    entry.checksum = checksumHexToBigInt(newHex);
    written.add(path.resolve(targetPath).toLowerCase());
    oldPaths.add(path.resolve(sourcePath).toLowerCase());
    renamed++;
  }

  for(const oldPath of oldPaths){
    if(!written.has(oldPath) && fs.existsSync(oldPath)){
      await fsp.unlink(oldPath).catch(() => {});
    }
  }

  const afterFiles = await fsp.readdir(resourceFolder, { withFileTypes: true });
  for(const item of afterFiles){
    if(!item.isFile()){
      continue;
    }

    const fullPath = path.join(resourceFolder, item.name);
    if(!written.has(path.resolve(fullPath).toLowerCase())){
      await fsp.unlink(fullPath).catch(() => {});
    }
  }

  return renamed;
}

async function copySneozDllTo(basePath){
  const candidates = [
    path.join(__dirname, 'tools', 'S4ResourceKeyDll', 'sneoz.dll'),
    path.join(__dirname, 'sneoz.dll'),
  ];
  const source = candidates.find(candidate => fs.existsSync(candidate));

  if(!source){
    return null;
  }

  const target = path.join(basePath, 'sneoz.dll');
  if(path.resolve(source).toLowerCase() !== path.resolve(target).toLowerCase()){
    await fsp.copyFile(source, target);
  }
  return target;
}

async function writePackKeyIni(basePath, keyHex, options = {}){
  const iniPath = path.join(basePath, 'sneoz_resource_key.ini');
  let text = '';
  if(fs.existsSync(iniPath)){
    text = await fsp.readFile(iniPath, 'utf8');
    text = text.replace(/\r?\n?\[packs\][\s\S]*?(?=\r?\n\[|$)/i, '').trimEnd();
    if(text){
      text += '\r\n';
    }
  }

  const baseName = normalizePackBaseName(options.baseName || 'resources');
  const extension = normalizePackExtension(options.extension || '.s4pack');
  text += ['[packs]', `key=${keyHex}`, `basename=${baseName}`, `extension=${extension}`, ''].join('\r\n');
  await fsp.writeFile(iniPath, text);
  return iniPath;
}

async function readIniValue(basePath, section, key, fallback = ''){
  const iniPath = path.join(basePath, 'sneoz_resource_key.ini');
  if(!fs.existsSync(iniPath)){
    return fallback;
  }
  const text = await fsp.readFile(iniPath, 'utf8');
  const sectionRegex = new RegExp(`\\[${escapeRegExp(section)}\\]([\\s\\S]*?)(?=\\r?\\n\\[|$)`, 'i');
  const sectionMatch = text.match(sectionRegex);
  const source = sectionMatch ? sectionMatch[1] : text;
  const keyRegex = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*?)\\s*$`, 'mi');
  const match = source.match(keyRegex);
  return match ? match[1].trim() : fallback;
}

async function readIniHex(basePath, section, key){
  const value = await readIniValue(basePath, section, key, '');
  return /^[0-9a-f]+$/i.test(value) ? value : '';
}

function detectPackSourceModes(basePath){
  const inputFolder = path.join(basePath, 'extracted_resources');
  const resourceFile = path.join(basePath, 'resource.s4hd');
  const resourceFolder = path.join(basePath, '_resources');
  return {
    hasExtracted: fs.existsSync(inputFolder),
    hasClassic: fs.existsSync(resourceFile) && fs.existsSync(resourceFolder),
  };
}

const PACK_MAP_FILE = 'pack_map.json';
const FOLDER_SOURCES = ['extracted_resources', '_resources'];

function detectFolderSources(basePath){
  return FOLDER_SOURCES.filter(s => fs.existsSync(path.join(basePath, s)));
}

function resolveFolderSourceRoot(basePath, sourceRoot){
  if(sourceRoot){
    const p = path.join(basePath, sourceRoot);
    if(!fs.existsSync(p)) throw new Error(`${sourceRoot} folder not found.`);
    return { name: sourceRoot, root: p };
  }
  for(const s of FOLDER_SOURCES){
    const p = path.join(basePath, s);
    if(fs.existsSync(p)) return { name: s, root: p };
  }
  throw new Error('extracted_resources / _resources folder not found.');
}

async function enumerateSourceEntries(basePath, sourceName, root){
  if(sourceName === '_resources'){
    const s4hd = path.join(basePath, 'resource.s4hd');
    if(!fs.existsSync(s4hd)) throw new Error('resource.s4hd not found (needed to map _resources folders).');
    const archive = resourceDecoder.parseContainer(s4hd);
    return (archive.entries || []).map(entry => ({
      name: String(entry.fullName).toLowerCase().replace(/\\/g, '/'),
      read: () => Promise.resolve(resourceDecoder.decodeResource(entry, root).data),
    }));
  }
  const out = [];
  for(const abs of await walkFiles(root)){
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const low = rel.toLowerCase();
    if(low === 'manifest.json') continue;
    if(low.endsWith('.txt') && fs.existsSync(abs.slice(0, -4))) continue; 
    out.push({ name: low, read: () => fsp.readFile(abs) });
  }
  return out;
}

async function listResourceFolders(basePath, sourceRoot){
  const { name, root } = resolveFolderSourceRoot(basePath, sourceRoot);
  const entries = await enumerateSourceEntries(basePath, name, root);
  const folderSet = new Set();
  let hasRootFiles = false;
  for(const e of entries){
    const i = e.name.indexOf('/');
    if(i < 0) hasRootFiles = true; else folderSet.add(e.name.slice(0, i));
  }
  return { folders: [...folderSet].sort(), hasRootFiles, sourceRoot: name, sources: detectFolderSources(basePath) };
}

async function loadPackMap(basePath){
  const p = path.join(basePath, PACK_MAP_FILE);
  if(!fs.existsSync(p)) return {};
  try { return JSON.parse(await fsp.readFile(p, 'utf8')) || {}; } catch { return {}; }
}

async function ensurePackMap(basePath, overrides = {}, sourceRoot){
  const { folders } = await listResourceFolders(basePath, sourceRoot);
  const existing = await loadPackMap(basePath);
  const map = {};
  const used = new Set();
  for(const f of folders){
    const forced = Number.isInteger(overrides[f]) ? overrides[f]
                 : (Number.isInteger(existing[f]) ? existing[f] : null);
    if(forced != null && forced >= 1){ map[f] = forced; used.add(forced); }
  }
  let next = 1;
  for(const f of folders){
    if(map[f] != null) continue;
    while(used.has(next)) next++;
    map[f] = next; used.add(next); next++;
  }
  await fsp.writeFile(path.join(basePath, PACK_MAP_FILE), JSON.stringify(map, null, 2));
  return map;
}

async function writeResourceIndexFiles(basePath, entries, packKey, bootstrapBytes, opts = {}){
  const packBaseName = normalizePackBaseName(opts.packBaseName || 'data');
  const packExtension = normalizePackExtension(opts.packExtension || '.bin');
  const packCount = entries.reduce((m, e) => Math.max(m, Number(e.pack) + 1), 1);

  const indexHeader = Buffer.alloc(16);
  indexHeader.writeUInt32LE(entries.length, 0);
  indexHeader.writeUInt32LE(packCount, 4);
  const indexParts = [indexHeader];
  for(const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))){
    const nameBuffer = Buffer.from(entry.name, 'ascii');
    if(nameBuffer.length > 65535) throw new Error(`resource name too long: ${entry.name}`);
    const row = Buffer.alloc(16 + nameBuffer.length);
    row.writeUInt16LE(nameBuffer.length, 0);
    row.writeUInt16LE(Number(entry.pack), 2);
    writeUInt64LE(row, entry.offset, 4);
    row.writeUInt32LE(Number(entry.size), 12);
    nameBuffer.copy(row, 16);
    indexParts.push(row);
  }
  const encryptedIndex = packCipherTransform(Buffer.concat(indexParts), packKey, 'idx');
  const encryptedBootstrap = packCipherTransform(bootstrapBytes, packKey, 'bootstrap');

  const publicEntries = entries.map(e => ({
    name: String(e.name).toLowerCase(),
    pack: Number(e.pack),
    offset: Number(e.offset),
    size: Number(e.size),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const resourceIndexJson = {
    buildId: String(opts.resourceBuildId || 'local-1'),
    version: 1,
    packBaseName,
    packExtension,
    entries: publicEntries,
    bootstrapBase64: bootstrapBytes.toString('base64'),
  };
  resourceIndexJson.indexHash = crypto.createHash('sha256').update(JSON.stringify({
    buildId: resourceIndexJson.buildId,
    version: resourceIndexJson.version,
    packBaseName,
    packExtension,
    entries: publicEntries,
    bootstrapBase64: resourceIndexJson.bootstrapBase64,
  })).digest('hex');

  const header = Buffer.alloc(24);
  Buffer.from('S4PKIDX3', 'ascii').copy(header, 0);
  header.writeUInt32LE(encryptedIndex.length, 8);
  header.writeUInt32LE(packCount, 12);
  header.writeUInt32LE(encryptedBootstrap.length, 16);
  header.writeUInt32LE(0, 20);
  await fsp.writeFile(path.join(basePath, 'resources.idx'), Buffer.concat([header, encryptedIndex, encryptedBootstrap]));
  await fsp.writeFile(path.join(basePath, 'resources_index.json'), JSON.stringify(resourceIndexJson));
  return { packCount, total: publicEntries.length };
}

async function readPackIndex(basePath, packKeyText = ''){
  
  const jsonPath = path.join(basePath, 'resources_index.json');
  if(fs.existsSync(jsonPath)){
    const json = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
    const entries = (json.entries || []).map(e => ({
      name: String(e.name),
      pack: Number(e.pack),
      offset: BigInt(e.offset),
      size: Number(e.size),
    }));
    const packCount = entries.reduce((m, e) => Math.max(m, e.pack + 1), 1);
    const bootstrapBytes = json.bootstrapBase64 ? Buffer.from(String(json.bootstrapBase64), 'base64') : null;
    return { indexPath: jsonPath, packCount, entries, bootstrapBytes };
  }

  const indexPath = path.join(basePath, 'resources.idx');
  if(!fs.existsSync(indexPath)){
    throw new Error('resources_index.json / resources.idx not found.');
  }

  let bytes = await fsp.readFile(indexPath);
  if(bytes.length < 16){
    throw new Error('resources.idx invalid.');
  }

  const magic = bytes.slice(0, 8).toString('ascii');
  let packCount = 0;
  let bodyOffset = 16;
  let encryptedLength = 0;
  let bootstrapBytes = null;

  if(magic === 'S4PKIDX3'){
    if(!String(packKeyText || '').trim()){
      throw new Error('Pack key required.');
    }
    if(bytes.length < 24){
      throw new Error('resources.idx invalid.');
    }
    encryptedLength = bytes.readUInt32LE(8);
    packCount = bytes.readUInt32LE(12);
    const encryptedBootstrapLength = bytes.readUInt32LE(16);
    bodyOffset = 24;
    if(encryptedBootstrapLength > 0){
      bootstrapBytes = packCipherTransform(
        bytes.slice(bodyOffset + encryptedLength, bodyOffset + encryptedLength + encryptedBootstrapLength),
        normalizePackKey(packKeyText),
        'bootstrap'
      );
    }
    bytes = packCipherTransform(bytes.slice(bodyOffset, bodyOffset + encryptedLength), normalizePackKey(packKeyText), 'idx');
  } else if(magic === 'S4PKIDX2'){
    if(!String(packKeyText || '').trim()){
      throw new Error('Pack key required.');
    }
    encryptedLength = bytes.readUInt32LE(8);
    packCount = bytes.readUInt32LE(12);
    bytes = packCipherTransform(bytes.slice(16, 16 + encryptedLength), normalizePackKey(packKeyText), 'idx');
  } else if(magic === 'S4PKIDX1'){
    packCount = bytes.readUInt32LE(12);
  } else {
    throw new Error('resources.idx invalid.');
  }

  const count = bytes.readUInt32LE(magic === 'S4PKIDX1' ? 8 : 0);
  if(magic !== 'S4PKIDX1'){
    packCount = bytes.readUInt32LE(4) || packCount;
  }
  const entries = [];
  let offset = 16;

  for(let i = 0; i < count; i++){
    if(offset + 16 > bytes.length){
      throw new Error('resources.idx truncated.');
    }

    const nameLength = bytes.readUInt16LE(offset);
    const pack = bytes.readUInt16LE(offset + 2);
    const fileOffset = bytes.readBigUInt64LE(offset + 4);
    const size = bytes.readUInt32LE(offset + 12);
    offset += 16;

    if(offset + nameLength > bytes.length){
      throw new Error('resources.idx name truncated.');
    }

    const name = bytes.slice(offset, offset + nameLength).toString('ascii');
    offset += nameLength;
    entries.push({ name, pack, offset: fileOffset, size });
  }

  return { indexPath, packCount, entries, bootstrapBytes };
}

ipcMain.handle('packResources', async (event, ruta) => {
  try {
    const basePath = getResourceBase(typeof ruta === 'object' && ruta ? ruta.ruta : ruta);
    const protectKey = typeof ruta === 'object' && ruta ? String(ruta.key || '').trim() : '';
    const resourceFile = path.join(basePath, 'resource.s4hd');
    const resourceFolder = path.join(basePath, '_resources');
    const inputFolder = path.join(basePath, 'extracted_resources');
    let archive = null;

    if(!fs.existsSync(inputFolder)){
      return { ok: false, error: 'extracted_resources folder not found.' };
    }

    if(fs.existsSync(resourceFile)){
      archive = getResourceArchive(ruta);
    } else {
      await fsp.mkdir(resourceFolder, { recursive: true });
      archive = {
        version: 1,
        count: 0,
        entries: [],
        resourceFile,
        resourceFolder,
      };
      resourceCache = { basePath, archive, dirty: false };
    }

    const manifest = await loadExtractManifest(inputFolder);
    const files = (await walkFiles(inputFolder)).filter(filePath => {
      const relative = path.relative(inputFolder, filePath).replace(/\\/g, '/').toLowerCase();
      const isGeneratedPreview = relative.endsWith('.txt') && fs.existsSync(filePath.slice(0, -4));
      return relative !== 'manifest.json' && !isGeneratedPreview;
    });

    let added = 0;
    let replaced = 0;
    let preserved = 0;
    let processed = 0;

    for(const filePath of files){
      const fullName = path.relative(inputFolder, filePath).replace(/\\/g, '/').toLowerCase();
      const fileData = await fsp.readFile(filePath);
      const entry = archive.entries.find(item => item.fullName === fullName);

      if(entry){
        try {
          const decoded = resourceDecoder.decodeResource(entry, archive.resourceFolder).data;
          if(Buffer.compare(decoded, fileData) === 0){
            preserved++;
          } else {
            writeResourceData(archive, fullName, fileData);
            replaced++;
          }
        } catch(e) {
          writeResourceData(archive, fullName, fileData);
          replaced++;
        }
      } else {
        const manifestEntry = manifest.get(fullName);
        let usedManifestResource = false;

        if(manifestEntry && manifestEntry.checksumHex && fs.existsSync(path.join(resourceFolder, manifestEntry.checksumHex))){
          const newEntry = {
            fullName,
            checksum: checksumHexToBigInt(manifestEntry.checksumHex),
            length: Number(manifestEntry.length || 0),
            unk: Number(manifestEntry.unk || 0),
            entrySize: 272,
          };

          try {
            const decoded = resourceDecoder.decodeResource(newEntry, resourceFolder).data;
            if(Buffer.compare(decoded, fileData) === 0){
              archive.entries.push(newEntry);
              usedManifestResource = true;
              preserved++;
            }
          } catch(e) {
            usedManifestResource = false;
          }
        }

        if(!usedManifestResource){
          createResourceData(archive, fullName, fileData);
          added++;
        }
      }

      processed++;
      if(processed % 100 === 0 || processed === files.length){
        event.sender.send('packResourcesProgress', {
          packed: processed,
          total: files.length,
          remaining: Math.max(files.length - processed, 0)
        });
      }
    }

    let randomized = 0;
    let keyFile = null;
    let dllFile = null;

    if(protectKey){
      event.sender.send('packResourcesProgress', {
        packed: files.length,
        total: files.length,
        remaining: 0,
        status: 'Locking resource.s4hd...'
      });
      const lockInfo = resourceDecoder.saveContainer(archive, archive.resourceFile, { lockKey: protectKey });
      if(lockInfo){
        keyFile = path.join(path.dirname(archive.resourceFile), 'sneoz_resource_key.ini');
        await fsp.writeFile(
          keyFile,
          [
            '; key/iv real para sneoz.dll',
            '; resource.s4hd en disco tiene decoy key/iv',
            '[resource]',
            `key=${lockInfo.key}`,
            `iv=${lockInfo.iv}`,
            `decoyKey=${lockInfo.decoyKey}`,
            `decoyIv=${lockInfo.decoyIv}`,
            ''
          ].join('\r\n')
        );
      }
      dllFile = await copySneozDllTo(basePath);
    } else {
      resourceDecoder.saveContainer(archive, archive.resourceFile);
    }

    resourceCache.dirty = false;

    return { ok: true, input: inputFolder, total: files.length, added, replaced, preserved, protected: !!protectKey, randomized, keyFile, dllFile };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('listResourceFolders', async (_event, data) => {
  try {
    const basePath = getResourceBase(typeof data === 'object' && data ? data.ruta : data);
    const sourceRoot = data && data.sourceRoot ? data.sourceRoot : undefined;
    const { folders, hasRootFiles, sourceRoot: resolved, sources } = await listResourceFolders(basePath, sourceRoot);
    const map = await ensurePackMap(basePath, {}, resolved);   
    return { ok: true, folders, hasRootFiles, sourceRoot: resolved, sources, map };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

function getResourceBase(ruta){
  return ruta ? ruta : __dirname;
}

function readIniValueSync(basePath, section, key, fallback = ''){
  const iniPath = path.join(basePath, 'sneoz_resource_key.ini');
  if(!fs.existsSync(iniPath)) return fallback;
  const text = fs.readFileSync(iniPath, 'utf8');
  const sectionMatch = text.match(new RegExp(`\\[${escapeRegExp(section)}\\]([\\s\\S]*?)(?=\\r?\\n\\[|$)`, 'i'));
  const source = sectionMatch ? sectionMatch[1] : text;
  const match = source.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*?)\\s*$`, 'mi'));
  return match ? match[1].trim() : fallback;
}

function walkLooseEntries(root){
  const out = [];
  const stack = [root];
  while(stack.length){
    const dir = stack.pop();
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { continue; }
    for(const it of items){
      const abs = path.join(dir, it.name);
      if(it.isDirectory()){ stack.push(abs); continue; }
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      const low = rel.toLowerCase();
      if(low === 'manifest.json') continue;
      if(low.endsWith('.txt') && fs.existsSync(abs.slice(0, -4))) continue;
      let length = 0;
      try { length = fs.statSync(abs).size; } catch(e) {}
      out.push({ fullName: low, length });
    }
  }
  out.sort((a, z) => a.fullName < z.fullName ? -1 : (a.fullName > z.fullName ? 1 : 0));
  return out;
}

function getResourceArchive(ruta, options = {}){
  const basePath = getResourceBase(ruta);

  if(resourceCache.basePath === basePath && resourceCache.archive
     && !options.source && !options.lockKey && !options.key){
    return resourceCache.archive;
  }

  const resourceFile = path.join(basePath, 'resource.s4hd');
  const jsonPath = path.join(basePath, 'resources_index.json');
  const wantPacks = options.source === 'packs' || (!options.source && !fs.existsSync(resourceFile) && fs.existsSync(jsonPath));
  if(wantPacks){
    if(!fs.existsSync(jsonPath)) throw new Error('resources_index.json not found.');
    
    if(resourceCache.basePath === basePath && resourceCache.archive && resourceCache.archive.packMode
       && (!options.key || ('packs:' + options.key) === (resourceCache.key || ''))){
      return resourceCache.archive;
    }
    const keyText = options.key || readIniValueSync(basePath, 'packs', 'key');
    if(!keyText) throw new Error('Pack key required to browse data#.bin (build packs or set the key first).');
    const cacheKey = 'packs:' + String(keyText);
    if(resourceCache.basePath === basePath && resourceCache.archive && (resourceCache.key || '') === cacheKey){
      return resourceCache.archive;
    }
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const entries = (json.entries || []).map(e => ({
      fullName: String(e.name), pack: Number(e.pack), offset: Number(e.offset), size: Number(e.size),
    }));
    const archive = {
      entries, count: entries.length, firstName: entries[0] ? entries[0].fullName : '',
      basePath, packMode: true, packKey: normalizePackKey(keyText),
      packBaseName: normalizePackBaseName(json.packBaseName || readIniValueSync(basePath, 'packs', 'basename', 'data')),
      packExtension: normalizePackExtension(json.packExtension || readIniValueSync(basePath, 'packs', 'extension', '.bin')),
    };
    resourceCache = { basePath, archive, dirty: false, key: cacheKey };
    return archive;
  }

  const extractedFolder = path.join(basePath, 'extracted_resources');
  const wantLoose = options.source === 'loose'
    || (!fs.existsSync(resourceFile) && !fs.existsSync(jsonPath) && fs.existsSync(extractedFolder));
  if(wantLoose){
    const looseRoot = fs.existsSync(extractedFolder) ? extractedFolder : basePath;
    if(!fs.existsSync(looseRoot)) throw new Error('extracted_resources folder not found.');
    const looseCacheKey = 'loose:' + looseRoot;
    if(resourceCache.basePath === basePath && resourceCache.archive && (resourceCache.key || '') === looseCacheKey){
      return resourceCache.archive;
    }
    const entries = walkLooseEntries(looseRoot);
    const archive = {
      entries, count: entries.length, firstName: entries[0] ? entries[0].fullName : '',
      basePath, looseMode: true, looseRoot,
    };
    resourceCache = { basePath, archive, dirty: false, key: looseCacheKey };
    return archive;
  }

  const cacheKey = options.lockKey ? String(options.lockKey) : '';

  if(resourceCache.basePath === basePath && resourceCache.archive && (resourceCache.key || '') === cacheKey){
    return resourceCache.archive;
  }

  const resourceFolder = path.join(basePath, '_resources');

  if(!fs.existsSync(resourceFile)){
    throw new Error('resource.s4hd not found.');
  }

  if(!fs.existsSync(resourceFolder)){
    throw new Error('_resources folder not found.');
  }

  const archive = options.lockKey
    ? resourceDecoder.parseContainerWithLockKey(resourceFile, options.lockKey)
    : resourceDecoder.parseContainer(resourceFile);
  archive.basePath = basePath;
  archive.resourceFile = resourceFile;
  archive.resourceFolder = resourceFolder;
  resourceCache = { basePath, archive, dirty: false, key: cacheKey };
  return archive;
}

function getFolders(entries){
  const folders = new Set(['']);

  for(const entry of entries){
    const parts = entry.fullName.split('/');
    parts.pop();

    let current = '';
    for(const part of parts){
      current = current ? current + '/' + part : part;
      folders.add(current);
    }
  }

  return [...folders].sort();
}

function getFolderRows(entries, currentPath, search){
  const cleanPath = currentPath || '';
  const cleanSearch = (search || '').trim().toLowerCase();
  const folders = new Set();
  const files = [];

  for(const entry of entries){
    if(cleanSearch){
      if(entry.fullName.includes(cleanSearch)){
        files.push(entry);
      }
      continue;
    }

    const prefix = cleanPath ? cleanPath + '/' : '';
    if(!entry.fullName.startsWith(prefix)){
      continue;
    }

    const rest = entry.fullName.slice(prefix.length);
    const slashIndex = rest.indexOf('/');

    if(slashIndex !== -1){
      folders.add(prefix + rest.slice(0, slashIndex));
      continue;
    }

    files.push(entry);
  }

  return {
    folders: [...folders].sort().map(folder => ({
      type: 'folder',
      name: folder.split('/').pop(),
      fullName: folder
    })),
    files: files.sort((a, b) => a.fullName.localeCompare(b.fullName)).map(entry => ({
      type: 'file',
      name: entry.fullName.split('/').pop(),
      fullName: entry.fullName,
      length: entry.length,
      resourceFile: entry.checksum != null ? resourceDecoder.checksumCandidates(entry.checksum)[0] : null
    }))
  };
}

function getExternalResourcePath(basePath, fullName){
  const cleanName = fullName.replace(/\\/g, '/');
  const target = path.resolve(basePath, cleanName);
  const base = path.resolve(basePath);

  if(target !== base && !target.startsWith(base + path.sep)){
    return null;
  }

  return target;
}

const listadoBlobs = new Map();

function blobsConPrefijo(carpeta, prefijo, largo){
  let listado = listadoBlobs.get(carpeta);
  if(!listado){
    listado = fs.readdirSync(carpeta);
    listadoBlobs.set(carpeta, listado);
  }
  return listado.filter(f => f.length === largo && f.toLowerCase().startsWith(prefijo));
}

function writeResourceData(archive, fullName, buffer){
  if(archive.looseMode){
    const abs = path.join(archive.looseRoot, fullName);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    if(!archive.entries.some(e => e.fullName === fullName)){
      archive.entries.push({ fullName });
      archive.entries.sort((a, z) => a.fullName < z.fullName ? -1 : (a.fullName > z.fullName ? 1 : 0));
    }
    return;
  }
  const escrito = resourceDecoder.setResourceData(archive, archive.resourceFolder, fullName, buffer);

  if(escrito && escrito.newResource){
    const nombreNuevo = path.basename(escrito.newResource);
    const prefijo = nombreNuevo.slice(0, -8).toLowerCase();
    const contenido = fs.readFileSync(escrito.newResource);

    for(const viejo of blobsConPrefijo(archive.resourceFolder, prefijo, nombreNuevo.length)){
      if(viejo === nombreNuevo) continue;
      try {
        fs.writeFileSync(path.join(archive.resourceFolder, viejo), contenido);
      } catch(e){}
    }

    const listado = listadoBlobs.get(archive.resourceFolder);
    if(listado && !listado.includes(nombreNuevo)) listado.push(nombreNuevo);
  }

  return escrito;
}

function createResourceData(archive, fullName, buffer){
  if(archive.looseMode) return writeResourceData(archive, fullName, buffer);
  resourceDecoder.createResource(archive, archive.resourceFolder, fullName, buffer);
}

function removeResourceData(archive, fullName){
  if(archive.looseMode){
    const abs = path.join(archive.looseRoot, fullName);
    if(fs.existsSync(abs)) fs.unlinkSync(abs);
    const i = archive.entries.findIndex(e => e.fullName === fullName);
    if(i >= 0) archive.entries.splice(i, 1);
    return;
  }
  resourceDecoder.removeResource(archive, archive.resourceFolder, fullName, false);
}

function getDecodedResourceData(archive, entry){
  if(archive.looseMode){
    const abs = path.join(archive.looseRoot, entry.fullName);
    if(!fs.existsSync(abs)) throw new Error(`missing loose file: ${entry.fullName}`);
    return { data: fs.readFileSync(abs), source: 'loose', sourcePath: abs };
  }
  if(archive.packMode){
    
    const packName = getPackFileName(entry.pack, archive.packBaseName, archive.packExtension);
    let packPath = path.join(archive.basePath, 'resources', packName);
    if(!fs.existsSync(packPath)) packPath = path.join(archive.basePath, packName);
    if(!fs.existsSync(packPath)) throw new Error(`missing pack: ${packName}`);
    const fd = fs.openSync(packPath, 'r');
    try {
      const buf = Buffer.alloc(entry.size);
      fs.readSync(fd, buf, 0, entry.size, Number(entry.offset));
      const data = packCipherTransform(buf, archive.packKey, `res:${entry.fullName.toLowerCase()}`);
      return { data, source: 'pack', sourcePath: packPath };
    } finally { fs.closeSync(fd); }
  }

  const decoded = resourceDecoder.decodeResource(entry, archive.resourceFolder);

  if(isXemResource(entry.fullName) && !isPeBuffer(decoded.data)){
    const externalPath = getExternalResourcePath(archive.basePath, entry.fullName);

    if(externalPath && fs.existsSync(externalPath)){
      try {
        const externalData = fs.readFileSync(externalPath);

        if(isPeBuffer(externalData)){
          return {
            ...decoded,
            data: externalData,
            source: 'external',
            sourcePath: externalPath
          };
        }
      } catch(e) {}
    }
  }

  return {
    ...decoded,
    source: 'resource',
    sourcePath: null
  };
}

ipcMain.handle('resourceBrowserLoad', async (event, ruta) => {
  try {
    const data = typeof ruta === 'object' && ruta ? ruta : { ruta };
    openedResourceTemps.clear();
    resourceCache = { basePath: null, archive: null, dirty: false };
    const archive = getResourceArchive(data.ruta, { lockKey: data.key, key: data.key, source: data.source });
    const folders = getFolders(archive.entries);
    const rows = getFolderRows(archive.entries, '', '');

    return {
      ok: true,
      count: archive.count,
      firstName: archive.firstName,
      basePath: archive.basePath,
      packMode: !!archive.packMode,
      folders,
      rows
    };
  } catch(e){
    if(String(e.message || '').includes('Pack key required')){
      return { ok: false, needsKey: true, error: e.message };
    }
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceBrowserSources', async (_event, ruta) => {
  try {
    const basePath = getResourceBase(typeof ruta === 'object' && ruta ? ruta.ruta : ruta);
    const extractedFolder = path.join(basePath, 'extracted_resources');
    return {
      ok: true,
      hasContainer: fs.existsSync(path.join(basePath, 'resource.s4hd')),
      hasPacks: fs.existsSync(path.join(basePath, 'resources_index.json')),
      hasLoose: fs.existsSync(extractedFolder) || fs.existsSync(path.join(basePath, 'resources')),
    };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceBrowserList', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const rows = getFolderRows(archive.entries, data.currentPath, data.search);
    return { ok: true, rows };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceBrowserRead', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'File not found in resource.s4hd.' };
    }

    const decoded = getDecodedResourceData(archive, entry);
    const ext = path.extname(entry.fullName).toLowerCase();
    const textPreview = getDecodedTextPreview(entry.fullName, decoded.data);
    const scnTextures = isScnResource(entry.fullName)
      ? analyzeScnTextures(entry.fullName, decoded.data, archive)
      : null;
    const scnInfo = isScnResource(entry.fullName)
      ? scnInfoOf(decoded.data)
      : null;
    const seqStrings = isSeqResource(entry.fullName)
      ? analyzeSeqStrings(decoded.data)
      : null;

    if(textPreview !== null){
      return {
        ok: true,
        kind: 'text',
        fullName: entry.fullName,
        ext,
        size: decoded.data.length,
        text: textPreview,
        editable: isTextResource(entry.fullName),
        scnTextures,
        scnInfo,
        seqStrings,
        source: decoded.source,
        sourcePath: decoded.sourcePath
      };
    }

    if(isImageResource(entry.fullName)){
      let src;

      if(ext === '.dds'){
        src = ddsToPngDataUrl(decoded.data);
      } else if(ext === '.tga'){
        src = tgaToPngDataUrl(decoded.data);
      } else {
        const type = ext === '.jpg' ? 'jpeg' : ext.replace('.', '');
        src = `data:image/${type};base64,${decoded.data.toString('base64')}`;
      }

      return {
        ok: true,
        kind: 'image',
        fullName: entry.fullName,
        ext,
        size: decoded.data.length,
        src,
        source: decoded.source,
        sourcePath: decoded.sourcePath
      };
    }

    return {
      ok: true,
      kind: 'binary',
      fullName: entry.fullName,
      ext,
      size: decoded.data.length,
      editable: !isImageResource(entry.fullName),
      source: decoded.source,
      sourcePath: decoded.sourcePath,
      hex: decoded.data.slice(0, 512).toString('hex').match(/.{1,32}/g)?.join('\n') || ''
    };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceBrowserOpenTemp', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'File not found in resource.s4hd.' };
    }

    const decoded = getDecodedResourceData(archive, entry);
    const tempDir = path.join(app.getPath('temp'), 'ItemManagerResourceTool');
    const textPreview = getDecodedTextPreview(entry.fullName, decoded.data);
    const isText = isTextResource(entry.fullName);
    const previewOnly = textPreview !== null && !isText;   
    const outputName = entry.fullName.replace(/[\\/]/g, '_') + (previewOnly ? '.txt' : '');
    const output = path.join(tempDir, outputName);

    await fsp.mkdir(tempDir, { recursive: true });
    
    await fsp.writeFile(output, previewOnly ? Buffer.from(textPreview, 'utf8') : decoded.data);

    const reimportable = !previewOnly && !archive.packMode;
    if(reimportable){
      try {
        const st = fs.statSync(output);
        openedResourceTemps.set(entry.fullName, { tempPath: output, mtimeMs: st.mtimeMs });
      } catch(e) {}
    }

    await shell.openPath(output);

    return { ok: true, output, editable: reimportable };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceExtractSingle', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'File not found in resource.s4hd.' };
    }

    const outputRoot = data.outputRoot || app.getPath('downloads');
    const output = safeOutputPath(outputRoot, entry.fullName);
    const decoded = getDecodedResourceData(archive, entry);

    await fsp.mkdir(path.dirname(output), { recursive: true });
    await fsp.writeFile(output, decoded.data);

    return { ok: true, output };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceExtractMany', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const outputRoot = data.outputRoot || app.getPath('downloads');
    const wanted = new Set((data.fullNames || []).map(item => String(item).toLowerCase().replace(/\\/g, '/')));
    const folders = (data.folders || []).map(item => String(item).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, ''));
    const entries = archive.entries.filter(entry => {
      if(wanted.has(entry.fullName)){
        return true;
      }

      return folders.some(folder => entry.fullName === folder || entry.fullName.startsWith(folder + '/'));
    });

    if(entries.length === 0){
      return { ok: false, error: 'No resources selected to extract.' };
    }

    for(const entry of entries){
      const output = safeOutputPath(outputRoot, entry.fullName);
      const decoded = getDecodedResourceData(archive, entry);

      await fsp.mkdir(path.dirname(output), { recursive: true });
      await fsp.writeFile(output, decoded.data);
    }

    return { ok: true, count: entries.length, outputRoot };
  } catch(e){
    if(String(e.message || '').includes('Header invalido') && !(typeof ruta === 'object' && ruta && ruta.key)){
      return { ok: false, needsKey: true, error: 'resource.s4hd is locked. Enter key.' };
    }
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceReplaceFile', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const fileData = await fsp.readFile(data.filePath);

    writeResourceData(archive, data.fullName, fileData);
    resourceCache.dirty = true;

    return { ok: true };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceSaveText', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'File not found in resource.s4hd.' };
    }

    if(isImageResource(entry.fullName)){
      return { ok: false, error: 'Selected resource is an image.' };
    }

    const original = getDecodedResourceData(archive, entry);
    const enc = detectTextEncoding(original.data);
    writeResourceData(archive, entry.fullName, Buffer.from(data.text || '', enc));
    resourceCache.dirty = true;

    return { ok: true };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceScnReplaceTexture', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'File not found in resource.s4hd.' };
    }

    if(!isScnResource(entry.fullName)){
      return { ok: false, error: 'Selected resource is not a .scn file.' };
    }

    const decoded = getDecodedResourceData(archive, entry);
    const patched = patchScnTextureName(decoded.data, data.oldTexture, data.newTexture);

    writeResourceData(archive, entry.fullName, patched.buffer);
    resourceCache.dirty = true;

    return { ok: true, changed: patched.changed };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

function resolveScnMeshTextures(archive, scnFullName, meshes){
  const folder = path.posix.dirname(scnFullName.replace(/\\/g, '/'));
  const byBase = new Map();
  for(const e of archive.entries){
    if(path.posix.dirname(e.fullName.replace(/\\/g, '/')) !== folder) continue;
    if(!isImageResource(e.fullName)) continue;
    const bn = path.posix.basename(e.fullName);
    const base = bn.slice(0, bn.length - path.posix.extname(bn).length).toLowerCase();
    if(!byBase.has(base)) byBase.set(base, e);
  }
  const urlCache = new Map();
  for(const m of meshes){
    m.textureDataUrl = null;
    if(!m.texture) continue;
    const bn = path.posix.basename(m.texture.replace(/\\/g, '/'));
    const base = bn.slice(0, bn.length - path.posix.extname(bn).length).toLowerCase();
    const entry = byBase.get(base);
    if(!entry) continue;
    if(urlCache.has(entry.fullName)){ m.textureDataUrl = urlCache.get(entry.fullName); continue; }
    let url = null;
    try {
      const dec = getDecodedResourceData(archive, entry);
      const ext = path.extname(entry.fullName).toLowerCase();
      if(ext === '.dds') url = ddsToPngDataUrl(dec.data);
      else if(ext === '.tga') url = tgaToPngDataUrl(dec.data);
      else url = `data:image/${ext === '.jpg' ? 'jpeg' : ext.replace('.', '')};base64,${dec.data.toString('base64')}`;
    } catch(e){ url = null; }
    urlCache.set(entry.fullName, url);
    m.textureDataUrl = url;
  }
}

async function writeCharacterTempFolder(archive, charFolder, gender){
  const rels = [
    gender + '_bip.scn',
    'body/00_' + gender + '_body.scn', 'leg/00_' + gender + '_leg.scn',
    'hand/00_' + gender + '_hand.scn', 'foot/00_' + gender + '_foot.scn',
    'face/00_' + gender + '_face.scn', 'hair/00_' + gender + '_hair.scn',
  ];
  const tempRoot = path.join(app.getPath('temp'), 'ItemManagerScnView', `char_${Date.now()}`);
  const charOut = path.join(tempRoot, 'resources', 'model', 'character');
  const findEntry = (full) => archive.entries.find(e => e.fullName === full.toLowerCase());
  const writeImageFor = async (scnRelDir, texName) => {
    if(!texName) return;
    const bn = path.posix.basename(String(texName).replace(/\\/g, '/'));
    const base = bn.slice(0, bn.length - path.posix.extname(bn).length).toLowerCase();
    
    for(const e of archive.entries){
      if(!isImageResource(e.fullName)) continue;
      const dir = path.posix.dirname(e.fullName);
      if(dir !== (charFolder + '/' + scnRelDir).replace(/\/+$/,'').replace(/\/\.$/,'')) continue;
      const ebn = path.posix.basename(e.fullName);
      const ebase = ebn.slice(0, ebn.length - path.posix.extname(ebn).length).toLowerCase();
      if(ebn.toLowerCase() !== bn.toLowerCase() && ebase !== base) continue;
      const out = path.join(charOut, scnRelDir, ebn);
      if(fs.existsSync(out)) return;
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, getDecodedResourceData(archive, e).data);
      return;
    }
  };

  let wrote = 0;
  for(const rel of rels){
    const entry = findEntry(charFolder + '/' + rel);
    if(!entry) continue;
    const outScn = path.join(charOut, rel);
    await fsp.mkdir(path.dirname(outScn), { recursive: true });
    const dec = getDecodedResourceData(archive, entry);
    await fsp.writeFile(outScn, dec.data);
    wrote++;
    const relDir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    try {
      const sc = parseScn(dec.data);
      const seen = new Set();
      for(const m of sc.models){ if(m.texture && !seen.has(m.texture)){ seen.add(m.texture); await writeImageFor(relDir, m.texture); } }
    } catch(e) {}
  }
  return { charOut, tempRoot, wrote };
}

ipcMain.handle('scnPreview3D', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const entry = archive.entries.find(item => item.fullName === data.fullName);
    if(!entry) return { ok: false, error: 'File not found.' };
    if(!isScnResource(entry.fullName)) return { ok: false, error: 'Selected resource is not a .scn file.' };

    const base = path.posix.basename(entry.fullName);
    const bipMatch = base.match(/^(male|female)_bip\.scn$/i);

    if(bipMatch){
      const gender = bipMatch[1].toLowerCase();
      const charFolder = path.posix.dirname(entry.fullName);
      const { charOut, tempRoot, wrote } = await writeCharacterTempFolder(archive, charFolder, gender);
      if(wrote >= 1){
        const win = new BrowserWindow({
          width: 1000, height: 760, title: '3D Preview - ' + gender + ' character',
          backgroundColor: '#15181d',
          webPreferences: { nodeIntegration: true, contextIsolation: false, additionalArguments: ['--char=' + charOut + '|' + gender] }
        });
        win.setMenuBarVisibility(false);
        win.on('closed', () => { fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {}); });
        await win.loadFile(path.join(__dirname, 'viewer', 'scn_viewer.html'));
        return { ok: true, mode: 'character', meshes: wrote };
      }
      
    }

    const decoded = getDecodedResourceData(archive, entry);
    const parsed = parseScn(decoded.data);
    if(!parsed.meshes.length) return { ok: false, error: 'No mesh geometry found in this .scn.' };
    return previewSceneEngine(data, entry, 'scn');
  } catch(e){
    return { ok: false, error: e.message };
  }
});

const { startSeqServer } = require('./seqviewer/seqserver');

async function previewSceneEngine(data, entry, deepKey){
  let srv = null, tempRoot = null;
  try {
    const archive = getResourceArchive(data.ruta);
    const byBase = new Map(), byStem = new Map();
    for(const e of archive.entries){
      const b = e.fullName.split('/').pop();
      if(!byBase.has(b)) byBase.set(b, e);
      const stem = b.replace(/\.[^.]+$/, '');
      if(!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push(e);
    }
    const PREF = ['dds', 'png', 'tga', 'jpg', 'jpeg', 'bmp', 'scn'];
    const resolveEntry = (ref) => {
      const b = ref.replace(/\\/g, '/').split('/').pop().toLowerCase();
      if(byBase.has(b)) return byBase.get(b);
      const alts = byStem.get(b.replace(/\.[^.]+$/, ''));
      if(!alts || !alts.length) return null;
      return [...alts].sort((a, z) =>
        PREF.indexOf(a.fullName.split('.').pop().toLowerCase()) - PREF.indexOf(z.fullName.split('.').pop().toLowerCase()))[0];
    };

    const toExtract = new Map();
    const addEntry = e => { if(e) toExtract.set(e.fullName.split('/').pop(), e); };
    addEntry(entry);
    const scanned = new Set([entry.fullName]);
    const queue = [entry];
    while(queue.length){
      const buf = getDecodedResourceData(archive, queue.shift()).data;
      for(const ref of scanSeqAssetNames(buf)){
        const hit = resolveEntry(ref);
        if(!hit) continue;
        addEntry(hit);
        if(/\.scn$/i.test(hit.fullName) && !scanned.has(hit.fullName)){ scanned.add(hit.fullName); queue.push(hit); }
      }
    }

    tempRoot = path.join(app.getPath('temp'), 'ItemManagerSeqView', String(Date.now()));
    const outDir = path.join(tempRoot, 'resources', 'effects');
    await fsp.mkdir(outDir, { recursive: true });
    for(const [name, e] of toExtract){
      let buf = getDecodedResourceData(archive, e).data;
      
      if(/\.tga$/i.test(name)){
        try {
          const url = tgaToPngDataUrl(buf);
          if(url && url.startsWith('data:image/png;base64,')) buf = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
        } catch(err) {  }
      }
      await fsp.writeFile(path.join(outDir, name), buf);
    }

    const fallbackRoot = path.join(getResourceBase(data.ruta), 'extracted_resources');
    srv = await startSeqServer(tempRoot, { fallbackRoot: fs.existsSync(fallbackRoot) ? fallbackRoot : null });

    const name = entry.fullName.split('/').pop();
    const win = new BrowserWindow({
      width: 1150, height: 800,
      title: (deepKey === 'scn' ? 'SCN' : 'Seq') + ' Preview - ' + name,
      backgroundColor: '#15181d'
    });
    win.setMenuBarVisibility(false);
    win.on('closed', () => {
      try { srv && srv.close(); } catch(e) {}
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    });
    
    const shared = deepKey === 'scn' && /^resources\/model\//i.test(entry.fullName) ? '&shared=1' : '';
    await win.loadURL(`http://127.0.0.1:${srv.port}/?${deepKey}=${encodeURIComponent(name)}${shared}`);

    return { ok: true, deps: toExtract.size };
  } catch(e){
    try { srv && srv.close(); } catch(err) {}
    if(tempRoot) fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('seqPreview3D', async (event, data) => {
  const archive = getResourceArchive(data.ruta);
  const entry = archive.entries.find(e => e.fullName === String(data.fullName).toLowerCase());
  if(!entry) return { ok: false, error: 'File not found.' };
  if(!/\.seq$/i.test(entry.fullName)) return { ok: false, error: 'Selected resource is not a .seq file.' };
  return previewSceneEngine(data, entry, 'seq');
});

ipcMain.handle('resourceSeqReplaceString', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    if(archive.packMode){
      return { ok: false, error: 'Editing packs is not supported. Edit resource.s4hd (container) and rebuild packs.' };
    }
    const entry = archive.entries.find(item => item.fullName === data.fullName);
    if(!entry){
      return { ok: false, error: 'File not found in resource.s4hd.' };
    }
    if(!isSeqResource(entry.fullName)){
      return { ok: false, error: 'Selected resource is not a .seq file.' };
    }

    const decoded = getDecodedResourceData(archive, entry);
    const patched = patchSeqString(decoded.data, data.oldString, data.newString);

    writeResourceData(archive, entry.fullName, patched.buffer);
    resourceCache.dirty = true;

    return { ok: true, changed: patched.changed };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceAddFile', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const fileData = await fsp.readFile(data.filePath);
    const fileName = path.basename(data.filePath);
    const currentPath = data.currentPath ? data.currentPath.replace(/\\/g, '/') : '';
    const fullName = (currentPath ? currentPath + '/' : '') + fileName;

    createResourceData(archive, fullName, fileData);
    resourceCache.dirty = true;

    return { ok: true, fullName: fullName.toLowerCase() };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceAddDroppedFiles', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);
    const currentPath = data.currentPath ? data.currentPath.replace(/\\/g, '/') : '';
    const added = [];
    const replaced = [];
    const skipped = [];
    const mode = data.mode === 'replace' ? 'replace' : 'add';
    const droppedFiles = [];

    for(const filePath of data.filePaths){
      const stat = await fsp.stat(filePath);

      if(stat.isDirectory()){
        const rootName = path.basename(filePath);
        const stack = [filePath];

        while(stack.length){
          const folder = stack.pop();
          for(const child of await fsp.readdir(folder, { withFileTypes: true })){
            const childPath = path.join(folder, child.name);
            if(child.isDirectory()){
              stack.push(childPath);
            } else if(child.isFile()){
              droppedFiles.push({
                filePath: childPath,
                relativeName: path.join(rootName, path.relative(filePath, childPath)).replace(/\\/g, '/')
              });
            }
          }
        }
      } else if(stat.isFile()){
        droppedFiles.push({
          filePath,
          relativeName: path.basename(filePath)
        });
      }
    }

    for(const dropped of droppedFiles){
      const fileData = await fsp.readFile(dropped.filePath);
      const fullName = ((currentPath ? currentPath + '/' : '') + dropped.relativeName).toLowerCase().replace(/\\/g, '/');
      const exists = archive.entries.some(entry => entry.fullName === fullName);

      if(mode === 'replace'){
        if(!exists){
          skipped.push(fullName);
          continue;
        }

        writeResourceData(archive, fullName, fileData);
        replaced.push(fullName);
      } else {
        if(exists){
          skipped.push(fullName);
          continue;
        }

        createResourceData(archive, fullName, fileData);
        added.push(fullName);
      }
    }

    if(added.length > 0 || replaced.length > 0){
      resourceCache.dirty = true;
    }

    return { ok: true, added, replaced, skipped };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceDeleteFile', async (event, data) => {
  try {
    const archive = getResourceArchive(data.ruta);

    removeResourceData(archive, data.fullName);
    resourceCache.dirty = true;

    return { ok: true };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

const editorXui = require('./src/uieditor/xui');

ipcMain.handle('xuiList', async (event, data = {}) => {
  try {
    const archive = getResourceArchive(data.ruta, data.source ? { source: data.source } : {});
    const archivos = archive.entries
      .filter(entry => /\.xui$/i.test(entry.fullName))
      .map(entry => entry.fullName)
      .sort();

    return { ok: true, archivos };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('xuiOpen', async (event, data = {}) => {
  try {
    const archive = getResourceArchive(data.ruta, data.source ? { source: data.source } : {});
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'xui not found.' };
    }

    const texto = getDecodedResourceData(archive, entry).data.toString('utf8');
    const controles = editorXui.parsearXui(texto);

    const indiceImagenes = buildDbPreviewImageIndex(data.ruta || false, data.source);
    const texturas = {};
    const pendientes = new Set();

    (function juntarTexturas(lista){
      for(const control of lista){
        if(control.textura) pendientes.add(control.textura);
        juntarTexturas(control.hijos);
      }
    })(controles);

    for(const nombre of pendientes){
      try {
        const src = getDbPreviewImageSrc(nombre, indiceImagenes);
        if(src) texturas[nombre] = src;
      } catch(e) {}
    }

    return { ok: true, fullName: entry.fullName, controles, texturas };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

let indiceNombresXui = null;

function construirIndiceNombresXui(archive){
  const indice = new Map();

  for(const entry of archive.entries){
    if(!/\.xui$/i.test(entry.fullName)) continue;

    let controles;
    try {
      const texto = getDecodedResourceData(archive, entry).data.toString('utf8');
      controles = editorXui.parsearXui(texto);
    } catch(e){ continue; }

    (function recorrer(lista){
      for(const control of lista){
        const nombre = (control.nombre || '').toLowerCase();
        if(nombre){
          if(!indice.has(nombre)) indice.set(nombre, new Set());
          indice.get(nombre).add(entry.fullName);
        }
        recorrer(control.hijos);
      }
    })(controles);
  }

  return indice;
}

ipcMain.handle('xuiArchivosDeNombres', async (event, data = {}) => {
  try {
    const archive = getResourceArchive(data.ruta, data.source ? { source: data.source } : {});

    if(!indiceNombresXui || indiceNombresXui.clave !== archive.resourceFile){
      indiceNombresXui = construirIndiceNombresXui(archive);
      indiceNombresXui.clave = archive.resourceFile;
    }

    const puntaje = new Map();
    for(const nombre of (data.nombres || [])){
      const archivos = indiceNombresXui.get(String(nombre).toLowerCase());
      if(!archivos) continue;
      for(const archivo of archivos){
        puntaje.set(archivo, (puntaje.get(archivo) || 0) + 1);
      }
    }

    const ordenados = [...puntaje.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([archivo, coincidencias]) => ({ archivo, coincidencias }));

    return { ok: true, archivos: ordenados };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('xuiComponer', async (event, data = {}) => {
  try {
    const archive = getResourceArchive(data.ruta, data.source ? { source: data.source } : {});
    const indiceImagenes = buildDbPreviewImageIndex(data.ruta || false, data.source);
    const texturas = {};
    const pendientes = new Set();
    const piezas = [];

    for(const fullName of (data.archivos || [])){
      const entry = archive.entries.find(item => item.fullName === fullName);
      if(!entry) continue;

      const texto = getDecodedResourceData(archive, entry).data.toString('utf8');
      const controles = editorXui.parsearXui(texto);

      (function juntar(lista){
        for(const control of lista){
          if(control.textura) pendientes.add(control.textura);
          juntar(control.hijos);
        }
      })(controles);

      piezas.push({ fullName: entry.fullName, controles });
    }

    for(const nombre of pendientes){
      try {
        const src = getDbPreviewImageSrc(nombre, indiceImagenes);
        if(src) texturas[nombre] = src;
      } catch(e) {}
    }

    return { ok: true, piezas, texturas };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('texturaAbrir', async (event, data = {}) => {
  try {
    const indice = buildDbPreviewImageIndex(data.ruta || false, data.source);
    const hallado = findDbPreviewImage(data.nombre, indice);

    if(!hallado){
      return { ok: false, error: `texture not found: ${data.nombre}` };
    }

    const crudo = hallado.type === 'resource'
      ? resourceDecoder.decodeResource(hallado.entry, hallado.archive.resourceFolder).data
      : fs.readFileSync(hallado.file);

    const nombreCompleto = hallado.type === 'resource' ? hallado.entry.fullName : hallado.file;
    const extension = path.extname(nombreCompleto).toLowerCase();

    let png;
    if(extension === '.dds') png = ddsToPngDataUrl(crudo);
    else if(extension === '.tga') png = tgaToPngDataUrl(crudo);
    else png = `data:image/${extension.slice(1)};base64,${crudo.toString('base64')}`;

    const info = extension === '.dds' ? ddsEncoder.leerFormatoDds(crudo) : null;

    return {
      ok: true,
      png,
      fullName: nombreCompleto,
      extension,
      formato: info ? info.formato : null,
      bpp: info ? info.bpp : 0,
      mipmaps: info ? info.mipmaps : 1,
      enContenedor: hallado.type === 'resource'
    };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('texturaGuardar', async (event, data = {}) => {
  try {
    const rgba = Buffer.from(data.rgba, 'base64');
    const extension = String(data.extension || '.dds').toLowerCase();

    let salida;
    if(extension === '.dds'){
      salida = ddsEncoder.codificarDds(rgba, data.ancho, data.alto, data.formato || 'DXT5', {
        bpp: data.bpp || 32,
        mipmaps: (data.mipmaps || 1) > 1
      });
    } else if(extension === '.tga'){
      salida = ddsEncoder.codificarTga(rgba, data.ancho, data.alto);
    } else {
      const png = new PNG({ width: data.ancho, height: data.alto });
      rgba.copy(png.data);
      salida = PNG.sync.write(png);
    }

    if(data.enContenedor){
      const archive = getResourceArchive(data.ruta, data.source ? { source: data.source } : {});
      writeResourceData(archive, data.fullName, salida);
      if(!archive.looseMode) resourceDecoder.saveContainer(archive, archive.resourceFile);
    } else {
      fs.writeFileSync(data.fullName, salida);
    }

    return { ok: true, bytes: salida.length };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('xuiSave', async (event, data = {}) => {
  try {
    const archive = getResourceArchive(data.ruta, data.source ? { source: data.source } : {});
    const entry = archive.entries.find(item => item.fullName === data.fullName);

    if(!entry){
      return { ok: false, error: 'xui not found.' };
    }

    const texto = getDecodedResourceData(archive, entry).data.toString('utf8');
    const controles = editorXui.parsearXui(texto);
    const cambios = [];

    const buscar = ruta => {
      let actual = null;
      let lista = controles;
      for(const indice of ruta){
        actual = lista[indice];
        if(!actual) return null;
        lista = actual.hijos;
      }
      return actual;
    };

    const rutasEditadas = new Set((data.ediciones || []).map(e => (e.ruta || []).join('.')));

    for(const edicion of (data.ediciones || [])){
      const control = buscar(edicion.ruta || []);
      if(!control) continue;

      if(edicion.x !== undefined && control.offsets.global){
        const ancho = edicion.ancho ?? control.ancho;
        const alto = edicion.alto ?? control.alto;
        cambios.push({
          ...control.offsets.global,
          atributos: {
            left: Math.round(edicion.x),
            top: Math.round(edicion.y),
            right: Math.round(edicion.x + ancho),
            bottom: Math.round(edicion.y + alto)
          }
        });

        const rutaPadre = (edicion.ruta || []).slice(0, -1).join('.');
        const padreTambienSeMovio = (edicion.ruta || []).length > 1 && rutasEditadas.has(rutaPadre);

        if(control.offsets.local && !padreTambienSeMovio){
          const deltaX = Math.round(edicion.x) - control.x;
          const deltaY = Math.round(edicion.y) - control.y;
          const localX = (control.localX ?? 0) + deltaX;
          const localY = (control.localY ?? 0) + deltaY;
          cambios.push({
            ...control.offsets.local,
            atributos: {
              left: localX,
              top: localY,
              right: localX + (control.localAncho ?? ancho),
              bottom: localY + (control.localAlto ?? alto)
            }
          });
        }
      }

      if(edicion.visible !== undefined && control.offsets.show){
        cambios.push({ ...control.offsets.show, atributos: { value: edicion.visible ? 'true' : 'false' } });
      }

      if(edicion.habilitado !== undefined && control.offsets.enable){
        cambios.push({ ...control.offsets.enable, atributos: { value: edicion.habilitado ? 'true' : 'false' } });
      }

      if(edicion.opacidad !== undefined && control.offsets.opacity){
        cambios.push({ ...control.offsets.opacity, atributos: { value: Number(edicion.opacidad).toFixed(6) } });
      }

      if(edicion.texto !== undefined){
        for(const idioma of Object.keys(control.textos || {})){
          const offset = control.offsets['texto_' + idioma];
          if(offset) cambios.push({ ...offset, atributos: { value: edicion.texto } });
        }
      }

      if(edicion.textura !== undefined){
        const piel = (control.pieles || []).find(p => p.indice === 0);
        if(piel && piel.offset) cambios.push({ ...piel.offset, atributos: { texture: edicion.textura } });
      }

      if(Array.isArray(edicion.colores)){
        for(const cambioColor of edicion.colores){
          const color = (control.colores || []).find(c => c.indice === cambioColor.indice);
          if(!color || !color.offset) continue;
          const atributos = {};
          if(cambioColor.base !== undefined) atributos.base_color = cambioColor.base >>> 0;
          if(cambioColor.sub !== undefined) atributos.sub_color = cambioColor.sub >>> 0;
          if(Object.keys(atributos).length) cambios.push({ ...color.offset, atributos });
        }
      }
    }

    if(!cambios.length){
      return { ok: true, guardados: 0 };
    }

    const ordenados = [...cambios].sort((a, b) => b.inicio - a.inicio);
    let salida = texto;

    for(const cambio of ordenados){
      let etiqueta = salida.slice(cambio.inicio, cambio.fin);

      for(const [atributo, valor] of Object.entries(cambio.atributos)){
        const patron = new RegExp(`(\\b${atributo}\\s*=\\s*")([^"]*)(")`);
        if(patron.test(etiqueta)) etiqueta = etiqueta.replace(patron, `$1${valor}$3`);
      }

      salida = salida.slice(0, cambio.inicio) + etiqueta + salida.slice(cambio.fin);
    }

    writeResourceData(archive, entry.fullName, Buffer.from(salida, 'utf8'));

    if(!archive.looseMode){
      resourceDecoder.saveContainer(archive, archive.resourceFile);
      resourceCache.dirty = false;
    }

    return { ok: true, guardados: cambios.length, looseMode: !!archive.looseMode };
  } catch(e){
    console.error('[XUI SAVE]', e.stack || e.message);
    const origen = (e.stack || '').split('\n')[1] || '';
    return { ok: false, error: `${e.message}${origen ? ' @ ' + origen.trim() : ''}` };
  }
});

ipcMain.handle('resourceCleanUnused', async (event, data = {}) => {
  try {
    const archive = getResourceArchive(data.ruta);
    if(archive.looseMode || archive.packMode){
      return { ok: false, error: 'Load the resource.s4hd container first (unused cleanup works on _resources).' };
    }

    const referenciados = new Set();
    for(const entry of archive.entries){
      for(const nombre of resourceDecoder.checksumCandidates(entry.checksum)){
        referenciados.add(String(nombre).toLowerCase());
      }
    }

    const huerfanos = [];
    let bytesTotales = 0;
    for(const nombre of await fsp.readdir(archive.resourceFolder)){
      const rutaArchivo = path.join(archive.resourceFolder, nombre);
      let info;
      try { info = await fsp.stat(rutaArchivo); } catch(e) { continue; }
      if(!info.isFile()) continue;
      if(referenciados.has(nombre.toLowerCase())) continue;
      huerfanos.push(rutaArchivo);
      bytesTotales += info.size;
    }

    if(data.action !== 'delete'){
      return { ok: true, count: huerfanos.length, bytes: bytesTotales };
    }

    let borrados = 0;
    const megasTotales = (bytesTotales / 1048576).toFixed(1);
    for(const rutaArchivo of huerfanos){
      try { await fsp.unlink(rutaArchivo); borrados++; } catch(e) {}

      if(borrados % 250 === 0 || borrados === huerfanos.length){
        try {
          event.sender.send('cleanUnusedProgress', {
            pct: Math.round(100 * borrados / huerfanos.length),
            label: `Deleting orphan files (${borrados}/${huerfanos.length}) — ${megasTotales} MB total`
          });
        } catch(e) {}
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    return { ok: true, count: huerfanos.length, deleted: borrados, bytes: bytesTotales };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('resourceSaveChanges', async (event, ruta) => {
  try {
    const archive = getResourceArchive(ruta);
    if(archive.packMode){
      return { ok: false, error: 'Editing packs is not supported. Edit resource.s4hd (container) and rebuild packs.' };
    }

    let reimported = 0;
    for(const [fullName, info] of openedResourceTemps){
      try {
        if(!fs.existsSync(info.tempPath)) continue;
        const st = fs.statSync(info.tempPath);
        if(st.mtimeMs <= info.mtimeMs) continue;
        let data = fs.readFileSync(info.tempPath);
        if(data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF){
          data = data.subarray(3);
        }
        writeResourceData(archive, fullName, data);
        info.mtimeMs = st.mtimeMs;
        reimported++;
      } catch(e) {  }
    }

    if(!archive.looseMode){
      resourceDecoder.saveContainer(archive, archive.resourceFile);
    }
    resourceCache.dirty = false;

    return { ok: true, reimported };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

const liveResourceXmlFiles = {
  itemx7: 'xml/item.x7',
  itemxml: 'xml/item.xml',
  iteminfox7: 'xml/iteminfo.x7',
  weaponlua: 'xml/weapon_lua.x7',
  weaponx7: 'xml/weapon.x7',
  iteminfoStringX7: 'language/xml/iteminfo_string_table.x7',
  iteminfoStringXML: 'language/xml/iteminfo_string_table.xml'
};

const liveResourcePairs = [
  ['itemx7', 'itemxml'],
  ['iteminfoStringX7', 'iteminfoStringXML']
];

const liveResourceSingletons = ['iteminfox7', 'weaponlua'];

const liveMapClientFiles = {
  maplist: 'xml/map.x7',
  nameTable: ['language/xml/gameinfo_string_table.x7', 'language/xml/gameinfo_string_table.xml']
};

function nombreCancion(ogg){
  return path.basename(ogg, path.extname(ogg))
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function registrarBgmMapas(optText, bgmPorMapa){
  const usados = [...optText.matchAll(/OP_(\d{4})/g)].map(m => parseInt(m[1], 10));
  let siguienteOp = (usados.length ? Math.max(...usados) : 0) + 1;

  const claveDeArchivo = new Map();
  for(const m of optText.matchAll(/<data\s+name_key="(OP_\d{4})"\s+file="([^"]+)"\s*\/>/gi)){
    claveDeArchivo.set(m[2].toLowerCase(), m[1]);
  }

  const nuevasCanciones = [];
  const textosNuevos = [];

  for(const { id, oggs } of bgmPorMapa){
    const claves = [];
    for(const ogg of oggs.slice(0, 3)){
      const ruta = ('resources/bgm/' + ogg);
      let clave = claveDeArchivo.get(ruta.toLowerCase());
      if(!clave){
        clave = 'OP_' + String(siguienteOp++).padStart(4, '0');
        claveDeArchivo.set(ruta.toLowerCase(), clave);
        nuevasCanciones.push(`\t\t\t<data name_key="${clave}" file="${ruta}" />`);
        textosNuevos.push({ clave, nombre: nombreCancion(ogg) });
      }
      claves.push(clave);
    }

    const linea = `\t\t\t<data map_id="${id}" bgm1_key="${claves[0] || ''}" bgm2_key="${claves[1] || ''}" bgm3_key="${claves[2] || ''}" />`;
    optText = optText.replace(new RegExp(`\\s*<data\\s+map_id="${id}"[^>]*bgm1_key[^>]*/>`, 'i'), '');
    optText = optText.replace('</maplist>', linea + '\n\t\t</maplist>');
  }

  if(nuevasCanciones.length){
    optText = optText.replace('</bgmlist>', nuevasCanciones.join('\n') + '\n\t\t</bgmlist>');
  }

  return { optText, textosNuevos };
}

function registrarTextosBgm(tablaText, textosNuevos){
  const escapar = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const idiomas = ['kor','ger','eng','fre','spa','ita','rus','ame','tur','cns','twn','tha','jap','idn'];
  const cierre = tablaText.match(/<\/string_table>|<\/default_option>|<\/option>/i);
  const tagCierre = cierre ? cierre[0] : null;
  if(!tagCierre) return tablaText;

  const lineas = textosNuevos
    .filter(t => !tablaText.includes(`key="${t.clave}"`))
    .map(t => {
      const attrs = idiomas.map(l => `${l}="${escapar(t.nombre)}"`).join(' ');
      return `\t<string key="${t.clave}" ${attrs}/>`;
    });

  if(!lineas.length) return tablaText;
  return tablaText.replace(tagCierre, lineas.join('\n') + '\n' + tagCierre);
}

function readArchiveText(archive, resourceName){
  const entry = findResourceEntry(archive, resourceName);
  if(!entry) return null;
  try {
    return resourceDecoder.decodeResource(entry, archive.resourceFolder).data.toString('utf8');
  } catch(e) {
    return null; 
  }
}

function walkFiles(dir){
  const out = [];
  for(const e of fs.readdirSync(dir, { withFileTypes: true })){
    const p = path.join(dir, e.name);
    if(e.isDirectory()) out.push(...walkFiles(p)); else out.push(p);
  }
  return out;
}

function findMapPreview(mapsRoot, iniFile){
  const dir = path.join(mapsRoot, 'mapselect');
  if(fs.existsSync(dir)){
    const files = fs.readdirSync(dir).filter(f => /\.(dds|tga)$/i.test(f));
    const base = iniFile.replace(/^bginfo[-_]/i, '').replace(/\.ini$/i, '').toLowerCase();
    const tokens = base.split(/[_-]+/).filter(Boolean);
    const chosen = files.find(f => tokens.some(t => f.toLowerCase().includes(t))) || files[0];
    if(chosen) return `Resources/Mapselect/${chosen}`;
  }
  return 'Resources/Mapselect/random.dds';
}

function mapPreviewSrc(mapsRoot, previewPath){
  const name = (previewPath || '').split('/').pop();
  const full = path.join(mapsRoot, 'mapselect', name || '');
  return name && fs.existsSync(full) ? 'file:///' + full.replace(/\\/g, '/') : '';
}

ipcMain.handle('liveCostumesScanPets', async (event, data = {}) => {
  try {
    const sourceRoot = data.sourcePath || weaponSourcePath;
    if(!sourceRoot) return { ok: false, error: 'Select costumes source folder first.' };

    const resourcesRoot = getRequiredSourceResourcesRoot(sourceRoot);
    if(!resourcesRoot) return { ok: false, error: 'Source Folder must be the folder that contains resources.' };

    const pets = collectLiveCostumeFiles(resourcesRoot)
      .filter(item => item.costumeType === 'pets')
      .map(item => ({
        clave: claveAnclajeCostume(item),
        nombre: item.displayName,
        genero: item.genderFolder,
        src: getCostumePreviewSrc(resourcesRoot, item)
      }));

    return { ok: true, pets };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('liveResourceAddMaps', async (event, data = {}) => {
  try {
    suppressResourceReload = true;
    const mapsRoot = path.join(__dirname, 'resources', 'maps');

    const raicesMapas = [];
    if(fs.existsSync(path.join(mapsRoot, 'mapinfo'))){
      raicesMapas.push(mapsRoot);
    } else if(fs.existsSync(mapsRoot)){
      for(const dir of fs.readdirSync(mapsRoot, { withFileTypes: true })){
        if(!dir.isDirectory()) continue;
        const raiz = path.join(mapsRoot, dir.name);
        if(fs.existsSync(path.join(raiz, 'mapinfo'))) raicesMapas.push(raiz);
      }
    }

    if(!raicesMapas.length){
      return { ok: false, error: 'No maps found. Put each map in resources/maps/<name>/ with its mapinfo folder.' };
    }

    const maps = [];
    for(const raiz of raicesMapas){
      const dirInfo = path.join(raiz, 'mapinfo');
      for(const file of fs.readdirSync(dirInfo)){
        if(!/\.ini$/i.test(file)) continue;
        const info = mapsUtil.parseBginfoText(fs.readFileSync(path.join(dirInfo, file), 'latin1'));
        const name = mapsUtil.prettifyMapName(file);
        if(!info.modes.length){ maps.push({ file, name, raiz, skip: 'no known enableMode letter' }); continue; }
        maps.push({
          file, name, raiz,
          bginfoPath: `Resources/MapInfo/${file}`,
          preview: findMapPreview(raiz, file),
          modes: info.modes,
          limit: info.limit
        });
      }
    }
    if(!maps.length) return { ok: false, error: 'No .ini files inside the map folders.' };

    const archive = getResourceArchive(data.resourcePath);

    let cmText = readArchiveText(archive, liveMapClientFiles.maplist);
    if(cmText == null) return { ok: false, error: `${liveMapClientFiles.maplist} not found in resource.s4hd.` };
    let ntName = null, ntText = null;
    for(const n of liveMapClientFiles.nameTable){ const t = readArchiveText(archive, n); if(t != null){ ntName = n; ntText = t; break; } }
    
    const gameData = data.gameDataPath && fs.existsSync(data.gameDataPath) ? data.gameDataPath : null;
    const serverMapPath = gameData ? path.join(gameData, 'xml', 'map.x7') : null;
    const serverNamePath = gameData ? path.join(gameData, 'language', 'xml', 'gameinfo_string_table.x7') : null;
    const hasServerMap = !!serverMapPath && fs.existsSync(serverMapPath);
    const hasServerName = !!serverNamePath && fs.existsSync(serverNamePath);
    let smText = hasServerMap ? fs.readFileSync(serverMapPath, 'utf8') : '';
    let snText = hasServerName ? fs.readFileSync(serverNamePath, 'utf8') : '';

    const addMapEntries = (mapText, id, nameKey, m) => {
      let added = false;
      const present = mapsUtil.serverModesForBginfo(mapText, m.bginfoPath);
      for(const mode of m.modes){
        if(present.has(mode)) continue;
        mapText = mapsUtil.insertBeforeClose(mapText, '</maplist>', mapsUtil.serverMapEntry(id, nameKey, mode, m.limit, m.bginfoPath, m.preview));
        added = true;
      }
      return [mapText, added];
    };

    const results = [];
    const bgmPorMapa = [];
    for(const m of maps){
      if(m.skip){ results.push({ id: 0, nombre: m.name, status: 'Skipped', src: '', note: m.skip }); continue; }

      const nameKey = mapsUtil.mapNameKey(m.file);

      let id = mapsUtil.mapIdForBginfo(cmText, m.bginfoPath);
      if(id == null && hasServerMap) id = mapsUtil.mapIdForBginfo(smText, m.bginfoPath);

      let idIsBad = false;
      if(id != null){
        if(id > 255) idIsBad = true;
        else {
          const co = mapsUtil.serverBginfoForId(cmText, id);
          const so = hasServerMap ? mapsUtil.serverBginfoForId(smText, id) : null;
          const bg = m.bginfoPath.toLowerCase();
          if((co && co.toLowerCase() !== bg) || (so && so.toLowerCase() !== bg)) idIsBad = true;
        }
      }
      if(id != null && idIsBad){
        cmText = mapsUtil.removeServerMapsForBginfo(cmText, m.bginfoPath);
        ntText = mapsUtil.removeMapName(ntText, id);
        if(hasServerMap) smText = mapsUtil.removeServerMapsForBginfo(smText, m.bginfoPath);
        if(hasServerName) snText = mapsUtil.removeMapName(snText, id);
        id = null;
      }

      if(id == null){
        
        const usedIds = mapsUtil.serverUsedIds(cmText);
        if(hasServerMap) for(const sid of mapsUtil.serverUsedIds(smText)) usedIds.add(sid);
        const byMode = mapsUtil.serverUsedByMode(cmText);
        if(hasServerMap) mapsUtil.serverUsedByMode(smText).forEach((set, mode) => {
          if(!byMode.has(mode)) byMode.set(mode, new Set());
          for(const b of set) byMode.get(mode).add(b);
        });
        id = mapsUtil.pickMapId(usedIds, byMode, m.modes, 2, 255);
        if(id == null){ results.push({ id: 0, nombre: m.name, status: 'NotAdded', src: mapPreviewSrc(m.raiz, m.preview) }); continue; }
      }

      let clientAdded;
      [cmText, clientAdded] = addMapEntries(cmText, id, nameKey, m);
      if(ntText != null && !ntText.includes(`key="${nameKey}"`)){
        ntText = mapsUtil.insertBeforeClose(ntText, mapNameTableCloseTag(ntText), mapsUtil.clientNameString(nameKey, m.name));
      }

      let serverAdded = false;
      if(hasServerMap){ [smText, serverAdded] = addMapEntries(smText, id, nameKey, m); }
      if(hasServerName && !snText.includes(`key="${nameKey}"`)){
        snText = mapsUtil.insertBeforeClose(snText, '</string_table>', mapsUtil.serverNameString(nameKey, m.name));
      }

      const status = (clientAdded || serverAdded) ? 'Added' : 'Skipped';
      results.push({ id, nombre: m.name, status, src: mapPreviewSrc(m.raiz, m.preview) });

      const bgmDir = path.join(m.raiz, 'bgm');
      const oggs = fs.existsSync(bgmDir) ? fs.readdirSync(bgmDir).filter(f => /\.ogg$/i.test(f)) : [];
      if(oggs.length) bgmPorMapa.push({ id, oggs });
    }

    upsertResourceData(archive, liveMapClientFiles.maplist, Buffer.from(cmText, 'utf8'));
    if(ntName != null && ntText != null) upsertResourceData(archive, ntName, Buffer.from(ntText, 'utf8'));

    let bgmNota = '';
    if(bgmPorMapa.length){
      const optName = archive.entries.map(e => e.fullName).find(n => /(^|\/)_eu_default_option\.x7$/i.test(n));
      let optText = optName ? readArchiveText(archive, optName) : null;

      if(optText && optText.includes('<bgmlist>')){
        const { optText: nuevoOpt, textosNuevos } = registrarBgmMapas(optText, bgmPorMapa);
        upsertResourceData(archive, optName, Buffer.from(nuevoOpt, 'utf8'));

        if(textosNuevos.length){
          const tablaName = archive.entries.map(e => e.fullName).find(n => /default_option_string_table\.x7$/i.test(n));
          const tablaText = tablaName ? readArchiveText(archive, tablaName) : null;
          if(tablaText){
            upsertResourceData(archive, tablaName, Buffer.from(registrarTextosBgm(tablaText, textosNuevos), 'utf8'));
          }
        }
        bgmNota = ' Music linked. Delete S4Client.option.s4 in the client folder before launching, or the jukebox will not update.';
      } else {
        bgmNota = ' BGM not linked: _eu_default_option.x7 not found in the container.';
      }
    }

    let copied = 0;
    for(const raiz of raicesMapas){
      for(const sub of ['bgm', 'effects', 'image', 'mapinfo', 'mapselect', 'model']){
        const subDir = path.join(raiz, sub);
        if(!fs.existsSync(subDir)) continue;
        for(const file of walkFiles(subDir)){
          const rel = path.relative(raiz, file).replace(/\\/g, '/');
          upsertResourceData(archive, 'resources/' + rel, fs.readFileSync(file));
          copied++;
        }
      }
    }

    resourceDecoder.saveContainer(archive, archive.resourceFile);
    resourceCache.dirty = false;

    const carpetaLibre = asegurarCarpetaMapaLibre(path.join(__dirname, 'resources'));

    if(hasServerMap) fs.writeFileSync(serverMapPath, smText, 'utf8');
    if(hasServerName) fs.writeFileSync(serverNamePath, snText, 'utf8');

    if(gameData){
      const dstMapinfo = path.join(gameData, 'resources', 'mapinfo');
      fs.mkdirSync(dstMapinfo, { recursive: true });
      for(const raiz of raicesMapas){
        const dirInfo = path.join(raiz, 'mapinfo');
        for(const file of fs.readdirSync(dirInfo)){
          if(/\.ini$/i.test(file)) fs.copyFileSync(path.join(dirInfo, file), path.join(dstMapinfo, file));
        }
      }
    }

    let note = '';
    if(!gameData){
      note = 'Client updated. Select GameData Folder (Paths menu) so the emulador is updated too.';
    } else {
      const missing = [];
      if(!hasServerMap) missing.push('xml/map.x7');
      if(!hasServerName) missing.push('language/xml/gameinfo_string_table.x7');
      if(missing.length) note = `GameData folder is missing ${missing.join(', ')} — is it the emulador's data folder?`;
    }
    note += bgmNota;

    return {
      ok: true,
      items: await hydrateProcessedPreviewImages(results),
      copied,
      nextMapFolder: path.basename(carpetaLibre),
      serverUpdated: hasServerMap || hasServerName,
      count: archive.entries.length,
      note
    };
  } catch(e){
    return { ok: false, error: describeError(e, 'add maps') };
  } finally {
    suppressResourceReload = false;
  }
});

function findResourceEntry(archive, fullName){
  const cleanName = fullName.toLowerCase().replace(/\\/g, '/');
  return archive.entries.find(item => item.fullName === cleanName);
}

function upsertResourceData(archive, fullName, data){
  const cleanName = fullName.toLowerCase().replace(/\\/g, '/');
  const entry = findResourceEntry(archive, cleanName);

  if(entry){
    writeResourceData(archive, cleanName, data);
  } else {
    createResourceData(archive, cleanName, data);
  }
}

async function prepareLiveResourceXmlFiles(archive){
  const tempRoot = path.join(app.getPath('temp'), 'ItemManagerLiveResource', String(Date.now()));
  const paths = {};
  const present = {};

  for(const [key, resourceName] of Object.entries(liveResourceXmlFiles)){
    const entry = findResourceEntry(archive, resourceName);
    if(!entry) continue;

    const decoded = resourceDecoder.decodeResource(entry, archive.resourceFolder);
    const outputPath = path.join(tempRoot, resourceName);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, decoded.data);
    paths[key] = outputPath;
    present[key] = true;
  }

  const format = paths.iteminfox7
    ? (itemS1.detectFormat(await fsp.readFile(paths.iteminfox7, 'utf8')) === 's1' ? 's1' : 's10')
    : 's10';

  const optionalPairs = format === 's1' ? new Set(['itemx7']) : new Set();
  const requiredSingletons = format === 's1'
    ? [...liveResourceSingletons, 'weaponx7']
    : liveResourceSingletons;

  for(const [a, b] of liveResourcePairs){
    if(!paths[a] && !paths[b]){
      if(optionalPairs.has(a)) continue;
      throw new Error(`${liveResourceXmlFiles[a]} / ${liveResourceXmlFiles[b]} not found in resource.s4hd.`);
    }
    if(paths[a] && !paths[b]){
      const clone = path.join(tempRoot, liveResourceXmlFiles[b]);
      await fsp.mkdir(path.dirname(clone), { recursive: true });
      await fsp.copyFile(paths[a], clone);
      paths[b] = clone;
    } else if(paths[b] && !paths[a]){
      const clone = path.join(tempRoot, liveResourceXmlFiles[a]);
      await fsp.mkdir(path.dirname(clone), { recursive: true });
      await fsp.copyFile(paths[b], clone);
      paths[a] = clone;
    }
  }

  for(const key of requiredSingletons){
    if(!paths[key]){
      throw new Error(`${liveResourceXmlFiles[key]} not found in resource.s4hd.`);
    }
  }

  return { tempRoot, paths, present, format };
}

async function writeLiveResourceXmlFiles(archive, prepared){
  for(const [key, resourceName] of Object.entries(liveResourceXmlFiles)){
    if(!prepared.present[key]) continue;
    const data = await fsp.readFile(prepared.paths[key]);
    upsertResourceData(archive, resourceName, data);
  }
}

async function getLiveSourceWeaponsXml(sourceRoot, tempRoot, serverXbnRoot = null){
  if(serverXbnRoot && fs.existsSync(serverXbnRoot)){
    const xbnServidor = path.join(serverXbnRoot, 'Weapons.xbn');
    const xmlServidor = path.join(serverXbnRoot, 'Weapons.xml');

    if(fs.existsSync(xbnServidor)){
      const temporal = path.join(tempRoot, 'serverxbn', 'Weapons.xml');
      await fsp.mkdir(path.dirname(temporal), { recursive: true });
      await convertXbnFileToXml(xbnServidor, temporal, { deleteSource: false });
      return { path: temporal, outputPath: null, xbnPath: xbnServidor };
    }

    if(fs.existsSync(xmlServidor)){
      return { path: xmlServidor, outputPath: xmlServidor, xbnPath: path.join(serverXbnRoot, 'Weapons.xbn') };
    }

    throw new Error(`Weapons.xbn / Weapons.xml not found in the Server XBN folder: ${serverXbnRoot}`);
  }

  const sourceXml = path.join(sourceRoot, 'auth', 'xbn', 'Weapons.xml');
  const sourceXbn = path.join(sourceRoot, 'auth', 'xbn', 'Weapons.xbn');

  if(fs.existsSync(sourceXml)){
    return { path: sourceXml, outputPath: sourceXml, xbnPath: fs.existsSync(sourceXbn) ? sourceXbn : null };
  }

  if(fs.existsSync(sourceXbn)){
    const tempXml = path.join(tempRoot, 'auth', 'xbn', 'Weapons.xml');
    await fsp.mkdir(path.dirname(tempXml), { recursive: true });
    await convertXbnFileToXml(sourceXbn, tempXml, { deleteSource: false });
    return { path: tempXml, outputPath: sourceXml, xbnPath: sourceXbn };
  }

  if(fs.existsSync(weaponxml)){
    console.warn('[ADD ITEMS] usando el Weapons.xml de ItemManager: no habia uno en la source ni carpeta XBN del servidor configurada');
    return { path: weaponxml, outputPath: null, xbnPath: null, fallback: true };
  }

  throw new Error('Weapons.xml or Weapons.xbn not found. Set the Server XBN Folder in Paths.');
}

async function addLiveWeaponAssetsToArchive(archive, sourceRoot, sourceFiles){
  const copied = [];

  for(const [weaponName, weaponFolders] of Object.entries(sourceFiles)){
    for(const [weaType, files] of Object.entries(weaponFolders)){
      for(const img of files.imgs || []){
        const src = path.join(sourceRoot, 'weapon', weaponName, weaType, 'imgs', img);
        if(!fs.existsSync(src)) continue;
        const data = await fsp.readFile(src);
        const resourceName = `resources/image/weapon/${img}`;
        upsertResourceData(archive, resourceName, data);
        copied.push(resourceName);
      }

      for(const model of files.model || []){
        const src = path.join(sourceRoot, 'weapon', weaponName, weaType, 'model', model);
        if(!fs.existsSync(src)) continue;
        const data = await fsp.readFile(src);
        const resourceName = `resources/model/weapon/${model}`;
        upsertResourceData(archive, resourceName, data);
        copied.push(resourceName);
      }
    }
  }

  return copied;
}

const costumeResourcePart = {
  hair: 'hair',
  face: 'face',
  top: 'body',
  pants: 'leg',
  gloves: 'hand',
  shoes: 'foot',
  accessories: 'acc',
  pets: 'pet',
  skills_cards: 'acc'
};

function getCostumePreviewSrc(sourceRoot, item){
  const filePath = path.join(item.costumeRoot || path.join(sourceRoot, 'costumes'), item.folderType, item.genderFolder, item.imgFolder, item.icon);
  return 'file:///' + filePath.replace(/\\/g, '/');
}

function claveAnclajeCostume(item){
  return `${item.folderType}/${item.genderFolder}/${item.model}`.toLowerCase();
}

function isCostumePartModel(file){
  return /_part\d+\.scn$/i.test(String(file || ''));
}

function costumeModelGroup(file){
  return String(file || '').replace(/\.scn$/i, '').replace(/_part\d+$/i, '').toLowerCase();
}

function collectLiveCostumeFiles(sourceRoot){
  const costumeRoot = resolveCostumeRoot(sourceRoot);
  const items = [];

  if(!costumeRoot){
    return items;
  }

  for(const typeDir of fs.readdirSync(costumeRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())){
    const folderType = typeDir.name;
    const costumeType = normalizeCostumeType(folderType);

    if(!id_range[costumeType]){
      continue;
    }

    const typePath = path.join(costumeRoot, folderType);

    for(const genderDir of fs.readdirSync(typePath, { withFileTypes: true }).filter(entry => entry.isDirectory())){
      const genderFolder = genderDir.name;
      const sex = normalizeCostumeSex(genderFolder);
      const genderPath = path.join(typePath, genderFolder);
      const imgFolder = fs.existsSync(path.join(genderPath, 'imgs')) ? 'imgs' : (fs.existsSync(path.join(genderPath, 'img')) ? 'img' : 'imgs');
      const imgPath = path.join(genderPath, imgFolder);
      const modelPath = path.join(genderPath, 'model');

      if(!fs.existsSync(imgPath) || !fs.existsSync(modelPath)){
        continue;
      }

      const imgs = fs.readdirSync(imgPath).filter(file => /\.(dds|tga|png|jpg|bmp)$/i.test(file));
      const models = fs.readdirSync(modelPath).filter(file => /\.scn$/i.test(file));
      const allModelAssets = fs.readdirSync(modelPath).filter(file => /\.(dds|tga|png|jpg|bmp)$/i.test(file));
      const hasOwnIcon = file => {
        const fileBase = path.basename(file, path.extname(file)).toLowerCase();
        return imgs.some(img => assetNamesMatch(fileBase, path.basename(img, path.extname(img)).toLowerCase()));
      };
      const mainModels = models.filter(file => !isCostumePartModel(file) || hasOwnIcon(file));

      for(const model of mainModels){
        const base = path.basename(model, path.extname(model)).toLowerCase();
        const group = costumeModelGroup(model);
        const parts = models
          .filter(file => file !== model && isCostumePartModel(file) && costumeModelGroup(file) === group)
          .sort();
        const recolors = new Set();
        const iconAssets = imgs.filter(img => {
          if(!assetNamesMatchBase(base, img)){
            return false;
          }
          const info = splitRecolorBase(img);
          if(info.index > 0){
            recolors.add(info.index);
          }
          return true;
        });
        const modelAssets = allModelAssets.filter(asset => {
          let info = costumeModelAssetInfo(model, asset);
          if(!info.match){
            for(const part of parts){
              const partInfo = costumeModelAssetInfo(part, asset);
              if(partInfo.match){
                info = partInfo;
                break;
              }
            }
          }
          if(info.match && info.recolorIndex > 0){
            recolors.add(info.recolorIndex);
          }
          return info.match;
        });
        const icon = imgs.find(img => {
          const imgBase = path.basename(img, path.extname(img)).toLowerCase();
          return assetNamesMatch(base, imgBase);
        }) || imgs[0];

        if(!icon){
          continue;
        }

        const displayName = path.basename(model, path.extname(model))
          .replace(/^icon_/i, '')
          .replace(/_/g, ' ')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, char => char.toUpperCase());

        items.push({
          costumeType,
          folderType,
          resourcePart: costumeResourcePart[costumeType] || costumeType,
          genderFolder,
          costumeRoot,
          imgFolder,
          sex,
          icon,
          iconAssets,
          model,
          parts,
          modelAssets,
          recolorCount: recolors.size,
          displayName
        });
      }
    }
  }

  return items;
}

async function appendCostumeItemS1(filePath, id, costume, anclaje){
  const data = await fsp.readFile(filePath, 'utf8');
  const itemXml = itemS1.makeCostumeItem(id, costume.icon, costume.displayName, costume.sex, costume.model, costume.folderType, {
    hidingOption: String(costume.folderType).toLowerCase().includes('hat') ? 'hair_all' : '',
    parts: costume.parts || [],
    nodeParent: anclaje ? anclaje.nodeParent : undefined,
    animationPart: anclaje ? anclaje.animationPart : undefined
  });

  await fsp.writeFile(filePath, itemS1.insertItem(data, id, itemXml), 'utf8');
}

async function appendWeaponItemS1(id, weaName, weaType, sceneFile, iconFile){
  const baseId = itemS1.weaponBaseId(weaType);
  if(!baseId){
    throw new Error(`${weaType} no existe en Season 1, no hay arma base de la que copiar`);
  }

  const info = await fsp.readFile(activeFilePaths.iteminfox7, 'utf8');
  const itemXml = itemS1.cloneWeaponItem(info, baseId, id, {
    displayName: weaName,
    icon: iconFile,
    sceneFile
  });
  await fsp.writeFile(activeFilePaths.iteminfox7, itemS1.insertItem(info, id, itemXml), 'utf8');

  const weaponPath = activeFilePaths.weaponx7;
  if(weaponPath && fs.existsSync(weaponPath)){
    const weapons = await fsp.readFile(weaponPath, 'utf8');
    const entry = itemS1.cloneWeaponEntry(weapons, baseId, id, { icon: iconFile, sceneFile });
    await fsp.writeFile(weaponPath, itemS1.insertWeaponEntry(weapons, entry), 'utf8');
  }
}

async function appendXmlItem(filePath, itemXml){
  let data = '';
  try {
    data = await fsp.readFile(filePath, 'utf8');
  } catch(e) {}

  const output = data && data.includes('</itemlist>')
    ? data.replace(/<\/itemlist>\s*$/, itemXml + '</itemlist>')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<itemlist>\n${itemXml}\n</itemlist>`;

  await fsp.writeFile(filePath, output, 'utf8');
}

function buildCostumeStringEntries(id, name){
  return {
    NameDesc: `<string key="N${id}" kor="${name}" ger="${name}" eng="${name}" tur="${name}" fre="${name}" spa="${name}" ita="${name}" rus="${name}" ame="${name}" cns="${name}" tha="${name}" twn="${name}" jap="${name}" idn="${name}"/>`,
    TipDesc: `<string key="T${id}" kor="${name}" ger="${name}" eng="${name}" tur="${name}" fre="${name}" spa="${name}" ita="${name}" rus="${name}" ame="${name}" cns="${name}" tha="${name}" twn="${name}" jap="${name}" idn="${name}"/>`
  };
}

async function appendStringTable(filePath, entries){
  let data = '';
  try {
    data = await fsp.readFile(filePath, 'utf8');
  } catch(e) {}

  const exists = data.includes(`key="N${entries.id}"`) || data.includes(`key="T${entries.id}"`);
  if(exists){
    return;
  }

  const body = `${entries.NameDesc}\n \t\n \t${entries.TipDesc}`;
  const output = data && data.includes('</string_table>')
    ? data.replace('</string_table>', `${body}\n </string_table>`)
    : `<string_table>\n \t${body}\n</string_table>`;

  await fsp.writeFile(filePath, output, 'utf8');
}

async function checkCostumeStringAvailability(id, name){
  const files = [activeFilePaths.iteminfox7, activeFilePaths.iteminfoStringX7, activeFilePaths.iteminfoStringXML];
  const cleanName = escapeRegExp(name);

  for(const file of files){
    try {
      const data = await fsp.readFile(file, 'utf8');
      if(data.includes(`key="N${id}"`) || data.includes(`key="T${id}"`)){
        return false;
      }
      if(new RegExp(`eng="${cleanName}"|spa="${cleanName}"`, 'i').test(data)){
        return 'duplicateName';
      }
    } catch(e) {}
  }

  return true;
}

async function findAvailableCostumeIdS1(start, end, name){
  const data = await fsp.readFile(activeFilePaths.iteminfox7, 'utf8');
  const { category, subCategory } = itemS1.splitId(start);
  const used = new Set(itemS1.itemBlocks(data, category, subCategory).map(block => block.number));

  if(new RegExp(`NAME="${escapeRegExp(name)}"`).test(data)){
    return { duplicateName: true, id: start };
  }

  for(let id = start; id <= end; id++){
    if(used.has(id % 10000)) continue;

    const stringOk = await checkCostumeStringAvailability(id, name);
    if(stringOk === 'duplicateName'){
      return { duplicateName: true, id };
    }
    if(stringOk === true){
      return { id };
    }
  }

  return null;
}

async function findAvailableCostumeId(start, end, name){
  if(await getClientFormat() === 's1'){
    return findAvailableCostumeIdS1(start, end, name);
  }

  for(let id = start; id <= end; id++){
    const resItemX7 = await verifyItemX7(id, name);
    const resItemXML = await verifyItem_xml(id, name);
    const stringOk = await checkCostumeStringAvailability(id, name);

    if(Array.isArray(resItemX7) || Array.isArray(resItemXML) || stringOk === 'duplicateName'){
      return { duplicateName: true, id };
    }

    if(resItemX7 && resItemXML && stringOk === true){
      return { id };
    }
  }

  return null;
}

async function addCostumeItemToFiles(costume, sourceRoot){
  const [start, end] = id_range[costume.costumeType];
  const available = await findAvailableCostumeId(start, end, costume.displayName);

  if(!available){
    const src = getCostumePreviewSrc(sourceRoot, costume);
    procesados.push({ id: start, nombre: costume.displayName, status: 'NotAdded', src, evitar: false });
    return null;
  }

  if(available.duplicateName){
    const src = getCostumePreviewSrc(sourceRoot, costume);
    if(useDB && (costume.recolorCount || 0) > 0){
      const existingId = await findExistingItemIdByName(costume.displayName);
      const existsInDb = Number.isFinite(existingId)
        ? (dbRunIds ? dbRunIds.has(Number(existingId)) : await shopItemExists(existingId, dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db))
        : false;
      if(Number.isFinite(existingId) && existsInDb){
        await updateShopItemColors([{ id: existingId, colors: 1 + costume.recolorCount }], dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db);
        itemAdded = true;
      }
    }
    procesados.push({ id: available.id, nombre: costume.displayName, status: 'Skipped', src, evitar: false });
    return null;
  }

  const id = available.id;
  const anclaje = anclajesPet[claveAnclajeCostume(costume)] || null;
  const itemXml = makeCostumeItemx7(id, costume.icon, costume.displayName, costume.sex, costume.model, costume.folderType, {
    hidingOption: String(costume.folderType).toLowerCase().includes('hat') ? 'hair_all' : '',
    parts: costume.parts || [],
    nodeParent: anclaje ? anclaje.nodeParent : undefined,
    animationPart: anclaje ? anclaje.animationPart : undefined
  });
  const stringEntries = { id, ...buildCostumeStringEntries(id, costume.displayName) };

  if(await getClientFormat() === 's1'){
    await appendCostumeItemS1(activeFilePaths.iteminfox7, id, costume, anclaje);
  } else {
    await appendXmlItem(activeFilePaths.itemx7, itemXml);
    await appendXmlItem(activeFilePaths.itemxml, itemXml);
    await appendStringTable(activeFilePaths.iteminfox7, stringEntries);
  }

  await appendStringTable(activeFilePaths.iteminfoStringX7, stringEntries);
  await appendStringTable(activeFilePaths.iteminfoStringXML, stringEntries);

  if(useDB){
    const resAddDb = await addtodb(id, costume.displayName, dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db, dbRunIds, costume.costumeType, {
      kind: 'costume',
      clientFormat: await getClientFormat(),
      sex: costume.sex,
      recolorCount: costume.recolorCount || 0
    });

    if(resAddDb === 2){
      return null;
    }

    if(Array.isArray(resAddDb)){
      const src = getCostumePreviewSrc(sourceRoot, costume);
      procesados.push({ id, nombre: costume.displayName, status: 'NotAdded', src, evitar: false });
      return null;
    }

    itemAdded = true;
  }

  const src = getCostumePreviewSrc(sourceRoot, costume);
  procesados.push({ id, nombre: costume.displayName, status: 'Added', src, evitar: false });
  return id;
}

async function addLiveCostumeAssetsToArchive(archive, sourceRoot, costumes){
  const copied = [];

  for(const costume of costumes){
    const costumeRoot = costume.costumeRoot || path.join(sourceRoot, 'costumes');
    const imgSrc = path.join(costumeRoot, costume.folderType, costume.genderFolder, costume.imgFolder, costume.icon);
    const modelSrc = path.join(costumeRoot, costume.folderType, costume.genderFolder, 'model', costume.model);
    const externalImg = path.join(sourceRoot, 'image', 'costume', costume.resourcePart, costume.icon);
    const externalModel = path.join(sourceRoot, 'model', 'character', costume.resourcePart, costume.model);

    for(const iconAsset of costume.iconAssets?.length ? costume.iconAssets : [costume.icon]){
      const iconAssetSrc = path.join(costumeRoot, costume.folderType, costume.genderFolder, costume.imgFolder, iconAsset);
      if(!fs.existsSync(iconAssetSrc)) continue;

      const data = await fsp.readFile(iconAssetSrc);
      const resourceName = `resources/image/costume/${costume.resourcePart}/${iconAsset}`;
      const externalIconAsset = path.join(sourceRoot, 'image', 'costume', costume.resourcePart, iconAsset);
      upsertResourceData(archive, resourceName, data);
      await fsp.mkdir(path.dirname(externalIconAsset), { recursive: true });
      await fsp.writeFile(externalIconAsset, data);
      copied.push(resourceName);
    }

    if(fs.existsSync(modelSrc)){
      const data = await fsp.readFile(modelSrc);
      const resourceName = `resources/model/character/${costume.resourcePart}/${costume.model}`;
      upsertResourceData(archive, resourceName, data);
      await fsp.mkdir(path.dirname(externalModel), { recursive: true });
      await fsp.writeFile(externalModel, data);
      copied.push(resourceName);
    }

    for(const asset of [...(costume.parts || []), ...(costume.modelAssets || [])]){
      const assetSrc = path.join(costumeRoot, costume.folderType, costume.genderFolder, 'model', asset);
      if(!fs.existsSync(assetSrc)) continue;

      const data = await fsp.readFile(assetSrc);
      const resourceName = `resources/model/character/${costume.resourcePart}/${asset}`;
      const externalAsset = path.join(sourceRoot, 'model', 'character', costume.resourcePart, asset);
      upsertResourceData(archive, resourceName, data);
      await fsp.mkdir(path.dirname(externalAsset), { recursive: true });
      await fsp.writeFile(externalAsset, data);
      copied.push(resourceName);
    }
  }

  return copied;
}

ipcMain.handle('liveResourceAddItems', async (event, data = {}) => {
  let tempRoot = null;

  try {
    suppressResourceReload = true;
    const sourceRoot = data.sourcePath || weaponSourcePath;

    if(!sourceRoot){
      return { ok: false, error: 'Select weapon source folder first.' };
    }

    const resourcesRoot = getRequiredSourceResourcesRoot(sourceRoot);
    if(!resourcesRoot){
      return { ok: false, error: 'Source Folder must be the folder that contains resources, not resources itself.' };
    }

    const liveWeaponFiles = getDirectories(resourcesRoot).weapon;
    const archive = getResourceArchive(data.resourcePath);
    const prepared = await prepareLiveResourceXmlFiles(archive);
    tempRoot = prepared.tempRoot;
    skipWeaponsXml = data.useServerXbn === false;
    const sourceWeaponsXml = skipWeaponsXml
      ? null
      : await getLiveSourceWeaponsXml(resourcesRoot, tempRoot, data.serverXbnPath);
    activePreviewRoot = resourcesRoot;
    setActiveFilePaths(skipWeaponsXml ? { ...prepared.paths } : {
      ...prepared.paths,
      weaponxml: sourceWeaponsXml.path
    });

    procesados = [];
    itemAdded = false;
    sqlError = false;
    useDB = data.useDB !== false;

    await Ejecutar(iteminfoID, liveWeaponFiles, dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db);
    if(sourceWeaponsXml && sourceWeaponsXml.outputPath && sourceWeaponsXml.outputPath !== sourceWeaponsXml.path){
      await fsp.mkdir(path.dirname(sourceWeaponsXml.outputPath), { recursive: true });
      await fsp.copyFile(sourceWeaponsXml.path, sourceWeaponsXml.outputPath);
    }
    if(sourceWeaponsXml && sourceWeaponsXml.xbnPath){
      await convertXmlFileToXbn(sourceWeaponsXml.path, sourceWeaponsXml.xbnPath, { deleteSource: false });
    }
    await writeLiveResourceXmlFiles(archive, prepared);
    const copied = await addLiveWeaponAssetsToArchive(archive, resourcesRoot, liveWeaponFiles);
    resourceDecoder.saveContainer(archive, archive.resourceFile);
    resourceCache.dirty = false;

    const outputItems = await hydrateProcessedPreviewImages([...procesados]);

    return {
      ok: true,
      items: outputItems,
      copied: copied.length,
      count: archive.entries.length
    };
  } catch(e){
    return { ok: false, error: describeError(e, 'add weapons') };
  } finally {
    suppressResourceReload = false;
    skipWeaponsXml = false;
    resetActiveFilePaths();
    if(tempRoot){
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
});

function describeError(e, contexto){
  const stack = String(e && e.stack ? e.stack : e);
  console.error(`[${contexto}] ${stack}`);

  const lineas = stack.split(/\r?\n/);
  const origen = lineas.find(linea => /\bat .*\.(js|cjs):\d+/.test(linea) && !linea.includes("node:internal"));
  const donde = origen ? origen.trim().replace(/^at\s+/, "").replace(/^.*[\\/]/, "").replace(/\)$/, "") : "";
  const mensaje = e && e.message ? e.message : String(e);

  return donde ? `${mensaje} (${contexto} - ${donde})` : `${mensaje} (${contexto})`;
}

ipcMain.handle('liveResourceAddCostumes', async (event, data = {}) => {
  let tempRoot = null;

  try {
    suppressResourceReload = true;
    const sourceRoot = data.sourcePath || weaponSourcePath;

    if(!sourceRoot){
      return { ok: false, error: 'Select costumes source folder first.' };
    }

    const resourcesRoot = getRequiredSourceResourcesRoot(sourceRoot);
    if(!resourcesRoot){
      return { ok: false, error: 'Source Folder must be the folder that contains resources, not resources itself.' };
    }

    anclajesPet = data.anclajes || {};
    const costumes = collectLiveCostumeFiles(resourcesRoot);

    if(costumes.length === 0){
      return { ok: false, error: 'No costumes found. Source Folder must be the folder that contains resources. Expected: resources/costumes/<type>/<male|female|unisex>/imgs for icon and model for .scn/textures.' };
    }

    const archive = getResourceArchive(data.resourcePath);
    const prepared = await prepareLiveResourceXmlFiles(archive);
    tempRoot = prepared.tempRoot;
    activePreviewRoot = resourcesRoot;
    setActiveFilePaths(prepared.paths);

    procesados = [];
    itemAdded = false;
    sqlError = false;
    useDB = data.useDB !== false;

    if(useDB){
      const connectionTest = await testConnection(dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db);
      if(Array.isArray(connectionTest)){
        return { ok: false, error: connectionTest[1].error };
      }
      dbRunIds = await loadDbItemIds(dbConfig.host, dbConfig.user, dbConfig.pass, dbConfig.db);
    }

    for(const costume of costumes){
      await addCostumeItemToFiles(costume, resourcesRoot);
    }

    if(useDB && itemAdded){
      let connect;
      try {
        connect = await mysql.createConnection({
          host: dbConfig.host,
          user: dbConfig.user,
          password: dbConfig.pass,
          database: dbConfig.db
        });
        await connect.query("UPDATE shop_version SET Version = Version + 1");
      } finally {
        if(connect) await connect.end();
      }
    }

    await writeLiveResourceXmlFiles(archive, prepared);
    const copied = await addLiveCostumeAssetsToArchive(archive, resourcesRoot, costumes);
    resourceDecoder.saveContainer(archive, archive.resourceFile);
    resourceCache.dirty = false;

    return {
      ok: true,
      items: [...procesados],
      copied: copied.length,
      count: archive.entries.length
    };
  } catch(e){
    return { ok: false, error: describeError(e, 'add costumes') };
  } finally {
    suppressResourceReload = false;
    resetActiveFilePaths();
    dbRunIds = null;
    itemAdded = false;
    if(tempRoot){
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
});

ipcMain.handle('decryptSeqFile', async (event, seqPath) => {
  try {
    const seqPaths = Array.isArray(seqPath) ? seqPath : [seqPath].filter(Boolean);

    if(seqPaths.length === 0){
      return { ok: false, error: 'No .seq file selected.' };
    }

    const outputs = [];

    for(const currentSeqPath of seqPaths){
      if(!fs.existsSync(currentSeqPath)){
        return { ok: false, error: `.seq file not found: ${currentSeqPath}` };
      }

      const data = await fsp.readFile(currentSeqPath);
      const decodedData = decodeSeqForPreview(data);
      const outputName = path.basename(currentSeqPath, path.extname(currentSeqPath)) + '.txt';
      const outputPath = path.join(path.dirname(currentSeqPath), outputName);

      await fsp.writeFile(outputPath, previewSeq(decodedData), 'utf8');
      outputs.push(outputPath);
    }

    return {
      ok: true,
      output: outputs[0],
      outputs
    };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

function escapeXmlAttr(value){
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readXmlAttr(text, name){
  const match = text.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? escapeXmlAttr(match[1]) : '';
}

async function getSavedDbConfig(){
  const raw = await fsp.readFile(configPath, 'utf8');
  const config = JSON.parse(raw);

  return {
    host: config.host || 'localhost',
    user: config.user || '',
    pass: config.pass || '',
    database: config.database || config.db || '',
    shop_items: config.shop_items || 'shop_items',
    shop_iteminfos: config.shop_iteminfos || 'shop_iteminfos'
  };
}

function cleanDbIdentifier(value, fallback){
  const clean = String(value || fallback || '').trim();

  if(!/^[A-Za-z0-9_]+$/.test(clean)){
    throw new Error(`Invalid database identifier: ${clean}`);
  }

  return clean;
}

function quoteDbIdentifier(value){
  return '`' + cleanDbIdentifier(value).replace(/`/g, '``') + '`';
}

async function createDbPreviewConnection(){
  const config = await getSavedDbConfig();
  const connection = await mysql.createConnection({
    host: config.host,
    user: config.user,
    password: config.pass,
    database: config.database
  });

  return { connection, config };
}

function findFirstExisting(paths){
  return paths.find(candidate => fs.existsSync(candidate));
}

async function loadPathInitData(){
  try {
    const raw = await fsp.readFile(pathInitPath, 'utf8');
    return JSON.parse(raw);
  } catch(e) {}
  if(app.isPackaged){
    try {
      const raw = await fsp.readFile(path.join(__dirname, 'path.init'), 'utf8');
      return JSON.parse(raw);
    } catch(e) {}
  }
  return null;
}

function getSavedResourcePath(savedPaths){
  const resourcePath = savedPaths?.resourcePath || '';

  if(resourcePath && fs.existsSync(path.join(resourcePath, 'resource.s4hd'))){
    return resourcePath;
  }

  return false;
}

function getSavedLooseBase(savedPaths){
  const loose = savedPaths?.looseResourcePath || '';
  if(loose && fs.existsSync(loose)) return loose;
  const resourcePath = savedPaths?.resourcePath || '';
  if(resourcePath && fs.existsSync(path.join(resourcePath, 'extracted_resources'))) return resourcePath;
  return false;
}

async function copyPreviewItemFile(itemSource = 'resource', resourcePath = false, looseBase = false){
  const outputDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'dbinfo')
    : path.join(__dirname, 'dbinfo');
  const output = path.join(outputDir, 'item.x7');

  if(itemSource === 'resource'){
    try {
      const archive = getResourceArchive(resourcePath);
      const entry = findResourceEntry(archive, 'xml/item.x7') || findResourceEntry(archive, 'resources/xml/item.x7');

      if(entry){
        const decoded = getDecodedResourceData(archive, entry);
        await fsp.mkdir(outputDir, { recursive: true });
        await fsp.writeFile(output, decoded.data);
        return output;
      }
    } catch(e) {
      throw new Error(`item.x7 not found inside resource.s4hd: ${e.message}`);
    }
  }

  if(itemSource === 'folder' && looseBase){
    try {
      const archive = getResourceArchive(looseBase, { source: 'loose' });
      const entry = findResourceEntry(archive, 'xml/item.x7') || findResourceEntry(archive, 'resources/xml/item.x7');
      if(entry){
        const decoded = getDecodedResourceData(archive, entry);
        await fsp.mkdir(outputDir, { recursive: true });
        await fsp.writeFile(output, decoded.data);
        return output;
      }
    } catch(e) {
      console.warn('[DB PREVIEW] loose item.x7 skipped:', e.message);
    }
  }

  const input = findFirstExisting([
    path.join(__dirname, 'resources', 'xml', 'item.x7'),
    path.join(__dirname, 'extracted_resources', 'xml', 'item.x7'),
    path.join(__dirname, 'extracted_resources', 'resources', 'xml', 'item.x7')
  ]);

  if(!input){
    throw new Error('item.x7 not found in the selected extracted folder.');
  }

  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.copyFile(input, output);

  return output;
}

function parseDbPreviewStringTable(xml){
  const names = new Map();
  const stringRegex = /<string\b[^>]*key="([^"]+)"[^>]*\/?>/gi;
  let match;

  while((match = stringRegex.exec(xml)) !== null){
    const tag = match[0];
    const key = match[1];
    const value = readXmlAttr(tag, 'eng')
      || readXmlAttr(tag, 'ame')
      || readXmlAttr(tag, 'spa')
      || readXmlAttr(tag, 'ger');

    if(key && value){
      names.set(key.toUpperCase(), value);
    }
  }

  return names;
}

function hasHangul(value){
  return /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(String(value || ''));
}

async function loadDbPreviewStringNames(itemSource = 'resource', resourcePath = false, looseBase = false){
  const tryArchive = archive => {
    const entry = findResourceEntry(archive, 'language/xml/iteminfo_string_table.x7')
      || findResourceEntry(archive, 'language/xml/iteminfo_string_table.xml')
      || findResourceEntry(archive, 'resources/language/xml/iteminfo_string_table.x7')
      || findResourceEntry(archive, 'resources/language/xml/iteminfo_string_table.xml');
    if(!entry) return null;
    return parseDbPreviewStringTable(getDecodedResourceData(archive, entry).data.toString('utf8'));
  };

  if(itemSource === 'resource'){
    try {
      const names = tryArchive(getResourceArchive(resourcePath));
      if(names) return names;
    } catch(e) {
      console.warn('[DB PREVIEW] resource string table skipped:', e.message);
    }
  }

  if(itemSource === 'folder' && looseBase){
    try {
      const names = tryArchive(getResourceArchive(looseBase, { source: 'loose' }));
      if(names) return names;
    } catch(e) {
      console.warn('[DB PREVIEW] loose string table skipped:', e.message);
    }
  }

  const input = findFirstExisting([
    path.join(__dirname, 'resources', 'language', 'xml', 'iteminfo_string_table.x7'),
    path.join(__dirname, 'resources', 'language', 'xml', 'iteminfo_string_table.xml'),
    path.join(__dirname, 'extracted_resources', 'language', 'xml', 'iteminfo_string_table.x7'),
    path.join(__dirname, 'extracted_resources', 'language', 'xml', 'iteminfo_string_table.xml'),
    path.join(__dirname, 'extracted_resources', 'resources', 'language', 'xml', 'iteminfo_string_table.x7'),
    path.join(__dirname, 'extracted_resources', 'resources', 'language', 'xml', 'iteminfo_string_table.xml')
  ]);

  if(!input){
    return new Map();
  }

  return parseDbPreviewStringTable(await fsp.readFile(input, 'utf8'));
}

async function parseDbPreviewItems(itemPath, stringNames = new Map()){
  const xml = await fsp.readFile(itemPath, 'utf8');
  const itemRegex = /<item\b[^>]*item_key="([^"]+)"[^>]*>[\s\S]*?<\/item>/gi;
  const items = [];
  let match;

  while((match = itemRegex.exec(xml)) !== null){
    const block = match[0];
    const base = block.match(/<base\b[^>]*>/i)?.[0] || '';
    const graphic = block.match(/<graphic\b[^>]*>/i)?.[0] || '';
    const icon = readXmlAttr(graphic, 'icon_image');
    const nameKey = readXmlAttr(base, 'name_key');
    const baseName = readXmlAttr(base, 'name');
    const stringName = stringNames.get(String(nameKey || '').toUpperCase());
    const displayName = stringName
      || (!hasHangul(baseName) ? baseName : '')
      || nameKey
      || `Item ${match[1]}`;

    items.push({
      id: Number(match[1]),
      itemKey: match[1],
      name: displayName,
      baseName,
      nameKey,
      tipKey: readXmlAttr(base, 'attrib_comment_key'),
      sex: readXmlAttr(base, 'sex'),
      icon
    });
  }

  return items.filter(item => Number.isFinite(item.id));
}

function walkFilesSync(dir, files = []){
  if(!fs.existsSync(dir)){
    return files;
  }

  for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
    const fullPath = path.join(dir, entry.name);

    if(entry.isDirectory()){
      walkFilesSync(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function buildDbPreviewImageIndex(resourcePath = false, sourceHint = undefined){
  const index = new Map();
  const archivePaths = resourcePath ? [resourcePath] : [false];

  for(const archivePath of archivePaths){
    try {
      const archive = getResourceArchive(archivePath, sourceHint ? { source: sourceHint } : {});
      const imageEntries = archive.entries
        .filter(entry => /\.(png|jpg|jpeg|gif|bmp|webp|tga|dds)$/i.test(entry.fullName))
        .sort((a, b) => {
          const aName = a.fullName.replace(/\\/g, '/').toLowerCase();
          const bName = b.fullName.replace(/\\/g, '/').toLowerCase();
          const aImage = aName.startsWith('resources/image/');
          const bImage = bName.startsWith('resources/image/');

          if(aImage !== bImage){
            return aImage ? -1 : 1;
          }

          return aName.localeCompare(bName);
        });

      for(const entry of imageEntries){
        const cleanName = entry.fullName.replace(/\\/g, '/').toLowerCase();
        const ext = path.extname(entry.fullName).toLowerCase();

        if(!['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tga', '.dds'].includes(ext)){
          continue;
        }

        const key = path.basename(entry.fullName).toLowerCase();

        if(!index.has(key)){
          index.set(key, { type: 'resource', key, entry, archive });
        }
      }
    } catch(e) {}
  }

  const roots = [
    path.join(__dirname, 'resources', 'image'),
    path.join(__dirname, 'resources', 'images')
  ];

  for(const root of roots){
    for(const file of walkFilesSync(root)){
      const ext = path.extname(file).toLowerCase();

      if(!['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tga', '.dds'].includes(ext)){
        continue;
      }

      const key = path.basename(file).toLowerCase();

      if(!index.has(key)){
        index.set(key, { type: 'file', key, file });
      }
    }
  }

  return index;
}

function normalizeDbIconName(value){
  return path.basename(String(value || ''), path.extname(String(value || '')))
    .toLowerCase()
    .replace(/^(icon_|weapon_|item_)+/g, '')
    .replace(/(_icon|_weapon)$/g, '')
    .replace(/[0-9]/g, '')
    .replace(/[^a-z]+/g, '');
}

function findDbPreviewImage(icon, imageIndex){
  const base = path.basename(String(icon || '')).toLowerCase();
  const exact = imageIndex.get(base);

  if(exact){
    return exact;
  }

  const stem = base.replace(/\.[^.]+$/, '');
  if(!stem) return null;
  for(const found of imageIndex.values()){
    if(String(found.key).replace(/\.[^.]+$/, '') === stem){
      return found;
    }
  }

  return null;
}

function convertIconsParallel(jobs, onProgress){
  return new Promise(resolve => {
    if(!jobs.length) return resolve(new Map());
    const { Worker } = require('worker_threads');
    const os = require('os');
    const workerPath = path.join(__dirname, 'src', 'preview', 'iconWorker.js');
    const poolSize = Math.min(6, Math.max(2, os.cpus().length - 1), jobs.length);
    const results = new Map();
    let next = 0, done = 0;
    const workers = [];
    const finish = () => { workers.forEach(w => w.terminate()); resolve(results); };
    for(let i = 0; i < poolSize; i++){
      const w = new Worker(workerPath);
      workers.push(w);
      const feed = () => {
        if(next >= jobs.length) return;
        const job = jobs[next++];
        w.postMessage({ id: job.key, ext: job.ext, buf: job.buf });
      };
      w.on('message', msg => {
        results.set(msg.id, msg.url);
        done++;
        if(onProgress) onProgress(done, jobs.length);
        if(done === jobs.length) finish();
        else feed();
      });
      w.on('error', () => {
        done++;
        if(done === jobs.length) finish();
        else feed();
      });
      feed();
    }
  });
}

function getDbPreviewImageSrc(icon, imageIndex){
  if(!icon || icon === '-'){
    return '';
  }

  const found = findDbPreviewImage(icon, imageIndex);

  if(!found){
    return '';
  }

  let ext;
  let data = null;
  let file = null;

  if(found.type === 'resource'){
    ext = path.extname(found.entry.fullName).toLowerCase();
    data = resourceDecoder.decodeResource(found.entry, found.archive.resourceFolder).data;
  } else {
    file = found.file;
    ext = path.extname(file).toLowerCase();
  }

  if(ext === '.dds'){
    try {
      return ddsToPngDataUrl(data || fs.readFileSync(file));
    } catch(e) {
      return '';
    }
  }

  if(ext === '.tga'){
    try {
      return tgaToPngDataUrl(data || fs.readFileSync(file));
    } catch(e) {
      return '';
    }
  }

  if(found.type === 'resource'){
    const type = ext === '.jpg' ? 'jpeg' : ext.replace('.', '');
    return `data:image/${type};base64,${data.toString('base64')}`;
  }

  const relative = path.relative(__dirname, file).replace(/\\/g, '/');
  return relative;
}

async function getTableColumns(connection, table){
  const [rows] = await connection.query(`SHOW COLUMNS FROM ${quoteDbIdentifier(table)}`);
  return rows.map(row => ({
    field: row.Field,
    type: row.Type,
    key: row.Key,
    extra: row.Extra
  }));
}

function findColumn(columns, preferred){
  const preferredLower = preferred.toLowerCase();
  const found = columns.find(column => column.field.toLowerCase() === preferredLower);
  return found ? found.field : preferred;
}

async function getDbRowsByIds(connection, table, column, ids){
  const tableName = quoteDbIdentifier(table);
  const columnName = quoteDbIdentifier(column);
  const found = new Map();
  const chunkSize = 500;

  for(let i = 0; i < ids.length; i += chunkSize){
    const chunk = ids.slice(i, i + chunkSize);
    const [rows] = await connection.query(`SELECT * FROM ${tableName} WHERE ${columnName} IN (?)`, [chunk]);

    for(const row of rows){
      found.set(Number(row[column]), row);
    }
  }

  return found;
}

async function loadDbPreviewEffectGroups(connection){
  try {
    const table = 'shop_effect_groups';
    const columns = await getTableColumns(connection, table);
    const idColumn = findColumn(columns, 'Id');
    const nameColumn = findColumn(columns, 'Name');
    const effectColumn = findColumn(columns, 'Effect');
    const [rows] = await connection.query(
      `SELECT * FROM ${quoteDbIdentifier(table)} ORDER BY ${quoteDbIdentifier(idColumn)} ASC`
    );

    return rows.map(row => ({
      id: row[idColumn],
      name: row[nameColumn] ?? '',
      effect: row[effectColumn] ?? ''
    }));
  } catch(e){
    console.warn('[DB PREVIEW] shop_effect_groups skipped:', e.message);
    return [];
  }
}

async function loadDbPreviewPriceGroups(connection){
  try {
    const table = 'shop_price_groups';
    const columns = await getTableColumns(connection, table);
    const idColumn = findColumn(columns, 'Id');
    const nameColumn = findColumn(columns, 'Name');
    const priceTypeColumn = findColumn(columns, 'PriceType');
    const [rows] = await connection.query(
      `SELECT * FROM ${quoteDbIdentifier(table)} ORDER BY ${quoteDbIdentifier(idColumn)} ASC`
    );

    return rows.map(row => ({
      id: row[idColumn],
      name: row[nameColumn] ?? '',
      priceType: row[priceTypeColumn] ?? ''
    }));
  } catch(e){
    console.warn('[DB PREVIEW] shop_price_groups skipped:', e.message);
    return [];
  }
}

function buildDbPreviewFilters(items){
  const values = {
    mainTabs: new Set(),
    subTabs: new Set(),
    subTabsByMain: new Map(),
    colors: new Set(),
    priceGroups: new Set(),
    effectGroups: new Set(),
    types: new Set()
  };

  for(const item of items){
    if(item.shopItem){
      if(item.shopItem.MainTab !== undefined && item.shopItem.MainTab !== null) values.mainTabs.add(item.shopItem.MainTab);
      if(item.shopItem.SubTab !== undefined && item.shopItem.SubTab !== null){
        values.subTabs.add(item.shopItem.SubTab);
        const mainKey = String(item.shopItem.MainTab ?? '');
        if(!values.subTabsByMain.has(mainKey)){
          values.subTabsByMain.set(mainKey, new Set());
        }
        values.subTabsByMain.get(mainKey).add(item.shopItem.SubTab);
      }
      if(item.shopItem.Colors !== undefined && item.shopItem.Colors !== null) values.colors.add(item.shopItem.Colors);
    }

    if(item.shopItemInfo){
      if(item.shopItemInfo.PriceGroupId !== undefined && item.shopItemInfo.PriceGroupId !== null) values.priceGroups.add(item.shopItemInfo.PriceGroupId);
      if(item.shopItemInfo.EffectGroupId !== undefined && item.shopItemInfo.EffectGroupId !== null) values.effectGroups.add(item.shopItemInfo.EffectGroupId);
      if(item.shopItemInfo.Type !== undefined && item.shopItemInfo.Type !== null) values.types.add(item.shopItemInfo.Type);
    }
  }

  const sortNum = (a, b) => Number(a) - Number(b);
  const subTabsByMain = {};
  for(const [mainTab, subTabs] of values.subTabsByMain.entries()){
    subTabsByMain[mainTab] = [...subTabs].sort(sortNum);
  }

  return {
    mainTabs: [...values.mainTabs].sort(sortNum),
    subTabs: [...values.subTabs].sort(sortNum),
    subTabsByMain,
    colors: [...values.colors].sort(sortNum),
    priceGroups: [...values.priceGroups].sort(sortNum),
    effectGroups: [...values.effectGroups].sort(sortNum),
    types: [...values.types].sort(sortNum)
  };
}

function slimDbRow(row){
  if(!row){
    return null;
  }

  const output = {};

  for(const [key, value] of Object.entries(row)){
    if(value instanceof Date){
      output[key] = value.toISOString().slice(0, 19).replace('T', ' ');
    } else {
      output[key] = value;
    }
  }

  return output;
}

ipcMain.handle('dbPreviewLoad', async (event, data = {}) => {
  let connection;
  const progress = (pct, label) => { try { event.sender.send('dbPreviewProgress', { pct, label }); } catch(e) {} };

  try {
    progress(3, 'Connecting to DB...');
    const created = await createDbPreviewConnection();
    connection = created.connection;
    const config = created.config;
    const shopItemsTable = cleanDbIdentifier(config.shop_items, 'shop_items');
    const shopInfosTable = cleanDbIdentifier(config.shop_iteminfos, 'shop_iteminfos');
    const savedPaths = await loadPathInitData();
    const previewResourcePath = getSavedResourcePath(savedPaths);
    const previewLooseBase = getSavedLooseBase(savedPaths);
    const itemSource = data.itemSource === 'folder' ? 'folder' : 'resource';
    progress(10, 'Reading item.x7...');
    const itemPath = await copyPreviewItemFile(itemSource, previewResourcePath, previewLooseBase);
    progress(22, 'Loading item names...');
    const stringNames = await loadDbPreviewStringNames(itemSource, previewResourcePath, previewLooseBase);
    progress(32, 'Parsing items...');
    const parsedItems = await parseDbPreviewItems(itemPath, stringNames);
    progress(45, `Indexing images (${parsedItems.length} items)...`);
    const imageIndex = buildDbPreviewImageIndex(
      itemSource === 'resource' ? previewResourcePath : previewLooseBase,
      itemSource === 'folder' ? 'loose' : undefined
    );
    const ids = parsedItems.map(item => item.id);
    progress(55, 'Reading shop_items...');
    const shopItemsColumns = await getTableColumns(connection, shopItemsTable);
    const shopInfosColumns = await getTableColumns(connection, shopInfosTable);
    const shopItemsIdColumn = findColumn(shopItemsColumns, 'id');
    const shopInfosIdColumn = findColumn(shopInfosColumns, 'ShopItemId');
    const shopItemsRows = await getDbRowsByIds(connection, shopItemsTable, shopItemsIdColumn, ids);
    progress(68, 'Reading shop_iteminfos...');
    const shopInfosRows = await getDbRowsByIds(connection, shopInfosTable, shopInfosIdColumn, ids);
    const dbOnly = parsedItems.filter(item => shopItemsRows.has(item.id));
    parsedItems.length = 0;
    parsedItems.push(...dbOnly);
    progress(78, 'Loading effect and price groups...');
    const effectGroups = await loadDbPreviewEffectGroups(connection);
    const priceGroups = await loadDbPreviewPriceGroups(connection);

    const dbIcons = new Map();
    try {
      const [iconRows] = await connection.query('SELECT Id, Icons FROM shop_item_icons');
      for(const r of iconRows){
        try {
          const arr = r.Icons ? JSON.parse(r.Icons) : [];
          if(Array.isArray(arr) && arr.length && arr[0]) dbIcons.set(Number(r.Id), String(arr[0]));
        } catch(e) {}
      }
    } catch(e) {
      console.warn('[DB PREVIEW] shop_item_icons skipped:', e.message);
    }
    for(const item of parsedItems){
      const dbIcon = dbIcons.get(item.id);
      if(dbIcon) item.icon = dbIcon;
    }
    progress(86, 'Reading icon files...');

    const iconSrcCache = new Map();
    const jobs = [];
    {
      const uniqueIcons = [...new Set(parsedItems.map(item => String(item.icon || '')))];
      let scanned = 0;
      for(const key of uniqueIcons){
        scanned++;
        if(!key || key === '-'){ iconSrcCache.set(key, ''); continue; }
        try {
          const found = findDbPreviewImage(key, imageIndex);
          if(!found){ iconSrcCache.set(key, ''); continue; }
          let ext, data = null, file = null;
          if(found.type === 'resource'){
            ext = path.extname(found.entry.fullName).toLowerCase();
            data = getDecodedResourceData(found.archive, found.entry).data;
          } else {
            file = found.file;
            ext = path.extname(file).toLowerCase();
          }
          if(ext === '.dds' || ext === '.tga'){
            jobs.push({ key, ext, buf: data || fs.readFileSync(file) });
          } else if(found.type === 'resource'){
            const type = ext === '.jpg' ? 'jpeg' : ext.replace('.', '');
            iconSrcCache.set(key, `data:image/${type};base64,${data.toString('base64')}`);
          } else {
            iconSrcCache.set(key, path.relative(__dirname, file).replace(/\\/g, '/'));
          }
        } catch(e){ iconSrcCache.set(key, ''); }
        if(scanned % 200 === 0){
          progress(86 + Math.round(4 * scanned / uniqueIcons.length), `Reading icon files (${scanned}/${uniqueIcons.length})...`);
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    const converted = await convertIconsParallel(jobs, (done, total) => {
      if(done % 25 === 0 || done === total) progress(90 + Math.round(9 * done / total), `Converting icons (${done}/${total})...`);
    });
    for(const [key, url] of converted) iconSrcCache.set(key, url);

    const items = parsedItems.map(item => {
      const shopItem = shopItemsRows.get(item.id);
      const shopInfo = shopInfosRows.get(item.id);
      const inShop = !!(shopItem && shopInfo)
        && Number(shopInfo?.Type ?? 0) !== 0
        && Number(shopItem?.MainTab ?? 0) > 0
        && Number(shopItem?.SubTab ?? 0) > 0;
      return {
        ...item,
        status: inShop ? 'Available' : 'NotAvailable',
        imageSrc: iconSrcCache.get(String(item.icon || '')) || '',
        shopItem: slimDbRow(shopItem),
        shopItemInfo: slimDbRow(shopInfo)
      };
    });
    progress(100, 'Done');

    return {
      ok: true,
      itemPath,
      itemSource,
      itemSourceLabel: itemSource === 'resource' ? 'resource.s4hd' : 'extracted folder',
      tables: {
        shop_items: shopItemsTable,
        shop_iteminfos: shopInfosTable
      },
      columns: {
        shop_items: shopItemsColumns,
        shop_iteminfos: shopInfosColumns
      },
      count: items.length,
      available: items.filter(item => item.status === 'Available').length,
      filters: buildDbPreviewFilters(items),
      lookups: {
        effectGroups,
        priceGroups
      },
      items
    };
  } catch(e){
    return { ok: false, error: e.message };
  } finally {
    if(connection){
      await connection.end();
    }
  }
});

ipcMain.handle('dbPreviewUpdate', async (event, data) => {
  let connection;

  try {
    const created = await createDbPreviewConnection();
    connection = created.connection;
    const config = created.config;
    const tableKey = data.table === 'shop_iteminfos' ? 'shop_iteminfos' : 'shop_items';
    const table = cleanDbIdentifier(config[tableKey], tableKey);
    const columns = await getTableColumns(connection, table);
    const keyColumn = tableKey === 'shop_iteminfos'
      ? findColumn(columns, 'ShopItemId')
      : findColumn(columns, 'Id');
    const allowed = new Set(columns.map(column => column.field).filter(field => {
      const lower = field.toLowerCase();
      return lower !== 'id' && lower !== 'shopitemid';
    }));
    const values = {};

    for(const [key, value] of Object.entries(data.values || {})){
      if(allowed.has(key)){
        values[key] = value === '' ? null : value;
      }
    }

    const entries = Object.entries(values);

    if(entries.length === 0){
      return { ok: false, error: 'No editable values.' };
    }

    const setSql = entries.map(([key]) => `${quoteDbIdentifier(key)} = ?`).join(', ');
    const params = entries.map(([, value]) => value);
    params.push(data.id);

    await connection.beginTransaction();

    const [updateResult] = await connection.query(
      `UPDATE ${quoteDbIdentifier(table)} SET ${setSql} WHERE ${quoteDbIdentifier(keyColumn)} = ?`,
      params
    );

    if(updateResult.affectedRows === 0){
      await connection.rollback();
      return { ok: false, error: 'No DB row updated.' };
    }

    const [versionResult] = await connection.query(
      `UPDATE ${quoteDbIdentifier('shop_version')} SET ${quoteDbIdentifier('Version')} = ${quoteDbIdentifier('Version')} + 1`
    );

    if(versionResult.affectedRows === 0){
      await connection.rollback();
      return { ok: false, error: 'shop_version row not updated.' };
    }

    const [versionRows] = await connection.query(
      `SELECT ${quoteDbIdentifier('Version')} AS Version FROM ${quoteDbIdentifier('shop_version')} LIMIT 1`
    );

    await connection.commit();

    return {
      ok: true,
      version: versionRows[0]?.Version || null
    };
  } catch(e){
    if(connection){
      try {
        await connection.rollback();
      } catch(rollbackError) {
        console.error('Live DB rollback error:', rollbackError.message);
      }
    }
    return { ok: false, error: e.message };
  } finally {
    if(connection){
      await connection.end();
    }
  }
});

let shopGradeMaps = null;
async function loadShopGradeMaps(){
  if(shopGradeMaps) return shopGradeMaps;
  const maps = { byKey: new Map(), smallByGrade: { NORMAL: [], MAGIC: [], RARE: [], UNIQUE: [] } };
  try {
    let xml = null;
    const savedPaths = await loadPathInitData();
    const resourcePath = getSavedResourcePath(savedPaths);
    try {
      const archive = getResourceArchive(resourcePath);
      const entry = findResourceEntry(archive, 'xml/item_grade.x7');
      if(entry) xml = getDecodedResourceData(archive, entry).data.toString('utf8');
    } catch(e) {}
    if(!xml && resourcePath){
      const p = path.join(resourcePath, 'extracted_resources', 'xml', 'item_grade.x7');
      if(fs.existsSync(p)) xml = await fsp.readFile(p, 'utf8');
    }
    if(xml){
      for(const m of xml.matchAll(/<condition\s+effect_id="(\d+)"\s+item_grade="ITEM_GRADE_(\w+)"/g)){
        const key = Number(m[1]); const grade = m[2];
        maps.byKey.set(key, grade);
        if(maps.smallByGrade[grade] && key < 1000000 && !maps.smallByGrade[grade].includes(key)) maps.smallByGrade[grade].push(key);
      }
    }
  } catch(e) {}
  shopGradeMaps = maps;
  return maps;
}

ipcMain.handle('shopEditGet', async (event, data = {}) => {
  let connection;
  try {
    const itemNumber = Number(data.id);
    if(!itemNumber) return { ok: false, error: 'id required' };
    const created = await createDbPreviewConnection();
    connection = created.connection;
    const q = (sql, params) => connection.query(sql, params);

    const [siRows] = await q('SELECT * FROM shop_items WHERE Id = ? LIMIT 1', [itemNumber]);
    const si = siRows[0];
    if(!si) return { ok: false, error: 'item not in shop_items' };

    const [iiRows] = await q('SELECT * FROM shop_iteminfos WHERE ShopItemId = ? ORDER BY Id LIMIT 1', [itemNumber]);
    const ii = iiRows[0] || null;

    let priceType = 1, prices = [], effects = [], effectName = '';
    if(ii){
      const [pg] = await q('SELECT PriceType FROM shop_price_groups WHERE Id = ? LIMIT 1', [ii.PriceGroupId]);
      priceType = Number(pg[0]?.PriceType) || 1;
      const [pr] = await q('SELECT PeriodType, Period, Price, Durability FROM shop_prices WHERE PriceGroupId = ? ORDER BY Id', [ii.PriceGroupId]);
      prices = pr.map(p => ({ periodType: Number(p.PeriodType), period: Number(p.Period), price: Number(p.Price), durability: Number(p.Durability) }));
      const [eg] = await q('SELECT Name FROM shop_effect_groups WHERE Id = ? LIMIT 1', [ii.EffectGroupId]);
      effectName = eg[0]?.Name || '';
      const [ef] = await q('SELECT Effect FROM shop_effects WHERE EffectGroupId = ? AND Effect <> 0 ORDER BY Id', [ii.EffectGroupId]);
      effects = ef.map(e => Number(e.Effect));
    }

    const [catRows] = await q(
      `SELECT DISTINCT FLOOR(se.Effect/1000000) AS cat
         FROM shop_iteminfos ii2 JOIN shop_items s ON s.Id = ii2.ShopItemId
         JOIN shop_effects se ON se.EffectGroupId = ii2.EffectGroupId
        WHERE s.MainTab = ? AND s.SubTab = ? AND se.Effect >= 1000000`, [si.MainTab, si.SubTab]);
    const cats = new Set(catRows.map(r => Number(r.cat)).filter(Boolean));
    for(const e of effects) if(e >= 1000000) cats.add(Math.floor(e / 1000000));
    const [allEff] = await q("SELECT Effect AS value, Name AS label FROM shop_effect_groups WHERE Effect >= 1000000 AND Name <> ''");
    const byLabel = new Map();
    for(const o of allEff){
      const v = Number(o.value), label = String(o.label);
      const matches = cats.has(Math.floor(v / 1000000));
      const cur = byLabel.get(label);
      if(!cur || (matches && !cur.matches)) byLabel.set(label, { value: v, label, matches });
    }
    const effectOptions = [...byLabel.values()]
      .sort((a, b) => (b.matches - a.matches) || a.label.localeCompare(b.label))
      .map(o => ({ value: o.value, label: o.label }));

    let grade = 'AUTO';
    if(ii){
      const grades = await loadShopGradeMaps();
      const [egm] = await q('SELECT Effect FROM shop_effect_groups WHERE Id = ? LIMIT 1', [ii.EffectGroupId]);
      const key = Number(egm[0]?.Effect) || 0;
      grade = grades.byKey.get(key) || 'AUTO';
    }

    let active = Number(si.MainTab) > 0 && Number(si.SubTab) > 0;
    try {
      const [shownRows] = await q('SELECT 1 FROM shop_shown WHERE Id = ? LIMIT 1', [itemNumber]);
      active = shownRows.length > 0 && active;
    } catch(e) {}

    return {
      ok: true,
      itemNumber, mainTab: Number(si.MainTab), subTab: Number(si.SubTab),
      type: Number(ii?.Type ?? 1),
      colors: Number(si.Colors ?? 1), uniqueColors: Number(si.UniqueColors ?? 0),
      priceType, prices, effects, effectName, effectOptions, grade, active,
    };
  } catch(e){
    return { ok: false, error: e.message };
  } finally {
    if(connection) await connection.end();
  }
});

ipcMain.handle('shopEditSave', async (event, data = {}) => {
  let connection;
  try {
    const itemNumber = Number(data.id);
    if(!itemNumber) return { ok: false, error: 'id required' };
    const body = data.payload || {};
    const priceType = [1, 2, 3, 4, 5].includes(Number(body.priceType)) ? Number(body.priceType) : 1;
    const prices = Array.isArray(body.prices) ? body.prices : [];
    const effects = Array.isArray(body.effects) ? [...new Set(body.effects.map(Number).filter(Boolean))] : [];
    const effectName = String(body.effectName || '').slice(0, 100);
    const grade = String(body.grade || 'AUTO').toUpperCase();
    const grades = await loadShopGradeMaps();

    const created = await createDbPreviewConnection();
    connection = created.connection;
    const q = (sql, params) => connection.query(sql, params);
    await connection.beginTransaction();

    let [iiRows] = await q('SELECT * FROM shop_iteminfos WHERE ShopItemId = ? ORDER BY Id LIMIT 1', [itemNumber]);
    let ii = iiRows[0];
    if(!ii){
      const [pgIns] = await q('INSERT INTO shop_price_groups (Name, PriceType) VALUES (?, ?)', [('i' + itemNumber).slice(0, 20), priceType]);
      const [egRows] = await q('SELECT Id FROM shop_effect_groups ORDER BY Id LIMIT 1');
      const egId = egRows[0] ? Number(egRows[0].Id) : 0;
      const [cols] = await q('SHOW COLUMNS FROM shop_iteminfos');
      const columnas = new Set(cols.map(c => String(c.Field).toLowerCase()));
      const campos = ['ShopItemId', 'PriceGroupId', 'EffectGroupId', 'DiscountPercentage'];
      const valores = [itemNumber, pgIns.insertId, egId, 0];
      if(columnas.has('type')){ campos.push('Type'); valores.push(1); }
      if(columnas.has('isenabled')){ campos.push('IsEnabled'); valores.push(1); }
      const [ins] = await q(`INSERT INTO shop_iteminfos (${campos.join(", ")}) VALUES (${campos.map(() => "?").join(", ")})`, valores);
      ii = { Id: ins.insertId, PriceGroupId: pgIns.insertId, EffectGroupId: egId };
    }

    if(body.mainTab != null && body.subTab != null){
      const mt = Math.max(0, Number(body.mainTab) || 0);
      const st = Math.max(0, Number(body.subTab) || 0);
      await q('UPDATE shop_items SET MainTab = ?, SubTab = ? WHERE Id = ?', [mt, st, itemNumber]);
      try {
        if(mt > 0 && st > 0) await q('INSERT IGNORE INTO shop_shown (Id) VALUES (?)', [itemNumber]);
        else await q('DELETE FROM shop_shown WHERE Id = ?', [itemNumber]);
      } catch(e) {}
    }
    if(body.colors != null){
      await q('UPDATE shop_items SET Colors = ?, UniqueColors = ? WHERE Id = ?',
        [Math.max(0, Math.min(255, Number(body.colors) || 0)), Math.max(0, Math.min(255, Number(body.uniqueColors) || 0)), itemNumber]);
    }
    if(body.type != null){
      await q('UPDATE shop_iteminfos SET Type = ? WHERE Id = ?', [Math.max(0, Math.min(5, Number(body.type) || 0)), ii.Id]);
    }

    let priceGroupId = ii.PriceGroupId;
    const [pgN] = await q('SELECT COUNT(*) n FROM shop_iteminfos WHERE PriceGroupId = ?', [priceGroupId]);
    if(!priceGroupId || Number(pgN[0]?.n) > 1){
      const [ins] = await q('INSERT INTO shop_price_groups (Name, PriceType) VALUES (?, ?)', [(`i${itemNumber}`).slice(0, 20), priceType]);
      priceGroupId = ins.insertId;
      await q('UPDATE shop_iteminfos SET PriceGroupId = ? WHERE Id = ?', [priceGroupId, ii.Id]);
    } else {
      await q('UPDATE shop_price_groups SET PriceType = ? WHERE Id = ?', [priceType, priceGroupId]);
      await q('DELETE FROM shop_prices WHERE PriceGroupId = ?', [priceGroupId]);
    }
    for(const p of prices){
      await q('INSERT INTO shop_prices (PriceGroupId, PeriodType, Period, Price, IsRefundable, Durability, IsEnabled, Info) VALUES (?, ?, ?, ?, 0, ?, 1, "0")',
        [priceGroupId, Number(p.periodType) || 1, Number(p.period) || 0, Math.max(0, Number(p.price) || 0), Number(p.durability) || 0]);
    }

    let effectGroupId = ii.EffectGroupId;
    let mainEffect;
    if(['NORMAL', 'MAGIC', 'RARE', 'UNIQUE'].includes(grade)){
      const poolKeys = grades.smallByGrade[grade] || [];
      const [usedRows] = await q('SELECT Effect FROM shop_effect_groups WHERE Effect IN (?) AND Id <> ?', [poolKeys.length ? poolKeys : [0], effectGroupId || 0]);
      const used = new Set(usedRows.map(u => Number(u.Effect)));
      const [curRow] = await q('SELECT Effect FROM shop_effect_groups WHERE Id = ? LIMIT 1', [effectGroupId || 0]);
      const curKey = Number(curRow[0]?.Effect) || 0;
      mainEffect = (poolKeys.includes(curKey) && !used.has(curKey)) ? curKey : (poolKeys.find(k => !used.has(k)) ?? poolKeys[0] ?? (effects[0] || 0));
    } else {
      mainEffect = effects.length <= 1 ? (effects[0] || 0) : 0;
      if(effects.length > 1){
        const [mx] = await q('SELECT MAX(Effect) m FROM shop_effect_groups WHERE Effect BETWEEN 90000 AND 999999');
        mainEffect = Math.max(90000, Number(mx[0]?.m) || 0) + 1;
      }
    }
    const [egN] = await q('SELECT COUNT(*) n FROM shop_iteminfos WHERE EffectGroupId = ?', [effectGroupId]);
    if(!effectGroupId || Number(egN[0]?.n) > 1){
      const [ins] = await q('INSERT INTO shop_effect_groups (Name, Effect) VALUES (?, ?)', [effectName || `i${itemNumber}`, mainEffect]);
      effectGroupId = ins.insertId;
      await q('UPDATE shop_iteminfos SET EffectGroupId = ? WHERE Id = ?', [effectGroupId, ii.Id]);
    } else {
      await q('UPDATE shop_effect_groups SET Name = ?, Effect = ? WHERE Id = ?', [effectName || `i${itemNumber}`, mainEffect, effectGroupId]);
      await q('DELETE FROM shop_effects WHERE EffectGroupId = ?', [effectGroupId]);
    }
    if(effects.length === 0) await q('INSERT INTO shop_effects (EffectGroupId, Effect) VALUES (?, 0)', [effectGroupId]);
    else for(const e of effects) await q('INSERT INTO shop_effects (EffectGroupId, Effect) VALUES (?, ?)', [effectGroupId, e]);

    try {
      await q('UPDATE shop_version SET Version = Version + 1');
    } catch(e) {}

    await connection.commit();
    return { ok: true };
  } catch(e){
    if(connection){ try { await connection.rollback(); } catch(err) {} }
    return { ok: false, error: e.message };
  } finally {
    if(connection) await connection.end();
  }
});

ipcMain.handle('save-db-config', async (event, data) => {
  await fsp.writeFile(configPath, JSON.stringify(data, null, 2));
  
  dbConfig = {
    host: data.host,
    user: data.user,
    pass: data.pass,
    db: data.database,
    shop_items: data.shop_items || 'shop_items',
    shop_iteminfos: data.shop_iteminfos || 'shop_iteminfos'
  };

  return true;
});

ipcMain.handle('load-db-config', async () => {
  try {
    await fsp.access(configPath); 
    const raw = await fsp.readFile(configPath);
    const config = JSON.parse(raw);
    dbConfig = {
      host: config.host || dbConfig.host,
      user: config.user || dbConfig.user,
      pass: config.pass || dbConfig.pass,
      db: config.database || config.db || dbConfig.db,
      shop_items: config.shop_items || 'shop_items',
      shop_iteminfos: config.shop_iteminfos || 'shop_iteminfos'
    };
    return config;
  } catch (err) {
    return null; 
  }
});

ipcMain.handle('save-path-init', async (event, data = {}) => {
  const previos = await loadPathInitData() || {};
  const payload = {
    resourcePath: data.resourcePath || '',
    looseResourcePath: data.looseResourcePath || '',
    sourcePath: data.sourcePath || '',
    gameDataPath: data.gameDataPath || '',
    serverXbnPath: data.serverXbnPath || '',
    singleExtractPath: data.singleExtractPath || '',
    hookPath: data.hookPath !== undefined ? data.hookPath : (previos.hookPath || '')
  };

  await fsp.writeFile(pathInitPath, JSON.stringify(payload, null, 2), 'utf8');
  return true;
});

ipcMain.handle('load-path-init', async () => {
  return loadPathInitData();
});

async function deducirCarpetaHookUi(){
  const guardados = await loadPathInitData();
  if(!guardados) return '';

  const conS4hd = guardados.resourcePath || '';
  if(conS4hd && fs.existsSync(path.join(conS4hd, 'resource.s4hd'))) return conS4hd;

  const sueltos = guardados.looseResourcePath || '';
  if(sueltos){
    return /extracted_resources$/i.test(sueltos.replace(/[\\/]+$/, ''))
      ? path.dirname(sueltos)
      : sueltos;
  }

  return conS4hd || '';
}

async function cargarCarpetaHookUi(){
  const guardados = await loadPathInitData();
  const elegida = String(guardados?.hookPath || '').trim() || await deducirCarpetaHookUi();
  carpetaHookUi = elegida || UI_INSPECTOR_DIR_DEFECTO;
}

ipcMain.handle('uiInspectorFolder', async (event, data = {}) => {
  if(data.carpeta === undefined){
    return { ok: true, carpeta: carpetaHookUi, snapshotPath: rutaSnapshotUi() };
  }

  const escrita = String(data.carpeta || '').trim();
  carpetaHookUi = escrita || await deducirCarpetaHookUi() || UI_INSPECTOR_DIR_DEFECTO;

  const guardados = await loadPathInitData() || {};
  guardados.hookPath = escrita;
  await fsp.writeFile(pathInitPath, JSON.stringify(guardados, null, 2), 'utf8');

  return { ok: true, carpeta: carpetaHookUi, snapshotPath: rutaSnapshotUi() };
});

ipcMain.handle('uiInspectorLoad', async () => {
  try {
    const snapshot = await readUiInspectorSnapshot();
    return {
      ok: true,
      snapshotPath: rutaSnapshotUi(),
      commandPath: rutaComandoUi(),
      version: snapshot.version,
      tickAhora: snapshot.tickAhora || 0,
      nodes: snapshot.nodes,
      roots: snapshot.roots || [],
      state: snapshot.state || null,
      archivosXui: snapshot.archivosXui || [],
      rectOffset: snapshot.rectOffset
    };
  } catch(e){
    return {
      ok: false,
      error: e.message,
      snapshotPath: rutaSnapshotUi(),
      commandPath: rutaComandoUi()
    };
  }
});

ipcMain.handle('uiInspectorCommand', async (event, data = {}) => {
  const action = String(data.action || '').trim().toLowerCase();
  const address = parseUiInspectorAddress(data.address);

  if(!['show', 'hide', 'toggle', 'reset', 'reload', 'rect'].includes(action)){
    return { ok: false, error: 'Invalid action.' };
  }

  if(action === 'rect'){
    if(!address) return { ok: false, error: 'Invalid address.' };
    const n = valor => Math.trunc(Number(valor) || 0);
    const linea = `rect set ${address.replace(/^0x/i, '')} ${n(data.x)} ${n(data.y)} ${n(data.ancho)} ${n(data.alto)}\n`;
    try {
      await fsp.mkdir(carpetaHookUi, { recursive: true });
      await fsp.writeFile(rutaComandoUi(), linea, 'utf8');
      return { ok: true };
    } catch(e){
      return { ok: false, error: e.message };
    }
  }

  const rutaXui = String(data.rutaXui || '').trim().replace(/\\/g, '/');

  if(action === 'reload' && !/^[\w./ _-]+\.xui$/i.test(rutaXui)){
    return { ok: false, error: 'Invalid .xui path.' };
  }

  if(!['reset', 'reload'].includes(action) && !address){
    return { ok: false, error: 'Invalid address.' };
  }

  try {
    await fsp.mkdir(carpetaHookUi, { recursive: true });
    let line = 'reset\n';
    if(action === 'reload') line = `reload ${rutaXui}\n`;
    else if(action !== 'reset') line = `${action} ${address}\n`;
    await fsp.writeFile(rutaComandoUi(), line, 'utf8');
    return { ok: true };
  } catch(e){
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('openUiInspectorWindow', () => {
  createUiInspectorWindow();
  return { ok: true };
});

app.whenReady().then(async () => {
  await cargarCarpetaHookUi();

  const resourcesRoot = app.isPackaged
    ? path.join(app.getPath('userData'), 'resources')
    : path.join(__dirname, 'resources');

  ensureDefaultResourceDirectories(resourcesRoot);

  crearVentana();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      crearVentana();
    }
  });

  try {
    const configPath = path.join(app.getPath('userData'), 'dbconfig.json');
    const raw = await fsp.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);

    host = config.host || host;
    user = config.user || user;
    pass = config.pass || pass;
    db = config.database || db;

    dbConfig = {
      host,
      user,
      pass,
      db,
      shop_items: config.shop_items || 'shop_items',
      shop_iteminfos: config.shop_iteminfos || 'shop_iteminfos'
    };

  } catch (err) {
    console.warn('[CONFIG] Couldnt load default settings....');
  }
});

app.on('window-all-closed', () => {
	
		if(process.platform !== 'darwin'){
			app.quit();
		}
})

// ============================================================
//  Desempaquetado de clientes (Themida) con unlicense
// ============================================================
// El interprete y unlicense parcheado van embebidos en tools\unlicense\python,
// asi que no hace falta tener Python instalado.
//
// El unlicense de aca repara dos cosas que dejan al dump sin arrancar: los
// prologos que Themida roba (espiando lo que reescribe mientras desempaca) y
// la entrada de la tabla de inicializadores del CRT que apunta a codigo que
// movio fuera de .text. Ver "gane a themida.txt".

const UNPACK_PYTHON = () => {
  const base = app.isPackaged ? process.resourcesPath : __dirname;
  return path.join(base, 'tools', 'unlicense', 'python', 'python.exe');
};

ipcMain.handle('selectPackedExe', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Elegi el S4Client.exe EMPAQUETADO',
    filters: [{ name: 'Ejecutable', extensions: ['exe'] }],
    properties: ['openFile']
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('unpackClient', async (event, exePath) => {
  const python = UNPACK_PYTHON();
  if (!fs.existsSync(python)) {
    return { ok: false, error: 'Falta tools/unlicense/python/python.exe' };
  }
  if (!exePath || !fs.existsSync(exePath)) {
    return { ok: false, error: 'No encuentro el .exe' };
  }

  const dir = path.dirname(exePath);
  const name = path.basename(exePath);
  const salida = path.join(dir, 'unpacked_' + name);
  // unlicense escribe con colores de consola; en la interfaz solo estorban.
  const log = t => event.sender.send('unpackProgress',
    t.toString().replace(/\u001b\[[0-9;]*m/g, ''));

  // Otro cliente abierto hace que todo termine con exit 0 y parezca que fallo:
  // es el chequeo de instancia unica, no el dump.
  try {
    const corriendo = require('child_process')
      .execSync('tasklist /fi "imagename eq S4Client.exe" /nh', { encoding: 'utf8' });
    if (/S4Client\.exe/i.test(corriendo)) {
      log('AVISO: hay un S4Client.exe corriendo. Cerralo o el resultado no sirve.\n');
    }
  } catch (e) { /* tasklist no disponible, seguimos */ }

  // dx11.asi se carga tambien dentro del cliente EMPAQUETADO y lo rompe antes
  // de llegar al OEP. Fuera mientras dura, y se repone pase lo que pase.
  const asi = path.join(dir, 'dx11.asi');
  const guardado = asi + '.desempacando';
  const habiaAsi = fs.existsSync(asi);
  if (habiaAsi) { try { fs.renameSync(asi, guardado); } catch (e) { } }
  const reponerAsi = () => {
    if (habiaAsi && fs.existsSync(guardado)) {
      try { fs.renameSync(guardado, asi); } catch (e) { }
    }
  };

  log(`Unpacking ${name}`);

  return new Promise(resolve => {
    const p = spawn(python,
      ['-m', 'unlicense', '--target_version', '2', '--timeout', '180', name],
      { cwd: dir });

    p.stdout.on('data', log);
    p.stderr.on('data', log);

    // 'close' espera a que se cierren las tuberias, y unlicense lanza el cliente
    // del juego: si ese proceso sigue vivo las hereda y 'close' no llega nunca.
    // 'exit' avisa cuando termina unlicense, que es lo que nos importa.
    let terminado = false;
    const terminar = (r) => {
      if (terminado) return;
      terminado = true;
      reponerAsi();
      resolve(r);
    };

    p.on('error', err => terminar({ ok: false, error: err.message }));
    p.on('exit', () => {
      // el archivo se escribe justo antes de salir; un respiro por si acaso
      setTimeout(() => {
        terminar(fs.existsSync(salida)
          ? { ok: true, salida }
          : { ok: false, error: 'No dump was produced' });
      }, 400);
    });
  });
});
