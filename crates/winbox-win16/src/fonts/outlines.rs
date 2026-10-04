//! The mapper's outline faces: each `.TTF` the installation names, kept by
//! its family and its style, and what the mapper asks of them -- the family
//! a name finds, the strike a small request is answered from instead, and
//! the size an outline is realised at.

use std::rc::Rc;

use winbox_raster::logical_font::round;
use winbox_raster::truetype::{Extent, Sized};
use winbox_raster::{BitmapFontEntry, TrueTypeFont};

use super::{
    DEFAULT_POINTS, FF_MODERN, FIXED_PITCH, FontManager, OEM_CHARSET, Request, muldiv, substitute,
};

const FF_ROMAN: i32 = 0x10;

/// Above this weight the family's bold file is opened rather than smeared.
pub const BOLD_FILE: i32 = 600;

/// The cell height at and above which an outline always wins: below it a
/// strike installed at exactly the height asked for beats scaling a TrueType
/// face, because `seg3:13f3` is `cmp ax,0xb` and what runs below it is a
/// lookup in exactly two faces. See `SMALL_FACES` and `FONTS.md` section 3.
const OUTLINE_FLOOR: i32 = 12;

/// The two faces a small request may be answered from, and nothing else.
///
/// **Read out of `GDI.EXE`.** Below twelve pixels the realiser does not score
/// anything: at `seg3:126a` it looks the request up by atom in exactly two
/// faces, `[0x384]` and `[0x386]` -- the second and third entries of the name
/// table segment 2 holds at `+0x4b4`. A request whose family is `FF_SWISS`
/// gets only `Small Fonts`; anything else gets `MS Serif` first.
const SMALL_FACES: [&str; 2] = ["MS Serif", "Small Fonts"];
const SMALL_SWISS: [&str; 1] = ["Small Fonts"];
const FF_SWISS: i32 = 0x20;

/// The face an unrecognised name is answered with, if it is installed.
pub const FALLBACK_OUTLINE: &str = "Times New Roman";

/// How the four files of a family are told apart.
pub fn style_key(bold: bool, italic: bool) -> String {
    format!(
        "{}{}",
        if bold { "bold" } else { "regular" },
        if italic { "-italic" } else { "" }
    )
}

/// An outline family's file found for a name and a style: the family's
/// installed name, the file, whether it is the style asked for, and whether
/// it is the bold one.
#[derive(Debug, Clone)]
pub struct Found {
    pub name: String,
    pub font: Rc<TrueTypeFont>,
    pub exact: bool,
    pub face_bold: bool,
}

/// An outline realised at a size: the pixel size, the horizontal sizes --
/// before a width, stretched, and whole -- and the extent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Realised {
    pub ppem: f64,
    pub x_base: f64,
    pub x_ppem: f64,
    pub x_whole: f64,
    pub ascent: f64,
    pub descent: f64,
}

/// Strikes a small request found: the name they were looked for under, and
/// the strikes.
#[derive(Debug, Clone)]
pub struct StrikesAt {
    pub name: String,
    pub entries: Vec<Rc<BitmapFontEntry>>,
}

impl FontManager {
    /// Loads a `.TTF`: its outlines join its family under the style its own
    /// tables say it is, and the installer's stub, if it came first, is put
    /// beside it. All four files of a family name themselves the same thing,
    /// and they are four different fonts: Arial's italic is *narrower* than
    /// its regular at twenty-four pixels, which no shearing would produce.
    pub(super) fn load_outline(&mut self, name: &str, bytes: Vec<u8>) {
        if !TrueTypeFont::looks_like_font(&bytes) {
            return;
        }

        let font = TrueTypeFont::new(bytes);
        let face = font.face_name().to_string();

        if face.is_empty() {
            return;
        }

        let file_name = name.to_uppercase();

        *font.resource.borrow_mut() = self.resources.get(&file_name).cloned();
        *font.file_name.borrow_mut() = Some(file_name);

        let key = style_key(font.bold_face(), font.italic_face());
        let font = Rc::new(font);
        let at = if let Some(at) = self.outlines.iter().position(|(name, _)| *name == face) {
            at
        } else {
            self.outlines.push((face, Vec::new()));
            self.outlines.len() - 1
        };
        let family = &mut self.outlines[at].1;

        match family.iter_mut().find(|(style, _)| *style == key) {
            Some((_, kept)) => *kept = font,
            None => family.push((key, font)),
        }
    }

    /// The outline families, by name in the order they were first loaded,
    /// each file under its style in the order it was.
    pub fn outline_families(&self) -> &[(String, super::Family)] {
        &self.outlines
    }

