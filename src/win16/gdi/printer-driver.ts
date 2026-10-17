'use strict';

import { Surface } from '../../raster/surface.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { readProfile } from '../kernel/profiles.js';
import { GetProcAddress } from '../kernel/GetProcAddress.js';
import { LoadLibrary } from '../kernel/LoadLibrary.js';
import { freeLibrary } from '../library.js';
import { DWORD, UINT } from '../types.js';
import { SYSTEM_FONT, stockFontHandle } from './stock-fonts.js';

/**
 * A printer's driver from the drive -- the PostScript driver, or any other
 * Windows printer driver -- run as Windows' GDI runs it. The twin of
 * `crates/winbox-win16/src/gdi/printer_driver.rs`.
 *
 * **Read out** of `GDI.EXE`, `CreateDC` and `CreateIC` (seg1 `480a`,
 * `47d8`, both into seg1 `0078` with a flag, 0 for a DC and 80h for an IC):
 *
 * * The port is named by an atom of its name, a colon at its end left off
 *   (seg4 `0449`); the device and the driver by atoms of theirs, so all
 *   three are compared without case. A DC on WIN.INI's `[windows]`
 *   `NullPort`, `None` by default, read as GDI starts (seg2 `025c`), is
 *   refused (seg1 `00bb`); an IC is not.
 * * **The driver** is found in GDI's list of those loaded, by its name; or
 *   loaded, `LoadLibrary` of the name with `.drv` after it, refused below
 *   32 (seg1 `0284`-`02e1`). Its ordinals 1 to 30 are found with
 *   `GetProcAddress` (`02ef`), the driver's entry points: 1 `BitBlt`, 2
 *   `ColorInfo`, 3 `Control`, 4 `Disable`, 5 `Enable`, 6 `EnumDFonts`, 7
 *   `EnumObj`, 8 `Output`, 9 `Pixel`, 10 `RealizeObject`, 11 `StrBlt`, 12
 *   `ScanLR`, 13 `DeviceMode`, 14 `ExtTextOut`, 15 `GetCharWidth` and on.
 *   A count of the DCs made on it is kept (`0111`).
 * * **The device**, a `PDEVICE` and its `GDIINFO`, is kept per driver by
 *   the device's and the port's names, and shared by every DC and IC made
 *   on the two (seg1 `0333`), as the `GDIINFO`'s `dpDCManage` (5Ch) lets:
 *   with bit 0 every DC has one of its own; with bit 2 the first is shared
 *   whatever the names; with bit 1 a second DC is refused.
 * * A new one: `Enable` with GDI's 7Eh bytes for the `GDIINFO`, a style
 *   of 1, 8001h for an IC, and the program's device, port and DEVMODE
 *   (`03af`, `04ca`). Its answer must be at least 6Eh where the version is
 *   300h or more, else exactly 68h. Words 60h to 66h all nought are made
 *   B505h, 0, B505h, 0 (`0592`). Then the `PDEVICE`, `GlobalAlloc(2002h,
 *   dpDEVICEsize)` (`03f5`), given to `Enable` with a style of nought,
 *   8000h for an IC (`046f`); nought from it refuses the DC.
 * * A driver whose `dpRaster` has `RC_BANDING` (2) has its DC's drawing
 *   kept in a metafile for its bands (`042d`): not followed here.
 *
 * `DeleteDC` (seg1 `082e`): the device's count taken down, and at nought
 * `Disable` given its `PDEVICE` (`0906`), which is freed with its
 * `GDIINFO`; the driver's count taken down, and at nought `FreeLibrary`
 * (`0947`).
 */

/** A driver GDI has loaded. */
export interface Driver {
  name: string;
  instance: number;
  /** Ordinals 1 to 30, at index 0 to 29. */
  procs: number[];
  /** The DCs and ICs made on it. */
  uses: number;
  devices: PDevice[];
}

/** A device a driver has enabled: its `GDIINFO` and its `PDEVICE`. */
export interface PDevice {
  driver: Driver;
  device: string;
  port: string;
  info: Uint8Array;
  pdevice: number;
  lpPDevice: number;
  /** The DCs and ICs made on it. */
  count: number;
}

const ENABLE = 5;
const DISABLE = 4;
const CONTROL = 3;

