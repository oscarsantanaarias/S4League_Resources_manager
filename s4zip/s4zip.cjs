"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { KISA_SEED_CBC } = require("kisa-seed");
const lzo = require("lzo-decompress");
const crc32 = require("buffer-crc32");
const season1 = require("./s4zip_S1.cjs");

const BLOCK_SIZE = 16;
const OLD32_KEY_SIZE = 32;
const OLD32_LIMIT = 256;
const COMPRESS_THRESHOLD = 1024000;
const ENTRY_SIZE_EXPECTED = 272;
const X7_SIZE_XOR = 0xfe292513;
const CONTAINER_XOR_KEY = 0xcd4802ef >>> 0;
let lzoPack = null;

const KEY_TABLE_V1 = [
  0x82, 0x53, 0x43, 0x4c, 0x2b, 0x0d, 0x37, 0xd7,
  0xd9, 0xd8, 0x1b, 0x6d, 0xa0, 0xc3, 0x2b, 0xee,
  0x45, 0x88, 0x1a, 0xa6, 0x18, 0x1d, 0x9d, 0x38,
  0x2a, 0x55, 0x03, 0x1d, 0xcd, 0xa6, 0x73, 0x07,
  0xed, 0x8d, 0xc5, 0xdb, 0xa3, 0xbd, 0xb6, 0xd5,
];

