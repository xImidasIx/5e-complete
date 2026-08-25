#!/usr/bin/env node
// Diffs description prose against the official 2024 books - but ONLY for
// entries listed in srd-allowlist.json, since most of the PHB/MM/DMG dump
// is full retail text that isn't covered by the SRD's open license.
//
// This never writes into packs/*.db. It prints a unified diff to the
// terminal so you can read it and manually rewrite any entry yourself in
// your own words - copying the printed official-side text back into a pack
// file would defeat the point of gating this by the allowlist.
//
// Usage: node scripts/compare/compare-wording.js [--pack=5e-spells]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadRepoPack, buildCompareIndex, normalizeName } = require('./lib');

const ALLOWLIST_PATH = path.join(__dirname, 'srd-allowlist.json');

const REPO_PACK_TO_GROUP = {
  '5e-spells': 'spells',
  '5e-items': 'items',
  '5e-trade-goods': 'items',
  '5e-feats': 'items',
  '5e-backgrounds': 'items',
  '5e-classes': 'items',
  '5e-subclasses': 'items',
  '5e-species': 'items',
  '5e-creatures': 'actors',
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
};

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unifiedDiff(a, b) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wording-diff-'));
  const fa = path.join(tmp, 'repo.txt');
  const fb = path.join(tmp, 'official.txt');
  // One sentence per line so `diff` gives a readable per-sentence diff
  // instead of one giant changed paragraph.
  fs.writeFileSync(fa, a.replace(/(?<=[.!?])\s+/g, '\n') + '\n');
  fs.writeFileSync(fb, b.replace(/(?<=[.!?])\s+/g, '\n') + '\n');
  try {
    execFileSync('diff', ['-u', fa, fb], { encoding: 'utf8' });
    return null; // identical
  } catch (err) {
    // diff exits 1 when there are differences - that's not a failure here.
    return err.stdout || '';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function loadAllowlist() {
  const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  const set = new Set();
  for (const group of Object.keys(data)) {
    if (group === '_comment') continue;
    for (const name of data[group] || []) set.add(normalizeName(name));
  }
  return set;
}

function main() {
  const packFilter = process.argv
    .find((a) => a.startsWith('--pack='))
    ?.split('=')[1];

  const allowlist = loadAllowlist();
  if (allowlist.size === 0) {
    console.log(
      'srd-allowlist.json is empty - nothing to check.\n' +
      'See scripts/compare/README.md for how to populate it from the official SRD 5.2 document.'
    );
    return;
  }

  const targets = packFilter
    ? { [packFilter]: REPO_PACK_TO_GROUP[packFilter] }
    : REPO_PACK_TO_GROUP;

  let skippedNotAllowlisted = 0;
  let diffed = 0;
  let identical = 0;

  for (const [repoPackName, group] of Object.entries(targets)) {
    if (!group) continue;
    const repoDocs = loadRepoPack(repoPackName);
    const compareIndex = buildCompareIndex(COMPARE_GROUPS[group]);

    for (const repoDoc of repoDocs) {
      const key = normalizeName(repoDoc.name);
      const matches = compareIndex.get(key);
      if (!matches || matches.length === 0) continue;

      if (!allowlist.has(key)) {
        skippedNotAllowlisted++;
        continue;
      }

      const { moduleId, doc: officialDoc } = matches[0];
      const repoText = stripHtml(repoDoc.system?.description?.value);
      const officialText = stripHtml(officialDoc.system?.description?.value);
      const diff = unifiedDiff(repoText, officialText);

      if (diff) {
        diffed++;
        console.log(`\n=== ${repoDoc.name}  (${repoPackName} vs ${moduleId}) ===`);
        console.log(diff);
      } else {
        identical++;
      }
    }
  }

  console.log(
    `\n---\n${diffed} entries had wording differences, ${identical} identical, ` +
    `${skippedNotAllowlisted} skipped (not in srd-allowlist.json).`
  );
  console.log(
    'Reminder: rewrite flagged entries in your own words - do not paste the ' +
    '"official" side of the diff back into packs/*.db.'
  );
}

main();
