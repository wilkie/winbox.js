//! How a solid brush of a colour the display lacks is drawn: the pattern of
//! the colours it has that the display driver realises the brush as. Read
//! off the `dither` probe's recordings, which it reproduces on the VGA, the
//! Super VGA, the EGA and the Hercules, every pixel of every fill.
//!
//! Every pattern is eight pixels square and anchored to the device
//! context's origin, not to the rectangle filled -- the screen's corner for
//! the screen, a window's client area for the window's own device context,
//! as a window's controls show -- and every one orders its pixels by the
//! same table, `ORDER`: a pixel lower in it takes the darker part of the
//! mixture.
//!
//! **The colour displays.** A colour the palette holds is solid. Any other
//! is mixed from two cubes of colours: the dark one, whose channels are 0
//! or 128, and the bright one, whose channels are 0 or 255. The brightest
//! channel says how many pairs of pixels are bright, `(max - 127) >> 2`
//! when it is over 128, and the rest are dark. Each channel then puts its
//! value first into dark pixels, 128 a pixel, `(v + 1) >> 2` pairs of them
//! at most; what is left over goes into bright pixels one at a time, each
//! counted as 256, a half rounded down. In either part a channel is on in
//! the pixels highest in the order. The EGA's palette is not the VGA's, but
//! the colours it mixes are the same ones.
//!
//! **Two colours.** The Hercules's screen, and a monochrome bitmap on any
//! display. A number of the sixty-four pixels are white, the lowest in the
//! order, except at a few counts that have patterns of their own. What
//! counts and which order are the driver's:
//!
//! * The Hercules weighs the three channels alike, `(red + green + blue +
//!   3) / 12`, and has its own patterns at sixteen and forty-eight, a
//!   quarter and three quarters.
//! * The VGA and the Super VGA weigh green double,
//!   `(red + 2 * green + blue + MONO_ROUNDING) / 16`, and share the
//!   Hercules's order and its patterns.
//! * The EGA weighs them as the VGA does, in an order of its own, with its
//!   own patterns at thirty-two and forty-eight.

use crate::DevicePalette;
use crate::colour_match::{DisplayKind, STATICS, nearest_static};
use crate::device_palette::Rgb;
use crate::palette_for_depth;

/// The order of the pixels in a pattern, by y and x modulo eight.
const ORDER: [[u8; 8]; 8] = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
];

/// The EGA's order for a monochrome bitmap. Its patterns at thirty-two and
/// forty-eight hide where those two counts start, and 31 and 47 are the
/// only numbers that make it an order of all sixty-four.
const ORDER_EGA_MONO: [[u8; 8]; 8] = [
    [0, 32, 16, 48, 2, 34, 18, 50],
    [24, 56, 8, 40, 26, 58, 10, 42],
    [4, 36, 20, 52, 6, 38, 22, 54],
    [28, 60, 12, 44, 30, 62, 14, 46],
    [3, 35, 19, 51, 1, 33, 17, 49],
    [27, 59, 11, 43, 25, 57, 9, 41],
    [7, 39, 23, 55, 5, 37, 21, 53],
    [31, 63, 15, 47, 29, 61, 13, 45],
];

/// Patterns at a count of white pixels that are not the order's, two rows
/// of a byte each, repeated down: a set bit white, the leftmost pixel the
/// most significant. A quarter is every fourth pixel on a diagonal, three
/// quarters every fourth black, and a half a checkerboard. The same holds
/// for `ORDER`: its 15 and 47 are hidden by the patterns and are what make
/// it an order.
const QUARTER: [u8; 2] = [0x88, 0x22];
const HALF: [u8; 2] = [0xaa, 0x55];
const THREE_QUARTERS: [u8; 2] = [0xdd, 0x77];

/// Added to `red + 2 * green + blue` before the division by sixteen. The
/// greys in steps of four allow 4 to 11; `monoramp`'s every level of grey,
/// red, green and blue allows only 4, on all three colour displays, 1,024
/// of 1,024.
const MONO_ROUNDING: i32 = 4;

/// How a display driver makes a monochrome pattern.
struct Monochrome {
    white: fn(i32, i32, i32) -> i32,
    order: &'static [[u8; 8]; 8],
    patterns: &'static [(i32, [u8; 2])],
}

const HERCULES: Monochrome = Monochrome {
    white: |red, green, blue| (red + green + blue + 3) / 12,
    order: &ORDER,
    patterns: &[(16, QUARTER), (48, THREE_QUARTERS)],
};

const VGA: Monochrome = Monochrome {
    white: |red, green, blue| (red + 2 * green + blue + MONO_ROUNDING) >> 4,
    order: &ORDER,
    patterns: &[(16, QUARTER), (48, THREE_QUARTERS)],
};

