//! The interpreter held to Windows through fabricated fonts: the TypeScript
//! engine's `fabricated_test`.
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
