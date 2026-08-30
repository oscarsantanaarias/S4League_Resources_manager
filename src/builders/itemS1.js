
const SUB_CATEGORY_BY_TYPE = {
    hair: 0,
    face: 1,
    top: 2, body: 2,
    pants: 3, leg: 3,
    gloves: 4, hand: 4,
    shoes: 5, foot: 5,
    accessories: 6, acc: 6, hats: 6, pets: 6,
};

const NODE_TYPES = new Set(['hair', 'face', 'acc', 'accessories', 'hats', 'pets']);

const WEAPON_BASE_ID = {
    PlasmaSword: 2000001,
    Bat: 2000003,
    Katana: 2000004,
    VitalClaw: 2000005,
    Dagger: 2000006,
    CounterSword: 2000009,
    TwinBlades: 2000010,
    Submachine: 2010009,
    Revolver: 2010010,
    Homing: 2010015,
    AirGun: 2010016,
    SparkRifle: 2010018,
    HeavyMachineGun: 2020001,
    Gauss: 2020003,
    Cannon: 2030002,
    RainGun: 2030005,
    SentryGun: 2040004,
    SentryStun: 2040005,
    EarthBomb: 2050002,
    MindShock: 2060001,
    MindHeal: 2060003,
};

function weaponBaseId(weaType){
    return WEAPON_BASE_ID[weaType] || null;
}

function detectFormat(xmlText){
    const head = String(xmlText || '').slice(0, 4096);
    if(/<itemlist[\s>]/.test(head)) return 's10';
    if(/<iteminfo[\s>]/.test(head)) return 's1';
    return null;
}

function splitId(id){
    const value = Number(id);
    return {
        category: Math.floor(value / 1000000),
        subCategory: Math.floor(value / 10000) % 100,
        number: value % 10000,
    };
}

function buildId(category, subCategory, number){
    return category * 1000000 + subCategory * 10000 + number;
}

function subCategoryForType(costumeType){
    const clean = String(costumeType || '').toLowerCase();
    return SUB_CATEGORY_BY_TYPE[clean];
}

function normalizeSex(sex){
    const clean = String(sex || '').toLowerCase();
    if(clean === 'man' || clean === 'male') return 'man';
    if(clean === 'woman' || clean === 'female') return 'woman';
    return 'all';
}

