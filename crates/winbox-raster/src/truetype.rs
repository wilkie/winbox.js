//! A TrueType font, read for what it says about itself.
//!
//! Four families ship with Windows 3.1 -- Arial, Times New Roman, Courier New
//! and `WingDings`, with Symbol beside them -- and they are a different kind
//! of thing again from both the bitmap strikes and the plotter fonts. There
//! is one outline per character in a coordinate space of the font's own
//! choosing, and everything a program asks about the font is that outline's
//! numbers scaled to the size being drawn.
//!
//! The metrics Windows reports for these are not a scaling of anything: for
//! half the sizes recorded, no single scale factor can produce both the
//! ascent and the descent by rounding. They are grid-fitted, and the font
//! carries the answers: `VDMX` tabulates the hinted extent of the whole face
//! at every pixel size, and `hdmx` every glyph's hinted advance at a set of
//! them -- both computed offline by whoever built the font, precisely so
//! that a system can answer `GetTextMetrics` without rasterising anything.
//! Drawing a glyph needs the interpreter (`hinting`).
//!
//! Where the TypeScript engine reads past the end of the file it throws, and
//! the call that asked fails; a glyph's own tables read here answer a
//! `Fault` there, which the caller turns into a stop. The tables read for the
//! whole face -- the character map, the advances, the names -- stop reading
//! where the file stops instead, which no font the installation ships can
//! show.

// Deliberately: numbers compared and converted as a JavaScript engine's
// are, since every rule here was measured through one.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;

use crate::font_resource::FontResource;
use crate::hinting::{Assembly, Hinter, ONE, Scaling};
use crate::js;

/// A read past the end of the font, or a program the interpreter will not
/// run: either way the glyph is not fitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fault;

/// A point of an outline: on the curve, or a control point for the quadratic
/// that joins its neighbours.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub on: bool,
}

/// A closed loop of points.
pub type Contour = Vec<Point>;

/// Where a table is in the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Table {
    pub offset: i64,
    pub length: i64,
}

/// The font's bytes and its table directory: everything the interpreter
/// reads.
#[derive(Debug, Clone)]
pub struct FontData {
    bytes: Vec<u8>,
    tables: HashMap<String, Table>,
}

impl FontData {
    pub(crate) fn read(bytes: Vec<u8>) -> Self {
        let mut data = Self {
            bytes,
            tables: HashMap::new(),
        };
        let count = data.u16_at(4).unwrap_or(0);

        // Every table is found through the directory rather than by walking
        // the file, which lets the tables be in any order.
        for index in 0..i64::from(count) {
            let at = 12 + index * 16;

            if at + 16 > data.bytes.len() as i64 {
                break;
            }

            let tag: String = data.bytes[at as usize..at as usize + 4]
                .iter()
                .map(|&byte| char::from(byte))
                .collect();
            let offset = i64::from(data.u32_at(at + 8).unwrap_or(0));
            let length = i64::from(data.u32_at(at + 12).unwrap_or(0));

            data.tables.insert(tag, Table { offset, length });
        }

        data
    }

    fn slice(&self, at: i64, size: i64) -> Result<&[u8], Fault> {
        if at < 0 || at + size > self.bytes.len() as i64 {
            return Err(Fault);
        }

        Ok(&self.bytes[at as usize..(at + size) as usize])
    }

    pub(crate) fn u8_at(&self, at: i64) -> Result<u8, Fault> {
        Ok(self.slice(at, 1)?[0])
    }

    pub(crate) fn u16_at(&self, at: i64) -> Result<u16, Fault> {
        let bytes = self.slice(at, 2)?;

        Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    pub(crate) fn i16_at(&self, at: i64) -> Result<i16, Fault> {
        Ok(self.u16_at(at)? as i16)
    }

    pub(crate) fn u32_at(&self, at: i64) -> Result<u32, Fault> {
        let bytes = self.slice(at, 4)?;

        Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    pub(crate) fn i32_at(&self, at: i64) -> Result<i32, Fault> {
        Ok(self.u32_at(at)? as i32)
    }

    /// A table that is present and starts inside the file.
    pub fn table(&self, tag: &str) -> Option<Table> {
        self.tables
            .get(tag)
            .copied()
            .filter(|table| table.offset + 4 <= self.bytes.len() as i64)
    }

    fn has(&self, tag: &str) -> bool {
        self.table(tag).is_some()
    }

    /// A signed 16-bit field of a table.
    pub fn signed(&self, tag: &str, offset: i64) -> Result<f64, Fault> {
        let table = self.tables.get(tag).ok_or(Fault)?;

        Ok(f64::from(self.i16_at(table.offset + offset)?))
    }

    /// An unsigned 16-bit field of a table.
    fn unsigned(&self, tag: &str, offset: i64) -> Result<f64, Fault> {
        let table = self.tables.get(tag).ok_or(Fault)?;

        Ok(f64::from(self.u16_at(table.offset + offset)?))
    }

    /// A table's length where it is present.
    fn length(&self, tag: &str) -> i64 {
        self.tables.get(tag).map_or(0, |table| table.length)
    }

    /// The coordinate space the outlines are drawn in, which every other
    /// measurement in the font is a fraction of.
    pub fn units_per_em(&self) -> f64 {
        if self.has("head") {
            self.unsigned("head", 18).unwrap_or(0.0)
        } else {
            2048.0
        }
    }

    /// How many points the scaler's own point buffer holds: the largest
    /// glyph in the font and its four phantoms, out of `maxp`.
    pub(crate) fn max_points(&self) -> Result<usize, Fault> {
        if !self.has("maxp") || self.length("maxp") < 12 {
            return Ok(0);
        }

        Ok(self.unsigned("maxp", 6)?.max(self.unsigned("maxp", 10)?) as usize + 4)
    }

    /// How many points the twilight zone holds.
    pub(crate) fn max_twilight(&self) -> Result<usize, Fault> {
        if self.has("maxp") && self.length("maxp") >= 18 {
            Ok(self.unsigned("maxp", 16)? as usize)
        } else {
            Ok(16)
        }
    }

    /// How many storage slots the hinting programs expect.
    pub(crate) fn max_storage(&self) -> Result<usize, Fault> {
        if self.has("maxp") && self.length("maxp") >= 20 {
            Ok(self.unsigned("maxp", 18)? as usize)
        } else {
            Ok(64)
        }
    }

    /// Where a glyph's outline lives in `glyf`, or nothing if it is blank:
    /// equal offsets mean no outline at all -- a space.
    fn glyph_range(&self, glyph: u32) -> Result<Option<Table>, Fault> {
        if !self.has("loca") || !self.has("glyf") || !self.has("head") {
            return Ok(None);
        }

        let long = self.signed("head", 50)? != 0.0;
        let loca = self.tables["loca"].offset;
        let glyph = i64::from(glyph);
        let (start, end) = if long {
            (
                i64::from(self.u32_at(loca + glyph * 4)?),
                i64::from(self.u32_at(loca + (glyph + 1) * 4)?),
            )
        } else {
            (
                i64::from(self.u16_at(loca + glyph * 2)?) * 2,
                i64::from(self.u16_at(loca + (glyph + 1) * 2)?) * 2,
            )
        };

        Ok((end > start).then(|| Table {
            offset: self.tables["glyf"].offset + start,
            length: end - start,
        }))
    }
}

/// A grid-fitted extent: how far above the baseline the face reaches at a
/// size and how far below it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Extent {
    pub ascent: f64,
    pub descent: f64,
}

/// A pixel size chosen for a cell, and what it comes out as.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sized {
    pub ppem: f64,
    pub ascent: f64,
    pub descent: f64,
    pub cell: f64,
    /// Whether the extent was scaled rather than read from `VDMX`.
    pub computed: bool,
}

