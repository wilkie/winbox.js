'use strict';

import { ordinalFor } from '../linker.js';
import { segmentSelector } from '../selectors.js';
import { DWORD, UINT } from '../types.js';
import {
  IsBadCodePtr,
  IsBadHugeReadPtr,
  IsBadHugeWritePtr,
  IsBadStringPtr,
} from '../kernel/bad-pointers.js';
import { ansiUpperByte } from '../user/ansi.js';
import { renameFile } from '../../dos/syscall/files.js';
import { tellFileChange } from '../kernel/FileCdr.js';

/**
 * MMSYSTEM's buffered file I/O, the `mmio` functions, as **read out** of
 * `MMSYSTEM.DLL` seg7 (`0`-`188f`), its handles seg4 `2e6`-`350` and seg1
 * `1e8`, and **recorded** by the `mmio` probe. As the Rust engine's
 * `mmsystem/mmio.rs`, which says more.
 *
 * * A file open is a block of MMSYSTEM's data: an `MMIOINFO`, 42h bytes.
 *   The handle is its offset, and the structure an I/O procedure is handed
 *   is MMSYSTEM's data segment at it.
 * * The I/O procedure is found by a four-character code: the structure's,
 *   or the extension before a `+` in the name, else `DOS `; among those
 *   installed, the task's first, then the global ones. `DOS ` and `MEM `
 *   are installed to begin with, and cannot be removed; a code found
 *   nowhere is the DOS procedure's.
 * * Reads and writes go through the buffer while they fit it, else
 *   straight to the procedure. A seek inside what the buffer holds moves
 *   `pchNext` only. `SEEK_END` is the end less the offset.
 *
 * The handles' numbers are winbox.js's own, blocks from `8006h` in steps of
 * 50h. The DOS and memory procedures are winbox.js's, at MMSYSTEM's
 * ordinals 1200 and 1201, which Windows leaves empty and `GetProcAddress`
 * does not answer.
 */

const INFO_SIZE = 0x42;
const FLAGS = 0x00;
const FCC = 0x04;
const PROC = 0x08;
const ERROR = 0x0c;
const TASK = 0x0e;
const CCH = 0x10;
const BUFFER = 0x14;
const NEXT = 0x18;
const END_READ = 0x1c;
const END_WRITE = 0x20;
const BUF_OFFSET = 0x24;
const DISK_OFFSET = 0x28;
const INFO0 = 0x2c;
const HANDLE = 0x40;

const CK_SIZE = 0x14;
const CK_ID = 0x00;
const CK_LENGTH = 0x04;
const CK_TYPE = 0x08;
const CK_DATA = 0x0c;
const CK_FLAGS = 0x10;

const MMIO_CREATE = 0x1000;
const MMIO_PARSE = 0x0100;
const MMIO_DELETE = 0x0200;
const MMIO_EXIST = 0x4000;
const MMIO_ALLOCBUF = 0x00010000;
const MMIO_GETTEMP = 0x00020000;
const MMIO_DIRTY = 0x10000000;
const MMIO_EMPTYBUF = 0x10;
const MMIO_FHOPEN = 0x10;
const MMIO_TOUPPER = 0x10;
const MMIO_FINDCHUNK = 0x10;
const MMIO_FINDRIFF = 0x20;
const MMIO_FINDLIST = 0x40;
const MMIO_CREATERIFF = 0x20;
const MMIO_CREATELIST = 0x40;
const MMIO_INSTALLPROC = 0x00010000;
const MMIO_REMOVEPROC = 0x00020000;
const MMIO_FINDPROC = 0x00040000;
const MMIO_GLOBALPROC = 0x10000000;

const MMIOM_READ = 0;
const MMIOM_WRITE = 1;
const MMIOM_SEEK = 2;
const MMIOM_OPEN = 3;
const MMIOM_CLOSE = 4;
const MMIOM_WRITEFLUSH = 5;
const MMIOM_RENAME = 6;

const MMSYSERR_INVALHANDLE = 5;
const MMSYSERR_INVALFLAG = 10;
const MMSYSERR_INVALPARAM = 11;
const MMIOERR_FILENOTFOUND = 0x101;
const MMIOERR_OUTOFMEMORY = 0x102;
const MMIOERR_CANNOTCLOSE = 0x104;
const MMIOERR_CANNOTREAD = 0x105;
const MMIOERR_CANNOTWRITE = 0x106;
const MMIOERR_CANNOTSEEK = 0x107;
const MMIOERR_CANNOTEXPAND = 0x108;
const MMIOERR_CHUNKNOTFOUND = 0x109;
const MMIOERR_UNBUFFERED = 0x10a;

const fourccOf = (text: string) =>
  (text.charCodeAt(0) |
    (text.charCodeAt(1) << 8) |
    (text.charCodeAt(2) << 16) |
    (text.charCodeAt(3) << 24)) >>>
  0;

const FOURCC_DOS = fourccOf('DOS ');
const FOURCC_MEM = fourccOf('MEM ');
const FOURCC_RIFF = fourccOf('RIFF');
const FOURCC_LIST = fourccOf('LIST');

const DEFAULT_BUFFER = 0x2000;
const KIND_FILE = 5;
const BLOCK_FIRST = 0x8006;
const BLOCK_STEP = 0x50;
const PAD_BYTE = 0x8000;
const OFSTRUCT_AT = 0x7f00;

export const DOS_ORDINAL = 1200;
export const MEM_ORDINAL = 1201;

const FAILED = 0xffffffff;

/** An I/O procedure installed; `serial` is where its block stands in MMSYSTEM's list of handles, the latest highest. */
interface Installed {
  fcc: number;
  procedure: number;
  task: number;
  fixed: boolean;
  serial: number;
}

/**
 * The blocks open, each by where it stands in MMSYSTEM's list of handles
 * (null where free), and the procedures installed, the latest first.
 * MMSYSTEM puts each handle it makes at its list's head (seg4 `2e6`); here
 * a block and a procedure carry the count of handles made before them.
 */
interface State {
  blocks: (number | null)[];
  installed: Installed[] | null;
  serial: number;
}

function stateOf(system: any): State {
  return (system._mmio ??= { blocks: [], installed: null, serial: 0 });
}

