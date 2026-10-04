//! Ellipses and rounded rectangles, as Windows 3.1's GDI makes them on a
//! display that leaves curves to it.
//!
//! **Read out of `GDI.EXE`**, and **recorded** by `curves`: 25 shapes on
//! four displays, fourteen ellipses and eleven rounded rectangles from one
//! pixel square to forty by thirty, with a pen one pixel wide, three wide
//! and none, over a light grey brush and none -- every pixel of all four
//! agrees.
//!
//! GDI turns the shape into a list of points and fills that as a polygon,
//! with `ALTERNATE`, by the walk `polygon_spans` is (`Ellipse` and
//! `RoundRect` share a body at seg9 `02c4`):
//!
//! * with a pen no wider than a pixel, the points are the polygon, and the
//!   pen and brush draw it as `Polygon` does -- the brush filling it, then
//!   the pen along each edge;
//! * with a wider pen (seg21 `14b7`), the brush fills a smaller shape, and a
//!   solid brush of the pen's colour fills the ring between that and a
//!   larger one: the two lists as one polygon, which `ALTERNATE` makes a
//!   ring.

use std::collections::HashSet;

use crate::polygon::{Span, polygon_spans};
use crate::wedges::{ellipse_vertices, round_vertices};

/// A point, `(x, y)`.
pub type Point = (i32, i32);

/// A quarter of an ellipse whose radius along its longer axis is `a` and
/// along its shorter `b`, from `(a, 0)` to `(0, b)`. seg9 `1175`, whole
/// numbers throughout.
///
/// The walk steps `y` while the curve is steeper than a diagonal, and `x`
/// after. In the second half, a point on the column it last stood on is
/// passed over whenever the error term says to step both ways: for a circle
/// of radius four that leaves out (3, 3), which the textbook midpoint walk
/// draws.
// The walk's own names, as GDI's arithmetic has them.
#[allow(clippy::many_single_char_names)]
fn generate(a: i64, b: i64) -> Vec<Point> {
    let a2 = a * a;
    let b2 = b * b;
    let mut points: Vec<Point> = Vec::new();
    let mut x = a;
    let mut y: i64 = 0;
    let mut tx = 2 * a * b2;
    let mut ty = 0;
    let mut p = a2 - a * b2 + (b2 >> 2);
    let d = b2 - a2;
    let k = d + (d >> 1);

    loop {
        points.push((x as i32, y as i32));

        if p >= 0 {
            x -= 1;
            tx -= 2 * b2;
            p -= tx;
        }

        y += 1;
        ty += 2 * a2;
        p += ty + a2;

        if ty >= tx {
            break;
        }
    }

    if x < 0 {
        return points;
    }

    p += (k - ty - tx).div_euclid(2);

    loop {
        let last = points.last().map_or(i32::MIN, |point| point.0);

        if !(p >= 0 && i64::from(last) == x) {
            points.push((x as i32, y as i32));

            if p < 0 {
                y += 1;
                ty += 2 * a2;
                p += ty;
            }
        }

        x -= 1;
        tx -= 2 * b2;
        p -= tx;
        p += b2;

        if x < 0 {
            break;
        }
    }

    points
}

/// The first quarter of an ellipse of radii `rx` and `ry`, from `(0, ry)`
/// to `(rx, 0)`. The generator walks from the end of the longer axis, so a
/// tall ellipse is walked on its side and turned back (seg9 `08fa`, `113e`).
pub fn quarter(rx: i32, ry: i32) -> Vec<Point> {
    if ry <= rx {
        let mut points = generate(i64::from(rx), i64::from(ry));

        points.reverse();
        return points;
    }

    generate(i64::from(ry), i64::from(rx))
        .into_iter()
        .map(|(x, y)| (y, x))
        .collect()
}

