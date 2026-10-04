//! Which of its colours a display driver draws a colour as: what
//! `GetNearestColor` answers, and what the driver's `RealizeObject` makes of
//! a pen's or a solid brush's colour before anything is drawn. Read out of
//! the drivers' own code -- `ColorInfo`, export 2, and the routine it and
//! `RealizeObject` share -- and held to the `dither` probe's `nearest`
//! records, 194 of 194 on each display.
//!
//! It is not the nearest colour by any distance. The sixteen-colour drivers
//! sort the colour's channels, largest first, and look at its shape: the
//! largest of what the biggest channel has over the middle one, what the
//! middle has over the smallest, and the smallest. Whichever is largest says
//! whether the colour is one channel, two, or a grey, and each has a list of
//! levels and the colours they stand for; the level nearest the biggest
//! channel wins, the lower on a tie. Red 192, green 128, blue 0 is two
//! channels, and nearest 255, so yellow; with blue 64 it is one channel, and
//! red.
//!
//! The EGA's list for greys has its own two greys, `40` and `82`, where the
//! VGA's has `80` and `c0`. The Hercules draws white where red, green and
//! blue add up to 382 or more.

use crate::DevicePalette;

/// What of a display decides how its driver matches a colour: how many
/// colours it shows, and whether it is the EGA, with its own greys. The
/// default, a display of sixteen colours that is not the EGA, is the VGA's,
/// which is what the TypeScript engine takes where it is given no display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayKind {
    pub colors: u32,
    pub ega: bool,
}

impl Default for DisplayKind {
    fn default() -> Self {
        Self {
            colors: 16,
            ega: false,
        }
    }
}

impl DisplayKind {
    /// The bits a pixel of the display's own bitmaps takes: one, four or
    /// eight.
    pub fn depth(&self) -> u8 {
        DevicePalette::depth_of(self.colors)
    }
}

/// The levels, and the index bits each stands for, largest channel first.
#[derive(Clone, Copy)]
struct Shape {
    levels: &'static [i32],
    bits: &'static [u8],
}

/// The VGA's shapes, from `VGA.DRV`'s tables: one channel, two, and grey.
const VGA: [Shape; 3] = [
    Shape {
        levels: &[0x00, 0x80, 0xff],
        bits: &[0x0, 0x1, 0x9],
    },
    Shape {
        levels: &[0x00, 0x80, 0xff],
        bits: &[0x0, 0x3, 0xb],
    },
    Shape {
        levels: &[0x00, 0x80, 0xc0, 0xff],
        bits: &[0x0, 0x7, 0x8, 0xf],
    },
];

/// The EGA's, from `EGA.DRV`'s: the same, but for its greys.
const EGA: [Shape; 3] = [
    VGA[0],
    VGA[1],
    Shape {
        levels: &[0x00, 0x40, 0x82, 0xff],
        bits: &[0x0, 0x8, 0x7, 0xf],
    },
];

/// Which shape each ordering of the three parts is, by the driver's code
/// for the ordering: which of its three comparisons swapped.
const SHAPE_OF: [usize; 8] = [0, 1, 0, 0, 2, 1, 2, 0];

/// The sixteen-colour indices a two-colour bitmap takes as white, from the
/// flags the drivers keep beside their colours: light grey, green, yellow,
/// magenta, cyan and white on the VGA; the EGA's index 8 is its dark grey,
/// and is not.
const WHITE_ON_MONO: [usize; 6] = [8, 10, 11, 13, 14, 15];
const WHITE_ON_MONO_EGA: [usize; 5] = [10, 11, 13, 14, 15];

/// The indices of the 256-colour palette's static colours, the first ten
/// and the last ten, which are all a 256-colour driver matches a colour to.
pub const STATICS: [usize; 20] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
];

/// Sorts three values largest first as the drivers do, swapping first and
/// last, then middle and last, then first and middle, and says which
/// swapped.
fn sort(mut a: i32, mut b: i32, mut c: i32) -> ([i32; 3], usize) {
    let mut swaps = 0;

    if a < c {
        std::mem::swap(&mut a, &mut c);
        swaps |= 4;
    }

    if b < c {
        std::mem::swap(&mut b, &mut c);
        swaps |= 2;
    }

    if a < b {
        std::mem::swap(&mut a, &mut b);
        swaps |= 1;
    }

    ([a, b, c], swaps)
}

