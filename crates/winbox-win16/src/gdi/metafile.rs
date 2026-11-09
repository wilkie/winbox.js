//! Metafiles: GDI calls kept as records to be played again. **Recorded** by
//! `metafile`, which records calls into a memory metafile, dumps its bytes,
//! and plays it back whole and a record at a time; and by `metarec`, which
//! makes every call GDI keeps, and some it does not, into a metafile of its
//! own and dumps it. **Read out** of `GDI.EXE` seg20, which keeps them.
//!
//! * A metafile is a header of nine words -- its kind, 1 for memory; 9, the
//!   header's own size; version 300h; its size in words; how many objects
//!   its handle table needs; its largest record in words; and nought -- then
//!   its records, and a record of three words that ends it.
//! * A record is its size in words, a doubleword; its function, a word; then
//!   what the call was given. For a call given only numbers, that is the
//!   call's own stack less the device context: its arguments last first, as
//!   they were pushed. The function's high byte is how many words those
//!   were, and its low byte the call's ordinal in GDI, less 300 from
//!   `SetTextAlign`'s on: `Rectangle` is 041Bh, `Chord` 0830h. `FloodFill`
//!   is kept as `ExtFloodFill` of `FLOODFILLBORDER`, and both answer nought.
//!   The `Ex` forms are kept as the call they are the form of, and give
//!   their pointer 1 and nought; the print calls are records of no words.
//! * Where a call is given a pointer, the record holds what it points at:
//!   `TextOut` its count, then the text padded to a word, then y and x;
//!   `Polygon` and `Polyline` the count, then the points; `PolyPolygon` the
//!   count of polygons, each one's count, then the points; `ExtTextOut` y,
//!   x, the count, the options, the rectangle where the options fill or clip
//!   to one, the text, and the widths where it is given them; `Escape` the
//!   escape, its count and its bytes (`StartDoc` is `STARTDOC` of the
//!   document's name). A blit from a memory context keeps its words but the
//!   source's, then the source's bitmap as a DIB; one from no context, its
//!   words. `SetDIBitsToDevice` and `StretchDIBits` keep their words and the
//!   program's DIB.
//! * An object selected is made first, in the lowest free place of the
//!   metafile's handle table: a pen by `CreatePenIndirect` (02FAh) with its
//!   `LOGPEN`, a brush by `CreateBrushIndirect` (02FCh) with its `LOGBRUSH` --
//!   a pattern brush by `DIBCreatePatternBrush` (0142h) with its DIB -- a
//!   font by `CreateFontIndirect` (02FBh) with its `LOGFONT`, the face name
//!   and its nought and two bytes more, to a word; a region by
//!   `CreateRegion` (06FFh), a palette by `CreatePalette` (00F7h). Then
//!   `SelectObject` (012Dh) names its place. A stock object is made so too.
//!   `SelectObject` answers the object of its kind selected before -- at
//!   first the black pen, the white brush and the device's default font --
//!   1 for a region, nought for a bitmap, which is not kept.
//!   `DeleteObject` of an object a metafile holds adds 01F0h with its place
//!   there, and frees it, but for one selected.
//! * `GetDeviceCaps` answers `DT_METAFILE` for `TECHNOLOGY` and nought for
//!   every other index; the calls that ask answer nought.
//! * A metafile's handle is the global block of its bytes: `GetMetaFileBits`
//!   and `SetMetaFileBits` give the same handle back. The block is nine words
//!   longer than the metafile.
//! * `EnumMetaFile` calls its procedure with each record but the last, a
//!   handle table of as many objects as the header says, and that count;
//!   `PlayMetaFileRecord` plays one, as `PlayMetaFile` plays them all --
//!   into a metafile's context, keeping each there.
//!
//! Not done: `AnimatePalette`, and `SetPaletteEntries` before
//! `RealizePalette`, in a metafile; playing the records of bitmaps, DIBs,
//! pattern brushes, palettes and escapes; a region's stamp, kept as
//! nought. A call into a metafile that is not kept answers nought.
//!
//! **On disk**, as `diskmeta` recorded them:
//!
//! * `CreateMetaFile` of a file's name writes the same records to the file,
//!   its header's kind 1 still; nought where the file cannot be made.
//! * The handle of one on disk is a block of 192 bytes: the header with its
//!   kind 2; six bytes; then the file's `OFSTRUCT` -- its length byte, eight
//!   more than the path's; 1, a fixed disk; no error; the file's date and
//!   time; and its path. `GetMetaFile` answers one so; `GetMetaFileBits` its
//!   same handle, still of kind 2; `DeleteMetaFile` leaves the file.
//! * `CopyMetaFile` to a file writes the same bytes and answers one on disk;
//!   to none, a copy in memory -- of one in memory, its whole block. A copy
//!   from memory to disk or disk to memory says three words more in its
//!   header's size than it holds; one to its own kind, what it holds.
//!
//! A call is routed here where the call is taken: any of GDI's functions
//! whose first argument is a device context, given a metafile's
//! (`recording`). The export tables this engine is built from do not say
//! which functions take a device context first, so `DC_FIRST` names them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{AX, DS, DX, ES, SS};
use winbox_machine::{handle_for, index_for};

use crate::call::{Answer, Args, Async, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::fonts::LogFont;
use crate::handles::{Kind, Object};
use crate::modules::{Export, Kept};
use crate::system::System;

use super::objects::{Brush, Font, GdiObject, Pen};
use super::text_out::{Bounds, Extra};

/// A place of a metafile's handle table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Place {
    /// Free, for the next object made.
    Free,
    /// An object's, by its handle.
    Held(u16),
    /// An object's that was deleted while selected: never found again.
    Gone,
}

/// What each place of a metafile context's selected objects holds.
const PEN: usize = 0;
const BRUSH: usize = 1;
const FONT: usize = 2;
const PALETTE: usize = 3;
const BITMAP: usize = 4;
const REGION: usize = 5;

/// A metafile's device context, being recorded.
#[derive(Debug, Clone, Default)]
pub struct Recording {
    /// The file it is kept in, for one on disk.
    path: Option<String>,
    /// The records made so far, bytes.
    bytes: Vec<u8>,
    /// The handle table's places.
    slots: Vec<Place>,
    /// The largest record in words, the ending one's three at least.
    largest: u32,
    /// The object of each kind selected last -- pen, brush, font, palette,
    /// bitmap, region: at first the black pen, the white brush and the
    /// device's default font (seg20 `1d75`-`1d9d`).
    current: [u16; 6],
}

/// GDI's functions whose first argument is a device context, by the names
/// they are exported by: those a call into a metafile's device context is
/// kept as a record of, or answered nought by.
pub(crate) const DC_FIRST: &[&str] = &[
    "SetRelAbs",
    "SetBkColor",
    "SetBkMode",
    "SetMapMode",
    "SetRop2",
    "SetPolyFillMode",
    "SetStretchBltMode",
    "SetTextCharacterExtra",
    "SetTextColor",
    "SetTextJustification",
    "SetWindowOrg",
    "SetWindowExt",
    "SetViewportOrg",
    "SetViewportExt",
    "OffsetWindowOrg",
    "ScaleWindowExt",
    "OffsetViewportOrg",
    "ScaleViewportExt",
    "LineTo",
    "MoveTo",
    "ExcludeClipRect",
    "IntersectClipRect",
    "Arc",
    "Ellipse",
    "FloodFill",
    "Pie",
    "Rectangle",
    "RoundRect",
    "PatBlt",
    "SaveDC",
    "SetPixel",
    "OffsetClipRgn",
    "TextOut",
    "BitBlt",
    "StretchBlt",
    "Polygon",
    "Polyline",
    "Escape",
    "RestoreDC",
    "FillRgn",
    "FrameRgn",
    "InvertRgn",
    "PaintRgn",
    "SelectClipRgn",
    "SelectObject",
    "CreateCompatibleBitmap",
    "CreateCompatibleDC",
    "DPToLP",
    "DeleteDC",
    "EnumFonts",
    "EnumObjects",
    "GetBkColor",
    "GetBkMode",
    "GetClipBox",
    "GetCurrentPosition",
    "GetDCOrg",
    "GetDeviceCaps",
    "GetMapMode",
    "GetPixel",
    "GetPolyFillMode",
    "GetRop2",
    "GetStretchBltMode",
    "GetTextCharacterExtra",
    "GetTextColor",
    "GetTextExtent",
    "GetTextFace",
    "GetTextMetrics",
    "GetViewportExt",
    "GetViewportOrg",
    "GetWindowExt",
    "GetWindowOrg",
    "LPToDP",
    "PtVisible",
    "RectVisible",
    "PlayMetafile",
    "CloseMetafile",
    "SetBrushOrg",
    "GetBrushOrg",
    "GetNearestColor",
    "CreateDiscardableBitmap",
    "EnumMetafile",
    "PlayMetafileRecord",
    "GetGlyphOutline",
    "EnumFontFamilies",
    "GetTextAlign",
    "SetTextAlign",
    "Chord",
    "SetMapperFlags",
    "GetCharWidth",
    "ExtTextOut",
    "GetAspectRatioFilter",
    "ExtFloodFill",
    "SetSystemPaletteUse",
    "GetSystemPaletteUse",
    "GetSystemPaletteEntries",
    "StartDoc",
    "EndDoc",
    "StartPage",
    "EndPage",
    "SetAbortProc",
    "AbortDoc",
    "StretchDIBits",
    "SetDIBits",
    "GetDIBits",
    "CreateDIBitmap",
    "SetDIBitsToDevice",
    "PolyPolygon",
    "GetBrushOrgEx",
    "GetCurrentPositionEx",
    "GetTextExtentPoint",
    "GetViewportExtEx",
    "GetViewportOrgEx",
    "GetWindowExtEx",
    "GetWindowOrgEx",
    "OffsetViewportOrgEx",
    "OffsetWindowOrgEx",
    "SetViewportExtEx",
    "SetViewportOrgEx",
    "SetWindowExtEx",
    "SetWindowOrgEx",
    "MoveToEx",
    "ScaleViewportExtEx",
    "ScaleWindowExtEx",
    "GetAspectRatioFilterEx",
    "GDISelectPalette",
    "GDIRealizePalette",
];

