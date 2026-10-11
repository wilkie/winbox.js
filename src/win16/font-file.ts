'use strict';

/**
 * What `AddFontResource` reads of a font file (`GDI.EXE` seg2 `0beb`): its
 * module's name; whether it has a data segment, which no font file has and
 * which fails the add (seg2 `0bb9`); its `FONTDIR`'s count, which the add
 * answers; whether its first font is a TrueType one, and the full name that
 * font carries, by which a `.FOT` is known again (seg2 `0b0b`); and the
 * highest `dfVersion` among its entries that is neither 200h nor 100h, nought
 * where none is, which GDI holds to its limit (seg2 `0d9d`). See
 * `kb/topics/font-resources.md`.
 */
export interface FontFile {
  module: string;
  data: boolean;
  count: number;
  trueType: boolean;
  fullName: string;
  highest: number;
}

/**
 * The highest `dfVersion` GDI takes a raster or vector file's entry of,
 * besides 200h and 100h, which it always takes (seg2 `0d9d`): 300h where the
 * display's `RASTERCAPS` has `RC_BIGFONT`, else 200h, set as the first device
 * context is made (seg1 `047a`). **Recorded** by `fontver`. As the Rust
 * engine's `version_limit`.
 */
export function versionLimit(bigFont: boolean) {
  return bigFont ? 0x300 : 0x200;
}

/** `RT_FONTDIR`, a numbered type. */
const RT_FONTDIR = 0x8007;

/** The size of a `FONTDIRENTRY` before its device and face names. */
const DIRECTORY_ENTRY = 0x71;

/** A font file as `AddFontResource` reads it; null for a file that is no `NE` module, or one with no `FONTDIR`. */
export function fontFile(bytes: Uint8Array): FontFile | null {
  const word = (at: number) => {
    if (at < 0 || at + 2 > bytes.length) {
      throw new RangeError('past the end');
    }

    return bytes[at] | (bytes[at + 1] << 8);
  };

  const string = (at: number): [string, number] => {
    let end = at;

    while (end < bytes.length && bytes[end] !== 0) {
      end++;
    }

    if (end >= bytes.length) {
      throw new RangeError('past the end');
    }

    return [String.fromCharCode(...bytes.subarray(at, end)), end + 1];
  };

  try {
    if (word(0) !== 0x5a4d) {
      return null;
    }

    const ne = (word(0x3c) | (word(0x3e) << 16)) >>> 0;

    if (word(ne) !== 0x454e) {
      return null;
    }

    /* Its module's name, the resident names' first. */
    const names = ne + word(ne + 0x26);
    const module = String.fromCharCode(
      ...bytes.subarray(names + 1, names + 1 + bytes[names])
    ).toUpperCase();
    const data = word(ne + 0x0e) !== 0;

    /* The `FONTDIR`: the first resource of its type. */
    const table = ne + word(ne + 0x24);
    const shift = word(table) & 31;
    let at = table + 2;
    let directory: number | null = null;

    for (;;) {
      const kind = word(at);

      if (kind === 0) {
        break;
      }

      const count = word(at + 2);

      if (kind === RT_FONTDIR && count > 0) {
        directory = word(at + 8) * 2 ** shift;
        break;
      }

      at += 8 + count * 12;
    }

    if (directory === null) {
      return null;
    }

    const count = word(directory);
    let entry = directory + 2;
    let highest = 0;
    let trueType = false;
    let fullName = '';

    for (let index = 0; index < count; index++) {
      /* Each entry: its font's ordinal, its `FONTDIRENTRY`, its device's
       * name and its face's. */
      const info = entry + 2;

      if (word(info) !== 0x200 && word(info) !== 0x100) {
        highest = Math.max(highest, word(info));
      }

      const [, afterDevice] = string(info + DIRECTORY_ENTRY);
      const [, afterFace] = string(afterDevice);

      if (index === 0 && (word(info + 0x42) & 3) === 3) {
        trueType = true;
        fullName = string(afterFace)[0];
      }

      entry = afterFace;
    }

    return { module, data, count, trueType, fullName, highest };
  } catch {
    return null;
  }
}
