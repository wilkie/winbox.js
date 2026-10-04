//! What the raster desktop draws itself, as winbox.js's `desktop.ts` draws
//! it: the desktop's own background, each window's frame through
//! `frame.rs`, a minimized window's icon and its title, and a window's
//! client area erased with its class's brush -- each where the window
//! shows, through a view of the screen (`surface.rs`).
//!
//! Every fill is a brush of a colour, patterned as the display's driver
//! patterns it, or a pattern brush's own eight by eight: the pattern starts
//! at the corner of what it is drawn through, or at an origin given before
//! it -- the screen's corner, for the desktop's own pattern seen through an
//! icon.

// `DrawIcon` has the signature every function that answers a call has,
// though it cannot stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_raster::dither::dither_tile;
use winbox_raster::{DeviceBitmap, IconData};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::frame::{Frame, Lettering, bytes_of, paint_frame};
use crate::gdi::GdiObject;
use crate::painter::{PaintEnv, Painter, ScrollPaint};
use crate::system::System;
use crate::windows::Placement;

pub const COLOR_BACKGROUND: usize = 1;
const COLOR_ACTIVECAPTION: usize = 2;
const COLOR_WINDOWTEXT: usize = 8;
const COLOR_CAPTIONTEXT: usize = 9;

const IDI_APPLICATION: u16 = 32512;

const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;

/// Where an icon's title's text starts in its box: a pixel in. Measured on
/// the `sizing` probe's "Probe" on four displays.
const ICON_TITLE_TEXT: i32 = 1;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "DrawIcon" => Implementation::Sync(draw_icon_call),
        _ => return None,
    })
}

/// A class's background as the desktop erases with it: a colour, whether
/// it is hollow, and a pattern brush's eight by eight as the screen's
/// indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Background {
    pub colorref: u32,
    pub hollow: bool,
    pub pattern: Option<[u8; 64]>,
}

/// A colour's red, green and blue as a `COLORREF`.
fn colorref_of(color: [u8; 4]) -> u32 {
    u32::from(color[0]) | u32::from(color[1]) << 8 | u32::from(color[2]) << 16
}

/// Fills a rectangle of `bitmap` with a brush of a colour, patterned as
/// the driver patterns it, or with a pattern of the screen's indices; the
/// pattern from `origin` before the bitmap's corner (`#fill`).
#[allow(clippy::too_many_arguments)]
pub fn fill_brush(
    system: &System,
    bitmap: &DeviceBitmap,
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    colorref: u32,
    origin: (i32, i32),
    pattern: Option<&[u8; 64]>,
) {
    let (ox, oy) = origin;
    let tile = if let Some(pattern) = pattern {
        *pattern
    } else {
        let (red, green, blue) = (
            colorref as u8,
            (colorref >> 8) as u8,
            (colorref >> 16) as u8,
        );
        let mut palette = bitmap.device_palette.borrow_mut();

        dither_tile(system.display_kind(), &mut palette, red, green, blue)
            .unwrap_or([palette.index(red, green, blue) as u8; 64])
    };

    for y in top..top + height {
        for x in left..left + width {
            bitmap.put(
                x,
                y,
                tile[((((y + oy) & 7) << 3) | ((x + ox) & 7)) as usize],
            );
        }
    }

    bitmap
        .context
        .mark_rect(left, top, left + width, top + height);
}

/// An icon drawn onto pixels through its mask: what is there kept where
/// the mask is set, and its picture exclusive-ored over that.
pub fn draw_icon_at(bitmap: &DeviceBitmap, x: i32, y: i32, icon: &IconData) {
    for row in 0..icon.height {
        for column in 0..icon.width {
            let at = row * icon.width + column;
            let (px, py) = (x + column as i32, y + row as i32);

            if let Some(beneath) = bitmap.index_at(px, py) {
                let kept = if icon.and[at] != 0 { beneath } else { 0 };

                bitmap.put(px, py, kept ^ icon.xor[at]);
            }
        }
    }

    bitmap
        .context
        .mark_rect(x, y, x + icon.width as i32, y + icon.height as i32);
}

