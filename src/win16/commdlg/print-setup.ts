'use strict';

import { B, buffer, bytesOf, D, sendItemBytes, setItemText, text, W, type Arg } from './api.js';
import {
  CB_ADDSTRING,
  CB_GETCOUNT,
  CB_GETCURSEL,
  CB_GETDROPPEDSTATE,
  CB_GETITEMDATA,
  CB_INSERTSTRING,
  CB_RESETCONTENT,
  CB_SETCURSEL,
  CB_SETEXTENDEDUI,
  CB_SETITEMDATA,
  CDERR_MEMLOCKFAILURE,
  CDERR_NOHOOK,
  DEFAULT,
  DEVICE,
  DEVICE_CAPABILITIES,
  DEVMODE,
  DEVNAMES,
  DRIVER,
  DW_UP_ARROW_HACK,
  EXT_DEVICE_MODE,
  GWL_STYLE,
  GWL_WNDPROC,
  HDC,
  OWNER,
  PDERR_GETDEVMODEFAIL,
  PDERR_INITFAILURE,
  PDERR_LOADDRVFAILURE,
  PDERR_NODEFAULTPRN,
  PDERR_NODEVICES,
  PDERR_PRINTERNOTFOUND,
  PD_ENABLESETUPHOOK,
  PD_NOWARNING,
  PD_PRINTSETUP,
  PD_RETURNDC,
  PD_RETURNIC,
  PD_SHOWHELP,
  PORT,
  QUERYESCSUPPORT,
  SETUP_HOOK,
  STM_SETICON,
  SW_HIDE,
  SW_SHOWNA,
  WM_COMMAND,
  WM_GETFONT,
  WM_INITDIALOG,
  WM_MEASUREITEM,
  WM_NEXTDLGCTL,
  WS_TABSTOP,
  api,
  at,
  byteAt,
  call,
  callHook,
  capabilities,
  check,
  checkNames,
  checkRadio,
  checked,
  defaultNames,
  devMode,
  dialogData,
  driverCall,
  driverEntry,
  dword,
  enable,
  error,
  exportAddress,
  findNames,
  flags,
  free,
  freeLibrary,
  giveProperty,
  globals,
  hooks,
  item,
  loadDriver,
  lock,
  makeDc,
  message,
  messageBox,
  nameOf,
  number,
  onPort,
  profile,
  putString,
  resource,
  same,
  send,
  sendItem,
  setDword,
  setError,
  setWord,
  show,
  string,
  takeProperty,
  tillNought,
  unlock,
  version,
  wait,
  word,
} from './print-dlg.js';

/**
 * The Print Setup dialog's procedure, `PrintSetupDlgProc` (22): COMMDLG's
 * dialog 1539, from `PrintDlg` or the Print dialog's Setup button -- the
 * printers from `WIN.INI`, the orientation, and the paper sizes and sources
 * the driver names (`COMMDLG.DLL` seg3 `307a`). The twin of
 * `crates/winbox-win16/src/commdlg/print_setup.rs`.
 */

const IDOK = 1;
const PSH_OPTIONS = 0x400;
const PSH_HELP = 0x40e;
const RAD_PORTRAIT = 0x420;
const RAD_LANDSCAPE = 0x421;
const RAD_DEFAULT = 0x422;
const RAD_SPECIFIC = 0x423;
const GRP_ORIENTATION = 0x430;
const GRP_PAPER = 0x431;
const ICO_ORIENTATION = 0x43c;
const STC_CURRENT = 0x440;
const STC_SIZE = 0x441;
const STC_SOURCE = 0x442;
const CMB_PRINTERS = 0x470;
const CMB_SIZES = 0x471;
const CMB_SOURCES = 0x472;

const CBN_SELCHANGE = 1;
const CBN_SETFOCUS = 3;
const CBN_CLOSEUP = 8;

const DC_PAPERS = 2;
const DC_BINS = 6;
const DC_BINNAMES = 0xc;
const DC_PAPERNAMES = 0x10;
const DC_ORIENTATION = 0x11;
const GETSETPAPERBINS = 0x1d;
const ENUMPAPERBINS = 0x1f;

/* The `DEVMODE`'s fields COMMDLG reads and writes. */
const DM_SPEC_VERSION = 0x20;
const DM_DRIVER_VERSION = 0x22;
const DM_ORIENTATION = 0x2c;
const DM_PAPER_SIZE = 0x2e;
const DM_DEFAULT_SOURCE = 0x38;

/** Drivers COMMDLG does not ask for their paper sizes (`[232h]`, `02c1`). */
const NO_PAPERS = ['CITOH', 'IBMGRX', 'TI850', 'TOSHIBA', 'THINKJET', 'IBMCOLOR', 'CANON10E'];

/** Drivers COMMDLG treats apart before 3.10's `DEVMODE` (`[25Ah]`, `0307`). */
const OLD_HP = ['HPPCL', 'HPPCL5A', 'SD_LJET'];

/**
 * The Print Setup dialog's procedure, COMMDLG's export 22 (seg3 `307a`).
 *
 * @returns {Types.BOOL} What the dialog's procedure answers.
 */
export async function PrintSetupDlgProc(
  this: any,
  dialog: number,
  msg: number,
  wParam: number,
  lParam: number
) {
  lParam >>>= 0;

  const hooked = await hooks(this, SETUP_HOOK, dialog, msg, wParam, lParam);

  if (hooked !== null) {
    return hooked;
  }

  if (msg === WM_MEASUREITEM) {
    await measure(this, dialog, lParam);
    return 1;
  }

  if (msg === WM_INITDIALOG) {
    globals(this).hook = 0;

    const answer = await start(this, dialog, wParam, lParam);

    await wait(this, false);
    return answer;
  }

  if (msg === WM_COMMAND) {
    return await command(this, dialog, await number(this, dialog), wParam, lParam);
  }

  return 0;
}

