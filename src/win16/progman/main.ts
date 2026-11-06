'use strict';

import { type Arg, B, D, W, api, buffer, send, stringOf, text, word } from '../commdlg/api.js';
import { segmentSelector } from '../selectors.js';
import { Executable } from '../../executable.js';
import { streamOf } from '../library.js';
import { WINMAIN_SLOT, image } from './image.js';
import { Progman } from './index.js';
import { dde, isDde } from './dde.js';
import { forget, groups, load, save } from './loaded.js';
import { command } from './run.js';
import { startUpKeys } from '../../layers/groups.js';
import { D_STARTED_IN, D_WINDOWS, currentDirectory, startPrograms } from './shell.js';

/**
 * Program Manager's `WinMain` and its frame's window procedure, as
 * `PROGMAN.EXE`'s are read out (`kb/topics/program-manager-dde.md`):
 * `WinMain` seg1 `0010`, its start-up seg3 `09fd`, the frame's procedure
 * seg2 `2229`. Every call into KERNEL, USER and SHELL is made as the file
 * makes it (`commdlg/api.ts`), and what the file keeps in its data segment
 * is kept at the same places in the instance's own (`D_*`). As
 * `crates/winbox-win16/src/progman/main.rs`.
 *
 * Its groups are `loaded.ts`'s, their items `items.ts`'s, their windows'
 * procedure `window.ts`'s. What it does not do yet, each left where the file
 * does it: its own icons 2 and 7 and its accelerators (its icons are
 * `PROGMAN.EXE`'s in the asset bundle's store, `stored.ts`); as the shell,
 * `load=` and `run=` and ending Windows; its command line; and the messages
 * of its menus and help. WinBox's is hidden, by the owner's decision: its
 * frame is never shown, so it is not painted or made active.
 */

/* What `PROGMAN.EXE` keeps in its data segment (seg8), by its places. */
export const D_MIN_ON_RUN = 0x12;
export const D_AUTO_ARRANGE = 0x14;
const D_SAVE_SETTINGS = 0x1c;
export const D_SHELL = 0x18;
const D_NO_RUN = 0x28;
const D_NO_CLOSE = 0x2a;
export const D_NO_SAVE_SETTINGS = 0x2c;
const D_NO_FILE_MENU = 0x2e;
const D_EDIT_LEVEL = 0x12e;
export const D_CLOSING = 0x32;
/** Set while a group's window is made (seg4 `1e44`). */
export const D_CREATING = 0x16;
/** `PROGMAN.INI` found read-only as start-up read it. */
export const D_INI_READ_ONLY = 0x1e;
/** Saving's errors shown (seg4 `285c`), and an item left with no icon (seg4 `1ae9`). */
export const D_SAVE_ERRORS = 0x30;
export const D_LOST_ICONS = 0x34;
/** Set while a group's file is read as it loads (seg4 `1e77`). */
export const D_LOADING = 0x162;
/** Set while a group's scroll bars are fitted (seg2 `0b29`). */
export const D_SCROLLING = 0x15c;
/**
 * The metrics start-up keeps (seg3 `0a43`-`0b07`): `SM_CYBORDER`; two
 * `SM_CXBORDER`s and two `SM_CYBORDER`s; `SM_CXICON` and `SM_CYICON`; an
 * icon's cell, the icon and four borders each way; the icons' spacing across
 * and down; `IconTitleWrap`; and the font of the icons' titles.
 */
export const D_BORDER_Y = 0x798;
export const D_BORDER_X = 0x446;
const D_BORDERS_Y = 0x44c;
const D_CX_ICON = 0x76e;
const D_CY_ICON = 0x770;
export const D_CELL_X = 0x444;
export const D_CELL_Y = 0x44a;
export const D_ACROSS = 0x4d4;
export const D_DOWN = 0x558;
export const D_TITLE_WRAP = 0x24;
export const D_TITLE_FONT = 0x124;
/** The frame, which a second instance asks for by `GetInstanceData`. */
export const D_FRAME = 0x126;
const D_OTHER_WINDOW = 0x132;
const D_ACTIVATE_SHELL = 0x134;
const D_SHELL_HELP = 0x81c;
const D_COMMDLG_HELP = 0x450;
export const D_INSTANCE = 0x72a;
/** The MDI client. */
export const D_CLIENT = 0x76c;

const WM_CREATE = 0x01;
const WM_DESTROY = 0x02;
const WM_SIZE = 0x05;
export const WM_CLOSE = 0x10;
const WM_ENDSESSION = 0x16;
const WM_COMMAND = 0x111;
const WM_SYSCOMMAND = 0x112;
/** A second instance's, and a program's it started (seg2 `2762`). */
const WM_ACTIVATE_FIRST = 0x464;
const SC_CLOSE = 0xf060;
const SIZE_MINIMIZED = 1;

/** The ordinals of `Progman`'s exports. */
const WINMAIN_ORDINAL = 1;
const FRAME_PROC = 2;
const GROUP_PROC = 3;

/** The file's name, and where it says it is. */
export const FILE = 'PROGMAN.EXE';
export const PATH = 'C:\\WINDOWS\\PROGMAN.EXE';

