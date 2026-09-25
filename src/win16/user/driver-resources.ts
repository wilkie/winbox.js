'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { decodeIcon, iconEntries, pickIcon, type IconData } from '../../raster/icon.js';
import { resourcesOf, RT_BITMAP } from '../ne-resources.js';

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

/**
 * What USER draws with that is the display driver's: its OEM bitmaps --
 * the boxes, arrows and check marks -- and the standard icons, `IDI_APPLICATION`
 * and the rest, each the one of its group that fits the display. Read from the
 * person's own installation; never part of this project.
 */
export interface DriverResources {
  oem: Map<number, DeviceBitmap>;
  icons: Map<number, IconData>;

  /**
   * USER's own Windows flag, which a minimized window whose class's icon is
   * `IDI_APPLICATION` shows in its place: the `sizing` probe's window did, and
   * the `icons` probe's `IDI_APPLICATION` drawn by itself is a plain box.
   */
  applicationIcon?: IconData;
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

  const applicationIcon = user
    ? (iconOf(resourcesOf(user), OIC_WINLOGO, display, palette) ?? undefined)
    : undefined;

  return { oem, icons, applicationIcon };
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
 * scroll bar's arrows are drawn with (see `stretchSource`), which keeps the
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
