const crypto = require('crypto');

function checksumHexToBigInt(hex){
  return BigInt.asIntN(64, BigInt('0x' + String(hex).replace(/^0x/i, '')));
}

function writeUInt64LE(buffer, value, offset){
  buffer.writeBigUInt64LE(BigInt(value), offset);
}

function normalizePackKey(value){
  const text = String(value || '').trim();
  if(/^[0-9a-f]{64}$/i.test(text)){
    return Buffer.from(text, 'hex');
  }
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}

function fnv64(buffer, seed = 0xcbf29ce484222325n){
  let hash = seed;
  for(const byte of buffer){
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash || 1n;
}

function packCipherTransform(data, key, context){
  const out = Buffer.from(data);
  const contextBytes = Buffer.from(String(context || ''), 'utf8');
  const seedBytes = Buffer.concat([key, contextBytes]);
  let s0 = fnv64(seedBytes, 0xcbf29ce484222325n);
  let s1 = fnv64(Buffer.concat([contextBytes, key]), 0x84222325cbf29cen);
  if(s0 === 0n) s0 = 1n;
  if(s1 === 0n) s1 = 0x9e3779b97f4a7c15n;

  let word = 0n;
  let remaining = 0;
  for(let i = 0; i < out.length; i++){
    if(remaining === 0){
      let x = s0;
      const y = s1;
      s0 = y;
      x = BigInt.asUintN(64, x ^ (x << 23n));
      s1 = BigInt.asUintN(64, x ^ y ^ (x >> 17n) ^ (y >> 26n));
      word = BigInt.asUintN(64, s1 + y);
      remaining = 8;
    }
    out[i] ^= Number(word & 0xffn);
    word >>= 8n;
    remaining--;
  }
  return out;
}

function normalizePackBaseName(value){
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '');
  return cleaned || 'resources';
}

function normalizePackExtension(value){
  let cleaned = String(value || '').trim();
  if(!cleaned){
    cleaned = '.s4pack';
  }
  if(!cleaned.startsWith('.')){
    cleaned = `.${cleaned}`;
  }
  cleaned = cleaned.replace(/[\\/:*?"<>|]/g, '');
  return cleaned || '.s4pack';
}

function getPackFileName(index, baseName = 'resources', extension = '.s4pack'){
  const safeBase = normalizePackBaseName(baseName);
  const safeExt = normalizePackExtension(extension);
  return index === 0
    ? `${safeBase}${safeExt}`
    : `${safeBase}${String(index).padStart(2, '0')}${safeExt}`;
}

function readHexBuffer(hexText, expectedBytes){
  const clean = String(hexText || '').trim();
  if(clean.length !== expectedBytes * 2 || /[^0-9a-f]/i.test(clean)){
    return null;
  }
  return Buffer.from(clean, 'hex');
}

function swapBlocksLikeDll(buffer){
  const blockSize = 16;
  const out = Buffer.from(buffer);
  const numBlocks = Math.floor(buffer.length / blockSize);

  for(let i = 0; i < numBlocks; i++){
    const base = i * blockSize;
    for(let j = 0; j < blockSize; j++){
      const group = Math.floor(j / 4);
      const groupIndex = j % 4;
      out[base + j] = buffer[base + groupIndex * 4 + group];
    }
  }

  return out;
}

function patchResourceHeaderForBootstrap(raw, keyBuf, ivBuf){
  if(!Buffer.isBuffer(raw) || raw.length <= 32 || !keyBuf || !ivBuf){
    return raw;
  }

  const stage = swapBlocksLikeDll(raw);
  const newSize = stage.length - 32;
  let keyOffset = 0;
  let ivOffset = 0;

  if(newSize >= 6){
    const blockSize = Math.floor(newSize / 3);
    keyOffset = blockSize;
    ivOffset = blockSize * 2 + 16;
  } else {
    keyOffset = 0;
    ivOffset = 16 + newSize;
  }

  if(keyOffset + 16 > stage.length || ivOffset + 16 > stage.length){
    return raw;
  }

  keyBuf.copy(stage, keyOffset);
  ivBuf.copy(stage, ivOffset);
  return swapBlocksLikeDll(stage);
}

module.exports = { checksumHexToBigInt,writeUInt64LE,normalizePackKey,fnv64,packCipherTransform,normalizePackBaseName,normalizePackExtension,getPackFileName,readHexBuffer,swapBlocksLikeDll,patchResourceHeaderForBootstrap };
