//! Dialog boxes on the raster desktop, as winbox.js's `dialogs.ts` and
//! `dialog-items.ts` make them: made from a template, run modal or
//! modeless, and driven from the keyboard by `IsDialogMessage`.
//!
//! Measured by the `dialogs` probe on four displays:
//!
//! * Sizes and places in a template are dialog units, a quarter of the base
//!   width across and an eighth of the base height down.
//! * The base units are the dialog font's: its height, and, across, the
//!   width of the fifty-two letters over 26, plus one, halved.
//! * `DS_SETFONT`'s face is made bold: MS Sans Serif 8 is `lfHeight` -11
//!   and weight 700 on the VGA, -8 on the EGA.
//! * The dialog's client area is the template's place from its owner's
//!   client area, or from the screen without one. Its window's left edge is
//!   then put on the nearest byte of the display; its top is not moved. A
//!   dialog that would leave the screen is brought back onto it
//!   (`dlgclamp`).
//! * After `WM_INITDIALOG` answers TRUE the first control with `WS_TABSTOP`
//!   has the focus; Tab moves to the next, in the template's order,
//!   wrapping. Enter is the default button's command, Escape `IDCANCEL`'s.
//! * `DialogBox` disables the owner while the dialog runs, enables it again
//!   after, and answers what `EndDialog` was given.

use crate::button::{BM_CLICK, DIALOG_FOCUS};
use crate::call::{Answer, Args, Later, Stop};
use crate::classes::{DIALOG_CLASS, WndProc};
use crate::controls::{BM_GETCHECK, BM_SETCHECK, BM_SETSTYLE, CTLCOLOR_DLG};
use crate::create::{Creation, WindowName};
use crate::dialog_template::{DS_SETFONT, DialogTemplate, Named, parse_dialog_template};
use crate::engine::Engine;
use crate::gdi::GdiObject;
use crate::menus::MenuName;
use crate::messages::{Param, WM_CTLCOLOR, WM_GETTEXT, WM_SETTEXT};
use crate::queue::Message;
use crate::system::System;
use crate::windows::Placement;

const DS_ABSALIGN: u32 = 0x01;
const DS_MODALFRAME: u32 = 0x80;
const DS_NOIDLEMSG: u32 = 0x100;
const DS_SYSMODAL: u32 = 0x02;
const HWND_TOPMOST: u16 = 0xffff;
const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOREDRAW: u16 = 0x0008;
const SWP_NOACTIVATE: u16 = 0x0010;
const WM_CANCELMODE: u16 = 0x001f;
const WM_SYSTIMER: u16 = 0x0118;
const WM_SYSKEYDOWN: u16 = 0x0104;
const WM_QUIT: u16 = 0x0012;
const SM_CYDLGFRAME: i16 = 8;
const CS_BYTEALIGNWINDOW: u32 = 0x2000;
const WS_TABSTOP: u32 = 0x0001_0000;
const WS_GROUP: u32 = 0x0002_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_CHILD: u32 = 0x4000_0000;

const WM_ACTIVATE: u16 = 0x0006;
const WM_SETFOCUS: u16 = 0x0007;
const WM_CLOSE: u16 = 0x0010;
const WM_ERASEBKGND: u16 = 0x0014;
const WM_SHOWWINDOW: u16 = 0x0018;
const WM_NEXTDLGCTL: u16 = 0x0028;
const WM_VKEYTOITEM: u16 = 0x002e;
const WM_CHARTOITEM: u16 = 0x002f;
const WM_SETFONT: u16 = 0x0030;
const WM_GETFONT: u16 = 0x0031;
const WM_QUERYDRAGICON: u16 = 0x0037;
const WM_COMPAREITEM: u16 = 0x0039;
const WM_GETDLGCODE: u16 = 0x0087;
const WM_KEYDOWN: u16 = 0x0100;
const WM_CHAR: u16 = 0x0102;
const WM_SYSCHAR: u16 = 0x0106;
const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
const WM_ENTERIDLE: u16 = 0x0121;
const WM_LBUTTONDOWN: u16 = 0x0201;
const DM_GETDEFID: u16 = 0x0400;
const DM_SETDEFID: u16 = 0x0401;
const EM_SETSEL: u16 = 0x0401;
const DC_HASDEFID: u32 = 0x534b;

const BS_PUSHBUTTON: u16 = 0;
const BS_DEFPUSHBUTTON: u16 = 1;

const DLGC_WANTARROWS: u32 = 0x0001;
const DLGC_WANTTAB: u32 = 0x0002;
const DLGC_WANTALLKEYS: u32 = 0x0004;
const DLGC_HASSETSEL: u32 = 0x0008;
const DLGC_DEFPUSHBUTTON: u32 = 0x0010;
const DLGC_UNDEFPUSHBUTTON: u32 = 0x0020;
const DLGC_RADIOBUTTON: u32 = 0x0040;
const DLGC_WANTCHARS: u32 = 0x0080;
const DLGC_STATIC: u32 = 0x0100;
const DLGC_BUTTON: u32 = 0x2000;
const SS_NOPREFIX: u32 = 0x80;
const BS_AUTORADIOBUTTON: u32 = 0x09;
const VK_CANCEL: u16 = 0x03;
const VK_EXECUTE: u16 = 0x2b;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const BN_CLICKED: u32 = 0;

const VK_TAB: u16 = 0x09;
const VK_RETURN: u16 = 0x0d;
const VK_SHIFT: usize = 0x10;
const VK_ESCAPE: u16 = 0x1b;
const VK_MENU: u16 = 0x12;
const BM_SETSTATE: u16 = 0x0403;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;

const SW_SHOWNORMAL: u16 = 1;

/// A dialog's own message filter code.
const MSGF_DIALOGBOX: i16 = 0;

const RT_DIALOG: u16 = 5;

/// A dialog's procedure: the program's, a far address, nought for none;
/// or one of USER's own, for a dialog USER builds and runs itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DialogProc {
    Guest(u32),
    /// A message box's (`user_calls/message_box.rs`).
    MessageBox(crate::user_calls::message_box::BoxProc),
    /// SHELL's About box's (`shell/about.rs`).
    About(crate::shell::about::AboutProc),
    /// The MIDI sequencer's warning's (`mmsystem/seq_box.rs`).
    SeqWarning(crate::mmsystem::seq_box::WarningProc),
}

impl Default for DialogProc {
    fn default() -> Self {
        Self::Guest(0)
    }
}

/// What USER keeps of a dialog beside its window.
#[derive(Debug, Clone, Default)]
pub struct DialogState {
    /// The dialog procedure.
    pub proc: DialogProc,
    /// The dialog font's handle; nought for the System font.
    pub font: u16,
    pub base: (i32, i32),
    pub modal: bool,
    /// Ended by `EndDialog`, or going: the dialog's word at 12h (seg25
    /// `25b0`, `0627`).
    pub ended: bool,
    /// The default button's identifier -- 1 as the dialog is made, then the
    /// control that answers `WM_GETDLGCODE` with `DLGC_DEFPUSHBUTTON` --
    /// and, once `EndDialog` has written its value over it, what
    /// `DialogBox` answers: one word of the dialog's, at 16h (`USER.EXE`
    /// seg24 `06fa`, `08be`; seg25 `25b8`, `08b5`).
    pub def_id: u16,
    /// Whether the owner was disabled before `DialogBox`, at 14h: false for
    /// a modeless dialog (seg24 `06d6`, seg25 `0797`).
    pub owner_was_disabled: bool,
    /// The control that had the focus as the dialog lost the activation,
    /// to have it again.
    pub saved_focus: u16,
    /// The window system modal before a system-modal dialog, at 1Ch, to be
    /// so again as it ends (seg24 `063e`, seg25 `25ee`).
    pub sys_modal_before: u16,
}

/// `MulDiv`: the product over the divisor, rounded half away from nought,
/// held to sixteen bits signed; the largest of its sign for nought.
fn mul_div(multiplicand: i32, multiplier: i32, divisor: i32) -> i32 {
    let product = f64::from(multiplicand) * f64::from(multiplier);

    if divisor == 0 {
        return if product < 0.0 { -32768 } else { 32767 };
    }

    let exact = product / f64::from(divisor);
    let result = exact.signum() * exact.abs().round();

    (result as i32).clamp(-32768, 32767)
}

impl System {
    fn dialog_of(&self, hwnd: u16) -> Option<&DialogState> {
        let index = self.window_named(hwnd)?;

        self.windows[index].as_ref()?.dialog.as_ref()
    }

    fn dialog_mut(&mut self, hwnd: u16) -> Option<&mut DialogState> {
        let index = self.window_named(hwnd)?;

        self.windows[index].as_mut()?.dialog.as_mut()
    }

    /// The System font's base units, as `GetDialogBaseUnits` answers them.
    pub(crate) fn system_base_units(&mut self) -> Result<(i32, i32), Stop> {
        let units = crate::gdi::text::get_dialog_base_units(self)?;

        Ok(((units & 0xffff) as i32, (units >> 16) as i32))
    }

