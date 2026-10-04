//! Text drawn: `TextOut` and `ExtTextOut`, onto the pixels a device
//! context draws on, as the TypeScript engine's `Surface` draws it -- the
//! ground behind the text under the background mode and colour, the glyphs
//! in the text colour, and the underline and strikeout -- each as recorded
//! (`kb/gdi/textout.md`).
//!
//! The font is the one selected, realised as `text` realises it: a strike,
//! a plotter font, whose strokes are drawn with the display driver's line,
//! or an outline face, drawn as `outline` draws it -- hinted, smeared where
//! GDI synthesises a bold, and turned where an escapement asks, with the
//! ground and the rules turned with it.
//!
//! The selected brush plays no part: `textbk` drew with the black stock
//! brush selected, in both modes, and the cell came back as it would with
//! the white one.
//!
//! The colours are looked up as the text is drawn, against the palette of
//! the pixels drawn on. The TypeScript engine looks a palette's colour up
//! as `SetTextColor` and `SetBkColor` are called instead, against the
//! bitmap selected then; the two part company only for a palette's colour
//! set before a memory context's bitmap is selected, which nothing recorded
//! does.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]
// Deliberately: coordinates in a JavaScript number's precision, as the
// TypeScript engine's are.
#![allow(clippy::cast_precision_loss)]

use winbox_raster::line_walk::{self, LineTie, Walk};
use winbox_raster::logical_font::round;
use winbox_raster::text_draw::{DrawOptions, draw_strike, fill_rect};
use winbox_raster::{DeviceBitmap, LogicalFont, Measure};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::fonts::{BoldOverhang, Device};
use crate::system::System;

use super::dc::dc_of;
use super::mapping::mapping_of;
use super::text::{
    Text, font_of, gdi_draws, get_text_extent, is_break, sliced, text_argument, unreadable,
};

pub(crate) mod outline;

const TA_UPDATECP: u16 = 0x0001;
const TA_RIGHT: u16 = 0x0002;
const TA_CENTER: u16 = 0x0006;
const TA_BOTTOM: u16 = 0x0008;
const TA_BASELINE: u16 = 0x0018;
const TRANSPARENT: u16 = 1;
const ETO_OPAQUE: u16 = 0x0002;
const ETO_CLIPPED: u16 = 0x0004;

const BLACK: [u8; 4] = [0, 0, 0, 0xff];
const WHITE: [u8; 4] = [0xff, 0xff, 0xff, 0xff];

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "TextOut" => Implementation::Sync(text_out_call),
        "ExtTextOut" => Implementation::Sync(ext_text_out_call),
        _ => return None,
    })
}

/// A rectangle, its right and bottom edges outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub left: i64,
    pub top: i64,
    pub right: i64,
    pub bottom: i64,
}

/// A colour of a device context, as the program gave it, in the colours of
/// the pixels it is drawn on: none is the default.
pub(crate) fn colour_in(
    system: &System,
    index: usize,
    target: &DeviceBitmap,
    colorref: Option<u32>,
    none: [u8; 4],
) -> [u8; 4] {
    let Some(colorref) = colorref else {
        return none;
    };
    let colour = super::draw::dc_colour(system, index, &target.device_palette, colorref);

    [colour.red(), colour.green(), colour.blue(), 0xff]
}

/// The pixels a device context draws on, or, where there are none to be
/// had -- a window's context after the window is gone -- pixels of no size,
/// on which drawing draws nothing.
/// Kept to the context's clip region, as all drawing is (`draw::canvas`).
pub(crate) fn target_of(system: &mut System, index: usize) -> DeviceBitmap {
    super::draw::canvas(system, index).unwrap_or_else(|| DeviceBitmap::new(0, 0, 1, None, None))
}

/// What drawing text in a device context draws with: the pixels, the font,
/// and the context's text state -- the TypeScript engine's `Surface`, as
/// far as text goes.
pub(crate) struct Writer {
    pub target: DeviceBitmap,
    font: LogicalFont,
    back_mode: u16,
    text_align: u16,
    char_extra: i64,
    pub back: [u8; 4],
    text: [u8; 4],
    walk: Walk,
    /// Set while `ext_text` draws the characters of a run one at a time.
    run_only: bool,
    /// Whether the display's driver keeps a smear's overhang: a Hercules.
    bold_always: bool,
}

