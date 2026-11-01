//! The Hercules's own `ColorInfo`, `RealizeObject`, `ExtTextOut` and
//! `GetCharWidth` on a memory bitmap, as `HERCULES.DRV` makes them for
//! GDI's helpers (`driver_helpers.rs`). The twin of
//! `src/win16/gdi/driver-hercules.ts`; the reading out of each is there.

use crate::system::System;

use super::driver_bitmap::{read8, read16, write8};

/// Whether the display is the Hercules's.
pub fn is_hercules(system: &System) -> bool {
    system
        .display
        .driver_file
        .eq_ignore_ascii_case("HERCULES.DRV")
}

fn read32(system: &System, far: u32, at: i32) -> u32 {
    u32::from(read16(system, far, at)) | u32::from(read16(system, far, at + 2)) << 16
}

fn write16(system: &mut System, far: u32, at: i32, value: u16) {
    write8(system, far, at, value as u8);
    write8(system, far, at + 1, (value >> 8) as u8);
}

/// The flags of a physical colour's top byte (seg1 `2bb6`).
const RED: u8 = 0x01;
const GREEN: u8 = 0x02;
const BLUE: u8 = 0x04;
const WHITE: u8 = 0x10;
const PURE: u8 = 0x20;
/// A colour whose red, green and blue come to this much or more is white
/// (`2bc5`).
const WHITE_SUM: u32 = 0x17e;

/// A colour made physical (seg1 `2bb6`), as `physicalOf`: the physical
/// colour and the sum of its red, green and blue.
fn physical_of(colour: u32) -> (u32, u32) {
    let [red, green, blue, _] = colour.to_le_bytes();
    let sum = u32::from(red) + u32::from(green) + u32::from(blue);
    let mut flags = if sum >= WHITE_SUM { WHITE } else { 0 }
        | if blue & 0x80 != 0 { BLUE } else { 0 }
        | if green & 0x80 != 0 { GREEN } else { 0 }
        | if red & 0x80 != 0 { RED } else { 0 }
        | PURE;

    if flags != PURE && flags != PURE | WHITE | BLUE | GREEN | RED {
        flags &= !PURE;
    }

    let channel = |flag: u8, shift: u32| if flags & flag != 0 { 0xff << shift } else { 0 };

    (
        channel(RED, 0) | channel(GREEN, 8) | channel(BLUE, 16) | u32::from(flags) << 24,
        sum,
    )
}

/// `ColorInfo` (seg1 `2d44`), as `herculesColorInfo`.
pub fn hercules_color_info(system: &mut System, colour: u32, buffer: u32) -> u32 {
    let mut top = (colour >> 24) as u8;

    if buffer != 0 {
        let (physical, _) = physical_of(colour);

        write16(system, buffer, 0, physical as u16);
        write16(system, buffer, 2, (physical >> 16) as u16);
        top = (physical >> 24) as u8;
    }

    if top & WHITE != 0 { 0x00ff_ffff } else { 0 }
}

/// Whether the Hercules takes a colour as white (seg1 `2bb6`).
pub fn hercules_white(colour: u32) -> bool {
    (physical_of(colour).0 >> 24) as u8 & WHITE != 0
}

const PEN_SIZE: u32 = 6;
const BRUSH_SIZE: u32 = 0x16;
const FONT_SIZE: u32 = 0;
/// What `RealizeObject` answers for style nought (seg1 `2d3b`).
const STYLE_NOUGHT: u32 = 0x2cc1;
/// The routine's offset in the display driver's table, which `Brute` leaves
/// in DX.
const REALIZE_OBJECT: u32 = 0x24;

/// Where a physical brush keeps its parts (seg1 `2b88`-`2b8b`, `2c92`).
pub const BRUSH_STYLE: i32 = 8;
const BRUSH_FLAGS: i32 = 0x0a;
const PATTERN_END: i32 = 0x0b;
pub const SECOND: i32 = 0x0e;

const SOLID: u16 = 0;
const HOLLOW: u16 = 1;
const HATCHED: u16 = 2;
pub const PATTERN: u16 = 3;
const ONE_COLOUR: u8 = 0x80;

