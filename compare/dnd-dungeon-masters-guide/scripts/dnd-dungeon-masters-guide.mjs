import initTableOfContents from "./apps/table-of-contents.mjs";
import DMGJournalSheet from "./apps/journal-sheet.mjs";
import {initializeSRDRedirects, initializeMMRedirects} from "./redirects.mjs";

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {

  // Adding module symbols to module namespace
  const module = game.modules.get("dnd-dungeon-masters-guide");
  module.apps = {};
  module.dataModels = {};

  game.settings.register("dnd-dungeon-masters-guide", "lastVersion", {
    name: "Last Version",
    hint: "The last version checked against to determine whether to show the changelog.",
    scope: "world",
    config: false,
    type: String,
    default: "1.0.0"
  })

  // Creating DMG config object
  CONFIG.DMG = {};

  // Register Journal Sheet
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    JournalEntry,
    "dnd-dungeon-masters-guide",
    DMGJournalSheet,
    {
      types: ["base"],
      label: "Dungeon Master's Guide",
      makeDefault: false
    }
  );

  if ( game.modules.get("dnd-monster-manual")?.active ) initializeMMRedirects();
  else initializeSRDRedirects();

  initTableOfContents();
});

Hooks.once("init", () => {

});

Hooks.once("ready", async () => {
  // Handle showing changelog
  const currentVersion = game.modules.get("dnd-dungeon-masters-guide").version;
  const lastVersion = game.settings.get("dnd-dungeon-masters-guide", "lastVersion");

  if (foundry.utils.isNewerVersion(currentVersion, lastVersion)) {
    const journal = await fromUuid("Compendium.dnd-dungeon-masters-guide.content.JournalEntry.dmgChangelog0000");
    const page = journal.pages.contents[journal.pages.contents.length - 1];
    journal.sheet.render(true, {pageId: page.id});
    game.settings.set("dnd-dungeon-masters-guide", "lastVersion", currentVersion)
  }
});

Hooks.on("createScene", async (scene) => {
  if ( scene._stats.compendiumSource?.includes("dnd-dungeon-masters-guide") ) {
    for (const region of scene.collections.regions) {
      for (const behavior of region.behaviors) {
          if ( behavior.type !== "teleportToken" ) continue;
          const split = behavior.system.destination.split(".");
          split[1] = scene.id;
          await behavior.update({"system.destination": split.join(".")});
      }
    }
  }
})