impl Writer {
    /// A device context's writer, by its index. The font selected must be
    /// there: the TypeScript engine has nothing to draw text with else, and
    /// throws.
    pub(crate) fn of(system: &mut System, index: usize) -> Result<Self, Stop> {
        let Some(font) = font_of(system, index)? else {
            return Err(Stop::Unsupported("text drawn with no font"));
        };
        let target = target_of(system, index);
        let state = &system.gdi.dcs[index].state;
        let walk = Walk {
            tie: if system.display.line_tie.as_deref() == Some("slope") {
                LineTie::Slope
            } else {
                LineTie::Top
            },
            clips: system.display.caps.clip_caps != 0,
            exclude_last: true,
            polyline: true,
        };

        Ok(Self {
            back: colour_in(system, index, &target, state.back_color, WHITE),
            text: colour_in(system, index, &target, state.text_color, BLACK),
            target,
            font,
            back_mode: state.back_mode,
            text_align: state.text_align,
            char_extra: i64::from(state.char_extra as i16),
            walk,
            run_only: false,
            bold_always: Device::of(&system.display).bold_overhang == Some(BoldOverhang::Always),
        })
    }

    /// A writer of USER's own, as the desktop draws a caption, a menu
    /// bar's item or a control's text: no device context's, transparent,
    /// from the cell's corner, in a colour of its own.
    pub(crate) fn user(
        system: &System,
        target: DeviceBitmap,
        font: LogicalFont,
        colour: [u8; 4],
    ) -> Self {
        let walk = Walk {
            tie: if system.display.line_tie.as_deref() == Some("slope") {
                LineTie::Slope
            } else {
                LineTie::Top
            },
            clips: system.display.caps.clip_caps != 0,
            exclude_last: true,
            polyline: true,
        };

        Self {
            target,
            font,
            back_mode: TRANSPARENT,
            text_align: 0,
            char_extra: 0,
            back: WHITE,
            text: colour,
            walk,
            run_only: false,
            bold_always: Device::of(&system.display).bold_overhang == Some(BoldOverhang::Always),
        }
    }

    /// The width and height of text in the font: `LogicalFont.measure`,
    /// the overhang of a bold or a slant included.
    fn measure(&self, text: &[u8]) -> Result<(i64, i64), Stop> {
        let (width, height) = self
            .font
            .try_measure(text, Measure::default())
            .map_err(unreadable)?;

        Ok((width as i64, height as i64))
    }

    /// The ascent: an outline face's as the mapper found it, and a strike's
    /// or a plotter font's stretched the way `GetTextMetrics` stretches it,
    /// the design value carried to the cell drawn and rounded on its own.
    fn ascent(&self) -> i64 {
        if let Some(outline) = &self.font.outline {
            return outline.ascent as i64;
        }

        self.scaled(i64::from(self.font.strike().header.ascent))
    }

    /// The internal leading, scaled the way the ascent is; nought for an
    /// outline face.
    fn internal(&self) -> i64 {
        if self.font.outline.is_some() {
            return 0;
        }

        self.scaled(i64::from(self.font.strike().header.internal_leading))
    }

    fn scaled(&self, value: i64) -> i64 {
        let scale = self.font.scale();
        let design = f64::from(self.font.strike().header.pix_height);

        if (scale - 1.0).abs() < f64::EPSILON {
            value
        } else {
            round(value as f64 * round(design * scale) / design) as i64
        }
    }

