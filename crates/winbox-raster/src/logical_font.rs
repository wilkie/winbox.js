//! A font as a program asked for it, resolved to one it can be drawn with.
//!
//! The two are not the same thing and the difference is visible. A program
//! asks for "Helv" at eight points; `WIN.INI` says `Helv=MS Sans Serif`, so
//! what actually gets measured and drawn is MS Sans Serif -- but `GetTextFace`
//! still answers "Helv", because the name belongs to the request rather than
//! to the file that satisfied it.
//!
//! The size matters just as much. A `.FON` file holds several sizes of the
//! same face, and which one is meant is part of what was asked for:
//! `ANSI_FIXED_FONT` is Courier at ten points, thirteen pixels tall, while the
//! same file's fifteen point entry is twenty. Handing round the file and
//! picking a size later is how that gets lost.
//!
//! An outline face -- a TrueType one -- has no strike to stand for it: the
//! font itself is carried, with the pixel sizes it was settled at and the
//! extent the mapper found for them (see `Outline`).

use std::rc::Rc;

use crate::bitmap_font::{BitmapFontEntry, Measure};
use crate::truetype::{Fault, TrueTypeFont};

/// What was asked for beyond the face and the size.
///
/// A bitmap face has one weight and no slant, so a request for bold or italic
/// is answered by altering the one strike there is rather than by opening a
/// different file -- which means the request has to be remembered, because
/// the file cannot remember it. A field that is `None` was not asked about at
/// all, which is not the same as being asked for nought: a stock font asks
/// nothing, and reports what its file says.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Style {
    pub weight: Option<i32>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strikeout: Option<bool>,
    /// How many times over the strike is drawn upward; for a vector font,
    /// the cell over the design, a fraction.
    pub scale: Option<f64>,
    /// And sideways, which a request for a width sets on its own.
    pub horizontal: Option<f64>,
    /// Whether the family the mapper settled on was an outline one, even
    /// where a strike ended up being drawn. See `emboldens`.
    pub outline_family: bool,
}

/// An outline face realised: the font, and the sizes and extent the mapper
/// settled it at, which there is no strike to remember.
#[derive(Debug, Clone)]
pub struct Outline {
    pub font: Rc<TrueTypeFont>,
    /// The pixel size the face was settled at.
    pub ppem: f64,
    /// The pixel size the glyphs are drawn at horizontally: the same as
    /// `ppem` unless a width was asked for or the pixel is not square.
    pub x_ppem: f64,
    /// The whole horizontal size the scaler runs the hint program at: the 8.8
    /// stretch applied to the size and truncated, which is not always the
    /// floor of the fractional size the metrics are taken at.
    pub x_whole: f64,
    /// The horizontal size before any width was asked for, which the metrics
    /// take the average and the maximum at and then stretch.
    pub x_base: f64,
    /// The extent the mapper found for the size.
    pub ascent: f64,
    pub descent: f64,
    /// Whether the family had the style asked for as a file of its own: then
    /// there is nothing to make up.
    pub exact_style: bool,
    /// Whether the file chosen is the family's bold one.
    pub face_bold: bool,
    /// The angle the baseline runs at, in tenths of a degree, reduced to a
    /// turn. A whole turn is nought here though the size was chosen as a
    /// turned font's.
    pub escapement: f64,
    /// The device's resolutions, which a turned glyph's matrix is stretched
    /// by where they differ.
    pub horizontal_res: f64,
    pub vertical_res: f64,
    /// Whether the display's driver keeps the emboldening overhang -- a
    /// Hercules -- which makes a smeared string measure one wider.
    pub bold_always: bool,
}

/// The same file, realised the same way.
impl PartialEq for Outline {
    fn eq(&self, other: &Self) -> bool {
        let numbers = |outline: &Self| {
            [
                outline.ppem,
                outline.x_ppem,
                outline.x_whole,
                outline.x_base,
                outline.ascent,
                outline.descent,
                outline.escapement,
                outline.horizontal_res,
                outline.vertical_res,
            ]
            .map(f64::to_bits)
        };

        Rc::ptr_eq(&self.font, &other.font)
            && numbers(self) == numbers(other)
            && (self.exact_style, self.face_bold, self.bold_always)
                == (other.exact_style, other.face_bold, other.bold_always)
    }
}

