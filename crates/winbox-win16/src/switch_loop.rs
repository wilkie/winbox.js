//! Alt and Tab, Alt and Escape, Alt and F6, as winbox.js's `switch-loop.ts`
//! has them: `DefWindowProc` sends the active window `WM_SYSCOMMAND` for
//! each, and carries the command out with a loop of its own that takes the
//! keys until Alt is let go, showing the window Tab comes to in USER's
//! switch window -- its icon and title in a box in the middle of the
//! screen, or, with `CoolSwitch=0`, the window itself drawn over the others
//! -- and switching to it.
//!
//! **Read out** of `USER.EXE`: seg1 `578d`-`57cc` (the command), seg1
//! `047d` (carried out), seg23 `0932`-`0c3c` (the loop), `0c58` (the next
//! window), `052d` (the box), `039a` (its frame), `000e` (the window drawn,
//! and the switch made otherwise), seg13 `0f2b` (F6's next window), seg3
//! `198b`-`1a74` (the switch window). **Recorded** by `alttab`.

use winbox_raster::DeviceBitmap;

use crate::call::Stop;
use crate::engine::Engine;
use crate::frame::bytes_of;
use crate::messages::Param;
use crate::mouse_scan::CaptureKind;
use crate::painter::{PaintEnv, Painter};
use crate::queue::{WM_KEYDOWN, WM_KEYUP, WM_MOUSEMOVE, WM_SYSKEYDOWN, WM_SYSKEYUP};
use crate::system::System;
use crate::windows::{Placement, Window};

pub const SC_NEXTWINDOW: u16 = 0xf040;
pub const SC_PREVWINDOW: u16 = 0xf050;
const SC_RESTORE: u16 = 0xf120;
const WM_SYSCOMMAND: u16 = 0x0112;
const WM_SYSCHAR: u16 = 0x0106;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_RBUTTONDOWN: u16 = 0x0204;
const WM_RBUTTONUP: u16 = 0x0205;
const WM_MBUTTONDOWN: u16 = 0x0207;
const WM_MBUTTONUP: u16 = 0x0208;
const WM_QUERYDRAGICON: u16 = 0x0037;

/// The message filters' code for the loop (seg23 `0a56`).
pub const MSGF_NEXTWINDOW: i16 = 6;

const VK_TAB: u16 = 0x09;
const VK_SHIFT: u16 = 0x10;
const VK_MENU: u16 = 0x12;
const VK_ESCAPE: u16 = 0x1b;
const VK_F6: u16 = 0x75;

const WS_DISABLED: u32 = 0x0800_0000;
const WS_EX_TOPMOST: u32 = 0x0008;
const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOACTIVATE: u16 = 0x0010;
const HWND_TOP: u16 = 0;

const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;

const COLOR_WINDOWFRAME: usize = 6;
const COLOR_BTNFACE: usize = 15;
const COLOR_BTNSHADOW: usize = 16;
const COLOR_BTNTEXT: usize = 18;
const COLOR_BTNHIGHLIGHT: usize = 20;

/// The longest title the box shows: a buffer of 49 (seg23 `071b`).
const TITLE_LENGTH: usize = 48;

/// What the loop keeps between the windows it shows, and the changes of
/// active window counted.
#[derive(Debug, Default)]
pub struct SwitchState {
    /// The window the switch window last showed (`[1ACh]`): the active one
    /// before the first.
    pub shown: u16,
    /// Whether Tab has been pressed in this loop (`[1B0h]`).
    pub tabbing: bool,
    /// The switch window, while it is up.
    pub window: Option<usize>,
    /// Each change of active window, counted (`[112h]`).
    pub activations: u32,
}

impl System {
    /// The window at the top a window lies in (seg2 `0ab8`).
    fn top_of(&self, hwnd: u16) -> u16 {
        let Some(mut index) = self.window_named(hwnd) else {
            return 0;
        };

        while let Some(parent) = self.windows[index]
            .as_ref()
            .and_then(|window| window.parent)
        {
            index = parent;
        }

        self.hwnd_of(index)
    }

    /// The owner at the root of a window's owners (seg23 `0000`).
    fn root_owner(&self, hwnd: u16) -> u16 {
        let Some(mut index) = self.window_named(hwnd) else {
            return hwnd;
        };

        while let Some(owner) = self.windows[index].as_ref().and_then(|window| window.owner) {
            index = owner;
        }

        self.hwnd_of(index)
    }

