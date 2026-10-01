'use strict';

import { DevicePalette } from '../../raster/device-palette.js';
import { DEFAULT_ENTRIES, type PaletteEntries } from '../../raster/palette-colour.js';

import { defaultPalette, LogicalPalette } from './gdi-objects.js';
import { type SystemPalette } from './system-palette.js';
import { SendMessage } from '../user/SendMessage.js';

const WM_PALETTECHANGED = 0x0311;

/**
 * Logical palettes, on displays whose colours are fixed.
 *
 * **Recorded** by `palette` on the VGA, the EGA, the Super VGA and the
 * Hercules, none of which has `RC_PALETTE`:
 *
 * * A palette keeps its entries as they were given, flags and all.
 *   `GetObject` answers its count in a word. `GetPaletteEntries` and
 *   `SetPaletteEntries` answer how many entries they read or wrote, stopping
 *   at the palette's end. `ResizePalette` answers 1; the entries it adds are
 *   whatever memory held, and are not recorded.
 * * `GetNearestPaletteIndex` answers the entry nearest in red, green and
 *   blue, squared, the first of equals.
 * * `SelectPalette` answers the palette the device context had, the stock
 *   one to begin with. `RealizePalette` answers nought: nothing to realize.
 * * `GetSystemPaletteEntries` answers the display's own colours, as many as
 *   it has, flags nought: sixteen, or the Hercules's two.
 * * `GetSystemPaletteUse` and `SetSystemPaletteUse` answer nought.
 *
 * What a colour given as a palette index draws as is `colourOf`.
 */

function paletteOf(system: any, handle: number): LogicalPalette | null {
  const palette = system.handles.resolve(handle);

  return palette instanceof LogicalPalette ? palette : null;
}

/** The entries of a palette, the stock one's if it has none of its own. */
export function entriesOf(palette: LogicalPalette): PaletteEntries {
  return palette.entries ?? DEFAULT_ENTRIES;
}

function readEntries(system: any, far: number, count: number): PaletteEntries {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;
  const entries: PaletteEntries = [];

  for (let i = 0; i < count; i++) {
    const at = (offset + i * 4) & 0xffff;

    entries.push(
      [0, 1, 2, 3].map((k) => core.read8(segment, (at + k) & 0xffff)) as [
        number,
        number,
        number,
        number,
      ]
    );
  }

  return entries;
}

function writeEntries(system: any, far: number, entries: PaletteEntries) {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  entries.forEach((entry, i) =>
    entry.forEach((value, k) => core.write8(segment, (offset + i * 4 + k) & 0xffff, value & 0xff))
  );
}

/**
 * A palette of the entries a `LOGPALETTE` gives: its version, its count,
 * and the entries.
 *
 * @param {Types.FARPTR} lpLogPalette - The `LOGPALETTE`.
 *
 * @returns {Types.HANDLE} The palette.
 */
export function CreatePalette(this: any, lpLogPalette: number) {
  if (!lpLogPalette) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const count = core.read16((lpLogPalette >>> 16) & 0xffff, ((lpLogPalette & 0xffff) + 2) & 0xffff);
  const palette = new LogicalPalette();

  palette.entries = readEntries(this, (lpLogPalette + 4) >>> 0, count);

  return this.handles.allocate(palette) ?? 0;
}

/** @returns {Types.UINT} How many entries were read, into `lppe`. */
export function GetPaletteEntries(
  this: any,
  hpal: number,
  iStart: number,
  cEntries: number,
  lppe: number
) {
  const palette = paletteOf(this, hpal);

  if (!palette) {
    return 0;
  }

  const entries = entriesOf(palette).slice(iStart, iStart + cEntries);

  writeEntries(this, lppe, entries);

  return entries.length;
}

/** @returns {Types.UINT} How many entries were written, from `lppe`. */
export function SetPaletteEntries(
  this: any,
  hpal: number,
  iStart: number,
  cEntries: number,
  lppe: number
) {
  const palette = paletteOf(this, hpal);

  if (!palette) {
    return 0;
  }

  const entries = [...entriesOf(palette)];
  const count = Math.max(0, Math.min(cEntries, entries.length - iStart));

  readEntries(this, lppe, count).forEach((entry, i) => (entries[iStart + i] = entry));
  palette.entries = entries;

  return count;
}

/** @returns {Types.BOOL} 1: the palette made that long. */
export function ResizePalette(this: any, hpal: number, nEntries: number) {
  const palette = paletteOf(this, hpal);

  if (!palette) {
    return 0;
  }

  const entries = entriesOf(palette).slice(0, nEntries);

  while (entries.length < nEntries) {
    entries.push([0, 0, 0, 0]);
  }

  palette.entries = entries;

  return 1;
}

