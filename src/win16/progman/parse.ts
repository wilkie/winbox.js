'use strict';

import { D, W, text } from '../commdlg/api.js';
import { type Pm, bytesOf, readNumber } from './main.js';

/**
 * An execute string read as `PROGMAN.EXE` reads it (seg7 `001c`-`030b`),
 * before any command in it is carried out. As
 * `crates/winbox-win16/src/progman/parse.rs`.
 *
 * The string is the client's block, and is read in place: a name is ended
 * with a nought written over what follows it and put back, and each argument
 * is ended by a nought written into the block, over the comma, the bracket,
 * the closing quote or the first trailing whitespace after it. The client
 * sees those noughts in its block after the acknowledgement. An argument is
 * its offset in the block.
 *
 * Letters are USER's (`IsCharAlpha`) and names are compared by USER's
 * `lstrcmpi`, each called as the file calls it.
 */

/** The commands' names, in the table at DS `02A8`; a command is its index here (the handlers' table at seg7 `0ade`). */
export const NAMES = [
  'CreateGroup',
  'AddItem',
  'DeleteGroup',
  'ExitProgman',
  'ShowGroup',
  'DeleteItem',
  'ReplaceItem',
  'Reload',
];

export const CREATE_GROUP = 0;
export const ADD_ITEM = 1;
export const DELETE_GROUP = 2;
export const EXIT_PROGMAN = 3;
export const SHOW_GROUP = 4;
export const DELETE_ITEM = 5;
export const REPLACE_ITEM = 6;
export const RELOAD = 7;

/** A command read: its index in `NAMES` and its arguments' offsets. */
export interface Command {
  index: number;
  args: number[];
}

/** The client's block, as the file reads and writes it. */
export class Block {
  declare bytes: number[];

  constructor(bytes: number[]) {
    this.bytes = bytes;
  }

  /** The byte at an offset; past the block, nought. (The file would read on past its end, to the selector's limit.) */
  at(offset: number): number {
    return this.bytes[offset] ?? 0;
  }

  set(offset: number, byte: number) {
    if (offset < this.bytes.length) {
      this.bytes[offset] = byte;
    }
  }

  /** The string at an offset, to its nought, as bytes. */
  string(offset: number): number[] {
    const rest = this.bytes.slice(offset);
    const end = rest.indexOf(0);

    return end < 0 ? rest : rest.slice(0, end);
  }
}

/** Whitespace as seg7 `0021` has it: a byte up to 20h compared signed, so 80h-FFh too. */
export function white(byte: number): boolean {
  return (byte << 24) >> 24 <= 0x20;
}

/** `001c`: past whitespace, to the next other byte or the nought. */
function skip(block: Block, p: number): number {
  while (block.at(p) !== 0 && white(block.at(p))) {
    p++;
  }

  return p;
}

/**
 * `003d`: past whitespace, a run of `IsCharAlpha` letters, looked up in
 * `NAMES` by `lstrcmpi` with a nought put after it and taken away again.
 * Where it ends, and its index; null for a name not there.
 */
async function name(pm: Pm, block: Block, p: number): Promise<[number, number | null]> {
  const start = skip(block, p);
  let end = start;

  while ((await pm.user('IsCharAlpha', [W(block.at(end))])) & 0xffff) {
    end++;
  }

  const word = block.bytes.slice(start, end);

  for (let at = 0; at < NAMES.length; at++) {
    if (((await pm.user('lstrcmpi', [text(bytesOf(NAMES[at])), text(word)])) & 0xffff) === 0) {
      return [end, at];
    }
  }

  return [end, null];
}

/**
 * `00cd`: an argument at `p`, never at whitespace. Its offset and where
 * reading goes on; null where the string is refused.
 *
 * - `"`: to the next `"`, which becomes a nought -- null where there is none;
 *   then whitespace and one comma passed.
 * - `,`: an empty argument, the comma a nought.
 * - `]`, `(` or `[`: refused.
 * - `)`: nothing taken; its slot keeps its nought, offset 0.
 * - anything else: to the next `,` or `)`, refused at `]`, `[` or `(`; a
 *   comma passed; a nought after its last byte above 20h (signed), so its
 *   trailing whitespace goes.
 */
