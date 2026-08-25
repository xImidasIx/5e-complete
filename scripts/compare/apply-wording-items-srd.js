#!/usr/bin/env node
// Auto-applies magic item description prose sourced directly from the actual
// SRD 5.2.1 PDF (compare/SRD_CC_v5.2.1.pdf, CC BY 4.0) - safe to copy
// verbatim, same license reasoning as apply-wording-srd.js (spells). This is
// the sibling script that MIGRATION-BRIEF.md's "Outstanding work" pointed at
// - the "Magic Items A-Z" section has a different layout than "Spell
// Descriptions": a type/rarity header instead of level/school, no
// consistent 4-field anchor (no "Duration:" line to search for), and many
// entries embed a random-effect table (e.g. Bag of Beans' 1d100 table,
// Staff of Power's charge-cost table) that this script deliberately does
// NOT attempt to parse into HTML - those are left for compare-wording.js's
// manual-review path instead of risking a mangled table.
//
// Only touches names on srd-allowlist.json's `items` list, and only when
// the block parses cleanly (a name line immediately followed by a
// type/rarity header line, e.g. "Wondrous Item, Rare (Requires Attunement)"
// or "Armor (Any Light, Medium, or Heavy), Very Rare") AND shows no sign of
// an embedded table. Anything else is skipped and left for
// compare-wording.js's manual-review path.
//
// Usage:
//   node scripts/compare/apply-wording-items-srd.js               # dry run
//   node scripts/compare/apply-wording-items-srd.js --write
//   node scripts/compare/apply-wording-items-srd.js --write --name="Bag of Holding"

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PACKS_DIR, ROOT } = require('./lib');

const WRITE = process.argv.includes('--write');
const nameFilter = process.argv.find((a) => a.startsWith('--name='))?.split('=')[1];

const COMPARE_DIR = path.join(ROOT, 'compare');
const PDF_PATH = path.join(COMPARE_DIR, 'SRD_CC_v5.2.1.pdf');
const RAW_CACHE = path.join(COMPARE_DIR, '.srd_raw_cache.txt');
const ALLOWLIST_PATH = path.join(__dirname, 'srd-allowlist.json');

function getRawText() {
  if (fs.existsSync(RAW_CACHE)) return fs.readFileSync(RAW_CACHE, 'utf8');
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`Missing ${PDF_PATH} - can't extract SRD text.`);
    process.exit(1);
  }
  execSync(`pdftotext -raw "${PDF_PATH}" "${RAW_CACHE}"`);
  return fs.readFileSync(RAW_CACHE, 'utf8');
}

function normalizeApostrophe(s) {
  return s.replace(/[‘’]/g, "'");
}

const FOOTER_NOISE_RE = /System Reference Document 5\.2\.1\s*\d*/g;

// Item type/rarity header lines look like "Wondrous Item, Rare (Requires
// Attunement)" or "Armor (Any Light, Medium, or Heavy), Very Rare". The
// rarity word doesn't always land on the same physical line as the category
// word - a long "(Any X, Y, or Z)" weapon/armor list can push it onto a
// second or third wrapped line (e.g. Luck Blade's "Weapon (Glaive,
// Greatsword, Longsword, Rapier,\nScimitar, Sickle, or Shortsword),
// Legendary (Requires\nAttunement)"). So header detection scans a small
// window instead of requiring both on one line.
const CATEGORY_WORDS =
  'Adventuring Gear|Ammunition|Armor|Instrument|Melee Weapon|Ranged Weapon|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous Item';
const RARITY_WORDS = 'Common|Uncommon|Rare|Very Rare|Legendary|Artifact|Varies';
// Require a comma or open-paren right after the category phrase (how every
// real header is punctuated) - a bare word-boundary isn't enough, since it
// would also match the start of an item NAME like "Ring of Regeneration".
const CATEGORY_START_RE = new RegExp(`^(${CATEGORY_WORDS})(,| \\()`);
const RARITY_RE = new RegExp(RARITY_WORDS);
// Continuation lines (the 2nd/3rd physical line of a wrapped header) are
// noun-phrase fragments, never full sentences - they start with a rarity
// word, "or", "Requires Attunement", or an open paren. Requiring this on any
// line between the category line and the rarity line is what keeps this
// from treating an ordinary sentence as a multi-line header.
const HEADER_CONTINUATION_RE = new RegExp(`^(${RARITY_WORDS}|or\\b|Requires Attunement|\\()`);

