//! The standard controls as USER paints them, as winbox.js's `controls.ts`
//! and `desktop.ts` (`paintControl`, `#controlEnvironment`, the focus
//! rectangles) paint them: what a control's own window procedure does with
//! `WM_PAINT`, onto its client area where it shows.
//!
//! Read off the `chrome` probe's `controls` window, one of each on each of
//! four displays: a push button, a default push button, a checked check
//! box, a checked radio button and static text; and the `groupbox`,
//! `btndis`, `btnfocus`, `ctltrans` and `dialogs` probes. The edit control,
//! the list box, the combo box and the scroll bar control paint themselves
//! with their own state, which is not here: their pixels come with them.
//!
//! What a control's parent answered `WM_CTLCOLOR` stands for the system
//! colours it replaces -- the brush for the window colour, or a scroll
//! bar's colour, and the text colour for the window's text -- and the
//! background colour its text is drawn on. A push button and a scroll bar
//! draw no text on it (`ctlcolor.ts`).

use winbox_raster::{DeviceBitmap, matched_index};

use crate::call::Stop;
use crate::controls::{ControlColours, ControlState};
use crate::draw_text::{TextOps, layout_plain};
use crate::frame::{Lettering, bytes_of};
use crate::gdi::text_out::Bounds;
use crate::painter::{PaintEnv, Painter};
use crate::system::System;

const BS_PUSHBUTTON: u32 = 0x0;
const BS_DEFPUSHBUTTON: u32 = 0x1;
const BS_CHECKBOX: u32 = 0x2;
const BS_AUTOCHECKBOX: u32 = 0x3;
const BS_RADIOBUTTON: u32 = 0x4;
const BS_3STATE: u32 = 0x5;
const BS_AUTO3STATE: u32 = 0x6;
const BS_GROUPBOX: u32 = 0x7;
const BS_AUTORADIOBUTTON: u32 = 0x9;

const SS_RIGHT: u32 = 0x02;
const SS_ICON: u32 = 0x03;
const SS_BLACKRECT: u32 = 0x04;
const SS_WHITERECT: u32 = 0x06;
const SS_WHITEFRAME: u32 = 0x09;
const SS_USERITEM: u32 = 0x0a;
const SS_LEFTNOWORDWRAP: u32 = 0x0c;
const SS_NOPREFIX: u32 = 0x80;

const WS_DISABLED: u32 = 0x0800_0000;

const OBM_CHECKBOXES: u16 = 32759;

const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;

const COLOR_WINDOW: usize = 5;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_WINDOWTEXT: usize = 8;
const COLOR_BTNFACE: usize = 15;
const COLOR_BTNSHADOW: usize = 16;
const COLOR_GRAYTEXT: usize = 17;
const COLOR_BTNTEXT: usize = 18;
const COLOR_BTNHIGHLIGHT: usize = 20;

/// The rectangles' and frames' colours: black, grey and white, as USER's
/// brushes are.
const RECT_COLOURS: [usize; 3] = [6, 1, 5];

/// The room between a check box's box and its text.
const CHECK_TEXT_GAP: i32 = 5;

/// Which pixels a grayed label keeps what was there: those whose x and y
/// add to an odd number, from the corner of what the label is drawn on --
/// or, for a control's text, from where the text starts, as `GrayString`
/// draws it into a bitmap of its own (`btndis`). Measured on the VGA's
/// selected, grayed Restore and the Hercules's grayed Paste.
const GRAY_PHASE: i32 = 1;

/// A control's text as it shows: `&&` is an ampersand, and a lone `&` is
/// dropped -- as is one before a line's end, which leaves the end.
fn plain(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;

    while at < text.len() {
        if text[at] != b'&' {
            out.push(text[at]);
            at += 1;
            continue;
        }

        match text.get(at + 1) {
            Some(&next) if next != b'\n' && next != b'\r' => {
                out.push(next);
                at += 2;
            }
            _ => at += 1,
        }
    }

    out
}