    /// The windows at the top, front to back, shown or not, as `GetWindow`
    /// goes: by their indices.
    fn tops(&self) -> Vec<usize> {
        self.z_order
            .iter()
            .copied()
            .filter(|&index| {
                self.windows[index].as_ref().is_some_and(|window| {
                    window.parent.is_none() && window.hwnd != 0 && window.title_of.is_none()
                })
            })
            .collect()
    }

    /// The window F6 goes to from one (seg13 `0f2b`, with `0edd` and
    /// `0f07`): the windows at the top walked in the order their owners
    /// make, each window followed by those it owns -- front to back, the
    /// first it owns, else the next owned by its owner, else the next of its
    /// owner's -- or backwards with Shift, round to the first; the next
    /// shown and not disabled, that is not an icon's title. None when the
    /// walk comes back to where it started.
    fn f6_next(&self, hwnd: u16, previous: bool) -> u16 {
        let tops = self.tops();
        let owner_of = |index: Option<usize>| {
            index.and_then(|index| self.windows[index].as_ref().and_then(|window| window.owner))
        };
        // The first window owned by `owner` after `after`, front to back
        // (`0eb2`).
        let first_owned = |owner: Option<usize>, after: Option<usize>| {
            let start = after.map_or(0, |after| {
                tops.iter()
                    .position(|&one| one == after)
                    .map_or(0, |at| at + 1)
            });

            tops[start.min(tops.len())..]
                .iter()
                .copied()
                .find(|&one| owner_of(Some(one)) == owner)
        };
        // The next in the walk (`0edd`).
        let next = |window: Option<usize>| {
            let mut owner = window;
            let mut after: Option<usize> = None;

            loop {
                if let Some(found) = first_owned(owner, after) {
                    return Some(found);
                }

                if owner.is_none() {
                    return first_owned(None, None);
                }

                after = owner;
                owner = owner_of(owner);
            }
        };
        // The one before in the walk (`0f07`): the one whose next it is.
        let before = |window: Option<usize>| {
            let mut at: Option<usize> = None;

            for _ in 0..=tops.len() {
                let following = next(at);

                if following == window && at.is_some() {
                    return at;
                }

                at = following;

                at?;
            }

            None
        };
        let start = self.window_named(hwnd);
        let mut at = start;

        for _ in 0..=tops.len() {
            at = if start.is_some() {
                if previous { before(at) } else { next(at) }
            } else {
                next(None)
            };

            let Some(index) = at else {
                return 0;
            };

            if at == start {
                return 0;
            }

            let window = self.windows[index].as_ref().expect("a window");

            if window.visible && window.style & WS_DISABLED == 0 {
                return window.hwnd;
            }
        }

        0
    }

    /// The task a window's queue is.
    fn task_of_window(&self, hwnd: u16) -> u16 {
        self.window_named(hwnd)
            .and_then(|index| self.windows[index].as_ref())
            .map_or(0, |window| window.task)
    }

    /// The switch window put up over every window, where asked, keeping the
    /// screen under it: a pop-up of class `8003h`, made disabled (seg3
    /// `1a3a`-`1a74`), its class `CS_SAVEBITS` and its procedure erasing
    /// nothing (seg1 `62d6`). USER makes the mouse move where it is as it is
    /// shown (`alttab`).
    fn open_switch(&mut self, place: [i32; 4]) -> Result<usize, Stop> {
        let [left, top, width, height] = place;
        let (width, height) = (width.max(0), height.max(0));
        let screen = self.screen_bitmap();
        let mut bits = vec![0u8; (width * height) as usize];

        for row in 0..height {
            for column in 0..width {
                bits[(row * width + column) as usize] =
                    screen.index_at(left + column, top + row).unwrap_or(0);
            }
        }

        let index = self.windows.len();

        self.windows.push(Some(Window {
            left,
            top,
            width,
            height,
            style: 0x8800_0000,
            visible: true,
            topmost: true,
            switch_bits: Some(bits),
            ..Window::default()
        }));
        self.z_order.insert(0, index);
        self.own();
        self.switch.window = Some(index);
        self.nudge()?;
        Ok(index)
    }

