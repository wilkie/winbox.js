//! What GDI's TrueType engine answers about a font file beside drawing it:
//! the bytes of a table (`GetFontData`), its kerning pairs
//! (`GetKerningPairs`) and the outline metrics (`GetOutlineTextMetrics`),
//! in the font's own units. GDI's side -- the character set, the pixel
//! size, the mapping -- is `winbox-win16`'s `gdi::text::queries`. The
//! TypeScript engine's twin is `src/raster/truetype-queries.ts`.
//!
//! **Read out** of `GDI.EXE`: the engine's entry points are a table at
//! seg47 `001e`, reached through seg36's stubs `0042` to `00ae`.

use std::collections::HashMap;

use crate::truetype::TrueTypeFont;

/// What `GetFontData` answers when it has nothing: -1.
pub const GDI_ERROR: u32 = 0xffff_ffff;

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    match bytes.get(at..at + 2) {
        Some(b) => u16::from_be_bytes([b[0], b[1]]),
        None => 0,
    }
}

fn i16_at(bytes: &[u8], at: usize) -> i16 {
    u16_at(bytes, at) as i16
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    match bytes.get(at..at + 4) {
        Some(b) => u32::from_be_bytes([b[0], b[1], b[2], b[3]]),
        None => 0,
    }
}

/// Where a table is: its offset and length.
#[derive(Debug, Clone, Copy)]
struct Place {
    offset: usize,
    length: u32,
}

/// A table by its tag, as the four bytes of a little-endian dword.
fn table_of(bytes: &[u8], tag: u32) -> Option<Place> {
    let count = usize::from(u16_at(bytes, 4));

    for index in 0..count {
        let at = 12 + index * 16;

        if at + 16 > bytes.len() {
            break;
        }

        let name = u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);

        if name == tag {
            return Some(Place {
                offset: u32_at(bytes, at + 8) as usize,
                length: u32_at(bytes, at + 12),
            });
        }
    }

    None
}

fn named(bytes: &[u8], name: [u8; 4]) -> Option<Place> {
    table_of(bytes, u32::from_le_bytes(name))
}

/// `GetFontData`'s reading of the file. **Read out** (seg40 `0113`): with
/// no buffer the size is taken as the largest there is. A table of nought is
/// the whole file; otherwise the directory is searched for the tag, and a
/// tag it lacks is -1. What is left of the table past the offset is -1
/// where it is nothing or less, else cut to the size: that many bytes are
/// read, from the table's start plus the offset, and that is the answer.
///
/// The answer, and where in the file the bytes it read start.
pub fn font_data(bytes: &[u8], table: u32, offset: u32, size: Option<u32>) -> (u32, usize) {
    let (start, length) = if table == 0 {
        (0, bytes.len() as u32)
    } else {
        match table_of(bytes, table) {
            Some(place) => (place.offset, place.length),
            None => return (GDI_ERROR, 0),
        }
    };

    // Signed, as the engine compares it: what is left past the offset.
    let left = length.wrapping_sub(offset) as i32;

    if left <= 0 {
        return (GDI_ERROR, 0);
    }

    let cap = size.unwrap_or(u32::MAX);

    ((left as u32).min(cap), start + offset as usize)
}

/// The code each glyph is reached by, as the engine builds it for the
/// kerning pairs (seg36 `15af`): every code of the Windows `cmap`, in order,
/// the glyph it reaches given that code -- so a glyph two codes reach keeps
/// the higher, the space keeping 00A0h over 0020h.
pub fn codes_of_glyphs(font: &TrueTypeFont) -> HashMap<u32, u32> {
    let mut codes: HashMap<u32, u32> = HashMap::new();

    for (&code, &glyph) in font.cmap() {
        let entry = codes.entry(glyph).or_insert(code);

        if *entry < code {
            *entry = code;
        }
    }

    codes
}

/// One kerning pair as the engine hands it to GDI: two codes and the
/// amount, in font units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KernPair {
    pub first: u32,
    pub second: u32,
    pub amount: i16,
}

/// The first horizontal subtable of the first format -- coverage 0001h --
/// of a `kern` table of version nought: where it is and how many pairs.
fn kern_subtable(bytes: &[u8]) -> Option<(usize, usize)> {
    let table = named(bytes, *b"kern")?;

    if u16_at(bytes, table.offset) != 0 {
        return None;
    }

    let mut left = u16_at(bytes, table.offset + 2);
    let mut at = table.offset + 4;

    while left > 0 {
        left -= 1;

        if u16_at(bytes, at + 4) == 0x0001 {
            return Some((at, usize::from(u16_at(bytes, at + 6))));
        }

        let length = usize::from(u16_at(bytes, at + 2));

        if length == 0 {
            break;
        }

        at += length;
    }

    None
}

/// The font's kerning pairs (seg36 `1420`), in the file's order, each glyph
/// turned into the code that reaches it.
pub fn kern_pairs(font: &TrueTypeFont) -> Vec<KernPair> {
    let bytes = font.data().bytes();
    let Some((at, count)) = kern_subtable(bytes) else {
        return Vec::new();
    };
    let codes = codes_of_glyphs(font);

    (0..count)
        .map(|index| {
            let pair = at + 14 + index * 6;

            KernPair {
                first: codes
                    .get(&u32::from(u16_at(bytes, pair)))
                    .copied()
                    .unwrap_or(0),
                second: codes
                    .get(&u32::from(u16_at(bytes, pair + 2)))
                    .copied()
                    .unwrap_or(0),
                amount: i16_at(bytes, pair + 4),
            }
        })
        .collect()
}

