//! GDI's drawing other than text, onto the pixels a device context draws on
//! (`System::draw_target`), as winbox.js's surfaces draw: the brush realised
//! and combined under a raster operation (`PatBlt`, `BitBlt`, `StretchBlt`,
//! USER's `FillRect`, `FrameRect` and `InvertRect`), single pixels
//! (`SetPixel`, `GetPixel`), and a DIB drawn straight to a device context.
//! Lines and shapes are `shapes`; regions and the clip region `regions`;
//! pattern brushes `brushes`.
//!
//! Every surface here is a device-dependent bitmap -- a memory device
//! context's, the screen's, or a window's view of the screen -- worked on as
//! indices in place: the TypeScript engine's other kind, an RGBA canvas of a
//! page, is not here, and nothing of the raster desktop reaches it.

use std::rc::Rc;

use winbox_raster::blit::{self, Brush as Paintbrush, Pattern, Source, Target};
use winbox_raster::colour_match::matched_index;
use winbox_raster::palette_colour::{SurfacePalette, colour_of};
use winbox_raster::stretch::{Axis, stretch_columns, stretch_map, stretch_rows};
use winbox_raster::{Color, DeviceBitmap, SharedPalette, palette_for_display};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::surface::UNDRAWN;
use crate::system::System;

use super::dc::{DcBitmap, dc_of, screen_origin};
use super::mapping::{Mapping, mapping_of};
use super::objects::GdiObject;

pub(crate) const PATCOPY: u32 = 0x00f0_0021;
const SRCCOPY: u32 = 0x00cc_0020;
const DSTINVERT: u32 = 0x0055_0009;

/// `BLACKONWHITE` and `COLORONCOLOR`.
const BLACKONWHITE: u16 = 1;
const COLORONCOLOR: u16 = 3;

/// What `GetPixel` and `SetPixel` answer for a point they have no pixel
/// for.
const CLR_INVALID: u32 = 0xffff_ffff;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "PatBlt" => pat_blt_call,
        "BitBlt" => bit_blt_call,
        "StretchBlt" => stretch_blt_call,
        "SetPixel" => set_pixel_call,
        "GetPixel" => get_pixel_call,
        "SetDIBitsToDevice" => set_dibits_to_device_call,
        "StretchDIBits" => stretch_dibits_call,
        "CreatePatternBrush" => super::brushes::create_pattern_brush_call,
        "CreateDIBPatternBrush" => super::brushes::create_dib_pattern_brush_call,
        _ => {
            return super::shapes::implementation(name)
                .or_else(|| super::regions::implementation(name));
        }
    }))
}

/// USER's own drawing with a brush.
pub fn user_implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "FillRect" => fill_rect_call,
        "FrameRect" => frame_rect_call,
        "InvertRect" => invert_rect_call,
        _ => return None,
    }))
}

/// A word read as the signed number it is.
pub(crate) fn signed(word: u16) -> i32 {
    i32::from(word as i16)
}

/// The pixels a device context draws on, kept to its clip region: the
/// TypeScript engine keeps the region on the bitmap's own context while
/// the bitmap is the device context's, which every drawing here reaches
/// the pixels through.
pub(crate) fn canvas(system: &mut System, dc: usize) -> Option<DeviceBitmap> {
    let mut bitmap = system.draw_target(dc)?;

    if let Some(clip) = system.gdi.dcs[dc].state.clip.clone() {
        bitmap.context.dc_clip = Some(Rc::new(move |x, y| clip.contains(x, y)));
    }

    Some(bitmap)
}

/// A device context's mapping, where it moves any coordinate.
pub(crate) fn mapped(system: &System, dc: usize) -> Option<Mapping> {
    let m = mapping_of(system, dc);

    (!m.is_identity()).then_some(m)
}

/// A logical point in device terms.
pub(crate) fn device_point(m: &Mapping, x: i32, y: i32) -> (i32, i32) {
    (
        m.device_x(i64::from(x)) as i32,
        m.device_y(i64::from(y)) as i32,
    )
}

/// Logical corners as device corners in order: left, top, right, bottom.
pub(crate) fn device_rect(m: &Mapping, rect: [i32; 4]) -> [i32; 4] {
    let (x0, y0) = device_point(m, rect[0], rect[1]);
    let (x1, y1) = device_point(m, rect[2], rect[3]);

    [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]
}

/// A logical rectangle, an edge and an extent on each axis, in device
/// terms: both of its corners mapped, the extent negative where the
/// mapping turns the axis over.
fn device_box(m: &Mapping, x: i32, y: i32, width: i32, height: i32) -> (i32, i32, i32, i32) {
    let (left, top) = device_point(m, x, y);
    let (right, bottom) = device_point(m, x + width, y + height);

    (left, top, right - left, bottom - top)
}

