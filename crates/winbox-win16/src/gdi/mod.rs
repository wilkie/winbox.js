//! GDI's objects and device contexts, as state: the pens, brushes, stock
//! fonts and palette a program makes and selects, and what a device context
//! keeps -- its colours and modes, its mapping, its current position, and
//! what `SaveDC` saves. What is drawn is `draw`, `shapes`, `regions` and
//! `brushes`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

pub mod bitmaps;
pub mod brushes;
pub mod dc;
pub mod ddb;
pub mod dib;
pub mod draw;
pub mod heap;
pub mod mapping;
pub mod objects;
pub mod palettes;
pub mod regions;
pub mod shapes;
pub mod text;
pub mod text_out;

use std::collections::HashMap;

use serde::Deserialize;
use winbox_raster::DevicePalette;
use winbox_raster::colour_match::{DisplayKind, matched_index};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub use dc::{Dc, DcBitmap, DcState};
pub use mapping::Mapping;
pub use objects::{Brush, Font, GdiObject, LogBrush, LogPen, Palette, Pen};

/// What GDI keeps.
#[derive(Debug, Clone, Default)]
pub struct Gdi {
    /// Every object made, by index, whether a handle still stands for it or
    /// not: a device context's own first pen and brush have none.
    pub objects: Vec<GdiObject>,
    /// Every device context made, by index.
    pub dcs: Vec<Dc>,
    /// The stock objects given out, by their index.
    pub stock: HashMap<i16, u16>,
    /// The stock palette's handle, once made: made once, and answered after
    /// whether or not it has been deleted.
    pub default_palette: Option<u16>,
    /// The screen's device context, made the first time one is asked for:
    /// `CreateDC("DISPLAY")` gives a new handle for it each time.
    pub screen: Option<usize>,
    /// The selector standing for GDI's data segment, once made.
    pub data: Option<u16>,
}

/// What the display driver says of itself, beside the screen's size and
/// colours: `GetDeviceCaps`'s answers, and the fixed mapping modes'
/// extents.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceCaps {
    pub driver_version: i32,
    pub technology: i32,
    pub width_millimetres: i32,
    pub height_millimetres: i32,
    pub num_colors: Option<i32>,
    pub num_brushes: i32,
    pub num_pens: i32,
    pub num_markers: i32,
    pub num_fonts: i32,
    pub curve_caps: i32,
    pub line_caps: i32,
    pub polygonal_caps: i32,
    pub text_caps: i32,
    pub clip_caps: i32,
    pub raster_caps: i32,
    pub aspect_x: i32,
    pub aspect_y: i32,
    #[serde(rename = "aspectXY")]
    pub aspect_xy: i32,
    pub logical_pixels_x: i32,
    pub logical_pixels_y: i32,
    pub size_palette: i32,
    pub num_reserved: i32,
    pub color_res: i32,
    /// `MM_LOMETRIC` to `MM_TWIPS`: the window's extents and the
    /// viewport's, as the driver gives them.
    pub mapping_extents: Vec<[i32; 4]>,
}

