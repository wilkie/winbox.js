//! GDI's objects: pens, brushes, the stock fonts and the stock palette; the
//! stock objects at their fixed handles; and what `GetObject`,
//! `DeleteObject`, `UnrealizeObject` and `IsGDIObject` make of them.

use crate::call::{Answer, Args, Stop};
use crate::fonts::{Device, LogFont, Request};
use crate::handles::{Kind, Object, STOCK_FIRST};
use crate::system::System;

/// A pen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pen {
    /// Red, green, blue and alpha: alpha nought for a pen that draws
    /// nothing.
    pub color: [u8; 4],
    /// Its width and style, where it was made with them: a stock pen and a
    /// device context's first pen have neither.
    pub width: Option<i16>,
    pub style: Option<u16>,
    /// The `LOGPEN` it was made from, as `GetObject` answers it.
    pub logpen: Option<LogPen>,
}

/// A `LOGPEN`: its style, its width as a `POINT`, its colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogPen {
    pub style: u16,
    pub width: i16,
    pub y: i16,
    pub color: u32,
}

/// A brush.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Brush {
    /// Red, green, blue and alpha: alpha nought for a null brush.
    pub color: [u8; 4],
    /// A palette's colour, `PALETTEINDEX` or `PALETTERGB`, looked up where
    /// the brush is used.
    pub colorref: Option<u32>,
    /// A hatched brush's cells, eight by eight, set where its lines are.
    pub hatch: Option<[u8; 64]>,
    /// The `LOGBRUSH` it was made from, as `GetObject` answers it.
    pub logbrush: Option<LogBrush>,
    /// The stock object a device context's own first brush stands for.
    pub stock: Option<i16>,
    /// Where its pattern starts: the device context's brush origin when it
    /// was first selected, kept until `UnrealizeObject` (`brushrlz`).
    pub realised: Option<(i32, i32)>,
    /// A pattern brush's pixels, which it keeps of its bitmap.
    pub pattern: Option<winbox_raster::blit::Pattern>,
}

/// A `LOGBRUSH`: its style, colour and hatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogBrush {
    pub style: u16,
    pub color: u32,
    pub hatch: u16,
}

/// A font: a stock one, a face at a cell height in pixels as `STOCK_FONTS`
/// names it, to be realized -- the face's nearest strike to the cell --
/// where it is used; or one `CreateFontIndirect` made, the font mapper's
/// answer, with the `LOGFONT` it was made from, which `GetObject` hands
/// back.
#[derive(Debug, Clone, PartialEq)]
pub enum Font {
    Stock {
        face: &'static str,
        cell: u16,
    },
    Made {
        font: Box<winbox_raster::LogicalFont>,
        logfont: LogFont,
    },
}

/// A logical palette: only the default one, which `GetStockObject` gives
/// out, so far.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Palette {
    /// Its entries -- red, green, blue and flags -- or none for the stock
    /// palette's own.
    pub entries: Option<Vec<[u8; 4]>>,
    /// On a palette device, realized: each entry's slot of the system
    /// palette, and the slots it took for its own.
    pub slots: Option<Vec<usize>>,
    pub taken: Option<Vec<usize>>,
}

/// One of GDI's objects.
#[derive(Debug, Clone, PartialEq)]
pub enum GdiObject {
    Pen(Pen),
    Brush(Brush),
    Font(Font),
    Palette(Palette),
    /// A region of pixels.
    Region(winbox_raster::ClipRegion),
    Bitmap(Box<super::ddb::Bitmap>),
}

/// How many entries the stock `DEFAULT_PALETTE` has: the sixteen colours in
/// pairs about four more, **recorded** by `palette` on four displays.
const DEFAULT_ENTRIES: usize = 20;

const WHITE_BRUSH: i16 = 0;
const LTGRAY_BRUSH: i16 = 1;
const GRAY_BRUSH: i16 = 2;
const DKGRAY_BRUSH: i16 = 3;
const BLACK_BRUSH: i16 = 4;
const NULL_BRUSH: i16 = 5;
const WHITE_PEN: i16 = 6;
const BLACK_PEN: i16 = 7;
const NULL_PEN: i16 = 8;
/// The index nothing documents.
const STOCK_9: i16 = 9;
const DEFAULT_PALETTE: i16 = 15;

/// The font every device context starts with, before anything selects one.
pub const SYSTEM_FONT: i16 = 13;

