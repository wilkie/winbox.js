//! The bounds GDI keeps of what is drawn in a device context: the program's,
//! by `SetBoundsRect` and `GetBoundsRect`, and Windows' own, by `IsDCDirty`,
//! `SetDCStatus` and the same two calls with 8000h in the flags.
//!
//! **Read out** of `GDI.EXE`: a context keeps two rectangles in the
//! screen's coordinates and their flags -- 1 Windows' set, 2 Windows'
//! enabled, 4 the program's set, 8 the program's enabled; a new context has
//! 2 and both rectangles nought (seg1 `0136`). Each call that draws gives
//! the rectangle it draws in to seg1 `42be`. **Recorded** by `bounds`.

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

use super::dc::{dc_of, screen_origin};
use super::mapping::mapping_of;

const WINDOWS_SET: u16 = 1;
const WINDOWS_ENABLED: u16 = 2;
const PROGRAM_SET: u16 = 4;
const PROGRAM_ENABLED: u16 = 8;

const DCB_RESET: u16 = 1;
const DCB_ACCUMULATE: u16 = 2;
const DCB_ENABLE: u16 = 4;
const DCB_DISABLE: u16 = 8;
const WINDOWS: u16 = 0x8000;

pub(crate) const EMPTY: [i32; 4] = [0x7fff, 0x7fff, -0x8000, -0x8000];

/// A device context's bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub flags: u16,
    pub program: [i32; 4],
    pub windows: [i32; 4],
}

impl Default for Bounds {
    fn default() -> Self {
        Self {
            flags: WINDOWS_ENABLED,
            program: [0; 4],
            windows: [0; 4],
        }
    }
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "SetBoundsRect" => set_bounds_rect_call,
        "GetBoundsRect" => get_bounds_rect_call,
        "IsDCDirty" => is_dc_dirty_call,
        "SetDCStatus" => set_dc_status_call,
        _ => return None,
    }))
}

/// What a call drew in, in the device context's own pixels, taken into the
/// enabled bounds (seg1 `42be`): moved to the screen's coordinates, a right
/// or bottom of nought made 7FFFh, nothing taken where nothing is in it.
pub fn accumulate(system: &mut System, dc: usize, left: i32, top: i32, right: i32, bottom: i32) {
    if system.gdi.dcs[dc].bounds.flags & (WINDOWS_ENABLED | PROGRAM_ENABLED) == 0 {
        return;
    }

    let (x, y) = screen_origin(system, dc);
    let (left, top, right, bottom) = (left + x, top + y, right + x, bottom + y);
    let right = if right == 0 { 0x7fff } else { right };
    let bottom = if bottom == 0 { 0x7fff } else { bottom };

    if right <= left || bottom <= top {
        return;
    }

    let bounds = &mut system.gdi.dcs[dc].bounds;
    let set = (bounds.flags >> 1) & (WINDOWS_SET | PROGRAM_SET);

    bounds.flags |= set;

    for (flag, rect) in [
        (PROGRAM_SET, &mut bounds.program),
        (WINDOWS_SET, &mut bounds.windows),
    ] {
        if set & flag != 0 {
            rect[0] = rect[0].min(left);
            rect[1] = rect[1].min(top);
            rect[2] = rect[2].max(right);
            rect[3] = rect[3].max(bottom);
        }
    }
}

/// A rectangle, an ellipse or a round rectangle's bounds (seg25 `02d1`):
/// put in order, and but for an inside-frame pen grown by the pen -- half
/// its width rounded down at the left and top, half less a pixel at the
/// right and bottom.
#[allow(clippy::too_many_arguments)]
pub fn shape_bounds(
    system: &mut System,
    dc: usize,
    rect: [i32; 4],
    pen_width: i32,
    pen_height: i32,
    inside_frame: bool,
) {
    let [left, top, right, bottom] = ordered(rect);

    if inside_frame {
        accumulate(system, dc, left, top, right, bottom);
        return;
    }

    accumulate(
        system,
        dc,
        left - (pen_width >> 1),
        top - (pen_height >> 1),
        right + ((pen_width - 1) >> 1),
        bottom + ((pen_height - 1) >> 1),
    );
}

/// A line or a chain of lines' bounds (seg21 `08cc`): the points' box,
/// grown by half the pen's width rounded down all round, and a pixel more
/// at the right and bottom where they are not 7FFFh.
pub fn line_bounds(system: &mut System, dc: usize, points: &[(i32, i32)], pen_width: i32) {
    let Some(&(first_x, first_y)) = points.first() else {
        return;
    };
    let grow = pen_width >> 1;
    let (mut left, mut top, mut right, mut bottom) = (first_x, first_y, first_x, first_y);

    for &(x, y) in points {
        left = left.min(x);
        top = top.min(y);
        right = right.max(x);
        bottom = bottom.max(y);
    }

    let right = right + grow;
    let bottom = bottom + grow;

    accumulate(
        system,
        dc,
        left - grow,
        top - grow,
        if right == 0x7fff { right } else { right + 1 },
        if bottom == 0x7fff { bottom } else { bottom + 1 },
    );
}

