'use strict';

import { FreeLibrary, LoadLibrary } from '../kernel/LoadLibrary.js';
import { GetProcAddress } from '../kernel/GetProcAddress.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { readProfile } from '../kernel/profiles.js';
import { indexFor } from '../selectors.js';
import { DWORD, LPARAM, UINT } from '../types.js';

/**
 * Installable drivers: the table USER keeps of them, and the calls that open,
 * ask, walk and close them.
 *
 * **Read out** of `USER.EXE` (seg41 `0`-`67c`, seg2 `4cc`-`821`, seg3
 * `2644`) and **recorded** by `drivers`, the list Windows starts with, and
 * `drvmsg`, whose own driver logs every call it is given:
 *
 * * The table is a row of slots, and a driver's handle is its slot's place
 *   plus one. An open takes the first free slot; the slots are linked in a
 *   list, a new one at its end once it has loaded. Each open of a module has
 *   a slot of its own and a `LoadLibrary` of its own; the first instance is
 *   the one that was loaded and enabled.
 * * A driver's name is looked up in `SYSTEM.INI`, in `[drivers]` unless a
 *   section is named: the value is the file, and the words after it are the
 *   text `DRV_OPEN` is given. A name not there is the file itself. The entry
 *   point is the module's export named `DriverProc`.
 * * A module's first open sends a call of message nought, then `DRV_LOAD`,
 *   then `DRV_ENABLE`, each with an identifier of nought; every open then
 *   sends `DRV_OPEN` with the handle as its identifier, and what it answers
 *   is the identifier after -- nought refusing the open.
 * * `CloseDriver` sends `DRV_CLOSE`, and nought refuses it. The last instance
 *   then gets `DRV_DISABLE` and `DRV_FREE`, with an identifier of nought.
 *   Every close frees the library once.
 *
 * The drivers `SYSTEM.INI`'s `[boot]` names are loaded the first time a
 * program starts, as USER loads them from its first `InitApp`: loaded and
 * enabled, but not opened.
 *
 * Not followed: the check that a driver takes exactly its 16 bytes of
 * arguments off the stack, which USER makes around the call of message
 * nought; the `OpenFile` USER makes before `LoadLibrary`, which fails as
 * `LoadLibrary` then would; the error mode it sets around the load; and the
 * messages USER broadcasts to every driver as Windows ends and as a program
 * does.
 */

const DRV_LOAD = 1;
const DRV_ENABLE = 2;
const DRV_OPEN = 3;
const DRV_CLOSE = 4;
const DRV_DISABLE = 5;
const DRV_FREE = 6;

const GND_FIRSTINSTANCEONLY = 1;
const GND_REVERSE = 2;

/** `GetDriverInfo`'s structure, whose length must be this. */
const DRIVERINFO_SIZE = 0x86;

interface Slot {
  /** Whether this is the instance that was loaded and enabled. */
  first: boolean;
  next: number;
  prev: number;
  /** The module's instance; nought for a free slot, 1 while it loads. */
  module: number;
  id: number;
  alias: string;
  /** `DriverProc`, as `GetProcAddress` gave it. */
  proc: number;
}

interface Table {
  slots: Slot[];
  head: number;
  tail: number;
}

function tableOf(system: any): Table {
  return (system._drivers ??= { slots: [], head: -1, tail: -1 });
}

function freeSlot(): Slot {
  return { first: false, next: -1, prev: -1, module: 0, id: 0, alias: '', proc: 0 };
}

/** The slot a handle names, if it is in use. */
function slotOf(table: Table, handle: number): Slot | null {
  const slot = handle >= 1 && handle <= table.slots.length ? table.slots[handle - 1] : null;

  return slot && slot.module ? slot : null;
}

/** How many slots hold a module: its instances. */
function instances(table: Table, module: number) {
  return table.slots.filter((slot) => slot.module === module).length;
}

/**
 * Calls a driver's `DriverProc`. One winbox.js keeps itself is called as
 * the function it is; one from a file, on the processor.
 */
