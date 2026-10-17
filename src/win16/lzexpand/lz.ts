'use strict';

import { B, D, W, api, text } from '../commdlg/api.js';

/**
 * `LZEXPAND`, Windows' expansion of files `COMPRESS` made, as WinBox's
 * own: each routine of `LZEXPAND.DLL` followed as it is read out
 * (`kb/lzexpand`, `kb/topics/compressed-files.md`). As
 * `crates/winbox-win16/src/lzexpand/`.
 *
 * The library keeps its state in its data segment: a table of sixteen LZ
 * handles, each a global block of the file's own buffers, and the "current"
 * buffers and places the decoder works with, which each call takes from a
 * handle's block and gives back (seg5). Here that state is `State`, one for
 * the system, and the blocks are global memory as the library allocates
 * them, laid out as it lays them out, so a program's heap holds the same.
 * Files are read and written through KERNEL's `_lread`, `_lwrite` and
 * `_llseek`, as the library calls them.
 */

/** LZ handles are 400h on; below, DOS's handles, passed through. */
export const BASE = 0x400;
export const SLOTS = 16;

export const LZERROR_BADINHANDLE = -1;
export const LZERROR_BADOUTHANDLE = -2;
export const LZERROR_READ = -3;
export const LZERROR_WRITE = -4;
export const LZERROR_GLOBALLOC = -5;
export const LZERROR_GLOBLOCK = -6;
export const LZERROR_BADVALUE = -7;
export const LZERROR_UNKNOWNALG = -8;

/** What the decoder's reading of its input answers at the file's end. */
const END = 0x1f4;

/** The ring's length, and the places at its end left out of its spaces. */
const RING = 0x1000;
const KEPT = 0x10;

/** A handle's block (seg2 `00a6`, 18A5h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT`). */
const BLOCK_SIZE = 0x18a5;
const BLOCK_INPUT = 0x11;
const BLOCK_RING = 0x413;
const BLOCK_OUTPUT = 0x1493;
/** Where a handle's state is kept between calls (seg5 `0052`). */
const BLOCK_SAVED = 0x1893;
/** The window of output kept: its size, and its first byte's place in the file. */
const BLOCK_WINDOW_SIZE = BLOCK_SAVED + 0xc;
const BLOCK_WINDOW_START = BLOCK_SAVED + 0xe;

/** The header's signature, at `[0060h]`. */
const SIGNATURE = [0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33];

/** `LZEXPAND`'s data, as its data segment holds it: nought as it loads. */
export class State {
  /** The slot the next LZ handle is looked for from (`[30h]`). */
  next = 0;
  /** Each slot's block, a global handle, or nought (`[10h]`). */
  slots: number[] = new Array(SLOTS).fill(0);
  /** How many `LZStart`s want the copying buffers (`[32h]`). */
  starts = 0;
  /** The copying buffers `LZStart` made, kept while others are current (`[34h]`-`[42h]`). */
  saved = { ring: 0, input: 0, output: 0, inSize: 0, outSize: 0 };
  /** The current buffers: far pointers, and the sizes (`[44h]`, `[48h]`, `[54h]`, `[27Ch]`, `[276h]`). */
  ring = 0;
  input = 0;
  output = 0;
  inSize = 0;
  outSize = 0;
  /** The input's end and the next byte, offsets in its segment (`[4Ch]`, `[50h]`). */
  inEnd = 0;
  inAt = 0;
  /** Whether the byte before the input's first is to be read again (`[27Eh]`). */
  unread = 0;
  /** The output's end and the next place, offsets (`[58h]`, `[5Ch]`). */
  outEnd = 0;
  outAt = 0;
  /** Bytes made so far (`[280h]`). */
  total = 0;
  /** The ring's next place, and the flags byte being read, shifted (`[278h]`, `[27Ah]`). */
  ringAt = 0;
  flags = 0;
  /** The compressed file's size (`[272h]`). */
  fileSize = 0;
  /** The ring's places left out of its spaces (`[270h]`). */
  kept = 0;
}

export function stateOf(system: any): State {
  return (system._lzexpand ??= new State());
}

const sel = (far: number) => (far >>> 16) & 0xffff;
const off = (far: number) => far & 0xffff;
const far = (selector: number, offset: number) => ((selector << 16) | (offset & 0xffff)) >>> 0;

function rd8(system: any, at: number) {
  return system.machine.cpu.core.read8(sel(at), off(at));
}

function wr8(system: any, at: number, value: number) {
  system.machine.cpu.core.write8(sel(at), off(at), value & 0xff);
}

