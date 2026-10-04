//! Bitmap fonts, as winbox.js's raster layer reads them: a `.FON` file's
//! `FONT` resources, each one strike of a face -- a single size and style --
//! with its header, its character widths and the bits of each glyph; and the
//! three plotter fonts, whose characters are strokes rather than bits.
//!
//! The layout is the one `undocprint.org/formats/font_formats` gives, with
//! one thing it does not give: where a vector font's character table begins.

/// A font resource's header: `FONTINFO`, field for field.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FontHeader {
    pub version: u16,
    pub size: u32,
    pub copyright: String,
    /// `dfType`: its low bit set for a vector font.
    pub kind: u16,
    pub points: u16,
    pub vert_res: u16,
    pub horiz_res: u16,
    pub ascent: u16,
    pub internal_leading: u16,
    pub external_leading: u16,
    pub italic: u8,
    pub underline: u8,
    pub strike_out: u8,
    pub weight: u16,
    pub char_set: u8,
    pub pix_width: u16,
    pub pix_height: u16,
    pub pitch_and_family: u8,
    pub avg_width: u16,
    pub max_width: u16,
    pub first_char: u8,
    pub last_char: u8,
    /// Both of these relative to the first character.
    pub default_char: u8,
    pub break_char: u8,
    pub width_bytes: u16,
    /// Where the device's name and the face's are, from the resource's start.
    pub device: u32,
    pub face: u32,
    pub bits_pointer: u32,
    pub bits_offset: u32,
    pub reserved: u8,
    pub flags: u32,
    pub a_space: u16,
    pub b_space: u16,
    pub c_space: u16,
    pub color_pointer: u32,
}

/// The character table's entry for one character.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CharacterEntry {
    pub width: u16,
    /// Where its bits are, from the resource's start; for a vector font,
    /// where its strokes begin, from `dfBitsOffset`.
    pub offset: u32,
    /// How many bytes of strokes a vector font's character has.
    pub length: u32,
}

/// What a measurement asks beyond the text: the weight the strike is to be
/// drawn at, and whether an `&` marks the next character rather than being
/// one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Measure {
    /// Nought for the strike's regular 400.
    pub weight: i32,
    pub allow_annotation: bool,
}

/// One strike of a bitmap font: a single size and style of a face, among
/// the several a font file holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BitmapFontEntry {
    bytes: Vec<u8>,
    pub header: FontHeader,
    name: String,
    device: String,
}

fn byte_at(bytes: &[u8], at: usize) -> u8 {
    bytes.get(at).copied().unwrap_or(0)
}

fn word_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([byte_at(bytes, at), byte_at(bytes, at + 1)])
}

fn dword_at(bytes: &[u8], at: usize) -> u32 {
    u32::from(word_at(bytes, at)) | u32::from(word_at(bytes, at + 2)) << 16
}

/// A string of at most `length` characters, to its nought: one character a
/// byte. It stops at the resource's end, where the TypeScript engine's
/// `DataView` throws.
fn string_at(bytes: &[u8], at: usize, length: usize) -> String {
    bytes
        .iter()
        .skip(at)
        .take(length)
        .take_while(|&&byte| byte != 0)
        .map(|&byte| char::from(byte))
        .collect()
}

