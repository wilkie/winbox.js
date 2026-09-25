'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Color } from '../../src/raster/color.js';
import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { decodeDib, dibToDevice } from '../../src/raster/dib.js';
import { Surface } from '../../src/raster/surface.js';
import { Gdi } from '../../src/win16/gdi.js';
import { displayMode } from '../../src/win16/display-modes.js';
import { resourcesOf, RT_BITMAP } from '../../src/win16/ne-resources.js';
import { GetSysColor } from '../../src/win16/user/GetSysColor.js';
import { GetSystemMetrics } from '../../src/win16/user/GetSystemMetrics.js';
import { paintFrame } from '../../src/win16/user/frame.js';
import { Context, prepareFonts } from '../oracle/replay.js';

/**
 * USER's window frames, painted by `paintFrame`, against what Windows drew:
 * the `chrome` probe's captures of each frame style on each display, pixel for
 * pixel. The display driver's OEM bitmaps and the System font come from the
 * oracle's own installation of that display, which is built rather than
 * committed, so this runs where the pipeline has been run.
 */

const ROOT = join(__dirname, '..', '..');

const DRIVES: Record<string, string> = {
  vga: 'drive-c',
  svga: 'drive-c-svga',
  ega: 'drive-c-ega',
  hercules: 'drive-c-hercules',
};

/* The window styles the probe made, as it made them. */
const STYLES: Record<string, { style: number; active: boolean }> = {
  overlapped: { style: 0x00cf0000, active: true },
  inactive: { style: 0x00cf0000, active: false },
  caption: { style: 0x00c80000, active: true },
  dialog: { style: 0x80400000, active: true },
  popup: { style: 0x80800000, active: true },
};

/**
 * Frames not yet painted as Windows paints them, and why. Each is expected to
 * fail, so the suite fails the moment one starts matching and its entry
 * becomes stale -- as `KNOWN_GAPS` does for the conformance suite.
 */
const KNOWN: Record<string, string> = {
  'hercules/overlapped':
    "the Hercules's border colour is grey, which a monochrome display dithers into a " +
    'checkerboard; brush dithering is not recorded yet, so the grey is painted as its ' +
    'nearest colour, black',
};

/** The display driver an installation names in its SYSTEM.INI. */
function driverOf(drive: string) {
  const ini = readFileSync(join(ROOT, 'oracle', 'build', drive, 'WINDOWS', 'SYSTEM.INI'), 'latin1');
  const name = /^display\.drv\s*=\s*(\S+)/im.exec(ini)?.[1] ?? 'VGA.DRV';

  return join(ROOT, 'oracle', 'build', drive, 'WINDOWS', 'SYSTEM', name.toUpperCase());
}

/** A device index as the digit the probe wrote: its place in the Windows palette. */
function digitOf(depth: number, index: number) {
  if (depth === 1) {
    return index ? 'f' : '0';
  }

  return (index === 7 ? 8 : index === 8 ? 7 : index).toString(16);
}

for (const [display, drive] of Object.entries(DRIVES)) {
  const fixture = join(ROOT, 'oracle', 'fixtures', `chrome-${display}.json`);
  const ready = existsSync(join(ROOT, 'oracle', 'build', drive)) && existsSync(fixture);

  (ready ? describe : describe.skip)(`window frames on the ${display}`, () => {
    const records = ready ? JSON.parse(readFileSync(fixture, 'utf8')).records : [];
    let context: any;
    let oem: Map<number, DeviceBitmap>;
    const depth = DevicePalette.depthOf(displayMode(display));

    beforeAll(async () => {
      await prepareFonts(display);
      context = new Context(display);

      const driver = new Uint8Array(readFileSync(driverOf(drive)));
      oem = new Map(
        resourcesOf(driver)
          .filter((resource) => resource.type === RT_BITMAP && resource.id !== null)
          .map((resource) => [resource.id!, dibToDevice(decodeDib(resource.data), depth)])
      );
    });

    for (const [name, frame] of Object.entries(STYLES)) {
      const known = KNOWN[`${display}/${name}`];

      (known ? it.failing : it)(`paints the ${name} window as Windows does`, () => {
        const rows: string[] = records
          .filter(
            (record: any) => record.function === 'pixels' && record.args.startsWith(`${name},`)
          )
          .map((record: any) => record.result);
        const width = rows[0].length;
        const height = rows.length;
        const screen = new DeviceBitmap(width, height, depth);
        const white = screen.devicePalette.index(0xff, 0xff, 0xff);

        screen.indices.fill(white);

        const surface: any = Surface.memory();
        surface.bitmap = screen;
        surface.font = context.handles.resolve(context.withStockFont(Gdi.SYSTEM_FONT)).font;
        surface.backMode = 1;

        const client = paintFrame(
          screen,
          0,
          0,
          width,
          height,
          { ...frame, title: 'Probe' },
          {
            metric: (index) => GetSystemMetrics.call(context, index),
            sysColor: (index) => GetSysColor.call(context, index),
            oem,
            title: (text, colour, [left, top, right, bottom]) => {
              const measured = surface.measureText(text);
              const style = surface.font.style ?? {};
              const cell = (style.ascent ?? 0) + (style.descent ?? 0) || measured.height;

              surface.textColor = new Color(
                colour & 0xff,
                (colour >> 8) & 0xff,
                (colour >> 16) & 0xff
              );
              surface.fillText(
                left + Math.floor((right - left - measured.width) / 2),
                top + Math.floor((bottom - top - cell) / 2),
                text
              );
            },
          }
        );

        const rects = records.find(
          (record: any) => record.function === 'rects' && record.args === name
        ).result;
        const [, windowRect, clientRect] = /window=([-\d:]+),client=([-\d:]+)/.exec(rects)!;
        const [wl, wt] = windowRect.split(':').map(Number);
        const [cl, ct, cr, cb] = clientRect.split(':').map(Number);

        expect([client.left, client.top, client.right, client.bottom]).toEqual([
          cl - wl,
          ct - wt,
          cr - wl,
          cb - wt,
        ]);

        const wrong: string[] = [];

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const got = digitOf(depth, screen.indices[y * width + x]);

            if (got !== rows[y][x]) {
              wrong.push(`${x},${y}: ${got} want ${rows[y][x]}`);
            }
          }
        }

        expect(wrong.slice(0, 20)).toEqual([]);
      });
    }
  });
}
