//! `GetPhysicalFontHandle`: the handle of the font GDI realized for a
//! device context, the global block its `FONTINFO` is in. The twin of
//! `src/win16/gdi/physical-font.ts`, where the reading out is.

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

use super::dc::dc_of;

/// `GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE`, as GDI allocates a
/// `FONTINFO` (seg3 `23bc`).
const GMEM_REALIZED: u16 = 0x2042;

/// The size of the `FONTINFO` GDI's TrueType engine realizes (seg3 `23c0`).
const ENGINE_FONTINFO: u32 = 0x96;

/// The size of a font file's header, through `dfFace`.
const FONT_HEADER: u32 = 0x76;

/// A printer's context answers the block its driver's `FONTINFO` is in; a
/// display's, a block kept for its font object the first time it is asked for.
fn get_physical_font_handle_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(object) = system.gdi.dcs[dc].state.font else {
        return Ok(Answer::Word(0));
    };

    if system.printing.drivers.contexts.contains_key(&dc) {
        let handle = super::printer_driver::kept_device_font(system, dc)
            .and_then(|(_, _, kept)| kept)
            .map_or(0, |kept| kept.handle);

        return Ok(Answer::Word(handle));
    }

    if let Some(&(_, handle)) = system
        .gdi
        .physical_fonts
        .iter()
        .find(|(held, _)| *held == object)
    {
        return Ok(Answer::Word(handle));
    }

    let outline = super::text::font_of(system, dc)?.is_some_and(|font| font.outline.is_some());
    let size = if outline {
        ENGINE_FONTINFO
    } else {
        FONT_HEADER
    };
    let handle = crate::memory::global_alloc_handle(system, GMEM_REALIZED, size);

    if handle != 0 {
        system.gdi.physical_fonts.push((object, handle));
    }

    Ok(Answer::Word(handle))
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "GetPhysicalFontHandle" => Implementation::Sync(get_physical_font_handle_call),
        _ => return None,
    })
}
