'use strict';

import {
  D,
  W,
  api,
  item,
  itemText,
  post,
  send,
  sendItem,
  sendItemBytes,
  setItemText,
  text,
  word,
} from './api.js';
import {
  CBN_CLOSEUP,
  CB_FINDSTRING,
  CB_GETCURSEL,
  CHX_READONLY,
  CMB_DRIVES,
  CMB_TYPES,
  EDT_NAME,
  IDYES,
  LPFNHOOK,
  LPSTRDEFEXT,
  LPSTRFILE,
  LPSTRFILETITLE,
  NFILEEXTENSION,
  NFILEOFFSET,
  NFILTERINDEX,
  NMAXFILE,
  NMAXFILETITLE,
  OFN_ALLOWMULTISELECT,
  OFN_CREATEPROMPT,
  OFN_EXTENSIONDIFFERENT,
  OFN_FILEMUSTEXIST,
  OFN_NOREADONLYRETURN,
  OFN_NOTESTFILECREATE,
  OFN_NOVALIDATE,
  OFN_OVERWRITEPROMPT,
  OFN_PATHMUSTEXIST,
  OFN_READONLY,
  OFN_SHAREAWARE,
  Ofn,
  TAKE,
  WM_COMMAND,
  WM_GETTEXTLENGTH,
  WM_NEXTDLGCTL,
  WM_SETREDRAW,
  hasWildcard,
  shared,
  terminated,
} from './file-dialogs.js';
import { dialogOf, withDialog } from './file-init.js';
import {
  type Opened,
  applySpec,
  canCreate,
  changeDirectory,
  close,
  createPrompt,
  currentDirectory,
  currentDrive,
  driveType,
  fileAttributesOf,
  openQuietly,
  overwritePrompt,
  refresh,
  refreshDrives,
  reservedName,
  selectDrive,
  showError,
} from './file-lists.js';
import { DIRECTORY, EMPTY, INVALID_CHARACTER, INVALID_SPACE, parseFile } from './parse-file.js';
import { callHookText, message as registered, waitCursor } from './state.js';
import { translateText } from '../keyboard/oem.js';

/**
 * OK in the file boxes: the name taken, checked and answered (`COMMDLG.DLL`
 * seg2 `22e7`), or with several files the names taken (seg2 `1c16`). As
 * `file_ok.rs`.
 */

const OF_EXIST_SHARED = 0x4040;
const OF_CREATE = 0x1000;
const OF_DELETE = 0x0200;
const HFILE_ERROR = 0xffff;
/** A file another program holds: COMMDLG's own mark (seg2 `2ae0`). */
const SHARED = 0xfffe;
/** DOS's sharing violation. */
const SHARING = 0x20;
/** The answers a hook gives `SHAREVISTRING` (`OFN_SHARENOWARN`, `OFN_SHAREFALLTHROUGH`). */
const SHARE_NO_WARN = 1;
const SHARE_FALL_THROUGH = 2;

/** The bytes up to a nought, from `at`. */
const from = (bytes: number[], at: number) => terminated(bytes.slice(at));

/** The default extension added: a period and its first three characters, a `*` before them for a wildcard (seg2 `4a38`). */
export function addExtension(name: number[], extension: number[], star: boolean) {
  const end = name.indexOf(0);

  if (end >= 0) {
    name.length = end;
  }

  if (star) {
    name.push(0x2a);
  }

  name.push(0x2e, ...terminated(extension).slice(0, 3), 0);
}

type Next = { error: number } | 'share' | 'done' | 'keep';

