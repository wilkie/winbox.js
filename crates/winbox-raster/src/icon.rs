//! Icons and cursors, as winbox.js's raster layer reads them: a group's
//! entries, the one that fits a display, and its picture as the display's
//! palette indices and a mask.

use crate::DevicePalette;

/// An icon's picture: an index of the display's palette a pixel, and its
/// mask, 1 where the screen beneath shows through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconData {
    pub width: usize,
    pub height: usize,
    pub xor: Vec<u8>,
    pub and: Vec<u8>,
}

/// A cursor's picture and where its point is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorImage {
    pub icon: IconData,
    pub hotspot: (u16, u16),
}

/// An entry of an icon group's directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IconEntry {
    pub width: usize,
    pub height: usize,
    pub colours: u32,
    pub bit_count: u16,
    pub id: u16,
}

fn word(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([
        bytes.get(at).copied().unwrap_or(0),
        bytes.get(at + 1).copied().unwrap_or(0),
    ])
}

fn dword(bytes: &[u8], at: usize) -> u32 {
    u32::from(word(bytes, at)) | u32::from(word(bytes, at + 2)) << 16
}

/// An icon group's entries: each fourteen bytes after a six-byte header.
pub fn icon_entries(group: &[u8]) -> Vec<IconEntry> {
    (0..usize::from(word(group, 4)))
        .map(|at| {
            let offset = 6 + at * 14;
            let byte = |at: usize| group.get(offset + at).copied().unwrap_or(0);

            IconEntry {
                width: if byte(0) == 0 {
                    256
                } else {
                    usize::from(byte(0))
                },
                height: if byte(1) == 0 {
                    256
                } else {
                    usize::from(byte(1))
                },
                colours: u32::from(byte(2)),
                bit_count: word(group, offset + 6),
                id: word(group, offset + 12),
            }
        })
        .collect()
}

/// The icon of a group for a display: of its size, and as many colours as
/// the display has or the most below that. Not measured: which a display
/// takes when a group has none of its size.
pub fn pick_icon(entries: &[IconEntry], size: usize, display_colours: u32) -> Option<IconEntry> {
    let colours = |entry: &IconEntry| {
        if entry.colours != 0 {
            entry.colours
        } else {
            1u32 << (if entry.bit_count == 0 {
                4
            } else {
                entry.bit_count.min(31)
            })
        }
    };
    let sized: Vec<IconEntry> = entries
        .iter()
        .filter(|entry| entry.width == size && entry.height == size)
        .copied()
        .collect();
    let candidates = if sized.is_empty() {
        entries.to_vec()
    } else {
        sized
    };
    let fitting: Vec<IconEntry> = candidates
        .iter()
        .filter(|entry| colours(entry) <= display_colours)
        .copied()
        .collect();
    let pool = if fitting.is_empty() {
        candidates
    } else {
        fitting
    };
    let first = *pool.first()?;

    Some(pool.iter().fold(first, |best, entry| {
        if colours(entry) > colours(&best) {
            *entry
        } else {
            best
        }
    }))
}

/// An icon resource, its colours matched to a display's palette: bottom
/// row first, in both halves.
pub fn decode_icon(bytes: &[u8], palette: &mut DevicePalette) -> IconData {
    let size = dword(bytes, 0) as usize;
    let width = dword(bytes, 4) as i32 as usize;
    let height = (dword(bytes, 8) as i32 / 2) as usize;
    let bit_count = usize::from(word(bytes, 14)).max(1);
    let used = dword(bytes, 32) as usize;
    let count = if bit_count <= 8 {
        if used != 0 { used } else { 1 << bit_count }
    } else {
        0
    };
    let byte = |at: usize| bytes.get(at).copied().unwrap_or(0);
    let map: Vec<u8> = (0..count)
        .map(|at| {
            let entry = size + at * 4;

            palette.index(byte(entry + 2), byte(entry + 1), byte(entry)) as u8
        })
        .collect();
    let xor_stride = ((width * bit_count + 31) >> 5) << 2;
    let and_stride = ((width + 31) >> 5) << 2;
    let xor_start = size + count * 4;
    let and_start = xor_start + xor_stride * height;
    let per_byte = (8 / bit_count).max(1);
    let mask = ((1u32 << bit_count) - 1) as u8;
    let mut xor = vec![0; width * height];
    let mut and = vec![0; width * height];

    for row in 0..height {
        let from = height - 1 - row;

        for x in 0..width {
            let value = byte(xor_start + from * xor_stride + x / per_byte);
            let shift = 8usize.saturating_sub(bit_count * (x % per_byte + 1));

            xor[row * width + x] = map
                .get(usize::from((value >> shift) & mask))
                .copied()
                .unwrap_or(0);
            and[row * width + x] =
                (byte(and_start + from * and_stride + (x >> 3)) >> (7 - (x & 7))) & 1;
        }
    }

    IconData {
        width,
        height,
        xor,
        and,
    }
}

/// A cursor resource: its point, then an icon's picture.
pub fn decode_cursor(bytes: &[u8], palette: &mut DevicePalette) -> CursorImage {
    CursorImage {
        hotspot: (word(bytes, 0), word(bytes, 2)),
        icon: decode_icon(bytes.get(4..).unwrap_or_default(), palette),
    }
}

/// An icon at another size, each row and column one of the icon's,
/// sampled at its middle: row `r` is row `(r * from + from / 2) / to`.
pub fn scale_icon(icon: IconData, size: usize) -> IconData {
    if icon.width == size && icon.height == size {
        return icon;
    }

    let sample = |to: usize, from: usize| (to * from + (from >> 1)) / size;
    let mut xor = vec![0; size * size];
    let mut and = vec![0; size * size];

    for y in 0..size {
        let sy = sample(y, icon.height);

        for x in 0..size {
            let at = sy * icon.width + sample(x, icon.width);

            xor[y * size + x] = icon.xor.get(at).copied().unwrap_or(0);
            and[y * size + x] = icon.and.get(at).copied().unwrap_or(0);
        }
    }

    IconData {
        width: size,
        height: size,
        xor,
        and,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_by_sampling_the_middle_of_each_row() {
        let icon = IconData {
            width: 4,
            height: 4,
            xor: (0..16).collect(),
            and: vec![0; 16],
        };

        // Row 0 of 2 is row (0 * 4 + 2) / 2 = 1; row 1 is row 3.
        assert_eq!(scale_icon(icon, 2).xor, vec![5, 7, 13, 15]);
    }
}
