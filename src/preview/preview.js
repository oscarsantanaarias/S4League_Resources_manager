const path = require('path');
const resourceDecoder = require('../../s4zip/s4zip.cjs');
const { parseScn } = require('../engine/scn_geometry');

function isTextResource(fullName){
  return /\.(txt|xml|x7|ini|lua|csv|json|log|cfg)$/i.test(fullName);
}

function isImageResource(fullName){
  return /\.(png|jpg|jpeg|gif|bmp|webp|dds|tga)$/i.test(fullName);
}

function isScnResource(fullName){
  return /\.scn$/i.test(fullName);
}

function isSeqResource(fullName){
  return /\.seq$/i.test(fullName);
}

function isOctResource(fullName){
  return /\.oct$/i.test(fullName);
}

function isNavmeshResource(fullName){
  return /\.navmesh$/i.test(fullName);
}

function isFontResource(fullName){
  return /\.(ttf|otf|ttc)$/i.test(fullName);
}

function isXemResource(fullName){
  return /\.xem$/i.test(fullName);
}

function isPeBuffer(buffer){
  if(!buffer || buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ'){
    return false;
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  return peOffset > 0 && peOffset + 4 <= buffer.length && buffer.toString('ascii', peOffset, peOffset + 4) === 'PE\0\0';
}

function readCStringBuffer(buffer, offset, maxLength = 512){
  let end = offset;

  while(end < buffer.length && end - offset < maxLength && buffer[end] !== 0){
    end++;
  }

  return buffer.toString('ascii', offset, end);
}

function rvaToOffset(sections, rva){
  const section = sections.find(item => rva >= item.virtualAddress && rva < item.virtualAddress + Math.max(item.virtualSize, item.rawSize));

  if(!section){
    return null;
  }

  return section.rawPointer + (rva - section.virtualAddress);
}

function parsePeInfo(buffer){
  if(!isPeBuffer(buffer)){
    return null;
  }

  const peOffset = buffer.readUInt32LE(0x3c);
  const machine = buffer.readUInt16LE(peOffset + 4);
  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const timeDateStamp = buffer.readUInt32LE(peOffset + 8);
  const optionalSize = buffer.readUInt16LE(peOffset + 20);
  const optionalOffset = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalOffset);
  const is64 = magic === 0x20b;
  const imageBase = is64 ? buffer.readBigUInt64LE(optionalOffset + 24).toString(16) : buffer.readUInt32LE(optionalOffset + 28).toString(16);
  const entryPoint = buffer.readUInt32LE(optionalOffset + 16);
  const imageSize = buffer.readUInt32LE(optionalOffset + 56);
  const dataDirectoryOffset = optionalOffset + (is64 ? 112 : 96);
  const importRva = buffer.readUInt32LE(dataDirectoryOffset + 8);
  const importSize = buffer.readUInt32LE(dataDirectoryOffset + 12);
  const sectionOffset = optionalOffset + optionalSize;
  const sections = [];

  for(let i = 0; i < sectionCount; i++){
    const offset = sectionOffset + (i * 40);

    if(offset + 40 > buffer.length){
      break;
    }

    sections.push({
      name: buffer.toString('ascii', offset, offset + 8).replace(/\0/g, ''),
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawPointer: buffer.readUInt32LE(offset + 20),
      characteristics: buffer.readUInt32LE(offset + 36)
    });
  }

  const imports = [];
  const importOffset = importRva ? rvaToOffset(sections, importRva) : null;

  if(importOffset !== null){
    for(let offset = importOffset; offset + 20 <= buffer.length && imports.length < 80; offset += 20){
      const nameRva = buffer.readUInt32LE(offset + 12);

      if(nameRva === 0){
        break;
      }

      const nameOffset = rvaToOffset(sections, nameRva);

      if(nameOffset === null || nameOffset >= buffer.length){
        continue;
      }

      const name = readCStringBuffer(buffer, nameOffset, 256);
      if(name){
        imports.push(name);
      }
    }
  }

  return {
    is64,
    machine,
    sectionCount,
    timeDateStamp,
    imageBase,
    entryPoint,
    imageSize,
    importSize,
    sections,
    imports
  };
}