function nextSerial(system: any) {
  return ++stateOf(system).serial;
}

function core(system: any) {
  return system.machine.cpu.core;
}

/** MMSYSTEM's data segment, as a far pointer's selector. */
function data(system: any) {
  return ((system._moduleData?.MMSYSTEM ?? 0) << 16) >>> 0;
}

/** A far pointer `offset` bytes on, within its segment. */
function at(far: number, offset: number) {
  return ((far & 0xffff0000) | ((far + offset) & 0xffff)) >>> 0;
}

function read8(system: any, far: number) {
  return core(system).read8((far >>> 16) & 0xffff, far & 0xffff);
}

function write8(system: any, far: number, value: number) {
  core(system).write8((far >>> 16) & 0xffff, far & 0xffff, value & 0xff);
}

function readBytes(system: any, far: number, count: number) {
  return Array.from({ length: count }, (_, i) => read8(system, at(far, i)));
}

function writeBytes(system: any, far: number, bytes: number[]) {
  bytes.forEach((byte, i) => write8(system, at(far, i), byte));
}

function read16(system: any, far: number) {
  return read8(system, far) | (read8(system, at(far, 1)) << 8);
}

function read32(system: any, far: number) {
  return (read16(system, far) | (read16(system, at(far, 2)) << 16)) >>> 0;
}

function write16(system: any, far: number, value: number) {
  write8(system, far, value);
  write8(system, at(far, 1), value >>> 8);
}

function write32(system: any, far: number, value: number) {
  write16(system, far, value & 0xffff);
  write16(system, at(far, 2), (value >>> 16) & 0xffff);
}

function readString(system: any, far: number) {
  const bytes: number[] = [];

  for (let i = 0; i < 0x10000; i++) {
    const byte = read8(system, at(far, i));

    if (byte === 0) {
      break;
    }

    bytes.push(byte);
  }

  return bytes;
}

/** A file's block, as its fields are read and written. */
function block(system: any, handle: number) {
  const base = (data(system) | handle) >>> 0;

  return {
    base,
    get: (field: number) => read32(system, at(base, field)),
    set: (field: number, value: number) => write32(system, at(base, field), value >>> 0),
    word: (field: number) => read16(system, at(base, field)),
    setWord: (field: number, value: number) => write16(system, at(base, field), value),
    signed: (field: number) => read32(system, at(base, field)) | 0,
    isMem: () => read32(system, at(base, FCC)) === FOURCC_MEM,
  };
}

/** `b - a` for two huge pointers, as seg4 `7fa` takes it: each selector's tile the high word. */
function hugeDifference(a: number, b: number) {
  const tile = (far: number) => (far >>> 16) >>> 3;

  return ((((tile(b) - tile(a)) << 16) >>> 0) + (b & 0xffff) - (a & 0xffff)) | 0;
}

/** A huge pointer moved on by `count` bytes, eight to a tile. */
function hugeAdd(far: number, count: number) {
  const sum = (far & 0xffff) + (count & 0xffff);
  const tiles = ((count >>> 16) + (sum >>> 16)) >>> 0;
  const selector = ((far >>> 16) + ((tiles << 3) & 0xffff)) & 0xffff;

  return ((selector << 16) | (sum & 0xffff)) >>> 0;
}

/** Bytes copied from one huge pointer to another, as `hmemcpy` copies them. */
function copyHuge(system: any, to: number, from: number, count: number) {
  const c = core(system);
  const source = c.translateAddress((from >>> 16) & 0xffff, from & 0xffff);
  const target = c.translateAddress((to >>> 16) & 0xffff, to & 0xffff);
  const memory = system.machine.memory;
  const bytes = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    bytes[i] = memory.read8(source + i);
  }

  for (let i = 0; i < count; i++) {
    memory.write8(target + i, bytes[i]);
  }
}

function badHuge(system: any, pointer: number, count: number, write: boolean) {
  return !!(write ? IsBadHugeWritePtr : IsBadHugeReadPtr).call(system, pointer >>> 0, count >>> 0);
}

function badCode(system: any, pointer: number) {
  return !!IsBadCodePtr.call(system, pointer >>> 0);
}

/** An export's address: a module of winbox.js's own, by its name. */
function exportAddress(system: any, moduleName: string, name: string | number) {
  const module = system.modules.fromName(moduleName);
  const ordinal = typeof name === 'number' ? name : ordinalFor(module, name);
  const info = system.modules.load(module).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}

function dosAddress(system: any) {
  return exportAddress(system, 'MMSYSTEM', DOS_ORDINAL);
}

function memAddress(system: any) {
  return exportAddress(system, 'MMSYSTEM', MEM_ORDINAL);
}

/** The procedures installed: `DOS `'s and `MEM `'s to begin with, global and fixed. */
function installed(system: any) {
  const state = stateOf(system);

  return (state.installed ??= [
    { fcc: FOURCC_DOS, procedure: dosAddress(system), task: 0, fixed: true, serial: 0 },
    { fcc: FOURCC_MEM, procedure: memAddress(system), task: 0, fixed: true, serial: 0 },
  ]);
}

/** A KERNEL or KEYBOARD function called through its own entry, as MMSYSTEM calls it: DX:AX. */
async function call(system: any, moduleName: string, name: string, args: [number, number][]) {
  const answer = await system.scheduler.callProc(exportAddress(system, moduleName, name), args);

  return answer >>> 0;
}

const word = (value: number): [number, number] => [value & 0xffff, UINT];
const long = (value: number): [number, number] => [value >>> 0, DWORD];

function kernel(system: any, name: string, args: [number, number][]) {
  return call(system, 'KERNEL', name, args);
}

/** A message sent to a file's I/O procedure: winbox.js's own answered here, a program's called with MMSYSTEM's data in DS. */
async function send(system: any, handle: number, message: number, first: number, second: number) {
  const file = block(system, handle);
  const procedure = file.get(PROC);

  if (procedure === dosAddress(system)) {
    return await dosProc(system, handle, message, first >>> 0, second >>> 0);
  }

  if (procedure === memAddress(system)) {
    return memProc(system, handle, message);
  }

  const answer = await system.scheduler.callProc(
    procedure,
    [long(file.base), word(message), long(first), long(second)],
    { ds: (file.base >>> 16) & 0xffff }
  );

  return answer >>> 0;
}