function rd16(system: any, at: number) {
  return rd8(system, at) | (rd8(system, (at & 0xffff0000) | ((at + 1) & 0xffff)) << 8);
}

function wr16(system: any, at: number, value: number) {
  wr8(system, at, value);
  wr8(system, (at & 0xffff0000) | ((at + 1) & 0xffff), value >> 8);
}

function rd32(system: any, at: number) {
  return rd16(system, at) | (rd16(system, (at & 0xffff0000) | ((at + 2) & 0xffff)) << 16) | 0;
}

function wr32(system: any, at: number, value: number) {
  wr16(system, at, value);
  wr16(system, (at & 0xffff0000) | ((at + 2) & 0xffff), value >>> 16);
}

const plus = (at: number, n: number) => far(sel(at), off(at) + n);
const s16 = (value: number) => (value << 16) >> 16;

/** KERNEL's calls, as the library makes them. */
async function llseek(system: any, handle: number, offset: number, origin: number) {
  return (await api(system, 'KERNEL', '_llseek', [W(handle), D(offset), W(origin)])).value | 0;
}

/** `_lread`'s answer, the word as it is: FFFFh for an error. */
async function lread(system: any, handle: number, to: number, count: number) {
  return (await api(system, 'KERNEL', '_lread', [W(handle), D(to), W(count)])).value & 0xffff;
}

/** `_lwrite`'s answer, the word as it is: FFFFh for an error. */
async function lwrite(system: any, handle: number, from: number, count: number) {
  return (await api(system, 'KERNEL', '_lwrite', [W(handle), D(from), W(count)])).value & 0xffff;
}

async function lclose(system: any, handle: number) {
  await api(system, 'KERNEL', '_lclose', [W(handle)]);
}

export async function globalAlloc(system: any, flags: number, size: number) {
  return (await api(system, 'KERNEL', 'GlobalAlloc', [W(flags), D(size)])).value & 0xffff;
}

export async function globalLock(system: any, handle: number) {
  return (await api(system, 'KERNEL', 'GlobalLock', [W(handle)])).value >>> 0;
}

export async function globalUnlock(system: any, handle: number) {
  await api(system, 'KERNEL', 'GlobalUnlock', [W(handle)]);
}

export async function globalFree(system: any, handle: number) {
  await api(system, 'KERNEL', 'GlobalFree', [W(handle)]);
}

/** A file's 14-byte header, as seg8 `00aa` reads it. */
type Header = { magic: number[]; algorithm: number; last: number; size: number; fileSize: number };

/**
 * A file's header (seg8 `00aa`): the file's size kept in the state (`[272h]`),
 * then 14 bytes from its start. 1; -1 where it cannot be sought or read; -3
 * where it is shorter.
 */
async function readHeader(system: any, handle: number): Promise<[number, Header | null]> {
  const lz = stateOf(system);
  const size = await llseek(system, handle, 0, 2);

  lz.fileSize = size;

  if (size < 0) {
    return [-1, null];
  }

  if ((await llseek(system, handle, 0, 0)) !== 0) {
    return [-1, null];
  }

  const read = await api(system, 'KERNEL', '_lread', [W(handle), B(new Array(14).fill(0)), W(14)]);
  const count = s16(read.value);

  if (count !== 14) {
    return [count === -1 ? -1 : -3, null];
  }

  const bytes = read.buffers[0];

  return [
    1,
    {
      magic: bytes.slice(0, 8),
      algorithm: bytes[8],
      last: bytes[9],
      size: bytes[10] | (bytes[11] << 8) | (bytes[12] << 16) | (bytes[13] << 24) | 0,
      fileSize: size,
    },
  ];
}

/** Whether a header's signature is COMPRESS's, by USER's `lstrcmp` (seg8 `01a2`). */
async function compressed(system: any, header: Header | null) {
  const magic = header ? header.magic : new Array(8).fill(0);
  const answer = await api(system, 'USER', 'lstrcmp', [text(magic), text(SIGNATURE)]);

  return (answer.value & 0xffff) === 0;
}

/** Whether a header's reading failed on a file of a header's length or more: -1 is answered (seg2 `0027`). */
function unreadable(system: any, result: number) {
  return result !== 1 && stateOf(system).fileSize >= 14;
}

/** A block's buffers made current (seg5 `0000`). */
function bind(system: any, block: number) {
  const lz = stateOf(system);

  lz.input = plus(block, BLOCK_INPUT);
  lz.output = plus(block, BLOCK_OUTPUT);
  lz.ring = plus(block, BLOCK_RING);
  lz.inSize = 0x400;
  lz.outSize = 0x400;
}

