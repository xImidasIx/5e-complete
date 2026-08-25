#!/usr/bin/env node
// Auto-applies a safe subset of the mechanical differences compare-mechanics.js
// finds, writing corrected values back into this repo's packs/*.db.
//
// Only writes fields that are pure stat data with a low-risk, unambiguous
// mapping back into this repo's (still legacy-schema) documents:
//   school, damage dice + damage type, range.value/units, duration.value/units,
//   formula (utility roll formula, e.g. Resistance's "1d4").
//
// Deliberately NOT auto-applied (left for compare-mechanics.js to report,
// for you to fix by hand):
//   - save (ability/DC): legacy schema's dc field often needs judgment about
//     fixed vs spellcasting-scaled DCs.
//   - components: derived from a properties array, edge cases around what
//     counts as "material" etc.
//   - target.type/value/units: the 2024 schema split some legacy target
//     types (e.g. old "radius" covered both a 3D "sphere" AoE and a 2D
//     ground "circle" AoE) - picking the right one takes reading the spell,
//     not a mechanical rule.
//   - anything from a spell/item with more than one activity: which
//     activity is "the" damage/formula source isn't reliable to guess.
//   - anything where more than one compare/ source disagrees on the value.
//
// Default is a dry run (prints the plan, writes nothing). Pass --write to
// actually modify packs/*.db. Always review with `git diff` before
// committing - this changes tracked game data, not prose.
//
// Usage:
//   node scripts/compare/apply-mechanics.js               # dry run, all mapped packs
//   node scripts/compare/apply-mechanics.js --pack=5e-spells
//   node scripts/compare/apply-mechanics.js --pack=5e-spells --write
const fs = require('fs');
const path = require('path');
const { PACKS_DIR, buildCompareIndex, normalizeName } = require('./lib');

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
  '5e-spells': 'spells',
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
};

// Legacy schema's range/duration/target .value fields are plain numbers.
// The 2024 schema allows dynamic formula strings there (e.g. cantrip
// range/duration scaling with @scaling.increase) - those can't be
// mechanically transplanted into a NumberField, so treat them as
// not-safely-applicable rather than write invalid data.
function isSimpleNumeric(v) {
  if (v === null || v === undefined || v === '') return true;
  return /^-?\d+(\.\d+)?$/.test(String(v));
}

// This repo's packs currently store range/duration .value as numbers (even
// though the 2024 schema's field type is a string) - keep that convention
// consistent rather than introducing mixed types across one pack file.
function toRepoNumberConvention(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}

// Legacy repo actionType -> 2024 activity.type values it can plausibly match.
const ACTION_TYPE_MAP = {
  msak: ['attack'],
  mwak: ['attack'],
  rsak: ['attack'],
  rwak: ['attack'],
  save: ['save'],
  heal: ['heal'],
  abil: ['check', 'utility'],
  util: ['utility', 'damage'],
  other: ['utility', 'damage'],
};

function damageSig(a) {
  const parts = (a.damage?.parts || []).map(partToFormula).map((p) => `${p.formula}|${p.type}`);
  return JSON.stringify(parts.sort()) + '|' + (a.roll?.formula || '');
}

// Narrows a list of damage-bearing official activities down to one, or
// returns null when it genuinely can't be done safely. Order of attempts:
//   1. All activities agree on damage/formula (e.g. a spell with a "cast"
//      and a "recast" activity that deal the same damage) - agreement, not
//      ambiguity, so just use it.
//   2. Repo's damage already matches exactly one activity's signature - the
//      repo doc is already right, use that one as the anchor (no-op patch).
//   3. Repo's actionType maps to exactly one activity's type.
//   4. Repo's save.ability matches exactly one activity's save.ability.
function selectDamageActivity(activities, rSystem) {
  const sigs = activities.map(damageSig);
  if (new Set(sigs).size === 1) return activities[0];

  const repoParts = (rSystem.damage?.parts || []).map(partToFormula).map((p) => `${p.formula}|${p.type}`);
  const repoSig = JSON.stringify(repoParts.sort()) + '|' + (rSystem.formula || '');
  const repoMatches = activities.filter((a, i) => sigs[i] === repoSig);
  if (repoMatches.length === 1) return repoMatches[0];

  const wantedTypes = ACTION_TYPE_MAP[rSystem.actionType] || [];
  if (wantedTypes.length) {
    const typeMatches = activities.filter((a) => wantedTypes.includes(a.type));
    if (typeMatches.length === 1) return typeMatches[0];
  }

  if (rSystem.save?.ability) {
    const saveMatches = activities.filter((a) => a.save?.ability === rSystem.save.ability);
    if (saveMatches.length === 1) return saveMatches[0];
  }

  return null;
}

function partToFormula(part) {
  if (Array.isArray(part)) return { formula: part[0] || '', type: part[1] || '' };
  if (part?.custom?.enabled) return { formula: part.custom.formula || '', type: (part.types || [])[0] || '' };
  if (part?.number !== undefined) {
    let f = `${part.number}d${part.denomination}`;
    if (part.bonus) f += String(part.bonus).startsWith('-') ? part.bonus : `+${part.bonus}`;
    return { formula: f, type: (part.types || [])[0] || '' };
  }
  return { formula: part?.formula || '', type: part?.type || '' };
}

