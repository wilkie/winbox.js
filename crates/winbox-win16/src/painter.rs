//! How USER paints its own parts of the screen -- frames, captions, scroll
//! bars, controls -- into a window, as winbox.js's `painter.ts` does:
//! rectangles of a system colour's brush, lines, the display driver's
//! bitmaps, and the raised boxes and scroll bars made of them. Coordinates
//! are the window's; what is outside the window is not painted, and pixels
//! that are a view of the screen clip the rest (`DeviceBitmap::view`).

use winbox_raster::DeviceBitmap;
use winbox_raster::colour_match::DisplayKind;
use winbox_raster::dither::dither_tile;
use winbox_raster::stretch::{Axis, stretch_map};

use crate::controls::ControlColours;
use crate::system::System;

pub const OBM_LFARROW: u16 = 32750;
pub const OBM_RGARROW: u16 = 32751;
pub const OBM_DNARROW: u16 = 32752;
pub const OBM_UPARROW: u16 = 32753;

// The arrows turned off, grayed (`USER.EXE` seg3 `0f4c`).
pub const OBM_LFARROWI: u16 = 32734;
pub const OBM_RGARROWI: u16 = 32735;
pub const OBM_DNARROWI: u16 = 32736;
pub const OBM_UPARROWI: u16 = 32737;

// The arrows pressed (`USER.EXE` seg3).
pub const OBM_LFARROWD: u16 = 32740;
pub const OBM_RGARROWD: u16 = 32741;
pub const OBM_DNARROWD: u16 = 32742;
pub const OBM_UPARROWD: u16 = 32743;

const SM_CYVTHUMB: i16 = 9;
const SM_CXHTHUMB: i16 = 10;
const SM_CYVSCROLL: i16 = 20;
const SM_CXHSCROLL: i16 = 21;

const COLOR_SCROLLBAR: usize = 0;
const COLOR_WINDOW: usize = 5;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_WINDOWTEXT: usize = 8;
const COLOR_BTNFACE: usize = 15;
const COLOR_BTNSHADOW: usize = 16;
const COLOR_BTNHIGHLIGHT: usize = 20;

/// What painting asks of the display: its driver, which patterns the
/// brushes, `GetSystemMetrics`, `GetSysColor` and the driver's OEM bitmaps
/// -- and, for a control, what its parent answered `WM_CTLCOLOR` with,
/// standing for the system colours it replaces (`ctlcolor.ts`).
#[derive(Debug)]
pub struct PaintEnv<'a> {
    pub system: &'a System,
    pub display: DisplayKind,
    /// A control's colours, and whether it is a scroll bar, whose brush
    /// stands for the scroll bar colour rather than the window colour.
    pub control: Option<(ControlColours, bool)>,
    /// Where a pattern starts: where the brush it stands for was realised,
    /// in the control (`brushrlz`), or the corner.
    pub pattern_origin: (i32, i32),
}

impl<'a> PaintEnv<'a> {
    pub fn new(system: &'a System) -> Self {
        Self {
            system,
            display: system.display_kind(),
            control: None,
            pattern_origin: (0, 0),
        }
    }

    /// `GetSystemMetrics`.
    pub fn metric(&self, index: i16) -> i32 {
        self.system.metric(index)
    }

    /// `GetSysColor`, as a `COLORREF`: a control's answered brush for the
    /// window colour (the scroll bar colour, for a scroll bar) and its text
    /// colour for the window's text.
    pub fn sys_color(&self, index: usize) -> u32 {
        match self.control {
            Some((colours, true)) if index == COLOR_SCROLLBAR => colours.brush,
            Some((_, true)) | None => self.system.sys_color(index),
            Some((colours, false)) => match index {
                COLOR_WINDOW => colours.brush,
                COLOR_WINDOWTEXT => colours.text,
                _ => self.system.sys_color(index),
            },
        }
    }

    /// The display driver's OEM bitmap of an id, at the screen's depth.
    pub fn oem(&self, id: u16) -> Option<&'a DeviceBitmap> {
        self.system.driver.as_ref()?.oem.get(&id)
    }
}

/// A brush: one index, or a pattern of them by screen pixel, eight by
/// eight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Paint {
    Solid(u8),
    Tile([u8; 64]),
}

