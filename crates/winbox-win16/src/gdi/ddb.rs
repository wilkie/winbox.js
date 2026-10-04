//! A device-dependent bitmap's bits, in the shape a program sees them.
//!
//! `CreateBitmap`, `SetBitmapBits` and `GetBitmapBits` hand bits across in
//! rows padded to a whole number of 16-bit words, each pixel `depth` bits,
//! the leftmost in the most significant. **Recorded** by `bitbits` for
//! monochrome bitmaps: at widths of 8, 16, 24, 32 and 40 pixels a row is 2,
//! 2, 4, 4 and 6 bytes, a set bit is white, and bits made that way come back
//! in the same order.
//!
//! A sixteen-colour display keeps a colour bitmap in four planes of a bit a
//! pixel: each row is its four planes in turn, plane `p` bit `p` of each
//! pixel's colour index, and each plane's row padded to a word. **Recorded**
//! by `patmono` on the VGA, the EGA and the Super VGA, from `GetBitmapBits`
//! of a bitmap filled and `SetBitmapBits` read back a pixel at a time. A
//! 256-colour display's is taken as one plane of a byte a pixel, not
//! recorded.
//!
//! winbox.js keeps a device bitmap as one palette index a pixel (see
//! `DeviceBitmap`), so the bits are packed and unpacked here, at the edge.
//!
//! The bits past the last pixel of a row are kept as well, apart from the
//! pixels: `bitbits` made bitmaps whose padding held a counting pattern, and
//! `GetBitmapBits` gave the padding back as it was given. Drawing never
//! touches it.

use winbox_raster::DeviceBitmap;

/// One of GDI's bitmaps: its pixels, the padding of its rows as a program
/// last wrote it, and the dimension `SetBitmapDimension` gave it.
#[derive(Debug, Clone)]
pub struct Bitmap {
    pub pixels: DeviceBitmap,
    /// The bits past each row's last pixel, every plane's, made when first
    /// written: none reads as noughts.
    pub padding: Option<Vec<u8>>,
    /// Its size in tenths of a millimetre, where set: nought by nought
    /// until then.
    pub dimension: Option<(i16, i16)>,
}

/// Two are the same bitmap where they share their pixels, as two
/// TypeScript references to one object are the same.
impl PartialEq for Bitmap {
    fn eq(&self, other: &Self) -> bool {
        std::rc::Rc::ptr_eq(&self.pixels.indices, &other.pixels.indices)
            && self.padding == other.padding
            && self.dimension == other.dimension
    }
}

impl Bitmap {
    pub fn new(pixels: DeviceBitmap) -> Self {
        Self {
            pixels,
            padding: None,
            dimension: None,
        }
    }
}

/// How many bytes a program's row of a bitmap takes: words, not
/// doublewords.
pub fn row_bytes(bits: i64, width: i64) -> i64 {
    ((bits * width + 15) >> 4) << 1
}

/// A bitmap's planes and bits a pixel, as `GetObject` tells them: a shape
/// no device context takes as it was made; a sixteen-colour bitmap as the
/// display's four planes of one bit; any other one plane of its depth.
pub fn format_of(bitmap: &DeviceBitmap) -> (u16, u16) {
    if let Some(shape) = &bitmap.shape {
        return (shape.planes, shape.bits);
    }

    if bitmap.depth == 4 {
        (4, 1)
    } else {
        (1, u16::from(bitmap.depth))
    }
}

/// How many bytes a bitmap's bits take, every plane of every row. Worked
/// out as the TypeScript engine works it, so a negative side gives a size
/// of nought or less.
pub fn bits_size(bitmap: &DeviceBitmap) -> i64 {
    let (planes, bits) = format_of(bitmap);

    row_bytes(i64::from(bits), i64::from(bitmap.width()))
        * i64::from(planes)
        * i64::from(bitmap.height())
}

/// The bits of byte `column` of a row that lie past its last pixel.
fn padding_mask(depth: i64, width: i64, column: i64) -> u8 {
    let first = width * depth - column * 8;

    if first <= 0 {
        0xff
    } else if first >= 8 {
        0
    } else {
        0xff >> first
    }
}

/// `at` over `by`, rounded down, as the TypeScript engine's `Math.floor`
/// rounds it: a bitmap of negative width and height has a negative row
/// length, and its rows count down from -1, not from nought.
fn floor_div(at: i64, by: i64) -> i64 {
    let quotient = at / by;

    if at % by != 0 && (at < 0) != (by < 0) {
        quotient - 1
    } else {
        quotient
    }
}

