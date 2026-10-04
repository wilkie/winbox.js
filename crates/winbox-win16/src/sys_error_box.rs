//! USER's system error box (`USER.EXE` seg1 `9325`, export 320), as
//! winbox.js's `sys-error-box.ts` has it: a box drawn straight on the
//! screen over every window, with no window of its own, and a loop of its
//! own over the mouse and the keyboard in which no program runs. KERNEL
//! shows it when a program faults (`fault.rs`). **Read out**, and
//! **recorded** by `fault` through the screen: the box and both its buttons
//! agree with Windows' pixel for pixel.
//!
//! * The text is split at `\n` into at most three lines; the rest is lost.
//! * The box is `10 cyC` high, and wide enough for the widest line or the
//!   caption with `6 cxC` to spare, and for three buttons at least; in the
//!   middle of the screen. White, in a frame of `COLOR_WINDOWFRAME` one
//!   pixel wide and `COLOR_ACTIVECAPTION` four.
//! * The caption is a row down, and the lines from the fourth row, the
//!   third for three lines, each in the middle.
//! * Three places for buttons, each a quarter of the way along, `2 cyC`
//!   above the bottom: a place with no button is left empty.
//! * It answers the place chosen, 1 to 3.
//!
//! The Rust engine has no keyboard or mouse of the host's yet, and its run
//! is not interrupted while the box waits, so what a person does at the box
//! comes from the host's hand (`BoxHand`), as the TypeScript engine's
//! probe runs press keys when the box comes up. With no hand, or none it
//! gives, the box waits until the run's time is up.

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::desktop_paint::fill_brush;
use crate::engine::Engine;
use crate::frame::Lettering;
use crate::raster_input::{Pointer, PointerKind};
use crate::shell::{Text, text_argument};
use crate::system::System;

pub const SEB_OK: u16 = 1;
pub const SEB_CANCEL: u16 = 2;
pub const SEB_YES: u16 = 3;
pub const SEB_NO: u16 = 4;
pub const SEB_RETRY: u16 = 5;
pub const SEB_ABORT: u16 = 6;
pub const SEB_IGNORE: u16 = 7;
pub const SEB_CLOSE: u16 = 8;
pub const SEB_DEFBUTTON: u16 = 0x8000;

/// Each button's label and the letter that chooses it (USER's strings 54h
/// to 5Bh, 72h).
const LABELS: [(u16, &str, Option<u8>); 8] = [
    (SEB_OK, "OK", None),
    (SEB_CANCEL, "Cancel", None),
    (SEB_YES, "&Yes", Some(b'y')),
    (SEB_NO, "&No", Some(b'n')),
    (SEB_RETRY, "&Retry", Some(b'r')),
    (SEB_ABORT, "&Abort", Some(b'a')),
    (SEB_IGNORE, "&Ignore", Some(b'i')),
    (SEB_CLOSE, "&Close", Some(b'c')),
];

const COLOR_ACTIVECAPTION: usize = 2;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_BTNFACE: usize = 15;
const COLOR_BTNSHADOW: usize = 16;
const COLOR_BTNTEXT: usize = 18;
const COLOR_BTNHIGHLIGHT: usize = 20;
const WHITE: u32 = 0x00ff_ffff;
const BLACK: u32 = 0x0000_0000;

const VK_TAB: u16 = 0x09;
const VK_RETURN: u16 = 0x0d;
const VK_ESCAPE: u16 = 0x1b;
const VK_SPACE: u16 = 0x20;
const WM_KEYDOWN: u16 = 0x0100;
const WM_KEYUP: u16 = 0x0101;
const WM_SYSKEYDOWN: u16 = 0x0104;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;

/// What the host's hand does at the box: a key pressed and released, by
/// its virtual key, or the mouse.
#[derive(Debug, Clone, Copy)]
pub enum BoxInput {
    Key(u16),
    Pointer(Pointer),
}