/** The current state kept in a block (seg5 `0052`). */
function save(system: any, block: number) {
  const lz = stateOf(system);
  const at = plus(block, BLOCK_SAVED);
  const fill = (lz.outAt - off(lz.output)) & 0xffff;

  wr16(system, at, lz.flags);
  wr16(system, plus(at, 2), lz.ringAt);
  wr16(system, plus(at, 4), lz.inAt - off(lz.input));
  wr16(system, plus(at, 6), lz.inEnd - off(lz.input));
  wr16(system, plus(at, 8), lz.unread);
  wr16(system, plus(at, 0xa), fill);
  wr16(system, plus(at, 0xc), lz.outEnd - off(lz.output));
  wr32(system, plus(at, 0xe), lz.total - fill);
}

/** A block's state made current (seg5 `00d0`). */
function restore(system: any, block: number) {
  const lz = stateOf(system);
  const at = plus(block, BLOCK_SAVED);

  bind(system, block);
  lz.inAt = (off(lz.input) + rd16(system, plus(at, 4))) & 0xffff;
  lz.inEnd = (off(lz.input) + rd16(system, plus(at, 6))) & 0xffff;
  lz.unread = rd16(system, plus(at, 8));
  lz.outAt = (off(lz.output) + rd16(system, plus(at, 0xa))) & 0xffff;
  lz.outEnd = (off(lz.output) + rd16(system, plus(at, 0xc))) & 0xffff;
  lz.fileSize = rd32(system, plus(block, 9));
  lz.total = (rd32(system, plus(block, BLOCK_WINDOW_START)) + s16(rd16(system, plus(at, 0xa)))) | 0;
  lz.flags = rd16(system, at);
  lz.ringAt = rd16(system, plus(at, 2));
  lz.kept = KEPT;
}

/**
 * The input's buffer filled again (seg6 `0000`): the byte before its end
 * kept before its first, and as many as fit read after it. The first byte
 * answered, or the one kept where a byte was to be read again. 1; -1 where
 * the read fails; 1F4h at the file's end.
 */
async function refill(system: any, handle: number): Promise<[number, number]> {
  const lz = stateOf(system);
  const input = lz.input;

  wr8(system, input, rd8(system, far(sel(input), lz.inEnd - 1)));

  const count = await lread(system, handle, plus(input, 1), lz.inSize);

  if (count !== lz.inSize) {
    if (count === 0xffff) {
      return [-1, 0];
    }

    if (count === 0) {
      return [END, 0];
    }

    lz.inEnd = (off(input) + count + 1) & 0xffff;
  }

  lz.inAt = (off(input) + 1) & 0xffff;

  if (lz.unread) {
    lz.unread = 0;

    return [1, rd8(system, input)];
  }

  const byte = rd8(system, far(sel(input), lz.inAt));

  lz.inAt = (lz.inAt + 1) & 0xffff;

  return [1, byte];
}

/** The next byte of input: from the buffer, or by `refill`. */
async function next(system: any, handle: number): Promise<[number, number]> {
  const lz = stateOf(system);

  if (lz.inEnd > lz.inAt) {
    const byte = rd8(system, far(sel(lz.input), lz.inAt));

    lz.inAt = (lz.inAt + 1) & 0xffff;

    return [1, byte];
  }

  return refill(system, handle);
}

/**
 * The output's buffer written out, full, and a byte put at its start (seg6
 * `00a4`). Into `handle`, or nowhere for -2, where the buffer is a window
 * of what was made last. 1; -2 where `_lwrite` fails; -4 where it writes
 * less.
 */
async function flush(system: any, byte: number, handle: number) {
  const lz = stateOf(system);
  const count = (lz.outAt - off(lz.output)) & 0xffff;

  lz.outAt = off(lz.output);

  if ((handle & 0xffff) !== 0xfffe) {
    const written = await lwrite(system, handle, lz.output, count);

    if (written !== count) {
      return written === 0xffff ? LZERROR_BADOUTHANDLE : LZERROR_WRITE;
    }
  }

  wr8(system, far(sel(lz.output), lz.outAt), byte);
  lz.outAt = (lz.outAt + 1) & 0xffff;

  return 1;
}