/// A filled polygon's bounds (seg24 `03f3`): the points' box.
pub fn fill_bounds(system: &mut System, dc: usize, points: &[(i32, i32)]) {
    let Some(&(first_x, first_y)) = points.first() else {
        return;
    };
    let (mut left, mut top, mut right, mut bottom) = (first_x, first_y, first_x, first_y);

    for &(x, y) in points {
        left = left.min(x);
        top = top.min(y);
        right = right.max(x);
        bottom = bottom.max(y);
    }

    accumulate(system, dc, left, top, right, bottom);
}

/// A rectangle given as two corners, in device terms, put in order.
pub fn rect_bounds(system: &mut System, dc: usize, rect: [i32; 4]) {
    let [left, top, right, bottom] = ordered(rect);

    accumulate(system, dc, left, top, right, bottom);
}

fn ordered([left, top, right, bottom]: [i32; 4]) -> [i32; 4] {
    [
        left.min(right),
        top.min(bottom),
        left.max(right),
        top.max(bottom),
    ]
}

fn read_rect(system: &System, far: u32) -> [i32; 4] {
    let bytes = system.read_far(far, 8);

    [0, 2, 4, 6].map(|at| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]])))
}

fn write_rect(system: &mut System, far: u32, rect: [i32; 4]) {
    let bytes: Vec<u8> = rect
        .iter()
        .flat_map(|&value| (value as i16).to_le_bytes())
        .collect();

    system.write_far(far, &bytes);
}

/// `SetBoundsRect` (seg31 `0526`): the state before answered; then reset,
/// accumulate, enable and disable, in that order.
pub fn set_bounds_rect(system: &mut System, dc: usize, far: u32, flags: u16) -> u16 {
    let windows = flags & WINDOWS != 0;
    let (set, enabled) = if windows {
        (WINDOWS_SET, WINDOWS_ENABLED)
    } else {
        (PROGRAM_SET, PROGRAM_ENABLED)
    };
    let state = system.gdi.dcs[dc].bounds.flags;
    let before = (if windows { WINDOWS } else { 0 })
        | (if state & set != 0 {
            DCB_RESET | DCB_ACCUMULATE
        } else {
            DCB_RESET
        })
        | (if state & enabled != 0 {
            DCB_ENABLE
        } else {
            DCB_DISABLE
        });

    if flags & DCB_RESET != 0 {
        let bounds = &mut system.gdi.dcs[dc].bounds;

        *if windows {
            &mut bounds.windows
        } else {
            &mut bounds.program
        } = EMPTY;
        bounds.flags &= !set;
    }

    if flags & DCB_ACCUMULATE != 0 && far != 0 {
        let [mut left, mut top, mut right, mut bottom] = read_rect(system, far);

        if !windows {
            let m = mapping_of(system, dc);
            let (x, y) = screen_origin(system, dc);

            left = m.device_x(i64::from(left)) as i32 + x;
            top = m.device_y(i64::from(top)) as i32 + y;
            right = m.device_x(i64::from(right)) as i32 + x;
            bottom = m.device_y(i64::from(bottom)) as i32 + y;
        }

        if left < right && top < bottom {
            let bounds = &mut system.gdi.dcs[dc].bounds;
            let rect = if windows {
                &mut bounds.windows
            } else {
                &mut bounds.program
            };

            rect[0] = rect[0].min(left);
            rect[1] = rect[1].min(top);
            rect[2] = rect[2].max(right);
            rect[3] = rect[3].max(bottom);
            bounds.flags |= set;
        }
    }

    let bounds = &mut system.gdi.dcs[dc].bounds;

    if flags & DCB_ENABLE != 0 {
        bounds.flags |= enabled;
    }

    if flags & DCB_DISABLE != 0 {
        bounds.flags &= !enabled;
    }

    before
}

fn set_bounds_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let flags = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(set_bounds_rect(system, dc, far, flags)))
}

/// `GetBoundsRect` (seg1 `76e4`): `DCB_RESET` where none are set; Windows'
/// as kept, the program's cut to the context's area, moved back by its
/// corner and in logical units; reset after with `DCB_RESET`; `DCB_SET`.
fn get_bounds_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let flags = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let bounds = system.gdi.dcs[dc].bounds;
    let windows = flags & WINDOWS != 0;

    if bounds.flags & (if windows { WINDOWS_SET } else { PROGRAM_SET }) == 0 {
        return Ok(Answer::Word(DCB_RESET));
    }

    if windows {
        write_rect(system, far, bounds.windows);
    } else {
        let (x, y) = screen_origin(system, dc);
        let (width, height) = system
            .draw_target(dc)
            .map_or((0, 0), |bitmap| (bitmap.width(), bitmap.height()));
        let m = mapping_of(system, dc);
        let left = bounds.program[0].max(x) - x;
        let top = bounds.program[1].max(y) - y;
        let right = bounds.program[2].min(x + width) - x;
        let bottom = bounds.program[3].min(y + height) - y;

        write_rect(
            system,
            far,
            [
                m.logical_x(i64::from(left)) as i32,
                m.logical_y(i64::from(top)) as i32,
                m.logical_x(i64::from(right)) as i32,
                m.logical_y(i64::from(bottom)) as i32,
            ],
        );
    }

    if flags & DCB_RESET != 0 {
        set_bounds_rect(system, dc, 0, flags & (WINDOWS | DCB_RESET));
    }

    Ok(Answer::Word(DCB_RESET | DCB_ACCUMULATE))
}

