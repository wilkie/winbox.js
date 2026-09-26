'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { decodeIcon, iconEntries, pickIcon, type IconData } from '../../raster/icon.js';
import { resourcesOf, RT_BITMAP } from '../ne-resources.js';

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_GROUP_CURSOR = 12;
const RT_STRING = 6;

/**
 * What USER draws with that is the display driver's: its OEM bitmaps --
 * the boxes, arrows and check marks -- and the standard icons, `IDI_APPLICATION`
 * and the rest, each the one of its group that fits the display. Read from the
 * person's own installation; never part of this project.
 */
export interface DriverResources {
  oem: Map<number, DeviceBitmap>;
  icons: Map<number, IconData>;

  /** The standard cursors there are, by id: the driver's, and USER's own. */
  cursors: Set<number>;

  /**
   * USER's own Windows flag, which a minimized window whose class's icon is
   * `IDI_APPLICATION` shows in its place: the `sizing` probe's window did, and
   * the `icons` probe's `IDI_APPLICATION` drawn by itself is a plain box.
   */
  applicationIcon?: IconData;

  /**
   * USER's string table, by number: the message box's captions and default
   * title among them (see `message-box.ts`).
   */
  userStrings?: Map<number, string>;
}

/** The icons are drawn `SM_CXICON` square: a larger one scaled down, as USER does. */
const ICON_SIZE = 32;

/** USER's own icon group of the Windows flag. */
const OIC_WINLOGO = 32647;

export function driverResources(
  driver: Uint8Array,
  display: any,
  user?: Uint8Array
): DriverResources {
  const depth = DevicePalette.depthOf(display);
  const palette = DevicePalette.forDisplay(display);
  const resources = resourcesOf(driver);
  const oem = new Map<number, DeviceBitmap>();
  const icons = new Map<number, IconData>();

  for (const resource of resources) {
    if (resource.type === RT_BITMAP && resource.id !== null) {
      oem.set(resource.id, dibToDevice(decodeDib(resource.data), depth, palette));
    }
  }

  for (const group of resources.filter((resource) => resource.type === RT_GROUP_ICON)) {
    const icon = iconOf(resources, group.id, display, palette);

    if (icon && group.id !== null) {
      icons.set(group.id, icon);
    }
  }

  grayArrows(oem, palette);

  const applicationIcon = user
    ? (iconOf(resourcesOf(user), OIC_WINLOGO, display, palette) ?? undefined)
    : undefined;

  const cursors = new Set<number>(
    [...resources, ...(user ? resourcesOf(user) : [])]
      .filter((resource) => resource.type === RT_GROUP_CURSOR && resource.id !== null)
      .map((resource) => resource.id as number)
  );

  const userStrings = new Map<number, string>();

  for (const block of user ? resourcesOf(user).filter((resource) => resource.type === RT_STRING) : []) {
    let at = 0;

    for (let index = 0; index < 16 && at < block.data.length; index++) {
      const length = block.data[at];

      if (length && block.id !== null) {
        userStrings.set(
          ((block.id as number) - 1) * 16 + index,
          String.fromCharCode(...block.data.subarray(at + 1, at + 1 + length))
        );
      }

      at += 1 + length;
    }
  }

  return { oem, icons, applicationIcon, cursors, userStrings };
}

/** A group's icon for a display, at the size icons are drawn. */
export function iconOf(resources: any[], id: number | null, display: any, palette: DevicePalette) {
  const group = resources.find((resource) => resource.type === RT_GROUP_ICON && resource.id === id);

  if (!group) {
    return null;
  }

  const entry = pickIcon(iconEntries(group.data), ICON_SIZE, display?.colors ?? 16);
  const icon = resources.find((resource) => resource.type === RT_ICON && resource.id === entry?.id);

  return icon ? scaleIcon(decodeIcon(icon.data, palette), ICON_SIZE) : null;
}

/**
 * An icon at another size, each row and column one of the icon's, sampled at
 * its middle: row `r` of the result is row `(r * from + from / 2) / to`. The
 * `icons` probe's `IDI_APPLICATION` is 64 square with a border of four at the
 * top and five at the bottom, and is drawn 32 square with two at the top and
 * three at the bottom: the odd rows. Anything from `from / 2` to `from - 1`
 * in place of `from / 2` fits that one icon too. It is not the reduction a
 * scroll bar's arrows are drawn with (see `stretchMap` in `painter.ts`), which keeps the
 * even rows.
 */
export function scaleIcon(icon: IconData, size: number): IconData {
  if (icon.width === size && icon.height === size) {
    return icon;
  }

  const xor = new Uint8Array(size * size);
  const and = new Uint8Array(size * size);
  const sample = (to: number, from: number) => Math.floor((to * from + (from >> 1)) / size);

  for (let y = 0; y < size; y++) {
    const sy = sample(y, icon.height);

    for (let x = 0; x < size; x++) {
      const at = sy * icon.width + sample(x, icon.width);

      xor[y * size + x] = icon.xor[at];
      and[y * size + x] = icon.and[at];
    }
  }

  return { width: size, height: size, xor, and };
}

/**
 * The bitmaps USER lays side by side in its strip before the grayed arrows
 * (`USER.EXE` seg3 `0881`, `08f7`): 7FF2h, the four arrows, and the rest, in
 * the order it loads them.
 */
const STRIP_BEFORE = [
  32754, 32753, 32752, 32751, 32750, 32749, 32748, 32747, 32739, 32738, 32746, 32745, 32744,
  32743, 32742, 32741, 32740,
];

/** The arrows, up, down, right and left, and their grayed ids. */
const ARROWS: [number, number][] = [
  [32753, 32737],
  [32752, 32736],
  [32751, 32735],
  [32750, 32734],
];

/**
 * Grayed arrows for a driver without its own, as USER makes them (seg3
 * `1099`, `09f3`): each arrow copied after the others in the strip, then
 * ORed, a border in from its edges, with a brush of alternate black and
 * white pixels, black where the strip's x and y add to an even number (seg3
 * `13fb`). A black pixel of the arrow is left only where the brush is black.
 * The Hercules driver has none of its own.
 */
function grayArrows(oem: Map<number, DeviceBitmap>, palette: DevicePalette) {
  if (oem.has(32737)) {
    return;
  }

  const white = palette.index(255, 255, 255);
  let x = STRIP_BEFORE.reduce((sum, id) => sum + (oem.get(id)?.width ?? 0), 0);

  for (const [normal, grayed] of ARROWS) {
    const source = oem.get(normal);

    if (!source) {
      continue;
    }

    const copy = new DeviceBitmap(source.width, source.height, source.depth, undefined, source.devicePalette);

    for (let row = 0; row < source.height; row++) {
      for (let column = 0; column < source.width; column++) {
        const inside = row >= 1 && row < source.height - 1 && column >= 1 && column < source.width - 1;
        const brushWhite = ((x + column + row) & 1) === 1;

        copy.put(column, row, inside && brushWhite ? white : (source.indexAt(column, row) ?? 0));
      }
    }

    oem.set(grayed, copy);
    x += source.width;
  }
}
