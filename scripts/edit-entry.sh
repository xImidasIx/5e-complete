#!/bin/bash
set -e

DB_FILE="$1"
ENTRY_ID="$2"

if [[ -z "$DB_FILE" || -z "$ENTRY_ID" ]]; then
  echo "Usage: $0 <db-file> <entry-id>"
  exit 1
fi

TEMP_HTML="temp_${ENTRY_ID}.html"

# Extract
jq -r --arg id "$ENTRY_ID" '
  select(._id == $id) | .system.description.value
' "$DB_FILE" > "$TEMP_HTML"

echo "Extracted to $TEMP_HTML - edit and press Enter to save back..."
${EDITOR:-nvim} "$TEMP_HTML"
read -p "Save changes? (y/N) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  node << 'NODESCRIPT'
const fs = require('fs');
const dbFile = process.argv[1];
const entryId = process.argv[2];
const tempFile = process.argv[3];

const newHtml = fs.readFileSync(tempFile, 'utf8');
const lines = fs.readFileSync(dbFile, 'utf8').trim().split('\n');

const updated = lines.map(line => {
  const entry = JSON.parse(line);
  if (entry._id === entryId) {
    entry.system.description.value = newHtml;
  }
  return JSON.stringify(entry);
}).join('\n') + '\n';

fs.writeFileSync(dbFile, updated);
console.log(`Updated entry ${entryId}`);
NODESCRIPT
  "$DB_FILE" "$ENTRY_ID" "$TEMP_HTML"
  rm "$TEMP_HTML"
else
  echo "Discarded changes."
  rm "$TEMP_HTML"
fi

