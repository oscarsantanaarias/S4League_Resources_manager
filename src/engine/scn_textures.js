'use strict';
const { PNG } = require('pngjs');

function maskShift(mask){ if(!mask) return 0; let s = 0; while(((mask >>> s) & 1) === 0 && s < 32) s++; return s; }
function maskBits(mask){ if(!mask) return 0; let b = 0, v = mask >>> maskShift(mask); while(v & 1){ b++; v >>= 1; } return b; }
function readMasked(value, mask){ if(!mask) return 255; const shift = maskShift(mask), bits = maskBits(mask); const raw = (value & mask) >>> shift; const max = (1 << bits) - 1; return Math.round((raw / max) * 255); }

function rgb565(color){
  const r = ((color >> 11) & 31) * 255 / 31, g = ((color >> 5) & 63) * 255 / 63, b = (color & 31) * 255 / 31;
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}
function buildDxtColors(c0, c1, dxt1){
  const color0 = rgb565(c0), color1 = rgb565(c1), colors = [color0, color1];
  if(dxt1 && c0 <= c1){
    colors[2] = [Math.round((color0[0]+color1[0])/2), Math.round((color0[1]+color1[1])/2), Math.round((color0[2]+color1[2])/2), 255];
    colors[3] = [0, 0, 0, 0];
  } else {
    colors[2] = [Math.round((2*color0[0]+color1[0])/3), Math.round((2*color0[1]+color1[1])/3), Math.round((2*color0[2]+color1[2])/3), 255];
    colors[3] = [Math.round((color0[0]+2*color1[0])/3), Math.round((color0[1]+2*color1[1])/3), Math.round((color0[2]+2*color1[2])/3), 255];
  }
  return colors;
}
function decodeDxt5Alphas(buffer, offset){
  const a0 = buffer[offset], a1 = buffer[offset+1], table = [a0, a1];
  if(a0 > a1){ table[2]=Math.round((6*a0+a1)/7); table[3]=Math.round((5*a0+2*a1)/7); table[4]=Math.round((4*a0+3*a1)/7); table[5]=Math.round((3*a0+4*a1)/7); table[6]=Math.round((2*a0+5*a1)/7); table[7]=Math.round((a0+6*a1)/7); }
  else { table[2]=Math.round((4*a0+a1)/5); table[3]=Math.round((3*a0+2*a1)/5); table[4]=Math.round((2*a0+3*a1)/5); table[5]=Math.round((a0+4*a1)/5); table[6]=0; table[7]=255; }
  let bits = 0n; for(let i = 0; i < 6; i++) bits |= BigInt(buffer[offset+2+i]) << BigInt(8*i);
  const alphas = []; for(let i = 0; i < 16; i++) alphas[i] = table[Number((bits >> BigInt(3*i)) & 7n)];
  return alphas;
}
function decodeDxt3Alphas(buffer, offset){
  const alphas = [];
  for(let i = 0; i < 16; i++){ const byte = buffer[offset + Math.floor(i/2)]; const v = (i % 2 === 0) ? (byte & 0x0f) : (byte >> 4); alphas[i] = v * 17; }
  return alphas;
}
function decodeDxtToPng(buffer, png, width, height, fourCC){
  const blockBytes = fourCC === 'DXT1' ? 8 : 16;
  const blocksWide = Math.ceil(width/4), blocksHigh = Math.ceil(height/4);
  let offset = 128;
  for(let by = 0; by < blocksHigh; by++){
    for(let bx = 0; bx < blocksWide; bx++){
      let alphas = new Array(16).fill(255), colorOffset = offset;
      if(fourCC === 'DXT3'){ alphas = decodeDxt3Alphas(buffer, offset); colorOffset += 8; }
      else if(fourCC === 'DXT5'){ alphas = decodeDxt5Alphas(buffer, offset); colorOffset += 8; }
      const c0 = buffer.readUInt16LE(colorOffset), c1 = buffer.readUInt16LE(colorOffset+2);
      const colors = buildDxtColors(c0, c1, fourCC === 'DXT1');
      const indices = buffer.readUInt32LE(colorOffset+4);
      for(let py = 0; py < 4; py++) for(let px = 0; px < 4; px++){
        const x = bx*4+px, y = by*4+py;
        if(x >= width || y >= height) continue;
        const pi = py*4+px, ci = (indices >> (2*pi)) & 3, color = colors[ci], dst = (y*width+x)*4;
        png.data[dst]=color[0]; png.data[dst+1]=color[1]; png.data[dst+2]=color[2];
        png.data[dst+3] = fourCC === 'DXT1' ? 255 : alphas[pi];
      }
      offset += blockBytes;
    }
  }
}

