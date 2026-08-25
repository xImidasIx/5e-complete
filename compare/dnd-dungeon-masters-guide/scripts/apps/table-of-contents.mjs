/**
 * Compendium that renders pages as a table of contents.
 */
class DMGTableOfContents extends dnd5e.applications.journal.TableOfContentsCompendium {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["table-of-contents", "dmg"]
    });
  }
}

/**
 * Initializes the custom Table of Contents.
 */
export default function initialize() {
  Hooks.once("setup", () => {
    // game.packs.get("dnd-dungeon-masters-guide.content").applicationClass = Compendium;
    game.packs.get("dnd-dungeon-masters-guide.content").applicationClass = DMGTableOfContents;
  });
}