/** Its profile, by the name it loads (string 6). */
export const INI = 'PROGMAN.INI';

/** Its menu, as `PROGMAN.EXE`'s menu 5 has it; a separator is nought and nothing. */
const MENU: [string, [number, string][]][] = [
  [
    '&File',
    [
      [101, '&New...'],
      [102, '&Open\tEnter'],
      [103, '&Move...\tF7'],
      [104, '&Copy...\tF8'],
      [105, '&Delete\tDel'],
      [106, '&Properties...\tAlt+Enter'],
      [0, ''],
      [107, '&Run...'],
      [0, ''],
      [108, 'E&xit Windows...'],
    ],
  ],
  [
    '&Options',
    [
      [201, '&Auto Arrange'],
      [202, '&Minimize on Use'],
      [204, '&Save Settings on Exit'],
    ],
  ],
  [
    '&Window',
    [
      [301, '&Cascade\tShift+F5'],
      [302, '&Tile\tShift+F4'],
      [303, '&Arrange Icons'],
    ],
  ],
  [
    '&Help',
    [
      [401, '&Contents'],
      [404, '&Search for Help on...'],
      [0, ''],
      [402, '&How to Use Help'],
      [405, '&Windows Tutorial'],
      [0, ''],
      [403, '&About Program Manager...'],
    ],
  ],
];

export const bytesOf = (value: string) =>
  Array.from(value, (character) => character.charCodeAt(0) & 0xff);
export const string = (value: string) => text(bytesOf(value));
export const latin = (bytes: number[]) => String.fromCharCode(...bytes);

/**
 * The menu as a template for `LoadMenuIndirect`: a header of two noughts,
 * each popup `MF_POPUP` and its title, each item its flags, identifier and
 * text, the last of each list `MF_END`.
 */
export function menuTemplate(): number[] {
  const MF_POPUP = 0x10;
  const MF_END = 0x80;
  const bytes = [0, 0, 0, 0];

  MENU.forEach(([title, items], index) => {
    const last = index + 1 === MENU.length ? MF_END : 0;

    bytes.push(MF_POPUP | last, 0, ...bytesOf(title), 0);
    items.forEach(([id, label], at) => {
      bytes.push(at + 1 === items.length ? MF_END : 0, 0, id & 0xff, id >> 8, ...bytesOf(label), 0);
    });
  });

  return bytes;
}

/** Whether a program asked for by its path, found nowhere, is Program Manager's: its file's name `PROGMAN.EXE`. */
export function wanted(path: string): boolean {
  return (
    (
      String(path)
        .split(/[\\:/]/)
        .pop() ?? ''
    ).toUpperCase() === FILE
  );
}

/** The far address of one of `Progman`'s exports: its stub. */
function exportAddress(system: any, ordinal: number): number {
  const info = system._modules.load(Progman).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}

/** WinBox's code kept, once: its database and data, as a module WinBox keeps; its handle. */
function keep(system: any): number {
  if (!system._progmanKept) {
    system.keep(Progman, 'moveable');
    system._progmanKept = system._modules.handleFromPath(PATH);
  }

  return system._progmanKept;
}

/**
 * Program Manager started as `WinExec` starts a program, with no file: WinBox's
 * code kept, its program loaded from the image, linked, `WinMain`'s address
 * written where the start-up calls it from (its stubs made), its module given
 * the kept module's handle, and the task run until it first gives the
 * processor up. Its instance. As `Engine::start_progman`.
 */
export async function startProgman(
  system: any,
  commandLine: string,
  show: number,
  environment?: Uint8Array,
  out?: { task?: number }
): Promise<number> {
  const { startExecutable } = await import('../kernel/WinExec.js');
  const handle = keep(system);
  const executable: any = new Executable('PROGMAN', PATH, streamOf(image()));

  await executable.parse();

  return startExecutable(system, executable, PATH, commandLine, show, environment, (task: any) => {
    const loader = task.loader;
    const selector = segmentSelector(loader.translate(loader.ds));
    const winmain = exportAddress(system, WINMAIN_ORDINAL);
    const core = system.machine.cpu.core;

    core.write16(selector, WINMAIN_SLOT, winmain & 0xffff);
    core.write16(selector, WINMAIN_SLOT + 2, winmain >>> 16);
    system._modules._handles[PATH] = handle;
  }, out);
}

/**
 * Program Manager started as the shell of an install run, as Windows started
 * as `WIN SETUP.EXE` starts it: the first task, before any other, so the only
 * one as it starts (seg3 `0b88`), given the installer as its command line,
 * which it starts itself once its groups are loaded, in the installer's own
 * directory (`shell.ts`). Microsoft's, where the drive has
 * `C:\WINDOWS\PROGMAN.EXE`; else WinBox's own, made as `startProgman` makes
 * it. Its task kept as the run's shell (`_shellTask`), and run. As
 * `progman::start_shell`.
 */
