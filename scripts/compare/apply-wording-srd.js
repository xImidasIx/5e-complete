#!/usr/bin/env node
// Auto-applies spell description prose sourced directly from the actual SRD
// 5.2.1 PDF (compare/SRD_CC_v5.2.1.pdf, CC BY 4.0) - safe to copy verbatim,
// unlike the full retail dnd-players-handbook dump compare-wording.js diffs
// against (never licensed for reuse, hence that script never writes).
//
// Only touches names on srd-allowlist.json's `spells` list, and only when
// the block parses cleanly out of the PDF (a name line immediately followed
// by a level/school header line, e.g. "Level 3 Evocation (Wizard)" or
// "Abjuration Cantrip (Cleric, Druid)"). Anything that doesn't parse cleanly
// (multi-column bleed, embedded tables, OCR artifacts) is skipped and left
// for compare-wording.js's manual-review path.
//
// Usage:
//   node scripts/compare/apply-wording-srd.js               # dry run
//   node scripts/compare/apply-wording-srd.js --write
//   node scripts/compare/apply-wording-srd.js --write --name="Resistance"

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

const HEADER_RE = /^(Level \d|Cantrip$|[A-Z][a-z]+ Cantrip)/;
const FOOTER_NOISE_RE = /System Reference Document 5\.2\.1\s*\d*/g;
const CALLOUT_RE = /(At Higher Levels\.|Using a Higher-Level Spell Slot\.|Cantrip Upgrade\.)/g;

// Finds every "Name\nHeaderLine" boundary in the given line range and
// returns [{name, startLine, headerLine}], in document order.
function findSpellBoundaries(lines, from, to) {
  const boundaries = [];
  for (let i = from; i < to - 1; i++) {
    const name = normalizeApostrophe(lines[i].trim());
    const next = lines[i + 1];
    if (!name) continue;
    // A spell name line: starts with a capital letter, no trailing
    // punctuation that would mark it as prose, reasonably short.
    if (!/^[A-Z]/.test(name) || name.length > 60 || /[.,;:]$/.test(name)) continue;
    if (HEADER_RE.test(next)) {
      boundaries.push({ name, startLine: i });
    }
  }
  return boundaries;
}

