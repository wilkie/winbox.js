'use strict';

/**
 * Reading and writing initialisation files, the way Windows 3.1 does.
 *
 * Nearly everything Windows knows about itself is in one of these. `WIN.INI`
 * holds the locale -- which is how Clock learns that noon is "PM" -- the
 * installed fonts, the printer ports and the desktop; `SYSTEM.INI` holds the
 * drivers. A program's own settings live in its own file. The profile calls
 * are how all of it is read, which makes them load-bearing far out of
 * proportion to how simple they look.
 *
 * Windows keeps a file it has written in memory, as bytes, and works on those
 * bytes: it reads them, edits them in place, and writes them back whole. The
 * `profile` probe recorded the file after each of its writes, and every rule
 * here is what those bytes showed.
 *
 * A line ends at a carriage return, and the byte after the return is taken to
 * be the line feed without being looked at. When the file is loaded, each line
 * is normalised in place: the whitespace at its start goes, and on a line
 * with an `=` so does the whitespace before the `=` and after it. The value's
 * trailing whitespace is not removed -- a carriage return is written over the
 * first of it. That return is where the line now ends, so the rest of the
 * whitespace and the original line ending are left behind as a short line of
 * their own, and the file keeps them from then on. `ends=  both ends  ` is
 * written back as `ends=both ends\r \r\n`, and read as `both ends` followed by
 * a line holding one space.
 *
 * The rest of the format is plainer: a lookup is case-insensitive on the
 * section and on the entry, and a value wrapped in matching quotes has them
 * removed, which is the only way to have a value whose whitespace is
 * significant.
 *
 * This works on the file's text rather than on the file, so it can be tested
 * without a disk and so the same parse serves a read and a write.
 */

/** One line of the buffer: its text, and the bytes that end it. */
interface Line {
  text: string;

  /**
   * A carriage return and the byte after it -- normally a line feed, but
   * whatever was there -- or the return alone at the end of the file, or
   * nothing at all for a final line with no return.
   */
  end: string;
}

export class Profile {
  declare _lines: Line[];

  /**
   * @param {string} text - The contents of the file, as it was on the disk.
   */
  constructor(text = '') {
    this._lines = Profile.split(Profile.normalise(text));
  }

  /** The bytes as they would be written back. */
  get text() {
    return this._lines.map((line) => line.text + line.end).join('');
  }

  /**
   * Cuts a buffer into lines at each carriage return, taking the byte after
   * the return as part of the line's ending without looking at it.
   */
  static split(text: string): Line[] {
    const lines: Line[] = [];
    let at = 0;

    while (at < text.length) {
      const cr = text.indexOf('\r', at);

      if (cr === -1) {
        lines.push({ text: text.substring(at), end: '' });
        break;
      }

      lines.push({ text: text.substring(at, cr), end: text.substring(cr, cr + 2) });
      at = cr + 2;
    }

    return lines;
  }

  /**
   * What loading a file does to it: the whitespace at the start of every line
   * is dropped, and an entry is compacted to `name=value` with a return
   * written over the first of the value's trailing whitespace, the rest of it
   * left where it was. Recorded on every line of the probe's file.
   */
  static normalise(text: string) {
    let out = '';

    for (const { text: raw, end } of Profile.split(text)) {
      let line = raw.replace(/^[ \t]+/, '');

      if (!line.startsWith('[') && !line.startsWith(';')) {
        const at = line.indexOf('=');

        if (at >= 0) {
          const name = line.substring(0, at).replace(/[ \t]+$/, '');
          const rest = line.substring(at + 1).replace(/^[ \t]+/, '');
          const kept = rest.replace(/[ \t]+$/, '');

          line = `${name}=${kept}`;

          if (kept.length < rest.length) {
            line += `\r${rest.substring(kept.length + 1)}`;
          }
        }
      }

      out += line + end;
    }

    return out;
  }

  /**
   * Whether a line opens a section, and which.
   *
   * The name is whatever sits between the brackets. Whatever follows the
   * closing bracket is ignored: `[Odd]   ` opens `Odd`. Whether the name's
   * own surrounding whitespace counts is not yet measured.
   */
  static sectionOf(line: string) {
    const match = /^\[([^\]]*)\]/.exec(line);