/** `WM_MEASUREITEM` (seg3 `2f59`): the height of the dialog's font, or the System font's, measured once and kept. */
async function measure(system: any, dialog: number, lParam: number) {
  const state = globals(system);

  if (!state.itemHeight) {
    const hdc = (await call(system, 'USER', 'GetDC', [W(dialog)])) & 0xffff;
    let font = (await send(system, dialog, WM_GETFONT, 0, 0)) & 0xffff;

    if (!font) {
      font = (await call(system, 'GDI', 'GetStockObject', [W(0xd)])) & 0xffff;
    }

    const previous = await call(system, 'GDI', 'SelectObject', [W(hdc), W(font)]);
    const metrics = await api(system, 'GDI', 'GetTextMetrics', [W(hdc), buffer(0x1f)]);

    await call(system, 'GDI', 'SelectObject', [W(hdc), W(previous)]);
    await call(system, 'USER', 'ReleaseDC', [W(dialog), W(hdc)]);
    state.itemHeight = metrics.buffers[0][0] | (metrics.buffers[0][1] << 8);
  }

  setWord(system, lParam, 8, state.itemHeight);
}

/** Whether the driver is one COMMDLG asks for paper sizes (`02c1`). */
async function asksPapers(system: any, names: number) {
  for (const name of NO_PAPERS) {
    if (await same(system, text(bytesOf(name)), D(nameOf(system, names, DRIVER)))) {
      return false;
    }
  }

  return true;
}

/** Which of the old Hewlett-Packard drivers the driver is, from 1, or nought (`0307`). */
async function oldHp(system: any, names: number) {
  for (let index = 0; index < OLD_HP.length; index++) {
    if (await same(system, text(bytesOf(OLD_HP[index])), D(nameOf(system, names, DRIVER)))) {
      return index + 1;
    }
  }

  return 0;
}

function setDevmode(system: any, which: number, devmode: number) {
  const data = globals(system).dialogs.get(which);

  if (data) {
    data.devmode = devmode;
  }
}

async function enabled(system: any, dialog: number, id: number) {
  const control = await item(system, dialog, id);

  return !!((await call(system, 'USER', 'IsWindowEnabled', [W(control)])) & 0xffff);
}

/** The driver's `AdvancedSetupDialog` (`2474`). */
async function advancedSetup(system: any, driver: number) {
  return await call(system, 'KERNEL', 'GetProcAddress', [
    W(driver),
    text(bytesOf('AdvancedSetupDialog')),
  ]);
}