/// Those of `DC_FIRST` given a string, and how many bytes of arguments come
/// between the device context and it: a string that cannot be read turns
/// the call away before it reaches a metafile, as it turns any call away
/// (`badarg`).
const STRING_AFTER: &[(&str, u32)] = &[
    ("TextOut", 4),
    ("EnumFonts", 0),
    ("GetTextExtent", 0),
    ("EnumFontFamilies", 0),
    ("ExtTextOut", 10),
    ("GetTextExtentPoint", 0),
];

/// Calls given only numbers, kept as their stack (seg20 `0000`, by way of
/// `2596`): measured, all of them, by `metarec`. `FloodFill` is kept as
/// `ExtFloodFill` (`record`); it is here to be played.
const BY_STACK: &[&str] = &[
    "SetBkMode",
    "SetTextColor",
    "SetPixel",
    "Rectangle",
    "Ellipse",
    "MoveTo",
    "LineTo",
    "PatBlt",
    "SaveDC",
    "IntersectClipRect",
    "RestoreDC",
    "SetRop2",
    "Arc",
    "RoundRect",
    "SetBkColor",
    "SetMapMode",
    "SetPolyFillMode",
    "SetStretchBltMode",
    "SetTextCharacterExtra",
    "SetTextJustification",
    "SetWindowOrg",
    "SetWindowExt",
    "SetViewportOrg",
    "SetViewportExt",
    "OffsetWindowOrg",
    "ScaleWindowExt",
    "OffsetViewportOrg",
    "ScaleViewportExt",
    "ExcludeClipRect",
    "OffsetClipRgn",
    "FloodFill",
    "Pie",
    "Chord",
    "SetRelAbs",
    "SetTextAlign",
    "SetMapperFlags",
    "ExtFloodFill",
];

/// The `Ex` forms, each kept as the call it makes with its arguments less
/// its pointer (seg1 `6043`, `6073`): the pointer given the answer, 1 and
/// nought.
const EX_FORMS: &[(&str, &str)] = &[
    ("SetWindowOrgEx", "SetWindowOrg"),
    ("SetViewportOrgEx", "SetViewportOrg"),
    ("OffsetWindowOrgEx", "OffsetWindowOrg"),
    ("OffsetViewportOrgEx", "OffsetViewportOrg"),
    ("SetWindowExtEx", "SetWindowExt"),
    ("SetViewportExtEx", "SetViewportExt"),
    ("ScaleWindowExtEx", "ScaleWindowExt"),
    ("ScaleViewportExtEx", "ScaleViewportExt"),
    ("MoveToEx", "MoveTo"),
];

/// Calls given a metafile's context that are made on it as on any, not
/// kept: `CloseMetaFile`, which ends it, and those that play a metafile
/// into it, whose records are kept as they are played (seg19 `0826`).
const MADE_ON_METAFILES: &[&str] = &[
    "CloseMetafile",
    "PlayMetafile",
    "PlayMetafileRecord",
    "EnumMetafile",
];

/// The `Ex` forms that ask, which are made on a metafile's context as on
/// any.
const GET_EX: &[&str] = &[
    "GetBrushOrgEx",
    "GetCurrentPositionEx",
    "GetViewportExtEx",
    "GetViewportOrgEx",
    "GetWindowExtEx",
    "GetWindowOrgEx",
];

/// The print calls, each kept as a record of no words (seg31 `0234`-
/// `0302`).
const PRINTING: &[(&str, u16)] = &[
    ("StartPage", 0x0051),
    ("EndPage", 0x0052),
    ("EndDoc", 0x0053),
    ("AbortDoc", 0x0054),
];

const META_REALIZEPALETTE: u16 = 0x0035;
const META_INVERTREGION: u16 = 0x012a;
const META_PAINTREGION: u16 = 0x012b;
const META_SELECTOBJECT: u16 = 0x012d;
const META_RESIZEPALETTE: u16 = 0x0139;
const META_DIBCREATEPATTERNBRUSH: u16 = 0x0142;
const META_DELETEOBJECT: u16 = 0x01f0;
const META_CREATEPALETTE: u16 = 0x00f7;
const META_FILLREGION: u16 = 0x0228;
const META_SELECTPALETTE: u16 = 0x0234;
const META_CREATEPENINDIRECT: u16 = 0x02fa;
const META_CREATEFONTINDIRECT: u16 = 0x02fb;
const META_CREATEBRUSHINDIRECT: u16 = 0x02fc;
const META_TEXTOUT: u16 = 0x0521;
const META_POLYPOLYGON: u16 = 0x0538;
const META_EXTFLOODFILL: u16 = 0x0548;
const META_ESCAPE: u16 = 0x0626;
const META_CREATEREGION: u16 = 0x06ff;
const META_DIBBITBLT: u16 = 0x0940;
const META_EXTTEXTOUT: u16 = 0x0a32;
const META_DIBSTRETCHBLT: u16 = 0x0b41;
const META_SETDIBTODEV: u16 = 0x0d33;
const META_STRETCHDIB: u16 = 0x0f43;
const META_POLYGON: u16 = 0x0324;
const META_POLYLINE: u16 = 0x0325;

const ETO_OPAQUE: u16 = 2;
const ETO_CLIPPED: u16 = 4;

const SETABORTPROC: u16 = 9;
const STARTDOC: u16 = 10;

const TECHNOLOGY: u16 = 2;
const DT_METAFILE: u16 = 5;

const BS_NULL: u16 = 1;
const BS_HATCHED: u16 = 2;

const GMEM_MOVEABLE: u16 = 0x0002;
const GMEM_ZEROINIT: u16 = 0x0040;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "CreateMetafile" => Implementation::Sync(create_metafile_call),
        "CloseMetafile" => Implementation::Sync(close_metafile_call),
        "PlayMetafile" => Implementation::Async(play_metafile),
        "PlayMetafileRecord" => Implementation::Async(play_metafile_record),
        "EnumMetafile" => Implementation::Async(enum_metafile),
        "GetMetafileBits" => Implementation::Sync(get_metafile_bits_call),
        "SetMetafileBits" | "SetMetafileBitsBetter" => Implementation::Sync(set_metafile_bits_call),
        "IsValidMetafile" => Implementation::Sync(is_valid_metafile_call),
        "DeleteMetafile" => Implementation::Sync(delete_metafile_call),
        "CopyMetafile" => Implementation::Sync(copy_metafile_call),
        "GetMetafile" => Implementation::Sync(get_metafile_call),
        _ => return None,
    })
}

