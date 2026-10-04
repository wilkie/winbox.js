//! `Arc`, `Chord` and `Pie`, as Windows 3.1's GDI makes them: the ellipse's
//! points cut at the two radials. **Read out of `GDI.EXE`** seg9, where the
//! three share `Ellipse`'s body (`02c4`) and its builder (`0b7e`), and
//! **recorded** by `wedges`.
//!
//! * The ellipse is a list of the points where its outline turns (`08fa`):
//!   from the right on the centre's row, round the top, the left and the
//!   bottom -- anticlockwise on the screen -- a quarter at a time, each
//!   quarter the walk `quarter` is. A quarter's straight runs are one edge,
//!   and a point two quarters share is there once.
//! * Each radial, from the centre through the point it is given, is found
//!   among the edges (`082b`): the first point anticlockwise of it, by a
//!   coarse step of an eighth of the list rounded to a power of two, then by
//!   halving. Anticlockwise is the sign of a cross product (`0750`).
//! * The edge before the start's point is walked a pixel at a time until it
//!   crosses the ray, and the edge after the end's point back until it has
//!   not; of the two pixels either side, the one past is kept unless the
//!   other is nearer the radial's point (`0794`).
//! * Radials that cross the same edge take two points of their own there,
//!   and the arc between them is the short way when the start is clockwise
//!   of the end, and the long way round the ellipse when it is not -- so a
//!   start and end the same is the whole ellipse.
//! * The list is turned to start at the start, and kept to the end; `Pie`
//!   ends with the centre. `Arc` draws the points as a polyline; `Chord` and
//!   `Pie` fill them and draw them closed, as `Polygon` does.
//!
//! Every point list this makes was checked against GDI's own code, run on
//! the TypeScript engine's processor, over every ellipse from 1 to 40 by 1
//! to 40.

use crate::curves::{Point, quarter};

/// Which of the three a wedge is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Arc,
    Chord,
    Pie,
}

/// The ellipse whose rectangle, right and bottom inside it, is `left` to
/// `right` and `top` to `bottom`, as the points where its outline turns, in
/// GDI's order (seg9 `08fa`, `0a97`). Empty for nothing to draw.
pub fn ellipse_vertices(left: i32, top: i32, right: i32, bottom: i32) -> Vec<Point> {
    let cx = (left + right) >> 1;
    let cy = (top + bottom) >> 1;
    let ox = (left + right) & 1;
    let oy = (top + bottom) & 1;
    let rx = cx - left.min(right);
    let ry = cy - top.min(bottom);

    // A radius of nought: the rectangle, or with no width or height,
    // nothing.
    if rx == 0 || ry == 0 {
        if ox + rx == 0 || ry + oy == 0 {
            return Vec::new();
        }

        return vec![
            (cx + ox + rx, cy - ry),
            (cx - rx, cy - ry),
            (cx - rx, cy + oy + ry),
            (cx + ox + rx, cy + oy + ry),
        ];
    }

    let q = quarter(rx, ry);
    let back: Vec<Point> = q.iter().rev().copied().collect();

    joined(&[
        back.iter().map(|&(x, y)| (cx + ox + x, cy - y)).collect(),
        q.iter().map(|&(x, y)| (cx - x, cy - y)).collect(),
        back.iter().map(|&(x, y)| (cx - x, cy + oy + y)).collect(),
        q.iter().map(|&(x, y)| (cx + ox + x, cy + oy + y)).collect(),
    ])
}

