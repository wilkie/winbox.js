//! Mapping modes: how a device context turns the coordinates a program
//! gives it, logical, into its pixels, device.
//!
//! A point is its logical coordinate less the window's origin, times the
//! viewport's extent over the window's, and the viewport's origin added, on
//! each axis. **Recorded** by `mapmode` on four displays: the division rounds to the nearest, a half away from nought,
//! except that the half added is the divisor shifted right by one, which
//! for a negative odd divisor is the larger half: with a window extent of 7
//! and a viewport extent of -3, device 1 is logical -3, not -2. Every
//! drawing call maps its points and a rectangle's corners this way.
//!
//! The modes, **recorded**:
//!
//! * `SetMapMode` answers the mode before; 0 and anything past 8 answer
//!   nought and change nothing.
//! * `MM_TEXT` has extents of one. `MM_LOMETRIC` to `MM_TWIPS` have their
//!   display driver's own, with the viewport's y negative. `MM_ISOTROPIC`
//!   starts at `MM_LOMETRIC`'s; `MM_ANISOTROPIC` keeps what the device
//!   context had.
//! * Only those two take new extents. Elsewhere `SetWindowExt` and
//!   `SetViewportExt` answer the extent and change nothing. An extent of
//!   nought answers nought.
//! * `MM_ISOTROPIC` then shrinks the viewport's extent on the axis that
//!   would have the larger scale, keeping its sign, so the two scales agree
//!   in length on the screen.
//! * The origins can be set in every mode. Each call answers what it had,
//!   x in the low word.
//!
//! The Ex forms are each their plain form, the point or size that answers
//! put in a `POINT` or `SIZE` instead, and a `BOOL` answered. **Recorded**
//! by `exfuncs`: a form that asks answers 1, and puts what its plain form
//! answers -- nought, with no device context; a form that sets answers 1
//! and puts the value as it was, or with no device context answers nought
//! and puts nothing; with no structure, nothing is put, and the answer is
//! the same.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

use super::dc::{asks, dc_of};
use super::{pack, put_dword};

pub const MM_TEXT: i64 = 1;
pub const MM_ISOTROPIC: i64 = 7;
pub const MM_ANISOTROPIC: i64 = 8;

/// A device context's mapping: its mode, the window's origin and extents,
/// the viewport's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mapping {
    pub mode: i64,
    pub wox: i64,
    pub woy: i64,
    pub wex: i64,
    pub wey: i64,
    pub vox: i64,
    pub voy: i64,
    pub vex: i64,
    pub vey: i64,
}

/// `MM_TEXT`, which leaves every coordinate as it is: a new device
/// context's.
pub const IDENTITY: Mapping = Mapping {
    mode: MM_TEXT,
    wox: 0,
    woy: 0,
    wex: 1,
    wey: 1,
    vox: 0,
    voy: 0,
    vex: 1,
    vey: 1,
};

impl Default for Mapping {
    fn default() -> Self {
        IDENTITY
    }
}

/// `a * b / c`, rounded as GDI rounds a mapped coordinate, in the
/// TypeScript engine's arithmetic, which is a JavaScript number's: the
/// product a double, never overflowing, and the half the divisor shifted
/// right as a 32-bit integer. A divisor of nought is an infinity there,
/// which `whole` makes nought of.
fn js_scale(a: f64, b: f64, c: f64) -> f64 {
    let product = a * b;

    if product == 0.0 {
        return 0.0;
    }

    // `Math.abs(c >> 1)`: JavaScript's `>>` takes its operand as a 32-bit
    // integer first.
    let half = f64::from((c as i64 as i32) >> 1).abs();

    ((product + if product < 0.0 { -half } else { half }) / c).trunc()
}

/// A coordinate the TypeScript engine computed as a number, as the words it
/// is written into take it: an infinity, from a viewport extent that
/// `MM_ISOTROPIC` shrank to nought, is nought (`& 0xffff` of one is).
///
/// Deliberately not as the TypeScript engine: past an `i64`, which only an
/// extent `ScaleWindowExt` has grown five times over can reach, the value
/// stays at the largest there is, where a double runs on.
fn whole(value: f64) -> i64 {
    if value.is_finite() { value as i64 } else { 0 }
}