const KEY_TABLE_V2 = [
  [
    [
      0xa1, 0x0c, 0x24, 0x7a, 0xe3, 0x8c, 0x77, 0xc0, 0x49, 0xc0,
      0x93, 0x9a, 0x23, 0x82, 0x8d, 0xc8, 0x9d, 0xb3, 0xe4, 0x50,
      0xb1, 0xe2, 0x9e, 0x44, 0x15, 0x54, 0x0b, 0x22, 0x64, 0xbd,
      0x8b, 0x3a, 0x53, 0xa5, 0x33, 0x0a, 0x0a, 0x73, 0x1e, 0x6a,
    ],
    [
      0x70, 0xb0, 0xb7, 0xe6, 0x51, 0x4e, 0xb5, 0x38, 0x8a, 0x37,
      0x10, 0xda, 0x29, 0xd6, 0xaa, 0x63, 0x7a, 0x74, 0x3b, 0x7b,
      0x9e, 0x74, 0xb4, 0xdd, 0x33, 0x5e, 0x41, 0x21, 0x7c, 0x65,
      0xa3, 0x26, 0x44, 0x95, 0x75, 0x34, 0x54, 0x95, 0x3c, 0x5e,
    ],
    [
      0x28, 0xa9, 0xb8, 0x0e, 0x85, 0xc7, 0x66, 0x3c, 0xdc, 0x28,
      0x19, 0x10, 0x43, 0x78, 0x64, 0xa6, 0x2b, 0x60, 0xcd, 0x7d,
      0x4d, 0xa1, 0x60, 0xc7, 0x9b, 0x76, 0x97, 0x12, 0xcb, 0xa4,
      0x22, 0xb9, 0x51, 0x79, 0xb9, 0x74, 0xd3, 0x93, 0xc3, 0xe6,
    ],
    [
      0x68, 0x5c, 0x59, 0xdb, 0xe6, 0xa6, 0x28, 0x4a, 0xba, 0x01,
      0xb8, 0x67, 0xba, 0x37, 0x90, 0xc1, 0x47, 0x80, 0x40, 0xba,
      0x95, 0x57, 0xca, 0xcd, 0xae, 0x69, 0xd8, 0x2b, 0xc7, 0x0d,
      0x98, 0x54, 0x8e, 0x95, 0x73, 0x10, 0x26, 0x64, 0xaa, 0x60,
    ],
    [
      0x66, 0xb6, 0x41, 0x92, 0x13, 0x6c, 0x41, 0x91, 0x8d, 0x91,
      0xd1, 0x7e, 0xc3, 0x80, 0xae, 0xc4, 0xee, 0x65, 0x28, 0x9d,
      0xee, 0x7a, 0x2c, 0xdb, 0xc3, 0xa1, 0x72, 0x26, 0x20, 0x72,
      0x41, 0x40, 0x5a, 0x6d, 0x01, 0x88, 0x05, 0x08, 0x29, 0x30,
    ],
    [
      0x14, 0x15, 0x97, 0x07, 0x07, 0x30, 0xe7, 0x67, 0x51, 0xb4,
      0x89, 0x21, 0x78, 0x68, 0x68, 0xe4, 0xa9, 0x18, 0x59, 0x38,
      0x75, 0x43, 0x52, 0x04, 0xc9, 0xd8, 0x5c, 0x38, 0x95, 0x03,
      0xd9, 0x27, 0xe5, 0xdb, 0xda, 0x28, 0x0b, 0xb0, 0xb3, 0xe3,
    ],
    [
      0xdc, 0xe3, 0x3d, 0x0d, 0x42, 0xa7, 0xe4, 0x1c, 0x73, 0x47,
      0xdb, 0x27, 0xa3, 0x64, 0x08, 0x26, 0xc3, 0x5e, 0x3e, 0xa2,
      0x6e, 0xb6, 0xa2, 0x22, 0x3c, 0x08, 0x88, 0x03, 0x01, 0x73,
      0x24, 0x09, 0xbd, 0x3a, 0x2e, 0x13, 0x9e, 0xba, 0xd3, 0x99,
    ],
    [
      0x30, 0x67, 0x01, 0x18, 0x61, 0x41, 0xea, 0x84, 0x86, 0xda,
      0x7a, 0x1c, 0x83, 0xbe, 0x67, 0x85, 0x27, 0x60, 0x20, 0xe7,
      0xbc, 0x37, 0xbc, 0x51, 0xc6, 0x6b, 0x32, 0x05, 0x67, 0x9b,
      0xe5, 0x3a, 0x7c, 0xa8, 0xc7, 0x58, 0xa1, 0x53, 0x53, 0x78,
    ],
    [
      0x8d, 0xc0, 0x52, 0x20, 0xee, 0xc8, 0x74, 0xc5, 0xaa, 0x83,
      0x0c, 0x90, 0xd0, 0xbc, 0x58, 0x63, 0x2a, 0x1b, 0x9e, 0x93,
      0x04, 0x2a, 0x05, 0x8e, 0xed, 0x9c, 0x27, 0x37, 0x57, 0xde,
      0x3c, 0xd9, 0xb3, 0x43, 0xc3, 0x29, 0x70, 0x88, 0x94, 0x10,
    ],
    [
      0xdb, 0xc3, 0xe9, 0x63, 0x52, 0xea, 0x5a, 0x18, 0xb8, 0xeb,
      0x6a, 0x1b, 0xea, 0x01, 0x37, 0x9a, 0xa5, 0x3a, 0x11, 0x9a,
      0xb5, 0x02, 0x74, 0x71, 0x01, 0x10, 0x0c, 0x09, 0x97, 0xa0,
      0xd7, 0x8b, 0xb0, 0x06, 0x62, 0x18, 0x9a, 0x6d, 0xbe, 0x87,
    ],
  ],
  [
    [
      0x69, 0x45, 0xd9, 0x28, 0x4c, 0x97, 0x8e, 0x14, 0xe6, 0x84,
      0x26, 0x58, 0x0d, 0xe2, 0x51, 0x84, 0xe0, 0x41, 0xed, 0xc3,
      0x7b, 0x97, 0xce, 0x5d, 0x1c, 0x7c, 0x9e, 0x0d, 0x01, 0x66,
      0x4c, 0x7d, 0x08, 0xdd, 0x17, 0x8e, 0x55, 0x3a, 0x3c, 0x27,
    ],
    [
      0x43, 0x25, 0xc0, 0x8c, 0x21, 0x34, 0x7d, 0xb2, 0xb5, 0x3d,
      0xcd, 0xce, 0x53, 0xb6, 0x76, 0x81, 0xba, 0x5e, 0xcb, 0x04,
      0x5d, 0x84, 0x87, 0xd4, 0xca, 0x69, 0x21, 0x65, 0x3e, 0xde,
      0x87, 0x44, 0x52, 0x0a, 0x28, 0x8a, 0x90, 0x62, 0x63, 0x71,
    ],
    [
      0x11, 0xb7, 0xa1, 0x01, 0xa4, 0x09, 0xa3, 0xea, 0x49, 0xdc,
      0x5b, 0x11, 0x35, 0x8e, 0x80, 0x36, 0xdd, 0x4e, 0x38, 0xd5,
      0x88, 0x57, 0xbe, 0x2e, 0x98, 0x36, 0x0c, 0x05, 0xa2, 0xbb,
      0xcb, 0xe9, 0x51, 0xe1, 0x6d, 0xa0, 0x3c, 0x63, 0x28, 0x43,
    ],
    [
      0xe9, 0x63, 0xc0, 0xb4, 0x0e, 0x89, 0x83, 0x29, 0x65, 0xc7,
      0x86, 0x8d, 0xa0, 0xa4, 0x67, 0x95, 0x7c, 0xa1, 0xc0, 0x53,
      0xdb, 0xd7, 0xd8, 0x04, 0x0c, 0x62, 0x84, 0x89, 0x43, 0x4d,
      0xd1, 0x73, 0x21, 0x1d, 0x6a, 0xbd, 0x31, 0x61, 0x20, 0x34,
    ],
    [
      0xdb, 0x35, 0x45, 0x9a, 0x54, 0x8c, 0xd1, 0x9c, 0x25, 0x53,
      0x16, 0xc3, 0x2a, 0x60, 0xa5, 0x5b, 0x4e, 0x7b, 0xeb, 0x24,
      0x1b, 0x36, 0xc7, 0x41, 0x23, 0x52, 0x74, 0x33, 0x28, 0xc6,
      0x45, 0x2e, 0x42, 0x6d, 0x42, 0xee, 0xe2, 0x97, 0x9b, 0xde,
    ],
    [
      0x37, 0x0d, 0xd7, 0xd8, 0xd9, 0x53, 0x82, 0x43, 0x2b, 0x4c,
      0x6d, 0x1b, 0xa0, 0x2b, 0xc3, 0x1d, 0x18, 0x9d, 0x2a, 0x38,
      0x45, 0xee, 0x88, 0xa6, 0x1a, 0x03, 0x55, 0x1d, 0xa6, 0xcd,
      0xa3, 0xdb, 0xbd, 0xd5, 0xb6, 0x07, 0x73, 0xed, 0xc5, 0x8d,
    ],
    [
      0x7e, 0x5e, 0x50, 0x14, 0x64, 0x08, 0x3b, 0x21, 0x47, 0x2d,
      0xe7, 0x8b, 0x27, 0x79, 0x56, 0x85, 0x23, 0x74, 0x24, 0x47,
      0x85, 0xcb, 0x5e, 0x17, 0x4b, 0xa9, 0x75, 0x10, 0x85, 0xeb,
      0xd0, 0x20, 0x86, 0x78, 0x7d, 0x69, 0x42, 0x57, 0x07, 0x4a,
    ],
    [
      0xe6, 0x27, 0x78, 0x2e, 0x7a, 0x90, 0x7a, 0x29, 0x62, 0x04,
      0x61, 0x20, 0x23, 0x15, 0x2e, 0x20, 0x7d, 0x50, 0x07, 0x97,
      0x98, 0x6d, 0x62, 0x62, 0x25, 0x8e, 0x54, 0x7c, 0x0c, 0x37,
      0x72, 0x6b, 0xe6, 0x22, 0xe9, 0x2e, 0x38, 0xc9, 0x06, 0x56,
    ],
    [
      0x57, 0x88, 0x01, 0x3a, 0x4a, 0x52, 0x69, 0xbd, 0x4a, 0x8c,
      0x01, 0x9b, 0x49, 0x14, 0x78, 0x32, 0x86, 0xa4, 0x95, 0x02,
      0x50, 0xbc, 0x31, 0xcd, 0x39, 0x30, 0x71, 0x9c, 0x5b, 0x4d,
      0x67, 0x21, 0xe8, 0x82, 0x5c, 0xd6, 0x9b, 0xbd, 0x63, 0x26,
    ],
    [
      0x61, 0xa6, 0xbe, 0x37, 0xad, 0x0e, 0xd5, 0xd5, 0xe7, 0xd4,
      0x28, 0x36, 0xb1, 0xe2, 0x20, 0x80, 0x0c, 0x77, 0x2c, 0x0e,
      0x7d, 0x66, 0xa9, 0x10, 0xd2, 0x13, 0xd6, 0x65, 0x17, 0x70,
      0x04, 0x53, 0xeb, 0x84, 0x0d, 0x52, 0xae, 0x3b, 0x40, 0xee,
    ],
  ],
];

