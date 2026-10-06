//! The mouse on the raster desktop, as winbox.js's `raster-input.ts` gives
//! it to the windows: the window under a point, which part of it the point
//! is on, and a move posted to that window's queue. The keyboard's is
//! `key_input.rs`.

use crate::call::Stop;
use crate::handles::Object;
use crate::queue::{Message, WM_MOUSEMOVE};
use crate::system::System;
use crate::windows::Placement;

const WM_NCMOUSEMOVE: u16 = 0x00a0;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const WM_RBUTTONDOWN: u16 = 0x0204;
const WM_RBUTTONUP: u16 = 0x0205;
const WM_RBUTTONDBLCLK: u16 = 0x0206;
const WM_MBUTTONDOWN: u16 = 0x0207;
const WM_MBUTTONUP: u16 = 0x0208;
const WM_MBUTTONDBLCLK: u16 = 0x0209;
const MK_LBUTTON: u16 = 0x0001;
const MK_RBUTTON: u16 = 0x0002;
const MK_MBUTTON: u16 = 0x0010;
const CS_DBLCLKS: u16 = 0x0008;

/// What the pointer did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointerKind {
    Down,
    Up,
    Move,
}

/// The pointer as the mouse left it: where, which button changed, the
/// buttons down -- left 1, right 2, middle 4 -- and whether a press is a
/// double click.
#[derive(Debug, Clone, Copy)]
pub struct Pointer {
    pub kind: PointerKind,
    pub x: i16,
    pub y: i16,
    /// The button pressed or released: 0 left, 1 middle, 2 right.
    pub button: u8,
    pub buttons: u8,
    pub double: bool,
}

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
const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
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

        if id == 0 {
            return None;
        }

        let found = usize::from(id) - 1;
        let at = self.z_order.iter().position(|&other| other == found)?;

        // A group box answers `WM_NCHITTEST` with `HTTRANSPARENT` (`USER.EXE`
        // seg25 `1c9b`): the mouse goes to what lies beneath it.
        for (step, &index) in self.z_order[at..].iter().enumerate() {
            let window = self.windows[index].as_ref().expect("a window");
            let [left, top, right, bottom] = window.clip_rect;

            if step != 0
                && (!self.showing(index) || x < left || y < top || x >= right || y >= bottom)
            {
                continue;
            }

            let group_box = window
                .control
                .as_ref()
                .is_some_and(|control| control.class_name == "BUTTON" && control.style & 0x0f == 7);

            if !group_box {
                return Some(index);
            }
        }

        Some(found)
    }

    /// Whether a window has a menu bar, as the desktop keeps one: a menu
    /// handle that names a menu.
    fn has_menu_bar(&self, index: usize) -> bool {
        self.windows[index]
            .as_ref()
            .is_some_and(|window| window.bar.is_some())
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
        // So is its title, whose procedure answers `WM_NCHITTEST` with
        // `HTCAPTION` (`USER.EXE` seg1 `6dbd`) and hands the press to the
        // icon (`icon_title_proc`).
        if window.placement == Placement::Minimized || window.title_of.is_some() {
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
    pub(crate) fn disabled(&self, index: usize) -> bool {
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
    /// posted to the window under it.
    pub fn pointer_moved(&mut self, x: i16, y: i16) {
        let buttons = self.mouse_buttons;

        self.pointer_event(Pointer {
            kind: PointerKind::Move,
            x,
            y,
            button: 0,
            buttons,
            double: false,
        });
    }

    /// A pointer pressed, released or moved: `WM_MOUSEMOVE` and the button
    /// messages in a client area, their `WM_NC` forms elsewhere on a window.
    /// A press on a window that is not active makes it active first; a
    /// disabled window, or one inside one, takes nothing.
    #[allow(clippy::too_many_lines)]
    pub fn pointer_event(&mut self, pointer: Pointer) {
        let (x, y) = self.held_point((pointer.x, pointer.y));

        // The buttons as they are now, for `GetAsyncKeyState`.
        for (bit, key) in [(1u8, 0x01usize), (2, 0x02), (4, 0x04)] {
            if pointer.buttons & bit != self.mouse_buttons & bit {
                let table = &mut self.user_state.async_keys;

                if pointer.buttons & bit != 0 {
                    table[key] |= 0x81;
                } else {
                    table[key] &= !0x80;
                }
            }
        }

        self.cursor_pos = Some((x, y));

        // USER's system error box up: the left button and the moves are
        // its, and nothing else is anyone's.
        if self.modal_input.is_some() {
            let message = match pointer.kind {
                PointerKind::Move => WM_MOUSEMOVE,
                _ if pointer.button != 0 => 0,
                PointerKind::Down => WM_LBUTTONDOWN,
                PointerKind::Up => WM_LBUTTONUP,
            };

            self.mouse_buttons = pointer.buttons;

            if message != 0
                && let Some(queue) = self.modal_input.as_mut()
            {
                queue.push_back((message, u16::from(pointer.buttons), x, y));
            }

            return;
        }

        // A caption pressed goes to `DefWindowProc`'s move loop, which takes
        // the mouse until it is let go: what comes before that loop starts
        // is its too.
        let capture = self.capture.filter(|&index| self.windows[index].is_some());
        let pressed =
            if capture.is_none() && self.mouse_buttons != 0 && pointer.kind != PointerKind::Down {
                self.caption_press
                    .filter(|&index| self.windows[index].is_some())
            } else {
                None
            };
        let target = capture
            .or(pressed)
            .or_else(|| self.window_at(i32::from(x), i32::from(y)));

        self.mouse_buttons = pointer.buttons;

        let Some(target) = target else {
            return;
        };

        if capture.is_none() && self.disabled(target) {
            return;
        }

        let hit = if capture.is_some() {
            HTCLIENT
        } else {
            self.hit_test(target, i32::from(x), i32::from(y))
        };

        if pointer.kind == PointerKind::Down {
            self.caption_press = (hit == HTCAPTION && capture.is_none()).then_some(target);
        } else if pointer.buttons == 0 {
            self.caption_press = None;
        }

        if pointer.kind == PointerKind::Down {
            let mut top = target;

            while let Some(parent) = self.windows[top].as_ref().and_then(|window| window.parent) {
                top = parent;
            }

            let (active, of_desktop) =
                self.windows[top].as_ref().map_or((false, false), |window| {
                    (
                        window.active,
                        window.style & (WS_CHILD | WS_POPUP) == WS_CHILD,
                    )
                });

            // Activated by the press: the messages go before it, and move the
            // focus. A caption pressed is not: `DefWindowProc` activates its
            // window as it takes the press (`iconclk`). Nor is any window
            // while one has the mouse, nor one that is a child of the
            // desktop window, as a combo box's list dropped down is
            // (`USER.EXE` seg1 `2939`, `2998`; `comboact`).
            if !active && hit != HTCAPTION && capture.is_none() && !of_desktop {
                self.show(top);

                if let Some((_, click)) = self.pending_activation.as_mut() {
                    *click = true;
                }

                self.wake();
            } else if active && capture.is_none() {
                let control = self.windows[target]
                    .as_ref()
                    .is_some_and(|window| window.control.is_some());

                self.focus = if control {
                    Some(target)
                } else {
                    Some(self.focus.unwrap_or(top))
                };
            }
        }

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
        let message = match pointer.kind {
            PointerKind::Move => {
                if client {
                    WM_MOUSEMOVE
                } else {
                    WM_NCMOUSEMOVE
                }
            }
            kind => {
                // A double click is one in a client area only for a class
                // that asks for them; on the frame and caption, it always is.
                let double = pointer.double
                    && kind == PointerKind::Down
                    && (!client || self.class_style(target) & CS_DBLCLKS != 0);
                let base: [u16; 3] = match pointer.button {
                    1 => [WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MBUTTONDBLCLK],
                    2 => [WM_RBUTTONDOWN, WM_RBUTTONUP, WM_RBUTTONDBLCLK],
                    _ => [WM_LBUTTONDOWN, WM_LBUTTONUP, WM_LBUTTONDBLCLK],
                };
                let message = if kind == PointerKind::Up {
                    base[1]
                } else if double {
                    base[2]
                } else {
                    base[0]
                };

                // The non-client forms are the client ones moved down by 160h.
                if client {
                    message
                } else {
                    message - (WM_MOUSEMOVE - WM_NCMOUSEMOVE)
                }
            }
        };
        let wparam = if client {
            [(1, MK_LBUTTON), (2, MK_RBUTTON), (4, MK_MBUTTON)]
                .iter()
                .filter(|&&(bit, _)| pointer.buttons & bit != 0)
                .fold(0, |flags, &(_, flag)| flags | flag)
        } else {
            hit
        };
        let hwnd = window.hwnd;

        self.post_input(
            hwnd,
            message,
            wparam,
            (px as u32 & 0xffff) | (py as u32 & 0xffff) << 16,
        );
    }

    /// The style of a window's class.
    pub(crate) fn class_style(&self, index: usize) -> u16 {
        self.windows[index]
            .as_ref()
            .and_then(|window| self.class_named(&window.class))
            .map_or(0, |class| self.classes[class].style)
    }

    /// Each task with a window due to be painted woken: it looks again, and
    /// paints it, as Windows makes the paint when the queue is empty.
    pub fn wake(&mut self) {
        self.wake_except(None);
    }

    /// `wake`, but for the task given: a task giving the processor up wakes
    /// the others with a window due.
    pub(crate) fn wake_except(&mut self, except: Option<usize>) {
        let mut woken = Vec::new();

        for &index in &self.z_order {
            let Some(window) = self.windows[index].as_ref() else {
                continue;
            };

            if !(window.paints_itself() && window.needs_paint && self.showing(index)) {
                continue;
            }

            let slot = self.slot_of(window.task).or_else(|| self.lone_slot());

            if let Some(slot) = slot
                && Some(slot) != except
                && !woken.contains(&slot)
            {
                woken.push(slot);
            }
        }

        for slot in woken {
            self.signal_slot(slot);
        }
    }

    /// Input posted to a window's task's queue. A move not yet taken, with
    /// nothing after it, is replaced by the next, which goes to the window
    /// under the mouse then (`setcur`).
    pub(crate) fn post_input(&mut self, hwnd: u16, message: u16, wparam: u16, lparam: u32) {
        let mut made = self.message_now(hwnd, message, wparam, lparam);
        let moves = message == WM_MOUSEMOVE || message == WM_NCMOUSEMOVE;

        self.message_serials += 1;
        made.serial = self.message_serials;

        let last = self.last_move.take();
        let Some(slot) = self.window_slot(hwnd).or_else(|| self.lone_slot()) else {
            return;
        };

        if moves
            && let Some((before, serial)) = last
            && let Some(queue) = self.queue_of(before)
        {
            queue.input.retain(|one: &Message| one.serial != serial);
        }

        let Some(queue) = self.queue_of(slot) else {
            return;
        };

        queue.push(made, true);
        self.last_move = moves.then_some((slot, made.serial));
        self.signal_slot(slot);
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

        if self.capture.is_none() && self.window_at(i32::from(x), i32::from(y)).is_none() {
            let Some(desktop) = self.handles.lookup(Object::Desktop) else {
                return Ok(());
            };
            let point = u32::from(y as u16) << 16 | u32::from(x as u16);

            // Input, as the mouse's own moves are, not a message posted:
            // after what was posted and after the quit (`quitin`), and
            // several before the queue is looked at kept as one
            // (`nudges`).
            self.post_input(desktop, WM_MOUSEMOVE, 0, point);
            return Ok(());
        }

        self.pointer_moved(x, y);
        Ok(())
    }
}

/// The mouse driver's way into USER: a move, a press or a release put in as
/// the mouse made it, called with registers, not a stack. **Read out** of
/// `USER.EXE` (seg1 `507a`): AX the flags, BX and CX where. Bit 1 moved; 2
/// and 4 the left button pressed and released, 8 and 10h the right, 20h and
/// 40h the middle -- the buttons first, where the pointer was, and the move
/// after them; with bit 8000h, BX and CX are absolute, 0 to 65535 across
/// the screen. **Recorded** by `iconclk`. Not modelled: a move without
/// 8000h, which USER scales by the mouse's speed; here it leaves the pointer
/// where it is. A double click's two presses must be at the same point.
pub fn mouse_event(
    system: &mut System,
    _: &mut crate::call::Args,
) -> Result<crate::call::Answer, Stop> {
    let flags = system.cpu.regs[winbox_cpu::AX];
    let bx = system.cpu.regs[winbox_cpu::BX];
    let cx = system.cpu.regs[winbox_cpu::CX];

    if !system.raster() {
        return Ok(crate::call::Answer::Nothing);
    }

    let double_time =
        match crate::user_misc::get_double_click_time(system, &mut crate::call::Args::repeat(0))? {
            crate::call::Answer::Word(time) => f64::from(time),
            _ => 500.0,
        };
    let now = system.clock.now(system.instructions);

    for (down, up, button, bit) in [
        (0x02u16, 0x04u16, 0u8, 1u8),
        (0x08, 0x10, 2, 2),
        (0x20, 0x40, 1, 4),
    ] {
        if flags & (down | up) == 0 {
            continue;
        }

        let (x, y) = system.cursor_of();
        let pressed = flags & down != 0;
        let double = pressed
            && system.last_press.is_some_and(|(last, lx, ly, time)| {
                last == button && lx == x && ly == y && now - time < double_time
            });

        if pressed {
            system.last_press = if double {
                None
            } else {
                Some((button, x, y, now))
            };
        }

        let buttons = if pressed {
            system.mouse_buttons | bit
        } else {
            system.mouse_buttons & !bit
        };

        system.pointer_event(Pointer {
            kind: if pressed {
                PointerKind::Down
            } else {
                PointerKind::Up
            },
            x,
            y,
            button,
            buttons,
            double,
        });
    }

    if flags & 0x0001 != 0 && flags & 0x8000 != 0 {
        let (width, height) = (
            i32::from(system.display.width),
            i32::from(system.display.height),
        );
        let x = (i32::from(bx) * width).div_euclid(65536) as i16;
        let y = (i32::from(cx) * height).div_euclid(65536) as i16;
        let buttons = system.mouse_buttons;

        system.pointer_event(Pointer {
            kind: PointerKind::Move,
            x,
            y,
            button: 0,
            buttons,
            double: false,
        });
    }

    Ok(crate::call::Answer::Nothing)
}
