//! The display winbox.js is: its size, its driver's capabilities, and its
//! system metrics and colours, as the probes recorded them on each display
//! Windows 3.1 ran on. The table is written from the TypeScript engine's
//! by `npm run rust:modules`, as `data/displays.json`.

use std::collections::HashMap;

use serde::Deserialize;

/// The system metrics that follow from the driver.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub caption_height: i16,
    pub menu_height: i16,
    pub border_width: i16,
    pub border_height: i16,
    pub frame_width: i16,
    pub frame_height: i16,
    pub icon_width: i16,
    pub icon_height: i16,
}

/// A display mode.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub name: String,
    /// What it is, as `displays.json` says: "VGA, 640x480, 16 colours";
    /// for WinBox's seamless screen, that and its own size.
    #[serde(default)]
    pub description: String,
    pub driver_file: String,
    pub width: i16,
    pub height: i16,
    pub metrics: Metrics,
    /// Every metric the `chrome` probe recorded, by `SM_` index, but the
    /// screen's sizes.
    #[serde(default)]
    pub metrics_by_index: HashMap<String, i16>,
    pub sys_colors: Vec<u32>,
    /// How many colours it shows, and the bits a pixel of a plane.
    pub colors: u32,
    pub bits_per_pixel: u8,
    pub planes: u8,
    /// `ega` for the EGA's own palette.
    #[serde(default)]
    pub palette: Option<String>,
    /// How its driver takes a line's tie: `top`, or the Hercules's `slope`.
    #[serde(default)]
    pub line_tie: Option<String>,
    /// What its driver answers `QUERYESCSUPPORT` for each escape it has,
    /// by number, and what `MOUSETRAILS` answers (**recorded** by
    /// `escapes`).
    #[serde(default)]
    pub escapes: HashMap<String, i16>,
    #[serde(default)]
    pub mouse_trails: i16,
    /// How many of the first palette entries the driver shows a component
    /// of exactly 80h of as C0h: the Super VGA 256-colour driver's ten
    /// (`brightLowStatics`, read out of `SVGA256.DRV` and **recorded** by
    /// `palshot`). Only the screen shows them so (`present.rs`).
    #[serde(default)]
    pub bright_low_statics: u8,
    /// What its driver says of itself: `GetDeviceCaps`'s answers.
    #[serde(flatten)]
    pub caps: crate::gdi::DeviceCaps,
}

/// The display modes, by the name winbox.js knows each by.
pub fn modes() -> HashMap<String, Display> {
    serde_json::from_str(include_str!("../data/displays.json")).expect("the display modes")
}

/// A display mode by its name: `vga` by default.
pub fn mode(name: &str) -> Option<Display> {
    modes().remove(name)
}

/// The largest a WinBox screen is made, each way. Windows 3.1's
/// coordinates are 16 bits, to 32767, and programs take a rectangle's
/// middle as `(left + right) / 2` in 16 bits, which overflows past 16383.
pub const SCREEN_MOST: i16 = 16383;

/// Past this, each way, programs of the time were rarely run: Windows 3.1's
/// own drivers go to 1024 by 768, and others' to 1280 by 1024 or 1600 by
/// 1200.
pub const SCREEN_TRIED: i16 = 2048;

/// The five fixed mapping modes' window and viewport extents.
type MappingExtents = [[i32; 4]; 5];

/// The mapping modes' extents of `SVGA256.DRV`'s three `GDIINFO` tables,
/// `MM_LOMETRIC` to `MM_TWIPS`, by resolution: seg3 `06a2`, `0710` and
/// `077e` (file offsets `4102h`, `4170h` and `41DEh`). `Enable` (seg3
/// `0800`) copies the one `[00FAh]` picks, through the list at seg3 `07ee`,
/// and changes nothing in it but `LOGPIXELSX` and `LOGPIXELSY`, which it
/// sets to `[00FCh]` (`0876`-`087a`). Both are read as the driver loads
/// (seg3 `00f1`-`012d`): `[svga256.drv] resolution=` of `SYSTEM.INI`,
/// taken to two bits, nought failing the load, and `dpi=`, 96 by default.
/// The three tables are otherwise the same in every field but `HORZRES`,
/// `VERTRES` and these: the millimetres stay 208 by 156 at each.
const SVGA256_TABLES: [((i16, i16), MappingExtents); 3] = [
    (
        (640, 480),
        [
            [2080, 1560, 640, -480],
            [20800, 15600, 640, -480],
            [325, 325, 254, -254],
            [1625, 1625, 127, -127],
            [2340, 2340, 127, -127],
        ],
    ),
    (
        (800, 600),
        [
            [2080, 1560, 800, -600],
            [20800, 15600, 800, -600],
            [325, 325, 318, -318],
            [1625, 1625, 159, -159],
            [2340, 2340, 159, -159],
        ],
    ),
    (
        (1024, 768),
        [
            [2080, 1560, 1024, -768],
            [20800, 15600, 1024, -768],
            [325, 325, 407, -407],
            [1625, 1625, 203, -203],
            [2340, 2340, 203, -203],
        ],
    ),
];

