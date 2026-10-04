//! The scan converter's own edge walk.
//!
//! Where an exact solve asks "where does this outline cross row *n*", this
//! asks the question the other way round -- "which cells does this edge pass
//! through" -- and answers it the way the scan converter does, by stepping a
//! cross product one scanline or one column at a time and writing down the
//! cell it is standing in. The two agree for a straight edge on all but
//! ties; for a curve they do not, and the pixels this lands on are the ones
//! Windows draws.
//!
//! Everything is in sixty-fourths of a pixel and the y axis points **up**,
//! which is the frame the scan converter works in.
//!
//! The lists are four: a crossing goes in the `on` list when its edge travels
//! up and the `off` list when it travels down, and correspondingly left or
//! right for the vertical pair. `BeginElement` decides that from the
//! quadrant, which is settled once per edge before the walk begins.
//!
//! The document's conic walk, `CalcSpline`, is not here: nothing draws with
//! it (see `evaluate_spline`), and the TypeScript engine keeps it only for a
//! test of its transcription.

use std::collections::HashMap;

const SUB: i64 = 64;
const SHIFT: i64 = 6;
const HALF: i64 = 32;

/// The next sample position at or above `p`, on the sub-pixel grid.
fn above(p: i64) -> i64 {
    ((p + HALF) & -SUB) + HALF
}

/// The next sample position strictly below `p`.
fn below(p: i64) -> i64 {
    ((p - HALF - 1) & -SUB) + HALF
}

/// One list of crossings, keyed by scanline or column, in the order each key
/// was first written -- which is the order the fill reads them in.
#[derive(Debug, Clone, Default)]
pub struct Crossings {
    keys: Vec<i64>,
    lists: HashMap<i64, Vec<i64>>,
}

impl Crossings {
    fn put(&mut self, key: i64, value: i64) {
        self.lists
            .entry(key)
            .or_insert_with(|| {
                self.keys.push(key);
                Vec::new()
            })
            .push(value);
    }

    /// One key's crossings.
    pub fn get(&self, key: i64) -> Option<&Vec<i64>> {
        self.lists.get(&key)
    }

    pub(crate) fn get_mut(&mut self, key: i64) -> Option<&mut Vec<i64>> {
        self.lists.get_mut(&key)
    }

    /// Every key and its crossings, in the order the keys were first written.
    pub fn iter(&self) -> impl Iterator<Item = (i64, &Vec<i64>)> {
        self.keys.iter().map(|key| (*key, &self.lists[key]))
    }

    /// Each list in ascending order.
    pub(crate) fn sort(&mut self) {
        for list in self.lists.values_mut() {
            list.sort_unstable();
        }
    }
}

/// The four lists, and the columns a vertex on a sample line and column at
/// once charged an entry against.
#[derive(Debug, Clone, Default)]
pub struct Lists {
    pub crowded: Vec<i64>,
    pub horiz_on: Crossings,
    pub horiz_off: Crossings,
    pub vert_on: Crossings,
    pub vert_off: Crossings,
}

impl Lists {
    pub fn new() -> Self {
        Self::default()
    }

    /// Where one edge's emissions go, as `BeginElement` picks from the
    /// quadrant: up the `on` lists, down the `off` ones.
    fn add_horiz(&mut self, quadrant: i64, x: i64, y: i64) {
        if quadrant == 1 || quadrant == 2 {
            self.horiz_on.put(y, x);
        } else {
            self.horiz_off.put(y, x);
        }
    }

    fn add_vert(&mut self, quadrant: i64, x: i64, y: i64) {
        if quadrant == 2 || quadrant == 3 {
            self.vert_on.put(x, y);
        } else {
            self.vert_off.put(x, y);
        }
    }
}

/// The crossings a vertex contributes, when it lies exactly on a scanline.
///
/// A walk starts at `ScanAbove(y1)`, which for a point already on a
/// scanline is the *next* one -- so an edge beginning on a sample line never
/// records it, and two edges meeting there record nothing between them.
/// `CheckHorizTopology` supplies what is missing: one crossing where the
/// outline passes through, two where it turns back, none where it runs along
/// the line.
#[derive(Debug, Clone, Default)]
pub struct Endpoints {
    x0: Option<i64>,
    y0: i64,
    x1: i64,
    y1: i64,
    second_x: i64,
    second_y: i64,
    started: bool,
}

