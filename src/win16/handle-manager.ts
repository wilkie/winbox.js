'use strict';

// The implementations of each system object:
import { Surface } from '../raster/surface.js';
import { Brush } from '../raster/brush.js';
import { Pen } from '../raster/pen.js';
import { Bitmap } from '../raster/bitmap.js';
import { Task } from './task.js';
import { Module } from './module.js';
import { Font } from '../raster/font.js';
import { File } from '../file-system.js';
import { RasterWindow } from './user/raster-window.js';
import { DesktopHandle } from './user/desktop-handle.js';
import { MenuData } from './user/menu-data.js';
import { LogicalPalette, Region } from './gdi/gdi-objects.js';

/**
 * This manages all of the handles of resources throughout the system.
 */
export class HandleManager {
  declare _handles: any;
  declare _lookup: any;
  declare _names: any;
  declare static TAGS: any;
  constructor() {
    this._handles = {};
    this._names = {};
    this._lookup = new Map();
  }

  /**
   * A new handle for an object. A handle's value is the system's own, but
   * its low two bits are what programs can lean on, and the `handbits` probe
   * recorded them: 2 for every GDI object -- a DC, a pen, a brush, a font, a
   * bitmap, a stock object -- and 0 for a window and a menu. `PBRUSH.DLL`
   * gives out a DC's handle less one as a bitmap of its own, and tells the
   * two apart by the low bit.
   */
  allocate(item) {
    let handle;

    if (item instanceof Surface) {
      // Allocates an HDC
      handle = this.find(HandleManager.TAGS.HDC + 1, 0xffe, 2);
    } else if (
      item instanceof RasterWindow ||
      item instanceof DesktopHandle ||
      item instanceof MenuData
    ) {
      // A window or a menu: USER's, a multiple of four.
      handle = this.find(HandleManager.TAGS.ATOM + 1, 0xffe, 0);
    } else if (this.isFile(item)) {
      // Allocates an HFILE
      handle = this.find(HandleManager.TAGS.HFILE + 1, 0xffe);
    } else if (this.isBitmap(item)) {
      // Allocates an HBITMAP
      handle = this.find(HandleManager.TAGS.HBITMAP + 1, 0xffe, 2);
    } else if (this.isBrush(item)) {
      // Allocates an HBRUSH
      handle = this.find(HandleManager.TAGS.HBRUSH + 1, 0xffe, 2);
    } else if (this.isPen(item)) {
      // Allocates an HPEN
      handle = this.find(HandleManager.TAGS.HPEN + 1, 0xffe, 2);
    } else if (this.isFont(item)) {
      // Allocates an HFONT
      handle = this.find(HandleManager.TAGS.HFONT + 1, 0xffe, 2);
    } else if (item instanceof Region) {
      handle = this.find(HandleManager.TAGS.HRGN + 1, 0xffe, 2);
    } else if (item instanceof LogicalPalette) {
      handle = this.find(HandleManager.TAGS.HPALETTE + 1, 0xffe, 2);
    } else if (item instanceof Task) {
      // Allocates an HINSTANCE: a global handle, as Windows' is, low bits 2
      handle = this.find(HandleManager.TAGS.HINSTANCE + 1, 0xffe, 2);
    } else if (item && (item instanceof Module || item.prototype instanceof Module)) {
      // Allocates an HMODULE
      handle = this.find(HandleManager.TAGS.HMODULE + 1, 0xffe);
    } else {
      // Allocates an ATOM
      handle = this.find(HandleManager.TAGS.ATOM + 1, 0xffe);
    }

    if (handle) {
      this.assign(handle, item);
    }

    return handle;
  }

  lookup(item) {
    return this._lookup.get(item);
  }

  /**
   * A second handle for an object already given one, among the modules'
   * handles, that resolves to it but is not what `lookup` answers: a
   * library's module, beside its instance.
   */
  alias(item) {
    const handle = this.find(HandleManager.TAGS.HMODULE + 1, 0xffe);

    if (handle) {
      this._handles[handle] = { instance: item };
    }

    return handle;
  }

  /** A free handle from `start`, within `length`, and with `residue` for its low two bits if given. */
  find(start, length, residue?: number) {
    const end = start + length;
    const step = residue === undefined ? 1 : 4;

    if (residue !== undefined) {
      start = (start & ~3) + residue;

      if (start < end - length) {
        start += 4;
      }
    }

    // Scans handles for a free handle
    while (this._handles[start] && start <= end) {
      start += step;
    }

    if (start > end) {
      return null;
    }

    return start;
  }

  assign(handle, item) {
    this._handles[handle] = {
      instance: item,
    };
    this._lookup.set(item, handle);
  }

  free(handle) {
    const item = this._handles[handle];

    delete this._handles[handle];

    if (item && item.name) {
      delete this._names[item.name];
    }

    if (item && this._lookup.has(item)) {
      this._lookup.delete(item);
    }

    return item;
  }

  retrieve(name) {
    const handle = this._names[name.toUpperCase()];

    if (!handle) {
      return null;
    }

    return this.resolve(handle);
  }

  resolve(handle) {
    return (this._handles[handle] || {}).instance;
  }

  isGDI(handle) {
    return handle >= HandleManager.TAGS.HRGN;
  }

  isBitmap(item) {
    return item instanceof Bitmap;
  }

  isBrush(item) {
    return item instanceof Brush;
  }

  isPen(item) {
    return item instanceof Pen;
  }

  isFont(item) {
    return item instanceof Font;
  }

  isFile(item) {
    return item instanceof File;
  }

  register(handle, name) {
    if (this._handles[handle]) {
      this._handles[handle].name = name.toUpperCase();
      this._names[name.toUpperCase()] = handle;
    }
  }
}

HandleManager.TAGS = {
  // GDI Objects //
  HPEN: 0xf000,
  HBRUSH: 0xe000,
  HBITMAP: 0xd000,
  HFONT: 0xc000,
  HPALETTE: 0xb000,
  HRGN: 0xa000,
  // Other Objects //
  HDC: 0x9000,
  HINSTANCE: 0x8000,
  HMODULE: 0x7000,
  HWND: 0x6000,
  HCURSOR: 0x5000,
  HICON: 0x4000,
  HMETAFILE: 0x3000,
  ATOM: 0x2000,
  HMENU: 0x1800,
  HFILE: 0x1000,
};