/// The host's hand at the box, for a run with no person at it: asked as
/// the box comes up (`true`) and after each thing it did (`false`) for the
/// next, if any; it may look at the screen each time.
pub struct BoxHand(pub Box<Hand>);

/// What the hand is: asked with the system and whether the box has just
/// come up.
pub type Hand = dyn FnMut(&System, bool) -> Option<BoxInput>;

impl std::fmt::Debug for BoxHand {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("BoxHand")
    }
}

/// A button in one of the box's places.
#[derive(Debug, Clone, Copy)]
pub struct Button {
    pub id: u16,
    pub focus: bool,
    pub pressed: bool,
    pub rect: [i32; 4],
}

/// A line of text and where it goes.
#[derive(Debug, Clone)]
pub struct Placed {
    pub text: Vec<u8>,
    pub x: i32,
    pub y: i32,
}

/// Where everything goes, for a text, a caption and three places' buttons.
#[derive(Debug, Clone)]
pub struct Layout {
    pub area: [i32; 4],
    pub caption: Placed,
    pub lines: Vec<Placed>,
    pub buttons: [Option<Button>; 3],
}

fn label_of(id: u16) -> Option<(&'static str, Option<u8>)> {
    LABELS
        .iter()
        .find(|&&(each, _, _)| each == id)
        .map(|&(_, label, mnemonic)| (label, mnemonic))
}

/// The text split at `\n` into at most three lines, a `\n` with nothing
/// after it starting none.
fn lines_of(text: &[u8]) -> Vec<Vec<u8>> {
    let mut lines = Vec::new();
    let mut rest = text;

    while lines.len() < 3 {
        let Some(at) = rest.iter().position(|&byte| byte == b'\n') else {
            lines.push(rest.to_vec());
            break;
        };

        lines.push(rest[..at].to_vec());
        rest = &rest[at + 1..];

        if rest.is_empty() {
            break;
        }
    }

    lines
}

impl System {
    /// Where everything goes; `None` with no System font to draw in.
    pub fn sys_error_box_layout(
        &self,
        text: &[u8],
        caption: &[u8],
        buttons: [u16; 3],
    ) -> Option<Layout> {
        let font = self.system_lettering()?;
        let (cx, cy) = (font.average, font.height);
        let measure = |line: &[u8]| font.measure(line);
        let button_width = 2 * cy + measure(b"Ignore") + 2 * measure(b"0");
        let lines = lines_of(text);
        let widest = lines
            .iter()
            .map(|line| measure(line))
            .max()
            .unwrap_or(0)
            .max(0);
        let width = (6 * cx + widest)
            .max(6 * cx + measure(caption))
            .max(3 * (4 * cy + button_width));
        let height = 10 * cy;
        let left = ((i32::from(self.display.width) >> 1) - (width >> 1)).max(0);
        let top = (i32::from(self.display.height) >> 1) - (height >> 1);
        let (right, bottom) = (left + width, top + height);
        let middle = (left + right) >> 1;
        let step = width >> 2;
        let first = top + if lines.len() == 3 { 3 } else { 4 } * cy;

        Some(Layout {
            area: [left, top, right, bottom],
            caption: Placed {
                text: caption.to_vec(),
                x: middle - (measure(caption) >> 1),
                y: top + cy,
            },
            lines: lines
                .iter()
                .zip(0..)
                .map(|(line, index)| Placed {
                    text: line.clone(),
                    x: middle - (measure(line) >> 1),
                    y: first + index * cy,
                })
                .collect(),
            buttons: std::array::from_fn(|slot| {
                let word = buttons[slot];
                let id = word & 0x7fff;

                label_of(id)?;

                let centre_x = left + (slot as i32 + 1) * step;
                let centre_y = bottom - 2 * cy;
                let l = centre_x - (button_width >> 1);
                let t = centre_y - cy;

                Some(Button {
                    id,
                    focus: word & SEB_DEFBUTTON != 0,
                    pressed: false,
                    rect: [l, t, l + button_width, t + 2 * cy],
                })
            }),
        })
    }

