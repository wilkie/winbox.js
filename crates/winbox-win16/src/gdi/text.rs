//! GDI's questions about text in a device context's font: its metrics, its
//! face's name, each character's width, how much room a string takes, and
//! the justification that spreads extra room over a line's breaks -- and
//! USER's two that ask GDI's: a tabbed string's extent and the dialog base
//! units.
//!
//! The font is the one selected, realised as the TypeScript engine realises
//! it: a stock font as its face's nearest strike to its cell, a made one as
//! the mapper answered it. No outline face is realised here (see `fonts`),
//! so every branch the TypeScript engine takes for a TrueType font is left
//! out, and with it the scaling a turned outline's length takes on a pixel
//! that is not square (`turnedLength`). A made font that an outline may
//! have answered in the TypeScript engine is not measured at all: the calls
//! that would tell a program what it is stop instead (see `realised`).
//!
//! `AddFontResource` and `RemoveFontResource` are stubs in the TypeScript
//! engine, and answered as its stubs are.
//!
//! A handle that stands for something other than a device context is
//! answered as no device context is, as `dc.rs` answers one. Where the
//! TypeScript engine would throw -- measuring with no device context, or
//! with no font, or writing to a structure that is not there -- this stops.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

pub mod enumerate;

use winbox_raster::logical_font::round;
use winbox_raster::{LogicalFont, Measure};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::fonts::{Device, Request, TextMetric, text_metrics};
use crate::handles::Object;
use crate::system::System;

use super::dc::dc_of;
use super::mapping::{mapping_of, scale};
use super::objects::{Font, GdiObject, SYSTEM_FONT, stock_font_handle};
use super::pack;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "GetTextMetrics" => Implementation::Sync(get_text_metrics_call),
        "GetTextExtent" => Implementation::Sync(get_text_extent_call),
        "GetTextExtentPoint" => Implementation::Sync(get_text_extent_point_call),
        "GetTextFace" => Implementation::Sync(get_text_face_call),
        "GetCharWidth" => Implementation::Sync(get_char_width_call),
        "SetTextJustification" => Implementation::Sync(set_text_justification_call),
        "EnumFonts" | "EnumFontFamilies" => Implementation::Async(enumerate::enum_font_families),
        _ => return None,
    })
}

/// USER's calls that measure with GDI's.
pub fn user_implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "GetTabbedTextExtent" => Implementation::Sync(get_tabbed_text_extent_call),
        "GetDialogBaseUnits" => Implementation::Sync(get_dialog_base_units_call),
        _ => return None,
    })
}

/// A font object realised, as it is drawn and measured: a stock font as
/// its face's nearest strike to its cell (`stockFontHandle`), which is
/// realised afresh each time and comes to the same strike; a made font as
/// the mapper answered it. `None` for a stock face not installed.
///
/// A made font that an outline may have answered in the TypeScript engine
/// stops: what it measures is not known here (see
/// `FontManager::outline_may_answer`).
pub fn realised(system: &mut System, object: usize) -> Result<Option<LogicalFont>, Stop> {
    match &system.gdi.objects[object] {
        GdiObject::Font(Font::Stock { face, cell }) => {
            let (face, cell) = (*face, i32::from(*cell));

            Ok(system.fonts().realize(face, cell))
        }
        GdiObject::Font(Font::Made { font, logfont }) => {
            let font = (**font).clone();
            let request = Request::new(logfont, &Device::of(&system.display));

            if system.fonts().outline_may_answer(&request) {
                return Err(Stop::Unsupported("a font an outline may answer"));
            }

            Ok(Some(font))
        }
        _ => Ok(None),
    }
}

/// The font selected into a device context, by the context's index.
pub fn font_of(system: &mut System, index: usize) -> Result<Option<LogicalFont>, Stop> {
    let Some(object) = system.gdi.dcs[index].state.font else {
        return Ok(None);
    };

    realised(system, object)
}

/// The text metrics of a device context's font: `None` for no device
/// context, and an answer of `None` for a context with no font.
pub fn get_text_metrics(system: &mut System, hdc: u16) -> Result<Option<Option<TextMetric>>, Stop> {
    let Some(index) = dc_of(system, hdc) else {
        return Ok(None);
    };

    Ok(Some(
        font_of(system, index)?.map(|font| text_metrics(&font)),
    ))
}

