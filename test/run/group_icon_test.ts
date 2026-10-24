'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGroup, type Icon, type Item } from '../../src/layers/groups.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { decodeIcon, iconEntries, pickIcon } from '../../src/raster/icon.js';
import { displayColours, iconIndices, iconPixels } from '../../src/run/group-icon.js';
import { DISPLAY_MODES } from '../../src/win16/display-modes.js';
import { resourcesOf } from '../../src/win16/ne-resources.js';

/**
 * An item's icon drawn from its group file's own bits (`src/run/group-icon.ts`),
 * as the page shows a kept program's groups: held to the icon each item's
 * program holds, decoded as `ExtractIcon` decodes it for that display -- the
 * icon Program Manager took with `DumpIcon` into the file -- for the group
 * files the pm probes recorded whole, and the installation's own on each
 * display's drive of the oracle's (local; skipped where not there).
 */

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');
const BUILD = join(ROOT, 'oracle', 'build');

/** A probe's recorded files: `bytes` records `NAME@offset`, put together, by name. */
function recorded(probe: string) {
  const records = JSON.parse(readFileSync(join(FIXTURES, `${probe}.json`), 'utf8')).records;
  const sizes = new Map<string, number>();
  const files = new Map<string, Uint8Array>();

  for (const record of records) {
    if (record.function === 'size') {
      sizes.set(record.args, Number(record.result));
    }
  }

  for (const record of records) {
    if (record.function === 'bytes') {
      const [, name, offset] = /^(.*)@([0-9a-f]+)$/.exec(record.args)!;
      const data = files.get(name) ?? new Uint8Array(sizes.get(name)!);
      const at = parseInt(offset, 16);

      data.set(Buffer.from(record.result, 'hex').subarray(0, data.length - at), at);
      files.set(name, data);
    }
  }

  return files;
}

/** A file of a Windows directory as `_lopen` from it finds the name, case aside; null where not there. */
function found(windows: string, path: string) {
  const name = path
    .replace(/^[a-z]:/i, '')
    .replace(/^\\windows\\/i, '')
    .replace(/^\\/, '');

  for (const folder of [windows, join(windows, 'SYSTEM')]) {
    const file = join(folder, name.toUpperCase().replace(/\\/g, '/'));

    if (existsSync(file)) {
      return new Uint8Array(readFileSync(file));
    }
  }

  return null;
}

/**
 * The icon of a program's file at an index, as `ExtractIcon` decodes it for
 * a display (`src/win16/shell/programs.ts`): the group icon resource, the
 * one of its icons that fits, decoded into the display's colours.
 */
function programIcon(bytes: Uint8Array, index: number, display: string) {
  const mode = (DISPLAY_MODES as any)[display];
  const resources = resourcesOf(bytes);
  const group = resources.filter((each) => each.type === 14)[index];

  if (!group) {
    return null;
  }

  const entry = pickIcon(iconEntries(group.data), 32, mode.colors);
  const icon = resources.find((each) => each.type === 3 && each.id === entry?.id);

  return icon ? decodeIcon(icon.data, DevicePalette.forDisplay(mode)) : null;
}

/** Each item's icon held to its program's, where its icon's file is there; how many were. */
function holdItems(items: Item[], windows: string, display: string) {
  let held = 0;

  for (const item of items) {
    const file = item.iconPath ? found(windows, item.iconPath) : null;
    const expected = file && file[0] === 0x4d ? programIcon(file, item.iconIndex, display) : null;

    /* A group made on another display, not yet loaded on this one, holds
     * the other's format: Program Manager makes its icons again as it
     * loads it (seg4 `17ae`). */
    const depth = DevicePalette.depthOf((DISPLAY_MODES as any)[display]);

    if (!item.icon || !expected || item.icon.planes * item.icon.bitsPixel !== depth) {
      continue;
    }

    const indices = iconIndices(item.icon)!;

    expect({ item: item.name, and: [...indices.and], xor: [...indices.xor] }).toEqual({
      item: item.name,
      and: [...expected.and],
      xor: [...expected.xor],
    });
    held++;
  }

  return held;
}