// Returns { patch: [{path, oldValue, newValue}], skipReason } for one repo
// doc vs its matched official docs. patch is empty (not skipped) when
// everything already agrees.
function computeApplyPatch(repoDoc, matches) {
  if (matches.length > 1) {
    const distinctSchools = new Set(matches.map((m) => m.doc.system?.school));
    const distinctLevels = new Set(matches.map((m) => m.doc.system?.level));
    if (distinctSchools.size > 1 || distinctLevels.size > 1) {
      return { patch: [], skipReason: `${matches.length} compare/ sources disagree` };
    }
  }
  const official = matches[0].doc;
  const oSystem = official.system || {};
  const rSystem = repoDoc.system || {};
  const activities = oSystem.activities && typeof oSystem.activities === 'object' ? Object.values(oSystem.activities) : [];

  const patch = [];

  if (oSystem.school !== undefined && rSystem.school !== oSystem.school) {
    patch.push({ path: 'system.school', oldValue: rSystem.school, newValue: oSystem.school });
  }

  if (oSystem.range) {
    // undefined means "not applicable" in the Activities schema (e.g. touch/self
    // ranges have no numeric value) - this repo's convention for that is null.
    const officialRangeRaw = oSystem.range.value === undefined ? null : oSystem.range.value;
    if (isSimpleNumeric(officialRangeRaw)) {
      const officialRangeValue = toRepoNumberConvention(officialRangeRaw);
      if (rSystem.range?.value !== officialRangeValue) {
        patch.push({ path: 'system.range.value', oldValue: rSystem.range?.value, newValue: officialRangeValue });
      }
    }
    if (oSystem.range.units && rSystem.range?.units !== oSystem.range.units) {
      patch.push({ path: 'system.range.units', oldValue: rSystem.range?.units, newValue: oSystem.range.units });
    }
  }

  if (oSystem.duration) {
    const officialDurationRaw = oSystem.duration.value === undefined || oSystem.duration.value === '' ? null : oSystem.duration.value;
    if (isSimpleNumeric(officialDurationRaw)) {
      const officialDurationValue = toRepoNumberConvention(officialDurationRaw);
      if (rSystem.duration?.value !== officialDurationValue) {
        patch.push({ path: 'system.duration.value', oldValue: rSystem.duration?.value, newValue: officialDurationValue });
      }
    }
    if (oSystem.duration.units && rSystem.duration?.units !== oSystem.duration.units) {
      patch.push({ path: 'system.duration.units', oldValue: rSystem.duration?.units, newValue: oSystem.duration.units });
    }
  }

  // Damage dice / utility formula: with more than one activity, we can't
  // blindly trust "the first one" - pick a single damage-bearing activity via
  // selectDamageActivity() (agreement between activities, or a match against
  // this repo doc's own actionType/save.ability), and only skip when that
  // can't narrow it down to one.
  const damageBearing = activities.filter((a) => a.damage?.parts?.length || a.roll?.formula);
  let selectedActivity = null;
  if (damageBearing.length <= 1) {
    selectedActivity = damageBearing[0] || null;
  } else if ((rSystem.damage?.parts?.length || 0) > 1) {
    // Repo already stores more than one damage part in this legacy field
    // (e.g. an initial hit + a follow-up "at the start of your next turn"
    // tick, merged into one array). With several official activities to
    // choose from, picking just one would silently drop a part the repo
    // already has right - needs a human to confirm the activity mapping.
    return { patch: [], skipReason: `repo already has ${rSystem.damage.parts.length} damage parts and there are ${damageBearing.length} official activities - needs manual mapping, not auto-narrowed` };
  } else {
    selectedActivity = selectDamageActivity(damageBearing, rSystem);
    if (selectedActivity === null) {
      const summary = damageBearing
        .map((a) => JSON.stringify((a.damage?.parts || []).map(partToFormula).map((p) => `${p.formula}${p.type ? ' ' + p.type : ''}`)))
        .join(' vs ');
      return { patch: [], skipReason: `${damageBearing.length} damage-bearing activities disagree and don't match repo's actionType/save: ${summary}` };
    }
  }

  if (selectedActivity) {
    // A damage part with more than one entry in `types` is a genuine player
    // choice (e.g. Fire Shield's fire-or-cold) - the legacy schema's damage
    // part can only hold one type string, and silently keeping types[0]
    // would misrepresent the spell, so leave it for manual review instead.
    const multiTypePart = (selectedActivity.damage?.parts || []).find((p) => (p.types || []).length > 1);
    if (multiTypePart) {
      return { patch, skipReason: `damage part has multiple type options (player choice): ${multiTypePart.types.join('/')}` };
    }
    if (selectedActivity.damage?.parts?.length) {
      const officialParts = selectedActivity.damage.parts.map(partToFormula).map((p) => [p.formula, p.type]);
      const repoParts = (rSystem.damage?.parts || []).map((p) => partToFormula(p)).map((p) => [p.formula, p.type]);
      // The dnd-players-handbook dump sometimes leaves a damage part's type
      // untagged (empty string) even when the repo already has a real type
      // for it - don't let a data gap in the compare/ source blank out a
      // value the repo already has right.
      const wouldBlankOutType = officialParts.some(([, t]) => t === '') && repoParts.some(([, t]) => t !== '');
      // Never shrink the part count. A repo weapon/item can legitimately
      // combine base weapon damage + a bonus-effect damage in this one
      // legacy array (e.g. "1d6 piercing" + "4d6 lightning"), while the
      // matched official activity only covers the bonus effect (base
      // weapon damage lives elsewhere in the 2024 schema) - losing a part
      // needs a human to confirm, not a silent auto-shrink.
      const wouldShrink = officialParts.length < repoParts.length;
      // A repo damage part whose formula includes "@mod" is almost always a
      // weapon's own base attack damage (dice + ability mod). In the 2024
      // schema that lives in system.damage.base on the item itself, not in
      // any activity - an activity's damage.parts is either empty (base
      // damage handled via includeBase) or a bonus/secondary effect (e.g.
      // Mace of Disruption's radiant burst, Oathbow's sworn-enemy bonus
      // damage, which is worded as "an extra Nd6" on top of the weapon's
      // normal hit, not a replacement for it). A matched official formula
      // that itself has no @mod is a strong signal it's one of those bonus
      // effects, not the base attack - don't let it replace the base part.
      const looksLikeBaseWeaponDamage =
        repoParts.some(([formula]) => /@mod/.test(formula)) &&
        !officialParts.some(([formula]) => /@mod/.test(formula));
      if (!wouldBlankOutType && !wouldShrink && !looksLikeBaseWeaponDamage && JSON.stringify(officialParts) !== JSON.stringify(repoParts)) {
        patch.push({ path: 'system.damage.parts', oldValue: repoParts, newValue: officialParts });
      }
    }
    if (selectedActivity.roll?.formula && selectedActivity.roll.formula !== rSystem.formula) {
      patch.push({ path: 'system.formula', oldValue: rSystem.formula, newValue: selectedActivity.roll.formula });
    }
  }

  return { patch, skipReason: null };
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.'); // e.g. "system.range.value"
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function main() {
  const write = process.argv.includes('--write');
  const packFilter = process.argv.find((a) => a.startsWith('--pack='))?.split('=')[1];
  const targets = packFilter ? { [packFilter]: REPO_PACK_TO_COMPARE_GROUP[packFilter] } : REPO_PACK_TO_COMPARE_GROUP;

  let totalApplied = 0;
  let totalSkipped = 0;

  for (const [repoPackName, group] of Object.entries(targets)) {
    if (!group) {
      console.warn(`Unknown pack: ${repoPackName}`);
      continue;
    }
    const filePath = path.join(PACKS_DIR, `${repoPackName}.db`);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
    const docs = lines.map((line) => JSON.parse(line));
    const compareIndex = buildCompareIndex(COMPARE_GROUPS[group]);

    let fileChanged = false;
    console.log(`\n=== ${repoPackName} ===`);

    for (const doc of docs) {
      const matches = compareIndex.get(normalizeName(doc.name));
      if (!matches || matches.length === 0) continue;

      const { patch, skipReason } = computeApplyPatch(doc, matches);
      if (skipReason) {
        totalSkipped++;
        console.log(`  SKIP  ${doc.name}: ${skipReason}`);
        // A skip on the damage/formula field doesn't invalidate other safe
        // fields (school/range/duration) computed earlier in the same
        // patch - apply those instead of discarding real fixes.
        if (patch.length === 0) continue;
        console.log(`  ${write ? '  (still applying' : '  (would still apply'} ${patch.length} unrelated safe field(s) below)`);
      }
      if (patch.length === 0) continue;

      totalApplied++;
      console.log(`  ${write ? 'APPLY' : 'PLAN '} ${doc.name}`);
      for (const change of patch) {
        console.log(`    ${change.path}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(change.newValue)}`);
        if (write) {
          setPath(doc, change.path, change.newValue);
          fileChanged = true;
        }
      }
    }

    if (write && fileChanged) {
      const out = docs.map((d) => JSON.stringify(d)).join('\n') + '\n';
      fs.writeFileSync(filePath, out);
      console.log(`  wrote ${filePath}`);
    }
  }

  console.log(
    `\n---\n${totalApplied} entries ${write ? 'updated' : 'would be updated'}, ${totalSkipped} skipped (ambiguous - needs manual review).`
  );
  if (!write) console.log('Dry run - pass --write to actually modify packs/*.db.');
}

if (require.main === module) {
  main();
} else {
  // Allow review-ambiguous-mechanics.js to reuse the exact same
  // ambiguity/skip logic instead of re-deriving a second copy of it that
  // could silently drift out of sync.
  module.exports = { computeApplyPatch, REPO_PACK_TO_COMPARE_GROUP, COMPARE_GROUPS, partToFormula };
}
