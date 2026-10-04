//! GDI's fonts, as winbox.js's `FontManager` keeps them: the strikes loaded
//! from the installation at boot in the order GDI's font directory holds
//! them, and the mapper that answers a description of a font -- a `LOGFONT` --
//! with the strike that best fits it, how many times over to draw it, and the
//! name to report it by.
//!
//! A program does not choose a font, it describes one, and GDI finds the
//! closest thing it has. Everything here was recorded from Windows doing that
//! -- see `oracle/probes/font.c` -- or read out of `GDI.EXE`, because almost
//! none of it is written down, and the parts that read as obvious are the
//! parts that are not. `FONTS.md` section 3 has the penalty table and where in
//! the image each term sits.
//!
//! Each `.TTF` the installation names is loaded beside its `.FOT` stub --
//! GDI's TrueType directory -- and its outlines compete with the strikes:
//! asked for by name, fallen back on for a name not installed, and scored
//! against the strikes where nothing answers by name (see `outlines`).

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::OnceLock;

use serde::Deserialize;
use winbox_raster::logical_font::{Outline, round};
use winbox_raster::{
    BitmapFontEntry, FontHeader, FontResource, LogicalFont, Style, TrueTypeFont, read_bitmap_font,
    read_font_resource,
};

use crate::display::Display;
use crate::system::System;

mod directory;
mod metrics;
mod outlines;

pub use directory::{
    boot, font_directory_order, in_directory_order, profile_section, true_type_file_of,
};
pub use metrics::{TextMetric, text_metrics};
pub use outlines::{BOLD_FILE, Found, Realised, style_key};

/// What the mapper wants of the display: its logical resolution, the shape
/// of its pixel, and whether it can hold a font bigger than a segment.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    #[serde(rename = "logicalPixelsX", default)]
    pub log_pixels_x: i32,
    #[serde(rename = "logicalPixelsY", default)]
    pub log_pixels_y: i32,
    #[serde(default)]
    pub aspect_x: i32,
    #[serde(default)]
    pub aspect_y: i32,
    #[serde(default)]
    pub raster_caps: i32,
    /// Where the driver draws the overhang a smeared bold leaves: `always`
    /// for a Hercules, which keeps it, and `byte` for the colour drivers.
    #[serde(default)]
    pub bold_overhang: Option<BoldOverhang>,
}

/// How a display driver draws the emboldening overhang.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoldOverhang {
    Byte,
    Always,
}

impl Device {
    /// The display's, from the same table `display.rs` reads.
    pub fn of(display: &Display) -> Self {
        static DEVICES: OnceLock<HashMap<String, Device>> = OnceLock::new();

        #[derive(Deserialize)]
        struct Named {
            name: String,
            #[serde(flatten)]
            device: Device,
        }

        DEVICES
            .get_or_init(|| {
                let modes: HashMap<String, Named> =
                    serde_json::from_str(include_str!("../data/displays.json"))
                        .expect("the display modes");

                modes
                    .into_values()
                    .map(|named| (named.name, named.device))
                    .collect()
            })
            .get(&display.name)
            .copied()
            .unwrap_or_default()
    }

    /// `RC_BIGFONT`, bit ten of `RASTERCAPS`.
    pub fn big_font(&self) -> bool {
        self.raster_caps & 0x0400 != 0
    }
}

/// A `LOGFONT`, as a program fills one in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogFont {
    pub height: i16,
    pub width: i16,
    pub escapement: i16,
    pub orientation: i16,
    pub weight: i16,
    pub italic: u8,
    pub underline: u8,
    pub strike_out: u8,
    pub char_set: u8,
    pub out_precision: u8,
    pub clip_precision: u8,
    pub quality: u8,
    pub pitch_and_family: u8,
    /// One character a byte, to its nought, of the 32 the structure holds.
    pub face_name: String,
}

impl LogFont {
    /// The structure's size: five words, eight bytes and the name.
    pub const SIZE: usize = 50;

    /// A `LOGFONT` from its bytes.
    pub fn read(bytes: &[u8]) -> Self {
        let byte = |at: usize| bytes.get(at).copied().unwrap_or(0);
        let word = |at: usize| i16::from_le_bytes([byte(at), byte(at + 1)]);

        Self {
            height: word(0),
            width: word(2),
            escapement: word(4),
            orientation: word(6),
            weight: word(8),
            italic: byte(10),
            underline: byte(11),
            strike_out: byte(12),
            char_set: byte(13),
            out_precision: byte(14),
            clip_precision: byte(15),
            quality: byte(16),
            pitch_and_family: byte(17),
            face_name: (18..50)
                .map(byte)
                .take_while(|&byte| byte != 0)
                .map(char::from)
                .collect(),
        }
    }
}

/// The fields of a `LOGFONT` that steer matching, and what the mapper wants
/// of the display.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    pub face: String,
    pub height: i32,
    pub width: i32,
    pub weight: i32,
    pub italic: bool,
    pub underline: bool,
    pub strikeout: bool,
    pub charset: i32,
    pub pitch_and_family: i32,
    /// The angle the baseline runs at, in tenths of a degree
    /// counter-clockwise, and `lfOrientation`, which the drawing never reads
    /// but the mapper does: `seg3:0f98` refuses an exact strike, and `203d`
    /// charges a synthesised one, when either angle is not nought.
    pub escapement: i32,
    pub orientation: i32,
    /// Proof quality refuses a stretched strike outright; see `choose`.
    pub quality: i32,
    pub log_pixels_x: i32,
    pub log_pixels_y: i32,
    /// The shape of a pixel, `GDIINFO.dpAspectX` and `dpAspectY`: a different
    /// number read from a different place from the resolution, and the one
    /// the strike chooser's off-square term wants.
    pub aspect_x: i32,
    pub aspect_y: i32,
    /// Whether the device can hold a font bigger than a segment; `None` where
    /// nothing said, which holds it to nothing.
    pub big_font: Option<bool>,
    /// Whether the display's driver keeps the emboldening overhang, which
    /// makes a smeared outline string measure one wider.
    pub bold_always: bool,
}

impl Request {
    /// The request `CreateFontIndirect` makes of a `LOGFONT` on a display.
    ///
    /// Five names it rewrites the request for, before the font object is even
    /// stored. **Read out of `GDI.EXE`** at `seg3:0042`: it takes an atom for
    /// the face name and compares it against five of the well-known ones.
    /// `Symbol`, `ZapfDingbats` and `Zapf Dingbats` force `lfCharSet` to
    /// `SYMBOL_CHARSET`; `Tms Rmn` forces it to `ANSI_CHARSET`; and `Helv`
    /// replaces the pitch bits of `lfPitchAndFamily` with `VARIABLE_PITCH`,
    /// leaving the family alone.
    ///
    /// The first of those is what makes a request for Symbol in the ANSI set
    /// come back as Symbol. It is not an exception in the mapper -- by the time
    /// the mapper sees the request it is a symbol request, and every Symbol
    /// candidate pays nothing for its character set where everything else pays
    /// 65,000. See `FontManager::named`.
    pub fn new(logfont: &LogFont, device: &Device) -> Self {
        let named = logfont.face_name.to_lowercase();
        let mut charset = i32::from(logfont.char_set);
        let mut pitch_and_family = i32::from(logfont.pitch_and_family);

        if named == "symbol" || named == "zapfdingbats" || named == "zapf dingbats" {
            charset = SYMBOL_CHARSET;
        } else if named == "tms rmn" {
            charset = ANSI_CHARSET;
        } else if named == "helv" {
            pitch_and_family = (pitch_and_family & !3) | 2;
        }

        Self {
            face: logfont.face_name.clone(),
            height: i32::from(logfont.height),
            width: i32::from(logfont.width),
            weight: i32::from(logfont.weight),
            italic: logfont.italic != 0,
            underline: logfont.underline != 0,
            strikeout: logfont.strike_out != 0,
            charset,
            pitch_and_family,
            escapement: i32::from(logfont.escapement),
            orientation: i32::from(logfont.orientation),
            quality: i32::from(logfont.quality),
            log_pixels_x: device.log_pixels_x,
            log_pixels_y: device.log_pixels_y,
            aspect_x: device.aspect_x,
            aspect_y: device.aspect_y,
            big_font: Some(device.big_font()),
            bold_always: device.bold_overhang == Some(BoldOverhang::Always),
        }
    }
}