    /// Where the point handed to `TextOut` puts the text, as `SetTextAlign`
    /// names it: left, centre or right across, and top, bottom or baseline
    /// down. **Measured** by `textalin`, which draws in the middle of the
    /// cell so that a shift has somewhere to go -- right moves the text
    /// left by the whole advance, centre by half of it truncated, bottom
    /// moves it up by the cell and baseline by the ascent.
    ///
    /// Turned text is aligned in its own frame (see `outline`), and is not
    /// moved here.
    fn aligned(
        &self,
        x: i64,
        y: i64,
        text: &[u8],
        run_width: Option<i64>,
    ) -> Result<(i64, i64), Stop> {
        if self.turned_text() || self.text_align == 0 {
            return Ok((x, y));
        }

        // Measured twice where no run width is given, as the TypeScript
        // engine measures: an outline's measuring fits glyphs, and the
        // interpreter keeps state from one to the next.
        let (_, height) = self.measure(text)?;
        let width = match run_width {
            Some(width) => width,
            None => self.measure(text)?.0,
        };
        let across = self.text_align & 0x06;
        let down = self.text_align & 0x18;
        let x = match across {
            TA_RIGHT => x - width,
            TA_CENTER => x - width.div_euclid(2),
            _ => x,
        };
        let y = match down {
            TA_BOTTOM => y - height,
            TA_BASELINE => y - self.ascent(),
            _ => y,
        };

        Ok((x, y))
    }

    /// The box the ground behind text is painted over, from the pen: a
    /// strike's is its advance, and with an array of distances it is the
    /// pens the array makes plus the **last glyph's own advance**.
    /// **Measured** by `groundrn`: MS Sans Serif at a cell of sixteen with
    /// twenty and twenty is painted over twenty-nine.
    ///
    /// An outline face's is its glyphs' boxes united with the advance; see
    /// `outline::Pen::ground_box`.
    fn ground_box(
        &self,
        text: &[u8],
        dx: Option<&[i64]>,
        ink_only: bool,
    ) -> Result<(i64, i64, i64), Stop> {
        if let Some(pen) = self.pen() {
            let (left, right, height) = pen.ground_box(text, dx, ink_only)?;

            return Ok((left as i64, right as i64, height as i64));
        }

        let (width, height) = self.measure(text)?;
        let Some(dx) = dx.filter(|_| !text.is_empty()) else {
            return Ok((0, width, height));
        };
        let mut width = 0;

        for distance in dx.iter().take(text.len() - 1) {
            width += distance + self.char_extra;
        }

        width += self.measure(&text[text.len() - 1..])?.0;

        Ok((0, width, height))
    }

    /// The cell behind the text, painted before the text is, in the
    /// background colour and only where the background mode says to paint
    /// it at all. **Recorded** by `textbk`: every probe before it left the
    /// colour white and the mode `OPAQUE`, and a white rectangle on a white
    /// cell is indistinguishable from none.
    fn ground(&mut self, x: i64, y: i64, text: &[u8]) -> Result<(), Stop> {
        if self.font.outline.is_some() {
            return self.outline_ground(x, y, text, None);
        }

        if self.back_mode == TRANSPARENT || self.run_only {
            return Ok(());
        }

        let (left, right, height) = self.ground_box(text, None, false)?;

        fill_rect(
            &mut self.target.context,
            (x + left) as f64,
            y as f64,
            (right - left) as f64,
            height as f64,
            self.back,
        );
        Ok(())
    }

    /// The underline and the strikeout, which GDI draws and the glyph does
    /// not: from the pen to the end of the string's advance, filled solid --
    /// in black, whatever the text colour, as the TypeScript engine draws
    /// them; every recording of them is black text.
    ///
    /// A strike's rules are a twelfth of the cell thick, at least a row:
    /// **measured** by `strikout` over every strike the installation has at
    /// eighteen sizes, 136 readings, where the thickness steps at cells of
    /// 24, 36 and 48. Its underline sits **one row below the baseline**
    /// whatever the size.
    ///
    /// Its strikeout is a third of the way up from the baseline to the top
    /// of the internal leading, `(2 * ascent + internal leading) / 3`
    /// floored, and the band is that row and the thickness grown upward
    /// first. **Measured** by `strikout` on all 136 readings, with no
    /// exception. That row is counted from the top of the pixels and not
    /// from the text's, as the TypeScript engine counts it: every reading
    /// drew its text on the top row.
    fn rules(&mut self, x: i64, y: i64, text: &[u8], run_width: Option<i64>) -> Result<(), Stop> {
        if self.font.outline.is_some() {
            return self.outline_rules(x, y, text, run_width.map(|width| width as f64));
        }

        let style = &self.font.style;
        let underline = style.underline.unwrap_or(false);
        let strikeout = style.strikeout.unwrap_or(false);

        if (!underline && !strikeout) || (self.run_only && run_width.is_none()) {
            return Ok(());
        }

        let width = match run_width {
            Some(width) => width,
            None => self.measure(text)?.0,
        };
        let header = &self.font.strike().header;
        let cell = round(f64::from(header.pix_height) * self.font.scale()) as i64;
        let ascent = self.ascent();
        let baseline = y + ascent;
        let rows = (cell.div_euclid(12)).max(1);

        if underline {
            fill_rect(
                &mut self.target.context,
                x as f64,
                (baseline + 1) as f64,
                width as f64,
                rows as f64,
                BLACK,
            );
        }

        if strikeout {
            let top = (2 * ascent + self.internal()).div_euclid(3) - (rows >> 1);

            fill_rect(
                &mut self.target.context,
                x as f64,
                top as f64,
                width as f64,
                rows as f64,
                BLACK,
            );
        }

        Ok(())
    }

