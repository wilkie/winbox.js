'use strict';

import { DevicePalette } from '../../raster/device-palette.js';
import { DEFAULT_ENTRIES, type PaletteEntries } from '../../raster/palette-colour.js';

import { defaultPalette, LogicalPalette } from './gdi-objects.js';
import { type SystemPalette } from './system-palette.js';
import { SendMessage } from '../user/SendMessage.js';
import { gdiDataSelector } from './gdi-data.js';
import {
  realizePaletteInMetafile,
  resizeInMetafiles,
  selectPaletteInMetafile,
} from './metafile.js';

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

  /* Kept in each metafile being recorded that holds it (`metafile.ts`). */
  resizeInMetafiles(this, hpal & 0xffff, nEntries & 0xffff);

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

/** A device context's palette's handle: the stock one's where none was selected. */
function paletteHandleOf(system: any, surface: any): number {
  return surface.palette ? (system.handles.lookup(surface.palette) ?? 0) : defaultPalette(system);
}

/** The window whose surface a device context draws on, where it is one's. */
function windowOf(system: any, surface: any) {
  return system.rasterDesktop?.windows.find(
    (w: any) => system.handles.resolve(w.hwnd)?.surface === surface
  );
}

/**
 * GDI's palettes, as `GDI.EXE` keeps them in its data segment: the palette
 * last selected in the foreground, `[480h]`, and the one last realized,
 * `[482h]` (seg22 `0271`, `1088`).
 */
interface PaletteState {
  foreground: number;
  realized: number;
}

function stateOf(system: any): PaletteState {
  return (system._paletteState ??= { foreground: 0, realized: 0 });
}

/**
 * Selects a palette into a device context, for the foreground or the
 * background. **Read out** of `GDI.EXE` seg22 `0271`: the palette before
 * answered; a palette selected for the foreground, and not the one there
 * already, becomes GDI's foreground palette, and no palette is then the one
 * realized last. **Recorded** by `dcinner`.
 *
 * @returns {Types.HPALETTE} The palette the device context had.
 */
export function GDISelectPalette(this: any, hdc: number, hpal: number, wBackground: number) {
  /* A metafile's context keeps it, and answers 1 (`metafile.ts`). */
  const kept = selectPaletteInMetafile(this, hdc, hpal);

  if (kept !== null) {
    return kept;
  }

  const surface = this.handles.resolve(hdc);
  const palette = paletteOf(this, hpal);

  if (!surface || !palette) {
    return 0;
  }

  const before = paletteHandleOf(this, surface);
  const state = stateOf(this);

  surface.palette = palette;

  if (!wBackground && (hpal & 0xffff) !== state.foreground) {
    state.foreground = hpal & 0xffff;
    state.realized = 0;
  }

  return before;
}

/**
 * USER's `SelectPalette`. **Read out** of `USER.EXE` seg6 `00a2`: a palette
 * is selected for the background when asked, when it is the stock one, and
 * when the device context is no window's, or the window is neither the
 * active one nor in it; then GDI's `GDISelectPalette` (`dcinner`,
 * `palreal`).
 *
 * @returns {Types.HANDLE} The palette the device context had.
 */
export function SelectPalette(this: any, hdc: number, hpal: number, bForceBackground: number) {
  const surface = this.handles.resolve(hdc);

  let background = 1;

  if (surface && !bForceBackground && (hpal & 0xffff) !== defaultPalette(this)) {
    const active = this.rasterDesktop?.active;

    for (let at = windowOf(this, surface); at && background; at = at.parent) {
      if (at === active) {
        background = 0;
      }
    }
  }

  return GDISelectPalette.call(this, hdc, hpal, background);
}

/**
 * Realizes a device context's palette into the system palette. **Read
 * out** of `GDI.EXE` seg22 `1088` and `0cfb`: nought on a display with
 * fixed colours, and for the palette realized last; otherwise it becomes
 * that, and is realized in the foreground if it is GDI's foreground palette,
 * else in the background (`system-palette.ts`). The answer is how many of
 * its entries are in a slot they were not in, and above it how many slots
 * were given a colour. **Recorded** by `dcinner`: a memory context's
 * palette is realized as any other's.
 *
 * @returns {Types.DWORD} The entries moved, and above them the slots written.
 */
