'use strict';

/**
 * USER's validation of a DDE message's parameters, as its API asks it.
 *
 * `PostMessage`, `SendMessage`, `DispatchMessage` and `CallWindowProc` hand
 * the message to USER's validation layer before doing anything (`USER.EXE`
 * seg1 `a7d2`, `a7a1`, `a727`, `a845`, all calling `af70`). For messages
 * below 400h it looks the message up in a table and checks what that row
 * says (`afc2`-`b388`). The DDE messages' rows:
 *
 * | Message            | `wParam`             | `lParam`'s low word         |
 * | ------------------ | -------------------- | --------------------------- |
 * | `WM_DDE_INITIATE`  | a window             |                             |
 * | `WM_DDE_TERMINATE` | not checked (no row) |                             |
 * | `WM_DDE_ADVISE`    | a window             | a handle (`aeb6`)           |
 * | `WM_DDE_UNADVISE`  | a window             |                             |
 * | `WM_DDE_ACK`       | a window             |                             |
 * | `WM_DDE_DATA`      | a window             | nought or a handle (`aeb2`) |
 * | `WM_DDE_REQUEST`   | a window             |                             |
 * | `WM_DDE_POKE`      | not checked          | nought or a handle (`aeb2`) |
 * | `WM_DDE_EXECUTE`   | not checked (no row) |                             |
 *
 * "A window" is `ae6d`: not nought, and a window's (USER's own check of the
 * window's class). "A handle" is `aeb6`: the selector's table bit set, and
 * FFFFh or a selector `LAR` takes (`aebf`). A row that fails goes to
 * KERNEL's `HandleParamError` with `ERR_BAD_HWND` (6040h) or 6022h, an error
 * and not a warning, and the call answers nought without doing anything
 * (`aeea`; the callers' `pop bx`, `cwd`, `jmp bx`).
 *
 * What that means for a program: a DDE message whose sender's window is gone
 * by the time it is dispatched is not dispatched. **Recorded** by `postend`:
 * a `WM_DDE_ACK` a program posts, giving its window, and then ends is never
 * handed to the window it was posted to, though `WM_USER + 1` is; one posted
 * from `WinMain` with no window in `wParam` is refused at once, as are
 * `WM_DDE_INITIATE` and `WM_DDE_DATA`, and 3DFh, `WM_DDE_TERMINATE`,
 * `WM_DDE_EXECUTE` and 3E9h are delivered. And so Program Manager's
 * acknowledgement of `[ExitProgman]`, posted just before it ends, never
 * reaches its client (`progdde`).
 *
 * The table's other rows -- the clipboard's messages, `WM_SETTEXT`'s string
 * and the rest -- are not followed here. The Rust engine's twin is
 * `dde_parameters.rs`.
 */

const WM_DDE_INITIATE = 0x03e0;
const WM_DDE_ADVISE = 0x03e2;
const WM_DDE_UNADVISE = 0x03e3;
const WM_DDE_ACK = 0x03e4;
const WM_DDE_DATA = 0x03e5;
const WM_DDE_REQUEST = 0x03e6;
const WM_DDE_POKE = 0x03e7;

/** The system types `LAR` takes besides code and data. */
const LAR_SYSTEM_TYPES = [1, 2, 3, 4, 5, 9, 0xb, 0xc];

/** `ae6d`: a window, as `IsWindow` answers. */
function isWindow(system: any, hwnd: number) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return !!window && window.options?.windowClass !== undefined;
}

/** Whether `LAR` would take a selector, as the processor answers it. */
function larTakes(system: any, selector: number) {
  const core = system.machine.cpu.core;
  const descriptor = core.peekDescriptor(selector);

  return (
    !!descriptor &&
    (descriptor.type || LAR_SYSTEM_TYPES.includes(descriptor.flags & 0xf)) &&
    core.descriptorVisible(descriptor, selector)
  );
}

/** `aeb6`: a selector of the local table, FFFFh or one `LAR` takes. */
function isHandle(system: any, handle: number) {
  return (handle & 4) !== 0 && (handle === 0xffff || larTakes(system, handle));
}

/**
 * Whether USER's validation layer refuses a DDE message's parameters, so
 * that the call carrying it answers nought and does nothing.
 */
export function ddeParametersRefused(system: any, message: number, wParam: number, lParam: number) {
  const handle = lParam & 0xffff;

  switch (message & 0xffff) {
    case WM_DDE_INITIATE:
    case WM_DDE_UNADVISE:
    case WM_DDE_ACK:
    case WM_DDE_REQUEST:
      return !isWindow(system, wParam & 0xffff);
    case WM_DDE_ADVISE:
      return !isWindow(system, wParam & 0xffff) || !isHandle(system, handle);
    case WM_DDE_DATA:
      return !isWindow(system, wParam & 0xffff) || (handle !== 0 && !isHandle(system, handle));
    case WM_DDE_POKE:
      return handle !== 0 && !isHandle(system, handle);
    default:
      return false;
  }
}