/** @returns {Types.UINT} The entry nearest a colour. */
export function GetNearestPaletteIndex(this: any, hpal: number, crColor: number) {
  const palette = paletteOf(this, hpal);

  if (!palette) {
    return 0;
  }

  const [r, g, b] = [crColor & 0xff, (crColor >>> 8) & 0xff, (crColor >>> 16) & 0xff];
  let best = 0;
  let distance = Infinity;

  entriesOf(palette).forEach(([er, eg, eb], index) => {
    const d = (er - r) ** 2 + (eg - g) ** 2 + (eb - b) ** 2;

    if (d < distance) {
      distance = d;
      best = index;
    }
  });

  return best;
}

/** @returns {Types.HANDLE} The palette the device context had. */
export function SelectPalette(this: any, hdc: number, hpal: number, bForceBackground: number) {
  const surface = this.handles.resolve(hdc);
  const palette = paletteOf(this, hpal);

  if (!surface || !palette) {
    return 0;
  }

  const before = surface.palette ? this.handles.lookup(surface.palette) : defaultPalette(this);

  surface.palette = palette;

  /* Kept by the device context's handle, not its surface: two of a window's
   * are one surface here, and a palette selected into one for the background
   * leaves the other's as it was (`palreal`). */
  (this._paletteBackground ??= new Map<number, boolean>()).set(hdc & 0xffff, !!bForceBackground);

  return before ?? 0;
}

/**
 * Nought on a display with fixed colours, or into a memory device context.
 * On the 256-colour display, the palette realized into the system palette
 * (`system-palette.ts`): in the foreground unless it was selected for the
 * background or its window is not the active one or in it, and where a slot
 * changed colour, the top-level windows are sent `WM_PALETTECHANGED`
 * (`palreal`).
 *
 * @returns {Types.UINT} The palette's entries realized, or nought.
 */
export async function RealizePalette(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);
  const system: SystemPalette | null = this.systemPalette;
  const palette: LogicalPalette | undefined = surface?.palette;

  if (!system || !surface || surface.memoryContext || !palette?.entries) {
    return 0;
  }

  const desktop = this.rasterDesktop;
  const window = desktop?.windows.find(
    (w: any) => this.handles.resolve(w.hwnd)?.surface === surface
  );
  const active = desktop?.active;
  let inActive = !window;

  for (let at = window; at && !inActive; at = at.parent) {
    inActive = at === active;
  }

  const background = this._paletteBackground?.get(hdc & 0xffff) ?? false;
  const { answer, changed } = system.realize(palette, palette.entries, !background && inActive);

  if (changed && desktop) {
    for (const top of desktop.windows.filter((w: any) => !w.parent && w.hwnd)) {
      await SendMessage.call(this, top.hwnd, WM_PALETTECHANGED, window?.hwnd ?? 0, 0);
    }
  }

  return answer;
}

/**
 * A palette's reserved entries changed, and on the 256-colour display, if it
 * is realized, their slots of the system palette with them: what is drawn
 * in them changes colour (`palreal`).
 */
export function AnimatePalette(
  this: any,
  hpal: number,
  iStart: number,
  cEntries: number,
  lppe: number
) {
  const palette = paletteOf(this, hpal);

  if (!palette?.entries || !lppe) {
    return;
  }

  const entries = readEntries(this, lppe, cEntries);

  if (this.systemPalette) {
    this.systemPalette.animate(palette, iStart, entries);
    this.rasterDesktop?.screen?.context?.markRect?.(0, 0, this.display.width, this.display.height);
  } else {
    entries.forEach((entry, at) => {
      if (palette.entries![iStart + at] && palette.entries![iStart + at][3] & 0x01) {
        palette.entries![iStart + at] = entry;
      }
    });
  }
}

/** @returns {Types.UINT} How many of the display's own colours were read. */
export function GetSystemPaletteEntries(
  this: any,
  hdc: number,
  iStart: number,
  cEntries: number,
  lppe: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const colours = DevicePalette.forDisplay(this.display).colours;
  const entries: PaletteEntries = colours
    .slice(iStart, iStart + cEntries)
    .map(([r, g, b]) => [r, g, b, 0]);

  writeEntries(this, lppe, entries);

  return entries.length;
}

/**
 * Nought on a display with fixed colours. On the 256-colour display, how
 * the static colours are used: `SYSPAL_STATIC`, 1, until set otherwise
 * (`palette`).
 *
 * @returns {Types.UINT} The use.
 */
export function GetSystemPaletteUse(this: any, _hdc: number) {
  return this.systemPalette ? (this._systemPaletteUse ?? 1) : 0;
}

/**
 * Nought on a display with fixed colours. On the 256-colour display, the use
 * set, and the one before answered (`palette`). What `SYSPAL_NOSTATIC` does
 * to the static colours is not followed.
 *
 * @returns {Types.UINT} The use before.
 */
export function SetSystemPaletteUse(this: any, _hdc: number, wUsage: number) {
  if (!this.systemPalette) {
    return 0;
  }

  const before = this._systemPaletteUse ?? 1;

  this._systemPaletteUse = wUsage;

  return before;
}