/// A `COLORREF` in a device context drawing on a bitmap of `palette`: a
/// palette's colour looked up in the stock palette, as no logical palette
/// is selected into a device context here.
pub(crate) fn colour_in(palette: &SharedPalette, colorref: u32) -> Color {
    colour_of(
        colorref,
        &SurfacePalette {
            entries: None,
            slots: None,
            device: Some(&palette.borrow()),
        },
    )
}

/// A device context's background colour: white for a new one.
pub(crate) fn back_colour(system: &System, dc: usize, palette: &SharedPalette) -> Color {
    system.gdi.dcs[dc]
        .state
        .back_color
        .map_or(Color::rgb(0xff, 0xff, 0xff), |colorref| {
            colour_in(palette, colorref)
        })
}

/// A device context's text colour, where one was set.
pub(crate) fn text_colour(system: &System, dc: usize, palette: &SharedPalette) -> Option<Color> {
    system.gdi.dcs[dc]
        .state
        .text_color
        .map(|colorref| colour_in(palette, colorref))
}

/// The colour a device's palette has for the one it draws `colour` as.
pub(crate) fn in_device(system: &System, palette: &SharedPalette, colour: Color) -> Color {
    let mut palette = palette.borrow_mut();
    let index = matched_index(
        system.display_kind(),
        &mut palette,
        colour.red(),
        colour.green(),
        colour.blue(),
    );
    let [red, green, blue] = palette.colours.get(index).copied().unwrap_or([0, 0, 0]);

    Color::rgb(red, green, blue)
}

/// What paints a raster operation's pattern: the device context's own
/// brush, another brush, or a colour made a brush of its own for the
/// while, never realised, its pattern from the bitmap's corner.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Paint {
    Selected,
    Object(usize),
    Colour(Color),
}

/// A brush as one raster operation draws it.
struct Realised {
    colour: Option<Color>,
    hatch: Option<[u8; 64]>,
    pattern: Option<Pattern>,
    origin: (i32, i32),
}

fn realised(system: &System, dc: usize, palette: &SharedPalette, paint: Paint) -> Realised {
    let object = match paint {
        Paint::Colour(colour) => {
            return Realised {
                colour: Some(colour),
                hatch: None,
                pattern: None,
                origin: (0, 0),
            };
        }
        Paint::Selected => system.gdi.dcs[dc].state.brush,
        Paint::Object(object) => object,
    };
    let GdiObject::Brush(brush) = &system.gdi.objects[object] else {
        return Realised {
            colour: None,
            hatch: None,
            pattern: None,
            origin: (0, 0),
        };
    };
    let [red, green, blue, alpha] = brush.color;
    let colour = brush.colorref.map_or_else(
        || Color::rgba(red, green, blue, alpha),
        |colorref| colour_in(palette, colorref),
    );
    // Where the brush was realised, on the screen, less the device
    // context's corner there; its corner, for a brush not yet realised.
    let origin = brush.realised.map_or((0, 0), |(x, y)| {
        let (cx, cy) = screen_origin(system, dc);

        (x - cx, y - cy)
    });

    Realised {
        colour: Some(colour),
        hatch: brush.hatch,
        pattern: brush.pattern.clone(),
        origin,
    }
}

/// A source of a raster operation, owned.
pub(crate) struct Sourced {
    pub bitmap: DeviceBitmap,
    pub width: i32,
    pub height: i32,
    pub back: Option<Color>,
}

impl Sourced {
    fn borrowed(&self) -> Source<'_> {
        Source {
            bitmap: &self.bitmap,
            width: self.width,
            height: self.height,
            back: self.back,
        }
    }
}

/// A device context as a source: its pixels, as large as its bitmap, and
/// its background colour.
fn source_of(system: &mut System, dc: usize) -> Option<Sourced> {
    let bitmap = system.draw_target(dc)?;
    let back = back_colour(system, dc, &bitmap.device_palette);

    Some(Sourced {
        width: bitmap.width(),
        height: bitmap.height(),
        bitmap,
        back: Some(back),
    })
}

/// One raster operation onto the pixels a device context draws on, its
/// pattern `paint`. See `winbox_raster::blit::raster_op`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn raster_op(
    system: &System,
    dc: usize,
    bitmap: &DeviceBitmap,
    paint: Paint,
    rect: (i32, i32, i32, i32),
    rop: u32,
    source: Option<&Sourced>,
    sx: i32,
    sy: i32,
) {
    let palette = &bitmap.device_palette;
    let brush = realised(system, dc, palette, paint);
    let target = Target {
        bitmap,
        brush: Paintbrush {
            colour: brush.colour,
            hatch: brush.hatch.as_ref(),
            pattern: brush.pattern.as_ref(),
        },
        back: back_colour(system, dc, palette),
        text: text_colour(system, dc, palette),
        origin: brush.origin,
        realized: None,
    };
    let source = source.map(Sourced::borrowed);

    blit::raster_op(
        system.display_kind(),
        &target,
        rect.0,
        rect.1,
        rect.2,
        rect.3,
        rop,
        source.as_ref(),
        sx,
        sy,
    );
}

