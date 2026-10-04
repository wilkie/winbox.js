//! Text drawn in an outline face: each glyph fitted by the font's program
//! and filled by the scan converter's walk (`winbox_raster::glyph_raster`),
//! a bold GDI synthesises smeared a column across, a slant made from the raw
//! outline, and turned text carried through the scaler's transform -- with
//! the ground and the rules that go with each. All of it as the TypeScript
//! engine's `Surface` draws it, call for call: the interpreter keeps state
//! from one glyph to the next at a size, so which glyphs are fitted, and in
//! what order, is part of what is drawn.

// Deliberately: numbers compared and converted as a JavaScript engine's
// are, since every rule here was measured through one.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use winbox_raster::glyph_raster::{FillOptions, fill_walked};
use winbox_raster::js;
use winbox_raster::line_walk::{self, Walk};
use winbox_raster::logical_font::{Outline, round};
use winbox_raster::polygon::rings_spans;
use winbox_raster::text_draw::fill_rect;
use winbox_raster::truetype::{Contour, Fitted, Point};
use winbox_raster::{LogicalFont, Measure};

use crate::call::Stop;

use super::super::text::unreadable;
use super::{TA_BASELINE, TA_BOTTOM, TA_CENTER, TA_RIGHT, TRANSPARENT, Writer};

const OPAQUE: u16 = 2;

/// `Math.sign(v) * Math.round(Math.abs(v))`: a half away from nought.
fn away(value: f64) -> f64 {
    let rounded = round(value.abs());

    if value < 0.0 {
        -rounded
    } else if value > 0.0 {
        rounded
    } else {
        value * rounded
    }
}

/// A sine or cosine in sixteen-dot-sixteen.
fn fixed(value: f64) -> f64 {
    round(value * 65536.0) / 65536.0
}

/// The angle of a turned font's baseline, in radians.
fn radians(outline: &Outline) -> f64 {
    (outline.escapement * std::f64::consts::PI) / 1800.0
}

/// The length of a turned string on a pixel that is not square.
///
/// A turned TrueType font's widths are sums across the page, and on a device
/// whose two resolutions differ GDI scales that sum by the length of the
/// baseline's unit step as it lands on the device: `GDI.EXE` seg1 `6ab0` asks
/// seg3 `2615` for a factor and keeps `sum * factor >> 8`, the factor the
/// square root of the sine times `256 * V / H` squared and the cosine times
/// 256 squared, truncated. Where GDI makes the bold itself, its `count + 1`
/// is added after the sum has been scaled (seg1 `3cf3`). **Recorded** by
/// `rotherc` and `simext` on a Hercules. A square pixel has a factor of 256
/// at every angle.
pub(crate) fn turned_length(font: &LogicalFont, width: f64, count: f64) -> f64 {
    let Some(outline) = &font.outline else {
        return width;
    };
    let (h, v) = (outline.horizontal_res, outline.vertical_res);

    #[allow(clippy::float_cmp)]
    if outline.escapement == 0.0 || h == v {
        return width;
    }

    let simulated =
        font.style.weight.unwrap_or(0) > 550 && !outline.face_bold && outline.bold_always;

    if simulated && count > 0.0 {
        return turned_length(font, width - (count + 1.0), 0.0) + count + 1.0;
    }

    let angle = radians(outline);
    let fix_mul = |value: f64, factor: f64| ((value * factor + 32768.0) / 65536.0).floor();
    let ratio = ((256.0 * v + (h / 2.0).floor()) / h).floor();
    let a = fix_mul(ratio, round(angle.sin() * 65536.0));
    let b = fix_mul(256.0, round(angle.cos() * 65536.0));
    let factor = (a * a + b * b).sqrt().floor();

    ((width * factor) / 256.0).floor()
}

/// The whole-pixel matrix GDI hands the scaler for turned text: the size
/// times the cosine and the size times the sine, in sixteen-dot-sixteen,
/// each rounded with a half away from nought. **Measured**: 70 of
/// `rot-square`'s 91 oblique squares against 15 for the exact rotation.
fn turn_entries(ppem: f64, angle: f64) -> (f64, f64) {
    (
        away(ppem * fixed(angle.cos())),
        away(ppem * fixed(angle.sin())),
    )
}

/// A made-up slant turned: the turn's whole-pixel matrix with a third of its
/// first row, floored, added to its second. **Recorded** by `rotstyle`,
/// Symbol slanted at two sizes and five angles: ten of ten.
fn slanted_turn(entry_cos: f64, entry_sin: f64) -> [f64; 4] {
    [
        entry_cos,
        entry_sin,
        -entry_sin + (entry_cos / 3.0).floor(),
        entry_cos + (entry_sin / 3.0).floor(),
    ]
}