/// Where a control's mnemonic is: the character after the last lone `&`,
/// `&&` being one ampersand -- and the text before its `&`.
fn mnemonic(text: &[u8]) -> Option<(usize, u8)> {
    let mut paired = text.to_vec();
    let mut at = 0;

    while at + 1 < paired.len() {
        if paired[at] == b'&' && paired[at + 1] == b'&' {
            paired[at] = 0;
            paired[at + 1] = 0;
            at += 2;
        } else {
            at += 1;
        }
    }

    let mut found = None;
    let mut at = 0;

    while at + 1 < paired.len() {
        if paired[at] == b'&' && paired[at + 1] != b'&' {
            found = Some((at, paired[at + 1]));
            at += 2;
        } else {
            at += 1;
        }
    }

    found
}

/// What painting a control asks: the painting, the fonts, its state.
// Each is a yes or no of the control's, as USER asks it.
#[allow(clippy::struct_excessive_bools)]
struct ControlEnv<'a> {
    paint: PaintEnv<'a>,
    bitmap: DeviceBitmap,
    width: i32,
    height: i32,
    /// The System font, which a grayed label is always drawn in.
    system_letters: Lettering,
    /// The control's own font, or the System font.
    letters: Lettering,
    own_font: bool,
    /// The background colour its text is drawn on, where its parent
    /// answered one.
    ground: Option<u32>,
    hollow: bool,
    disabled: bool,
    focused: bool,
    /// The System font's average width, as `GetDialogBaseUnits` gives it
    /// across.
    system_average: i32,
    colours: Option<ControlColours>,
}

impl ControlEnv<'_> {
    fn painter(&self) -> Painter<'_> {
        Painter::new(
            self.bitmap.clone(),
            0,
            0,
            self.width,
            self.height,
            &self.paint,
        )
    }

    fn measure(&self, line: &[u8]) -> i32 {
        self.letters.measure(line)
    }

    /// A line of text in the control's font, its cell's top left at `x, y`:
    /// on the background colour, the cell it takes, where there is one.
    fn text(&self, line: &[u8], colour: u32, x: i32, y: i32) {
        if let Some(ground) = self.ground {
            let painter = self.painter();

            painter.fill(
                x,
                y,
                x + self.measure(line),
                y + self.letters.height,
                painter.solid(ground),
            );
        }

        self.letters
            .text(self.paint.system, &self.bitmap, line, colour, x, y);
    }

    /// A label grayed, as the desktop draws one: in the System font, its
    /// first `&` dropped and the character after it underlined a row below
    /// the ascent, then what was there put back through every other pixel,
    /// as `GrayString` draws through a gray brush.
    fn gray_label(&self, line: &[u8], colour: u32, x: i32, y: i32) {
        let bitmap = &self.bitmap;
        let letters = &self.system_letters;
        let at = line.iter().position(|&byte| byte == b'&');
        let mut shown = line.to_vec();

        if let Some(at) = at {
            shown.remove(at);
        }

        let width = letters.measure(&shown);
        let height = letters.height;
        let kept: Vec<Option<u8>> = (0..height)
            .flat_map(|row| (0..width).map(move |column| (column, row)))
            .map(|(column, row)| bitmap.index_at(x + column, y + row))
            .collect();

        letters.text(self.paint.system, bitmap, &shown, colour, x, y);

        // The mnemonic, underlined a row below the ascent.
        if let Some(at) = at.filter(|&at| at < shown.len()) {
            let under = x + letters.measure(&shown[..at]);
            let index = bitmap.device_palette.borrow_mut().index(
                colour as u8,
                (colour >> 8) as u8,
                (colour >> 16) as u8,
            ) as u8;
            let across = letters.measure(&shown[at..=at]);

            for column in 0..across {
                bitmap.put(under + column, y + letters.ascent + 1, index);
            }

            bitmap.context.mark_rect(
                under,
                y + letters.ascent + 1,
                under + across,
                y + letters.ascent + 2,
            );
        }

        for row in 0..height {
            for column in 0..width {
                let (px, py) = (x + column, y + row);

                if (column + row) & 1 == GRAY_PHASE
                    && let Some(was) = kept[(row * width + column) as usize]
                {
                    bitmap.put(px, py, was);
                }
            }
        }
    }

    /// The dotted focus rectangle, as `DrawFocusRect` draws it in the
    /// control's device context: in the colours its parent answered, where
    /// it answered; Caribbean Treasure answers a grey background, and its
    /// button's dots show black on grey.
    fn focus(&self, left: i32, top: i32, right: i32, bottom: i32) {
        let system = self.paint.system;
        let (text, back) = match self.colours {
            Some(colours) => (colours.text, colours.ground),
            None => (
                system.sys_color(COLOR_WINDOWTEXT),
                system.sys_color(COLOR_WINDOW),
            ),
        };

        focus_in(system, &self.bitmap, left, top, right, bottom, text, back);
    }

    /// A control's text, its mnemonic underlined: the character after the
    /// last lone `&`, a line under it a row below the font's ascent -- the
    /// menu bar's rule, which the `menus` probe measured and `dialogs` shows
    /// controls keep. Static text with `SS_NOPREFIX` shows its ampersands
    /// as they are. A disabled control's text is its own colour through
    /// every other pixel, as `GrayString` draws it (`btndis`).
    fn label(&self, text: &[u8], colour: usize, x: i32, y: i32, prefix: bool) {
        let ink = self.paint.sys_color(colour);

        if self.disabled {
            let line = if prefix {
                text.to_vec()
            } else {
                text.iter()
                    .flat_map(|&byte| {
                        if byte == b'&' {
                            vec![b'&', b'&']
                        } else {
                            vec![byte]
                        }
                    })
                    .collect()
            };

            self.gray_label(&line, ink, x, y);
            return;
        }

        if !prefix {
            self.text(text, ink, x, y);
            return;
        }

        self.text(&plain(text), ink, x, y);

        // With more than one, the last is underlined, as static text and
        // `DrawText` have it (`multipfx`): FIBS/W's `&I &A&gr&e&e`.
        //
        // Measured by the `dialogs` probe: under an emboldened font, whose
        // text measures a pixel wider than it draws, the line starts that
        // overhang to the left -- the extents with the overhang taken off,
        // as `DrawText` works them out. With the System font there is none.
        if let Some((at, character)) = mnemonic(text) {
            let under = x + self.measure(&plain(&text[..at])) - self.letters.overhang;
            let row = y + self.letters.ascent + 1;
            let painter = self.painter();

            painter.fill(
                under,
                row,
                under + self.measure(&[character]),
                row + 1,
                painter.colour(colour),
            );
        }
    }
}