async function callDriver(
  system: any,
  proc: number,
  id: number,
  handle: number,
  message: number,
  first: number,
  second: number
): Promise<number> {
  const own = system.modules?.fromSegment?.(indexFor((proc >>> 16) & 0xffff));

  if (own?.instance?.exports) {
    const ordinal = (proc & 0xffff) / own.step - 1;
    const entry = own.instance.exports[ordinal];

    if (entry && typeof entry[0] === 'function') {
      return (
        ((await entry[0].call(system, id >>> 0, handle, message, first >>> 0, second >>> 0)) ??
          0) >>> 0
      );
    }
  }

  const answer = await system.scheduler.callProc(proc >>> 0, [
    [id >>> 0, DWORD],
    [handle, UINT],
    [message, UINT],
    [first >>> 0, LPARAM],
    [second >>> 0, LPARAM],
  ]);

  return (answer ?? 0) >>> 0;
}

/** A message to one driver, by its handle, as `SendDriverMessage` sends it (seg2 `4cc`). */
async function sendTo(system: any, handle: number, message: number, first: number, second: number) {
  const table = tableOf(system);

  if (!table.slots.length || handle > table.slots.length || table.head === -1 || !handle) {
    return 0;
  }

  const slot = slotOf(table, handle);

  if (!slot || !slot.proc) {
    return 0;
  }

  return callDriver(system, slot.proc, slot.id, handle, message, first, second);
}

function link(table: Table, index: number) {
  const slot = table.slots[index];

  if (table.head === -1) {
    table.head = table.tail = index;
    slot.next = slot.prev = -1;
  } else {
    slot.prev = table.tail;
    slot.next = -1;
    table.slots[table.tail].next = index;
    table.tail = index;
  }
}

function unlink(table: Table, index: number) {
  const slot = table.slots[index];

  if (index === table.head) {
    table.head = slot.next;

    if (table.head === -1) {
      table.tail = -1;
      table.slots = [];
      return;
    }

    table.slots[table.head].prev = -1;
  } else if (index === table.tail) {
    table.tail = slot.prev;
    table.slots[table.tail].next = -1;
  } else {
    table.slots[slot.prev].next = slot.next;
    table.slots[slot.next].prev = slot.prev;
  }
}

/**
 * Loads a driver into a slot of its own, as USER's loader does (seg41
 * `165`): its handle, and the text after its file's name, or null.
 */
async function loadDriver(system: any, name: string, section: string | null, enable: boolean) {
  if (!name) {
    return null;
  }

  const table = tableOf(system);

  /* The row grows by one, and the first free slot is taken; the row gives
   * the slot back if it was not the new last one. */
  table.slots.push(freeSlot());

  let index = table.slots.findIndex((slot) => !slot.module);

  if (index !== table.slots.length - 1) {
    table.slots.pop();
    index = table.slots.findIndex((slot) => !slot.module);
  }

  const slot = table.slots[index];
  const handle = index + 1;

  Object.assign(slot, freeSlot(), { module: 1 });

  const profile = await readProfile(system, 'SYSTEM.INI');
  const value = profile.get(section ?? 'DRIVERS', name) ?? name;
  const space = value.indexOf(' ');
  const file = space < 0 ? value : value.slice(0, space);
  const words = space < 0 ? '' : value.slice(space + 1);

  const module = await LoadLibrary.call(system, file);

  if (module < 32) {
    slot.module = 0;
    return null;
  }

  const proc = GetProcAddress.call(system, module, 'DriverProc') >>> 0;

  if (!proc) {
    await FreeLibrary.call(system, module);
    slot.module = 0;
    return null;
  }

  slot.module = module;
  slot.alias = name;
  slot.proc = proc;

  if (instances(table, module) === 1) {
    await callDriver(system, proc, 0, handle, 0, 0, 0);

    if (!(await callDriver(system, proc, slot.id, handle, DRV_LOAD, 0, 0))) {
      await FreeLibrary.call(system, module);
      Object.assign(slot, freeSlot());
      return null;
    }

    slot.first = true;
  }

  link(table, index);

  if (enable && slot.first) {
    await sendTo(system, handle, DRV_ENABLE, 0, 0);
  }

  return { handle, words };
}