/// An outline carried through a matrix of whole-pixel entries as the
/// scaler carries it. **Read out of `GDI.EXE`**, segment 36: each row scaled
/// at its own stretch -- the larger of its two entries (`3f16`) -- into
/// sixty-fourths by whichever method `3f55` picks, each entry divided by its
/// row's stretch with `FixDiv` and each point two `FixMul`s added; and on a
/// diagonal (`3dc1`) every point nudged a sixty-fourth across (`2357`).
/// **Measured**: 363 of 363 single squares of `rot-square` and `rotpen`.
fn transform_outline(contours: &[Contour], matrix: [f64; 4], units_per_em: f64) -> Vec<Contour> {
    let [e00, e01, e10, e11] = matrix;
    let stretch_x = e00.abs().max(e01.abs());
    let stretch_y = e10.abs().max(e11.abs());

    let scaler = |stretch: f64| {
        let mut multiplier = stretch * 64.0;
        let mut divisor = units_per_em;

        while multiplier % 2.0 == 0.0 && divisor % 2.0 == 0.0 {
            multiplier /= 2.0;
            divisor /= 2.0;
        }

        let whole = divisor as i64;
        let shifted = whole & (whole - 1) == 0;

        move |value: f64| {
            if shifted || value >= 0.0 {
                ((value * multiplier + (divisor / 2.0).floor()) / divisor).floor()
            } else {
                -((-value * multiplier + (divisor / 2.0).floor()) / divisor).floor()
            }
        }
    };
    let scale_x = scaler(stretch_x);
    let scale_y = scaler(stretch_y);
    let sign = |value: f64| {
        if value > 0.0 {
            1.0
        } else if value < 0.0 {
            -1.0
        } else {
            value
        }
    };
    let fix_div = |numerator: f64, denominator: f64| {
        sign(numerator)
            * sign(denominator)
            * ((numerator.abs() * 65536.0 + (denominator.abs() / 2.0).floor()) / denominator.abs())
                .floor()
    };
    let fix_mul = |value: f64, factor: f64| ((value * factor + 32768.0) / 65536.0).floor();

    let m00 = fix_div(e00, stretch_x);
    let m01 = fix_div(e01, stretch_x);
    let m10 = fix_div(e10, stretch_y);
    let m11 = fix_div(e11, stretch_y);

    #[allow(clippy::float_cmp)]
    let diagonal = e00.abs() == e01.abs() || e10.abs() == e11.abs();
    let nudge = if diagonal { 1.0 } else { 0.0 };

    contours
        .iter()
        .map(|contour| {
            contour
                .iter()
                .map(|point| {
                    let x = scale_x(point.x);
                    let y = scale_y(point.y);

                    Point {
                        x: (fix_mul(x, m00) + fix_mul(y, m10) + nudge) / 64.0,
                        y: (fix_mul(x, m01) + fix_mul(y, m11)) / 64.0,
                        on: point.on,
                    }
                })
                .collect()
        })
        .collect()
}

/// How far a synthesised italic leans: `floor(ppem / 3)` pixels over the
/// em, carried across the device's own aspect and rounded again. **Read out
/// of GDI's memory** by `stack`, 948 boxes, and **measured** on
/// `symbol-slant` on an EGA, nineteen sizes.
fn lean_of(ppem: f64, across: f64) -> f64 {
    round(((ppem / 3.0).floor() * across) / ppem) / ppem
}

/// Leans an outline over, each point sheared in sixty-fourths with the two
/// roundings apart, a half going up. **Measured**: every slant instrument
/// exact, and 32,394 fabricated cells of 32,394.
fn slant(contours: &[Contour], scale: f64, ppem: f64, across: f64) -> Vec<Contour> {
    let lean = lean_of(ppem, across);
    let k = scale * 64.0;

    contours
        .iter()
        .map(|contour| {
            contour
                .iter()
                .map(|point| {
                    let x64 = round(point.x * k);
                    let y64 = round(point.y * k);

                    Point {
                        x: (x64 + round(lean * y64)) / k,
                        ..*point
                    }
                })
                .collect()
        })
        .collect()
}

/// Whether the scaler has room for a glyph: an outline that reaches too far
/// out of its cell is not drawn at all. How far it reaches above the
/// baseline is counted in sixty-fourths of a row in sixteen signed bits, its
/// rows each padded to a long, against one cell of the face -- its box
/// across, padded to longs and a long more -- by the cell's height, in
/// bytes. **Recorded** by `times-tall`, `times-reach`, `times-wide` and
/// `buffer`.
///
/// The extremes are a JavaScript engine's `Math.max` and `Math.min`, as the
/// rule was measured through one: a point a program left as not-a-number
/// makes the reach not-a-number, and the glyph is refused.
fn has_room(contours: &[Contour], up: f64, max_width: f64, cell: f64) -> bool {
    let reach: Vec<&Point> = contours.iter().flatten().collect();
    let (raised, columns) = if reach.is_empty() {
        (0.0, 0.0)
    } else {
        let top = reach
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, js::max);
        let least = reach
            .iter()
            .map(|point| point.x)
            .fold(f64::INFINITY, js::min);
        let most = reach
            .iter()
            .map(|point| point.x)
            .fold(f64::NEG_INFINITY, js::max);

        (round(top * up), round(most * up) - round(least * up))
    };
    let rows = (((raised + 512.0) % 1024.0) + 1024.0) % 1024.0 - 512.0;
    let longs = |value: f64| {
        let longs = js::sar(value, 5.0);

        if longs == 0.0 { 1.0 } else { longs }
    };
    let row_bytes = longs(columns + 31.0) * 4.0;
    let cell_bytes = longs(max_width + 63.0) * 4.0;

    rows * row_bytes < cell_bytes * cell
}

