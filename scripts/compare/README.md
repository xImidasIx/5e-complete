# compare/ tooling

Compares this module's packs against the official 2024 PHB/MM/DMG dumps
extracted into `compare/` (gitignored - full retail book content, not SRD).

## Two different scripts, two different risk levels

**`compare-mechanics.js`** - diffs stats only (level, school, range, damage,
save DC, AC, price, weight, etc.), skips all prose. Game mechanics/stats
are not protected expression, so this is safe to run against the *entire*
book dump regardless of SRD status, and safe to read/act on freely.

```
node scripts/compare/extract-compare-packs.sh   # one-time, unpacks LevelDB packs to .compare-cache/
node scripts/compare/compare-mechanics.js
node scripts/compare/compare-mechanics.js --pack=5e-spells
```

**`compare-wording.js`** - diffs description prose. This is only run for
names listed in `srd-allowlist.json`. It never writes into `packs/*.db` -
it prints a unified diff so you can read the phrasing difference and
rewrite the entry yourself, in your own words.

```
node scripts/compare/compare-wording.js
node scripts/compare/compare-wording.js --pack=5e-spells
```

## Why there's no way to fully automate the SRD boundary

The PHB/MM/DMG dumps in `compare/` are the full retail books - nothing in
that data marks an entry as "this one's in the SRD." The SRD/non-SRD split
only exists in WotC's actual SRD 5.2 document (released under CC BY 4.0),
and it's a curated subset: most spells are in it, but most magic items,
most monster stat blocks, all class-feature flavor text, and all lore/
setting text are not. A script can't infer that distinction from the book
data itself - there's no field to key off.

So `srd-allowlist.json` has to be populated by hand, by cross-referencing
against the actual SRD 5.2 document (WotC publishes it as a free PDF/CC
content - get it from an official source, not from the `compare/` dump).
For each name you've confirmed is genuinely in the SRD, add it under the
matching group (`spells`, `items`, `actors`) in `srd-allowlist.json`. Only
those names get a wording diff; everything else is skipped by design, even
if the name matches.

If you never populate the allowlist, `compare-wording.js` just tells you
so and exits - `compare-mechanics.js` doesn't need it and works immediately.

## Pre-2024 (SRD 5.1) naming check

**`check-2024-renames.js`** - flags pack entries still using a name WotC
retired in SRD 5.2.1 (e.g. a spell still called "Feeblemind" instead of
"Befuddlement", or a monster still called "Bugbear" instead of "Bugbear
Warrior"). The old->new map lives in `srd-2024-renames.json`, transcribed
from WotC's "Converting to SRD 5.2.1" guide (get it from an official
source, same as the SRD document itself).

```
node scripts/compare/check-2024-renames.js
```

It only flags names, not content - renaming an entry is still a manual
edit, and you should check for anything else that references the old name
(e.g. a background or monster description that name-drops it).
