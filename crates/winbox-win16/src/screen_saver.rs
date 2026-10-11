//! The screen saver, as USER starts it. **Read out** of `USER.EXE`, and
//! **recorded** by `spiidle`; the TypeScript engine's `screen-saver.ts` is
//! the same.
//!
//! * USER notes when input last came, `SYSTEM`'s millisecond count
//!   (`[0FAh]`): as a look reads each event of the system's queue, the
//!   event's time (seg1 `2b7f`, `3090`, `317b`); as
//!   `SPI_SETSCREENSAVETIMEOUT` or `SPI_SETSCREENSAVEACTIVE` sets the delay,
//!   now (seg41 `1297`, `12f8`); and as a window is made active, now, where
//!   nothing is noted (seg1 `37f2`-`3803`).
//! * The first `InitApp` gives the task list's window, USER's own of class
//!   8003h, a system timer of ten seconds, -3 (seg5 `0470`-`047f`), whose
//!   procedure (seg1 `3400`, `334e`) looks: with no mouse button down, no
//!   window system-modal, the screen saver active with a delay, input
//!   noted, more than the delay's seconds gone since it, and a window
//!   active, it posts that window `WM_SYSCOMMAND` with `SC_SCREENSAVE`, and
//!   notes nothing (`3364`-`33f7`). So it comes again only after more
//!   input. In 386 enhanced mode it also passes over a DOS program's window.
//! * `DefWindowProc` given `SC_SCREENSAVE` (seg1 `05f9`-`0688`), unless a
//!   menu is up or a window is system-modal, runs the program `SYSTEM.INI`'s
//!   `[boot] SCRNSAVE.EXE` names -- `SCRNSAVE.EXE` where it names none --
//!   with ` /s` after it, shown normally, with `WinExec`. Not followed: USER
//!   passes over it while a menu is up (`[1CAh]`) and while its flag at
//!   `[0E0h]` is set.

use crate::call::Stop;
use crate::engine::Engine;
use crate::queue::WM_SYSTIMER;
use crate::system::System;

pub const SC_SCREENSAVE: u16 = 0xf140;

const WM_SYSCOMMAND: u16 = 0x0112;

/// The timer's identifier, -3, and its interval.
pub(crate) const SCREEN_SAVE_TIMER: u16 = 0xfffd;
const EVERY: u16 = 10_000;

const VK_LBUTTON: usize = 0x01;
const VK_RBUTTON: usize = 0x02;
const VK_MBUTTON: usize = 0x04;

/// The length of a tick of the timer chip, in milliseconds, as
/// `GetTickCount` counts.
const TICK: f64 = 65_536_000.0 / 1_193_180.0;

impl System {
    /// `SYSTEM`'s millisecond count, as `GetTickCount` answers it.
    fn tick_now(&self) -> u32 {
        let ms = self.clock.now(self.instructions);

        ((ms / TICK).floor() * TICK).floor() as u64 as u32
    }

    /// Input noted at a time: an event's, or now.
    pub(crate) fn note_input(&mut self, time: Option<u32>) {
        self.last_input = time.unwrap_or_else(|| self.tick_now());
    }

    /// A window made active: now noted, where nothing is.
    pub(crate) fn note_activation(&mut self) {
        if self.last_input == 0 {
            self.note_input(None);
        }
    }

    /// The system timer of ten seconds, given USER's task list's window.
    pub(crate) fn start_screen_save_timer(&mut self, hwnd: u16) {
        self.set_timer(hwnd, SCREEN_SAVE_TIMER, EVERY, 0);

        if let Some(timer) = self
            .timers
            .iter_mut()
            .find(|timer| timer.hwnd == hwnd && timer.id == SCREEN_SAVE_TIMER)
        {
            timer.message = WM_SYSTIMER;
        }
    }

    /// The timer's look: `SC_SCREENSAVE` posted where it is due.
    pub(crate) fn screen_save_look(&mut self) {
        let buttons = &self.user_state.async_keys;

        if [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
            .iter()
            .any(|&vk| buttons[vk] & 0x80 != 0)
            || self.sys_modal_window() != 0
        {
            return;
        }

        let delay = self.parameters().screen_save;
        let since = self.last_input;

        if delay <= 0 || since == 0 {
            return;
        }

        let gone = self.tick_now().wrapping_sub(since);
        let active = self.active_hwnd();

        if gone <= u32::from(delay as u16) * 1000 || active == 0 {
            return;
        }

        self.post_message(active, WM_SYSCOMMAND, SC_SCREENSAVE, 0);
        self.last_input = 0;
    }
}

impl Engine {
    /// `DefWindowProc`'s `SC_SCREENSAVE`: the screen saver started.
    pub(crate) async fn screen_save(&self) -> Result<(), Stop> {
        let line = {
            let mut system = self.system();

            if system.sys_modal_window() != 0 {
                return Ok(());
            }

            let profile = system.read_profile(b"SYSTEM.INI");
            let name = profile
                .get(b"boot", b"SCRNSAVE.EXE", true)
                .unwrap_or_else(|| b"SCRNSAVE.EXE".to_vec());
            let name: String = name.iter().take(0x92).map(|&b| char::from(b)).collect();

            format!("{name} /s")
        };

        self.win_exec_line(&line, 1).await?;
        Ok(())
    }
}
