'use strict';

import { B, buffer, D, setItemText, W } from './api.js';
import {
  CB_GETCURSEL,
  CB_GETITEMDATA,
  CB_SETEXTENDEDUI,
  CDERR_MEMLOCKFAILURE,
  CDERR_NOHOOK,
  COPIES,
  DEFAULT,
  DEVICE,
  DEVMODE,
  DEVNAMES,
  DRIVER,
  EDIT_INTEGER_ONLY,
  EM_LIMITTEXT,
  EM_SETSEL,
  FLAGS,
  FROM_PAGE,
  GWL_WNDPROC,
  HDC,
  MAX_PAGE,
  MIN_PAGE,
  OWNER,
  PDERR_CREATEICFAILURE,
  PDERR_DEFAULTDIFFERENT,
  PDERR_DNDMMISMATCH,
  PDERR_GETDEVMODEFAIL,
  PDERR_INITFAILURE,
  PDERR_LOADDRVFAILURE,
  PDERR_NODEFAULTPRN,
  PD_COLLATE,
  PD_DISABLEPRINTTOFILE,
  PD_ENABLEPRINTHOOK,
  PD_ENABLESETUPHOOK,
  PD_HIDEPRINTTOFILE,
  PD_NOPAGENUMS,
  PD_NOSELECTION,
  PD_NOWARNING,
  PD_PAGENUMS,
  PD_PRINTTOFILE,
  PD_SELECTION,
  PD_SHOWHELP,
  PD_USEDEVMODECOPIES,
  PORT,
  PRINT_HOOK,
  PRINT_SETUP_DLG_PROC,
  QUERYESCSUPPORT,
  SETCOPYCOUNT,
  SETUP_HOOK,
  SW_HIDE,
  TO_PAGE,
  WM_COMMAND,
  WM_INITDIALOG,
  WM_NEXTDLGCTL,
  api,
  call,
  callHook,
  check,
  checkRadio,
  checked,
  devMode,
  dialogData,
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
  instance,
  item,
  letGo,
  loadDriver,
  lock,
  makeDc,
  message,
  messageBox,
  nameOf,
  number,
  printerLine,
  qualities,
  resource,
  send,
  sendItem,
  setDword,
  setError,
  setItemInt,
  setWord,
  show,
  stringOf,
  takeProperty,
  template,
  unlock,
  version,
  wait,
  word,
} from './print-dlg.js';

/**
 * The Print dialog's procedure, `PrintDlgProc` (21): COMMDLG's dialog 1538
 * set up from the structure, the printer shown, the checks of OK, Setup...
 * and Help (`COMMDLG.DLL` seg3 `371f`). The twin of
 * `crates/winbox-win16/src/commdlg/print_proc.rs`.
 */

const IDOK = 1;
const IDCANCEL = 2;
const PSH_SETUP = 0x400;
const PSH_HELP = 0x40e;
const CHX_PRINT_TO_FILE = 0x410;
const CHX_COLLATE = 0x411;
const RAD_ALL = 0x420;
const RAD_SELECTION = 0x421;
const RAD_PAGES = 0x422;
const STC_FROM = 0x441;
const STC_TO = 0x442;
const STC_QUALITY = 0x443;
const STC_PRINTER = 0x440;
const CMB_QUALITY = 0x470;
const EDT_FROM = 0x480;
const EDT_TO = 0x481;
const EDT_COPIES = 0x482;
const EN_CHANGE = 0x0300;

/**
 * The Print dialog's procedure, COMMDLG's export 21 (seg3 `371f`).
 *
 * @returns {Types.BOOL} What the dialog's procedure answers.
 */
export async function PrintDlgProc(
  this: any,
  dialog: number,
  msg: number,
  wParam: number,
  lParam: number
) {
  lParam >>>= 0;

  const hooked = await hooks(this, PRINT_HOOK, dialog, msg, wParam, lParam);

  if (hooked !== null) {
    return hooked;
  }

  if (msg === WM_INITDIALOG) {
    globals(this).hook = 0;

    const answer = await start(this, dialog, wParam, lParam);

    await wait(this, false);
    return answer;
  }

  if (msg === WM_COMMAND) {
    const lppd = dialogData(this, await number(this, dialog)).lppd;

    return await command(this, dialog, lppd, wParam, lParam);
  }

  return 0;
}