    /// A dialog's controls, in the order they were made.
    pub(crate) fn controls_of(&self, hwnd: u16) -> Vec<usize> {
        let Some(dialog) = self.window_named(hwnd) else {
            return Vec::new();
        };

        self.z_order
            .iter()
            .copied()
            .filter(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_some_and(|window| window.parent == Some(dialog) && window.hwnd != 0)
            })
            .collect()
    }

    fn shown_window(&self, index: usize) -> &crate::windows::Window {
        self.windows[index].as_ref().expect("a window")
    }

    pub(crate) fn dlg_item(&self, hwnd: u16, id: u16) -> u16 {
        self.controls_of(hwnd)
            .into_iter()
            .find(|&child| self.shown_window(child).control_id == id)
            .map_or(0, |child| self.shown_window(child).hwnd)
    }

    /// The control a dialog's focus starts on (`USER.EXE` seg25 `0089`):
    /// the first with `WS_TABSTOP` that is visible and not disabled;
    /// failing that the first control at all, whatever it is -- a group
    /// box, which shows no focus, as `groupbox` records -- and with no
    /// controls the dialog itself.
    pub fn first_tab_item(&self, hwnd: u16) -> u16 {
        let controls = self.controls_of(hwnd);
        let stop = controls.iter().copied().find(|&child| {
            let style = self.shown_window(child).style;

            style & WS_TABSTOP != 0 && style & WS_VISIBLE != 0 && style & WS_DISABLED == 0
        });

        stop.or_else(|| controls.first().copied())
            .map_or(hwnd, |child| self.shown_window(child).hwnd)
    }

    /// The dialog's own control a window is in (`USER.EXE` seg25 `0f8c`):
    /// the window itself, or the last of its parents that is still a child
    /// before the dialog -- a combo box for its edit control; none for the
    /// dialog or a window that is no child.
    pub(crate) fn child_control(&self, hwnd: u16, from: u16) -> u16 {
        let is_child = |index: usize| self.shown_window(index).style & 0xc000_0000 == WS_CHILD;
        let Some(mut at) = self.window_named(from) else {
            return 0;
        };

        if from == hwnd || !is_child(at) {
            return 0;
        }

        while let Some(parent) = self.shown_window(at).parent {
            if self.shown_window(parent).hwnd == hwnd || !is_child(parent) {
                break;
            }

            at = parent;
        }

        self.shown_window(at).hwnd
    }

    /// The dialog's child after `from`, the first after the last, and the
    /// first for none (`USER.EXE` seg25 `0f70`): the order the children
    /// lie in.
    fn next_child(&self, hwnd: u16, from: u16) -> u16 {
        let controls = self.controls_of(hwnd);
        let at = controls
            .iter()
            .position(|&child| from != 0 && self.shown_window(child).hwnd == from);

        match at {
            Some(at) if at + 1 < controls.len() => self.shown_window(controls[at + 1]).hwnd,
            _ => controls
                .first()
                .map_or(0, |&child| self.shown_window(child).hwnd),
        }
    }

    /// The dialog's child before `from`, going round, and the last for
    /// none (seg25 `0f38`).
    fn previous_child(&self, hwnd: u16, from: u16) -> u16 {
        let controls = self.controls_of(hwnd);
        let at = controls
            .iter()
            .position(|&child| from != 0 && self.shown_window(child).hwnd == from);

        match at {
            Some(at) if at > 0 => self.shown_window(controls[at - 1]).hwnd,
            _ => controls
                .last()
                .map_or(0, |&child| self.shown_window(child).hwnd),
        }
    }

    /// A window's style, nought for none.
    fn style_of(&self, hwnd: u16) -> u32 {
        self.window_named(hwnd)
            .map_or(0, |index| self.shown_window(index).style)
    }

    fn grouped(&self, hwnd: u16) -> bool {
        self.style_of(hwnd) & WS_GROUP != 0
    }

    /// Shown and not disabled, as the dialog manager asks of a control it
    /// moves to.
    fn reachable(&self, hwnd: u16) -> bool {
        self.window_named(hwnd).is_some_and(|index| {
            let window = self.shown_window(index);

            window.style & WS_DISABLED == 0 && window.visible
        })
    }

    /// The next control of `from`'s group (seg19 `09ab`): the next child,
    /// unless it starts a group, when the group goes round to its first --
    /// the last child with `WS_GROUP` at or before `from`, going back round
    /// the dialog's children: a first control without `WS_GROUP` is in the
    /// group of the last control that has it.
    fn group_next(&self, hwnd: u16, from: u16) -> u16 {
        let next = self.next_child(hwnd, from);

        if from == 0 || !self.grouped(next) {
            return next;
        }

        let mut at = from;

        while !self.grouped(at) {
            let before = self.previous_child(hwnd, at);

            if before == from {
                break;
            }

            at = before;
        }

        at
    }

    /// The control before `from` in its group (seg19 `096c`): the child
    /// before it, unless `from` starts the group, when the group's last --
    /// the child before the next that starts a group.
    fn group_previous(&self, hwnd: u16, from: u16) -> u16 {
        if from == 0 || !self.grouped(from) {
            return self.previous_child(hwnd, from);
        }

        let mut at = from;

        loop {
            let next = self.next_child(hwnd, at);

            if self.grouped(next) || next == from {
                return at;
            }

            at = next;
        }
    }

    /// The control with `WS_TABSTOP` after `from`'s control -- or before
    /// it, `previous` -- shown and not disabled, going round (`USER.EXE`
    /// seg19 `09ee`, `GetNextDlgTabItem`). `from` is taken to the dialog's
    /// control it is in first (`0a02`): Tab in a combo box's edit control
    /// goes on from the combo box. With none other, the round ends at
    /// `from`'s control, which is answered whatever it is; from no control,
    /// it starts after the last (or before the first).
    pub fn next_tab_item(&self, hwnd: u16, from: u16, previous: bool) -> u16 {
        let start = self.child_control(hwnd, from);
        let end = if start != 0 {
            start
        } else if previous {
            self.next_child(hwnd, 0)
        } else {
            self.previous_child(hwnd, 0)
        };
        let mut at = start;

        loop {
            at = if previous {
                self.previous_child(hwnd, at)
            } else {
                self.next_child(hwnd, at)
            };

            if at == 0 || at == end {
                return at;
            }

            if self.style_of(at) & WS_TABSTOP != 0 && self.reachable(at) {
                return at;
            }
        }
    }

    /// The next control in `from`'s group, or the one before, shown and not
    /// disabled (`USER.EXE` seg19 `0a5f`, `GetNextDlgGroupItem`), as
    /// `group_next` and `group_previous` go round it; come back to `from`'s
    /// control, that one, whatever it is.
    pub fn next_group_item(&self, hwnd: u16, from: u16, previous: bool) -> u16 {
        let start = self.child_control(hwnd, from);
        let mut first = start;
        let mut at = start;

        loop {
            at = if previous {
                self.group_previous(hwnd, at)
            } else {
                self.group_next(hwnd, at)
            };

            let round = at == first;

            if first == 0 {
                first = at;
            }

            if round || at == 0 || self.reachable(at) {
                return at;
            }
        }
    }

    /// A control's text, as the dialog manager reads it to find a mnemonic
    /// (seg19 `0101`).
    fn control_text(&self, hwnd: u16) -> Vec<u8> {
        self.window_named(hwnd).map_or_else(Vec::new, |index| {
            let window = self.shown_window(index);

            window
                .control
                .as_ref()
                .map_or(window.title.as_bytes(), |control| control.text.as_bytes())
                .to_vec()
        })
    }

    /// Whether a window is inside a dialog, however deep.
    fn in_dialog(&self, hwnd: u16, index: usize) -> bool {
        let Some(dialog) = self.window_named(hwnd) else {
            return false;
        };
        let mut at = self.shown_window(index).parent;

        while let Some(window) = at {
            if window == dialog {
                return true;
            }

            at = self.shown_window(window).parent;
        }

        false
    }

    /// The focus kept as a dialog loses it (seg25 `03a8`): the window that
    /// has it, if it is inside the dialog and nothing is kept already.
    /// What it kept, nought for nothing.
    fn save_focus(&mut self, hwnd: u16) -> u16 {
        let Some(focus) = self.focus else {
            return 0;
        };
        let focus_hwnd = self.shown_window(focus).hwnd;
        let inside = self.in_dialog(hwnd, focus);

        if let Some(state) = self.dialog_mut(hwnd)
            && focus_hwnd != 0
            && state.saved_focus == 0
            && inside
        {
            state.saved_focus = focus_hwnd;
            return focus_hwnd;
        }

        0
    }

    /// A dialog's template from a module's resources, by name or number.
    pub(crate) fn resource_template(
        &mut self,
        instance: u16,
        name: &MenuName,
    ) -> Option<DialogTemplate> {
        let executable = self.executable_of(instance)?;
        let bytes = crate::resources::find_by(&executable, RT_DIALOG, name)?;

        Some(parse_dialog_template(|at| {
            bytes.get(at as usize).copied().unwrap_or(0)
        }))
    }

    /// A template in the program's memory, at a far address.
    pub(crate) fn memory_template(&self, far: u32) -> DialogTemplate {
        let segment = far & 0xffff_0000;
        let offset = far & 0xffff;

        parse_dialog_template(|at| {
            let far = segment | ((offset + at) & 0xffff);

            self.read_far(far, 1)[0]
        })
    }
}

