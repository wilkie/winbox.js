//! Where a glyph's ink stops: measurements of Windows read straight out of
//! the fabricated `glyphs` recordings, with nothing of the engine's in
//! between. Ported from the TypeScript engine's `test/raster/cell_edge_test.ts`.
//!
//! A glyph is drawn into a cell as tall as the font asks for, and ink outside
//! it is not drawn -- clipped to the cell, not to what is drawn on. A hinted
//! outline can leave the cell, and the part outside does not appear.
//!
//! `times-cvt0-fine` turned that up: a bar put five rows below the bottom of
//! the cell came back as nothing. `times-cell-edge` puts one on each row
//! around the edge: at sixteen the cell is sixteen rows with the baseline on
//! thirteen; rows thirteen, fourteen and fifteen come back and sixteen does
//! not, nor a bar above row nought. At twenty-four all six come back.
//!
//! Then how far out of the cell an outline may reach before none of it is
//! drawn (`times-tall`, `times-reach`, `cour-tall`, `times-wide`,
//! `times-broad`, `times-tall-maxp`): the reach above the baseline, rounded
//! to the nearest row, refused at twice the cell or more -- and what is
//! counted is bytes, eight a row of the cell, a row padded to thirty-two
//! bits. The budget is sized from the cell and not from the font's `maxp`.
//! The refusal is raised in the scaler as an escape from a memory request
//! that came back empty.
//!
//! The recordings are committed; where a checkout lacks one these say nothing.

use std::path::Path;

use serde_json::Value;

/// A fabricated recording's records, as arguments and result.
fn records(name: &str) -> Option<Vec<(String, String)>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../oracle/fixtures/fabricated/glyphs-{name}.json"
    ));
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).unwrap();

    Some(
        fixture["records"]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| {
                let text = |key: &str| record[key].as_str().unwrap_or("").to_string();

                (text("args"), text("result"))
            })
            .collect(),
    )
}

/// Which rows of a 32 by 32 cell carry ink: a clear bit is ink.
fn rows_of(hex: &str) -> Vec<usize> {
    let byte = |at: usize| u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16).unwrap();

    (0..32)
        .filter(|row| {
            (0..32).any(|column: usize| byte(row * 4 + (column >> 3)) & (0x80 >> (column & 7)) == 0)
        })
        .collect()
}

/// The cell a face drew a character in, at a height.
fn cell<'a>(
    records: &'a [(String, String)],
    face: &str,
    height: i32,
    character: char,
) -> Option<&'a str> {
    let args = format!("\"{face}\",h={height},weight=400,italic=0,'{character}'");

    records
        .iter()
        .find(|(asked, _)| *asked == args)
        .map(|(_, result)| result.as_str())
}

fn times(records: &[(String, String)], height: i32, character: char) -> &str {
    cell(records, "Times New Roman", height, character).expect("the record")
}

fn drew(records: &[(String, String)], height: i32, character: char) -> bool {
    !rows_of(times(records, height, character)).is_empty()
}

/// The character each bar was written into, and the row it was aimed at.
const AIMED: [(char, i32); 5] = [('W', 13), ('g', 14), ('j', 15), ('1', 16), ('.', -1)];

#[test]
fn the_bottom_of_a_cell_is_its_last_row_and_nothing_past_it() {
    let Some(edge) = records("times-cell-edge") else {
        return;
    };
    let drawn = |height, character| rows_of(times(&edge, height, character));

    // Sixteen rows, so row fifteen is the last one there is.
    assert_eq!(drawn(16, 'W'), [13]);
    assert_eq!(drawn(16, 'g'), [14]);
    assert_eq!(drawn(16, 'j'), [15]);
    assert_eq!(drawn(16, '1'), Vec::<usize>::new());
}

#[test]
fn a_cell_has_a_top_as_well_as_a_bottom() {
    let Some(edge) = records("times-cell-edge") else {
        return;
    };

    // Aimed a row above the cell, and it does not come back.
    assert_eq!(rows_of(times(&edge, 16, '.')), Vec::<usize>::new());
}

#[test]
fn the_edge_is_the_cells_own_height_and_not_a_fixed_number_of_rows() {
    let Some(edge) = records("times-cell-edge") else {
        return;
    };
    let drawn = |height, character| rows_of(times(&edge, height, character));

    // Twelve rows at twelve: the bar that came back on row fifteen at
    // sixteen is past the bottom here, and the one before it is not.
    assert_eq!(drawn(12, 'W'), [10]);
    assert_eq!(drawn(12, 'g'), [11]);
    assert_eq!(drawn(12, 'j'), Vec::<usize>::new());

    // And at twenty-four every one of them is comfortably inside.
    for (character, _) in AIMED {
        assert_eq!(drawn(24, character).len(), 1, "{character}");
    }
}

#[test]
fn an_outline_under_twice_the_cell_is_drawn() {
    let Some(tall) = records("times-tall") else {
        return;
    };

    // Sixteen rows: eight, sixteen and twenty-four pixels all come back.
    assert_eq!(
        [
            drew(&tall, 16, 'W'),
            drew(&tall, 16, 'g'),
            drew(&tall, 16, 'j')
        ],
        [true; 3]
    );

    // Twenty-three rows at twenty-four, where the same bars measure twelve,
    // twenty-four and thirty-six pixels.
    assert_eq!(
        [
            drew(&tall, 24, 'W'),
            drew(&tall, 24, 'g'),
            drew(&tall, 24, 'j')
        ],
        [true; 3]
    );

    // Twelve rows, where the fourth bar measures twenty-three.
    assert_eq!([drew(&tall, 12, 'j'), drew(&tall, 12, '1')], [true; 2]);
}

