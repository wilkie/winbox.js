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
 * A line runs to a line feed, as KERNEL walks the buffer (`KRNL386.EXE` seg1
 * `66ac`, `6783`, `71cb`, `722c`: every step to the next line is a scan for
 * `0Ah`). Its text, here, is what comes before its first carriage return, and
 * the return and what follows it to the line feed are its ending. When the
 * file is loaded, each line is normalised in place: the whitespace at its
 * start goes, and on a line with an `=` so does the whitespace before the `=`
 * and after it. A value's trailing blanks stay. A read of the value cuts them,
 * in the buffer: it writes the byte that ended the value, a carriage return,
 * over the first of them (`6864`, from `6569`), so the rest of the blanks are
 * left after the return as part of the line's ending, and the file keeps them
 * from then on. `ends=  both ends  `, read and then written back, is
 * `ends=both ends\r \r\n`.
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
   * Cuts a buffer into lines, each running to and taking in a line feed, as
   * KERNEL steps from line to line; the text of each is what comes before
   * its first carriage return, and the rest is its ending.
   */
  static split(text: string): Line[] {
    const lines: Line[] = [];
    let at = 0;

    while (at < text.length) {
      const lf = text.indexOf('\n', at);
      const next = lf === -1 ? text.length : lf + 1;
      const whole = text.substring(at, next);
      const cr = whole.indexOf('\r');

      lines.push(
        cr === -1
          ? { text: whole.replace(/\n$/, ''), end: whole.endsWith('\n') ? '\n' : '' }
          : { text: whole.substring(0, cr), end: whole.substring(cr) }
      );
      at = next;
    }

    return lines;
  }

  /**
   * KERNEL's measure of a string it is given or holds (`KRNL386.EXE` seg1
   * `6864`): it runs to the first byte at or below `0Dh` -- a return, a tab,
   * the nought -- and back over the spaces before it; where there are any,
   * the byte that ended it is written over the first of them. What it
   * answers is the string so measured, and the string as that left it.
   */
  static measure(text: string) {
    let stop = 0;

    while (stop < text.length && text.charCodeAt(stop) > 0x0d) {
      stop++;
    }

    let cut = stop;

    while (cut > 0 && text[cut - 1] === ' ') {
      cut--;
    }

    const ender = stop < text.length ? text[stop] : '\0';
    const after = cut < stop ? text.substring(0, cut) + ender + text.substring(cut + 1) : text;

    return { value: text.substring(0, cut), length: cut, after };
  }

  /**
   * What loading a file does to it (**read out**, `KRNL386.EXE` seg1
   * `6b77`-`6c89`): the whitespace at the start of every line is dropped,
   * and on a line with an `=` the blanks before the `=` and after it; the
   * rest of the line is copied as it was, a value's trailing blanks with it
   * (`profnul`: `y=  two  ` written back as `y=two  `). A comment, and a
   * section's line, are compacted as any other -- under Windows in protected
   * mode, `WF_PMODE` in its flags (`[324h]`, `6b92`), always so in 3.1; in
   * real mode a comment is dropped whole. Widget Workshop's installer
   * writes its `WIDGET.INI`, and Windows made `; (the =1 is necessary)` of
   * it `; (the=1 is necessary)` (`widget-windows.json`).
   */
  static normalise(text: string) {
    let out = '';

    for (const { text: raw, end } of Profile.split(text)) {
      let line = raw.replace(/^[ \t]+/, '');
      const at = line.indexOf('=');

      if (at >= 0) {
        line = `${line.substring(0, at).replace(/[ \t]+$/, '')}=${line.substring(at + 1).replace(/^[ \t]+/, '')}`;
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
   * The first `=` divides them; a later one belongs to the value. The value
   * is measured as KERNEL reads it (`measure`): to the first byte at or below
   * `0Dh`, its trailing spaces left out. Its leading spaces are as loading
   * the file left them, and a value written since then reads back with them.
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

    const value = Profile.measure(line.substring(at + 1)).value;

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
   * Where a line starts in the buffer.
   */
  offsetOf(index: number) {
    let at = 0;

    for (let i = 0; i < index; i++) {
      at += this._lines[i].text.length + this._lines[i].end.length;
    }

    return at;
  }

  /**
   * The buffer as KERNEL holds it, the file's bytes and the three it adds as
   * it loads one, a return, a line feed and a nought (`KRNL386.EXE` seg1
   * `6ca8`-`6cdf`), edited by `edit`; what is left of it, less those three,
   * is the file. KERNEL writes `[0Ah]` less three bytes (`70ef`-`710a`), so
   * an edit that takes in the return and line feed it added takes the
   * file's last two bytes off.
   */
  edit(edit: (buffer: string) => string) {
    const buffer = edit(`${this.text}\r\n\0`);

    this._lines = Profile.split(buffer.substring(0, Math.max(0, buffer.length - 3)));
  }

  /**
   * An entry's line taken out (**read out**, `KRNL386.EXE` seg1 `722c`): from
   * after the line feed before its `=` to after the next one. An entry on a
   * last line with no line feed takes in the return and line feed KERNEL
   * added after it (`profnul`'s `open entry`: `[A] a=1 [B] b=2` with no
   * ending, `b` removed, is `[A]\r\na=1\r\n[B]`).
   */
  removeLine(index: number) {
    const start = this.offsetOf(index);

    this.edit((buffer) => {
      const lf = buffer.indexOf('\n', start);

      return buffer.substring(0, start) + buffer.substring(lf + 1);
    });
  }

  /**
   * Whether the file has a section, as `WritePrivateProfileString` looks for
   * one (`KRNL386.EXE` seg1 `66ac`).
   */
  hasSection(section: string) {
    return this._lines.some((line) => {
      const opened = Profile.sectionOf(line.text);

      return opened !== null && Profile.same(opened, section);
    });
  }

  /**
   * A section removed, as `WritePrivateProfileString` with no entry removes
   * it (**read out**, `KRNL386.EXE` seg1 `6d8f`-`6d97`, `703f`, `71cb`-`7229`):
   * from the `[` of its heading -- the last on the heading's line -- every
   * line up to the next line that starts with `[`, or the buffer's end;
   * except that a line starting with `;` is kept, moved up to where the
   * heading was. Lines are taken as KERNEL steps them, to each line feed. At
   * the buffer's end the cut stops before the return and line feed KERNEL
   * added (`71f7`), so it takes the file to its last byte. The first section
   * of the name is the one removed (`profnul`'s `twice`).
   */
  removeSection(section: string) {
    const index = this._lines.findIndex((line) => {
      const opened = Profile.sectionOf(line.text);

      return opened !== null && Profile.same(opened, section);
    });

    if (index < 0) {
      return;
    }

    const heading = this.offsetOf(index);
    const line = this._lines[index];
    const after = heading + line.text.length + line.end.length;

    this.edit((buffer) => {
      const to = buffer.lastIndexOf('[', after - 1);
      let read = to + 1;
      let kept = '';

      for (;;) {
        const first = buffer[read++];

        if (first === ';') {
          const lf = buffer.indexOf('\n', read - 1);

          kept += buffer.substring(read - 1, lf + 1);
          read = lf + 1;
        } else if (first === '[') {
          read--;
          break;
        } else if (first === '\0' || first === undefined) {
          read -= 3;
          break;
        } else {
          let at = read - 1;

          while (buffer[at] !== '\n' && at < buffer.length) {
            at++;
          }

          read = at + 1;
        }
      }

      return buffer.substring(0, to) + kept + buffer.substring(read);
    });
  }

  /**
   * Whether an entry's value in the buffer is the caller's string, as
   * KERNEL compares them before it writes (`KRNL386.EXE` seg1 `7150`): byte
   * for byte, with regard to case, from after the `=` to the buffer's first
   * return, against the caller's string to its nought.
   */
  holds(section: string, entry: string, given: string) {
    let within = false;

    for (const line of this._lines) {
      const opened = Profile.sectionOf(line.text);

      if (opened !== null) {
        within = Profile.same(opened, section);
        continue;
      }

      const found = within ? Profile.entryOf(line.text) : null;

      if (found && Profile.same(found.entry, entry)) {
        /* A line with no return of its own runs on, to the next line's. */
        if (!line.end.startsWith('\r') && line.end !== '') {
          return false;
        }

        return line.text.substring(found.entry.length + 1) === given;
      }
    }

    return false;
  }

  /**
   * A value read as `GetPrivateProfileString` reads it, which cuts its
   * trailing spaces in the buffer (**read out**, `KRNL386.EXE` seg1
   * `6569`-`656c`, `6864`): the byte that ended the value is written over
   * the first of them. `null` where the file has no such entry.
   */
  read(section: string, entry: string) {
    let within = false;

    for (let index = 0; index < this._lines.length; index++) {
      const line = this._lines[index];
      const opened = Profile.sectionOf(line.text);

      if (opened !== null) {
        within = Profile.same(opened, section);
        continue;
      }

      const found = within ? Profile.entryOf(line.text) : null;

      if (!found || !Profile.same(found.entry, entry)) {
        continue;
      }

      /* The line's own bytes, and KERNEL's return after the last line. */
      const start = found.entry.length + 1;
      const whole = line.text + line.end + (line.end.includes('\n') ? '' : '\r');
      const measured = Profile.measure(whole.substring(start));
      const after = whole.substring(0, start) + measured.after;

      if (after !== whole) {
        const kept = line.end.includes('\n') ? after : after.substring(0, after.length - 1);

        this._lines.splice(index, 1, ...Profile.split(kept));
      }

      return found.value;
    }

    return null;
  }

  /**
   * Sets an entry, adding the section or the entry if the file lacks it.
   *
   * A replaced entry keeps the name as the file spells it, and gets a fresh
   * line ending. A new entry goes after the section's last entry. A new
   * section goes after the last complete line of the file, after a blank
   * line, even where the file already ends in one; a final line with no
   * return is left after it. A value of `null` removes the entry's line
   * (`removeLine`), and leaves its section.
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
          this.removeLine(at);
        } else {
          /* The value written from after the `=`, and a return and a line
           * feed over the first two bytes of the old ending (`KRNL386.EXE`
           * seg1 `6e06`-`6e1a`, `72b5`): `spaced=padded value\r  \r\n`
           * becomes `spaced=  untrimmed\r\n \r\n` (`profile`). A last line
           * with no ending has them written over KERNEL's own. */
          const end = lines[at].end;
          const ending = end.length >= 2 ? `\r\n${end.substring(2)}` : end === '' ? '' : '\r\n';

          lines.splice(at, 1, ...Profile.split(`${found.entry}=${value}${ending}`));
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
      /* **Read out** (`KRNL386.EXE` seg1 `6e49`-`6e7b`, `726a`): from the
       * buffer's end, back over every return and line feed to the last
       * other byte; three on from it -- itself, a return and a line feed --
       * the section goes, `\r\n` before its heading unless that is the
       * buffer's start. What was after stays after it: the blank lines a
       * file ends in, or the line feed a value's return left
       * (`profile`'s snapshots; Widget Workshop's `WIDGET.INI`). */
      const text = lines.map((line) => line.text + line.end).join('');
      let last = text.length - 1;

      while (last >= 0 && (text[last] === '\r' || text[last] === '\n')) {
        last--;
      }

      const at = last < 0 ? 0 : Math.min(last + 3, text.length);
      const added = `${at ? '\r\n' : ''}[${section}]\r\n${entry}=${value}\r\n`;

      this._lines = Profile.split(text.slice(0, at) + added + text.slice(at));
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