/// `a * b / c`, rounded as GDI rounds a mapped coordinate: to the nearest,
/// a half away from nought, the half being the divisor shifted right by
/// one. A divisor of nought answers nought, where the product is not.
// Deliberately: a JavaScript number's precision.
#[allow(clippy::cast_precision_loss)]
pub fn scale(a: i64, b: i64, c: i64) -> i64 {
    whole(js_scale(a as f64, b as f64, c as f64))
}

/// One axis mapped: `value` less `from`'s origin, scaled by `to`'s extent
/// over `from`'s, plus `to`'s origin; moved only, where the extents are
/// equal.
// Deliberately: a JavaScript number's precision.
#[allow(clippy::cast_precision_loss)]
fn map_axis(value: i64, from: (i64, i64), to: (i64, i64)) -> i64 {
    let ((from_origin, from_extent), (to_origin, to_extent)) = (from, to);

    if from_extent == to_extent {
        value - from_origin + to_origin
    } else {
        whole(
            js_scale(
                (value - from_origin) as f64,
                to_extent as f64,
                from_extent as f64,
            ) + to_origin as f64,
        )
    }
}

impl Mapping {
    /// Whether it leaves every coordinate as it is.
    pub fn is_identity(&self) -> bool {
        self.wox == 0
            && self.woy == 0
            && self.vox == 0
            && self.voy == 0
            && self.wex == self.vex
            && self.wey == self.vey
    }

    /// A logical x in device terms.
    pub fn device_x(&self, x: i64) -> i64 {
        map_axis(x, (self.wox, self.wex), (self.vox, self.vex))
    }

    /// A logical y in device terms.
    pub fn device_y(&self, y: i64) -> i64 {
        map_axis(y, (self.woy, self.wey), (self.voy, self.vey))
    }

    /// A device x in logical terms. A viewport extent of nought, which
    /// `MM_ISOTROPIC` can shrink one to, maps every x but the viewport's
    /// origin to nought: the TypeScript engine's infinity, as a word.
    pub fn logical_x(&self, x: i64) -> i64 {
        map_axis(x, (self.vox, self.vex), (self.wox, self.wex))
    }

    /// A device y in logical terms.
    pub fn logical_y(&self, y: i64) -> i64 {
        map_axis(y, (self.voy, self.vey), (self.woy, self.wey))
    }

    /// `MM_ISOTROPIC`'s viewport: the extent on the axis with the larger
    /// scale shrunk to the other's. The scales are compared in lengths, not
    /// pixels: a pixel is `ASPECTX` wide to `ASPECTY` tall. **Recorded** on
    /// the EGA, 38 to 48, where a window of 100 by 100 on a viewport of 640
    /// by -350 makes it 442 by -350, and on the Hercules.
    ///
    /// The lengths are compared as the TypeScript engine compares them, in
    /// doubles, which no extent `ScaleWindowExt` grows can overflow. The
    /// extent shrunk can be nought: a window far taller than wide on a
    /// square viewport.
    // Deliberately: a JavaScript number's precision.
    #[allow(clippy::cast_precision_loss)]
    fn isotropic(self, aspect_x: i64, aspect_y: i64) -> Self {
        let size = |value: i64| value.unsigned_abs() as f64;
        let (aspect_x, aspect_y) = (aspect_x as f64, aspect_y as f64);
        let across = size(self.vex) * size(self.wey) * aspect_x;
        let down = size(self.vey) * size(self.wex) * aspect_y;

        if across > down {
            let vex = whole(js_scale(
                size(self.vey) * size(self.wex),
                aspect_y,
                size(self.wey) * aspect_x,
            ));

            return Self {
                vex: if self.vex < 0 { -vex } else { vex },
                ..self
            };
        }

        if down > across {
            let vey = whole(js_scale(
                size(self.vex) * size(self.wey),
                aspect_x,
                size(self.wex) * aspect_y,
            ));

            return Self {
                vey: if self.vey < 0 { -vey } else { vey },
                ..self
            };
        }

        self
    }
}

/// A device context's mapping, by its index.
pub fn mapping_of(system: &System, index: usize) -> Mapping {
    system.gdi.dcs[index].state.mapping.unwrap_or(IDENTITY)
}