/// A brush of a colour, patterned as the display driver patterns it, for
/// pixels of `bitmap`'s palette.
pub fn solid_in(display: DisplayKind, bitmap: &DeviceBitmap, colorref: u32) -> Paint {
    let (red, green, blue) = (
        colorref as u8,
        (colorref >> 8) as u8,
        (colorref >> 16) as u8,
    );
    let mut palette = bitmap.device_palette.borrow_mut();

    match dither_tile(display, &mut palette, red, green, blue) {
        Some(tile) => Paint::Tile(tile),
        None => Paint::Solid(palette.index(red, green, blue) as u8),
    }
}

/// A scroll bar's range and position, its arrows turned off (1 the top or
/// left, 2 the bottom or right), what its track shows with both off, and a
/// press on it being followed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollPaint {
    pub min: i32,
    pub max: i32,
    pub pos: i32,
    pub flags: u16,
    pub shaft: Option<u32>,
    pub track: Option<ScrollTrack>,
}

impl Default for ScrollPaint {
    fn default() -> Self {
        Self {
            min: 0,
            max: 100,
            pos: 0,
            flags: 0,
            shaft: None,
            track: None,
        }
    }
}

/// A press being followed on a scroll bar: the part, 0 to 3 for the arrows
/// and the pages as `SB_LINEUP` to `SB_PAGEDOWN` number them, or 4 for the
/// thumb; where it runs along the bar; whether it shows pressed; and a
/// dragged thumb's outline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollTrack {
    pub part: u16,
    pub start: i32,
    pub end: i32,
    pub pressed: bool,
    pub outline: Option<i32>,
}

/// A scroll bar's parts along it, from its start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollGeometry {
    pub border: i32,
    pub bitmap: i32,
    pub arrow: i32,
    pub thumb: i32,
    pub room: i32,
    pub length: i32,
    pub arrow_end: i32,
    pub down_start: i32,
    pub thumb_top: i32,
    /// Whether the thumb shows: a track at least as long as it.
    pub shows: bool,
}

/// A scroll bar's parts along it, from its start (`USER.EXE` seg18
/// `073c`): each arrow as long as its bitmap, but no longer than half the
/// bar less a border; the thumb a border back from the first arrow's inner
/// edge, moved along what is left by the position, `(pos - min) * room /
/// (max - min)` rounded half up. None for a bar with no room for its
/// arrows.
pub fn scroll_geometry(
    metric: impl Fn(i16) -> i32,
    length: i32,
    vertical: bool,
    min: i32,
    max: i32,
    pos: i32,
) -> Option<ScrollGeometry> {
    let border = 1;
    let half = (length >> 1) - border;

    if half <= 0 {
        return None;
    }

    let bitmap = metric(if vertical { SM_CYVSCROLL } else { SM_CXHSCROLL });
    let arrow = half.min(bitmap);
    let thumb = metric(if vertical { SM_CYVTHUMB } else { SM_CXHTHUMB });
    let room = length - 2 * arrow - thumb + 2 * border;
    let span = i64::from(max) - i64::from(min);
    let offset = if span == 0 {
        i64::from(pos) - i64::from(min)
    } else {
        let over = (i64::from(pos) - i64::from(min)) * i64::from(room) + (span >> 1);

        // Rounded down, as `Math.floor` rounds, whichever way the range runs.
        if (over % span != 0) && ((over < 0) != (span < 0)) {
            over / span - 1
        } else {
            over / span
        }
    } as i32;

    Some(ScrollGeometry {
        border,
        bitmap,
        arrow,
        thumb,
        room,
        length,
        arrow_end: arrow,
        down_start: length - arrow,
        thumb_top: arrow - border + offset,
        shows: length - 2 * arrow >= thumb,
    })
}

/// Paints a window's parts onto pixels: `left, top` the window's corner on
/// them, `width` by `height` what it paints.
#[derive(Debug)]
pub struct Painter<'a> {
    pub screen: DeviceBitmap,
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub env: &'a PaintEnv<'a>,
}

impl<'a> Painter<'a> {
    pub fn new(
        screen: DeviceBitmap,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
        env: &'a PaintEnv<'a>,
    ) -> Self {
        Self {
            screen,
            left,
            top,
            width,
            height,
            env,
        }
    }

    /// A brush of a colour, patterned as the display driver patterns it.
    pub fn solid(&self, colorref: u32) -> Paint {
        solid_in(self.env.display, &self.screen, colorref)
    }

    /// A brush of a system colour.
    pub fn colour(&self, system: usize) -> Paint {
        self.solid(self.env.sys_color(system))
    }