/// `value` times `by` over `over`, rounded to the nearest, a half away from
/// nought.
fn scaled(value: i32, by: i32, over: i32) -> i32 {
    if over == 0 {
        return value;
    }

    let product = i64::from(value) * i64::from(by) * 2;
    let over = i64::from(over);
    let rounded = (product + product.signum() * over) / (2 * over);

    i32::try_from(rounded).unwrap_or(value)
}

/// The mapping modes' extents of a display `from` one resolution made
/// another (**inferred**): each window's extent kept, as the millimetres
/// and the inch are; each viewport's across scaled by the widths and down
/// by the heights, rounded to the nearest. That is the relation of
/// `SVGA256.DRV`'s own three tables, which keep 208 by 156 millimetres at
/// every resolution, with the metric viewports the resolution itself and
/// the English and twips ones the resolution's share of the inch: from
/// 640 by 480, it gives its 800 by 600 table exactly, and its 1024 by 768
/// table but `MM_LOENGLISH`'s 407, where 254 scaled is 406.4 -- the
/// driver's own rounding, taken from its table where the size is one of
/// its own (`extents_at`).
///
/// An extent is a word of `GDIINFO`'s. A viewport scaled past 32767, as the
/// 8514/a's 4064 would be past 8255 across, is brought back by dividing its
/// window and its viewport alike, rounded, which keeps their ratio to the
/// rounding.
pub fn derived_extents(extents: &[[i32; 4]], from: (i16, i16), to: (i16, i16)) -> Vec<[i32; 4]> {
    let (from_x, from_y) = (i32::from(from.0), i32::from(from.1));
    let (to_x, to_y) = (i32::from(to.0), i32::from(to.1));
    let fitted = |window: i32, viewport: i32| {
        let most = i32::from(i16::MAX);
        let over = (viewport.abs() + most - 1) / most;

        if over <= 1 {
            (window, viewport)
        } else {
            (scaled(window, 1, over).max(1), scaled(viewport, 1, over))
        }
    };

    extents
        .iter()
        .map(|&[wex, wey, vex, vey]| {
            let (wex, vex) = fitted(wex, scaled(vex, to_x, from_x));
            let (wey, vey) = fitted(wey, scaled(vey, to_y, from_y));

            [wex, wey, vex, vey]
        })
        .collect()
}

impl Display {
    /// The mapping modes' extents at `width` by `height`: the driver's own
    /// table where it has one of that size, else derived from this mode's.
    pub fn extents_at(&self, width: i16, height: i16) -> Vec<[i32; 4]> {
        if self.driver_file.eq_ignore_ascii_case("SVGA256.DRV")
            && let Some((_, table)) = SVGA256_TABLES
                .iter()
                .find(|(size, _)| *size == (width, height))
        {
            return table.to_vec();
        }

        derived_extents(
            &self.caps.mapping_extents,
            (self.width, self.height),
            (width, height),
        )
    }

    /// This mode at `width` by `height`, a WinBox screen -- `--resolution`,
    /// or seamless mode's share of the host's desktop -- which no Windows
    /// driver of the mode reports. Only the
    /// resolution and what follows from it change: `HORZRES`, `VERTRES`
    /// and the mapping modes' viewports (`extents_at`). Its millimetres,
    /// dots an inch, aspect, colours and capabilities stay the driver's, as
    /// `SVGA256.DRV`'s keep theirs at each of its three resolutions; every
    /// metric and rectangle the engine takes from the screen's size
    /// follows. Each side is held to `SCREEN_MOST`, and to at least one
    /// pixel.
    #[must_use]
    pub fn at_resolution(&self, width: i16, height: i16) -> Self {
        let (width, height) = (width.clamp(1, SCREEN_MOST), height.clamp(1, SCREEN_MOST));
        let mut screen = self.clone();

        screen.caps.mapping_extents = self.extents_at(width, height);
        screen.width = width;
        screen.height = height;
        screen.description = format!("WinBox screen, {width}x{height}, over {}", self.description);
        screen
    }
}

