//! A line as a display driver draws one a pixel wide, as winbox.js's
//! `BitmapContext.stroke` walks it: the pixel nearest the true line at each
//! step along the longer axis, a tie broken by the driver's rule, and --
//! where the driver leaves clipping to GDI -- GDI's own walk where the line
//! leaves the surface.
//!
//! **Recorded**, by drawing 740 lines on each of four displays: seven rings
//! around the middle of a cell, and eight fans from its corner where a line
//! has room for a longer span. Every pixel of all 2,960 is the pixel nearest
//! the true line, on every driver, without exception. So the only thing a
//! driver decides is the tie.
//!
//! Three of the four displays -- VGA, Super VGA, EGA -- are identical record
//! for record, and their rule is one sentence: **a tie goes to the smaller
//! y**, upward on the screen, whichever way the line runs and whichever
//! axis is the long one. The Hercules driver differs in 192 of the 740. Its
//! rule is not a direction at all but the slope, in lowest terms: for a line
//! whose span and rise reduce to `m/M`, a tie rises when `2m > M` and falls
//! when `2m < M`, and the two end slopes `1/M` and `(M-1)/M` are each the
//! other way about. That predicts all 740 records on the Hercules and all
//! 740 on each of the other three, so it is measured rather than read --
//! though why the two end slopes turn over is not known. And a tie does not
//! depend on where the line begins, only on its slope: 236 slopes across
//! four origins, on a VGA and on a Hercules.
//!
//! A line also does not draw the pixel it stops on -- GDI's rule for
//! `LineTo` and `Polyline` -- which callers ask for with `exclude_last`.

/// How a display driver breaks a tie between two pixels equally near a
/// line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tie {
    /// The VGA's, the Super VGA's and the EGA's: to the smaller y.
    #[default]
    Top,
    /// The Hercules's: by the slope in lowest terms.
    Slope,
}

impl Tie {
    /// The rule a display mode names, `slope` or else `top`.
    pub fn named(name: Option<&str>) -> Self {
        if name == Some("slope") {
            Self::Slope
        } else {
            Self::Top
        }
    }

