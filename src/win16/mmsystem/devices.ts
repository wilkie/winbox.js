'use strict';

import { GetProcAddress } from '../kernel/GetProcAddress.js';
import { readProfile } from '../kernel/profiles.js';
import { DWORD, UINT } from '../types.js';
import { CloseDriver, GetDriverModuleHandle, OpenDriver } from '../user/drivers.js';
import { MMSYSTEM_STRINGS } from './strings.js';

/**
 * MMSYSTEM's device layer: the waveform, MIDI and auxiliary drivers it
 * installs, how it numbers their devices, the handles it makes for the
 * devices a program opens, and the messages it sends a driver. The twin of
 * the Rust engine's `mmsystem/devices.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg2 `101`-`6e8`, seg3 `79c`-`864`, seg6
 * `bc`-`15c`, seg8 `492`-`52e`, seg1 `1e8`, seg4 `2e6`-`350`):
 *
 * * As it loads, MMSYSTEM opens each driver `[drivers]` names `wave`,
 *   `wave1` to `wave9`, through USER's `OpenDriver`, and installs it as a
 *   waveform output driver; then opens the name again and installs that as
 *   a waveform input driver. A name with no value is passed over. If any
 *   waveform device came of it, `wavemapper` is opened and installed the
 *   same two ways as each kind's mapper. `midi` to `midi9` and `midimapper`
 *   follow, output then input; then, if there is any device at all,
 *   MMSYSTEM readies its interrupt stacks (`stacks.ts`); then `aux` to
 *   `aux9`, and `auxmapper` if an auxiliary device came of them.
 * * Installing (`mmDrvInstall`, seg2 `484`) finds the driver's entry point by
 *   its name -- `wodMessage`, `widMessage`, `modMessage`, `midMessage` or
 *   `auxMessage` -- in the driver's module. One not there, or already
 *   installed, is refused. Each kind has ten places and the mapper's: the
 *   first free place takes a driver. The driver is sent `DRVM_INIT` (64h),
 *   whatever it answers, and then asked how many devices it has
 *   (`WODM_GETNUMDEVS` and the like); an answer of 64 K or more is refused.
 *   A refused driver is closed. The kind's count is the sum of its drivers'
 *   devices, the mapper's left out.
 * * A device's number counts across the drivers in their places, each
 *   driver's devices numbered from nought within it. A number past the
 *   count is `MMSYSERR_BADDEVICEID` (2); the mapper's, `FFFFh`, is the
 *   mapper's place, and where no mapper was installed a message for it is
 *   `MMSYSERR_NODRIVER` (6).
 * * A device opened has a handle MMSYSTEM makes, which names the kind it is
 *   -- waveform output 1, input 2, MIDI output 3, input 4 -- and the task
 *   that made it. Every call on a handle checks the kind first: a handle of
 *   another kind, or one closed, is `MMSYSERR_INVALHANDLE` (5).
 * * A message for a handle goes to the driver's entry point with the
 *   device's number within the driver, the message, the driver's own
 *   doubleword and the two parameters; one for a device by number, with
 *   nought for the driver's own.
 *
 * The handles' numbers are WinBox's own: MMSYSTEM's are offsets of blocks in
 * its local heap; they are numbered from `1006h` in steps of `10h`, a freed
 * one taken again first. The doubleword a driver keeps for a MIDI device is
 * in MMSYSTEM's data segment, at the handle and 4, as it is in Windows.
 *
 * This engine has no driver of its own -- no sound card -- and so installs
 * only drivers from files, which run on the processor; on the installation
 * it runs there are none, and every count is 0 (**recorded** by `mmdevs`).
 */

