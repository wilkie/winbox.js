//! Text drawn, held to what Windows drew: the oracle's fixtures of text
//! drawn into a monochrome bitmap and read back with `GetBitmapBits`, as
//! the TypeScript engine's replay draws them (`test/oracle/replay.ts`).
//! A face only an outline answers is not drawn here, and its records are
//! counted apart.

use std::fmt::Write;
use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;

use super::*;
use crate::fonts::LogFont;
use crate::gdi::bitmaps::{create_bitmap, get_bitmap_bits};
use crate::gdi::dc::{create_compatible_dc, delete_dc, select_object, set_bk_color};
use crate::gdi::objects::{create_font_indirect, delete_object, get_stock_object};
use crate::gdi::text::set_text_justification;
use crate::handles::Object;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A system on one of the oracle's installations, its fonts booted from
/// there, on the display it was installed for; `None` where a checkout has
/// not got it.
fn installed(display: &str) -> Option<System> {
    let drive = if display == "vga" {
        "drive-c".to_string()
    } else {
        format!("drive-c-{display}")
    };
    let windows = root().join("oracle/build").join(drive);

    if !windows.join("WINDOWS/SYSTEM").is_dir() {
        return None;
    }

    let mut system = System::new();

    system.display = crate::display::mode(display).unwrap();
    system.files.mount('C', HostDrive::new(windows));
    Some(system)
}

/// A fixture's records: function, arguments, result.
fn recorded(name: &str) -> Vec<[String; 3]> {
    let Ok(text) = std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
    else {
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
            [
                field(record, "function"),
                field(record, "args"),
                field(record, "result"),
            ]
        })
        .collect()
}

/// A buffer in the program's memory: a block of the global heap's.
fn buffer(system: &mut System, size: u32) -> u32 {
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0x42)
        .unwrap();

    u32::from(winbox_machine::segment_selector(index)) << 16
}

/// A record's arguments: the face, quoted or a stock font's name; the
/// named fields; the bare words; and the character drawn, where the record
/// ends with one -- quoted, or its code after `#`.
struct Asked {
    face: String,
    fields: Vec<(String, String)>,
    words: Vec<String>,
    character: Option<u8>,
}

impl Asked {
    fn parse(args: &str) -> Self {
        let (face, rest) = if let Some(quoted) = args.strip_prefix('"') {
            let end = quoted.find('"').unwrap();

            (
                quoted[..end].to_string(),
                quoted[end + 1..].trim_start_matches(','),
            )
        } else {
            let end = args.find(',').unwrap_or(args.len());

            (args[..end].to_string(), args[end..].trim_start_matches(','))
        };
        let bytes = rest.as_bytes();
        let (rest, character) = if bytes.len() >= 3 && bytes[bytes.len() - 1] == b'\'' {
            let character = bytes[bytes.len() - 2];

            (&rest[..rest.len() - 3], Some(character))
        } else if let Some(at) = rest
            .rfind(",#")
            .or_else(|| rest.starts_with('#').then_some(0))
        {
            let code = rest[at..].trim_start_matches(',').trim_start_matches('#');

            (&rest[..at], u8::from_str_radix(code, 16).ok())
        } else {
            (rest, None)
        };
        let mut fields = Vec::new();
        let mut words = Vec::new();

        for field in rest.split(',').filter(|field| !field.is_empty()) {
            match field.split_once('=') {
                Some((name, value)) => fields.push((name.to_string(), value.to_string())),
                None => words.push(field.to_string()),
            }
        }

        Self {
            face,
            fields,
            words,
            character,
        }
    }

    fn field(&self, name: &str) -> Option<&str> {
        self.fields
            .iter()
            .find(|(field, _)| field == name)
            .map(|(_, value)| value.as_str())
    }

    fn number(&self, name: &str, none: i32) -> i32 {
        self.field(name)
            .map_or(none, |value| value.parse().unwrap())
    }

