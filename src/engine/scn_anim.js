'use strict';

const STATE = {
  STANDBY: 4, NORMAL: 5, RUN: 6, SIT: 7, JUMP: 8, BOUNDJUMP: 9, FALL: 10,
  DODGE_LEFT: 11, DODGE_RIGHT: 12, FASTRUN: 21, IDLE: 29,
};

const P = (clip, startMs, blendOutMs, rate, reset) => ({ clip, startMs, blendOutMs, rate, reset });

const kNormalParams = [ P('00074', 0, 0, 1, false) ];
const kRunParams = [
  P('00008',0,0,1,false), P('00009',0,0,1,false), P('00010',0,0,1,false), P('00014',0,0,1,false),
  P('00011',0,0,1,false), P('00012',0,0,1,false), P('00015',0,0,1,false), P('00013',0,0,1,false),
  P('00008',0,0,1,false), P('00009',0,0,1,false), P('00010',0,0,1,false), P('00014',0,0,1,false),
  P('00011',0,0,1,false), P('00012',0,0,1,false), P('00015',0,0,1,false), P('00013',0,0,1,false),
];
const kSitParams = [
  P('00065',0,0,1,false), P('00057',0,0,1,false), P('00058',0,0,1,false), P('00059',0,0,1,false),
  P('00060',0,0,1,false), P('00061',0,0,1,false), P('00062',0,0,1,false), P('00063',0,0,1,false), P('00064',0,0,1,false),
];
const kJumpParams = [
  P('00000',0,1000,1,true), P('00001',0,0,1,true), P('00004',600,300,1,true),
  P('00003',500,500,0.8,true), P('00000',0,0,0.8,true), P('00002',0,0,1,true),
];
const kBoundJumpParams = [
  P('00066',500,500,1,true), P('00067',500,0,1,true), P('00067_2',500,1000,0.8,true),
  P('00002',0,0,1,true), P('00002',0,0,1,true), P('00003',0,0,1,true), P('00002',0,0,1,true),
];
const kFallParams = [ P('00002',0,0,1,true), P('00003',380,300,1,true) ];
const kDodgeParams = [
  P('00038',0,0,1,true), P('00041',0,0,1,true), P('00005',0,700,1,true),
  P('00056',0,700,1,true), P('00039',0,0,1,true), P('00042',0,0,1,true),
];
const kFastRunParams = [ P('00068',0,0,1,true), P('IB068',0,0,1,true) ];

const kStateDefs = {
  [STATE.STANDBY]: null, [STATE.NORMAL]: kNormalParams, [STATE.RUN]: kRunParams, [STATE.SIT]: kSitParams,
  [STATE.JUMP]: kJumpParams, [STATE.BOUNDJUMP]: kBoundJumpParams, [STATE.FALL]: kFallParams,
  [STATE.DODGE_LEFT]: kDodgeParams, [STATE.DODGE_RIGHT]: kDodgeParams, [STATE.FASTRUN]: kFastRunParams, [STATE.IDLE]: null,
};

const MIN_BLEND = 150;
const clipRate = {};
const clipTrim = {};
function applyTrim(clip, tick){
  const t = clipTrim[clip];
  if(!t || !(t.end - t.start > 100)) return tick;
  return t.start + (tick % (t.end - t.start));
}
function isLoco(c){ return (c >= '00008' && c <= '00015') || c === '00068' || c === 'IB068' || (c >= '00057' && c <= '00064'); }
function isAction(s){ return s === STATE.JUMP || s === STATE.FALL || s === STATE.DODGE_LEFT || s === STATE.DODGE_RIGHT || s === STATE.BOUNDJUMP; }

const kJumpMovePh = [ {slot:2,rule:3,ms:0}, {slot:4,rule:1,ms:250} ];
const kJumpStatPh = [ {slot:1,rule:2,ms:0}, {slot:5,rule:3,ms:0}, {slot:3,rule:1,ms:500} ];
const kFallPh = [ {slot:0,rule:3,ms:0}, {slot:1,rule:1,ms:500} ];
const kDodgePh = [ {slot:0,rule:1,ms:600} ];
const kBoundPh = [ {slot:1,rule:1,ms:350}, {slot:2,rule:1,ms:450}, {slot:3,rule:3,ms:0}, {slot:5,rule:1,ms:350} ];
function phaseListFor(s, c){
  if(s === STATE.JUMP) return c.jumpMoving ? kJumpMovePh : kJumpStatPh;
  if(s === STATE.FALL) return kFallPh;
  if(s === STATE.DODGE_LEFT || s === STATE.DODGE_RIGHT) return kDodgePh;
  if(s === STATE.BOUNDJUMP) return kBoundPh;
  return null;
}