/// A request realised: the face it asked for, the size, the strike that
/// satisfies it -- or the outline -- and what else it asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct LogicalFont {
    /// The typeface as it was asked for, which is what `GetTextFace` reports.
    pub face: String,
    /// The size as it was asked for.
    pub points: i32,
    /// The strike that will actually be measured and drawn; none for an
    /// outline face.
    pub entry: Option<Rc<BitmapFontEntry>>,
    pub style: Style,
    /// The outline face, where it is one.
    pub outline: Option<Outline>,
}

/// `Math.round`: to the nearest whole number, a half upward.
pub fn round(value: f64) -> f64 {
    let floor = value.floor();

    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

impl LogicalFont {
    /// The shortest strike a *fallback* from an outline face may thicken.
    pub const EMBOLDEN_FLOOR: f64 = 11.0;

    pub fn new(face: String, points: i32, entry: Rc<BitmapFontEntry>, style: Style) -> Self {
        Self {
            face,
            points,
            entry: Some(entry),
            style,
            outline: None,
        }
    }

    /// An outline face, realised by the mapper.
    pub fn of_outline(face: String, style: Style, outline: Outline) -> Self {
        Self {
            face,
            points: 0,
            entry: None,
            style,
            outline: Some(outline),
        }
    }

    /// The strike, for a font that is one. Every caller asks only of a font
    /// it knows is a strike or a plotter font: the TypeScript engine reads
    /// `entry.header` there and would throw on an outline's.
    ///
    /// # Panics
    ///
    /// For an outline face.
    pub fn strike(&self) -> &Rc<BitmapFontEntry> {
        self.entry.as_ref().expect("a strike, not an outline")
    }

    /// Whether what will be drawn is strokes rather than pixels.
    pub fn is_vector(&self) -> bool {
        self.entry.as_ref().is_some_and(|entry| entry.is_vector())
    }

    /// The pixel size an outline face was settled at; nought for a strike.
    pub fn ppem(&self) -> f64 {
        self.outline.as_ref().map_or(0.0, |outline| outline.ppem)
    }

    /// The horizontal size over the vertical, for hinting: one unless a
    /// width was asked for. The scaler hints at the whole horizontal size
    /// while the metrics keep the fraction: on the `widths` fixture the floor
    /// is 1,482 of 1,944 stretched cells, the fraction 1,117.
    pub fn stretch(&self) -> f64 {
        match &self.outline {
            Some(outline) if outline.ppem != 0.0 => outline.x_whole / outline.ppem,
            _ => 1.0,
        }
    }

    /// Whether a slant has to be made: an italic asked of a family with no
    /// italic file.
    pub fn slants(&self) -> bool {
        self.style.italic.unwrap_or(false)
            && !self
                .outline
                .as_ref()
                .is_some_and(|outline| outline.exact_style)
    }

    /// Whether a bold has to be smeared onto the outline: above 550, where
    /// the file chosen is not the bold one. **Recorded**: the weight sweep
    /// in the `styles` fixture is 720 of 720 with this threshold.
    pub fn smears(&self) -> bool {
        self.outline.is_some()
            && self.style.weight.unwrap_or(0) > 550
            && !self
                .outline
                .as_ref()
                .is_some_and(|outline| outline.face_bold)
    }

    /// One character's advance in an outline face, the way it is laid out.
    ///
    /// Under a width -- where the whole horizontal size is not the vertical
    /// one -- `LTSH` is asked at the horizontal size, then the program run
    /// anisotropically, then the design advance scaled: **measured** over
    /// `charscal`'s 124,992 stretched advances, 124,533 against 117,929 for
    /// the run alone. `hdmx` is not asked, its entries being for square
    /// sizes.
    ///
    /// Otherwise the three tables and a program, in the order Windows can
    /// answer them: `hdmx`, which this agrees with on every glyph it holds;
    /// `LTSH`, above whose threshold the scaled advance is the answer, a
    /// different number from the hinted one; the program; and the design
    /// advance scaled for a glyph with none. A slant Windows synthesises is
    /// measured from the raw outline, at the whole horizontal size:
    /// **measured**, twelve sizes of Symbol slanted on an EGA.
    pub fn outline_advance(&self, code: u32) -> Result<f64, Fault> {
        let Some(outline) = &self.outline else {
            return Ok(0.0);
        };
        let font = &outline.font;
        let glyph = font.glyph_for(code);
        let ppem = outline.ppem;
        let slant = self.slants();

        #[allow(clippy::float_cmp)]
        if ppem != 0.0 && outline.x_whole != ppem && !slant {
            let across = outline.x_whole;

            if let Some(advance) = font.linear_advance(glyph, ppem, across) {
                return Ok(advance);
            }

            if let Some(advance) = font.hinted_advance(glyph, ppem, true, self.stretch())? {
                return Ok(advance);
            }

            return Ok(round(
                (font.advance_of(glyph) * across) / font.units_per_em(),
            ));
        }

        let ppem = outline.x_whole;

        if slant {
            return font.unhinted_advance(glyph, ppem);
        }

        if let Some(advance) = font.device_advance(ppem, glyph) {
            return Ok(advance);
        }

        if let Some(advance) = font.linear_advance(glyph, ppem, ppem) {
            return Ok(advance);
        }

        if let Some(advance) = font.hinted_advance(glyph, ppem, true, 1.0)? {
            return Ok(advance);
        }

        Ok(round((font.advance_of(glyph) * ppem) / font.units_per_em()))
    }

    /// How many times over the strike is drawn, to reach the size asked for.
    pub fn scale(&self) -> f64 {
        self.style.scale.unwrap_or(1.0)
    }

    /// The same, sideways, which a request for a width sets on its own.
    pub fn horizontal(&self) -> f64 {
        self.style.horizontal.unwrap_or_else(|| self.scale())
    }

    /// How much of its design width each character keeps at this size.
    ///
    /// Not the height's scale, and not a fixed fraction of it: the mapper
    /// settles on a whole number for the average character width first, and
    /// this is the proportion that implies. See `FontManager::choose`.
    pub fn width_scale(&self) -> f64 {
        self.style.horizontal.unwrap_or(1.0)
    }

    /// Whether a request for bold actually thickens this face.
    ///
    /// Two things can stop it: the request may not have asked, or the file may
    /// be bold already, as the System font is, and drawing it again a pixel
    /// across would make it heavier than Windows ever draws it. Size is not
    /// one of them.
    ///
    /// The third thing that stops it is **where the request came from**, which
    /// is not a property of the strike at all. A request for an outline face
    /// at a size too small for one is answered by a strike; ask for bold there
    /// and it is discarded -- `tmWeight` comes back 400, as though nothing had
    /// been asked for. Ask the same strike for bold by its own name and it is
    /// emboldened.
    ///
    /// **Recorded**, on the same eight row cell both ways round: Arial bold at
    /// eight pixels is Small Fonts and answers weight 400 with no overhang and
    /// the plain widths; Small Fonts bold at eight pixels is the same strike
    /// and answers weight 700, overhang 1 and every width one greater. Times
    /// New Roman at eight is the same as Arial. It is the same distinction
    /// `tmItalic` already made, where the byte answers for the family the
    /// request settled on rather than for the strike that satisfied it.
    ///
    /// A fallback is not always discarded, though: the eleven pixel floor is
    /// real and lives here. Arial bold at eleven pixels is Small Fonts' eleven
    /// row strike and *is* emboldened -- weight 700, overhang 1, every width
    /// one greater -- while the same request at eight and at six is not. So a
    /// request that fell back is emboldened only if the strike it fell back to
    /// is at least eleven rows tall, and a strike asked for by name is
    /// emboldened whatever its height. **Recorded**, at six, eight and eleven
    /// pixels of Arial and at eight and ten of Small Fonts and MS Serif.
    pub fn emboldens(&self) -> bool {
        let Some(entry) = &self.entry else {
            return false;
        };

        if self.style.weight.unwrap_or(0) <= 550 || entry.header.weight >= 700 {
            return false;
        }

        if !self.style.outline_family {
            return true;
        }

        round(f64::from(entry.header.pix_height) * self.scale()) >= Self::EMBOLDEN_FLOOR
    }

    /// How much room the text takes, with everything the request added to it:
    /// its width and its height.
    ///
    /// The strike is measured first and then adjusted, because none of what a
    /// request can ask for is in the file: stretching to a size that is not
    /// installed multiplies every width, emboldening widens each character by
    /// a pixel, and both emboldening and slanting leave the last character
    /// overhanging the end of the string by a little more.
    ///
    /// For an outline face this is `try_measure`, and a glyph whose tables
    /// cannot be read measures as nothing here; the TypeScript engine throws
    /// there, and so does every GDI call, which measures with `try_measure`.
    /// Only the faces USER measures with of its own accord -- strikes, all of
    /// them -- come here.
    pub fn measure(&self, text: &[u8], options: Measure) -> (f64, f64) {
        self.try_measure(text, options).unwrap_or_default()
    }

    /// `measure`, for any face: an outline's characters each its advance, a
    /// synthesised bold a pixel a character more -- and one more for the
    /// string where the driver keeps the emboldening overhang, a Hercules
    /// measuring the `font` sweep's specimen at 47 against an EGA's 46 --
    /// and the extent's height.
    pub fn try_measure(&self, text: &[u8], options: Measure) -> Result<(f64, f64), Fault> {
        if let Some(outline) = &self.outline {
            let mut width = 0.0;

            for &code in text {
                width += self.outline_advance(u32::from(code))?;
            }

            if self.style.weight.unwrap_or(0) > 550 && !outline.face_bold {
                width += f64::from(text.len() as u32);

                if outline.bold_always {
                    width += 1.0;
                }
            }

            return Ok((width, outline.ascent + outline.descent));
        }

        let entry = self.strike();
        let header = &entry.header;
        let italic = self.style.italic.unwrap_or(false);
        let count = f64::from(text.len() as u32);

        if self.is_vector() {
            let scale = self.width_scale();
            let cell = round(f64::from(header.pix_height) * self.scale());

            let mut width: f64 = text
                .iter()
                .map(|&code| round(f64::from(entry.character(u32::from(code)).width) * scale))
                .sum();

            // Bold costs one pixel for the whole string rather than one per
            // character, and a slant costs the overhang it leans by. See
            // `GetTextMetrics` for where both numbers come from.
            //
            // Emboldening draws the strokes again, offset by the width scale in
            // whole pixels -- but by at least one, since an offset of nothing
            // would not embolden anything. So the ink reaches past the last
            // character by that much even at sizes where the reported overhang
            // is zero.
            if self.emboldens() {
                width += round(scale).max(1.0);
            }

            if italic {
                width += (cell / 2.0).floor();
            }

            return Ok((width, cell));
        }

        let (width, height) = entry.measure(text, options);

        // Emboldening only happens to a face that is not bold already; see
        // `GetTextMetrics` for why the System font is the case that shows it.
        let bold = self.emboldens();

        // The same overhang the metrics report, and for the same reasons: one
        // pixel for the smear that makes a bitmap bold, and half the drawn
        // height for the lean that makes it italic. See `GetTextMetrics`.
        let drawn = f64::from(header.pix_height) * self.scale();
        let overhang = f64::from(u8::from(bold))
            + if italic {
                ((drawn - 1.0) / 2.0).floor()
            } else {
                0.0
            };

        Ok((
            f64::from(width) * self.horizontal() + if bold { count } else { 0.0 } + overhang,
            f64::from(height) * self.scale(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bitmap_font::tests::strike;

    fn font(style: Style) -> LogicalFont {
        LogicalFont::new(
            "Test Sans".into(),
            0,
            Rc::new(BitmapFontEntry::new(strike())),
            style,
        )
    }

    #[test]
    fn rounds_as_javascript_does() {
        assert!((round(2.5) - 3.0).abs() < f64::EPSILON);
        assert!((round(-2.5) + 2.0).abs() < f64::EPSILON);
        assert!((round(-2.6) + 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn stretches_emboldens_and_slants_a_strike() {
        let plain = font(Style::default());

        assert_eq!(plain.measure(b"AB", Measure::default()), (18.0, 9.0));

        let doubled = font(Style {
            scale: Some(2.0),
            ..Style::default()
        });

        assert_eq!(doubled.measure(b"AB", Measure::default()), (36.0, 18.0));

        // A pixel a character and one past the end; the lean is half the
        // drawn height less a pixel.
        let bold = font(Style {
            weight: Some(700),
            italic: Some(true),
            ..Style::default()
        });

        assert!(bold.emboldens());
        assert_eq!(
            bold.measure(b"AB", Measure::default()),
            (18.0 + 2.0 + 1.0 + 4.0, 9.0)
        );
    }

    #[test]
    fn a_fallback_from_an_outline_is_not_emboldened_below_eleven_rows() {
        let fallback = font(Style {
            weight: Some(700),
            outline_family: true,
            ..Style::default()
        });

        assert!(!fallback.emboldens());

        let taller = font(Style {
            weight: Some(700),
            outline_family: true,
            scale: Some(2.0),
            ..Style::default()
        });

        assert!(taller.emboldens());
    }
}
