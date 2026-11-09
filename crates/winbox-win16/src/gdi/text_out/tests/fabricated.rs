//! The fabricated recordings other than `glyphs`, held to Windows through
//! GDI, each with the ceilings its test kept (dropout size, glyph buffer,
//! tall glyphs, turned squares, and the `hinting` readouts of delta base,
//! delta order, `GETINFO` version, point size and twilight placement).
//!
//! Each recording names the fabricated font it was made against; the font
//! stands in for the face it was cut from, in that face's style, and is put
//! back after. The recordings are committed and the fonts are built; where a
//! checkout lacks either these say nothing.

use std::collections::BTreeMap;

use crate::gdi::text::{get_text_extent, get_text_metrics};

use super::*;

/// A fabricated recording: its display, its records, and its font standing
/// in on a system of that display. `None` where it has not been built.
struct Fabricated {
    system: System,
    face: String,
    kept: Option<crate::fonts::Family>,
    records: Vec<[String; 3]>,
}

impl Fabricated {
    fn open(name: &str) -> Option<Self> {
        let text =
            std::fs::read_to_string(root().join(format!("oracle/fixtures/fabricated/{name}.json")))
                .ok()?;
        let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
        let display = fixture["display"].as_str().unwrap_or("vga");
        let directory = root()
            .join("oracle/build/fonts")
            .join(fixture["font"].as_str()?);
        let mut files: Vec<PathBuf> = std::fs::read_dir(&directory)
            .ok()?
            .flatten()
            .map(|entry| entry.path())
            .collect();

        files.sort();

        let mut system = installed(display)?;
        let font = winbox_raster::TrueTypeFont::new(std::fs::read(files.first()?).ok()?);

        system.fonts();

        let (face, kept) = system.fonts.as_mut().unwrap().stand_in(font);
        let field =
            |record: &serde_json::Value, key: &str| record[key].as_str().unwrap_or("").to_string();
        let records = fixture["records"]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| {
                [
                    field(record, "function"),
                    field(record, "args"),
                    field(record, "result"),
                ]
            })
            .collect();

        Some(Self {
            system,
            face,
            kept,
            records,
        })
    }
}

impl Drop for Fabricated {
    fn drop(&mut self) {
        let kept = self.kept.take();

        if let Some(fonts) = self.system.fonts.as_mut() {
            fonts.put_back(&self.face, kept);
        }
    }
}

/// What a recorded function draws; `None` for a function with no adapter
/// here.
fn replayed(system: &mut System, function: &str, args: &str) -> Option<String> {
    Some(match function {
        "column" => column(system, &Asked::parse(args)),
        "square ink" => square(system, args),
        "square box" => turned_box(&square(system, args)),
        "pen ink" => pen_ink(system, args),
        "advance" => advance(system, args),
        _ => return None,
    })
}

/// The hex of one record replayed, or a disagreement's marker.
fn agrees(system: &mut System, [function, args, result]: &[String; 3]) -> bool {
    replayed(system, function, args).as_deref() == Some(result.as_str())
}

/// `column`: one character drawn two hundred rows tall into a cell sixty-four
/// wide, as the `bands` probe draws it, written as the leftmost inked column
/// of each row, `ff` where the row is empty.
fn column(system: &mut System, asked: &Asked) -> String {
    let (hdc, bitmap) = cell(system, 64, 200);
    let font = asked.font(system);

    select_object(system, hdc, font);

    let text = asked.text.clone().unwrap();
    let drawn = text_out(system, hdc, 2, 0, &text);
    let hex = drawn.map(|_| bits(system, bitmap, 8 * 200));

    delete_dc(system, hdc);
    delete_object(system, bitmap);
    delete_object(system, font);

    let Ok(hex) = hex else {
        return String::new();
    };
    let byte = |at: usize| u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16).unwrap();
    let mut out = String::new();

    for row in 0..200 {
        let found = (0..64)
            .find(|column: &usize| byte(row * 8 + (column >> 3)) & (0x80 >> (column & 7)) == 0)
            .map_or(0xff, |column| column as u8);

        let _ = write!(out, "{found:02x}");
    }

    out
}

