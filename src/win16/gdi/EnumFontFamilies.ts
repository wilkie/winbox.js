'use strict';

import { Struct, BYTE, CHARARRAY, DWORD, FARPTR, INT, UINT, LPARAM } from '../types.js';

import { GetDeviceCaps } from './GetDeviceCaps.js';

/**
 * The fonts a device context has, a family at a time, or a family's every
 * font by name: `EnumFontFamilies`.
 *
 * **Read out of `GDI.EXE`** (seg5 `01a7`, `0000`, `070f`, `07f5`), and
 * **recorded** by `enumfam` on four displays.
 *
 * GDI keeps two tables. The first holds the raster and vector fonts, each
 * size of each face an entry, in the order they were added: the three boot
 * fonts `SYSTEM.INI` names, then each `.FON` of `WIN.INI` `[fonts]`, each
 * file's sizes in its own order. The second holds the TrueType fonts, a
 * `.FOT` an entry, in `[fonts]` order.
 *
 * * **Every family**, no name given: the first table, a family's first entry
 *   standing for it -- less a raster family a TrueType one has the name of,
 *   so the raster Symbol goes -- then the second, a family's first file
 *   standing for it. Arial is its regular because `ARIAL.FOT` comes first.
 * * **By name**: every entry of the family, the raster sizes and then the
 *   TrueType styles, each in its table's order. `lfFaceName` is the name as
 *   the caller spelled it.
 *
 * What each is said to be:
 *
 * * **A raster or vector font**, from its header: `lfHeight` the pixel
 *   height, `lfWidth` the average width; precision 1 -- 3 for a vector font
 *   -- clipping 2, quality 1; `lfPitchAndFamily` the family and `FIXED_PITCH`
 *   or `VARIABLE_PITCH`, where the header's low bit is set for variable. The
 *   metrics are the header's, the default and break characters counted from
 *   the first; `tmPitchAndFamily` the header's with the font's type in bits
 *   1 and 2; the digitized aspect the header's resolutions, vertical first.
 *   The type is 1 for raster and 0 for vector.
 * * **A TrueType font**, at an em of 24 points at the device's resolution --
 *   32 pixels on the VGA, 24 tall and 32 across on the EGA: its stub's
 *   values scaled there, with
 *   `lfPitchAndFamily` the stub's family and `VARIABLE_PITCH`, and
 *   `tmPitchAndFamily` the stub's with 6 in. The full name and style are the
 *   stub's; `ntmFlags` the high byte of its `dfType` -- 40h regular, 20h
 *   bold, 1 italic -- and the em, the cell's height and the average width
 *   in font units. The type is 4.
 *
 * The answer is the last callback's; a callback answering nought stops
 * everything at once. Nothing matched answers 1, as it starts.
 *
 * Not followed: the mapping mode, whose units GDI would turn the sizes
 * into; the device's own fonts, which the screen drivers have none of; a
 * device context whose aspect does not match a raster font's; and the
 * compatibility flags that change what an old program is told.
 */

export class ENUMLOGFONT extends Struct {
  constructor() {
    super([
      ['lfHeight', INT],
      ['lfWidth', INT],
      ['lfEscapement', INT],
      ['lfOrientation', INT],
      ['lfWeight', INT],
      ['lfItalic', BYTE],
      ['lfUnderline', BYTE],
      ['lfStrikeOut', BYTE],
      ['lfCharSet', BYTE],
      ['lfOutPrecision', BYTE],
      ['lfClipPrecision', BYTE],
      ['lfQuality', BYTE],
      ['lfPitchAndFamily', BYTE],
      ['lfFaceName', CHARARRAY + 32],
      ['elfFullName', CHARARRAY + 64],
      ['elfStyle', CHARARRAY + 32],
    ]);
  }
}

export class NEWTEXTMETRIC extends Struct {
  constructor() {
    super([
      ['tmHeight', INT],
      ['tmAscent', INT],
      ['tmDescent', INT],
      ['tmInternalLeading', INT],
      ['tmExternalLeading', INT],
      ['tmAveCharWidth', INT],
      ['tmMaxCharWidth', INT],
      ['tmWeight', INT],
      ['tmItalic', BYTE],
      ['tmUnderlined', BYTE],
      ['tmStruckOut', BYTE],
      ['tmFirstChar', BYTE],
      ['tmLastChar', BYTE],
      ['tmDefaultChar', BYTE],
      ['tmBreakChar', BYTE],
      ['tmPitchAndFamily', BYTE],
      ['tmCharSet', BYTE],
      ['tmOverhang', INT],
      ['tmDigitizedAspectX', INT],
      ['tmDigitizedAspectY', INT],
      ['ntmFlags', DWORD],
      ['ntmSizeEM', UINT],
      ['ntmCellHeight', UINT],
      ['ntmAvgWidth', UINT],
    ]);
  }
}

