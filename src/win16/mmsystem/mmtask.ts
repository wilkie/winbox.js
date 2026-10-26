'use strict';

import { segmentSelector } from '../selectors.js';
import { Executable } from '../../executable.js';
import { streamOf } from '../library.js';
import { api, W } from '../commdlg/api.js';
import { DWORD } from '../types.js';
import { exportAddress } from './mmio.js';

/**
 * MMSYSTEM's tasks of their own: `mmTaskCreate`, which starts
 * `MMTASK.TSK` to call a procedure on a task of its own, and WinBox's own
 * `MMTASK`, started where the drive has no `MMTASK.TSK`. As the Rust
 * engine's `mmsystem/mmtask.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` seg4 `05fa`-`0686` and `068a`-`0745`, and
 * of `MMTASK.TSK`'s one code segment; **recorded** by `mmtaskc`.
 */

/** The module MMSYSTEM starts, its string 7D0h (seg4 `0614`). */
export const MMTASK_FILE = 'mmtask.tsk';

/** How `LoadModule` is told to show it: 4, `SW_SHOWNOACTIVATE` (seg4 `064b`). */
const SHOW = 4;

/**
 * The command tail MMSYSTEM gives it (seg4 `0622`-`0643`): its length,
 * 13; the procedure; the double word; four noughts. `068a` copies the
 * length and the twelve bytes after it and ends the tail with a carriage
 * return (`06d9`-`06f7`).
 */
const TAIL_LENGTH = 13;

/**
 * A procedure called on a task of its own (seg4 `05fa`-`0686`): `mmtask.tsk`
 * started with `LoadModule`, the procedure and the double word in its
 * command tail, shown with 4; nought for a task started -- the task, which
 * `068a` answers from `LoadModule`'s DX (`073b`-`0740`), written where
 * `lphTask` points, where it points anywhere -- 2 for an answer of nought,
 * and 1 for any other. **Recorded** by `mmtaskc`: nought, the task the
 * procedure runs on, which is `MMTASK`'s, given the double word, and gone
 * once the procedure has come back; nought with no place for the task.
 */
export async function mmTaskCreate(this: any, lpfnTask: number, lphTask: number, dwInst: number) {
  const { startNamed } = await import('../kernel/WinExec.js');
  const bytes = [lpfnTask, lpfnTask >>> 16, dwInst, dwInst >>> 16, 0, 0].flatMap((word) => [
    word & 0xff,
    (word >>> 8) & 0xff,
  ]);
  /* The twelve bytes `068a` copies after the length, and its carriage return. */
  const tail = String.fromCharCode(...bytes.slice(0, TAIL_LENGTH - 1), 0x0d);
  const answer = await startNamed(this, MMTASK_FILE.toUpperCase(), tail, SHOW);
  const instance = answer & 0xffff;
  const task = instance >= 32 ? (answer >>> 16) & 0xffff : instance;
  const code = task > 0x20 ? 0 : task ? 1 : 2;

  if (lphTask >>> 0) {
    this.machine.cpu.core.write16(lphTask >>> 16, lphTask & 0xffff, code ? 0 : task);
  }

  return code;
}

/**
 * WinBox's own `MMTASK`, made in memory as WinBox's Program Manager is
 * (`progman/image.ts`): a task with no file behind it. Its data segment
 * keeps what the command tail gives -- the procedure at `PROC` and the
 * double word at `INSTANCE`, as `MMTASK.TSK` keeps them at 10h and 14h of
 * its own -- and `MAIN`'s far address at `MAIN_SLOT`. Its code is a start-up
 * of WinBox's: `InitTask`, then `MAIN` with the instance, then DOS's
 * function 4Ch; a failed `InitTask` ends it with 255.
 */
export const PROC = 0x10;
export const INSTANCE = 0x14;
export const MAIN_SLOT = 0x1c;
const DATA_SIZE = 0x20;

/** MMSYSTEM's ordinal for `MAIN`, where it exports nothing, beside its other procedures of its own. */
export const MAIN_ORDINAL = 1204;