export async function startShell(system: any, commandLine: string): Promise<number> {
  const file = await system.dos.files.query('C')?.open(['WINDOWS', FILE]);
  const own = !file || file.info?.directory;
  const executable: any = new Executable('PROGMAN', PATH, own ? streamOf(image()) : file);

  await executable.parse();

  const handle = await system.load(executable);

  system.link(handle);
  system._shellTask = handle;
  system.run(handle, { commandLine });

  /* Written once the task is made, as `startProgman` writes it. */
  if (own) {
    const kept = keep(system);
    const loader = system.handles.resolve(handle).loader;
    const selector = segmentSelector(loader.translate(loader.ds));
    const winmain = exportAddress(system, WINMAIN_ORDINAL);
    const core = system.machine.cpu.core;

    core.write16(selector, WINMAIN_SLOT, winmain & 0xffff);
    core.write16(selector, WINMAIN_SLOT + 2, winmain >>> 16);
    system._modules._handles[PATH] = kept;
  }

  return handle;
}

/**
 * Whether an install run's shell is the only task left of several
 * (`startShell`): another has run and every other has ended. As
 * `System::shell_alone`.
 */
export function shellAlone(system: any): boolean {
  const shell = system?._shellTask;

  if (!shell) {
    return false;
  }

  const others = Object.entries(system.scheduler._tasks ?? {})
    .filter(([handle]) => Number(handle) !== shell)
    .map(([, task]) => task as any);

  return others.length > 0 && others.every((task) => task.ended);
}

/** One instance's Program Manager, as its calls are made: the system and its data segment. */
export class Pm {
  declare system: any;
  declare ds: number;

  constructor(system: any, instance: number) {
    this.system = system;
    /* Its data segment's selector, one above the instance (`instds`). */
    this.ds = (instance + 1) & 0xffff;
  }

  get core() {
    return this.system.machine.cpu.core;
  }

  /** Bytes at a far address. */
  readFar(far: number, length: number): number[] {
    const selector = far >>> 16;
    const offset = far & 0xffff;

    return Array.from(
      { length },
      (_, i) => this.core.read8(selector, (offset + i) & 0xffff) & 0xff
    );
  }

  /** A place in its data, as a far address. */
  at(offset: number): number {
    return ((this.ds << 16) | (offset & 0xffff)) >>> 0;
  }

  /** A string at a far address, up to its nought. */
  readString(far: number): number[] {
    const bytes: number[] = [];

    for (let at = far & 0xffff; bytes.length < 0x10000; at = (at + 1) & 0xffff) {
      const byte = this.core.read8(far >>> 16, at) & 0xff;

      if (!byte) {
        break;
      }

      bytes.push(byte);
    }

    return bytes;
  }

  /** Bytes written at a far address. */
  writeFar(far: number, bytes: number[]) {
    const selector = far >>> 16;
    const offset = far & 0xffff;

    bytes.forEach((byte, i) => this.core.write8(selector, (offset + i) & 0xffff, byte & 0xff));
  }

  /** `SendMessage`. */
  send(hwnd: number, message: number, wParam: number, lParam: number) {
    return send(this.system, hwnd, message, wParam, lParam);
  }

  d16(offset: number): number {
    return this.core.read16(this.ds, offset) & 0xffff;
  }

  sd16(offset: number, value: number) {
    this.core.write16(this.ds, offset, value & 0xffff);
  }

  call(module: string, name: string, args: Arg[]) {
    return api(this.system, module, name, args);
  }

  async user(name: string, args: Arg[]): Promise<number> {
    return (await this.call('USER', name, args)).value;
  }

  async kernel(name: string, args: Arg[]): Promise<number> {
    return (await this.call('KERNEL', name, args)).value;
  }

  /** A KERNEL call that works on DS, made with DS its data segment. */
  async kernelInDs(name: string, args: Arg[]): Promise<number> {
    const saved = this.core.ds;

    this.core.ds = this.ds;

    try {
      return await this.kernel(name, args);
    } finally {
      this.core.ds = saved;
    }
  }

  /** Bytes on its stack, for a structure that points at them: their far address, and the stack pointer to give back. */
  reserve(bytes: number[]): [number, number] {
    const core = this.core;
    const saved = core.sp & 0xffff;
    const at = (saved - ((bytes.length + 1) & ~1)) & 0xffff;

    core.sp = at;
    bytes.forEach((byte, i) => core.write8(core.ss, (at + i) & 0xffff, byte));

    return [((core.ss << 16) | at) >>> 0, saved];
  }

  release(saved: number) {
    this.core.sp = saved;
  }

  /** `GetPrivateProfileInt(section, key, default, "PROGMAN.INI")`. */
  async profileInt(section: string, key: string, fallback: number): Promise<number> {
    return (
      (await this.kernel('GetPrivateProfileInt', [
        string(section),
        string(key),
        W(fallback),
        string(INI),
      ])) & 0xffff
    );
  }

  /** `GetPrivateProfileString` into a buffer of `size`: what it read. */
  async profileString(
    section: string,
    key: string | null,
    size: number,
    file: string
  ): Promise<string> {
    const called = await this.call('KERNEL', 'GetPrivateProfileString', [
      string(section),
      key === null ? D(0) : string(key),
      string(''),
      buffer(size),
      W(size),
      string(file),
    ]);

    /* The buffer, after the strings laid out before it. */
    return latin(stringOf(called, key === null ? 2 : 3));
  }
}

