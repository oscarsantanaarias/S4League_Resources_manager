
const path = require('path');
const fs = require('fs');

const defaultWeaponFolders = {
    guns: [
        'AirGun',
        'Assault',
        'Cannon',
        'DualMagnum',
        'EarthBomb',
        'Gauss',
        'HandGun',
        'HeavyMachineGun',
        'Homing',
        'LightBomb',
        'LightMachineGun',
        'MindHeal',
        'MindShock',
        'MineGun',
        'RailGun',
        'RescueGun',
        'Revolver',
        'RocketLauncher',
        'SemiRifle',
        'SentryGun',
        'SentryStun',
        'Sharpshooting',
        'ShotGun',
        'Smash',
        'SparkRifle',
        'Submachine',
        'Turrent'
    ],
    melee: [
        'Bat',
        'Breaker',
        'CounterSword',
        'Dagger',
        'Exo',
        'Fist',
        'IronBoots',
        'Katana',
        'PlasmaSword',
        'SigmaBlade',
        'TwinBlades',
        'VitalClaw'
    ]
};

const defaultCostumeFolders = [
    'hair',
    'face',
    'body',
    'top',
    'leg',
    'pants',
    'hand',
    'gloves',
    'foot',
    'shoes',
    'acc',
    'accessories',
    'hats',
    'pets'
];

function ensureDefaultWeaponDirectories(ruta){
    const weaponRoot = path.join(ruta, 'weapon');

    for(const [weaponType, weaponNames] of Object.entries(defaultWeaponFolders)){
        for(const weaponName of weaponNames){
            fs.mkdirSync(path.join(weaponRoot, weaponType, weaponName, 'imgs'), { recursive: true });
            fs.mkdirSync(path.join(weaponRoot, weaponType, weaponName, 'model'), { recursive: true });
        }
    }
}

function ensureDefaultCostumeDirectories(ruta){
    const costumeRoot = path.join(ruta, 'costumes');

    for(const costumeType of defaultCostumeFolders){
        for(const gender of ['male', 'female', 'unisex']){
            fs.mkdirSync(path.join(costumeRoot, costumeType, gender, 'imgs'), { recursive: true });
            fs.mkdirSync(path.join(costumeRoot, costumeType, gender, 'model'), { recursive: true });
        }
    }
}

const defaultMapFolders = [
    'bgm',
    'effects',
    'image',
    path.join('image', 'Loading'),
    'mapinfo',
    'mapselect',
    'model',
    path.join('model', 'background')
];

function crearEsqueletoMapa(mapsRoot, nombre){
    for(const carpeta of defaultMapFolders){
        fs.mkdirSync(path.join(mapsRoot, nombre, carpeta), { recursive: true });
    }
    return path.join(mapsRoot, nombre);
}

function tieneArchivos(ruta){
    if(!fs.existsSync(ruta)){
        return false;
    }

    for(const entrada of fs.readdirSync(ruta, { withFileTypes: true })){
        const hijo = path.join(ruta, entrada.name);
        if(entrada.isDirectory()){
            if(tieneArchivos(hijo)) return true;
        } else {
            return true;
        }
    }

    return false;
}

function asegurarCarpetaMapaLibre(ruta){
    const mapsRoot = path.join(ruta, 'maps');
    fs.mkdirSync(mapsRoot, { recursive: true });

    const carpetas = fs.readdirSync(mapsRoot, { withFileTypes: true })
        .filter(entrada => entrada.isDirectory())
        .map(entrada => entrada.name);

    if(!carpetas.length){
        return crearEsqueletoMapa(mapsRoot, 'map');
    }

    const libre = carpetas.find(nombre => !tieneArchivos(path.join(mapsRoot, nombre)));
    if(libre){
        return path.join(mapsRoot, libre);
    }

    let mayor = 1;
    for(const nombre of carpetas){
        const coincide = /^map(\d*)$/i.exec(nombre);
        if(!coincide) continue;
        const numero = coincide[1] ? Number(coincide[1]) : 1;
        if(numero > mayor) mayor = numero;
    }

    return crearEsqueletoMapa(mapsRoot, 'map' + (mayor + 1));
}

function ensureDefaultMapDirectories(ruta){
    asegurarCarpetaMapaLibre(ruta);
}

function ensureDefaultResourceDirectories(resourcesRoot){
    fs.mkdirSync(path.join(resourcesRoot, 'weapon'), { recursive: true });
    fs.mkdirSync(path.join(resourcesRoot, 'costumes'), { recursive: true });
    ensureDefaultWeaponDirectories(resourcesRoot);
    ensureDefaultCostumeDirectories(resourcesRoot);
    ensureDefaultMapDirectories(resourcesRoot);
}



function getDirectories(ruta){
    ensureDefaultResourceDirectories(ruta);

    const folders = fs.readdirSync(ruta, { withFileTypes: true }).reduce((acc, dir) => {
        if(!dir.isDirectory()){
            return acc;
        }

        const dirName = dir.name;

        if(!acc[dirName]){
            acc[dirName] = {};
        }

        return acc
    }, {});

    for(const folden in folders){
        const rutaNivel1 = path.join(ruta, folden);
        
       const t1 = fs.readdirSync(rutaNivel1, { withFileTypes: true })
       
        t1.forEach(itemInfo => {
                if(folden === 'weapon' && !itemInfo.isDirectory()){
                    return;
                }

                const item = itemInfo.name;
               
                if(!folders[folden][item] && folden === 'weapon'){
                    folders[folden][item] = {};
                
                    if(item && item.length > 0){
                        const weaponFolders = path.join(ruta, folden, item);
                        const subMelee = fs.readdirSync(weaponFolders, { withFileTypes: true })
                            .filter(entry => entry.isDirectory())
                            .map(entry => entry.name);

                        subMelee.forEach(subf => {
                            folders[folden][item][subf] = {};
                            const subMeleeFiles = path.join(ruta, folden, item, subf);
                            const subMeleeRead = fs.readdirSync(subMeleeFiles, { withFileTypes: true })
                                .filter(entry => entry.isDirectory())
                                .map(entry => entry.name);

                            subMeleeRead.forEach(inFolderMelee => {

                                folders[folden][item][subf][inFolderMelee] = [];

                                const melee_resource = path.join(ruta, folden, item, subf, inFolderMelee);
                                const readMeleeResource = fs.readdirSync(melee_resource);        
                                   readMeleeResource.forEach(itemFiles => { 
                                        folders[folden][item][subf][inFolderMelee].push(itemFiles);
                                    });
                            });
                            
                        });
                    } 
                };

                if(!folders[folden][item] && folden !== 'weapon'){
                    if(item !== 'xbn'){
                         folders[folden][item.split('.')[0] + item.split('.')[1]] = item;
                    } else {
                         folders[folden][item] = {};
                        const xbnpath = path.join(ruta, 'auth' , item);
                        const readxbnfolder = fs.readdirSync(xbnpath);
                        folders[folden][item] = {weaponsxml: readxbnfolder[0] };
                    }
                  
                };
        });
    }; 

   

return folders;
}   




module.exports = { getDirectories, ensureDefaultResourceDirectories, asegurarCarpetaMapaLibre, fs, path };
