'use strict';

// Flattens whatever the user dropped or picked into a list of real files, each
// with the name it should get inside the archive.
//
// A directory is walked to the bottom: nested folders keep their path relative
// to the folder that was picked, so dropping "effects" that holds "boss/fx.dds"
// lands as "effects/boss/fx.dds" rather than losing the subfolder.

const fsp = require('fs').promises;
const path = require('path');

async function collectDroppedFiles(paths) {
  const out = [];

  for (const p of paths) {
    const stat = await fsp.stat(p);

    if (stat.isFile()) {
      out.push({ filePath: p, relativeName: path.basename(p) });
      continue;
    }
    if (!stat.isDirectory()) continue;

    const rootName = path.basename(p);
    const stack = [p];
    while (stack.length) {
      const folder = stack.pop();
      for (const child of await fsp.readdir(folder, { withFileTypes: true })) {
        const childPath = path.join(folder, child.name);
        if (child.isDirectory()) {
          stack.push(childPath);            // keep going down
        } else if (child.isFile()) {
          out.push({
            filePath: childPath,
            relativeName: path.join(rootName, path.relative(p, childPath)).replace(/\\/g, '/'),
          });
        }
      }
    }
  }

  return out;
}

module.exports = { collectDroppedFiles };
