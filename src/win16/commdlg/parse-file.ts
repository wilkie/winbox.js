'use strict';

/**
 * `COMMDLG`'s file name parser, and `GetFileTitle`, which answers with it.
 * As `crates/winbox-win16/src/commdlg/parse.rs`.
 *
 * **Read out of `COMMDLG.DLL`** seg2 `5664`, and **recorded** by `ftitle`.
 * The parser walks a name and answers where its last part starts and where
 * that part's extension starts, or an error and where it was found. It
 * changes the name in place: spaces before it are taken off, by copying the
 * name down; spaces after it end it; a period that ends it is taken off.
 */

/** The parser's errors (`PARSE_*`): a directory alone, with no last part, is `DIRECTORY`. */
export const DIRECTORY = -1;
export const INVALID_DRIVE = -2;
export const INVALID_PERIOD = -3;
export const INVALID_CHARACTER = -5;
export const INVALID_SEPARATOR = -6;
export const INVALID_SPACE = -7;
export const EXTENSION_TOO_LONG = -8;
export const NAME_TOO_LONG = -9;
export const EMPTY = -10;
export const WILDCARD_IN_DIRECTORY = -11;
export const WILDCARD_IN_NAME = -12;
export const INVALID_NETWORK = -13;

const INVALID = new Set(Array.from('|"+,:;<=>[]', (c) => c.charCodeAt(0)));

/**
 * A name parsed, as seg2 `5664` parses one, in `name`: its bytes up to and
 * including its nought, and any after, changed in place as COMMDLG changes
 * them. The answer is AX and DX: where the last part starts, or an error;
 * and where its extension starts -- the end, for none; nought, for a period
 * that ended the name -- or, with an error, where it was found.
 */
export function parseFile(name: Uint8Array | number[]): [number, number] {
  const at = (i: number) => name[i] ?? 0;
  let p = 0;
  /* Folders gone through; -1 in a network path until its server is named. */
  let folders = 0;
  let network = false;

  while (at(p) === 0x20) {
    p++;
  }

  if (at(p) === 0) {
    return [EMPTY, p];
  }

  /* The spaces taken off: the name copied down, its nought with it. */
  if (p !== 0) {
    let end = p;

    while (end < name.length && name[end] !== 0) {
      end++;
    }

    for (let i = p; i <= end && i < name.length; i++) {
      name[i - p] = name[i];
    }

    p = 0;
  }

  if (at(p + 1) === 0x3a) {
    const letter = at(p) | 0x20;

    if (letter < 0x61 || letter > 0x7a) {
      return [INVALID_DRIVE, p];
    }

    p += 2;
  }

  /* What comes before the name's parts: a root, a network path's `\\`, a
   * `.` or a `..` (seg2 `56fe`). */
  if (at(p) === 0x5c || at(p) === 0x2f) {
    p++;

    if (at(p) === 0x2e) {
      p++;

      if (at(p) === 0x5c || at(p) === 0x2f) {
        p++;
      } else if (at(p) === 0) {
        return [DIRECTORY, p];
      } else {
        return [INVALID_PERIOD, p];
      }
    } else if (at(p) === 0x5c && at(p - 1) === 0x5c) {
      p++;
      folders = -1;
      network = true;
    } else if (at(p) === 0x2f) {
      return [INVALID_SEPARATOR, p];
    }
  } else if (at(p) === 0x2e) {
    p++;

    if (at(p) === 0x2e) {
      p++;
    }

    if (at(p) === 0) {
      return [DIRECTORY, p];
    } else if (at(p) === 0x5c || at(p) === 0x2f) {
      p++;
    } else {
      return [INVALID_PERIOD, p];
    }
  }

  if (at(p) === 0) {
    return [DIRECTORY, p];
  }

  let extensionLength = 0;
  let nameLength = 0;
  let extension = 0;
  let offset = 0;
  let inExtension = false;
  let wildcard = false;

  for (;;) {
    const c = at(p);

    if (c === 0) {
      break;
    }

    if ((c >= 0x01 && c <= 0x1f) || INVALID.has(c)) {
      return [INVALID_CHARACTER, p];
    }

    if (c === 0x5c || c === 0x2f) {
      folders++;

      if (wildcard) {
        return [WILDCARD_IN_DIRECTORY, p];
      }

      if (nameLength === 0) {
        return [INVALID_SEPARATOR, p];
      }

      p++;

      if (folders === 0 && at(p) === 0) {
        return [INVALID_NETWORK, p];
      }

      extensionLength = 0;
      nameLength = 0;
      inExtension = false;
      continue;
    }

    if (c === 0x20) {
      /* Spaces to the end end the name there; any other after them is an
       * error (seg2 `586d`). */
      let q = p + 1;

      while (at(q) === 0x20) {
        q++;
      }

      if (at(q) === 0) {
        name[p] = 0;
        continue;
      }

      return [INVALID_SPACE, p];
    }

    if (c === 0x2e) {
      if (nameLength === 0) {
        p++;

        if (at(p) === 0x2e) {
          p++;
        }

        if (at(p) === 0) {
          return [DIRECTORY, p];
        }

        if (at(p) === 0x5c || at(p) === 0x2f) {
          p++;
          continue;
        }

        return [INVALID_PERIOD, p];
      }

      if (inExtension) {
        return [INVALID_PERIOD, p];
      }

      extension = 0;
      p++;
      inExtension = true;
      continue;
    }

    if (c === 0x2a || c === 0x3f) {
      if (network) {
        return [INVALID_NETWORK, p];
      }

      wildcard = true;
    }

    /* A character of the part: counted, and where the part and its
     * extension start kept (seg2 `58fe`). */
    if (inExtension) {
      extensionLength++;

      if (extensionLength === 1) {
        extension = p;
      } else if (extensionLength > 3) {
        return [EXTENSION_TOO_LONG, p];
      }

      if (folders === -1 && extensionLength + nameLength > 11) {
        return [INVALID_NETWORK, p];
      }
    } else {
      nameLength++;

      if (nameLength === 1) {
        offset = p;
      } else if (nameLength > 8) {
        if (folders !== -1) {
          return [NAME_TOO_LONG, p];
        }

        if (nameLength > 11) {
          return [INVALID_NETWORK, p];
        }
      }
    }

    p++;
  }

  if (folders === -1) {
    return [INVALID_NETWORK, p];
  }

  if (nameLength === 0) {
    return [DIRECTORY, p];
  }

  /* A period that ends it taken off (seg2 `5990`). */
  if (p > 0 && at(p - 1) === 0x2e) {
    name[p - 1] = 0;
    return [offset, extension];
  }

  if (extensionLength === 0) {
    extension = p;
  }

  return [offset, extension];
}