function isNameLine(line) {
  const name = normalizeApostrophe(line.trim());
  if (!name) return false;
  if (!/^[A-Z]/.test(name)) return false;
  if (name.length > 70) return false;
  if (/[.,;:]$/.test(name)) return false;
  return true;
}

// Starting at line j (expected to be a category-word line), scans up to 3
// lines for the header's rarity word, bailing if a line in between doesn't
// look like a header continuation. Returns the index of the header's last
// line, or null if no clean header is found.
function findHeaderEnd(lines, j, limit) {
  if (!CATEGORY_START_RE.test(lines[j])) return null;
  for (let k = j; k < Math.min(j + 3, limit); k++) {
    if (RARITY_RE.test(lines[k])) return k;
    if (k > j && !HEADER_CONTINUATION_RE.test(lines[k])) return null;
  }
  return null;
}

// Finds every "Name\nHeaderLine(s)" boundary (or "Name line 1\nName line 2\n
// HeaderLine(s)" for a name that wraps across two physical lines, e.g.
// "Amulet of Proof against Detection\nand Location") in the given line range.
function findItemBoundaries(lines, from, to) {
  const boundaries = [];
  let i = from;
  while (i < to - 1) {
    const l1 = lines[i];
    if (isNameLine(l1)) {
      const next = lines[i + 1];
      const headerEnd1 = findHeaderEnd(lines, i + 1, to);
      if (headerEnd1 !== null) {
        boundaries.push({ name: normalizeApostrophe(l1.trim()), startLine: i, headerEnd: headerEnd1 });
        i += 1;
        continue;
      }
      // Two-line name wrap: only trust this if `next` doesn't ALSO look
      // like a standalone name that's itself followed by a header - a
      // wrapped table row (e.g. "Wall of Force 5" from a spell-charge-cost
      // table, immediately before the next real item's name) can otherwise
      // get glued onto the real item name and swallow its boundary.
      if (i + 2 < to && !isNameLine(next) && /^[a-zA-Z(].{0,40}$/.test(next)) {
        const headerEnd2 = findHeaderEnd(lines, i + 2, to);
        if (headerEnd2 !== null) {
          boundaries.push({ name: normalizeApostrophe(`${l1.trim()} ${next.trim()}`), startLine: i, headerEnd: headerEnd2 });
          i += 2;
          continue;
        }
      }
    }
    i += 1;
  }
  return boundaries;
}

// Real-prose body sentences reference an embedded random-effect table by
// phrase ("roll on the following table", "1d100", etc.) far more reliably
// than any layout heuristic can reconstruct the table itself - so this
// script never tries to parse the table, it just declines to touch the
// item at all when one is present.
const TABLE_PHRASE_RE =
  /(following table|table below|chart below|consulting the following|percentile dice|1d100\b|1d20\b|1d12\b|1d10\b|1d8\b|1d6\b|1d4\b)/i;

// A second, independent table signature: a run of 3+ short single-word
// column-header-looking lines (e.g. a wrapped "Spell / Charge / Cost"
// header) that plain wrapped prose in this PDF doesn't produce.
function hasShortLineRun(bodyLines) {
  let run = 0;
  for (const bl of bodyLines) {
    if (bl.length <= 14 && /^[A-Z][a-zA-Z ]*$/.test(bl) && !bl.endsWith('.')) {
      run += 1;
      if (run >= 3) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function joinLines(rawLines) {
  let out = '';
  for (const line of rawLines) {
    if (out.endsWith('-') && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line;
    } else if (out) {
      out += ' ' + line;
    } else {
      out = line;
    }
  }
  return out;
}

function blockToHtml(rawLines) {
  let text = joinLines(rawLines);
  text = normalizeApostrophe(text.replace(FOOTER_NOISE_RE, ' ')).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return `<p>${text}</p>`;
}

function plainText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function main() {
  const raw = getRawText();
  const lines = raw.split('\n').map((l) => l.trim());

  const startIdx = lines.findIndex((l) => l === 'Magic Items A–Z');
  const endIdx = lines.findIndex((l, i) => i > startIdx && l === 'Monsters');
  if (startIdx === -1 || endIdx === -1) {
    console.error('Could not find "Magic Items A–Z" / "Monsters" section boundaries in the SRD text.');
    process.exit(1);
  }

  const boundaries = findItemBoundaries(lines, startIdx, endIdx);
  const blocks = new Map(); // name -> { html, hasTable }
  for (let i = 0; i < boundaries.length; i++) {
    const { name, headerEnd } = boundaries[i];
    const nextStart = i + 1 < boundaries.length ? boundaries[i + 1].startLine : endIdx;

    const bodyStart = headerEnd + 1;
    if (bodyStart >= nextStart) continue; // no body at all - malformed, skip

    const bodyLines = lines.slice(bodyStart, nextStart).filter(Boolean);
    const hasTable = TABLE_PHRASE_RE.test(bodyLines.join(' ')) || hasShortLineRun(bodyLines);
    const html = hasTable ? null : blockToHtml(bodyLines);
    blocks.set(name, { html, hasTable });
  }

  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  const allowedItems = new Set(allowlist.items || []);

  const filePath = path.join(PACKS_DIR, '5e-items.db');
  const docLines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const docs = docLines.map((l) => JSON.parse(l));

  let applied = 0;
  let alreadyMatches = 0;
  let hasTable = 0;
  let notInPdf = 0;

  for (const doc of docs) {
    if (!allowedItems.has(doc.name)) continue;
    if (nameFilter && doc.name !== nameFilter) continue;

    const block = blocks.get(doc.name);
    if (!block) {
      notInPdf++;
      console.log(`[NO-PARSE] ${doc.name} - not found as a clean block in the SRD PDF text`);
      continue;
    }
    if (block.hasTable) {
      hasTable++;
      console.log(`[TABLE] ${doc.name} - embedded random-effect table, needs manual review`);
      continue;
    }

    const repoText = plainText(doc.system?.description?.value);
    const srdText = plainText(block.html);
    if (repoText === srdText) {
      alreadyMatches++;
      continue;
    }

    // Same suspect guards as apply-wording-srd.js: an unrelated block bled
    // into this one, or the PDF dropped inter-word spaces on extraction.
    if (srdText.length > 3500 || (repoText.length > 40 && srdText.length > repoText.length * 3)) {
      console.log(`[SUSPECT] ${doc.name} - srd text is ${srdText.length} chars vs repo's ${repoText.length}, looks like a bleed - needs manual review`);
      notInPdf++;
      continue;
    }
    const missingSpaceRun = block.html.replace(/<[^>]+>/g, ' ').match(/[A-Za-z]{18,}/);
    if (missingSpaceRun) {
      console.log(`[SUSPECT] ${doc.name} - PDF extraction dropped spaces ("${missingSpaceRun[0]}") - needs manual review`);
      notInPdf++;
      continue;
    }

    applied++;
    console.log(`${WRITE ? 'APPLY' : 'PLAN '} ${doc.name}`);
    if (!WRITE && nameFilter) {
      console.log(`  old html: ${doc.system?.description?.value}`);
      console.log(`  new html: ${block.html}`);
    } else if (!WRITE) {
      console.log(`  old: ${repoText.slice(0, 120)}${repoText.length > 120 ? '…' : ''}`);
      console.log(`  new: ${srdText.slice(0, 120)}${srdText.length > 120 ? '…' : ''}`);
    } else {
      doc.system.description.value = block.html;
    }
  }

  if (WRITE && applied > 0) {
    const out = docs.map((d) => JSON.stringify(d)).join('\n') + '\n';
    fs.writeFileSync(filePath, out);
    console.log(`wrote ${filePath}`);
  }

  console.log(
    `\n---\n${applied} ${WRITE ? 'updated' : 'would be updated'}, ${alreadyMatches} already match, ` +
    `${hasTable} skipped (embedded table - manual review), ${notInPdf} not cleanly parseable (needs manual review).`
  );
  if (!WRITE) console.log('Dry run - pass --write to actually modify packs/5e-items.db.');
}

main();