/// What each stock font is: the face `GetTextFace` answers, and the cell
/// height in pixels whose strike's metrics agree field for field with
/// `GetTextMetrics`, recorded in `oracle/fixtures/text.json`.
///
/// Two are worth pointing at. `ANSI_VAR_FONT` asks for Helv, which no
/// installed file provides; `WIN.INI` substitutes MS Sans Serif, and the
/// reported face stays Helv. And `DEVICE_DEFAULT_FONT` is Courier on this
/// display driver, not a system font at all.
///
/// The size is a **cell height in pixels**, and an EGA is what says so.
/// Read as a point size, `ANSI_VAR_FONT` is MS Sans Serif at eight points,
/// which is thirteen rows on a VGA and ten on an EGA; Windows draws it
/// twelve rows tall on an EGA, which is that face's *ten* point strike.
/// Read as thirteen pixels it is the thirteen row strike on a VGA and the
/// twelve row one on an EGA -- the nearest either way, and where two are
/// equally near the shorter, which is the mapper's own two-to-one
/// preference. **Recorded**: six cells of the EGA glyph sweep turn on it
/// and every other stock font on both displays is unmoved.
pub fn stock_font(index: i16) -> Option<Font> {
    let (face, cell) = match index {
        10 => ("Terminal", 12), // OEM_FIXED_FONT
        11 => ("Courier", 13),  // ANSI_FIXED_FONT
        12 => ("Helv", 13),     // ANSI_VAR_FONT
        13 => ("System", 16),   // SYSTEM_FONT
        14 => ("Courier", 16),  // DEVICE_DEFAULT_FONT
        16 => ("Fixedsys", 15), // SYSTEM_FIXED_FONT
        _ => return None,
    };

    Some(Font::Stock { face, cell })
}

/// A stock object's handle, the same on every display (`gdinum`): from
/// `AC6h`, four apart, in their indices' order, but the default palette,
/// `B06h`, after the system's fixed font, `B02h`.
pub fn stock_handle(index: i16) -> u16 {
    match index {
        15 => 0xb06,
        16 => 0xb02,
        _ => STOCK_FIRST.wrapping_add((index as u16).wrapping_mul(4)),
    }
}

impl System {
    /// An object made, not yet given a handle: its index.
    pub(crate) fn gdi_object(&mut self, object: GdiObject) -> usize {
        self.gdi.objects.push(object);
        self.gdi.objects.len() - 1
    }

    /// An object given one of GDI's handles, from those its objects share
    /// (`gdinum`); nought where there are none left.
    pub(crate) fn gdi_allocate(&mut self, object: GdiObject) -> u16 {
        let index = self.gdi_object(object);

        self.handles
            .allocate(Kind::Gdi, Object::Gdi(index))
            .unwrap_or(0)
    }

    /// The object a handle stands for, if it is one of GDI's.
    pub fn gdi_object_of(&self, handle: u16) -> Option<(usize, &GdiObject)> {
        match self.handles.resolve(handle)? {
            Object::Gdi(index) => Some((index, &self.gdi.objects[index])),
            _ => None,
        }
    }
}

/// A `COLORREF`'s red, green and blue, and an alpha.
fn rgba(colorref: u32, alpha: u8) -> [u8; 4] {
    let [red, green, blue, _] = colorref.to_le_bytes();

    [red, green, blue, alpha]
}

/// Whether a `COLORREF` is a palette's: `PALETTEINDEX` or `PALETTERGB`.
fn is_palette_ref(colorref: u32) -> bool {
    matches!(colorref >> 24, 1 | 2)
}

/// A stock brush of a colour, its `LOGBRUSH` solid and the colour, as
/// `GetObject` tells of it (`brushobj`).
fn solid(red: u8, green: u8, blue: u8) -> GdiObject {
    let color = u32::from_le_bytes([red, green, blue, 0]);

    GdiObject::Brush(Brush {
        color: [red, green, blue, 0xff],
        colorref: None,
        hatch: None,
        logbrush: Some(LogBrush {
            style: 0,
            color,
            hatch: 0,
        }),
        stock: None,
        realised: None,
        pattern: None,
    })
}

/// A stock pen, and the `LOGPEN` `GetObject` tells of it: nought wide, of
/// its style and colour. **Recorded** by `stockdel` on four displays: the
/// null pen's is white, as the ninth's is.
fn stock_pen(color: [u8; 4], style: u16, colorref: u32) -> GdiObject {
    GdiObject::Pen(Pen {
        color,
        width: None,
        style: None,
        logpen: Some(LogPen {
            style,
            width: 0,
            y: 0,
            color: colorref,
        }),
    })
}

/// A stock object's handle: one for each, at its own place (`gdinum`).
/// **Recorded** by `patbrush`: the white brush a new device context has is
/// the one `GetStockObject` answers. Each is made the first time it is
/// asked for, and is never deleted (`delete_object`); nought for an index
/// there is no stock object of.
pub fn get_stock_object(system: &mut System, index: i16) -> u16 {
    if let Some(&made) = system.gdi.stock.get(&index)
        && system.handles.resolve(made).is_some()
    {
        return made;
    }

    let object = match index {
        WHITE_BRUSH => solid(0xff, 0xff, 0xff),
        LTGRAY_BRUSH => solid(0xc0, 0xc0, 0xc0),
        GRAY_BRUSH => solid(0x80, 0x80, 0x80),
        DKGRAY_BRUSH => solid(0x40, 0x40, 0x40),
        BLACK_BRUSH => solid(0x00, 0x00, 0x00),
        NULL_BRUSH => GdiObject::Brush(Brush {
            color: [0, 0, 0, 0],
            colorref: None,
            hatch: None,
            logbrush: Some(LogBrush {
                style: 1,
                color: 0,
                hatch: 0,
            }),
            stock: None,
            realised: None,
            pattern: None,
        }),
        WHITE_PEN => stock_pen([0xff, 0xff, 0xff, 0xff], 0, 0x00ff_ffff),
        BLACK_PEN => stock_pen([0x00, 0x00, 0x00, 0xff], 0, 0),
        NULL_PEN => stock_pen([0x00, 0x00, 0x00, 0x00], 5, 0x00ff_ffff),
        // A pen too, a null one, white, nought wide (`gdinum`, on four
        // displays).
        STOCK_9 => GdiObject::Pen(Pen {
            color: [0xff, 0xff, 0xff, 0x00],
            width: None,
            style: None,
            logpen: Some(LogPen {
                style: 5,
                width: 0,
                y: 0,
                color: 0x00ff_ffff,
            }),
        }),
        DEFAULT_PALETTE => {
            let handle = default_palette(system);

            system.gdi.stock.insert(index, handle);
            return handle;
        }
        _ => {
            let handle = stock_font_handle(system, index).unwrap_or(0);

            if handle != 0 {
                system.gdi.stock.insert(index, handle);
            }

            return handle;
        }
    };
    let at = stock_handle(index);
    let object = system.gdi_object(object);

    system.handles.assign(at, Object::Gdi(object));
    system.gdi.stock.insert(index, at);
    at
}