/// The points of a rounded rectangle, in order around it; the corners are
/// the quarters of an ellipse `corner_width` by `corner_height` pixels,
/// counted inclusively, and an `Ellipse` is the rounded rectangle whose
/// corner is the whole shape. seg9 `0b7e`.
///
/// The right and bottom edges are inside the shape: GDI takes one from each
/// before it starts. The corner's radius is half its size, rounded down,
/// and when the size is odd the right and bottom quarters stand a pixel
/// further out, as do they by the length of the straight sides between
/// them. A radius of nought on either axis makes the shape a rectangle
/// (`0a97`).
pub fn round_points(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    corner_width: i32,
    corner_height: i32,
) -> Vec<Point> {
    let rx = corner_width >> 1;
    let ry = corner_height >> 1;
    let cx = left + rx;
    let cy = top + ry;
    let px = right - left - 2 * rx;
    let py = bottom - top - 2 * ry;

    if rx == 0 || ry == 0 {
        return vec![(right, top), (right, bottom), (left, bottom), (left, top)];
    }

    let q = quarter(rx, ry);
    let back: Vec<Point> = q.iter().rev().copied().collect();
    let mut points = Vec::with_capacity(q.len() * 4);

    points.extend(q.iter().map(|&(x, y)| (cx + px + x, cy - y)));
    points.extend(back.iter().map(|&(x, y)| (cx + px + x, cy + py + y)));
    points.extend(q.iter().map(|&(x, y)| (cx - x, cy + py + y)));
    points.extend(back.iter().map(|&(x, y)| (cx - x, cy - y)));
    points
}

/// The points of a round shape moved so that a polygon fill of them covers
/// the shape's right and bottom edges too, which a fill otherwise leaves
/// out: how GDI shapes both sides of a `PS_INSIDEFRAME` pen's frame (seg21
/// `1349`), so that its outside is the shape as a thin pen draws it.
///
/// The points go round from the right, up and over the top. The first run,
/// while they climb or stay level, moves a pixel right, all but its last
/// point. The next, while they go left or stay, down the left side, stays
/// where it is, and so does what follows as far as the first step level
/// along the bottom. From there two points are doubled -- the one at that
/// step, and the one as far from the end as that is from the half-way point
/// -- and the bottom, while it runs level or falls, moves a pixel right and
/// down; the rest of the bottom a pixel down, and from the second doubled
/// point on, the right side a pixel right. `inframe` recorded the frames
/// this makes; and run on this emulator's processor over every ellipse from
/// 1 to 40 by 1 to 30, GDI's own code makes the same list of each, 1,131 of
/// 1,131.
fn own_edges(points: &[Point]) -> Vec<Point> {
    let n = points.len();
    let mut out = points.to_vec();
    let mut at = 1;

    out[0].0 += 1;

    while at < n && out[at].1 <= out[at - 1].1 {
        out[at].0 += 1;
        at += 1;
    }

    out[at - 1].0 -= 1;

    while at < n && out[at].0 <= out[at - 1].0 {
        at += 1;
    }

    // `at` is at least one here, and is taken back one.
    let mut at = at as isize - 1;

    // A bottom with no level step runs the search to the end.
    while (at as usize) < n
        && out.get(at as usize + 1).map(|point| point.1) != Some(out[at as usize].1)
    {
        at += 1;
    }

    let step = at;
    let mirror = (n as isize >> 1) - step + n as isize;

    // Never past the end for a list that goes round from the right, as an
    // ellipse's and a rounded rectangle's do.
    if mirror > n as isize + 1 {
        return out;
    }

    // Two places more, the points from each doubled one moved along.
    let mut grown = out;

    grown.push((0, 0));
    grown.push((0, 0));

    let mut at = n as isize + 1;

    while at > mirror {
        grown[at as usize] = grown[at as usize - 2];
        at -= 1;
    }

    let mut at = mirror;

    while at > step {
        grown[at as usize] = grown[at as usize - 1];
        at -= 1;
    }

    let mut at = step + 1;

    while at < mirror && grown[at as usize + 1].1 >= grown[at as usize].1 {
        grown[at as usize].0 += 1;
        grown[at as usize].1 += 1;
        at += 1;
    }

    while (at as usize) < grown.len() {
        if at < mirror {
            grown[at as usize].1 += 1;
        } else {
            grown[at as usize].0 += 1;
        }

        at += 1;
    }

    grown
}

/// What a shape covers: the pen's pixels, and the brush's rows `(y, left,
/// right)`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Shape {
    pub pen: Vec<Point>,
    pub brush: Vec<Span>,
}