/** `WM_INITDIALOG` (seg3 `2559`). */
async function start(system: any, dialog: number, wParam: number, lppd: number) {
  const list = await item(system, dialog, CMB_PRINTERS);
  const which = await giveProperty(system, dialog, lppd);

  failed: {
    if (flags(system, lppd) & PD_ENABLESETUPHOOK) {
      if (!dword(system, lppd, SETUP_HOOK)) {
        setError(system, CDERR_NOHOOK);
        break failed;
      }
    } else {
      setDword(system, lppd, SETUP_HOOK, 0);
    }

    unlocked: {
      /* The `DEVNAMES` stays locked from here to the list's choice (`2610`, `26cc`, `29ad`). */
      let names = 0;

      if (!word(system, lppd, DEVMODE) && word(system, lppd, DEVNAMES)) {
        names = await lock(system, word(system, lppd, DEVNAMES));

        if (!names) {
          setError(system, CDERR_MEMLOCKFAILURE);
          break failed;
        }

        /* Opened from Print with a `DEVNAMES` but no `DEVMODE`: no driver, and no Options (`2602`). */
        if (!(flags(system, lppd) & PD_PRINTSETUP)) {
          await enable(system, dialog, PSH_OPTIONS, false);
        } else {
          await unlock(system, word(system, lppd, DEVNAMES));
          names = 0;
        }
      }

      if (!names) {
        const given = word(system, lppd, DEVNAMES);

        if (given && !(await checkNames(system, given))) {
          break failed;
        }

        const bits = await findNames(system, lppd);

        if (!bits) {
          if (error(system) === PDERR_NODEFAULTPRN && !(flags(system, lppd) & PD_NOWARNING)) {
            await messageBox(system, dialog, resource(0x45a), resource(0x448));
          }

          break failed;
        }

        names = await lock(system, word(system, lppd, DEVNAMES));

        if (!names) {
          setError(system, CDERR_MEMLOCKFAILURE);
          break failed;
        }

        setWord(system, names, DEFAULT, word(system, names, DEFAULT) | bits);

        const driver = await loadDriver(system, nameOf(system, names, DRIVER));

        if (driver <= 0x20) {
          setError(system, PDERR_LOADDRVFAILURE);
          break unlocked;
        }

        const devmodeGiven = word(system, lppd, DEVMODE);
        let devmode: number;

        if (!devmodeGiven) {
          devmode = await devMode(system, dialog, driver, 0, names, false);
          setDevmode(system, which, devmode);

          if (!devmode) {
            await enable(system, dialog, PSH_OPTIONS, false);
          }
        } else {
          devmode = await devMode(system, dialog, driver, devmodeGiven, names, true);
          setDevmode(system, which, devmode);
        }

        if (devmode === 0xffff || (devmodeGiven && !devmode)) {
          setError(system, PDERR_GETDEVMODEFAIL);
          await freeLibrary(system, driver);
          break unlocked;
        }

        if (devmode) {
          const mode = await lock(system, devmode);

          if (!mode) {
            setError(system, CDERR_MEMLOCKFAILURE);
            break unlocked;
          }

          const paper =
            Number(await sizes(system, names, mode, driver, dialog)) |
            Number(await sources(system, names, mode, driver, dialog));

          await enable(system, dialog, GRP_PAPER, !!paper);
          setWord(system, lppd, HDC, 0);

          if (
            (await orientation(system, names, mode, driver, dialog)) ||
            (await enabled(system, dialog, RAD_PORTRAIT))
          ) {
            await orient(system, dialog, word(system, mode, DM_ORIENTATION) !== 2);
          }

          const options =
            !!(await advancedSetup(system, driver)) ||
            !!(await driverEntry(system, driver, EXT_DEVICE_MODE));

          await enable(system, dialog, PSH_OPTIONS, options);
          await unlock(system, devmode);
        }

        await freeLibrary(system, driver);
      }

      /* (`28cb`) */
      if (!dialogData(system, which).devmode) {
        await paperAndOrientation(system, dialog, false);
      }

      if (!(await listPrinters(system, dialog, CMB_PRINTERS))) {
        break unlocked;
      }

      if (error(system) === PDERR_NODEFAULTPRN) {
        await enable(system, dialog, RAD_DEFAULT, false);
      }

      const found = await findPrinter(system, names, dialog);
      const isDefault = !!(word(system, names, DEFAULT) & 1);

      if (found === 0xffff && !isDefault) {
        await takeNames(system, dialog, lppd, false);
        setError(system, PDERR_PRINTERNOTFOUND);
        break unlocked;
      }

      await checkRadio(
        system,
        dialog,
        RAD_DEFAULT,
        RAD_SPECIFIC,
        isDefault ? RAD_DEFAULT : RAD_SPECIFIC
      );

      if (!isDefault) {
        const style = await call(system, 'USER', 'GetWindowLong', [W(list), W(GWL_STYLE)]);

        await call(system, 'USER', 'SetWindowLong', [W(list), W(GWL_STYLE), D(style | WS_TABSTOP)]);
      }

      await send(system, list, CB_SETCURSEL, found === 0xffff ? 0 : found, 0);
      await unlock(system, word(system, lppd, DEVNAMES));

      if ((await version(system)) >= 0x30a) {
        await send(system, list, CB_SETEXTENDEDUI, 1, 0);
        await sendItem(system, dialog, CMB_SIZES, CB_SETEXTENDEDUI, 1, 0);
        await sendItem(system, dialog, CMB_SOURCES, CB_SETEXTENDEDUI, 1, 0);
        globals(system).listProc = await call(system, 'USER', 'SetWindowLong', [
          W(list),
          W(GWL_WNDPROC),
          D(exportAddress(system, DW_UP_ARROW_HACK)),
        ]);
      }

      if (!(flags(system, lppd) & PD_SHOWHELP)) {
        await enable(system, dialog, PSH_HELP, false);
        await show(system, dialog, PSH_HELP, SW_HIDE);
      }

      if (flags(system, lppd) & PD_ENABLESETUPHOOK) {
        return await callHook(
          system,
          dword(system, lppd, SETUP_HOOK),
          dialog,
          WM_INITDIALOG,
          wParam,
          lppd
        );
      }

      return 1;
    }

    /* (`27a0`) */
    await unlock(system, word(system, lppd, DEVNAMES));
  }

  /* (`27ac`) */
  await takeProperty(system, dialog);
  await call(system, 'USER', 'EndDialog', [W(dialog), W(0)]);

  if (!error(system)) {
    setError(system, PDERR_INITFAILURE);
  }

  return 0;
}

/**
 * The paper sizes filled (seg3 `1d7c`), from the driver's `DC_PAPERS`,
 * named by COMMDLG's strings or the driver's `DC_PAPERNAMES`. Whether there
 * are any.
 */
async function sizes(system: any, names: number, mode: number, driver: number, dialog: number) {
  let good = false;

  await sendItem(system, dialog, CMB_SIZES, CB_RESETCONTENT, 0, 0);

  asked: {
    const spec = word(system, mode, DM_SPEC_VERSION);

    if (
      spec < 0x30a &&
      word(system, mode, DM_DRIVER_VERSION) < 0x3850 &&
      (await oldHp(system, names)) === 2
    ) {
      break asked;
    }

    if (spec < 0x300 || !(await asksPapers(system, names))) {
      break asked;
    }

    const procedure = await driverEntry(system, driver, DEVICE_CAPABILITIES);

    if (!procedure) {
      break asked;
    }

    const count = await capabilities(system, procedure, names, DC_PAPERS, 0, mode);

    if (!count || count === 0xffffffff) {
      break asked;
    }

    let named = 0;
    let namesBlock = 0;
    let namesFar = 0;

    if (spec >= 0x30a) {
      named = await capabilities(system, procedure, names, DC_PAPERNAMES, 0, mode);

      if (named === 0xffffffff || named === 0xffff) {
        named = 0;
      }
    }

    if (named) {
      namesBlock = await alloc(system, 0x42, (named << 6) & 0xffff);
      namesFar = await lock(system, namesBlock);
      await capabilities(system, procedure, names, DC_PAPERNAMES, namesFar, mode);
    }

    const papersBlock = await alloc(system, 0x42, (count << 1) & 0xffff);
    const papers = await lock(system, papersBlock);

    await capabilities(system, procedure, names, DC_PAPERS, papers, mode);

    let added = 0;

    for (let index = 0; index < ((count & 0xffff) << 16) >> 16; index++) {
      const paper = word(system, papers, index * 2);
      let label: Arg;

      if (paper <= 0x100) {
        const string = resource(0x480 + paper);

        if (!string.length) {
          continue;
        }

        label = text(string);
      } else if (named) {
        label = D(at(namesFar, (index << 6) & 0xffff));
      } else {
        continue;
      }

      await sendItemBytes(system, dialog, CMB_SIZES, CB_INSERTSTRING, 0xffff, label);

      if (word(system, mode, DM_PAPER_SIZE) === paper) {
        await sendItem(system, dialog, CMB_SIZES, CB_SETCURSEL, added, 0);
      }

      await sendItem(system, dialog, CMB_SIZES, CB_SETITEMDATA, added, paper);
      added++;
    }

    await unlock(system, papersBlock);
    await free(system, papersBlock);

    if (named) {
      await unlock(system, namesBlock);
      await free(system, namesBlock);
    }

    good = true;
  }

  await enable(system, dialog, CMB_SIZES, good);
  await enable(system, dialog, STC_SIZE, good);
  return good;
}

