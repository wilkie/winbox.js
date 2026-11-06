'use strict';

import { DestroyWindow } from './DestroyWindow.js';
import { DefWindowProc } from './DefWindowProc.js';
import { GetWindow } from './GetWindow.js';
import { RasterWindow } from './raster-window.js';
import { unhookModule, unhookTask } from './hooks.js';
import { moduleOfProc } from '../kernel/code-calls.js';
import { GetExpWinVer } from '../kernel/GetExpWinVer.js';
import { previousInstanceBut } from '../kernel/WinExec.js';

const GW_HWNDNEXT = 2;
const GW_CHILD = 5;

/** The dialog class, the seventh of USER's own (`USER.EXE` seg3 `1547`-`1590`). */
const DIALOG_CLASS = '#32770';

/**
 * What USER does as a task ends, KERNEL telling it through its signal
 * procedure, signal 20h with the task's queue and instance (`KRNL386.EXE`
 * seg1 `1938`-`194d`; `USER.EXE` seg1 `09bc`-`09fb` to `0b71`): **read
 * out**, **recorded** by `taskend`.
 *
 * * Its own hooks taken out (`0be4`, `unhookTask`).
 * * Each of its windows given its class's own procedure, where its class is
 *   one of USER's, else `DefWindowProc` -- and a dialog its dialog
 *   procedure cleared -- so none of the program's procedures, nor a
 *   library's, is called as they go (`0c03`, `0ec1`-`0fb1`, the classes'
 *   procedures at `0fcc`).
 * * Its windows destroyed, as `DestroyWindow` destroys one, walking the
 *   desktop's windows in their order, each window of another task's looked
 *   under first, and from the first again after each destroyed (`0c0b`,
 *   `103c`-`1069`). `DestroyWindow` then tells no parent (seg8 `0ac6`),
 *   hides a window at the top with 2097h (`0b0d`-`0b20`), and makes no
 *   window active where none is (`0ba8`-`0bb2`): `exiting`.
 * * With its module's last instance (`0c29`-`0c31`, `1088`-`10be`): the
 *   module's hooks for every task taken out; another task's window whose
 *   procedure is in the module given its class's or `DefWindowProc`
 *   (`10ac`-`10b5`); and the module's classes unregistered (`10b8`,
 *   `0b07`-`0b39`).
 *
 * Its messages go to USER's procedures, so the hooks see them, but no
 * procedure of the program's is called. `exitTask` takes off what is left
 * without messages, where a task ends some other way.
 */
export async function appExit(system: any, task: number) {
  task &= 0xffff;

  const done: Set<number> = (system._appExited ??= new Set());

  if (done.has(task)) {
    return;
  }

  done.add(task);

  const record = system.scheduler?.taskAt?.(task);
  const path = String(record?.executable?.path ?? '');
  const module = (system._modules?._handles?.[path] ?? 0) & 0xffff;
  const last = !previousInstanceBut(system, path, task);

  unhookTask(system, task);

  const desktop = system.desktopWindow;

  system._exiting = task;

  try {
    for (const window of windowsOf(system, (each) => taskOf(each) === task)) {
      useDefault(system, window);
    }

    if (desktop) {
      await destroyUnder(system, desktop, task);
    }
  } finally {
    system._exiting = 0;
  }

  if (last && module) {
    moduleGone(system, module);
  }
}

/**
 * USER's work for a module going (`USER.EXE` seg1 `1088`-`10be`): its hooks
 * for every task taken out (`10a1`-`10a6`); a window whose procedure is in
 * it, of a program made for Windows 3.0 or later, given its class's or
 * `DefWindowProc` (`10ac`-`10b5`, `0ee3`-`0f01`); its classes unregistered
 * (`10b8`, `0b07`-`0b39`). For a program's module as its last instance
 * ends (`appExit`); for a library's as KERNEL deletes it, telling USER with
 * signal 80h (`KRNL386.EXE` seg2 `0c4c`-`0c81`; `USER.EXE` seg1
 * `0a4d`-`0a54`).
 */