// A table of every call answered here, one line each.
#[allow(clippy::too_many_lines)]
pub fn implementation(name: &str) -> Option<Implementation> {
    if name == "RealizePalette" {
        return Some(Implementation::Async(palettes::realize_palette));
    }

    Some(Implementation::Sync(match name {
        "GetStockObject" => objects::get_stock_object_call,
        "CreateSolidBrush" => objects::create_solid_brush_call,
        "CreateBrushIndirect" => objects::create_brush_indirect,
        "CreateHatchBrush" => objects::create_hatch_brush,
        "CreatePen" => objects::create_pen_call,
        "CreatePenIndirect" => objects::create_pen_indirect,
        "CreateFont" => objects::create_font_call,
        "CreateFontIndirect" => objects::create_font_indirect_call,
        "DeleteObject" => objects::delete_object_call,
        "GetObject" => objects::get_object_call,
        "UnrealizeObject" => objects::unrealize_object,
        "IsGDIObject" => objects::is_gdi_object_call,
        "SetObjectOwner" => objects::set_object_owner,
        "CreateCompatibleDC" => dc::create_compatible_dc_call,
        "CreateDC" | "CreateIC" => dc::create_dc_call,
        "DeleteDC" => dc::delete_dc_call,
        "SaveDC" => dc::save_dc_call,
        "RestoreDC" => dc::restore_dc_call,
        "SelectObject" => dc::select_object_call,
        "SetBkColor" => dc::set_bk_color_call,
        "GetBkColor" => dc::get_bk_color_call,
        "SetBkMode" => dc::set_bk_mode_call,
        "GetBkMode" => dc::get_bk_mode_call,
        "SetTextColor" => dc::set_text_color_call,
        "GetTextColor" => dc::get_text_color_call,
        "SetRop2" => dc::set_rop2_call,
        "GetRop2" => dc::get_rop2_call,
        "SetTextAlign" => dc::set_text_align_call,
        "GetTextAlign" => dc::get_text_align_call,
        "SetPolyFillMode" => dc::set_poly_fill_mode_call,
        "GetPolyFillMode" => dc::get_poly_fill_mode_call,
        "SetStretchBltMode" => dc::set_stretch_blt_mode_call,
        "GetStretchBltMode" => dc::get_stretch_blt_mode_call,
        "SetTextCharacterExtra" => dc::set_text_character_extra_call,
        "GetTextCharacterExtra" => dc::get_text_character_extra_call,
        "SetBrushOrg" => dc::set_brush_org_call,
        "GetBrushOrg" => dc::get_brush_org_call,
        "GetBrushOrgEx" => dc::get_brush_org_ex_call,
        "MoveTo" => dc::move_to_call,
        "MoveToEx" => dc::move_to_ex_call,
        "GetCurrentPosition" => dc::get_current_position_call,
        "GetCurrentPositionEx" => dc::get_current_position_ex_call,
        "GetDCOrg" => dc::get_dc_org_call,
        "SetMapperFlags" => dc::set_mapper_flags_call,
        "GetAspectRatioFilter" => dc::get_aspect_ratio_filter_call,
        "GetAspectRatioFilterEx" => dc::get_aspect_ratio_filter_ex_call,
        "SetMapMode" => mapping::set_map_mode_call,
        "GetMapMode" => mapping::get_map_mode_call,
        "SetWindowOrg" => mapping::set_window_org_call,
        "SetViewportOrg" => mapping::set_viewport_org_call,
        "OffsetWindowOrg" => mapping::offset_window_org_call,
        "OffsetViewportOrg" => mapping::offset_viewport_org_call,
        "SetWindowExt" => mapping::set_window_ext_call,
        "SetViewportExt" => mapping::set_viewport_ext_call,
        "ScaleWindowExt" => mapping::scale_window_ext_call,
        "ScaleViewportExt" => mapping::scale_viewport_ext_call,
        "GetWindowOrg" => mapping::get_window_org_call,
        "GetWindowExt" => mapping::get_window_ext_call,
        "GetViewportOrg" => mapping::get_viewport_org_call,
        "GetViewportExt" => mapping::get_viewport_ext_call,
        "SetWindowOrgEx" => mapping::set_window_org_ex_call,
        "SetViewportOrgEx" => mapping::set_viewport_org_ex_call,
        "OffsetWindowOrgEx" => mapping::offset_window_org_ex_call,
        "OffsetViewportOrgEx" => mapping::offset_viewport_org_ex_call,
        "SetWindowExtEx" => mapping::set_window_ext_ex_call,
        "SetViewportExtEx" => mapping::set_viewport_ext_ex_call,
        "ScaleWindowExtEx" => mapping::scale_window_ext_ex_call,
        "ScaleViewportExtEx" => mapping::scale_viewport_ext_ex_call,
        "GetWindowOrgEx" => mapping::get_window_org_ex_call,
        "GetWindowExtEx" => mapping::get_window_ext_ex_call,
        "GetViewportOrgEx" => mapping::get_viewport_org_ex_call,
        "GetViewportExtEx" => mapping::get_viewport_ext_ex_call,
        "LPToDP" => mapping::lp_to_dp_call,
        "DPToLP" => mapping::dp_to_lp_call,
        "GetDeviceCaps" => get_device_caps_call,
        "GetNearestColor" => get_nearest_color_call,
        "CreatePalette" => palettes::create_palette,
        "GetRasterizerCaps" => palettes::get_rasterizer_caps,
        "GetPaletteEntries" => palettes::get_palette_entries,
        "SetPaletteEntries" => palettes::set_palette_entries,
        "ResizePalette" => palettes::resize_palette,
        "GetNearestPaletteIndex" => palettes::get_nearest_palette_index,
        "SelectPalette" => palettes::select_palette,
        "AnimatePalette" => palettes::animate_palette,
        "GetSystemPaletteEntries" => palettes::get_system_palette_entries,
        "GetSystemPaletteUse" => palettes::get_system_palette_use,
        "SetSystemPaletteUse" => palettes::set_system_palette_use,
        "CreateBitmap" => bitmaps::create_bitmap_call,
        "CreateBitmapIndirect" => bitmaps::create_bitmap_indirect,
        "CreateCompatibleBitmap" | "CreateDiscardableBitmap" => {
            bitmaps::create_compatible_bitmap_call
        }
        "GetBitmapBits" => bitmaps::get_bitmap_bits_call,
        "SetBitmapBits" => bitmaps::set_bitmap_bits_call,
        "GetBitmapDimension" => bitmaps::get_bitmap_dimension,
        "SetBitmapDimension" => bitmaps::set_bitmap_dimension_call,
        "GetBitmapDimensionEx" => bitmaps::get_bitmap_dimension_ex,
        "SetBitmapDimensionEx" => bitmaps::set_bitmap_dimension_ex,
        "CreateDIBitmap" => dib::create_dibitmap_call,
        "GetDIBits" => dib::get_dibits_call,
        "SetDIBits" => dib::set_dibits_call,
        _ => {
            return draw::implementation(name)
                .or_else(|| text::implementation(name))
                .or_else(|| text_out::implementation(name));
        }
    }))
}

