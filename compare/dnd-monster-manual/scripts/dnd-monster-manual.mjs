import MMJournalSheet from "./apps/journal-sheet.mjs";

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {

  // Adding module symbols to module namespace
  const module = game.modules.get("dnd-monster-manual");
  module.apps = {};
  module.dataModels = {};

  game.settings.register("dnd-monster-manual", "lastVersion", {
    name: "Last Version",
    hint: "The last version checked against to determine whether to show the changelog.",
    scope: "world",
    config: false,
    type: String,
    default: "1.0.0"
  })

  // Creating MM config object
  CONFIG.MM = {};

  // Register Journal Sheet
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntry, "dnd-monster-manual", MMJournalSheet, {
    types: ["base"],
    label: "Monster Manual",
    makeDefault: false

  });

  // Add pull quote font (Walter Turncoat)
  Object.assign(CONFIG.fontDefinitions, {
    Turncoat: {
      editor: true,
      fonts: [{urls: ["modules/dnd-monster-manual/fonts/walter-turncoat/WalterTurncoat-Regular.ttf"]}],
    }
  });

});

Hooks.once("ready", async () => {
  // Handle showing changelog
  const currentVersion = game.modules.get("dnd-monster-manual").version;
  const lastVersion = game.settings.get("dnd-monster-manual", "lastVersion");

  if (foundry.utils.isNewerVersion(currentVersion, lastVersion)) {
    const journal = await fromUuid("Compendium.dnd-monster-manual.content.JournalEntry.mmChangelog00000");
    const page = journal.pages.contents[journal.pages.contents.length - 1];
    journal.sheet.render(true, {pageId: page.id});

    // Only GMs can modify config=false settings
    if (game.user.isGM) {
      game.settings.set("dnd-monster-manual", "lastVersion", currentVersion)
    }
  }
});
