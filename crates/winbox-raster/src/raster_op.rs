//! Raster operations: how `BitBlt` and `PatBlt` combine the brush, a source
//! and the destination, and how a drawing mode, `SetROP2`'s, does the same
//! for a pen.
//!
//! A raster operation's code carries its own truth table: bit `k` of the
//! byte in its high word is the result for brush bit `k >> 2`, source bit
//! `(k >> 1) & 1` and destination bit `k & 1`. So all 256 operations are
//! read from their codes, and none is listed. It applies bit by bit to the
//! pixels' palette indices, not to red, green and blue. Recorded by the
//! `bitblt` probe: all fifteen named operations between monochrome bitmaps,
//! under a black brush and a white one; and on a sixteen-colour display,
//! red `SRCAND` blue is light grey, which is index arithmetic and not
//! colour.
//!
//! Where the two sides differ in depth, a pixel is carried across as
//! `bitblt` recorded: a monochrome source's white bits become the
//! destination's background colour and its black bits the text colour, and
//! a colour source becomes white exactly where it is the source's
//! background colour.

use crate::colour_match::{DisplayKind, matched_index};
use crate::{Color, DevicePalette};

/// The truth table in a raster operation's code.
pub fn table_of(rop: u32) -> u8 {
    (rop >> 16) as u8
}

/// Whether an operation reads the source.
pub fn uses_source(table: u8) -> bool {
    (table >> 2) & 0x33 != table & 0x33
}

/// Whether an operation reads the destination.
pub fn uses_destination(table: u8) -> bool {
    (table >> 1) & 0x55 != table & 0x55
}

/// One result, `mask` wide, from pattern, source and destination values.
pub fn combine(table: u8, p: u32, s: u32, d: u32, mask: u32) -> u32 {
    let mut out = 0;

    for k in 0..8 {
        if table & (1 << k) != 0 {
            out |= (if k & 4 != 0 { p } else { !p })
                & (if k & 2 != 0 { s } else { !s })
                & (if k & 1 != 0 { d } else { !d });
        }
    }

    out & mask
}

/// The results of a table for every pattern, source and destination value
/// of a depth, worked out once where the depth is small enough to have
/// them all, and otherwise each time.
#[derive(Debug, Clone)]
pub struct Combiner {
    table: u8,
    mask: u32,
    size: usize,
    cells: Option<Vec<u8>>,
}

impl Combiner {
    pub fn new(table: u8, depth: u8) -> Self {
        // A shift of a word, by as many places as a 32-bit shift takes.
        let mask = 1u32.wrapping_shl(u32::from(depth)).wrapping_sub(1);
        let size = 1usize << depth.min(4);
        let cells = (depth <= 4).then(|| {
            let mut cells = Vec::with_capacity(size * size * size);

            for p in 0..size as u32 {
                for s in 0..size as u32 {
                    for d in 0..size as u32 {
                        cells.push(combine(table, p, s, d, mask) as u8);
                    }
                }
            }

            cells
        });

        Self {
            table,
            mask,
            size,
            cells,
        }
    }

    pub fn result(&self, p: u32, s: u32, d: u32) -> u32 {
        match &self.cells {
            Some(cells) => {
                let at = (p as usize * self.size + s as usize) * self.size + d as usize;

                // Past the table is nothing, as a typed array's read past
                // its end is undefined, stored as 0.
                cells.get(at).copied().map_or(0, u32::from)
            }
            None => combine(self.table, p, s, d, self.mask),
        }
    }
}

/// A drawing mode as the raster operation a `PatBlt` would carry out, the
/// pen or brush standing for the pattern.
///
/// The mode's value less one is its table: bit `2p + d` is the result for a
/// pen bit `p` over a pixel bit `d`, so `R2_COPYPEN`, 13, is `1100` and
/// `R2_NOT`, 6, is `0101`. A raster operation's table has a bit for every
/// pattern, source and destination bit, `4p + 2s + d`, and this one ignores
/// the source.
pub fn rop_of_mode(mode: i32) -> u32 {
    let two = mode.wrapping_sub(1) & 15;
    let mut table = 0u32;

    for bit in 0..8 {
        if two & (1 << (((bit >> 2) & 1) * 2 + (bit & 1))) != 0 {
            table |= 1 << bit;
        }
    }

    table << 16
}

