'use strict';
const fs = require('fs');
const path = require('path');

const SETANIM_RE = /Get(?:Walk)?AnimParam\s*\(\s*([A-Z0-9_]+)\s*\)\s*:\s*SetAnim\s*\(\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(LOOP_\w+)\s*,\s*([\d.]+)\s*,\s*(RESET_\w+)/g;
const SOUND_RE = /Add(SoundBySex|Sound)\s*\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)"\s*)?,\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)/g;

function parseActorStates(scriptDir){
  const out = {};
  let files;
  try { files = fs.readdirSync(scriptDir); } catch(e){ return out; }
  for(const f of files){
    if(!/^actorstates_.*\.lua$/i.test(f)) continue;
    const text = fs.readFileSync(path.join(scriptDir, f), 'latin1');
    const marks = []; let m;
    const fnRe = /function\s+(\w+)\s*\(/g;
    while((m = fnRe.exec(text))) marks.push({ name: m[1], at: m.index });
    for(let i = 0; i < marks.length; i++){
      const body = text.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : text.length);
      const anims = [], sounds = [];
      let c;
      SETANIM_RE.lastIndex = 0;
      while((c = SETANIM_RE.exec(body))) anims.push({
        label: c[1], clip: c[2], startMs: +c[3], blendOutMs: +c[4], delayMs: +c[5],
        loop: c[6] === 'LOOP_TRUE', rate: +c[7], reset: c[8] === 'RESET_TRUE',
      });
      SOUND_RE.lastIndex = 0;
      while((c = SOUND_RE.exec(body))) sounds.push({
        bySex: c[1] === 'SoundBySex', man: c[2], girl: c[3] || c[2], bone: c[4], start: +c[5], end: +c[6],
      });
      if(anims.length || sounds.length) out[marks[i].name] = { anims, sounds };
    }
  }
  return out;
}

function runDir(inX, inZ){
  const f = inZ > 0.5, b = inZ < -0.5, l = inX < -0.5, r = inX > 0.5;
  if(f && l) return 'LEFT_FRONT'; if(f && r) return 'RIGHT_FRONT';
  if(b && l) return 'LEFT_BACK'; if(b && r) return 'RIGHT_BACK';
  if(b) return 'BACK'; if(l) return 'LEFT'; if(r) return 'RIGHT';
  return 'FRONT';
}

function upper(fn){ return fn ? fn.anims.filter(a => /^ANIMPARAMLIST_/.test(a.label)) : []; }
function firstSound(fn){ return fn && fn.sounds.length ? fn.sounds[0] : null; }

