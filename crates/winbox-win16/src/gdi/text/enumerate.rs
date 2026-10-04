//! The fonts a device context has, a family at a time, or a family's every
//! font by name: `EnumFontFamilies`, and `EnumFonts`, which is the same.
//!
//! **Read out of `GDI.EXE`** (seg5 `01a7`, `0000`, `070f`, `07f5`), and
//! **recorded** by `enumfam` on four displays.
//!
//! GDI keeps two tables. The first holds the raster and vector fonts, each
//! size of each face an entry, in the order they were added: the three boot
//! fonts `SYSTEM.INI` names, then each `.FON` of `WIN.INI` `[fonts]`, each
//! file's sizes in its own order. The second holds the TrueType fonts, a
//! `.FOT` an entry, in `[fonts]` order.
//!
//! * **Every family**, no name given: the first table, a family's first
//!   entry standing for it -- less a raster family a TrueType one has the
//!   name of, so the raster Symbol goes -- then the second, a family's first
//!   file standing for it. Arial is its regular because `ARIAL.FOT` comes
//!   first.
//! * **By name**: every entry of the family, the raster sizes and then the
//!   TrueType styles, each in its table's order. `lfFaceName` is the name as
//!   the caller spelled it.
//!
//! The answer is the last callback's; a callback answering nought stops
//! everything at once. Nothing matched answers 1, as it starts.
//!
//! A TrueType font is told of from its stub alone, so its outline not being
//! loaded here changes nothing.
//!
//! Not followed, as the TypeScript engine does not: the mapping mode, whose
//! units GDI would turn the sizes into; the device's own fonts, which the
//! screen drivers have none of; a device context whose aspect does not
//! match a raster font's; the compatibility flags that change what an old
//! program is told; and, for `EnumFonts` (seg5 `05a7`), a TrueType style
//! that duplicates another's, or is none of regular, bold and italic, which
//! it lists under its full name -- the fonts installed have none.

use std::collections::HashSet;
use std::rc::Rc;

use winbox_cpu::{AX, DS, ES, SP, SS};
use winbox_machine::segment_selector;
use winbox_raster::{BitmapFontEntry, FontResource};

use crate::call::{Answer, Args, Later};
use crate::engine::{Engine, GuestArg, Register, placed_entry};
use crate::gdi::get_device_caps;
use crate::system::System;

use super::{Text, text_argument};

const RASTER_FONTTYPE: u16 = 1;
const TRUETYPE_FONTTYPE: u16 = 4;
const LOGPIXELSX: i16 = 88;
const LOGPIXELSY: i16 = 90;

/// An `ENUMLOGFONT`'s size: a `LOGFONT`, the full name and the style.
const ENUMLOGFONT_SIZE: usize = 50 + 64 + 32;
/// A `NEWTEXTMETRIC`'s: a `TEXTMETRIC`, a doubleword and three words.
const NEWTEXTMETRIC_SIZE: usize = 31 + 4 + 6;

/// A structure written over the bytes already where it goes, field by
/// field, as the TypeScript engine writes one: a string field is its text
/// and a nought, and the bytes after the nought are left as they were.
pub(super) struct Fields(pub(super) Vec<u8>);

impl Fields {
    fn byte(&mut self, at: usize, value: i32) -> &mut Self {
        self.0[at] = value as u8;
        self
    }

    fn word(&mut self, at: usize, value: i32) -> &mut Self {
        self.0[at..at + 2].copy_from_slice(&(value as u16).to_le_bytes());
        self
    }

    fn dword(&mut self, at: usize, value: u32) -> &mut Self {
        self.0[at..at + 4].copy_from_slice(&value.to_le_bytes());
        self
    }

    /// Text in a field of `length` bytes: as much as leaves room for its
    /// nought.
    fn chars(&mut self, at: usize, length: usize, text: &[u8]) -> &mut Self {
        let text = &text[..text.len().min(length - 1)];

        self.0[at..at + text.len()].copy_from_slice(text);
        self.0[at + text.len()] = 0;
        self
    }
}

/// What a font is said to be: its `ENUMLOGFONT`, its `NEWTEXTMETRIC`, as
/// field writes over what is there, and its type.
pub(super) struct Told {
    pub(super) logfont: Box<dyn Fn(&mut Fields)>,
    pub(super) metric: Box<dyn Fn(&mut Fields)>,
    pub(super) kind: u16,
}

/// A name compared as GDI compares one, without regard to case.
fn same(a: &str, b: &str) -> bool {
    a.to_uppercase() == b.to_uppercase()
}

/// Bytes as the Latin-1 text the TypeScript engine reads them as.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

