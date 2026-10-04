//! A button's own messages, as USER's button window procedure takes them
//! (`USER.EXE` seg25 `1a12`, the `BUTTON` class's procedure): the mouse --
//! the press, the pointer moved while it is held, the release, the double
//! click -- the Space bar, the focus gained and lost, being enabled or
//! disabled, the check, and the button's pushed state, which `BM_SETSTATE`
//! sets and `BM_GETSTATE` reads beside the check and the focus.
//!
//! **Read out** of `USER.EXE`, and **recorded** by `btnclick` and
//! `btnkeys`: each kind of button -- push, default push, check box,
//! automatic check box, radio, automatic radio, three-state and automatic
//! three-state -- sent the mouse's messages at points of its client area,
//! and the keyboard's, with its state, the capture, the focus and its
//! parent's messages after each; `BM_SETCHECK` with each value on every
//! kind; a radio button given the focus; and an owner-drawn button pushed
//! and let out.
//!
//! The procedure's dispatch (seg25 `1a2a`-`1add`): `WM_SETFOCUS` at
//! `1ae0`, `WM_KILLFOCUS` `1b2c`, `WM_ENABLE` `1bc9`, `WM_PAINT` `1bdf`,
//! `WM_KEYDOWN` `1f5d`, `WM_KEYUP` and `WM_SYSKEYUP` `1d1f`, `WM_CHAR`
//! `1d57`, the mouse's at `1dae`-`1df7`, `BM_GETCHECK` `1e12`,
//! `BM_SETCHECK` `1e1b`, `BM_GETSTATE` `1e9b`, `BM_SETSTATE` `1ea3`; the
//! rest to `DefWindowProc` (`1f87`).
//!
//! The button keeps a byte of state, its check in the low two bits
//! (seg25 `1e9b`, which answers it whole to `BM_GETSTATE`):
//!
//! * `04h`, pushed: drawn pressed in.
//! * `08h`, the focus.
//! * `10h`, the focus being taken by the button's own press, of the mouse
//!   or the Space bar, for the moment `SetFocus` takes (seg25
//!   `11c6`-`11d3`): a radio button gaining the focus so does not tell its
//!   parent it was clicked.
//! * `20h`, the mouse captured by the button.
//! * `40h`, the left button held down on it: the press is being followed.
//!
//! The check is kept here apart from the byte, and the focus is asked of
//! the system.
//!
//! Each time the button draws itself outside `WM_PAINT` -- pushed or let
//! out, checked, gaining or losing the focus, enabled or disabled -- it
//! takes a device context of its own, if it shows, and asks its parent's
//! colours with `WM_CTLCOLOR` (seg25 `103a`, `0fc4`): whatever its kind,
//! an owner-drawn one too, before its `WM_DRAWITEM`; and its `WM_PAINT`
//! asks them once (seg25 `1c0d`). `btnkeys` recorded each `CTLCOLOR_BTN`
//! in its order among the notifications.

use crate::call::Stop;
use crate::controls::ControlState;
use crate::engine::Engine;
use crate::messages::Param;

const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_ENABLE: u16 = 0x000a;
const WM_GETDLGCODE: u16 = 0x0087;
const WM_KEYDOWN: u16 = 0x0100;
const WM_KEYUP: u16 = 0x0101;
const WM_CHAR: u16 = 0x0102;
const WM_SYSKEYUP: u16 = 0x0105;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const BM_GETCHECK: u16 = 0x0400;
const BM_SETCHECK: u16 = 0x0401;
pub const BM_GETSTATE: u16 = 0x0402;
pub const BM_SETSTATE: u16 = 0x0403;

const BN_CLICKED: u16 = 0;
const BN_HILITE: u16 = 2;
const BN_UNHILITE: u16 = 3;
const BN_DOUBLECLICKED: u16 = 5;

const VK_TAB: u16 = 0x09;
const VK_SPACE: u16 = 0x20;

const DLGC_RADIOBUTTON: u32 = 0x0040;

const BS_CHECKBOX: u32 = 0x02;
const BS_AUTOCHECKBOX: u32 = 0x03;
const BS_RADIOBUTTON: u32 = 0x04;
const BS_3STATE: u32 = 0x05;
const BS_AUTO3STATE: u32 = 0x06;
const BS_USERBUTTON: u32 = 0x08;
const BS_AUTORADIOBUTTON: u32 = 0x09;
const BS_OWNERDRAW: u32 = 0x0b;

const WS_TABSTOP: u32 = 0x0001_0000;