/// A strike as GDI's font directory holds it: where it stands in the
/// directory, which is the order the files were loaded and, within a file,
/// the order of its resources; and whether the directory lists it at all.
#[derive(Debug, Clone)]
pub struct Strike {
    pub entry: Rc<BitmapFontEntry>,
    pub order: usize,
    pub listed: bool,
}

/// A strike chosen for a request: how many times over it is drawn each way,
/// and what it cost the mapper. A vector font's cost is not a number, as the
/// TypeScript engine's is `undefined` -- it compares as nothing does.
#[derive(Debug, Clone)]
pub struct Chosen {
    pub entry: Rc<BitmapFontEntry>,
    pub scale: f64,
    pub horizontal: f64,
    pub cost: f64,
}

/// What answers a request: a strike, chosen with its stretch and cost, or
/// an outline file realised at a size -- with whether the file is the style
/// asked for, which decides whether a slant or a smear has to be made, and
/// whether it is the family's bold one.
#[derive(Debug, Clone)]
pub enum Realisation {
    Strike(Chosen),
    Outline {
        font: Rc<TrueTypeFont>,
        realised: Realised,
        exact_style: bool,
        face_bold: bool,
    },
}

/// A request answered: what answers it, and the name the font is reported
/// by.
#[derive(Debug, Clone)]
pub struct Mapped {
    pub realisation: Realisation,
    pub face: String,
    /// Whether the family the mapper settled on was an outline one, even
    /// where a strike ended up being drawn: `tmItalic` answers for it.
    pub outline_family: bool,
}

impl Mapped {
    fn strike(chosen: Chosen, face: String, outline_family: bool) -> Self {
        Self {
            realisation: Realisation::Strike(chosen),
            face,
            outline_family,
        }
    }

    fn outline(found: &Found, realised: Realised) -> Self {
        Self {
            realisation: Realisation::Outline {
                font: found.font.clone(),
                realised,
                exact_style: found.exact,
                face_bold: found.face_bold,
            },
            face: found.name.clone(),
            outline_family: false,
        }
    }
}

/// What the penalty routine reads of a candidate: a strike's header, or
/// what GDI's TrueType directory keeps of an outline's stub.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
pub struct Candidate {
    pub char_set: i32,
    pub pitch_and_family: i32,
    pub weight: i32,
    pub italic: bool,
    pub kind: i32,
    pub underline: bool,
    pub strike_out: bool,
    pub scalable: bool,
}

impl Candidate {
    pub fn of(header: &FontHeader) -> Self {
        Self {
            char_set: i32::from(header.char_set),
            pitch_and_family: i32::from(header.pitch_and_family),
            weight: i32::from(header.weight),
            italic: header.italic != 0,
            kind: i32::from(header.kind),
            underline: header.underline != 0,
            strike_out: header.strike_out != 0,
            scalable: false,
        }
    }

    /// An outline file as the competition scores it: the stub's character
    /// set and pitch and family where there is a stub, and the file's own
    /// weight class and slant.
    fn of_outline(font: &TrueTypeFont) -> Self {
        let stub = font.resource.borrow();

        Self {
            char_set: stub
                .as_ref()
                .map_or(if font.symbolic() { SYMBOL_CHARSET } else { 0 }, |stub| {
                    i32::from(stub.char_set)
                }),
            pitch_and_family: stub
                .as_ref()
                .map_or(0, |stub| i32::from(stub.pitch_and_family)),
            weight: if font.bold_face() { 700 } else { 400 },
            italic: font.italic_face(),
            kind: 0,
            underline: false,
            strike_out: false,
            scalable: true,
        }
    }
}

/// `lfPitchAndFamily`, in the pieces the mapper reads it in.
const FIXED_PITCH: i32 = 0x01;
const FF_ROMAN: i32 = 0x10;
const FF_MODERN: i32 = 0x30;

/// `lfCharSet` values that decide a mapping on their own.
pub const ANSI_CHARSET: i32 = 0x00;
const DEFAULT_CHARSET: i32 = 0x01;
pub const SYMBOL_CHARSET: i32 = 0x02;
pub const OEM_CHARSET: i32 = 0xff;

/// How many times over a strike may be drawn to reach a size.
const MAX_STRETCH: f64 = 8.0;

/// And the most it is drawn sideways, which is not the same number.
const MAX_WIDTH_STRETCH: f64 = 5.0;

/// What a device without `RC_BIGFONT` is held to: one segment.
const FONT_SEGMENT: f64 = 65_536.0;

/// The quality at which a stretched strike is refused rather than scored.
///
/// Read out of `GDI.EXE` and then asked for: the mapper's penalty routine
/// tests `lfQuality` against this before it adds a single term, and answers
/// the largest penalty there is where it matches, which takes the candidate
/// out of the running altogether.
///
/// **Recorded**, and it is exactly the stretched candidates that go: at proof
/// quality every one of six faces answers with a height it has a strike
/// installed at and never with a multiple of one. Fixedsys, whose only strike
/// is fifteen rows, answers fifteen for every request from eight to fifty
/// where the default quality answers 30 and 45. Courier answers 13, 16 or 20
/// and never 26, 32, 40 or 48.
const PROOF_QUALITY: i32 = 2;

// The mapper's penalty weights, from GDI's own table at `0x39c`, each
// multiplied by 1024 as the table is built.
const STRETCH_PENALTY: f64 = 20.0 * 1024.0;
const HEIGHT_PENALTY: f64 = 150.0 * 1024.0;
const TALLER_PENALTY: f64 = 600.0 * 1024.0;

const ASPECT_PENALTY: f64 = 30.0 * 1024.0;
const RATIO_PENALTY: f64 = 4.0 * 1024.0;
/// `1e49`: flat, for being drawn more than once either way.
const MULTIPLE_PENALTY: f64 = 50.0 * 1024.0;

/// What a candidate pays for not being the face that was asked for, from the
/// same table: the mapper adds `AddAtom` on the candidate's name and charges
/// this when it matches neither the name requested nor its alias. It dwarfs
/// every other term, which is why a request that names a face gets that face
/// -- until the height term outgrows it.
const FACE_PENALTY: f64 = 10_000.0 * 1024.0;
/// What a candidate pays for being the alias of the name asked for.
const ALIAS_PENALTY: f64 = 500.0 * 1024.0;

