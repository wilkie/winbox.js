use std::collections::HashSet;
use std::path::{Path, PathBuf};

use winbox_machine::{Files, HostDrive};
use winbox_raster::Measure;

use super::*;

#[test]
fn reads_a_section_of_a_profile_in_the_order_written() {
    let text = "[windows]\r\nload=\r\n[boot]   \r\nfonts.fon=vgasys.fon\r\n\
                oemfonts.fon = vgaoem.fon\r\nnothing\r\ntwo=equals=signs\r\nempty=\r\n\
                [keyboard]\r\nfixedfon.fon=wrong.fon\r\n";

    assert_eq!(
        profile_section(text, "BOOT"),
        vec![
            ("fonts.fon".to_string(), "vgasys.fon".to_string()),
            ("oemfonts.fon".to_string(), "vgaoem.fon".to_string()),
        ]
    );
    assert!(profile_section(text, "fonts").is_empty());
    // A section at the end of the text runs to it.
    assert_eq!(
        profile_section("[fonts]\nA=B.FON", "fonts"),
        vec![("A".to_string(), "B.FON".to_string())]
    );
}

#[test]
fn orders_the_boot_fonts_as_gdi_does_then_win_ini() {
    // The EGA's installation lists the boot fonts the other way round.
    let system = "[boot]\r\noemfonts.fon=egaoem.fon\r\nfixedfon.fon=egafix.fon\r\n\
                  fonts.fon=egasys.fon\r\n";
    let windows = "[fonts]\r\nMS Sans Serif=SSERIFB.FON\r\nArial (TrueType)=C:\\WINDOWS\\SYSTEM\\arial.fot\r\n\
                   System again=egasys.fon\r\n";

    assert_eq!(
        font_directory_order(system, windows),
        vec![
            "EGASYS.FON",
            "EGAFIX.FON",
            "EGAOEM.FON",
            "SSERIFB.FON",
            "ARIAL.FOT"
        ]
    );
}

#[test]
fn finds_the_outline_a_stub_stands_for() {
    assert_eq!(
        true_type_file_of(b"\0\0C:\\WINDOWS\\SYSTEM\\arialbd.ttf\0", "ARIALBD.FOT"),
        "ARIALBD.TTF"
    );
    assert_eq!(true_type_file_of(b"nothing here", "times.fot"), "TIMES.TTF");
}

#[test]
fn sorts_files_into_directory_order_stably() {
    let order = vec!["B.FON".to_string(), "A.FON".to_string()];
    let files = vec!["c.fon", "a.fon", "d.fon", "b.fon"];

    assert_eq!(
        in_directory_order(files, &order, |name| (*name).to_string()),
        vec!["b.fon", "a.fon", "c.fon", "d.fon"]
    );
}

#[test]
fn lays_out_a_textmetric_as_a_program_reads_it() {
    let metric = TextMetric {
        height: 16,
        weight: 700,
        italic: 1,
        char_set: 0xff,
        overhang: -1,
        ..TextMetric::default()
    };
    let bytes = metric.bytes();

    assert_eq!(bytes.len(), TextMetric::SIZE);
    assert_eq!(&bytes[0..2], &[16, 0]);
    assert_eq!(&bytes[14..16], &700u16.to_le_bytes());
    assert_eq!(bytes[16], 1);
    assert_eq!(bytes[24], 0xff);
    assert_eq!(&bytes[25..27], &[0xff, 0xff]);
}

#[test]
fn reads_a_logfont() {
    let mut bytes = vec![0u8; LogFont::SIZE];

    bytes[0..2].copy_from_slice(&(-13i16).to_le_bytes());
    bytes[8..10].copy_from_slice(&700i16.to_le_bytes());
    bytes[10] = 1;
    bytes[13] = 2;
    bytes[17] = 0x22;
    bytes[18..22].copy_from_slice(b"Helv");

    let logfont = LogFont::read(&bytes);

    assert_eq!(logfont.height, -13);
    assert_eq!(logfont.weight, 700);
    assert_eq!(logfont.italic, 1);
    assert_eq!(logfont.face_name, "Helv");

    // Helv's pitch is made variable, and its character set left alone.
    let request = Request::new(&logfont, &Device::default());

    assert_eq!(request.pitch_and_family, 0x22);
    assert_eq!(request.charset, 2);

    let symbol = Request::new(
        &LogFont {
            face_name: "Zapf Dingbats".into(),
            ..LogFont::default()
        },
        &Device::default(),
    );

    assert_eq!(symbol.charset, SYMBOL_CHARSET);
}

