"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const lzo = require("lzo-decompress");
const crc32 = require("buffer-crc32");

const BLOCK_SIZE = 16;
const ENTRY_SIZE_EXPECTED = 272;
const COMPRESS_THRESHOLD = 1048576;
const X7_SIZE_XOR = 0xfe292513;
const CONTAINER_XOR_KEY = 0xcd4802ef >>> 0;
const KEY_SIZE = 40;
const CAPPED32_KEY_SIZE = 32;
const CAPPED32_LIMIT = 256;

const KEY_TABLE_HEX =
  "8253434c2b0d37d7d9d81b6da0c32bee45881aa6181d9d382a55031dcda67307ed8dc5dba3bdb6d5" +
  "34b5b23d7d438cc02125cdb65376ce5dd487ca8481cb5e04ba693e65de218a63627190870a522844" +
  "a349dcea09b701a4a111118e80355bdd38d54e360ca2bb0536572e98be883c284363a0e9e16d51cb" +
  "4d62844389c78983652953957cc0a10cdbd704d86ad1731d2167868da4a034bd3120610ee963b4c0" +
  "c7361b41239cd18c2553422e456d427b4e5beb2433745228c62ac31660a54535db9a5497e2ee9bde" +
  "e0c38441ed454c69d92855278e3a3c8e849714e65851260de29e667c0d017d174c08dd971c7bce5d" +
  "54377c0c8e277a782ee66d25626298202e2315617d975007207a042962906be9e622723856c9062e" +
  "3b47082d214207694a578b79e7562723248547747585a9eb10cb17854b5e2078d07d865e147e6450" +
  "69524abd8c9bd663bd26863295a4029b0114497888573a014abc50cd313971305b9c4d216782e85c" +
  "6610a97dd236e2b12820d5e7d50ed40c2c77800ea637be61add617651370ae403b52ee5384eb040d" +
  "498c77c0c064540b22bd82939a238de4c89db35044b1e29e157aa10c24e31e0a0a736aa58b3a5333" +
  "b0e6b75170dad629aa10b58a38374e7a3b747b63417c21655e26954475a374ddb4339e543c955e34" +
  "10194364782ba6607dcda928b8850e66c73c28dca14d609bc7d37493e6c3977612a4cbb92251b979" +
  "5c68dbe6595795cdaeca67b83790ba549895738e47c140ba802610aa6064d869c70d2b28a6ba014a" +
  "ee2865c49d418d916c917e80c3d1aeb692416613722026a1720529088830406d5a41017adb2ceec3" +
  "5c0338d895e7b467305121687889680be3b028b3a93818e45943c9527504150797140727dae5d9db" +
  "db0827a364dc42e33d0d26a2c35e3ea747e41c7313999ebad30873880301242e09bd3a6e3cb6a222" +
  "e727602085daea848641671c83be7a6167011830c637bc51bc78a15353589b3205676bc73a7ca8e5" +
  "7010298894c0ee8d5220d9c33cb3437483c8c5aa90580cd0bc2aed04058e27de9c37572a93631b9e" +
  "c352dbe9639a87186dbe1b376aea010201b57471a59a9a3a118b62d7b0060ca01009975aebea18b8";

const KEY_TABLE = (() => {
  const raw = Buffer.from(KEY_TABLE_HEX, "hex");
  const table = [[], []];
  for (let block = 0; block < 2; block++) {
    for (let index = 0; index < 10; index++) {
      const offset = block * 10 * KEY_SIZE + index * KEY_SIZE;
      table[block].push(raw.slice(offset, offset + KEY_SIZE));
    }
  }
  return table;
})();

const CAPPED32_KEY = KEY_TABLE[0][0];

const AES_KEY = Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
const AES_IV = Buffer.from("1234567890abcdef", "hex");

let lzoPack = null;

function getLzoPack() {
  if (!lzoPack) {
    lzoPack = { compress: require("lzo1x").lzo1xCompress };
  }

  return lzoPack;
}

function keyForLength(length) {
  const mixed = ((Math.trunc((length - 8) / 4) >>> 0) ^ CONTAINER_XOR_KEY) >>> 0;
  return KEY_TABLE[mixed % 2][mixed % 10];
}

function keyForBlock(length, blockIndex) {
  return KEY_TABLE[blockIndex][((((length >>> 0) ^ CONTAINER_XOR_KEY) >>> 0) % 10)];
}

