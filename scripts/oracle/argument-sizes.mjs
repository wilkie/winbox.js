#!/usr/bin/env node
/**
 * How many bytes of arguments each exported function of a Windows module
 * takes, read out of the module itself.
 *
 * Every exported function of KERNEL, USER and GDI is called far with the
 * Pascal convention: the caller pushes the arguments and the function takes
 * them off with the `RETF n` it returns by. So `n` is the size of the
 * arguments, and a stand-in that returns by anything else leaves the caller's
 * stack wrong by the difference -- which is what an unimplemented function
 * declared as taking nothing did to every program that called it.
 *
 * Each export is followed from its entry by recursive descent (see
 * `descend.mjs`), through its jumps but not into what it calls, and every
 * `RETF` reached is collected. One size is the answer. None -- a function that
 * leaves by a far jump, or an entry that is data -- and more than one are
 * reported as unknown rather than guessed.
 *
 *   node scripts/oracle/argument-sizes.mjs USER.EXE            # ordinal size
 *   node scripts/oracle/argument-sizes.mjs USER.EXE --json
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { entriesOf, readNE } from './ne.mjs';

export const SYSTEM = resolve('oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM');

const STOPS = /^(ret|retf|retn|iret|jmp)\b/;
const JUMPS = /^(j\w+|loop\w*)\s+(?:short\s+|near\s+|word\s+)?0x([0-9a-f]+)$/;

/** The `RETF` sizes reachable from one entry of a segment's code. */
function returnsFrom(path, length, entry) {
  const seen = new Set();
  const work = [entry];
  const sizes = new Set();

  while (work.length) {
    const start = work.pop();

    if (seen.has(start) || start < 0 || start >= length) {
      continue;
    }

    const text = execFileSync(
      'ndisasm',
      ['-b', '16', '-e', String(start), '-o', String(start), '-k', `${start + 1024},${length}`, path],
      { encoding: 'utf8', maxBuffer: 1 << 24 }
    );

    for (const line of text.split('\n')) {
      const match = line.match(/^([0-9A-F]{8})\s+[0-9A-F]+\s+(.*)$/);

      if (!match) {
        continue;
      }

      const at = parseInt(match[1], 16);
      const instruction = match[2].trim();

      if (seen.has(at)) {
        break;
      }

      seen.add(at);

      const jump = instruction.match(JUMPS);

      if (jump) {
        work.push(parseInt(jump[2], 16));
      }

      const retf = instruction.match(/^retf(?:\s+0x([0-9a-f]+))?$/);

      if (retf) {
        sizes.add(retf[1] ? parseInt(retf[1], 16) : 0);
      }

      if (STOPS.test(instruction)) {
        break;
      }
    }

    // A window that ran out without a stop continues where it ended.
    if (seen.size && seen.size > 4096) {
      break;
    }
  }

  return sizes;
}

const REGISTERS = new Set(['ax', 'bx', 'cx', 'dx', 'si', 'di', 'bp', 'es', 'ds']);
const HALVES = { al: 'ax', ah: 'ax', bl: 'bx', bh: 'bx', cl: 'cx', ch: 'cx', dl: 'dx', dh: 'dx' };

/** The one instruction at an offset, as ndisasm reads it. */
function instructionAt(path, length, at) {
  const text = execFileSync(
    'ndisasm',
    ['-b', '16', '-e', String(at), '-o', String(at), '-k', `${at + 16},${length}`, path],
    { encoding: 'utf8' }
  );
  const match = text.split('\n')[0].match(/^([0-9A-F]{8})\s+([0-9A-F]+)\s+(.*)$/);

  return match ? { size: match[2].length / 2, text: match[3].trim() } : null;
}

/**
 * How many words of arguments a function takes off the stack itself before it
 * returns, where it does: some of USER and KERNEL is written by hand, and pops
 * the caller's return address, pops its arguments, pushes the return address
 * back and returns by a bare `RETF` -- `IsWindow` does, and `PostQuitMessage`
 * calls a helper that does it for it. Followed symbolically, from the entry,
 * through pushes, pops and near calls, until the return address is back on
 * top; a compiled function, which leaves its return address alone, takes none
 * this way.
 */
