'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { keptDeviceFont } from './printer-driver.js';

/**
 * **GetPhysicalFontHandle** answers the handle of the font GDI realized for
 * a device context: the global block its `FONTINFO` is in. The twin of
 * `crates/winbox-win16/src/gdi/physical_font.rs`.
 *
 * **Read out** of `GDI.EXE` seg1 `0a2e`: no handle is checked, and the
 * answer is the word at 28h of the context, which realizing a font for it
 * sets (seg1 `40de`) beside the `FONTINFO`'s far pointer (3Ah) and its
 * entry in GDI's table of realized fonts (3Eh), whose uses the contexts
 * selecting it count; one no context uses is made discardable.
 *
 * In WinBox a printer's context answers the block GDI keeps the driver's
 * `FONTINFO` in, as its table of realized fonts has it (`printer-driver.ts`,
 * **measured** by `prtteng`: the block of the `FONTINFO` the driver's
 * `RealizeObject` was given). A display's fonts are realized by WinBox
 * without a `FONTINFO` in memory, so the table keeps a block for each font
 * the first time its handle is asked for, 96h bytes as GDI keeps a TrueType
 * font's (seg3 `23bc`) and a font file's header's 76h for the others; the
 * block holds nothing a program should read, and is kept while WinBox runs.
 * **Measured** by `gdimisc`: a new memory context answers a handle, and
 * another once Arial is selected and drawn with.
 */
export function GetPhysicalFontHandle(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface?.font) {
    return 0;
  }

  if (surface.driverDevice) {
    return keptDeviceFont(this, surface)?.kept?.realized.handle ?? 0;
  }

  const table: WeakMap<object, number> = (this._physicalFonts ??= new WeakMap());
  const kept = table.get(surface.font);

  if (kept) {
    return kept;
  }

  const handle = GlobalAlloc.call(
    this,
    GMEM_REALIZED,
    surface.font.outline ? ENGINE_FONTINFO : FONT_HEADER
  );

  table.set(surface.font, handle);
  return handle;
}

/** `GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE`, as GDI allocates a `FONTINFO` (seg3 `23bc`). */
const GMEM_REALIZED = 0x2042;

/** The size of the `FONTINFO` GDI's TrueType engine realizes (seg3 `23c0`). */
const ENGINE_FONTINFO = 0x96;

/** The size of a font file's header, through `dfFace`. */
const FONT_HEADER = 0x76;