export function GDIRealizePalette(this: any, hdc: number) {
  /* A metafile's context keeps it, and answers 1 (`metafile.ts`). */
  const kept = realizePaletteInMetafile(this, hdc);

  if (kept !== null) {
    return kept;
  }

  const surface = this.handles.resolve(hdc);
  const system: SystemPalette | null = this.systemPalette;
  const palette: LogicalPalette | undefined = surface?.palette;

  if (!system || !surface || !palette?.entries) {
    return 0;
  }

  const state = stateOf(this);
  const handle = paletteHandleOf(this, surface);

  if (handle === state.realized) {
    return 0;
  }

  state.realized = handle;

  const { answer, written } = system.realize(palette, palette.entries, handle === state.foreground);

  return ((answer & 0xffff) | ((written & 0xffff) << 16)) >>> 0;
}

/**
 * USER's `RealizePalette`. **Read out** of `USER.EXE` seg6 `0134`: GDI's
 * `GDIRealizePalette`, and where it gave a slot a colour and the palette is
 * GDI's foreground palette, the top-level windows are sent
 * `WM_PALETTECHANGED` with the device context's window (`palreal`).
 *
 * @returns {Types.UINT} The palette's entries realized, or nought.
 */
export async function RealizePalette(this: any, hdc: number) {
  const answer = GDIRealizePalette.call(this, hdc);
  const surface = this.handles.resolve(hdc);
  const desktop = this.rasterDesktop;
  const window = surface ? windowOf(this, surface) : null;

  if (answer >>> 16 && IsDCCurrentPalette.call(this, hdc) && window && desktop) {
    for (const top of desktop.windows.filter((w: any) => !w.parent && w.hwnd)) {
      await SendMessage.call(this, top.hwnd, WM_PALETTECHANGED, window.hwnd ?? 0, 0);
    }
  }

  return answer & 0xffff;
}

/**
 * Whether a device context's palette is GDI's foreground palette. **Read
 * out** of seg22 `0b0c`: the palette's handle compared, not the context's;
 * no palette is GDI's foreground palette until one is selected for it.
 * **Recorded** by `dcinner`.
 *
 * @returns {Types.BOOL} Whether it is.
 */
export function IsDCCurrentPalette(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  return paletteHandleOf(this, surface) === stateOf(this).foreground ? 1 : 0;
}

/**
 * Realizes the stock palette. **Read out** of seg22 `101d`: on a display
 * with a palette, every slot between the static colours is freed, keeping
 * its colour, the stock palette becomes GDI's foreground palette and the one
 * realized last, and the answer is nought; on one with fixed colours
 * nothing is done, and the answer is what AX held, GDI's data segment.
 * **Recorded** by `dcinner`. DX is nought on the 256-colour display, the
 * realization's count of slots.
 *
 * @returns {Types.DWORD} Nought, or GDI's data segment.
 */
export function RealizeDefaultPalette(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);
  const system: SystemPalette | null = this.systemPalette;

  if (!system) {
    return gdiDataSelector(this);
  }

  if (!surface) {
    return 0;
  }

  const state = stateOf(this);

  system.freeAll();
  state.foreground = defaultPalette(this);
  state.realized = state.foreground;

  return 0;
}

/**
 * Redraws a device context's area for its palette's realization.
 * **Read out** of seg22 `0109` and `0773`: on a display with a palette the
 * driver's `UpdateColors` is given each rectangle of the visible region and
 * a table from each of the palette's old slots to its new; the answer is
 * nought either way. **Recorded** by `dcinner`. The redrawing is not
 * followed.
 *
 * @returns {Types.INT} Nought.
 */
export function UpdateColors(this: any, _hdc: number) {
  return 0;
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

  if (wUsage !== 2) {
    this.systemPalette.restoreStatics();
  }

  return before;
}