    /// `ExtTextOut`'s rectangle, painted in a colour -- the background's --
    /// whatever the background mode says. Its right and bottom edges are
    /// **outside** it. **Recorded** by `extout`: a rectangle of (4, 2) to
    /// (40, 22) comes back as rows 2 to 21 and columns 4 to 39, under both
    /// modes.
    pub(crate) fn paint_ground(&mut self, rect: Bounds, colour: [u8; 4]) {
        fill_rect(
            &mut self.target.context,
            rect.left as f64,
            rect.top as f64,
            (rect.right - rect.left) as f64,
            (rect.bottom - rect.top) as f64,
            colour,
        );
    }

    /// A string drawn with its cell's corner at a point, after the
    /// alignment has moved it: the ground, the glyphs, the rules.
    ///
    /// # Errors
    ///
    /// A strike's region of negative size, which a negative character
    /// extra can make and the TypeScript engine throws at.
    pub(crate) fn fill_text(&mut self, x: i64, y: i64, text: &[u8]) -> Result<(), Stop> {
        let (x, y) = self.aligned(x, y, text, None)?;

        if self.font.outline.is_some() {
            self.ground(x, y, text)?;
            self.outline_text(x, y, text, None, None)?;
            return self.rules(x, y, text, None);
        }

        if self.font.is_vector() {
            self.ground(x, y, text)?;
            self.stroke_text(x, y, text);
            return self.rules(x, y, text, None);
        }

        // A strike too small to embolden is drawn plainly, and `emboldens`
        // decides -- the same answer the metrics report, so a string that is
        // measured as unbolded is drawn that way too.
        let style = &self.font.style;
        let options = DrawOptions {
            weight: if self.font.emboldens() {
                style.weight.unwrap_or(400)
            } else {
                400
            },
            italic: style.italic.unwrap_or(false),
            scale: self.font.scale(),
            horizontal: self.font.horizontal(),
            extra: self.char_extra as i32,
            color: self.text,
        };

        self.ground(x, y, text)?;
        draw_strike(
            self.font.strike(),
            &mut self.target.context,
            x as i32,
            y as i32,
            text,
            &options,
        )
        .map_err(|_| Stop::Unsupported("text drawn over a region of negative size"))?;
        self.rules(x, y, text, None)
    }