/** `WM_INITDIALOG` (seg3 `1750`): the dialog set up from the structure, or ended with nought. */
async function start(system: any, dialog: number, wParam: number, lppd: number) {
  await giveProperty(system, dialog, lppd);

  failed: {
    const asked = flags(system, lppd);

    for (const [flag, at] of [
      [PD_ENABLEPRINTHOOK, PRINT_HOOK],
      [PD_ENABLESETUPHOOK, SETUP_HOOK],
    ]) {
      if (asked & flag) {
        if (!dword(system, lppd, at)) {
          setError(system, CDERR_NOHOOK);
          break failed;
        }
      } else {
        setDword(system, lppd, at, 0);
      }
    }

    if ((await version(system)) >= 0x30a) {
      await sendItem(system, dialog, CMB_QUALITY, CB_SETEXTENDEDUI, 1, 0);
    }

    const bits = await findNames(system, lppd);

    if (!bits) {
      if (error(system) === PDERR_NODEFAULTPRN && !(asked & PD_NOWARNING)) {
        await messageBox(system, dialog, resource(0x45a), resource(0x448));
      }

      break failed;
    }

    const handle = word(system, lppd, DEVNAMES);
    const names = await lock(system, handle);

    if (!names) {
      setError(system, CDERR_MEMLOCKFAILURE);
      break failed;
    }

    setWord(system, names, DEFAULT, word(system, names, DEFAULT) | bits);

    unlocked: {
      const driver = await loadDriver(system, nameOf(system, names, DRIVER));

      if (driver <= 0x20) {
        setError(system, PDERR_LOADDRVFAILURE);
        break unlocked;
      }

      if (!word(system, lppd, DEVMODE)) {
        setWord(system, lppd, DEVMODE, await devMode(system, dialog, driver, 0, names, false));
      }

      await freeLibrary(system, driver);

      if (word(system, lppd, DEVMODE) === 0xffff) {
        setError(system, PDERR_GETDEVMODEFAIL);
        setWord(system, lppd, DEVMODE, 0);
        break unlocked;
      }

      await sendItem(system, dialog, EDT_COPIES, EM_LIMITTEXT, 5, 0);

      if (!word(system, lppd, COPIES)) {
        setWord(system, lppd, COPIES, 1);
      }

      await setItemInt(system, dialog, EDT_COPIES, word(system, lppd, COPIES));

      if (!(await showPrinter(system, lppd, dialog))) {
        break unlocked;
      }

      let now = flags(system, lppd);

      if (!(now & PD_SHOWHELP)) {
        await enable(system, dialog, PSH_HELP, false);
        await show(system, dialog, PSH_HELP, SW_HIDE);
      }

      if (now & PD_HIDEPRINTTOFILE) {
        const control = await item(system, dialog, CHX_PRINT_TO_FILE);

        await call(system, 'USER', 'EnableWindow', [W(control), W(0)]);
        await call(system, 'USER', 'ShowWindow', [W(control), W(SW_HIDE)]);
      } else if (now & PD_DISABLEPRINTTOFILE) {
        await enable(system, dialog, CHX_PRINT_TO_FILE, false);
      }

      if (now & PD_PRINTTOFILE) {
        await check(system, dialog, CHX_PRINT_TO_FILE, 1);
      }

      if (now & PD_NOPAGENUMS) {
        for (const id of [RAD_PAGES, STC_FROM, STC_TO, EDT_FROM, EDT_TO]) {
          await enable(system, dialog, id, false);
        }

        setDword(system, lppd, FLAGS, now & ~PD_PAGENUMS);
      } else {
        for (const [at, id] of [
          [FROM_PAGE, EDT_FROM],
          [TO_PAGE, EDT_TO],
        ]) {
          const page = word(system, lppd, at);

          if (page !== 0xffff) {
            await setItemInt(system, dialog, id, page);
          }
        }
      }

      now = flags(system, lppd);

      if (now & PD_NOSELECTION) {
        await enable(system, dialog, RAD_SELECTION, false);
        setDword(system, lppd, FLAGS, now & ~PD_SELECTION);
      }

      now = flags(system, lppd);

      const range = now & PD_PAGENUMS ? RAD_PAGES : now & PD_SELECTION ? RAD_SELECTION : RAD_ALL;

      await checkRadio(system, dialog, RAD_ALL, RAD_PAGES, range);

      /* The three edits subclassed; only the first's own procedure is kept (`1b59`). */
      const subclass = exportAddress(system, EDIT_INTEGER_ONLY);

      for (const id of [EDT_FROM, EDT_TO, EDT_COPIES]) {
        const control = await item(system, dialog, id);
        const previous = await call(system, 'USER', 'SetWindowLong', [
          W(control),
          W(GWL_WNDPROC),
          D(subclass),
        ]);

        if (id === EDT_FROM) {
          globals(system).editProc = previous;
        }
      }

      if (flags(system, lppd) & PD_ENABLEPRINTHOOK) {
        return await callHook(
          system,
          dword(system, lppd, PRINT_HOOK),
          dialog,
          WM_INITDIALOG,
          wParam,
          lppd
        );
      }

      await unlock(system, handle);
      return 1;
    }

    /* (`1955`) */
    await unlock(system, word(system, lppd, DEVNAMES));

    const devmode = word(system, lppd, DEVMODE);

    if (devmode) {
      await unlock(system, devmode);
    }
  }

  /* (`1974`) */
  await takeProperty(system, dialog);
  await call(system, 'USER', 'EndDialog', [W(dialog), W(0)]);

  if (!error(system)) {
    setError(system, PDERR_INITFAILURE);
  }

  return 0;
}

