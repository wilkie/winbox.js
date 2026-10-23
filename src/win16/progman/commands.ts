'use strict';

import { D, W, buffer, stringOf } from '../commdlg/api.js';
import { cString } from '../../layers/groups.js';
import { D_FRAME, D_SHELL, type Pm, WM_CLOSE, latin, string } from './main.js';
import {
  create,
  group,
  groups,
  keyOf,
  load,
  lock,
  reloadAll,
  remove,
  save,
  unload,
  windowsTopDown,
} from './loaded.js';
import {
  type Adding,
  create as createItem,
  defaults,
  fitted,
  nameOf,
  remove as removeItem,
} from './items.js';
import {
  ADD_ITEM,
  type Block,
  type Command,
  CREATE_GROUP,
  DELETE_GROUP,
  DELETE_ITEM,
  EXIT_PROGMAN,
  number,
  RELOAD,
  REPLACE_ITEM,
  SHOW_GROUP,
} from './parse.js';

/**
 * The execute string's commands carried out, each as `PROGMAN.EXE`'s handler
 * (seg7, by the table at `0ade`) carries it out. As
 * `crates/winbox-win16/src/progman/commands.rs`.
 */

/** `[2A6h]`: a `ReplaceItem` waiting for the next `AddItem`, and the place it kept, `[81Eh]` and `[820h]` (`08ad`-`08b9`, `094a`-`0953`). */
const D_REPLACING = 0x2a6;
const D_REPLACED_X = 0x81e;
const D_REPLACED_Y = 0x820;

const s16 = (value: number) => (value << 16) >> 16;

/** One command (`035f`-`036c`, `0ad1`): whether it was done. */
export async function run(pm: Pm, block: Block, command: Command): Promise<boolean> {
  const args = command.args;

  switch (command.index) {
    case CREATE_GROUP:
      return createGroup(pm, block, args);
    case ADD_ITEM:
      return addItem(pm, block, args);
    case DELETE_GROUP: {
      /* `075e`: one argument, a group of that title deleted (seg4 `23af`),
       * whose answer is not looked at. */
      if (args.length !== 1) {
        return false;
      }

      const hwnd = await titled(pm, block.string(args[0]), 0x101);

      if (hwnd === null) {
        return false;
      }

      await remove(pm, hwnd);

      return true;
    }
    case EXIT_PROGMAN:
      return exitProgman(pm, block, args);
    case SHOW_GROUP: {
      /* `0821`: two arguments, a group of that title; `ShowWindow` of it with
       * the number, whose answer is not looked at. */
      if (args.length !== 2) {
        return false;
      }

      const hwnd = await titled(pm, block.string(args[0]), 0x101);

      if (hwnd === null) {
        return false;
      }

      await pm.user('ShowWindow', [W(hwnd), W(number(block, args[1]))]);

      return true;
    }
    case DELETE_ITEM:
    case REPLACE_ITEM:
      if (command.index === REPLACE_ITEM) {
        pm.sd16(D_REPLACING, 1);
        pm.sd16(D_REPLACED_X, 0xffff);
        pm.sd16(D_REPLACED_Y, 0xffff);
      }

      return deleteItem(pm, block, args);
    case RELOAD:
      return reload(pm, block, args);
  }

  return false;
}

/**
 * The group a title names, as the handlers find it (`03e9`-`0442`): the MDI
 * client's children from the top, those with an owner -- icons' titles --
 * passed over, each one's `GetWindowText` into a buffer of `size` compared by
 * `lstrcmpi`. Its window.
 */
async function titled(pm: Pm, name: number[], size: number): Promise<number | null> {
  for (const hwnd of await windowsTopDown(pm)) {
    const title = stringOf(
      await pm.call('USER', 'GetWindowText', [W(hwnd), buffer(size), W(size)]),
      0
    );

    if (((await pm.user('lstrcmpi', [string(latin(name)), string(latin(title))])) & 0xffff) === 0) {
      return hwnd;
    }
  }

  return null;
}

/** A string argument cut to `length` characters by a nought written into the client's block (`03b4`-`03c1`, `0508`-`0515`). */
function cut(block: Block, offset: number, length: number) {
  if (block.string(offset).length > length) {
    block.set(offset + length, 0);
  }
}

/**
 * `036f`: one or two arguments, the name cut to 30 characters; a group of that
 * title brought to the top; else the group made (seg4 `210e`), whose answer is
 * not looked at. Done either way.
 */
async function createGroup(pm: Pm, block: Block, args: number[]) {
  if (args.length !== 1 && args.length !== 2) {
    return false;
  }

  cut(block, args[0], 30);

  const name = block.string(args[0]);
  const found = await titled(pm, name, 0x101);

  if (found !== null) {
    await pm.user('BringWindowToTop', [W(found)]);
    return true;
  }

  await create(pm, latin(name), args.length === 2 ? latin(block.string(args[1])) : '');

  return true;
}

