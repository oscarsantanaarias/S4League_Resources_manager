const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST = 'C:\\S4Client\\extracted_resources\\manifest.json';
const DEFAULT_EXTRACTED_ROOT = 'C:\\S4Client\\extracted_resources';
const DEFAULT_HASH_ROOT = 'C:\\S4Client\\_resources';
const DEFAULT_JSON_OUT = 'C:\\ItemManager\\manifest_check.json';
const DEFAULT_TXT_OUT = 'C:\\ItemManager\\manifest_check.txt';

function normalizeWinPath(value) {
  return String(value || '')
    .replace(/\//g, '\\')
    .replace(/^\\+/, '')
    .toLowerCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  const stat = safeStat(filePath);
  return !!(stat && stat.isFile());
}

function buildCaseInsensitiveFileSet(rootDir) {
  const set = new Set();
  if (!fs.existsSync(rootDir)) {
    return set;
  }

  const stack = [''];
  while (stack.length) {
    const relative = stack.pop();
    const currentDir = path.join(rootDir, relative);
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRelative);
        continue;
      }
      if (entry.isFile()) {
        set.add(normalizeWinPath(childRelative));
      }
    }
  }

  return set;
}

function formatEntryLine(entry) {
  return [
    `[${entry.status.toUpperCase()}] ${entry.fullName}`,
    `  hash/checksumHex : ${entry.checksumHex}`,
    `  resourceFile     : ${entry.resourceFile}`,
    `  expectedPath     : ${entry.expectedPath}`,
    `  extractedExists  : ${entry.extractedExists ? 'YES' : 'NO'}`,
    `  hashExists       : ${entry.hashExists ? 'YES' : 'NO'}`,
    `  length           : ${entry.length}`,
    `  outputSize       : ${entry.outputSize}`,
  ].join('\n');
}

function main() {
  const manifestPath = process.argv[2] || DEFAULT_MANIFEST;
  const extractedRoot = process.argv[3] || DEFAULT_EXTRACTED_ROOT;
  const hashRoot = process.argv[4] || DEFAULT_HASH_ROOT;
  const jsonOut = process.argv[5] || DEFAULT_JSON_OUT;
  const txtOut = process.argv[6] || DEFAULT_TXT_OUT;

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];

  const extractedSet = buildCaseInsensitiveFileSet(extractedRoot);
  const hashSet = buildCaseInsensitiveFileSet(hashRoot);

  const hashToFullName = {};
  const resourceFileToFullName = {};
  const hashToExpectedPath = {};

  const reportEntries = entries.map((entry, index) => {
    const fullName = String(entry.fullName || '');
    const checksumHex = String(entry.checksumHex || '').toLowerCase();
    const resourceFile = String(entry.resourceFile || '').toLowerCase();
    const hashFileName = resourceFile || checksumHex;
    const expectedPath = path.join(extractedRoot, ...fullName.split('/'));
    const expectedRelative = normalizeWinPath(fullName);
    const hashRelative = normalizeWinPath(hashFileName);
    const extractedExists = extractedSet.has(expectedRelative) || fileExists(expectedPath);
    const hashExists = !!hashFileName && (hashSet.has(hashRelative) || fileExists(path.join(hashRoot, hashFileName)));
    const status = extractedExists ? 'ok' : 'missing';

    if (checksumHex) {
      hashToFullName[checksumHex] = fullName;
      hashToExpectedPath[checksumHex] = expectedPath;
    }
    if (resourceFile) {
      resourceFileToFullName[resourceFile] = fullName;
    }

    return {
      index,
      status,
      extractedStatus: extractedExists ? 'ok' : 'missing',
      hashStatus: hashExists ? 'ok' : 'missing',
      checksumHex,
      hash: checksumHex,
      resourceFile,
      hashFileName,
      fullName,
      expectedPath,
      length: Number(entry.length || 0),
      outputSize: Number(entry.outputSize || 0),
      extractedExists,
      hashExists,
    };
  });

  const summary = {
    manifestPath,
    extractedRoot,
    hashRoot,
    version: manifest.version ?? null,
    count: Number(manifest.count || reportEntries.length),
    extracted: Number(manifest.extracted || 0),
    failed: Number(manifest.failed || 0),
    entries: reportEntries.length,
    extractedOk: reportEntries.filter(x => x.extractedExists).length,
    extractedMissing: reportEntries.filter(x => !x.extractedExists).length,
    hashOk: reportEntries.filter(x => x.hashExists).length,
    hashMissing: reportEntries.filter(x => !x.hashExists).length,
    bothOk: reportEntries.filter(x => x.extractedExists && x.hashExists).length,
    extractedOnly: reportEntries.filter(x => x.extractedExists && !x.hashExists).length,
    hashOnly: reportEntries.filter(x => !x.extractedExists && x.hashExists).length,
    bothMissing: reportEntries.filter(x => !x.extractedExists && !x.hashExists).length,
  };

  const jsonPayload = {
    summary,
    maps: {
      checksumHexToFullName: hashToFullName,
      resourceFileToFullName,
      checksumHexToExpectedPath: hashToExpectedPath,
    },
    entries: reportEntries,
  };

  const txtLines = [];
  txtLines.push('Manifest Check Report');
  txtLines.push('====================');
  txtLines.push(`manifestPath      : ${summary.manifestPath}`);
  txtLines.push(`extractedRoot     : ${summary.extractedRoot}`);
  txtLines.push(`hashRoot          : ${summary.hashRoot}`);
  txtLines.push(`version           : ${summary.version}`);
  txtLines.push(`entries           : ${summary.entries}`);
  txtLines.push(`extractedOk       : ${summary.extractedOk}`);
  txtLines.push(`extractedMissing  : ${summary.extractedMissing}`);
  txtLines.push(`hashOk            : ${summary.hashOk}`);
  txtLines.push(`hashMissing       : ${summary.hashMissing}`);
  txtLines.push(`bothOk            : ${summary.bothOk}`);
  txtLines.push(`extractedOnly     : ${summary.extractedOnly}`);
  txtLines.push(`hashOnly          : ${summary.hashOnly}`);
  txtLines.push(`bothMissing       : ${summary.bothMissing}`);
  txtLines.push('');
  txtLines.push('Entries');
  txtLines.push('-------');
  for (const entry of reportEntries) {
    txtLines.push(formatEntryLine(entry));
  }

  ensureParent(jsonOut);
  ensureParent(txtOut);
  fs.writeFileSync(jsonOut, JSON.stringify(jsonPayload, null, 2));
  fs.writeFileSync(txtOut, txtLines.join('\n'));

  console.log(`Done. JSON: ${jsonOut}`);
  console.log(`Done. TXT : ${txtOut}`);
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