    /// Fills a rectangle, its right and bottom edges outside it: a pattern
    /// from where the brush it stands for was realised.
    pub fn fill(&self, x0: i32, y0: i32, x1: i32, y1: i32, paint: Paint) {
        let screen = &self.screen;
        let (ox, oy) = self.env.pattern_origin;

        screen
            .context
            .mark_rect(self.left + x0, self.top + y0, self.left + x1, self.top + y1);

        for y in y0.max(0)..y1.min(self.height) {
            for x in x0.max(0)..x1.min(self.width) {
                let (sx, sy) = (self.left + x, self.top + y);
                let index = match paint {
                    Paint::Solid(index) => index,
                    Paint::Tile(tile) => tile[((((sy - oy) & 7) << 3) | ((sx - ox) & 7)) as usize],
                };

                screen.put(sx, sy, index);
            }
        }
    }

    /// Inverts a rectangle: every bit of each pixel's index, as `DSTINVERT`
    /// does.
    pub fn invert(&self, x0: i32, y0: i32, x1: i32, y1: i32) {
        let screen = &self.screen;
        let mask = ((1u32 << screen.depth) - 1) as u8;

        screen
            .context
            .mark_rect(self.left + x0, self.top + y0, self.left + x1, self.top + y1);

        for y in y0.max(0)..y1.min(self.height) {
            for x in x0.max(0)..x1.min(self.width) {
                if let Some(index) = screen.index_at(self.left + x, self.top + y) {
                    screen.put(self.left + x, self.top + y, index ^ mask);
                }
            }
        }
    }

    /// A rectangle's edges, a pixel wide, inside it.
    pub fn outline(&self, x0: i32, y0: i32, x1: i32, y1: i32, paint: Paint) {
        self.fill(x0, y0, x1, y0 + 1, paint);
        self.fill(x0, y1 - 1, x1, y1, paint);
        self.fill(x0, y0, x0 + 1, y1, paint);
        self.fill(x1 - 1, y0, x1, y1, paint);
    }

    /// Part of a bitmap, from `sx, sy`, `w` by `h`, at `x, y`; each index
    /// `remap` names drawn as the paint it gives.
    #[allow(clippy::too_many_arguments)]
    pub fn blit_part(
        &self,
        bitmap: Option<&DeviceBitmap>,
        x: i32,
        y: i32,
        w: i32,
        sx: i32,
        h: i32,
        sy: i32,
        remap: &[(u8, Paint)],
    ) {
        let Some(bitmap) = bitmap else {
            return;
        };
        let indices = bitmap.indices.borrow();

        for row in 0..h.min(bitmap.height() - sy) {
            for column in 0..w.min(bitmap.width() - sx) {
                let at = ((sy + row) * bitmap.width() + sx + column) as usize;
                let index = indices.get(at).copied().unwrap_or(0);
                let paint = remap
                    .iter()
                    .find(|(from, _)| *from == index)
                    .map_or(Paint::Solid(index), |(_, paint)| *paint);

                self.fill(x + column, y + row, x + column + 1, y + row + 1, paint);
            }
        }
    }

    /// A bitmap, `w` of it across, all of it down, at `x, y`.
    pub fn blit(&self, bitmap: Option<&DeviceBitmap>, x: i32, y: i32, w: i32) {
        let h = bitmap.map_or(0, DeviceBitmap::height);

        self.blit_part(bitmap, x, y, w, 0, h, 0, &[]);
    }

    /// A bitmap scaled to `w` by `h` at `x, y`, as USER scales a scroll
    /// bar's arrows to the bar: each row and column of the result is one of
    /// the bitmap's, by `stretch_map`.
    pub fn stretch(&self, bitmap: Option<&DeviceBitmap>, x: i32, y: i32, w: i32, h: i32) {
        let Some(bitmap) = bitmap else {
            return;
        };
        let mono = bitmap.depth == 1 && self.screen.depth == 1;
        let rows = stretch_map(bitmap.height(), h, bitmap.width(), w, Axis::Rows, mono);
        let columns = stretch_map(bitmap.width(), w, bitmap.height(), h, Axis::Columns, mono);
        let indices = bitmap.indices.borrow();

        for row in 0..h {
            for column in 0..w {
                let at = rows.get(row as usize).copied().unwrap_or(0) * bitmap.width()
                    + columns.get(column as usize).copied().unwrap_or(0);
                let index = indices.get(at as usize).copied().unwrap_or(0);

                self.fill(
                    x + column,
                    y + row,
                    x + column + 1,
                    y + row + 1,
                    Paint::Solid(index),
                );
            }
        }
    }