/// What drawing outline text needs of a device context: the font, the text
/// state, the driver's way with a smear's overhang, and the size of the
/// pixels drawn on.
pub(crate) struct Pen<'a> {
    pub font: &'a LogicalFont,
    pub outline: &'a Outline,
    pub back_mode: u16,
    pub text_align: u16,
    pub char_extra: f64,
    pub driver_always: bool,
    pub width: i64,
    pub height: i64,
}

/// Where a turned string's alignment puts it, in its own frame.
struct TurnedAlign {
    across: f64,
    align_down: f64,
}

impl Pen<'_> {
    fn measure(&self, text: &[u8]) -> Result<(f64, f64), Stop> {
        self.font
            .try_measure(text, Measure::default())
            .map_err(unreadable)
    }

    fn advance(&self, code: u8) -> Result<f64, Stop> {
        self.font
            .outline_advance(u32::from(code))
            .map_err(unreadable)
    }

    /// Whether text drawn now is turned: an outline face with an escapement.
    pub(crate) fn turned(&self) -> bool {
        self.outline.escapement != 0.0
    }

    /// Whether the driver draws the smear itself: the colour drivers have
    /// `TC_EA_DOUBLE` and a Hercules has not.
    pub(crate) fn device_paints_bold(&self) -> bool {
        !self.driver_always
    }

    /// Whether GDI draws a synthesised bold itself rather than leaving it to
    /// the driver: where the driver cannot, or where the text is turned
    /// (`GDI.EXE` seg1 `35b2`).
    pub(crate) fn gdi_draws_bold(&self) -> bool {
        self.font.smears() && (self.turned() || !self.device_paints_bold())
    }

    /// The escapement's sine and cosine as the placement takes them.
    fn turned_trig(&self) -> (f64, f64) {
        let angle = radians(self.outline);

        (fixed(angle.sin()), fixed(angle.cos()))
    }

    /// How a distance in a turned font's own terms reaches the device where
    /// the pixel is not square: each ratio 256 times the quotient rounded and
    /// applied as a truncated multiply (`GDI.EXE` seg1 `625b`, seg8 `02c1`
    /// and `01f0`).
    #[allow(clippy::float_cmp)]
    fn to_across(&self, value: f64) -> f64 {
        let (h, v) = (self.outline.horizontal_res, self.outline.vertical_res);
        let across = ((256.0 * h + (v / 2.0).floor()) / v).floor();

        if h == v {
            value
        } else {
            ((value * across) / 256.0).floor()
        }
    }

    #[allow(clippy::float_cmp)]
    fn to_down(&self, value: f64) -> f64 {
        let (h, v) = (self.outline.horizontal_res, self.outline.vertical_res);
        let down = ((256.0 * v + (h / 2.0).floor()) / h).floor();

        if h == v {
            value
        } else {
            ((value * down) / 256.0).floor()
        }
    }

    /// The alignment of turned text in its own frame: Windows turns the
    /// alignment with the text. The width is what `GetTextExtent` says.
    /// **Recorded** by `rotstyle`.
    fn turned_align(&self, text: &[u8], run_width: Option<f64>) -> Result<TurnedAlign, Stop> {
        let width = match run_width {
            Some(width) => width,
            None => turned_length(self.font, self.measure(text)?.0, text.len() as f64),
        };
        let across = self.text_align & 0x06;
        let down = self.text_align & 0x18;
        let ascent = self.outline.ascent;
        let descent = self.outline.descent;

        Ok(TurnedAlign {
            across: match across {
                TA_RIGHT => -width,
                TA_CENTER => -(width / 2.0).trunc(),
                _ => 0.0,
            },
            align_down: match down {
                TA_BOTTOM => -(ascent + descent),
                TA_BASELINE => -ascent,
                _ => 0.0,
            },
        })
    }

    /// Where a turned string's reference point lands, as two carries: the
    /// alignment's and the ascent's, each multiply by a sine or cosine
    /// rounded on its own (`GDI.EXE` seg1 `3484`-`34f4`, seg8 `02b7`).
    /// **Recorded** by `rotstyle` on a Hercules.
    #[allow(clippy::float_cmp)]
    fn turned_base(
        &self,
        x: f64,
        y: f64,
        text: &[u8],
        run_width: Option<f64>,
        sine: f64,
        cosine: f64,
    ) -> Result<(f64, f64, f64, f64), Stop> {
        let (h, v) = (self.outline.horizontal_res, self.outline.vertical_res);
        let mul_div = |value: f64, numerator: f64, denominator: f64| {
            if numerator == denominator {
                value
            } else {
                away((value * numerator) / denominator)
            }
        };
        let reference = self.turned_align(text, run_width)?;
        let ascent = self.outline.ascent;
        let align_x =
            away(reference.across * cosine) + away(mul_div(reference.align_down, h, v) * sine);
        let align_y =
            -away(mul_div(reference.across, v, h) * sine) + away(reference.align_down * cosine);

        Ok((
            x + align_x + away(self.to_across(ascent) * sine),
            y + align_y + away(ascent * cosine),
            align_x,
            align_y,
        ))
    }

    /// The box the ground is painted over, from the pen: the fitted
    /// outline's extremes carried to pixels and rounded, united with the
    /// advance -- the first glyph's box, the furthest ink, and the run's own
    /// advance where there is a run. A synthesised bold's widths each carry
    /// a pixel (`GDI.EXE` seg1 `63b9`). With `ETO_OPAQUE` it is the glyphs'
    /// own boxes alone. **Measured** by `groundbx` and `groundrn`.
    pub(crate) fn ground_box(
        &self,
        text: &[u8],
        dx: Option<&[i64]>,
        ink_only: bool,
    ) -> Result<(f64, f64, f64), Stop> {
        let (_, height) = self.measure(text)?;
        let font = &self.outline.font;
        let bold_pixel = if self.font.smears() { 1.0 } else { 0.0 };
        let scale = self.outline.ppem / font.units_per_em();
        let stretch = self.font.stretch();
        let (mut left, mut right, mut pen) = (0.0_f64, 0.0_f64, 0.0);
        let mut first: Option<(f64, f64)> = None;

        for (index, &code) in text.iter().enumerate() {
            let glyph = font.cmap().get(&u32::from(code)).copied().unwrap_or(0);
            let fitted = font
                .hinted_outline(glyph, self.outline.ppem, true, stretch, false)
                .ok();
            let reach: Vec<Point> = fitted
                .as_ref()
                .map(|fitted| fitted.contours.iter().flatten().copied().collect())
                .unwrap_or_default();

            if !reach.is_empty() {
                let up = if fitted.as_ref().is_some_and(|fitted| fitted.scaled) {
                    1.0
                } else {
                    scale
                };
                let least = reach
                    .iter()
                    .map(|point| point.x)
                    .fold(f64::INFINITY, js::min);
                let most = reach
                    .iter()
                    .map(|point| point.x)
                    .fold(f64::NEG_INFINITY, js::max);

                if first.is_none() {
                    let bearing = round(least * up);

                    first = Some((bearing, self.advance(code)? + bold_pixel));
                    left = bearing.min(0.0);
                }

                right = right.max(pen + round(most * up));
            }

            pen += match dx {
                Some(dx) => dx.get(index).copied().unwrap_or(0) as f64 + self.char_extra,
                None => self.advance(code)? + bold_pixel,
            };
        }

        if ink_only {
            return Ok((left, right, height));
        }

        let run = if first.is_none() || text.len() > 1 {
            pen
        } else {
            0.0
        };
        let own = first.map_or(0.0, |(bearing, advance)| bearing + advance);

        Ok((left, right.max(run).max(own), height))
    }

    /// The glyphs of a string, each pixel of ink handed to `plot`, and the
    /// box the last was set up with, which `GetGlyphOutline` wants.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn draw(
        &self,
        x: f64,
        y: f64,
        text: &[u8],
        advances: Option<&[f64]>,
        run_width: Option<f64>,
        plot: &mut dyn FnMut(i64, i64),
    ) -> Result<Option<(f64, f64)>, Stop> {
        let outline = self.outline;
        let font = &outline.font;
        let ppem = outline.ppem;
        let units = font.units_per_em();
        let scale = ppem / units;
        let baseline = y + outline.ascent;
        let cell_top = y;
        let cell_bottom = y + outline.ascent + outline.descent;
        let bold = self.font.smears();
        let italic = self.font.slants();

        // Reduced to a turn already: a whole turn draws what the upright
        // machinery draws at the turned size. **Recorded**, `rotate`.
        let turn = outline.escapement;
        let turning = turn != 0.0;
        let angle = radians(outline);
        let (entry_cos, entry_sin) = if turning {
            turn_entries(ppem, angle)
        } else {
            (ppem, 0.0)
        };
        let cosine = entry_cos / ppem;
        let sine = entry_sin / ppem;
        let turned = |px: f64, py: f64| {
            if turning {
                (px * cosine - py * sine, px * sine + py * cosine)
            } else {
                (px, py)
            }
        };

        // On a pixel that is not square the two entries that land across the
        // page are stretched by the resolutions' ratio, truncating
        // (`GDI.EXE` seg1 `6fa3`). **Recorded** by `rotherc`.
        let (h, v) = (outline.horizontal_res, outline.vertical_res);
        let aspect = if turning { h / v } else { 1.0 };
        let rotated = sine != 0.0 && cosine != 0.0;
        #[allow(clippy::float_cmp)]
        let across_row = |entry: f64| {
            if h == v {
                entry
            } else {
                ((entry * h + (v / 2.0).floor()) / v).trunc()
            }
        };
        let turn_matrix = [
            across_row(entry_cos),
            entry_sin,
            across_row(-entry_sin),
            entry_cos,
        ];

        // Where the glyphs go is worked out along the exact angle, in
        // sixteen-dot-sixteen, each carry rounded with a half away from
        // nought. **Measured** on `rotpen`.
        let path_sine = fixed(angle.sin());
        let path_cosine = if turning { fixed(angle.cos()) } else { 1.0 };
        let (base_x, base_y) = if turning {
            let (bx, by, _, _) = self.turned_base(x, y, text, run_width, path_sine, path_cosine)?;

            (bx, by)
        } else {
            (x, y)
        };

        let stretch = self.font.stretch();
        let across_pixels = outline.x_ppem;
        let grid = (ppem * 64.0) / units;
        let sideways = outline.x_whole;
        let count = text.len();
        let mut pen = x;
        let mut glyph_box = None;

        for (index, &code) in text.iter().enumerate() {
            let glyph = font.glyph_for(u32::from(code));
            let unfitted = |contours: Vec<Contour>| Fitted {
                contours,
                hinted: false,
                scaled: false,
                advance: None,
                dropout: None,
                scan_type: None,
            };

            // A slant is drawn from the raw outline with no program run:
            // **measured**, `symbol-shapes`. A turn by right angles on a
            // pixel that is not square is fitted at each row's own stretch;
            // a rotated glyph is not fitted, the font's own `prep` saying so
            // when `GETINFO` says it is rotated.
            let raw = if italic {
                unfitted(font.outline_of(glyph, 0).map_err(unreadable)?)
            } else if aspect != 1.0 && !rotated {
                let down = turn_matrix[2].abs().max(turn_matrix[3].abs());
                let across = turn_matrix[0].abs().max(turn_matrix[1].abs());

                font.hinted_outline(glyph, down, true, across / down, rotated)
                    .map_err(unreadable)?
            } else {
                font.hinted_outline(glyph, ppem, true, stretch, rotated)
                    .map_err(unreadable)?
            };

            // A turned glyph goes through the scaler's transform from the
            // design outline -- a made-up slant with the shear in the matrix,
            // added before the stretch across (`6f63` before `6fa3`).
            let (fitted, turned_already) = if turning && italic {
                let [m00, m01, m10, m11] = slanted_turn(entry_cos, entry_sin);
                let matrix = [across_row(m00), m01, across_row(m10), m11];
                let contours = transform_outline(
                    &font.outline_of(glyph, 0).map_err(unreadable)?,
                    matrix,
                    units,
                );

                (
                    Fitted {
                        contours,
                        hinted: true,
                        scaled: true,
                        ..raw
                    },
                    true,
                )
            } else if rotated {
                let contours = transform_outline(
                    &font.outline_of(glyph, 0).map_err(unreadable)?,
                    turn_matrix,
                    units,
                );

                (
                    Fitted {
                        contours,
                        hinted: true,
                        scaled: true,
                        ..raw
                    },
                    true,
                )
            } else if raw.scaled || stretch == 1.0 {
                (raw, false)
            } else {
                // The stretch folded into the sixty-fourth the raster rounds
                // to, on the exact product: **measured**, Symbol's slanted `m`
                // and `y` at fifteen on both displays not square.
                let contours = raw
                    .contours
                    .iter()
                    .map(|contour| {
                        contour
                            .iter()
                            .map(|point| Point {
                                x: round((point.x * sideways * 64.0) / units) / grid,
                                ..*point
                            })
                            .collect()
                    })
                    .collect();

                (Fitted { contours, ..raw }, false)
            };

            // A slanted glyph is carried across its side bearing in whole
            // pixels, the sixty-fourths' half going down; an unfitted upright
            // one in sixty-fourths at seven per em and above and in whole
            // pixels below. **Read** off `dot-bearing` and `dot-fine`.
            let bearing = font.bearing_shift(glyph).map_err(unreadable)?;
            let shift = ((bearing * ppem * stretch * 64.0) / units - 0.5).ceil();
            let carried = if italic {
                round(shift / 64.0)
            } else if fitted.hinted {
                0.0
            } else if ppem < 7.0 {
                ((bearing * ppem) / units - 0.5).ceil()
            } else {
                shift / 64.0
            };

            let contours = &fitted.contours;
            let up = if fitted.scaled { 1.0 } else { scale };
            let max_width = round((font.bounding_width() * across_pixels) / units);

            if !contours.is_empty()
                && has_room(contours, up, max_width, outline.ascent + outline.descent)
            {
                let slanted = if italic && !turned_already {
                    slant(
                        contours,
                        if fitted.scaled { 1.0 } else { scale },
                        ppem,
                        across_pixels,
                    )
                } else {
                    contours.clone()
                };
                let placed: Vec<Contour> = if turning && !turned_already {
                    slanted
                        .iter()
                        .map(|contour| {
                            contour
                                .iter()
                                .map(|point| {
                                    let (px, py) = turned(point.x * up, point.y * up);

                                    Point {
                                        x: px,
                                        y: py,
                                        on: point.on,
                                    }
                                })
                                .collect()
                        })
                        .collect()
                } else {
                    slanted
                };

                let along = pen - x + carried;
                let filled = fill_walked(
                    &placed,
                    FillOptions {
                        scale: if turning || fitted.scaled { 1.0 } else { scale },
                        origin_x: if turning {
                            base_x + away(along * path_cosine)
                        } else {
                            pen + carried
                        },
                        origin_y: if turning {
                            base_y - away(self.to_down(along) * path_sine)
                        } else {
                            baseline
                        },
                        width: self.width,
                        height: self.height,
                        // What the font's own `SCANCTRL` asked for at the size;
                        // an unhinted outline keeps the default.
                        dropout: fitted.dropout.unwrap_or(true),
                        // A glyph Windows is slanting keeps every row it had
                        // upright, and a font's `SCANTYPE` other than the rule
                        // excluding stubs spares a stroke's ends.
                        stubs: !italic && fitted.scan_type.unwrap_or(1.0) == 1.0,
                        lean: if italic && !turned_already {
                            lean_of(ppem, across_pixels)
                        } else {
                            0.0
                        },
                        ppem,
                        across: across_pixels,
                    },
                );
                let (box_left, box_right) = (filled.left, filled.right);

                glyph_box = Some((box_left, box_right));

                // The cell GDI lays the glyph out in: the box's left edge plus
                // the device advance, read out of GDI's memory beside the box.
                let cell = box_left + self.advance(code)?;
                let last_glyph = index == count - 1;

                // The cell clips an upright glyph and cannot clip a turned one.
                let (from, to) = if turning {
                    (0, self.height)
                } else {
                    (
                        (cell_top.max(0.0)) as i64,
                        (self.height as f64).min(cell_bottom) as i64,
                    )
                };

                for row in from..to {
                    for column in 0..self.width {
                        if filled.pixels[(row * self.width + column) as usize] == 0 {
                            continue;
                        }

                        plot(column, row);

                        // The smear a column across, which every glyph but the
                        // last draws whole; the last keeps the bold cell and
                        // the byte where the ground is opaque and stops at its
                        // box where it is transparent. A Hercules, and turned
                        // text, draw it wherever it reaches. **Read out of
                        // `VGA.DRV`'s 386 `StrBlt`** and **recorded** by
                        // `smearrun` and `smearmod`, 1,280 records.
                        let next = (column + 1) as f64;
                        let cell_rule =
                            next < box_right || (box_right <= cell && box_right % 8.0 != 0.0);
                        let overhang_rule = if !last_glyph {
                            true
                        } else if self.back_mode == OPAQUE {
                            cell_rule
                        } else {
                            next < box_right
                        };

                        if bold && (turning || self.driver_always || overhang_rule) {
                            plot(column + 1, row);
                        }
                    }
                }
            }

            // The pen moves as `LogicalFont.measure` measures, a synthesised
            // bold a pixel a character -- two turned where the device paints
            // bold, GDI's simulation adding one to the character extra (seg16
            // `0030`). **Recorded** by `rotstyle` and `smearmod`.
            pen += match advances {
                Some(advances) => advances[index] + self.char_extra,
                None => {
                    self.advance(code)?
                        + self.char_extra
                        + if bold {
                            if turning && self.device_paints_bold() {
                                2.0
                            } else {
                                1.0
                            }
                        } else {
                            0.0
                        }
                }
            };
        }

        Ok(glyph_box)
    }
}

