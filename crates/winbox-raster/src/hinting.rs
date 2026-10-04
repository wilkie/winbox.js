//! The TrueType hinting interpreter.
//!
//! A TrueType font carries a program per glyph, and two more that set things
//! up: `fpgm` defines functions once, `prep` runs whenever the size changes.
//! What they do is move the outline's points onto the pixel grid before
//! anything is filled -- pulling a stem onto a whole column so it comes out
//! crisp rather than smeared across two. At the sizes text is read at that
//! decides where about half the ink goes.
//!
//! It is a stack machine with a graphics state, and the state is most of the
//! difficulty: an instruction like `MIRP` reads the projection vector, the
//! freedom vector, three reference points, two zone pointers, the round
//! state, the control value cut-in and the minimum distance, and moves one
//! point accordingly. Getting any of them wrong moves a point silently.
//!
//! Everything is in `F26Dot6` -- a whole number of sixty-fourths of a pixel
//! -- except the unit vectors, which are `F2Dot14`. The mixture is the format's.
//!
//! An instruction that is not implemented is a `Fault`, and the caller falls
//! back to the unhinted outline for that glyph: a half-run program leaves
//! points moved by some instructions and not others, which is worse than not
//! hinting at all, and silently wrong rather than visibly so. A read past
//! the end of the font is the same fault, as it is a thrown `RangeError` in
//! the TypeScript engine, which catches both alike.
//!
//! The numbers are a JavaScript engine's, because that is what every rule
//! here was measured through: a coordinate may carry a fraction (a component
//! scaled by a fraction does), a point a program names past the end of its
//! zone reads as nothing and turns what it touches into not-a-number, and a
//! value pushed is truncated to thirty-two bits.

// Deliberately: numbers compared and converted as a JavaScript engine's
// are, since every rule here was measured through one.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use std::collections::HashMap;

use crate::js;
use crate::truetype::{Contour, Fault, FontData, Point};

/// How many instructions one program may run before it is assumed stuck.
const STEP_LIMIT: u32 = 400_000;

/// How deep functions may call one another. The TypeScript engine has no
/// limit of its own and stops where its host's stack runs out, which it
/// catches as it catches any other fault; this stops at a depth no font's
/// program reaches, rather than at the native stack's end.
const CALL_DEPTH: u32 = 2_000;

/// A point's coordinates are sixty-fourths of a pixel.
pub const ONE: f64 = 64.0;

/// Unit vector components are sixteen-thousand-three-hundred-and-eighty-fourths.
const UNIT: f64 = 16384.0;

const ONEFIX: f64 = 65536.0;

/// Multiply a 16.16 fixed number by another -- or an integer by one -- to the
/// nearest, as the reference's `FixMul` does: a half goes toward positive
/// infinity whatever the sign. **Measured**: the width sweep goes from 24
/// wrong cells and 111 wrong pixels to 21 and 35 with the half going up.
fn fix_mul(a: f64, b: f64) -> f64 {
    ((a * b + 32768.0) / 65536.0).floor()
}

/// Divide, the result a 16.16 fixed number to the nearest, as `FixDiv`.
/// Truncating instead is refused by count: 1,984 stretched cells of 2,043
/// and 163 wrong pixels against 2,022 and 35.
fn fix_div(a: f64, b: f64) -> f64 {
    let quotient = (a * 65536.0) / b;

    if quotient < 0.0 {
        -(-quotient + 0.5).floor()
    } else {
        (quotient + 0.5).floor()
    }
}

/// `a * b / c` to the nearest, a half going toward positive infinity: the
/// scaler's `ShortFracMul`, what a projection is made of. The two
/// projections use it, in the reference's operand order; the point move,
/// `IP`'s `MulDiv26Dot6` and the freedom dot product keep `mul_div`, each
/// **measured**.
fn mul_div_up(a: f64, b: f64, c: f64) -> f64 {
    if c == 0.0 {
        return 0.0;
    }

    let (a, c) = if c < 0.0 { (-a, -c) } else { (a, c) };

    ((a * b) / c + 0.5).floor()
}

/// `a * b / c`, rounded the way the format's own arithmetic rounds: the sign
/// taken off first and put back at the end, so a half rounds away from zero.
fn mul_div(a: f64, b: f64, c: f64) -> f64 {
    let mut sign = 1.0;
    let (mut a, mut b, mut c) = (a, b, c);

    if a < 0.0 {
        a = -a;
        sign = -sign;
    }

    if b < 0.0 {
        b = -b;
        sign = -sign;
    }

    if c < 0.0 {
        c = -c;
        sign = -sign;
    }

    if c == 0.0 {
        return 0.0;
    }

    let result = ((a * b + (c / 2.0).floor()) / c).floor();

    if sign < 0.0 { -result } else { result }
}

/// Scales a font-unit measurement to pixels, rounding halves upward -- not
/// away from zero. Control values are compared and rounded against each
/// other by `prep` and by the glyph programs, and Times New Roman Italic's
/// `!` at 92 pixels per em takes a branch on a negative half.
/// **Measured**: 12 wrong advances against `hdmx` to 8, over 22,056.
pub(crate) fn scale_to_pixels(units: f64, pixels: f64, units_per_em: f64) -> f64 {
    ((units * pixels + units_per_em / 2.0) / units_per_em).floor()
}

/// `DIV`, which truncates where `MUL` rounds. **Measured**: Arial Bold's `j`
/// at 32, 33 and 37 pixels per em is the case that shows it.
fn divide(a: f64, b: f64) -> f64 {
    if b == 0.0 {
        return 0.0;
    }

    let mut sign = 1.0;
    let (mut top, mut bottom) = (a, b);

    if top < 0.0 {
        top = -top;
        sign = -sign;
    }

    if bottom < 0.0 {
        bottom = -bottom;
        sign = -sign;
    }

    let result = ((top * ONE) / bottom).floor();

    if sign < 0.0 { -result } else { result }
}

/// What a JavaScript array holds: a value at an index, or nothing -- an
/// index written past the end leaves holes behind it, and one that is
/// negative is a property and no element at all.
#[derive(Debug, Clone, Default)]
pub(crate) struct Slots<T: Copy> {
    dense: Vec<Option<T>>,
    sparse: HashMap<i64, T>,
    length: usize,
}

/// How far past the end a write may land and still be kept in the array
/// itself rather than beside it.
const DENSE_REACH: usize = 4096;

impl<T: Copy> Slots<T> {
    fn filled(count: usize, value: T) -> Self {
        Self {
            dense: vec![Some(value); count],
            sparse: HashMap::new(),
            length: count,
        }
    }

    fn len(&self) -> usize {
        self.length
    }

    fn push(&mut self, value: T) {
        let at = self.length;

        self.set_at(at as i64, value);
    }

    pub(crate) fn at(&self, index: i64) -> Option<T> {
        // A hole the array has grown over may still be held beside it, from
        // a write that landed further out than the array then reached.
        if index >= 0
            && let Some(Some(value)) = self.dense.get(index as usize)
        {
            return Some(*value);
        }

        self.sparse.get(&index).copied()
    }

    fn set_at(&mut self, index: i64, value: T) {
        if index >= 0 {
            let at = index as usize;

            if at < self.dense.len() {
                self.dense[at] = Some(value);
            } else if at < self.dense.len() + DENSE_REACH {
                self.dense.resize(at, None);
                self.dense.push(Some(value));
            } else {
                self.sparse.insert(index, value);
            }

            self.length = self.length.max(at + 1);
            return;
        }

        self.sparse.insert(index, value);
    }
}

/// An index as a number names one: an integer reaches an element, anything
/// else a property no program can have written.
fn index_of(value: f64) -> Option<i64> {
    (value.is_finite() && value.fract() == 0.0).then_some(value as i64)
}

impl Slots<f64> {
    /// A coordinate, where not-a-number is what reading nothing comes to.
    fn get(&self, index: f64) -> f64 {
        index_of(index)
            .and_then(|index| self.at(index))
            .unwrap_or(f64::NAN)
    }

    fn set(&mut self, index: f64, value: f64) {
        if let Some(index) = index_of(index) {
            self.set_at(index, value);
        }
    }

    fn add(&mut self, index: f64, value: f64) {
        let sum = self.get(index) + value;

        self.set(index, sum);
    }

    /// A copy of every element, holes and all, as `slice` makes one.
    fn copy(&self) -> Self {
        Self {
            dense: self.dense.clone(),
            sparse: HashMap::new(),
            length: self.length,
        }
    }
}

impl Slots<bool> {
    /// A flag, where reading nothing is false.
    fn get(&self, index: f64) -> bool {
        index_of(index)
            .and_then(|index| self.at(index))
            .unwrap_or(false)
    }

    fn set(&mut self, index: f64, value: bool) {
        if let Some(index) = index_of(index) {
            self.set_at(index, value);
        }
    }
}

/// The points of a glyph, in both the state they arrived in and the current
/// one.
#[derive(Debug, Clone, Default)]
pub(crate) struct Zone {
    x: Slots<f64>,
    y: Slots<f64>,
    original_x: Slots<f64>,
    original_y: Slots<f64>,
    unscaled_x: Slots<f64>,
    unscaled_y: Slots<f64>,
    on_curve: Slots<bool>,
    touched_x: Slots<bool>,
    touched_y: Slots<bool>,
    ends: Vec<f64>,

    /// How many points this zone has, which is not the same as how many the
    /// arrays have come to hold.
    ///
    /// A glyph program is free to name a point that does not exist, and the
    /// reference interpreter does not stop it: every `CHECK_POINT` in it is
    /// inside `FSCFG_DEBUG` and compiled out of anything shipped. What it
    /// does instead is what C does -- it writes past the end of the element's
    /// point array, and nothing ever reads it back as a point. The advance
    /// and the pen are read as `length - 3` and `length - 4`, so one write to
    /// a point past the last must not move them: the count is fixed when the
    /// zone is finished and the arrays are allowed to grow behind it.
    count: Option<usize>,
}

impl Zone {
    fn new(count: usize) -> Self {
        Self {
            x: Slots::filled(count, 0.0),
            y: Slots::filled(count, 0.0),
            original_x: Slots::filled(count, 0.0),
            original_y: Slots::filled(count, 0.0),
            unscaled_x: Slots::filled(count, 0.0),
            unscaled_y: Slots::filled(count, 0.0),
            on_curve: Slots::filled(count, true),
            touched_x: Slots::filled(count, false),
            touched_y: Slots::filled(count, false),
            ends: Vec::new(),
            count: (count > 0).then_some(count),
        }
    }