    /// A raised box in the button face, outlined in the frame colour, lit
    /// one pixel along the top and left and shadowed two along the bottom
    /// and right: a scroll bar's thumb.
    pub fn thumb(&self, x0: i32, y0: i32, x1: i32, y1: i32) {
        let shadow = self.colour(COLOR_BTNSHADOW);
        let light = self.colour(COLOR_BTNHIGHLIGHT);

        self.fill(x0, y0, x1, y1, self.colour(COLOR_BTNFACE));
        self.fill(x0 + 1, y0 + 1, x1 - 2, y0 + 2, light);
        self.fill(x0 + 1, y0 + 1, x0 + 2, y1 - 2, light);
        self.fill(x1 - 2, y0 + 1, x1 - 1, y1 - 1, shadow);
        self.fill(x0 + 1, y1 - 2, x1 - 1, y1 - 1, shadow);
        self.fill(x1 - 3, y0 + 2, x1 - 2, y1 - 2, shadow);
        self.fill(x0 + 2, y1 - 3, x1 - 2, y1 - 2, shadow);
        self.outline(x0, y0, x1, y1, self.colour(COLOR_WINDOWFRAME));
    }

    /// A scroll bar, its thumb where its position puts it (`USER.EXE`
    /// seg18 `073c`, `04b7`, `037b`).
    ///
    /// Along the bar, each arrow is as long as its bitmap, but no longer
    /// than half the bar less the border, so the arrows shrink on a short
    /// bar; a bar with no room for them draws nothing at all. The thumb
    /// starts a border back from the first arrow's inner edge and moves
    /// along what is left of the track (`scroll_geometry`). A track shorter
    /// than the thumb shows no thumb. The whole is outlined in the frame
    /// colour last -- over an arrow's last row, where the bar is shorter
    /// than the bitmap.
    ///
    /// **Read out**, and **recorded** by `mledit`: a multi-line edit
    /// control's thumbs at 0, 13, 25, 50 and 75 of 0 to 100, and 66 across,
    /// on four displays.
    ///
    /// An arrow turned off is the driver's grayed bitmap (seg18 `0556`,
    /// `05fa`). With both off there is no thumb, and the track is the class
    /// background of the control's parent, or of the window whose bar it
    /// is, where the scroll bar colour was -- the window colour for a class
    /// without one (seg18 `02da`, `03cf`). **Recorded** by `noscroll`.
    #[allow(clippy::too_many_lines)]
    pub fn scroll_bar(
        &self,
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
        vertical: bool,
        place: &mut ScrollPaint,
    ) {
        let length = if vertical { y1 - y0 } else { x1 - x0 };
        let Some(geometry) = scroll_geometry(
            |index| self.env.metric(index),
            length,
            vertical,
            place.min,
            place.max,
            place.pos,
        ) else {
            return;
        };
        let ScrollGeometry {
            border,
            bitmap,
            arrow,
            thumb,
            thumb_top,
            ..
        } = geometry;
        let flags = place.flags & 3;
        let off = flags == 3;
        let shows = geometry.shows && !off;
        let track = place.track;
        let pick = |bit: u16, part: u16, normal: u16, grayed: u16, pressed: u16| {
            track
                .filter(|track| track.part == part && track.pressed)
                .and_then(|_| self.env.oem(pressed))
                .or_else(|| (flags & bit != 0).then(|| self.env.oem(grayed)).flatten())
                .or_else(|| self.env.oem(normal))
        };

        self.fill(
            x0,
            y0,
            x1,
            y1,
            if off {
                self.solid(
                    place
                        .shaft
                        .unwrap_or_else(|| self.env.sys_color(COLOR_WINDOW)),
                )
            } else {
                self.colour(COLOR_SCROLLBAR)
            },
        );

        if vertical {
            self.stretch(
                pick(1, 0, OBM_UPARROW, OBM_UPARROWI, OBM_UPARROWD),
                x0,
                y0,
                x1 - x0,
                arrow,
            );
            self.stretch(
                pick(2, 1, OBM_DNARROW, OBM_DNARROWI, OBM_DNARROWD),
                x0,
                y1 - arrow,
                x1 - x0,
                arrow,
            );

            if shows {
                self.thumb(x0, y0 + thumb_top, x1, y0 + thumb_top + thumb);
            }
        } else {
            self.stretch(
                pick(1, 0, OBM_LFARROW, OBM_LFARROWI, OBM_LFARROWD),
                x0,
                y0,
                arrow,
                y1 - y0,
            );
            self.stretch(
                pick(2, 1, OBM_RGARROW, OBM_RGARROWI, OBM_RGARROWD),
                x1 - arrow,
                y0,
                arrow,
                y1 - y0,
            );

            if shows {
                self.thumb(x0 + thumb_top, y0, x0 + thumb_top + thumb, y1);
            }
        }

        self.outline(x0, y0, x1, y1, self.colour(COLOR_WINDOWFRAME));

        // An arrow squashed shorter than its bitmap has the frame drawn
        // again from the thumb's start on, a line over its last row.
        if bitmap > arrow {
            if vertical {
                self.outline(
                    x0,
                    y0 + arrow - border,
                    x1,
                    y1,
                    self.colour(COLOR_WINDOWFRAME),
                );
            } else {
                self.outline(
                    x0 + arrow - border,
                    y0,
                    x1,
                    y1,
                    self.colour(COLOR_WINDOWFRAME),
                );
            }
        }

        // While a page is held: its part between the arrow and the thumb,
        // cut back to the thumb when the thumb has come into it, inverted
        // again -- whether the pointer is in it or not (seg18 `042c`).
        if let Some(track) = place.track.as_mut()
            && (track.part == 2 || track.part == 3)
        {
            if track.part == 2 {
                track.end = track.end.min(thumb_top);
            } else {
                track.start = track.start.max(thumb_top + thumb);
            }

            self.invert_along(x0, y0, x1, y1, vertical, track.start, track.end);
        }

        // While the thumb is dragged: its outline, again (seg18 `0488`).
        if let Some(at) = place.track.and_then(|track| track.outline) {
            self.thumb_outline(x0, y0, x1, y1, vertical, at, thumb);
        }
    }

