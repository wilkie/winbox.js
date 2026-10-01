'use strict';

import { DevicePalette } from '../../raster/device-palette.js';
import { type PaletteEntries } from '../../raster/palette-colour.js';

import { type LogicalPalette } from './gdi-objects.js';

const PC_RESERVED = 0x01;
const PC_EXPLICIT = 0x02;
const PC_NOCOLLAPSE = 0x04;

/** The first and last slots between the static colours. */
const FIRST = 10;
const LAST = 245;

/**
 * The 256-colour display's system palette as programs realize their
 * palettes into it. **Recorded** by `palreal` and `paldib` on the Super VGA
 * 256-colour driver:
 *
 * * Realized in the foreground, a palette's colours take the slots between
 *   the static colours in order from 10, whatever was there: the driver's
 *   own `5f3f3f`, already at 10, is put at 12 when it is third. A colour
 *   that is one of the static colours is drawn as that, and takes no slot;
 *   a colour the palette has had already shares its slot, unless either is
 *   `PC_NOCOLLAPSE` or `PC_RESERVED`.
 * * Realized in the background, a palette's colours take the free slots
 *   after those the foreground took, and leave the foreground's alone.
 * * `RealizePalette` answers the palette's count of entries, or nought for a
 *   palette realized already.
 * * `AnimatePalette` changes a reserved entry's slot in place: a pixel drawn
 *   in it before reads back in the new colour.
 * * Where a slot changes colour, the top-level windows are sent
 *   `WM_PALETTECHANGED`; realizing again with nothing changed sends none.
 *
 * The slots are the screen's own palette, `DevicePalette.TWO_FIFTY_SIX`,
 * changed in place: a pixel is its slot, and is its slot's colour.
 */
export class SystemPalette {
  /** The palette each slot was taken for, or null for a free one. */
  readonly #owners: (LogicalPalette | null)[] = new Array(256).fill(null);

  constructor(readonly colours: DevicePalette) {
    colours.reset();
  }

  /**
   * A logical palette realized: each entry's slot kept on the palette, and
   * what `RealizePalette` answers, with whether a slot changed colour.
   */
  realize(palette: LogicalPalette, entries: PaletteEntries, foreground: boolean) {
    /* Realized already, and every slot it took still its own. */
    if (palette.slots && palette.taken?.every((slot) => this.#owners[slot] === palette)) {
      return { answer: 0, changed: false };
    }

    if (foreground) {
      this.#owners.fill(null);
    }

    const slots: number[] = [];
    const taken: number[] = [];
    let changed = false;
    let next = FIRST;
    const take = (red: number, green: number, blue: number) => {
      while (next <= LAST && this.#owners[next]) {
        next++;
      }

      if (next > LAST) {
        return this.colours.index(red, green, blue);
      }

      const [r, g, b] = this.colours.colours[next];

      if (r !== red || g !== green || b !== blue) {
        this.colours.recolour(next, red, green, blue);
        changed = true;
      }

      this.#owners[next] = palette;
      taken.push(next);

      return next++;
    };

    entries.forEach(([red, green, blue, flags], index) => {
      if (flags & PC_EXPLICIT) {
        slots.push((red | (green << 8)) & 0xff);
        return;
      }

      const own = flags & (PC_RESERVED | PC_NOCOLLAPSE);

      if (!own) {
        const fixed = DevicePalette.STATICS.find((at) =>
          same(this.colours.colours[at], red, green, blue)
        );

        if (fixed !== undefined) {
          slots.push(fixed);
          return;
        }

        /* One of this palette's before it, or in the background, any
         * slot of that colour. */
        const earlier = entries.findIndex(
          ([r, g, b, f], at) =>
            at < index &&
            !(f & (PC_RESERVED | PC_NOCOLLAPSE)) &&
            r === red &&
            g === green &&
            b === blue
        );

        if (earlier >= 0) {
          slots.push(slots[earlier]);
          return;
        }

        if (!foreground) {
          const held = this.#owners.findIndex(
            (owner, at) => owner && same(this.colours.colours[at], red, green, blue)
          );

          if (held >= 0) {
            slots.push(held);
            return;
          }
        }
      }

      slots.push(take(red, green, blue));
    });

    palette.slots = slots;
    palette.taken = taken;

    return { answer: entries.length, changed };
  }

  /** Reserved entries of a realized palette changed in place: their slots too. */
  animate(palette: LogicalPalette, start: number, colours: PaletteEntries) {
    const entries = palette.entries;

    if (!entries) {
      return;
    }

    colours.forEach(([red, green, blue, flags], at) => {
      const index = start + at;
      const entry = entries[index];

      if (!entry || !(entry[3] & PC_RESERVED)) {
        return;
      }

      entries[index] = [red, green, blue, flags];

      const slot = palette.slots?.[index];

      if (slot !== undefined && this.#owners[slot] === palette) {
        this.colours.recolour(slot, red, green, blue);
      }
    });
  }

  /** A palette deleted or unrealized: it holds its slots no longer. */
  release(palette: LogicalPalette) {
    palette.slots = null;
    palette.taken = null;
  }
}

function same([r, g, b]: [number, number, number], red: number, green: number, blue: number) {
  return r === red && g === green && b === blue;
}
