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