/** A byte made: put out, and into the ring. */
async function emit(system: any, byte: number, handle: number) {
  const lz = stateOf(system);
  let result = 1;

  if (lz.outAt >= lz.outEnd) {
    lz.total = (lz.total + 1) | 0;
    result = await flush(system, byte, handle);
  } else {
    wr8(system, far(sel(lz.output), lz.outAt), byte);
    lz.outAt = (lz.outAt + 1) & 0xffff;
    lz.total = (lz.total + 1) | 0;
  }

  if (result !== 1) {
    return result;
  }

  wr8(system, far(sel(lz.ring), off(lz.ring) + lz.ringAt), byte);
  lz.ringAt = (lz.ringAt + 1) & 0xfff;

  return 1;
}

/**
 * The decoder (seg9 `0000`): the stream from `input` expanded into
 * `output`, until more than `limit` bytes are made or the input ends.
 * Begun again, `restart`, from the 14th byte, the ring all spaces but its
 * last 16 bytes. 1; an error of the reading or writing.
 */
async function decode(
  system: any,
  input: number,
  output: number,
  limit: number,
  restart: number
): Promise<number> {
  const lz = stateOf(system);

  lz.kept = KEPT;

  if (restart === 1) {
    if ((await llseek(system, input, 14, 0)) !== 14) {
      return LZERROR_BADINHANDLE;
    }

    if ((output & 0xffff) !== 0xfffe && (await llseek(system, output, 0, 0)) !== 0) {
      return LZERROR_BADOUTHANDLE;
    }

    lz.inEnd = (off(lz.input) + lz.inSize + 1) & 0xffff;
    lz.inAt = lz.inEnd;
    lz.outEnd = (off(lz.output) + lz.outSize) & 0xffff;
    lz.outAt = off(lz.output);
    lz.total = 0;
    lz.unread = 0;

    for (let i = 0; i < RING - lz.kept; i++) {
      wr8(system, far(sel(lz.ring), off(lz.ring) + i), 0x20);
    }

    lz.flags = 0;
    lz.ringAt = RING - lz.kept;
  }

  let [result, byte] = await next(system, input);

  if (result !== 1 && result !== END) {
    return result;
  }

  for (;;) {
    if (result === END) {
      return 1;
    }

    if (lz.total > limit) {
      /* One too many read: read it again next time. */
      if (lz.inAt === ((off(lz.input) + 1) & 0xffff)) {
        lz.unread = 1;
      } else {
        lz.inAt = (lz.inAt - 1) & 0xffff;
      }

      return 1;
    }

    lz.flags = (lz.flags >>> 1) & 0xffff;

    if (!(lz.flags & 0x100)) {
      lz.flags = 0xff00 | byte;
      [result, byte] = await next(system, input);

      if (result !== 1) {
        return LZERROR_READ;
      }
    }

    if (lz.flags & 1) {
      result = await emit(system, byte, output);

      if (result !== 1) {
        return result;
      }
    } else {
      const [read, high] = await next(system, input);

      if (read !== 1) {
        return LZERROR_READ;
      }

      const place = ((high & 0xf0) << 4) | byte;
      const count = (high & 0x0f) + 3;

      for (let i = 0; i < count; i++) {
        const copied = rd8(system, far(sel(lz.ring), off(lz.ring) + ((place + i) & 0xfff)));

        result = await emit(system, copied, output);

        if (result !== 1) {
          return result;
        }
      }
    }

    [result, byte] = await next(system, input);

    if (result !== 1 && result !== END) {
      return result;
    }
  }
}

/**
 * A plain file copied whole (seg7 `0000`), through the input's buffer. 1;
 * -1 where it cannot be sought or read; -2 or -4 where it cannot be written.
 */
async function plainCopy(system: any, input: number, output: number) {
  const lz = stateOf(system);

  if ((await llseek(system, input, 0, 0)) !== 0) {
    return LZERROR_BADINHANDLE;
  }

  if ((output & 0xffff) !== 0xfffe && (await llseek(system, output, 0, 0)) !== 0) {
    return LZERROR_BADOUTHANDLE;
  }

  lz.inEnd = (off(lz.input) + lz.inSize + 1) & 0xffff;
  lz.inAt = lz.inEnd;
  lz.unread = 0;
  lz.outEnd = (off(lz.output) + lz.outSize) & 0xffff;
  lz.outAt = off(lz.output);
  lz.total = 0;

  for (;;) {
    const count = await lread(system, input, lz.input, lz.inSize);

    if (count === 0 || count === 0xffff) {
      return count === 0xffff ? LZERROR_BADINHANDLE : 1;
    }

    const written = await lwrite(system, output, lz.input, count);

    if (written !== count) {
      return written === 0xffff ? LZERROR_BADOUTHANDLE : LZERROR_WRITE;
    }

    lz.total = (lz.total + written) | 0;

    if (count !== lz.inSize) {
      return 1;
    }
  }
}