/// `GetTextMetrics`: the `TEXTMETRIC` of the font selected, written where
/// the program asked; nought for no device context. A context with no font
/// answers 1 and writes nothing, as the TypeScript engine's does.
fn get_text_metrics_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let Some(metrics) = get_text_metrics(system, hdc)? else {
        return Ok(Answer::Word(0));
    };

    if let Some(metrics) = metrics {
        if far >> 16 == 0 {
            return Err(Stop::Unsupported("GetTextMetrics into no structure"));
        }

        system.write_far(far, &metrics.bytes());
    }

    Ok(Answer::Word(1))
}

/// What `SetTextJustification` keeps in a device context: the extra each
/// break gets, the remainder spread over them, how many there are, and the
/// error term that spreads it.
///
/// **Read out** of `GDI.EXE` (seg1 `0fef`, `6bb3`, `374d`, `3bcf`, `6a65`)
/// and `VGA.DRV` (seg2 `0462`, `0542`, `0c3c`, `0c82`), and **recorded** by
/// `justify`, MS Sans Serif and Arial with extras over one to three breaks,
/// uneven, negative, with character extra, a line in two parts and
/// `ExtTextOut`'s own spacing:
///
/// * The extra is divided by the count, truncating: each break gets that,
///   and the remainder, with the extra's sign, is spread by an error term
///   that starts at `count >> 1` plus one. A positive remainder comes off the
///   term at each break, and where the term reaches nought the break gets one
///   pixel more and the count goes back on.
/// * A negative remainder: GDI, which draws the plotter fonts, adds it to the
///   term and takes a pixel off where the term reaches nought, so -3 over 2
///   is -1 and -2. The display driver, which draws the bitmap fonts, takes it
///   off the term, which only grows it, and takes a pixel off where the term
///   is nought or more, so -3 over 2 is -2 and -2.
/// * A break is the font's break character: a character outside the font is
///   its default character first.
/// * The term is kept in the device context. A bitmap font's
///   `GetTextExtent` does not move it on; a plotter font's moves it on once.
///
/// Not followed, as the TypeScript engine does not: an extra with a count of
/// nought, which divides by nought in GDI; GDI keeping a negative advance
/// from going below nought.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Justification {
    pub extra: i32,
    pub rem: i32,
    pub count: i32,
    pub err: i32,
}

impl Justification {
    /// One break's extra, the error term moved on.
    fn step(&mut self, gdi: bool) -> i32 {
        let mut extra = self.extra;

        if self.rem > 0 {
            self.err -= self.rem;

            if self.err <= 0 {
                self.err += self.count;
                extra += 1;
            }
        } else if self.rem < 0 {
            if gdi {
                self.err += self.rem;

                if self.err <= 0 {
                    self.err += self.count;
                    extra -= 1;
                }
            } else {
                self.err -= self.rem;

                if self.err >= 0 {
                    self.err -= self.count;
                    extra -= 1;
                }
            }
        }

        extra
    }
}

/// Whether a character is the font's break character: a space, for a font
/// GDI draws itself -- a plotter font -- and else the strike's own, a
/// character it has not standing for its default.
fn is_break(font: &LogicalFont, code: u8) -> bool {
    if font.is_vector() {
        return code == 32;
    }

    let header = &font.entry.header;
    let first = i32::from(header.first_char);
    let last = i32::from(header.last_char);
    let code = i32::from(code);
    let character = if code < first || code > last {
        i32::from(header.default_char) + first
    } else {
        code
    };

    character - first == i32::from(header.break_char)
}

/// What justification adds to a string's extent, the term moved on as
/// measuring moves it: not at all for a bitmap font, once over the string
/// for a font GDI draws.
fn justified_extent(system: &mut System, index: usize, font: &LogicalFont, text: &[u8]) -> i64 {
    let Some(state) = system.gdi.dcs[index].state.justification else {
        return 0;
    };

    if state.extra == 0 && state.rem == 0 {
        return 0;
    }

    let gdi = font.is_vector();
    let mut measured = state;
    let added: i64 = text
        .iter()
        .filter(|&&code| is_break(font, code))
        .map(|_| i64::from(measured.step(gdi)))
        .sum();

    if gdi {
        system.gdi.dcs[index].state.justification = Some(measured);
    }

    added
}