const RASTER_FONTTYPE = 1;
const TRUETYPE_FONTTYPE = 4;
const LOGPIXELSX = 88;
const LOGPIXELSY = 90;

type Emit = (elf: ENUMLOGFONT, ntm: NEWTEXTMETRIC, type: number) => Promise<number>;

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/** A raster or vector font's entry, as its header says it is (seg5 `0000`). */
function fromHeader(entry: any, face: string) {
  const h = entry.header;
  const vector = (h.dfType & 1) === 1;

  /* A face called Symbol or ZapfDingbats is the symbol set, whatever its
   * header says: `AddFontResource` makes it so as it adds it (seg2 `0df4`).
   * The EGA's Symbol strikes say ANSI. */
  const charSet = /^(symbol|zapfdingbats)$/i.test(entry.name) ? 2 : h.dfCharSet;
  const elf: any = new ENUMLOGFONT();
  const ntm: any = new NEWTEXTMETRIC();

  elf.lfHeight = h.dfPixHeight;
  elf.lfWidth = h.dfAvgWidth;
  elf.lfEscapement = 0;
  elf.lfOrientation = 0;
  elf.lfWeight = h.dfWeight;
  elf.lfItalic = h.dfItalic;
  elf.lfUnderline = h.dfUnderline;
  elf.lfStrikeOut = h.dfStrikeOut;
  elf.lfCharSet = charSet;
  elf.lfOutPrecision = vector ? 3 : 1;
  elf.lfClipPrecision = 2;
  elf.lfQuality = 1;
  elf.lfPitchAndFamily = (h.dfPitchAndFamily & 0xf0) | ((h.dfPitchAndFamily & 1) + 1);
  elf.lfFaceName = face.slice(0, 31);
  elf.elfFullName = '';
  elf.elfStyle = '';

  ntm.tmHeight = h.dfPixHeight;
  ntm.tmAscent = h.dfAscent;
  ntm.tmDescent = h.dfPixHeight - h.dfAscent;
  ntm.tmInternalLeading = h.dfInternalLeading;
  ntm.tmExternalLeading = h.dfExternalLeading;
  ntm.tmAveCharWidth = h.dfAvgWidth;
  ntm.tmMaxCharWidth = h.dfMaxWidth;
  ntm.tmWeight = h.dfWeight;
  ntm.tmItalic = h.dfItalic;
  ntm.tmUnderlined = h.dfUnderline;
  ntm.tmStruckOut = h.dfStrikeOut;
  ntm.tmFirstChar = h.dfFirstChar;
  ntm.tmLastChar = h.dfLastChar;
  ntm.tmDefaultChar = (h.dfFirstChar + h.dfDefaultChar) & 0xff;
  ntm.tmBreakChar = (h.dfFirstChar + h.dfBreakChar) & 0xff;
  ntm.tmPitchAndFamily = (h.dfPitchAndFamily & 0xf1) | ((h.dfType & 3) << 1);
  ntm.tmCharSet = charSet;
  ntm.tmOverhang = 0;
  ntm.tmDigitizedAspectX = h.dfVertRes;
  ntm.tmDigitizedAspectY = h.dfHorizRes;
  ntm.ntmFlags = 0;
  ntm.ntmSizeEM = 0;
  ntm.ntmCellHeight = 0;
  ntm.ntmAvgWidth = 0;

  return { elf, ntm, type: vector ? 0 : RASTER_FONTTYPE };
}

/**
 * A TrueType font at the enumeration's em, from its stub alone (seg5 `07f5`):
 * the directory's values in font units, scaled to an em of 24 points
 * vertically and across and each rounded -- the descent as the rest of the
 * cell, rounded on its own, so the height is the two added. No font is
 * realised. **Recorded** by `enumfam`, 76 of 76 on four displays; the cell
 * rounded as a whole instead misses 30, and the realised font's metrics, which
 * `VDMX` settles, miss the EGA's ascent.
 */
