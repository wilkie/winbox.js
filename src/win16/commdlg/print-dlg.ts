'use strict';

import { DWORD, UINT } from '../types.js';
import { iconBlock } from '../user/icon-block.js';
import { scaleIcon } from '../user/driver-resources.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { decodeIcon, iconEntries, pickIcon } from '../../raster/icon.js';
import {
  api,
  B,
  bytesOf,
  buffer,
  D,
  item as itemOf,
  send as sendOf,
  sendBytes as sendBytesOf,
  sendItem as sendItemOf,
  stringOf,
  text,
  W,
  type Arg,
} from './api.js';
import { at, freeTemplate, nextNumber, ownTemplate } from './guest-calls.js';
import { procAddressOf } from './proc-address.js';
import { COMMDLG_STRINGS } from './strings.js';
import {
  LANDSCAPE_GROUP,
  PORTRAIT_GROUP,
  PRINT_TEMPLATE,
  SETUP_TEMPLATE,
  icon as iconBytes,
} from './print-resources.js';
import {
  callHook,
  dataSelector,
  error as errorOf,
  instance as instanceOf,
  message as messageOf,
  setError as setErrorOf,
  waitCursor,
} from './state.js';

/**
 * COMMDLG's Print and Print Setup dialogs: `PrintDlg` (20), the Print
 * dialog's procedure `PrintDlgProc` (21, `print-proc.ts`), Print Setup's
 * `PrintSetupDlgProc` (22, `print-setup.ts`), and the subclasses
 * `EditIntegerOnly` (23) and `dwUpArrowHack` (30), which USER calls at
 * COMMDLG's own exports as it would Microsoft's. **Read out** of
 * `COMMDLG.DLL` seg3 and **recorded** by `prdlg`; each step is COMMDLG's,
 * at the address the comments give ([[topic:print-dialogs]] in the
 * knowledge base). The twin of `crates/winbox-win16/src/commdlg/print_dlg.rs`.
 *
 * This file holds the call itself and what both dialogs share: the
 * printers COMMDLG finds in `WIN.INI`, the `DEVNAMES` it makes and checks,
 * the printer's driver loaded and asked for its `DEVMODE`, the device or
 * information context made for the program, and the Print dialog's
 * qualities. Every call into USER, GDI and KERNEL is made as COMMDLG makes
 * it, through `api.ts`.
 */

/* The `PRINTDLG`'s fields, by offset. */
export const OWNER = 0x04;
export const DEVMODE = 0x06;
export const DEVNAMES = 0x08;
export const HDC = 0x0a;
export const FLAGS = 0x0c;
export const FROM_PAGE = 0x10;
export const TO_PAGE = 0x12;
export const MIN_PAGE = 0x14;
export const MAX_PAGE = 0x16;
export const COPIES = 0x18;
export const INSTANCE = 0x1a;
export const PRINT_HOOK = 0x20;
export const SETUP_HOOK = 0x24;
export const PRINT_TEMPLATE_NAME = 0x28;
export const SETUP_TEMPLATE_NAME = 0x2c;
export const PRINT_TEMPLATE_HANDLE = 0x30;
export const SETUP_TEMPLATE_HANDLE = 0x32;

/* Its flags. */
export const PD_SELECTION = 0x1;
export const PD_PAGENUMS = 0x2;
export const PD_NOSELECTION = 0x4;
export const PD_NOPAGENUMS = 0x8;
export const PD_COLLATE = 0x10;
export const PD_PRINTTOFILE = 0x20;
export const PD_PRINTSETUP = 0x40;
export const PD_NOWARNING = 0x80;
export const PD_RETURNDC = 0x100;
export const PD_RETURNIC = 0x200;
export const PD_RETURNDEFAULT = 0x400;
export const PD_SHOWHELP = 0x800;
export const PD_ENABLEPRINTHOOK = 0x1000;
export const PD_ENABLESETUPHOOK = 0x2000;
export const PD_ENABLEPRINTTEMPLATE = 0x4000;
export const PD_ENABLESETUPTEMPLATE = 0x8000;
export const PD_ENABLEPRINTTEMPLATEHANDLE = 0x10000;
export const PD_ENABLESETUPTEMPLATEHANDLE = 0x20000;
export const PD_USEDEVMODECOPIES = 0x40000;
export const PD_DISABLEPRINTTOFILE = 0x80000;
export const PD_HIDEPRINTTOFILE = 0x100000;

/* The extended errors `PrintDlg` sets. */
export const CDERR_STRUCTSIZE = 0x1;
export const CDERR_NOTEMPLATE = 0x3;
export const CDERR_NOHINSTANCE = 0x4;
export const CDERR_LOADRESFAILURE = 0x7;
export const CDERR_LOCKRESFAILURE = 0x8;
export const CDERR_MEMALLOCFAILURE = 0x9;
export const CDERR_MEMLOCKFAILURE = 0xa;
export const CDERR_NOHOOK = 0xb;
export const CDERR_DIALOGFAILURE = 0xffff;
export const PDERR_SETUPFAILURE = 0x1001;
export const PDERR_PARSEFAILURE = 0x1002;
export const PDERR_RETDEFFAILURE = 0x1003;
export const PDERR_LOADDRVFAILURE = 0x1004;
export const PDERR_GETDEVMODEFAIL = 0x1005;
export const PDERR_INITFAILURE = 0x1006;
export const PDERR_NODEVICES = 0x1007;
export const PDERR_NODEFAULTPRN = 0x1008;
export const PDERR_DNDMMISMATCH = 0x1009;
export const PDERR_CREATEICFAILURE = 0x100a;
export const PDERR_PRINTERNOTFOUND = 0x100b;
export const PDERR_DEFAULTDIFFERENT = 0x100c;

