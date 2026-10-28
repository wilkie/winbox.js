//! USER's own invalidation of a region of the screen through a window and
//! the windows in it, as `ScrollWindow`, `ScrollWindowEx` and the end of
//! `LockWindowUpdate` make it (`USER.EXE` seg1 `3ed7`, its walk `4034` and
//! what each window is given `4202`). Twin of the TypeScript engine's
//! `invalidate-through.ts`. **Read out**:
//!
//! * A window is passed over where its rectangle, cut to the client areas
//!   it is in, is empty, or meets nothing of the region (`4058`-`40a1`,
//!   `486b`). Where the region covers all of it, it is given all of itself
//!   (`40a4`-`40c4`), and so are the windows in it.
//! * A window is given the region whole, not cut to itself (`42e9`): its
//!   update region's box is what `GetUpdateRect` cuts to its client area.
//!   One due all of itself stays so (`4274`). `RDW_ERASE` marks it to be
//!   erased (`4260`), `RDW_FRAME` its frame (`426a`).
//! * Without `WS_CLIPCHILDREN` it is given the region before the windows in
//!   it, with it after them (`40c9`, `4180`).
//! * The windows in it are walked, front to back, where it has any, is not
//!   minimized, `RDW_NOCHILDREN` is not given, and `RDW_ALLCHILDREN` is or
//!   it has no `WS_CLIPCHILDREN` (`40e8`-`410a`); each of them is told to
//!   erase and draw its frame too (`4112`). One with `WS_CLIPSIBLINGS` whose
//!   parent has `WS_CLIPCHILDREN` -- every window at the top, the desktop
//!   having it -- takes its rectangle out of the region for those behind it
//!   and for its parent; where nothing is left, the walk ends (`4190`-`41f5`).
//!
//! The desktop's own part, what is left of the region where no window
//! shows, is its background, drawn at once.

use winbox_raster::ClipRegion;

use crate::system::System;
use crate::windows::Placement;

pub const RDW_INVALIDATE: u16 = 0x0001;
pub const RDW_ERASE: u16 = 0x0004;
pub const RDW_VALIDATE: u16 = 0x0008;
pub const RDW_NOCHILDREN: u16 = 0x0040;
pub const RDW_ALLCHILDREN: u16 = 0x0080;
pub const RDW_FRAME: u16 = 0x0400;

/// USER's own: a window walked as one in another, whose rectangle may be
/// taken out (`403d`).
const WALKED: u16 = 0x2000;

const WS_MINIMIZE: u32 = 0x2000_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;

pub type Rect = [i32; 4];

pub(crate) fn cut(a: Rect, b: Rect) -> Rect {
    [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ]
}

pub(crate) fn is_empty(r: Rect) -> bool {
    r[2] <= r[0] || r[3] <= r[1]
}

pub(crate) fn region_of(r: Rect) -> ClipRegion {
    ClipRegion::rect(r[0], r[1], r[2], r[3])
}

/// What the region covers of a rectangle (seg1 `486b`): 0 nothing, 2 all
/// of it, 1 some.
fn covers(region: &ClipRegion, rect: Rect) -> u8 {
    let part = region.intersect(&region_of(rect));

    if part.kind() == 1 {
        return 0;
    }

    let bounds = part.bounds();

    if part.kind() == 2 && [bounds.left, bounds.top, bounds.right, bounds.bottom] == rect {
        2
    } else {
        1
    }
}

impl System {
    /// A window's rectangle on the screen.
    pub(crate) fn window_rect(&self, index: usize) -> Rect {
        let shown = self.shown(index);

        [
            shown.left,
            shown.top,
            shown.left + shown.width,
            shown.top + shown.height,
        ]
    }

    /// A window's client area on the screen, as a rectangle.
    pub(crate) fn client_rect(&self, index: usize) -> Rect {
        let shown = self.shown(index);

        [
            shown.left + shown.client.left,
            shown.top + shown.client.top,
            shown.left + shown.client.right,
            shown.top + shown.client.bottom,
        ]
    }

    /// A window's children, front to back; the windows at the top for
    /// none.
    pub(crate) fn windows_in(&self, parent: Option<usize>) -> Vec<usize> {
        self.z_order
            .iter()
            .copied()
            .filter(|&other| self.shown(other).parent == parent)
            .collect()
    }

    fn minimized(&self, index: usize) -> bool {
        let shown = self.shown(index);

        shown.placement == Placement::Minimized || shown.style & WS_MINIMIZE != 0
    }