/// Whether the bitmap is laid out in the display's four planes.
fn planar(bitmap: &DeviceBitmap) -> bool {
    bitmap.shape.is_none() && bitmap.depth == 4
}

/// Which row, plane and byte of the plane's row byte `at` of a planar
/// bitmap is.
fn plane_byte(bitmap: &DeviceBitmap, at: i64) -> (i64, i64, i64) {
    let per_plane = row_bytes(1, i64::from(bitmap.width()));
    let line = per_plane * 4;
    let within = at % line;

    (
        floor_div(at, line),
        floor_div(within, per_plane),
        within % per_plane,
    )
}

/// The padding a program left at `at`, nought where it never wrote any.
fn padding_at(bitmap: &Bitmap, at: i64) -> u8 {
    bitmap
        .padding
        .as_ref()
        .and_then(|padding| padding.get(usize::try_from(at).ok()?))
        .copied()
        .unwrap_or(0)
}

/// Keeps the padding a program wrote at `at`.
fn keep_padding(bitmap: &mut Bitmap, at: i64, value: u8) {
    let size = usize::try_from(bits_size(&bitmap.pixels)).unwrap_or(0);
    let padding = bitmap.padding.get_or_insert_with(|| vec![0; size]);

    if let Some(slot) = usize::try_from(at).ok().and_then(|at| padding.get_mut(at)) {
        *slot = value;
    }
}

/// The index at a pixel, nought outside the bitmap.
fn index_at(bitmap: &DeviceBitmap, x: i64, y: i64) -> u8 {
    bitmap.index_at(x as i32, y as i32).unwrap_or(0)
}

/// The byte at `at` of the bitmap as a program would read it.
pub fn read_byte(bitmap: &Bitmap, at: i64) -> u8 {
    let pixels = &bitmap.pixels;
    let width = i64::from(pixels.width());

    if let Some(shape) = &pixels.shape {
        return usize::try_from(at)
            .ok()
            .and_then(|at| shape.bytes.get(at))
            .copied()
            .unwrap_or(0);
    }

    if planar(pixels) {
        let (row, plane, column) = plane_byte(pixels, at);
        let mut byte = padding_at(bitmap, at) & padding_mask(1, width, column);

        for slot in 0..8 {
            let x = column * 8 + slot;

            if x < width {
                byte |= ((index_at(pixels, x, row) >> plane) & 1) << (7 - slot);
            }
        }

        return byte;
    }

    let depth = i64::from(pixels.depth);
    let per_row = row_bytes(depth, width);
    let (row, column) = (floor_div(at, per_row), at % per_row);
    let per_byte = 8 / depth;
    let mask = ((1u32 << depth) - 1) as u8;
    let mut byte = padding_at(bitmap, at) & padding_mask(depth, width, column);

    for slot in 0..per_byte {
        let x = column * per_byte + slot;
        let index = if x < width {
            index_at(pixels, x, row)
        } else {
            0
        };

        byte |= (index & mask) << (8 - depth * (slot + 1));
    }

    byte
}

