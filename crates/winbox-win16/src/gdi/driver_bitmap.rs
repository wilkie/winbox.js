//! The VGA's own drawing on a memory bitmap of its format, as `VGA.DRV`
//! draws one for GDI's helpers (`driver_helpers.rs`): `RealizeObject`,
//! `BitBlt`, `Output`, `ExtTextOut` and `StrBlt`, `GetCharWidth`,
//! `DeviceBitmapBits` and `DIBScreenBlt`.
//!
//! A bitmap is GDI's `BITMAP` for drivers in the program's memory: four
//! planes of a bit (the word at 8 is 104h), a plane's row after another's
//! in each row, or one plane. Everything is drawn into that memory as the
//! driver addresses it, a byte at a row's start, the plane's row and the
//! eighth of x, with no bound to the bitmap's width or height: **recorded**
//! by `gdidmdrw`, a block transfer past the right-hand edge goes on into
//! the next plane's row, and past the last row into whatever is beyond.
//!
//! **Recorded** by `gdidmdrw` on the VGA, the Super VGA (`SUPERVGA.DRV`,
//! every record the VGA's) and the EGA.

use super::driver_hercules::{hercules_dashes, hercules_white, is_hercules};
use super::rle_runs::{RleWalk, huge_byte, odd_at, walk_rle};
use winbox_raster::DevicePalette;
use winbox_raster::colour_match::matched_index;
use winbox_raster::dither::dithered_index;
use winbox_raster::raster_op::combine;

use crate::system::System;

/// The word at 8 of a bitmap of the display's four planes of a bit each.
pub const FOUR_PLANES: u16 = 0x0104;

/// A physical colour's flag of a colour a monochrome bitmap takes as white
/// (seg1 `002c`).
pub const MONO_WHITE: u8 = 0x10;

/// The flag black and white carry besides (seg1 `002c`).
const PURE: u8 = 0x20;

/// A far pointer moved on within its segment.
pub fn offset_by(far: u32, at: i32) -> u32 {
    (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(at as u16))
}

pub fn read8(system: &System, far: u32, at: i32) -> u8 {
    system.cpu.bus.read8(system.linear(offset_by(far, at)))
}

pub fn read16(system: &System, far: u32, at: i32) -> u16 {
    u16::from(read8(system, far, at)) | u16::from(read8(system, far, at + 1)) << 8
}

fn signed16(system: &System, far: u32, at: i32) -> i32 {
    i32::from(read16(system, far, at) as i16)
}

pub(crate) fn read32(system: &System, far: u32, at: i32) -> u32 {
    u32::from(read16(system, far, at)) | u32::from(read16(system, far, at + 2)) << 16
}

pub fn write8(system: &mut System, far: u32, at: i32, value: u8) {
    let linear = system.linear(offset_by(far, at));

    system.cpu.bus.write8(linear, value);
}

pub(crate) fn write16(system: &mut System, far: u32, at: i32, value: u16) {
    write8(system, far, at, value as u8);
    write8(system, far, at + 1, (value >> 8) as u8);
}

/// A memory bitmap as a driver is handed it.
#[derive(Debug, Clone, Copy)]
pub struct DriverBitmap {
    pub width: u16,
    pub height: u16,
    pub width_bytes: u16,
    pub format: u16,
    pub bits: u32,
    pub segment_index: u16,
    pub scan_segment: u16,
}

pub fn read_bitmap(system: &System, far: u32) -> DriverBitmap {
    DriverBitmap {
        width: read16(system, far, 2),
        height: read16(system, far, 4),
        width_bytes: read16(system, far, 6),
        format: read16(system, far, 8),
        bits: read32(system, far, 0x0a),
        segment_index: read16(system, far, 0x16),
        scan_segment: read16(system, far, 0x18),
    }
}

impl DriverBitmap {
    pub fn planes(&self) -> i32 {
        if self.format == FOUR_PLANES { 4 } else { 1 }
    }

    /// Where a row starts (`VGA.DRV` seg7 `00e2`-`011a`): past as many
    /// segments as the rows before fill, each `bmSegmentIndex` selectors on
    /// from the last, and in its segment four planes' rows a row for the
    /// display's format, one for a monochrome bitmap. A row past the last
    /// is as far on again.
    pub fn row(&self, y: i32) -> u32 {
        let mut segment = (self.bits >> 16) as i32;
        let mut row = y;

        if self.segment_index != 0 && self.scan_segment != 0 {
            let segments = row.div_euclid(i32::from(self.scan_segment));

            segment = (segment + segments * i32::from(self.segment_index)) & 0xffff;
            row -= segments * i32::from(self.scan_segment);
        }

        let offset = ((self.bits & 0xffff) as i32
            + row * self.planes() * i32::from(self.width_bytes))
            & 0xffff;

        (segment as u32) << 16 | offset as u32
    }

    /// The byte of a pixel in a plane, and its bit: no bound to the width.
    fn place(&self, x: i32, y: i32, plane: i32) -> (u32, i32, u8) {
        (
            self.row(y),
            plane * i32::from(self.width_bytes) + (x >> 3),
            0x80 >> (x & 7),
        )
    }

    /// The bits of a pixel, one a plane.
    pub fn pixel(&self, system: &System, x: i32, y: i32) -> u8 {
        (0..self.planes()).fold(0, |value, plane| {
            let (row, at, mask) = self.place(x, y, plane);

            if read8(system, row, at) & mask != 0 {
                value | 1 << plane
            } else {
                value
            }
        })
    }

    /// A pixel's bits set, one a plane.
    fn put(&self, system: &mut System, x: i32, y: i32, value: u8) {
        for plane in 0..self.planes() {
            let (row, at, mask) = self.place(x, y, plane);
            let byte = read8(system, row, at);

            write8(
                system,
                row,
                at,
                if (value >> plane) & 1 != 0 {
                    byte | mask
                } else {
                    byte & !mask
                },
            );
        }
    }

    /// What a physical colour is as a pixel's bits: its index, or its flag
    /// for white.
    pub fn bits_of(&self, physical: u32) -> u8 {
        let top = (physical >> 24) as u8;

        if self.format == FOUR_PLANES {
            top & 0xf
        } else {
            u8::from(top & MONO_WHITE != 0)
        }
    }
}

/// The display drivers whose routines on a memory bitmap WinBox has: the
/// VGA's, which the Super VGA's driver shares record for record, and the
/// EGA's, the same code with its own colours (`gdidmdrw`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Vga,
    Ega,
}

pub fn family_of(system: &System) -> Option<Family> {
    match system.display.driver_file.to_ascii_uppercase().as_str() {
        "VGA.DRV" | "SUPERVGA.DRV" => Some(Family::Vga),
        "EGA.DRV" => Some(Family::Ega),
        _ => None,
    }
}

