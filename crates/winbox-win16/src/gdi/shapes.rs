//! GDI's lines and shapes: `LineTo`, `Polyline`, `Polygon`, `PolyPolygon`,
//! `Rectangle`, `Ellipse`, `RoundRect`, `Arc`, `Chord`, `Pie`, the flood
//! fills and `LineDDA`, as winbox.js draws them on a display that leaves
//! lines, polygons and curves to GDI: the walks of `winbox_raster`'s
//! `line`, `polygon`, `curves`, `wedges` and `wide_lines`, each pixel put
//! through the drawing mode `SetROP2` set.

use winbox_cpu::{AX, DS, ES, SS};
use winbox_raster::curves::{Point, shape_of};
use winbox_raster::line::{Tie, Walk};
use winbox_raster::palette_colour::is_palette_ref;
use winbox_raster::polygon::{polygon_spans, rings_spans};
use winbox_raster::raster_op::rop_of_mode;
use winbox_raster::wedges::{Kind, wedge_points};
use winbox_raster::wide_lines::{pen_points, wide_outline};
use winbox_raster::{Color, DeviceBitmap};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::system::System;

use super::dc::dc_of;
use super::draw::{
    Paint, back_colour, canvas, dc_colour, device_point, device_rect, in_device, mapped, raster_op,
    signed,
};
use super::mapping::scale;
use super::objects::{GdiObject, Pen};

const PS_INSIDEFRAME: u16 = 6;
const FLOODFILLSURFACE: u16 = 1;

/// The styled pens' dashes, a bit to each stretch, the first the lowest:
/// `PS_DASH`, `PS_DOT`, `PS_DASHDOT` and `PS_DASHDOTDOT`.
///
/// **Recorded** by `penind` on the VGA, for lines a pixel wide: a stretch
/// is four pixels of a line that runs more across than down, and three of
/// one that runs down as much or more, whose first pixel is drawn before
/// them all; the pattern starts again at each line's start. The gaps are
/// the background colour in `OPAQUE` mode and left alone in `TRANSPARENT`.
/// A pen wider than a pixel draws solid.
fn dashes(style: Option<u16>) -> Option<u8> {
    match style? {
        1 => Some(0xe7),
        2 => Some(0x55),
        3 => Some(0x27),
        4 => Some(0x57),
        _ => None,
    }
}

/// Whether a line's pixel, by its step from the line's start, is a dash's.
fn dashed(bits: u8, across: bool, step: i32) -> bool {
    if !across && step == 0 {
        return true;
    }

    let stretch = if across {
        step >> 2
    } else {
        (step - 1).div_euclid(3)
    };

    (bits >> (stretch & 7)) & 1 != 0
}

pub fn implementation(name: &str) -> Option<Implementation> {
    if name == "LineDDA" {
        return Some(Implementation::Async(line_dda));
    }

    Some(Implementation::Sync(match name {
        "LineTo" => line_to_call,
        "Polyline" => polyline_call,
        "Polygon" => polygon_call,
        "PolyPolygon" => poly_polygon_call,
        "Rectangle" => rectangle_call,
        "Ellipse" => ellipse_call,
        "RoundRect" => round_rect_call,
        "Arc" => arc_call,
        "Chord" => chord_call,
        "Pie" => pie_call,
        "FloodFill" => flood_fill_call,
        "ExtFloodFill" => ext_flood_fill_call,
        _ => return None,
    }))
}

/// A device context's selected pen.
fn pen_of(system: &System, dc: usize) -> Pen {
    match &system.gdi.objects[system.gdi.dcs[dc].state.pen] {
        GdiObject::Pen(pen) => pen.clone(),
        _ => Pen {
            color: [0, 0, 0, 0],
            width: None,
            style: None,
            logpen: None,
        },
    }
}

/// Whether a device context's selected brush paints anything.
fn brush_paints(system: &System, dc: usize) -> bool {
    matches!(
        &system.gdi.objects[system.gdi.dcs[dc].state.brush],
        GdiObject::Brush(brush) if brush.color[3] != 0
    )
}

fn pen_colour(pen: &Pen) -> Color {
    let [red, green, blue, alpha] = pen.color;

    Color::rgba(red, green, blue, alpha)
}