impl FontHeader {
    /// The header at the start of a font resource. A field past the
    /// resource's end reads as nought, where the TypeScript engine's
    /// `DataView` throws.
    pub fn read(bytes: &[u8]) -> Self {
        let byte = |at| byte_at(bytes, at);
        let word = |at| word_at(bytes, at);
        let dword = |at| dword_at(bytes, at);

        Self {
            version: word(0),
            size: dword(2),
            copyright: string_at(bytes, 6, 60),
            kind: word(66),
            points: word(68),
            vert_res: word(70),
            horiz_res: word(72),
            ascent: word(74),
            internal_leading: word(76),
            external_leading: word(78),
            italic: byte(80),
            underline: byte(81),
            strike_out: byte(82),
            weight: word(83),
            char_set: byte(85),
            pix_width: word(86),
            pix_height: word(88),
            pitch_and_family: byte(90),
            avg_width: word(91),
            max_width: word(93),
            first_char: byte(95),
            last_char: byte(96),
            default_char: byte(97),
            break_char: byte(98),
            width_bytes: word(99),
            device: dword(101),
            face: dword(105),
            bits_pointer: dword(109),
            bits_offset: dword(113),
            reserved: byte(117),
            flags: dword(118),
            a_space: word(122),
            b_space: word(124),
            c_space: word(126),
            color_pointer: dword(128),
        }
    }
}

impl BitmapFontEntry {
    /// A strike from its font resource's bytes.
    pub fn new(bytes: Vec<u8>) -> Self {
        let header = FontHeader::read(&bytes);
        let name = string_at(&bytes, header.face as usize, 100);
        let device = if header.device == 0 {
            String::new()
        } else {
            string_at(&bytes, header.device as usize, 100)
        };

        Self {
            bytes,
            header,
            name,
            device,
        }
    }

    /// The face's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The device it was made for, if it names one.
    pub fn device(&self) -> &str {
        &self.device
    }

    /// The version of the font specification it follows: `3.0`, `2.0`.
    pub fn version(&self) -> String {
        format!("{}.{}", byte_at(&self.bytes, 1), byte_at(&self.bytes, 0))
    }

    /// Its weight on a scale from 1 to 1000; a regular font's is 400.
    pub fn weight(&self) -> u16 {
        self.header.weight
    }

    /// Its size in points.
    pub fn size(&self) -> u16 {
        self.header.points
    }

    /// Whether this font is strokes rather than pixels.
    ///
    /// The low bit of `dfType` says so. Windows calls these plotter fonts, and
    /// three of them ship with 3.1 -- Roman, Modern and Script. They have one
    /// design apiece rather than a set of strikes, and GDI draws them at
    /// whatever size is asked for, which makes them a different kind of thing
    /// from every other font here however similar the container looks.
    pub fn is_vector(&self) -> bool {
        self.header.kind & 0x01 == 1
    }

    /// Where the character table begins.
    ///
    /// A 3.x font puts it after a 148 byte header and a 2.x font after 118.
    /// The vector fonts are version 1.0 and put it at 119, which is not a
    /// number any documentation to hand gives: it was found by reading the
    /// table at each candidate offset and seeing which one reproduces the
    /// widths the header itself reports in `dfAvgWidth` and `dfMaxWidth`. Only
    /// 119 does, for all three of them.
    pub fn table_offset(&self) -> usize {
        if self.is_vector() {
            return 119;
        }

        if self.header.version <= 0x200 {
            118
        } else {
            148
        }
    }

    /// How wide the character table's entries are, in bytes.
    pub fn entry_size(&self) -> usize {
        if self.header.version <= 0x200 { 4 } else { 6 }
    }

    /// The table's entry at a position: a 2.x entry's offset is a word, a
    /// 3.x entry's a double word.
    fn table_entry(&self, at: usize) -> CharacterEntry {
        CharacterEntry {
            width: word_at(&self.bytes, at),
            offset: if self.entry_size() == 4 {
                u32::from(word_at(&self.bytes, at + 2))
            } else {
                dword_at(&self.bytes, at + 2)
            },
            length: 0,
        }
    }

    /// The character a code is drawn as: itself where the font has it, its
    /// default character where it has not.
    ///
    /// A default character the font does not have either is answered by
    /// nothing at all, where the TypeScript engine asks for it again without
    /// end.
    fn present(&self, code: u32) -> Option<u32> {
        let header = &self.header;
        let has = |code: u32| {
            (u32::from(header.first_char)..=u32::from(header.last_char)).contains(&code)
        };

        if has(code) {
            return Some(code);
        }

        let default = u32::from(header.default_char) + u32::from(header.first_char);

        has(default).then_some(default)
    }