/// Combines the selected brush with a rectangle of a device context under
/// a raster operation that reads no source: `PATCOPY`, `PATINVERT`,
/// `DSTINVERT`, `BLACKNESS`, `WHITENESS` and the rest. The rectangle's right
/// and bottom edges are outside it, recorded by `bitbits`. Each of the
/// sixteen operations is its truth table over the brush's colour indices
/// and the destination's, colour patterns and hatches too, and a hatched
/// brush's background is the background colour whatever the background
/// mode (`patrops`).
///
/// A width or height below nought reaches back from the corner given: a
/// height of -1 at 27 is row 26. The Towers from Hanoi of the corpus draws
/// its tool bar's bottom edge so, and Windows' screen shows it. An
/// operation that reads a source, which `PatBlt` has not got, draws nothing,
/// and succeeds: `SRCCOPY`, `SRCPAINT`, `SRCINVERT` and `NOTSRCCOPY` leave
/// the destination as it was (`patrops`).
pub fn pat_blt(system: &mut System, hdc: u16, rect: [i32; 4], rop: u32) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let [mut x, mut y, mut width, mut height] = rect;

    if let Some(m) = mapped(system, dc) {
        let [left, top, right, bottom] = device_rect(&m, [x, y, x + width, y + height]);

        (x, y, width, height) = (left, top, right - left, bottom - top);
    }

    if width < 0 {
        x += width;
        width = -width;
    }

    if height < 0 {
        y += height;
        height = -height;
    }

    let code = (rop >> 16) & 0xff;

    if ((code >> 2) ^ code) & 0x33 != 0 {
        return 1;
    }

    if let Some(bitmap) = canvas(system, dc) {
        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Selected,
            (x, y, width, height),
            rop,
            None,
            0,
            0,
        );
    }

    1
}

fn pat_blt_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));
    let rop = args.dword(system);

    Ok(Answer::Word(pat_blt(system, hdc, rect, rop)))
}

/// Combines a rectangle of one device context into another under a raster
/// operation: any of the 256, each its own truth table over the brush, the
/// source and the destination, applied bit by bit to palette indices (see
/// `kb/gdi/bitblt.md` for what the `bitblt` probe recorded). Where a mapping
/// mode is in play, both rectangles are in device terms; if they come out
/// different sizes, it stretches (`mapmode`).
///
/// Not yet recorded, and not handled: a source that overlaps the
/// destination.
#[allow(clippy::too_many_arguments)]
pub fn bit_blt(
    system: &mut System,
    hdc: u16,
    rect: [i32; 4],
    source: u16,
    sx: i32,
    sy: i32,
    rop: u32,
) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let from = if source == 0 {
        None
    } else {
        dc_of(system, source)
    };
    let [x, y, width, height] = rect;
    let source_mapped = from.is_some_and(|from| mapped(system, from).is_some());

    if mapped(system, dc).is_some() || source_mapped {
        let to = device_box(&mapping_of(system, dc), x, y, width, height);
        let at = from.map_or(to, |from| {
            device_box(&mapping_of(system, from), sx, sy, width, height)
        });

        stretch_device(system, dc, to, from, at, rop);
        return 1;
    }

    let Some(bitmap) = canvas(system, dc) else {
        return 1;
    };
    let source = from.and_then(|from| source_of(system, from));

    raster_op(
        system,
        dc,
        &bitmap,
        Paint::Selected,
        (x, y, width, height),
        rop,
        source.as_ref(),
        sx,
        sy,
    );
    1
}

fn bit_blt_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));
    let source = args.word(system);
    let sx = i32::from(args.signed(system));
    let sy = i32::from(args.signed(system));
    let rop = args.dword(system);

    Ok(Answer::Word(bit_blt(
        system, hdc, rect, source, sx, sy, rop,
    )))
}

/// A rectangle's edge and extent put in order: a negative extent from `at`
/// covers `at + extent + 1` to `at + 1`, and mirrors (seg32 `11bb`).
fn ordered(at: i32, extent: i32) -> (i32, i32, bool) {
    if extent < 0 {
        (at + extent + 1, -extent, true)
    } else {
        (at, extent, false)
    }
}

