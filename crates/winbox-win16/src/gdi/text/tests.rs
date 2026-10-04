use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;

use super::enumerate::{Told, chosen};
use super::*;
use crate::fonts::LogFont;
use crate::gdi::dc::{create_compatible_dc, create_dc, restore_dc, save_dc, select_object};
use crate::gdi::mapping::set_map_mode;
use crate::gdi::objects::{create_font_indirect, get_stock_object};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A system on the oracle's installation, which its fonts are booted from;
/// `None` where a checkout has not got it.
fn installed() -> Option<System> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM").is_dir() {
        return None;
    }

    let mut system = System::new();

    system.files.mount('C', HostDrive::new(windows));
    Some(system)
}

/// A fixture's records: function, arguments, result.
fn recorded(name: &str) -> Vec<[String; 3]> {
    let text =
        std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json"))).unwrap();
    let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
    let field =
        |record: &serde_json::Value, key: &str| record[key].as_str().unwrap_or("").to_string();

    fixture["records"]
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
        .collect()
}

const STOCK_NAMES: [(&str, i16); 6] = [
    ("OEM_FIXED_FONT", 10),
    ("ANSI_FIXED_FONT", 11),
    ("ANSI_VAR_FONT", 12),
    ("SYSTEM_FONT", 13),
    ("DEVICE_DEFAULT_FONT", 14),
    ("SYSTEM_FIXED_FONT", 16),
];

/// A memory device context with a stock font selected, by its name.
fn with_stock(system: &mut System, name: &str) -> u16 {
    let (_, index) = STOCK_NAMES
        .iter()
        .find(|(stock, _)| *stock == name)
        .unwrap();
    let hdc = create_compatible_dc(system, 0);
    let font = get_stock_object(system, *index);

    select_object(system, hdc, font);
    hdc
}

fn metrics(system: &mut System, hdc: u16) -> TextMetric {
    get_text_metrics(system, hdc).unwrap().unwrap().unwrap()
}

/// A buffer in the program's memory to be written to: a block of the
/// global heap's, as a far pointer.
fn buffer(system: &mut System, size: u32) -> u32 {
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0x42)
        .unwrap();

    u32::from(winbox_machine::segment_selector(index)) << 16
}

#[test]
fn answers_the_text_probe_through_a_device_context() {
    let Some(mut system) = installed() else {
        return;
    };
    let mut checked = 0;

    for [function, args, result] in recorded("text") {
        let ours = match function.as_str() {
            "metrics heights" => {
                let hdc = with_stock(&mut system, &args);
                let tm = metrics(&mut system, hdc);

                format!(
                    "height={},ascent={},descent={},internal={},external={}",
                    tm.height, tm.ascent, tm.descent, tm.internal_leading, tm.external_leading
                )
            }
            "metrics widths" => {
                let hdc = with_stock(&mut system, &args);
                let tm = metrics(&mut system, hdc);

                format!(
                    "ave={},max={},weight={},overhang={}",
                    tm.ave_char_width, tm.max_char_width, tm.weight, tm.overhang
                )
            }
            "metrics character set" => {
                let hdc = with_stock(&mut system, &args);
                let tm = metrics(&mut system, hdc);

                format!(
                    "first={},last={},default={},break={},pitch={},charset={}",
                    tm.first_char,
                    tm.last_char,
                    tm.default_char,
                    tm.break_char,
                    tm.pitch_and_family,
                    tm.char_set
                )
            }
            "metrics style" => {
                let hdc = with_stock(&mut system, &args);
                let tm = metrics(&mut system, hdc);

                format!(
                    "italic={},underlined={},struckout={}",
                    tm.italic, tm.underlined, tm.struck_out
                )
            }
            "GetTextFace" => {
                let hdc = with_stock(&mut system, &args);
                let far = buffer(&mut system, 64);
                let count = get_text_face(&mut system, hdc, 64, far).unwrap();
                let face = system.read_string(far);

                assert_eq!(usize::from(count), face.len());
                format!("\"{}\"", latin(&face))
            }
            "GetTextExtent" => {
                let (stock, text) = args.split_once(',').unwrap();
                let text = text.trim_matches('"');
                let hdc = with_stock(&mut system, stock);
                let both =
                    get_text_extent(&mut system, hdc, text.as_bytes(), text.len() as i32).unwrap();

                format!("width={},height={}", both & 0xffff, both >> 16)
            }
            "GetCharWidth" => {
                let (stock, range) = args.split_once(',').unwrap();
                let (first, last) = range.split_once('-').unwrap();
                let hdc = with_stock(&mut system, stock);
                let widths = get_char_widths(
                    &mut system,
                    hdc,
                    first.parse().unwrap(),
                    last.parse().unwrap(),
                )
                .unwrap()
                .unwrap();
                let widths: Vec<String> = widths.iter().map(ToString::to_string).collect();

                widths.join(",")
            }
            _ => continue,
        };

        assert_eq!(ours, result, "{function} {args}");
        checked += 1;
    }

    assert_eq!(checked, 45);
}

