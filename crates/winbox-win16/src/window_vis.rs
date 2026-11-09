//! USER's rule for a window's visible region, and the flags `GetDCEx`
//! works it out by (`USER.EXE` seg1 `1582`, `1612`, `847b`-`854c`): what a
//! device context USER hands out may draw on, in the screen's terms, given
//! to GDI as `SelectVisRgn` and `SetDCOrg` would
//! (`kb/topics/visible-regions.md`, phase 2).

use winbox_raster::ClipRegion;

use crate::system::System;
use crate::windows::Placement;

pub const DCX_WINDOW: u32 = 0x0000_0001;
pub const DCX_CACHE: u32 = 0x0000_0002;
pub const DCX_CLIPCHILDREN: u32 = 0x0000_0008;
pub const DCX_CLIPSIBLINGS: u32 = 0x0000_0010;
pub const DCX_PARENTCLIP: u32 = 0x0000_0020;
pub const DCX_EXCLUDERGN: u32 = 0x0000_0040;
pub const DCX_INTERSECTRGN: u32 = 0x0000_0080;
pub const DCX_LOCKWINDOWUPDATE: u32 = 0x0000_0400;
pub const DCX_USESTYLE: u32 = 0x0001_0000;

const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
const CS_OWNDC: u16 = 0x0020;
const CS_CLASSDC: u16 = 0x0040;
const CS_PARENTDC: u16 = 0x0080;

impl System {
    /// A window's class's style and icon.
    fn class_style_icon(&self, index: usize) -> (u16, u16) {
        self.windows[index]
            .as_ref()
            .and_then(|window| self.class_named(&window.class))
            .map_or((0, 0), |class| {
                (self.classes[class].style, self.classes[class].icon)
            })
    }

    /// The flags `GetDCEx` works a region out by, and the window whose
    /// region it is (`847b`-`854c`): with `DCX_USESTYLE`, the flags from the styles;
    /// with `DCX_PARENTCLIP`, the parent's region but where the parent
    /// has `WS_CLIPCHILDREN`, the flags have `DCX_CLIPCHILDREN` or
    /// `DCX_CLIPSIBLINGS`, or one of the two is visible and the other not.
    pub fn region_flags(&self, index: usize, mut flags: u32) -> (u32, usize) {
        let window = self.shown(index);

        if flags & DCX_USESTYLE != 0 {
            flags &= !(DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS | DCX_PARENTCLIP);

            if flags & DCX_WINDOW != 0 {
                if window.style & WS_CLIPSIBLINGS != 0 {
                    flags |= DCX_CLIPSIBLINGS;
                }
            } else {
                let (style, _) = self.class_style_icon(index);

                if style & CS_PARENTDC != 0 {
                    flags |= DCX_PARENTCLIP;
                }

                if window.style & WS_CLIPCHILDREN != 0 {
                    flags |= DCX_CLIPCHILDREN;
                }

                if window.style & WS_CLIPSIBLINGS != 0 {
                    flags |= DCX_CLIPSIBLINGS;
                }

                if window.placement == Placement::Minimized {
                    flags &= !DCX_CLIPCHILDREN;
                }

                if style & (CS_OWNDC | CS_CLASSDC) == 0 {
                    flags |= DCX_CACHE;
                }
            }
        }

        let mut of = index;

        if flags & DCX_PARENTCLIP != 0
            && let Some(parent) = window.parent
        {
            let shown = self.shown(parent);

            if shown.style & WS_CLIPCHILDREN == 0
                && flags & (DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS) == 0
                && shown.visible == window.visible
            {
                of = parent;

                if shown.style & WS_CLIPSIBLINGS != 0 {
                    flags |= DCX_CLIPSIBLINGS;
                }
            }
        }

        (flags, of)
    }