const GDIINFO_SIZE = 0x6e;
const DC_SPDEVICE = 1;
const DC_1PDEVICE = 2;
const DC_IGNOREDFNP = 4;

function stateOf(system: any): { drivers: Driver[]; nullPort: string | null } {
  return (system._printerDrivers ??= { drivers: [], nullPort: null });
}

/** A name as GDI's atom keeps it: compared without case. */
function key(name: string) {
  return name.toUpperCase();
}

/** A port as GDI names it: a colon at its end left off (seg4 `0449`). */
export function portKey(name: string) {
  return key(name.endsWith(':') ? name.slice(0, -1) : name);
}

/** The far pointer a string argument was read from (`read-arguments.ts`). */
function farOf(arg: any) {
  if (arg && typeof arg === 'object' && arg.segment !== undefined) {
    return ((arg.segment << 16) | (arg.offset & 0xffff)) >>> 0;
  }

  return 0;
}

export function readFar(system: any, far: number) {
  const core = system.machine.cpu.core;
  let text = '';

  for (let at = 0; far && at < 0x10000; at++) {
    const byte = core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);

    if (!byte) {
      break;
    }

    text += String.fromCharCode(byte);
  }

  return text;
}

export async function nullPort(system: any) {
  const state = stateOf(system);

  if (state.nullPort === null) {
    const profile = await readProfile(system, 'WIN.INI');

    state.nullPort = String(profile.get('windows', 'nullport') ?? 'none');
  }

  return state.nullPort;
}

/**
 * Bytes laid below the stack for a call, given to `body` as a far pointer,
 * the stack kept below them while it runs: its answer, and the bytes as
 * they were left.
 */
async function onStack<T>(
  system: any,
  bytes: Uint8Array,
  body: (far: number) => Promise<T>
): Promise<[T, Uint8Array]> {
  const core = system.machine.cpu.core;
  const saved = core.sp;
  const ss = core.ss;
  const sp = (saved - ((bytes.length + 1) & ~1)) & 0xffff;

  bytes.forEach((byte, step) => core.write8(ss, (sp + step) & 0xffff, byte));
  core.sp = (sp - 4) & 0xffff;

  try {
    const answer = await body(((ss << 16) | sp) >>> 0);
    const left = bytes.map((_, step) => core.read8(ss, (sp + step) & 0xffff));

    return [answer, left];
  } finally {
    core.sp = saved;
  }
}

/** The driver's entry point by its ordinal, nought where it has none. */
function proc(driver: Driver, ordinal: number) {
  return driver.procs[ordinal - 1] ?? 0;
}

async function callDriver(system: any, procedure: number, args: [number, number][]) {
  const answer = await system.scheduler.callProc(procedure, args);

  return Number(answer ?? 0) >>> 0;
}

async function findDriver(system: any, name: string): Promise<[Driver | null, boolean]> {
  const state = stateOf(system);
  const found = state.drivers.find((driver) => driver.name === key(name));

  if (found) {
    return [found, false];
  }

  const instance = await LoadLibrary.call(system, `${name}.drv`);

  if (instance < 32) {
    return [null, false];
  }

  const procs = [];

  for (let ordinal = 1; ordinal <= 30; ordinal++) {
    procs.push(GetProcAddress.call(system, instance, ordinal) >>> 0);
  }

  const driver: Driver = { name: key(name), instance, procs, uses: 0, devices: [] };

  state.drivers.unshift(driver);
  return [driver, true];
}

async function dropDriver(system: any, driver: Driver) {
  const state = stateOf(system);

  state.drivers = state.drivers.filter((other) => other !== driver);
  await freeLibrary(system, driver.instance);
}

/** A shared device, as `dpDCManage` lets one be shared; `false` where the DC is refused. */
function sharedDevice(driver: Driver, device: string, port: string): PDevice | null | false {
  const first = driver.devices[0];

  if (!first) {
    return null;
  }

  const manage = first.info[0x5c];

  if (manage & DC_SPDEVICE) {
    return null;
  }

  if (manage & DC_IGNOREDFNP) {
    return manage & DC_1PDEVICE ? false : first;
  }

  for (const other of driver.devices) {
    if (key(other.device) === key(device) && portKey(other.port) === portKey(port)) {
      return other.info[0x5c] & DC_1PDEVICE ? false : other;
    }
  }

  return null;
}