    /// The switch window taken off the screen, if it is up: what it covered
    /// put back, as a pop-up menu's is.
    fn close_switch(&mut self) -> Result<(), Stop> {
        if let Some(index) = self.switch.window.take() {
            self.close_popup(index);
            self.nudge()?;
        }

        Ok(())
    }

    /// Each pixel of a window's rectangle on the screen that something else
    /// shows at: the window's rectangle, on the screen, less where it shows
    /// -- it or what lies in it (seg23 `0187`-`01e1`).
    fn covered(&self, index: usize) -> Vec<(i32, i32)> {
        let width = i32::from(self.display.width);
        let height = i32::from(self.display.height);
        let window = self.windows[index].as_ref().expect("a window");
        let (x0, y0) = (window.left.max(0), window.top.max(0));
        let x1 = (window.left + window.width).min(width);
        let y1 = (window.top + window.height).min(height);
        let mut out = Vec::new();

        for sy in y0..y1 {
            for sx in x0..x1 {
                let owner = usize::from(self.owners[(sy * width + sx) as usize]);
                let shows = owner != 0
                    && self.windows.get(owner - 1).is_some_and(Option::is_some)
                    && self.within(owner - 1, index);

                if !shows {
                    out.push((sx, sy));
                }
            }
        }

        out
    }
}

impl System {
    /// The box drawn at `place` on the screen (`052d`, `039a`): its frame,
    /// the first time; the rectangle within filled; the title in it. Answers
    /// the icon's part's width and the rectangle, within the box.
    fn draw_box(
        &mut self,
        place: [i32; 4],
        first: bool,
        title: &str,
        base_y: i32,
    ) -> (i32, [i32; 4]) {
        let [left, top, width, height] = place;
        let border = (self.metric(SM_CXBORDER), self.metric(SM_CYBORDER));
        let icon_width = self.metric(SM_CXICON);
        let screen = self.screen_bitmap();
        let text = [
            9 * border.0,
            9 * border.1,
            width - 9 * border.0,
            height - 9 * border.1,
        ];

        {
            let env = PaintEnv::new(self);
            let painter = Painter::new(screen, left, top, width, height, &env);

            // The frame, the first time (`039a`): a pixel of the frame's
            // colour, the face within, and three borders in a sunken edge.
            if first {
                let (dx, dy) = (3 * border.0, 3 * border.1);
                let frame = painter.colour(COLOR_WINDOWFRAME);
                let inner = [border.0, border.1, width - border.0, height - border.1];

                painter.fill(0, 0, width, border.1, frame);
                painter.fill(0, border.1, border.0, height - border.1, frame);
                painter.fill(0, height - border.1, width, height, frame);
                painter.fill(width - border.0, border.1, width, height - border.1, frame);
                painter.fill(
                    inner[0],
                    inner[1],
                    inner[2],
                    inner[3],
                    painter.colour(COLOR_BTNFACE),
                );

                let shadow = painter.colour(COLOR_BTNSHADOW);
                let light = painter.colour(COLOR_BTNHIGHLIGHT);

                painter.fill(
                    inner[0] + dx,
                    inner[1] + dy,
                    inner[2] - dx,
                    inner[1] + dy + border.1,
                    shadow,
                );
                painter.fill(
                    inner[0] + dx,
                    inner[1] + dy,
                    inner[0] + dx + border.0,
                    inner[3] - dy,
                    shadow,
                );
                painter.fill(
                    inner[0] + dx,
                    inner[3] - dy - border.1,
                    inner[2] - dx,
                    inner[3] - dy,
                    light,
                );
                painter.fill(
                    inner[2] - dx - border.0,
                    inner[1] + dy,
                    inner[2] - dx,
                    inner[3] - dy,
                    light,
                );
            }

            // `ExtTextOut` with `ETO_OPAQUE` and `ETO_CLIPPED` in the
            // rectangle.
            painter.fill(
                text[0],
                text[1],
                text[2],
                text[3],
                painter.colour(COLOR_BTNFACE),
            );
        }

        let icon_part = ((text[2] - text[0]) / 4).max(2 * border.0 + icon_width);

        if let Some(letters) = self.system_lettering() {
            let line = bytes_of(title);
            let extent = letters.measure(&line);
            let x = (icon_part + text[0]).max((text[2] - text[0] - extent) / 2 + text[0]);
            let y = (height - base_y) / 2;
            let inside = self.on_screen(
                left + text[0],
                top + text[1],
                text[2] - text[0],
                text[3] - text[1],
            );
            let ink = self.sys_color(COLOR_BTNTEXT);

            letters.text(self, &inside, &line, ink, x - text[0], y - text[1]);
        }

        (icon_part, text)
    }
}