    /// The font asked for: a stock font, by its name, or one made.
    fn font(&self, system: &mut System) -> u16 {
        let stock = match self.face.as_str() {
            "SYSTEM_FONT" => Some(13),
            "ANSI_VAR_FONT" => Some(12),
            "ANSI_FIXED_FONT" => Some(11),
            _ => None,
        };

        if let Some(stock) = stock {
            return get_stock_object(system, stock);
        }

        let char_set = if self.words.iter().any(|word| word == "oem") {
            255
        } else if self.words.iter().any(|word| word == "symbol") {
            2
        } else {
            self.number("charset", 0) as u8
        };

        create_font_indirect(
            system,
            LogFont {
                height: self.number("h", 0) as i16,
                width: self.number("w", 0) as i16,
                weight: self.number("weight", 0) as i16,
                italic: self.number("italic", 0) as u8,
                underline: self.number("under", 0) as u8,
                strike_out: self.number("strike", 0) as u8,
                char_set,
                face_name: self.face.clone(),
                ..LogFont::default()
            },
        )
    }
}

/// A memory device context with a monochrome bitmap of a size selected,
/// white all over, as `PatBlt(..., WHITENESS)` leaves it.
fn cell(system: &mut System, width: i16, height: i16) -> (u16, u16) {
    let hdc = create_compatible_dc(system, 0);
    let bitmap = create_bitmap(system, width, height, 1, 1, 0);

    // The bitmap a new context starts with is given a handle as it is
    // replaced; let go of it, or a sweep of thousands of cells runs out.
    let placeholder = select_object(system, hdc, bitmap);

    delete_object(system, placeholder);
    system
        .bitmap_of(bitmap)
        .unwrap()
        .pixels
        .indices
        .borrow_mut()
        .fill(1);
    (hdc, bitmap)
}

