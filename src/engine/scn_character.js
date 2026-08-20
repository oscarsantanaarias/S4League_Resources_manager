'use strict';

const { mat4Mul, sampleNode, boneWorldByName, boneWorldByNameW, skinModelW, resolveBoneWorlds } = require('./scn_skin');

function applyMatrix(pos, M){
  const out = new Float32Array(pos.length);
  for(let i = 0; i < pos.length; i += 3){
    const x = pos[i], y = pos[i+1], z = pos[i+2];
    out[i]   = x*M[0]+y*M[4]+z*M[8]+M[12];
    out[i+1] = x*M[1]+y*M[5]+z*M[9]+M[13];
    out[i+2] = x*M[2]+y*M[6]+z*M[10]+M[14];
  }
  return out;
}

function gatherScene(skel, skelWorld, scene, pose, pieces){
  for(const m of scene.models){
    if(!m.positions.length || !m.indices.length) continue;
    let positions;
    if(m.skin.length){
      positions = skinModelW(m, skel, skelWorld);
    } else {
      const dummy = m.parent ? boneWorldByName(scene, m.parent, pose) : null;
      const head = boneWorldByNameW(skel, 'Bip01 Head', skelWorld);
      let world;
      if(dummy && head) world = mat4Mul(mat4Mul(m.matrix, dummy), head);
      else if(dummy)    world = mat4Mul(m.matrix, dummy);
      else              world = sampleNode(m, pose.tickA);
      positions = applyMatrix(m.positions, world);
    }
    pieces.push({ name: m.name, positions, indices: m.indices, uvs: m.uvs, texture: m.texture, dir: scene.dir || '', renderFlag: m.renderFlag || 0 });
  }
}

function assembleCharacter(skel, parts, pose){
  const skelWorld = resolveBoneWorlds(skel, pose);
  const pieces = [];
  for(const part of parts) gatherScene(skel, skelWorld, part, pose, pieces);
  return pieces;
}

module.exports = { assembleCharacter, gatherScene, applyMatrix };
