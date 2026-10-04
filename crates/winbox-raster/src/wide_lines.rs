//! Lines drawn with a pen wider than a pixel, as Windows 3.1's GDI draws
//! them on a display that leaves them to it: the polyline swept by a polygon
//! the pen's size, filled with `WINDING` in the pen's colour. **Read out of
//! `GDI.EXE`** seg21, `Polyline`'s body (`0726`) and its wide path (`10cd`),
//! and **recorded** by `widelin`: twenty lines and polylines, 2 to 8 pixels
//! wide, level, upright, slanted, a point, and with joins -- every pixel
//! agrees.
//!
//! * The pen (`0f90`) is sixteen points, clockwise on the screen from the
//!   left. Up to 5 wide it is a square, from less half the width, rounded
//!   away from nought, to the rest of it; wider, a sixteen-sided figure of
//!   GDI's own table scaled to the width by `MulDiv`, its left and top made
//!   exactly a width from its right and bottom.
//! * Each segment's direction is one of sixteen, by the signs of its steps,
//!   which is the longer, and whether the shorter is more than half of it
//!   (`0cb6`, `0d48`). At each point, the pen's points from the way in to
//!   the way out go on one side of the outline, and the point opposite each
//!   on the other; at the ends the way is turned round, so the pen's half
//!   facing out of the line caps it.
//! * The two sides, the second turned back, are one polygon.

use crate::curves::Point;

/// GDI's sixteen-sided pen, on a radius of 10000 (`GDI.EXE` data segment
/// `0484`).
const ROUND: [Point; 16] = [
    (-9808, -1951),
    (-8317, -5556),
    (-5556, -8317),
    (-1951, -9808),
    (1951, -9808),
    (5556, -8317),
    (8317, -5556),
    (9808, -1951),
    (9808, 1951),
    (8317, 5556),
    (5556, 8317),
    (1951, 9808),
    (-1951, 9808),
    (-5556, 8317),
    (-8317, 5556),
    (-9808, 1951),
];

/// `MulDiv` as GDI has it (seg1 `41b0`): the product over the divisor, to
/// the nearest, a half away from nought, held to a word.
pub fn mul_div(a: i32, b: i32, c: i32) -> i32 {
    let negative = ((a < 0) != (b < 0)) != (c < 0);
    let (a, b, c) = (i64::from(a).abs(), i64::from(b).abs(), i64::from(c).abs());
    let value = (a * b + (c >> 1)) / c;

    if value > 0x7fff {
        return if negative { -0x7fff } else { 0x7fff };
    }

    if negative {
        -value as i32
    } else {
        value as i32
    }
}

/// The pen as sixteen points, for a pen `width` by `height` device pixels
/// (seg21 `0f90`).
pub fn pen_points(width: i32, height: i32) -> [Point; 16] {
    let w = width.max(1);
    let h = height.max(1);

    if w > 5 {
        let mut pen = ROUND.map(|(x, y)| (mul_div(x, w, 20000), mul_div(y, h, 20000)));

        pen[0].0 = pen[7].0 - w;
        pen[15].0 = pen[7].0 - w;
        pen[3].1 = pen[12].1 - h;
        pen[4].1 = pen[12].1 - h;

        return pen;
    }

    let right = mul_div(10000, w, 20000);
    let bottom = mul_div(10000, h, 20000);
    let left = right - w;
    let top = bottom - h;
    let mut pen = [(0, 0); 16];

    for (at, point) in pen.iter_mut().enumerate() {
        *point = match at / 4 {
            0 => (left, top),
            1 => (right, top),
            2 => (right, bottom),
            _ => (left, bottom),
        };
    }

    pen
}

/// Which of sixteen ways a step goes (seg21 `0d48`).
fn way(dx: i32, dy: i32) -> usize {
    let mut sector = 7;
    let mut across = dx;
    let mut down = dy;

    if across < 0 {
        sector ^= 0xf;
        across = -across;
    }

    if down < 0 {
        sector ^= 7;
        down = -down;
    }

    if down < across {
        sector ^= 3;
        std::mem::swap(&mut down, &mut across);
    }

    if down >> 1 < across {
        sector ^= 1;
    }

    sector
}

/// The outline of a polyline drawn with the pen, as one polygon (seg21
/// `0cb6`).
pub fn wide_outline(points: &[Point], pen: &[Point; 16]) -> Vec<Point> {
    let mut front: Vec<Point> = Vec::new();
    let mut back: Vec<Point> = Vec::new();
    let mut into: Option<usize> = None;

    for (index, &(x, y)) in points.iter().enumerate() {
        let at = |k: usize| (x + pen[k & 0xf].0, y + pen[k & 0xf].1);
        let mut from = into;
        let out;

        if index == points.len() - 1 {
            // With no way in -- a single point -- the way in is -1, as GDI
            // keeps it, and the way out is that turned round, 7.
            out = (from.map_or(-1, |from| from as i32) + 8) as usize & 0xf;
        } else {
            let (nx, ny) = points[index + 1];

            out = way(nx - x, ny - y);

            if from.is_none() {
                from = Some((out + 8) & 0xf);
            }
        }

        // A single point's way in, -1, as `from` is used below: its pen
        // points are taken modulo sixteen.
        let from = from.map_or(-1, |from| from as i32);
        let turn = ((out as i32 - from + 16) & 0xf) as usize;
        let k = |offset: i32| (from + offset).rem_euclid(16) as usize;

        if turn <= 8 {
            for step in 0..=turn {
                front.push(at(k(step as i32)));
            }

            back.push(at(k(8)));

            if from != out as i32 {
                back.push(at(out + 8));
            }
        } else {
            front.push(at(k(0)));
            front.push(at(out));

            for step in 0..=(16 - turn) {
                back.push(at(k(8 - step as i32)));
            }
        }

        into = Some(out);
    }

    // The sides as one, the last point off, as GDI answers it (`0ce3`).
    back.reverse();
    front.extend(back);
    front.pop();
    front
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_narrow_pen_is_a_square_about_its_point() {
        let pen = pen_points(3, 3);

        assert_eq!(pen[0], (-1, -1));
        assert_eq!(pen[8], (2, 2));
    }

    #[test]
    fn mul_div_rounds_a_half_away_from_nought() {
        assert_eq!(mul_div(10000, 3, 20000), 2);
        assert_eq!(mul_div(-10000, 3, 20000), -2);
        assert_eq!(mul_div(1, 1, 3), 0);
    }

    #[test]
    fn a_level_line_is_a_band_its_pen_high() {
        let outline = wide_outline(&[(0, 0), (10, 0)], &pen_points(3, 3));
        let spans = crate::polygon::polygon_spans(&outline, true);

        assert_eq!(spans.first().map(|span| span.0), Some(-1));
        assert_eq!(spans.last().map(|span| span.0), Some(1));
    }
}