impl System {
    /// The System font, as the desktop draws and measures in it; none
    /// before the raster desktop is made.
    pub fn system_lettering(&self) -> Option<Lettering> {
        self.desktop_font.clone().map(Lettering::of)
    }

    /// The font icon titles are in: MS Sans Serif, or the System font
    /// where there is none.
    fn title_lettering(&self) -> Option<Lettering> {
        self.title_font
            .clone()
            .or_else(|| self.desktop_font.clone())
            .map(Lettering::of)
    }

    /// A window's scroll bars' places, as its frame draws them: vertical,
    /// then horizontal; a bar no call has asked for at 0 of 0 to 100.
    pub fn frame_scroll(&self, index: usize) -> [Option<ScrollPaint>; 2] {
        let bars = self.windows[index]
            .as_ref()
            .map(|window| window.scroll_bars)
            .unwrap_or_default();

        [
            crate::control_pixels::scroll_paint(bars.vertical.as_ref()),
            crate::control_pixels::scroll_paint(bars.horizontal.as_ref()),
        ]
    }

    /// A class's background brush as the desktop erases with it:
    /// `COLOR_WINDOW + 1` and the other system colours plus one stand for
    /// the colour itself, anything else is a brush's handle. A pen, which a
    /// handle may name, erases in its colour (`raster-desktop.ts`,
    /// `backgroundOf`).
    pub fn background_of(&mut self, handle: u16) -> Option<Background> {
        if handle == 0 {
            return None;
        }

        if handle <= 21 {
            return Some(Background {
                colorref: self.sys_color(usize::from(handle - 1)),
                hollow: false,
                pattern: None,
            });
        }

        match self.gdi_object_of(handle) {
            Some((_, GdiObject::Brush(brush))) => {
                let pattern = brush.pattern.clone();

                Some(Background {
                    colorref: colorref_of(brush.color),
                    hollow: brush.color[3] == 0,
                    pattern: pattern.and_then(|pattern| self.pattern_of(&pattern)),
                })
            }
            Some((_, GdiObject::Pen(pen))) => Some(Background {
                colorref: colorref_of(pen.color),
                hollow: pen.color[3] == 0,
                pattern: None,
            }),
            _ => None,
        }
    }

    /// A pattern brush's eight by eight, as the screen's indices: a bitmap
    /// of the screen's depth as it is, a monochrome one black and white, as
    /// a new device context's colours make it. Roulette's table is a
    /// pattern of green and grey rows, which its window's background showed
    /// as green.
    fn pattern_of(&mut self, pattern: &winbox_raster::blit::Pattern) -> Option<[u8; 64]> {
        let screen = self.screen_bitmap();

        if pattern.depth == screen.depth {
            return Some(pattern.indices);
        }

        if pattern.depth == 1 {
            let mut palette = screen.device_palette.borrow_mut();
            let black = palette.index(0, 0, 0) as u8;
            let white = palette.index(255, 255, 255) as u8;

            return Some(
                pattern
                    .indices
                    .map(|index| if index != 0 { white } else { black }),
            );
        }

        None
    }

