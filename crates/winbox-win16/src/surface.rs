//! Where a device context's drawing lands, as winbox.js's surfaces have it:
//! the screen's pixels, made with the raster desktop at the display's depth
//! and in its palette; a memory context's selected bitmap; or a window's,
//! a view of the whole screen from the context's origin, drawn through its
//! region alone (`kb/topics/visible-regions.md`, phase 3).

use std::rc::Rc;

use winbox_raster::colour_match::DisplayKind;
use winbox_raster::{ClipRegion, DeviceBitmap, DevicePalette, palette_for_display};

use crate::gdi::GdiObject;
use crate::gdi::dc::{DcBitmap, origin_of};
use crate::system::System;
use crate::window_vis::{DCX_USESTYLE, DCX_WINDOW};

impl System {
    /// The display's kind, as its driver picks colours.
    pub fn display_kind(&self) -> DisplayKind {
        DisplayKind {
            colors: self.display.colors,
            ega: self.display.palette.as_deref() == Some("ega"),
            ibm: self.display.palette.as_deref() == Some("8514"),
        }
    }

    /// The screen's pixels: off the page, indexed at the display's depth
    /// like every other device context's, made the first time they are
    /// wanted. Another handle on them, which draws on them.
    ///
    /// They start at index nought; the
    /// raster desktop paints its background over them as it is made.
    pub fn screen_bitmap(&mut self) -> DeviceBitmap {
        if let Some(screen) = &self.screen {
            return screen.clone();
        }

        let kind = self.display_kind();
        let depth = DevicePalette::depth_of(self.display.colors);
        let (width, height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );
        let mut screen = DeviceBitmap::new(
            width,
            height,
            depth,
            None,
            Some(palette_for_display(kind, None)),
        );

        screen.context.display = Some(kind);
        self.screen = Some(screen.clone());
        screen
    }

    /// A window's client area on the screen, drawn only where it shows,
    /// as USER draws on it itself.
    pub fn window_view(&mut self, index: usize) -> Option<DeviceBitmap> {
        let window = self.windows[index].as_ref()?;
        let (left, top, width, height) = (
            window.client.left,
            window.client.top,
            window.client_width(),
            window.client_height(),
        );

        self.window_part(index, left, top, width, height, true)
    }

    /// A view of the screen over part of a window, `left, top` from its
    /// corner, for USER's own drawing: drawn only within the window's
    /// region by USER's rule -- its client area's, with `DCX_USESTYLE`, or
    /// its whole rectangle's, with `DCX_WINDOW` too, as `GetDC` and
    /// `GetWindowDC` work them out (`window_vis`) -- and while it paints,
    /// with `clipped`, only within what it paints.
    /// A frame is drawn unclipped: a paint's clip is the client area's.
    pub fn window_part(
        &mut self,
        index: usize,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
        clipped: bool,
    ) -> Option<DeviceBitmap> {
        let screen = self.screen_bitmap();
        let window = self.windows[index].as_ref()?;
        let (x0, y0) = (window.left + left, window.top + top);
        // The whole window where the part is all of it -- a minimized
        // window's client area is its whole rectangle too -- else its
        // client area.
        let whole = left == 0 && top == 0 && width == window.width && height == window.height;
        let (paint_clip, paint_shape) = if clipped {
            (window.paint_clip, window.paint_shape.clone())
        } else {
            (None, None)
        };
        let asked = if whole {
            DCX_USESTYLE | DCX_WINDOW
        } else {
            DCX_USESTYLE
        };
        let (flags, of) = self.region_flags(index, asked);
        let mut region = self.window_region(index, of, flags);

        if let Some([l, t, r, b]) = paint_clip {
            region = region.intersect(&ClipRegion::rect(l, t, r, b));
        }

        if let Some(shape) = &paint_shape {
            region = region.intersect(shape);
        }

        let region = region.offset(-x0, -y0);

        Some(DeviceBitmap::view(
            &screen,
            x0,
            y0,
            width,
            height,
            Some(Rc::new(move |x, y| region.contains(x, y))),
        ))
    }

    /// A device context's view of the whole screen, from its origin --
    /// `SetDCOrg`'s, else its window's corner -- as large as the window's
    /// client area, or the whole window's for `Whole`: what it draws is
    /// kept to its region by GDI (`gdi::draw::canvas`), and nothing else
    /// (`kb/topics/visible-regions.md`, decision 2).
    fn dc_view(&mut self, dc: usize, index: usize, whole: bool) -> Option<DeviceBitmap> {
        let screen = self.screen_bitmap();
        let window = self.windows[index].as_ref()?;
        let (width, height) = if whole {
            (window.width, window.height)
        } else {
            (window.client_width(), window.client_height())
        };
        let origin = origin_of(self, dc);

        Some(DeviceBitmap::screen_view(&screen, origin, width, height))
    }

    /// The pixels a device context draws on, by its index: its selected
    /// bitmap's, the screen's, or its window's client area's.
    pub fn draw_target(&mut self, dc: usize) -> Option<DeviceBitmap> {
        match self.gdi.dcs[dc].bitmap {
            DcBitmap::Screen => Some(self.screen_bitmap()),
            DcBitmap::Window(index) => self.dc_view(dc, index, false),
            DcBitmap::Whole(index) => self.dc_view(dc, index, true),
            DcBitmap::Bitmap(object) => match &self.gdi.objects[object] {
                GdiObject::Bitmap(bitmap) => Some(bitmap.pixels.clone()),
                _ => None,
            },
        }
    }
}