/// A glyph's outline as the scaler hands it to the scan converter: fitted
/// and in pixels, or as stored and in font units; its advance after its
/// program, in sixty-fourths; and what the font asked of the scan converter
/// at the size, where it said.
#[derive(Debug, Clone, PartialEq)]
pub struct Fitted {
    pub contours: Vec<Contour>,
    pub hinted: bool,
    pub scaled: bool,
    pub advance: Option<f64>,
    pub dropout: Option<bool>,
    pub scan_type: Option<f64>,
}

impl Fitted {
    fn unhinted(contours: Vec<Contour>) -> Self {
        Self {
            contours,
            hinted: false,
            scaled: false,
            advance: None,
            dropout: None,
            scan_type: None,
        }
    }
}

/// A glyph's program: where it is, and whether the glyph is put together.
#[derive(Debug, Clone, Copy)]
struct Program {
    at: i64,
    length: i64,
    composite: bool,
}

/// Which interpreter a size is fitted by: the size, whether the advance
/// phantom starts on the grid, the stretch, and whether the glyph is turned.
type HinterKey = (u64, bool, u64, bool);

/// The smallest size a face is ever drawn at: asked for a one pixel cell
/// Windows answers with two pixels of Arial. **Recorded.**
pub const MIN_PPEM: f64 = 2.0;

/// The cell at which a tie stops being settled by taking the first size.
const SCALED_TIE_CELL: f64 = 255.0;

/// A TrueType font, with what it has worked out kept.
#[derive(Debug)]
pub struct TrueTypeFont {
    data: FontData,
    advances: OnceCell<Vec<f64>>,
    cmap: OnceCell<HashMap<u32, u32>>,
    name: OnceCell<String>,
    hinters: RefCell<HashMap<HinterKey, Hinter>>,
    /// The file this came from, upper case, when the loader knows it.
    pub file_name: RefCell<Option<String>>,
    /// The installer's resource for it -- see `font_resource` -- which may
    /// arrive before or after the font.
    pub resource: RefCell<Option<FontResource>>,
}

/// Where a byte of the ANSI character set lands in a font's `cmap`, where
/// the byte's own codepoint is not it: the punctuation the code page puts
/// over the C1 controls, and the middle dot drawn from the bullet operator.
/// **Measured**: `charscal`'s `GetCharWidth` for all 224 characters at nine
/// sizes on two faces leaves one candidate for seventeen of these; the
/// middle dot is eighteen recorded cells in three faces.
fn ansi(code: u32) -> Option<u32> {
    Some(match code {
        0x82 => 0x201a,
        0x83 => 0x0192,
        0x84 => 0x201e,
        0x85 => 0x2026,
        0x86 => 0x2020,
        0x87 => 0x2021,
        0x88 => 0x02c6,
        0x89 => 0x2030,
        0x8a => 0x0160,
        0x8b => 0x2039,
        0x8c => 0x0152,
        0x91 => 0x2018,
        0x92 => 0x2019,
        0x93 => 0x201c,
        0x94 => 0x201d,
        0x95 => 0x2022,
        0x96 => 0x2013,
        0x97 => 0x2014,
        0x98 => 0x02dc,
        0x99 => 0x2122,
        0x9a => 0x0161,
        0x9b => 0x203a,
        0x9c => 0x0153,
        0x9f => 0x0178,
        0xb7 => 0x2219,
        _ => return None,
    })
}

/// The greatest common divisor, as `VDMX`'s ratios are put in lowest terms.
fn divisor(a: f64, b: f64) -> f64 {
    if b == 0.0 || b.is_nan() {
        a
    } else {
        divisor(b, a % b)
    }
}

impl TrueTypeFont {
    /// Whether the bytes look like a TrueType font at all: `0x00010000` is a
    /// TrueType outline font and `true` the Macintosh spelling.
    pub fn looks_like_font(bytes: &[u8]) -> bool {
        if bytes.len() < 12 {
            return false;
        }

        let version = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);

