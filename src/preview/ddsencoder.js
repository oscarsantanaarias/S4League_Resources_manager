'use strict';

const FOURCC_DXT1 = 0x31545844;
const FOURCC_DXT3 = 0x33545844;
const FOURCC_DXT5 = 0x35545844;

function nivelesMipmap(ancho, alto){
  let niveles = 1;
  let a = ancho, b = alto;
  while(a > 1 || b > 1){
    a = Math.max(1, a >> 1);
    b = Math.max(1, b >> 1);
    niveles += 1;
  }
  return niveles;
}

function reducirMitad(rgba, ancho, alto){
  const nuevoAncho = Math.max(1, ancho >> 1);
  const nuevoAlto = Math.max(1, alto >> 1);
  const salida = Buffer.alloc(nuevoAncho * nuevoAlto * 4);

  for(let y = 0; y < nuevoAlto; y += 1){
    for(let x = 0; x < nuevoAncho; x += 1){
      for(let canal = 0; canal < 4; canal += 1){
        let suma = 0, cuenta = 0;
        for(let dy = 0; dy < 2; dy += 1){
          for(let dx = 0; dx < 2; dx += 1){
            const sy = Math.min(alto - 1, y * 2 + dy);
            const sx = Math.min(ancho - 1, x * 2 + dx);
            suma += rgba[(sy * ancho + sx) * 4 + canal];
            cuenta += 1;
          }
        }
        salida[(y * nuevoAncho + x) * 4 + canal] = Math.round(suma / cuenta);
      }
    }
  }

  return { data: salida, ancho: nuevoAncho, alto: nuevoAlto };
}

