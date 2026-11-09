//! The interpreter held to Windows through fabricated fonts.
//!
//! Each fabrication is an installed face with one glyph's program rewritten
//! to report a point, or a state, back through the advance phantom; the
//! `hinting` probe recorded the advance Windows gave it at every cell
//! height. Where `hdmx` or `LTSH` answers a size the program never runs, so
//! those sizes say nothing and are passed over.
//!
//! The recordings and the fonts are built rather than committed; where they
//! have not been built these say nothing.

#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use std::path::{Path, PathBuf};

use super::*;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The face each fabricated file stands in for, as the probe asked for it.
fn face_of(file: &str) -> Option<(&'static str, &'static str)> {
    Some(match file {
        "ARIALI.TTF" => ("Arial", "1"),
        "ARIAL.TTF" => ("Arial", "0"),
        "COUR.TTF" => ("Courier New", "0"),
        "TIMES.TTF" => ("Times New Roman", "0"),
        "TIMESI.TTF" => ("Times New Roman", "1"),
        _ => return None,
    })
}

/// A recording: its name, the fabricated font and the file it stands for,
/// and its records' arguments and results.
struct Recording {
    name: String,
    file: String,
    font: TrueTypeFont,
    records: Vec<(String, String)>,
}

/// Every fabricated recording whose font has been built, in name order.
fn recordings() -> Vec<Recording> {
    let fixtures = root().join("oracle/fixtures/fabricated");
    let fonts = root().join("oracle/build/fonts");
    let Ok(listing) = std::fs::read_dir(&fixtures) else {
        return Vec::new();
    };
    let mut names: Vec<String> = listing
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            Path::new(name)
                .extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();

    names.sort();

    names
        .into_iter()
        .filter_map(|entry| {
            let text = std::fs::read_to_string(fixtures.join(&entry)).ok()?;
            let fixture: serde_json::Value = serde_json::from_str(&text).ok()?;
            let directory = fonts.join(fixture["font"].as_str()?);
            let mut files: Vec<String> = std::fs::read_dir(&directory)
                .ok()?
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect();

            files.sort();

            let file = files.into_iter().next()?;
            let font = TrueTypeFont::new(std::fs::read(directory.join(&file)).ok()?);
            let records = fixture["records"]
                .as_array()?
                .iter()
                .map(|record| {
                    (
                        record["args"].as_str().unwrap_or("").to_string(),
                        record["result"].as_str().unwrap_or("").to_string(),
                    )
                })
                .collect();

            Some(Recording {
                name: entry.trim_end_matches(".json").to_string(),
                file,
                font,
                records,
            })
        })
        .collect()
}

/// A reading: the size, what Windows said, and what this says.
#[derive(Debug)]
struct Reading {
    ppem: f64,
    windows: f64,
    ours: Option<f64>,
}

/// `"Face",h=N,italic=I,'c'`, taken apart.
fn asked(args: &str) -> Option<(&str, i32, &str, u8)> {
    let rest = args.strip_prefix('"')?;
    let (face, rest) = rest.split_once("\",h=")?;
    let (height, rest) = rest.split_once(",italic=")?;
    let (italic, rest) = rest.split_once(",'")?;
    let character = rest.strip_suffix('\'')?;

    (character.len() == 1).then(|| {
        (
            face,
            height.parse().unwrap_or(0),
            italic,
            character.as_bytes()[0],
        )
    })
}

/// `advance=A,ppem=P`, taken apart.
fn said(result: &str) -> Option<(f64, f64)> {
    let rest = result.strip_prefix("advance=")?;
    let (advance, rest) = rest.split_once(",ppem=")?;
    let ppem = rest.split(',').next()?;

    Some((advance.parse().ok()?, ppem.parse().ok()?))
}

/// The readings a recording can give: the face it stands for, at a cell of
/// twelve or more, at a size neither `hdmx` nor `LTSH` answers, once each.
fn readings(recording: &Recording, only: Option<u8>) -> Vec<Reading> {
    let Some((face, italic)) = face_of(&recording.file) else {
        return Vec::new();
    };
    let font = &recording.font;
    let mut seen = Vec::new();
    let mut found = Vec::new();

    for (args, result) in &recording.records {
        let (Some(asked), Some((windows, ppem))) = (asked(args), said(result)) else {
            continue;
        };

        if asked.0 != face || asked.2 != italic || only.is_some_and(|only| only != asked.3) {
            continue;
        }

        let glyph = font.glyph_for(u32::from(asked.3));

        if windows < 0.0
            || asked.1 < 12
            || font.device_advance(ppem, glyph).is_some()
            || font.linear_advance(glyph, ppem, ppem).is_some()
            || seen.contains(&(ppem as i64))
        {
            continue;
        }

        seen.push(ppem as i64);
        found.push(Reading {
            ppem,
            windows,
            ours: font.hinted_advance(glyph, ppem, true, 1.0).unwrap(),
        });
    }

    found
}

