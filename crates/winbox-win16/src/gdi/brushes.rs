//! Pattern brushes: a brush that paints a bitmap's pixels over and over,
//! eight by eight, made of a bitmap (`CreatePatternBrush`) or of a packed
//! DIB (`CreateDIBPatternBrush`).

use std::rc::Rc;

use winbox_raster::blit::Pattern;
use winbox_raster::{DeviceBitmap, palette_for_display};

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

use super::ddb::{Bitmap, bits_size, format_of, read_byte};
use super::objects::{Brush, GdiObject, LogBrush, PatternCopy};

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

/// The brush's own copy of its bitmap (`GDI.EXE` seg4 `00c7`-`0178`): a
/// bitmap of the same size and format, the display's for one the display
/// made, made with `CreateBitmapIndirect` for any other, and the bits
/// copied into it. Its bits as `GetBitmapBits` would answer them.
fn copy_of(bitmap: &Bitmap) -> PatternCopy {
    let (planes, bits_pixel) = format_of(&bitmap.pixels);
    let bits = (0..bits_size(&bitmap.pixels).max(0))
        .map(|at| read_byte(bitmap, at))
        .collect();

    PatternCopy {
        width: bitmap.pixels.width() as u16,
        height: bitmap.pixels.height() as u16,
        planes: planes as u8,
        bits_pixel: bits_pixel as u8,
        bits,
    }
}

/// A brush of a pattern, its colour its first pixel's: a handle, or nought
/// where there are none left.
fn allocate(
    system: &mut System,
    pattern: Pattern,
    logbrush: LogBrush,
    dib_record: Vec<u8>,
    copy: Option<PatternCopy>,
) -> u16 {
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
        dib_record: Some(dib_record),
        copy,
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
    let copy = copy_of(bitmap);

    // The bitmap as a metafile keeps it, from the brush's own copy of it:
    // 3, nought, and the bitmap made a DIB (`metarec`; `GDI.EXE` seg20
    // `184d`).
    let mut dib_record = vec![3, 0, 0, 0];

    dib_record.extend(super::dib::packed_dib_of(system, &bitmap.pixels));
    allocate(system, pattern, logbrush, dib_record, Some(copy))
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
pub fn create_dib_pattern_brush(system: &mut System, block: u16, usage: u16) -> u16 {
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

    // The brush's own copy of the block, every byte of it, as a metafile
    // keeps it after 5 and how its colours are given (`metarec`; `GDI.EXE`
    // seg4 `0039`-`007f`, seg20 `1792`).
    let length = system.global.size_of(winbox_machine::index_for(block));
    let mut dib_record = [5u16, usage]
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect::<Vec<u8>>();

    dib_record.extend((0..length).map(|at| {
        system
            .cpu
            .bus
            .read8(system.linear(super::metafile::far_at(far, at)))
    }));

    allocate(
        system,
        pattern,
        LogBrush {
            style: BS_PATTERN,
            color: 0,
            hatch: 0,
        },
        dib_record,
        None,
    )
}

pub(crate) fn create_dib_pattern_brush_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let block = args.word(system);
    let usage = args.word(system);

    Ok(Answer::Word(create_dib_pattern_brush(system, block, usage)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gdi::bitmaps::create_bitmap;
    use crate::gdi::objects::delete_object;

    /// The copy a brush keeps of a bitmap made of these words.
    fn copy_made_of(width: i16, height: i16, words: &[u16], delete_first: bool) -> PatternCopy {
        let mut system = System::new();
        let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
        let given = system.string_block(&" ".repeat(bytes.len()));

        system.write_far(given, &bytes);

        let bitmap = create_bitmap(&mut system, width, height, 1, 1, given);
        let brush = create_pattern_brush(&mut system, bitmap);

        if delete_first {
            assert!(delete_object(&mut system, bitmap));
        }

        match system.gdi_object_of(brush) {
            Some((_, GdiObject::Brush(brush))) => brush.copy.clone().expect("a copy"),
            _ => panic!("a brush"),
        }
    }

    /// `prpatbr`: what a printer's driver is handed of a monochrome pattern
    /// brush's bitmap -- its size, a row of two bytes, one plane of a bit,
    /// and its rows as made -- the same where the bitmap was deleted before
    /// the brush was selected.
    #[test]
    fn keeps_its_bitmap_as_made() {
        let mono8 = [
            0x00aa, 0x0055, 0x00f0, 0x000f, 0x00cc, 0x0033, 0x0081, 0x007e,
        ];

        for delete_first in [false, true] {
            let copy = copy_made_of(8, 8, &mono8, delete_first);

            assert_eq!((copy.width, copy.height), (8, 8));
            assert_eq!((copy.planes, copy.bits_pixel), (1, 1));
            assert_eq!(
                copy.bits,
                [
                    0xaa, 0, 0x55, 0, 0xf0, 0, 0x0f, 0, 0xcc, 0, 0x33, 0, 0x81, 0, 0x7e, 0
                ]
            );
        }

        let mono16 = [
            0x01ff, 0x0280, 0x0440, 0x0820, 0x1010, 0x2008, 0x4004, 0x8002, 0xaa55, 0x55aa, 0x0f0f,
            0xf0f0,
        ];
        let copy = copy_made_of(16, 12, &mono16, false);

        assert_eq!((copy.width, copy.height), (16, 12));
        assert_eq!(copy.bits.len(), 24);
        assert_eq!(
            copy.bits[..8],
            [0xff, 0x01, 0x80, 0x02, 0x40, 0x04, 0x20, 0x08]
        );
    }
}
