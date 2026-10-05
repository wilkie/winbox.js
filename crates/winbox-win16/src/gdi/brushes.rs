//! Pattern brushes: a brush that paints a bitmap's pixels over and over,
//! eight by eight, made of a bitmap (`CreatePatternBrush`) or of a packed
//! DIB (`CreateDIBPatternBrush`).

use std::rc::Rc;

use winbox_raster::blit::Pattern;
use winbox_raster::{DeviceBitmap, palette_for_display};

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

use super::objects::{Brush, GdiObject, LogBrush};

const BS_PATTERN: u16 = 3;

/// The top-left eight by eight of a bitmap, repeated where it is smaller.
fn pattern_of(bitmap: &DeviceBitmap) -> Pattern {
    let mut indices = [0; 64];

    for y in 0..8 {
        for x in 0..8 {
            indices[(y * 8 + x) as usize] = bitmap
                .index_at(x % bitmap.width(), y % bitmap.height())
                .unwrap_or(0);
        }
    }

    Pattern {
        depth: bitmap.depth,
        palette: Rc::clone(&bitmap.device_palette),
        indices,
    }
}

/// A brush of a pattern, its colour its first pixel's: a handle, or nought
/// where there are none left.
fn allocate(system: &mut System, pattern: Pattern, logbrush: LogBrush) -> u16 {
    let [red, green, blue] = pattern
        .palette
        .borrow()
        .colours
        .get(usize::from(pattern.indices[0]))
        .copied()
        .unwrap_or([0, 0, 0]);
    let object = system.gdi_object(GdiObject::Brush(Brush {
        color: [red, green, blue, 0xff],
        colorref: None,
        hatch: None,
        logbrush: Some(logbrush),
        stock: None,
        realised: None,
        pattern: Some(pattern),
    }));

    system
        .handles
        .allocate(Kind::Gdi, Object::Gdi(object))
        .unwrap_or(0)
}

/// A brush that paints a bitmap's pixels over and over, eight by eight.
///
/// **Recorded** by `patbrush` on the VGA:
///
/// * Only the bitmap's top-left eight by eight is used: one sixteen square
///   paints as its corner does. The brush keeps its own copy; the bitmap can
///   be deleted.
/// * A monochrome pattern's set bits paint the device context's background
///   colour and its clear bits the text colour, those the device context
///   has when it paints, not when the brush was selected.
/// * The pattern starts at the device context's origin, whatever rectangle
///   is painted, or at its brush origin (`SetBrushOrg`) as it was when the
///   brush was first selected. Selecting it again keeps that, until
///   `UnrealizeObject`.
/// * `GetObject` answers a `LOGBRUSH` of 8 bytes: `BS_PATTERN`, colour
///   nought, and the bitmap's handle.
///
/// Nought for no bitmap, and for one with no width or height.
pub fn create_pattern_brush(system: &mut System, handle: u16) -> u16 {
    create_pattern_brush_as(
        system,
        handle,
        LogBrush {
            style: BS_PATTERN,
            color: 0,
            hatch: handle,
        },
    )
}

/// A pattern brush whose `LOGBRUSH` is as it was given: `CreateBrushIndirect`
/// of `BS_PATTERN`.
pub fn create_pattern_brush_as(system: &mut System, handle: u16, logbrush: LogBrush) -> u16 {
    let Some(bitmap) = system.bitmap_of(handle) else {
        return 0;
    };

    if bitmap.pixels.width() == 0 || bitmap.pixels.height() == 0 {
        return 0;
    }

    let pattern = pattern_of(&bitmap.pixels);

    allocate(system, pattern, logbrush)
}

pub(crate) fn create_pattern_brush_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(create_pattern_brush(system, handle)))
}

/// A pattern brush from a packed DIB in a global block: its header, its
/// colour table, and its bits after them, matched to the display's colours.
/// **Recorded** by `gdidraw`: a four-bit DIB 8 by 8 and a one-bit one, red
/// and white, paint their pixels from the device context's origin as a
/// bitmap's pattern brush does. `DIB_PAL_COLORS` is not recorded, and its
/// table is taken as colours. `GetObject` answers `BS_PATTERN` and no
/// bitmap.
pub fn create_dib_pattern_brush(system: &mut System, block: u16) -> u16 {
    let far = system.global_pointer(block);

    if far == 0 {
        return 0;
    }

    let word = |at: u32| {
        let bytes = system.read_far((far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff), 2);

        u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
    };
    let size = word(0) | word(2) << 16;
    let core = size == 12;
    let bit_count = if core { word(10) } else { word(14) };
    let used = if core { 0 } else { word(32) | word(34) << 16 };
    let colours = if bit_count <= 8 {
        if used == 0 { 1 << bit_count } else { used }
    } else {
        0
    };
    let bits = (far & 0xffff_0000)
        | (far
            .wrapping_add(size)
            .wrapping_add(colours.wrapping_mul(if core { 3 } else { 4 }))
            & 0xffff);
    let display = system.display_kind();
    let height = {
        let bytes = system.read_far(far, 12);

        if core {
            i64::from(i16::from_le_bytes([bytes[6], bytes[7]])).abs()
        } else {
            i64::from(i32::from_le_bytes([
                bytes[8], bytes[9], bytes[10], bytes[11],
            ]))
            .abs()
        }
    };
    let found = super::dib::dib_at(
        system,
        far,
        bits,
        height,
        display.depth(),
        palette_for_display(display, None),
    );

    let Some((bitmap, _)) = found else {
        return 0;
    };
    let pattern = pattern_of(&bitmap);

    allocate(
        system,
        pattern,
        LogBrush {
            style: BS_PATTERN,
            color: 0,
            hatch: 0,
        },
    )
}

pub(crate) fn create_dib_pattern_brush_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let block = args.word(system);
    let _usage = args.word(system);

    Ok(Answer::Word(create_dib_pattern_brush(system, block)))
}