impl Engine {
    /// Alt with Tab, Escape or F6, as `DefWindowProc` takes a system key
    /// with Alt down (seg1 `578d`, `57a7`-`57cc`): `WM_SYSCOMMAND` sent to
    /// the active window, with the key in `lParam` -- `SC_NEXTWINDOW` with
    /// Shift held, `SC_PREVWINDOW` without, as the code has them, the other
    /// way about from their names (`alttab`).
    pub(crate) async fn next_window_key(&self, key: u16) -> Result<(), Stop> {
        if !matches!(key, VK_TAB | VK_ESCAPE | VK_F6) {
            return Ok(());
        }

        let (active, command) = {
            let system = self.system();
            let shift = system.user_state.key_states[usize::from(VK_SHIFT)] & 0x80 != 0;

            (
                system.active_hwnd(),
                if shift { SC_NEXTWINDOW } else { SC_PREVWINDOW },
            )
        };

        self.send_message(
            active,
            WM_SYSCOMMAND,
            command,
            &mut Param::Value(u32::from(key)),
        )
        .await?;
        Ok(())
    }

    /// `SC_NEXTWINDOW` and `SC_PREVWINDOW`, as `DefWindowProc` carries them
    /// out (seg1 `047d`): the loop, with the key in `lParam`'s low word,
    /// whichever the command. Not while a window is system-modal
    /// (`038c`-`03a5`, its table at `03aa`; `alttab`).
    pub(crate) async fn next_window_command(&self, lparam: u32) -> Result<(), Stop> {
        if self.system().sys_modal != 0 {
            return Ok(());
        }

        self.switch_loop(lparam as u16).await
    }

    fn shift_held(&self) -> bool {
        self.system().user_state.key_states[usize::from(VK_SHIFT)] & 0x80 != 0
    }