    /// A rectangle of the screen filled with a colour's brush, over every
    /// window, as the box draws through a DC for the whole desktop.
    fn screen_fill(&mut self, left: i32, top: i32, width: i32, height: i32, colour: u32) {
        if width > 0 && height > 0 {
            let screen = self.screen_bitmap();

            fill_brush(
                self,
                &screen,
                left,
                top,
                width,
                height,
                colour,
                (0, 0),
                None,
            );
        }
    }

    /// A line in the System font, straight on the screen.
    fn screen_text(&mut self, font: &Lettering, x: i32, y: i32, line: &[u8], colour: u32) {
        let screen = self.screen_bitmap();

        font.text(self, &screen, line, colour, x, y);
    }

    /// A frame `m` wide inside a rectangle, in four blocks that meet at
    /// the corners.
    #[allow(clippy::many_single_char_names)]
    fn screen_frame(&mut self, [l, t, r, b]: [i32; 4], m: i32, colour: u32) {
        self.screen_fill(l, t, m, b - t - m, colour);
        self.screen_fill(l + m, t, r - l - m, m, colour);
        self.screen_fill(l, b - m, r - l - m, m, colour);
        self.screen_fill(r - m, t + m, m, b - t - m, colour);
    }

    /// A button's face, as the box draws it (seg1 `8e0c`, `9201`, `916a`).
    #[allow(clippy::many_single_char_names)]
    fn draw_sys_error_button(&mut self, button: &Button) {
        let Some(font) = self.system_lettering() else {
            return;
        };
        let [l, t, r, b] = button.rect;
        let m = if button.focus { 2 } else { 1 };
        let face = self.sys_color(COLOR_BTNFACE);
        let shadow = self.sys_color(COLOR_BTNSHADOW);
        let highlight = self.sys_color(COLOR_BTNHIGHLIGHT);

        self.screen_frame(button.rect, m, self.sys_color(COLOR_WINDOWFRAME));

        // Round corners.
        for (x, y) in [(l, t), (r - 1, t), (l, b - 1), (r - 1, b - 1)] {
            self.screen_fill(x, y, 1, 1, WHITE);
        }

        let (il, it, ir, ib) = (l + m, t + m, r - m, b - m);

        if shadow & 0x00ff_ffff == WHITE {
            self.screen_fill(il, it, ir - il, ib - it, face);
        } else if button.pressed {
            self.screen_fill(il, it, 1, ib - it, shadow);
            self.screen_fill(il, it, ir - il, 1, shadow);
            self.screen_fill(il + 1, it + 1, ir - il - 1, ib - it - 1, face);
        } else {
            self.screen_fill(il, it, 2, ib - it, highlight);
            self.screen_fill(il, it, ir - il, 2, highlight);

            for inset in 0..2 {
                let (rr, bb) = (ir - 1 - inset, ib - 1 - inset);
                let (ll, tt) = (il + inset, it + inset);

                self.screen_fill(ll, bb, rr - ll + 1, 1, shadow);
                self.screen_fill(rr, tt, 1, bb - tt, shadow);
            }

            self.screen_fill(il + 2, it + 2, ir - il - 4, ib - it - 4, face);
        }

        // The label, its letter underlined, and the focus's dotted
        // rectangle.
        let Some((label, _)) = label_of(button.id) else {
            return;
        };
        let at = label.find('&');
        let plain: Vec<u8> = label.bytes().filter(|&byte| byte != b'&').collect();
        let width = font.measure(&plain);
        let height = font.height;
        let shift = i32::from(button.pressed);
        let x = ((l + r) >> 1) - (width >> 1) + shift;
        let y = ((t + b) >> 1) - (height >> 1) + shift;
        let text = self.sys_color(COLOR_BTNTEXT);

        self.screen_text(&font, x, y, &plain, text);

        if let Some(at) = at {
            let before = font.measure(&plain[..at]);
            let letter = font.measure(&plain[at..=at]);

            self.screen_fill(
                x + before - font.overhang,
                y + font.ascent + 1,
                letter - (font.overhang >> 1),
                1,
                text,
            );
        }

        if button.focus {
            let fl = l + ((r - l - width) >> 1) - 2 + shift;
            let ft = t + ((b - t - height) >> 1) - 1 + shift;
            let (fr, fb) = (fl + width + 4, ft + height + 3);
            let dot = |x: i32, y: i32| if (x + y) & 1 != 0 { WHITE } else { BLACK };

            for px in fl..fr {
                for py in [ft, fb - 1] {
                    self.screen_fill(px, py, 1, 1, dot(px, py));
                }
            }

            for py in ft..fb {
                for px in [fl, fr - 1] {
                    self.screen_fill(px, py, 1, 1, dot(px, py));
                }
            }
        }
    }