/// How the outline turns at a vertex, as the binary decides it.
struct Turn {
    quadrant: i64,
    cross: bool,
    flat: bool,
    upright: bool,
}

fn on_scanline(p: i64) -> bool {
    p.rem_euclid(SUB) == HALF
}

impl Endpoints {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin(&mut self, x: i64, y: i64) {
        self.x1 = x;
        self.y1 = y;
        self.x0 = None;
        self.started = false;
    }

    fn add_horiz_on(&self, lists: &mut Lists) {
        lists
            .horiz_on
            .put(self.y1 >> SHIFT, (self.x1 + HALF - 1) >> SHIFT);
    }

    fn add_horiz_off(&self, lists: &mut Lists) {
        lists
            .horiz_off
            .put(self.y1 >> SHIFT, (self.x1 + HALF) >> SHIFT);
    }

    fn add_vert_on(&self, lists: &mut Lists) {
        lists
            .vert_on
            .put(self.x1 >> SHIFT, (self.y1 + HALF - 1) >> SHIFT);
    }

    fn add_vert_off(&self, lists: &mut Lists) {
        lists
            .vert_off
            .put(self.x1 >> SHIFT, (self.y1 + HALF) >> SHIFT);
    }

    /// Which way the outline turns at a vertex, as `seg42:1342` classifies
    /// it: by the **sign of the cross product** of the direction in with the
    /// direction out, and by the outgoing quadrant -- right and up, left and
    /// up, left and down, right and down.
    fn turn(&self, x0: i64, x: i64, y: i64) -> Turn {
        let out_x = x - self.x1;
        let out_y = y - self.y1;
        let quadrant = if out_x > 0 && out_y >= 0 {
            1
        } else if out_x <= 0 && out_y > 0 {
            2
        } else if out_x < 0 && out_y <= 0 {
            4
        } else {
            8
        };

        Turn {
            quadrant,
            cross: (self.x1 - x0) * out_y - (self.y1 - self.y0) * out_x < 0,
            flat: out_y == 0 && self.y0 == self.y1,
            upright: out_x == 0 && x0 == self.x1,
        }
    }

    fn horiz_topology(&self, lists: &mut Lists, x0: i64, x: i64, y: i64) {
        let Turn {
            quadrant,
            cross,
            flat,
            upright,
        } = self.turn(x0, x, y);
        let up = quadrant & 0x3 != 0;
        let down = quadrant & 0xc != 0;

        if (cross || upright)
            && (if up {
                self.y0 > self.y1
            } else {
                self.y0 < self.y1
            })
        {
            self.add_horiz_on(lists);
            self.add_horiz_off(lists);

            return;
        }

        if up {
            if cross {
                self.add_horiz_on(lists);

                return;
            }

            if flat && quadrant & 0x1 != 0 && x0 > self.x1 {
                self.add_horiz_on(lists);

                return;
            }
        }

        if self.y0 < self.y1 && self.y1 < y {
            self.add_horiz_on(lists);

            return;
        }

        if down {
            if cross {
                self.add_horiz_off(lists);

                return;
            }

            if flat && quadrant & 0x4 != 0 && x0 < self.x1 {
                self.add_horiz_off(lists);

                return;
            }
        }

        if self.y0 > self.y1 && self.y1 > y {
            self.add_horiz_off(lists);
        }
    }

    fn vert_topology(&self, lists: &mut Lists, x0: i64, x: i64, y: i64) {
        let Turn {
            quadrant,
            cross,
            flat,
            upright,
        } = self.turn(x0, x, y);
        let right = quadrant & 0x9 != 0;
        let left = quadrant & 0x6 != 0;

        if (cross || flat) && (if right { x0 > self.x1 } else { x0 < self.x1 }) {
            self.add_vert_on(lists);
            self.add_vert_off(lists);

            return;
        }

        if left {
            if cross {
                self.add_vert_on(lists);

                return;
            }

            if flat && quadrant & 0x2 != 0 && self.y0 > self.y1 {
                self.add_vert_on(lists);

                return;
            }
        }

        if x0 > self.x1 && self.x1 > x {
            self.add_vert_on(lists);

            return;
        }

        if right {
            if cross {
                self.add_vert_off(lists);

                return;
            }

            if upright && quadrant & 0x8 != 0 && self.y1 > self.y0 {
                self.add_vert_off(lists);

                return;
            }
        }

        if x0 < self.x1 && self.x1 < x {
            self.add_vert_off(lists);
        }
    }