    /// Fixes the point count, once every point the glyph has is in, and pads
    /// the arrays out to the buffer the scaler would have allocated -- with
    /// whatever the glyph before this one left in it.
    ///
    /// The scaler allocates one buffer per size and fits every glyph in it
    /// in turn, so what lies past the outline is the tail of whatever was
    /// fitted before. **Measured**: carrying the previous glyph's tail
    /// forward rather than clearing it takes the fabricated corpus from
    /// 26,029 of 26,058 cells and 118 wrong pixels to 26,055 and 9.
    fn seal(&mut self, capacity: usize, held: &Zone) {
        self.count = Some(self.x.len());

        for at in self.x.len()..capacity {
            let at_index = at as i64;

            self.x.push(held.x.at(at_index).unwrap_or(0.0));
            self.y.push(held.y.at(at_index).unwrap_or(0.0));
            self.original_x
                .push(held.original_x.at(at_index).unwrap_or(0.0));
            self.original_y
                .push(held.original_y.at(at_index).unwrap_or(0.0));
            self.unscaled_x
                .push(held.unscaled_x.at(at_index).unwrap_or(0.0));
            self.unscaled_y
                .push(held.unscaled_y.at(at_index).unwrap_or(0.0));
            self.on_curve
                .push(held.on_curve.at(at_index).unwrap_or(false));
            self.touched_x.push(false);
            self.touched_y.push(false);
        }
    }

    fn length(&self) -> usize {
        self.count.unwrap_or_else(|| self.x.len())
    }

    /// A contour's last point, as `zone.ends[contour]` reads it.
    fn end(&self, contour: f64) -> Option<f64> {
        index_of(contour)
            .filter(|&at| at >= 0)
            .and_then(|at| self.ends.get(at as usize).copied())
    }
}

/// A unit vector, in `F2Dot14`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Vector {
    x: f64,
    y: f64,
}

const X_AXIS: Vector = Vector { x: UNIT, y: 0.0 };
const Y_AXIS: Vector = Vector { x: 0.0, y: UNIT };

/// The graphics state.
#[derive(Debug, Clone, Copy)]
struct State {
    projection: Vector,
    freedom: Vector,
    dual: Vector,

    rp0: f64,
    rp1: f64,
    rp2: f64,

    zp0: f64,
    zp1: f64,
    zp2: f64,

    loop_count: f64,
    round_period: f64,
    round_period45: f64,
    round_phase: f64,
    round_threshold: f64,
    rounding: bool,

    minimum_distance: f64,
    control_cut_in: f64,
    single_width: f64,
    single_width_cut_in: f64,

    auto_flip: bool,
    delta_base: f64,
    delta_shift: f64,
    instruction_control: f64,
}

impl State {
    /// The graphics state as it stands at the start of every program.
    fn fresh() -> Self {
        Self {
            projection: X_AXIS,
            freedom: X_AXIS,
            dual: X_AXIS,
            rp0: 0.0,
            rp1: 0.0,
            rp2: 0.0,
            zp0: 1.0,
            zp1: 1.0,
            zp2: 1.0,
            loop_count: 1.0,
            round_period: ONE,
            round_period45: 0.0,
            round_phase: 0.0,
            round_threshold: ONE / 2.0,
            rounding: true,
            minimum_distance: ONE,
            control_cut_in: (17.0 * ONE) / 16.0,
            single_width: 0.0,
            single_width_cut_in: 0.0,
            auto_flip: true,
            delta_base: 9.0,
            delta_shift: 3.0,
            instruction_control: 0.0,
        }
    }
}

/// A function `FDEF` defined: where its body starts and where it ends.
#[derive(Debug, Clone, Copy)]
struct Function {
    at: i64,
    end: i64,
}

/// A composite glyph assembled in pixels, with the advance the component
/// claiming its metrics came out with.
#[derive(Debug, Clone)]
pub(crate) struct Assembly {
    pub contours: Vec<Contour>,
    pub advance: Option<f64>,
}

/// What a size's scaling is, apart from the interpreter: the conversions a
/// composite's assembly borrows from the hinter that will fit it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Scaling {
    pixels: f64,
    x_pixels: f64,
    units_per_em: f64,
}

impl Scaling {
    pub(crate) fn new(ppem: f64, stretch: f64, units_per_em: f64) -> Self {
        Self {
            pixels: ppem * ONE,
            x_pixels: ppem * stretch * ONE,
            units_per_em,
        }
    }

    /// Font units into pixels, a half going upward and not away from zero:
    /// a coordinate is not a distance, and rounding outward makes the same
    /// shape mirrored not the same shape scaled. **Measured**: Courier New's
    /// `g` at ten pixels per em, whose descender tail begins at exactly 86.5
    /// sixty-fourths and whose program does not run there.
    pub(crate) fn to_pixels(self, units: f64) -> f64 {
        ((units * self.pixels) / self.units_per_em + 0.5).floor()
    }

    /// The same along `x`, at the stretched horizontal size.
    pub(crate) fn to_pixels_x(self, units: f64) -> f64 {
        ((units * self.x_pixels) / self.units_per_em + 0.5).floor()
    }

    /// A side bearing in sixty-fourths, as much of it as the outline carries:
    /// rounded toward zero on a half, which is not what `mul_div` does. The
    /// `w` bearing of 13 units scales to exactly 32 sixty-fourths at eighty
    /// pixels per em and Windows carries no pixel out there, and one at
    /// eighty-one. **Recorded.**
    pub(crate) fn bearing_in(self, shift: f64) -> f64 {
        toward(shift * self.x_pixels, self.units_per_em) / self.units_per_em
    }

    /// The whole pixels of a side bearing, which sit outside the outline.
    pub(crate) fn carry(self, shift: f64) -> f64 {
        toward(self.bearing_in(shift), ONE)
    }
}

/// Rounding toward zero on a half, to a multiple.
fn toward(value: f64, by: f64) -> f64 {
    js::sign(value) * (value.abs() / by - 0.5).ceil() * by
}

/// What a program reads its instructions from: the whole font.
type Program<'a> = &'a FontData;

/// Runs a font's hinting programs.
///
/// One of these is built per font and per size: `fpgm` and `prep` are run
/// once between them, and then each glyph's own program is run against the
/// points of that glyph.
#[derive(Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct Hinter {
    ppem: f64,
    stretch: f64,
    x_size: f64,
    pixels: f64,
    cvt_size: f64,
    cvt_pixels: f64,
    units_per_em: f64,
    max_points: usize,
    max_twilight: usize,
    rotated: bool,
    round_phantoms: bool,
    composite: bool,
    scaling: Scaling,

    stack: Vec<i32>,
    storage: Slots<f64>,
    cvt: Slots<f64>,
    functions: HashMap<i64, Function>,

    zones: [Zone; 2],
    state: State,
    defaults: State,

    ready: bool,
    scan_control: Option<f64>,
    scan_type: Option<f64>,
    /// What `prep` left for the scan converter, which each glyph starts from
    /// again. Kept apart from the graphics state, since a glyph program may
    /// set `SCANCTRL` for its own glyph -- Arial Bold Italic's `ø` does --
    /// and that must not leak to the next.
    prep_scan: Option<(Option<f64>, Option<f64>)>,

    /// The glyph's advance after its program, in pixels and in
    /// sixty-fourths.
    pub advance: f64,
    pub advance_exact: f64,

    depth: u32,
}

impl Hinter {
    /// The interpreter for a font at a size.
    ///
    /// `round_phantoms` is whether the advance phantom starts on the grid,
    /// which is what Windows does. `stretch` is the horizontal size over the
    /// vertical one, which a requested width makes other than one. `rotated`
    /// is what `GETINFO` answers a font asking whether the glyph is turned.
    pub fn new(
        font: &FontData,
        ppem: f64,
        round_phantoms: bool,
        stretch: f64,
        rotated: bool,
    ) -> Result<Self, Fault> {
        let units_per_em = font.units_per_em();
        let x_size = js::round(ppem * stretch);
        let cvt_size = js::max(x_size, ppem);
        let max_twilight = font.max_twilight()?;
        let storage = Slots::filled(font.max_storage()?.max(64), 0.0);

        let mut hinter = Self {
            ppem,
            stretch,
            x_size,
            pixels: ppem * ONE,
            cvt_size,
            cvt_pixels: cvt_size * ONE,
            units_per_em,
            max_points: font.max_points()?,
            max_twilight,
            rotated,
            round_phantoms,
            composite: false,
            scaling: Scaling::new(ppem, stretch, units_per_em),
            stack: Vec::new(),
            storage,
            cvt: Slots::default(),
            functions: HashMap::new(),
            zones: [Zone::new(max_twilight), Zone::new(0)],
            state: State::fresh(),
            defaults: State::fresh(),
            ready: false,
            scan_control: None,
            scan_type: None,
            prep_scan: None,
            advance: 0.0,
            advance_exact: 0.0,
            depth: 0,
        };

        hinter.cvt = hinter.scaled_control_values(font)?;

        Ok(hinter)
    }

    /// The scale a control value is read through, as a 16.16 fixed number.
    ///
    /// When a width request stretches the face the reference scales the
    /// control values once, at one size, and multiplies every read by a
    /// factor that depends on the projection vector: `cvtStretchX` along
    /// `x`, `cvtStretchY` along `y`, the root of their squares weighted by the
    /// vector's components along a diagonal. **Measured**, through Arial's
    /// `prep`, which derives its x-height by interpolating a twilight point
    /// placed at an unrounded control value.
    fn cvt_scale(&self) -> f64 {
        if self.stretch == 1.0 {
            return ONEFIX;
        }

        let px = self.state.projection.x;
        let py = self.state.projection.y;
        let stretch_x = fix_div(self.x_size, self.cvt_size);
        let stretch_y = fix_div(self.ppem, self.cvt_size);

        if py == 0.0 {
            return stretch_x;
        }

        if px == 0.0 {
            return stretch_y;
        }

        // Components squared, in 2.14, then widened to 16.16 and weighted.
        let dot = |a: f64| ((a * a + 8192.0) / 16384.0).floor();
        let squares = fix_mul(js::shl(dot(px), 2.0), fix_mul(stretch_x, stretch_x))
            + fix_mul(js::shl(dot(py), 2.0), fix_mul(stretch_y, stretch_y));

        if squares > ONEFIX {
            return ONEFIX;
        }

        // A 2.30 square root, rounded to 16.16.
        js::sar((squares.sqrt() * 4_194_304.0).floor() + 8192.0, 14.0)
    }

