'use strict';

import { MessageBox } from '../user/MessageBox.js';
import { inFrame } from './devices.js';
import { mciGetErrorString } from './mci.js';
import { mciSendString } from './mci-string.js';
import { MMSYSTEM_STRINGS } from './strings.js';

/**
 * `mciExecute`: a command string run, and its error, if any, shown in a box.
 * The twin of `mmsystem/mci_execute.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg5 `1293`, its token `22d5`);
 * **recorded** by `mmmisc`:
 *
 * * The command goes to `mciSendString` with no buffer for an answer and no
 *   window. Nought is TRUE.
 * * Else the error's text, `mciGetErrorString`'s into 80h bytes -- or, with
 *   none, MMSYSTEM's string 7D1h, "Unknown error returned from MCI command"
 *   -- is put in a box of `MB_ICONHAND`, with no owner, its title the word
 *   after the command: the spaces before the command skipped, then the
 *   command, then the spaces after it, then a word as MCI reads one (a
 *   quoted run kept whole, its quotes taken off, `""` within it one quote).
 *   With no word, the title is empty; with an unclosed quote, there is none
 *   and the box says "Error". The answer is FALSE.
 */

const MB_ICONHAND = 0x10;

/** A word as MMSYSTEM reads one (seg5 `22d5`), up to a space: the word, or null for one it refuses. */
export function token(text: string, from: number): string | null {
  let at = from;
  let quotes = true;
  let quoted = false;
  let sawQuote = false;

  for (;;) {
    const c = text[at];

    if (c === undefined || (c === ' ' && !quoted)) {
      break;
    }

    if (c === '"' && quotes) {
      if (quoted) {
        if (text[at + 1] === '"') {
          at++;
        } else {
          quoted = false;
        }
      } else {
        quoted = true;
        sawQuote = true;
      }
    } else if (!quoted) {
      if (sawQuote) {
        /* MCIERR_NO_ELEMENT_ALLOWED: a quote closed, then more. */
        return null;
      }

      quotes = false;
    }

    at++;
  }

  if (quoted) {
    /* MCIERR_NO_CLOSING_QUOTE. */
    return null;
  }

  let word = '';
  let inside = false;

  for (let i = from; i < at; i++) {
    const c = text[i];

    if (c === '"' && quotes) {
      if (inside) {
        if (text[i + 1] === '"') {
          word += '"';
          i++;
        } else {
          inside = false;
        }
      } else {
        inside = true;
      }
    } else {
      word += c;
    }
  }

  return word;
}

/**
 * Runs a command string, showing its error.
 *
 * @param {Types.LPCSTR} lpstrCommand - The command.
 *
 * @returns {Types.BOOL} Whether it succeeded.
 */
export async function mciExecute(this: any, lpstrCommand: any) {
  const command = lpstrCommand === null || lpstrCommand === undefined ? null : String(lpstrCommand);
  const answer = (await mciSendString.call(this, command, 0, 0, 0)) >>> 0;

  if (!answer) {
    return 1;
  }

  const [found, [bytes]] = await inFrame(this, [new Uint8Array(0x80)], async ([far]) =>
    mciGetErrorString.call(this, answer, far, 0x80)
  );
  let text: string;

  if (found) {
    const end = bytes.indexOf(0);

    text = String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end));
  } else {
    text = (MMSYSTEM_STRINGS.get(0x7d1) ?? '').slice(0, 0x7f);
  }

  let title: string | null = null;

  if (command !== null) {
    let at = 0;

    while (command[at] === ' ') {
      at++;
    }

    while (command[at] !== undefined && command[at] !== ' ') {
      at++;
    }

    while (command[at] === ' ') {
      at++;
    }

    title = token(command, at);
  }

  await MessageBox.call(this, 0, text, title, MB_ICONHAND);

  return 0;
}
