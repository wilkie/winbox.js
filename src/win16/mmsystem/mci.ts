'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { readProfile } from '../kernel/profiles.js';
import {
  CloseDriver,
  GetDriverModuleHandle,
  OpenDriver,
  SendDriverMessage,
} from '../user/drivers.js';
import { moduleString, mmsystemString } from './devices.js';

/**
 * MCI, MMSYSTEM's media control interface: `mciSendCommand` and the calls
 * about its devices.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg5 `4af`-`2c16`) and **recorded** by
 * `mcidevs`, which opens each device `SYSTEM.INI`'s `[mci]` names by its
 * type, asks its capabilities and product, and closes it, as Media Player
 * does as it starts:
 *
 * * A device is opened by its type, the key naming its driver in `[mci]` --
 *   or the key with a digit after it, or its driver's file's name -- or by
 *   a file whose extension `WIN.INI`'s `[mci extensions]` names a type for.
 *   Its driver is opened as an installable driver, in the section `mci`,
 *   handed the new device's ID and the words after the driver's file's
 *   name, and sent `MCI_OPEN_DRIVER`. A type nothing names is 107h, a driver
 *   that cannot be opened 10Ah: CDAudio, whose `MCICDA.DRV` the
 *   installation lacks.
 * * Device IDs count from 1, the lowest free one taken.
 * * `MCI_CLOSE` sends `MCI_CLOSE_DRIVER` and closes the driver. `MCI_SYSINFO`
 *   and `MCI_BREAK` MMSYSTEM answers itself. Every other command goes to the
 *   device's driver as it is; one for an ID not open is 101h, and one for
 *   FFFFh goes to every device the task opened.
 * * The answer is the low word of the driver's; with 10000h in it, the high
 *   word of the caller's `dwReturn` is cleared; an error of 200h and up has
 *   the device's ID in its high word.
 *
 * Not followed: `MCI_SOUND`, whose `sndPlaySound` winbox.js does not have;
 * opening by element ID; the devices `mciSendString` opens itself; the
 * command tables, which only `mciSendString` reads.
 */

const MCI_ALL_DEVICE_ID = 0xffff;

const MCI_OPEN_DRIVER = 0x801;
const MCI_CLOSE_DRIVER = 0x802;
const MCI_OPEN = 0x803;
const MCI_CLOSE = 0x804;
const MCI_SYSINFO = 0x810;
const MCI_BREAK = 0x811;
const MCI_SOUND = 0x812;

const MCI_NOTIFY = 0x1;
const MCI_OPEN_ELEMENT = 0x200;
const MCI_OPEN_ALIAS = 0x400;
const MCI_OPEN_ELEMENT_ID = 0x800;
const MCI_OPEN_TYPE_ID = 0x1000;
const MCI_OPEN_TYPE = 0x2000;

const MCIERR_INVALID_DEVICE_ID = 0x101;
const MCIERR_INVALID_DEVICE_NAME = 0x107;
const MCIERR_DEVICE_OPEN = 0x109;
const MCIERR_CANNOT_LOAD_DRIVER = 0x10a;
const MCIERR_PARAM_OVERFLOW = 0x10c;
const MCIERR_MISSING_PARAMETER = 0x111;
const MCIERR_CANNOT_USE_ALL = 0x117;
const MCIERR_MULTIPLE = 0x118;
const MCIERR_EXTENSION_NOT_FOUND = 0x119;
const MCIERR_OUTOFRANGE = 0x11a;
const MCIERR_FLAGS_NOT_COMPATIBLE = 0x11c;
const MCIERR_DEVICE_TYPE_REQUIRED = 0x11f;
const MCIERR_DEVICE_LOCKED = 0x120;
const MCIERR_DUPLICATE_ALIAS = 0x121;
const MCIERR_NULL_PARAMETER_BLOCK = 0x129;
const MCIERR_NO_ELEMENT_ALLOWED = 0x131;
const MCIERR_DEVICE_NOT_INSTALLED = 0x132;
const MCIERR_DEVICE_LENGTH = 0x136;

const RESOURCE_RETURNED = 0x10000;

interface Device {
  name: string;
  type: string;
  hDriver: number;
  module: number;
  wType: number;
  task: number;
  closing: boolean;
  data: number;
  breakKey: number | null;
}