describe("a group item's icon from its file's bits", () => {
  it('reads the AND plane a bit a pixel and the planes of each row as bits of an index', () => {
    /* 16 by 2, four planes: the mask's first row set, its second clear; the
     * picture's first pixel plane 0 alone (1), its second planes 1 and 3
     * (10), the rest nought. */
    const and = new Uint8Array([0xff, 0xff, 0x00, 0x00]);
    const xor = new Uint8Array(16);

    xor[0] = 0x80; /* row 0, plane 0, pixel 0 */
    xor[2] = 0x40; /* row 0, plane 1, pixel 1 */
    xor[6] = 0x40; /* row 0, plane 3, pixel 1 */
    xor[13] = 0x01; /* row 1, plane 2, pixel 15 */

    const icon: Icon = {
      hotX: 8,
      hotY: 1,
      cx: 16,
      cy: 2,
      widthBytes: 2,
      planes: 4,
      bitsPixel: 1,
      and,
      xor,
    };
    const indices = iconIndices(icon)!;

    expect([...indices.and]).toEqual([...Array(16).fill(1), ...Array(16).fill(0)]);
    expect(indices.xor[0]).toBe(1);
    expect(indices.xor[1]).toBe(10);
    expect(indices.xor[16 + 15]).toBe(4);
    expect([...indices.xor].filter((index) => index).length).toBe(3);

    /* Drawn on the window's white, 15: the screen kept where the mask is
     * set, XORed with the picture; the picture alone where it is clear. */
    const pixels = iconPixels(icon, 'vga')!;
    const colour = (at: number) => [...pixels.subarray(at * 4, at * 4 + 4)];
    const sixteen = DevicePalette.SIXTEEN.colours;

    expect(displayColours('vga').window).toBe(15);
    expect(colour(0)).toEqual([...sixteen[15 ^ 1], 255]);
    expect(colour(1)).toEqual([...sixteen[15 ^ 10], 255]);
    expect(colour(2)).toEqual([255, 255, 255, 255]);
    expect(colour(16)).toEqual([0, 0, 0, 255]);
    expect(colour(31)).toEqual([...sixteen[4], 255]);
  });

  it('reads one plane of eight bits as the index itself, and white on every display', () => {
    const icon: Icon = {
      hotX: 0,
      hotY: 0,
      cx: 2,
      cy: 1,
      widthBytes: 2,
      planes: 1,
      bitsPixel: 8,
      and: new Uint8Array([0x00, 0x00]),
      xor: new Uint8Array([0xfb, 0x07]),
    };

    expect([...iconIndices(icon)!.xor]).toEqual([0xfb, 0x07]);
    expect([...iconPixels(icon, 'vga256')!]).toEqual([
      0xff, 0xff, 0x00, 255, 0xc0, 0xc0, 0xc0, 255,
    ]);

    for (const display of Object.keys(DISPLAY_MODES)) {
      const { palette, window } = displayColours(display);

      expect(palette.colours[window]).toEqual([0xff, 0xff, 0xff]);
    }
  });

  it('refuses bits fewer than the header says', () => {
    const icon: Icon = {
      hotX: 0,
      hotY: 0,
      cx: 32,
      cy: 32,
      widthBytes: 4,
      planes: 4,
      bitsPixel: 1,
      and: new Uint8Array(128),
      xor: new Uint8Array(511),
    };

    expect(iconIndices(icon)).toBeNull();
    expect(iconPixels(icon, 'vga')).toBeNull();
  });

  const local = existsSync(join(BUILD, 'drive-c', 'WINDOWS', 'PROGMAN.EXE'));

  (local ? it : it.skip)("is each program's own icon in the groups the pm probes recorded", () => {
    let held = 0;

    for (const [probe, display, drive] of [
      ['pmbare-vga', 'vga', 'drive-c'],
      ['pmbare-ega', 'ega', 'drive-c-ega'],
      ['pmfiles', 'vga', 'drive-c'],
    ]) {
      for (const [name, data] of recorded(probe)) {
        const group = readGroup(data);

        expect(group.items.every((item) => item.icon && iconIndices(item.icon))).toBe(true);
        held += holdItems(group.items, join(BUILD, drive, 'WINDOWS'), display);
        expect(name).toMatch(/GRP/);
      }
    }

    expect(held).toBeGreaterThan(10);
  });

  (local ? it : it.skip)(
    "is each program's own icon in the installation's groups on each display",
    () => {
      const drives: [string, string][] = [
        ['drive-c', 'vga'],
        ['drive-c-ega', 'ega'],
        ['drive-c-hercules', 'hercules'],
        ['drive-c-svga', 'svga'],
        ['drive-c-vga256', 'vga256'],
        ['drive-c-8514', '8514'],
        ['drive-c-xga256', 'xga256'],
      ];
      const held: Record<string, number> = {};

      for (const [drive, display] of drives) {
        const windows = join(BUILD, drive, 'WINDOWS');

        for (const name of ['MAIN.GRP', 'ACCESSOR.GRP', 'STARTUP.GRP']) {
          const path = join(windows, name);

          if (existsSync(path)) {
            const group = readGroup(new Uint8Array(readFileSync(path)));

            held[display] = (held[display] ?? 0) + holdItems(group.items, windows, display);
          }
        }
      }

      /* The 8514/A's and the XGA's installations hold the VGA's format. */
      expect(held).toEqual({
        vga: 20,
        ega: 20,
        hercules: 20,
        svga: 20,
        vga256: 20,
        8514: 0,
        xga256: 0,
      });
    }
  );
});
