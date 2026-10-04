//! The rows GDI fills for a polygon, for a display driver that takes only
//! scanlines.
//!
//! **Read out of `GDI.EXE`.** A VGA reports `POLYGONALCAPS` 8, scanlines
//! alone, so `Polygon` never reaches the driver: at `seg24:06e3` GDI finds
//! the driver cannot take it and converts it itself at `0bcb`. Every edge
//! that is not horizontal runs from its upper point down to, but not
//! including, its lower one; `030e` sets it up as a Bresenham with its major
//! axis the longer of the two, an error term `2 * minor - major + bias`, and
//! a bias of one except for an edge whose major axis is `y` and which steps
//! left, which gets nothing. Each row, the active edges' `x` are sorted and
//! handed to the driver in pairs, each pair half-open; then each edge steps
//! -- one pixel at most for a `y`-major edge, while its error is positive,
//! and for an `x`-major one at least one pixel and on while the error stays
//! at or below nought.
//!
//! **Recorded** by `polyfill`, 117 quadrilaterals under both fill modes -- a
//! rectangle turned every five degrees, bands two and three pixels thick,
//! and the corners of every turned ground `rotstyle` drew: 234 of 234 exact.

/// A row of a fill: its `y`, and the columns from `left` up to `right`.
pub type Span = (i32, i32, i32);

/// One edge, walked down the rows.
struct Edge {
    /// Which way it runs, for the winding rule: down is one way.
    direction: i32,
    x: i32,
    top: i32,
    bottom: i32,
    step: i32,
    y_major: bool,
    error: i32,
    up: i32,
    down: i32,
}

/// The rows GDI fills for a polygon, top to bottom: a row crossed by more
/// than two edges gives a span for each pair.
pub fn polygon_spans(points: &[(i32, i32)], winding: bool) -> Vec<Span> {
    rings_spans(&[points.to_vec()], winding, true)
}

/// The spans of several polygons filled together, as `PolyPolygon` fills
/// them: every ring's edges counted at once, under the one rule. `closed`
/// false leaves out each ring's edge from its last point back to its first,
/// as Windows 3.1's `PolyPolygon` does (`gdidraw`).
pub fn rings_spans(rings: &[Vec<(i32, i32)>], winding: bool, closed: bool) -> Vec<Span> {
    let mut edges = Vec::new();
    let mut spans = Vec::new();

    for points in rings {
        let count = if closed {
            points.len()
        } else {
            points.len().saturating_sub(1)
        };

        for index in 0..count {
            let a = points[index];
            let b = points[(index + 1) % points.len()];

            if a.1 == b.1 {
                continue;
            }

            let (upper, lower) = if a.1 < b.1 { (a, b) } else { (b, a) };
            let dx = lower.0 - upper.0;
            let dy = lower.1 - upper.1;
            let y_major = dx.abs() <= dy;
            let (major, minor) = if y_major {
                (dy, dx.abs())
            } else {
                (dx.abs(), dy)
            };
            let bias = if y_major { i32::from(dx >= 0) } else { 1 };

            edges.push(Edge {
                direction: if a.1 < b.1 { 1 } else { -1 },
                x: upper.0,
                top: upper.1,
                bottom: lower.1,
                step: dx.signum(),
                y_major,
                error: 2 * minor - major + bias,
                up: 2 * minor,
                down: 2 * minor - 2 * major,
            });
        }
    }

    let (Some(top), Some(bottom)) = (
        edges.iter().map(|edge| edge.top).min(),
        edges.iter().map(|edge| edge.bottom).max(),
    ) else {
        return spans;
    };

    for y in top..bottom {
        // The edges crossing the row, by their x; those level in x in the
        // order they were made, as a stable sort leaves them.
        let mut crossing: Vec<(i32, i32)> = edges
            .iter()
            .filter(|edge| y >= edge.top && y < edge.bottom)
            .map(|edge| (edge.x, edge.direction))
            .collect();

        crossing.sort_by_key(|&(x, _)| x);

        if winding {
            // Inside between two crossings where the edges crossed so far do
            // not cancel out: for rings left open (`PolyPolygon`), that is up
            // to the last crossing, whatever the count there (`gdidraw`).
            let mut count = 0;

            for index in 0..crossing.len() {
                count += crossing[index].1;

                if let Some(next) = crossing.get(index + 1)
                    && count != 0
                    && crossing[index].0 < next.0
                {
                    spans.push((y, crossing[index].0, next.0));
                }
            }
        } else {
            for pair in crossing.chunks_exact(2) {
                if pair[0].0 < pair[1].0 {
                    spans.push((y, pair[0].0, pair[1].0));
                }
            }
        }

        for edge in &mut edges {
            if y < edge.top || y >= edge.bottom || edge.step == 0 {
                continue;
            }

            if edge.y_major {
                if edge.error > 0 {
                    edge.x += edge.step;
                    edge.error += edge.down;
                } else {
                    edge.error += edge.up;
                }
            } else {
                edge.error += edge.down;
                edge.x += edge.step;

                while edge.error <= 0 {
                    edge.x += edge.step;
                    edge.error += edge.up;
                }
            }
        }
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_a_rectangle_but_its_right_and_bottom() {
        let spans = polygon_spans(&[(1, 1), (4, 1), (4, 3), (1, 3)], false);

        assert_eq!(spans, vec![(1, 1, 4), (2, 1, 4)]);
    }

    #[test]
    fn winding_fills_a_stars_middle_and_alternate_leaves_it() {
        let star = [(10, 0), (16, 19), (0, 7), (20, 7), (4, 19)];
        let inside = |spans: &[Span], x: i32, y: i32| {
            spans
                .iter()
                .any(|&(row, left, right)| row == y && x >= left && x < right)
        };

        assert!(inside(&polygon_spans(&star, true), 10, 10));
        assert!(!inside(&polygon_spans(&star, false), 10, 10));
    }
}