/// `MulDiv` as the TypeScript engine's GDI call has it: each argument a
/// signed word, the quotient rounded to the nearest, a half away from
/// nought, held to a signed word.
// A JavaScript number's division.
#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
fn mul_div(multiplicand: i32, multiplier: i32, divisor: i32) -> i32 {
    let sign = |value: i32| f64::from(value as i16);
    let product = sign(multiplicand) * sign(multiplier);
    let divisor = sign(divisor);

    if divisor == 0.0 {
        return if product < 0.0 { -32768 } else { 32767 };
    }

    let exact = product / divisor;
    let result = exact.signum() * exact.abs().round();

    result.clamp(-32768.0, 32767.0) as i32
}

/// The selected pen's size in device pixels, across and down: nought for a
/// null pen, and a pen of width nought or one a pixel.
///
/// **Read out of `GDI.EXE`**, where the pen is realised (seg1 `268e`,
/// `2751`): the width scaled from window to viewport, and the height that
/// width taken through `MulDiv` by the display's `ASPECTX` over its
/// `ASPECTY`. A three pixel pen is two pixels tall on the EGA, 3 x 38 / 48,
/// and on the Hercules, 3 x 11 / 16, as `curves` recorded. Under a mapping
/// mode the width is the window's scaled to the viewport's across
/// (`drawgaps`: a pen two wide at twice the size draws four).
pub(crate) fn pen_size(system: &System, dc: usize) -> (i32, i32) {
    let pen = pen_of(system, dc);

    if pen.color[3] == 0 {
        return (0, 0);
    }

    let logical = i64::from(pen.width.unwrap_or(0)).abs();
    let width = mapped(system, dc)
        .map_or(logical, |m| scale(logical, m.vex, m.wex).abs())
        .max(1) as i32;
    let caps = &system.display.caps;

    (width, mul_div(width, caps.aspect_x, caps.aspect_y).abs())
}

/// How the display's driver walks a line on `bitmap`, leaving out the pixel
/// it stops on.
fn walk_on(system: &System, bitmap: &DeviceBitmap) -> Walk {
    Walk {
        width: bitmap.width(),
        height: bitmap.height(),
        clips: system.display.caps.clip_caps != 0,
        tie: Tie::named(system.display.line_tie.as_deref()),
        exclude_last: true,
        polyline: false,
    }
}

/// A line from one point to another as the driver draws it, in a colour,
/// the pixel it stops on left out: the recorded walk (`lines`).
fn draw_line(system: &System, bitmap: &mut DeviceBitmap, colour: [u8; 4], from: Point, to: Point) {
    for (x, y, _) in walk_on(system, bitmap).pixels(&[from, to]) {
        bitmap.context.set_pixel(x, y, colour);
    }
}

/// A line in the drawing mode `SetROP2` set: the walk's pixels combined
/// with what is there, as a `PatBlt` of the pen's colour would combine
/// them, one by one in the order walked. `R2_NOT` over a pixel drawn before
/// takes it out again (`polyline`). In `R2_COPYPEN`, a solid pen, it is the
/// plain walk.
///
/// A pen of a palette's colour, realized on the 256-colour display, draws
/// in that colour's slot of the system palette (`palreal`): SimTower frames
/// its boxes so.
fn line(system: &System, dc: usize, bitmap: &mut DeviceBitmap, from: Point, to: Point) {
    let state = &system.gdi.dcs[dc].state;
    let mode = state.rop2.unwrap_or(13);
    let pen = pen_of(system, dc);
    let bits = if pen.width.unwrap_or(0) <= 1 {
        dashes(pen.style)
    } else {
        None
    };
    let palette = std::rc::Rc::clone(&bitmap.device_palette);
    let in_slot = pen
        .logpen
        .map(|logpen| logpen.color)
        .filter(|&named| is_palette_ref(named))
        .map(|named| dc_colour(system, dc, &palette, named))
        .filter(|colour| colour.slot.is_some());

    if mode == 13 && bits.is_none() && in_slot.is_none() {
        draw_line(system, bitmap, pen.color, from, to);
        return;
    }

    if pen.color[3] == 0 {
        return;
    }

    let across = (to.0 - from.0).abs() > (to.1 - from.1).abs();
    let pixels = walk_on(system, bitmap).pixels(&[from, to]);
    let rop = rop_of_mode(i32::from(mode));
    let ink = in_slot.unwrap_or_else(|| in_device(system, &palette, pen_colour(&pen)));
    let gap = (state.back_mode != 1)
        .then(|| in_device(system, &palette, back_colour(system, dc, &palette)));

    for (x, y, step) in pixels {
        let on = bits.is_none_or(|bits| dashed(bits, across, step));
        let colour = if on { Some(ink) } else { gap };

        if let Some(colour) = colour {
            raster_op(
                system,
                dc,
                bitmap,
                Paint::Colour(colour),
                (x, y, 1, 1),
                rop,
                None,
                0,
                0,
            );
        }
    }
}