export const MMSYSERR_NOERROR = 0;
export const MMSYSERR_BADDEVICEID = 2;
export const MMSYSERR_ALLOCATED = 4;
export const MMSYSERR_INVALHANDLE = 5;
export const MMSYSERR_NODRIVER = 6;
export const MMSYSERR_NOMEM = 7;
export const MMSYSERR_NOTSUPPORTED = 8;
export const MMSYSERR_BADERRNUM = 9;
export const MMSYSERR_INVALFLAG = 10;
export const MMSYSERR_INVALPARAM = 11;

/** The number a mapper is opened and asked by. */
export const MAPPER = 0xffff;

/** What every driver is sent as it is installed. */
const DRVM_INIT = 0x64;

/** `mmDrvInstall`'s flags. */
export const MMDRVI_HDRV = 0x4000;
export const MMDRVI_MAPPER = 0x8000;
export const MMDRVI_REMOVE = 0x2000;

const PLACES = 11;
const MAPPER_PLACE = 10;

const HANDLE_FIRST = 0x1006;
const HANDLE_STEP = 0x10;

/** A kind of device, numbered as `mmDrvInstall`'s flags number them. */
export const Kind = { WaveIn: 1, WaveOut: 2, MidiIn: 3, MidiOut: 4, Aux: 5 } as const;

export type Kind = (typeof Kind)[keyof typeof Kind];

/** The driver's entry point for the kind, by its exported name. */
function entryPoint(kind: Kind) {
  return ['', 'widMessage', 'wodMessage', 'midMessage', 'modMessage', 'auxMessage'][kind];
}

/** The message that asks a driver how many devices it has. */
function getNumDevs(kind: Kind) {
  return [0, 50, 3, 53, 1, 3][kind];
}

/** The kind a handle's header names: none for an auxiliary device. */
export function handleType(kind: Kind) {
  return [0, 2, 1, 4, 3, 0][kind];
}

export interface Message {
  device: number;
  message: number;
  user: number;
  first: number;
  second: number;
}

interface Entry {
  /** The driver's handle, USER's; nought for one installed by its module. */
  driver: number;
  /** Its entry point's address, or none. */
  procedure: number | null;
  /** How many devices it has, as MMSYSTEM keeps it: a byte. */
  devices: number;
  busy: number;
}

interface Table {
  entries: Entry[];
  count: number;
}

export interface Handle {
  kind: Kind;
  place: number;
  device: number;
  user: number;
  id: number;
  task: number;
}

interface Devices {
  tables: Table[];
  handles: (Handle | null)[];
}

function emptyEntry(): Entry {
  return { driver: 0, procedure: null, devices: 0, busy: 0 };
}

export function devicesOf(system: any): Devices {
  return (system._mmDevices ??= {
    tables: Array.from({ length: 5 }, () => ({
      entries: Array.from({ length: PLACES }, emptyEntry),
      count: 0,
    })),
    handles: [],
  });
}

export function tableOf(system: any, kind: Kind) {
  return devicesOf(system).tables[kind - 1];
}

/** How many devices of a kind there are. */
export function count(system: any, kind: Kind) {
  return system ? tableOf(system, kind).count : 0;
}

/** Where a device's number is (seg3 `79c`): its driver's place and its number within it. */
export function placeOf(system: any, kind: Kind, id: number): [number, number] | null {
  const table = tableOf(system, kind);

  if (id === MAPPER) {
    return [MAPPER_PLACE, 0];
  }

  if (id >= table.count) {
    return null;
  }

  let left = id;

  for (let place = 0; place < MAPPER_PLACE; place++) {
    /* MMSYSTEM sets the byte it keeps against the number's low byte. */
    if (table.entries[place].devices > (left & 0xff)) {
      return [place, left];
    }

    left = (left - table.entries[place].devices) & 0xffff;
  }

  return null;
}

/** The handle of a kind with a number, if it is open (seg1 `1e8`). */
export function handleOf(system: any, number: number, kind: Kind): Handle | null {
  const slot = (number & 0xffff) - HANDLE_FIRST;

  if (slot < 0 || slot % HANDLE_STEP) {
    return null;
  }

  const handle = devicesOf(system).handles[slot / HANDLE_STEP] ?? null;

  return handle && handleType(handle.kind) === handleType(kind) ? handle : null;
}