/**
 * The printer shown (seg3 `1503`): its qualities and copies from its
 * `DEVMODE`, Collate by whether its driver can count copies, and its line.
 * Whether it was.
 */
export async function showPrinter(system: any, lppd: number, dialog: number) {
  const handle = word(system, lppd, DEVNAMES);
  const names = await lock(system, handle);

  if (!names) {
    setError(system, CDERR_MEMLOCKFAILURE);
    return false;
  }

  const devmode = word(system, lppd, DEVMODE);
  let mode = 0;

  if (devmode) {
    mode = await lock(system, devmode);

    if (!mode) {
      setError(system, CDERR_MEMLOCKFAILURE);
      return false;
    }

    await enable(system, dialog, STC_QUALITY, true);
    await enable(system, dialog, CMB_QUALITY, true);
    await qualities(
      system,
      dialog,
      word(system, mode, 0x3a),
      word(system, mode, 0x20) > 0x300 ? lppd : 0
    );

    const copies = word(system, mode, 0x36);

    if ((copies << 16) >> 16 > 1) {
      await setItemInt(system, dialog, EDT_COPIES, copies);
    }

    await unlock(system, devmode);
  } else {
    await enable(system, dialog, STC_QUALITY, false);
    await enable(system, dialog, CMB_QUALITY, false);
  }

  /* An information context of the printer, asked whether its driver counts copies itself (`1631`). */
  const ic =
    (await call(system, 'GDI', 'CreateIC', [
      D(nameOf(system, names, DRIVER)),
      D(nameOf(system, names, DEVICE)),
      D(nameOf(system, names, PORT)),
      D(mode),
    ])) & 0xffff;

  setWord(system, lppd, HDC, ic);

  if (!ic) {
    setError(system, PDERR_CREATEICFAILURE);
    return false;
  }

  const counts =
    (await call(system, 'GDI', 'Escape', [
      W(ic),
      W(QUERYESCSUPPORT),
      W(2),
      B([SETCOPYCOUNT, 0]),
      D(0),
    ])) & 0xffff;

  if (counts) {
    await enable(system, dialog, CHX_COLLATE, true);

    if (flags(system, lppd) & PD_COLLATE) {
      await check(system, dialog, CHX_COLLATE, 1);
    }
  } else {
    await enable(system, dialog, CHX_COLLATE, false);
    await check(system, dialog, CHX_COLLATE, 1);

    if (flags(system, lppd) & PD_USEDEVMODECOPIES) {
      await setItemInt(system, dialog, EDT_COPIES, 1);
      await enable(system, dialog, EDT_COPIES, false);
    }
  }

  await call(system, 'GDI', 'DeleteDC', [W(word(system, lppd, HDC))]);
  setWord(system, lppd, HDC, 0);
  await setItemText(system, dialog, STC_PRINTER, await printerLine(system, names));
  await unlock(system, handle);
  return true;
}