function ddsToPngDataUrl(buffer){
  if(buffer.toString('ascii', 0, 4) !== 'DDS ') throw new Error('Invalid DDS file.');
  const height = buffer.readUInt32LE(12), width = buffer.readUInt32LE(16);
  const fourCC = buffer.toString('ascii', 84, 88).replace(/\0/g, '');
  const rgbBits = buffer.readUInt32LE(88);
  const rMask = buffer.readUInt32LE(92), gMask = buffer.readUInt32LE(96), bMask = buffer.readUInt32LE(100), aMask = buffer.readUInt32LE(104);
  const png = new PNG({ width, height });
  if(fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5'){
    decodeDxtToPng(buffer, png, width, height, fourCC);
    return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
  }
  if(fourCC) throw new Error(`DDS ${fourCC} not supported.`);
  if(rgbBits !== 32) throw new Error(`DDS ${rgbBits}-bit not supported.`);
  let srcOffset = 128;
  for(let y = 0; y < height; y++) for(let x = 0; x < width; x++){
    const value = buffer.readUInt32LE(srcOffset); const dst = (y*width+x)*4;
    png.data[dst]=readMasked(value,rMask); png.data[dst+1]=readMasked(value,gMask); png.data[dst+2]=readMasked(value,bMask); png.data[dst+3]=aMask?readMasked(value,aMask):255;
    srcOffset += 4;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

function tgaToPngDataUrl(buffer){
  if(buffer.length < 18) throw new Error('Invalid TGA file.');
  const idLength = buffer[0], imageType = buffer[2];
  const width = buffer.readUInt16LE(12), height = buffer.readUInt16LE(14);
  const bits = buffer[16], descriptor = buffer[17];
  if(![2,3,10].includes(imageType)) throw new Error(`TGA type ${imageType} not supported.`);
  if(![24,32,8].includes(bits)) throw new Error(`TGA ${bits}-bit not supported.`);
  const png = new PNG({ width, height });
  let offset = 18 + idLength;
  const topOrigin = (descriptor & 0x20) !== 0, bytes = bits/8;
  function writePixel(index, pixel){
    const x = index % width, yRaw = Math.floor(index/width), y = topOrigin ? yRaw : height-1-yRaw, dst = (y*width+x)*4;
    if(bits === 8){ png.data[dst]=pixel[0]; png.data[dst+1]=pixel[0]; png.data[dst+2]=pixel[0]; png.data[dst+3]=255; return; }
    png.data[dst]=pixel[2]; png.data[dst+1]=pixel[1]; png.data[dst+2]=pixel[0]; png.data[dst+3] = bits === 32 ? pixel[3] : 255;
  }
  const total = width*height; let pixelIndex = 0;
  if(imageType === 10){
    while(pixelIndex < total && offset < buffer.length){
      const packet = buffer[offset++], count = (packet & 0x7f) + 1;
      if(packet & 0x80){ const pixel = buffer.slice(offset, offset+bytes); offset += bytes; for(let i = 0; i < count && pixelIndex < total; i++) writePixel(pixelIndex++, pixel); }
      else { for(let i = 0; i < count && pixelIndex < total; i++){ const pixel = buffer.slice(offset, offset+bytes); offset += bytes; writePixel(pixelIndex++, pixel); } }
    }
  } else {
    while(pixelIndex < total && offset+bytes <= buffer.length){ const pixel = buffer.slice(offset, offset+bytes); offset += bytes; writePixel(pixelIndex++, pixel); }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

function imageToDataUrl(buffer, ext){
  ext = String(ext || '').toLowerCase();
  try {
    if(ext === '.dds') return ddsToPngDataUrl(buffer);
    if(ext === '.tga') return tgaToPngDataUrl(buffer);
    if(ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.bmp'){
      const t = ext === '.jpg' ? 'jpeg' : ext.replace('.', '');
      return `data:image/${t};base64,${buffer.toString('base64')}`;
    }
  } catch(e){ return null; }
  return null;
}

module.exports = { ddsToPngDataUrl, tgaToPngDataUrl, imageToDataUrl };
