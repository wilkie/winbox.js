//! Switching between programs, as winbox.js's `task-list.ts` has it: the
//! keys USER's system queue takes for itself -- Control and Escape, Print
//! Screen, and the hot keys -- and what they lead to: the Task List,
//! TASKMAN.EXE, started by `DefWindowProc` for `SC_TASKLIST`; a copy of the
//! screen on the clipboard; and `SwitchToThisWindow`.
//!
//! **Read out** of `USER.EXE` (seg1 unless named) and `TASKMAN.EXE`, and
//! **recorded** by `tasklist`, `prtsc` and `hotkey`.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::Param;
use crate::queue::{Message, WM_KEYDOWN, WM_SYSKEYDOWN};
use crate::system::System;
use crate::windows::Placement;

pub const SC_TASKLIST: u16 = 0xf130;
pub const SC_HOTKEY: u16 = 0xf150;
const SC_RESTORE: u16 = 0xf120;
const WM_SYSCOMMAND: u16 = 0x0112;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
pub const WM_SETHOTKEY: u16 = 0x0032;
pub const WM_GETHOTKEY: u16 = 0x0033;

const VK_SHIFT: usize = 0x10;
const VK_CONTROL: usize = 0x11;
const VK_MENU: usize = 0x12;
const VK_ESCAPE: u16 = 0x1b;
const VK_SNAPSHOT: u16 = 0x2c;

const CF_BITMAP: u16 = 2;
const SRCCOPY: u32 = 0x00cc_0020;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_EX_TOPMOST: u32 = 0x0008;
const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOACTIVATE: u16 = 0x0010;
const HWND_TOP: u16 = 0;
const HWND_BOTTOM: u16 = 1;
const SW_SHOWNORMAL: u16 = 1;

/// A hot key as `WM_SETHOTKEY` takes it: the virtual key, and Shift,
/// Control and Alt above.
const HOTKEYF_SHIFT: u16 = 0x100;
const HOTKEYF_CONTROL: u16 = 0x200;
const HOTKEYF_ALT: u16 = 0x400;

/// A window's hot key, in USER's table of them (`[174h]`, `[176h]` its
/// count).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotKey {
    pub hwnd: u16,
    pub key: u16,
}

impl System {
    fn held(&self, vk: usize) -> bool {
        self.user_state.key_states[vk] & 0x80 != 0
    }

    /// The window a hot key is given to, if it is shown (seg14 `04e3`): the
    /// first in the table with the key, and none if that one is hidden.
    fn hot_key_window(&self, key: u16) -> u16 {
        let Some(found) = self.hot_keys.iter().find(|one| one.key == key) else {
            return 0;
        };
        let shown = self
            .window_named(found.hwnd)
            .and_then(|index| self.windows[index].as_ref())
            .is_some_and(|window| window.visible);

        if shown { found.hwnd } else { 0 }
    }

    /// `WM_SETHOTKEY`, as `DefWindowProc` answers it (seg14 `0544`): -1, as
    /// the low word alone, for Escape, Space or Tab; nought for a child;
    /// else the key given the window, in place of the one it had, or taken
    /// away for nought, and 1 -- or 2 where another window shown had the key
    /// already, which it keeps. Measured by `hotkey`.
    pub(crate) fn set_hot_key(&mut self, hwnd: u16, key: u16) -> u32 {
        let vk = key & 0xff;

        if vk == VK_ESCAPE || vk == 0x20 || vk == 0x09 {
            return 0xffff;
        }

        let child = match self.window_named(hwnd) {
            Some(index) => self.windows[index]
                .as_ref()
                .is_none_or(|window| window.parent.is_some()),
            None => true,
        };

        if child {
            return 0;
        }

        let other = if key == 0 {
            0
        } else {
            self.hot_key_window(key)
        };
        let shared = other != 0 && other != hwnd;

        match self.hot_keys.iter().position(|one| one.hwnd == hwnd) {
            None if key != 0 => self.hot_keys.push(HotKey { hwnd, key }),
            None => {}
            Some(at) if key != 0 => self.hot_keys[at].key = key,
            // The last one moved into its place (`05be`).
            Some(at) => {
                self.hot_keys.swap_remove(at);
            }
        }

        if shared { 2 } else { 1 }
    }