/// A record's `name=value` fields.
fn fields(args: &str) -> BTreeMap<&str, &str> {
    args.split(',')
        .filter_map(|field| field.split_once('='))
        .collect()
}

/// Symbol, turned, as `rotsq` and `rotpen` ask for it.
fn turned_font(system: &mut System, fields: &BTreeMap<&str, &str>) -> u16 {
    let escapement = fields.get("esc").map_or(0, |esc| esc.parse().unwrap());

    create_font_indirect(
        system,
        LogFont {
            height: fields.get("h").map_or(0, |h| h.parse().unwrap()),
            weight: 400,
            escapement,
            orientation: escapement,
            char_set: 2,
            face_name: "Symbol".to_string(),
            ..LogFont::default()
        },
    )
}

/// The text a record draws, its quotes taken off.
fn quoted_text<'a>(fields: &BTreeMap<&str, &'a str>) -> &'a [u8] {
    fields
        .get("text")
        .map_or("A", |text| text.trim_matches('"'))
        .as_bytes()
}

/// One `rotsq` draw: Symbol at an angle, transparent, at a pen, in a cell
/// sixty-four square, read back with `GetBitmapBits`.
fn square(system: &mut System, args: &str) -> String {
    let fields = fields(args);
    let font = turned_font(system, &fields);
    let (pen_x, pen_y) = fields
        .get("pen")
        .unwrap_or(&"32:32")
        .split_once(':')
        .map(|(x, y)| (x.parse().unwrap(), y.parse().unwrap()))
        .unwrap();
    let (hdc, bitmap) = cell(system, 64, 64);
    let index = index_of(system, hdc);

    select_object(system, hdc, font);
    system.gdi.dcs[index].state.back_mode = 1;

    let drawn = text_out(system, hdc, pen_x, pen_y, quoted_text(&fields));
    let hex = drawn
        .map(|_| bits(system, bitmap, 8 * 64))
        .unwrap_or_default();

    delete_dc(system, hdc);
    delete_object(system, bitmap);
    delete_object(system, font);
    hex
}

/// The ink box of a 64 by 64 cell, as `rotsq` writes it: the extent of the
/// clear bits, and how many there are.
fn turned_box(hex: &str) -> String {
    let byte = |at: usize| u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16).unwrap();
    let (mut left, mut top, mut right, mut bottom, mut ink) = (64, 64, -1, -1, 0);

    for row in 0..64_i32 {
        for column in 0..64_i32 {
            if byte(row as usize * 8 + (column as usize >> 3)) & (0x80 >> (column & 7)) != 0 {
                continue;
            }

            ink += 1;
            left = left.min(column);
            right = right.max(column);
            top = top.min(row);
            bottom = bottom.max(row);
        }
    }

    format!("box={left}:{top}:{right}:{bottom},ink={ink}")
}

/// One `rotpen` draw: one, two or three squares on a canvas a hundred and
/// sixty square with the pen in the middle, written as the size, the ascent,
/// the ink box and the box's rows in nibbles.
fn pen_ink(system: &mut System, args: &str) -> String {
    let fields = fields(args);
    let font = turned_font(system, &fields);
    let (hdc, bitmap) = cell(system, 160, 160);
    let index = index_of(system, hdc);

    select_object(system, hdc, font);
    system.gdi.dcs[index].state.back_mode = 1;

    let drawn = text_out(system, hdc, 80, 80, quoted_text(&fields));
    let hex = drawn
        .map(|_| bits(system, bitmap, 20 * 160))
        .unwrap_or_default();
    let metrics = get_text_metrics(system, hdc).unwrap().unwrap().unwrap();

    delete_dc(system, hdc);
    delete_object(system, bitmap);
    delete_object(system, font);

    if hex.is_empty() {
        return String::new();
    }

    let byte = |at: usize| u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16).unwrap();
    let ink = |column: i32, row: i32| {
        byte(row as usize * 20 + (column as usize >> 3)) & (0x80 >> (column & 7)) == 0
    };
    let (mut left, mut top, mut right, mut bottom) = (160, 160, -1, -1);

    for row in 0..160 {
        for column in 0..160 {
            if ink(column, row) {
                left = left.min(column);
                right = right.max(column);
                top = top.min(row);
                bottom = bottom.max(row);
            }
        }
    }

    let mut rows = Vec::new();

    if right >= 0 {
        for row in top..=bottom {
            let mut text = String::new();

            for column in (left..=right).step_by(4) {
                let mut nibble = 0;

                for bit in 0..4 {
                    let lit = column + bit <= right && ink(column + bit, row);

                    nibble = (nibble << 1) | u8::from(lit);
                }

                let _ = write!(text, "{nibble:x}");
            }

            rows.push(text);
        }
    }

    format!(
        "ppem={},ascent={},box={left}:{top}:{right}:{bottom},rows={}",
        metrics.height - metrics.internal_leading,
        metrics.ascent,
        rows.join("/")
    )
}