function makeHandle(system: any, handle: Handle) {
  const handles = devicesOf(system).handles;
  let slot = handles.findIndex((one) => !one);

  if (slot < 0) {
    handles.push(null);
    slot = handles.length - 1;
  }

  handles[slot] = handle;

  return HANDLE_FIRST + HANDLE_STEP * slot;
}

function freeHandle(system: any, number: number) {
  const slot = (number & 0xffff) - HANDLE_FIRST;
  const handles = devicesOf(system).handles;

  if (slot >= 0 && Math.floor(slot / HANDLE_STEP) < handles.length) {
    handles[Math.floor(slot / HANDLE_STEP)] = null;
  }
}

function core(system: any) {
  return system.machine.cpu.core;
}

export function readDword(system: any, far: number) {
  const c = core(system);
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  return (c.read16(segment, offset) | (c.read16(segment, (offset + 2) & 0xffff) << 16)) >>> 0;
}

export function writeBytes(system: any, far: number, bytes: ArrayLike<number>) {
  const c = core(system);

  for (let i = 0; i < bytes.length; i++) {
    c.write8((far >>> 16) & 0xffff, ((far & 0xffff) + i) & 0xffff, bytes[i] & 0xff);
  }
}

export function dwordBytes(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** MMSYSTEM's data segment, as a far pointer's selector. */
function mmsystemData(system: any) {
  return ((system._moduleData?.MMSYSTEM ?? 0) << 16) >>> 0;
}

/** A message sent to a driver's entry point: what it answers, DX:AX. */
export async function call(system: any, procedure: number, _kind: Kind, message: Message) {
  const answer = await system.scheduler.callProc(procedure >>> 0, [
    [message.device & 0xffff, UINT],
    [message.message & 0xffff, UINT],
    [message.user >>> 0, DWORD],
    [message.first >>> 0, DWORD],
    [message.second >>> 0, DWORD],
  ]);

  return Number(answer ?? 0) >>> 0;
}

/** A message for a device by its number (seg3 `817`). */
export async function sendById(
  system: any,
  kind: Kind,
  id: number,
  message: number,
  first: number,
  second: number
) {
  const found = placeOf(system, kind, id & 0xffff);

  if (!found) {
    return MMSYSERR_BADDEVICEID;
  }

  const procedure = tableOf(system, kind).entries[found[0]].procedure;

  if (procedure === null) {
    return MMSYSERR_NODRIVER;
  }

  return call(system, procedure, kind, { device: found[1], message, user: 0, first, second });
}

/** A message for an open device (seg3 `7f0`, seg1 `c4`): the driver's answer, or null for no handle. */
export async function sendByHandle(
  system: any,
  number: number,
  kind: Kind,
  message: number,
  first: number,
  second: number
): Promise<number | null> {
  const handle = handleOf(system, number, kind);
  const procedure = handle ? tableOf(system, kind).entries[handle.place].procedure : null;

  if (!handle || procedure === null) {
    return null;
  }

  return call(system, procedure, kind, {
    device: handle.device,
    message,
    user: userOf(system, number, handle),
    first,
    second,
  });
}

/**
 * The doubleword a driver keeps for an open device: a MIDI handle's in
 * MMSYSTEM's data segment at the handle and 4, where the driver was told it
 * is; a waveform handle's as MMSYSTEM copied it from its frame.
 */
function userOf(system: any, number: number, handle: Handle) {
  if (handle.kind === Kind.MidiOut || handle.kind === Kind.MidiIn) {
    return readDword(system, (mmsystemData(system) | ((number + 4) & 0xffff)) >>> 0);
  }

  return handle.user;
}

function countBusy(system: any, kind: Kind, place: number, more: boolean) {
  const entry = tableOf(system, kind).entries[place];

  entry.busy = (entry.busy + (more ? 1 : -1)) & 0xff;
}

/** Where a driver's doubleword for an open device is kept. */
export const Keep = {
  /** In MMSYSTEM's frame, on the program's stack: waveform devices. */
  Stack: 0,
  /** In the handle's block in MMSYSTEM's data segment: MIDI devices. */
  Handle: 1,
} as const;

export type Keep = (typeof Keep)[keyof typeof Keep];

/**
 * Structures laid below the program's stack, as MMSYSTEM keeps them in its
 * frame, the stack pointer moved past them while they are there: their far
 * pointers, the first highest.
 */
export function belowStack(system: any, structures: ArrayLike<number>[]) {
  const c = core(system);
  const saved = c.sp & 0xffff;
  const ss = c.ss & 0xffff;
  let offset = saved;
  const pointers: number[] = [];

  for (const bytes of structures) {
    /* Kept to a word's boundary, as a frame's locals are. */
    offset = (offset - bytes.length) & 0xffff & ~1;

    for (let i = 0; i < bytes.length; i++) {
      c.write8(ss, (offset + i) & 0xffff, bytes[i] & 0xff);
    }

    pointers.push(((ss << 16) | offset) >>> 0);
  }

  c.sp = offset;

  return {
    pointers,
    release() {
      c.sp = saved;
    },
  };
}

/**
 * Structures in MMSYSTEM's frame for a call that reads or fills them, as
 * `belowStack` lays them: the call's answer, and each as it was left.
 */
export async function inFrame<T>(
  system: any,
  structures: ArrayLike<number>[],
  body: (pointers: number[]) => Promise<T>
): Promise<[T, Uint8Array[]]> {
  const frame = belowStack(system, structures);

  try {
    const answer = await body(frame.pointers);
    const c = core(system);
    const left = frame.pointers.map((far, i) =>
      Uint8Array.from({ length: structures[i].length }, (_, at) =>
        c.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff)
      )
    );

    return [answer, left];
  } finally {
    frame.release();
  }
}

