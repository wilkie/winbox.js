//! Where a device context's drawing lands, as winbox.js's surfaces have it:
//! the screen's pixels, made with the raster desktop at the display's depth
//! and in its palette; a memory context's selected bitmap; or a window's
//! client area, a view of the screen drawn only where the window shows
//! (`desktop.ts`, `#view`).

use std::rc::Rc;

use winbox_raster::colour_match::DisplayKind;
use winbox_raster::{ClipRegion, DeviceBitmap, DevicePalette, palette_for_display};

use crate::gdi::GdiObject;
use crate::gdi::dc::DcBitmap;
use crate::system::System;

const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;

/// What a window's view of the screen knows of the desktop, taken as the
/// view is made: what it is clipped by.
struct ViewClip {
    owners: Rc<Vec<u16>>,
    /// Each window's parent, by index; for those destroyed, none.
    parents: Vec<Option<usize>>,
    index: usize,
    x0: i32,
    y0: i32,
    width: i32,
    height: i32,
    paint_clip: Option<[i32; 4]>,
    paint_shape: Option<ClipRegion>,
    clip_rect: [i32; 4],
    showing: bool,
    style: u32,
    parent: Option<usize>,
}

impl ViewClip {
    /// Whether the window draws at a pixel of its view: on the screen,
    /// within what it paints while it paints, and where it shows -- or where
    /// a child of its own or, without `WS_CLIPSIBLINGS`, a sibling above it
    /// shows (`groupbox`).
    fn allows(&self, x: i32, y: i32) -> bool {
        let (sx, sy) = (self.x0 + x, self.y0 + y);

        if sx < 0 || sy < 0 || sx >= self.width || sy >= self.height {
            return false;
        }

        if let Some(clip) = self.paint_clip
            && (sx < clip[0] || sy < clip[1] || sx >= clip[2] || sy >= clip[3])
        {
            return false;
        }

        if let Some(shape) = &self.paint_shape
            && !shape.contains(sx, sy)
        {
            return false;
        }

        let owner = self
            .owners
            .get((sy * self.width + sx) as usize)
            .copied()
            .unwrap_or(0);

        owner == (self.index + 1) as u16 || self.through_sibling(owner, sx, sy)
    }

    fn through_sibling(&self, owner: u16, sx: i32, sy: i32) -> bool {
        let clip = self.clip_rect;

        if owner == 0 || !self.showing {
            return false;
        }

        if sx < clip[0] || sy < clip[1] || sx >= clip[2] || sy >= clip[3] {
            return false;
        }

        let owner = usize::from(owner) - 1;
        let parent_of = |index: usize| self.parents.get(index).copied().flatten();

        // A window without `WS_CLIPCHILDREN` draws over its own children.
        if self.style & WS_CLIPCHILDREN == 0 {
            let mut other = parent_of(owner);

            while let Some(at) = other {
                if at == self.index {
                    return true;
                }

                other = parent_of(at);
            }
        }

        let Some(parent) = self.parent else {
            return false;
        };

        if self.style & WS_CLIPSIBLINGS != 0 {
            return false;
        }

        let mut other = Some(owner);

        while let Some(at) = other {
            if parent_of(at) == Some(parent) {
                return at != self.index;
            }

            other = parent_of(at);
        }

        false
    }
}

impl System {
    /// The display's kind, as its driver picks colours.
    pub fn display_kind(&self) -> DisplayKind {
        DisplayKind {
            colors: self.display.colors,
            ega: self.display.palette.as_deref() == Some("ega"),
        }
    }

    /// The screen's pixels: off the page, indexed at the display's depth
    /// like every other device context's, made the first time they are
    /// wanted. Another handle on them, which draws on them.
    pub fn screen_bitmap(&mut self) -> DeviceBitmap {
        if let Some(screen) = &self.screen {
            return screen.clone();
        }

        let kind = self.display_kind();
        let depth = DevicePalette::depth_of(self.display.colors);
        let mut screen = DeviceBitmap::new(
            i32::from(self.display.width),
            i32::from(self.display.height),
            depth,
            None,
            Some(palette_for_display(kind, None)),
        );

        screen.context.display = Some(kind);
        self.screen = Some(screen.clone());
        screen
    }

    /// A window's client area on the screen, drawn only where it shows.
    pub fn window_view(&mut self, index: usize) -> Option<DeviceBitmap> {
        let screen = self.screen_bitmap();
        let showing = self.showing(index);
        let window = self.windows[index].as_ref()?;
        let (x0, y0) = (
            window.left + window.client.left,
            window.top + window.client.top,
        );
        let clip = ViewClip {
            owners: Rc::clone(&self.owners),
            parents: self
                .windows
                .iter()
                .map(|window| window.as_ref().and_then(|window| window.parent))
                .collect(),
            index,
            x0,
            y0,
            width: screen.width(),
            height: screen.height(),
            paint_clip: window.paint_clip,
            paint_shape: window.paint_shape.clone(),
            clip_rect: window.clip_rect,
            showing,
            style: window.style,
            parent: window.parent,
        };

        Some(DeviceBitmap::view(
            &screen,
            x0,
            y0,
            window.client_width(),
            window.client_height(),
            Some(Rc::new(move |x, y| clip.allows(x, y))),
        ))
    }

    /// The pixels a device context draws on, by its index: its selected
    /// bitmap's, the screen's, or its window's client area's.
    pub fn draw_target(&mut self, dc: usize) -> Option<DeviceBitmap> {
        match self.gdi.dcs[dc].bitmap {
            DcBitmap::Screen => Some(self.screen_bitmap()),
            DcBitmap::Window(index) => self.window_view(index),
            DcBitmap::Bitmap(object) => match &self.gdi.objects[object] {
                GdiObject::Bitmap(bitmap) => Some(bitmap.pixels.clone()),
                _ => None,
            },
        }
    }
}