function previewPeModule(buffer, fullName){
  const info = parsePeInfo(buffer);

  if(!info){
    return null;
  }

  const meaningfulStrings = getAsciiStrings(buffer, 6)
    .filter(item => /[a-zA-Z]/.test(item.text))
    .filter(item => !/^[!-~]{6,12}$/.test(item.text) || /[._:\\/ -]/.test(item.text))
    .slice(0, 80);

  return [
    `PE module ${fullName}`,
    `Size: ${buffer.length} bytes`,
    `Arch: ${info.is64 ? 'x64' : 'x86'}  Machine: 0x${info.machine.toString(16)}`,
    `ImageBase: 0x${info.imageBase}  EntryPoint RVA: 0x${info.entryPoint.toString(16)}`,
    `ImageSize: ${info.imageSize} bytes`,
    '',
    `SECTIONS (${info.sections.length})`,
    ...info.sections.map(item => `${item.name.padEnd(8)} RVA 0x${item.virtualAddress.toString(16).padStart(8, '0')}  Raw ${item.rawSize} bytes  Virt ${item.virtualSize} bytes`),
    '',
    `IMPORTS (${info.imports.length})`,
    ...(info.imports.length ? info.imports : ['No readable import table. File may be packed/protected.']),
    '',
    `STRINGS (${meaningfulStrings.length} shown)`,
    ...(meaningfulStrings.length ? meaningfulStrings.map(item => `0x${item.offset.toString(16).padStart(8, '0')}  ${item.text}`) : ['No clean strings. File looks packed/protected.'])
  ].join('\n');
}


function getAsciiStrings(buffer, minLength = 3){
  const strings = [];
  let start = -1;

  for(let i = 0; i <= buffer.length; i++){
    const value = i < buffer.length ? buffer[i] : 0;
    const printable = value >= 0x20 && value <= 0x7e;

    if(printable){
      if(start === -1){
        start = i;
      }
      continue;
    }

    if(start !== -1){
      const end = i;
      if(end - start >= minLength){
        strings.push({
          offset: start,
          text: buffer.slice(start, end).toString('ascii')
        });
      }
      start = -1;
    }
  }

  return strings;
}

function readAsciiSafe(buffer, start, length){
  if(start < 0 || start + length > buffer.length){
    return '';
  }

  return buffer.toString('ascii', start, start + length).replace(/\0/g, '.');
}