const EGA: Monochrome = Monochrome {
    white: |red, green, blue| (red + 2 * green + blue + MONO_ROUNDING) >> 4,
    order: &ORDER_EGA_MONO,
    patterns: &[(32, HALF), (48, THREE_QUARTERS)],
};

/// The monochrome patterns of a display's driver.
fn monochrome_of(display: DisplayKind) -> &'static Monochrome {
    if display.depth() == 1 {
        &HERCULES
    } else if display.ega {
        &EGA
    } else {
        &VGA
    }
}

/// A channel of a pixel of a colour display's pattern: 0, 128 or 255.
fn channel(value: u8, bright: i32, order: i32) -> u8 {
    let value = i32::from(value);
    let dark = 64 - 2 * bright;
    let level = 2 * ((value + 1) >> 2);

    if order < dark {
        return if order >= dark - dark.min(level) {
            128
        } else {
            0
        };
    }

    // What 128 in each dark pixel leaves over, in 255s taken as 256s, a half
    // rounded down. `dither3`, 343 colours of three channels apart.
    let over = if level > dark {
        (value - 2 * dark + 1) >> 2
    } else {
        0
    };

    if order >= 64 - over { 255 } else { 0 }
}

/// The palette index a brush of `red, green, blue` draws at device pixel
/// `x, y` of a bitmap with `palette` on `display`, or `None` where the
/// colour is drawn solid.
#[allow(clippy::many_single_char_names)]
pub fn dithered_index(
    display: DisplayKind,
    palette: &mut DevicePalette,
    red: u8,
    green: u8,
    blue: u8,
    x: i32,
    y: i32,
) -> Option<usize> {
    // On a 256-colour display only the static colours are drawn solid, and
    // the rest dither as the VGA's do, each of its colours the static entry
    // holding it (`palsys`).
    if palette.size() == 256 {
        let solid = STATICS
            .iter()
            .any(|&index| palette.colours.get(index) == Some(&[red, green, blue]));

        if solid {
            return None;
        }

        let sixteen = palette_for_depth(4);
        let mut sixteen = sixteen.borrow_mut();
        let vga = dithered_index(display, &mut sixteen, red, green, blue, x, y)
            .unwrap_or_else(|| sixteen.index(red, green, blue));
        let [r, g, b] = sixteen.colours[vga];

        return Some(nearest_static(palette, r, g, b));
    }

    if palette.holds([red, green, blue]) {
        return None;
    }

    if palette.size() == 2 {
        let mono = monochrome_of(display);
        let white = (mono.white)(i32::from(red), i32::from(green), i32::from(blue));

        if let Some((_, pattern)) = mono.patterns.iter().find(|(at, _)| *at == white) {
            return Some(usize::from(
                (pattern[(y & 1) as usize] >> (7 - (x & 7))) & 1,
            ));
        }

        return Some(usize::from(
            i32::from(mono.order[(y & 7) as usize][(x & 7) as usize]) < white,
        ));
    }

    if palette.size() != 16 {
        return None;
    }

    let order = i32::from(ORDER[(y & 7) as usize][(x & 7) as usize]);
    let max = i32::from(red.max(green).max(blue));
    let bright = if max > 128 { (max - 127) >> 2 } else { 0 };
    let colour: Rgb = [
        channel(red, bright, order),
        channel(green, bright, order),
        channel(blue, bright, order),
    ];

    Some(palette.index(colour[0], colour[1], colour[2]))
}

/// The pattern a brush is realised as, eight by eight by device pixel
/// modulo eight, row by row; or `None` for a brush drawn in one colour.
pub fn dither_tile(
    display: DisplayKind,
    palette: &mut DevicePalette,
    red: u8,
    green: u8,
    blue: u8,
) -> Option<[u8; 64]> {
    dithered_index(display, palette, red, green, blue, 0, 0)?;

    let mut tile = [0; 64];

    for y in 0..8 {
        for x in 0..8 {
            tile[(y << 3) | x] =
                dithered_index(display, palette, red, green, blue, x as i32, y as i32).unwrap_or(0)
                    as u8;
        }
    }

    Some(tile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_colour_the_palette_holds_is_solid() {
        let vga = DisplayKind::default();
        let mut sixteen = DevicePalette::sixteen();

        assert_eq!(dither_tile(vga, &mut sixteen, 0xc0, 0xc0, 0xc0), None);
        assert!(dither_tile(vga, &mut sixteen, 0x40, 0x40, 0x40).is_some());
    }

    #[test]
    fn grey_on_a_monochrome_bitmap_is_a_checkerboard() {
        let vga = DisplayKind::default();
        let mut mono = DevicePalette::mono();
        let tile = dither_tile(vga, &mut mono, 0x80, 0x80, 0x80).unwrap();

        assert_eq!(&tile[..8], &[1, 0, 1, 0, 1, 0, 1, 0]);
        assert_eq!(&tile[8..16], &[0, 1, 0, 1, 0, 1, 0, 1]);
    }
}
