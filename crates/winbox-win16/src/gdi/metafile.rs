//! Metafiles: GDI calls kept as records to be played again. **Recorded** by
//! `metafile`, which records calls into a memory metafile, dumps its bytes,
//! and plays it back whole and a record at a time.
//!
//! * A metafile is a header of nine words -- its kind, 1 for memory; 9, the
//!   header's own size; version 300h; its size in words; how many objects
//!   its handle table needs; its largest record in words; and nought -- then
//!   its records, and a record of three words that ends it.
//! * A record is its size in words, a doubleword; its function, a word; then
//!   what the call was given. For a call given only numbers, that is the
//!   call's own stack less the device context: its arguments last first, as
//!   they were pushed. The function's low byte is the call's ordinal in GDI
//!   and its high byte how many words those were: `Rectangle` is 041Bh.
//! * Where a call is given a pointer, the record holds what it points at:
//!   `TextOut` its count, then the text padded to a word, then y and x;
//!   `Polygon` and `Polyline` the count, then the points in order;
//!   `ExtTextOut` y, x, the count, the options, the rectangle, then the text.
//! * An object selected is made first, in the lowest free place of the
//!   metafile's handle table: a pen by `CreatePenIndirect` (02FAh) with its
//!   `LOGPEN`, a brush by `CreateBrushIndirect` (02FCh) with its `LOGBRUSH`, a
//!   font by `CreateFontIndirect` (02FBh) with its `LOGFONT`, the face name
//!   and its nought and two bytes more, to a word. Then `SelectObject`
//!   (012Dh) names its place. A stock object is made so too: the black pen
//!   with its width nought. `DeleteObject` of an object a metafile holds adds
//!   01F0h with its place there, and frees it.
//! * Every call made into a metafile's device context answers 1.
//! * A metafile's handle is the global block of its bytes: `GetMetaFileBits`
//!   and `SetMetaFileBits` give the same handle back. The block holds more
//!   than the metafile.
//! * `EnumMetaFile` calls its procedure with each record but the last, a
//!   handle table of as many objects as the header says, and that count;
//!   `PlayMetaFileRecord` plays one, as `PlayMetaFile` plays them all.
//!
//! Recorded only by the stack rule, not by `metafile` itself: `SetBkColor`,
//! `SetMapMode`, `SetPolyFillMode`, `SetStretchBltMode`,
//! `SetTextCharacterExtra`, `SetTextJustification`, the window and viewport
//! calls, `ExcludeClipRect`, `OffsetClipRgn`, `FloodFill`, `Pie` and `Chord`
//! -- but a record's function holds an ordinal in a byte, and `Chord` is
//! GDI's 348th: it is kept by no rule, and answers nought, as it does in the
//! TypeScript engine.
//! Not done, as the TypeScript engine does not do them: bitmaps, regions and
//! palettes in a metafile, and `PolyPolygon`; a call into a metafile that
//! is not kept answers nought.
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
//!   to none, a copy in memory. A copy from memory to disk or disk to memory
//!   says three words more in its header's size than it holds; one to its
//!   own kind, what it holds.
//!
//! A call is routed here where the call is taken, as the TypeScript
//! engine's dispatcher routes it: any of GDI's functions whose first
//! argument is a device context, given a metafile's (`recording`). The
//! export tables this engine is built from do not say which functions take
//! a device context first, so `DC_FIRST` names them, from the TypeScript
//! engine's table.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{AX, DS, DX, ES, SS};
use winbox_machine::{handle_for, index_for};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::fonts::LogFont;
use crate::handles::{Kind, Object};
use crate::modules::{Export, Kept};
use crate::system::System;

use super::objects::{Brush, Font, GdiObject, Pen};
use super::text_out::{Bounds, Extra};

/// A metafile's device context, being recorded.
#[derive(Debug, Clone, Default)]
pub struct Recording {
    /// The file it is kept in, for one on disk.
    path: Option<String>,
    /// The records made so far, bytes.
    bytes: Vec<u8>,
    /// The handle table: each place's object's handle, or nought.
    slots: Vec<u16>,
    /// The largest record in words, the ending one's three at least.
    largest: u32,
}

/// GDI's functions whose first argument is a device context, by the names
/// they are exported by: those a call into a metafile's device context is
/// kept as a record of, or answered nought by.
const DC_FIRST: &[&str] = &[
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

/// Calls given only numbers, kept as their stack: measured, and by the same
/// rule.
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
];