/**
 * A device opened (seg3 `9e3` from `a5e`, seg6 `2a7` from `308`), its
 * arguments checked: a handle made unless only a question is asked, and the
 * driver sent `open` with the doubleword it is to keep and the description
 * `describe` makes of the handle. What the driver answers, and the handle.
 */
export async function open(
  system: any,
  kind: Kind,
  place: number,
  device: number,
  id: number,
  openMessage: number,
  describe: (handle: number) => number[],
  flags: number,
  query: boolean,
  keep: Keep
): Promise<[number, number | null]> {
  const task = system.scheduler?.active ?? 0;
  const procedure = tableOf(system, kind).entries[place].procedure;
  const number = query ? null : makeHandle(system, { kind, place, device, user: 0, id, task });

  if (procedure === null) {
    if (number !== null) {
      freeHandle(system, number);
    }

    return [MMSYSERR_NODRIVER, null];
  }

  const description = describe(number ?? 0);
  let userAt: number;
  let frame: ReturnType<typeof belowStack>;

  if (keep === Keep.Handle && number !== null) {
    userAt = (mmsystemData(system) | ((number + 4) & 0xffff)) >>> 0;
    writeBytes(system, userAt, [0, 0, 0, 0]);
    frame = belowStack(system, [description]);
  } else {
    frame = belowStack(system, [[0, 0, 0, 0], description]);
    userAt = frame.pointers[0];
  }

  const answer =
    (await call(system, procedure, kind, {
      device,
      message: openMessage,
      user: userAt,
      first: frame.pointers[frame.pointers.length - 1] ?? 0,
      second: flags,
    })) & 0xffff;
  const user = readDword(system, userAt);

  frame.release();

  if (number === null) {
    return [answer, null];
  }

  if (answer !== MMSYSERR_NOERROR) {
    freeHandle(system, number);
    return [answer, null];
  }

  countBusy(system, kind, place, true);

  /* A waveform device's doubleword copied from the frame into the handle's
   * block (seg3 `b68`); a MIDI device's is in the block already. */
  if (keep === Keep.Stack) {
    devicesOf(system).handles[(number - HANDLE_FIRST) / HANDLE_STEP]!.user = user;
  }

  return [answer, number];
}

