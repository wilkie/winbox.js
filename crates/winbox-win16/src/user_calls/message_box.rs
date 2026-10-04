//! The message box, on the raster desktop: a dialog USER builds and runs
//! itself. **Read out of `USER.EXE`** (seg1 `9b91`; seg42 `04f5`, `0101`,
//! `01e2`; seg3 `23be`) and **recorded** by the `msgbox` probe on four
//! displays.
//!
//! * **The buttons** are the style's set -- OK; OK, Cancel; Abort, Retry,
//!   Ignore; Yes, No, Cancel; Yes, No; Retry, Cancel -- left to right, their
//!   captions USER's strings. `MB_DEFBUTTON2` and `3` make the second or
//!   third the default, or the first if there is no such button. All are
//!   the same width: the longest caption's by its count of characters --
//!   `&Ignore` -- measured without its `&`, and two widths of `0` more.
//! * **The icon** is the display driver's hand, question mark, exclamation
//!   mark or asterisk (7F01h to 7F04h).
//! * **The text** is laid out as `DrawText` with `DT_WORDBREAK` would lay it
//!   out, as wide as five eighths of the screen, less the margins and the
//!   icon, allow. The box is as wide as the text or the buttons, or the
//!   title, whichever is widest, and centred on the screen, whatever its
//!   owner; a box opened while another is open goes `SM_CXSIZE` and
//!   `SM_CYSIZE` on from it.
//! * **The answer** is the button's number. A box with only OK gives its
//!   button the number of Cancel, so that Escape closes it, and answers
//!   `IDOK` all the same. A box without Cancel takes Close out of its system
//!   menu. The owner is disabled while the box is up.
//!
//! Not followed, as the TypeScript engine does not: `MB_SYSTEMMODAL` with
//! no icon or the hand, which USER shows with `SysErrorBox` instead, not
//! read out; the system menu's Close taken away; and `MB_TASKMODAL` with no
//! owner, which disables the task's other windows.

use crate::call::{Answer, Args, Later, Stop};
use crate::dialog_template::{DialogItem, DialogTemplate, Named};
use crate::dialogs::DialogProc;
use crate::engine::Engine;
use crate::gdi::calls::mul_div;
use crate::gdi::dc::{create_compatible_dc, delete_dc};
use crate::gdi::text::get_text_extent;
use crate::shell::{Text, text_argument};
use crate::system::System;
use crate::user_misc::user_string;

/// A button of a set: the number it answers, and its caption's string.
#[derive(Clone, Copy)]
struct Button {
    id: u16,
    caption: u16,
}

const fn button(id: u16, caption: u16) -> Button {
    Button { id, caption }
}

/// Each set's buttons, as USER's tables give them (DS `1FE`, `204`, `21E`,
/// `20A`).
const SETS: [&[Button]; 8] = [
    &[button(1, 84)],
    &[button(1, 84), button(2, 85)],
    &[button(3, 86), button(4, 87), button(5, 88)],
    &[button(6, 89), button(7, 90), button(2, 85)],
    &[button(6, 89), button(7, 90)],
    &[button(4, 87), button(2, 85)],
    &[],
    &[],
];

/// Every caption USER keeps, in its order: which is longest sets the
/// buttons' width.
const CAPTIONS: [u16; 8] = [84, 85, 89, 90, 87, 86, 88, 114];

/// The default title, when none is given.
const TITLE_ERROR: u16 = 78;

const MB_OK: u16 = 0;
const MB_SYSTEMMODAL: u16 = 0x1000;

const SM_CXSCREEN: i16 = 0;
const SM_CYSCREEN: i16 = 1;
const SM_CYCAPTION: i16 = 4;
const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;
const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;

const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;

/// `DT_WORDBREAK | DT_EXPANDTABS | DT_CALCRECT | DT_NOPREFIX`.
const MEASURE: u16 = 0x0c50;

const IDC_ARROW: u16 = 0x7f00;

/// The box's own procedure (seg42 `0101`), with what it knows of the box:
/// its set of buttons and which is the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoxProc {
    kind: u16,
    default_button: usize,
}