/** `WM_COMMAND` (seg3 `37d7`). */
async function command(system: any, dialog: number, lppd: number, id: number, lParam: number) {
  switch (id) {
    case IDOK:
      return await ok(system, dialog, lppd, lParam);
    case IDCANCEL: {
      /* A `DEVNAMES` COMMDLG made let go (`3b0e`). */
      const handle = word(system, lppd, DEVNAMES);
      const names = await lock(system, handle);
      const made = !!(word(system, names, DEFAULT) & 0x4000);

      await unlock(system, handle);

      if (made) {
        await free(system, handle);
        setWord(system, lppd, DEVNAMES, 0);
      }

      await finish(system, dialog, lppd, id, lParam, 0);
      break;
    }
    case 3:
      await finish(system, dialog, lppd, id, lParam, 0);
      break;
    case PSH_SETUP:
      await setup(system, dialog, lppd);
      break;
    case PSH_HELP: {
      const help = message(system, 'commdlg_help');
      const owner = word(system, lppd, OWNER);

      if (help && owner) {
        await send(system, owner, help, dialog, lppd);
      }

      break;
    }
    case RAD_ALL:
    case RAD_SELECTION:
    case RAD_PAGES:
      await checkRadio(system, dialog, RAD_ALL, RAD_PAGES, id);

      if (id === RAD_PAGES) {
        await send(system, dialog, WM_NEXTDLGCTL, await item(system, dialog, EDT_FROM), 1);
      }

      break;
    case EDT_FROM:
    case EDT_TO:
      if (lParam >>> 16 === EN_CHANGE) {
        await checkRadio(system, dialog, RAD_ALL, RAD_PAGES, RAD_PAGES);
      }

      break;
  }

  return 0;
}

/**
 * The dialog ended (seg3 `3b6b`): its property taken, the print hook kept
 * for the messages it is still sent, with `WM_COMMAND` 3 `lParam`'s low
 * word as the answer.
 */
async function finish(
  system: any,
  dialog: number,
  lppd: number,
  id: number,
  lParam: number,
  answer: number
) {
  await takeProperty(system, dialog);

  if (flags(system, lppd) & PD_ENABLEPRINTHOOK) {
    globals(system).hook = dword(system, lppd, PRINT_HOOK);
  }

  await call(system, 'USER', 'EndDialog', [W(dialog), W(id === 3 ? lParam & 0xffff : answer)]);
}

/** `GetDlgItemInt` unsigned: the number and whether it was one. */
async function itemInt(system: any, dialog: number, id: number): Promise<[number, boolean]> {
  const answer = await api(system, 'USER', 'GetDlgItemInt', [W(dialog), W(id), B([0, 0]), W(0)]);

  return [answer.value & 0xffff, !!(answer.buffers[0][0] || answer.buffers[0][1])];
}

/** Whether a field has text: `GetDlgItemText` of four bytes. */
async function hasText(system: any, dialog: number, id: number) {
  return !!(
    (await call(system, 'USER', 'GetDlgItemText', [W(dialog), W(id), buffer(4), W(4)])) & 0xffff
  );
}

/**
 * A field refused (seg3 `1004`): a box of COMMDLG's string with the
 * dialog's caption, then the field with the focus and its text selected.
 */
async function refuse(system: any, dialog: number, id: number, text: number) {
  if (text) {
    const caption = stringOf(
      await api(system, 'USER', 'GetWindowText', [W(dialog), buffer(0x100), W(0x100)])
    );

    await messageBox(system, dialog, resource(text), caption);
  }

  const control = await item(system, dialog, id);

  await send(system, dialog, WM_NEXTDLGCTL, control, 1);
  await send(system, control, EM_SETSEL, 0, 0xffff0000);
  return 1;
}

/**
 * OK (seg3 `381c`): the copies and the range checked, in that order, and
 * written; the `DEVMODE`'s copies and quality; the context asked for.
 */
