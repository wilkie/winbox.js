//! One-pixel lines as the display drivers walk them, and as GDI walks them
//! for a driver that cannot clip: the walk the TypeScript engine's
//! `BitmapContext.stroke` makes, which the plotter fonts' strokes are drawn
//! with.
//!
//! Not Bresenham's error term but the value it approximates, worked out per
//! step in integers: the minor coordinate at step `k` of `n` is
//! `minor * k / n`, rounded. Which is the same line until it lands exactly
//! between two pixels, and a driver has a rule for that which an error term
//! does not express.
//!
//! **Recorded**, by drawing 740 lines on each of four displays: every pixel
//! of all 2,960 is the pixel nearest the true line, on every driver, without
//! exception. So the only thing a driver decides is the tie. The VGA, the
//! Super VGA and the EGA send **a tie to the smaller y**. The Hercules
//! driver's rule is the slope in lowest terms: for a line whose span and
//! rise reduce to `m/M`, a tie rises when `2m > M` and falls when `2m < M`,
//! and the two end slopes `1/M` and `(M-1)/M` are each the other way about
//! -- measured rather than read, and why the end slopes turn over is not
//! known.

use crate::indexed_context::IndexedContext;

/// How a display driver takes a tie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineTie {
    /// The VGA's, the Super VGA's and the EGA's: to the smaller y.
    #[default]
    Top,
    /// The Hercules driver's: by the slope.
    Slope,
}

/// How a path is walked: the driver's tie; whether the driver clips for
/// itself (`CLIPCAPS`, `CP_RECTANGLE` on the colour drivers, nought on the
/// Hercules); whether the pixel the path stops on is left out, `LineTo`'s
/// rule; and whether the path reaches the driver as one polyline, as a
/// plotter glyph's run does, rather than one `LineTo` after another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Walk {
    pub tie: LineTie,
    pub clips: bool,
    pub exclude_last: bool,
    pub polyline: bool,
}

/// Whether a tie rises, for a line of major span `steps` and minor span
/// `minor`, under a driver's rule.
pub fn tie_rises(tie: LineTie, steps: i64, minor: i64) -> bool {
    if tie != LineTie::Slope {
        return false;
    }

    let (mut a, mut b) = (steps, minor);

    while b != 0 {
        (a, b) = (b, a % b);
    }

    let span = steps / a;
    let rise = minor / a;

    (2 * rise > span) != (rise == 1 || rise == span - 1)
}

/// `a / b` rounded down.
fn floor_div(a: i64, b: i64) -> i64 {
    let quotient = a / b;

    if (a % b != 0) && ((a < 0) != (b < 0)) {
        quotient - 1
    } else {
        quotient
    }
}