interface Table {
  devices: (Device | null)[];
  count: number;
}

function tableOf(system: any): Table {
  return (system._mci ??= { devices: [], count: 1 });
}

function taskOf(system: any) {
  return system.scheduler?.active ?? 0;
}

function core(system: any) {
  return system.machine.cpu.core;
}

function readFar(system: any, far: number) {
  return (
    core(system).read16(far >>> 16, far & 0xffff) |
    (core(system).read16(far >>> 16, ((far & 0xffff) + 2) & 0xffff) << 16)
  );
}

function readString(system: any, far: number) {
  if (!(far >>> 16)) {
    return null;
  }

  let text = '';

  for (let at = far & 0xffff; ; at = (at + 1) & 0xffff) {
    const byte = core(system).read8(far >>> 16, at);

    if (!byte) {
      return text;
    }

    text += String.fromCharCode(byte);
  }
}

/** A string in a block of its own, as a far pointer, for the driver. */
function stringAt(system: any, text: string) {
  const block = GlobalAlloc.call(system, 0x42, text.length + 1);
  const far = globalPointer.call(system, block) >>> 0;

  Array.from(text).forEach((character, i) =>
    core(system).write8(far >>> 16, (far & 0xffff) + i, character.charCodeAt(0) & 0xff)
  );

  return { block, far };
}

/** The ID a name is open as for a task (seg5 `14f5`): FFFFh for "all", nought for none. */
export function find(system: any, task: number, name: string) {
  if (name.toLowerCase() === 'all') {
    return MCI_ALL_DEVICE_ID;
  }

  const table = tableOf(system);

  for (let id = 1; id < table.count; id++) {
    const device = table.devices[id];

    if (device && device.task === task && device.name.toLowerCase() === name.toLowerCase()) {
      return id;
    }
  }

  return 0;
}

/** The type a file's extension names in `[mci extensions]`, or null (seg5 `2249`). */
async function typeOfFile(system: any, element: string) {
  if (element.includes('!') || element.length < 2 || element.endsWith('.')) {
    return null;
  }

  const dot = element.lastIndexOf('.');
  const extension = dot >= 0 ? element.slice(dot + 1) : '';

  if (!extension || extension.length > 3 || /[\\/]/.test(extension)) {
    return null;
  }

  return (await readProfile(system, 'WIN.INI')).get('mci extensions', extension) || null;
}

/** The driver a type names in `[mci]` (seg5 `1e77`, `1cb4`): the key used and its value, or an error. */
async function driverOf(
  system: any,
  type: string
): Promise<{ key: string; value: string } | number> {
  const profile = await readProfile(system, 'system.ini');

  for (const key of [type, ...Array.from({ length: 9 }, (_, i) => `${type}${i + 1}`)]) {
    const value = profile.get('mci', key);

    if (value) {
      return { key, value };
    }
  }

  const keys = profile.entries('mci');

  if (!keys.length) {
    return MCIERR_DEVICE_NOT_INSTALLED;
  }

  if (type.length >= 0x50) {
    return MCIERR_DEVICE_LENGTH;
  }

  for (const key of keys) {
    const value = profile.get('mci', key) ?? '';

    if (!value) {
      return MCIERR_CANNOT_LOAD_DRIVER;
    }

    const file = value
      .split(' ')[0]
      .split(/[\\/:]/)
      .pop()!;

    if (file.startsWith(type) && (file.length === type.length || file[type.length] === '.')) {
      return key.length >= 0x50 ? MCIERR_DEVICE_LENGTH : { key, value };
    }
  }

  return MCIERR_INVALID_DEVICE_NAME;
}

/** A new device's ID (seg5 `19b4`): the lowest free, or the next. */
function allocate(table: Table) {
  for (let id = 1; id < table.count; id++) {
    if (!table.devices[id]) {
      return id;
    }
  }

  return table.count++;
}

function release(table: Table, id: number) {
  table.devices[id] = null;

  if (id === table.count - 1) {
    table.count--;
  }
}