impl Writer {
    /// The outline face being drawn with, and the text state, as a pen.
    pub(super) fn pen(&self) -> Option<Pen<'_>> {
        let outline = self.font.outline.as_ref()?;

        Some(Pen {
            font: &self.font,
            outline,
            back_mode: self.back_mode,
            text_align: self.text_align,
            char_extra: self.char_extra as f64,
            driver_always: self.bold_always,
            width: i64::from(self.target.width()),
            height: i64::from(self.target.height()),
        })
    }

    /// Whether text drawn now is turned.
    pub(super) fn turned_text(&self) -> bool {
        self.pen().is_some_and(|pen| pen.turned())
    }

    /// Whether GDI draws a synthesised bold itself.
    pub(super) fn gdi_draws_bold(&self) -> bool {
        self.pen().is_some_and(|pen| pen.gdi_draws_bold())
    }

    /// The outline glyphs of a string, in the text colour.
    pub(super) fn outline_text(
        &mut self,
        x: i64,
        y: i64,
        text: &[u8],
        advances: Option<&[f64]>,
        run_width: Option<f64>,
    ) -> Result<(), Stop> {
        let Some(pen) = self.pen() else {
            return Ok(());
        };
        let mut ink = Vec::new();

        pen.draw(
            x as f64,
            y as f64,
            text,
            advances,
            run_width,
            &mut |column, row| {
                ink.push((column, row));
            },
        )?;

        let colour = self.text;

        for (column, row) in ink {
            self.target
                .context
                .set_pixel(column as i32, row as i32, colour);
        }

        Ok(())
    }

    /// An outline face's ground: where GDI draws the bold itself it is
    /// painted twice -- a space's ground at the pen, then the run's a pixel
    /// on (`GDI.EXE` seg16 `0030`). **Recorded** by `smeargnd`.
    pub(super) fn outline_ground(
        &mut self,
        x: i64,
        y: i64,
        text: &[u8],
        run_width: Option<f64>,
    ) -> Result<(), Stop> {
        if self.back_mode == TRANSPARENT || self.run_only {
            return Ok(());
        }

        if self.gdi_draws_bold() {
            self.ground_of(x, y, b" ", None)?;
            return self.ground_of(x + 1, y, text, run_width);
        }

        self.ground_of(x, y, text, run_width)
    }

    /// One ground: upright a rectangle, turned the rectangle as `Polygon`
    /// fills it with no pen, its corners whole pixels -- the reference point
    /// moved by the alignment, carried along the baseline by the width and
    /// down by the cell, each carry rounded on its own. **Recorded** by
    /// `rotstyle` and `polyfill`.
    fn ground_of(
        &mut self,
        x: i64,
        y: i64,
        text: &[u8],
        run_width: Option<f64>,
    ) -> Result<(), Stop> {
        let Some(pen) = self.pen() else {
            return Ok(());
        };
        let (left, mut right, height) = pen.ground_box(text, None, false)?;

        if pen.gdi_draws_bold() && pen.turned() && pen.device_paints_bold() {
            right += text.len() as f64;
        }

        if pen.turned() {
            let (sine, cosine) = pen.turned_trig();
            let width = run_width.unwrap_or(right - left);
            let (_, _, align_x, align_y) =
                pen.turned_base(x as f64, y as f64, text, run_width, sine, cosine)?;
            let origin_x = x as f64 + align_x + away(left * cosine);
            let origin_y = y as f64 + align_y - away(pen.to_down(left) * sine);
            let along_x = origin_x + away(width * cosine);
            let along_y = origin_y - away(pen.to_down(width) * sine);
            let down_x = away(pen.to_across(height) * sine);
            let down_y = away(height * cosine);
            let corners = vec![
                (origin_x as i32, origin_y as i32),
                (along_x as i32, along_y as i32),
                ((along_x + down_x) as i32, (along_y + down_y) as i32),
                ((origin_x + down_x) as i32, (origin_y + down_y) as i32),
            ];
            let back = self.back;

            self.fill_polygon(&corners, back);
            return Ok(());
        }

        fill_rect(
            &mut self.target.context,
            x as f64 + left,
            y as f64,
            right - left,
            height,
            self.back,
        );
        Ok(())
    }

    /// A polygon filled as GDI fills one for a display driver that takes
    /// only scanlines, its pixels set as they are.
    fn fill_polygon(&mut self, points: &[(i32, i32)], colour: [u8; 4]) {
        let width = self.target.width();
        let height = self.target.height();

        for (row, left, right) in rings_spans(&[points.to_vec()], false, true) {
            for column in left..right {
                if column >= 0 && column < width && row >= 0 && row < height {
                    self.target.context.set_pixel(column, row, colour);
                }
            }
        }
    }

    /// An outline face's underline and strikeout, from the font's own
    /// tables: `post`'s position and thickness for the underline, `OS/2`'s
    /// for the strikeout, scaled at the size and rounded, at least a row.
    /// Turned, each row of a rule is the driver's line along the turned
    /// baseline, ends and all, and a thicker one a `Polygon` with its edges
    /// drawn. **Recorded** by `rules` and `rotstyle`.
    #[allow(clippy::too_many_lines)]
    pub(super) fn outline_rules(
        &mut self,
        x: i64,
        y: i64,
        text: &[u8],
        run_width: Option<f64>,
    ) -> Result<(), Stop> {
        let style = self.font.style.clone();
        let underline = style.underline.unwrap_or(false);
        let strikeout = style.strikeout.unwrap_or(false);

        if (!underline && !strikeout) || (self.run_only && run_width.is_none()) {
            return Ok(());
        }

        let Some(pen) = self.pen() else {
            return Ok(());
        };
        let outline = pen.outline;
        let font = outline.font.clone();
        let ppem = outline.ppem;
        let width = match run_width {
            Some(width) => width,
            None => pen.measure(text)?.0,
        };
        let ascent = outline.ascent;
        let baseline = y as f64 + ascent;
        let across = |units: f64| round((units * ppem) / font.units_per_em());
        let thick = |rows: f64| rows.max(1.0);
        let under = (
            ascent + across(-font.underline_position()),
            thick(across(font.underline_thickness())),
        );
        let struck = (
            ascent - across(font.strikeout_position()),
            thick(across(font.strikeout_size())),
        );

        if pen.turned() {
            let (sine, cosine) = pen.turned_trig();
            let (h, v) = (outline.horizontal_res, outline.vertical_res);
            #[allow(clippy::float_cmp)]
            let mul_div = |value: f64, numerator: f64, denominator: f64| {
                if numerator == denominator {
                    value
                } else {
                    away((value * numerator) / denominator)
                }
            };
            let (_, _, align_x, align_y) =
                pen.turned_base(x as f64, y as f64, text, run_width, sine, cosine)?;
            let start_x = x as f64 + align_x;
            let start_y = y as f64 + align_y;
            let ends = |down: f64| {
                let from_x = start_x + away(mul_div(down, h, v) * sine);
                let from_y = start_y + away(down * cosine);

                (
                    from_x,
                    from_y,
                    from_x + away(width * cosine),
                    from_y - away(mul_div(width, v, h) * sine),
                )
            };
            let shift = |rows: f64| {
                (
                    away(mul_div(rows - 1.0, h, v) * sine),
                    away((rows - 1.0) * cosine),
                )
            };
            let mut bands = Vec::new();

            if underline {
                bands.push((ends(under.0), under.1, shift(under.1)));
            }

            if strikeout {
                bands.push((ends(struck.0), struck.1, shift(struck.1)));
            }

            let colour = self.text;
            let walk = Walk {
                exclude_last: false,
                polyline: false,
                ..self.walk
            };

            for ((ax, ay, bx, by), rows, (shift_x, shift_y)) in bands {
                if rows <= 1.0 {
                    line_walk::stroke(
                        &mut self.target.context,
                        &[(ax as i32, ay as i32), (bx as i32, by as i32)],
                        colour,
                        walk,
                    );
                    continue;
                }

                let corners = [
                    (ax, ay),
                    (bx, by),
                    (bx + shift_x, by + shift_y),
                    (ax + shift_x, ay + shift_y),
                ];
                let points: Vec<(i32, i32)> = corners
                    .iter()
                    .map(|&(px, py)| (px as i32, py as i32))
                    .collect();

                self.fill_polygon(&points, colour);

                for index in 0..points.len() {
                    let next = points[(index + 1) % points.len()];

                    line_walk::stroke(
                        &mut self.target.context,
                        &[points[index], next],
                        colour,
                        walk,
                    );
                }
            }

            return Ok(());
        }

        let black = [0, 0, 0, 0xff];

        if underline {
            fill_rect(
                &mut self.target.context,
                x as f64,
                baseline - ascent + under.0,
                width,
                under.1,
                black,
            );
        }

        if strikeout {
            fill_rect(
                &mut self.target.context,
                x as f64,
                baseline - ascent + struck.0,
                width,
                struck.1,
                black,
            );
        }

        Ok(())
    }
}

