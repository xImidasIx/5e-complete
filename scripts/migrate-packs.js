#!/usr/bin/env node
// Migrates packs/*.db (NeDB-style ndjson Foundry compendiums) from the legacy
// v9 schema to current Foundry/dnd5e schema, and repairs cross-references.
//
// Fixes applied per line (per Document):
//   1. "data" -> "system" on any object that also has a sibling "type" key
//      (top-level Documents and embedded Documents such as Actor.items[]).
//   2. @Compendium[module.pack.id]{label} -> @UUID[Compendium.module.pack.id]{label}
//   3. Module id in every @Compendium/@UUID link pointing at this module is
//      rewritten from stale historical ids (5e-complete, 5e-complete-V11,
//      completeCompendium, metaCompendium) to the current module.json id.
//   4. Pack name in those links is rewritten via PACK_RENAMES (old pack file
//      name -> current pack file name), so links survive the 2024 races/
//      roll-tables renames.
//
// Links into other modules/systems (dnd5e.*, world.*, any third-party module)
// are left untouched - only references to this module's own content are fixed.
//
// Usage: node scripts/migrate-packs.js [--dry-run]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(ROOT, 'packs');
const MODULE_JSON = path.join(ROOT, 'module.json');
const DRY_RUN = process.argv.includes('--dry-run');

const moduleData = JSON.parse(fs.readFileSync(MODULE_JSON, 'utf8'));
const CURRENT_MODULE_ID = moduleData.id;

// Historical ids this module has been published under, in module.json history.
const STALE_MODULE_IDS = [
  '5e-complete',
  '5e-complete-V11',
  'completeCompendium',
  'metaCompendium',
];

// Old pack file name -> current pack file name.
const PACK_RENAMES = {
  '5e-races': '5e-species',
  '5e-racial-features': '5e-species-features',
  '5e-roll-tables': '5e-tables',
  '5e-monster-features': '5e-creature-abilities',
};

function renamePack(pack) {
  return PACK_RENAMES[pack] || pack;
}

const stats = {
  linesProcessed: 0,
  dataToSystem: 0,
  compendiumToUuid: 0,
  moduleIdFixed: 0,
  packRenamed: 0,
};

// Recursively rename "data" -> "system" on any object that is itself a
// Document (has a sibling "type" key), without touching unrelated "data"
// keys that don't fit that shape.
function migrateSchema(node) {
  if (Array.isArray(node)) {
    for (const item of node) migrateSchema(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(node, 'data') &&
      Object.prototype.hasOwnProperty.call(node, 'type') &&
      !Object.prototype.hasOwnProperty.call(node, 'system')) {
    node.system = node.data;
    delete node.data;
    stats.dataToSystem++;
  }

  for (const key of Object.keys(node)) {
    migrateSchema(node[key]);
  }
}

// Matches @Compendium[module.pack.id]{label} or @UUID[Compendium.module.pack....]
// Captures the module+pack prefix so it can be validated/rewritten, leaving
// the id / embedded-doctype tail and the {label} alone.
const COMPENDIUM_RE = /@Compendium\[([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.([^\]]+)\]/g;
const UUID_RE = /@UUID\[Compendium\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\.([^\]]+)\]/g;

function fixLinks(text) {
  text = text.replace(COMPENDIUM_RE, (match, mod, pack, rest) => {
    if (!STALE_MODULE_IDS.includes(mod) && mod !== CURRENT_MODULE_ID) {
      return match; // link into another module/system - leave untouched
    }
    stats.compendiumToUuid++;
    if (mod !== CURRENT_MODULE_ID) stats.moduleIdFixed++;
    const newPack = renamePack(pack);
    if (newPack !== pack) stats.packRenamed++;
    return `@UUID[Compendium.${CURRENT_MODULE_ID}.${newPack}.${rest}]`;
  });

  text = text.replace(UUID_RE, (match, mod, pack, rest) => {
    if (!STALE_MODULE_IDS.includes(mod) && mod !== CURRENT_MODULE_ID) {
      return match;
    }
    const newPack = renamePack(pack);
    if (mod === CURRENT_MODULE_ID && newPack === pack) return match; // already correct
    if (mod !== CURRENT_MODULE_ID) stats.moduleIdFixed++;
    if (newPack !== pack) stats.packRenamed++;
    return `@UUID[Compendium.${CURRENT_MODULE_ID}.${newPack}.${rest}]`;
  });

  return text;
}

// Walk the object tree fixing links in every string value (descriptions,
// table results, chat flavor text, etc. can all carry them).
function migrateLinks(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = fixLinks(node[i]);
      else migrateLinks(node[i]);
    }
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (typeof node[key] === 'string') {
      node[key] = fixLinks(node[key]);
    } else {
      migrateLinks(node[key]);
    }
  }
}

function migrateFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.trim() === '') return { changed: false, lines: 0 };

  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const outLines = lines.map((line) => {
    stats.linesProcessed++;
    const obj = JSON.parse(line);
    migrateSchema(obj);
    migrateLinks(obj);
    return JSON.stringify(obj);
  });

  const out = outLines.join('\n') + '\n';
  const changed = out !== raw;
  if (changed && !DRY_RUN) {
    fs.writeFileSync(filePath, out);
  }
  return { changed, lines: lines.length };
}

const files = fs
  .readdirSync(PACKS_DIR)
  .filter((f) => f.endsWith('.db'))
  .map((f) => path.join(PACKS_DIR, f));

for (const file of files) {
  const before = { ...stats };
  const result = migrateFile(file);
  const delta = {
    dataToSystem: stats.dataToSystem - before.dataToSystem,
    compendiumToUuid: stats.compendiumToUuid - before.compendiumToUuid,
    moduleIdFixed: stats.moduleIdFixed - before.moduleIdFixed,
    packRenamed: stats.packRenamed - before.packRenamed,
  };
  if (result.lines > 0) {
    console.log(
      `${path.basename(file)}: ${result.lines} entries, ` +
      `data->system: ${delta.dataToSystem}, ` +
      `links fixed: ${delta.compendiumToUuid} (module id: ${delta.moduleIdFixed}, pack renamed: ${delta.packRenamed})`
    );
  }
}

console.log('---');
console.log(`Total lines processed: ${stats.linesProcessed}`);
console.log(`data -> system: ${stats.dataToSystem}`);
console.log(`links normalized to @UUID: ${stats.compendiumToUuid}`);
console.log(`  of which module id fixed: ${stats.moduleIdFixed}`);
console.log(`  of which pack renamed: ${stats.packRenamed}`);
if (DRY_RUN) console.log('(dry run - no files written)');