/** A DOS call, AX and CX as given, BX the handle: the carry, CX and DX after. */
async function dos(system: any, ax: number, bx: number, cx: number, dx: number) {
  const core = system.machine.cpu.core;
  const saved = { ax: core.ax, bx: core.bx, cx: core.cx, dx: core.dx, carry: core.flags.carry };

  core.ax = ax;
  core.bx = bx;
  core.cx = cx;
  core.dx = dx;
  await api(system, 'KERNEL', 'Dos3Call', []);

  const after = { carry: !!core.flags.carry, ax: core.ax, cx: core.cx, dx: core.dx };

  core.ax = saved.ax;
  core.bx = saved.bx;
  core.cx = saved.cx;
  core.dx = saved.dx;
  core.flags.carry = saved.carry;

  return after;
}

/**
 * The source's time and date given to what was made (seg10 `02a8`): DOS
 * 5700h, then 5701h. 1; -1 where the first fails, -2 the second.
 */
async function copyStamp(system: any, input: number, output: number) {
  const got = await dos(system, 0x5700, input, 0, 0);

  if (got.carry) {
    return LZERROR_BADINHANDLE;
  }

  const set = await dos(system, 0x5701, output, got.cx, got.dx);

  return set.carry ? LZERROR_BADOUTHANDLE : 1;
}

/**
 * A file copied, expanded where it is compressed (seg7 `00f4`): the
 * copying `LZCopy` does once it has DOS's handle.
 */
async function copyFile(system: any, input: number, output: number) {
  const lz = stateOf(system);
  const [read, header] = await readHeader(system, input);

  if (unreadable(system, read)) {
    return LZERROR_BADINHANDLE;
  }

  const packed = await compressed(system, header);
  let result: number;

  if (packed) {
    result =
      header!.algorithm !== 0x41
        ? LZERROR_UNKNOWNALG
        : await decode(system, input, output, header!.size - 1, 1);
  } else {
    result = await plainCopy(system, input, output);
  }

  if (result !== 1) {
    return result;
  }

  const flushed = await flush(system, 0x46, output);

  if (flushed !== 1) {
    return flushed;
  }

  result = await copyStamp(system, input, output);

  if (result !== 1) {
    return result;
  }

  if (packed && lz.total !== header!.size) {
    return LZERROR_READ;
  }

  return result;
}

/** The copying buffers allocated (seg1 `0000`): 1, or nought where they cannot be. */
async function allocate(system: any) {
  const lz = stateOf(system);

  if (lz.ring) {
    return 1;
  }

  const ring = await globalAlloc(system, 0x2040, 0x1080);

  lz.ring = far(ring, 0);

  if (!ring) {
    return 0;
  }

  lz.inSize = 0x8000;
  lz.outSize = 0x8000;

  while (lz.outSize) {
    const input = await globalAlloc(system, 0x2040, lz.inSize + 1);

    lz.input = far(input, 0);

    if (input) {
      const output = await globalAlloc(system, 0x2040, lz.outSize);

      lz.output = far(output, 0);

      if (output) {
        return 1;
      }

      await globalFree(system, input);
    }

    lz.outSize -= 0x400;
    lz.inSize -= 0x400;
  }

  await globalFree(system, ring);

  return 0;
}

/** The copying buffers let go (seg1 `00b2`). */
async function release(system: any) {
  const lz = stateOf(system);

  for (const key of ['ring', 'input', 'output'] as const) {
    if (lz[key]) {
      await globalFree(system, sel(lz[key]));
      lz[key] = 0;
    }
  }
}

function current(system: any) {
  const lz = stateOf(system);

  lz.ring = lz.saved.ring;
  lz.input = lz.saved.input;
  lz.output = lz.saved.output;
  lz.inSize = lz.saved.inSize;
  lz.outSize = lz.saved.outSize;
}

function keep(system: any) {
  const lz = stateOf(system);

  lz.saved = {
    ring: lz.ring,
    input: lz.input,
    output: lz.output,
    inSize: lz.inSize,
    outSize: lz.outSize,
  };
}

/** `LZStart` (seg4 `0000`): the copying buffers made, the first time. 1, or -5. */
export async function lzStart(system: any) {
  const lz = stateOf(system);

  current(system);

  if (lz.starts === 0) {
    if ((await allocate(system)) !== 1) {
      return LZERROR_GLOBALLOC;
    }

    keep(system);
  }

  lz.starts = lz.starts === 0xffff ? 0xffff : lz.starts + 1;

  return 1;
}