/// `advance`: one character's width as `GetTextExtent` measures it, and the
/// size it was drawn at, as the `hinting` probe writes it.
fn advance(system: &mut System, args: &str) -> String {
    let asked = Asked::parse(args);
    let font = asked.font(system);
    let hdc = create_compatible_dc(system, 0);

    select_object(system, hdc, font);

    let character = [asked.character.unwrap()];
    let extent = get_text_extent(system, hdc, &character, 1).unwrap();
    let metrics = get_text_metrics(system, hdc).unwrap().unwrap().unwrap();

    delete_dc(system, hdc);
    delete_object(system, font);
    format!(
        "advance={},ppem={}",
        extent & 0xffff,
        metrics.height - metrics.internal_leading
    )
}

/// A recording's agreeing records and its total, over the records `keep`
/// passes.
fn tally(name: &str, keep: impl Fn(&[String; 3]) -> bool) -> Option<(usize, usize)> {
    let mut recording = Fabricated::open(name)?;
    let records = std::mem::take(&mut recording.records);
    let (mut agreed, mut total) = (0, 0);

    for record in records.iter().filter(|record| keep(record)) {
        total += 1;
        agreed += usize::from(agrees(&mut recording.system, record));
    }

    Some((agreed, total))
}

/// Where a dropout stops being rescued (`dropsize`, `dropdown`): the same
/// sub-pixel bar at every cell height from sixteen to seventy, walked up and
/// walked down, bare and ballasted. On a VGA the ballasted bar is rescued to
/// a cell of fifty-four and refused from fifty-five; on an EGA nothing stops,
/// the cap applying only where the pixel is square. The descending sweep's
/// first cell on an EGA, seventy, is the one realized cold, scan-converted
/// without dropout control (`scanleak`, `FONTS.md` 8g); nothing models that,
/// so its five records are the five not reproduced.
#[test]
fn stops_rescuing_a_dropout_where_windows_stops() {
    for (name, floor, total) in [
        ("dropsize-times-hairs", 420, 420),
        ("dropsize-times-bare-hairs", 420, 420),
        ("dropsize-times-beside", 336, 336),
        ("dropdown-times-hairs", 420, 420),
        ("dropsize-times-hairs-ega", 420, 420),
        ("dropsize-times-bare-hairs-ega", 420, 420),
        ("dropdown-times-hairs-ega", 415, 420),
    ] {
        let Some((agreed, all)) = tally(name, |_| true) else {
            continue;
        };

        println!("{name}: {agreed}/{all}");
        assert_eq!(all, total, "{name}");
        assert!(agreed >= floor, "{name}: {agreed} of {all}, not {floor}");
    }
}

/// The glyph buffer (`buffer`): the glyphs Windows refuses for want of
/// room, refused.
#[test]
fn refuses_the_glyphs_windows_refuses() {
    for (name, floor) in [
        ("buffer-times-buffer", 410),
        ("buffer-times-buffer-bare", 410),
        ("buffer-times-buffer-sweep", 409),
    ] {
        let Some((agreed, all)) = tally(name, |_| true) else {
            continue;
        };

        println!("{name}: {agreed}/{all}");
        assert_eq!(all, 410, "{name}");
        assert!(agreed >= floor, "{name}: {agreed} of {all}, not {floor}");
    }
}