/// A rounded rectangle, `right` and `bottom` inside it, as the points where
/// its outline turns in GDI's order: its corner's quarters, `corner_width`
/// by `corner_height`, pulled apart by the straight sides between them, as
/// `ellipse_vertices` gives an ellipse's -- which is the rounded rectangle
/// whose corner is the whole of it. `inframe`'s rounded frames.
pub fn round_vertices(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    corner_width: i32,
    corner_height: i32,
) -> Vec<Point> {
    let rx = corner_width >> 1;
    let ry = corner_height >> 1;

    if rx == 0 || ry == 0 {
        return vec![(right, top), (left, top), (left, bottom), (right, bottom)];
    }

    let cx = left + rx;
    let cy = top + ry;
    let px = right - left - 2 * rx;
    let py = bottom - top - 2 * ry;
    let q = quarter(rx, ry);
    let back: Vec<Point> = q.iter().rev().copied().collect();

    joined(&[
        back.iter().map(|&(x, y)| (cx + px + x, cy - y)).collect(),
        q.iter().map(|&(x, y)| (cx - x, cy - y)).collect(),
        back.iter().map(|&(x, y)| (cx - x, cy + py + y)).collect(),
        q.iter().map(|&(x, y)| (cx + px + x, cy + py + y)).collect(),
    ])
}

/// Quarters' turning points joined into one list, none twice in a row.
fn joined(quarters: &[Vec<Point>]) -> Vec<Point> {
    let turns = |points: &[Point]| -> Vec<Point> {
        points
            .iter()
            .enumerate()
            .filter(|&(at, point)| {
                if at == 0 || at == points.len() - 1 {
                    return true;
                }

                let (ax, ay) = points[at - 1];
                let (bx, by) = points[at + 1];

                point.0 - ax != bx - point.0 || point.1 - ay != by - point.1
            })
            .map(|(_, &point)| point)
            .collect()
    };
    let mut all: Vec<Point> = Vec::new();

    for one in quarters {
        for point in turns(one) {
            if all.last() != Some(&point) {
                all.push(point);
            }
        }
    }

    if all.len() > 1 && all.first() == all.last() {
        all.pop();
    }

    all
}

