'use strict';

import { handleFor, indexFor, segmentSelector, selectorFor } from '../selectors.js';
import { HANDLE } from '../types.js';
import { GetExePtr } from './module-calls.js';
import { GlobalLock } from './GlobalLock.js';
import { matches } from './FindResource.js';

/**
 * KERNEL's resource handlers: the procedure `LoadResource` and
 * `LockResource` call to load a resource of each type, which
 * `SetResourceHandler` changes; and `AllocResource` and `DirectResAlloc`,
 * which a handler makes a resource's block with. **Read out** of
 * `KRNL386.EXE`; **recorded** by `reshand`. As the Rust engine's
 * `resources.rs`.
 *
 * Each type of a module's resources has a handler, the double word at 4 of
 * its entry in the module's resource table, which KERNEL sets to its own,
 * seg1 `88c8`, as it reads the module (seg2 `27de`-`27e4`). WinBox keeps
 * the handlers a program sets beside the module, and its own default at
 * KERNEL's stub `DEFAULT_ORDINAL`, whose address is `88c8` in KERNEL's code:
 * `SetResourceHandler` answers it so.
 */

/** KERNEL's own handler's ordinal: its stub is at 8 times one more, 88C8h. */
export const DEFAULT_ORDINAL = 0x88c8 / 8 - 1;

const GMEM_MOVEABLE = 0x0002;
const GMEM_DISCARDABLE = 0x0100;
const GMEM_SHARE = 0x2000;

/** A resource's flag: discardable (NE's 1000h). */
const DISCARDABLE = 0x1000;

/** The handlers set, by module's executable and type. */
function handlers(system: any): Map<object, Map<object, number>> {
  return (system._resourceHandlers ??= new Map());
}

/** KERNEL's own handler's far address: its stub. */
function defaultHandler(system: any) {
  const info = system.modules.load(system.modules.fromName('KERNEL')).lookup(DEFAULT_ORDINAL);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}

/** The type a resource's entry is of, in its executable. */
function typeOf(found: any) {
  return (found.executable.resources ?? []).find((type: any) =>
    (type.entries ?? []).includes(found.entry)
  );
}

/** The handler a program set for a resource's type, or null for KERNEL's own. */
function programHandler(system: any, found: any): number | null {
  const type = typeOf(found);
  const set = type ? handlers(system).get(found.executable)?.get(type) : undefined;

  return set !== undefined && set !== defaultHandler(system) ? set : null;
}

/** The resource table's alignment shift: its first word. */
function shiftOf(executable: any) {
  const at = executable.headerOffset + executable.neHeader.resourceTableOffset;

  return executable._view.getUint16(at, true);
}

/**
 * A handler called as KERNEL calls one (seg1 `89dc`-`89fb`, `87c5`-`87e0`):
 * the block, the module and the resource, AX, DS and ES the stack's
 * segment. Its block.
 */
export async function callHandler(
  system: any,
  handler: number,
  block: number,
  module: number,
  resource: number
) {
  const answer = await system.scheduler.callProc(
    handler,
    [
      [block & 0xffff, HANDLE],
      [module & 0xffff, HANDLE],
      [resource & 0xffff, HANDLE],
    ],
    system.scheduler.stackRegisters()
  );

  return Number(answer ?? 0) & 0xffff;
}

/**
 * A type's handler changed (`KRNL386.EXE` seg3 `0b3d`-`0bb0`): the type
 * found in the module's resource table, by number or by name (`0964`,
 * `0af9`), its handler exchanged for the one given, the one it had
 * answered; nought where the module has no such type. **Recorded** by
 * `reshand`: KERNEL's own at first, `88c8` in KERNEL's code; the one set
 * after; nought for a type the module has none of.
 */
export function SetResourceHandler(this: any, hInstance: number, lpszType: any, lpfn: number) {
  const executable = this.handles.resolve(hInstance & 0xffff)?.executable;
  const type = (executable?.resources ?? []).find((each: any) => matches(each, lpszType));

  if (!type) {
    return 0;
  }

  const set = handlers(this).get(executable) ?? new Map();
  const before = set.get(type) ?? defaultHandler(this);

  set.set(type, lpfn >>> 0);
  handlers(this).set(executable, set);

  return before >>> 0;
}

/**
 * KERNEL's own handler (seg1 `88c8`-`8921`): a block given that is there
 * answered as it is; else the resource read into it, or into a block of
 * its own (`85c6`, `AllocResource`'s), and that answered.
 */
export async function ResourceHandler(this: any, hMem: number, hModule: number, hResInfo: number) {
  const found = this.handles.resolve(hResInfo & 0xffff);

  if (!found?.entry) {
    return 0;
  }

  const block = hMem & 0xffff;

  if (block && this.allocator.sizeOf(indexFor(block)) && !this.allocator.isDiscarded(indexFor(block))) {
    return block;
  }

  const bytes = new Uint8Array(await found.executable.readResource(found.entry));
  let handle = block;

  if (handle && this.allocator._objects[indexFor(handle)]) {
    this.allocator.resize(indexFor(handle), bytes.byteLength);
  } else {
    handle = allocFor(this, found, 0);
  }

  if (!handle) {
    return 0;
  }

  const address = this.machine.cpu.core.translateAddress(selectorFor(handle), 0);

  this.machine.memory.write(address, new DataView(bytes.buffer, bytes.byteOffset));
  void hModule;

  return handle;
}