const seedScheduleCache = new Map();

function getLzoPack() {
  if (!lzoPack) {
    lzoPack = { compress: require("lzo1x").lzo1xCompress };
  }

  return lzoPack;
}

function swapBlocks(buffer) {
  const out = Buffer.from(buffer);
  const numBlocks = Math.floor(buffer.length / BLOCK_SIZE);

  for (let i = 0; i < numBlocks; i++) {
    const block = buffer.slice(i * BLOCK_SIZE, i * BLOCK_SIZE + BLOCK_SIZE);
    for (let j = 0; j < BLOCK_SIZE; j++) {
      const group = Math.floor(j / 4);
      const groupIndex = j % 4;
      out[i * BLOCK_SIZE + j] = block[groupIndex * 4 + group];
    }
  }

  return out;
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

function extractKeys(buffer) {
  const newSize = buffer.length - 32;

  if (newSize >= 6) {
    const blockSize = Math.floor(newSize / 3);
    return {
      key: buffer.slice(blockSize, blockSize + 16),
      iv: buffer.slice(blockSize * 2 + 16, blockSize * 2 + 32),
      data: Buffer.concat([
        buffer.slice(0, blockSize),
        buffer.slice(blockSize + 16, blockSize * 2 + 16),
        buffer.slice(blockSize * 2 + 32),
      ]),
    };
  }

  return {
    key: buffer.slice(0, 16),
    data: buffer.slice(16, 16 + newSize),
    iv: buffer.slice(16 + newSize, 32 + newSize),
  };
}

function getVersion2Key(length, blockIndex = -1) {
  const num = Math.floor((length - 8) / 4) >>> 0;
  const mixed = (num ^ CONTAINER_XOR_KEY) >>> 0;
  const keyIndex = mixed % 10;

  if (blockIndex === -1) {
    blockIndex = mixed % 2;
  }

  return KEY_TABLE_V2[blockIndex][keyIndex];
}

function decryptOldCapped32InPlace(buffer) {
  const length = Math.min(buffer.length, OLD32_LIMIT);

  for (let i = 0; i < length; i++) {
    let x = buffer[i];
    x = ((x >> 1) & 0x7f) | ((x & 1) << 7);
    buffer[i] = x ^ KEY_TABLE_V1[i % OLD32_KEY_SIZE];
  }

  return buffer;
}

function encryptOldCapped32InPlace(buffer) {
  const length = Math.min(buffer.length, OLD32_LIMIT);

  for (let i = 0; i < length; i++) {
    const x = buffer[i] ^ KEY_TABLE_V1[i % OLD32_KEY_SIZE];
    buffer[i] = (((x & 0x7f) << 1) | ((x & 0x80) >> 7)) & 0xff;
  }

  return buffer;
}

function decryptVersion2(buffer) {
  const out = Buffer.from(buffer);
  const key = getVersion2Key(out.length);

  for (let i = 0; i < out.length; i++) {
    const x = out[i] ^ key[i % 40];
    out[i] = ((x >> 1) & 0x7f) | ((x & 1) << 7);
  }

  return out;
}

function version2TransformWithKey(buffer, blockIndex, keyIndex, decrypt) {
  const out = Buffer.from(buffer);
  const key = KEY_TABLE_V2[blockIndex][keyIndex];

  for (let i = 0; i < out.length; i++) {
    if (decrypt) {
      const x = out[i] ^ key[i % 40];
      out[i] = ((x >> 1) & 0x7f) | ((x & 1) << 7);
    } else {
      const x = out[i];
      out[i] = ((((x & 0x80) >> 7) & 1) | ((x << 1) & 0xfe)) ^ key[i % 40];
    }
  }

  return out;
}

function decryptVersion2WithKey(buffer, blockIndex, keyIndex) {
  return version2TransformWithKey(buffer, blockIndex, keyIndex, true);
}

function encryptVersion2WithKey(buffer, blockIndex, keyIndex) {
  return version2TransformWithKey(buffer, blockIndex, keyIndex, false);
}

function encryptVersion2(buffer, blockIndex = -1, lengthForKeySearch = -1) {
  const out = Buffer.from(buffer);
  const key = getVersion2Key(lengthForKeySearch === -1 ? out.length : lengthForKeySearch, blockIndex);

  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    out[i] = ((((x & 0x80) >> 7) & 1) | ((x << 1) & 0xfe)) ^ key[i % 40];
  }

  return out;
}

