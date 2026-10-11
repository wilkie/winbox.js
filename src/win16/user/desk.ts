'use strict';

import { readProfile, toInteger } from '../kernel/profiles.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { LogicalPalette } from '../gdi/gdi-objects.js';
import { type DeviceBitmap } from '../../raster/device-bitmap.js';
import { type Dib, decodeDib, dibToDevice } from '../../raster/dib.js';
import { nearestEntry } from '../../raster/palette-colour.js';

/**
 * The desktop's pattern and wallpaper, as USER makes them of `WIN.INI`'s
 * `[Desktop]` and the files named there; `desktop.ts` paints them. The Rust
 * engine's `system_parameters.rs` is the same. **Read out** of `USER.EXE`,
 * and **recorded** by `deskwall` and `deskbrsh` on every display.
 */

const DESKTOP = 'Desktop';

/**
 * The wallpaper as USER keeps it (seg45): the bitmap made of its file
 * (`[89Ah]`), of the display's depth, or of a bit a pixel for a file of a
 * bit a pixel; whether it is tiled (bit 0 of `[9A6h]`) and from where on the
 * screen (`[996h]`, `[998h]`); and on a display with a palette, the palette
 * made of its colours (`[7A8h]`).
 */
export interface Wallpaper {
  bitmap: DeviceBitmap;
  tile: boolean;
  origin: [number, number];
  palette: number;
}

/** What of the desktop is kept with the settings (`system-parameters.ts`). */
export interface Desk {
  /** The pattern's eight rows, a bit a pixel, the leftmost the highest (`[5ECh]`'s bitmap); null for none. */
  pattern: number[] | null;
  wallpaper: Wallpaper | null;
}

/**
 * A pattern's text read as USER reads it (seg41 `0b2d`-`0b82`): sixteen
 * numbers, each the digits after any characters that are not, accumulated
 * in a word, nought where the text has run out; their low bytes the rows of
 * a bitmap 16 by 16 of a bit a pixel (`0b91`), of which the brush takes the
 * first eight. The characters are compared as signed bytes, so none past
 * 7Fh is a digit.
 */
export function patternRows(text: string): number[] {
  const digit = (at: number) => at < text.length && text[at] >= '0' && text[at] <= '9';
  const rows: number[] = [];
  let at = 0;

  for (let row = 0; row < 8; row++) {
    while (at < text.length && !digit(at)) {
      at++;
    }

    let value = 0;

    while (digit(at)) {
      value = (value * 10 + (text.charCodeAt(at) - 0x30)) & 0xffff;
      at++;
    }

    rows.push(value & 0xff);
  }

  return rows;
}

/**
 * The pattern made (seg41 `0a61`): `[Desktop]`'s `Pattern` where the action
 * names none, of which none fails, and which is no pattern -- the desktop a
 * brush of its colour alone -- where it is "(None)" in any case (`0b1b`); a
 * text given, or none, empty, is no pattern too. Any other text given is
 * read as numbers, "(None)" itself among them: USER compares it with a
 * buffer it filled only on the way through `WIN.INI` (`0aea`-`0afd`), so it
 * is the eight rows of noughts, and the brush is a pattern all of
 * `COLOR_BACKGROUND`, undithered (`deskwall`, `deskbrsh`). Whether it was
 * taken.
 */
export async function setPattern(
  system: any,
  desk: Desk,
  fromProfile: boolean,
  given: string | null
) {
  let pattern = given;

  if (fromProfile) {
    pattern = (await readProfile(system, 'WIN.INI')).get(DESKTOP, 'Pattern', true);

    if (!pattern) {
      return false;
    }

    if (pattern.toUpperCase() === '(NONE)') {
      pattern = null;
    }
  }

  desk.pattern = pattern ? patternRows(pattern) : null;
  return true;
}

/**
 * The wallpaper loaded (seg21 `04d2`). The one kept is let go first, its
 * palette with it, whatever comes of the rest. Then the name given, else
 * `[Desktop]`'s `Wallpaper`, of which none fails; "(None)", in any case, is
 * none and does. Else `TileWallpaper` (1 where there is none) and
 * `WallpaperStyle` are read, and the file loaded (`wallpaperOf`): one that
 * is not there or not a bitmap fails, and leaves none. Then
 * `WallpaperOriginX` and `Y`: not tiled, an origin of nought is the one that
 * centres the bitmap, half of what the screen leaves around it, toward
 * nought (`064a`-`0688`). Whether it was taken.
 */
