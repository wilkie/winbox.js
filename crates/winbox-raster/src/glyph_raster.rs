//! Turning an outline into pixels, the way the scan converter does.
//!
//! A TrueType contour is a closed loop of points, each either on the curve
//! or a control point for the quadratic joining its neighbours; two control
//! points in a row imply an on-curve point between them. This walks each
//! edge the way `CalcLine` does -- a curve cut into chords as GDI cuts it
//! (`scan_walk`) -- fills the runs the walk pairs up, and rescues dropouts
//! as simple dropout control does, stubs excepted where the font asks.
//!
//! The TypeScript engine keeps a second method beside this, which computes
//! where the outline crosses each scanline exactly, for comparison; it draws
//! with it only where a developer sets `WB_ANALYTIC` in Node, and it is not
//! here.

// Deliberately: numbers compared and converted as a JavaScript engine's
// are, since every rule here was measured through one.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use crate::js;
use crate::scan_walk::{Endpoints, Lists, calc_line, evaluate_spline};
use crate::truetype::{Contour, Point};

/// Where two consecutive control points meet.
pub type Between<'a> = &'a dyn Fn(&Point, &Point) -> [f64; 2];

/// One piece of a contour: a line, or a quadratic with its control point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Piece {
    pub from: [f64; 2],
    pub control: Option<[f64; 2]>,
    pub to: [f64; 2],
}

/// Splits a contour into the pieces it is actually made of: a contour that
/// begins on a control point begins halfway to its last point -- or at the
/// last point, if that one is on the curve -- and two controls in a row meet
/// at the point `between` makes of them, their midpoint where it is not
/// given.
pub fn segments_of(contour: &[Point], between: Option<Between>) -> Vec<Piece> {
    if contour.is_empty() {
        return Vec::new();
    }

    let mut points: Vec<Point> = contour.to_vec();

    if !points[0].on {
        let last = points[points.len() - 1];
        let start = if last.on {
            last
        } else {
            Point {
                x: points[0].x.midpoint(last.x),
                y: points[0].y.midpoint(last.y),
                on: true,
            }
        };

        points.insert(0, start);
    }

    let mut pieces = Vec::new();
    let mut at = [points[0].x, points[0].y];
    let mut control: Option<Point> = None;

    for index in 1..=points.len() {
        let point = points[index % points.len()];

        if point.on {
            let to = [point.x, point.y];

            pieces.push(Piece {
                from: at,
                control: control.map(|control| [control.x, control.y]),
                to,
            });
            at = to;
            control = None;

            continue;
        }

        if let Some(previous) = control {
            let to = match between {
                Some(between) => between(&previous, &point),
                None => [previous.x.midpoint(point.x), previous.y.midpoint(point.y)],
            };

            pieces.push(Piece {
                from: at,
                control: Some([previous.x, previous.y]),
                to,
            });
            at = to;
        }

        control = Some(point);
    }

    if let Some(previous) = control {
        pieces.push(Piece {
            from: at,
            control: Some([previous.x, previous.y]),
            to: [points[0].x, points[0].y],
        });
    }

    pieces
}

/// How a glyph is filled: the scale from its coordinates to pixels, where
/// its origin lands on the bitmap, the bitmap's size, and what the font
/// asked of dropout control.
#[derive(Debug, Clone, Copy, PartialEq)]
#[allow(clippy::struct_excessive_bools)]
pub struct FillOptions {
    pub scale: f64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub width: i64,
    pub height: i64,
    pub dropout: bool,
    pub stubs: bool,
    /// The lean of a slant Windows synthesises, which the box is built from
    /// with its two roundings apart.
    pub lean: f64,
    /// The vertical and horizontal sizes, which the dropout cap asks.
    pub ppem: f64,
    pub across: f64,
}

impl Default for FillOptions {
    fn default() -> Self {
        Self {
            scale: 1.0,
            origin_x: 0.0,
            origin_y: 0.0,
            width: 0,
            height: 0,
            dropout: false,
            stubs: true,
            lean: 0.0,
            ppem: 0.0,
            across: 0.0,
        }
    }
}