    /// `WM_GETHOTKEY` (seg14 `0647`): the window's hot key, or nought.
    pub(crate) fn get_hot_key(&self, hwnd: u16) -> u16 {
        self.hot_keys
            .iter()
            .find(|one| one.hwnd == hwnd)
            .map_or(0, |one| one.key)
    }

    /// A window at the top destroyed loses its hot key (seg8 `0e09`).
    pub(crate) fn forget_hot_key(&mut self, hwnd: u16) {
        if let Some(at) = self.hot_keys.iter().position(|one| one.hwnd == hwnd) {
            self.hot_keys.swap_remove(at);
        }
    }

    /// The next window at the top Alt and Escape would switch to from one
    /// (seg23 `0c58`), front to back from it and round: shown; not topmost,
    /// where asked; whose root owner last had it active, and that pop-up
    /// not disabled. None where there is no other.
    pub(crate) fn next_switchable(&self, hwnd: u16, previous: bool, skip_topmost: bool) -> u16 {
        let tops = self.top_level_hwnds();
        let Some(at) = tops.iter().position(|&each| each == hwnd) else {
            return 0;
        };

        for step in 1..tops.len() {
            let candidate = if previous {
                tops[(at + tops.len() - step) % tops.len()]
            } else {
                tops[(at + step) % tops.len()]
            };
            let Some(window) = self
                .window_named(candidate)
                .and_then(|index| self.windows[index].as_ref())
            else {
                continue;
            };

            if !window.visible || (skip_topmost && window.ex_style & WS_EX_TOPMOST != 0) {
                continue;
            }

            let mut root = window;

            while let Some(owner) = root.owner.and_then(|owner| self.windows[owner].as_ref()) {
                root = owner;
            }

            let last = if root.last_active_popup == 0 {
                root.hwnd
            } else {
                root.last_active_popup
            };
            let disabled = self
                .window_named(last)
                .and_then(|index| self.windows[index].as_ref())
                .is_some_and(|window| window.style & WS_DISABLED != 0);

            if disabled {
                continue;
            }

            if last == candidate {
                return candidate;
            }
        }

        0
    }
}

impl Engine {
    /// The keys USER's system queue takes for itself as a look comes to them
    /// (seg1 `3090`-`3178`), before the key is given a window, and whether
    /// the look takes it or only looks: a press only.
    ///
    /// * Any press but Alt's clears the flag that Alt was pressed alone,
    ///   which `DefWindowProc` opens the menu by (`30a5`): Print Screen with
    ///   Alt opens none.
    /// * Escape with Control down, as the key-state table has it:
    ///   `WM_SYSCOMMAND` with `SC_TASKLIST` posted to the active window,
    ///   unless it is the system-modal window -- none where none is active
    ///   -- and the key taken and thrown away (`30b5`-`30eb`). Its release
    ///   reaches the focus, as a system key (`3192`).
    /// * Print Screen: taken and thrown away, and the screen copied to the
    ///   clipboard -- the active window only, for the scan code nought that
    ///   the keyboard driver gives it with Alt (`30ee`-`311e`).
    /// * A hot key, where no window is system-modal: the key and Shift,
    ///   Control and Alt, held as the table has them, of a window shown in
    ///   the table: `WM_SYSCOMMAND` with `SC_HOTKEY` and that window posted
    ///   to the active window, and the key taken and thrown away (`3121`-
    ///   `3178`).
    ///
    /// Taken as USER's `4e2d` takes an event (`leave`). Not followed: USER's
    /// own system error box, during which none of these is done -- here it
    /// takes the keys itself.
    pub(crate) async fn queue_takes_key(&self, one: &Message) -> Result<bool, Stop> {
        let message = one.event.map_or(one.message, |event| event.message);

        if message != WM_KEYDOWN && message != WM_SYSKEYDOWN {
            return Ok(false);
        }

        let vk = one.wparam & 0xff;
        let (active, sys_modal, control) = {
            let mut system = self.system();

            if vk != VK_MENU as u16 {
                system.menu_loop.alt_alone = false;
            }

            (
                system.active_hwnd(),
                system.sys_modal_window(),
                system.held(VK_CONTROL),
            )
        };

        if vk == VK_ESCAPE && control {
            if active != sys_modal {
                self.system()
                    .post_message(active, WM_SYSCOMMAND, SC_TASKLIST, 0);
            }

            self.leave(one, one).await?;
            return Ok(true);
        }

        if vk == VK_SNAPSHOT {
            let scan = one.event.map_or(0, |event| event.param_l >> 8);
            let target = if scan == 1 {
                self.system().handles.lookup(Object::Desktop).unwrap_or(0)
            } else {
                active
            };

            self.leave(one, one).await?;
            self.snapshot(target).await?;
            return Ok(true);
        }

        let window = {
            let system = self.system();

            if sys_modal != 0 || system.hot_keys.is_empty() {
                0
            } else {
                let key = vk
                    | if system.held(VK_MENU) { HOTKEYF_ALT } else { 0 }
                    | if control { HOTKEYF_CONTROL } else { 0 }
                    | if system.held(VK_SHIFT) {
                        HOTKEYF_SHIFT
                    } else {
                        0
                    };

                system.hot_key_window(key)
            }
        };

        if window != 0 {
            self.system()
                .post_message(active, WM_SYSCOMMAND, SC_HOTKEY, u32::from(window));
            self.leave(one, one).await?;
            return Ok(true);
        }

        Ok(false)
    }

