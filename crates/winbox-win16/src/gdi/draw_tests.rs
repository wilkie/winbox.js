//! GDI's drawing held to what Windows 3.1 recorded, as the TypeScript
//! engine's replay holds it (`test/oracle/replay.ts`): each record drawn
//! through the calls a program makes, on a display, and read back as the
//! probe read it. `lines`, `dither`, `dither3`, `penmatch`, `curves` and
//! `mixmode`, on the four displays each was recorded on.

use std::collections::HashMap;
use std::fmt::Write;
use std::path::Path;

use crate::gdi::bitmaps::{create_bitmap, create_compatible_bitmap, get_bitmap_bits};
use crate::gdi::dc::{create_compatible_dc, create_dc, dc_of, move_to, select_object};
use crate::gdi::draw::{PATCOPY, get_pixel, pat_blt, set_pixel};
use crate::gdi::objects::{create_pen, create_solid_brush, get_stock_object};
use crate::gdi::shapes::{line_to, paint_shape};
use crate::system::System;

const WHITENESS: u32 = 0x00ff_0062;
const DISPLAYS: [&str; 4] = ["vga", "svga", "ega", "hercules"];

/// The sixteen colours as the probes write a pixel: its place here.
const PALETTE: [u32; 16] = [
    0x0000_0000,
    0x0000_0080,
    0x0000_8000,
    0x0000_8080,
    0x0080_0000,
    0x0080_0080,
    0x0080_8000,
    0x00c0_c0c0,
    0x0080_8080,
    0x0000_00ff,
    0x0000_ff00,
    0x0000_ffff,
    0x00ff_0000,
    0x00ff_00ff,
    0x00ff_ff00,
    0x00ff_ffff,
];

/// A fixture's records, as function, arguments and result; none where the
/// fixture is not there.
fn records(name: &str) -> Vec<(String, String, String)> {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../oracle/fixtures/{name}.json"));
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
    let field =
        |record: &serde_json::Value, key: &str| record[key].as_str().unwrap_or("").to_string();

    fixture["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| {
            (
                field(record, "function"),
                field(record, "args"),
                field(record, "result"),
            )
        })
        .collect()
}

/// A system on a display, to draw every record of a test on.
fn on(display: &str) -> System {
    let mut system = System::new();

    system.display = crate::display::mode(display).unwrap();
    MADE.with(|made| *made.borrow_mut() = (Vec::new(), Vec::new()));
    BUFFER.with(|buffer| buffer.set(system.string_block(&" ".repeat(256))));
    system
}

/// A colour written `rrggbb`, as a `COLORREF`.
fn colorref(text: &str) -> u32 {
    let value = u32::from_str_radix(&format!("{text:0>6}"), 16).unwrap();

    (value >> 16) | (value & 0xff00) | (value & 0xff) << 16
}

/// A `COLORREF` written `rrggbb`.
fn rgb(colorref: u32) -> String {
    format!(
        "{:02x}{:02x}{:02x}",
        colorref & 0xff,
        (colorref >> 8) & 0xff,
        (colorref >> 16) & 0xff
    )
}

/// A pixel as its place in the sixteen colours.
fn digit(system: &mut System, hdc: u16, x: i32, y: i32) -> char {
    let colour = get_pixel(system, hdc, x, y).unwrap() & 0xff_ffff;

    PALETTE
        .iter()
        .position(|&each| each == colour)
        .map_or('?', |at| char::from_digit(at as u32, 16).unwrap())
}

thread_local! {
    /// A buffer of the program's the bits are read into, made with the
    /// system each test draws on.
    static BUFFER: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };

    /// What each record made, given back before the next is drawn, so that
    /// one system draws them all without running out of handles: device
    /// contexts first, then the objects.
    static MADE: std::cell::RefCell<(Vec<u16>, Vec<u16>)> = const {
        std::cell::RefCell::new((Vec::new(), Vec::new()))
    };
}

/// An object made for a record, to be given back after it.
fn made(handle: u16) -> u16 {
    MADE.with(|made| made.borrow_mut().1.push(handle));
    handle
}

/// Everything a record made given back.
fn clear(system: &mut System) {
    let (dcs, objects) = MADE.with(|made| std::mem::take(&mut *made.borrow_mut()));

    for hdc in dcs {
        crate::gdi::dc::delete_dc(system, hdc);
    }

    for handle in objects {
        crate::gdi::objects::delete_object(system, handle);
    }
}