function getSeedSchedule(key) {
  const keyHex = Buffer.from(key).toString("hex");
  let seedKey = seedScheduleCache.get(keyHex);

  if (!seedKey) {
    const info = {
      ivec: new Array(4).fill(0),
      seed_key: { key_data: new Array(32).fill(0) },
      cbc_buffer: new Array(4).fill(0),
      buffer_length: 0,
      cbc_last_block: new Array(4).fill(0),
      last_block_flag: 0,
      encrypt: 0,
    };

    KISA_SEED_CBC.SEED_CBC_init(
      info,
      { value: 0 },
      Uint8Array.from(key),
      new Uint8Array(16)
    );

    seedKey = { key_data: [...info.seed_key.key_data] };
    seedScheduleCache.set(keyHex, seedKey);
  }

  return seedKey;
}

function seedEncryptBlock(counter, key) {
  const schedule = getSeedSchedule(key);
  const input = KISA_SEED_CBC.chartoint32_for_SEED_CBC(
    Uint8Array.from(counter),
    BLOCK_SIZE
  );
  const out = new Array(4).fill(0);

  KISA_SEED_CBC.KISA_SEED_Encrypt_Block_forCBC(input, 0, out, 0, schedule);
  return Buffer.from(KISA_SEED_CBC.int32tochar_for_SEED_CBC(out, BLOCK_SIZE));
}

function seedCtrTransform(data, key, iv) {
  const out = Buffer.alloc(data.length);
  const counter = Buffer.from(iv);

  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    const keystream = seedEncryptBlock(counter, key);
    const limit = Math.min(BLOCK_SIZE, data.length - offset);

    for (let i = 0; i < limit; i++) {
      out[offset + i] = data[offset + i] ^ keystream[i];
    }

    for (let i = counter.length - 1; i >= 0; i--) {
      counter[i] = (counter[i] + 1) & 0xff;
      if (counter[i] !== 0) {
        break;
      }
    }
  }

  return out;
}

function decryptSeed(buffer) {
  const swapped = swapBlocks(buffer);
  const { data, key, iv } = extractKeys(swapped);
  const stage2 = decryptVersion2(data);
  const stage3 = seedCtrTransform(stage2, key, iv);
  return swapBlocks(stage3);
}

function insertKeys(buffer, key, iv) {
  if (buffer.length >= 6) {
    const blockSize = Math.floor(buffer.length / 3);
    return Buffer.concat([
      buffer.slice(0, blockSize),
      key,
      buffer.slice(blockSize, blockSize * 2),
      iv,
      buffer.slice(blockSize * 2),
    ]);
  }

  return Buffer.concat([key, buffer, iv]);
}