    /// The whole box drawn.
    pub fn draw_sys_error_box(&mut self, layout: &Layout) {
        let Some(font) = self.system_lettering() else {
            return;
        };
        let [left, top, right, bottom] = layout.area;

        self.screen_fill(left, top, right - left, bottom - top, WHITE);
        self.screen_frame(layout.area, 1, self.sys_color(COLOR_WINDOWFRAME));
        self.screen_frame(
            [left + 1, top + 1, right - 1, bottom - 1],
            4,
            self.sys_color(COLOR_ACTIVECAPTION),
        );
        self.screen_text(
            &font,
            layout.caption.x,
            layout.caption.y,
            &layout.caption.text,
            BLACK,
        );

        for line in &layout.lines {
            self.screen_text(&font, line.x, line.y, &line.text, BLACK);
        }

        for button in layout.buttons.iter().flatten() {
            self.draw_sys_error_button(button);
        }
    }

    /// The host's hand asked what it does next.
    fn hand(&mut self, shown: bool) -> Option<BoxInput> {
        let mut hand = self.box_hand.take()?;
        let input = (hand.0)(self, shown);

        self.box_hand = Some(hand);
        input
    }
}

/// The box's loop over the mouse and the keyboard (seg1 `9759`): a press
/// and release on a button chooses it; Enter or Space chooses the focus's
/// button as the key comes up; Tab moves the focus, and the thick border
/// with it, always onwards; Escape chooses Cancel, if there is one; a
/// button's letter, with Alt or not, chooses it at once.
#[derive(Debug)]
struct Modal {
    layout: Layout,
    focus: Option<usize>,
    tracking: bool,
    key_down: bool,
}

impl Modal {
    fn inside(button: Option<&Button>, x: i32, y: i32) -> bool {
        button.is_some_and(|button| {
            x >= button.rect[0] && x < button.rect[2] && y >= button.rect[1] && y < button.rect[3]
        })
    }

    fn press(&mut self, system: &mut System, slot: usize, pressed: bool) {
        if let Some(button) = self.layout.buttons[slot].as_mut()
            && button.pressed != pressed
        {
            button.pressed = pressed;

            let button = *button;

            system.draw_sys_error_button(&button);
        }
    }

    fn redraw(&self, system: &mut System, slot: usize) {
        if let Some(button) = self.layout.buttons[slot] {
            system.draw_sys_error_button(&button);
        }
    }

    fn set_focus(&mut self, slot: usize, focus: bool) {
        if let Some(button) = self.layout.buttons[slot].as_mut() {
            button.focus = focus;
        }
    }

    fn by_letter(&self, key: u16) -> Option<usize> {
        let letter = (key | 0x20) as u8;

        self.layout.buttons.iter().position(|button| {
            button
                .and_then(|button| label_of(button.id))
                .is_some_and(|(_, mnemonic)| mnemonic == Some(letter))
        })
    }