async function enableDevice(
  system: any,
  driver: Driver,
  args: { device: number; output: number; data: number; ic: boolean },
  names: { device: string; port: string }
): Promise<PDevice | null> {
  const enable = proc(driver, ENABLE);
  const style = args.ic ? 0x8000 : 0;

  if (!enable) {
    return null;
  }

  const enableArgs = (device: number, mode: number): [number, number][] => [
    [device, DWORD],
    [mode, UINT],
    [args.device, DWORD],
    [args.output, DWORD],
    [args.data, DWORD],
  ];
  /* GDI's 7Eh bytes for the `GDIINFO` are in its own heap; here they are
   * below the stack for the call. */
  const [size, info] = await onStack(
    system,
    new Uint8Array(0x7e),
    async (far) => (await callDriver(system, enable, enableArgs(far, style | 1))) & 0xffff
  );

  /* Words 60h to 66h, all nought, made B505h, 0, B505h, 0 (seg1 `0592`). */
  if (info.subarray(0x60, 0x68).every((byte) => byte === 0)) {
    info.set([0x05, 0xb5, 0, 0, 0x05, 0xb5, 0, 0], 0x60);
  }

  const version = info[0] | (info[1] << 8);
  const fits = version >= 0x300 ? size >= GDIINFO_SIZE : size === 0x68;
  const deviceSize = info[0x1a] | (info[0x1b] << 8);
  const pdevice = fits ? GlobalAlloc.call(system, 0x2002, deviceSize) : 0;

  if (!pdevice) {
    return null;
  }

  const lpPDevice = GlobalLock.call(system, pdevice) >>> 0;
  const enabled = (await callDriver(system, enable, enableArgs(lpPDevice, style))) & 0xffff;

  GlobalUnlock.call(system, pdevice);

  if (!enabled) {
    GlobalFree.call(system, pdevice);
    return null;
  }

  return {
    driver,
    device: names.device,
    port: names.port,
    info,
    pdevice,
    lpPDevice,
    count: 0,
  };
}

/** What `GetDeviceCaps` and the rest of GDI read of a device, from its `GDIINFO`. */
export function capsOf(info: Uint8Array, name: string) {
  const word = (at: number) => info[at] | (info[at + 1] << 8);
  const signed = (at: number) => (word(at) << 16) >> 16;

  return {
    name,
    driverVersion: word(0),
    technology: word(2),
    widthMillimetres: word(4),
    heightMillimetres: word(6),
    width: word(8),
    height: word(0x0a),
    bitsPerPixel: word(0x0c),
    planes: word(0x0e),
    numBrushes: signed(0x10),
    numPens: signed(0x12),
    numMarkers: word(0x14),
    numFonts: word(0x16),
    colors: signed(0x18),
    curveCaps: word(0x1c),
    lineCaps: word(0x1e),
    polygonalCaps: word(0x20),
    textCaps: word(0x22),
    clipCaps: word(0x24),
    rasterCaps: word(0x26),
    aspectX: word(0x28),
    aspectY: word(0x2a),
    aspectXY: word(0x2c),
    logicalPixelsX: word(0x58),
    logicalPixelsY: word(0x5a),
    sizePalette: word(0x68),
    numReserved: word(0x6a),
    colorRes: word(0x6c),
    escapes: {},
    /* The driver's own table, as `GetDeviceCaps` reads it (seg1 `44a6`). */
    gdiInfo: info,
  };
}

/**
 * `CreateDC` or `CreateIC` of a driver from the drive: the DC, or nought.
 */
