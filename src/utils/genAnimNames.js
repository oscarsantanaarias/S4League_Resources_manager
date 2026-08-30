'use strict';

// The clip names never change: they come from the actor state scripts, which
// ship with the game. Parsing them on every open was work repeated for nothing,
// so the result is baked into src/data/animNames.json once and read from there.
//
// Regenerate after a client update:
//   node src/utils/genAnimNames.js [path/to/resources/script]

const fs = require('fs');
const path = require('path');
const { buildAnimNames } = require('./animNames');

const DIR = process.argv[2] || 'C:/S4Plain/extracted_resources/resources/script';
const OUT = path.join(__dirname, '..', 'data', 'animNames.json');

const files = fs.readdirSync(DIR).filter(f => /\.lua$/i.test(f))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(DIR, f), 'latin1') }));
if (!files.length) { console.error('no .lua in ' + DIR); process.exit(1); }

const built = buildAnimNames(files);

// only the label is needed to draw the dropdown; the tallies were scaffolding
const names = {};
for (const [clip, v] of Object.entries(built.names)) if (v.label) names[clip] = v.label;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ scripts: files.length, names }, null, 0));
console.log(Object.keys(names).length + ' names from ' + files.length + ' scripts -> ' + OUT);
