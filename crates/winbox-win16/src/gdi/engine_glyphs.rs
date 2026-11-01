//! GDI's TrueType engine as a printer's driver puts a font it realized to
//! work: `EngineSetFontContext`, `EngineGetGlyphBmp`, `EngineGetCharWidth`
//! and `EngineExtTextOut`, and the two the engine keeps beside them,
//! `EngineMakeFontDir` and `ConvertOutlineFontFile`. The twin of
//! `src/win16/gdi/engine-glyphs.ts`; the reading out of each is there.

use winbox_raster::logical_font::Outline;
use winbox_raster::{LogicalFont, Style};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::fonts::{FontManager, Request};
use crate::system::System;

use super::calls::mul_div;
use super::text::scalable::true_type_facts;
use super::text_out::outline::glyph_of;

/// The engine's context: the face and the transformation its glyphs are
/// made with, by what it was set for, and what setting it answered.
#[derive(Debug, Clone)]
pub struct EngineContext {
    key: String,
    answer: u32,
    font: Option<LogicalFont>,
    turn: f64,
    /// The transformation's matrix, `[m00, m01, m10, m11]` in pixels
    /// (`engine_matrix`).
    matrix: [i32; 4],
}

/// What the engine reads of a `FONTINFO` it realized (`GDI.EXE` seg3
/// `22b3`).
pub(crate) struct FontInfo {
    res_y: u16,
    res_x: u16,
    italic: u8,
    weight: u16,
    pix_width: u16,
    cell: u16,
    average: u16,
    first: u8,
    last: u8,
    default_char: u8,
    flags: u8,
    spot: [u16; 4],
    stretch: u16,
    em: u16,
    name: String,
}

const FAILED: u32 = 0xffff_ffff;

/// A far pointer `offset` bytes on, within its segment.
fn at(far: u32, offset: u16) -> u32 {
    (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(offset))
}

fn font_info_of(system: &System, far: u32) -> FontInfo {
    let bytes = system.read_far(far, 0x8e);
    let word = |offset: usize| u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
    let name = bytes[0x6e..0x8e]
        .iter()
        .take_while(|&&byte| byte != 0)
        .map(|&byte| char::from(byte))
        .collect();

    FontInfo {
        res_y: word(4),
        res_x: word(6),
        italic: bytes[0x0e],
        weight: word(0x11),
        pix_width: word(0x14),
        cell: word(0x16),
        average: word(0x19),
        first: bytes[0x1d],
        last: bytes[0x1e],
        default_char: bytes[0x1f],
        flags: bytes[0x33],
        spot: [word(0x40), word(0x42), word(0x44), word(0x46)],
        stretch: word(0x4a),
        em: word(0x4c),
        name,
    }
}

/// The face a `FONTINFO` stands for, at its em and resolutions, slanted
/// where GDI slants it and turned by the engine's angle (seg1
/// `6df7`-`6ff9`); found by its name at 6Eh, in the header's weight and
/// slant, where Windows finds it by its slot (3Ch). As `engineFont`.
fn engine_font(system: &mut System, info: &FontInfo, turn: u16) -> Option<LogicalFont> {
    let found = system
        .fonts()
        .outline(&info.name, info.weight > 550, info.italic != 0)?;
    let request = Request {
        face: info.name.clone(),
        height: -i32::from(info.em),
        width: if info.stretch == 0x100 {
            0
        } else {
            i32::from(info.average)
        },
        weight: i32::from(info.weight),
        italic: info.italic != 0,
        escapement: 0,
        log_pixels_x: i32::from(info.res_x),
        log_pixels_y: i32::from(info.res_y),
        ..Request::default()
    };
    let sized = FontManager::realise_outline(&found.font, &request)?;
    let or_96 = |value: u16| if value == 0 { 96.0 } else { f64::from(value) };

    Some(LogicalFont::of_outline(
        found.name,
        Style {
            weight: Some(i32::from(info.weight)),
            italic: Some(info.italic != 0),
            underline: Some(false),
            strikeout: Some(false),
            scale: None,
            horizontal: None,
            outline_family: true,
        },
        Outline {
            font: found.font,
            ppem: sized.ppem,
            x_ppem: sized.x_ppem,
            x_whole: sized.x_whole,
            x_base: sized.x_base,
            ascent: sized.ascent,
            descent: sized.descent,
            exact_style: found.exact,
            face_bold: found.face_bold,
            escapement: f64::from(turn),
            horizontal_res: or_96(info.res_x),
            vertical_res: or_96(info.res_y),
            bold_always: false,
        },
    ))
}