/// Copies a rectangle of one device context into a rectangle of another of
/// a different size, stretching or shrinking it, under a raster operation.
///
/// GDI does the stretching itself, as no display driver does (`GDI.EXE`
/// seg32 `03ba`). It puts each rectangle in order; a negative extent on one
/// side mirrors that axis, and on both sides does not. Rectangles the same
/// size are a `BitBlt`. Otherwise the source is copied, stretched into a
/// bitmap the destination's size, and that is combined into the
/// destination under the operation. Shrinking, the stretch mode says what
/// becomes of those that fall together: `COLORONCOLOR` shows one of them,
/// `BLACKONWHITE` ands their colour indices and `WHITEONBLACK` ors them.
/// **Recorded** by `stretch` on the VGA, and read out: see
/// `winbox_raster::stretch`. Both rectangles are in device terms: each
/// corner mapped (seg1 `312c`).
pub fn stretch_blt(
    system: &mut System,
    hdc: u16,
    rect: [i32; 4],
    source: u16,
    from: [i32; 4],
    rop: u32,
) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let src = if source == 0 {
        None
    } else {
        dc_of(system, source)
    };
    let [x, y, width, height] = rect;
    let to = match mapped(system, dc) {
        Some(m) => device_box(&m, x, y, width, height),
        None => (x, y, width, height),
    };
    let [sx, sy, swidth, sheight] = from;
    let at = match src.and_then(|src| mapped(system, src)) {
        Some(m) => device_box(&m, sx, sy, swidth, sheight),
        None => (sx, sy, swidth, sheight),
    };

    stretch_device(system, dc, to, src, at, rop);
    1
}

fn stretch_blt_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));
    let source = args.word(system);
    let from = [(); 4].map(|()| i32::from(args.signed(system)));
    let rop = args.dword(system);

    Ok(Answer::Word(stretch_blt(
        system, hdc, rect, source, from, rop,
    )))
}

/// `StretchBlt` between two device contexts, in device terms. `BitBlt`
/// comes here too where a mapping mode makes its two rectangles different
/// sizes.
fn stretch_device(
    system: &mut System,
    dc: usize,
    to: (i32, i32, i32, i32),
    from: Option<usize>,
    at: (i32, i32, i32, i32),
    rop: u32,
) {
    let source = from.and_then(|from| source_of(system, from));

    stretch_into(system, dc, to, source.as_ref(), at, rop);
}

/// The stretch, from a source of pixels -- a device context's or a DIB's.
#[allow(clippy::too_many_lines)]
pub(crate) fn stretch_into(
    system: &mut System,
    dc: usize,
    (x, y, width, height): (i32, i32, i32, i32),
    source: Option<&Sourced>,
    (sx, sy, swidth, sheight): (i32, i32, i32, i32),
    rop: u32,
) {
    let Some(bitmap) = canvas(system, dc) else {
        return;
    };
    let (dx, dw, dmirror) = ordered(x, width);
    let (dy, dh, dflip) = ordered(y, height);
    let table = winbox_raster::raster_op::table_of(rop);
    let Some(source) = source.filter(|_| winbox_raster::raster_op::uses_source(table)) else {
        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Selected,
            (dx, dy, dw, dh),
            rop,
            None,
            0,
            0,
        );
        return;
    };
    let (ax, aw, amirror) = ordered(sx, swidth);
    let (ay, ah, aflip) = ordered(sy, sheight);

    // The same size: a `BitBlt`. Turned over on both sides, it is not
    // turned over at all.
    if width == swidth && height == sheight {
        let both = width < 0 || height < 0;
        let rect = if both {
            (dx, dy, dw, dh)
        } else {
            (x, y, width, height)
        };
        let (fx, fy) = if both { (ax, ay) } else { (sx, sy) };

        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Selected,
            rect,
            rop,
            Some(source),
            fx,
            fy,
        );
        return;
    }

    if dw == 0 || dh == 0 || aw == 0 || ah == 0 {
        return;
    }

    // The source's pixels, in its own format.
    let depth = source.bitmap.depth;
    let palette = Rc::clone(&source.bitmap.device_palette);
    let band = DeviceBitmap::new(aw, ah, depth, None, Some(Rc::clone(&palette)));

    blit::raster_op(
        system.display_kind(),
        &Target {
            bitmap: &band,
            brush: Paintbrush::default(),
            back: Color::rgb(0xff, 0xff, 0xff),
            text: None,
            origin: (0, 0),
            realized: None,
        },
        0,
        0,
        aw,
        ah,
        SRCCOPY,
        Some(&source.borrowed()),
        ax,
        ay,
    );

    let mirror_x = dmirror != amirror;
    let mirror_y = dflip != aflip;
    // A device context whose mode was never set stretches as
    // `WHITEONBLACK`, though `GetStretchBltMode` answers `BLACKONWHITE`: the
    // TypeScript engine reads the field it never set as no mode, and takes
    // that as 2. Kept, as it draws.
    let mode = system.gdi.dcs[dc]
        .state
        .stretch_mode
        .filter(|mode| (1..=3).contains(mode))
        .unwrap_or(2);
    let within = (aw - dw).abs() <= 1 && (ah - dh).abs() <= 1;
    let mono = depth == 1 || bitmap.depth == 1;
    let stretched = DeviceBitmap::new(dw, dh, depth, None, Some(palette));

    {
        let pixels = band.indices.borrow();
        let pixel = |px: i32, py: i32| {
            pixels
                .get(usize::try_from(py * aw + px).unwrap_or(usize::MAX))
                .copied()
                .unwrap_or(0)
        };
        let mut out = stretched.indices.borrow_mut();

        if within || (mono && !mirror_x && !mirror_y) {
            let rows = stretch_map(ah, dh, aw, dw, Axis::Rows, mono);
            let columns = stretch_map(aw, dw, ah, dh, Axis::Columns, mono);

            // A row or column the map has none for reads nothing, as the
            // TypeScript engine's `undefined` does.
            for py in 0..dh {
                let row = rows
                    .get(py as usize)
                    .map(|&row| if mirror_y { ah - 1 - row } else { row });

                for px in 0..dw {
                    let column = columns
                        .get(px as usize)
                        .map(|&column| if mirror_x { aw - 1 - column } else { column });

                    out[(py * dw + px) as usize] = match (column, row) {
                        (Some(column), Some(row)) => pixel(column, row),
                        _ => 0,
                    };
                }
            }
        } else {
            let columns = stretch_columns(aw, dw, mirror_x);
            let mut rows = stretch_rows(ah, dh, mode != COLORONCOLOR);
            let all = ((1u32 << depth) - 1) as u8;

            if mirror_y {
                rows.reverse();
            }

            for py in 0..dh {
                for px in 0..dw {
                    let mut value = if mode == BLACKONWHITE { all } else { 0 };
                    let group = &columns[px as usize];

                    for &row in rows.get(py as usize).map_or(&[][..], Vec::as_slice) {
                        if mode == COLORONCOLOR {
                            value = group.last().map_or(0, |&column| pixel(column, row));
                            continue;
                        }

                        for &column in group {
                            value = if mode == BLACKONWHITE {
                                value & pixel(column, row)
                            } else {
                                value | pixel(column, row)
                            };
                        }
                    }

                    out[(py * dw + px) as usize] = value;
                }
            }
        }
    }

    let stretched = Sourced {
        bitmap: stretched,
        width: dw,
        height: dh,
        back: source.back,
    };

    raster_op(
        system,
        dc,
        &bitmap,
        Paint::Selected,
        (dx, dy, dw, dh),
        rop,
        Some(&stretched),
        0,
        0,
    );
}