function normalizeSeedKey(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value.slice(0, 16));
  }

  if (!value) {
    return crypto.randomBytes(16);
  }

  const text = String(value).trim();

  if (/^[0-9a-f]{32}$/i.test(text)) {
    return Buffer.from(text, "hex");
  }

  return crypto.createHash("sha256").update(text, "utf8").digest().slice(0, 16);
}

function normalizeLockIv(value) {
  const text = String(value || "").trim();
  return crypto.createHash("sha256").update("sneoz-lock-iv:" + text, "utf8").digest().slice(0, 16);
}

function encryptSeed(buffer, seedKey = null, seedIv = null) {
  const key = normalizeSeedKey(seedKey);
  const iv = seedIv ? normalizeSeedKey(seedIv) : crypto.randomBytes(16);
  const swapped = swapBlocks(buffer);
  const seeded = seedCtrTransform(swapped, key, iv);
  const encrypted = encryptVersion2(seeded);
  return swapBlocks(insertKeys(encrypted, key, iv));
}

function encryptSeedLockedDetailed(buffer, seedKey) {
  const key = normalizeSeedKey(seedKey);
  const iv = normalizeLockIv(seedKey);
  const decoyKey = crypto.randomBytes(16);
  const decoyIv = crypto.randomBytes(16);
  const swapped = swapBlocks(buffer);
  const seeded = seedCtrTransform(swapped, key, iv);
  const encrypted = encryptVersion2(seeded);
  return {
    output: swapBlocks(insertKeys(encrypted, decoyKey, decoyIv)),
    key,
    iv,
    decoyKey,
    decoyIv,
  };
}

function encryptSeedLocked(buffer, seedKey) {
  return encryptSeedLockedDetailed(buffer, seedKey).output;
}

function decryptX7(buffer) {
  const realSize = (buffer.readInt32LE(0) ^ X7_SIZE_XOR) | 0;
  const out = Buffer.alloc(Math.floor((buffer.length - 8) / 4));

  for (let i = 0; i < out.length; i++) {
    out[i] = buffer[i * 4 + 8];
  }

  return Buffer.from(lzo.decompress(out, realSize));
}

function crc32UInt(buffer) {
  return BigInt(crc32.unsigned(buffer));
}

function x7Crc(buffer) {
  return Number(crc32UInt(buffer) ^ 0xbad0a4b3n) >>> 0;
}

function buildX7(compressed, crc, realSize) {
  const newSize = compressed.length * 4 + 8;
  const encrypted1 = encryptVersion2(compressed, 0, newSize);
  const encrypted2 = encryptVersion2(compressed, 1, newSize);
  const out = Buffer.alloc(newSize);

  out.writeInt32LE((realSize ^ X7_SIZE_XOR) | 0, 0);
  out.writeUInt32LE(crc >>> 0, 4);

  for (let i = 0; i < compressed.length; i++) {
    const offset = 8 + i * 4;
    out[offset] = compressed[i];
    out[offset + 1] = encrypted1[i];
    out[offset + 2] = compressed[i];
    out[offset + 3] = encrypted2[i];
  }

  return out;
}

function encryptX7(buffer) {
  const realSize = buffer.length;
  const compressed = Buffer.from(getLzoPack().compress(buffer));
  return buildX7(compressed, x7Crc(buffer), realSize);
}

function s4Crc(buffer, fullName) {
  const dataCrc = crc32UInt(buffer);
  const pathCrc = crc32UInt(Buffer.from(fullName, "ascii"));
  const finalCrc = BigInt.asUintN(64, dataCrc | (pathCrc << 32n));
  const tmp = Buffer.alloc(8);
  tmp.writeBigUInt64LE(finalCrc);
  encryptOldCapped32InPlace(tmp);
  return tmp.readBigInt64LE();
}

function readCString(buffer, size) {
  const slice = buffer.slice(0, size);
  const nullPos = slice.indexOf(0);
  return slice.slice(0, nullPos === -1 ? slice.length : nullPos).toString("ascii");
}

function readEntry(entryBuffer) {
  const entry = Buffer.from(entryBuffer);
  decryptOldCapped32InPlace(entry);

  return {
    fullName: readCString(entry, 256).toLowerCase(),
    checksum: entry.readBigInt64LE(256),
    length: entry.readInt32LE(264),
    unk: entry.readInt32LE(268),
  };
}

function checksumCandidates(checksum) {
  if (checksum == null) {
    throw new Error("checksum ausente al buscar el archivo del recurso");
  }

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

function printableRatio(text) {
  if (!text.length) {
    return 0;
  }

  let ok = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x20 && code <= 0x7e) || ch === "\r" || ch === "\n" || ch === "\t") {
      ok++;
    }
  }

  return ok / text.length;
}