/** A read or a write handed to the procedure (`10a9`), a seek to the buffer's offset first where it is not there. */
async function transfer(
  system: any,
  handle: number,
  message: number,
  buffer: number,
  count: number
) {
  const file = block(system, handle);
  const bufOffset = file.get(BUF_OFFSET);

  if (
    bufOffset !== file.get(DISK_OFFSET) &&
    (await send(system, handle, MMIOM_SEEK, bufOffset, 0)) === FAILED
  ) {
    return FAILED;
  }

  return await send(system, handle, message, buffer, count);
}

/** The DOS procedure (`117b`): KERNEL's file functions on the DOS handle in `adwInfo[0]`. */
async function dosProc(
  system: any,
  handle: number,
  message: number,
  first: number,
  second: number
) {
  const file = block(system, handle);
  const hfile = file.word(INFO0);
  const flags = file.get(FLAGS);

  switch (message) {
    case MMIOM_READ:
    case MMIOM_WRITE:
    case MMIOM_WRITEFLUSH: {
      const done = await kernel(system, message === MMIOM_READ ? '_HREAD' : '_HWRITE', [
        word(hfile),
        long(first),
        long(second),
      ]);

      if (done !== FAILED) {
        file.set(DISK_OFFSET, (file.get(DISK_OFFSET) + done) >>> 0);
      }

      return done;
    }

    case MMIOM_SEEK: {
      const to = await kernel(system, '_llseek', [word(hfile), long(first), word(second)]);

      if (to !== FAILED) {
        file.set(DISK_OFFSET, to);
      }

      return to;
    }

    case MMIOM_OPEN:
      return await dosOpen(system, handle, first, flags);

    case MMIOM_CLOSE: {
      if (first & MMIO_FHOPEN) {
        return 0;
      }

      const closed = await kernel(system, '_lclose', [word(hfile)]);

      return (closed & 0xffff) === 0xffff ? MMIOERR_CANNOTCLOSE : 0;
    }

    /* DOS's function 56h by `INT 21h` (`1162`), through KERNEL's handler:
     * a rename done is told to `FileCdr`'s procedure before the procedure
     * answers (**recorded** by `mmioext`). AL is the low byte of BX as
     * MMSYSTEM called the procedure, the structure's offset (`119b`). */
    case MMIOM_RENAME: {
      const text = (bytes: number[]) => String.fromCharCode(...bytes);
      const from = text(readString(system, first));
      const to = text(readString(system, second));

      try {
        await renameFile.call(system.dos, from, to);
      } catch {
        return MMIOERR_FILENOTFOUND;
      }

      await tellFileChange(system, 0x5600 | (handle & 0xff), from, to);
      return 0;
    }

    default:
      return 0;
  }
}

/** The DOS procedure's `MMIOM_OPEN` (`121b`). */
async function dosOpen(system: any, handle: number, name: number, flags: number) {
  const file = block(system, handle);

  if (flags & MMIO_GETTEMP) {
    if (badHuge(system, name, 4, false)) {
      return MMSYSERR_INVALPARAM;
    }

    const made = await kernel(system, 'GetTempFileName', [
      word(read8(system, name)),
      long(at(name, 3)),
      word(file.word(INFO0)),
      long(name),
    ]);

    return (made & 0xffff) === 0 ? MMIOERR_FILENOTFOUND : 0;
  }

  const structure = (data(system) | OFSTRUCT_AT) >>> 0;

  if (name) {
    const opened = await kernel(system, 'OpenFile', [long(name), long(structure), word(flags)]);

    file.setWord(INFO0, opened & 0xffff);
  }

  const hfile = file.word(INFO0);

  if (hfile === 0xffff) {
    return flags & MMIO_DELETE ? MMIOERR_CANNOTWRITE : MMIOERR_FILENOTFOUND;
  }

  if (flags & MMIO_DELETE) {
    return 0;
  }

  if (flags & (MMIO_PARSE | MMIO_EXIST)) {
    await call(system, 'KEYBOARD', 'OemToAnsi', [long(at(structure, 8)), long(name)]);
    return 0;
  }

  file.set(DISK_OFFSET, await kernel(system, '_llseek', [word(hfile), long(0), word(1)]));
  return 0;
}

/** The memory procedure (`1301`): reading, writing and seeking refused; opening checks its flags and, but for `MMIO_CREATE`, fills the buffer. */
function memProc(system: any, handle: number, message: number) {
  const file = block(system, handle);

  switch (message) {
    case MMIOM_READ:
    case MMIOM_WRITE:
    case MMIOM_SEEK:
    case MMIOM_WRITEFLUSH:
      return FAILED;

    case MMIOM_OPEN: {
      const flags = file.get(FLAGS);

      if (flags & 0xef8c || (flags >>> 16) & 0xfe) {
        return MMSYSERR_INVALFLAG;
      }

      if (!(flags & MMIO_CREATE)) {
        file.set(END_READ, file.get(END_WRITE));
      }

      return 0;
    }

    default:
      return 0;
  }
}

/** The DOS procedure called by a program: MMSYSTEM's data at the structure's offset, as the real one has its own DS. */
export async function mmioDOSIOProc(
  this: any,
  info: number,
  message: number,
  first: number,
  second: number
) {
  return await dosProc(this, info & 0xffff, message & 0xffff, first >>> 0, second >>> 0);
}

export function mmioMEMIOProc(this: any, info: number, message: number) {
  return memProc(this, info & 0xffff, message & 0xffff);
}

function isOpen(system: any, handle: number) {
  const slot = (handle & 0xffff) - BLOCK_FIRST;

  return (
    slot >= 0 &&
    slot % BLOCK_STEP === 0 &&
    (stateOf(system).blocks[slot / BLOCK_STEP] ?? null) !== null
  );
}

