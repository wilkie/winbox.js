//! A message for every window at the top: `SendMessage` and `PostMessage`
//! with `HWND_BROADCAST`, -1, which both exports pass by without checking
//! it as a window (`USER.EXE` seg1 `a786`, `a7b7`) to the broadcast (seg1
//! `22e3`). **Recorded** by `bcast`.
//!
//! * Sent, each window at the top is sent it as `EnumWindows` takes them,
//!   hidden, disabled, minimized, owned and another program's alike (seg1
//!   `2358`, `6556`); the call answers 10000h, whatever they answered.
//! * Posted, it is posted to each window at the top that has no owner, as
//!   the desktop's children are in order (`232b`-`234e`): an owned one is
//!   passed over. The call answers `ABCDh` (`2353`).
//! * Either way the windows of USER's classes 8000h (menus), 8003h (the
//!   task list's) and 8004h (icons' titles) are passed over (`2293`).
//! * For `WM_WININICHANGE` and `WM_DEVMODECHANGE` with an `lParam`, the
//!   text it points to is copied into a block of `GlobalAlloc`'s, flags
//!   1000h, and the block's address passed, its offset nought (seg1
//!   `0093`); a block that cannot be had answers 10000h and nothing is
//!   sent. Sent, the block is freed after; posted, it is never freed.
//!
//! The TypeScript engine's `broadcast.ts` is the same.

use crate::call::{Args, Stop};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

pub const HWND_BROADCAST: u16 = 0xffff;

const WM_WININICHANGE: u16 = 0x001a;
const WM_DEVMODECHANGE: u16 = 0x001b;

/// USER's own classes a broadcast passes over (8000h, 8003h, 8004h).
const PASSED_OVER: [&str; 3] = ["#32768", "#32771", "#32772"];

impl System {
    /// The windows a broadcast is for, front to back.
    pub(crate) fn broadcast_targets(&self, posting: bool) -> Vec<u16> {
        self.top_level_hwnds()
            .into_iter()
            .filter(|&hwnd| {
                let Some(window) = self
                    .window_named(hwnd)
                    .and_then(|i| self.windows[i].as_ref())
                else {
                    return false;
                };

                let ours = PASSED_OVER
                    .iter()
                    .any(|class| window.class.eq_ignore_ascii_case(class));

                !ours && (!posting || window.owner.is_none())
            })
            .collect()
    }

    /// The text a `WM_WININICHANGE` or `WM_DEVMODECHANGE` points to,
    /// copied into a block of its own (seg1 `0093`): the block's handle and
    /// its address; the handle nought where there is no text to copy, and
    /// none where no block could be had.
    fn broadcast_text(&mut self, message: u16, lparam: u32) -> Option<(u16, u32)> {
        if (message != WM_WININICHANGE && message != WM_DEVMODECHANGE) || lparam == 0 {
            return Some((0, lparam));
        }

        let mut bytes = self.read_string(lparam);

        bytes.push(0);

        let index = self.global.allocate(
            &mut self.cpu.bus,
            &mut self.descriptors,
            bytes.len() as u32,
            0x1000,
        )?;
        let far = u32::from(winbox_machine::segment_selector(index)) << 16;

        self.write_far(far, &bytes);
        Some((winbox_machine::handle_for(index), far))
    }

    /// `PostMessage` with `HWND_BROADCAST`: `ABCDh`, or nought where no block
    /// could be had for the text.
    pub(crate) fn post_broadcast(&mut self, message: u16, wparam: u16, lparam: u32) -> u16 {
        let Some((_, far)) = self.broadcast_text(message, lparam) else {
            return 0;
        };

        for hwnd in self.broadcast_targets(true) {
            self.post_message(hwnd, message, wparam, far);
        }

        0xabcd
    }
}

impl Engine {
    /// `SendMessage` with `HWND_BROADCAST`: 10000h.
    pub(crate) async fn send_broadcast(
        &self,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let (copied, hwnds) = {
            let mut system = self.system();
            let copied = system.broadcast_text(message, lparam);

            (copied, system.broadcast_targets(false))
        };
        let Some((block, far)) = copied else {
            return Ok(0x10000);
        };

        for hwnd in hwnds {
            if self.system().window_named(hwnd).is_some() {
                self.send_message(hwnd, message, wparam, &mut Param::Value(far))
                    .await?;
            }
        }

        if block != 0 {
            let _ = crate::memory::global_free(&mut self.system(), &mut Args::repeat(block));
        }

        Ok(0x10000)
    }
}