/** OK: the name taken. Nought keeps the box; 1 ends it with the name answered in the structure. */
export async function nameTaken(system: any, hwnd: number, save: boolean): Promise<number> {
  const data = dialogOf(system, hwnd);

  if (!data) {
    return 0;
  }

  const ofn = new Ofn(system, data.ofn);
  let network = false;
  let scratch = [...(await itemText(system, hwnd, EDT_NAME, 0xff)), 0];
  const first = parseFile(scratch);
  const parsed = first[0];
  let extension = first[1];
  const flags = ofn.flags();

  withDialog(system, hwnd, (block) => (block.scratch = terminated(scratch)));

  if (parsed === EMPTY) {
    await refresh(system, hwnd, null, 0);
    return 0;
  }

  /* Not checked: the name as it is (seg2 `2362`). */
  if (parsed !== DIRECTORY && flags & OFN_NOVALIDATE) {
    ofn.setWord(NFILEOFFSET, parsed);
    ofn.setWord(NFILEEXTENSION, extension);
    writeName(ofn, terminated(scratch));
    return 1;
  }

  if (parsed === INVALID_SPACE && flags & OFN_ALLOWMULTISELECT) {
    return await severalTaken(system, hwnd, save);
  }

  /* Specs after a `;`: the files' list shows them (seg2 `2430`). */
  if (scratch[extension] === 0x3b) {
    scratch[extension] = 0;

    const [first] = parseFile(scratch);

    scratch[extension] = 0x3b;

    if (first >= 0 && hasWildcard(from(scratch, first))) {
      const spec = from(scratch, first);

      withDialog(system, hwnd, (block) => (block.spec = spec.slice()));

      const whole = terminated(scratch);
      const answer = await applySpec(system, whole, hwnd);

      if (!answer) {
        return 0;
      }

      return await pathError(system, hwnd, scratch, answer, parsed, network);
    }

    return await error(system, hwnd, scratch, INVALID_CHARACTER & 0xffff, parsed, network, 0);
  }

  if (parsed === DIRECTORY) {
    const at = extension;

    if (
      at > 1 &&
      (scratch[at - 1] === 0x5c || scratch[at - 1] === 0x2f) &&
      scratch[at - 2] !== 0x3a
    ) {
      scratch[at - 1] = 0;
    }
  } else if (parsed < 0) {
    return await error(system, hwnd, scratch, parsed & 0xffff, parsed, network, 0);
  }

  /* A name that is a folder is gone into; the path before a file's name is
   * tried (seg2 `25fc`). */
  let cut = parsed;
  let answer = 0;

  if (
    (scratch[0] === 0x5c && scratch[1] === 0x5c) ||
    (scratch[1] === 0x3a && scratch[2] === 0x5c && scratch[3] === 0x5c)
  ) {
    network = true;
  } else {
    answer = await changeDirectory(system, terminated(scratch), true);

    if (!answer) {
      return await goneInto(system, hwnd);
    }

    if (parsed > 0) {
      if (parsed > 1 && scratch[parsed - 1] !== 0x3a && scratch[parsed - 2] !== 0x3a) {
        cut -= 1;
      }

      const saved = currentDirectory(system) ?? [];
      const kept = scratch[cut];

      scratch[cut] = 0;
      answer = await changeDirectory(system, terminated(scratch), true);
      scratch[cut] = kept;
      await changeDirectory(system, saved, false);
    }
  }

  if (!network && parsed !== 0 && answer && flags & OFN_PATHMUSTEXIST) {
    return await pathError(system, hwnd, scratch, answer, parsed, network);
  }

  const nameAt = Math.max(parsed, 0);

  /* A wildcard: the files' spec (seg2 `2860`). */
  if (hasWildcard(from(scratch, nameAt))) {
    if (network) {
      return await error(system, hwnd, scratch, 2, parsed, network, 0);
    }

    if (cut > 0) {
      const kept = scratch[cut];

      scratch[cut] = 0;
      await changeDirectory(system, terminated(scratch), true);
      scratch[cut] = kept;
    }

    const spec = from(scratch, nameAt);

    if (extension === 0) {
      spec.push(0x2e);
    }

    const whole = [0x2e, 0x5c, ...spec];

    withDialog(system, hwnd, (block) => (block.spec = spec.slice()));

    if (await applySpec(system, whole, hwnd)) {
      await api(system, 'USER', 'MessageBeep', [W(0)]);
    }

    return 0;
  }

  if (reservedName(from(scratch, nameAt))) {
    return await error(system, hwnd, scratch, 0x62, parsed, network, 0);
  }

  /* `C:NAME` made `C:.\NAME` (seg2 `2987`). */
  if (parsed === 2 && scratch[1] === 0x3a) {
    scratch = [...scratch.slice(0, 2), 0x2e, 0x5c, ...from(scratch, 2), 0];
    extension += 2;
  }

  /* The default extension, where the name has none (seg2 `29d7`). */
  const defext = ofn.string(LPSTRDEFEXT) ?? [];
  const at = extension;
  let extensionAdded = false;
  let opened: Opened = { handle: 0, code: 0, path: [] };
  let found = false;

  if (
    extension !== 0 &&
    (scratch[at] ?? 0) === 0 &&
    defext.length &&
    extension + 4 < ofn.dword(NMAXFILE) &&
    extension + 4 < 0x80
  ) {
    extensionAdded = true;
    addExtension(scratch, defext, false);

    if (!(await changeDirectory(system, terminated(scratch), true))) {
      return await goneInto(system, hwnd);
    }

    opened = await openQuietly(system, terminated(scratch), OF_EXIST_SHARED, network);

    if (opened.code === SHARING) {
      opened.handle = SHARED;
    }

    if (opened.handle === HFILE_ERROR) {
      scratch.length = at;
      scratch.push(0);
    } else {
      found = true;
    }
  }

  if (!found) {
    opened = await openQuietly(system, terminated(scratch), OF_EXIST_SHARED, network);
    found = opened.handle !== HFILE_ERROR;
  }

  let next: Next;

  if (found) {
    /* There (seg2 `2af0`). */
    const path = terminated(opened.path);

    if (flags & OFN_NOREADONLYRETURN && (await fileAttributesOf(system, path)) & 1) {
      next = { error: 0x63 };
    } else if (save || flags & OFN_NOREADONLYRETURN) {
      const code = await canCreate(system, path);

      next = code ? { error: code } : 'done';
    } else {
      next = 'done';
    }
  } else {
    /* Not there (seg2 `2c1f`). */
    const code = opened.code;

    if ((code === 2 || code === 3) && extensionAdded) {
      addExtension(scratch, defext, false);
      addExtension(opened.path, defext, false);
    }

    if (code === SHARING) {
      next = 'share';
    } else if (!save) {
      if (code === 2 || code === 3) {
        if (flags & OFN_FILEMUSTEXIST) {
          if (flags & OFN_CREATEPROMPT) {
            shared(system).prompting = true;

            const choice = await createPrompt(system, hwnd, terminated(scratch));

            shared(system).prompting = false;

            if (choice !== IDYES) {
              return 0;
            }

            next = 'keep';
          } else {
            next = { error: code };
          }
        } else {
          next = 'keep';
        }
      } else {
        next = { error: code };
      }
    } else {
      next = 'keep';
    }
  }

  /* The overwrite prompt (seg2 `2b50`), and the creation tried for a name
   * not there (seg2 `2d56`). */
  if (found && next === 'done') {
    if (
      flags & OFN_OVERWRITEPROMPT &&
      save &&
      !(await overwritePrompt(system, hwnd, terminated(opened.path)))
    ) {
      const edit = await item(system, hwnd, EDT_NAME);

      await post(system, hwnd, WM_NEXTDLGCTL, edit, 1);
      return 0;
    }

    if (opened.code === SHARING) {
      next = 'share';
    }
  }

  if (next === 'keep') {
    next = 'done';

    if (flags & OFN_PATHMUSTEXIST && !(flags & OFN_NOTESTFILECREATE)) {
      const name = terminated(scratch);
      let made = await openQuietly(system, name, OF_CREATE, network);

      if (made.handle === HFILE_ERROR) {
        const code = made.code;

        next = { error: [0x13, 0x52, 0x41, 5].includes(code) ? code : 0 };
        opened = made;
      } else {
        await close(system, made.handle);
        await openQuietly(system, name, OF_DELETE, network);
        made = await openQuietly(system, name, OF_EXIST_SHARED, network);

        if (made.handle !== HFILE_ERROR) {
          next = { error: 0x60 };
          opened = made;
        }
      }
    }
  }

  /* Another program has it (seg2 `2c80`). */
  if (next === 'share') {
    if (flags & OFN_SHAREAWARE) {
      next = 'done';
    } else {
      const hook = ofn.dword(LPFNHOOK);

      if (!hook) {
        next = { error: SHARING };
      } else {
        const answerOf = await callHookText(
          system,
          hook,
          hwnd,
          registered(system, 'commdlg_ShareViolation'),
          0,
          terminated(opened.path)
        );

        if (answerOf === SHARE_NO_WARN) {
          return 0;
        }

        next = answerOf === SHARE_FALL_THROUGH ? 'done' : { error: SHARING };
      }
    }
  }

  if (typeof next === 'object') {
    return await error(system, hwnd, scratch, next.error, parsed, network, opened.path[0] ?? 0);
  }

  return await answered(system, hwnd, ofn, opened, extension, extensionAdded);
}

