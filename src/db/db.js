const { app } = require('electron');

const mysql = require('mysql2/promise');
const path = require('path');
const fsp = require('fs').promises;

function quoteIdentifier(value){
    return '`' + String(value).replace(/`/g, '``') + '`';
}

async function getColumns(conexion, table){
    const [rows] = await conexion.query(`SHOW COLUMNS FROM ${quoteIdentifier(table)}`);
    return rows.map(row => row.Field);
}

async function insertExisting(conexion, table, values){
    const columns = new Set((await getColumns(conexion, table)).map(column => column.toLowerCase()));
    const used = new Set();
    const entries = Object.entries(values).filter(([key]) => {
        const cleanKey = key.toLowerCase();
        if(!columns.has(cleanKey) || used.has(cleanKey)){
            return false;
        }
        used.add(cleanKey);
        return true;
    });

    if(entries.length === 0){
        throw new Error(`No matching columns found for ${table}.`);
    }

    const sql = `INSERT INTO ${quoteIdentifier(table)}(${entries.map(([key]) => quoteIdentifier(key)).join(', ')}) VALUES(${entries.map(() => '?').join(', ')})`;
    await conexion.query(sql, entries.map(([, value]) => value));
}

function findColumn(columns, preferred){
    const found = columns.find(column => column.toLowerCase() === preferred.toLowerCase());
    return found || preferred;
}

function getWeaponDbDefaults(id, weaType){
    return {
        priceGroupId: 6,
        effectGroupId: 4,
        discountPercentage: 0,
        type: 2,
        requiredGender: 0,
        requiredLicense: 0,
        colors: 1,
        uniqueColors: 0,
        requiredLevel: 0,
        levelLimit: 0,
        requiredMasterLevel: 0,
        isOneTimeUse: 0,
        isDestroyable: 1,
        mainTab: 2,
        subTab: 1
    };
}

function getCostumeDbDefaults(id, costumeType, options = {}){
    const subTabs = {
        hair: 2,
        face: 3,
        top: 4,
        pants: 5,
        gloves: 6,
        shoes: 7,
        accessories: 8,
        pets: 9
    };
    const priceGroups = {
        hair: 6,
        face: 7,
        top: 8,
        pants: 9,
        gloves: 10,
        shoes: 10,
        accessories: 11,
        pets: 12,
        skills_cards: 13
    };
    const effectGroups = {
        hair: 856,
        face: 857,
        top: 858,
        pants: 859,
        gloves: 860,
        shoes: 861,
        accessories: 857,
        pets: 862,
        skills_cards: 169
    };
    const sex = String(options.sex || '').toLowerCase();
    const requiredGender = sex === 'man' || sex === 'male' ? 1 : (sex === 'woman' || sex === 'female' ? 2 : 0);

    return {
        priceGroupId: priceGroups[costumeType] || 6,
        effectGroupId: effectGroups[costumeType] || 857,
        discountPercentage: 0,
        type: 1,
        requiredGender,
        requiredLicense: 0,
        colors: Math.max(1, 1 + (Number.parseInt(options.recolorCount, 10) || 0)),
        uniqueColors: 0,
        requiredLevel: 0,
        levelLimit: 0,
        requiredMasterLevel: 0,
        isOneTimeUse: 0,
        isDestroyable: 1,
        mainTab: costumeType === 'pets' ? 3 : 3,
        subTab: subTabs[costumeType] || 8
    };
}

function getShopDbDefaults(id, itemType, options = {}){
    if(options.kind === 'costume'){
        return getCostumeDbDefaults(id, itemType, options);
    }

    return getWeaponDbDefaults(id, itemType);
}

async function loadDbItemIds(host, user, pass, db){
    let conexion;

    try {
        conexion = await mysql.createConnection({
            host: host,
            user: user,
            password: pass,
            database: db
        });

        const ids = new Set();
        const itemInfoColumns = await getColumns(conexion, 'shop_iteminfos');
        const itemColumns = await getColumns(conexion, 'shop_items');
        const itemInfoIdColumn = findColumn(itemInfoColumns, 'ShopItemId');
        const itemIdColumn = findColumn(itemColumns, 'Id');
        const [itemInfoRows] = await conexion.query(`SELECT ${quoteIdentifier(itemInfoIdColumn)} AS id FROM ${quoteIdentifier('shop_iteminfos')}`);
        const [itemRows] = await conexion.query(`SELECT ${quoteIdentifier(itemIdColumn)} AS id FROM ${quoteIdentifier('shop_items')}`);

        for(const row of itemInfoRows){
            ids.add(Number(row.id));
        }

        for(const row of itemRows){
            ids.add(Number(row.id));
        }

        return ids;
    } finally {
        if(conexion) await conexion.end();
    }
}

async function repairWeaponShopRows(ids, host, user, pass, db){
    if(!ids || ids.length === 0){
        return 0;
    }

    let conexion;
    let updated = 0;

    try {
        conexion = await mysql.createConnection({
            host: host,
            user: user,
            password: pass,
            database: db
        });

        const infoColumns = new Set((await getColumns(conexion, 'shop_iteminfos')).map(column => column.toLowerCase()));
        const itemColumns = new Set((await getColumns(conexion, 'shop_items')).map(column => column.toLowerCase()));
        await conexion.beginTransaction();

        for(const id of ids){
            const defaults = getWeaponDbDefaults(id);
            const grupos = await resolveShopGroups(conexion, id, defaults.priceGroupId, defaults.effectGroupId);
            defaults.priceGroupId = grupos.priceGroupId;
            defaults.effectGroupId = grupos.effectGroupId;

            if(infoColumns.has('pricegroupid') && infoColumns.has('effectgroupid')){
                const sets = ['`PriceGroupId` = ?', '`EffectGroupId` = ?'];
                const params = [defaults.priceGroupId, defaults.effectGroupId];

                if(infoColumns.has('type')){
                    sets.push('`Type` = ?');
                    params.push(defaults.type);
                }

                params.push(id);
                await conexion.query(`UPDATE ${quoteIdentifier('shop_iteminfos')} SET ${sets.join(', ')} WHERE ${quoteIdentifier('ShopItemId')} = ?`, params);
            }

            if(itemColumns.has('maintab') && itemColumns.has('subtab')){
                await conexion.query(
                    `UPDATE ${quoteIdentifier('shop_items')} SET ${quoteIdentifier('MainTab')} = ?, ${quoteIdentifier('SubTab')} = ? WHERE ${quoteIdentifier('Id')} = ?`,
                    [defaults.mainTab, defaults.subTab, id]
                );
            }

            updated++;
        }

        await conexion.commit();
        return updated;
    } catch(e){
        if(conexion){
            try {
                await conexion.rollback();
            } catch (_) {}
        }
        throw e;
    } finally {
        if(conexion) await conexion.end();
    }
}

async function updateShopItemColors(colorUpdates, host, user, pass, db){
    if(!colorUpdates || colorUpdates.length === 0){
        return 0;
    }

    let conexion;
    let updated = 0;

    try {
        conexion = await mysql.createConnection({
            host,
            user,
            password: pass,
            database: db
        });

        const itemColumns = new Set((await getColumns(conexion, 'shop_items')).map(column => column.toLowerCase()));
        if(!itemColumns.has('colors')){
            return 0;
        }

        for(const item of colorUpdates){
            const colors = Math.max(1, Number.parseInt(item.colors, 10) || 1);
            const id = Number(item.id);

            if(!Number.isFinite(id)){
                continue;
            }

            const [result] = await conexion.query(
                `UPDATE ${quoteIdentifier('shop_items')} SET ${quoteIdentifier('Colors')} = GREATEST(${quoteIdentifier('Colors')}, ?) WHERE ${quoteIdentifier('Id')} = ?`,
                [colors, id]
            );
            updated += result.affectedRows || 0;
        }

        return updated;
    } finally {
        if(conexion) await conexion.end();
    }
}

async function shopItemExists(id, host, user, pass, db){
    let conexion;

    try {
        conexion = await mysql.createConnection({
            host,
            user,
            password: pass,
            database: db
        });

        const itemColumns = await getColumns(conexion, 'shop_items');
        const itemIdColumn = findColumn(itemColumns, 'Id');
        const [rows] = await conexion.query(
            `SELECT ${quoteIdentifier(itemIdColumn)} AS id FROM ${quoteIdentifier('shop_items')} WHERE ${quoteIdentifier(itemIdColumn)} = ? LIMIT 1`,
            [id]
        );

        return rows.length > 0;
    } finally {
        if(conexion) await conexion.end();
    }
}

async function detectDbFormat(conexion){
    const infoColumns = (await getColumns(conexion, 'shop_iteminfos')).map(column => column.toLowerCase());
    if(infoColumns.includes('isenabled')) return 's1';
    if(infoColumns.includes('type')) return 's10';
    return null;
}

async function findSiblingShopInfo(conexion, id){
    const start = Math.floor(Number(id) / 10000) * 10000;
    const [rows] = await conexion.query(
        `SELECT ${quoteIdentifier('PriceGroupId')}, ${quoteIdentifier('EffectGroupId')}
         FROM ${quoteIdentifier('shop_iteminfos')}
         WHERE ${quoteIdentifier('ShopItemId')} >= ? AND ${quoteIdentifier('ShopItemId')} < ?
         ORDER BY ${quoteIdentifier('ShopItemId')} DESC LIMIT 1`,
        [start, start + 10000]
    );

    if(rows.length){
        return rows[0];
    }

    const [common] = await conexion.query(
        `SELECT ${quoteIdentifier('PriceGroupId')}, ${quoteIdentifier('EffectGroupId')}
         FROM ${quoteIdentifier('shop_iteminfos')}
         GROUP BY ${quoteIdentifier('PriceGroupId')}, ${quoteIdentifier('EffectGroupId')}
         ORDER BY COUNT(*) DESC LIMIT 1`
    );

    return common.length ? common[0] : null;
}

async function resolveShopGroups(conexion, id, priceGroupId, effectGroupId){
    const existe = async (table, value) => {
        if(value == null) return false;
        const [rows] = await conexion.query(
            `SELECT ${quoteIdentifier('Id')} FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier('Id')} = ? LIMIT 1`,
            [value]
        );
        return rows.length > 0;
    };

    const priceOk = await existe('shop_price_groups', priceGroupId);
    const effectOk = await existe('shop_effect_groups', effectGroupId);

    if(priceOk && effectOk){
        return { priceGroupId, effectGroupId };
    }

    const sibling = await findSiblingShopInfo(conexion, id);

    return {
        priceGroupId: priceOk ? priceGroupId : (sibling ? sibling.PriceGroupId : priceGroupId),
        effectGroupId: effectOk ? effectGroupId : (sibling ? sibling.EffectGroupId : effectGroupId)
    };
}

async function addtodb(id, name, host, user, pass, db, dbIds, weaType, options = {}){
    let conexion;
    try {
    if(dbIds && dbIds.has(Number(id))){
        return 2;
    }

     conexion = await mysql.createConnection({
        host: host,
        user: user,
        password: pass,
        database: db
    });

    if(options.clientFormat){
        const dbFormat = await detectDbFormat(conexion);
        if(dbFormat && dbFormat !== options.clientFormat){
            const nombres = { s1: 'Season 1', s10: 'S8/S10' };
            throw new Error(`el cliente es ${nombres[options.clientFormat]} y la base "${db}" es ${nombres[dbFormat]}`);
        }
    }

    if(!dbIds){
        const itemInfoColumns = await getColumns(conexion, 'shop_iteminfos');
        const itemColumns = await getColumns(conexion, 'shop_items');
        const itemInfoIdColumn = findColumn(itemInfoColumns, 'ShopItemId');
        const itemIdColumn = findColumn(itemColumns, 'Id');
        const [ itemInfo ] = await conexion.query(`SELECT * FROM ${quoteIdentifier('shop_iteminfos')} WHERE ${quoteIdentifier(itemInfoIdColumn)} = ?`, [id]);
        const [shopItems ] = await conexion.query(`SELECT * FROM ${quoteIdentifier('shop_items')} WHERE ${quoteIdentifier(itemIdColumn)} = ?`, [id]);

        if(itemInfo.length > 0 || shopItems.length > 0){
            return 2;
        }
    }

    await conexion.beginTransaction();
    const defaults = getShopDbDefaults(id, weaType, options);

    const grupos = await resolveShopGroups(conexion, id, defaults.priceGroupId, defaults.effectGroupId);
    defaults.priceGroupId = grupos.priceGroupId;
    defaults.effectGroupId = grupos.effectGroupId;
    
    await insertExisting(conexion, 'shop_items', {
        Id: id,
        id,
        RequiredGender: defaults.requiredGender,
        RequiredLicense: defaults.requiredLicense,
        Colors: defaults.colors,
        UniqueColors: defaults.uniqueColors,
        RequiredLevel: defaults.requiredLevel,
        LevelLimit: defaults.levelLimit,
        RequiredMasterLevel: defaults.requiredMasterLevel,
        IsOneTimeUse: defaults.isOneTimeUse,
        IsDestroyable: defaults.isDestroyable,
        MainTab: defaults.mainTab,
        SubTab: defaults.subTab,
        RepairCost: null
    });

    await insertExisting(conexion, 'shop_iteminfos', {
        ShopItemId: id,
        PriceGroupId: defaults.priceGroupId,
        EffectGroupId: defaults.effectGroupId,
        DiscountPercentage: defaults.discountPercentage,
        Type: defaults.type,
        IsEnabled: 1
    });

    await conexion.commit();
    if(dbIds){
        dbIds.add(Number(id));
    }
    console.log(`${name} was added with ID ${id} to database.`);

    return true;

    } catch(e){

      console.error('No se pudo agregar a la base:', e.message);
      try {
        await conexion.rollback();
        return [false, 2];
    } catch (rollbackError) {
        console.error('Error reversed back changes:', rollbackError.message);
        return [false, 2];
    }

    } finally {
        if (conexion) await conexion.end();
    }
}

module.exports = { addtodb, detectDbFormat, loadDbItemIds, repairWeaponShopRows, updateShopItemColors, shopItemExists };