    /// The character information for a code.
    pub fn character(&self, code: u32) -> CharacterEntry {
        let Some(code) = self.present(code) else {
            return CharacterEntry::default();
        };
        let entry_size = self.entry_size();
        let at =
            (code - u32::from(self.header.first_char)) as usize * entry_size + self.table_offset();
        let mut info = self.table_entry(at);

        if self.is_vector() {
            // A stroke character has no raster to read, and the offset in its
            // own entry is where its strokes *end* rather than where they
            // begin.
            //
            // That is the one thing about these files that is not like the
            // bitmap ones, and reading it the other way is why Roman's `A`
            // came out as a `B`: every character was drawn with the next one's
            // strokes. The table says so plainly once it is looked at. The
            // first entry, the space, has offset nought, and a space has no
            // strokes; the second, the exclamation mark, has 27, and 27 bytes
            // is a stroke and a dot. On the other reading the space would own
            // those 27 bytes and the exclamation mark the twenty after them.
            //
            // The `A` settles it: 30 bytes ending at 1465, which decode to a
            // lift to (10,4), a draw to (3,25), a lift back and a draw to
            // (17,25) -- two strokes meeting at an apex, which is an `A` and
            // not anything else.
            let previous = if code == u32::from(self.header.first_char) {
                0
            } else {
                self.table_entry(at - entry_size).offset
            };
            let end = u32::from(word_at(&self.bytes, at + 2));

            info.offset = previous;
            info.length = end.saturating_sub(previous);
        }

        info
    }

    /// A character's bits, a row at a time from the top of the cell: one
    /// byte a pixel, 1 where it is ink. Nothing for a vector font.
    ///
    /// The bits are stored a column of eight pixels at a time, each column
    /// every row of the cell deep.
    pub fn glyph(&self, code: u32) -> Vec<Vec<u8>> {
        if self.is_vector() {
            return Vec::new();
        }

        let info = self.character(code);
        let height = usize::from(self.header.pix_height);
        let width = usize::from(info.width);
        let mut rows = vec![Vec::with_capacity(width); height];
        let mut offset = info.offset as usize;

        for column in (0..width).step_by(8) {
            for row in &mut rows {
                let mut bits = byte_at(&self.bytes, offset);

                for bit in 0..8 {
                    if column + bit < width {
                        row.push((bits & 0x80) >> 7);
                        bits <<= 1;
                    }
                }

                offset += 1;
            }
        }

        rows
    }

    /// The strokes that draw one character, as runs of points to join up.
    ///
    /// The data is a stream of signed byte pairs. A `0x80` byte lifts the pen
    /// and the pair after it moves it; any other byte is the first of a pair
    /// of offsets from where the pen already is, and the pen draws as it goes.
    /// So a character is a handful of polylines, in the design coordinates of
    /// the font.
    pub fn strokes(&self, code: u32) -> Vec<Vec<(i32, i32)>> {
        let info = self.character(code);
        let signed = |at: usize| i32::from(byte_at(&self.bytes, at) as i8);

        let mut at = (self.header.bits_offset as usize).wrapping_add(info.offset as usize);
        let end = at.wrapping_add(info.length as usize).min(self.bytes.len());

        let mut runs: Vec<Vec<(i32, i32)>> = Vec::new();
        let (mut x, mut y) = (0, 0);

        while at + 1 < end {
            if byte_at(&self.bytes, at) == 0x80 {
                // Pen up: the pair that follows moves the pen without drawing,
                // and it is a displacement like every other pair rather than a
                // position.
                //
                // Roman's `A` is thirty bytes and decodes, this way, to a lift
                // to (10,4) and a draw to (3,25); a lift back to (10,4) and a
                // draw to (17,25); then an inner stroke, a crossbar, and a
                // serif at each foot. Read as positions the same bytes give a
                // scatter of strokes that is not a letter.
                x += signed(at + 1);
                y += signed(at + 2);
                runs.push(vec![(x, y)]);
                at += 3;
                continue;
            }

            x += signed(at);
            y += signed(at + 1);

            match runs.last_mut() {
                Some(run) => run.push((x, y)),
                None => runs.push(vec![(x, y)]),
            }

            at += 2;
        }

        runs
    }

