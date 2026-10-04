//! A device-independent bitmap, as a resource holds one: a header, a colour
//! table and rows of pixels, bottom row first, each padded to four bytes.
//!
//! Both documented headers are read, because Windows 3.1's own files use
//! both: the 12-byte core header, whose colour table has three bytes an
//! entry, and the 40-byte info header, with four. The display drivers keep
//! their OEM bitmaps in each. Pixels of 1, 4 and 8 bits are read,
//! uncompressed, or run-length encoded at 4 or 8 bits (`BI_RLE4`,
//! `BI_RLE8`), as the solitaire games of the corpus keep all their cards;
//! anything else is refused by name.

use crate::colour_match::{DisplayKind, matched_index};
use crate::device_bitmap::DeviceBitmap;
use crate::device_palette::Rgb;
use crate::indexed_context::SharedPalette;

/// A decoded DIB.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dib {
    pub width: i32,
    pub height: i32,
    pub bit_count: u16,
    /// The colour table, as red, green and blue.
    pub colours: Vec<Rgb>,
    /// Each pixel's colour table index, top row first.
    pub pixels: Vec<u8>,
}

const BI_RLE8: u32 = 1;
const BI_RLE4: u32 = 2;

/// A byte of the bitmap, 0 past its end, as the TypeScript engine's reads
/// past the end come to once they are stored as pixels.
fn byte(bytes: &[u8], at: usize) -> u8 {
    bytes.get(at).copied().unwrap_or(0)
}

fn header(bytes: &[u8], at: usize, length: usize) -> Result<&[u8], String> {
    bytes
        .get(at..at + length)
        .ok_or_else(|| "a bitmap header past the end of its bytes".to_string())
}

fn word(bytes: &[u8], at: usize) -> Result<u16, String> {
    let read = header(bytes, at, 2)?;

    Ok(u16::from_le_bytes([read[0], read[1]]))
}

fn dword(bytes: &[u8], at: usize) -> Result<u32, String> {
    let read = header(bytes, at, 4)?;

    Ok(u32::from_le_bytes([read[0], read[1], read[2], read[3]]))
}

pub fn decode_dib(bytes: &[u8]) -> Result<Dib, String> {
    let size = dword(bytes, 0)?;
    let core = size == 12;

    if !core && size < 40 {
        return Err(format!(
            "a bitmap header of {size} bytes is not one this reads"
        ));
    }

    let width = if core {
        i32::from(word(bytes, 4)?)
    } else {
        dword(bytes, 4)? as i32
    };
    let raw_height = if core {
        i32::from(word(bytes, 6)? as i16)
    } else {
        dword(bytes, 8)? as i32
    };
    let bit_count = word(bytes, if core { 10 } else { 14 })?;
    let compression = if core { 0 } else { dword(bytes, 16)? };
    let used = if core { 0 } else { dword(bytes, 32)? };
    let rle =
        (compression == BI_RLE8 && bit_count == 8) || (compression == BI_RLE4 && bit_count == 4);

    if compression != 0 && !rle {
        return Err(format!(
            "a bitmap compressed with method {compression} is not read here"
        ));
    }

    if !matches!(bit_count, 1 | 4 | 8) {
        return Err(format!(
            "a bitmap of {bit_count} bits a pixel is not read here"
        ));
    }

    let height = raw_height.unsigned_abs() as i32;
    let pixel_count = usize::try_from(i64::from(width) * i64::from(height))
        .map_err(|_| format!("a bitmap {width} by {height} has no pixels to hold"))?;
    let count = if used != 0 {
        used as usize
    } else {
        1 << bit_count
    };
    let entry = if core { 3 } else { 4 };
    let size = size as usize;
    let colours = (0..count)
        .map(|index| {
            let at = size + index * entry;

            [byte(bytes, at + 2), byte(bytes, at + 1), byte(bytes, at)]
        })
        .collect();
    let start = size + count * entry;
    let (width_pixels, height_rows) = (width.max(0) as usize, height as usize);

    if rle {
        return Ok(Dib {
            width,
            height,
            bit_count,
            colours,
            pixels: decode_rle(
                bytes,
                start,
                width_pixels,
                height_rows,
                raw_height > 0,
                bit_count,
            ),
        });
    }

    let stride = ((width_pixels * usize::from(bit_count)).div_ceil(32)) * 4;
    let mut pixels = vec![0; pixel_count];
    let bits = usize::from(bit_count);
    let per_byte = 8 / bits;
    let mask = ((1u16 << bit_count) - 1) as u8;

    for row in 0..height_rows {
        // Bottom row first, unless the height says the rows run top down.
        let from = start
            + if raw_height > 0 {
                height_rows - 1 - row
            } else {
                row
            } * stride;

        for x in 0..width_pixels {
            let value = byte(bytes, from + x / per_byte);
            let shift = 8 - bits * ((x % per_byte) + 1);

            pixels[row * width_pixels + x] = (value >> shift) & mask;
        }
    }

    Ok(Dib {
        width,
        height,
        bit_count,
        colours,
        pixels,
    })
}