/// Latin-1 text back into its bytes.
fn bytes_of(text: &str) -> Vec<u8> {
    text.chars().map(|c| c as u8).collect()
}

/// A raster or vector font's entry, as its header says it is (seg5 `0000`):
/// `lfHeight` the pixel height, `lfWidth` the average width; precision 1 --
/// 3 for a vector font -- clipping 2, quality 1; `lfPitchAndFamily` the
/// family and `FIXED_PITCH` or `VARIABLE_PITCH`, where the header's low bit
/// is set for variable. The metrics are the header's, the default and break
/// characters counted from the first; `tmPitchAndFamily` the header's with
/// the font's type in bits 1 and 2; the digitized aspect the header's
/// resolutions, vertical first. The type is 1 for raster and 0 for vector.
fn from_header(entry: &Rc<BitmapFontEntry>, face: &str) -> Told {
    let h = entry.header.clone();
    let vector = h.kind & 1 == 1;
    // A face called Symbol or ZapfDingbats is the symbol set, whatever its
    // header says: `AddFontResource` makes it so as it adds it (seg2
    // `0df4`). The EGA's Symbol strikes say ANSI.
    let char_set = if same(entry.name(), "symbol") || same(entry.name(), "zapfdingbats") {
        2
    } else {
        i32::from(h.char_set)
    };
    let name: Vec<u8> = bytes_of(face).into_iter().take(31).collect();
    let header = h.clone();

    Told {
        logfont: Box::new(move |f| {
            f.word(0, i32::from(h.pix_height))
                .word(2, i32::from(h.avg_width))
                .word(4, 0)
                .word(6, 0)
                .word(8, i32::from(h.weight))
                .byte(10, i32::from(h.italic))
                .byte(11, i32::from(h.underline))
                .byte(12, i32::from(h.strike_out))
                .byte(13, char_set)
                .byte(14, if vector { 3 } else { 1 })
                .byte(15, 2)
                .byte(16, 1)
                .byte(
                    17,
                    (i32::from(h.pitch_and_family) & 0xf0)
                        | ((i32::from(h.pitch_and_family) & 1) + 1),
                )
                .chars(18, 32, &name)
                .chars(50, 64, b"")
                .chars(114, 32, b"");
        }),
        metric: Box::new(move |f| {
            let h = &header;

            f.word(0, i32::from(h.pix_height))
                .word(2, i32::from(h.ascent))
                .word(4, i32::from(h.pix_height) - i32::from(h.ascent))
                .word(6, i32::from(h.internal_leading))
                .word(8, i32::from(h.external_leading))
                .word(10, i32::from(h.avg_width))
                .word(12, i32::from(h.max_width))
                .word(14, i32::from(h.weight))
                .byte(16, i32::from(h.italic))
                .byte(17, i32::from(h.underline))
                .byte(18, i32::from(h.strike_out))
                .byte(19, i32::from(h.first_char))
                .byte(20, i32::from(h.last_char))
                .byte(21, i32::from(h.first_char) + i32::from(h.default_char))
                .byte(22, i32::from(h.first_char) + i32::from(h.break_char))
                .byte(
                    23,
                    (i32::from(h.pitch_and_family) & 0xf1) | ((i32::from(h.kind) & 3) << 1),
                )
                .byte(24, char_set)
                .word(25, 0)
                .word(27, i32::from(h.vert_res))
                .word(29, i32::from(h.horiz_res))
                .dword(31, 0)
                .word(35, 0)
                .word(37, 0)
                .word(39, 0);
        }),
        kind: if vector { 0 } else { RASTER_FONTTYPE },
    }
}

/// `MulDiv`, rounding to nearest, as GDI's does.
fn mul_div(a: i32, b: i32, c: i32) -> i32 {
    (f64::from(a * b + (c >> 1)) / f64::from(c)).floor() as i32
}

