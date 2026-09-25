'use strict';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import {
  STYLES,
  capturedRects,
  capturedRows,
  chromeReady,
  chromeRecords,
  differences,
  displayEnvironment,
  DRIVES,
} from './chrome.js';

/**
 * USER's desktop, holding windows on one screen: each of the `chrome` probe's
 * windows made and shown as the probe made and showed it, at its place on a
 * screen of the display's size, and read back from the screen pixel for pixel.
 * The inactive window is made inactive the way the probe did it, by showing a
 * second window.
 */

const COLOR_WINDOW = 5;

for (const display of Object.keys(DRIVES)) {
  const ready = chromeReady(display);

  (ready ? describe : describe.skip)(`the desktop on the ${display}`, () => {
    const records = ready ? chromeRecords(display) : [];
    let setup: any;

    beforeAll(async () => {
      setup = await displayEnvironment(display);
    });

    const make = () => {
      const screen = new DeviceBitmap(
        setup.mode.width,
        setup.mode.height,
        setup.depth,
        undefined,
        setup.palette
      );
      const desktop = new Desktop(screen, setup.environment);

      desktop.paintBackground();

      return desktop;
    };

    const window = (desktop: Desktop, style: number, menu?: string[], at = [40, 40, 200, 120]) =>
      desktop.create(at[0], at[1], at[2], at[3], style, 'Probe', menu, {
        colorref: setup.environment.sysColor(COLOR_WINDOW),
      });

    for (const [name, frame] of Object.entries(STYLES)) {
      it(`shows the ${name} window as Windows does`, () => {
        const desktop = make();
        const shown = window(desktop, frame.style, frame.menu);

        desktop.show(shown);

        if (name === 'inactive') {
          desktop.show(window(desktop, 0x00cf0000, undefined, [400, 300, 160, 100]));
        }

        desktop.erase(shown);

        const { window: rect, client } = capturedRects(records, name);

        expect([
          shown.left + shown.client.left,
          shown.top + shown.client.top,
          shown.left + shown.client.right,
          shown.top + shown.client.bottom,
        ]).toEqual(client);
        expect([shown.left, shown.top, shown.left + shown.width, shown.top + shown.height]).toEqual(
          rect
        );
        expect(
          differences(setup.depth, desktop.screen, rect[0], rect[1], capturedRows(records, name))
        ).toEqual([]);
      });
    }

    it('keeps a covered window from drawing over the one on top of it', () => {
      const desktop = make();
      const under = window(desktop, 0x00cf0000);
      const over = window(desktop, 0x00cf0000, undefined, [100, 80, 200, 120]);

      desktop.show(under);
      desktop.show(over);

      const before = desktop.screen.indices.slice();
      const black = desktop.screen.devicePalette.index(0, 0, 0);
      const bitmap = under.surface.bitmap as DeviceBitmap;

      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
          bitmap.put(x, y, black);
        }
      }

      /* Every pixel that changed is the covered window's own and still shows. */
      for (let at = 0; at < before.length; at++) {
        if (desktop.screen.indices[at] !== before[at]) {
          expect(desktop.owners[at]).toBe(under.id);
        }
      }

      /* And one it covers is not touched: inside both, the top window's. */
      const x = 110;
      const y = 100;
      expect(desktop.owners[y * desktop.screen.width + x]).toBe(over.id);
      expect(desktop.screen.indices[y * desktop.screen.width + x]).toBe(
        before[y * desktop.screen.width + x]
      );
    });

    it('paints the desktop again where a window was taken away', () => {
      const desktop = make();
      const blank = desktop.screen.indices.slice();
      const shown = window(desktop, 0x00cf0000);

      desktop.show(shown);
      desktop.erase(shown);
      desktop.destroy(shown);

      expect(desktop.screen.indices).toEqual(blank);
    });
  });
}
