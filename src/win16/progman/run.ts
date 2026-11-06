'use strict';

import { B, D, W, buffer, stringOf } from '../commdlg/api.js';
import { D_QUIET, describe } from './dde.js';
import { group, groups, lock } from './loaded.js';
import { D_CLIENT, D_FRAME, type Pm, bytesOf, latin, string } from './main.js';
import { D_WINDOWS, changeTo, currentDirectory, dataString, execute } from './shell.js';

/**
 * An item run as `PROGMAN.EXE` runs one (`kb/topics/program-manager-dde.md`,
 * "Running an item"): the frame's `WM_COMMAND` (seg2 `28d3`, seg5 `05cc`),
 * File Open of the current group's first item (`067d`-`06ba`), the item
 * started (`03e7`-`05c9`), and Program Manager's boxes (seg1 `00ec`) with the
 * strings they take from `PROGMAN.EXE`'s string table, kept here by their
 * numbers. As `crates/winbox-win16/src/progman/run.rs`. Recorded by `pmitem`.
 */

/** `PROGMAN.EXE`'s strings its item boxes show, by their numbers in its string table. */
const INVALID_PATH = 0x34; // the caption of the box for a working directory not there (seg5 `04e1`)
const PATH_INVALID = 0x35; // error 3, no path (seg5 `0274`)
const EXECUTION_ERROR = 0x3c; // the caption of the box for a program not started (seg5 `0597`)
const DOS_ERROR = 0x3d; // the text for an error below 20h (seg1 `0126`-`014e`)
const NO_MEMORY = 0x3e;
const NO_FILE = 0x3f;
const TOO_MANY_FILES = 0x40;
const NO_ASSOCIATION = 0x41;
const ONE_COPY = 0x42;
const CANNOT_OPEN = 0x43;
const NOT_A_PROGRAM = 0x74;
const NEWER_WINDOWS = 0x75;
const NEEDS_WINDOWS = 0x76;
const ACCESS_DENIED = 0x85;
const DIRECTORY_INVALID = 0x8e; // the text of the box for a working directory not there (seg5 `04e3`)
const IN_STARTUP = 0x91; // after a StartUp item's command (seg5 `0560`)
const COMPRESSED = 0x96;
const DAMAGED_LIBRARY = 0x97;
const IN_USE = 0x98;

const STRINGS = new Map<number, string>([
  [INVALID_PATH, 'Invalid Path'],
  [PATH_INVALID, 'The path %s is invalid.'],
  [EXECUTION_ERROR, 'Application Execution Error'],
  [DOS_ERROR, 'Unexpected DOS error: %d.'],
  [
    NO_MEMORY,
    'Insufficient memory to run this application. Quit one or more Windows applications and then try again.',
  ],
  [
    NO_FILE,
    'Cannot find file %s (or one of its components). Check to ensure the path and filename are correct and that all required libraries are available.',
  ],
  [
    TOO_MANY_FILES,
    'Too many other files are currently in use. Quit one or more applications, or increase the FILES command in CONFIG.SYS.',
  ],
  [
    NO_ASSOCIATION,
    'No application is associated with the specified file. Create an association by using File Manager.',
  ],
  [ONE_COPY, 'Cannot start more than one copy of the specified program.'],
  [
    CANNOT_OPEN,
    'Cannot open file. Start the application used to create this file, and open it from there.',
  ],
  [NOT_A_PROGRAM, 'The specified application is not a Windows or MS-DOS program.'],
  [NEWER_WINDOWS, 'This application requires a newer version of Microsoft Windows.'],
  [NEEDS_WINDOWS, 'This application requires Windows.'],
  [ACCESS_DENIED, 'Access to the specified device, path, or file is denied.'],
  [DIRECTORY_INVALID, 'The working directory is invalid.'],
  [IN_STARTUP, "' specified in the startup group"],
  [
    COMPRESSED,
    'This program or one of its components is compressed.\n\nUse the MS-DOS Expand command to copy the file from the Windows Setup disks.',
  ],
  [
    DAMAGED_LIBRARY,
    'One of the library files needed to run this application is damaged. Please reinstall this application.',
  ],
  [IN_USE, 'This file is in use by some other application.'],
]);

