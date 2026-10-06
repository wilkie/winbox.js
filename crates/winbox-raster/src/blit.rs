//! `BitBlt` and `PatBlt`: a rectangle of pixels combined from the brush, a
//! source and the destination under a raster operation, as winbox.js's
//! `rasterOp` carries one out.
//!
//! Each side is a device-dependent bitmap -- a memory device context's, the
//! screen's, or a window's view of the screen -- worked on as indices in
//! place. See `raster_op` for how an operation's code carries its truth
//! table, and how a pixel is carried across between depths.

use std::rc::Rc;

use crate::Color;
use crate::colour_match::DisplayKind;
use crate::device_bitmap::{DeviceBitmap, palette_for_display};
use crate::dither::dither_tile;
use crate::indexed_context::SharedPalette;
use crate::raster_op::{Combiner, across, index_of_colour, table_of, uses_source};

/// A pattern brush's pixels, eight by eight, as indices of their own
/// palette: what it keeps of the bitmap it was made from.
#[derive(Debug, Clone)]
pub struct Pattern {
    pub depth: u8,
    pub palette: SharedPalette,
    pub indices: [u8; 64],
}

impl PartialEq for Pattern {
    /// The same pixels, of the same palette.
    fn eq(&self, other: &Self) -> bool {
        self.depth == other.depth
            && Rc::ptr_eq(&self.palette, &other.palette)
            && self.indices == other.indices
    }
}

impl Eq for Pattern {}

/// The brush, as the destination draws it.
#[derive(Debug, Clone, Copy, Default)]
pub struct Brush<'a> {
    /// Its colour, a palette's looked up in the destination's terms; none
    /// for no brush at all, which draws as index nought.
    pub colour: Option<Color>,
    /// A hatched brush's cells, set where its lines are.
    pub hatch: Option<&'a [u8; 64]>,
    /// A pattern brush's pixels.
    pub pattern: Option<&'a Pattern>,
}

/// Where an operation draws, and what of the device context it reads.
#[derive(Clone, Copy)]
pub struct Target<'a> {
    pub bitmap: &'a DeviceBitmap,
    pub brush: Brush<'a>,
    /// The background colour.
    pub back: Color,
    /// The text colour, black where none was given.
    pub text: Option<Color>,
    /// Where the brush's pattern starts, in the bitmap's own terms.
    pub origin: (i32, i32),
    /// A palette realized where it draws: a source's colours are its
    /// nearest entries' slots (`paldib`, WinG's bitmaps).
    pub realized: Option<&'a dyn Fn(u8, u8, u8) -> usize>,
}

impl std::fmt::Debug for Target<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Target")
            .field("bitmap", self.bitmap)
            .field("brush", &self.brush)
            .field("back", &self.back)
            .field("text", &self.text)
            .field("origin", &self.origin)
            .finish_non_exhaustive()
    }
}

/// Where an operation's source pixels come from.
#[derive(Debug, Clone, Copy)]
pub struct Source<'a> {
    pub bitmap: &'a DeviceBitmap,
    /// The source's size, which it is clipped to.
    pub width: i32,
    pub height: i32,
    /// The source device context's background colour, which a colour
    /// source carried into monochrome is white at; none for a source that
    /// is no device context's, which is white at index nought.
    pub back: Option<Color>,
}