    /// Whether a tie rises, for a line of major span `steps` and minor span
    /// `minor`, under this rule.
    pub fn rises(self, steps: i32, minor: i32) -> bool {
        if self != Self::Slope {
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
}

/// What a line is drawn on, and how.
#[derive(Debug, Clone, Copy)]
pub struct Walk {
    /// The surface's size, whose edges a line that the driver does not clip
    /// is clipped at by GDI.
    pub width: i32,
    pub height: i32,
    /// Whether the driver clips a line for itself: `CLIPCAPS`, which is
    /// `CP_RECTANGLE` on the three colour drivers and nought on the
    /// Hercules.
    pub clips: bool,
    pub tie: Tie,
    /// Whether the last point of the path is left undrawn, as `LineTo`
    /// leaves it.
    pub exclude_last: bool,
    /// Whether the path reaches the driver as one polyline rather than as
    /// one `LineTo` after another: a stroke glyph's run.
    pub polyline: bool,
}

impl Walk {
    /// The pixels of a path drawn as one-pixel lines, in the order walked,
    /// each with its step from the start of its own segment.
    ///
    /// Every segment draws its pixels from the start up to but not
    /// including the end -- `LineTo`'s rule, for every `LineTo` in the chain
    /// and not only the last. The endpoint of one segment is the start of
    /// the next, which draws it if it goes anywhere; a segment that goes
    /// nowhere draws nothing, and then the shared point is never drawn at
    /// all. A caller that wants the final point drawn as well --
    /// `exclude_last` off -- gets it from the last segment alone.
    pub fn pixels(&self, path: &[(i32, i32)]) -> Vec<(i32, i32, i32)> {
        let mut out = Vec::new();

        // Whether GDI has to take the whole path from the driver: a polyline
        // with any point negative. A coordinate past the right-hand edge or
        // below the bottom is one the driver can be handed and told to stop
        // at; a negative one is not. **Measured** on the two glyph sweeps on
        // a Hercules.
        let negative = self.polyline && path.iter().any(|&(x, y)| x < 0 || y < 0);
        let within = |x: i32, y: i32| x >= 0 && y >= 0 && x < self.width && y < self.height;

        for index in 1..path.len() {
            let (from_x, from_y) = path[index - 1];
            let (to_x, to_y) = path[index];
            let dx = to_x - from_x;
            let dy = to_y - from_y;
            let across_x = dx.abs() >= dy.abs();
            let steps = if across_x { dx.abs() } else { dy.abs() };
            let last = index == path.len() - 1;
            let mut stop = if last && !self.exclude_last {
                steps + 1
            } else {
                steps
            };

            // A segment from a point to itself draws nothing: the plotter
            // faces' periods are loops of coincident points, and Windows
            // draws nothing at all there.
            if steps == 0 {
                continue;
            }

            let major = if (if across_x { dx } else { dy }) > 0 {
                1
            } else {
                -1
            };
            let minor = if across_x { dy } else { dx };
            let rises = self.tie.rises(steps, minor.abs());
            let mut up = i32::from(
                !(if across_x {
                    rises
                } else {
                    rises == (dx * dy > 0)
                }),
            );
            let mut entry = -1;

            // A segment that stops on the edge of a run that carries on past
            // it: part of what GDI clips, its crossing at this segment's far
            // end. **Measured** on the Hercules, 55 segments of the two glyph
            // sweeps.
            let after = path.get(index + 1);
            let towards = if (if across_x { dx } else { dy }) > 0 {
                1
            } else {
                -1
            };
            let ending = if across_x { to_x } else { to_y };
            let reach = if across_x { self.width } else { self.height };
            let brink = ending == (if towards > 0 { reach - 1 } else { 0 })
                && after.is_some_and(|&(x, y)| !within(x, y));

            // A line that leaves the surface is not the driver's to draw,
            // where the driver does not clip: GDI's walk takes a tie the
            // other way, draws the pixel the line stops on when that is on
            // the edge it runs at, and rounds the step it enters on away from
            // its start. **Recorded**: 858 clipped lines on each display,
            // 2,478 records each, exact on all four.
            if !self.clips && (negative || brink || !(within(from_x, from_y) && within(to_x, to_y)))
            {
                up = i32::from(!(if across_x { true } else { dx * dy > 0 }));

                let start = if across_x { from_x } else { from_y };
                let edge = if across_x { to_x } else { to_y };
                let limit = if across_x { self.width } else { self.height };

                if minor != 0 && edge == (if major > 0 { limit - 1 } else { 0 }) {
                    stop = steps + 1;
                } else if minor != 0 {
                    // The same again on the minor axis, for a line running
                    // up: **measured**, 81 clipped lines of the sweep stop
                    // on their minor edge, two running up. Why up and not
                    // down is not read.
                    let other = if across_x { to_y } else { to_x };
                    let span = if across_x { self.height } else { self.width };
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
                    i32::from(minor <= 0)
                } else {
                    up
                };
                let offset = (2 * minor * step + steps - rounding).div_euclid(2 * steps);
                let (x, y) = if across_x {
                    (from_x + major * step, from_y + offset)
                } else {
                    (from_x + offset, from_y + major * step)
                };

                out.push((x, y, step));
            }
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn walk(tie: Tie, clips: bool) -> Walk {
        Walk {
            width: 32,
            height: 32,
            clips,
            tie,
            exclude_last: true,
            polyline: false,
        }
    }

    #[test]
    fn leaves_out_the_pixel_it_stops_on() {
        let pixels = walk(Tie::Top, true).pixels(&[(0, 0), (3, 0)]);

        assert_eq!(pixels, vec![(0, 0, 0), (1, 0, 1), (2, 0, 2)]);
    }

    #[test]
    fn breaks_a_tie_towards_the_top_on_the_vga() {
        // A slope of a half: the second pixel is a tie.
        let pixels = walk(Tie::Top, true).pixels(&[(0, 0), (4, 2)]);

        assert_eq!(pixels, vec![(0, 0, 0), (1, 0, 1), (2, 1, 2), (3, 1, 3)]);
    }

    #[test]
    fn the_hercules_takes_a_tie_by_its_slope() {
        assert!(Tie::Slope.rises(4, 2));
        assert!(Tie::Slope.rises(3, 1));
        assert!(!Tie::Slope.rises(5, 2));
        assert!(!Tie::Top.rises(3, 1));
    }

    #[test]
    fn a_segment_of_no_length_draws_nothing() {
        assert!(walk(Tie::Top, true).pixels(&[(5, 5), (5, 5)]).is_empty());
    }
}