/// `IsDCDirty` (seg1 `4352`): 1 and Windows' rectangle where set, nought
/// and noughts where not, -1 for no context; then `SetDCStatus(hdc, 0,
/// NULL)`.
fn is_dc_dirty_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);

    if hdc == 0 {
        return Ok(Answer::Word(0xffff));
    }

    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let bounds = system.gdi.dcs[dc].bounds;
    let dirty = bounds.flags & WINDOWS_SET != 0;

    write_rect(system, far, if dirty { bounds.windows } else { [0; 4] });
    set_dc_status(system, dc, false, 0);

    Ok(Answer::Word(u16::from(dirty)))
}

/// `SetDCStatus` (seg1 `439b`): whether Windows' bounds were set; cleared,
/// and set again to the rectangle where asked, else emptied.
fn set_dc_status(system: &mut System, dc: usize, set: bool, far: u32) -> u16 {
    let rect = (far != 0).then(|| read_rect(system, far));
    let bounds = &mut system.gdi.dcs[dc].bounds;
    let before = u16::from(bounds.flags & WINDOWS_SET != 0);

    bounds.flags &= !WINDOWS_SET;

    if set {
        bounds.flags |= WINDOWS_SET;

        if let Some(rect) = rect {
            bounds.windows = rect;
        }
    } else {
        bounds.windows = EMPTY;
    }

    before
}

fn set_dc_status_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let set = args.word(system) != 0;
    let far = args.dword(system);

    if hdc == 0 {
        return Ok(Answer::Word(0xffff));
    }

    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(set_dc_status(system, dc, set, far)))
}

/// Text's bounds (`GDI.EXE` seg1 `35ed`): with a rectangle given and
/// `ETO_OPAQUE` or `ETO_CLIPPED`, the rectangle; and but for `ETO_CLIPPED`,
/// the text: from where it starts -- the point given moved by the
/// alignment (seg1 `3419`-`3502`), in device terms, or nought across where
/// a spacing was given -- to the right edge, as far down as the font is
/// high. `x` and `y` are the point in logical terms, `rect` the rectangle
/// in device terms.
#[allow(clippy::too_many_arguments)]
pub fn text_bounds(
    system: &mut System,
    hdc: u16,
    dc: usize,
    (x, y): (i64, i64),
    text: &[u8],
    spaced: bool,
    rect: Option<[i32; 4]>,
    options: u16,
) -> Result<(), Stop> {
    const ETO_OPAQUE: u16 = 2;
    const ETO_CLIPPED: u16 = 4;
    const TA_RIGHT: u16 = 2;
    const TA_CENTER: u16 = 6;
    const TA_BOTTOM: u16 = 8;
    const TA_BASELINE: u16 = 24;

    if let Some(rect) = rect {
        if options & (ETO_OPAQUE | ETO_CLIPPED) != 0 {
            rect_bounds(system, dc, rect);
        }

        if options & ETO_CLIPPED != 0 {
            return Ok(());
        }
    }

    let Some(font) = super::text::font_of(system, dc)? else {
        return Ok(());
    };
    let metrics = crate::fonts::text_metrics(&font);
    let align = system.gdi.dcs[dc].state.text_align;
    let m = mapping_of(system, dc);
    // Each way the mapping turns an axis over turns the step back.
    let across = if (m.wex ^ m.vex) < 0 { -1 } else { 1 };
    let down = if (m.wey ^ m.vey) < 0 { -1 } else { 1 };
    let mut left = x;
    let mut top = y;

    if align & TA_CENTER == TA_CENTER || align & TA_RIGHT != 0 {
        let extent =
            i64::from(super::text::get_text_extent(system, hdc, text, text.len() as i32)? as u16);

        left -= across
            * if align & TA_CENTER == TA_CENTER {
                extent / 2
            } else {
                extent
            };
    }

    if align & TA_BASELINE == TA_BASELINE {
        top -= down * i64::from(metrics.ascent);
    } else if align & TA_BOTTOM != 0 {
        top -= down * i64::from(metrics.height);
    }

    let device_left = m.device_x(left) as i32;
    let device_top = m.device_y(top) as i32;

    accumulate(
        system,
        dc,
        if spaced { 0 } else { device_left },
        device_top,
        0,
        device_top + metrics.height,
    );
    Ok(())
}