/// A character as `GetGlyphOutline` answers for it: its box, the box's
/// corner from the character's origin, its advance, and its rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlyphOutline {
    pub width: i64,
    pub height: i64,
    pub origin_x: i64,
    pub origin_y: i64,
    pub advance: i64,
    pub rows: Vec<Vec<u8>>,
}

/// One character of an outline face as `GetGlyphOutline` answers for it.
///
/// **Recorded** by `smearglf`: the glyph is the one `TextOut` draws upright
/// at the realised font's own size, hinted, and nothing else -- not turned by
/// the font's escapement and not smeared by a bold GDI would synthesise. So
/// it is drawn upright and unsmeared into a scratch square, transparent, and
/// read back; across, the box is the scan converter's, which can carry a
/// blank column the ink does not reach.
pub(crate) fn glyph_outline(font: &LogicalFont, code: u8) -> Result<Option<GlyphOutline>, Stop> {
    let Some(outline) = &font.outline else {
        return Ok(None);
    };

    let weight = font.style.weight;
    let synthesised = weight.unwrap_or(0) > 550 && !outline.face_bold;
    let mut upright = font.clone();

    upright.style.weight = if synthesised { Some(400) } else { weight };

    if let Some(turned) = upright.outline.as_mut() {
        turned.escapement = 0.0;
    }

    let Some(upright_outline) = &upright.outline else {
        return Ok(None);
    };
    let size = 64.0_f64.max(outline.ppem * 4.0) as i64;
    let pad = size / 4;
    let pen = Pen {
        font: &upright,
        outline: upright_outline,
        back_mode: TRANSPARENT,
        text_align: 0,
        char_extra: 0.0,
        driver_always: false,
        width: size,
        height: size,
    };
    let mut inked = vec![false; (size * size) as usize];
    let glyph_box = pen.draw(
        pad as f64,
        pad as f64,
        &[code],
        None,
        None,
        &mut |column, row| {
            if column >= 0 && column < size && row >= 0 && row < size {
                inked[(row * size + column) as usize] = true;
            }
        },
    )?;

    let (mut left, mut top, mut right, mut bottom) = (size, size, -1, -1);

    for row in 0..size {
        for column in 0..size {
            if inked[(row * size + column) as usize] {
                left = left.min(column);
                right = right.max(column);
                top = top.min(row);
                bottom = bottom.max(row);
            }
        }
    }

    let advance = font.outline_advance(u32::from(code)).map_err(unreadable)? as i64;

    if right >= 0
        && let Some((box_left, box_right)) = glyph_box
    {
        left = box_left as i64;
        right = box_right as i64 - 1;
    }

    if right < 0 {
        return Ok(Some(GlyphOutline {
            width: 0,
            height: 0,
            origin_x: 0,
            origin_y: 0,
            advance,
            rows: Vec::new(),
        }));
    }

    let rows = (top..=bottom)
        .map(|row| {
            (left..=right)
                .map(|column| {
                    u8::from(column >= 0 && column < size && inked[(row * size + column) as usize])
                })
                .collect()
        })
        .collect();

    Ok(Some(GlyphOutline {
        width: right - left + 1,
        height: bottom - top + 1,
        origin_x: left - pad,
        origin_y: pad + outline.ascent as i64 - top,
        advance,
        rows,
    }))
}

#[cfg(test)]
mod tests;
