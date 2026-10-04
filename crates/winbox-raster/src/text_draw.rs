//! Text drawn with a strike, as winbox.js's raster layer draws it: each
//! glyph's bits written in the text's colour, stretched a whole number of
//! times over where the mapper chose a size the face has no strike for,
//! smeared a pixel across where bold was asked of a face that is not, and
//! leaned a row pair at a time where italic was. And the solid rectangle
//! the ground behind text, a rule and a prefix's underline are drawn as.

// Deliberately: a JavaScript number's precision, as the TypeScript
// engine's drawing has it.
#![allow(clippy::cast_precision_loss)]

use crate::bitmap_font::{BitmapFontEntry, Measure};
use crate::indexed_context::IndexedContext;

/// What a strike is drawn with that the strike itself does not know.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DrawOptions {
    /// The weight asked for: above 400, a face of 400 or less is smeared.
    pub weight: i32,
    pub italic: bool,
    /// How many times over the strike is drawn upward, and sideways.
    pub scale: f64,
    pub horizontal: f64,
    /// The gap after every character (`SetTextCharacterExtra`).
    pub extra: i32,
    /// The colour, as RGBA bytes.
    pub color: [u8; 4],
}

/// A strike's region too big to take: its width or height is negative, as
/// a negative character extra can make it, where the TypeScript engine's
/// typed array of that length throws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NegativeRegion;

/// A rectangle filled solid, as the TypeScript engine's `BitmapContext`
/// fills one: its corner rounded, every pixel of it set through the
/// context, which keeps it to the pixels, the clip and the device
/// context's clip region, and matches the colour to the palette.
pub fn fill_rect(
    context: &mut IndexedContext,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    colour: [u8; 4],
) {
    let (left, top) = (round(x) as i32, round(y) as i32);
    let columns = width.ceil().max(0.0) as i32;
    let rows = height.ceil().max(0.0) as i32;

    for row in 0..rows {
        for column in 0..columns {
            context.set_pixel(left + column, top + row, colour);
        }
    }
}

/// `Math.round`: to the nearest, a half upward.
fn round(value: f64) -> f64 {
    crate::logical_font::round(value)
}