    /// The pixel size along the projection vector, as `MPPEM` answers it and
    /// as a delta is keyed on.
    fn size_along(&self) -> f64 {
        if self.stretch == 1.0 {
            return self.ppem;
        }

        fix_mul(self.cvt_size, self.cvt_scale())
    }

    /// A control value as the program reads it.
    fn cvt_at(&self, index: f64) -> f64 {
        let value = index_of(index)
            .and_then(|index| self.cvt.at(index))
            .unwrap_or(0.0);

        if self.stretch == 1.0 {
            value
        } else {
            fix_mul(value, self.cvt_scale())
        }
    }

    fn to_pixels(&self, units: f64) -> f64 {
        self.scaling.to_pixels(units)
    }

    fn to_pixels_x(&self, units: f64) -> f64 {
        self.scaling.to_pixels_x(units)
    }

    /// The control value table, in pixels rather than in font units, scaled
    /// at the larger of the two sizes.
    fn scaled_control_values(&self, font: &FontData) -> Result<Slots<f64>, Fault> {
        let mut values = Slots::default();

        let Some(table) = font.table("cvt ") else {
            return Ok(values);
        };

        let mut at = 0;

        while at + 1 < table.length {
            let units = f64::from(font.i16_at(table.offset + at)?);

            values.push(scale_to_pixels(units, self.cvt_pixels, self.units_per_em));
            at += 2;
        }

        Ok(values)
    }

    /// Runs `fpgm` and `prep`, which between them set the size up.
    ///
    /// Marked ready before either runs, so a size whose `prep` faults is not
    /// run again: the next glyph starts from whatever it had got to.
    pub fn prepare(&mut self, font: &FontData) -> Result<(), Fault> {
        if self.ready {
            return Ok(());
        }

        self.ready = true;

        for tag in ["fpgm", "prep"] {
            let Some(table) = font.table(tag) else {
                continue;
            };

            self.state = State::fresh();
            self.stack.clear();

            self.run(font, table.offset, table.offset + table.length)?;

            if tag == "fpgm" {
                continue;
            }

            // Whatever `prep` left the state as is what each glyph starts from.
            self.defaults = self.state;
            self.prep_scan = Some((self.scan_control, self.scan_type));
        }

        Ok(())
    }

