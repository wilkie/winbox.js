//! A region of pixels as GDI keeps one, as winbox.js's `clip-region.ts`
//! keeps it: bands of rows, each a set of runs of columns, with bands that
//! are alike joined. It has one rectangle, and is `SIMPLEREGION`, only when
//! that is all it is, however it was made.

use std::collections::{BTreeMap, BTreeSet};

/// A rectangle, the right and bottom edges outside it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Box {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// One band of rows, and the runs of columns in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Band {
    pub top: i32,
    pub bottom: i32,
    pub spans: Vec<(i32, i32)>,
}

/// A region: immutable, every operation making a new one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClipRegion {
    pub bands: Vec<Band>,
}

/// Whether two bands are the same runs, the one ending where the other
/// starts: then they are one.
fn joins(previous: Option<&Band>, top: i32, spans: &[(i32, i32)]) -> bool {
    previous.is_some_and(|previous| previous.bottom == top && previous.spans == spans)
}

impl ClipRegion {
    pub const EMPTY: Self = Self { bands: Vec::new() };

    /// A rectangle's region; empty unless `left < right` and `top < bottom`.
    pub fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        if left < right && top < bottom {
            Self {
                bands: vec![Band {
                    top,
                    bottom,
                    spans: vec![(left, right)],
                }],
            }
        } else {
            Self::EMPTY
        }
    }

    /// A region of rows of pixels, each `(y, left, right)`: a shape's, as
    /// its fill walks it. Runs on a row that meet or overlap are one run.
    pub fn from_spans(spans: &[(i32, i32, i32)]) -> Self {
        let mut rows: BTreeMap<i32, Vec<(i32, i32)>> = BTreeMap::new();

        for &(y, left, right) in spans {
            if left < right {
                rows.entry(y).or_default().push((left, right));
            }
        }

        let mut bands: Vec<Band> = Vec::new();

        for (y, mut runs) in rows {
            runs.sort_by_key(|run| run.0);

            let mut merged: Vec<(i32, i32)> = Vec::new();

            for (left, right) in runs {
                match merged.last_mut() {
                    Some(last) if left <= last.1 => last.1 = last.1.max(right),
                    _ => merged.push((left, right)),
                }
            }

            if joins(bands.last(), y, &merged) {
                bands.last_mut().expect("a band").bottom = y + 1;
            } else {
                bands.push(Band {
                    top: y,
                    bottom: y + 1,
                    spans: merged,
                });
            }
        }

        Self { bands }
    }

    /// The pixels of two regions `keep` says to keep, as a region.
    pub fn combine(a: &Self, b: &Self, keep: impl Fn(bool, bool) -> bool) -> Self {
        let mut rows = BTreeSet::new();
        let mut columns = BTreeSet::new();

        for band in a.bands.iter().chain(&b.bands) {
            rows.insert(band.top);
            rows.insert(band.bottom);

            for &(left, right) in &band.spans {
                columns.insert(left);
                columns.insert(right);
            }
        }

        let ys: Vec<i32> = rows.into_iter().collect();
        let xs: Vec<i32> = columns.into_iter().collect();
        let mut bands: Vec<Band> = Vec::new();

        for pair in ys.windows(2) {
            let (top, bottom) = (pair[0], pair[1]);
            let mut spans: Vec<(i32, i32)> = Vec::new();

            for edge in xs.windows(2) {
                if !keep(a.contains(edge[0], top), b.contains(edge[0], top)) {
                    continue;
                }

                match spans.last_mut() {
                    Some(last) if last.1 == edge[0] => last.1 = edge[1],
                    _ => spans.push((edge[0], edge[1])),
                }
            }

            if spans.is_empty() {
                continue;
            }

            if joins(bands.last(), top, &spans) {
                bands.last_mut().expect("a band").bottom = bottom;
            } else {
                bands.push(Band { top, bottom, spans });
            }
        }

        Self { bands }
    }

    #[must_use]
    pub fn union(&self, other: &Self) -> Self {
        Self::combine(self, other, |a, b| a || b)
    }

    #[must_use]
    pub fn intersect(&self, other: &Self) -> Self {
        Self::combine(self, other, |a, b| a && b)
    }

    #[must_use]
    pub fn subtract(&self, other: &Self) -> Self {
        Self::combine(self, other, |a, b| a && !b)
    }

    #[must_use]
    pub fn offset(&self, dx: i32, dy: i32) -> Self {
        Self {
            bands: self
                .bands
                .iter()
                .map(|band| Band {
                    top: band.top + dy,
                    bottom: band.bottom + dy,
                    spans: band
                        .spans
                        .iter()
                        .map(|&(left, right)| (left + dx, right + dx))
                        .collect(),
                })
                .collect(),
        }
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        for band in &self.bands {
            if y < band.top {
                return false;
            }

            if y < band.bottom {
                return band
                    .spans
                    .iter()
                    .any(|&(left, right)| x >= left && x < right);
            }
        }

        false
    }

    /// `NULLREGION` (1), `SIMPLEREGION` (2) or `COMPLEXREGION` (3).
    pub fn kind(&self) -> u16 {
        match self.bands.as_slice() {
            [] => 1,
            [band] if band.spans.len() == 1 => 2,
            _ => 3,
        }
    }

    /// The smallest rectangle around it; all nought when it is empty.
    pub fn bounds(&self) -> Box {
        let (Some(first), Some(last)) = (self.bands.first(), self.bands.last()) else {
            return Box::default();
        };

        Box {
            left: self
                .bands
                .iter()
                .map(|band| band.spans[0].0)
                .min()
                .unwrap_or(0),
            top: first.top,
            right: self
                .bands
                .iter()
                .map(|band| band.spans[band.spans.len() - 1].1)
                .max()
                .unwrap_or(0),
            bottom: last.bottom,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_parts_apart_are_a_complex_region_round_their_box() {
        let region = ClipRegion::rect(0, 0, 10, 10).union(&ClipRegion::rect(20, 0, 30, 10));

        assert_eq!(region.kind(), 3);
        assert!(!region.contains(15, 5));
        assert_eq!(
            region.bounds(),
            Box {
                left: 0,
                top: 0,
                right: 30,
                bottom: 10
            }
        );
    }

    #[test]
    fn a_rectangle_however_made_is_simple() {
        let region = ClipRegion::rect(0, 0, 10, 10).union(&ClipRegion::rect(10, 0, 20, 10));

        assert_eq!(region.kind(), 2);
        assert_eq!(ClipRegion::rect(5, 5, 5, 9).kind(), 1);
        assert_eq!(
            ClipRegion::rect(0, 0, 20, 20)
                .subtract(&ClipRegion::rect(0, 0, 20, 10))
                .bounds(),
            Box {
                left: 0,
                top: 10,
                right: 20,
                bottom: 20
            }
        );
    }
}
