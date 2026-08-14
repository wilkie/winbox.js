'use strict';

/**
 * Reading and writing initialisation files.
 *
 * Nearly everything Windows knows about itself is in one of these. `WIN.INI`
 * holds the locale -- which is how Clock learns that noon is "PM" -- the
 * installed fonts, the printer ports and the desktop; `SYSTEM.INI` holds the
 * drivers. A program's own settings live in its own file. The profile calls
 * are how all of it is read, which makes them load-bearing far out of
 * proportion to how simple they look.
 *
 * The format is less obvious than it appears, and the parts that are not
 * obvious are the parts programs depend on: a lookup is case-insensitive on
 * both the section and the entry, the whitespace around an entry's value is
 * not part of the value, and a value wrapped in matching quotes has them
 * removed -- which is the only way to have a value whose whitespace *is*
 * significant.
 *
 * This works on the file's text rather than on the file, so it can be tested
 * without a disk and so the same parse serves a read and a write.
 */
export class Profile {
  declare _text: string;

  /**
   * @param {string} text - The contents of the file.
   */
  constructor(text = '') {
    this._text = text;
  }

  get text() {
    return this._text;
  }

  /**
   * Whether a line opens a section, and which.
   *
   * The name is whatever sits between the brackets, with the surrounding
   * whitespace dropped. Windows does not require the bracket to be the first
   * thing on the line.
   */
  static sectionOf(line) {
    const match = /^\s*\[([^\]]*)\]/.exec(line);

    return match ? match[1].trim() : null;
  }

  /**
   * Splits a line into its entry and its value.
   *
   * The first `=` divides them; a later one belongs to the value, because a
   * value is allowed to contain anything at all.
   */
  static entryOf(line) {
    /* A line whose first non-space character is a semicolon is a comment. A
     * semicolon anywhere else is an ordinary character: `sList=;` is a real
     * entry in a real `WIN.INI` and its value is a semicolon.
     */
    if (/^\s*;/.test(line) || /^\s*\[/.test(line)) {
      return null;
    }

    const at = line.indexOf('=');

    if (at < 0) {
      return null;
    }

    const value = line.substring(at + 1).trim();

    return {
      entry: line.substring(0, at).trim(),

      /* Both forms, because the two are needed in different places: reading a
       * value as a string removes a pair of quotes, and reading the same value
       * as a number does not. `"7"` is the string `7` and the number zero.
       */
      value: Profile.unquote(value),
      raw: value,
    };
  }

  /**
   * Removes one pair of matching quotes.
   *
   * Windows strips a single or double quote pair, and the point of it is to
   * let a value keep the whitespace that would otherwise be trimmed away.
   */
  static unquote(value) {
    if (value.length >= 2) {
      const first = value[0];

      if ((first === '"' || first === "'") && value[value.length - 1] === first) {
        return value.substring(1, value.length - 1);
      }
    }

    return value;
  }

  /** Sections and entries compare without regard to case. */
  static same(left, right) {
    return String(left).toLowerCase() === String(right).toLowerCase();
  }

  /** The file's lines, however it happens to end them. */
  get lines() {
    return this._text.split(/\r\n|\r|\n/);
  }

  /**
   * The value of one entry, or `null` if the file does not have it.
   *
   * @param {string} section - The section to look in.
   * @param {string} entry - The entry to look for.
   * @param {boolean} unquoted - Whether to remove a surrounding quote pair.
   *                             The string calls do; the integer calls do not.
   */
  get(section, entry, unquoted = true) {
    let within = false;

    for (const line of this.lines) {
      const opened = Profile.sectionOf(line);

      if (opened !== null) {
        within = Profile.same(opened, section);
        continue;
      }

      if (!within) {
        continue;
      }

      const found = Profile.entryOf(line);

      /* The first match wins. A file with the same entry twice in a section is
       * malformed, and Windows reads it top to bottom like this.
       */
      if (found && Profile.same(found.entry, entry)) {
        return unquoted ? found.value : found.raw;
      }
    }

    return null;
  }

  /**
   * Every entry name in a section, in the order the file lists them.
   *
   * This is what a program gets when it asks for a string with no entry named,
   * and it is how `[fonts]` and `[ports]` are enumerated.
   *
   * @param {string} section - The section to enumerate.
   */
  entries(section) {
    const names: string[] = [];

    let within = false;

    for (const line of this.lines) {
      const opened = Profile.sectionOf(line);

      if (opened !== null) {
        within = Profile.same(opened, section);
        continue;
      }

      if (!within) {
        continue;
      }

      const found = Profile.entryOf(line);

      if (found) {
        names.push(found.entry);
      }
    }

    return names;
  }

  /** Every section name in the file, in order. */
  sections() {
    const names: string[] = [];

    for (const line of this.lines) {
      const opened = Profile.sectionOf(line);

      if (opened !== null) {
        names.push(opened);
      }
    }

    return names;
  }

  /**
   * Writes a value in the form that reads back as itself.
   *
   * Whitespace at either end of a value is not part of it, so a value that has
   * some would come back shorter than it went in. Quoting is how the format
   * carries it: the reader removes one surrounding pair, so a quoted value
   * survives intact. Windows does this too: a value written with spaces around
   * it is read back with them, which only works if the writer put quotes on.
   */
  static quote(value) {
    if (value !== value.trim()) {
      return `"${value}"`;
    }

    return value;
  }

  /**
   * Sets an entry, adding the section or the entry if the file lacks it.
   *
   * A value of `null` removes the entry, which is what a program asking to
   * write a null string means. Removing an entry does not remove its section:
   * an empty section is a real thing, and a program that writes its settings
   * back one at a time would otherwise destroy the section it is filling.
   *
   * @param {string} section - The section to write in.
   * @param {string} entry - The entry to write.
   * @param {string|null} value - What to write, or `null` to remove it.
   */
  set(section, entry, value) {
    const lines = this.lines;
    const output: string[] = [];

    let within = false;
    let written = false;
    let sectionSeen = false;

    /* Where the section ended, so a new entry joins the section it belongs to
     * rather than being appended to the end of the file under some other one.
     */
    let endOfSection = -1;

    for (const line of lines) {
      const opened = Profile.sectionOf(line);

      if (opened !== null) {
        if (within) {
          endOfSection = output.length;
        }

        within = Profile.same(opened, section);
        sectionSeen = sectionSeen || within;
        output.push(line);
        continue;
      }

      const found = within ? Profile.entryOf(line) : null;

      if (found && Profile.same(found.entry, entry)) {
        if (value !== null) {
          output.push(`${entry}=${Profile.quote(value)}`);
        }

        written = true;
        continue;
      }

      output.push(line);
    }

    if (within) {
      endOfSection = output.length;
    }

    if (!written && value !== null) {
      if (!sectionSeen) {
        /* A new section goes at the end, after a blank line if the file does
         * not already end in one.
         */
        if (output.length && output[output.length - 1].trim() !== '') {
          output.push('');
        }

        output.push(`[${section}]`);
        output.push(`${entry}=${Profile.quote(value)}`);
      } else {
        /* Back up over the blank lines that separate this section from the
         * next, so the entry lands inside its own section.
         */
        let at = endOfSection;

        while (at > 0 && output[at - 1].trim() === '') {
          at--;
        }

        output.splice(at, 0, `${entry}=${Profile.quote(value)}`);
      }
    }

    this._text = output.join('\r\n');

    return this;
  }
}