    /// One window and the windows in it (seg1 `4034`): false where nothing
    /// of the region is left.
    fn walk_through(
        &mut self,
        region: &mut ClipRegion,
        index: usize,
        mut whole: bool,
        within: Rect,
        flags: u16,
    ) -> bool {
        let rect = cut(self.window_rect(index), within);

        if flags & RDW_INVALIDATE != 0 && is_empty(rect) && !whole {
            return true;
        }

        if !whole {
            let how = covers(region, rect);

            if how == 0 {
                return true;
            }

            whole = how == 2;
        }

        let erase = flags & RDW_ERASE != 0;
        let frame = flags & RDW_FRAME != 0;
        let style = self.shown(index).style;

        if style & WS_CLIPCHILDREN == 0 {
            let given = (!whole).then(|| region.clone());

            self.due_through(index, given.as_ref(), erase, frame);
        }

        let children: Vec<usize> = self
            .windows_in(Some(index))
            .into_iter()
            .filter(|&child| self.shown(child).visible)
            .collect();

        if !children.is_empty()
            && !self.minimized(index)
            && flags & RDW_NOCHILDREN == 0
            && (flags & RDW_ALLCHILDREN != 0 || style & WS_CLIPCHILDREN == 0)
        {
            let inner = flags
                | WALKED
                | if flags & RDW_INVALIDATE != 0 {
                    RDW_ERASE | RDW_FRAME
                } else {
                    0
                };
            let inside = cut(rect, self.client_rect(index));

            if !is_empty(inside) || whole {
                for child in children {
                    if !self.walk_through(region, child, whole, inside, inner) {
                        return false;
                    }
                }
            }
        }

        if style & WS_CLIPCHILDREN != 0 {
            let given = (!whole).then(|| region.clone());

            self.due_through(index, given.as_ref(), erase, frame);
        }

        self.taken_through(region, index, rect, flags)
    }

    /// A window walked as one in another, with `WS_CLIPSIBLINGS`, whose
    /// parent has `WS_CLIPCHILDREN`, takes its rectangle out of the region
    /// (`4190`-`41f5`): false where nothing is left.
    fn taken_through(&self, region: &mut ClipRegion, index: usize, rect: Rect, flags: u16) -> bool {
        let shown = self.shown(index);
        let parent_clips = shown
            .parent
            .is_none_or(|parent| self.shown(parent).style & WS_CLIPCHILDREN != 0);

        if flags & WALKED != 0
            && shown.style & WS_CLIPSIBLINGS != 0
            && (flags & RDW_VALIDATE != 0 || parent_clips)
        {
            *region = region.subtract(&region_of(rect));

            return region.kind() != 1;
        }

        true
    }

    /// A region of the screen made due in a window and those in it, by
    /// `flags` (`RDW_` bits): through the desktop for `index` none, its own
    /// part drawn at once. `region` none is all of the window: its client
    /// area, or with `RDW_FRAME` all of it (seg1 `3f09`-`3f24`, `16b7`).
    pub fn invalidate_through(
        &mut self,
        index: Option<usize>,
        region: Option<&ClipRegion>,
        flags: u16,
    ) {
        let screen = [
            0,
            0,
            i32::from(self.display.width),
            i32::from(self.display.height),
        ];

        let Some(index) = index else {
            let mut left = region.cloned().unwrap_or_else(|| region_of(screen));
            let whole = region.is_none();
            let inner = flags
                | WALKED
                | if flags & RDW_INVALIDATE != 0 {
                    RDW_ERASE | RDW_FRAME
                } else {
                    0
                };
            let children: Vec<usize> = self
                .windows_in(None)
                .into_iter()
                .filter(|&one| self.shown(one).visible)
                .collect();

            for child in children {
                if !self.walk_through(&mut left, child, whole, screen, inner) {
                    return;
                }
            }

            // The desktop, which has `WS_CLIPCHILDREN`, given what is left.
            for band in &left.bands {
                for &(span_left, span_right) in &band.spans {
                    self.paint_background_in([span_left, band.top, span_right, band.bottom]);
                }
            }

            return;
        };

        let own = if flags & RDW_FRAME != 0 {
            self.window_rect(index)
        } else {
            self.client_rect(index)
        };
        let mut left = region.cloned().unwrap_or_else(|| region_of(own));

        self.walk_through(&mut left, index, region.is_none(), own, flags);
    }
}
