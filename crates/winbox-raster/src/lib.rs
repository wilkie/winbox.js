//! Windows 3.1's pixels, as winbox.js's raster layer draws them: a
//! display's palette, icons and cursors, and, as the engine grows, the
//! rest of what GDI and USER draw.

pub mod device_palette;
pub mod icon;

pub use device_palette::DevicePalette;
pub use icon::{
    CursorImage, IconData, IconEntry, decode_cursor, decode_icon, icon_entries, pick_icon,
    scale_icon,
};