/* Messages and the like, as COMMDLG passes them. */
export const WM_INITDIALOG = 0x0110;
export const WM_COMMAND = 0x0111;
export const WM_NEXTDLGCTL = 0x0028;
export const WM_GETFONT = 0x0031;
export const WM_MEASUREITEM = 0x002c;
export const CB_ADDSTRING = 0x0403;
export const CB_GETCOUNT = 0x0406;
export const CB_GETCURSEL = 0x0407;
export const CB_INSERTSTRING = 0x040a;
export const CB_RESETCONTENT = 0x040b;
export const CB_SETCURSEL = 0x040e;
export const CB_GETITEMDATA = 0x0410;
export const CB_SETITEMDATA = 0x0411;
export const CB_SETEXTENDEDUI = 0x0415;
export const CB_GETDROPPEDSTATE = 0x0417;
export const EM_SETSEL = 0x0401;
export const EM_LIMITTEXT = 0x0415;
export const STM_SETICON = 0x0400;
export const GWL_WNDPROC = 0xfffc;
export const GWL_STYLE = 0xfff0;
export const WS_TABSTOP = 0x00010000;
export const MB_ICONEXCLAMATION = 0x30;
export const SW_HIDE = 0;
export const SW_SHOWNA = 8;
export const QUERYESCSUPPORT = 8;
export const SETCOPYCOUNT = 0x11;
const RT_DIALOG = 5;
const DM_COPY = 2;
const DM_MODIFY = 8;
const DC_ENUMRESOLUTIONS = 0xd;

/* COMMDLG's own exports it hands USER. */
export const PRINT_DLG_PROC = 21;
export const PRINT_SETUP_DLG_PROC = 22;
export const EDIT_INTEGER_ONLY = 23;
export const DW_UP_ARROW_HACK = 30;

/* The driver's entries' names, COMMDLG's strings. */
export const EXT_DEVICE_MODE = 0x443;
export const DEVICE_MODE = 0x444;
export const DEVICE_CAPABILITIES = 0x445;

/* A `DEVNAMES`' offsets' places: the driver, the device, the port, and its `wDefault`. */
export const DRIVER = 0;
export const DEVICE = 2;
export const PORT = 4;
export const DEFAULT = 6;

/** A dialog's six bytes of COMMDLG's local memory: the structure, and Print Setup's working `DEVMODE`. */
export type Dialog = { lppd: number; devmode: number };

/** What COMMDLG keeps for its print dialogs in its data. */
export function globals(system: any) {
  const state = (system._commdlg ??= { error: 0, initialising: false });

  state.print ??= {
    /** `[1D2h]`: how many print calls are in progress (`3de2`, `3ed8`). */
    count: 0,
    /** `[1D4h]`, `[1D6h]`: the portrait and landscape icons, loaded and locked on the first of the calls in progress. */
    portrait: 0,
    landscape: 0,
    /** The icons made once: a module's icon stays loaded, and `LoadIcon` answers the same handle again (`3e11`). */
    portraitMade: 0,
    landscapeMade: 0,
    /** Whether strings 443h to 445h, the driver's entries' names, are read (`3e56`). */
    names: false,
    /** `[1F0h]`: a hook given the messages of a dialog with no property. */
    hook: 0,
    /** `[A7Ch]`: the From edit's own procedure (`1b77`). */
    editProc: 0,
    /** `[A78h]`: the printers' combo box's own procedure (`2a19`). */
    listProc: 0,
    /** `[1EEh]`: the printer Print Setup took has a driver that will not load (`2ef7`). */
    missing: false,
    /** `[1ECh]`: the height Print Setup answers `WM_MEASUREITEM` with (`2f59`). */
    itemHeight: 0,
    /** Each dialog's six bytes, by the number under its property A000h. */
    dialogs: new Map<number, Dialog>(),
  };

  return state.print;
}

/** COMMDLG loaded from its file afresh: its data as the file has it, no call in progress and no string read (`library.ts`). */
export function loaded(system: any) {
  if (system._commdlg) {
    system._commdlg.print = undefined;
  }
}

/* Reading and writing what a far pointer points to. */

export { at };

export function word(system: any, far: number, step = 0): number {
  return system.machine.cpu.core.read16(far >>> 16, at(far, step) & 0xffff);
}

export function dword(system: any, far: number, step = 0): number {
  return (word(system, far, step) | (word(system, far, step + 2) << 16)) >>> 0;
}

export function setWord(system: any, far: number, step: number, value: number) {
  system.machine.cpu.core.write16(far >>> 16, at(far, step) & 0xffff, value & 0xffff);
}

export function setDword(system: any, far: number, step: number, value: number) {
  setWord(system, far, step, value & 0xffff);
  setWord(system, far, step + 2, (value >>> 16) & 0xffff);
}

export function byteAt(system: any, far: number): number {
  return system.machine.cpu.core.read8(far >>> 16, far & 0xffff);
}

export function setByte(system: any, far: number, value: number) {
  system.machine.cpu.core.write8(far >>> 16, far & 0xffff, value & 0xff);
}

/** The string a far pointer points to, without its nought. */
export function string(system: any, far: number): number[] {
  const bytes: number[] = [];

  for (let step = 0; step < 0x200; step++) {
    const byte = byteAt(system, at(far, step));

    if (!byte) {
      break;
    }

    bytes.push(byte);
  }

  return bytes;
}

/** A string written where a far pointer points, with its nought: `lstrcpy`. */
export function putString(system: any, far: number, value: number[]) {
  [...value, 0].forEach((byte, step) => setByte(system, at(far, step), byte));
}

/** The flags. */
export function flags(system: any, lppd: number) {
  return dword(system, lppd, FLAGS);
}

/** One of a `DEVNAMES`' strings, by its offset's place. */
export function nameOf(system: any, names: number, which: number) {
  return at(names, word(system, names, which));
}