/// Words as bytes, low first.
fn words_of(words: &[u16]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

/// A record's function: in its high byte the words of its arguments, in
/// its low the call's ordinal, less 300 from `SetTextAlign`'s (346) on --
/// as `PlayMetaFileRecord` takes it back (seg19 `098b`-`0996`).
fn function_of(ordinal: u16, words: usize) -> u16 {
    let low = if ordinal < 300 {
        ordinal
    } else {
        ordinal - 300
    };

    ((words as u16) << 8) | (low & 0xff)
}

/// The ordinal a record's function names (seg19 `096c`-`0996`).
fn ordinal_of_function(function: u16) -> u16 {
    let low = function & 0xff;

    if low < 0x2e { low } else { low + 300 }
}

/// A function's ordinal in GDI, by its name; nought for none.
fn ordinal_of(name: &str) -> u16 {
    Kept::named("GDI").map_or(0, |gdi| gdi.ordinal_of(name))
}

impl Recording {
    fn emit(&mut self, function: u16, mut params: Vec<u8>) {
        if params.len() & 1 != 0 {
            params.push(0);
        }

        let size = 3 + params.len() as u32 / 2;

        self.bytes
            .extend(words_of(&[size as u16, (size >> 16) as u16, function]));
        self.bytes.extend(params);
        self.largest = self.largest.max(size);
    }
}

/// The metafile a call made at an `INT 80h` goes into, if it goes into
/// one: a call of GDI's whose first argument is a device context, a
/// metafile's being recorded -- but those made on it as on any
/// (`MADE_ON_METAFILES`) -- and whose string, if it is given one, can be
/// read.
pub(crate) fn recording(
    system: &System,
    module: &str,
    export: Export,
    stack: u32,
    sp: u32,
) -> Option<usize> {
    if module != "GDI"
        || MADE_ON_METAFILES.contains(&export.name)
        || !DC_FIRST.contains(&export.name)
    {
        return None;
    }

    let read = |at: u32| system.cpu.bus.read16(stack + (at & 0xffff));
    let first = sp + 4 + u32::from(export.pops).saturating_sub(2);
    let Some(Object::Metafile(index)) = system.handles.resolve(read(first)) else {
        return None;
    };

    if let Some(&(_, after)) = STRING_AFTER.iter().find(|(name, _)| *name == export.name) {
        let low = first.wrapping_sub(after + 4);
        let far = u32::from(read(low)) | u32::from(read(low + 2)) << 16;

        if far >> 16 != 0 && !system.readable_string(far) {
            return None;
        }
    }

    Some(index)
}

/// A call into a metafile's device context kept as a record: its answer in
/// AX, and DX nought for one that answers a long; AX and DX left for one
/// that answers nothing. The call log is not told its answer.
pub(crate) fn record_call(
    system: &mut System,
    index: usize,
    ordinal: u16,
    export: Export,
    stack: u32,
    sp: u32,
) {
    let image: Vec<u8> = (0..u32::from(export.pops).saturating_sub(2))
        .map(|at| system.cpu.bus.read8(stack + ((sp + 4 + at) & 0xffff)))
        .collect();
    let answer = record(system, index, ordinal, export.name, &image);

    match export.returns {
        0 => {}
        1 | 2 => system.cpu.regs[AX] = answer,
        _ => {
            system.cpu.regs[AX] = answer;
            system.cpu.regs[DX] = 0;
        }
    }
}

/// A word of a call's stack, from its lowest byte.
fn word_at(image: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([
        image.get(at).copied().unwrap_or(0),
        image.get(at + 1).copied().unwrap_or(0),
    ])
}

fn dword_at(image: &[u8], at: usize) -> u32 {
    u32::from(word_at(image, at)) | u32::from(word_at(image, at + 2)) << 16
}

/// A string argument as a record keeps it: none for a null pointer, the
/// digits of the offset of one whose segment is nought.
fn kept_text(system: &System, far: u32) -> Vec<u8> {
    match (far >> 16, far & 0xffff) {
        (0, 0) => Vec::new(),
        (0, number) => number.to_string().into_bytes(),
        _ => system.argument_string(far),
    }
}

/// The metafile being recorded at `index`.
fn meta_of(system: &mut System, index: usize) -> Option<&mut Recording> {
    system.gdi.metafiles.get_mut(index).and_then(Option::as_mut)
}

fn emit(system: &mut System, index: usize, function: u16, params: Vec<u8>) {
    if let Some(meta) = meta_of(system, index) {
        meta.emit(function, params);
    }
}

/// A call made into a metafile's device context, kept as a record, from
/// its stack less the device context. Answers what the call answers there
/// (`metarec`).
#[allow(clippy::too_many_lines)]
fn record(system: &mut System, index: usize, ordinal: u16, name: &str, image: &[u8]) -> u16 {
    let words = image.len() / 2;

    if let Some(&(_, base)) = EX_FORMS.iter().find(|(form, _)| *form == name) {
        let far = dword_at(image, 0);

        emit(
            system,
            index,
            function_of(ordinal_of(base), words.saturating_sub(2)),
            image.get(4..).unwrap_or(&[]).to_vec(),
        );

        if far != 0 {
            system.write_far(far, &[1, 0, 0, 0]);
        }

        return 1;
    }

    // `FloodFill` is `ExtFloodFill` of `FLOODFILLBORDER` (seg15 `0172`);
    // both answer nought (`0026`-`0168`).
    if name == "FloodFill" {
        let mut params = vec![0, 0];

        params.extend_from_slice(image);
        emit(system, index, META_EXTFLOODFILL, params);
        return 0;
    }

    if BY_STACK.contains(&name) {
        emit(system, index, function_of(ordinal, words), image.to_vec());
        return u16::from(name != "ExtFloodFill");
    }

    // Each asks the call it is the `Ex` form of, which answers nought here,
    // and gives its pointer that: nought and nought; 1 (seg1 `5eb5`-`5fb0`).
    if GET_EX.contains(&name) {
        let far = dword_at(image, 0);

        if far != 0 {
            system.write_far(far, &[0, 0, 0, 0]);
        }

        return 1;
    }

    if let Some(&(_, function)) = PRINTING.iter().find(|(call, _)| *call == name) {
        emit(system, index, function, Vec::new());
        return 1;
    }

    match name {
        // Nought for every index but `TECHNOLOGY`, which is `DT_METAFILE`
        // (seg1 `44c3`-`44cf`).
        // (Its other indexes answer nought with the calls not kept.)
        "GetDeviceCaps" if word_at(image, 0) == TECHNOLOGY => DT_METAFILE,
        "SelectObject" => select_into(system, index, word_at(image, 0)),
        // A region selected as `SelectObject` selects one; no region,
        // nought.
        "SelectClipRgn" => {
            let handle = word_at(image, 0);

            if kind_of(system, handle) == Some(REGION) {
                select_into(system, index, handle)
            } else {
                0
            }
        }
        "GDISelectPalette" => select_palette_into(system, index, word_at(image, 2)),
        "GDIRealizePalette" => {
            emit(system, index, META_REALIZEPALETTE, Vec::new());
            1
        }
        // The region's place, then the brush's (seg20 `063a`-`06a6`).
        "FillRgn" | "InvertRgn" | "PaintRgn" => {
            let handles = if name == "FillRgn" {
                vec![word_at(image, 2), word_at(image, 0)]
            } else {
                vec![word_at(image, 0)]
            };
            let Some(places) = places_of(system, index, &handles) else {
                return 0;
            };
            let function = match name {
                "FillRgn" => META_FILLREGION,
                "InvertRgn" => META_INVERTREGION,
                _ => META_PAINTREGION,
            };

            emit(system, index, function, words_of(&places));
            1
        }
        "TextOut" => {
            let count = word_at(image, 0) as i16;
            let text = kept_text(system, dword_at(image, 2));
            let mut params = words_of(&[count as u16]);

            params.extend_from_slice(super::text::sliced(&text, i32::from(count)));

            if count & 1 != 0 {
                params.push(0);
            }

            params.extend(words_of(&[word_at(image, 6), word_at(image, 8)]));
            emit(system, index, META_TEXTOUT, params);
            1
        }
        // y, x, the count, the options; the rectangle where the options are
        // to fill or clip to one; the text; each character's width where it
        // is given them (seg20 `0935`-`0aaf`).
        "ExtTextOut" => {
            let count = word_at(image, 4);
            let text = kept_text(system, dword_at(image, 6));
            let options = word_at(image, 14);
            let dx = dword_at(image, 0);
            let mut params = words_of(&[word_at(image, 16), word_at(image, 18), count, options]);

            if options & (ETO_OPAQUE | ETO_CLIPPED) != 0 {
                params.extend(system.read_far(dword_at(image, 10), 8));
            }

            params.extend_from_slice(super::text::sliced(&text, i32::from(count)));

            if count & 1 != 0 {
                params.push(0);
            }

            if dx != 0 {
                params.extend(system.read_far(dx, usize::from(count) * 2));
            }

            emit(system, index, META_EXTTEXTOUT, params);
            1
        }
        "Polygon" | "Polyline" => {
            let count = word_at(image, 0) as i16;
            let mut params = words_of(&[count as u16]);

            params.extend(
                system.read_far(dword_at(image, 2), (i32::from(count) * 4).max(0) as usize),
            );
            emit(
                system,
                index,
                if name == "Polygon" {
                    META_POLYGON
                } else {
                    META_POLYLINE
                },
                params,
            );
            1
        }
        // The count of polygons, each one's count of points, then the
        // points (seg20 `0857`-`0932`).
        "PolyPolygon" => {
            let polygons = word_at(image, 0);
            let counts = system.read_far(dword_at(image, 2), usize::from(polygons) * 2);
            let points = (0..usize::from(polygons))
                .fold(0u16, |sum, at| sum.wrapping_add(word_at(&counts, at * 2)));
            let mut params = words_of(&[polygons]);

            params.extend(&counts);
            params.extend(system.read_far(dword_at(image, 6), usize::from(points) * 4));
            emit(system, index, META_POLYPOLYGON, params);
            1
        }
        // The escape, its count, and what it was given; but
        // `SETABORTPROC`, which is made on the context (seg7 `0067`-`0080`,
        // seg20 `06d5`).
        "Escape" => {
            let escape = word_at(image, 10);
            let count = word_at(image, 8);

            if escape == SETABORTPROC {
                return 0;
            }

            let mut params = words_of(&[escape, count]);

            params.extend(system.read_far(dword_at(image, 4), usize::from(count)));
            emit(system, index, META_ESCAPE, params);
            1
        }
        // `STARTDOC` with the document's name (seg31 `01b1`-`01d4`).
        "StartDoc" => {
            let info = dword_at(image, 0);
            let name = if info == 0 {
                0
            } else {
                let bytes = system.read_far(info, 6);

                u32::from_le_bytes([bytes[2], bytes[3], bytes[4], bytes[5]])
            };
            let mut text = Vec::new();

            while name != 0 && text.len() < 0x8000 {
                let byte = system.read_far(
                    (name & 0xffff_0000) | (name.wrapping_add(text.len() as u32) & 0xffff),
                    1,
                )[0];

                if byte == 0 {
                    break;
                }

                text.push(byte);
            }

            let mut params = words_of(&[STARTDOC, text.len() as u16]);

            params.extend(text);
            emit(system, index, META_ESCAPE, params);
            1
        }
        "BitBlt" | "StretchBlt" => record_blt(system, index, name == "BitBlt", image),
        // The colours' use and the eight words after the pointers, then the
        // DIB, its lines those asked for (seg20 `0d30`-`10a3`).
        "SetDIBitsToDevice" => {
            let usage = word_at(image, 0);
            let lines = u32::from(word_at(image, 10));
            let mut params = words_of(&[usage]);

            params.extend(image.get(10..26).unwrap_or(&[]));
            params.extend(program_dib(
                system,
                dword_at(image, 2),
                dword_at(image, 6),
                usage,
                Some(lines),
            ));
            emit(system, index, META_SETDIBTODEV, params);
            1
        }
        // The raster operation, the colours' use and the eight words after
        // the pointers, then the DIB (seg20 `10b4`-`1252`).
        "StretchDIBits" => {
            let usage = word_at(image, 4);
            let mut params = image.get(0..4).unwrap_or(&[]).to_vec();

            params.extend(words_of(&[usage]));
            params.extend(image.get(14..30).unwrap_or(&[]));
            params.extend(program_dib(
                system,
                dword_at(image, 6),
                dword_at(image, 10),
                usage,
                None,
            ));
            emit(system, index, META_STRETCHDIB, params);
            1
        }
        _ => 0,
    }
}

/// `BitBlt` and `StretchBlt` (seg1 `2f9a`, `3002`; seg20 `0b91`-`0d2d`).
/// From no context, or from the metafile's own, the call's own words, the
/// source context's among them. From a memory context, its words but the
/// source context's, then the bitmap it holds made a DIB. From any other,
/// nought. `StretchBlt` from no context is turned away before it is kept
/// (`metarec`).
fn record_blt(system: &mut System, index: usize, bit: bool, image: &[u8]) -> u16 {
    let function = if bit {
        META_DIBBITBLT
    } else {
        META_DIBSTRETCHBLT
    };
    let at = if bit { 8 } else { 12 };
    let source = word_at(image, at);

    if source == 0 && !bit {
        return 0;
    }

    let own = matches!(system.handles.resolve(source), Some(Object::Metafile(of)) if of == index);

    if source == 0 || own {
        emit(system, index, function, image.to_vec());
        return 1;
    }

    let Some(dc) = super::dc::dc_of(system, source) else {
        return 0;
    };
    let pixels = match (system.gdi.dcs[dc].memory, system.gdi.dcs[dc].bitmap) {
        (true, super::dc::DcBitmap::Bitmap(object)) => match &system.gdi.objects[object] {
            GdiObject::Bitmap(bitmap) => bitmap.pixels.clone(),
            _ => return 0,
        },
        _ => return 0,
    };
    let mut params = image.get(..at).unwrap_or(&[]).to_vec();

    params.extend(image.get(at + 2..).unwrap_or(&[]));
    params.extend(super::dib::packed_dib_of(system, &pixels));
    emit(system, index, function, params);
    1
}

/// A row of a DIB, `bits` to a pixel, `width` wide, in bytes: to a
/// doubleword.
fn stride_of(width: u32, bits: u32) -> u32 {
    (width.wrapping_mul(bits).wrapping_add(31) & !31) >> 3
}

/// A DIB a program gives `SetDIBitsToDevice` or `StretchDIBits`, as the
/// record keeps it (seg20 `0d30`, `10b4`): a `BITMAPINFOHEADER` of 40 bytes
/// -- one made of a `BITMAPCOREHEADER`, its size, width, height, planes and
/// bits, the rest nought -- its colours, four bytes each for
/// `DIB_RGB_COLORS` (a core table's three and a nought) and two for
/// `DIB_PAL_COLORS`, as many as it uses or its bits can name, none at 24;
/// then its bits: the image's size where it gives one and all its lines are
/// asked for, else a row's bytes for each line.
fn program_dib(system: &System, info: u32, bits: u32, usage: u16, lines: Option<u32>) -> Vec<u8> {
    let step = |at: u32| (info & 0xffff_0000) | (info.wrapping_add(at) & 0xffff);
    let word = |at: u32| {
        let bytes = system.read_far(step(at), 2);

        u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
    };
    let dword = |at: u32| word(at) | word(at + 2) << 16;
    let each: u32 = if usage == 0 { 4 } else { 2 };
    let mut bytes = Vec::new();
    let size_of_bits = if dword(0) == 12 {
        let (width, height, planes, count) = (word(4), word(6), word(8), word(10));
        let colours = if count == 24 {
            0
        } else {
            (each << count) & 0xffff
        };

        bytes.extend(words_of(&[
            40,
            0,
            width as u16,
            0,
            height as u16,
            0,
            planes as u16,
            count as u16,
        ]));
        bytes.extend([0; 24]);

        if usage == 0 {
            for entry in 0..colours >> 2 {
                bytes.extend(system.read_far(step(12 + entry * 3), 3));
                bytes.push(0);
            }
        } else {
            bytes.extend(system.read_far(step(12), colours as usize));
        }

        stride_of(width, count).wrapping_mul(lines.unwrap_or(height))
    } else {
        let used = dword(0x20);
        let count = word(0x0e);
        let colours = if used != 0 {
            each.wrapping_mul(used) & 0xffff
        } else if count == 24 {
            0
        } else {
            (each << count) & 0xffff
        };
        let image = dword(0x14);
        let height = dword(8);

        bytes.extend(system.read_far(info, 40));
        bytes.extend(system.read_far(step(40), colours as usize));

        if image != 0 && lines.is_none_or(|lines| lines == height) {
            image
        } else {
            stride_of(dword(4), count).wrapping_mul(lines.unwrap_or(height))
        }
    };

    // The bits are copied a word at a time.
    bytes.extend((0..size_of_bits & !1).map(|at| byte_in(system, bits, at)));
    bytes
}

/// The kind of object a handle names, by where a metafile context keeps
/// it selected; none for no object.
fn kind_of(system: &mut System, handle: u16) -> Option<usize> {
    let kind = match system.gdi_object_of(handle)?.1 {
        GdiObject::Pen(_) => PEN,
        GdiObject::Brush(_) => BRUSH,
        GdiObject::Palette(_) => PALETTE,
        GdiObject::Bitmap(_) => BITMAP,
        GdiObject::Region(_) => REGION,
        GdiObject::Font(_) => FONT,
    };

    // A font is one where it has a `LOGFONT`.
    if kind == FONT {
        font_logfont(system, handle)?;
    }

    Some(kind)
}

/// A `COLORREF` of a colour's red, green and blue.
fn colorref_of(color: [u8; 4]) -> u32 {
    u32::from(color[0]) | u32::from(color[1]) << 8 | u32::from(color[2]) << 16
}

/// A font's `LOGFONT`: its own, or a stock font's.
fn font_logfont(system: &mut System, handle: u16) -> Option<LogFont> {
    match system.gdi_object_of(handle)?.1 {
        GdiObject::Font(Font::Made { logfont, .. }) => Some(logfont.clone()),
        GdiObject::Font(Font::Stock { .. }) => {
            let index = (0..=16).find(|&index| super::objects::stock_handle(index) == handle)?;

            super::objects::stock_logfont(system, index)
        }
        _ => None,
    }
}

/// The record that makes an object in a metafile (seg20 `1755`-`1a54`),
/// or none for one it does not keep -- a bitmap.
#[allow(clippy::too_many_lines)]
fn making_of(system: &mut System, handle: u16) -> Option<(u16, Vec<u8>)> {
    let (object, _) = system.gdi_object_of(handle)?;

    match &system.gdi.objects[object] {
        GdiObject::Pen(Pen { color, logpen, .. }) => {
            let (style, width, y, colorref) = match logpen {
                Some(logpen) => (logpen.style, logpen.width, logpen.y, logpen.color),
                None => (if color[3] == 0 { 5 } else { 0 }, 0, 0, colorref_of(*color)),
            };

            Some((
                META_CREATEPENINDIRECT,
                words_of(&[
                    style,
                    width as u16,
                    y as u16,
                    colorref as u16,
                    (colorref >> 16) as u16,
                ]),
            ))
        }
        // A pattern's: its style, how its colours are given, and its DIB
        // (`1792`-`1932`).
        GdiObject::Brush(Brush {
            dib_record: Some(params),
            ..
        }) => Some((META_DIBCREATEPATTERNBRUSH, params.clone())),
        // A brush of a pattern it keeps no DIB of, and a bitmap: not kept.
        GdiObject::Brush(Brush {
            pattern: Some(_), ..
        })
        | GdiObject::Bitmap(_) => None,
        GdiObject::Brush(Brush {
            color, logbrush, ..
        }) => {
            let (style, colorref, hatch) = match logbrush {
                Some(logbrush) => (logbrush.style, logbrush.color, logbrush.hatch),
                None if color[3] == 0 => (1, 0, 0),
                None => (0, colorref_of(*color), 0),
            };

            Some((
                META_CREATEBRUSHINDIRECT,
                words_of(&[style, colorref as u16, (colorref >> 16) as u16, hatch]),
            ))
        }
        // A region: its object's first four words, the second made 6, and
        // the rest of it from its size on (`198c`-`1a3d`) -- its size in
        // bytes, its scans, the most sides a scan has, its box, then each
        // scan: its count of sides, its top and bottom, the sides, the
        // count again. The third and fourth words are GDI's stamp of the
        // object, which this engine does not count: nought.
        GdiObject::Region(region) => {
            let mut scans = Vec::new();
            let mut most = 0;

            for band in &region.bands {
                let sides = (band.spans.len() * 2) as u16;

                most = most.max(sides);
                scans.extend([sides, band.top as u16, band.bottom as u16]);

                for &(left, right) in &band.spans {
                    scans.extend([left as u16, right as u16]);
                }

                scans.push(sides);
            }

            let bounds = if region.bands.is_empty() {
                winbox_raster::clip_region::Box {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                }
            } else {
                region.bounds()
            };
            let mut words = vec![
                0,
                6,
                0,
                0,
                (24 + scans.len() * 2) as u16,
                region.bands.len() as u16,
                most,
                bounds.left as u16,
                bounds.top as u16,
                bounds.right as u16,
                bounds.bottom as u16,
            ];

            words.extend(scans);
            Some((META_CREATEREGION, words_of(&words)))
        }
        // A palette: its version, its count and its entries (`1971`,
        // `0477`).
        GdiObject::Palette(_) => {
            let entries = system.entries_of(object);
            let mut params = words_of(&[0x300, entries.len() as u16]);

            params.extend(entries.iter().flatten());
            Some((META_CREATEPALETTE, params))
        }
        GdiObject::Font(_) => {
            let logfont = font_logfont(system, handle)?;
            let mut name: Vec<u8> = logfont
                .face_name
                .chars()
                .take(31)
                .map(|char| char as u32 as u8)
                .collect();
            let length = (name.len() + 3) & !1;

            name.resize(length, 0);

            let mut params = words_of(&[
                logfont.height as u16,
                logfont.width as u16,
                logfont.escapement as u16,
                logfont.orientation as u16,
                logfont.weight as u16,
            ]);

            params.extend([
                u8::from(logfont.italic != 0),
                u8::from(logfont.underline != 0),
                u8::from(logfont.strike_out != 0),
                logfont.char_set,
                logfont.out_precision,
                logfont.clip_precision,
                logfont.quality,
                logfont.pitch_and_family,
            ]);
            params.extend(name);
            Some((META_CREATEFONTINDIRECT, params))
        }
    }
}

/// An object's place in a metafile's handle table: where it is, or else
/// the lowest free place, taken for it (seg20 `1b5e`, `1c40`-`1ca5`) and
/// its making recorded there (`16c8`). None for one a metafile does not
/// keep -- a bitmap -- whose place stays taken, though nothing made it:
/// found again, it is selected by it.
fn place_of(system: &mut System, index: usize, handle: u16) -> Option<u16> {
    let meta = meta_of(system, index)?;

    if let Some(slot) = meta
        .slots
        .iter()
        .position(|&place| place == Place::Held(handle))
    {
        return Some(slot as u16);
    }

    let slot = meta
        .slots
        .iter()
        .position(|&place| place == Place::Free)
        .unwrap_or(meta.slots.len());

    if slot == meta.slots.len() {
        meta.slots.push(Place::Held(handle));
    } else {
        meta.slots[slot] = Place::Held(handle);
    }

    let (function, params) = making_of(system, handle)?;

    emit(system, index, function, params);
    Some(slot as u16)
}

/// An object selected (seg20 `15a3`-`1622`): made in its place if it is
/// not there, then `SelectObject` of the place. The answer is the object of
/// its kind selected before; 1 for a region; nought for a bitmap the first
/// time, which a metafile does not keep.
fn select_into(system: &mut System, index: usize, handle: u16) -> u16 {
    let Some(kind) = kind_of(system, handle) else {
        return 0;
    };
    let Some(slot) = place_of(system, index, handle) else {
        return 0;
    };
    let Some(meta) = meta_of(system, index) else {
        return 0;
    };

    meta.emit(META_SELECTOBJECT, words_of(&[slot]));

    let before = meta.current[kind];

    meta.current[kind] = handle;

    if kind == REGION { 1 } else { before }
}

/// A palette selected (seg20 `1568`-`15a0`): made, then `SelectPalette` of
/// its place; 1.
fn select_palette_into(system: &mut System, index: usize, handle: u16) -> u16 {
    if kind_of(system, handle) != Some(PALETTE) {
        return 0;
    }

    let Some(slot) = place_of(system, index, handle) else {
        return 0;
    };
    let Some(meta) = meta_of(system, index) else {
        return 0;
    };

    meta.current[PALETTE] = handle;
    meta.emit(META_SELECTPALETTE, words_of(&[slot]));
    1
}

/// The places of the objects a region call names, the region's first;
/// none where one is not kept.
fn places_of(system: &mut System, index: usize, handles: &[u16]) -> Option<Vec<u16>> {
    let mut places = Vec::new();

    for &handle in handles {
        kind_of(system, handle)?;
        places.push(place_of(system, index, handle)?);
    }

    Some(places)
}

/// An object deleted (seg20 `26a7`): taken out of every metafile being
/// recorded that holds it, by a record of its own -- but where it is the
/// one of its kind selected, which is kept no record of, and whose place
/// is never found again.
pub(crate) fn forget_in_metafiles(system: &mut System, handle: u16) {
    for meta in system.gdi.metafiles.iter_mut().flatten() {
        let Some(slot) = meta
            .slots
            .iter()
            .position(|&place| place == Place::Held(handle))
        else {
            continue;
        };

        if meta.current.contains(&handle) {
            meta.slots[slot] = Place::Gone;
        } else {
            meta.emit(META_DELETEOBJECT, words_of(&[slot as u16]));
            meta.slots[slot] = Place::Free;
        }
    }
}

/// A palette made shorter or longer: `ResizePalette` kept in each metafile
/// that holds it (seg20 `14fd`).
pub(crate) fn resize_in_metafiles(system: &mut System, handle: u16, entries: u16) {
    for meta in system.gdi.metafiles.iter_mut().flatten() {
        if meta.slots.contains(&Place::Held(handle)) {
            meta.emit(META_RESIZEPALETTE, words_of(&[entries]));
        }
    }
}

/// Kept from a metafile's own context: the `SelectPalette` of USER's
/// `SelectPalette`; none for any other context.
pub(crate) fn select_palette_in_metafile(
    system: &mut System,
    hdc: u16,
    handle: u16,
) -> Option<u16> {
    let Some(Object::Metafile(index)) = system.handles.resolve(hdc) else {
        return None;
    };

    Some(select_palette_into(system, index, handle))
}

/// Kept likewise: `RealizePalette` (seg20 `150a`-`1547`), a record of no
/// words; 1.
pub(crate) fn realize_palette_in_metafile(system: &mut System, hdc: u16) -> Option<u32> {
    let Some(Object::Metafile(index)) = system.handles.resolve(hdc) else {
        return None;
    };

    emit(system, index, META_REALIZEPALETTE, Vec::new());
    Some(1)
}

/// A string argument naming a file.
enum Name {
    /// A null pointer.
    None,
    /// A string; the digits of the offset of a pointer whose segment is
    /// nought.
    Given(String),
    /// One that cannot be read, which turns the call away (`badarg`).
    Refused,
}

fn name_argument(system: &System, far: u32) -> Name {
    match (far >> 16, far & 0xffff) {
        (0, 0) => Name::None,
        (0, number) => Name::Given(number.to_string()),
        _ if !system.readable_string(far) => Name::Refused,
        _ => Name::Given(
            system
                .argument_string(far)
                .into_iter()
                .map(char::from)
                .collect(),
        ),
    }
}

/// A file's name as `OpenFile` gives it back: from the drive, in capitals.
fn full_path(system: &System, path: &str) -> String {
    let full = if path.contains(':') {
        path.to_string()
    } else {
        let mut current = system.files.path();

        if current.is_empty() {
            current = "C:\\".to_string();
        }

        format!("{current}{path}")
    };

    full.to_uppercase()
}

/// Writes a file whole; whether it could be made.
fn write_file(system: &mut System, path: &str, bytes: &[u8]) -> bool {
    let Some(handle) = system.files.create(path) else {
        return false;
    };
    let Some(file) = system.files.resolve(handle) else {
        return false;
    };

    if !bytes.is_empty() {
        file.write(bytes);
    }

    system.files.close(handle);
    true
}

/// A file's bytes, or none where there is none.
fn read_file(system: &mut System, path: &str) -> Option<Vec<u8>> {
    let handle = system.files.open(path)?;
    let bytes = system.files.resolve(handle).map(|file| {
        let size = file.size() as usize;

        file.read(size)
    });

    system.files.close(handle);
    bytes
}

/// A far pointer `offset` bytes into a block, across its 64K pieces.
pub(crate) fn far_at(far: u32, offset: u32) -> u32 {
    let segment = ((far >> 16) + ((offset >> 16) << 3)) & 0xffff;

    segment << 16 | ((far & 0xffff) + (offset & 0xffff)) & 0xffff
}

fn byte_in(system: &System, far: u32, at: u32) -> u8 {
    system.cpu.bus.read8(system.linear(far_at(far, at)))
}

fn word_in(system: &System, far: u32, at: u32) -> u16 {
    u16::from(byte_in(system, far, at)) | u16::from(byte_in(system, far, at.wrapping_add(1))) << 8
}

fn dword_in(system: &System, far: u32, at: u32) -> u32 {
    u32::from(word_in(system, far, at)) | u32::from(word_in(system, far, at.wrapping_add(2))) << 16
}

/// A global block, `GMEM_MOVEABLE`, holding bytes: its handle, nought where
/// there is no room.
fn write_block(system: &mut System, bytes: &[u8]) -> u16 {
    write_block_longer(system, bytes, 0)
}

/// A global block holding bytes, `extra` bytes longer than they are.
fn write_block_longer(system: &mut System, bytes: &[u8], extra: u32) -> u16 {
    let Some(index) = system.global.allocate(
        &mut system.cpu.bus,
        &mut system.descriptors,
        bytes.len() as u32 + extra,
        GMEM_MOVEABLE,
    ) else {
        return 0;
    };
    let block = handle_for(index);
    let far = system.lock_block(block);

    for (at, byte) in bytes.iter().enumerate() {
        let to = system.linear(far_at(far, at as u32));

        system.cpu.bus.write8(to, *byte);
    }

    block
}

fn global_free(system: &mut System, block: u16) {
    let _ = crate::memory::global_free(system, &mut Args::repeat(block));
}

/// A DOS date and time, as a file's `OFSTRUCT` keeps them.
fn dos_stamp(system: &System) -> Vec<u8> {
    let [year, month, day, hour, minute, second, _] = system.date();
    let date = year.wrapping_sub(1980) << 9 | month << 5 | day;
    let time = hour << 11 | minute << 5 | second >> 1;

    words_of(&[date, time])
}

/// The handle of a metafile on disk: its header of kind 2, six bytes, the
/// file's `OFSTRUCT`, in a block of 192 bytes (`diskmeta`). A path too long
/// for it makes the block longer.
fn disk_handle(system: &mut System, bytes: &[u8], path: &str) -> u16 {
    let name: Vec<u8> = path.chars().map(|char| char as u32 as u8).collect();
    let mut block = vec![0u8; 192];
    let header = bytes.len().min(18);

    block[..header].copy_from_slice(&bytes[..header]);
    block[0] = 2;
    block[1] = 0;

    let mut structure = vec![(8 + name.len()) as u8, 1, 0, 0];

    structure.extend(dos_stamp(system));
    structure.extend(&name);
    structure.push(0);

    if block.len() < 24 + structure.len() {
        block.resize(24 + structure.len(), 0);
    }

    block[24..24 + structure.len()].copy_from_slice(&structure);
    write_block(system, &block)
}

/// The path a metafile on disk's handle names.
fn path_of(system: &System, far: u32) -> String {
    (32..32 + 128)
        .map(|at| byte_in(system, far, at))
        .take_while(|&byte| byte != 0)
        .map(char::from)
        .collect()
}

/// Where a metafile's block is, locked: none for a handle of nought, one
/// that names no block, or a block whose kind is neither 1 nor 2.
fn metafile_of(system: &mut System, hmf: u16) -> Option<u32> {
    if hmf == 0 {
        return None;
    }

    let far = system.lock_block(hmf);

    if far == 0 {
        return None;
    }

    matches!(word_in(system, far, 0), 1 | 2).then_some(far)
}

/// The most bytes a metafile's header is taken at: 16 MiB, more memory
/// than the machine has.
const LARGEST: u64 = 0x0100_0000;

/// How many bytes a metafile's header says it is, read as far as that
/// whether or not its block holds them, to copy them (`CopyMetaFile`). One
/// that says more than `LARGEST` stops here, rather than make a buffer of
/// that many. Playing and enumerating read only the records, and take any
/// size.
fn total_of(system: &System, far: u32) -> Result<u32, Stop> {
    let total = u64::from(dword_in(system, far, 6)) * 2;

    if total > LARGEST {
        return Err(Stop::Unsupported(
            "a metafile whose header says it is larger than memory",
        ));
    }

    Ok(total as u32)
}

/// A metafile's bytes and whether it is on disk: in memory, its block's, as
/// many as its header says; on disk, its file's.
fn content_of(system: &mut System, hmf: u16) -> Result<Option<(Vec<u8>, bool)>, Stop> {
    let Some(far) = metafile_of(system, hmf) else {
        return Ok(None);
    };

    if word_in(system, far, 0) == 2 {
        let path = path_of(system, far);

        return Ok(read_file(system, &path).map(|bytes| (bytes, true)));
    }

    let total = total_of(system, far)?;

    Ok(Some((
        (0..total).map(|at| byte_in(system, far, at)).collect(),
        false,
    )))
}

/// A metafile to play: in memory, its own block; on disk, its file read
/// into a block of its own, freed when done.
struct Opened {
    far: u32,
    header: u16,
    objects: u16,
    loaded: Option<u16>,
}

impl Opened {
    fn of(system: &System, far: u32, loaded: Option<u16>) -> Self {
        Self {
            far,
            header: word_in(system, far, 2),
            objects: word_in(system, far, 10),
            loaded,
        }
    }

    fn done(&self, system: &mut System) {
        if let Some(block) = self.loaded {
            global_free(system, block);
        }
    }

    /// Each record's offset, the ending one left out. Only the records are
    /// read, so the header's size is taken at its word however large: the
    /// walk ends at the first record of no function, or past that size.
    fn records(&self, system: &System) -> Vec<u32> {
        let total = u64::from(dword_in(system, self.far, 6)) * 2;
        let mut records = Vec::new();
        let mut at = u64::from(self.header) * 2;

        while at + 6 <= total {
            // Past four gigabytes an offset wraps.
            let size = dword_in(system, self.far, at as u32);
            let function = word_in(system, self.far, (at as u32).wrapping_add(4));

            if function == 0 || size < 3 {
                break;
            }

            records.push(at as u32);
            at += u64::from(size) * 2;
        }

        records
    }
}

fn open_metafile(system: &mut System, hmf: u16) -> Result<Option<Opened>, Stop> {
    let Some(far) = metafile_of(system, hmf) else {
        return Ok(None);
    };

    if word_in(system, far, 0) != 2 {
        return Ok(Some(Opened::of(system, far, None)));
    }

    let Some((bytes, _)) = content_of(system, hmf)? else {
        return Ok(None);
    };
    let block = write_block(system, &bytes);
    let Some(loaded) = metafile_of(system, block) else {
        global_free(system, block);
        return Ok(None);
    };

    Ok(Some(Opened::of(system, loaded, Some(block))))
}

/// A handle table: the places a record's objects are made into and found
/// in. The engine's own while a metafile is played whole; a program's for
/// `PlayMetaFileRecord`, and for `EnumMetaFile`'s procedure.
enum Table {
    Own(Vec<u16>),
    Program { far: u32, size: u16 },
}

impl Table {
    fn size(&self) -> usize {
        match self {
            Self::Own(handles) => handles.len(),
            Self::Program { size, .. } => usize::from(*size),
        }
    }

    fn slot_far(far: u32, slot: usize) -> u32 {
        (far & 0xffff_0000) | (far.wrapping_add(slot as u32 * 2) & 0xffff)
    }

    fn get(&self, system: &System, slot: usize) -> u16 {
        match self {
            Self::Own(handles) => handles.get(slot).copied().unwrap_or(0),
            Self::Program { far, .. } => {
                let bytes = system.read_far(Self::slot_far(*far, slot), 2);

                u16::from_le_bytes([bytes[0], bytes[1]])
            }
        }
    }

    /// A place set. One past the engine's own table's size is set only to
    /// nought, which it holds already.
    fn set(&mut self, system: &mut System, slot: usize, handle: u16) {
        match self {
            Self::Own(handles) => {
                if let Some(held) = handles.get_mut(slot) {
                    *held = handle;
                }
            }
            Self::Program { far, .. } => {
                system.write_far(Self::slot_far(*far, slot), &handle.to_le_bytes());
            }
        }
    }

    /// An object made, put in the lowest free place, if there is one.
    fn place(&mut self, system: &mut System, handle: u16) {
        let size = self.size();
        let mut slot = 0;

        while slot < size && self.get(system, slot) != 0 {
            slot += 1;
        }

        if slot < size {
            self.set(system, slot, handle);
        }
    }
}

/// The `LOGFONT` a font's record holds, its face name to its nought or
/// the record's end.
fn logfont_of(system: &System, far: u32, size: u32) -> LogFont {
    let byte = |at: u32| byte_in(system, far, at);
    let signed = |at: u32| word_in(system, far, at) as i16;
    let mut face_name = String::new();
    let mut at = 24;

    while u64::from(at) < u64::from(size) * 2 && byte(at) != 0 {
        face_name.push(char::from(byte(at)));
        at += 1;
    }

    LogFont {
        height: signed(6),
        width: signed(8),
        escapement: signed(10),
        orientation: signed(12),
        weight: signed(14),
        italic: byte(16),
        underline: byte(17),
        strike_out: byte(18),
        char_set: byte(19),
        out_precision: byte(20),
        clip_precision: byte(21),
        quality: byte(22),
        pitch_and_family: byte(23),
        face_name,
    }
}

/// Plays one record at `far` into a device context, its objects in
/// `table`, as `PlayMetaFileRecord` plays it (`GDI.EXE` seg19 `0826`): a
/// call given only numbers is made through the function's own entry, its
/// address asked of GDI by its ordinal and kept (`096c`-`09be`), with the
/// record's words copied to the stack as its arguments (`13de`, `1c4b`-
/// `1c6f`); the rest are made by the function a program calls. So on a
/// printer driver's context each reaches the driver as a program's call
/// does: a colour its `ColorInfo`, a pen or brush its `RealizeObject`, a
/// figure its `Output` and text its `ExtTextOut`.
async fn play_record(engine: &Engine, hdc: u16, far: u32, table: &mut Table) -> Result<(), Stop> {
    let (function, driver) = {
        let system = engine.system();

        (
            word_in(&system, far, 4),
            super::printer_output::driver_of(&system, hdc),
        )
    };

    if let Some(dc) = driver
        && play_on_driver(engine, dc, hdc, far, function, table).await?
    {
        return Ok(());
    }

    // Played into a metafile's context, each call is kept there, as a
    // program's call is: GDI plays a record through the function itself
    // (seg19 `0826`), which keeps it.
    let into = match engine.system().handles.resolve(hdc) {
        Some(Object::Metafile(index)) => Some(index),
        _ => None,
    };

    if let Some(index) = into {
        return play_into(&mut engine.system(), index, hdc, far, table);
    }

    let waiting = play_at_once(&mut engine.system(), hdc, far, table)?;

    if let Some((answer, args)) = waiting {
        answer(engine, args).await?;
    }

    Ok(())
}

/// A record played into a metafile's context: each call that names the
/// context kept there as a program's call is, given what `play_at_once`
/// would give it, as the stack the call would have; the objects made and
/// deleted as `play_at_once` makes and deletes them.
#[allow(clippy::too_many_lines)]
fn play_into(
    system: &mut System,
    index: usize,
    hdc: u16,
    far: u32,
    table: &mut Table,
) -> Result<(), Stop> {
    let word = |system: &System, at: u32| word_in(system, far, at);
    let function = word(system, 4);
    let pointer = |at: u32| {
        let at = far_at(far, at);

        [at as u16, (at >> 16) as u16]
    };
    let kept = |system: &mut System, name: &str, words: &[u16]| {
        record(system, index, ordinal_of(name), name, &words_of(words));
    };

    match function {
        META_SELECTOBJECT => {
            let handle = table.get(system, usize::from(word(system, 6)));

            kept(system, "SelectObject", &[handle]);
        }
        META_TEXTOUT => {
            let count = word(system, 6);
            let after = 8 + ((u32::from(count) + 1) & !1);
            let [low, high] = pointer(8);

            kept(
                system,
                "TextOut",
                &[
                    count,
                    low,
                    high,
                    word(system, after),
                    word(system, after + 2),
                ],
            );
        }
        META_EXTTEXTOUT => {
            let count = word(system, 10);
            let options = word(system, 12);
            let has_rect = options & (ETO_OPAQUE | ETO_CLIPPED) != 0;
            let start = 14 + if has_rect { 8 } else { 0 };
            let [rect_low, rect_high] = if has_rect { pointer(14) } else { [0, 0] };
            let [low, high] = pointer(start);

            kept(
                system,
                "ExtTextOut",
                &[
                    0,
                    0,
                    count,
                    low,
                    high,
                    rect_low,
                    rect_high,
                    options,
                    word(system, 6),
                    word(system, 8),
                ],
            );
        }
        META_POLYGON | META_POLYLINE => {
            let [low, high] = pointer(8);
            let name = if function == META_POLYGON {
                "Polygon"
            } else {
                "Polyline"
            };

            kept(system, name, &[word(system, 6), low, high]);
        }
        META_POLYPOLYGON => {
            let polygons = word(system, 6);
            let [counts_low, counts_high] = pointer(8);
            let [low, high] = pointer(8 + u32::from(polygons) * 2);

            kept(
                system,
                "PolyPolygon",
                &[polygons, counts_low, counts_high, low, high],
            );
        }
        META_FILLREGION => {
            let region = table.get(system, usize::from(word(system, 6)));
            let brush = table.get(system, usize::from(word(system, 8)));

            if region != 0 && brush != 0 {
                kept(system, "FillRgn", &[brush, region]);
            }
        }
        META_PAINTREGION | META_INVERTREGION => {
            let region = table.get(system, usize::from(word(system, 6)));
            let name = if function == META_PAINTREGION {
                "PaintRgn"
            } else {
                "InvertRgn"
            };

            if region != 0 {
                kept(system, name, &[region]);
            }
        }
        META_CREATEPENINDIRECT
        | META_CREATEBRUSHINDIRECT
        | META_CREATEFONTINDIRECT
        | META_CREATEREGION
        | META_DELETEOBJECT => {
            play_at_once(system, hdc, far, table)?;
        }
        _ => {
            let ordinal = ordinal_of_function(function);
            let Some(export) = Kept::named("GDI").and_then(|gdi| gdi.export(ordinal)) else {
                return Ok(());
            };

            if BY_STACK.contains(&export.name) {
                let image: Vec<u8> = (0..u32::from(export.pops).saturating_sub(2))
                    .map(|at| byte_in(system, far, 6 + at))
                    .collect();

                record(system, index, ordinal, export.name, &image);
            }
        }
    }

    Ok(())
}

/// A record whose call a printer driver's context answers through its
/// driver, taken apart as `play_at_once` takes it and made so; false for
/// any other, which is played as on any context.
async fn play_on_driver(
    engine: &Engine,
    dc: usize,
    hdc: u16,
    far: u32,
    function: u16,
    table: &Table,
) -> Result<bool, Stop> {
    use super::printer_output as output;

    let word = |at: u32| word_in(&engine.system(), far, at);
    let signed = |at: u32| i32::from(word(at) as i16);

    match function {
        META_SELECTOBJECT => {
            let slot = usize::from(word(6));
            let handle = table.get(&engine.system(), slot);

            output::select_object(engine, dc, hdc, handle).await?;
        }
        META_TEXTOUT => {
            let count = word(6);
            let after = 8 + ((u32::from(count) + 1) & !1);

            output::driver_ext_text_out(
                engine,
                dc,
                signed(after + 2),
                signed(after),
                0,
                0,
                far_at(far, 8),
                count,
            )
            .await?;
        }
        META_EXTTEXTOUT => {
            let count = word(10);
            let options = word(12);
            let has_rect = options & (ETO_OPAQUE | ETO_CLIPPED) != 0;
            let start = 14 + if has_rect { 8 } else { 0 };
            let rect = if has_rect { far_at(far, 14) } else { 0 };

            output::driver_ext_text_out(
                engine,
                dc,
                signed(8),
                signed(6),
                options,
                rect,
                far_at(far, start),
                count,
            )
            .await?;
        }
        META_POLYGON | META_POLYLINE => {
            let count = word(6) as i16;

            if count >= 2 {
                let points = output::points_at(&engine.system(), far_at(far, 8), count);

                if function == META_POLYGON {
                    output::driver_polygon(engine, dc, &points, None).await?;
                } else {
                    output::driver_polyline(engine, dc, &points).await?;
                }
            }
        }
        _ => return Ok(false),
    }

    Ok(true)
}

/// Plays one record at `far` into a device context at once, its objects
/// in `table`. Calls given only numbers are made again from the record's
/// words, as their stack was; the rest are taken apart as `record` put
/// them together. A record of a function not known here is passed over.
/// A call given only numbers whose function takes its time is handed back
/// with its arguments, to be made.
#[allow(clippy::too_many_lines)]
fn play_at_once(
    system: &mut System,
    hdc: u16,
    far: u32,
    table: &mut Table,
) -> Result<Option<(Async, Args)>, Stop> {
    let byte = |system: &System, at: u32| byte_in(system, far, at);
    let word = |system: &System, at: u32| word_in(system, far, at);
    let signed = |system: &System, at: u32| word_in(system, far, at) as i16;
    let size = dword_in(system, far, 0);
    let function = word(system, 4);

    match function {
        META_CREATEPENINDIRECT => {
            let pen = super::objects::create_pen(
                system,
                signed(system, 6),
                signed(system, 8),
                dword_in(system, far, 12),
            );

            table.place(system, pen);
        }
        META_CREATEBRUSHINDIRECT => {
            let style = word(system, 6);
            let color = dword_in(system, far, 8);
            let brush = match style {
                BS_HATCHED => super::objects::brush_of(
                    system,
                    BS_HATCHED,
                    color,
                    i32::from(signed(system, 12)),
                ),
                BS_NULL => super::objects::brush_of(system, BS_NULL, 0, 0),
                _ => super::objects::create_solid_brush(system, color),
            };

            table.place(system, brush);
        }
        META_CREATEFONTINDIRECT => {
            let logfont = logfont_of(system, far, size);
            let font = super::objects::create_font_indirect(system, logfont);

            table.place(system, font);
        }
        META_SELECTOBJECT => {
            let handle = table.get(system, usize::from(word(system, 6)));

            super::dc::select_object(system, hdc, handle);
        }
        META_DELETEOBJECT => {
            let slot = usize::from(word(system, 6));
            let handle = table.get(system, slot);

            super::objects::delete_object(system, handle);
            table.set(system, slot, 0);
        }
        META_TEXTOUT => {
            let count = u32::from(word(system, 6));
            let after = 8 + ((count + 1) & !1);
            let text: Vec<u8> = (0..count).map(|at| byte(system, 8 + at)).collect();
            let (x, y) = (signed(system, after + 2), signed(system, after));

            super::text_out::text_out(system, hdc, i64::from(x), i64::from(y), &text)?;
        }
        META_EXTTEXTOUT => {
            let count = u32::from(word(system, 10));
            let options = word(system, 12);
            let has_rect = options & (ETO_OPAQUE | ETO_CLIPPED) != 0;
            let start = 14 + if has_rect { 8 } else { 0 };
            let text: Vec<u8> = (0..count).map(|at| byte(system, start + at)).collect();
            let rect = has_rect.then(|| Bounds {
                left: i64::from(signed(system, 14)),
                top: i64::from(signed(system, 16)),
                right: i64::from(signed(system, 18)),
                bottom: i64::from(signed(system, 20)),
            });
            let (x, y) = (signed(system, 8), signed(system, 6));

            super::text_out::ext_text_out(
                system,
                hdc,
                i64::from(x),
                i64::from(y),
                &text,
                Extra {
                    options,
                    rect,
                    dx: None,
                },
            )?;
        }
        META_POLYGON | META_POLYLINE => {
            // The record's count is a word, given here signed as the two
            // functions take theirs, so a count past 32767 draws nothing:
            // met only by a record whose points would reach past their
            // segment.
            let points = far_at(far, 8);
            let count = word(system, 6) as i16;

            if function == META_POLYGON {
                super::shapes::polygon(system, hdc, points, count);
            } else {
                super::shapes::polyline(system, hdc, points, count);
            }
        }
        // The points after the counts (seg19 `0ef5`).
        META_POLYPOLYGON => {
            let polygons = word(system, 6);

            super::shapes::poly_polygon(
                system,
                hdc,
                far_at(far, 8 + u32::from(polygons) * 2),
                far_at(far, 8),
                polygons as i16,
            );
        }
        // A region made of the record's scans (seg19 `10d7`).
        META_CREATEREGION => {
            let mut rows = Vec::new();
            let mut at = 28u32;
            let scans = word(system, 16);

            for _ in 0..scans {
                if u64::from(at) >= u64::from(size) * 2 {
                    break;
                }

                let sides = u32::from(word(system, at));
                let top = i32::from(signed(system, at + 2));
                let bottom = i32::from(signed(system, at + 4));

                for y in top..bottom {
                    let mut edge = 0;

                    while edge + 1 < sides {
                        rows.push((
                            y,
                            i32::from(signed(system, at + 6 + edge * 2)),
                            i32::from(signed(system, at + 8 + edge * 2)),
                        ));
                        edge += 2;
                    }
                }

                at += 8 + sides * 2;
            }

            let region = super::regions::allocate_region(
                system,
                winbox_raster::ClipRegion::from_spans(&rows),
            );

            table.place(system, region);
        }
        // The region by its place, and the brush (seg19 `109b`, `1057`,
        // `1079`).
        META_FILLREGION => {
            let region = table.get(system, usize::from(word(system, 6)));
            let brush = table.get(system, usize::from(word(system, 8)));

            if region != 0 && brush != 0 {
                super::regions::fill_rgn(system, hdc, region, brush)?;
            }
        }
        META_PAINTREGION | META_INVERTREGION => {
            let region = table.get(system, usize::from(word(system, 6)));

            if region != 0 {
                if function == META_PAINTREGION {
                    super::regions::paint_rgn_of(system, hdc, region)?;
                } else {
                    super::regions::invert_rgn_of(system, hdc, region);
                }
            }
        }
        _ => return play_by_stack(system, hdc, far, function),
    }

    Ok(None)
}

/// A call given only numbers made again: its words are its stack, less the
/// device context, read by the function as it reads its own. One that
/// answers at once is made here; one that takes its time -- a colour,
/// which a printer driver's context asks its driver -- is handed back with
/// its arguments, to be made.
fn play_by_stack(
    system: &mut System,
    hdc: u16,
    far: u32,
    function: u16,
) -> Result<Option<(Async, Args)>, Stop> {
    let Some(export) = Kept::named("GDI").and_then(|gdi| gdi.export(ordinal_of_function(function)))
    else {
        return Ok(None);
    };

    if !BY_STACK.contains(&export.name) {
        return Ok(None);
    }

    let base = system.base_of((far >> 16) as u16);
    let at = (far & 0xffff) + 6 + u32::from(export.pops).saturating_sub(2);
    let mut args = Args::after_first(hdc, base, at);

    match super::implementation(export.name) {
        Some(Implementation::Sync(answer)) => {
            answer(system, &mut args)?;
            Ok(None)
        }
        Some(Implementation::Async(answer)) => Ok(Some((answer, args))),
        None => Err(Stop::Missing {
            module: "GDI",
            name: export.name,
        }),
    }
}

/// A metafile's device context: in memory, or on disk where it is given a
/// file's name, which is made empty at once; nought where it cannot be.
fn create_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = match name_argument(system, far) {
        Name::Refused => return Ok(Answer::Word(0)),
        Name::None => None,
        Name::Given(name) => Some(name),
    };
    let mut meta = Recording {
        largest: 3,
        ..Recording::default()
    };

    if let Some(name) = name {
        let path = full_path(system, &name);

        if !write_file(system, &path, &[]) {
            return Ok(Answer::Word(0));
        }

        meta.path = Some(path);
    }

    Ok(Answer::Word(begin(system, meta)))
}