/** A block of MMSYSTEM's made for a file (seg4 `2e6`): noughts, past a header of its kind and its task. */
function makeBlock(system: any) {
  const serial = nextSerial(system);
  const blocks = stateOf(system).blocks;
  let slot = blocks.findIndex((open) => open === null);

  if (slot < 0) {
    blocks.push(null);
    slot = blocks.length - 1;
  }

  blocks[slot] = serial;

  const handle = BLOCK_FIRST + BLOCK_STEP * slot;
  const base = data(system);

  writeBytes(system, (base | (handle - 6)) >>> 0, [0, 0, 0, 0, 0, 0]);
  write16(system, (base | (handle - 4)) >>> 0, KIND_FILE);
  write16(system, (base | (handle - 2)) >>> 0, system.scheduler.active ?? 0);
  writeBytes(system, (base | handle) >>> 0, new Array(INFO_SIZE).fill(0));

  return handle;
}

function freeBlock(system: any, handle: number) {
  write32(system, (data(system) | (handle - 4)) >>> 0, 0);

  const slot = handle - BLOCK_FIRST;

  if (slot >= 0) {
    stateOf(system).blocks[Math.floor(slot / BLOCK_STEP)] = null;
  }
}

/** `mmioOpen` (`2a5`). */
export async function mmioOpen(this: any, name: number, info: number, flags: number) {
  name >>>= 0;
  info >>>= 0;
  flags >>>= 0;

  if (flags & 0xfffc0000) {
    return 0;
  }

  if (info) {
    if (badHuge(this, info, INFO_SIZE, true)) {
      return 0;
    }

    write16(this, at(info, ERROR), 0);

    const procedure = read32(this, at(info, PROC));

    if (procedure && badCode(this, procedure)) {
      return 0;
    }
  }

  const handle = makeBlock(this);
  const file = block(this, handle);

  if (info) {
    writeBytes(this, file.base, readBytes(this, info, INFO_SIZE));
  }

  file.set(FLAGS, flags);
  file.setWord(HANDLE, handle);

  if (flags & MMIO_ALLOCBUF) {
    if (file.get(CCH) === 0) {
      file.set(CCH, DEFAULT_BUFFER);
    }

    file.set(FLAGS, flags & ~MMIO_ALLOCBUF);
  }

  resolveProc(this, handle, name);

  const buffer = file.get(BUFFER);

  file.set(BUFFER, 0);

  const fail = (answer: number) => {
    if (info) {
      write16(this, at(info, ERROR), answer);
    }

    freeBlock(this, handle);
    return 0;
  };

  const answer = await setBuffer(this, handle, buffer, file.get(CCH), 0);

  if (answer) {
    return fail(answer);
  }

  const opened = (await send(this, handle, MMIOM_OPEN, name, 0)) & 0xffff;

  if (opened) {
    return fail(opened);
  }

  if (file.get(FLAGS) & (MMIO_PARSE | MMIO_DELETE | MMIO_EXIST | MMIO_GETTEMP)) {
    await setBuffer(this, handle, 0, 0, 0);
    freeBlock(this, handle);
    return 1;
  }

  file.set(BUF_OFFSET, file.get(DISK_OFFSET));
  return handle;
}

/** The procedure a file opens with (`bf`). */
function resolveProc(system: any, handle: number, name: number) {
  const file = block(system, handle);

  if (file.get(PROC)) {
    return;
  }

  if (!file.get(FCC) && name) {
    const text = readString(system, name);
    const plus = text.lastIndexOf(0x2b);

    if (plus >= 0) {
      let i = plus;

      while (i > 0 && ![0x2e, 0x3a, 0x5c].includes(text[i])) {
        i--;
      }

      if (text[i] === 0x2e) {
        const code = [0, 0, 0, 0];
        let from = i + 1;

        for (let k = 0; k < 4; k++) {
          if (text[from] === 0x2b) {
            code[k] = 0;
          } else {
            code[k] = text[from];
            from++;
          }
        }

        file.set(FCC, fourcc(code, true));
      }
    }
  }

  if (!file.get(FCC)) {
    file.set(FCC, FOURCC_DOS);
  }

  const task = file.word(TASK) || (system.scheduler.active ?? 0);
  const found = findProc(system, file.get(FCC), task);

  file.set(PROC, found || dosAddress(system));
}

function findProc(system: any, fcc: number, task: number) {
  const list = installed(system);
  const found =
    list.find((each) => each.fcc === fcc && each.task === task) ??
    list.find((each) => each.task === 0 && each.fcc === fcc);

  return found ? found.procedure : 0;
}

function removeProc(system: any, fcc: number, task: number) {
  const list = installed(system);
  const i = list.findIndex((each) => each.fcc === fcc && each.task === task);

  if (i < 0 || list[i].fixed) {
    return 0;
  }

  return list.splice(i, 1)[0].procedure;
}

/**
 * Four bytes made a code (`ed3`): a nought a space, and capitals with
 * `MMIO_TOUPPER`. The byte is handed to `AnsiUpper` widened with its sign
 * (`0f47`): one of 80h and up is a far pointer at FFFFh:FF80h and up, which
 * USER's check refuses, answering nought (`USER.EXE` seg11 `0365`, `0435`),
 * so the byte becomes nought (**recorded** by `mmiohi`).
 */
function fourcc(bytes: number[], upper: boolean) {
  const code = bytes.map((byte) =>
    byte === 0 ? 0x20 : upper && byte >= 0x80 ? 0 : upper ? ansiUpperByte(byte) : byte
  );

  return (code[0] | (code[1] << 8) | (code[2] << 16) | (code[3] << 24)) >>> 0;
}

/** `mmioClose` (`457`). */
export async function mmioClose(this: any, handle: number, flags: number) {
  handle &= 0xffff;

  if (!isOpen(this, handle)) {
    return MMSYSERR_INVALHANDLE;
  }

  const file = block(this, handle);

  if (await flush(this, handle, 0)) {
    file.set(FLAGS, file.get(FLAGS) & ~MMIO_DIRTY);
  }

  const answer = (await send(this, handle, MMIOM_CLOSE, flags & 0xffff, 0)) & 0xffff;

  if (answer) {
    return answer;
  }

  await setBuffer(this, handle, 0, 0, 0);
  freeBlock(this, handle);
  return 0;
}