/// `focusRectangle`'s dots, in a text and a background colour as
/// `COLORREF`s: each side exclusive-ored onto the pixels -- the background's
/// colour where the coordinates add to an odd number, the text's where even
/// -- so a corner, on two sides, comes back as it was. The colours are
/// matched as the display's driver matches them, the static colours only on
/// the 256-colour display (`palsys`). **Recorded** by `listbox` and
/// `combobox`.
#[allow(clippy::too_many_arguments)]
pub fn focus_in(
    system: &System,
    bitmap: &DeviceBitmap,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    text: u32,
    back: u32,
) {
    let display = system.display_kind();
    let index = |colour: u32| {
        matched_index(
            display,
            &mut bitmap.device_palette.borrow_mut(),
            colour as u8,
            (colour >> 8) as u8,
            (colour >> 16) as u8,
        ) as u8
    };
    let (ink, ground) = (index(text), index(back));
    let flip = |x: i32, y: i32| {
        if let Some(was) = bitmap.index_at(x, y) {
            bitmap.put(x, y, was ^ if (x + y) & 1 != 0 { ground } else { ink });
        }
    };

    for x in left..right {
        flip(x, top);
        flip(x, bottom - 1);
    }

    for y in top..bottom {
        flip(left, y);
        flip(right - 1, y);
    }

    bitmap.context.mark_rect(left, top, right, bottom);
}

/// What laying static text out draws with: the control's own painting.
struct StaticOps<'a> {
    env: &'a ControlEnv<'a>,
    colour: usize,
}