    /// A plotter font's text: each character's strokes joined up with the
    /// display driver's own line, scaled to the cell -- separately in each
    /// direction, since the design has its own aspect -- in black, as every
    /// other text path draws; the pen is not the text colour.
    ///
    /// A stroke design measures downward from the top of its cell, and a
    /// coordinate below the cell is pulled back to its last row: Modern's
    /// `g` ends at 32 in a design 32 tall, and Windows draws the tail flat
    /// along the last row. **Measured**: clamping takes the three faces from
    /// 314 of 420 to 379.
    ///
    /// Italic moves the coordinates rather than the rows, leaning by half
    /// the cell at the top, `floor(cell / 2)` -- **measured**, the lean at
    /// the top row 4, 6, 8, 10, 12, 16 and 20 for cells of 8 to 40. Bold is
    /// the whole thing again a pixel across.
    ///
    /// One run is one polyline, which is not the same as a chain of
    /// `LineTo` calls through the same points: the `poly` records of the
    /// `lines` fixture say so (see `line_walk`).
    fn stroke_text(&mut self, x: i64, y: i64, text: &[u8]) {
        let entry = self.font.strike().clone();
        let design = f64::from(entry.header.pix_height);
        let cell = round(design * self.font.scale());
        let vertical = cell / design;
        let horizontal = self.font.width_scale();
        let leaning = self.font.style.italic.unwrap_or(false);
        let smeared = self.font.emboldens();
        let cell = cell as i64;
        let mut pen = x;

        for &code in text {
            for run in entry.strokes(u32::from(code)) {
                if run.len() < 2 {
                    continue;
                }

                for copy in 0..=i64::from(smeared) {
                    let path: Vec<(i32, i32)> = run
                        .iter()
                        .map(|&(px, py)| {
                            let down = y + (cell - 1).min(round(f64::from(py) * vertical) as i64);
                            let lean = if leaning {
                                ((cell - (down - y)) >> 1).max(0)
                            } else {
                                0
                            };
                            let at = pen + round(f64::from(px) * horizontal) as i64 + lean + copy;

                            (at as i32, down as i32)
                        })
                        .collect();

                    line_walk::stroke(&mut self.target.context, &path, BLACK, self.walk);
                }
            }

            pen += round(f64::from(entry.character(u32::from(code)).width) * horizontal) as i64;
        }
    }

    /// One run of text with the pen moved by an array of advances, or with
    /// the glyphs' own ground: `ExtTextOut`'s.
    ///
    /// Each distance is what the pen moves by after its character rather
    /// than what the character advances -- so the last is never used -- and
    /// `SetTextCharacterExtra` is **added to** each: three pixels of extra
    /// against an array of twenty puts the second character twenty-three
    /// across. The ground and any rule run from the pen to the last
    /// character's own advance past its own pen. **Recorded** by `extout`.
    ///
    /// The characters are drawn one at a time, each aligned again by its
    /// own width as the TypeScript engine aligns it, and without an array
    /// each moves the pen by its own measure, a bold's or a slant's overhang
    /// included.
    pub(crate) fn ext_text(
        &mut self,
        x: i64,
        y: i64,
        text: &[u8],
        dx: Option<&[i64]>,
        ink_only: bool,
    ) -> Result<(), Stop> {
        if (dx.is_none() && !ink_only) || text.is_empty() {
            return self.fill_text(x, y, text);
        }

        let (left, right, height) = self.ground_box(text, dx, ink_only)?;

        // Turned, the run is one walk along the turned baseline, the array's
        // distances in place of the advances.
        if self.turned_text() {
            let mut advances = Vec::with_capacity(text.len());

            for (index, &code) in text.iter().enumerate() {
                advances.push(match dx {
                    Some(dx) => dx.get(index).copied().unwrap_or(0) as f64,
                    None => self.measure(&[code])?.0 as f64,
                });
            }

            let run_width = (right - left) as f64;

            self.outline_ground(x, y, text, Some(run_width))?;
            self.outline_text(x, y, text, Some(&advances), Some(run_width))?;
            return self.outline_rules(x, y, text, Some(run_width));
        }

        let (x, y) = self.aligned(x, y, text, Some(right - left))?;

        if self.back_mode != TRANSPARENT {
            fill_rect(
                &mut self.target.context,
                (x + left) as f64,
                y as f64,
                (right - left) as f64,
                height as f64,
                self.back,
            );
        }

        self.run_only = true;

        let mut pen = x;

        for (index, &code) in text.iter().enumerate() {
            let drawn = self.fill_text(pen, y, &[code]);

            if drawn.is_err() {
                self.run_only = false;
                return drawn;
            }

            let along = match dx {
                Some(dx) => Ok(dx.get(index).copied().unwrap_or(0) + self.char_extra),
                None => self
                    .measure(&[code])
                    .map(|(width, _)| width + self.char_extra),
            };

            match along {
                Ok(moved) => pen += moved,
                Err(stop) => {
                    self.run_only = false;
                    return Err(stop);
                }
            }
        }

        self.run_only = false;
        self.rules(x, y, text, Some(right - left))
    }
}