/// The mapping mode set, the one before answered; nought, changing
/// nothing, for a mode that is not one, and for no device context.
pub fn set_map_mode(system: &mut System, hdc: u16, mode: i16) -> u16 {
    let mode = i64::from(mode);
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };

    if !(1..=8).contains(&mode) {
        return 0;
    }

    let m = mapping_of(system, index);
    let [wex, wey, vex, vey] = match mode {
        MM_TEXT => [1, 1, 1, 1],
        MM_ANISOTROPIC => [m.wex, m.wey, m.vex, m.vey],
        _ => {
            // The fixed modes', from the display; `MM_ISOTROPIC` starts at
            // `MM_LOMETRIC`'s.
            let fixed = if mode == MM_ISOTROPIC { 2 } else { mode };

            system
                .display
                .caps
                .mapping_extents
                .get(fixed as usize - 2)
                .map_or([1, 1, 1, 1], |extents| extents.map(i64::from))
        }
    };

    system.gdi.dcs[index].state.mapping = Some(Mapping {
        mode,
        wex,
        wey,
        vex,
        vey,
        ..m
    });
    m.mode as u16
}

pub(crate) fn set_map_mode_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let mode = args.signed(system);

    Ok(Answer::Word(set_map_mode(system, hdc, mode)))
}

/// The mapping mode; nought for no device context.
pub(crate) fn get_map_mode_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let mode = dc_of(system, hdc).map_or(0, |index| mapping_of(system, index).mode);

    Ok(Answer::Word(mode as u16))
}

/// The window's or the viewport's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Which {
    Window,
    Viewport,
}

impl Mapping {
    fn origin(&mut self, which: Which) -> (&mut i64, &mut i64) {
        match which {
            Which::Window => (&mut self.wox, &mut self.woy),
            Which::Viewport => (&mut self.vox, &mut self.voy),
        }
    }

    fn extent(&mut self, which: Which) -> (&mut i64, &mut i64) {
        match which {
            Which::Window => (&mut self.wex, &mut self.wey),
            Which::Viewport => (&mut self.vex, &mut self.vey),
        }
    }
}

/// One origin set, or moved by as much where `add`, the one before
/// answered; nought for no device context.
pub fn origin(system: &mut System, hdc: u16, which: Which, x: i16, y: i16, add: bool) -> u32 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let mut m = mapping_of(system, index);
    let (origin_x, origin_y) = m.origin(which);
    let (old_x, old_y) = (*origin_x, *origin_y);

    *origin_x = i64::from(x) + if add { old_x } else { 0 };
    *origin_y = i64::from(y) + if add { old_y } else { 0 };
    system.gdi.dcs[index].state.mapping = Some(m);
    pack(old_x, old_y)
}

/// One extent set, where the mode lets it, the one before answered; nought
/// for no device context, and for an extent of nought.
pub fn extent(system: &mut System, hdc: u16, which: Which, x: i64, y: i64) -> u32 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let mut m = mapping_of(system, index);
    let mode = m.mode;
    let (extent_x, extent_y) = m.extent(which);
    let old = pack(*extent_x, *extent_y);

    if mode != MM_ISOTROPIC && mode != MM_ANISOTROPIC {
        return old;
    }

    if x == 0 || y == 0 {
        return 0;
    }

    *extent_x = x;
    *extent_y = y;

    let caps = &system.display.caps;
    let changed = if m.mode == MM_ISOTROPIC {
        m.isotropic(i64::from(caps.aspect_x), i64::from(caps.aspect_y))
    } else {
        m
    };

    system.gdi.dcs[index].state.mapping = Some(changed);
    old
}

/// One extent scaled, where the mode lets it, the one before answered;
/// nought for no device context, and for a denominator of nought.
pub fn scale_extent(system: &mut System, hdc: u16, which: Which, factors: [i16; 4]) -> u32 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let [x_num, x_denom, y_num, y_denom] = factors.map(i64::from);

    if x_denom == 0 || y_denom == 0 {
        return 0;
    }

    let mut m = mapping_of(system, index);
    let (extent_x, extent_y) = m.extent(which);
    let x = scale(*extent_x, x_num, x_denom);
    let y = scale(*extent_y, y_num, y_denom);

    extent(system, hdc, which, x, y)
}