impl Engine {
    /// Makes a dialog from its template: the window, its font, its
    /// controls, then `WM_INITDIALOG` and the focus. Its window, or nought.
    #[allow(clippy::too_many_lines)]
    pub async fn create_dialog(
        &self,
        instance: u16,
        template: &DialogTemplate,
        owner: u16,
        proc: DialogProc,
        param: u32,
        modal: bool,
    ) -> Result<u16, Stop> {
        let (font, base, origin, place, menu, class_name, style, modal_frame) = {
            let mut system = self.system();

            if !system.raster() {
                return Ok(0);
            }

            system.dialog_class();

            // The font, and the units it makes.
            let mut font = 0;
            let mut base = system.system_base_units()?;

            if template.style & DS_SETFONT != 0
                && let Some((points, face)) = &template.font
            {
                let logical = system.display.caps.logical_pixels_y;
                let logfont = crate::fonts::LogFont {
                    height: -mul_div(i32::from(*points as i16), logical, 72) as i16,
                    weight: 700,
                    face_name: face.clone(),
                    ..crate::fonts::LogFont::default()
                };

                font = crate::gdi::objects::create_font_indirect(&mut system, logfont);

                if let Some((object, _)) = system.gdi_object_of(font) {
                    base = crate::gdi::text::base_units_of(&mut system, object)?;
                }
            }

            // Half a unit added, then the fraction cut off toward nought:
            // rounded as `MulDiv` rounds for a place or a size above
            // nought, but a pixel nearer nought for one below it
            // (`dlgneg`).
            let across = |units: i16| (i32::from(units) * base.0 + 2) / 4;
            let down = |units: i16| (i32::from(units) * base.1 + 4) / 8;

            // The client area, from the owner's client area or the screen
            // -- the screen's with `DS_ABSALIGN` (documented).
            let origin = match system.window_named(owner) {
                Some(index) if template.style & DS_ABSALIGN == 0 => {
                    let window = system.shown_window(index);

                    (
                        window.left + window.client.left,
                        window.top + window.client.top,
                    )
                }
                _ => (0, 0),
            };
            let client = (
                origin.0 + across(template.x),
                origin.1 + down(template.y),
                across(template.cx),
                down(template.cy),
            );
            // A dialog owned by the system-modal window is made system modal
            // too (`USER.EXE` seg24 `011c`-`0148`). **Recorded** by `sysdlg`.
            let sys_modal = system.sys_modal_window();
            let owned_by_sys_modal = sys_modal != 0
                && owner == sys_modal
                && system
                    .window_named(owner)
                    .is_some_and(|index| system.shown_window(index).parent.is_none());
            let style = if owned_by_sys_modal {
                template.style | DS_SYSMODAL
            } else {
                template.style
            } & !WS_VISIBLE;
            let modal_frame = template.style & DS_MODALFRAME != 0;
            let [inset_left, inset_top, inset_right, inset_bottom] =
                system.frame_insets(style, modal_frame, template.menu.is_some())?;
            let class_name = template
                .class_name
                .clone()
                .unwrap_or_else(|| DIALOG_CLASS.to_string());
            let width = client.2 + inset_left + inset_right;
            let height = client.3 + inset_top + inset_bottom;

            // A class with `CS_BYTEALIGNWINDOW` keeps its windows' left
            // edges on a byte of the display, the nearest (`dlgpos`). The
            // dialog class has it, and so does Borland's `bordlg`.
            let per_byte = (8 / i32::from(system.display.bits_per_pixel.max(1))).max(1);
            let class_style = system
                .class_named(&class_name)
                .map_or(0, |class| u32::from(system.classes[class].style));
            let aligned = per_byte > 1
                && (class_name == DIALOG_CLASS || class_style & CS_BYTEALIGNWINDOW != 0);
            let align = |value: i32| value & !(per_byte - 1);
            let mut left = client.0 - inset_left;
            let mut top = client.1 - inset_top;

            if aligned {
                left = align(left + per_byte / 2);
            }

            // Kept on the screen (`dlgclamp`): past the right edge moved to
            // end at it, and then down to a byte; past the bottom to end
            // four pixels above it; nothing left above or left of it.
            if style & WS_CHILD == 0 {
                let right = i32::from(system.display.width);
                let bottom = i32::from(system.display.height) - system.metric(SM_CYDLGFRAME);

                if left + width > right {
                    left = if aligned {
                        align(right - width)
                    } else {
                        right - width
                    };
                }

                if top + height > bottom {
                    top = bottom - height;
                }

                left = left.max(0);
                top = top.max(0);
            }

            // The menu the template names, from the dialog's module
            // (documented).
            let menu = match &template.menu {
                None => 0,
                Some(Named::Text(text)) if text.is_empty() => 0,
                Some(Named::Text(text)) => {
                    system.load_menu(instance, &MenuName::Text(text.clone()))
                }
                Some(Named::Number(number)) => {
                    system.load_menu(instance, &MenuName::Number(*number))
                }
            };

            (
                font,
                base,
                origin,
                (left, top, width, height),
                menu,
                class_name,
                style,
                modal_frame,
            )
        };
        let across = |units: i16| ((i32::from(units) * base.0 + 2) / 4) as i16;
        let down = |units: i16| ((i32::from(units) * base.1 + 4) / 8) as i16;
        // A child dialog is made where its parent's client area puts it:
        // the place worked out on the screen, less that corner, which
        // `CreateWindow` adds again.
        let child = style & WS_CHILD != 0;
        let (left, top, width, height) = place;
        let hwnd = self
            .create_window(Creation {
                ex_style: 0,
                class: class_name,
                class_far: 0,
                name: WindowName::Own(template.caption.clone()),
                style,
                x: (if child { left - origin.0 } else { left }) as i16,
                y: (if child { top - origin.1 } else { top }) as i16,
                width: width as i16,
                height: height as i16,
                parent: owner,
                menu,
                instance,
                param,
            })
            .await?;
        let Some(index) = self.system().window_named(hwnd) else {
            return Ok(0);
        };

        // System modal as soon as it is a window, the window system modal
        // before kept to be so again as it ends; refused -- another task's
        // system-modal window up -- it is not system modal at all (seg24
        // `062d`-`064b`). The task is locked only as it shows. **Recorded**
        // by `sysdlg`.
        let mut sys_modal_before = 0;

        if style & DS_SYSMODAL != 0 {
            sys_modal_before = self.set_sys_modal(hwnd).await?;

            let mut system = self.system();

            if system.sys_modal_window() != hwnd
                && let Some(window) = system.windows[index].as_mut()
            {
                window.style &= !DS_SYSMODAL;
            }
        }

        {
            let mut system = self.system();

            if modal_frame {
                let (left, top, width, height) = {
                    let window = system.windows[index].as_mut().expect("a window");

                    window.modal_frame = true;
                    (window.left, window.top, window.width, window.height)
                };

                system.place_window(index, left, top, width, height)?;
            }

            system.windows[index].as_mut().expect("a window").dialog = Some(DialogState {
                proc,
                font,
                base,
                modal,
                def_id: 1,
                sys_modal_before,
                ..DialogState::default()
            });
        }

        if font != 0 {
            self.send_message(hwnd, WM_SETFONT, font, &mut Param::Value(0))
                .await?;
        }

        for item in &template.items {
            let text = match &item.text {
                Named::Number(number) => format!("#{number}"),
                Named::Text(text) => text.clone(),
            };
            // Each control made `WS_EX_NOPARENTNOTIFY` (`USER.EXE` seg24
            // `082d`): the dialog is not told of it.
            let control = self
                .create_window(Creation {
                    ex_style: crate::create::WS_EX_NOPARENTNOTIFY,
                    class: item.class_name.clone(),
                    class_far: 0,
                    name: WindowName::Own(text),
                    style: item.style | WS_CHILD,
                    x: across(item.x),
                    y: down(item.y),
                    width: across(item.cx),
                    height: down(item.cy),
                    parent: hwnd,
                    menu: item.id,
                    instance,
                    param: 0,
                })
                .await?;

            if control == 0 {
                continue;
            }

            if font != 0 {
                self.send_message(control, WM_SETFONT, font, &mut Param::Value(0))
                    .await?;
            }

            // Each control asked what it is as it is made, and the last
            // that answers `DLGC_DEFPUSHBUTTON` is the dialog's default,
            // over the 1 it starts with (`USER.EXE` seg24 `08a9`-`08c2`).
            // **Recorded** by `dlgcode`.
            if self.dialog_code(control).await? & DLGC_DEFPUSHBUTTON != 0
                && let Some(state) = self.system().dialog_mut(hwnd)
            {
                state.def_id = item.id;
            }
        }

        let first = self.system().first_tab_item(hwnd);
        let answer = self
            .send_message(hwnd, WM_INITDIALOG, first, &mut Param::Value(param))
            .await?;

        // Worked out again after `WM_INITDIALOG`, which may have changed the
        // controls (`USER.EXE` seg24 `08e5`) -- unless `EndDialog` has ended
        // it there, when no control is given the focus and a dialog made
        // shown is not shown (`090e`, `0949`). **Recorded** by `enddlg`:
        // ended in `WM_INITDIALOG`, `WS_VISIBLE` or not, the dialog is
        // neither shown nor made active, and the focus stays where it was.
        let ended = || {
            self.system()
                .dialog_of(hwnd)
                .is_some_and(|state| state.ended)
        };

        // The focus given as the dialog manager gives it, and the default
        // push button kept as it moves from the control `WM_INITDIALOG` was
        // given -- gone meanwhile, none -- to the first tab item now
        // (`090e`-`093e`).
        if answer & 0xffff != 0 && !ended() {
            let (given, focus) = {
                let system = self.system();
                let given = if system.window_named(first).is_some() {
                    first
                } else {
                    0
                };

                (given, system.first_tab_item(hwnd))
            };

            self.dlg_set_focus(focus).await?;
            self.check_def_push(hwnd, given, focus).await?;
        }

        let hidden = {
            let system = self.system();

            system
                .window_named(hwnd)
                .is_some_and(|index| !system.shown_window(index).visible)
        };

        if template.style & WS_VISIBLE != 0 && !ended() && hidden {
            self.show(hwnd, SW_SHOWNORMAL).await?;
            self.update_dialog(hwnd).await?;

            // Shown system modal, the task is locked (`0963`-`0976`).
            let mut system = self.system();

            if system.sys_modal_window() == hwnd {
                system.lock_my_task_to(1);
            }
        }

        Ok(hwnd)
    }

    /// A window shown as `ShowWindow` shows it; nothing for a handle that is
    /// no window.
    pub(crate) async fn show(&self, hwnd: u16, show: u16) -> Result<(), Stop> {
        let index = self.system().window_named(hwnd);

        if let Some(index) = index {
            self.show_raster(hwnd, index, show, true, false).await?;
        }

        Ok(())
    }

    /// A modal dialog's owner made ready, as `DialogBoxIndirectParam` makes
    /// it before the dialog is made (`USER.EXE` seg25 `08eb`-`0930`): for a
    /// child, the window at the top it is in, and that window's last owner
    /// (seg1 `63a2`); whether it was disabled already and whether it was the
    /// active window noted; then disabled. **Recorded** by `enddlg`: the
    /// owner is sent `WM_CANCELMODE` and `WM_ENABLE` before the dialog's
    /// `WM_INITDIALOG`. The owner, and the two notes.
    pub(crate) async fn begin_modal(&self, owner: u16) -> Result<(u16, bool, bool), Stop> {
        let found = {
            let system = self.system();

            system.window_named(owner).map(|index| {
                let mut at = index;

                if system.shown_window(at).parent.is_some() {
                    while let Some(up) = system
                        .shown_window(at)
                        .parent
                        .or(system.shown_window(at).owner)
                    {
                        at = up;
                    }
                }

                (
                    system.hwnd_of(at),
                    system.shown_window(at).style & WS_DISABLED != 0,
                    system.active_top() == Some(at),
                )
            })
        };
        let Some((owner, disabled, active)) = found else {
            return Ok((0, false, false));
        };

        self.enable_window(owner, false).await?;
        Ok((owner, disabled, active))
    }

    /// A dialog painted as it shows, it and its controls (seg24 `095d`,
    /// seg25 `0847`).
    async fn update_dialog(&self, hwnd: u16) -> Result<(), Stop> {
        let painted: Vec<u16> = {
            let system = self.system();

            match system.window_named(hwnd) {
                Some(dialog) => std::iter::once(hwnd)
                    .chain(system.z_order.iter().filter_map(|&other| {
                        let window = system.shown_window(other);

                        (window.parent == Some(dialog) && window.hwnd != 0).then_some(window.hwnd)
                    }))
                    .collect(),
                None => Vec::new(),
            }
        };

        for window in painted {
            self.update_window(window).await?;
        }

        Ok(())
    }