/// The pixels a device context draws on, kept as they are, so that what is
/// drawn outside a rectangle can be put back: a copy of the indices, row by
/// row, from where the pixels start in their store.
pub(crate) fn keep_pixels(target: &DeviceBitmap) -> Vec<u8> {
    let (width, height) = (target.width().max(0), target.height().max(0));
    let context = &target.context;
    let indices = context.indices.borrow();
    let mut kept = vec![0; (width * height) as usize];

    for row in 0..height {
        let from = context.base + row as isize * context.stride;

        for column in 0..width {
            if let Some(&index) = usize::try_from(from + column as isize)
                .ok()
                .and_then(|at| indices.get(at))
            {
                kept[(row * width + column) as usize] = index;
            }
        }
    }

    kept
}

/// What was drawn outside a rectangle put back as `keep_pixels` kept it,
/// and the whole marked as written.
///
/// A rectangle whose edges are the wrong way round is **normalised**, not
/// refused: (20, 6) to (10, 14) clips exactly as (10, 6) to (20, 14) does.
/// One whose edges are equal clips everything away. **Recorded** by
/// `clipedge`, which walks each edge across the text a column at a time.
pub(crate) fn restore_outside(target: &DeviceBitmap, kept: &[u8], rect: Bounds) {
    let (left, right) = (rect.left.min(rect.right), rect.left.max(rect.right));
    let (top, bottom) = (rect.top.min(rect.bottom), rect.top.max(rect.bottom));
    let (width, height) = (target.width().max(0), target.height().max(0));
    let context = &target.context;

    {
        let mut indices = context.indices.borrow_mut();

        for row in 0..height {
            for column in 0..width {
                let (x, y) = (i64::from(column), i64::from(row));

                if x >= left && x < right && y >= top && y < bottom {
                    continue;
                }

                let at = context.base + row as isize * context.stride + column as isize;

                if let Some(pixel) = usize::try_from(at).ok().and_then(|at| indices.get_mut(at)) {
                    *pixel = kept[(row * width + column) as usize];
                }
            }
        }
    }

    context.mark_rect(0, 0, width, height);
}

/// Where text drawn at a point goes, and what moving the current position
/// after it does: with `TA_UPDATECP`, the text goes at the current
/// position, which moves on by the text's extent -- back for `TA_RIGHT`,
/// not at all for `TA_CENTER`. **Recorded** by `updatecp`.
struct Place {
    x: i64,
    y: i64,
    update: Option<u16>,
}

fn place_of(system: &System, index: usize, x: i64, y: i64) -> Place {
    let state = &system.gdi.dcs[index].state;

    if state.text_align & TA_UPDATECP == 0 {
        return Place { x, y, update: None };
    }

    Place {
        x: i64::from(state.position.0),
        y: i64::from(state.position.1),
        update: Some(state.text_align & TA_CENTER),
    }
}

impl Place {
    /// The current position moved on, by `GetTextExtent`'s width of the
    /// text, as a word.
    fn after(&self, system: &mut System, hdc: u16, index: usize, text: &[u8]) -> Result<(), Stop> {
        let Some(across) = self.update else {
            return Ok(());
        };

        if across == TA_CENTER {
            return Ok(());
        }

        let width = i32::from(get_text_extent(system, hdc, text, text.len() as i32)? as u16);
        let position = &mut system.gdi.dcs[index].state.position;

        position.0 += if across == TA_RIGHT { -width } else { width };
        Ok(())
    }
}

