'use strict';

import { Color } from '../../src/raster/color.js';
import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { Surface } from '../../src/raster/surface.js';
import { paintFrame } from '../../src/win16/user/frame.js';
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
 * USER's window frames, painted by `paintFrame`, against what Windows drew:
 * the `chrome` probe's captures of each frame style on each display, pixel for
 * pixel. See `chrome.ts` for where the display's pieces come from.
 */

/**
 * Frames not yet painted as Windows paints them, and why. Each is expected to
 * fail, so the suite fails the moment one starts matching and its entry
 * becomes stale -- as `KNOWN_GAPS` does for the conformance suite.
 */
const KNOWN: Record<string, string> = {};

for (const display of Object.keys(DRIVES)) {
  const ready = chromeReady(display);

  (ready ? describe : describe.skip)(`window frames on the ${display}`, () => {
    const records = ready ? chromeRecords(display) : [];
    let setup: any;

    beforeAll(async () => {
      setup = await displayEnvironment(display);
    });

    for (const [name, frame] of Object.entries(STYLES)) {
      const known = KNOWN[`${display}/${name}`];

      (known ? it.failing : it)(`paints the ${name} window as Windows does`, () => {
        const rows = capturedRows(records, name);
        const width = rows[0].length;
        const height = rows.length;
        const screen = new DeviceBitmap(width, height, setup.depth, undefined, setup.palette);

        screen.indices.fill(screen.devicePalette.index(0xff, 0xff, 0xff));

        const surface: any = Surface.memory();
        surface.bitmap = screen;
        surface.font = setup.environment.systemFont;
        surface.backMode = 1;

        const ink = (colour: number) =>
          new Color(colour & 0xff, (colour >> 8) & 0xff, (colour >> 16) & 0xff);

        const client = paintFrame(
          screen,
          0,
          0,
          width,
          height,
          { ...frame, title: 'Probe' },
          {
            ...setup.environment,
            title: (text, colour, [left, top, right, bottom]) => {
              const measured = surface.measureText(text);

              surface.textColor = ink(colour);
              surface.fillText(
                left + Math.floor((right - left - measured.width) / 2),
                top + Math.floor((bottom - top - setup.environment.font.height) / 2),
                text
              );
            },
            measure: (text) => surface.measureText(text).width,
            text: (text, colour, x, y) => {
              surface.textColor = ink(colour);
              surface.fillText(x, y, text);
            },
          }
        );

        const { window, client: want } = capturedRects(records, name);
        const [wl, wt] = window;
        const [cl, ct, cr, cb] = want;

        expect([client.left, client.top, client.right, client.bottom]).toEqual([
          cl - wl,
          ct - wt,
          cr - wl,
          cb - wt,
        ]);

        expect(differences(setup.depth, screen, 0, 0, rows)).toEqual([]);
      });
    }
  });
}
