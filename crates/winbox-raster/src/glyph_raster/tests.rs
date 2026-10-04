//! Filling an outline: the TypeScript engine's `glyph_raster_test`.

// Deliberately: numbers compared and converted as a JavaScript engine's
// are, since every rule here was measured through one.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use std::path::PathBuf;

use super::*;
use crate::truetype::TrueTypeFont;

/// A square, wound clockwise in the font's y-up coordinates.
fn square(size: f64) -> Contour {
    [(0.0, 0.0), (0.0, size), (size, size), (size, 0.0)]
        .into_iter()
        .map(|(x, y)| Point { x, y, on: true })
        .collect()
}

fn inked(filled: &Filled) -> usize {
    filled.pixels.iter().filter(|&&pixel| pixel != 0).count()
}

fn options(scale: f64, origin_y: f64) -> FillOptions {
    FillOptions {
        scale,
        origin_y,
        width: 16,
        height: 16,
        ..FillOptions::default()
    }
}

#[test]
fn fills_what_a_contour_encloses() {
    // Ten by ten, sampled at pixel centres.
    assert_eq!(
        inked(&fill_walked(&[square(10.0)], options(1.0, 10.0))),
        100
    );
}

#[test]
fn scales_to_the_size_asked_for() {
    assert_eq!(inked(&fill_walked(&[square(10.0)], options(0.5, 5.0))), 25);
}

#[test]
fn cuts_a_hole_where_a_contour_winds_the_other_way() {
    let inner: Contour = [(3.0, 3.0), (7.0, 3.0), (7.0, 7.0), (3.0, 7.0)]
        .into_iter()
        .map(|(x, y)| Point { x, y, on: true })
        .collect();

    assert_eq!(
        inked(&fill_walked(&[square(10.0), inner], options(1.0, 10.0))),
        100 - 16
    );
}

#[test]
fn starts_a_contour_correctly_when_it_begins_on_a_control_point() {
    let point = |x, y, on| Point { x, y, on };

    // Where the contour closes on a real point, that point is the start.
    let pieces = segments_of(
        &[
            point(10.0, 10.0, false),
            point(20.0, 0.0, true),
            point(0.0, 0.0, true),
        ],
        None,
    );

    assert_eq!(pieces[0].from, [0.0, 0.0]);

    // Where it closes on another control point, the start is between them.
    let pieces = segments_of(
        &[
            point(10.0, 10.0, false),
            point(20.0, 0.0, true),
            point(0.0, 20.0, false),
        ],
        None,
    );

    assert_eq!(pieces[0].from, [5.0, 15.0]);
}

#[test]
fn has_nothing_to_fill_for_an_empty_contour() {
    assert!(segments_of(&[], None).is_empty());
    assert_eq!(inked(&fill_walked(&[], options(1.0, 0.0))), 0);
}

#[test]
fn fills_a_glyph_from_an_installed_font() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../oracle/build/drive-c/WINDOWS/SYSTEM/ARIAL.TTF");
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    let font = TrueTypeFont::new(bytes);
    let contours = font.outline_of(font.glyph_for(u32::from(b'A')), 0).unwrap();

    // A capital A is two contours: the letter and the counter inside it.
    assert_eq!(contours.len(), 2);

    let filled = fill_walked(
        &contours,
        FillOptions {
            scale: 32.0 / font.units_per_em(),
            origin_x: 2.0,
            origin_y: 32.0,
            width: 48,
            height: 48,
            ..FillOptions::default()
        },
    );

    assert!(inked(&filled) > 50);
}