/// Stores the byte at `at` of the bitmap as a program wrote it.
pub fn write_byte(bitmap: &mut Bitmap, at: i64, value: u8) {
    let width = i64::from(bitmap.pixels.width());

    if let Some(shape) = &mut bitmap.pixels.shape {
        if let Some(slot) = usize::try_from(at)
            .ok()
            .and_then(|at| shape.bytes.get_mut(at))
        {
            *slot = value;
        }

        return;
    }

    if planar(&bitmap.pixels) {
        let (row, plane, column) = plane_byte(&bitmap.pixels, at);

        keep_padding(bitmap, at, value & padding_mask(1, width, column));

        let pixels = &bitmap.pixels;

        pixels.context.mark_rect(
            (column * 8) as i32,
            row as i32,
            ((column + 1) * 8) as i32,
            (row + 1) as i32,
        );

        let mut indices = pixels.indices.borrow_mut();

        for slot in 0..8 {
            let x = column * 8 + slot;

            if let Ok(pixel) = usize::try_from(pixels.context.address(x as i32, row as i32))
                && let Some(index) = indices.get_mut(pixel)
            {
                let bit = (value >> (7 - slot)) & 1;

                *index = (*index & !(1 << plane)) | (bit << plane);
            }
        }

        return;
    }

    let depth = i64::from(bitmap.pixels.depth);
    let per_row = row_bytes(depth, width);
    let (row, column) = (floor_div(at, per_row), at % per_row);
    let per_byte = 8 / depth;
    let mask = ((1u32 << depth) - 1) as u8;

    keep_padding(bitmap, at, value & padding_mask(depth, width, column));

    let pixels = &bitmap.pixels;

    pixels.context.mark_rect(
        (column * per_byte) as i32,
        row as i32,
        ((column + 1) * per_byte) as i32,
        (row + 1) as i32,
    );

    let mut indices = pixels.indices.borrow_mut();

    for slot in 0..per_byte {
        let x = column * per_byte + slot;

        if let Ok(pixel) = usize::try_from(pixels.context.address(x as i32, row as i32))
            && let Some(index) = indices.get_mut(pixel)
        {
            *index = (value >> (8 - depth * (slot + 1))) & mask;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn made(width: i32, height: i32, depth: u8) -> Bitmap {
        Bitmap::new(DeviceBitmap::new(width, height, depth, None, None))
    }

    #[test]
    fn pads_rows_to_words() {
        // `bitbits`: 8, 16, 24, 32 and 40 pixels a row are 2, 2, 4, 4 and 6
        // bytes.
        for (width, row) in [(8, 2), (16, 2), (24, 4), (32, 4), (40, 6)] {
            assert_eq!(row_bytes(1, width), row);
        }

        assert_eq!(bits_size(&made(24, 3, 1).pixels), 12);
        assert_eq!(bits_size(&made(16, 4, 4).pixels), 32);
        assert_eq!(format_of(&made(1, 1, 4).pixels), (4, 1));
        assert_eq!(format_of(&made(1, 1, 8).pixels), (1, 8));
    }

    #[test]
    fn gives_back_the_bits_and_padding_it_was_given() {
        // `bitbits`, created at eight pixels wide: the bytes come back as
        // they went in, the padding byte of each row too.
        let mut bitmap = made(8, 3, 1);

        for at in 0..6 {
            write_byte(&mut bitmap, at, at as u8 + 1);
        }

        let read: Vec<u8> = (0..6).map(|at| read_byte(&bitmap, at)).collect();

        assert_eq!(read, [1, 2, 3, 4, 5, 6]);
        // A set bit is white, the leftmost pixel the most significant.
        assert_eq!(bitmap.pixels.index_at(6, 0), Some(0));
        assert_eq!(bitmap.pixels.index_at(7, 0), Some(1));
    }

    #[test]
    fn rounds_rows_down_as_math_floor_does() {
        assert_eq!(floor_div(1, -2), -1);
        assert_eq!(floor_div(-1, 2), -1);
        assert_eq!(floor_div(4, -2), -2);
        assert_eq!(floor_div(5, 2), 2);
        // A bitmap -20 by -3 has rows of -2 bytes and six bytes of bits:
        // its padding is kept as any bitmap's is.
        let mut bitmap = made(-20, -3, 1);

        assert_eq!(bits_size(&bitmap.pixels), 6);
        write_byte(&mut bitmap, 1, 0x5a);
        assert_eq!(read_byte(&bitmap, 1), 0x5a);
    }

    #[test]
    fn lays_a_colour_bitmap_out_in_four_planes() {
        let mut bitmap = made(8, 1, 4);

        bitmap.pixels.put(0, 0, 0b1010);
        bitmap.pixels.put(7, 0, 0b0101);
        // Each plane's row a word: plane 0 holds bit 0 of each pixel.
        assert_eq!(read_byte(&bitmap, 0), 0x01);
        assert_eq!(read_byte(&bitmap, 2), 0x80);
        assert_eq!(read_byte(&bitmap, 4), 0x01);
        assert_eq!(read_byte(&bitmap, 6), 0x80);
        write_byte(&mut bitmap, 6, 0x40);
        assert_eq!(bitmap.pixels.index_at(0, 0), Some(0b0010));
        assert_eq!(bitmap.pixels.index_at(1, 0), Some(0b1000));
        // The byte after a plane's eight pixels is padding, kept.
        write_byte(&mut bitmap, 7, 0x5a);
        assert_eq!(read_byte(&bitmap, 7), 0x5a);
    }
}