#[test]
fn knows_the_shape_of_each_display() {
    let vga = Device::of(&crate::display::mode("vga").unwrap());

    assert_eq!((vga.log_pixels_x, vga.log_pixels_y), (96, 96));
    assert_eq!((vga.aspect_x, vga.aspect_y), (36, 36));
    assert!(vga.big_font());

    let ega = Device::of(&crate::display::mode("ega").unwrap());

    assert_eq!((ega.log_pixels_x, ega.log_pixels_y), (96, 72));
    assert_eq!((ega.aspect_x, ega.aspect_y), (38, 48));
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The oracle's installation's fonts, booted as Windows boots them; `None`
/// where a checkout has not got it.
fn installation() -> Option<FontManager> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM").is_dir() {
        return None;
    }

    let mut files = Files::new();

    files.mount('C', HostDrive::new(windows));
    Some(boot(&files))
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

#[test]
fn loads_the_fonts_in_gdis_directory_order() {
    let Some(fonts) = installation() else {
        return;
    };
    let listed: Vec<&str> = fonts
        .listed_entries()
        .iter()
        .map(|strike| strike.entry.name())
        .collect();

    // The boot fonts first, then `WIN.INI`'s `[fonts]` in the order written.
    assert_eq!(&listed[..3], &["System", "Fixedsys", "Terminal"]);
    assert_eq!(listed[3], "MS Sans Serif");
    assert!(listed.contains(&"Small Fonts"));
    assert!(listed.contains(&"Roman"));
    // `DOSAPP.FON`'s Terminal is loaded, but not listed.
    assert!(
        fonts
            .lookup("Terminal")
            .unwrap()
            .1
            .iter()
            .any(|strike| !strike.listed)
    );
    // The stubs are GDI's TrueType directory, in `WIN.INI`'s order.
    let stubs: Vec<&str> = fonts
        .true_type_directory
        .iter()
        .map(|stub| stub.file.as_str())
        .collect();

    assert_eq!(&stubs[..2], &["ARIAL.TTF", "ARIALBD.TTF"]);
    assert_eq!(stubs.last(), Some(&"SYMBOL.TTF"));
    assert_eq!(fonts.resource("SYMBOL.TTF").unwrap().pitch_and_family, 0x17);
}

/// What the `text` probe records of a stock font's metrics.
fn stock_records(font: &LogicalFont) -> Vec<(&'static str, String)> {
    let tm = text_metrics(font);

    vec![
        (
            "metrics heights",
            format!(
                "height={},ascent={},descent={},internal={},external={}",
                tm.height, tm.ascent, tm.descent, tm.internal_leading, tm.external_leading
            ),
        ),
        (
            "metrics widths",
            format!(
                "ave={},max={},weight={},overhang={}",
                tm.ave_char_width, tm.max_char_width, tm.weight, tm.overhang
            ),
        ),
        (
            "metrics character set",
            format!(
                "first={},last={},default={},break={},pitch={},charset={}",
                tm.first_char,
                tm.last_char,
                tm.default_char,
                tm.break_char,
                tm.pitch_and_family,
                tm.char_set
            ),
        ),
        (
            "metrics style",
            format!(
                "italic={},underlined={},struckout={}",
                tm.italic, tm.underlined, tm.struck_out
            ),
        ),
        ("GetTextFace", format!("\"{}\"", font.face)),
    ]
}

const STOCK_NAMES: [(&str, u16); 6] = [
    ("OEM_FIXED_FONT", 10),
    ("ANSI_FIXED_FONT", 11),
    ("ANSI_VAR_FONT", 12),
    ("SYSTEM_FONT", 13),
    ("DEVICE_DEFAULT_FONT", 14),
    ("SYSTEM_FIXED_FONT", 16),
];

fn stock_named(fonts: &FontManager, name: &str) -> LogicalFont {
    let (_, index) = STOCK_NAMES
        .iter()
        .find(|(stock, _)| *stock == name)
        .unwrap();

    stock_font(fonts, *index).unwrap()
}

#[test]
fn the_stock_fonts_are_what_windows_reports() {
    let Some(fonts) = installation() else {
        return;
    };
    let mut checked = 0;

    for [function, args, result] in recorded("text") {
        match function.as_str() {
            "metrics heights"
            | "metrics widths"
            | "metrics character set"
            | "metrics style"
            | "GetTextFace" => {
                let font = stock_named(&fonts, &args);
                let (_, ours) = stock_records(&font)
                    .into_iter()
                    .find(|(name, _)| *name == function)
                    .unwrap();

                assert_eq!(ours, result, "{function} {args}");
            }
            "GetTextExtent" => {
                let (stock, text) = args.split_once(',').unwrap();
                let text = text.trim_matches('"');
                let (width, height) =
                    stock_named(&fonts, stock).measure(text.as_bytes(), Measure::default());

                assert_eq!(format!("width={width},height={height}"), result, "{args}");
            }
            "GetCharWidth" => {
                let (stock, range) = args.split_once(',').unwrap();
                let (first, last) = range.split_once('-').unwrap();
                let font = stock_named(&fonts, stock);
                let widths: Vec<String> = (first.parse::<u8>().unwrap()..=last.parse().unwrap())
                    .map(|code| font.measure(&[code], Measure::default()).0.to_string())
                    .collect();

                assert_eq!(widths.join(","), result, "{args}");
            }
            _ => continue,
        }

        checked += 1;
    }

    assert_eq!(checked, 45);
}