/**
 * `WinMain` (seg1 `0010`): a command line makes the show command 7,
 * `SW_SHOWMINNOACTIVE`; the start-up; and the message loop, until `WM_QUIT`,
 * whose `wParam` it answers. A start-up that fails answers nought.
 */
export async function WINMAIN(
  this: any,
  instance: number,
  previous: number,
  line: number,
  show: number
) {
  const pm = new Pm(this, instance & 0xffff);
  const commandLine = line === 0 ? '' : latin(pm.readString(line >>> 0));

  if (
    !(await start(
      pm,
      instance & 0xffff,
      previous & 0xffff,
      commandLine ? 7 : show & 0xffff,
      commandLine
    ))
  ) {
    return 0;
  }

  const quit = await messageLoop(pm);

  forget(pm);

  return quit;
}

/**
 * The loop (seg1 `003e`-`00e3`): each message taken, offered to the MDI
 * client's system menu keys, and else translated and dispatched. The file's
 * own keys -- its accelerators, and the frame's when it is active -- are not
 * here: it has no accelerators, and its frame is never active.
 */
async function messageLoop(pm: Pm): Promise<number> {
  for (;;) {
    const called = await pm.call('USER', 'GetMessage', [buffer(18), W(0), W(0), W(0)]);
    const message = called.buffers[0];

    if ((called.value & 0xffff) === 0) {
      return message[4] | (message[5] << 8);
    }

    const taken = await pm.user('TranslateMDISysAccel', [W(pm.d16(D_CLIENT)), B(message)]);

    if ((taken & 0xffff) === 0) {
      await pm.user('TranslateMessage', [B(message)]);
      await pm.user('DispatchMessage', [B(message)]);
    }
  }
}

/** The start-up (seg3 `09fd`): whether it went on to the loop. */
async function start(
  pm: Pm,
  instance: number,
  previous: number,
  show: number,
  commandLine: string
): Promise<boolean> {
  pm.sd16(D_INSTANCE, instance);

  /* A second instance: the first's frame by `GetInstanceData`, sent 464h,
   * and the end (`0a12`-`0a3e`). */
  if (previous) {
    await pm.kernelInDs('GetInstanceData', [W(previous), W(D_FRAME), W(2)]);

    const frame = pm.d16(D_FRAME);

    if (frame) {
      await send(pm.system, frame, WM_ACTIVATE_FIRST, 0, 0);
    }

    return false;
  }

  if (!(await keepMetrics(pm))) {
    return false;
  }

  /* The directory current as it starts (`0b31`-`0b37`). */
  pm.writeFar(pm.at(D_STARTED_IN), [...bytesOf(await currentDirectory(pm)), 0]);

  /* SYSTEM.INI's path: the Windows directory, kept (`0b3c`-`0b43`), a
   * backslash where it is longer than a root's, and `system.ini`
   * (`0b48`-`0b78`). */
  const directory = latin(
    stringOf(await pm.call('KERNEL', 'GetWindowsDirectory', [buffer(0x81), W(0x81)]), 0)
  );

  pm.writeFar(pm.at(D_WINDOWS), [...bytesOf(directory), 0]);
  const systemIni = `${directory}${directory.length > 3 ? '\\' : ''}system.ini`;

  groups(pm).systemIni = systemIni;

  /* The shell: the only task, or `shell=` holding `PROGMAN.EXE` at any place
   * along it, without regard to case (`0b88`-`0c0a`). */
  const shell =
    ((await pm.kernel('GetNumTasks', [])) & 0xffff) === 1 ||
    holdsProgman(await pm.profileString('Boot', 'shell', 0x80, systemIni));

  pm.sd16(D_SHELL, shell ? 1 : 0);
  await pm.kernel('SetErrorMode', [W(1)]);
  pm.sd16(D_CLOSING, 0);

  for (const [place, name] of [
    [D_SHELL_HELP, 'ShellHelp'],
    [D_COMMDLG_HELP, 'commdlg_help'],
    [D_OTHER_WINDOW, 'OTHERWINDOWCREATED'],
    [D_ACTIVATE_SHELL, 'ACTIVATESHELLWINDOW'],
  ] as [number, string][]) {
    pm.sd16(place, await pm.user('RegisterWindowMessage', [string(name)]));
  }

  if (!(await registerFrame(pm, instance)) || !(await registerGroup(pm, instance))) {
    return false;
  }

  /* Its settings, the frame placed and made, the groups loaded and the
   * display written (seg3 `08ff`). */
  const window = await settings(pm);
  const place = (window && windowNumbers(window)) || [0x8000, 0x8000, 0, 0, 1];
  const shown = show === 1 ? place[4] : show;
  const frame = await createFrame(pm, instance, place, shown);

  if (!frame) {
    return false;
  }

  await loadGroups(pm, systemIni);
  await pm.user('ShowWindow', [W(pm.d16(D_CLIENT)), W(1)]);

  /* As the shell, `load=` and `run=`; then its command line (`0e15`-`0ecd`). */
  await startPrograms(pm, commandLine);

  return true;
}

