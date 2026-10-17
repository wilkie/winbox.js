'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalSize } from '../kernel/GlobalSize.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { GetModuleHandle } from '../kernel/GetModuleHandle.js';
import { OpenFile } from '../kernel/OpenFile.js';
import { WinExec } from '../kernel/WinExec.js';
import { _lclose } from '../kernel/_lclose.js';
import { _llseek } from '../kernel/_llseek.js';
import { _lwrite } from '../kernel/_lwrite.js';
import { readProfile, toInteger } from '../kernel/profiles.js';
import { OFSTRUCT } from '../kernel.js';
import { GDI_STRINGS } from './strings.js';
import { clockOf } from '../../emulator/clock.js';
import { tellFileChange } from '../kernel/FileCdr.js';
import { deleteFile } from '../../dos/syscall/files.js';
import { HDC, INT } from '../types.js';

/**
 * GDI's spooler: the jobs a printer's driver opens and writes its output
 * through -- `OpenJob`, `StartSpoolPage`, `EndSpoolPage`, `WriteSpool`,
 * `WriteDialog`, `CloseJob`, `DeleteJob` -- and `QueryAbort`, which asks a
 * device context's abort procedure. The twin of
 * `crates/winbox-win16/src/gdi/spooler.rs`.
 *
 * **Read out** of `GDI.EXE` seg28, with seg29 (WIN.INI and the ports),
 * seg30 (the communications driver's ports) and seg7 `052d`
 * (`QueryAbort`). A job is a block of 148h bytes, `GlobalAlloc(3042h)`,
 * and its handle is answered shifted right a bit; each call takes it back
 * and refuses one below 148h bytes with -3. An answer from -5 to -1 given
 * as a job is answered again as it is (`05b1`). The job's words, as GDI
 * keeps them:
 *
 * * 0: its state, the low byte (bit 0 a spooled job closed), and how it
 *   prints, the high: 40h straight to its port, 20h through Print
 *   Manager, 80h through the communications driver, 01h through the
 *   network.
 * * 2: the page; 4: the pages there is room for, 7; 6: the queue, by its
 *   number in `[PrinterPorts]`, or -1; 8: the device context.
 * * 0Ah: the bytes in its buffer, 10h: the buffer, 100h bytes.
 * * 110h: the bytes spooled; 118h: the program's PSP; 11Ah: the port's
 *   name, or the document's for Print Manager, 20h bytes.
 * * 13Ah on: each page's block. A job straight to its port has one, at
 *   13Ch: its file, a block of C2h bytes whose word 0 is the file's
 *   handle and 6 the bytes written, and whose `OFSTRUCT` is at 0Ah. The
 *   communications driver's job has there a block of 8 bytes with the
 *   port's id at 2.
 *
 * Not followed: Print Manager's side (a job to a port of `[PrinterPorts]`
 * with the spooler on, once Print Manager has its window), the network's
 * jobs, `FILE`'s "Print To File" box, DOS's devices, and the PSP GDI makes
 * current around each file call, which this DOS has not got.
 */

const JOB_SIZE = 0x148;
const PORT_SIZE = 0xc2;

const SP_ERROR = -1;
const SP_USERABORT = -3;
const SP_OUTOFMEMORY = -5;

const DIRECT = 0x40;
const SPOOLED = 0x20;
const COMM = 0x80;
const NETWORK = 0x01;

const HWND_BROADCAST = 0xffff;
/* What GDI broadcasts as a job opens and closes (seg28 `057e`, `13c9`). */
const JOB_MESSAGE = 0x40;

const OF_WRITE = 0x0001;
const OF_CREATE = 0x1000;
/* `OF_REOPEN | OF_PROMPT | OF_CANCEL | OF_WRITE` (seg28 `0bdc`). */
const REOPEN = 0xa801;

const IDRETRY = 4;

const WN_SUCCESS = 0;
const WN_NOT_SUPPORTED = 1;

/** A port of `[PrinterPorts]`, as GDI keeps it (seg29 `0000`). */
interface Queue {
  port: string;
  device: string;
}

/** What GDI reads of WIN.INI as the first job opens (seg29 `00d7`). */
interface Spooling {
  /** `[windows]` `spooler` not `no` (`[0910h]`). */
  on: boolean;
  /** `[windows]` `DosPrint` `yes` (`[0A5Ch]`). */
  dosPrint: boolean;
  /** `[spooler]` `netspool` `yes` (`[0916h]`). */
  netSpool: boolean;
  queues: Queue[];
  /** `[windows]` `DeviceNotSelectedTimeout` and `TransmissionRetryTimeout`, in milliseconds (`[0922h]`, `[0908h]`). */
  selectTimeout: number;
  retryTimeout: number;
  /** What `GetCommError` last gave a write (`[0A4Ah]`). */
  commError: number;
}