/// The spacing a string is drawn with when justification is set: `dx`, or
/// each character's own measure, with each break's extra; the error term
/// moved on as drawing moves it -- once over the string for the display
/// driver's fonts, whose draw keeps nothing, and twice for a plotter font,
/// once as GDI draws and once as it measures after. `None` when none is
/// set. See `text::Justification`.
fn justified_spacing(
    system: &mut System,
    index: usize,
    font: &LogicalFont,
    text: &[u8],
    dx: Option<&[i64]>,
) -> Result<Option<Vec<i64>>, Stop> {
    let Some(state) = system.gdi.dcs[index].state.justification else {
        return Ok(None);
    };

    if state.extra == 0 && state.rem == 0 {
        return Ok(None);
    }

    let gdi = gdi_draws(font);
    let extras = |term: &mut super::text::Justification| -> Vec<i64> {
        text.iter()
            .map(|&code| {
                if is_break(font, code) {
                    i64::from(term.step(gdi))
                } else {
                    0
                }
            })
            .collect()
    };
    let mut drawn = state;
    let added = extras(&mut drawn);
    // Each character measured as a string of one, which for an outline
    // whose glyph tables cannot be read stops, as the TypeScript engine's
    // measure throws.
    let spacing = text
        .iter()
        .enumerate()
        .map(|(at, &code)| {
            let own = match dx {
                Some(dx) => dx.get(at).copied().unwrap_or(0),
                None => {
                    font.try_measure(&[code], Measure::default())
                        .map_err(unreadable)?
                        .0 as i64
                }
            };

            Ok(own + added[at])
        })
        .collect::<Result<Vec<i64>, Stop>>()?;

    if gdi {
        extras(&mut drawn);
    }

    if let Some(kept) = system.gdi.dcs[index].state.justification.as_mut() {
        kept.err = drawn.err;
    }

    Ok(Some(spacing))
}

/// A logical point in device terms.
fn device_point(system: &System, index: usize, x: i64, y: i64) -> (i64, i64) {
    let mapping = mapping_of(system, index);

    if mapping.is_identity() {
        (x, y)
    } else {
        (mapping.device_x(x), mapping.device_y(y))
    }
}

/// A logical rectangle in device terms, its edges put the right way round;
/// as it is, where nothing maps it.
pub(crate) fn device_rect(system: &System, index: usize, rect: Bounds) -> Bounds {
    let mapping = mapping_of(system, index);

    if mapping.is_identity() {
        return rect;
    }

    let (x0, y0) = (mapping.device_x(rect.left), mapping.device_y(rect.top));
    let (x1, y1) = (mapping.device_x(rect.right), mapping.device_y(rect.bottom));

    Bounds {
        left: x0.min(x1),
        top: y0.min(y1),
        right: x0.max(x1),
        bottom: y0.max(y1),
    }
}

/// The device context a drawing call names: `None` for a handle that
/// stands for nothing, answered as failure; a handle that stands for
/// something else stops, where the TypeScript engine throws.
fn drawing_dc(system: &System, hdc: u16) -> Result<Option<usize>, Stop> {
    if system.handles.resolve(hdc).is_none() {
        return Ok(None);
    }

    dc_of(system, hdc).map(Some).ok_or(Stop::Unsupported(
        "text drawn on a handle that is no device context's",
    ))
}

/// A string drawn at a point in the selected font, as `ExtTextOut` with no
/// flags, no rectangle and no array draws it: **recorded** by `extout`,
/// the two pixel for pixel identical. Under a mapping mode the point is
/// mapped. FALSE for a handle that stands for nothing.
///
/// # Errors
///
/// No font, or a handle that is no device context's.
pub fn text_out(system: &mut System, hdc: u16, x: i64, y: i64, text: &[u8]) -> Result<u16, Stop> {
    let Some(index) = drawing_dc(system, hdc)? else {
        return Ok(0);
    };
    let mut writer = Writer::of(system, index)?;
    let place = place_of(system, index, x, y);
    let (x, y) = device_point(system, index, place.x, place.y);
    let spacing = justified_spacing(system, index, &writer.font.clone(), text, None)?;

    match spacing {
        Some(spacing) => writer.ext_text(x, y, text, Some(&spacing), false)?,
        None => writer.fill_text(x, y, text)?,
    }

    place.after(system, hdc, index, text)?;
    Ok(1)
}

fn text_out_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let far = args.dword(system);
    let count = args.signed(system);
    let text = match text_argument(system, far) {
        Text::Read(text) => text,
        Text::Refused => return Ok(Answer::Word(0)),
        Text::Absent => return Err(Stop::Unsupported("TextOut of no string")),
    };
    let text = sliced(&text, i32::from(count)).to_vec();

    Ok(Answer::Word(text_out(
        system,
        hdc,
        i64::from(x),
        i64::from(y),
        &text,
    )?))
}

