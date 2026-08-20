"use strict";

// Self check for the Season 1 pipeline. Needs a real client:
//   node s4zip_S1.test.cjs "D:/s1/S1 Client/FumbiClient"
// Nothing is written inside the client, everything goes to a temp folder.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const s1 = require("./s4zip_S1.cjs");
const auto = require("./s4zip.cjs");

const clientDir = process.argv[2] || "D:/s1/S1 Client/FumbiClient";
const containerPath = path.join(clientDir, "resource.s4hd");
const resourcesDir = path.join(clientDir, "_resources");

const archive = s1.parseContainer(containerPath);
assert.strictEqual(archive.version, 1);
assert.ok(archive.count > 0, "el contenedor no trae entradas");
assert.strictEqual(archive.entries.length, archive.count);

// el punto de entrada normal tiene que caer solo en el pipeline de Season 1
const viaAuto = auto.parseContainer(containerPath);
assert.strictEqual(viaAuto.containerMode, "s1");
assert.strictEqual(viaAuto.count, archive.count);

// cada tipo de recurso pasa por una rama distinta del descifrado
const samples = [".xml", ".x7", ".lua", ".scn", ".dds"];
const decoded = new Map();
for (const ext of samples) {
  const entry = archive.entries.find(item => item.fullName.endsWith(ext));
  if (!entry) continue;
  const data = s1.decodeResource(entry, resourcesDir).data;
  assert.ok(data.length > 0, `${entry.fullName} salio vacio`);
  decoded.set(ext, { entry, data });
}
assert.ok(decoded.has(".x7"), "no se encontro ningun .x7 para probar");
assert.ok(
  decoded.get(".x7").data.slice(0, 200).toString("latin1").includes("<?xml"),
  "el .x7 no quedo en texto plano"
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s4zip-s1-"));

// guardar y volver a leer tiene que dar el mismo indice
const savedPath = path.join(tmp, "resource.s4hd");
s1.saveContainer(archive, savedPath);
const reread = s1.parseContainer(savedPath);
assert.strictEqual(reread.count, archive.count);
for (let i = 0; i < archive.count; i++) {
  assert.strictEqual(reread.entries[i].fullName, archive.entries[i].fullName);
  assert.strictEqual(reread.entries[i].checksum, archive.entries[i].checksum);
  assert.strictEqual(reread.entries[i].length, archive.entries[i].length);
}

// escribir un recurso y volver a leerlo tiene que devolver los mismos bytes
const tmpResources = path.join(tmp, "_resources");
fs.mkdirSync(tmpResources, { recursive: true });
for (const ext of [".xml", ".x7"]) {
  if (!decoded.has(ext)) continue;
  const { entry, data } = decoded.get(ext);
  const copy = { ...entry };
  const mini = { version: 1, entries: [copy], season1: true };
  s1.setResourceData(mini, tmpResources, copy.fullName, data);
  const back = s1.decodeResource(copy, tmpResources).data;
  assert.ok(back.equals(data), `${copy.fullName} no sobrevivio el round trip`);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`ok - ${archive.count} entradas, ${decoded.size} tipos decodificados, round trip limpio`);