    /// How much room a string takes: its width and the cell's height.
    ///
    /// A string with nothing in it occupies nothing at all, not a zero-width
    /// strip of the font's height -- `GetTextExtent("")` on Windows is zero by
    /// zero, and layout code divides by the result.
    pub fn measure(&self, text: &[u8], options: Measure) -> (i32, i32) {
        let weight = if options.weight == 0 {
            400
        } else {
            options.weight
        };

        if text.is_empty() {
            return (0, 0);
        }

        // Bold is made by drawing each character again a pixel across, which
        // widens each by one -- where the strike is not bold already.
        let emboldened = self.header.weight <= 400 && weight > 400;
        let mut width = 0;

        for &code in text {
            if options.allow_annotation && code == b'&' {
                continue;
            }

            width += i32::from(self.character(u32::from(code)).width) + i32::from(emboldened);
        }

        (width, i32::from(self.header.pix_height))
    }
}

/// The resource type of a font: `RT_FONT`.
const RT_FONT: u16 = 8;

/// The strikes of a font file: each `FONT` resource of an executable, in the
/// order its resource table holds them.
///
/// A file that is not an executable gives none. The TypeScript engine reads
/// one as a single strike, through a constructor that cannot read a stream,
/// and throws.
pub fn read_bitmap_font(bytes: Vec<u8>) -> Vec<BitmapFontEntry> {
    if word_at(&bytes, 0) != 0x5a4d {
        return Vec::new();
    }

    let Ok(executable) = winbox_ne::Executable::parse(bytes) else {
        return Vec::new();
    };

    executable
        .resources
        .iter()
        .filter(|kind| kind.id == winbox_ne::ResourceId::Number(RT_FONT))
        .flat_map(|kind| kind.entries.iter())
        .map(|resource| BitmapFontEntry::new(executable.resource_bytes(resource).to_vec()))
        .collect()
}

