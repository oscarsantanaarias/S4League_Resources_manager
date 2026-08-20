const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('puente', {
    selectFolder: () => ipcRenderer.invoke('selectFolder'),
    // Desempaquetado de clientes (Themida). Ver "gane a themida.txt".
    selectPackedExe: () => ipcRenderer.invoke('selectPackedExe'),
    unpackClient: (ruta) => ipcRenderer.invoke('unpackClient', ruta),
    onUnpackProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('unpackProgress', listener);
      return () => ipcRenderer.removeListener('unpackProgress', listener);
    },
    dirLocation: (ruta) => ipcRenderer.invoke('dirLocation', ruta),
    addItems: (useDBS) => ipcRenderer.invoke('addItems', useDBS),
    confirmDialog: () => ipcRenderer.invoke('show-confirm'),
    saveDBConfig: (data) => ipcRenderer.invoke('save-db-config', data),
    loadDBConfig: () => ipcRenderer.invoke('load-db-config'),
    savePathInit: (data) => ipcRenderer.invoke('save-path-init', data),
    loadPathInit: () => ipcRenderer.invoke('load-path-init'),
    XMLtoXBN: () => ipcRenderer.invoke('XMLtoXBN'),
    XBNtoXML: () => ipcRenderer.invoke('XBNtoXML'),
    decryptShopS4Files: () => ipcRenderer.invoke('decryptShopS4Files'),
    encryptShopS4Files: () => ipcRenderer.invoke('encryptShopS4Files'),
    decryptLuaFiles: () => ipcRenderer.invoke('decryptLuaFiles'),
    encryptLuaFiles: () => ipcRenderer.invoke('encryptLuaFiles'),
    extractResources: (ruta) => ipcRenderer.invoke('extractResources', ruta),
    onExtractResourcesProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('extractResourcesProgress', listener);
      return () => ipcRenderer.removeListener('extractResourcesProgress', listener);
    },
    packResources: (ruta) => ipcRenderer.invoke('packResources', ruta),
    onPackResourcesProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('packResourcesProgress', listener);
      return () => ipcRenderer.removeListener('packResourcesProgress', listener);
    },
    resourceBrowserSources: (ruta) => ipcRenderer.invoke('resourceBrowserSources', ruta),
    listResourceFolders: (data) => ipcRenderer.invoke('listResourceFolders', data),
    resourceBrowserLoad: (ruta) => ipcRenderer.invoke('resourceBrowserLoad', ruta),
    resourceBrowserList: (data) => ipcRenderer.invoke('resourceBrowserList', data),
    resourceBrowserRead: (data) => ipcRenderer.invoke('resourceBrowserRead', data),
    resourceBrowserOpenTemp: (data) => ipcRenderer.invoke('resourceBrowserOpenTemp', data),
    resourceExtractSingle: (data) => ipcRenderer.invoke('resourceExtractSingle', data),
    resourceExtractMany: (data) => ipcRenderer.invoke('resourceExtractMany', data),
    selectSeqFile: () => ipcRenderer.invoke('selectSeqFile'),
    decryptSeqFile: (seqPath) => ipcRenderer.invoke('decryptSeqFile', seqPath),
    scnToJson: () => ipcRenderer.invoke('scnToJson'),
    scnFromJson: () => ipcRenderer.invoke('scnFromJson'),
    seqToJson: () => ipcRenderer.invoke('seqToJson'),
    seqFromJson: () => ipcRenderer.invoke('seqFromJson'),
    encryptSeqFiles: () => ipcRenderer.invoke('encryptSeqFiles'),
    selectResourceFile: () => ipcRenderer.invoke('selectResourceFile'),
    selectResourceFiles: () => ipcRenderer.invoke('selectResourceFiles'),
    selectExtractFolder: (defaultPath) => ipcRenderer.invoke('selectExtractFolder', defaultPath),
    resourceReplaceFile: (data) => ipcRenderer.invoke('resourceReplaceFile', data),
    resourceSaveText: (data) => ipcRenderer.invoke('resourceSaveText', data),
    resourceScnReplaceTexture: (data) => ipcRenderer.invoke('resourceScnReplaceTexture', data),
    resourceSeqReplaceString: (data) => ipcRenderer.invoke('resourceSeqReplaceString', data),
    scnPreview3D: (data) => ipcRenderer.invoke('scnPreview3D', data),
    seqPreview3D: (data) => ipcRenderer.invoke('seqPreview3D', data),
    resourceAddFile: (data) => ipcRenderer.invoke('resourceAddFile', data),
    resourceAddDroppedFiles: (data) => ipcRenderer.invoke('resourceAddDroppedFiles', data),
    resourceDeleteFile: (data) => ipcRenderer.invoke('resourceDeleteFile', data),
    resourceSaveChanges: (ruta) => ipcRenderer.invoke('resourceSaveChanges', ruta),
    resourceCleanUnused: (data) => ipcRenderer.invoke('resourceCleanUnused', data),
    onCleanUnusedProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('cleanUnusedProgress', listener);
      return () => ipcRenderer.removeListener('cleanUnusedProgress', listener);
    },
    xuiList: (data) => ipcRenderer.invoke('xuiList', data),
    xuiOpen: (data) => ipcRenderer.invoke('xuiOpen', data),
    xuiSave: (data) => ipcRenderer.invoke('xuiSave', data),
    xuiArchivosDeNombres: (data) => ipcRenderer.invoke('xuiArchivosDeNombres', data),
    xuiComponer: (data) => ipcRenderer.invoke('xuiComponer', data),
    liveCostumesScanPets: (data) => ipcRenderer.invoke('liveCostumesScanPets', data),
    texturaAbrir: (data) => ipcRenderer.invoke('texturaAbrir', data),
    texturaGuardar: (data) => ipcRenderer.invoke('texturaGuardar', data),
    liveResourceAddItems: (data) => ipcRenderer.invoke('liveResourceAddItems', data),
    liveResourceAddCostumes: (data) => ipcRenderer.invoke('liveResourceAddCostumes', data),
    liveResourceAddMaps: (data) => ipcRenderer.invoke('liveResourceAddMaps', data),
    dbPreviewLoad: (data) => ipcRenderer.invoke('dbPreviewLoad', data),
    dbPreviewUpdate: (data) => ipcRenderer.invoke('dbPreviewUpdate', data),
    shopEditGet: (data) => ipcRenderer.invoke('shopEditGet', data),
    shopEditSave: (data) => ipcRenderer.invoke('shopEditSave', data),
    onDbPreviewProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('dbPreviewProgress', listener);
      return () => ipcRenderer.removeListener('dbPreviewProgress', listener);
    },
    uiInspectorLoad: () => ipcRenderer.invoke('uiInspectorLoad'),
    uiInspectorFolder: (data) => ipcRenderer.invoke('uiInspectorFolder', data),
    uiInspectorCommand: (data) => ipcRenderer.invoke('uiInspectorCommand', data),
    openUiInspectorWindow: () => ipcRenderer.invoke('openUiInspectorWindow'),
    getDroppedFilePaths: (files) => Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean),
    winMinimize: () => ipcRenderer.send('win-minimize'),
    winMaximize: () => ipcRenderer.send('win-maximize'),
    winClose: () => ipcRenderer.send('win-close')
});