    /// A message of the mouse's or the keyboard's: the place chosen by it,
    /// 1 to 3, if it chose one.
    fn input(
        &mut self,
        system: &mut System,
        message: u16,
        key: u16,
        x: i32,
        y: i32,
    ) -> Option<u16> {
        let chosen = |slot: usize| Some(slot as u16 + 1);

        match message {
            WM_LBUTTONDOWN => {
                self.tracking = true;

                let hit =
                    (0..3).find(|&slot| Self::inside(self.layout.buttons[slot].as_ref(), x, y));

                if let Some(hit) = hit {
                    if let Some(focus) = self.focus
                        && hit != focus
                    {
                        self.set_focus(focus, false);
                        self.redraw(system, focus);
                    }

                    self.focus = Some(hit);
                    self.set_focus(hit, true);
                    self.press(system, hit, true);
                }
            }
            WM_MOUSEMOVE if self.tracking => {
                for slot in 0..3 {
                    let inside = Self::inside(self.layout.buttons[slot].as_ref(), x, y);

                    self.press(system, slot, inside && Some(slot) == self.focus);
                }
            }
            WM_LBUTTONUP => {
                self.tracking = false;

                let pressed = self
                    .layout
                    .buttons
                    .iter()
                    .position(|button| button.is_some_and(|button| button.pressed));

                if let Some(slot) = pressed {
                    return chosen(slot);
                }
            }
            WM_KEYDOWN => match key {
                VK_RETURN | VK_SPACE => {
                    if let Some(focus) = self.focus
                        && !self.key_down
                    {
                        self.key_down = true;
                        self.press(system, focus, true);
                    }
                }
                VK_TAB => {
                    if let Some(mut focus) = self.focus {
                        self.set_focus(focus, false);
                        self.redraw(system, focus);

                        loop {
                            focus = (focus + 1) % 3;

                            if self.layout.buttons[focus].is_some() {
                                break;
                            }
                        }

                        self.focus = Some(focus);
                        self.set_focus(focus, true);
                        self.redraw(system, focus);
                    }
                }
                VK_ESCAPE => {
                    let cancel =
                        self.layout.buttons.iter().position(|button| {
                            button.is_some_and(|button| button.id == SEB_CANCEL)
                        });

                    if let Some(slot) = cancel {
                        return chosen(slot);
                    }
                }
                _ => {
                    if let Some(slot) = self.by_letter(key) {
                        return chosen(slot);
                    }
                }
            },
            WM_SYSKEYDOWN => {
                if let Some(slot) = self.by_letter(key) {
                    return chosen(slot);
                }
            }
            WM_KEYUP => {
                if (key == VK_RETURN || key == VK_SPACE)
                    && self.key_down
                    && let Some(focus) = self.focus
                {
                    return chosen(focus);
                }
            }
            _ => {}
        }

        None
    }
}

/// A key pressed or released, for `GetAsyncKeyState`.
fn note_async_key(system: &mut System, key: u16, down: bool) {
    let table = &mut system.user_state.async_keys;

    if down {
        table[usize::from(key & 0xff)] |= 0x81;
    } else {
        table[usize::from(key & 0xff)] &= !0x80;
    }
}

