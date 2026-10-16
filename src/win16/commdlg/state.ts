'use strict';

import { Loader } from '../loader.js';
import { segmentSelector } from '../selectors.js';
import { HWND, LPARAM, UINT, WPARAM } from '../types.js';
import { LoadCursor, SetCursor } from '../user/cursor-api.js';
import { RegisterWindowMessage } from '../user/RegisterWindowMessage.js';

/** The module's name, and its file's. */
export const NAME = 'COMMDLG';

/**
 * The messages `COMMDLG`'s entry point registers, in its order:
 * `COMMDLG.DLL` seg7 `010b` to `014c`, then, once it has made its memory
 * device context, seg7 `0208`. A program finds them by the same names
 * (`commdlg.h`'s `LBSELCHSTRING`, `SHAREVISTRING`, `FILEOKSTRING`,
 * `COLOROKSTRING`, `SETRGBSTRING`, `HELPMSGSTRING`).
 */
export const MESSAGES = [
  'commdlg_LBSelChangedNotify',
  'commdlg_ShareViolation',
  'commdlg_FileNameOK',
  'commdlg_ColorOK',
  'commdlg_SetRGBColor',
  'commdlg_help',
];

/**
 * `COMMDLG` loaded with no file of its own: its messages registered, as
 * the file's entry point registers them. A message registered again keeps
 * its number, so this is the same each time it loads.
 *
 * Not followed: the memory device context the entry point makes and keeps
 * (seg7 `01a1` to `0203`).
 */
export function start(system: any) {
  for (const name of MESSAGES) {
    RegisterWindowMessage.call(system, name);
  }
}

/**
 * Where the loaded file keeps its extended error, as a descriptor index
 * and offset: the doubleword its `CommDlgExtendedError` reads, `mov ax,
 * [2CCh]; mov dx, [2CEh]` in `COMMDLG.DLL` (seg6 `01f1`). Found in the
 * entry's code, so that a file of another version is read where it reads.
 */
function fileError(system: any): number | null {
  const loader = system._modules.fromName(NAME);

  if (!(loader instanceof Loader)) {
    return null;
  }

  const ordinal = (loader as any).ordinalOf('CommDlgExtendedError');
  const info = ordinal ? (loader as any).lookup(ordinal) : null;
  const data = (loader as any).ds ? (loader as any).translate((loader as any).ds) : undefined;

  if (!info || info.segment === undefined || data === undefined) {
    return null;
  }

  const memory = system.machine.memory;
  const at = (info.segment << 16) + info.offset;

  for (let step = 0; step + 5 <= 24; step++) {
    if (
      memory.read8(at + step) === 0x8e &&
      memory.read8(at + step + 1) === 0xd8 &&
      memory.read8(at + step + 2) === 0xa1
    ) {
      return (data << 16) + (memory.read8(at + step + 3) | (memory.read8(at + step + 4) << 8));
    }
  }

  return null;
}

/** `COMMDLG`'s extended error set, where `CommDlgExtendedError` finds it. */
export function setError(system: any, code: number) {
  const at = fileError(system);

  if (at === null) {
    (system._commdlg ??= { error: 0, initialising: false }).error = code >>> 0;
    return;
  }

  system.machine.memory.write16(at, code & 0xffff);
  system.machine.memory.write16(at + 2, (code >>> 16) & 0xffff);
}

/** `COMMDLG`'s extended error, wherever it is kept. */
export function error(system: any): number {
  const at = fileError(system);

  if (at === null) {
    return system._commdlg?.error ?? 0;
  }

  const memory = system.machine.memory;

  return (memory.read16(at) | (memory.read16(at + 2) << 16)) >>> 0;
}

/**
 * The error the last of `COMMDLG`'s functions left: nought for none
 * (`COMMDLG.DLL` seg6 `01e7`).
 *
 * @returns {Types.DWORD} The error.
 */
export function CommDlgExtendedError(this: any) {
  return error(this);
}

/** A message of `COMMDLG`'s by its name (`MESSAGES`), its number as its entry point registered it. */
export function message(system: any, name: string): number {
  return RegisterWindowMessage.call(system, name);
}

/**
 * `COMMDLG`'s instance, which its dialogs are made with (`[2CAh]`, its
 * entry point's `hInstance`, seg7 `016e`): the file's library's while the
 * file is loaded, WinBox's own otherwise.
 */
export function instance(system: any): number {
  const loader = system._modules.fromName(NAME);

  if (loader instanceof Loader) {
    const handle = system._modules.handleFromPath((loader as any).path);
    const library = handle ? system.handles.resolve(handle) : null;

    if (library?.instance) {
      return library.instance;
    }
  }

  return system._modules.instanceFromPath('C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL') ?? 0;
}

/**
 * `COMMDLG`'s data segment's selector, which DS holds as it calls a hook:
 * the file's while it is loaded, WinBox's own otherwise.
 */
export function dataSelector(system: any): number {
  const loader = system._modules.fromName(NAME);

  if (loader instanceof Loader && (loader as any).ds) {
    return segmentSelector((loader as any).translate((loader as any).ds));
  }

  return system._moduleData?.[NAME] ?? 0;
}

/**
 * A program's hook called as `COMMDLG` calls one: `hook(hwnd, message,
 * wParam, lParam)`, a far Pascal call, with `COMMDLG`'s own data segment in
 * DS (`COMMDLG.DLL` seg2 `42f4`, `call far [es:bx+40h]`; seg2 `4331`, `call
 * far [4Ah]`) -- a hook finds its program's data only through its
 * `MakeProcInstance` thunk. Its answer, AX: a hook answers a `BOOL`.
 */
export async function callHook(
  system: any,
  hook: number,
  hwnd: number,
  msg: number,
  wParam: number,
  lParam: number
): Promise<number> {
  const answer = await system.scheduler.callProc(
    hook >>> 0,
    [
      [hwnd, HWND],
      [msg, UINT],
      [wParam, WPARAM],
      [lParam >>> 0, LPARAM],
    ],
    { ds: dataSelector(system) }
  );

  return answer & 0xffff;
}

/**
 * The cursor while `COMMDLG` works: the hourglass, `busy`, or the arrow
 * (entry 32, `COMMDLG.DLL` seg2 `08e2`): `SetCursor(LoadCursor(0,
 * IDC_WAIT))` or `IDC_ARROW`. Nothing while its Open or Save dialog is being
 * made (`[0CACh]`, seg2 `4354`). Not followed: the `ShowCursor` it adds
 * where `GetSystemMetrics(SM_MOUSEPRESENT)` answered nought as it loaded
 * (seg7 `00e3`, seg2 `08fc`); WinBox always has a mouse.
 */
export async function waitCursor(system: any, busy: boolean) {
  if (system._commdlg?.initialising) {
    return;
  }

  SetCursor.call(system, await LoadCursor.call(system, 0, busy ? 32514 : 32512));
}