/** `LZDone` (seg4 `00a6`): the copying buffers let go with the last start. */
export async function lzDone(system: any) {
  const lz = stateOf(system);

  if (lz.starts === 0) {
    return;
  }

  lz.starts--;

  if (lz.starts === 0) {
    current(system);
    await release(system);
    keep(system);
  }
}

/** The DOS handle an LZ handle reads, or an error, for `LZCopy` (seg4 `017a`). */
async function dosHandleOf(system: any, handle: number): Promise<[number, number]> {
  const lz = stateOf(system);
  const block = lz.slots[handle - BASE] ?? 0;

  if (!block) {
    return [LZERROR_BADINHANDLE, 0];
  }

  const at = await globalLock(system, block);

  if (!at) {
    return [LZERROR_GLOBLOCK, 0];
  }

  const dosHandle = rd16(system, at);

  await globalUnlock(system, block);

  return [1, dosHandle];
}

/** `LZCopy` (seg4 `015c`): a file copied into another, expanded where it is compressed. */
export async function lzCopy(system: any, source: number, dest: number) {
  const started = await lzStart(system);

  if (started !== 1) {
    return started;
  }

  let input = s16(source);

  if (input >= BASE) {
    const [found, handle] = await dosHandleOf(system, input);

    if (found !== 1) {
      await lzDone(system);

      return found;
    }

    input = handle;
  }

  const copied = await copyFile(system, input, dest);

  const result = copied !== 1 ? copied : stateOf(system).total;
  await lzDone(system);

  return result;
}

/**
 * `LZInit` (seg2 `0000`): a DOS handle of a file COMPRESS made given an LZ
 * handle, its block made; another file's handle answered as it is, back at
 * its start.
 */
export async function lzInit(system: any, handle: number) {
  const lz = stateOf(system);
  const [read, header] = await readHeader(system, handle);

  if (unreadable(system, read)) {
    return LZERROR_BADINHANDLE;
  }

  if (read !== 1 || !(await compressed(system, header))) {
    if ((await llseek(system, handle, 0, 0)) !== 0) {
      return LZERROR_BADINHANDLE;
    }

    return handle;
  }

  if (header!.algorithm !== 0x41) {
    return LZERROR_UNKNOWNALG;
  }

  const first = lz.next;

  while (lz.slots[lz.next]) {
    lz.next = lz.next + 1 >= SLOTS ? 0 : lz.next + 1;

    if (lz.next === first) {
      return LZERROR_GLOBALLOC;
    }
  }

  const slot = lz.next;
  const block = await globalAlloc(system, 0x42, BLOCK_SIZE);

  if (!block) {
    return LZERROR_GLOBALLOC;
  }

  const at = await globalLock(system, block);

  if (!at) {
    await globalFree(system, block);

    return LZERROR_GLOBLOCK;
  }

  wr16(system, at, handle);
  wr8(system, plus(at, 2), header!.algorithm);
  wr16(system, plus(at, 3), 0);
  wr32(system, plus(at, 5), header!.size);
  wr32(system, plus(at, 9), header!.fileSize);
  wr32(system, plus(at, 0xd), 0);
  lz.slots[slot] = block;
  bind(system, at);
  lz.inEnd = (off(lz.input) + lz.inSize + 1) & 0xffff;
  lz.inAt = lz.inEnd;
  lz.unread = 0;
  lz.outEnd = (off(lz.output) + lz.outSize) & 0xffff;
  lz.outAt = off(lz.output);
  lz.total = 0;
  save(system, at);
  await globalUnlock(system, block);
  lz.next = lz.next + 1 >= SLOTS ? 0 : lz.next + 1;

  return slot + BASE;
}

/** A handle out of range: negative, or past the sixteenth LZ handle. */
const outOfRange = (handle: number) => handle < 0 || handle >= BASE + SLOTS;

/** `LZSeek` (seg2 `02ee`): an LZ handle's place in the expanded file set. */
export async function lzSeek(system: any, handle: number, offset: number, origin: number) {
  const lz = stateOf(system);
  const h = s16(handle);

  if (outOfRange(h)) {
    return LZERROR_BADINHANDLE;
  }

  if (h < BASE) {
    return llseek(system, h, offset, origin);
  }

  const block = lz.slots[h - BASE];
  const at = await globalLock(system, block);

  if (!at) {
    return LZERROR_GLOBLOCK;
  }

  let to: number;

  switch (s16(origin)) {
    case 0:
      to = 0;
      break;
    case 1:
      to = rd32(system, plus(at, 0xd));
      break;
    case 2:
      to = rd32(system, plus(at, 5));
      break;
    default:
      await globalUnlock(system, block);

      return LZERROR_BADVALUE;
  }

  to = (to + offset) | 0;

  if (to < 0) {
    await globalUnlock(system, block);

    return LZERROR_BADVALUE;
  }

  wr32(system, plus(at, 0xd), to);
  await globalUnlock(system, block);

  return to;
}