/// The engine's context set for a `FONTINFO` at an angle (`GDI.EXE` seg1
/// `6df7`), as `setContext`: nought with TrueType off; the last answer for
/// what the context last had; -1 where the face cannot be opened; nought.
pub(crate) fn set_context(system: &mut System, far: u32, angle: u16) -> u32 {
    if system.fonts().true_type_off {
        return 0;
    }

    let info = font_info_of(system, far);
    let key = [
        info.name.clone(),
        info.weight.to_string(),
        info.italic.to_string(),
        angle.to_string(),
        info.em.to_string(),
        info.res_y.to_string(),
        info.res_x.to_string(),
        (info.flags & 4).to_string(),
        info.stretch.to_string(),
        info.spot.map(|spot| spot.to_string()).join(","),
    ]
    .join(",");

    if let Some(kept) = &system.printing.drivers.engine
        && kept.key == key
    {
        return kept.answer;
    }

    let font = engine_font(system, &info, angle);
    let (key, answer) = if font.is_some() {
        (key, 0)
    } else {
        (String::new(), FAILED)
    };

    system.printing.drivers.engine = Some(EngineContext {
        key,
        answer,
        font,
        turn: f64::from(angle),
        matrix: engine_matrix(&info, angle),
    });
    answer
}

/// The matrix GDI hands the scaler for a `FONTINFO` at an angle (`GDI.EXE`
/// seg1 `6f22`-`6fce`), `[m00, m01, m10, m11]` in whole pixels, as
/// `engineMatrix`: the em times the cosine and sine; GDI's slant adding
/// 57h/100h of `m00` to `m10` and of `m01` to `m11`; a stretch scaling `m00`
/// and a `m01` that is not nought; differing resolutions scaling `m00` and a
/// `m10` that is not nought by their ratio, the half added to the low word
/// alone.
fn engine_matrix(info: &FontInfo, angle: u16) -> [i32; 4] {
    let word = |value: i32| i32::from(value as i16);
    let high = |product: i32| word(product.div_euclid(256));
    let em = i32::from(info.em);
    let cosine = sine_of(em, i32::from(angle), true);
    let sine = sine_of(em, i32::from(angle), false);
    let (mut m00, mut m01, mut m10, mut m11) = (cosine, sine, word(-sine), cosine);

    if info.flags & 4 != 0 {
        m10 = word(m10 + high(0x57 * m00));
        m11 = word(m11 + high(0x57 * m01));
    }

    if info.stretch != 0x100 {
        let stretch = i32::from(info.stretch as i16);

        m00 = high(stretch * m00);

        if m01 != 0 {
            m01 = high(stretch * m01);
        }
    }

    if info.res_x != info.res_y && info.res_y != 0 {
        let res_x = i32::from(info.res_x as i16);
        let res_y = i32::from(info.res_y);
        let across = |entry: i32| {
            let product = i64::from(entry * res_x);
            let low = (product + i64::from(res_y / 2)) & 0xffff;
            let dividend = product.div_euclid(0x10000) * 0x10000 + low;

            word((dividend / i64::from(res_y)) as i32)
        };

        m00 = across(m00);

        if m10 != 0 {
            m10 = across(m10);
        }
    }

    [m00, m01, m10, m11]
}