impl BoxProc {
    /// What the procedure answers a message: `WM_INITDIALOG` gives the
    /// default button the focus -- the buttons are made first -- and OK
    /// alone the number of Cancel; a button's `WM_COMMAND` ends the box with
    /// its number.
    pub(crate) async fn answer(
        self,
        engine: &Engine,
        hwnd: u16,
        message: u16,
        wparam: u16,
    ) -> Result<u32, Stop> {
        match message {
            WM_INITDIALOG => {
                let focus = {
                    let system = engine.system();

                    system.window_named(hwnd).and_then(|dialog| {
                        system
                            .z_order
                            .iter()
                            .filter_map(|&other| system.windows[other].as_ref())
                            .filter(|window| window.parent == Some(dialog))
                            .nth(self.default_button)
                            .map(|window| window.hwnd)
                    })
                };

                if let Some(focus) = focus.filter(|&focus| focus != 0) {
                    engine.set_focus(focus).await?;
                }

                if self.kind == MB_OK {
                    let mut system = engine.system();
                    let ok = system.dlg_item(hwnd, 1);

                    if let Some(index) = system.window_named(ok)
                        && let Some(window) = system.windows[index].as_mut()
                    {
                        window.control_id = 2;
                    }
                }

                Ok(0)
            }
            WM_COMMAND => {
                let id = wparam;

                if (id == 1 || id == 2) && engine.system().dlg_item(hwnd, id) == 0 {
                    return Ok(0);
                }

                if (1..=7).contains(&id) {
                    engine.end_dialog(hwnd, id as i16).await?;
                    return Ok(1);
                }

                Ok(0)
            }
            _ => Ok(0),
        }
    }
}

/// A string argument as the TypeScript engine reads one.
enum Argument {
    /// One that cannot be read, which turns the call away.
    Refused,
    /// Text: none for a null pointer, a number's digits where its segment
    /// is nought.
    Text(Option<Vec<u8>>),
}

fn text_of(system: &System, far: u32) -> Argument {
    Argument::Text(match text_argument(system, far) {
        Text::Refused => return Argument::Refused,
        Text::Null => None,
        Text::Number(number) => Some(number.to_string().into_bytes()),
        Text::Read(bytes) => Some(bytes),
    })
}

/// A message box: nought where there is no raster desktop to show it on,
/// as where it cannot be made.
pub(super) fn message_box_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (owner, text, title, style) = {
            let mut system = engine.system();
            let owner = args.word(&system);
            let text = args.dword(&system);
            let title = args.dword(&system);
            let style = args.word(&system);
            let (Argument::Text(text), Argument::Text(title)) =
                (text_of(&system, text), text_of(&system, title))
            else {
                return Ok(Answer::Word(0));
            };

            if !system.raster() {
                return Ok(Answer::Word(0));
            }

            (owner, text, title, style)
        };

        Ok(Answer::Word(
            engine.message_box(owner, text, title, style).await?,
        ))
    })
}

/// A string of USER's, or nothing.
fn string(id: u16) -> Vec<u8> {
    user_string(id).unwrap_or("").bytes().collect()
}

fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

/// A caption with each `&` taken out from before the character it marks,
/// as the TypeScript engine's pattern takes it: any character but a line's
/// end, a carriage return or a line feed.
fn without_marks(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;

    while at < text.len() {
        if text[at] == b'&' && at + 1 < text.len() && !matches!(text[at + 1], b'\n' | b'\r') {
            out.push(text[at + 1]);
            at += 2;
        } else {
            out.push(text[at]);
            at += 1;
        }
    }

    out
}

/// What the box is made of, worked out before it is made.
struct Built {
    template: DialogTemplate,
    proc: BoxProc,
}