function diagnoseHeader(buffer) {
  const result = {
    version: null,
    count: null,
    entrySize: null,
    firstName: "",
    printablePercent: 0,
    score: 0,
    reasons: [],
  };

  if (buffer.length < 12) {
    result.reasons.push("buffer demasiado pequeno para leer header");
    return result;
  }

  result.version = buffer.readInt32LE(0);
  result.count = buffer.readInt32LE(4);
  result.entrySize = buffer.readInt32LE(8);

  if (result.version === 1) {
    result.score += 40;
  } else {
    result.reasons.push(`version esperada 1, actual ${result.version}`);
  }

  const maxPossibleCount = Math.floor(Math.max(0, buffer.length - 8) / ENTRY_SIZE_EXPECTED);
  if (result.count >= 1 && result.count <= maxPossibleCount) {
    result.score += 25;
  } else {
    result.reasons.push(`count fuera de rango 1-${maxPossibleCount}, actual ${result.count}`);
  }

  if (result.entrySize === ENTRY_SIZE_EXPECTED) {
    result.score += 15;
  } else {
    result.reasons.push(
      `tamano primer entry esperado ${ENTRY_SIZE_EXPECTED}, actual ${result.entrySize}`
    );
  }

  const firstEntryEnd = 12 + Math.max(0, result.entrySize || 0);
  if (result.entrySize > 0 && firstEntryEnd <= buffer.length) {
    const previewEntry = Buffer.from(buffer.slice(12, firstEntryEnd));
    decryptOldCapped32InPlace(previewEntry);
    result.firstName = readCString(previewEntry, 256);
    result.printablePercent = Math.round(printableRatio(result.firstName) * 100);

    if (result.printablePercent >= 90 && result.firstName.includes("/")) {
      result.score += 20;
    } else {
      result.reasons.push(
        `nombre poco legible (${result.printablePercent}% imprimible): ${JSON.stringify(result.firstName.slice(0, 80))}`
      );
    }
  } else {
    result.reasons.push("primer entry queda fuera de buffer");
  }

  return result;
}

function parseDecryptedContainer(decrypted) {
  const diagnosis = diagnoseHeader(decrypted);

  if (diagnosis.version !== 1 || diagnosis.count < 0) {
    const err = new Error("Header invalido. Llave, orden o pipeline incorrecto.");
    err.diagnosis = diagnosis;
    throw err;
  }

  let offset = 8;
  const entries = [];

  for (let i = 0; i < diagnosis.count; i++) {
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
    version: diagnosis.version,
    count: diagnosis.count,
    firstName: diagnosis.firstName,
    headerScore: diagnosis.score,
    entries,
  };
}

function parseContainer(containerPath) {
  const raw = fs.readFileSync(containerPath);
  try {
    const headerStage = swapBlocks(raw);
    const { data, key, iv } = extractKeys(headerStage);
    const decrypted = swapBlocks(seedCtrTransform(decryptVersion2(data), key, iv));
    const archive = parseDecryptedContainer(decrypted);
    archive.containerMode = "s4hd";
    return archive;
  } catch (normalErr) {
    try {
      return season1.parseContainer(containerPath);
    } catch {
      throw normalErr;
    }
  }
}

function parseContainerWithSeed(containerPath, seedKey, seedIv) {
  const raw = fs.readFileSync(containerPath);
  const headerStage = swapBlocks(raw);
  const { data } = extractKeys(headerStage);
  const key = normalizeSeedKey(seedKey);
  const iv = normalizeSeedKey(seedIv);
  const decrypted = swapBlocks(seedCtrTransform(decryptVersion2(data), key, iv));
  return parseDecryptedContainer(decrypted);
}

function parseContainerWithLockKey(containerPath, seedKey) {
  return parseContainerWithSeed(containerPath, seedKey, normalizeLockIv(seedKey));
}

function decodeResource(entry, resourcesDir) {
  if (entry && entry.season1) {
    return season1.decodeResource(entry, resourcesDir);
  }
  const resource = findResourceFile(resourcesDir, entry.checksum);
  if (!resource) {
    throw new Error(`recurso faltante para checksum ${checksumCandidates(entry.checksum)[0]}`);
  }

  let data = fs.readFileSync(resource.fullPath);
  data = swapBytes(data);

  if (data.length < COMPRESS_THRESHOLD) {
    data = Buffer.from(lzo.decompress(data, entry.length));
  }

  decryptOldCapped32InPlace(data);

  const cleanName = entry.fullName.toLowerCase();
  const isX7 = cleanName.endsWith(".x7");
  const isXem = cleanName.endsWith(".xem");
  const needsSeed = shouldUseSeedEncryption(cleanName);

  if (needsSeed) {
    data = isXem ? decodeMaybeSeedResource(data) : decryptSeed(data);
  }

  if (isX7) {
    data = decryptX7(data);
  }

  return {
    data,
    resourceFile: resource.name,
  };
}

function readableScore(buffer) {
  if (!buffer || buffer.length === 0) {
    return 0;
  }

  const limit = Math.min(buffer.length, 4096);
  let readable = 0;

  for (let i = 0; i < limit; i++) {
    const value = buffer[i];
    if (value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126)) {
      readable++;
    }
  }

  return readable / limit;
}

