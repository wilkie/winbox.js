'use strict';

import { CALL_MICROSECONDS } from '../emulator/clock.js';
import { DevicePalette } from '../raster/device-palette.js';

/**
 * How long a call takes Windows, in microseconds, as the recordings in
 * `oracle/fixtures/timings/` have it under the recorder's DOSBox: what a
 * virtual clock charges a call when asked to charge calls as recorded
 * (`Clock.measuredCalls`). Each is the middle of three runs. See
 * `kb/topics/timing.md`.
 *
 * Only calls recorded on their own are here; a call recorded only in a pair
 * (`GetDC` with `ReleaseDC`) and every other is charged `CALL_MICROSECONDS`.
 * Drawing depends on the display driver, so each display has its own; WinG
 * is recorded on the 256-colour display alone.
 */

/** `callcost`, on the VGA. */
const VGA: Record<string, number> = {
  'USER.GetTickCount': 0.114,
  'USER.SendMessage': 1.26,
  'GDI.SetPixel': 7.988,
  'GDI.BitBlt': 267.368,
  'GDI.TextOut': 37.839,
};

/** `callcost`, `wingcost` and `twrcost`, on the Super VGA 256-colour driver. */
const SUPER_VGA: Record<string, number> = {
  'USER.GetTickCount': 0.108,
  'USER.SendMessage': 1.31,
  'GDI.SetPixel': 4.195,
  'GDI.BitBlt': 21.709,
  'GDI.TextOut': 25.431,
  'GDI.SelectObject': 1.125,
  'GDI.Rectangle': 17.22,
  'GDI.GetNearestColor': 25.242,
  'WING.WinGStretchBlt': 333.278,
  /* `twrcost`: the calls SimTower makes most, as it makes them.
   * `DefWindowProc` and `DispatchMessage` of `WM_NULL`, and `SetWindowPos`
   * moving nothing: the least each takes. */
  'USER.SetRect': 0.157,
  'USER.OffsetRect': 0.145,
  'USER.IntersectRect': 0.263,
  'USER.PtInRect': 0.193,
  'USER.EqualRect': 0.214,
  'USER.IsRectEmpty': 0.125,
  'USER.GetWindowRect': 0.234,
  'USER.IsIconic': 0.099,
  'USER.GetCursorPos': 0.217,
  'USER.ScreenToClient': 0.151,
  'USER.GetActiveWindow': 0.068,
  'USER.SetWindowPos': 5.829,
  'USER.DefWindowProc': 0.77,
  'USER.DispatchMessage': 1.788,
  'USER.TranslateMessage': 0.843,
  'USER.SelectPalette': 1.09,
  'USER.RealizePalette': 0.459,
  'GDI.GetPaletteEntries': 5.174,
  'GDI.GetStockObject': 0.141,
  'GDI.GetCurrentPosition': 0.159,
  'KERNEL.FindResource': 0.82,
};

/** `PeekMessage` finding nothing, with `PM_NOYIELD` and without. */
const PEEK = { vga: [0.843, 1.507], superVga: [0.88, 1.565] };

const PM_NOYIELD = 0x0002;

/** The microseconds Windows took over a call, as recorded; `CALL_MICROSECONDS` where it was not. */
export function callMicros(system: any, module: string, name: string, args: any[]): number {
  const superVga = DevicePalette.depthOf(system.display) === 8;
  const key = `${module}.${name}`;

  if (key === 'USER.PeekMessage') {
    const [noYield, yielding] = superVga ? PEEK.superVga : PEEK.vga;

    return (args[4] ?? 0) & PM_NOYIELD ? noYield : yielding;
  }

  if (superVga) {
    /* [[inferred]] from five sizes: 26.3us, 0.19us a row, 1.38ns a pixel. */
    if (key === 'WING.WinGBitBlt') {
      const width = Math.abs(args[3] ?? 0);
      const height = Math.abs(args[4] ?? 0);

      return 26.33 + 0.1916 * height + 0.00138 * width * height;
    }

    /* From 256 entries and 16: 0.93us, and 0.11us an entry. */
    if (key === 'WING.WinGSetDIBColorTable') {
      return 0.93 + 0.1104 * Math.max(0, args[2] ?? 0);
    }

    return SUPER_VGA[key] ?? CALL_MICROSECONDS;
  }

  return VGA[key] ?? CALL_MICROSECONDS;
}
