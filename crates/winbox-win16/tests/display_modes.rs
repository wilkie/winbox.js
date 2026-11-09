//! The display modes (`data/displays.json`) and what the drivers DOSBox
//! cannot run answer, from the read-outs. As `test/win16/display_modes_test.ts`
//! and the parts of `test/win16/display_driver_test.ts` the crate's own tests
//! (`display.rs`, `gdi/mod.rs`, `gdi/calls/escape.rs`, `present.rs`,
//! `tests/oem_bitmaps.rs`) did not already hold.
//!
//! The recorded modes are checked against real Windows by the probes, which
//! is a stronger thing than anything here. The 8514/a and the XGA are not,
//! and cannot be: nothing available emulates either card. Their numbers are
//! read out of the drivers (`8514.DRV` seg6 `0311`, `XGA.DRV` seg3 `0c1c`:
//! each driver's `GDIINFO` as its `Enable` leaves it on a card with a
//! megabyte), and the `GetDeviceCaps` answers below are those read-outs.
//! What is left for all of them is internal consistency: a mode that claims
//! 256 colours and one bit per pixel is wrong without a recording to say so.

use winbox_raster::{DisplayKind, palette_for_display};
use winbox_win16::display::{Display, mode, modes};
use winbox_win16::gdi::get_device_caps;
use winbox_win16::{Kept, System};

/// Each mode's provenance, as `displays.json` says it.
fn provenance(name: &str) -> String {
    let all: serde_json::Value =
        serde_json::from_str(include_str!("../data/displays.json")).unwrap();

    all[name]["provenance"].as_str().unwrap_or("").to_string()
}

#[test]
fn offers_both_colour_depths() {
    let depths: Vec<u32> = modes().values().map(|mode| mode.colors).collect();

    // And monochrome besides, which Hercules is.
    assert!(depths.contains(&16) && depths.contains(&256));
}

#[test]
fn says_of_each_mode_whether_it_was_measured() {
    for name in modes().keys() {
        let provenance = provenance(name);

        assert!(
            provenance == "recorded" || provenance == "read out",
            "{name}: {provenance}"
        );
    }
}

#[test]
fn refuses_a_mode_it_does_not_have() {
    assert!(mode("cga").is_none());
}

#[test]
fn each_mode_is_consistent() {
    for (name, mode) in modes() {
        let Display { caps, metrics, .. } = &mode;

        // A surface with a size.
        assert!(mode.width > 0 && mode.height > 0, "{name}");
        assert!(
            caps.width_millimetres > 0 && caps.height_millimetres > 0,
            "{name}"
        );
        // Sixteen colours are four one-bit planes; 256 are eight bits in one.
        assert_eq!(
            mode.colors,
            1 << (u32::from(mode.bits_per_pixel) * u32::from(mode.planes)),
            "{name}"
        );
        // Palette capabilities only where it has a palette.
        let palettised = mode.colors > 16;

        assert_eq!(caps.size_palette > 0, palettised, "{name}");
        assert_eq!(caps.num_reserved > 0, palettised, "{name}");
        assert_eq!(caps.color_res > 0, palettised, "{name}");
        // Square pixels mean equal dots per inch across and down, and equal
        // aspect terms. The EGA has neither.
        assert_eq!(
            caps.logical_pixels_x == caps.logical_pixels_y,
            caps.aspect_x == caps.aspect_y,
            "{name}"
        );
        // The system metrics that follow from it.
        for (field, value) in [
            ("caption", metrics.caption_height),
            ("menu", metrics.menu_height),
            ("border width", metrics.border_width),
            ("border height", metrics.border_height),
            ("frame width", metrics.frame_width),
            ("frame height", metrics.frame_height),
            ("icon width", metrics.icon_width),
            ("icon height", metrics.icon_height),
        ] {
            assert!(value > 0, "{name}.{field}");
        }
    }
}