/// A line or chain of lines drawn with a pen wider than a pixel: the
/// outline `wide_outline` makes of the points, in device terms, filled with
/// `WINDING` in the pen's colour and the drawing mode, whatever the pen's
/// style (`widelin`, and `penind`'s dashed pen three wide, drawn solid) --
/// or, `patterned`, in that colour as a brush has it, as a `PS_INSIDEFRAME`
/// pen frames a pie or a chord (`inframe`). False for a pen no wider than
/// a pixel, which the walk draws.
fn wide_stroke(
    system: &System,
    dc: usize,
    bitmap: &DeviceBitmap,
    points: &[Point],
    patterned: bool,
) -> bool {
    let (width, height) = pen_size(system, dc);

    if width <= 1 {
        return false;
    }

    let outline = wide_outline(points, &pen_points(width, height));
    let pen = pen_of(system, dc);
    let [red, green, blue, _] = pen.color;
    let colour = if patterned {
        Color::rgb(red, green, blue)
    } else {
        in_device(system, &bitmap.device_palette, Color::rgb(red, green, blue))
    };
    let rop = rop_of_mode(i32::from(system.gdi.dcs[dc].state.rop2.unwrap_or(13)));

    for (y, from, to) in polygon_spans(&outline, true) {
        raster_op(
            system,
            dc,
            bitmap,
            Paint::Colour(colour),
            (from, y, to - from, 1),
            rop,
            None,
            0,
            0,
        );
    }

    true
}

/// One side of an outline, under the drawing mode: in `R2_COPYPEN` the
/// plain walk in the pen's colour, whatever its style.
fn outline_side(system: &System, dc: usize, bitmap: &mut DeviceBitmap, from: Point, to: Point) {
    if system.gdi.dcs[dc].state.rop2.unwrap_or(13) == 13 {
        let pen = pen_of(system, dc);

        draw_line(system, bitmap, pen.color, from, to);
    } else {
        line(system, dc, bitmap, from, to);
    }
}

/// A polygon's fill under the drawing mode, through the brush a pixel row
/// at a time: a solid colour the display has not is its dithered pattern,
/// and a pattern brush its pattern, in the copying mode too. `BogOut`'s
/// tiles' sides are polygons of a colour the VGA dithers. The fill runs
/// under the outline at the top and left, so under `R2_NOT` a top edge is
/// inverted twice and shows as it was (`metafile`).
fn fill_rings(
    system: &System,
    dc: usize,
    bitmap: &DeviceBitmap,
    rings: &[Vec<Point>],
    winding: bool,
    closed: bool,
) {
    if !brush_paints(system, dc) {
        return;
    }

    let rop = rop_of_mode(i32::from(system.gdi.dcs[dc].state.rop2.unwrap_or(13)));

    for (y, from, to) in rings_spans(rings, winding, closed) {
        raster_op(
            system,
            dc,
            bitmap,
            Paint::Selected,
            (from, y, to - from, 1),
            rop,
            None,
            0,
            0,
        );
    }
}

/// A point in device terms, where a mapping moves it.
fn to_device(system: &System, dc: usize, (x, y): Point) -> Point {
    mapped(system, dc).map_or((x, y), |m| device_point(&m, x, y))
}

/// Draws a line from the current position to a point, and moves the
/// current position there. On pixels winbox.js owns, the recorded walk,
/// which leaves out the pixel the line stops on; see `kb/gdi/lineto.md`
/// for what `lines` recorded. A pen wider than a pixel is `wide_stroke`.
pub fn line_to(system: &mut System, hdc: u16, x: i32, y: i32) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let start = std::mem::replace(&mut system.gdi.dcs[dc].state.position, (x, y));
    let from = to_device(system, dc, start);
    let to = to_device(system, dc, (x, y));

    if let Some(mut bitmap) = canvas(system, dc)
        && !wide_stroke(system, dc, &bitmap, &[from, to], false)
    {
        line(system, dc, &mut bitmap, from, to);
    }

    1
}

fn line_to_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));

    Ok(Answer::Word(line_to(system, hdc, x, y)))
}

/// `count` points at a far pointer, each two signed words, read within the
/// pointer's segment from the `first`.
fn points_at(system: &System, far: u32, first: usize, count: usize) -> Vec<Point> {
    (first..first + count)
        .map(|index| {
            let at = |half: usize| {
                let offset = (far as usize + index * 4 + half * 2) & 0xffff;
                let bytes = system.read_far((far & 0xffff_0000) | offset as u32, 2);

                i32::from(i16::from_le_bytes([bytes[0], bytes[1]]))
            };

            (at(0), at(1))
        })
        .collect()
}