#[test]
fn agree_on_every_interior_point_of_arial_italics_m() {
    let all = recordings();
    let mut wrong = Vec::new();
    let mut compared = 0;

    for recording in all
        .iter()
        .filter(|recording| recording.name.contains("ariali-m"))
    {
        for reading in readings(recording, None) {
            compared += 1;

            if reading.ours != Some(reading.windows) {
                wrong.push(format!(
                    "{} at {}: Windows {}, ours {:?}",
                    recording.name, reading.ppem, reading.windows, reading.ours
                ));
            }
        }
    }

    assert_eq!(wrong, Vec::<String>::new());

    if !all.is_empty() {
        // Sixteen recordings of five points at fifty readable sizes each.
        assert!(compared > 700, "{compared}");
    }
}

#[test]
fn agree_on_a_glyph_carried_onto_its_side_bearing() {
    let all = recordings();
    let wanted = [
        "times-rounding",
        "times-swapped",
        "times-magnified",
        "times-halves",
    ];
    let mut found = Vec::new();
    let mut total = 0;

    for recording in all.iter().filter(|recording| {
        wanted
            .iter()
            .any(|name| recording.name.get(8..) == Some(name))
    }) {
        for character in [b'W', b'o', b'w'] {
            for reading in readings(recording, Some(character)) {
                total += 1;

                if reading.ours != Some(reading.windows) {
                    found.push(format!(
                        "{} {} at {}: Windows {}, ours {:?}",
                        recording.name,
                        char::from(character),
                        reading.ppem,
                        reading.windows,
                        reading.ours
                    ));
                }
            }
        }
    }

    assert_eq!(found, Vec::<String>::new());

    if !all.is_empty() {
        assert!(total > 700, "{total}");
    }
}

#[test]
fn agree_on_the_advance_phantom_of_times_new_roman_italics_j() {
    let all = recordings();
    let mut wrong = Vec::new();
    let mut compared = 0;

    for recording in all
        .iter()
        .filter(|recording| recording.name.contains("timesi-j-p50"))
    {
        for reading in readings(recording, None) {
            compared += 1;

            if reading.ours != Some(reading.windows) {
                wrong.push(format!(
                    "{} at {}: Windows {}, ours {:?}",
                    recording.name, reading.ppem, reading.windows, reading.ours
                ));
            }
        }
    }

    assert_eq!(wrong, Vec::<String>::new());

    if !all.is_empty() {
        // Eight cuts, at the sizes between a twelve pixel cell and the
        // threshold.
        assert!(compared > 100, "{compared}");
    }
}

#[test]
fn read_a_constant_back_unchanged_at_every_size() {
    let all = recordings();
    let Some(control) = all
        .iter()
        .find(|recording| recording.name.ends_with("ariali-m-constant"))
    else {
        return;
    };
    let values = readings(control, None);

    assert!(values.len() > 40, "{}", values.len());
    assert!(values.iter().all(|reading| reading.windows == 16.0));
}

/// A reading of one `hinting` recording: the pixel size Windows reported,
/// what Windows said, and what the interpreter says at that size.
type Hinted = (f64, f64, Option<f64>);

/// One `hinting` recording by name, read as the tests below read it: each pixel size
/// Windows reports for Arial Italic's `m`, once, with the interpreter run at
/// that size. `None` where the recording or its font has not been built.
fn hinted(name: &str) -> Option<Vec<Hinted>> {
    let text = std::fs::read_to_string(
        root().join(format!("oracle/fixtures/fabricated/hinting-{name}.json")),
    )
    .ok()?;
    let fixture: serde_json::Value = serde_json::from_str(&text).ok()?;
    let directory = root().join("oracle/build/fonts").join(name);
    let mut files: Vec<PathBuf> = std::fs::read_dir(&directory)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .collect();

    files.sort();

    let font = TrueTypeFont::new(std::fs::read(files.first()?).ok()?);
    let glyph = font.glyph_for(u32::from(b'm'));
    let mut out: Vec<Hinted> = Vec::new();

    for record in fixture["records"].as_array()? {
        let args = record["args"].as_str().unwrap_or("");
        let Some((face, _, italic, character)) = asked(args) else {
            continue;
        };

        if face != "Arial" || italic != "1" || character != b'm' {
            continue;
        }

        let Some((windows, ppem)) = said(record["result"].as_str().unwrap_or("")) else {
            continue;
        };

        if out.iter().any(|(seen, _, _)| *seen == ppem) {
            continue;
        }

        out.push((
            ppem,
            windows,
            font.hinted_advance(glyph, ppem, true, 1.0).unwrap(),
        ));
    }

    Some(out)
}