impl crate::system::System {
    /// The screen made `width` by `height`, a WinBox screen over the display
    /// mode (`Display::at_resolution`): for the native front end's
    /// `--resolution` and seamless mode alone, before the program starts and
    /// the screen is first drawn. Nothing that runs a probe, the corpus or a
    /// session calls it.
    pub fn set_screen_size(&mut self, width: i16, height: i16) {
        debug_assert!(self.screen.is_none(), "the screen sized before it is made");
        self.display = self.display.at_resolution(width, height);
        self.screen = None;
    }
}

/// Metrics by `SM_` index, and the default colours by `COLOR_` index.
pub type Oembin = (Vec<(i16, i16)>, Vec<u32>);

/// What USER takes from its display driver's `OEMBIN` 1 as it starts
/// (`USER.EXE` seg3 `0c9f`-`0ee2`, into its metrics at `1446`-`14f3`): by
/// `SM_` index, the thumbs' sizes (+0, +2), the icon's and the cursor's
/// (+4 to +A: as they are where the first is above 10, else 64 and 32
/// divided by them), the Kanji window's height (+C) and the border's (+E,
/// +10), the dialog frame four borders; and the 19 default colours from
/// +12, `COLOR_INACTIVECAPTIONTEXT` black and `COLOR_BTNHIGHLIGHT` white
/// after them. None for a resource too short to hold them, or a divisor of
/// nought, on which USER would fault.
pub fn oembin_values(data: &[u8]) -> Option<Oembin> {
    if data.len() < 18 + 19 * 4 {
        return None;
    }

    let word = |at: usize| i16::from_le_bytes([data[at], data[at + 1]]);
    let sizes = [word(4), word(6), word(8), word(10)];
    let (icon_x, icon_y, cursor_x, cursor_y) = if sizes[0] > 10 {
        (sizes[0], sizes[1], sizes[2], sizes[3])
    } else {
        if sizes.contains(&0) {
            return None;
        }

        (64 / sizes[0], 64 / sizes[1], 32 / sizes[2], 32 / sizes[3])
    };
    let (border_x, border_y) = (word(14), word(16));
    let metrics = vec![
        (5, border_x),
        (6, border_y),
        (7, border_x.wrapping_mul(4)),
        (8, border_y.wrapping_mul(4)),
        (9, word(0)),
        (10, word(2)),
        (11, icon_x),
        (12, icon_y),
        (13, cursor_x),
        (14, cursor_y),
        (18, word(12)),
    ];
    let mut colours: Vec<u32> = data[18..18 + 19 * 4]
        .chunks_exact(4)
        .map(|colour| u32::from_le_bytes([colour[0], colour[1], colour[2], colour[3]]))
        .collect();

    colours.extend([0x0000_0000, 0x00ff_ffff]);
    Some((metrics, colours))
}

