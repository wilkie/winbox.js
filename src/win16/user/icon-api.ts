'use strict';

import { blockFromBits, iconBlock, iconOf } from './icon-block.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { FALSE, NULL, TRUE } from '../consts.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { decodeIcon, iconEntries, pickIcon, type IconData } from '../../raster/icon.js';
import { Executable } from '../../executable.js';

import { scaleIcon } from './driver-resources.js';
import { RasterWindow } from './raster-window.js';

/**
 * Icons: loading one, drawing one, and asking whether a window is one.
 *
 * `LoadIcon` with no instance gives the display driver's standard icons, a
 * handle each, the same handle every time; with a program's instance, the
 * program's own icon resource, the member of its group that fits the display,
 * drawn `SM_CXICON` square. `DrawIcon` draws through the icon's mask, as a
 * minimized window's icon is drawn. Recorded by the `icons` probe.
 */

/** The handle each standard icon was given, so asking again gives the same. */
function standardHandles(system: any): Map<number, number> {
  system._standardIcons ??= new Map();

  return system._standardIcons;
}

export async function LoadIcon(hinst, lpszIcon) {
  if (!hinst) {
    const id = typeof lpszIcon === 'number' ? lpszIcon : Number(lpszIcon);
    const icon = this.rasterDesktop?.environment.icons?.get(id);

    if (!icon) {
      return NULL;
    }

    const handles = standardHandles(this);

    if (!handles.has(id)) {
      handles.set(id, iconBlock(this, icon));
    }

    return handles.get(id);
  }

  const module = this.handles.resolve(hinst);
  const icon = module?.executable ? await moduleIcon(this, module.executable, lpszIcon) : null;

  /* A block of memory in the display's format, which a program may write
   * into; see `icon-block.ts`. */
  return icon ? iconBlock(this, icon) : NULL;
}

/** A program's icon resource, by number or name, as a display draws it. */
async function moduleIcon(system: any, executable: any, name: any): Promise<IconData | null> {
  const typed = (type: number) =>
    executable.resources.find((resourceType: any) => resourceType.id == type)?.entries ?? [];
  const wanted = typeof name === 'number' ? name : String(name).toUpperCase();
  const group = typed(Executable.RESOURCES.GroupIcon ?? 14).find(
    (entry: any) =>
      entry.id == wanted || entry.name === wanted || String(entry.id).toUpperCase() === wanted
  );

  if (!group) {
    return null;
  }

  const display = system.display;
  const entries = iconEntries(new Uint8Array(await executable.readResource(group)));
  const entry = pickIcon(entries, 32, display?.colors ?? 16);
  const resource = typed(Executable.RESOURCES.Icon ?? 3).find((each: any) => each.id == entry?.id);

  if (!resource) {
    return null;
  }

  const data = new Uint8Array(await executable.readResource(resource));

  return scaleIcon(decodeIcon(data, DevicePalette.forDisplay(display)), 32);
}

/**
 * The **DrawIcon** function draws an icon with its top left at a point of a
 * device context: what is there ANDed with its mask and XORed with its
 * picture.
 */
export function DrawIcon(hdc, x, y, hicon) {
  const surface = this.handles.resolve(hdc);
  const read = iconOf(this, hicon);
  const bitmap = surface?.bitmap;

  if (!read || !(bitmap instanceof DeviceBitmap)) {
    return FALSE;
  }

  /* Read out of its block each time, as a program may have written into it,
   * and drawn at the display's icon size (`USER.EXE` seg13 `0199`). */
  const size = this.rasterDesktop?.environment.metric(11) ?? 32;
  const icon = read.width === size && read.height === size ? read : scaleIcon(read, size);

  drawIcon(bitmap, x, y, icon);

  return TRUE;
}

/** Draws an icon onto a bitmap through its mask. */
export function drawIcon(bitmap: DeviceBitmap, x: number, y: number, icon: IconData) {
  for (let row = 0; row < icon.height; row++) {
    for (let column = 0; column < icon.width; column++) {
      const at = row * icon.width + column;
      const beneath = bitmap.indexAt(x + column, y + row);

      if (beneath !== null) {
        bitmap.put(x + column, y + row, (icon.and[at] ? beneath : 0) ^ icon.xor[at]);
      }
    }
  }

  bitmap.context.markRect(x, y, x + icon.width, y + icon.height);
}

/** The **IsIconic** function says whether a window is minimized. */
export function IsIconic(hwnd) {
  const window = this.handles.resolve(hwnd);

  return window instanceof RasterWindow && window.window.state === 'minimized' ? TRUE : FALSE;
}

/** The **IsZoomed** function says whether a window is maximized. */
export function IsZoomed(hwnd) {
  const window = this.handles.resolve(hwnd);

  return window instanceof RasterWindow && window.window.state === 'maximized' ? TRUE : FALSE;
}

/**
 * An icon made from bits a program gives, in a block of its own (`USER.EXE`
 * seg12 `0110`): the AND mask of a bit a pixel, and the picture in the
 * format `nPlanes` and `nBitsPixel` say, which nothing checks against the
 * display's. See `icon-block.ts`.
 */
export function CreateIcon(
  this: any,
  _hinst: number,
  nWidth: number,
  nHeight: number,
  nPlanes: number,
  nBitsPixel: number,
  lpvANDbits: number,
  lpvXORbits: number
) {
  const width = nWidth & 0xffff;
  const height = nHeight & 0xffff;

  if (!width || !height || !lpvANDbits || !lpvXORbits) {
    return 0;
  }

  return blockFromBits(this, width, height, nPlanes & 0xff, nBitsPixel & 0xff, lpvANDbits, lpvXORbits);
}

/**
 * The display's own icon a handle is `LoadIcon`'s answer for, if it is one:
 * the desktop knows `IDI_APPLICATION` by it, to show USER's Windows flag.
 */
export function standardIcon(system: any, hicon: number): IconData | null {
  for (const [id, handle] of standardHandles(system)) {
    if (handle === hicon) {
      return system.rasterDesktop?.environment.icons?.get(id) ?? null;
    }
  }

  return null;
}

/** A copy of an icon, a block of its own (seg12 `0260`). */
export function CopyIcon(this: any, _hinst: number, hicon: number) {
  const icon = iconOf(this, hicon);

  return icon ? iconBlock(this, icon) : 0;
}

/** An icon done with: its block freed (seg12 `0170`). */
export function DestroyIcon(this: any, hicon: number) {
  if (!this._iconBlocks?.has(hicon)) {
    return 0;
  }

  this._iconBlocks.delete(hicon);

  return GlobalFree.call(this, hicon) ? 0 : 1;
}
