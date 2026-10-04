//! `GetGlyphOutline`: one character of the selected outline face, as
//! `TextOut` would draw it upright at the realised font's size, hinted --
//! the font's escapement does not turn it and a bold GDI synthesises does
//! not smear it (`text_out::outline::glyph_outline`). Only a TrueType font
//! has an answer; for a strike the call fails, which is what Windows does
//! for Symbol at sixteen pixels upright, where the mapper hands out a bitmap
//! face.
//!
//! `GGO_METRICS` fills the metrics alone and `GGO_BITMAP` the bitmap as
//! well: one bit a pixel, the top row first, each row padded to a
//! doubleword, the answer the bitmap's size. `GGO_NATIVE` -- the outline as
//! curves -- is not implemented in the TypeScript engine and fails, and so
//! it does here. The matrix is read but only the identity has been
//! recorded, and it is what is drawn.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

use super::super::dc::dc_of;
use super::super::text_out::outline::glyph_outline;
use super::font_of;

/// What the call answers when it has no answer.
const FAILED: u32 = 0xffff_ffff;

pub(crate) fn get_glyph_outline_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let character = args.word(system);
    let format = args.word(system);
    let metrics = args.dword(system);
    let size = args.dword(system);
    let buffer = args.dword(system);

    args.dword(system);

    let font = match dc_of(system, hdc) {
        Some(index) => font_of(system, index)?,
        None => None,
    };
    let glyph = match &font {
        Some(font) => glyph_outline(font, (character & 0xff) as u8)?,
        None => None,
    };

    let Some(glyph) = glyph.filter(|_| format <= 1) else {
        return Ok(Answer::Dword(FAILED));
    };

    // A `GLYPHMETRICS`: the black box across and down, its corner from the
    // character's origin, and how far the origin moves.
    if metrics != 0 {
        let mut bytes = Vec::with_capacity(12);

        for value in [
            glyph.width,
            glyph.height,
            glyph.origin_x,
            glyph.origin_y,
            glyph.advance,
            0,
        ] {
            bytes.extend_from_slice(&(value as u16).to_le_bytes());
        }

        system.write_far(metrics, &bytes);
    }

    if format == 0 {
        return Ok(Answer::Dword(0));
    }

    let stride = ((glyph.width + 31) >> 5) * 4;
    let needed = stride * glyph.height;

    if size == 0 || buffer == 0 {
        return Ok(Answer::Dword(needed as u32));
    }

    let bytes: Vec<u8> = (0..needed.min(i64::from(size)))
        .map(|at| {
            let row = &glyph.rows[(at / stride) as usize];
            let first = ((at % stride) * 8) as usize;

            (0..8).fold(0u8, |byte, bit| {
                (byte << 1) | row.get(first + bit).copied().unwrap_or(0)
            })
        })
        .collect();

    system.write_far(buffer, &bytes);

    Ok(Answer::Dword(needed as u32))
}