    /// Inverts a bar's run from `start` to `end` along it, a border in
    /// across.
    #[allow(clippy::too_many_arguments)]
    pub fn invert_along(
        &self,
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
        vertical: bool,
        start: i32,
        end: i32,
    ) {
        if end <= start {
            return;
        }

        if vertical {
            self.invert(x0 + 1, y0 + start, x1 - 1, y0 + end);
        } else {
            self.invert(x0 + start, y0 + 1, x0 + end, y1 - 1);
        }
    }

    /// The outline a dragged thumb leaves, a border wide, exclusive-ored
    /// with a brush of alternate pixels (seg18 `14e5`): drawn again, it
    /// goes.
    #[allow(clippy::too_many_arguments)]
    pub fn thumb_outline(
        &self,
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
        vertical: bool,
        at: i32,
        thumb: i32,
    ) {
        let [left, top, right, bottom] = if vertical {
            [x0, y0 + at, x1, y0 + at + thumb]
        } else {
            [x0 + at, y0, x0 + at + thumb, y1]
        };
        let screen = &self.screen;
        let mask = ((1u32 << screen.depth) - 1) as u8;
        let flip = |x: i32, y: i32| {
            if x < 0 || y < 0 || x >= self.width || y >= self.height || (x + y) & 1 == 0 {
                return;
            }

            if let Some(index) = screen.index_at(self.left + x, self.top + y) {
                screen.put(self.left + x, self.top + y, index ^ mask);
            }
        };

        screen.context.mark_rect(
            self.left + left,
            self.top + top,
            self.left + right,
            self.top + bottom,
        );

        for x in left..right {
            flip(x, top);
            flip(x, bottom - 1);
        }

        for y in top + 1..bottom - 1 {
            flip(left, y);
            flip(right - 1, y);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thumb_moves_along_what_the_arrows_leave() {
        // The VGA's: arrows and thumbs 16 long.
        let metric = |_| 16;
        let at = |pos| {
            scroll_geometry(metric, 100, true, 0, 100, pos)
                .unwrap()
                .thumb_top
        };

        assert_eq!(at(0), 15);
        // Room is 100 - 32 - 16 + 2 = 54: half of it, rounded half up.
        assert_eq!(at(50), 15 + 27);
        assert_eq!(at(100), 15 + 54);
    }

    #[test]
    fn a_bar_too_short_for_its_arrows_draws_nothing() {
        assert!(scroll_geometry(|_| 16, 3, false, 0, 100, 0).is_none());
        assert_eq!(
            scroll_geometry(|_| 16, 20, false, 0, 100, 0).unwrap().arrow,
            9
        );
    }
}
