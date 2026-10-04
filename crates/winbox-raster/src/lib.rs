//! Windows 3.1's pixels, as winbox.js's raster layer draws them: a
//! display's palette, icons and cursors, and, as the engine grows, the
//! rest of what GDI and USER draw.

pub mod bitmap_font;
pub mod clip_region;
pub mod color;
pub mod colour_match;
pub mod device_bitmap;
pub mod device_palette;
pub mod dib;
pub mod font_resource;
pub mod icon;
pub mod indexed_context;
pub mod logical_font;
pub mod palette_colour;
pub mod raster_op;

pub use bitmap_font::{BitmapFontEntry, CharacterEntry, FontHeader, Measure, read_bitmap_font};
pub use clip_region::ClipRegion;
pub use color::Color;
pub use colour_match::{DisplayKind, matched_index, nearest_static};
pub use device_bitmap::{DeviceBitmap, palette_for_depth, palette_for_display};
pub use device_palette::DevicePalette;
pub use dib::{Dib, decode_dib, dib_to_device};
pub use font_resource::{FontResource, read_font_resource};
pub use icon::{
    CursorImage, IconData, IconEntry, decode_cursor, decode_icon, icon_entries, pick_icon,
    scale_icon,
};
pub use indexed_context::{IndexedContext, SharedPalette};
pub use logical_font::{LogicalFont, Style};