function a565(r, g, b){
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function de565(v){
  const r = (v >> 11) & 0x1f;
  const g = (v >> 5) & 0x3f;
  const b = v & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function extremosDelBloque(pixeles){
  let minR = 255, minG = 255, minB = 255;
  let maxR = 0, maxG = 0, maxB = 0;

  for(const p of pixeles){
    if(p[0] < minR) minR = p[0];
    if(p[1] < minG) minG = p[1];
    if(p[2] < minB) minB = p[2];
    if(p[0] > maxR) maxR = p[0];
    if(p[1] > maxG) maxG = p[1];
    if(p[2] > maxB) maxB = p[2];
  }

  const ajuste = (min, max) => {
    const paso = (max - min) >> 4;
    return [Math.min(255, min + paso), Math.max(0, max - paso)];
  };

  const [aR, bR] = ajuste(minR, maxR);
  const [aG, bG] = ajuste(minG, maxG);
  const [aB, bB] = ajuste(minB, maxB);

  return { min: [aR, aG, aB], max: [bR, bG, bB] };
}

function escribirBloqueColor(salida, offset, pixeles, permitirTransparencia){
  const { min, max } = extremosDelBloque(pixeles);

  let c0 = a565(max[0], max[1], max[2]);
  let c1 = a565(min[0], min[1], min[2]);

  const hayTransparencia = permitirTransparencia && pixeles.some(p => p[3] < 128);

  if(hayTransparencia){
    if(c0 > c1){ const t = c0; c0 = c1; c1 = t; }
    if(c0 === c1 && c1 < 0xffff) c1 += 1;
  } else if(c0 < c1){
    const t = c0; c0 = c1; c1 = t;
  }

  const col0 = de565(c0);
  const col1 = de565(c1);
  const paleta = [col0, col1];

  if(hayTransparencia){
    paleta.push([
      Math.round((col0[0] + col1[0]) / 2),
      Math.round((col0[1] + col1[1]) / 2),
      Math.round((col0[2] + col1[2]) / 2)
    ]);
  } else {
    paleta.push([
      Math.round((2 * col0[0] + col1[0]) / 3),
      Math.round((2 * col0[1] + col1[1]) / 3),
      Math.round((2 * col0[2] + col1[2]) / 3)
    ]);
    paleta.push([
      Math.round((col0[0] + 2 * col1[0]) / 3),
      Math.round((col0[1] + 2 * col1[1]) / 3),
      Math.round((col0[2] + 2 * col1[2]) / 3)
    ]);
  }

  salida.writeUInt16LE(c0, offset);
  salida.writeUInt16LE(c1, offset + 2);

  let indices = 0;
  for(let i = 0; i < 16; i += 1){
    const p = pixeles[i];
    let elegido = 0;

    if(hayTransparencia && p[3] < 128){
      elegido = 3;
    } else {
      let mejor = Infinity;
      for(let k = 0; k < paleta.length; k += 1){
        const dr = p[0] - paleta[k][0];
        const dg = p[1] - paleta[k][1];
        const db = p[2] - paleta[k][2];
        const error = dr * dr + dg * dg + db * db;
        if(error < mejor){ mejor = error; elegido = k; }
      }
    }

    indices |= elegido << (i * 2);
  }

  salida.writeUInt32LE(indices >>> 0, offset + 4);
}

function escribirBloqueAlfaExplicito(salida, offset, pixeles){
  for(let i = 0; i < 16; i += 2){
    const bajo = pixeles[i][3] >> 4;
    const alto = pixeles[i + 1][3] >> 4;
    salida[offset + (i >> 1)] = (alto << 4) | bajo;
  }
}

function escribirBloqueAlfaInterpolado(salida, offset, pixeles){
  let min = 255, max = 0;
  for(const p of pixeles){
    if(p[3] < min) min = p[3];
    if(p[3] > max) max = p[3];
  }

  salida[offset] = max;
  salida[offset + 1] = min;

  const tabla = [max, min];
  if(max > min){
    for(let i = 1; i <= 6; i += 1){
      tabla.push(Math.round(((7 - i) * max + i * min) / 7));
    }
  } else {
    for(let i = 0; i < 6; i += 1) tabla.push(max);
  }

  let bits = 0n;
  for(let i = 0; i < 16; i += 1){
    let elegido = 0, mejor = Infinity;
    for(let k = 0; k < 8; k += 1){
      const error = Math.abs(pixeles[i][3] - tabla[k]);
      if(error < mejor){ mejor = error; elegido = k; }
    }
    bits |= BigInt(elegido) << BigInt(i * 3);
  }

  for(let i = 0; i < 6; i += 1){
    salida[offset + 2 + i] = Number((bits >> BigInt(i * 8)) & 0xffn);
  }
}

function comprimirNivel(rgba, ancho, alto, formato){
  const bloquesX = Math.max(1, Math.ceil(ancho / 4));
  const bloquesY = Math.max(1, Math.ceil(alto / 4));
  const bytesPorBloque = formato === 'DXT1' ? 8 : 16;
  const salida = Buffer.alloc(bloquesX * bloquesY * bytesPorBloque);

  const pixeles = new Array(16);

  for(let by = 0; by < bloquesY; by += 1){
    for(let bx = 0; bx < bloquesX; bx += 1){
      for(let i = 0; i < 16; i += 1){
        const x = Math.min(ancho - 1, bx * 4 + (i % 4));
        const y = Math.min(alto - 1, by * 4 + Math.floor(i / 4));
        const o = (y * ancho + x) * 4;
        pixeles[i] = [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
      }

      const offset = (by * bloquesX + bx) * bytesPorBloque;

      if(formato === 'DXT1'){
        escribirBloqueColor(salida, offset, pixeles, true);
      } else if(formato === 'DXT3'){
        escribirBloqueAlfaExplicito(salida, offset, pixeles);
        escribirBloqueColor(salida, offset + 8, pixeles, false);
      } else {
        escribirBloqueAlfaInterpolado(salida, offset, pixeles);
        escribirBloqueColor(salida, offset + 8, pixeles, false);
      }
    }
  }

  return salida;
}

function escribirNivelPlano(rgba, ancho, alto, bpp){
  const salida = Buffer.alloc(ancho * alto * (bpp / 8));
  let o = 0;

  for(let i = 0; i < ancho * alto; i += 1){
    salida[o++] = rgba[i * 4 + 2];
    salida[o++] = rgba[i * 4 + 1];
    salida[o++] = rgba[i * 4];
    if(bpp === 32) salida[o++] = rgba[i * 4 + 3];
  }

  return salida;
}

function armarCabecera(ancho, alto, formato, bpp, mipmaps, tamanoPrimerNivel){
  const cabecera = Buffer.alloc(128);
  cabecera.write('DDS ', 0, 'ascii');
  cabecera.writeUInt32LE(124, 4);

  const comprimido = formato !== 'RAW';
  let flags = 0x1 | 0x2 | 0x4 | 0x1000 | (comprimido ? 0x80000 : 0x8);
  if(mipmaps > 1) flags |= 0x20000;

  cabecera.writeUInt32LE(flags, 8);
  cabecera.writeUInt32LE(alto, 12);
  cabecera.writeUInt32LE(ancho, 16);
  cabecera.writeUInt32LE(comprimido ? tamanoPrimerNivel : ancho * (bpp / 8), 20);
  cabecera.writeUInt32LE(0, 24);
  cabecera.writeUInt32LE(mipmaps, 28);

  cabecera.writeUInt32LE(32, 76);

  if(comprimido){
    cabecera.writeUInt32LE(0x4, 80);
    const fourcc = formato === 'DXT1' ? FOURCC_DXT1 : (formato === 'DXT3' ? FOURCC_DXT3 : FOURCC_DXT5);
    cabecera.writeUInt32LE(fourcc, 84);
  } else {
    cabecera.writeUInt32LE(bpp === 32 ? 0x41 : 0x40, 80);
    cabecera.writeUInt32LE(0, 84);
    cabecera.writeUInt32LE(bpp, 88);
    cabecera.writeUInt32LE(0x00ff0000, 92);
    cabecera.writeUInt32LE(0x0000ff00, 96);
    cabecera.writeUInt32LE(0x000000ff, 100);
    cabecera.writeUInt32LE(bpp === 32 ? 0xff000000 : 0, 104);
  }

  cabecera.writeUInt32LE(0x1000 | (mipmaps > 1 ? 0x400008 : 0), 108);

  return cabecera;
}

function codificarDds(rgba, ancho, alto, formato = 'DXT5', opciones = {}){
  const bpp = opciones.bpp || 32;
  const conMipmaps = opciones.mipmaps !== false;
  const total = conMipmaps ? nivelesMipmap(ancho, alto) : 1;

  const partes = [];
  let actual = { data: rgba, ancho, alto };
  let tamanoPrimerNivel = 0;

  for(let nivel = 0; nivel < total; nivel += 1){
    const datos = formato === 'RAW'
      ? escribirNivelPlano(actual.data, actual.ancho, actual.alto, bpp)
      : comprimirNivel(actual.data, actual.ancho, actual.alto, formato);

    if(nivel === 0) tamanoPrimerNivel = datos.length;
    partes.push(datos);

    if(nivel + 1 < total) actual = reducirMitad(actual.data, actual.ancho, actual.alto);
  }

  return Buffer.concat([armarCabecera(ancho, alto, formato, bpp, total, tamanoPrimerNivel), ...partes]);
}

function leerFormatoDds(buffer){
  if(!buffer || buffer.length < 128 || buffer.toString('ascii', 0, 4) !== 'DDS '){
    return null;
  }

  const banderas = buffer.readUInt32LE(80);
  const fourcc = buffer.toString('ascii', 84, 88).replace(/\0/g, '');

  if(banderas & 0x4){
    return { formato: fourcc, bpp: 0, mipmaps: Math.max(1, buffer.readUInt32LE(28)) };
  }

  return { formato: 'RAW', bpp: buffer.readUInt32LE(88) || 32, mipmaps: Math.max(1, buffer.readUInt32LE(28)) };
}

function codificarTga(rgba, ancho, alto){
  const cabecera = Buffer.alloc(18);
  cabecera[2] = 2;
  cabecera.writeUInt16LE(ancho, 12);
  cabecera.writeUInt16LE(alto, 14);
  cabecera[16] = 32;
  cabecera[17] = 0x28;

  const pixeles = Buffer.alloc(ancho * alto * 4);
  for(let i = 0; i < ancho * alto; i += 1){
    pixeles[i * 4] = rgba[i * 4 + 2];
    pixeles[i * 4 + 1] = rgba[i * 4 + 1];
    pixeles[i * 4 + 2] = rgba[i * 4];
    pixeles[i * 4 + 3] = rgba[i * 4 + 3];
  }

  return Buffer.concat([cabecera, pixeles]);
}

module.exports = { codificarDds, codificarTga, leerFormatoDds };