/// A character's glyph as the engine's context makes it at an angle, as
/// `engineGlyph`: `Surface.glyphOf` of the context's font, its advance the
/// scaler's where the context's matrix is not a plain upright scale;
/// `None` where the context has no face.
pub(crate) fn context_glyph(
    system: &System,
    code: u8,
    turn: u16,
) -> Result<Option<super::text_out::outline::GlyphOutline>, Stop> {
    let Some(context) = system.printing.drivers.engine.as_ref() else {
        return Ok(None);
    };
    let Some(font) = context.font.as_ref() else {
        return Ok(None);
    };
    let Some(mut glyph) = glyph_of(font, code, f64::from(turn))? else {
        return Ok(None);
    };

    if let Some((across, up)) = engine_advance(context, u32::from(code)) {
        glyph.advance_x = across;
        glyph.advance_y = up;
    }

    Ok(Some(glyph))
}

/// The advance of a glyph made through a matrix that is not a plain upright
/// scale, as the scaler makes it (`GDI.EXE` seg36 `0796`, `103b`, `1f46`,
/// `3ff9`, `6ebb`, `4bb2`, `4882`), as `engineAdvance`: `None` for one that
/// is. The phantoms scaled at each row's stretch, rounded to pixels where
/// `prep` leaves the program to run, turned by the entries over the
/// stretch, differenced and each half rounded.
fn engine_advance(context: &EngineContext, code: u32) -> Option<(i64, i64)> {
    let [m00, m01, m10, m11] = context.matrix;
    let outline = context.font.as_ref()?.outline.as_ref()?;

    if m01 == 0 && m10 == 0 && m00 == m11 && m00 > 0 {
        return None;
    }

    let font = &outline.font;
    let glyph = font.glyph_for(code);
    let stretch_x = m00.abs().max(m01.abs());
    let stretch_y = m10.abs().max(m11.abs());

    if stretch_x == 0 || stretch_y == 0 {
        return None;
    }

    let rotated = !(m00 == 0 && m11 == 0) && (m01 != 0 || m10 != 0);
    let units = font.units_per_em() as i64;
    let shift = font.bearing_shift(glyph).unwrap_or(0.0) as i64;
    let wide = f64::from(stretch_x) / f64::from(stretch_y);
    let scale = engine_scaler(i64::from(stretch_x), units);
    let mut origin = scale(-shift);
    let mut advance = scale(font.advance_of(glyph) as i64 - shift);

    if font
        .prep_grid_fit(f64::from(stretch_y), wide, rotated)
        .unwrap_or(false)
    {
        let grid = |value: i64| (value + 32).div_euclid(64) * 64;
        let fitted = font
            .hinted_outline(glyph, f64::from(stretch_y), true, wide, rotated)
            .ok();

        origin = grid(origin);
        advance = match fitted {
            Some(fitted) if fitted.hinted => origin + fitted.advance.unwrap_or(0.0) as i64,
            _ => grid(advance),
        };
    }

    let across = fix_div(i64::from(m00), i64::from(stretch_x));
    let up = fix_div(i64::from(m01), i64::from(stretch_x));
    let whole = |value: i64| (value * 1024 + 0x8000).div_euclid(0x10000);

    Some((
        whole(fix_mul(advance, across) - fix_mul(origin, across)),
        whole(fix_mul(advance, up) - fix_mul(origin, up)),
    ))
}

/// Design units into sixty-fourths at a stretch, as `3f55` reduces the
/// ratio, as `engineScaler`: a power of two shifts with a half up (`3e5e`),
/// otherwise it divides with a half away from nought (`3e80`).
fn engine_scaler(stretch: i64, units_per_em: i64) -> impl Fn(i64) -> i64 {
    let mut multiplier = stretch * 64;
    let mut divisor = units_per_em.max(1);

    while multiplier % 2 == 0 && divisor % 2 == 0 {
        multiplier /= 2;
        divisor /= 2;
    }

    let shifted = divisor & (divisor - 1) == 0;

    move |value: i64| {
        if shifted || value >= 0 {
            (value * multiplier + divisor / 2).div_euclid(divisor)
        } else {
            -((-value * multiplier + divisor / 2).div_euclid(divisor))
        }
    }
}

