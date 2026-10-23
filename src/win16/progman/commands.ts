'use strict';

import { D, W, text } from '../commdlg/api.js';
import { bytesOf, D_FRAME, D_SHELL, type Pm, save, WM_CLOSE } from './main.js';
import { topDown, groups, titleOf } from './loaded.js';
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
 * (seg7, by the table at `0ade`) decides whether it is done. As
 * `crates/winbox-win16/src/progman/commands.rs`.
 *
 * Each checks its arguments and finds what it works on as the file does, and
 * answers as the file answers. What each then changes -- a group's window,
 * its file, `PROGMAN.INI`, an item made or taken out -- is not done yet
 * (marked "Not yet"): where the file's answer does not hang on it, the command
 * still answers as the file does; where it does, the command fails.
 */

/** `[2A6h]`: a `ReplaceItem` waiting for the next `AddItem`, and the place it kept, `[81Eh]` and `[820h]` (`08ad`-`08b9`, `094a`-`0953`). */
const D_REPLACING = 0x2a6;
const D_REPLACED_X = 0x81e;
const D_REPLACED_Y = 0x820;

/** One command (`035f`-`036c`, `0ad1`): whether it was done. */
export async function run(pm: Pm, block: Block, command: Command): Promise<boolean> {
  const args = command.args;

  switch (command.index) {
    case CREATE_GROUP:
      return createGroup(pm, block, args);
    case ADD_ITEM:
      return addItem(pm, block, args);
    case DELETE_GROUP:
      /* `075e`: one argument, a group of that title; then the group deleted
       * (seg4 `23af`), whose answer is not looked at. */
      if (args.length !== 1) {
        return false;
      }

      /* Not yet: the group's window, file and key taken away. */
      return (await titled(pm, block.string(args[0]), 0x101)) !== null;
    case EXIT_PROGMAN:
      return exitProgman(pm, block, args);
    case SHOW_GROUP:
      /* `0821`: two arguments, a group of that title; then `ShowWindow` of it
       * with the number. */
      if (args.length !== 2) {
        return false;
      }

      /* Not yet: `ShowWindow(group, number)` -- WinBox's groups have no
       * windows yet. */
      number(block, args[1]);

      return (await titled(pm, block.string(args[0]), 0x101)) !== null;
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
 * `lstrcmpi`. Its index among the loaded groups.
 */
async function titled(pm: Pm, name: number[], size: number): Promise<number | null> {
  for (const [index, group] of topDown(groups(pm))) {
    const title = bytesOf(titleOf(group)).slice(0, size - 1);

    if (((await pm.user('lstrcmpi', [text(name), text(title)])) & 0xffff) === 0) {
      return index;
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

  /* Not yet: `BringWindowToTop` of the group found; or the group made, its
   * file written, `PROGMAN.INI` rewritten and the group made current. */
  await titled(pm, block.string(args[0]), 0x101);

  return true;
}

/**
 * `0479`: one to four arguments, or six to nine; the command not empty; the
 * name cut to 40 characters; a `ReplaceItem` waiting taken. Then the item made
 * in the current group (seg4 `105d`), whose answer is the command's.
 */
function addItem(pm: Pm, block: Block, args: number[]) {
  if (!args.length || args.length === 5 || args.length > 9) {
    return false;
  }

  if (block.at(args[0]) === 0) {
    return false;
  }

  if (args.length > 1) {
    cut(block, args[1], 40);
  }

  if (pm.d16(D_REPLACING)) {
    pm.sd16(D_REPLACING, 0);
  }

  /* Not yet: the item made -- its defaults, its icon, its place and the
   * group's file written -- on whose answer the command hangs; so it fails. */
  return false;
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
    save(pm);
  }

  await pm.user('PostMessage', [W(pm.d16(D_FRAME)), W(WM_CLOSE), W(0), D(0)]);

  return true;
}

/**
 * `08bc`: one argument; the current group's first item of that name, in the
 * group's order, compared by `lstrcmpi`; its place kept for a `ReplaceItem`;
 * then the item taken out (seg4 `15a8`). None found, or no current group,
 * fails.
 */
async function deleteItem(pm: Pm, block: Block, args: number[]) {
  if (args.length !== 1) {
    return false;
  }

  const all = groups(pm);
  const current = all.current === null ? undefined : all.list[all.current];

  if (!current) {
    return false;
  }

  const name = block.string(args[0]);

  for (const item of current.group.items) {
    if (((await pm.user('lstrcmpi', [text(name), text(bytesOf(item.name))])) & 0xffff) === 0) {
      pm.sd16(D_REPLACED_X, item.x);
      pm.sd16(D_REPLACED_Y, item.y);

      /* Not yet: the item taken out and the group's file written. */
      return true;
    }
  }

  return false;
}

/**
 * `0988`: no argument, every group unloaded and loaded again (seg3 `0809`);
 * one, the group of that title -- its window's text into a buffer of 1Fh --
 * from its file (seg4 `1f9a`, `1d4d`), whose answer is not looked at; more,
 * refused.
 */
async function reload(pm: Pm, block: Block, args: number[]) {
  switch (args.length) {
    case 0:
      /* Not yet: the MDI client hidden, every group unloaded, all loaded
       * again and `display.drv=` written. */
      return true;
    case 1:
      /* Not yet: the group unloaded and loaded again. */
      return (await titled(pm, block.string(args[0]), 0x1f)) !== null;
  }

  return false;
}