async function ok(system: any, dialog: number, lppd: number, lParam: number) {
  let now = flags(system, lppd) & ~0x33;

  setDword(system, lppd, FLAGS, now);

  if (await checked(system, dialog, CHX_PRINT_TO_FILE)) {
    now |= PD_PRINTTOFILE;
    setDword(system, lppd, FLAGS, now);
  }

  if (await checked(system, dialog, CHX_COLLATE)) {
    now |= PD_COLLATE;
    setDword(system, lppd, FLAGS, now);
  }

  const [copies, translated] = await itemInt(system, dialog, EDT_COPIES);

  setWord(system, lppd, COPIES, copies);

  if (!translated || !copies) {
    /* Nought is tested before the text: 458h is never chosen (`3879`). */
    const text = (await hasText(system, dialog, EDT_COPIES)) ? (copies ? 0x458 : 0x459) : 0x457;

    return await refuse(system, dialog, EDT_COPIES, text);
  }

  if (await checked(system, dialog, RAD_SELECTION)) {
    setDword(system, lppd, FLAGS, now | PD_SELECTION);
  } else if (await checked(system, dialog, RAD_PAGES)) {
    setDword(system, lppd, FLAGS, now | PD_PAGENUMS);

    const [from, fromGood] = await itemInt(system, dialog, EDT_FROM);

    setWord(system, lppd, FROM_PAGE, from);

    if (!fromGood && (await hasText(system, dialog, EDT_FROM))) {
      return await refuse(system, dialog, EDT_FROM, 0x454);
    }

    const [to, toGood] = await itemInt(system, dialog, EDT_TO);

    setWord(system, lppd, TO_PAGE, to);

    if (!toGood && (await hasText(system, dialog, EDT_TO))) {
      return await refuse(system, dialog, EDT_TO, 0x455);
    }

    if (!fromGood && !toGood) {
      return await refuse(system, dialog, EDT_FROM, 0x456);
    }

    if (!fromGood) {
      setWord(system, lppd, FROM_PAGE, word(system, lppd, MIN_PAGE));
    } else if (!toGood) {
      setWord(system, lppd, TO_PAGE, word(system, lppd, MAX_PAGE));
    }

    const min = word(system, lppd, MIN_PAGE);
    const max = word(system, lppd, MAX_PAGE);
    const first = word(system, lppd, FROM_PAGE);

    if (min > first) {
      return await refuse(system, dialog, EDT_FROM, 0x450);
    }

    if (max < first) {
      return await refuse(system, dialog, EDT_FROM, 0x451);
    }

    const last = word(system, lppd, TO_PAGE);

    if (min > last) {
      return await refuse(system, dialog, EDT_TO, 0x452);
    }

    if (max < last) {
      return await refuse(system, dialog, EDT_TO, 0x453);
    }
  }

  await wait(system, true);

  const handle = word(system, lppd, DEVNAMES);
  const names = await lock(system, handle);
  const devmode = word(system, lppd, DEVMODE);
  let mode = 0;

  if (devmode) {
    mode = await lock(system, devmode);

    if (flags(system, lppd) & PD_USEDEVMODECOPIES) {
      setWord(system, mode, 0x36, word(system, lppd, COPIES));
      setWord(system, lppd, COPIES, 1);
    } else {
      setWord(system, mode, 0x36, 1);
    }

    const chosen = (await sendItem(system, dialog, CMB_QUALITY, CB_GETCURSEL, 0, 0)) & 0xffff;

    if (chosen !== 0xffff) {
      const data = await sendItem(system, dialog, CMB_QUALITY, CB_GETITEMDATA, chosen, 0);

      setWord(system, mode, 0x3a, data & 0xffff);

      if ((await version(system)) >= 0x30a) {
        setWord(system, mode, 0x40, data >>> 16);
      }
    }

    await unlock(system, devmode);
  }

  await makeDc(system, mode, names, lppd);
  setWord(system, names, DEFAULT, word(system, names, DEFAULT) & ~0x4000);
  await unlock(system, handle);
  await finish(system, dialog, lppd, IDOK, lParam, 1);
  return 0;
}

/**
 * Setup... (seg3 `3bb4`): Print Setup opened on the dialog, again while it
 * ends with `PDERR_DEFAULTDIFFERENT`; the printer shown again once it ends
 * with OK, and the focus to OK.
 */
async function setup(system: any, dialog: number, lppd: number) {
  /* A template not found opens nothing, and sets no error (`3bdf`). */
  const found = await template(system, lppd, true);

  if ('error' in found) {
    return;
  }

  let answer = 0;

  if (await call(system, 'KERNEL', 'LockResource', [W(found.handle)])) {
    do {
      setError(system, 0);
      answer =
        (await call(system, 'USER', 'DialogBoxIndirectParam', [
          W(instance(system)),
          W(found.handle),
          W(dialog),
          D(exportAddress(system, PRINT_SETUP_DLG_PROC)),
          D(lppd),
        ])) & 0xffff;

      const code = error(system);

      if (code === PDERR_DEFAULTDIFFERENT || code === PDERR_DNDMMISMATCH) {
        await free(system, word(system, lppd, DEVNAMES));
        setWord(system, lppd, DEVNAMES, 0);
        setError(system, PDERR_DEFAULTDIFFERENT);
      }
    } while (error(system) === PDERR_DEFAULTDIFFERENT);

    await unlock(system, found.handle);
  }

  await letGo(system, found.handle, found.from);

  if (answer) {
    await showPrinter(system, lppd, dialog);
  }

  await send(system, dialog, WM_NEXTDLGCTL, await item(system, dialog, IDOK), 1);
}
