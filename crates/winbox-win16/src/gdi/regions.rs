//! Regions, and a device context's clip region.
//!
//! **Regions**: made from rectangles, ellipses, rounded rectangles and
//! polygons, combined, asked about and painted. **Recorded** by `regions`,
//! pixel for pixel on a monochrome bitmap. A region is bands of rows, each
//! a set of runs of columns (`ClipRegion`). Its kind is nought for no
//! region, 1 for an empty one, 2 for a rectangle and 3 for anything else,
//! however it was made.
//!
//! **The clip region**, **recorded** by `clipdc`, on a memory device
//! context:
//!
//! * Each call answers the kind of region that is left. A region is a
//!   rectangle whenever that is all it is: a rectangle with a hole in it is
//!   3, and stays 3 once an edge is cut from it.
//! * The region is the bitmap's pixels until something narrows it. A new
//!   memory device context, with the bitmap every one starts with, has
//!   none: an empty region.
//! * `IntersectClipRect` with its edges the wrong way round leaves nothing.
//! * `SelectClipRgn` takes a copy of the region: the region can be changed
//!   or deleted after. With no region it lets the whole bitmap be drawn on
//!   again.
//! * Selecting another bitmap keeps the region.
//! * Everything that draws stays inside it: `PatBlt`, `FillRect`,
//!   `Rectangle`, `LineTo`, `TextOut`, `SetPixel`, `BitBlt` and `StretchBlt`
//!   through a rectangle with a hole, all recorded pixel by pixel.
//!
//! Not recorded: a window's device context, where the region is also kept
//! inside what is to be painted, and `OffsetClipRgn` with no region.

use winbox_raster::ClipRegion;
use winbox_raster::curves::round_points;
use winbox_raster::polygon::{Span, polygon_spans};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

use super::dc::{DcBitmap, dc_of};
use super::draw::{device_point, device_rect, mapped, read_rect, signed, write_rect};
use super::mapping::mapping_of;
use super::objects::GdiObject;

const ERROR: u16 = 0;

const RGN_AND: i16 = 1;
const RGN_OR: i16 = 2;
const RGN_XOR: i16 = 3;
const RGN_COPY: i16 = 5;

const WINDING: u16 = 2;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "CreateRectRgn" => create_rect_rgn_call,
        "CreateRectRgnIndirect" => create_rect_rgn_indirect,
        "CreateEllipticRgn" => create_elliptic_rgn,
        "CreateEllipticRgnIndirect" => create_elliptic_rgn_indirect,
        "CreateRoundRectRgn" => create_round_rect_rgn,
        "CreatePolygonRgn" => create_polygon_rgn,
        "CreatePolyPolygonRgn" => create_poly_polygon_rgn,
        "CombineRgn" => combine_rgn_call,
        "EqualRgn" => equal_rgn,
        "OffsetRgn" => offset_rgn,
        "SetRectRgn" => set_rect_rgn,
        "PtInRegion" => pt_in_region,
        "RectInRegion" => rect_in_region,
        "GetRgnBox" => get_rgn_box,
        "FillRgn" => fill_rgn_call,
        "PaintRgn" => paint_rgn,
        "InvertRgn" => invert_rgn,
        "FrameRgn" => frame_rgn,
        "SelectClipRgn" => select_clip_rgn_call,
        "IntersectClipRect" => intersect_clip_rect,
        "ExcludeClipRect" => exclude_clip_rect,
        "OffsetClipRgn" => offset_clip_rgn,
        "GetClipBox" => get_clip_box,
        "RectVisible" => rect_visible,
        "PtVisible" => pt_visible,
        _ => return None,
    }))
}

/// The region a handle stands for, by its index among GDI's objects.
fn region_of(system: &System, handle: u16) -> Option<usize> {
    match system.gdi_object_of(handle)? {
        (object, GdiObject::Region(_)) => Some(object),
        _ => None,
    }
}

/// No pixels, for an object that is no region.
static NOTHING: ClipRegion = ClipRegion::EMPTY;

fn shape(system: &System, object: usize) -> &ClipRegion {
    match &system.gdi.objects[object] {
        GdiObject::Region(shape) => shape,
        _ => &NOTHING,
    }
}

fn set_shape(system: &mut System, object: usize, region: ClipRegion) {
    system.gdi.objects[object] = GdiObject::Region(region);
}

/// A region given one of GDI's handles: nought where there are none left.
fn allocate(system: &mut System, region: ClipRegion) -> u16 {
    let object = system.gdi_object(GdiObject::Region(region));

    system
        .handles
        .allocate(Kind::Gdi, Object::Gdi(object))
        .unwrap_or(0)
}