    /// Hints one glyph's points: the contours in font units -- or, for a
    /// composite, in pixels already, with its assembly -- its advance, left
    /// side bearing and `xMin` in font units, and where its instructions are
    /// in the font.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    pub(crate) fn hint(
        &mut self,
        font: &FontData,
        outline: &[Contour],
        advance: f64,
        left_side_bearing: f64,
        x_min: f64,
        at: i64,
        length: i64,
        assembly: Option<&Assembly>,
    ) -> Result<Vec<Contour>, Fault> {
        let composite = assembly.is_some();

        self.composite = composite;
        self.prepare(font)?;

        let mut zone = Zone::new(0);

        // The outline is moved so that its left edge lands on the side
        // bearing, in font units before the scaling: **recorded**, by three
        // fabricated glyphs whose program reads a point back magnified. A
        // composite was carried across its components' bearings as it was
        // assembled.
        let shift = if composite {
            0.0
        } else {
            left_side_bearing - x_min
        };

        // And only the part of the shift that a fixed point number can hold:
        // the whole pixels of it come off the outline and are carried outside
        // it. **Recorded**: 294 readings at three magnifications all come back
        // at `magnify * (point - whole) + whole`.
        let bearing = self.scaling.bearing_in(shift);
        let whole = toward(bearing, ONE);

        // When the font has switched its instructions off, the bearing is
        // carried in whole pixels. **Measured**: fifteen records of the corpus
        // and thirty-four fabricated cells, with Symbol's period at eight.
        let carried = if self.grid_fit() {
            bearing
        } else {
            js::round(bearing / ONE) * ONE
        };

        for contour in outline {
            for point in contour {
                zone.x.push(
                    (if composite {
                        point.x
                    } else {
                        self.to_pixels_x(point.x)
                    }) + carried
                        - whole,
                );
                zone.y.push(if composite {
                    point.y
                } else {
                    self.to_pixels(point.y)
                });
                zone.unscaled_x.push(point.x + shift);
                zone.unscaled_y.push(point.y);
                zone.on_curve.push(point.on);
                zone.touched_x.push(false);
                zone.touched_y.push(false);
            }

            zone.ends.push(zone.x.len() as f64 - 1.0);
        }

        // The phantom points: the glyph's origin, behind the outline by the
        // whole pixels taken out of it, and its advance, rounded to the grid
        // before the program runs -- **recorded**, by reading the phantom out
        // of a running Windows. A composite's advance is its claiming
        // component's own.
        let origin = -whole;
        let grid = |value: f64| ((value + ONE / 2.0) / ONE).floor() * ONE;
        let scaled_advance = match assembly {
            Some(Assembly {
                advance: Some(advance),
                ..
            }) => *advance,
            _ if self.round_phantoms => grid(self.to_pixels_x(advance)),
            _ => self.to_pixels_x(advance),
        };
        let width = origin + scaled_advance;

        // Four phantoms, and the last two are not the vertical ones: read out
        // of GDI's element after a draw, they hold the origin, the origin plus
        // the advance, the origin again, and `xMin`. **Recorded**: Times New
        // Roman's `ß` at twenty-seven per em gives `0 896 0 30`.
        let phantom = [origin, width, origin, self.to_pixels_x(x_min)];

        // And in design units, which `IP` takes its proportion from.
        let design = [0.0, advance, 0.0, x_min];

        for (index, x) in phantom.into_iter().enumerate() {
            zone.x.push(x);
            zone.y.push(0.0);
            zone.unscaled_x.push(design[index]);
            zone.unscaled_y.push(0.0);
            zone.on_curve.push(false);
            zone.touched_x.push(false);
            zone.touched_y.push(false);
        }

        zone.original_x = zone.x.copy();
        zone.original_y = zone.y.copy();

        // Except the advance phantom, which remembers where the scaling left
        // it -- scaled where the outline is and carried across the bearing --
        // rather than where the rounding put it. **Recorded**: Courier New's
        // bold italic `X`, and Symbol's omega at a hundred and thirty-nine.
        let last = zone.x.len() as f64 - 3.0;

        zone.original_x
            .set(last, self.to_pixels_x(advance - shift) + bearing - whole);

        // A composite has no design coordinates, so its scaled ones stand in.
        if composite {
            zone.unscaled_x = zone.original_x.copy();
            zone.unscaled_y = zone.original_y.copy();
        }

        zone.seal(self.max_points, &self.zones[1]);

        self.zones[1] = zone;
        self.zones[0] = Zone::new(self.max_twilight);

        if let Some((control, kind)) = self.prep_scan {
            self.scan_control = control;
            self.scan_type = kind;
        }

        self.state = self.glyph_state();
        self.stack.clear();

        // A font that asked for no grid-fitting at this size gets none: the
        // glyph's own program is what is refused, not the size.
        if self.grid_fit() {
            self.run(font, at, at + length)?;
        }

        // What the glyph advances by, once the program has had its say.
        let zone = &self.zones[1];
        let last = zone.length() as f64;

        self.advance = js::round((zone.x.get(last - 3.0) - zone.x.get(last - 4.0)) / ONE);
        self.advance_exact = zone.x.get(last - 3.0) - zone.x.get(last - 4.0);

        // Carried back onto the whole pixels of wherever the origin phantom
        // finished -- **recorded**, Times New Roman's right guillemet -- and a
        // composite onto where it started, since its components were placed
        // as they were assembled. **Measured**: 26,029 of 26,058 fabricated
        // cells and every recorded cell standing, split this way.
        let pen = if composite {
            origin
        } else {
            js::round(zone.x.get(zone.length() as f64 - 4.0) / ONE) * ONE
        };

        let mut hinted = Vec::with_capacity(outline.len());
        let mut index = 0.0;

        for contour in outline {
            let mut shape = Vec::with_capacity(contour.len());

            for _ in contour {
                shape.push(Point {
                    x: (zone.x.get(index) - pen) / ONE,
                    y: zone.y.get(index) / ONE,
                    on: zone.on_curve.get(index),
                });

                index += 1.0;
            }

            hinted.push(shape);
        }

        Ok(hinted)
    }

    /// The state a glyph program starts from: what the size program settled
    /// and a glyph inherits -- the round state, the distances, the cut-ins,
    /// the deltas, `INSTCTRL` -- and nothing about where `prep` had got to,
    /// least of all the zone pointers it left in the twilight zone.
    fn glyph_state(&self) -> State {
        let defaults = &self.defaults;

        State {
            rounding: defaults.rounding,
            round_period: defaults.round_period,
            round_phase: defaults.round_phase,
            round_threshold: defaults.round_threshold,
            minimum_distance: defaults.minimum_distance,
            control_cut_in: defaults.control_cut_in,
            single_width: defaults.single_width,
            single_width_cut_in: defaults.single_width_cut_in,
            auto_flip: defaults.auto_flip,
            delta_base: defaults.delta_base,
            delta_shift: defaults.delta_shift,
            instruction_control: defaults.instruction_control,
            ..State::fresh()
        }
    }

    /* ---- the machine ---- */

    fn push(&mut self, value: f64) {
        self.stack.push(js::int32(value));
    }

    fn pop(&mut self) -> Result<f64, Fault> {
        self.stack.pop().map(f64::from).ok_or(Fault)
    }

    /// Which zone a pointer names: nought the twilight zone, anything else
    /// the glyph's.
    fn zone_of(which: f64) -> usize {
        usize::from(which != 0.0)
    }

    /// How far along the projection vector a point sits.
    fn project(&self, x: f64, y: f64) -> f64 {
        mul_div_up(x, self.state.projection.x, UNIT) + mul_div_up(y, self.state.projection.y, UNIT)
    }

    /// A design coordinate under the dual projection, as `IP` measures. Under
    /// a width the stretched design `x` keeps its fraction: **measured**, the
    /// width sweep goes from 21 wrong cells and 35 wrong pixels to 3 and 4.
    fn project_design(&self, x: f64, y: f64) -> f64 {
        if self.stretch == 1.0 {
            return self.project_dual(x, y);
        }

        (x * self.state.dual.x + y * self.state.dual.y) / UNIT
    }

    fn project_dual(&self, x: f64, y: f64) -> f64 {
        mul_div_up(x, self.state.dual.x, UNIT) + mul_div_up(y, self.state.dual.y, UNIT)
    }

    /// How much of a step along the freedom vector shows along the
    /// projection vector, a dot product under a sixteenth replaced by a whole
    /// one of its sign: the reference's *"Prevent divide by small number"*.
    fn along(&self) -> f64 {
        let State {
            freedom,
            projection,
            ..
        } = self.state;
        let along = mul_div(projection.x, freedom.x, UNIT) + mul_div(projection.y, freedom.y, UNIT);

        if along.abs() < UNIT / 16.0 {
            if along < 0.0 { -UNIT } else { UNIT }
        } else {
            along
        }
    }

    /// Moves a point by a distance along the projection vector, travelling
    /// along the freedom vector.
    fn move_point(&mut self, zone: usize, index: f64, distance: f64) {
        let State {
            freedom,
            projection,
            ..
        } = self.state;
        let along = mul_div(projection.x, freedom.x, UNIT) + mul_div(projection.y, freedom.y, UNIT);

        if along == 0.0 {
            return;
        }

        let along = self.along();
        let zone = &mut self.zones[zone];

        if freedom.x != 0.0 {
            zone.x.add(index, mul_div(distance, freedom.x, along));
            zone.touched_x.set(index, true);
        }

        if freedom.y != 0.0 {
            zone.y.add(index, mul_div(distance, freedom.y, along));
            zone.touched_y.set(index, true);
        }
    }

    /// The same step applied to where a point was *scaled to*, which only a
    /// twilight point being placed wants.
    fn move_original(&mut self, zone: usize, index: f64, distance: f64) {
        let State {
            freedom,
            projection,
            ..
        } = self.state;
        let along = mul_div(projection.x, freedom.x, UNIT) + mul_div(projection.y, freedom.y, UNIT);

        if along == 0.0 {
            return;
        }

        let along = self.along();
        let zone = &mut self.zones[zone];

        if freedom.x != 0.0 {
            zone.original_x
                .add(index, mul_div(distance, freedom.x, along));
        }

        if freedom.y != 0.0 {
            zone.original_y
                .add(index, mul_div(distance, freedom.y, along));
        }
    }

    /// Rounds a distance according to the current round state.
    ///
    /// A period is a mask, not a division -- `SuperRound`'s `x &= ~(period -
    /// 1)` -- which an illegal `SROUND` period of 999 makes visible; and a
    /// forty-five degree period divides in 2.30, floors to whole pixels and
    /// multiplies back, as `Super45Round` does.
    fn round(&self, value: f64) -> f64 {
        let state = &self.state;

        if !state.rounding {
            return value;
        }

        let negative = value < 0.0;
        // The engine compensation for a distance's colour is nought, black
        // and white alike: **measured**, sweeping it against what Windows drew
        // peaks sharply at nothing.
        let mut magnitude = value.abs();

        if magnitude < 0.0 {
            magnitude = 0.0;
        }

        magnitude += state.round_threshold - state.round_phase;

        if state.round_period45 != 0.0 && !state.round_period45.is_nan() {
            let wide = state.round_period45;
            let two30 = f64::from(1u32 << 30);

            magnitude = js::round((magnitude * two30) / wide);
            magnitude = js::and(magnitude, js::not(ONE - 1.0));
            magnitude = js::round((magnitude * wide) / two30);
        } else {
            magnitude = js::and(magnitude, js::not(state.round_period - 1.0));
        }

        magnitude += state.round_phase;

        if magnitude < 0.0 {
            magnitude = state.round_phase;
        }

        if negative { -magnitude } else { magnitude }
    }

    /// Executes a program, from one byte of the font to before another.
    fn run(&mut self, program: Program, from: i64, to: i64) -> Result<(), Fault> {
        let mut at = from;
        let mut steps = 0;

        while at < to {
            steps += 1;

            if steps > STEP_LIMIT {
                return Err(Fault);
            }

            let opcode = program.u8_at(at)?;

            at = self.execute(opcode, program, at + 1, to)?;
        }

        Ok(())
    }

    /// Runs one instruction and says where the next one starts.
    fn execute(&mut self, opcode: u8, program: Program, at: i64, to: i64) -> Result<i64, Fault> {
        let mut at = at;

        match opcode {
            0x40 => {
                let count = program.u8_at(at)?;

                at += 1;

                for _ in 0..count {
                    let value = program.u8_at(at)?;

                    self.push(f64::from(value));
                    at += 1;
                }

                Ok(at)
            }
            0x41 => {
                let count = program.u8_at(at)?;

                at += 1;

                for _ in 0..count {
                    let value = program.i16_at(at)?;

                    self.push(f64::from(value));
                    at += 2;
                }

                Ok(at)
            }
            0xb0..=0xb7 => {
                for _ in 0..=(opcode - 0xb0) {
                    let value = program.u8_at(at)?;

                    self.push(f64::from(value));
                    at += 1;
                }

                Ok(at)
            }
            0xb8..=0xbf => {
                for _ in 0..=(opcode - 0xb8) {
                    let value = program.i16_at(at)?;

                    self.push(f64::from(value));
                    at += 2;
                }

                Ok(at)
            }
            _ => self.perform(opcode, program, at, to),
        }
    }

    /// Everything that is not a push.
    #[allow(clippy::too_many_lines, clippy::match_same_arms)]
    fn perform(&mut self, opcode: u8, program: Program, at: i64, to: i64) -> Result<i64, Fault> {
        match opcode {
            /* -- the vectors -- */
            0x00 | 0x01 => {
                let vector = if opcode == 0x01 { X_AXIS } else { Y_AXIS };

                self.state.projection = vector;
                self.state.dual = vector;
                self.state.freedom = vector;
            }
            0x02 | 0x03 => {
                let vector = if opcode == 0x03 { X_AXIS } else { Y_AXIS };

                self.state.projection = vector;
                self.state.dual = vector;
            }
            0x04 | 0x05 => {
                self.state.freedom = if opcode == 0x05 { X_AXIS } else { Y_AXIS };
            }
            0x0e => self.state.freedom = self.state.projection,

            /* -- reference points and zones -- */
            0x10 => self.state.rp0 = self.pop()?,
            0x11 => self.state.rp1 = self.pop()?,
            0x12 => self.state.rp2 = self.pop()?,
            0x13 => self.state.zp0 = self.pop()?,
            0x14 => self.state.zp1 = self.pop()?,
            0x15 => self.state.zp2 = self.pop()?,
            0x16 => {
                let which = self.pop()?;

                self.state.zp0 = which;
                self.state.zp1 = which;
                self.state.zp2 = which;
            }

            /* -- the round state -- */
            0x18 => self.round_state(ONE, 0.0, ONE / 2.0),
            0x19 => self.round_state(ONE, ONE / 2.0, ONE / 2.0),
            0x3d => self.round_state(ONE / 2.0, 0.0, ONE / 4.0),
            0x7d => self.round_state(ONE, 0.0, 0.0),
            0x7c => self.round_state(ONE, 0.0, ONE - 1.0),
            0x7a => self.state.rounding = false,

            /* -- the stack -- */
            0x20 => {
                let value = self.pop()?;

                self.push(value);
                self.push(value);
            }
            0x21 => {
                self.pop()?;
            }
            0x22 => self.stack.clear(),
            0x23 => {
                let a = self.pop()?;
                let b = self.pop()?;

                self.push(a);
                self.push(b);
            }
            0x24 => self.push(self.stack.len() as f64),
            0x26 => {
                // MINDEX, as `splice` takes an element out: a start counted
                // back from the end where it is negative, nothing at all where
                // it is past the end.
                let index = self.pop()?;
                let length = self.stack.len() as f64;
                let mut start = length - index;

                if start < 0.0 {
                    start = (length + start).max(0.0);
                }

                let value = if start < length {
                    f64::from(self.stack.remove(start as usize))
                } else {
                    0.0
                };

                self.push(value);
            }
            0x25 => {
                let index = self.pop()?;
                let at = self.stack.len() as f64 - index;
                let value = index_of(at)
                    .filter(|&at| at >= 0)
                    .and_then(|at| self.stack.get(at as usize))
                    .map_or(0.0, |&value| f64::from(value));

                self.push(value);
            }

            /* -- storage and control values -- */
            0x43 => {
                let index = self.pop()?;
                let value = index_of(index)
                    .and_then(|index| self.storage.at(index))
                    .unwrap_or(0.0);

                self.push(value);
            }
            0x42 => {
                let value = self.pop()?;
                let index = self.pop()?;

                self.storage.set(index, value);
            }
            0x45 => {
                let index = self.pop()?;

                self.push(self.cvt_at(index));
            }
            0x44 => {
                // WCVTP, in pixels.
                let value = self.pop()?;
                let index = self.pop()?;
                let stored = if self.stretch == 1.0 || value == 0.0 {
                    value
                } else {
                    fix_div(value, self.cvt_scale())
                };

                self.cvt.set(index, stored);
            }
            0x70 => {
                // WCVTF, in font units, scaled at the size the table was --
                // **measured**: Arial's `È` at twelve pixels on an EGA.
                let value = self.pop()?;
                let index = self.pop()?;

                self.cvt.set(
                    index,
                    scale_to_pixels(value, self.cvt_pixels, self.units_per_em),
                );
            }

            /* -- arithmetic -- */
            0x60 | 0x61 | 0x62 | 0x63 | 0x8b | 0x8c => {
                let b = self.pop()?;
                let a = self.pop()?;

                self.push(match opcode {
                    0x60 => a + b,
                    0x61 => a - b,
                    0x62 => divide(a, b),
                    0x63 => mul_div(a, b, ONE),
                    0x8b => js::max(a, b),
                    _ => js::min(a, b),
                });
            }
            0x64 => {
                let value = self.pop()?;

                self.push(value.abs());
            }
            0x65 => {
                let value = self.pop()?;

                self.push(-value);
            }
            0x66 => {
                let value = self.pop()?;

                self.push((value / ONE).floor() * ONE);
            }
            0x67 => {
                let value = self.pop()?;

                self.push((value / ONE).ceil() * ONE);
            }

            /* -- comparison and logic -- */
            0x50..=0x55 => {
                let b = self.pop()?;
                let a = self.pop()?;
                #[allow(clippy::float_cmp)]
                let answer = match opcode {
                    0x50 => a < b,
                    0x51 => a <= b,
                    0x52 => a > b,
                    0x53 => a >= b,
                    0x54 => a == b,
                    _ => a != b,
                };

                self.push(f64::from(u8::from(answer)));
            }
            0x56 | 0x57 => {
                let value = self.pop()?;
                let parity = (self.round(value) / ONE).abs() % 2.0;
                let wanted = if opcode == 0x56 { 1.0 } else { 0.0 };

                #[allow(clippy::float_cmp)]
                self.push(f64::from(u8::from(parity == wanted)));
            }
            0x5a | 0x5b => {
                let b = self.pop()?;
                let a = self.pop()?;
                let answer = if opcode == 0x5a {
                    a != 0.0 && b != 0.0
                } else {
                    a != 0.0 || b != 0.0
                };

                self.push(f64::from(u8::from(answer)));
            }
            0x5c => {
                let value = self.pop()?;

                self.push(f64::from(u8::from(value == 0.0)));
            }

            /* -- rounding -- */
            0x68..=0x6b => {
                let value = self.pop()?;

                self.push(self.round(value));
            }
            // NROUND, which is the same without the rounding.
            0x6c..=0x6f => {}

            /* -- the size -- */
            0x4b => self.push(self.size_along()),
            // MPS, the point size, which Windows never learns: GDI drives the
            // scaler by pixels and leaves it at nought. **Recorded** by
            // `mps-raw` and `mps-scaled`.
            0x4c => self.push(0.0),

            /* -- state values -- */
            0x17 => self.state.loop_count = self.pop()?,
            0x1a => self.state.minimum_distance = self.pop()?,
            0x1d => self.state.control_cut_in = self.pop()?,
            0x1e => self.state.single_width_cut_in = self.pop()?,
            0x1f => self.state.single_width = self.pop()?,
            0x4d => self.state.auto_flip = true,
            0x4e => self.state.auto_flip = false,
            0x5e => self.state.delta_base = self.pop()?,
            0x5f => self.state.delta_shift = self.pop()?,

            // INSTCTRL: the font's own switch for turning hinting off at a
            // size, a masked assignment. Courier New says no below nine pixels
            // per em; see `grid_fit`.
            0x8e => {
                let selector = self.pop()?;
                let value = self.pop()?;

                self.state.instruction_control = js::or(
                    js::and(self.state.instruction_control, js::not(selector)),
                    js::and(value, selector),
                );
            }

            // SCANCTRL and SCANTYPE, which only the scan converter reads.
            0x85 => self.scan_control = Some(self.pop()?),
            0x8d => self.scan_type = Some(self.pop()?),

            0x76 | 0x77 => self.super_round(opcode)?,

            // IDEF, which redefines an instruction. Nothing here does that.
            0x89 => return Err(Fault),

            0x88 => {
                // GETINFO: three for the version -- **measured** by
                // `getinfo-version` -- and whether the glyph is rotated.
                let selector = self.pop()?;
                let mut answer = 0;

                if js::int32(selector) & 0x01 != 0 {
                    answer |= 3;
                }

                if js::int32(selector) & 0x02 != 0 && self.rotated {
                    answer |= 0x100;
                }

                self.push(f64::from(answer));
            }
            0x8a => {
                // ROLL, which rotates the top three.
                let a = self.pop()?;
                let b = self.pop()?;
                let c = self.pop()?;

                self.push(b);
                self.push(a);
                self.push(c);
            }
            0x0c => {
                self.push(self.state.projection.x);
                self.push(self.state.projection.y);
            }
            0x0d => {
                self.push(self.state.freedom.x);
                self.push(self.state.freedom.y);
            }
            0x0a => {
                let y = self.pop()?;
                let x = self.pop()?;

                self.state.projection = Vector { x, y };
                self.state.dual = Vector { x, y };
            }
            0x0b => {
                let y = self.pop()?;
                let x = self.pop()?;

                self.state.freedom = Vector { x, y };
            }
            0x06 | 0x07 | 0x08 | 0x09 | 0x86 | 0x87 => self.vector_from_line(opcode)?,
            0x0f => self.intersect()?,
            0x29 => {
                // UTP, which unsticks a point so interpolation carries it again.
                let index = self.pop()?;
                let zone = Self::zone_of(self.state.zp0);

                if self.state.freedom.x != 0.0 {
                    self.zones[zone].touched_x.set(index, false);
                }

                if self.state.freedom.y != 0.0 {
                    self.zones[zone].touched_y.set(index, false);
                }
            }
            0x80 => {
                // FLIPPT, which turns points on and off the curve.
                let mut count = self.state.loop_count;

                while count > 0.0 {
                    count -= 1.0;

                    let index = self.pop()?;
                    let zone = &mut self.zones[1];
                    let flipped = !zone.on_curve.get(index);

                    zone.on_curve.set(index, flipped);
                }

                self.state.loop_count = 1.0;
            }
            0x81 | 0x82 => {
                let high = self.pop()?;
                let low = self.pop()?;

                // A range no outline has room for is a program gone wrong; the
                // TypeScript engine would grind through it.
                if high - low > 1_000_000.0 {
                    return Err(Fault);
                }

                let mut index = low;

                while index <= high {
                    self.zones[1].on_curve.set(index, opcode == 0x81);
                    index += 1.0;
                }
            }
            0x2c => {
                // FDEF: its body runs to the matching ENDF.
                let index = self.pop()?;
                let start = at;
                let mut cursor = at;

                while cursor < to {
                    let inner = program.u8_at(cursor)?;

                    cursor += 1;

                    if inner == 0x2d {
                        break;
                    }

                    cursor = Self::skip(inner, program, cursor)?;
                }

                if let Some(index) = index_of(index) {
                    self.functions.insert(
                        index,
                        Function {
                            at: start,
                            end: cursor - 1,
                        },
                    );
                }

                return Ok(cursor);
            }
            // ENDF, which `run` only reaches at the end of a called function.
            0x2d => return Ok(to),
            0x2b => {
                let index = self.pop()?;

                self.call_function(program, index)?;
            }
            0x2a => {
                let index = self.pop()?;
                let mut count = self.pop()?;

                while count > 0.0 {
                    count -= 1.0;
                    self.call_function(program, index)?;
                }
            }

            /* -- conditionals -- */
            0x58 => {
                if self.pop()? != 0.0 {
                    return Ok(at);
                }

                return Self::skip_to_else(program, at, to);
            }
            0x1b => return Self::skip_to_end(program, at, to),
            0x59 => {}

            /* -- jumps -- */
            0x1c => {
                let offset = self.pop()?;

                return Ok(at - 1 + offset as i64);
            }
            0x78 | 0x79 => {
                let condition = self.pop()? != 0.0;
                let offset = self.pop()?;
                let taken = if opcode == 0x78 {
                    condition
                } else {
                    !condition
                };

                return Ok(if taken { at - 1 + offset as i64 } else { at });
            }

            _ => self.perform_geometry(opcode)?,
        }

        Ok(at)
    }

    fn round_state(&mut self, period: f64, phase: f64, threshold: f64) {
        self.state.rounding = true;
        self.state.round_period = period;
        self.state.round_period45 = 0.0;
        self.state.round_phase = phase;
        self.state.round_threshold = threshold;
    }

    /// SROUND and S45ROUND: the round state spelled out in one byte. The
    /// fourth period selector is **illegal** and the reference gives it 999;
    /// a forty-five degree period is kept in 2.30 and converted to
    /// sixty-fourths once, so it comes out 23, 45 or 91.
    fn super_round(&mut self, opcode: u8) -> Result<(), Fault> {
        let packed = js::int32(self.pop()?);
        let selector = packed & 0x0f;
        let choice = ((packed >> 6) & 0x03) as usize;
        let mut wide45 = 0.0;

        let period = if opcode == 0x76 {
            [ONE / 2.0, ONE, ONE * 2.0, 999.0][choice]
        } else {
            // The square root of a half in 2.30, halved or doubled, then rounded.
            let root = js::round(std::f64::consts::FRAC_1_SQRT_2 * f64::from(1u32 << 30));

            wide45 = [(root / 2.0).floor(), root, root * 2.0, 999.0][choice];
            ((wide45 + f64::from(1u32 << 23)) / f64::from(1u32 << 24)).floor()
        };

        let phase = [
            0.0,
            js::sar(period + 2.0, 2.0),
            js::sar(period + 1.0, 1.0),
            js::sar(period + period + period + 2.0, 2.0),
        ][((packed >> 4) & 0x03) as usize];

        let threshold = if selector == 0 {
            period - 1.0
        } else {
            js::sar(f64::from(selector - 4) * period + 4.0, 3.0)
        };

        self.state.rounding = true;
        self.state.round_period = period;
        self.state.round_period45 = if opcode == 0x77 { wide45 } else { 0.0 };
        self.state.round_phase = phase;
        self.state.round_threshold = threshold;

        Ok(())
    }

    /// Set a vector from the line between two points -- along it for the
    /// even opcodes, at right angles for the odd ones. `SDPVTL` takes its
    /// dual from where the two points *started*.
    fn vector_from_line(&mut self, opcode: u8) -> Result<(), Fault> {
        let second = self.pop()?;
        let first = self.pop()?;
        let one = &self.zones[Self::zone_of(self.state.zp1)];
        let two = &self.zones[Self::zone_of(self.state.zp2)];
        let perpendicular = opcode & 0x01 != 0;
        let vector = Self::unit_vector(
            one.x.get(first) - two.x.get(second),
            one.y.get(first) - two.y.get(second),
            perpendicular,
        );

        if opcode == 0x08 || opcode == 0x09 {
            self.state.freedom = vector;

            return Ok(());
        }

        let dual = if opcode == 0x06 || opcode == 0x07 {
            vector
        } else {
            Self::unit_vector(
                one.original_x.get(first) - two.original_x.get(second),
                one.original_y.get(first) - two.original_y.get(second),
                perpendicular,
            )
        };

        self.state.projection = vector;
        self.state.dual = dual;

        Ok(())
    }

    /// ISECT: put a point where two lines cross, arranged as the reference
    /// arranges it, since a chain of rounded `MulDiv26Dot6`s does not land
    /// where one exact intersection rounded would. **Recorded**: Arial's `X`
    /// at twenty-one pixels asked for sixteen has its left crossing read out
    /// at 681 along `x`. Parallel means exactly parallel.
    fn intersect(&mut self) -> Result<(), Fault> {
        let second_b = self.pop()?;
        let first_b = self.pop()?;
        let second_a = self.pop()?;
        let first_a = self.pop()?;
        let index = self.pop()?;

        let zone_a = &self.zones[Self::zone_of(self.state.zp1)];
        let zone_b = &self.zones[Self::zone_of(self.state.zp0)];

        let ax = zone_b.x.get(first_b);
        let ay = zone_b.y.get(first_b);
        let dax = zone_b.x.get(second_b) - ax;
        let day = zone_b.y.get(second_b) - ay;
        let bx = zone_a.x.get(first_a);
        let by = zone_a.y.get(first_a);
        let dbx = zone_a.x.get(second_a) - bx;
        let dby = zone_a.y.get(second_a) - by;

        let zone = &mut self.zones[Self::zone_of(self.state.zp2)];

        zone.touched_x.set(index, true);
        zone.touched_y.set(index, true);

        let (n, d) = if day == 0.0 {
            if dbx == 0.0 {
                zone.x.set(index, bx);
                zone.y.set(index, ay);

                return Ok(());
            }

            (by - ay, -dby)
        } else if dax == 0.0 {
            if dby == 0.0 {
                zone.x.set(index, ax);
                zone.y.set(index, by);

                return Ok(());
            }

            (bx - ax, -dbx)
        } else if dax.abs() >= day.abs() {
            (
                by - ay - mul_div(bx - ax, day, dax),
                mul_div(dbx, day, dax) - dby,
            )
        } else {
            (
                mul_div(by - ay, dax, day) - (bx - ax),
                dbx - mul_div(dby, dax, day),
            )
        };

        if d == 0.0 {
            // Parallel: the middle of the two midpoints, in the reference's
            // shifts.
            zone.x.set(
                index,
                js::sar(bx + js::sar(dbx, 1.0) + ax + js::sar(dax, 1.0), 1.0),
            );
            zone.y.set(
                index,
                js::sar(by + js::sar(dby, 1.0) + ay + js::sar(day, 1.0), 1.0),
            );
        } else {
            zone.x.set(index, bx + mul_div(dbx, n, d));
            zone.y.set(index, by + mul_div(dby, n, d));
        }

        Ok(())
    }

    /// The instructions that move points.
    #[allow(clippy::too_many_lines)]
    fn perform_geometry(&mut self, opcode: u8) -> Result<(), Fault> {
        match opcode {
            // MDAP, with and without rounding.
            0x2e | 0x2f => {
                let index = self.pop()?;
                let zone = Self::zone_of(self.state.zp0);
                let current =
                    self.project(self.zones[zone].x.get(index), self.zones[zone].y.get(index));
                let distance = if opcode == 0x2f {
                    self.round(current) - current
                } else {
                    0.0
                };

                self.move_point(zone, index, distance);
                self.state.rp0 = index;
                self.state.rp1 = index;
            }

            // IUP, which carries the untouched points along with the touched.
            0x30 | 0x31 => self.interpolate_untouched(opcode == 0x31),

            // MIAP, with and without rounding.
            0x3e | 0x3f => {
                let value = self.pop()?;
                let index = self.pop()?;
                let zone = Self::zone_of(self.state.zp0);
                let mut distance = self.cvt_at(value);

                // A twilight point is put there, in both its position and its
                // remembered start, and its scaled position stands in for its
                // design coordinates.
                if self.state.zp0 == 0.0 {
                    let x = js::round((distance * self.state.projection.x) / UNIT);
                    let y = js::round((distance * self.state.projection.y) / UNIT);
                    let points = &mut self.zones[zone];

                    points.x.set(index, x);
                    points.y.set(index, y);
                    points.original_x.set(index, x);
                    points.original_y.set(index, y);
                    points.unscaled_x.set(index, x);
                    points.unscaled_y.set(index, y);
                }

                let current =
                    self.project(self.zones[zone].x.get(index), self.zones[zone].y.get(index));

                if opcode == 0x3f {
                    if (distance - current).abs() > self.state.control_cut_in {
                        distance = current;
                    }

                    distance = self.round(distance);
                }

                self.move_point(zone, index, distance - current);
                self.state.rp0 = index;
                self.state.rp1 = index;
            }

            // GC: how far along the projection vector a point sits.
            0x46 | 0x47 => {
                let index = self.pop()?;
                let zone = &self.zones[Self::zone_of(self.state.zp2)];
                let value = if opcode == 0x46 {
                    self.project(zone.x.get(index), zone.y.get(index))
                } else {
                    self.project_dual(zone.original_x.get(index), zone.original_y.get(index))
                };

                self.push(value);
            }

            // SCFS: put a point at a given coordinate along the projection.
            0x48 => {
                let value = self.pop()?;
                let index = self.pop()?;
                let zone = Self::zone_of(self.state.zp2);
                let current =
                    self.project(self.zones[zone].x.get(index), self.zones[zone].y.get(index));

                self.move_point(zone, index, value - current);
            }

            // MD: the distance between two points, as they are or as they were.
            0x49 | 0x4a => {
                let second = self.pop()?;
                let first = self.pop()?;
                let one = &self.zones[Self::zone_of(self.state.zp1)];
                let two = &self.zones[Self::zone_of(self.state.zp0)];
                let value = if opcode == 0x49 {
                    self.project(
                        two.x.get(first) - one.x.get(second),
                        two.y.get(first) - one.y.get(second),
                    )
                } else {
                    self.project_dual(
                        two.original_x.get(first) - one.original_x.get(second),
                        two.original_y.get(first) - one.original_y.get(second),
                    )
                };

                self.push(value);
            }

            // ALIGNRP: points onto the reference point's own coordinate, the
            // point measured from the reference and negated, as the reference
            // orders it.
            0x3c => {
                let mut count = self.state.loop_count;
                let zero = Self::zone_of(self.state.zp0);
                let one = Self::zone_of(self.state.zp1);

                while count > 0.0 {
                    count -= 1.0;

                    let index = self.pop()?;
                    let rp0 = self.state.rp0;
                    let distance = -self.project(
                        self.zones[one].x.get(index) - self.zones[zero].x.get(rp0),
                        self.zones[one].y.get(index) - self.zones[zero].y.get(rp0),
                    );

                    self.move_point(one, index, distance);
                }

                self.state.loop_count = 1.0;
            }

            // ALIGNPTS: two points to the same place, meeting in the middle,
            // the gap halved by a shift.
            0x27 => {
                let second = self.pop()?;
                let first = self.pop()?;
                let one = Self::zone_of(self.state.zp1);
                let zero = Self::zone_of(self.state.zp0);
                let distance = self.project(
                    self.zones[one].x.get(second) - self.zones[zero].x.get(first),
                    self.zones[one].y.get(second) - self.zones[zero].y.get(first),
                );
                let half = js::sar(distance, 1.0);

                self.move_point(zero, first, half);
                self.move_point(one, second, half - distance);
            }

            // SHPIX: shift points by an outright number of pixels.
            0x38 => {
                let amount = self.pop()?;
                let mut count = self.state.loop_count;

                while count > 0.0 {
                    count -= 1.0;

                    let index = self.pop()?;
                    let freedom = self.state.freedom;
                    let zone = &mut self.zones[Self::zone_of(self.state.zp2)];

                    if freedom.x != 0.0 {
                        zone.x.add(index, js::round((amount * freedom.x) / UNIT));
                        zone.touched_x.set(index, true);
                    }

                    if freedom.y != 0.0 {
                        zone.y.add(index, js::round((amount * freedom.y) / UNIT));
                        zone.touched_y.set(index, true);
                    }
                }

                self.state.loop_count = 1.0;
            }

            // SHP: shift points by however far a reference point has moved,
            // touching them whether or not it did.
            0x32 | 0x33 => {
                let shift = self.reference_shift(opcode == 0x33);
                let mut count = self.state.loop_count;

                while count > 0.0 {
                    count -= 1.0;

                    let index = self.pop()?;
                    let freedom = self.state.freedom;
                    let zone = &mut self.zones[Self::zone_of(self.state.zp2)];

                    if freedom.x != 0.0 {
                        zone.x.add(index, shift.dx);
                        zone.touched_x.set(index, true);
                    }

                    if freedom.y != 0.0 {
                        zone.y.add(index, shift.dy);
                        zone.touched_y.set(index, true);
                    }
                }

                self.state.loop_count = 1.0;
            }

            // SHC: the same, to every point of a contour but the reference.
            0x34 | 0x35 => {
                let contour = self.pop()?;
                let shift = self.reference_shift(opcode == 0x35);
                let which = Self::zone_of(self.state.zp2);
                let freedom = self.state.freedom;
                let zone = &mut self.zones[which];
                let from = if contour == 0.0 {
                    0.0
                } else {
                    zone.end(contour - 1.0).map_or(f64::NAN, |end| end + 1.0)
                };
                let to = zone
                    .end(contour)
                    .unwrap_or_else(|| zone.length() as f64 - 1.0);

                let mut index = from;

                #[allow(clippy::float_cmp)]
                while index <= to {
                    if !(index == shift.index && which == shift.zone) {
                        if freedom.x != 0.0 {
                            zone.x.add(index, shift.dx);
                            zone.touched_x.set(index, true);
                        }

                        if freedom.y != 0.0 {
                            zone.y.add(index, shift.dy);
                            zone.touched_y.set(index, true);
                        }
                    }

                    index += 1.0;
                }
            }

            // SHZ: the same again, to a whole zone's outline and nothing after
            // it, touching nothing, the reference point put back.
            0x36 | 0x37 => {
                self.pop()?;

                let shift = self.reference_shift(opcode == 0x37);
                let which = Self::zone_of(self.state.zp2);
                let freedom = self.state.freedom;
                let zone = &mut self.zones[which];
                let held = (zone.x.get(shift.index), zone.y.get(shift.index));
                let to = zone
                    .ends
                    .last()
                    .copied()
                    .unwrap_or_else(|| zone.length() as f64 - 1.0);
                let mut index = 0.0;

                while index <= to {
                    if freedom.x != 0.0 {
                        zone.x.add(index, shift.dx);
                    }

                    if freedom.y != 0.0 {
                        zone.y.add(index, shift.dy);
                    }

                    index += 1.0;
                }

                if which == shift.zone {
                    zone.x.set(shift.index, held.0);
                    zone.y.set(shift.index, held.1);
                }
            }

            // IP: place points proportionally between two references, the
            // proportion in design units.
            0x39 => self.interpolate_points()?,

            // MSIRP: move a point to a given distance from the reference
            // point; a twilight point starts where the reference is.
            // **Recorded** by `ariali-m-store10` and `ariali-m-store11`.
            0x3a | 0x3b => {
                let distance = self.pop()?;
                let index = self.pop()?;
                let one = Self::zone_of(self.state.zp1);
                let zero = Self::zone_of(self.state.zp0);
                let rp0 = self.state.rp0;

                if self.state.zp1 == 0.0 {
                    let (x, y) = (
                        self.zones[zero].original_x.get(rp0),
                        self.zones[zero].original_y.get(rp0),
                    );

                    self.zones[one].original_x.set(index, x);
                    self.zones[one].original_y.set(index, y);
                    self.move_original(one, index, distance);

                    let points = &mut self.zones[one];
                    let (x, y) = (points.original_x.get(index), points.original_y.get(index));

                    points.x.set(index, x);
                    points.y.set(index, y);
                    points.unscaled_x.set(index, x);
                    points.unscaled_y.set(index, y);
                }

                let current = self.project(
                    self.zones[one].x.get(index) - self.zones[zero].x.get(rp0),
                    self.zones[one].y.get(index) - self.zones[zero].y.get(rp0),
                );

                self.move_point(one, index, distance - current);
                self.state.rp1 = self.state.rp0;
                self.state.rp2 = index;

                if opcode == 0x3b {
                    self.state.rp0 = index;
                }
            }

            // The delta instructions: at one size, a point or a control value
            // nudged by a fraction of a pixel.
            0x5d | 0x71 | 0x72 => {
                let band = match opcode {
                    0x5d => 0.0,
                    0x71 => 16.0,
                    _ => 32.0,
                };
                let pairs = self.pop_pairs()?;

                for (amount, index) in self.each_delta(&pairs, band) {
                    let zone = Self::zone_of(self.state.zp0);

                    self.move_point(zone, index, amount);
                }
            }
            0x73..=0x75 => {
                let band = match opcode {
                    0x73 => 0.0,
                    0x74 => 16.0,
                    _ => 32.0,
                };
                let pairs = self.pop_pairs()?;

                for (amount, index) in self.each_delta(&pairs, band) {
                    let before = index_of(index)
                        .and_then(|index| self.cvt.at(index))
                        .unwrap_or(0.0);
                    let added = if self.stretch == 1.0 {
                        amount
                    } else {
                        fix_div(amount, self.cvt_scale())
                    };

                    self.cvt.set(index, before + added);
                }
            }

            0xc0..=0xdf => self.move_direct_relative(opcode)?,
            0xe0..=0xff => self.move_indirect_relative(opcode)?,

            _ => return Err(Fault),
        }

        Ok(())
    }

    /// IP's arithmetic, arranged as the reference arranges it: the two
    /// references' current span, each point's design offset from the first
    /// scaled into it, and the move that less the point's current offset. A
    /// point outside the two is carried on the same line.
    fn interpolate_points(&mut self) -> Result<(), Fault> {
        let mut count = self.state.loop_count;
        let zero = Self::zone_of(self.state.zp0);
        let one = Self::zone_of(self.state.zp1);
        let (rp1, rp2) = (self.state.rp1, self.state.rp2);
        let stretch = self.stretch;

        let design = |hinter: &Self, zone: usize, index: f64| {
            let points = &hinter.zones[zone];

            hinter.project_design(
                points.unscaled_x.get(index) * stretch,
                points.unscaled_y.get(index),
            )
        };

        let original_one = design(self, zero, rp1);
        let original_two = design(self, one, rp2);
        let old_range = original_two - original_one;
        let span = self.project(
            self.zones[one].x.get(rp2) - self.zones[zero].x.get(rp1),
            self.zones[one].y.get(rp2) - self.zones[zero].y.get(rp1),
        );

        while count > 0.0 {
            count -= 1.0;

            let index = self.pop()?;
            let zone = Self::zone_of(self.state.zp2);
            let points = &self.zones[zone];
            let reference = &self.zones[zero];
            let offset = self.project_design(
                (points.unscaled_x.get(index) - reference.unscaled_x.get(rp1)) * stretch,
                points.unscaled_y.get(index) - reference.unscaled_y.get(rp1),
            );
            let wanted = if old_range == 0.0 {
                self.to_pixels(offset)
            } else {
                mul_div(span, offset, old_range)
            };
            let current = self.project(
                points.x.get(index) - reference.x.get(rp1),
                points.y.get(index) - reference.y.get(rp1),
            );

            self.move_point(zone, index, wanted - current);
        }

        self.state.loop_count = 1.0;

        Ok(())
    }

    /// MDRP: move a point a rounded distance from the reference point,
    /// measured in design units and scaled once -- under a width each
    /// component carried to pixels on its own -- where the two zones are the
    /// glyph's and it is not a composite, and on the scaled originals
    /// otherwise. **Read out of a running Windows**, Arial's `w` at a cell of
    /// eighty-eight on an EGA.
    ///
    /// The minimum distance takes its sign from the outline rather than from
    /// the rounded distance, and is a clamp: **measured** against `hdmx`,
    /// Times New Roman's guillemet at eleven pixels per em.
    fn move_direct_relative(&mut self, opcode: u8) -> Result<(), Fault> {
        let index = self.pop()?;
        let one = Self::zone_of(self.state.zp1);
        let zero = Self::zone_of(self.state.zp0);
        let rp0 = self.state.rp0;
        let points = &self.zones[one];
        let reference = &self.zones[zero];

        let design =
            (self.state.zp0 != 0.0 && self.state.zp1 != 0.0 && !self.composite).then(|| {
                if self.stretch == 1.0 {
                    scale_to_pixels(
                        self.project_dual(
                            points.unscaled_x.get(index) - reference.unscaled_x.get(rp0),
                            points.unscaled_y.get(index) - reference.unscaled_y.get(rp0),
                        ),
                        self.pixels,
                        self.units_per_em,
                    )
                } else {
                    self.project_dual(
                        self.to_pixels_x(
                            points.unscaled_x.get(index) - reference.unscaled_x.get(rp0),
                        ),
                        self.to_pixels(
                            points.unscaled_y.get(index) - reference.unscaled_y.get(rp0),
                        ),
                    )
                }
            });

        let original = design.unwrap_or_else(|| {
            self.project_dual(
                points.original_x.get(index) - reference.original_x.get(rp0),
                points.original_y.get(index) - reference.original_y.get(rp0),
            )
        });

        let mut distance = if opcode & 0x04 != 0 {
            self.round(original)
        } else {
            original
        };

        if opcode & 0x08 != 0 {
            distance = if original >= 0.0 {
                js::max(distance, self.state.minimum_distance)
            } else {
                js::min(distance, -self.state.minimum_distance)
            };
        }

        let current = self.project(
            points.x.get(index) - reference.x.get(rp0),
            points.y.get(index) - reference.y.get(rp0),
        );

        self.move_point(one, index, distance - current);
        self.state.rp1 = self.state.rp0;
        self.state.rp2 = index;

        if opcode & 0x10 != 0 {
            self.state.rp0 = index;
        }

        Ok(())
    }

    /// MIRP: the same, the distance from the control value table. A twilight
    /// point is placed at the control value from the reference first; the
    /// sign comes from the outline (auto flip); and the cut-in applies only
    /// within one zone and only where the distance is being rounded, the
    /// comparison strict. **Measured** on `stemsize`, 238 of 238 on each of
    /// two displays.
    fn move_indirect_relative(&mut self, opcode: u8) -> Result<(), Fault> {
        let value = self.pop()?;
        let index = self.pop()?;
        let one = Self::zone_of(self.state.zp1);
        let zero = Self::zone_of(self.state.zp0);
        let rp0 = self.state.rp0;
        let mut distance = self.cvt_at(value);

        if self.state.zp1 == 0.0 {
            let x = self.zones[zero].original_x.get(rp0)
                + js::round((distance * self.state.projection.x) / UNIT);
            let y = self.zones[zero].original_y.get(rp0)
                + js::round((distance * self.state.projection.y) / UNIT);
            let points = &mut self.zones[one];

            points.original_x.set(index, x);
            points.original_y.set(index, y);
            points.x.set(index, x);
            points.y.set(index, y);
            points.unscaled_x.set(index, x);
            points.unscaled_y.set(index, y);
        }

        let points = &self.zones[one];
        let reference = &self.zones[zero];
        let original = self.project_dual(
            points.original_x.get(index) - reference.original_x.get(rp0),
            points.original_y.get(index) - reference.original_y.get(rp0),
        );

        if self.state.auto_flip
            && distance != 0.0
            && original != 0.0
            && (distance < 0.0) != (original < 0.0)
        {
            distance = -distance;
        }

        #[allow(clippy::float_cmp)]
        let fired = opcode & 0x04 != 0
            && self.state.zp0 == self.state.zp1
            && (distance - original).abs() > self.state.control_cut_in;

        if fired {
            distance = original;
        }

        if opcode & 0x04 != 0 {
            distance = self.round(distance);
        }

        if opcode & 0x08 != 0 {
            distance = if original >= 0.0 {
                js::max(distance, self.state.minimum_distance)
            } else {
                js::min(distance, -self.state.minimum_distance)
            };
        }

        let current = self.project(
            points.x.get(index) - reference.x.get(rp0),
            points.y.get(index) - reference.y.get(rp0),
        );

        self.move_point(one, index, distance - current);
        self.state.rp1 = self.state.rp0;
        self.state.rp2 = index;

        if opcode & 0x10 != 0 {
            self.state.rp0 = index;
        }

        Ok(())
    }

    /// A unit vector along -- or across -- a line, in `F2Dot14`: normalised
    /// first and turned afterwards, the order the scaler does it in.
    fn unit_vector(dx: f64, dy: f64, perpendicular: bool) -> Vector {
        let length = (dx * dx + dy * dy).sqrt();

        if length == 0.0 || length.is_nan() {
            return X_AXIS;
        }

        let x = js::round((dx / length) * UNIT);
        let y = js::round((dy / length) * UNIT);

        if perpendicular {
            Vector { x: -y, y: x }
        } else {
            Vector { x, y }
        }
    }

    /// How far the reference point of a shift has already moved along the
    /// projection vector, laid back out along the freedom vector.
    fn reference_shift(&self, use_rp1: bool) -> Shift {
        let zone = if use_rp1 {
            Self::zone_of(self.state.zp0)
        } else {
            Self::zone_of(self.state.zp1)
        };
        let index = if use_rp1 {
            self.state.rp1
        } else {
            self.state.rp2
        };
        let points = &self.zones[zone];
        let carried = self.project(
            points.x.get(index) - points.original_x.get(index),
            points.y.get(index) - points.original_y.get(index),
        );
        let freedom = self.state.freedom;
        let along = self.along();

        Shift {
            dx: if freedom.x == 0.0 {
                0.0
            } else {
                mul_div(carried, freedom.x, along)
            },
            dy: if freedom.y == 0.0 {
                0.0
            } else {
                mul_div(carried, freedom.y, along)
            },
            zone,
            index,
        }
    }

    /// A delta instruction's exceptions off the stack, deepest first: each
    /// the packed argument and the point or control value it applies to.
    fn pop_pairs(&mut self) -> Result<Vec<(f64, f64)>, Fault> {
        let mut pairs = Vec::new();
        let mut count = self.pop()?;

        while count > 0.0 {
            let index = self.pop()?;
            let argument = self.pop()?;

            pairs.insert(0, (argument, index));
            count -= 1.0;
        }

        Ok(pairs)
    }

    /// The exceptions in a delta list that are meant for this size, as each
    /// nudge and what it applies to.
    ///
    /// Not a scan of the list: Windows looks the size up, halving its way
    /// down the list as if it were sorted, and then reads forward only until
    /// it meets a size past the one it wants. **Recorded**: the same sixteen
    /// exceptions applied in `delta-ascending` and skipped entirely in
    /// `delta-descending`. The size is the one along the projection vector.
    fn each_delta(&self, pairs: &[(f64, f64)], band: f64) -> Vec<(f64, f64)> {
        let state = &self.state;
        let size = self.size_along() - (state.delta_base + band);
        let mut moves = Vec::new();

        // Not a range's `contains`: a size that is not a number passes, as it
        // does in the TypeScript engine.
        #[allow(clippy::manual_range_contains)]
        if size < 0.0 || size >= 16.0 {
            return moves;
        }

        let wanted = js::shl(size, 4.0);
        let high = js::shl(pairs.len() as f64, 1.0);
        let mut aim = 0.0;
        let mut step = js::and(js::sar(high, 1.0), js::not(1.0));

        while step > 2.0 {
            let at = js::sar(aim + step, 1.0);

            if at < pairs.len() as f64
                && js::and(pairs[at as usize].0, js::not(0x0f.into())) < wanted
            {
                aim += step;
            }

            step = js::and(js::sar(step, 1.0), js::not(1.0));
        }

        let mut word = aim;

        while word < high {
            let (argument, index) = pairs[js::sar(word, 1.0) as usize];
            let at = js::and(argument, js::not(0x0f.into()));

            if at > wanted {
                // Past the size we want. In a sorted list nothing further can
                // match.
                break;
            }

            if at == wanted {
                let mut steps = js::and(argument, 0x0f.into()) - 8.0;

                // There is no zero step: the range skips it.
                if steps >= 0.0 {
                    steps += 1.0;
                }

                moves.push((js::sar(steps * ONE, state.delta_shift), index));
            }

            word += 2.0;
        }

        moves
    }

    /// Whether glyph programs run at this size at all: a font can say no,
    /// from `prep`, through `INSTCTRL`. Courier New says no below nine pixels
    /// per em.
    pub fn grid_fit(&self) -> bool {
        js::int32(self.defaults.instruction_control) & 1 == 0
    }

    /// Whether the scan converter should rescue dropouts, read after the
    /// programs have run.
    pub fn dropout(&self) -> bool {
        self.dropout_from(self.scan_control)
    }

    /// What `prep` alone left for the scan converter, for a glyph with no
    /// program of its own -- which needs `prep` to have run.
    pub fn prep_dropout(&mut self, font: &FontData) -> Result<bool, Fault> {
        self.prepare(font)?;

        let control = match self.prep_scan {
            Some((control, _)) => control,
            None => self.scan_control,
        };

        Ok(self.dropout_from(control))
    }

    /// What `prep` alone left `SCANTYPE` at -- nought if it never set it.
    pub fn prep_scan_type(&mut self, font: &FontData) -> Result<f64, Fault> {
        self.prepare(font)?;

        Ok(match self.prep_scan {
            Some((_, kind)) => kind,
            None => self.scan_type,
        }
        .unwrap_or(0.0))
    }

    /// `SCANTYPE` as the last glyph left it, nought where nothing set it.
    pub fn scan_type(&self) -> f64 {
        self.scan_type.unwrap_or(0.0)
    }

    /// The rule both ask: bit 11 turns dropout control off above the size,
    /// and outranks bit 8 turning it on at or below it.
    fn dropout_from(&self, value: Option<f64>) -> bool {
        let control = js::int32(value.unwrap_or(0.0));
        let size = f64::from(control & 0xff);

        if control & 0x800 != 0 && self.ppem > size {
            return false;
        }

        control & 0x100 != 0 && self.ppem <= size
    }

    /// Runs a defined function.
    fn call_function(&mut self, program: Program, index: f64) -> Result<(), Fault> {
        let body = index_of(index)
            .and_then(|index| self.functions.get(&index).copied())
            .ok_or(Fault)?;

        if self.depth >= CALL_DEPTH {
            return Err(Fault);
        }

        self.depth += 1;

        let ran = self.run(program, body.at, body.end);

        self.depth -= 1;
        ran
    }

    /// How many bytes an instruction occupies, for scanning past it.
    fn skip(opcode: u8, program: Program, at: i64) -> Result<i64, Fault> {
        Ok(match opcode {
            0x40 | 0x41 => {
                let count = i64::from(program.u8_at(at)?);

                at + 1 + count * if opcode == 0x41 { 2 } else { 1 }
            }
            0xb0..=0xb7 => at + i64::from(opcode - 0xb0) + 1,
            0xb8..=0xbf => at + i64::from(opcode - 0xb8 + 1) * 2,
            _ => at,
        })
    }

    /// Finds the ELSE or EIF that belongs to an IF that was not taken.
    fn skip_to_else(program: Program, at: i64, to: i64) -> Result<i64, Fault> {
        let mut depth = 0;
        let mut cursor = at;

        while cursor < to {
            let opcode = program.u8_at(cursor)?;

            cursor += 1;

            if opcode == 0x58 {
                depth += 1;
            } else if opcode == 0x59 {
                if depth == 0 {
                    return Ok(cursor);
                }

                depth -= 1;
            } else if opcode == 0x1b && depth == 0 {
                return Ok(cursor);
            }

            cursor = Self::skip(opcode, program, cursor)?;
        }

        Ok(to)
    }

    /// Finds the EIF that closes the block an ELSE opened.
    fn skip_to_end(program: Program, at: i64, to: i64) -> Result<i64, Fault> {
        let mut depth = 0;
        let mut cursor = at;

        while cursor < to {
            let opcode = program.u8_at(cursor)?;

            cursor += 1;

            if opcode == 0x58 {
                depth += 1;
            } else if opcode == 0x59 {
                if depth == 0 {
                    return Ok(cursor);
                }

                depth -= 1;
            }

            cursor = Self::skip(opcode, program, cursor)?;
        }

        Ok(to)
    }

    /// Carries the untouched points along with the touched ones, a contour
    /// at a time: one anchor shifts the whole contour, more interpolate the
    /// runs between them, wrapping round the end.
    fn interpolate_untouched(&mut self, horizontal: bool) {
        let zone = &mut self.zones[1];
        let ends = zone.ends.clone();
        let (current, original, design, touched) = if horizontal {
            (
                &mut zone.x,
                &zone.original_x,
                &zone.unscaled_x,
                &zone.touched_x,
            )
        } else {
            (
                &mut zone.y,
                &zone.original_y,
                &zone.unscaled_y,
                &zone.touched_y,
            )
        };

        let mut from = 0.0;

        for end in ends {
            let mut anchors = Vec::new();
            let mut index = from;

            while index <= end {
                if touched.get(index) {
                    anchors.push(index);
                }

                index += 1.0;
            }

            if anchors.is_empty() {
                from = end + 1.0;
                continue;
            }

            if anchors.len() == 1 {
                let shift = current.get(anchors[0]) - original.get(anchors[0]);
                let mut index = from;

                while index <= end {
                    if !touched.get(index) {
                        current.set(index, original.get(index) + shift);
                    }

                    index += 1.0;
                }

                from = end + 1.0;
                continue;
            }

            for slot in 0..anchors.len() {
                let left = anchors[slot];
                let right = anchors[(slot + 1) % anchors.len()];

                #[allow(clippy::float_cmp)]
                let mut index = if left == end { from } else { left + 1.0 };

                #[allow(clippy::float_cmp)]
                while index != right {
                    if !touched.get(index) {
                        interpolate_one(index, left, right, current, original, design);
                    }

                    index = if index == end { from } else { index + 1.0 };
                }
            }

            from = end + 1.0;
        }
    }
}

