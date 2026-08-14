'use strict';

/**
 * Case conversion for the ANSI character set.
 *
 * Not `toUpperCase`: these work on single bytes in the Windows codepage, and
 * the accented range has traps in it that a plain "add or subtract 0x20" walks
 * straight into. What is here matches what real Windows 3.1 returned, recorded
 * in `oracle/fixtures/strings.json`:
 *
 *   à é ü  (0xE0 0xE9 0xFC)  uppercase to  À É Ü  (0xC0 0xC9 0xDC)
 *   ß      (0xDF)            unchanged, having no single uppercase form
 *   ÷ ×    (0xF7 0xD7)       unchanged, being arithmetic rather than letters
 *
 * The two symbols are the reason the ranges below have holes in them: they sit
 * in the middle of the accented letters, so a range check without them
 * converts a division sign into a multiplication sign.
 *
 * 0xFF (ÿ) is left alone. Its uppercase in this codepage is 0x9F, which is not
 * a simple offset, and nothing has measured what Windows does with it.
 */

/** Uppercases one ANSI byte. */
export function ansiUpperByte(byte) {
  // a-z
  if (byte >= 0x61 && byte <= 0x7a) {
    return byte - 0x20;
  }

  // The accented lowercase letters, less the division sign at 0xF7.
  if (byte >= 0xe0 && byte <= 0xfe && byte !== 0xf7) {
    return byte - 0x20;
  }

  return byte;
}

/** Lowercases one ANSI byte. */
export function ansiLowerByte(byte) {
  // A-Z
  if (byte >= 0x41 && byte <= 0x5a) {
    return byte + 0x20;
  }

  // The accented uppercase letters, less the multiplication sign at 0xD7.
  if (byte >= 0xc0 && byte <= 0xde && byte !== 0xd7) {
    return byte + 0x20;
  }

  return byte;
}

/**
 * Converts a string in guest memory in place, or a single character.
 *
 * These functions take a far pointer, except when they do not: a high word of
 * zero means the low byte is a character to convert on its own, and the result
 * comes back in the low byte rather than being written anywhere. Software used
 * that to avoid needing a buffer for one letter.
 *
 * @param {object} core - The CPU core, for reaching guest memory.
 * @param {number} pointer - A far pointer, or a character in the low word.
 * @param {Function} convert - What to do to each byte.
 * @returns {number} The pointer it was given, or the converted character.
 */
export function ansiConvert(core, pointer, convert) {
  const segment = (pointer >> 16) & 0xffff;

  if (segment === 0) {
    // A character rather than a pointer.
    return convert(pointer & 0xff);
  }

  let offset = pointer & 0xffff;

  for (;;) {
    const byte = core.read8(segment, offset);

    if (!byte) {
      return pointer;
    }

    core.write8(segment, offset, convert(byte));
    offset++;
  }
}
