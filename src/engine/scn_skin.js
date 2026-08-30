'use strict';

function mat4Mul(A, B){
  const C = new Array(16);
  for(let r = 0; r < 4; r++)
    for(let c = 0; c < 4; c++)
      C[r*4+c] = A[r*4+0]*B[0*4+c] + A[r*4+1]*B[1*4+c] + A[r*4+2]*B[2*4+c] + A[r*4+3]*B[3*4+c];
  return C;
}

function mat4InvAffine(m){
  const a=m[0],b=m[1],c=m[2], d=m[4],e=m[5],f=m[6], g=m[8],h=m[9],i=m[10];
  const C00=e*i-f*h, C01=-(d*i-f*g), C02=d*h-e*g;
  const det = a*C00 + b*C01 + c*C02;
  if(Math.abs(det) < 1e-12) return m.slice();
  const id = 1/det;
  const n0=C00*id, n1=-(b*i-c*h)*id, n2=(b*f-c*e)*id;
  const n3=C01*id, n4=(a*i-c*g)*id,  n5=-(a*f-c*d)*id;
  const n6=C02*id, n7=-(a*h-b*g)*id, n8=(a*e-b*d)*id;
  const tx=m[12], ty=m[13], tz=m[14];
  return [
    n0, n1, n2, 0,
    n3, n4, n5, 0,
    n6, n7, n8, 0,
    -(tx*n0 + ty*n3 + tz*n6), -(tx*n1 + ty*n4 + tz*n7), -(tx*n2 + ty*n5 + tz*n8), 1
  ];
}

function buildTRS(T, q, S){
  const x=q[0], y=q[1], z=q[2], w=q[3];
  return [
    S[0]*(1-2*(y*y+z*z)), S[0]*(2*(x*y+z*w)),   S[0]*(2*(x*z-y*w)),   0,
    S[1]*(2*(x*y-z*w)),   S[1]*(1-2*(x*x+z*z)), S[1]*(2*(y*z+x*w)),   0,
    S[2]*(2*(x*z+y*w)),   S[2]*(2*(y*z-x*w)),   S[2]*(1-2*(x*x+y*y)), 0,
    T[0], T[1], T[2], 1
  ];
}

function sampleVec(keys, def, t){
  if(!keys.length) return def;
  if(t <= keys[0].t) return keys[0].v;
  for(let i = 1; i < keys.length; i++){
    if(t <= keys[i].t){
      const t0 = keys[i-1].t, t1 = keys[i].t;
      const a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const A = keys[i-1].v, B = keys[i].v;
      return [A[0]+(B[0]-A[0])*a, A[1]+(B[1]-A[1])*a, A[2]+(B[2]-A[2])*a];
    }
  }
  return keys[keys.length-1].v;
}

function sampleQuat(keys, def, t){
  if(!keys.length) return def.slice();
  if(t <= keys[0].t) return keys[0].q.slice();
  for(let i = 1; i < keys.length; i++){
    if(t <= keys[i].t){
      const A = keys[i-1], B = keys[i];
      const a = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0;
      const d = A.q[0]*B.q[0]+A.q[1]*B.q[1]+A.q[2]*B.q[2]+A.q[3]*B.q[3];
      const s = d < 0 ? -1 : 1;
      const o = [
        A.q[0]+(B.q[0]*s-A.q[0])*a, A.q[1]+(B.q[1]*s-A.q[1])*a,
        A.q[2]+(B.q[2]*s-A.q[2])*a, A.q[3]+(B.q[3]*s-A.q[3])*a
      ];
      const l = Math.hypot(o[0], o[1], o[2], o[3]);
      if(l > 1e-6){ o[0]/=l; o[1]/=l; o[2]/=l; o[3]/=l; }
      return o;
    }
  }
  return keys[keys.length-1].q.slice();
}

function composeTRS(a, tick){
  const t = a.duration ? (tick % a.duration) : tick;
  const T = sampleVec(a.trans, a.initT, t);
  const S = sampleVec(a.scale, a.initS, t);
  const q = sampleQuat(a.rot, a.initR, t);
  return buildTRS(T, q, S);
}

const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function sampleNode(m, tick){
  if(!m.anims.length || !m.anims[0].hasTransform) return IDENT.slice();
  const a = m.anims[0];
  const bind = buildTRS(a.initT, a.initR, a.initS);
  const cur = composeTRS(a, tick);
  return mat4Mul(mat4InvAffine(bind), cur);
}

function findAnim(bone, name){
  for(const a of bone.anims) if(a.name === name) return a;
  return null;
}

function sampleBoneTRS(bone, animName, tick){
  const a = findAnim(bone, animName);
  if(!a || !a.hasTransform) return null;
  const t = a.duration ? (tick % a.duration) : tick;
  return { T: sampleVec(a.trans, a.initT, t), q: sampleQuat(a.rot, a.initR, t), S: sampleVec(a.scale, a.initS, t) };
}

