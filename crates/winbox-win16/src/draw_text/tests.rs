//! USER's text drawing held to what Windows drew: `drawtext`, as the
//! TypeScript engine's replay draws it into a bitmap compatible with the
//! screen, and `tabtext`, drawn on the screen itself.

use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;

use super::*;
use crate::gdi::bitmaps::create_compatible_bitmap;
use crate::gdi::dc::{create_dc, set_bk_color};
use crate::gdi::objects::get_stock_object;
use crate::gdi::text::get_tabbed_text_extent;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn installed() -> Option<System> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM").is_dir() {
        return None;
    }

    let mut system = System::new();

    system.files.mount('C', HostDrive::new(windows));
    Some(system)
}

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

fn buffer(system: &mut System, size: u32) -> u32 {
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0x42)
        .unwrap();

    u32::from(winbox_machine::segment_selector(index)) << 16
}

/// The sixteen colours the probes name a pixel by, as `COLORREF`s.
const PALETTE: [u32; 16] = [
    0x00_0000, 0x00_0080, 0x00_8000, 0x00_8080, 0x80_0000, 0x80_0080, 0x80_8000, 0xc0_c0c0,
    0x80_8080, 0x00_00ff, 0x00_ff00, 0x00_ffff, 0xff_0000, 0xff_00ff, 0xff_ff00, 0xff_ffff,
];

/// A row of pixels, a palette digit each, as `GetPixel` reads them.
fn row(bitmap: &winbox_raster::DeviceBitmap, y: i32, width: i32) -> String {
    let palette = bitmap.device_palette.borrow();

    (0..width)
        .map(|x| {
            let [red, green, blue] = palette.colours[usize::from(bitmap.index_at(x, y).unwrap())];
            let colorref = u32::from(red) | u32::from(green) << 8 | u32::from(blue) << 16;

            PALETTE
                .iter()
                .position(|&colour| colour == colorref)
                .map_or('?', |index| char::from_digit(index as u32, 16).unwrap())
        })
        .collect()
}

fn whiten(bitmap: &mut winbox_raster::DeviceBitmap, width: f64, height: f64) {
    fill_rect(&mut bitmap.context, 0.0, 0.0, width, height, [0xff; 4]);
}

/// A case: its name, the text, the count, the rectangle and the format.
type Case = (&'static str, &'static [u8], i16, [i16; 4], u16);