/** The name answered (seg2 `2e90`): the path `OpenFile` made of it, its offsets, its title, and the read-only box's state. */
async function answered(
  system: any,
  hwnd: number,
  ofn: Ofn,
  opened: Opened,
  extension: number,
  extensionAdded: boolean
) {
  await waitCursor(system, true);

  const ansi = Array.from(
    await translateText(system, String.fromCharCode(...terminated(opened.path)), 'ansi'),
    (c) => c.charCodeAt(0)
  );
  const parsing = [...ansi, 0];
  const [offset, at] = parseFile(parsing);
  const path = terminated(parsing);

  ofn.setWord(NFILEOFFSET, offset);
  ofn.setWord(NFILEEXTENSION, extension || extensionAdded ? at : 0);

  let flags = (ofn.flags() & ~OFN_EXTENSIONDIFFERENT) >>> 0;
  const defext = ofn.string(LPSTRDEFEXT);

  if (defext && ofn.word(NFILEEXTENSION)) {
    const wanted = String.fromCharCode(...defext.slice(0, 3)).toUpperCase();
    const given = String.fromCharCode(...from(path, at)).toUpperCase();

    if (wanted !== given) {
      flags |= OFN_EXTENSIONDIFFERENT;
    }
  }

  ofn.setFlags(flags);
  writeName(ofn, path);

  if (ofn.dword(LPSTRFILETITLE)) {
    let title = from(path, Math.max(offset, 0));
    const room = ofn.dword(NMAXFILETITLE);

    if (room <= title.length) {
      title = title.slice(0, Math.max(room - 1, 0));
    }

    ofn.write(LPSTRFILETITLE, title);
  }

  const checked = await word(system, 'USER', 'IsDlgButtonChecked', [W(hwnd), W(CHX_READONLY)]);
  const now = ofn.flags();

  ofn.setFlags(checked ? now | OFN_READONLY : now & ~OFN_READONLY);
  return 1;
}