/* Calls into USER, GDI and KERNEL, as COMMDLG makes them (`api.ts`). */

export async function call(system: any, module: string, name: string, args: Arg[]) {
  return (await api(system, module, name, args)).value >>> 0;
}

export { api };

export async function lock(system: any, handle: number) {
  return await call(system, 'KERNEL', 'GlobalLock', [W(handle)]);
}

export async function unlock(system: any, handle: number) {
  await call(system, 'KERNEL', 'GlobalUnlock', [W(handle)]);
}

export async function free(system: any, handle: number) {
  await call(system, 'KERNEL', 'GlobalFree', [W(handle)]);
}

export async function alloc(system: any, how: number, size: number) {
  return (await call(system, 'KERNEL', 'GlobalAlloc', [W(how), D(size)])) & 0xffff;
}

export async function item(system: any, dialog: number, id: number) {
  return await itemOf(system, dialog, id);
}

/** `EnableWindow(GetDlgItem(dialog, id), on)`. */
export async function enable(system: any, dialog: number, id: number, on: boolean) {
  const control = await item(system, dialog, id);

  await call(system, 'USER', 'EnableWindow', [W(control), W(on ? 1 : 0)]);
}

/** `ShowWindow(GetDlgItem(dialog, id), how)`. */
export async function show(system: any, dialog: number, id: number, how: number) {
  const control = await item(system, dialog, id);

  await call(system, 'USER', 'ShowWindow', [W(control), W(how)]);
}

export async function sendItem(
  system: any,
  dialog: number,
  id: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return (await sendItemOf(system, dialog, id, message, wParam, lParam)) >>> 0;
}

export async function send(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return (await sendOf(system, hwnd, message, wParam, lParam)) >>> 0;
}

export async function sendBytes(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: Arg
) {
  return (await sendBytesOf(system, hwnd, message, wParam, lParam)).value >>> 0;
}

export async function check(system: any, dialog: number, id: number, on: number) {
  await call(system, 'USER', 'CheckDlgButton', [W(dialog), W(id), W(on)]);
}

export async function checkRadio(
  system: any,
  dialog: number,
  first: number,
  last: number,
  id: number
) {
  await call(system, 'USER', 'CheckRadioButton', [W(dialog), W(first), W(last), W(id)]);
}

export async function checked(system: any, dialog: number, id: number) {
  return (await call(system, 'USER', 'IsDlgButtonChecked', [W(dialog), W(id)])) & 0xffff;
}

export async function setItemInt(system: any, dialog: number, id: number, value: number) {
  await call(system, 'USER', 'SetDlgItemInt', [W(dialog), W(id), W(value), W(0)]);
}

/** `MessageBox(owner, text, caption, MB_ICONEXCLAMATION)`. */
export async function messageBox(system: any, owner: number, message: number[], caption: number[]) {
  await call(system, 'USER', 'MessageBox', [
    W(owner),
    text(message),
    text(caption),
    W(MB_ICONEXCLAMATION),
  ]);
}

/** `lstrcmpi` of two names, as COMMDLG compares them: whether they are the same. */
export async function same(system: any, one: Arg, other: Arg) {
  return ((await call(system, 'USER', 'lstrcmpi', [one, other])) & 0xffff) === 0;
}

/** `GetProfileString` into a buffer of `size`: the length, and the bytes. */
export async function profile(
  system: any,
  section: number[],
  key: Arg,
  size: number
): Promise<[number, number[]]> {
  /* The buffer is the third or fourth laid out, by whether the key is. */
  const index = 'b' in key ? 3 : 2;
  const answer = await api(system, 'KERNEL', 'GetProfileString', [
    text(section),
    key,
    text([]),
    buffer(size),
    W(size),
  ]);

  return [answer.value & 0xffff, answer.buffers[index] ?? []];
}

/** The bytes up to the nought. */
export function tillNought(bytes: number[]) {
  const end = bytes.indexOf(0);

  return end < 0 ? bytes.slice() : bytes.slice(0, end);
}

/** One of COMMDLG's strings (`LoadString` of its instance). */
export function resource(id: number): number[] {
  return bytesOf(COMMDLG_STRINGS.get(id) ?? '');
}

/** The Windows version, as COMMDLG keeps it (`[0CAEh]`, `GetVersion` with its bytes swapped, seg7 `00ef`): 30Ah on 3.10. */
export async function version(system: any) {
  const answer = (await call(system, 'KERNEL', 'GetVersion', [])) & 0xffff;

  return ((answer & 0xff) << 8) | (answer >>> 8);
}

export function setError(system: any, code: number) {
  setErrorOf(system, code);
}

export function error(system: any) {
  return errorOf(system);
}

export async function wait(system: any, busy: boolean) {
  await waitCursor(system, busy);
}

/** The far address of one of COMMDLG's exports, WinBox's own. */
export function exportAddress(system: any, ordinal: number) {
  return procAddressOf(system, ordinal);
}

/** An argument a procedure of the driver's is given: a word, or a doubleword. */
export type DriverArg = { w: number } | { d: number };

/** A procedure of the printer's driver called as COMMDLG calls one, a far Pascal call with its own data segment in DS: its answer, DX:AX. */
export async function driverCall(system: any, procedure: number, args: DriverArg[]) {
  const answer = await system.scheduler.callProc(
    procedure >>> 0,
    args.map((arg) => ('w' in arg ? [arg.w & 0xffff, UINT] : [arg.d >>> 0, DWORD])),
    { ds: dataSelector(system) }
  );

  return Number(answer) >>> 0;
}

/** `DeviceCapabilities(device, port, index, output, devmode)`. */
export async function capabilities(
  system: any,
  procedure: number,
  names: number,
  index: number,
  output: number,
  devmode: number
) {
  return await driverCall(system, procedure, [
    { d: nameOf(system, names, DEVICE) },
    { d: nameOf(system, names, PORT) },
    { w: index },
    { d: output },
    { d: devmode },
  ]);
}

