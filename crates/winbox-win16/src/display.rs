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
}