/// Sets the pixel at a point to the colour the display's driver draws the
/// colour given as, and answers that colour: the one drawn, which
/// `penmatch` recorded, 512 of 512, on the screen's bitmaps and on a
/// monochrome one. A palette's colour is looked up in the device context.
/// In a drawing mode other than `R2_COPYPEN` it is drawn as a line's pixel
/// is, combined with what is there: `R2_NOT` inverts what is there,
/// whatever the colour (`metafile`). A colour in a slot of the system
/// palette is drawn there, through the raster operation that knows slots
/// (`palreal`). -1 for no device context.
pub fn set_pixel(system: &mut System, hdc: u16, x: i32, y: i32, colorref: u32) -> u32 {
    let Some(dc) = dc_of(system, hdc) else {
        return CLR_INVALID;
    };
    let (x, y) = match mapped(system, dc) {
        Some(m) => device_point(&m, x, y),
        None => (x, y),
    };
    let Some(mut bitmap) = canvas(system, dc) else {
        return CLR_INVALID;
    };
    let palette = Rc::clone(&bitmap.device_palette);
    let colour = colour_in(&palette, colorref);
    let index = match colour.slot {
        Some(slot) if palette.borrow().size() == 256 => slot,
        _ => matched_index(
            system.display_kind(),
            &mut palette.borrow_mut(),
            colour.red(),
            colour.green(),
            colour.blue(),
        ),
    };
    let mode = system.gdi.dcs[dc].state.rop2.unwrap_or(13);

    if mode == 13 && colour.slot.is_none() {
        bitmap
            .context
            .set_pixel(x, y, [colour.red(), colour.green(), colour.blue(), 0xff]);
    } else {
        let [red, green, blue] = palette
            .borrow()
            .colours
            .get(index)
            .copied()
            .unwrap_or([0, 0, 0]);
        let drawn = Color::rgb(red, green, blue).in_slot(colour.slot.map(|_| index));

        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Colour(drawn),
            (x, y, 1, 1),
            winbox_raster::raster_op::rop_of_mode(i32::from(mode)),
            None,
            0,
            0,
        );
    }

    palette.borrow().colorref(index)
}

fn set_pixel_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let colorref = args.dword(system);

    Ok(Answer::Dword(set_pixel(system, hdc, x, y, colorref)))
}