function spoolingOf(system: any): Spooling | null {
  return system._spooling ?? null;
}

/** The answer of `lstrcmpi` (`KERNEL.87`): nought for the same, by capitals. */
function same(a: string, b: string) {
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * A port's name as GDI takes it from a string (seg29 `044d`): spaces
 * before it left off, to a comma or a space, a colon at its end left off.
 */
export function portName(text: string) {
  let at = 0;

  while (text[at] === ' ') {
    at++;
  }

  let end = at;

  while (end < text.length && text[end] !== ',' && text[end] !== ' ') {
    end++;
  }

  const name = text.slice(at, end);

  return name.endsWith(':') ? name.slice(0, -1) : name;
}

/**
 * What GDI reads as the first job opens (seg29 `00d7`): the spooler's
 * switches, the two timeouts (`0393`, not followed), and every port of
 * every printer of `[PrinterPorts]`, each value a driver and then, after
 * each comma, a port and its two timeouts (`0000`).
 */
async function readied(system: any): Promise<Spooling> {
  const kept = spoolingOf(system);

  if (kept) {
    return kept;
  }

  const profile = await readProfile(system, 'WIN.INI');
  const value = (section: string, key: string) => String(profile.get(section, key) ?? '');
  const queues: Queue[] = [];

  for (const device of profile.entries('PrinterPorts') ?? []) {
    const text = value('PrinterPorts', device);
    const comma = text.indexOf(',');

    if (comma < 0 || !text.slice(comma + 1)) {
      continue;
    }

    /* After the driver: a port, then its two timeouts, then perhaps another
     * port and its timeouts. */
    const fields = text.slice(comma + 1).split(',');

    for (let at = 0; at < fields.length && queues.length < 20; at += 3) {
      queues.push({ port: portName(fields[at]), device });
    }
  }

  /* `GetProfileInt`, in seconds, made milliseconds (seg29 `0393`). */
  const seconds = (key: string, fallback: number) =>
    (toInteger(profile.get('windows', key) ?? null, fallback) & 0xffff) * 1000;
  const spooling: Spooling = {
    on: !same(value('windows', 'spooler'), 'no'),
    dosPrint: same(value('windows', 'DosPrint'), 'yes'),
    netSpool: same(value('spooler', 'netspool'), 'yes'),
    queues,
    selectTimeout: seconds('DeviceNotSelectedTimeout', 15),
    retryTimeout: seconds('TransmissionRetryTimeout', 45),
    commError: 0,
  };

  system._spooling = spooling;
  return spooling;
}

/**
 * A port's queue, by its number (seg28 `17bb`): the one for the port and
 * the device, else the first for the port, else -1.
 */
function queueOf(spooling: Spooling, port: string, device: string) {
  const both = spooling.queues.findIndex(
    (queue) => same(queue.port, port) && same(queue.device, device)
  );

  return both >= 0 ? both : spooling.queues.findIndex((queue) => same(queue.port, port));
}

function core(system: any) {
  return system.machine.cpu.core;
}

function read16(system: any, far: number, at: number) {
  return core(system).read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

function write16(system: any, far: number, at: number, value: number) {
  core(system).write16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xffff);
}

function read8(system: any, far: number, at: number) {
  return core(system).read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

function write8(system: any, far: number, at: number, value: number) {
  core(system).write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xff);
}

/**
 * Bytes laid below the stack for a call, as GDI lays its own on its
 * stack: given to `body` as a far pointer.
 */
async function onStack<T>(system: any, bytes: Uint8Array, body: (far: number) => Promise<T>) {
  const cpu = core(system);
  const saved = cpu.sp;
  const sp = (saved - ((bytes.length + 1) & ~1)) & 0xffff;

  bytes.forEach((byte, step) => cpu.write8(cpu.ss, (sp + step) & 0xffff, byte));
  cpu.sp = (sp - 4) & 0xffff;

  try {
    return await body(((cpu.ss << 16) | sp) >>> 0);
  } finally {
    cpu.sp = saved;
  }
}

function offsetBy(far: number, at: number) {
  return ((far & 0xffff0000) | ((far + at) & 0xffff)) >>> 0;
}

function stringAt(system: any, far: number, at = 0) {
  let text = '';

  for (let step = 0; far && step < 0x100; step++) {
    const byte = read8(system, far, at + step);

    if (!byte) {
      break;
    }

    text += String.fromCharCode(byte);
  }

  return text;
}

/** A string copied as GDI copies one (seg28 `1933`): no more than 1Fh bytes and a nought. */
function copyName(system: any, far: number, at: number, text: string) {
  const bytes = text.slice(0, 0x1f);

  for (let step = 0; step < bytes.length; step++) {
    write8(system, far, at + step, bytes.charCodeAt(step));
  }

  write8(system, far, at + bytes.length, 0);
}

/** A job's handle as GDI takes it back, or the answer it passes on. */
function jobOf(system: any, hJob: number): { handle: number } | { answer: number } {
  const given = (hJob << 16) >> 16;

  if (given >= -5 && given <= -1) {
    return { answer: given };
  }

  const handle = (hJob << 1) & 0xffff;

  return GlobalSize.call(system, handle) < JOB_SIZE ? { answer: SP_USERABORT } : { handle };
}

/** The structure a port's block keeps at 0Ah, bound to it. */
function portStructure(system: any, block: number) {
  const structure = new OFSTRUCT();
  const at = offsetBy(block, 0x0a);

  structure.loadFromMemory(system.machine.memory, (at >>> 16) >> 3, at & 0xffff);
  return structure;
}

async function broadcast(system: any, wParam: number, lParam: number) {
  /* USER's, loaded when first wanted: imported at the top, USER's modules
   * would load in the middle of GDI's. */
  const { SendMessage } = await import('../user/SendMessage.js');

  await SendMessage.call(system, HWND_BROADCAST, JOB_MESSAGE, wParam, lParam >>> 0);
}

/**
 * Print Manager, started where the spooler is on and it is not running
 * (seg28 `1967`): `PrintMan` from Windows' directory, else the system's,
 * shown minimized. The answer is its window, which it gives GDI with
 * `GetSpoolJob` (`[058Eh]`); nought with the spooler off.
 */
async function printManager(system: any, spooling: Spooling) {
  if (!spooling.on) {
    return 0;
  }

  if (!GetModuleHandle.call(system, 'PrintMan')) {
    const started = await WinExec.call(system, 'C:\\WINDOWS\\PrintMan', 7);

    if (started < 32) {
      await WinExec.call(system, 'C:\\WINDOWS\\SYSTEM\\PrintMan', 7);
    }
  }

  return system._spooler?.window ?? 0;
}

/** USER's communications calls, loaded when first wanted (`user/comm.ts`). */
async function comm() {
  return import('../user/comm.js');
}

/**
 * A port of the communications driver's opened for a job (`GDI.EXE` seg30
 * `00ea`): `OpenComm` with queues of 10h and 400h bytes, or 30h for the
 * second where 400h is too much (-4); an id, or -1 and 2 to 5 refused,
 * -10 to -12 too; its state read, and set again from WIN.INI's `[ports]`
 * where that names the port's settings (`01a9`). The id, or -1.
 */
async function commPort(system: any, port: string) {
  const { OpenComm, GetCommState, SetCommState } = await comm();
  let cid = ((await OpenComm.call(system, port, 0x10, 0x400)) << 16) >> 16;

  if (cid === -4) {
    cid = ((await OpenComm.call(system, port, 0x10, 0x30)) << 16) >> 16;
  }

  if ((cid >= -12 && cid <= -10) || (cid >= -5 && cid <= -2)) {
    return -1;
  }

  const dcb = new Uint8Array(0x1a);
  const settings = await portSettings(system, port);

  return onStack(system, dcb, async (far) => {
    GetCommState.call(system, cid, far);

    if (settings && writeSettings(system, far, settings) && SetCommState.call(system, far)) {
      return -1;
    }

    return cid;
  });
}

/** WIN.INI's `[ports]` for a port, by its name and a colon; null for none. */
async function portSettings(system: any, port: string) {
  const profile = await readProfile(system, 'WIN.INI');
  const text = String(profile.get('ports', `${port}:`) ?? '').slice(0, 0x3b);

  return text || null;
}

/**
 * A `DCB` set from a port's settings (seg30 `01a9`): the characters for
 * XON and XOFF 11h and 13h; then each field after a comma: the baud rate,
 * the parity (`n`, `o`, or anything else even), the byte's bits, the stop
 * bits (`1` one, anything else two), and a fifth, whatever it says, the
 * XON/XOFF handshake. 1.
 */
function writeSettings(system: any, far: number, text: string) {
  const number = (field: string) => {
    let value = 0;

    for (const ch of field) {
      if (ch < '0' || ch > '9') {
        break;
      }

      value = value * 10 + (ch.charCodeAt(0) - 0x30);
    }

    return value & 0xffff;
  };
  const fields = text.split(',');

  write8(system, far, 0x0e, 0x11);
  write8(system, far, 0x0f, 0x13);
  write8(system, far, 0x0d, read8(system, far, 0x0d) | 1);

  fields.forEach((field, index) => {
    if (!field) {
      return;
    }

    switch (index) {
      case 0: {
        const baud = number(field);

        if (baud) {
          write16(system, far, 1, baud);
        }

        break;
      }

      case 1:
        write8(system, far, 4, /^[nN]/.test(field) ? 0 : /^[oO]/.test(field) ? 1 : 2);
        break;

      case 2: {
        const bits = number(field);

        if (bits) {
          write8(system, far, 3, bits);
        }

        break;
      }

      case 3:
        write8(system, far, 5, field[0] === '1' ? 0 : 2);
        break;

      case 4:
        write16(system, far, 8, 0);
        write16(system, far, 0x0a, 0);
        write8(system, far, 0x0c, read8(system, far, 0x0c) | 0x18);
        break;
    }
  });

  return 1;
}

/** GDI's own clock for the timeouts: USER's `GetCurrentTime`. */
async function now(system: any) {
  const { GetTickCount } = await import('../user/GetTickCount.js');

  return GetTickCount.call(system) >>> 0;
}

/**
 * Bytes written through the communications driver (seg30 `0000`):
 * `WriteComm`'s count. With none written, or a part, the error
 * `GetCommError` gives is kept; a queue with bytes in it flushed. Out of
 * paper is a failure at once, as are 400h, 200h and 10h; not selected
 * (800h) or timed out (100h) a failure once `DeviceNotSelectedTimeout` or
 * `TransmissionRetryTimeout` has passed since the first, else nothing
 * written. A failure answers with 8000h added. GDI goes round its loop
 * the while, nothing else running; on a virtual clock the time it takes
 * is charged to the clock, as instructions run.
 */
async function commWrite(system: any, kept: number, data: number, count: number) {
  const { WriteComm, GetCommError, FlushComm } = await comm();
  const spooling = spoolingOf(system)!;
  const at = GlobalLock.call(system, kept) >>> 0;
  const cid = read16(system, at, 2);
  let wrote = (WriteComm.call(system, cid, data, count) << 16) >> 16;
  const reset = () => {
    write16(system, at, 4, 0);
    write16(system, at, 6, 0);
  };

  try {
    if (wrote > 0) {
      reset();
      return wrote;
    }

    wrote = -wrote;

    if (wrote) {
      reset();
    }

    const error = await onStack(system, new Uint8Array(10), async (far) =>
      GetCommError.call(system, cid, far)
    );

    spooling.commError = error & 0xffff;

    if (error & 0x0f) {
      FlushComm.call(system, cid, 1);
    }

    const timed = async (limit: number) => {
      const time = await now(system);
      const since = (read16(system, at, 4) | (read16(system, at, 6) << 16)) >>> 0;

      /* GDI goes round again, nothing else running, until the time is
       * out: on a virtual clock the time those rounds take passes. */
      const clock = clockOf(system);
      const spin = (ms: number) => clock.charge?.(ms * (clock.rate ?? 0));

      if (!since) {
        write16(system, at, 4, time);
        write16(system, at, 6, time >>> 16);
        spin(limit);
        return wrote;
      }

      if ((time - since) >>> 0 < limit) {
        spin(limit - ((time - since) >>> 0));
        return wrote;
      }

      reset();
      return wrote | 0x8000;
    };

    if (error & 0x1000) {
      return wrote | 0x8000;
    }

    if (error & 0x100) {
      return timed(spooling.retryTimeout);
    }

    if (error & 0x800) {
      return timed(spooling.selectTimeout);
    }

    return error & 0x610 ? wrote | 0x8000 : wrote;
  } finally {
    GlobalUnlock.call(system, kept);
  }
}

/**
 * The box a write that fails puts up (seg28 `002c`): GDI's message for
 * the code given, or for the error -- out of paper, not responding, not
 * selected, or the port's settings -- with the job's name as its title,
 * Retry and Cancel, system-modal. Its answer.
 */
async function writeFailed(system: any, far: number, error: number, code: number) {
  const { MessageBox } = await import('../user/MessageBox.js');
  const high = (error >> 8) & 0xff;
  const id = code || (high & 0x10 ? 0x65 : high & 0x01 ? 0x67 : high & 0x08 ? 0x66 : 0x64);

  return MessageBox.call(
    system,
    0,
    GDI_STRINGS.get(id) ?? '',
    stringAt(system, far, 0x11a),
    0x1035
  );
}

/**
 * `OpenJob` (seg28 `01c3`): a job for the port named, the document's
 * name, and the device context it prints. -1 for no port; the answer of
 * a port that cannot be opened; -5 with no memory. A port in
 * `[PrinterPorts]`, not `FILE`, is asked of the network first
 * (`WNetOpenJob`, which with no network answers that it has not got one),
 * then with the spooler on goes to Print Manager, started if it is not
 * running. Else, with `DosPrint` not `yes`, a port the communications
 * driver opens goes through it. Any other job is straight to its port: a
 * file made empty at once (`OpenFile` with `OF_CREATE`, closed), or for
 * `FILE`, the name USER's box asks for (`GetFilePortName`, not followed:
 * refused as a box cancelled). Each job opened is broadcast, 40h with 2
 * and the job's handle in the high word, 1 in the low.
 */
export async function OpenJob(this: any, lpOutput: number, lpTitle: number, hdc: number) {
  const system = this;
  const given = stringAt(system, lpOutput >>> 0);

  if (!given) {
    return SP_ERROR;
  }

  const spooling = await readied(system);
  const port = portName(given);
  const surface = system.handles.resolve(hdc);
  const device = surface?.driverDevice?.device ?? '';
  const queue = queueOf(spooling, port, device);
  const toFile = same(port, 'file');
  const job = GlobalAlloc.call(system, 0x3042, JOB_SIZE);

  if (!job) {
    return SP_OUTOFMEMORY;
  }

  const far = GlobalLock.call(system, job) >>> 0;

  write16(system, far, 0x118, 0);
  write16(system, far, 0, 0);
  write16(system, far, 4, 7);
  write16(system, far, 8, hdc);
  write16(system, far, 6, queue);
  copyName(system, far, 0x11a, port);

  if (!toFile && queue !== -1) {
    if (!spooling.netSpool || !spooling.on) {
      /* `WNetOpenJob`, with no network (`USER.EXE` seg22 `0a68`). */
      const net: number = WN_NOT_SUPPORTED;

      if (net === WN_SUCCESS || net === 0x45) {
        /* A job of the network's: not followed. */
      } else if (net !== 0x43 && net !== WN_NOT_SUPPORTED && net !== 0x30) {
        GlobalUnlock.call(system, job);
        GlobalFree.call(system, job);
        return SP_ERROR;
      }
    }

    if (await printManager(system, spooling)) {
      /* Print Manager's job: the document's name kept (`042e`). Not
       * followed further. */
      copyName(system, far, 0x11a, stringAt(system, lpTitle >>> 0) || 'Untitled');
      write8(system, far, 1, read8(system, far, 1) | SPOOLED | (spooling.dosPrint ? 2 : 0));
      return opened(system, job);
    }

    /* Through the communications driver, where `DosPrint` is not `yes`
     * and the driver opens the port (`03ea`): its id kept in a block of
     * GDI's, 8 bytes, at 13Ch. */
    if (!spooling.dosPrint) {
      const cid = await commPort(system, port);

      if (cid !== -1) {
        const kept = GlobalAlloc.call(system, 0x40, 8);

        if (!kept) {
          GlobalUnlock.call(system, job);
          GlobalFree.call(system, job);
          return SP_OUTOFMEMORY;
        }

        const at = GlobalLock.call(system, kept) >>> 0;

        write16(system, at, 2, cid);
        write16(system, at, 4, 0);
        write16(system, at, 6, 0);
        GlobalUnlock.call(system, kept);
        write16(system, far, 0x13c, kept);
        write8(system, far, 1, read8(system, far, 1) | COMM);
        return opened(system, job);
      }
    }
  }

  const block = GlobalAlloc.call(system, 0x42, PORT_SIZE);

  if (!block) {
    GlobalUnlock.call(system, job);
    GlobalFree.call(system, job);
    return SP_OUTOFMEMORY;
  }

  const port0 = GlobalLock.call(system, block) >>> 0;

  write16(system, port0, 4, 1);
  write16(system, port0, 2, 8);
  write16(system, port0, 0x96, 0);
  write16(system, port0, 8, 0);
  write16(system, port0, 6, 0);
  write16(system, port0, 0, 0xffff);

  if (toFile) {
    /* USER's "Print To File" box (`GetFilePortName`, `[0A54h]`): not
     * followed, and the job refused as a box cancelled. */
    GlobalUnlock.call(system, block);
    GlobalFree.call(system, block);
    GlobalUnlock.call(system, job);
    GlobalFree.call(system, job);
    return SP_USERABORT;
  }

  const file = await OpenFile.call(
    system,
    stringAt(system, far, 0x11a),
    portStructure(system, port0),
    OF_CREATE | OF_WRITE
  );

  if (file !== 0xffff) {
    _lclose.call(system, file);
  }

  GlobalUnlock.call(system, block);
  write8(system, far, 1, read8(system, far, 1) | DIRECT);
  write16(system, far, 2, 1);
  write16(system, far, 0x13c, block);

  return opened(system, job);
}

/** A job opened: broadcast, and its handle answered shifted (`0576`). */
async function opened(system: any, job: number) {
  GlobalUnlock.call(system, job);
  await broadcast(system, 2, ((job << 16) | 1) >>> 0);

  return job >> 1;
}

/**
 * `StartSpoolPage` (seg28 `06a1`): 1. With Print Manager's window there,
 * a job straight to its port notes the bytes written so far; Print
 * Manager's job starts a page in a file of its own, not followed.
 */
export function StartSpoolPage(this: any, hJob: number) {
  const job = jobOf(this, hJob);

  if ('answer' in job) {
    return job.answer;
  }

  if (!this._spooler?.window) {
    return 1;
  }

  const far = GlobalLock.call(this, job.handle) >>> 0;

  if (read8(this, far, 1) & DIRECT) {
    const block = read16(this, far, 0x13a + 2 * read16(this, far, 2));
    const port = GlobalLock.call(this, block) >>> 0;

    write16(this, far, 0x114, read16(this, port, 6));
    write16(this, far, 0x116, read16(this, port, 8));
    GlobalUnlock.call(this, block);
  }

  GlobalUnlock.call(this, job.handle);
  return 1;
}

/**
 * `EndSpoolPage` (seg28 `1112`): 1 for a job straight to its port or
 * through the communications driver. Print Manager's page is ended and
 * handed to it: not followed.
 */
export function EndSpoolPage(this: any, hJob: number) {
  const job = jobOf(this, hJob);

  return 'answer' in job ? job.answer : 1;
}

/**
 * The file of a job straight to its port, open (seg28 `0b9a`): kept open
 * where `OpenFile` found it on a fixed disk; else, and the first time,
 * opened again from its structure, at the bytes written so far. Its
 * handle, or -1.
 */
async function openPort(system: any, far: number, port: number) {
  const handle = read16(system, port, 0);

  if (read8(system, port, 0x0b) && handle !== 0xffff) {
    return handle;
  }

  const file = await OpenFile.call(system, null, portStructure(system, port), REOPEN);

  if (file === 0xffff) {
    return file;
  }

  write16(system, port, 0, file);
  _llseek.call(system, file, (read16(system, port, 6) | (read16(system, port, 8) << 16)) >>> 0, 0);

  return file;
}

/**
 * What GDI writes of a job's buffer (seg28 `0a60`): before each write the
 * abort procedure is asked, and nought from it gives -2; then the bytes
 * written with `_lwrite`. A write that fails to a file puts up the box
 * that the disk may be full (68h); to a device, a box once
 * `TransmissionRetryTimeout` has passed since the first failure. Retry
 * tries again; Cancel gives -3. This DOS has no devices, only files.
 */
async function written(system: any, far: number, file: number, data: number, count: number) {
  let left = count;
  let from = data;

  while (left) {
    const hdc = read16(system, far, 8);

    if (hdc && !(await QueryAbort.call(system, hdc, 0))) {
      return -2;
    }

    const wrote = await _lwrite.call(system, file, from, left);

    if (wrote > 0 && wrote !== 0xffff) {
      left -= wrote;
      from = offsetBy(from, wrote);
      continue;
    }

    if ((await writeFailed(system, far, 0x100, 0x68)) !== IDRETRY) {
      return SP_USERABORT;
    }
  }

  return count;
}

/** A job's buffer written to its file and emptied (seg28 `0d63`). */
async function flushed(system: any, far: number) {
  const block = read16(system, far, 0x13a + 2 * read16(system, far, 2));
  const port = GlobalLock.call(system, block) >>> 0;
  const count = read16(system, far, 0x0a);

  if (count) {
    const file = await openPort(system, far, port);

    if (file !== 0xffff) {
      const answer = await written(system, far, file, offsetBy(far, 0x10), count);

      if (answer > 0) {
        const total = (read16(system, port, 6) | (read16(system, port, 8) << 16)) + answer;

        write16(system, port, 6, total);
        write16(system, port, 8, total >>> 16);
      }

      write16(system, far, 0x0a, 0);

      if (!read8(system, port, 0x0b)) {
        _lclose.call(system, file);
      }
    }
  }

  GlobalUnlock.call(system, block);
}

/**
 * `WriteSpool` (seg28 `08eb`): the bytes given added to the job. A job
 * straight to its port keeps them in its buffer and writes the buffer each
 * time it fills (`0c99`), so the abort procedure is asked once for each
 * 100h bytes; the answer is the bytes taken, or the write's error. -1 for
 * a job with no page. Print Manager's job, the communications driver's
 * and the network's: not followed, -1.
 */
export async function WriteSpool(this: any, hJob: number, lpData: number, cch: number) {
  const job = jobOf(this, hJob);

  if ('answer' in job) {
    return job.answer;
  }

  const far = GlobalLock.call(this, job.handle) >>> 0;
  const flags = read8(this, far, 1);

  /* Through the communications driver (`0946`): the abort procedure
   * asked before each write; a write that fails puts up its box, whose
   * Cancel gives -3. */
  if (flags & COMM && !(flags & (DIRECT | SPOOLED))) {
    const kept = read16(this, far, 0x13c);
    let left = cch & 0xffff;
    let from = lpData >>> 0;
    let answer = cch & 0xffff;

    while (left) {
      const hdc = read16(this, far, 8);

      if (hdc && !(await QueryAbort.call(this, hdc, 0))) {
        answer = -2;
        break;
      }

      let wrote = await commWrite(this, kept, from, left);

      if (wrote & 0x8000) {
        wrote &= 0x7fff;

        if ((await writeFailed(this, far, spoolingOf(this)!.commError, 0)) !== IDRETRY) {
          answer = SP_USERABORT;
          break;
        }
      }

      left -= wrote;
      from = offsetBy(from, wrote);
    }

    GlobalUnlock.call(this, job.handle);
    return answer;
  }

  if (!(flags & DIRECT) || flags & (NETWORK | SPOOLED)) {
    GlobalUnlock.call(this, job.handle);
    return SP_ERROR;
  }

  const block = read16(this, far, 0x13a + 2 * read16(this, far, 2));

  if (!block) {
    GlobalUnlock.call(this, job.handle);
    return SP_ERROR;
  }

  const port = GlobalLock.call(this, block) >>> 0;
  const file = await openPort(this, far, port);
  let answer = 0;

  if (file === 0xffff) {
    answer = SP_ERROR;
  } else {
    let left = cch & 0xffff;
    let from = lpData >>> 0;

    while (left > 0) {
      const used = read16(this, far, 0x0a);
      const step = Math.min(0x100 - used, left);

      for (let at = 0; at < step; at++) {
        write8(this, far, 0x10 + used + at, read8(this, from, at));
      }

      answer += step;
      left -= step;
      from = offsetBy(from, step);
      write16(this, far, 0x0a, used + step);

      if (used + step === 0x100) {
        const wrote = await written(this, far, file, offsetBy(far, 0x10), 0x100);

        if (wrote < 0) {
          answer = wrote;
          break;
        }

        write16(this, far, 0x0a, 0);

        const total = (read16(this, port, 6) | (read16(this, port, 8) << 16)) + wrote;

        write16(this, port, 6, total);
        write16(this, port, 8, total >>> 16);
      }
    }

    if (!read8(this, port, 0x0b)) {
      _lclose.call(this, file);
    }
  }

  GlobalUnlock.call(this, block);
  GlobalUnlock.call(this, job.handle);
  return answer;
}

/**
 * `WriteDialog` (seg28 `0e82`): for a job straight to its port, its
 * buffer written, and nought answered; Print Manager's keeps the message
 * for its own box, not followed, and the count is answered.
 */
export async function WriteDialog(this: any, hJob: number, lpMsg: number, cch: number) {
  const job = jobOf(this, hJob);

  if ('answer' in job) {
    return job.answer;
  }

  const far = GlobalLock.call(this, job.handle) >>> 0;
  let answer = cch;

  const flags = read8(this, far, 1);

  if (flags & DIRECT) {
    await flushed(this, far);
    answer = 0;
  } else if (!(flags & SPOOLED) && flags & COMM) {
    /* The communications driver's: the message in a box of its own, OK
     * only, with the job's name as its title (`0fc1`). */
    const { MessageBox } = await import('../user/MessageBox.js');

    await MessageBox.call(this, 0, stringAt(this, lpMsg >>> 0), stringAt(this, far, 0x11a), 0x1030);
  }

  GlobalUnlock.call(this, job.handle);
  return answer;
}

/**
 * `CloseJob` (seg28 `1292`): a job straight to its port has its buffer
 * written, its file closed and its blocks freed; the closing broadcast,
 * 40h with 2 and the job's handle in the high word, 2 in the low. 1.
 * Print Manager's job is marked done and left to it: not followed.
 */
export async function CloseJob(this: any, hJob: number) {
  const job = jobOf(this, hJob);

  if ('answer' in job) {
    return job.answer;
  }

  const far = GlobalLock.call(this, job.handle) >>> 0;

  if (!far) {
    return SP_ERROR;
  }

  const flags = read8(this, far, 1);

  /* The communications driver's port closed and its block freed (seg30
   * `015d`). */
  if (flags & COMM) {
    await closeCommPort(this, read16(this, far, 0x13c));
  }

  /* Print Manager's job is marked done and left to it (`138f`). */
  if (!(flags & (DIRECT | COMM))) {
    write8(this, far, 0, read8(this, far, 0) | 1);
    GlobalUnlock.call(this, job.handle);
    await broadcast(this, 2, ((job.handle << 16) | 2) >>> 0);

    return 1;
  }

  if (flags & DIRECT) {
    const slot = 0x13a + 2 * read16(this, far, 2);
    const block = read16(this, far, slot);

    if (block) {
      await flushed(this, far);

      const port = GlobalLock.call(this, block) >>> 0;
      const file = read16(this, port, 0);

      if (file !== 0xffff) {
        _lclose.call(this, file);
      }

      write16(this, port, 0, 0xffff);
      GlobalUnlock.call(this, block);
      GlobalFree.call(this, block);
      write16(this, far, slot, 0);
    }
  }

  GlobalUnlock.call(this, job.handle);
  GlobalFree.call(this, job.handle);
  await broadcast(this, 2, ((job.handle << 16) | 2) >>> 0);

  return 1;
}

/** The communications driver's port of a job closed, its block freed (seg30 `015d`). */
async function closeCommPort(system: any, kept: number) {
  if (!kept || kept === 0xffff) {
    return;
  }

  const { CloseComm } = await comm();
  const at = GlobalLock.call(system, kept) >>> 0;

  await CloseComm.call(system, read16(system, at, 2));
  GlobalUnlock.call(system, kept);
  GlobalFree.call(system, kept);
}

/**
 * `DeleteJob` (seg28 `13e0`): a job straight to its port has its file
 * closed and deleted, unwritten, and its blocks freed; the communications
 * driver's port is flushed, reset and closed (seg30 `018a`). 1. No
 * broadcast.
 */
export async function DeleteJob(this: any, hJob: number, _wDummy: number) {
  const job = jobOf(this, hJob);

  if ('answer' in job) {
    return job.answer;
  }

  const far = GlobalLock.call(this, job.handle) >>> 0;

  if (!far) {
    return SP_ERROR;
  }

  if (read8(this, far, 1) & COMM) {
    const kept = read16(this, far, 0x13c);
    const { FlushComm, EscapeCommFunction } = await comm();
    const at = GlobalLock.call(this, kept) >>> 0;
    const cid = read16(this, at, 2);

    GlobalUnlock.call(this, kept);
    FlushComm.call(this, cid, 0);
    await EscapeCommFunction.call(this, cid, 7);
    await closeCommPort(this, kept);
  }

  if (read8(this, far, 1) & DIRECT) {
    const block = read16(this, far, 0x13a + 2 * read16(this, far, 2));

    if (block) {
      const port = GlobalLock.call(this, block) >>> 0;
      const file = read16(this, port, 0);

      if (file !== 0xffff) {
        _lclose.call(this, file);
      }

      /* `DeletePathname` of the structure's path (`14ac`): DOS's delete,
       * told to `FileCdr`'s procedure. */
      const path = stringAt(this, port, 0x12);

      if (path) {
        try {
          await deleteFile.call(this.dos, path);
          await tellFileChange(this, 0x4100, path);
        } catch {
          /* Not there: nothing to delete. */
        }
      }

      GlobalUnlock.call(this, block);
      GlobalFree.call(this, block);
    }
  }

  GlobalUnlock.call(this, job.handle);
  GlobalFree.call(this, job.handle);
  return 1;
}

/**
 * `QueryAbort` (seg7 `052d`): nought for no device context; else the
 * answer of the abort procedure `SETABORTPROC` gave it, called with the
 * device context and the code; 1 with none.
 */
export async function QueryAbort(this: any, hdc: number, nCode: number) {
  if (!hdc) {
    return 0;
  }

  const surface = this.handles.resolve(hdc);
  const proc = surface?.abortProc ?? surface?.printer?.abortProc ?? 0;

  if (!proc) {
    return 1;
  }

  const answer = await this.scheduler.callProc(
    proc,
    [
      [hdc, HDC],
      [nCode, INT],
    ],
    this.scheduler.stackRegisters()
  );

  return Number(answer ?? 0) & 0xffff;
}
