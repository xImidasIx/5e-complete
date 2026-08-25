#!/usr/bin/env node
// Flags entries in this repo's packs that still use a pre-2024 (SRD 5.1) name
// for something WotC renamed in SRD 5.2.1. Source: srd-2024-renames.json,
// itself transcribed from compare/converting-to-srd-5.2.1.pdf.
//
// This is a naming check only - it doesn't touch content/stats. Renaming an
// entry is a manual edit (rename + update anything that links to it by name).
//
// Usage: node scripts/compare/check-2024-renames.js
const fs = require('fs');
const path = require('path');
const { loadRepoPack } = require('./lib');

const renames = JSON.parse(fs.readFileSync(path.join(__dirname, 'srd-2024-renames.json'), 'utf8'));

const PACK_FOR_CATEGORY = {
  spells: '5e-spells',
  classFeatures: '5e-class-features',
  subclasses: '5e-subclasses',
  armor: '5e-items',
  magicItems: '5e-items',
  monsters: '5e-creatures',
  omittedMonsters: '5e-creatures',
};

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/[’']/g, "'");
}

let staleCount = 0;

for (const [category, packName] of Object.entries(PACK_FOR_CATEGORY)) {
  const entries = renames[category] || [];
  if (!entries.length) continue;
  const pack = loadRepoPack(packName);
  const byName = new Map(pack.map((d) => [normalizeName(d.name), d]));

  for (const { old, new: newName, note } of entries) {
    const oldMatch = byName.get(normalizeName(old));
    if (!oldMatch) continue;
    staleCount++;
    if (category === 'omittedMonsters') {
      console.log(`[OMITTED] ${packName}: "${old}"${note ? ` (${note})` : ''} was dropped from SRD 5.2.1 - use "${newName}" as the replacement stat block`);
    } else {
      console.log(`[STALE]   ${packName}: "${old}" -> rename to "${newName}"${note ? `  // ${note}` : ''}`);
    }
  }
}

console.log(`\n${staleCount} pre-2024 name(s) found across packs.`);
if (staleCount === 0) console.log('All checked packs use current SRD 5.2.1 names.');