/** The name answered in the program's buffer, or its length where it does not fit (seg2 `2387`, `2f7b`). */
function writeName(ofn: Ofn, name: number[]) {
  if (!ofn.dword(LPSTRFILE)) {
    return;
  }

  if (ofn.word(NMAXFILE) >= name.length) {
    ofn.write(LPSTRFILE, name);
  } else {
    ofn.writeSize(LPSTRFILE, name.length);
  }
}

/** A folder named gone into: the name `*.*` until the types' combo box puts the type's pattern back, and both lists filled again (seg2 `264f`). */
async function goneInto(system: any, hwnd: number) {
  await sendItem(system, hwnd, EDT_NAME, WM_SETREDRAW, 0, 0);
  await setItemText(system, hwnd, EDT_NAME, [0x2a, 0x2e, 0x2a]);
  await selectDrive(system, hwnd, currentDrive(system) + 0x61);

  const types = await item(system, hwnd, CMB_TYPES);

  await send(system, hwnd, WM_COMMAND, CMB_TYPES, ((CBN_CLOSEUP << 16) | types) >>> 0);

  const drives = await item(system, hwnd, CMB_DRIVES);

  await send(system, hwnd, WM_COMMAND, CMB_DRIVES, ((TAKE << 16) | drives) >>> 0);
  await sendItem(system, hwnd, EDT_NAME, WM_SETREDRAW, 1, 0);

  const edit = await item(system, hwnd, EDT_NAME);

  await api(system, 'USER', 'InvalidateRect', [W(edit), D(0), W(0)]);
  return 0;
}

/** A path that is not there (seg2 `27b6`). */
async function pathError(
  system: any,
  hwnd: number,
  scratch: number[],
  answer: number,
  parsed: number,
  network: boolean
) {
  const letter = scratch[0] ?? 0;
  let code: number;
  let drive = 0;

  if (answer === 2) {
    code = 3;
  } else if (answer === 1) {
    drive = letter;

    const found =
      (await sendItemBytes(system, hwnd, CMB_DRIVES, CB_FINDSTRING, 0xffff, text([letter]))).value &
      0xffff;

    if (found & 0x8000) {
      code = 0x61;
    } else {
      switch (await driveType(system, letter - 0x61)) {
        case 1:
          await refreshDrives(system, hwnd);
          code = 0x61;
          break;
        case 2:
          code = 5;
          break;
        default:
          code = 3;
      }
    }
  } else {
    code = 2;
  }

  return await error(system, hwnd, scratch, code, parsed, network, drive);
}

/** An error said in COMMDLG's box (seg2 `2552`): a network path's is "not found"; one of the drive's says the drive's letter. */
async function error(
  system: any,
  hwnd: number,
  scratch: number[],
  given: number,
  parsed: number,
  network: boolean,
  drive: number
) {
  let code = given;

  if (network) {
    code = 2;
  } else if (parsed === 2 && scratch[2] === 0x2e) {
    /* `C:.\NAME` said as `C:NAME` again (seg2 `2565`). */
    const rest = from(scratch, 4);

    scratch.length = 2;
    scratch.push(...rest, 0);
  }

  if (code === 5 && (await driveType(system, (drive | 0x60) - 0x61)) !== 2) {
    code = 0x41;
  }

  if ([0x13, 0x52, 5].includes(code) && scratch.length) {
    scratch[0] = drive;
  }

  await showError(system, hwnd, terminated(scratch), code);
  return 0;
}