async function alloc(system: any, how: number, size: number) {
  return (await call(system, 'KERNEL', 'GlobalAlloc', [W(how), D(size)])) & 0xffff;
}

/**
 * The paper sources filled (seg3 `2026`), from the driver's `DC_BINS` and
 * `DC_BINNAMES`, or for an older driver its `GETSETPAPERBINS` and
 * `ENUMPAPERBINS` escapes. Whether there are any.
 */
async function sources(system: any, names: number, mode: number, driver: number, dialog: number) {
  let good = false;
  let count = 0;
  let block = 0;
  let bins = 0;

  await sendItem(system, dialog, CMB_SOURCES, CB_RESETCONTENT, 0, 0);

  asked: {
    const spec = word(system, mode, DM_SPEC_VERSION);

    if (spec < 0x30a) {
      const hp = await oldHp(system, names);

      if (hp && (hp !== 2 || word(system, mode, DM_DRIVER_VERSION) < 0x3850)) {
        break asked;
      }
    }

    if (spec >= 0x30a) {
      const procedure = await driverEntry(system, driver, DEVICE_CAPABILITIES);

      if (procedure) {
        const named = await capabilities(system, procedure, names, DC_BINNAMES, 0, mode);

        if (named && named !== 0xffffffff) {
          block = await alloc(system, 2, (named * 0x1a) & 0xffff);
          bins = await lock(system, block);
          await capabilities(system, procedure, names, DC_BINS, bins, mode);
          count =
            (await capabilities(
              system,
              procedure,
              names,
              DC_BINNAMES,
              at(bins, (named << 1) & 0xffff),
              mode
            )) & 0xffff;

          if (count) {
            good = true;
          } else {
            await unlock(system, block);
            await free(system, block);
          }
        }
      }
    }

    if (good) {
      break asked;
    }

    /* An older driver's escapes, on an information context of it (`2172`). */
    const ic =
      (await call(system, 'GDI', 'CreateIC', [
        D(nameOf(system, names, DRIVER)),
        D(nameOf(system, names, DEVICE)),
        D(nameOf(system, names, PORT)),
        D(mode),
      ])) & 0xffff;

    if (!ic) {
      break asked;
    }

    const supports = async (escape: number) =>
      (await call(system, 'GDI', 'Escape', [
        W(ic),
        W(QUERYESCSUPPORT),
        W(2),
        B([escape, 0]),
        D(0),
      ])) & 0xffff;

    if ((await supports(ENUMPAPERBINS)) && (await supports(GETSETPAPERBINS))) {
      const info = await api(system, 'GDI', 'Escape', [
        W(ic),
        W(GETSETPAPERBINS),
        W(0),
        D(0),
        buffer(8),
      ]);

      count = info.buffers[0][2] | (info.buffers[0][3] << 8);

      if (count) {
        good = true;
        block = await alloc(system, 0x42, (count * 0x1a) & 0xffff);
        bins = await lock(system, block);
        await call(system, 'GDI', 'Escape', [
          W(ic),
          W(ENUMPAPERBINS),
          W(2),
          B([count & 0xff, count >>> 8]),
          D(bins),
        ]);
      }
    }

    await call(system, 'GDI', 'DeleteDC', [W(ic)]);
  }

  await enable(system, dialog, CMB_SOURCES, good);
  await enable(system, dialog, STC_SOURCE, good);

  if (!good) {
    return false;
  }

  /* Each named bin an item, its data its number (`227b`): an empty name holds both places where they are. */
  let name = at(bins, (count << 1) & 0xffff);
  let numberAt = bins;

  for (let index = 0; index < count; index++) {
    if (!byteAt(system, name)) {
      continue;
    }

    await sendItemBytes(system, dialog, CMB_SOURCES, CB_INSERTSTRING, 0xffff, D(name));
    name = at(name, 0x18);

    const bin = word(system, numberAt, 0);

    await sendItem(system, dialog, CMB_SOURCES, CB_SETITEMDATA, index, ((bin << 16) >> 16) >>> 0);
    numberAt = at(numberAt, 2);

    if (word(system, mode, DM_DEFAULT_SOURCE) === bin) {
      await sendItem(system, dialog, CMB_SOURCES, CB_SETCURSEL, index, 0);
    }
  }

  if ((await sendItem(system, dialog, CMB_SOURCES, CB_GETCURSEL, 0, 0)) === 0xffffffff) {
    await sendItem(system, dialog, CMB_SOURCES, CB_SETCURSEL, 0, 0);
  }

  await unlock(system, block);
  await free(system, block);
  return true;
}

/**
 * Whether the driver can turn the page, and the orientation's controls
 * enabled or not to match (seg3 `236a`): nought where they already did.
 */