export async function createDriverDC(
  system: any,
  args: { driver: any; device: any; output: any; data: number },
  ic: boolean
): Promise<number> {
  const pointers = {
    driver: farOf(args.driver),
    device: farOf(args.device),
    output: farOf(args.output),
    data: Number(args.data ?? 0) >>> 0,
  };
  const name = readFar(system, pointers.driver);
  const device = readFar(system, pointers.device);
  const port = readFar(system, pointers.output);

  if (!name) {
    return 0;
  }

  /* A DC on the null port is refused; an IC is not (seg1 `00bb`). */
  if (!ic && pointers.output && portKey(port) === portKey(await nullPort(system))) {
    return 0;
  }

  const [driver, loaded] = await findDriver(system, name);

  if (!driver) {
    return 0;
  }

  const shared = sharedDevice(driver, device, port);
  let pdevice = shared || null;

  if (shared === false) {
    if (loaded) {
      await dropDriver(system, driver);
    }

    return 0;
  }

  if (!pdevice) {
    pdevice = await enableDevice(
      system,
      driver,
      { device: pointers.device, output: pointers.output, data: pointers.data, ic },
      { device, port }
    );

    if (!pdevice) {
      if (loaded && !driver.uses) {
        await dropDriver(system, driver);
      }

      return 0;
    }

    driver.devices.unshift(pdevice);
  }

  driver.uses++;
  pdevice.count++;

  const surface: any = Surface.memory();

  surface.device = capsOf(pdevice.info, device);
  surface.driverDevice = pdevice;
  surface.informationOnly = ic;

  const font = system.fonts ? stockFontHandle(system, SYSTEM_FONT) : null;

  if (font) {
    surface.font = system.handles.resolve(font);
  }

  return system.handles.allocateGDI(surface);
}

/** A DC of a driver from the drive deleted: `Disable` and `FreeLibrary` as the last goes. */
export async function deleteDriverDC(system: any, surface: any) {
  const pdevice: PDevice = surface.driverDevice;
  const driver = pdevice.driver;

  surface.driverDevice = null;
  pdevice.count = Math.max(0, pdevice.count - 1);

  if (!pdevice.count) {
    const disable = proc(driver, DISABLE);

    if (disable) {
      const far = GlobalLock.call(system, pdevice.pdevice) >>> 0;

      await callDriver(system, disable, [[far, DWORD]]);
      GlobalUnlock.call(system, pdevice.pdevice);
    }

    driver.devices = driver.devices.filter((other) => other !== pdevice);
    GlobalFree.call(system, pdevice.pdevice);
  }

  driver.uses = Math.max(0, driver.uses - 1);

  if (!driver.uses) {
    await dropDriver(system, driver);
  }
}

/**
 * `GetDeviceCaps` of a driver's DC: the word at the index's offset in its
 * `GDIINFO`, nought past 6Ch, or past 66h for a `GDIINFO` older than 300h
 * (seg1 `44a6`).
 */
export function driverCaps(surface: any, index: number) {
  const info: Uint8Array = surface.driverDevice.info;
  const version = info[0] | (info[1] << 8);

  if (index < 0 || index > 0x6c || (version < 0x300 && index > 0x66)) {
    return 0;
  }

  return ((info[index] | (info[index + 1] << 8)) << 16) >> 16;
}

/**
 * `Escape` on a driver's DC (seg7 `0042`-`0526`): `SETABORTPROC` kept by
 * GDI, answering the procedure's segment (`00fb`); `STARTDOC` given to the
 * driver after a `SETABORTPROC` of its own whose input is the DC (`00c1`);
 * 0Fh answered nought (`008f`); 100h to BFFh GDI's own, answered nought
 * here; every other the driver's `Control`, with the `PDEVICE`, the
 * escape, the input and the output -- not the count (`04f0`).
 */
export async function driverEscape(
  system: any,
  hdc: number,
  surface: any,
  escape: number,
  lpIn: number,
  lpOut: number
) {
  const pdevice: PDevice = surface.driverDevice;
  const control = proc(pdevice.driver, CONTROL);

  if (escape === 0x0f) {
    return 0;
  }

  if (escape === 9) {
    surface.abortProc = lpIn >>> 0;
    return (lpIn >>> 16) & 0xffff;
  }

  if (escape >= 0x100 && escape <= 0xbff) {
    return 0;
  }

  if (!control) {
    return 0;
  }

  const call = async (number: number, input: number, output: number) =>
    (await callDriver(system, control, [
      [pdevice.lpPDevice, DWORD],
      [number & 0xffff, UINT],
      [input >>> 0, DWORD],
      [output >>> 0, DWORD],
    ])) & 0xffff;

  if (escape === 10) {
    /* The driver given the DC, by a word of GDI's stack. */
    await onStack(system, new Uint8Array([hdc & 0xff, (hdc >> 8) & 0xff]), (far) =>
      call(9, far, lpOut)
    );
  }

  return call(escape, lpIn, lpOut);
}