/// Draws a chain of lines through points, with the selected pen.
///
/// **Recorded** by `polyline`: it is a move to the first point and a
/// `LineTo` to each after it, so the last point is not drawn and a pixel
/// two lines cross is drawn twice -- `R2_NOT` takes it out again -- and the
/// points are mapped as `LineTo`'s are. The current position is left where
/// it was. Fewer than two points answer nought and draw nothing; two the
/// same answer `TRUE` and draw nothing. A pen wider than a pixel draws the
/// chain as one, joined (`widelin`).
pub fn polyline(system: &mut System, hdc: u16, far: u32, count: i16) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };

    if far == 0 || count < 2 {
        return 0;
    }

    let logical = points_at(system, far, 0, count as usize);
    let points: Vec<Point> = logical
        .iter()
        .map(|&point| to_device(system, dc, point))
        .collect();

    if pen_of(system, dc).color[3] != 0
        && let Some(bitmap) = canvas(system, dc)
        && wide_stroke(system, dc, &bitmap, &points, false)
    {
        return 1;
    }

    let position = std::mem::replace(&mut system.gdi.dcs[dc].state.position, logical[0]);

    for &(x, y) in &logical[1..] {
        line_to(system, hdc, x, y);
    }

    system.gdi.dcs[dc].state.position = position;
    1
}

fn polyline_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let count = args.signed(system);

    Ok(Answer::Word(polyline(system, hdc, far, count)))
}

/// Fills a closed shape with the selected brush and outlines it with the
/// selected pen.
///
/// The fill is GDI's own scanline walk, which a display reporting
/// `POLYGONALCAPS` 8 leaves to GDI, recorded by `polyfill` on 117
/// quadrilaterals under both fill modes: `WINDING`, 2, fills what is wound
/// round; any other mode as `ALTERNATE` (`fillext` recorded 1 and 2 only).
/// The outline is each edge drawn as `LineTo` draws a line, the last back
/// to the first point, so every vertex is drawn once as the start of the
/// edge that leaves it; a pen wider than a pixel draws it as one wide
/// polyline, back to its first point (`widepoly`). A null brush or a null
/// pen draws nothing of its part.
pub fn polygon(system: &mut System, hdc: u16, far: u32, count: i16) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };

    if far == 0 || count < 2 {
        return 0;
    }

    let points: Vec<Point> = points_at(system, far, 0, count as usize)
        .into_iter()
        .map(|point| to_device(system, dc, point))
        .collect();
    let Some(mut bitmap) = canvas(system, dc) else {
        return 1;
    };
    let winding = system.gdi.dcs[dc].state.poly_fill_mode.unwrap_or(1) == 2;

    fill_rings(
        system,
        dc,
        &bitmap,
        std::slice::from_ref(&points),
        winding,
        true,
    );

    if pen_of(system, dc).color[3] == 0 {
        return 1;
    }

    let mut closed = points.clone();

    closed.push(points[0]);

    if wide_stroke(system, dc, &bitmap, &closed, false) {
        return 1;
    }

    for pair in closed.windows(2) {
        outline_side(system, dc, &mut bitmap, pair[0], pair[1]);
    }

    1
}

fn polygon_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let count = args.signed(system);

    Ok(Answer::Word(polygon(system, hdc, far, count)))
}

/// Several polygons, filled together under the fill mode and each outlined
/// with the pen. **Recorded** by `gdidraw`, on Windows 3.1: no ring is
/// closed. Each is outlined through its points and not back to its first,
/// and filled between those same edges alone, under `ALTERNATE` by pairs of
/// crossings and under `WINDING` between any two where the count is not
/// nought. A program that wants a ring closed repeats its first point.
pub fn poly_polygon(system: &mut System, hdc: u16, far: u32, counts: u32, rings: i16) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };

    if far == 0 || counts == 0 || rings <= 0 {
        return 0;
    }

    let mut all = Vec::new();
    let mut at = 0;

    for ring in 0..rings as usize {
        let offset = (counts as usize + ring * 2) & 0xffff;
        let bytes = system.read_far((counts & 0xffff_0000) | offset as u32, 2);
        let count = usize::try_from(i16::from_le_bytes([bytes[0], bytes[1]])).unwrap_or(0);
        let points: Vec<Point> = points_at(system, far, at, count)
            .into_iter()
            .map(|point| to_device(system, dc, point))
            .collect();

        at += count;
        all.push(points);
    }

    let Some(mut bitmap) = canvas(system, dc) else {
        return 1;
    };
    let winding = system.gdi.dcs[dc].state.poly_fill_mode.unwrap_or(1) == 2;

    fill_rings(system, dc, &bitmap, &all, winding, false);

    for points in &all {
        if points.len() < 2 || pen_of(system, dc).color[3] == 0 {
            continue;
        }

        if wide_stroke(system, dc, &bitmap, points, false) {
            continue;
        }

        for pair in points.windows(2) {
            outline_side(system, dc, &mut bitmap, pair[0], pair[1]);
        }
    }

    1
}