impl System {
    /// The box's template, laid out (seg42 `04f5`), measured in the System
    /// font as the desktop's own device context has it.
    #[allow(clippy::too_many_lines)]
    fn message_box_template(
        &mut self,
        text: Option<&[u8]>,
        title: Option<&[u8]>,
        style: u16,
    ) -> Result<Built, Stop> {
        let kind = style & 0x0f;
        let buttons: Vec<(Button, Vec<u8>)> = SETS[usize::from(kind & 7)]
            .iter()
            .filter(|_| kind < 8)
            .map(|&button| (button, string(button.caption)))
            .collect();
        let count = buttons.len() as i32;
        let mut default_button = usize::from((style >> 8) & 0x0f);

        if default_button >= buttons.len() {
            default_button = 0;
        }

        let icon: u16 = match style & 0xf0 {
            0x10 => 0x7f01,
            0x20 => 0x7f02,
            0x30 => 0x7f03,
            0x40 => 0x7f04,
            _ => 0,
        };
        let caption = title.map_or_else(|| string(TITLE_ERROR), <[u8]>::to_vec);
        let gap_across = self.metric(SM_CXSIZE);
        let gap_down = self.metric(SM_CYSIZE);
        let border_across = self.metric(SM_CXBORDER);
        let border_down = self.metric(SM_CYBORDER);
        let caption_height = self.metric(SM_CYCAPTION);
        let screen_width = self.metric(SM_CXSCREEN);
        let screen_height = self.metric(SM_CYSCREEN);
        let (unit_across, unit_down) = self.system_base_units()?;
        let hdc = create_compatible_dc(self, 0);
        let extent = |system: &mut Self, text: &[u8]| -> Result<i32, Stop> {
            if text.is_empty() {
                return Ok(0);
            }

            Ok((get_text_extent(system, hdc, text, text.len() as i32)? & 0xffff) as i32)
        };

        // The buttons' width (seg3 `23be`): the caption with the most
        // characters, the first of equals, measured without its `&`.
        let mut longest = Vec::new();

        for id in CAPTIONS {
            let each = string(id);

            if each.len() > longest.len() {
                longest = each;
            }
        }

        let button_width = extent(self, &without_marks(&longest))? + 2 * extent(self, b"0")?;
        let icon_add = if icon == 0 {
            0
        } else {
            self.metric(SM_CXICON) + gap_across
        };
        let icon_height = if icon == 0 { 0 } else { self.metric(SM_CYICON) };
        let title_width = extent(self, &caption)?;
        let row_width = button_width * count + (count - 1) * gap_across;
        let least_width = row_width.max(title_width + 2 * gap_across);
        let margins = 2 * (border_down + gap_across);
        let limit =
            (least_width - margins - icon_add).max((screen_width >> 3) * 5 - margins - icon_add);
        let (text_height, measured) = crate::draw_text::draw_text_in(
            self,
            hdc,
            text.unwrap_or(&[]),
            -1,
            [0, 0, limit, limit],
            MEASURE,
        )?;
        let text_height = i32::from(text_height);
        let text_width = measured[2] - measured[0];

        delete_dc(self, hdc);

        // The box, and where it goes (seg42 `05d7`).
        let nest = i32::from(self.user_calls.message_boxes);
        let width = text_width.max(least_width) + 2 * gap_across + icon_add;
        let height = icon_height.max(text_height) + 6 * unit_down;
        let mut x = ((screen_width - width) >> 1) + gap_across * nest;
        let mut y = ((screen_height - height) >> 1) + gap_down * nest;

        if x + width > screen_width {
            x = screen_width - 2 * border_across - width;
        }

        if y + height > screen_height {
            y = screen_height - 2 * border_down - height;
        }

        // What goes in it, in the client area (seg42 `0670`).
        let buttons_x = ((width - row_width) >> 1) - border_across;
        let buttons_bottom = height - 2 * border_down - (unit_down >> 1) - caption_height;
        let button_height = (unit_down * 14) >> 3;
        let text_y = ((icon_height.max(text_height) - text_height) >> 1) + unit_down;
        let icon_y = ((text_height - icon_height) >> 1) + text_y;
        let text_x = gap_across + icon_add;

        // In dialog units, each rounded (seg42 `0394`).
        let across = |pixels: i32| mul_div(pixels, 4, unit_across) as i16;
        let down = |pixels: i32| mul_div(pixels, 8, unit_down) as i16;
        let item = |x, y, cx, cy, id, style: u32, class: &str, text: Vec<u8>| DialogItem {
            x,
            y,
            cx,
            cy,
            id,
            style,
            class_name: class.to_string(),
            text: Named::Text(latin1(&text)),
            data: Vec::new(),
        };
        let mut items = Vec::new();

        for (index, (button, caption)) in buttons.into_iter().enumerate() {
            let first = if index == 0 { 0x0002_0000 } else { 0 };
            let default = u32::from(index == default_button);

            items.push(item(
                across(buttons_x + index as i32 * (button_width + gap_across)),
                down(buttons_bottom - button_height),
                across(button_width),
                down(button_height),
                button.id,
                0x5001_0000 | first | default,
                "BUTTON",
                caption,
            ));
        }

        if icon != 0 {
            items.push(item(
                across(gap_across),
                down(icon_y),
                0,
                0,
                0xffff,
                0x5002_0003,
                "STATIC",
                format!("#{icon}").into_bytes(),
            ));
        }

        // A left-aligned static is one unit wider and taller (seg42 `03ff`).
        if let Some(text) = text {
            items.push(item(
                across(text_x),
                down(text_y),
                across(text_width) + 1,
                down(text_height) + 1,
                0xffff,
                0x5002_0080,
                "STATIC",
                text.to_vec(),
            ));
        }

        let system_modal = style & 0x3000 == MB_SYSTEMMODAL;

        Ok(Built {
            template: DialogTemplate {
                style: if system_modal {
                    0x80c8_0103
                } else {
                    0x80c8_0181
                },
                x: across(x + border_across),
                y: down(y + caption_height),
                cx: across(width - 2 * border_across),
                cy: down(height - caption_height - border_down),
                menu: None,
                class_name: None,
                caption: latin1(&caption),
                font: None,
                items,
            },
            proc: BoxProc {
                kind,
                default_button,
            },
        })
    }
}

