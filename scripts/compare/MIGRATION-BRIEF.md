# 2024 SRD migration - handoff brief

Branch: `fix/2024-pack-migration`. This doc is the full context for
continuing that work in a fresh session - goal, tools, what's been done,
what's left. `scripts/` is gitignored, so nothing in this directory is
committed; this file only exists on disk for whoever picks the work up
next.

## Goal

Three things, in order:

1. **Dedup** - some packs had multiple docs with the same `name`. Done -
   see "What's been done" below.
2. **2014 -> 2024 renames** - WotC renamed a bunch of spells/items/
   monsters/class features/subclasses going from SRD 5.1 to SRD 5.2.1.
   Done.
3. **Rules/attribute rewrite** - beyond naming, the actual mechanics
   (damage, save DC, range, AC, price, etc.) and prose descriptions for
   2024-era content need to match SRD 5.2.1, not the 2014 SRD or full
   retail 2014 books. Mechanics: mostly done. Wording: spells done,
   magic items not started.

## Source material (compare/, gitignored, not in git)

- `compare/SRD_CC_v5.2.1.pdf` - the actual SRD 5.2.1 document (CC BY 4.0).
  License boundary: only names confirmed present in this PDF are safe to
  prose-diff/reuse content from. **This PDF's text is the one safe source
  to copy prose from verbatim** - see "Wording" below, this is the key
  insight from this session.
- `compare/converting-to-srd-5.2.1.pdf` - WotC's official delta guide,
  "what changed going from SRD 5.1 to SRD 5.2.1." Source for all renames.
  This is a *rules* delta doc - it has nothing to do with the Foundry
  `dnd5e` module's internal JSON schema (do not go looking in it for
  schema/data-model answers, e.g. why a weapon's damage is split across
  `system.damage.base` and `system.activities`).