/// A TrueType font at the enumeration's em, from its stub alone (seg5
/// `07f5`): the directory's values in font units, scaled to an em of 24
/// points vertically and across and each rounded -- the descent as the rest
/// of the cell, rounded on its own, so the height is the two added -- 32
/// pixels on the VGA, 24 tall and 32 across on the EGA. `lfPitchAndFamily`
/// is the stub's family and `VARIABLE_PITCH`, and `tmPitchAndFamily` the
/// stub's with 6 in. The full name and style are the stub's; `ntmFlags` the
/// high byte of its `dfType` -- 40h regular, 20h bold, 1 italic -- and the
/// em, the cell's height and the average width in font units. The type is
/// 4. No font is realised. **Recorded** by `enumfam`, 76 of 76 on four
/// displays.
fn from_outline(system: &System, hdc: u16, resource: &FontResource, face: &str) -> Told {
    let log_x = i32::from(get_device_caps(system, hdc, LOGPIXELSX));
    let log_y = i32::from(get_device_caps(system, hdc, LOGPIXELSY));
    let em_y = mul_div(24, log_y, 72);
    let em_x = mul_div(24, log_x, 72);
    let units = if resource.size_em == 0 {
        2048
    } else {
        i32::from(resource.size_em)
    };
    let r = resource.clone();
    let ascent = mul_div(i32::from(r.ascent), em_y, units);
    let descent = mul_div(i32::from(r.cell_height) - i32::from(r.ascent), em_y, units);
    let width = mul_div(i32::from(r.avg_width), em_x, units);
    let name: Vec<u8> = bytes_of(face).into_iter().take(31).collect();
    let resource = r.clone();

    Told {
        logfont: Box::new(move |f| {
            f.word(0, ascent + descent)
                .word(2, width)
                .word(4, 0)
                .word(6, 0)
                .word(8, i32::from(r.weight))
                .byte(10, i32::from(r.italic))
                .byte(11, 0)
                .byte(12, 0)
                .byte(13, i32::from(r.char_set))
                .byte(14, 3)
                .byte(15, 2)
                .byte(16, 1)
                .byte(17, (i32::from(r.pitch_and_family) & 0xf1) + 1)
                .chars(18, 32, &name)
                .chars(50, 64, &bytes_of(&r.full_name))
                .chars(114, 32, &bytes_of(&r.style));
        }),
        metric: Box::new(move |f| {
            let r = &resource;

            f.word(0, ascent + descent)
                .word(2, ascent)
                .word(4, descent)
                .word(6, ascent + descent - em_y)
                .word(8, mul_div(i32::from(r.external_leading), em_y, units))
                .word(10, width)
                .word(12, mul_div(i32::from(r.max_width), em_x, units))
                .word(14, i32::from(r.weight))
                .byte(16, i32::from(r.italic))
                .byte(17, 0)
                .byte(18, 0)
                // The characters a TrueType font's information names (seg3
                // `21fb`).
                .byte(19, 30)
                .byte(20, 255)
                .byte(21, 31)
                .byte(22, 32)
                .byte(23, i32::from(r.pitch_and_family) | 6)
                .byte(24, i32::from(r.char_set))
                .word(25, 0)
                .word(27, log_y)
                .word(29, log_x)
                .dword(31, u32::from(r.flags))
                .word(35, i32::from(r.size_em))
                .word(37, i32::from(r.cell_height))
                .word(39, i32::from(r.avg_width));
        }),
        kind: TRUETYPE_FONTTYPE,
    }
}

/// A selector standing for GDI's own data segment. GDI calls some of a
/// program's procedures with it in DS -- and in AX, for `EnumObjects` -- not
/// the program's (`enumregs`). winbox.js's GDI keeps its data in its own
/// code, so this is a block of its own, sixteen bytes moveable and zeroed,
/// made the first time it is needed, that holds nothing a program should
/// read.
pub fn gdi_data_selector(system: &mut System) -> u16 {
    if let Some(selector) = system.gdi.data {
        return selector;
    }

    let selector = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, 16, 0x42)
        .map_or(0, segment_selector);

    system.gdi.data = Some(selector);
    selector
}

/// Every font chosen, in the order the walk (seg5 `01a7`) chooses them.
pub(super) fn chosen(system: &mut System, hdc: u16, name: Option<&str>) -> Vec<Told> {
    let (strikes, directory) = {
        let fonts = system.fonts();
        let strikes: Vec<Rc<BitmapFontEntry>> = fonts
            .listed_entries()
            .iter()
            .map(|strike| strike.entry.clone())
            .collect();

        (strikes, fonts.true_type_directory.clone())
    };
    let true_type_named = |face: &str| {
        directory
            .iter()
            .any(|resource| same(&resource.family, face) || same(&resource.full_name, face))
    };
    let mut told = Vec::new();

    if let Some(name) = name
        && !strikes.iter().any(|entry| same(entry.name(), name))
        && !true_type_named(name)
    {
        return told;
    }

    // The raster and vector table.
    let mut seen = HashSet::new();

    for entry in &strikes {
        let face = entry.name();
        let raster = entry.header.kind & 1 == 0;

        match name {
            None => {
                if raster && true_type_named(face) {
                    continue;
                }

                if !seen.insert(face.to_uppercase()) {
                    continue;
                }
            }
            Some(name) if !same(face, name) => continue,
            Some(_) => {}
        }

        told.push(from_header(entry, name.unwrap_or(face)));
    }

    // The TrueType directory.
    let mut families = HashSet::new();

    for resource in &directory {
        match name {
            None => {
                if !families.insert(resource.family.to_uppercase()) {
                    continue;
                }
            }
            Some(name) if !same(&resource.family, name) && !same(&resource.full_name, name) => {
                continue;
            }
            Some(_) => {}
        }

        told.push(from_outline(
            system,
            hdc,
            resource,
            name.unwrap_or(&resource.family),
        ));
    }

    told
}

