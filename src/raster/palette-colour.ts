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
/**
 * A logical palette realized on a palette device, into which `surface` draws:
 * its entries and each one's slot of the system palette, or null.
 */
function realizedFor(surface: any) {
  const palette = surface?.palette;

  return palette?.slots && palette.entries && surface?.bitmap?.devicePalette?.size === 256
    ? { entries: palette.entries as PaletteEntries, slots: palette.slots as number[] }
    : null;
}

/** The entry of `entries` nearest a colour, by the sum of the squares, the first of equals. */
export function nearestEntry(entries: PaletteEntries, red: number, green: number, blue: number) {
  let best = 0;
  let distance = Infinity;

  entries.forEach(([r, g, b], index) => {
    const d = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;

    if (d < distance) {
      distance = d;
      best = index;
    }
  });

  return best;
}

/**
 * The slot a colour of a picture is drawn in, where `surface` has a palette
 * realized on a palette device: its nearest entry's (`paldib`: a DIB's
 * colours, and WinG's, come out as the realized palette's nearest), or null.
 */
export function realizedMatch(surface: any) {
  const realized = realizedFor(surface);

  return realized
    ? (red: number, green: number, blue: number) =>
        realized.slots[nearestEntry(realized.entries, red, green, blue)]
    : null;
}

/** A colour that names its slot of the system palette, drawn solid there. */
function inSlot(colour: Color, slot: number) {
  (colour as any).slot = slot;

  return colour;
}

export function colourOf(clrref: number, surface: any): Color {
  const kind = (clrref >>> 24) & 0xff;
  const realized = realizedFor(surface);

  /* With a palette realized on a palette device, an index is its entry's
   * slot, and a `PALETTERGB` its nearest entry's (`palreal`). */
  if (realized && kind === 1) {
    const at = realized.entries[clrref & 0xffff] ? clrref & 0xffff : 0;
    const [r, g, b] = realized.entries[at];

    return inSlot(new Color(r, g, b), realized.slots[at]);
  }

  if (realized && kind === 2) {
    const at = nearestEntry(
      realized.entries,
      clrref & 0xff,
      (clrref >>> 8) & 0xff,
      (clrref >>> 16) & 0xff
    );
    const [r, g, b] = realized.entries[at];

    return inSlot(new Color(r, g, b), realized.slots[at]);
  }

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