/// A monochrome bitmap's bits, as `GetBitmapBits` reads them, in hex.
fn bits(system: &mut System, bitmap: u16, size: i32) -> String {
    let far = buffer(system, size as u32);

    get_bitmap_bits(system, bitmap, size, far);
    system
        .read_far(far, size as usize)
        .iter()
        .fold(String::new(), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

fn index_of(system: &System, hdc: u16) -> usize {
    match system.handles.resolve(hdc) {
        Some(Object::Dc(index)) => index,
        _ => panic!("no device context"),
    }
}

/// How a fixture's records came out: agreeing, disagreeing, and not drawn
/// for a face only an outline answers.
#[derive(Debug, Default, PartialEq, Eq)]
struct Tally {
    agreed: usize,
    disagreed: Vec<String>,
    outline: usize,
}

impl Tally {
    fn count(&mut self, args: &str, ours: Result<String, Stop>, result: &str) {
        match ours {
            Ok(ours) if ours == result => self.agreed += 1,
            Ok(_) => self.disagreed.push(args.to_string()),
            Err(Stop::Unsupported("a font an outline may answer")) => self.outline += 1,
            Err(stop) => panic!("{args}: {stop:?}"),
        }
    }

    fn assert_all(&self, name: &str) {
        println!(
            "{name}: {} agreed, {} of an outline face",
            self.agreed, self.outline
        );
        assert!(
            self.disagreed.is_empty(),
            "{name}: {} agreed, {} disagreed, the first {:?}",
            self.agreed,
            self.disagreed.len(),
            &self.disagreed[..self.disagreed.len().min(5)]
        );
    }
}

/// One character drawn the way the glyph probes draw it: `TextOut` into a
/// cell, its ground as the record says -- `back` a black background colour,
/// `opaque` the mode, `align` and `at` where the text goes, `extra` the
/// character extra.
fn glyph(system: &mut System, asked: &Asked, text: &[u8]) -> Result<String, Stop> {
    let size = asked.number("cell", 32);
    let (hdc, bitmap) = cell(system, size as i16, size as i16);
    let font = asked.font(system);
    let index = index_of(system, hdc);

    select_object(system, hdc, font);

    if asked.number("back", 0) != 0 {
        set_bk_color(system, hdc, 0);
    }

    let state = &mut system.gdi.dcs[index].state;

    state.back_mode = if asked.number("opaque", 1) == 0 { 1 } else { 2 };
    state.text_align = asked.number("align", 0) as u16;
    state.char_extra = asked.number("extra", 0) as u16;

    let at = asked
        .field("at")
        .map(|at| i64::from(at.parse::<i32>().unwrap()));
    let drawn = text_out(system, hdc, at.unwrap_or(2), at.unwrap_or(0), text);
    let read = drawn.map(|_| bits(system, bitmap, size / 8 * size));

    delete_dc(system, hdc);
    delete_object(system, bitmap);
    delete_object(system, font);
    read
}

fn glyphs(display: &str, name: &str) -> Option<Tally> {
    let mut system = installed(display)?;
    let mut tally = Tally::default();

    for [function, args, result] in recorded(name) {
        if function != "glyph" {
            continue;
        }

        let asked = Asked::parse(&args);
        let character = [asked.character.unwrap()];

        tally.count(&args, glyph(&mut system, &asked, &character), &result);
    }

    Some(tally)
}

#[test]
fn draws_the_strikes_as_windows_does() {
    for name in ["glyphs-vga", "textbk-vga", "textalin-vga", "rules-vga"] {
        let Some(tally) = glyphs("vga", name) else {
            return;
        };

        tally.assert_all(name);
        assert!(tally.agreed > 0, "{name}");
    }
}

#[test]
fn draws_the_strikes_as_the_hercules_does() {
    let Some(tally) = glyphs("hercules", "glyphs-hercules") else {
        return;
    };

    tally.assert_all("glyphs-hercules");
}

#[test]
fn draws_the_plotter_fonts_with_the_drivers_line() {
    for display in ["vga", "hercules", "ega"] {
        let name = format!("plotter-{display}");
        let Some(tally) = glyphs(display, &name) else {
            continue;
        };

        tally.assert_all(&name);
        assert_eq!(tally.outline, 0, "{name}");
    }
}

#[test]
fn spaces_by_the_character_extra() {
    let Some(mut system) = installed("vga") else {
        return;
    };
    let mut tally = Tally::default();

    for [_, args, result] in recorded("textxtra-vga") {
        let asked = Asked::parse(&args);
        // The record's text is a string, not a character.
        let text = args.rsplit_once(",'").unwrap().1.trim_end_matches('\'');

        tally.count(&args, glyph(&mut system, &asked, text.as_bytes()), &result);
    }

    tally.assert_all("textxtra-vga");
}

#[test]
fn paints_the_ground_and_the_strikeout_as_windows_does() {
    let Some(mut system) = installed("vga") else {
        return;
    };
    let mut tally = Tally::default();

    for [function, args, result] in recorded("groundbx-vga") {
        assert_eq!(function, "ground");

        let (font, character) = args.rsplit_once(",'").unwrap();
        let asked = Asked::parse(&format!("{font},back=1,opaque=1,cell=64,'{character}"));
        let character = [asked.character.unwrap()];

        tally.count(&args, glyph(&mut system, &asked, &character), &result);
    }

    tally.assert_all("groundbx-vga");

    let mut tally = Tally::default();

    for [function, args, result] in recorded("strikout-vga") {
        if function != "band" {
            continue;
        }

        let asked = Asked::parse(&format!("{args},under=0,cell=64,'.'"));

        tally.count(&args, glyph(&mut system, &asked, b"."), &result);
    }

    tally.assert_all("strikout-vga");
    assert!(tally.agreed > 0);
}

/// One `ExtTextOut`, or the `TextOut` it is compared against, into a cell
/// sixty-four by forty-eight, the pen at (8, 4), as `extout` and `groundrn`
/// draw them.
struct ExtCall {
    width: i16,
    height: i16,
    text: Vec<u8>,
    textout: bool,
    options: u16,
    rect: Option<Bounds>,
    mode: u16,
    dark: bool,
    extra: i16,
    dx: Option<Vec<i64>>,
}

fn draw_ext(system: &mut System, asked: &Asked, call: ExtCall) -> Result<String, Stop> {
    let (hdc, bitmap) = cell(system, call.width, call.height);
    let font = asked.font(system);
    let index = index_of(system, hdc);

    select_object(system, hdc, font);
    set_bk_color(system, hdc, if call.dark { 0 } else { 0x00ff_ffff });

    let state = &mut system.gdi.dcs[index].state;

    state.back_mode = call.mode;
    state.char_extra = call.extra as u16;

    let drawn = if call.textout {
        text_out(system, hdc, 8, 4, &call.text)
    } else {
        ext_text_out(
            system,
            hdc,
            8,
            4,
            &call.text,
            Extra {
                options: call.options,
                rect: call.rect,
                dx: call.dx,
            },
        )
    };
    let size = i32::from(call.width) / 8 * i32::from(call.height);
    let read = drawn.map(|_| bits(system, bitmap, size));

    delete_dc(system, hdc);
    delete_object(system, bitmap);
    delete_object(system, font);
    read
}

fn numbers(text: &str) -> Vec<i64> {
    text.split(':')
        .map(|value| value.parse().unwrap())
        .collect()
}

#[test]
fn draws_extended_text_as_windows_does() {
    let Some(mut system) = installed("vga") else {
        return;
    };
    let mut tally = Tally::default();

    for [_, args, result] in recorded("extout-vga") {
        let asked = Asked::parse(&args);
        let rect = numbers(asked.field("rect").unwrap_or("0:0:0:0"));
        let call = ExtCall {
            width: 64,
            height: 48,
            text: b"AB".to_vec(),
            textout: asked.words.iter().any(|word| word == "textout"),
            options: asked.number("opt", 0) as u16,
            rect: (asked.number("use", 0) != 0).then_some(Bounds {
                left: rect[0],
                top: rect[1],
                right: rect[2],
                bottom: rect[3],
            }),
            mode: asked.number("mode", 2) as u16,
            dark: asked.number("dark", 0) != 0,
            extra: asked.number("extra", 0) as i16,
            dx: asked.field("dx").map(numbers),
        };

        tally.count(&args, draw_ext(&mut system, &asked, call), &result);
    }

    tally.assert_all("extout-vga");
    assert!(tally.agreed > 0);

    let mut tally = Tally::default();

    for [_, args, result] in recorded("groundrn-vga") {
        let asked = Asked::parse(&args);
        let dx = asked.field("dx").map(numbers);
        let call = ExtCall {
            width: 96,
            height: 56,
            text: asked.field("s").unwrap_or("").as_bytes().to_vec(),
            textout: dx.is_none(),
            options: 0,
            rect: None,
            mode: 2,
            dark: true,
            extra: 0,
            dx,
        };

        tally.count(&args, draw_ext(&mut system, &asked, call), &result);
    }

    tally.assert_all("groundrn-vga");
    assert!(tally.agreed > 0);
}

#[test]
fn clips_to_the_rectangle_as_windows_does() {
    let Some(mut system) = installed("vga") else {
        return;
    };
    let mut tally = Tally::default();

    for [function, args, result] in recorded("clipedge-vga") {
        if function != "clip" {
            continue;
        }

        let asked = Asked::parse(&args);
        let rect = numbers(asked.field("rect").unwrap_or("0:0:0:0"));
        let call = ExtCall {
            width: 64,
            height: 48,
            text: b"AB".to_vec(),
            textout: false,
            options: asked.number("opt", 0) as u16,
            rect: Some(Bounds {
                left: rect[0],
                top: rect[1],
                right: rect[2],
                bottom: rect[3],
            }),
            mode: 1,
            dark: false,
            extra: 0,
            dx: None,
        };

        tally.count(&args, draw_ext(&mut system, &asked, call), &result);
    }

    tally.assert_all("clipedge-vga");
}

/// The `justify` probe, as its replay draws it: each line justified and
/// drawn at (2, 0) in a cell 128 by 16, transparent, black on white.
#[test]
fn justifies_as_windows_does() {
    let Some(mut system) = installed("vga") else {
        return;
    };
    let mut drawn = std::collections::HashMap::new();
    let (hdc, bitmap) = cell(&mut system, 128, 16);
    let index = index_of(&system, hdc);
    let font = create_font_indirect(
        &mut system,
        LogFont {
            height: 13,
            weight: 400,
            face_name: "MS Sans Serif".to_string(),
            ..LogFont::default()
        },
    );
    let clear = |system: &mut System| {
        system
            .bitmap_of(bitmap)
            .unwrap()
            .pixels
            .indices
            .borrow_mut()
            .fill(1);

        let state = &mut system.gdi.dcs[index].state;

        state.text_color = Some(0);
        state.back_color = Some(0x00ff_ffff);
        state.back_mode = 1;
        state.char_extra = 0;
        state.justification = None;
    };

    select_object(&mut system, hdc, font);

    for (name, text, extra, count, character) in [
        ("even", &b"a b c"[..], 8, 2, 0),
        ("uneven", b"a b c d", 7, 3, 0),
        ("one-break", b"ab cd", 5, 1, 0),
        ("negative", b"a b c", -3, 2, 0),
        ("with-extra", b"a b c", 5, 2, 1),
    ] {
        clear(&mut system);
        system.gdi.dcs[index].state.char_extra = character;
        set_text_justification(&mut system, hdc, extra, count);
        get_text_extent(&mut system, hdc, text, text.len() as i32).unwrap();
        text_out(&mut system, hdc, 2, 0, text).unwrap();
        drawn.insert(name, bits(&mut system, bitmap, 256));
    }

    clear(&mut system);
    set_text_justification(&mut system, hdc, 7, 3);
    text_out(&mut system, hdc, 2, 0, b"a b").unwrap();

    let size = i64::from(get_text_extent(&mut system, hdc, b"a b", 3).unwrap() & 0xffff);

    text_out(&mut system, hdc, 2 + size, 0, b" c d").unwrap();
    drawn.insert("two-parts", bits(&mut system, bitmap, 256));

    clear(&mut system);
    set_text_justification(&mut system, hdc, 8, 2);
    ext_text_out(
        &mut system,
        hdc,
        2,
        0,
        b"a b c",
        Extra {
            options: 0,
            rect: None,
            dx: Some(vec![10; 5]),
        },
    )
    .unwrap();
    drawn.insert("ext-dx", bits(&mut system, bitmap, 256));

    let mut checked = 0;

    for [function, args, result] in recorded("justify") {
        let Some(case) = args.strip_prefix("MS Sans Serif,13,") else {
            continue;
        };

        if function == "glyph" {
            assert_eq!(drawn[case], result, "{case}");
            checked += 1;
        }
    }

    assert_eq!(checked, 7);
}

#[test]
fn moves_the_current_position_with_ta_updatecp() {
    let Some(mut system) = installed("vga") else {
        return;
    };
    let hdc = create_compatible_dc(&mut system, 0);
    let index = index_of(&system, hdc);
    let width = i32::from(get_text_extent(&mut system, hdc, b"AB", 2).unwrap() as u16);

    system.gdi.dcs[index].state.text_align = TA_UPDATECP;
    system.gdi.dcs[index].state.position = (5, 7);
    assert_eq!(text_out(&mut system, hdc, 100, 100, b"AB").unwrap(), 1);
    assert_eq!(system.gdi.dcs[index].state.position, (5 + width, 7));

    system.gdi.dcs[index].state.text_align = TA_UPDATECP | TA_RIGHT;
    text_out(&mut system, hdc, 0, 0, b"AB").unwrap();
    assert_eq!(system.gdi.dcs[index].state.position, (5, 7));

    system.gdi.dcs[index].state.text_align = TA_UPDATECP | TA_CENTER;
    text_out(&mut system, hdc, 0, 0, b"AB").unwrap();
    assert_eq!(system.gdi.dcs[index].state.position, (5, 7));

    // A handle that stands for nothing answers FALSE; one that is no
    // device context's stops, as the TypeScript engine throws.
    assert_eq!(text_out(&mut system, 0x1234, 0, 0, b"AB"), Ok(0));

    let pen = get_stock_object(&mut system, 7);

    assert!(text_out(&mut system, pen, 0, 0, b"AB").is_err());
}