export function argument(block: Block, p: number): [number, number] | null {
  const c = block.at(p);

  switch (c) {
    case 0x5d:
    case 0x28:
    case 0x5b:
      return null;
    case 0x29:
      return [0, p];
    case 0x2c:
      block.set(p, 0);
      return [p, p + 1];
    case 0x22: {
      p++;

      const slot = p;

      while (block.at(p) !== 0 && block.at(p) !== 0x22) {
        p++;
      }

      if (block.at(p) === 0) {
        return null;
      }

      block.set(p, 0);
      p = skip(block, p + 1);

      if (block.at(p) === 0x2c) {
        p++;
      }

      return [slot, p];
    }
  }

  const slot = p;
  let last = p;

  while (block.at(p) !== 0) {
    const byte = block.at(p);

    if (byte === 0x2c || byte === 0x29) {
      break;
    }

    if (byte === 0x5d || byte === 0x5b || byte === 0x28) {
      return null;
    }

    if (!white(byte)) {
      last = p;
    }

    p++;
  }

  if (block.at(p) === 0x2c) {
    p++;
  }

  block.set(last + 1, 0);

  return [slot, p];
}

/**
 * `01c8`: the whole string read into commands, or null where anything in it
 * is refused. The file keeps them in a block of its own,
 * `GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 100h)`, locked as it reads and
 * freed where it refuses; so does this, the commands kept here: the block's
 * handle and the commands.
 *
 * An empty string is no commands; whitespace alone is refused (`0211`). Each
 * command is `[`, a name, and `]`, with an optional `(` and arguments `)`
 * between; whitespace before each part.
 *
 * Not followed: the file's block has room for 128 words -- a command's index,
 * its count and its arguments' offsets, and the last -1 -- and writes past it
 * where a string has more.
 */
export async function parse(pm: Pm, block: Block): Promise<[number, Command[]] | null> {
  const list = (await pm.kernel('GlobalAlloc', [W(0x42), D(0x100)])) & 0xffff;

  if (!list) {
    return null;
  }

  await pm.kernel('GlobalLock', [W(list)]);

  const commands = await read(pm, block);

  await pm.kernel('GlobalUnlock', [W(list)]);

  if (!commands) {
    await pm.kernel('GlobalFree', [W(list)]);

    return null;
  }

  /* Freed once the commands are done (`0aff`). */
  return [list, commands];
}

/** `01ff`-`02fb`: the reading itself. */
async function read(pm: Pm, block: Block): Promise<Command[] | null> {
  const commands: Command[] = [];
  let p = 0;

  while (block.at(p) !== 0) {
    p = skip(block, p);

    if (block.at(p) === 0) {
      return commands.length ? commands : null;
    }

    if (block.at(p) !== 0x5b) {
      return null;
    }

    const [end, index] = await name(pm, block, p + 1);

    if (index === null) {
      return null;
    }

    const args: number[] = [];

    p = skip(block, end);

    if (block.at(p) === 0x28) {
      p++;

      for (;;) {
        p = skip(block, p);

        if (block.at(p) === 0x29) {
          break;
        }

        if (block.at(p) === 0) {
          return null;
        }

        const taken = argument(block, p);

        if (!taken) {
          return null;
        }

        args.push(taken[0]);
        p = taken[1];

        if (block.at(p) === 0) {
          break;
        }
      }

      p = skip(block, p + 1);
    }

    commands.push({ index, args });

    if (block.at(p) !== 0x5d) {
      return null;
    }

    p++;
  }

  return commands;
}

/** A number as seg3 `0285` reads one, from an argument. */
export function number(block: Block, offset: number): number {
  return readNumber(String.fromCharCode(...block.string(offset)));
}