/// A `COLORREF` and a `POINT` or `SIZE` packed in a doubleword: x, or red,
/// in the low word.
pub(crate) fn pack(low: i64, high: i64) -> u32 {
    (low as u32 & 0xffff) | (high as u32 & 0xffff) << 16
}

/// A doubleword put at a far pointer, where there is one.
pub(crate) fn put_dword(system: &mut System, far: u32, value: u32) {
    if far != 0 {
        system.write_far(far, &value.to_le_bytes());
    }
}

const DRIVERVERSION: i16 = 0;
const TECHNOLOGY: i16 = 2;
const HORZSIZE: i16 = 4;
const VERTSIZE: i16 = 6;
const HORZRES: i16 = 8;
const VERTRES: i16 = 10;
const BITSPIXEL: i16 = 12;
const PLANES: i16 = 14;
const NUMBRUSHES: i16 = 16;
const NUMPENS: i16 = 18;
const NUMMARKERS: i16 = 20;
const NUMFONTS: i16 = 22;
const NUMCOLORS: i16 = 24;
const CURVECAPS: i16 = 28;
const LINECAPS: i16 = 30;
const POLYGONALCAPS: i16 = 32;
const TEXTCAPS: i16 = 34;
const CLIPCAPS: i16 = 36;
const RASTERCAPS: i16 = 38;
const ASPECTX: i16 = 40;
const ASPECTY: i16 = 42;
const ASPECTXY: i16 = 44;
const LOGPIXELSX: i16 = 88;
const LOGPIXELSY: i16 = 90;
const SIZEPALETTE: i16 = 104;
const NUMRESERVED: i16 = 106;
const COLORRES: i16 = 108;

/// A capability of the device, as its display driver answers it.
///
/// Every answer here belongs to the display driver rather than to Windows,
/// and programs act on them: a dialog is sized from `LOGPIXELSY`, a bitmap
/// is built for the depth `BITSPIXEL` and `PLANES` describe, and a circle
/// comes out round only if `ASPECTX` and `ASPECTY` were believed. The
/// numbers are the display mode's, recorded from real Windows where that
/// was possible. The device context is not looked at: the display is the
/// only device here. (The TypeScript engine's printer, with capabilities of
/// its own, is not.)
pub fn get_device_caps(system: &System, hdc: u16, capability: i16) -> u16 {
    let display = &system.display;
    let caps = &display.caps;
    // WinG's device context: its driver's own depth, colours and raster
    // capabilities, the display's else (`wingapi`).
    let wing = dc::dc_of(system, hdc).is_some_and(|dc| system.gdi.dcs[dc].wing);

    if wing {
        let (bits, planes, colours, raster) = crate::wing::WING_CAPS;

        match capability {
            BITSPIXEL => return bits as u16,
            PLANES => return planes as u16,
            NUMCOLORS => return colours as u16,
            RASTERCAPS => return raster as u16,
            _ => {}
        }
    }

    let value = match capability {
        DRIVERVERSION => caps.driver_version,
        TECHNOLOGY => caps.technology,
        HORZSIZE => caps.width_millimetres,
        VERTSIZE => caps.height_millimetres,
        HORZRES => i32::from(display.width),
        VERTRES => i32::from(display.height),
        BITSPIXEL => i32::from(display.bits_per_pixel),
        PLANES => i32::from(display.planes),
        NUMCOLORS => caps.num_colors.unwrap_or(display.colors as i32),
        NUMBRUSHES => caps.num_brushes,
        NUMPENS => caps.num_pens,
        NUMMARKERS => caps.num_markers,
        NUMFONTS => caps.num_fonts,
        CURVECAPS => caps.curve_caps,
        LINECAPS => caps.line_caps,
        POLYGONALCAPS => caps.polygonal_caps,
        TEXTCAPS => caps.text_caps,
        CLIPCAPS => caps.clip_caps,
        RASTERCAPS => caps.raster_caps,
        ASPECTX => caps.aspect_x,
        ASPECTY => caps.aspect_y,
        ASPECTXY => caps.aspect_xy,
        LOGPIXELSX => caps.logical_pixels_x,
        LOGPIXELSY => caps.logical_pixels_y,
        SIZEPALETTE => caps.size_palette,
        NUMRESERVED => caps.num_reserved,
        COLORRES => caps.color_res,
        _ => 0,
    };

    value as u16
}

