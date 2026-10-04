//! The mouse on the raster desktop, as winbox.js's `raster-input.ts` gives
//! it to the windows: the window under a point, which part of it the point
//! is on, and a move posted to that window's queue. Only the moves USER
//! makes of its own accord are here yet; the host's mouse and keyboard come
//! with the native front end.

use crate::call::Stop;
use crate::handles::Object;
use crate::queue::{Message, WM_MOUSEMOVE};
use crate::system::System;
use crate::windows::Placement;

const WM_NCMOUSEMOVE: u16 = 0x00a0;

pub const HTNOWHERE: u16 = 0;
pub const HTCLIENT: u16 = 1;
pub const HTCAPTION: u16 = 2;
pub const HTSYSMENU: u16 = 3;
pub const HTMENU: u16 = 5;
pub const HTHSCROLL: u16 = 6;
pub const HTVSCROLL: u16 = 7;
pub const HTMINBUTTON: u16 = 8;
pub const HTMAXBUTTON: u16 = 9;
pub const HTLEFT: u16 = 10;
pub const HTRIGHT: u16 = 11;
pub const HTTOP: u16 = 12;
pub const HTTOPLEFT: u16 = 13;
pub const HTTOPRIGHT: u16 = 14;
pub const HTBOTTOM: u16 = 15;
pub const HTBOTTOMLEFT: u16 = 16;
pub const HTBOTTOMRIGHT: u16 = 17;
pub const HTBORDER: u16 = 18;

const WS_DISABLED: u32 = 0x0800_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

const SM_CXVSCROLL: i16 = 2;
const SM_CYHSCROLL: i16 = 3;
const SM_CYCAPTION: i16 = 4;
const SM_CYMENU: i16 = 15;
const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;

impl System {
    /// The window that shows at a point of the screen, if any. (A group
    /// box passes the mouse to what lies beneath it; there are no controls
    /// here yet.)
    pub fn window_at(&self, x: i32, y: i32) -> Option<usize> {
        let (width, height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );

        if x < 0 || y < 0 || x >= width || y >= height {
            return None;
        }

        let id = *self.owners.get((y * width + x) as usize)?;

        (id != 0).then(|| usize::from(id) - 1)
    }

    /// Whether a window has a menu bar, as the desktop keeps one: a menu
    /// handle that names a menu.
    fn has_menu_bar(&self, index: usize) -> bool {
        let menu = self.windows[index].as_ref().map_or(0, |window| window.menu);

        matches!(self.handles.resolve(menu), Some(Object::Menu(_)))
    }

    /// Which part of a window a point of the screen is on, as
    /// `DefWindowProc` answers `WM_NCHITTEST`: its client area, its caption
    /// and the boxes on it, its menu bar, its scroll bars, or its border.
    pub fn hit_test(&self, index: usize, x: i32, y: i32) -> u16 {
        let window = self.windows[index].as_ref().expect("a window");
        let (wx, wy) = (x - window.left, y - window.top);
        let client = window.client;
        let (left, top, right, bottom) = (client.left, client.top, client.right, client.bottom);

        if wx < 0 || wy < 0 || wx >= window.width || wy >= window.height {
            return HTNOWHERE;
        }

        // An icon is all caption: pressed, it moves; twice, it restores.
        if window.placement == Placement::Minimized {
            return HTCAPTION;
        }

        if wx >= left && wx < right && wy >= top && wy < bottom {
            return HTCLIENT;
        }

        let style = window.style;

        // A sizing frame: its edges, and its corners as far as the notches.
        if style & WS_THICKFRAME != 0 && window.placement == Placement::Normal {
            let frame = self.metric(SM_CXFRAME);
            let frame_y = self.metric(SM_CYFRAME);
            let corner = frame + self.metric(SM_CXSIZE);
            let corner_y = frame_y + self.metric(SM_CYSIZE);
            let on_left = wx < frame;
            let on_right = wx >= window.width - frame;
            let on_top = wy < frame_y;
            let on_bottom = wy >= window.height - frame_y;
            let near_left = wx < corner;
            let near_right = wx >= window.width - corner;
            let near_top = wy < corner_y;
            let near_bottom = wy >= window.height - corner_y;

            if (on_top && near_left) || (on_left && near_top) {
                return HTTOPLEFT;
            }

            if (on_top && near_right) || (on_right && near_top) {
                return HTTOPRIGHT;
            }

            if (on_bottom && near_left) || (on_left && near_bottom) {
                return HTBOTTOMLEFT;
            }

            if (on_bottom && near_right) || (on_right && near_bottom) {
                return HTBOTTOMRIGHT;
            }

            if on_left {
                return HTLEFT;
            }

            if on_right {
                return HTRIGHT;
            }

            if on_top {
                return HTTOP;
            }

            if on_bottom {
                return HTBOTTOM;
            }
        }

        // The scroll bars run from a pixel outside the client area.
        if style & WS_VSCROLL != 0
            && wx >= right
            && wx < right + self.metric(SM_CXVSCROLL)
            && wy >= top - 1
            && wy < bottom
        {
            return HTVSCROLL;
        }

        if style & WS_HSCROLL != 0
            && wy >= bottom
            && wy < bottom + self.metric(SM_CYHSCROLL)
            && wx >= left - 1
            && wx < right
        {
            return HTHSCROLL;
        }

        let menu = self.has_menu_bar(index);

        if menu
            && wy < top
            && wy >= top - self.metric(SM_CYMENU) - 1
            && wx >= left
            && wx < window.width - left
        {
            return HTMENU;
        }

        if style & WS_CAPTION == WS_CAPTION {
            let caption_bottom = top - if menu { self.metric(SM_CYMENU) + 1 } else { 0 };
            let caption_top = caption_bottom - self.metric(SM_CYCAPTION);
            let inner = window.width - left;

            if wy >= caption_top && wy < caption_bottom && wx >= left && wx < inner {
                let size = self.metric(SM_CXSIZE) + 1;

                if style & WS_SYSMENU != 0 && wx < left + size {
                    return HTSYSMENU;
                }

                if style & WS_MAXIMIZEBOX != 0 && wx >= inner - size {
                    return HTMAXBUTTON;
                }

                let boxes = if style & WS_MAXIMIZEBOX != 0 { 2 } else { 1 };

                if style & WS_MINIMIZEBOX != 0 && wx >= inner - size * boxes {
                    return HTMINBUTTON;
                }

                return HTCAPTION;
            }
        }

        HTBORDER
    }