/**
 * `0479`: one to four arguments, or six to nine; the command not empty; the
 * name cut to 40 characters, else made from the command (seg5 `00ed`); the
 * icon path, its index, the place, the directory (else the command's, seg6
 * `0398`), the hot key and minimized; a `ReplaceItem`'s place taken where one
 * waits; an index of 666 or more less 666 and the item put last, else first
 * (`05f8`); with no icon path `FindExecutable`'s. The item made in the current
 * group (seg4 `105d`), whose answer is the command's; then the group's scroll
 * bars fitted.
 */
async function addItem(pm: Pm, block: Block, args: number[]) {
  if (!args.length || args.length === 5 || args.length > 9 || block.at(args[0]) === 0) {
    return false;
  }

  let command = latin(block.string(args[0]));
  let name = '';

  if (args.length > 1) {
    cut(block, args[1], 40);
    name = latin(block.string(args[1]));
  }

  if (!name) {
    [name, command] = await nameOf(pm, command);
  }

  let iconIndex = args.length > 3 ? number(block, args[3]) : 0;
  let place: [number, number] | null =
    args.length > 4 ? [s16(number(block, args[4])), s16(number(block, args[5]))] : null;

  if (pm.d16(D_REPLACING)) {
    place = [s16(pm.d16(D_REPLACED_X)), s16(pm.d16(D_REPLACED_Y))];
    pm.sd16(D_REPLACING, 0);
  }

  const first = iconIndex < 666;

  if (!first) {
    iconIndex -= 666;
  }

  const adding: Adding = {
    name,
    command,
    iconPath: args.length > 2 ? latin(block.string(args[2])) : '',
    directory: args.length > 6 ? latin(block.string(args[6])) : '',
    hotKey: 0,
    minimized: false,
    iconIndex,
    place,
    first,
  };

  await defaults(pm, adding, args.length > 6);
  adding.hotKey = args.length > 7 ? number(block, args[7]) : 0;
  adding.minimized = args.length > 8 && number(block, args[8]) !== 0;

  const current = groups(pm).current;
  const hwnd = group(pm, current)?.hwnd;

  if (hwnd === undefined || !(await createItem(pm, hwnd, adding))) {
    return false;
  }

  await fitted(pm, current);

  return true;
}

/**
 * `07cf`: refused as the shell; one argument; the settings saved where it
 * begins with `1` (seg4 `2845`); `WM_CLOSE` posted to the frame. Done.
 */
async function exitProgman(pm: Pm, block: Block, args: number[]) {
  if (pm.d16(D_SHELL) || args.length !== 1) {
    return false;
  }

  if (block.at(args[0]) === 0x31) {
    await save(pm);
  }

  await pm.user('PostMessage', [W(pm.d16(D_FRAME)), W(WM_CLOSE), W(0), D(0)]);

  return true;
}

/**
 * `08bc`: one argument; the current group's first item of that name, in the
 * group's order, compared by `lstrcmpi`; its place kept for a `ReplaceItem`;
 * the item deleted (seg4 `15a8`). None found, or no current group, fails.
 */
async function deleteItem(pm: Pm, block: Block, args: number[]) {
  if (args.length !== 1) {
    return false;
  }

  const current = groups(pm).current;

  if (!group(pm, current)) {
    return false;
  }

  const groupBlock = await lock(pm, current);

  if (!groupBlock) {
    return false;
  }

  const name = latin(block.string(args[0]));
  const data = groupBlock.data;

  for (const item of [...(group(pm, current)?.items ?? [])]) {
    const def = groupBlock.def(item.slot);
    const theirs = cString(data, data[def + 0x12] | (data[def + 0x13] << 8));

    if (((await pm.user('lstrcmpi', [string(name), string(theirs)])) & 0xffff) === 0) {
      pm.sd16(D_REPLACED_X, item.icon[0]);
      pm.sd16(D_REPLACED_Y, item.icon[1]);
      await removeItem(pm, current, item.slot);

      return true;
    }
  }

  return false;
}

/**
 * `0988`: no argument, every group unloaded and loaded again; one, the group
 * of that title -- its window's text into a buffer of 1Fh -- unloaded and
 * loaded again from its file as its number (seg4 `1f9a`, `1d4d`), whose answer
 * is not looked at; more, refused.
 */
async function reload(pm: Pm, block: Block, args: number[]) {
  switch (args.length) {
    case 0:
      await reloadAll(pm);
      return true;
    case 1: {
      const hwnd = await titled(pm, block.string(args[0]), 0x1f);

      if (hwnd === null) {
        return false;
      }

      const found = group(pm, await keyOf(pm, hwnd));

      if (found) {
        const { path, n } = found;

        await unload(pm, hwnd);
        await load(pm, path, n);
      }

      return true;
    }
  }

  return false;
}