/// Glyphs taller than a cell (`bands`), each recording's records of the
/// stock faces and of the fabricated hairlines counted apart. The EGA's
/// `times-hairs` is not exact: a glyph with no program of its own on a pixel
/// that is not square.
#[test]
fn draws_glyphs_taller_than_a_cell_as_windows_does() {
    for (name, stock_floor, hairs_floor) in [
        ("cour-hairs", 144, 144),
        ("times-hairs", 144, 144),
        ("times-bare-hairs", 144, 144),
        ("times-near-hairs", 144, 144),
        ("times-thin-pair", 144, 144),
        ("times-stacked", 144, 144),
        ("times-beside", 144, 144),
        ("cour-hairs-ega", 144, 144),
        ("times-hairs-ega", 144, 118),
    ] {
        let Some(mut recording) = Fabricated::open(&format!("bands-{name}")) else {
            continue;
        };
        let records = std::mem::take(&mut recording.records);
        let prefix = format!("\"{}\"", recording.face);
        let (mut stock, mut hairs) = (0, 0);

        for record in &records {
            let agreed = usize::from(agrees(&mut recording.system, record));

            if record[1].starts_with(&prefix) {
                hairs += agreed;
            } else {
                stock += agreed;
            }
        }

        println!("{name}: stock {stock}/144, hairlines {hairs}/144");
        assert_eq!(records.len(), 288, "{name}");
        assert!(stock >= stock_floor, "{name}: stock {stock}");
        assert!(hairs >= hairs_floor, "{name}: hairlines {hairs}");
    }
}

/// How many pixels two cells disagree about.
fn wrong(expected: &str, actual: &str) -> u32 {
    let byte = |hex: &str, at: usize| {
        hex.get(at * 2..at * 2 + 2)
            .map_or(0xff, |pair| u8::from_str_radix(pair, 16).unwrap())
    };

    (0..expected.len() / 2)
        .map(|at| (byte(expected, at) ^ byte(actual, at)).count_ones())
        .sum()
}

/// Whether an escapement is off the axes.
fn oblique(args: &str) -> bool {
    let escapement: i32 = fields(args)
        .get("esc")
        .map_or(0, |esc| esc.parse().unwrap());

    escapement.rem_euclid(3600) % 900 != 0
}

/// A turned square drawn where Windows draws it (`rotsq`, the `rot-square`
/// fabrication: one plain square, no program): one square at every ten
/// degrees and a tenth of a degree at a time across half a right angle at a
/// cell of thirty-two, the same at sixteen. Every one exact since the
/// transform was read out of `GDI.EXE` rather than fitted (`FONTS.md` 8u).
#[test]
fn draws_a_turned_square_where_windows_does() {
    let Some(mut recording) = Fabricated::open("rotsq-rot-square") else {
        return;
    };
    let records = std::mem::take(&mut recording.records);
    let (mut exact, mut pixels, mut small) = (0, 0, 0);

    for [function, args, result] in &records {
        if function != "square ink" || !oblique(args) || args.contains("\"AB\"") {
            continue;
        }

        let missed = wrong(result, &square(&mut recording.system, args));

        if args.starts_with("h=32") {
            exact += usize::from(missed == 0);
            pixels += missed;
        } else if missed == 0 {
            small += 1;
        }
    }

    println!("rotsq: {exact} exact at 32, {pixels} pixels wrong, {small} exact at 16");
    assert!(exact >= 91, "{exact}");
    assert!(pixels == 0, "{pixels}");
    assert!(small >= 32, "{small}");
}

