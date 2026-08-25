// Shared helpers for compare-mechanics.js and compare-wording.js.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKS_DIR = path.join(ROOT, 'packs');
const COMPARE_DIR = path.join(ROOT, 'compare');
const CACHE_DIR = path.join(ROOT, '.compare-cache');

function readNedb(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Loads this repo's own pack by file name, e.g. "5e-items".
function loadRepoPack(name) {
  return readNedb(path.join(PACKS_DIR, `${name}.db`));
}

// Loads one pack from one compare/ module - either a flat .db (NeDB) or a
// pre-extracted directory of JSON files under .compare-cache/ (produced by
// extract-compare-packs.sh from a LevelDB pack).
function loadComparePack(moduleId, packName) {
  const flatFile = path.join(COMPARE_DIR, moduleId, 'packs', `${packName}.db`);
  if (fs.existsSync(flatFile)) return readNedb(flatFile);

  const cacheDir = path.join(CACHE_DIR, moduleId, packName);
  if (fs.existsSync(cacheDir)) {
    return fs
      .readdirSync(cacheDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')));
  }

  console.warn(
    `  (no data for ${moduleId}/${packName} - run scripts/compare/extract-compare-packs.sh first)`
  );
  return [];
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

// Builds a name -> [{ moduleId, doc }] index across several compare packs,
// so a repo entry can be checked against all of them at once (e.g. an item
// might show up in the PHB pack and also the DMG pack).
function buildCompareIndex(sources) {
  const index = new Map();
  for (const { moduleId, packName } of sources) {
    for (const doc of loadComparePack(moduleId, packName)) {
      const key = normalizeName(doc.name);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ moduleId, packName, doc });
    }
  }
  return index;
}

// --- Activities-schema normalization -----------------------------------
// The 2024 dnd5e system moved damage/save/attack/utility-roll data off the
// top-level system object and into system.activities.<id>.*. This repo's
// packs (see fix/2024-pack-migration) still use the pre-Activities legacy
// shape. So a raw deep-diff of system trees is mostly schema noise, not
// real mechanical drift. This flattens either shape into one comparable
// profile.

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

function normalizeSave(save) {
  if (!save || !save.ability) return null; // legacy schema keeps an empty save skeleton even when unused
  if (save.dc && typeof save.dc === 'object') {
    // Activities schema: { ability, dc: { calculation, formula } }
    const auto = !save.dc.calculation || save.dc.calculation === 'spellcasting';
    return { ability: save.ability || '', mode: auto ? 'auto' : 'fixed', value: auto ? '' : save.dc.formula || '' };
  }
  // Legacy schema: { ability, dc, scaling }
  const auto = !save.scaling || save.scaling === 'spell';
  return { ability: save.ability || '', mode: auto ? 'auto' : 'fixed', value: auto ? '' : save.dc ?? '' };
}

function firstActivity(system) {
  const activities = system?.activities;
  if (!activities || typeof activities !== 'object') return null;
  const values = Object.values(activities);
  return values.length ? values[0] : null;
}

// Produces { level, school, range, duration, target, damageParts, save,
// formula, components, rarity, price, weight, armor, properties } from a
// document's system data, regardless of which schema generation it's in.
function extractMechanicalProfile(system) {
  if (!system) return {};
  const activity = firstActivity(system);

  const damageSource = activity?.damage?.parts ?? system.damage?.parts ?? [];
  const damageParts = damageSource
    .map(partToFormula)
    .map((p) => `${p.formula}|${p.type}`)
    .sort();

  const saveSource = activity?.save ?? system.save;
  const formulaSource = activity?.roll?.formula ?? system.formula ?? '';

  const properties = Array.isArray(system.properties) ? [...system.properties].sort() : system.properties;

  return {
    level: system.level,
    school: system.school,
    range: system.range && { value: system.range.value ?? null, units: system.range.units ?? '' },
    duration: system.duration && { value: system.duration.value ?? null, units: system.duration.units ?? '' },
    target:
      system.target &&
      (system.target.template || system.target.affects
        ? {
            // Activities schema: prefer the area template if present, else the affects type.
            type: system.target.template?.type || system.target.affects?.type || '',
            units: system.target.template?.units || '',
            value: system.target.template?.size ?? system.target.affects?.count ?? '',
          }
        : { type: system.target.type || '', units: system.target.units || '', value: system.target.value ?? '' }),
    damageParts,
    save: normalizeSave(saveSource),
    formula: formulaSource,
    components: {
      vocal: properties?.includes?.('vocal') ?? system.components?.vocal ?? false,
      somatic: properties?.includes?.('somatic') ?? system.components?.somatic ?? false,
      material: properties?.includes?.('material') ?? system.components?.material ?? false,
      ritual: properties?.includes?.('ritual') ?? system.components?.ritual ?? false,
      concentration: properties?.includes?.('concentration') ?? system.components?.concentration ?? false,
    },
    rarity: system.rarity,
    price: system.price?.value,
    weight: system.weight?.value ?? system.weight,
    armor: system.armor && { value: system.armor.value, type: system.armor.type },
  };
}

module.exports = {
  ROOT,
  PACKS_DIR,
  COMPARE_DIR,
  CACHE_DIR,
  loadRepoPack,
  loadComparePack,
  buildCompareIndex,
  normalizeName,
  extractMechanicalProfile,
};