/// The hatches (seg1 `2d07`), as the VGA's.
const HATCHES: [[u8; 8]; 6] = [
    [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
    [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
    [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
    [0x08, 0x08, 0x08, 0x08, 0xff, 0x08, 0x08, 0x08],
    [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/// Each group of four levels' four rows (seg1 `307f`).
const GROUPS: [[u8; 4]; 17] = [
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

/// For each group, the row and the pixel a level past its start sets (seg1
/// `305f`).
const STEPS: [(usize, u8); 16] = [
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

/// The first level of each group of sixteen (seg1 `305a`): black, the
/// three greys, white.
const BLACK: u8 = 4;
const WHITE_LEVEL: u8 = 5;
const EVEN_CODES: [u8; 5] = [BLACK, 1, 2, 3, WHITE_LEVEL];

/// The patterns of the greys at 16, 32 and 48 (seg1 `2c34`): the even rows'
/// byte and the odd rows'.
fn even(code: u8) -> (u8, u8) {
    match code {
        1 => (0x88, 0x22),
        2 => (0xaa, 0x55),
        _ => (0xdd, 0x77),
    }
}

/// A solid brush (seg1 `2bf0`), as `realizeSolid`: its style and flags.
fn realize_solid(system: &mut System, colour: u32, out: u32) -> (u16, u8) {
    let (physical, sum) = physical_of(colour);
    let mut flags = (physical >> 24) as u8 & WHITE;
    let grey = sum / 3;
    let level = ((grey >> 1) + (grey & 1)) >> 1;
    let group = (level >> 2) as usize;
    let mut rows = [0u8; 8];

    rows[..4].copy_from_slice(&GROUPS[group]);
    rows[4..].copy_from_slice(&GROUPS[group]);

    let step = level & 3;

    if step != 0 {
        let (row, pixel) = STEPS[group];
        let right = pixel >> 4;

        if step == 3 {
            rows[row] |= right;
        }

        if step >= 2 {
            rows[row + 4] |= right;
        }

        rows[row] |= pixel;
    } else if level % 16 == 0 {
        let code = EVEN_CODES[(level >> 4) as usize];

        if code == BLACK || code == WHITE_LEVEL {
            flags |= ONE_COLOUR;
        } else {
            let (even_row, odd_row) = even(code);

            for (at, row) in rows.iter_mut().enumerate() {
                *row = if at & 1 == 0 { even_row } else { odd_row };
            }
        }
    }

    for (at, row) in rows.iter().enumerate() {
        write8(system, out, at as i32, *row);
    }

    (SOLID, flags)
}

/// A hatched brush (seg1 `2c68`), as `realizeHatched`.
fn realize_hatched(system: &mut System, input: u32, out: u32, hatch: usize) -> (u16, u8) {
    let fore = (physical_of(read32(system, input, 2)).0 >> 24) as u8;
    let back = (physical_of(read32(system, input, 8)).0 >> 24) as u8;
    let ground = if back & WHITE != 0 { 0xff } else { 0 };

    for (at, row) in HATCHES[hatch].iter().enumerate() {
        write8(system, out, SECOND + at as i32, *row);
        write8(
            system,
            out,
            at as i32,
            if (fore ^ back) & WHITE != 0 {
                row ^ ground
            } else {
                ground
            },
        );
    }

    (HATCHED, 0)
}

/// A pattern brush (seg1 `2c3c`), as `realizePattern`.
fn realize_pattern(system: &mut System, input: u32, out: u32) -> (u16, u8) {
    let bitmap = read32(system, input, 2);
    let width_bytes = i32::from(read16(system, bitmap, 6));
    let bits = read32(system, bitmap, 0x0a);

    for row in 0..8 {
        let value = read8(system, bits, row * width_bytes);

        write8(system, out, row, value);
        write8(system, out, SECOND + row, value);
    }

    write16(system, out, PATTERN_END, 0xffff);
    (PATTERN, 0)
}

/// A brush turned to its origin (seg1 `2b8e`-`2ba9`), as `turnBrush`.
fn turn_brush(system: &mut System, out: u32, flags: u8, x: u16, y: u16) {
    if flags & 0xe0 == 0xe0 {
        return;
    }

    let by = u32::from(x & 7);
    let down = i32::from(y & 7);

    for at in [0, SECOND] {
        let rows: Vec<u8> = (0..8)
            .map(|row| read8(system, out, at + row).rotate_right(by))
            .collect();

        for (row, value) in rows.iter().enumerate() {
            write8(system, out, at + ((row as i32 + down) & 7), *value);
        }
    }
}

/// A brush (seg1 `2b73`), as `realizeBrush`.
fn realize_brush(system: &mut System, input: u32, out: u32, origin: u32) {
    let style = read16(system, input, 0);
    let (kept, flags) = if style == HOLLOW {
        (HOLLOW, 0xe0)
    } else if style == HATCHED && read16(system, input, 6) <= 5 {
        let hatch = usize::from(read16(system, input, 6));

        realize_hatched(system, input, out, hatch)
    } else if style == PATTERN {
        realize_pattern(system, input, out)
    } else {
        realize_solid(system, read32(system, input, 2), out)
    };

    write16(system, out, BRUSH_STYLE, kept);
    write8(system, out, BRUSH_FLAGS, flags);
    turn_brush(system, out, flags, origin as u16, (origin >> 16) as u16);
}

/// A pen (seg1 `2b4e`), as `realizePen`.
fn realize_pen(system: &mut System, input: u32, out: u32) {
    let style = read16(system, input, 0);
    let width = read16(system, input, 2);
    let (physical, kept) = if style == 5 {
        (REALIZE_OBJECT << 16, style)
    } else {
        (
            physical_of(read32(system, input, 6)).0,
            if width > 1 || style > 5 { 0 } else { style },
        )
    };

    write16(system, out, 0, physical as u16);
    write16(system, out, 2, (physical >> 16) as u16);
    write16(system, out, 4, kept);
}

/// `RealizeObject` (seg1 `2b08`), as `herculesRealizeObject`.
pub fn hercules_realize_object(
    system: &mut System,
    style: u16,
    input: u32,
    out: u32,
    xform: u32,
) -> u32 {
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

    [PEN_SIZE, BRUSH_SIZE, FONT_SIZE][(signed - 1) as usize]
}

/// What `ExtTextOut` answers where it cannot draw (seg1 `10cc`), as
/// `herculesExtTextOut`: every font of WinBox's.
pub const CANNOT: u32 = 0x8000_0000;

/// A font of 2.0's fields (seg1 `30f2`).
const DF_PIX_WIDTH: i32 = 0x56;
const DF_FIRST_CHAR: i32 = 0x5f;
const DF_LAST_CHAR: i32 = 0x60;
const DF_DEFAULT_CHAR: i32 = 0x61;
const TABLE_2: i32 = 0x76;

/// `GetCharWidth` (seg1 `30f2`), as `herculesGetCharWidth`.
pub fn hercules_get_char_width(
    system: &mut System,
    buffer: u32,
    first_asked: u16,
    last_asked: u16,
    font: u32,
) -> u32 {
    let segment = font & 0xffff_0000;
    let Ok(span) = usize::try_from(i32::from(last_asked.wrapping_sub(first_asked) as i16)) else {
        return 0;
    };
    let mut count = span + 1;
    let fixed = read16(system, segment, DF_PIX_WIDTH);
    let mut out = Vec::with_capacity(count);

    if fixed != 0 {
        out.resize(count, fixed);
    } else {
        let entry = |system: &System, index: i32| read16(system, segment, TABLE_2 + index * 4);
        let fallback = entry(system, i32::from(read8(system, segment, DF_DEFAULT_CHAR)));
        let mut index = i32::from(first_asked) - i32::from(read8(system, segment, DF_FIRST_CHAR));

        if index < 0 {
            let below = (-index as usize).min(count);

            out.resize(below, fallback);
            count -= below;
            index = 0;
        }

        let known = i32::from(read8(system, segment, DF_LAST_CHAR)) - index + 1;

        if known > 0 {
            let read = (known as usize).min(count);

            for at in 0..read {
                out.push(entry(system, index + at as i32));
            }

            count -= read;
        }

        out.extend(std::iter::repeat_n(fallback, count));
    }

    for (at, width) in out.iter().enumerate() {
        write16(system, buffer, at as i32 * 2, *width);
    }

    1
}

/// The pen styles' masks, taken from bit 7 (seg4 `001a`).
const HERCULES_STYLE_MASKS: [u8; 5] = [0xff, 0xe7, 0xaa, 0xe4, 0xea];

/// How far along its style each move takes a line (seg4 `0257`-`026b`),
/// and a bit of the mask (`016a`, `0b4f`).
const ACROSS: i32 = 0x0b;
const DOWN: i32 = 0x10;
const DIAGONAL: i32 = 0x13;
const STRETCH: i32 = 0x26;

/// Whether each pixel of a styled polyline is drawn as the Hercules walks
/// its style (seg4 `0b41`), as `herculesDashes` in the TypeScript: a count
/// from 26h less each move to the next pixel, the mask turned left a bit
/// and 26h added back where it has fallen below nought, a dash where the
/// mask's top bit is set.
pub fn hercules_dashes(points: &[(i32, i32)], end: (i32, i32), style: u16) -> Vec<bool> {
    let mut mask = HERCULES_STYLE_MASKS
        .get(usize::from(style))
        .copied()
        .unwrap_or(0xff);
    let mut count = STRETCH;

    points
        .iter()
        .enumerate()
        .map(|(index, &(x, y))| {
            if count < 0 {
                mask = mask.rotate_left(1);
                count += STRETCH;
            }

            let (nx, ny) = points.get(index + 1).copied().unwrap_or(end);
            let (across, down) = (nx != x, ny != y);

            count -= match (across, down) {
                (true, true) => DIAGONAL,
                (true, false) => ACROSS,
                (false, true) => DOWN,
                (false, false) => 0,
            };
            mask & 0x80 != 0
        })
        .collect()
}