impl TextOps<()> for StaticOps<'_> {
    fn extent(&self, (): &mut (), text: &[u8]) -> Result<i64, Stop> {
        Ok(if text.is_empty() {
            0
        } else {
            i64::from(self.env.measure(text))
        })
    }

    fn text_out(&self, (): &mut (), x: i64, y: i64, text: &[u8]) -> Result<(), Stop> {
        let ink = self.env.paint.sys_color(self.colour);

        self.env.text(text, ink, x as i32, y as i32);
        Ok(())
    }

    fn underline(&self, (): &mut (), rect: Bounds) -> Result<(), Stop> {
        let painter = self.env.painter();

        painter.fill(
            rect.left as i32,
            rect.top as i32,
            rect.right as i32,
            rect.bottom as i32,
            painter.colour(self.colour),
        );
        Ok(())
    }

    fn metrics(&self) -> (i64, i64, i64) {
        let letters = &self.env.letters;

        (
            i64::from(letters.height),
            i64::from(letters.ascent),
            i64::from(letters.overhang),
        )
    }
}

impl System {
    /// Paints a standard control's client area, where it shows, and marks
    /// it painted: what the control's own window procedure does with
    /// `WM_PAINT`. In its own font, when it has been given one.
    /// `paint_control` where it is painted at once, outside its
    /// `WM_PAINT`: an edit control's text changed, a scroll bar's thumb
    /// moved. The one thing that stops painting -- a font given it that is
    /// no font, where the TypeScript engine throws -- is let pass here.
    pub fn repaint_control(&mut self, index: usize) {
        let _ = self.paint_control(index);
    }

    pub fn paint_control(&mut self, index: usize) -> Result<(), Stop> {
        let Some(window) = self.windows[index].as_mut() else {
            return Ok(());
        };

        window.needs_erase = false;
        window.needs_paint = false;

        if window.control.is_none() || !self.showing(index) {
            return Ok(());
        }

        let Some(bitmap) = self.window_view(index) else {
            return Ok(());
        };
        let Some(system_letters) = self.system_lettering() else {
            return Ok(());
        };
        let window = self.windows[index].as_ref().expect("a window");
        let control = window.control.clone().expect("a control");
        let style = window.style;
        let (width, height) = (window.client_width(), window.client_height());
        let own = match control.font {
            Some(handle) => Some(self.control_lettering(handle)?),
            None => None,
        };
        let colours = control.colours;
        let kind = control.style & 0x0f;
        let scroll_bar = control.class_name == "SCROLLBAR";
        let push =
            control.class_name == "BUTTON" && (kind == BS_PUSHBUTTON || kind == BS_DEFPUSHBUTTON);
        let letters_text = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let system_average = (system_letters.measure(letters_text) / 26 + 1) / 2;
        let mut paint = PaintEnv::new(self);

        if let Some(colours) = colours {
            paint.control = Some((colours, scroll_bar));
            paint.pattern_origin = colours.brush_origin;
        }

        let env = ControlEnv {
            paint,
            bitmap,
            width,
            height,
            letters: own.clone().unwrap_or_else(|| system_letters.clone()),
            own_font: own.is_some(),
            system_letters,
            // Text on the background colour, unless the mode is
            // transparent; the brush filled, unless it is hollow
            // (`ctltrans`). BWCC answers both for the text on its panels.
            ground: colours
                .filter(|colours| !scroll_bar && !push && !colours.transparent)
                .map(|colours| colours.ground),
            hollow: colours.is_some_and(|colours| colours.hollow),
            disabled: style & WS_DISABLED != 0,
            focused: self.focus == Some(index),
            system_average,
            colours,
        };

        match control.class_name.as_str() {
            "BUTTON" => match kind {
                BS_PUSHBUTTON | BS_DEFPUSHBUTTON => {
                    push_button(&env, &control, kind == BS_DEFPUSHBUTTON);
                }
                BS_CHECKBOX | BS_AUTOCHECKBOX | BS_RADIOBUTTON | BS_AUTORADIOBUTTON | BS_3STATE
                | BS_AUTO3STATE => check_box(&env, &control, kind),
                BS_GROUPBOX => group_box(&env, &control),
                _ => {}
            },
            "STATIC" => static_control(&env, &control)?,
            // The edit control, the list box and the scroll bar paint
            // themselves with state of their own, which comes with them.
            _ => {}
        }

        // A push button with the focus: its dotted rectangle.
        if env.focused
            && let Some([left, top, right, bottom]) = focus_rect(
                &env,
                &control,
                (self.metric(SM_CXBORDER), self.metric(SM_CYBORDER)),
                self.display.height > 300,
            )
        {
            env.focus(left, top, right, bottom);
        }

        Ok(())
    }