function sampleBonePose(bone, p){
  const A = sampleBoneTRS(bone, p.clipA, p.tickA);
  if(p.blend > 0.001 && p.clipB && p.clipB !== p.clipA && A){
    const B = sampleBoneTRS(bone, p.clipB, p.tickB);
    if(B){
      const w = p.blend > 1 ? 1 : p.blend;
      const T = [A.T[0]+(B.T[0]-A.T[0])*w, A.T[1]+(B.T[1]-A.T[1])*w, A.T[2]+(B.T[2]-A.T[2])*w];
      const S = [A.S[0]+(B.S[0]-A.S[0])*w, A.S[1]+(B.S[1]-A.S[1])*w, A.S[2]+(B.S[2]-A.S[2])*w];
      const s = (A.q[0]*B.q[0]+A.q[1]*B.q[1]+A.q[2]*B.q[2]+A.q[3]*B.q[3]) < 0 ? -1 : 1;
      const q = [0,0,0,0];
      for(let i = 0; i < 4; i++) q[i] = A.q[i] + (B.q[i]*s - A.q[i])*w;
      const l = Math.hypot(q[0], q[1], q[2], q[3]);
      if(l > 1e-6){ q[0]/=l; q[1]/=l; q[2]/=l; q[3]/=l; }
      return buildTRS(T, q, S);
    }
  }
  if(A) return buildTRS(A.T, A.q, A.S);
  const a = findAnim(bone, p.clipA);
  if(a && a.hasTransform) return composeTRS(a, p.tickA);
  return null;   // caller substitutes the bind local, see resolveBoneWorlds
}

function resolveBoneWorlds(sc, pose){
  const nb = sc.bones.length;
  const local = new Array(nb), world = new Array(nb), parent = new Array(nb).fill(-1), done = new Array(nb).fill(false);
  const byName = new Map();
  for(let i = 0; i < nb; i++) byName.set(sc.bones[i].name, i);
  for(let i = 0; i < nb; i++){
    const p = sc.bones[i].parent;
    if(p && byName.has(p)) parent[i] = byName.get(p);
  }
  // Bones carry ABSOLUTE matrices. A bone with no track for this clip must keep
  // its fixed relation to the parent, which is boneMatrix * inv(parentMatrix).
  // Feeding it an absolute matrix as if it were local applies the parent twice
  // and throws the bone across the map, which is what used to happen to every
  // dummy and twist bone (ForeTwist, ber_arm_*, *_Dummy) on most clips.
  for(let i = 0; i < nb; i++){
    const posed = sampleBonePose(sc.bones[i], pose);
    if(posed){ local[i] = posed; continue; }
    local[i] = parent[i] < 0
      ? sc.bones[i].matrix.slice()
      : mat4Mul(sc.bones[i].matrix, mat4InvAffine(sc.bones[parent[i]].matrix));
  }
  let progress = true;
  while(progress){
    progress = false;
    for(let i = 0; i < nb; i++){
      if(done[i]) continue;
      if(parent[i] < 0){ world[i] = local[i]; done[i] = true; progress = true; }
      else if(done[parent[i]]){ world[i] = mat4Mul(local[i], world[parent[i]]); done[i] = true; progress = true; }
    }
  }
  for(let i = 0; i < nb; i++) if(!done[i]) world[i] = local[i];
  return world;
}

function boneWorldByName(sc, boneName, pose){
  const idx = sc.bones.findIndex(b => b.name === boneName);
  if(idx < 0) return null;
  return resolveBoneWorlds(sc, pose)[idx];
}
function boneWorldByNameW(sc, boneName, world){
  const idx = sc.bones.findIndex(b => b.name === boneName);
  return (idx < 0 || !world) ? null : world[idx];
}

function skinModel(m, sc, pose){ return skinModelW(m, sc, resolveBoneWorlds(sc, pose)); }

function skinModelW(m, sc, world){
  const n = m.positions.length;
  const out = new Float32Array(n);
  out.set(m.positions);
  if(!m.skin.length || !sc.bones.length || !world) return out;

  const boneIdx = new Map();
  for(let j = 0; j < sc.bones.length; j++) boneIdx.set(sc.bones[j].name, j);

  const nv = n / 3;
  const acc = new Float32Array(n);
  const wsum = new Float32Array(nv);

  for(const sb of m.skin){
    const bi = boneIdx.has(sb.name) ? boneIdx.get(sb.name) : -1;
    const skin = bi >= 0 ? mat4Mul(sb.bind, world[bi]) : IDENT;
    for(const bw of sb.weights){
      const vi = bw.vertex;
      if(vi >= nv) continue;
      const vx = m.positions[vi*3], vy = m.positions[vi*3+1], vz = m.positions[vi*3+2];
      const px = vx*skin[0]+vy*skin[4]+vz*skin[8]+skin[12];
      const py = vx*skin[1]+vy*skin[5]+vz*skin[9]+skin[13];
      const pz = vx*skin[2]+vy*skin[6]+vz*skin[10]+skin[14];
      acc[vi*3] += px*bw.weight; acc[vi*3+1] += py*bw.weight; acc[vi*3+2] += pz*bw.weight;
      wsum[vi] += bw.weight;
    }
  }
  for(let i = 0; i < nv; i++){
    if(wsum[i] > 1e-4){ out[i*3] = acc[i*3]/wsum[i]; out[i*3+1] = acc[i*3+1]/wsum[i]; out[i*3+2] = acc[i*3+2]/wsum[i]; }
  }
  return out;
}

module.exports = { mat4Mul, mat4InvAffine, buildTRS, sampleNode, resolveBoneWorlds, boneWorldByName, boneWorldByNameW, skinModel, skinModelW };