pub(crate) fn get_stock_object_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = args.signed(system);

    Ok(Answer::Word(get_stock_object(system, index)))
}

/// A stock font's handle, at its own place (`gdinum`): `GetStockObject`'s,
/// and a new device context's first font, by the same route, so that the
/// two cannot come to different conclusions about what the system font is.
///
/// The TypeScript engine realizes the font here, and answers `None` where
/// its face is not installed; the font is recorded here as its face and
/// cell, to be realized when the font manager is ported, and is always
/// there.
pub fn stock_font_handle(system: &mut System, index: i16) -> Option<u16> {
    let font = stock_font(index)?;
    let at = stock_handle(index);

    if system.handles.resolve(at).is_none() {
        let object = system.gdi_object(GdiObject::Font(font));

        system.handles.assign(at, Object::Gdi(object));
    }

    Some(at)
}

/// The stock `DEFAULT_PALETTE`: one object, at its own handle, made once.
pub fn default_palette(system: &mut System) -> u16 {
    if let Some(handle) = system.gdi.default_palette {
        return handle;
    }

    let handle = stock_handle(DEFAULT_PALETTE);
    let object = system.gdi_object(GdiObject::Palette(Palette::default()));

    system.handles.assign(handle, Object::Gdi(object));
    system.gdi.default_palette = Some(handle);
    handle
}

/// A brush of a solid colour. A palette's colour is looked up where the
/// brush is used: in the palette of the device context it draws in. What
/// `GetObject` tells of it is solid, the colour as it was asked for,
/// dithered on the display or not (`brushobj`); FIBS/W reads it back for
/// its dialogs' text.
pub fn create_solid_brush(system: &mut System, colorref: u32) -> u16 {
    system.gdi_allocate(GdiObject::Brush(Brush {
        color: rgba(colorref, 0xff),
        colorref: is_palette_ref(colorref).then_some(colorref),
        hatch: None,
        logbrush: Some(LogBrush {
            style: 0,
            color: colorref,
            hatch: 0,
        }),
        stock: None,
        realised: None,
        pattern: None,
    }))
}

pub(crate) fn create_solid_brush_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let colorref = args.dword(system);

    Ok(Answer::Word(create_solid_brush(system, colorref)))
}

const BS_NULL: u16 = 1;
const BS_HATCHED: u16 = 2;
const BS_PATTERN: u16 = 3;

/// A hatch's cells, eight by eight, set where its line is, as the VGA
/// paints them (`brushind`): lines through the fifth row and column, and
/// diagonals through the corners. `None` for a hatch there is none of.
pub fn hatch_cells(hatch: i32) -> Option<[u8; 64]> {
    let line: fn(usize, usize) -> bool = match hatch {
        0 => |_, y| y == 4,
        1 => |x, _| x == 4,
        2 => |x, y| x == y,
        3 => |x, y| x == 7 - y,
        4 => |x, y| x == 4 || y == 4,
        5 => |x, y| x == y || x == 7 - y,
        _ => return None,
    };
    let mut cells = [0; 64];

    for y in 0..8 {
        for x in 0..8 {
            cells[y * 8 + x] = u8::from(line(x, y));
        }
    }

    Some(cells)
}

/// A brush of a `LOGBRUSH`'s style, colour and hatch: its handle, or
/// nought.
///
/// `BS_PATTERN` takes a bitmap's handle in the hatch word, as
/// `CreatePatternBrush` does, and makes nothing of a handle that is not a
/// bitmap's.
pub fn brush_of(system: &mut System, style: u16, colorref: u32, hatch: i32) -> u16 {
    if style == BS_PATTERN {
        return super::brushes::create_pattern_brush_as(
            system,
            hatch as u16,
            LogBrush {
                style,
                color: colorref,
                hatch: hatch as u16,
            },
        );
    }

    system.gdi_allocate(GdiObject::Brush(Brush {
        color: rgba(colorref, if style == BS_NULL { 0 } else { 0xff }),
        colorref: is_palette_ref(colorref).then_some(colorref),
        hatch: if style == BS_HATCHED {
            hatch_cells(hatch)
        } else {
            None
        },
        logbrush: Some(LogBrush {
            style,
            color: colorref,
            hatch: hatch as u16,
        }),
        stock: None,
        realised: None,
        pattern: None,
    }))
}