fn poly_polygon_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let counts = args.dword(system);
    let rings = args.signed(system);

    Ok(Answer::Word(poly_polygon(system, hdc, far, counts, rings)))
}

/// Pixels gathered into runs along their rows, `(y, left, right)`. A pixel
/// the pen's ring names twice is drawn once: under a mode that reads the
/// screen, twice would undo it (`metafile`: a rectangle under `R2_NOT`).
fn runs(pixels: &[Point]) -> Vec<(i32, i32, i32)> {
    let mut sorted = pixels.to_vec();

    sorted.sort_by_key(|&(x, y)| (y, x));

    let mut out: Vec<(i32, i32, i32)> = Vec::new();

    for (x, y) in sorted {
        if let Some(last) = out.last_mut() {
            if last.0 == y && x < last.2 {
                continue;
            }

            if last.0 == y && last.2 == x {
                last.2 += 1;
                continue;
            }
        }

        out.push((y, x, x + 1));
    }

    out
}

/// Draws what `shape_of` makes on the pixels a device context draws on, in
/// the drawing mode `SetROP2` set: first the brush's rows as `PatBlt`
/// paints them, patterned as the display driver patterns the brush, then
/// the pen's pixels in the nearest colour the device has -- but a
/// `PS_INSIDEFRAME` pen wider than a pixel, whose frame GDI fills as a
/// brush of its own colour, patterned like any brush (seg21 `1907`;
/// `inframe`'s purple frames).
///
/// The brush and the pen each mix with what is there, one after the other,
/// so where a thin pen's outline lies over the fill -- its left and top,
/// which a polygon fill takes in -- a mode like `R2_NOT` applies twice and
/// leaves the pixel as it was. **Recorded** by `mixmode`.
///
/// `PS_INSIDEFRAME` wider than a pixel keeps a rectangle's frame inside it:
/// the rectangle drawn is the one given less the pen's reach, half the
/// width rounded down at the left and top, the rest at the right and
/// bottom (`widepoly`). A curve keeps it inside another way: see
/// `shape_of`.
pub fn paint_shape(
    system: &mut System,
    hdc: u16,
    rect: [i32; 4],
    corner: Option<(i32, i32)>,
) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let [mut left, mut top, mut right, mut bottom] = rect;
    let mut corner = corner;

    if let Some(m) = mapped(system, dc) {
        [left, top, right, bottom] = device_rect(&m, rect);
        corner = corner.map(|(width, height)| {
            (
                scale(i64::from(width), m.vex, m.wex).abs() as i32,
                scale(i64::from(height), m.vey, m.wey).abs() as i32,
            )
        });
    }

    let (pen_width, pen_height) = pen_size(system, dc);
    let pen = pen_of(system, dc);
    let inside = pen.style == Some(PS_INSIDEFRAME) && pen_width > 1;

    if inside && corner == Some((0, 0)) {
        let across = left.max(right) - left.min(right);
        let down = top.max(bottom) - top.min(bottom);

        left = left.min(right) + (pen_width >> 1);
        top = top.min(bottom) + (pen_height >> 1);
        right = left - (pen_width >> 1) + across - ((pen_width + 1) >> 1) + 1;
        bottom = top - (pen_height >> 1) + down - ((pen_height + 1) >> 1) + 1;
    }

    let shape = shape_of(
        left.min(right),
        top.min(bottom),
        left.max(right),
        top.max(bottom),
        corner,
        pen_width,
        pen_height,
        brush_paints(system, dc),
        inside,
    );
    let rop = rop_of_mode(i32::from(system.gdi.dcs[dc].state.rop2.unwrap_or(13)));
    let Some(bitmap) = canvas(system, dc) else {
        return 1;
    };

    for &(y, from, to) in &shape.brush {
        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Selected,
            (from, y, to - from, 1),
            rop,
            None,
            0,
            0,
        );
    }

    if shape.pen.is_empty() {
        return 1;
    }

    let [red, green, blue, _] = pen.color;
    let colour = if inside {
        Color::rgb(red, green, blue)
    } else {
        in_device(system, &bitmap.device_palette, Color::rgb(red, green, blue))
    };

    for (y, from, to) in runs(&shape.pen) {
        raster_op(
            system,
            dc,
            &bitmap,
            Paint::Colour(colour),
            (from, y, to - from, 1),
            rop,
            None,
            0,
            0,
        );
    }

    1
}