/// A memory device context with a bitmap compatible with the screen, or a
/// monochrome one, selected.
fn memory_cell(system: &mut System, width: i16, height: i16, mono: bool) -> u16 {
    clear(system);

    let screen = create_dc(system, b"DISPLAY").unwrap();
    let hdc = create_compatible_dc(system, screen);
    let bitmap = made(if mono {
        create_bitmap(system, width, height, 1, 1, 0)
    } else {
        create_compatible_bitmap(system, screen, width, height)
    });

    MADE.with(|made| made.borrow_mut().0.extend([hdc, screen]));
    select_object(system, hdc, bitmap);
    hdc
}

/// The bitmap a device context draws on, read as `GetBitmapBits` gives it.
fn read_cell(system: &mut System, hdc: u16, size: usize) -> String {
    let dc = dc_of(system, hdc).unwrap();
    let crate::gdi::DcBitmap::Bitmap(object) = system.gdi.dcs[dc].bitmap else {
        panic!("a memory device context");
    };
    let handle = system
        .handles
        .lookup(crate::handles::Object::Gdi(object))
        .unwrap();
    let far = BUFFER.with(std::cell::Cell::get);

    assert!(size <= 256);

    get_bitmap_bits(system, handle, size as i32, far);
    system
        .read_far(far, size)
        .iter()
        .fold(String::new(), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// The lines of a path drawn as the probe drew them, a `MoveTo` and a
/// `LineTo` to each point, on a cell thirty-two square over white.
fn draw_path(system: &mut System, points: &[(i16, i16)]) -> String {
    let hdc = memory_cell(system, 32, 32, true);

    pat_blt(system, hdc, [0, 0, 32, 32], WHITENESS);
    move_to(system, hdc, points[0].0, points[0].1);

    for &(x, y) in &points[1..] {
        line_to(system, hdc, i32::from(x), i32::from(y));
    }

    read_cell(system, hdc, 128)
}

fn numbers(args: &str) -> Vec<i16> {
    args.split(',')
        .map(|field| field.parse().unwrap())
        .collect()
}

#[test]
fn lines_are_walked_as_each_driver_walks_them() {
    for display in DISPLAYS {
        let mut checked = 0;
        let mut system = on(display);

        for (function, args, result) in records(&format!("lines-{display}")) {
            let n = numbers(&args);
            let path: Vec<(i16, i16)> = match function.as_str() {
                "line" => vec![(16, 16), (16 + n[0], 16 + n[1])],
                "from" => vec![(n[0], n[1]), (n[0] + n[2], n[1] + n[3])],
                "down" => vec![(n[0], n[1]), (n[0] + n[3], n[1] + n[2])],
                "segment" => vec![(n[0], n[1]), (n[2], n[3])],
                "chain" | "poly" => n.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect(),
                _ => continue,
            };

            assert_eq!(
                draw_path(&mut system, &path),
                result,
                "{display} {function} {args}"
            );
            checked += 1;
        }

        assert!(checked == 0 || checked == 2478, "{display}: {checked}");
    }
}

/// `dither`'s fill: a solid brush, its `COLORREF` as the probe wrote it, over
/// a square of sixteen at `left:top` of a bitmap compatible with the
/// display, whose origin stands for the screen's, each pixel read back as
/// its place in the palette.
fn dither_square(system: &mut System, colour: &str, at: &str) -> String {
    let (left, top) = at.trim_start_matches("at=").split_once(':').unwrap();
    let (left, top): (i32, i32) = (left.parse().unwrap(), top.parse().unwrap());
    let hdc = memory_cell(system, 80, 64, false);
    let brush = made(create_solid_brush(
        system,
        u32::from_str_radix(colour, 16).unwrap(),
    ));

    select_object(system, hdc, brush);
    pat_blt(system, hdc, [left, top, 16, 16], PATCOPY);

    (0..16)
        .map(|y| {
            (0..16)
                .map(|x| digit(system, hdc, left + x, top + y))
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// `dither`'s brush into a monochrome bitmap of sixteen.
fn dither_mono(system: &mut System, colour: &str) -> String {
    let hdc = memory_cell(system, 16, 16, true);
    let brush = made(create_solid_brush(
        system,
        u32::from_str_radix(colour, 16).unwrap(),
    ));

    select_object(system, hdc, brush);
    pat_blt(system, hdc, [0, 0, 16, 16], PATCOPY);
    read_cell(system, hdc, 32)
}

#[test]
fn a_brush_is_dithered_as_each_driver_dithers_it() {
    for display in DISPLAYS {
        let mut system = on(display);

        for name in ["dither", "dither3"] {
            for (function, args, result) in records(&format!("{name}-{display}")) {
                let fields: Vec<&str> = args.split(',').collect();
                let answer = match function.as_str() {
                    "screen" | "offset" | "ramp" | "grid" => {
                        dither_square(&mut system, fields[0], fields[1])
                    }
                    "mono" | "monoramp" => dither_mono(&mut system, fields[0]),
                    _ => continue,
                };

                assert_eq!(answer, result, "{name}-{display} {function} {args}");
            }
        }
    }
}

/// `penmatch`: one colour drawn one way into a bitmap compatible with the
/// display, or a monochrome one, over white, and read back.
fn penmatch(system: &mut System, kind: &str, colour: &str, mono: bool) -> Option<String> {
    if !matches!(kind, "setpixel" | "pen" | "wide") {
        return None;
    }

    let hdc = memory_cell(system, 64, 80, mono);
    let colorref = colorref(colour);

    pat_blt(system, hdc, [0, 0, 64, 80], WHITENESS);

    Some(match kind {
        "setpixel" => {
            let set = set_pixel(system, hdc, 4, 4, colorref);

            format!(
                "{} {}",
                rgb(set),
                rgb(get_pixel(system, hdc, 4, 4).unwrap())
            )
        }
        "pen" => {
            let pen = made(create_pen(system, 0, 1, colorref));

            select_object(system, hdc, pen);
            move_to(system, hdc, 0, 10);
            line_to(system, hdc, 16, 10);
            rgb(get_pixel(system, hdc, 4, 10).unwrap())
        }
        "wide" => {
            let pen = made(create_pen(system, 0, 6, colorref));

            select_object(system, hdc, pen);
            move_to(system, hdc, 0, 64);
            line_to(system, hdc, 40, 64);
            (63..=64)
                .map(|y| {
                    (8..24)
                        .map(|x| digit(system, hdc, x, y))
                        .collect::<String>()
                })
                .collect::<Vec<_>>()
                .join("/")
        }
        _ => return None,
    })
}

#[test]
fn a_pen_and_a_pixel_are_the_colour_the_driver_draws() {
    for display in DISPLAYS {
        let mut system = on(display);

        for (function, args, result) in records(&format!("penmatch-{display}")) {
            let fields: Vec<&str> = args.split(',').collect();
            let mono = fields
                .get(1)
                .is_some_and(|mono| !mono.is_empty() && *mono != "0");
            let Some(answer) = penmatch(&mut system, &function, fields[0], mono) else {
                continue;
            };

            assert_eq!(answer, result, "penmatch-{display} {function} {args}");
        }
    }
}

/// Something drawn on a bitmap compatible with the screen, read back a row
/// at a time as palette digits.
fn screen_capture(
    system: &mut System,
    width: i16,
    height: i16,
    draw: impl FnOnce(&mut System, u16),
) -> Vec<String> {
    let hdc = memory_cell(system, width, height, false);

    draw(system, hdc);
    (0..i32::from(height))
        .map(|y| {
            (0..i32::from(width))
                .map(|x| digit(system, hdc, x, y))
                .collect()
        })
        .collect()
}

/// `curves`'s shapes, as `oracle/probes/curves.c` lists them: the kind (0
/// `Ellipse`, 1 `RoundRect`), the rectangle, the corner, the pen's width
/// (0 for none) and whether the light grey brush is selected.
const CURVES: [[i32; 9]; 25] = [
    [0, 4, 4, 5, 5, 0, 0, 1, 1],
    [0, 10, 4, 12, 6, 0, 0, 1, 1],
    [0, 16, 4, 19, 7, 0, 0, 1, 1],
    [0, 24, 4, 28, 8, 0, 0, 1, 1],
    [0, 32, 4, 37, 9, 0, 0, 1, 1],
    [0, 42, 4, 48, 10, 0, 0, 1, 1],
    [0, 52, 4, 59, 11, 0, 0, 1, 1],
    [0, 64, 4, 72, 12, 0, 0, 1, 1],
    [0, 4, 16, 44, 40, 0, 0, 1, 1],
    [0, 50, 16, 77, 49, 0, 0, 1, 1],
    [0, 84, 16, 114, 36, 0, 0, 0, 1],
    [0, 120, 16, 150, 40, 0, 0, 3, 1],
    [0, 156, 16, 186, 40, 0, 0, 1, 0],
    [0, 192, 16, 228, 18, 0, 0, 1, 1],
    [1, 4, 56, 40, 76, 8, 8, 1, 1],
    [1, 46, 56, 86, 80, 12, 6, 1, 1],
    [1, 92, 56, 122, 86, 30, 30, 1, 1],
    [1, 128, 56, 168, 74, 4, 4, 1, 1],
    [1, 174, 56, 214, 86, 0, 0, 1, 1],
    [1, 4, 92, 44, 122, 7, 9, 1, 1],
    [1, 50, 92, 80, 112, 10, 10, 0, 1],
    [1, 86, 92, 106, 102, 40, 40, 1, 1],
    [1, 112, 92, 152, 122, 16, 16, 3, 1],
    [1, 158, 92, 198, 122, 16, 16, 1, 0],
    [1, 204, 92, 236, 110, 5, 5, 1, 1],
];

const NULL_BRUSH: i16 = 5;
const LTGRAY_BRUSH: i16 = 1;
const NULL_PEN: i16 = 8;
const BLACK_PEN: i16 = 7;
const WHITE_BRUSH: i16 = 0;
const BLACK_BRUSH: i16 = 4;

/// The screen rows a capture's records ask for, held to them.
fn check_rows(name: &str, display: &str, rows: &[String]) -> usize {
    let mut checked = 0;

    for (function, args, result) in records(&format!("{name}-{display}")) {
        if function != "screen" {
            continue;
        }

        let row: usize = args.rsplit("y=").next().unwrap().parse().unwrap();

        assert_eq!(rows[row], result, "{name}-{display} {args}");
        checked += 1;
    }

    checked
}

#[test]
fn ellipses_and_rounded_rectangles_are_gdis_own() {
    for display in DISPLAYS {
        if records(&format!("curves-{display}")).is_empty() {
            continue;
        }

        let mut system = on(display);
        let rows = screen_capture(&mut system, 240, 136, |system, hdc| {
            let pens: HashMap<i32, u16> = [
                (0, get_stock_object(system, NULL_PEN)),
                (1, create_pen(system, 0, 1, 0)),
                (3, create_pen(system, 0, 3, 0)),
            ]
            .into_iter()
            .collect();

            pat_blt(system, hdc, [0, 0, 240, 136], WHITENESS);

            for [kind, left, top, right, bottom, width, height, pen, brush] in CURVES {
                let brush =
                    get_stock_object(system, if brush != 0 { LTGRAY_BRUSH } else { NULL_BRUSH });

                select_object(system, hdc, pens[&pen]);
                select_object(system, hdc, brush);
                paint_shape(
                    system,
                    hdc,
                    [left, top, right, bottom],
                    (kind != 0).then_some((width, height)),
                );
            }
        });

        assert_eq!(check_rows("curves", display, &rows), 136, "{display}");
    }
}

#[test]
fn shapes_mix_with_the_screen_in_each_drawing_mode() {
    for display in DISPLAYS {
        if records(&format!("mixmode-{display}")).is_empty() {
            continue;
        }

        let mut system = on(display);
        let rows = screen_capture(&mut system, 256, 112, |system, hdc| {
            let dc = dc_of(system, hdc).unwrap();
            let stripes = [0x00ff_ffff, 0x0000_0000, 0x00ff_0000, 0x0000_ffff];
            let thin = create_pen(system, 0, 1, 0x0000_00ff);
            let thick = create_pen(system, 0, 3, 0x0000_00ff);
            let green = create_solid_brush(system, 0x0000_ff00);

            for x in 0..256 {
                let brush = create_solid_brush(system, stripes[(x & 3) as usize]);

                select_object(system, hdc, brush);
                pat_blt(system, hdc, [x, 0, 1, 112], PATCOPY);
            }

            for mode in 1..=16 {
                let left = ((mode - 1) & 7) * 32 + 2;
                let top = ((mode - 1) >> 3) * 44 + 2;

                select_object(system, hdc, thin);
                select_object(system, hdc, green);
                system.gdi.dcs[dc].state.rop2 = Some(mode as u16);
                paint_shape(system, hdc, [left, top, left + 28, top + 18], Some((8, 8)));
                select_object(system, hdc, thick);
                paint_shape(system, hdc, [left + 1, top + 22, left + 27, top + 40], None);
                system.gdi.dcs[dc].state.rop2 = Some(13);
            }

            let black = get_stock_object(system, BLACK_PEN);

            select_object(system, hdc, black);

            for cell in 0..2 {
                let left = cell * 40 + 2;
                let white = get_stock_object(system, WHITE_BRUSH);
                let dark = get_stock_object(system, BLACK_BRUSH);

                select_object(system, hdc, white);
                paint_shape(system, hdc, [left, 92, left + 36, 110], Some((10, 10)));
                select_object(system, hdc, dark);
                system.gdi.dcs[dc].state.rop2 = Some(6);

                for _ in 0..=cell {
                    paint_shape(system, hdc, [left, 92, left + 36, 110], Some((10, 10)));
                }

                system.gdi.dcs[dc].state.rop2 = Some(13);
            }
        });

        assert_eq!(check_rows("mixmode", display, &rows), 112, "{display}");
    }
}