    /// Paints a window's frame, where the window shows: a minimized
    /// window's icon and its title, an icon's title, or USER's frame round
    /// a window -- not held to a paint's clip, which is the client area's.
    pub fn paint_frame(&mut self, index: usize) {
        if self.windows.get(index).is_none_or(Option::is_none) || !self.showing(index) {
            return;
        }

        let (placement, title_of, icon_title) = {
            let window = self.windows[index].as_ref().expect("a window");

            (window.placement, window.title_of, window.icon_title)
        };

        if placement == Placement::Minimized {
            self.paint_icon(index);

            // Its title's colours follow its activation.
            if let Some(title) = icon_title
                && self.windows[title]
                    .as_ref()
                    .is_some_and(|title| title.visible)
            {
                self.paint_icon_title(title);
            }

            return;
        }

        if title_of.is_some() {
            self.paint_icon_title(index);
            return;
        }

        let (width, height) = {
            let window = self.windows[index].as_ref().expect("a window");

            (window.width, window.height)
        };
        let Some(whole) = self.window_part(index, 0, 0, width, height, false) else {
            return;
        };
        let Some(letters) = self.system_lettering() else {
            return;
        };
        let scroll = self.frame_scroll(index);
        let window = self.windows[index].as_ref().expect("a window");
        let frame = Frame {
            style: window.style,
            scroll,
            background: None,
            active: window.lit.unwrap_or(window.active),
            title: &window.title,
            menu: window.bar.as_deref(),
            menu_grayed: window.bar_grayed.as_deref(),
            menu_selected: None,
            system_menu_open: false,
            zoomed: window.placement == Placement::Maximized,
            modal: window.modal_frame,
        };
        let env = PaintEnv::new(self);
        let painter = Painter::new(whole, 0, 0, width, height, &env);

        paint_frame(&painter, &frame, &letters);
        self.settle_frame_tracks(index);
    }

    /// The desktop itself, where no window shows, in `COLOR_BACKGROUND`.
    pub fn paint_background(&mut self) {
        let screen = self.screen_bitmap();

        self.paint_background_in([0, 0, screen.width(), screen.height()]);
    }

    /// The desktop itself, where no window shows, within a rectangle of
    /// the screen; the pattern from the screen's corner.
    pub fn paint_background_in(&mut self, area: [i32; 4]) {
        let screen = self.screen_bitmap();
        let owners = std::rc::Rc::clone(&self.owners);
        let (width, height) = (screen.width(), screen.height());
        let desktop = DeviceBitmap::view(
            &screen,
            0,
            0,
            width,
            height,
            Some(std::rc::Rc::new(move |x, y| {
                owners.get((y * width + x) as usize).copied().unwrap_or(0) == 0
            })),
        );
        let colour = self.sys_color(COLOR_BACKGROUND);
        let [left, top, right, bottom] = area;

        fill_brush(
            self,
            &desktop,
            left,
            top,
            right - left,
            bottom - top,
            colour,
            (0, 0),
            None,
        );
    }

    /// Erases a window's client area with a brush, where it shows: the
    /// erase no longer due. Its pattern, if it has one, from `origin`, the
    /// brush's place in the client area.
    pub fn erase(
        &mut self,
        index: usize,
        colorref: u32,
        pattern: Option<[u8; 64]>,
        origin: (i32, i32),
    ) {
        let Some(window) = self.windows[index].as_mut() else {
            return;
        };

        window.needs_erase = false;

        if !self.showing(index) {
            return;
        }

        let Some(client) = self.window_view(index) else {
            return;
        };
        let (width, height) = (client.width(), client.height());

        fill_brush(
            self,
            &client,
            0,
            0,
            width,
            height,
            colorref,
            (-origin.0, -origin.1),
            pattern.as_ref(),
        );
    }

    /// An icon: its background, and the icon drawn over it through its
    /// mask.
    fn paint_icon(&mut self, index: usize) {
        self.erase_icon(index);
        self.draw_window_icon(index);
    }

    /// An icon's background, as `DefWindowProc` erases it for
    /// `WM_ICONERASEBKGND` (`USER.EXE` seg1 `5881`): a top-level window's is
    /// the desktop's, its pattern from the screen's corner. A child's is
    /// its parent's class brush -- which the TypeScript engine's desktop
    /// windows are made without, so it draws none, and nor does this.
    pub fn erase_icon(&mut self, index: usize) {
        let (width, height, left, top, parent) = {
            let Some(window) = self.windows[index].as_ref() else {
                return;
            };

            (
                window.width,
                window.height,
                window.left,
                window.top,
                window.parent,
            )
        };

        if parent.is_some() {
            return;
        }

        let Some(whole) = self.window_part(index, 0, 0, width, height, true) else {
            return;
        };
        let colour = self.sys_color(COLOR_BACKGROUND);

        fill_brush(self, &whole, 0, 0, width, height, colour, (left, top), None);
    }