/// A brush of any style, from a `LOGBRUSH`: its style, colour and hatch.
///
/// **Recorded** by `brushind`:
///
/// * `GetObject` answers the `LOGBRUSH` as it was given, the colour and the
///   hatch word kept whatever the style.
/// * `BS_NULL` makes a brush of its own, not the stock `NULL_BRUSH`, and
///   `FillRect` with it paints nothing.
/// * `BS_HATCHED` lines are the brush's colour over the device context's
///   background colour, which `FillRect` paints even in `TRANSPARENT` mode.
///   A hatch past `HS_DIAGCROSS`, and a style past those there are, paint
///   as `BS_SOLID` does.
/// * `BS_PATTERN` takes the bitmap's handle in the hatch word, as
///   `CreatePatternBrush` does.
pub(crate) fn create_brush_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let bytes = system.read_far(far, 8);
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let colorref = u32::from(word(2)) | u32::from(word(4)) << 16;

    Ok(Answer::Word(brush_of(
        system,
        word(0),
        colorref,
        i32::from(word(6)),
    )))
}

/// A hatched brush: `CreateBrushIndirect` of `BS_HATCHED`, the same
/// `LOGBRUSH` after (`brushind`).
pub(crate) fn create_hatch_brush(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hatch = args.signed(system);
    let colorref = args.dword(system);

    Ok(Answer::Word(brush_of(
        system,
        BS_HATCHED,
        colorref,
        i32::from(hatch),
    )))
}

const PS_NULL: u16 = 5;
const PS_INSIDEFRAME: u16 = 6;

/// A pen of a style, a width, the y of its width's `POINT`, and a colour.
/// `PS_NULL`, and a style past `PS_INSIDEFRAME`, draw nothing (`penind`).
pub fn pen_of(system: &mut System, style: u16, width: i16, y: i16, colorref: u32) -> u16 {
    let drawn = style != PS_NULL && style <= PS_INSIDEFRAME;

    system.gdi_allocate(GdiObject::Pen(Pen {
        color: rgba(colorref, if drawn { 0xff } else { 0 }),
        width: Some(width),
        style: Some(style),
        logpen: Some(LogPen {
            style,
            width,
            y,
            color: colorref,
        }),
    }))
}

/// A pen of a style, a width and a colour; its `LOGPEN`'s y nought.
pub fn create_pen(system: &mut System, style: i16, width: i16, colorref: u32) -> u16 {
    pen_of(system, style as u16, width, 0, colorref)
}

pub(crate) fn create_pen_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let style = args.signed(system);
    let width = args.signed(system);
    let colorref = args.dword(system);

    Ok(Answer::Word(create_pen(system, style, width, colorref)))
}

/// A pen from a `LOGPEN`: its style, its width as the x of a `POINT`, and
/// its colour. **Recorded** by `penind`: `GetObject` answers the `LOGPEN`
/// as it was given, the width's y too, where `CreatePen` gives a y of
/// nought.
pub(crate) fn create_pen_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let bytes = system.read_far(far, 10);
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let colorref = u32::from(word(6)) | u32::from(word(8)) << 16;

    Ok(Answer::Word(pen_of(
        system,
        word(0),
        word(2) as i16,
        word(4) as i16,
        colorref,
    )))
}

/// Whether a handle is a stock object's, which every program is given the
/// same handle of: one of `GetStockObject`'s, or a memory device context's
/// first bitmap, which in Windows is the one stock bitmap every memory
/// context starts with.
fn is_stock(system: &System, handle: u16, object: usize) -> bool {
    (0..=16).any(|index| stock_handle(index) == handle)
        || matches!(&system.gdi.objects[object], GdiObject::Bitmap(bitmap) if bitmap.pixels.placeholder)
}

/// An object deleted: a pen, a brush, a font, a palette or a bitmap; not a
/// device context. Its handle is given out again first, but a stock
/// object's (`gdinum`).
///
/// A stock object is not deleted at all, and the answer is yes: GDI marks
/// each as it makes them at start-up, `8000h` in the object's type word
/// (`GDI.EXE` 2:02AE, 2:0331), and `DeleteObject` answers 1 for an object
/// so marked, or one made private (`2000h`), before anything else
/// (1:194C). **Recorded** by `stockdel` on four displays: every stock
/// object, and the bitmap a memory device context starts with, survives
/// being deleted, twice, with the same handle and what `GetObject` tells
/// of it.
///
/// An object selected into a device context is deleted all the same
/// (`stockdel`); the context keeps its handle, which `SelectObject` gives
/// back when something else is selected (`deleted`). A bitmap deleted
/// while it is selected stays the device context's, as it does in the
/// TypeScript engine.
///
/// It is taken out of any metafile being recorded that holds it, by a
/// record of its own (`metafile`).
pub fn delete_object(system: &mut System, handle: u16) -> bool {
    let Some((object, _)) = system.gdi_object_of(handle) else {
        return false;
    };

    if is_stock(system, handle, object) {
        return true;
    }

    // The blocks a program was shown its bits in, if it asked (`gdi/heap.rs`).
    system.forget_bitmap(object);
    super::metafile::forget_in_metafiles(system, handle);

    system.handles.free(handle);
    system.gdi.deleted.insert(object, handle);
    true
}