const META_SELECTOBJECT: u16 = 0x012d;
const META_DELETEOBJECT: u16 = 0x01f0;
const META_CREATEPENINDIRECT: u16 = 0x02fa;
const META_CREATEFONTINDIRECT: u16 = 0x02fb;
const META_CREATEBRUSHINDIRECT: u16 = 0x02fc;
const META_TEXTOUT: u16 = 0x0521;
const META_EXTTEXTOUT: u16 = 0x0a32;
const META_POLYGON: u16 = 0x0324;
const META_POLYLINE: u16 = 0x0325;

const ETO_OPAQUE: u16 = 2;
const ETO_CLIPPED: u16 = 4;

const BS_NULL: u16 = 1;
const BS_HATCHED: u16 = 2;

const GMEM_MOVEABLE: u16 = 0x0002;
const GMEM_ZEROINIT: u16 = 0x0040;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "CreateMetafile" => Implementation::Sync(create_metafile_call),
        "CloseMetafile" => Implementation::Sync(close_metafile_call),
        "PlayMetafile" => Implementation::Sync(play_metafile_call),
        "PlayMetafileRecord" => Implementation::Sync(play_metafile_record_call),
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
/// metafile's being recorded -- but `CloseMetafile`, which ends one -- and
/// whose string, if it is given one, can be read.
pub(crate) fn recording(
    system: &System,
    module: &str,
    export: Export,
    stack: u32,
    sp: u32,
) -> Option<usize> {
    if module != "GDI" || export.name == "CloseMetafile" || !DC_FIRST.contains(&export.name) {
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

/// A call into a metafile's device context kept as a record: its answer, 1
/// kept and nought not, in AX, and DX nought for one that answers a long;
/// AX and DX left for one that answers nothing. The call log is not told
/// its answer, as the TypeScript engine's watcher is not.
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
/// digits of the offset of one whose segment is nought, as the TypeScript
/// engine makes a string of the number it reads there.
fn kept_text(system: &System, far: u32) -> Vec<u8> {
    match (far >> 16, far & 0xffff) {
        (0, 0) => Vec::new(),
        (0, number) => number.to_string().into_bytes(),
        _ => system.argument_string(far),
    }
}

/// A call made into a metafile's device context, kept as a record, from
/// its stack less the device context. Answers what the call answers there:
/// 1 kept, nought not.
fn record(system: &mut System, index: usize, ordinal: u16, name: &str, image: &[u8]) -> u16 {
    let function = ((image.len() / 2) << 8) as u16 | (ordinal & 0xff);
    let (function, params) = match name {
        _ if BY_STACK.contains(&name) && ordinal < 0x100 => (function, image.to_vec()),
        "SelectObject" => return select_into(system, index, word_at(image, 0)),
        "TextOut" => {
            let count = word_at(image, 0) as i16;
            let text = kept_text(system, dword_at(image, 2));
            let mut params = words_of(&[count as u16]);

            params.extend_from_slice(super::text::sliced(&text, i32::from(count)));

            if count & 1 != 0 {
                params.push(0);
            }

            params.extend(words_of(&[word_at(image, 6), word_at(image, 8)]));
            (META_TEXTOUT, params)
        }
        "ExtTextOut" => {
            let count = word_at(image, 4);
            let text = kept_text(system, dword_at(image, 6));
            let rect = dword_at(image, 10);
            let mut params = words_of(&[
                word_at(image, 16),
                word_at(image, 18),
                count,
                word_at(image, 14),
            ]);

            if rect != 0 {
                params.extend(system.read_far(rect, 8));
            }

            params.extend_from_slice(super::text::sliced(&text, i32::from(count)));

            if count & 1 != 0 {
                params.push(0);
            }

            (META_EXTTEXTOUT, params)
        }
        "Polygon" | "Polyline" => {
            let count = word_at(image, 0) as i16;
            let mut params = words_of(&[count as u16]);

            params.extend(
                system.read_far(dword_at(image, 2), (i32::from(count) * 4).max(0) as usize),
            );
            (
                if name == "Polygon" {
                    META_POLYGON
                } else {
                    META_POLYLINE
                },
                params,
            )
        }
        _ => return 0,
    };

    if let Some(Some(meta)) = system.gdi.metafiles.get_mut(index) {
        meta.emit(function, params);
    }

    1
}

/// A `COLORREF` of a colour's red, green and blue.
fn colorref_of(color: [u8; 4]) -> u32 {
    u32::from(color[0]) | u32::from(color[1]) << 8 | u32::from(color[2]) << 16
}

/// The record that makes an object, or none for one a metafile does not
/// keep: a pattern brush, a bitmap, a region, a palette, a stock font.
fn making_of(system: &System, handle: u16) -> Option<(u16, Vec<u8>)> {
    let (_, object) = system.gdi_object_of(handle)?;

    match object {
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
        GdiObject::Brush(Brush {
            pattern: Some(_), ..
        }) => None,
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
        GdiObject::Font(Font::Made { logfont, .. }) => {
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
        _ => None,
    }
}

/// An object selected into a metafile: made in the lowest free place of its
/// handle table first, if it is not there already, then selected by its
/// place. A place that is free is found for a handle of nought, as the
/// TypeScript engine looks for it among the places.
fn select_into(system: &mut System, index: usize, handle: u16) -> u16 {
    let Some(Some(meta)) = system.gdi.metafiles.get(index) else {
        return 0;
    };
    let held = meta.slots.iter().position(|&held| held == handle);
    let slot = if let Some(slot) = held {
        slot
    } else {
        let Some((function, params)) = making_of(system, handle) else {
            return 0;
        };
        let Some(Some(meta)) = system.gdi.metafiles.get_mut(index) else {
            return 0;
        };
        let slot = meta
            .slots
            .iter()
            .position(|&held| held == 0)
            .unwrap_or(meta.slots.len());

        if slot == meta.slots.len() {
            meta.slots.push(handle);
        } else {
            meta.slots[slot] = handle;
        }

        meta.emit(function, params);
        slot
    };

    if let Some(Some(meta)) = system.gdi.metafiles.get_mut(index) {
        meta.emit(META_SELECTOBJECT, words_of(&[slot as u16]));
    }

    1
}

/// An object deleted: taken out of every metafile being recorded that holds
/// it, by a record of its own.
pub(crate) fn forget_in_metafiles(system: &mut System, handle: u16) {
    for meta in system.gdi.metafiles.iter_mut().flatten() {
        if let Some(slot) = meta.slots.iter().position(|&held| held == handle) {
            meta.emit(META_DELETEOBJECT, words_of(&[slot as u16]));
            meta.slots[slot] = 0;
        }
    }
}

/// A string argument naming a file, as the TypeScript engine reads one.
enum Name {
    /// A null pointer.
    None,
    /// A string; the digits of the offset of a pointer whose segment is
    /// nought, as the TypeScript engine makes a string of the number it
    /// reads there.
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

    if !bytes.is_empty()
        && let Some(file) = system.files.resolve(handle)
    {
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
fn far_at(far: u32, offset: u32) -> u32 {
    let segment = ((far >> 16) + ((offset >> 16) << 3)) & 0xffff;

    segment << 16 | ((far & 0xffff) + (offset & 0xffff)) & 0xffff
}

fn byte_in(system: &System, far: u32, at: u32) -> u8 {
    system.cpu.bus.read8(system.linear(far_at(far, at)))
}

fn word_in(system: &System, far: u32, at: u32) -> u16 {
    u16::from(byte_in(system, far, at)) | u16::from(byte_in(system, far, at + 1)) << 8
}

fn dword_in(system: &System, far: u32, at: u32) -> u32 {
    u32::from(word_in(system, far, at)) | u32::from(word_in(system, far, at + 2)) << 16
}

/// A global block, `GMEM_MOVEABLE`, holding bytes: its handle, nought where
/// there is no room.
fn write_block(system: &mut System, bytes: &[u8]) -> u16 {
    let Some(index) = system.global.allocate(
        &mut system.cpu.bus,
        &mut system.descriptors,
        bytes.len() as u32,
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
/// for it makes the block longer, as the TypeScript engine's array grows.
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
/// whether or not its block holds them, as the TypeScript engine reads
/// them. One that says more than `LARGEST` stops here, where the TypeScript
/// engine would try to make an array of that many.
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

    /// Each record's offset, the ending one left out.
    fn records(&self, system: &System) -> Result<Vec<u32>, Stop> {
        let total = total_of(system, self.far)?;
        let mut records = Vec::new();
        let mut at = u64::from(self.header) * 2;

        while at + 6 <= u64::from(total) {
            let size = dword_in(system, self.far, at as u32);
            let function = word_in(system, self.far, at as u32 + 4);

            if function == 0 || size < 3 {
                break;
            }

            records.push(at as u32);
            at += u64::from(size) * 2;
        }

        Ok(records)
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
/// `table`. Calls given only numbers are made again from the record's
/// words, as their stack was; the rest are taken apart as `record` put
/// them together. A record of a function not known here is passed over.
fn play_record(system: &mut System, hdc: u16, far: u32, table: &mut Table) -> Result<(), Stop> {
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
            let points = far_at(far, 8);
            let count = word(system, 6) as i16;

            if function == META_POLYGON {
                super::shapes::polygon(system, hdc, points, count);
            } else {
                super::shapes::polyline(system, hdc, points, count);
            }
        }
        _ => play_by_stack(system, hdc, far, function)?,
    }

    Ok(())
}

/// A call given only numbers made again: its words are its stack, less the
/// device context, read by the function as it reads its own.
fn play_by_stack(system: &mut System, hdc: u16, far: u32, function: u16) -> Result<(), Stop> {
    let Some(export) = Kept::named("GDI").and_then(|gdi| gdi.export(function & 0xff)) else {
        return Ok(());
    };

    if !BY_STACK.contains(&export.name) {
        return Ok(());
    }

    let answer = match super::implementation(export.name) {
        Some(Implementation::Sync(answer)) => answer,
        Some(Implementation::Async(_)) => {
            return Err(Stop::Unsupported(
                "a metafile's record of a call that waits",
            ));
        }
        None => {
            return Err(Stop::Missing {
                module: "GDI",
                name: export.name,
            });
        }
    };
    let base = system.base_of((far >> 16) as u16);
    let at = (far & 0xffff) + 6 + u32::from(export.pops).saturating_sub(2);

    answer(system, &mut Args::after_first(hdc, base, at))?;
    Ok(())
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

    system.gdi.metafiles.push(Some(meta));

    let index = system.gdi.metafiles.len() - 1;

    Ok(Answer::Word(
        system
            .handles
            .allocate(Kind::Atom, Object::Metafile(index))
            .unwrap_or(0),
    ))
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
        None => write_block(system, &bytes),
    }))
}

/// Plays a metafile into a device context; the objects it made are
/// deleted after.
fn play_metafile_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let hmf = args.word(system);
    let Some(opened) = open_metafile(system, hmf)? else {
        return Ok(Answer::Word(0));
    };
    let mut table = Table::Own(vec![0; usize::from(opened.objects)]);

    for at in opened.records(system)? {
        play_record(system, hdc, far_at(opened.far, at), &mut table)?;
    }

    opened.done(system);

    if let Table::Own(handles) = table {
        for handle in handles.into_iter().filter(|&handle| handle != 0) {
            super::objects::delete_object(system, handle);
        }
    }

    Ok(Answer::Word(1))
}

/// Plays one record, its objects in a program's handle table.
fn play_metafile_record_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let table = args.dword(system);
    let record = args.dword(system);
    let count = args.word(system);

    play_record(
        system,
        hdc,
        record,
        &mut Table::Program {
            far: table,
            size: count,
        },
    )?;

    Ok(Answer::Nothing)
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
            let records = opened.records(system)?;

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
    fn plays_each_call_kept_by_its_stack_at_once_but_chord() {
        let gdi = Kept::named("GDI").unwrap();

        // `Chord`'s ordinal is past a byte: never kept by its stack.
        for name in BY_STACK.iter().filter(|&&name| name != "Chord") {
            assert!(gdi.ordinal_of(name) < 0x100, "{name}");
            assert!(
                matches!(
                    super::super::implementation(name),
                    Some(Implementation::Sync(_))
                ),
                "{name}"
            );
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

    #[test]
    fn reaches_across_a_blocks_pieces() {
        assert_eq!(far_at(0x1237_0010, 0x20), 0x1237_0030);
        assert_eq!(far_at(0x1237_fff0, 0x20), 0x1237_0010);
        assert_eq!(far_at(0x1237_0000, 0x1_0004), 0x123f_0004);
    }
}