/** `LZRead` (seg2 `03d6`): bytes of the expanded file, from an LZ handle's place. */
export async function lzRead(system: any, handle: number, buffer: number, count: number) {
  const lz = stateOf(system);
  const h = s16(handle);
  let wanted = s16(count);
  let done = 0;

  if (outOfRange(h)) {
    return LZERROR_BADINHANDLE;
  }

  if (wanted < 0) {
    return LZERROR_BADVALUE;
  }

  if (h < BASE) {
    return s16(await lread(system, h, buffer, wanted));
  }

  const block = lz.slots[h - BASE];
  const at = await globalLock(system, block);

  if (!at) {
    return LZERROR_GLOBLOCK;
  }

  const position = () => rd32(system, plus(at, 0xd));
  const size = () => rd32(system, plus(at, 5));
  const windowStart = () => rd32(system, plus(at, BLOCK_WINDOW_START));
  let restart: number;

  if (!(rd8(system, plus(at, 3)) & 1)) {
    wr8(system, plus(at, 3), rd8(system, plus(at, 3)) | 1);
    restart = 1;
  } else {
    restart = position() < windowStart() ? 1 : 0;
  }

  restore(system, at);

  let to = buffer;

  while (wanted > 0 && position() < size()) {
    const filled = s16((lz.outAt - off(lz.output)) & 0xffff);
    const from = (position() - windowStart()) | 0;
    const windowSize = s16(rd16(system, plus(at, BLOCK_WINDOW_SIZE)));
    let index = from < windowSize ? s16(from & 0xffff) : -1;

    if (index >= 0) {
      let copied = 0;

      while (filled > index && wanted > 0) {
        wr8(system, to, rd8(system, plus(at, BLOCK_OUTPUT + index)));
        to = plus(to, 1);
        copied++;
        wanted--;
        index++;
      }

      wr32(system, plus(at, 0xd), (position() + copied) | 0);
      done += copied;
    }

    if (wanted <= 0 || !(position() < size())) {
      break;
    }

    let target: number;

    if (restart) {
      target = Math.max(0, (position() - lz.kept) | 0);
    } else {
      target = (windowSize + windowStart() - lz.kept + filled) | 0;
    }

    let end = (position() + wanted) | 0;

    if (end > ((size() - 1) | 0)) {
      end = (size() - 1) | 0;
    }

    if (end > target) {
      end = target;
    }

    lz.outAt = off(lz.output);

    const result =
      rd8(system, plus(at, 2)) !== 0x41
        ? LZERROR_UNKNOWNALG
        : await decode(system, rd16(system, at), 0xfffe, end, restart);

    if (result !== 1) {
      await globalUnlock(system, block);

      return result;
    }

    const made = s16((lz.outAt - off(lz.output)) & 0xffff);

    if (made <= 0) {
      await globalUnlock(system, block);

      return LZERROR_READ;
    }

    wr32(system, plus(at, BLOCK_WINDOW_START), (lz.total - made) | 0);

    if (lz.total < end) {
      await globalUnlock(system, block);

      return LZERROR_READ;
    }

    restart = 0;
  }

  save(system, at);
  await globalUnlock(system, block);

  return done;
}

/** `LZClose` (seg2 `06f0`): a handle let go, its file closed. */
export async function lzClose(system: any, handle: number) {
  const lz = stateOf(system);
  const h = s16(handle);

  if (outOfRange(h)) {
    return;
  }

  if (h < BASE) {
    await lclose(system, h);

    return;
  }

  const block = lz.slots[h - BASE];

  lz.slots[h - BASE] = 0;

  const at = await globalLock(system, block);

  if (!at) {
    return;
  }

  await lclose(system, rd16(system, at));
  await globalUnlock(system, block);
  await globalFree(system, block);
}

/** Where a path's last part begins, after its last `\`, `/` or `:` (seg10 `0000`). */
function lastPart(name: number[]) {
  let at = 0;

  for (let i = 0; i < name.length && name[i]; i++) {
    if (name[i] === 0x2f || name[i] === 0x5c || name[i] === 0x3a) {
      at = i + 1;
    }
  }

  return at;
}