/// `VGA.DRV`'s colours, by index, as its `ColorInfo` gives them back (seg1
/// `003c`, three bytes each, red first): the sixteen of the VGA's palette.
/// `EGA.DRV`'s are the same but its ninth, `404040h` for `C0C0C0h` (seg1
/// `003c`).
pub const VGA_COLOURS: [[u8; 3]; 16] = [
    [0x00, 0x00, 0x00],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x80, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0x80, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0xff, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0xff, 0xff, 0xff],
];

/// The EGA's ninth colour.
const EGA_DARK_GREY: [u8; 3] = [0x40, 0x40, 0x40];

/// A driver's colour of an index.
pub fn colour_of(system: &System, index: u8) -> [u8; 3] {
    if index == 8 && family_of(system) == Some(Family::Ega) {
        EGA_DARK_GREY
    } else {
        VGA_COLOURS[usize::from(index & 0xf)]
    }
}

/// The flags each driver keeps beside each colour, in the top byte of its
/// physical colour with the index (seg1 `002c`): white on a monochrome
/// bitmap for light grey (the VGA's alone), green, yellow, magenta, cyan
/// and white, and the second flag for black and white.
pub fn flags_of(system: &System, index: u8) -> u8 {
    let white = match index {
        10 | 11 | 13 | 14 | 15 => true,
        8 => family_of(system) != Some(Family::Ega),
        _ => false,
    };

    (if white { MONO_WHITE } else { 0 }) | if index == 0 || index == 15 { PURE } else { 0 }
}

/// A driver's physical colour for an index: red, green and blue in the low
/// three bytes, the index and its flags in the top one (seg1 `19f4`).
pub fn physical_of(system: &System, index: u8) -> u32 {
    let [red, green, blue] = colour_of(system, index);

    u32::from(red)
        | u32::from(green) << 8
        | u32::from(blue) << 16
        | u32::from(index | flags_of(system, index)) << 24
}

/// The index the driver matches a colour to (seg1 `1956`).
pub fn matched_of(system: &System, colour: u32) -> u8 {
    let display = super::bitmaps::display_kind(system);
    let mut palette = DevicePalette::for_display(16, display.ega, false);

    matched_index(
        display,
        &mut palette,
        colour as u8,
        (colour >> 8) as u8,
        (colour >> 16) as u8,
    ) as u8
}

/* RealizeObject ------------------------------------------------------- */

/// The size of each object as `RealizeObject` lays it out, by style 1 to 3
/// (seg1 `2bdc`).
const SIZES: [u32; 3] = [6, 0x36, 0];

/// What `RealizeObject` answers for style nought: the style taken as an
/// index of the table of sizes one before its start, the word there (seg1
/// `2bda`, the last of the table of routines before it: the font's routine,
/// `2b3b` in `VGA.DRV` and `2b1f` in `EGA.DRV`).
fn style_nought(family: Family) -> u32 {
    match family {
        Family::Vga => 0x2b3b,
        Family::Ega => 0x2b1f,
    }
}

/// Where a physical brush keeps its parts (seg1 `28ed`-`28f3`, `2af1`).
const MONO_PLANE: i32 = 0x20;

/// Where a realized brush keeps the parts the drawing reads, as
/// `brushLayout`: the VGA's and the EGA's, or the Hercules's 22 bytes.
struct BrushLayout {
    mono: i32,
    style: i32,
    hatch: i32,
    pattern: bool,
    hatch_drawn: bool,
}

impl BrushLayout {
    fn of(system: &System) -> Self {
        if is_hercules(system) {
            Self {
                mono: 0,
                style: super::driver_hercules::BRUSH_STYLE,
                hatch: super::driver_hercules::SECOND,
                pattern: true,
                hatch_drawn: true,
            }
        } else {
            Self {
                mono: MONO_PLANE,
                style: BRUSH_STYLE,
                hatch: HATCH_MASK,
                pattern: false,
                hatch_drawn: false,
            }
        }
    }
}
const BRUSH_STYLE: i32 = 0x28;
const BRUSH_FLAGS: i32 = 0x2a;
const HATCH_MASK: i32 = 0x2e;

/// The brush's style word: solid, hollow, hatched, and the two patterns.
const SOLID: u16 = 0;
const HOLLOW: u16 = 1;
const HATCHED: u16 = 2;
const COLOUR_PATTERN: u16 = 3;
const MONO_PATTERN: u16 = 4;

/// The flag of a brush drawn in one colour, solid, whose planes need no
/// turning (seg1 `2996`).
const ONE_COLOUR: u8 = 0x80;