/// Run-length encoded pixels (documented): pairs of a count and a value --
/// the value's index repeated, or for 4 bits its two indices in turn -- or
/// a nought and an escape: 0 ends a line, 1 ends the bitmap, 2 moves on by
/// the two bytes after it, across and up, and 3 or more is that many
/// indices given as they are, padded to a word. Lines run bottom first.
/// What is not reached stays index 0.
fn decode_rle(
    bytes: &[u8],
    start: usize,
    width: usize,
    height: usize,
    bottom_up: bool,
    bit_count: u16,
) -> Vec<u8> {
    let mut pixels = vec![0; width * height];
    let four = bit_count == 4;
    let mut at = start;
    let mut x = 0usize;
    let mut line = 0usize;
    let mut put = |x: &mut usize, line: usize, index: u8| {
        if *x < width && line < height {
            pixels[(if bottom_up { height - 1 - line } else { line }) * width + *x] = index;
        }

        *x += 1;
    };
    let nibble = |n: usize, value: u8| if n & 1 != 0 { value & 0x0f } else { value >> 4 };

    while at + 1 < bytes.len() && line < height {
        let count = bytes[at];
        let value = bytes[at + 1];

        at += 2;

        if count > 0 {
            for n in 0..usize::from(count) {
                put(&mut x, line, if four { nibble(n, value) } else { value });
            }

            continue;
        }

        match value {
            0 => {
                x = 0;
                line += 1;
            }
            1 => break,
            2 => {
                // A move past the end of the bytes ends the bitmap, as the
                // TypeScript engine's line, made no number, ends its loop.
                let (Some(&across), Some(&up)) = (bytes.get(at), bytes.get(at + 1)) else {
                    break;
                };

                x += usize::from(across);
                line += usize::from(up);
                at += 2;
            }
            _ => {
                let value = usize::from(value);
                let length = if four { value.div_ceil(2) } else { value };

                for n in 0..value {
                    let given = byte(bytes, at + if four { n >> 1 } else { n });

                    put(&mut x, line, if four { nibble(n, given) } else { given });
                }

                at += (length + 1) & !1;
            }
        }
    }

    pixels
}