        version == 0x0001_0000 || version == 0x7472_7565
    }

    pub fn new(bytes: Vec<u8>) -> Self {
        Self {
            data: FontData::read(bytes),
            advances: OnceCell::new(),
            cmap: OnceCell::new(),
            name: OnceCell::new(),
            hinters: RefCell::new(HashMap::new()),
            file_name: RefCell::new(None),
            resource: RefCell::new(None),
        }
    }

    /// The bytes and the tables.
    pub fn data(&self) -> &FontData {
        &self.data
    }

    fn has(&self, tag: &str) -> bool {
        self.data.has(tag)
    }

    fn signed_or(&self, tag: &str, offset: i64, otherwise: f64) -> f64 {
        if self.has(tag) {
            self.data.signed(tag, offset).unwrap_or(0.0)
        } else {
            otherwise
        }
    }

    fn unsigned_or(&self, tag: &str, offset: i64, otherwise: f64) -> f64 {
        if self.has(tag) {
            self.data.unsigned(tag, offset).unwrap_or(0.0)
        } else {
            otherwise
        }
    }

    /// A signed 16-bit field of a table, as `GetTextMetrics` reads `head`'s
    /// box directly.
    pub fn signed(&self, tag: &str, offset: i64) -> Result<f64, Fault> {
        self.data.signed(tag, offset)
    }

    pub fn units_per_em(&self) -> f64 {
        self.data.units_per_em()
    }

    /// How far above the baseline the font says its characters reach: the
    /// Windows pair in `OS/2` where there is one, which is what GDI uses,
    /// and `hhea`'s typographic one otherwise.
    pub fn ascender(&self) -> f64 {
        if self.has("OS/2") && self.data.length("OS/2") >= 78 {
            return self.data.unsigned("OS/2", 74).unwrap_or(0.0);
        }

        self.signed_or("hhea", 4, 0.0)
    }

    /// How far below it they reach, as a positive number.
    pub fn descender(&self) -> f64 {
        if self.has("OS/2") && self.data.length("OS/2") >= 78 {
            return self.data.unsigned("OS/2", 76).unwrap_or(0.0);
        }

        if self.has("hhea") {
            -self.data.signed("hhea", 6).unwrap_or(0.0)
        } else {
            0.0
        }
    }

    /// The gap the font asks for between one line and the next.
    pub fn line_gap(&self) -> f64 {
        self.signed_or("hhea", 8, 0.0)
    }

    /// How wide the font's bounding box is, in font units: what
    /// `tmMaxCharWidth` is scaled from, wider than the widest advance because
    /// it counts ink that hangs outside it.
    pub fn bounding_width(&self) -> f64 {
        if self.has("head") {
            self.data.signed("head", 40).unwrap_or(0.0)
                - self.data.signed("head", 36).unwrap_or(0.0)
        } else {
            0.0
        }
    }

    /// The right edge of the box the font declares, which the scaler
    /// compares, scaled by the horizontal size, against two hundred and
    /// fifty-six. See `halves`.
    pub fn bounding_right(&self) -> f64 {
        self.signed_or("head", 40, 0.0)
    }

    /// Where the underline sits, as a negative number of units below the
    /// baseline, and how thick it is: `post`'s. Arial says -217 and 150,
    /// Courier New -477 and 84, Times New Roman -223 and 100.
    pub fn underline_position(&self) -> f64 {
        self.signed_or("post", 8, 0.0)
    }

    pub fn underline_thickness(&self) -> f64 {
        self.signed_or("post", 10, 0.0)
    }

    /// Where the strikeout sits above the baseline and how thick: `OS/2`'s.
    pub fn strikeout_position(&self) -> f64 {
        self.signed_or("OS/2", 28, 0.0)
    }

    pub fn strikeout_size(&self) -> f64 {
        self.signed_or("OS/2", 26, 0.0)
    }

    /// The average character width the font states for itself.
    pub fn average_advance(&self) -> f64 {
        self.signed_or("OS/2", 2, 0.0)
    }

    /// The weight class, on the same scale a `LOGFONT` uses.
    pub fn weight(&self) -> f64 {
        self.unsigned_or("OS/2", 4, 400.0)
    }

    /// Whether this file is the bold one of its family.
    pub fn bold_face(&self) -> bool {
        if self.has("OS/2") && self.data.length("OS/2") >= 64 {
            return js::int32(self.data.unsigned("OS/2", 62).unwrap_or(0.0)) & 0x20 != 0;
        }

        self.weight() >= 700.0
    }

    /// Whether this file is the italic one.
    pub fn italic_face(&self) -> bool {
        if self.has("OS/2") && self.data.length("OS/2") >= 64 {
            return js::int32(self.data.unsigned("OS/2", 62).unwrap_or(0.0)) & 0x01 != 0;
        }

        self.has("head") && js::int32(self.data.unsigned("head", 44).unwrap_or(0.0)) & 0x02 != 0
    }

    /// Whether the font holds symbols rather than letters: a symbol font maps
    /// its characters into a private range, so it has no glyph for `A` at
    /// `A`. Such a font is no use to a request for the ANSI character set.
    pub fn symbolic(&self) -> bool {
        let cmap = self.cmap();

        !cmap.contains_key(&0x41) && cmap.contains_key(&0xf041)
    }

    /// Whether this is the plain face of its family: bit 6 of the selection
    /// says so outright, and failing that, neither bold nor italic.
    pub fn regular(&self) -> bool {
        if self.has("OS/2") && self.data.length("OS/2") >= 64 {
            let selection = js::int32(self.data.unsigned("OS/2", 62).unwrap_or(0.0));

            return selection & 0x40 != 0 || selection & 0x21 == 0;
        }

        self.weight() < 700.0
    }

    /// The family the font puts itself in, as a `LOGFONT`'s pitch and family
    /// byte has it: the installer's word first (see `font_resource`), and
    /// otherwise `OS/2`'s class -- 8 the sans serifs, 10 the scripts -- or
    /// modern for fixed pitch and roman for anything else. **Recorded**:
    /// Symbol comes back `FF_ROMAN`.
    pub fn family(&self) -> u8 {
        if let Some(resource) = self.resource.borrow().as_ref() {
            return resource.pitch_and_family & 0xf0;
        }

        if !self.has("OS/2") {
            return 0x00;
        }

        let class = js::sar(self.data.signed("OS/2", 30).unwrap_or(0.0), 8.0);

        if class == 8.0 {
            0x20
        } else if class == 10.0 {
            0x40
        } else if self.fixed_pitch() {
            0x30
        } else {
            0x10
        }
    }

    /// Whether every character advances by the same amount.
    pub fn fixed_pitch(&self) -> bool {
        self.data
            .table("post")
            .is_some_and(|post| self.data.u32_at(post.offset + 12).unwrap_or(0) != 0)
    }

    /// A string of the `name` table: UTF-16 on the Windows platform, whose
    /// low bytes are the characters for everything these fonts are named,
    /// and bytes on the Macintosh one.
    fn name_text(&self, platform: u16, at: i64, length: u16) -> String {
        let (start, step) = if platform == 3 { (1, 2) } else { (0, 1) };

        (start..i64::from(length))
            .step_by(step)
            .map_while(|byte| self.data.u8_at(at + byte).ok().map(char::from))
            .collect()
    }

    /// The family name, which is what `GetTextFace` answers: the Windows
    /// platform's where there is one, since that is the one Windows reads.
    pub fn face_name(&self) -> &str {
        self.name.get_or_init(|| {
            let Some(table) = self.data.table("name") else {
                return String::new();
            };
            let base = table.offset;
            let count = self.data.u16_at(base + 2).unwrap_or(0);
            let storage = base + i64::from(self.data.u16_at(base + 4).unwrap_or(0));
            let mut best = String::new();

            for index in 0..i64::from(count) {
                let at = base + 6 + index * 12;
                let (Ok(platform), Ok(name), Ok(length), Ok(offset)) = (
                    self.data.u16_at(at),
                    self.data.u16_at(at + 6),
                    self.data.u16_at(at + 8),
                    self.data.u16_at(at + 10),
                ) else {
                    break;
                };

                // Name 1 is the family, which is the name a program asks for.
                if name != 1 || (platform != 3 && platform != 1) {
                    continue;
                }

                let text = self.name_text(platform, storage + i64::from(offset), length);

                if !text.is_empty() && (platform == 3 || best.is_empty()) {
                    best = text;
                }
            }

            best
        })
    }

    /// The full name -- "Arial Bold" where the family is "Arial" -- the second
    /// of the two names a TrueType entry in GDI's directory carries: the
    /// Windows platform's US English entry, which is what the stub carries.
    pub fn full_name(&self) -> String {
        let Some(table) = self.data.table("name") else {
            return self.face_name().to_string();
        };
        let base = table.offset;
        let count = self.data.u16_at(base + 2).unwrap_or(0);
        let storage = base + i64::from(self.data.u16_at(base + 4).unwrap_or(0));
        let mut best = String::new();
        let mut rank = -1;

        for index in 0..i64::from(count) {
            let at = base + 6 + index * 12;
            let (Ok(platform), Ok(language), Ok(name), Ok(length), Ok(offset)) = (
                self.data.u16_at(at),
                self.data.u16_at(at + 4),
                self.data.u16_at(at + 6),
                self.data.u16_at(at + 8),
                self.data.u16_at(at + 10),
            ) else {
                break;
            };

            if name != 4 || (platform != 3 && platform != 1) {
                continue;
            }

            let score = if platform == 3 {
                if language == 0x0409 { 2 } else { 1 }
            } else {
                0
            };

            if score <= rank {
                continue;
            }

            let text = self.name_text(platform, storage + i64::from(offset), length);

            if !text.is_empty() {
                best = text;
                rank = score;
            }
        }

        if best.is_empty() {
            self.face_name().to_string()
        } else {
            best
        }
    }

    /// Where in `VDMX` the group for a ratio of the device's pixels starts.
    ///
    /// The table is one list of sizes per aspect ratio, in lowest terms, and
    /// an `xRatio` of zero matches any ratio at all, which is what a square
    /// pixel with no stretch on it takes. Reading the first group instead of
    /// the right one hides: **measured**, Arial Italic at 96 pixels reports
    /// an extent that appears only in the fourth group.
    fn vdmx_group(&self, x: f64, y: f64) -> Option<i64> {
        let table = self.data.table("VDMX")?;
        let base = table.offset;
        let ratios = i64::from(self.data.u16_at(base + 4).ok()?);

        if ratios == 0 || x.is_nan() || y.is_nan() || x <= 0.0 || y <= 0.0 {
            return None;
        }

        let common = divisor(x, y);
        let (x, y) = (x / common, y / common);

        for index in 0..ratios {
            let at = base + 6 + index * 4;
            let x_ratio = f64::from(self.data.u8_at(at + 1).ok()?);
            let y_start = f64::from(self.data.u8_at(at + 2).ok()?);
            let y_end = f64::from(self.data.u8_at(at + 3).ok()?);

            #[allow(clippy::float_cmp)]
            if x_ratio == 0.0 || (x_ratio == x && y_start <= y && y <= y_end) {
                let offset = self.data.u16_at(base + 6 + ratios * 4 + index * 2).ok()?;

                return Some(base + i64::from(offset));
            }
        }

        None
    }

    /// The grid-fitted extent of the face at a pixel size, as `VDMX` holds
    /// it for a ratio, or nothing where the table does not cover the size.
    pub fn extent_at(&self, ppem: f64, x: f64, y: f64) -> Option<Extent> {
        let group = self.vdmx_group(x, y)?;
        let records = self.data.u16_at(group).ok()?;
        let first = f64::from(self.data.u8_at(group + 2).ok()?);
        let last = f64::from(self.data.u8_at(group + 3).ok()?);

        if ppem < first || ppem > last {
            return None;
        }

        for index in 0..i64::from(records) {
            let at = group + 4 + index * 6;

            #[allow(clippy::float_cmp)]
            if f64::from(self.data.u16_at(at).ok()?) == ppem {
                return Some(Extent {
                    ascent: f64::from(self.data.i16_at(at + 2).ok()?),
                    descent: -f64::from(self.data.i16_at(at + 4).ok()?),
                });
            }
        }

        None
    }

    /// The design ascent and descent carried across a size and rounded
    /// separately.
    fn scaled_extent(&self, ppem: f64) -> (f64, f64) {
        let upem = self.units_per_em();

        (
            js::round((self.ascender() * ppem) / upem),
            js::round((self.descender() * ppem) / upem),
        )
    }

    /// The same added in design units and rounded once.
    fn scaled_cell(&self, ppem: f64) -> f64 {
        js::round(((self.ascender() + self.descender()) * ppem) / self.units_per_em())
    }

    /// The largest pixel size whose grid-fitted extent fits in a cell.
    ///
    /// Walk the sizes upward keeping the **last** one that fits, and stop as
    /// soon as something fits exactly: Windows takes the smallest of a tie
    /// when the cell it fits is exactly the height asked for, and the largest
    /// when the cell falls short. **Measured**, forty-eight ties in three
    /// families and all three styles of each. A scan that meets a size too
    /// tall steps over it, and having stepped lands only on one whose scaled
    /// extent fits as well -- nine dips in sixteen faces. At a cell of 255 or
    /// more an exact run is settled by the scaled extent instead -- 587 ties
    /// of `tiepick` and `tiewide`.
    ///
    /// Below the table the extent is computed, and a computed size never ends
    /// the search. The table's last row is never the answer -- 1,758 requests
    /// of `tiepick` -- and off the table's end the answer is the largest size
    /// whose scaled extent fits, read out of the scaler's own memory. Asked
    /// for a cell nothing fits in, Windows overflows rather than refusing.
    #[allow(clippy::float_cmp)]
    pub fn size_for_height(&self, height: f64, x: f64, y: f64) -> Option<Sized> {
        let group = self.vdmx_group(x, y)?;
        let records = i64::from(self.data.u16_at(group).ok()?);
        let mut best: Option<Sized> = None;
        let mut stepped = false;

        let mut consider = |ppem: f64, ascent: f64, descent: f64, best: &mut Option<Sized>| {
            let cell = ascent + descent;

            if cell > height {
                stepped = true;

                return false;
            }

            if stepped && self.scaled_cell(ppem) > height {
                return true;
            }

            if cell == height && height >= SCALED_TIE_CELL {
                let scaled = self.scaled_cell(ppem);

                if best.is_none_or(|kept| kept.cell != height || scaled <= height) {
                    *best = Some(Sized {
                        ppem,
                        ascent,
                        descent,
                        cell,
                        computed: false,
                    });
                }

                return false;
            }

            *best = Some(Sized {
                ppem,
                ascent,
                descent,
                cell,
                computed: false,
            });

            cell == height
        };

        let smallest = self.smallest_tabulated();
        let mut ppem = MIN_PPEM;

        // A table that cannot be read by the square group leaves the smallest
        // size infinite, and the TypeScript engine loops for ever; this stops
        // where a byte's sizes do.
        while ppem < smallest && ppem <= 255.0 {
            let (ascent, descent) = self.scaled_extent(ppem);

            consider(ppem, ascent, descent, &mut best);
            ppem += 1.0;
        }

        let mut exact = false;
        let mut index = 0;

        while !exact && index < records - 1 {
            let at = group + 4 + index * 6;
            let (Ok(size), Ok(ascent), Ok(descent)) = (
                self.data.u16_at(at),
                self.data.i16_at(at + 2),
                self.data.i16_at(at + 4),
            ) else {
                return None;
            };

            exact = consider(
                f64::from(size),
                f64::from(ascent),
                -f64::from(descent),
                &mut best,
            );
            index += 1;
        }

        let largest = self.largest_tabulated();

        if largest.is_finite() {
            let mut top = None;
            let mut ppem = largest;

            loop {
                let (ascent, descent) = self.scaled_extent(ppem);

                if ascent + descent > height || !(ascent + descent).is_finite() {
                    break;
                }

                top = Some(Sized {
                    ppem,
                    ascent,
                    descent,
                    cell: ascent + descent,
                    computed: true,
                });
                ppem += 1.0;
            }

            if top.is_some() {
                return top;
            }
        }

        Some(best.unwrap_or_else(|| self.smallest_size()))
    }

    /// The largest size `VDMX` tabulates, or infinity if it tabulates none.
    fn largest_tabulated(&self) -> f64 {
        let Some(group) = self.vdmx_group(1.0, 1.0) else {
            return f64::INFINITY;
        };
        let records = i64::from(self.data.u16_at(group).unwrap_or(0));

        (0..records)
            .map(|index| f64::from(self.data.u16_at(group + 4 + index * 6).unwrap_or(0)))
            .fold(0.0, f64::max)
    }

    /// The smallest size `VDMX` tabulates, or infinity if it tabulates none.
    fn smallest_tabulated(&self) -> f64 {
        let Some(group) = self.vdmx_group(1.0, 1.0) else {
            return f64::INFINITY;
        };
        let records = i64::from(self.data.u16_at(group).unwrap_or(0));

        (0..records)
            .map(|index| f64::from(self.data.u16_at(group + 4 + index * 6).unwrap_or(0)))
            .fold(f64::INFINITY, f64::min)
    }

    /// The pixel size a cell asks for when the text is **turned**: from the
    /// design values, since `VDMX` records what the outline came out as up
    /// and down the pixel grid. The ratio of the cell to the face's extent is
    /// the estimate, walked down while it overflows and up while it falls
    /// short and the next still fits. **Measured** over every cell from eight
    /// to seventy-two in three faces, 260 of 260.
    pub fn size_for_turned_height(&self, height: f64) -> Sized {
        let extent = |ppem: f64| {
            let (ascent, descent) = self.scaled_extent(ppem);

            ascent + descent
        };
        let mut ppem =
            js::round((height * self.units_per_em()) / (self.ascender() + self.descender()));

        while ppem > MIN_PPEM && extent(ppem) > height {
            ppem -= 1.0;
        }

        while extent(ppem) < height && extent(ppem + 1.0) <= height {
            ppem += 1.0;
        }

        let (ascent, descent) = self.scaled_extent(ppem);

        Sized {
            ppem,
            ascent,
            descent,
            cell: extent(ppem),
            computed: false,
        }
    }

    /// The smallest size the face is drawn at, for a cell nothing fits in.
    pub fn smallest_size(&self) -> Sized {
        let (ascent, descent) = self.scaled_extent(MIN_PPEM);

        Sized {
            ppem: MIN_PPEM,
            ascent,
            descent,
            cell: ascent + descent,
            computed: false,
        }
    }

    /// A glyph's grid-fitted advance at a pixel size, where `hdmx` tabulates
    /// it.
    pub fn device_advance(&self, ppem: f64, glyph: u32) -> Option<f64> {
        let table = self.data.table("hdmx")?;
        let base = table.offset;
        let count = i64::from(self.data.i16_at(base + 2).ok()?);
        let stride = i64::from(self.data.i32_at(base + 4).ok()?);

        for index in 0..count {
            let record = base + 8 + index * stride;

            #[allow(clippy::float_cmp)]
            if f64::from(self.data.u8_at(record).ok()?) != ppem {
                continue;
            }

            let at = record + 2 + i64::from(glyph);

            return if at < base + table.length {
                Some(f64::from(self.data.u8_at(at).ok()?))
            } else {
                None
            };
        }

        None
    }

    /// A glyph's advance at a size where `LTSH` says hinting no longer moves
    /// it: the design advance scaled, a different number from the hinted one.
    /// Arial's `W` at eighty-nine pixels per em hints to 89 and scales to 84,
    /// and the recorded extent wants 84. Under a width the threshold is
    /// compared against the vertical size and the advance scaled by the
    /// horizontal one: **measured**, 124,992 of 124,992 stretched advances.
    pub fn linear_advance(&self, glyph: u32, ppem: f64, across: f64) -> Option<f64> {
        let table = self.data.table("LTSH")?;
        let count = self.data.u16_at(table.offset + 2).ok()?;

        if glyph >= u32::from(count) {
            return None;
        }

        // One means the advance was never anything but linear.
        if ppem < f64::from(self.data.u8_at(table.offset + 4 + i64::from(glyph)).ok()?) {
            return None;
        }

        Some(js::round(
            (self.advance_of(glyph) * across) / self.units_per_em(),
        ))
    }

    /// A glyph's advance with no program run, as the scaler answers it for a
    /// slant Windows synthesises: the origin phantom at `xMin - lsb` and the
    /// advance phantom that far again plus the advance, each scaled and
    /// rounded to a sixty-fourth, and their difference rounded to a pixel.
    /// **Recorded**: 6,014 advances of Symbol slanted, none missed.
    pub fn unhinted_advance(&self, glyph: u32, ppem: f64) -> Result<f64, Fault> {
        let scale = (ppem * 64.0) / self.units_per_em();
        let shift = self.bearing_shift(glyph)?;
        let origin = js::round(-shift * scale);
        let advance = js::round((self.advance_of(glyph) - shift) * scale);

        Ok(js::sar(advance - origin + 32.0, 6.0))
    }

    /// The scaling a hinter at a size works at, without the hinter.
    fn scaling(&self, ppem: f64, stretch: f64) -> Scaling {
        Scaling::new(ppem, stretch, self.units_per_em())
    }

    /// The interpreter for a size, built once and kept: a glyph program may
    /// leave control values and storage for the next glyph at the size, and
    /// the point buffer holds the last glyph's tail, so which glyph was drawn
    /// before matters as it does in Windows.
    fn ensure_hinter(
        &self,
        key: HinterKey,
        ppem: f64,
        round_phantoms: bool,
        stretch: f64,
        rotated: bool,
    ) -> Result<(), Fault> {
        if self.hinters.borrow().contains_key(&key) {
            return Ok(());
        }

        let hinter = Hinter::new(&self.data, ppem, round_phantoms, stretch, rotated)?;

        self.hinters.borrow_mut().insert(key, hinter);
        Ok(())
    }

    fn hinter_key(ppem: f64, round_phantoms: bool, stretch: f64, rotated: bool) -> HinterKey {
        (ppem.to_bits(), round_phantoms, stretch.to_bits(), rotated)
    }

    /// Runs something against the interpreter for a size, building it first.
    fn with_hinter<R>(
        &self,
        ppem: f64,
        round_phantoms: bool,
        stretch: f64,
        rotated: bool,
        run: impl FnOnce(&mut Hinter, &FontData) -> Result<R, Fault>,
    ) -> Result<R, Fault> {
        let key = Self::hinter_key(ppem, round_phantoms, stretch, rotated);

        self.ensure_hinter(key, ppem, round_phantoms, stretch, rotated)?;

        let mut hinters = self.hinters.borrow_mut();
        let hinter = hinters.get_mut(&key).ok_or(Fault)?;

        run(hinter, &self.data)
    }

    /// Whether the scaler fits a glyph of this face at half this size: the
    /// right edge of `head`'s box carried across the horizontal size, past
    /// two hundred and fifty-six -- strictly. **Read out of the scaler's own
    /// memory** by `scalemem`.
    pub fn halves(&self, ppem: f64, stretch: f64) -> bool {
        if ppem == 0.0 || ppem.is_nan() {
            return false;
        }

        let across = js::round(ppem * stretch);

        js::round((self.bounding_right() * across) / self.units_per_em()) > 256.0
    }

    /// The size and stretch a glyph is fitted at, where the face is fitted at
    /// half the size and doubled: both sizes halve, each to a whole number of
    /// pixels per em on its own. **Measured**: 220 of `stemedge`'s 220 and
    /// 779 of `stemwide`'s 780 on an EGA.
    fn fitting_size(&self, ppem: f64, stretch: f64) -> (f64, f64, f64) {
        if self.halves(ppem, stretch) {
            let down = js::round(ppem / 2.0);

            (2.0, down, js::round(js::round(ppem * stretch) / 2.0) / down)
        } else {
            (1.0, ppem, stretch)
        }
    }

    /// A glyph's outline, fitted to the pixel grid by the font's own program,
    /// or as stored where there is no program or the program faults.
    ///
    /// A composite with no instructions of its own is still assembled from
    /// fitted components: Wingdings' `D` is a mirrored copy of a glyph with a
    /// program. A glyph with nothing to run still has `prep`'s `SCANCTRL` to
    /// obey.
    pub fn hinted_outline(
        &self,
        glyph: u32,
        ppem: f64,
        round_phantoms: bool,
        stretch: f64,
        rotated: bool,
    ) -> Result<Fitted, Fault> {
        let contours = self.outline_of(glyph, 0)?;

        if contours.is_empty() || ppem == 0.0 || ppem.is_nan() {
            return Ok(Fitted::unhinted(contours));
        }

        let Some(range) = self.data.glyph_range(glyph)? else {
            return Ok(Fitted::unhinted(contours));
        };

        let mut program = self.program_of(glyph)?;

        if program.is_none() && self.data.i16_at(range.offset)? < 0 {
            program = Some(Program {
                at: range.offset,
                length: 0,
                composite: true,
            });
        }

        let Some(program) = program else {
            return Ok(Fitted {
                dropout: self.prep_dropout(ppem, stretch, rotated),
                scan_type: self.prep_scan_type(ppem, stretch, rotated),
                ..Fitted::unhinted(contours)
            });
        };

        let attempt = || -> Result<Fitted, Fault> {
            let (half, down, wide) = self.fitting_size(ppem, stretch);
            let key = Self::hinter_key(down, round_phantoms, wide, rotated);

            self.ensure_hinter(key, down, round_phantoms, wide, rotated)?;

            let scaling = self.scaling(down, wide);
            let assembly = if program.composite {
                Some(self.composite_in_pixels(glyph, ppem, round_phantoms, scaling, stretch)?)
            } else {
                None
            };

            let mut hinters = self.hinters.borrow_mut();
            let hinter = hinters.get_mut(&key).ok_or(Fault)?;
            let fitted = hinter.hint(
                &self.data,
                assembly
                    .as_ref()
                    .map_or(&contours, |assembly| &assembly.contours),
                self.advance_of(glyph),
                self.bearing_of(glyph)?,
                f64::from(self.data.i16_at(range.offset + 2)?),
                program.at,
                program.length,
                assembly.as_ref(),
            )?;

            #[allow(clippy::float_cmp)]
            let contours = if half == 1.0 {
                fitted
            } else {
                fitted
                    .into_iter()
                    .map(|contour| {
                        contour
                            .into_iter()
                            .map(|point| Point {
                                x: point.x * half,
                                y: point.y * half,
                                ..point
                            })
                            .collect()
                    })
                    .collect()
            };

            Ok(Fitted {
                contours,
                hinted: true,
                scaled: true,
                advance: Some(hinter.advance_exact * half),
                dropout: Some(hinter.dropout()),
                scan_type: Some(hinter.scan_type()),
            })
        };

        Ok(attempt().unwrap_or_else(|_| Fitted::unhinted(contours)))
    }

    /// A glyph's advance at a size, taken from the hinting rather than a
    /// table: what `hdmx` would have been a cache of. Where the face is
    /// fitted at half the size the advance is doubled before it is rounded:
    /// **recorded**, Symbol's delta and omega past its crossing.
    pub fn hinted_advance(
        &self,
        glyph: u32,
        ppem: f64,
        round_phantoms: bool,
        stretch: f64,
    ) -> Result<Option<f64>, Fault> {
        let range = self.data.glyph_range(glyph)?;

        let Some(range) = range.filter(|_| ppem != 0.0 && !ppem.is_nan()) else {
            return Ok(None);
        };

        let Some(program) = self.program_of(glyph)? else {
            return Ok(None);
        };

        let attempt = || -> Result<f64, Fault> {
            let (half, down, wide) = self.fitting_size(ppem, stretch);
            let key = Self::hinter_key(down, round_phantoms, wide, false);

            self.ensure_hinter(key, down, round_phantoms, wide, false)?;

            let scaling = self.scaling(down, wide);
            let assembly = if program.composite {
                Some(self.composite_in_pixels(glyph, down, round_phantoms, scaling, wide)?)
            } else {
                None
            };
            let outline = match &assembly {
                Some(_) => Vec::new(),
                None => self.outline_of(glyph, 0)?,
            };

            let mut hinters = self.hinters.borrow_mut();
            let hinter = hinters.get_mut(&key).ok_or(Fault)?;

            hinter.hint(
                &self.data,
                assembly
                    .as_ref()
                    .map_or(&outline, |assembly| &assembly.contours),
                self.advance_of(glyph),
                self.bearing_of(glyph)?,
                f64::from(self.data.i16_at(range.offset + 2)?),
                program.at,
                program.length,
                assembly.as_ref(),
            )?;

            Ok(js::round((hinter.advance_exact * half) / 64.0))
        };

        Ok(attempt().ok())
    }

    /// What `prep` alone left `SCANTYPE` at, for a glyph with no program of
    /// its own; nothing where the font has no answer.
    pub fn prep_scan_type(&self, ppem: f64, stretch: f64, rotated: bool) -> Option<f64> {
        if ppem == 0.0 || ppem.is_nan() {
            return None;
        }

        self.with_hinter(ppem, true, stretch, rotated, |hinter, data| {
            hinter.prep_scan_type(data)
        })
        .ok()
    }

    /// Whether `prep` asks for dropout control at a size, for a glyph with no
    /// program of its own: without this a face that gives it up at a size --
    /// Courier New above forty-four pixels per em, Arial above sixteen --
    /// would be drawn with it.
    pub fn prep_dropout(&self, ppem: f64, stretch: f64, rotated: bool) -> Option<bool> {
        if ppem == 0.0 || ppem.is_nan() {
            return None;
        }

        self.with_hinter(ppem, true, stretch, rotated, |hinter, data| {
            hinter.prep_dropout(data)
        })
        .ok()
    }

    /// A glyph's left side bearing, in font units.
    pub fn bearing_of(&self, glyph: u32) -> Result<f64, Fault> {
        if !self.has("hhea") || !self.has("hmtx") {
            return Ok(0.0);
        }

        let count = self.data.unsigned("hhea", 34)? as i64;
        let base = self.data.tables["hmtx"].offset;
        let glyph = i64::from(glyph);

        Ok(f64::from(if glyph < count {
            self.data.i16_at(base + glyph * 4 + 2)?
        } else {
            self.data.i16_at(base + count * 4 + (glyph - count) * 2)?
        }))
    }

    /// The glyph a byte of the ANSI character set draws: the code page's
    /// codepoint where it differs from the byte's, then the byte's own, then
    /// the symbol range.
    pub fn glyph_for(&self, code: u32) -> u32 {
        let cmap = self.cmap();

        ansi(code)
            .and_then(|wanted| cmap.get(&wanted))
            .or_else(|| cmap.get(&code))
            .or_else(|| cmap.get(&(0xf000 + code)))
            .copied()
            .unwrap_or(0)
    }

    /// The advance widths, in font units, indexed by glyph; every glyph past
    /// the table's end keeps the last.
    fn advances(&self) -> &[f64] {
        self.advances.get_or_init(|| {
            if !self.has("hhea") || !self.has("hmtx") {
                return Vec::new();
            }

            let count = self.data.unsigned("hhea", 34).unwrap_or(0.0) as i64;
            let base = self.data.tables["hmtx"].offset;

            (0..count)
                .map_while(|index| self.data.u16_at(base + index * 4).ok().map(f64::from))
                .collect()
        })
    }

    /// The advance of one glyph, in font units.
    pub fn advance_of(&self, glyph: u32) -> f64 {
        let advances = self.advances();

        match advances.len() {
            0 => 0.0,
            length => advances[(glyph as usize).min(length - 1)],
        }
    }

    /// The advance of one character, in font units, looked for in the symbol
    /// range too.
    pub fn advance_for(&self, code: u32) -> f64 {
        let cmap = self.cmap();
        let glyph = cmap
            .get(&code)
            .or_else(|| cmap.get(&(0xf000 + code)))
            .copied()
            .unwrap_or(0);

        self.advance_of(glyph)
    }

    /// The character to glyph mapping: format 4, the segmented mapping every
    /// Windows font has, and format 0, the single byte table a symbol font may
    /// carry. The Windows table wins.
    pub fn cmap(&self) -> &HashMap<u32, u32> {
        self.cmap
            .get_or_init(|| self.read_cmap().unwrap_or_default())
    }

    fn read_cmap(&self) -> Option<HashMap<u32, u32>> {
        let mut cmap = HashMap::new();
        let table = self.data.table("cmap")?;
        let base = table.offset;
        let count = self.data.u16_at(base + 2).ok()?;
        let mut chosen = -1;

        for index in 0..i64::from(count) {
            let at = base + 4 + index * 8;
            let (Ok(platform), Ok(offset)) = (self.data.u16_at(at), self.data.u32_at(at + 4))
            else {
                break;
            };

            if platform == 3 || chosen < 0 {
                chosen = base + i64::from(offset);
            }
        }

        if chosen < 0 {
            return Some(cmap);
        }

        let format = self.data.u16_at(chosen).ok()?;

        if format == 4 {
            let doubled = i64::from(self.data.u16_at(chosen + 6).ok()?);
            let segments = (doubled + 1) / 2;
            let ends = chosen + 14;
            let starts = ends + doubled + 2;
            let deltas = starts + doubled;
            let ranges = deltas + doubled;

            for segment in 0..segments {
                let (Ok(end), Ok(start), Ok(delta), Ok(range)) = (
                    self.data.u16_at(ends + segment * 2),
                    self.data.u16_at(starts + segment * 2),
                    self.data.i16_at(deltas + segment * 2),
                    self.data.u16_at(ranges + segment * 2),
                ) else {
                    break;
                };
                let delta = i64::from(delta);
                let mut code = i64::from(start);

                while code <= i64::from(end) && code != 0xffff {
                    let glyph = if range == 0 {
                        (code + delta) & 0xffff
                    } else {
                        let at =
                            ranges + segment * 2 + i64::from(range) + (code - i64::from(start)) * 2;

                        match self.data.u16_at(at) {
                            Ok(0) => 0,
                            Ok(glyph) => (i64::from(glyph) + delta) & 0xffff,
                            Err(_) => {
                                code += 1;
                                continue;
                            }
                        }
                    };

                    if glyph != 0 {
                        cmap.insert(code as u32, glyph as u32);
                    }

                    code += 1;
                }
            }
        } else if format == 0 {
            for code in 0..256 {
                let glyph = self.data.u8_at(chosen + 6 + code).ok()?;

                if glyph != 0 {
                    cmap.insert(code as u32, u32::from(glyph));
                }
            }
        }

        Some(cmap)
    }

    /// A glyph's outline, in font units: contours of points, a composite's
    /// components expanded in place.
    pub fn outline_of(&self, glyph: u32, depth: u32) -> Result<Vec<Contour>, Fault> {
        let Some(range) = self.data.glyph_range(glyph)? else {
            return Ok(Vec::new());
        };

        if depth > 5 {
            return Ok(Vec::new());
        }

        let at = range.offset;
        let contours = i64::from(self.data.i16_at(at)?);

        if contours < 0 {
            return self.composite_outline(at + 10, range, depth);
        }

        let mut ends = Vec::with_capacity(contours as usize);

        for index in 0..contours {
            ends.push(i64::from(self.data.u16_at(at + 10 + index * 2)?));
        }

        let points = if contours > 0 {
            ends[contours as usize - 1] + 1
        } else {
            0
        };

        // The hinting program sits between the contour ends and the flags.
        let mut cursor = at + 10 + contours * 2;

        cursor += 2 + i64::from(self.data.u16_at(cursor)?);

        let mut flags: Vec<u8> = Vec::new();

        while (flags.len() as i64) < points {
            let flag = self.data.u8_at(cursor)?;

            cursor += 1;
            flags.push(flag);

            // A repeat flag says how many more points share it.
            if flag & 0x08 != 0 {
                let mut repeats = self.data.u8_at(cursor)?;

                cursor += 1;

                while repeats > 0 && (flags.len() as i64) < points {
                    repeats -= 1;
                    flags.push(flag);
                }
            }
        }

        // The coordinates are deltas, each axis stored end to end.
        let mut read = |short: u8, same: u8| -> Result<Vec<f64>, Fault> {
            let mut values = Vec::with_capacity(flags.len());
            let mut value = 0.0;

            for &flag in &flags {
                if flag & short != 0 {
                    let delta = f64::from(self.data.u8_at(cursor)?);

                    cursor += 1;
                    value += if flag & same != 0 { delta } else { -delta };
                } else if flag & same == 0 {
                    value += f64::from(self.data.i16_at(cursor)?);
                    cursor += 2;
                }

                values.push(value);
            }

            Ok(values)
        };

        let xs = read(0x02, 0x10)?;
        let ys = read(0x04, 0x20)?;

        let mut shapes = Vec::new();
        let mut from = 0;

        for end in ends {
            let mut contour = Vec::new();
            let mut index = from;

            while index <= end && index < points {
                let at = index as usize;

                contour.push(Point {
                    x: xs[at],
                    y: ys[at],
                    on: flags[at] & 0x01 != 0,
                });
                index += 1;
            }

            if !contour.is_empty() {
                shapes.push(contour);
            }

            from = end + 1;
        }

        Ok(shapes)
    }

    /// The bytes a component's transform takes after its offset.
    fn transform_size(flags: u16) -> i64 {
        if flags & 0x0008 != 0 {
            2
        } else if flags & 0x0040 != 0 {
            4
        } else if flags & 0x0080 != 0 {
            8
        } else {
            0
        }
    }

    /// Where a glyph's program is and whether the glyph is put together: a
    /// composite keeps it after its last component, and only if that
    /// component says so.
    fn program_of(&self, glyph: u32) -> Result<Option<Program>, Fault> {
        let Some(range) = self.data.glyph_range(glyph)? else {
            return Ok(None);
        };

        let count = self.data.i16_at(range.offset)?;
        let mut cursor = range.offset + 10;
        let mut instructed = true;

        if count < 0 {
            let mut more = true;

            while more {
                let flags = self.data.u16_at(cursor)?;

                cursor += 4 + if flags & 0x0001 != 0 { 4 } else { 2 };
                cursor += Self::transform_size(flags);
                more = flags & 0x0020 != 0;
                instructed = flags & 0x0100 != 0;
            }
        } else {
            cursor += i64::from(count) * 2;
        }

        let length = self.data.u16_at(cursor)?;

        if !instructed || length == 0 {
            return Ok(None);
        }

        Ok(Some(Program {
            at: cursor + 2,
            length: i64::from(length),
            composite: count < 0,
        }))
    }

    /// The glyph a composite takes its side bearing from: a component may
    /// claim the composite's metrics, and one in nearly every composite in
    /// these fonts does.
    fn metrics_glyph(&self, glyph: u32) -> Result<u32, Fault> {
        let Some(range) = self.data.glyph_range(glyph)? else {
            return Ok(glyph);
        };

        if self.data.i16_at(range.offset)? >= 0 {
            return Ok(glyph);
        }

        let mut cursor = range.offset + 10;

        loop {
            let flags = self.data.u16_at(cursor)?;
            let index = self.data.u16_at(cursor + 2)?;

            cursor += 4 + if flags & 0x0001 != 0 { 4 } else { 2 };
            cursor += Self::transform_size(flags);

            if flags & 0x0200 != 0 {
                return Ok(u32::from(index));
            }

            if flags & 0x0020 == 0 {
                return Ok(glyph);
            }
        }
    }

    /// How far a glyph's outline is carried across its own side bearing.
    pub fn bearing_shift(&self, glyph: u32) -> Result<f64, Fault> {
        match self.data.glyph_range(glyph)? {
            Some(range) => {
                Ok(self.bearing_of(glyph)? - f64::from(self.data.i16_at(range.offset + 2)?))
            }
            None => Ok(0.0),
        }
    }

    /// A component's 2x2 transform: one `F2Dot14` for a uniform scale, two for
    /// x and y, four for the full matrix, the identity for none. Wingdings
    /// places a mirrored copy of another glyph this way.
    fn component_transform(&self, flags: u16, at: i64) -> Result<[f64; 4], Fault> {
        let f2 = |offset: i64| -> Result<f64, Fault> {
            Ok(f64::from(self.data.i16_at(at + offset)?) / 16384.0)
        };

        Ok(if flags & 0x0008 != 0 {
            let scale = f2(0)?;

            [scale, 0.0, 0.0, scale]
        } else if flags & 0x0040 != 0 {
            [f2(0)?, 0.0, 0.0, f2(2)?]
        } else if flags & 0x0080 != 0 {
            [f2(0)?, f2(2)?, f2(4)?, f2(6)?]
        } else {
            [1.0, 0.0, 0.0, 1.0]
        })
    }

    /// A component's offset, in words or in signed bytes, and where its
    /// transform starts.
    fn component_offset(&self, flags: u16, cursor: i64) -> Result<(f64, f64, i64), Fault> {
        if flags & 0x0001 != 0 {
            Ok((
                f64::from(self.data.i16_at(cursor)?),
                f64::from(self.data.i16_at(cursor + 2)?),
                cursor + 4,
            ))
        } else {
            Ok((
                f64::from(self.data.u8_at(cursor)? as i8),
                f64::from(self.data.u8_at(cursor + 1)? as i8),
                cursor + 2,
            ))
        }
    }

    /// A composite's outline in pixels, assembled the way the scaler
    /// assembles it: each component fitted by its **own** program and then
    /// transformed and placed, its offset rounded to a whole pixel where it
    /// asks, each carried into the same space as the glyph whose metrics the
    /// composite took. A component claiming the metrics claims them with its
    /// own fitted advance. **Recorded**: Times New Roman's `A` grave at
    /// twelve is its own `A` pixel for pixel; Wingdings' five mirrored
    /// composites are 35 of 35 transformed after fitting.
    fn composite_in_pixels(
        &self,
        glyph: u32,
        ppem: f64,
        round_phantoms: bool,
        scaling: Scaling,
        stretch: f64,
    ) -> Result<Assembly, Fault> {
        let range = self.data.glyph_range(glyph)?.ok_or(Fault)?;
        let carried = scaling.carry(self.bearing_shift(self.metrics_glyph(glyph)?)?);
        let mut shapes = Vec::new();
        let mut cursor = range.offset + 10;
        let mut advance = None;

        loop {
            let flags = self.data.u16_at(cursor)?;
            let index = u32::from(self.data.u16_at(cursor + 2)?);
            let (dx, dy, at) = self.component_offset(flags, cursor + 4)?;
            let [a, b, c, d] = self.component_transform(flags, at)?;

            cursor = at + Self::transform_size(flags);

            if flags & 0x0002 != 0 {
                let mut offset_x = scaling.to_pixels_x(dx);
                let mut offset_y = scaling.to_pixels(dy);

                if flags & 0x0004 != 0 {
                    offset_x = (offset_x / ONE + 0.5).floor() * ONE;
                    offset_y = (offset_y / ONE + 0.5).floor() * ONE;
                }

                offset_x += carried - scaling.carry(self.bearing_shift(index)?);

                let fitted = self.hinted_outline(index, ppem, round_phantoms, stretch, false)?;

                if flags & 0x0200 != 0 {
                    advance = fitted.advance;
                }

                for contour in fitted.contours {
                    shapes.push(
                        contour
                            .into_iter()
                            .map(|point| {
                                let px = if fitted.scaled {
                                    point.x * ONE
                                } else {
                                    scaling.to_pixels_x(point.x)
                                };
                                let py = if fitted.scaled {
                                    point.y * ONE
                                } else {
                                    scaling.to_pixels(point.y)
                                };

                                Point {
                                    x: a * px + c * py + offset_x,
                                    y: b * px + d * py + offset_y,
                                    on: point.on,
                                }
                            })
                            .collect(),
                    );
                }
            }

            if flags & 0x0020 == 0 {
                break;
            }
        }

        Ok(Assembly {
            contours: shapes,
            advance,
        })
    }

    /// Assembles a glyph that is made of other glyphs, in font units.
    fn composite_outline(&self, at: i64, range: Table, depth: u32) -> Result<Vec<Contour>, Fault> {
        let mut shapes = Vec::new();
        let mut cursor = at;

        loop {
            if cursor + 4 > range.offset + range.length {
                break;
            }

            let flags = self.data.u16_at(cursor)?;
            let index = u32::from(self.data.u16_at(cursor + 2)?);
            let (dx, dy, at) = self.component_offset(flags, cursor + 4)?;
            let [a, b, c, d] = self.component_transform(flags, at)?;

            cursor = at + Self::transform_size(flags);

            // Only an offset placement is honoured, which is what these fonts
            // use.
            if flags & 0x0002 != 0 {
                for contour in self.outline_of(index, depth + 1)? {
                    shapes.push(
                        contour
                            .into_iter()
                            .map(|point| Point {
                                x: a * point.x + c * point.y + dx,
                                y: b * point.x + d * point.y + dy,
                                on: point.on,
                            })
                            .collect(),
                    );
                }
            }

            if flags & 0x0020 == 0 {
                break;
            }
        }

        Ok(shapes)
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod fabricated;