/** A device closed (seg3 `b81`, seg6 `3c4`): the driver's answer, or `MMSYSERR_INVALHANDLE`. */
export async function close(system: any, number: number, kind: Kind, closeMessage: number) {
  const answer = await sendByHandle(system, number, kind, closeMessage, 0, 0);

  if (answer === null) {
    return MMSYSERR_INVALHANDLE;
  }

  if ((answer & 0xffff) === MMSYSERR_NOERROR) {
    const handle = handleOf(system, number, kind);

    if (handle) {
      countBusy(system, kind, handle.place, false);
    }

    freeHandle(system, number);
  }

  return answer & 0xffff;
}

/**
 * A driver installed, or removed, as `mmDrvInstall` does (seg2 `484`): the
 * driver's place and one, or nought for one refused; 1 for one removed.
 */
export async function install(
  system: any,
  handle: number,
  procedure: number | null,
  flags: number
) {
  const remove = (flags & MMDRVI_REMOVE) !== 0;
  const byDriver = handle !== 0 && (flags & MMDRVI_HDRV) !== 0;
  const driver = byDriver ? handle : 0;
  const module = byDriver ? GetDriverModuleHandle.call(system, handle) : handle;
  const refuse = async () => {
    if (driver !== 0 && !remove) {
      await CloseDriver.call(system, driver, 0, 0);
    }

    return 0;
  };
  const kind = (flags & 0xf) as Kind;

  if (kind < 1 || kind > 5) {
    return refuse();
  }

  let address = procedure ? procedure >>> 0 : 0;

  if (!address && module) {
    address = GetProcAddress.call(system, module, entryPoint(kind)) >>> 0;
  }

  if (!address) {
    return refuse();
  }

  const table = tableOf(system, kind);
  const found = table.entries.findIndex((entry) => entry.procedure === address);

  if (remove) {
    return found >= 0 ? uninstall(system, kind, found) : 0;
  }

  if (found >= 0) {
    return refuse();
  }

  const place =
    flags & MMDRVI_MAPPER
      ? table.entries[MAPPER_PLACE].procedure === null
        ? MAPPER_PLACE
        : -1
      : table.entries.slice(0, MAPPER_PLACE).findIndex((entry) => entry.procedure === null);

  if (place < 0) {
    return refuse();
  }

  const message = (message: number) => ({ device: 0, message, user: 0, first: 0, second: 0 });

  await call(system, address, kind, message(DRVM_INIT));

  const devices = await call(system, address, kind, message(getNumDevs(kind)));

  if (devices >>> 16) {
    return refuse();
  }

  table.entries[place] = { driver, procedure: address, devices: devices & 0xff, busy: 0 };

  if (place !== MAPPER_PLACE) {
    table.count = (table.count + (devices & 0xff)) & 0xffff;
  }

  return place + 1;
}

/** A driver removed from its place (seg2 `56f`), unless a device of it is open. */
async function uninstall(system: any, kind: Kind, place: number) {
  const table = tableOf(system, kind);
  const entry = table.entries[place];

  if (entry.busy) {
    return 0;
  }

  if (place !== MAPPER_PLACE) {
    table.count = (table.count - entry.devices) & 0xffff;
  }

  table.entries[place] = emptyEntry();

  if (entry.driver) {
    await CloseDriver.call(system, entry.driver, 0, 0);
  }

  return 1;
}