/** Whether a `shell=` line holds `PROGMAN.EXE` at some place along it, eleven characters at a time. */
export function holdsProgman(line: string): boolean {
  return line.toUpperCase().includes(FILE);
}

/**
 * `RegisterClass` of the frame's class, `Progman` (string 2): byte-aligned
 * (`CS_BYTEALIGNWINDOW`), its procedure WinBox's `FRAMEWNDPROC`, the arrow
 * cursor, no background brush (seg3 `0d02`-`0d6e`). It has no icon of its
 * own, and its menu is made as the frame is (`createFrame`).
 */
async function registerFrame(pm: Pm, instance: number): Promise<boolean> {
  const cursor = (await pm.user('LoadCursor', [W(0), D(0x7f00)])) & 0xffff;
  const procedure = exportAddress(pm.system, FRAME_PROC);
  const [name, saved] = pm.reserve([...bytesOf('Progman'), 0]);
  const words = (values: number[]) =>
    values.flatMap((value) => [value & 0xff, (value >> 8) & 0xff]);
  const longs = (value: number) => words([value & 0xffff, value >>> 16]);
  const wndclass = [
    ...words([0x1000]),
    ...longs(procedure),
    ...words([0, 0, instance, 0, cursor, 0]),
    ...longs(0),
    ...longs(name),
  ];

  try {
    return ((await pm.user('RegisterClass', [B(wndclass)])) & 0xffff) !== 0;
  } finally {
    pm.release(saved);
  }
}

/**
 * `RegisterClass` of the groups' class, `PMGroup` (string 3): double clicks
 * (`CS_DBLCLKS`), its procedure WinBox's `GROUPWNDPROC`, a word of its own for
 * the group, the arrow cursor, `COLOR_WINDOW + 1` its background (seg3
 * `0d73`-`0dd6`). Its icon, PROGMAN.EXE's icon 1, it has not.
 */
async function registerGroup(pm: Pm, instance: number): Promise<boolean> {
  const cursor = (await pm.user('LoadCursor', [W(0), D(0x7f00)])) & 0xffff;
  const procedure = exportAddress(pm.system, GROUP_PROC);
  const [name, saved] = pm.reserve([...bytesOf('PMGroup'), 0]);
  const words = (values: number[]) =>
    values.flatMap((value) => [value & 0xff, (value >> 8) & 0xff]);
  const longs = (value: number) => words([value & 0xffff, value >>> 16]);
  const wndclass = [
    ...words([0x0008]),
    ...longs(procedure),
    ...words([0, 2, instance, 0, cursor, 6]),
    ...longs(0),
    ...longs(name),
  ];

  try {
    return ((await pm.user('RegisterClass', [B(wndclass)])) & 0xffff) !== 0;
  } finally {
    pm.release(saved);
  }
}

/**
 * The metrics start-up keeps for placing icons (seg3 `0a43`-`0b0c`):
 * `SM_CYBORDER`; `SM_CXICON`, `SM_CYICON`; two `SM_CXBORDER`s and two
 * `SM_CYBORDER`s; a cell each way, the icon and twice those; the icons'
 * spacing across and down and `IconTitleWrap` (`SystemParametersInfo` 13, 18h,
 * 19h); and the icons' title font, made from `SPI_GETICONTITLELOGFONT` --
 * without which it does not start.
 *
 * Not followed: its icons 2 and 7 and its accelerators, which it has not.
 */
async function keepMetrics(pm: Pm): Promise<boolean> {
  const metric = async (index: number) => (await pm.user('GetSystemMetrics', [W(index)])) & 0xffff;

  pm.sd16(D_BORDER_Y, await metric(6));
  pm.sd16(D_CX_ICON, await metric(11));
  pm.sd16(D_CY_ICON, await metric(12));
  pm.sd16(D_BORDER_X, (await metric(5)) * 2);
  pm.sd16(D_BORDERS_Y, (await metric(6)) * 2);
  pm.sd16(D_CELL_X, pm.d16(D_BORDER_X) * 2 + pm.d16(D_CX_ICON));
  pm.sd16(D_CELL_Y, pm.d16(D_BORDERS_Y) * 2 + pm.d16(D_CY_ICON));

  for (const [action, place] of [
    [13, D_ACROSS],
    [0x18, D_DOWN],
    [0x19, D_TITLE_WRAP],
  ]) {
    const called = await pm.call('USER', 'SystemParametersInfo', [
      W(action),
      W(0),
      buffer(2),
      W(0),
    ]);

    pm.sd16(place, called.buffers[0][0] | (called.buffers[0][1] << 8));
  }

  const logfont = (
    await pm.call('USER', 'SystemParametersInfo', [W(0x1f), W(0x32), buffer(0x32), W(0)])
  ).buffers[0];
  const font = (await pm.call('GDI', 'CreateFontIndirect', [B(logfont)])).value & 0xffff;

  pm.sd16(D_TITLE_FONT, font);

  return font !== 0;
}