export async function setWallpaper(system: any, desk: Desk, given: string | null) {
  if (desk.wallpaper?.palette) {
    DeleteObject.call(system, desk.wallpaper.palette);
  }

  desk.wallpaper = null;

  let name = given;

  if (name === null) {
    name = (await readProfile(system, 'WIN.INI')).get(DESKTOP, 'Wallpaper', true);

    if (!name) {
      return false;
    }
  }

  if (name.toUpperCase() === '(NONE)') {
    return true;
  }

  const files = system.dos.files;
  const handle =
    (await files.open(name)) ??
    (/[\\/:]/.test(name) ? null : await files.open(`C:\\WINDOWS\\${name}`));

  if (!handle) {
    return false;
  }

  let bytes: Uint8Array;

  try {
    const file = files.resolve(handle);

    bytes = file ? new Uint8Array(await file.read(0, file.size)) : new Uint8Array(0);
  } finally {
    files.close(handle);
  }

  const profile = await readProfile(system, 'WIN.INI');
  const number = (key: string, fallback: number) =>
    toInteger(profile.get(DESKTOP, key, false), fallback) & 0xffff;
  const style = number('TileWallpaper', 1) | number('WallpaperStyle', 0);
  const made = wallpaperOf(system, bytes, !(style & 4));

  if (!made) {
    return false;
  }

  const tile = (style & 1) !== 0;
  const origin: [number, number] = [
    (number('WallpaperOriginX', 0) << 16) >> 16,
    (number('WallpaperOriginY', 0) << 16) >> 16,
  ];

  if (!tile) {
    const { width, height } = system.screen.bitmap;

    origin[0] ||= Math.trunc((width - made.bitmap.width) / 2);
    origin[1] ||= Math.trunc((height - made.bitmap.height) / 2);
  }

  desk.wallpaper = { bitmap: made.bitmap, tile, origin, palette: made.palette };
  return true;
}

/**
 * The palette USER makes a wallpaper of 24 bits or more (seg21
 * `00d3`-`0118`): 256 entries, the red stepping by 20h, then the green by 20h
 * as the red comes round, then the blue by 40h.
 */
function deskCube(): [number, number, number][] {
  return Array.from({ length: 256 }, (_, n) => [(n & 7) << 5, ((n >> 3) & 7) << 5, (n >> 6) << 6]);
}

/**
 * A bitmap's file made a bitmap of the screen's (seg21 `0131`): `BM` in its
 * first fourteen bytes, and from the fifteenth its header and colours -- a
 * header of 12 bytes is the old form, with colours of three bytes -- and its
 * bits from where the first fourteen say. One of a bit a pixel is made a
 * monochrome bitmap (`CreateBitmap`), any other one of the screen's
 * (`CreateCompatibleBitmap`), the colours matched as `SetDIBits` matches
 * them. On a display with a palette, unless asked not to, a palette is made
 * of its colours first (seg21 `0000`) -- the colour table, as many as
 * `biClrUsed` says or the bits allow, which for 16 bits is 1 << 16 in a word,
 * none; for 24 bits or more, 256 of a cube of eight reds, eight greens and
 * four blues (`00d3`-`0118`) -- and realized: as the desktop's, in the
 * background, for the desktop is never the active window (seg6 `00a2`), no
 * window told; and the colours are matched to their nearest entries' slots.
 *
 * USER looks at neither the bit count nor what `SetDIBits` answers (`030f`):
 * a bit count the display driver does not take -- 16 or 32 bits
 * (`deskdeep`) -- is a bitmap made and nothing set into it. Windows shows
 * what its memory held before; here it is as a new bitmap is, black. Null
 * for a file that is not a bitmap this reads.
 */
function wallpaperOf(system: any, bytes: Uint8Array, withPalette: boolean) {
  if (bytes.length < 18 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bitsAt = view.getUint32(10, true);
  const header = view.getUint32(14, true);
  const core = header === 12;

  if (bytes.length < 14 + (core ? 12 : 40)) {
    return null;
  }

  const bitCount = view.getUint16(14 + (core ? 10 : 14), true);
  const used = core ? 0 : view.getUint32(14 + 32, true);
  const colours = bitCount < 24 ? used || 1 << bitCount : 0;
  const table = header + colours * (core ? 3 : 4);
  const head = bytes.subarray(14, Math.min(14 + table, bytes.length));
  const bits = bytes.subarray(Math.min(bitsAt, bytes.length));
  const dibBytes = new Uint8Array(head.length + bits.length);

  dibBytes.set(head, 0);
  dibBytes.set(bits, head.length);

  let dib: Dib;

  try {
    dib = decodeDib(dibBytes);
  } catch {
    if (bitCount <= 8 || bitCount === 24) {
      return null;
    }

    /* Made, and nothing set: no colours, no pixels. */
    dib = {
      width: core ? view.getUint16(18, true) : view.getInt32(18, true),
      height: Math.abs(core ? view.getInt16(20, true) : view.getInt32(22, true)),
      bitCount,
      colours: [],
      pixels: new Uint8Array(0),
    };
  }

  if (bitCount === 1) {
    return { bitmap: dibToDevice(dib, 1), palette: 0 };
  }

  const screen: DeviceBitmap = system.screen.bitmap;
  const realizer = withPalette ? system.systemPalette : null;
  let palette = 0;
  let realized: ((red: number, green: number, blue: number) => number) | null = null;

  if (realizer) {
    const logical = new LogicalPalette();
    const entries = (bitCount >= 24 ? deskCube() : dib.colours).map(
      ([red, green, blue]) => [red, green, blue, 0] as [number, number, number, number]
    );

    logical.entries = entries;
    palette = system.handles.allocate(logical) ?? 0;
    realizer.realize(logical, entries, false);

    const slots = logical.slots ?? [];

    realized = (red, green, blue) => slots[nearestEntry(entries, red, green, blue)] ?? 0;
  }

  return {
    bitmap: dibToDevice(dib, screen.depth, screen.devicePalette, system.display, realized),
    palette,
  };
}
