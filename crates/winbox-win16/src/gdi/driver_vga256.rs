//! The 256-colour display's own routines on a memory bitmap, as
//! `SVGA256.DRV` makes and draws them for GDI's helpers
//! (`driver_helpers.rs`): its bitmaps a byte a pixel, each byte an index of
//! the palette, or one plane of a bit. The twin of
//! `src/win16/gdi/driver-vga256.ts`, where each routine's read-out is told.
//!
//! **Read out** of `SVGA256.DRV`; **recorded** by `gdidmdrw` on that
//! display.

use winbox_raster::DevicePalette;
use winbox_raster::colour_match::nearest_static;
use winbox_raster::dither::dithered_index;
use winbox_raster::raster_op::combine;

use super::driver_bitmap::{
    DrawMode, Laid, STYLE_MASKS, entry_of, get_char_width as vga_get_char_width, lay_out, mix,
    offset_by, polyline_pixels, read_draw_mode, read_point, read_rect, read8, read16, read32,
    within, write8, write16,
};
use super::driver_hercules::{mono_scan, rop_bit};
use super::rle_runs::{RleWalk, huge_byte, odd_at, walk_rle};
use super::system_exports::device_color_match_of;
use crate::system::System;

/// Whether the display is the 256-colour one.
pub fn is_vga256(system: &System) -> bool {
    system
        .display
        .driver_file
        .eq_ignore_ascii_case("SVGA256.DRV")
}

fn palette(system: &System) -> DevicePalette {
    let display = super::bitmaps::display_kind(system);

    DevicePalette::for_display(256, false, display.ibm)
}

/* Colours ---------------------------------------------------------------- */

/// A static colour's flag beside its index (data `005e`; the table of 256
/// at `0784`, which no code writes): 1 white on a monochrome bitmap, 2
/// black; white is 3; nought between the statics.
const WHITE_ON_MONO: u8 = 0x01;
const BLACK: u8 = 0x02;
const WHITE_INDICES: [u8; 10] = [0x07, 0x08, 0x09, 0xf6, 0xf7, 0xf8, 0xfa, 0xfb, 0xfe, 0xff];

pub fn flags_of(index: u8) -> u8 {
    (if WHITE_INDICES.contains(&index) {
        WHITE_ON_MONO
    } else {
        0
    }) | if index == 0 || index == 0xff {
        BLACK
    } else {
        0
    }
}

/// The flag of a colour matched exactly (seg1 `0a03`).
const EXACT: u8 = 0x80;

/// A physical colour's top word: nought, then `FFh` (seg1 `0a18`).
const PHYSICAL_HIGH: u32 = 0xff00_0000;

/// The driver's match of a colour (seg1 `0990`): the nearest static, the
/// first on a tie, flagged `EXACT` where it is the colour.
pub fn matched(system: &System, colour: u32) -> u32 {
    let [red, green, blue, _] = colour.to_le_bytes();
    let palette = palette(system);
    let index = nearest_static(&palette, red, green, blue);
    let exact = if palette.colours[index] == [red, green, blue] {
        EXACT
    } else {
        0
    };

    index as u32 | u32::from(flags_of(index as u8) | exact) << 8 | PHYSICAL_HIGH
}

/// A colour made physical where it is not one already (seg1 `1afe`,
/// `061a`).
fn physical_of(system: &System, colour: u32, passed: fn(u8) -> bool) -> u32 {
    if passed((colour >> 24) as u8) {
        colour
    } else {
        matched(system, colour)
    }
}

/// `ColorInfo` (`SVGA256.DRV` seg1 `1ae0`), whatever the bitmap.
pub fn color_info(system: &mut System, colour: u32, physical_out: u32) -> u32 {
    let palette = palette(system);
    let rgb_of = |index: u8| {
        let [r, g, b] = palette.colours[usize::from(index)];

        u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16
    };

    if physical_out != 0 {
        let physical = physical_of(system, colour, |top| top & 0x80 != 0 || top == 1);

        write16(system, physical_out, 0, physical as u16);
        write16(system, physical_out, 2, 0xff00);
        return rgb_of(physical as u8);
    }

    let index = colour as u8;

    if (0x0a..=0xf5).contains(&index) {
        return (colour & 0xffff) | 0xff00_0000;
    }

    rgb_of(index)
}

/* RealizeObject ---------------------------------------------------------- */

/// The size of each object, by style 1 to 3 (seg1 `098a`).
const SIZES: [u32; 3] = [6, 0x53, 0];

/// What a style of nought answers: the font's routine, `094b` (seg1
/// `05ea`).
const STYLE_NOUGHT: u32 = 0x094b;

/// The routine's offset in the driver's table, which `Brute` leaves in DX.
const REALIZE_OBJECT: u32 = 0x24;

/// A brush's parts (seg1 `0641`, `0819`).
const BRUSH_MONO: i32 = 0x40;
const BRUSH_STYLE: i32 = 0x48;
const BRUSH_FLAGS: i32 = 0x4a;
const BRUSH_HATCH: i32 = 0x4b;

const SOLID: u16 = 0;
const HOLLOW: u16 = 1;
const HATCHED: u16 = 2;
const PATTERN: u16 = 3;

/// One colour (`06b5`); black, white or hollow (`06c6`); a monochrome
/// pattern (`0770`).
const ONE_COLOUR: u8 = 0x08;
const PLAIN: u8 = 0x0a;
const MONO_PATTERN: u8 = 0x04;

