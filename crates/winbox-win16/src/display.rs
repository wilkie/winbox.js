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
