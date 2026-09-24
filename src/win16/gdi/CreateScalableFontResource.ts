'use strict';

import { TRUE, FALSE } from '../consts.js';

/**
 * The bytes of the `.FOT` stub `CreateScalableFontResource` writes for a
 * TrueType file: a library of header and resources and nothing else, whose
 * one font directory entry describes the face in its own design units and
 * whose other resource is the path to the `.TTF`. FONTS.md 8c decodes it
 * field by field from `fotmake`'s five recordings, which this reproduces byte
 * for byte.
 *
 * Every number in the entry comes out of the `.TTF` except three that are
 * copied as recorded: `dfType`'s `0x4083`, the font ordinal of nought, a
 * `0xc3` byte at `0x200` in the padding, and four bytes after the copyright
 * string's terminator. `dfReserved`, which 8c could not
 * explain, is `head.lowestRecPPEM` in its low word and `OS/2`'s first
 * character's high byte in its high word -- 11 for four faces and 12 for
 * Wingdings, `0xf000` for exactly the two whose characters start at `0xf020`.
 *
 * Only regular faces were recorded. The face string is the `name` table's
 * full name, which for those is the family's; a bold or italic file may
 * answer differently and has not been asked.
 */
export function scalableFontResource(ttf: Uint8Array, fontPath: string) {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const tables: Record<string, number> = {};

  for (let index = 0; index < view.getUint16(4); index++) {
    const at = 12 + 16 * index;
    const tag = String.fromCharCode(...ttf.subarray(at, at + 4));
    tables[tag] = view.getUint32(at + 8);
  }

  const head = tables['head'];
  const hhea = tables['hhea'];
  const os2 = tables['OS/2'];

  const unitsPerEm = view.getUint16(head + 18);
  const xMin = view.getInt16(head + 36);
  const xMax = view.getInt16(head + 40);
  const lowestRecPPEM = view.getUint16(head + 46);
  const ascender = view.getInt16(hhea + 4);
  const descender = view.getInt16(hhea + 6);
  const lineGap = view.getInt16(hhea + 8);
  const averageWidth = view.getInt16(os2 + 2);
  const weight = view.getUint16(os2 + 4);
  const panose = ttf.subarray(os2 + 32, os2 + 42);
  const firstChar = view.getUint16(os2 + 64);

  /* The `name` table's strings, from the Microsoft platform where there is
   * one: big-endian UTF-16. */
  const nameOf = (id: number) => {
    const table = tables['name'];
    const count = view.getUint16(table + 2);
    const strings = table + view.getUint16(table + 4);
    let found = '';

    for (let index = 0; index < count; index++) {
      const record = table + 6 + 12 * index;
      const platform = view.getUint16(record);
      const language = view.getUint16(record + 4);

      if (view.getUint16(record + 6) !== id || platform !== 3 || (language & 0xff) !== 0x09) {
        continue;
      }

      const length = view.getUint16(record + 8);
      const offset = strings + view.getUint16(record + 10);

      found = '';

      for (let at = 0; at < length; at += 2) {
        found += String.fromCharCode(view.getUint16(offset + at));
      }

      break;
    }

    return found;
  };

  const face = nameOf(4);
  const family = nameOf(1);
  const style = nameOf(2);

  /* The family from PANOSE, in the order the cases take precedence; see
   * FONTS.md 8c. A serif style of one ("no fit") was not recorded and is
   * taken as nothing said. */
  const monospaced = panose[3] === 9;
  const familyBits =
    panose[0] === 3 ? 0x40 : panose[0] === 4 ? 0x50 : monospaced ? 0x30 : panose[1] >= 11 ? 0x20 : panose[1] >= 2 ? 0x10 : 0x00;
  const pitchAndFamily = familyBits | (monospaced ? 0x06 : 0x07);
  const charSet = panose[0] === 5 ? 2 : 0;

  const file = fontPath.split(/[\\/:]/).pop() ?? fontPath;
  const base = file.replace(/\.[^.]*$/, '').toUpperCase();
  const fileName = file.toUpperCase();
  const nonResident = `FONTRES:${face}`;

  const bytes = new Uint8Array(0x480 + 4 + 113 + 1 + face.length + family.length + style.length + 3 + 16);
  const out = new DataView(bytes.buffer);
  const put = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      bytes[at + index] = text.charCodeAt(index) & 0xff;
    }
  };

  /* The DOS stub, as recorded, message and signature included. */
  const stub =
    '4d5a0100020000000400' + '0f00ffff0000b8000000' + '00000000400000000000' + '0000'.repeat(15) + '800000000e1fba0e00b409cd21b8014ccd21';
  bytes.set(Uint8Array.from(stub.match(/../g)!.map((pair) => parseInt(pair, 16))), 0);
  put(0x4e, 'This is a TrueType font, not a program.\r\r\n$');
  put(0x7a, 'Kiesa');

  /* The NE header. Everything after the resource table chains from the
   * lengths of the three names. */
  const ne = 0x80;
  const residentLength = base.length + 6;
  const moduleReferences = 0x74 + residentLength;
  const imported = fileName.length + 1;
  const entry = moduleReferences + imported + 1;
  const nonResidentAt = ne + entry + 4;

  put(ne, 'NE');
  bytes[ne + 2] = 5;
  bytes[ne + 3] = 0x10;
  out.setUint16(ne + 0x04, entry, true);
  out.setUint16(ne + 0x06, 2, true);
  out.setUint16(ne + 0x0c, 0x8000, true);
  out.setUint16(ne + 0x20, nonResident.length + 4, true);
  out.setUint16(ne + 0x22, 0x40, true);
  out.setUint16(ne + 0x24, 0x40, true);
  out.setUint16(ne + 0x26, 0x74, true);
  out.setUint16(ne + 0x28, moduleReferences, true);
  out.setUint16(ne + 0x2a, moduleReferences, true);
  out.setUint32(ne + 0x2c, nonResidentAt, true);
  out.setUint16(ne + 0x32, 4, true);
  out.setUint16(ne + 0x34, 2, true);
  bytes[ne + 0x36] = 2;
  out.setUint16(ne + 0x3e, 0x0300, true);

  /* The resource table: alignment shift 4, the font directory and the path. */
  const fontDirectoryLength = 4 + 113 + 1 + face.length + family.length + style.length + 3;
  const resources = [
    0x0004,
    0x8007, 1, 0, 0, 0x48, (fontDirectoryLength + 15) >> 4, 0x0c50, 0x002c, 0, 0,
    0x80cc, 1, 0, 0, 0x40, 0x08, 0x0c50, 0x8001, 0, 0,
    0,
  ];
  resources.forEach((word, index) => out.setUint16(ne + 0x40 + 2 * index, word, true));
  bytes[ne + 0x6c] = 7;
  put(ne + 0x6d, 'FONTDIR');

  bytes[ne + 0x74] = base.length;
  put(ne + 0x75, base);
  bytes[ne + moduleReferences] = imported;
  put(ne + moduleReferences + 1, fileName);
  bytes[nonResidentAt] = nonResident.length + 4;
  put(nonResidentAt + 1, nonResident);

  /* Something in the padding, the same in every recording. */
  bytes[0x200] = 0xc3;

  /* Resource 204: the path, NUL-padded to 128. */
  put(0x400, fontPath);

  /* The font directory: a count, an ordinal of nought, and the entry. */
  const d = 0x480;
  out.setUint16(d, 1, true);
  out.setUint16(d + 2, 0, true);
  const e = d + 4;
  out.setUint16(e + 0, 0x0200, true);
  out.setUint32(e + 2, 149, true);
  put(e + 6, 'Windows! Windows! Windows!');
  /* And four bytes after the string's terminator, the same in every
   * recording: left over in the buffer the copyright was built in. */
  bytes.set([0x10, 0x03, 0x01, 0x01], e + 33);
  out.setUint16(e + 66, 0x4083, true);
  out.setUint16(e + 68, unitsPerEm, true);
  out.setUint16(e + 70, 72, true);
  out.setUint16(e + 72, 72, true);
  out.setUint16(e + 74, ascender, true);
  out.setUint16(e + 76, ascender - descender - unitsPerEm, true);
  out.setUint16(e + 78, lineGap, true);
  out.setUint16(e + 83, weight, true);
  bytes[e + 85] = charSet;
  out.setUint16(e + 88, ascender - descender, true);
  bytes[e + 90] = pitchAndFamily;
  out.setUint16(e + 91, averageWidth, true);
  out.setUint16(e + 93, xMax - xMin, true);
  bytes[e + 95] = 30;
  bytes[e + 96] = 255;
  bytes[e + 97] = 1;
  bytes[e + 98] = 2;
  out.setUint32(e + 105, 118, true);
  out.setUint32(e + 109, ((firstChar & 0xff00) << 16) | lowestRecPPEM, true);
  put(e + 114, face);
  put(e + 115 + face.length, family);
  put(e + 116 + face.length + family.length, style);

  return bytes;
}