/// What Windows said and what the interpreter says, at a size.
fn hinted_at(readings: &[Hinted], ppem: f64) -> Option<(f64, Option<f64>)> {
    readings
        .iter()
        .find(|(size, _, _)| *size == ppem)
        .map(|(_, windows, ours)| (*windows, *ours))
}

/// The sizes where two recordings' Windows answers differ: where the
/// program ran, a size `hdmx` covers answering the letter's own width for
/// both.
fn differing(one: &[Hinted], other: &[Hinted]) -> Vec<f64> {
    one.iter()
        .filter(|(ppem, windows, _)| {
            hinted_at(other, *ppem).map(|(said, _)| said) != Some(*windows)
        })
        .map(|(ppem, _, _)| *ppem)
        .collect()
}

/// What `ISECT` does when the two lines barely cross. The same five points every time, only the
/// second line's far end moving: at right angles, half a degree apart, and
/// exactly parallel. Windows divides unless the denominator is exactly
/// nought, so two lines a fraction of a degree apart put the point hundreds
/// of pixels away -- on either side, as the rounding lands -- and the
/// controls put it inside the glyph. Where they graze, matching at all is
/// the surprise: dividing by a denominator near nought multiplies whatever
/// the sixty-fourths disagree by.
#[test]
fn isect_divides_rather_than_taking_the_midpoint() {
    let (Some(cross), Some(graze), Some(parallel)) = (
        hinted("isect-crossing"),
        hinted("isect-grazing"),
        hinted("isect-parallel"),
    ) else {
        return;
    };
    let live = differing(&graze, &cross);

    assert!(live.len() > 20, "{}", live.len());

    let mut exact = 0;

    for &ppem in &live {
        let (crossed, ours_crossed) = hinted_at(&cross, ppem).unwrap();
        let (level, ours_level) = hinted_at(&parallel, ppem).unwrap();
        let (grazed, ours_grazed) = hinted_at(&graze, ppem).unwrap();

        // In Windows: the controls inside the glyph, the grazing pair far out.
        assert!(crossed.abs() < 40.0, "{ppem}: {crossed}");
        assert!(level.abs() < 40.0, "{ppem}: {level}");
        assert!(grazed.abs() > 60.0, "{ppem}: {grazed}");

        // Exact where the lines properly cross, and where they do not at all.
        assert_eq!(ours_crossed, Some(crossed), "crossing at {ppem}");
        assert_eq!(ours_level, Some(level), "parallel at {ppem}");

        if ours_grazed == Some(grazed) {
            exact += 1;
        }
    }

    // A floor: the sizes where the grazing answer matches to the pixel.
    assert!(exact >= 10, "{exact}");
}

/// The round state a byte describes. `SROUND` with a period of 999 masked with `~998`
/// lands nowhere near a pixel boundary and the answer moves with the input,
/// which is how the mask shows itself: a division by 999 would give the same
/// answer every time. The forty-five degree period is a root and rounds two
/// ways, so two sizes of `s45round-half` are left.
#[test]
fn rounds_with_a_mask_so_an_illegal_period_is_not_a_whole_pixel() {
    let cases = [
        ("sround-illegal", 0),
        ("sround-quarter", 0),
        ("s45round-half", 2),
    ];
    let mut all = Vec::new();

    for (name, _) in cases {
        let Some(readings) = hinted(name) else {
            return;
        };

        all.push(readings);
    }

    let live = differing(&all[0], &all[1]);

    assert!(live.len() > 20, "{}", live.len());

    let mut answers: Vec<f64> = live
        .iter()
        .map(|&ppem| hinted_at(&all[0], ppem).unwrap().0)
        .collect();

    answers.sort_by(f64::total_cmp);
    answers.dedup();
    assert!(answers.len() > 1, "{answers:?}");

    for ((name, left), readings) in cases.iter().zip(&all) {
        let differ = live
            .iter()
            .filter(|&&ppem| {
                let (windows, ours) = hinted_at(readings, ppem).unwrap();

                ours != Some(windows)
            })
            .count();

        assert!(differ <= *left, "{name}: {differ} differ");
    }
}