/** Opens a driver `[drivers]` names (seg2 `443`), if it names it with a value. */
async function openNamed(system: any, name: string) {
  const profile = await readProfile(system, 'system.ini');

  if (!profile.get('Drivers', name)) {
    return 0;
  }

  return OpenDriver.call(system, name, null, 0);
}

/** The drivers of two kinds a stem names, then, if either has a device, the mapper (seg2 `2bb`, `34b`, `3db`). */
async function openKinds(
  system: any,
  stem: string,
  first: Kind,
  second: Kind | null,
  mapper: string
) {
  for (let digit = 0; digit < 10; digit++) {
    const name = digit ? `${stem}${digit}` : stem;
    const handle = await openNamed(system, name);

    if (!handle) {
      continue;
    }

    await install(system, handle, null, MMDRVI_HDRV | first);

    if (second !== null) {
      await install(system, await openNamed(system, name), null, MMDRVI_HDRV | second);
    }
  }

  if (!count(system, first) && (second === null || !count(system, second))) {
    return;
  }

  const handle = await openNamed(system, mapper);

  if (!handle) {
    return;
  }

  await install(system, handle, null, MMDRVI_HDRV | MMDRVI_MAPPER | first);

  if (second !== null) {
    await install(
      system,
      await openNamed(system, mapper),
      null,
      MMDRVI_HDRV | MMDRVI_MAPPER | second
    );
  }
}

/** The waveform and MIDI drivers opened and installed, as MMSYSTEM's first load readies them. */
export async function openWaveAndMidi(system: any) {
  await openKinds(system, 'wave', Kind.WaveOut, Kind.WaveIn, 'wavemapper');
  await openKinds(system, 'midi', Kind.MidiOut, Kind.MidiIn, 'midimapper');
}

/** The auxiliary drivers, which follow the interrupt stacks. */
export async function openAuxiliary(system: any) {
  await openKinds(system, 'aux', Kind.Aux, null, 'auxmapper');
}

/** `mmDrvInstall`: a driver installed or removed. */
export async function mmDrvInstall(this: any, hDriver: number, wodMessage: number, wFlags: number) {
  return install(this, hDriver & 0xffff, wodMessage >>> 0 || null, wFlags & 0xffff);
}

/** One of MMSYSTEM's strings, by its number: WinBox's own (see `strings.ts`). */
export async function mmsystemString(_system: any, id: number): Promise<string | null> {
  return MMSYSTEM_STRINGS.get(id) ?? null;
}

/** A string of a module's string table, read from its file; null when there is none. */
export async function moduleString(system: any, path: string, id: number): Promise<string | null> {
  const files = system.dos?.files;
  const handle = files ? await files.open(path) : null;
  const file = handle ? files.resolve(handle) : null;

  if (!file) {
    return null;
  }

  const read = async (offset: number, length: number) =>
    new Uint8Array(await file.read(offset, length));
  const word = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);

  try {
    const mz = await read(0, 0x40);
    const ne = word(mz, 0x3c) | (word(mz, 0x3e) << 16);
    const header = await read(ne, 0x40);
    const table = ne + word(header, 0x24);
    const resources = await read(table, word(header, 0x26) - word(header, 0x24));
    const shift = word(resources, 0);
    const block = (id >> 4) + 1;

    for (let at = 2; word(resources, at);) {
      const type = word(resources, at);
      const many = word(resources, at + 2);

      at += 8;

      for (let index = 0; index < many; index++, at += 12) {
        if (type === 0x8006 && (word(resources, at + 6) & 0x7fff) === block) {
          const data = await read(word(resources, at) << shift, word(resources, at + 2) << shift);
          let offset = 0;

          for (let skip = 0; skip < (id & 15); skip++) {
            offset += 1 + data[offset];
          }

          return String.fromCharCode(...data.subarray(offset + 1, offset + 1 + data[offset]));
        }
      }
    }
  } catch {
    // Not a file this can read.
  }

  return null;
}
