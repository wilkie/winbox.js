//! GDI's questions about a TrueType font beside drawing it: `GetFontData`,
//! `GetKerningPairs`, `GetCharABCWidths` and `GetOutlineTextMetrics`. What
//! the engine reads out of the file is `winbox_raster::truetype_queries`;
//! this is GDI's part -- the device context, the pixel size, the character
//! set, the mapping. The TypeScript engine's twin is
//! `src/win16/gdi/outline-queries.ts`, where each function's read-out is
//! told.
//!
//! **Recorded** by `ttquery`: the TrueType faces Windows 3.1 installs at a
//! few sizes, into a window's device context and a memory one, and the
//! System font, a strike, which none of them answer for.

use std::collections::HashMap;

use winbox_raster::LogicalFont;
use winbox_raster::truetype_queries::{
    GDI_ERROR, font_data, kern_pair_count, kern_pairs, outline_metrics,
};

use crate::call::{Answer, Args, Stop};
use crate::fonts::text_metrics;
use crate::system::System;

use super::super::calls::mul_div;
use super::super::dc::dc_of;
use super::super::mapping::{MM_TEXT, Mapping, mapping_of};
use super::super::text_out::outline::glyph_outline;
use super::font_of;

/// The ANSI character set's codes, as GDI keeps them in its data segment
/// (seg48 `067e`): a character's UTF-16 code by the character, the C1
/// block's punctuation and 2219h for B7h, and nought for 1Fh, the character
/// the TrueType faces default to.
pub fn ansi_code(character: u8) -> u32 {
    match character {
        0x1f => 0,
        0x82 => 0x201a,
        0x83 => 0x0192,
        0x84 => 0x201e,
        0x85 => 0x2026,
        0x86 => 0x2020,
        0x87 => 0x2021,
        0x88 => 0x02c6,
        0x89 => 0x2030,
        0x8a => 0x0160,
        0x8b => 0x2039,
        0x8c => 0x0152,
        0x91 => 0x2018,
        0x92 => 0x2019,
        0x93 => 0x201c,
        0x94 => 0x201d,
        0x95 => 0x2022,
        0x96 => 0x2013,
        0x97 => 0x2014,
        0x98 => 0x02dc,
        0x99 => 0x2122,
        0x9a => 0x0161,
        0x9b => 0x203a,
        0x9c => 0x0153,
        0x9f => 0x0178,
        0xb7 => 0x2219,
        other => u32::from(other),
    }
}

/// A UTF-16 code as an ANSI character, as GDI turns one (seg1 `56a3`): the
/// first character whose code it is, or 1Fh where none has it.
pub fn ansi_of(code: u32) -> u8 {
    (0..=255u8)
        .find(|&character| ansi_code(character) == code)
        .unwrap_or(0x1f)
}

/// The outline face selected into a device context, with the context's
/// index; `None` for a strike, and for a handle that is no device
/// context's.
fn outline_of(system: &mut System, hdc: u16) -> Result<Option<(usize, LogicalFont)>, Stop> {
    let Some(index) = dc_of(system, hdc) else {
        return Ok(None);
    };

    Ok(font_of(system, index)?
        .filter(|font| font.outline.is_some())
        .map(|font| (index, font)))
}

/// A size in the device's pixels as a size in the device context's units,
/// across (seg1 `3b3a`) or down (`3b6e`): the distance between nought and
/// the size, each turned into logical units, and the size's own sign.
fn logical_size(m: &Mapping, value: i64, down: bool) -> i64 {
    let size = if down {
        (m.logical_y(value.abs()) - m.logical_y(0)).abs()
    } else {
        (m.logical_x(value.abs()) - m.logical_x(0)).abs()
    };

    if value < 0 { -size } else { size }
}

/// `GetFontData`: seg7 `0d98` and the engine's seg40 `0113`.
pub(crate) fn get_font_data_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let table = args.dword(system);
    let offset = args.dword(system);
    let buffer = args.dword(system);
    let size = args.dword(system);

    let Some((_, font)) = outline_of(system, hdc)? else {
        return Ok(Answer::Dword(GDI_ERROR));
    };
    let outline = font.outline.as_ref().expect("an outline face");
    let bytes = outline.font.data().bytes();
    let (answer, from) = font_data(bytes, table, offset, (buffer != 0).then_some(size));

    if answer != GDI_ERROR && buffer != 0 && answer != 0 {
        let end = (from + answer as usize).min(bytes.len());
        let read = bytes.get(from..end).unwrap_or(&[]).to_vec();

        system.write_far(buffer, &read);
    }

    Ok(Answer::Dword(answer))
}

/// `GetKerningPairs`: seg7 `1ccd` and `1d36`, the engine's seg36 `1420`.
pub(crate) fn get_kerning_pairs_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let wanted = args.signed(system);
    let far = args.dword(system);

    let Some((index, font)) = outline_of(system, hdc)? else {
        return Ok(Answer::Word(0));
    };
    let outline = font.outline.as_ref().expect("an outline face");

    if far == 0 {
        return Ok(Answer::Word(kern_pair_count(&outline.font) as u16));
    }

    let ppem = outline.ppem as i64;
    let units = outline.font.units_per_em() as i64;
    let m = mapping_of(system, index);
    let mut bytes = Vec::new();
    let mut kept = 0u16;

    for pair in kern_pairs(&outline.font)
        .into_iter()
        .take(usize::try_from(wanted).unwrap_or(0))
    {
        let first = if pair.first == 0 {
            0
        } else {
            ansi_of(pair.first)
        };
        let second = if pair.first == 0 || pair.second == 0 {
            0
        } else {
            ansi_of(pair.second)
        };

        if first == 0x1f || second == 0x1f {
            continue;
        }

        let amount = i64::from(pair.amount);
        let magnitude = (amount.abs() * ppem + (units >> 1)) / units;
        let mut scaled = if amount < 0 { -magnitude } else { magnitude } as i32;

        if m.mode != MM_TEXT {
            scaled = mul_div(scaled, m.wex as i32, m.vex as i32);
        }

        bytes.extend_from_slice(&u16::from(first).to_le_bytes());
        bytes.extend_from_slice(&u16::from(second).to_le_bytes());
        bytes.extend_from_slice(&(scaled as u16).to_le_bytes());
        kept += 1;
    }

    system.write_far(far, &bytes);

    Ok(Answer::Word(kept))
}

