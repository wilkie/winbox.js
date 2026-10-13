//! USER's validation of a DDE message's parameters, as its API asks it.
//!
//! `PostMessage`, `SendMessage`, `DispatchMessage` and `CallWindowProc`
//! hand the message to USER's validation layer before doing anything
//! (`USER.EXE` seg1 `a7d2`, `a7a1`, `a727`, `a845`, all calling `af70`).
//! For messages below 400h it looks the message up in a table and checks
//! what that row says (`afc2`-`b388`). The DDE messages' rows:
//!
//! | Message                | `wParam`                  | `lParam`'s low word            |
//! | ---------------------- | ------------------------- | ------------------------------ |
//! | `WM_DDE_INITIATE`      | a window                  |                                |
//! | `WM_DDE_TERMINATE`     | not checked (no row)      |                                |
//! | `WM_DDE_ADVISE`        | a window                  | a handle (`aeb6`)              |
//! | `WM_DDE_UNADVISE`      | a window                  |                                |
//! | `WM_DDE_ACK`           | a window                  |                                |
//! | `WM_DDE_DATA`          | a window                  | nought or a handle (`aeb2`)    |
//! | `WM_DDE_REQUEST`       | a window                  |                                |
//! | `WM_DDE_POKE`          | not checked               | nought or a handle (`aeb2`)    |
//! | `WM_DDE_EXECUTE`       | not checked (no row)      |                                |
//!
//! "A window" is `ae6d`: not nought, and a window's (USER's own check of
//! the window's class). "A handle" is `aeb6`: the selector's table bit set,
//! and `FFFFh` or a selector `LAR` takes (`aebf`). A row that fails goes to
//! KERNEL's `HandleParamError` with `ERR_BAD_HWND` (6040h) or 6022h, an
//! error and not a warning, and the call answers nought without doing
//! anything (`aeea`; the callers' `pop bx`, `cwd`, `jmp bx`).
//!
//! What that means for a program: a DDE message whose sender's window is
//! gone by the time it is dispatched is not dispatched. **Recorded** by
//! `postend`: a `WM_DDE_ACK` a program posts, giving its window, and then
//! ends is never handed to the window it was posted to, though
//! `WM_USER + 1` is; one posted from `WinMain` with no window in `wParam` is
//! refused at once, as are `WM_DDE_INITIATE` and `WM_DDE_DATA`, and
//! 3DFh, `WM_DDE_TERMINATE`, `WM_DDE_EXECUTE` and 3E9h are delivered. And
//! so Program Manager's acknowledgement of `[ExitProgman]`, posted just
//! before it ends, never reaches its client (`progdde`).
//!
//! The table's other rows -- the clipboard's messages, `WM_SETTEXT`'s
//! string and the rest -- are not followed here.

use crate::handles::Object;
use crate::system::System;

const WM_DDE_INITIATE: u16 = 0x03e0;
const WM_DDE_ADVISE: u16 = 0x03e2;
const WM_DDE_UNADVISE: u16 = 0x03e3;
const WM_DDE_ACK: u16 = 0x03e4;
const WM_DDE_DATA: u16 = 0x03e5;
const WM_DDE_REQUEST: u16 = 0x03e6;
const WM_DDE_POKE: u16 = 0x03e7;

/// Whether USER's validation layer refuses a DDE message's parameters, so
/// that the call carrying it answers nought and does nothing.
pub(crate) fn refused(system: &System, message: u16, wparam: u16, lparam: u32) -> bool {
    let handle = lparam as u16;

    match message {
        WM_DDE_INITIATE | WM_DDE_UNADVISE | WM_DDE_ACK | WM_DDE_REQUEST => {
            !is_window(system, wparam)
        }
        WM_DDE_ADVISE => !is_window(system, wparam) || !is_handle(system, handle),
        WM_DDE_DATA => !is_window(system, wparam) || (handle != 0 && !is_handle(system, handle)),
        WM_DDE_POKE => handle != 0 && !is_handle(system, handle),
        _ => false,
    }
}

/// `ae6d`: a window, as `IsWindow` answers.
fn is_window(system: &System, hwnd: u16) -> bool {
    hwnd != 0
        && matches!(
            system.handles.resolve(hwnd),
            Some(Object::Window(index)) if system.windows[index].is_some()
        )
}

/// `aeb6`: a selector of the local table, `FFFFh` or one `LAR` takes.
fn is_handle(system: &System, handle: u16) -> bool {
    handle & 4 != 0 && (handle == 0xffff || system.lar_takes(handle))
}