/// A shape's region, or none when it holds no pixel: **recorded**.
fn allocate_shape(system: &mut System, region: ClipRegion) -> u16 {
    if region.kind() == 1 {
        0
    } else {
        allocate(system, region)
    }
}

fn kind_of(region: &ClipRegion) -> Answer {
    Answer::Word(region.kind())
}

fn create_rect_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let [left, top, right, bottom] = [(); 4].map(|()| args.signed(system));

    Ok(Answer::Word(super::objects::create_rect_rgn(
        system, left, top, right, bottom,
    )))
}

/// A rectangle's region from a `RECT`: nought for none.
fn create_rect_rgn_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Some([left, top, right, bottom]) = read_rect(system, far) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(allocate(
        system,
        ClipRegion::rect(left, top, right, bottom),
    )))
}

/// An ellipse's region: the pixels `Ellipse` fills with no pen, the right
/// and bottom edges outside it. **Recorded**: a rectangle the wrong way
/// round is turned, and one that holds no pixel makes no region. A rounded
/// rectangle with a corner nought across or down is a rectangle's region
/// (`GDI.EXE` seg9 `01cb`), its right and bottom edges where they were
/// given.
fn ellipse(system: &mut System, rect: [i32; 4], corner: Option<(i32, i32)>) -> u16 {
    let [left, top, right, bottom] = rect;

    if let Some((width, height)) = corner
        && (width == 0 || height == 0)
    {
        return allocate(system, ClipRegion::rect(left, top, right, bottom));
    }

    let (l, r) = (left.min(right), left.max(right));
    let (t, b) = (top.min(bottom), top.max(bottom));
    let cw = corner.map_or(r - 1 - l, |corner| corner.0.abs().min(r - 1 - l));
    let ch = corner.map_or(b - 1 - t, |corner| corner.1.abs().min(b - 1 - t));
    let spans = polygon_spans(&round_points(l, t, r - 1, b - 1, cw, ch), false);

    allocate_shape(system, ClipRegion::from_spans(&spans))
}

fn create_elliptic_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));

    Ok(Answer::Word(ellipse(system, rect, None)))
}

fn create_elliptic_rgn_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    Ok(Answer::Word(
        read_rect(system, far).map_or(0, |rect| ellipse(system, rect, None)),
    ))
}

fn create_round_rect_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));
    let width = i32::from(args.signed(system));
    let height = i32::from(args.signed(system));

    Ok(Answer::Word(ellipse(system, rect, Some((width, height)))))
}

/// The points at a far pointer, each two signed words, from the `from`th,
/// within the pointer's segment.
fn points_at(system: &System, far: u32, count: usize, from: i64) -> Vec<(i32, i32)> {
    (from..from + count as i64)
        .map(|index| {
            let at = i64::from(far & 0xffff) + index * 4;
            let word = |offset: i64| {
                let bytes =
                    system.read_far((far & 0xffff_0000) | ((at + offset) & 0xffff) as u32, 2);

                i32::from(i16::from_le_bytes([bytes[0], bytes[1]]))
            };

            (word(0), word(2))
        })
        .collect()
}

/// A polygon's region: the rows its fill covers, by `ALTERNATE` or
/// `WINDING`. **Read out** (`GDI.EXE` seg24 `0254`) and **recorded**: fewer
/// than two points answer 1, which is no region's handle, and more than
/// 3FFDh answer nought.
fn create_polygon_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let count = args.word(system);
    let mode = args.word(system);

    if count > 0x3ffd {
        return Ok(Answer::Word(0));
    }

    if count < 2 {
        return Ok(Answer::Word(1));
    }

    let points = points_at(system, far, usize::from(count), 0);
    let spans = polygon_spans(&points, mode == WINDING);

    Ok(Answer::Word(allocate_shape(
        system,
        ClipRegion::from_spans(&spans),
    )))
}