    /// A copy of a window, or of the screen, put on the clipboard as a
    /// bitmap, for Print Screen (seg41 `06b0`): of the window at the top it
    /// lies in; nothing where the clipboard is open. The clipboard is opened
    /// for the desktop window and emptied; the window's rectangle, as far as
    /// it is on the screen, copied from a DC of the whole window into a
    /// bitmap compatible with it -- a monochrome one where that cannot be
    /// made -- which is put on as `CF_BITMAP`; then closed, and left with no
    /// owner (`08ec`). Measured by `prtsc`: the screen at 640 by 480, a
    /// window moved part off it as much as shows.
    ///
    /// Not followed: a palette device's palette, put on as `CF_PALETTE`, and
    /// the message box USER shows where the bitmap cannot be made.
    async fn snapshot(&self, hwnd: u16) -> Result<(), Stop> {
        if hwnd == 0 {
            return Ok(());
        }

        let (rect, top) = {
            let mut system = self.system();
            let desktop = system.handles.lookup(Object::Desktop).unwrap_or(0);
            let (rect, top) = if hwnd == desktop {
                let (width, height) = (
                    i32::from(system.display.width),
                    i32::from(system.display.height),
                );

                ([0, 0, width, height], 0)
            } else {
                let Some(mut index) = system.window_named(hwnd) else {
                    return Ok(());
                };

                while let Some(parent) = system.windows[index].as_ref().and_then(|w| w.parent) {
                    index = parent;
                }

                let Some(window) = system.windows[index].as_ref() else {
                    return Ok(());
                };

                (
                    [
                        window.left,
                        window.top,
                        window.left + window.width,
                        window.top + window.height,
                    ],
                    window.hwnd,
                )
            };

            if system.controls.clipboard.open != 0 || !system.open_clipboard(desktop) {
                return Ok(());
            }

            (rect, top)
        };

        self.empty_clipboard().await?;

        let memory = {
            let mut system = self.system();
            let (width, height) = (
                i32::from(system.display.width),
                i32::from(system.display.height),
            );
            let dc = system.get_window_dc(top);
            let cx = rect[2].min(width) - rect[0].max(0);
            let cy = rect[3].min(height) - rect[1].max(0);
            let memory = if dc == 0 {
                0
            } else {
                crate::gdi::dc::create_compatible_dc(&mut system, dc)
            };

            if memory != 0 {
                let mut bitmap = crate::gdi::bitmaps::create_compatible_bitmap(
                    &mut system,
                    dc,
                    cx as i16,
                    cy as i16,
                );

                if bitmap == 0 {
                    bitmap = crate::gdi::bitmaps::create_bitmap(
                        &mut system,
                        cx as i16,
                        cy as i16,
                        1,
                        1,
                        0,
                    );
                }

                if bitmap != 0 {
                    let was = crate::gdi::dc::select_object(&mut system, memory, bitmap);

                    crate::gdi::draw::bit_blt(
                        &mut system,
                        memory,
                        [0, 0, cx, cy],
                        dc,
                        (-rect[0]).max(0),
                        (-rect[1]).max(0),
                        SRCCOPY,
                    );
                    crate::gdi::dc::select_object(&mut system, memory, was);
                    system.set_clipboard_data(CF_BITMAP, bitmap);
                }
            }

            if dc != 0 {
                system.release_dc(top, dc)?;
            }

            memory
        };

        self.close_clipboard().await?;

        let mut system = self.system();

        system.controls.clipboard.owner = 0;

        if memory != 0 {
            crate::gdi::dc::delete_dc(&mut system, memory);
        }

        Ok(())
    }