function transform(buffer, key, limit, decrypt) {
  const out = Buffer.from(buffer);
  const length = limit > 0 ? Math.min(out.length, limit) : out.length;

  for (let i = 0; i < length; i++) {
    const x = out[i];
    if (decrypt) {
      out[i] = ((((x >> 1) & 0x7f) | ((x & 1) << 7)) ^ key[i % key.length]) & 0xff;
    } else {
      const y = x ^ key[i % key.length];
      out[i] = ((((y & 0x80) >> 7) & 1) | ((y << 1) & 0xfe)) & 0xff;
    }
  }

  return out;
}

function defaultDecrypt(buffer, lengthForKeySearch) {
  const key = keyForLength(lengthForKeySearch === undefined ? buffer.length : lengthForKeySearch);
  return transform(buffer, key.slice(0, KEY_SIZE), 0, true);
}

function defaultEncrypt(buffer, lengthForKeySearch) {
  const key = keyForLength(lengthForKeySearch === undefined ? buffer.length : lengthForKeySearch);
  return transform(buffer, key.slice(0, KEY_SIZE), 0, false);
}

function capped32Decrypt(buffer) {
  return transform(buffer, CAPPED32_KEY.slice(0, CAPPED32_KEY_SIZE), CAPPED32_LIMIT, true);
}

function capped32Encrypt(buffer) {
  return transform(buffer, CAPPED32_KEY.slice(0, CAPPED32_KEY_SIZE), CAPPED32_LIMIT, false);
}

function aesMaterial(length) {
  const key = defaultDecrypt(AES_KEY, length);
  const iv = defaultDecrypt(AES_IV, length);
  return { key, iv: Buffer.concat([iv, key.slice(0, 8)]) };
}

function ecbCipher(key) {
  const cipher = crypto.createCipheriv("aes-192-ecb", key, null);
  cipher.setAutoPadding(false);
  return cipher;
}

function aesDecrypt(buffer) {
  if (buffer.length === 0) {
    return Buffer.alloc(0);
  }

  const { key, iv } = aesMaterial(buffer.length);
  const blocks = Math.ceil(buffer.length / BLOCK_SIZE);
  const feed = Buffer.alloc(blocks * BLOCK_SIZE);
  iv.copy(feed, 0);
  buffer.copy(feed, BLOCK_SIZE, 0, (blocks - 1) * BLOCK_SIZE);

  const keystream = ecbCipher(key).update(feed);
  const out = Buffer.alloc(buffer.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = buffer[i] ^ keystream[i];
  }

  return out;
}

function aesEncrypt(buffer) {
  if (buffer.length === 0) {
    return Buffer.alloc(0);
  }

  const { key, iv } = aesMaterial(buffer.length);
  const cipher = ecbCipher(key);
  const out = Buffer.alloc(buffer.length);
  let feed = Buffer.from(iv);

  for (let offset = 0; offset < buffer.length; offset += BLOCK_SIZE) {
    const keystream = cipher.update(feed);
    const size = Math.min(BLOCK_SIZE, buffer.length - offset);
    for (let i = 0; i < size; i++) {
      out[offset + i] = buffer[offset + i] ^ keystream[i];
    }
    feed = Buffer.alloc(BLOCK_SIZE);
    out.copy(feed, 0, offset, offset + size);
  }

  return out;
}

function decryptContainer(raw) {
  return aesDecrypt(defaultDecrypt(Buffer.from(raw)));
}

function encryptContainer(plain) {
  return defaultEncrypt(aesEncrypt(Buffer.from(plain)));
}

function swapBytes(buffer) {
  const out = Buffer.from(buffer);
  const sizeCapped = Math.min(out.length, 128);

  for (let i = 0; i < Math.floor(sizeCapped / 2); i++) {
    const j = out.length - 1 - i;
    const tmp = out[j];
    out[j] = out[i];
    out[i] = tmp;
  }

  return out;
}

function crc32UInt(buffer) {
  return BigInt(crc32.unsigned(buffer));
}

function s4Crc(buffer, fullName) {
  const dataCrc = crc32UInt(buffer);
  const pathCrc = crc32UInt(Buffer.from(fullName, "ascii"));
  const finalCrc = BigInt.asUintN(64, dataCrc | (pathCrc << 32n));
  const tmp = Buffer.alloc(8);
  tmp.writeBigUInt64LE(finalCrc);
  return capped32Encrypt(tmp).readBigInt64LE();
}