function gate(s, c){
  const f = c.inZ > 0.5, b = c.inZ < -0.5, l = c.inX < -0.5, r = c.inX > 0.5;
  switch(s){
    case STATE.NORMAL: case STATE.IDLE: return 0;
    case STATE.FASTRUN: return 0;
    case STATE.RUN:
      if(f && l) return 9; if(f && r) return 12; if(b && l) return 11; if(b && r) return 14;
      if(b) return 15; if(l) return 10; if(r) return 13; return 8;
    case STATE.SIT:
      if(!c.moving) return 0;
      if(f && l) return 2; if(f && r) return 4; if(b && l) return 7; if(b && r) return 8;
      if(b) return 6; if(l) return 3; if(r) return 5; return 1;
    case STATE.JUMP:
      if(c.grounded) return c.jumpMoving ? 4 : 3;
      if(c.jumpMoving) return 2; if(c.velY > 0) return 1; return 5;
    case STATE.FALL: return c.grounded ? 1 : 0;
    case STATE.DODGE_LEFT: case STATE.DODGE_RIGHT: return (c.dodgeDir >= 0 && c.dodgeDir <= 3) ? c.dodgeDir : 0;
    case STATE.BOUNDJUMP: if(c.grounded) return 5; if(c.velY > 0) return 1; return 3;
    default: return 0;
  }
}

class AnimController {
  constructor(){
    this.state = STATE.NORMAL; this.paramIdx = -1;
    this.clipA = ''; this.clipB = ''; this.clockA = 0; this.clockB = 0;
    this.blendT = 1; this.blendDur = 0; this.rateA = 1; this.rateB = 1;
    this.locoA = false; this.locoB = false; this.prevBlendOut = 0;
    this.seqState = STATE.NORMAL; this.phaseIdx = 0; this.phaseClock = 0; this.actionBusy = false;
  }
  loadDefs(defs){
    if(!defs) return;
    if(!this.defs) this.defs = Object.assign({}, kStateDefs);
    const map = { NORMAL: STATE.NORMAL, RUN: STATE.RUN, SIT: STATE.SIT, JUMP: STATE.JUMP, BOUNDJUMP: STATE.BOUNDJUMP, FALL: STATE.FALL, FASTRUN: STATE.FASTRUN };
    for(const k in map){ if(defs[k] && defs[k].length) this.defs[map[k]] = defs[k]; }
    if(defs.DODGE && defs.DODGE.length){ this.defs[STATE.DODGE_LEFT] = defs.DODGE; this.defs[STATE.DODGE_RIGHT] = defs.DODGE; }
  }
  update(state, ctx, dtMs, clockScale = 1){
    const def = (this.defs || kStateDefs)[state] || null;
    let idx;
    if(isAction(state)){
      const ph = phaseListFor(state, ctx); const n = ph ? ph.length : 0;
      if(state !== this.seqState){ this.seqState = state; this.phaseIdx = 0; this.phaseClock = 0; }
      this.phaseClock += dtMs;
      while(ph && this.phaseIdx < n - 1){
        const cur = ph[this.phaseIdx];
        const done = (cur.rule === 1 && this.phaseClock >= cur.ms) || (cur.rule === 2 && ctx.velY <= 0) || (cur.rule === 3 && ctx.grounded);
        if(!done) break;
        this.phaseIdx++; this.phaseClock = 0;
      }
      const cur = ph[this.phaseIdx < n ? this.phaseIdx : n - 1];
      idx = (state === STATE.DODGE_LEFT || state === STATE.DODGE_RIGHT)
        ? ((ctx.dodgeDir >= 0 && ctx.dodgeDir <= 3) ? ctx.dodgeDir : 0) : cur.slot;
      if(this.phaseIdx < n - 1) this.actionBusy = true;
      else if(cur.rule === 1) this.actionBusy = this.phaseClock < cur.ms;
      else if(cur.rule === 3) this.actionBusy = !ctx.grounded;
      else if(cur.rule === 2) this.actionBusy = ctx.velY > 0;
      else this.actionBusy = true;
    } else {
      idx = gate(state, ctx);
      this.seqState = STATE.NORMAL; this.actionBusy = false;
    }

    const p = (def && idx >= 0 && idx < def.length) ? def[idx] : null;

    if(p && (state !== this.state || idx !== this.paramIdx)){
      if(!p.reset && this.clipB === p.clip){
        this.state = state; this.paramIdx = idx;
      } else {
        const fade = this.prevBlendOut;
        this.clipA = this.clipB; this.clockA = this.clockB; this.rateA = this.rateB; this.locoA = this.locoB;
        this.clipB = p.clip;
        this.clockB = p.reset ? 0 : this.clockB;
        this.rateB = (ctx.syncWindowMs > 1 && p.startMs > 0) ? p.startMs * p.rate / ctx.syncWindowMs : p.rate;
        this.locoB = isLoco(this.clipB);
        this.blendDur = Math.min(Math.max(fade, ctx.blendMin || 0), ctx.blendMax || 1e9); this.blendT = (this.blendDur > 1) ? 0 : 1;
        this.prevBlendOut = p.blendOutMs;
        this.state = state; this.paramIdx = idx;
      }
    } else if(!p && this.clipB === ''){
      this.clipB = '00074'; this.clockB = 0; this.rateB = 1; this.locoB = false; this.blendT = 1;
      this.state = state; this.paramIdx = -1;
    } else if(!p){
      this.state = state;
    }

    const warp = (ctx.refSpeed > 1) ? Math.max(0.05, Math.min(ctx.speed / ctx.refSpeed, 8)) : 1;
    this.clockB += dtMs * this.rateB * (this.locoB ? warp : 1) * clockScale * (clipRate[this.clipB] || 1);
    this.clockA += dtMs * this.rateA * (this.locoA ? warp : 1) * clockScale * (clipRate[this.clipA] || 1);
    if(this.blendDur > 1){ this.blendT += dtMs / this.blendDur; if(this.blendT > 1) this.blendT = 1; }

    if(this.blendT < 1 && this.clipA && this.clipA !== this.clipB){
      return { clipA: this.clipA, tickA: Math.floor(applyTrim(this.clipA, this.clockA)), clipB: this.clipB, tickB: Math.floor(applyTrim(this.clipB, this.clockB)), blend: this.blendT };
    }
    return { clipA: this.clipB, tickA: Math.floor(applyTrim(this.clipB, this.clockB)), blend: 0 };
  }
}