// The rest of the table, in the order `0x39c` holds it. Each names the
// instruction that charges it; see `FONTS.md` section 3.
/// `18d2`: the candidate's `dfCharSet` is not the one asked for.
const CHARSET_PENALTY: f64 = 65_000.0 * 1024.0;
/// `19b1`: fixed pitch asked for and a variable one got.
const FIXED_PENALTY: f64 = 15_000.0 * 1024.0;
/// `19c8`: variable pitch asked for and a fixed one got.
const VARIABLE_PENALTY: f64 = 350.0 * 1024.0;
/// `19e0`: no pitch asked for at all and a fixed one got.
const PITCH_PENALTY: f64 = 1024.0;
/// `1a37`: the family asked for is not the candidate's.
const FAMILY_PENALTY: f64 = 9000.0 * 1024.0;
/// `1a44`: the same, where the candidate claims no family.
const NO_FAMILY_PENALTY: f64 = 8000.0 * 1024.0;
/// `1a26`: and 50 more when only one of the two is above `FF_MODERN`.
const FAMILY_SIDE_PENALTY: f64 = 50.0 * 1024.0;
/// `1f35`: three for every ten of weight, after the synthesis adjustment.
const WEIGHT_PENALTY: f64 = 3.0 * 1024.0;
/// `1fa4`: the candidate is slanted and the request is not, or the reverse.
const ITALIC_PENALTY: f64 = 4.0 * 1024.0;
/// `1f86`: a slant the candidate does not have and can be given.
const SLANT_PENALTY: f64 = 1024.0;
/// `1fe0` and `201c`: an underline or a strikeout that does not match.
const UNDERLINE_PENALTY: f64 = 3.0 * 1024.0;
const STRIKEOUT_PENALTY: f64 = 3.0 * 1024.0;
/// `2052`: a raster or vector candidate made bold or slanted for turned text.
/// The smallest weight in the table; see `named`.
const TURNED_PENALTY: f64 = 1024.0;

/// `1ee8`: over this much heavier than the candidate and a bold is made.
const SMEAR_ABOVE: i32 = 150;
/// And the candidate is treated as this much heavier once one is.
const SMEAR_BY: i32 = 120;

/// A square device pixel, as the mapper counts aspect: hundredths.
const SQUARE: f64 = 100.0;

/// The size the mapper picks when a request names none, in points.
const DEFAULT_POINTS: f64 = 12.0;

/// The faces a name should be looked for under.
///
/// `WIN.INI` carries a `[FontSubstitutes]` section, and these are what a stock
/// Windows 3.1 installation puts in it. A program asking for Helv gets MS Sans
/// Serif and is not told, which is why `ANSI_VAR_FONT` measures as MS Sans
/// Serif while `GetTextFace` still answers "Helv".
const SUBSTITUTES: [(&str, &str); 4] = [
    ("helv", "MS Sans Serif"),
    ("tms rmn", "MS Serif"),
    ("times", "Times New Roman"),
    ("helvetica", "Arial"),
];

fn substitute(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();

    SUBSTITUTES
        .iter()
        .find(|(from, _)| *from == lower)
        .map(|(_, to)| *to)
}

/// Whether a file's name ends in an extension, without regard to case.
fn has_extension(name: &str, extension: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ending)| ending.eq_ignore_ascii_case(extension))
}

/// JavaScript's `ToInt32`: a number as the bitwise operators take it.
fn int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }

    (value.trunc() % 4_294_967_296.0) as i64 as i32
}

/// `a | b`, as JavaScript's `|` does it.
fn or32(a: f64, b: f64) -> f64 {
    f64::from(int32(a) | int32(b))
}

/// `x >> 1`, as JavaScript's `>>` does it.
fn half(value: f64) -> f64 {
    f64::from(int32(value) >> 1)
}

/// `MulDiv`, which rounds to nearest, as GDI's does at `seg1:41b0`.
fn muldiv(a: f64, b: f64, c: f64) -> f64 {
    ((a * b + half(c)) / c).floor()
}

/// A number `|| fallback`: nought is no answer.
fn or(value: i32, fallback: i32) -> f64 {
    f64::from(if value == 0 { fallback } else { value })
}

/// An outline family's files, each by its style.
pub type Family = Vec<(String, Rc<TrueTypeFont>)>;

/// The fonts GDI has: each face's strikes, by its name in the order the
/// faces were first loaded, each outline family's files, and the installer's
/// `.FOT` stubs.
#[derive(Debug, Clone, Default)]
pub struct FontManager {
    fonts: Vec<(String, Vec<Strike>)>,
    /// Each outline family by its name, in the order first loaded, and each
    /// of its files by its style, `regular`, `bold`, `regular-italic` and
    /// `bold-italic`, in the order loaded.
    outlines: Vec<(String, Family)>,
    /// What the installer's `.FOT` files say about each `.TTF`, by file name.
    resources: HashMap<String, FontResource>,
    /// GDI's TrueType directory: each `.FOT` installed, in the order it was,
    /// which is the order `EnumFontFamilies` hands them out in (`GDI.EXE`
    /// seg5 `070f`).
    pub true_type_directory: Vec<FontResource>,
    /// Where the next strike stands in the directory. The mapper's ties go
    /// to the earliest.
    order: usize,
}