/// The pen walked along a turned baseline where Windows walks it (`rotpen`):
/// one, two and three squares at every five degrees off the axes, at four
/// sizes.
#[test]
fn walks_the_pen_along_a_turned_baseline_where_windows_does() {
    let Some(mut recording) = Fabricated::open("rotpen-rot-square") else {
        return;
    };
    let records = std::mem::take(&mut recording.records);
    let mut agreed: BTreeMap<String, usize> = BTreeMap::new();

    for record in &records {
        if record[0] != "pen ink" {
            continue;
        }

        let text = fields(&record[1])
            .get("text")
            .unwrap()
            .trim_matches('"')
            .to_string();

        *agreed.entry(text).or_default() += usize::from(agrees(&mut recording.system, record));
    }

    println!("rotpen: {agreed:?}");

    for text in ["A", "AB", "ABA"] {
        assert!(
            agreed.get(text).copied().unwrap_or(0) >= 272,
            "{text}: {agreed:?}"
        );
    }
}

/// A `hinting` recording's readings of Arial Italic's `m`, by the cell
/// height asked: what Windows said, and whether this says the same.
fn readings(name: &str) -> Option<BTreeMap<i32, (String, bool)>> {
    let mut recording = Fabricated::open(&format!("hinting-{name}"))?;
    let records = std::mem::take(&mut recording.records);
    let mut out = BTreeMap::new();

    for record in &records {
        let Some(height) = record[1]
            .strip_prefix("\"Arial\",h=")
            .and_then(|rest| rest.strip_suffix(",italic=1,'m'"))
            .and_then(|height| height.parse().ok())
        else {
            continue;
        };

        out.insert(
            height,
            (record[2].clone(), agrees(&mut recording.system, record)),
        );
    }

    Some(out)
}

/// The width Windows reported, which is the fabrication's answer.
fn advance_of(result: &str) -> i32 {
    result
        .strip_prefix("advance=")
        .and_then(|rest| rest.split(',').next())
        .unwrap()
        .parse()
        .unwrap()
}

/// The pixel size Windows fitted the cell to.
fn ppem_of(result: &str) -> i32 {
    result
        .split(',')
        .find_map(|field| field.strip_prefix("ppem="))
        .unwrap()
        .parse()
        .unwrap()
}

/// Every reading agreeing.
fn assert_agreeing(name: &str, readings: &BTreeMap<i32, (String, bool)>) {
    let differ: Vec<i32> = readings
        .iter()
        .filter(|(_, (_, agreed))| !agreed)
        .map(|(height, _)| *height)
        .collect();

    assert_eq!(differ, Vec::<i32>::new(), "{name}");
}

/// Which size a delta exception names (`delta-base-sweep` against
/// `delta-base-control`): sixteen exceptions, nibble `n` moving the point by
/// `n` steps, so the reading says which fired. **Measured**: the base is 9,
/// what the reference sets it to. Five sizes report; the rest are answered
/// from `hdmx`.
#[test]
fn a_delta_exception_counts_sizes_from_nine() {
    let (Some(sweep), Some(control)) =
        (readings("delta-base-sweep"), readings("delta-base-control"))
    else {
        return;
    };

    // The low nibble runs 0..15 and means -8..-1 then 1..8, and the reading
    // magnifies by eight, which cancels the shift of three.
    let step = |nibble: i32| nibble - if nibble >= 8 { 7 } else { 8 };

    // One height per pixels-per-em, the first asked for.
    let mut by_ppem: Vec<(i32, i32)> = Vec::new();

    for (height, (result, _)) in &control {
        let ppem = ppem_of(result);

        if !by_ppem.iter().any(|(seen, _)| *seen == ppem) {
            by_ppem.push((ppem, *height));
        }
    }

    let mut moved = Vec::new();

    for (ppem, height) in by_ppem {
        let shift = advance_of(&sweep[&height].0) - advance_of(&control[&height].0);

        if shift != 0 {
            moved.push(ppem);
            assert_eq!((ppem, shift), (ppem, step(ppem - 9)));
        }
    }

    assert_eq!(moved, [10, 18, 20, 22, 23]);
    assert_agreeing("delta-base-sweep", &sweep);
    assert_agreeing("delta-base-control", &control);
}