    /// The loop (seg23 `0932`), with the key that started it, as
    /// `switch-loop.ts` describes it.
    #[allow(clippy::too_many_lines)]
    async fn switch_loop(&self, start_key: u16) -> Result<(), Stop> {
        let (active, activations, queue) = {
            let mut system = self.system();
            let active = system.active_hwnd();
            let activations = system.switch.activations;
            let queue = system.task_of_window(active);

            // The mouse captured to the active window, USER's own way (seg1
            // `28cd` with 4): its messages at the point on the screen.
            if let Some(index) = system.window_named(active) {
                system.capture = Some(index);
                system.capture_kind = CaptureKind::Switch;
            }

            (active, activations, queue)
        };
        let mut escape_found = false;
        let mut key = start_key & 0xff;
        let mut from = active;
        let mut mode: Option<u16> = None;
        let mut cancelled = false;

        let mut current = self
            .switch_start(key, from, queue, &mut escape_found)
            .await?;

        while mode.is_none() && !cancelled {
            let Some(ahead) = self.peek_message_from(true).await? else {
                cancelled = true;
                break;
            };

            if self.system().switch.activations != activations {
                cancelled = true;
                break;
            }

            if self.message_filter(&ahead, MSGF_NEXTWINDOW).await? {
                continue;
            }

            let message = ahead.message;
            let wparam = ahead.wparam;
            let tabbing = self.system().switch.tabbing;

            // Any other key with Alt, after Tab: cancelled, the key left
            // (`0a61`).
            if message == WM_SYSKEYDOWN
                && tabbing
                && !matches!(wparam, VK_TAB | VK_ESCAPE | VK_SHIFT)
            {
                cancelled = true;
                break;
            }

            match message {
                WM_KEYDOWN | WM_KEYUP | WM_SYSKEYUP | WM_SYSCHAR | WM_MOUSEMOVE => {
                    self.take_message_from(false, None).await?;

                    if !matches!(message, WM_KEYUP | WM_SYSKEYUP) {
                        continue;
                    }

                    key = wparam;

                    if key == VK_MENU {
                        if tabbing {
                            mode = Some(0);
                        }
                    } else if key == VK_ESCAPE || key == VK_F6 {
                        if tabbing {
                            cancelled = true;
                        } else {
                            mode = Some(if key == VK_ESCAPE { 1 } else { 2 });
                        }
                    }
                }
                WM_SYSKEYDOWN => {
                    key = wparam;

                    if matches!(key, VK_F6 | VK_TAB | VK_SHIFT | VK_ESCAPE) {
                        self.take_message_from(false, None).await?;

                        if key == VK_TAB {
                            from = current;
                            current = self
                                .switch_start(key, from, queue, &mut escape_found)
                                .await?;
                        }

                        continue;
                    }

                    self.system().switch.tabbing = false;
                    mode = Some(u16::from(escape_found));
                }
                WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN
                | WM_MBUTTONUP => {
                    mode = Some(0);
                }
                _ => {
                    if let Some(taken) = self.take_message_from(false, None).await? {
                        self.system().translate(&taken);
                        self.dispatch(&taken).await?;
                    }
                }
            }
        }

        // Cancelled: the active window shown, and switched to (`0b46`).
        if cancelled {
            current = self.system().active_hwnd();
            self.show_switch(current, true, 0, false).await?;
            mode = Some(0);
        }

        let mode = mode.unwrap_or(0);

        // Out of it (`0b54`-`0c33`): the mouse let go of, which makes it
        // move where it is, as `ReleaseCapture` does (seg1 `28bd`, `28d0`).
        let was_tabbing = {
            let mut system = self.system();
            let had = system.capture.take();

            system.capture_kind = CaptureKind::Set;

            if had.is_some() {
                system.nudge()?;
            }

            std::mem::take(&mut system.switch.tabbing)
        };
        let shift = self.shift_held();

        self.show_switch(current, false, mode, shift).await?;

        // A window minimized that Tab switched to is restored.
        let mut system = self.system();
        let now = system.active_hwnd();
        let minimized = system
            .window_named(now)
            .and_then(|index| system.windows[index].as_ref())
            .is_some_and(|window| window.placement == Placement::Minimized);

        if minimized && mode == 0 && was_tabbing {
            system.post_message(now, WM_SYSCOMMAND, SC_RESTORE, 0);
        }

        Ok(())
    }

    /// Where the loop starts from, for the key (`0973`-`0a25`): Escape's
    /// window, the next `0c58` finds leaving out windows topmost, or the
    /// one before with Shift; F6's, the next of its walk that is the active
    /// window's task's; Tab's, the next `0c58` finds from the window it came
    /// to, shown in the switch window.
    async fn switch_start(
        &self,
        key: u16,
        from: u16,
        queue: u16,
        escape_found: &mut bool,
    ) -> Result<u16, Stop> {
        let shift = self.shift_held();

        if key == VK_ESCAPE {
            let next = {
                let system = self.system();

                system.next_switchable(system.top_of(from), shift, true)
            };

            if next != 0 {
                *escape_found = true;
                return Ok(next);
            }

            return Ok(from);
        }

        let mut current = from;

        if key == VK_F6 {
            let system = self.system();

            for _ in 0..256 {
                let next = system.f6_next(current, shift);

                if next == 0 {
                    break;
                }

                current = next;

                if system.task_of_window(current) == queue {
                    break;
                }
            }

            return Ok(current);
        }

        self.system().switch.tabbing = true;

        let next = {
            let system = self.system();

            system.next_switchable(system.top_of(current), shift, false)
        };

        if next != 0 && next != current {
            self.show_switch(next, true, 0, false).await?;
            current = next;
        }

        Ok(current)
    }

    /// The window Tab came to, shown or switched to (seg23 `052d`): with
    /// `CoolSwitch` on and `mode` nought, in the box; otherwise as `000e`
    /// does. `show`: shown; else switched to -- `mode` 1 by Escape, 2 by F6,
    /// 0 otherwise.
    async fn show_switch(&self, hwnd: u16, show: bool, mode: u16, shift: bool) -> Result<(), Stop> {
        let fast = self.system().parameters().fast_task_switch;

        if fast == 0 || mode != 0 {
            return self.show_window_itself(hwnd, show, mode, shift).await;
        }

        if show {
            return self.show_box(hwnd).await;
        }

        // The switch: the box taken away, and the window brought to the top
        // and made active (`0868`-`0915`).
        self.system().close_switch()?;
        self.bring_to_top(hwnd).await?;
        self.system().switch.shown = 0;
        Ok(())
    }