/// The colour of one pixel, as a `COLORREF`: the palette's colour for the
/// pixel's index. The `bitblt` probe reads every colour it records this
/// way. Outside a clip region the program set, `CLR_INVALID`, the pixel
/// there as it may be (`selrgn`); and outside the pixels.
///
/// A pixel of the screen nothing has drawn yet stops the program: USER's
/// desktop, frames and menus are not drawn here, and the TypeScript engine
/// answers what they drew (`nobrush`, `menuhelp`).
pub fn get_pixel(system: &mut System, hdc: u16, x: i32, y: i32) -> Result<u32, Stop> {
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(CLR_INVALID);
    };
    let (x, y) = match mapped(system, dc) {
        Some(m) => device_point(&m, x, y),
        None => (x, y),
    };

    if system.gdi.dcs[dc].state.clip.is_some()
        && !super::regions::clip_of(system, dc).contains(x, y)
    {
        return Ok(CLR_INVALID);
    }

    let Some(bitmap) = system.draw_target(dc) else {
        return Ok(CLR_INVALID);
    };
    let on_screen = !matches!(system.gdi.dcs[dc].bitmap, DcBitmap::Bitmap(_));

    match bitmap.index_at(x, y) {
        Some(UNDRAWN) if on_screen && bitmap.depth < 8 => Err(Stop::Unsupported(
            "GetPixel of the screen where USER has not drawn",
        )),
        Some(index) => Ok(bitmap.device_palette.borrow().colorref(usize::from(index))),
        None => Ok(CLR_INVALID),
    }
}

fn get_pixel_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));

    Ok(Answer::Dword(get_pixel(system, hdc, x, y)?))
}

/// A `RECT` at a far pointer, its sides signed: none for a null pointer.
pub(crate) fn read_rect(system: &System, far: u32) -> Option<[i32; 4]> {
    if far == 0 {
        return None;
    }

    let bytes = system.read_far(far, 8);

    Some([0, 2, 4, 6].map(|at| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]))))
}

/// A `RECT` written at a far pointer.
pub(crate) fn write_rect(system: &mut System, far: u32, rect: [i32; 4]) {
    let bytes: Vec<u8> = rect
        .iter()
        .flat_map(|&side| (side as i16).to_le_bytes())
        .collect();

    system.write_far(far, &bytes);
}

/// A brush realised for a device context as it is used: a pattern, a
/// hatch, and a colour the display dithers alike keep where they were first
/// realised, on the screen, until `UnrealizeObject` (`brushrlz`).
pub(crate) fn realise(system: &mut System, dc: usize, object: usize) {
    let origin = super::dc::brush_org_of(system, dc);

    if let GdiObject::Brush(brush) = &mut system.gdi.objects[object]
        && brush.realised.is_none()
    {
        brush.realised = Some(origin);
    }
}

/// What a handle given as a brush stands for.
pub(crate) enum Given {
    /// A brush, and its alpha; or a pen, as a brush of its colour, with no
    /// alpha for a null one.
    Paints(Paint, u8),
    /// Anything else.
    Colourless,
}

/// What a handle given as a brush paints with; none for a handle that
/// stands for nothing.
///
/// The TypeScript engine makes whatever the handle stands for the device
/// context's brush while it paints, and its surface takes the brush's
/// colour as it is set (`surface.ts`, `set brush`): an object with no
/// colour -- a region, a bitmap, a font, a palette, a device context --
/// throws there, and the program stops.
pub(crate) fn paint_of(system: &System, handle: u16) -> Option<Given> {
    Some(match system.handles.resolve(handle)? {
        crate::handles::Object::Gdi(object) => match &system.gdi.objects[object] {
            GdiObject::Brush(brush) => Given::Paints(Paint::Object(object), brush.color[3]),
            GdiObject::Pen(pen) => {
                let [red, green, blue, alpha] = pen.color;

                Given::Paints(Paint::Colour(Color::rgba(red, green, blue, alpha)), alpha)
            }
            _ => Given::Colourless,
        },
        _ => Given::Colourless,
    })
}

/// The stop for a handle given as a brush that has no colour to paint
/// with: see `paint_of`.
const NO_COLOUR: Stop = Stop::Unsupported("a handle given as a brush that is no brush or pen");

/// Fills a rectangle with a brush, its right and bottom edges outside it:
/// the brush selected and `PATCOPY` blitted, as USER does (seg1 `1f3a`), so
/// that a solid colour the device lacks is dithered as `PatBlt` dithers it
/// -- the grey stock brush fills a monochrome bitmap with a checkerboard,
/// recorded by `regions`. The brush is the device context's only while it
/// fills: `patbrush` recorded its own brush selected after. A hollow brush
/// fills nothing (`brushind`); no device context, or a handle that stands
/// for nothing, nothing (USER checks the brush is one before it starts,
/// seg1 `ac40`). A pen paints as a brush of its colour; anything else
/// stops the program, as it stops the TypeScript engine's (`paint_of`).
pub fn fill_rect(system: &mut System, hdc: u16, rect: [i32; 4], brush: u16) -> Result<(), Stop> {
    let (Some(dc), Some(given)) = (dc_of(system, hdc), paint_of(system, brush)) else {
        return Ok(());
    };
    let Given::Paints(paint, alpha) = given else {
        return Err(NO_COLOUR);
    };

    if alpha == 0 {
        return Ok(());
    }

    let [left, top, right, bottom] = match mapped(system, dc) {
        Some(m) => device_rect(&m, rect),
        None => rect,
    };

    if let Paint::Object(object) = paint {
        realise(system, dc, object);
    }

    if let Some(bitmap) = canvas(system, dc) {
        raster_op(
            system,
            dc,
            &bitmap,
            paint,
            (left, top, right - left, bottom - top),
            PATCOPY,
            None,
            0,
            0,
        );
    }

    Ok(())
}

