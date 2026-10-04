//! Scrolling what is drawn: `ScrollWindow`, `ScrollWindowEx` and
//! `ScrollDC`. **Recorded** by `scrolls`, on a window 32 by 24 of blocks of
//! colour, read back pixel by pixel straight after each call:
//!
//! * The pixels inside both the scroll rectangle -- the whole client area
//!   when none is given -- and the clip rectangle move by the amount asked,
//!   and land only inside the clip: nothing is brought in from outside it.
//!   The pixels the move uncovers keep what they had.
//! * What is left to paint is the scroll rectangle, cut to the clip, less
//!   where its pixels went: an L for a move both ways, whose box is the
//!   whole of it, a complex region.
//! * `ScrollWindow` invalidates that; `ScrollWindowEx` only with
//!   `SW_INVALIDATE`, and answers the region's kind whether it invalidates
//!   or not. `ScrollDC` invalidates nothing and answers TRUE. The two that
//!   take them fill in the update rectangle, the region's box, and the
//!   update region.
//! * `ScrollWindow` with no scroll rectangle moves the window's children
//!   with its pixels; with one, it leaves them. `ScrollWindowEx` moves them
//!   only with `SW_SCROLLCHILDREN`.
//!
//! Not recorded: what a child moved is sent, which here is nothing; pixels
//! of the window that another window covers, which a scroll here copies as
//! they are on the screen; and whether an update is erased, taken from the
//! documentation: `ScrollWindow` erases, `ScrollWindowEx` with `SW_ERASE`.

use winbox_raster::{ClipRegion, DeviceBitmap};

use crate::call::{Answer, Args, Stop};
use crate::gdi::GdiObject;
use crate::gdi::dc::dc_of;
use crate::gdi::draw::{read_rect, write_rect};
use crate::system::System;

const SW_SCROLLCHILDREN: u16 = 0x0001;
const SW_INVALIDATE: u16 = 0x0002;
const SW_ERASE: u16 = 0x0004;

type Box4 = [i32; 4];

fn cut(a: Box4, b: Box4) -> Box4 {
    [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ]
}

fn region_of_box(area: Box4) -> ClipRegion {
    ClipRegion::rect(area[0], area[1], area[2], area[3])
}

/// The pixels of `bitmap` inside `scroll` and `clip` moved by `dx`, `dy`,
/// only those inside `clip` changed: what is left to paint.
fn scroll_pixels(
    bitmap: &DeviceBitmap,
    dx: i32,
    dy: i32,
    scroll: Option<Box4>,
    clip: Option<Box4>,
) -> ClipRegion {
    let whole = [0, 0, bitmap.width(), bitmap.height()];
    let to = cut(clip.unwrap_or(whole), whole);
    let from = cut(scroll.unwrap_or(whole), to);
    let width = from[2] - from[0];
    let height = from[3] - from[1];

    if width > 0 && height > 0 {
        let mut kept = Vec::with_capacity((width * height) as usize);

        for y in 0..height {
            for x in 0..width {
                kept.push(bitmap.index_at(from[0] + x, from[1] + y).unwrap_or(0));
            }
        }

        for y in 0..height {
            for x in 0..width {
                let tx = from[0] + x + dx;
                let ty = from[1] + y + dy;

                if tx >= to[0] && tx < to[2] && ty >= to[1] && ty < to[3] {
                    bitmap.put(tx, ty, kept[(y * width + x) as usize]);
                }
            }
        }
    }

    let moved = [from[0] + dx, from[1] + dy, from[2] + dx, from[3] + dy];

    region_of_box(from).subtract(&region_of_box(moved))
}

/// An update's box into a program's rectangle, and its shape into its
/// region.
fn tell(system: &mut System, left: &ClipRegion, hrgn: u16, rect: u32) {
    if rect != 0 {
        let bounds = left.bounds();

        write_rect(
            system,
            rect,
            [bounds.left, bounds.top, bounds.right, bounds.bottom],
        );
    }

    if let Some((object, _)) = system.region_named(hrgn) {
        system.gdi.objects[object] = GdiObject::Region(left.clone());
    }
}

/// How a window is scrolled: its children moved with it, what is left
/// made due to paint, and erased.
struct How {
    children: bool,
    invalidate: bool,
    erase: bool,
}