    /// The icon a window of a class shows minimized, from the class's
    /// icon handle: none for nought, and `IDI_APPLICATION` -- the standard
    /// icon's own handle, as the TypeScript engine knows it by its being
    /// the driver's very object -- shown as USER's Windows flag.
    pub fn minimized_icon_of(&mut self, handle: u16) -> Option<IconData> {
        if handle == 0 {
            return None;
        }

        let icon = self.icon_of(handle)?;
        let standard = self.standard_icons.get(&IDI_APPLICATION) == Some(&handle);

        Some(match self.driver.as_ref() {
            Some(driver) if standard => driver.application_icon.clone().unwrap_or(icon),
            _ => icon,
        })
    }

    /// A window's icon drawn in the middle of it, as `DefWindowProc` draws
    /// it for `WM_PAINTICON` (seg1 `580f`): half of what the window's width
    /// and height leave around `SM_CXICON` and `SM_CYICON`.
    pub fn draw_window_icon(&mut self, index: usize) {
        let Some(window) = self.windows[index].as_ref() else {
            return;
        };
        let Some(icon) = window.icon.clone() else {
            return;
        };
        let (width, height) = (window.width, window.height);
        let Some(whole) = self.window_part(index, 0, 0, width, height, true) else {
            return;
        };
        let left = (width - self.metric(SM_CXICON)) >> 1;
        let top = (height - self.metric(SM_CYICON)) >> 1;

        draw_icon_at(&whole, left, top, &icon);
    }

    /// An icon's title: the caption's colours while its window is active,
    /// the desktop's and the window text's while it is not; its text a
    /// pixel in, in the icon title's font.
    fn paint_icon_title(&mut self, title: usize) {
        let Some(shown) = self.windows[title].as_ref() else {
            return;
        };
        let Some(owner) = shown.title_of else {
            return;
        };
        let (width, height, left, top) = (shown.width, shown.height, shown.left, shown.top);
        let Some(window) = self.windows[owner].as_ref() else {
            return;
        };
        let active = window.lit.unwrap_or(window.active);
        let text = bytes_of(&window.title);
        let Some(whole) = self.window_part(title, 0, 0, width, height, true) else {
            return;
        };
        let ground = self.sys_color(if active {
            COLOR_ACTIVECAPTION
        } else {
            COLOR_BACKGROUND
        });

        fill_brush(self, &whole, 0, 0, width, height, ground, (left, top), None);

        let ink = self.sys_color(if active {
            COLOR_CAPTIONTEXT
        } else {
            COLOR_WINDOWTEXT
        });

        if let Some(letters) = self.title_lettering() {
            letters.text(self, &whole, &text, ink, ICON_TITLE_TEXT, 0);
        }
    }
}

