//! USER's checks of a message's parameters, as `SendMessage` and
//! `PostMessage` make them before the message goes anywhere (`USER.EXE`
//! seg1 `af70`, from `a7a1` and `a7d2`): of those checks, winbox.js follows
//! the rows for the DDE messages (`b31a`-`b388`). A call they refuse
//! answers nought (`a7aa`-`a7ad`) and the message is neither sent nor
//! posted (**recorded** by `dderaw`).
//!
//! * The `wParam` of `WM_DDE_INITIATE`, `ADVISE`, `UNADVISE`, `ACK`, `DATA`
//!   and `REQUEST` must be a window (`ae6d`).
//! * The low word of `lParam` of `WM_DDE_ADVISE` must be a global handle:
//!   one of the local descriptor table's selectors, which `LAR` takes, or
//!   `FFFFh` (`aeb6`).
//! * The low word of `lParam` of `WM_DDE_DATA` and `WM_DDE_POKE` must be a
//!   global handle or nought (`aeb2`).
//! * `WM_DDE_TERMINATE` and `WM_DDE_EXECUTE` are not checked, nor the
//!   `wParam` of `WM_DDE_POKE`.
//!
//! `HWND_BROADCAST` passes by every check (`a78c`-`a790`).

use crate::handles::Object;
use crate::system::System;

const WM_DDE_INITIATE: u16 = 0x3e0;
const WM_DDE_ADVISE: u16 = 0x3e2;
const WM_DDE_UNADVISE: u16 = 0x3e3;
const WM_DDE_ACK: u16 = 0x3e4;
const WM_DDE_DATA: u16 = 0x3e5;
const WM_DDE_REQUEST: u16 = 0x3e6;
const WM_DDE_POKE: u16 = 0x3e7;

impl System {
    /// Whether a handle is a window's, the desktop's too (`ae6d`).
    pub fn is_window_handle(&self, hwnd: u16) -> bool {
        hwnd != 0
            && match self.handles.resolve(hwnd) {
                Some(Object::Desktop) => true,
                Some(Object::Window(index)) => self.windows[index].is_some(),
                _ => false,
            }
    }

    /// Whether a handle is one the checks take for a global handle
    /// (`aeb6`): it names the local descriptor table, and `LAR` takes its
    /// descriptor -- or it is `FFFFh`.
    fn is_global_handle(&self, handle: u16) -> bool {
        handle != 0
            && handle & 4 != 0
            && (handle == 0xffff || self.cpu.access_rights(handle).is_some())
    }

    /// Whether USER refuses a DDE message for its parameters.
    pub fn dde_refused(&self, message: u16, wparam: u16, lparam: u32) -> bool {
        let low = lparam as u16;

        match message {
            WM_DDE_INITIATE | WM_DDE_UNADVISE | WM_DDE_ACK | WM_DDE_REQUEST => {
                !self.is_window_handle(wparam)
            }
            WM_DDE_ADVISE => !self.is_window_handle(wparam) || !self.is_global_handle(low),
            WM_DDE_DATA => {
                !self.is_window_handle(wparam) || (low != 0 && !self.is_global_handle(low))
            }
            WM_DDE_POKE => low != 0 && !self.is_global_handle(low),
            _ => false,
        }
    }
}