/// Whether a delta list has to arrive sorted (`delta-ascending`,
/// `delta-descending`): the same sixteen exceptions in two orders. Ascending,
/// the exception lands; descending, it does not, a whole pixel short (eight
/// in the reading's units). The list is searched by halving as if sorted,
/// not walked.
#[test]
fn a_delta_list_out_of_order_loses_its_exception() {
    let (Some(up), Some(down)) = (readings("delta-ascending"), readings("delta-descending")) else {
        return;
    };
    let live: Vec<i32> = up
        .iter()
        .filter(|(height, (result, _))| down.get(height).map(|(other, _)| other) != Some(result))
        .map(|(height, _)| *height)
        .collect();

    assert!(!live.is_empty());

    for height in &live {
        assert_eq!(
            advance_of(&up[height].0) - advance_of(&down[height].0),
            8,
            "{height}"
        );
    }

    assert_agreeing("delta-ascending", &up);
    assert_agreeing("delta-descending", &down);
}

/// The version `GETINFO` answers (`getinfo-version` against
/// `getinfo-nothing`): three, the same at every size, magnified by eight; and
/// with no bit asked for, nothing.
#[test]
fn getinfo_answers_version_three_at_every_size() {
    let (Some(asked), Some(none)) = (readings("getinfo-version"), readings("getinfo-nothing"))
    else {
        return;
    };
    let live: Vec<i32> = asked
        .iter()
        .filter(|(height, (result, _))| none.get(height).map(|(other, _)| other) != Some(result))
        .map(|(height, _)| *height)
        .collect();

    assert!(live.len() > 4, "{}", live.len());

    let mut replies: Vec<i32> = live
        .iter()
        .map(|height| advance_of(&asked[height].0))
        .collect();

    replies.sort_unstable();
    replies.dedup();
    assert_eq!(replies, [24]);

    for height in &live {
        assert_eq!(advance_of(&none[height].0), 0, "{height}");
    }

    assert_agreeing("getinfo-version", &asked);
    assert_agreeing("getinfo-nothing", &none);
}

/// The sizes the program runs at: where a fabrication that always answers
/// nought (`getinfo-nothing`) does; a size `hdmx` covers reports the
/// letter's own width.
fn live_sizes() -> Option<Vec<i32>> {
    Some(
        readings("getinfo-nothing")?
            .iter()
            .filter(|(_, (result, _))| advance_of(result) == 0)
            .map(|(height, _)| *height)
            .collect(),
    )
}

/// The point size `MPS` answers (`mps-raw`, `mps-scaled`): nought, in
/// either unit.
#[test]
fn mps_answers_nought_in_either_unit() {
    let (Some(live), Some(raw), Some(scaled)) =
        (live_sizes(), readings("mps-raw"), readings("mps-scaled"))
    else {
        return;
    };

    assert!(live.len() > 10, "{}", live.len());

    for (name, readings) in [("mps-raw", &raw), ("mps-scaled", &scaled)] {
        for height in &live {
            assert_eq!(advance_of(&readings[height].0), 0, "{name} at {height}");
        }

        assert_agreeing(name, readings);
    }
}

/// Where a twilight point is put (`twilight-crossed`, `twilight-square`):
/// along the vector it is measured along. Crossed reads what square reads,
/// the twenty-four pixels written into the control value table; freeing
/// along y while measuring along x would have read nought.
#[test]
fn a_twilight_point_is_put_along_the_vector_it_is_measured_along() {
    let (Some(live), Some(crossed), Some(square)) = (
        live_sizes(),
        readings("twilight-crossed"),
        readings("twilight-square"),
    ) else {
        return;
    };

    assert!(live.len() > 10, "{}", live.len());

    for height in &live {
        assert_eq!(advance_of(&crossed[height].0), 24, "crossed at {height}");
        assert_eq!(advance_of(&square[height].0), 24, "square at {height}");
    }

    assert_agreeing("twilight-crossed", &crossed);
    assert_agreeing("twilight-square", &square);
}
