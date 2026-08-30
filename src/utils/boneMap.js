'use strict';

// Reads a .bmap bone mapping, the format the S4 retarget tooling uses.
//
// Records are separated by a blank line and look like:
//
//   Bip01 L UpperArm%False%ABSOLUTE%0.0,0.0,0.0%0.0,0.0,0.0%1.0%False%False%Y%
//   mixamorig:LeftArm
//   False
//   False
//
// Line 1 is the S4 bone plus settings, line 2 the source bone, line 3 whether
// this bone carries the root motion. A target of "None" means deliberately
// unmapped, which is not the same as missing: it must not fall through to a
// guess.

function parseBoneMap(text) {
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const mapping = {};      // mixamo name -> S4 name
  const unmapped = [];     // sources the file says to leave alone
  const rootMotion = [];   // sources flagged as carrying root motion
  const settings = {};

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const fields = lines[0].split('%');
    const target = fields[0].trim();
    const source = lines[1].replace(/^mixamorig[:_]?/i, 'mixamorig').trim();
    if (!source) continue;

    if (!target || target.toLowerCase() === 'none') { unmapped.push(source); continue; }

    mapping[source] = target;
    if ((lines[2] || '').toLowerCase() === 'true') rootMotion.push(source);
    settings[source] = {
      space: fields[2] || '',
      offsetRotation: fields[3] || '',
      offsetPosition: fields[4] || '',
      scale: Number(fields[5]) || 1,
    };
  }

  return { mapping, unmapped, rootMotion, settings, count: Object.keys(mapping).length };
}

// The file writes "mixamorig:LeftArm", a track may say "mixamorigLeftArm".
// Match on the name with separators and case removed.
function normalizeKey(name) {
  return String(name || '').toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[\s_:]/g, '');
}

// Re-key a parsed mapping against the bone names actually present in a file.
function applyBoneMap(parsed, sourceNames, targetNames) {
  const wantTarget = new Set(targetNames || []);
  const byKey = new Map();
  for (const [src, dst] of Object.entries(parsed.mapping)) byKey.set(normalizeKey(src), dst);
  const unmappedKeys = new Set(parsed.unmapped.map(normalizeKey));

  const mapping = {}, absent = [], declaredUnmapped = [], unknown = [];
  for (const name of sourceNames) {
    const key = normalizeKey(name);
    if (unmappedKeys.has(key)) { declaredUnmapped.push(name); continue; }
    const dst = byKey.get(key);
    if (!dst) { unknown.push(name); continue; }
    if (wantTarget.size && !wantTarget.has(dst)) { absent.push(name); continue; }
    mapping[name] = dst;
  }
  return { mapping, absent, declaredUnmapped, unknown, matched: Object.keys(mapping).length };
}

module.exports = { parseBoneMap, applyBoneMap, normalizeKey };