/** Where a name's extension begins, after its period; -1 for none (seg10 `004e`). */
export function extensionAt(name: number[]) {
  let at = lastPart(name);

  if (name[at]) {
    while (name[at] && name[at] !== 0x2e) {
      at++;
    }
  }

  return name[at] === 0x2e ? at + 1 : -1;
}

const strlen = (name: number[], at = 0) => {
  let n = 0;

  while (name[at + n]) {
    n++;
  }

  return n;
};

/**
 * A name as COMPRESS names what it makes (seg10 `0124`): its extension's
 * last character an underscore, one added to an extension shorter than
 * three, `._` to a name with none.
 */
export function compressedName(name: number[]) {
  const ext = extensionAt(name);
  const end = strlen(name);
  const out = name.slice(0, end);

  if (ext >= 0) {
    const length = strlen(name, ext);

    if (length >= 3) {
      out[ext + length - 1] = 0x5f;
    } else {
      out.push(0x5f);
    }
  } else {
    out.push(0x2e, 0x5f);
  }

  return out;
}

const isUpper = (c: number) => c >= 0x41 && c <= 0x5a;
const isLower = (c: number) => c >= 0x61 && c <= 0x7a;

/**
 * An expanded file's name (seg10 `01b6`): the underscore ending its
 * extension the header's last character, in the case of the name's first
 * letter; a period left alone at its end taken off.
 */
async function expandedName(system: any, name: number[], last: number) {
  const ext = extensionAt(name);

  if (ext < 0) {
    return name;
  }

  let c = last & 0xff;

  if (isUpper(c) || isLower(c)) {
    let at = 0;

    /* The first ASCII letter of the whole path, bytes past 7Fh skipped. */
    while (name[at] && !(name[at] < 0x80 && (isUpper(name[at]) || isLower(name[at])))) {
      at++;
    }

    const letter = name[at] ?? 0;

    if ((await api(system, 'USER', 'IsCharLower', [W(letter)])).value & 0xffff) {
      if (isUpper(c)) {
        c += 0x20;
      }
    } else if ((await api(system, 'USER', 'IsCharUpper', [W(letter)])).value & 0xffff) {
      if (isLower(c)) {
        c -= 0x20;
      }
    }
  }

  const out = name.slice();
  const length = strlen(out, ext);

  if (s16(length) > 0 && out[ext + length - 1] === 0x5f) {
    out[ext + length - 1] = c;
  }

  if (!out[ext] && out[ext - 1] === 0x2e) {
    out[ext - 1] = 0;
  }

  return out;
}

/** A string at a far pointer, with its nought. */
function stringAt(system: any, at: number) {
  const bytes: number[] = [];

  for (let i = 0; ; i++) {
    const byte = rd8(system, plus(at, i));

    bytes.push(byte);

    if (!byte) {
      return bytes;
    }
  }
}

/** `GetExpandedName` (seg2 `01bc`): the name a compressed file had. */
export async function getExpandedName(system: any, source: number, buffer: number) {
  const name = stringAt(system, source);
  const opened = await api(system, 'KERNEL', 'OpenFile', [
    text(name.slice(0, -1)),
    B(new Array(136).fill(0)),
    W(0),
  ]);
  const handle = s16(opened.value);

  if (handle === -1) {
    return LZERROR_BADINHANDLE;
  }

  const [read, header] = await readHeader(system, handle);

  if (unreadable(system, read)) {
    return LZERROR_BADINHANDLE;
  }

  await lclose(system, handle);

  let out = name;

  if (read === 1 && (await compressed(system, header))) {
    out = await expandedName(system, name, header!.last);
  }

  out.forEach((byte, i) => wr8(system, plus(buffer, i), byte));
  wr8(system, plus(buffer, strlen(out)), 0);

  return 1;
}

/**
 * `LZOpenFile` (seg2 `0262`): a file opened by `OpenFile`, or its
 * compressed name's where it is not there, and given to `LZInit` where it
 * is opened only to be read.
 */
export async function lzOpenFile(system: any, file: number, of: number, style: number) {
  /* Copied into the library's own 128 bytes (`[1E0h]`). */
  let name = stringAt(system, file).slice(0, -1);
  let handle = s16((await api(system, 'KERNEL', 'OpenFile', [text(name), D(of), W(style)])).value);

  if (handle === -1 && rd16(system, plus(of, 2)) === 2) {
    name = compressedName(name);
    handle = s16((await api(system, 'KERNEL', 'OpenFile', [text(name), D(of), W(style)])).value);
  }

  if (handle === -1 || style & 0xff0f) {
    return handle;
  }

  const result = await lzInit(system, handle);

  if (result < 0) {
    await lclose(system, handle);
  }

  return result;
}