    /// Whether a window, or any window it is inside, has `WS_DISABLED`.
    fn disabled(&self, index: usize) -> bool {
        let mut at = Some(index);

        while let Some(window) = at {
            let window = self.windows[window].as_ref().expect("a window");

            if window.style & WS_DISABLED != 0 {
                return true;
            }

            at = window.parent;
        }

        false
    }

    /// The mouse moved to a point, held where `ClipCursor` keeps it: a move
    /// posted to the window under it, `WM_NCMOUSEMOVE` with the part it is
    /// on off its client area. A disabled window takes none.
    pub fn pointer_moved(&mut self, x: i16, y: i16) {
        self.cursor_pos = Some((x, y));

        let Some(target) = self.window_at(i32::from(x), i32::from(y)) else {
            return;
        };

        if self.disabled(target) {
            return;
        }

        let hit = self.hit_test(target, i32::from(x), i32::from(y));
        let window = self.windows[target].as_ref().expect("a window");
        let client = hit == HTCLIENT;
        let (px, py) = if client {
            (
                i32::from(x) - window.left - window.client.left,
                i32::from(y) - window.top - window.client.top,
            )
        } else {
            (i32::from(x), i32::from(y))
        };
        let message = if client { WM_MOUSEMOVE } else { WM_NCMOUSEMOVE };
        let wparam = if client { 0 } else { hit };
        let hwnd = window.hwnd;

        self.post_input(
            hwnd,
            message,
            wparam,
            (px as u32 & 0xffff) | (py as u32 & 0xffff) << 16,
        );
    }

    /// Input posted to a window's task's queue. A move not yet taken, with
    /// nothing after it, is replaced by the next, which goes to the window
    /// under the mouse then (`setcur`).
    fn post_input(&mut self, hwnd: u16, message: u16, wparam: u16, lparam: u32) {
        let mut made = self.message_now(hwnd, message, wparam, lparam);
        let moves = message == WM_MOUSEMOVE || message == WM_NCMOUSEMOVE;

        self.message_serials += 1;
        made.serial = self.message_serials;

        let last = self.last_move.take();
        let Some(task) = self.task.as_mut() else {
            return;
        };

        if moves && let Some(last) = last {
            task.queue.input.retain(|one: &Message| one.serial != last);
        }

        task.queue.push(made, true);
        self.last_move = moves.then_some(made.serial);
        self.signal();
    }

    /// A mouse move USER makes of its own accord, where the cursor is:
    /// after a window is shown or moves, and after `SetCursorPos`.
    /// **Recorded** by `mousemv`: the window under the cursor is sent
    /// `WM_MOUSEMOVE` at that point, whether or not the window that changed
    /// is the one under it, and with no window there the desktop is.
    pub fn nudge(&mut self) -> Result<(), Stop> {
        if self.driver.is_none() {
            return Ok(());
        }

        let (x, y) = self.cursor_of();

        if self.window_at(i32::from(x), i32::from(y)).is_none() {
            let Some(desktop) = self.handles.lookup(Object::Desktop) else {
                return Ok(());
            };
            let point = u32::from(y as u16) << 16 | u32::from(x as u16);

            self.post_message(desktop, WM_MOUSEMOVE, 0, point);
            return Ok(());
        }

        self.pointer_moved(x, y);
        Ok(())
    }
}