/// Where GDI puts a font's structures for the procedure, as offsets from
/// the stack pointer as it is entered: **recorded** by `enumregs`, through a
/// procedure with no prologue. A font of GDI's own table, raster or vector
/// (seg5 `0000`): the `TEXTMETRIC` 24 bytes up and the `LOGFONT` 66. A
/// TrueType font: the `TEXTMETRIC` 390 bytes up and the `LOGFONT` 242.
fn placement(kind: u16) -> (u16, u16) {
    if kind & TRUETYPE_FONTTYPE != 0 {
        (242, 390)
    } else {
        (66, 24)
    }
}

/// `EnumFontFamilies` and `EnumFonts`: each font chosen handed to the
/// program's procedure with its `LOGFONT` and `TEXTMETRIC`, its type and
/// the program's `lParam`.
///
/// What the procedure finds in its registers, **recorded** by `enumregs`:
/// for a font of GDI's own table AX the `TEXTMETRIC`'s offset, DS GDI's
/// data segment and ES the stack's; for a TrueType font AX, DS and ES the
/// stack's segment, as for a device's fonts (seg5 `058b`). So a program's
/// exported procedure given without `MakeProcInstance` finds its own data
/// for a TrueType font and not for GDI's others.
///
/// A family name that cannot be read turns the call away, answering
/// nought; a null one asks for every family.
pub fn enum_font_families(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (told, procedure, lparam) = {
            let mut system = engine.system();
            let hdc = args.word(&system);
            let family = args.dword(&system);
            let procedure = args.dword(&system);
            let lparam = args.dword(&system);
            // A string whose segment is nought is a number to the
            // TypeScript engine, and named by its digits.
            let name = match text_argument(&system, family) {
                Text::Refused => return Ok(Answer::Word(0)),
                Text::Absent if family == 0 => None,
                Text::Absent => Some((family & 0xffff).to_string()),
                Text::Read(bytes) => Some(latin1(&bytes)),
            };
            let told = chosen(&mut system, hdc, name.as_deref());

            (told, procedure, lparam)
        };
        let mut result: i16 = 1;

        for font in told {
            let (logfont_at, metric_at) = placement(font.kind);
            let (args, registers) = {
                let mut system = engine.system();
                let sp = system.cpu.regs[SP];
                let sizes = [
                    GuestArg::Placed(vec![0; ENUMLOGFONT_SIZE], logfont_at),
                    GuestArg::Placed(vec![0; NEWTEXTMETRIC_SIZE], metric_at),
                    GuestArg::Word(0),
                    GuestArg::Long(0),
                ];
                let entry = placed_entry(sp, &sizes).unwrap_or(0);
                let stack = system.cpu.segments[SS].selector;
                let over = |at: u16, length: usize| {
                    Fields(system.read_far(
                        u32::from(stack) << 16 | u32::from(entry.wrapping_add(at)),
                        length,
                    ))
                };
                let mut logfont = over(logfont_at, ENUMLOGFONT_SIZE);
                let mut metric = over(metric_at, NEWTEXTMETRIC_SIZE);

                (font.logfont)(&mut logfont);
                (font.metric)(&mut metric);

                let registers = if font.kind & TRUETYPE_FONTTYPE != 0 {
                    vec![
                        Register::Word(AX, stack),
                        Register::Segment(DS, stack),
                        Register::Segment(ES, stack),
                    ]
                } else {
                    vec![
                        Register::Word(AX, entry.wrapping_add(metric_at)),
                        Register::Segment(DS, gdi_data_selector(&mut system)),
                        Register::Segment(ES, stack),
                    ]
                };

                (
                    vec![
                        GuestArg::Placed(logfont.0, logfont_at),
                        GuestArg::Placed(metric.0, metric_at),
                        GuestArg::Word(font.kind),
                        GuestArg::Long(lparam),
                    ],
                    registers,
                )
            };
            let (answer, _) = engine.call_with(procedure, &args, &registers).await?;

            result = answer as i16;

            if result == 0 {
                return Ok(Answer::Word(0));
            }
        }

        Ok(Answer::Word(result as u16))
    })
}