function poppedWords(path, length, entry) {
  // The stack from the top: the far return address, then the arguments.
  const stack = ['ip', 'cs', ...Array.from({ length: 32 }, (_, i) => `arg${i}`)];
  const registers = new Map();
  let at = entry;
  let lifted = false;

  for (let step = 0; step < 64; step++) {
    const one = instructionAt(path, length, at);

    if (!one) {
      return 0;
    }

    const next = at + one.size;
    const { text } = one;
    let match;

    if ((match = text.match(/^pop (\w+)$/)) && REGISTERS.has(match[1])) {
      const value = stack.shift();

      registers.set(match[1], value);
      lifted ||= value === 'ip';
    } else if ((match = text.match(/^push (\w+)$/)) && REGISTERS.has(match[1])) {
      stack.unshift(registers.get(match[1]) ?? '?');
    } else if (text.startsWith('push ')) {
      stack.unshift('?');
    } else if ((match = text.match(/^call 0x([0-9a-f]+)$/))) {
      stack.unshift(`near${next}`);
      at = parseInt(match[1], 16);
      continue;
    } else if ((match = text.match(/^jmp (\w+)$/)) && registers.get(match[1])?.startsWith('near')) {
      at = Number(registers.get(match[1]).slice(4));
      continue;
    } else if (/^(ret|retf|retn|iret|j\w+|loop|call|int)\b/.test(text)) {
      return 0;
    } else if ((match = text.match(/^\w+ (\w+),/))) {
      registers.delete(HALVES[match[1]] ?? match[1]);
    }

    if (lifted && stack[0] === 'ip' && stack[1] === 'cs') {
      const first = stack.find((value) => value.startsWith('arg'));

      return first ? Number(first.slice(3)) : 0;
    }

    at = next;
  }

  return 0;
}

/**
 * The size a validated entry gives itself, if it is one.
 *
 * Much of USER, KERNEL and GDI in 3.1 is reached through a layer that checks
 * the arguments first. Its entry saves `bp`, pushes the address of an error
 * return, checks, then jumps into the function proper -- which may be shared
 * with other entries, and so may return by some other size, or pop its own
 * arguments. The error return is this entry's alone: a `RETF n` that clears
 * exactly its arguments, since returning there means the function never ran.
 * `GetSystemMetrics` pushes one that is `RETF 2`; `GetMessage` one that sets
 * -1 and is `RETF 0Ah`.
 */
function validatedSize(path, length, entry) {
  const first = instructionAt(path, length, entry);
  const second = first && instructionAt(path, length, entry + first.size);
  const third = second && instructionAt(path, length, entry + first.size + second.size);

  if (first?.text !== 'push bp' || second?.text !== 'mov bp,sp') {
    return null;
  }

  const pushed = third?.text.match(/^push word 0x([0-9a-f]+)$/);

  if (!pushed) {
    return null;
  }

  let at = parseInt(pushed[1], 16);

  // The error return sets what the function answers, then returns.
  for (let step = 0; step < 3; step++) {
    const one = instructionAt(path, length, at);
    const retf = one?.text.match(/^retf(?:\s+0x([0-9a-f]+))?$/);

    if (retf) {
      return retf[1] ? parseInt(retf[1], 16) : 0;
    }

    if (!one || !/^(mov|xor|sub|or|cwd)\b/.test(one.text)) {
      return null;
    }

    at += one.size;
  }

  return null;
}

/**
 * Each export's argument size, by ordinal: a number, or `null` where the
 * descent found no `RETF` or more than one size.
 */
export function argumentSizes(file) {
  const ne = readNE(join(SYSTEM, file));
  const scratch = mkdtempSync(join(tmpdir(), 'argsizes-'));
  const out = new Map();

  try {
    const paths = new Map();

    for (const entry of entriesOf(ne)) {
      const segment = ne.segments.find((one) => one.number === entry.segment);

      if (!segment || segment.data !== 'code') {
        continue;
      }

      if (!paths.has(segment.number)) {
        const path = join(scratch, `seg${segment.number}.bin`);

        /* As the loader leaves it: the file's bytes, then zeros up to the
         * segment's allocation. A function can end in them -- the keyboard
         * driver's last `RETF 0002` has its high byte there. */
        const code = new Uint8Array(Math.max(segment.length, segment.minimum));

        code.set(ne.bytes.subarray(segment.at, segment.at + segment.length));
        writeFileSync(path, code);
        paths.set(segment.number, path);
      }

      const path = paths.get(segment.number);
      const validated = validatedSize(path, Math.max(segment.length, segment.minimum), entry.offset);

      if (validated !== null) {
        out.set(entry.ordinal, validated);
        continue;
      }

      const sizes = returnsFrom(path, Math.max(segment.length, segment.minimum), entry.offset);
      const popped = poppedWords(path, Math.max(segment.length, segment.minimum), entry.offset);

      out.set(entry.ordinal, sizes.size === 1 ? [...sizes][0] + popped * 2 : null);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  return out;
}

if (process.argv[1].endsWith('argument-sizes.mjs')) {
  const [file, flag] = process.argv.slice(2);
  const sizes = argumentSizes(file);

  if (flag === '--json') {
    console.log(JSON.stringify(Object.fromEntries(sizes)));
  } else {
    for (const [ordinal, size] of [...sizes].sort((a, b) => a[0] - b[0])) {
      console.log(ordinal, size ?? '?');
    }
  }
}
