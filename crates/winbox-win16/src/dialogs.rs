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

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const BN_CLICKED: u32 = 0;

const VK_TAB: u16 = 0x09;
const VK_RETURN: u16 = 0x0d;
const VK_SHIFT: usize = 0x10;
const VK_ESCAPE: u16 = 0x1b;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;

const SW_HIDE: u16 = 0;
const SW_SHOWNORMAL: u16 = 1;

/// A dialog's own message filter code.
const MSGF_DIALOGBOX: i16 = 0;

const RT_DIALOG: u16 = 5;

/// What USER keeps of a dialog beside its window.
#[derive(Debug, Clone, Default)]
pub struct DialogState {
    /// The program's dialog procedure, a far address.
    pub proc: u32,
    /// The dialog font's handle; nought for the System font.
    pub font: u16,
    pub base: (i32, i32),
    pub modal: bool,
    pub ended: bool,
    pub result: i16,
    pub def_id: u16,
    /// The control that had the focus as the dialog lost the activation,
    /// to have it again.
    pub saved_focus: u16,
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
    fn system_base_units(&mut self) -> Result<(i32, i32), Stop> {
        let units = crate::gdi::text::get_dialog_base_units(self)?;

        Ok(((units & 0xffff) as i32, (units >> 16) as i32))
    }