/** `MCI_OPEN` (seg5 `24e4`, `1e77`). */
async function open(system: any, flags: number, parms: number) {
  if (!parms) {
    return MCIERR_NULL_PARAMETER_BLOCK;
  }

  const c = core(system);
  const segment = parms >>> 16;
  const offset = parms & 0xffff;
  const typeFar = readFar(system, (parms + 8) >>> 0);
  /* Each pointer is read only when its flag says it is there: the rest may
   * be anything. */
  let type =
    flags & MCI_OPEN_TYPE && !(flags & MCI_OPEN_TYPE_ID) ? readString(system, typeFar) : null;
  let element =
    flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)
      ? readString(system, readFar(system, (parms + 0x0c) >>> 0))
      : null;
  const alias =
    flags & MCI_OPEN_ALIAS ? readString(system, readFar(system, (parms + 0x10) >>> 0)) : null;
  const task = taskOf(system);

  if (flags & MCI_OPEN_TYPE_ID) {
    const named = await mmsystemString(system, typeFar & 0xffff);

    if (named === null) {
      return MCIERR_EXTENSION_NOT_FOUND;
    }

    type = named + (typeFar >>> 16 ? String(typeFar >>> 16) : '');
  }

  const name = flags & MCI_OPEN_ELEMENT ? element : flags & MCI_OPEN_TYPE ? type : undefined;

  if (name === undefined) {
    return MCIERR_MISSING_PARAMETER;
  }

  if (name === null) {
    return MCIERR_INVALID_DEVICE_NAME;
  }

  if (
    !(flags & MCI_OPEN_ELEMENT_ID) &&
    find(system, task, flags & MCI_OPEN_ALIAS ? (alias ?? '') : name)
  ) {
    return flags & MCI_OPEN_ALIAS ? MCIERR_DUPLICATE_ALIAS : MCIERR_DEVICE_OPEN;
  }

  if (!(flags & MCI_OPEN_TYPE_ID)) {
    if (flags & MCI_OPEN_ELEMENT && !(flags & MCI_OPEN_TYPE)) {
      type = await typeOfFile(system, element ?? '');

      if (!type) {
        return MCIERR_EXTENSION_NOT_FOUND;
      }

      flags |= MCI_OPEN_TYPE;
    } else if (flags & MCI_OPEN_TYPE && !(flags & MCI_OPEN_ELEMENT)) {
      const named = await typeOfFile(system, type ?? '');

      if (named) {
        element = type;
        type = named;
        flags |= MCI_OPEN_ELEMENT;
      } else if (type?.includes('!')) {
        const [kind, part] = type.split('!');

        if (!kind) {
          return MCIERR_NO_ELEMENT_ALLOWED;
        }

        if (part) {
          if (!(flags & MCI_OPEN_ALIAS) && find(system, task, part)) {
            return MCIERR_DEVICE_OPEN;
          }

          element = part;
          flags |= MCI_OPEN_ELEMENT;
        }

        type = kind;
      }
    }
  }

  /* The alias, when none is given: the element, or the type. */
  let deviceName = flags & MCI_OPEN_ALIAS ? (alias ?? '') : null;

  if (!(flags & MCI_OPEN_ALIAS)) {
    deviceName = flags & MCI_OPEN_ELEMENT ? (flags & MCI_OPEN_ELEMENT_ID ? null : element) : type;

    if (deviceName !== null) {
      flags |= MCI_OPEN_ALIAS;
    }
  }

  const driver = await driverOf(system, type ?? '');

  if (typeof driver === 'number') {
    return driver;
  }

  const space = driver.value.indexOf(' ');
  const file = space < 0 ? driver.value : driver.value.slice(0, space);
  const words = space < 0 ? '' : driver.value.slice(space + 1);
  const table = tableOf(system);
  const id = allocate(table);

  table.devices[id] = {
    name: deviceName ?? element ?? type ?? '',
    type: driver.key,
    hDriver: 0,
    module: 0,
    wType: 0,
    task,
    closing: false,
    data: 0,
    breakKey: null,
  };

  /* MCI_OPEN_DRIVER_PARMS: the ID, the words after the driver's name, the
   * command table and the type, the last two the driver's to fill. */
  const params = stringAt(system, words);
  const block = GlobalAlloc.call(system, 0x42, 10);
  const openParms = globalPointer.call(system, block) >>> 0;

  c.write16(openParms >>> 16, openParms & 0xffff, id);
  c.write16(openParms >>> 16, (openParms & 0xffff) + 2, params.far & 0xffff);
  c.write16(openParms >>> 16, (openParms & 0xffff) + 4, params.far >>> 16);
  c.write16(openParms >>> 16, (openParms & 0xffff) + 6, 0xffff);
  c.write16(openParms >>> 16, (openParms & 0xffff) + 8, 0);

  const hDriver = await OpenDriver.call(system, file, 'mci', openParms);
  const wType = c.read16(openParms >>> 16, (openParms & 0xffff) + 8);

  GlobalFree.call(system, block);
  GlobalFree.call(system, params.block);

  if (!hDriver) {
    release(table, id);
    return MCIERR_CANNOT_LOAD_DRIVER;
  }

  c.write16(segment, (offset + 4) & 0xffff, id);
  c.write16(segment, (offset + 6) & 0xffff, 0);

  const device = table.devices[id]!;

  device.hDriver = hDriver;
  device.module = GetDriverModuleHandle.call(system, hDriver);
  device.wType = wType;

  const answer = (await mciSendCommand.call(system, id, MCI_OPEN_DRIVER, flags, parms)) & 0xffff;

  if (answer) {
    await close(system, id, 0, 0, false);
    return answer;
  }

  device.breakKey = 3;

  return 0;
}