/// The strike the TypeScript engine's `BitmapFont.fontFor` answers for a
/// point size.
///
/// It is meant to be the nearest, but the comparison it makes is not that:
/// a strike replaces the one kept when its distance from the size asked for
/// is less than its distance from the kept strike's own size. Ported as it
/// is written, since that is the engine this follows. A file of an eight
/// and a twelve point strike asked for nine answers twelve: the twelve is
/// three from the request and four from the eight, so it replaces the eight,
/// which was the nearer.
pub fn font_for(entries: &[BitmapFontEntry], size: i32) -> Option<&BitmapFontEntry> {
    entries
        .iter()
        .fold(None, |best: Option<&BitmapFontEntry>, entry| match best {
            Some(best)
                if (i32::from(entry.size()) - size).abs()
                    >= (i32::from(entry.size()) - i32::from(best.size())).abs() =>
            {
                Some(best)
            }
            _ => Some(entry),
        })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A 3.0 strike with two characters, `A` eight wide and `B` ten, nine
    /// rows, as a font editor would write it.
    pub(crate) fn strike() -> Vec<u8> {
        let mut bytes = vec![0u8; 148 + 6 * 3];
        let set16 = |bytes: &mut Vec<u8>, at: usize, value: u16| {
            bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
        };
        let set32 = |bytes: &mut Vec<u8>, at: usize, value: u32| {
            bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
        };

        set16(&mut bytes, 0, 0x300);
        set16(&mut bytes, 68, 10);
        set16(&mut bytes, 70, 96);
        set16(&mut bytes, 72, 96);
        set16(&mut bytes, 74, 7);
        set16(&mut bytes, 76, 1);
        set16(&mut bytes, 83, 400);
        set16(&mut bytes, 88, 9);
        bytes[90] = 0x21;
        set16(&mut bytes, 91, 9);
        set16(&mut bytes, 93, 10);
        bytes[95] = b'A';
        bytes[96] = b'B';
        bytes[97] = 0;
        bytes[98] = 0;

        let bits = bytes.len() as u32;
        let face = bits + 9 + 18;

        set32(&mut bytes, 105, face);
        set32(&mut bytes, 113, bits);
        // A: one column of nine rows; B: two.
        set16(&mut bytes, 148, 8);
        set32(&mut bytes, 150, bits);
        set16(&mut bytes, 154, 10);
        set32(&mut bytes, 156, bits + 9);

        let mut glyphs = vec![0u8; 27];

        glyphs[0] = 0b1000_0001;
        glyphs[8] = 0xff;
        glyphs[9] = 0xff;
        glyphs[18] = 0b1100_0000;
        bytes.extend_from_slice(&glyphs);
        bytes.extend_from_slice(b"Test Sans\0");
        bytes
    }

    #[test]
    fn reads_a_strike() {
        let entry = BitmapFontEntry::new(strike());

        assert_eq!(entry.name(), "Test Sans");
        assert_eq!(entry.version(), "3.0");
        assert_eq!(entry.header.pix_height, 9);
        assert_eq!(entry.table_offset(), 148);
        assert_eq!(entry.entry_size(), 6);
        assert!(!entry.is_vector());
        assert_eq!(entry.character(u32::from(b'B')).width, 10);
        // A character the strike has not is its default character.
        assert_eq!(entry.character(u32::from(b'Z')).width, 8);
    }

    #[test]
    fn reads_a_glyph_a_column_of_eight_at_a_time() {
        let entry = BitmapFontEntry::new(strike());
        let a = entry.glyph(u32::from(b'A'));
        let b = entry.glyph(u32::from(b'B'));

        assert_eq!(a.len(), 9);
        assert_eq!(a[0], vec![1, 0, 0, 0, 0, 0, 0, 1]);
        assert_eq!(a[8], vec![1; 8]);
        assert_eq!(b[0], vec![1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
        assert_eq!(b[1], vec![0; 10]);
    }

    #[test]
    fn picks_a_size_as_the_typescript_engine_does() {
        let sized = |points: u16| {
            let mut bytes = strike();

            bytes[68..70].copy_from_slice(&points.to_le_bytes());
            BitmapFontEntry::new(bytes)
        };
        let entries = [sized(8), sized(12), sized(10)];
        let picked = |size| font_for(&entries[..2], size).map(BitmapFontEntry::size);

        // The twelve is three from nine and four from the eight it replaces.
        assert_eq!(picked(9), Some(12));
        assert_eq!(picked(7), Some(8));
        // A strike the same size as the one kept never replaces it.
        assert_eq!(
            font_for(&[sized(10), sized(10)], 10).map(BitmapFontEntry::size),
            Some(10)
        );
        assert_eq!(font_for(&entries, 10).map(BitmapFontEntry::size), Some(10));
        assert_eq!(font_for(&[], 10).map(BitmapFontEntry::size), None);
    }

    #[test]
    fn measures_nothing_as_nothing() {
        let entry = BitmapFontEntry::new(strike());

        assert_eq!(entry.measure(b"", Measure::default()), (0, 0));
        assert_eq!(entry.measure(b"AB", Measure::default()), (18, 9));
        // Emboldened: a pixel a character.
        let bold = Measure {
            weight: 700,
            ..Measure::default()
        };

        assert_eq!(entry.measure(b"AB", bold), (20, 9));
        // An `&` marks the next character, where asked.
        let marked = Measure {
            allow_annotation: true,
            ..Measure::default()
        };

        assert_eq!(entry.measure(b"&A&B", marked), (18, 9));
    }
}
