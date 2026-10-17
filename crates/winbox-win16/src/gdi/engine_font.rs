//! GDI's TrueType engine as a printer driver asks it: `EngineRealizeFont`.
//! The twin of `src/win16/gdi/engine-font.ts`.
//!
//! **Read out** of `GDI.EXE` seg3 `2b2d`-`2b54`:
//!
//! * With TrueType off GDI has no TrueType table, and the answer is nought
//!   (`2b3b`).
//! * A `LOGFONT` with no face and a height of nought answers nought.
//! * Any other, with no `FONTINFO` to fill, answers 96h, the size of the
//!   `FONTINFO` GDI would realize (`2b4f`).
//! * Given a `FONTINFO`, GDI maps the font among the TrueType faces and
//!   realizes it there (seg3 `2841`, `22b3`), answering 96h.
//!
//! The PostScript driver asks with no `FONTINFO` as it enables a device,
//! and keeps room for the answer, doubled (`PSCRIPT.DRV` seg5
//! `009e`-`00b5`); nought fails the device. Not followed: a `FONTINFO`
//! given to fill, which answers nought here.

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub fn engine_realize_font(system: &mut System, logfont: u32, font_info: u32) -> u32 {
    if system.fonts().true_type_off || logfont == 0 {
        return 0;
    }

    let bytes = system.read_far(logfont, 0x13);
    let height = u16::from_le_bytes([bytes[0], bytes[1]]);

    if bytes[0x12] == 0 && height == 0 {
        return 0;
    }

    if font_info >> 16 == 0 {
        return 0x96;
    }

    0
}

fn engine_realize_font_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let logfont = args.dword(system);
    let _transform = args.dword(system);
    let font_info = args.dword(system);

    Ok(Answer::Dword(engine_realize_font(
        system, logfont, font_info,
    )))
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "EngineRealizeFont" => engine_realize_font_call,
        _ => return None,
    }))
}