fn rect_args(system: &System, args: &mut Args) -> [i32; 4] {
    [(); 4].map(|()| i32::from(args.signed(system)))
}

/// A rectangle outlined with the pen and filled with the brush, its right
/// and bottom edges outside it: the round rectangle with corners of nought.
/// **Recorded** by `mapmode`, a rectangle 6 by 6 drawn whole: the outline
/// runs along its first and last column and row, and the brush fills
/// inside. And by `clipdc`, through a clip.
fn rectangle_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = rect_args(system, args);

    Ok(Answer::Word(paint_shape(system, hdc, rect, Some((0, 0)))))
}

/// An ellipse inside a rectangle, its outline in the selected pen and its
/// inside in the selected brush; the right and bottom of the rectangle are
/// outside it. See `winbox_raster::curves`, read out of `GDI.EXE` and
/// recorded by `curves`: fourteen ellipses on four displays. Not yet
/// measured: the return value, and the pen styles other than solid and
/// inside frame.
fn ellipse_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = rect_args(system, args);

    Ok(Answer::Word(paint_shape(system, hdc, rect, None)))
}

/// A rectangle with rounded corners, each a quarter of an ellipse `width`
/// by `height`; recorded by `curves`: eleven rounded rectangles on four
/// displays, a corner one pixel larger than an `Ellipse` of its size, and a
/// corner of nought a rectangle. Calculator draws its keys with this. A wide
/// pen that leaves less than nothing of the inner corner has the inside
/// filled as the inner rectangle, by GDI's own `PatBlt` (`drawgaps`).
fn round_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = rect_args(system, args);
    let width = i32::from(args.signed(system));
    let height = i32::from(args.signed(system));

    Ok(Answer::Word(paint_shape(
        system,
        hdc,
        rect,
        Some((width, height)),
    )))
}

/// `Arc`, `Chord` and `Pie`: the ellipse in the rectangle, cut at the
/// radials from its centre through the two points, anticlockwise from the
/// first to the second. **Read out of `GDI.EXE`** seg9 `02c4`, the body
/// they share with `Ellipse`, and **recorded** by `wedges`; the points are
/// `wedge_points`.
///
/// * The rectangle and points are mapped to the device, the rectangle put
///   in order and a pixel taken off its right and bottom; one with nothing
///   left draws nothing and answers nought.
/// * A start and end that the mapping makes one point, though they were
///   two, are the whole ellipse where the start is anticlockwise of the
///   end, and for `Arc` nothing (`0360`).
/// * `Arc` draws its points as a polyline, each edge as `LineTo` does, the
///   last point left off. `Chord` and `Pie` fill theirs with the brush, as
///   `Ellipse` does, and draw every edge with the pen, as `Polygon` does.
/// * A pen wider than a pixel draws the arc's points, or a chord's or pie's
///   back to the first, as one wide polyline (`widepoly`); `PS_INSIDEFRAME`
///   keeps a pie's or a chord's frame inside the rectangle as it does a
///   rectangle's, in the pen's colour as a brush has it (`inframe`).
pub fn wedge(system: &mut System, kind: Kind, hdc: u16, args: [i32; 8]) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let [x1, y1, x2, y2, x3, y3, x4, y4] = args;
    let (dl, dt) = to_device(system, dc, (x1, y1));
    let (dr, db) = to_device(system, dc, (x2, y2));
    let (sx, sy) = to_device(system, dc, (x3, y3));
    let (ex, ey) = to_device(system, dc, (x4, y4));
    let mut whole = false;

    // One point in the device that was two: which way round, in logical
    // terms.
    if kind != Kind::Chord && sx == ex && sy == ey {
        let cx = (x1 + x2) >> 1;
        let cy = (y1 + y2) >> 1;

        whole =
            i64::from(x3 - cx) * i64::from(y4 - cy) - i64::from(x4 - cx) * i64::from(y3 - cy) > 0;

        if whole && kind == Kind::Arc {
            return 0;
        }
    }

    let left = dl.min(dr);
    let top = dt.min(db);
    let right = dl.max(dr) - 1;
    let bottom = dt.max(db) - 1;

    if left > right || top > bottom {
        return 0;
    }

    let (pen_width, pen_height) = pen_size(system, dc);
    let inside = pen_of(system, dc).style == Some(PS_INSIDEFRAME) && pen_width > 1;
    let [il, it, ir, ib] = if inside {
        [
            left + (pen_width >> 1),
            top + (pen_height >> 1),
            right - (pen_width >> 1),
            bottom - (pen_height >> 1),
        ]
    } else {
        [left, top, right, bottom]
    };

    if il > ir || it > ib {
        return 0;
    }

    let points = wedge_points(kind, il, it, ir, ib, sx, sy, ex, ey, whole);

    if points.len() < 2 {
        return 0;
    }

    let rop = rop_of_mode(i32::from(system.gdi.dcs[dc].state.rop2.unwrap_or(13)));
    let Some(mut bitmap) = canvas(system, dc) else {
        return 1;
    };

    if kind != Kind::Arc && brush_paints(system, dc) {
        for (y, from, to) in polygon_spans(&points, false) {
            raster_op(
                system,
                dc,
                &bitmap,
                Paint::Selected,
                (from, y, to - from, 1),
                rop,
                None,
                0,
                0,
            );
        }
    }

    if pen_of(system, dc).color[3] == 0 {
        return 1;
    }

    let mut stroked = points.clone();

    if kind != Kind::Arc {
        stroked.push(points[0]);
    }

    if wide_stroke(system, dc, &bitmap, &stroked, inside) {
        return 1;
    }

    for pair in stroked.windows(2) {
        outline_side(system, dc, &mut bitmap, pair[0], pair[1]);
    }

    1
}