const ODA_DRAWENTIRE: u16 = 1;
const ODA_SELECT: u16 = 2;
const ODA_FOCUS: u16 = 4;

/// Pushed: drawn pressed in.
pub const PUSHED: u8 = 0x04;
/// The focus, as `BM_GETSTATE` answers it.
const FOCUS: u8 = 0x08;
/// The focus being taken by the button's own press.
const OWN_PRESS: u8 = 0x10;
/// The mouse captured by the button.
const CAPTURED: u8 = 0x20;
/// The left button held down on it, the press followed.
const TRACKING: u8 = 0x40;

impl ControlState {
    /// The button's kind, from the low bits of its style.
    fn button_kind(&self) -> u32 {
        self.style & 0x0f
    }
}

impl Engine {
    /// A button's own answer to a message of the mouse's or the keyboard's,
    /// to its focus gained or lost, to being enabled, and to the messages
    /// of its check and its pushed state; none for a message it leaves to
    /// the rest of its procedure.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn button_message(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        value: u32,
    ) -> Result<Option<u32>, Stop> {
        let state = self.system().control_at(index).state;
        let kind = self.system().control_at(index).button_kind();

        match message {
            // A move counts only while the press is followed; otherwise it
            // is answered at once (seg25 `1dae`).
            WM_MOUSEMOVE if state & TRACKING == 0 => {}
            WM_LBUTTONDOWN | WM_MOUSEMOVE => self.button_press(hwnd, index, value).await?,
            // Released: only a press followed is let go (seg25 `1de8`).
            WM_LBUTTONUP => {
                if state & TRACKING != 0 {
                    self.button_release(hwnd, index, true).await?;
                }
            }
            // A radio button, a user button and an owner-drawn one tell
            // their parent of the double click; any other takes it as
            // another press (seg25 `1df7`). A radio button's is recorded:
            // `BN_DOUBLECLICKED`, and neither the capture nor a push.
            WM_LBUTTONDBLCLK => {
                if matches!(kind, BS_RADIOBUTTON | BS_USERBUTTON | BS_OWNERDRAW) {
                    self.notify_parent(index, BN_DOUBLECLICKED).await?;
                } else {
                    self.button_press(hwnd, index, value).await?;
                }
            }
            // A key pressed, while the mouse's press is not followed
            // (seg25 `1f5d`): the Space bar takes the capture and the focus
            // as a press does, but follows nothing, and pushes the button
            // with `BM_SETSTATE` -- again as the key repeats, each time
            // asking the parent's colours; any other key lets the button
            // go without a click, as Return does with the Space bar held
            // (`btnkeys`, `space-then-return`). A disabled button is
            // pushed and clicked all the same.
            WM_KEYDOWN => {
                if state & TRACKING == 0 {
                    if wparam == VK_SPACE {
                        self.button_capture(hwnd, index, 0).await?;
                        self.send_message(hwnd, BM_SETSTATE, 1, &mut Param::Value(0))
                            .await?;
                    } else {
                        self.button_release(hwnd, index, false).await?;
                    }
                }
            }
            // A key let go (seg25 `1d1f`): left to `DefWindowProc` while
            // the mouse's press is followed, and for Tab; otherwise the
            // button let go, and clicked if it was the Space bar and the
            // button was still pushed -- so the Space bar let go after
            // Return clicks nothing. A system key goes on to
            // `DefWindowProc` after, if the button is still there.
            WM_KEYUP | WM_SYSKEYUP => {
                if state & TRACKING != 0 || wparam == VK_TAB {
                    return Ok(None);
                }

                self.button_release(hwnd, index, wparam == VK_SPACE).await?;

                if message == WM_SYSKEYUP && self.system().window_named(hwnd) == Some(index) {
                    return Ok(None);
                }
            }
            // A character (seg25 `1d57`): a check box, plain or automatic,
            // is checked by `+` or `=` and cleared by `-`, its capture
            // taken and let go around it; any other character, and any
            // other kind, goes to `DefWindowProc`, as does one while the
            // mouse's press is followed. Read out only: `btnkeys` sends
            // only the Space bar's character, which every kind leaves.
            WM_CHAR => {
                let check = match wparam {
                    0x2b | 0x3d => 1,
                    0x2d => 0,
                    _ => return Ok(None),
                };

                if state & TRACKING != 0 || !matches!(kind, BS_CHECKBOX | BS_AUTOCHECKBOX) {
                    return Ok(None);
                }

                self.button_capture(hwnd, index, 0).await?;
                self.send_message(hwnd, BM_SETCHECK, check, &mut Param::Value(0))
                    .await?;
                self.button_release(hwnd, index, true).await?;
            }
            WM_SETFOCUS => self.button_focused(hwnd, index, kind).await?,
            WM_KILLFOCUS => self.button_unfocused(hwnd, index, state, kind).await?,
            // Enabled or disabled: drawn again at once, whole (seg25
            // `1bc9`, `1835`), not left to `WM_PAINT`.
            WM_ENABLE => {
                if self.button_colours(hwnd, index).await? {
                    if kind == BS_OWNERDRAW {
                        self.draw_button_item(index, ODA_DRAWENTIRE, None).await?;
                    } else {
                        self.draw_button_now(index, false);
                    }
                }
            }
            // The check, in the low bits of the state (seg25 `1e12`).
            BM_GETCHECK => {
                return Ok(Some(u32::from(self.system().control_at(index).checked & 3)));
            }
            BM_SETCHECK => self.set_button_check(hwnd, index, kind, wparam).await?,
            // The state byte whole, the check in its low bits (seg25
            // `1e9b`).
            BM_GETSTATE => {
                let system = self.system();
                let focus = if system.focus == Some(index) {
                    FOCUS
                } else {
                    0
                };
                let control = system.control_window(index).control.as_ref();
                let checked = control.map_or(0, |control| (control.checked & 3) as u8);

                return Ok(Some(u32::from(checked | state | focus)));
            }
            BM_SETSTATE => self.set_button_state(hwnd, index, wparam != 0).await?,
            _ => return Ok(None),
        }

        Ok(Some(0))
    }

    /// The focus gained (seg25 `1ae0`): drawn with it at once -- an
    /// owner-drawn button by its owner with `ODA_FOCUS` -- and then a radio
    /// button, plain or automatic, that is not checked tells its parent
    /// `BN_CLICKED`, unless the focus came by its own press (seg25 `1b00`).
    /// It is not checked by it: an automatic one stays clear (`btnkeys`,
    /// `radiofocus`). USER also passes over a button marked by the dialog
    /// manager's arrow keys (state `80h`, seg25 `0dcc`), which is not
    /// followed here. Not handed on to `DefWindowProc`.
    async fn button_focused(&self, hwnd: u16, index: usize, kind: u32) -> Result<(), Stop> {
        if self.button_colours(hwnd, index).await? {
            if kind == BS_OWNERDRAW {
                self.draw_button_item(index, ODA_FOCUS, Some(true)).await?;
            } else {
                self.draw_button_now(index, false);
            }
        }

        let (state, checked) = {
            let mut system = self.system();
            let control = system.control_at(index);

            (control.state, control.checked)
        };

        if state & OWN_PRESS == 0
            && matches!(kind, BS_RADIOBUTTON | BS_AUTORADIOBUTTON)
            && checked == 0
        {
            self.notify_parent(index, BN_CLICKED).await?;
        }

        Ok(())
    }

    /// The focus lost (seg25 `1b2c`): a press being followed is let out,
    /// and the button let go as its release lets it go -- a button still
    /// pushed, by the Space bar or a program's `BM_SETSTATE`, clicked
    /// (`btnkeys`, `space-then-focus-away`). Then, if the button is still
    /// there, it is drawn at once without the focus -- an owner-drawn one
    /// by its owner with `ODA_FOCUS` -- and its whole client area made to
    /// be painted again, without erasing: its `WM_PAINT` asks its parent's
    /// colours once more. Not handed on to `DefWindowProc`.
    async fn button_unfocused(
        &self,
        hwnd: u16,
        index: usize,
        state: u8,
        kind: u32,
    ) -> Result<(), Stop> {
        if state & TRACKING != 0 {
            self.send_message(hwnd, BM_SETSTATE, 0, &mut Param::Value(0))
                .await?;
        }

        self.button_release(hwnd, index, true).await?;

        if self.system().window_named(hwnd) != Some(index) {
            return Ok(());
        }

        if self.button_colours(hwnd, index).await? {
            if kind == BS_OWNERDRAW {
                self.draw_button_item(index, ODA_FOCUS, Some(false)).await?;
            } else {
                self.draw_button_now(index, true);
            }
        }

        if let Some(window) = self.system().windows[index].as_mut() {
            window.needs_paint = true;
        }

        Ok(())
    }

    /// A press, or a move while it is held (seg25 `1db4`): the press
    /// followed, the capture and the focus taken, then the button pushed
    /// if the point is inside its client area and let out if not, by
    /// `BM_SETSTATE` sent to itself.
    async fn button_press(&self, hwnd: u16, index: usize, value: u32) -> Result<(), Stop> {
        self.button_capture(hwnd, index, TRACKING).await?;

        let (width, height) = {
            let system = self.system();
            let window = system.control_window(index);

            (window.client_width(), window.client_height())
        };
        let x = i32::from(value as u16 as i16);
        let y = i32::from((value >> 16) as u16 as i16);
        let inside = (0..width).contains(&x) && (0..height).contains(&y);

        self.send_message(hwnd, BM_SETSTATE, u16::from(inside), &mut Param::Value(0))
            .await?;
        Ok(())
    }

    /// The mouse captured and the focus taken, for a press of the mouse or
    /// the Space bar (seg25 `11ac`): `bits` set; then, if the button has
    /// not the capture already, `SetCapture`, and `SetFocus` with the
    /// state's `10h` set around it -- which a disabled button is refused
    /// (`btnclick`), though it keeps the capture.
    async fn button_capture(&self, hwnd: u16, index: usize, bits: u8) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let control = system.control_at(index);

            control.state |= bits;

            if control.state & CAPTURED != 0 {
                return Ok(());
            }

            control.state |= CAPTURED | OWN_PRESS;

            if system.raster() {
                system.capture = Some(index);
            }
        }

        self.set_focus(hwnd).await?;

        let mut system = self.system();

        if system.window_named(hwnd) == Some(index) {
            system.control_at(index).state &= !OWN_PRESS;
        }

        Ok(())
    }

    /// A button let go (seg25 `1255`). If it is pushed, it is let out with
    /// `BM_SETSTATE`, and -- where `click` -- an automatic button's check
    /// changes: an automatic check box's toggles, an automatic three-state
    /// box's steps from unchecked to checked to grayed and round again,
    /// and an automatic radio button is checked and every other radio
    /// button of its group cleared. Then the capture is let go, if the
    /// button has it, and the parent is told `BN_CLICKED`, if it was
    /// pushed and `click`.
    async fn button_release(&self, hwnd: u16, index: usize, click: bool) -> Result<(), Stop> {
        let (pushed, kind, checked) = {
            let mut system = self.system();
            let control = system.control_at(index);

            (
                control.state & PUSHED != 0,
                control.button_kind(),
                control.checked & 3,
            )
        };
        let clicked = pushed && click;

        if pushed {
            self.send_message(hwnd, BM_SETSTATE, 0, &mut Param::Value(0))
                .await?;
        }

        if clicked {
            match kind {
                BS_AUTOCHECKBOX | BS_AUTO3STATE => {
                    let limit = if kind == BS_AUTO3STATE { 2 } else { 1 };
                    let next = if checked + 1 > limit { 0 } else { checked + 1 };

                    self.send_message(hwnd, BM_SETCHECK, next, &mut Param::Value(0))
                        .await?;
                }
                BS_AUTORADIOBUTTON => self.check_radio_group(hwnd, index).await?,
                _ => {}
            }
        }

        {
            let mut system = self.system();
            let control = system.control_at(index);

            if control.state & CAPTURED != 0 {
                control.state &= !(CAPTURED | TRACKING);

                if system.raster() {
                    system.capture = None;
                }
            }
        }

        if clicked {
            self.notify_parent(index, BN_CLICKED).await?;
        }

        Ok(())
    }

    /// An automatic radio button checked, and the rest of its group
    /// cleared (seg25 `12c3`-`1300`): from the button round its group with
    /// `GetNextDlgGroupItem` back to it, each that answers `WM_GETDLGCODE`
    /// with `DLGC_RADIOBUTTON` sent `BM_SETCHECK` -- checked for this one,
    /// cleared for the others. USER goes round until it comes back; here a
    /// window met twice ends it too, where the group skips the button
    /// itself, as it skips one disabled or hidden.
    async fn check_radio_group(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let parent = {
            let system = self.system();

            system
                .control_window(index)
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map_or(0, |parent| parent.hwnd)
        };
        let mut at = hwnd;
        let mut met = Vec::new();

        loop {
            let code = self
                .send_message(at, WM_GETDLGCODE, 0, &mut Param::Value(0))
                .await?;

            if code & DLGC_RADIOBUTTON != 0 {
                self.send_message(at, BM_SETCHECK, u16::from(at == hwnd), &mut Param::Value(0))
                    .await?;
            }

            met.push(at);
            at = self.system().next_group_item(parent, at, false);

            if at == hwnd || at == 0 || met.contains(&at) {
                return Ok(());
            }
        }
    }

    /// `BM_SETCHECK` (seg25 `1e1b`, by a table of the kinds at `1e30`): a
    /// check box, plain or automatic, is checked by any value but nought;
    /// a radio button too, which also takes `WS_TABSTOP` with its check
    /// and loses it cleared, whether the check changed or not (`1e7b`); a
    /// three-state box takes the value up to 2, grayed. A push button, a
    /// default one, a group box, a user button and an owner-drawn one
    /// keep none: `BM_GETCHECK` answers them nought (`btnkeys`, `check`).
    /// A check changed is drawn at once (`1e4a`-`1e75`), asking the
    /// parent's colours; one the same is not drawn, nor asked.
    async fn set_button_check(
        &self,
        hwnd: u16,
        index: usize,
        kind: u32,
        wparam: u16,
    ) -> Result<(), Stop> {
        let check = match kind {
            BS_CHECKBOX | BS_AUTOCHECKBOX => u16::from(wparam != 0),
            BS_RADIOBUTTON | BS_AUTORADIOBUTTON => {
                let mut system = self.system();
                let window = system.control_window_mut(index);

                if wparam == 0 {
                    window.style &= !WS_TABSTOP;
                } else {
                    window.style |= WS_TABSTOP;
                }

                let control = system.control_at(index);

                if wparam == 0 {
                    control.style &= !WS_TABSTOP;
                } else {
                    control.style |= WS_TABSTOP;
                }

                u16::from(wparam != 0)
            }
            BS_3STATE | BS_AUTO3STATE => wparam.min(2),
            _ => return Ok(()),
        };

        {
            let mut system = self.system();
            let control = system.control_at(index);

            if control.checked & 3 == check {
                return Ok(());
            }

            control.checked = check;
        }

        if self.button_colours(hwnd, index).await? {
            self.draw_button_now(index, false);
        }

        Ok(())
    }

    /// `BM_SETSTATE` (seg25 `1ea3`): pushed or let out, and, where the
    /// button shows, drawn at once in a device context of its own after
    /// asking its parent's colours (seg25 `103a`, `0fc4`) -- not left to
    /// `WM_PAINT`, and asked though nothing changed (`btnkeys`,
    /// `space-repeat`). A user button tells its parent `BN_HILITE` or
    /// `BN_UNHILITE`, changed or not; an owner-drawn one is drawn by its
    /// owner with `ODA_SELECT`, and any other drawn pressed in or out
    /// (seg25 `17ac`), each only if the state changed.
    async fn set_button_state(&self, hwnd: u16, index: usize, pushed: bool) -> Result<(), Stop> {
        let (was, kind) = {
            let mut system = self.system();
            let control = system.control_at(index);
            let was = control.state & PUSHED != 0;

            if pushed {
                control.state |= PUSHED;
            } else {
                control.state &= !PUSHED;
            }

            (was, control.button_kind())
        };

        if !self.button_colours(hwnd, index).await? {
            return Ok(());
        }

        if kind == BS_USERBUTTON {
            let code = if pushed { BN_HILITE } else { BN_UNHILITE };

            self.notify_parent(index, code).await?;
        } else if was != pushed {
            if kind == BS_OWNERDRAW {
                self.draw_button_item(index, ODA_SELECT, None).await?;
            } else {
                self.draw_button_now(index, false);
            }
        }

        Ok(())
    }

    /// The device context a button draws itself in at once, outside
    /// `WM_PAINT` (seg25 `103a`): none if the button does not show, and
    /// false; otherwise its parent asked its colours with `WM_CTLCOLOR`,
    /// `CTLCOLOR_BTN`, whatever its kind (seg25 `0fc4`), and true.
    async fn button_colours(&self, hwnd: u16, index: usize) -> Result<bool, Stop> {
        if !self.system().control_window(index).visible {
            return Ok(false);
        }

        self.ask_control_colours(hwnd, index).await?;
        Ok(true)
    }

    /// A button drawn now, as it is, a part of it waiting to be painted
    /// still waiting -- drawn without the focus where `unfocused`, as it
    /// is drawn losing it while the system still names it.
    fn draw_button_now(&self, index: usize, unfocused: bool) {
        let mut system = self.system();
        let window = system.control_window(index);
        let waiting = (window.needs_paint, window.needs_erase);
        let focus = system.focus;

        if unfocused && focus == Some(index) {
            system.focus = None;
        }

        system.repaint_control(index);
        system.focus = focus;

        let window = system.control_window_mut(index);

        (window.needs_paint, window.needs_erase) = waiting;
    }
}
