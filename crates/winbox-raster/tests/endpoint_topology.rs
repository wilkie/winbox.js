//! The endpoint topology decision, as `GDI.EXE` actually branches it.
//!
//! `CheckHorizTopology` in the pseudocode decides what a point sitting
//! exactly on a scanline contributes, from three comparisons. The shipped
//! code decides the same thing from precomputed flags instead: a quadrant, a
//! cross product of the incoming edge against the outgoing one, and two
//! degeneracy bits. The two are not the same function, and this pins down
//! exactly how they differ, so that a later change to either can be told
//! from a change to both.
//!
//! The transcription is from segment 42 at 0x1390 through 0x1445 (**read
//! out**, reached by the recursive descent in `scripts/oracle/descend.mjs`).
//! It is kept here rather than in `src` because the implementation
//! (`scan_walk.rs`, `Endpoints::horiz_topology`) follows the pseudocode: the
//! two are indistinguishable on every fixture recorded so far, and the reason
//! they are is the property this file asserts.

use std::collections::BTreeMap;

const ON: &str = "on";
const OFF: &str = "off";
const BOTH: &str = "on+off";
const NONE: &str = "";

/// `CheckHorizTopology`, as the pseudocode states it.
fn stated(x0: i32, y0: i32, x1: i32, y1: i32, x2: i32, y2: i32) -> &'static str {
    if y2 > y1 {
        if y1 > y0 {
            return ON;
        }
        if y1 < y0 {
            return BOTH;
        }
        return if x1 < x0 { ON } else { NONE };
    }
    if y2 < y1 {
        if y1 > y0 {
            return BOTH;
        }
        if y1 < y0 {
            return OFF;
        }
        return if x1 > x0 { OFF } else { NONE };
    }
    if y1 > y0 {
        return if x2 > x1 { ON } else { NONE };
    }
    if y1 < y0 {
        return if x2 < x1 { OFF } else { NONE };
    }
    if x1 > x0 && x2 < x1 {
        return OFF;
    }
    if x1 < x0 && x2 > x1 {
        return ON;
    }
    NONE
}

/// The same decision as `GDI.EXE` segment 42 branches it, at 0x1390.
fn compiled(x0: i32, y0: i32, x1: i32, y1: i32, x2: i32, y2: i32) -> &'static str {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let quadrant = if dx > 0 && dy >= 0 {
        1
    } else if dx <= 0 && dy > 0 {
        2
    } else if dx < 0 && dy <= 0 {
        3
    } else {
        4
    };
    let cross = (x1 - x0) * dy - (y1 - y0) * dx < 0;
    let flat_x = dx == 0 && x0 == x1;
    let flat_y = dy == 0 && y0 == y1;

    if (cross || flat_x) && (if quadrant <= 2 { y0 > y1 } else { y0 < y1 }) {
        return BOTH;
    }
    if quadrant <= 2 {
        if cross {
            return ON;
        }
        if flat_y && quadrant == 1 && x0 > x1 {
            return ON;
        }
    }
    if y0 < y1 && y1 < y2 {
        return ON;
    }
    if quadrant >= 3 {
        if cross {
            return OFF;
        }
        if flat_y && quadrant == 3 && x0 < x1 {
            return OFF;
        }
    }
    if y0 > y1 && y1 > y2 {
        return OFF;
    }
    NONE
}

#[test]
fn disagrees_with_the_pseudocode_and_only_ever_about_a_coincident_pair() {
    let range = -2..=2;
    let mut kinds: BTreeMap<String, usize> = BTreeMap::new();

    for x0 in range.clone() {
        for y0 in range.clone() {
            for x1 in range.clone() {
                for y1 in range.clone() {
                    for x2 in range.clone() {
                        for y2 in range.clone() {
                            let a = stated(x0, y0, x1, y1, x2, y2);
                            let b = compiled(x0, y0, x1, y1, x2, y2);

                            if a != b {
                                let name = |kind: &str| {
                                    if kind.is_empty() {
                                        "-".to_string()
                                    } else {
                                        kind.to_string()
                                    }
                                };

                                *kinds
                                    .entry(format!("{} -> {}", name(a), name(b)))
                                    .or_default() += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // Both directions occur, so neither tree is a strict weakening of the
    // other.
    assert_eq!(
        kinds.keys().collect::<Vec<_>>(),
        ["- -> on+off", "on+off -> -"]
    );
}

/// Every disagreement is an `on` and an `off` together against neither. The
/// two go into different lists at `(x + 31) >> 6` and `(x + 32) >> 6`, which
/// name the same column unless x is itself on a scanline -- so the pair spans
/// no pixel, and adding it is the same as adding nothing.
#[test]
fn cannot_change_a_bitmap_unless_the_point_is_a_pixel_centre_in_both_axes() {
    let on = |x: i32| (x + 31) >> 6;
    let off = |x: i32| (x + 32) >> 6;

    for x in -4096_i32..=4096 {
        if x.rem_euclid(64) == 32 {
            assert_eq!(off(x), on(x) + 1, "{x}");
        } else {
            assert_eq!(off(x), on(x), "{x}");
        }
    }
}