const NAME = 'MMTASK';
const DESCRIPTION = 'WinBox multimedia task';
export const MMTASK_PATH = 'C:\\WINDOWS\\SYSTEM\\MMTASK.TSK';

// prettier-ignore
const CODE = [
  0x9a, 0xff, 0xff, 0x00, 0x00, // 00 call far KERNEL.InitTask
  0x0b, 0xc0, // 05 or ax, ax
  0x74, 0x09, // 07 jz 12
  0x57, // 09 push di       hInstance
  0xff, 0x1e, MAIN_SLOT, 0x00, // 0A call far [MAIN_SLOT]
  0xb4, 0x4c, // 0E mov ah, 4Ch
  0xcd, 0x21, // 10 int 21h
  0xb8, 0xff, 0x4c, // 12 mov ax, 4CFFh
  0xcd, 0x21, // 15 int 21h
];

const IMPORTS: [number, number, number][] = [
  [0x01, 1, 91], // KERNEL.InitTask
];

const NE = 0x40;
const SHIFT = 4;

/** The executable's bytes. As `mmtask.rs`'s `image`, byte for byte. */
export function image(): Uint8Array {
  const bytes: number[] = new Array(NE + 0x40).fill(0);
  const put16 = (at: number, value: number) => {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >> 8) & 0xff;
  };
  const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const counted = (text: string) => {
    bytes.push(text.length);

    for (const character of text) {
      bytes.push(character.charCodeAt(0) & 0xff);
    }
  };
  const align = () => {
    while (bytes.length % (1 << SHIFT)) {
      bytes.push(0);
    }
  };

  /* The MZ header: its signature, a page of 40h bytes, a header of four
   * paragraphs, the NE header at 40h. */
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  put16(0x02, 0x40);
  put16(0x04, 1);
  put16(0x08, 4);
  put16(0x18, 0x40);
  put16(0x3c, NE);

  const segmentTable = bytes.length;

  bytes.push(...new Array(16).fill(0));

  const resident = bytes.length;

  counted(NAME);
  bytes.push(0, 0, 0);

  const references = bytes.length;

  bytes.push(1, 0);

  const imported = bytes.length;

  bytes.push(0);
  counted('KERNEL');

  const entries = bytes.length;

  bytes.push(0, 0);

  const nonresident = bytes.length;

  counted(DESCRIPTION);
  bytes.push(0, 0, 0);

  const nonresidentSize = bytes.length - nonresident;

  /* The code segment and its relocations: each a far address (3), an
   * import by ordinal (1). */
  align();

  const code = bytes.length;

  bytes.push(...CODE);
  word(IMPORTS.length);

  for (const [offset, module, ordinal] of IMPORTS) {
    bytes.push(3, 1);
    word(offset);
    word(module);
    word(ordinal);
  }

  align();

  const data = bytes.length;

  bytes.push(...new Array(DATA_SIZE).fill(0));

  const relative = (at: number) => at - NE;
  /* `MMTASK.TSK`'s header's values: linker 5.20, flags 030Ah, no local
   * heap, a stack of 1000h, Windows 3.10 with proportional fonts. */
  const header: [number, number][] = [
    [0x00, 0x454e],
    [0x02, 0x1405],
    [0x04, relative(entries)],
    [0x06, 2],
    [0x0c, 0x030a],
    [0x0e, 2],
    [0x10, 0],
    [0x12, 0x1000],
    [0x14, 0],
    [0x16, 1],
    [0x18, 0],
    [0x1a, 2],
    [0x1c, 2],
    [0x1e, 1],
    [0x20, nonresidentSize],
    [0x22, relative(segmentTable)],
    [0x24, relative(resident)],
    [0x26, relative(resident)],
    [0x28, relative(references)],
    [0x2a, relative(imported)],
    [0x2c, nonresident],
    [0x2e, 0],
    [0x32, SHIFT],
    [0x36, 0x0802],
    [0x3e, 0x030a],
  ];

  for (const [at, value] of header) {
    put16(NE + at, value);
  }

  /* Code moveable, preloaded, with relocations, discardable (1D50h); data
   * moveable, preloaded (0C51h), as `MMTASK.TSK`'s. */
  const sector = (at: number) => at >> SHIFT;
  const table = [
    sector(code),
    CODE.length,
    0x1d50,
    CODE.length,
    sector(data),
    DATA_SIZE,
    0x0c51,
    DATA_SIZE,
  ];

  table.forEach((value, index) => put16(segmentTable + 2 * index, value));

  return new Uint8Array(bytes);
}