/// Several polygons' region. **Read out** (`GDI.EXE` seg24 `02e5`): GDI
/// hands its polygon builder the count of polygons where the count of
/// points goes, so **recorded**, one polygon or two make no region. Not
/// followed: what it makes of three or more, which is not their union; here
/// it is, as in the TypeScript engine.
fn create_poly_polygon_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let counts = args.dword(system);
    let polygons = args.signed(system);
    let mode = args.word(system);

    if far == 0 || counts == 0 || polygons < 3 {
        return Ok(Answer::Word(0));
    }

    let mut from = 0i64;
    let mut spans: Vec<Span> = Vec::new();

    for index in 0..polygons as usize {
        let at = (counts & 0xffff) as usize + index * 2;
        let bytes = system.read_far((counts & 0xffff_0000) | (at & 0xffff) as u32, 2);
        let count = i16::from_le_bytes([bytes[0], bytes[1]]);
        let points = points_at(system, far, usize::try_from(count).unwrap_or(0), from);

        spans.extend(polygon_spans(&points, mode == WINDING));
        from += i64::from(count);
    }

    Ok(Answer::Word(allocate_shape(
        system,
        ClipRegion::from_spans(&spans),
    )))
}

/// Two regions' pixels into a third: both (`RGN_AND`), either (`RGN_OR`),
/// one and not the other (`RGN_XOR`), the first less the second
/// (`RGN_DIFF`), or the first alone (`RGN_COPY`). **Recorded**: mode 0 is
/// taken as `RGN_DIFF` and mode 6 as `RGN_COPY`. The kind of region made,
/// or nought.
pub fn combine_rgn(system: &mut System, dest: u16, one: u16, two: u16, mode: i16) -> u16 {
    let copy = mode >= RGN_COPY;
    let (Some(dest), Some(one)) = (region_of(system, dest), region_of(system, one)) else {
        return ERROR;
    };
    let two = if copy { None } else { region_of(system, two) };

    if !copy && two.is_none() {
        return ERROR;
    }

    let combined = match two {
        None => shape(system, one).clone(),
        Some(two) => {
            let (a, b) = (shape(system, one), shape(system, two));

            match mode {
                RGN_AND => a.intersect(b),
                RGN_OR => a.union(b),
                RGN_XOR => ClipRegion::combine(a, b, |a, b| a != b),
                _ => a.subtract(b),
            }
        }
    };
    let kind = combined.kind();

    set_shape(system, dest, combined);
    kind
}

fn combine_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let dest = args.word(system);
    let one = args.word(system);
    let two = args.word(system);
    let mode = args.signed(system);

    Ok(Answer::Word(combine_rgn(system, dest, one, two, mode)))
}

/// Whether two regions hold the same pixels; nought for no region.
fn equal_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let one = args.word(system);
    let two = args.word(system);
    let (Some(one), Some(two)) = (region_of(system, one), region_of(system, two)) else {
        return Ok(Answer::Word(ERROR));
    };
    let differ = ClipRegion::combine(shape(system, one), shape(system, two), |a, b| a != b);

    Ok(Answer::Word(u16::from(differ.kind() == 1)))
}

/// Moves a region: its kind, or nought.
fn offset_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let dx = i32::from(args.signed(system));
    let dy = i32::from(args.signed(system));
    let Some(object) = region_of(system, handle) else {
        return Ok(Answer::Word(ERROR));
    };
    let moved = shape(system, object).offset(dx, dy);
    let answer = kind_of(&moved);

    set_shape(system, object, moved);
    Ok(answer)
}

/// Makes a region a rectangle.
fn set_rect_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let [left, top, right, bottom] = [(); 4].map(|()| i32::from(args.signed(system)));

    if let Some(object) = region_of(system, handle) {
        set_shape(system, object, ClipRegion::rect(left, top, right, bottom));
    }

    Ok(Answer::Nothing)
}

/// Whether a point is in a region.
fn pt_in_region(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let inside =
        region_of(system, handle).is_some_and(|object| shape(system, object).contains(x, y));

    Ok(Answer::Word(u16::from(inside)))
}

/// Whether any of a rectangle is in a region. **Recorded**: a rectangle the
/// wrong way round is turned, and the answer for yes is 101h.
fn rect_in_region(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let far = args.dword(system);
    let (Some(object), Some(rect)) = (region_of(system, handle), read_rect(system, far)) else {
        return Ok(Answer::Word(0));
    };
    let [left, top, right, bottom] = rect;
    let rect = ClipRegion::rect(
        left.min(right),
        top.min(bottom),
        left.max(right),
        top.max(bottom),
    );

    Ok(Answer::Word(
        if shape(system, object).intersect(&rect).kind() > 1 {
            0x101
        } else {
            0
        },
    ))
}

/// The smallest rectangle around a region, all nought for an empty one:
/// its kind, or nought.
fn get_rgn_box(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let far = args.dword(system);
    let Some(object) = region_of(system, handle) else {
        return Ok(Answer::Word(ERROR));
    };

    if far == 0 {
        return Ok(Answer::Word(ERROR));
    }

    let region = shape(system, object).clone();
    let bounds = region.bounds();

    write_rect(
        system,
        far,
        [bounds.left, bounds.top, bounds.right, bounds.bottom],
    );
    Ok(kind_of(&region))
}

