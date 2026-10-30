'use strict';

import { indexFor } from '../selectors.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { GetModuleHandle } from '../kernel/GetModuleHandle.js';
import { GetProcAddress } from '../kernel/GetProcAddress.js';
import { GetExpWinVer } from '../kernel/GetExpWinVer.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { GlobalReAlloc } from '../kernel/GlobalReAlloc.js';
import { SizeofResource } from '../kernel/AccessResource.js';
import { ResourceHandler, SetResourceHandler, typeHandler } from '../kernel/resource-handlers.js';
import { findResourceIn } from '../kernel/FindResource.js';
import { LoadResource } from '../kernel/LoadResource.js';
import { LockResource } from '../kernel/LockResource.js';
import { GetIconID } from './cursor-make.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';
import { displayFormat } from './icon-block.js';
import { convertDib, convertOld, type Converted, type IconMetrics } from './icon-convert.js';

/**
 * USER's resource handlers for icons and cursors, and `SignalProc`, which
 * sets them on each module KERNEL loads. **Read out of `USER.EXE`** and
 * **recorded** by `iconhand` and `userproc`. As the Rust engine's
 * `icon_handlers.rs`.
 *
 * KERNEL tells USER of a module loaded with `SignalProc`'s signal 40h
 * (seg1 `0a00`-`0a4b`), and USER sets the module's handlers for
 * `RT_CURSOR` and `RT_ICON` with `SetResourceHandler`: `LoadDIBCursorHandler`
 * and `LoadDIBIconHandler` for a module of Windows 3 or later, else
 * `LoadCursorIconHandler` for both. So `LoadResource` of an icon or cursor
 * -- `LoadIcon`'s and `LoadCursor`'s, and a program's own -- gives USER's
 * block (`icon-convert.ts`), not the bitmap the file holds. WinBox sets
 * them as a module's handlers are first asked for (`resource-handlers.ts`),
 * the same each time for a module, and calls them itself where `LoadResource`
 * and `LockResource` find them set.
 */

export const RT_CURSOR = 1;
export const RT_ICON = 3;
/** A group's type is its member's and this (seg12 `03b2`). */
export const GROUP = 11;

/** Signal 40h: a module loaded (seg1 `09d1`). */
const SIGNAL_LOADED = 0x40;
/** The first version whose icons and cursors are device-independent bitmaps. */
export const WINDOWS_3 = 0x300;
/** `GlobalReAlloc`'s flags that leave a block discarded (seg12 `0e3c`). */
const DISCARD = 0x0002;
/** The largest resource `LoadCursorIconHandler` takes: one of 64K or more fails (`0e06`). */
const OLD_LIMIT = 0x10000;

const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXCURSOR = 13;
const SM_CYCURSOR = 14;

/** USER's handlers, by name, as its exports are. */
export const LOAD_CURSOR_ICON = 'LoadCursorIconHandler';
export const LOAD_DIB_CURSOR = 'LoadDibCursorHandler';
export const LOAD_DIB_ICON = 'LoadDibIconHandler';

/** USER's export of a name: its far address. */
function userProc(system: any, name: string) {
  /* A system with no modules -- one a test makes for KERNEL alone -- has
   * no USER to set handlers. */
  if (!system.modules) {
    return 0;
  }

  const user = GetModuleHandle.call(system, 'USER') & 0xffff;

  return user ? GetProcAddress.call(system, user, name) >>> 0 : 0;
}

/**
 * The handlers USER sets for a module of a version (seg1 `0a09`-`0a4b`):
 * for `RT_CURSOR` and `RT_ICON`, its far address each.
 */
export function userHandlers(system: any, version: number): [number, number][] {
  const modern = version >= WINDOWS_3;

  return [
    [RT_CURSOR, userProc(system, modern ? LOAD_DIB_CURSOR : LOAD_CURSOR_ICON)],
    [RT_ICON, userProc(system, modern ? LOAD_DIB_ICON : LOAD_CURSOR_ICON)],
  ];
}

/** Which of USER's handlers a far address is, if one. */
export function userHandlerAt(system: any, address: number): string | null {
  for (const name of [LOAD_DIB_ICON, LOAD_DIB_CURSOR, LOAD_CURSOR_ICON]) {
    if (address >>> 0 === userProc(system, name)) {
      return name;
    }
  }

  return null;
}