/// One of the four, x in the low word; nought for no device context.
fn answer(system: &System, hdc: u16, field: fn(&Mapping) -> (i64, i64)) -> u32 {
    dc_of(system, hdc).map_or(0, |index| {
        let (x, y) = field(&mapping_of(system, index));

        pack(x, y)
    })
}

pub fn get_window_org(system: &System, hdc: u16) -> u32 {
    answer(system, hdc, |m| (m.wox, m.woy))
}

pub fn get_window_ext(system: &System, hdc: u16) -> u32 {
    answer(system, hdc, |m| (m.wex, m.wey))
}

pub fn get_viewport_org(system: &System, hdc: u16) -> u32 {
    answer(system, hdc, |m| (m.vox, m.voy))
}

pub fn get_viewport_ext(system: &System, hdc: u16) -> u32 {
    answer(system, hdc, |m| (m.vex, m.vey))
}

/// An origin's call: its device context, its x and y.
fn origin_call(system: &mut System, args: &mut Args, which: Which, add: bool) -> u32 {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);

    origin(system, hdc, which, x, y, add)
}

/// An extent's call: its device context, its x and y.
fn extent_call(system: &mut System, args: &mut Args, which: Which) -> u32 {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);

    extent(system, hdc, which, i64::from(x), i64::from(y))
}

/// A scaling's call: its device context, and the numerators and
/// denominators.
fn scale_call(system: &mut System, args: &mut Args, which: Which) -> u32 {
    let hdc = args.word(system);
    let factors = [(); 4].map(|()| args.signed(system));

    scale_extent(system, hdc, which, factors)
}

/// An Ex form that sets: no device context answers nought and puts
/// nothing; else what the plain form answers is put, and 1 answered.
fn sets(
    system: &mut System,
    args: &mut Args,
    words: usize,
    plain: impl FnOnce(&mut System, &mut Args) -> u32,
) -> Answer {
    // The plain form reads the device context and its values again; the
    // pointer comes after them.
    let mut again = *args;
    let hdc = args.word(system);

    for _ in 0..words {
        args.word(system);
    }

    let far = args.dword(system);

    if dc_of(system, hdc).is_none() {
        return Answer::Word(0);
    }

    let value = plain(system, &mut again);

    put_dword(system, far, value);
    Answer::Word(1)
}

pub(crate) fn set_window_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(origin_call(
        system,
        args,
        Which::Window,
        false,
    )))
}

pub(crate) fn set_viewport_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(origin_call(
        system,
        args,
        Which::Viewport,
        false,
    )))
}

pub(crate) fn offset_window_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(origin_call(
        system,
        args,
        Which::Window,
        true,
    )))
}

pub(crate) fn offset_viewport_org_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(Answer::Dword(origin_call(
        system,
        args,
        Which::Viewport,
        true,
    )))
}

pub(crate) fn set_window_ext_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(extent_call(system, args, Which::Window)))
}

pub(crate) fn set_viewport_ext_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(extent_call(system, args, Which::Viewport)))
}

pub(crate) fn scale_window_ext_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(scale_call(system, args, Which::Window)))
}

pub(crate) fn scale_viewport_ext_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(Answer::Dword(scale_call(system, args, Which::Viewport)))
}

fn hdc_answer(system: &mut System, args: &mut Args, plain: fn(&System, u16) -> u32) -> Answer {
    let hdc = args.word(system);

    Answer::Dword(plain(system, hdc))
}

pub(crate) fn get_window_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(hdc_answer(system, args, get_window_org))
}

pub(crate) fn get_window_ext_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(hdc_answer(system, args, get_window_ext))
}

pub(crate) fn get_viewport_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(hdc_answer(system, args, get_viewport_org))
}

pub(crate) fn get_viewport_ext_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(hdc_answer(system, args, get_viewport_ext))
}

pub(crate) fn get_window_org_ex_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(asks(system, args, get_window_org))
}

pub(crate) fn get_window_ext_ex_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(asks(system, args, get_window_ext))
}

pub(crate) fn get_viewport_org_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(asks(system, args, get_viewport_org))
}

pub(crate) fn get_viewport_ext_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(asks(system, args, get_viewport_ext))
}

pub(crate) fn set_window_org_ex_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(sets(system, args, 2, |system, args| {
        origin_call(system, args, Which::Window, false)
    }))
}