fn begin(system: &mut System, mut meta: Recording) -> u16 {
    // The black pen, the white brush and the device's default font (seg20
    // `1d75`-`1d9d`).
    meta.current[PEN] = super::objects::get_stock_object(system, 7);
    meta.current[BRUSH] = super::objects::get_stock_object(system, 0);
    meta.current[FONT] = super::objects::get_stock_object(system, 14);
    system.gdi.metafiles.push(Some(meta));

    let index = system.gdi.metafiles.len() - 1;

    system
        .handles
        .allocate(Kind::Atom, Object::Metafile(index))
        .unwrap_or(0)
}

/// A metafile begun in memory, as `CreateMetaFile` of no file begins one:
/// its device context.
pub(crate) fn create_in_memory(system: &mut System) -> u16 {
    begin(
        system,
        Recording {
            largest: 3,
            ..Recording::default()
        },
    )
}

/// `CloseMetaFile`: the metafile's handle, or nought.
pub(crate) fn close(system: &mut System, hdc: u16) -> u16 {
    let mut args = Args::repeat(hdc);

    close_metafile_call(system, &mut args).map_or(0, |answer| answer.value().unwrap_or(0) as u16)
}

/// `DeleteMetaFile`.
pub(crate) fn delete(system: &mut System, hmf: u16) {
    let mut args = Args::repeat(hmf);
    let _ = delete_metafile_call(system, &mut args);
}