/// What `ExtTextOut` is asked beyond `TextOut`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extra {
    pub options: u16,
    pub rect: Option<Bounds>,
    pub dx: Option<Vec<i64>>,
}

/// `TextOut` with the three arguments it has not got: a rectangle, the
/// flags that say what to do with it, and an array of distances, one per
/// character.
///
/// * `ETO_OPAQUE`: the rectangle is filled with the background colour
///   first, whatever the background mode says.
/// * `ETO_CLIPPED`: nothing is drawn outside the rectangle, the mode's own
///   ground included -- **recorded**: the same request with and without
///   the flag differs only in that everything outside is gone.
/// * Neither: the rectangle is not read at all.
///
/// The array is justified too, where justification is set; it is not
/// mapped. **Recorded** by `extout`, two characters drawn through both
/// calls at every combination of those, on a strike, an outline face and a
/// fixed-pitch outline face.
///
/// # Errors
///
/// No font, or a handle that is no device context's.
pub fn ext_text_out(
    system: &mut System,
    hdc: u16,
    x: i64,
    y: i64,
    text: &[u8],
    extra: Extra,
) -> Result<u16, Stop> {
    let Some(index) = drawing_dc(system, hdc)? else {
        return Ok(0);
    };
    let mut writer = Writer::of(system, index)?;
    let font = writer.font.clone();
    let dx = justified_spacing(system, index, &font, text, extra.dx.as_deref())?.or(extra.dx);
    let place = place_of(system, index, x, y);
    let (x, y) = device_point(system, index, place.x, place.y);
    let rect = extra.rect.map(|rect| device_rect(system, index, rect));

    if extra.options & ETO_OPAQUE != 0
        && let Some(rect) = rect
    {
        let back = writer.back;

        writer.paint_ground(rect, back);
    }

    // And `ETO_CLIPPED` does nothing to turned text. **Recorded** by
    // `rotstyle`: at every one of twelve turned draws, the clipped string is
    // pixel for pixel the unclipped one.
    let clip = rect.filter(|_| extra.options & ETO_CLIPPED != 0 && !writer.turned_text());
    let kept = clip.map(|_| keep_pixels(&writer.target));
    let drawn = writer.ext_text(x, y, text, dx.as_deref(), extra.options & ETO_OPAQUE != 0);

    if let (Some(rect), Some(kept)) = (clip, kept) {
        restore_outside(&writer.target, &kept, rect);
    }

    drawn?;
    place.after(system, hdc, index, text)?;
    Ok(1)
}

/// A string argument as `ExtTextOut` takes it, which makes a string of
/// whatever it is given: a null pointer is the text "null", and one whose
/// segment is nought the digits of its offset. `None` for one that cannot
/// be read, which turns the call away.
fn ext_string(system: &System, far: u32) -> Option<Vec<u8>> {
    match text_argument(system, far) {
        Text::Read(text) => Some(text),
        Text::Refused => None,
        Text::Absent if far == 0 => Some(b"null".to_vec()),
        Text::Absent => Some((far & 0xffff).to_string().into_bytes()),
    }
}

fn ext_text_out_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let options = args.word(system);
    let rect_far = args.dword(system);
    let far = args.dword(system);
    let count = args.word(system);
    let dx_far = args.dword(system);
    let Some(text) = ext_string(system, far) else {
        return Ok(Answer::Word(0));
    };
    let text = sliced(&text, i32::from(count)).to_vec();
    let words = |system: &System, far: u32, count: usize| -> Vec<i64> {
        system
            .read_far(far, count * 2)
            .chunks(2)
            .map(|word| i64::from(i16::from_le_bytes([word[0], word[1]])))
            .collect()
    };
    let rect = (rect_far != 0).then(|| {
        let sides = words(system, rect_far, 4);

        Bounds {
            left: sides[0],
            top: sides[1],
            right: sides[2],
            bottom: sides[3],
        }
    });
    let dx = (dx_far != 0).then(|| words(system, dx_far, text.len()));

    Ok(Answer::Word(ext_text_out(
        system,
        hdc,
        i64::from(x),
        i64::from(y),
        &text,
        Extra { options, rect, dx },
    )?))
}

#[cfg(test)]
mod tests;