/// How many pairs `kern_pairs` has.
pub fn kern_pair_count(font: &TrueTypeFont) -> usize {
    kern_subtable(font.data().bytes()).map_or(0, |(_, count)| count)
}

/// The outline metrics in the font's units, as the engine makes them
/// (seg40 `0606`), before GDI scales them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutlineMetrics {
    pub panose: [u8; 10],
    pub fs_selection: u16,
    pub fs_type: u16,
    pub slope_rise: i16,
    pub slope_run: i16,
    pub italic_angle: i16,
    pub em_square: u16,
    /// The twenty-five GDI scales, from `otmAscent` to `otmsUnderscoreSize`.
    pub scaled: [i16; 25],
    /// The family (name 1), face (4), style (2) and full (3) names, as
    /// UTF-16 codes.
    pub names: [Vec<u16>; 4],
}

/// **Read out** of seg40 `0606`, the engine's builder; see the TypeScript
/// engine's `outlineMetrics` for each field's source.
pub fn outline_metrics(font: &TrueTypeFont, encoding: u16) -> OutlineMetrics {
    let bytes = font.data().bytes();
    let head = named(bytes, *b"head");
    let hhea = named(bytes, *b"hhea");
    let os2 = named(bytes, *b"OS/2");
    let post = named(bytes, *b"post");
    let s = |table: Option<Place>, at: usize| table.map_or(0, |t| i16_at(bytes, t.offset + at));
    let u = |table: Option<Place>, at: usize| table.map_or(0, |t| u16_at(bytes, t.offset + at));

    let mac_style = u(head, 0x2c);
    let units = u(head, 0x12);
    let mut fs_selection = if mac_style & 1 != 0 { 0x20 } else { 0 };

    if mac_style & 2 != 0 {
        fs_selection |= 1;
    }

    if fs_selection == 0 {
        fs_selection = 0x40;
    }

    let mut metrics = OutlineMetrics {
        panose: [0; 10],
        fs_selection,
        fs_type: 0x100,
        slope_rise: s(hhea, 0x12),
        slope_run: s(hhea, 0x14),
        italic_angle: 0,
        em_square: units,
        scaled: [
            s(hhea, 4),
            s(hhea, 6),
            s(hhea, 8),
            (units >> 1) as i16,
            (units >> 2) as i16,
            s(head, 0x24),
            s(head, 0x2a),
            s(head, 0x28),
            s(head, 0x26),
            s(hhea, 4),
            s(hhea, 6),
            s(hhea, 8),
            u(head, 0x2e) as i16,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ],
        names: [Vec::new(), Vec::new(), Vec::new(), Vec::new()],
    };

    if let Some(table) = os2 {
        metrics.fs_type = u(os2, 8);

        for i in 0..10 {
            metrics.scaled[13 + i] = s(os2, 0x0a + i * 2);
        }

        metrics.fs_selection = u(os2, 0x3e);
        metrics.scaled[0] = s(os2, 0x44);
        metrics.scaled[1] = s(os2, 0x46);
        metrics.scaled[2] = s(os2, 0x48);

        for (i, byte) in metrics.panose.iter_mut().enumerate() {
            *byte = bytes.get(table.offset + 0x20 + i).copied().unwrap_or(0);
        }
    }

    if let Some(table) = post {
        if u32_at(bytes, table.offset + 0x0c) != 0 {
            metrics.fs_type |= 1;
        }

        let whole = i32::from(s(post, 4));
        let fraction = i32::from(u(post, 6));

        metrics.italic_angle = ((whole % 360) * 10 + ((fraction * 10) >> 16)) as i16;
        metrics.scaled[23] = s(post, 8);
        metrics.scaled[24] = s(post, 10);
    }

    metrics.names = outline_names(bytes, encoding);
    metrics
}

/// The four names (seg40 `0654`): the Microsoft platform's for the
/// encoding asked, in US English, the first entry of each name winning.
fn outline_names(bytes: &[u8], encoding: u16) -> [Vec<u16>; 4] {
    let mut names: [Option<Vec<u16>>; 4] = [None, None, None, None];
    let Some(table) = named(bytes, *b"name") else {
        return [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    };
    let count = usize::from(u16_at(bytes, table.offset + 2));
    let storage = table.offset + usize::from(u16_at(bytes, table.offset + 4));
    // Name 1 is the family, 4 the face, 2 the style, 3 the full name.
    let slot = [0, 2, 3, 1];

    for index in 0..count {
        let at = table.offset + 6 + index * 12;

        if u16_at(bytes, at) != 3
            || u16_at(bytes, at + 2) != encoding
            || u16_at(bytes, at + 4) != 0x0409
        {
            continue;
        }

        let id = usize::from(u16_at(bytes, at + 6));

        if !(1..=4).contains(&id) || names[slot[id - 1]].is_some() {
            continue;
        }

        let length = usize::from(u16_at(bytes, at + 8));
        let offset = storage + usize::from(u16_at(bytes, at + 10));

        names[slot[id - 1]] = Some(
            (0..length / 2)
                .map(|i| u16_at(bytes, offset + i * 2))
                .collect(),
        );
    }

    names.map(Option::unwrap_or_default)
}