fn wedge_args(system: &System, args: &mut Args) -> (u16, [i32; 8]) {
    let hdc = args.word(system);

    (hdc, [(); 8].map(|()| i32::from(args.signed(system))))
}

fn arc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let (hdc, points) = wedge_args(system, args);

    Ok(Answer::Word(wedge(system, Kind::Arc, hdc, points)))
}

fn chord_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let (hdc, points) = wedge_args(system, args);

    Ok(Answer::Word(wedge(system, Kind::Chord, hdc, points)))
}

fn pie_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let (hdc, points) = wedge_args(system, args);

    Ok(Answer::Word(wedge(system, Kind::Pie, hdc, points)))
}

/// Fills outward from a point with the brush, to its four neighbours at a
/// time, over pixels that are not the border colour, or, with
/// `FLOODFILLSURFACE`, that are the surface colour. **Recorded** by
/// `gdidraw`: a fill inside a black frame stops at a diagonal line a pixel
/// wide -- it does not pass corner to corner -- and a fill of a red area
/// fills only the red. Started on the border colour, it fills nothing and
/// answers nought; otherwise it answers `TRUE`. The fill is the brush's
/// colour, the nearest the device has, not its pattern: a row's run at a
/// time, as it lies.
pub fn ext_flood_fill(
    system: &mut System,
    hdc: u16,
    x: i32,
    y: i32,
    colorref: u32,
    kind: u16,
) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };
    let Some(mut bitmap) = canvas(system, dc) else {
        return 0;
    };
    let (px, py) = to_device(system, dc, (x, y));
    let palette = std::rc::Rc::clone(&bitmap.device_palette);
    let colour = dc_colour(system, dc, &palette, colorref);
    let index = winbox_raster::colour_match::matched_index(
        system.display_kind(),
        &mut palette.borrow_mut(),
        colour.red(),
        colour.green(),
        colour.blue(),
    );
    let surface = kind == FLOODFILLSURFACE;
    let clip = super::regions::clip_of(system, dc);
    let view = bitmap.context.clip.clone();
    let (width, height) = (bitmap.width(), bitmap.height());
    let fills = |fx: i32, fy: i32| {
        if fx < 0 || fy < 0 || fx >= width || fy >= height {
            return false;
        }

        if !clip.contains(fx, fy) || view.as_ref().is_some_and(|view| !view(fx, fy)) {
            return false;
        }

        let at = bitmap.index_at(fx, fy).map(usize::from);

        if surface {
            at == Some(index)
        } else {
            at != Some(index)
        }
    };

    if !fills(px, py) {
        return 0;
    }

    let mut seen = vec![false; (width * height) as usize];
    let mut stack = vec![(px, py)];

    seen[(py * width + px) as usize] = true;

    while let Some((cx, cy)) = stack.pop() {
        for (nx, ny) in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)] {
            if nx >= 0
                && ny >= 0
                && nx < width
                && ny < height
                && !seen[(ny * width + nx) as usize]
                && fills(nx, ny)
            {
                seen[(ny * width + nx) as usize] = true;
                stack.push((nx, ny));
            }
        }
    }

    let paint = match &system.gdi.objects[system.gdi.dcs[dc].state.brush] {
        GdiObject::Brush(brush) => match brush.colorref {
            Some(colorref) => {
                let colour = dc_colour(system, dc, &palette, colorref);

                [colour.red(), colour.green(), colour.blue(), 0xff]
            }
            None => brush.color,
        },
        _ => [0, 0, 0, 0],
    };

    for row in 0..height {
        for column in 0..width {
            if seen[(row * width + column) as usize] {
                bitmap.context.set_pixel(column, row, paint);
            }
        }
    }

    1
}