/// Each rectangle of a region.
fn rects_of(region: &ClipRegion) -> Vec<[i32; 4]> {
    region
        .bands
        .iter()
        .flat_map(|band| {
            band.spans
                .iter()
                .map(|&(left, right)| [left, band.top, right, band.bottom])
        })
        .collect()
}

/// Fills a region with a brush, a rectangle of it at a time as `FillRect`
/// fills one, and as `FillRect` stops for a handle that is no brush or pen:
/// whether it was filled.
pub fn fill_rgn(system: &mut System, hdc: u16, handle: u16, brush: u16) -> Result<u16, Stop> {
    let Some(object) = region_of(system, handle) else {
        return Ok(0);
    };

    if system.handles.resolve(hdc).is_none() || system.handles.resolve(brush).is_none() {
        return Ok(0);
    }

    for rect in rects_of(shape(system, object)) {
        super::draw::fill_rect(system, hdc, rect, brush)?;
    }

    Ok(1)
}

fn fill_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let brush = args.word(system);

    Ok(Answer::Word(fill_rgn(system, hdc, handle, brush)?))
}

/// Fills a region with the device context's brush -- one that stands for
/// a handle: a new device context's own first brush has none, and fills
/// nothing.
fn paint_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let brush = dc_of(system, hdc)
        .and_then(|dc| {
            system
                .handles
                .lookup(Object::Gdi(system.gdi.dcs[dc].state.brush))
        })
        .unwrap_or(0);

    Ok(Answer::Word(if brush == 0 {
        0
    } else {
        fill_rgn(system, hdc, handle, brush)?
    }))
}

/// Turns every pixel of a region, a rectangle at a time as `InvertRect`
/// turns one.
fn invert_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let Some(object) = region_of(system, handle) else {
        return Ok(Answer::Word(0));
    };

    if system.handles.resolve(hdc).is_none() {
        return Ok(Answer::Word(0));
    }

    for rect in rects_of(shape(system, object)) {
        super::draw::invert_rect(system, hdc, rect);
    }

    Ok(Answer::Word(1))
}

/// Draws a frame inside a region's edge with a brush, `width` across and
/// `height` down: the region less what is left of it moved each way by
/// those, straight and diagonally. **Recorded**: a pixel diagonally that
/// far from a hole is framed. The frame is a region of its own while it is
/// filled, which takes a handle and gives it back.
fn frame_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);
    let brush = args.word(system);
    let w = i32::from(args.signed(system));
    let h = i32::from(args.signed(system));
    let Some(object) = region_of(system, handle) else {
        return Ok(Answer::Word(0));
    };
    let region = shape(system, object).clone();
    let inner = [
        (w, 0),
        (-w, 0),
        (0, h),
        (0, -h),
        (w, h),
        (-w, h),
        (w, -h),
        (-w, -h),
    ]
    .iter()
    .fold(region.clone(), |kept, &(dx, dy)| {
        kept.intersect(&region.offset(dx, dy))
    });
    let frame = allocate(system, region.subtract(&inner));
    // A brush that stops the program leaves the frame's handle taken, as
    // the TypeScript engine's throw leaves it.
    let answer = fill_rgn(system, hdc, frame, brush)?;

    system.handles.free(frame);
    Ok(Answer::Word(answer))
}

/// What can be drawn on at all: the bitmap, or nothing for the one a
/// memory device context starts with.
fn visible(system: &mut System, dc: usize) -> ClipRegion {
    if let DcBitmap::Bitmap(object) = system.gdi.dcs[dc].bitmap
        && matches!(&system.gdi.objects[object], GdiObject::Bitmap(bitmap) if bitmap.pixels.placeholder)
    {
        return ClipRegion::EMPTY;
    }

    system.draw_target(dc).map_or(ClipRegion::EMPTY, |bitmap| {
        ClipRegion::rect(0, 0, bitmap.width(), bitmap.height())
    })
}

/// The region drawing is kept to: the clip region within what is visible.
pub(crate) fn clip_of(system: &mut System, dc: usize) -> ClipRegion {
    let shown = visible(system, dc);

    match &system.gdi.dcs[dc].state.clip {
        Some(clip) => clip.intersect(&shown),
        None => shown,
    }
}

