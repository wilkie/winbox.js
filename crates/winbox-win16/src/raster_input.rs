//! The mouse on the raster desktop, as winbox.js's `raster-input.ts` gives
//! it to the windows: the window under a point, and the mouse put in that
//! window's task's queue as the mouse made it, to be hit-tested as it is
//! taken (`mouse_scan.rs`). The keyboard's is `key_input.rs`.

use crate::call::Stop;
use crate::handles::Object;
use crate::mouse_scan::MouseInput;
use crate::queue::{Message, WM_MOUSEMOVE};
use crate::system::System;
use crate::windows::{Placement, Rect, Window};
use winbox_raster::DeviceBitmap;

const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_RBUTTONDOWN: u16 = 0x0204;
const WM_RBUTTONUP: u16 = 0x0205;
const WM_MBUTTONDOWN: u16 = 0x0207;
const WM_MBUTTONUP: u16 = 0x0208;
const MK_LBUTTON: u16 = 0x0001;
const MK_RBUTTON: u16 = 0x0002;
const MK_MBUTTON: u16 = 0x0010;

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
pub const HTGROWBOX: u16 = 4;
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
/// -2: a disabled window at the top (`USER.EXE` seg1 `71f4`).
pub const HTERROR: u16 = 0xfffe;

const WS_DISABLED: u32 = 0x0800_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_BORDER: u32 = 0x0080_0000;
const WS_DLGFRAME: u32 = 0x0040_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

const SM_CYHSCROLL: i16 = 3;
const SM_CYCAPTION: i16 = 4;
const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;

/// The minimize box's bitmap, whose width is each box's on the caption
/// (`USER.EXE` seg3 `0fb8`).
const OBM_REDUCE: u16 = 32749;

/// A rectangle grown by `dx` and `dy` on each side, as `InflateRect`.
fn inflate(r: Rect, dx: i32, dy: i32) -> Rect {
    Rect {
        left: r.left - dx,
        top: r.top - dy,
        right: r.right + dx,
        bottom: r.bottom + dy,
    }
}

/// Which part of a sizing frame a point outside its inner rectangle `r`
/// is on (`USER.EXE` seg1 `67bb`): on or above its top, or on or below its
/// bottom, a corner within `across` of the rectangle's ends, else the edge;
/// left or right of it, a corner within `down` of its top or bottom, else
/// the side.
fn sizing_part(r: &Rect, wx: i32, wy: i32, across: i32, down: i32) -> u16 {
    if wy >= r.bottom || wy <= r.top {
        let bottom = wy >= r.bottom;

        return if wx <= r.left + across {
            if bottom { HTBOTTOMLEFT } else { HTTOPLEFT }
        } else if wx >= r.right - across {
            if bottom { HTBOTTOMRIGHT } else { HTTOPRIGHT }
        } else if bottom {
            HTBOTTOM
        } else {
            HTTOP
        };
    }

    let left = wx <= r.left;

    if wy <= r.top + down {
        if left { HTTOPLEFT } else { HTTOPRIGHT }
    } else if wy >= r.bottom - down {
        if left { HTBOTTOMLEFT } else { HTBOTTOMRIGHT }
    } else if left {
        HTLEFT
    } else {
        HTRIGHT
    }
}

