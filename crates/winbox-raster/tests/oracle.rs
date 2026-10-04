//! The raster layer's colour matching, DIBs and raster operations held to
//! what Windows 3.1 itself recorded: the `dither`, `palsys`, `dibmap` and
//! `bitblt` probes' fixtures.

use std::path::Path;

use serde_json::Value;
use winbox_raster::raster_op::{combine, table_of};
use winbox_raster::{
    DevicePalette, DisplayKind, decode_dib, dib_to_device, matched_index, palette_for_display,
};

/// A fixture's records, as function, arguments and result.
fn records(name: &str) -> Vec<(String, String, String)> {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../oracle/fixtures/{name}.json"));
    let fixture: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("the fixture")).unwrap();

    fixture["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| {
            let text = |key: &str| record[key].as_str().unwrap_or("").to_string();

            (text("function"), text("args"), text("result"))
        })
        .collect()
}

fn hex(text: &str) -> u32 {
    u32::from_str_radix(text, 16).unwrap()
}

/// A `COLORREF` as it was printed whole, `bbggrr`, as red, green and blue.
fn colorref(text: &str) -> [u8; 3] {
    let value = hex(text);

    [value as u8, (value >> 8) as u8, (value >> 16) as u8]
}

/// A colour printed `rrggbb`.
fn rrggbb(text: &str) -> [u8; 3] {
    let value = hex(text);

    [(value >> 16) as u8, (value >> 8) as u8, value as u8]
}

fn display(name: &str) -> DisplayKind {
    match name {
        "ega" => DisplayKind {
            colors: 16,
            ega: true,
        },
        "hercules" => DisplayKind {
            colors: 2,
            ega: false,
        },
        "vga256" => DisplayKind {
            colors: 256,
            ega: false,
        },
        _ => DisplayKind::default(),
    }
}

/// What `GetNearestColor` answers on the screen of a display.
fn nearest(display: DisplayKind, [red, green, blue]: [u8; 3]) -> [u8; 3] {
    let palette = palette_for_display(display, None);
    let mut palette = palette.borrow_mut();
    let index = matched_index(display, &mut palette, red, green, blue);

    palette.colours[index]
}

#[test]
fn get_nearest_color_on_each_display() {
    for name in ["vga", "svga", "ega", "hercules"] {
        let mut count = 0;

        for (function, args, result) in records(&format!("dither-{name}")) {
            if function != "nearest" {
                continue;
            }

            let answer = nearest(display(name), colorref(&args));

            assert_eq!(answer, colorref(&result), "{name}: {args}");
            count += 1;
        }

        assert_eq!(count, 194, "{name}");
    }
}

#[test]
fn the_256_colour_driver_matches_only_its_static_colours() {
    let vga256 = display("vga256");

    for (function, args, result) in records("palsys") {
        if function == "nearest" {
            assert_eq!(nearest(vga256, rrggbb(&args)), rrggbb(&result), "{args}");
        }
    }
}

#[test]
fn create_dibitmap_matches_a_colour_table_as_get_nearest_color() {
    // The probe's DIB: 16 by 16 at 8 bits, each pixel its own entry of the
    // colour table, bottom row first.
    let colours: Vec<([u8; 3], [u8; 3])> = records("dibmap")
        .into_iter()
        .filter(|(function, _, _)| function == "colour")
        .map(|(_, args, result)| (rrggbb(&args), rrggbb(result.split(' ').next().unwrap())))
        .collect();
    let mut bytes = Vec::new();

    assert_eq!(colours.len(), 256);
    bytes.extend_from_slice(&40u32.to_le_bytes());
    bytes.extend_from_slice(&16i32.to_le_bytes());
    bytes.extend_from_slice(&16i32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&8u16.to_le_bytes());
    bytes.extend_from_slice(&[0; 24]);

    for ([red, green, blue], _) in &colours {
        bytes.extend_from_slice(&[*blue, *green, *red, 0]);
    }

    bytes.extend((0..=255u8).collect::<Vec<_>>());

    let vga = DisplayKind::default();
    let dib = decode_dib(&bytes).unwrap();
    let bitmap = dib_to_device(&dib, 4, None, Some(vga), None);

    for (at, (want, became)) in colours.iter().enumerate() {
        let (x, y) = (at as i32 % 16, 15 - at as i32 / 16);
        let index = bitmap.index_at(x, y).unwrap();

        assert_eq!(
            bitmap.device_palette.borrow().colours[usize::from(index)],
            *became,
            "{want:?}"
        );
    }
}

#[test]
fn every_named_operation_between_monochrome_bitmaps() {
    let mut count = 0;

    for (function, args, result) in records("bitblt") {
        if function != "mono" {
            continue;
        }

        let rop = hex(args
            .split("rop=")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap());
        let brush = if args.ends_with("brush=white") {
            0xf
        } else {
            0
        };
        let nibble = combine(table_of(rop), brush, 0b0011, 0b0101, 0xf);

        assert_eq!(format!("{nibble:x}").repeat(8), result, "{args}");
        count += 1;
    }

    assert_eq!(count, 30);
}

#[test]
fn colour_operations_are_index_arithmetic() {
    let mut palette = DevicePalette::sixteen();
    let records = records("bitblt");
    let sources: Vec<[u8; 3]> = records
        .iter()
        .find(|(function, _, _)| function == "palette source")
        .unwrap()
        .2
        .split('/')
        .map(colorref)
        .collect();
    let mut count = 0;

    for (function, args, result) in &records {
        let table = match function.as_str() {
            // SRCINVERT, SRCAND.
            "xor" => 0x66,
            "and" => 0x88,
            _ => continue,
        };
        let [r, g, b] = colorref(args.trim_start_matches("ground="));
        let ground = palette.index(r, g, b) as u32;

        for (source, want) in sources.iter().zip(result.split('/')) {
            let s = palette.index(source[0], source[1], source[2]) as u32;
            let index = combine(table, 0, s, ground, 0xf) as usize;

            assert_eq!(palette.colours[index], colorref(want), "{function} {args}");
        }

        count += 1;
    }

    assert_eq!(count, 32);
}