    /// The font `WM_SETFONT` gave a control, realised, with its metrics.
    fn control_lettering(&mut self, handle: u16) -> Result<Lettering, Stop> {
        let font = match self.gdi_object_of(handle) {
            Some((object, crate::gdi::GdiObject::Font(_))) => {
                crate::gdi::text::realised(self, object)?
            }
            _ => None,
        };

        font.map(Lettering::of)
            .ok_or(Stop::Unsupported("a control's font that is no font"))
    }

    /// `focusRectangle`: the dots in system colours, the window text's and
    /// the window's unless given, onto a window's client area.
    pub fn focus_rectangle(
        &mut self,
        index: usize,
        rect: [i32; 4],
        colours: Option<(usize, usize)>,
    ) {
        let (text, back) = colours.unwrap_or((COLOR_WINDOWTEXT, COLOR_WINDOW));
        let (text, back) = (self.sys_color(text), self.sys_color(back));
        let Some(bitmap) = self.window_view(index) else {
            return;
        };
        let [left, top, right, bottom] = rect;

        focus_in(self, &bitmap, left, top, right, bottom, text, back);
    }
}

/// A push button: an outline in the frame colour without its corners, a
/// second outline inside it for the default button, and a raised face two
/// pixels deep, its text centred.
///
/// The text is centred down by the font's ascent, not its height: half of
/// what the button leaves beside the ascent, less one. It fits every push
/// button recorded -- `chrome`'s, 24 high in the System font on four
/// displays, and `dialogs`' in the System font and bold MS Sans Serif.
fn push_button(env: &ControlEnv, control: &ControlState, default: bool) {
    let painter = env.painter();
    let (width, height) = (env.width, env.height);
    let line = painter.colour(COLOR_WINDOWFRAME);
    let light = painter.colour(COLOR_BTNHIGHLIGHT);
    let shadow = painter.colour(COLOR_BTNSHADOW);

    painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
    painter.fill(1, 0, width - 1, 1, line);
    painter.fill(1, height - 1, width - 1, height, line);
    painter.fill(0, 1, 1, height - 1, line);
    painter.fill(width - 1, 1, width, height - 1, line);

    let inset = i32::from(default);

    if default {
        painter.outline(1, 1, width - 1, height - 1, line);
    }

    let [left, right, top, bottom] = [inset, width - inset, inset, height - inset];

    painter.fill(
        left + 1,
        top + 1,
        right - 1,
        bottom - 1,
        painter.colour(COLOR_BTNFACE),
    );

    for deep in 0..2 {
        painter.fill(
            left + 1,
            top + 1 + deep,
            right - 2 - deep,
            top + 2 + deep,
            light,
        );
        painter.fill(
            left + 1 + deep,
            top + 1,
            left + 2 + deep,
            bottom - 2 - deep,
            light,
        );
        painter.fill(
            right - 2 - deep,
            top + 1 + deep,
            right - 1 - deep,
            bottom - 1,
            shadow,
        );
        painter.fill(
            left + 1 + deep,
            bottom - 2 - deep,
            right - 1,
            bottom - 1 - deep,
            shadow,
        );
    }

    let text = bytes_of(&control.text);
    let across = (width - env.measure(&plain(&text))).div_euclid(2) - 1;
    let down = (height - env.letters.ascent).div_euclid(2) - 1;

    env.label(&text, COLOR_BTNTEXT, across, down, true);
}