/// Whether a window has a dialog frame, as USER lays out and draws one
/// (`USER.EXE` seg1 `6744`, `6fed`, `9fa5`): `WS_DLGFRAME` without
/// `WS_BORDER`, or `WS_EX_DLGMODALFRAME`, a sizing frame or not.
pub(crate) fn dialog_framed(window: &Window) -> bool {
    window.modal_frame || window.style & (WS_BORDER | WS_DLGFRAME) == WS_DLGFRAME
}

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
    /// `DefWindowProc` answers `WM_NCHITTEST` (`USER.EXE` seg1 `6714`),
    /// recorded at every pixel of each kind of frame by the `nchit` probe
    /// on three displays. Nothing asks whether the point is on the window
    /// at all: a point beside a sizing frame is its edge's, and beside a
    /// dialog frame `HTBORDER`.
    ///
    /// * An icon is all caption (`WS_MINIMIZE`, `672f`). So is an icon's
    ///   title, whose procedure answers `HTCAPTION` itself (`6dbd`) and
    ///   hands the press to the icon (`icon_title_proc`).
    /// * The client area is `HTCLIENT`, before anything else.
    /// * A sizing frame: the window's rectangle less `SM_CXFRAME` and
    ///   `SM_CYFRAME` on each side, and any point outside that is the
    ///   frame's (`678e`). On or above its top, or on or below its bottom, a
    ///   corner where it is within `SM_CXSIZE` of the inner rectangle's
    ///   ends, else the edge; left or right of it, a corner within
    ///   `SM_CYSIZE` of its top or bottom, else the side.
    /// * A dialog frame, `WS_DLGFRAME` without `WS_BORDER`, or
    ///   `WS_EX_DLGMODALFRAME`: outside the rectangle so far less four
    ///   borders and one, `HTBORDER` (`685c`). Within a sizing frame, that
    ///   is less the sizing frame too.
    /// * Above the client area, in a caption's height from the top of that
    ///   rectangle: the system menu's box, `SM_CXSIZE` and a border from its
    ///   left; the rightmost box, `OBM_REDUCE`'s width and a border from its
    ///   right, the maximize box, or the minimize box where there is only
    ///   that; the box beside it the minimize box where there are both; the
    ///   rest the caption (`68ca`). Below the caption, or below the
    ///   rectangle's top without one, the menu bar where there is one
    ///   (`693f`). Neither looks at where the point is across.
    /// * Below the client area, the horizontal scroll bar, or `HTGROWBOX`
    ///   right of the client area; right of it, the vertical (`694e`).
    /// * Anywhere else, `HTNOWHERE`: a plain border, and a point beside the
    ///   window.
    pub fn hit_test(&self, index: usize, x: i32, y: i32) -> u16 {
        let window = self.windows[index].as_ref().expect("a window");
        let (wx, wy) = (x - window.left, y - window.top);
        let client = window.client;

        if window.placement == Placement::Minimized || window.title_of.is_some() {
            return HTCAPTION;
        }

        let inside = |r: &Rect| wx >= r.left && wx < r.right && wy >= r.top && wy < r.bottom;

        if inside(&client) {
            return HTCLIENT;
        }

        let style = window.style;
        let mut r = Rect {
            left: 0,
            top: 0,
            right: window.width,
            bottom: window.height,
        };

        if style & WS_THICKFRAME != 0 {
            r = inflate(r, -self.metric(SM_CXFRAME), -self.metric(SM_CYFRAME));

            if !inside(&r) {
                return sizing_part(&r, wx, wy, self.metric(SM_CXSIZE), self.metric(SM_CYSIZE));
            }
        }

        if dialog_framed(window) {
            r = inflate(
                r,
                -(4 * self.metric(SM_CXBORDER) + 1),
                -(4 * self.metric(SM_CYBORDER) + 1),
            );

            if !inside(&r) {
                return HTBORDER;
            }
        }

        if wy < client.top {
            let caption = style & WS_CAPTION == WS_CAPTION;
            let below = r.top
                + if caption {
                    self.metric(SM_CYCAPTION)
                } else {
                    0
                };

            if caption && wy < below && wy >= r.top {
                let border = self.metric(SM_CXBORDER);

                if style & WS_SYSMENU != 0
                    && wx >= r.left
                    && wx < r.left + self.metric(SM_CXSIZE) + border
                {
                    return HTSYSMENU;
                }

                let max = style & WS_MAXIMIZEBOX != 0;
                let min = style & WS_MINIMIZEBOX != 0;

                if !max && !min {
                    return HTCAPTION;
                }

                let reduce = self
                    .driver
                    .as_ref()
                    .and_then(|driver| driver.oem.get(&OBM_REDUCE));
                let width = reduce.map_or_else(|| self.metric(SM_CXSIZE) + 1, DeviceBitmap::width);

                if wx >= r.right - width - border {
                    return if max { HTMAXBUTTON } else { HTMINBUTTON };
                }

                return if wx >= r.right - 2 * width - border && max && min {
                    HTMINBUTTON
                } else {
                    HTCAPTION
                };
            }

            let menu = self.has_menu_bar(index) && style & WS_CHILD == 0;

            return if menu && wy >= below {
                HTMENU
            } else {
                HTNOWHERE
            };
        }

        let (vertical, horizontal) = self.scroll_bars_present(window);

        if wy >= client.bottom {
            return if !horizontal {
                HTNOWHERE
            } else if wx > client.right {
                HTGROWBOX
            } else {
                HTHSCROLL
            };
        }

        if wx >= client.right && vertical {
            HTVSCROLL
        } else {
            HTNOWHERE
        }
    }

    /// Which of a window's scroll bars its frame left room for, vertical
    /// and horizontal, as `WM_NCCALCSIZE` lays them out (`USER.EXE` seg1
    /// `70b7`, `client_of`): neither where the caption and menu bar reach
    /// the frame's bottom, else the vertical one wherever the style asks for
    /// it, and the horizontal one where more than `SM_CYHSCROLL` is left.
    /// Worked back from the client area, whose top is where they were laid
    /// out from.
    fn scroll_bars_present(&self, window: &Window) -> (bool, bool) {
        let style = window.style;
        let edge = if dialog_framed(window) {
            4 * self.metric(SM_CYBORDER) + 1
        } else if style & WS_THICKFRAME != 0 {
            self.metric(SM_CYFRAME)
        } else if style & WS_BORDER != 0 {
            self.metric(SM_CYBORDER)
        } else {
            0
        };
        let room = window.height - edge - window.client.top;

        (
            style & WS_VSCROLL != 0 && room > 0,
            style & WS_HSCROLL != 0 && room > self.metric(SM_CYHSCROLL),
        )
    }

    /// The window a press on a disabled window brings up (`USER.EXE` seg1
    /// `5745`): the first after it in the order of windows, going round,
    /// of the same task, enabled and shown -- if the disabled window owns
    /// it; else none. With it, whether it is the window in front of all.
    pub(crate) fn owned_to_bring_up(&self, index: usize) -> Option<(usize, bool)> {
        let tops: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&one| {
                self.windows[one]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_none() && window.hwnd != 0)
            })
            .collect();
        let at = tops.iter().position(|&one| one == index)?;
        let task = self.windows[index].as_ref()?.task;

        for step in 1..tops.len() {
            let other = tops[(at + step) % tops.len()];
            let window = self.windows[other].as_ref()?;

            if window.task != task || window.style & WS_DISABLED != 0 || !window.visible {
                continue;
            }

            let mut owner = window.owner;

            while let Some(one) = owner {
                if one == index {
                    return Some((other, tops[0] == other));
                }

                owner = self.windows[one].as_ref().and_then(|window| window.owner);
            }

            return None;
        }

        None
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
            if pointer.kind == PointerKind::Move {
                self.move_to_desktop(x, y);
            }

            return;
        };

        // A caption pressed, as the frame lies: what follows it, until the
        // buttons are let go, goes to that window's task (above).
        if pointer.kind == PointerKind::Down {
            self.caption_press = (capture.is_none()
                && !self.disabled(target)
                && self.hit_test(target, i32::from(x), i32::from(y)) == HTCAPTION)
                .then_some(target);
        } else if pointer.buttons == 0 {
            self.caption_press = None;
        }

        // Put in as the mouse made it, to be hit-tested as it is taken: the
        // window it lands on, the part of it, the form the message takes,
        // and a press's activation are the look's to find (`mouse_scan.rs`).
        // Here it only finds the queue: the task of the window under it now.
        let message = match pointer.kind {
            PointerKind::Move => WM_MOUSEMOVE,
            kind => {
                let base: [u16; 2] = match pointer.button {
                    1 => [WM_MBUTTONDOWN, WM_MBUTTONUP],
                    2 => [WM_RBUTTONDOWN, WM_RBUTTONUP],
                    _ => [WM_LBUTTONDOWN, WM_LBUTTONUP],
                };

                if kind == PointerKind::Up {
                    base[1]
                } else {
                    base[0]
                }
            }
        };
        let keys = [(1, MK_LBUTTON), (2, MK_RBUTTON), (4, MK_MBUTTON)]
            .iter()
            .filter(|&&(bit, _)| pointer.buttons & bit != 0)
            .fold(0, |flags, &(_, flag)| flags | flag);
        let hwnd = self.windows[target].as_ref().expect("a window").hwnd;

        self.post_mouse(
            hwnd,
            message,
            keys,
            MouseInput {
                x,
                y,
                kind: message,
                double: pointer.double && pointer.kind == PointerKind::Down,
                keys,
            },
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
        let made = self.message_now(hwnd, message, wparam, lparam);

        self.put_input(made);
    }

    /// The mouse put in as it made it, at the point on the screen, to be
    /// hit-tested as it is taken (`mouse_scan.rs`).
    fn post_mouse(&mut self, hwnd: u16, message: u16, keys: u16, mouse: MouseInput) {
        let point = u32::from(mouse.y as u16) << 16 | u32::from(mouse.x as u16);
        let mut made = self.message_now(hwnd, message, keys, point);

        made.mouse = Some(mouse);
        self.put_input(made);
    }

    /// Input put in a window's task's queue.
    fn put_input(&mut self, mut made: Message) {
        let (hwnd, message) = (made.hwnd, made.message);
        let moves = message == WM_MOUSEMOVE;

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

    /// A move over no window, the desktop window's: taken, it makes the
    /// cursor the arrow (`set-cursor.ts`; `curerr`).
    fn move_to_desktop(&mut self, x: i16, y: i16) {
        let Some(desktop) = self.handles.lookup(Object::Desktop) else {
            return;
        };
        let point = u32::from(y as u16) << 16 | u32::from(x as u16);

        // Input, as the mouse's own moves are, not a message posted: after
        // what was posted and after the quit (`quitin`), and several before
        // the queue is looked at kept as one (`nudges`).
        self.post_input(desktop, WM_MOUSEMOVE, 0, point);
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
            self.move_to_desktop(x, y);
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