async function orientation(
  system: any,
  names: number,
  mode: number,
  driver: number,
  dialog: number
) {
  let can = true;

  if (word(system, mode, DM_SPEC_VERSION) >= 0x30a) {
    const procedure = await driverEntry(system, driver, DEVICE_CAPABILITIES);

    if (procedure) {
      can = !!(await capabilities(system, procedure, names, DC_ORIENTATION, 0, 0));
    }
  }

  if ((await enabled(system, dialog, RAD_PORTRAIT)) === can) {
    return false;
  }

  if (!can) {
    await check(system, dialog, RAD_PORTRAIT, 0);
    await check(system, dialog, RAD_LANDSCAPE, 0);
  }

  for (const id of [GRP_ORIENTATION, RAD_PORTRAIT, RAD_LANDSCAPE]) {
    await enable(system, dialog, id, can);
  }

  await show(system, dialog, ICO_ORIENTATION, can ? SW_SHOWNA : SW_HIDE);
  return can;
}

/** Portrait or Landscape checked, and its icon shown (seg3 `1bea`). */
async function orient(system: any, dialog: number, portrait: boolean) {
  await checkRadio(
    system,
    dialog,
    RAD_PORTRAIT,
    RAD_LANDSCAPE,
    portrait ? RAD_PORTRAIT : RAD_LANDSCAPE
  );

  const state = globals(system);
  const icon = portrait ? state.portrait : state.landscape;

  if ((await version(system)) >= 0x30a) {
    await sendItem(system, dialog, ICO_ORIENTATION, STM_SETICON, icon, 0);
  } else {
    await call(system, 'USER', 'SetDlgItemText', [W(dialog), W(ICO_ORIENTATION), D(icon)]);
  }
}

/** The orientation and paper enabled, or disabled and emptied (seg3 `1c5e`). */
async function paperAndOrientation(system: any, dialog: number, on: boolean) {
  if (!on) {
    await check(system, dialog, RAD_PORTRAIT, 0);
    await check(system, dialog, RAD_LANDSCAPE, 0);
    await sendItem(system, dialog, CMB_SIZES, CB_RESETCONTENT, 0, 0);
    await sendItem(system, dialog, CMB_SOURCES, CB_RESETCONTENT, 0, 0);
  }

  for (const id of [GRP_ORIENTATION, RAD_PORTRAIT, RAD_LANDSCAPE]) {
    await enable(system, dialog, id, on);
  }

  await show(system, dialog, ICO_ORIENTATION, on ? SW_SHOWNA : SW_HIDE);

  for (const id of [GRP_PAPER, STC_SIZE, CMB_SIZES, STC_SOURCE, CMB_SOURCES]) {
    await enable(system, dialog, id, on);
  }
}

/**
 * Every printer listed (seg3 `07ad`): an item for each key of `[devices]`
 * on each of its ports, its data a `DEVNAMES` of its own; the default
 * written in the "currently" line. Nought, the error set, for no printer
 * and no default.
 */
async function listPrinters(system: any, dialog: number, id: number) {
  const [length, keys] = await profile(system, bytesOf('devices'), D(0), 0x200);
  let offset = 0;

  while (offset < length) {
    const key = tillNought(keys.slice(offset));
    const [size, read] = await profile(system, bytesOf('devices'), text(key), 0x200);

    offset += key.length + 1;

    if (!size) {
      continue;
    }

    const value = read.slice(0, size);
    /* The driver to a dot or a comma; past a dot, to the comma (`07e0`). */
    let stop = value.findIndex((byte) => byte === 0x2e || byte === 0x2c);

    if (stop < 0) {
      stop = value.length;
    }

    const driver = value.slice(0, stop);
    let start = stop + 1;

    /* Past a dot, the ports start at the comma itself, not after it: the first is empty (`0843`, `084c`). */
    if (value[stop] === 0x2e) {
      const comma = value.indexOf(0x2c, start);

      start = comma < 0 ? value.length : comma;
    }

    /* Each port to the next comma (`085c`). */
    while (start < size) {
      const begin = Math.min(start, value.length);
      const comma = value.indexOf(0x2c, begin);
      const end = comma < 0 ? value.length : comma;
      const port = value.slice(begin, end);

      await addPrinter(system, dialog, id, key, driver, port);
      start = begin + port.length + 1;
    }
  }

  const [deviceLength, read] = await profile(
    system,
    bytesOf('windows'),
    text(bytesOf('device')),
    0x200
  );

  if (!deviceLength) {
    setError(system, PDERR_NODEFAULTPRN);
  } else {
    const line = tillNought(read);
    let comma = line.indexOf(0x2c);

    if (comma < 0) {
      comma = line.length;
    }

    const device = line.slice(0, comma);
    const rest = line.slice(comma + 1);
    let second = rest.indexOf(0x2c);

    if (second < 0) {
      second = rest.length;
    }

    const port = rest.slice(second + 1);
    const current = await onPort(system, device, port);

    await setItemText(system, dialog, STC_CURRENT, [...bytesOf('(currently '), ...current, 0x29]);
    setError(system, 0);
  }

  const any = length | deviceLength;

  if (!any) {
    setError(system, PDERR_NODEVICES);
  }

  return any;
}

