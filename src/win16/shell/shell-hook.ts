'use strict';

import { passOn, SetWindowsHook, UnhookWindowsHook, WH_SHELL } from '../user/hooks.js';
import { PostMessage } from '../user/PostMessage.js';
import { RegisterWindowMessage } from '../user/RegisterWindowMessage.js';
import { IsWindow } from '../user/window-queries.js';

/**
 * SHELL's shell hook: the windows that ask, Program Manager's among them,
 * are told when a top-level window is made or goes.
 *
 * **Read out** of `SHELL.DLL` (seg4 `128c`, `11ca`) and **recorded** by
 * `shlhook`:
 *
 * * `RegisterShellHook` with a flag of 1 or 2 adds a window to SHELL's list;
 *   2 makes it the shell's own window too. The first puts SHELL's
 *   `ShellHookProc` in as a `WH_SHELL` hook, and registers three messages:
 *   `OTHERWINDOWCREATED`, `OTHERWINDOWDESTROYED` and `ACTIVATESHELLWINDOW`.
 *   With a flag of nought it takes the window out, and when the list is
 *   empty takes the hook out. It answers 1, or nought when the hook cannot
 *   be put in.
 * * `ShellHookProc`, told a window was made (1) or went (2), posts the first
 *   or second message to every window on the list with that window in
 *   `wParam`, and drops any that is a window no more. Told to activate the
 *   shell window (3), it posts the third to the shell's own. It passes each
 *   call on.
 */

interface State {
  hooked: boolean;
  handle: number;
  proc: ((code: number, wParam: number, lParam: number) => Promise<number>) | null;
  windows: number[];
  shell: number;
  created: number;
  destroyed: number;
  activate: number;
}

function stateOf(system: any): State {
  return (system._shellHook ??= {
    hooked: false,
    handle: 0,
    proc: null,
    windows: [],
    shell: 0,
    created: 0,
    destroyed: 0,
    activate: 0,
  });
}

/**
 * Asks, or stops asking, to be told of top-level windows made and gone.
 *
 * @param {Types.HWND} hwnd - The window to tell.
 * @param {Types.UINT} fInstall - 1 to add it, 2 to add it as the shell's
 *   own window, nought to take it out.
 *
 * @returns {Types.BOOL} 1, or nought when the hook could not be put in.
 */
export function RegisterShellHook(this: any, hwnd: number, fInstall: number) {
  const state = stateOf(this);

  if (fInstall) {
    if (!state.hooked) {
      state.proc = (code, wParam, lParam) => ShellHookProc.call(this, code, wParam, lParam);
      state.handle = SetWindowsHook.call(this, WH_SHELL, state.proc);

      if (!state.handle) {
        return 0;
      }

      state.hooked = true;
      state.created = RegisterWindowMessage.call(this, 'OTHERWINDOWCREATED');
      state.destroyed = RegisterWindowMessage.call(this, 'OTHERWINDOWDESTROYED');
      state.activate = RegisterWindowMessage.call(this, 'ACTIVATESHELLWINDOW');
    }

    /* The first slot that is free, or a new one. */
    const free = state.windows.indexOf(0);

    if (free >= 0) {
      state.windows[free] = hwnd;
    } else {
      state.windows.push(hwnd);
    }

    if (fInstall === 2) {
      state.shell = hwnd;
    }

    return 1;
  }

  if (state.shell === hwnd) {
    state.shell = 0;
  }

  const at = state.windows.lastIndexOf(hwnd);

  if (at >= 0) {
    state.windows[at] = 0;

    while (state.windows.length && !state.windows[state.windows.length - 1]) {
      state.windows.pop();
    }

    if (!state.windows.length && state.hooked) {
      UnhookWindowsHook.call(this, WH_SHELL, state.proc);
      state.hooked = false;
      state.proc = null;
    }
  }

  return 1;
}

/**
 * What SHELL's hook does with a call: see `RegisterShellHook`.
 *
 * @returns {Types.LRESULT} What the hooks after it answer.
 */
export async function ShellHookProc(this: any, nCode: number, wParam: number, lParam: number) {
  const state = stateOf(this);
  const code = (nCode << 16) >> 16;

  if (code === 3 && state.shell) {
    PostMessage.call(this, state.shell, state.activate, 0, 0);
  }

  if (code === 1 || (code === 2 && state.windows.length)) {
    const message = code === 1 ? state.created : state.destroyed;

    state.windows.forEach((window, i) => {
      if (!window) {
        return;
      }

      if (IsWindow.call(this, window)) {
        PostMessage.call(this, window, message, wParam, 0);
      } else {
        state.windows[i] = 0;
      }
    });
  }

  return passOn(this, state.handle, nCode, wParam, lParam);
}