pub(crate) fn set_viewport_org_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(sets(system, args, 2, |system, args| {
        origin_call(system, args, Which::Viewport, false)
    }))
}

pub(crate) fn offset_window_org_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(sets(system, args, 2, |system, args| {
        origin_call(system, args, Which::Window, true)
    }))
}

pub(crate) fn offset_viewport_org_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(sets(system, args, 2, |system, args| {
        origin_call(system, args, Which::Viewport, true)
    }))
}

pub(crate) fn set_window_ext_ex_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(sets(system, args, 2, |system, args| {
        extent_call(system, args, Which::Window)
    }))
}

pub(crate) fn set_viewport_ext_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(sets(system, args, 2, |system, args| {
        extent_call(system, args, Which::Viewport)
    }))
}

pub(crate) fn scale_window_ext_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(sets(system, args, 4, |system, args| {
        scale_call(system, args, Which::Window)
    }))
}

pub(crate) fn scale_viewport_ext_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(sets(system, args, 4, |system, args| {
        scale_call(system, args, Which::Viewport)
    }))
}

/// Points in the program's memory mapped in place, each way: whether there
/// was a device context and a pointer.
pub fn map_points(
    system: &mut System,
    hdc: u16,
    far: u32,
    count: i16,
    map: fn(&Mapping, i64, i64) -> (i64, i64),
) -> u16 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };

    if far == 0 {
        return 0;
    }

    let m = mapping_of(system, index);

    for at in 0..i32::from(count).max(0) as u32 {
        let point = (far & 0xffff_0000) | (far.wrapping_add(at * 4) & 0xffff);
        let bytes = system.read_far(point, 4);
        let x = i16::from_le_bytes([bytes[0], bytes[1]]);
        let y = i16::from_le_bytes([bytes[2], bytes[3]]);
        let (x, y) = map(&m, i64::from(x), i64::from(y));

        system.write_far(point, &pack(x, y).to_le_bytes());
    }

    1
}

fn points_call(
    system: &mut System,
    args: &mut Args,
    map: fn(&Mapping, i64, i64) -> (i64, i64),
) -> Answer {
    let hdc = args.word(system);
    let far = args.dword(system);
    let count = args.signed(system);

    Answer::Word(map_points(system, hdc, far, count, map))
}

/// Logical points turned into device points, in place.
pub(crate) fn lp_to_dp_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(points_call(system, args, |m, x, y| {
        (m.device_x(x), m.device_y(y))
    }))
}