/** The sizes USER makes icons and cursors. */
function metrics(system: any): IconMetrics {
  return {
    cxIcon: GetSystemMetrics.call(system, SM_CXICON),
    cyIcon: GetSystemMetrics.call(system, SM_CYICON),
    cxCursor: GetSystemMetrics.call(system, SM_CXCURSOR),
    cyCursor: GetSystemMetrics.call(system, SM_CYCURSOR),
  };
}

/** The bytes a block holds, as far as it is allocated. */
function readBlock(system: any, handle: number, far: number) {
  const size = system.allocator.sizeOf(indexFor(handle));
  const core = system.machine.cpu.core;
  const bytes = new Uint8Array(size);

  for (let at = 0; at < size; at++) {
    bytes[at] = core.read8(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  }

  return bytes;
}

/** A block made the size a conversion gives it, and its bytes written. */
function writeBlock(system: any, handle: number, converted: Converted) {
  const index = indexFor(handle);

  if (system.allocator.sizeOf(index) !== converted.size) {
    system.allocator.resize(index, converted.size);
  }

  const far = GlobalLock.call(system, handle) >>> 0;
  const core = system.machine.cpu.core;

  converted.bytes.forEach((value, at) =>
    core.write8(far >>> 16, ((far & 0xffff) + at) & 0xffff, value)
  );
  GlobalUnlock.call(system, handle);
  (system._iconBlocks ??= new Set<number>()).add(handle);
}

/** A block left discarded, as USER leaves one it fails (`GlobalReAlloc` to nought). */
function discard(system: any, handle: number) {
  if (handle) {
    GlobalReAlloc.call(system, handle, 0, DISCARD);
  }
}

/** A block converted in place: locked, made USER's, unlocked; null where it fails. */
function convertBlock(
  system: any,
  handle: number,
  convert: (bytes: Uint8Array) => Converted | null
): boolean {
  const far = GlobalLock.call(system, handle) >>> 0;

  if (!far) {
    return false;
  }

  const converted = convert(readBlock(system, handle, far));

  GlobalUnlock.call(system, handle);

  if (!converted) {
    return false;
  }

  writeBlock(system, handle, converted);

  return true;
}

/**
 * `LoadDIBIconHandler` and `LoadDIBCursorHandler` (seg12 `100d`, `0ff1`,
 * both `10ce`): the resource's size; the resource read by KERNEL's own
 * handler (`[7A2h]`), into the block given or one of its own; locked and
 * made USER's (`convertDib`). The block, or nought with the block left
 * discarded.
 */
async function dibHandler(
  system: any,
  icon: boolean,
  hMem: number,
  hModule: number,
  hResInfo: number
) {
  const size = SizeofResource.call(system, hModule, hResInfo) & 0xffff;
  const handle = await ResourceHandler.call(system, hMem, hModule, hResInfo);

  if (!handle) {
    discard(system, hMem & 0xffff);
    return 0;
  }

  const display = displayFormat(system);
  const done = convertBlock(system, handle, (bytes) =>
    convertDib(bytes, size, icon, metrics(system), {
      ...display,
      palette: DevicePalette.forDisplay(system.display),
    })
  );

  if (!done) {
    discard(system, handle);
    return 0;
  }

  return handle;
}

export function LoadDibIconHandler(this: any, hMem: number, hModule: number, hResInfo: number) {
  return dibHandler(this, true, hMem, hModule, hResInfo);
}

export function LoadDibCursorHandler(this: any, hMem: number, hModule: number, hResInfo: number) {
  return dibHandler(this, false, hMem, hModule, hResInfo);
}

/**
 * `LoadCursorIconHandler` (seg12 `0deb`-`0e49`): a Windows 2 module's icon
 * or cursor -- nought for one of 64K or more -- read by KERNEL's own
 * handler, and made USER's (`convertOld`). The block, or nought with it
 * left discarded.
 */
export async function LoadCursorIconHandler(
  this: any,
  hMem: number,
  hModule: number,
  hResInfo: number
) {
  const size = SizeofResource.call(this, hModule, hResInfo);

  if (size >= OLD_LIMIT) {
    return 0;
  }

  const handle = await ResourceHandler.call(this, hMem, hModule, hResInfo);

  if (!handle) {
    discard(this, hMem & 0xffff);
    return 0;
  }

  if (!convertBlock(this, handle, (bytes) => convertOld(bytes, size, metrics(this)))) {
    discard(this, handle);
    return 0;
  }

  return handle;
}

/**
 * `LoadIconHandler` (seg12 `0328`-`0371`): a block holding an icon resource
 * made USER's icon in place -- a device-independent one where the flag is
 * set (`1138` with 1), else a Windows 2 one (`0e4c`) -- its size
 * `GlobalSize`'s low word. The block, or nought where it does not lock or
 * the conversion fails; nothing discarded.
 */
export function LoadIconHandler(this: any, hMem: number, fNewFormat: number) {
  const handle = hMem & 0xffff;
  const size = this.allocator.sizeOf(indexFor(handle)) & 0xffff;
  const done = convertBlock(this, handle, (bytes) =>
    fNewFormat & 0xffff
      ? convertDib(bytes, size, true, metrics(this), {
          ...displayFormat(this),
          palette: DevicePalette.forDisplay(this.display),
        })
      : convertOld(bytes, size, metrics(this))
  );

  return done ? handle : 0;
}

/**
 * A module's icon or cursor as `LoadIcon` and `LoadCursor` load one
 * (`USER.EXE` seg12 `05b9`-`05ea`, `0374`-`0409`): for a module of
 * Windows 3 or later, the group of the name (its type 11 more), loaded --
 * and left loaded -- its member that fits the display (`GetIconID`), found
 * by number; for an older one, the resource of the name itself. That
 * resource loaded: its block is the icon or cursor, the same each time,
 * USER's block once its handler has made it. Nought for none.
 *
 * A discardable resource's block is made by its handler as it is first
 * locked (`LockResource`), as `DrawIcon` locks it; where the handler is
 * USER's own, WinBox has it made at once, for its own drawing reads the
 * block as it is. **Recorded** by `iconhand`: the handle `LoadResource`
 * gives for the group's member, the same again; a program's handler not
 * called by `LoadIcon`, and called by `DrawIcon`.
 */
export async function loadFromModule(
  system: any,
  hinst: number,
  executable: any,
  name: any,
  type: number
) {
  const version = executable?.neHeader?.expectedWindowsVersion ?? 0;
  let resource = 0;

  if (!executable) {
    return 0;
  }

  if (version >= WINDOWS_3) {
    const group = findResourceIn(system, executable, name, type + GROUP);
    const directory = group ? await LoadResource.call(system, hinst, group) : 0;
    const id = directory ? GetIconID.call(system, directory, type) : 0;

    resource = id ? findResourceIn(system, executable, id, type) : 0;
  } else {
    resource = findResourceIn(system, executable, name, type);
  }

  const handle = resource ? (await LoadResource.call(system, hinst, resource)) & 0xffff : 0;
  const found = handle ? system._loadedResources?.get(handle) : null;
  const typed = found
    ? (found.executable.resources ?? []).find((each: any) => each.entries?.includes(found.entry))
    : null;
  const handler = typed ? typeHandler(system, found.executable, typed) : 0;

  if (handle && handler && userHandlerAt(system, handler)) {
    const far = await LockResource.call(system, handle);

    if (far) {
      GlobalUnlock.call(system, handle);
    }
  }

  return handle;
}

/**
 * USER's handler at a far address called as KERNEL calls one: WinBox's own
 * code, called directly. Undefined for any other address.
 */
export function callUserHandler(
  system: any,
  address: number,
  block: number,
  module: number,
  resource: number
): Promise<number> | undefined {
  const name = userHandlerAt(system, address);
  const handlers: Record<string, (b: number, m: number, r: number) => Promise<number>> = {
    [LOAD_DIB_ICON]: LoadDibIconHandler,
    [LOAD_DIB_CURSOR]: LoadDibCursorHandler,
    [LOAD_CURSOR_ICON]: LoadCursorIconHandler,
  };

  return name ? handlers[name].call(system, block, module, resource) : undefined;
}

/**
 * `SignalProc` (`USER.EXE` seg1 `09bc`-`0a5c`): KERNEL's notices. Signal
 * 40h, a module loaded: its handlers for `RT_CURSOR` and `RT_ICON` set to
 * USER's, by its version (`GetExpWinVer`). Nought answered. **Recorded** by
 * `iconhand`: a program's handler for its icons, put back to USER's.
 *
 * Signals 20h and 666h, a task's end, and 80h, a module freed, are KERNEL's
 * to USER, which WinBox's are one program for: they do nothing here.
 */
export function SignalProc(
  this: any,
  hHandle: number,
  wSignal: number,
  _wParam: number,
  _lParam: number
) {
  if ((wSignal & 0xffff) === SIGNAL_LOADED) {
    const handle = hHandle & 0xffff;
    const version = GetExpWinVer.call(this, handle) & 0xffff;

    for (const [type, address] of userHandlers(this, version)) {
      SetResourceHandler.call(this, handle, type, address);
    }
  }

  return 0;
}