/** One printer on one port added to the list (seg3 `06be`), its data a `DEVNAMES` of its own marked made by COMMDLG: its index. */
async function addPrinter(
  system: any,
  dialog: number,
  id: number,
  device: number[],
  driver: number[],
  port: number[]
) {
  const [deviceLength, driverLength, portLength] = [
    device.length + 1,
    driver.length + 1,
    port.length + 1,
  ];
  const handle = await alloc(system, 2, portLength + driverLength + deviceLength + 0x28);

  if (!handle) {
    return 0xffff;
  }

  const names = await lock(system, handle);

  setWord(system, names, DEFAULT, 0x4000);
  setWord(system, names, DEVICE, 8);
  setWord(system, names, DRIVER, deviceLength + 8);
  setWord(system, names, PORT, driverLength + deviceLength + 8);
  putString(system, at(names, 8), device);
  putString(system, nameOf(system, names, DRIVER), driver);
  putString(system, nameOf(system, names, PORT), port);
  await unlock(system, handle);

  const line = await onPort(system, device, port);
  const index =
    (await sendItemBytes(system, dialog, id, CB_ADDSTRING, 0, text(line))).value & 0xffff;

  await sendItem(system, dialog, id, CB_SETITEMDATA, index, handle);
  return index;
}

/** The printer of a `DEVNAMES` found in the list (seg3 `248a`): its index, or FFFFh. */
async function findPrinter(system: any, names: number, dialog: number) {
  const count = (await sendItem(system, dialog, CMB_PRINTERS, CB_GETCOUNT, 0, 0)) & 0xffff;
  let found = 0xffff;

  for (let index = 0; index < count; index++) {
    const handle =
      (await sendItem(system, dialog, CMB_PRINTERS, CB_GETITEMDATA, index, 0)) & 0xffff;
    const other = await lock(system, handle);

    if (!other) {
      continue;
    }

    let alike = true;

    for (const which of [DEVICE, DRIVER, PORT]) {
      if (!(await same(system, D(nameOf(system, other, which)), D(nameOf(system, names, which))))) {
        alike = false;
        break;
      }
    }

    if (alike) {
      found = index;
      index = count;
    }

    await unlock(system, handle);
  }

  return found;
}

/**
 * The printers' `DEVNAMES` let go (seg3 `2a7a`), but, with `keep`, the one
 * chosen, which replaces the structure's -- for Default Printer, the
 * default's made afresh.
 */
async function takeNames(system: any, dialog: number, lppd: number, keep: boolean) {
  if (keep) {
    await free(system, word(system, lppd, DEVNAMES));
    setWord(system, lppd, DEVNAMES, 0);
  }

  let chosen: number;

  if (await checked(system, dialog, RAD_DEFAULT)) {
    if (keep) {
      setWord(system, lppd, DEVNAMES, await defaultNames(system));
    }

    chosen = 0xffff;
  } else {
    chosen = (await sendItem(system, dialog, CMB_PRINTERS, CB_GETCURSEL, 0, 0)) & 0xffff;
  }

  let count = (await sendItem(system, dialog, CMB_PRINTERS, CB_GETCOUNT, 0, 0)) & 0xffff;

  while ((count << 16) >> 16 > 0) {
    count--;

    const handle =
      (await sendItem(system, dialog, CMB_PRINTERS, CB_GETITEMDATA, count, 0)) & 0xffff;

    if (keep && chosen === count) {
      setWord(system, lppd, DEVNAMES, handle);
    } else {
      await free(system, handle);
    }
  }
}

/** The orientation, size and source written into a `DEVMODE` (seg3 `2b43`). */
async function writePaper(system: any, mode: number, dialog: number) {
  setWord(system, mode, DM_ORIENTATION, (await checked(system, dialog, RAD_LANDSCAPE)) ? 2 : 1);

  for (const [id, field] of [
    [CMB_SIZES, DM_PAPER_SIZE],
    [CMB_SOURCES, DM_DEFAULT_SOURCE],
  ]) {
    const chosen = (await sendItem(system, dialog, id, CB_GETCURSEL, 0, 0)) & 0xffff;

    if (chosen !== 0xffff) {
      setWord(
        system,
        mode,
        field,
        (await sendItem(system, dialog, id, CB_GETITEMDATA, chosen, 0)) & 0xffff
      );
    }
  }
}

/** What OK leaves (seg3 `2bdb`): the `DEVMODE` written, and for `PD_PRINTSETUP` the context asked for. */
async function finishSetup(system: any, lppd: number, dialog: number) {
  const devmode = word(system, lppd, DEVMODE);

  if (!devmode) {
    return;
  }

  const mode = await lock(system, devmode);

  if (!mode) {
    return;
  }

  await writePaper(system, mode, dialog);

  const asked = flags(system, lppd);

  if (asked & PD_PRINTSETUP && asked & (PD_RETURNDC | PD_RETURNIC)) {
    const handle = word(system, lppd, DEVNAMES);
    const names = await lock(system, handle);

    if (names) {
      await makeDc(system, mode, names, lppd);
      await unlock(system, handle);
    }
  }

  await unlock(system, devmode);
}

/**
 * The printer taken again (seg3 `2c62`), for a new choice or Options...:
 * its driver loaded, the working `DEVMODE` asked for again, or the driver's
 * own dialog run on it, and the paper and orientation filled. Whether it
 * was.
 */