/** The bytes of a string at a far pointer, its nought with them. */
function readBytes(system: any, far: number) {
  const core = system.machine.cpu.core;
  const bytes: number[] = [];

  for (let at = far & 0xffff; ; at = (at + 1) & 0xffff) {
    const byte = core.read8(far >>> 16, at);

    bytes.push(byte);

    if (!byte) {
      return bytes;
    }
  }
}

function writeBytes(system: any, far: number, bytes: number[]) {
  const core = system.machine.cpu.core;

  bytes.forEach((byte, i) => core.write8(far >>> 16, ((far & 0xffff) + i) & 0xffff, byte));
}

/**
 * A file's title: its last part, without its folders (`COMMDLG.DLL` seg2
 * `0c79`). Nought, the title copied; the size a buffer must have, where
 * `cbBuf` is less; a parser's error; or -12 for a title with a wildcard.
 * The name is changed as the parser changes it. **Recorded** by `ftitle`.
 *
 * @param {Types.FARPTR} lpszFile - The file's name.
 * @param {Types.FARPTR} lpszTitle - Where its title is written.
 * @param {Types.INT} cbBuf - The size of that.
 * @returns {Types.INT} Nought, a size, or an error.
 */
export function GetFileTitle(this: any, lpszFile: number, lpszTitle: number, cbBuf: number) {
  const name = readBytes(this, lpszFile);
  const [offset] = parseFile(name);

  writeBytes(this, lpszFile, name);

  if (offset < 0) {
    return offset;
  }

  const part: number[] = [];

  for (let i = offset; i < name.length && name[i] !== 0; i++) {
    part.push(name[i]);
  }

  const needed = part.length + 1;

  if (needed > (cbBuf << 16) >> 16) {
    return needed;
  }

  if (part.includes(0x2a) || part.includes(0x3f)) {
    return WILDCARD_IN_NAME;
  }

  writeBytes(this, lpszTitle, [...part, 0]);

  return 0;
}