const CASES: &[Case] = &[
    ("left", b"Hello", -1, [4, 4, 164, 54], 0),
    ("center", b"Hello", -1, [4, 4, 164, 54], DT_CENTER),
    ("right", b"Hello", -1, [4, 4, 164, 54], DT_RIGHT),
    (
        "vcenter",
        b"Hello",
        -1,
        [4, 4, 164, 54],
        DT_SINGLELINE | DT_VCENTER | DT_CENTER,
    ),
    (
        "bottom",
        b"Hello",
        -1,
        [4, 4, 164, 54],
        DT_SINGLELINE | DT_BOTTOM,
    ),
    ("vcenter-multi", b"Hello", -1, [4, 4, 164, 54], DT_VCENTER),
    ("count", b"Hello", 3, [4, 4, 164, 54], 0),
    ("crlf", b"Two\r\nlines", -1, [4, 4, 164, 54], 0),
    ("lf", b"Two\nlines", -1, [4, 4, 164, 54], 0),
    ("cr", b"Two\rlines", -1, [4, 4, 164, 54], 0),
    ("lfcr", b"Two\n\rlines", -1, [4, 4, 164, 54], 0),
    (
        "single-crlf",
        b"Two\r\nlines",
        -1,
        [4, 4, 164, 54],
        DT_SINGLELINE,
    ),
    (
        "center-crlf",
        b"A\r\nlonger line",
        -1,
        [4, 4, 164, 54],
        DT_CENTER,
    ),
    (
        "wordbreak",
        b"The quick brown fox jumps",
        -1,
        [4, 4, 84, 54],
        DT_WORDBREAK,
    ),
    (
        "longword",
        b"Unbreakableword x",
        -1,
        [4, 4, 44, 54],
        DT_WORDBREAK,
    ),
    (
        "spaces",
        b"Hi   there   now",
        -1,
        [4, 4, 44, 54],
        DT_WORDBREAK,
    ),
    (
        "wordbreak-center",
        b"The quick brown fox",
        -1,
        [4, 4, 84, 54],
        DT_WORDBREAK | DT_CENTER,
    ),
    ("prefix", b"&File &&x", -1, [4, 4, 164, 54], 0),
    ("noprefix", b"&File", -1, [4, 4, 164, 54], DT_NOPREFIX),
    ("prefix-end", b"End&", -1, [4, 4, 164, 54], 0),
    ("prefix-center", b"E&xit", -1, [4, 4, 164, 54], DT_CENTER),
    ("tabs", b"a\tb\tc", -1, [4, 4, 164, 54], DT_EXPANDTABS),
    (
        "tabstop",
        b"a\tb\tc",
        -1,
        [4, 4, 164, 54],
        DT_EXPANDTABS | DT_TABSTOP | (4 << 8),
    ),
    ("tabs-off", b"a\tb", -1, [4, 4, 164, 54], 0),
    (
        "calc-wrap",
        b"The quick brown fox",
        -1,
        [4, 4, 84, 54],
        DT_CALCRECT | DT_WORDBREAK,
    ),
    (
        "calc-single",
        b"Hello",
        -1,
        [4, 4, 164, 54],
        DT_CALCRECT | DT_SINGLELINE,
    ),
    (
        "calc-lines",
        b"Two\r\nlonger lines",
        -1,
        [4, 4, 164, 54],
        DT_CALCRECT,
    ),
    ("calc-empty", b"", -1, [4, 4, 164, 54], DT_CALCRECT),
    (
        "calc-leading",
        b"Two\r\nlines",
        -1,
        [4, 4, 164, 54],
        DT_CALCRECT | DT_EXTERNALLEADING,
    ),
    ("clip", b"A very long line of text", -1, [4, 4, 44, 14], 0),
    (
        "noclip",
        b"A very long line of text",
        -1,
        [4, 4, 44, 14],
        DT_NOCLIP,
    ),
    ("clip-lines", b"One\r\nTwo\r\nThree", -1, [4, 4, 164, 20], 0),
];

#[test]
fn lays_text_out_as_windows_does() {
    let Some(mut system) = installed() else {
        return;
    };
    let (width, height) = (172, 60);
    let screen = create_dc(&mut system, b"DISPLAY").unwrap();
    let memory = create_compatible_dc(&mut system, screen);
    let bitmap = create_compatible_bitmap(&mut system, screen, width, height);
    let far = buffer(&mut system, 8);
    let mut drawn = std::collections::HashMap::new();

    select_object(&mut system, memory, bitmap);
    set_text_color(&mut system, memory, 0);
    set_bk_color(&mut system, memory, 0x00ff_ffff);

    for &(name, text, count, sides, format) in CASES {
        let mut pixels = system.bitmap_of(bitmap).unwrap().pixels.clone();

        whiten(&mut pixels, f64::from(width), f64::from(height));

        let bytes: Vec<u8> = sides.iter().flat_map(|side| side.to_le_bytes()).collect();

        system.write_far(far, &bytes);

        let answer = draw_text(&mut system, memory, text, count, far, format).unwrap();
        let rect = system.read_far(far, 8);
        let side = |at: usize| i16::from_le_bytes([rect[at], rect[at + 1]]);

        drawn.insert(
            format!("answer:{name}"),
            format!(
                "{answer},rect={}:{}:{}:{}",
                side(0),
                side(2),
                side(4),
                side(6)
            ),
        );

        for y in 0..i32::from(height) {
            drawn.insert(
                format!("rows:{name},y={y}"),
                row(&pixels, y, i32::from(width)),
            );
        }
    }

    let mut checked = 0;

    for [function, args, result] in recorded("drawtext-vga") {
        assert_eq!(
            drawn[&format!("{function}:{args}")],
            result,
            "{function}:{args}"
        );
        checked += 1;
    }

    assert_eq!(checked, 1952);
}