#[test]
fn the_reach_above_the_baseline_is_measured_not_the_height_of_the_box() {
    let Some(reach) = records("times-reach") else {
        return;
    };

    // A mark by the baseline and a bar thirty-two rows below it, or four
    // rows of bar thirty rows below: boxes of forty-two and thirty-six rows
    // against a limit of thirty-two, and both marks come back.
    assert_eq!([drew(&reach, 16, 'W'), drew(&reach, 16, '1')], [true; 2]);

    // The same four rows thirty rows *above*, and it does not.
    assert!(!drew(&reach, 16, 'j'));

    // And two shapes that stay inside it either way.
    assert_eq!([drew(&reach, 16, 'g'), drew(&reach, 16, '.')], [true; 2]);
}

#[test]
fn an_outline_that_reaches_twice_the_cell_is_refused_entirely() {
    let Some(tall) = records("times-tall") else {
        return;
    };

    assert_eq!([drew(&tall, 16, '1'), drew(&tall, 16, '.')], [false; 2]);
    assert_eq!([drew(&tall, 24, '1'), drew(&tall, 24, '.')], [false; 2]);
}

/// `cour-tall`: five bars a single row apart, at the seven sizes Courier New
/// is given. A bar reaching 35.00 rows in a cell of eighteen comes back and
/// one reaching 35.55 does not: the reach is rounded to the nearest row.
#[test]
fn the_limit_is_twice_the_cell_to_the_row() {
    let Some(tall) = records("cour-tall") else {
        return;
    };

    // Cell height asked, cell and pixels per em, as Windows reports them.
    let sizes = [
        (10, 8, 8),
        (12, 12, 9),
        (14, 14, 11),
        (16, 16, 13),
        (18, 18, 16),
        (20, 20, 17),
        (24, 24, 22),
    ];

    // Each bar, in whole rows at sixteen pixels per em.
    let bars = [('W', 33), ('g', 34), ('j', 35), ('1', 36), ('.', 37)];
    let mut asked = 0;

    for (height, cell_height, ppem) in sizes {
        for (character, rows) in bars {
            let Some(result) = cell(&tall, "Courier New", height, character) else {
                continue;
            };

            asked += 1;

            // Written in units of a row at sixteen pixels per em, rounded to
            // the nearest row, a half up.
            let reach = (f64::from(rows * 128 * ppem) / 2048.0 + 0.5).floor() as i32;
            let drawn = if rows_of(result).is_empty() {
                "refused"
            } else {
                "drawn"
            };
            let expected = if reach >= 2 * cell_height {
                "refused"
            } else {
                "drawn"
            };

            assert_eq!(
                format!("{cell_height}/{rows}: {drawn}"),
                format!("{cell_height}/{rows}: {expected}")
            );
        }
    }

    // Not every size draws every character; this is what the sweep reaches.
    assert_eq!(asked, 29);
}

/// `times-wide`: bars thirty-six pixels across, eight bytes a row where
/// every earlier bar was four, refused at half the rows.
#[test]
fn the_budget_counts_bytes_not_rows() {
    let Some(wide) = records("times-wide") else {
        return;
    };

    assert_eq!([drew(&wide, 16, 'W'), drew(&wide, 16, 'g')], [true; 2]);
    assert_eq!(
        [
            drew(&wide, 16, 'j'),
            drew(&wide, 16, '1'),
            drew(&wide, 16, '.')
        ],
        [false; 3]
    );
}

/// `times-broad`: sixty-eight pixels across, padded to ninety-six bits,
/// twelve bytes a row. A cell of sixteen has a hundred and twenty-eight bytes
/// to spend: ten rows come back and eleven do not.
#[test]
fn the_budget_is_spent_to_the_byte() {
    let Some(broad) = records("times-broad") else {
        return;
    };

    // Eight, nine and ten rows: 96, 108 and 120 bytes.
    assert_eq!(
        [
            drew(&broad, 16, 'W'),
            drew(&broad, 16, 'g'),
            drew(&broad, 16, 'j')
        ],
        [true; 3]
    );

    // Eleven and twelve: 132 and 144.
    assert_eq!([drew(&broad, 16, '1'), drew(&broad, 16, '.')], [false; 2]);
}

/// `times-tall-maxp` is `times-tall-fine`'s bars in a font declaring four
/// times the points, contours, twilight points, storage and stack, and every
/// bar is drawn or refused exactly as before: the pool is sized from the
/// cell, not from what the font says of itself.
#[test]
fn the_pool_that_runs_out_is_not_the_workspace_the_font_sizes() {
    let (Some(plain), Some(bigger)) = (records("times-tall-fine"), records("times-tall-maxp"))
    else {
        return;
    };
    let mut compared = 0;

    for height in [10, 12, 14, 16, 18, 20, 24] {
        for character in ['W', 'g', 'j', '1', '.'] {
            let (Some(one), Some(other)) = (
                cell(&plain, "Times New Roman", height, character),
                cell(&bigger, "Times New Roman", height, character),
            ) else {
                continue;
            };

            compared += 1;
            assert_eq!(
                (height, character, rows_of(one).is_empty()),
                (height, character, rows_of(other).is_empty())
            );
        }
    }

    assert_eq!(compared, 30);
}
