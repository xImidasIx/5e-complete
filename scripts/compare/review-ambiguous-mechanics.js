#!/usr/bin/env node
// Companion to apply-mechanics.js: expands every entry apply-mechanics.js
// SKIPs into a side-by-side view a human can act on without re-deriving
// context from raw JSON or the PDFs by hand. Reuses apply-mechanics.js's
// own computeApplyPatch() so the two scripts can never disagree about which
// entries are actually ambiguous.
//
// apply-mechanics.js's skip reasons boil down to two different shapes of
// "ambiguous," and this prints them differently:
//
//   1. Player-choice damage type (e.g. Fire Shield's cold-or-fire, a class
//      feature that scales with a chosen damage type). This is not a data
//      error - the legacy schema's damage part is a single [formula, type]
//      tuple and structurally cannot hold "one of several" the way the 2024
//      Activities schema's `types` array can. There is nothing to apply;
//      this is printed so a human can *confirm* the repo's single stored
//      type is a reasonable default, not silently miss that it's a
//      deliberate simplification.
//   2. Multiple official activities that disagree (different formulas, or
//      the repo already has >1 damage part and there's >1 official
//      activity to map them to). Here each candidate activity is printed
//      with its `name` (when the book gives one, e.g. Vitriolic Sphere's
//      "End of Turn Damage") or its `type`/`save.ability` as a fallback
//      label - that label is usually enough to match it to the right spot
//      in the repo doc's description by hand.
//
// This script is read-only - it never writes to packs/*.db. Resolve each
// entry by hand-editing the pack file, then re-run apply-mechanics.js to
// confirm it no longer appears in the skip list.
//
// Usage:
//   node scripts/compare/review-ambiguous-mechanics.js
//   node scripts/compare/review-ambiguous-mechanics.js --pack=5e-spells
//   node scripts/compare/review-ambiguous-mechanics.js --name="Vitriolic Sphere"
const fs = require('fs');
const path = require('path');
const { PACKS_DIR, buildCompareIndex, normalizeName } = require('./lib');
const { computeApplyPatch, REPO_PACK_TO_COMPARE_GROUP, COMPARE_GROUPS, partToFormula: baseSigPartToFormula } = require('./apply-mechanics');

function partLabel(part) {
  if (Array.isArray(part)) return `${part[0] || ''}${part[1] ? ' ' + part[1] : ''}`;
  if (part?.custom?.enabled) return `${part.custom.formula || ''}${(part.types || []).length ? ' ' + part.types.join('/') : ''}`;
  if (part?.number !== undefined) {
    let f = `${part.number}d${part.denomination}`;
    if (part.bonus) f += String(part.bonus).startsWith('-') ? part.bonus : `+${part.bonus}`;
    return `${f}${(part.types || []).length ? ' ' + part.types.join('/') : ''}`;
  }
  return `${part?.formula || ''}${part?.type ? ' ' + part.type : ''}`;
}

function describeActivity(a) {
  const label = a.name || a.type || '(unnamed activity)';
  const saveBit = a.save?.ability ? ` save:${a.save.ability}` : '';
  const parts = (a.damage?.parts || []).map(partLabel);
  const rollBit = a.roll?.formula ? `roll:${a.roll.formula}` : '';
  return `[${a.type}${saveBit}] "${label}" - ${[...parts, rollBit].filter(Boolean).join(', ') || '(no damage)'}`;
}

function main() {
  const packFilter = process.argv.find((a) => a.startsWith('--pack='))?.split('=')[1];
  const nameFilter = process.argv.find((a) => a.startsWith('--name='))?.split('=')[1];
  const targets = packFilter ? { [packFilter]: REPO_PACK_TO_COMPARE_GROUP[packFilter] } : REPO_PACK_TO_COMPARE_GROUP;

  let playerChoiceCount = 0;
  let needsMappingCount = 0;
  let sourceDisagreeCount = 0;

  for (const [repoPackName, group] of Object.entries(targets)) {
    if (!group) continue;
    const filePath = path.join(PACKS_DIR, `${repoPackName}.db`);
    const docs = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const compareIndex = buildCompareIndex(COMPARE_GROUPS[group]);

    for (const doc of docs) {
      if (nameFilter && doc.name !== nameFilter) continue;
      const matches = compareIndex.get(normalizeName(doc.name));
      if (!matches || matches.length === 0) continue;

      const { skipReason } = computeApplyPatch(doc, matches);
      if (!skipReason) continue; // apply-mechanics.js handles this cleanly, nothing to review

      const rSystem = doc.system || {};
      const repoParts = (rSystem.damage?.parts || []).map(partLabel);
      const repoPartsStr = repoParts.length ? repoParts.join(', ') : '(none)';

      if (skipReason.includes('compare/ sources disagree')) {
        sourceDisagreeCount++;
        console.log(`\n=== ${doc.name} (${repoPackName}) - ${skipReason} ===`);
        for (const m of matches) console.log(`  ${m.moduleId}/${m.packName}: school=${m.doc.system?.school} level=${m.doc.system?.level}`);
        continue;
      }

      const oSystem = matches[0].doc.system || {};
      const activities = oSystem.activities && typeof oSystem.activities === 'object' ? Object.values(oSystem.activities) : [];
      const damageBearing = activities.filter((a) => a.damage?.parts?.length || a.roll?.formula);

      if (skipReason.startsWith('damage part has multiple type options')) {
        playerChoiceCount++;
        console.log(`\n=== ${doc.name} (${repoPackName}) - player-choice damage type, not a data error ===`);
        console.log(`  repo:     ${repoPartsStr}`);
        for (const a of damageBearing) console.log(`  official: ${describeActivity(a)}`);
        console.log("  -> legacy schema can only hold one type; confirm repo's choice is reasonable, no fix needed.");
        continue;
      }

      needsMappingCount++;
      console.log(`\n=== ${doc.name} (${repoPackName}) - ${skipReason} ===`);
      console.log(`  repo has ${repoParts.length} damage part(s): ${repoPartsStr}`);
      console.log(`  repo actionType=${rSystem.actionType || '(none)'} save.ability=${rSystem.save?.ability || '(none)'}`);
      for (const a of damageBearing) console.log(`  official: ${describeActivity(a)}`);
    }
  }

  console.log(
    `\n---\n${playerChoiceCount} player-choice (no fix needed), ${needsMappingCount} need manual activity mapping, ${sourceDisagreeCount} compare/ source disagreements.`
  );
}

main();
