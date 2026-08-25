#!/usr/bin/env node
// Applies the old->new renames from srd-2024-renames.json to this repo's
// packs. Per-document, not a whole-file string replace: only mutates
// doc.name when it matches exactly, and only follows into doc.token.name
// when that token name mirrored the doc's OWN old name (not any doc
// anywhere in the file). A prior version of this script did a blind
// `"name":"Old"` string replace across the whole file, which also matched
// a token.name belonging to an unrelated actor that coincidentally shared
// the same label - see MIGRATION-BRIEF.md for the incident this caused.
//
// Skips merge cases (two old entries folding into one new feature) and
// omittedMonsters (need a real stat-block swap, not a name change) -
// those need manual content work, see MIGRATION-BRIEF.md.
//
// Usage: node scripts/compare/apply-2024-renames.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const renames = JSON.parse(fs.readFileSync(path.join(__dirname, 'srd-2024-renames.json'), 'utf8'));

const PACK_FOR_CATEGORY = {
  spells: '5e-spells',
  classFeatures: '5e-class-features',
  subclasses: '5e-subclasses',
  armor: '5e-items',
  magicItems: '5e-items',
  monsters: '5e-creatures',
};

// Two old entries merge into one new feature - can't blindly rename both
// (would create duplicate-named docs). Handle by hand.
const SKIP = new Set(['Stillness of Mind', 'Purity of Body']);

const applied = [];
const skipped = [];

for (const [category, packName] of Object.entries(PACK_FOR_CATEGORY)) {
  const entries = (renames[category] || []).filter(({ old }) => {
    if (SKIP.has(old)) {
      skipped.push(`${packName}: "${old}" (merge case, needs manual content work)`);
      return false;
    }
    return true;
  });
  if (!entries.length) continue;

  const renameMap = new Map(entries.map(({ old, new: n }) => [old, n]));
  const file = path.join(ROOT, 'packs', `${packName}.db`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  let changed = false;

  const out = lines.map((line) => {
    if (!line) return line;
    const doc = JSON.parse(line);
    const newName = renameMap.get(doc.name);
    if (!newName) return line;

    const oldName = doc.name;
    doc.name = newName;
    if (doc.token && doc.token.name === oldName) doc.token.name = newName;
    changed = true;
    applied.push(`${packName}: "${oldName}" -> "${newName}" (_id ${doc._id})`);
    return JSON.stringify(doc);
  });

  if (changed) fs.writeFileSync(file, out.join('\n') + '\n');
}

console.log('=== Applied ===');
applied.forEach((l) => console.log(l));
console.log('\n=== Skipped (manual) ===');
skipped.forEach((l) => console.log(l));
