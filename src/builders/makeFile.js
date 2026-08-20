const { getDirectories, root } = require('../utils/directory');
const weapons_lua = require('../utils/weapon_lua_func');


function makeCostumeItemx7(newID, icon, displayName, sex, sceneFile, costumeType, options = {}){
    const cleanType = String(costumeType || '').toLowerCase();
    const nodeParent = options.nodeParent || (cleanType === 'pets' || cleanType === 'pet' ? 'Bip01' : 'Bip01 Head');
    const animationPart = options.animationPart ?? '0';
    const hidingOption = options.hidingOption ? ` hiding_option="${options.hidingOption}"` : '';
    const nodeTypes = new Set(['hair', 'face', 'acc', 'accessories', 'hats', 'pets']);
    const graphic = nodeTypes.has(cleanType)
        ? `<graphic icon_image="${icon}" to_node_scene_file1="${sceneFile}" to_node_parent_node1="${nodeParent}" to_node_animation_part1="${animationPart}"${hidingOption}/>`
        : `<graphic icon_image="${icon}" to_part_scene_file="${sceneFile}"/>`;

    return `
        <item item_key="${newID}">
        <base name="${displayName}" name_key="N${newID}" attrib_comment_key="T${newID}" sex="${sex}"/>
        ${graphic}
        <esperchip/>
        <etc/>
        <sequence/>
    </item> 
    `;
}


async function makeItemx7(newID, icon, displayName, nameID, tipID, weaType){
    let parent_n = false;

    
if(weaType === 'PlasmaSword' || weaType === 'Submachine') {
	parent_n = `<etc parent_number="0"/>`;
}

if(weaType === 'Bat'){
	parent_n = `<etc parent_number="3"/>`;
}

if(weaType === 'Breaker'){
	parent_n = `<etc parent_number="13"/>`;
}

if(weaType === 'CounterSword' || weaType === 'Cannon' || weaType === 'EarthBomb' || weaType === 'Gauss' || weaType === 'LightBomb' || weaType === 'Revolver'){
	parent_n = `<etc parent_number="2"/>`;
}


if(weaType === 'RocketLauncher'){
	parent_n = `<etc parent_number="28"/>`;
}


if(weaType === 'Dagger' || weaType === 'Sharpshooting' || weaType === 'Smash'){
	parent_n = `<etc parent_number="6"/>`;
}


if(weaType === 'Exo'){
	parent_n = `<etc parent_number="25"/>`;
}


if(weaType === 'Fist'){
	parent_n = `<etc parent_number="29"/>`;
}


if(weaType === 'IronBoots'){
	parent_n = `<etc parent_number="27"/>`;
}

if(weaType === 'Katana' || weaType === 'SparkRifle'){
	parent_n = `<etc parent_number="18"/>`;
}

if(weaType === 'SigmaBlade'){
	parent_n = `<etc parent_number="17"/>`;
}


if(weaType === 'TwinBlades'){
	parent_n = `<etc parent_number="10"/>`;
}


if(weaType === 'VitalClaw'){
	parent_n = `<etc parent_number="31"/>`;
}

if(weaType === 'AirGun'){
	parent_n = `<etc parent_number="16"/>`;
}


if(weaType === 'Assault'){
	parent_n = `<etc parent_number="24"/>`;
}


if(weaType === 'DualMagnum'){
	parent_n = `<etc parent_number="26"/>`;
}


if(weaType === 'MineGun' || weaType === 'HeavyMachineGun' || weaType === 'RailGun' || weaType === 'SentryGun' || weaType === 'SentryStun'){
	parent_n = `<etc parent_number="1"/>`;
}


if(weaType === 'Homing'){
	parent_n = `<etc parent_number="15"/>`;
}


if(weaType === 'LightMachineGun' || weaType === 'HandGun'){
	parent_n = `<etc parent_number="7"/>`;
}


if(weaType === 'MindShock'){
	parent_n = `<etc parent_number="11"/>`;
}

if(weaType === 'MindHeal'){
	parent_n = `<etc parent_number="9"/>`;
}


if(weaType === 'RescueGun' || weaType === 'SemiRifle'){
	parent_n = `<etc parent_number="4"/>`;
}

if(weaType === 'ShotGun'){
	parent_n = `<etc parent_number="19"/>`;
}

if(weaType === 'SparkRifle'){
	parent_n = `<etc parent_number="18"/>`;
}

if(weaType === 'Turrent'){
	parent_n = `<etc parent_number="5"/>`;
}

if(!parent_n){
    console.error(`An error occured, the parent number for the weapon ${weaType} was not assigned!`);
    return;
}



	if(!nameID){
		return console.error('No esta el nameID definido');
	} else if(!tipID){
		return console.error('No tipID definido.')
	}

    return `
        <item item_key="${newID}">
        <base name="${displayName}" name_key="NAME${nameID || 'No name available.'}" attrib_comment_key="TIP${tipID || 'No comments available.'}" feature_comment_key="F_TEXT272" sex="unisex"/>
        <graphic icon_image="${icon}"/>
        <esperchip/>
        ${parent_n}
        <sequence/>
    </item> 
    `;
}



async function makeWeaponLua(id, weaType){

 return new Promise((resolve, reject) => {
        if(!id){
         console.error('ID is not defined in MakeLua.');
         return reject(false);
        }

        if(!weaType){
         console.log('Weapon Type is not defined in Weapon Lua.');
        return reject(false);
        }

    const allLuaFunctions = require('../utils/weapon_lua_func');

        const funct = 'get' + weaType;
        const buildingLuaFn = allLuaFunctions[funct];
        if(!buildingLuaFn){
         console.error(`Function ${weaType} does not exist.`);
         return reject(false);
        }

        const result = buildingLuaFn(id);

        if(!result){
       return reject(false);
        }

        
        resolve(result);

 });
       
}










module.exports = { makeItemx7, makeCostumeItemx7, makeWeaponLua };