    async fn bring_to_top(&self, hwnd: u16) -> Result<(), Stop> {
        let Some(index) = self.system().window_named(hwnd) else {
            return Ok(());
        };

        self.position_raster(hwnd, index, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE)
            .await
    }

    /// The box (seg23 `060e`-`0865`), as `switch-loop.ts`'s `showBox`
    /// draws it.
    #[allow(clippy::too_many_lines)]
    async fn show_box(&self, hwnd: u16) -> Result<(), Stop> {
        let (left, top, width, height, base_y, first) = {
            let mut system = self.system();
            let first = system.switch.shown == 0;

            if first {
                system.switch.shown = system.active_hwnd();
            }

            let (base_x, base_y) = system.system_base_units()?;
            let cy_border = system.metric(SM_CYBORDER);
            let width = base_x * 50;
            let height = (cy_border * 8 + system.metric(SM_CYICON)).max(base_y * 5);
            let screen = system.screen_bitmap();
            let left = (screen.width() - width) / 2;
            let top = (screen.height() - height) / 2;

            // Put up only while Alt is down, as `GetAsyncKeyState` has it,
            // which asking clears of its having gone down.
            let alt = usize::from(VK_MENU);
            let down = system.user_state.async_keys[alt] & 0x80 != 0;

            system.user_state.async_keys[alt] &= !0x01;

            if !down {
                system.switch.shown = hwnd;
                return Ok(());
            }

            if system.switch.window.is_none() {
                system.open_switch([left, top, width, height])?;
            }

            (left, top, width, height, base_y, first)
        };

        let (root, title, class_icon) = {
            let system = self.system();
            let root = system.root_owner(hwnd);
            let window = system
                .window_named(root)
                .and_then(|index| system.windows[index].as_ref());
            let title: String = window
                .map(|window| window.title.chars().take(TITLE_LENGTH).collect())
                .unwrap_or_default();
            let class_icon = window
                .and_then(|window| system.class_named(&window.class))
                .map_or(0, |class| system.classes[class].icon);

            (root, title, class_icon)
        };

        let (icon_part, text) =
            self.system()
                .draw_box([left, top, width, height], first, &title, base_y);

        // The icon (`07f7`-`083a`): the root owner's class's, or what
        // `WM_QUERYDRAGICON` answers, or the Windows flag.
        let mut handle = class_icon;

        if handle == 0 && root != 0 {
            handle = self
                .send_message(root, WM_QUERYDRAGICON, 0, &mut Param::Value(0))
                .await? as u16;
        }

        let mut system = self.system();
        let icon = system.minimized_icon_of(handle).or_else(|| {
            system
                .driver
                .as_ref()
                .and_then(|driver| driver.application_icon.clone())
        });
        let icon_size = (system.metric(SM_CXICON), system.metric(SM_CYICON));
        let screen = system.screen_bitmap();

        if let Some(icon) = icon {
            let at = (
                left + ((icon_part - icon_size.0) >> 1) + text[0],
                top + ((text[3] - text[1] - icon_size.1) >> 1) + text[1],
            );
            let view: DeviceBitmap = system.on_screen(0, 0, screen.width(), screen.height());

            crate::desktop_paint::draw_icon_at(&view, at.0, at.1, &icon);
        }

        screen
            .context
            .mark_rect(left, top, left + width, top + height);
        system.switch.shown = hwnd;
        Ok(())
    }