/**
 * Lets a slot go (seg41 `38a`): the last instance disabled, if asked, and
 * freed; the library freed once; the slot out of the list. Answers how many
 * instances are left.
 */
async function releaseSlot(system: any, handle: number, disable: boolean) {
  const table = tableOf(system);
  const slot = table.slots[handle - 1];
  const module = slot.module;

  slot.id = 0;

  const count = instances(table, module);

  if (count === 1) {
    if (disable) {
      await sendTo(system, handle, DRV_DISABLE, 0, 0);
    }

    await sendTo(system, handle, DRV_FREE, 0, 0);
  }

  await FreeLibrary.call(system, module);

  slot.module = 0;
  slot.first = false;
  slot.proc = 0;
  unlink(table, handle - 1);

  return count - 1;
}

/**
 * Loads the drivers `SYSTEM.INI`'s `[boot]` names in `drivers=`, as USER
 * does from the first `InitApp` (seg3 `2644`): each loaded and enabled,
 * under the name as written, and not opened. One that fails is passed over.
 */
export async function loadInstallableDrivers(system: any) {
  if (system._driversLoaded) {
    return;
  }

  system._driversLoaded = true;

  const profile = await readProfile(system, 'SYSTEM.INI');
  const names = String(profile.get('boot', 'DRIVERS') ?? '')
    .split(/[ ,]/)
    .filter(Boolean);

  for (const name of names) {
    await loadDriver(system, name, null, true);
  }
}

/** The words after a driver's file's name, where `DRV_OPEN`'s first parameter can point. */
function wordsAt(system: any, words: string) {
  const block = GlobalAlloc.call(system, 0x42, words.length + 1);
  const far = GlobalLock.call(system, block) >>> 0;
  const core = system.machine.cpu.core;

  Array.from(words).forEach((character, i) =>
    core.write8(far >>> 16, (far & 0xffff) + i, character.charCodeAt(0) & 0xff)
  );
  core.write8(far >>> 16, (far & 0xffff) + words.length, 0);

  return { block, far };
}

/**
 * Opens a driver, loading it if it is not.
 *
 * @param {Types.LPCSTR} lpDriverName - Its name in the section, or its file.
 * @param {Types.LPCSTR} lpSectionName - The section of `SYSTEM.INI`; `[drivers]` for none.
 * @param {Types.LPARAM} lParam - Handed to `DRV_OPEN`.
 *
 * @returns {Types.HANDLE} The driver, or nought.
 */
export async function OpenDriver(this: any, lpDriverName: any, lpSectionName: any, lParam: number) {
  const loaded = await loadDriver(
    this,
    lpDriverName === null || lpDriverName === undefined ? '' : String(lpDriverName),
    lpSectionName === null || lpSectionName === undefined ? null : String(lpSectionName),
    true
  );

  if (!loaded) {
    return 0;
  }

  const { handle, words } = loaded;
  const slot = tableOf(this).slots[handle - 1];
  const text = wordsAt(this, words);

  slot.id = handle;

  const answer = await sendTo(this, handle, DRV_OPEN, text.far, lParam);

  GlobalFree.call(this, text.block);

  if (!answer) {
    await releaseSlot(this, handle, true);
    return 0;
  }

  slot.id = answer;

  return handle;
}

/**
 * Closes a driver: `DRV_CLOSE`, and, if it agrees, the instance let go.
 *
 * @param {Types.HANDLE} hdrvr - The driver.
 * @param {Types.LPARAM} lParam1 - Handed to `DRV_CLOSE`.
 * @param {Types.LPARAM} lParam2 - Handed to `DRV_CLOSE`.
 *
 * @returns {Types.LRESULT} What `DRV_CLOSE` answered.
 */
export async function CloseDriver(this: any, hdrvr: number, lParam1: number, lParam2: number) {
  const table = tableOf(this);
  const slot = slotOf(table, hdrvr);

  if (!slot) {
    return 0;
  }

  const answer = await sendTo(this, hdrvr, DRV_CLOSE, lParam1, lParam2);

  if (!answer) {
    return 0;
  }

  const wasFirst = slot.first;
  const module = slot.module;
  const left = await releaseSlot(this, hdrvr, true);

  /* The lowest remaining instance is the first now (seg41 `5e8`). */
  if (left && wasFirst) {
    const heir = table.slots.find((one) => one.module === module);

    if (heir) {
      heir.first = true;
    }
  }

  return answer;
}

