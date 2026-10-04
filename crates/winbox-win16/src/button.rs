//! A button taking the mouse, as USER's button window procedure takes it
//! (`USER.EXE` seg25 `1a12`, the `BUTTON` class's procedure): the press,
//! the pointer moved while it is held, the release, the double click, and
//! the button's pushed state, which `BM_SETSTATE` sets and `BM_GETSTATE`
//! reads beside the check and the focus.
//!
//! **Read out** of `USER.EXE`, and **recorded** by `btnclick`: each kind of
//! button -- push, default push, check box, automatic check box, radio,
//! automatic radio, three-state and automatic three-state, and each again
//! disabled -- sent the mouse's messages at points of its client area,
//! with its state, the capture, the focus and its parent's notifications
//! after each.
//!
//! The button keeps a byte of state beside its check (seg25 `1e9b`, which
//! answers it whole to `BM_GETSTATE`):
//!
//! * `04h`, pushed: drawn pressed in.
//! * `08h`, the focus.
//! * `10h`, the focus being taken by the button's own press, for the
//!   moment `SetFocus` takes (seg25 `11c6`-`11d3`); what a radio button
//!   does as it gains the focus otherwise is not followed here.
//! * `20h`, the mouse captured by the button.
//! * `40h`, the left button held down on it: the press is being followed.
//!
//! A press takes the capture and the focus, sets `40h` and pushes the
//! button if it is inside; a move while it is held pushes it or lets it out
//! as the pointer is inside or out; the release lets it out, changes an
//! automatic button's check, lets the capture go and tells the parent
//! `BN_CLICKED` -- if the button was pushed as it was let out, so a release
//! outside does nothing. The procedure never asks whether the button is
//! enabled: a disabled button sent the messages is pushed, captured and
//! clicked just the same, and only the focus is refused it (`btnclick`'s
//! `-disabled` records).

use crate::call::Stop;
use crate::controls::ControlState;
use crate::engine::Engine;
use crate::messages::Param;

const WM_KILLFOCUS: u16 = 0x0008;
const WM_GETDLGCODE: u16 = 0x0087;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const BM_SETCHECK: u16 = 0x0401;
pub const BM_GETSTATE: u16 = 0x0402;
pub const BM_SETSTATE: u16 = 0x0403;

const BN_CLICKED: u16 = 0;
const BN_HILITE: u16 = 2;
const BN_UNHILITE: u16 = 3;
const BN_DOUBLECLICKED: u16 = 5;

const DLGC_RADIOBUTTON: u32 = 0x0040;

const BS_AUTOCHECKBOX: u32 = 0x03;
const BS_RADIOBUTTON: u32 = 0x04;
const BS_AUTO3STATE: u32 = 0x06;
const BS_USERBUTTON: u32 = 0x08;
const BS_AUTORADIOBUTTON: u32 = 0x09;
const BS_OWNERDRAW: u32 = 0x0b;

const ODA_SELECT: u16 = 2;

/// Pushed: drawn pressed in.
pub const PUSHED: u8 = 0x04;
/// The focus, as `BM_GETSTATE` answers it.
const FOCUS: u8 = 0x08;
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
    /// A button's own answer to a message of the mouse's, to the messages
    /// of its pushed state, and to losing the focus; none for a message it
    /// leaves to the rest of its procedure.
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
            // Losing the focus: a press being followed is let out, and the
            // button let go as its release lets it go -- a button still
            // pushed, by a program's `BM_SETSTATE`, clicked (seg25 `1b2c`).
            // What the rest of its procedure does with the message follows.
            WM_KILLFOCUS => {
                if state & TRACKING != 0 {
                    self.send_message(hwnd, BM_SETSTATE, 0, &mut Param::Value(0))
                        .await?;
                }

                self.button_release(hwnd, index, true).await?;
                return Ok(None);
            }
            _ => return Ok(None),
        }

        Ok(Some(0))
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

    /// The mouse captured and the focus taken, once for a press (seg25
    /// `11ac`): `bits` set; then, if the button has not the capture
    /// already, `SetCapture` and `SetFocus` -- which a disabled button is
    /// refused (`btnclick`), though it keeps the capture.
    async fn button_capture(&self, hwnd: u16, index: usize, bits: u8) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let control = system.control_at(index);

            control.state |= bits;

            if control.state & CAPTURED != 0 {
                return Ok(());
            }

            control.state |= CAPTURED;

            if system.raster() {
                system.capture = Some(index);
            }
        }

        self.set_focus(hwnd).await?;
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

    /// `BM_SETSTATE` (seg25 `1ea3`): pushed or let out, and, where the
    /// button shows, drawn at once in a device context of its own after
    /// asking its parent's colours (seg25 `103a`, `0fc4`) -- not left to
    /// `WM_PAINT`. A user button tells its parent `BN_HILITE` or
    /// `BN_UNHILITE`, changed or not; an owner-drawn one is drawn by its
    /// owner with `ODA_SELECT`, and any other drawn pressed in or out
    /// (seg25 `17ac`), each only if the state changed.
    async fn set_button_state(&self, hwnd: u16, index: usize, pushed: bool) -> Result<(), Stop> {
        let (was, kind, shows) = {
            let mut system = self.system();
            let shows = system.control_window(index).visible;
            let control = system.control_at(index);
            let was = control.state & PUSHED != 0;

            if pushed {
                control.state |= PUSHED;
            } else {
                control.state &= !PUSHED;
            }

            (was, control.button_kind(), shows)
        };

        if !shows {
            return Ok(());
        }

        self.ask_control_colours(hwnd, index).await?;

        if kind == BS_USERBUTTON {
            let code = if pushed { BN_HILITE } else { BN_UNHILITE };

            self.notify_parent(index, code).await?;
        } else if was != pushed {
            if kind == BS_OWNERDRAW {
                self.draw_button_item(index, ODA_SELECT, None).await?;
            } else {
                // Drawn now; a part of it waiting to be painted still waits.
                let mut system = self.system();
                let window = system.control_window(index);
                let waiting = (window.needs_paint, window.needs_erase);

                system.repaint_control(index);

                let window = system.control_window_mut(index);

                (window.needs_paint, window.needs_erase) = waiting;
            }
        }

        Ok(())
    }
}