/// The sixteen-colour index a driver draws `red, green, blue` as.
fn sixteen(shapes: &[Shape; 3], red: u8, green: u8, blue: u8) -> usize {
    let ([max, mid, min], swaps) = sort(i32::from(red), i32::from(green), i32::from(blue));

    if max == 0 {
        return 0;
    }

    let shape = &shapes[SHAPE_OF[sort(max - mid, mid - min, min).1]];
    let mut best = 0;

    for (at, level) in shape.levels.iter().enumerate() {
        if (level - max).abs() < (shape.levels[best] - max).abs() {
            best = at;
        }
    }

    // The bits are for the channels largest first; undo the sort, last swap
    // first.
    let bits = shape.bits[best];
    let (mut first, mut second, mut third) = (bits & 1, (bits >> 1) & 1, (bits >> 2) & 1);

    if swaps & 1 != 0 {
        std::mem::swap(&mut first, &mut second);
    }

    if swaps & 2 != 0 {
        std::mem::swap(&mut second, &mut third);
    }

    if swaps & 4 != 0 {
        std::mem::swap(&mut first, &mut third);
    }

    usize::from((bits & 8) | (third << 2) | (second << 1) | first)
}

/// The static colour a 256-colour driver draws `red, green, blue` as: the
/// nearest by the sum of the squares, the lower index on a tie. Never one of
/// the driver's own colours between the static ones, though they are on the
/// screen: `5f3f3f` is drawn `800000`. **Recorded** by `palsys`: `ff8000` is
/// as near `808000` as `ffff00`, and draws `808000`.
pub fn nearest_static(palette: &DevicePalette, red: u8, green: u8, blue: u8) -> usize {
    let mut best = 0;
    let mut distance = i32::MAX;

    for index in STATICS {
        let [r, g, b] = palette.colours[index];
        let d = (i32::from(r) - i32::from(red)).pow(2)
            + (i32::from(g) - i32::from(green)).pow(2)
            + (i32::from(b) - i32::from(blue)).pow(2);

        if d < distance {
            distance = d;
            best = index;
        }
    }

    best
}

/// The index in `palette`, a bitmap's on `display`, that the display's
/// driver draws `red, green, blue` as.
pub fn matched_index(
    display: DisplayKind,
    palette: &mut DevicePalette,
    red: u8,
    green: u8,
    blue: u8,
) -> usize {
    let shapes = if display.ega { &EGA } else { &VGA };

    match palette.size() {
        2 => {
            if display.depth() == 1 {
                return usize::from(u32::from(red) + u32::from(green) + u32::from(blue) >= 382);
            }

            let index = sixteen(shapes, red, green, blue);
            let white = if display.ega {
                WHITE_ON_MONO_EGA.contains(&index)
            } else {
                WHITE_ON_MONO.contains(&index)
            };

            usize::from(white)
        }
        16 => sixteen(shapes, red, green, blue),
        256 => nearest_static(palette, red, green, blue),
        _ => palette.index(red, green, blue),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_a_colour_by_its_shape() {
        let vga = DisplayKind::default();
        let mut palette = DevicePalette::sixteen();

        // Two channels, nearest 255: yellow. With blue 64, one: red.
        assert_eq!(matched_index(vga, &mut palette, 192, 128, 0), 11);
        assert_eq!(matched_index(vga, &mut palette, 192, 128, 64), 9);
    }

    #[test]
    fn a_256_colour_driver_takes_only_its_static_colours() {
        let display = DisplayKind {
            colors: 256,
            ega: false,
        };
        let mut palette = DevicePalette::two_fifty_six();

        assert_eq!(matched_index(display, &mut palette, 0x5f, 0x3f, 0x3f), 1);
        assert_eq!(matched_index(display, &mut palette, 0xff, 0x80, 0x00), 3);
    }
}