/// Sets the extra to spread over the break characters of the text drawn
/// next, in logical units, and the count of breaks to spread it over. A
/// count of nought turns it off. 1, or nought for no device context.
pub fn set_text_justification(system: &mut System, hdc: u16, extra: i16, count: i16) -> u16 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let mapping = mapping_of(system, index);
    let total = mapping.device_x(i64::from(extra)) - mapping.device_x(0);
    let count = i64::from(count);

    system.gdi.dcs[index].state.justification = (count != 0).then(|| Justification {
        extra: (total / count) as i32,
        rem: (total % count) as i32,
        count: count as i32,
        err: ((count >> 1) + 1) as i32,
    });

    1
}

fn set_text_justification_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let extra = args.signed(system);
    let count = args.signed(system);

    Ok(Answer::Word(set_text_justification(
        system, hdc, extra, count,
    )))
}

/// A string as a JavaScript string's `slice(0, count)` takes it: a negative
/// count counts back from its end.
fn sliced(text: &[u8], count: i32) -> &[u8] {
    let length = text.len() as i64;
    let count = i64::from(count);
    let end = if count < 0 {
        (length + count).max(0)
    } else {
        count.min(length)
    };

    &text[..end as usize]
}

/// The width and height of a line of text in a device context's font, in
/// its logical units: the font's measure of it, the character extra after
/// every character, and the justification -- **recorded** by `justify`,
/// "a b c" with an extra of one measuring five more. Under a mapping mode
/// the device's extent is scaled by the extents' sizes, whichever way an
/// axis runs: **recorded** by `fillext`, 77 by 16 on the VGA being 250 by 52
/// in `MM_LOMETRIC`. Width in the low word.
///
/// The string is what the program's pointer reads to its nought, cut to
/// `count` as the TypeScript engine cuts it. The clip region does not come
/// into it.
pub fn get_text_extent(
    system: &mut System,
    hdc: u16,
    text: &[u8],
    count: i32,
) -> Result<u32, Stop> {
    let Some(index) = dc_of(system, hdc) else {
        return Err(Stop::Unsupported("GetTextExtent with no device context"));
    };
    let Some(font) = font_of(system, index)? else {
        return Err(Stop::Unsupported("GetTextExtent with no font"));
    };
    let text = sliced(text, count);
    let (width, height) = font.measure(text, Measure::default());
    let extra = i64::from(system.gdi.dcs[index].state.char_extra as i16);
    let width =
        width as i64 + extra * text.len() as i64 + justified_extent(system, index, &font, text);
    let height = height as i64;
    let mapping = mapping_of(system, index);
    let (across, down) = if mapping.is_identity() {
        (width, height)
    } else {
        (
            scale(width, mapping.wex.abs(), mapping.vex.abs()),
            scale(height, mapping.wey.abs(), mapping.vey.abs()),
        )
    };

    Ok(pack(across, down))
}

/// A string argument as the TypeScript engine reads one: a string that
/// cannot be read to its nought turns the call away, answering nought
/// (**recorded** by `badarg`). A null pointer is none there, and one whose
/// segment is nought a number, which no measuring call can take.
pub(crate) enum Text {
    Read(Vec<u8>),
    Refused,
    Absent,
}

pub(crate) fn text_argument(system: &System, far: u32) -> Text {
    if far >> 16 == 0 {
        Text::Absent
    } else if !system.readable_string(far) {
        Text::Refused
    } else {
        Text::Read(system.read_string(far))
    }
}

fn get_text_extent_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let count = args.signed(system);
    let text = match text_argument(system, far) {
        Text::Read(text) => text,
        Text::Refused => return Ok(Answer::Dword(0)),
        Text::Absent => return Err(Stop::Unsupported("GetTextExtent of no string")),
    };

    Ok(Answer::Dword(get_text_extent(
        system,
        hdc,
        &text,
        i32::from(count),
    )?))
}

/// `GetTextExtent`'s width and height, written to a `SIZE`: **recorded** by
/// `fillext`, the same two numbers for each string, in logical units under
/// a mapping mode, and nought and nought for an empty one; it answers 1.
/// Nought for a handle that stands for nothing.
fn get_text_extent_point_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let count = args.signed(system);
    let size = args.dword(system);
    let text = text_argument(system, far);

    if matches!(text, Text::Refused) || system.handles.resolve(hdc).is_none() {
        return Ok(Answer::Word(0));
    }

    let (Text::Read(text), true) = (text, size >> 16 != 0) else {
        return Err(Stop::Unsupported(
            "GetTextExtentPoint of no string or into no SIZE",
        ));
    };
    let both = get_text_extent(system, hdc, &text, i32::from(count))?;

    system.write_far(size, &both.to_le_bytes());
    Ok(Answer::Word(1))
}