/// The handle an object had, where a device context may still hold it: its
/// own, or the one it had when it was deleted (`stockdel`).
pub(crate) fn handle_held(system: &System, object: usize) -> Option<u16> {
    system
        .handles
        .lookup(Object::Gdi(object))
        .or_else(|| system.gdi.deleted.get(&object).copied())
}

pub(crate) fn delete_object_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(u16::from(delete_object(system, handle))))
}

/// A `LOGFONT` as GDI keeps it in a font object and `GetObject` copies it
/// out: the fields, the face's name and its nought, and no further --
/// eighteen bytes and the name's length and one (`GDI.EXE` 4:04F3), so a
/// font named Helv tells of 23 bytes however much room there is
/// (**recorded** by `stockdel`).
fn logfont_bytes(logfont: &LogFont) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(LogFont::SIZE);

    for word in [
        logfont.height,
        logfont.width,
        logfont.escapement,
        logfont.orientation,
        logfont.weight,
    ] {
        bytes.extend(word.to_le_bytes());
    }

    bytes.extend([
        logfont.italic,
        logfont.underline,
        logfont.strike_out,
        logfont.char_set,
        logfont.out_precision,
        logfont.clip_precision,
        logfont.quality,
        logfont.pitch_and_family,
    ]);
    bytes.extend(logfont.face_name.chars().take(31).map(|c| c as u8));
    bytes.push(0);
    bytes
}

/// A stock font's `LOGFONT`, as `GetObject` tells of it. **Recorded** by
/// `stockdel` on four displays.
///
/// Four are the same on every display, whatever the display's own fonts:
/// `OEM_FIXED_FONT` is Terminal twelve by eight on an EGA too, whose
/// Terminal is eight rows. `DEVICE_DEFAULT_FONT` is nothing but fixed
/// pitch. The system font and the system's fixed font are the display's,
/// GDI's `LOGFONT` for each made, as every recorded value fits, from the
/// header of the font it loads at start-up (inferred: `GDI.EXE`
/// 2:02C5-0335 makes them, not read through): its height and average width in
/// pixels, weight, style and character set, its face; output precision
/// `OUT_STRING_PRECIS`, clipping `CLIP_STROKE_PRECIS`, `PROOF_QUALITY`;
/// and its family with the pitch as a `LOGFONT` says it, 2 variable and 1
/// fixed, where the header's low bit is set for variable. VGASYS is 16 by
/// 7, bold; EGASYS 12 by 7; VGAFIX 15 by 8, regular; EGAFIX 10 by 8, bold.
fn stock_logfont(system: &mut System, index: i16) -> Option<LogFont> {
    let fixed = |height, width, char_set, pitch_and_family, face: &str| LogFont {
        height,
        width,
        char_set,
        clip_precision: 2,
        quality: 2,
        pitch_and_family,
        face_name: face.to_string(),
        ..LogFont::default()
    };

    match index {
        10 => Some(fixed(12, 8, 0xff, 1, "Terminal")),
        11 => Some(fixed(12, 9, 0, 1, "Courier")),
        12 => Some(fixed(12, 9, 0, 2, "Helv")),
        14 => Some(LogFont {
            pitch_and_family: 1,
            ..LogFont::default()
        }),
        13 | 16 => {
            let Some(Font::Stock { face, cell }) = stock_font(index) else {
                return None;
            };
            let font = system.fonts().realize(face, i32::from(cell))?;
            let entry = font.entry?;
            let header = &entry.header;
            let pitch = if header.pitch_and_family & 1 == 1 {
                2
            } else {
                1
            };

            Some(LogFont {
                height: header.pix_height as i16,
                width: header.avg_width as i16,
                weight: header.weight as i16,
                italic: header.italic,
                underline: header.underline,
                strike_out: header.strike_out,
                char_set: header.char_set,
                out_precision: 1,
                clip_precision: 2,
                quality: 2,
                pitch_and_family: header.pitch_and_family & 0xf0 | pitch,
                face_name: entry.name().to_string(),
                ..LogFont::default()
            })
        }
        _ => None,
    }
}

