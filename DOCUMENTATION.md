# S4League Resources & Mods Manager

A desktop tool for browsing, editing, previewing and repacking S4League client
resources, and for adding custom weapons, costumes and maps to a private server.

Built with Electron. Runs on Windows.

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
- [Feature overview](#feature-overview)
- [Paths](#paths)
- [Loading resources](#loading-resources)
- [Extract](#extract)
- [Pack](#pack)
- [Resource browser](#resource-browser)
- [3D preview](#3d-preview)
- [Add Tools](#add-tools-weapons-costumes-maps)
- [Convert](#convert-xml--xbn)
- [Crypt](#crypt)
- [Database](#database)

## Requirements

- Windows
- [Node.js](https://nodejs.org)
- An S4League client folder (the one with `resource.s4hd` and `_resources`)

## Install

Just run `run.bat`. The first time, it installs the dependencies and rebuilds
the native modules for Electron (this is what fixes the `NODE_MODULE_VERSION`
error on `lzo`), then it starts the app. Every run after that just starts it.

## Feature overview

| Feature | What it does |
|---|---|
| Paths | Point the tool at your client, mods and server folders |
| Load Resources | Open the client resource tree from `resource.s4hd`, packs, or a loose folder |
| Extract | Unpack the client into `extracted_resources` for editing |
| Pack | Build `extracted_resources` back into `resource.s4hd` + `_resources` |
| Resource browser | Browse, preview, edit, replace, delete and extract files |
| 3D preview | View `.scn` and `.seq` models and effects with animation |
| Add Weapons | Inject a custom weapon into the client and register it on the server |
| Add Costumes | Inject a custom costume and register it |
| Add Maps | Register custom maps in the client map list |
| Convert | XML to XBN and back |
| Crypt | Encrypt/decrypt shop, `.seq`, and Lua files; SCN/SEQ to JSON and back |

## Paths

Top bar, **Paths** menu. Set these before doing anything else.

- **Select S4League Client Folder** - the client folder that contains
  `resource.s4hd` and the `_resources` folder. This is the main path.
- **Select Extracted Folder** - optional. Point it at an `extracted_resources`
  folder if you want to browse loose files instead of the packed client. Can be
  a folder anywhere on disk.
- **Mods Folder** - the folder that holds your custom content (weapon/costume
  files, textures, etc). Used by the Add Tools.
- **Server Data Folder** - the `data` folder of your emulator/server, where the
  game reads its xml/x7 tables. Weapons and Maps write here.

Paths are remembered between sessions.

## Loading resources

Press **Load Resources**. If the client has more than one source available, a
dialog lets you pick which one to browse:

- **resource.s4hd** - the original packed container.
- **data#.bin packs** - a client already migrated to the pack format
  (`resources_index.json`). Asks for the pack key.
- **extracted_resources** - loose files on disk. Use this to work directly on
  an extracted folder without repacking each time.

You can keep both a client folder and a separate extracted folder configured and
switch between them from this dialog.

## Extract

**Extract** menu. Unpacks `resource.s4hd` / `_resources` into an
`extracted_resources` folder next to the client, so the files can be edited with
any tool.

## Pack

**Pack** menu. Builds everything in `extracted_resources` back into
`resource.s4hd` + `_resources` so the client can read it again. Use this after
you finish editing.

## Resource browser

Once loaded, the left tree shows the client files. For a selected file you can:

- **Preview** text, images, `.scn` and `.seq` files.
- **Edit text** for xml/lua/config files and save it back.
- **Replace file** with one from disk.
- **Replace texture** referenced inside a `.scn`.
- **Delete** a resource.
- **Extract selected** files/folders to a folder of your choice.

When browsing a loose (extracted) source, edits are written straight to the
files on disk. When browsing the packed client, changes are saved back into
`resource.s4hd`.

## 3D preview

`.scn` and `.seq` files open in an in-app 3D viewer:

- Models render with their real textures.
- Animations play automatically (morph, node transforms and skeletal clips).
- `Q` / `E` cycle through animation clips.
- Character pieces (bodies, hands, feet) show in bind pose; full characters can
  be assembled and posed.

## Add Tools (Weapons, Costumes, Maps)

**Add Tools** menu.

### Add Weapons

1. Put the weapon files in your **Mods Folder**.
2. Make sure the client and server-data paths are set, and the database is
   connected.
3. Click **Add Weapons**. It copies the weapon resources into the client and
   writes the item info / weapon xml into the server data and database.
4. **Pack** when done.

### Add Costumes

1. Put the costume files in your **Mods Folder**.
2. Client + server-data paths set, database connected.
3. Click **Add Costumes**. It adds the costume resources and registers the item
   so it shows in game.
4. **Pack** when done.

### Add Maps

1. Put your map info files (`.ini`) in `resources/maps/mapinfo/` and the preview
   image next to them.
2. Set the client path.
3. Click **Add Maps**. It registers each map in the client map list and name
   table and enables its game modes.
4. **Pack** when done.

> Map ids are a single byte, so they stay between 2 and 255.

## Convert (XML / XBN)

**Convert** menu.

- **XML to XBN** - pack an `.xml` table into the binary `.xbn` the client reads.
- **XBN to XML** - decrypt an `.xbn` back to readable XML. Handles several files
  at once.

## Crypt

**Crypt** menu. Encrypt or decrypt game files, and convert models to editable
JSON:

- **Decrypt / Crypt Shop S4** - the shop table.
- **Decrypt / Crypt .SEQ** - sequence (effect timeline) files.
- **Decrypt / Crypt Lua** - Lua scripts (handles the Korean encoding).
- **SCN to JSON / JSON to SCN** - dump a `.scn` to editable JSON (matrices,
  poses, morph) and patch it back losslessly.
- **SEQ to JSON / JSON to SEQ** - same for `.seq` files.

## Database

Fill the database fields (host / user / password / database and the item
tables) and turn the database toggle on. Weapons and Costumes use it to register
the new item on the server so it appears in game. Maps do not need it.
