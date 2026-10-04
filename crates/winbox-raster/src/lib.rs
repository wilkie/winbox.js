//! Windows 3.1's pixels, as winbox.js's raster layer draws them: a
//! display's palette, icons and cursors, and, as the engine grows, the
//! rest of what GDI and USER draw.

pub mod color;
pub mod colour_match;
pub mod device_bitmap;
pub mod device_palette;
pub mod dib;
pub mod icon;
pub mod indexed_context;
pub mod palette_colour;
pub mod raster_op;

pub use color::Color;
pub use colour_match::{DisplayKind, matched_index, nearest_static};
pub use device_bitmap::{DeviceBitmap, palette_for_depth, palette_for_display};
pub use device_palette::DevicePalette;
pub use dib::{Dib, decode_dib, dib_to_device};
pub use icon::{
    CursorImage, IconData, IconEntry, decode_cursor, decode_icon, icon_entries, pick_icon,
    scale_icon,
};
pub use indexed_context::{IndexedContext, SharedPalette};