fn ext_flood_fill_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let colorref = args.dword(system);
    let kind = args.word(system);

    Ok(Answer::Word(ext_flood_fill(
        system, hdc, x, y, colorref, kind,
    )))
}

fn flood_fill_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let colorref = args.dword(system);

    Ok(Answer::Word(ext_flood_fill(system, hdc, x, y, colorref, 0)))
}

/// The points of a line but its last: along the longer axis a step at a
/// time, the other rounded to the nearest, halves away from the start.
fn dda_points(x1: i32, y1: i32, x2: i32, y2: i32) -> Vec<Point> {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let steps = dx.abs().max(dy.abs());
    let along = |i: i32, delta: i32| {
        delta.signum()
            * (2 * i64::from(i) * i64::from(delta.abs()) + i64::from(steps))
                .div_euclid(2 * i64::from(steps)) as i32
    };

    (0..steps)
        .map(|i| (x1 + along(i, dx), y1 + along(i, dy)))
        .collect()
}

/// Calls a procedure with each point of a line but its last: along the
/// longer axis a step at a time, the other rounded to the nearest, halves
/// away from the start. **Recorded** by `gdidraw` for lines each way, steep
/// and shallow; a line of one point calls it not at all. How a half rounds
/// is not recorded: none of the lines had one. The procedure is called as
/// USER calls most of a program's: AX, DS and ES the stack's segment.
fn line_dda(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (points, procedure, lparam, stack) = {
            let system = engine.system();
            let x1 = signed(args.word(&system));
            let y1 = signed(args.word(&system));
            let x2 = signed(args.word(&system));
            let y2 = signed(args.word(&system));
            let procedure = args.dword(&system);
            let lparam = args.dword(&system);

            (
                dda_points(x1, y1, x2, y2),
                procedure,
                lparam,
                system.cpu.segments[SS].selector,
            )
        };

        for (x, y) in points {
            engine
                .call_with(
                    procedure,
                    &[
                        GuestArg::Word(x as u16),
                        GuestArg::Word(y as u16),
                        GuestArg::Long(lparam),
                    ],
                    &[
                        Register::Word(AX, stack),
                        Register::Segment(DS, stack),
                        Register::Segment(ES, stack),
                    ],
                )
                .await?;
        }

        Ok(Answer::Nothing)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dda_leaves_out_the_last_point() {
        assert_eq!(dda_points(0, 0, 3, 1), vec![(0, 0), (1, 0), (2, 1)]);
        assert!(dda_points(4, 4, 4, 4).is_empty());
    }

    #[test]
    fn runs_take_a_pixel_named_twice_once() {
        assert_eq!(
            runs(&[(2, 0), (1, 0), (2, 0), (5, 1)]),
            vec![(0, 1, 3), (1, 5, 6)]
        );
    }

    #[test]
    fn gdi_mul_div_rounds_a_half_away_from_nought() {
        assert_eq!(mul_div(3, 38, 48), 2);
        assert_eq!(mul_div(3, 11, 16), 2);
        assert_eq!(mul_div(-3, 1, 2), -2);
        assert_eq!(mul_div(5, 1, 0), 32767);
    }

    #[test]
    fn dashes_stretch_four_across_and_three_down() {
        // `PS_DOT`: every other stretch.
        assert!(dashed(0x55, true, 3));
        assert!(!dashed(0x55, true, 4));
        assert!(dashed(0x55, false, 0));
        assert!(dashed(0x55, false, 3));
        assert!(!dashed(0x55, false, 4));
    }
}