/** The driver's procedure by one of the names of strings 443h to 445h, or by an empty name before they are read (`3e56`). */
export async function driverEntry(system: any, driver: number, id: number) {
  const name = globals(system).names ? resource(id) : [];

  return await call(system, 'KERNEL', 'GetProcAddress', [W(driver), text(name)]);
}

/* What both dialogs share. */

/** The default printer's `DEVNAMES`, from `[windows]` `device=` (`00ef`): nought, the error set, for none or for a line that does not parse. */
export async function defaultNames(system: any) {
  const [length, read] = await profile(system, bytesOf('windows'), text(bytesOf('device')), 0x84);
  const line = tillNought(read);

  if (!length) {
    setError(system, PDERR_NODEFAULTPRN);
    return 0;
  }

  const handle = await alloc(system, 0x42, length + 0x29);

  if (!handle) {
    setError(system, CDERR_MEMALLOCFAILURE);
    return 0;
  }

  const names = await lock(system, handle);

  setWord(system, names, DEVICE, 8);
  putString(system, at(names, 8), line);

  /* The device to the first comma, the driver to the next, the port the rest (`0187`, `01ef`). */
  const first = line.indexOf(0x2c);
  const second = first < 0 ? -1 : line.indexOf(0x2c, first + 1);

  if (first < 0 || second < 0) {
    setError(system, PDERR_PARSEFAILURE);
    await unlock(system, handle);
    await free(system, handle);
    return 0;
  }

  setByte(system, at(names, 8 + first), 0);
  setWord(system, names, DRIVER, 8 + first + 1);
  setByte(system, at(names, 8 + second), 0);
  setWord(system, names, PORT, 8 + second + 1);
  setWord(system, names, DEFAULT, 0x4001);
  await unlock(system, handle);
  return handle;
}

/**
 * A program's `DEVNAMES` checked against `WIN.INI` (`0a93`): its device a
 * key of `[devices]` whose driver is its driver and whose ports include its
 * port; marked the default, the default printer too.
 */
export async function checkNames(system: any, handle: number) {
  const names = await lock(system, handle);

  if (!names) {
    setError(system, CDERR_MEMLOCKFAILURE);
    return false;
  }

  let found = false;

  setWord(system, names, DEFAULT, word(system, names, DEFAULT) & ~0x4000);
  setError(system, PDERR_PRINTERNOTFOUND);

  const [length, read] = await profile(
    system,
    bytesOf('devices'),
    D(nameOf(system, names, DEVICE)),
    0x200
  );
  const value = tillNought(read);
  const comma = value.indexOf(0x2c);

  if (
    length &&
    comma >= 0 &&
    (await same(system, text(value.slice(0, comma)), D(nameOf(system, names, DRIVER))))
  ) {
    let start = comma + 1;

    for (;;) {
      const next = value.indexOf(0x2c, start);
      const end = next < 0 ? value.length : next;
      const port = value.slice(start, Math.max(end, start));

      if (await same(system, text(port), D(nameOf(system, names, PORT)))) {
        setError(system, 0);
        found = true;
        break;
      }

      start = end + 1;

      if (start >= length) {
        break;
      }
    }
  }

  if (error(system) === 0 && word(system, names, DEFAULT) & 1) {
    const other = await defaultNames(system);

    if (!other) {
      found = false;
    } else {
      const theirs = await lock(system, other);

      if (!theirs) {
        found = false;
        setError(system, CDERR_MEMLOCKFAILURE);
      } else {
        let alike = true;

        for (const which of [DEVICE, DRIVER, PORT]) {
          if (
            !(await same(system, D(nameOf(system, names, which)), D(nameOf(system, theirs, which))))
          ) {
            alike = false;
            break;
          }
        }

        if (!alike) {
          setError(system, PDERR_DEFAULTDIFFERENT);
          found = false;
        }

        await unlock(system, other);
        await free(system, other);
      }
    }
  }

  await unlock(system, handle);
  return found;
}

/**
 * The structure's printer found or made (`1245`): its `DEVNAMES`, one made
 * of its `DEVMODE`'s device, or the default's. The bits for the
 * `DEVNAMES`' `wDefault` -- 8000h, and 4000h for the default's made here --
 * or nought, the error set.
 */
export async function findNames(system: any, lppd: number) {
  let bits = 0x8000;
  const devmode = word(system, lppd, DEVMODE);

  if (!devmode) {
    if (!word(system, lppd, DEVNAMES)) {
      const names = await defaultNames(system);

      setWord(system, lppd, DEVNAMES, names);

      if (!names) {
        return 0;
      }

      bits |= 0x4000;
    }

    return bits;
  }

  const mode = await lock(system, devmode);

  if (!mode) {
    setError(system, CDERR_MEMLOCKFAILURE);
    return 0;
  }

  const handle = word(system, lppd, DEVNAMES);

  if (handle) {
    if (!(await lock(system, handle))) {
      setError(system, CDERR_MEMLOCKFAILURE);
      await unlock(system, devmode);
      return 0;
    }

    await unlock(system, handle);
    await unlock(system, devmode);
    return bits;
  }

  /* A `DEVNAMES` of the `DEVMODE`'s device, its driver and first port from `[devices]` (`12b1`). */
  const [length, read] = await profile(system, bytesOf('devices'), D(mode), 0x200);
  const value = tillNought(read);

  if (!length) {
    setError(system, PDERR_NODEVICES);
    await unlock(system, devmode);
    return 0;
  }

  const comma = value.indexOf(0x2c);

  if (comma < 0) {
    setError(system, PDERR_PARSEFAILURE);
    await unlock(system, devmode);
    return 0;
  }

  const driver = value.slice(0, comma);
  const rest = value.slice(comma + 1);
  const next = rest.indexOf(0x2c);
  const port = next < 0 ? rest : rest.slice(0, next);
  const device = string(system, mode);
  const names = await alloc(system, 2, port.length + driver.length + device.length + 0x2b);

  setWord(system, lppd, DEVNAMES, names);

  if (!names) {
    setError(system, CDERR_MEMALLOCFAILURE);
    await unlock(system, devmode);
    return 0;
  }

  const far = await lock(system, names);
  const toDriver = device.length + 9;
  const toPort = driver.length + device.length + 0xa;

  setWord(system, far, DEVICE, 8);
  putString(system, at(far, 8), device);
  setWord(system, far, DRIVER, toDriver);
  putString(system, at(far, toDriver), driver);
  setWord(system, far, PORT, toPort);
  putString(system, at(far, toPort), port);
  setWord(system, far, DEFAULT, 0x4000);
  await unlock(system, names);
  await unlock(system, devmode);
  return bits;
}