/// The hatches, eight rows of a byte each (seg1 `2ba6`): horizontal,
/// vertical, the two diagonals, cross and diagonal cross.
const HATCHES: [[u8; 8]; 6] = [
    [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
    [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
    [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
    [0x08, 0x08, 0x08, 0x08, 0xff, 0x08, 0x08, 0x08],
    [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/// The routine's offset in the display driver's table, which `Brute`
/// leaves in DX (seg13 `0171`).
const REALIZE_OBJECT: u32 = 0x24;

/// A pen (seg1 `28b6`): its physical colour, then its style -- solid for a
/// pen wider than a pixel or of a style past `PS_NULL`. A null pen's colour
/// is not matched: AX nought, as the routine's start left it, and DX the
/// routine's offset, as `Brute` left it.
fn realize_pen(system: &mut System, input: u32, out: u32) {
    let style = read16(system, input, 0);
    let width = read16(system, input, 2);
    let (physical, kept) = if style == 5 {
        (REALIZE_OBJECT << 16, style)
    } else {
        let index = matched_of(system, read32(system, input, 6));

        (
            physical_of(system, index),
            if width > 1 || style > 5 { 0 } else { style },
        )
    };

    write16(system, out, 0, physical as u16);
    write16(system, out, 2, (physical >> 16) as u16);
    write16(system, out, 4, kept);
}

/// A plane of eight rows, a byte each, laid at `at`.
fn write_rows(system: &mut System, out: u32, at: i32, rows: [u8; 8]) {
    for (index, row) in rows.iter().enumerate() {
        write8(system, out, at + index as i32, *row);
    }
}

/// The monochrome plane of a colour (seg1 `210e`): the colour's pattern on
/// a bitmap of one plane, as `dither.rs` has the VGA's.
fn mono_rows(system: &System, red: u8, green: u8, blue: u8) -> [u8; 8] {
    let display = super::bitmaps::display_kind(system);
    let mut palette = DevicePalette::mono();
    let mut rows = [0; 8];

    for (y, row) in rows.iter_mut().enumerate() {
        for x in 0..8 {
            let white = dithered_index(display, &mut palette, red, green, blue, x, y as i32)
                .unwrap_or_else(|| palette.index(red, green, blue));

            *row |= u8::from(white != 0) << (7 - x);
        }
    }

    rows
}

/// A solid brush (seg1 `292a`). White and black are each one byte in every
/// plane, flagged `FFh` and `E0h`. Any other colour: the monochrome plane its
/// pattern, and the colour planes the colour's index where the device has
/// the colour -- flagged with its physical colour's top byte and 80h -- or
/// the VGA's pattern of it (`dither.rs`), flagged with the nearest colour's
/// top byte. A colour of 10E0E0E0h, flagged for the driver, is on the VGA
/// the checkerboard of light grey and white (`2957`-`2979`); the EGA's has
/// no such case (`EGA.DRV` seg1 `2938`). Answers the flags.
fn realize_solid(system: &mut System, colour: u32, out: u32) -> u8 {
    let [red, green, blue] = [colour as u8, (colour >> 8) as u8, (colour >> 16) as u8];

    if red & green & blue == 0xff || red | green | blue == 0 {
        let byte = if red != 0 { 0xff } else { 0 };

        for at in 0..0x28 {
            write8(system, out, at, byte);
        }

        return if red != 0 { 0xff } else { 0xe0 };
    }

    let flags = if family_of(system) == Some(Family::Vga)
        && (colour >> 24) & 0x10 != 0
        && red == 0xe0
        && green == 0xe0
        && blue == 0xe0
    {
        for at in 0..0x18 {
            write8(system, out, at, if at & 1 != 0 { 0xaa } else { 0x55 });
        }

        for at in 0x18..0x20 {
            write8(system, out, at, 0xff);
        }

        0x3f
    } else {
        let index = matched_of(system, colour);
        let physical = physical_of(system, index);
        let flags = (physical >> 24) as u8 & 0x7f;

        if physical & 0xff_ffff == colour & 0xff_ffff {
            for plane in 0..4 {
                let byte = if (index >> plane) & 1 != 0 { 0xff } else { 0 };

                write_rows(system, out, plane * 8, [byte; 8]);
            }

            flags | ONE_COLOUR
        } else {
            let display = super::bitmaps::display_kind(system);
            let mut palette = DevicePalette::for_display(16, display.ega, false);
            let mut planes = [[0u8; 8]; 4];

            for y in 0..8 {
                for x in 0..8 {
                    let at = dithered_index(display, &mut palette, red, green, blue, x, y)
                        .unwrap_or(usize::from(index));

                    for (plane, rows) in planes.iter_mut().enumerate() {
                        rows[y as usize] |= (((at >> plane) & 1) as u8) << (7 - x);
                    }
                }
            }

            for (plane, rows) in planes.iter().enumerate() {
                write_rows(system, out, plane as i32 * 8, *rows);
            }

            flags
        }
    };
    let rows = mono_rows(system, red, green, blue);

    write_rows(system, out, MONO_PLANE, rows);
    flags
}

/// A hatched brush (seg1 `2ab9`): each plane, and the monochrome one, the
/// hatch where the brush's colour and the background colour after the
/// logical brush (at 8) differ in it, else the bit they share; at 2Eh the
/// hatch as a plane whose colour is nought and background 1 would have it,
/// the background's pixels set (`2af1`).
fn realize_hatched(system: &mut System, input: u32, out: u32, hatch: usize) {
    let fore_index = matched_of(system, read32(system, input, 2));
    let back_index = matched_of(system, read32(system, input, 8));
    let fore = (physical_of(system, fore_index) >> 24) as u8;
    let back = (physical_of(system, back_index) >> 24) as u8;
    let rows = HATCHES[hatch];

    for plane in 0..5 {
        let f = (fore >> plane) & 1;
        let b = (back >> plane) & 1;
        let plane_rows = rows.map(|row| {
            if f == b {
                if f != 0 { 0xff } else { 0 }
            } else if b != 0 {
                !row
            } else {
                row
            }
        });

        write_rows(system, out, plane * 8, plane_rows);
    }

    write_rows(system, out, HATCH_MASK, rows.map(|row| !row));
}

/// A pattern brush (seg1 `2a20`), its logical brush's colour a far pointer
/// to the bitmap: the first byte of each of its first eight rows. A bitmap
/// of four planes gives each plane, and the monochrome plane of each
/// pixel's colour; a monochrome one gives its rows to every plane, and is
/// drawn in the text and background colours.
fn realize_pattern(system: &mut System, input: u32, out: u32) -> u16 {
    let bitmap = read_bitmap(system, read32(system, input, 2));
    let colour = bitmap.format & 0xff == 4;
    let planes = if colour { 4 } else { 1 };
    let stride = i32::from(bitmap.width_bytes) * planes;

    for plane in 0..(if colour { 4 } else { 5 }) {
        let from = if colour { plane } else { 0 };
        let mut rows = [0; 8];

        for (y, row) in rows.iter_mut().enumerate() {
            *row = read8(
                system,
                bitmap.bits,
                y as i32 * stride + from * i32::from(bitmap.width_bytes),
            );
        }

        write_rows(system, out, plane * 8, rows);
    }

    if colour {
        for y in 0..8 {
            let mut row = 0;

            for x in 0..8 {
                let mut index = 0;

                for plane in 0..4 {
                    index |= ((read8(system, out, plane * 8 + y) >> (7 - x)) & 1) << plane;
                }

                row |= u8::from(flags_of(system, index) & MONO_WHITE != 0) << (7 - x);
            }

            write8(system, out, MONO_PLANE + y, row);
        }
    }

    write8(system, out, 0x2b, 0xff);
    write8(system, out, 0x2c, 0xff);

    if colour { COLOUR_PATTERN } else { MONO_PATTERN }
}

/// A brush turned to its origin (seg1 `2b3c`, `2b63`), the low word of the
/// `TEXTXFORM`'s pointer its x and the high its y: each byte turned right
/// by x and each plane's rows down by y, modulo eight. A brush of one
/// colour has only its monochrome plane turned; white and black, none.
fn turn_brush(system: &mut System, out: u32, flags: u8, x: u16, y: u16) {
    if flags & 0xe0 == 0xe0 {
        return;
    }

    let mut blocks = if flags & ONE_COLOUR != 0 {
        vec![MONO_PLANE]
    } else {
        vec![0, 8, 16, 24, MONO_PLANE]
    };

    if read16(system, out, BRUSH_STYLE) == HATCHED {
        blocks.push(HATCH_MASK);
    }

    let by = u32::from(x & 7);
    let down = i32::from(y & 7);

    for at in blocks {
        let mut rows = [0u8; 8];

        for (row, byte) in rows.iter_mut().enumerate() {
            *byte = read8(system, out, at + row as i32).rotate_right(by);
        }

        for (row, byte) in rows.iter().enumerate() {
            write8(system, out, at + ((row as i32 + down) & 7), *byte);
        }
    }
}

fn realize_brush(system: &mut System, input: u32, out: u32, origin: u32) {
    let style = read16(system, input, 0);
    let mut kept = if style <= 3 { style } else { SOLID };
    let flags;

    if kept == HOLLOW {
        flags = 0xe0;
    } else if kept == HATCHED && read16(system, input, 6) <= 5 {
        realize_hatched(system, input, out, usize::from(read16(system, input, 6)));
        flags = 0;
    } else if kept == COLOUR_PATTERN {
        kept = realize_pattern(system, input, out);
        flags = 0;
    } else {
        kept = SOLID;
        flags = realize_solid(system, read32(system, input, 2), out);
    }

    write16(system, out, BRUSH_STYLE, kept);
    write8(system, out, BRUSH_FLAGS, flags);
    turn_brush(system, out, flags, origin as u16, (origin >> 16) as u16);
}

/// `RealizeObject` (`VGA.DRV` seg1 `286e`): a style below nought (deleting
/// an object) answers 1; nought answers the word before the table of sizes;
/// past 3, nought. With an object to fill, the pen, brush or font laid out;
/// the answer is the object's size, a font's nought.
pub fn realize_object(system: &mut System, style: u16, input: u32, out: u32, xform: u32) -> u32 {
    let signed = style as i16;

    if signed < 0 {
        return 1;
    }

    if signed == 0 {
        return style_nought(family_of(system).unwrap_or(Family::Vga));
    }

    if signed > 3 {
        return 0;
    }

    if out != 0 {
        match signed {
            1 => realize_pen(system, input, out),
            2 => realize_brush(system, input, out, xform),
            _ => {}
        }
    }

    SIZES[signed as usize - 1]
}

/* BitBlt ---------------------------------------------------------------- */

/// A `DRAWMODE`'s fields the routines read.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DrawMode {
    pub rop2: u16,
    pub bk_mode: u16,
    pub bk_color: u32,
    pub text_color: u32,
    pub break_extra: i32,
    pub break_err: i32,
    pub break_rem: i32,
    pub break_count: i32,
    pub character_extra: i32,
}

pub(crate) fn read_draw_mode(system: &System, far: u32) -> DrawMode {
    DrawMode {
        rop2: read16(system, far, 0),
        bk_mode: read16(system, far, 2),
        bk_color: read32(system, far, 4),
        text_color: read32(system, far, 8),
        break_extra: signed16(system, far, 0x0e),
        break_err: signed16(system, far, 0x10),
        break_rem: signed16(system, far, 0x12),
        break_count: signed16(system, far, 0x14),
        character_extra: signed16(system, far, 0x16),
    }
}

/// The brush's bits at a pixel, by x and y modulo eight: each colour
/// plane's for a bitmap of four planes, the monochrome plane's for one; a
/// monochrome pattern's bit in the background colour where set and the
/// text colour where not.
fn brush_pixel(
    system: &System,
    brush: u32,
    bitmap: &DriverBitmap,
    mode: Option<&DrawMode>,
    x: i32,
    y: i32,
) -> u8 {
    let mask = 0x80 >> (x & 7);
    let row = y & 7;

    if bitmap.format != FOUR_PLANES {
        let layout = BrushLayout::of(system);
        let set = read8(system, brush, layout.mono + row) & mask != 0;

        // The Hercules's pattern is drawn as a monochrome one, in the
        // `DRAWMODE`'s colours (**recorded** by `gdidmdrw`).
        if layout.pattern
            && let Some(mode) = mode
            && read16(system, brush, layout.style) == COLOUR_PATTERN
        {
            return bitmap.bits_of(if set { mode.bk_color } else { mode.text_color });
        }

        return u8::from(set);
    }

    if let Some(mode) = mode
        && read16(system, brush, BRUSH_STYLE) == MONO_PATTERN
    {
        let set = read8(system, brush, row) & mask != 0;

        return bitmap.bits_of(if set { mode.bk_color } else { mode.text_color });
    }

    (0..4).fold(0, |value, plane| {
        if read8(system, brush, plane * 8 + row) & mask != 0 {
            value | 1 << plane
        } else {
            value
        }
    })
}

/// A source's pixel carried to the destination's format: from a
/// monochrome source, white as the background colour and black as the text
/// colour; from a colour source to a monochrome destination, white where it
/// is the background colour.
fn carried(dest: &DriverBitmap, source: &DriverBitmap, value: u8, mode: Option<&DrawMode>) -> u8 {
    let dest_colour = dest.format == FOUR_PLANES;
    let source_colour = source.format == FOUR_PLANES;

    match mode {
        Some(mode) if dest_colour != source_colour => {
            if dest_colour {
                dest.bits_of(if value != 0 {
                    mode.bk_color
                } else {
                    mode.text_color
                })
            } else {
                u8::from(value == source.bits_of(mode.bk_color))
            }
        }
        _ => value,
    }
}

/// `BitBlt` (`VGA.DRV` seg1 `0466`) on a memory bitmap: each pixel of the
/// rectangle combined from the brush, the source and itself by the raster
/// operation's table, plane by plane. Nothing is clipped. The source is read
/// whole before anything is written, as a copy within one bitmap reads it.
/// Answers 1.
#[allow(clippy::too_many_arguments, clippy::many_single_char_names)]
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
    let dest = read_bitmap(system, dest_far);
    let source = (source_far != 0).then(|| read_bitmap(system, source_far));
    let mode = (draw_mode != 0).then(|| read_draw_mode(system, draw_mode));
    let table = (rop >> 16) as u8;
    let (w, h) = (i32::from(width as i16), i32::from(height as i16));
    let (dx, dy) = (i32::from(x as i16), i32::from(y as i16));
    let mask = if dest.format == FOUR_PLANES { 0xf } else { 1 };

    if w <= 0 || h <= 0 {
        return 1;
    }

    let mut sources = Vec::new();

    if let Some(source) = &source {
        for row in 0..h {
            for column in 0..w {
                let value = source.pixel(
                    system,
                    i32::from(sx as i16) + column,
                    i32::from(sy as i16) + row,
                );

                sources.push(carried(&dest, source, value, mode.as_ref()));
            }
        }
    }

    for row in 0..h {
        for column in 0..w {
            let (px, py) = (dx + column, dy + row);
            let p = if brush != 0 {
                brush_pixel(system, brush, &dest, mode.as_ref(), px, py)
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

/* Output ---------------------------------------------------------------- */

/// The styles of `Output` the VGA draws (seg1 `284e`).
const OS_SCANLINES: u16 = 4;
const OS_POLYLINE: u16 = 18;

/// The pen styles' masks, a bit for each stretch along the line from bit
/// nought (seg6 `0056`): solid, dash, dot, dash-dot and dash-dot-dot. The
/// driver keeps each beside its own reverse, for a line it draws from the
/// other end, which comes to the same bits.
pub(crate) const STYLE_MASKS: [u8; 5] = [0xff, 0xe7, 0x55, 0x27, 0x57];

/// How far along its style a pixel moves a line (seg6 `0350`-`038f`): 40h
/// a step along a line whose rise is no more than 40h/55h of its run, else
/// 55h; a bit of the mask is 100h.
const FLAT_STEP: i32 = 0x40;
const STEEP_STEP: i32 = 0x55;

/// A pixel set by a `DRAWMODE`'s binary raster operation of a colour's
/// bits and the pixel's.
pub(crate) fn mix(rop2: u16, pen: u8, there: u8, planes: i32) -> u8 {
    let table = rop2.wrapping_sub(1) & 0xf;

    (0..planes).fold(0, |out, plane| {
        let index = (((pen >> plane) & 1) << 1) | ((there >> plane) & 1);

        out | (((table >> index) & 1) as u8) << plane
    })
}

/// The pixels of a polyline a pixel wide as the VGA walks it: at each step
/// along the longer axis the pixel nearest the line, a tie to the smaller
/// y, each segment's last point left for the next; each with where it is
/// along the pen's style. The style goes on from one segment into the next
/// (seg6 `03a8`-`03ad`), each segment moving it by its step times its
/// longer span.
pub(crate) fn polyline_pixels(points: &[(i32, i32)]) -> Vec<(i32, i32, i32)> {
    let mut out = Vec::new();
    let mut style = 0;

    for pair in points.windows(2) {
        let ((from_x, from_y), (to_x, to_y)) = (pair[0], pair[1]);
        let (dx, dy) = (to_x - from_x, to_y - from_y);
        let across = dx.abs() >= dy.abs();
        let steps = if across { dx.abs() } else { dy.abs() };
        let along = if STEEP_STEP * dy.abs() <= FLAT_STEP * dx.abs() {
            FLAT_STEP
        } else {
            STEEP_STEP
        };

        if steps == 0 {
            continue;
        }

        let major = if (if across { dx } else { dy }) > 0 {
            1
        } else {
            -1
        };
        let minor = if across { dy } else { dx };
        let up = i32::from(across || dx * dy > 0);

        for step in 0..steps {
            let offset = (2 * minor * step + steps - up).div_euclid(2 * steps);
            let at = (style + along * step) & 0xffff;

            out.push(if across {
                (from_x + major * step, from_y + offset, at)
            } else {
                (from_x + offset, from_y + major * step, at)
            });
        }

        style = (style + along * steps) & 0xffff;
    }

    out
}

pub(crate) fn read_point(system: &System, far: u32, index: i32) -> (i32, i32) {
    (
        signed16(system, far, index * 4),
        signed16(system, far, index * 4 + 2),
    )
}

/// A rectangle as left, top, right and bottom.
pub(crate) type Rect = (i32, i32, i32, i32);

pub(crate) fn read_rect(system: &System, far: u32) -> Rect {
    (
        signed16(system, far, 0),
        signed16(system, far, 2),
        signed16(system, far, 4),
        signed16(system, far, 6),
    )
}

/// `Output` (`VGA.DRV` seg1 `284e`): a polyline (`OS_POLYLINE`, seg6
/// `00a0`) and scanlines (`OS_SCANLINES`, seg8 `006e`); any other style
/// answers -1 and draws nothing, which leaves it to GDI.
///
/// * A polyline: its pixels, inside the clipping rectangle, in the pen's
///   colour under the `DRAWMODE`'s raster operation; a styled pen's gaps in
///   the background colour where the background is opaque. Answers 1.
/// * Scanlines: the first point the count of them and the row, each after
///   a pair of x, from the first to before the second, in the brush under
///   the raster operation -- the pen's colour with no brush -- and a
///   hatched brush's hatch alone where the background is transparent. Not
///   clipped. Answers nought.
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
    let planes = dest.planes();

    if style == OS_POLYLINE {
        let path: Vec<_> = (0..i32::from(count as i16))
            .map(|index| read_point(system, points, index))
            .collect();
        let pen_style = read16(system, pen, 4);
        let bits = STYLE_MASKS
            .get(usize::from(pen_style))
            .copied()
            .unwrap_or(0xff);
        let ink = dest.bits_of(read32(system, pen, 0));
        let gap = (mode.bk_mode == 2).then(|| dest.bits_of(mode.bk_color));
        // The Hercules's polyline is not cut to the rectangle (**recorded**
        // by `gdidmdrw`).
        let (left, top, right, bottom) = if clip != 0 && !is_hercules(system) {
            read_rect(system, clip)
        } else {
            (0, 0, i32::from(dest.width), i32::from(dest.height))
        };

        if pen_style == 5 {
            return 1;
        }

        let pixels = polyline_pixels(&path);
        // The Hercules walks its style in steps of its own
        // (`driver_hercules.rs`).
        let dashes = (is_hercules(system) && !path.is_empty()).then(|| {
            let points: Vec<_> = pixels.iter().map(|&(px, py, _)| (px, py)).collect();

            hercules_dashes(&points, path[path.len() - 1], pen_style)
        });

        for (index, &(px, py, at)) in pixels.iter().enumerate() {
            if px < left || px >= right || py < top || py >= bottom {
                continue;
            }

            let on = match &dashes {
                Some(dashes) => dashes[index],
                None => (bits >> ((at >> 8) & 7)) & 1 != 0,
            };
            let colour = match (on, gap) {
                (true, _) => ink,
                (false, Some(gap)) => gap,
                (false, None) => continue,
            };
            let there = dest.pixel(system, px, py);

            dest.put(system, px, py, mix(mode.rop2, colour, there, planes));
        }

        return 1;
    }

    if style == OS_SCANLINES {
        let (lines, y) = read_point(system, points, 0);
        let ink = dest.bits_of(read32(system, pen, 0));
        // A hatched brush on a transparent background draws its hatch alone.
        let layout = BrushLayout::of(system);
        let see_through =
            brush != 0 && mode.bk_mode == 1 && read16(system, brush, layout.style) == HATCHED;

        for index in 1..lines {
            let (from, to) = read_point(system, points, index);

            for px in from..to {
                // The VGA keeps its hatch's mask clear where the hatch is
                // drawn; the Hercules keeps the hatch's own rows.
                if see_through
                    && (read8(system, brush, layout.hatch + (y & 7)) & (0x80 >> (px & 7)) != 0)
                        != layout.hatch_drawn
                {
                    continue;
                }

                let p = if brush != 0 {
                    brush_pixel(system, brush, &dest, Some(&mode), px, y)
                } else {
                    ink
                };
                let there = dest.pixel(system, px, y);

                dest.put(system, px, y, mix(mode.rop2, p, there, planes));
            }
        }

        return 0;
    }

    // The Hercules answers nought for any other style (seg1 `2b02`).
    if is_hercules(system) { 0 } else { 0xffff }
}

/* ExtTextOut, StrBlt and GetCharWidth ---------------------------------- */

/// Where a font's `FONTINFO` lies in its segment, the file's header before
/// it, and its version.
const FONTINFO_AT: u32 = 0x42;
const VERSION_3: u16 = 0x300;

/// The fields of a font the text routines read, by their place in the
/// segment.
const DF_WEIGHT: i32 = 0x53;
const DF_PIX_WIDTH: i32 = 0x56;
const DF_PIX_HEIGHT: i32 = 0x58;
const DF_FIRST_CHAR: i32 = 0x5f;
const DF_LAST_CHAR: i32 = 0x60;
const DF_DEFAULT_CHAR: i32 = 0x61;
const DF_BREAK_CHAR: i32 = 0x62;
const DF_BITS_POINTER: i32 = 0x6d;

/// A character's entry, by its index from the first: six bytes in a font
/// of 3.0, four before.
pub(crate) fn entry_of(system: &System, segment: u32, index: i32) -> i32 {
    if read16(system, segment, 0) >= VERSION_3 {
        0x94 + index * 6
    } else {
        0x76 + index * 4
    }
}

/// What `ExtTextOut` answers where it draws nothing it can: AX nought and
/// DX 8000h (seg2 `089b`).
const CANNOT: u32 = 0x8000_0000;

/// A font emboldened by the `TEXTXFORM`: asked for 700 or more of one
/// lighter (seg2 `0862`-`087a`).
fn emboldened(system: &System, segment: u32, xform: u32) -> bool {
    read16(system, xform, 8) >= 700 && read16(system, segment, DF_WEIGHT) < 700
}

/// A character as the driver lays it: its index from the first, its
/// glyph's width and where it starts.
pub(crate) struct Laid {
    pub index: i32,
    pub width: i32,
    pub at: i32,
}

/// A string's characters as the driver lays them (seg2 `0c4b`-`0ce6`):
/// each one's index from the first character -- the default character's
/// for one outside the font -- its glyph's width and where it starts. Each
/// moves the next on by its width, or the width given for it but the last,
/// then the character extra; the break character by the break extra too,
/// and by one more each time the break error, less the remainder, falls to
/// nought, the break count then added back. Answers the characters and how
/// far the farthest of their glyphs and advances reach.
#[allow(clippy::too_many_arguments)]
pub(crate) fn lay_out(
    system: &System,
    segment: u32,
    string: u32,
    count: i32,
    mode: &mut DrawMode,
    extra: i32,
    widths: u32,
) -> (Vec<Laid>, i32) {
    let first = read8(system, segment, DF_FIRST_CHAR);
    let span = read8(system, segment, DF_LAST_CHAR).wrapping_sub(first);
    let fallback = read8(system, segment, DF_DEFAULT_CHAR);
    let break_char = read8(system, segment, DF_BREAK_CHAR);
    let mut out = Vec::new();
    let (mut at, mut reach) = (0, 0);

    for i in 0..count {
        let mut index = read8(system, string, i).wrapping_sub(first);

        if index > span {
            index = fallback;
        }

        let mut advance = extra;

        if index == break_char && (mode.break_extra != 0 || mode.break_rem != 0) {
            advance += mode.break_extra;

            if mode.break_rem > 0 {
                mode.break_err -= mode.break_rem;

                if mode.break_err <= 0 {
                    mode.break_err += mode.break_count;
                    advance += 1;
                }
            } else if mode.break_rem < 0 {
                mode.break_err -= mode.break_rem;

                if mode.break_err >= 0 {
                    mode.break_err -= mode.break_count;
                    advance -= 1;
                }
            }
        }

        let width = i32::from(read16(
            system,
            segment,
            entry_of(system, segment, i32::from(index)),
        ));

        if widths != 0 && i != count - 1 {
            advance += signed16(system, widths, i * 2) - width;
        }

        out.push(Laid {
            index: i32::from(index),
            width,
            at,
        });
        at += width;
        reach = reach.max(at);
        at += advance;
        reach = reach.max(at);
    }

    (out, reach)
}

/// A rectangle's intersection, or `None` where it is empty.
pub(crate) fn within(a: Rect, b: Rect) -> Option<Rect> {
    let rect = (a.0.max(b.0), a.1.max(b.1), a.2.min(b.2), a.3.min(b.3));

    (rect.2 > rect.0 && rect.3 > rect.1).then_some(rect)
}

/// `ExtTextOut` (`VGA.DRV` seg2 `0837`, the 386's) on a memory bitmap.
/// Only a font of version 3.0 laid out as GDI loads one, its `FONTINFO` at
/// 42h of its segment; any other answers 80000000h and draws nothing.
///
/// * A negative count answers the string's extent, its height in the high
///   word: the characters' widths, the character extra for each and the
///   break extra for each break character, and one more for an emboldened
///   font (seg2 `0b8a`-`0c40`).
/// * Otherwise the string is drawn at x and y, its cell the font's height:
///   the clipping rectangle, cut to the opaque rectangle with
///   `ETO_CLIPPED`; the opaque rectangle filled with the background colour,
///   inside the clip, with `ETO_OPAQUE`; and each glyph set in the text
///   colour where its bit is set, the rest of the string's cell in the
///   background colour where the background is opaque. An emboldened font's
///   glyphs are each set again a pixel to the right, and each character is
///   a pixel wider. Answers nought.
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
    xform: u32,
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
    let bold = i32::from(emboldened(system, segment, xform));
    let extra = mode.character_extra + if widths != 0 { 0 } else { bold };
    let height = i32::from(read16(system, segment, DF_PIX_HEIGHT));
    let n = i32::from(count as i16);

    if n < 0 {
        let (_, reach) = lay_out(system, segment, string, -n, &mut mode, extra, 0);

        write16(system, draw_mode, 0x10, mode.break_err as u16);
        return (height as u32) << 16 | ((reach + bold).min(0x7fff) as u32 & 0xffff);
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

    let back = dest.bits_of(mode.bk_color);
    let fore = dest.bits_of(mode.text_color);

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
    let extent = reach + bold;
    let mut ink = vec![false; (extent.max(0) * height) as usize];
    let bits = read32(system, segment, DF_BITS_POINTER) & 0xffff_0000;

    for Laid { index, width, at } in characters {
        let entry = entry_of(system, segment, index);
        let glyph = bits | (read32(system, segment, entry + 2) & 0xffff);

        for column in 0..width {
            for row in 0..height {
                let byte = read8(system, glyph, (column >> 3) * height + row);

                if byte & (0x80 >> (column & 7)) != 0 {
                    for smear in 0..=bold {
                        let px = at + column + smear;

                        if px >= 0 && px < extent {
                            ink[(row * extent + px) as usize] = true;
                        }
                    }
                }
            }
        }
    }

    let Some(cell) =
        text_box.and_then(|text_box| within(text_box, (dx, dy, dx + extent, dy + height)))
    else {
        return 0;
    };

    for py in cell.1..cell.3 {
        for px in cell.0..cell.2 {
            if ink[((py - dy) * extent + (px - dx)) as usize] {
                dest.put(system, px, py, fore);
            } else if mode.bk_mode == 2 {
                dest.put(system, px, py, back);
            }
        }
    }

    write16(system, draw_mode, 0x10, mode.break_err as u16);
    0
}

/// `GetCharWidth` (`VGA.DRV` seg1 `17dc`): from the first character asked
/// to the last, each width into the buffer, two more each for an
/// emboldened font; a fixed font's width for every one. Below the font's
/// first character, the default character's width. From there, the font's
/// table read on for as many as the font's last character -- its code, not
/// its index -- less the index allows, past the table's end where the
/// request goes beyond the font; and the last width read for any left.
/// Answers 1, and nought for a last below the first. `SVGA256.DRV`'s
/// (seg1 `0358`) is the same but for the emboldening, which it does not add
/// (`emboldens`).
pub fn get_char_width(
    system: &mut System,
    buffer: u32,
    first_asked: u16,
    last_asked: u16,
    font: u32,
    xform: u32,
    emboldens: bool,
) -> u32 {
    let segment = font & 0xffff_0000;
    let bold = if emboldens && emboldened(system, segment, xform) {
        2
    } else {
        0
    };
    let mut count = i32::from(last_asked) - i32::from(first_asked);

    if count < 0 {
        return 0;
    }

    count += 1;

    let mut out = Vec::new();
    let fixed = read16(system, segment, DF_PIX_WIDTH);

    if fixed != 0 {
        out.resize(count as usize, fixed.wrapping_add(bold));
    } else {
        let default_entry = entry_of(
            system,
            segment,
            i32::from(read8(system, segment, DF_DEFAULT_CHAR)),
        );
        let fallback = read16(system, segment, default_entry).wrapping_add(bold);
        let mut index = i32::from(first_asked) - i32::from(read8(system, segment, DF_FIRST_CHAR));
        let mut last = fallback;

        if index < 0 {
            let below = (-index).min(count);

            out.extend(std::iter::repeat_n(fallback, below as usize));
            count -= below;
            index = 0;
        }

        let known = i32::from(read8(system, segment, DF_LAST_CHAR)) - index;

        if known >= 0 {
            let read = (known + 1).min(count);

            for i in 0..read {
                let entry = entry_of(system, segment, index + i);

                last = read16(system, segment, entry).wrapping_add(bold);
                out.push(last);
            }

            count -= read;
        }

        out.extend(std::iter::repeat_n(last, count.max(0) as usize));
    }

    for (i, width) in out.into_iter().enumerate() {
        write16(system, buffer, i as i32 * 2, width);
    }

    1
}

/* DeviceBitmapBits and DIBScreenBlt ------------------------------------ */

/// A DIB's pixel formats the driver takes (seg9 `078d`-`07ad`).
const DIB_BITS: [u16; 4] = [1, 4, 8, 24];

/// `DeviceBitmapBits` (`VGA.DRV` seg9 `0d1e`) on a memory bitmap: scans of
/// it got as a DIB or set from one, of 1, 4, 8 or 24 bits a pixel and
/// uncompressed; a compressed one is handed to the driver's own reading of
/// run lengths, not followed here (answers nought). The scans are counted
/// from the DIB's bottom, as its header's height has them: from `start`, as
/// many as asked that the height leaves. Answers how many, nought for a
/// start at or past the height or another format.
///
/// * Got (seg9 `0764`): each pixel its index, or for a DIB of a bit its
///   flag of white (`flags_of`); the colours the VGA's sixteen (seg9
///   `0000`) and nought after them, or for a monochrome bitmap or a DIB of
///   a bit, black but the last, white. The header's `biSizeImage` is made
///   the whole DIB's size and `biClrUsed` nought. With no buffer for the
///   bits, only the count.
/// * Set (seg9 `0048`): each pixel's colour, the DIB's own or its colour
///   table's, matched to the VGA's (`matched_of`), and on a monochrome
///   bitmap white where that colour is.
#[allow(clippy::too_many_arguments)]
pub fn device_bitmap_bits(
    system: &mut System,
    bitmap_far: u32,
    get: u16,
    start: u16,
    scans: u16,
    bits: u32,
    info: u32,
) -> u32 {
    let dest = read_bitmap(system, bitmap_far);
    let colour = dest.format == FOUR_PLANES;
    let width = read32(system, info, 4) as i32;
    let height = read32(system, info, 8) as i32;
    let bit_count = read16(system, info, 0x0e);

    // A compressed DIB to the routine of run lengths, export 501 (`0d35`),
    // whose get is not followed here.
    if read8(system, info, 0x10) != 0 {
        return if get == 0 && bits != 0 && !is_hercules(system) {
            rle_set(system, &dest, start, bits, info)
        } else {
            0
        };
    }

    if get > 1 || (get == 0 && bits == 0) {
        return 0;
    }

    if read16(system, info, 0x0c) != 1 || !DIB_BITS.contains(&bit_count) {
        return 0;
    }

    let left = height - i32::from(start);

    if left <= 0 {
        return 0;
    }

    let count = i32::from(scans).min(left);
    let stride = ((width * i32::from(bit_count) + 31) >> 5) << 2;
    let table = offset_by(info, i32::from(read16(system, info, 0)));
    let entries = if bit_count == 24 { 0 } else { 1 << bit_count };

    if get != 0 {
        write16(system, info, 0x20, 0);
        write16(system, info, 0x22, 0);

        for entry in 0..entries {
            let rgb = if bit_count == 1 || !colour {
                if entry == entries - 1 {
                    [0xff; 3]
                } else {
                    [0; 3]
                }
            } else if entry < 16 {
                colour_of(system, entry as u8)
            } else {
                [0; 3]
            };

            write8(system, table, entry * 4, rgb[2]);
            write8(system, table, entry * 4 + 1, rgb[1]);
            write8(system, table, entry * 4 + 2, rgb[0]);
            write8(system, table, entry * 4 + 3, 0);
        }
    }

    if bits != 0 {
        for scan in 0..count {
            let y = height - 1 - (i32::from(start) + scan);
            let row = offset_by(bits, scan * stride);

            for x in 0..width {
                if get != 0 {
                    get_pixel(system, &dest, row, x, y, bit_count);
                } else {
                    set_pixel(system, &dest, row, table, x, y, bit_count);
                }
            }
        }
    }

    if get != 0 {
        let size = ((((i32::from(bit_count) * width + 0x1f) & 0xffe0) >> 3) * height) as u32;

        write16(system, info, 0x14, size as u16);
        write16(system, info, 0x16, (size >> 16) as u16);
    }

    count as u32
}

/// A run-length encoded DIB set into a memory bitmap by `VGA.DRV`'s export
/// 501 (seg9 `12ec`, the set from `13ff`), which `DeviceBitmapBits` hands
/// it with a rectangle from nought to the bitmap's width and height and
/// the same rectangle to clip to (`0d42`-`0d90`): so nothing is clipped
/// (`1325`-`134a`). The first line is the bitmap's row
/// `height - 1 - start` (`13e6`-`13f6`) and the count is not read; the
/// stream is walked to its end (`walk_rle`), each pixel's bits put as the
/// driver addresses them, a plane's row after another's with no bound to
/// the width or the height (`1ad8`, `1a6a`, `19f6`). Each index's colour
/// is its entry's in the table -- `biClrUsed` of them, 256 at most or
/// where nought (`1449`-`148e`) -- matched to the VGA's (`2915`), or on a
/// monochrome bitmap its flag of white (`1dd9`). Answers 1 (`15ac`).
/// **Recorded** by `gdidmrle`.
fn rle_set(system: &mut System, dest: &DriverBitmap, start: u16, bits: u32, info: u32) -> u32 {
    let colour = dest.format == FOUR_PLANES;
    let used = read16(system, info, 0x20);
    let count = if used == 0 { 256 } else { used.min(256) };
    let table = offset_by(info, i32::from(read16(system, info, 0)));
    let physical: Vec<u8> = (0..i32::from(count))
        .map(|entry| {
            let index = matched_of(
                system,
                u32::from(read8(system, table, entry * 4 + 2))
                    | u32::from(read8(system, table, entry * 4 + 1)) << 8
                    | u32::from(read8(system, table, entry * 4)) << 16,
            );

            if colour {
                index
            } else {
                u8::from(flags_of(system, index) & MONO_WHITE != 0)
            }
        })
        .collect();
    let walk = RleWalk {
        eight: read8(system, info, 0x10) == 1,
        x: 0,
        y: i32::from(dest.height) - 1 - i32::from(start),
        top: None,
    };
    let mut pixels = Vec::new();

    walk_rle(
        &walk,
        &mut |at| huge_byte(system, bits, at),
        &|at| odd_at(bits, at),
        &mut |x, y, index| pixels.push((x, y, index)),
    );

    for (x, y, index) in pixels {
        dest.put(
            system,
            x,
            y,
            physical.get(usize::from(index)).copied().unwrap_or(0),
        );
    }

    1
}

/// A pixel of a bitmap written into a DIB's row (seg9 `0764`): its index,
/// or for a DIB of a bit its flag of white; a monochrome bitmap's black and
/// white as its table's first and last.
fn get_pixel(system: &mut System, dest: &DriverBitmap, row: u32, x: i32, y: i32, bit_count: u16) {
    let colour = dest.format == FOUR_PLANES;
    let index = dest.pixel(system, x, y);
    let lit = index != 0;

    match bit_count {
        24 => {
            let [red, green, blue] = if colour {
                colour_of(system, index)
            } else if lit {
                [0xff; 3]
            } else {
                [0; 3]
            };

            write8(system, row, x * 3, blue);
            write8(system, row, x * 3 + 1, green);
            write8(system, row, x * 3 + 2, red);
        }
        8 => {
            let byte = if colour {
                index
            } else if lit {
                0xff
            } else {
                0
            };

            write8(system, row, x, byte);
        }
        4 => {
            let value = if colour {
                index
            } else if lit {
                0xf
            } else {
                0
            };
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
            let white = if colour {
                flags_of(system, index) & MONO_WHITE != 0
            } else {
                lit
            };
            let byte = read8(system, row, x >> 3);
            let mask = 0x80 >> (x & 7);

            write8(
                system,
                row,
                x >> 3,
                if white { byte | mask } else { byte & !mask },
            );
        }
    }
}

/// A pixel of a bitmap set from a DIB's row (seg9 `0048`): its colour, the
/// DIB's own or its table's, matched to the display's, and on a monochrome
/// bitmap white where that colour is.
fn set_pixel(
    system: &mut System,
    dest: &DriverBitmap,
    row: u32,
    table: u32,
    x: i32,
    y: i32,
    bit_count: u16,
) {
    let rgb = if bit_count == 24 {
        u32::from(read8(system, row, x * 3 + 2))
            | u32::from(read8(system, row, x * 3 + 1)) << 8
            | u32::from(read8(system, row, x * 3)) << 16
    } else {
        let index = i32::from(match bit_count {
            8 => read8(system, row, x),
            4 => (read8(system, row, x >> 1) >> if x & 1 != 0 { 0 } else { 4 }) & 0xf,
            _ => (read8(system, row, x >> 3) >> (7 - (x & 7))) & 1,
        });

        u32::from(read8(system, table, index * 4 + 2))
            | u32::from(read8(system, table, index * 4 + 1)) << 8
            | u32::from(read8(system, table, index * 4)) << 16
    };
    if is_hercules(system) {
        dest.put(system, x, y, u8::from(hercules_white(rgb)));
        return;
    }

    let index = matched_of(system, rgb);
    let value = if dest.format == FOUR_PLANES {
        index
    } else {
        u8::from(flags_of(system, index) & MONO_WHITE != 0)
    };

    dest.put(system, x, y, value);
}

/// `DIBScreenBlt` (`VGA.DRV` seg9 `0e2a`) on a memory bitmap: nothing
/// drawn, nought answered. **Recorded** by `gdidmdrw`.
pub fn dib_to_device() -> u32 {
    0
}