/// The points' edges as `LineTo` draws them, each without its last pixel.
/// Neighbouring points are a pixel apart, or along a straight side, so
/// every edge is level, upright or diagonal and its pixels are plain. A
/// pixel named twice is there once, where it was first named.
fn edges(points: &[Point]) -> Vec<Point> {
    let mut seen = HashSet::new();
    let mut pixels = Vec::new();

    for (index, &(mut x, mut y)) in points.iter().enumerate() {
        let (nx, ny) = points[(index + 1) % points.len()];
        let sx = (nx - x).signum();
        let sy = (ny - y).signum();

        while x != nx || y != ny {
            if seen.insert((x, y)) {
                pixels.push((x, y));
            }

            x += if x == nx { 0 } else { sx };
            y += if y == ny { 0 } else { sy };
        }
    }

    pixels
}

/// The pixels of a row from `from` up to `to`.
fn span(y: i32, from: i32, to: i32) -> impl Iterator<Item = Point> {
    (from..to).map(move |x| (x, y))
}

/// The pixels of every span.
fn pixels_of(spans: &[Span]) -> Vec<Point> {
    spans
        .iter()
        .flat_map(|&(y, from, to)| span(y, from, to))
        .collect()
}

/// A rounded rectangle, or with `corner` none an ellipse, drawn by a pen
/// `pen_width` by `pen_height` device pixels (nought for no pen) and a
/// brush or none. `right` and `bottom` are outside the shape, as `Ellipse`
/// takes them; `corner` is the device size `RoundRect` was given.
#[allow(
    clippy::too_many_arguments,
    clippy::fn_params_excessive_bools,
    clippy::too_many_lines
)]
pub fn shape_of(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    corner: Option<(i32, i32)>,
    pen_width: i32,
    pen_height: i32,
    brush: bool,
    inside_frame: bool,
) -> Shape {
    let r = right - 1;
    let b = bottom - 1;

    if r < left || b < top {
        return Shape::default();
    }

    // No larger than the shape: seg9 `0405`.
    let cw = corner.map_or(r - left, |corner| corner.0.abs().min(r - left));
    let ch = corner.map_or(b - top, |corner| corner.1.abs().min(b - top));
    let square = corner.is_some() && cw == 0 && ch == 0;

    if pen_width <= 1 {
        let points = round_points(left, top, r, b, cw, ch);
        // `Rectangle`'s own body (seg25 `0056`) fills inside its frame; a
        // curve's fill runs under the pen at its left and top, which only
        // shows under a mode that reads the screen (`mixmode`; `metafile`:
        // a rectangle under `R2_NOT`, its frame inverted once).
        let inside = square && pen_width == 1;

        return Shape {
            pen: if pen_width != 0 {
                edges(&points)
            } else {
                Vec::new()
            },
            brush: if brush {
                if inside {
                    polygon_spans(&round_points(left + 1, top + 1, r, b, 0, 0), false)
                } else {
                    polygon_spans(&points, false)
                }
            } else {
                Vec::new()
            },
        };
    }

    // `PS_INSIDEFRAME` round a curve: the outside is the shape's own
    // outline, the inside the rectangle less the whole pen, its corner less
    // twice it, each list moved to take in its right and bottom edges
    // (seg21 `1504`, `1349`). `inframe`. A rectangle keeps its own body.
    if inside_frame && !square {
        let list_of = |l: i32, t: i32, sr: i32, sb: i32, w: i32, h: i32| {
            own_edges(&if corner.is_some() {
                round_vertices(l, t, sr, sb, w.max(0), h.max(0))
            } else {
                ellipse_vertices(l, t, sr, sb)
            })
        };
        let il = left + pen_width;
        let it = top + pen_height;
        let ir = r - pen_width;
        let ib = b - pen_height;
        let outer = polygon_spans(&list_of(left, top, r, b, cw, ch), false);

        if ir < il || ib < it {
            return Shape {
                pen: pixels_of(&outer),
                brush: Vec::new(),
            };
        }

        let inner = polygon_spans(
            &list_of(il, it, ir, ib, cw - 2 * pen_width, ch - 2 * pen_height),
            false,
        );
        let within: HashSet<Point> = pixels_of(&inner).into_iter().collect();

        return Shape {
            pen: pixels_of(&outer)
                .into_iter()
                .filter(|point| !within.contains(point))
                .collect(),
            brush: if brush { inner } else { Vec::new() },
        };
    }

    // The inner shape is the rectangle less the pen's larger half before
    // and its smaller half after, the outer that grown by the whole pen, and
    // a rounded corner shrinks and grows with them (seg21 `151d`, `178d`).
    let il = left + ((pen_width + 1) >> 1);
    let it = top + ((pen_height + 1) >> 1);
    let ir = r - (pen_width >> 1);
    let ib = b - (pen_height >> 1);
    // A corner of nought is `Rectangle`'s own body (seg25 `0056`), whose
    // ring is square: it does not grow with the pen (`widepoly`).
    let grow = |by: i32| {
        corner.map(|_| {
            if square {
                (0, 0)
            } else {
                (cw + by * pen_width, ch + by * pen_height)
            }
        })
    };
    let shape = |l: i32, t: i32, sr: i32, sb: i32, size: Option<(i32, i32)>| {
        round_points(
            l,
            t,
            sr,
            sb,
            size.map_or(sr - l, |size| size.0.max(0)),
            size.map_or(sb - t, |size| size.1.max(0)),
        )
    };
    let outer = polygon_spans(
        &shape(
            il - pen_width,
            it - pen_height,
            ir + pen_width,
            ib + pen_height,
            grow(1),
        ),
        false,
    );

    // Nothing inside: the ring is the whole shape (`1779`).
    if ir < il || ib < it {
        return Shape {
            pen: pixels_of(&outer),
            brush: Vec::new(),
        };
    }

    // A rounded corner the pen leaves less than nothing of, either way: the
    // inside is the inner rectangle, its right and bottom edges and all, as
    // a `PatBlt` fills it (seg21 `16db`, `drawgaps`). A corner of just
    // nought is the rectangle of the fill as any other.
    let empty = corner.is_some() && !square && (cw - pen_width < 0 || ch - pen_height < 0);
    let inner = if empty {
        polygon_spans(&shape(il, it, ir + 1, ib + 1, Some((0, 0))), false)
    } else {
        polygon_spans(&shape(il, it, ir, ib, grow(-1)), false)
    };
    let inside: HashSet<Point> = pixels_of(&inner).into_iter().collect();

    Shape {
        pen: pixels_of(&outer)
            .into_iter()
            .filter(|point| !inside.contains(point))
            .collect(),
        brush: if brush { inner } else { Vec::new() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_over_the_point_a_textbook_midpoint_walk_puts_at_a_circles_diagonal() {
        assert_eq!(
            quarter(4, 4),
            vec![(0, 4), (1, 4), (2, 3), (3, 2), (4, 1), (4, 0)]
        );
    }

    #[test]
    fn walks_a_tall_ellipse_on_its_side_and_turns_it_back() {
        let wide = quarter(6, 3);
        let tall = quarter(3, 6);
        let turned: Vec<Point> = wide.iter().map(|&(x, y)| (y, x)).rev().collect();

        assert_eq!(tall, turned);
    }

    #[test]
    fn makes_a_rectangle_of_a_corner_with_no_radius() {
        assert_eq!(
            round_points(0, 0, 9, 4, 1, 1),
            vec![(9, 0), (9, 4), (0, 4), (0, 0)]
        );
    }

    #[test]
    fn draws_nothing_for_an_ellipse_a_pixel_square() {
        assert_eq!(
            shape_of(4, 4, 5, 5, None, 1, 1, true, false),
            Shape::default()
        );
    }

    #[test]
    fn keeps_the_brush_inside_a_wide_pen() {
        let shape = shape_of(0, 0, 30, 24, None, 3, 3, true, false);
        let pen: HashSet<Point> = shape.pen.iter().copied().collect();

        assert!(!shape.brush.is_empty());

        for &(y, from, to) in &shape.brush {
            for x in from..to {
                assert!(!pen.contains(&(x, y)));
            }
        }
    }
}