/** `MCI_CLOSE` (seg5 `2926`): `MCI_CLOSE_DRIVER` if asked, then the driver closed and the ID let go. */
async function close(system: any, id: number, flags: number, parms: number, sendClose: boolean) {
  const table = tableOf(system);
  const device = table.devices[id];

  if (!device || device.closing) {
    return 0;
  }

  device.closing = true;

  let answer = 0;

  if (sendClose) {
    let dummy: number | null = null;

    if (!parms) {
      dummy = GlobalAlloc.call(system, 0x42, 10);
      parms = globalPointer.call(system, dummy) >>> 0;
    }

    answer = (await mciSendCommand.call(system, id, MCI_CLOSE_DRIVER, flags, parms)) & 0xffff;

    if (dummy) {
      GlobalFree.call(system, dummy);
    }
  }

  await CloseDriver.call(system, device.hDriver, 0, 0);
  release(table, id);

  return answer;
}

/** `MCI_SYSINFO` (seg5 `16bb`): the devices installed, or open. */
async function sysinfo(system: any, id: number, flags: number, parms: number) {
  const c = core(system);
  const segment = parms >>> 16;
  const offset = parms & 0xffff;
  const QUANTITY = 0x100;
  const OPEN = 0x200;
  const NAME = 0x400;
  const INSTALLNAME = 0x800;
  const returnFar = readFar(system, (parms + 4) >>> 0);
  const size = readFar(system, (parms + 8) >>> 0);
  const number = readFar(system, (parms + 0x0c) >>> 0);
  const wType = c.read16(segment, (offset + 0x10) & 0xffff);
  const write = (text: string) =>
    Array.from(text + '\0').forEach((character, i) =>
      c.write8(
        returnFar >>> 16,
        ((returnFar & 0xffff) + i) & 0xffff,
        character.charCodeAt(0) & 0xff
      )
    );
  const writeLong = (value: number) => {
    c.write16(returnFar >>> 16, returnFar & 0xffff, value & 0xffff);
    c.write16(returnFar >>> 16, ((returnFar & 0xffff) + 2) & 0xffff, value >>> 16);
  };

  if (flags & NAME && !number) {
    return MCIERR_OUTOFRANGE;
  }

  if (!returnFar || !size) {
    return MCIERR_PARAM_OVERFLOW;
  }

  if (flags & NAME && flags & QUANTITY) {
    return MCIERR_FLAGS_NOT_COMPATIBLE;
  }

  if (flags & INSTALLNAME) {
    const device = id !== MCI_ALL_DEVICE_ID ? tableOf(system).devices[id] : null;

    if (id === MCI_ALL_DEVICE_ID) {
      return MCIERR_CANNOT_USE_ALL;
    }

    if (!device) {
      return MCIERR_INVALID_DEVICE_NAME;
    }

    if (device.type.length >= size) {
      return MCIERR_PARAM_OVERFLOW;
    }

    write(device.type);
    return 0;
  }

  if (!(flags & OPEN)) {
    if (id !== MCI_ALL_DEVICE_ID && !wType) {
      return MCIERR_DEVICE_TYPE_REQUIRED;
    }

    if (!(flags & (QUANTITY | NAME))) {
      return MCIERR_MISSING_PARAMETER;
    }

    const keys = (await readProfile(system, 'system.ini')).entries('mci');
    const names = await Promise.all(
      Array.from({ length: 11 }, (_, i) => mmsystemString(system, 0x201 + i))
    );
    const matching =
      id === MCI_ALL_DEVICE_ID
        ? keys
        : keys.filter((key: string) => {
            const typeName = names[wType - 0x201];

            return !!typeName && new RegExp(`^${typeName}\\d*$`, 'i').test(key);
          });

    if (flags & QUANTITY) {
      writeLong(matching.length);
      return RESOURCE_RETURNED;
    }

    if (number > matching.length) {
      return MCIERR_OUTOFRANGE;
    }

    write(matching[number - 1]);
    return 0;
  }

  const task = taskOf(system);
  const open = tableOf(system)
    .devices.filter((device): device is Device => !!device)
    .filter(
      (device) => device.task === task && (id === MCI_ALL_DEVICE_ID || device.wType === wType)
    );

  if (flags & QUANTITY) {
    if (size >= 4) {
      writeLong(open.length);
    }

    return RESOURCE_RETURNED;
  }

  if (number > open.length) {
    c.write16(segment, (offset + 4) & 0xffff, 0);
    c.write16(segment, (offset + 6) & 0xffff, 0);
    return MCIERR_OUTOFRANGE;
  }

  write(open[number - 1].name);
  return 0;
}