/** Whether a module's file named is `MMTASK.TSK`. */
export function wantedMmtask(path: string): boolean {
  return (String(path).split(/[\\:/]/).pop() ?? '').toUpperCase() === MMTASK_FILE.toUpperCase();
}

/**
 * WinBox's own `MMTASK` started as `LoadModule` starts a program: its
 * image loaded, `MAIN`'s far address written into its data. Its instance.
 */
export async function startMmtask(
  system: any,
  commandLine: string,
  show: number,
  environment?: Uint8Array,
  out?: { task?: number }
): Promise<number> {
  const { startExecutable } = await import('../kernel/WinExec.js');
  const executable: any = new Executable(NAME, MMTASK_PATH, streamOf(image()));

  /* How many of WinBox's have been started (`mmtask_test.ts`). */
  system._mmtasksStarted = (system._mmtasksStarted ?? 0) + 1;

  await executable.parse();

  return startExecutable(
    system,
    executable,
    MMTASK_PATH,
    commandLine,
    show,
    environment,
    (task: any) => {
      const loader = task.loader;
      const selector = segmentSelector(loader.translate(loader.ds));
      const main = exportAddress(system, 'MMSYSTEM', MAIN_ORDINAL);
      const core = system.machine.cpu.core;

      core.write16(selector, MAIN_SLOT, main & 0xffff);
      core.write16(selector, MAIN_SLOT + 2, main >>> 16);
    },
    out
  );
}

/**
 * What `MMTASK` does once started (`MMTASK.TSK` seg1 `0000`-`007a`): the
 * twelve bytes of its command tail kept in its data where the tail's length
 * halved is 6, and the tail's length cleared; `InitApp`;
 * `SetMessageQueue(40h)`, which failing it ends; `WaitEvent(0)`; then, where
 * the procedure has a selector, `OldYield` and the procedure called with
 * the double word, AX and DX its halves and DS the task's data; three
 * `OldYield`s; and the end.
 */
export async function mmTaskMain(this: any, hInstance: number) {
  const core = this.machine.cpu.core;
  const data = hInstance | 1;
  const task = this.handles.resolve(this.scheduler.active);
  const psp = task?.programSegment !== undefined ? segmentSelector(task.programSegment) : 0;

  if (psp && core.read8(psp, 0x80) >> 1 === 6) {
    for (let at = 0; at < 12; at++) {
      core.write8(data, PROC + at, core.read8(psp, 0x81 + at));
    }
  }

  if (psp) {
    core.write16(psp, 0x80, 0);
  }

  await api(this, 'USER', 'InitApp', [W(hInstance)]);

  if (!(await api(this, 'USER', 'SetMessageQueue', [W(0x40)])).value) {
    return 0;
  }

  await api(this, 'KERNEL', 'WaitEvent', [W(0)]);

  const proc = ((core.read16(data, PROC + 2) << 16) | core.read16(data, PROC)) >>> 0;
  const low = core.read16(data, INSTANCE);
  const high = core.read16(data, INSTANCE + 2);

  if (proc >>> 16) {
    await api(this, 'KERNEL', 'OldYield', []);
    await this.scheduler.callProc(proc, [[((high << 16) | low) >>> 0, DWORD]], {
      ax: low,
      dx: high,
      ds: data,
    });
  }

  for (let times = 0; times < 3; times++) {
    await api(this, 'KERNEL', 'OldYield', []);
  }

  return 0;
}