/// The `font` probe's request, from its arguments: the face and the fields
/// in the order `CreateFont` takes them.
fn parse_request(args: &str) -> Option<LogFont> {
    let (face, rest) = args.strip_prefix('"')?.split_once("\",")?;
    let mut logfont = LogFont {
        face_name: face.to_string(),
        ..LogFont::default()
    };

    for field in rest.split(',') {
        let (key, value) = field.split_once('=')?;

        // `probeQuality`'s request: weight 400, the ANSI set, proof quality.
        if (key, value) == ("quality", "proof") {
            logfont.weight = 400;
            logfont.quality = 2;
            continue;
        }

        let number: i16 = value.parse().ok()?;

        match key {
            "h" => logfont.height = number,
            "w" => logfont.width = number,
            "weight" => logfont.weight = number,
            "italic" => logfont.italic = number as u8,
            "under" => logfont.underline = number as u8,
            "strike" => logfont.strike_out = number as u8,
            "charset" => logfont.char_set = number as u8,
            "pitch" => logfont.pitch_and_family = number as u8,
            _ => return None,
        }
    }

    Some(logfont)
}

/// What the `font` probe records of a font made of a request.
fn font_record(fonts: &FontManager, function: &str, logfont: &LogFont, device: &Device) -> String {
    let Some(font) = fonts.create(&Request::new(logfont, device)) else {
        return "no font".to_string();
    };
    let tm = text_metrics(&font);

    match function {
        "CreateFont face" => format!("\"{}\"", font.face),
        "CreateFont quality" => format!(
            "height={},ascent={},descent={},ave={},max={}",
            tm.height, tm.ascent, tm.descent, tm.ave_char_width, tm.max_char_width
        ),
        "CreateFont heights" => format!(
            "height={},ascent={},descent={},internal={},external={}",
            tm.height, tm.ascent, tm.descent, tm.internal_leading, tm.external_leading
        ),
        "CreateFont widths" => format!(
            "ave={},max={},weight={},overhang={}",
            tm.ave_char_width, tm.max_char_width, tm.weight, tm.overhang
        ),
        "CreateFont style" => format!(
            "italic={},underlined={},struckout={},pitch={},charset={}",
            tm.italic, tm.underlined, tm.struck_out, tm.pitch_and_family, tm.char_set
        ),
        _ => {
            let (width, height) = font.measure(b"Wg jpq 128", Measure::default());

            format!("width={width},height={height}")
        }
    }
}

/// The faces Windows answers with outlines: a record of a request naming
/// one, or answered by one, is a TrueType answer this engine cannot give.
const OUTLINE_FACES: [&str; 5] = [
    "arial",
    "times new roman",
    "courier new",
    "symbol",
    "wingdings",
];

#[test]
fn maps_requests_as_windows_does_where_no_outline_answers() {
    let Some(fonts) = installation() else {
        return;
    };
    let device = Device::of(&crate::display::mode("vga").unwrap());
    let records = recorded("font-vga");

    // A request Windows answered with an outline -- its style says
    // `TMPF_TRUETYPE` -- or one that names an outline face or nothing
    // installed, is left out: the mapper puts those to an outline.
    let outline: HashSet<&str> = records
        .iter()
        .filter(|[function, _, result]| {
            function == "CreateFont style"
                && result
                    .split(',')
                    .find_map(|field| field.strip_prefix("pitch="))
                    .and_then(|pitch| pitch.parse::<u8>().ok())
                    .is_some_and(|pitch| pitch & 4 != 0)
        })
        .map(|[_, args, _]| args.as_str())
        .collect();

    let (mut agreed, mut total) = (0, 0);
    let mut disagreed = Vec::new();

    for [function, args, result] in &records {
        if !function.starts_with("CreateFont ") || outline.contains(args.as_str()) {
            continue;
        }

        // A strike asked for at a hundred pixels at proof quality may not be
        // stretched, costs more in height than a wrong name does, and loses to
        // Arial's outline: four families of the quality records.
        if function == "CreateFont quality" && args.contains(",h=100,") {
            continue;
        }

        let Some(logfont) = parse_request(args) else {
            continue;
        };
        let named = logfont.face_name.to_lowercase();
        let substituted = substitute(&named).map_or(named.clone(), str::to_lowercase);

        if OUTLINE_FACES.contains(&substituted.as_str())
            || !(named.is_empty() || fonts.lookup(&named).is_some())
        {
            continue;
        }

        total += 1;

        let ours = font_record(&fonts, function, &logfont, &device);

        if ours == *result {
            agreed += 1;
        } else {
            disagreed.push(format!("{function} {args}: {ours} for {result}"));
        }
    }

    eprintln!("agreed {agreed} of {total}");
    assert!(total > 4000, "{total}");
    assert!(
        disagreed.is_empty(),
        "{agreed} of {total}:\n{}",
        disagreed.join("\n")
    );
}
