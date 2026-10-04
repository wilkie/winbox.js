//! Reading a TrueType font for what it says about itself, and the
//! interpreter checked against the font's own answers: the TypeScript
//! engine's `truetype_font_test` and `glyph_hinting_test`.
//!
//! The fonts are the installation's, which is built rather than committed;
//! where it has not been built these say nothing.

// Deliberately: numbers compared and converted as a JavaScript engine's
// are, since every rule here was measured through one.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use std::path::PathBuf;

use super::*;

/// One of the installed outline fonts, off the built installation.
fn installed(name: &str) -> Option<TrueTypeFont> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../oracle/build/drive-c/WINDOWS/SYSTEM")
        .join(name);

    std::fs::read(path).ok().map(TrueTypeFont::new)
}

#[test]
fn names_itself_and_measures_itself() {
    for (file, face, fixed) in [
        ("ARIAL.TTF", "Arial", false),
        ("TIMES.TTF", "Times New Roman", false),
        ("COUR.TTF", "Courier New", true),
        ("WINGDING.TTF", "Wingdings", false),
    ] {
        let Some(font) = installed(file) else {
            return;
        };

        assert_eq!(font.face_name(), face);
        assert!((font.units_per_em() - 2048.0).abs() < f64::EPSILON);
        assert!(font.ascender() > 0.0 && font.descender() > 0.0);

        // Between them they cover more than the em: the internal leading.
        assert!(font.ascender() + font.descender() > font.units_per_em());

        assert!(!font.cmap().is_empty());
        assert!(font.advance_for(u32::from(b'W')) > 0.0);
        assert!(font.advance_for(u32::from(b'g')) > 0.0);

        assert_eq!(font.fixed_pitch(), fixed, "{file}");

        let w = font.advance_for(u32::from(b'W'));
        let i = font.advance_for(u32::from(b'i'));

        if face != "Wingdings" {
            #[allow(clippy::float_cmp)]
            let agrees = if fixed { w == i } else { w > i };

            assert!(agrees, "{file}");
        }
    }
}

#[test]
fn reads_the_grid_fitted_tables() {
    let Some(arial) = installed("ARIAL.TTF") else {
        return;
    };

    // Verified against what Windows reports for a sixteen pixel cell.
    assert_eq!(
        arial.extent_at(13.0, 1.0, 1.0),
        Some(Extent {
            ascent: 13.0,
            descent: 3.0
        })
    );
    assert_eq!(arial.extent_at(7.0, 1.0, 1.0), None);

    // Thirteen and fourteen both come out sixteen pixels tall, and the
    // smaller is the one Windows settles on.
    let found = arial.size_for_height(16.0, 1.0, 1.0).unwrap();

    assert_eq!((found.ascent, found.descent, found.ppem), (13.0, 3.0, 13.0));

    for height in [12.0, 16.0, 20.0, 24.0, 32.0, 48.0, 64.0, 100.0] {
        let found = arial.size_for_height(height, 1.0, 1.0).unwrap();

        assert!(found.ascent + found.descent <= height, "{height}");
    }

    // Asked for less than the font fits in, Windows overflows: one pixel of
    // Arial comes back two pixels tall. **Recorded.**
    let found = arial.size_for_height(1.0, 1.0, 1.0).unwrap();

    assert!((found.ascent + found.descent - 2.0).abs() < f64::EPSILON);
    assert_eq!(arial.size_for_height(2.0, 1.0, 1.0), Some(found));

    let glyph = arial.glyph_for(u32::from(b'W'));

    assert!(
        arial
            .device_advance(13.0, glyph)
            .is_some_and(|advance| advance > 0.0)
    );
    assert_eq!(arial.device_advance(7.0, glyph), None);
}

#[test]
fn tells_the_files_of_a_family_apart() {
    let (Some(arial), Some(bold), Some(wingdings), Some(times)) = (
        installed("ARIAL.TTF"),
        installed("ARIALBD.TTF"),
        installed("WINGDING.TTF"),
        installed("TIMES.TTF"),
    ) else {
        return;
    };

    assert!(arial.regular());
    assert!(!bold.regular());
    assert_eq!(bold.face_name(), "Arial");
    assert_eq!(bold.full_name(), "Arial Bold");

    assert!(!arial.symbolic());
    assert!(wingdings.symbolic());

    // FF_SWISS for the sans serifs, FF_ROMAN for the serifs.
    assert_eq!(arial.family(), 0x20);
    assert_eq!(times.family(), 0x10);
}

#[test]
fn refuses_bytes_that_are_not_a_font() {
    assert!(!TrueTypeFont::looks_like_font(&[1, 2, 3, 4]));
}

#[test]
fn runs_the_programs_that_set_a_size_up() {
    let Some(font) = installed("ARIAL.TTF") else {
        return;
    };
    let mut hinter = Hinter::new(font.data(), 13.0, true, 1.0, false).unwrap();

    hinter.prepare(font.data()).unwrap();

    // `fpgm` is nothing but function definitions, and `prep` calls them.
    assert!(hinter.function_count() > 50);

    // The same table at twice the size is about twice the numbers.
    let small = Hinter::new(font.data(), 13.0, true, 1.0, false).unwrap();
    let large = Hinter::new(font.data(), 26.0, true, 1.0, false).unwrap();
    let (small, large) = (small.control_values(), large.control_values());

    assert!(small.len() > 100);

    let total = |values: &[f64]| values.iter().map(|value| value.abs()).sum::<f64>();
    let ratio = total(&large) / total(&small);

    assert!(ratio > 1.8 && ratio < 2.2, "{ratio}");
}