/**
 * The printer's driver loaded (`0228`): its name cut at its first dot,
 * where it is in the `DEVNAMES`, and `.DRV` added, under
 * `SetErrorMode(8003h)`; tried twice, the second time without the system
 * folder COMMDLG never fills in (`[898h]`). Its instance, or what
 * `LoadLibrary` answered.
 */
export async function loadDriver(system: any, name: number) {
  const path = string(system, name);
  const dot = path.indexOf(0x2e);

  if (dot >= 0) {
    setByte(system, at(name, dot), 0);
    path.length = dot;
  }

  path.push(...bytesOf('.DRV'));

  const previous = (await call(system, 'KERNEL', 'SetErrorMode', [W(0x8003)])) & 0xffff;
  let driver = (await call(system, 'KERNEL', 'LoadLibrary', [text(path)])) & 0xffff;

  if (driver < 0x20) {
    driver = (await call(system, 'KERNEL', 'LoadLibrary', [text(path)])) & 0xffff;
  }

  await call(system, 'KERNEL', 'SetErrorMode', [W(previous)]);
  return driver;
}

export async function freeLibrary(system: any, module: number) {
  await call(system, 'KERNEL', 'FreeLibrary', [W(module)]);
}

/** The driver's `ExtDeviceMode` (`108c`): nought where it has only `DeviceMode`, all ones where it has neither. */
export async function extDeviceMode(system: any, driver: number) {
  const found = await driverEntry(system, driver, EXT_DEVICE_MODE);

  if (found) {
    return found;
  }

  return (await driverEntry(system, driver, DEVICE_MODE)) ? 0 : 0xffffffff;
}

/**
 * A `DEVMODE` from the driver's `ExtDeviceMode` (`10cc`): `modify`, a new
 * block made from `given` with `DM_COPY | DM_MODIFY`; else the driver's
 * default with `DM_COPY`, in `given` made the size, or a new block. The
 * handle; nought where the driver has only `DeviceMode` or would not
 * answer; FFFFh where it has neither, or the memory was not had.
 */
export async function devMode(
  system: any,
  hwnd: number,
  driver: number,
  given: number,
  names: number,
  modify: boolean
) {
  const procedure = await extDeviceMode(system, driver);

  if (procedure === 0xffffffff) {
    return 0xffff;
  }

  if (!procedure) {
    return 0;
  }

  const device = nameOf(system, names, DEVICE);
  const port = nameOf(system, names, PORT);
  const ask = (output: number, input: number, mode: number) =>
    driverCall(system, procedure, [
      { w: hwnd },
      { w: driver },
      { d: output },
      { d: device },
      { d: port },
      { d: input },
      { d: 0 },
      { w: mode },
    ]);
  const size = (await ask(0, 0, 0)) & 0xffff;

  if (modify) {
    if (!given) {
      return 0;
    }

    const input = await lock(system, given);

    if (!input) {
      return 0;
    }

    let handle = await alloc(system, 2, size);

    if (handle) {
      const output = await lock(system, handle);

      if (!output) {
        handle = 0;
      } else {
        await ask(output, input, DM_COPY | DM_MODIFY);
        await unlock(system, handle);
      }
    }

    await unlock(system, given);
    return handle;
  }

  const handle = given
    ? (await call(system, 'KERNEL', 'GlobalReAlloc', [W(given), D(size), W(2)])) & 0xffff
    : await alloc(system, 2, size);

  if (!handle) {
    return 0xffff;
  }

  const output = await lock(system, handle);

  if (!((await ask(output, 0, DM_COPY)) & 0xffff)) {
    await unlock(system, handle);
    await free(system, handle);
    return 0;
  }

  await unlock(system, handle);
  return handle;
}

/** The device or information context `PD_RETURNDC` or `PD_RETURNIC` asks for, on `FILE:` with `PD_PRINTTOFILE`, put in `hDC` (`2fdc`). */
export async function makeDc(system: any, devmode: number, names: number, lppd: number) {
  const given = flags(system, lppd);
  const fn = given & PD_RETURNDC ? 'CreateDC' : given & PD_RETURNIC ? 'CreateIC' : null;

  if (!fn) {
    return;
  }

  const port = given & PD_PRINTTOFILE ? text(bytesOf('FILE:')) : D(nameOf(system, names, PORT));
  const hdc =
    (await call(system, 'GDI', fn, [
      D(nameOf(system, names, DRIVER)),
      D(nameOf(system, names, DEVICE)),
      port,
      D(devmode),
    ])) & 0xffff;

  setWord(system, lppd, HDC, hdc);
}