fn get_device_caps_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let capability = args.signed(system);

    Ok(Answer::Word(get_device_caps(system, hdc, capability)))
}

/// The device's palette a device context draws into: a memory context's
/// selected bitmap's -- a new one's one-by-one monochrome bitmap -- or the
/// screen's, a window's included.
fn palette_of(system: &System, bitmap: DcBitmap) -> DevicePalette {
    let display = &system.display;

    match bitmap {
        DcBitmap::Bitmap(index) => match &system.gdi.objects[index] {
            GdiObject::Bitmap(bitmap) => bitmap.pixels.device_palette.borrow().clone(),
            _ => DevicePalette::mono(),
        },
        // The screen's own, as its pixels have it -- realized palettes'
        // colours and all -- once it is made.
        DcBitmap::Screen | DcBitmap::Window(_) => match &system.screen {
            Some(screen) => screen.device_palette.borrow().clone(),
            None => DevicePalette::for_display(
                display.colors,
                display.palette.as_deref() == Some("ega"),
            ),
        },
    }
}

/// The colour the device draws a colour as, when it is a pen's or text's:
/// one of the device's own, chosen as its display driver chooses. For the
/// screen that is one of the display's colours; for a monochrome bitmap,
/// black or white. See `matched_index` for how, which is not by nearness.
/// `CLR_INVALID` for no device context.
///
/// A palette's colour realized on the 256-colour display is its slot's
/// (`palreal`); there are no logical palettes but the stock one here yet,
/// and none is realized, so a colour is always matched by its parts.
pub fn get_nearest_color(system: &System, hdc: u16, colorref: u32) -> u32 {
    let Some(index) = dc::dc_of(system, hdc) else {
        return 0xffff_ffff;
    };
    let mut palette = palette_of(system, system.gdi.dcs[index].bitmap);
    let display = &system.display;
    let [red, green, blue, _] = colorref.to_le_bytes();
    // A palette's colour, realized on the 256-colour display, is its
    // slot's (`palreal`).
    let shared = std::rc::Rc::new(std::cell::RefCell::new(palette.clone()));
    let named = draw::dc_colour(system, index, &shared, colorref);

    if let Some(slot) = named.slot
        && palette.size() == 256
    {
        return palette.colorref(slot);
    }

    let matched = matched_index(
        DisplayKind {
            colors: display.colors,
            ega: display.palette.as_deref() == Some("ega"),
        },
        &mut palette,
        red,
        green,
        blue,
    );

    palette.colorref(matched)
}

fn get_nearest_color_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let colorref = args.dword(system);

    Ok(Answer::Dword(get_nearest_color(system, hdc, colorref)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_the_display_drivers_capabilities() {
        let system = System::new();

        assert_eq!(get_device_caps(&system, 0, HORZRES), 640);
        assert_eq!(get_device_caps(&system, 0, VERTRES), 480);
        assert_eq!(get_device_caps(&system, 0, PLANES), 4);
        assert_eq!(get_device_caps(&system, 0, BITSPIXEL), 1);
        assert_eq!(get_device_caps(&system, 0, NUMCOLORS), 16);
        assert_eq!(get_device_caps(&system, 0, LOGPIXELSY), 96);
        assert_eq!(get_device_caps(&system, 0, ASPECTXY), 51);
        assert_eq!(get_device_caps(&system, 0, RASTERCAPS), 18137);
        assert_eq!(get_device_caps(&system, 0, NUMBRUSHES), 0xffff);
        assert_eq!(get_device_caps(&system, 0, DRIVERVERSION), 0x30a);
        assert_eq!(get_device_caps(&system, 0, 26), 0);
    }

    #[test]
    fn matches_a_colour_as_the_device_draws_it() {
        let mut system = System::new();
        let memory = dc::create_compatible_dc(&mut system, 0);
        let screen = dc::create_dc(&mut system, b"DISPLAY").unwrap();

        // The screen's sixteen colours; a memory context's black and white.
        assert_eq!(get_nearest_color(&system, screen, 0x0000_80c0), 0x0000_ffff);
        assert_eq!(get_nearest_color(&system, screen, 0x00c0_c0c0), 0x00c0_c0c0);
        assert_eq!(get_nearest_color(&system, memory, 0x00c0_c0c0), 0x00ff_ffff);
        assert_eq!(get_nearest_color(&system, memory, 0x0080_8080), 0);
        assert_eq!(get_nearest_color(&system, 0x1234, 0), 0xffff_ffff);
    }
}
