
const { root, fs, path, resources } = require('./directory');
const fsp = require('fs').promises;
 const id_range = {
    melee: [2000000, 2009999],
    guns: [2010000, 2019999],
    heavies:[2020001, 2029999],
    snipers: [2030001, 2039999],
    sentries:[2040001, 2049999],
    thrown: [2050001, 2059999],
    special: [2060001, 2069999],
    hair: [1000000, 1009999],
    face: [1010000, 1019999],
    top: [1020000, 1029999],
    pants: [1030000, 1039999],
    gloves: [1040000, 1049999],
    shoes: [1050000, 1059999],
    accessories: [1060000, 1069999],
    pets: [1070000, 1079999],
    skills_cards: [3000000, Number.MAX_SAFE_INTEGER]
    
};

function cleanTodo(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let itemx7 = path.join(__dirname, '..', '..', 'resources/xml/item.x7');
let itemxml = path.join(__dirname, '..', '..', 'resources/xml/item.xml')
let weaponlua = path.join(__dirname, '..', '..', 'resources/xml/weapon_lua.x7');
let weaponxml = path.join(__dirname, '..', '..', 'resources/auth/xbn/Weapons.xml');
let weaponx7 = path.join(__dirname, '..', '..', 'resources/xml/weapon.x7');
let iteminfox7 = path.join(__dirname, '..', '..', 'resources/xml/iteminfo.x7');
let iteminfoStringX7 = path.join(__dirname, '..', '..', 'resources/language/xml/iteminfo_string_table.x7');
let iteminfoStringXML = path.join(__dirname, '..', '..', 'resources/language/xml/iteminfo_string_table.xml');

function setVerifierPaths(paths = {}){
    itemx7 = paths.itemx7 || itemx7;
    itemxml = paths.itemxml || itemxml;
    weaponlua = paths.weaponlua || weaponlua;
    weaponxml = paths.weaponxml || weaponxml;
    weaponx7 = paths.weaponx7 || weaponx7;
    iteminfox7 = paths.iteminfox7 || iteminfox7;
    iteminfoStringX7 = paths.iteminfoStringX7 || iteminfoStringX7;
    iteminfoStringXML = paths.iteminfoStringXML || iteminfoStringXML;
}

const melee = ['Bat','Breaker', 'CounterSword', 'Dagger', 'Exo' , 'Fist', 'IronBoots', 'Katana', 'PlasmaSword', 'SigmaBlade', 'TwinBlades', 'VitalClaw'];
const guns = ['Submachine', 'Revolver', 'HandGun', 'SemiRifle', 'DualMagnum', 'ShotGun', 'Homing', 'Smash', 'AirGun', 'SparkRifle', 'Assault']
const snipers = ['RainGun', 'Cannon', 'Sharpshooting'];
const thrown = ['EarthBomb', 'LightBomb', 'RescueGun'];
const heavies = ['HeavyMachineGun', 'LightMachineGun', 'Turrent', 'Gauss', 'RocketLauncher'];
const special = ['MindShock', 'MindHeal'];
const sentries = ['SentryGun', 'SentryStun'];

 function verifyFields(campos){
    for(const [keys, values] of Object.entries(campos)){
        if(!values){
            console.error(`The field ${keys} is missing!.`);
            return false;
        }       
    }

    return true;
}

async function verifyItemX7(id, weaName){

    return new Promise((resolve, reject) => {
        if(!id){
            reject('An error has occured: ID is not defined!.');
        }
       
       fs.readFile(itemx7, 'utf8', (error, data) => {
       
            if(error){
                reject(error.message);
            }
          
        const valor = new RegExp(`<item item_key="(${id})">`, 'g');
        const nombre = new RegExp(`<base name="(${weaName})"`, 'g');

        const matches = [...data.matchAll(valor)].map(m => parseFloat(m[1]));
        const nameMatch = [...data.matchAll(nombre)].map(m => parseFloat(m[1]));

        if(nameMatch.length > 0){

            resolve([false, 0]);
            
        } else if(matches.length > 0){
            resolve(false);
        } else {
             resolve(id);
        }
        
       });
    });
}

async function verifyItem_xml(id, weaName){
    return new Promise((resolve, reject) => {
        if(!id){
            reject('An error has occured: ID is not defined!.');
        }
      
       fs.readFile(itemxml, 'utf8', (error, data) => {
       
            if(error){
                reject(error.message);
            }
        const valor = new RegExp(`<item item_key="(${id})">`, 'g');
        const nombre = new RegExp(`<base name="(${weaName})"`, 'g');

        const matches = [...data.matchAll(valor)].map(m => parseFloat(m[1]));
        const nameMatch = [...data.matchAll(nombre)].map(m => parseFloat(m[1]));

        if(matches.length > 0){
         resolve(false);
        } else if(nameMatch.length > 0){
            console.error('The item Name already exist in the item xml File.');
            resolve([false, 0]);
        } else {
            
             resolve(id);
        }
        
       });
    });
}

async function verifyWeaponLua(id){
    return new Promise((resolve, reject) => {
        if(!id){
            reject('An error has occured: ID is not defined!.');
        }
      
       fs.readFile(weaponlua, 'utf8', (error, data) => {
            if(error){
                reject(error.message);
            }
        
        const valor = new RegExp(`lua_func item_key="(${id})"`, 'g');
        const matches = [...data.matchAll(valor)].map(m => parseFloat(m[1]));
      
        if(matches.length > 0){
            resolve(false);
        }
        resolve(id);

       });
    });
}

async function verifyInfox7(IDName, IDTip, itemNames){
   const cleanName = cleanTodo(itemNames);
            
    return new Promise((resolve, reject) => {
        if(!IDName){
            reject(new Error('IDName is not defined in verifyInfox7!'));
            return;
        }

        if(!IDTip){
            reject(new Error('IDTip is not defined in verifyInfox7!'));
            return;
        }

          if(!itemNames){
            reject(new Error('itemNames is not defined in verifyInfox7!'));
            return;
        }

        fs.readFile(iteminfox7, 'utf8', (error, data) => {
            if(error){
                 reject(error);
                 return;
            }

            const nameRegex = new RegExp(`<string key="NAME${IDName}"`, 'g');
            const tipRegex = new RegExp(`<string key="TIP${IDTip}"`, 'g');
            const NameVerify = new RegExp(`eng="${cleanName}" spa="${cleanName}"`, 'g');
       
        const nameMatch = [...data.matchAll(nameRegex)];
            const tipMatch = [...data.matchAll(tipRegex)];
            const itemNameMatches = [...data.matchAll(NameVerify)];
         
         if(itemNameMatches.length > 0){
           
            return resolve("nombreEncontrado");
         } else if (nameMatch.length > 0) {
               
                return resolve(false);
            } else if (tipMatch.length > 0) {
                
               return resolve([false, 2]);
            } else {
                return resolve({ IDName, IDTip });
            }

        });
    });
}

async function verifyString_tablex7(IDName, IDTip, itemNames){
   const cleanName = cleanTodo(itemNames);
            
    return new Promise((resolve, reject) => {
        if(!IDName){
            reject(new Error('IDName is not defined in Verify ItemInfo String tablex7!'));
            return;
        }

        if(!IDTip){
            reject(new Error('IDTip is not defined in Verify ItemInfo String tablex7!'));
            return;
        }

          if(!itemNames){
            reject(new Error('itemNames is not defined in Verify ItemInfo String tablex7!'));
            return;
        }

        fs.readFile(iteminfoStringX7, 'utf8', (error, data) => {
            if(error){
                 reject(error);
                 return;
            }

            const nameRegex = new RegExp(`<string key="NAME${IDName}"`, 'g');
            const tipRegex = new RegExp(`<string key="TIP${IDTip}"`, 'g');
            const NameVerify = new RegExp(`eng="${cleanName}" spa="${cleanName}"`, 'g');
       
        const nameMatch = [...data.matchAll(nameRegex)];
            const tipMatch = [...data.matchAll(tipRegex)];
            const itemNameMatches = [...data.matchAll(NameVerify)];
         
         if(itemNameMatches.length > 0){
           
            return resolve("nombreEncontrado");
         } else if (nameMatch.length > 0) {
               
                return resolve(false);
            } else if (tipMatch.length > 0) {
                
               return resolve([false, 2]);
            } else {
                return resolve({ IDName, IDTip });
            }

        });
    });
}

async function verifyString_tableXML(IDName, IDTip, itemNames){
   const cleanName = cleanTodo(itemNames);
            
    return new Promise((resolve, reject) => {
        if(!IDName){
            reject(new Error('IDName is not defined in Verify ItemInfo String tableXML!'));
            return;
        }

        if(!IDTip){
            reject(new Error('IDTip is not defined in Verify ItemInfo String table XML!'));
            return;
        }

          if(!itemNames){
            reject(new Error('itemNames is not defined in Verify ItemInfo String table XML!'));
            return;
        }

        fs.readFile(iteminfoStringXML, 'utf8', (error, data) => {
            if(error){
                 reject(error);
                 return;
            }

            const nameRegex = new RegExp(`<string key="NAME${IDName}"`, 'g');
            const tipRegex = new RegExp(`<string key="TIP${IDTip}"`, 'g');
            const NameVerify = new RegExp(`eng="${cleanName}" spa="${cleanName}"`, 'g');
       
        const nameMatch = [...data.matchAll(nameRegex)];
            const tipMatch = [...data.matchAll(tipRegex)];
            const itemNameMatches = [...data.matchAll(NameVerify)];
         
         if(itemNameMatches.length > 0){
           
            return resolve("nombreEncontrado");
         } else if (nameMatch.length > 0) {
               
                return resolve(false);
            } else if (tipMatch.length > 0) {
                
               return resolve([false, 2]);
            } else {
                return resolve({ IDName, IDTip });
            }

        });
    });
}

async function verifyWeaponsXML(id, name) {
    return new Promise((resolve, reject) => {
        if(!id){
            console.error('ID is not defined!');
            resolve(false);
        }

         if(!name){
            console.error('Name is not defined!');
            resolve(false);
        }

        fs.readFile(weaponxml, 'utf8', (error, data) => {
            if(error){
                return reject(error);
                 
            }

            for(let i = 1; i <= 5; i++){
            
      const findName = new RegExp(`value${i}="${name}"`, 'g');
        const findID = new RegExp(`<weapon item_key="(${id})">`, 'g');

                const matchesName = [...data.matchAll(findName)].map(m => m);
                const matchesID = [...data.matchAll(findID)].map(m => m);
                
                if(matchesName.length > 0){
                   
                    return resolve([false, 2]);
                }

                if(matchesID.length > 0){
                   
                    return resolve(false);
                }

                return resolve(id);
                
            }

        })
        
    });

}

module.exports = {setVerifierPaths, verifyFields, verifyInfox7, verifyItemX7, verifyWeaponLua, verifyItem_xml , verifyString_tablex7, verifyString_tableXML, verifyWeaponsXML , iteminfoStringX7, iteminfoStringXML, iteminfox7 , itemxml,  itemx7, weaponlua, weaponxml, weaponx7, melee, id_range, special, sentries, guns, snipers, heavies, thrown};