/// What an object is, put in a program's buffer, as much of it as there is
/// room for: how many bytes. `GDI.EXE` 4:04BB.
///
/// * A palette: its count of entries, a word. **Recorded** by `palette`.
/// * A pen: its `LOGPEN`, as it was given (`penind`); a stock pen's
///   (`stock_pen`).
/// * A brush: its `LOGBRUSH`, as it was given.
/// * A bitmap: the first ten bytes of its `BITMAP` (`bitmap_struct`), and
///   noughts to fill the room, however much: the answer is the room
///   (4:0571; **recorded** by `stockdel`, with room for 6, 14, 16 and 20).
///   No pointer to its bits is told.
/// * A font: its `LOGFONT` to the face's nought (`logfont_bytes`); a stock
///   font's (`stock_logfont`).
pub fn get_object(system: &mut System, handle: u16, size: i16, far: u32) -> u16 {
    let Some((_, object)) = system.gdi_object_of(handle) else {
        return 0;
    };

    if size <= 0 {
        return 0;
    }

    let bytes: Vec<u8> = match object {
        GdiObject::Bitmap(bitmap) => {
            let mut bytes = super::bitmaps::bitmap_struct(bitmap);

            bytes.truncate(10);
            bytes.resize(size as usize, 0);
            bytes
        }
        GdiObject::Palette(palette) => {
            let count = palette.entries.as_ref().map_or(DEFAULT_ENTRIES, Vec::len);

            (count as u16).to_le_bytes().to_vec()
        }
        GdiObject::Pen(Pen {
            logpen: Some(logpen),
            ..
        }) => [
            logpen.style,
            logpen.width as u16,
            logpen.y as u16,
            logpen.color as u16,
            (logpen.color >> 16) as u16,
        ]
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect(),
        GdiObject::Brush(Brush {
            logbrush: Some(logbrush),
            ..
        }) => {
            let mut bytes = logbrush.style.to_le_bytes().to_vec();

            bytes.extend(logbrush.color.to_le_bytes());
            bytes.extend(logbrush.hatch.to_le_bytes());
            bytes
        }
        GdiObject::Font(Font::Made { logfont, .. }) => logfont_bytes(logfont),
        GdiObject::Font(Font::Stock { .. }) => {
            let index = (0..=16).find(|&index| stock_handle(index) == handle);
            let Some(logfont) = index.and_then(|index| stock_logfont(system, index)) else {
                return 0;
            };

            logfont_bytes(&logfont)
        }
        _ => return 0,
    };
    let count = bytes.len().min(size as usize);

    system.write_far(far, &bytes[..count]);
    count as u16
}

pub(crate) fn get_object_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let size = args.signed(system);
    let far = args.dword(system);

    Ok(Answer::Word(get_object(system, handle, size, far)))
}

/// An object to be realized again as though new: a brush's pattern to
/// start afresh from the brush origin it is next selected at (`brushrlz`);
/// a palette's slots of the system palette given up (`palreal`). Any handle
/// that stands for something answers yes.
pub(crate) fn unrealize_object(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let Some(object) = system.handles.resolve(handle) else {
        return Ok(Answer::Word(0));
    };

    if let Object::Gdi(index) = object {
        match &mut system.gdi.objects[index] {
            GdiObject::Brush(brush) => brush.realised = None,
            GdiObject::Palette(palette) => {
                palette.slots = None;
                palette.taken = None;
            }
            _ => {}
        }
    }

    Ok(Answer::Word(1))
}

/// What kind of GDI object a handle is, or nought: 1 a pen, 2 a brush, 3 a
/// font, 4 a palette, 5 a bitmap, 6 a region, 7 a device context. A window,
/// nought and a deleted object are nought (`queries`).
pub fn is_gdi_object(system: &System, handle: u16) -> u16 {
    if handle == 0 {
        return 0;
    }

    match system.handles.resolve(handle) {
        Some(Object::Gdi(index)) => match system.gdi.objects[index] {
            GdiObject::Pen(_) => 1,
            GdiObject::Brush(_) => 2,
            GdiObject::Font(_) => 3,
            GdiObject::Palette(_) => 4,
            GdiObject::Region(_) => 6,
            GdiObject::Bitmap(_) => 5,
        },
        Some(Object::Dc(_)) => 7,
        _ => 0,
    }
}

pub(crate) fn is_gdi_object_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(is_gdi_object(system, handle)))
}

/// Gives a GDI object to another owner, so that it outlives the task that
/// made it. `COMMDLG.DLL` calls it (seg6 `0160`) for an object it keeps.
///
/// **Read out** of `GDI.EXE` (seg1 `76a2`): in Windows 3.1 it does nothing.
/// It takes its two words off the stack and returns, `retf 4`, with no
/// answer.
pub(crate) fn set_object_owner(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    args.word(system);
    Ok(Answer::Nothing)
}

/// A rectangle's region, its corners read as signed words: one given the
/// wrong way round is empty, not turned (`regions`).
pub fn create_rect_rgn(system: &mut System, left: i16, top: i16, right: i16, bottom: i16) -> u16 {
    system.gdi_allocate(GdiObject::Region(winbox_raster::ClipRegion::rect(
        i32::from(left),
        i32::from(top),
        i32::from(right),
        i32::from(bottom),
    )))
}

/// A font made of a `LOGFONT`: the font mapper's answer to it on the
/// display, with the structure kept as it was given but for the character
/// set and pitch the five names rewrite (`Request::new`), which GDI rewrites
/// in the object it keeps (`GDI.EXE` 3:006E, 3:0064; **recorded** by
/// `stockdel`: a font made of Helv with nought for its pitch tells of
/// variable pitch); nought where nothing answers.
pub fn create_font_indirect(system: &mut System, mut logfont: LogFont) -> u16 {
    let request = Request::new(&logfont, &Device::of(&system.display));
    let Some(font) = system.fonts().create(&request) else {
        return 0;
    };

    logfont.char_set = request.charset as u8;
    logfont.pitch_and_family = request.pitch_and_family as u8;

    system.gdi_allocate(GdiObject::Font(Font::Made {
        font: Box::new(font),
        logfont,
    }))
}

pub(crate) fn create_font_indirect_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let logfont = LogFont::read(&system.read_far(far, LogFont::SIZE));

    Ok(Answer::Word(create_font_indirect(system, logfont)))
}

