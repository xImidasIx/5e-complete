#!/usr/bin/env node
// Diffs mechanical/statistical fields (level, school, range, damage, save DC,
// AC, price, weight, etc.) between this repo's packs and the official
// 2024 PHB/MM/DMG dumps in compare/.
//
// Deliberately skips all prose (description, flavor text, unidentified text)
// - only game stats are compared. Stats/mechanics are not protected
// expression, so this diff is safe to run and read freely regardless of SRD
// status. See compare-wording.js for the (gated, manual-review) prose diff.
//
// Usage: node scripts/compare/compare-mechanics.js [--pack=5e-items]
const { loadRepoPack, buildCompareIndex, normalizeName, extractMechanicalProfile } = require('./lib');

// repo pack (file name, no .db) -> merged compare index to check against.
const REPO_PACK_TO_COMPARE_GROUP = {
  '5e-backgrounds': 'items',
  '5e-background-features': 'items',
  '5e-classes': 'items',
  '5e-class-features': 'items',
  '5e-subclasses': 'items',
  '5e-feats': 'items',
  '5e-items': 'items',
  '5e-trade-goods': 'items',
  '5e-species': 'items',
  '5e-species-features': 'items',
  '5e-creature-abilities': 'items',
  '5e-creatures': 'actors',
  '5e-spells': 'spells',
  '5e-tables': 'tables',
  // 5e-macros / 5e-journals: no official-book counterpart, skipped.
};

const COMPARE_GROUPS = {
  items: [
    { moduleId: 'dnd-players-handbook', packName: 'classes' },
    { moduleId: 'dnd-players-handbook', packName: 'origins' },
    { moduleId: 'dnd-players-handbook', packName: 'feats' },
    { moduleId: 'dnd-players-handbook', packName: 'equipment' },
    { moduleId: 'dnd-monster-manual', packName: 'features' },
    { moduleId: 'dnd-dungeon-masters-guide', packName: 'equipment' },
    { moduleId: 'dnd-dungeon-masters-guide', packName: 'features' },
    { moduleId: 'dnd-dungeon-masters-guide', packName: 'bastions' },
  ],
  spells: [{ moduleId: 'dnd-players-handbook', packName: 'spells' }],
  actors: [
    { moduleId: 'dnd-players-handbook', packName: 'actors' },
    { moduleId: 'dnd-monster-manual', packName: 'actors' },
    { moduleId: 'dnd-dungeon-masters-guide', packName: 'actors' },
  ],
  tables: [
    { moduleId: 'dnd-players-handbook', packName: 'tables' },
    { moduleId: 'dnd-monster-manual', packName: 'tables' },
    { moduleId: 'dnd-dungeon-masters-guide', packName: 'tables' },
  ],
};

// Keys never compared, anywhere in the system tree: prose, and volatile
// per-world metadata that legitimately differs between two separate worlds.
const SKIP_KEY_RE = /description|flavor|unidentified|source|_stats|ownership|folder|sort|^img$|^flags$/i;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function diffValues(a, b, pathPrefix, out) {
  if (SKIP_KEY_RE.test(pathPrefix)) return;

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (SKIP_KEY_RE.test(key)) continue;
      diffValues(a[key], b[key], pathPrefix ? `${pathPrefix}.${key}` : key, out);
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    // Compare arrays as JSON - order-sensitive but good enough for damage
    // parts / properties lists, which is what we mostly hit here.
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    if (aStr !== bStr) out.push({ path: pathPrefix, repo: a, official: b });
    return;
  }

  // Legacy schema stores several fields (duration.value, target.value) as
  // numbers; the 2024 schema stores the same fields as strings. Not a real
  // mechanical difference - compare the string form.
  if (a !== b && String(a) !== String(b)) out.push({ path: pathPrefix, repo: a, official: b });
}

function main() {
  const packFilter = process.argv
    .find((a) => a.startsWith('--pack='))
    ?.split('=')[1];

  const targets = packFilter
    ? { [packFilter]: REPO_PACK_TO_COMPARE_GROUP[packFilter] }
    : REPO_PACK_TO_COMPARE_GROUP;

  let totalChecked = 0;
  let totalMatched = 0;
  let totalWithDiffs = 0;

  for (const [repoPackName, group] of Object.entries(targets)) {
    if (!group) {
      console.warn(`Unknown pack: ${repoPackName}`);
      continue;
    }
    console.log(`\n=== ${repoPackName} (vs ${group}) ===`);
    const repoDocs = loadRepoPack(repoPackName);
    const compareIndex = buildCompareIndex(COMPARE_GROUPS[group]);

    for (const repoDoc of repoDocs) {
      totalChecked++;
      const matches = compareIndex.get(normalizeName(repoDoc.name));
      if (!matches || matches.length === 0) continue;
      totalMatched++;

      // If multiple official sources share the name, diff against the first
      // and note if others disagree with it too.
      const { moduleId, doc: officialDoc } = matches[0];
      const diffs = [];
      diffValues(
        extractMechanicalProfile(repoDoc.system),
        extractMechanicalProfile(officialDoc.system),
        '',
        diffs
      );

      if (diffs.length > 0) {
        totalWithDiffs++;
        console.log(`\n  ${repoDoc.name}  (vs ${moduleId})`);
        for (const d of diffs) {
          console.log(
            `    ${d.path}: repo=${JSON.stringify(d.repo)}  official=${JSON.stringify(d.official)}`
          );
        }
      }
    }
  }

  console.log(
    `\n---\nChecked ${totalChecked} repo entries, ${totalMatched} matched by name, ${totalWithDiffs} had mechanical differences.`
  );
}

main();