fn fill_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let brush = args.word(system);

    if let Some(rect) = read_rect(system, far) {
        fill_rect(system, hdc, rect, brush)?;
    }

    Ok(Answer::Word(0))
}

/// A frame a pixel wide inside a rectangle, in a brush: its four sides each
/// `PATCOPY`ed, as `FillRect` fills. A rectangle with no inside draws
/// nothing. Unlike `FillRect`, a hollow brush is not passed over: it
/// paints as its colour does. A handle that is no brush or pen stops the
/// program where there is a frame to draw (`paint_of`).
pub fn frame_rect(system: &mut System, hdc: u16, rect: [i32; 4], brush: u16) -> Result<(), Stop> {
    let (Some(dc), Some(given)) = (dc_of(system, hdc), paint_of(system, brush)) else {
        return Ok(());
    };
    let [left, top, right, bottom] = match mapped(system, dc) {
        Some(m) => device_rect(&m, rect),
        None => rect,
    };
    let (width, height) = (right - left, bottom - top);

    if width <= 0 || height <= 0 {
        return Ok(());
    }

    let Given::Paints(paint, _) = given else {
        return Err(NO_COLOUR);
    };

    if let Paint::Object(object) = paint {
        realise(system, dc, object);
    }

    let Some(bitmap) = canvas(system, dc) else {
        return Ok(());
    };

    for side in [
        (left, top, width, 1),
        (left, bottom - 1, width, 1),
        (left, top, 1, height),
        (right - 1, top, 1, height),
    ] {
        raster_op(system, dc, &bitmap, paint, side, PATCOPY, None, 0, 0);
    }

    Ok(())
}

fn frame_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let brush = args.word(system);

    if let Some(rect) = read_rect(system, far) {
        frame_rect(system, hdc, rect, brush)?;
    }

    Ok(Answer::Word(0))
}

/// Inverts every pixel of a rectangle, each bit of its colour's index as
/// the raster operation `DSTINVERT` does; the right and bottom edges are
/// outside it. The rectangle is taken as it is given, with no mapping.
pub fn invert_rect(system: &mut System, hdc: u16, rect: [i32; 4]) {
    let Some(dc) = dc_of(system, hdc) else {
        return;
    };
    let [left, top, right, bottom] = rect;

    if let Some(bitmap) = canvas(system, dc) {
        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Selected,
            (left, top, right - left, bottom - top),
            DSTINVERT,
            None,
            0,
            0,
        );
    }
}

fn invert_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);

    if let Some(rect) = read_rect(system, far) {
        invert_rect(system, hdc, rect);
    }

    Ok(Answer::Nothing)
}

/// A DIB's header's height, however its rows run.
fn dib_height(system: &System, info: u32) -> i64 {
    let bytes = system.read_far(info, 12);
    let dword =
        |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);

    if dword(0) == 12 {
        i64::from(i16::from_le_bytes([bytes[6], bytes[7]])).abs()
    } else {
        i64::from(dword(8) as i32).abs()
    }
}

/// A DIB in the program's memory as a bitmap of the device context's
/// kind, as a source: its width and the scan lines read.
fn dib_source(
    system: &System,
    dc: usize,
    info: u32,
    bits: u32,
    rows: Option<i64>,
) -> Option<Sourced> {
    let (depth, palette) = match system.gdi.dcs[dc].bitmap {
        DcBitmap::Bitmap(object) => match &system.gdi.objects[object] {
            GdiObject::Bitmap(bitmap) => (
                bitmap.pixels.depth,
                Rc::clone(&bitmap.pixels.device_palette),
            ),
            _ => return None,
        },
        DcBitmap::Screen | DcBitmap::Window(_) => {
            let display = system.display_kind();

            (display.depth(), palette_for_display(display, None))
        }
    };

    if info == 0 || bits == 0 {
        return None;
    }

    let rows = rows.unwrap_or_else(|| dib_height(system, info));
    let (bitmap, lines) = super::dib::dib_at(system, info, bits, rows, depth, palette)?;

    Some(Sourced {
        width: bitmap.width(),
        height: lines as i32,
        bitmap,
        back: None,
    })
}