    /// The modal loop (`USER.EXE` seg25 `0737`), until the dialog has
    /// ended: the value `EndDialog` wrote, then the dialog destroyed.
    /// `EndDialog` has hidden it and enabled the owner already; nothing here
    /// does either.
    ///
    /// * No dialog made: the owner enabled again where it was not disabled
    ///   before, given the focus where it was active, and -1
    ///   (`0749`-`0779`).
    /// * The window with the mouse's capture told `WM_CANCELMODE` (`077c`).
    /// * A message taken goes to `IsDialogMessage`, else is translated and
    ///   dispatched. `WM_QUIT` is posted again and ends the loop, answering
    ///   the dialog's word as it stands (`07d5`, `08ad`).
    /// * The dialog not shown yet is shown the first time nothing is found,
    ///   or at `WM_SYSTIMER` or `WM_SYSKEYDOWN`, and painted
    ///   (`0801`-`084c`). So a message posted in `WM_INITDIALOG` is taken
    ///   while it is hidden (`enddlg`).
    /// * Shown and finding nothing, the owner is sent `WM_ENTERIDLE` once
    ///   until a message comes, unless the dialog has `DS_NOIDLEMSG`; then
    ///   it waits (`085b`-`0899`).
    /// * The dialog destroyed without `EndDialog` ends the loop with 0, and
    ///   the owner is left disabled (`089e`-`08ab`; `enddlg`).
    pub(crate) async fn run_modal(
        &self,
        hwnd: u16,
        owner: u16,
        owner_was_disabled: bool,
        owner_was_active: bool,
    ) -> Result<i16, Stop> {
        if hwnd == 0 {
            if owner != 0 && !owner_was_disabled && self.system().window_named(owner).is_some() {
                self.enable_window(owner, true).await?;

                if owner_was_active {
                    self.set_focus(owner).await?;
                }
            }

            return Ok(-1);
        }

        let capture = {
            let system = self.system();

            system.capture.map(|index| system.hwnd_of(index))
        };

        if let Some(capture) = capture.filter(|&capture| capture != 0) {
            self.send_message(capture, WM_CANCELMODE, 0, &mut Param::Value(0))
                .await?;
        }

        let (mut visible, idle_messages) = {
            let mut system = self.system();

            if let Some(state) = system.dialog_mut(hwnd) {
                state.owner_was_disabled = owner_was_disabled;
            }

            match system.window_named(hwnd) {
                Some(index) => {
                    let window = system.shown_window(index);

                    (window.visible, window.style & DS_NOIDLEMSG == 0)
                }
                None => (false, true),
            }
        };
        let mut idled = false;
        let mut owner = owner;

        loop {
            if self
                .system()
                .dialog_of(hwnd)
                .is_some_and(|state| state.ended)
            {
                break;
            }

            if let Some(message) = self.take_message_from(false, None).await? {
                // The loop takes it with USER's own `PeekMessage` (seg25
                // `07c7`, the function `PeekMessage` goes on to past its
                // checks, seg1 `a76c`), which notes its time and place for
                // `GetMessageTime` and `GetMessagePos`. Control Panel's spin
                // buttons ask the place of a press on them; they found the
                // last a program took.
                self.system().note_taken(&message);
                idled = false;

                if message.message == WM_QUIT {
                    if let Some(task) = self.system().task.as_mut() {
                        task.queue.quit_code = Some(message.wparam);
                    }

                    break;
                }

                // `IsDialogMessage` past its checks, which calls the message
                // filters first (seg25 `07e4`, `0c38`).
                if !self.is_dialog_message(hwnd, &message).await? {
                    self.system().translate(&message);
                    self.dispatch(&message).await?;
                }

                if visible || !matches!(message.message, WM_SYSTIMER | WM_SYSKEYDOWN) {
                    if self.system().window_named(hwnd).is_none() {
                        return Ok(0);
                    }

                    continue;
                }
            }

            if visible {
                if owner != 0 && self.system().window_named(owner).is_none() {
                    owner = 0;
                }

                if owner != 0 && idle_messages && !idled {
                    idled = true;
                    self.send_message(
                        owner,
                        WM_ENTERIDLE,
                        MSGF_DIALOGBOX as u16,
                        &mut Param::Value(u32::from(hwnd)),
                    )
                    .await?;
                } else {
                    // Waiting, a message another program sent the dialog,
                    // answered, sends the loop back to see whether it has
                    // ended: the Task List's Cancel, pressed by another
                    // program with `SendMessage`, ends TASKMAN.EXE's dialog
                    // (`tasklist`). Inferred: the loop waits with
                    // `WaitMessage` (`USER.EXE` seg25 `0899`), and what makes
                    // that return then is not read out.
                    if let Some(None) = self.wait_message_or_sent().await? {
                        break;
                    }
                }
            } else {
                visible = true;
                self.show_modal(hwnd).await?;
            }

            if self.system().window_named(hwnd).is_none() {
                return Ok(0);
            }
        }

        let result = self
            .system()
            .dialog_of(hwnd)
            .map_or(0, |state| state.def_id as i16);

        if self.system().window_named(hwnd).is_some() {
            self.destroy_window(hwnd).await?;
        }

        Ok(result)
    }

    /// A modal dialog shown the first time its loop finds no message, or
    /// takes `WM_SYSTIMER` or `WM_SYSKEYDOWN` (`USER.EXE` seg25
    /// `081b`-`0859`).
    async fn show_modal(&self, hwnd: u16) -> Result<(), Stop> {
        // System modal, it is put in front of all first, neither
        // moved, sized, drawn nor made active (`0826`-`0839`,
        // `HWND_TOPMOST` with 1Bh).
        let topmost = {
            let system = self.system();

            (system.sys_modal_window() == hwnd)
                .then(|| system.window_named(hwnd))
                .flatten()
        };

        if let Some(index) = topmost {
            self.position_raster(
                hwnd,
                index,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOREDRAW | SWP_NOACTIVATE,
            )
            .await?;
        }

        self.show(hwnd, SW_SHOWNORMAL).await?;

        // Painted as it shows, it and its controls, not by its loop:
        // `hooks` recorded no `WM_PAINT` among the messages the loop
        // took.
        self.update_dialog(hwnd).await?;

        // And the task locked while it shows (`084c`-`0854`).
        // **Recorded** by `sysdlg`.
        let mut system = self.system();

        if system.sys_modal_window() == hwnd {
            system.lock_my_task_to(1);
        }

        Ok(())
    }

    /// `EndDialog`, for a dialog modal or modeless, at once (`USER.EXE`
    /// seg25 `2564`); a modal one's loop then sees it has ended and
    /// destroys it. **Recorded** by `enddlg`:
    ///
    /// 1. The owner -- the parent of a child -- is enabled again, unless it
    ///    was disabled before `DialogBox`; a modeless dialog notes nothing,
    ///    so its owner is enabled whatever it was (`2589`-`25ab`).
    /// 2. The dialog is marked ended, and its value written over its
    ///    default button's word: `DM_GETDEFID` answers 0 from now on
    ///    (`25b0`-`25b8`).
    /// 3. Where the dialog is the active window and the focus is in one of
    ///    its controls, the focus is taken back to the dialog itself
    ///    (`25bb`-`25d0`): the control is told now, and the dialog, ended,
    ///    gives it to no control. COMMDLG's hook hears `CBN_KILLFOCUS` after
    ///    `IDCANCEL` (`comboesc`).
    /// 4. The dialog is hidden, `SWP_HIDEWINDOW | SWP_NOACTIVATE |
    ///    SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE`, 97h (`25d5`-`25e3`);
    ///    hidden already, it is asked and not told.
    /// 5. Where it was the active window as `EndDialog` began, the owner is
    ///    made active as `ActivateWindow` makes a window active, disabled,
    ///    minimized or hidden as it may be (seg1 `38e4` with 1);
    ///    `DefWindowProc` or the dialog manager moves the focus there, and
    ///    where the owner refuses it, the focus left in the dialog is moved
    ///    to the owner all the same (seg1 `37a3`). With no owner, no window
    ///    is active and none has the focus, and nothing is told
    ///    (`260e`-`2631`) -- until the dialog is destroyed, which makes the
    ///    next window active (seg8 `0ba8`).
    ///
    /// Called again, it does all this again: the value is the last one
    /// given, and the dialog, hidden and not active, is only asked 97h once
    /// more.
    pub async fn end_dialog(&self, hwnd: u16, result: i16) -> Result<(), Stop> {
        // The task let go first, whoever locked it (`2579`).
        if self.system().window_named(hwnd).is_some() && self.system().dialog_of(hwnd).is_some() {
            self.system().lock_my_task_to(0);
        }

        let (index, was_active, mut owner, owner_was_disabled, sys_modal_before) = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let Some(state) = system.dialog_of(hwnd) else {
                return Ok(());
            };
            let window = system.shown_window(index);
            let owner = window.parent.or(window.owner);

            (
                index,
                system.active_top() == Some(index),
                owner.map_or(0, |owner| system.hwnd_of(owner)),
                state.owner_was_disabled,
                state.sys_modal_before,
            )
        };

        if owner != 0 && !owner_was_disabled && self.system().window_named(owner).is_some() {
            self.enable_window(owner, true).await?;
        }

        if let Some(state) = self.system().dialog_mut(hwnd) {
            state.ended = true;
            state.def_id = result as u16;
        }

        let take_back = {
            let system = self.system();
            let focus = system
                .focus
                .and_then(|focus| system.windows[focus].as_ref())
                .map_or(0, |window| window.hwnd);

            system.active_hwnd() == hwnd && focus != 0 && system.is_child_of(hwnd, focus)
        };

        if take_back {
            self.set_focus(hwnd).await?;
        }

        if self.system().window_named(hwnd) == Some(index) {
            self.position_raster(hwnd, index, 0, 0, 0, 0, 0, 0x97)
                .await?;
        }

        // System modal, it makes the window system modal before it so again
        // -- none, where that is gone -- and that window, not the owner, is
        // made active (`25e8`-`260b`). **Recorded** by `sysdlg`.
        if self.system().sys_modal_window() == hwnd {
            let before = if sys_modal_before != 0
                && self.system().window_named(sys_modal_before).is_some()
            {
                sys_modal_before
            } else {
                0
            };

            self.set_sys_modal(before).await?;

            if before != 0 {
                owner = before;
            }
        }

        if was_active && owner != 0 {
            let top = {
                let system = self.system();

                system
                    .window_named(owner)
                    .filter(|&top| system.shown_window(top).parent.is_none())
            };

            if let Some(top) = top {
                self.activate_window(top, false, true).await?;
            }
        } else {
            let mut system = self.system();

            if system.active_top() == Some(index) {
                system.leave_none_active(index, true);
            }
        }