impl Engine {
    /// Shows the box and waits for a button to be chosen: its place, 1 to
    /// 3, or nought with no screen to draw on. Afterwards what the box
    /// covered is drawn again. Nothing else runs while it is up.
    pub fn sys_error_box(
        &self,
        text: &[u8],
        caption: &[u8],
        buttons: [u16; 3],
    ) -> Result<u16, Stop> {
        let mut modal = {
            let mut system = self.system();

            if !system.raster() {
                return Ok(0);
            }

            let Some(layout) = system.sys_error_box_layout(text, caption, buttons) else {
                return Ok(0);
            };

            system.draw_sys_error_box(&layout);

            let focus = layout
                .buttons
                .iter()
                .position(|button| button.is_some_and(|button| button.focus));

            Modal {
                layout,
                focus,
                tracking: false,
                key_down: false,
            }
        };
        let mut shown = true;

        let chosen = loop {
            let input = self.system().hand(shown);

            shown = false;

            let Some(input) = input else {
                // Nothing comes but what the host's hand gives: the box
                // waits as time passes, until the run's is up.
                while self.pass_time() {}

                return Err(Stop::Time);
            };
            let mut system = self.system();
            let chosen = match input {
                BoxInput::Key(key) => {
                    note_async_key(&mut system, key, true);

                    let (x, y) = system.cursor_of();
                    let down = modal.input(&mut system, WM_KEYDOWN, key, x.into(), y.into());

                    // The key comes up after the box is gone, if a press
                    // chose a button: the TypeScript engine's then goes to
                    // the window with the focus, which no key of the host's
                    // reaches here yet.
                    note_async_key(&mut system, key, false);
                    down.or_else(|| modal.input(&mut system, WM_KEYUP, key, x.into(), y.into()))
                }
                BoxInput::Pointer(pointer) => {
                    let (x, y) = system.held_point((pointer.x, pointer.y));

                    for (bit, key) in [(1u8, 0x01u16), (2, 0x02), (4, 0x04)] {
                        if pointer.buttons & bit != system.mouse_buttons & bit {
                            note_async_key(&mut system, key, pointer.buttons & bit != 0);
                        }
                    }

                    system.cursor_pos = Some((x, y));
                    system.mouse_buttons = pointer.buttons;

                    let message = match pointer.kind {
                        PointerKind::Move => WM_MOUSEMOVE,
                        _ if pointer.button != 0 => 0,
                        PointerKind::Down => WM_LBUTTONDOWN,
                        PointerKind::Up => WM_LBUTTONUP,
                    };

                    if message == 0 {
                        None
                    } else {
                        modal.input(
                            &mut system,
                            message,
                            pointer.buttons.into(),
                            x.into(),
                            y.into(),
                        )
                    }
                }
            };

            if let Some(chosen) = chosen {
                break chosen;
            }
        };

        self.system().expose(modal.layout.area);

        Ok(chosen)
    }
}

/// `SysErrorBox`: the box as a program calls it -- its text, its caption,
/// and the button for each of the three places, a `SEB_` number with
/// `SEB_DEFBUTTON` for the one with the focus, nought for none. It answers
/// the place chosen, 1 to 3.
fn sys_error_box_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (text, caption, buttons) = {
            let system = engine.system();
            let text = args.dword(&system);
            let caption = args.dword(&system);
            let buttons = [args.word(&system), args.word(&system), args.word(&system)];
            let string = |far: u32| match text_argument(&system, far) {
                Text::Null => Some(Vec::new()),
                Text::Number(number) => Some(number.to_string().into_bytes()),
                Text::Read(bytes) => Some(bytes),
                Text::Refused => None,
            };
            let (Some(text), Some(caption)) = (string(text), string(caption)) else {
                return Ok(Answer::Word(0));
            };

            (text, caption, buttons)
        };

        Ok(Answer::Word(
            engine.sys_error_box(&text, &caption, buttons)?,
        ))
    })
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "SysErrorBox" => Implementation::Async(sys_error_box_call),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::lines_of;

    #[test]
    fn the_text_is_three_lines_at_most() {
        assert_eq!(
            lines_of(b"a\nb\nc\nd"),
            vec![b"a".to_vec(), b"b".to_vec(), b"c".to_vec()]
        );
        assert_eq!(lines_of(b"a\n"), vec![b"a".to_vec()]);
        assert_eq!(
            lines_of(b"a\n\nb"),
            vec![b"a".to_vec(), Vec::new(), b"b".to_vec()]
        );
        assert_eq!(lines_of(b""), vec![Vec::<u8>::new()]);
    }
}
