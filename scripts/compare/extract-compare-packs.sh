#!/bin/bash
# Unpacks the LevelDB compendium packs under compare/*/packs/* (extracted from
# the official Foundry module dumps) into flat JSON files under
# .compare-cache/<module>/<pack>/*.json, so compare-mechanics.js and
# compare-wording.js can read them without a live Foundry install.
#
# compare/ and .compare-cache/ hold full copyrighted book content - both are
# gitignored. This script never writes into packs/ (this repo's own data).
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPARE_DIR="$ROOT/compare"
CACHE_DIR="$ROOT/.compare-cache"

if [[ ! -d "$COMPARE_DIR" ]]; then
  echo "No compare/ directory found at $COMPARE_DIR - nothing to extract."
  exit 0
fi

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

for module_dir in "$COMPARE_DIR"/*/; do
  module_id="$(basename "$module_dir")"
  packs_dir="${module_dir}packs"
  [[ -d "$packs_dir" ]] || continue

  # Point foundryvtt-cli at a scratch data dir shaped like Data/modules/<id>/packs/
  # so relative pack names resolve correctly (it always joins onto that path).
  FVTT_DATA="$SCRATCH/$module_id/data"
  mkdir -p "$FVTT_DATA/Data/modules"
  ln -sf "$module_dir" "$FVTT_DATA/Data/modules/$module_id"
  cat > "$SCRATCH/$module_id.yml" <<EOF
dataPath: $FVTT_DATA/
currentPackageId: $module_id
currentPackageType: Module
EOF

  for pack_path in "$packs_dir"/*; do
    pack_name="$(basename "$pack_path")"
    pack_name="${pack_name%.db}"

    if [[ -f "$pack_path" ]]; then
      # Already a flat NeDB file (e.g. dnd-monster-manual's legacy-format packs) -
      # nothing to unpack, compare scripts read these directly.
      continue
    fi
    [[ -d "$pack_path" ]] || continue

    out_dir="$CACHE_DIR/$module_id/$pack_name"
    echo "Unpacking $module_id/$pack_name..."
    rm -rf "$out_dir"
    mkdir -p "$out_dir"
    npx --yes @foundryvtt/foundryvtt-cli package unpack "$pack_name" \
      --config "$SCRATCH/$module_id.yml" --out "$out_dir" \
      || echo "  (failed to unpack $module_id/$pack_name, skipping)"
  done
done

echo "Done. Extracted JSON cached under $CACHE_DIR"