function joinLines(rawLines) {
  let out = '';
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    if (out.endsWith('-') && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line;
    } else if (out) {
      out += (out.endsWith('.') || out.endsWith('’') || out.endsWith('"') ? ' ' : ' ') + line;
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

  // Split into paragraphs at known callout headers.
  const parts = text.split(CALLOUT_RE).filter(Boolean);
  const paragraphs = [];
  let i = 0;
  if (parts.length && !CALLOUT_RE.test(parts[0])) {
    paragraphs.push(`<p>${parts[0].trim()}</p>`);
    i = 1;
  }
  CALLOUT_RE.lastIndex = 0;
  for (; i < parts.length; i += 2) {
    const callout = parts[i];
    const rest = (parts[i + 1] || '').trim();
    if (!callout) continue;
    paragraphs.push(`<p><strong>${callout} </strong>${rest}</p>`);
  }
  return paragraphs.join('');
}

// The PDF's raw reading order sometimes glues a sidebar stat block (e.g. the
// companion creature for Find Steed) onto the END of an unrelated,
// physically-preceding spell's body, because there's no name+header
// boundary between them for the line-based scanner to catch. Detect that
// bleed by content signature rather than trust the boundary alone.
const STAT_BLOCK_LEAK_RE = /\bMOD SAVE MOD SAVE\b|\bAC \d+.*\bHP \d|\bCR (None|\d)|\bPassive Perception \d|^(Traits|Actions|Bonus Actions|Reactions|Legendary Actions)$/m;

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

  const startIdx = lines.findIndex((l) => l === 'Spell Descriptions');
  const endIdx = lines.findIndex((l, i) => i > startIdx && l === 'Rules Glossary');
  if (startIdx === -1 || endIdx === -1) {
    console.error('Could not find "Spell Descriptions" / "Rules Glossary" section boundaries in the SRD text.');
    process.exit(1);
  }

  const boundaries = findSpellBoundaries(lines, startIdx, endIdx);
  const blocks = new Map(); // name -> html
  for (let i = 0; i < boundaries.length; i++) {
    const { name, startLine } = boundaries[i];
    const nextStart = i + 1 < boundaries.length ? boundaries[i + 1].startLine : endIdx;
    // The school/level+class line and the Casting Time/Range/Components
    // fields can each wrap across more than one physical line (a long class
    // list, "Reaction, which you take when..." casting times, a costly
    // material component parenthetical) - counting a fixed number of lines
    // for the header undercounts and leaks header fragments into the body.
    // "Duration:" is always present and always the last of the 4 fields, so
    // search for it directly instead of assuming line counts.
    let durationLine = -1;
    for (let j = startLine + 1; j < Math.min(nextStart, startLine + 20); j++) {
      if (/^Duration:/.test(lines[j])) {
        durationLine = j;
        break;
      }
    }
    if (durationLine === -1) continue; // malformed block, skip entirely
    const bodyStart = durationLine + 1;
    const bodyLines = lines.slice(bodyStart, nextStart).filter(Boolean);
    if (STAT_BLOCK_LEAK_RE.test(bodyLines.join('\n'))) {
      // A sidebar stat block (e.g. Find Steed's companion) bled into this
      // block in the PDF's raw reading order - the real boundary between
      // this spell and the next couldn't be found, so don't trust any of
      // it, not even the part before the leak.
      continue;
    }
    const html = blockToHtml(bodyLines);
    if (html) blocks.set(name, html);
  }

  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  const allowedSpells = new Set(allowlist.spells || []);

  const filePath = path.join(PACKS_DIR, '5e-spells.db');
  const docLines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const docs = docLines.map((l) => JSON.parse(l));

  let applied = 0;
  let unchanged = 0;
  let notInPdf = 0;
  let alreadyMatches = 0;

  for (const doc of docs) {
    if (!allowedSpells.has(doc.name)) continue;
    if (nameFilter && doc.name !== nameFilter) continue;

    const html = blocks.get(doc.name);
    if (!html) {
      notInPdf++;
      console.log(`[NO-PARSE] ${doc.name} - not found as a clean block in the SRD PDF text`);
      continue;
    }

    const repoText = plainText(doc.system?.description?.value);
    const srdText = plainText(html);
    if (repoText === srdText) {
      alreadyMatches++;
      continue;
    }

    // A bled-in sidebar that isn't a monster stat block (so STAT_BLOCK_LEAK_RE
    // missed it) still tends to make the new text much longer than what's
    // plausible for one spell entry, or much longer than the repo's current
    // text - flag those for manual review instead of silently trusting them.
    if (srdText.length > 3500 || (repoText.length > 40 && srdText.length > repoText.length * 3)) {
      console.log(`[SUSPECT] ${doc.name} - srd text is ${srdText.length} chars vs repo's ${repoText.length}, looks like a bleed - needs manual review`);
      notInPdf++;
      continue;
    }
    // Some PDF lines lose their inter-word spaces entirely on extraction
    // (a tight-kerning/justification artifact, not a join bug) - a run of
    // 18+ letters with no space is almost never a real English word.
    const missingSpaceRun = html.replace(/<[^>]+>/g, ' ').match(/[A-Za-z]{18,}/);
    if (missingSpaceRun) {
      console.log(`[SUSPECT] ${doc.name} - PDF extraction dropped spaces ("${missingSpaceRun[0]}") - needs manual review`);
      notInPdf++;
      continue;
    }

    applied++;
    console.log(`${WRITE ? 'APPLY' : 'PLAN '} ${doc.name}`);
    if (!WRITE && nameFilter) {
      console.log(`  old html: ${doc.system?.description?.value}`);
      console.log(`  new html: ${html}`);
    } else if (!WRITE) {
      console.log(`  old: ${repoText.slice(0, 120)}${repoText.length > 120 ? '…' : ''}`);
      console.log(`  new: ${srdText.slice(0, 120)}${srdText.length > 120 ? '…' : ''}`);
    } else {
      doc.system.description.value = html;
    }
  }

  if (WRITE && applied > 0) {
    const out = docs.map((d) => JSON.stringify(d)).join('\n') + '\n';
    fs.writeFileSync(filePath, out);
    console.log(`wrote ${filePath}`);
  }

  console.log(
    `\n---\n${applied} ${WRITE ? 'updated' : 'would be updated'}, ${alreadyMatches} already match, ${notInPdf} not cleanly parseable (needs manual review).`
  );
  if (!WRITE) console.log('Dry run - pass --write to actually modify packs/5e-spells.db.');
}

main();