/// The metafile a device context recorded, ended: its header, its records
/// and the record that ends them, in a block of its own, or written to its
/// file with a block that names it. Nought for a handle that is no
/// metafile's device context.
fn close_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(Object::Metafile(index)) = system.handles.resolve(hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(meta) = system.gdi.metafiles.get_mut(index).and_then(Option::take) else {
        return Ok(Answer::Word(0));
    };
    let size = 9 + meta.bytes.len() as u32 / 2 + 3;
    let mut bytes = words_of(&[
        1,
        9,
        0x300,
        size as u16,
        (size >> 16) as u16,
        meta.slots.len() as u16,
        meta.largest as u16,
        (meta.largest >> 16) as u16,
        0,
    ]);

    system.handles.free(hdc);
    bytes.extend(&meta.bytes);
    bytes.extend(words_of(&[3, 0, 0]));

    Ok(Answer::Word(match meta.path {
        Some(path) => {
            write_file(system, &path, &bytes);
            disk_handle(system, &bytes, &path)
        }
        // The block is nine words longer than the metafile: GDI makes it
        // its size in words and nine more (seg20 `1e42`-`1e5c`).
        None => write_block_longer(system, &bytes, 18),
    }))
}

/// Plays a metafile into a device context; the objects it made are
/// deleted after.
fn play_metafile(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, hmf) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        Ok(Answer::Word(u16::from(play(engine, hdc, hmf).await?)))
    })
}