    return match ? match[1].trim() : null;
  }

  /**
   * Splits a line into its entry and its value.
   *
   * The first `=` divides them; a later one belongs to the value, because a
   * value is allowed to contain anything at all. The value is taken as it
   * stands: loading the file trimmed it, and a value written since then is
   * read back exactly as it was written, leading spaces and all.
   */
  static entryOf(line: string) {
    /* A line whose first character is a semicolon is a comment. A semicolon
     * anywhere else is an ordinary character: `sList=;` is a real entry in a
     * real `WIN.INI` and its value is a semicolon.
     */
    if (line.startsWith(';') || line.startsWith('[')) {
      return null;
    }

    const at = line.indexOf('=');

    if (at < 0) {
      return null;
    }

    const value = line.substring(at + 1);

    return {
      entry: line.substring(0, at),

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
  static unquote(value: string) {
    if (value.length >= 2) {
      const first = value[0];

      if ((first === '"' || first === "'") && value[value.length - 1] === first) {
        return value.substring(1, value.length - 1);
      }
    }

    return value;
  }

  /** Sections and entries compare without regard to case. */
  static same(left: string, right: string) {
    return String(left).toLowerCase() === String(right).toLowerCase();
  }

  /** The text of each line, without its ending. */
  get lines() {
    return this._lines.map((line) => line.text);
  }

  /**
   * The value of one entry, or `null` if the file does not have it.
   *
   * @param {string} section - The section to look in.
   * @param {string} entry - The entry to look for.
   * @param {boolean} unquoted - Whether to remove a surrounding quote pair.
   *                             The string calls do; the integer calls do not.
   */
  get(section: string, entry: string, unquoted = true) {
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
  entries(section: string) {
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
   * Sets an entry, adding the section or the entry if the file lacks it.
   *
   * A replaced entry keeps the name as the file spells it, and gets a fresh
   * line ending. A new entry goes after the section's last entry. A new
   * section goes after the last complete line of the file, after a blank
   * line, even where the file already ends in one; a final line with no
   * return is left after it. A value of `null` removes the entry, which is
   * what a program asking to write a null string means. Removing an entry
   * does not remove its section: an empty section is a real thing, and a
   * program that writes its settings back one at a time would otherwise
   * destroy the section it is filling.
   *
   * @param {string} section - The section to write in.
   * @param {string} entry - The entry to write.
   * @param {string|null} value - What to write, or `null` to remove it.
   */
  set(section: string, entry: string, value: string | null) {
    const lines = this._lines;

    let within = false;
    let sectionSeen = false;

    /* Where the section ended, so a new entry joins the section it belongs to
     * rather than being appended to the end of the file under some other one.
     */
    let endOfSection = -1;

    for (let at = 0; at < lines.length; at++) {
      const opened = Profile.sectionOf(lines[at].text);

      if (opened !== null) {
        if (within) {
          endOfSection = at;
        }

        within = Profile.same(opened, section);
        sectionSeen = sectionSeen || within;
        continue;
      }

      const found = within ? Profile.entryOf(lines[at].text) : null;

      if (found && Profile.same(found.entry, entry)) {
        if (value === null) {
          lines.splice(at, 1);
        } else {
          lines[at] = { text: `${found.entry}=${value}`, end: '\r\n' };
        }

        return this;
      }
    }

    if (value === null) {
      return this;
    }

    if (within) {
      endOfSection = lines.length;
    }

    if (!sectionSeen) {
      /* After the last complete line: a final line with no return stays at
       * the end, after what is added.
       */
      let at = lines.length;

      if (at && !lines[at - 1].end.startsWith('\r')) {
        at--;
      }

      const added: Line[] = [
        { text: `[${section}]`, end: '\r\n' },
        { text: `${entry}=${value}`, end: '\r\n' },
      ];

      if (at) {
        added.unshift({ text: '', end: '\r\n' });
      }

      lines.splice(at, 0, ...added);
    } else {
      /* Back up over the blank lines that separate this section from the
       * next, so the entry lands inside its own section.
       */
      let at = endOfSection;

      while (at > 0 && lines[at - 1].text.trim() === '') {
        at--;
      }

      lines.splice(at, 0, { text: `${entry}=${value}`, end: '\r\n' });
    }

    return this;
  }
}