        Ok(())
    }

    /// The dialog class's window procedure: the program's dialog procedure
    /// first, and what it leaves -- answering FALSE -- done here.
    #[allow(clippy::too_many_lines)]
    pub async fn def_dlg_proc(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let proc = self
            .system()
            .dialog_of(hwnd)
            .map(|state| state.proc.clone());

        if let Some(proc) = proc
            && proc != DialogProc::Guest(0)
        {
            let answer = match proc {
                // With AX the stack's segment, not the window's instance
                // (seg25 `0386`).
                DialogProc::Guest(far) => {
                    let stack = self.system().cpu.segments[winbox_cpu::SS].selector;

                    self.call_proc_as(&WndProc::Guest(far), stack, hwnd, message, wparam, lparam)
                        .await?
                }
                DialogProc::MessageBox(state) => {
                    Box::pin(state.answer(self, hwnd, message, wparam)).await?
                }
                DialogProc::About(about) => Box::pin(about.answer(self, hwnd, message)).await?,
                DialogProc::SeqWarning(warning) => {
                    Box::pin(warning.answer(self, hwnd, message, wparam)).await?
                }
            };

            if answer & 0xffff != 0 {
                // These answer with what the procedure returned; the rest
                // with what it left in the dialog's `DWL_MSGRESULT`.
                return Ok(match message {
                    WM_INITDIALOG | WM_CTLCOLOR | WM_COMPAREITEM | WM_VKEYTOITEM
                    | WM_CHARTOITEM | WM_QUERYDRAGICON => answer & 0xffff,
                    _ => {
                        let mut system = self.system();

                        match system.window_named(hwnd) {
                            Some(index) => {
                                crate::window_queries::window_long(&mut system, index, 0)
                            }
                            None => 0,
                        }
                    }
                });
            }
        }

        let value = match lparam {
            Param::Value(value) => *value,
            Param::Struct(_) => 0,
        };

        match message {
            WM_INITDIALOG => return Ok(0),
            // The background: the brush the dialog answers itself for
            // `CTLCOLOR_DLG`, asked with the device context being erased,
            // and `DefWindowProc`'s window colour when it answers none
            // (`dlgbrush`). FIBS/W answers grey.
            WM_ERASEBKGND => {
                let Some(index) = self.system().window_named(hwnd) else {
                    return Box::pin(self.def_window_proc(hwnd, message, wparam, lparam)).await;
                };
                let hdc = wparam;
                let lparam = u32::from(CTLCOLOR_DLG) << 16 | u32::from(hwnd);
                let mut brush = self
                    .send_message(hwnd, WM_CTLCOLOR, hdc, &mut Param::Value(lparam))
                    .await? as u16;
                let mut system = self.system();

                if !matches!(system.gdi_object_of(brush), Some((_, GdiObject::Brush(_)))) {
                    brush = system.default_control_colour(hdc, CTLCOLOR_DLG);
                }

                let colour = match system.gdi_object_of(brush) {
                    Some((_, GdiObject::Brush(brush))) => brush.color,
                    _ => [0, 0, 0, 0xff],
                };

                // A hollow brush erases nothing: SimTower answers
                // `NULL_BRUSH`, and Windows shows its title picture through
                // the corners its frame's lines leave undrawn. Otherwise the
                // client area is filled with the brush's colour.
                if colour[3] != 0 {
                    let colorref = u32::from(colour[0])
                        | u32::from(colour[1]) << 8
                        | u32::from(colour[2]) << 16;

                    system.erase(index, colorref, None, (0, 0));
                }

                return Ok(1);
            }
            // Activation (seg25 `050b`): the focus kept as the dialog loses
            // it and given back as it has it again; nothing for
            // `DefWindowProc`, which would give the dialog's own window the
            // focus.
            WM_ACTIVATE => {
                if wparam != 0 {
                    self.restore_focus(hwnd).await?;
                } else {
                    let kept = self.system().save_focus(hwnd);

                    // Every default push button made plain, from the
                    // control kept round (`03d3`, `0ab2`). **Recorded** by
                    // `dlgcode`.
                    if kept != 0 {
                        self.clear_def_push(hwnd, kept).await?;
                    }
                }

                return Ok(0);
            }
            // The focus given to the dialog's window (seg25 `0553`): to the
            // control kept, or else the first tab item -- unless the dialog
            // has ended.
            WM_SETFOCUS => {
                let live = self
                    .system()
                    .dialog_of(hwnd)
                    .is_some_and(|state| !state.ended);

                if live && !self.restore_focus(hwnd).await? {
                    let first = self.system().first_tab_item(hwnd);

                    if first != 0 {
                        self.dlg_set_focus(first).await?;
                    }
                }

                return Ok(0);
            }
            // Hidden, it keeps its focus first (seg25 `05ab`).
            WM_SHOWWINDOW if wparam == 0 => {
                let kept = self.system().save_focus(hwnd);

                if kept != 0 {
                    self.clear_def_push(hwnd, kept).await?;
                }
            }
            WM_SETFONT => {
                if let Some(state) = self.system().dialog_mut(hwnd) {
                    state.font = wparam;
                }

                return Ok(0);
            }
            WM_GETFONT => {
                return Ok(u32::from(
                    self.system().dialog_of(hwnd).map_or(0, |state| state.font),
                ));
            }
            // Closing a dialog is its Cancel button.
            WM_CLOSE => {
                let cancel = self.system().dlg_item(hwnd, IDCANCEL);
                let lparam = BN_CLICKED << 16 | u32::from(cancel);

                self.send_message(hwnd, WM_COMMAND, IDCANCEL, &mut Param::Value(lparam))
                    .await?;
                return Ok(0);
            }
            // Nought once the dialog has ended, its word holding
            // `EndDialog`'s value; a new default is not taken then (seg25
            // `06d7`, `06f0`; `enddlg`).
            DM_GETDEFID => {
                let id = self
                    .system()
                    .dialog_of(hwnd)
                    .filter(|state| !state.ended)
                    .map_or(0, |state| state.def_id);

                return Ok(if id == 0 {
                    0
                } else {
                    DC_HASDEFID << 16 | u32::from(id)
                });
            }
            // The default push button kept as it moves from the control of
            // the identifier before to the one given -- none for nought --
            // then the identifier taken (seg25 `06f0`-`0726`).
            DM_SETDEFID => {
                let live = {
                    let system = self.system();

                    system
                        .dialog_of(hwnd)
                        .filter(|state| !state.ended)
                        .map(|state| {
                            let before = if state.def_id != 0 {
                                system.dlg_item(hwnd, state.def_id)
                            } else {
                                0
                            };
                            let after = if wparam != 0 {
                                system.dlg_item(hwnd, wparam)
                            } else {
                                0
                            };

                            (before, after)
                        })
                };

                if let Some((before, after)) = live {
                    self.check_def_push(hwnd, before, after).await?;

                    if let Some(state) = self.system().dialog_mut(hwnd) {
                        state.def_id = wparam;
                    }
                }

                return Ok(1);
            }
            // Moves the focus (seg25 `05c8`): to the window `wParam` names
            // when lParam's low word says so; otherwise to the next tab
            // item, or the previous when `wParam` is nonzero -- or the first,
            // when nothing has the focus -- and not at all when the focus is
            // outside the dialog.
            WM_NEXTDLGCTL => {
                let (target, from) = {
                    let system = self.system();
                    let focus = system.focus;
                    let focus_hwnd = focus.map_or(0, |focus| system.shown_window(focus).hwnd);

                    if value & 0xffff != 0 {
                        (wparam, if focus_hwnd != 0 { focus_hwnd } else { hwnd })
                    } else if focus_hwnd == 0 {
                        (system.first_tab_item(hwnd), hwnd)
                    } else if !focus.is_some_and(|focus| system.in_dialog(hwnd, focus)) {
                        return Ok(1);
                    } else {
                        (
                            system.next_tab_item(hwnd, focus_hwnd, wparam != 0),
                            focus_hwnd,
                        )
                    }
                };

                // And the default push button kept as it moves
                // (`060b`-`0615`).
                if target != 0 {
                    self.dlg_set_focus(target).await?;
                    self.check_def_push(hwnd, from, target).await?;
                }

                return Ok(1);
            }
            _ => {}
        }

        Box::pin(self.def_window_proc(hwnd, message, wparam, lparam)).await
    }

    /// The focus given back (seg25 `03e3`): to the control kept, if there
    /// is one, it is still a window and the dialog is not minimized.
    /// Whether it was; the control is kept no longer either way.
    async fn restore_focus(&self, hwnd: u16) -> Result<bool, Stop> {
        let saved = {
            let mut system = self.system();
            let minimized = system
                .window_named(hwnd)
                .is_some_and(|index| system.shown_window(index).placement == Placement::Minimized);
            let Some(state) = system.dialog_mut(hwnd) else {
                return Ok(false);
            };
            let saved = state.saved_focus;

            if saved == 0 || minimized {
                return Ok(false);
            }

            state.saved_focus = 0;

            if system.window_named(saved).is_none() {
                return Ok(false);
            }

            saved
        };

        // The default push button kept as the focus goes back
        // (`0404`-`040c`).
        let focus = {
            let system = self.system();

            system
                .focus
                .map_or(0, |focus| system.shown_window(focus).hwnd)
        };

        self.check_def_push(hwnd, focus, saved).await?;
        self.set_focus(saved).await?;
        Ok(true)
    }

    /// What the window with the focus tells the dialog manager it wants,
    /// asked with the message being taken, as a far pointer to it
    /// (`USER.EXE` seg25 `0cae`, `0ebc`) -- a multi-line edit control
    /// learns so that it is in a dialog -- or with none; nought with no
    /// focus.
    async fn focus_code(
        &self,
        focus: u16,
        wparam: u16,
        message: Option<&Message>,
    ) -> Result<u32, Stop> {
        if focus == 0 {
            return Ok(0);
        }

        let mut lparam = message.map_or(Param::Value(0), |message| Param::Struct(message.bytes()));

        self.send_message(focus, WM_GETDLGCODE, wparam, &mut lparam)
            .await
    }

    /// The dialog manager moving the focus (`USER.EXE` seg25 `0000`): a
    /// control that asks for it (`DLGC_HASSETSEL`) has all its text
    /// selected first, then takes the focus. The end is 0xFFFE for a
    /// program made for Windows 3 or later and 0x7FFF for an older one.
    pub async fn dlg_set_focus(&self, hwnd: u16) -> Result<u16, Stop> {
        let code = self
            .send_message(hwnd, WM_GETDLGCODE, 0, &mut Param::Value(0))
            .await?;

        if code & DLGC_HASSETSEL != 0 {
            let version = {
                let mut system = self.system();
                let instance = system
                    .window_named(hwnd)
                    .map_or(0, |index| system.shown_window(index).instance);

                system.expected_windows_version(instance).unwrap_or(0x300)
            };
            let end: u32 = if version >= 0x300 {
                0xfffe_0000
            } else {
                0x7fff_0000
            };

            self.send_message(hwnd, EM_SETSEL, 0, &mut Param::Value(end))
                .await?;
        }

        self.set_focus(hwnd).await
    }

    /// A control asked what it is, with nought.
    async fn dialog_code(&self, hwnd: u16) -> Result<u32, Stop> {
        self.send_message(hwnd, WM_GETDLGCODE, 0, &mut Param::Value(0))
            .await
    }

    /// The dialog's default push button kept as the focus moves from `old`
    /// to `to` (`USER.EXE` seg25 `0b5b`), each asked with `WM_GETDLGCODE`,
    /// `to` first:
    ///
    /// * The same window: made the default if it answers
    ///   `DLGC_UNDEFPUSHBUTTON`; nothing else.
    /// * Otherwise, where either is a push button -- `old` asked first, `to`
    ///   only if `old` is not -- every control that answers
    ///   `DLGC_DEFPUSHBUTTON` is made plain (`0ab2`).
    /// * Then `to`, if it answers `DLGC_UNDEFPUSHBUTTON`, is made the
    ///   default; otherwise the control `DM_GETDEFID` names -- 1 where the
    ///   dialog answers none -- if it answers `DLGC_UNDEFPUSHBUTTON` and not
    ///   `DLGC_DEFPUSHBUTTON`, and is not disabled.
    ///
    /// **Recorded** by `defpush` and `dlgcode`.
    pub(crate) async fn check_def_push(&self, hwnd: u16, old: u16, to: u16) -> Result<(), Stop> {
        let push = DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON;
        let code = if to != 0 {
            self.dialog_code(to).await?
        } else {
            0
        };

        if old == to {
            if code & DLGC_UNDEFPUSHBUTTON != 0 {
                self.send_message(to, BM_SETSTYLE, BS_DEFPUSHBUTTON, &mut Param::Value(1))
                    .await?;
            }

            return Ok(());
        }

        let old_push = old != 0 && self.dialog_code(old).await? & push != 0;

        if old_push || (to != 0 && code & push != 0) {
            self.clear_def_push(hwnd, to).await?;
        }

        if code & DLGC_UNDEFPUSHBUTTON != 0 {
            self.send_message(to, BM_SETSTYLE, BS_DEFPUSHBUTTON, &mut Param::Value(1))
                .await?;
            return Ok(());
        }

        let answer = self
            .send_message(hwnd, DM_GETDEFID, 0, &mut Param::Value(0))
            .await?;
        let id = if answer >> 16 == DC_HASDEFID {
            (answer & 0xffff) as u16
        } else {
            1
        };
        let button = self.system().dlg_item(hwnd, id);

        if button != 0 {
            let its = self.dialog_code(button).await?;

            if its & DLGC_DEFPUSHBUTTON == 0
                && its & DLGC_UNDEFPUSHBUTTON != 0
                && self.system().style_of(button) & WS_DISABLED == 0
            {
                self.send_message(button, BM_SETSTYLE, BS_DEFPUSHBUTTON, &mut Param::Value(1))
                    .await?;
            }
        }

        Ok(())
    }

    /// Every control that answers `DLGC_DEFPUSHBUTTON` made plain with
    /// `BM_SETSTYLE` (`USER.EXE` seg25 `0ab2`): each child asked, from the
    /// control `from` is in -- the first child for none -- round to it.
    async fn clear_def_push(&self, hwnd: u16, from: u16) -> Result<(), Stop> {
        let start = {
            let system = self.system();
            let control = if from != 0 {
                system.child_control(hwnd, from)
            } else {
                0
            };

            if control != 0 {
                control
            } else {
                system.next_child(hwnd, 0)
            }
        };

        if start == 0 {
            return Ok(());
        }

        let mut at = start;

        loop {
            if self.dialog_code(at).await? & DLGC_DEFPUSHBUTTON != 0 {
                self.send_message(at, BM_SETSTYLE, BS_PUSHBUTTON, &mut Param::Value(1))
                    .await?;
            }

            at = self.system().next_child(hwnd, at);

            if at == 0 || at == start {
                return Ok(());
            }
        }
    }

    /// The focus given by the dialog manager to a button it is about to
    /// click itself, marked so for the moment (`USER.EXE` seg19
    /// `0233`-`023d`, seg25 `0dcc`-`0dd6`): a radio button so gaining it
    /// does not tell its parent it was clicked.
    async fn marked_focus(&self, hwnd: u16) -> Result<(), Stop> {
        let mark = |on: bool| {
            let mut system = self.system();

            if let Some(index) = system.window_named(hwnd)
                && let Some(control) = system.windows[index]
                    .as_mut()
                    .and_then(|window| window.control.as_mut())
            {
                if on {
                    control.state |= DIALOG_FOCUS;
                } else {
                    control.state &= !DIALOG_FOCUS;
                }
            }
        };

        mark(true);
        self.dlg_set_focus(hwnd).await?;
        mark(false);
        Ok(())
    }

    /// Whether a control names the character as its mnemonic: asked with
    /// `WM_GETDLGCODE` and nought, one that wants characters is passed
    /// over, and so is static text with `SS_NOPREFIX`; the others' text is
    /// looked at (seg19 `00dc`-`0122`).
    async fn names_mnemonic(&self, control: u16, letter: u8) -> Result<bool, Stop> {
        let code = self.dialog_code(control).await?;

        if code & DLGC_WANTCHARS != 0 {
            return Ok(false);
        }

        let system = self.system();

        if code & DLGC_STATIC != 0 && system.style_of(control) & SS_NOPREFIX != 0 {
            return Ok(false);
        }

        Ok(has_mnemonic(&system.control_text(control), letter))
    }

    /// The control a character names, from the control `from` is in
    /// (`USER.EXE` seg19 `00a5`): first round its group with
    /// `GetNextDlgGroupItem`, up to sixty, back to `from`; then round all
    /// the dialog's children from it. None, nought.
    async fn find_mnemonic(&self, hwnd: u16, from: u16, letter: u8) -> Result<u16, Stop> {
        let mut at = self.system().child_control(hwnd, from);

        for _ in 0..60 {
            let next = self.system().next_group_item(hwnd, at, false);

            if next == 0 || next == from {
                break;
            }

            at = next;

            if self.names_mnemonic(next, letter).await? {
                return Ok(next);
            }
        }

        let start = self.system().child_control(hwnd, from);

        at = start;

        loop {
            at = self.system().next_child(hwnd, at);

            if at == 0 {
                return Ok(0);
            }

            if self.names_mnemonic(at, letter).await? {
                return Ok(at);
            }

            if at == start {
                return Ok(0);
            }
        }
    }

    /// The control a character names, taken (`USER.EXE` seg19
    /// `01a5`-`02a0`): nought where none is found; 1 for a push button;
    /// else the control.
    ///
    /// * Static text named gives way to the next tab item after it, unless
    ///   it is disabled; a disabled control is passed over for the next
    ///   named, until the first disabled one comes round again.
    /// * A push button is pressed and let go with `BM_SETSTATE`, and its
    ///   parent sent `WM_COMMAND` with `BN_CLICKED`; the focus stays where
    ///   it was.
    /// * A button of another kind is given the focus marked as the dialog
    ///   manager's, then clicked with 463h where no other control has the
    ///   mnemonic.
    /// * Anything else is given the focus.
    ///
    /// **Recorded** by `syschar` and `dlgcode`.
    async fn take_mnemonic(&self, hwnd: u16, from: u16, letter: u8) -> Result<u16, Stop> {
        let mut at = from;
        let mut first_disabled = 0;
        let mut code = 0;
        let mut found = false;

        for _ in 0..0x200 {
            at = self.find_mnemonic(hwnd, at, letter).await?;

            if at == 0 {
                return Ok(0);
            }

            code = self.dialog_code(at).await?;

            if code & DLGC_STATIC != 0 && self.system().style_of(at) & WS_DISABLED == 0 {
                at = self.system().next_tab_item(hwnd, at, false);
                code = self.dialog_code(at).await?;
            }

            if self.system().style_of(at) & WS_DISABLED == 0 {
                found = true;
                break;
            }

            if first_disabled == at {
                return Ok(0);
            }

            if first_disabled == 0 {
                first_disabled = at;
            }
        }

        if !found {
            return Ok(0);
        }

        if code & DLGC_BUTTON == 0 {
            self.dlg_set_focus(at).await?;
            return Ok(at);
        }

        if code & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON) != 0 {
            self.send_message(at, BM_SETSTATE, 1, &mut Param::Value(0))
                .await?;
            self.send_message(at, BM_SETSTATE, 0, &mut Param::Value(0))
                .await?;

            let (parent, id) = {
                let system = self.system();

                system.window_named(at).map_or((0, 0), |index| {
                    let window = system.shown_window(index);

                    (
                        window.parent.map_or(0, |parent| system.hwnd_of(parent)),
                        window.control_id,
                    )
                })
            };

            if parent != 0 {
                self.send_message(parent, WM_COMMAND, id, &mut Param::Value(u32::from(at)))
                    .await?;
            }

            return Ok(1);
        }

        self.marked_focus(at).await?;

        if self.find_mnemonic(hwnd, at, letter).await? == at {
            self.send_message(at, BM_CLICK, 1, &mut Param::Value(0))
                .await?;
        }

        Ok(at)
    }

    /// The command of Enter or Escape (seg25 `0d6b`, `0e3a`): `WM_COMMAND`
    /// to the dialog with the control of that identifier -- none, where it
    /// has none -- or a beep for a control disabled.
    async fn dialog_command(&self, hwnd: u16, id: u16) -> Result<bool, Stop> {
        let (button, disabled) = {
            let system = self.system();
            let button = system.dlg_item(hwnd, id);

            (
                button,
                button != 0 && system.style_of(button) & WS_DISABLED != 0,
            )
        };

        if disabled {
            crate::mmsystem::sound::beep(self, 0).await?;
            return Ok(true);
        }

        self.send_message(hwnd, WM_COMMAND, id, &mut Param::Value(u32::from(button)))
            .await?;
        Ok(true)
    }

    /// A message handed to a dialog: the keys and characters it takes
    /// itself, and the rest dispatched (`USER.EXE` seg25 `0c23`, behind the
    /// checks at `2804`). TRUE for every message it takes or dispatches;
    /// FALSE for one not for the dialog or a window inside it.
    ///
    /// * The message filters first, with `MSGF_DIALOGBOX`, as
    ///   `CallMsgFilter` calls them (`0c38`): a message a filter takes is
    ///   answered TRUE, and nothing more is done. **Recorded** by
    ///   `dlgcode`: a filter is called with every message handed over, one
    ///   for a window outside the dialog too, in a program's own loop as in
    ///   `DialogBox`'s.
    /// * `WM_KEYDOWN`, `WM_CHAR` and `WM_SYSCHAR` as below; a press of the
    ///   left button on a control keeps the default push button as the
    ///   focus would move to it, then is dispatched (`0e98`); anything else
    ///   is dispatched.
    #[allow(clippy::too_many_lines)]
    pub async fn is_dialog_message(&self, hwnd: u16, message: &Message) -> Result<bool, Stop> {
        if self.system().window_named(hwnd).is_none() {
            return Ok(false);
        }

        if self.call_msg_filter(message, MSGF_DIALOGBOX).await? {
            return Ok(true);
        }

        // Only messages for the dialog or a window in it.
        {
            let system = self.system();
            let (Some(dialog), Some(target)) =
                (system.window_named(hwnd), system.window_named(message.hwnd))
            else {
                return Ok(false);
            };
            let mut at = Some(target);
            let mut inside = false;

            while let Some(window) = at {
                if window == dialog {
                    inside = true;
                }

                at = system.shown_window(window).parent;
            }

            if !inside {
                return Ok(false);
            }
        }

        let focus = || {
            let system = self.system();

            system
                .focus
                .map_or(0, |focus| system.shown_window(focus).hwnd)
        };
        let target = message.hwnd;

        if message.message == WM_KEYDOWN {
            let code = self
                .focus_code(target, message.wparam, Some(message))
                .await?;

            if code & DLGC_WANTALLKEYS != 0 {
                self.system().translate(message);
                self.dispatch(message).await?;
                return Ok(true);
            }

            match message.wparam {
                // Tab, Shift held or not: the next tab item or the one
                // before (`0d03`-`0d2a`).
                VK_TAB if code & DLGC_WANTTAB == 0 => {
                    let next = {
                        let system = self.system();
                        let shift =
                            crate::user_misc::key_state(&system, VK_SHIFT as u16) & 0x8000 != 0;

                        system.next_tab_item(hwnd, target, shift)
                    };

                    self.dlg_set_focus(next).await?;
                    self.check_def_push(hwnd, target, next).await?;
                    return Ok(true);
                }
                // Enter, or Execute: the focus's own identifier where it
                // answers `DLGC_DEFPUSHBUTTON`, else what `DM_GETDEFID`
                // answers, else `IDOK` (`0d2d`-`0d68`).
                VK_RETURN | VK_EXECUTE => {
                    let focused = focus();
                    let its = if focused != 0 {
                        self.dialog_code(focused).await?
                    } else {
                        0
                    };
                    let id = if its & DLGC_DEFPUSHBUTTON != 0 {
                        let system = self.system();

                        system
                            .window_named(focused)
                            .map_or(0, |index| system.shown_window(index).control_id)
                    } else {
                        let answer = self
                            .send_message(hwnd, DM_GETDEFID, 0, &mut Param::Value(0))
                            .await?;

                        if answer >> 16 == DC_HASDEFID {
                            (answer & 0xffff) as u16
                        } else {
                            IDOK
                        }
                    };

                    return self.dialog_command(hwnd, id).await;
                }
                // Escape, or Ctrl and Break: `IDCANCEL` (`0d6b`).
                VK_ESCAPE | VK_CANCEL => return self.dialog_command(hwnd, IDCANCEL).await,
                // An arrow: the next control of the group, or the one
                // before (`0d92`-`0e38`).
                VK_LEFT | VK_UP | VK_RIGHT | VK_DOWN if code & DLGC_WANTARROWS == 0 => {
                    let previous = message.wparam == VK_LEFT || message.wparam == VK_UP;
                    let next = self.system().next_group_item(hwnd, target, previous);
                    let mut lparam = Param::Struct(message.bytes());
                    let its = self
                        .send_message(next, WM_GETDLGCODE, message.wparam, &mut lparam)
                        .await?;

                    // A push button is given the focus marked as the dialog
                    // manager's, as for a mnemonic.
                    if its & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON) != 0 {
                        self.marked_focus(next).await?;
                        self.check_def_push(hwnd, target, next).await?;
                        return Ok(true);
                    }

                    // A radio button: and an automatic one unchecked is
                    // clicked, with 463h (`0de6`-`0e27`). **Recorded** by
                    // `dlgcode`.
                    if its & DLGC_RADIOBUTTON != 0 {
                        self.dlg_set_focus(next).await?;
                        self.check_def_push(hwnd, target, next).await?;

                        let automatic = self.system().style_of(next) & 0xdf == BS_AUTORADIOBUTTON;

                        if automatic
                            && self
                                .send_message(next, BM_GETCHECK, 0, &mut Param::Value(0))
                                .await?
                                == 0
                        {
                            self.send_message(next, BM_CLICK, 1, &mut Param::Value(0))
                                .await?;
                        }

                        return Ok(true);
                    }

                    // Static text is not moved to.
                    if its & DLGC_STATIC != 0 {
                        return Ok(true);
                    }

                    self.dlg_set_focus(next).await?;
                    self.check_def_push(hwnd, target, next).await?;
                    return Ok(true);
                }
                _ => {}
            }

            self.system().translate(message);
            self.dispatch(message).await?;
            return Ok(true);
        }

        // A press on a control: the default push button kept as the focus
        // would move to it, then the press dispatched (`0e98`-`0eb1`).
        if message.message == WM_LBUTTONDOWN {
            let focused = focus();

            if target != hwnd && focused != 0 {
                self.check_def_push(hwnd, focused, target).await?;
            }

            self.system().translate(message);
            self.dispatch(message).await?;
            return Ok(true);
        }

        // `WM_SYSCHAR` (`0e48`-`0e78`): with no window focused, and Alt up
        // by the keyboard's state (`GetKeyState`, not the message), a beep --
        // or, for Enter in a dialog minimized, `DefWindowProc`'s -- and
        // nothing more; Alt and Space is the dialog's own `DefWindowProc`'s,
        // for its system menu; anything else a mnemonic, as a character is.
        // **Recorded** by `syschar`.
        if message.message == WM_SYSCHAR {
            if focus() == 0 {
                let (alt, minimized) = {
                    let system = self.system();
                    let minimized = system.window_named(hwnd).is_some_and(|index| {
                        system.shown_window(index).placement == Placement::Minimized
                    });

                    (
                        crate::user_misc::key_state(&system, VK_MENU) & 0x8000 != 0,
                        minimized,
                    )
                };

                if !alt {
                    if message.wparam == VK_RETURN && minimized {
                        self.def_window_proc(
                            hwnd,
                            WM_SYSCHAR,
                            message.wparam,
                            &mut Param::Value(message.lparam),
                        )
                        .await?;
                    } else {
                        crate::mmsystem::sound::beep(self, 0).await?;
                    }

                    return Ok(true);
                }
            }

            if message.wparam == 0x20 {
                self.def_window_proc(hwnd, WM_SYSCHAR, 0x20, &mut Param::Value(message.lparam))
                    .await?;
                return Ok(true);
            }
        }

        // A character (`0eb4`-`0f2b`): one for the dialog itself is taken
        // and nothing done; one the window it is for wants, asked with the
        // message, is its own; a space is taken; then the control the
        // character names (seg19 `01a5`). Named by none, it is the window's
        // own where it wants every key; Alt's is the dialog's
        // `DefWindowProc`'s, which opens its system menu's loop for the
        // letter; a plain character beeps. A control it names that is not
        // a push button has the default push button kept as the focus moved
        // to it. **Recorded** by `syschar` and `dlgcode`.
        if message.message == WM_SYSCHAR || message.message == WM_CHAR {
            if target == hwnd {
                return Ok(true);
            }

            let code = self
                .focus_code(target, message.wparam, Some(message))
                .await?;

            if message.message == WM_CHAR && code & (DLGC_WANTCHARS | DLGC_WANTALLKEYS) != 0 {
                self.system().translate(message);
                self.dispatch(message).await?;
                return Ok(true);
            }

            if message.wparam & 0xff == 0x20 {
                return Ok(true);
            }

            let taken = self
                .take_mnemonic(hwnd, target, (message.wparam & 0xff) as u8)
                .await?;

            if taken == 0 {
                if code & DLGC_WANTALLKEYS != 0 {
                    self.system().translate(message);
                    self.dispatch(message).await?;
                    return Ok(true);
                }

                if message.message == WM_SYSCHAR {
                    self.def_window_proc(
                        hwnd,
                        WM_SYSCHAR,
                        message.wparam,
                        &mut Param::Value(message.lparam),
                    )
                    .await?;
                } else {
                    crate::mmsystem::sound::beep(self, 0).await?;
                }

                return Ok(true);
            }

            if taken != 1 {
                self.check_def_push(hwnd, target, taken).await?;
            }

            return Ok(true);
        }

        self.system().translate(message);
        self.dispatch(message).await?;
        Ok(true)
    }
}