/**
 * A DOS call on a path, as seg5's helpers make one: AX as given, DS:DX the
 * path with its nought on the stack. The carry, and AX after.
 */
export async function dosPath(pm: Pm, ax: number, path: string) {
  const core = pm.core;
  const [far, savedSp] = pm.reserve([...bytesOf(path), 0]);
  const saved = { ax: core.ax, dx: core.dx, ds: core.ds, carry: core.flags.carry };

  core.ax = ax;
  core.dx = far & 0xffff;
  core.ds = far >>> 16;

  try {
    await pm.call('KERNEL', 'Dos3Call', []);

    return { carry: !!core.flags.carry, ax: core.ax & 0xffff };
  } finally {
    core.ax = saved.ax;
    core.dx = saved.dx;
    core.ds = saved.ds;
    core.flags.carry = saved.carry;
    pm.release(savedSp);
  }
}

/**
 * A DOS call as seg5's helpers make one with no path: AX and DX as given, and
 * DS:SI a buffer of `buffer`'s bytes on the stack, for function 47h. The
 * carry, AX after, and the buffer as DOS left it. As `main.rs`'s `dos`.
 */
export async function dos(pm: Pm, ax: number, dx: number, buffer: number[]) {
  const core = pm.core;
  const [far, savedSp] = pm.reserve(buffer);
  const saved = { ax: core.ax, dx: core.dx, si: core.si, ds: core.ds, carry: core.flags.carry };

  core.ax = ax;
  core.dx = dx;
  core.si = far & 0xffff;
  core.ds = far >>> 16;

  try {
    await pm.call('KERNEL', 'Dos3Call', []);

    return {
      carry: !!core.flags.carry,
      ax: core.ax & 0xffff,
      bytes: Array.from(
        { length: buffer.length },
        (_, i) => core.read8(far >>> 16, ((far & 0xffff) + i) & 0xffff) & 0xff
      ),
    };
  } finally {
    core.ax = saved.ax;
    core.dx = saved.dx;
    core.si = saved.si;
    core.ds = saved.ds;
    core.flags.carry = saved.carry;
    pm.release(savedSp);
  }
}

/**
 * Its settings (seg3 `02e3`): `[Settings]` `MinOnRun`, `AutoArrange` and
 * `SaveSettings`, defaults 0, 0 and 1; `[Restrictions]` `NoRun`, `NoClose`,
 * `NoSaveSettings` and `EditLevel`, `NoSaveSettings` turning `SaveSettings`
 * off; and `Window=`, if there is one.
 */
async function settings(pm: Pm): Promise<string | null> {
  for (const [place, section, key, fallback] of [
    [D_MIN_ON_RUN, 'Settings', 'MinOnRun', 0],
    [D_AUTO_ARRANGE, 'Settings', 'AutoArrange', 0],
    [D_SAVE_SETTINGS, 'Settings', 'SaveSettings', 1],
    [D_NO_RUN, 'Restrictions', 'NoRun', 0],
    [D_NO_CLOSE, 'Restrictions', 'NoClose', 0],
    [D_NO_SAVE_SETTINGS, 'Restrictions', 'NoSaveSettings', 0],
    [D_EDIT_LEVEL, 'Restrictions', 'EditLevel', 0],
  ] as [number, string, string, number][]) {
    pm.sd16(place, await pm.profileInt(section, key, fallback));
  }

  if (pm.d16(D_NO_SAVE_SETTINGS)) {
    pm.sd16(D_SAVE_SETTINGS, 0);
  }

  const window = await pm.profileString('Settings', 'Window', 0xa0, INI);

  return window || null;
}

/**
 * `Window=`'s five numbers, as seg3 `092c`-`099c` reads them: each after what
 * is not a digit or `-`, read as seg3 `0285` reads one; fewer than five, and
 * none of them is used.
 */
export function windowNumbers(line: string): number[] | null {
  const number = (character: string) => /[0-9-]/.test(character);
  const numbers: number[] = [];
  let at = 0;

  for (let i = 0; i < 5; i++) {
    while (at < line.length && !number(line[at])) {
      at++;
    }

    if (at === line.length) {
      return null;
    }

    numbers.push(readNumber(line.slice(at)));

    while (at < line.length && number(line[at])) {
      at++;
    }
  }

  return numbers;
}

/** A number as seg3 `0285` reads one: an optional `-`, then decimal digits up to the first other character. */
export function readNumber(value: string): number {
  const negative = value[0] === '-';
  let result = 0;

  for (const character of negative ? value.slice(1) : value) {
    if (character < '0' || character > '9') {
      break;
    }

    result = (result * 10 + character.charCodeAt(0) - 0x30) & 0xffff;
  }

  return negative ? -result & 0xffff : result;
}

/**
 * The frame (seg3 `045c`): `CreateWindow` of `Progman`, "Program Manager"
 * (string 1), `WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN`, at the place given --
 * `CW_USEDEFAULT` with no `Window=` -- with its menu; `E&xit Windows...` made
 * `E&xit` where it is not the shell (string 124); the File menu gone with
 * `NoFileMenu`, Save Settings greyed with `NoSaveSettings`, and the options
 * on checked. The file then shows it as `show` says, and paints its client:
 * WinBox's is hidden, so neither.
 */