/// `PlayMetaFile`: whether it played. The objects it made are deleted
/// after, as a program deletes them -- given back to a printer's driver
/// that realized them (`printer_output.rs`).
pub(crate) async fn play(engine: &Engine, hdc: u16, hmf: u16) -> Result<bool, Stop> {
    let (opened, records) = {
        let mut system = engine.system();
        let Some(opened) = open_metafile(&mut system, hmf)? else {
            return Ok(false);
        };
        let records = opened.records(&system);

        (opened, records)
    };
    let mut table = Table::Own(vec![0; usize::from(opened.objects)]);

    for at in records {
        play_record(engine, hdc, far_at(opened.far, at), &mut table).await?;
    }

    opened.done(&mut engine.system());

    if let Table::Own(handles) = table {
        for handle in handles.into_iter().filter(|&handle| handle != 0) {
            super::printer_output::delete_object(engine, handle).await?;
        }
    }

    Ok(true)
}

/// Plays one record, its objects in a program's handle table.
fn play_metafile_record(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, table, record, count) = {
            let system = engine.system();

            (
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.word(&system),
            )
        };

        play_record(
            engine,
            hdc,
            record,
            &mut Table::Program {
                far: table,
                size: count,
            },
        )
        .await?;

        Ok(Answer::Nothing)
    })
}