async function take(system: any, dialog: number, which: number, id: number) {
  const isDefault = !!(await checked(system, dialog, RAD_DEFAULT));
  let result = false;
  let answer = 0;
  let handle: number;

  globals(system).missing = false;

  if (isDefault) {
    handle = await defaultNames(system);
  } else {
    const chosen = (await sendItem(system, dialog, CMB_PRINTERS, CB_GETCURSEL, 0, 0)) & 0xffff;

    if (chosen & 0x8000) {
      return false;
    }

    answer = chosen;
    handle = (await sendItem(system, dialog, CMB_PRINTERS, CB_GETITEMDATA, chosen, 0)) & 0xffff;
  }

  if (!handle) {
    return false;
  }

  const names = await lock(system, handle);

  if (!names) {
    const devmode = dialogData(system, which).devmode;

    if (devmode) {
      await free(system, devmode);
      setDevmode(system, which, 0);
    }
  } else {
    result = true;

    const driver = await loadDriver(system, nameOf(system, names, DRIVER));

    if (driver < 0x20) {
      globals(system).missing = true;
      await paperAndOrientation(system, dialog, false);
      await enable(system, dialog, PSH_OPTIONS, false);
    } else {
      const lppd = dialogData(system, which).lppd;
      let devmode = dialogData(system, which).devmode;

      if (id !== PSH_OPTIONS && devmode) {
        await free(system, devmode);
        setDevmode(system, which, 0);
        devmode = 0;
      }

      if (!devmode) {
        devmode = await devMode(system, word(system, lppd, OWNER), driver, 0, names, false);
        setDevmode(system, which, devmode);
      }

      if (devmode === 0xffff) {
        devmode = 0;
        setDevmode(system, which, 0);
      }

      let advanced = 0;
      let extended = 0;

      if (!devmode) {
        await paperAndOrientation(system, dialog, false);
      } else {
        const mode = await lock(system, devmode);

        if (mode) {
          advanced = await advancedSetup(system, driver);

          if (!advanced) {
            extended = await driverEntry(system, driver, EXT_DEVICE_MODE);
          }

          if (id === PSH_OPTIONS) {
            await writePaper(system, mode, dialog);

            if (advanced) {
              answer =
                (await driverCall(system, advanced, [
                  { w: dialog },
                  { w: driver },
                  { d: mode },
                  { d: mode },
                ])) & 0xffff;
            } else if (extended) {
              answer =
                (await driverCall(system, extended, [
                  { w: dialog },
                  { w: driver },
                  { d: mode },
                  { d: nameOf(system, names, DEVICE) },
                  { d: nameOf(system, names, PORT) },
                  { d: mode },
                  { d: 0 },
                  { w: 0xe },
                ])) & 0xffff;
            }
          }

          if (id !== PSH_OPTIONS || answer === 1) {
            const paper =
              Number(await sizes(system, names, mode, driver, dialog)) |
              Number(await sources(system, names, mode, driver, dialog));

            await enable(system, dialog, GRP_PAPER, !!paper);

            if (
              (await orientation(system, names, mode, driver, dialog)) ||
              (await enabled(system, dialog, RAD_PORTRAIT))
            ) {
              await orient(system, dialog, word(system, mode, DM_ORIENTATION) !== 2);
            }
          } else {
            result = false;
          }

          await unlock(system, devmode);
        }
      }

      await enable(system, dialog, PSH_OPTIONS, !!advanced || !!extended);
      await freeLibrary(system, driver);
    }

    await unlock(system, handle);
  }

  if (isDefault) {
    await free(system, handle);
  }

  return result;
}

/** `WM_COMMAND` (seg3 `3139`). */
async function command(system: any, dialog: number, which: number, id: number, lParam: number) {
  const lppd = dialogData(system, which).lppd;

  switch (id) {
    case IDOK: {
      /* A choice made in the list as it is still dropped taken first (`3190`). */
      if (
        (await version(system)) >= 0x30a &&
        (await sendItem(system, dialog, CMB_PRINTERS, CB_GETDROPPEDSTATE, 0, 0))
      ) {
        await take(system, dialog, which, CMB_PRINTERS);
      }

      if (globals(system).missing) {
        const chosen = (await sendItem(system, dialog, CMB_PRINTERS, CB_GETCURSEL, 0, 0)) & 0xffff;
        const handle =
          (await sendItem(system, dialog, CMB_PRINTERS, CB_GETITEMDATA, chosen, 0)) & 0xffff;

        await notFound(system, dialog, await lock(system, handle));
        await unlock(system, handle);
        return 1;
      }

      return await end(system, dialog, which, lppd, id, lParam);
    }
    case 2:
    case 3:
      return await end(system, dialog, which, lppd, id, lParam);
    case 4:
      return await again(system, dialog, which, lppd);
    case PSH_OPTIONS:
      if (await take(system, dialog, which, PSH_OPTIONS)) {
        await send(system, dialog, WM_NEXTDLGCTL, await item(system, dialog, IDOK), 1);
      }

      return 1;
    case PSH_HELP: {
      const help = message(system, 'commdlg_help');
      const owner = word(system, lppd, OWNER);

      if (help && owner) {
        await send(system, owner, help, dialog, lppd);
      }

      return 1;
    }
    case RAD_PORTRAIT:
    case RAD_LANDSCAPE:
      await orient(system, dialog, id !== RAD_LANDSCAPE);
      return 1;
    case RAD_DEFAULT:
    case RAD_SPECIFIC: {
      const was = await checked(system, dialog, id);
      const list = await item(system, dialog, CMB_PRINTERS);
      let style = await call(system, 'USER', 'GetWindowLong', [W(list), W(GWL_STYLE)]);

      if (id === RAD_DEFAULT) {
        style = (style & ~WS_TABSTOP) >>> 0;
      } else {
        style = (style | WS_TABSTOP) >>> 0;
        await send(system, dialog, WM_NEXTDLGCTL, list, 1);
      }

      await call(system, 'USER', 'SetWindowLong', [W(list), W(GWL_STYLE), D(style)]);

      if (!was) {
        await checkRadio(system, dialog, RAD_DEFAULT, RAD_SPECIFIC, id);
        await take(system, dialog, which, id);
      }

      return 1;
    }
    case CMB_PRINTERS: {
      const notification = lParam >>> 16;
      let choose = false;

      if (notification === CBN_CLOSEUP) {
        choose = true;
      } else if (notification === CBN_SELCHANGE) {
        choose = !(
          (await version(system)) >= 0x30a &&
          (await sendItem(system, dialog, CMB_PRINTERS, CB_GETDROPPEDSTATE, 0, 0))
        );
      } else if (notification === CBN_SETFOCUS) {
        await checkRadio(system, dialog, RAD_DEFAULT, RAD_SPECIFIC, RAD_SPECIFIC);
      }

      if (choose && (await number(system, dialog))) {
        await wait(system, true);
        await checkRadio(system, dialog, RAD_DEFAULT, RAD_SPECIFIC, RAD_SPECIFIC);
        await take(system, dialog, which, id);
        await wait(system, false);
      }

      return 1;
    }
  }

  return 0;
}