/// Whether a control's text has the character as its mnemonic (`USER.EXE`
/// seg19 `0000`, with no first-letter match and a prefix looked for):
/// spaces at its start skipped, then the first `&` not doubled -- a doubled
/// one passed over -- and the character after it, both made capitals.
fn has_mnemonic(text: &[u8], letter: u8) -> bool {
    let upper = crate::user_misc::ansi_upper_byte;
    let wanted = upper(letter);
    let mut at = 0;

    while text.get(at) == Some(&b' ') {
        at += 1;
    }

    while at < text.len() {
        let one = text[at];

        at += 1;

        if one != b'&' {
            continue;
        }

        if text.get(at) == Some(&b'&') {
            at += 1;
            continue;
        }

        return text.get(at).is_some_and(|&next| upper(next) == wanted);
    }

    false
}

/// A dialog made from a module's template, modeless: its window.
pub fn create_dialog_param(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Resource, true, false)
}

pub fn create_dialog(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Resource, false, false)
}

pub fn create_dialog_indirect_param(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Memory, true, false)
}

pub fn create_dialog_indirect(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Memory, false, false)
}

pub fn dialog_box_param(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Resource, true, true)
}

pub fn dialog_box(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Resource, false, true)
}

pub fn dialog_box_indirect_param(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Handle, true, true)
}