async function createFrame(pm: Pm, instance: number, place: number[], _show: number) {
  const menu = (await pm.user('LoadMenuIndirect', [B(menuTemplate())])) & 0xffff;
  const [left, top, right, bottom] = place;
  const frame =
    (await pm.user('CreateWindow', [
      string('Progman'),
      string('Program Manager'),
      D(0x02cf0000),
      W(left),
      W(top),
      W(right - left),
      W(bottom - top),
      W(0),
      W(menu),
      W(instance),
      D(0),
    ])) & 0xffff;

  pm.sd16(D_FRAME, frame);

  if (!frame) {
    return 0;
  }

  const bar = (await pm.user('GetMenu', [W(frame)])) & 0xffff;

  if (!pm.d16(D_SHELL)) {
    await pm.user('ModifyMenu', [W(bar), W(108), W(0), W(108), string('E&xit')]);
  }

  if (await pm.profileInt('Restrictions', 'NoFileMenu', 0)) {
    await pm.user('DeleteMenu', [W(bar), W(0), W(0x400)]);
    pm.sd16(D_NO_FILE_MENU, 1);
  }

  if (pm.d16(D_NO_SAVE_SETTINGS)) {
    pm.sd16(D_SAVE_SETTINGS, 0);
    await pm.user('EnableMenuItem', [W(bar), W(204), W(3)]);
  }

  for (const [place, item] of [
    [D_MIN_ON_RUN, 202],
    [D_AUTO_ARRANGE, 201],
    [D_SAVE_SETTINGS, 204],
  ]) {
    if (pm.d16(place)) {
      await pm.user('CheckMenuItem', [W(bar), W(item), W(8)]);
    }
  }

  return frame;
}

/**
 * The groups (seg3 `0809`, `06c1`): `[Groups]`' keys (a buffer of 140h) and
 * `Order=` (7Fh) read and put in the order start-up loads them
 * (`startUpKeys`); each key's path read (78h, `0875`-`088b`) and, where there
 * is one, the group loaded with the number after `GROUP` (`0832`-`085b`,
 * `load`); then `[Settings]` `display.drv=` written with `SYSTEM.INI`'s
 * `[boot]` `display.drv=` (`08ab`-`08d8`).
 */
export async function loadGroups(pm: Pm, systemIni: string) {
  const list = (
    await pm.call('KERNEL', 'GetPrivateProfileString', [
      string('Groups'),
      D(0),
      string(''),
      buffer(0x140),
      W(0x140),
      string(INI),
    ])
  ).buffers[2];
  const order = await pm.profileString('Settings', 'Order', 0x7f, INI);

  for (const key of startUpKeys(latin(list), order)) {
    const path = await pm.profileString('Groups', key, 0x78, INI);

    if (path) {
      let n = 0;

      for (const digit of key.slice(5)) {
        n = (n * 10 + digit.charCodeAt(0) - 0x30) & 0xffff;
      }

      await load(pm, path, n);
    }
  }

  const display = await pm.profileString('Boot', 'display.drv', 0x78, systemIni);

  await pm.kernel('WritePrivateProfileString', [
    string('Settings'),
    string('display.drv'),
    string(display),
    string(INI),
  ]);
}

/** The frame's window procedure (seg2 `2229`). */
export async function FRAMEWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const instance = await word(this, 'USER', 'GetWindowWord', [W(hwnd), W(0xfffa)]);
  const pm = new Pm(this, instance);

  return frameMessage(pm, hwnd & 0xffff, message & 0xffff, wParam & 0xffff, lParam >>> 0);
}