/// The typeface name of the font selected, copied into a buffer of
/// `size` bytes with its nought: how many of its bytes. Nought for no
/// device context, a buffer of no size, or a font with no name.
///
/// The name is the one that was asked for rather than the one that was
/// found. A program selecting Helv gets MS Sans Serif drawn, because
/// `WIN.INI` substitutes it, and is still told the face is Helv.
pub fn get_text_face(system: &mut System, hdc: u16, size: i16, far: u32) -> Result<u16, Stop> {
    let Some(index) = dc_of(system, hdc) else {
        return Ok(0);
    };

    if size <= 0 {
        return Ok(0);
    }

    let face: Vec<u8> = font_of(system, index)?
        .map(|font| font.face.chars().map(|c| c as u8).collect())
        .unwrap_or_default();

    if face.is_empty() {
        return Ok(0);
    }

    if far >> 16 == 0 {
        return Err(Stop::Unsupported("GetTextFace into no buffer"));
    }

    // Room for the terminator comes out of the buffer, not out of the name.
    let copied = face.len().min(size as usize - 1);
    let mut bytes = face[..copied].to_vec();

    bytes.push(0);
    system.write_far(far, &bytes);
    Ok(copied as u16)
}

fn get_text_face_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let size = args.signed(system);
    let far = args.dword(system);

    Ok(Answer::Word(get_text_face(system, hdc, size, far)?))
}

/// The widths of a range of characters in the font selected, one word each.
///
/// A strike's width is the one in its file carried across the width the
/// realisation ended up at -- the same `round(width * horizontal)` a string
/// of one character measures. Reading it out of the file unscaled answers
/// the design strike rather than the realised one, and a stretched strike is
/// exactly where the two part company: MS Sans Serif asked for a cell of 26
/// is the 13 pixel strike doubled, whose `A` is 7 in the file and 14 on the
/// screen. **Measured** by `groundw` over four faces and every cell from
/// eight to forty-eight.
///
/// `None` -- nought answered -- for no device context, no font, or a range
/// that runs backwards.
pub fn get_char_widths(
    system: &mut System,
    hdc: u16,
    first: u16,
    last: u16,
) -> Result<Option<Vec<u16>>, Stop> {
    let Some(index) = dc_of(system, hdc) else {
        return Ok(None);
    };

    if last < first {
        return Ok(None);
    }

    let Some(font) = font_of(system, index)? else {
        return Ok(None);
    };
    let horizontal = font.width_scale();

    Ok(Some(
        (first..=last)
            .map(|code| {
                round(f64::from(font.entry.character(u32::from(code)).width) * horizontal) as u16
            })
            .collect(),
    ))
}

fn get_char_width_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let first = args.word(system);
    let last = args.word(system);
    let far = args.dword(system);
    let Some(widths) = get_char_widths(system, hdc, first, last)? else {
        return Ok(Answer::Word(0));
    };
    let bytes: Vec<u8> = widths
        .iter()
        .flat_map(|width| width.to_le_bytes())
        .collect();

    if far >> 16 == 0 {
        return Err(Stop::Unsupported("GetCharWidth into no buffer"));
    }

    system.write_far(far, &bytes);
    Ok(Answer::Word(1))
}

/// The System font's object, at its stock handle, made there if it is not
/// yet.
fn system_font_object(system: &mut System) -> Option<usize> {
    let handle = stock_font_handle(system, SYSTEM_FONT)?;

    match system.handles.resolve(handle)? {
        Object::Gdi(object) => Some(object),
        _ => None,
    }
}