/// Device points turned into logical points, in place.
pub(crate) fn dp_to_lp_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(points_call(system, args, |m, x, y| {
        (m.logical_x(x), m.logical_y(y))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gdi::dc::{create_compatible_dc, create_dc};

    /// The mapping as `mapmode` records it.
    fn shown(system: &System, hdc: u16) -> String {
        let m = mapping_of(system, dc_of(system, hdc).unwrap());

        format!(
            "map={},wo={}:{},we={}:{},vo={}:{},ve={}:{}",
            m.mode, m.wox, m.woy, m.wex, m.wey, m.vox, m.voy, m.vex, m.vey
        )
    }

    fn pair(packed: u32) -> String {
        format!("{}:{}", packed as u16 as i16, (packed >> 16) as u16 as i16)
    }

    #[test]
    fn sets_the_modes_as_recorded_on_the_vga() {
        let mut system = System::new();
        let hdc = create_dc(&mut system, b"DISPLAY").unwrap();
        let recorded = [
            (1, "1,map=1,wo=0:0,we=1:1,vo=0:0,ve=1:1"),
            (2, "1,map=2,wo=0:0,we=2080:1560,vo=0:0,ve=640:-480"),
            (3, "2,map=3,wo=0:0,we=20800:15600,vo=0:0,ve=640:-480"),
            (4, "3,map=4,wo=0:0,we=325:325,vo=0:0,ve=254:-254"),
            (5, "4,map=5,wo=0:0,we=1625:1625,vo=0:0,ve=127:-127"),
            (6, "5,map=6,wo=0:0,we=2340:2340,vo=0:0,ve=127:-127"),
            (7, "6,map=7,wo=0:0,we=2080:1560,vo=0:0,ve=640:-480"),
            (8, "7,map=8,wo=0:0,we=2080:1560,vo=0:0,ve=640:-480"),
            (9, "0,map=8,wo=0:0,we=2080:1560,vo=0:0,ve=640:-480"),
            (0, "0,map=8,wo=0:0,we=2080:1560,vo=0:0,ve=640:-480"),
        ];

        assert_eq!(shown(&system, hdc), "map=1,wo=0:0,we=1:1,vo=0:0,ve=1:1");

        for (mode, result) in recorded {
            let before = set_map_mode(&mut system, hdc, mode);

            assert_eq!(format!("{before},{}", shown(&system, hdc)), result);
        }
    }

    #[test]
    fn sets_origins_and_extents_as_recorded() {
        let mut system = System::new();
        let hdc = create_dc(&mut system, b"DISPLAY").unwrap();
        let step = |system: &mut System, answer: u32, result: &str| {
            assert_eq!(format!("{},{}", pair(answer), shown(system, hdc)), result);
        };

        let answer = origin(&mut system, hdc, Which::Window, 5, 7, false);
        step(&mut system, answer, "0:0,map=1,wo=5:7,we=1:1,vo=0:0,ve=1:1");
        let answer = origin(&mut system, hdc, Which::Viewport, -2, 3, false);
        step(
            &mut system,
            answer,
            "0:0,map=1,wo=5:7,we=1:1,vo=-2:3,ve=1:1",
        );
        let answer = extent(&mut system, hdc, Which::Window, 10, 20);
        step(
            &mut system,
            answer,
            "1:1,map=1,wo=5:7,we=1:1,vo=-2:3,ve=1:1",
        );
        let answer = origin(&mut system, hdc, Which::Window, 1, 1, true);
        step(
            &mut system,
            answer,
            "5:7,map=1,wo=6:8,we=1:1,vo=-2:3,ve=1:1",
        );
        let answer = origin(&mut system, hdc, Which::Viewport, 1, 1, true);
        step(
            &mut system,
            answer,
            "-2:3,map=1,wo=6:8,we=1:1,vo=-1:4,ve=1:1",
        );
        set_map_mode(&mut system, hdc, 8);
        let answer = extent(&mut system, hdc, Which::Window, 10, 20);
        step(
            &mut system,
            answer,
            "1:1,map=8,wo=6:8,we=10:20,vo=-1:4,ve=1:1",
        );
        let answer = extent(&mut system, hdc, Which::Viewport, 30, -40);
        step(
            &mut system,
            answer,
            "1:1,map=8,wo=6:8,we=10:20,vo=-1:4,ve=30:-40",
        );
        let answer = extent(&mut system, hdc, Which::Window, 0, 5);
        step(
            &mut system,
            answer,
            "0:0,map=8,wo=6:8,we=10:20,vo=-1:4,ve=30:-40",
        );
        let answer = scale_extent(&mut system, hdc, Which::Window, [7, 10, 1, 2]);
        step(
            &mut system,
            answer,
            "10:20,map=8,wo=6:8,we=7:10,vo=-1:4,ve=30:-40",
        );
        let answer = scale_extent(&mut system, hdc, Which::Viewport, [3, 2, 5, 4]);
        step(
            &mut system,
            answer,
            "30:-40,map=8,wo=6:8,we=7:10,vo=-1:4,ve=45:-50",
        );
        set_map_mode(&mut system, hdc, 7);
        let answer = extent(&mut system, hdc, Which::Window, 100, 100);
        step(
            &mut system,
            answer,
            "2080:1560,map=7,wo=6:8,we=100:100,vo=-1:4,ve=480:-480",
        );
        let answer = extent(&mut system, hdc, Which::Viewport, 50, 50);
        step(
            &mut system,
            answer,
            "480:-480,map=7,wo=6:8,we=100:100,vo=-1:4,ve=50:50",
        );
        let answer = extent(&mut system, hdc, Which::Viewport, 30, -30);
        step(
            &mut system,
            answer,
            "50:50,map=7,wo=6:8,we=100:100,vo=-1:4,ve=30:-30",
        );
        let answer = extent(&mut system, hdc, Which::Window, 30, 10);
        step(
            &mut system,
            answer,
            "100:100,map=7,wo=6:8,we=30:10,vo=-1:4,ve=30:-10",
        );
        set_map_mode(&mut system, hdc, 4);
        let answer = extent(&mut system, hdc, Which::Window, 1, 1);
        step(
            &mut system,
            answer,
            "325:325,map=4,wo=6:8,we=325:325,vo=-1:4,ve=254:-254",
        );
    }

    #[test]
    fn rounds_a_mapped_point_as_recorded() {
        let m = Mapping {
            mode: MM_ANISOTROPIC,
            wex: 3,
            wey: 3,
            vex: 2,
            vey: 2,
            ..IDENTITY
        };
        // `3to2`: logical and device, -7 to 7.
        let to_device = [-5, -4, -3, -3, -2, -1, -1, 0, 1, 1, 2, 3, 3, 4, 5];
        let to_logical = [-11, -9, -8, -6, -5, -3, -2, 0, 2, 3, 5, 6, 8, 9, 11];

        for (at, value) in (-7..=7).enumerate() {
            assert_eq!(m.device_x(value), to_device[at], "lp={value}");
            assert_eq!(m.logical_y(value), to_logical[at], "dp={value}");
        }

        // A negative odd divisor's half is the larger.
        let odd = Mapping {
            wex: 7,
            vex: -3,
            ..m
        };

        assert_eq!(odd.logical_x(1), -3);
    }

    #[test]
    fn maps_points_in_place() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);
        let far = system.string_block("        ");

        system.write_far(far, &[0xf9, 0xff, 7, 0, 0, 0, 0, 0]);
        set_map_mode(&mut system, hdc, 8);
        extent(&mut system, hdc, Which::Window, 3, 3);
        extent(&mut system, hdc, Which::Viewport, 2, 2);
        assert_eq!(
            map_points(&mut system, hdc, far, 2, |m, x, y| (
                m.device_x(x),
                m.device_y(y)
            )),
            1
        );
        assert_eq!(system.read_far(far, 8), [0xfb, 0xff, 5, 0, 0, 0, 0, 0]);
        assert_eq!(map_points(&mut system, hdc, 0, 2, |_, x, y| (x, y)), 0);
        assert_eq!(map_points(&mut system, 0, far, 2, |_, x, y| (x, y)), 0);
    }

    #[test]
    fn maps_through_a_viewport_shrunk_to_nought_as_the_typescript_engine_does() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);
        let far = system.string_block("        ");

        // A window far taller than wide: the viewport's width shrinks to
        // nought, 480 * 36 / (32767 * 36) rounded.
        set_map_mode(&mut system, hdc, 7);
        extent(&mut system, hdc, Which::Window, 1, 32767);
        assert_eq!(get_viewport_ext(&system, hdc), 0xfe20_0000);
        origin(&mut system, hdc, Which::Window, 5, 0, false);
        system.write_far(far, &[3, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(
            map_points(&mut system, hdc, far, 2, |m, x, y| (
                m.logical_x(x),
                m.logical_y(y)
            )),
            1
        );
        // An infinity is nought; the viewport's origin is the window's.
        assert_eq!(system.read_far(far, 8), [0, 0, 0, 0, 5, 0, 0, 0]);
    }

    #[test]
    fn scales_an_extent_past_any_word_without_overflowing() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);

        set_map_mode(&mut system, hdc, 8);

        for _ in 0..4 {
            scale_extent(&mut system, hdc, Which::Window, [32767, 1, 32767, 1]);
        }

        // 32767 to the fourth, past a double's whole numbers: the product
        // rounded as the TypeScript engine's is.
        let m = mapping_of(&system, dc_of(&system, hdc).unwrap());

        assert_eq!(m.wex, (32767_f64.powi(3) * 32767.0) as i64);
        assert_eq!(m.device_x(0), 0);

        // Past an i64 an extent stays at the largest there is, where the
        // TypeScript engine's double runs on.
        scale_extent(&mut system, hdc, Which::Window, [32767, 1, 32767, 1]);

        let m = mapping_of(&system, dc_of(&system, hdc).unwrap());

        assert_eq!(m.wex, i64::MAX);
        assert_eq!(scale(7, -3, 0), 0);
        // The half of a negative odd divisor is the larger.
        assert_eq!(scale(1, 1, -3), -1);
        assert_eq!(scale(-1, 1, -3), 1);
        assert_eq!(scale(1, 1, 3), 0);
    }
}
