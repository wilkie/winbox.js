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
import { stockHandle } from '../handle-manager.js';
import { stockLogfont } from './GetObject.js';
import { devicePoint, mappingOf } from './mapping.js';
import { MulDiv } from './MulDiv.js';
import { stockFontHandle } from './stock-fonts.js';

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
const REALIZE_OBJECT = 10;
const OBJ_FONT = 3;
const DEVICE_DEFAULT_FONT = 14;
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

  /* A printer's context starts with `DEVICE_DEFAULT_FONT`, the display's
   * with `SYSTEM_FONT` (seg1 `0217`-`0225`). */
  const font = system.fonts ? stockFontHandle(system, DEVICE_DEFAULT_FONT) : null;

  if (font) {
    surface.font = system.handles.resolve(font);
  }

  const hdc = system.handles.allocateGDI(surface);

  /* Its colours, brush and pen, through the driver (seg1 `01cd`-`0210`):
   * loaded when first wanted, as `printer-output.ts` imports this. */
  const { startDrawing } = await import('./printer-output.js');

  await startDrawing(system, surface);

  return hdc;
}

/** A DC of a driver from the drive deleted: `Disable` and `FreeLibrary` as the last goes. */
export async function deleteDriverDC(system: any, surface: any) {
  const pdevice: PDevice = surface.driverDevice;
  const driver = pdevice.driver;

  const { stopDrawing } = await import('./printer-output.js');

  stopDrawing(system, surface);
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

  for (const realizations of surface.deviceFonts?.values() ?? []) {
    for (const realized of realizations.values()) {
      GlobalFree.call(system, realized.handle);
    }
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

  /* `NEXTBAND` marks the DC as banding, which `EndPage` reads (`0137`). */
  if (escape === 3) {
    surface.banding = true;
  }

  if (escape === 10) {
    /* The driver given the DC, by a word of GDI's stack. */
    await onStack(system, new Uint8Array([hdc & 0xff, (hdc >> 8) & 0xff]), (far) =>
      call(9, far, lpOut)
    );
  }

  return call(escape, lpIn, lpOut);
}

/** The driver's `Control` with an escape, its input and its output: its answer, signed. */
async function control(
  system: any,
  pdevice: PDevice,
  escape: number,
  input: number,
  output: number
) {
  const procedure = proc(pdevice.driver, CONTROL);

  if (!procedure) {
    return 0;
  }

  const answer = await callDriver(system, procedure, [
    [pdevice.lpPDevice, DWORD],
    [escape, UINT],
    [input >>> 0, DWORD],
    [output >>> 0, DWORD],
  ]);

  return ((answer & 0xffff) << 16) >> 16;
}

/**
 * `StartDoc` on a driver's DC (`GDI.EXE` seg31 `0196`): the driver's
 * `Control` given `SETABORTPROC` with the DC, by a word of GDI's stack,
 * then `STARTDOC` with the document's name, and the `DOCINFO` as its
 * output where the `GDIINFO` is newer than 300h. The answer is the
 * driver's.
 */
export async function driverStartDoc(system: any, hdc: number, surface: any, lpdi: number) {
  const pdevice: PDevice = surface.driverDevice;
  const core = system.machine.cpu.core;
  const name = lpdi
    ? ((core.read16(lpdi >>> 16, ((lpdi & 0xffff) + 4) & 0xffff) << 16) |
        core.read16(lpdi >>> 16, ((lpdi & 0xffff) + 2) & 0xffff)) >>>
      0
    : 0;
  const version = pdevice.info[0] | (pdevice.info[1] << 8);

  await onStack(system, new Uint8Array([hdc & 0xff, (hdc >> 8) & 0xff]), (far) =>
    control(system, pdevice, 9, far, 0)
  );

  return control(system, pdevice, 10, name, version > 0x300 ? lpdi : 0);
}

/** `StartPage` on a driver's DC (seg31 `02ae`): the DC marked, and 1. */
export function driverStartPage(surface: any) {
  surface.pageStarted = true;

  return 1;
}

/**
 * `EndPage` on a driver's DC (seg31 `02e0`): -1 on a DC `StartPage` has
 * not marked; else the escape `NEWFRAME`'s answer, or 1 where `NEXTBAND`
 * has marked it banding; both marks cleared.
 */
export async function driverEndPage(system: any, hdc: number, surface: any) {
  if (!surface.pageStarted) {
    return -1;
  }

  const answer = surface.banding ? 1 : await driverEscape(system, hdc, surface, 1, 0, 0);

  surface.pageStarted = false;
  surface.banding = false;

  return answer;
}

/** `EndDoc` on a driver's DC (seg31 `0234`): the driver's `Control` with `ENDDOC`. */
export function driverEndDoc(system: any, surface: any) {
  return control(system, surface.driverDevice, 11, 0, 0);
}

/** A realized font of a driver's, as GDI keeps it: the `FONTINFO` and the `TEXTXFORM`. */
interface DeviceFont {
  handle: number;
  far: number;
  info: Uint8Array;
  xform: Uint8Array;
}

/**
 * A made font's height and width in the device's units, as GDI takes them
 * before the driver realizes it (`GDI.EXE` seg3 `0b35`-`0b9c`; a stock
 * font, 8000h in its type word, keeps its own): the window origin and the
 * origin moved by the width and the height mapped to the device (`LPtoDP`,
 * seg1 `52f5`); the width their distance across; the height their distance
 * down, negative for a negative height, and 1 where it comes to nought
 * from a height that was not.
 */
function mappedSize(surface: any, logfont: any) {
  const m = mappingOf(surface);
  const [x1, y1] = devicePoint(surface, m.wox, m.woy);
  const [x2, y2] = devicePoint(surface, m.wox + logfont.width, m.woy + logfont.height);
  const down = Math.abs(y2 - y1);

  return {
    width: Math.abs(x2 - x1),
    height: down === 0 ? (logfont.height ? 1 : 0) : logfont.height < 0 ? -down : down,
  };
}

/** The `LOGFONT` a font object was made of, or a stock font's. */
function logfontOf(system: any, font: any) {
  if (font?.logfont) {
    return font.logfont;
  }

  for (let index = 10; index <= 16; index++) {
    if (system.handles.resolve(stockHandle(index)) === font) {
      return stockLogfont(system, stockHandle(index));
    }
  }

  return null;
}

/**
 * The logical font selected, realized by the driver (`GDI.EXE` seg3
 * `0a68`): its `LOGFONT` copied, `lfClipPrecision`'s high bits left off,
 * the driver's `RealizeObject` asked the size of its `FONTINFO` with
 * nought for it, a block of `GlobalAlloc(2042h)` 42h bytes larger made, and
 * the font realized into it with a `TEXTXFORM` of GDI's (`0c08`-`0c66`);
 * the `TEXTXFORM`'s italic, underline and strike-out made nought or FFh.
 * A made font's height and width are first taken to the device's units
 * (`mappedSize`), so it is realized again for each size they come to. Null
 * where the driver realizes none, which GDI maps itself: not followed.
 */
export async function deviceFont(system: any, surface: any): Promise<DeviceFont | null> {
  const pdevice: PDevice | null = surface.driverDevice;
  const font = surface.font;

  if (!pdevice || !font) {
    return null;
  }

  const given = logfontOf(system, font);

  if (!given) {
    return null;
  }

  const logfont = font.logfont ? { ...given, ...mappedSize(surface, given) } : given;
  const key = `${logfont.height},${logfont.width}`;

  surface.deviceFonts ??= new Map<any, Map<string, DeviceFont>>();

  const kept = surface.deviceFonts.get(font)?.get(key);

  if (kept) {
    return kept;
  }

  const realize = proc(pdevice.driver, REALIZE_OBJECT);

  if (!realize) {
    return null;
  }

  const bytes = new Uint8Array(0x12 + 0x40);
  const view = new DataView(bytes.buffer);

  view.setInt16(0, logfont.height, true);
  view.setInt16(2, logfont.width, true);
  view.setInt16(4, logfont.escapement, true);
  view.setInt16(6, logfont.orientation, true);
  view.setInt16(8, logfont.weight, true);
  bytes.set(
    [
      logfont.italic,
      logfont.underline,
      logfont.strikeout,
      logfont.charset,
      logfont.outPrecision,
      logfont.clipPrecision & 0x0f,
      logfont.quality,
      logfont.pitchAndFamily,
    ].map((value) => Number(value) & 0xff),
    0x0a
  );

  for (let at = 0; at < Math.min(logfont.face.length, 0x3f); at++) {
    bytes[0x12 + at] = logfont.face.charCodeAt(at) & 0xff;
  }

  const realizeArgs = (lf: number, info: number, xform: number): [number, number][] => [
    [pdevice.lpPDevice, DWORD],
    [OBJ_FONT, UINT],
    [lf, DWORD],
    [info, DWORD],
    [xform, DWORD],
  ];
  /* The context whose font is being realized, for GDI's TrueType engine
   * (`[064Eh]`, `engine-font.ts`). */
  const before = system._realizingFont;

  system._realizingFont = { surface };

  try {
    return await realizeDeviceFont(system, surface, [font, key], realize, realizeArgs, bytes);
  } finally {
    system._realizingFont = before;
  }
}

async function realizeDeviceFont(
  system: any,
  surface: any,
  [font, key]: [any, string],
  realize: number,
  realizeArgs: (lf: number, info: number, xform: number) => [number, number][],
  bytes: Uint8Array
): Promise<DeviceFont | null> {
  const [size] = await onStack(
    system,
    bytes,
    async (lf) => (await callDriver(system, realize, realizeArgs(lf, 0, 0))) & 0xffff
  );

  if (!size) {
    return null;
  }

  const handle = GlobalAlloc.call(system, 0x2042, size + 0x42);

  if (!handle) {
    return null;
  }

  const far = GlobalLock.call(system, handle) >>> 0;
  const [[, xform]] = await onStack(system, bytes, async (lf) =>
    onStack(system, new Uint8Array(0x14), (xformFar) =>
      callDriver(system, realize, realizeArgs(lf, far, xformFar))
    )
  );
  const core = system.machine.cpu.core;
  const info = new Uint8Array(size);

  for (let at = 0; at < size; at++) {
    info[at] = core.read8(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  }

  for (let at = 0x0a; at <= 0x0c; at++) {
    xform[at] = xform[at] ? 0xff : 0;
  }

  const realized = { handle, far, info, xform: xform.slice(0, 0x13) };

  if (!surface.deviceFonts.has(font)) {
    surface.deviceFonts.set(font, new Map());
  }

  surface.deviceFonts.get(font).set(key, realized);
  return realized;
}

/**
 * `GetTextMetrics` of a font a driver realized (`GDI.EXE` seg3 `0222`):
 * the height the `TEXTXFORM`'s, the ascent, descent and leadings the
 * `FONTINFO`'s scaled to it; the average width the `TEXTXFORM`'s and the
 * widest the `FONTINFO`'s scaled to it, each a pixel more where the
 * `TEXTXFORM` asks for bold made by GDI (200h in its flags); the overhang,
 * weight, italic, underline and strike-out the `TEXTXFORM`'s; the
 * characters, the character set and the resolutions the `FONTINFO`'s; the
 * pitch and family the `FONTINFO`'s with `TMPF_DEVICE` and its type's two
 * low bits as `TMPF_VECTOR` and `TMPF_TRUETYPE`. Not followed: the other
 * widths of a font GDI emboldens (byte 0Bh, bit 3, `02de`), and the
 * metrics taken to logical units in a mapping mode other than `MM_TEXT`.
 */
export function deviceTextMetrics(realized: DeviceFont) {
  const { info, xform } = realized;
  const word = (bytes: Uint8Array, at: number) => ((bytes[at] | (bytes[at + 1] << 8)) << 16) >> 16;
  const height = word(xform, 0);
  const width = word(xform, 2);
  const pixHeight = word(info, 0x16);
  const ascent = word(info, 8);
  const bold = word(xform, 0x0f) & 0x200 ? 1 : 0;
  const first = info[0x1d];

  return {
    tmHeight: height,
    tmAscent: MulDiv(ascent, height, pixHeight),
    tmDescent: MulDiv(pixHeight - ascent, height, pixHeight),
    tmInternalLeading: MulDiv(word(info, 0x0a), height, pixHeight),
    tmExternalLeading: MulDiv(word(info, 0x0c), height, pixHeight),
    tmAveCharWidth: bold + width,
    tmMaxCharWidth: MulDiv(word(info, 0x1b), width, word(info, 0x19)) + bold,
    tmWeight: word(xform, 8) & 0xffff,
    tmItalic: xform[0x0a],
    tmUnderlined: xform[0x0b],
    tmStruckOut: xform[0x0c],
    tmFirstChar: first,
    tmLastChar: info[0x1e],
    tmDefaultChar: (info[0x1f] + first) & 0xff,
    tmBreakChar: (info[0x20] + first) & 0xff,
    tmPitchAndFamily: (info[0x18] & 0xf1) | 8 | ((info[0] & 3) << 1),
    tmCharSet: info[0x13],
    tmOverhang: word(xform, 0x11),
    tmDigitizedAspectX: word(info, 4),
    tmDigitizedAspectY: word(info, 6),
  };
}

/**
 * `GetTextFace` of a font a driver realized (`GDI.EXE` seg3 `0102`): the
 * face the `FONTINFO` names at its `dfFace`, or the logical font's own
 * spelling where the two are one atom.
 */
export function deviceFace(system: any, surface: any, realized: DeviceFont) {
  const { info, far } = realized;
  const offset = info[0x27] | (info[0x28] << 8);
  const face = readFar(system, ((far & 0xffff0000) | ((far + offset) & 0xffff)) >>> 0);
  const logical = logfontOf(system, surface.font)?.face ?? '';

  return logical && logical.toUpperCase() === face.toUpperCase() ? logical : face;
}

const ENUM_DFONTS = 6;

/** A walk of a driver's fonts, as GDI's frame for its procedure keeps it (seg5 `01c5`). */
interface FontWalk {
  proc: any;
  data: number;
  found: boolean;
  faceGiven: boolean;
  compat: number;
  textCaps: number;
}

/**
 * GDI's procedure for a driver's fonts (`GDI.EXE` seg5 `048a`): with no
 * face asked for and `TTOnly` on, a font not TrueType passes by, answering
 * 1. Otherwise the walk has found one; a font not TrueType is a device
 * font, `DEVICE_FONTTYPE` added and its `tmPitchAndFamily` given
 * `TMPF_DEVICE` and, but for a raster font, `TMPF_VECTOR`, in the driver's
 * own structure; its `TEXTMETRIC` copied with the five words of a
 * `NEWTEXTMETRIC` after it nought. The program's procedure is called with
 * the `LOGFONT`, the metrics, the type and its data, AX, DS and ES the
 * stack's, and its answer is the answer. Not followed: the compatibility
 * flags' changes to a TrueType font's type (`0542`-`0565`), and the sizes
 * taken to logical units in a mapping mode other than `MM_TEXT` (`04b5`).
 */
async function fontCallback(
  system: any,
  lpLogFont: number,
  lpTextMetric: number,
  type: number,
  id: number
) {
  const walk: FontWalk | undefined = system._fontWalks?.[id];
  const core = system.machine.cpu.core;

  if (!walk) {
    return 0;
  }

  if (!walk.faceGiven && system.fonts?.trueTypeOnly && !(type & 4)) {
    return 1;
  }

  walk.found = true;

  let kind = type & 0xffff;
  let metrics = lpTextMetric;

  if (!(kind & 4)) {
    kind |= 2;

    const at = ((lpTextMetric & 0xffff) + 0x17) & 0xffff;
    const pitch = core.read8(lpTextMetric >>> 16, at);

    core.write8(lpTextMetric >>> 16, at, (pitch & 0xf1) | 8 | (kind & 1 ? 0 : 2));
  }

  const call = async (tm: number) => {
    if (typeof walk.proc === 'function') {
      return walk.proc(lpLogFont, tm, kind, walk.data);
    }

    return system.scheduler.callProc(
      walk.proc,
      [
        [lpLogFont >>> 0, DWORD],
        [tm >>> 0, DWORD],
        [kind, UINT],
        [walk.data >>> 0, DWORD],
      ],
      system.scheduler.stackRegisters()
    );
  };

  if (kind & 4) {
    return (await call(metrics)) & 0xffff;
  }

  const copy = new Uint8Array(31 + 10);

  for (let at = 0; at < 31; at++) {
    copy[at] = core.read8(lpTextMetric >>> 16, ((lpTextMetric & 0xffff) + at) & 0xffff);
  }

  const [answer] = await onStack(system, copy, async (far) => {
    metrics = far;
    return call(far);
  });

  return Number(answer) & 0xffff;
}

/**
 * The driver's own fonts, before GDI's (`GDI.EXE` seg5 `01c5`-`021f`): its
 * `EnumDFonts` given the `PDEVICE`, the face asked for, GDI's procedure
 * and GDI's frame. Its answer, and whether any font came to GDI's
 * procedure.
 */
export async function enumerateDeviceFonts(
  system: any,
  surface: any,
  face: any,
  callback: any,
  data: number
): Promise<{ answer: number; found: boolean }> {
  const pdevice: PDevice = surface.driverDevice;
  const enumerate = proc(pdevice.driver, ENUM_DFONTS);

  if (!enumerate) {
    return { answer: 1, found: false };
  }

  system._fontWalks ??= [];
  /* USER's thunks, loaded when first wanted: imported at the top, USER's
   * modules would load in the middle of GDI's. */
  const { procToken } = await import('../user/window-words.js');

  system._fontWalkThunk ??= procToken(
    system,
    (hwnd: number, message: number, wParam: number, lParam: number, above: number) =>
      fontCallback(system, above, ((hwnd << 16) | message) >>> 0, wParam, lParam),
    14
  );

  const walk: FontWalk = {
    proc: callback,
    data: data >>> 0,
    found: false,
    faceGiven: !!face,
    compat: 0,
    textCaps: pdevice.info[0x22] | (pdevice.info[0x23] << 8),
  };
  const id = system._fontWalks.push(walk) - 1;

  try {
    const answer =
      (await callDriver(system, enumerate, [
        [pdevice.lpPDevice, DWORD],
        [farOf(face), DWORD],
        [system._fontWalkThunk >>> 0, DWORD],
        [id, DWORD],
      ])) & 0xffff;

    return { answer, found: walk.found };
  } finally {
    system._fontWalks.pop();
  }
}
