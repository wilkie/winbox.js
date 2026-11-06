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
  _gdiFree: number[] = [];
  _gdiNext = GDI_START;

  /**
   * GDI's handles: its objects' and its device contexts', each a moveable
   * local handle in GDI's own heap (**read out**: `GDI.EXE` seg1
   * `0b7c`-`0b9f` makes a pen by `0eef`-`0f31`, which asks
   * `LocalAlloc(LMEM_MOVEABLE, ...)` of GDI's data segment, `1f43`-`1f4e`,
   * and answers the local handle). They are numbers within GDI's data
   * segment, apart from KERNEL's selectors and the instances and modules'
   * handles made from them, which are numbered in `_handles` with USER's and
   * WinBox's others. A number may be both an instance and one of GDI's
   * objects: KERNEL's functions take it for the instance (`resolveModule`),
   * the others for the object (`resolve`).
   */
  _gdi: any;

  constructor() {
    this._handles = {};
    this._gdi = {};
    this._names = {};
    this._lookup = new Map();
  }

  /** Whether an object's handle is GDI's: an object or a device context. */
  inGdi(item) {
    return this.isGDIObject(item) || item instanceof Surface;
  }

  /**
   * Whether a number is taken, for a handle given in GDI's set (`gdi`) or
   * in the rest: GDI's own, or any of the rest's but an instance's or a
   * module's, made from a selector (`aliasAt`); the rest's own, or any of
   * GDI's. So the two sets share no number but where an instance or a
   * module's handle is one of GDI's, as Windows' can be.
   */
  taken(handle, gdi = false) {
    const other = this._handles[handle];

    return gdi ? !!this._gdi[handle] || (!!other && !other.alias) : !!other || !!this._gdi[handle];
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

    if (this.isGDIObject(item)) {
      handle = this.gdiHandle();
    } else if (item instanceof Surface) {
      // Allocates an HDC
      handle = this.find(HandleManager.TAGS.HDC + 1, 0xffe, 2, true);
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

  /** Every handle's entry, GDI's and the rest's. */
  entries(): any[] {
    return [...Object.values(this._handles), ...Object.values(this._gdi)];
  }

  /** The table an object's handle is in. */
  tableFor(item) {
    return this.inGdi(item) ? this._gdi : this._handles;
  }

  /**
   * A handle of GDI's for an object that is in its local heap on Windows: a
   * pen, a brush, a font, a region, a bitmap, a palette, or a memory device
   * context (`gdiHandle` for that). **Recorded** by `gdinum` on four
   * displays: the kinds share one set of handles, and a new object is given
   * the handle last given back, whatever it was -- a brush the font's, a
   * pen the brush's, a region a pen's, a pen a memory context's. Otherwise
   * Windows' handles go down four at a time, while its heap's free handles
   * run that way; where they start, where a gap falls and where a new table
   * of them goes depend on everything GDI's heap has held since Windows
   * started, and differ from one display to the next. winbox.js starts at
   * C6Ah, where the VGA's first new object was, goes down past the stock
   * objects' handles (`STOCK`), and then above where it started.
   */
  gdiHandle(): number | null {
    while (this._gdiFree.length) {
      const handle = this._gdiFree.pop()!;

      if (!this.taken(handle, true)) {
        return handle;
      }
    }

    for (let handle = this._gdiNext; handle >= GDI_LOWEST; handle -= 4) {
      if (handle >= STOCK_FIRST && handle <= STOCK_LAST) {
        continue;
      }

      if (!this.taken(handle, true)) {
        this._gdiNext = handle - 4;
        return handle;
      }
    }

    for (let handle = GDI_START + 4; handle <= GDI_HIGHEST; handle += 4) {
      if (!this.taken(handle, true)) {
        return handle;
      }
    }

    return null;
  }

  /** A memory device context: its handle GDI's, as its objects' are. */
  allocateGDI(item) {
    const handle = this.gdiHandle();

    if (handle) {
      this.assign(handle, item);
    }

    return handle;
  }

  /** Whether an object is one of GDI's that is kept in its heap on Windows. */
  isGDIObject(item) {
    return (
      item instanceof Pen ||
      item instanceof Brush ||
      item instanceof Font ||
      item instanceof Bitmap ||
      item instanceof Region ||
      item instanceof LogicalPalette
    );
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

  /**
   * A handle given for an object at a number of the caller's choosing, that
   * resolves to it but is not what `lookup` answers: a program's instance,
   * its data segment's handle, beside its task.
   */
  aliasAt(handle, item) {
    const table = this.tableFor(item);

    if (!table[handle]) {
      table[handle] = { instance: item, alias: table === this._handles };
    }

    return handle;
  }

  /**
   * A free handle from `start`, within `length`, and with `residue` for its
   * low two bits if given; in GDI's set where `gdi` (`taken`).
   */
  find(start, length, residue?: number, gdi = false) {
    const end = start + length;
    const step = residue === undefined ? 1 : 4;

    if (residue !== undefined) {
      start = (start & ~3) + residue;

      if (start < end - length) {
        start += 4;
      }
    }

    // Scans handles for a free handle
    while (this.taken(start, gdi) && start <= end) {
      start += step;
    }

    if (start > end) {
      return null;
    }

    return start;
  }

  assign(handle, item) {
    this.tableFor(item)[handle] = {
      instance: item,
    };
    this._lookup.set(item, handle);
  }

  /** A handle let go, found as `resolve` finds it. */
  free(handle) {
    const table = this.tableOf(handle, false);

    return table ? this.release(table, handle) : undefined;
  }

  /** An instance's or a module's handle let go, found as `resolveModule` finds it. */
  freeModule(handle) {
    const table = this.tableOf(handle, true);

    return table ? this.release(table, handle) : undefined;
  }

  /**
   * The table a handle is found in: the rest's, where it is one of theirs
   * that is not an instance's or a module's; else GDI's; else the rest's.
   * Asked for an instance or a module (`module`), the rest's first.
   */
  private tableOf(handle, module: boolean) {
    const other = this._handles[handle];

    if (other && (module || !other.alias)) {
      return this._handles;
    }

    return this._gdi[handle] ? this._gdi : other ? this._handles : null;
  }

  private release(table: any, handle) {
    const item = table[handle];

    delete table[handle];

    /* One of GDI's, given out again first (`gdinum`); a stock object's is
     * its own. */
    if (
      table === this._gdi &&
      (handle & 3) === 2 &&
      handle >= GDI_LOWEST &&
      handle <= GDI_HIGHEST &&
      !(handle >= STOCK_FIRST && handle <= STOCK_LAST)
    ) {
      this._gdiFree.push(handle);
    }

    /* Its name, where it is what the name finds, given to another of the
     * same name still registered -- a class of the same name another
     * module registered, which WinBox finds by its name alone, where
     * Windows finds a program's own class by its module too. */
    if (item && item.name && this._names[item.name] === handle) {
      delete this._names[item.name];

      for (const [other, entry] of Object.entries(this._handles) as [string, any][]) {
        if (entry?.name === item.name) {
          this._names[item.name] = Number(other);
        }
      }
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

  /**
   * What a handle stands for: one of the rest's, else one of GDI's -- a
   * number both an instance's and one of GDI's objects' is the object's,
   * as GDI and USER take it (`tableOf`).
   */
  resolve(handle) {
    return this.tableOf(handle, false)?.[handle]?.instance;
  }

  /**
   * What a handle given as an instance or a module stands for, as KERNEL
   * takes it: the instance's or the module's where the number is both one
   * of theirs and one of GDI's objects'.
   */
  resolveModule(handle) {
    return this.tableOf(handle, true)?.[handle]?.instance;
  }

  isGDI(handle) {
    return this.isGDIObject(this.resolve(handle));
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

/**
 * The stock objects' handles, the same on every display (`gdinum`): from
 * ACEh, four apart, in their indices' order, but the default palette,
 * B06h, after the system's fixed font, B02h.
 */
export const STOCK_FIRST = 0xac6;
export const STOCK_LAST = 0xb06;

export function stockHandle(index: number) {
  return index === 15 ? 0xb06 : index === 16 ? 0xb02 : STOCK_FIRST + 4 * index;
}

/** Where winbox.js gives out GDI's handles from, and between what. See `gdiHandle`. */
const GDI_START = 0xc6a;
const GDI_LOWEST = 0x0e;
const GDI_HIGHEST = 0x3ffe;

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