/// A string drawn with a strike, its cell's corner at `x, y`.
///
/// The way the TypeScript engine's `BitmapFontEntry.draw` draws it: the
/// region the string covers is taken out of the context as colours, each
/// glyph's ink written into it, and the whole region put back a pixel at a
/// time -- so every pixel of it is matched to the palette again, inked or
/// not, and the region is marked as written.
///
/// * **Stretched**, a glyph's every bit covers `horizontal` columns and
///   `scale` rows. A face has a handful of strikes and is asked for every
///   size, so a size with no strike near enough may be answered by drawing
///   a smaller one a whole number of times over -- MS Serif asked for
///   twenty has no twenty row strike and doubles its ten row one.
/// * **Bold**, of a face that is not bold already, is the glyph again a
///   pixel to the right: each pixel inked where the one before it is, and
///   each character a pixel wider -- once, however many times over the
///   strike is drawn. That is the same arithmetic the metrics do.
/// * **Italic** is done as the rows are written, in pairs counted from the
///   *top* of the cell: the first two rows lean by the whole overhang,
///   `(height - 1) >> 1`, and every two rows after that lean one pixel less,
///   down to nothing. Counting the pairs from the bottom instead agrees
///   exactly half the time: the two differ only where the cell has an odd
///   number of rows. **Measured** over eight sizes of seven faces --
///   Fixedsys, whose only strike is fifteen rows, disagreed at every size
///   and every letter that way.
///
/// The region is the string's measured width stretched, the lean and every
/// character's extra; ink past its right edge is not drawn.
///
/// # Errors
///
/// A region of negative size, which the TypeScript engine cannot make.
pub fn draw_strike(
    entry: &BitmapFontEntry,
    context: &mut IndexedContext,
    x: i32,
    y: i32,
    text: &[u8],
    options: &DrawOptions,
) -> Result<(), NegativeRegion> {
    if text.is_empty() {
        return Ok(());
    }

    let up = if options.scale == 0.0 {
        1.0
    } else {
        options.scale
    };
    let across = if options.horizontal == 0.0 {
        up
    } else {
        options.horizontal
    };
    let emboldened = entry.header.weight <= 400 && options.weight > 400;
    let (measured, cell) = entry.measure(
        text,
        Measure {
            weight: options.weight,
            allow_annotation: false,
        },
    );
    let height = f64::from(cell) * up;
    let overhang = ((height - 1.0) as i64 >> 1) as f64;
    let width = f64::from(measured) * across
        + if options.italic { overhang } else { 0.0 }
        + f64::from(options.extra) * text.len() as f64;

    if width < 0.0 || height < 0.0 {
        return Err(NegativeRegion);
    }

    // A typed array's length is the product truncated.
    let (region_width, region_height) = (width as i32, height as i32);
    let mut image = context.image_data(x, y, region_width, region_height);
    let mut relative = 0.0;

    for &code in text {
        let glyph = entry.glyph(u32::from(code));
        let mut char_width = f64::from(entry.character(u32::from(code)).width) * across;

        if emboldened {
            char_width += 1.0;
        }

        for j in 0..height.ceil() as i64 {
            let lean = if options.italic {
                overhang as i64 - (j >> 1)
            } else {
                0
            };
            let row = glyph.get((j as f64 / up).floor() as usize);
            let mut last = 0;
            let mut i = relative;

            while i < relative + char_width {
                let next = row
                    .and_then(|row| row.get(((i - relative) / across).floor() as usize))
                    .copied()
                    .unwrap_or(0);
                let pixel = if next == 0 && emboldened { last } else { next };
                let column = i + lean as f64;

                if pixel != 0 && column >= 0.0 && column < width {
                    let at = ((j as f64 * f64::from(region_width) + column) * 4.0) as usize;

                    if let Some(bytes) = image.data.get_mut(at..at + 4) {
                        bytes.copy_from_slice(&[
                            options.color[0],
                            options.color[1],
                            options.color[2],
                            0xff,
                        ]);
                    }
                }

                last = next;
                i += 1.0;
            }
        }

        relative += char_width + f64::from(options.extra);
    }

    for row in 0..region_height {
        for column in 0..region_width {
            let at = (row as usize * region_width as usize + column as usize) * 4;
            let mut colour = [0; 4];

            colour.copy_from_slice(&image.data[at..at + 4]);
            context.set_pixel(x + column, y + row, colour);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;
    use crate::DevicePalette;
    use crate::bitmap_font::tests::strike;

    fn mono(width: i32, height: i32) -> IndexedContext {
        IndexedContext::new(
            width,
            height,
            Rc::new(RefCell::new(vec![1; (width * height) as usize])),
            Rc::new(RefCell::new(DevicePalette::mono())),
        )
    }

    fn rows(context: &IndexedContext) -> Vec<String> {
        let indices = context.indices.borrow();

        indices
            .chunks(context.width as usize)
            .map(|row| {
                row.iter()
                    .map(|&index| if index == 0 { '#' } else { '.' })
                    .collect()
            })
            .collect()
    }

    const PLAIN: DrawOptions = DrawOptions {
        weight: 400,
        italic: false,
        scale: 1.0,
        horizontal: 1.0,
        extra: 0,
        color: [0, 0, 0, 0xff],
    };

    #[test]
    fn draws_a_glyphs_bits() {
        let entry = BitmapFontEntry::new(strike());
        let mut context = mono(10, 9);

        draw_strike(&entry, &mut context, 1, 0, b"A", &PLAIN).unwrap();

        let drawn = rows(&context);

        assert_eq!(drawn[0], ".#......#.");
        assert_eq!(drawn[8], ".########.");
        assert_eq!(drawn[1], "..........");
    }

    #[test]
    fn smears_doubles_and_leans() {
        let entry = BitmapFontEntry::new(strike());
        let mut context = mono(24, 18);
        let options = DrawOptions {
            weight: 700,
            scale: 2.0,
            horizontal: 2.0,
            ..PLAIN
        };

        draw_strike(&entry, &mut context, 0, 0, b"A", &options).unwrap();

        let drawn = rows(&context);

        // Each bit two columns and two rows, and smeared one more across.
        assert_eq!(drawn[0], "###...........###.......");
        assert_eq!(drawn[1], drawn[0]);
        assert_eq!(drawn[16], "#################.......");

        let mut leaned = mono(16, 9);
        let italic = DrawOptions {
            italic: true,
            ..PLAIN
        };

        draw_strike(&entry, &mut leaned, 0, 0, b"A", &italic).unwrap();

        let drawn = rows(&leaned);

        // A lean of four at the top, a pixel less every two rows.
        assert_eq!(drawn[0], "....#......#....");
        assert_eq!(drawn[8], "########........");
    }

    #[test]
    fn spaces_by_the_character_extra_and_refuses_a_negative_region() {
        let entry = BitmapFontEntry::new(strike());
        let mut context = mono(24, 9);
        let spaced = DrawOptions { extra: 3, ..PLAIN };

        draw_strike(&entry, &mut context, 0, 0, b"AA", &spaced).unwrap();
        assert_eq!(rows(&context)[0], "#......#...#......#.....");

        let negative = DrawOptions {
            extra: -20,
            ..PLAIN
        };

        assert_eq!(
            draw_strike(&entry, &mut context, 0, 0, b"AA", &negative),
            Err(NegativeRegion)
        );
    }

    #[test]
    fn fills_a_rectangle_inside_the_pixels() {
        let mut context = mono(4, 3);

        fill_rect(&mut context, 2.0, 1.0, 5.0, 1.0, [0, 0, 0, 0xff]);
        assert_eq!(rows(&context), vec!["....", "..##", "...."]);
    }
}