/// `FixDiv` of two whole numbers (seg36 `0270`), as `fixDiv`.
fn fix_div(numerator: i64, denominator: i64) -> i64 {
    numerator.signum()
        * denominator.signum()
        * ((numerator.abs() * 65536 + denominator.abs() / 2) / denominator.abs())
}

/// `FixMul` (seg36 `0200`), as `fixMul`.
fn fix_mul(value: i64, factor: i64) -> i64 {
    (value * factor + 32768).div_euclid(65536)
}

fn engine_set_font_context_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let angle = args.word(system);

    Ok(Answer::Dword(set_context(system, far, angle)))
}

/// `EngineGetGlyphBmp` (`GDI.EXE` seg7 `09e9`), as in `engine-glyphs.ts`.
fn engine_get_glyph_bmp_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let font_info = args.dword(system);
    let character = args.word(system);
    let format = args.word(system);
    let buffer = args.dword(system);
    let size_given = args.dword(system);
    let metrics = args.dword(system);
    let put_metrics = |system: &mut System, values: [u32; 6]| {
        let bytes: Vec<u8> = values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();

        system.write_far(metrics, &bytes);
    };
    let failed = |system: &mut System| {
        if metrics >> 16 != 0 {
            put_metrics(system, [0; 6]);
        }

        Ok(Answer::Dword(FAILED))
    };
    let context = system.printing.drivers.engine.clone();
    let font = context.as_ref().and_then(|context| context.font.as_ref());

    if system.fonts().true_type_off || format > 1 || font_info == 0 {
        return failed(system);
    }

    let (Some(_), Some(context)) = (font, context.as_ref()) else {
        return failed(system);
    };
    let Some(glyph) = context_glyph(system, character as u8, context.turn as u16)? else {
        return failed(system);
    };

    if metrics >> 16 != 0 {
        let fixed = |value: i64| (value as i32 as u32) << 16;

        put_metrics(
            system,
            [
                glyph.width as u32,
                glyph.height as u32,
                fixed(glyph.origin_x),
                fixed(glyph.origin_y),
                fixed(glyph.advance_x),
                fixed(glyph.advance_y),
            ],
        );
    }

    if format == 0 {
        return Ok(Answer::Dword(0));
    }

    let stride = ((glyph.width + 31) >> 5) * 4;
    let size = (stride * glyph.height) as u32;

    if buffer >> 16 == 0 || size_given == 0 {
        return Ok(Answer::Dword(size));
    }

    let bytes: Vec<u8> = (0..size.min(size_given))
        .map(|offset| {
            let offset = i64::from(offset);
            let row = &glyph.rows[(offset / stride) as usize];
            let first = ((offset % stride) * 8) as usize;

            (0..8).fold(0u8, |value, bit| {
                (value << 1) | row.get(first + bit).copied().unwrap_or(0)
            })
        })
        .collect();

    for (offset, byte) in bytes.iter().enumerate() {
        system.write_far(at(buffer, offset as u16), &[*byte]);
    }

    Ok(Answer::Dword(size))
}

/// A `FONTINFO`'s widths, filled as GDI fills them the first time they are
/// asked for (`GDI.EXE` seg1 `6d04`-`6ddf`), as `widthsOf`: the font they
/// are the engine's of, or `None`.
pub(crate) fn widths_of(system: &mut System, far: u32) -> Option<(LogicalFont, FontInfo)> {
    let flags_at = at(far, 0x33);
    let mut flags = system.read_far(flags_at, 1)[0];

    if flags & 1 == 0 {
        flags = (flags & !3) | 1;

        if set_context(system, far, 0) == FAILED {
            flags |= 0x40;
        }

        system.write_far(flags_at, &[flags]);
    }

    if flags & 0x40 != 0 {
        return None;
    }

    let info = font_info_of(system, far);

    engine_font(system, &info, 0).map(|font| (font, info))
}