/// Calls a procedure with each record of a metafile but the last, a handle
/// table of as many objects as its header says, and that count, AX, DS and
/// ES the stack's; stops when it answers nought. The objects the records
/// made are deleted after, as `PlayMetaFile` deletes them.
fn enum_metafile(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, opened, procedure, lparam, block, table, records) = {
            let mut system = engine.system();
            let hdc = args.word(&system);
            let hmf = args.word(&system);
            let procedure = args.dword(&system);
            let lparam = args.dword(&system);
            let Some(opened) = open_metafile(&mut system, hmf)? else {
                return Ok(Answer::Word(0));
            };
            let size = (u32::from(opened.objects) * 2).max(2);
            let system = &mut *system;
            let block = system
                .global
                .allocate(
                    &mut system.cpu.bus,
                    &mut system.descriptors,
                    size,
                    GMEM_MOVEABLE | GMEM_ZEROINIT,
                )
                .map_or(0, handle_for);
            let table = system.lock_block(block);
            let records = opened.records(system);

            (hdc, opened, procedure, lparam, block, table, records)
        };

        for at in records {
            let stack = engine.system().cpu.segments[SS].selector;
            let (answer, _) = engine
                .call_with(
                    procedure,
                    &[
                        GuestArg::Word(hdc),
                        GuestArg::Long(table),
                        GuestArg::Long(far_at(opened.far, at)),
                        GuestArg::Word(opened.objects),
                        GuestArg::Long(lparam),
                    ],
                    &[
                        Register::Word(AX, stack),
                        Register::Segment(DS, stack),
                        Register::Segment(ES, stack),
                    ],
                )
                .await?;

            if answer as u16 == 0 {
                break;
            }
        }

        let mut system = engine.system();

        opened.done(&mut system);

        let held = Table::Program {
            far: table,
            size: opened.objects,
        };

        for slot in 0..usize::from(opened.objects) {
            let handle = held.get(&system, slot);

            if handle != 0 {
                super::objects::delete_object(&mut system, handle);
            }
        }

        global_free(&mut system, block);
        Ok(Answer::Word(1))
    })
}

