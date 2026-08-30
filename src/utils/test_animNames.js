'use strict';

// Clip names come from the actor state scripts. Getting a label wrong is not
// dangerous, but a label that cannot tell 00016 from 00017 is useless, and one
// that names a weapon instead of the action is worse than a number.
// Run: node src/utils/test_animNames.js [path/to/resources/script]

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseScript, buildAnimNames, prettyFunc, prettyParam } = require('./animNames');

const SAMPLE = `
function DamageState_WeaponUnused( state )
	state:GetAnimParam( ANIMPARAMLIST_FRONT ):SetAnim( "00016", 0, 0, 0, LOOP_FALSE, 1.0, RESET_TRUE );
	state:GetAnimParam( ANIMPARAMLIST_BACK  ):SetAnim( "00017", 0, 0, 0, LOOP_FALSE, 1.0, RESET_TRUE );
	lowerPartStateSet:GetWalkAnimParam( LOWER_ANIM_FRONT ):SetAnim( "H0004", 0, 500, 0, LOOP_TRUE, 1.0, RESET_FALSE );
end
function DamageState_DemonicKnuckle( state )
	state:GetAnimParam( ANIMPARAMLIST_FRONT ):SetAnim( "00016", 0, 0, 0, LOOP_FALSE, 1.0, RESET_TRUE );
end
`;

const uses = parseScript(SAMPLE, 'sample.lua');
assert.strictEqual(uses.length, 4, 'expected 4 SetAnim calls, got ' + uses.length);
assert.strictEqual(uses[0].clip, '00016');
assert.strictEqual(uses[0].func, 'DamageState_WeaponUnused');
assert.strictEqual(uses[0].param, 'ANIMPARAMLIST_FRONT');
assert.strictEqual(uses[2].clip, 'H0004', 'the lower part call was missed');

assert.strictEqual(prettyParam('ANIMPARAMLIST_LEFT_FRONT'), 'Left Front');
assert.strictEqual(prettyFunc('TypeBindAddRunAIActorState'), 'Run', 'scaffolding words not stripped');
assert.strictEqual(prettyFunc('ActorState_Dodge'), 'Dodge');

const built = buildAnimNames([{ name: 'sample.lua', text: SAMPLE }]);

// the label is the raw script name: function plus parameter, weapon included,
// because for the run states each weapon has its own clip and the weapon is the
// point. The direction still has to survive, it is what separates 16 from 17.
assert.ok(/^DamageState_\w+_front$/.test(built.names['00016'].label),
  'unexpected label: ' + built.names['00016'].label);
assert.ok(/_back$/.test(built.names['00017'].label), 'direction lost: ' + built.names['00017'].label);
assert.notStrictEqual(built.names['00016'].label, built.names['00017'].label);
assert.strictEqual(built.names['H0004'].label, 'DamageState_WeaponUnused_lower_front',
  'the lower part prefix was dropped: ' + built.names['H0004'].label);

// the tidied form is still available, and there the weapon is dropped
assert.strictEqual(built.names['00016'].short, 'Damage - Front');
assert.ok(!/Knuckle/i.test(built.names['00016'].short));

// a commented out SetAnim must not count as a use
const NL = String.fromCharCode(10);
const COMMENTED = ['function F( state )',
  '  --state:GetAnimParam( A ):SetAnim( "ZZZZZ", 0 );',
  'end'].join(NL);
const commented = buildAnimNames([{ name: 'c.lua', text: COMMENTED }]);
assert.ok(!commented.names['ZZZZZ'], 'a commented out clip was picked up');

console.log('ok  raw script names, direction kept, comments ignored, tidy form still there');

const DIR = process.argv[2] || 'C:/S4Plain/extracted_resources/resources/script';
if (!fs.existsSync(DIR)) {
  console.log('skip: no script folder at ' + DIR);
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter(f => /\.lua$/i.test(f))
  .map(f => ({ name: f, text: fs.readFileSync(path.join(DIR, f), 'latin1') }));
const real = buildAnimNames(files);

assert.ok(real.clips > 500, 'only ' + real.clips + ' clips named from ' + files.length + ' scripts');
for (const c of ['00016', '00017', '00018', '00019']) {
  assert.ok(real.names[c] && real.names[c].label, c + ' has no label');
}
const dirs = ['00016', '00017', '00018', '00019'].map(c => real.names[c].label);
assert.strictEqual(new Set(dirs).size, 4, 'the four damage directions share labels: ' + dirs.join(' | '));

// the dodge state, straight out of actorstates_gameplay.lua
const dodge = { '00038': 'front', '00041': 'back', '00005': 'left', '00056': 'right' };
for (const [clip, dir] of Object.entries(dodge)) {
  assert.strictEqual(real.names[clip].label, 'ActorState_Dodge_dodge_' + dir,
    clip + ' should be the ' + dir + ' dodge, got ' + real.names[clip].label);
}

console.log('ok  ' + files.length + ' scripts -> ' + real.clips + ' clips named');
console.log('    00008 ' + real.names['00008'].label + '  |  00000 ' + real.names['00000'].label +
            '  |  00016 ' + real.names['00016'].label);

// The baked file is what the viewer actually reads, so a stale or truncated one
// is a dropdown full of numbers no matter how well the parser works.
const BAKED = path.join(__dirname, '..', 'data', 'animNames.json');
if (fs.existsSync(BAKED)) {
  const baked = JSON.parse(fs.readFileSync(BAKED, 'utf8'));
  assert.ok(baked.names && Object.keys(baked.names).length > 500,
    'baked file has only ' + Object.keys(baked.names || {}).length + ' names');
  assert.strictEqual(baked.names['S0000'], 'Skill_Bind_normal');
  assert.strictEqual(baked.names['00038'], 'ActorState_Dodge_dodge_front');
  for (const [clip, label] of Object.entries(baked.names)) {
    assert.strictEqual(typeof label, 'string', clip + ' is not a plain label');
  }
  // regenerating must not silently lose names
  assert.ok(Object.keys(baked.names).length >= Object.values(real.names).filter(v => v.label).length,
    'the baked file is behind the scripts, run node src/utils/genAnimNames.js');
  console.log('ok  baked ' + Object.keys(baked.names).length + ' names');
}