thread_local! {
    /// Each table's results at each depth, worked out once: an operation is
    /// carried out a pixel at a time for a line in a drawing mode.
    static COMBINERS: std::cell::RefCell<std::collections::HashMap<(u8, u8), Rc<Combiner>>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

/// The results of a table at a depth.
fn combiner(table: u8, depth: u8) -> Rc<Combiner> {
    COMBINERS.with(|combiners| {
        Rc::clone(
            combiners
                .borrow_mut()
                .entry((table, depth))
                .or_insert_with(|| Rc::new(Combiner::new(table, depth))),
        )
    })
}

/// The index of a colour in a shared palette, as its display draws it.
fn index_in(display: DisplayKind, palette: &SharedPalette, colour: Option<&Color>) -> usize {
    index_of_colour(display, &mut palette.borrow_mut(), colour)
}

/// Carries out one raster operation from `source` (or none) onto `dest`, a
/// rectangle `width` by `height` at `x, y`, the source's at `sx, sy`.
///
/// The brush, as the destination's index, is its nearest colour, or where
/// the display driver realises it as a pattern, that pattern's index at
/// each pixel. A driver makes patterns for its own format and for
/// monochrome, and for nothing else. They are anchored where the brush was
/// realised: the device context's origin when it was first selected, kept,
/// though it is used in another, until `UnrealizeObject` (`brushrlz`).
///
/// A hatched brush's lines are its colour, and between them the background
/// colour. A pattern brush's own pixels are carried into the destination's
/// terms as a source is: a monochrome pattern's set bits the background
/// colour and its clear bits the text colour, as the destination has them
/// now -- into a monochrome bitmap too, where a white text colour and a
/// black background turn the pattern over (`patmono`).
// `p`, `s` and `d` are the pattern, the source and the destination, as
// a raster operation's truth table names them.
#[allow(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    clippy::many_single_char_names
)]
pub fn raster_op(
    display: DisplayKind,
    dest: &Target,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    rop: u32,
    source: Option<&Source>,
    sx: i32,
    sy: i32,
) {
    let table = table_of(rop);

    if width <= 0 || height <= 0 {
        return;
    }

    let to = dest.bitmap;

    // Clipped to the destination, and to the source where there is one.
    let mut left = x.max(0);
    let mut top = y.max(0);
    let mut right = (x + width).min(to.width());
    let mut bottom = (y + height).min(to.height());
    let from = source.filter(|_| uses_source(table));

    if let Some(from) = from {
        left = left.max(x - sx);
        top = top.max(y - sy);
        right = right.min(x - sx + from.width);
        bottom = bottom.min(y - sy + from.height);
    }

    if right <= left || bottom <= top {
        return;
    }

    let no_text = Color::rgb(0, 0, 0);
    let brush = dest.brush.colour;
    let solid = index_in(display, &to.device_palette, brush.as_ref());
    let own = to.depth == 1 || Rc::ptr_eq(&to.device_palette, &palette_for_display(display, None));
    let tile = match brush {
        Some(colour) if own && colour.slot.is_none() => dither_tile(
            display,
            &mut to.device_palette.borrow_mut(),
            colour.red(),
            colour.green(),
            colour.blue(),
        ),
        _ => None,
    };
    let (ox, oy) = dest.origin;
    let cell = |px: i32, py: i32| ((((py - oy) & 7) << 3) | ((px - ox) & 7)) as usize;

    // The brush's index at a pixel, cell by cell where it has a pattern.
    let mut cells: Option<[u8; 64]> = tile;

    if let (Some(hatch), Some(_)) = (dest.brush.hatch, brush) {
        let back = index_in(display, &to.device_palette, Some(&dest.back));
        let mut hatched = [0; 64];

        for (at, set) in hatch.iter().enumerate() {
            hatched[at] = if *set != 0 { solid } else { back } as u8;
        }

        cells = Some(hatched);
    }

    if let Some(painted) = dest.brush.pattern {
        let bring: Box<dyn Fn(u8) -> u8> = if painted.depth == 1 {
            let text = index_in(
                display,
                &to.device_palette,
                Some(&dest.text.unwrap_or(no_text)),
            ) as u8;
            let back = index_in(display, &to.device_palette, Some(&dest.back)) as u8;

            Box::new(move |bit| if bit != 0 { back } else { text })
        } else if painted.depth > 1 && to.depth == 1 {
            let back = index_in(display, &painted.palette, Some(&dest.back)) as u8;

            Box::new(move |index| u8::from(index == back))
        } else if !Rc::ptr_eq(&painted.palette, &to.device_palette) {
            let mut matched = [0u8; 256];

            for (index, slot) in matched.iter_mut().enumerate() {
                let [red, green, blue] = painted
                    .palette
                    .borrow()
                    .colours
                    .get(index)
                    .copied()
                    .unwrap_or([0, 0, 0]);

                *slot = across(
                    display,
                    &mut to.device_palette.borrow_mut(),
                    red,
                    green,
                    blue,
                    dest.realized,
                ) as u8;
            }

            Box::new(move |index| matched[usize::from(index)])
        } else {
            Box::new(|index| index)
        };

        cells = Some(painted.indices.map(bring));
    }

    // A source pixel, carried into the destination's terms.
    let mut carry: Option<[u8; 256]> = None;

    if let Some(from) = from {
        let depth = from.bitmap.depth;

        if depth == 1 && to.depth > 1 {
            let text = index_in(
                display,
                &to.device_palette,
                Some(&dest.text.unwrap_or(no_text)),
            ) as u8;
            let back = index_in(display, &to.device_palette, Some(&dest.back)) as u8;
            let mut table = [back; 256];

            table[0] = text;
            carry = Some(table);
        } else if depth > 1 && to.depth == 1 {
            let back = index_in(display, &from.bitmap.device_palette, from.back.as_ref());
            let mut table = [0; 256];

            if let Some(slot) = table.get_mut(back) {
                *slot = 1;
            }

            carry = Some(table);
        } else if !Rc::ptr_eq(&from.bitmap.device_palette, &to.device_palette) {
            // Into a bitmap with a colour table of its own -- a WinG bitmap
            // -- the nearest of its colours, wherever in it they are; an
            // index past the source's own table, 0 (`wingapi`). Not the
            // display's static colours, which flattened Catz's pictures,
            // copied from one WinG bitmap into another, to twenty.
            let own = to.device_palette.borrow().used.is_some();
            let source = from.bitmap.device_palette.borrow();
            let entries = source.used.unwrap_or(source.size());
            // Each index's colour matched once: the match is the same for
            // every pixel of it.
            let mut table = [0; 256];

            for (index, slot) in table.iter_mut().enumerate() {
                if own && index >= entries {
                    *slot = 0;
                    continue;
                }

                let [red, green, blue] = source.colours.get(index).copied().unwrap_or([0, 0, 0]);

                *slot = if own {
                    to.device_palette.borrow().table_index(red, green, blue)
                } else {
                    across(
                        display,
                        &mut to.device_palette.borrow_mut(),
                        red,
                        green,
                        blue,
                        dest.realized,
                    )
                } as u8;
            }

            carry = Some(table);
        }
    }

    let result = combiner(table, to.depth);
    // Every index read is kept to the depth: one past the palette, which
    // only a screen nothing has drawn on yet holds, is read as its low bits,
    // as the driver would read them.
    let mask = 1u32.wrapping_shl(u32::from(to.depth)).wrapping_sub(1);

    let pattern = |px: i32, py: i32| {
        cells
            .as_ref()
            .map_or(solid as u32, |cells| u32::from(cells[cell(px, py)]))
    };
    let carried = |index: u8| {
        carry
            .as_ref()
            .map_or(index, |carry| carry[usize::from(index)])
    };
    let shared = from.is_some_and(|from| Rc::ptr_eq(&from.bitmap.indices, &to.indices));

    if shared {
        // A source that is the destination's own pixels is read a pixel at
        // a time, as each is written: what is written before is read after,
        // where the two overlap.
        for py in top..bottom {
            for px in left..right {
                let s = from.map_or(0, |from| {
                    carried(from.bitmap.index_at(px - x + sx, py - y + sy).unwrap_or(0))
                });
                let d = to.index_at(px, py).unwrap_or(0);

                to.put(
                    px,
                    py,
                    result.result(pattern(px, py), u32::from(s) & mask, u32::from(d) & mask) as u8,
                );
            }
        }
    } else {
        let mut store = to.indices.borrow_mut();
        let source = from.map(|from| (from, from.bitmap.indices.borrow()));
        let context = &to.context;

        for py in top..bottom {
            for px in left..right {
                let s = source.as_ref().map_or(0, |(from, pixels)| {
                    let at = from.bitmap.context.address(px - x + sx, py - y + sy);

                    carried(
                        usize::try_from(at)
                            .ok()
                            .and_then(|at| pixels.get(at).copied())
                            .unwrap_or(0),
                    )
                });
                let at = usize::try_from(context.address(px, py)).ok();
                let d = at.and_then(|at| store.get(at).copied()).unwrap_or(0);
                let value =
                    result.result(pattern(px, py), u32::from(s) & mask, u32::from(d) & mask) as u8;

                // As `DeviceBitmap::put` writes a pixel: where it is, and
                // where the bitmap's clip and its device context's allow.
                if let Some(at) = at
                    && context.clip.as_ref().is_none_or(|clip| clip(px, py))
                    && context.dc_clip.as_ref().is_none_or(|clip| clip(px, py))
                    && let Some(pixel) = store.get_mut(at)
                {
                    *pixel = value;
                }
            }
        }
    }

    to.context.mark_rect(left, top, right, bottom);
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATCOPY: u32 = 0x00f0_0021;
    const SRCCOPY: u32 = 0x00cc_0020;

    fn target(bitmap: &DeviceBitmap, colour: Color) -> Target<'_> {
        Target {
            bitmap,
            brush: Brush {
                colour: Some(colour),
                hatch: None,
                pattern: None,
            },
            back: Color::rgb(0xff, 0xff, 0xff),
            text: None,
            origin: (0, 0),
            realized: None,
        }
    }

    #[test]
    fn a_grey_brush_fills_a_monochrome_bitmap_with_a_checkerboard() {
        let bitmap = DeviceBitmap::new(4, 2, 1, None, None);

        raster_op(
            DisplayKind::default(),
            &target(&bitmap, Color::rgb(0x80, 0x80, 0x80)),
            0,
            0,
            4,
            2,
            PATCOPY,
            None,
            0,
            0,
        );

        assert_eq!(*bitmap.indices.borrow(), vec![1, 0, 1, 0, 0, 1, 0, 1]);
    }

    #[test]
    fn a_monochrome_source_takes_the_text_and_background_colours() {
        let screen = DeviceBitmap::new(2, 1, 4, None, None);
        let mono = DeviceBitmap::new(
            2,
            1,
            1,
            Some(Rc::new(std::cell::RefCell::new(vec![0, 1]))),
            None,
        );
        let mut dest = target(&screen, Color::rgb(0, 0, 0));

        dest.text = Some(Color::rgb(0xff, 0, 0));
        dest.back = Color::rgb(0, 0, 0xff);
        raster_op(
            DisplayKind::default(),
            &dest,
            0,
            0,
            2,
            1,
            SRCCOPY,
            Some(&Source {
                bitmap: &mono,
                width: 2,
                height: 1,
                back: None,
            }),
            0,
            0,
        );

        assert_eq!(*screen.indices.borrow(), vec![9, 12]);
    }
}
