//! GDI's small exports for USER and the system: `MakeObjectPrivate`,
//! `WEP`, `SelectBitmap` and `GDIMoveBitmap`. The TypeScript engine's twin
//! is `src/win16/gdi/system-exports.ts`, where each read-out is told.
//!
//! **Recorded** by `gdimisc`.

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "MakeObjectPrivate" => make_object_private,
        "WEP" => wep,
        "SelectBitmap" => select_bitmap,
        "GDIMoveBitmap" => gdi_move_bitmap,
        "DMEnumDFonts" => dm_enum_dfonts,
        "Copy" => copy,
        "ShrinkGDIHeap" => shrink_gdi_heap,
        "GDITaskTermination" => gdi_task_termination,
        "DeviceColorMatch" => device_color_match,
        "FixUpBogusPublisherMetafile" => fix_up_bogus_publisher_metafile,
        _ => return None,
    }))
}

/// Flag 2000h of the object's header set for any `fPrivate` not nought, or
/// cleared, the flag as it was answered (seg1 `0e68`); nought for a handle
/// of no object.
fn make_object_private(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let private = args.word(system);
    let Some(object) = system.handles.resolve(handle) else {
        return Ok(Answer::Word(0));
    };
    let before = if private != 0 {
        !system.gdi.private.insert(object)
    } else {
        system.gdi.private.remove(&object)
    };

    Ok(Answer::Word(if before { 0x2000 } else { 0 }))
}

/// GDI's library exit (seg1 `1ec0`): 1.
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// A memory context's bitmap selected, or with nought the stock bitmap
/// (seg1 `1ac6`): the bitmap before; nought where WinBox has made no stock
/// bitmap's handle yet.
fn select_bitmap(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let bitmap = match args.word(system) {
        0 => system.gdi.stock_bitmap.unwrap_or(0),
        handle => handle,
    };

    Ok(Answer::Word(if bitmap == 0 {
        0
    } else {
        super::dc::select_object(system, hdc, bitmap)
    }))
}

/// Bytes copied for the spooler (seg28 `0000`): `rep movsb`, forward a
/// byte at a time, so a copy onto bytes just past its source repeats them.
/// Nothing is answered.
fn copy(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let count = args.word(system);

    for at in 0..count {
        let step = |far: u32| (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(at));
        let byte = system.read_far(step(from), 1);

        system.write_far(step(to), &byte);
    }

    Ok(Answer::Nothing)
}

/// A memory bitmap's fonts walked for a driver (seg13 `0163`): 1, and no
/// font walked.
fn dm_enum_dfonts(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    for _ in 0..4 {
        args.dword(system);
    }

    Ok(Answer::Word(1))
}

/// `GlobalWire` and `GlobalUnWire` of the bitmap's bits (seg2 `0403`):
/// -1, the count back to nought; WinBox's bitmaps keep no global block.
fn gdi_move_bitmap(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0xffff))
}

/// GDI's heap made smaller (seg1 `1fdf`): WinBox's GDI has no local heap
/// of its own to shrink. Nothing is answered.
fn shrink_gdi_heap(_system: &mut System, _args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Nothing)
}

/// What USER tells GDI as a task ends (seg1 `7690`): nothing is done.
fn gdi_task_termination(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Nothing)
}

fn word_at(system: &System, segment: u16, offset: u32) -> u16 {
    let bytes = system.read_far(u32::from(segment) << 16 | (offset & 0xffff), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// The colour of a device's table nearest a colour (seg11 `1015`, seg22
/// `0b2b`): the entry whose squares of the differences add up to the
/// least, the first of any alike, an exact one at once; its word at the
/// device's offset.
fn device_color_match(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let colour = args.dword(system);
    let device = args.dword(system);
    let segment = (device >> 16) as u16;
    let field = word_at(system, segment, device);
    let table = word_at(system, segment, device + 2);
    let table_segment = word_at(system, segment, device + 4);
    let [red, green, blue, _] = colour.to_le_bytes();
    let byte = |at: u32| system.read_far(u32::from(table_segment) << 16 | (at & 0xffff), 1)[0];
    let mut left = match word_at(system, table_segment, u32::from(table)) {
        0 => 0x1_0000,
        count => u32::from(count),
    };
    let mut entry = u32::from(table) + 4;
    // Seventeen bits of a sum, and the best so far beyond any: FFh:FFFFh.
    let mut best = 0x00ff_ffff;
    let mut found = 0;

    while left > 0 {
        let square = |a: u8, b: u8| u32::from(a.abs_diff(b)).pow(2);
        let distance = square(byte(entry + 6), blue)
            + square(byte(entry + 7), green)
            + square(byte(entry + 8), red);

        if distance == 0 {
            found = left;
            break;
        }

        if distance < best {
            found = left;
            best = distance;
        }

        left -= 1;
        entry += 10;
    }

    let index = u32::from(word_at(system, table_segment, 0)).wrapping_sub(found) & 0xffff;
    let at = u32::from(table) + 4 + ((index * 10) & 0xffff) + u32::from(field);

    Ok(Answer::Word(word_at(system, table_segment, at)))
}

/// A memory metafile's size checked against its records (seg19 `1862`):
/// -2 for a header whose type is not 1; else 1 where the header's size
/// at 6 is its own words and its records' to the one whose function is
/// nought, through a huge pointer; else nought, and the sum written there
/// where asked. A record of no size before the last ends the walk, where
/// Windows would walk for ever.
fn fix_up_bogus_publisher_metafile(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let fix = args.word(system);
    let header = (far >> 16) as u16;
    let start = far & 0xffff;

    if word_at(system, header, start) != 1 {
        return Ok(Answer::Word(0xfffe));
    }

    let mut segment = header;
    // A byte through the huge pointer: past a segment's end, 8 selectors
    // on (`__AHINCR`, seg19 `18ad`).
    let byte_at = |segment: u16, at: u32| {
        let segment = if at > 0xffff {
            segment.wrapping_add(8)
        } else {
            segment
        };

        system.read_far(u32::from(segment) << 16 | (at & 0xffff), 1)[0]
    };
    let word = |segment: u16, at: u32| {
        u16::from(byte_at(segment, at)) | u16::from(byte_at(segment, at + 1)) << 8
    };
    let words = word_at(system, header, start + 2);
    let mut total = u32::from(words);
    // The header passed within its segment, as `add bx,di` twice (`1883`).
    let mut offset = (start + u32::from(words) * 2) & 0xffff;

    loop {
        let size = u32::from(word(segment, offset)) | u32::from(word(segment, offset + 2)) << 16;
        let function = word(segment, offset + 4);

        total = total.wrapping_add(size);

        if function == 0 || size == 0 {
            break;
        }

        let bytes = size.wrapping_mul(2);
        let next = offset + (bytes & 0xffff);
        let carry = u32::from(next > 0xffff);

        segment = segment.wrapping_add((8 * ((bytes >> 16) + carry)) as u16);
        offset = next & 0xffff;
    }

    let was = u32::from(word_at(system, header, start + 6))
        | u32::from(word_at(system, header, start + 8)) << 16;

    if was == total {
        return Ok(Answer::Word(1));
    }

    if fix != 0 {
        system.write_far(
            u32::from(header) << 16 | ((start + 6) & 0xffff),
            &(total as u16).to_le_bytes(),
        );
        system.write_far(
            u32::from(header) << 16 | ((start + 8) & 0xffff),
            &((total >> 16) as u16).to_le_bytes(),
        );
    }

    Ok(Answer::Word(0))
}