/// Draws some of a DIB's scan lines at their place in a rectangle of it.
/// **Recorded** by `dibdev`, with a four-bit DIB whose every pixel is a
/// digit of the display's palette, and a one-bit and an eight-bit one.
///
/// * The source rectangle is counted from the DIB's bottom row, as its rows
///   are stored, and its bottom row is drawn at the bottom of the
///   destination: scan line `s` at `yDest + ySrc + cy - 1 - s`. A rectangle
///   larger than the DIB draws the DIB at its bottom left.
/// * The bits are `cScanLines` scan lines from `uStartScan`, and only those
///   are drawn: a DIB can be handed over in bands.
/// * It answers how many scan lines it drew, those clipped off not counted.
/// * Into a memory device context it draws nothing and answers -1: the
///   display driver takes only the screen.
///
/// Not measured: a mapping mode, where only the place is mapped here. A
/// `DIB_PAL_COLORS` colour table is indices into the palette selected where
/// it is drawn, and no logical palette is selected into a device context
/// here: it is taken as colours.
#[allow(clippy::too_many_arguments)]
pub fn set_dibits_to_device(
    system: &mut System,
    hdc: u16,
    dest: (i32, i32),
    (cx, cy): (i32, i32),
    (x_src, y_src): (i32, i32),
    start: i32,
    lines: i32,
    bits: u32,
    info: u32,
) -> i16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };

    if system.gdi.dcs[dc].memory {
        return -1;
    }

    let Some(dib) = dib_source(system, dc, info, bits, Some(i64::from(lines))) else {
        return 0;
    };
    let (x_dest, y_dest) = match mapped(system, dc) {
        Some(m) => device_point(&m, dest.0, dest.1),
        None => dest,
    };
    let first = start.max(y_src);
    let end = (start + lines).min(y_src + cy);
    let width = cx.min(dib.width - x_src);

    if end <= first || width <= 0 {
        return 0;
    }

    // Scan lines `first` to `end` are rows `top` down of the destination,
    // and rows `from` down of the bits, which are stored bottom up.
    let top = y_dest + y_src + cy - end;
    let from = dib.height - (end - start);
    let height = end - first;
    let Some(bitmap) = canvas(system, dc) else {
        return 0;
    };

    raster_op(
        system,
        dc,
        &bitmap,
        Paint::Selected,
        (x_dest, top, width, height),
        SRCCOPY,
        Some(&dib),
        x_src,
        from,
    );

    ((top + height).min(bitmap.height()) - top.max(0)).max(0) as i16
}

fn set_dibits_to_device_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let cx = i32::from(args.signed(system));
    let cy = i32::from(args.signed(system));
    let x_src = i32::from(args.signed(system));
    let y_src = i32::from(args.signed(system));
    let start = i32::from(args.word(system));
    let lines = i32::from(args.word(system));
    let bits = args.dword(system);
    let info = args.dword(system);
    let _usage = args.word(system);

    Ok(Answer::Word(set_dibits_to_device(
        system,
        hdc,
        (x, y),
        (cx, cy),
        (x_src, y_src),
        start,
        lines,
        bits,
        info,
    ) as u16))
}

/// Draws a rectangle of a DIB stretched into a rectangle of a device
/// context, as `StretchBlt` does from a bitmap made of the DIB, in its
/// stretch mode and with its raster operation (`dibdev`).
///
/// * The source rectangle is counted from the DIB's bottom row.
/// * A negative destination width or height turns it over.
/// * It answers the source rectangle's height.
/// * Into a memory device context, unlike `SetDIBitsToDevice`, it draws.
pub fn stretch_dibits(
    system: &mut System,
    hdc: u16,
    dest: [i32; 4],
    source: [i32; 4],
    bits: u32,
    info: u32,
    rop: u32,
) -> i16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let Some(dib) = dib_source(system, dc, info, bits, None) else {
        return 0;
    };
    let [x, y, width, height] = dest;
    let to = match mapped(system, dc) {
        Some(m) => device_box(&m, x, y, width, height),
        None => (x, y, width, height),
    };
    let [sx, sy, swidth, sheight] = source;

    stretch_into(
        system,
        dc,
        to,
        Some(&dib),
        (sx, dib.height - sy - sheight, swidth, sheight),
        rop,
    );

    sheight as i16
}

fn stretch_dibits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let dest = [(); 4].map(|()| i32::from(args.signed(system)));
    let source = [(); 4].map(|()| i32::from(args.signed(system)));
    let bits = args.dword(system);
    let info = args.dword(system);
    let _usage = args.word(system);
    let rop = args.dword(system);

    Ok(Answer::Word(
        stretch_dibits(system, hdc, dest, source, bits, info, rop) as u16,
    ))
}

#[cfg(test)]
#[path = "draw_tests.rs"]
mod tests;