/// A metafile's handle is its bits' block: the same handle.
fn get_metafile_bits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hmf = args.word(system);

    Ok(Answer::Word(if metafile_of(system, hmf).is_some() {
        hmf
    } else {
        0
    }))
}

fn set_metafile_bits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);

    Ok(Answer::Word(if metafile_of(system, block).is_some() {
        block
    } else {
        0
    }))
}

fn is_valid_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hmf = args.word(system);

    Ok(Answer::Word(u16::from(metafile_of(system, hmf).is_some())))
}

/// A metafile's block let go; one on disk leaves its file.
fn delete_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hmf = args.word(system);

    if hmf == 0 || system.global.size_of(index_for(hmf)) == 0 {
        return Ok(Answer::Word(0));
    }

    global_free(system, hmf);
    Ok(Answer::Word(1))
}

/// A copy: to a file, one on disk; to none, one in memory. A copy from one
/// kind to the other says three words more in its size (`diskmeta`).
fn copy_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hmf = args.word(system);
    let far = args.dword(system);
    let name = match name_argument(system, far) {
        Name::Refused => return Ok(Answer::Word(0)),
        Name::None => None,
        Name::Given(name) => Some(name),
    };
    let Some((mut bytes, disk)) = content_of(system, hmf)? else {
        return Ok(Answer::Word(0));
    };

    // One in memory to memory is its block, every byte of it (seg20
    // `207d`-`20ad`).
    if name.is_none() && !disk {
        let far = system.lock_block(hmf);
        let block: Vec<u8> = (0..system.global.size_of(index_for(hmf)))
            .map(|at| byte_in(system, far, at))
            .collect();

        return Ok(Answer::Word(write_block(system, &block)));
    }

    if disk != name.is_some() {
        let byte = |at: usize| u32::from(bytes.get(at).copied().unwrap_or(0));
        let size = (byte(6) | byte(7) << 8 | byte(8) << 16 | byte(9) << 24).wrapping_add(3);
        let start = bytes.len().min(6);
        let end = bytes.len().min(start + 4);

        bytes.splice(start..end, words_of(&[size as u16, (size >> 16) as u16]));
    }

    let Some(name) = name else {
        return Ok(Answer::Word(write_block(system, &bytes)));
    };
    let path = full_path(system, &name);

    if !write_file(system, &path, &bytes) {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(disk_handle(system, &bytes, &path)))
}

/// A metafile on disk, by its file's name: nought where there is none, or
/// it is no metafile in memory's form.
fn get_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Name::Given(name) = name_argument(system, far) else {
        return Ok(Answer::Word(0));
    };
    let path = full_path(system, &name);
    let Some(bytes) = read_file(system, &path) else {
        return Ok(Answer::Word(0));
    };

    if bytes.len() < 18 || u16::from_le_bytes([bytes[0], bytes[1]]) != 1 {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(disk_handle(system, &bytes, &path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_only_exports_of_gdi() {
        let gdi = Kept::named("GDI").unwrap();

        for name in DC_FIRST.iter().chain(BY_STACK) {
            assert_ne!(gdi.ordinal_of(name), 0, "{name}");
        }

        for &(name, _) in STRING_AFTER {
            assert!(DC_FIRST.contains(&name), "{name}");
        }
    }

    #[test]
    fn plays_each_call_kept_by_its_stack() {
        let gdi = Kept::named("GDI").unwrap();

        // Each record's function names its call again: an ordinal below 46,
        // or 300 more than its low byte (`Chord`, 348, is 30h).
        for name in BY_STACK {
            let ordinal = gdi.ordinal_of(name);

            assert_eq!(
                ordinal_of_function(function_of(ordinal, 4)),
                ordinal,
                "{name}"
            );
            assert!(super::super::implementation(name).is_some(), "{name}");
        }

        for (form, base) in EX_FORMS {
            assert_ne!(gdi.ordinal_of(form), 0, "{form}");
            assert!(BY_STACK.contains(base), "{base}");
        }
    }

    #[test]
    fn keeps_a_record_as_its_size_function_and_words() {
        let mut meta = Recording {
            largest: 3,
            ..Recording::default()
        };

        meta.emit(0x041b, words_of(&[14, 20, 2, 2]));
        meta.emit(META_SELECTOBJECT, vec![1]);

        assert_eq!(
            meta.bytes,
            [
                7, 0, 0, 0, 0x1b, 4, 14, 0, 20, 0, 2, 0, 2, 0, //
                4, 0, 0, 0, 0x2d, 1, 1, 0,
            ]
        );
        assert_eq!(meta.largest, 7);
    }

    /// A header that says more than memory holds: its records are walked to
    /// the first of no function, and only a copy of it, which would read
    /// every byte, stops.
    #[test]
    fn walks_the_records_of_a_header_larger_than_memory() {
        let mut system = System::new();
        let mut bytes = words_of(&[1, 9, 0x300, 0, 0x8000, 0, 5, 0, 0]);

        bytes.extend(words_of(&[5, 0, 0x020b, 7, 9]));
        bytes.extend(words_of(&[4, 0, 0x0102, 1]));
        bytes.extend(words_of(&[3, 0, 0]));

        let block = write_block(&mut system, &bytes);
        let far = metafile_of(&mut system, block).unwrap();

        assert_eq!(Opened::of(&system, far, None).records(&system), [18, 28]);
        assert_eq!(
            content_of(&mut system, block),
            Err(Stop::Unsupported(
                "a metafile whose header says it is larger than memory"
            ))
        );
    }

    /// An offset past four gigabytes wraps rather than overflows.
    #[test]
    fn reads_a_word_at_the_last_offset_there_is() {
        let mut system = System::new();
        let block = write_block(&mut system, &[0x34, 0x12]);
        let far = system.lock_block(block);

        assert_eq!(word_in(&system, far, u32::MAX) >> 8, 0x34);
        assert_eq!(dword_in(&system, far, u32::MAX - 1) >> 16, 0x1234);
    }

    #[test]
    fn reaches_across_a_blocks_pieces() {
        assert_eq!(far_at(0x1237_0010, 0x20), 0x1237_0030);
        assert_eq!(far_at(0x1237_fff0, 0x20), 0x1237_0010);
        assert_eq!(far_at(0x1237_0000, 0x1_0004), 0x123f_0004);
    }
}