function decryptX7(buffer) {
  const realSize = (buffer.readInt32LE(0) ^ X7_SIZE_XOR) | 0;
  const out = Buffer.alloc(Math.floor((buffer.length - 8) / 4));

  for (let i = 0; i < out.length; i++) {
    out[i] = buffer[i * 4 + 8];
  }

  return Buffer.from(lzo.decompress(out, realSize));
}

function encryptX7(buffer) {
  const realSize = buffer.length;
  const crc = Number(crc32UInt(buffer) ^ 0xbad0a4b3n) >>> 0;
  const compressed = Buffer.from(getLzoPack().compress(buffer));

  const key0 = keyForBlock(compressed.length, 0);
  const key1 = keyForBlock(compressed.length, 1);
  const encrypted1 = transform(compressed, key0, 0, false);
  const encrypted2 = transform(compressed, key1, 0, false);

  const out = Buffer.alloc(compressed.length * 4 + 8);
  out.writeInt32LE((realSize ^ X7_SIZE_XOR) | 0, 0);
  out.writeUInt32LE(crc, 4);

  for (let i = 0; i < compressed.length; i++) {
    const offset = 8 + i * 4;
    out[offset] = compressed[i];
    out[offset + 1] = encrypted1[i];
    out[offset + 2] = 0;
    out[offset + 3] = encrypted2[i];
  }

  return out;
}

function readCString(buffer, size) {
  const slice = buffer.slice(0, size);
  const nullPos = slice.indexOf(0);
  return slice.slice(0, nullPos === -1 ? slice.length : nullPos).toString("ascii");
}

function readEntry(entryBuffer) {
  const entry = capped32Decrypt(entryBuffer);

  return {
    fullName: readCString(entry, 256).toLowerCase(),
    checksum: entry.readBigInt64LE(256),
    length: entry.readInt32LE(264),
    unk: entry.readInt32LE(268),
    season1: true,
  };
}

function writeEntry(entry) {
  const data = Buffer.alloc(ENTRY_SIZE_EXPECTED);
  const text = Buffer.from(entry.fullName, "ascii");
  text.copy(data, 0, 0, Math.min(text.length, 255));
  data.writeBigInt64LE(BigInt.asIntN(64, entry.checksum), 256);
  data.writeInt32LE(entry.length, 264);
  data.writeInt32LE(entry.unk || 0, 268);
  return capped32Encrypt(data);
}

function checksumCandidates(checksum) {
  const hex = BigInt.asUintN(64, checksum).toString(16);
  const padded = hex.padStart(16, "0");
  return padded === hex ? [hex] : [hex, padded];
}

function findResourceFile(resourcesDir, checksum) {
  for (const candidate of checksumCandidates(checksum)) {
    const fullPath = path.join(resourcesDir, candidate);
    if (fs.existsSync(fullPath)) {
      return { fullPath, name: candidate };
    }
  }

  return null;
}

function parseDecrypted(decrypted) {
  if (decrypted.length < 12) {
    throw new Error("Header invalido (S1). Buffer demasiado pequeno.");
  }

  const version = decrypted.readInt32LE(0);
  const count = decrypted.readInt32LE(4);
  const firstSize = decrypted.readInt32LE(8);

  if (version !== 1 || count < 1 || firstSize !== ENTRY_SIZE_EXPECTED) {
    throw new Error(
      `Header invalido (S1). version=${version} count=${count} entrySize=${firstSize}`
    );
  }

  let offset = 8;
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (offset + 4 > decrypted.length) {
      throw new Error(`entry ${i}: no alcanza para leer entrySize`);
    }

    const entrySize = decrypted.readInt32LE(offset);
    offset += 4;

    if (entrySize <= 0 || offset + entrySize > decrypted.length) {
      throw new Error(`entry ${i}: tamano invalido ${entrySize}`);
    }

    const entry = readEntry(decrypted.slice(offset, offset + entrySize));
    entry.entrySize = entrySize;
    entries.push(entry);
    offset += entrySize;
  }

  return {
    version,
    count,
    firstName: entries.length ? entries[0].fullName : "",
    entries,
    containerMode: "s1",
    season1: true,
  };
}

function parseContainer(containerPath) {
  return parseDecrypted(decryptContainer(fs.readFileSync(containerPath)));
}

function isLuaOrX7(fullName) {
  const clean = fullName.toLowerCase();
  return clean.endsWith(".x7") || clean.endsWith(".lua");
}