pub fn dialog_box_indirect(engine: &Engine, mut args: Args) -> Later<'_> {
    dialog_call(engine, &mut args, Source::Handle, false, true)
}

/// Where a dialog's template is: a module's resource by name, a far
/// address, or -- `DialogBoxIndirect`'s -- a global memory handle.
#[derive(Clone, Copy)]
enum Source {
    Resource,
    Memory,
    Handle,
}

/// The eight ways to make a dialog: a modal one answers what `EndDialog`
/// was given, or -1 with no template; a modeless one its window.
fn dialog_call<'a>(
    engine: &'a Engine,
    args: &mut Args,
    source: Source,
    with_param: bool,
    modal: bool,
) -> Later<'a> {
    let (instance, template, owner, proc, param) = {
        let mut system = engine.system();
        let instance = args.word(&system);
        let template = match source {
            Source::Resource => {
                let far = args.dword(&system);

                MenuName::read(&system, far)
                    .and_then(|name| system.resource_template(instance, &name))
            }
            Source::Memory => {
                let far = args.dword(&system);

                Some(system.memory_template(far))
            }
            Source::Handle => {
                let handle = args.word(&system);

                Some(system.memory_template(u32::from(handle | 1) << 16))
            }
        };
        let owner = args.word(&system);
        let proc = args.dword(&system);
        let param = if with_param { args.dword(&system) } else { 0 };

        (instance, template, owner, proc, param)
    };

    Box::pin(async move {
        let Some(template) = template else {
            return Ok(Answer::Word(if modal { 0xffff } else { 0 }));
        };
        let (owner, owner_was_disabled, owner_was_active) = if modal {
            engine.begin_modal(owner).await?
        } else {
            (owner, false, false)
        };
        let hwnd = engine
            .create_dialog(
                instance,
                &template,
                owner,
                DialogProc::Guest(proc),
                param,
                modal,
            )
            .await?;

        if !modal {
            return Ok(Answer::Word(hwnd));
        }

        Ok(Answer::Word(
            engine
                .run_modal(hwnd, owner, owner_was_disabled, owner_was_active)
                .await? as u16,
        ))
    })
}

