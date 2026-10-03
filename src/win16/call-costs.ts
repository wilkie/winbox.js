'use strict';

import { DevicePalette } from '../raster/device-palette.js';

/**
 * The instructions Windows runs for a call, as the recordings in
 * `oracle/fixtures/timings/` made at a fixed rate have them: the recorder's
 * DOSBox at `cycles=fixed 80000` (`record.mjs --cycles`), where a
 * millisecond is 80,000 instructions, so a call's time is its instructions
 * outright -- each figure the middle of three runs, times the rate the same
 * run measured. What a virtual clock charges a call when asked to charge
 * calls as recorded (`Clock.measuredCalls`): the same instructions whatever
 * the clock's rate, as a slower processor takes longer over the same code.
 * See `kb/topics/timing.md`.
 *
 * A call recorded only in a pair with another (`GetDC` with `ReleaseDC`) is
 * charged half the pair [[inferred]]; a call recorded on neither display,
 * `UNRECORDED`. Calls that draw depend on the display driver, so each
 * display has its own; the rest are USER's and KERNEL's own, the same on
 * either [[inferred]]. WinG is recorded on the 256-colour display alone.
 */

/**
 * A call recorded on neither display: the middle of the 37 recorded alone,
 * 154 instructions [[inferred]].
 */
export const UNRECORDED = 154;

/** USER's and KERNEL's calls that do not draw: `callcost`, `twrcost` and `twrcall`, on the Super VGA. */
const SYSTEM: Record<string, number> = {
  'USER.GetTickCount': 11,
  'USER.SendMessage': 206,
  'USER.PostMessage': 243, // half of PostMessage+GetMessage
  'USER.GetMessage': 243, // half of PostMessage+GetMessage
  'USER.SetRect': 28,
  'USER.OffsetRect': 21,
  'USER.IntersectRect': 44,
  'USER.PtInRect': 34,
  'USER.EqualRect': 28,
  'USER.IsRectEmpty': 23,
  'USER.GetWindowRect': 46,
  'USER.GetClientRect': 47,
  'USER.IsIconic': 18,
  'USER.GetCursorPos': 41,
  'USER.ScreenToClient': 24,
  'USER.GetActiveWindow': 8,
  'USER.SetWindowPos': 1076,
  'USER.LoadCursor': 776, // LoadCursor+SetCursor, less SetCursor alone
  'USER.SetCursor': 40,
  'USER.DefWindowProc': 173,
  'USER.DispatchMessage': 385,
  'USER.TranslateMessage': 187,
  'USER.TranslateAccelerator': 240,
  'USER.GetDC': 445, // half of GetDC+ReleaseDC
  'USER.ReleaseDC': 445, // half of GetDC+ReleaseDC
  'KERNEL.GlobalLock': 43, // half of GlobalLock+GlobalUnlock
  'KERNEL.GlobalUnlock': 43, // half of GlobalLock+GlobalUnlock
  'KERNEL.GlobalHandle': 61,
  'KERNEL.GlobalAlloc': 478, // half of GlobalAlloc+GlobalFree
  'KERNEL.GlobalFree': 478, // half of GlobalAlloc+GlobalFree
  'KERNEL.FindResource': 154,
  'KERNEL.LoadResource': 106, // half of LoadResource+FreeResource
  'KERNEL.FreeResource': 106, // half of LoadResource+FreeResource
  'KERNEL.LockResource': 77, // half of LockResource+GlobalUnlock
};