/// `GetDeviceCaps` on the drivers DOSBox cannot run, by index, at small
/// fonts and at 640 by 480, beside `gdi/mod.rs`'s test of the 8514/a's and
/// the XGA's at large fonts.
#[test]
fn get_device_caps_answers_the_read_out_at_every_setting() {
    let answers: [(&str, &[(i16, i16)]); 3] = [
        (
            "8514s",
            &[
                (4, 280),
                (6, 210),
                (8, 1024),
                (10, 768),
                (12, 8),
                (18, 20),
                (24, 20),
                (34, 8196),
                (38, 2009),
                (88, 96),
                (90, 96),
                (104, 256),
                (106, 20),
            ],
        ),
        (
            "xga256s",
            &[
                (4, 280),
                (6, 210),
                (8, 1024),
                (10, 768),
                (18, 120),
                (34, 8708),
                (38, 985),
                (88, 120),
                (90, 120),
            ],
        ),
        (
            "xga640",
            &[
                (4, 280),
                (6, 210),
                (8, 640),
                (10, 480),
                (12, 8),
                (18, 120),
                (24, 20),
                (34, 8708),
                (38, 985),
                (40, 10),
                (42, 10),
                (44, 14),
                (88, 96),
                (90, 96),
                (104, 256),
                (106, 20),
            ],
        ),
    ];

    for (name, answers) in answers {
        let mut system = System::new();

        system.display = mode(name).unwrap();

        for &(index, answer) in answers {
            assert_eq!(
                get_device_caps(&system, 0, index),
                answer as u16,
                "{name} {index}"
            );
        }
    }
}

#[test]
fn the_cards_dosbox_cannot_run_are_marked_read_out() {
    for name in ["8514", "xga256", "8514s", "xga256s", "xga640"] {
        assert_eq!(provenance(name), "read out", "{name}");
    }
}

/// The 8514/a's tenth static colour, A4C8F0, read out of the driver, where
/// the VGA's 256-colour drivers have A6CAF0; the ninth C0DCC0.
#[test]
fn has_the_8514s_tenth_static_colour() {
    let colours = |name: &str| {
        let display = mode(name).unwrap();
        let kind = DisplayKind {
            colors: display.colors,
            ega: display.palette.as_deref() == Some("ega"),
            ibm: display.palette.as_deref() == Some("8514"),
        };

        palette_for_display(kind, None).borrow().colours.clone()
    };

    for name in ["8514", "xga256", "8514s", "xga256s", "xga640"] {
        let colours = colours(name);

        assert_eq!(colours[9], [0xa4, 0xc8, 0xf0], "{name}");
        assert_eq!(colours[8], [0xc0, 0xdc, 0xc0], "{name}");
    }

    assert_eq!(colours("vga256")[9], [0xa6, 0xca, 0xf0]);
}

/// `GetDriverResourceID` at the settings the large-font modes run at: every
/// number as it is (`8514.DRV` seg6 `02be`, `XGA.DRV` seg3 `008e`), beside
/// `display.rs`'s cases.
#[test]
fn get_driver_resource_id_answers_every_number_at_large_fonts() {
    assert_eq!(mode("8514").unwrap().resource_id(3), Some(3));
    assert_eq!(mode("xga256").unwrap().resource_id(1), Some(1));
    assert_eq!(mode("8514").unwrap().resource_number(32754), 32754);
}

/// The display drivers' export tables: `ExtTextOut` 28h, five words more
/// than `StrBlt`'s 1Eh; the XGA's ordinal 548 eight bytes; the Super VGA
/// 256-colour driver's 2023, `BltSpecial_Cirrus542X`.
#[test]
fn the_display_drivers_export_tables() {
    for file in [
        "VGA.DRV",
        "HERCULES.DRV",
        "SVGA256.DRV",
        "8514.DRV",
        "XGA.DRV",
    ] {
        let module = Kept::display_driver(file);

        assert_eq!(
            (
                module.export(11).map(|export| export.pops),
                module.export(14).map(|export| export.pops)
            ),
            (Some(30), Some(40)),
            "{file}"
        );
    }

    assert_eq!(
        Kept::display_driver("XGA.DRV")
            .export(548)
            .map(|export| export.pops),
        Some(8)
    );
    assert_eq!(
        Kept::display_driver("SVGA256.DRV")
            .export(2023)
            .map(|export| export.name),
        Some("BltSpecial_Cirrus542X")
    );
}
