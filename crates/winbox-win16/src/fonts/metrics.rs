//! `GetTextMetrics`' answer for a realised strike or plotter font.

use winbox_raster::LogicalFont;
use winbox_raster::logical_font::round;

/// A `TEXTMETRIC`, field for field.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TextMetric {
    pub height: i32,
    pub ascent: i32,
    pub descent: i32,
    pub internal_leading: i32,
    pub external_leading: i32,
    pub ave_char_width: i32,
    pub max_char_width: i32,
    pub weight: i32,
    pub italic: u8,
    pub underlined: u8,
    pub struck_out: u8,
    pub first_char: u8,
    pub last_char: u8,
    pub default_char: u8,
    pub break_char: u8,
    pub pitch_and_family: u8,
    pub char_set: u8,
    pub overhang: i32,
    pub digitized_aspect_x: i32,
    pub digitized_aspect_y: i32,
}

impl TextMetric {
    /// The structure's size: eight words, nine bytes and three words.
    pub const SIZE: usize = 31;

    /// The structure as a program reads it.
    pub fn bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(Self::SIZE);
        let words = |bytes: &mut Vec<u8>, values: &[i32]| {
            for value in values {
                bytes.extend_from_slice(&(*value as i16).to_le_bytes());
            }
        };

        words(
            &mut bytes,
            &[
                self.height,
                self.ascent,
                self.descent,
                self.internal_leading,
                self.external_leading,
                self.ave_char_width,
                self.max_char_width,
                self.weight,
            ],
        );
        bytes.extend_from_slice(&[
            self.italic,
            self.underlined,
            self.struck_out,
            self.first_char,
            self.last_char,
            self.default_char,
            self.break_char,
            self.pitch_and_family,
            self.char_set,
        ]);
        words(
            &mut bytes,
            &[
                self.overhang,
                self.digitized_aspect_x,
                self.digitized_aspect_y,
            ],
        );
        bytes
    }
}

/// What `GetTextMetrics` reports for a realised strike or plotter font.
///
/// A bitmap face has one weight, no slant and no rule, so a request for bold,
/// italic, underline or strikeout is answered by altering the strike rather
/// than by opening another file. The metrics then have to report what was
/// asked for rather than what the file says, because the file says the same
/// thing either way.
///
/// And when the size asked for is larger than any strike installed, the
/// strike is stretched: a hundred pixel MS Sans Serif is the twenty pixel
/// strike five times over, exact in every metric.
pub fn text_metrics(font: &LogicalFont) -> TextMetric {
    let header = &font.entry.header;
    let style = &font.style;
    let scale = font.scale();

    // The height actually being drawn. For a strike stretched by a whole
    // number that is the design times the factor; for a scalable face it is
    // whatever was asked for, and the factor is a fraction.
    let cell = round(f64::from(header.pix_height) * scale);

    // Whether the strike has to be emboldened, which is not the same as
    // whether the request asked for bold. The System font is drawn bold
    // already, so asking it for bold changes nothing: no character widens and
    // nothing overhangs.
    let bold = font.emboldens();

    // A scalable face is drawn at exactly the height asked for, and every
    // other vertical measure is its design value scaled to that and rounded on
    // its own. They are rounded independently, so the ascent and descent need
    // not add up to the height -- a sixteen pixel Roman reports thirteen and
    // four. Measured across three faces at nine sizes each, including one
    // whose design is 37 pixels rather than 32.
    let design = f64::from(header.pix_height);
    #[allow(clippy::float_cmp)]
    let vertical = |value: f64| {
        if scale == 1.0 {
            value
        } else {
            round(value * cell / design)
        }
    };

    let height = cell as i32;

    // Widths follow the design's own aspect for a stroke font and the stretch
    // factor for a strike. Emboldening widens every character by one pixel
    // either way.
    let vector = font.is_vector();
    let widths = if vector {
        font.width_scale()
    } else {
        font.horizontal()
    };

    // How far the emboldening is smeared, in pixels.
    //
    // A strike is drawn again one pixel across, always. Strokes are drawn
    // again a *scaled* pixel across -- the pen thickens with the font -- so
    // the offset is the width scale rounded to whole pixels, which is zero
    // until the font is drawn at about half its design width and three by the
    // time it is drawn at three times. Recorded across three faces at sixteen
    // sizes each.
    let smear = if !bold {
        0.0
    } else if vector {
        round(font.width_scale())
    } else {
        1.0
    };

    let italic = style.italic.unwrap_or(false);
    let flag = |asked: Option<bool>, file: u8| match asked {
        None => file,
        Some(true) => 0xff,
        Some(false) => 0,
    };

    // What a synthesised style adds to the width of a whole string, over and
    // above the characters in it. Emboldening smears each character one pixel
    // to the right, so the last one hangs one pixel past where it would have
    // ended. Slanting leans the cell over by half its own height:
    // `floor((height - 1) / 2)`, which fits every size of every face measured.
    //
    // A stroke font reports its smear and leans one pixel further than a
    // strike does at the same cell, `floor(h / 2)` against
    // `floor((h - 1) / 2)`.
    let lean = if !italic {
        0.0
    } else if vector {
        (f64::from(height) / 2.0).floor()
    } else {
        ((f64::from(height) - 1.0) / 2.0).floor()
    };
    let overhang = if vector {
        smear + lean
    } else {
        f64::from(u8::from(bold)) + lean
    };

    TextMetric {
        height,
        ascent: vertical(f64::from(header.ascent)) as i32,
        descent: vertical(design - f64::from(header.ascent)) as i32,
        internal_leading: vertical(f64::from(header.internal_leading)) as i32,
        external_leading: vertical(f64::from(header.external_leading)) as i32,
        ave_char_width: (round(f64::from(header.avg_width) * widths) + smear) as i32,
        max_char_width: (round(f64::from(header.max_width) * widths) + smear) as i32,
        // A request for bold reports 700 however heavy it asked for. A request
        // for anything else reports what the file says, which is not always
        // 400: the System font is drawn bold and reports 700 to a program that
        // asked for nothing of the kind.
        weight: if bold { 700 } else { i32::from(header.weight) },
        // Italic reports 1 and the other two report 255: `tmItalic` is a flag
        // and the other two are the byte with every bit set. And 255 rather
        // than 1 for a slant synthesised onto a strike the mapper reached from
        // an outline family -- the flag follows the family chosen rather than
        // the strike drawn.
        italic: match style.italic {
            None => header.italic,
            Some(true) if style.outline_family => 0xff,
            Some(true) => 1,
            Some(false) => 0,
        },
        underlined: flag(style.underline, header.underline),
        struck_out: flag(style.strikeout, header.strike_out),
        first_char: header.first_char,
        last_char: header.last_char,
        // The font file stores these two relative to the first character it
        // contains, while the metrics report them as the characters they are.
        default_char: header.default_char.wrapping_add(header.first_char),
        break_char: header.break_char.wrapping_add(header.first_char),
        // GDI adds `TMPF_VECTOR` for a stroke font. The file itself does not
        // carry it -- Roman says 17 and the metrics report 19 -- because it
        // describes how the font is drawn rather than what it looks like.
        pitch_and_family: header.pitch_and_family | if vector { 0x02 } else { 0x00 },
        char_set: header.char_set,
        overhang: overhang as i32,
        digitized_aspect_x: i32::from(header.horiz_res),
        digitized_aspect_y: i32::from(header.vert_res),
    }
}
