'use strict';

import { Color } from './color.js';

/** A logical palette's entries: red, green, blue and flags. */
export type PaletteEntries = [number, number, number, number][];

/**
 * The stock `DEFAULT_PALETTE`'s twenty entries, as `GetPaletteEntries`
 * answers them. **Recorded** by `palette` on four displays, the same on
 * each: the sixteen colours in pairs about four more.
 */
export const DEFAULT_ENTRIES: PaletteEntries = [
  [0x00, 0x00, 0x00, 0],
  [0x80, 0x00, 0x00, 0],
  [0x00, 0x80, 0x00, 0],
  [0x80, 0x80, 0x00, 0],
  [0x00, 0x00, 0x80, 0],
  [0x80, 0x00, 0x80, 0],
  [0x00, 0x80, 0x80, 0],
  [0xc0, 0xc0, 0xc0, 0],
  [0xc0, 0xdc, 0xc0, 0],
  [0xa6, 0xca, 0xf0, 0],
  [0xff, 0xfb, 0xf0, 0],
  [0xa0, 0xa0, 0xa4, 0],
  [0x80, 0x80, 0x80, 0],
  [0xff, 0x00, 0x00, 0],
  [0x00, 0xff, 0x00, 0],
  [0xff, 0xff, 0x00, 0],
  [0x00, 0x00, 0xff, 0],
  [0xff, 0x00, 0xff, 0],
  [0x00, 0xff, 0xff, 0],
  [0xff, 0xff, 0xff, 0],
];

const PC_EXPLICIT = 0x02;

/** Whether a `COLORREF` is a palette's: `PALETTEINDEX` or `PALETTERGB`. */
export function isPaletteRef(clrref: number) {
  const kind = (clrref >>> 24) & 0xff;

  return kind === 1 || kind === 2;
}

/**
 * The colour a `COLORREF` stands for in a device context. **Recorded** by
 * `palette`, on displays whose colours are fixed:
 *
 * * `PALETTEINDEX(n)` is entry `n` of the palette selected into it -- the
 *   stock palette if none is -- and entry 0 for an index past the end. An
 *   entry with `PC_EXPLICIT` is the device's own colour its low word names,
 *   kept to the device's colours: `01 02 03` is the VGA's colour 1, dark
 *   red. On the Hercules it is the entry's own colour, black: fitted to that
 *   one case, why not known.
 * * `PALETTERGB` is the colour itself, as a plain `RGB`.
 *
 * Anything else is the colour itself.
 */
export function colourOf(clrref: number, surface: any): Color {
  const kind = (clrref >>> 24) & 0xff;

  if (kind === 1) {
    const entries: PaletteEntries = surface?.palette?.entries ?? DEFAULT_ENTRIES;
    const entry = entries[clrref & 0xffff] ?? entries[0];

    if (entry && entry[3] & PC_EXPLICIT) {
      const device: [number, number, number][] = surface?.bitmap?.devicePalette?.colours ?? [];
      const own = device.length > 2 ? device[(entry[0] | (entry[1] << 8)) % device.length] : null;

      if (own) {
        return new Color(own[0], own[1], own[2]);
      }
    }

    return entry ? new Color(entry[0], entry[1], entry[2]) : new Color(0, 0, 0);
  }

  return new Color(clrref & 0xff, (clrref >>> 8) & 0xff, (clrref >>> 16) & 0xff);
}