/// Narrows the clip region, and answers the kind that is left.
fn narrow(system: &mut System, dc: usize, how: impl Fn(&ClipRegion) -> ClipRegion) -> u16 {
    let region = match system.gdi.dcs[dc].state.clip.clone() {
        Some(clip) => clip,
        None => visible(system, dc),
    };

    system.gdi.dcs[dc].state.clip = Some(how(&region));
    clip_of(system, dc).kind()
}

/// A logical rectangle's region in device terms. Its edges are mapped as
/// they are given, and not put in order: the wrong way round leaves
/// nothing.
fn device_region(system: &System, dc: usize, rect: [i32; 4]) -> ClipRegion {
    let m = mapping_of(system, dc);
    let (left, top) = device_point(&m, rect[0], rect[1]);
    let (right, bottom) = device_point(&m, rect[2], rect[3]);

    ClipRegion::rect(left, top, right, bottom)
}

fn clip_rect(
    system: &mut System,
    args: &mut Args,
    how: fn(&ClipRegion, &ClipRegion) -> ClipRegion,
) -> Answer {
    let hdc = args.word(system);
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));
    let Some(dc) = dc_of(system, hdc) else {
        return Answer::Word(0);
    };
    let rect = device_region(system, dc, rect);

    Answer::Word(narrow(system, dc, |region| how(region, &rect)))
}

/// Keeps drawing inside a rectangle as well: the kind of region left, or
/// nought for no device context.
fn intersect_clip_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(clip_rect(system, args, ClipRegion::intersect))
}

/// Keeps drawing out of a rectangle: the kind of region left, or nought for
/// no device context.
fn exclude_clip_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(clip_rect(system, args, ClipRegion::subtract))
}

/// Makes a copy of a region the clip region, or with none, drops it: the
/// kind of region drawing is kept to, or nought for no device context or
/// no such region.
pub fn select_clip_rgn(system: &mut System, hdc: u16, handle: u16) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };

    if handle == 0 {
        system.gdi.dcs[dc].state.clip = None;
        return clip_of(system, dc).kind();
    }

    let Some(object) = region_of(system, handle) else {
        return 0;
    };

    system.gdi.dcs[dc].state.clip = Some(shape(system, object).clone());
    clip_of(system, dc).kind()
}

fn select_clip_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);

    Ok(Answer::Word(select_clip_rgn(system, hdc, handle)))
}

/// Moves the clip region: the kind of region drawing is kept to, or nought
/// for no device context.
fn offset_clip_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let state = &mut system.gdi.dcs[dc].state;

    if let Some(clip) = &state.clip {
        state.clip = Some(clip.offset(x, y));
    }

    Ok(Answer::Word(clip_of(system, dc).kind()))
}

/// The smallest rectangle around what can be drawn on, in logical terms, in
/// order: the kind of region, or nought for no device context. The
/// TypeScript engine writes through a null pointer's sides, and throws, and
/// the program stops, as it does here.
fn get_clip_box(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    if far == 0 {
        return Err(Stop::Unsupported("a null RECT"));
    }

    let region = clip_of(system, dc);
    let bounds = region.bounds();
    let m = mapping_of(system, dc);
    let x0 = m.logical_x(i64::from(bounds.left)) as i32;
    let y0 = m.logical_y(i64::from(bounds.top)) as i32;
    let x1 = m.logical_x(i64::from(bounds.right)) as i32;
    let y1 = m.logical_y(i64::from(bounds.bottom)) as i32;

    write_rect(
        system,
        far,
        [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)],
    );
    Ok(kind_of(&region))
}

/// Whether any of a rectangle lies where the device context can draw:
/// inside its clip region, within its bitmap. Program Manager asks this of
/// each item before drawing it.
fn rect_visible(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(mut rect) = read_rect(system, far) else {
        return Ok(Answer::Word(0));
    };

    if let Some(m) = mapped(system, dc) {
        rect = device_rect(&m, rect);
    }

    let [left, top, right, bottom] = rect;
    let clip = clip_of(system, dc);

    Ok(Answer::Word(u16::from(
        clip.intersect(&ClipRegion::rect(left, top, right, bottom))
            .kind()
            > 1,
    )))
}

/// Whether a point lies where the device context can draw. **Recorded** by
/// `updrgn`: one inside what `ExcludeUpdateRgn` cut from the clip is not
/// visible, one outside it is.
fn pt_visible(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = signed(args.word(system));
    let y = signed(args.word(system));
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let (x, y) = mapped(system, dc).map_or((x, y), |m| device_point(&m, x, y));

    Ok(Answer::Word(u16::from(clip_of(system, dc).contains(x, y))))
}
