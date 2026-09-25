'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { decodeDib, dibToDevice } from '../../src/raster/dib.js';
import { Gdi } from '../../src/win16/gdi.js';
import { GetTextMetrics } from '../../src/win16/gdi/GetTextMetrics.js';
import { displayMode } from '../../src/win16/display-modes.js';
import { resourcesOf, RT_BITMAP } from '../../src/win16/ne-resources.js';
import { GetSysColor } from '../../src/win16/user/GetSysColor.js';
import { GetSystemMetrics } from '../../src/win16/user/GetSystemMetrics.js';
import { Context, prepareFonts } from '../oracle/replay.js';

/**
 * What a test of USER's drawing needs to hold it to the `chrome` probe's
 * captures: each display's recorded windows, and the display driver's OEM
 * bitmaps and System font from the oracle's own installation of it -- built,
 * not committed, so these run where the pipeline has been run.
 */

const ROOT = join(__dirname, '..', '..');

export const DRIVES: Record<string, string> = {
  vga: 'drive-c',
  svga: 'drive-c-svga',
  ega: 'drive-c-ega',
  hercules: 'drive-c-hercules',
};

/** The window styles the probe made, as it made them, and the menu it gave one. */
export const STYLES: Record<string, { style: number; active: boolean; menu?: string[] }> = {
  overlapped: { style: 0x00cf0000, active: true },
  inactive: { style: 0x00cf0000, active: false },
  caption: { style: 0x00c80000, active: true },
  dialog: { style: 0x80400000, active: true },
  popup: { style: 0x80800000, active: true },
  scroll: { style: 0x00cf0000 | 0x00200000 | 0x00100000, active: true },
  menu: { style: 0x00cf0000, active: true, menu: ['&File', '&Edit', '&Help'] },
};

/** Whether a display's installation and captures are there to test against. */
export function chromeReady(display: string) {
  return (
    existsSync(join(ROOT, 'oracle', 'build', DRIVES[display])) &&
    existsSync(join(ROOT, 'oracle', 'fixtures', `chrome-${display}.json`))
  );
}

/** A display's `chrome` records. */
export function chromeRecords(display: string): any[] {
  return JSON.parse(
    readFileSync(join(ROOT, 'oracle', 'fixtures', `chrome-${display}.json`), 'utf8')
  ).records;
}

/** A captured window's rows of pixels, a palette digit a pixel. */
export function capturedRows(records: any[], name: string): string[] {
  return records
    .filter((record) => record.function === 'pixels' && record.args.startsWith(`${name},`))
    .map((record) => record.result);
}

/** A captured window's rectangle and client rectangle, on the screen. */
export function capturedRects(records: any[], name: string) {
  const rects = records.find(
    (record) => record.function === 'rects' && record.args === name
  ).result;
  const [, window, client] = /window=([-\d:]+),client=([-\d:]+)/.exec(rects)!;

  return { window: window.split(':').map(Number), client: client.split(':').map(Number) };
}

/** The display driver an installation names in its SYSTEM.INI. */
function driverOf(drive: string) {
  const ini = readFileSync(join(ROOT, 'oracle', 'build', drive, 'WINDOWS', 'SYSTEM.INI'), 'latin1');
  const name = /^display\.drv\s*=\s*(\S+)/im.exec(ini)?.[1] ?? 'VGA.DRV';

  return join(ROOT, 'oracle', 'build', drive, 'WINDOWS', 'SYSTEM', name.toUpperCase());
}

/** The colours the probes write a digit for, in the Windows palette's order, as `0xRRGGBB`. */
const PROBE_COLOURS = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0x808080,
  0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];

/**
 * A pixel as the digit the probe wrote: its colour's place in the Windows
 * palette, or `?` for a colour that is not one of those sixteen -- the EGA's
 * dark grey.
 */
export function digitOf(depth: number, index: number, palette?: any) {
  if (depth === 1) {
    return index ? 'f' : '0';
  }

  if (palette) {
    const [red, green, blue] = palette.colours[index] ?? [0, 0, 0];
    const at = PROBE_COLOURS.indexOf((red << 16) | (green << 8) | blue);

    return at < 0 ? '?' : at.toString(16);
  }

  return (index === 7 ? 8 : index === 8 ? 7 : index).toString(16);
}

/**
 * Everything USER's drawing asks of a display, for `paintFrame` and the
 * desktop: its mode, metrics, system colours, the driver's OEM bitmaps and
 * the System font, with a replay context standing in for the running system.
 */
export async function displayEnvironment(display: string) {
  await prepareFonts(display);

  const context: any = new Context(display);
  const mode = displayMode(display);
  const depth = DevicePalette.depthOf(mode);
  const palette = DevicePalette.forDisplay(mode);
  const driver = new Uint8Array(readFileSync(driverOf(DRIVES[display])));
  const oem = new Map<number, DeviceBitmap>(
    resourcesOf(driver)
      .filter((resource) => resource.type === RT_BITMAP && resource.id !== null)
      .map((resource) => [resource.id!, dibToDevice(decodeDib(resource.data), depth, palette)])
  );
  const metrics: any = {};
  const systemFont = context.handles.resolve(context.withStockFont(Gdi.SYSTEM_FONT)).font;

  GetTextMetrics.call(context, context.withStockFont(Gdi.SYSTEM_FONT), metrics);

  return {
    context,
    mode,
    depth,
    palette,
    environment: {
      display: mode,
      metric: (index: number) => GetSystemMetrics.call(context, index),
      sysColor: (index: number) => GetSysColor.call(context, index),
      oem,
      font: { height: metrics.tmHeight, ascent: metrics.tmAscent },
      systemFont,
    },
  };
}

/** Where a bitmap's pixels differ from a capture's, the first few. */
export function differences(
  depth: number,
  bitmap: DeviceBitmap,
  left: number,
  top: number,
  rows: string[]
) {
  const wrong: string[] = [];

  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const got = digitOf(
        depth,
        bitmap.indices[(top + y) * bitmap.width + left + x],
        bitmap.devicePalette
      );

      if (got !== rows[y][x]) {
        wrong.push(`${x},${y}: ${got} want ${rows[y][x]}`);
      }
    }
  }

  return wrong.slice(0, 20);
}
