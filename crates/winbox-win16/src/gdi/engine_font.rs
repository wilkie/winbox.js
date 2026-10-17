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

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
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
    Some(match name {
        "EngineRealizeFont" => Implementation::Sync(engine_realize_font_call),
        "EngineEnumerateFont" => Implementation::Async(engine_enumerate_font),
        _ => return None,
    })
}

/// GDI's TrueType fonts for a printer driver's own walk of its fonts:
/// `EngineEnumerateFont` (`GDI.EXE` seg5 `093c`, into `0697`). Each font of
/// the TrueType directory, as `EnumFonts` gives it, at the resolution of
/// the context GDI is walking the fonts of, or 300 dots an inch with none,
/// typed `TRUETYPE_FONTTYPE` and `DEVICE_FONTTYPE`, to the driver's
/// procedure with its data, its structures where GDI's walk of its
/// TrueType fonts puts them (seg5 `07f5`). With TrueType off, nothing, and
/// 1 answered. The last answer; 1 for none.
fn engine_enumerate_font(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (told, procedure, data) = {
            let mut system = engine.system();
            let face = args.dword(&system);
            let procedure = args.dword(&system);
            let data = args.dword(&system);

            if system.fonts().true_type_off {
                return Ok(Answer::Word(1));
            }

            let (log_x, log_y) = match system.printing.drivers.walking {
                Some((hdc, _)) => (
                    i32::from(crate::gdi::get_device_caps(&system, hdc, LOGPIXELSX)),
                    i32::from(crate::gdi::get_device_caps(&system, hdc, LOGPIXELSY)),
                ),
                None => (300, 300),
            };
            let name = (face != 0).then(|| {
                system
                    .read_string(face)
                    .iter()
                    .map(|&byte| char::from(byte))
                    .collect::<String>()
            });
            let told = crate::gdi::text::enumerate::true_type_chosen(
                &mut system,
                log_x,
                log_y,
                name.as_deref(),
            );

            (told, procedure, data)
        };
        let mut answer: i16 = 1;

        for font in &told {
            answer = crate::gdi::text::enumerate::emit(
                engine,
                procedure,
                data,
                font,
                font.kind | DEVICE_FONTTYPE,
            )
            .await?;

            if answer == 0 {
                break;
            }
        }

        Ok(Answer::Word(answer as u16))
    })
}

const DEVICE_FONTTYPE: u16 = 2;
const LOGPIXELSX: i16 = 88;
const LOGPIXELSY: i16 = 90;