class Crossfader {
  constructor(){
    this.clipA = ''; this.clipB = ''; this.clockA = 0; this.clockB = 0;
    this.rateA = 1; this.rateB = 1; this.loopA = true; this.loopB = true;
    this.durA = 0; this.durB = 0; this.blendT = 1; this.blendDur = 0; this.prevBlendOut = 0;
    this.param = null;
  }
  set(param, durOf){
    if(!param || param.clip === this.clipB){ if(param) this.param = param; return; }
    const fade = this.prevBlendOut;
    this.clipA = this.clipB; this.clockA = this.clockB; this.rateA = this.rateB; this.loopA = this.loopB; this.durA = this.durB;
    this.clipB = param.clip; this.clockB = param.reset ? 0 : this.clockB;
    this.rateB = param.rate || 1; this.loopB = !!param.loop; this.durB = (durOf && durOf(param.clip)) || 0;
    this.blendDur = fade; this.blendT = fade > 1 ? 0 : 1; this.prevBlendOut = param.blendOutMs || 0;
    this.param = param;
  }
  update(dtMs, clockScale = 1){
    this.clockB += dtMs * this.rateB * clockScale * (clipRate[this.clipB] || 1);
    this.clockA += dtMs * this.rateA * clockScale * (clipRate[this.clipA] || 1);
    if(!this.loopB && this.durB > 0 && this.clockB > this.durB) this.clockB = this.durB;
    if(!this.loopA && this.durA > 0 && this.clockA > this.durA) this.clockA = this.durA;
    if(this.blendDur > 1){ this.blendT += dtMs / this.blendDur; if(this.blendT > 1) this.blendT = 1; }
    if(this.blendT < 1 && this.clipA && this.clipA !== this.clipB)
      return { clipA: this.clipA, tickA: Math.floor(applyTrim(this.clipA, this.clockA)), clipB: this.clipB, tickB: Math.floor(applyTrim(this.clipB, this.clockB)), blend: this.blendT };
    return { clipA: this.clipB, tickA: Math.floor(applyTrim(this.clipB, this.clockB)), blend: 0 };
  }
  done(){ return !this.loopB && this.durB > 0 && this.clockB >= this.durB; }
}

module.exports = { AnimController, STATE, clipRate, clipTrim, applyTrim, Crossfader };