function decodeMaybeSeedResource(data) {
  try {
    const decoded = decryptSeed(data);
    return readableScore(decoded) >= readableScore(data) ? decoded : data;
  } catch (e) {
    return data;
  }
}

function shouldUseSeedEncryption(fullName) {
  const cleanName = fullName.toLowerCase();
  return cleanName.endsWith(".x7") || cleanName.endsWith(".lua");
}

function encodeResource(entry, data) {
  let output = Buffer.from(data);
  const cleanName = entry.fullName.toLowerCase();
  const isX7 = cleanName.endsWith(".x7");
  const needsSeed = shouldUseSeedEncryption(cleanName);

  if (needsSeed) {
    if (isX7) {
      output = encryptX7(output);
    }
    output = encryptSeed(output);
  }

  entry.checksum = s4Crc(output, entry.fullName);
  entry.length = output.length;

  encryptOldCapped32InPlace(output);

  if (output.length < COMPRESS_THRESHOLD) {
    output = Buffer.from(getLzoPack().compress(output));
  }

  output = swapBytes(output);
  return output;
}

function encodeStandaloneSeq(buffer) {
  const output = Buffer.from(buffer);
  encryptOldCapped32InPlace(output);
  return output;
}

function decodeStandaloneSeq(buffer) {
  const output = Buffer.from(buffer);
  decryptOldCapped32InPlace(output);
  return output;
}

function looksLikeXml(buffer) {
  const text = buffer.slice(0, 256).toString("utf8").trimStart();
  return text.startsWith("<");
}

function decodeShopS4(buffer) {
  if (buffer.length < 5) {
    throw new Error("Invalid .s4 file.");
  }

  const realSize = buffer.readUInt32LE(0);
  const payload = buffer.slice(4);
  const errors = [];

  for (let blockIndex = 0; blockIndex < 2; blockIndex++) {
    for (let keyIndex = 0; keyIndex < 10; keyIndex++) {
      const decrypted = decryptVersion2WithKey(payload, blockIndex, keyIndex);

      try {
        const xml = Buffer.from(lzo.decompress(decrypted, realSize));

        if (looksLikeXml(xml)) {
          return {
            xml,
            meta: {
              realSize,
              blockIndex,
              keyIndex,
              compressedSize: payload.length
            }
          };
        }
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  throw new Error(`Could not decrypt .s4 shop file. ${errors[0] || ""}`.trim());
}

function encodeShopS4(xml, meta = {}) {
  const xmlBuffer = Buffer.isBuffer(xml) ? xml : Buffer.from(String(xml), "utf8");
  const compressed = Buffer.from(getLzoPack().compress(xmlBuffer));
  const blockIndex = Number.isInteger(meta.blockIndex) ? meta.blockIndex : 0;
  const keyIndex = Number.isInteger(meta.keyIndex) ? meta.keyIndex : 0;
  const encrypted = encryptVersion2WithKey(compressed, blockIndex, keyIndex);
  const out = Buffer.alloc(4 + encrypted.length);

  out.writeUInt32LE(xmlBuffer.length, 0);
  encrypted.copy(out, 4);
  return out;
}

function writeCString(buffer, value, offset, size) {
  const text = Buffer.from(value, "ascii");
  text.copy(buffer, offset, 0, Math.min(text.length, size - 1));
}

function writeEntry(entry) {
  if (entry.checksum == null || entry.length == null) {
    throw new Error(`entry incompleto en el indice: ${entry.fullName} (checksum=${entry.checksum}, length=${entry.length})`);
  }

  const data = Buffer.alloc(ENTRY_SIZE_EXPECTED);
  writeCString(data, entry.fullName, 0, 256);
  data.writeBigInt64LE(BigInt.asIntN(64, entry.checksum), 256);
  data.writeInt32LE(entry.length, 264);
  data.writeInt32LE(entry.unk || 0, 268);
  encryptOldCapped32InPlace(data);
  return data;
}

function saveContainer(archive, containerPath, options = {}) {
  if (archive && archive.season1) {
    return season1.saveContainer(archive, containerPath);
  }
  const parts = [Buffer.alloc(8)];
  parts[0].writeInt32LE(archive.version || 1, 0);
  parts[0].writeInt32LE(archive.entries.length, 4);

  for (const entry of archive.entries) {
    const entryData = writeEntry(entry);
    const size = Buffer.alloc(4);
    size.writeInt32LE(entryData.length, 0);
    parts.push(size, entryData);
  }

  const raw = Buffer.concat(parts);
  const locked = options.lockKey ? encryptSeedLockedDetailed(raw, options.lockKey) : null;
  const output = locked ? locked.output : encryptSeed(raw, options.seedKey, options.seedIv);

  fs.writeFileSync(containerPath, output);

  if (locked) {
    return {
      key: locked.key.toString("hex"),
      iv: locked.iv.toString("hex"),
      decoyKey: locked.decoyKey.toString("hex"),
      decoyIv: locked.decoyIv.toString("hex"),
    };
  }

  return null;
}

function setResourceData(archive, resourcesDir, fullName, data) {
  if (archive && archive.season1) {
    return season1.setResourceData(archive, resourcesDir, fullName, data);
  }
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
  if (archive && archive.season1) {
    return season1.createResource(archive, resourcesDir, fullName, data);
  }
  const cleanName = fullName.toLowerCase().replace(/\\/g, "/");

  if (archive.entries.some(item => item.fullName === cleanName)) {
    throw new Error(`resource already exists: ${cleanName}`);
  }

  const entry = {
    fullName: cleanName,
    checksum: 0n,
    length: 0,
    unk: 0,
    entrySize: ENTRY_SIZE_EXPECTED,
  };

  archive.entries.push(entry);
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

function ensureInside(baseDir, fullName) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, fullName);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;

  if (target !== base && !target.startsWith(prefix)) {
    throw new Error(`ruta fuera de salida: ${fullName}`);
  }

  return target;
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    containerPath: null,
    resourcesDir: null,
    outputDir: null,
    limit: 0,
  };

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        options.limit = value;
      }
      continue;
    }

    positional.push(arg);
  }

  options.containerPath = path.resolve(positional[0] || "resource.s4hd");
  if (positional[1]) {
    options.resourcesDir = path.resolve(positional[1]);
  }
  if (positional[2]) {
    options.outputDir = path.resolve(positional[2]);
  }

  const baseDir = path.dirname(options.containerPath);
  options.resourcesDir ||= path.join(baseDir, "_resources");
  options.outputDir ||= path.join(baseDir, "extracted");
  return options;
}

