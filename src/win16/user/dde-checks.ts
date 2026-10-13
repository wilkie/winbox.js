'use strict';

/**
 * USER's checks of a message's parameters, as `SendMessage` and
 * `PostMessage` make them before the message goes anywhere (`USER.EXE` seg1
 * `af70`, from `a7a1` and `a7d2`): of those checks, winbox.js follows the
 * rows for the DDE messages (`b31a`-`b388`). A call they refuse answers
 * nought (`a7aa`-`a7ad`) and the message is neither sent nor posted
 * (`dderaw`).
 *
 * * The `wParam` of `WM_DDE_INITIATE`, `ADVISE`, `UNADVISE`, `ACK`, `DATA`
 *   and `REQUEST` must be a window (`ae6d`).
 * * The low word of `lParam` of `WM_DDE_ADVISE` must be a global handle:
 *   one of the local descriptor table's selectors, which `LAR` takes, or
 *   FFFFh (`aeb6`).
 * * The low word of `lParam` of `WM_DDE_DATA` and `WM_DDE_POKE` must be a
 *   global handle or nought (`aeb2`).
 * * `WM_DDE_TERMINATE` and `WM_DDE_EXECUTE` are not checked, nor the
 *   `wParam` of `WM_DDE_POKE`.
 *
 * `HWND_BROADCAST` passes by every check (`a78c`-`a790`).
 */

const WM_DDE_INITIATE = 0x3e0;
const WM_DDE_ADVISE = 0x3e2;
const WM_DDE_UNADVISE = 0x3e3;
const WM_DDE_ACK = 0x3e4;
const WM_DDE_DATA = 0x3e5;
const WM_DDE_REQUEST = 0x3e6;
const WM_DDE_POKE = 0x3e7;

/** Whether a handle is a window's, the desktop's too (`ae6d`). */
export function isWindowHandle(system: any, hwnd: number) {
  return !!(hwnd && system.handles.resolve(hwnd)?.options);
}

/**
 * Whether a handle is one the checks take for a global handle (`aeb6`): it
 * names the local descriptor table, and `LAR` takes its descriptor -- or it
 * is FFFFh.
 */
function isGlobalHandle(system: any, handle: number) {
  if (!handle || !(handle & 0x4)) {
    return false;
  }

  if (handle === 0xffff) {
    return true;
  }

  const cpu = system.machine?.cpu?.core;
  const descriptor = cpu?.peekDescriptor?.(handle);

  return (
    !!descriptor &&
    (descriptor.type || [1, 2, 3, 4, 5, 9, 0xb, 0xc].includes(descriptor.flags & 0xf)) &&
    cpu.descriptorVisible(descriptor, handle)
  );
}

/** Whether USER refuses a DDE message for its parameters. */
export function ddeRefused(system: any, message: number, wParam: number, lParam: number) {
  const low = lParam & 0xffff;

  switch (message & 0xffff) {
    case WM_DDE_INITIATE:
    case WM_DDE_UNADVISE:
    case WM_DDE_ACK:
    case WM_DDE_REQUEST:
      return !isWindowHandle(system, wParam & 0xffff);
    case WM_DDE_ADVISE:
      return !isWindowHandle(system, wParam & 0xffff) || !isGlobalHandle(system, low);
    case WM_DDE_DATA:
      return (
        !isWindowHandle(system, wParam & 0xffff) || (low !== 0 && !isGlobalHandle(system, low))
      );
    case WM_DDE_POKE:
      return low !== 0 && !isGlobalHandle(system, low);
  }

  return false;
}