/** The box for a printer whose driver will not load (`3263`): string 45Bh of its device and driver. */
async function notFound(system: any, dialog: number, names: number) {
  const parts = [
    string(system, nameOf(system, names, DEVICE)),
    string(system, nameOf(system, names, DRIVER)),
  ];
  const format = resource(0x45b);
  const message: number[] = [];

  for (let index = 0; index < format.length; index++) {
    if (format[index] === 0x25 && format[index + 1] === 0x73) {
      message.push(...(parts.shift() ?? []));
      index++;
    } else {
      message.push(format[index]);
    }
  }

  await messageBox(system, dialog, message, resource(0x448));
}

/**
 * OK, Cancel and `WM_COMMAND` 3 (seg3 `31fd`): with OK the printer chosen
 * replaces the structure's, with the working `DEVMODE`; else the working
 * one let go. The dialog ended.
 */
async function end(
  system: any,
  dialog: number,
  which: number,
  lppd: number,
  id: number,
  lParam: number
) {
  await wait(system, true);

  let answer = id === IDOK ? 1 : 0;

  await takeNames(system, dialog, lppd, !!answer);

  const handle = word(system, lppd, DEVNAMES);
  const names = await lock(system, handle);

  ended: {
    if (!names) {
      setError(system, CDERR_MEMLOCKFAILURE);
      answer = 0;
      break ended;
    }

    let letGo = false;

    if (answer) {
      const driver = await loadDriver(system, nameOf(system, names, DRIVER));

      if (driver > 0x20) {
        await freeLibrary(system, driver);
        setWord(system, names, DEFAULT, word(system, names, DEFAULT) & ~0x4000);
        setWord(system, lppd, HDC, 0);

        const devmode = word(system, lppd, DEVMODE);

        if (devmode) {
          await free(system, devmode);
        }

        setWord(system, lppd, DEVMODE, dialogData(system, which).devmode);
        await finishSetup(system, lppd, dialog);
      } else {
        await wait(system, false);
        await notFound(system, dialog, names);

        if (globals(system).missing) {
          return 1;
        }

        answer = 0;
      }
    }

    if (!answer) {
      const devmode = dialogData(system, which).devmode;

      if (devmode) {
        await free(system, devmode);
      }

      letGo = !!(word(system, names, DEFAULT) & 0x4000) && !!(flags(system, lppd) & PD_PRINTSETUP);
    }

    await unlock(system, handle);

    if (letGo) {
      await free(system, handle);
      setWord(system, lppd, DEVNAMES, 0);
    }
  }

  /* (`337e`) */
  await takeProperty(system, dialog);

  if (flags(system, lppd) & PD_ENABLESETUPHOOK) {
    globals(system).hook = dword(system, lppd, SETUP_HOOK);
  }

  await call(system, 'USER', 'EndDialog', [W(dialog), W(id === 3 ? lParam & 0xffff : answer)]);
  return 1;
}

/** `WM_COMMAND` 4 (seg3 `33c8`): the structure's printer and `DEVMODE` taken again, as the dialog started. */
async function again(system: any, dialog: number, which: number, lppd: number) {
  if (!(await findNames(system, lppd))) {
    return 0;
  }

  const handle = word(system, lppd, DEVNAMES);

  if (!handle) {
    return 0;
  }

  const names = await lock(system, handle);

  if (!names) {
    return 0;
  }

  const isDefault = !!(word(system, names, DEFAULT) & 1);

  await checkRadio(
    system,
    dialog,
    RAD_DEFAULT,
    RAD_SPECIFIC,
    isDefault ? RAD_DEFAULT : RAD_SPECIFIC
  );

  const found = await findPrinter(system, names, dialog);
  const driver = await loadDriver(system, nameOf(system, names, DRIVER));

  if (driver <= 0x20) {
    await unlock(system, handle);
    await unlock(system, word(system, lppd, DEVMODE));
    return 0;
  }

  await sendItem(system, dialog, CMB_PRINTERS, CB_SETCURSEL, found, 0);

  const devmode = word(system, lppd, DEVMODE);
  const mode = devmode ? await lock(system, devmode) : 0;

  if (!mode) {
    await paperAndOrientation(system, dialog, false);
    return 1;
  }

  await paperAndOrientation(system, dialog, true);

  const paper =
    Number(await sizes(system, names, mode, driver, dialog)) |
    Number(await sources(system, names, mode, driver, dialog));

  await enable(system, dialog, GRP_PAPER, !!paper);

  if (await orientation(system, names, mode, driver, dialog)) {
    await orient(system, dialog, word(system, mode, DM_ORIENTATION) !== 2);
  }

  await unlock(system, devmode);

  const working = dialogData(system, which).devmode;

  if (working) {
    await free(system, working);
  }

  setDevmode(system, which, await devMode(system, dialog, driver, devmode, names, true));
  await freeLibrary(system, driver);
  await unlock(system, handle);
  return 1;
}