impl crate::system::System {
    /// The display driver's `OEMBIN` 1 taken into the display's metrics and
    /// default colours, as USER takes it as it starts, once: from the
    /// driver's file in the system directory, the resource numbered 1. USER
    /// asks the driver's `GetDriverResourceID` (ordinal 450) for the number
    /// where it has one; of the drivers here only `SVGA256.DRV` has, and it
    /// answers 1 at the 96 dots an inch the 256-colour display runs at, 2001
    /// only at 120 (`SVGA256.DRV` seg1 `2d6e`). Without the file the
    /// recorded tables stand, which agree with it on every display
    /// (`drvres`). See `kb/topics/display-driver-resources.md`.
    pub fn take_display_oembin(&mut self) {
        if self.oembin_taken {
            return;
        }

        self.oembin_taken = true;

        let driver = self.display.driver_file.clone();
        let Some((_, bytes)) = self.files.read_from("C:\\WINDOWS\\SYSTEM", &driver) else {
            return;
        };
        let Ok(executable) = winbox_ne::Executable::parse(bytes) else {
            return;
        };
        let Some(data) = executable
            .resources
            .iter()
            .filter(|kind| matches!(&kind.id, winbox_ne::ResourceId::Name(name) if name.eq_ignore_ascii_case("OEMBIN")))
            .flat_map(|kind| &kind.entries)
            .find(|resource| resource.id == winbox_ne::ResourceId::Number(1))
            .map(|resource| executable.resource_bytes(resource))
        else {
            return;
        };
        let Some((metrics, colours)) = oembin_values(data) else {
            return;
        };

        for (index, value) in metrics {
            self.display
                .metrics_by_index
                .insert(index.to_string(), value);
        }

        self.display.sys_colors = colours;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_vga_as_recorded() {
        let vga = mode("vga").unwrap();

        assert_eq!((vga.width, vga.height), (640, 480));
        assert_eq!(vga.metrics.caption_height, 20);
        assert_eq!(vga.metrics_by_index["2"], 17);
        assert!(modes().len() >= 6);
    }

    #[test]
    fn svga256s_three_tables_come_out_at_their_sizes() {
        let vga256 = mode("vga256").unwrap();

        // The recorded table is the driver's 640 by 480 one.
        assert_eq!(vga256.caps.mapping_extents, SVGA256_TABLES[0].1.to_vec());

        for ((width, height), table) in SVGA256_TABLES {
            let screen = vga256.at_resolution(width, height);

            assert_eq!(screen.caps.mapping_extents, table.to_vec());
            assert_eq!((screen.width, screen.height), (width, height));
            assert_eq!(
                (
                    screen.caps.width_millimetres,
                    screen.caps.height_millimetres
                ),
                (208, 156)
            );
            assert_eq!(screen.caps.logical_pixels_x, 96);
        }
    }

    #[test]
    fn the_derivation_gives_the_drivers_tables_but_one_rounding() {
        let base = SVGA256_TABLES[0].1;

        assert_eq!(
            derived_extents(&base, (640, 480), (800, 600)),
            SVGA256_TABLES[1].1.to_vec()
        );

        // 254 scaled to 1024 is 406.4; the driver's table has 407.
        let mut large = SVGA256_TABLES[2].1;

        large[2] = [325, 325, 406, -406];
        assert_eq!(derived_extents(&base, (640, 480), (1024, 768)), large);
        assert_eq!(derived_extents(&base, (640, 480), (640, 480)), base);
    }

    #[test]
    fn a_host_sized_screen_scales_each_way_alone() {
        let vga = mode("vga").unwrap();
        let screen = vga.at_resolution(1920, 1032);

        assert_eq!((screen.width, screen.height), (1920, 1032));
        assert_eq!(
            screen.caps.mapping_extents,
            vec![
                [2080, 1560, 1920, -1032],
                [20800, 15600, 1920, -1032],
                // 254 x 3 = 762; 254 x 1032 / 480 = 546.1.
                [325, 325, 762, -546],
                [1625, 1625, 381, -273],
                [2340, 2340, 381, -273],
            ]
        );
        assert!(screen.description.starts_with("WinBox screen, 1920x1032"));
        // Held to the most, and to a pixel.
        let held = vga.at_resolution(20000, 0);

        assert_eq!((held.width, held.height), (SCREEN_MOST, 1));
        // The 8514/a's large English viewport brought back within a word.
        let large = mode("8514").unwrap().at_resolution(16383, 12287);

        assert!(
            large
                .caps
                .mapping_extents
                .iter()
                .all(|[wex, wey, vex, vey]| {
                    [wex, wey, vex, vey]
                        .iter()
                        .all(|n| (1..=32767).contains(&n.abs()))
                })
        );
        // 4064 x 16383 / 1024 = 65020, over 2: 2188 on 32510.
        assert_eq!(large.caps.mapping_extents[2][0], 2188);
        assert_eq!(large.caps.mapping_extents[2][2], 32510);
    }

    #[test]
    fn takes_the_ega_drivers_oembin_as_user_does() {
        // `EGA.DRV`'s `OEMBIN` 1: the thumbs 14 and 18, divisors 2, 2, 1
        // and 1, no Kanji window, borders of 1; then its 19 colours.
        let mut data = Vec::new();

        for word in [14i16, 18, 2, 2, 1, 1, 0, 1, 1] {
            data.extend(word.to_le_bytes());
        }

        for colour in 0..19u32 {
            data.extend((0x0010_0000 + colour).to_le_bytes());
        }

        let (metrics, colours) = oembin_values(&data).unwrap();

        assert!(metrics.contains(&(9, 14)));
        assert!(metrics.contains(&(10, 18)));
        assert!(metrics.contains(&(11, 32)));
        assert!(metrics.contains(&(13, 32)));
        assert!(metrics.contains(&(7, 4)));
        assert_eq!(colours.len(), 21);
        assert_eq!(colours[18], 0x0010_0012);
        assert_eq!(&colours[19..], &[0, 0x00ff_ffff]);
    }
}