pub fn end_dialog(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, result) = {
            let system = engine.system();

            (args.word(&system), args.signed(&system))
        };

        engine.end_dialog(hwnd, result).await?;
        Ok(Answer::Nothing)
    })
}

pub fn def_dlg_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };
        let answer = engine
            .def_dlg_proc(hwnd, message, wparam, &mut Param::Value(lparam))
            .await?;

        Ok(Answer::Dword(answer))
    })
}

pub fn is_dialog_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let far = args.dword(&system);

            (hwnd, Message::read(&system, far))
        };

        Ok(Answer::Word(u16::from(
            engine.is_dialog_message(hwnd, &message).await?,
        )))
    })
}

pub fn get_next_dlg_tab_item(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let control = args.word(system);
    let previous = args.word(system) != 0;

    Ok(Answer::Word(system.next_tab_item(hwnd, control, previous)))
}

pub fn get_next_dlg_group_item(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let control = args.word(system);
    let previous = args.word(system) != 0;

    Ok(Answer::Word(
        system.next_group_item(hwnd, control, previous),
    ))
}

/// A child's identifier, nought for a handle that is no window.
pub fn get_dlg_ctrl_id(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let id = system
        .window_named(hwnd)
        .map_or(0, |index| system.shown_window(index).control_id);

    Ok(Answer::Word(id))
}

/// A window's child by the identifier it was made with; nought for none.
pub fn get_dlg_item(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let id = args.word(system);

    Ok(Answer::Word(system.dlg_item(hwnd, id)))
}

/// Dialog units into pixels, in a dialog's own units.
pub fn map_dialog_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let base = match system.dialog_of(hwnd) {
        Some(state) => state.base,
        None => system.system_base_units()?,
    };
    let bytes = system.read_far(far, 8);
    let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 2 - 1]]));
    let mapped = [
        mul_div(word(0), base.0, 4),
        mul_div(word(2), base.1, 8),
        mul_div(word(4), base.0, 4),
        mul_div(word(6), base.1, 8),
    ];
    let out: Vec<u8> = mapped
        .iter()
        .flat_map(|&value| (value as i16).to_le_bytes())
        .collect();

    system.write_far(far, &out);
    Ok(Answer::Nothing)
}

/// A message sent to a dialog's control by its identifier; nought for no
/// such control.
pub fn send_dlg_item_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();
            let dialog = args.word(&system);
            let id = args.word(&system);
            let message = args.word(&system);
            let wparam = args.word(&system);
            let lparam = args.dword(&system);

            (system.dlg_item(dialog, id), message, wparam, lparam)
        };

        if hwnd == 0 {
            return Ok(Answer::Dword(0));
        }

        Ok(Answer::Dword(
            engine
                .send_message(hwnd, message, wparam, &mut Param::Value(lparam))
                .await?,
        ))
    })
}

/// A message to a dialog's control by its identifier, as the item calls
/// send it: nought for no such control.
async fn send_item(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: &mut Param,
) -> Result<u32, Stop> {
    let hwnd = engine.system().dlg_item(dialog, id);

    if hwnd == 0 {
        return Ok(0);
    }

    engine.send_message(hwnd, message, wparam, lparam).await
}

pub fn set_dlg_item_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, id, far) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.dword(&system))
        };

        send_item(engine, dialog, id, WM_SETTEXT, 0, &mut Param::Value(far)).await?;
        Ok(Answer::Nothing)
    })
}

pub fn get_dlg_item_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, id, far, size) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.word(&system),
            )
        };
        let answer =
            send_item(engine, dialog, id, WM_GETTEXT, size, &mut Param::Value(far)).await?;

        Ok(Answer::Word(answer as u16))
    })
}

/// A number as a control's text, in decimal, signed when asked.
pub fn set_dlg_item_int(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, id, value, signed) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.word(&system) != 0,
            )
        };
        let text = if signed {
            (value as i16).to_string()
        } else {
            value.to_string()
        };
        let mut bytes = text.into_bytes();

        bytes.push(0);
        send_item(engine, dialog, id, WM_SETTEXT, 0, &mut Param::Struct(bytes)).await?;
        Ok(Answer::Nothing)
    })
}

/// A control's text as a number, as `USER.EXE` reads it (seg25 `0233`):
/// asked for with `WM_GETTEXT`, 31 characters at most, as
/// `GetDlgItemText` asks (`00d4`) -- so a combo box answers with its edit
/// control's -- then spaces skipped, a minus sign where signed, and digits
/// up to the first that is not one. The flag says a number was read with
/// nothing after it; the digits read are answered either way, negated after
/// the sign. No text, or a number too big for a word (or for 7FFFh,
/// signed), answers nought and says so.
pub fn get_dlg_item_int(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, id, translated, signed) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.word(&system) != 0,
            )
        };
        let flag = |value: u16| {
            if translated != 0 {
                engine.system().write_far(translated, &value.to_le_bytes());
            }
        };

        flag(0);

        let mut text = Param::Struct(vec![0; 32]);

        if send_item(engine, dialog, id, WM_GETTEXT, 0x1f, &mut text).await? == 0 {
            return Ok(Answer::Word(0));
        }

        let Param::Struct(bytes) = text else {
            return Ok(Answer::Word(0));
        };
        let mut at = bytes.iter().take_while(|&&byte| byte == b' ').count();
        let negative = signed && bytes.get(at) == Some(&b'-');

        at += usize::from(negative);

        let mut value: u16 = 0;
        let mut digits = false;

        loop {
            let byte = bytes.get(at).copied().unwrap_or(0);

            at += 1;

            if !byte.is_ascii_digit() {
                if byte == 0 && digits {
                    flag(1);
                }

                break;
            }

            digits = true;

            if value > 0x1999 || (value == 0x1999 && byte > b'5') {
                return Ok(Answer::Word(0));
            }

            value = value * 10 + u16::from(byte - b'0');

            if signed && value > 0x7fff {
                return Ok(Answer::Word(0));
            }
        }

        Ok(Answer::Word(if negative {
            value.wrapping_neg()
        } else {
            value
        }))
    })
}

pub fn check_dlg_button(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, id, check) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.word(&system))
        };

        send_item(engine, dialog, id, BM_SETCHECK, check, &mut Param::Value(0)).await?;
        Ok(Answer::Nothing)
    })
}

pub fn is_dlg_button_checked(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, id) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };
        let answer = send_item(engine, dialog, id, BM_GETCHECK, 0, &mut Param::Value(0)).await?;

        Ok(Answer::Word(answer as u16))
    })
}

/// One radio button checked in a range of identifiers, the others cleared.
pub fn check_radio_button(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, first, last, check) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.word(&system),
            )
        };

        for id in first..=last {
            send_item(
                engine,
                dialog,
                id,
                BM_SETCHECK,
                u16::from(id == check),
                &mut Param::Value(0),
            )
            .await?;
        }

        Ok(Answer::Nothing)
    })
}

/// USER's dialog calls.
pub fn implementation(name: &str) -> Option<crate::call::Implementation> {
    use crate::call::Implementation::{Async, Sync};

    Some(match name {
        "CreateDialog" => Async(create_dialog),
        "CreateDialogParam" => Async(create_dialog_param),
        "CreateDialogIndirect" => Async(create_dialog_indirect),
        "CreateDialogIndirectParam" => Async(create_dialog_indirect_param),
        "DialogBox" => Async(dialog_box),
        "DialogBoxParam" => Async(dialog_box_param),
        "DialogBoxIndirect" => Async(dialog_box_indirect),
        "DialogBoxIndirectParam" => Async(dialog_box_indirect_param),
        "EndDialog" => Async(end_dialog),
        "DefDlgProc" => Async(def_dlg_proc),
        "IsDialogMessage" => Async(is_dialog_message),
        "GetNextDlgTabItem" => Sync(get_next_dlg_tab_item),
        "GetNextDlgGroupItem" => Sync(get_next_dlg_group_item),
        "GetDlgCtrlId" => Sync(get_dlg_ctrl_id),
        "GetDlgItem" => Sync(get_dlg_item),
        "MapDialogRect" => Sync(map_dialog_rect),
        "SendDlgItemMessage" => Async(send_dlg_item_message),
        "SetDlgItemText" => Async(set_dlg_item_text),
        "GetDlgItemText" => Async(get_dlg_item_text),
        "SetDlgItemInt" => Async(set_dlg_item_int),
        "GetDlgItemInt" => Async(get_dlg_item_int),
        "CheckDlgButton" => Async(check_dlg_button),
        "IsDlgButtonChecked" => Async(is_dlg_button_checked),
        "CheckRadioButton" => Async(check_radio_button),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_rounds_half_away_from_nought() {
        assert_eq!(mul_div(90, 10, 8), 113);
        assert_eq!(mul_div(-3, 5, 2), -8);
        assert_eq!(mul_div(1, 1, 0), 32767);
        assert_eq!(mul_div(-1, 1, 0), -32768);
        assert_eq!(mul_div(30000, 30000, 1), 32767);
    }
}