/// A DIB as a device-dependent bitmap at a depth: each colour matched to
/// the palette of that depth, as a bitmap is realised for a display -- by
/// the display's driver's rule when the display is given, which is how
/// `CreateDIBitmap` matches a colour table (`dibmap`: all 256 colours as
/// `GetNearestColor` answers them), and otherwise the nearest. With a
/// palette realized where it is drawn, its nearest entries' slots
/// (`paldib`).
pub fn dib_to_device(
    dib: &Dib,
    depth: u8,
    palette: Option<SharedPalette>,
    display: Option<DisplayKind>,
    realized: Option<&dyn Fn(u8, u8, u8) -> usize>,
) -> DeviceBitmap {
    let bitmap = DeviceBitmap::new(dib.width, dib.height, depth, None, palette);
    let map: Vec<usize> = {
        let mut palette = bitmap.device_palette.borrow_mut();

        dib.colours
            .iter()
            .map(|&[red, green, blue]| match (realized, display) {
                (Some(realized), _) => realized(red, green, blue),
                (None, Some(display)) => matched_index(display, &mut palette, red, green, blue),
                (None, None) => palette.index(red, green, blue),
            })
            .collect()
    };

    for (pixel, &index) in bitmap.indices.borrow_mut().iter_mut().zip(&dib.pixels) {
        *pixel = map.get(usize::from(index)).copied().unwrap_or(0) as u8;
    }

    bitmap
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An info header for a DIB, and its colour table.
    fn info(width: i32, height: i32, bits: u16, compression: u32, colours: &[[u8; 3]]) -> Vec<u8> {
        let mut bytes = Vec::new();

        bytes.extend_from_slice(&40u32.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&bits.to_le_bytes());
        bytes.extend_from_slice(&compression.to_le_bytes());
        bytes.extend_from_slice(&[0; 12]);
        bytes.extend_from_slice(&(colours.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&[0; 4]);

        for [r, g, b] in colours {
            bytes.extend_from_slice(&[*b, *g, *r, 0]);
        }

        bytes
    }

    #[test]
    fn reads_a_core_header_bottom_row_first() {
        let mut bytes = Vec::new();

        bytes.extend_from_slice(&12u32.to_le_bytes());
        bytes.extend_from_slice(&3u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        // Black, then white, blue first.
        bytes.extend_from_slice(&[0, 0, 0, 0xff, 0xff, 0xff]);
        // Bottom row 101, top row 010, each padded to four bytes.
        bytes.extend_from_slice(&[0b1010_0000, 0, 0, 0, 0b0100_0000, 0, 0, 0]);

        let dib = decode_dib(&bytes).unwrap();

        assert_eq!((dib.width, dib.height, dib.bit_count), (3, 2, 1));
        assert_eq!(dib.colours, vec![[0, 0, 0], [0xff, 0xff, 0xff]]);
        assert_eq!(dib.pixels, vec![0, 1, 0, 1, 0, 1]);
    }

    #[test]
    fn reads_rows_top_down_for_a_negative_height() {
        let mut bytes = info(2, -2, 4, 0, &[[0, 0, 0]; 16]);

        bytes.extend_from_slice(&[0x12, 0, 0, 0, 0x34, 0, 0, 0]);
        assert_eq!(decode_dib(&bytes).unwrap().pixels, vec![1, 2, 3, 4]);
    }

    #[test]
    fn decodes_run_lengths() {
        // RLE8: three 5s, an end of line, a move of one across, two given
        // as they are, the end.
        let mut bytes = info(4, 2, 8, BI_RLE8, &[[0, 0, 0]; 8]);

        bytes.extend_from_slice(&[3, 5, 0, 0, 0, 2, 1, 0, 0, 3, 6, 7, 2, 0, 0, 1]);
        assert_eq!(
            decode_dib(&bytes).unwrap().pixels,
            vec![0, 6, 7, 2, 5, 5, 5, 0]
        );

        // RLE4: five pixels alternating 1 and 2, then three given.
        let mut bytes = info(8, 1, 4, BI_RLE4, &[[0, 0, 0]; 16]);

        bytes.extend_from_slice(&[5, 0x12, 0, 3, 0x34, 0x50, 0, 1]);
        assert_eq!(
            decode_dib(&bytes).unwrap().pixels,
            vec![1, 2, 1, 2, 1, 3, 4, 5]
        );
    }

    #[test]
    fn refuses_what_it_does_not_read() {
        assert!(decode_dib(&info(1, 1, 24, 0, &[])).is_err());
        assert!(decode_dib(&info(1, 1, 8, 3, &[])).is_err());
        assert!(decode_dib(&info(1, 1, 4, BI_RLE8, &[])).is_err());
        assert!(decode_dib(&20u32.to_le_bytes()).is_err());
    }

    #[test]
    fn matches_a_colour_table_to_a_device() {
        let mut bytes = info(2, 1, 1, 0, &[[0xc0, 0x80, 0], [0xc0, 0xc0, 0xc0]]);

        bytes.extend_from_slice(&[0b0100_0000, 0, 0, 0]);

        let dib = decode_dib(&bytes).unwrap();
        let vga = DisplayKind::default();

        // The driver's rule: c08000 is yellow; the nearest, olive.
        let matched = dib_to_device(&dib, 4, None, Some(vga), None);
        let nearest = dib_to_device(&dib, 4, None, None, None);
        let slots = dib_to_device(&dib, 8, None, None, Some(&|_, _, _| 200));

        assert_eq!(*matched.indices.borrow(), vec![11, 8]);
        assert_eq!(*nearest.indices.borrow(), vec![3, 8]);
        assert_eq!(*slots.indices.borrow(), vec![200, 200]);
    }
}