/**
 * The **CreateScalableFontResource** function creates a font resource file
 * for a TrueType font file: the `.FOT` stub `AddFontResource` installs.
 *
 * @static
 * @function CreateScalableFontResource
 * @memberof Gdi
 *
 * @param {Types.UINT} fHidden - Whether the font is read-only. Only `1` has
 *                               been recorded.
 * @param {Types.LPCSTR} lpszResourceFile - The `.FOT` file to create.
 * @param {Types.LPCSTR} lpszFontFile - The `.TTF` file it describes.
 * @param {Types.LPCSTR} lpszCurrentPath - Where the `.TTF` is, if the name
 *                                         alone is given.
 *
 * @return {Types.BOOL} Nonzero if the file was written.
 */
export async function CreateScalableFontResource(fHidden, lpszResourceFile, lpszFontFile, lpszCurrentPath) {
  if (!lpszResourceFile || !lpszFontFile) {
    return FALSE;
  }

  const fontPath = lpszCurrentPath ? `${lpszCurrentPath}\\${lpszFontFile}` : String(lpszFontFile);
  const source = await this.dos.files.open(fontPath);
  const font = this.dos.files.resolve(source);

  if (!font) {
    return FALSE;
  }

  const ttf = new Uint8Array(await font.read(0, font.size));
  this.dos.files.close(source);

  const target = await this.dos.files.create(String(lpszResourceFile));
  const file = this.dos.files.resolve(target);

  if (!file) {
    return FALSE;
  }

  await file.write(0, scalableFontResource(ttf, String(lpszFontFile)));
  this.dos.files.close(target);

  return TRUE;
}