function formatNumber(value){
  if(!Number.isFinite(value)){
    return String(value);
  }

  if(Math.abs(value) >= 1000){
    return value.toFixed(2);
  }

  if(Math.abs(value) >= 1){
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function isUsefulBinaryString(text){
  if(text.length < 3){
    return false;
  }

  if(!/[a-zA-Z]/.test(text)){
    return false;
  }

  return /^[a-zA-Z0-9_ .:\/\\\-@]+$/.test(text);
}

function getUsefulStrings(buffer, minLength = 3){
  const found = new Map();

  for(const item of getAsciiStrings(buffer, minLength).filter(item => isUsefulBinaryString(item.text))){
    const key = item.text.toLowerCase();

    if(found.has(key)){
      found.get(key).count++;
      continue;
    }

    found.set(key, {
      offset: item.offset,
      text: item.text,
      count: 1
    });
  }

  return [...found.values()];
}

function getFloatTriples(buffer, startOffset = 0, maxRows = 120){
  const rows = [];
  const start = Math.max(0, startOffset - (startOffset % 4));

  for(let offset = start; offset + 12 <= buffer.length && rows.length < maxRows; offset += 12){
    const x = buffer.readFloatLE(offset);
    const y = buffer.readFloatLE(offset + 4);
    const z = buffer.readFloatLE(offset + 8);

    if(!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)){
      continue;
    }

    if(Math.abs(x) > 1000000 || Math.abs(y) > 1000000 || Math.abs(z) > 1000000){
      continue;
    }

    if(Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001 && Math.abs(z) < 0.000001){
      continue;
    }

    rows.push({
      offset,
      x,
      y,
      z
    });
  }

  return rows;
}

function getUIntRows(buffer, startOffset = 0, maxRows = 80){
  const rows = [];
  const start = Math.max(0, startOffset - (startOffset % 4));

  for(let offset = start; offset + 4 <= buffer.length && rows.length < maxRows; offset += 4){
    const value = buffer.readUInt32LE(offset);

    if(value > 1000000){
      continue;
    }

    rows.push({
      offset,
      value
    });
  }

  return rows;
}

function formatStringsSection(strings){
  return strings.map(item => {
    const count = item.count > 1 ? `  x${item.count}` : '';
    return `0x${item.offset.toString(16).padStart(8, '0')}  ${item.text}${count}`;
  });
}

function formatFloatTriplesSection(triples){
  return triples.map(item => {
    return `0x${item.offset.toString(16).padStart(8, '0')}  ${formatNumber(item.x)}, ${formatNumber(item.y)}, ${formatNumber(item.z)}`;
  });
}

function formatUIntSection(rows){
  return rows.map(item => `0x${item.offset.toString(16).padStart(8, '0')}  ${item.value}`);
}

function previewOct(buffer){
  const strings = getUsefulStrings(buffer, 3);
  const octStrings = strings.filter(item => /^oct_/i.test(item.text));
  const triples = getFloatTriples(buffer, 0, 160);
  const uintRows = getUIntRows(buffer, 0, 120);

  const lines = [
    `OCT binary file ${buffer.length} bytes`,
    '',
    'TYPE',
    'Octree/collision data. Text below is decoded view; original file stays binary.',
    '',
    `OCT MATERIALS (${octStrings.length})`,
    ...formatStringsSection(octStrings),
    '',
    `STRINGS (${strings.length})`,
    ...formatStringsSection(strings),
    '',
    `FLOAT3 / COORDINATE SAMPLE (${triples.length})`,
    ...formatFloatTriplesSection(triples),
    '',
    `UINT32 SAMPLE (${uintRows.length})`,
    ...formatUIntSection(uintRows)
  ];

  return lines.join('\n');
}

function previewNavmesh(buffer){
  const magic = readAsciiSafe(buffer, 0, 4);
  const section = readAsciiSafe(buffer, 48, 4);
  const strings = getUsefulStrings(buffer, 3);
  const triples = getFloatTriples(buffer, 12, 180);
  const uintRows = getUIntRows(buffer, 0, 120);
  const headerLines = [];

  if(buffer.length >= 52){
    headerLines.push(`magic=${magic}`);
    headerLines.push(`version=${buffer.readUInt32LE(4)}`);
    headerLines.push(`flags=${buffer.readUInt32LE(8)}`);

    if(buffer.length >= 36){
      headerLines.push(`boundsMin=${formatNumber(buffer.readFloatLE(12))}, ${formatNumber(buffer.readFloatLE(16))}, ${formatNumber(buffer.readFloatLE(20))}`);
      headerLines.push(`boundsMax=${formatNumber(buffer.readFloatLE(24))}, ${formatNumber(buffer.readFloatLE(28))}, ${formatNumber(buffer.readFloatLE(32))}`);
    }

    headerLines.push(`section@0x00000030=${section}`);
  }

  const lines = [
    `NAVMESH binary file ${buffer.length} bytes`,
    '',
    'TYPE',
    'AI navigation mesh data. Text below is decoded view; original file stays binary.',
    '',
    'HEADER',
    ...headerLines,
    '',
    `STRINGS (${strings.length})`,
    ...formatStringsSection(strings),
    '',
    `FLOAT3 / COORDINATE SAMPLE (${triples.length})`,
    ...formatFloatTriplesSection(triples),
    '',
    `UINT32 SAMPLE (${uintRows.length})`,
    ...formatUIntSection(uintRows)
  ];

  return lines.join('\n');
}

function readUInt16BE(buffer, offset){
  if(offset < 0 || offset + 2 > buffer.length){
    return 0;
  }

  return buffer.readUInt16BE(offset);
}

function readUInt32BE(buffer, offset){
  if(offset < 0 || offset + 4 > buffer.length){
    return 0;
  }

  return buffer.readUInt32BE(offset);
}

function readFontTag(buffer, offset){
  if(offset < 0 || offset + 4 > buffer.length){
    return '';
  }

  return buffer.toString('latin1', offset, offset + 4);
}

function decodeUtf16BE(buffer){
  const chars = [];

  for(let i = 0; i + 1 < buffer.length; i += 2){
    const code = buffer.readUInt16BE(i);
    if(code === 0){
      continue;
    }
    chars.push(String.fromCharCode(code));
  }

  return chars.join('');
}

function decodeFontString(buffer, platformId, encodingId){
  if(platformId === 0 || platformId === 3){
    return decodeUtf16BE(buffer);
  }

  return buffer.toString('latin1').replace(/\0/g, '');
}

function fontNameLabel(nameId){
  const labels = {
    0: 'Copyright',
    1: 'Family',
    2: 'Subfamily',
    3: 'Unique ID',
    4: 'Full name',
    5: 'Version',
    6: 'PostScript name',
    7: 'Trademark',
    8: 'Manufacturer',
    9: 'Designer',
    10: 'Description',
    11: 'Vendor URL',
    12: 'Designer URL',
    13: 'License',
    14: 'License URL',
    16: 'Preferred family',
    17: 'Preferred subfamily'
  };

  return labels[nameId] || `Name ${nameId}`;
}

function parseFontTables(buffer, fontOffset){
  if(fontOffset < 0 || fontOffset + 12 > buffer.length){
    return { sfnt: '', tables: [] };
  }

  const sfnt = readFontTag(buffer, fontOffset);
  const numTables = readUInt16BE(buffer, fontOffset + 4);
  const tables = [];
  let tableOffset = fontOffset + 12;

  for(let i = 0; i < numTables && tableOffset + 16 <= buffer.length; i++){
    const tag = readFontTag(buffer, tableOffset);
    const checksum = readUInt32BE(buffer, tableOffset + 4);
    const offset = readUInt32BE(buffer, tableOffset + 8);
    const length = readUInt32BE(buffer, tableOffset + 12);

    tables.push({ tag, checksum, offset, length });
    tableOffset += 16;
  }

  return { sfnt, tables };
}

function parseFontNames(buffer, tables){
  const nameTable = tables.find(table => table.tag === 'name');

  if(!nameTable || nameTable.offset + 6 > buffer.length){
    return [];
  }

  const start = nameTable.offset;
  const count = readUInt16BE(buffer, start + 2);
  const stringOffset = readUInt16BE(buffer, start + 4);
  const storageStart = start + stringOffset;
  const names = new Map();

  for(let i = 0; i < count; i++){
    const record = start + 6 + i * 12;

    if(record + 12 > buffer.length){
      break;
    }

    const platformId = readUInt16BE(buffer, record);
    const encodingId = readUInt16BE(buffer, record + 2);
    const languageId = readUInt16BE(buffer, record + 4);
    const nameId = readUInt16BE(buffer, record + 6);
    const length = readUInt16BE(buffer, record + 8);
    const offset = readUInt16BE(buffer, record + 10);
    const valueStart = storageStart + offset;

    if(valueStart + length > buffer.length){
      continue;
    }

    const value = decodeFontString(buffer.slice(valueStart, valueStart + length), platformId, encodingId).trim();

    if(!value){
      continue;
    }

    const key = `${nameId}:${value}`;
    if(names.has(key)){
      continue;
    }

    names.set(key, {
      nameId,
      label: fontNameLabel(nameId),
      value,
      platformId,
      encodingId,
      languageId
    });
  }

  return [...names.values()].sort((a, b) => a.nameId - b.nameId || a.value.localeCompare(b.value));
}

function getFontType(sfnt){
  if(sfnt === '\x00\x01\x00\x00'){
    return 'TrueType';
  }

  if(sfnt === 'OTTO'){
    return 'OpenType/CFF';
  }

  if(sfnt === 'true'){
    return 'Apple TrueType';
  }

  return sfnt.replace(/\0/g, '.');
}

function previewSingleFont(buffer, fontOffset, index){
  const parsed = parseFontTables(buffer, fontOffset);
  const names = parseFontNames(buffer, parsed.tables);
  const type = getFontType(parsed.sfnt);
  const lines = [
    `FONT ${index + 1}`,
    `offset=0x${fontOffset.toString(16).padStart(8, '0')}`,
    `type=${type}`,
    `tables=${parsed.tables.length}`,
    '',
    'NAMES',
    ...names.map(item => `${item.label}: ${item.value}`),
    '',
    'TABLES',
    ...parsed.tables.map(table => {
      return `${table.tag}  offset=0x${table.offset.toString(16).padStart(8, '0')}  length=${table.length}  checksum=0x${table.checksum.toString(16).padStart(8, '0')}`;
    })
  ];

  return lines.join('\n');
}

function previewFont(buffer, fullName){
  const magic = readFontTag(buffer, 0);
  const lines = [
    `FONT binary file ${buffer.length} bytes`,
    '',
    'TYPE',
    'Font data. Text below is decoded metadata; original file stays binary.',
    ''
  ];

  if(magic === 'ttcf'){
    const major = readUInt16BE(buffer, 4);
    const minor = readUInt16BE(buffer, 6);
    const count = readUInt32BE(buffer, 8);
    const offsets = [];

    for(let i = 0; i < count && 12 + i * 4 + 4 <= buffer.length; i++){
      offsets.push(readUInt32BE(buffer, 12 + i * 4));
    }

    lines.push('COLLECTION');
    lines.push(`format=TTC`);
    lines.push(`version=${major}.${minor}`);
    lines.push(`fonts=${offsets.length}`);

    for(let i = 0; i < offsets.length; i++){
      lines.push('');
      lines.push(previewSingleFont(buffer, offsets[i], i));
    }

    return lines.join('\n');
  }

  lines.push(previewSingleFont(buffer, 0, 0));
  return lines.join('\n');
}

function previewScn(buffer){
  const rawStrings = getAsciiStrings(buffer, 4).filter(item => isUsefulScnString(item.text));
  const found = new Map();

  for(const item of rawStrings){
    const cleanText = cleanScnDisplayString(item.text);
    const key = cleanText.toLowerCase();

    if(found.has(key)){
      found.get(key).count++;
      continue;
    }

    found.set(key, {
      offset: item.offset,
      text: cleanText,
      count: 1
    });
  }

  const strings = [...found.values()];
  const lines = [
    `Strings (${strings.length})`,
    ...strings.map(item => {
      const count = item.count > 1 ? `  ×${item.count}` : '';
      return `  ${item.text}${count}`;
    })
  ];

  return lines.join('\n');
}

function cleanScnDisplayString(text){
  return String(text || '')
    .replace(/^0x[0-9a-f]{4,}\s+(?:0x[0-9a-f]{4,}\s+)?/i, '')
    .trim();
}


function scnInfoOf(buffer){
  try {
    const { parseScn } = require('./src/engine/scn_geometry');
    const s = parseScn(buffer);
    let models = 0, anims = 0, keys = 0, verts = 0;
    for(const m of s.meshes){
      const ma = (m.anims || []).filter(a => a.morph && a.morph.length);
      if(!ma.length) continue;
      models++;
      for(const a of ma){ anims++; keys += a.morph.length; for(const k of a.morph) verts += k.verts.length; }
    }
    return {
      bytes: buffer.length, models: s.models.length, meshes: s.meshes.length,
      bones: s.bones.length, clips: s.animNames.length,
      morph: { models, anims, keys, verts },
    };
  } catch(e){ return null; }
}

function getScnTextureRefs(buffer){
  const textureExt = /\.(dds|tga|png|jpg|jpeg|bmp)$/i;
  const found = new Map();

  for(const item of getAsciiStrings(buffer, 4)){
    const text = cleanScnDisplayString(item.text).replace(/\\/g, '/').trim();
    if(!textureExt.test(text)){
      continue;
    }

    const fileName = path.posix.basename(text);
    const key = fileName.toLowerCase();

    if(found.has(key)){
      found.get(key).count++;
      continue;
    }

    found.set(key, {
      offset: item.offset,
      text,
      fileName,
      base: path.posix.basename(fileName, path.posix.extname(fileName)).toLowerCase(),
      ext: path.posix.extname(fileName).toLowerCase(),
      count: 1
    });
  }

  const refs = [...found.values()].sort((a, b) => a.offset - b.offset);
  return refs.filter((ref, index) => {
    const refName = ref.fileName.toLowerCase();
    return !refs.some((other, otherIndex) => {
      if(otherIndex === index){
        return false;
      }

      const otherName = other.fileName.toLowerCase();
      return otherName.length > refName.length && otherName.endsWith(refName);
    });
  });
}

function analyzeScnTextures(fullName, buffer, archive){
  const refs = getScnTextureRefs(buffer);
  const folder = path.posix.dirname(fullName.replace(/\\/g, '/'));
  const sameFolderImages = archive.entries
    .filter(entry => path.posix.dirname(entry.fullName.replace(/\\/g, '/')) === folder)
    .filter(entry => isImageResource(entry.fullName))
    .map(entry => {
      const name = path.posix.basename(entry.fullName);
      return {
        fullName: entry.fullName,
        name,
        base: path.posix.basename(name, path.posix.extname(name)).toLowerCase(),
        ext: path.posix.extname(name).toLowerCase()
      };
    });

  const imageByName = new Map(sameFolderImages.map(image => [image.name.toLowerCase(), image]));

  return refs.slice(0, 1).map(ref => {
    const exact = imageByName.get(ref.fileName.toLowerCase());
    const sameBase = sameFolderImages.filter(image => image.base === ref.base);

    return {
      texture: ref.fileName,
      offset: ref.offset,
      count: ref.count,
      exact: exact ? exact.name : null,
      alternatives: sameBase
        .filter(image => image.name.toLowerCase() !== ref.fileName.toLowerCase())
        .map(image => image.name),
      status: exact ? 'exact' : (sameBase.length ? 'same-base' : 'missing')
    };
  });
}

function patchScnTextureName(buffer, oldTexture, newTexture){
  const cleanOld = path.posix.basename(cleanScnDisplayString(oldTexture).replace(/\\/g, '/')).toLowerCase();
  const cleanNew = cleanScnDisplayString(newTexture).replace(/\\/g, '/').trim();

  if(!cleanOld){
    throw new Error('Old texture name is empty.');
  }

  if(!cleanNew || !/\.(dds|tga|png|jpg|jpeg|bmp)$/i.test(cleanNew)){
    throw new Error('New texture must include image extension: .dds, .tga, .png, .jpg, or .bmp.');
  }

  if(!/^[\x20-\x7e]+$/.test(cleanNew)){
    throw new Error('Texture name must be ASCII.');
  }

  const output = Buffer.from(buffer);
  let changed = 0;

  for(const ref of getScnTextureRefs(buffer)){
    if(ref.fileName.toLowerCase() !== cleanOld){
      continue;
    }

    const oldText = ref.text;
    const oldBytes = Buffer.from(oldText, 'ascii');
    const newText = cleanNew.includes('/')
      ? cleanNew
      : (oldText.includes('/') ? `${path.posix.dirname(oldText)}/${cleanNew}` : cleanNew);
    const newBytes = Buffer.from(newText, 'ascii');

    if(newBytes.length >= SCN_TEXTURE_SLOT_SIZE){
      throw new Error(`New texture name is too long for this SCN slot. Max ${SCN_TEXTURE_SLOT_SIZE - 1} chars, got ${newBytes.length}.`);
    }

    newBytes.copy(output, ref.offset);
    output.fill(0, ref.offset + newBytes.length, Math.min(output.length, ref.offset + SCN_TEXTURE_SLOT_SIZE));
    changed++;
  }

  if(changed === 0){
    throw new Error(`Texture not found in SCN: ${oldTexture}`);
  }

  return { buffer: output, changed };
}

function previewSeq(buffer){
  const rawStrings = getAsciiStrings(buffer, 4).filter(item => isUsefulSeqString(item.text));
  const found = new Map();

  for(const item of rawStrings){
    const cleanText = item.text.replace(/^d:\\s4\\bin\\work\\client\\/i, '').replace(/\\/g, '/');
    const key = cleanText.toLowerCase();

    if(found.has(key)){
      found.get(key).count++;
      continue;
    }

    found.set(key, {
      offset: item.offset,
      text: cleanText,
      count: 1
    });
  }

  const strings = [...found.values()];
  const lines = [
    `SEQ binary file ${buffer.length} bytes`,
    '',
    `STRINGS (${strings.length} useful / ${rawStrings.length} raw useful)`,
    ...strings.map(item => {
      const count = item.count > 1 ? `  x${item.count}` : '';
      return `0x${item.offset.toString(16).padStart(8, '0')}  ${item.text}${count}`;
    })
  ];

  return lines.join('\n');
}

function decodeSeqForPreview(buffer){
  const decoded = resourceDecoder.decodeStandaloneSeq(buffer);
  const rawUseful = getAsciiStrings(buffer, 4).filter(item => isUsefulSeqString(item.text)).length;
  const decodedUseful = getAsciiStrings(decoded, 4).filter(item => isUsefulSeqString(item.text)).length;

  return decodedUseful > rawUseful ? decoded : buffer;
}


function analyzeSeqStrings(buffer){
  const refs = getAsciiStrings(buffer, 4).filter(item => isUsefulSeqString(item.text));
  const byText = new Map();
  for(const item of refs){
    if(byText.has(item.text)){ byText.get(item.text).count++; continue; }
    byText.set(item.text, { text: item.text, display: item.text.replace(/\\/g, '/'), offset: item.offset, count: 1 });
  }
  return [...byText.values()].map(r => ({ ...r, maxLen: Buffer.byteLength(r.text, 'ascii') }));
}




function patchSeqString(buffer, oldText, newText){
  const oldRaw = String(oldText || '');
  const next = String(newText || '').trim();
  if(!oldRaw) throw new Error('Old string is empty.');
  if(!next) throw new Error('New string is empty.');
  if(!/^[\x20-\x7e]+$/.test(next)) throw new Error('New string must be ASCII.');

  const oldBytes = Buffer.from(oldRaw, 'ascii');
  const newBytes = Buffer.from(next, 'ascii');
  if(newBytes.length > oldBytes.length){
    throw new Error(`New string too long: max ${oldBytes.length} chars (offsets can't shift), got ${newBytes.length}. Use a shorter path/name.`);
  }

  const output = Buffer.from(buffer);
  let changed = 0;
  let from = 0;
  while(true){
    const at = output.indexOf(oldBytes, from);
    if(at < 0) break;
    from = at + 1;
    const prev = at > 0 ? output[at - 1] : 0;
    const after = at + oldBytes.length < output.length ? output[at + oldBytes.length] : 0;
    
    const boundedStart = prev < 0x20 || prev > 0x7e;
    const boundedEnd = after < 0x20 || after > 0x7e;
    if(!boundedStart || !boundedEnd) continue;
    newBytes.copy(output, at);
    output.fill(0, at + newBytes.length, at + oldBytes.length);
    changed++;
  }

  if(changed === 0) throw new Error(`String not found in SEQ: ${oldRaw}`);
  return { buffer: output, changed };
}



function detectTextEncoding(buffer){
  try { if(Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer)) return 'utf8'; } catch(e) {}
  return 'latin1';
}