/// Where a push button with the focus draws its dotted rectangle, around
/// its caption (`USER.EXE` seg25 `15d3`): two borders left of the text and
/// two right, one above and two below, inside the client area; and inside
/// its own edge too -- at least three borders from the top (two on a screen
/// of 300 rows or fewer, seg3 `0d44`) and four from the bottom. None for
/// anything else.
fn focus_rect(
    env: &ControlEnv,
    control: &ControlState,
    border: (i32, i32),
    tall_screen: bool,
) -> Option<[i32; 4]> {
    let kind = control.style & 0x0f;

    if control.class_name != "BUTTON" || (kind != BS_PUSHBUTTON && kind != BS_DEFPUSHBUTTON) {
        return None;
    }

    let (width, height) = (env.width, env.height);
    let text_width = env.measure(&plain(&bytes_of(&control.text)));
    let x = (width - text_width).div_euclid(2) - 1;
    let y = (height - env.letters.ascent).div_euclid(2) - 1;
    let left = (x - 2 * border.0).max(0);
    let right = width.min(left + text_width + 4 * border.0);
    let mut top = (y - border.1).max(0);
    let mut bottom = height.min(top + env.letters.height + 3 * border.1);

    top = top.max(if tall_screen { 3 } else { 2 } * border.1);
    bottom = bottom.min(height - 4 * border.1);

    Some([left, top, right, bottom])
}

/// A check box or radio button: its image from the display driver's
/// `OBM_CHECKBOXES` -- check boxes in the first row, radio buttons in the
/// second, three-state boxes in the third, unchecked and checked across --
/// centred at the left, and its text after it. With its parent's colours,
/// its black is the text colour and its white the brush's (`ctlcolor`);
/// with the defaults, as it is.
fn check_box(env: &ControlEnv, control: &ControlState, kind: u32) {
    let painter = env.painter();
    let (width, height) = (env.width, env.height);
    let images = env.paint.oem(OBM_CHECKBOXES);

    painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));

    let cell_width = images.map_or(14, |images| images.width() / 4);
    let cell_height = images.map_or(13, |images| images.height() / 3);
    let box_width = cell_width - 1;
    let row = match kind {
        BS_RADIOBUTTON | BS_AUTORADIOBUTTON => 1,
        BS_3STATE | BS_AUTO3STATE => 2,
        _ => 0,
    };
    let column = i32::from(control.checked != 0);
    let remap = if env.ground.is_some() {
        let (black, white) = {
            let mut palette = painter.screen.device_palette.borrow_mut();

            (
                palette.index(0, 0, 0) as u8,
                palette.index(255, 255, 255) as u8,
            )
        };

        // As a map is made, the later of two the same -- white -- wins.
        vec![
            (white, painter.colour(COLOR_WINDOW)),
            (black, painter.colour(COLOR_WINDOWTEXT)),
        ]
    } else {
        Vec::new()
    };

    painter.blit_part(
        images,
        0,
        (height - cell_height).div_euclid(2),
        box_width,
        column * cell_width,
        cell_height,
        row * cell_height,
        &remap,
    );

    let text = bytes_of(&control.text);
    let x = box_width + CHECK_TEXT_GAP;
    let y = (height - env.letters.height).div_euclid(2) + 1;

    env.label(&text, COLOR_WINDOWTEXT, x, y, true);

    // The focus around its text, drawn as the push button's is: two pixels
    // out from the text left and right, one above, and at the font's height
    // below, kept inside the control (`btnfocus`).
    if env.focused {
        let left = (x - 2).max(0);
        let top = (y - 1).max(0);
        let right = width.min(x + env.measure(&plain(&text)) + 2);
        let bottom = height.min(y + env.letters.height);

        env.focus(left, top, right, bottom);
    }
}

/// A group box (`USER.EXE` seg25 `193a`): an outline in the frame colour on
/// its rectangle, the top line half the font's height down, and its caption
/// over that line on a ground of the control colour. The ground starts a
/// pixel before the **System** font's average width, whatever font the
/// caption is in, and is the caption's size and four more each way; the
/// caption is two in, and half of the descent and four down. The inside is
/// never painted, so what lies in it -- a dialog's radio buttons -- shows.
///
/// **Read out**, and **recorded** by `groupbox`: two group boxes in bold MS
/// Sans Serif and two in the System font, on four displays.
fn group_box(env: &ControlEnv, control: &ControlState) {
    let painter = env.painter();
    let high = env.letters.height;

    painter.outline(
        0,
        high / 2,
        env.width,
        env.height,
        painter.colour(COLOR_WINDOWFRAME),
    );

    let text = bytes_of(&control.text);
    let shown = plain(&text);

    if shown.is_empty() {
        return;
    }

    let left = env.system_average - 1;
    let across = env.measure(&shown);

    painter.fill(
        left,
        0,
        left + across + 4,
        high + 4,
        painter.colour(COLOR_WINDOW),
    );
    env.label(
        &text,
        COLOR_WINDOWTEXT,
        left + 2,
        (high + 4 - env.letters.ascent) / 2,
        true,
    );
}