impl System {
    /// A window's pixels scrolled, as `ScrollWindow` and `ScrollWindowEx`
    /// scroll them: what is left to paint, or none for no window.
    fn scroll_window(
        &mut self,
        hwnd: u16,
        (dx, dy): (i32, i32),
        scroll: Option<Box4>,
        clip: Option<Box4>,
        how: &How,
    ) -> Result<Option<ClipRegion>, Stop> {
        let Some(index) = self.window_named(hwnd) else {
            return Ok(None);
        };
        let Some(view) = self.window_view(index) else {
            return Ok(None);
        };
        let left = scroll_pixels(&view, dx, dy, scroll, clip);

        if how.children {
            let children: Vec<usize> = self
                .z_order
                .iter()
                .copied()
                .filter(|&other| {
                    self.windows[other]
                        .as_ref()
                        .is_some_and(|window| window.parent == Some(index))
                })
                .collect();

            for child in children {
                let window = self.windows[child].as_ref().expect("a window");
                let (x, y, width, height) = (window.left, window.top, window.width, window.height);

                self.place_window(child, x + dx, y + dy, width, height)?;
            }
        }

        if how.invalidate && left.kind() > 1 {
            let bounds = left.bounds();

            self.invalidate(
                index,
                Some([bounds.left, bounds.top, bounds.right, bounds.bottom]),
                how.erase,
            );
        }

        Ok(Some(left))
    }
}

pub(super) fn scroll_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let dx = i32::from(args.signed(system));
    let dy = i32::from(args.signed(system));
    let scroll = read_rect(system, args.dword(system));
    let clip = read_rect(system, args.dword(system));
    let how = How {
        children: scroll.is_none(),
        invalidate: true,
        erase: true,
    };

    system.scroll_window(hwnd, (dx, dy), scroll, clip, &how)?;
    Ok(Answer::Nothing)
}

pub(super) fn scroll_window_ex(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let dx = i32::from(args.signed(system));
    let dy = i32::from(args.signed(system));
    let scroll = read_rect(system, args.dword(system));
    let clip = read_rect(system, args.dword(system));
    let hrgn = args.word(system);
    let rect = args.dword(system);
    let flags = args.word(system);
    let how = How {
        children: flags & SW_SCROLLCHILDREN != 0,
        invalidate: flags & SW_INVALIDATE != 0,
        erase: flags & SW_ERASE != 0,
    };
    let Some(left) = system.scroll_window(hwnd, (dx, dy), scroll, clip, &how)? else {
        return Ok(Answer::Word(0));
    };

    tell(system, &left, hrgn, rect);
    Ok(Answer::Word(left.kind()))
}

/// A device context's pixels scrolled: TRUE, nought for no device context.
pub(super) fn scroll_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let dx = i32::from(args.signed(system));
    let dy = i32::from(args.signed(system));
    let scroll = read_rect(system, args.dword(system));
    let clip = read_rect(system, args.dword(system));
    let hrgn = args.word(system);
    let rect = args.dword(system);
    let Some(bitmap) = dc_of(system, hdc).and_then(|dc| system.draw_target(dc)) else {
        return Ok(Answer::Word(0));
    };
    let left = scroll_pixels(&bitmap, dx, dy, scroll, clip);

    tell(system, &left, hrgn, rect);
    Ok(Answer::Word(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_move_both_ways_leaves_an_l() {
        let bitmap = DeviceBitmap::new(8, 6, 4, None, None);

        for y in 0..6 {
            for x in 0..8 {
                bitmap.put(x, y, (y * 8 + x) as u8 & 0x0f);
            }
        }

        let left = scroll_pixels(&bitmap, 2, 1, None, None);

        assert_eq!(left.kind(), 3);
        assert_eq!(bitmap.index_at(2, 1), Some(0));
        assert_eq!(bitmap.index_at(7, 5), Some((4 * 8 + 5) as u8 & 0x0f));
        // Uncovered, the pixels keep what they had.
        assert_eq!(bitmap.index_at(0, 0), Some(0));
        assert_eq!(bitmap.index_at(1, 3), Some((3 * 8 + 1) as u8 & 0x0f));

        let bounds = left.bounds();

        assert_eq!(
            [bounds.left, bounds.top, bounds.right, bounds.bottom],
            [0, 0, 8, 6]
        );
    }

    #[test]
    fn nothing_lands_outside_the_clip() {
        let bitmap = DeviceBitmap::new(4, 1, 4, None, None);

        for x in 0..4 {
            bitmap.put(x, 0, x as u8 + 1);
        }

        let left = scroll_pixels(&bitmap, 1, 0, None, Some([0, 0, 3, 1]));

        assert_eq!(
            (0..4).map(|x| bitmap.index_at(x, 0)).collect::<Vec<_>>(),
            [Some(1), Some(1), Some(2), Some(4)]
        );
        assert_eq!(left.kind(), 2);
    }
}
