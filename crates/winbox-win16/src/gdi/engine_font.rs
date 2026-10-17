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
//!   realizes it there (seg3 `2841`, `22b3`), answering 96h; see
//!   `realize_true_type`. It needs the device context whose font is being
//!   realized (`[064Eh]`), and answers nought without one.
//!
//! The PostScript driver asks with no `FONTINFO` as it enables a device,
//! and keeps room for the answer, doubled (`PSCRIPT.DRV` seg5
//! `009e`-`00b5`); nought fails the device.

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::fonts::{FontManager, Request};
use crate::system::System;

pub fn engine_realize_font(
    system: &mut System,
    logfont: u32,
    transform: u32,
    font_info: u32,
) -> u32 {
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

    realize_true_type(system, logfont, transform, font_info)
}

/// A TrueType font realized into a `FONTINFO` a driver gave, and its
/// `TEXTXFORM` filled (`GDI.EXE` seg3 `2841`, `22b3`, `220b`, `21b6`):
///
/// * The face mapped among the TrueType faces -- here, the face named, in
///   the weight and slant asked for -- and settled at a size as the mapper
///   settles one (`realise_outline`): a negative height is the em; a
///   positive one the cell.
/// * The header from the face's `.FOT` stub, in its font units over its
///   em, at that size (`220b`): the points, 72 times the em over the
///   vertical resolution; the resolutions the context's logical ones; the
///   ascent and the cell's height as the rasterizer has them, where the
///   text is upright and its slant not made (`2506`); the internal leading
///   the cell less the em; the external leading, the average and widest
///   widths scaled -- the average the width asked for where there is one;
///   the italic flag the face's, or `FFh` for a slant GDI makes; underline,
///   strike-out, weight, character set, pitch and family, and the first,
///   last, default and break characters the stub's. The type 3, the face's
///   name at 6Eh, and the escapement (48h), the stretch (4Ah) and the em
///   (4Ch).
/// * The `TEXTXFORM` from it (`21b6`): the height the cell's, the width
///   the average, the escapement and orientation the escapement, the
///   weight, italic, underline and strike-out the header's, the rest
///   nought.
///
/// The answer is 96h, or nought where no face answers. Not followed: GDI's
/// penalties among faces not named, the underline and strike-out metrics
/// at 34h-3Ah, and the flags `6de2` adds.
// One field after another, as GDI fills them.
#[allow(clippy::too_many_lines)]
fn realize_true_type(system: &mut System, logfont: u32, transform: u32, font_info: u32) -> u32 {
    let Some(dc) = system.printing.drivers.realizing else {
        return 0;
    };
    let Some(caps) = super::printer_driver::device_info(system, dc).map(<[u8]>::to_vec) else {
        return 0;
    };
    let lf = system.read_far(logfont, 0x32);
    let signed = |at: usize| i32::from(i16::from_le_bytes([lf[at], lf[at + 1]]));
    let face: String = lf[0x12..]
        .iter()
        .take(0x20)
        .take_while(|&&byte| byte != 0)
        .map(|&byte| char::from(byte))
        .collect();
    let (height, width, escapement, weight, italic) =
        (signed(0), signed(2), signed(4), signed(8), lf[0x0a]);
    let Some(found) = system.fonts().outline(&face, weight > 550, italic != 0) else {
        return 0;
    };
    let Some(stub) = found.font.resource.borrow().clone() else {
        return 0;
    };
    let caps_word = |at: usize| i32::from(u16::from_le_bytes([caps[at], caps[at + 1]]));
    let (log_x, log_y) = (caps_word(0x58), caps_word(0x5a));
    let request = Request {
        face: face.clone(),
        height,
        width,
        weight,
        italic: italic != 0,
        escapement,
        log_pixels_x: log_x,
        log_pixels_y: log_y,
        aspect_x: caps_word(0x28),
        aspect_y: caps_word(0x2a),
        ..Request::default()
    };
    let Some(sized) = FontManager::realise_outline(&found.font, &request) else {
        return 0;
    };
    let mul_div = super::calls::mul_div;
    let ppem = sized.ppem as i32;
    let em = i32::from(stub.size_em);
    let scale = 0x100;
    let across = mul_div(em, log_y, (log_x * scale) >> 8);
    let made = italic != 0 && stub.italic == 0;
    let angle = if escapement == 0 {
        0
    } else {
        escapement.rem_euclid(3600)
    };
    let design_ascent = mul_div(i32::from(stub.ascent), ppem, em);
    let (mut ascent, mut cell) = (
        design_ascent,
        design_ascent
            + mul_div(
                i32::from(stub.cell_height) - i32::from(stub.ascent),
                ppem,
                em,
            ),
    );

    // The rasterizer's own ascent and cell, upright and not slanted by GDI
    // (`24dd`-`251e`).
    if angle == 0 && !made {
        ascent = sized.ascent as i32;
        cell = (sized.ascent + sized.descent) as i32;
    }

    let average = if width != 0 {
        width
    } else {
        mul_div(i32::from(stub.avg_width), ppem, across)
    };
    let at = |offset: u32| (font_info & 0xffff_0000) | (font_info.wrapping_add(offset) & 0xffff);
    let put16 = |system: &mut System, offset: u32, value: i32| {
        system.write_far(at(offset), &(value as u16).to_le_bytes());
    };
    let put8 = |system: &mut System, offset: u32, value: u8| {
        system.write_far(at(offset), &[value]);
    };
    let italic_byte = if made { 0xff } else { stub.italic };

    put16(system, 0, 3);
    put16(system, 2, 72 * ppem / log_y);
    put16(system, 4, log_y);
    put16(system, 6, log_x);
    put16(system, 8, ascent);
    put16(system, 0x0a, cell - ppem);
    put16(
        system,
        0x0c,
        mul_div(i32::from(stub.external_leading), ppem, em),
    );
    put8(system, 0x0e, italic_byte);
    put8(system, 0x0f, stub.underline);
    put8(system, 0x10, stub.strike_out);
    put16(system, 0x11, i32::from(stub.weight));
    put8(system, 0x13, stub.char_set);
    put16(system, 0x14, 0);
    put16(system, 0x16, cell);
    put8(system, 0x18, stub.pitch_and_family);
    put16(system, 0x19, average);
    put16(
        system,
        0x1b,
        mul_div(i32::from(stub.max_width), ppem, across),
    );
    put8(system, 0x1d, stub.first_char);
    put8(system, 0x1e, stub.last_char);
    put8(system, 0x1f, stub.default_char);
    put8(system, 0x20, stub.break_char);
    put16(system, 0x27, 0x6e);
    put8(
        system,
        0x33,
        (if made { 4 } else { 0 }) | (if angle != 0 { 0x10 } else { 0 }) | 0x80,
    );
    put16(system, 0x48, angle);
    put16(system, 0x4a, scale);
    put16(system, 0x4c, ppem);

    // The face's name, the program's own spelling where it names the face
    // or its full name (seg3 `2c36`).
    let named =
        face.eq_ignore_ascii_case(&stub.family) || face.eq_ignore_ascii_case(&stub.full_name);
    let name: Vec<u8> = (if named {
        face.as_str()
    } else {
        stub.family.as_str()
    })
    .chars()
    .take(0x1f)
    .map(|ch| ch as u8)
    .collect();

    for offset in 0..0x20u32 {
        put8(
            system,
            0x6e + offset,
            name.get(offset as usize).copied().unwrap_or(0),
        );
    }

    if transform >> 16 != 0 {
        let mut xform = Vec::with_capacity(0x13);

        xform.extend((cell as u16).to_le_bytes());
        xform.extend((average as u16).to_le_bytes());
        xform.extend((angle as u16).to_le_bytes());
        xform.extend((angle as u16).to_le_bytes());
        xform.extend(stub.weight.to_le_bytes());
        xform.extend([
            italic_byte,
            stub.underline,
            stub.strike_out,
            0,
            0,
            0,
            0,
            0,
            0,
        ]);
        system.write_far(transform, &xform);
    }

    0x96
}

fn engine_realize_font_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let logfont = args.dword(system);
    let transform = args.dword(system);
    let font_info = args.dword(system);

    Ok(Answer::Dword(engine_realize_font(
        system, logfont, transform, font_info,
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