/** Several files taken (seg2 `1c16`): the folder and the names as typed, a space between, each checked as it is opened; the extension's offset nought. */
async function severalTaken(system: any, hwnd: number, save: boolean) {
  const data = dialogOf(system, hwnd);

  if (!data) {
    return 0;
  }

  const ofn = new Ofn(system, data.ofn);
  const flags = ofn.flags();
  const folder = currentDirectory(system) ?? [];
  const length = (await sendItem(system, hwnd, EDT_NAME, WM_GETTEXTLENGTH, 0, 0)) & 0xffff;
  const needed = (length + folder.length + 2) & 0xffff;

  if (!ofn.dword(LPSTRFILE)) {
    return await severalEnd(system, hwnd, ofn);
  }

  if (ofn.word(NMAXFILE) < needed) {
    ofn.writeSize(LPSTRFILE, needed);
    return await severalEnd(system, hwnd, ofn);
  }

  const file = [...folder, 0x20];
  const start = file.length;

  ofn.setWord(NFILEOFFSET, start);

  const room = (ofn.word(NMAXFILE) - start - 1) & 0xffff;

  file.push(...(await itemText(system, hwnd, EDT_NAME, room)));
  ofn.write(LPSTRFILE, file);

  let p = start;

  while (file[p] === 0x20) {
    p++;
  }

  if (p >= file.length) {
    return 0;
  }

  let more = false;

  while (!more) {
    let q = p;

    while (q < file.length && file[q] !== 0x20) {
      q++;
    }

    if (q < file.length) {
      file[q] = 0;
    } else {
      more = true;
    }

    const name = terminated(file.slice(p));
    const opened = await openQuietly(system, name, OF_EXIST_SHARED, false);

    if (opened.handle === HFILE_ERROR) {
      let code = opened.code;
      const fine =
        (!(flags & OFN_FILEMUSTEXIST) && code === 2) ||
        (!(flags & OFN_PATHMUSTEXIST) && code === 3) ||
        (flags & OFN_SHAREAWARE && code === SHARING);

      if (!fine) {
        let fallen = false;

        if (code === SHARING && ofn.dword(LPFNHOOK)) {
          const choice = await callHookText(
            system,
            ofn.dword(LPFNHOOK),
            hwnd,
            registered(system, 'commdlg_ShareViolation'),
            0,
            terminated(opened.path)
          );

          if (choice === SHARE_NO_WARN) {
            return 0;
          }

          fallen = choice === SHARE_FALL_THROUGH;
        } else if (code === 5) {
          const drive = (opened.path[0] ?? 0) | 0x60;

          if ((await driveType(system, drive - 0x61)) !== 2) {
            code = 0x41;
          }
        }

        if (!fallen) {
          if ([0x13, 0x52, 5].includes(code) && name.length) {
            name[0] = opened.path[0] ?? 0;
          }

          await showError(system, hwnd, name, code);
          return 0;
        }
      }
    } else {
      const path = terminated(opened.path);

      if (flags & OFN_NOREADONLYRETURN && (await fileAttributesOf(system, path)) & 1) {
        await showError(system, hwnd, name, 0x63);
        return 0;
      }

      if (save || flags & OFN_NOREADONLYRETURN) {
        const code = await canCreate(system, path);

        if (code) {
          await showError(system, hwnd, name, code);
          return 0;
        }
      }

      if (flags & OFN_OVERWRITEPROMPT && save && !(await overwritePrompt(system, hwnd, path))) {
        const edit = await item(system, hwnd, EDT_NAME);

        await post(system, hwnd, WM_NEXTDLGCTL, edit, 1);
        return 0;
      }
    }

    if (!more) {
      p = q + 1;

      while (file[p] === 0x20) {
        p++;
      }

      if (p >= file.length) {
        more = true;
      } else {
        file[q] = 0x20;
      }
    }
  }

  ofn.write(LPSTRFILE, terminated(file));
  return await severalEnd(system, hwnd, ofn);
}

/** Several files answered: no extension's offset, and the type chosen (seg2 `2024`). */
async function severalEnd(system: any, hwnd: number, ofn: Ofn) {
  ofn.setWord(NFILEEXTENSION, 0);

  const index = (await sendItem(system, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0)) & 0xffff;

  ofn.setDword(NFILTERINDEX, index);
  return 1;
}