/** What the frame answers a message. */
async function frameMessage(
  pm: Pm,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
): Promise<number> {
  switch (message) {
    case WM_CREATE:
      return created(pm, hwnd);
    case WM_DESTROY:
      /* `2410`-`2483`: SHELL's hook let go, and the loop ended. Help and pen
       * windows, which it has had nothing of, are not. */
      await pm.call('SHELL', 'RegisterShellHook', [W(hwnd), W(0)]);
      await pm.user('PostQuitMessage', [W(0)]);
      return 0;
    case WM_SIZE:
      /* `268b`: the MDI client sized to the frame's client, a pixel past it
       * each way, unless the frame is an icon. */
      if (wParam !== SIZE_MINIMIZED) {
        await pm.user('MoveWindow', [
          W(pm.d16(D_CLIENT)),
          W(0xffff),
          W(0xffff),
          W((lParam & 0xffff) + 2),
          W((lParam >>> 16) + 2),
          W(1),
        ]);
      }

      return 0;
    case WM_CLOSE:
      return close(pm, hwnd, message, wParam, lParam);
    case WM_COMMAND:
      /* `28d3`: its commands (seg5 `05cc`), `DefFrameProc` taking the rest. */
      if (await command(pm, wParam)) {
        return 0;
      }

      return defaultProc(pm, hwnd, message, wParam, lParam);
    case WM_ENDSESSION:
      /* `2353`: the settings saved where Windows ends, `SaveSettings` is on
       * and `NoClose` is not (`save`). */
      if (wParam && !pm.d16(D_NO_CLOSE) && pm.d16(D_SAVE_SETTINGS)) {
        await save(pm);
      }

      return 0;
    case WM_ACTIVATE_FIRST:
      await activated(pm, hwnd);
      return 0;
  }

  /* `228c`-`2296`, `2486`: DDE, seg7's, answered nought. */
  if (isDde(message)) {
    await dde(pm, hwnd, message, wParam, lParam);
    return 0;
  }

  /* `26b1`: with `NoClose`, `SC_CLOSE` does nothing. */
  if (message === WM_SYSCOMMAND && pm.d16(D_NO_CLOSE) && wParam === SC_CLOSE) {
    return 0;
  }

  if (message === pm.d16(D_ACTIVATE_SHELL)) {
    /* `22b9`-`22d4`: restored where it is an icon, else brought to the top. */
    if ((await pm.user('IsIconic', [W(hwnd)])) & 0xffff) {
      await pm.user('ShowWindow', [W(hwnd), W(9)]);
    } else {
      await pm.user('BringWindowToTop', [W(hwnd)]);
    }

    return 0;
  }

  /* `1fb8`: a window made by a program one of its items started gets the
   * item's hot key; with no groups, there are none. */
  if (message === pm.d16(D_OTHER_WINDOW)) {
    return 0;
  }

  return defaultProc(pm, hwnd, message, wParam, lParam);
}

/** `DefFrameProc` with the MDI client (`29be`). */
function defaultProc(pm: Pm, hwnd: number, message: number, wParam: number, lParam: number) {
  return pm.user('DefFrameProc', [W(hwnd), W(pm.d16(D_CLIENT)), W(message), W(wParam), D(lParam)]);
}

/**
 * `WM_CREATE` (`22d7`-`2350`): the frame kept, SHELL told of it -- 2, the
 * shell's own window, where it is the shell, else 1 -- and the MDI client made
 * over its client, a pixel past it each way, with the menu's third popup for
 * its windows and 500 its first child's identifier. Without one, -1.
 */
async function created(pm: Pm, hwnd: number): Promise<number> {
  pm.sd16(D_FRAME, hwnd);
  await pm.call('SHELL', 'RegisterShellHook', [W(hwnd), W(pm.d16(D_SHELL) ? 2 : 1)]);

  const menu = (await pm.user('GetMenu', [W(hwnd)])) & 0xffff;
  const windows = (await pm.user('GetSubMenu', [W(menu), W(2)])) & 0xffff;
  const rect = (await pm.call('USER', 'GetClientRect', [W(hwnd), buffer(8)])).buffers[0];
  const at = (offset: number) => rect[offset] | (rect[offset + 1] << 8);
  const client =
    (await pm.user('CreateWindow', [
      string('MDIClient'),
      D(0),
      D(0x42b00000),
      W(at(0) - 1),
      W(at(2) - 1),
      W(at(4) + 2),
      W(at(6) + 2),
      W(hwnd),
      W(1),
      W(pm.d16(D_INSTANCE)),
      B([windows & 0xff, windows >> 8, 500 & 0xff, 500 >> 8]),
    ])) & 0xffff;

  pm.sd16(D_CLIENT, client);

  return client ? 0 : 0xffffffff;
}

/**
 * `WM_CLOSE` (`236d`-`240d`): with `NoClose`, nothing. With Shift held, the
 * settings saved and nothing more. Else saved where `SaveSettings` is on; and
 * Program Manager not the shell destroyed, by `DefFrameProc`. The shell asks
 * whether to end Windows -- not yet, so nothing.
 */
async function close(pm: Pm, hwnd: number, message: number, wParam: number, lParam: number) {
  if (pm.d16(D_NO_CLOSE)) {
    return 0;
  }

  if ((await pm.user('GetKeyState', [W(0x10)])) & 0x8000) {
    await save(pm);
    return 0;
  }

  if (pm.d16(D_SAVE_SETTINGS)) {
    await save(pm);
  }

  pm.sd16(D_CLOSING, 1);

  if (!pm.d16(D_SHELL)) {
    return defaultProc(pm, hwnd, message, wParam, lParam);
  }

  pm.sd16(D_CLOSING, 0);

  return 0;
}

/**
 * 464h (`2762`-`287f`), from a second instance: with no item starting,
 * restored if it is an icon, and it and its last popup brought to the top.
 * Hidden, it stays hidden.
 */
async function activated(pm: Pm, hwnd: number) {
  if ((await pm.user('IsIconic', [W(hwnd)])) & 0xffff) {
    await pm.user('ShowWindow', [W(hwnd), W(1)]);
  }

  await pm.user('BringWindowToTop', [W(hwnd)]);

  const popup = (await pm.user('GetLastActivePopup', [W(hwnd)])) & 0xffff;

  await pm.user('BringWindowToTop', [W(popup)]);
}