    /// `SC_TASKLIST`, as `DefWindowProc` carries it out (seg1 `050c`-
    /// `05f6`): TASKMAN.EXE in the Windows directory started, shown
    /// normally, given the point the command came with -- `x y`, as
    /// `" %d %d"` writes `lParam`'s words; and where that fails,
    /// TASKMAN.EXE as `WinExec` finds it. The hourglass shows meanwhile.
    /// Control and Escape give it (0, 0), which TASKMAN takes as the middle
    /// of the screen; a double click on the desktop its point (`tasklist`).
    pub(crate) async fn task_list(&self, lparam: u32) -> Result<(), Stop> {
        let x = lparam as u16 as i16;
        let y = (lparam >> 16) as u16 as i16;
        let tail = format!(" {x} {y}");
        let answer = self
            .win_exec_line(&format!("C:\\WINDOWS\\TASKMAN.EXE{tail}"), SW_SHOWNORMAL)
            .await?;

        if answer <= 32 {
            self.win_exec_line(&format!("TASKMAN.EXE{tail}"), SW_SHOWNORMAL)
                .await?;
        }

        Ok(())
    }

    /// `SC_HOTKEY` (seg1 `068a`): the window the key is given to,
    /// `lParam`, or the pop-up it last had active where that is still a
    /// window, switched to as Alt and Tab would.
    pub(crate) async fn hot_key_command(&self, lparam: u32) -> Result<(), Stop> {
        let hwnd = lparam as u16;
        let target = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let popup = system.windows[index]
                .as_ref()
                .map_or(0, |window| window.last_active_popup);

            if popup != 0 && system.window_named(popup).is_some() {
                popup
            } else {
                hwnd
            }
        };

        self.switch_to_this_window(target, true).await
    }

    /// `SwitchToThisWindow` (seg23 `0ceb`): the window brought to the top
    /// and made active; for a switch not by Alt and Tab, the window that was
    /// active sent to the bottom, unless it is topmost or there is no other
    /// to switch to; and for one by Alt and Tab, a window minimized sent
    /// `SC_RESTORE`. Measured by `tasklist` and `hotkey`.
    pub(crate) async fn switch_to_this_window(&self, hwnd: u16, alt_tab: bool) -> Result<(), Stop> {
        let (index, active, send_back) = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let active = system.active_hwnd();
            let send_back = !alt_tab
                && active != 0
                && active != hwnd
                && system.next_switchable(active, false, true) != 0
                && system
                    .window_named(active)
                    .and_then(|index| system.windows[index].as_ref())
                    .is_some_and(|window| window.ex_style & WS_EX_TOPMOST == 0);

            (index, active, send_back)
        };

        self.position_raster(hwnd, index, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE)
            .await?;

        if send_back {
            let was = self.system().window_named(active);

            if let Some(was) = was {
                self.position_raster(
                    active,
                    was,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
                )
                .await?;
            }
        }

        let minimized = self.system().windows[index]
            .as_ref()
            .is_some_and(|window| window.placement == Placement::Minimized);

        if alt_tab && minimized {
            self.send_message(hwnd, WM_SYSCOMMAND, SC_RESTORE, &mut Param::Value(0))
                .await?;
        }

        Ok(())
    }

    /// The desktop window's procedure (seg1 `9e6b`), as far as winbox.js
    /// has it: a double click on it is `SC_TASKLIST` with its point, which
    /// `DefWindowProc` carries out for it as for any window. The rest -- its
    /// background painted for `WM_ERASEBKGND`, `WM_PALETTECHANGED` -- is the
    /// raster desktop's own.
    pub(crate) async fn desktop_proc(
        &self,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        if message == WM_LBUTTONDBLCLK
            || (message == WM_SYSCOMMAND && wparam & 0xfff0 == SC_TASKLIST)
        {
            self.task_list(lparam).await?;
        }

        Ok(0)
    }
}

/// `SwitchToThisWindow`, the call.
pub fn switch_to_this_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, alt_tab) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        engine.switch_to_this_window(hwnd, alt_tab != 0).await?;
        Ok(Answer::Nothing)
    })
}