/** One of the two icons, WinBox's own: made once, kept. */
function ownIcon(system: any, landscape: boolean) {
  const state = globals(system);
  const made = landscape ? state.landscapeMade : state.portraitMade;

  if (made) {
    return made;
  }

  const group = landscape ? LANDSCAPE_GROUP : PORTRAIT_GROUP;
  const entry = pickIcon(iconEntries(group), 32, system.display?.colors ?? 16);
  const bytes = entry ? iconBytes(entry.id) : null;
  const handle = bytes
    ? iconBlock(system, scaleIcon(decodeIcon(bytes, DevicePalette.forDisplay(system.display)), 32))
    : 0;

  if (landscape) {
    state.landscapeMade = handle;
  } else {
    state.portraitMade = handle;
  }

  return handle;
}

/**
 * The first of COMMDLG's print calls in progress sets up (`3de2`): the
 * icons loaded and locked, the driver's entries' names read. A count of
 * the calls is kept; a later one does nothing. Whether it was set up.
 */
async function start(system: any) {
  const state = globals(system);
  const was = state.count;

  state.count = (was + 1) & 0xffff;

  if (was) {
    return true;
  }

  const locked = [false, false];

  state.portrait = ownIcon(system, false);

  let good = !!state.portrait;

  if (good) {
    locked[0] = !!(await call(system, 'KERNEL', 'LockResource', [W(state.portrait)]));
    good = locked[0];
  }

  if (good) {
    state.landscape = ownIcon(system, true);
    good = !!state.landscape;

    if (good) {
      locked[1] = !!(await call(system, 'KERNEL', 'LockResource', [W(state.landscape)]));
      good = locked[1];
    }
  }

  if (good) {
    state.names = true;
    return true;
  }

  if (locked[0]) {
    await unlock(system, state.portrait);

    if (locked[1]) {
      await unlock(system, state.landscape);
    }
  }

  state.count = 0;
  state.portrait = 0;
  state.landscape = 0;
  return false;
}

/** A print call ends (`3ed8`): the count taken down, and with the last one, the icons unlocked and let go of. */
async function end(system: any) {
  const state = globals(system);

  state.count = (state.count - 1) & 0xffff;

  if (!state.count) {
    await unlock(system, state.portrait);
    await unlock(system, state.landscape);
    state.portrait = 0;
    state.landscape = 0;
  }
}

/**
 * The printer as a line (`062e`): "`<device>` on `<port>`", or, for a port
 * the network knows, "`<device>` on `<network name>` (`<port>`)", the name
 * lowered.
 */
export async function onPort(system: any, device: number[], port: number[]) {
  const connection = await api(system, 'USER', 'WNetGetConnection', [
    text(port),
    buffer(0x40),
    B([0x40, 0]),
  ]);
  const line = [...device, ...bytesOf(' on ')];

  if (!(connection.value & 0xffff)) {
    const lowered = await api(system, 'USER', 'AnsiLower', [
      text(tillNought(connection.buffers[0])),
    ]);

    line.push(...tillNought(lowered.buffers[0]), ...bytesOf(' ('), ...port, 0x29);
  } else {
    line.push(...port);
  }

  return line;
}

/** The Print dialog's printer line (`1471`): the printer on its port, for the default "Default Printer (" before it and ")" after. */
export async function printerLine(system: any, names: number) {
  const device = string(system, nameOf(system, names, DEVICE));
  const port = string(system, nameOf(system, names, PORT));
  const line = await onPort(system, device, port);

  if (!(word(system, names, DEFAULT) & 1)) {
    return line;
  }

  return [...resource(0x441), ...line, 0x29];
}

/**
 * The Print dialog's qualities filled (`0350`): the driver's resolutions
 * where it has `DeviceCapabilities` and a `DEVMODE` of 3.10's, else
 * COMMDLG's four, the one of `quality` chosen. `lppd` nought for the four.
 */
