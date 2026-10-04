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
//! Only strikes and the plotter fonts are here. An outline face -- a TrueType
//! one -- is not realised by this engine yet, and nothing here stands in for
//! one.

use std::rc::Rc;

use crate::bitmap_font::{BitmapFontEntry, Measure};

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

/// A request realised: the face it asked for, the size, the strike that
/// satisfies it, and what else it asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct LogicalFont {
    /// The typeface as it was asked for, which is what `GetTextFace` reports.
    pub face: String,
    /// The size as it was asked for.
    pub points: i32,
    /// The font that will actually be measured and drawn.
    pub entry: Rc<BitmapFontEntry>,
    pub style: Style,
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
            entry,
            style,
        }
    }

    /// Whether what will be drawn is strokes rather than pixels.
    pub fn is_vector(&self) -> bool {
        self.entry.is_vector()
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
        if self.style.weight.unwrap_or(0) <= 550 || self.entry.header.weight >= 700 {
            return false;
        }

        if !self.style.outline_family {
            return true;
        }

        round(f64::from(self.entry.header.pix_height) * self.scale()) >= Self::EMBOLDEN_FLOOR
    }

    /// How much room the text takes, with everything the request added to it:
    /// its width and its height.
    ///
    /// The strike is measured first and then adjusted, because none of what a
    /// request can ask for is in the file: stretching to a size that is not
    /// installed multiplies every width, emboldening widens each character by
    /// a pixel, and both emboldening and slanting leave the last character
    /// overhanging the end of the string by a little more.
    pub fn measure(&self, text: &[u8], options: Measure) -> (f64, f64) {
        let header = &self.entry.header;
        let italic = self.style.italic.unwrap_or(false);
        let count = f64::from(text.len() as u32);

        if self.is_vector() {
            let scale = self.width_scale();
            let cell = round(f64::from(header.pix_height) * self.scale());

            let mut width: f64 = text
                .iter()
                .map(|&code| round(f64::from(self.entry.character(u32::from(code)).width) * scale))
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

            return (width, cell);
        }

        let (width, height) = self.entry.measure(text, options);

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

        (
            f64::from(width) * self.horizontal() + if bold { count } else { 0.0 } + overhang,
            f64::from(height) * self.scale(),
        )
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
