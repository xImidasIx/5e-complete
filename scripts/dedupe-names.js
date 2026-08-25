#!/usr/bin/env node
// Dedupes same-name Documents in packs/*.db.
//
// For each group of docs sharing a `name`:
//   1. Compute a stat signature (ability .value scores + hp formula + CR/
//      level, for actors; or activation/damage/save shape for items) ignoring
//      derived/computed fields (mod, prof, passive, dc, etc.) and cosmetic
//      fields (img, biography prose, source string, ids).
//   2. If every doc in the group has the SAME signature -> genuine reprint of
//      the same stat block. Keep the "richest" copy (most keys / longest
//      biography - a proxy for "has derived fields + curated flavor text")
//      and delete the rest.
//   3. If signatures differ -> genuine variant. Rename each doc to
//      "Name (source)" using system.details.source / system.source, falling
//      back to "Name (variant N)" when source is blank or two docs in the
//      same group share a source string.
//
// Never auto-deletes cross-referenced docs silently - reports any doc whose
// _id is referenced elsewhere in the SAME pack file so those can be checked
// by hand before re-running with --apply.
//
// Usage:
//   node scripts/dedupe-names.js --pack=5e-creatures            # dry run, report only
//   node scripts/dedupe-names.js --pack=5e-creatures --apply    # write changes

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKS_DIR = path.join(ROOT, 'packs');
const APPLY = process.argv.includes('--apply');
const packArg = process.argv.find((a) => a.startsWith('--pack='));
const onlyPack = packArg ? packArg.split('=')[1] : null;

function abilitySig(d) {
  const ab = d.system && d.system.abilities;
  if (!ab || typeof ab !== 'object') return null;
  return Object.keys(ab)
    .sort()
    .map((k) => `${k}:${ab[k] && ab[k].value}`)
    .join(',');
}

function hpSig(d) {
  const hp = d.system && d.system.attributes && d.system.attributes.hp;
  if (!hp) return null;
  return `${hp.formula || ''}|${hp.max ?? ''}`;
}

function crSig(d) {
  const det = d.system && d.system.details;
  if (!det) return null;
  const cr = det.cr;
  return cr === undefined ? null : String(cr);
}

function itemShapeSig(d) {
  const s = d.system;
  if (!s) return null;
  const parts = [
    s.activation && s.activation.type,
    s.range && `${s.range.value}${s.range.units}`,
    s.duration && `${s.duration.value}${s.duration.units}`,
    s.damage && JSON.stringify(s.damage.parts || []),
    s.save && `${s.save.ability}${s.save.dc}`,
    s.level,
    s.school,
    s.requirements,
  ];
  return parts.join('|');
}

function signature(d) {
  if (d.type === 'npc' || d.type === 'character') {
    const a = abilitySig(d);
    const h = hpSig(d);
    const c = crSig(d);
    if (a === null && h === null && c === null) return null;
    return `A:${a}/H:${h}/C:${c}`;
  }
  // feats/spells/items/etc.
  return `I:${itemShapeSig(d)}`;
}

function richness(d) {
  const bioLen = JSON.stringify(d.system && d.system.details && d.system.details.biography || '').length;
  const keyCount = JSON.stringify(d).length; // crude proxy: bigger serialized doc = more derived/curated fields
  return bioLen * 1000 + keyCount;
}

function sourceOf(d) {
  const det = d.system && d.system.details;
  const src = (det && det.source) || (d.system && d.system.source) || '';
  return String(src || '').trim();
}

// For feat-type docs (class features), "requirements" (e.g. "Fighter 4") is a
// much better disambiguator than source, since the same optional-rule name is
// often reused verbatim per class. Falls back to source when absent.
function variantLabel(d) {
  if (d.type === 'feat') {
    const req = d.system && d.system.requirements;
    if (req && String(req).trim()) {
      const className = String(req).trim().split(/\s+/)[0];
      if (className) return className;
    }
  }
  const src = sourceOf(d);
  return src || 'unknown source';
}

function loadFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  return lines.map((l) => JSON.parse(l));
}

function saveFile(file, docs) {
  const out = docs.map((d) => JSON.stringify(d)).join('\n') + '\n';
  fs.writeFileSync(file, out);
}

function processFile(file) {
  const base = path.basename(file, '.db');
  const docs = loadFile(file);
  const rawText = fs.readFileSync(file, 'utf8');

  const groups = new Map();
  docs.forEach((d, i) => {
    if (!d.name) return;
    if (!groups.has(d.name)) groups.set(d.name, []);
    groups.get(d.name).push({ doc: d, idx: i });
  });

  const toDelete = new Set();
  const renames = []; // {idx, oldName, newName}
  let reprintGroups = 0;
  let variantGroups = 0;
  let skippedNoSig = 0;

  for (const [name, entries] of groups) {
    if (entries.length < 2) continue;

    const sigs = entries.map((e) => signature(e.doc));
    if (sigs.some((s) => s === null)) {
      skippedNoSig++;
      console.log(`[SKIP]  ${base}: "${name}" - no comparable signature, needs manual review`);
      continue;
    }

    const allSame = sigs.every((s) => s === sigs[0]);

    if (allSame) {
      reprintGroups++;
      // keep richest, delete rest
      let keepIdx = 0;
      for (let i = 1; i < entries.length; i++) {
        if (richness(entries[i].doc) > richness(entries[keepIdx].doc)) keepIdx = i;
      }
      entries.forEach((e, i) => {
        if (i === keepIdx) return;
        const refCount = (rawText.match(new RegExp(e.doc._id, 'g')) || []).length;
        if (refCount > 1) {
          console.log(`[REFD]  ${base}: "${name}" (${e.doc._id}) is referenced elsewhere - not deleting, review by hand`);
          return;
        }
        toDelete.add(e.idx);
        console.log(`[DROP]  ${base}: "${name}" (${e.doc._id}, src="${sourceOf(e.doc)}") - identical reprint, keeping ${entries[keepIdx].doc._id}`);
      });
    } else {
      variantGroups++;
      const seen = new Map();
      entries.forEach((e) => {
        const src = variantLabel(e.doc);
        let label = src;
        const count = seen.get(src) || 0;
        seen.set(src, count + 1);
        if (count > 0) label = `${src} #${count + 1}`;
        const newName = `${name} (${label})`;
        renames.push({ idx: e.idx, oldName: name, newName, id: e.doc._id });
        console.log(`[RENAME] ${base}: "${name}" (${e.doc._id}) -> "${newName}"`);
      });
    }
  }

  console.log(`${base}: ${reprintGroups} reprint group(s), ${variantGroups} variant group(s), ${skippedNoSig} skipped\n`);

  if (!APPLY) return;

  for (const r of renames) {
    docs[r.idx].name = r.newName;
    if (docs[r.idx].token && docs[r.idx].token.name === r.oldName) {
      docs[r.idx].token.name = r.newName;
    }
  }

  const kept = docs.filter((_, i) => !toDelete.has(i));
  saveFile(file, kept);
}

const files = fs
  .readdirSync(PACKS_DIR)
  .filter((f) => f.endsWith('.db'))
  .filter((f) => !onlyPack || f === `${onlyPack}.db`)
  .map((f) => path.join(PACKS_DIR, f));

for (const file of files) processFile(file);

if (!APPLY) console.log('(dry run - pass --apply to write changes)');