/// `CreateFontIndirect` with the structure spread out into fourteen
/// arguments -- but for the precisions, which the TypeScript engine carries
/// no further and makes nought.
///
/// The quality is carried, where the TypeScript engine's `CreateFont` makes
/// it nought too: **recorded**, the `font` probe's proof quality requests,
/// made through `CreateFont`, are answered by strikes that are not
/// stretched, 72 records on each display -- which the TypeScript engine's
/// replay agrees with only by handing the quality to `CreateFontIndirect`
/// itself. With the outline faces answering, the probe now reaches them.
pub(crate) fn create_font_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let height = args.signed(system);
    let width = args.signed(system);
    let escapement = args.signed(system);
    let orientation = args.signed(system);
    let weight = args.signed(system);
    let mut byte = || args.word(system) as u8;
    let (italic, underline, strike_out, char_set) = (byte(), byte(), byte(), byte());
    let (_, _, quality, pitch_and_family) = (byte(), byte(), byte(), byte());
    let far = args.dword(system);
    let face_name = if far == 0 {
        String::new()
    } else {
        system
            .read_string(far)
            .into_iter()
            .map(char::from)
            .collect()
    };
    let logfont = LogFont {
        height,
        width,
        escapement,
        orientation,
        weight,
        italic,
        underline,
        strike_out,
        char_set,
        out_precision: 0,
        clip_precision: 0,
        quality,
        pitch_and_family,
        face_name,
    };

    Ok(Answer::Word(create_font_indirect(system, logfont)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A buffer of the program's, as a far pointer.
    fn buffer(system: &mut System) -> u32 {
        system.string_block(&" ".repeat(64))
    }

    #[test]
    fn places_the_stock_objects_at_their_own_handles() {
        let mut system = System::new();
        let recorded = [
            (0, 0xac6),
            (1, 0xaca),
            (2, 0xace),
            (3, 0xad2),
            (4, 0xad6),
            (5, 0xada),
            (6, 0xade),
            (7, 0xae2),
            (8, 0xae6),
            (9, 0xaea),
            (10, 0xaee),
            (11, 0xaf2),
            (12, 0xaf6),
            (13, 0xafa),
            (14, 0xafe),
            (15, 0xb06),
            (16, 0xb02),
        ];

        for (index, handle) in recorded {
            assert_eq!(get_stock_object(&mut system, index), handle, "{index}");
        }

        assert_eq!(get_stock_object(&mut system, 17), 0);
        assert_eq!(get_stock_object(&mut system, -1), 0);
        // The undocumented ninth: a null pen, white, nought wide (`gdinum`).
        let far = buffer(&mut system);

        assert_eq!(get_object(&mut system, 0xaea, 10, far), 10);
        assert_eq!(
            system.read_far(far, 10),
            [5, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0]
        );
        // The other stock pens tell of theirs (`stockdel`): the null pen's
        // is white too.
        assert_eq!(get_object(&mut system, 0xae6, 10, far), 10);
        assert_eq!(
            system.read_far(far, 10),
            [5, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0]
        );
        assert_eq!(get_object(&mut system, 0xae2, 10, far), 10);
        assert_eq!(system.read_far(far, 10), [0; 10]);
    }

    #[test]
    fn keeps_a_stock_object_that_is_deleted() {
        let mut system = System::new();
        let far = buffer(&mut system);

        // `stockdel`: deleted, twice, and still there, as it was.
        for index in 0..=16 {
            let handle = get_stock_object(&mut system, index);

            assert!(delete_object(&mut system, handle), "{index}");
            assert!(delete_object(&mut system, handle), "{index}");
            assert!(system.handles.resolve(handle).is_some(), "{index}");
            assert_eq!(get_stock_object(&mut system, index), handle, "{index}");
        }

        assert_eq!(get_object(&mut system, 0xad6, 16, far), 8);
        assert_eq!(get_object(&mut system, 0xb06, 16, far), 2);
        // A stock object's handle is not given out again.
        assert_eq!(create_solid_brush(&mut system, 0), 0xc6a);
    }

    #[test]
    fn deletes_an_object_while_it_is_selected() {
        let mut system = System::new();
        let hdc = crate::gdi::dc::create_compatible_dc(&mut system, 0);
        let far = buffer(&mut system);
        let pen = create_pen(&mut system, 0, 1, 0xff);
        let other = create_pen(&mut system, 0, 1, 0xff00);

        crate::gdi::dc::select_object(&mut system, hdc, pen);

        // `stockdel`: deleted, and gone, but the context keeps its handle.
        assert!(delete_object(&mut system, pen));
        assert_eq!(get_object(&mut system, pen, 16, far), 0);
        assert!(!delete_object(&mut system, pen));
        assert_eq!(crate::gdi::dc::select_object(&mut system, hdc, other), pen);
    }

    #[test]
    fn tells_of_a_font_to_its_name() {
        let mut system = System::new();
        let far = buffer(&mut system);
        let logfont = LogFont {
            height: 12,
            weight: 400,
            face_name: "Helv".to_string(),
            ..LogFont::default()
        };

        // Without the fonts, the stock fixed fonts' are still told
        // (`stockdel`): Terminal, eighteen bytes and nine.
        assert_eq!(get_stock_object(&mut system, 10), 0xaee);
        assert_eq!(get_object(&mut system, 0xaee, 50, far), 27);
        assert_eq!(system.read_far(far, 4), [12, 0, 8, 0]);
        assert_eq!(
            &system.read_far(far, 27)[13..],
            b"\xff\x00\x02\x02\x01Terminal\0"
        );

        if let Some(font) = (system.fonts().lookup("Helv").is_some())
            .then(|| create_font_indirect(&mut system, logfont))
        {
            // Helv is made variable pitch, in the object kept.
            assert_eq!(get_object(&mut system, font, 50, far), 23);
            assert_eq!(system.read_far(far, 18)[17], 2);
        }
    }

    #[test]
    fn tells_of_a_bitmap_to_the_room_given() {
        let mut system = System::new();
        let far = buffer(&mut system);
        let bitmap = crate::gdi::bitmaps::create_bitmap(&mut system, 8, 8, 1, 1, 0);

        // `stockdel`: ten bytes and noughts, the answer the room.
        assert_eq!(get_object(&mut system, bitmap, 6, far), 6);
        assert_eq!(get_object(&mut system, bitmap, 20, far), 20);
        assert_eq!(
            system.read_far(far, 20),
            [0, 0, 8, 0, 8, 0, 2, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        );
    }

    #[test]
    fn gives_the_last_handle_given_back_first() {
        let mut system = System::new();
        let brush = create_solid_brush(&mut system, 0x00ff_0000);
        let pen = create_pen(&mut system, 0, 1, 0);

        assert_eq!((brush, pen), (0xc6a, 0xc66));
        assert!(delete_object(&mut system, brush));
        // `reuse`: a pen the brush's.
        assert_eq!(create_pen(&mut system, 0, 1, 0), 0xc6a);
        assert!(!delete_object(&mut system, brush + 4));
        assert!(!delete_object(&mut system, 0));
    }

    #[test]
    fn tells_of_a_brush_as_it_was_given() {
        let mut system = System::new();
        let far = buffer(&mut system);
        let hatched = brush_of(&mut system, BS_HATCHED, 0x0102_0304, 0x1234);

        assert_eq!(get_object(&mut system, hatched, 8, far), 8);
        assert_eq!(system.read_far(far, 8), [2, 0, 4, 3, 2, 1, 0x34, 0x12]);
        assert_eq!(get_object(&mut system, hatched, 3, far), 3);
        assert_eq!(get_object(&mut system, hatched, 0, far), 0);

        let Some((_, GdiObject::Brush(brush))) = system.gdi_object_of(hatched) else {
            panic!("a brush");
        };

        // A palette's colour is kept to be looked up; a hatch past those
        // there are paints solid.
        assert_eq!(brush.colorref, Some(0x0102_0304));
        assert_eq!(brush.hatch, None);

        let cross = create_hatch_brush_of(&mut system, 4);
        let Some((_, GdiObject::Brush(brush))) = system.gdi_object_of(cross) else {
            panic!("a brush");
        };
        let cells = brush.hatch.unwrap();

        assert_eq!(cells[4], 1);
        assert_eq!(cells[4 * 8], 1);
        assert_eq!(cells[9], 0);
        // A pattern brush of no bitmap is none.
        assert_eq!(brush_of(&mut system, BS_PATTERN, 0, 0xc6a), 0);
    }

    fn create_hatch_brush_of(system: &mut System, hatch: i32) -> u16 {
        brush_of(system, BS_HATCHED, 0, hatch)
    }

    #[test]
    fn tells_of_a_pen_and_the_stock_palette() {
        let mut system = System::new();
        let far = buffer(&mut system);
        let pen = pen_of(&mut system, 6, -2, 7, 0x0012_3456);

        assert_eq!(get_object(&mut system, pen, 12, far), 10);
        assert_eq!(
            system.read_far(far, 10),
            [6, 0, 0xfe, 0xff, 7, 0, 0x56, 0x34, 0x12, 0]
        );

        let palette = get_stock_object(&mut system, DEFAULT_PALETTE);

        assert_eq!(get_object(&mut system, palette, 1, far), 1);
        assert_eq!(get_object(&mut system, palette, 14, far), 2);
        assert_eq!(system.read_far(far, 2), [20, 0]);
        // A stock font has no `LOGFONT`.
        let font = get_stock_object(&mut system, SYSTEM_FONT);

        assert_eq!(get_object(&mut system, font, 50, far), 0);
    }

    #[test]
    fn tells_what_kind_an_object_is() {
        let mut system = System::new();
        let pen = create_pen(&mut system, 0, 1, 0);
        let brush = create_solid_brush(&mut system, 0);
        let font = get_stock_object(&mut system, 10);
        let palette = get_stock_object(&mut system, DEFAULT_PALETTE);

        assert_eq!(is_gdi_object(&system, pen), 1);
        assert_eq!(is_gdi_object(&system, brush), 2);
        assert_eq!(is_gdi_object(&system, font), 3);
        assert_eq!(is_gdi_object(&system, palette), 4);
        assert_eq!(is_gdi_object(&system, 0), 0);
        delete_object(&mut system, pen);
        assert_eq!(is_gdi_object(&system, pen), 0);
    }
}