/// A character's width as `widths_of` fills them: the first character's
/// 8, one outside the font its default character's, a font of fixed pitch
/// all its width.
pub(crate) fn width_of(font: &LogicalFont, info: &FontInfo, code: u16) -> Result<u16, Stop> {
    if info.pix_width != 0 {
        return Ok(info.pix_width);
    }

    let code = if code < u16::from(info.first) || code > u16::from(info.last) {
        u16::from(info.first) + u16::from(info.default_char)
    } else {
        code
    };

    if code == u16::from(info.first) {
        return Ok(8);
    }

    font.outline_advance(u32::from(code))
        .map(|advance| advance as i64 as u16)
        .map_err(super::text::unreadable)
}

/// `EngineGetCharWidth` (`GDI.EXE` seg3 `2c8a`, into `2662`), as in
/// `engine-glyphs.ts`.
fn engine_get_char_width_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let first = args.word(system);
    let last = args.word(system);
    let out = args.dword(system);

    if far >> 16 == 0 || last < first {
        return Ok(Answer::Word(0));
    }

    let Some((font, info)) = widths_of(system, far) else {
        return Ok(Answer::Word(0));
    };

    for code in first..=last {
        let width = width_of(&font, &info, code)?;

        system.write_far(
            at(out, (code - first).wrapping_mul(2)),
            &width.to_le_bytes(),
        );
    }

    Ok(Answer::Word(1))
}

/// `EngineExtTextOut` (`GDI.EXE` seg1 `669a`), as in `engine-glyphs.ts`:
/// a negative count's extent; nought for the rest.
/// `EngineExtTextOut`: a negative count measured here, any other drawn
/// (`engine_text.rs`).
fn engine_ext_text_out_any(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let given = {
            let system = engine.system();
            let mut peek = args;

            super::engine_text::EngineTextArgs {
                hdc: peek.word(&system),
                device: peek.dword(&system),
                x: peek.word(&system) as i16,
                y: peek.word(&system) as i16,
                clip: peek.dword(&system),
                string: peek.dword(&system),
                count: peek.word(&system) as i16,
                font: peek.dword(&system),
                draw_mode: peek.dword(&system),
                xform: peek.dword(&system),
                widths: peek.dword(&system),
                opaque: peek.dword(&system),
                options: peek.word(&system),
                dc: None,
            }
        };

        if given.count < 0 || given.font >> 16 == 0 {
            let mut args = args;

            return engine_ext_text_out_call(&mut engine.system(), &mut args);
        }

        super::engine_text::draw_engine_text(engine, given).await
    })
}

fn engine_ext_text_out_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    args.dword(system);
    args.word(system);
    args.word(system);
    args.dword(system);

    let string = args.dword(system);
    let count = args.word(system) as i16;
    let far = args.dword(system);

    if count >= 0 || far >> 16 == 0 {
        return Ok(Answer::Dword(0));
    }

    let Some((font, info)) = widths_of(system, far) else {
        return Ok(Answer::Dword(0x8000_0000));
    };
    let index = super::dc::dc_of(system, hdc);
    let extra = index.map_or(0, |index| {
        i64::from(system.gdi.dcs[index].state.char_extra as i16)
    });
    let text: Vec<u8> = (0..count.unsigned_abs())
        .map(|offset| system.read_far(at(string, offset), 1)[0])
        .collect();
    let mut across: i64 = 0;

    for &code in &text {
        across += i64::from(width_of(&font, &info, u16::from(code))?) + extra;
    }

    if let Some(index) = index
        && let Some(selected) = super::text::font_of(system, index)?
    {
        across += super::text::justified_extent(system, index, &selected, &text);
    }

    let down = u32::from(info.cell);

    Ok(Answer::Dword(
        (across.min(0x7fff) as u32 & 0xffff) | (down << 16),
    ))
}