#[cfg(test)]
impl Hinter {
    pub(crate) fn function_count(&self) -> usize {
        self.functions.len()
    }

    pub(crate) fn control_values(&self) -> Vec<f64> {
        (0..self.cvt.len())
            .map(|index| self.cvt.get(index as f64))
            .collect()
    }
}

/// Places one untouched point between two touched ones: the ratio from the
/// design coordinates, everything else from the scaled ones; a point outside
/// the anchors moves by however far the nearer one moved. Two anchors at the
/// same design coordinate carry the run by **the first anchor's** move.
/// **Recorded**: Courier New Italic's cedilla at twenty-eight pixels.
fn interpolate_one(
    index: f64,
    left: f64,
    right: f64,
    current: &mut Slots<f64>,
    scaled: &Slots<f64>,
    design: &Slots<f64>,
) {
    let ascending = design.get(left) < design.get(right);
    let (low, high) = if ascending {
        (left, right)
    } else {
        (right, left)
    };

    let design_low = design.get(low);
    let design_span = design.get(high) - design.get(low);
    let moved_low = current.get(low) - scaled.get(low);

    if design_span == 0.0 {
        current.add(index, current.get(left) - scaled.get(left));

        return;
    }

    let value = scaled.get(index);

    if value > scaled.get(low) && value < scaled.get(high) {
        let span = current.get(high) - current.get(low);
        let half = js::sar(design_span, 1.0);

        current.set(
            index,
            current.get(low)
                + (((design.get(index) - design_low) * span + half) / design_span).trunc(),
        );

        return;
    }

    let moved = if value >= scaled.get(high) {
        current.get(high) - scaled.get(high)
    } else {
        moved_low
    };

    current.set(index, value + moved);
}

/// A shift a reference point has made, and which point it was.
#[derive(Debug, Clone, Copy)]
struct Shift {
    dx: f64,
    dy: f64,
    zone: usize,
    index: f64,
}

#[cfg(test)]
mod tests;
