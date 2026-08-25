export default class MMJournalSheet extends dnd5e.applications.journal.JournalEntrySheet5e {
  static DEFAULT_OPTIONS = {
    classes: ["mm"]
  }

  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    const css = opts.document.getFlag("dnd-monster-manual", "cssClass");
    if (css) {
      opts.window.contentClasses.push(...css.split(" "));
    }

    return opts;
  }
}