/// The hatches (seg1 `0954`).
const HATCHES: [[u8; 8]; 6] = [
    [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
    [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
    [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
    [0x08, 0x08, 0x08, 0x08, 0xff, 0x08, 0x08, 0x08],
    [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/// A pen (seg1 `05fb`).
fn realize_pen(system: &mut System, input: u32, out: u32) {
    let style = read16(system, input, 0);
    let width = read16(system, input, 2);
    let (physical, kept) = if style == 5 {
        (REALIZE_OBJECT << 16, style)
    } else {
        (
            physical_of(system, read32(system, input, 6), |top| top == 0xff),
            if width > 1 || style > 5 { 0 } else { style },
        )
    };

    write16(system, out, 0, physical as u16);
    write16(system, out, 2, (physical >> 16) as u16);
    write16(system, out, 4, kept);
}

/// Each of the 64 bytes' flag of white (seg1 `07f9`-`0816`).
fn mono_of_bytes(system: &mut System, out: u32) {
    for row in 0..8 {
        let mut bits = 0;

        for x in 0..8 {
            bits |= (flags_of(read8(system, out, row * 8 + x)) & WHITE_ON_MONO) << (7 - x);
        }

        write8(system, out, BRUSH_MONO + row, bits);
    }
}

/// The monochrome plane of a grey (seg1 `0406`, `048d`).
const MONO_GREYS: [[u8; 4]; 17] = [
    [0x00, 0x00, 0x00, 0x00],
    [0x88, 0x00, 0x00, 0x00],
    [0x88, 0x00, 0x22, 0x00],
    [0xaa, 0x00, 0x22, 0x00],
    [0xaa, 0x00, 0xaa, 0x00],
    [0xaa, 0x44, 0xaa, 0x00],
    [0xaa, 0x44, 0xaa, 0x11],
    [0xaa, 0x55, 0xaa, 0x11],
    [0xaa, 0x55, 0xaa, 0x55],
    [0xee, 0x55, 0xaa, 0x55],
    [0xee, 0x55, 0xbb, 0x55],
    [0xff, 0x55, 0xbb, 0x55],
    [0xff, 0x55, 0xff, 0x55],
    [0xff, 0xdd, 0xff, 0x55],
    [0xff, 0xdd, 0xff, 0x77],
    [0xff, 0xff, 0xff, 0x77],
    [0xff, 0xff, 0xff, 0xff],
];

/// The row and bit of the pixels more (seg1 `046d`).
const MONO_MORE: [(usize, u8); 16] = [
    (0, 0x80),
    (2, 0x20),
    (0, 0x20),
    (2, 0x80),
    (1, 0x40),
    (3, 0x10),
    (1, 0x10),
    (3, 0x40),
    (0, 0x40),
    (2, 0x10),
    (0, 0x10),
    (2, 0x40),
    (1, 0x80),
    (3, 0x20),
    (1, 0x20),
    (3, 0x80),
];

/// The rows for the levels of 16, 32 and 48 (seg1 `0436`, `0468`,
/// `0707`).
const MONO_HALF_OF: [u8; 5] = [4, 1, 2, 3, 5];

fn mono_half(which: u8) -> Option<[u8; 2]> {
    match which {
        1 => Some([0x88, 0x22]),
        2 => Some([0xaa, 0x55]),
        3 => Some([0xdd, 0x77]),
        _ => None,
    }
}

fn mono_of_grey(grey: u32) -> [u8; 8] {
    let level = ((grey >> 1) + (grey & 1)) >> 1;
    let base = MONO_GREYS[(level >> 2) as usize];
    let mut rows = [
        base[0], base[1], base[2], base[3], base[0], base[1], base[2], base[3],
    ];
    let rest = level & 3;

    if rest != 0 {
        let (row, bit) = MONO_MORE[(level >> 2) as usize];
        let low = bit >> 4;

        if rest == 3 {
            rows[row] |= low;
        }

        if rest >= 2 {
            rows[row + 4] |= low;
        }

        rows[row] |= bit;
    } else if level.trailing_zeros() >= 4
        && let Some(half) = mono_half(MONO_HALF_OF[(level >> 4) as usize])
    {
        for (row, byte) in rows.iter_mut().enumerate() {
            *byte = half[row & 1];
        }
    }

    rows
}

/// A solid brush (seg1 `0666`).
fn realize_solid(system: &mut System, colour: u32, out: u32) -> u8 {
    let [red, green, blue, top] = colour.to_le_bytes();

    if top & 0xef != 0 {
        for at in 0..0x40 {
            write8(system, out, at, colour as u8);
        }

        let white = if (colour >> 8) & 1 != 0 { 0xff } else { 0 };

        for at in 0..8 {
            write8(system, out, BRUSH_MONO + at, white);
        }

        return (colour >> 8) as u8 | PLAIN;
    }

    if red | green | blue == 0 || red & green & blue == 0xff {
        let byte = if red != 0 { 0xff } else { 0 };

        for at in 0..0x48 {
            write8(system, out, at, byte);
        }

        return PLAIN;
    }

    let grey = u32::midpoint(
        u32::midpoint(u32::from(red), u32::from(blue)),
        u32::from(green),
    );
    let physical = matched(system, colour & 0xff_ffff);
    let mut flags = (physical >> 8) as u8 & 0xf7;

    if flags & EXACT != 0 {
        flags |= ONE_COLOUR;

        for at in 0..0x40 {
            write8(system, out, at, physical as u8);
        }
    } else {
        let display = super::bitmaps::display_kind(system);
        let mut palette = palette(system);

        for y in 0..8 {
            for x in 0..8 {
                let at = dithered_index(display, &mut palette, red, green, blue, x, y)
                    .map_or(physical as u8, |index| index as u8);

                write8(system, out, y * 8 + x, at);
            }
        }
    }

    for (at, row) in mono_of_grey(grey).into_iter().enumerate() {
        write8(system, out, BRUSH_MONO + at as i32, row);
    }

    flags
}

/// A hatched brush (seg1 `0791`).
fn realize_hatched(system: &mut System, input: u32, out: u32, hatch: usize) {
    let back = physical_of(system, read32(system, input, 8), |top| top == 0xff) as u8;
    let fore = physical_of(system, read32(system, input, 2), |top| top == 0xff) as u8;
    let rows = HATCHES[hatch];

    for (y, row) in rows.iter().enumerate() {
        for x in 0..8 {
            let byte = if (row << x) & 0x80 != 0 { fore } else { back };

            write8(system, out, y as i32 * 8 + x, byte);
        }
    }

    mono_of_bytes(system, out);

    for (at, row) in rows.into_iter().enumerate() {
        write8(system, out, BRUSH_HATCH + at as i32, row);
    }
}

/// A pattern brush (seg1 `0729`).
fn realize_pattern(system: &mut System, input: u32, out: u32) -> u8 {
    let bitmap = read32(system, input, 2);
    let stride = i32::from(read16(system, bitmap, 6));
    let bits = read32(system, bitmap, 0x0a);

    if read8(system, bitmap, 9) == 8 {
        for y in 0..8 {
            for x in 0..8 {
                let byte = read8(system, bits, y * stride + x);

                write8(system, out, y * 8 + x, byte);
            }
        }

        mono_of_bytes(system, out);
        return 0;
    }

    for y in 0..8 {
        let byte = read8(system, bits, y * stride);

        write8(system, out, BRUSH_MONO + y, byte);
    }

    MONO_PATTERN
}

/// A brush turned to its origin (seg1 `0833`, `08ab`).
fn turn_brush(system: &mut System, out: u32, flags: u8, x: u16, y: u16) {
    if flags & PLAIN == PLAIN {
        return;
    }

    let by = usize::from(x & 7);
    let down = i32::from(y & 7);
    let mut blocks = vec![(BRUSH_MONO, 1), (BRUSH_HATCH, 1)];

    if flags & ONE_COLOUR == 0 {
        blocks.insert(0, (0, 8));
    }

    for (at, width) in blocks {
        let mut rows = Vec::new();

        for row in 0..8 {
            let bytes: Vec<u8> = (0..width)
                .map(|i| read8(system, out, at + row * width + i))
                .collect();

            rows.push(if width == 8 {
                (0..8).map(|i| bytes[(i + 8 - by) & 7]).collect::<Vec<_>>()
            } else {
                bytes
                    .iter()
                    .map(|byte| byte.rotate_right(by as u32))
                    .collect()
            });
        }

        for (row, bytes) in rows.into_iter().enumerate() {
            for (i, byte) in bytes.into_iter().enumerate() {
                write8(
                    system,
                    out,
                    at + ((row as i32 + down) & 7) * width + i as i32,
                    byte,
                );
            }
        }
    }
}

fn realize_brush(system: &mut System, input: u32, out: u32, origin: u32) {
    let style = read16(system, input, 0);
    let mut kept = if style <= 3 { style } else { SOLID };
    let flags;

    if kept == HOLLOW {
        flags = PLAIN;
    } else if kept == HATCHED && read16(system, input, 6) <= 5 {
        realize_hatched(system, input, out, usize::from(read16(system, input, 6)));
        flags = 0;
    } else if kept == PATTERN {
        flags = realize_pattern(system, input, out);
    } else {
        kept = SOLID;
        flags = realize_solid(system, read32(system, input, 2), out);
    }

    write16(system, out, BRUSH_STYLE, kept);
    write8(system, out, BRUSH_FLAGS, flags);
    turn_brush(system, out, flags, origin as u16, (origin >> 16) as u16);
}

/// `RealizeObject` (`SVGA256.DRV` seg1 `05b4`).
pub fn realize_object(system: &mut System, style: u16, input: u32, out: u32, xform: u32) -> u32 {
    let signed = style as i16;

    if signed < 0 {
        return 1;
    }

    if signed == 0 {
        return STYLE_NOUGHT;
    }

    if signed > 3 {
        return 0;
    }

    if out != 0 {
        if signed == 1 {
            realize_pen(system, input, out);
        } else if signed == 2 {
            realize_brush(system, input, out, xform);
        }
    }

    SIZES[(signed - 1) as usize]
}

/* Bitmaps ---------------------------------------------------------------- */

/// The word at 8 of a bitmap of a byte a pixel, and of one plane (seg1
/// `1fc3`-`1fcb`).
const BYTE_A_PIXEL: u16 = 0x0801;
const ONE_BIT: u16 = 0x0101;

/// A memory bitmap as a driver is handed it.
#[derive(Debug, Clone, Copy)]
struct Bitmap {
    width: u16,
    height: u16,
    width_bytes: u16,
    format: u16,
    bits: u32,
    segment_index: u16,
    scan_segment: u16,
}

fn read_bitmap(system: &System, far: u32) -> Bitmap {
    Bitmap {
        width: read16(system, far, 2),
        height: read16(system, far, 4),
        width_bytes: read16(system, far, 6),
        format: read16(system, far, 8),
        bits: read32(system, far, 0x0a),
        segment_index: read16(system, far, 0x16),
        scan_segment: read16(system, far, 0x18),
    }
}

impl Bitmap {
    fn colour(&self) -> bool {
        self.format == BYTE_A_PIXEL
    }

    /// Where a row starts; nothing bounded to the bitmap.
    fn row(&self, y: i32) -> u32 {
        let mut segment = (self.bits >> 16) as i32;
        let mut row = y;

        if self.segment_index != 0 && self.scan_segment != 0 {
            let segments = row.div_euclid(i32::from(self.scan_segment));

            segment = (segment + segments * i32::from(self.segment_index)) & 0xffff;
            row -= segments * i32::from(self.scan_segment);
        }

        let offset = ((self.bits & 0xffff) as i32 + row * i32::from(self.width_bytes)) & 0xffff;

        (segment as u32) << 16 | offset as u32
    }

    fn pixel(&self, system: &System, x: i32, y: i32) -> u8 {
        let row = self.row(y);

        if self.colour() {
            read8(system, row, x)
        } else {
            (read8(system, row, x >> 3) >> (7 - (x & 7))) & 1
        }
    }

    fn put(&self, system: &mut System, x: i32, y: i32, value: u8) {
        let row = self.row(y);

        if self.colour() {
            write8(system, row, x, value);
            return;
        }

        let byte = read8(system, row, x >> 3);
        let mask = 0x80 >> (x & 7);

        write8(
            system,
            row,
            x >> 3,
            if value & 1 != 0 {
                byte | mask
            } else {
                byte & !mask
            },
        );
    }

    /// A physical colour as a pixel: its index, or its flag of white.
    fn of_physical(&self, physical: u32) -> u8 {
        if self.colour() {
            physical as u8
        } else {
            (physical >> 8) as u8 & WHITE_ON_MONO
        }
    }
}

/* BitBlt ----------------------------------------------------------------- */

/// The brush at a pixel, as `BitBlt` takes its copy of it (seg1 `1eb1`).
fn brush_pixel(
    system: &System,
    brush: u32,
    bitmap: &Bitmap,
    mode: &DrawMode,
    x: i32,
    y: i32,
) -> u8 {
    let mono_pattern = read16(system, brush, BRUSH_STYLE) == PATTERN
        && read8(system, brush, BRUSH_FLAGS) & MONO_PATTERN != 0;
    let set = (read8(system, brush, BRUSH_MONO + (y & 7)) >> (7 - (x & 7))) & 1;

    if mono_pattern {
        return bitmap.of_physical(if set != 0 {
            mode.bk_color
        } else {
            mode.text_color
        });
    }

    if bitmap.colour() {
        read8(system, brush, (y & 7) * 8 + (x & 7))
    } else {
        set
    }
}

/// The operations' need of a source and of a brush (seg1 `1316`).
fn uses_source(rop: u8) -> bool {
    ((rop >> 2) ^ rop) & 0x33 != 0
}

fn uses_brush(rop: u8) -> bool {
    ((rop >> 4) ^ rop) & 0x0f != 0
}

/// `BitBlt` (`SVGA256.DRV` seg1 `16a0`) on a memory bitmap.
#[allow(
    clippy::too_many_arguments,
    clippy::many_single_char_names,
    clippy::too_many_lines
)]
pub fn bit_blt(
    system: &mut System,
    dest_far: u32,
    x: u16,
    y: u16,
    source_far: u32,
    sx: u16,
    sy: u16,
    width: u16,
    height: u16,
    rop: u32,
    brush: u32,
    draw_mode: u32,
) -> u32 {
    if (rop >> 16) & 0xffff > 0xff {
        return 0;
    }

    let table = (rop >> 16) as u8;
    let reads_source = uses_source(table);
    let reads_brush = uses_brush(table);
    let formats = [BYTE_A_PIXEL, ONE_BIT];
    let source = (reads_source && source_far != 0).then(|| read_bitmap(system, source_far));
    let dest = read_bitmap(system, dest_far);

    if source.is_some_and(|source| !formats.contains(&source.format))
        || !formats.contains(&dest.format)
    {
        return 0;
    }

    if reads_brush && (brush == 0 || read16(system, brush, BRUSH_STYLE) == HOLLOW) {
        return 0;
    }

    let mode = read_draw_mode(system, draw_mode);
    let mut w = i32::from(width as i16);
    let mut h = i32::from(height as i16);
    let mut dx = i32::from(x as i16);
    let mut dy = i32::from(y as i16);
    let mut from_x = i32::from(sx as i16);
    let mut from_y = i32::from(sy as i16);

    if let Some(source) = &source {
        if from_x < 0 {
            w += from_x;
            dx -= from_x;
            from_x = 0;
        }

        w -= (from_x + w - i32::from(source.width)).max(0);

        if from_y < 0 {
            h += from_y;
            dy -= from_y;
            from_y = 0;
        }

        h -= (from_y + h - i32::from(source.height)).max(0);
    }

    if w <= 0 || h <= 0 {
        return 1;
    }

    let unsigned = |value: i32| value as u32;
    let backward = source.is_some()
        && source_far == dest_far
        && unsigned(from_x + w) > unsigned(dx)
        && unsigned(dx + w) > unsigned(from_x)
        && unsigned(from_y + h) > unsigned(dy)
        && unsigned(dy + h) > unsigned(from_y)
        && if dy == from_y {
            unsigned(dx) > unsigned(from_x)
        } else {
            unsigned(dy) > unsigned(from_y)
        };

    if let Some(source) = &source
        && backward
        && !dest.colour()
        && !source.colour()
    {
        mono_backward(
            system,
            &dest,
            (dx, dy, from_x, from_y, w, h),
            table,
            brush,
            &mode,
            reads_brush,
        );
        return 1;
    }

    let mask = if dest.colour() { 0xff } else { 1 };
    let mut sources = Vec::new();

    if let Some(source) = &source {
        for row in 0..h {
            for column in 0..w {
                let mut value = source.pixel(system, from_x + column, from_y + row);

                if source.colour() != dest.colour() {
                    value = if dest.colour() {
                        (if value != 0 {
                            mode.bk_color
                        } else {
                            mode.text_color
                        }) as u8
                    } else {
                        u8::from(value == mode.bk_color as u8)
                    };
                }

                sources.push(value);
            }
        }
    }

    for row in 0..h {
        for column in 0..w {
            let (px, py) = (dx + column, dy + row);
            let p = if reads_brush {
                brush_pixel(system, brush, &dest, &mode, px, py)
            } else {
                0
            };
            let s = if source.is_some() {
                sources[(row * w + column) as usize]
            } else {
                0
            };
            let d = dest.pixel(system, px, py);
            let value = combine(table, u32::from(p), u32::from(s), u32::from(d), mask);

            dest.put(system, px, py, value as u8);
        }
    }

    1
}

/// A monochrome copy within one bitmap going back (seg1 `0a2c` and the
/// code it makes), as `monoBackward` in the TypeScript.
#[allow(clippy::too_many_arguments)]
fn mono_backward(
    system: &mut System,
    bitmap: &Bitmap,
    (dx, dy, sx, sy, w, h): (i32, i32, i32, i32, i32, i32),
    table: u8,
    brush: u32,
    mode: &DrawMode,
    reads_brush: bool,
) {
    let phase = ((sx & 7) - (dx & 7)) & 7;
    let prefetch = (sx & 7) > (dx & 7);
    let end = (dx + w) & 7;
    let mut first = 0xffu8 >> (dx & 7);
    let mut last = if end != 0 {
        ((0xff00u32 >> end) & 0xff) as u8
    } else {
        0xff
    };
    let mut inner = ((dx + w - 1) >> 3) - (dx >> 3) - 1;

    if inner > 0 {
        if last == 0xff {
            last = 0;
            inner += 1;
        }
    } else if inner < 0 {
        first &= last;
        last = 0;
        inner = 0;
    }

    let skip_last = phase != 0 && phase + ((end - 1) & 7) <= 7;
    let keep = 0xff00u16.rotate_left(phase as u32);

    for r in (0..h).rev() {
        let from = bitmap.row(sy + r);
        let to = bitmap.row(dy + r);
        let mut si = (sx + w - 1) >> 3;
        let mut di = (dx + w - 1) >> 3;
        let mut carried = 0u8;
        let mut fetch = |system: &System, si: &mut i32| {
            let byte = read8(system, from, *si);

            *si -= 1;

            if phase == 0 {
                return byte;
            }

            let turned = byte.rotate_left(phase as u32);
            let out = (turned & keep as u8) | carried;

            carried = turned & (keep >> 8) as u8;
            out
        };
        let store = |system: &mut System, di: &mut i32, mask: u8, s: u8| {
            let d = read8(system, to, *di);
            let mut p = 0u8;

            if reads_brush {
                for bit in 0..8 {
                    p |= brush_pixel(system, brush, bitmap, mode, *di * 8 + bit, dy + r)
                        << (7 - bit);
                }
            }

            let value = combine(table, u32::from(p), u32::from(s), u32::from(d), 0xff) as u8;

            write8(system, to, *di, (d & !mask) | (value & mask));
            *di -= 1;
        };

        if prefetch {
            fetch(system, &mut si);
        }

        let s = fetch(system, &mut si);
        store(system, &mut di, first, s);

        for _ in 0..inner {
            let s = fetch(system, &mut si);
            store(system, &mut di, 0xff, s);
        }

        if last != 0 {
            let s = if skip_last {
                carried
            } else {
                fetch(system, &mut si)
            };
            store(system, &mut di, last, s);
        }
    }
}

/* Output ----------------------------------------------------------------- */

const OS_SCANLINES: u16 = 4;
const OS_POLYLINE: u16 = 18;

/// `Output`'s styles that begin and end a run of scanlines (seg1
/// `12f2`-`12fa`).
const OS_BEGIN_SCANS: u16 = 0x50;
const OS_END_SCANS: u16 = 0x51;

/// `Output` (`SVGA256.DRV` seg1 `12e2`): a polyline (seg6 `010c`) and
/// scanlines (seg8 `00c9`); 50h answers 1 and 51h nought, drawing nothing
/// (seg8 `01b2`, `0222`); any other style nought. Not followed, as in
/// `driver-vga256.ts`: what the driver keeps between 50h and 51h.
#[allow(clippy::too_many_arguments)]
pub fn output(
    system: &mut System,
    dest_far: u32,
    style: u16,
    count: u16,
    points: u32,
    pen: u32,
    brush: u32,
    draw_mode: u32,
    clip: u32,
) -> u32 {
    let dest = read_bitmap(system, dest_far);
    let mode = read_draw_mode(system, draw_mode);
    let bits = if dest.colour() { 8 } else { 1 };

    if style == OS_BEGIN_SCANS {
        return 1;
    }

    if style == OS_END_SCANS {
        return 0;
    }

    if style == OS_POLYLINE {
        let path: Vec<_> = (0..i32::from(count as i16))
            .map(|index| read_point(system, points, index))
            .collect();
        let pen_style = read16(system, pen, 4);

        if pen_style == 5 {
            return 1;
        }

        let masks = STYLE_MASKS
            .get(usize::from(pen_style))
            .copied()
            .unwrap_or(0xff);
        let ink = dest.of_physical(read32(system, pen, 0));
        let gap = (mode.bk_mode == 2).then(|| dest.of_physical(mode.bk_color));
        let rect = (clip != 0).then(|| read_rect(system, clip));

        for (px, py, at) in polyline_pixels(&path) {
            if let Some((left, top, right, bottom)) = rect
                && (px < left || px >= right || py < top || py >= bottom)
            {
                continue;
            }

            let on = (masks >> ((at >> 8) & 7)) & 1 != 0;
            let colour = match (on, gap) {
                (true, _) => ink,
                (false, Some(gap)) => gap,
                (false, None) => continue,
            };
            let there = dest.pixel(system, px, py);

            dest.put(system, px, py, mix(mode.rop2, colour, there, bits));
        }

        return 1;
    }

    if style == OS_SCANLINES {
        let (lines, y) = read_point(system, points, 0);
        // The pen read only where there is no brush: **recorded** by
        // `gdidmpx`, a brush and no pen.
        let ink = if brush != 0 {
            0
        } else {
            dest.of_physical(read32(system, pen, 0))
        };
        let see_through =
            brush != 0 && mode.bk_mode == 1 && read16(system, brush, BRUSH_STYLE) == HATCHED;

        for index in 1..lines {
            let (from, to) = read_point(system, points, index);

            for px in from..to {
                if see_through
                    && read8(system, brush, BRUSH_HATCH + (y & 7)) & (0x80 >> (px & 7)) == 0
                {
                    continue;
                }

                let p = if brush != 0 {
                    brush_pixel(system, brush, &dest, &mode, px, y)
                } else {
                    ink
                };
                let there = dest.pixel(system, px, y);

                dest.put(system, px, y, mix(mode.rop2, p, there, bits));
            }
        }

        return 1;
    }

    0
}

/* ExtTextOut ------------------------------------------------------------- */

const FONTINFO_AT: u32 = 0x42;
const VERSION_3: u16 = 0x300;
const DF_PIX_HEIGHT: i32 = 0x58;
const DF_BITS_POINTER: i32 = 0x6d;

/// What `ExtTextOut` answers for a font it cannot draw (seg2 `03c7`).
const CANNOT: u32 = 0x8000_0000;

/// `ExtTextOut` (`SVGA256.DRV` seg2 `0375`; `StrBlt`, `036a`) on a memory
/// bitmap: the VGA's, without emboldening.
#[allow(clippy::too_many_arguments)]
pub fn ext_text_out(
    system: &mut System,
    dest_far: u32,
    x: u16,
    y: u16,
    clip: u32,
    string: u32,
    count: u16,
    font: u32,
    draw_mode: u32,
    widths: u32,
    opaque: u32,
    options: u16,
) -> u32 {
    let segment = font & 0xffff_0000;

    if font & 0xffff != FONTINFO_AT || read16(system, segment, 0) != VERSION_3 {
        return CANNOT;
    }

    let dest = read_bitmap(system, dest_far);
    let mut mode = read_draw_mode(system, draw_mode);
    let extra = mode.character_extra;
    let height = i32::from(read16(system, segment, DF_PIX_HEIGHT));
    let n = i32::from(count as i16);

    if n < 0 {
        let (_, reach) = lay_out(system, segment, string, -n, &mut mode, extra, 0);

        write16(system, draw_mode, 0x10, mode.break_err as u16);
        return (height as u32) << 16 | (reach.min(0x7fff) as u32 & 0xffff);
    }

    let clip_box = read_rect(system, clip);
    let opaque_box = (opaque != 0).then(|| read_rect(system, opaque));
    let mut text_box = Some(clip_box);

    if options & 4 != 0
        && let Some(opaque_box) = opaque_box
    {
        text_box = within(clip_box, opaque_box);

        if text_box.is_none() {
            return 0;
        }
    }

    let back = dest.of_physical(mode.bk_color);
    let fore = dest.of_physical(mode.text_color);

    if options & 2 != 0
        && let Some(fill) = opaque_box.and_then(|opaque_box| within(clip_box, opaque_box))
    {
        for py in fill.1..fill.3 {
            for px in fill.0..fill.2 {
                dest.put(system, px, py, back);
            }
        }
    }

    if n == 0 {
        return 0;
    }

    let (dx, dy) = (i32::from(x as i16), i32::from(y as i16));
    let (characters, reach) = lay_out(system, segment, string, n, &mut mode, extra, widths);
    let mut ink = vec![false; (reach.max(0) * height) as usize];
    let bits = read32(system, segment, DF_BITS_POINTER) & 0xffff_0000;

    for Laid { index, width, at } in characters {
        let entry = entry_of(system, segment, index);
        let glyph = bits | (read32(system, segment, entry + 2) & 0xffff);

        for column in 0..width {
            for row in 0..height {
                let byte = read8(system, glyph, (column >> 3) * height + row);
                let px = at + column;

                if byte & (0x80 >> (column & 7)) != 0 && px >= 0 && px < reach {
                    ink[(row * reach + px) as usize] = true;
                }
            }
        }
    }

    if let Some(cell) =
        text_box.and_then(|text_box| within(text_box, (dx, dy, dx + reach, dy + height)))
    {
        for py in cell.1..cell.3 {
            for px in cell.0..cell.2 {
                if ink[((py - dy) * reach + (px - dx)) as usize] {
                    dest.put(system, px, py, fore);
                } else if mode.bk_mode == 2 {
                    dest.put(system, px, py, back);
                }
            }
        }
    }

    write16(system, draw_mode, 0x10, mode.break_err as u16);
    0
}

/// `GetCharWidth` (`SVGA256.DRV` seg1 `0358`): the VGA's, without
/// emboldening.
pub fn get_char_width(system: &mut System, buffer: u32, first: u16, last: u16, font: u32) -> u32 {
    vga_get_char_width(system, buffer, first, last, font, 0, false)
}

/* DeviceBitmapBits and DIBToDevice --------------------------------------- */

const DIB_BITS: [u16; 4] = [1, 4, 8, 24];

/// A run-length encoded DIB's colour table as `SVGA256.DRV` takes it
/// (seg9 `176f`-`179e`): `biClrUsed` words, or as many as its bits give, a
/// palette's index the low byte of each; and whether it is other than the
/// indices in order -- the sum of each low byte less its place and each
/// high byte, as words, not nought (flag 8, which an eight-bit DIB needs to
/// go through the table at all: `157c`, `159c`). `rleTable`.
fn rle_table(system: &System, info: u32) -> (Vec<u8>, bool) {
    let used = read16(system, info, 0x20);
    let count = if used == 0 {
        (1u32 << (read8(system, info, 0x0e) & 0x1f)) & 0xffff
    } else {
        u32::from(used)
    };
    let at = offset_by(info, i32::from(read16(system, info, 0)));
    let mut table = Vec::new();
    let mut sum = 0u16;

    for entry in 0..count {
        let word = read16(system, at, entry as i32 * 2);
        let low = word as u8;

        table.push(low);
        sum = sum.wrapping_add((word & 0xff00) | u16::from(low.wrapping_sub(entry as u8)));
    }

    (table, sum != 0)
}

/// An index through `rle_table`'s table: four bits' always, eight bits'
/// only where the table is not the indices in order, and the index as it
/// is where it is (`SVGA256.DRV` `1861`, `18c2`; `19a7`, `19a5`; `19d3`,
/// `1941`). An index past the table is taken as nought: the driver's table
/// is 256 bytes of its stack, the rest left as they were. `rleIndex`.
fn rle_index(table: &[u8], translated: bool, eight: bool, index: u8) -> u8 {
    if eight && !translated {
        index
    } else {
        table.get(usize::from(index)).copied().unwrap_or(0)
    }
}

/// A run-length encoded DIB set into a memory bitmap by `SVGA256.DRV`
/// seg9 `15ac`, which `DeviceBitmapBits` hands it with no clipping
/// rectangle (`0041`-`0051`): the DIB's own rectangle at the bitmap's
/// corner instead (`17e3`-`17fc`). The first line is the DIB's height less
/// one, whatever the start and the count (`1691`-`1697`); a line above the
/// bitmap ends the walk (`walk_rle`), and each index's byte goes at its
/// column of its row, with no bound to the width (`1738`-`1763`, `19a7`).
/// A compression past 2 (`169d`) or a monochrome bitmap (`16d9`) answers
/// -1, a bitmap of neither format nought; else 1 (`166c`). **Recorded** by
/// `gdidmrle`.
fn rle_set(system: &mut System, bitmap_far: u32, bits: u32, info: u32) -> u32 {
    let dest = read_bitmap(system, bitmap_far);
    let compression = read16(system, info, 0x10);

    if compression > 2 {
        return 0xffff;
    }

    match read8(system, bitmap_far, 9) {
        1 => return 0xffff,
        8 => {}
        _ => return 0,
    }

    let (table, translated) = rle_table(system, info);
    let eight = compression & 3 == 1;
    let walk = RleWalk {
        eight,
        x: 0,
        y: i32::from(read16(system, info, 8)) - 1,
        top: Some(0),
    };
    let mut pixels = Vec::new();

    walk_rle(
        &walk,
        &mut |at| huge_byte(system, bits, at),
        &|at| odd_at(bits, at),
        &mut |x, y, index| pixels.push((x, y, index)),
    );

    for (x, y, index) in pixels {
        write8(
            system,
            dest.row(y),
            x,
            rle_index(&table, translated, eight, index),
        );
    }

    1
}

/// `DeviceBitmapBits` (`SVGA256.DRV` seg9 `0000`) on a memory bitmap.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub fn device_bitmap_bits(
    system: &mut System,
    bitmap_far: u32,
    get: u16,
    start: u16,
    scans: u16,
    bits: u32,
    info: u32,
    translate: u32,
) -> u32 {
    let dest = read_bitmap(system, bitmap_far);
    let colour = !(read8(system, bitmap_far, 8) == 1 && read8(system, bitmap_far, 9) == 1);
    let width = i32::from(read16(system, info, 4));
    let height = i32::from(read16(system, info, 8));
    let bit_count = read16(system, info, 0x0e);

    // A compressed DIB to the routines of run lengths (`0034`-`005c`), whose
    // get is not followed here.
    if read8(system, info, 0x10) & 3 != 0 {
        return if get == 0 && bits != 0 {
            rle_set(system, bitmap_far, bits, info)
        } else {
            0
        };
    }

    if bits == 0 {
        if get == 0 {
            return 0;
        }

        let size =
            (((width * i32::from(bit_count) + 0x1f) & 0xffe0) >> 3) as u32 * u32::from(scans);

        write16(system, info, 0x14, size as u16);
        write16(system, info, 0x16, (size >> 16) as u16);
        return u32::from(scans);
    }

    if get > 1 || read16(system, info, 0x0c) != 1 || !DIB_BITS.contains(&bit_count) {
        return 0;
    }

    let left = height - i32::from(start);

    if left <= 0 {
        return 0;
    }

    let count = i32::from(scans).min(left);
    let stride = ((width * i32::from(bit_count) + 31) >> 5) << 2;
    let row_bytes = if colour {
        (width + 1) & !1
    } else {
        ((width + 15) & !15) >> 3
    };
    let table = offset_by(info, i32::from(read16(system, info, 0)));
    // A null translation table -- `gdidmdrw` hands one -- Windows would
    // fault on, and DOSBox reads at linear nought: WinBox takes every byte
    // of it as nought.
    let translated = |system: &System, n: i32| {
        if translate >> 16 != 0 {
            read8(system, translate, n)
        } else {
            0
        }
    };
    let layout = Bitmap {
        width_bytes: row_bytes as u16,
        format: if colour { BYTE_A_PIXEL } else { ONE_BIT },
        ..dest
    };

    for scan in 0..count {
        let y = height - 1 - (i32::from(start) + scan);
        let row = offset_by(bits, scan * stride);

        for x in 0..width {
            if get != 0 {
                let index = i32::from(layout.pixel(system, x, y));

                match bit_count {
                    24 => {
                        let entry = if colour {
                            index * 4
                        } else if index != 0 {
                            0x3fc
                        } else {
                            0
                        };

                        for k in 0..3 {
                            let byte = translated(system, entry + k);

                            write8(system, row, x * 3 + k, byte);
                        }
                    }
                    8 => {
                        let byte = if colour {
                            index as u8
                        } else {
                            translated(system, index)
                        };

                        write8(system, row, x, byte);
                    }
                    4 => {
                        let value = translated(system, index) & 0xf;
                        let byte = read8(system, row, x >> 1);
                        let shift = if x & 1 != 0 { 0 } else { 4 };

                        write8(
                            system,
                            row,
                            x >> 1,
                            (byte & !(0xf << shift)) | (value << shift),
                        );
                    }
                    _ => {
                        let set = if colour {
                            translated(system, index) != 0
                        } else {
                            translated(system, index) & 1 != 0
                        };
                        let byte = read8(system, row, x >> 3);
                        let mask = 0x80 >> (x & 7);

                        write8(
                            system,
                            row,
                            x >> 3,
                            if set { byte | mask } else { byte & !mask },
                        );
                    }
                }

                continue;
            }

            let value = if bit_count == 24 {
                let blue = read8(system, row, x * 3);
                let green = read8(system, row, x * 3 + 1);
                let red = read8(system, row, x * 3 + 2);
                let index = if translate >> 16 != 0 {
                    device_color_match_of(
                        system,
                        u32::from(red) << 16 | u32::from(green) << 8 | u32::from(blue),
                        translate,
                    ) as u8
                } else {
                    0
                };

                if colour { index } else { u8::from(index != 0) }
            } else {
                let n = i32::from(match bit_count {
                    8 => read8(system, row, x),
                    4 => (read8(system, row, x >> 1) >> if x & 1 != 0 { 0 } else { 4 }) & 0xf,
                    _ => (read8(system, row, x >> 3) >> (7 - (x & 7))) & 1,
                });
                let word = read16(system, table, n * 2);

                if colour {
                    word as u8
                } else if bit_count == 1 {
                    (word & 1) as u8
                } else {
                    ((word >> 8) & 1) as u8
                }
            };

            layout.put(system, x, y, value);
        }
    }

    count as u32
}

/// `DIBToDevice` (`SVGA256.DRV` seg9 `0dba`, into `0e1d`): onto a memory
/// bitmap nothing, and -1 (`0eae`-`0eb4`).
pub fn dib_to_device() -> u32 {
    0xffff
}

/* Pixel, ScanLR and EnumObj --------------------------------------------- */

/// A pixel or a scan off the bitmap (seg7 `00d1`, seg4 `01b8`).
const OFF_PIXEL: u32 = 0x8000_0000;
const OFF_SCAN: u16 = 0x8000;

/// What `Pixel` answers for a pixel got: `FF00h` in DX (seg7 `01da`, `01e7`).
const GOT: u32 = 0xff00_0000;

/// `Pixel` (`SVGA256.DRV` seg7 `0048`) on a memory bitmap, as in
/// `driver-vga256.ts`.
pub fn pixel(
    system: &mut System,
    device: u32,
    x: u16,
    y: u16,
    physical: u32,
    draw_mode: u32,
) -> u32 {
    let bitmap = read_bitmap(system, device);

    if x >= bitmap.width || y >= bitmap.height {
        return OFF_PIXEL;
    }

    let bytes = bitmap.format == BYTE_A_PIXEL;
    let byte_wise = bytes || bitmap.width_bytes & 1 != 0;
    let row = bitmap.row(i32::from(y));
    let at = if bytes {
        i32::from(x)
    } else {
        i32::from(x >> 3)
    };
    let there = read8(system, row, at);

    if draw_mode == 0 {
        if byte_wise {
            return GOT | u32::from(there);
        }

        return GOT
            | if there & (0x80 >> (x & 7)) != 0 {
                0xff
            } else {
                0
            };
    }

    let rop2 = read16(system, draw_mode, 0);

    if byte_wise {
        let pen = if bytes { physical as u8 } else { 1 };
        let value = (0..8).fold(0u8, |value, bit| {
            value | rop_bit(rop2, (pen >> bit) & 1, (there >> bit) & 1) << bit
        });

        write8(system, row, at, value);
        return 0;
    }

    let mask = 0x80u8 >> (x & 7);
    let bit = rop_bit(rop2, physical as u8 & 1, u8::from(there & mask != 0));

    write8(
        system,
        row,
        at,
        if bit != 0 {
            there | mask
        } else {
            there & !mask
        },
    );
    0
}

/// `ScanLR` (`SVGA256.DRV` seg4 `0154`) on a memory bitmap, as in
/// `driver-vga256.ts`.
pub fn scan_lr(system: &System, device: u32, x: u16, y: u16, physical: u32, style: u16) -> u16 {
    let bitmap = read_bitmap(system, device);

    if y >= bitmap.height || x >= bitmap.width {
        return OFF_SCAN;
    }

    if bitmap.format != BYTE_A_PIXEL {
        return mono_scan(system, device, x, y, (physical >> 8) & 1 != 0, style);
    }

    let row = bitmap.row(i32::from(y));
    let colour = physical as u8;
    let left = style & 2 != 0;
    let equal = style & 1 != 0;
    let count = if left {
        x.wrapping_add(1)
    } else {
        bitmap.width_bytes.wrapping_sub(x).wrapping_sub(1)
    };
    let mut at = i32::from(x);

    for _ in 0..count {
        if (read8(system, row, at) == colour) == equal {
            return at as u16;
        }

        at += if left { -1 } else { 1 };
    }

    0xffff
}

/// Where `SVGA256.DRV`'s `EnumObj` lays each object, up the stack from the
/// procedure's entry (seg4 `0086`-`00c3`).
pub const ENUMERATED_AT: u16 = 0x1c;

/// The driver's twenty colours, red, green and blue a colour (its data
/// segment at 22h).
const STATIC_COLOURS: [[u8; 3]; 20] = [
    [0x00, 0x00, 0x00],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x80, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0xc0, 0xdc, 0xc0],
    [0xa6, 0xca, 0xf0],
    [0xff, 0xfb, 0xf0],
    [0xa0, 0xa0, 0xa4],
    [0x80, 0x80, 0x80],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0xff, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0xff, 0xff, 0xff],
];

/// The colours `EnumObj` hands out, in its order (seg4 `00fa`-`0149`): the
/// last seven of the twenty, then the first thirteen.
pub fn enumerated_colours() -> Vec<u32> {
    STATIC_COLOURS[13..]
        .iter()
        .chain(&STATIC_COLOURS[..13])
        .map(|[red, green, blue]| u32::from(*red) | u32::from(*green) << 8 | u32::from(*blue) << 16)
        .collect()
}