- `compare/dnd-players-handbook/`, `compare/dnd-monster-manual/`,
  `compare/dnd-dungeon-masters-guide/` - full retail 2024 book dumps
  (LevelDB packs), used only for **mechanics** diffing (stats aren't
  protected expression) via `extract-compare-packs.sh` + `.compare-cache/`
  (populated, at repo root, not under `scripts/`). Never diff/copy prose
  against these directly - not licensed for reuse, even for a name that's
  also in the SRD (see compare-wording.js's README section for why).

If the PDFs need re-reading as plain text:
```
pdftotext -raw compare/SRD_CC_v5.2.1.pdf compare/srd_raw.txt
pdftotext -raw compare/converting-to-srd-5.2.1.pdf compare/convert_raw.txt
```
Use `-raw`, not `-layout` - this SRD's two-column layout badly interleaves
text under `-layout`; `-raw` preserves correct reading order *mostly* (see
"PDF extraction gotchas" below for the exceptions that matter).
`apply-wording-srd.js` also caches its own extraction at
`compare/.srd_raw_cache.txt` - delete it to force a re-extract if the PDF
changes.

## Tools in scripts/compare/

- **`compare-mechanics.js [--pack=X]`** - diffs stats only (level, school,
  range, damage, save DC, AC, price, weight) between this repo's packs and
  the compare/ book dumps. Read-only, prints a report.
- **`apply-mechanics.js [--pack=X] [--write]`** - auto-applies the safe
  subset of what compare-mechanics.js finds (school, range, duration,
  damage dice+type, utility formula). Dry run by default. As of this
  session it also disambiguates multi-activity spells/items using this
  repo's own `actionType`/`save.ability` instead of blanket-skipping them,
  with several correctness guards added after real bugs were found live
  (see "What's been done" - read this before trusting the script blindly
  on a pack it hasn't been run against yet).
- **`compare-wording.js [--pack=X]`** - diffs description prose against
  the **retail** book dumps, gated by `srd-allowlist.json`. Never writes -
  prints a unified diff for hand rewriting. Still useful for magic items
  (not yet auto-applied) and for the handful of spells apply-wording-srd.js
  couldn't parse.
- **`apply-wording-srd.js [--write] [--name="X"]`** - auto-applies spell
  description prose sourced directly from the actual SRD PDF text
  (license-safe, unlike compare-wording.js's retail-dump diff).
- **`apply-wording-items-srd.js [--write] [--name="X"]`** - NEW the
  follow-up session. Same idea as `apply-wording-srd.js` but for the
  SRD's "Magic Items A-Z" section - different header shape (type/rarity,
  can wrap up to 3 lines) and it explicitly refuses to touch any item with
  an embedded random-effect table (detected by table-phrase language or a
  run of short column-header-looking lines), leaving those for manual
  review instead of risking a mangled table. See "What's been done in the
  follow-up session" for the two boundary-detection bugs found and fixed
  before trusting its output.
- **`review-ambiguous-mechanics.js [--pack=X] [--name="X"]`** - NEW the
  follow-up session. Read-only companion to `apply-mechanics.js` - reuses
  its exact `computeApplyPatch()` so the two can never disagree, and
  expands every skip into a side-by-side view (repo's current value next
  to each candidate official activity, labeled by the book's own activity
  `name` when it has one) so a human can resolve an ambiguous entry without
  digging through raw JSON or the PDF by hand.
- **`srd-allowlist.json`** - 321 spells / 201 items / 282 actors confirmed
  present in the actual SRD 5.2.1 PDF. Re-derive if pack names change
  significantly (see README.md for the extraction method); shouldn't need
  it for the current name set.
- **`check-2024-renames.js`** / **`apply-2024-renames.js`** /
  **`srd-2024-renames.json`** - renames, done, 0 stale names as of this
  session. `apply-2024-renames.js` is safe to re-run any time (no-ops on
  already-renamed docs).
- **`dedupe-names.js [--pack=X] [--apply]`** - NEW this session, not
  written by a prior one. Dedupes same-name docs: identical reprints get
  the richer copy kept (bigger serialized doc / longer biography as a
  proxy for "has curated flavor + derived fields"), genuine variants
  (different CR/HP under one name) get renamed to disambiguate using
  source or (for class features) the `requirements` field. Already run
  against `5e-creatures` and `5e-class-features` - 0 dup names remain in
  either. Reusable if new dupes show up elsewhere.
- **`extract-compare-packs.sh`** - one-time unpack of the LevelDB book
  dumps into `.compare-cache/`. Already run, cache is populated.

## What's been done this session

Starting point: a prior session had left this MIGRATION-BRIEF.md as its
own handoff, with renames applied to some packs, 49 duplicate-name groups
unresolved, 3 omitted monsters (Duergar/Lizardfolk/Orc) not yet replaced,
and a merge case (Stillness of Mind + Purity of Body) not yet done. All of
that is now closed out:

1. **Merge**: `Stillness of Mind` + `Purity of Body` -> single
   `Self-Restoration` feature in `5e-class-features.db` (kept the
   `Purity of Body` doc's `_id`, renamed+rewrote it, deleted the
   `Stillness of Mind` doc, fixed both the `5e-classes.db` advancement
   config - removed the stale level-7 `ItemGrant` - and the level-10
   grant's description-table UUID label).
2. **Omitted monsters**: `Duergar`, `Lizardfolk`, `Orc` (x2, one was
   itself a duplicate) deleted from `5e-creatures.db` after confirming no
   cross-references - `Spy`/`Scout`/`Tough` (the WotC-recommended
   replacements) already existed as full stat blocks in the pack, so no
   new content needed, just removal of the no-longer-SRD-legal named
   entries.
3. **Dedup**: built `dedupe-names.js` (see above), ran it on
   `5e-creatures.db` (49 -> 0 dup groups: 26 collapsed as identical
   reprints, 23 renamed as genuine variants e.g. `Expert (SDW)` /
   `Beast of the Land (TCE)` / `Beast of the Land (TCE #2)`) and
   `5e-class-features.db` (5 -> 0, renamed via the `requirements` field,
   e.g. `Martial Versatility (Optional) (Fighter)`). One doc
   (`Swarm of Wasps`) was cross-referenced from a Kobold Inventor's item
   description - fixed the UUID reference by hand before deleting the
   duplicate.
4. **module.json**: verified clean - already fully committed
   (`516fb38`), all 16 packs listed match disk 1:1, no missing/orphaned/
   duplicate entries, `name`/`path` pairs consistent. Nothing to do here.
5. **Mechanics** (`apply-mechanics.js`):
   - Found and fixed a real bug in the pre-existing script: `setPath`
     dropped the `system.` prefix from the patch path but then wrote to
     the top-level doc instead of `doc.system`, silently injecting bogus
     top-level keys (`school`/`range`/`duration`/`damage`/`formula`) into
     204 docs across 6 files instead of fixing the real field. Caught it
     by noticing a dry run still reported the same "would apply" diffs
     after a `--write` run. Fixed `setPath`, stripped the injected keys
     (didn't touch `5e-tables.db`'s legitimate top-level `formula` field
     on RollTable docs - false positive, not from this bug), re-ran
     clean. **If you ever see an unfamiliar top-level key on a Document in
     these packs, this is why - should be fully cleaned up now, but worth
     knowing the failure mode.**
   - Extended the script to resolve multi-activity ambiguity instead of
     always skipping: agreement between all activities, or a match via
     this repo's own `actionType`/`save.ability` against the official
     activity's `type`/`save.ability`. Went from 104 skips down to 45.
   - Along the way found and guarded against three more real corruption
     risks (all now handled, not just noted):
     - A damage part with multiple `types` entries (e.g. Fire Shield's
       fire-or-cold choice) was silently collapsing to `types[0]` -
       now skipped for manual review instead.
     - The dnd-players-handbook dump sometimes leaves a damage part's
       `type` untagged (empty string) even when the repo already has a
       real type - was about to blank out correct data (e.g. Otiluke's
       Freezing Sphere's "cold" -> ""). Guarded.
     - Weapon items where the repo's legacy `damage.parts` combines base
       weapon damage (formula has `@mod`, e.g. Oathbow's "1d8 + @mod
       piercing") with a bonus magical effect - the 2024 schema stores
       base weapon damage separately in `system.damage.base`, not in any
       activity, so the matched official activity is always the bonus
       effect only. Was about to overwrite the base weapon damage with
       the bonus effect's formula (e.g. Mace of Disruption's base
       "1d6 + @mod bludgeoning" -> "nulld0+0 radiant"). Guarded: any repo
       part with `@mod` won't be overwritten by an official formula that
       lacks `@mod`.
     - Also guarded against shrinking the part count when repo already
       has multiple damage parts and there are multiple official
       activities to choose from (e.g. Vitriolic Sphere's initial+DoT
       damage) - needs a human to map which activity is which, not an
       auto-narrow.
   - Applied: 265 total safe fixes now live (204 original + 61 newly
     recovered). 45 entries remain genuinely ambiguous - printed with
     reasons by a plain `node scripts/compare/apply-mechanics.js` (no
     flags) run.
6. **Wording** (`apply-wording-srd.js`, new script):
   - Realized `compare-wording.js` never writes because it diffs against
     the unlicensed retail dump - but the actual SRD PDF text is CC BY
     4.0 and safe to copy verbatim. Built an extractor straight from
     `compare/SRD_CC_v5.2.1.pdf`'s "Spell Descriptions" section.
   - Found and fixed several PDF-extraction correctness bugs before
     trusting any output (see "PDF extraction gotchas" below - important
     if extending this to magic items or monsters).
   - Applied to `5e-spells.db`: 313 of 321 allowlisted spells updated,
     verified idempotent (0 remaining on re-run) and valid JSON. 7 left
     for manual review: 3 hit the sidebar-bleed guard (`Fireball`,
     `Giant Insect`, `Antipathy/Sympathy`), 4 hit the dropped-space guard
     (`Wish`, `True Polymorph`, `Water Walk`, `Teleport`).

### PDF extraction gotchas (read before extending to items/monsters)

`pdftotext -raw` on this PDF is NOT perfectly linear. Two real defects
were found and are now guarded against in `apply-wording-srd.js` - keep
both guards (or equivalents) if you build an extractor for another
section:

1. **Sidebar bleed**: a stat-block sidebar (e.g. Find Steed's
   "Otherworldly Steed" companion block) can appear in the raw text
   *after* an unrelated, physically-preceding entry, with no name+header
   line between them for a boundary scanner to catch - it silently glues
   onto the end of the wrong entry. Caught via `STAT_BLOCK_LEAK_RE`
   (looks for monster-stat-block signatures: `MOD SAVE`, `AC \d.*HP \d`,
   `CR (None|\d)`, `Passive Perception`, bare `Traits`/`Actions`/etc.
   headers) plus a length-outlier check (srd text > 3500 chars, or > 3x
   the repo's current text length). Any hit -> block discarded entirely,
   not partially trusted.
2. **Dropped inter-word spaces**: some lines lose spaces entirely on
   extraction (e.g. "Youreplaceoneofyourfeatswith") - a kerning/
   justification artifact, not a bug in the join logic. Caught via a
   regex for any 18+ character run with no space.
3. **Multi-line headers**: the school/level+class-list line and the
   Casting Time/Range/Components fields can each wrap across more than
   one physical line (long class lists, "Reaction, which you take
   when..." casting times, costly-material parentheticals). Counting a
   fixed number of header lines undercounts and leaks header fragments
   into the body. Fixed by searching for the `Duration:` line directly
   (always present, always last of the 4 fields) instead of counting -
   body starts right after it, regardless of how many lines came before.

None of this is exhaustive - it's what surfaced from spot-checking ~20
spells across the alphabet plus the ones that failed the automated
guards. If you extend this to magic items or monsters, re-derive these
guards for that section's structure (items have embedded random-effect
tables, e.g. Bag of Beans' 1d100 table - likely need a table-detection
guard too) and spot-check broadly before trusting a `--write` run.

## What's been done in the follow-up session

Picked up both top items from "Outstanding work" below (as it stood at the
end of the prior session):

7. **Wording for magic items**: built `apply-wording-items-srd.js`, the
   sibling script the prior session's brief called for. Parses the SRD's
   "Magic Items A-Z" section (name line -> type/rarity header, which -
   unlike spells - can wrap across up to 3 physical lines before the
   rarity word appears, e.g. Luck Blade's weapon-list header). Two boundary
   bugs were found and fixed before trusting any output: (1) a plain
   category-word prefix like "Armor" or "Ring" false-matched prose that
   happened to start the same way ("Armor Class if...", "Ring of
   Regeneration" as if it were a header) - fixed by requiring a comma or
   open-paren immediately after the category phrase, the way every real
   header is actually punctuated; (2) the two-line item-name-wrap fallback
   (for names like "Amulet of Proof against Detection\nand Location") could
   glue an embedded table's trailing row onto the next real item name and
   skip its boundary entirely - fixed by only attempting the merge when the
   second candidate line isn't itself independently a valid, header-followed
   name. Embedded random-effect tables (e.g. Bag of Beans' 1d100 table,
   Staff of Power's charge-cost table) are deliberately never parsed into
   HTML - detected via table-phrase language ("the following table", a
   literal "1dNN", etc.) or a run of short single-word lines (a wrapped
   column-header row), and skipped for manual review rather than risking a
   mangled table. Applied to `5e-items.db`: 148 of 201 allowlisted items
   updated, verified idempotent and valid JSON. 52 skipped for an embedded
   table, 1 (`Rope of Entanglement`) flagged as a suspect bleed (its real
   SRD text is just genuinely ~3.5x longer than the repo's existing text,
   which is legitimate here but the guard can't tell that from a bleed, so
   it's left for a human to eyeball).
8. **45 ambiguous mechanics entries**: built
   `review-ambiguous-mechanics.js`, a read-only companion to
   `apply-mechanics.js` that reuses its exact `computeApplyPatch()` (so the
   two can never disagree about what's ambiguous) and expands every skip
   into a side-by-side view - repo's current value next to each candidate
   official activity, labeled by the book's own activity `name` when it has
   one (e.g. Vitriolic Sphere's "End of Turn Damage"). Also fixed a real
   bug in `apply-mechanics.js` itself: when a doc had *both* an ambiguous
   damage field *and* an unrelated safe field (school/range/duration), the
   whole patch was discarded on the ambiguity skip - 2 spells
   (`Dragon's Breath`, `Glyph of Warding`) had a correct duration fix
   sitting right there, silently dropped every run. Now applies the safe
   fields and still reports the skip for the rest. Used the new script to
   work through all 45:
   - **2 real drifts fixed**: `Weird`'s stored damage was the 2014 SRD's
     `4d10 psychic` - 2024 SRD 5.2.1 buffed the initial save to `10d10`
     (with a separate `5d10` recurring end-of-turn save that isn't
     representable in the legacy single-damage-part field, left
     unmodeled like every other multi-trigger spell below). `Meld into
     Stone` had `6d6 bludgeoning`, but that spell deals no damage from
     casting it at all - the `6d6` is Force damage to the caster if the
     stone housing them is partially destroyed (SRD p.14069); repo already
     had this right in spirit (the `50` flat-Force "total destruction"
     value was already sitting in the `versatile` field) except the damage
     *type* was wrong. Fixed to `force`.
   - **9 entries confirmed already correct, script just can't verify
     multi-part agreement automatically**: `Ice Knife`, `Hunger of Hadar`,
     `Toll the Dead`, `Melf's Acid Arrow`, `Lightning Arrow`,
     `Vitriolic Sphere`, `Wall of Ice`, `Wall of Thorns`, `Tsunami` - each
     repo value matches its corresponding official activity exactly once
     hand-compared; the ambiguity was only that the repo's damage-parts
     array has no order/count guarantee the script can trust blindly.
   - **6 items + 1 spell confirmed as legacy-schema content gaps, not
     errors**: `Staff of Power`, `Staff of the Magi`,
     `Staff of Thunder and Lightning`, `Rod of Lordly Might`,
     `Dwarven Thrower` (repo's one damage part is each item's base weapon
     attack - correct; the official "disagreeing activities" are separate
     triggered special-power buttons that the legacy single-`damage.parts`
     field has nowhere to hold, not a competing value for the same field),
     `Helm of Brilliance` (0 damage parts - same reason, its two named
     powers aren't modeled at all), `Alter Self` (0 damage parts - its
     three natural-weapon options, claws/fangs/hooves, are three different
     attack profiles the legacy schema can't hold in one field either).
     Adding these would be new content work, not a mechanics-parity fix -
     out of scope here.
   - **3 confirmed correct via their own description text**: `Overchannel`
     (repo's two-part `2d12`/`+1d12` approximates the official dynamic
     "first use free, then scales per use" formula as well as the legacy
     schema allows), `Elemental Affinity` (repo's untyped `@mod`-only part
     matches the feature's actual text - it adds Charisma mod to an
     *existing* damage roll, it doesn't roll new dice), `Divine Fury`
     (untyped, because the necrotic-vs-radiant choice is genuinely
     player/alignment-dependent - same reasoning as the 23 below).
   - **23 "player-choice damage type" skips** (`Fire Shield`,
     `Sneak Attack`, `Great Weapon Master`, `Breath Weapon`, etc.) are not
     data errors - the legacy schema's damage part is a single
     `[formula, type]` tuple and structurally can't hold "one of several"
     the way the 2024 Activities schema's `types` array can. Spot-checked
     several against the repo's own description text; the stored single
     type is a reasonable default in each case. Nothing to fix without a
     schema change.
   - **1 "2 compare/ sources disagree"**: `Reliquary` - not a real
     conflict, a name collision. The repo's `Reliquary` is unrelated custom
     content (a homebrew "deity imbues the bearer" artifact); the two
     `compare/` hits are WotC's own unrelated same-named entries (a PHB
     Holy Symbol variant and a DMG level-13 Bastion facility). Confirmed by
     reading all three descriptions - nothing to reconcile.

## What's been done in the third session

Picked up items 2 and 3 from "Outstanding work" below (as it stood at the end
of the follow-up session):

9. **7 stuck spells fixed by hand**: `Fireball`, `Giant Insect`,
   `Antipathy/Sympathy` (sidebar-bleed cases) and `Wish`, `True Polymorph`,
   `Water Walk`, `Teleport` (dropped-space cases). Built a column-aware
   reconstruction of the PDF (`pdftotext -layout`, split each physical line
   at its left/right-column boundary and re-flow left-column-then-right-
   column per page) which recovers correct spacing and mostly-correct
   reading order that `-raw` can't give you - this fixed Fireball and Wish
   outright. The rest still needed hand verification against the `-raw`
   dump (real text, just interleaved) because the column reconstruction has
   its own failure mode: an imprecise per-page split column can slice a
   stray character or two off the *other* column's text and glue it onto
   the wrong line (e.g. a lone `G` or `I` bleeding into Antipathy/Sympathy's
   text from a neighboring spell's sidebar) - always spot-check reconstructed
   text against `-raw` before trusting it verbatim. Teleport additionally
   needed its embedded "Teleportation Outcome" table hand-built as HTML
   (same shape as the magic-item table problem in item 1 below). All 7
   applied directly to `5e-spells.db`, verified valid JSON and idempotent
   with the existing 313 already done.
10. **1 background / 1 class / 1 subclass wording drift - turned out to be
    two different situations, not one**:
    - **Class (`Druid`) and subclass (`Assassin`)**: genuinely just stale
      2014 flavor prose sitting on top of already-correct 2024 mechanics
      (Hit Points/Proficiencies/Equipment/Advancement table for Druid,
      feature-level table for Assassin were already right - "mechanics
      mostly done" from session one held up here). `compare-wording.js`'s
      retail-dump extraction came back empty for both, and the tool
      explicitly warns not to paste retail prose back in anyway, so the
      flavor sections (`<h1>The Druid</h1>` onward; Assassin's intro
      paragraph) were rewritten in original wording preserving the same
      beats, not copied from any book. Applied to `5e-classes.db` and
      `5e-subclasses.db`, verified valid JSON, no docs lost.
    - **Background (`Noble`)**: NOT just a wording fix - opened up a bigger
      finding. All 9 docs in `5e-backgrounds.db` (`Urban Bounty Hunter`,
      `Sailor`, `Guild Artisan`, `Folk Hero`, `Noble`, `Outlander`,
      `Entertainer`, `Acolyte`, `Sage`) have zero `system.advancement`
      entries and are still full 2014-style background text (skill/tool/
      language lines, no Origin Feat grant, no fixed ability-score array,
      no equipment-choice-A-or-B structure) - none of them have been
      touched by the 2024 migration at all. `Noble` only got flagged by
      `compare-wording.js` because it happens to share a name with one of
      the 16 real 2024 PHB backgrounds in the retail dump; the other 8
      weren't compared at all, not because they're fine.
      Checked what actually exists on each side:
      - **SRD 5.2.1 (CC, safe to use)**: only 4 backgrounds total -
        `Acolyte`, `Criminal`, `Sage`, `Soldier` - each just a few lines
        (Ability Scores / Feat / Skill Proficiencies / Tool Proficiency /
        Equipment, no narrative prose at all for these in the free SRD).
      - **Retail `dnd-players-handbook` dump**: the full 2024 set of 16 -
        `Acolyte`, `Artisan`, `Charlatan`, `Criminal`, `Entertainer`,
        `Farmer`, `Guard`, `Guide`, `Hermit`, `Merchant`, `Noble`, `Sage`,
        `Sailor`, `Scribe`, `Soldier`, `Wayfarer`.
      - Mapping the repo's 9 against that 16: `Sailor`, `Noble`,
        `Entertainer`, `Acolyte`, `Sage` are still current names; `Guild
        Artisan` is the old name for what 2024 calls `Artisan`; `Urban
        Bounty Hunter`, `Folk Hero`, and `Outlander` have **no 2024
        equivalent at all** - they were dropped/consolidated, not renamed.
      Given that, touching `Noble` alone (adding 2024 mechanical structure
      it needs - ability scores, Origin Feat, equipment choice - while its
      8 siblings stay 2014-style, three of them for backgrounds that no
      longer exist) would be inconsistent and is really its own project,
      not a wording tweak. **Left untouched this session** - see
      "Outstanding work" item 3 below for what a real fix looks like.

## Outstanding work

1. **Wording for magic items with an embedded table** (52 items skipped by
   `apply-wording-items-srd.js`, e.g. `Bag of Beans`, `Wand of Wonder`,
   `Staff of Power`) plus 1 suspect bleed (`Rope of Entanglement` - likely a
   false positive, its SRD text is just long, but confirm against the PDF
   by hand before trusting it). The SRD's random-effect tables (1d100
   effect tables, charge-cost tables) have no HTML table representation to
   auto-generate into safely - each needs a human to read the table in the
   PDF and hand-format it into the description. (Teleport's own embedded
   table got hand-built as part of item 2 in this session - same
   technique applies here: `<table border="1"><tbody>...` matching the
   style already used elsewhere in the packs.)
2. ~~7 spells wording couldn't auto-apply~~ - done, see "third session" above.
3. **`5e-backgrounds.db` needs a real 2024 structural pass, not just
   wording** - all 9 docs are pre-2024 (see "third session" above for the
   full breakdown). A real fix means, per background kept: a fixed
   ability-score array, an Origin Feat `ItemGrant` advancement, 2 skill
   proficiencies, 1 tool proficiency, and an equipment-choice-A-or-B
   structure - modeled on how `5e-classes.db`/`5e-subclasses.db` already
   use `system.advancement` for their features. Decisions needed before
   starting (product calls, not technical ones): keep `Urban Bounty
   Hunter`/`Folk Hero`/`Outlander` as legacy/homebrew content for
   backward compatibility with existing characters, or drop them since
   2024 has no equivalent; rename `Guild Artisan` -> `Artisan` or keep the
   old name; whether to add the 7 new-in-2024 backgrounds this repo has
   never had (`Charlatan`, `Farmer`, `Guard`, `Guide`, `Hermit`,
   `Merchant`, `Scribe`, `Wayfarer`).
4. Once wording is fully done, this is a good point to re-run
   `compare-mechanics.js` and `check-2024-renames.js` one more time as a
   final sanity pass before considering the branch ready to merge.