/// `GetCharABCWidths`: seg7 `195c` and `1af8`, with the realised font's
/// tables from seg3 `2fd8`; the font's first character, 1Eh, is the 0, 0, 8
/// the realisation writes (seg3 `3146`).
pub(crate) fn get_char_abc_widths_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    const FIRST: u32 = 0x1e;
    const LAST: u32 = 0xff;
    const DEFAULT: u32 = 0x1f;

    let hdc = args.word(system);
    let first = u32::from(args.word(system));
    let last = u32::from(args.word(system));
    let far = args.dword(system);

    let Some((index, font)) = outline_of(system, hdc)? else {
        return Ok(Answer::Word(0));
    };

    if first > last {
        return Ok(Answer::Word(0));
    }

    let m = mapping_of(system, index);
    let mapped = m.mode != MM_TEXT;
    let mut cache: HashMap<u32, [i64; 3]> = HashMap::new();
    let mut bytes = Vec::new();

    for character in first..=last {
        let code = if (FIRST..=LAST).contains(&character) {
            character
        } else {
            DEFAULT
        };
        let widths = if code == FIRST {
            [0, 0, 8]
        } else if let Some(known) = cache.get(&code) {
            *known
        } else {
            let glyph = glyph_outline(&font, code as u8)?;
            let (advance, origin, width) = glyph
                .as_ref()
                .map_or((0, 0, 0), |g| (g.advance, g.origin_x, g.width));
            let a = i64::from(origin as i8);
            let c = i64::from((advance - a - width) as i8);
            let known = [a, advance - a - c, c];

            cache.insert(code, known);
            known
        };

        for value in widths {
            let value = if mapped {
                logical_size(&m, value, false)
            } else {
                value
            };

            bytes.extend_from_slice(&(value as u16).to_le_bytes());
        }
    }

    system.write_far(far, &bytes);

    Ok(Answer::Word(1))
}

/// `GetOutlineTextMetrics`: seg7 `16ed`, with the engine's seg40 `0606`.
/// The filler byte is a byte of GDI's stack, whatever was there; nought
/// here.
pub(crate) fn get_outline_text_metrics_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let size_given = args.word(system);
    let far = args.dword(system);

    let Some((index, font)) = outline_of(system, hdc)? else {
        return Ok(Answer::Word(0));
    };
    let outline = font.outline.as_ref().expect("an outline face");
    let metrics = outline_metrics(&outline.font, u16::from(!outline.font.symbolic()));
    let names: Vec<Vec<u8>> = metrics
        .names
        .iter()
        .map(|codes| {
            let mut name: Vec<u8> = codes.iter().map(|&code| code as u8).collect();

            name.push(0);
            name
        })
        .collect();
    let size = 114 + names.iter().map(Vec::len).sum::<usize>();

    if far >> 16 == 0 {
        return Ok(Answer::Word(size as u16));
    }

    let tm = text_metrics(&font);
    let mut bytes = Vec::with_capacity(size + 1);
    let ppem = outline.ppem as i64;
    let units = i64::from(metrics.em_square);
    let half = units >> 1;

    bytes.extend_from_slice(&(((size + 1) & !1) as u16).to_le_bytes());
    bytes.extend_from_slice(&tm.bytes());
    bytes.push(0);
    bytes.extend_from_slice(&metrics.panose);

    for value in [
        metrics.fs_selection,
        metrics.fs_type,
        metrics.slope_rise as u16,
        metrics.slope_run as u16,
        metrics.italic_angle as u16,
        metrics.em_square,
    ] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    for value in metrics.scaled {
        let scaled = if units == 0 {
            0
        } else {
            (i64::from(value) * ppem + half) / units
        };

        bytes.extend_from_slice(&(scaled as u16).to_le_bytes());
    }

    let mut at = 114u16;

    for name in &names {
        bytes.extend_from_slice(&at.to_le_bytes());
        at += name.len() as u16;
    }

    for name in &names {
        bytes.extend_from_slice(name);
    }

    let count = usize::from(size_given).min(bytes.len());

    if mapping_of(system, index).mode != MM_TEXT {
        // Bit set, down: the box's left and right are across.
        let m = mapping_of(system, index);
        let mut left = i64::from(size_given) - 0x38;

        'groups: for (start, mask) in [(0x38usize, 0xf5fu16), (0x52, 0xfff)] {
            for i in 0..12 {
                left -= 2;

                if left < 0 {
                    break 'groups;
                }

                let offset = start + i * 2;

                if offset + 2 > count {
                    break 'groups;
                }

                let value = i64::from(i16::from_le_bytes([bytes[offset], bytes[offset + 1]]));
                let converted = logical_size(&m, value, (mask >> i) & 1 == 1) as u16;

                bytes[offset..offset + 2].copy_from_slice(&converted.to_le_bytes());
            }

            left -= 2;

            if left < 0 {
                break;
            }
        }
    }

    system.write_far(far, &bytes[..count]);

    Ok(Answer::Word(1))
}