function escapeAttr(value){
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function subCategoryBounds(xmlText, category, subCategory){
    const categoryOpen = new RegExp(`<category\\s+id="${category}"\\s*>`);
    const categoryMatch = categoryOpen.exec(xmlText);
    if(!categoryMatch) return null;

    const categoryStart = categoryMatch.index + categoryMatch[0].length;
    const categoryEnd = xmlText.indexOf('</category>', categoryStart);
    if(categoryEnd === -1) return null;

    const scope = xmlText.slice(categoryStart, categoryEnd);
    const subOpen = new RegExp(`<sub_category\\s+id="${subCategory}"\\s*>`);
    const subMatch = subOpen.exec(scope);
    if(!subMatch) return null;

    const contentStart = categoryStart + subMatch.index + subMatch[0].length;
    const closeIndex = xmlText.indexOf('</sub_category>', contentStart);
    if(closeIndex === -1 || closeIndex > categoryEnd) return null;

    return { contentStart, closeIndex };
}

function itemBlocks(xmlText, category, subCategory){
    const bounds = subCategoryBounds(xmlText, category, subCategory);
    if(!bounds) return [];

    const scope = xmlText.slice(bounds.contentStart, bounds.closeIndex);
    const blocks = [];
    const open = /<item\s+number="(\d+)"[^>]*>/g;
    let match;

    while((match = open.exec(scope)) !== null){
        const end = scope.indexOf('</item>', match.index);
        if(end === -1) break;
        blocks.push({
            number: Number(match[1]),
            start: bounds.contentStart + match.index,
            end: bounds.contentStart + end + '</item>'.length,
        });
        open.lastIndex = end;
    }

    return blocks;
}

function findItem(xmlText, id){
    const { category, subCategory, number } = splitId(id);
    const found = itemBlocks(xmlText, category, subCategory).find(block => block.number === number);
    return found ? xmlText.slice(found.start, found.end) : null;
}

function hasItem(xmlText, id){
    return findItem(xmlText, id) !== null;
}

function nextFreeId(xmlText, category, subCategory){
    const blocks = itemBlocks(xmlText, category, subCategory);
    const highest = blocks.reduce((max, block) => Math.max(max, block.number), -1);
    return buildId(category, subCategory, highest + 1);
}

function insertItem(xmlText, id, itemXml){
    const { category, subCategory } = splitId(id);
    const bounds = subCategoryBounds(xmlText, category, subCategory);
    if(!bounds){
        throw new Error(`iteminfo.x7 no tiene <category id="${category}"><sub_category id="${subCategory}">`);
    }

    const body = itemXml.replace(/^\s*\n/, '').replace(/\s*$/, '');
    return xmlText.slice(0, bounds.closeIndex) + body + '\n\t\t' + xmlText.slice(bounds.closeIndex);
}

function makeCostumeItem(id, icon, displayName, sex, sceneFile, costumeType, options = {}){
    const { number } = splitId(id);
    const clean = String(costumeType || '').toLowerCase();
    const wearingSex = normalizeSex(sex) === 'all' ? 'unisex' : normalizeSex(sex);
    const nodeParent = options.nodeParent || (clean === 'pets' || clean === 'pet' ? 'Bip01' : 'Bip01 Head');
    const animationPart = options.animationPart ?? '0';

    const partParent = options.partParent || (NODE_TYPES.has(clean) ? nodeParent : 'Bip01 Pelvis');
    const partAnimationPart = options.partAnimationPart ?? (NODE_TYPES.has(clean) ? animationPart : '1');

    const lineas = [
        NODE_TYPES.has(clean)
            ? `<to_node scene_file="${escapeAttr(sceneFile)}" parent_node="${escapeAttr(nodeParent)}" animation_part="${escapeAttr(animationPart)}" />`
            : `<to_part scene_file="${escapeAttr(sceneFile)}" />`
    ];

    for(const part of options.parts || []){
        lineas.push(`<to_node scene_file="${escapeAttr(part)}" parent_node="${escapeAttr(partParent)}" animation_part="${escapeAttr(partAnimationPart)}" />`);
    }

    const attach = lineas.join('\n\t\t\t\t\t');

    const hiding = options.hidingOption
        ? `\n\t\t\t\t\t<hiding option="${escapeAttr(options.hidingOption)}" />`
        : '';

    return `
\t\t\t<item number="${number}" NAME="${escapeAttr(displayName)}" SEX="${normalizeSex(sex)}">
\t\t\t\t<base>
\t\t\t\t\t<base_info name_key="N${id}" require_level="0" require_master="0" />
\t\t\t\t</base>
\t\t\t\t<client>
\t\t\t\t\t<icon image="${escapeAttr(icon)}" />
\t\t\t\t\t<attrib comment_key="T${id}" />
\t\t\t\t\t<feature comment_key="" />
\t\t\t\t\t<shopicon image="" />
\t\t\t\t</client>
\t\t\t\t<attach>
\t\t\t\t\t${attach}
\t\t\t\t</attach>
\t\t\t\t<costume>
\t\t\t\t\t<wearing sex="${wearingSex}" />${hiding}
\t\t\t\t</costume>
\t\t\t</item>`;
}

function sceneBaseName(sceneFile){
    return String(sceneFile || '')
        .split(/[\\/]/).pop()
        .replace(/\.[^.]*$/, '')
        .replace(/_[rl]$/i, '');
}

function sceneFileFor(baseSceneValue, newBaseName){
    const file = String(baseSceneValue || '').split(/[\\/]/).pop();
    const hand = file.match(/(_[rl])\.scn$/i);
    return newBaseName + (hand ? hand[1] : '') + '.scn';
}

function cloneWeaponItem(xmlText, baseId, newId, { displayName, icon, sceneFile, sceneKidFile } = {}){
    const base = findItem(xmlText, baseId);
    if(!base){
        throw new Error(`no encuentro el arma base ${baseId} en iteminfo.x7`);
    }

    const { number } = splitId(newId);
    let block = base
        .replace(/<item\s+number="\d+"/, `<item number="${number}"`)
        .replace(/(<item[^>]*?)\sNAME="[^"]*"/, (all, head) => `${head} NAME="${escapeAttr(displayName)}"`)
        .replace(/name_key="[^"]*"/, `name_key="N${newId}"`)
        .replace(/<attrib\s+comment_key="[^"]*"\s*\/>/, `<attrib comment_key="T${newId}" />`)
        .replace(/<feature\s+comment_key="[^"]*"\s*\/>/, `<feature comment_key="" />`)
        .replace(/\s*<parent\s+number="\d+"\s*\/>/, '');

    if(icon){
        block = block.replace(/<icon\s+image="[^"]*"\s*\/>/, `<icon image="${escapeAttr(icon)}" />`);
        block = block.replace(/slot_image_file="[^"]*"/, `slot_image_file="Resources/Image/Weapon/${escapeAttr(icon)}"`);
    }

    if(sceneFile){
        const nombre = sceneBaseName(sceneFile);
        block = block.replace(/<scene\s+value="([^"]*)"\s*\/>/g, (all, valor) =>
            `<scene value="resources/Model/Weapon/${escapeAttr(sceneFileFor(valor, nombre))}" />`);
    }

    if(sceneKidFile){
        block = block.replace(/<scene_kid\s+value="[^"]*"\s*\/>/, `<scene_kid value="resources/Model/Weapon/${escapeAttr(sceneKidFile)}" />`);
    } else {
        block = block.replace(/\s*<scene_kid\s+value="[^"]*"\s*\/>/, '');
    }

    return '\n\t\t\t' + block.trim();
}