    /// A dialog's controls, in the order they were made.
    fn controls_of(&self, hwnd: u16) -> Vec<usize> {
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

    fn dlg_item(&self, hwnd: u16, id: u16) -> u16 {
        self.controls_of(hwnd)
            .into_iter()
            .find(|&child| self.shown_window(child).control_id == id)
            .map_or(0, |child| self.shown_window(child).hwnd)
    }

    /// The dialog's default button: set with `DM_SETDEFID`, else the
    /// default push button, else none.
    fn default_id(&self, hwnd: u16) -> u16 {
        if let Some(state) = self.dialog_of(hwnd)
            && state.def_id != 0
        {
            return state.def_id;
        }

        self.controls_of(hwnd)
            .into_iter()
            .find(|&child| {
                let window = self.shown_window(child);

                window
                    .control
                    .as_ref()
                    .is_some_and(|control| control.class_name == "BUTTON")
                    && window.style & 0x0f == 1
            })
            .map_or(0, |child| self.shown_window(child).control_id)
    }

    fn takes_focus(&self, index: usize) -> bool {
        let window = self.shown_window(index);

        window.visible && window.style & WS_DISABLED == 0
    }

    /// A push button, default or not.
    fn is_push(&self, index: usize) -> bool {
        let window = self.shown_window(index);
        let kind = (window.style & 0x0f) as u16;

        window
            .control
            .as_ref()
            .is_some_and(|control| control.class_name == "BUTTON")
            && (kind == BS_PUSHBUTTON || kind == BS_DEFPUSHBUTTON)
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

    /// The control with `WS_TABSTOP` after `from` -- or before it,
    /// `previous` -- wrapping; the first with none.
    pub fn next_tab_item(&self, hwnd: u16, from: u16, previous: bool) -> u16 {
        let controls = self.controls_of(hwnd);
        let stops: Vec<usize> = controls
            .iter()
            .copied()
            .filter(|&child| self.shown_window(child).style & WS_TABSTOP != 0)
            .collect();
        let mut order = if stops.is_empty() { controls } else { stops };

        if previous {
            order.reverse();
        }

        let at = order
            .iter()
            .position(|&child| self.shown_window(child).hwnd == from)
            .map_or(-1, |at| at as i64);

        for step in 1..=order.len() as i64 {
            let child = order[((at.max(-1) + step) % order.len() as i64) as usize];

            if self.takes_focus(child) {
                return self.shown_window(child).hwnd;
            }
        }

        0
    }

    /// The next control in `from`'s group -- the controls from one with
    /// `WS_GROUP` up to the next -- wrapping.
    pub fn next_group_item(&self, hwnd: u16, from: u16, previous: bool) -> u16 {
        let controls = self.controls_of(hwnd);
        let Some(at) = controls
            .iter()
            .position(|&child| self.shown_window(child).hwnd == from)
        else {
            return 0;
        };
        let grouped = |index: usize| self.shown_window(controls[index]).style & WS_GROUP != 0;
        let mut start = at;

        while start > 0 && !grouped(start) {
            start -= 1;
        }

        let mut end = at + 1;

        while end < controls.len() && !grouped(end) {
            end += 1;
        }

        let group = &controls[start..end];
        let in_group = at - start;
        let length = group.len();

        for step in 1..=length {
            let index = if previous {
                (in_group + length * 2 - step) % length
            } else {
                (in_group + step) % length
            };

            if self.takes_focus(group[index]) {
                return self.shown_window(group[index]).hwnd;
            }
        }

        from
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
    fn save_focus(&mut self, hwnd: u16) {
        let Some(focus) = self.focus else {
            return;
        };
        let focus_hwnd = self.shown_window(focus).hwnd;
        let inside = self.in_dialog(hwnd, focus);

        if let Some(state) = self.dialog_mut(hwnd)
            && focus_hwnd != 0
            && state.saved_focus == 0
            && inside
        {
            state.saved_focus = focus_hwnd;
        }
    }

    /// The control a mnemonic names: the one whose text has `&` before it,
    /// or the one after such static text.
    fn mnemonic_target(&self, hwnd: u16, letter: u8) -> Option<usize> {
        let controls = self.controls_of(hwnd);
        let lower = letter.to_ascii_lowercase();

        for (index, &child) in controls.iter().enumerate() {
            let window = self.shown_window(child);
            let text = window
                .control
                .as_ref()
                .map_or(window.title.as_bytes(), |control| control.text.as_bytes());
            let at = text
                .windows(2)
                .position(|pair| pair[0] == b'&' && pair[1] != b'&');

            let Some(at) = at else {
                continue;
            };

            if text[at + 1].to_ascii_lowercase() != lower || !self.takes_focus(child) {
                continue;
            }

            if window
                .control
                .as_ref()
                .is_some_and(|control| control.class_name == "STATIC")
            {
                return controls[index + 1..].iter().copied().find(|&next| {
                    self.takes_focus(next) && self.shown_window(next).style & WS_TABSTOP != 0
                });
            }

            return Some(child);
        }

        None
    }

    /// A dialog's template from a module's resources, by name or number.
    fn resource_template(&mut self, instance: u16, name: &MenuName) -> Option<DialogTemplate> {
        let executable = self.executable_of(instance)?;
        let bytes = crate::resources::find_by(&executable, RT_DIALOG, name)?;

        Some(parse_dialog_template(|at| {
            bytes.get(at as usize).copied().unwrap_or(0)
        }))
    }

    /// A template in the program's memory, at a far address.
    fn memory_template(&self, far: u32) -> DialogTemplate {
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
        proc: u32,
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
            let style = template.style & !WS_VISIBLE;
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
            let control = self
                .create_window(Creation {
                    ex_style: 0,
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

            if control != 0 && font != 0 {
                self.send_message(control, WM_SETFONT, font, &mut Param::Value(0))
                    .await?;
            }
        }

        // The template's default push button is the dialog's default, kept:
        // as the focus moves the default with it, `DM_GETDEFID` still
        // answers this one (`defpush`).
        let first = {
            let mut system = self.system();
            let def_id = system
                .controls_of(hwnd)
                .into_iter()
                .find(|&child| {
                    system.is_push(child)
                        && system.shown_window(child).style & 0x0f == u32::from(BS_DEFPUSHBUTTON)
                })
                .map_or(0, |child| system.shown_window(child).control_id);

            if let Some(state) = system.dialog_mut(hwnd) {
                state.def_id = def_id;
            }

            system.first_tab_item(hwnd)
        };
        let answer = self
            .send_message(hwnd, WM_INITDIALOG, first, &mut Param::Value(param))
            .await?;

        // Worked out again after `WM_INITDIALOG`, which may have changed the
        // controls (`USER.EXE` seg24 `08e5`).
        if answer & 0xffff != 0 {
            let focus = self.system().first_tab_item(hwnd);

            if focus != 0 {
                self.dlg_set_focus(focus).await?;
            }
        }

        if template.style & WS_VISIBLE != 0 {
            self.show(hwnd, SW_SHOWNORMAL).await?;
        }

        Ok(hwnd)
    }

    /// A window shown as `ShowWindow` shows it; nothing for a handle that is
    /// no window.
    async fn show(&self, hwnd: u16, show: u16) -> Result<(), Stop> {
        let index = self.system().window_named(hwnd);

        if let Some(index) = index {
            self.show_raster(hwnd, index, show, true, false).await?;
        }

        Ok(())
    }

    /// Runs a dialog until `EndDialog`: its owner disabled meanwhile, and
    /// the dialog gone after. What `EndDialog` was given; -1 for no dialog.
    async fn run_modal(&self, hwnd: u16, owner: u16) -> Result<i16, Stop> {
        if hwnd == 0 {
            return Ok(-1);
        }

        if owner != 0 {
            self.enable_window(owner, false).await?;
        }

        let visible = {
            let system = self.system();

            system
                .window_named(hwnd)
                .is_some_and(|index| system.shown_window(index).visible)
        };

        if !visible {
            self.show(hwnd, SW_SHOWNORMAL).await?;
        }

        // Painted as it shows, it and its controls, not by its loop:
        // `hooks` recorded no `WM_PAINT` among the messages the loop took.
        let painted = {
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

        loop {
            {
                let system = self.system();

                if system.window_named(hwnd).is_none()
                    || system.dialog_of(hwnd).is_some_and(|state| state.ended)
                {
                    break;
                }
            }

            let Some(message) = self.take_message().await? else {
                break;
            };

            // The message filters first: one that takes the message ends
            // it.
            if self.message_filter(&message, MSGF_DIALOGBOX).await? {
                continue;
            }

            if !self.is_dialog_message(hwnd, &message).await? {
                self.system().translate(&message);
                self.dispatch(&message).await?;
            }
        }

        if owner != 0 {
            self.enable_window(owner, true).await?;
        }

        let result = self.system().dialog_of(hwnd).map(|state| state.result);

        if self.system().window_named(hwnd).is_some() {
            self.destroy_window(hwnd).await?;
        }

        Ok(result.unwrap_or(0))
    }

    /// `EndDialog`: a modal dialog's loop stops and `DialogBox` answers
    /// `result`; a modeless one is hidden.
    pub async fn end_dialog(&self, hwnd: u16, result: i16) -> Result<(), Stop> {
        let modal = {
            let mut system = self.system();
            let Some(state) = system.dialog_mut(hwnd) else {
                return Ok(());
            };

            state.ended = true;
            state.result = result;
            state.modal
        };

        if !modal {
            self.show(hwnd, SW_HIDE).await?;
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
        let proc = self.system().dialog_of(hwnd).map(|state| state.proc);

        if let Some(proc) = proc
            && proc != 0
        {
            // With AX the stack's segment, not the window's instance (seg25
            // `0386`).
            let stack = self.system().cpu.segments[winbox_cpu::SS].selector;
            let answer = self
                .call_proc_as(&WndProc::Guest(proc), stack, hwnd, message, wparam, lparam)
                .await?;

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

                let hollow = matches!(
                    system.gdi_object_of(brush),
                    Some((_, GdiObject::Brush(brush))) if brush.color[3] == 0
                );

                // A hollow brush erases nothing: SimTower answers
                // `NULL_BRUSH`, and Windows shows its title picture through
                // the corners its frame's lines leave undrawn. Otherwise the
                // client area is filled with the brush's colour -- the
                // pixels when the screen is drawn.
                if !hollow {
                    system.windows[index]
                        .as_mut()
                        .expect("a window")
                        .needs_erase = false;
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
                    self.system().save_focus(hwnd);
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
            WM_SHOWWINDOW if wparam == 0 => self.system().save_focus(hwnd),
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
            DM_GETDEFID => {
                let id = self.system().default_id(hwnd);

                return Ok(if id == 0 {
                    0
                } else {
                    DC_HASDEFID << 16 | u32::from(id)
                });
            }
            DM_SETDEFID => {
                if let Some(state) = self.system().dialog_mut(hwnd) {
                    state.def_id = wparam;
                }

                return Ok(1);
            }
            // Moves the focus (seg25 `05c8`): to the window `wParam` names
            // when lParam's low word says so; otherwise to the next tab
            // item, or the previous when `wParam` is nonzero -- or the first,
            // when nothing has the focus -- and not at all when the focus is
            // outside the dialog.
            WM_NEXTDLGCTL => {
                let target = {
                    let system = self.system();
                    let focus = system.focus;
                    let focus_hwnd = focus.map_or(0, |focus| system.shown_window(focus).hwnd);

                    if value & 0xffff != 0 {
                        wparam
                    } else if focus_hwnd == 0 {
                        system.first_tab_item(hwnd)
                    } else if !focus.is_some_and(|focus| system.in_dialog(hwnd, focus)) {
                        return Ok(1);
                    } else {
                        system.next_tab_item(hwnd, focus_hwnd, wparam != 0)
                    }
                };

                if target != 0 {
                    self.dlg_set_focus(target).await?;
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

        self.set_focus(saved).await?;
        Ok(true)
    }

    /// The dialog manager moving the focus (`USER.EXE` seg25 `0000`): a
    /// control that asks for it (`DLGC_HASSETSEL`) has all its text
    /// selected first, then takes the focus. The end is 0xFFFE for a
    /// program made for Windows 3 or later and 0x7FFF for an older one.
    pub async fn dlg_set_focus(&self, hwnd: u16) -> Result<u16, Stop> {
        self.move_default(hwnd).await?;

        let code = self
            .send_message(hwnd, WM_GETDLGCODE, 0, &mut Param::Value(0))
            .await?;

        if code & DLGC_HASSETSEL != 0 {
            let version = {
                let mut system = self.system();
                let instance = system
                    .window_named(hwnd)
                    .map_or(0, |index| system.shown_window(index).instance);

                system.executable_of(instance).map_or(0x300, |executable| {
                    executable.header.expected_windows_version
                })
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

    /// The default push button following the focus the dialog manager
    /// moves, as `defpush` records it: a push button given the focus
    /// becomes a default push button, and the focus anywhere else gives the
    /// default back to the dialog's own default (`DM_GETDEFID`). Any other
    /// default push button is made plain -- but only when the focus came
    /// from inside the dialog.
    async fn move_default(&self, hwnd: u16) -> Result<(), Stop> {
        let (plain, target) = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let Some(dialog) = system.shown_window(index).parent else {
                return Ok(());
            };
            let dialog_hwnd = system.shown_window(dialog).hwnd;

            if dialog_hwnd == 0 || system.dialog_of(dialog_hwnd).is_none() {
                return Ok(());
            }

            let controls = system.controls_of(dialog_hwnd);
            let target = if system.is_push(index) {
                Some(index)
            } else {
                let id = system.default_id(dialog_hwnd);

                controls
                    .iter()
                    .copied()
                    .find(|&child| system.shown_window(child).control_id == id)
            };
            let from_inside = system
                .focus
                .is_some_and(|focus| system.shown_window(focus).parent == Some(dialog));
            let plain: Vec<u16> = if from_inside {
                controls
                    .iter()
                    .copied()
                    .filter(|&child| {
                        Some(child) != target
                            && system.is_push(child)
                            && system.shown_window(child).style & 0x0f
                                == u32::from(BS_DEFPUSHBUTTON)
                    })
                    .map(|child| system.shown_window(child).hwnd)
                    .collect()
            } else {
                Vec::new()
            };
            let target = target
                .filter(|&target| {
                    system.is_push(target)
                        && system.shown_window(target).style & 0x0f == u32::from(BS_PUSHBUTTON)
                })
                .map(|target| system.shown_window(target).hwnd);

            (plain, target)
        };

        for child in plain {
            self.send_message(child, BM_SETSTYLE, BS_PUSHBUTTON, &mut Param::Value(1))
                .await?;
        }

        if let Some(target) = target {
            self.send_message(target, BM_SETSTYLE, BS_DEFPUSHBUTTON, &mut Param::Value(1))
                .await?;
        }

        Ok(())
    }

    /// What the window with the focus tells the dialog manager it wants;
    /// nought with no focus.
    async fn focus_code(&self, focus: u16, wparam: u16) -> Result<u32, Stop> {
        if focus == 0 {
            return Ok(0);
        }

        self.send_message(focus, WM_GETDLGCODE, wparam, &mut Param::Value(0))
            .await
    }

    /// A keyboard message a dialog handles itself: the focus moved, or a
    /// button pressed. Any other message for the dialog or a window in it is
    /// translated and dispatched here, and the answer is still TRUE.
    #[allow(clippy::too_many_lines)]
    pub async fn is_dialog_message(&self, hwnd: u16, message: &Message) -> Result<bool, Stop> {
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

        let focus = {
            let system = self.system();

            system
                .focus
                .map_or(0, |focus| system.shown_window(focus).hwnd)
        };

        if message.message == WM_KEYDOWN {
            let code = self.focus_code(focus, message.wparam).await?;

            if code & DLGC_WANTALLKEYS == 0 {
                match message.wparam {
                    VK_TAB if code & DLGC_WANTTAB == 0 => {
                        let next = {
                            let system = self.system();
                            let shift = system.user_state.key_states[VK_SHIFT] & 0x80 != 0;

                            system.next_tab_item(hwnd, focus, shift)
                        };

                        if next != 0 {
                            self.dlg_set_focus(next).await?;
                        }

                        return Ok(true);
                    }
                    // A push button with the focus is the one Enter presses.
                    VK_RETURN => {
                        let (id, button) = {
                            let system = self.system();
                            let id = if code & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON) != 0 {
                                system
                                    .window_named(focus)
                                    .map_or(0, |index| system.shown_window(index).control_id)
                            } else {
                                match system.default_id(hwnd) {
                                    0 => IDOK,
                                    id => id,
                                }
                            };

                            (id, system.dlg_item(hwnd, id))
                        };
                        let lparam = BN_CLICKED << 16 | u32::from(button);

                        self.send_message(hwnd, WM_COMMAND, id, &mut Param::Value(lparam))
                            .await?;
                        return Ok(true);
                    }
                    VK_ESCAPE => {
                        let button = self.system().dlg_item(hwnd, IDCANCEL);
                        let lparam = BN_CLICKED << 16 | u32::from(button);

                        self.send_message(hwnd, WM_COMMAND, IDCANCEL, &mut Param::Value(lparam))
                            .await?;
                        return Ok(true);
                    }
                    VK_LEFT | VK_UP | VK_RIGHT | VK_DOWN if code & DLGC_WANTARROWS == 0 => {
                        let previous = message.wparam == VK_LEFT || message.wparam == VK_UP;
                        let next = self.system().next_group_item(hwnd, focus, previous);

                        if next != 0 && next != focus {
                            self.dlg_set_focus(next).await?;

                            // An automatic radio button is checked as the
                            // focus reaches it.
                            let code = self
                                .send_message(next, WM_GETDLGCODE, 0, &mut Param::Value(0))
                                .await?;

                            if code & DLGC_RADIOBUTTON != 0 {
                                self.click_control(next).await?;
                            }
                        }

                        return Ok(true);
                    }
                    _ => {}
                }
            }
        }

        // A mnemonic: Alt and a letter, or a letter where the focus takes
        // none.
        if message.message == WM_SYSCHAR || message.message == WM_CHAR {
            let code = self.focus_code(focus, message.wparam).await?;

            if message.message == WM_SYSCHAR || code & (DLGC_WANTCHARS | DLGC_WANTALLKEYS) == 0 {
                let hit = {
                    let system = self.system();

                    system
                        .mnemonic_target(hwnd, message.wparam as u8)
                        .map(|index| {
                            let window = system.shown_window(index);
                            let button = window
                                .control
                                .as_ref()
                                .is_some_and(|control| control.class_name == "BUTTON");

                            (window.hwnd, button)
                        })
                };

                if let Some((hit, button)) = hit {
                    self.dlg_set_focus(hit).await?;

                    if button {
                        self.click_control(hit).await?;
                    }

                    return Ok(true);
                }

                if message.message == WM_CHAR {
                    return Ok(true);
                }
            }
        }

        self.system().translate(message);
        self.dispatch(message).await?;
        Ok(true)
    }
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
        let hwnd = engine
            .create_dialog(instance, &template, owner, proc, param, modal)
            .await?;

        if !modal {
            return Ok(Answer::Word(hwnd));
        }

        Ok(Answer::Word(engine.run_modal(hwnd, owner).await? as u16))
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

/// A control's text as a number: leading blanks, a minus sign when signed,
/// then digits and nothing else. What fails -- no digits, something after
/// them, or a value that does not fit -- answers nought and says so through
/// the flag.
pub fn get_dlg_item_int(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let dialog = args.word(system);
    let id = args.word(system);
    let translated = args.dword(system);
    let signed = args.word(system) != 0;
    let hwnd = system.dlg_item(dialog, id);
    let text = system.window_named(hwnd).map_or(String::new(), |index| {
        let window = system.shown_window(index);

        window
            .control
            .as_ref()
            .map_or_else(|| window.title.clone(), |control| control.text.clone())
    });
    let trimmed = text.trim_start_matches(|c: char| c.is_whitespace());
    let digits = if signed {
        trimmed.strip_prefix('-').unwrap_or(trimmed)
    } else {
        trimmed
    };
    let parsed = (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| trimmed.parse::<i64>().ok())
        .flatten();
    let value = parsed.filter(|&value| {
        if signed {
            (-32768..=32767).contains(&value)
        } else {
            (0..=65535).contains(&value)
        }
    });

    if translated != 0 {
        system.write_far(translated, &u16::from(value.is_some()).to_le_bytes());
    }

    Ok(Answer::Word(value.map_or(0, |value| value as u16)))
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
        "GetDlgCtrlID" => Sync(get_dlg_ctrl_id),
        "GetDlgItem" => Sync(get_dlg_item),
        "MapDialogRect" => Sync(map_dialog_rect),
        "SendDlgItemMessage" => Async(send_dlg_item_message),
        "SetDlgItemText" => Async(set_dlg_item_text),
        "GetDlgItemText" => Async(get_dlg_item_text),
        "SetDlgItemInt" => Async(set_dlg_item_int),
        "GetDlgItemInt" => Sync(get_dlg_item_int),
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