#[test]
fn expands_tabs_and_greys_text_as_windows_does() {
    let Some(mut system) = installed() else {
        return;
    };
    let screen = create_dc(&mut system, b"DISPLAY").unwrap();
    let text_far = buffer(&mut system, 64);
    let mut drawn = std::collections::HashMap::new();

    set_text_color(&mut system, screen, 0);
    set_bk_color(&mut system, screen, 0x00ff_ffff);

    let rows =
        |system: &mut System, drawn: &mut std::collections::HashMap<String, String>, name: &str| {
            let pixels = system.screen_bitmap();

            for y in 0..16 {
                drawn.insert(format!("rows:{name},y={y}"), row(&pixels, y, 160));
            }
        };
    let clear = |system: &mut System| {
        let mut pixels = system.screen_bitmap();

        whiten(&mut pixels, 160.0, 16.0);
    };

    for (name, x, text, stops, origin) in [
        ("none", 0, &b"a\tbb\tccc"[..], &[][..], 0),
        ("one", 0, b"a\tbb\tccc", &[40][..], 0),
        ("list", 0, b"a\tb\tc\td\te", &[10, 50, 90][..], 0),
        ("origin", 30, b"a\tbb\tccc", &[40][..], 20),
    ] {
        clear(&mut system);

        let answer = tabbed_text_out(&mut system, screen, (x, 0), text, stops, origin).unwrap();
        let extent = get_tabbed_text_extent(&mut system, screen, text, stops).unwrap();

        drawn.insert(format!("tabbed:{name}"), format!("{answer:x};{extent:x}"));
        rows(&mut system, &mut drawn, name);
    }

    // `GrayString` without an output procedure, by its parts: the text
    // drawn on a scratch bitmap and its every other pixel painted.
    for (name, brush, count, width, height) in [
        ("gray", 2, 0, 0, 0),
        ("black", 4, 0, 0, 0),
        ("sized", 2, 3, 20, 8),
    ] {
        clear(&mut system);
        system.write_far(text_far, b"Grey\0");

        let brush = get_stock_object(&mut system, brush);
        let index = dc_of(&system, screen).unwrap();
        let text = if count <= 0 {
            system.read_string(text_far)
        } else {
            system.read_far(text_far, count as usize)
        };
        let extent = get_text_extent(&mut system, screen, &text, text.len() as i32).unwrap();
        let width = if width == 0 {
            i64::from(extent & 0xffff)
        } else {
            width
        };
        let height = if height == 0 {
            i64::from(extent >> 16)
        } else {
            height
        };
        let scratch = scratch(&mut system, screen, index, width, height);

        text_out(&mut system, scratch.memory, 0, 0, &text).unwrap();
        finish_gray(&mut system, index, &scratch, brush, (4, 2), (width, height));
        drawn.insert(format!("gray:{name}"), "1".to_string());
        rows(&mut system, &mut drawn, name);
    }

    let mut checked = 0;

    for [function, args, result] in recorded("tabtext") {
        let key = format!("{function}:{}", args.split(',').next().unwrap());
        let key = if function == "rows" {
            format!("{function}:{args}")
        } else {
            key
        };

        if let Some(ours) = drawn.get(&key) {
            assert_eq!(ours, &result, "{key}");
            checked += 1;
        }
    }

    // All but the output procedure's case: its rows, its answer and what
    // it was given.
    assert_eq!(checked, 137 - 16 - 2);
}

#[test]
fn strips_the_prefix() {
    assert_eq!(
        strip_prefix(b"&File &&x"),
        (b"File &x".to_vec(), Some(0), 2)
    );
    assert_eq!(strip_prefix(b"End&"), (b"End".to_vec(), Some(3), 1));
    assert_eq!(strip_prefix(b"a&b&c"), (b"abc".to_vec(), Some(2), 2));
    assert_eq!(strip_prefix(b"plain"), (b"plain".to_vec(), None, 0));
}