/** `wsprintf` of a format with one `%s` or `%d`. */
function formatted(format: string, value: string) {
  return format.replace(/%[sd]/, () => value);
}

/** Where the box's text and caption are made (seg1 `0107`-`0199`). */
const D_BOX_TEXT = 0x342;
const D_BOX_CAPTION = 0x6e9;
/** `WM_COMMAND`'s help context: the command and 1388h (seg5 `05ee`-`05fd`). */
const D_HELP_CONTEXT = 0x154;
/** The hot key of the item being started (seg5 `045c`-`0464`). */
const D_HOT_KEY = 0x12a;

/**
 * seg1 `00ec`: a box of Program Manager's -- nothing, answered 1, while a DDE
 * execute runs (`[22h]`, seg7 `0338`); its caption string `caption`; its
 * text string `textId`, `value` put in its `%s` where there is one, or for a
 * number below 20h string 3Dh with the number; owned by the last active
 * popup of `owner`; `MessageBox` with `style`. Its answer.
 */
async function messageBox(
  pm: Pm,
  owner: number,
  caption: number,
  textId: number,
  value: string | null,
  style: number
) {
  if (pm.d16(D_QUIET)) {
    return 1;
  }

  const title = STRINGS.get(caption) ?? '';
  const format = STRINGS.get(textId < 0x20 ? DOS_ERROR : textId) ?? '';
  const body =
    textId < 0x20
      ? formatted(format, String(textId))
      : value !== null
        ? formatted(format, value)
        : format;

  pm.writeFar(pm.at(D_BOX_CAPTION), [...bytesOf(title), 0]);
  pm.writeFar(pm.at(D_BOX_TEXT), [...bytesOf(body), 0]);

  const popup = owner ? (await pm.user('GetLastActivePopup', [W(owner)])) & 0xffff : owner;

  return (await pm.user('MessageBox', [W(popup), string(body), string(title), W(style)])) & 0xffff;
}

/**
 * seg6 `009c`: whether a path's drive is there -- `GetDriveType` of a drive
 * it names neither nought nor 1; a path naming none is.
 */
async function driveThere(pm: Pm, path: string) {
  if (path[1] !== ':') {
    return true;
  }

  const drive = (path.charCodeAt(0) - 0x41) & 0xffff;

  return ((await pm.kernel('GetDriveType', [W(drive)])) & 0xffff) > 1;
}

/** A string converted by a call of the file's: `AnsiUpper`, `AnsiToOem`, `OemToAnsi`. */
async function converted(pm: Pm, module: string, name: string, value: string) {
  if (module === 'USER') {
    return latin(stringOf(await pm.call(module, name, [string(value)]), 0));
  }

  return latin(stringOf(await pm.call(module, name, [string(value), buffer(value.length + 1)]), 1));
}

/** A string's environment variables put in, in a buffer of `size`. */
async function substituted(pm: Pm, value: string, size: number) {
  const bytes = [...bytesOf(value)];

  bytes.push(...new Array(Math.max(size, bytes.length + 1) - bytes.length).fill(0));

  return latin(stringOf(await pm.call('SHELL', 'DoEnvironmentSubst', [B(bytes), W(size)]), 0));
}

/**
 * seg5 `03e7`: an item started -- the Windows directory made current; its
 * command and working directory from its group's block (seg4 `2967`);
 * minimized where Shift is held and `shift` asks for that (File Open), else
 * where its tag says; its hot key kept; the environment's variables put into
 * both (`DoEnvironmentSubst`); the directory current kept; the working
 * directory made upper case and tried -- its drive's type, then made current
 * -- and where it is not there, "The working directory is invalid." asked
 * with OK and Cancel, Cancel ending it; the directory kept made current
 * again; then the command started (seg5 `01b3`) in that directory; and where
 * it could not be, the error told in a box, the command's file in it, or for
 * a StartUp item the file quoted and string 91h; the directory kept made
 * current again.
 */