/**
 * A message to a driver, answered by its `DriverProc` with its identifier.
 *
 * @returns {Types.LRESULT} The driver's answer, or nought.
 */
export async function SendDriverMessage(
  this: any,
  hdrvr: number,
  msg: number,
  lParam1: number,
  lParam2: number
) {
  return sendTo(this, hdrvr, msg, lParam1, lParam2);
}

/**
 * The next driver in the list: from its start for none, backwards with
 * `GND_REVERSE`, only the instances that were loaded with
 * `GND_FIRSTINSTANCEONLY` (seg2 `6dd`).
 *
 * @returns {Types.HANDLE} The driver, or nought at the end.
 */
export function GetNextDriver(this: any, hdrvr: number, fdwFlag: number) {
  const table = tableOf(this);

  if (!table.slots.length || table.head === -1 || hdrvr > table.slots.length) {
    return 0;
  }

  const reverse = !!(fdwFlag & GND_REVERSE);
  let index: number;

  if (!hdrvr) {
    index = reverse ? table.tail : table.head;
  } else if (hdrvr - 1 === (reverse ? table.head : table.tail)) {
    return 0;
  } else {
    const slot = table.slots[hdrvr - 1];

    index = reverse ? slot.prev : slot.next;
  }

  while (index !== -1) {
    const slot = table.slots[index];

    if (!slot.module) {
      return 0;
    }

    if (!(fdwFlag & GND_FIRSTINSTANCEONLY) || slot.first) {
      return index + 1;
    }

    index = reverse ? slot.prev : slot.next;
  }

  return 0;
}

/**
 * A driver's handle, module and alias, into a structure whose length must be
 * 86h.
 *
 * @returns {Types.BOOL} 1, or nought.
 */
export function GetDriverInfo(this: any, hdrvr: number, lpDriverInfo: number) {
  const slot = slotOf(tableOf(this), hdrvr);
  const core = this.machine.cpu.core;
  const segment = (lpDriverInfo >>> 16) & 0xffff;
  const offset = lpDriverInfo & 0xffff;

  if (!lpDriverInfo || !slot || core.read16(segment, offset) !== DRIVERINFO_SIZE) {
    return 0;
  }

  core.write16(segment, (offset + 2) & 0xffff, hdrvr);
  core.write16(segment, (offset + 4) & 0xffff, slot.module);
  Array.from(slot.alias).forEach((character, i) =>
    core.write8(segment, (offset + 6 + i) & 0xffff, character.charCodeAt(0) & 0xff)
  );
  core.write8(segment, (offset + 6 + slot.alias.length) & 0xffff, 0);

  return 1;
}

/** @returns {Types.HINSTANCE} The driver's module, or nought. */
export function GetDriverModuleHandle(this: any, hdrvr: number) {
  const table = tableOf(this);

  return hdrvr >= 1 && hdrvr <= table.slots.length ? table.slots[hdrvr - 1].module : 0;
}

/**
 * What a driver answers for a message it leaves alone: 1 for `DRV_LOAD`,
 * `DRV_ENABLE`, `DRV_DISABLE`, `DRV_FREE` and `DRV_INSTALL`, nought for the
 * rest (seg2 `7f3`). **Recorded** by `drvmsg` with an open driver. With no
 * driver, every one answered nought, which is the argument check's.
 *
 * @returns {Types.LRESULT} The answer.
 */
export function DefDriverProc(
  this: any,
  _dwDriverIdentifier: number,
  hdrvr: number,
  msg: number,
  _lParam1: number,
  _lParam2: number
) {
  if (!hdrvr) {
    return 0;
  }

  return [DRV_LOAD, DRV_ENABLE, DRV_DISABLE, DRV_FREE, 9].includes(msg) ? 1 : 0;
}

export { DRV_CLOSE, DRV_OPEN };