/** Drawing on the Super VGA 256-colour driver: `callcost`, `wingcost`, `twrcost` and `twrcall`. */
const SUPER_VGA: Record<string, number> = {
  'GDI.SetPixel': 569,
  'GDI.BitBlt': 2317,
  'GDI.TextOut': 4655,
  'GDI.SelectObject': 217, // two timed as one
  'GDI.MoveTo': 297, // half of MoveTo+LineTo
  'GDI.LineTo': 297, // half of MoveTo+LineTo
  'GDI.Rectangle': 3570,
  'GDI.GetNearestColor': 8595,
  'GDI.SaveDC': 607, // half of SaveDC+RestoreDC
  'GDI.RestoreDC': 607, // half of SaveDC+RestoreDC
  'GDI.GetPaletteEntries': 1185,
  'GDI.GetStockObject': 29,
  'GDI.GetCurrentPosition': 32,
  'GDI.CreatePen': 234, // half of CreatePen+DeleteObject
  'GDI.CreateSolidBrush': 234, // half of CreateSolidBrush+DeleteObject
  'GDI.DeleteObject': 234, // half of CreatePen+DeleteObject
  'USER.SelectPalette': 192,
  'USER.RealizePalette': 75,
  'USER.FillRect': 2372,
  'USER.FrameRect': 7775,
  'USER.DrawFocusRect': 6298,
  'WING.WinGStretchBlt': 82047,
};

/** Drawing on the VGA: `callcost`. Its USER calls are within one of the Super VGA's. */
const VGA: Record<string, number> = {
  'GDI.SetPixel': 886,
  'GDI.BitBlt': 21700,
  'GDI.TextOut': 4447,
};

/** `PeekMessage` finding nothing, with `PM_NOYIELD` and without. */
const PEEK = { vga: [122, 207], superVga: [121, 206] };

const PM_NOYIELD = 0x0002;

/**
 * Whether a WinG blit's source has the system palette's colours one for
 * one, slot for slot: WinG's fast path, a copy. Any other is translated a
 * pixel at a time (`wingxlat`), some seventy times as long for the whole
 * screen.
 */
function identityBlit(system: any, hdcSrc: number) {
  const source = system.handles.resolve(hdcSrc);
  const wing = source?.bitmap && system._wingBitmaps?.get(source.bitmap);
  const slots = system.systemPalette?.colours?.colours;

  if (!wing || !slots) {
    return true;
  }

  const colours = wing.bitmap.devicePalette.colours;

  for (let index = 0; index < 256; index++) {
    const ours = colours[index];
    const theirs = slots[index];

    if (
      !ours ||
      !theirs ||
      ours[0] !== theirs[0] ||
      ours[1] !== theirs[1] ||
      ours[2] !== theirs[2]
    ) {
      return false;
    }
  }

  return true;
}

/** The instructions Windows runs for a call, as recorded; `UNRECORDED` where it was not. */
export function callInstructions(system: any, module: string, name: string, args: any[]): number {
  const superVga = DevicePalette.depthOf(system.display) === 8;
  const key = `${module}.${name}`;

  if (key === 'USER.PeekMessage') {
    const [noYield, yielding] = superVga ? PEEK.superVga : PEEK.vga;

    return (args[4] ?? 0) & PM_NOYIELD ? noYield : yielding;
  }

  if (superVga) {
    /* [[inferred]] from five sizes each: the colours the system palette's,
     * 2,823 and 31.7 a row; not, 11,002, 39.0 a row and 4.43 a pixel. */
    if (key === 'WING.WinGBitBlt') {
      const width = Math.abs(args[3] ?? 0);
      const height = Math.abs(args[4] ?? 0);

      return identityBlit(system, args[5])
        ? 2823 + 31.7 * height + 0.002 * width * height
        : 11002 + 38.99 * height + 4.433 * width * height;
    }

    /* From 256 entries and 16: 148, and 21 an entry. */
    if (key === 'WING.WinGSetDIBColorTable') {
      return 148 + 21 * Math.max(0, args[2] ?? 0);
    }

    /* From 1, 16 and 64 entries: 260, and 193 an entry. */
    if (key === 'GDI.AnimatePalette') {
      return 260 + 193 * Math.max(0, args[2] ?? 0);
    }

    return SUPER_VGA[key] ?? SYSTEM[key] ?? UNRECORDED;
  }

  return VGA[key] ?? SYSTEM[key] ?? UNRECORDED;
}