/// The points of an arc, chord or pie (seg9 `0b7e` from `0c13`): the
/// rectangle as `ellipse_vertices` takes it, the radials' points `x3, y3`
/// and `x4, y4`, and `whole` for a start and end that are one point in
/// device terms but not in logical ones, anticlockwise of each other
/// (`0360`). Empty for nothing to draw.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub fn wedge_points(
    kind: Kind,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    x3: i32,
    y3: i32,
    x4: i32,
    y4: i32,
    whole: bool,
) -> Vec<Point> {
    let mut p = ellipse_vertices(left, top, right, bottom);
    let cx = (left + right) >> 1;
    let cy = (top + bottom) >> 1;

    if p.is_empty() || cx == left || cy == top {
        return Vec::new();
    }

    // Whether a point is anticlockwise of the ray, its direction `(dx, dy)`
    // with y upwards (`0750`).
    let past = |p: &[Point], index: usize, (dx, dy): (i64, i64)| {
        let (x, y) = p[index];

        (i64::from(cy) - i64::from(y)) * dx - (i64::from(x) - i64::from(cx)) * dy > 0
    };

    // The first point anticlockwise of the ray, or none (`082b`).
    let find = |p: &[Point], ray: (i64, i64)| -> Option<usize> {
        let count = p.len();
        let mut step = 1;

        while count > step {
            step <<= 1;
        }

        step >>= 3;
        step = step.max(1);

        let mut si = 0;
        let mut before = past(p, 0, ray);
        let mut di;

        loop {
            di = if step + si >= count {
                step + si - count
            } else {
                step + si
            };

            let now = past(p, di, ray);

            if !before && now {
                break;
            }

            if si >= di {
                return None;
            }

            before = now;
            si = di;
        }

        let mut half = step >> 1;

        if half == 0 {
            return Some(di);
        }

        let mut si = si as isize;
        let count = count as isize;

        while half > 0 {
            if past(p, si as usize, ray) {
                si -= half as isize;

                if si < 0 {
                    si += count;
                }
            } else {
                si += half as isize;

                if si >= count {
                    si -= count;
                }
            }

            half >>= 1;
        }

        if past(p, si as usize, ray) {
            return Some(si as usize);
        }

        Some(if si + 1 >= count {
            (si + 1 - count) as usize
        } else {
            (si + 1) as usize
        })
    };

    let dx3 = i64::from(x3) - i64::from(cx);
    let dy3 = i64::from(y3) - i64::from(cy);
    let dx4 = i64::from(x4) - i64::from(cx);
    let dy4 = i64::from(y4) - i64::from(cy);
    let starting = (dx3, -dy3);
    let ending = (dx4, -dy4);

    // Whether `kept`, a pixel past the ray, is kept over `other`: unless
    // `other` is nearer the radial's point (`0794`).
    let keeps = |kept: Point, other: Point, (dx, dy): (i64, i64)| {
        let rx = i64::from(cx) + dx;
        let ry = i64::from(cy) - dy;
        let square = |value: i64| value * value;

        square(rx - i64::from(other.0)) + square(i64::from(other.1) - ry)
            >= square(rx - i64::from(kept.0)) + square(i64::from(kept.1) - ry)
    };

    let (Some(mut start), Some(mut end)) = (find(&p, starting), find(&p, ending)) else {
        return Vec::new();
    };
    let mut before = if start == 0 { p.len() - 1 } else { start - 1 };
    let mut short = false;

    // Both radials on one edge: two points of their own there.
    if end == start || end == before {
        let point = p[start];

        p.splice(start..start, [point, point]);

        if end > start {
            end += 2;
        }

        if before > start {
            before += 2;
        }

        p[start + 1] = p[before];

        let turned = dx4 * dy3 - dx3 * dy4;

        if whole || (end == start && turned > 0) {
            end += 2;
            short = true;
        } else {
            start += 2;
            before = start - 1;
        }
    }

    // The start: the edge into its point walked to the ray.
    {
        let sx = (p[start].0 - p[before].0).signum();
        let sy = (p[start].1 - p[before].1).signum();

        while !past(&p, before, starting) {
            p[before] = (p[before].0 + sx, p[before].1 + sy);
        }

        let beyond = p[before];

        p[before] = (beyond.0 - sx, beyond.1 - sy);

        if keeps(beyond, p[before], starting) {
            p[before] = beyond;
        }
    }

    // The end: the edge out of the point before it walked back to the ray.
    {
        let previous = if end == 0 { p.len() - 1 } else { end - 1 };
        let sx = (p[end].0 - p[previous].0).signum();
        let sy = (p[end].1 - p[previous].1).signum();

        while past(&p, end, ending) {
            p[end] = (p[end].0 - sx, p[end].1 - sy);
        }

        let within = p[end];

        p[end] = (within.0 + sx, within.1 + sy);

        if keeps(within, p[end], ending) {
            p[end] = within;
        }
    }

    let from = before;
    let mut to = end;
    let mut points: Vec<Point>;

    // The short way on one edge: its two points alone (`0edc`).
    if short {
        points = vec![p[from], p[to]];
        to = 1;
    } else if to < from {
        points = p[from..].to_vec();
        points.extend_from_slice(&p[..from]);
        to += p.len() - from;
    } else {
        points = p[from..].to_vec();
        to -= from;
    }

    points.truncate(to + 1);

    if kind == Kind::Pie {
        points.push((cx, cy));
    }

    points
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ellipse_goes_round_from_the_right_anticlockwise() {
        let points = ellipse_vertices(0, 0, 8, 8);

        assert_eq!(points.first(), Some(&(8, 4)));
        assert!(
            points.iter().position(|&point| point == (4, 0))
                < points.iter().position(|&point| point == (0, 4))
        );
    }

    #[test]
    fn a_pie_ends_at_the_centre() {
        let points = wedge_points(Kind::Pie, 0, 0, 20, 20, 20, 10, 10, 0, false);

        assert_eq!(points.last(), Some(&(10, 10)));
        assert!(points.len() > 3);
    }

    #[test]
    fn a_start_and_end_the_same_is_the_whole_ellipse() {
        let whole = wedge_points(Kind::Arc, 0, 0, 20, 20, 20, 10, 20, 10, false);

        assert!(whole.len() >= ellipse_vertices(0, 0, 20, 20).len());
    }
}