/** `mmioRead` (`4b4`). */
export async function mmioRead(this: any, handle: number, to: number, count: number) {
  handle &= 0xffff;
  to >>>= 0;

  let left = count | 0;
  let total = 0;

  if (!isOpen(this, handle) || badHuge(this, to, count, true)) {
    return FAILED;
  }

  const file = block(this, handle);

  for (;;) {
    const next = file.get(NEXT);
    let n = hugeDifference(next, file.get(END_READ));

    if (n > left) {
      n = left;
    }

    if (n > 0) {
      copyHuge(this, to, next, n);
      file.set(NEXT, hugeAdd(next, n));
      to = hugeAdd(to, n);
      left -= n;
      total = (total + n) | 0;
    }

    if (file.isMem() || left === 0) {
      return total >>> 0;
    }

    if (file.signed(CCH) < left) {
      break;
    }

    if (await advance(this, handle, 0, 0)) {
      return FAILED;
    }

    if (file.get(NEXT) === file.get(END_READ)) {
      return total >>> 0;
    }
  }

  if (await flush(this, handle, MMIO_EMPTYBUF)) {
    return FAILED;
  }

  const done = await transfer(this, handle, MMIOM_READ, to, left >>> 0);

  file.set(BUF_OFFSET, file.get(DISK_OFFSET));

  return done === FAILED ? FAILED : (total + done) >>> 0;
}

/** `mmioWrite` (`62b`). */
export async function mmioWrite(this: any, handle: number, from: number, count: number) {
  handle &= 0xffff;
  from >>>= 0;

  let left = count | 0;
  let total = 0;

  if (!isOpen(this, handle) || badHuge(this, from, count, false)) {
    return FAILED;
  }

  const file = block(this, handle);

  for (;;) {
    let n = hugeDifference(file.get(NEXT), file.get(END_WRITE));

    if (n < left && file.isMem()) {
      if (await expand(this, handle, (left - n) >>> 0)) {
        return FAILED;
      }

      n = hugeDifference(file.get(NEXT), file.get(END_WRITE));
    }

    if (n > left) {
      n = left;
    }

    if (n > 0) {
      const next = file.get(NEXT);

      copyHuge(this, next, from, n);
      file.set(FLAGS, file.get(FLAGS) | MMIO_DIRTY);
      file.set(NEXT, hugeAdd(next, n));
      from = hugeAdd(from, n);
      left -= n;
      total = (total + n) | 0;
    }

    if (file.get(NEXT) > file.get(END_READ)) {
      file.set(END_READ, file.get(NEXT));
    }

    if (left === 0) {
      return total >>> 0;
    }

    if (file.signed(CCH) < left) {
      break;
    }

    if (await advance(this, handle, 0, 1)) {
      return FAILED;
    }
  }

  if (await flush(this, handle, MMIO_EMPTYBUF)) {
    return FAILED;
  }

  const done = await transfer(this, handle, MMIOM_WRITE, from, left >>> 0);

  file.set(BUF_OFFSET, file.get(DISK_OFFSET));

  return done === FAILED ? FAILED : (done + total) >>> 0;
}

/** A memory file's buffer made larger (`10f6`), by `count` or `adwInfo[0]` if more. */
async function expand(system: any, handle: number, count: number) {
  const file = block(system, handle);
  const step = file.get(INFO0);

  if (!step) {
    return MMIOERR_CANNOTEXPAND;
  }

  const by = (count | 0) < (step | 0) ? step : count;
  const saved = file.get(FLAGS);

  file.set(FLAGS, saved | MMIO_ALLOCBUF);

  const answer = await setBuffer(system, handle, 0, (file.get(CCH) + by) >>> 0, 0);

  file.set(FLAGS, saved);
  return answer;
}

/** `mmioSeek` (`7e9`). */
export async function mmioSeek(this: any, handle: number, offset: number, origin: number) {
  handle &= 0xffff;
  offset >>>= 0;

  if (!isOpen(this, handle)) {
    return FAILED;
  }

  const file = block(this, handle);
  const buffer = file.get(BUFFER);
  const bufOffset = file.get(BUF_OFFSET);
  const current = (hugeDifference(buffer, file.get(NEXT)) + bufOffset) >>> 0;
  const end = (hugeDifference(buffer, file.get(END_READ)) + bufOffset) >>> 0;
  const mem = file.isMem();
  let to: number;

  switch (origin & 0xffff) {
    case 0:
      to = offset;
      break;

    case 1:
      to = (current + offset) >>> 0;
      break;

    case 2: {
      let last = end;

      if (!mem) {
        last = await send(this, handle, MMIOM_SEEK, 0, 2);

        if (last === FAILED) {
          return FAILED;
        }
      }

      to = (last - offset) >>> 0;
      break;
    }

    default:
      return FAILED;
  }

  if ((file.signed(BUF_OFFSET) | 0) <= (to | 0) && (to | 0) <= (end | 0)) {
    file.set(NEXT, hugeAdd(file.get(BUFFER), (to - file.get(BUF_OFFSET)) >>> 0));
    return to;
  }

  if (mem) {
    return FAILED;
  }

  if (await flush(this, handle, 0)) {
    return FAILED;
  }

  const start = file.get(BUFFER);

  file.set(BUF_OFFSET, to);
  file.set(END_READ, start);
  file.set(NEXT, start);
  return to;
}

/** `mmioGetInfo` (`929`). */
export function mmioGetInfo(this: any, handle: number, info: number, flags: number) {
  return getInfo(this, handle & 0xffff, info >>> 0, flags & 0xffff);
}

