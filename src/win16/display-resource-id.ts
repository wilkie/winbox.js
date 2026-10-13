'use strict';

/**
 * What a display driver's `GetDriverResourceID` (`DISPLAY` ordinal 450)
 * answers for a resource's number, at the settings its display mode runs it
 * at; `null` for a driver that does not export it.
 *
 * USER asks it before it finds any resource of the driver's by number: its
 * `OEMBIN` 1 as it starts (`USER.EXE` seg3 `0dcc`-`0df2`), and a bitmap, a
 * cursor's or an icon's group asked of the display's instance, as
 * `LoadBitmap(NULL, OBM_CLOSE)` is (seg12 `02dc`-`031f`, from `0374`): the
 * number the driver answers is the one it finds, and nought finds nothing.
 * GDI asks it for `OEMBIN` 3, its stock fonts, and takes `OEMBIN` "FONTS"
 * where the driver has none (`GDI.EXE` seg2 `02b9`-`02fd`); Control Panel's
 * Color for `OEMBIN` 1 and 2 (`MAIN.CPL` seg6 `2922`, `24ef`). A driver
 * without it is asked nothing, and each number is its own.
 *
 * The three drivers that have it answer the same way, **read out**: 2000 added
 * to the numbers in `add` and to any above `above` -- compared signed, so
 * 7F88h to 7FFFh, the OEM bitmaps 32734 to 32767, whose numbers plus 2000 are
 * found as 1966 to 1999, KERNEL taking a number with its top bit set -- and
 * every other number as it is (`SVGA256.DRV` seg1 `2d6e`, `8514.DRV` seg6
 * `02be`, `XGA.DRV` seg3 `008e`). The display mode says which, as
 * `resourceIds`. Cursors and icons are 32512 and up and none is moved; the
 * cursor or icon a group names is found by its own number (seg12 `03ef`).
 */
export function driverResourceId(display: any, id: number): number | null {
  const rule = display?.resourceIds;

  if (!rule) {
    return null;
  }

  const signed = (id << 16) >> 16;
  const moved = (rule.add ?? []).includes(id) || (rule.above !== undefined && signed > rule.above);

  return moved ? (id + 2000) & 0xffff : id & 0xffff;
}

/**
 * The resource USER finds for a number it asks the display's driver for: the
 * number `GetDriverResourceID` answers, or the number itself where the driver
 * has none, as the resource table holds it (fifteen bits); nought for none.
 */
export function displayResourceNumber(display: any, id: number): number {
  return (driverResourceId(display, id) ?? id) & 0x7fff;
}

/**
 * The display driver's bitmaps by the numbers USER asks for: each of the
 * driver's under every number that `GetDriverResourceID` answers it for --
 * its own, where the driver leaves it, and the OEM number 2000 below it where
 * the driver moves the OEM bitmaps there.
 */
export function bitmapsAsAsked<T>(display: any, bitmaps: Map<number, T>): Map<number, T> {
  const asked = new Map<number, T>();

  for (const [number, bitmap] of bitmaps) {
    for (const id of [number, (number - 2000 + 0x8000) & 0x7fff]) {
      if (displayResourceNumber(display, id) === number && !asked.has(id)) {
        asked.set(id, bitmap);
      }
    }
  }

  return asked;
}