impl FontManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Loads a font file by its name and bytes. `listed` is whether GDI's
    /// font table has it: the boot fonts and `WIN.INI` `[fonts]` do; a file
    /// loaded only so that a program naming its face is answered does not, and
    /// is not enumerated.
    pub fn load(&mut self, name: &str, bytes: Vec<u8>, listed: bool) {
        if has_extension(name, "fon") {
            // Every entry is kept, not just one per face. Several files carry
            // a face called Terminal at sizes that have nothing to do with each
            // other -- DOSAPP.FON's smallest is six pixels tall -- so
            // remembering only the last file to mention a name means the size a
            // caller asks for may not be among the ones on offer.
            for entry in read_bitmap_font(bytes) {
                let strike = Strike {
                    entry: Rc::new(entry),
                    order: self.order,
                    listed,
                };

                self.order += 1;

                let face = strike.entry.name().to_string();

                match self.fonts.iter_mut().find(|(name, _)| *name == face) {
                    Some((_, strikes)) => strikes.push(strike),
                    None => self.fonts.push((face, vec![strike])),
                }
            }

            return;
        }

        // The installer's resource for a TrueType face, which is where the
        // pitch and family GDI reports come from.
        if has_extension(name, "fot") {
            let Some(resource) = read_font_resource(&bytes) else {
                return;
            };

            if listed {
                self.true_type_directory.push(resource.clone());
            }

            // The stub may arrive before or after its `.TTF`, so it is kept by
            // file name and applied whichever comes second.
            for (_, family) in &self.outlines {
                for (_, font) in family {
                    if font.file_name.borrow().as_deref() == Some(resource.file.as_str()) {
                        *font.resource.borrow_mut() = Some(resource.clone());
                    }
                }
            }

            self.resources.insert(resource.file.clone(), resource);

            return;
        }

        if has_extension(name, "ttf") {
            self.load_outline(name, bytes);
        }
    }

    /// What the installer's stub says about a `.TTF`, by its file name.
    pub fn resource(&self, file: &str) -> Option<&FontResource> {
        self.resources.get(file)
    }

    /// Every strike of every face GDI's font table has, in its order, with
    /// its face's name.
    pub fn listed_entries(&self) -> Vec<&Strike> {
        let mut listed: Vec<&Strike> = self
            .fonts
            .iter()
            .flat_map(|(_, strikes)| strikes)
            .filter(|strike| strike.listed)
            .collect();

        listed.sort_by_key(|strike| strike.order);
        listed
    }

    /// Every size of a face that has been loaded, after substitution.
    ///
    /// The name is matched without regard to case but not to spacing: `ms
    /// sans serif` finds MS Sans Serif and `MSSansSerif` finds nothing, which
    /// is what Windows does. A program reading a face name out of an INI file
    /// passes on whatever was written there, so the case rarely matches how
    /// the font was installed.
    pub fn lookup(&self, name: &str) -> Option<(&str, &[Strike])> {
        let wanted = substitute(name).unwrap_or(name).to_lowercase();

        self.fonts
            .iter()
            .find(|(installed, _)| installed.to_lowercase() == wanted)
            .map(|(installed, strikes)| (installed.as_str(), strikes.as_slice()))
    }

    /// Whether a name is installed and is itself an OEM face.
    fn is_oem(&self, name: &str) -> bool {
        self.lookup(name).is_some_and(|(_, strikes)| {
            strikes
                .iter()
                .any(|strike| i32::from(strike.entry.header.char_set) == OEM_CHARSET)
        })
    }

    /// What a request with no usable face name falls back to.
    ///
    /// With nothing named, the pitch and family are all the mapper has, and
    /// this is how a program asks for "any fixed-pitch font" without caring
    /// which. Recorded rather than reasoned about, in the `font` fixtures.
    pub fn family_face(pitch_and_family: i32) -> &'static str {
        // The low two bits are the pitch; the high nibble is the family.
        let pitch = pitch_and_family & 0x03;
        let family = pitch_and_family & 0xf0;

        if pitch == FIXED_PITCH || family == FF_MODERN {
            return "Courier";
        }

        if family == FF_ROMAN {
            return "MS Serif";
        }

        "MS Sans Serif"
    }

    /// Everything the penalty routine charges a candidate that is not its
    /// size, and whether it would smear a bold.
    ///
    /// **Read out of `GDI.EXE`**, at `seg3:17b4`; `FONTS.md` section 3 has the
    /// whole table with the instruction that charges each term. This is the
    /// half that a scalable candidate pays too -- `1ba6` sends it past every
    /// size term and straight to the end -- so it is written once.
    pub fn named(header: &Candidate, name: &str, request: &Request) -> (f64, bool) {
        let mut cost = 0.0;

        // The name, by atom. A request that named none charges nothing to
        // anyone, which is what lets the other terms decide.
        if !request.face.is_empty() {
            let asked = request.face.to_lowercase();
            let candidate = name.to_lowercase();

            if candidate != asked {
                let alias =
                    substitute(&asked).is_some_and(|alias| alias.to_lowercase() == candidate);

                cost += if alias { ALIAS_PENALTY } else { FACE_PENALTY };
            }
        }

        if header.char_set != request.charset {
            cost += CHARSET_PENALTY;
        }

        // The pitch, in the two encodings that do not agree: `lfPitchAndFamily`
        // counts 1 as fixed and 2 as variable, and `dfPitchAndFamily` carries a
        // bit that is set when the face is variable.
        let pitch = request.pitch_and_family & 3;
        let fixed = header.pitch_and_family & FIXED_PITCH == 0;

        cost += match pitch {
            0 if fixed => PITCH_PENALTY,
            1 if !fixed => FIXED_PENALTY,
            2 if fixed => VARIABLE_PENALTY,
            _ => 0.0,
        };

        let want_family = request.pitch_and_family & 0xf0;
        let has_family = header.pitch_and_family & 0xf0;

        if want_family != 0 && want_family != has_family {
            if has_family == 0 {
                cost += NO_FAMILY_PENALTY;
            } else {
                let together = (want_family <= FF_MODERN && has_family <= FF_MODERN)
                    || (want_family > FF_MODERN && has_family > FF_MODERN);

                cost += if together {
                    FAMILY_PENALTY
                } else {
                    FAMILY_PENALTY + FAMILY_SIDE_PENALTY
                };
            }
        }

        // The weight, three for every ten -- and before it is taken the
        // candidate is made bold where the request is more than 150 heavier,
        // which is the threshold measured from outside as "bold is synthesised
        // above 550".
        let asked = request.weight;
        let mut has = if header.weight == 0 {
            400
        } else {
            header.weight
        };
        let mut smeared = false;

        if asked != 0 {
            if has + SMEAR_ABOVE < asked {
                has += SMEAR_BY;
                smeared = true;
            }

            cost += WEIGHT_PENALTY * muldiv(1.0, f64::from((asked - has).abs()), 10.0);
        } else {
            cost += WEIGHT_PENALTY * muldiv(1.0, f64::from((400 - has).abs()), 20.0);
        }

        let slanted = header.italic;
        let shears = request.italic && !slanted;

        if shears {
            cost += SLANT_PENALTY;
        } else if request.italic != slanted {
            cost += ITALIC_PENALTY;
        }

        // A strike that would have to be made bold or slanted, for text that
        // is turned, pays one more.
        //
        // **Read out of `GDI.EXE`.** The penalty routine keeps the synthesis it
        // decides on as flags in the low bits of the running penalty, which
        // every weight leaves clear by being a multiple of 1024: `1ef5` sets
        // `0x100` for a bold it will smear and `1f82` sets `0x200` for a slant
        // it will shear. `202d` tests the two, `2036` and `203d` test
        // `lfEscapement` and `lfOrientation`, and `2044` charges `w[0x5c]` --
        // the twenty-fourth word of the table at `0x39c`, which is 1 -- to a
        // candidate whose `dfType & 3` is nought or one, a raster or vector
        // face. A scalable one never pays it, and a strike is never scalable.
        let turned = request.escapement != 0 || request.orientation != 0;

        if turned && (smeared || shears) && !header.scalable && header.kind & 3 <= 1 {
            cost += TURNED_PENALTY;
        }

        // An underline or a strikeout the candidate does not have is drawn on
        // rather than charged for; only the other direction costs anything.
        if !request.underline && header.underline {
            cost += UNDERLINE_PENALTY;
        }

        if !request.strikeout && header.strike_out {
            cost += STRIKEOUT_PENALTY;
        }

        (cost, smeared)
    }

    /// Scores every face in the directory and answers with the cheapest.
    ///
    /// This is what GDI does when nothing has answered by name: `seg3:0550`
    /// walks the raster and vector faces first, keeping the lowest penalty,
    /// and then walks the scalable ones with that as a limit -- and the second
    /// walk has to come in **strictly** under it to displace the first. A tie
    /// therefore goes to the raster answer, which is why a request naming no
    /// face at sixteen pixels is MS Sans Serif on a VGA, where that face has
    /// an exact sixteen row strike and pays nothing, and Arial on an EGA,
    /// where every strike pays the off-square term. See `FONTS.md` section 3.
    fn compete(&self, request: &Request) -> Option<Mapped> {
        // In the order GDI's directory holds them, which is the order the
        // files were loaded and, within a file, the order of its resources.
        // Ties go to the earliest, and two faces can both be exact: Wingdings
        // asked for in the ANSI set at ten pixels answers Small Fonts and not
        // MS Serif, whose ten row strike sits after Small Fonts' own in
        // `SMALLE.FON`.
        let mut directory: Vec<(&str, &Strike)> = self
            .fonts
            .iter()
            .flat_map(|(name, strikes)| strikes.iter().map(move |strike| (name.as_str(), strike)))
            .collect();

        directory.sort_by_key(|(_, strike)| strike.order);

        let mut best: Option<(f64, &str, Chosen)> = None;

        for (name, strike) in directory {
            let (cost, _) = Self::named(&Candidate::of(&strike.entry.header), name, request);
            let Some(sized) = Self::choose(std::slice::from_ref(&strike.entry), request) else {
                continue;
            };
            // A vector font's cost is not a number, and neither is the total:
            // it displaces nothing, and once kept, nothing displaces it.
            let total = cost + sized.cost;

            if best.as_ref().is_none_or(|(kept, _, _)| total < *kept) {
                best = Some((total, name, sized));
            }
        }

        // The scalable walk. Each TrueType entry carries two names, the
        // family and the full name, and the face term is waived for a request
        // matching either: **read out of `GDI.EXE`**, the penalty routine
        // compares the request's atom against `[es:si+0x26]` and `[es:si+0x28]`
        // at `1869` and `1873`, and the alias against the same two. It is
        // reported by the name that matched. **Recorded** by `rotsize`.
        let mut outline: Option<(f64, Rc<TrueTypeFont>, String)> = None;
        let asked = request.face.to_lowercase();

        for (installed, family) in &self.outlines {
            for (_, font) in family {
                let full = font.full_name();
                let full_lower = full.to_lowercase();
                let by_full = !request.face.is_empty()
                    && full_lower != installed.to_lowercase()
                    && (asked == full_lower
                        || substitute(&asked).unwrap_or("").to_lowercase() == full_lower);
                let (cost, _) = Self::named(
                    &Candidate::of_outline(font),
                    if by_full { &full } else { installed },
                    request,
                );

                // A scalable candidate pays nothing for size, except where the
                // request is within two pixels of nothing; `1e9e`. A height of
                // nought has already become twelve points of the device, as a
                // negative height, at `05a0`.
                let height = if request.height == 0 {
                    -muldiv(DEFAULT_POINTS, or(request.log_pixels_y, 96), 72.0)
                } else {
                    f64::from(request.height)
                };
                let total = cost
                    + if (-2.0..=2.0).contains(&height) {
                        HEIGHT_PENALTY + TALLER_PENALTY
                    } else {
                        0.0
                    };

                if outline.as_ref().is_none_or(|kept| total < kept.0)
                    && best.as_ref().is_none_or(|kept| total < kept.0)
                {
                    let reported = if by_full && asked == full_lower {
                        full
                    } else {
                        installed.clone()
                    };

                    outline = Some((total, font.clone(), reported));
                }
            }
        }

        if let Some((_, font, reported)) = outline
            && let Some(realised) = Self::realise_outline(&font, request)
        {
            // Whether the file that won is the style asked for, which decides
            // whether a slant or a smear has to be made: the competition can
            // settle on a regular file for an italic request.
            let exact_style = font.italic_face() == request.italic
                && font.bold_face() == (request.weight > BOLD_FILE);
            let face_bold = font.bold_face();

            return Some(Mapped {
                realisation: Realisation::Outline {
                    font,
                    realised,
                    exact_style,
                    face_bold,
                },
                face: reported,
                outline_family: true,
            });
        }

        best.map(|(_, name, chosen)| Mapped::strike(chosen, name.to_string(), false))
    }

    /// Finds the installed font that best answers a description of one.
    ///
    /// The order matters. A character set that is not ANSI decides the answer
    /// on its own, ahead of any name: asking for Terminal with `ANSI_CHARSET`
    /// does not give you Terminal, it gives you MS Sans Serif, because Terminal
    /// is an OEM font and the character set is the stronger constraint.
    ///
    /// An outline of the name asked for answers before the strikes are
    /// consulted, and an unrecognised name falls to Times New Roman rather
    /// than to the family default. Below twelve pixels a strike of exactly
    /// the height asked for beats the outline -- the face's own, in its own
    /// weight class, or one of the two small faces -- where the outline's
    /// stub says it is an ANSI face of variable pitch (`seg3:13db`, `13e1`)
    /// and the text is upright (`126a`). A name whose family has no file in
    /// the style asked for competes, and so does a small upright name nothing
    /// is installed under. **Recorded** across the `font`, `rotsize` and
    /// `maxwidth` sweeps on four displays; see `FONTS.md` sections 3 and 8u.
    #[allow(clippy::too_many_lines)]
    pub fn map(&self, request: &Request) -> Option<Mapped> {
        let charset = request.charset;
        let pitch_and_family = request.pitch_and_family;
        let mut face = request.face.clone();

        if charset == SYMBOL_CHARSET {
            // The set outranks the name, but a name that is itself a symbol
            // face keeps it: asked for Wingdings in the symbol set, Windows
            // answers with Wingdings at every height recorded.
            let named = self.outline(&face, false, false);
            let symbolic = named.as_ref().filter(|named| named.font.symbolic());

            if symbolic.is_none()
                && let Some(competed) = self.compete(request)
            {
                return Some(competed);
            }

            face = symbolic.map_or_else(|| "Symbol".to_string(), |named| named.name.clone());
        } else if charset == OEM_CHARSET && !self.is_oem(&face) {
            // The OEM character set is answered by Roman unless something else
            // OEM was named, and being installed is not enough to count as
            // something else: `Courier`, `System` and `MS Sans Serif` are all
            // installed, all named explicitly, and all answered with Roman.
            face = "Roman".to_string();
        } else if face.is_empty() {
            // A request that names no face at all is not given a family
            // default: it goes to the scored competition, which is what
            // `seg3:0550` does once `0e95` has failed to answer it by name.
            if let Some(competed) = self.compete(request) {
                return Some(competed);
            }

            face = Self::family_face(pitch_and_family).to_string();
        }

        // The bold file is chosen above 600, and bold is synthesised above
        // 550: **recorded**, every ten of weight from 500 to 700.
        let wants_bold = request.weight > BOLD_FILE;
        let wants_italic = request.italic;
        let named = self.outline(&face, wants_bold, wants_italic);

        // A name with strikes and no outline finds no outline, and must not
        // fall back to Times New Roman: Courier is not Courier New.
        let outline = named.clone().or_else(|| {
            if self.lookup(&face).is_some() || face.is_empty() {
                None
            } else {
                self.outline(outlines::FALLBACK_OUTLINE, wants_bold, wants_italic)
            }
        });

        // A symbol outline is rejected by a request that did not ask for
        // symbols, the same way an OEM strike is: WingDings asked for in ANSI
        // comes back as MS Sans Serif.
        let usable = outline.as_ref().filter(|outline| {
            charset != OEM_CHARSET
                && !(outline.font.symbolic()
                    && charset != SYMBOL_CHARSET
                    && self.lookup(&outline.name).is_none())
        });

        if let Some(outline) = usable {
            if let Some(mapped) = self.small_or_own(request, &face, named.as_ref(), outline) {
                return Some(mapped);
            }

            if let Some(realised) = Self::realise_outline(&outline.font, request) {
                return Some(Mapped::outline(outline, realised));
            }
        }

        // A name the directory holds but cannot answer in this character set
        // -- Wingdings asked for in the ANSI set -- is scored like any other:
        // the searches in `seg3:0e95` all require the charset to match.
        if outline.is_some()
            && usable.is_none()
            && !wants_italic
            && charset != OEM_CHARSET
            && let Some(competed) = self.compete(request)
        {
            return Some(competed);
        }

        // An OEM face is no use to a request that did not ask for one, and
        // Windows treats it as though it were not installed: asking for
        // Terminal in the ANSI character set gives MS Sans Serif. A symbol face
        // is not rejected the same way -- asking for Symbol gives Symbol -- so
        // this is narrower than "the character sets must match".
        let entries: Option<Vec<Rc<BitmapFontEntry>>> =
            self.lookup(&face).and_then(|(_, strikes)| {
                let matching: Vec<Rc<BitmapFontEntry>> = strikes
                    .iter()
                    .filter(|strike| {
                        charset == OEM_CHARSET
                            || i32::from(strike.entry.header.char_set) != OEM_CHARSET
                    })
                    .map(|strike| strike.entry.clone())
                    .collect();

                (!matching.is_empty()).then_some(matching)
            });

        // Two separate facts, and conflating them costs a lot: whether anything
        // was found under the name, which decides whether to fall back, and
        // whether `WIN.INI` redirected the name, which decides what to call the
        // result.
        let found = entries.is_some();

        // A name whose only strikes the charset refuses has answered nothing,
        // and the competition runs. Terminal asked for in the ANSI set is the
        // case: every strike it has is an OEM one, so none of the searches in
        // `0e95` will take it, and `0550` scores the directory.
        if !found
            && !request.face.is_empty()
            && self.lookup(&face).is_some()
            && let Some(competed) = self.compete(request)
        {
            return Some(competed);
        }

        // A request for italic changes what gets picked where the mapper is
        // falling back rather than honouring a name: `Terminal`, `WingDings`
        // and an empty name all answer with Arial's italic file, at an
        // overhang of nought. **Recorded.**
        let falling_back = request.face.is_empty() || !found;
        let plain_charset = charset == ANSI_CHARSET || charset == DEFAULT_CHARSET;

        if wants_italic
            && falling_back
            && plain_charset
            && let Some(family) =
                self.outline(Self::family_outline(pitch_and_family), wants_bold, true)
            && family.font.italic_face()
            && let Some(realised) = Self::realise_outline(&family.font, request)
        {
            return Some(Mapped {
                realisation: Realisation::Outline {
                    font: family.font.clone(),
                    realised,
                    exact_style: family.exact,
                    face_bold: false,
                },
                face: family.name,
                outline_family: false,
            });
        }

        // A redirected name is the one case where the request is echoed back
        // rather than the font that answered it: a program asking for Helv is
        // told Helv, though MS Sans Serif is what gets drawn. Everything else
        // is told the name of the face it actually got, including a program
        // that spelled an installed name in the wrong case -- `ms sans serif`
        // is answered with `MS Sans Serif`.
        let substituted = substitute(&request.face).is_some();

        let entries = match entries {
            Some(entries) => entries,
            None => self
                .lookup(Self::family_face(pitch_and_family))?
                .1
                .iter()
                .map(|strike| strike.entry.clone())
                .collect(),
        };

        if entries.is_empty() {
            return None;
        }

        let chosen = Self::choose(&entries, request);

        // A family of strikes loses to some other face's outline once its best
        // strike costs more than the wrong name does, and a family with no
        // candidate at all does too: the first outline in the directory pays
        // the same 10,000 as every other. **Recorded**: four bitmap families
        // at a hundred pixels answer with Arial at proof quality.
        if chosen
            .as_ref()
            .is_none_or(|chosen| found && chosen.cost > FACE_PENALTY)
        {
            let symbols = charset == SYMBOL_CHARSET;

            for (installed, _) in &self.outlines {
                let Some(other) = self.outline(installed, wants_bold, wants_italic) else {
                    continue;
                };

                if other.font.symbolic() != symbols {
                    continue;
                }

                if let Some(realised) = Self::realise_outline(&other.font, request) {
                    return Some(Mapped::outline(&other, realised));
                }

                break;
            }
        }

        let chosen = chosen?;
        let echo = found && substituted && !request.face.is_empty();
        let face = if echo {
            request.face.clone()
        } else {
            chosen.entry.name().to_string()
        };

        Some(Mapped::strike(chosen, face, false))
    }

    /// Where an outline the name found is answered by a strike instead, or
    /// by the competition.
    ///
    /// A face's own strike is tried first and on its own terms, and only for
    /// a face that is not a symbol one, upright where a slant was asked of a
    /// family whose strikes have none, and not turned: `0ef6` refuses an
    /// entry at `0f91` and `0f98` for either angle. Then the small faces,
    /// below twelve pixels and only where no width was asked for -- a width
    /// takes the strikes away altogether, **recorded** by `maxwidth`, 122 of
    /// the VGA's records. A face's own strike answers only when it answers
    /// *exactly*, in the weight and the slant asked: **recorded**, Symbol on
    /// an EGA and a Hercules, where the off-square term then decides.
    ///
    /// Nothing of the name answering, a family with no file in the style
    /// asked for competes, as every search in `0e95` wants the weight and the
    /// slant equal; and so does a small upright name nothing is installed
    /// under, which reaches `126a` from `125e` and competes when that finds
    /// no strike. A name the TrueType directory matches outright never does
    /// (`1145`).
    fn small_or_own(
        &self,
        request: &Request,
        face: &str,
        named: Option<&Found>,
        outline: &Found,
    ) -> Option<Mapped> {
        let charset = request.charset;
        let wants_italic = request.italic;
        let own = self.lookup(&outline.name).map(|_| outline.name.clone());
        let symbolic = outline.font.symbolic();
        // Nought is `lfWeight`'s "no preference", not a weight of nothing.
        let wanted = if request.weight == 0 {
            400
        } else {
            request.weight
        };
        let small = outline
            .font
            .resource
            .borrow()
            .as_ref()
            .is_none_or(|stub| stub.char_set == 0 && stub.pitch_and_family & 1 == 1);
        let slanted = !wants_italic
            || own
                .as_deref()
                .and_then(|own| self.lookup(own))
                .is_some_and(|(_, strikes)| {
                    strikes.iter().any(|strike| strike.entry.header.italic != 0)
                });
        let angled = request.escapement != 0 || request.orientation != 0;
        let fixed = outline.font.fixed_pitch();
        let height = request.height;

        let first = match &own {
            Some(own) if !symbolic && slanted && !angled => self.strike_at(
                height,
                charset,
                fixed,
                Some(own),
                true,
                wanted,
                request.width,
                &[],
            ),
            _ => None,
        };
        let strike = first.or_else(|| {
            let refused = request.width != 0
                || if symbolic {
                    !slanted || angled
                } else {
                    !small || request.escapement != 0
                };

            if refused {
                return None;
            }

            let only = symbolic.then(|| own.clone().unwrap_or_else(|| outline.name.clone()));

            self.strike_at(
                height,
                charset,
                fixed,
                only.as_deref(),
                symbolic && own.is_some(),
                wanted,
                0,
                Self::small_faces(request.pitch_and_family),
            )
        });

        if let Some(strike) = strike {
            let weight_of = |entry: &BitmapFontEntry| {
                if entry.header.weight == 0 {
                    400
                } else {
                    i32::from(entry.header.weight)
                }
            };
            let exact_own = strike.name != outline.name
                || strike.entries.iter().any(|entry| {
                    weight_of(entry) == wanted && (entry.header.italic != 0) == wants_italic
                });

            if exact_own {
                let chosen = Self::choose(&strike.entries, request)?;

                // `tmItalic` answers for the family the mapper settled on: a
                // slant on Small Fonts reached from Arial is 255, and on Small
                // Fonts asked for by name 1. Only another family's strike is a
                // fallback. **Recorded**, eighteen records of the EGA sweep.
                return Some(Mapped::strike(
                    chosen,
                    strike.name.clone(),
                    strike.name != outline.name,
                ));
            }
        }

        let unmatched_small = named.is_none()
            && !face.is_empty()
            && self.lookup(face).is_none()
            && request.escapement == 0
            && ((0..=11).contains(&height) || (-10..=-1).contains(&height));
        let directory_match = named.is_some_and(|named| {
            wanted == if named.font.bold_face() { 700 } else { 400 }
                && request.italic == named.font.italic_face()
        });

        if (named.is_some() && own.is_some() && !directory_match) || unmatched_small {
            return self.compete(request);
        }

        None
    }

    /// How many bytes a strike drawn `times` up and `across` sideways comes
    /// to: the realised font's own size -- its header, its character table,
    /// and a bitmap of `dfWidthBytes` stretched both ways. See `choose`.
    pub fn segment_size(entry: &BitmapFontEntry, times: f64, across: f64) -> f64 {
        let header = &entry.header;
        let table = f64::from(i32::from(header.last_char) - i32::from(header.first_char) + 2)
            * f64::from(entry.entry_size() as u32);

        f64::from(entry.table_offset() as u32)
            + table
            + f64::from(header.width_bytes) * across * f64::from(header.pix_height) * times
    }

    /// Picks which strike of a face answers a height, and how much to
    /// stretch it.
    ///
    /// A positive height asks for a cell that tall, including the leading
    /// above the characters; a negative one asks for the characters themselves
    /// to be that tall, which is a smaller number for the same font; and zero
    /// asks for the mapper's own default, which is twelve points.
    ///
    /// Beyond the largest strike installed, Windows stretches one rather than
    /// refusing: a hundred pixel MS Sans Serif is the twenty pixel strike at
    /// five times size, exact in every metric. It picks the strike and the
    /// factor that land on the requested height, which is why the answer is
    /// 100 and not 111.
    #[allow(clippy::too_many_lines)]
    pub fn choose(entries: &[Rc<BitmapFontEntry>], request: &Request) -> Option<Chosen> {
        let height = request.height;
        let width = request.width;

        // Whether the target is a cell or the characters within it. The
        // internal leading is the difference, and it varies from strike to
        // strike, so the comparison has to be made per strike rather than once.
        let wants_cell = height > 0;

        // What a pixel of this device is shaped like, in hundredths: a hundred
        // where it is square, and a hundred and twenty-six on an EGA.
        //
        // **Read out of the binary.** The penalty routine at `seg3:17b4` forms
        // it at `1d34` as `MulDiv(100, arg, arg)` from two words the mapper's
        // loop at `2841` passes it, and those two are `[si+0x2a]` and
        // `[si+0x28]` of the device's `GDIINFO` -- `dpAspectY` and `dpAspectX`.
        // Not the logical resolution: a VGA reports 36 and 36 and an EGA 38 and
        // 48, so this is 100 and 126 where the resolution would say 100 and 133.
        let square = muldiv(100.0, or(request.aspect_y, 96), or(request.aspect_x, 96));

        // No height named means the mapper's own default, which is twelve
        // points: a size rather than a cell, so it is compared the way a
        // negative height is. Twelve points is a size on the page, and how many
        // rows it comes to is the device's own vertical resolution: sixteen on
        // a VGA and twelve on an EGA. **Recorded.**
        let target = if height == 0 {
            muldiv(DEFAULT_POINTS, or(request.log_pixels_y, 96), 72.0)
        } else {
            f64::from(height.abs())
        };

        // A scalable face has one design and is drawn at whatever size is
        // wanted, so none of the business below -- nearest strike, whole-number
        // stretch, never overshoot -- applies to it. It is realised exactly.
        if let Some(entry) = entries.first().filter(|entry| entry.is_vector()) {
            let header = &entry.header;

            // A negative height asks for the characters rather than the cell,
            // and the leading is a fixed fraction of the design, so the cell it
            // implies follows from it. Zero asks for the mapper's default, the
            // same twelve points a bitmap face gets: on a VGA sixteen
            // characters inside Roman's twenty-eight row design make an
            // eighteen row cell, and on an EGA fourteen. **Recorded**, for all
            // three plotter fonts on both displays.
            let design = f64::from(header.pix_height);
            let em = design - f64::from(header.internal_leading);

            let mut cell = f64::from(height.abs());

            if height <= 0 {
                let characters = if height == 0 {
                    muldiv(DEFAULT_POINTS, or(request.log_pixels_y, 96), 72.0)
                } else {
                    f64::from(-height)
                };

                cell = round(characters * design / em);
            }

            // Widths do not scale with the height, and the reason is a rounding
            // that happens before anything else: GDI settles on a whole number
            // for the average character width, and every other width is then a
            // proportion of *that* rather than of the height --
            //
            //   average = floor(dfAvgWidth * cell * dfVertRes * aspectY
            //                   / (dfPixHeight * dfHorizRes * aspectX))
            //
            // **Read as well as measured.** The chain is at `seg3:1b46`, reached
            // only when `dfType & 3` is one, which is the vector flag; `1b31`
            // above it takes a requested width outright.
            let average = if width > 0 {
                f64::from(width)
            } else {
                ((f64::from(header.avg_width)
                    * cell
                    * f64::from(header.vert_res)
                    * or(request.aspect_y, 96))
                    / (design * f64::from(header.horiz_res) * or(request.aspect_x, 96)))
                .floor()
            };

            return Some(Chosen {
                entry: entry.clone(),
                scale: cell / design,
                horizontal: average / f64::from(header.avg_width),
                cost: f64::NAN,
            });
        }

        // Each strike is scored once, with the mapper's own weights, and the
        // stretch is part of its score rather than a separate choice. Its
        // height term is a distance with a two-to-one bias: two per pixel when
        // the candidate is taller and one when it is shorter.
        let mut best: Option<(Rc<BitmapFontEntry>, f64, f64)> = None;
        let mut smallest: Option<(Rc<BitmapFontEntry>, f64, f64)> = None;

        for entry in entries {
            let header = &entry.header;
            let cell = f64::from(header.pix_height);
            let em = cell - f64::from(header.internal_leading);
            let measured = if wants_cell { cell } else { em };

            // How many times over this strike would be drawn.
            //
            // A quarter of the strike's own height is added before the division
            // -- `sar cx,2` at `seg3:1bf7` -- so the step up to the next
            // multiple comes a little before the multiple is reached, which is
            // why a request can come back taller than it asked for. A strike at
            // least as tall as the request is never stretched, and proof
            // quality never stretches at all.
            let stretching = request.quality != PROOF_QUALITY && measured < target;
            let times = if stretching {
                MAX_STRETCH.min(((target + f64::from(int32(measured) >> 2)) / measured).floor())
            } else {
                1.0
            };

            // Refused outright when the multiple plus two is not less than the
            // strike's own height, which is why the three row and five row
            // strikes of Small Fonts are barely stretched: three never can be,
            // five only doubled.
            if stretching && times + 2.0 >= measured {
                continue;
            }

            let size = measured * times;

            // The score: twenty a multiple for the stretch, a hundred and fifty
            // a pixel of height error either way, and six hundred more, flat,
            // for erring on the tall side. GDI folds the multiple into the low
            // bits with an `or` rather than an add, as a tie-break between
            // candidates that cost the same.
            let mut cost = if stretching {
                or32(STRETCH_PENALTY * times, f64::from(int32(times - 1.0) << 3))
            } else {
                0.0
            };

            cost += if size > target {
                HEIGHT_PENALTY * (size - target) + TALLER_PENALTY
            } else {
                HEIGHT_PENALTY * (target - size)
            };

            // And the aspect, which is what stops a small strike being
            // stretched a long way: the shape the strike would come out at
            // against the shape of a device pixel, 30 a hundredth. Stretching a
            // strike six times upward and only five across -- five being the
            // cap, at `seg3:1d8c` -- leaves it seventeen hundredths off square.
            let shape = muldiv(
                100.0,
                or(i32::from(header.horiz_res), 1),
                or(i32::from(header.vert_res), 1),
            );
            let per_time = muldiv(shape, 1.0, times);

            let mut across = 1.0;

            if stretching && per_time + half(per_time) < square {
                across = MAX_WIDTH_STRETCH.min(muldiv(square, 1.0, per_time));
                cost = or32(cost + STRETCH_PENALTY * across, across - 1.0);
            }

            cost += ASPECT_PENALTY * (square - muldiv(shape, across, times)).abs();

            // And the two multiples against each other: the larger over the
            // smaller, in hundredths, at 4 a hundredth. Six times up against
            // five across is 120, so 480 -- which is what settles a strike drawn
            // six times against one drawn five.
            #[allow(clippy::float_cmp)]
            if times != across {
                cost += RATIO_PENALTY
                    * if times > across {
                        muldiv(SQUARE, times, across)
                    } else {
                        muldiv(SQUARE, across, times)
                    };
            }

            // And fifty flat for being drawn more than once at all, either way;
            // `seg3:1e49`. MS Serif asked for twenty-nine pixels on an EGA turns
            // on it and on nothing else.
            if times > 1.0 || across > 1.0 {
                cost += MULTIPLE_PENALTY;
            }

            if smallest.as_ref().is_none_or(|(_, _, kept)| size < *kept) {
                smallest = Some((entry.clone(), times, size));
            }

            if best.as_ref().is_none_or(|(_, _, kept)| cost < *kept) {
                best = Some((entry.clone(), times, cost));
            }
        }

        // Nothing fits under a request smaller than anything installed, and the
        // answer is the smallest there is rather than nothing. A family every
        // one of whose strikes was refused answers with nothing at all: on an
        // EGA Fixedsys and Small Fonts have nothing for a request of
        // seventy-eight pixels or more, and Windows answers with Arial.
        // **Recorded**, 41 requests of the `font` sweep on an EGA.
        let (entry, mut scale, cost) = match (best, smallest) {
            (Some(best), _) => best,
            // A strike kept as the smallest without a cost, as the
            // TypeScript engine's `smallest` carries none; it is kept only
            // where a best is too.
            (None, Some((entry, times, _))) => (entry, times, 0.0),
            (None, None) => return None,
        };

        // Sideways the strike is drawn at most five times over, however many
        // times it is drawn upward. Courier asked for ninety-six pixels answers
        // a cell of 96 -- its sixteen row strike six times -- with an average
        // width of 45, its own nine *five* times. **Recorded**, across a sweep
        // of every height from one to a hundred and twenty.
        let mut horizontal = scale.min(MAX_WIDTH_STRETCH);

        // And then as far down as it has to come to fit in a segment, on a
        // device that cannot hold a font bigger than one: `RC_BIGFONT`. A
        // Hercules has not, and its sideways multiple falls away above three.
        // **Measured** against all 62 places the sweep pins a horizontal
        // multiple on that display. Past one across the multiple upward comes
        // down too: MS Sans Serif's twenty-eight row strike asked for a hundred
        // and twelve pixels on a Hercules is answered three times over.
        // **Recorded.**
        if request.big_font == Some(false) {
            while horizontal > 1.0 && Self::segment_size(&entry, scale, horizontal) > FONT_SEGMENT {
                horizontal -= 1.0;
            }

            while scale > 1.0 && Self::segment_size(&entry, scale, horizontal) > FONT_SEGMENT {
                scale -= 1.0;
            }
        }

        if width > 0 {
            let average = or(i32::from(entry.header.avg_width), 1);

            horizontal = round(f64::from(width) / average).max(1.0);
        }

        Some(Chosen {
            entry,
            scale,
            horizontal,
            cost,
        })
    }

    /// Resolves a request for a face at a cell height to something drawable.
    ///
    /// The mapper's own height term decides which strike: nearest, and between
    /// two equally near the shorter, because being too tall costs 150 a pixel
    /// and 600 more besides. Ties go to the earliest in the directory, which
    /// is the order the faces were loaded in.
    pub fn realize(&self, face: &str, cell: i32) -> Option<LogicalFont> {
        let (_, strikes) = self.lookup(face)?;
        let cost = |strike: &Strike| {
            let height = i32::from(strike.entry.header.pix_height);

            if height > cell {
                HEIGHT_PENALTY * f64::from(height - cell) + TALLER_PENALTY
            } else {
                HEIGHT_PENALTY * f64::from(cell - height)
            }
        };

        let best = strikes.iter().fold(strikes.first()?, |best, strike| {
            if cost(strike) < cost(best) {
                strike
            } else {
                best
            }
        });

        Some(LogicalFont::new(
            face.to_string(),
            cell,
            best.entry.clone(),
            Style::default(),
        ))
    }

    /// The font `CreateFontIndirect` makes of a request: the mapper's answer,
    /// with what was asked for beyond the face and the size remembered, since
    /// a strike cannot remember it. The name reported afterwards comes from
    /// the mapper rather than from the request.
    pub fn create(&self, request: &Request) -> Option<LogicalFont> {
        let found = self.map(request)?;
        let style = Style {
            weight: Some(request.weight),
            italic: Some(request.italic),
            underline: Some(request.underline),
            strikeout: Some(request.strikeout),
            scale: None,
            horizontal: None,
            outline_family: found.outline_family,
        };

        Some(match found.realisation {
            Realisation::Strike(chosen) => LogicalFont::new(
                found.face,
                0,
                chosen.entry,
                Style {
                    scale: Some(chosen.scale),
                    horizontal: Some(chosen.horizontal),
                    ..style
                },
            ),
            // An outline face carries the font itself and the sizes it was
            // settled at, there being no strike to stand in for either; and
            // the device's resolutions, which a turned glyph's matrix is
            // stretched by, and whether its driver keeps a smear's overhang.
            Realisation::Outline {
                font,
                realised,
                exact_style,
                face_bold,
            } => LogicalFont::of_outline(
                found.face,
                style,
                Outline {
                    font,
                    ppem: realised.ppem,
                    x_ppem: realised.x_ppem,
                    x_whole: realised.x_whole,
                    x_base: realised.x_base,
                    ascent: realised.ascent,
                    descent: realised.descent,
                    exact_style,
                    face_bold,
                    escapement: f64::from(request.escapement.rem_euclid(3600)),
                    horizontal_res: or(request.log_pixels_x, 96),
                    vertical_res: or(request.log_pixels_y, 96),
                    bold_always: request.bold_always,
                },
            ),
        })
    }
}

