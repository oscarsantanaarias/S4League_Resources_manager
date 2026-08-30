const fs = require('fs');
const resourceDecoder = require('../../s4zip/s4zip.cjs');
const path = require('path');

function looksLikeSeq(buf){
  if(!buf || buf.length < 8) return false;
  return Math.abs(buf.readFloatLE(0) - 0.1) < 1e-6;
}

function seqPlaintext(buf){
  return looksLikeSeq(buf) ? buf : resourceDecoder.decodeStandaloneSeq(buf);
}

function luaOutputPath(input, suffix, mode = 'same'){
  const parsed = path.parse(input);
  let outputDir = parsed.dir;
  const parentName = path.basename(parsed.dir).toLowerCase();

  if(mode === 'decrypt' && parentName === 'input'){
    outputDir = path.join(path.dirname(parsed.dir), 'Output');
  } else if(mode === 'crypt' && parentName === 'output'){
    outputDir = path.join(path.dirname(parsed.dir), 'Input');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  return path.join(outputDir, `${parsed.name}${suffix}${parsed.ext || '.lua'}`);
}

function luaTextOutputPath(input, suffix, mode = 'same'){
  const parsed = path.parse(luaOutputPath(input, suffix, mode));
  return path.join(parsed.dir, `${parsed.name}.txt`);
}

function safeOutputPath(baseDir, fullName){
  const target = path.resolve(baseDir, fullName.replace(/\\/g, '/'));
  const base = path.resolve(baseDir);

  if(target !== base && !target.startsWith(base + path.sep)){
    throw new Error('Invalid resource path.');
  }

  return target;
}

function scanSeqAssetNames(buf){
  const out = [];
  let i = 0; const n = buf.length;
  while(i < n){
    if(buf[i] >= 32 && buf[i] <= 126){
      let j = i;
      while(j < n && buf[j] >= 32 && buf[j] <= 126) j++;
      if(j < n && buf[j] === 0 && j - i >= 3){
        const s = buf.toString('latin1', i, j);
        if(/\.(dds|tga|bmp|png|jpg|jpeg|scn)$/i.test(s)) out.push(s);
        i = j + 1; continue;
      }
    }
    i++;
  }
  return out;
}

function mapNameTableCloseTag(text){
  return text.includes('</string_table>') ? '</string_table>'
       : text.includes('</stringtable>') ? '</stringtable>'
       : '</string_table>';
}

module.exports = { looksLikeSeq,seqPlaintext,scanSeqAssetNames,safeOutputPath,luaOutputPath,luaTextOutputPath,mapNameTableCloseTag };