function findWeaponEntry(weaponXml, itemKey){
    const open = new RegExp(`<weapon\\s+item_key="${itemKey}"\\s*>`);
    const match = open.exec(weaponXml);
    if(!match) return null;

    const end = weaponXml.indexOf('</weapon>', match.index);
    if(end === -1) return null;

    return weaponXml.slice(match.index, end + '</weapon>'.length);
}

function hasWeaponEntry(weaponXml, itemKey){
    return findWeaponEntry(weaponXml, itemKey) !== null;
}

function cloneWeaponEntry(weaponXml, baseId, newId, { icon, sceneFile } = {}){
    const base = findWeaponEntry(weaponXml, baseId);
    if(!base){
        throw new Error(`no encuentro el arma base ${baseId} en weapon.x7`);
    }

    let block = base.replace(/item_key="\d+"/, `item_key="${newId}"`);

    if(sceneFile){
        const nombre = sceneBaseName(sceneFile);
        block = block.replace(/(value[123])="([^"]*)"/g, (all, hueco, valor) =>
            `${hueco}="${escapeAttr(sceneFileFor(valor, nombre))}"`);
    }

    if(icon){
        block = block.replace(/slot_image_file="[^"]*"/, `slot_image_file="${escapeAttr(icon)}"`);
    }

    return block;
}

function insertWeaponEntry(weaponXml, entryXml){
    const close = weaponXml.lastIndexOf('</weaponlist>');
    if(close === -1){
        throw new Error('weapon.x7 no tiene </weaponlist>');
    }

    return weaponXml.slice(0, close) + '\t' + entryXml.trim() + '\n' + weaponXml.slice(close);
}

module.exports = {
    WEAPON_BASE_ID,
    weaponBaseId,
    detectFormat,
    splitId,
    buildId,
    subCategoryForType,
    normalizeSex,
    subCategoryBounds,
    itemBlocks,
    findItem,
    hasItem,
    nextFreeId,
    insertItem,
    makeCostumeItem,
    sceneBaseName,
    sceneFileFor,
    cloneWeaponItem,
    findWeaponEntry,
    hasWeaponEntry,
    cloneWeaponEntry,
    insertWeaponEntry,
};