function fromOutline(system: any, hdc: number, resource: any, face: string) {
  const logX = GetDeviceCaps.call(system, hdc, LOGPIXELSX);
  const logY = GetDeviceCaps.call(system, hdc, LOGPIXELSY);
  const round = (a: number, b: number, c: number) => Math.floor((a * b + (c >> 1)) / c);
  const emY = round(24, logY, 72);
  const emX = round(24, logX, 72);
  const units = resource.sizeEM || 2048;
  const ascent = round(resource.ascent, emY, units);
  const descent = round(resource.cellHeight - resource.ascent, emY, units);
  const elf: any = new ENUMLOGFONT();
  const ntm: any = new NEWTEXTMETRIC();

  elf.lfHeight = ascent + descent;
  elf.lfWidth = round(resource.avgWidth, emX, units);
  elf.lfEscapement = 0;
  elf.lfOrientation = 0;
  elf.lfWeight = resource.weight;
  elf.lfItalic = resource.italic;
  elf.lfUnderline = 0;
  elf.lfStrikeOut = 0;
  elf.lfCharSet = resource.charSet;
  elf.lfOutPrecision = 3;
  elf.lfClipPrecision = 2;
  elf.lfQuality = 1;
  elf.lfPitchAndFamily = ((resource.pitchAndFamily & 0xf1) + 1) & 0xff;
  elf.lfFaceName = face.slice(0, 31);
  elf.elfFullName = resource.fullName;
  elf.elfStyle = resource.style;

  ntm.tmHeight = ascent + descent;
  ntm.tmAscent = ascent;
  ntm.tmDescent = descent;
  ntm.tmInternalLeading = ascent + descent - emY;
  ntm.tmExternalLeading = round(resource.externalLeading, emY, units);
  ntm.tmAveCharWidth = elf.lfWidth;
  ntm.tmMaxCharWidth = round(resource.maxWidth, emX, units);
  ntm.tmWeight = resource.weight;
  ntm.tmItalic = resource.italic;
  ntm.tmUnderlined = 0;
  ntm.tmStruckOut = 0;

  /* The characters a TrueType font's information names (seg3 `21fb`). */
  ntm.tmFirstChar = 30;
  ntm.tmLastChar = 255;
  ntm.tmDefaultChar = 31;
  ntm.tmBreakChar = 32;
  ntm.tmPitchAndFamily = resource.pitchAndFamily | 6;
  ntm.tmCharSet = resource.charSet;
  ntm.tmOverhang = 0;
  ntm.tmDigitizedAspectX = logY;
  ntm.tmDigitizedAspectY = logX;
  ntm.ntmFlags = resource.flags;
  ntm.ntmSizeEM = resource.sizeEM;
  ntm.ntmCellHeight = resource.cellHeight;
  ntm.ntmAvgWidth = resource.avgWidth;

  return { elf, ntm, type: TRUETYPE_FONTTYPE };
}

/** Walks the two tables, handing each font chosen to `emit`, as seg5 `01a7` does. */
export async function enumerateFamilies(system: any, hdc: number, name: string | null, emit: Emit) {
  const fonts = system.fonts;
  const directory: any[] = fonts.trueTypeDirectory ?? [];
  const trueTypeNamed = (face: string) =>
    directory.some((resource) => same(resource.family, face) || same(resource.fullName, face));
  let result = 1;

  if (name !== null && !fonts.listedEntries().some((entry: any) => same(entry.name, name)) && !trueTypeNamed(name)) {
    return 1;
  }

  /* The raster and vector table. */
  const seen = new Set<string>();

  for (const entry of fonts.listedEntries()) {
    const face = entry.name;
    const raster = (entry.header.dfType & 1) === 0;

    if (name === null) {
      if (raster && trueTypeNamed(face)) {
        continue;
      }

      if (seen.has(face.toUpperCase())) {
        continue;
      }

      seen.add(face.toUpperCase());
    } else if (!same(face, name)) {
      continue;
    }

    const { elf, ntm, type } = fromHeader(entry, name ?? face);

    result = await emit(elf, ntm, type);

    if (!result) {
      return 0;
    }
  }

  /* The TrueType directory. */
  let called = false;
  let answer = 1;
  const families = new Set<string>();

  for (const resource of directory) {
    if (name === null) {
      if (families.has(resource.family.toUpperCase())) {
        continue;
      }

      families.add(resource.family.toUpperCase());
    } else if (!same(resource.family, name) && !same(resource.fullName, name)) {
      continue;
    }

    const { elf, ntm, type } = fromOutline(system, hdc, resource, name ?? resource.family);

    called = true;
    answer = await emit(elf, ntm, type);

    if (!answer) {
      return 0;
    }
  }

  return called ? answer : result;
}

export async function EnumFontFamilies(
  this: any,
  hdc: number,
  lpszFamily: any,
  lpEnumProc: any,
  lParam: number
) {
  const name = lpszFamily ? String(lpszFamily) : null;

  return enumerateFamilies(this, hdc, name, async (elf, ntm, type) => {
    if (typeof lpEnumProc === 'function') {
      return lpEnumProc(elf, ntm, type, lParam);
    }

    const answer = await this.scheduler.callProc(lpEnumProc, [
      [[elf], FARPTR],
      [[ntm], FARPTR],
      [type, INT],
      [lParam >>> 0, LPARAM],
    ]);

    return ((answer & 0xffff) << 16) >> 16;
  });
}