/// A glyph filled: one byte a pixel of the whole bitmap, non-zero where
/// inked, and the box the scan converter was set up with, which emboldening
/// and `GetGlyphOutline` want.
#[derive(Debug, Clone, PartialEq)]
pub struct Filled {
    pub pixels: Vec<u8>,
    pub left: f64,
    pub right: f64,
}

/// A run the walk paired: its row, and its `on` and `off` columns.
#[derive(Debug, Clone, Copy)]
struct Run {
    row: i64,
    on: i64,
    off: i64,
}

/// Fills a set of contours into a bitmap from the scan converter's own edge
/// walk.
///
/// The coordinates are rounded to sixty-fourths with a half going upward:
/// **measured** across every recording, Times New Roman's `y` at twelve
/// pixels drawn exactly this way. Two consecutive controls meet at the
/// midpoint of their *scaled* coordinates, halved `(a + b + 1) >> 1` --
/// **recorded**, the last two cells of the glyph corpus.
#[allow(clippy::too_many_lines)]
pub fn fill_walked(contours: &[Contour], options: FillOptions) -> Filled {
    let FillOptions {
        scale,
        origin_x,
        origin_y,
        width,
        height,
        dropout,
        stubs,
        lean,
        ppem,
        across,
    } = options;

    let size = (width.max(0) * height.max(0)) as usize;
    let mut pixels = vec![0u8; size];

    let sixty_fourth = |value: f64| js::round(value * scale * 64.0);
    let place = |point: [f64; 2]| {
        [
            origin_x + sixty_fourth(point[0]) / 64.0,
            origin_y - sixty_fourth(point[1]) / 64.0,
        ]
    };
    let half = |at: f64, to: f64| {
        js::sar(
            js::round(at * scale * 64.0) + js::round(to * scale * 64.0) + 1.0,
            1.0,
        ) / (scale * 64.0)
    };
    let between = |one: &Point, two: &Point| [half(one.x, two.x), half(one.y, two.y)];

    let mut lists = Lists::new();
    // A coordinate enters the walk as `ToInt32` makes one, not-a-number as
    // nought. A deliberate difference: the TypeScript engine hands its walk
    // the number itself, whose comparisons then find it unordered before its
    // shifts make nought of it. Only a point a program named past the end of
    // its zone is not-a-number, and the walk here is integers throughout.
    let sub = |value: f64| i64::from(js::int32(js::round(value * 64.0)));
    let mut ends = Endpoints::new();

    for contour in contours {
        let made = segments_of(contour, Some(&between));

        let Some(first) = made.first() else {
            continue;
        };

        let first = place(first.from);

        ends.begin(sub(first[0]), -sub(first[1]));

        for piece in &made {
            let from = place(piece.from);
            let to = place(piece.to);

            if let Some(control) = piece.control {
                // The turns cut out before walking, which is what
                // `EvaluateSpline` exists for.
                let control = place(control);

                evaluate_spline(
                    &mut lists,
                    &mut ends,
                    [
                        sub(from[0]),
                        -sub(from[1]),
                        sub(control[0]),
                        -sub(control[1]),
                        sub(to[0]),
                        -sub(to[1]),
                    ],
                    dropout,
                    -1,
                );

                continue;
            }

            calc_line(
                &mut lists,
                sub(from[0]),
                -sub(from[1]),
                sub(to[0]),
                -sub(to[1]),
                dropout,
            );
            ends.check(&mut lists, sub(to[0]), -sub(to[1]), dropout);
        }

        ends.end(&mut lists);
    }

    lists.horiz_on.sort();
    lists.horiz_off.sort();
    lists.vert_on.sort();
    lists.vert_off.sort();

    // A column whose block is full loses its last `on` entry: the two lists
    // of a column share one block, sized by `seg42:0f2a` from the changes of
    // direction in `x` of the glyph's own points, rounded up to even and at
    // least two, and neither adder checks a bound. **Measured**: the
    // fabricated corpus 32,394 of 32,394 cells with the charge. See
    // `FONTS.md` section 8a.
    if !lists.crowded.is_empty() {
        let mut turns = 0i64;

        for contour in contours {
            if contour.len() < 2 {
                continue;
            }

            let at = |index: usize| place([contour[index].x, contour[index].y])[0];
            let mut rising = at(contour.len() - 1) <= at(0);

            for index in 0..contour.len() {
                let step = at(index) - at((index + contour.len() - 1) % contour.len());

                if step > 0.0 && !rising {
                    turns += 1;
                    rising = true;
                } else if step < 0.0 && rising {
                    turns += 1;
                    rising = false;
                }
            }
        }

        let held = (turns + (turns & 1)).max(2);

        for column in lists.crowded.clone() {
            let off = lists.vert_off.get(column).map(Vec::len);

            if let (Some(off), Some(on)) = (off, lists.vert_on.get_mut(column))
                && on.len() + off >= held as usize
            {
                on.pop();
            }
        }
    }

    // The runs, paired by index as `Blit` pairs them.
    let mut runs = Vec::new();

    for (walk_row, ons) in lists.horiz_on.iter() {
        let offs = lists.horiz_off.get(walk_row).cloned().unwrap_or_default();
        let row = -walk_row - 1;

        for (on, off) in ons.iter().zip(&offs) {
            runs.push(Run {
                row,
                on: *on,
                off: *off,
            });
        }
    }

    // The box comes from the outline, not from the runs. A slanted glyph's
    // keeps its two roundings apart, the shear taken back off with a half
    // going down: **measured**, `symbol-slant` on an EGA 352 of 352.
    let mut leftmost = f64::INFINITY;
    let mut rightmost = f64::NEG_INFINITY;
    let mut highest = f64::INFINITY;
    let mut lowest = f64::NEG_INFINITY;

    for contour in contours {
        for piece in segments_of(contour, Some(&between)) {
            for point in [Some(piece.from), Some(piece.to), piece.control]
                .into_iter()
                .flatten()
            {
                let at = place(point);
                let unsheared = |value: f64| (value * scale * 64.0 - 0.5).ceil();
                let across = if lean == 0.0 {
                    at[0]
                } else {
                    origin_x
                        + (unsheared(point[0] - lean * point[1])
                            + js::round(lean * point[1] * scale * 64.0))
                            / 64.0
                };

                leftmost = js::min(leftmost, across);
                rightmost = js::max(rightmost, across);
                highest = js::min(highest, at[1]);
                lowest = js::max(lowest, at[1]);
            }
        }
    }

    let box_left = (leftmost - 0.5).ceil();
    let box_top = (highest - 0.5).ceil();

    // The box may collapse in y and not in x: `DoVertDropout` refuses a
    // rescue outside the band, `DoHorizDropout` clamps into the box.
    let wanted = (rightmost + 0.5).floor();
    let box_right = js::max(box_left + 1.0, wanted);
    let narrow = wanted <= box_left;
    let box_bottom = (lowest + 0.5).floor();

    let inside = |column: i64, row: i64| column >= 0 && column < width && row >= 0 && row < height;
    let at = |index: i64| (index >= 0 && (index as usize) < size).then_some(index as usize);

    let mut rescues = Vec::new();

    for run in &runs {
        if run.on == run.off {
            if dropout {
                rescues.push(*run);
            }

            continue;
        }

        // Either way round, as `Blit` fills.
        for column in run.on.min(run.off)..run.on.max(run.off) {
            if inside(column, run.row) {
                pixels[(run.row * width + column) as usize] = 1;
            }
        }
    }

    // How much of the outline continues past a dropout candidate: a
    // presence test, at most one from each list. **Read** out of `seg42:0db4`.
    let count_horiz = |lists: &Lists, x: i64, row: i64| {
        i64::from(
            lists
                .horiz_on
                .get(-row - 1)
                .is_some_and(|list| list.contains(&x)),
        ) + i64::from(
            lists
                .horiz_off
                .get(-row - 1)
                .is_some_and(|list| list.contains(&x)),
        )
    };
    let count_vert = |lists: &Lists, x: i64, row: i64| {
        i64::from(
            lists
                .vert_on
                .get(x)
                .is_some_and(|list| list.iter().any(|&at| -at == row)),
        ) + i64::from(
            lists
                .vert_off
                .get(x)
                .is_some_and(|list| list.iter().any(|&at| -at == row)),
        )
    };

    // Down the rows from the top of the band, a rescue made on one row seen
    // by the next.
    rescues.sort_by_key(|rescue| rescue.row);

    for rescue in &rescues {
        let on = rescue.on;
        let continues = |step: i64| {
            let at = if step < 0 { rescue.row } else { rescue.row + 1 };

            count_horiz(&lists, on, rescue.row + step)
                + count_vert(&lists, on - 1, at)
                + count_vert(&lists, on, at)
                >= 2
        };

        // Above forty-eight pixels per em a run like this is not rescued --
        // on a square pixel. **Recorded**, `dropsize` on a VGA and an EGA.
        #[allow(clippy::float_cmp)]
        if !narrow && ppem >= 48.0 && across == ppem {
            continue;
        }

        // A glyph narrower than the gap between two sample columns is not
        // asked whether anything continues from it. **Recorded** by
        // `cour-stubs`; the mechanism is not yet located.
        if !narrow && stubs && (!continues(-1) || !continues(1)) {
            continue;
        }

        // The neighbour asked before the run is moved left, and only clear of
        // the box's edge, as `DoHorizDropout` guards it.
        if (on as f64) < box_right
            && on >= 0
            && on < width
            && at(rescue.row * width + on).is_some_and(|index| pixels[index] != 0)
        {
            continue;
        }

        // Always to the left, which is what **simple** dropout control does.
        let mut column = (on - 1) as f64;

        if column < box_left {
            column = box_left;
        }

        if column >= box_right {
            column = box_right - 1.0;
        }

        let column = column as i64;

        if inside(column, rescue.row) {
            pixels[(rescue.row * width + column) as usize] = 1;
        }
    }

    if !dropout {
        return Filled {
            pixels,
            left: box_left,
            right: box_right,
        };
    }

    // And the same down each column, read in the order the entries are held.
    // **Recorded**: two hairlines a row apart, 264 cells.
    let columns: Vec<(i64, Vec<i64>)> = lists
        .vert_on
        .iter()
        .map(|(column, ons)| (column, ons.clone()))
        .collect();

    for (column, ons) in columns {
        let offs = lists.vert_off.get(column).cloned().unwrap_or_default();

        for (on, off) in ons.iter().zip(&offs) {
            if on != off {
                continue;
            }

            let row = -on;
            let continues = |step: i64| {
                let near = if step < 0 { column } else { column + 1 };

                count_vert(&lists, column + step, row)
                    + count_horiz(&lists, near, row)
                    + count_horiz(&lists, near, row - 1)
                    >= 2
            };

            if stubs && (!continues(-1) || !continues(1)) {
                continue;
            }

            // A dropout outside the band is dropped, not brought inside it.
            let row_f = row as f64;

            if row_f < box_top || row_f > box_bottom {
                continue;
            }

            let mut placed = row_f;

            if placed < box_top {
                placed = box_top;
            }

            if placed >= box_bottom {
                placed = box_bottom - 1.0;
            }

            // The neighbour only asked where the rescue sits inside the box.
            #[allow(clippy::float_cmp)]
            if row_f == placed
                && placed > 0.0
                && at((placed as i64 - 1) * width + column).is_some_and(|index| pixels[index] != 0)
            {
                continue;
            }

            if !(placed >= box_top && placed < box_bottom) {
                continue;
            }

            let placed = placed as i64;

            if inside(column, placed) {
                pixels[(placed * width + column) as usize] = 1;
            }
        }
    }

    // A glyph narrower than a sample column is drawn as one run per column,
    // from the top of the box down, clipped to the bitmap. **Recorded** by
    // `cour-gaps` and `cour-boxes`, 258 of 258.
    if narrow {
        let first = js::max(0.0, box_left);
        let last = js::min(width as f64, box_right);
        let mut column = first;

        while column < last {
            let x = column as i64;
            let lit = (0..height).any(|row| pixels[(row * width + x) as usize] != 0);

            if lit {
                let top = js::max(0.0, box_top) as i64;
                let bottom = js::min((height - 1) as f64, box_bottom - 1.0) as i64;

                for row in top..=bottom {
                    pixels[(row * width + x) as usize] = 1;
                }
            }

            column += 1.0;
        }
    }

    Filled {
        pixels,
        left: box_left,
        right: box_right,
    }
}

#[cfg(test)]
mod tests;