/// A colour of one bitmap's palette as an index of another's. Onto the
/// 256-colour display's, the nearest static colour, as its driver matches
/// any colour: a WinG bitmap's colour table, blitted to the screen with no
/// palette realized, comes out so (`wingapi`); or where a palette is
/// realized there, its nearest entry's slot (`paldib`). Onto any other, the
/// nearest of its colours.
pub fn across(
    display: DisplayKind,
    palette: &mut DevicePalette,
    red: u8,
    green: u8,
    blue: u8,
    realized: Option<&dyn Fn(u8, u8, u8) -> usize>,
) -> usize {
    if let Some(realized) = realized
        && palette.size() == 256
    {
        return realized(red, green, blue);
    }

    if palette.size() == 256 {
        matched_index(display, palette, red, green, blue)
    } else {
        palette.index(red, green, blue)
    }
}

/// A colour as the index of a palette the display's driver draws it as: a
/// colour that names its slot is that slot on a 256-colour palette. No
/// colour is index 0. See `matched_index`.
pub fn index_of_colour(
    display: DisplayKind,
    palette: &mut DevicePalette,
    colour: Option<&Color>,
) -> usize {
    match colour {
        Some(Color {
            slot: Some(slot), ..
        }) if palette.size() == 256 => *slot,
        Some(colour) => matched_index(
            display,
            palette,
            colour.red(),
            colour.green(),
            colour.blue(),
        ),
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRCCOPY: u32 = 0x00cc_0020;
    const SRCAND: u32 = 0x0088_00c6;
    const PATINVERT: u32 = 0x005a_0049;
    const DSTINVERT: u32 = 0x0055_0009;

    #[test]
    fn reads_what_an_operation_uses_from_its_table() {
        assert!(uses_source(table_of(SRCCOPY)) && !uses_destination(table_of(SRCCOPY)));
        assert!(!uses_source(table_of(PATINVERT)) && uses_destination(table_of(PATINVERT)));
        assert!(!uses_source(table_of(DSTINVERT)));
        assert_eq!(combine(table_of(DSTINVERT), 0, 0, 0b0101, 0xf), 0b1010);
    }

    #[test]
    fn a_drawing_mode_is_an_operation_without_a_source() {
        // R2_COPYPEN is PATCOPY, R2_NOT is DSTINVERT, R2_XORPEN PATINVERT.
        assert_eq!(rop_of_mode(13), 0x00f0_0000);
        assert_eq!(rop_of_mode(6), 0x0055_0000);
        assert_eq!(rop_of_mode(7), 0x005a_0000);
        assert_eq!(rop_of_mode(1), 0);
        assert_eq!(rop_of_mode(16), 0x00ff_0000);
    }

    #[test]
    fn a_combiner_answers_as_the_table_does() {
        let small = Combiner::new(table_of(SRCAND), 4);
        let large = Combiner::new(table_of(SRCAND), 8);

        assert_eq!(small.result(0, 9, 12), 8);
        assert_eq!(large.result(0, 0xf0, 0x3c), 0x30);
    }

    #[test]
    fn a_colour_in_a_slot_is_that_slot() {
        let mut palette = DevicePalette::two_fifty_six();
        let vga = DisplayKind::default();
        let slotted = Color::rgb(1, 2, 3).in_slot(Some(77));

        assert_eq!(index_of_colour(vga, &mut palette, Some(&slotted)), 77);
        assert_eq!(index_of_colour(vga, &mut palette, None), 0);
        assert_eq!(
            across(vga, &mut palette, 0x5f, 0x3f, 0x3f, None),
            1,
            "the nearest static colour, not the driver's own"
        );
        assert_eq!(
            across(vga, &mut DevicePalette::sixteen(), 0x5f, 0x3f, 0x3f, None),
            1
        );
    }
}