/// The width USER counts a tab stop in, eight to a stop: the font's average
/// character width -- or, in the System font, half the average of its
/// letters, rounded up, as `DrawText` counts it. Whether the font is the
/// System font is asked of the strike: another font object realised to the
/// same strike counts.
fn tab_average(system: &mut System, index: usize, hdc: u16) -> Result<i64, Stop> {
    let Some(font) = font_of(system, index)? else {
        return Err(Stop::Unsupported("a tab stop with no font"));
    };
    let selected = system.gdi.dcs[index].state.font;
    let system_object = system_font_object(system);
    let system_font = match system_object {
        Some(object) => realised(system, object)?,
        None => None,
    };
    let is_system = (selected.is_some() && selected == system_object)
        || system_font
            .is_some_and(|system_font| std::rc::Rc::ptr_eq(&system_font.entry, &font.entry));

    if !is_system {
        return Ok(i64::from(text_metrics(&font).ave_char_width));
    }

    let letters = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let width = i64::from(get_text_extent(system, hdc, letters, 52)? & 0xffff);

    Ok((width / 26 + 1) / 2)
}

/// A tabbed string's extent, as `GetTabbedTextExtent` answers it: the width
/// from where the text starts to where it ends, in the low word, and the
/// font's height in the high. Nought for a handle that stands for nothing.
///
/// **Recorded** by `tabtext`, in the System font:
///
/// * With no stops, there is one every eight average characters, 64 pixels
///   on the VGA -- the average USER counts `DrawText`'s tabs in.
/// * With one, its distance repeats.
/// * With several, each tab goes to the first stop past where the text has
///   got to, and past the last to the next of the default stops.
///
/// Not recorded: another font's stops, taken as `DrawText`'s are, from
/// `tmAveCharWidth`.
pub fn get_tabbed_text_extent(
    system: &mut System,
    hdc: u16,
    text: &[u8],
    stops: &[i64],
) -> Result<u32, Stop> {
    if system.handles.resolve(hdc).is_none() {
        return Ok(0);
    }

    let Some(index) = dc_of(system, hdc) else {
        return Err(Stop::Unsupported(
            "GetTabbedTextExtent with no device context",
        ));
    };
    let spacing = 8 * tab_average(system, index, hdc)?;
    let next = |at: i64| -> i64 {
        if stops.len() == 1 && stops[0] > 0 {
            return (at.div_euclid(stops[0]) + 1) * stops[0];
        }

        let stop = if stops.len() > 1 {
            stops.iter().copied().find(|&stop| stop > at)
        } else {
            None
        };

        match stop {
            Some(stop) => stop,
            None if spacing > 0 => (at.div_euclid(spacing) + 1) * spacing,
            None => at,
        }
    };
    let mut at = 0;

    for (piece_index, piece) in text.split(|&byte| byte == b'\t').enumerate() {
        if piece_index > 0 {
            at = next(at);
        }

        if !piece.is_empty() {
            at += i64::from(get_text_extent(system, hdc, piece, piece.len() as i32)? & 0xffff);
        }
    }

    let height = font_of(system, index)?.map_or(0, |font| i64::from(text_metrics(&font).height));

    Ok(pack(at, height))
}

fn get_tabbed_text_extent_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let count = args.signed(system);
    let stop_count = args.signed(system);
    let stops_far = args.dword(system);
    let text = system.read_far(far, usize::from(count.max(0) as u16));
    let stops: Vec<i64> = if stops_far == 0 || stop_count <= 0 {
        Vec::new()
    } else {
        system
            .read_far(stops_far, stop_count as usize * 2)
            .chunks(2)
            .map(|word| i64::from(i16::from_le_bytes([word[0], word[1]])))
            .collect()
    };

    Ok(Answer::Dword(get_tabbed_text_extent(
        system, hdc, &text, &stops,
    )?))
}

/// The dialog base units, from the System font: across, half the average
/// width of its fifty-two letters, rounded up; down, its height -- either
/// at least 1. Height in the high word.
pub fn get_dialog_base_units(system: &mut System) -> Result<u32, Stop> {
    let font = match system_font_object(system) {
        Some(object) => realised(system, object)?,
        None => None,
    };
    let Some(font) = font else {
        return Err(Stop::Unsupported(
            "the dialog base units with no System font",
        ));
    };
    let (letters, _) = font.measure(
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        Measure::default(),
    );
    let x = ((letters / 26.0).floor() as i64 + 1) >> 1;
    let y = i64::from(text_metrics(&font).height);

    Ok(pack(if x == 0 { 1 } else { x }, if y == 0 { 1 } else { y }))
}

fn get_dialog_base_units_call(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(get_dialog_base_units(system)?))
}

#[cfg(test)]
mod tests;