    /// `CoolSwitch` off, or a switch by Escape or F6 (seg23 `000e`), as
    /// `switch-loop.ts`'s `showWindowItself` has it.
    #[allow(clippy::too_many_lines)]
    async fn show_window_itself(
        &self,
        hwnd: u16,
        show: bool,
        mode: u16,
        shift: bool,
    ) -> Result<(), Stop> {
        if mode != 0 {
            let (active, last) = {
                let system = self.system();
                let active = system.active_hwnd();
                let root = system.root_owner(active);
                let tops = system.tops();
                let topmost = system
                    .window_named(root)
                    .and_then(|index| system.windows[index].as_ref())
                    .is_some_and(|window| window.ex_style & WS_EX_TOPMOST != 0);
                let last = if topmost {
                    // The last of the topmost windows at the front (seg7
                    // `02c9`).
                    tops.iter()
                        .copied()
                        .take_while(|&one| {
                            system.windows[one]
                                .as_ref()
                                .is_some_and(|window| window.ex_style & WS_EX_TOPMOST != 0)
                        })
                        .last()
                        .map_or(0, |one| system.hwnd_of(one))
                } else {
                    tops.last().map_or(0, |&one| system.hwnd_of(one))
                };

                // Before its root owner, where that is the last.
                let after = if root == last {
                    match tops.iter().position(|&one| system.hwnd_of(one) == last) {
                        Some(at) if at > 0 => system.hwnd_of(tops[at - 1]),
                        _ => 0,
                    }
                } else {
                    last
                };

                (
                    active,
                    (!shift && mode == 1 && active != 0 && last != hwnd).then_some(after),
                )
            };

            // One set of moves: every window asked, then each told
            // (`alttab`).
            let mut moves = Vec::new();
            let index = self.system().window_named(hwnd);

            if let Some(index) = index
                && let Some(change) = self
                    .position_changing(hwnd, index, HWND_TOP, [0; 4], SWP_NOSIZE | SWP_NOMOVE)
                    .await?
            {
                moves.push(change);
            }

            let was = self.system().window_named(active);

            if let Some(last) = last
                && let Some(index) = was
                && let Some(change) = self
                    .position_changing(
                        active,
                        index,
                        last,
                        [0; 4],
                        SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
                    )
                    .await?
            {
                moves.push(change);
            }

            if !moves.is_empty() {
                self.position_changed(moves).await?;
            }

            return Ok(());
        }

        if !show {
            self.bring_to_top(hwnd).await?;

            let mut system = self.system();

            system.close_switch()?;
            system.switch.shown = 0;
            return Ok(());
        }

        let mut system = self.system();

        system.close_switch()?;

        if system.switch.shown == 0 {
            system.switch.shown = system.active_hwnd();
        }

        // The one shown before, drawn as not active.
        if let Some(before) = system.window_named(system.switch.shown)
            && system.showing(before)
        {
            let (minimized, title) = {
                let window = system.windows[before].as_ref().expect("a window");

                (window.placement == Placement::Minimized, window.icon_title)
            };

            if minimized {
                if let Some(title) = title {
                    system.paint_icon_title_as(title, false, false);
                }
            } else {
                system.paint_frame_as(before, false, false);
            }
        }

        let Some(index) = system.window_named(hwnd) else {
            system.switch.shown = hwnd;
            return Ok(());
        };
        let drawn = {
            let window = system.windows[index].as_ref().expect("a window");

            match window.icon_title {
                Some(title) if window.placement == Placement::Minimized => title,
                _ => index,
            }
        };
        let covered = system.covered(drawn);
        let place = covered
            .iter()
            .fold(None, |place: Option<[i32; 4]>, &(x, y)| {
                Some(place.map_or([x, y, x + 1, y + 1], |[l, t, r, b]| {
                    [l.min(x), t.min(y), r.max(x + 1), b.max(y + 1)]
                }))
            });
        let place = place.map_or([0; 4], |[l, t, r, b]| [l, t, r - l, b - t]);

        system.open_switch(place)?;

        if drawn == index {
            // Where others cover it, its class's brush, aligned with the
            // switch window (seg23 `024a`-`027a`).
            let handle = {
                let window = system.windows[index].as_ref().expect("a window");

                system
                    .class_named(&window.class)
                    .map_or(0, |class| system.classes[class].background)
            };

            if let Some(brush) = system.background_of(handle).filter(|brush| !brush.hollow) {
                let screen = system.screen_bitmap();

                for &(x, y) in &covered {
                    crate::desktop_paint::fill_brush(
                        &system,
                        &screen,
                        x,
                        y,
                        1,
                        1,
                        brush.colorref,
                        (-place[0], -place[1]),
                        brush.pattern.as_ref(),
                    );
                }
            }

            system.paint_frame_as(index, true, true);
        } else {
            system.paint_icon_title_as(drawn, true, true);
        }

        system.switch.shown = hwnd;
        Ok(())
    }
}