function funcBody(text, name){
  const m = text.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)([\\s\\S]*?)\\nend', 'm'));
  return m ? m[1] : '';
}
function parseDispatch(body){
  const map = {}; let m; const re = /(\w+)\s*\(\s*state:GetStatePerWeapon\(\s*(WEAPONTYPE_\w+)/g;
  while((m = re.exec(body))){ if(!(m[2] in map)) map[m[2]] = m[1]; }
  return map;
}
function parseAttackAttribs(scriptDir){
  let text = '';
  try { text = fs.readFileSync(path.join(scriptDir, 'attackattribindexer.lua'), 'latin1'); } catch(e){ return {}; }
  const out = {};
  const parts = text.split(/GetAttackAttrib\(\s*(ATTACKATTRIB_\w+)\s*\)/);
  for(let i = 1; i < parts.length; i += 2){
    const name = parts[i], body = parts[i + 1] || '';
    const dmg = (body.match(/SetDamageData\s*\(\s*(\d+)/) || [])[1];
    const ds = body.match(/SetDamageSequence\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/);
    const as = body.match(/SetAttackSequence\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"/);
    out[name] = {
      damage: +dmg || 0,
      power: (body.match(/SetPower\s*\(\s*(POWER_\w+)/) || [])[1] || '',
      weaponType: (body.match(/SetWeaponType\s*\(\s*(WEAPONTYPE_\w+)/) || [])[1] || '',
      hitSeq: ds ? ds[1] : '', hitSound: ds ? ds[3] : '',
      atkSeq: as ? as[1] : '', atkSound: as ? as[2] : '',
      killImg: (body.match(/SetKillMessageImage\s*\(\s*"([^"]*)"/) || [])[1] || '',
    };
  }
  return out;
}
function weaponAttribs(attribMap, weaponType){
  if(!attribMap || !weaponType) return {};
  const mine = Object.entries(attribMap).filter(([, a]) => a.weaponType === weaponType);
  const pick = re => { const e = mine.find(([n]) => re.test(n)); return e ? e[1] : null; };
  const weak = pick(/_STAND_WEAK$/) || pick(/WEAK$/) || (mine.find(([, a]) => a.power === 'POWER_WEAK') || [])[1] || (mine[0] || [])[1];
  const strong = pick(/_STAND_STRONG$/) || pick(/STRONG$/) || (mine.find(([, a]) => a.power === 'POWER_STRONG') || [])[1] || weak;
  return { weak: weak || null, strong: strong || null };
}

function weaponAttackMap(scriptDir){
  let text = '';
  try { text = fs.readFileSync(path.join(scriptDir, 'actorstates_gameplay.lua'), 'latin1'); } catch(e){ return null; }
  const typeBySuffix = {}; let m;
  const normBody = funcBody(text, 'ActorState_Normal');
  const nre = /NormalState_(\w+)\s*\(\s*state:GetStatePerWeapon\(\s*(WEAPONTYPE_\w+)/g;
  while((m = nre.exec(normBody))){ if(!(m[1] in typeBySuffix)) typeBySuffix[m[1]] = m[2]; }
  return {
    typeBySuffix,
    weakByType: parseDispatch(funcBody(text, 'UseWeapon1_Weak')),
    strongByType: parseDispatch(funcBody(text, 'UseWeapon1_Strong')),
    use1ByType: parseDispatch(funcBody(text, 'UseWeapon1')),
  };
}

function weaponAnim(parsed, weapon, attackMap, attribMap){
  const get = n => parsed[n + '_' + weapon];
  const norm = get('NormalState'), run = get('RunState');
  let weak = get('SwordAtkWeakState'), strong = get('SwordAtkStrongState');
  if(attackMap && attackMap.typeBySuffix){
    const type = attackMap.typeBySuffix[weapon];
    if(type){
      const use1 = attackMap.use1ByType && attackMap.use1ByType[type];
      if(!weak || !upper(weak).length){ const f = attackMap.weakByType[type] || use1; if(f && parsed[f]) weak = parsed[f]; }
      if(!strong || !upper(strong).length){ const f = attackMap.strongByType[type] || use1; if(f && parsed[f]) strong = parsed[f]; }
    }
  }
  const jatk = get('SwordJumpAtkState'), jweak = get('SwordJumpAtkWeakState');

  const runByDir = {};
  for(const a of upper(run)){
    if(!/UPPER_/.test(a.label)) continue;
    const d = a.label.replace(/^ANIMPARAMLIST_UPPER_/, '');
    if(!(d in runByDir)) runByDir[d] = a;
  }

  const type = attackMap && attackMap.typeBySuffix && attackMap.typeBySuffix[weapon];
  const isMelee = type ? /SWORD|BLADE|KNUCKLE|CLAW|SCYTHE|BAT|KATANA|DAGGER|SHIELD|CARD|BOOTS|BREAKER/i.test(type) : true;
  const reload = upper(parsed['ReloadState_' + weapon])[0] || null;
  const at = weaponAttribs(attribMap, type);

  return {
    idle: upper(norm)[0] || null,
    run: runByDir,
    atkWeak: upper(weak),
    atkStrong: upper(strong)[0] || null,
    jumpAtk: upper(jatk)[0] || null,
    jumpAtkWeak: upper(jweak)[0] || null,
    reload,
    isGun: !!type && !isMelee,
    dmgWeak: at.weak ? at.weak.damage : 0, dmgStrong: at.strong ? at.strong.damage : 0,
    hitSoundWeak: at.weak ? at.weak.hitSound : '', hitSoundStrong: at.strong ? at.strong.hitSound : '',
    hitSeqWeak: at.weak ? at.weak.hitSeq : '', hitSeqStrong: at.strong ? at.strong.hitSeq : '',
    sndWeak: firstSound(weak), sndStrong: firstSound(strong),
  };
}

const RUN_SLOT = { FRONT: 8, LEFT_FRONT: 9, LEFT: 10, LEFT_BACK: 11, RIGHT_FRONT: 12, RIGHT: 13, RIGHT_BACK: 14, BACK: 15 };

function baseParams(parsed){
  const up = fn => upper(parsed[fn]);
  const run = new Array(16).fill(null);
  for(const a of up('RunState_WeaponUnused')){
    if(!/UPPER_/.test(a.label)) continue;
    const slot = RUN_SLOT[a.label.replace(/^ANIMPARAMLIST_UPPER_/, '')];
    if(slot != null){ run[slot] = a; run[slot - 8] = a; }
  }
  return {
    NORMAL: up('NormalState_WeaponUnused'),
    RUN: run,
    SIT: up('ActorState_Sit'),
    JUMP: up('ActorState_Jump'),
    BOUNDJUMP: up('ActorState_BoundJump'),
    FALL: up('ActorState_Fall'),
    DODGE: up('ActorState_Dodge'),
    FASTRUN: up('ActorState_FastRun'),
  };
}

function weaponDefs(parsed, weapon){
  const norm = upper(parsed['NormalState_' + weapon]);
  const runFn = parsed['RunState_' + weapon];
  const out = {};
  if(norm.length) out.NORMAL = norm;
  if(runFn){
    const run = new Array(16).fill(null);
    for(const a of upper(runFn)){
      if(!/UPPER_/.test(a.label)) continue;
      const slot = RUN_SLOT[a.label.replace(/^ANIMPARAMLIST_UPPER_/, '')];
      if(slot != null){ run[slot] = a; run[slot - 8] = a; }
    }
    out.RUN = run;
  }
  return out;
}

module.exports = { parseActorStates, weaponAnim, weaponAttackMap, parseAttackAttribs, weaponAttribs, runDir, baseParams, weaponDefs };

if(require.main === module){
  const p = parseActorStates(process.argv[2] || '.');
  const wa = weaponAnim(p, process.argv[3] || 'PlasmaSword');
  console.log('funcs:', Object.keys(p).length);
  console.log(JSON.stringify(wa, null, 1));
}