export async function runItem(pm: Pm, key: number, slot: number, shift: boolean, startUp: boolean) {
  await changeTo(pm, dataString(pm, D_WINDOWS, 0x81));

  const block = await lock(pm, key);

  if (!block) {
    return;
  }

  const item = describe(block, slot);
  let minimized = false;

  if (shift) {
    minimized = ((await pm.user('GetKeyState', [W(0x10)])) & 0x8000) !== 0;
  }

  if (!minimized) {
    minimized = item.minimized !== 0;
  }

  pm.sd16(D_HOT_KEY, item.hotKey);

  const command = await substituted(pm, item.command, 0x100);
  let directory = await substituted(pm, item.directory, 0x80);
  const saved = await currentDirectory(pm);
  const frame = pm.d16(D_FRAME);

  directory = await converted(pm, 'USER', 'AnsiUpper', directory);
  directory = await converted(pm, 'KEYBOARD', 'AnsiToOem', directory);

  if (directory) {
    const there = (await driveThere(pm, directory)) && (await changeTo(pm, directory)) === 0;

    if (
      !there &&
      (await messageBox(pm, frame, INVALID_PATH, DIRECTORY_INVALID, null, 0x131)) === 2
    ) {
      await changeTo(pm, saved);
      return;
    }
  }

  await changeTo(pm, saved);
  directory = await converted(pm, 'KEYBOARD', 'OemToAnsi', directory);

  const error = await execute(pm, command, directory, minimized);

  if (error) {
    /* `01b3` ends the file at the first space after its leading ones. */
    const start = command.length - command.replace(/^ +/, '').length;
    const space = command.indexOf(' ', start);
    let shown = space < 0 ? command : command.slice(0, space);

    if (startUp) {
      shown = `'${shown}${STRINGS.get(IN_STARTUP)}`;
    }

    await messageBox(pm, frame, EXECUTION_ERROR, error, shown, 0x1030);
  }

  await changeTo(pm, saved);
}

/**
 * File Open (seg5 `067d`-`06ba`): with a current group, an icon restored
 * (`SC_RESTORE`), else its first item started, Shift asked after.
 */
async function open(pm: Pm) {
  const current = groups(pm).current;
  const found = group(pm, current);

  if (!found) {
    return;
  }

  /* `03b9`: whether the current group is an icon. */
  if ((await pm.user('IsIconic', [W(found.hwnd)])) & 0xffff) {
    await pm.user('SendMessage', [W(found.hwnd), W(0x112), W(0xf120), D(0)]);
    return;
  }

  /* `[si+6]`: the first item in memory. With none the file would read from a
   * null item; WinBox's starts nothing. */
  const first = found.items[0];

  if (!first) {
    return;
  }

  await runItem(pm, current, first.slot, true, false);
}

/** File Open's command, the menu's and Enter's, and what a double-click on an item posts (seg2 `1b64`). */
const IDM_OPEN = 102;

/**
 * The frame's `WM_COMMAND` (seg2 `28d3`, seg5 `05cc`): the MDI client asked
 * for its active child, the command's help context kept, and the command
 * done; whether it was one of its own -- else `DefFrameProc` takes it. Of
 * its commands only File Open is done yet.
 */
export async function command(pm: Pm, wParam: number) {
  await pm.user('SendMessage', [W(pm.d16(D_CLIENT)), W(0x229), W(0), D(0)]);
  pm.sd16(D_HELP_CONTEXT, (wParam + 0x1388) & 0xffff);
  pm.sd16(D_HELP_CONTEXT + 2, 0);

  if (wParam === IDM_OPEN) {
    await open(pm);
    return true;
  }

  return false;
}
