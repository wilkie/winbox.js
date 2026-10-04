use super::*;

/// A bar three pixels wide standing on the baseline, `rows` tall, in
/// pixels.
fn bar(rows: f64) -> Vec<Contour> {
    let at = |x: f64, y: f64| Point { x, y, on: true };

    vec![vec![
        at(0.0, 0.0),
        at(0.0, rows),
        at(3.0, rows),
        at(3.0, 0.0),
    ]]
}

#[test]
fn refuses_a_glyph_that_reaches_too_far_out_of_its_cell() {
    // `times-reach`: a cell sixteen rows tall on a face fifteen pixels
    // across is 128 bytes, and a bar of four bytes a row is refused at
    // thirty-four rows and drawn below it.
    assert!(has_room(&bar(31.0), 1.0, 15.0, 16.0));
    assert!(!has_room(&bar(32.0), 1.0, 15.0, 16.0));
    assert!(!has_room(&bar(34.0), 1.0, 15.0, 16.0));

    // `buffer-times-buffer-sweep`: past 512 rows the count wraps in
    // sixteen bits and the glyph is drawn again.
    assert!(!has_room(&bar(506.0), 1.0, 15.0, 16.0));
    assert!(has_room(&bar(519.0), 1.0, 15.0, 16.0));
}

#[test]
fn refuses_a_glyph_a_program_left_not_a_number() {
    // A point a program named past the end of its zone reads as nothing,
    // and the TypeScript engine's `Math.max` carries that into the reach:
    // the comparison is false, and the glyph is not drawn.
    let mut contours = bar(4.0);

    contours[0][1].y = f64::NAN;
    assert!(!has_room(&contours, 1.0, 15.0, 16.0));

    // Across it is not: the columns go through `>> 5`, which makes nothing of
    // not-a-number, and the row is a long as any narrow one is.
    contours = bar(4.0);
    contours[0][2].x = f64::NAN;
    assert!(has_room(&contours, 1.0, 15.0, 16.0));
}