function getDecodedTextPreview(fullName, buffer){
  if(isXemResource(fullName)){
    if(isPeBuffer(buffer)){
      return previewPeModule(buffer, fullName);
    }

    const text = buffer.toString('utf8');

    if(/^[\t\r\n -~]*$/.test(text) && text.trim().length > 0){
      return text;
    }

    const strings = getAsciiStrings(buffer, 3);
    if(strings.length > 0){
      return [
        `XEM file ${buffer.length} bytes`,
        '',
        `STRINGS (${strings.length})`,
        ...strings.map(item => `0x${item.offset.toString(16).padStart(8, '0')}  ${item.text}`)
      ].join('\n');
    }
  }

  if(isScnResource(fullName)){
    return previewScn(buffer);
  }

  if(isSeqResource(fullName)){
    return previewSeq(buffer);
  }

  if(isOctResource(fullName)){
    return previewOct(buffer);
  }

  if(isNavmeshResource(fullName)){
    return previewNavmesh(buffer);
  }

  if(isFontResource(fullName)){
    return previewFont(buffer, fullName);
  }

  if(isTextResource(fullName)){
    return buffer.toString(detectTextEncoding(buffer));
  }

  return null;
}

function isUsefulScnString(text){
  if(text.length < 4){
    return false;
  }

  if(/[?&{}[\]'"`|<>]/.test(text)){
    return false;
  }

  if(!/[a-zA-Z]/.test(text)){
    return false;
  }

  if(!/^[a-zA-Z0-9_ .\/\\\-]+$/.test(text)){
    return false;
  }

  if(/\.(scn|tga|png|dds|jpg|bmp|ani|lua|x7|xml)$/i.test(text)){
    return true;
  }

  if(/^(am)?(dummy|bone)[a-z0-9_ -]*$/i.test(text)){
    return true;
  }

  if(text.includes('_') && text.length >= 6){
    return true;
  }

  return false;
}

function isUsefulSeqString(text){
  if(text.length < 4){
    return false;
  }

  const clean = text.replace(/^d:\\s4\\bin\\work\\client\\/i, '').replace(/\\/g, '/');

  if(/[?{}[\]'"`|<>]/.test(clean)){
    return false;
  }

  if(!/[a-zA-Z]/.test(clean)){
    return false;
  }

  if(!/^[a-zA-Z0-9_ .:\/\\\-]+$/.test(clean)){
    return false;
  }

  if(/^CAct[A-Za-z0-9_]+$/.test(clean)){
    return true;
  }

  if(/\.(dds|tga|png|jpg|bmp|seq|ani|scn|lua|x7|xml)$/i.test(clean)){
    return true;
  }

  if(clean.includes('resources/') || clean.includes('effects/')){
    return true;
  }

  if(clean.includes('_') && clean.length >= 6){
    return true;
  }

  return false;
}



module.exports = { analyzeScnTextures,analyzeSeqStrings,cleanScnDisplayString,decodeFontString,decodeSeqForPreview,decodeUtf16BE,detectTextEncoding,fontNameLabel,formatFloatTriplesSection,formatNumber,formatStringsSection,formatUIntSection,getAsciiStrings,getDecodedTextPreview,getFloatTriples,getFontType,getScnTextureRefs,getUIntRows,getUsefulStrings,isFontResource,isImageResource,isNavmeshResource,isOctResource,isPeBuffer,isScnResource,isSeqResource,isTextResource,isUsefulBinaryString,isUsefulScnString,isUsefulSeqString,isXemResource,parseFontNames,parseFontTables,parsePeInfo,patchScnTextureName,patchSeqString,previewFont,previewNavmesh,previewOct,previewPeModule,previewScn,previewSeq,previewSingleFont,readAsciiSafe,readCStringBuffer,readFontTag,readUInt16BE,readUInt32BE,rvaToOffset,scnInfoOf };