export async function qualities(system: any, dialog: number, quality: number, lppd: number) {
  const list = await item(system, dialog, 0x470);

  await send(system, list, CB_RESETCONTENT, 0, 0);

  let driver = 0;
  let namesHandle = 0;
  let modeHandle = 0;
  let chosen: number | null = null;

  driver: {
    if (!lppd) {
      break driver;
    }

    const devmode = word(system, lppd, DEVMODE);
    const devnames = word(system, lppd, DEVNAMES);

    if (!devmode || !devnames) {
      break driver;
    }

    namesHandle = devnames;

    const names = await lock(system, devnames);

    driver = await loadDriver(system, nameOf(system, names, DRIVER));

    if (driver < 0x20) {
      break driver;
    }

    modeHandle = devmode;

    const mode = await lock(system, devmode);

    if (word(system, mode, 0x20) < 0x30a) {
      break driver;
    }

    const procedure = await driverEntry(system, driver, DEVICE_CAPABILITIES);

    if (!procedure) {
      break driver;
    }

    let count = await capabilities(system, procedure, names, DC_ENUMRESOLUTIONS, 0, 0);

    if (!count || count === 0xffffffff) {
      break driver;
    }

    const shifted = (count << 3) & 0xffff;
    const block = await alloc(
      system,
      0x42,
      shifted & 0x8000 ? (0xffff0000 | shifted) >>> 0 : shifted
    );

    if (!block) {
      break driver;
    }

    let selected = 0;
    const pairs = await lock(system, block);

    count = await capabilities(system, procedure, names, DC_ENUMRESOLUTIONS, pairs, 0);

    const modern = (await version(system)) >= 0x30a;

    for (let index = (((count & 0xffff) << 16) >> 16) - 1; index >= 0; index--) {
      const x = dword(system, pairs, index << 3);
      const y = dword(system, pairs, (index << 3) + 4);
      const label = x === y ? `${x | 0} dpi` : `${x | 0} dpi x ${y | 0} dpi`;

      await sendBytes(system, list, CB_INSERTSTRING, 0, text(bytesOf(label)));
      await send(system, list, CB_SETITEMDATA, 0, (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0);

      const yResolution = word(system, mode, 0x40);

      if (
        (x & 0xffff) === (quality & 0xffff) &&
        (!modern || !yResolution || yResolution === (y & 0xffff))
      ) {
        selected = index;
      }
    }

    await unlock(system, block);
    await free(system, block);
    chosen = selected;
  }

  if (chosen === null) {
    /* COMMDLG's four, Draft first, each put at the top (`056c`). */
    let data = 0xffff;

    for (let id = 0x433; id >= 0x430; id--) {
      await sendBytes(system, list, CB_INSERTSTRING, 0, text(resource(id)));
      await send(system, list, CB_SETITEMDATA, 0, data);
      data = (data - 1) & 0xffff;
    }

    const signed = (quality << 16) >> 16;

    chosen = (signed >= -4 && signed < 0 ? signed : -4) + 4;
  }

  await send(system, list, CB_SETCURSEL, chosen, 0);

  if (driver) {
    await freeLibrary(system, driver);
  }

  if (namesHandle) {
    await unlock(system, namesHandle);
  }

  if (modeHandle) {
    await unlock(system, modeHandle);
  }
}

/** A program's template found and loaded (`0a5e`): nought for either failing. */
async function findTemplate(system: any, instance: number, name: number) {
  const found =
    (await call(system, 'KERNEL', 'FindResource', [W(instance), D(name), D(RT_DIALOG)])) & 0xffff;

  if (!found) {
    return 0;
  }

  return (await call(system, 'KERNEL', 'LoadResource', [W(instance), W(found)])) & 0xffff;
}

/** Where a dialog's template comes from: the program's handle, its named one, or COMMDLG's own. */
export type From = 'given' | 'named' | 'own';

/**
 * The template for Print Setup, or the Print dialog, as `PrintDlg` and
 * Print's Setup button choose it (`0e23`, `0ec9`, `3bb4`): its handle and
 * where it came from, or the error for none.
 */
export async function template(
  system: any,
  lppd: number,
  setup: boolean
): Promise<{ handle: number; from: From } | { error: number }> {
  const given = flags(system, lppd);
  const [handleFlag, nameFlag, handleAt, nameAt] = setup
    ? [
        PD_ENABLESETUPTEMPLATEHANDLE,
        PD_ENABLESETUPTEMPLATE,
        SETUP_TEMPLATE_HANDLE,
        SETUP_TEMPLATE_NAME,
      ]
    : [
        PD_ENABLEPRINTTEMPLATEHANDLE,
        PD_ENABLEPRINTTEMPLATE,
        PRINT_TEMPLATE_HANDLE,
        PRINT_TEMPLATE_NAME,
      ];

  if (given & handleFlag) {
    return { handle: word(system, lppd, handleAt), from: 'given' };
  }

  if (given & nameFlag) {
    const name = dword(system, lppd, nameAt);

    if (!name) {
      return { error: CDERR_NOTEMPLATE };
    }

    const instance = word(system, lppd, INSTANCE);

    if (!instance) {
      return { error: CDERR_NOHINSTANCE };
    }

    const handle = await findTemplate(system, instance, name);

    return handle ? { handle, from: 'named' } : { error: CDERR_LOADRESFAILURE };
  }

  const handle = await ownTemplate(system, setup ? SETUP_TEMPLATE : PRINT_TEMPLATE);

  return handle ? { handle, from: 'own' } : { error: CDERR_LOADRESFAILURE };
}

/** A template let go of as `PrintDlg` lets it go (`0fe4`, `3cb4`). */
export async function letGo(system: any, handle: number, from: From) {
  if (from === 'named') {
    await call(system, 'KERNEL', 'FreeResource', [W(handle)]);
  } else if (from === 'own') {
    await freeTemplate(system, handle);
  }
}

/**
 * The **PrintDlg** function runs the Print dialog, or with `PD_PRINTSETUP`
 * the Print Setup dialog, or with `PD_RETURNDEFAULT` no dialog at all
 * (`COMMDLG.DLL` seg3 `0c94`).
 *
 * @returns {Types.BOOL} What the dialog ended with: 1 for OK.
 */
export async function PrintDlg(this: any, lppd: number) {
  await wait(this, true);

  const answer = await callPrintDlg(this, lppd >>> 0);

  await end(this);
  await wait(this, false);
  return answer;
}

/** The call between the hourglass and the count's taking down. */
async function callPrintDlg(system: any, lppd: number) {
  if (dword(system, lppd, 0) !== 0x34) {
    setError(system, CDERR_STRUCTSIZE);
    return 0;
  }

  if (!(await start(system))) {
    setError(system, PDERR_SETUPFAILURE);
    return 0;
  }

  const given = word(system, lppd, DEVNAMES);

  if (given && !(await checkNames(system, given))) {
    return 0;
  }

  setError(system, 0);

  const asked = flags(system, lppd);

  if (asked & PD_RETURNDEFAULT) {
    if (word(system, lppd, DEVNAMES) || word(system, lppd, DEVMODE)) {
      setError(system, PDERR_RETDEFFAILURE);
      return 0;
    }

    const handle = await defaultNames(system);

    setWord(system, lppd, DEVNAMES, handle);

    if (!handle) {
      return 0;
    }

    const names = await lock(system, handle);

    if (!names) {
      setError(system, CDERR_MEMLOCKFAILURE);
      return 0;
    }

    let answer = 0;
    const driver = await loadDriver(system, nameOf(system, names, DRIVER));

    if (driver < 0x20) {
      setError(system, PDERR_LOADDRVFAILURE);
    } else {
      const owner = word(system, lppd, OWNER);
      let devmode = await devMode(system, owner, driver, word(system, lppd, DEVMODE), names, false);

      if (devmode === 0xffff) {
        devmode = 0;
      }

      setWord(system, lppd, DEVMODE, devmode);

      const mode = devmode ? await lock(system, devmode) : 0;

      await makeDc(system, mode, names, lppd);

      if (devmode) {
        await unlock(system, devmode);
      }

      answer = 1;
      await freeLibrary(system, driver);
    }

    await unlock(system, handle);

    if (!answer) {
      await free(system, handle);
      setWord(system, lppd, DEVNAMES, 0);
    }

    return answer;
  }

  const setup = !!(asked & PD_PRINTSETUP);
  const found = await template(system, lppd, setup);

  if ('error' in found) {
    setError(system, found.error);
    return 0;
  }

  /* The hook kept for the messages before `WM_INITDIALOG` (`0e48`, `0f4e`). */
  if (setup && asked & PD_ENABLESETUPHOOK) {
    globals(system).hook = dword(system, lppd, SETUP_HOOK);
  } else if (!setup && asked & PD_ENABLEPRINTHOOK) {
    globals(system).hook = dword(system, lppd, PRINT_HOOK);
  }

  if (!(await call(system, 'KERNEL', 'LockResource', [W(found.handle)]))) {
    setError(system, CDERR_LOCKRESFAILURE);
    return 0;
  }

  let answer =
    (await call(system, 'USER', 'DialogBoxIndirectParam', [
      W(instanceOf(system)),
      W(found.handle),
      W(word(system, lppd, OWNER)),
      D(exportAddress(system, setup ? PRINT_SETUP_DLG_PROC : PRINT_DLG_PROC)),
      D(lppd),
    ])) & 0xffff;

  globals(system).hook = 0;

  if (answer === 0xffff) {
    setError(system, CDERR_DIALOGFAILURE);
    answer = 0;
  }

  await unlock(system, found.handle);
  await letGo(system, found.handle, found.from);
  return answer;
}

/** A dialog's number under its property A000h: nought before it starts. */
export async function number(system: any, dialog: number) {
  return (await call(system, 'USER', 'GetProp', [W(dialog), D(0xa000)])) & 0xffff;
}

/** The dialog's six bytes, by its number. */
export function dialogData(system: any, number: number): Dialog {
  return globals(system).dialogs.get(number) ?? { lppd: 0, devmode: 0 };
}

/** A dialog given its six bytes and its property (`1750`, `2559`): its number. */
export async function giveProperty(system: any, dialog: number, lppd: number) {
  const number = nextNumber(system);

  await call(system, 'USER', 'SetProp', [W(dialog), D(0xa000), W(number)]);
  globals(system).dialogs.set(number, { lppd, devmode: 0 });
  return number;
}

/** A dialog's property taken and its six bytes let go (`1974`, `337e`). */
export async function takeProperty(system: any, dialog: number) {
  const number = (await call(system, 'USER', 'RemoveProp', [W(dialog), D(0xa000)])) & 0xffff;

  globals(system).dialogs.delete(number);
}

/**
 * The hooks before a dialog's own code (`3757`, `30b1`): the structure's,
 * once there is a property, then the one kept, but for `WM_INITDIALOG`.
 * What answered, where something did.
 */
export async function hooks(
  system: any,
  hookAt: number,
  dialog: number,
  message: number,
  wParam: number,
  lParam: number
): Promise<number | null> {
  const which = await number(system, dialog);

  if (which) {
    const lppd = dialogData(system, which).lppd;

    if (lppd) {
      const hook = dword(system, lppd, hookAt);

      if (hook) {
        const answer = await callHook(system, hook, dialog, message, wParam, lParam);

        if (answer) {
          return answer;
        }
      }
    }
  }

  const kept = globals(system).hook;

  if (kept && message !== WM_INITDIALOG) {
    const answer = await callHook(system, kept, dialog, message, wParam, lParam);

    if (answer) {
      return answer;
    }
  }

  return null;
}

export { callHook, instanceOf as instance, messageOf as message, stringOf };

/** `CallWindowProc` of a subclassed control's own procedure. */
async function callWindowProc(
  system: any,
  procedure: number,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return await call(system, 'USER', 'CallWindowProc', [
    D(procedure),
    W(hwnd),
    W(message),
    W(wParam),
    D(lParam),
  ]);
}

/**
 * `EditIntegerOnly` (seg3 `0000`): a character but a digit or Backspace
 * refused with a beep; all else to the edit's own procedure.
 */
export async function EditIntegerOnly(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const WM_CHAR = 0x0102;

  if (message === WM_CHAR && wParam !== 8 && !(wParam >= 0x30 && wParam <= 0x39)) {
    await call(this, 'USER', 'MessageBeep', [W(0)]);
    return 0;
  }

  return await callWindowProc(this, globals(this).editProc, hwnd, message, wParam, lParam >>> 0);
}

/**
 * `dwUpArrowHack` (seg3 `0056`): Up or Left in the closed printers' list
 * moves to Default Printer and checks it; all else to the combo box's own
 * procedure.
 */
export async function dwUpArrowHack(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const WM_KEYDOWN = 0x0100;
  const VK_LEFT = 0x25;
  const VK_UP = 0x26;

  if (
    message === WM_KEYDOWN &&
    (wParam === VK_UP || wParam === VK_LEFT) &&
    !(await send(this, hwnd, CB_GETDROPPEDSTATE, 0, 0))
  ) {
    const parent = (await call(this, 'USER', 'GetParent', [W(hwnd)])) & 0xffff;
    const button = await item(this, parent, 0x422);

    await send(this, parent, WM_NEXTDLGCTL, button, 1);
    await checkRadio(this, parent, 0x422, 0x423, 0x422);
    return 0;
  }

  return await callWindowProc(this, globals(this).listProc, hwnd, message, wParam, lParam >>> 0);
}