function getInfo(system: any, handle: number, info: number, flags: number) {
  if (!isOpen(system, handle)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (badHuge(system, info, INFO_SIZE, true)) {
    return MMSYSERR_INVALPARAM;
  }

  if (flags) {
    return MMSYSERR_INVALFLAG;
  }

  writeBytes(system, info, readBytes(system, block(system, handle).base, INFO_SIZE));
  return 0;
}

/** `mmioSetInfo` (`996`). */
export function mmioSetInfo(this: any, handle: number, info: number, flags: number) {
  return setInfo(this, handle & 0xffff, info >>> 0, flags & 0xffff);
}

function setInfo(system: any, handle: number, info: number, flags: number) {
  if (!isOpen(system, handle)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (badHuge(system, info, INFO_SIZE, false)) {
    return MMSYSERR_INVALPARAM;
  }

  const buffer = read32(system, at(info, BUFFER));

  if (buffer && badHuge(system, buffer, read32(system, at(info, CCH)), true)) {
    return MMSYSERR_INVALPARAM;
  }

  if (badCode(system, read32(system, at(info, PROC)))) {
    return MMSYSERR_INVALPARAM;
  }

  if (flags) {
    return MMSYSERR_INVALFLAG;
  }

  const file = block(system, handle);

  writeBytes(system, file.base, readBytes(system, info, INFO_SIZE));

  if (file.get(NEXT) > file.get(END_READ)) {
    file.set(END_READ, file.get(NEXT));
  }

  return 0;
}

/** `mmioSetBuffer` (`a68`). */
export async function mmioSetBuffer(
  this: any,
  handle: number,
  buffer: number,
  size: number,
  flags: number
) {
  return await setBuffer(this, handle & 0xffff, buffer >>> 0, size >>> 0, flags & 0xffff);
}

async function setBuffer(system: any, handle: number, buffer: number, size: number, flags: number) {
  if (!isOpen(system, handle)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (buffer && badHuge(system, buffer, size, true)) {
    return MMSYSERR_INVALPARAM;
  }

  if (flags) {
    return MMSYSERR_INVALFLAG;
  }

  const file = block(system, handle);
  const own = !!(file.get(FLAGS) & MMIO_ALLOCBUF);

  if (own && !buffer && (size | 0) > 0) {
    return await resizeBuffer(system, handle, size);
  }

  const answer = await flush(system, handle, MMIO_EMPTYBUF);

  if (answer) {
    return answer;
  }

  if (own) {
    const selector = file.get(BUFFER) >>> 16;
    const global = await kernel(system, 'GlobalHandle', [word(selector)]);

    await kernel(system, 'GlobalUnlock', [word(global)]);

    const again = await kernel(system, 'GlobalHandle', [word(selector)]);

    await kernel(system, 'GlobalFree', [word(again)]);
    file.set(FLAGS, file.get(FLAGS) & ~MMIO_ALLOCBUF);
  }

  let result = 0;

  if (!buffer && (size | 0) > 0) {
    const global = await kernel(system, 'GlobalAlloc', [word(2), long(size)]);

    buffer = await kernel(system, 'GlobalLock', [word(global)]);

    if (!buffer) {
      result = MMIOERR_OUTOFMEMORY;
      size = 0;
    } else {
      file.set(FLAGS, file.get(FLAGS) | MMIO_ALLOCBUF);
    }
  }

  file.set(BUFFER, buffer);
  file.set(CCH, size);
  file.set(END_READ, buffer);
  file.set(NEXT, buffer);
  file.set(END_WRITE, hugeAdd(buffer, size));
  return result;
}

/** MMSYSTEM's own buffer made another size where it is (`aee`). */
async function resizeBuffer(system: any, handle: number, size: number) {
  const answer = await flush(system, handle, 0);

  if (answer) {
    return answer;
  }

  const file = block(system, handle);
  let next: number;
  let end: number;
  let selector: number;

  for (;;) {
    const buffer = file.get(BUFFER);

    next = hugeDifference(buffer, file.get(NEXT));
    end = hugeDifference(buffer, file.get(END_READ));
    selector = buffer >>> 16;

    if (next <= (size | 0)) {
      break;
    }

    const emptied = await flush(system, handle, MMIO_EMPTYBUF);

    if (emptied) {
      return emptied;
    }
  }

  const global = await kernel(system, 'GlobalHandle', [word(selector)]);

  await kernel(system, 'GlobalUnlock', [word(global)]);

  const again = await kernel(system, 'GlobalHandle', [word(selector)]);
  const moved = await kernel(system, 'GlobalReAlloc', [word(again), long(size), word(2)]);
  const buffer = await kernel(system, 'GlobalLock', [word(moved)]);

  if (!buffer) {
    return MMIOERR_OUTOFMEMORY;
  }

  const endWrite = hugeAdd(buffer, size);

  file.set(CCH, size);
  file.set(BUFFER, buffer);
  file.set(NEXT, hugeAdd(buffer, next >>> 0));
  file.set(END_READ, hugeAdd(buffer, end >>> 0));
  file.set(END_WRITE, endWrite);

  if (end > (size | 0)) {
    file.set(END_READ, endWrite);
  }

  return 0;
}

/** `mmioFlush` (`cd8`). */
export async function mmioFlush(this: any, handle: number, flags: number) {
  return await flush(this, handle & 0xffff, flags & 0xffff);
}

async function flush(system: any, handle: number, flags: number) {
  if (!isOpen(system, handle)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (flags & ~MMIO_EMPTYBUF) {
    return MMSYSERR_INVALFLAG;
  }

  const file = block(system, handle);
  const buffer = file.get(BUFFER);

  if (file.isMem() || !buffer) {
    return 0;
  }

  if (file.get(FLAGS) & MMIO_DIRTY) {
    const count = hugeDifference(buffer, file.get(END_READ)) >>> 0;
    const done = await transfer(system, handle, MMIOM_WRITEFLUSH, buffer, count);

    if (done !== count) {
      return MMIOERR_CANNOTWRITE;
    }

    file.set(FLAGS, file.get(FLAGS) & ~MMIO_DIRTY);
  }

  if (flags & MMIO_EMPTYBUF) {
    const start = file.get(BUFFER);
    const used = hugeDifference(start, file.get(NEXT));

    file.set(BUF_OFFSET, (file.get(BUF_OFFSET) + used) >>> 0);
    file.set(END_READ, start);
    file.set(NEXT, start);
  }

  return 0;
}

/** `mmioAdvance` (`da7`). */
export async function mmioAdvance(this: any, handle: number, info: number, flags: number) {
  return await advance(this, handle & 0xffff, info >>> 0, flags & 0xffff);
}

async function advance(system: any, handle: number, info: number, flags: number) {
  if (!isOpen(system, handle)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (flags & ~1) {
    return MMSYSERR_INVALFLAG;
  }

  const file = block(system, handle);

  if (!file.get(BUFFER)) {
    return MMIOERR_UNBUFFERED;
  }

  if (info) {
    if (badHuge(system, info, INFO_SIZE, true)) {
      return MMSYSERR_INVALPARAM;
    }

    setInfo(system, handle, info, 0);
  }

  if (file.isMem()) {
    if (!(flags & 1)) {
      return 0;
    }

    const room = hugeDifference(file.get(NEXT), file.get(END_WRITE)) >>> 0;

    if (room >= file.get(INFO0)) {
      return 0;
    }

    const answer = await expand(system, handle, 1);

    if (answer) {
      return answer;
    }
  } else {
    const answer = await flush(system, handle, MMIO_EMPTYBUF);

    if (answer) {
      return answer;
    }

    if (!(flags & 1)) {
      const done = await transfer(system, handle, MMIOM_READ, file.get(BUFFER), file.get(CCH));

      if (done === FAILED) {
        return MMIOERR_CANNOTREAD;
      }

      file.set(END_READ, hugeAdd(file.get(END_READ), done));
    }
  }

  if (info) {
    getInfo(system, handle, info, 0);
  }

  return 0;
}

/** `mmioStringToFOURCC` (`ed3`): four bytes, read past a nought. */
export function mmioStringToFOURCC(this: any, text: number, flags: number) {
  text >>>= 0;

  if (IsBadStringPtr.call(this, text, 0xffff)) {
    return 0;
  }

  if (flags & 0xffff & ~MMIO_TOUPPER) {
    return FAILED;
  }

  return fourcc(readBytes(this, text, 4), !!(flags & MMIO_TOUPPER));
}

/** `mmioInstallIOProc` (`f6e`). */
export function mmioInstallIOProc(this: any, fcc: number, procedure: number, flags: number) {
  fcc >>>= 0;
  procedure >>>= 0;
  flags >>>= 0;

  if (flags & 0xeff8ffff || !fcc) {
    return 0;
  }

  const task = this.scheduler.active ?? 0;

  if (flags & MMIO_INSTALLPROC) {
    if (badCode(this, procedure)) {
      return 0;
    }

    const serial = nextSerial(this);

    installed(this).unshift({
      fcc,
      procedure,
      task: flags & MMIO_GLOBALPROC ? 0 : task,
      fixed: false,
      serial,
    });
    return procedure;
  }

  if (procedure) {
    return 0;
  }

  if (flags & MMIO_REMOVEPROC) {
    return removeProc(this, fcc, task) || removeProc(this, fcc, 0);
  }

  if (flags & MMIO_FINDPROC) {
    return findProc(this, fcc, task);
  }

  return 0;
}

/** `mmioSendMessage` (`1073`). */
export async function mmioSendMessage(
  this: any,
  handle: number,
  message: number,
  first: number,
  second: number
) {
  handle &= 0xffff;

  if (!isOpen(this, handle)) {
    return 0;
  }

  return await send(this, handle, message & 0xffff, first >>> 0, second >>> 0);
}

/** `mmioRename` (`1d2`). */
export async function mmioRename(this: any, from: number, to: number, info: number, flags: number) {
  from >>>= 0;
  to >>>= 0;
  info >>>= 0;

  if (flags >>> 0) {
    return MMSYSERR_INVALFLAG;
  }

  if (info && badHuge(this, info, INFO_SIZE, false)) {
    return MMSYSERR_INVALPARAM;
  }

  const handle = makeBlock(this);

  if (info) {
    const procedure = read32(this, at(info, PROC));

    if (procedure && badCode(this, procedure)) {
      return MMSYSERR_INVALPARAM;
    }

    writeBytes(this, block(this, handle).base, readBytes(this, info, INFO_SIZE));
  }

  resolveProc(this, handle, from);

  const answer = await send(this, handle, MMIOM_RENAME, from, to);

  freeBlock(this, handle);
  return answer & 0xffff;
}

/** `mmioDescend` (`1360`). */
export async function mmioDescend(
  this: any,
  handle: number,
  chunk: number,
  parent: number,
  flags: number
) {
  handle &= 0xffff;
  chunk >>>= 0;
  parent >>>= 0;
  flags &= 0xffff;

  if (flags & ~(MMIO_FINDCHUNK | MMIO_FINDRIFF | MMIO_FINDLIST)) {
    return MMSYSERR_INVALFLAG;
  }

  if (badHuge(this, chunk, CK_SIZE, true) || (parent && badHuge(this, parent, CK_SIZE, false))) {
    return MMSYSERR_INVALPARAM;
  }

  let wantId = 0;
  let wantType = 0;

  if (flags & MMIO_FINDCHUNK) {
    wantId = read32(this, at(chunk, CK_ID));
  } else if (flags & MMIO_FINDRIFF) {
    wantId = FOURCC_RIFF;
    wantType = read32(this, at(chunk, CK_TYPE));
  } else if (flags & MMIO_FINDLIST) {
    wantId = FOURCC_LIST;
    wantType = read32(this, at(chunk, CK_TYPE));
  }

  write32(this, at(chunk, CK_FLAGS), 0);

  for (;;) {
    if ((await mmioRead.call(this, handle, chunk, 8)) !== 8) {
      return MMIOERR_CHUNKNOTFOUND;
    }

    const here = await mmioSeek.call(this, handle, 0, 1);

    write32(this, at(chunk, CK_DATA), here);

    if (here === FAILED) {
      return MMIOERR_CANNOTSEEK;
    }

    if (parent) {
      const end = (read32(this, at(parent, CK_DATA)) + read32(this, at(parent, CK_LENGTH))) >>> 0;

      if (end <= (here - 8) >>> 0) {
        return MMIOERR_CHUNKNOTFOUND;
      }
    }

    const id = read32(this, at(chunk, CK_ID));

    if (id === FOURCC_RIFF || id === FOURCC_LIST) {
      if ((await mmioRead.call(this, handle, at(chunk, CK_TYPE), 4)) !== 4) {
        return MMIOERR_CHUNKNOTFOUND;
      }
    } else {
      write32(this, at(chunk, CK_TYPE), 0);
    }

    const kind = read32(this, at(chunk, CK_TYPE));

    if ((!wantId || id === wantId) && (!wantType || kind === wantType)) {
      return 0;
    }

    const answer = await ascend(this, handle, chunk, 0);

    if (answer) {
      return answer;
    }
  }
}

/** `mmioAscend` (`1562`). */
export async function mmioAscend(this: any, handle: number, chunk: number, flags: number) {
  return await ascend(this, handle & 0xffff, chunk >>> 0, flags & 0xffff);
}

async function ascend(system: any, handle: number, chunk: number, flags: number) {
  if (flags) {
    return MMSYSERR_INVALFLAG;
  }

  if (badHuge(system, chunk, CK_SIZE, true)) {
    return MMSYSERR_INVALPARAM;
  }

  if (read32(system, at(chunk, CK_FLAGS)) & MMIO_DIRTY) {
    const here = await mmioSeek.call(system, handle, 0, 1);

    if (here === FAILED) {
      return MMIOERR_CANNOTSEEK;
    }

    const dataAt = read32(system, at(chunk, CK_DATA));
    const size = (here - dataAt) | 0;

    if (size < 0) {
      return MMIOERR_CANNOTWRITE;
    }

    if (size & 1) {
      const pad = (data(system) | PAD_BYTE) >>> 0;

      write8(system, pad, 0);

      if ((await mmioWrite.call(system, handle, pad, 1)) !== 1) {
        return MMIOERR_CANNOTWRITE;
      }
    }

    if (read32(system, at(chunk, CK_LENGTH)) !== size >>> 0) {
      write32(system, at(chunk, CK_LENGTH), size >>> 0);

      if ((await mmioSeek.call(system, handle, (dataAt - 4) >>> 0, 0)) === FAILED) {
        return MMIOERR_CANNOTSEEK;
      }

      if ((await mmioWrite.call(system, handle, at(chunk, CK_LENGTH), 4)) !== 4) {
        return MMIOERR_CANNOTWRITE;
      }
    }
  }

  const size = read32(system, at(chunk, CK_LENGTH));
  const past = ((size & 1) + size + read32(system, at(chunk, CK_DATA))) >>> 0;

  if ((await mmioSeek.call(system, handle, past, 0)) === FAILED) {
    return MMIOERR_CANNOTSEEK;
  }

  return 0;
}

/** `mmioCreateChunk` (`16a5`). */
export async function mmioCreateChunk(this: any, handle: number, chunk: number, flags: number) {
  handle &= 0xffff;
  chunk >>>= 0;
  flags &= 0xffff;

  if (flags & ~(MMIO_CREATERIFF | MMIO_CREATELIST)) {
    return MMSYSERR_INVALFLAG;
  }

  if (badHuge(this, chunk, CK_SIZE, true)) {
    return MMSYSERR_INVALPARAM;
  }

  const here = await mmioSeek.call(this, handle, 0, 1);

  if (here === FAILED) {
    return MMIOERR_CANNOTSEEK;
  }

  write32(this, at(chunk, CK_DATA), (here + 8) >>> 0);

  let length = 8;

  if (flags & MMIO_CREATERIFF) {
    write32(this, at(chunk, CK_ID), FOURCC_RIFF);
    length = 12;
  } else if (flags & MMIO_CREATELIST) {
    write32(this, at(chunk, CK_ID), FOURCC_LIST);
    length = 12;
  }

  if ((await mmioWrite.call(this, handle, chunk, length)) !== length) {
    return MMIOERR_CANNOTWRITE;
  }

  write32(this, at(chunk, CK_FLAGS), MMIO_DIRTY);
  return 0;
}

/**
 * MMSYSTEM's list of handles, the latest made first (seg4 `2e6`): the
 * files open and the procedures installed, each with its task.
 */
function handleList(system: any) {
  const state = stateOf(system);
  const base = data(system);
  const list: { serial: number; file?: number; proc?: Installed; task: number }[] = [];

  state.blocks.forEach((serial, slot) => {
    if (serial !== null) {
      const handle = BLOCK_FIRST + BLOCK_STEP * slot;

      list.push({ serial, file: handle, task: read16(system, (base | (handle - 2)) >>> 0) });
    }
  });

  for (const each of state.installed ?? []) {
    if (!each.fixed) {
      list.push({ serial: each.serial, proc: each, task: each.task });
    }
  }

  return list.sort((a, b) => b.serial - a.serial);
}

/**
 * The next of a task's handles to let go, as MMSYSTEM's driver entry picks
 * it for `DRV_EXITAPPLICATION` (seg4 `139`-`177`): down the list from its
 * head to the first of the task's whose next is not the task's.
 */
function nextOwned(system: any, task: number) {
  const list = handleList(system);
  const owned = (at: number) => at < list.length && list[at].task === task;

  for (let at = 0; at < list.length; at++) {
    if (owned(at) && !owned(at + 1)) {
      return list[at];
    }
  }

  return null;
}

/** Whether a task has files open or I/O procedures installed, which its end lets go. */
export function ownsAny(system: any, task: number) {
  return !!task && !!system._mmio && nextOwned(system, task) !== null;
}

/**
 * What MMSYSTEM does as a task ends, sent `DRV_EXITAPPLICATION` by USER (its
 * driver entry, seg4 `28`, `a2`, `cd`): each of the task's handles, picked as
 * `nextOwned` picks it, is given no task, and a file closed with `mmioClose`
 * -- its buffer written out, its procedure sent `MMIOM_CLOSE` -- and a
 * procedure removed (`1e6`, `1f0`). **Recorded** by `mmioext`. As the Rust
 * engine's `exit_application`, which says more: the procedure is taken out
 * itself [inferred], and the task's wave and MIDI devices are not closed
 * here.
 */
export async function exitApplication(system: any, task: number) {
  for (;;) {
    const next = nextOwned(system, task);

    if (!next) {
      return;
    }

    if (next.file !== undefined) {
      write16(system, (data(system) | (next.file - 2)) >>> 0, 0);
      await mmioClose.call(system, next.file, 0);
    } else {
      const list = installed(system);

      list.splice(list.indexOf(next.proc!), 1);
    }
  }
}