/// The copyright GDI writes in every entry, and the four bytes it keeps
/// after its nought (seg7 `1151`, `116c`).
const COPYRIGHT: &[u8] = b"Windows! Windows! Windows!";
const AFTER_COPYRIGHT: [u8; 4] = [0x10, 0x03, 0x01, 0x01];

/// Where the names start in an entry (seg7 `13a6`).
const NAMES: u16 = 0x76;

const PANOSE_SCRIPT: u8 = 3;
const PANOSE_DECORATIVE: u8 = 4;
const PANOSE_PICTORIAL: u8 = 5;
const PANOSE_MONOSPACED: u8 = 9;
const FF_DONTCARE: u8 = 0x00;
const FF_ROMAN: u8 = 0x10;
const FF_SWISS: u8 = 0x20;
const FF_MODERN: u8 = 0x30;
const FF_SCRIPT: u8 = 0x40;
const FF_DECORATIVE: u8 = 0x50;
const ANSI_CHARSET: u8 = 0;
const SYMBOL_CHARSET: u8 = 2;

/// `EngineMakeFontDir` (`GDI.EXE` seg7 `1184`), as in `engine-glyphs.ts`.
// Each piece of the entry in turn, as GDI writes them.
#[allow(clippy::too_many_lines)]
fn engine_make_font_dir_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hidden = args.word(system);
    let out = args.dword(system);
    let path_far = args.dword(system);

    if system.fonts().true_type_off || path_far == 0 {
        return Ok(Answer::Dword(FAILED));
    }

    let path: String = system
        .read_string(path_far)
        .iter()
        .map(|&byte| char::from(byte))
        .collect();
    let Some(source) = system.files.open(&path) else {
        return Ok(Answer::Dword(FAILED));
    };
    let ttf = match system.files.resolve(source) {
        Some(file) => {
            let size = file.size() as usize;

            file.read(size)
        }
        None => return Ok(Answer::Dword(FAILED)),
    };

    system.files.close(source);

    let facts = true_type_facts(&ttf);
    let put = |system: &mut System, offset: u16, bytes: &[u8]| {
        for (index, byte) in bytes.iter().enumerate() {
            system.write_far(at(out, offset.wrapping_add(index as u16)), &[*byte]);
        }
    };
    let put16 = |system: &mut System, offset: u16, value: u16| {
        put(system, offset, &value.to_le_bytes());
    };
    let put_text = |system: &mut System, offset: u16, text: &[u8]| {
        put(system, offset, text);
        put(system, offset + text.len() as u16, &[0]);
        offset + text.len() as u16 + 1
    };
    let units = |text: &[u16]| -> Vec<u8> { text.iter().map(|&unit| unit as u8).collect() };

    // The entry's head as GDI keeps it (seg7 `1147`).
    put16(system, 0, 1);
    put16(system, 2, 0);
    put16(system, 4, 0x200);
    put16(system, 6, 0x95);
    put16(system, 8, 0);
    put_text(system, 0x0a, COPYRIGHT);
    put(system, 0x25, &AFTER_COPYRIGHT);

    let panose = &facts.panose;
    let selection = facts.selection;
    let monospaced = panose[3] == PANOSE_MONOSPACED;
    let family_bits = if panose[0] == PANOSE_SCRIPT {
        FF_SCRIPT
    } else if panose[0] == PANOSE_DECORATIVE {
        FF_DECORATIVE
    } else if monospaced {
        FF_MODERN
    } else if panose[1] >= 11 {
        FF_SWISS
    } else if panose[1] >= 2 {
        FF_ROMAN
    } else {
        FF_DONTCARE
    };
    let cell = facts.ascender.wrapping_sub(facts.descender) as u16;
    let (mut first, mut last, mut offset) = (facts.first_char, facts.last_char, 0u16);
    let mut char_set = if panose[0] == PANOSE_PICTORIAL {
        SYMBOL_CHARSET
    } else {
        ANSI_CHARSET
    };

    if last > 0xff && first > 0xff {
        char_set = SYMBOL_CHARSET;
        last = (last - first).min(0xdf) + 0x20;
        offset = first - 0x20;
        first = 0x20;
    } else {
        last = last.min(0xff);
        first = first.max(0x20);
    }

    let flag = |bit: u16| if selection & bit != 0 { 0xff } else { 0 };
    let weight = if facts.weight <= 9 {
        facts.weight * 100
    } else {
        facts.weight
    };

    put(
        system,
        0x46,
        &[3 | if hidden != 0 { 0x80 } else { 0 }, selection as u8],
    );
    put16(system, 0x48, facts.units_per_em);
    put16(system, 0x4a, 72);
    put16(system, 0x4c, 72);
    put16(system, 0x4e, facts.ascender as u16);
    put16(system, 0x50, cell.wrapping_sub(facts.units_per_em));
    put16(system, 0x52, facts.line_gap.max(0) as u16);
    put(system, 0x54, &[flag(1), flag(2), flag(0x10)]);
    put16(system, 0x57, weight);
    put(system, 0x59, &[char_set]);
    put16(system, 0x5a, 0);
    put16(system, 0x5c, cell);
    put(system, 0x5e, &[(family_bits + u8::from(!monospaced)) | 6]);
    put16(system, 0x5f, facts.average_width as u16);
    put16(system, 0x61, facts.x_max.wrapping_sub(facts.x_min) as u16);
    put(system, 0x63, &[(first - 2) as u8, last as u8, 1, 2]);
    put16(system, 0x6d, (out as u16).wrapping_add(NAMES));
    put16(system, 0x71, facts.lowest_rec_ppem);
    put16(system, 0x73, offset);

    let end = put_text(system, NAMES, &units(&facts.face));
    let end = put_text(system, end, &units(&facts.family));
    let end = put_text(system, end, &units(&facts.style));

    Ok(Answer::Dword(u32::from(end)))
}

