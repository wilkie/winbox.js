/**
 * The `.FOT` file the installer writes beside a TrueType face.
 *
 * `CreateScalableFontResource` makes one for every TrueType file Windows 3.1
 * installs: a stub NE executable whose resources are a `FONTDIR` entry -- the
 * same `FONTINFO` header a bitmap strike carries, filled in for the outline --
 * and the path of the `.TTF` it stands for. GDI enumerates the face from this
 * file, and what a program is told about the face's pitch and family is what
 * the installer wrote here, not what the `.TTF` says at run time.
 *
 * **Recorded**: Symbol's entry carries `0x17`, `FF_ROMAN`, and Wingdings'
 * `0x07`, `FF_DONTCARE`, which is what `GetTextMetrics` reports for each;
 * and swapping the `OS/2` class and the PANOSE between the two faces in the
 * `.TTF` -- four fabricated recordings of the `styles` probe -- changes nothing
 * Windows reports, which is what reading the answer from somewhere else looks
 * like. How the installer arrived at `0x07` is not known.
 */
export interface FontResource {
  /** The `.TTF` file the resource stands for, as written in the resource. */
  file: string;
  /** `dfPitchAndFamily` from the `FONTINFO` header. */
  pitchAndFamily: number;
  /** `dfCharSet` from the same header. */
  charSet: number;
  /**
   * What GDI's TrueType directory keeps of the entry (`GDI.EXE` seg2
   * `0f2c`): `dfType`'s high byte, the style flags `EnumFontFamilies` hands
   * out as `ntmFlags`; `dfPoints`, the em in font units; `dfPixHeight` and
   * `dfAvgWidth`, the cell's height and the average width in those units;
   * `dfWeight` and `dfItalic`.
   */
  flags: number;
  sizeEM: number;
  /** `dfAscent`, `dfExternalLeading` and `dfMaxWidth`, in font units. */
  ascent: number;
  externalLeading: number;
  maxWidth: number;
  cellHeight: number;
  avgWidth: number;
  weight: number;
  italic: number;
  /** The family, full and style names the stub carries past its entry. */
  family: string;
  fullName: string;
  style: string;
}

const RT_FONTDIR = 0x8007;

/** Reads the resource, or nothing if the file is not one. */
export function readFontResource(bytes: Uint8Array): FontResource | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 0x40 || view.getUint16(0, true) !== 0x5a4d) {
    return null;
  }

  const ne = view.getUint32(0x3c, true);

  if (ne + 0x40 > bytes.length || view.getUint16(ne, true) !== 0x454e) {
    return null;
  }

  const table = ne + view.getUint16(ne + 0x24, true);
  const shift = view.getUint16(table, true);

  let at = table + 2;
  let fontdir: number | null = null;
  let path: string | null = null;

  // Type entries until a type of nought; each carries `count` name entries.
  while (at + 8 <= bytes.length) {
    const type = view.getUint16(at, true);

    if (type === 0) {
      break;
    }

    const count = view.getUint16(at + 2, true);
    at += 8;

    for (let index = 0; index < count; index++, at += 12) {
      const offset = view.getUint16(at, true) << shift;
      const length = view.getUint16(at + 2, true) << shift;

      if (offset + length > bytes.length) {
        continue;
      }

      if (type === RT_FONTDIR) {
        fontdir = offset;
      } else if (type !== 0x8008) {
        /* The other resource is the path of the `.TTF`, a string. Anything
         * else that is a plain string is read the same way and only the one
         * ending in `.TTF` is kept. */
        let text = '';

        for (let byte = offset; byte < offset + length && bytes[byte] !== 0; byte++) {
          text += String.fromCharCode(bytes[byte]);
        }

        if (/\.TTF$/i.test(text)) {
          path = text;
        }
      }
    }
  }

  if (fontdir === null || path === null) {
    return null;
  }

  // Count, ordinal, then the `FONTINFO` header; the two bytes wanted are at 85 and 90.
  const info = fontdir + 4;

  if (info + 113 > bytes.length) {
    return null;
  }

  /* Past the 113 bytes of the entry: the device's name, then the family,
   * full and style names, each ended with a nought. */
  const strings: string[] = [];
  let text = '';

  for (let at = info + 113; at < bytes.length && strings.length < 4; at++) {
    if (bytes[at]) {
      text += String.fromCharCode(bytes[at]);
    } else {
      strings.push(text);
      text = '';
    }
  }

  return {
    file: path.replace(/^.*[\\/]/, '').toUpperCase(),
    pitchAndFamily: bytes[info + 90],
    charSet: bytes[info + 85],
    flags: bytes[info + 67],
    sizeEM: view.getUint16(info + 68, true),
    ascent: view.getUint16(info + 74, true),
    externalLeading: view.getUint16(info + 78, true),
    maxWidth: view.getUint16(info + 93, true),
    cellHeight: view.getUint16(info + 88, true),
    avgWidth: view.getUint16(info + 91, true),
    weight: view.getUint16(info + 83, true),
    italic: bytes[info + 80],
    family: strings[1] ?? '',
    fullName: strings[2] ?? '',
    style: strings[3] ?? '',
  };
}