    /// A window's rectangle on the screen, or its client area's.
    fn rect_region(&self, index: usize, client: bool) -> ClipRegion {
        let window = self.shown(index);

        if client {
            ClipRegion::rect(
                window.left + window.client.left,
                window.top + window.client.top,
                window.left + window.client.right,
                window.top + window.client.bottom,
            )
        } else {
            ClipRegion::rect(
                window.left,
                window.top,
                window.left + window.width,
                window.top + window.height,
            )
        }
    }

    /// A region less the window rectangles of `parent`'s visible children
    /// above `stop` -- all of them with none -- but not those with
    /// `WS_EX_TRANSPARENT` (seg1 `16f2`).
    fn less_children(
        &self,
        parent: Option<usize>,
        stop: Option<usize>,
        mut region: ClipRegion,
    ) -> ClipRegion {
        for &other in &self.z_order {
            if Some(other) == stop {
                break;
            }

            let shown = self.shown(other);

            if shown.parent == parent && shown.visible && shown.ex_style & WS_EX_TRANSPARENT == 0 {
                region = region.subtract(&self.rect_region(other, false));
            }
        }

        region
    }

    /// Whether a window and the windows it is in show, for its region
    /// (seg1 `1c5f`): each visible, none minimized but the window itself,
    /// and that one only for its whole rectangle or where its class has no
    /// icon.
    fn shows_for_region(&self, index: usize, client: bool) -> bool {
        let mut at = Some(index);

        while let Some(window) = at {
            let shown = self.shown(window);

            if !shown.visible {
                return false;
            }

            if shown.placement == Placement::Minimized
                && (window != index || (client && self.class_style_icon(window).1 != 0))
            {
                return false;
            }

            at = shown.parent;
        }

        true
    }

    /// A window's visible region by USER's rule (seg1 `1582`), in the
    /// screen's terms:
    /// nothing where it or a window it is in is hidden or minimized, or
    /// where it is within the window `LockWindowUpdate` locked without
    /// `DCX_LOCKWINDOWUPDATE`; else `of`'s client or window rectangle, its
    /// visible children taken out with `DCX_CLIPCHILDREN`, then up the
    /// parents, siblings above taken out where `DCX_CLIPSIBLINGS` and each
    /// level's `WS_CLIPSIBLINGS` say and the region cut to each parent's
    /// client area, the screen's for the desktop.
    pub fn window_region(&self, index: usize, of: usize, flags: u32) -> ClipRegion {
        let client = flags & DCX_WINDOW == 0;

        if !self.shows_for_region(index, client) {
            return ClipRegion::EMPTY;
        }

        let locked = self
            .user_calls
            .locked
            .as_ref()
            .and_then(|lock| self.window_named(lock.hwnd));

        if let Some(locked) = locked
            && flags & DCX_LOCKWINDOWUPDATE == 0
            && self.within(index, locked)
        {
            return ClipRegion::EMPTY;
        }

        let mut region = self.rect_region(of, client);

        if flags & DCX_CLIPCHILDREN != 0 {
            region = self.less_children(Some(of), None, region);
        }

        let mut siblings = flags & DCX_CLIPSIBLINGS != 0;
        let mut level = of;

        loop {
            let parent = self.shown(level).parent;

            if siblings {
                region = self.less_children(parent, Some(level), region);
            }

            region = region.intersect(&match parent {
                Some(parent) => self.rect_region(parent, true),
                None => ClipRegion::rect(
                    0,
                    0,
                    i32::from(self.display.width),
                    i32::from(self.display.height),
                ),
            });

            let Some(parent) = parent else {
                return region;
            };

            if region.kind() == 1 {
                return region;
            }

            siblings = self.shown(parent).style & WS_CLIPSIBLINGS != 0;
            level = parent;
        }
    }

    /// A region less the window rectangles of the visible windows at the
    /// top, as the desktop's `DCX_CLIPCHILDREN` takes them out.
    pub(crate) fn less_top_windows(&self, region: ClipRegion) -> ClipRegion {
        self.less_children(None, None, region)
    }
}