/** `MCI_BREAK` (seg5 `bc`): the key that breaks a wait, or none. */
function breakKey(system: any, id: number, flags: number, parms: number) {
  const KEY = 0x100;
  const OFF = 0x400;
  const device = tableOf(system).devices[id];

  if (flags & KEY && flags & OFF) {
    return MCIERR_FLAGS_NOT_COMPATIBLE;
  }

  if (flags & KEY) {
    if (!device) {
      return 0x0b;
    }

    device.breakKey = core(system).read16(parms >>> 16, ((parms & 0xffff) + 4) & 0xffff);
    return 0;
  }

  if (flags & OFF) {
    if (device) {
      device.breakKey = null;
    }

    return 0;
  }

  return MCIERR_MISSING_PARAMETER;
}

/** A command to one device (seg5 `18d`). */
async function route(system: any, id: number, message: number, flags: number, parms: number) {
  switch (message) {
    case MCI_OPEN:
      return (await open(system, flags, parms)) & 0xffff;

    case MCI_CLOSE:
      return close(system, id, flags, parms, true);

    case MCI_SYSINFO:
      return sysinfo(system, id, flags, parms);

    case MCI_BREAK:
      return breakKey(system, id, flags, parms);

    case MCI_SOUND:
      /* `sndPlaySound`, which winbox.js does not have: it answers FALSE. */
      return 0x106;

    default:
      return (
        (await SendDriverMessage.call(
          system,
          tableOf(system).devices[id]!.hDriver,
          message,
          flags,
          parms
        )) >>> 0
      );
  }
}

/** One device's command, as the dispatcher checks it (seg5 `2e2`). */
async function dispatch(system: any, id: number, message: number, flags: number, parms: number) {
  const table = tableOf(system);

  if (id === MCI_ALL_DEVICE_ID) {
    if (message === MCI_SYSINFO || message === MCI_SOUND) {
      return route(system, id, message, flags, parms);
    }

    if (message === MCI_OPEN) {
      return MCIERR_CANNOT_USE_ALL;
    }

    const task = taskOf(system);
    let total = 0;

    for (let each = 1; each < table.count; each++) {
      const device = table.devices[each];

      if (!device || device.task !== task) {
        continue;
      }

      if (device.closing && message !== MCI_CLOSE_DRIVER) {
        return total;
      }

      const answer = await route(system, each, message, flags, parms);

      if (answer) {
        total = total ? MCIERR_MULTIPLE : answer;
      }
    }

    return total;
  }

  if (message !== MCI_OPEN && message !== MCI_SOUND && message !== MCI_SYSINFO) {
    const device = id && id < table.count ? table.devices[id] : null;

    if (!device) {
      return MCIERR_INVALID_DEVICE_ID;
    }

    if (device.closing && message !== MCI_CLOSE_DRIVER) {
      return MCIERR_DEVICE_LOCKED;
    }
  }

  return route(system, id, message, flags, parms);
}

