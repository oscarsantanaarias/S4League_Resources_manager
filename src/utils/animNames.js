'use strict';

// Clips inside a .scn are named "00008", "H0004" and nothing else. What they
// actually are lives in the actor state scripts:
//
//   function DamageState_WeaponUnused( state )
//     state:GetAnimParam( ANIMPARAMLIST_FRONT ):SetAnim( "00016", ... )
//
// so 00016 is the front damage reaction for an unarmed actor. This pulls that
// out of the .lua files and builds clip -> readable name.

const CALL_RE = /:SetAnim\s*\(\s*"([^"]+)"/g;
const FUNC_RE = /^\s*function\s+([A-Za-z0-9_]+)/;
const PARAM_RE = /Get\w*AnimParam\s*\(\s*([A-Za-z0-9_]+)\s*\)/;

// ANIMPARAMLIST_LEFT_FRONT -> "Left Front"
function prettyParam(name) {
  return String(name || '')
    .replace(/^ANIMPARAMLIST_/, '')
    .replace(/^LOWER_ANIM_/, '')
    .replace(/^UPPER_ANIM_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Function names carry the action plus a lot of scaffolding and, often, which
// weapon the state belongs to. The same clip is reused by dozens of weapons, so
// the weapon is noise: what identifies the clip is the action.
//
//   TypeBindAddRunAIActorState  -> "Run"
//   DamageState_WeaponUnused    -> "Damage"
//   ActorState_Dodge            -> "Dodge"
const FILLER = new Set([
  'state', 'states', 'actor', 'aiactor', 'ai', 'add', 'common', 'type', 'bind',
  'set', 'get', 'init', 'setup', 'create', 'make', 'param', 'params', 'weapon',
  'unused', 'lower', 'upper', 'part',
]);

function prettyFunc(name) {
  const words = String(name || '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);

  const kept = words.filter(w => !FILLER.has(w.toLowerCase()));
  const useful = kept.length ? kept : words;
  return useful.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// One .lua: every SetAnim, with the function and parameter around it.
function parseScript(text, fileName) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let fn = '';

  for (const raw of lines) {
    // the scripts keep old versions around commented out, and a commented
    // SetAnim would otherwise count as a real use
    const line = raw.replace(/--.*$/, '');
    if (!line.trim()) continue;

    const f = line.match(FUNC_RE);
    if (f) { fn = f[1]; continue; }

    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(line)) !== null) {
      const p = line.match(PARAM_RE);
      out.push({
        clip: m[1],
        func: fn,
        param: p ? p[1] : '',
        file: fileName || '',
      });
    }
  }
  return out;
}

// Many files -> clip -> { label, uses }. The label is the most common use, so a
// clip referenced by twenty weapons as "Front" reads as "Front" and not as
// whichever file happened to be scanned first.
function buildAnimNames(files) {
  const byClip = new Map();

  for (const { name, text } of files) {
    for (const use of parseScript(text, name)) {
      if (!byClip.has(use.clip)) byClip.set(use.clip, []);
      byClip.get(use.clip).push(use);
    }
  }

  const names = {};
  for (const [clip, uses] of byClip) {
    // Group by parameter first. Within a group the function names differ only by
    // which weapon the state belongs to - DamageState_DemonicKnuckle,
    // DamageState_Katana - so the words they all share are the action, and the
    // rest is the weapon, which says nothing about the clip.
    const byParam = new Map();
    for (const u of uses) {
      const par = prettyParam(u.param);
      if (!byParam.has(par)) byParam.set(par, []);
      byParam.get(par).push(prettyFunc(u.func));
    }

    const tally = new Map();
    for (const [par, funcs] of byParam) {
      let common = funcs[0] ? funcs[0].split(' ') : [];
      for (const f of funcs.slice(1)) {
        const words = new Set(f.split(' '));
        common = common.filter(w => words.has(w));
      }
      const action = (common.length ? common : (funcs[0] || '').split(' ')).join(' ').trim();
      const key = [action, par].filter(Boolean).join(' - ');
      if (!key) continue;
      tally.set(key, { n: funcs.length, hasParam: !!par });
    }
    // A label carrying the parameter wins even if it is rarer: "Damage - Front"
    // and "Damage - Back" are what tell 00016 and 00017 apart, while the bare
    // "Damage" they share says nothing.
    const ranked = [...tally]
      .map(([k, v]) => [k, v.n, v.hasParam])
      .sort((a, b) => (b[2] - a[2]) || (b[1] - a[1]) || a[0].localeCompare(b[0]));

    // The raw name is what the label is: RunState_MachineGun_upper_front says
    // which weapon and which part, and for the run states the weapon is the
    // whole point - each one has its own clip. The tidied version is kept as
    // `short` for anywhere that needs something narrower.
    const rawTally = new Map();
    for (const u of uses) {
      const raw = [u.func, String(u.param || '')
        .replace(/^ANIMPARAMLIST_/, '')
        .replace(/^LOWER_ANIM_/, 'lower_')
        .replace(/^UPPER_ANIM_/, 'upper_')
        .toLowerCase()].filter(Boolean).join('_');
      if (!raw) continue;
      rawTally.set(raw, (rawTally.get(raw) || 0) + 1);
    }
    const rawRanked = [...rawTally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    names[clip] = {
      label: rawRanked.length ? rawRanked[0][0] : (ranked.length ? ranked[0][0] : ''),
      short: ranked.length ? ranked[0][0] : '',
      count: uses.length,
      alternatives: rawRanked.slice(1, 8).map(r => r[0]),
      files: [...new Set(uses.map(u => u.file))].slice(0, 8),
    };
  }
  return { names, clips: Object.keys(names).length };
}

module.exports = { parseScript, buildAnimNames, prettyParam, prettyFunc };