export function moduleGone(system: any, module: number) {
  module &= 0xffff;

  if (!module) {
    return;
  }

  unhookModule(system, module);

  for (const window of windowsOf(system, () => true)) {
    const proc = window.wndProc ?? classOf(system, window)?.lpfnWndProc;

    if (
      typeof proc === 'number' &&
      (GetExpWinVer.call(system, window.data?.hInstance ?? 0) & 0xffff) >= 0x300 &&
      moduleOfProc(system, proc) === module
    ) {
      useDefault(system, window);
    }
  }

  unregisterClasses(system, module);
}

/** The task a window is of: the one that made it, its queue's. */
function taskOf(window: any) {
  return (window?.data?.hInstance ?? 0) & 0xffff;
}

function windowsOf(system: any, wanted: (window: any) => boolean): any[] {
  return Object.values(system.handles._handles ?? {})
    .map((entry: any) => entry?.instance)
    .filter((window: any) => window instanceof RasterWindow && wanted(window));
}

function classOf(system: any, window: any) {
  return system.handles.retrieve(String(window.options?.windowClass ?? ''));
}

/**
 * A window given USER's procedure for its class: its class's own, where
 * that is one of USER's -- a dialog's dialog procedure cleared too, as the
 * seventh class's is (`USER.EXE` seg1 `0f82`-`0fa1`) -- else
 * `DefWindowProc` (`0fa4`-`0fac`).
 */
function useDefault(system: any, window: any) {
  const windowClass = classOf(system, window);

  if (typeof windowClass?.lpfnWndProc === 'function') {
    window.wndProc = undefined;

    if (
      String(window.options?.windowClass ?? '').toUpperCase() === DIALOG_CLASS &&
      window.dialogState
    ) {
      window.dialogState.proc = 0;
    }

    return;
  }

  window.wndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
    DefWindowProc.call(system, hwnd, message, wParam, lParam);
}

/**
 * The task's windows under a window destroyed, in the order of its
 * children, each of another task's looked under first, and from the first
 * child again after each one destroyed (`USER.EXE` seg1 `103c`-`1069`). A
 * window that will not go -- a hook refused it -- is taken off as
 * `exitTask` takes one off, where Windows would ask again for ever.
 */
async function destroyUnder(system: any, parent: number, task: number) {
  let child = GetWindow.call(system, parent, GW_CHILD);

  while (child) {
    const window = system.handles.resolve(child);

    if (taskOf(window) === task) {
      if (!(await DestroyWindow.call(system, child)) && system.handles.resolve(child) === window) {
        window.window.visible = false;
        window.desktop.destroy(window.window);
        system.handles.free(child);
      }

      child = GetWindow.call(system, parent, GW_CHILD);
      continue;
    }

    await destroyUnder(system, child, task);
    child = GetWindow.call(system, child, GW_HWNDNEXT);
  }
}

/**
 * The classes a module registered, unregistered as its last instance ends
 * (`USER.EXE` seg1 `0b07`-`0b39`): each class whose module is it.
 */
function unregisterClasses(system: any, module: number) {
  for (const [handle, entry] of Object.entries(system.handles._handles ?? {})) {
    const windowClass = (entry as any)?.instance;

    if (windowClass?.lpszClassName !== undefined && windowClass._module === module) {
      system.handles.free(Number(handle));
    }
  }
}

/**
 * What `appExit` lets go that needs no message, for a task ended some other
 * way -- another's `TerminateApp` -- and again, harmlessly, for one told:
 * its own hooks, and with its module's last instance (`module` given) the
 * module's hooks and classes.
 */
export function appExitWithoutMessages(system: any, task: number, module: number) {
  unhookTask(system, task);

  if (module) {
    moduleGone(system, module);
  }
}