impl Engine {
    /// A message box made and run until a button ends it, the arrow the
    /// cursor meanwhile: the button's number, `IDOK` for OK alone, or
    /// nought where the box could not be made.
    pub async fn message_box(
        &self,
        owner: u16,
        text: Option<Vec<u8>>,
        title: Option<Vec<u8>>,
        style: u16,
    ) -> Result<u16, Stop> {
        let (built, cursor) = {
            let mut system = self.system();
            let built = system.message_box_template(text.as_deref(), title.as_deref(), style)?;
            let arrow = crate::icons::standard_cursor_handle(&mut system, IDC_ARROW);
            let cursor = crate::icons::set_cursor(&mut system, &mut Args::repeat(arrow))?;

            system.user_calls.message_boxes += 1;
            (built, cursor)
        };
        let param = u32::from(owner) << 16 | u32::from(style);
        let answer = self.run_message_box(&built, owner, param).await;

        {
            let mut system = self.system();

            system.user_calls.message_boxes = system.user_calls.message_boxes.saturating_sub(1);

            if let Answer::Word(cursor) = cursor
                && cursor != 0
            {
                crate::icons::set_cursor(&mut system, &mut Args::repeat(cursor))?;
            }
        }

        let answer = answer?;

        if answer == -1 {
            return Ok(0);
        }

        Ok(if built.proc.kind == MB_OK && answer != 0 {
            1
        } else {
            answer as u16
        })
    }

    async fn run_message_box(&self, built: &Built, owner: u16, param: u32) -> Result<i16, Stop> {
        let hwnd = self
            .create_dialog(
                0,
                &built.template,
                owner,
                DialogProc::MessageBox(built.proc),
                param,
                true,
            )
            .await?;

        self.run_modal(hwnd, owner).await
    }
}

#[cfg(test)]
mod tests {
    use super::without_marks;

    #[test]
    fn a_caption_loses_its_marks() {
        assert_eq!(without_marks(b"&Ignore"), b"Ignore");
        assert_eq!(without_marks(b"A&&B"), b"A&B");
        assert_eq!(without_marks(b"End&"), b"End&");
        assert_eq!(without_marks(b"&\nA"), b"&\nA");
    }
}