/** A block for a resource: moveable, discardable as the resource is, the size given or its own. */
function allocFor(system: any, found: any, size: number) {
  const shift = shiftOf(found.executable);
  const unit = 1 << shift;
  const units = size ? Math.ceil(size / unit) : Math.ceil(found.entry.length / unit);
  const flags = GMEM_MOVEABLE | GMEM_SHARE | (found.entry.flags & DISCARDABLE ? GMEM_DISCARDABLE : 0);
  const index = system.allocator.allocate(units * unit, { flags });

  if (index === null || index < 0) {
    return 0;
  }

  system.allocator._objects[index].owner = system.scheduler?.active ?? 0;

  return handleFor(index);
}

/**
 * A block for a resource (`KRNL386.EXE` seg1 `851e`-`85c3`): its size the
 * size given in the resource table's units (`1 <<` its alignment shift),
 * rounded up, or the resource's own; moveable, discardable where the
 * resource is (`84eb`), the module's; the resource's block given that size
 * where it has one. Nought for no module. **Recorded** by `reshand`: 40h for
 * a resource of 2Ch, 80h for 100, discardable.
 */
export function AllocResource(this: any, hInstance: number, hResInfo: number, dwSize: number) {
  const found = this.handles.resolve(hResInfo & 0xffff);

  if (!GetExePtr.call(this, hInstance) || !found?.entry) {
    return 0;
  }

  const held = found.loaded?.handle;

  if (held && this.allocator._objects[indexFor(held)]) {
    const shift = shiftOf(found.executable);
    const unit = 1 << shift;
    const units = dwSize >>> 0 ? Math.ceil((dwSize >>> 0) / unit) : Math.ceil(found.entry.length / unit);

    this.allocator.resize(indexFor(held), units * unit);
    return held;
  }

  return allocFor(this, found, dwSize >>> 0);
}

/**
 * A block for a resource of the module's, of the size and the resource
 * flags given (`KRNL386.EXE` seg1 `84b8`-`84e8`, `84eb`): moveable,
 * discardable for 1000h. **Recorded** by `reshand`: 64 bytes are 40h, not
 * discardable for flags of nought, discardable for 1030h.
 */
export function DirectResAlloc(this: any, hInstance: number, wFlags: number, wSize: number) {
  if (!GetExePtr.call(this, hInstance)) {
    return 0;
  }

  const flags = GMEM_MOVEABLE | GMEM_SHARE | (wFlags & DISCARDABLE ? GMEM_DISCARDABLE : 0);
  const index = this.allocator.allocate(wSize & 0xffff, { flags });

  if (index === null || index < 0) {
    return 0;
  }

  this.allocator._objects[index].owner = this.scheduler?.active ?? 0;

  return handleFor(index);
}

/**
 * `LoadResource` through a handler a program set (`KRNL386.EXE` seg1
 * `8957`-`8a07`): a discardable resource with no block yet given one,
 * discarded and empty, and nothing called (`8982`-`89be`); otherwise the
 * handler called with the block the resource has, or nought, and what it
 * answers kept as the resource's block. Undefined where no program's
 * handler is set for its type.
 */
export async function loadThroughHandler(system: any, hinst: number, hResInfo: number, found: any) {
  const handler = programHandler(system, found);

  if (handler === null) {
    return undefined;
  }

  const loaded = found.loaded;
  const register = (handle: number) => {
    found.resource = hResInfo & 0xffff;
    found.module = GetExePtr.call(system, hinst);
    (system._loadedResources ??= new Map()).set(handle, found);
  };

  if (loaded?.handle) {
    const index = indexFor(loaded.handle);

    if (loaded.called && !system.allocator.isDiscarded(index)) {
      loaded.uses++;
      return loaded.handle;
    }
  } else if (found.entry.flags & DISCARDABLE) {
    const index = system.allocator.allocate(0, {
      flags: GMEM_MOVEABLE | GMEM_SHARE | GMEM_DISCARDABLE,
    });

    if (index === null || index < 0) {
      return 0;
    }

    system.allocator._objects[index].owner = system.scheduler?.active ?? 0;
    system.allocator.discard(index);

    const handle = handleFor(index);

    found.loaded = { handle, uses: 1, called: false };
    register(handle);

    return handle;
  }

  const handle = await callHandler(
    system,
    handler,
    loaded?.handle ?? 0,
    GetExePtr.call(system, hinst),
    hResInfo
  );

  if (!handle) {
    return 0;
  }

  found.loaded = { handle, uses: (loaded?.uses ?? 0) + 1, called: true };
  register(handle);

  return handle;
}

/**
 * `LockResource` (`KRNL386.EXE` seg1 `8755`-`8809`): `GlobalLock`; where
 * that gives nothing, the block a discarded resource's, its type's handler
 * called with it, and what it answers locked (`87e0`-`87f1`). The
 * resource's block stays the one it was. **Recorded** by `reshand`.
 */
export function lockThroughHandler(system: any, hglb: number): number | Promise<number> {
  const far = GlobalLock.call(system, hglb);

  if (far) {
    return far;
  }

  const found = system._loadedResources?.get(hglb & 0xffff);
  const handler = found ? programHandler(system, found) : null;

  if (!found || handler === null) {
    return 0;
  }

  /* Only here is a program's procedure called, and the answer a promise. */
  return (async () => {
    const handle = await callHandler(system, handler, hglb, found.module ?? 0, found.resource ?? 0);

    if (!handle) {
      return 0;
    }

    found.loaded.called = true;

    return GlobalLock.call(system, handle);
  })();
}