/// A static control painted (`USER.EXE` seg25 `20da`): its client area
/// filled -- unless its parent answered a hollow brush, when the parent
/// shows (`ctltrans`) -- then by its type, the style's low seven bits.
/// Text -- left, centred or right, and `SS_LEFTNOWORDWRAP` -- is laid out
/// as `DrawText` lays it out (seg25 `1fe5`): with `DT_WORDBREAK |
/// DT_EXPANDTABS` and the type's alignment, or for `SS_LEFTNOWORDWRAP` with
/// `DT_EXPANDTABS | DT_NOCLIP`; and `DT_NOPREFIX` with `SS_NOPREFIX`.
/// Disabled, it is in `COLOR_GRAYTEXT`, solid (`btndis`). `SS_ICON` draws
/// its icon at its corner. The rectangles, 4 to 6, fill it with a system
/// colour's brush: black is `COLOR_WINDOWFRAME`, grey `COLOR_BACKGROUND`
/// and white `COLOR_WINDOW` (seg25 `2220`); the frames, 7 to 9, draw a line
/// of the same round it (seg25 `2245`); 10 draws nothing. Not followed:
/// `SS_SIMPLE`'s own path, which is drawn as one line.
fn static_control(env: &ControlEnv, control: &ControlState) -> Result<(), Stop> {
    let painter = env.painter();
    let (width, height) = (env.width, env.height);
    let kind = control.style & 0x7f;

    if !env.hollow {
        painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
    }

    if kind == SS_ICON {
        if let Some(icon) = &control.icon {
            crate::desktop_paint::draw_icon_at(&env.bitmap, 0, 0, icon);
        }

        return Ok(());
    }

    if (SS_BLACKRECT..=SS_WHITEFRAME).contains(&kind) {
        let colour = painter.colour(RECT_COLOURS[((kind - SS_BLACKRECT) % 3) as usize]);

        if kind <= SS_WHITERECT {
            painter.fill(0, 0, width, height, colour);
        } else {
            painter.outline(0, 0, width, height, colour);
        }

        return Ok(());
    }

    if kind == SS_USERITEM {
        return Ok(());
    }

    let text = bytes_of(&control.text);

    if kind > SS_RIGHT && kind != SS_LEFTNOWORDWRAP {
        env.label(
            &text,
            COLOR_WINDOWTEXT,
            0,
            0,
            control.style & SS_NOPREFIX == 0,
        );
        return Ok(());
    }

    let mut format = if kind == SS_LEFTNOWORDWRAP {
        0x0140
    } else {
        kind as u16 | 0x0050
    };

    if control.style & SS_NOPREFIX != 0 {
        format |= 0x0800;
    }

    let colour = if env.disabled {
        COLOR_GRAYTEXT
    } else {
        COLOR_WINDOWTEXT
    };
    let ops = StaticOps { env, colour };
    // The average tab stops are counted in: USER's own for the System
    // font, from the extent of the alphabet; the font's own otherwise.
    let average = if env.own_font {
        i64::from(env.letters.average)
    } else {
        let letters = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

        i64::from((env.measure(letters) / 26 + 1) / 2)
    };

    layout_plain(
        &mut (),
        &ops,
        &text,
        [0, 0, i64::from(width), i64::from(height)],
        format,
        average,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_drops_lone_ampersands() {
        assert_eq!(plain(b"&File"), b"File");
        assert_eq!(plain(b"A && B"), b"A & B");
        assert_eq!(plain(b"end&"), b"end");
        assert_eq!(plain(b"a&\nb"), b"a\nb");
    }

    #[test]
    fn the_last_lone_ampersand_is_the_mnemonic() {
        assert_eq!(mnemonic(b"&I &A&gr&e&e"), Some((10, b'e')));
        assert_eq!(mnemonic(b"A && B"), None);
        assert_eq!(mnemonic(b"&&&x"), Some((2, b'x')));
    }
}