/**
 * Sends a device a command.
 *
 * @param {Types.UINT} wDeviceID - The device, FFFFh for all the task's, or
 *   nought to open one.
 * @param {Types.UINT} wMessage - The command.
 * @param {Types.DWORD} dwParam1 - Its flags.
 * @param {Types.DWORD} dwParam2 - Its parameter block.
 *
 * @returns {Types.DWORD} Nought, or an error; a driver's own with the ID.
 */
export async function mciSendCommand(
  this: any,
  wDeviceID: number,
  wMessage: number,
  dwParam1: number,
  dwParam2: number
) {
  return (await mciSendCommandGiven(this, wDeviceID, wMessage, dwParam1, dwParam2))[0];
}

/**
 * `mciSendCommand`, and what the driver says its answer is given back as
 * where it succeeds: the high word of its return, as
 * `MCI_COLONIZED4_RETURN`, which `mciSendString` reads. As the Rust
 * engine's `mci_send_command_given` has it.
 */
export async function mciSendCommandGiven(
  system: any,
  wDeviceID: number,
  wMessage: number,
  dwParam1: number,
  dwParam2: number
): Promise<[number, number]> {
  const id = wDeviceID & 0xffff;
  const answer =
    (await dispatch(system, id, wMessage & 0xffff, dwParam1 >>> 0, dwParam2 >>> 0)) >>> 0;

  if (answer & RESOURCE_RETURNED && dwParam2) {
    core(system).write16(dwParam2 >>> 16, ((dwParam2 & 0xffff) + 6) & 0xffff, 0);
  }

  const low = answer & 0xffff;

  if (low >= 0x200) {
    return [(low | (id << 16)) >>> 0, 0];
  }

  return [low, low === 0 ? (answer & 0xffff0000) >>> 0 : 0];
}

/**
 * The text of an MCI error (seg5 `136f`): MMSYSTEM's string of its number,
 * or, for a driver's own, with a device's ID, the driver's.
 *
 * @returns {Types.BOOL} Whether there was a text.
 */
export async function mciGetErrorString(
  this: any,
  dwError: number,
  lpstrBuffer: number,
  wLength: number
) {
  if (!lpstrBuffer) {
    return 0;
  }

  const id = dwError >>> 16;
  const number = dwError & 0xffff;
  const device = id ? tableOf(this).devices[id] : null;
  let text: string | null;

  if (id && device?.module) {
    text = await moduleString(this, this.handles.resolve(device.module)?.path ?? '', number);
  } else {
    text = await mmsystemString(this, id ? 0x116 : number);
  }

  const size = wLength & 0xffff;

  if (text === null) {
    if (size) {
      core(this).write8(lpstrBuffer >>> 16, lpstrBuffer & 0xffff, 0);
    }

    return 0;
  }

  const count = Math.min(text.length, Math.max(0, size - 1));

  for (let i = 0; i <= count; i++) {
    core(this).write8(
      lpstrBuffer >>> 16,
      ((lpstrBuffer & 0xffff) + i) & 0xffff,
      i < count ? text.charCodeAt(i) & 0xff : 0
    );
  }

  return 1;
}

/** @returns {Types.UINT} The ID a name is open as for the task: FFFFh for "all", nought for none. */
export function mciGetDeviceID(this: any, lpstrName: any) {
  return lpstrName === null || lpstrName === undefined
    ? 0
    : find(this, taskOf(this), String(lpstrName));
}

/** @returns {Types.DWORD} The data a driver keeps with a device, nought for none. */
export function mciGetDriverData(this: any, wDeviceID: number) {
  return tableOf(this).devices[wDeviceID & 0xffff]?.data ?? 0;
}

/** @returns {Types.BOOL} Whether the device is open, its driver's data kept. */
export function mciSetDriverData(this: any, wDeviceID: number, dwData: number) {
  const device = tableOf(this).devices[wDeviceID & 0xffff];

  if (!device) {
    return 0;
  }

  device.data = dwData >>> 0;

  return 1;
}

export { MCI_NOTIFY };