#[test]
fn runs_a_glyph_program_to_the_end() {
    let Some(font) = installed("ARIAL.TTF") else {
        return;
    };
    let mut hinter = Hinter::new(font.data(), 13.0, true, 1.0, false).unwrap();
    let glyph = font.glyph_for(u32::from(b'A'));
    let range = font.data().glyph_range(glyph).unwrap().unwrap();
    let contours = i64::from(font.data().i16_at(range.offset).unwrap());
    let instructions = range.offset + 10 + contours * 2;
    let length = i64::from(font.data().u16_at(instructions).unwrap());

    assert!(length > 0);

    let outline = font.outline_of(glyph, 0).unwrap();
    let fitted = hinter
        .hint(
            font.data(),
            &outline,
            font.advance_of(glyph),
            font.bearing_of(glyph).unwrap(),
            f64::from(font.data().i16_at(range.offset + 2).unwrap()),
            instructions + 2,
            length,
            None,
        )
        .unwrap();

    // The same shape comes back, in pixels rather than font units.
    assert_eq!(fitted.len(), 2);
    assert_eq!(fitted[0].len(), outline[0].len());

    // A size of nought is not something to hint at.
    let unfitted = font.hinted_outline(glyph, 0.0, true, 1.0, false).unwrap();

    assert!(!unfitted.hinted);
    assert_eq!(unfitted.contours.len(), 2);
}

/// Every `(ppem, glyph, advance)` a font's `hdmx` states.
fn tabulated(font: &TrueTypeFont) -> Vec<(f64, u32, f64)> {
    let data = font.data();
    let base = data.table("hdmx").unwrap().offset;
    let count = i64::from(data.i16_at(base + 2).unwrap());
    let stride = i64::from(data.i32_at(base + 4).unwrap());
    let mut rows = Vec::new();

    for index in 0..count {
        let record = base + 8 + index * stride;
        let ppem = f64::from(data.u8_at(record).unwrap());

        for glyph in 0..stride - 2 {
            rows.push((
                ppem,
                glyph as u32,
                f64::from(data.u8_at(record + 2 + glyph).unwrap()),
            ));
        }
    }

    rows
}

/// The interpreter against the table the font ships: `hdmx` is the output of
/// running the hinting programs, computed by whoever built the font, with
/// the advance phantom left where the scaling put it. Every glyph that has a
/// program, at all twenty-four tabulated sizes, composites among them.
#[test]
fn reproduces_every_advance_arial_tabulates() {
    let Some(arial) = installed("ARIAL.TTF") else {
        return;
    };
    let mut checked = 0;

    for (ppem, glyph, advance) in tabulated(&arial) {
        let Some(hinted) = arial.hinted_advance(glyph, ppem, false, 1.0).unwrap() else {
            continue;
        };

        assert_eq!(
            format!("{ppem}/{glyph}: {hinted}"),
            format!("{ppem}/{glyph}: {advance}")
        );
        checked += 1;
    }

    assert_eq!(checked, 5208);
}

/// All but one: the `o` at seventy-five pixels per em comes out a pixel from
/// what the font says, and five composites take their metrics from it.
#[test]
fn reproduces_all_but_one_of_the_advances_times_new_roman_tabulates() {
    let Some(times) = installed("TIMES.TTF") else {
        return;
    };
    let (mut agreed, mut differed) = (0, 0);

    for (ppem, glyph, advance) in tabulated(&times) {
        let Some(hinted) = times.hinted_advance(glyph, ppem, false, 1.0).unwrap() else {
            continue;
        };

        #[allow(clippy::float_cmp)]
        if hinted == advance {
            agreed += 1;
        } else {
            differed += 1;
        }
    }

    assert_eq!(
        format!("{agreed} agreed, {differed} differed"),
        "5202 agreed, 6 differed"
    );
}

/// Every glyph of every installed outline font that carries a program, run
/// to the end at five sizes without refusing an instruction.
#[test]
fn runs_every_glyph_of_every_outline_font() {
    let folder =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../oracle/build/drive-c/WINDOWS/SYSTEM");
    let Ok(listing) = std::fs::read_dir(&folder) else {
        return;
    };
    let mut ran = 0;
    let mut refused = Vec::new();

    for entry in listing.flatten() {
        let name = entry.file_name().to_string_lossy().to_uppercase();

        if !std::path::Path::new(&name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("TTF"))
        {
            continue;
        }

        let font = TrueTypeFont::new(std::fs::read(entry.path()).unwrap());
        let data = font.data();
        let glyphs = if data.has("maxp") {
            data.unsigned("maxp", 4).unwrap() as u32
        } else {
            0
        };

        for glyph in 0..glyphs {
            let Some(range) = data.glyph_range(glyph).unwrap() else {
                continue;
            };
            let contours = i64::from(data.i16_at(range.offset).unwrap());

            // A composite carries no program of its own to run.
            if contours < 0 {
                continue;
            }

            let at = range.offset + 10 + contours * 2;
            let length = i64::from(data.u16_at(at).unwrap());

            if length == 0 {
                continue;
            }

            for ppem in [8.0, 11.0, 16.0, 24.0, 40.0] {
                ran += 1;

                let mut hinter = Hinter::new(data, ppem, true, 1.0, false).unwrap();
                let fitted = hinter.hint(
                    data,
                    &font.outline_of(glyph, 0).unwrap(),
                    font.advance_of(glyph),
                    font.bearing_of(glyph).unwrap(),
                    f64::from(data.i16_at(range.offset + 2).unwrap()),
                    at + 2,
                    length,
                    None,
                );

                if fitted.is_err() && refused.len() < 8 {
                    refused.push(format!("{name} glyph {glyph} at {ppem}"));
                }
            }
        }
    }

    assert_eq!(refused, Vec::<String>::new());

    if ran > 0 {
        assert!(ran > 8000, "{ran}");
    }
}
