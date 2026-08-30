const { parentPort } = require('worker_threads');
const { ddsToPngDataUrl, tgaToPngDataUrl } = require('./imagecodec');

parentPort.on('message', msg => {
  let url = '';
  try {
    const buf = Buffer.from(msg.buf);
    if(msg.ext === '.dds') url = ddsToPngDataUrl(buf);
    else if(msg.ext === '.tga') url = tgaToPngDataUrl(buf);
  } catch(e) {}
  parentPort.postMessage({ id: msg.id, url });
});