/// `DrawIcon`: an icon drawn with its top left at a point of a device
/// context, what is there kept through its mask and its picture
/// exclusive-ored over it. Read out of its block each time, as a program
/// may have written into it, and drawn at the display's icon size
/// (`USER.EXE` seg13 `0199`). FALSE for a handle that is no icon, or no
/// device context's.
fn draw_icon_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let hicon = args.word(system);
    let read = system.icon_of(hicon);
    let bitmap =
        crate::gdi::dc::dc_of(system, hdc).and_then(|dc| crate::gdi::draw::canvas(system, dc));
    let (Some(read), Some(bitmap)) = (read, bitmap) else {
        return Ok(Answer::Word(0));
    };
    let size = if system.raster() {
        usize::try_from(system.metric(SM_CXICON)).unwrap_or(32)
    } else {
        32
    };
    let icon = if read.width == size && read.height == size {
        read
    } else {
        winbox_raster::scale_icon(read, size)
    };

    draw_icon_at(&bitmap, x, y, &icon);
    Ok(Answer::Word(1))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::handles::{Kind, Object};
    use crate::windows::{Rect, Window};

    /// A VGA system with one window shown at the top: 200 by 120 at
    /// (40, 40), all of it client area. Its index and handle.
    pub(crate) fn one_window() -> (System, usize, u16) {
        let mut system = System::new();
        let index = system.windows.len();

        system.windows.push(Some(Window {
            left: 40,
            top: 40,
            width: 200,
            height: 120,
            client: Rect {
                left: 0,
                top: 0,
                right: 200,
                bottom: 120,
            },
            visible: true,
            ..Window::default()
        }));

        let hwnd = system
            .handles
            .allocate(Kind::Window, Object::Window(index))
            .unwrap();

        system.windows[index].as_mut().unwrap().hwnd = hwnd;
        system.z_order.push(index);
        system.own();
        (system, index, hwnd)
    }

    #[test]
    fn the_desktop_is_its_colour_where_no_window_shows() {
        let (mut system, index, _) = one_window();
        let screen = system.screen_bitmap();
        let background = system.sys_color(COLOR_BACKGROUND);
        let solid = crate::painter::solid_in(system.display_kind(), &screen, background);

        system.paint_background();

        let expected = |x: i32, y: i32| match solid {
            crate::painter::Paint::Solid(index) => index,
            crate::painter::Paint::Tile(tile) => tile[(((y & 7) << 3) | (x & 7)) as usize],
        };

        assert_eq!(screen.index_at(0, 0), Some(expected(0, 0)));
        assert_eq!(screen.index_at(639, 479), Some(expected(639, 479)));
        // Where the window shows, nothing.
        assert_eq!(screen.index_at(41, 41), Some(0));

        // Erased, the window is the colour all over, and no longer due.
        system.windows[index].as_mut().unwrap().needs_erase = true;
        system.erase(index, 0x00ff_ffff, None, (0, 0));
        assert_eq!(screen.index_at(41, 41), Some(15));
        assert_eq!(screen.index_at(239, 159), Some(15));
        assert_eq!(screen.index_at(240, 159), Some(expected(240, 159)));
        assert!(!system.windows[index].as_ref().unwrap().needs_erase);
    }

    #[test]
    fn only_the_standard_application_icon_shows_as_the_windows_flag() {
        let mut system = System::new();
        let icon = |index| IconData {
            width: 32,
            height: 32,
            xor: vec![index; 32 * 32],
            and: vec![0; 32 * 32],
        };
        let (standard, flag) = (icon(9), icon(4));

        system.driver = Some(crate::icons::DriverResources {
            icons: std::iter::once((IDI_APPLICATION, standard.clone())).collect(),
            application_icon: Some(flag.clone()),
            ..crate::icons::DriverResources::default()
        });

        let handle = system.icon_block(&standard);

        system.standard_icons.insert(IDI_APPLICATION, handle);

        // A copy of it, drawn the same, is a program's own icon.
        let copy = system.icon_block(&standard);

        assert_eq!(system.minimized_icon_of(0), None);
        assert_eq!(system.minimized_icon_of(handle), Some(flag));
        assert_eq!(system.minimized_icon_of(copy), Some(standard));
    }

    #[test]
    fn an_icon_keeps_what_is_beneath_through_its_mask() {
        let screen = DeviceBitmap::new(4, 1, 4, None, None);

        for x in 0..4 {
            screen.put(x, 0, 9);
        }

        let icon = IconData {
            width: 4,
            height: 1,
            xor: vec![0, 15, 0, 3],
            and: vec![1, 0, 0, 1],
        };

        draw_icon_at(&screen, 0, 0, &icon);
        assert_eq!(*screen.indices.borrow(), vec![9, 15, 0, 9 ^ 3]);
    }
}