    /// The vertex the walk is standing on, with the point after it.
    ///
    /// A vertex on a sample line and a sample column at once is kept for the
    /// fill to charge against its column's block -- only where the outline
    /// leaves it going up, which is **measured** on three corpora at once and
    /// against the other three one-bit gates the quadrant offers.
    ///
    /// A step that goes nowhere leaves the running vertex alone, as
    /// `EvaluateEndPoint` returns before it shifts.
    pub fn check(&mut self, lists: &mut Lists, x: i64, y: i64, dropout: bool) {
        if on_scanline(self.y1)
            && on_scanline(self.x1)
            && !(self.x1 == x && self.y1 == y)
            && let Some(x0) = self.x0
        {
            let turn = self.turn(x0, x, y);

            if !turn.cross && turn.quadrant & 0x3 != 0 {
                let column = self.x1 >> SHIFT;

                if !lists.crowded.contains(&column) {
                    lists.crowded.push(column);
                }
            }
        }

        if on_scanline(self.y1) {
            if self.x1 == x && self.y1 == y {
                return;
            }

            match self.x0 {
                None => {
                    self.second_x = x;
                    self.second_y = y;
                    self.started = true;
                }
                Some(x0) => self.horiz_topology(lists, x0, x, y),
            }
        }

        // And the vertical pass only exists when dropout control asked for it.
        if dropout && on_scanline(self.x1) {
            if self.x1 == x && self.y1 == y {
                return;
            }

            match self.x0 {
                None => {
                    self.second_x = x;
                    self.second_y = y;
                    self.started = true;
                }
                Some(x0) => self.vert_topology(lists, x0, x, y),
            }
        }

        self.x0 = Some(self.x1);
        self.y0 = self.y1;
        self.x1 = x;
        self.y1 = y;
    }

    /// Closing the contour: the running vertex is the first one again, and
    /// the point that came after it, put aside then, is used now.
    pub fn end(&mut self, lists: &mut Lists) {
        if !self.started {
            return;
        }

        let Some(x0) = self.x0 else {
            return;
        };

        if on_scanline(self.y1) {
            self.horiz_topology(lists, x0, self.second_x, self.second_y);
        }

        if on_scanline(self.x1) {
            self.vert_topology(lists, x0, self.second_x, self.second_y);
        }
    }
}

/// A straight edge, walked as `CalcLine` walks it. With dropout control off
/// there is no sweep down the columns to feed, and `CalcLine`'s own branch
/// for that emits nothing but horizontal entries.
#[allow(clippy::similar_names)]
pub fn calc_line(lists: &mut Lists, x1: i64, y1: i64, x2: i64, y2: i64, dropout: bool) {
    let (
        mut quadrant,
        mut q,
        mut y,
        mut y_steps,
        y_increment,
        y_offset,
        terminal_y,
        initial_y_step,
    );

    if y2 >= y1 {
        quadrant = 1;
        q = 0;
        let initial = above(y1);
        initial_y_step = initial - y1;
        y = initial >> SHIFT;
        y_steps = (below(y2) >> SHIFT) - y + 1;
        y_increment = 1;
        y_offset = 0;
        terminal_y = y2 - y1;
    } else {
        quadrant = 4;
        q = 1;
        let initial = below(y1);
        initial_y_step = y1 - initial;
        y = initial >> SHIFT;
        y_steps = y - (above(y2) >> SHIFT) + 1;
        y_increment = -1;
        y_offset = 1;
        terminal_y = y1 - y2;
    }

    if y2 == y1 {
        y = (if x2 < x1 { above(y1 - 1) } else { above(y1) }) >> SHIFT;
        y_steps = 0;
    }

    let (mut x, mut x_steps, x_increment, x_offset, terminal_x, initial_x_step);

    if x2 >= x1 {
        let initial = above(x1);
        initial_x_step = initial - x1;
        x = initial >> SHIFT;
        x_steps = (below(x2) >> SHIFT) - x + 1;
        x_increment = 1;
        x_offset = 0;
        terminal_x = x2 - x1;
    } else {
        q = 1 - q;
        quadrant += y_increment;
        let initial = below(x1);
        initial_x_step = x1 - initial;
        x = initial >> SHIFT;
        x_steps = x - (above(x2) >> SHIFT) + 1;
        x_increment = -1;
        x_offset = 1;
        terminal_x = x1 - x2;
    }

    if x2 == x1 {
        x = (if y2 > y1 { above(x1 - 1) } else { above(x1) }) >> SHIFT;
        x_steps = 0;
    }

    if y1 == y2 {
        for _ in 0..x_steps {
            if dropout {
                lists.add_vert(quadrant, x, y);
            }

            x += x_increment;
        }

        return;
    }

    if x1 == x2 {
        for _ in 0..y_steps {
            lists.add_horiz(quadrant, x, y);
            y += y_increment;
        }

        return;
    }

    q += terminal_x * initial_y_step - terminal_y * initial_x_step;

    let d_q_y_step = terminal_x << SHIFT;
    let d_q_x_step = -terminal_y << SHIFT;

    for _ in 0..(x_steps + y_steps) {
        if q > 0 {
            if dropout {
                lists.add_vert(quadrant, x, y + y_offset);
            }

            x += x_increment;
            q += d_q_x_step;
        } else {
            lists.add_horiz(quadrant, x + x_offset, y);
            y += y_increment;
            q += d_q_y_step;
        }
    }
}