/// What each stock font actually is, by its `GetStockObject` index: a face
/// and a **cell height in pixels**.
///
/// Not from a manual. Every one of these was matched against what real
/// Windows reports for it, recorded in `oracle/fixtures/text.json`: the face
/// is what `GetTextFace` answers, and the size is the one whose metrics agree
/// field for field with `GetTextMetrics`.
///
/// Two of them are worth pointing at. `ANSI_VAR_FONT` asks for Helv, which no
/// installed file provides; `WIN.INI` substitutes MS Sans Serif, and the
/// reported face stays Helv. And `DEVICE_DEFAULT_FONT` is Courier on this
/// display driver, not a system font at all.
///
/// The size is a cell height, and an EGA is what says so. Read as a point
/// size, `ANSI_VAR_FONT` is MS Sans Serif at eight points, which is thirteen
/// rows on a VGA and ten on an EGA; Windows draws it twelve rows tall on an
/// EGA, which is that face's *ten* point strike. Read as thirteen pixels it is
/// the thirteen row strike on a VGA and the twelve row one on an EGA -- the
/// nearest either way, and where two are equally near the shorter.
/// **Recorded**: six cells of the EGA glyph sweep turn on it.
pub const STOCK_FONTS: [(u16, &str, i32); 6] = [
    (10, "Terminal", 12), // OEM_FIXED_FONT
    (11, "Courier", 13),  // ANSI_FIXED_FONT
    (12, "Helv", 13),     // ANSI_VAR_FONT
    (13, "System", 16),   // SYSTEM_FONT
    (14, "Courier", 16),  // DEVICE_DEFAULT_FONT
    (16, "Fixedsys", 15), // SYSTEM_FIXED_FONT
];

/// The font every device context starts with, before anything selects one.
pub const SYSTEM_FONT: u16 = 13;

/// A stock font realised: a face at a size, and both halves matter, since
/// the same file holds Courier at thirteen rows and at twenty. `None` for an
/// index that is not a stock font's, or a face not installed.
pub fn stock_font(fonts: &FontManager, index: u16) -> Option<LogicalFont> {
    let (_, face, cell) = STOCK_FONTS.iter().find(|(stock, _, _)| *stock == index)?;

    fonts.realize(face, *cell)
}

impl System {
    /// GDI's fonts, loaded from the installation the first time they are
    /// wanted.
    ///
    /// The TypeScript engine loads them at boot, before the first program is
    /// loaded; here they are loaded when first asked for, from the same files.
    /// The two differ only where a program changes the installation's fonts
    /// or profiles before it first asks for a font.
    pub fn fonts(&mut self) -> &FontManager {
        self.fonts.get_or_insert_with(|| boot(&self.files))
    }
}

#[cfg(test)]
mod tests;