    /// The outline face of a name, after substitution, in the style asked
    /// for: exactly that, then the nearest the family has -- the bold, the
    /// slant, then the regular.
    pub fn outline(&self, name: &str, bold: bool, italic: bool) -> Option<Found> {
        let wanted = substitute(name).unwrap_or(name).to_lowercase();
        let (installed, family) = self
            .outlines
            .iter()
            .find(|(installed, _)| installed.to_lowercase() == wanted)?;
        let asked = style_key(bold, italic);

        for key in [
            asked.clone(),
            style_key(bold, false),
            style_key(false, italic),
            "regular".to_string(),
        ] {
            if let Some((_, font)) = family.iter().find(|(style, _)| *style == key) {
                return Some(Found {
                    name: installed.clone(),
                    font: font.clone(),
                    exact: key == asked,
                    face_bold: key == style_key(true, italic) || key == style_key(true, false),
                });
            }
        }

        None
    }

    /// The outline face that stands in for a family, when one has to: the
    /// same three-way split `family_face` makes for the strikes.
    pub fn family_outline(pitch_and_family: i32) -> &'static str {
        let family = pitch_and_family & 0xf0;

        if pitch_and_family & FIXED_PITCH != 0 || family == FF_MODERN {
            return "Courier New";
        }

        if family == FF_ROMAN {
            return "Times New Roman";
        }

        "Arial"
    }

    /// The faces a small request looks in, by the family it asks for.
    pub(super) fn small_faces(pitch_and_family: i32) -> &'static [&'static str] {
        if pitch_and_family & 0xf0 == FF_SWISS {
            &SMALL_SWISS
        } else {
            &SMALL_FACES
        }
    }

    /// The strikes installed at exactly a cell height, in a face asked by
    /// name or in the small faces, in the character set and pitch asked for.
    ///
    /// A face's own strike answers only in the weight class it was asked in,
    /// over six hundred being bold: an EGA's `ARIALB.FON` answers eleven
    /// pixels of Arial at four hundred and not at seven, and twelve the other
    /// way about. **Recorded**, eight rows of the EGA sweep. A family that has
    /// none of the class answers with what it has: Symbol bold at sixteen
    /// pixels on a VGA is its own strike smeared. Nearest weight below wins.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn strike_at(
        &self,
        height: i32,
        charset: i32,
        fixed_pitch: bool,
        only: Option<&str>,
        own_name: bool,
        weight: i32,
        width: i32,
        order: &[&str],
    ) -> Option<StrikesAt> {
        if height <= 0 || (!own_name && height >= OUTLINE_FLOOR) {
            return None;
        }

        let names: Vec<&str> = match only {
            Some(only) => vec![only],
            None => order.to_vec(),
        };

        for name in names {
            let Some((_, strikes)) = self.lookup(name) else {
                continue;
            };

            // An OEM face is no use to a request that did not ask for one, and
            // a width asked for is answered exactly or not at all.
            let matching: Vec<&Rc<BitmapFontEntry>> = strikes
                .iter()
                .map(|strike| &strike.entry)
                .filter(|entry| {
                    let header = &entry.header;

                    i32::from(header.pix_height) == height
                        && (header.pitch_and_family & 1 != 0) != fixed_pitch
                        && (charset == OEM_CHARSET || i32::from(header.char_set) != OEM_CHARSET)
                        && (width == 0 || i32::from(header.avg_width) == width)
                })
                .collect();

            if matching.is_empty() {
                continue;
            }

            let weight_of = |entry: &BitmapFontEntry| {
                if entry.header.weight == 0 {
                    400
                } else {
                    i32::from(entry.header.weight)
                }
            };
            let heavy = weight > BOLD_FILE;
            let light: Vec<&Rc<BitmapFontEntry>> = if own_name {
                matching
                    .into_iter()
                    .filter(|entry| (weight_of(entry) > BOLD_FILE) == heavy)
                    .collect()
            } else {
                matching
            };

            if light.is_empty() {
                continue;
            }

            let distance = |entry: &BitmapFontEntry| weight - weight_of(entry);
            let nearest = light.iter().map(|entry| distance(entry)).min()?;

            return Some(StrikesAt {
                name: name.to_string(),
                entries: light
                    .into_iter()
                    .filter(|entry| distance(entry) == nearest)
                    .cloned()
                    .collect(),
            });
        }

        None
    }

    /// Settles an outline face at a size, as GDI's realiser does.
    ///
    /// The horizontal size is not a size GDI carries but a *denominator*:
    /// **read out of the binary** at `seg3:0x21fb`, the em a horizontal
    /// quantity is divided by is `MulDiv(dfPoints, logPixelsY, (logPixelsX *
    /// ratio) >> 8)`, the ratio the width stretch in 8.8 -- the `>> 8` where
    /// the bits go, and a sixteen bit word's limit on the result. **Scored**:
    /// 0 of 3,861 records wrong across thirteen recordings of `maxwidth`. The
    /// stretch is the mapper's own `(256 * width + average / 2) / average`
    /// at `seg3:0x2a9c`, and the whole size the hint program runs at is the
    /// stretch applied to the vertical size, truncated, then carried across
    /// the aspect: **measured**, 584 of `charscal`'s 594 rows on an EGA.
    ///
    /// `VDMX`'s group is the em against that denominator in lowest terms.
    /// Nought asks for twelve points as a size, and a negative height the em
    /// itself; a turned font is sized from its design values, read from the
    /// table again only where the angle reduces to nothing; above the table
    /// the scaled extent stands. A slant Windows synthesises keeps the
    /// upright's size and reports the design extent scaled, its hinting gone.
    pub fn realise_outline(font: &TrueTypeFont, request: &Request) -> Option<Realised> {
        let height = f64::from(request.height);
        let width = f64::from(request.width);
        let units = font.units_per_em();
        let mul_div = |a: f64, b: f64, c: f64| ((a * b + (c / 2.0).floor()) / c).floor();
        let log_x = f64::from(if request.log_pixels_x == 0 {
            96
        } else {
            request.log_pixels_x
        });
        let log_y = f64::from(if request.log_pixels_y == 0 {
            96
        } else {
            request.log_pixels_y
        });
        let shr8 = |value: f64| f64::from((value as i64 as i32) >> 8);

        // The denominator stops at what a sixteen bit word holds: **measured**
        // three ways, all landing on 32,768.
        let em_denominator = |ratio: f64| {
            let shifted = shr8(log_x * ratio);

            if shifted > 0.0 {
                mul_div(units, log_y, shifted).min(32_768.0)
            } else {
                32_768.0
            }
        };
        let across = |ppem: f64| (ppem * units) / em_denominator(256.0);
        let ratio_for = |vertical: f64| {
            let average_advance = font.average_advance();

            if width <= 0.0 || average_advance == 0.0 {
                return 256.0;
            }

            let average = mul_div(average_advance, vertical, em_denominator(256.0));

            if average > 0.0 {
                ((256.0 * width + f64::from((average as i32) >> 1)) / average).floor()
            } else {
                256.0
            }
        };
        let stretched = |vertical: f64| (vertical * units) / em_denominator(ratio_for(vertical));
        let whole = |vertical: f64| mul_div(shr8(vertical * ratio_for(vertical)), log_x, log_y);
        let extent = |ppem: f64| font.extent_at(ppem, units, em_denominator(ratio_for(ppem)));
        let realised = |ppem: f64, ascent: f64, descent: f64| Realised {
            ppem,
            x_base: across(ppem),
            x_ppem: stretched(ppem),
            x_whole: whole(ppem),
            ascent,
            descent,
        };

        if height <= 0.0 {
            let size = if height < 0.0 {
                -height
            } else {
                muldiv(DEFAULT_POINTS, log_y, 72.0)
            };
            let Extent { ascent, descent } = extent(size)?;

            return Some(realised(size, ascent, descent));
        }

        if request.escapement != 0 {
            let turned = font.size_for_turned_height(height);
            let upright = request.escapement.rem_euclid(3600) == 0;
            let (ascent, descent) = match extent(turned.ppem).filter(|_| upright) {
                Some(fitted) => (fitted.ascent, fitted.descent),
                None => (turned.ascent, turned.descent),
            };

            return Some(realised(turned.ppem, ascent, descent));
        }

        let found: Sized = font.size_for_height(height, units, em_denominator(256.0))?;
        let (ascent, descent) = if found.computed {
            (found.ascent, found.descent)
        } else {
            match extent(found.ppem) {
                Some(fitted) => (fitted.ascent, fitted.descent),
                None => (found.ascent, found.descent),
            }
        };

        if request.italic && !font.italic_face() {
            return Some(realised(
                found.ppem,
                round((font.ascender() * found.ppem) / units),
                round((font.descender() * found.ppem) / units),
            ));
        }

        Some(realised(found.ppem, ascent, descent))
    }
}

