//! How many times over a strike is drawn: a measurement of Windows read
//! straight out of `font-vga`'s recording. Ported from the TypeScript
//! engine's `test/raster/strike_stretch_test.ts`.
//!
//! A bitmap face has a handful of strikes and is asked for every size, so
//! most sizes are answered by drawing a smaller strike a whole number of
//! times over. The dense sweep asks every height from one to forty, then
//! every third to a hundred and twenty.
//!
//! Two faces have exactly one strike each, which is the clean case: no
//! choice of strike to confound the multiple. Fixedsys is fifteen rows and
//! System is sixteen, and both step at `cell * m - offset` with the offset a
//! quarter of the cell. So the multiple is `floor((height + cell / 4) /
//! cell)`, and a request can come back *taller* than it asked for: twenty-
//! eight pixels of System is answered with thirty-two.
//!
//! **Measured**, and since **read out** of `GDI.EXE`: the quarter is `sar
//! cx,2` at `seg3:1bf7` and the cap of eight is `cmp ax,8`. `FONTS.md`
//! section 3 has the rest of the mapper's penalty.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::Value;

/// Every recorded cell height for one face, by the height asked for; `None`
/// where the checkout lacks the recording.
fn heights_of(face: &str) -> Option<BTreeMap<i32, i32>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../oracle/fixtures/font-vga.json");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).unwrap();
    let prefix = format!("\"{face}\",h=");
    let mut out = BTreeMap::new();

    for record in fixture["records"].as_array().unwrap() {
        if record["function"] != "CreateFont heights" {
            continue;
        }

        let args = record["args"].as_str().unwrap_or("");
        let Some(rest) = args.strip_prefix(&prefix) else {
            continue;
        };
        let Some((asked, rest)) = rest.split_once(',') else {
            continue;
        };

        if !rest.starts_with("w=0,weight=400,italic=0,") {
            continue;
        }

        let Ok(asked) = asked.parse::<i32>() else {
            continue;
        };

        if asked <= 0 {
            continue;
        }

        let result = record["result"].as_str().unwrap();
        let height = result
            .split(',')
            .find_map(|field| field.strip_prefix("height="))
            .unwrap()
            .parse()
            .unwrap();

        out.insert(asked, height);
    }

    Some(out)
}

#[test]
fn steps_each_single_strike_face_a_quarter_of_a_cell_early() {
    for (face, cell) in [("Fixedsys", 15), ("System", 16)] {
        let Some(heights) = heights_of(face) else {
            return;
        };

        assert!(heights.len() > 60, "{face}: {}", heights.len());

        for (&asked, &got) in &heights {
            let times = ((asked + (cell >> 2)) / cell).clamp(1, 8);

            assert_eq!((face, asked, got), (face, asked, cell * times));
        }
    }
}

/// Both faces are asked for up to a hundred and twenty pixels, which is
/// eight of Fixedsys and seven and a half of System. Fixedsys stopping
/// exactly at eight is what pins the cap: nine would have answered 135
/// somewhere in the sweep and does not.
#[test]
fn never_draws_a_strike_more_than_eight_times_over() {
    let Some(fixed) = heights_of("Fixedsys") else {
        return;
    };

    assert_eq!(fixed.values().max(), Some(&120));
    assert_eq!(fixed.get(&120), Some(&120));
}
