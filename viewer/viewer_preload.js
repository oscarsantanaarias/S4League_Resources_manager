const { contextBridge } = require('electron');
const fs = require('fs');

let data = { name: '', meshes: [], error: null };
try {
  const arg = process.argv.find(a => a.startsWith('--scn='));
  if(arg){
    data = JSON.parse(fs.readFileSync(arg.slice('--scn='.length), 'utf8'));
  }
} catch(e){
  data = { name: '', meshes: [], error: e.message };
}

contextBridge.exposeInMainWorld('scnData', data);