fn latin(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

#[test]
fn answers_nothing_without_a_device_context() {
    let mut system = System::new();

    assert_eq!(get_text_metrics(&mut system, 0x1234), Ok(None));
    assert_eq!(get_text_face(&mut system, 0x1234, 32, 0x1000_0000), Ok(0));
    assert_eq!(get_char_widths(&mut system, 0x1234, 32, 40), Ok(None));
    assert_eq!(set_text_justification(&mut system, 0x1234, 4, 2), 0);
    assert!(get_text_extent(&mut system, 0x1234, b"a", 1).is_err());
    assert_eq!(
        get_tabbed_text_extent(&mut system, 0x1234, b"a", &[]),
        Ok(0)
    );
}

#[test]
fn a_backward_range_or_an_empty_buffer_answers_nought() {
    let Some(mut system) = installed() else {
        return;
    };
    let hdc = with_stock(&mut system, "SYSTEM_FONT");

    assert_eq!(get_char_widths(&mut system, hdc, 40, 39), Ok(None));
    assert_eq!(get_text_face(&mut system, hdc, 0, 0x1000_0000), Ok(0));

    // Room for the nought comes out of the buffer.
    let far = buffer(&mut system, 16);

    assert_eq!(get_text_face(&mut system, hdc, 4, far), Ok(3));
    assert_eq!(system.read_string(far), b"Sys");
}

#[test]
fn cuts_the_string_as_a_javascript_slice_does() {
    assert_eq!(sliced(b"abcdef", 3), b"abc");
    assert_eq!(sliced(b"abcdef", 9), b"abcdef");
    assert_eq!(sliced(b"abcdef", -2), b"abcd");
    assert_eq!(sliced(b"abcdef", -9), b"");
}

#[test]
fn measures_in_logical_units_under_a_mapping_mode() {
    let Some(mut system) = installed() else {
        return;
    };
    let screen = create_dc(&mut system, b"DISPLAY").unwrap();
    let mut checked = 0;

    for [function, args, result] in recorded("fillext") {
        if function != "extent" {
            continue;
        }

        let text: &[u8] = match args.as_str() {
            "hello" | "lometric" => b"Hello, world",
            "empty" => b"",
            "narrow-wide" => b"iiiWWW",
            _ => unreachable!(),
        };

        set_map_mode(&mut system, screen, if args == "lometric" { 2 } else { 1 });

        let both = get_text_extent(&mut system, screen, text, text.len() as i32).unwrap();
        let pair = format!("{},{}", both & 0xffff, both >> 16);

        assert_eq!(format!("{pair} 1 {pair}"), result, "{args}");
        checked += 1;
    }

    assert_eq!(checked, 4);
}

/// The `justify` probe's font: `CreateFont` of a face at a height.
fn made(system: &mut System, face: &str, height: i16) -> u16 {
    create_font_indirect(
        system,
        LogFont {
            height,
            weight: 400,
            face_name: face.to_string(),
            ..LogFont::default()
        },
    )
}

#[test]
fn spreads_the_justification_over_the_breaks() {
    let Some(mut system) = installed() else {
        return;
    };
    let hdc = create_compatible_dc(&mut system, 0);
    let font = made(&mut system, "MS Sans Serif", 13);
    let mut checked = 0;

    select_object(&mut system, hdc, font);

    for [function, args, result] in recorded("justify") {
        let Some(case) = args.strip_prefix("MS Sans Serif,13,") else {
            continue;
        };

        if function != "extent" {
            continue;
        }

        let (text, extra, count, character): (&[u8], i16, i16, u16) = match case {
            "even" => (b"a b c", 8, 2, 0),
            "uneven" => (b"a b c d", 7, 3, 0),
            "one-break" => (b"ab cd", 5, 1, 0),
            "negative" => (b"a b c", -3, 2, 0),
            "with-extra" => (b"a b c", 5, 2, 1),
            "two-parts" => (b"a b", 7, 3, 0),
            _ => unreachable!(),
        };
        let index = dc_of(&system, hdc).unwrap();

        system.gdi.dcs[index].state.char_extra = character;
        set_text_justification(&mut system, hdc, extra, count);

        // The first part drawn moves the term on over its one break, as a
        // bitmap font's `TextOut` does; that comes with `TextOut`.
        if case == "two-parts" {
            let state = system.gdi.dcs[index].state.justification.as_mut().unwrap();

            state.step(false);
        }

        let both = get_text_extent(&mut system, hdc, text, text.len() as i32).unwrap();

        assert_eq!(
            format!("{}:{}", both & 0xffff, both >> 16),
            result,
            "{case}"
        );
        checked += 1;
    }

    assert_eq!(checked, 6);

    // Kept by `SaveDC`, and off again with a count of nought.
    set_text_justification(&mut system, hdc, 8, 2);
    save_dc(&mut system, hdc);
    set_text_justification(&mut system, hdc, 0, 0);
    assert_eq!(
        get_text_extent(&mut system, hdc, b"a b c", 5).unwrap() & 0xffff,
        24
    );
    restore_dc(&mut system, hdc, -1);
    assert_eq!(
        get_text_extent(&mut system, hdc, b"a b c", 5).unwrap() & 0xffff,
        32
    );
}

#[test]
fn a_bitmap_fonts_extent_does_not_move_the_term_on() {
    let mut state = Justification {
        extra: -1,
        rem: -1,
        count: 2,
        err: 2,
    };

    // The display driver's way with a negative remainder: -3 over 2 is -2
    // and -2; GDI's is -1 and -2.
    assert_eq!((state.step(false), state.step(false)), (-2, -2));

    let mut state = Justification {
        extra: -1,
        rem: -1,
        count: 2,
        err: 2,
    };

    assert_eq!((state.step(true), state.step(true)), (-1, -2));
}

#[test]
fn stops_where_an_outline_may_have_answered() {
    let Some(mut system) = installed() else {
        return;
    };
    let hdc = create_compatible_dc(&mut system, 0);
    let font = made(&mut system, "Arial", 16);

    select_object(&mut system, hdc, font);
    assert!(get_text_metrics(&mut system, hdc).is_err());

    // A face no outline has, at a size a strike of its own answers.
    let font = made(&mut system, "Courier", 13);

    select_object(&mut system, hdc, font);
    assert_eq!(metrics(&mut system, hdc).height, 13);

    // A name not installed falls back to Times New Roman.
    let font = made(&mut system, "Nowhere", 13);

    select_object(&mut system, hdc, font);
    assert!(get_text_metrics(&mut system, hdc).is_err());
}

#[test]
fn lays_tabbed_text_out_to_its_stops() {
    let Some(mut system) = installed() else {
        return;
    };
    let screen = create_dc(&mut system, b"DISPLAY").unwrap();
    let mut checked = 0;

    for [function, args, result] in recorded("tabtext") {
        if function != "tabbed" || args == "origin" {
            continue;
        }

        let (text, stops): (&[u8], Vec<i64>) = match args.as_str() {
            "none" => (b"a\tbb\tccc", vec![]),
            "one" => (b"a\tbb\tccc", vec![40]),
            "list" => (b"a\tb\tc\td\te", vec![10, 50, 90]),
            _ => unreachable!(),
        };
        let (_, extent) = result.split_once(';').unwrap();
        let both = get_tabbed_text_extent(&mut system, screen, text, &stops).unwrap();

        assert_eq!(format!("{both:x}"), extent, "{args}");
        checked += 1;
    }

    assert_eq!(checked, 3);
}

#[test]
fn the_dialog_base_units_are_the_system_fonts() {
    let Some(mut system) = installed() else {
        return;
    };
    let [_, _, units] = recorded("dialogs-vga")
        .into_iter()
        .find(|[function, _, _]| function == "units")
        .unwrap();
    let both = get_dialog_base_units(&mut system).unwrap();

    assert_eq!(format!("x={},y={}", both & 0xffff, both >> 16), units);
}

/// What the `enumfam` probe records of one font told of.
fn described(told: &Told) -> String {
    let mut logfont = enumerate::Fields(vec![0; 146]);
    let mut metric = enumerate::Fields(vec![0; 41]);

    (told.logfont)(&mut logfont);
    (told.metric)(&mut metric);

    let (lf, tm) = (&logfont.0, &metric.0);
    let word = |bytes: &[u8], at: usize| i16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let text = |bytes: &[u8]| latin(&bytes[..bytes.iter().position(|&b| b == 0).unwrap()]);
    let true_type = told.kind & 4 != 0;
    let mut parts: Vec<String> = (0..5).map(|at| word(lf, at * 2).to_string()).collect();

    parts.extend((10..18).map(|at| lf[at].to_string()));
    parts.push(text(&lf[18..]));

    let mut metrics: Vec<String> = (0..8).map(|at| word(tm, at * 2).to_string()).collect();

    metrics.extend((16..25).map(|at| tm[at].to_string()));
    metrics.extend((0..3).map(|at| word(tm, 25 + at * 2).to_string()));

    let extra = if true_type {
        format!(
            "{:x}:{}:{}:{}",
            u32::from_le_bytes([tm[31], tm[32], tm[33], tm[34]]),
            u16::from_le_bytes([tm[35], tm[36]]),
            u16::from_le_bytes([tm[37], tm[38]]),
            u16::from_le_bytes([tm[39], tm[40]])
        )
    } else {
        "0:0:0:0".to_string()
    };

    format!(
        "type={},lf={},full={},style={},tm={},ntm={extra}",
        told.kind,
        parts.join(":"),
        if true_type {
            text(&lf[50..])
        } else {
            String::new()
        },
        if true_type {
            text(&lf[114..])
        } else {
            String::new()
        },
        metrics.join(":"),
    )
}

#[test]
fn enumerates_the_fonts_as_windows_does() {
    let Some(mut system) = installed() else {
        return;
    };
    let screen = create_dc(&mut system, b"DISPLAY").unwrap();
    let every = chosen(&mut system, screen, None);
    let mut checked = 0;

    for [function, args, result] in recorded("enumfam-vga") {
        let ours = match function.as_str() {
            "family" => described(&every[args.parse::<usize>().unwrap()]),
            "style" => {
                let (name, at) = args.rsplit_once(',').unwrap();

                described(&chosen(&mut system, screen, Some(name))[at.parse::<usize>().unwrap()])
            }
            _ => continue,
        };

        assert_eq!(ours, result, "{function} {args}");
        checked += 1;
    }

    assert!(checked > 60, "{checked}");
    assert!(chosen(&mut system, screen, Some("Nowhere")).is_empty());
}