function decodeResource(entry, resourcesDir) {
  const resource = findResourceFile(resourcesDir, entry.checksum);
  if (!resource) {
    throw new Error(`recurso faltante para checksum ${checksumCandidates(entry.checksum)[0]}`);
  }

  let data = swapBytes(fs.readFileSync(resource.fullPath));

  if (data.length < COMPRESS_THRESHOLD) {
    data = Buffer.from(lzo.decompress(data, entry.length));
  }

  data = capped32Decrypt(data);

  const cleanName = entry.fullName.toLowerCase();
  if (isLuaOrX7(cleanName)) {
    data = aesDecrypt(defaultDecrypt(data));
    if (cleanName.endsWith(".x7")) {
      data = decryptX7(data);
    }
  }

  return { data, resourceFile: resource.name };
}

function encodeResource(entry, data) {
  let output = Buffer.from(data);
  const cleanName = entry.fullName.toLowerCase();

  if (isLuaOrX7(cleanName)) {
    if (cleanName.endsWith(".x7")) {
      output = encryptX7(output);
    }
    output = defaultEncrypt(aesEncrypt(output));
  }

  entry.checksum = s4Crc(output, entry.fullName);
  entry.length = output.length;

  output = capped32Encrypt(output);
  if (output.length < COMPRESS_THRESHOLD) {
    output = Buffer.from(getLzoPack().compress(output));
  }

  return swapBytes(output);
}

function saveContainer(archive, containerPath) {
  const parts = [Buffer.alloc(8)];
  parts[0].writeInt32LE(archive.version || 1, 0);
  parts[0].writeInt32LE(archive.entries.length, 4);

  for (const entry of archive.entries) {
    const entryData = writeEntry(entry);
    const size = Buffer.alloc(4);
    size.writeInt32LE(entryData.length, 0);
    parts.push(size, entryData);
  }

  fs.writeFileSync(containerPath, encryptContainer(Buffer.concat(parts)));
  return null;
}

function setResourceData(archive, resourcesDir, fullName, data) {
  const cleanName = fullName.toLowerCase().replace(/\\/g, "/");
  const entry = archive.entries.find(item => item.fullName === cleanName);

  if (!entry) {
    throw new Error(`resource not found: ${cleanName}`);
  }

  const oldResource = findResourceFile(resourcesDir, entry.checksum);
  const encoded = encodeResource(entry, data);
  const outputPath = path.join(resourcesDir, checksumCandidates(entry.checksum)[0]);

  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(outputPath, encoded);

  return {
    entry,
    oldResource: oldResource ? oldResource.fullPath : null,
    newResource: outputPath,
  };
}

function createResource(archive, resourcesDir, fullName, data) {
  const cleanName = fullName.toLowerCase().replace(/\\/g, "/");

  if (archive.entries.some(item => item.fullName === cleanName)) {
    throw new Error(`resource already exists: ${cleanName}`);
  }

  archive.entries.push({
    fullName: cleanName,
    checksum: 0n,
    length: 0,
    unk: 0,
    entrySize: ENTRY_SIZE_EXPECTED,
    season1: true,
  });

  return setResourceData(archive, resourcesDir, cleanName, data);
}

function removeResource(archive, resourcesDir, fullName, deleteFromDisk = false) {
  const cleanName = fullName.toLowerCase().replace(/\\/g, "/");
  const index = archive.entries.findIndex(item => item.fullName === cleanName);

  if (index === -1) {
    throw new Error(`resource not found: ${cleanName}`);
  }

  const [entry] = archive.entries.splice(index, 1);
  const resource = findResourceFile(resourcesDir, entry.checksum);

  if (deleteFromDisk && resource && fs.existsSync(resource.fullPath)) {
    fs.unlinkSync(resource.fullPath);
  }

  return entry;
}

module.exports = {
  parseContainer,
  decodeResource,
  encodeResource,
  saveContainer,
  setResourceData,
  createResource,
  removeResource,
  checksumCandidates,
  decryptContainer,
  encryptContainer,
  decryptX7,
  encryptX7,
};

if (require.main === module) {
  const container = process.argv[2];
  if (!container) {
    console.error("uso: node s4zip_S1.cjs <resource.s4hd> [cuantos]");
    process.exit(1);
  }

  const archive = parseContainer(container);
  const limit = Number(process.argv[3] || 10);
  console.log(`version ${archive.version}, ${archive.count} entradas`);
  for (const entry of archive.entries.slice(0, limit)) {
    console.log(`  ${entry.fullName}  (${entry.length} bytes)`);
  }
}
