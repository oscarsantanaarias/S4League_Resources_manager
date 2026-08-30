const dec = require('../../s4zip/s4zip.cjs');
const enc = require('./ddsencoder.js');
const codec = require('./imagecodec.js');
const { PNG } = require('pngjs');
const path = require('path');
const base = 'C:/S4Plain';

function pngDesdeDataUrl(url){
  const b64 = url.split(',')[1];
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

const c = dec.parseContainer(path.join(base, 'resource.s4hd'));
const objetivos = ['DXT1', 'DXT3', 'DXT5'];
const vistos = {};

for(const e of c.entries){
  if(!/\.dds$/i.test(e.fullName)) continue;
  if(Object.keys(vistos).length === 3) break;
  let b;
  try { b = dec.decodeResource(e, path.join(base, '_resources')).data; } catch(err){ continue; }
  const info = enc.leerFormatoDds(b);
  if(!info || !objetivos.includes(info.formato) || vistos[info.formato]) continue;
  vistos[info.formato] = { entry: e, buffer: b, info };
}

for(const [fmt, v] of Object.entries(vistos)){
  const original = pngDesdeDataUrl(codec.ddsToPngDataUrl(v.buffer));
  const recodificado = enc.codificarDds(original.data, original.width, original.height, fmt, { mipmaps: v.info.mipmaps > 1 });
  const vuelta = pngDesdeDataUrl(codec.ddsToPngDataUrl(recodificado));

  let suma = 0, n = 0, peor = 0;
  for(let i = 0; i < original.data.length; i += 4){
    for(let k = 0; k < 4; k++){
      const d = original.data[i+k] - vuelta.data[i+k];
      suma += d*d; n++;
      if(Math.abs(d) > peor) peor = Math.abs(d);
    }
  }
  const rmse = Math.sqrt(suma/n);
  const psnr = rmse === 0 ? Infinity : (20*Math.log10(255/rmse));

  console.log(fmt.padEnd(5), v.entry.fullName.split('/').pop().padEnd(34),
    original.width+'x'+original.height,
    '| orig', String(v.buffer.length).padStart(7),
    '-> nuevo', String(recodificado.length).padStart(7),
    '| RMSE', rmse.toFixed(2), '| PSNR', psnr.toFixed(1)+'dB', '| peor canal', peor);
}