/// The path's lines drawn in `colour` through the context, each segment
/// from its start up to but not including its end -- `LineTo`'s rule, for
/// every segment of the chain and not only the last. A segment from a point
/// to itself draws nothing: the plotter faces' periods are tiny closed
/// loops whose every point rounds to one pixel, and Windows draws nothing
/// there. A caller that wants the final point drawn as well gets it from
/// the last segment alone.
///
/// A line that leaves the pixels is not the driver's to draw where the
/// driver cannot clip: GDI clips it, and GDI's walk is not the driver's.
/// Its tie turns over -- to the *larger* y -- and the pixel the line stops
/// on is drawn when that pixel is on the edge the line runs at (the major
/// coordinate's), or, for a line running up, on the minor coordinate's
/// edge; and the step the line enters on, where the major coordinate starts
/// outside, rounds a half away from the start. **Recorded** by the `lines`
/// sweep, 2,478 records exact on each of four displays.
///
/// For a polyline, the whole path is GDI's when any point of it is
/// negative, and a segment that stops on the edge of a run carrying on past
/// it is GDI's too: **measured** against the two glyph sweeps on a
/// Hercules, where `Script`'s `j` and its `g` and `y` at thirty-four pixels
/// found them.
pub fn stroke(context: &mut IndexedContext, path: &[(i32, i32)], colour: [u8; 4], walk: Walk) {
    let (width, height) = (i64::from(context.width), i64::from(context.height));
    let negative = walk.polyline && path.iter().any(|&(x, y)| x < 0 || y < 0);
    let within = |x: i64, y: i64| x >= 0 && y >= 0 && x < width && y < height;

    for index in 1..path.len() {
        let (from_x, from_y) = (i64::from(path[index - 1].0), i64::from(path[index - 1].1));
        let (to_x, to_y) = (i64::from(path[index].0), i64::from(path[index].1));
        let (dx, dy) = (to_x - from_x, to_y - from_y);
        let across_x = dx.abs() >= dy.abs();
        let steps = if across_x { dx.abs() } else { dy.abs() };
        let last = index == path.len() - 1;
        let mut stop = if last && !walk.exclude_last {
            steps + 1
        } else {
            steps
        };

        if steps == 0 {
            continue;
        }

        let major = if across_x { dx.signum() } else { dy.signum() };
        let major = if major > 0 { 1 } else { -1 };
        let minor = if across_x { dy } else { dx };
        let rises = tie_rises(walk.tie, steps, minor.abs());
        let takes_tie = if across_x {
            rises
        } else {
            rises == (dx * dy > 0)
        };
        let mut up = i64::from(!takes_tie);
        let mut entry = -1;

        let after = path.get(index + 1);
        let stop_at = if across_x { to_x } else { to_y };
        let reach = if across_x { width } else { height };
        let brink = stop_at == (if major > 0 { reach - 1 } else { 0 })
            && after.is_some_and(|&(x, y)| !within(i64::from(x), i64::from(y)));

        if !walk.clips && (negative || brink || !(within(from_x, from_y) && within(to_x, to_y))) {
            up = i64::from(!(across_x || dx * dy > 0));

            let start = if across_x { from_x } else { from_y };
            let edge = if across_x { to_x } else { to_y };
            let limit = if across_x { width } else { height };

            if minor != 0 && edge == (if major > 0 { limit - 1 } else { 0 }) {
                stop = steps + 1;
            } else if minor != 0 {
                let other = if across_x { to_y } else { to_x };
                let span = if across_x { height } else { width };
                let rising = if across_x { minor < 0 } else { major < 0 };

                if rising && other == (if minor > 0 { span - 1 } else { 0 }) {
                    stop = steps + 1;
                }
            }

            if major > 0 && start < 0 {
                entry = -start;
            } else if major < 0 && start > limit - 1 {
                entry = start - (limit - 1);
            }
        }

        for step in 0..stop {
            let rounding = if step == entry {
                i64::from(minor <= 0)
            } else {
                up
            };
            let offset = floor_div(2 * minor * step + steps - rounding, 2 * steps);
            let (x, y) = if across_x {
                (from_x + major * step, from_y + offset)
            } else {
                (from_x + offset, from_y + major * step)
            };

            context.set_pixel(x as i32, y as i32, colour);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;
    use crate::DevicePalette;

    fn mono(width: i32, height: i32) -> IndexedContext {
        IndexedContext::new(
            width,
            height,
            Rc::new(RefCell::new(vec![1; (width * height) as usize])),
            Rc::new(RefCell::new(DevicePalette::mono())),
        )
    }

    fn inked(context: &IndexedContext) -> Vec<(i32, i32)> {
        let indices = context.indices.borrow();

        (0..context.height)
            .flat_map(|y| (0..context.width).map(move |x| (x, y)))
            .filter(|&(x, y)| indices[(y * context.width + x) as usize] == 0)
            .collect()
    }

    const BLACK: [u8; 4] = [0, 0, 0, 0xff];

    #[test]
    fn a_tie_goes_up_on_the_vga_and_by_the_slope_on_the_hercules() {
        let walk = Walk {
            tie: LineTie::Top,
            clips: true,
            exclude_last: true,
            polyline: false,
        };
        let mut vga = mono(8, 8);

        // Four across and one down: the tie at the second step.
        stroke(&mut vga, &[(0, 0), (4, 1)], BLACK, walk);
        assert_eq!(inked(&vga), vec![(0, 0), (1, 0), (2, 0), (3, 1)]);

        let mut hercules = mono(8, 8);

        stroke(
            &mut hercules,
            &[(0, 0), (4, 1)],
            BLACK,
            Walk {
                tie: LineTie::Slope,
                ..walk
            },
        );
        // A slope of a quarter is an end slope, and turns over: it rises.
        assert!(tie_rises(LineTie::Slope, 4, 1));
        assert_eq!(inked(&hercules), vec![(0, 0), (1, 0), (2, 1), (3, 1)]);
    }

    #[test]
    fn a_segment_of_no_length_draws_nothing_and_the_last_point_is_asked_for() {
        let walk = Walk {
            tie: LineTie::Top,
            clips: true,
            exclude_last: false,
            polyline: true,
        };
        let mut context = mono(8, 8);

        stroke(&mut context, &[(2, 2), (2, 2)], BLACK, walk);
        assert!(inked(&context).is_empty());

        stroke(&mut context, &[(1, 1), (1, 3)], BLACK, walk);
        assert_eq!(inked(&context), vec![(1, 1), (1, 2), (1, 3)]);
    }

    #[test]
    fn gdi_draws_the_stop_on_the_edge_for_a_driver_that_cannot_clip() {
        let walk = Walk {
            tie: LineTie::Slope,
            clips: false,
            exclude_last: true,
            polyline: false,
        };
        let mut context = mono(4, 4);

        // From outside, to the last column: the stop is drawn.
        stroke(&mut context, &[(-2, 0), (3, 2)], BLACK, walk);
        assert!(inked(&context).contains(&(3, 2)));
    }
}
