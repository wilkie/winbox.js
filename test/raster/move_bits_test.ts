'use strict';

import { ClipRegion } from '../../src/raster/clip-region.js';
import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { Desktop, type DesktopWindow } from '../../src/win16/user/desktop.js';
import { updateOf } from '../../src/win16/user/update-region.js';
import { chromeReady, displayEnvironment } from './chrome.js';

/**
 * A window moved on the raster desktop as `SetWindowPos` moves it
 * (`swpbits`): its bits taken with it, so that it shows at once, whole, at
 * its new place; and what it uncovered due in the window beneath, and no
 * more of it. Two pop-ups without borders, so that a client area is its
 * window: `B` over the whole screen, and `M`, 200 by 100 at (100, 100), a
 * pattern on it.
 */

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;

(chromeReady('vga') ? describe : describe.skip)('a window moved with its bits', () => {
  let setup: any;

  beforeAll(async () => {
    setup = await displayEnvironment('vga');
  });

  /* What each pixel of M shows: a pattern of its own place in it. */
  const pattern = (x: number, y: number) => ((x >> 3) + (y >> 3)) % 15;

  const make = (child = false) => {
    const screen = new DeviceBitmap(640, 480, setup.depth, undefined, setup.palette);
    const desktop = new Desktop(screen, setup.environment);
    const beneath = desktop.create(0, 0, 640, 480, WS_POPUP, 'B', undefined, null);

    beneath.hwnd = 1;
    desktop.show(beneath);

    const mover = desktop.create(
      100,
      100,
      200,
      100,
      child ? WS_CHILD : WS_POPUP,
      'M',
      undefined,
      null
    );

    mover.hwnd = 2;

    if (child) {
      mover.parent = beneath;
    }

    desktop.show(mover);

    /* Painted, and nothing due. */
    for (const window of [beneath, mover]) {
      const shown: any = window;

      window.needsPaint = false;
      window.needsErase = false;
      shown.needsNcPaint = false;
      shown.dirtyRect = undefined;
    }

    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        const at = x >= 100 && x < 300 && y >= 100 && y < 200;

        screen.put(x, y, at ? pattern(x - 100, y - 100) : 7);
      }
    }

    return { screen, desktop, beneath, mover };
  };

  /* The pixels of M's new place, at (150, 120), not as its pattern. */
  const wrong = (screen: DeviceBitmap) => {
    let count = 0;

    for (let y = 120; y < 220; y++) {
      for (let x = 150; x < 350; x++) {
        count += screen.indexAt(x, y) === pattern(x - 150, y - 120) ? 0 : 1;
      }
    }

    return count;
  };

  it('shows it whole at its new place, nothing of it due', () => {
    const { screen, desktop, beneath, mover } = make();

    desktop.moveWithBits(mover, 150, 120, 200, 100, true, 0);

    expect(wrong(screen)).toBe(0);
    expect(mover.needsPaint).toBe(false);
    expect((mover as any).needsNcPaint).toBeFalsy();

    /* Beneath, due where M was and is no more: not at its new place. */
    const due = updateOf(beneath);

    expect(beneath.needsPaint).toBe(true);
    expect((beneath as any).dirtyRect).toEqual([100, 100, 300, 200]);
    expect(due.contains(120, 110)).toBe(true);
    expect(due.contains(200, 150)).toBe(false);
  });

  it('copies with SWP_NOCOPYBITS through the rectangle the entry kept, all due without one', () => {
    const fresh = make();

    /* A block made afresh, all noughts: nothing copied, due all over
     * (`USER.EXE` seg7 `00e6`, `1028`-`102c`, `08de`). */
    fresh.desktop.moveWithBits(
      fresh.mover,
      150,
      120,
      200,
      100,
      false,
      0,
      null,
      false,
      false,
      [0, 0, 0, 0]
    );
    expect(fresh.mover.needsPaint).toBe(true);
    expect((fresh.mover as any).dirtyRect).toBeUndefined();
  });

  it('takes with SWP_NOCOPYBITS what the call before left in the entry, and leaves what already showed it', () => {
    const { screen, desktop, mover } = make();

    /* The entry kept the window's own place, from the call that showed it
     * (`swpbits`, `swpunc`). */
    desktop.moveWithBits(
      mover,
      150,
      120,
      200,
      100,
      false,
      0,
      null,
      false,
      false,
      [100, 100, 300, 200]
    );

    const due = updateOf(mover);

    expect(wrong(screen)).toBeGreaterThan(0);
    expect(mover.needsPaint).toBe(true);
    /* Given whole by USER's walk, not cut to the window (seg1 `42e9`): within it, the box of what was not copied. */
    expect(due.intersect(ClipRegion.rect(150, 120, 350, 220)).box).toEqual({
      left: 150,
      top: 120,
      right: 350,
      bottom: 220,
    });
    expect(due.contains(320, 150)).toBe(true);
    expect(due.contains(200, 150)).toBe(false);
  });

  it('makes all of it due, sized, with CS_HREDRAW', () => {
    const { desktop, mover } = make();

    desktop.moveWithBits(mover, 150, 120, 240, 120, true, 0x0002);

    expect(mover.needsPaint).toBe(true);
    expect(updateOf(mover).box).toEqual({ left: 150, top: 120, right: 390, bottom: 240 });
    expect(updateOf(mover).contains(200, 150)).toBe(true);
  });

  it('takes a child with it in its parent, the parent due only where it was', () => {
    const { screen, desktop, beneath, mover } = make(true);

    desktop.moveWithBits(mover, 150, 120, 200, 100, true, 0);

    expect(wrong(screen)).toBe(0);
    expect(mover.needsPaint).toBe(false);
    expect(updateOf(beneath).contains(200, 150)).toBe(false);

    /* The parent's paint makes the child due only where the parent is. */
    desktop.aboutToPaint(beneath);
    expect(mover.needsPaint).toBe(false);
  });

  it('takes the part of a window due with it as it places it, as `SetWindowPos` does', () => {
    const { desktop, mover } = make();
    const shown: DesktopWindow & any = mover;

    mover.needsPaint = true;
    shown.dirtyRect = [100, 100, 150, 150];
    desktop.place(mover, 150, 120, 200, 100, 0x0014);

    expect(mover.needsPaint).toBe(true);
    /* The part moved by as far as the window, the corner of its bits not due. */
    expect(updateOf(mover).contains(150, 120)).toBe(true);
    expect(updateOf(mover).contains(199, 169)).toBe(true);
    expect(updateOf(mover).contains(340, 210)).toBe(false);
  });
});