#[cfg(test)]
impl FontManager {
    /// Puts a font in its family's place for its style, as the TypeScript
    /// engine's fabricated replays do, answering the family as it was.
    pub(crate) fn stand_in(&mut self, font: TrueTypeFont) -> (String, Option<super::Family>) {
        let face = font.face_name().to_string();
        let key = style_key(font.bold_face(), font.italic_face());
        let font = Rc::new(font);
        let kept = self
            .outlines
            .iter()
            .find(|(name, _)| *name == face)
            .map(|(_, family)| family.clone());
        let mut family = kept.clone().unwrap_or_default();

        match family.iter_mut().find(|(style, _)| *style == key) {
            Some((_, standing)) => *standing = font,
            None => family.push((key, font)),
        }

        match self.outlines.iter_mut().find(|(name, _)| *name == face) {
            Some((_, standing)) => *standing = family,
            None => self.outlines.push((face.clone(), family)),
        }

        (face, kept)
    }

    /// The family a stand-in replaced, put back.
    pub(crate) fn put_back(&mut self, face: &str, kept: Option<super::Family>) {
        match kept {
            Some(kept) => {
                if let Some((_, family)) = self.outlines.iter_mut().find(|(name, _)| name == face) {
                    *family = kept;
                }
            }
            None => self.outlines.retain(|(name, _)| name != face),
        }
    }
}