/// `ConvertOutlineFontFile` (`GDI.EXE` seg7 `0d8a`): nothing done, and GDI's
/// own data segment answered.
fn convert_outline_font_file_call(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(super::text::enumerate::gdi_data_selector(
        system,
    )))
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "EngineSetFontContext" => Implementation::Sync(engine_set_font_context_call),
        "EngineGetGlyphBmp" => Implementation::Sync(engine_get_glyph_bmp_call),
        "EngineGetCharWidth" => Implementation::Sync(engine_get_char_width_call),
        "EngineExtTextOut" => Implementation::Async(engine_ext_text_out_any),
        "EngineMakeFontDir" => Implementation::Sync(engine_make_font_dir_call),
        "ConvertOutlineFontFile" => Implementation::Sync(convert_outline_font_file_call),
        _ => return None,
    })
}

/// The sine of each whole degree to 90, times 10000 (seg33 `0000`).
const SINES: [i32; 91] = [
    0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756,
    2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299,
    5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431,
    7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988,
    9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848,
    9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000,
];

/// `value` times the sine, or the cosine, of an angle in tenths of a
/// degree, from GDI's table (seg33 `00b6`, `00fb`, `013f`).
pub(crate) fn sine_of(value: i32, angle: i32, cosine: bool) -> i32 {
    let a = if angle < 0 {
        3600 - (-angle % 3600)
    } else {
        angle % 3600
    };
    let (tenths, negative) = if cosine {
        if a <= 900 {
            (900 - a, false)
        } else if a <= 1800 {
            (a - 900, true)
        } else if a < 2700 {
            (2700 - a, true)
        } else {
            (a - 2700, false)
        }
    } else if a <= 900 {
        (a, false)
    } else if a <= 1800 {
        (1800 - a, false)
    } else if a <= 2700 {
        (a - 1800, true)
    } else {
        (3600 - a, true)
    };
    let degree = (tenths / 10) as usize;
    let low = SINES[degree];
    let high = SINES.get(degree + 1).copied().unwrap_or(low);
    let sine = low + mul_div(tenths % 10, high - low, 10);
    let product = mul_div(value, sine, 10000);

    if negative { -product } else { product }
}