function printFailure(err) {
  console.error("====== RESULT ======");
  console.error("DECRYPT FALLO");
  console.error(`razon: ${err.message}`);

  if (err.diagnosis) {
    const d = err.diagnosis;
    console.error("");
    console.error("DIAGNOSTICO");
    console.error(`headerScore: ${d.score}/100`);
    console.error(`version: ${d.version}`);
    console.error(`count: ${d.count}`);
    console.error(`entrySize: ${d.entrySize}`);
    console.error(`firstName: ${JSON.stringify(d.firstName)}`);
    console.error(`printable: ${d.printablePercent}%`);

    if (d.reasons.length) {
      console.error("pistas:");
      for (const reason of d.reasons) {
        console.error(`- ${reason}`);
      }
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const archive = parseContainer(options.containerPath);
  const extractCount = options.limit > 0 ? Math.min(options.limit, archive.entries.length) : archive.entries.length;

  fs.mkdirSync(options.outputDir, { recursive: true });

  const manifest = [];
  let extracted = 0;
  let failed = 0;

  console.log(`version: ${archive.version}`);
  console.log(`count: ${archive.count}`);
  console.log(`headerScore: ${archive.headerScore}/100`);
  console.log(`firstName: ${archive.firstName}`);
  console.log(`container: ${options.containerPath}`);
  console.log(`resources: ${options.resourcesDir}`);
  console.log(`output: ${options.outputDir}`);
  console.log(`extracting: ${extractCount}`);

  for (let i = 0; i < extractCount; i++) {
    const entry = archive.entries[i];

    try {
      const decoded = decodeResource(entry, options.resourcesDir);
      const targetPath = ensureInside(options.outputDir, entry.fullName);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, decoded.data);

      manifest.push({
        fullName: entry.fullName,
        checksumHex: checksumCandidates(entry.checksum)[0],
        resourceFile: decoded.resourceFile,
        length: entry.length,
        unk: entry.unk,
        outputSize: decoded.data.length,
      });

      extracted++;
      if ((i + 1) % 250 === 0 || i + 1 === extractCount) {
        console.log(`ok ${i + 1}/${extractCount}`);
      }
    } catch (err) {
      failed++;
      manifest.push({
        fullName: entry.fullName,
        checksumHex: checksumCandidates(entry.checksum)[0],
        length: entry.length,
        unk: entry.unk,
        error: err.message,
      });
      console.error(`fail ${i + 1}/${extractCount}: ${entry.fullName} -> ${err.message}`);
    }
  }

  fs.writeFileSync(
    path.join(options.outputDir, "manifest.json"),
    JSON.stringify(
      {
        version: archive.version,
        count: archive.count,
        extracted,
        failed,
        limit: options.limit,
        entries: manifest,
      },
      null,
      2
    )
  );

  console.log("");
  console.log("SUMMARY");
  console.log(`extracted: ${extracted}`);
  console.log(`failed: ${failed}`);
}

module.exports = {
  parseContainer,
  parseContainerWithSeed,
  parseContainerWithLockKey,
  decodeResource,
  decodeShopS4,
  encodeShopS4,
  encodeStandaloneSeq,
  decodeStandaloneSeq,
  checksumCandidates,
  saveContainer,
  encryptSeedLockedDetailed,
  setResourceData,
  createResource,
  removeResource,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    printFailure(err);
    process.exitCode = 1;
  }
}