/// A quadratic, cut into chords the way GDI.EXE cuts one.
///
/// The scan converter has one element walk and it is a line. What draws a
/// curve is segment 44 at 0x42: it takes the curve's second difference,
/// picks a depth from how large that is -- an octagonal norm, divided by
/// four until under 0x80 -- steps the curve at that many equal parameter
/// steps, and hands each chord to the line walker, its endpoint checked as
/// an element's. Past five it halves the curve and recurses, the halves
/// rounding: `(p1 + p2 + 1) >> 1` and `(p1 + 2p2 + p3 + 2) >> 2`.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_spline(
    lists: &mut Lists,
    ends: &mut Endpoints,
    points: [i64; 6],
    dropout: bool,
    given: i64,
) {
    let [x1, y1, x2, y2, x3, y3] = points;
    let second_x = x1 - 2 * x2 + x3;
    let second_y = y1 - 2 * y2 + y3;
    let mut depth = given;

    if depth < 0 {
        let span_x = second_x.abs();
        let span_y = second_y.abs();
        let mut size = if span_y >= span_x {
            span_x + 2 * span_y
        } else {
            2 * span_x + span_y
        };

        depth = 1;

        while size > 0x80 {
            depth += 1;
            size >>= 2;
        }

        depth = depth.min(8);
    }

    if depth > 5 {
        let near_x = (x1 + x2 + 1) >> 1;
        let near_y = (y1 + y2 + 1) >> 1;
        let mid_x = (x1 + 2 * x2 + x3 + 2) >> 2;
        let mid_y = (y1 + 2 * y2 + y3 + 2) >> 2;
        let far_x = (x2 + x3 + 1) >> 1;
        let far_y = (y2 + y3 + 1) >> 1;

        evaluate_spline(
            lists,
            ends,
            [x1, y1, near_x, near_y, mid_x, mid_y],
            dropout,
            depth - 1,
        );
        evaluate_spline(
            lists,
            ends,
            [mid_x, mid_y, far_x, far_y, x3, y3],
            dropout,
            depth - 1,
        );

        return;
    }

    let steps = 1 << depth;
    let shift = depth * 2;
    let half = 1 << (shift - 1);

    // The accumulator carries the point scaled by the square of the step
    // count.
    let mut step_x = second_x - ((x1 - x2) << (depth + 1));
    let mut step_y = second_y - ((y1 - y2) << (depth + 1));
    let grow_x = second_x * 2;
    let grow_y = second_y * 2;

    let mut at_x = x1 << shift;
    let mut at_y = y1 << shift;
    let mut from_x = x1;
    let mut from_y = y1;

    for _ in 0..steps {
        at_x += step_x;
        step_x += grow_x;
        at_y += step_y;
        step_y += grow_y;

        let to_x = (at_x + half) >> shift;
        let to_y = (at_y + half) >> shift;

        // Each chord is an element in its own right, endpoint and all.
        ends.check(lists, to_x, to_y, dropout);
        calc_line(lists, from_x, from_y, to_x, to_y, dropout);

        from_x = to_x;
        from_y = to_y;
    }
}
