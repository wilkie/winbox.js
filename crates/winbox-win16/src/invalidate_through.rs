//! USER's own invalidation of a region of the screen through a window and
//! the windows in it, as `RedrawWindow`, `InvalidateRect`, `InvalidateRgn`,
//! `ValidateRect`, `ValidateRgn`, `ScrollWindow`, `ScrollWindowEx` and the
//! end of `LockWindowUpdate` make it (`USER.EXE` seg1 `3ed7`, its walk `4034` and
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
//!   and for its parent, unless it has `WS_EX_TRANSPARENT`; where nothing
//!   is left, the walk ends (`4190`-`41f5`), or with `RDW_INTERNALPAINT` or
//!   `RDW_NOINTERNALPAINT` goes on with those alone (`415e`-`416c`).
//! * A window of a program made before 3.10 whose rectangle, or client
//!   area, cut, is empty is still given all of itself (`406e`-`4084`,
//!   `4117`-`4139`); one made for 3.10 is passed over. What each is given,
//!   flag by flag, is `give_through` (`4202`; `rdwwalk`, `rdw31`).
//!
//! The desktop's own part, what is left of the region where no window
//! shows, is its background, drawn at once.

use winbox_raster::ClipRegion;

use crate::system::System;
use crate::windows::Placement;

pub const RDW_INVALIDATE: u16 = 0x0001;
pub const RDW_INTERNALPAINT: u16 = 0x0002;
pub const RDW_ERASE: u16 = 0x0004;
pub const RDW_VALIDATE: u16 = 0x0008;
/// USER's own: asked by a program, through `RedrawWindow`'s body (`3ec5`):
/// `RedrawWindow`, `InvalidateRect`, `InvalidateRgn`, `ValidateRect` and
/// `ValidateRgn`.
pub const RDW_CALLED: u16 = 0x1000;
pub const RDW_NOINTERNALPAINT: u16 = 0x0010;
pub const RDW_NOERASE: u16 = 0x0020;
pub const RDW_NOCHILDREN: u16 = 0x0040;
pub const RDW_ALLCHILDREN: u16 = 0x0080;
pub const RDW_UPDATENOW: u16 = 0x0100;
pub const RDW_ERASENOW: u16 = 0x0200;
pub const RDW_FRAME: u16 = 0x0400;
pub const RDW_NOFRAME: u16 = 0x0800;

/// USER's own: a window walked as one in another, whose rectangle may be
/// taken out (`403d`).
const WALKED: u16 = 0x2000;

/// What is left once the region is used up, where a paint of its own is
/// asked (`4167`).
const INTERNAL_ONLY: u16 =
    !(RDW_INVALIDATE | RDW_ERASE | RDW_VALIDATE | RDW_NOERASE | RDW_FRAME | RDW_NOFRAME);

const WS_MINIMIZE: u32 = 0x2000_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;

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

    /// USER's bit 4 of the byte at 26h of a window: made by a module marked
    /// for Windows 3.10 or later, set by `CreateWindow` where `GetExpWinVer`
    /// answers 30Ah or more (`USER.EXE` seg8 `0425`-`0432`). The TypeScript
    /// engine's `madeFor31`.
    pub(crate) fn made_for_31(&mut self, index: usize) -> bool {
        self.expected_version(index) >= 0x30a
    }

    /// One window and the windows in it (seg1 `4034`): false where nothing
    /// of the region is left.
    fn walk_through(
        &mut self,
        region: &mut ClipRegion,
        index: usize,
        mut whole: bool,
        within: Rect,
        mut flags: u16,
    ) -> bool {
        let for_31 = self.made_for_31(index);
        // Validating, the window's rectangle is neither cut nor asked
        // against the region (`4052`, `40aa`).
        let rect = if flags & RDW_INVALIDATE != 0 {
            cut(self.window_rect(index), within)
        } else {
            self.window_rect(index)
        };
        // The flags the windows in it are walked with: these, and walked
        // (`403d`).
        let mut inner = flags | WALKED;

        if flags & RDW_INVALIDATE != 0 {
            // Nothing of it within the windows it is in: passed over, but
            // for a window of a program made before 3.10 given all of
            // itself, which then takes nothing out of the region
            // (`406e`-`4084`).
            if is_empty(rect) {
                if for_31 || !whole {
                    return true;
                }

                flags &= !WALKED;
                inner &= !WALKED;
            }

            if !whole {
                let how = covers(region, rect);

                if how == 0 {
                    return true;
                }

                whole = how == 2;
            }
        }

        let style = self.shown(index).style;

        if style & WS_CLIPCHILDREN == 0 {
            self.give_through(region, index, whole, flags, for_31);
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
            if flags & RDW_INVALIDATE != 0 {
                inner |= RDW_ERASE | RDW_FRAME;
            }

            let inside = cut(rect, self.client_rect(index));

            // Nothing of its client area: the windows in it are passed
            // over, but for a window of a program made before 3.10 given
            // all of itself (`4117`-`4139`).
            if !is_empty(inside) || (whole && !for_31) {
                for child in children {
                    if !self.walk_through(region, child, whole, inside, inner) {
                        // The region used up: the rest still walked for
                        // their paints of their own where those are asked,
                        // nothing else (`415e`-`416c`).
                        if flags & (RDW_INTERNALPAINT | RDW_NOINTERNALPAINT) == 0 {
                            return false;
                        }

                        flags &= INTERNAL_ONLY;
                        inner &= INTERNAL_ONLY & !WALKED;
                    }
                }
            }
        }

        if style & WS_CLIPCHILDREN != 0 {
            self.give_through(region, index, whole, flags, for_31);
        }

        self.taken_through(region, index, rect, flags)
    }

    /// One window given the region, all of itself where `whole` (seg1
    /// `4202`). **Read out**:
    ///
    /// * Made due, where `RDW_INVALIDATE`, `RDW_INTERNALPAINT`, `RDW_ERASE`
    ///   or `RDW_FRAME` is given (`4221`, `due_through`); else validated
    ///   (`4309`, `valid_through`). Both given, it is made due alone.
    /// * `RDW_INTERNALPAINT` gives it a paint of its own (`422b`).
    /// * `RDW_ERASE` and `RDW_FRAME` count only with `RDW_INVALIDATE`
    ///   (`4235`). All of a window of a program made before 3.10 made due
    ///   without `RDW_ERASE` takes back an erase it was due (`4250`-`425c`).
    /// * Validating: `RDW_NOINTERNALPAINT` takes its paint of its own off
    ///   (`4323`); with `RDW_VALIDATE` alone, `RDW_NOERASE` its erase
    ///   (`4334`) and `RDW_NOFRAME` its frame (`433d`), before what is
    ///   validated is cut from what it is due (`434a`).
    fn give_through(
        &mut self,
        region: &ClipRegion,
        index: usize,
        whole: bool,
        flags: u16,
        for_31: bool,
    ) {
        let given = (!whole).then_some(region);

        if flags & (RDW_INVALIDATE | RDW_INTERNALPAINT | RDW_ERASE | RDW_FRAME) != 0 {
            if flags & RDW_INTERNALPAINT != 0 {
                self.shown_mut(index).internal_paint = true;
            }

            if flags & RDW_INVALIDATE != 0 {
                // Made due by another task than its own: noted, its flag
                // 20h of the word at 24h (`4242`-`424c`), until it is looked
                // at.
                let hwnd = self.shown(index).hwnd;

                if hwnd != 0 && !self.mine(hwnd) {
                    self.shown_mut(index).other_task = true;
                }

                if whole && !for_31 {
                    self.shown_mut(index).needs_erase = false;
                }

                self.due_through(index, given, flags & RDW_ERASE != 0, flags & RDW_FRAME != 0);
            }

            return;
        }

        // Validated by a program while another task's making it due is not
        // yet looked at: nothing at all (`4315`-`4320`; `rdwmore`).
        if flags & RDW_CALLED != 0 && self.shown(index).other_task {
            return;
        }

        if flags & RDW_NOINTERNALPAINT != 0 {
            self.shown_mut(index).internal_paint = false;
        }

        if flags & RDW_VALIDATE != 0 {
            let shown = self.shown_mut(index);

            if flags & RDW_NOERASE != 0 {
                shown.needs_erase = false;
            }

            if flags & RDW_NOFRAME != 0 {
                shown.needs_nc_paint = false;
                shown.needs_frame = false;
            }

            self.valid_through(index, given);
        }
    }

    /// A window walked as one in another, with `WS_CLIPSIBLINGS`, whose
    /// parent has `WS_CLIPCHILDREN`, takes its rectangle out of the region
    /// (`4190`-`41f5`): false where nothing is left.
    fn taken_through(&self, region: &mut ClipRegion, index: usize, rect: Rect, flags: u16) -> bool {
        let shown = self.shown(index);
        let parent_clips = shown
            .parent
            .is_none_or(|parent| self.shown(parent).style & WS_CLIPCHILDREN != 0);

        // Not a window with `WS_EX_TRANSPARENT` (`4196`).
        if flags & WALKED != 0
            && shown.ex_style & WS_EX_TRANSPARENT == 0
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
        mut flags: u16,
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
            let mut inner = flags
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

            // The windows at the top are walked only with
            // `RDW_ALLCHILDREN`, the desktop having `WS_CLIPCHILDREN`, and
            // not with `RDW_NOCHILDREN` (`40e8`-`410a`): else the desktop is
            // given the region, and draws only where none of them is.
            if flags & RDW_NOCHILDREN != 0 || flags & RDW_ALLCHILDREN == 0 {
                for child in children {
                    left = left.subtract(&region_of(self.window_rect(child)));
                }
            } else {
                for child in children {
                    if !self.walk_through(&mut left, child, whole, screen, inner) {
                        if flags & (RDW_INTERNALPAINT | RDW_NOINTERNALPAINT) == 0 {
                            return;
                        }

                        flags &= INTERNAL_ONLY;
                        inner &= INTERNAL_ONLY & !WALKED;
                    }
                }
            }

            // The desktop, which has `WS_CLIPCHILDREN`, given what is left:
            // made due. Asked by a program, through `RedrawWindow`, it stays
            // due until its paint -- the message loop looking for paints,
            // `RDW_ERASENOW` or `RDW_UPDATENOW` (`rdwmore`: `GetUpdateRect`
            // of the desktop window answers it); else drawn at once, as
            // USER's own callers have it drawn by `7913` from the desktop
            // after.
            if flags & RDW_INVALIDATE != 0 {
                if flags & RDW_CALLED != 0 {
                    self.background_due_in(&left);
                } else {
                    self.paint_background_region(&left);
                }
            }

            return;
        };

        let own = if flags & RDW_FRAME != 0 {
            self.window_rect(index)
        } else {
            self.client_rect(index)
        };
        let within = self.cut_to_parents(index, own);

        // Made due, nothing where the window or a window it is in is hidden,
        // or one it is in minimized (seg1 `3f27`-`3f3e`, `8bb3`).
        if within.is_none() && flags & RDW_INVALIDATE != 0 {
            return;
        }

        let mut left = region.cloned().unwrap_or_else(|| region_of(own));

        self.walk_through(
            &mut left,
            index,
            region.is_none(),
            within.unwrap_or(own),
            flags,
        );
    }

    /// A rectangle of the screen cut to the client area of each window a
    /// window is in (seg1 `8bb3`): none where the window or one of them is
    /// hidden, or one of them minimized. An empty rectangle is not none.
    /// The TypeScript engine's `cutToParents`.
    pub(crate) fn cut_to_parents(&self, index: usize, rect: Rect) -> Option<Rect> {
        if !self.shown(index).visible {
            return None;
        }

        let mut out = rect;
        let mut up = self.shown(index).parent;

        while let Some(parent) = up {
            if !self.shown(parent).visible || self.minimized(parent) {
                return None;
            }

            out = cut(out, self.client_rect(parent));
            up = self.shown(parent).parent;
        }

        Some(out)
    }

    /// Whether a window shows for `RedrawWindow`'s body (seg1 `3e4a`,
    /// `1c5f`): it and every window it is in shown, none of those
    /// minimized. The window itself minimized counts, but for its client
    /// area alone -- asked for a window of a program made for 3.10 or later
    /// without `RDW_FRAME` (`3e35`-`3e46`) -- where its class has an icon
    /// (`1c7e`-`1c8c`).
    fn shows_for(&self, index: usize, client: bool) -> bool {
        let mut at = Some(index);

        while let Some(one) = at {
            if !self.shown(one).visible || (one != index && self.minimized(one)) {
                return false;
            }

            at = self.shown(one).parent;
        }

        !(client && self.minimized(index) && self.paints_icon(index))
    }

    /// `RedrawWindow`'s body (`USER.EXE` seg1 `3e1e`), as `RedrawWindow`,
    /// `InvalidateRect`, `InvalidateRgn`, `ValidateRect` and `ValidateRgn`
    /// call it (their bodies at `011c`-`0176` passing `RDW_INVALIDATE`, with
    /// `RDW_ERASE` to erase, or `RDW_VALIDATE`): nothing for a window that
    /// does not show; else a region of the screen, or all of the window for
    /// none, made due or valid through it and the windows in it (`3ed7`).
    /// `told` is what is made due, in its client area's terms, for the lock
    /// (`3f41`-`3f7c`). False where the window does not show: nothing is
    /// painted now either. The TypeScript engine's `redrawThrough`.
    pub(crate) fn redraw_through(
        &mut self,
        index: usize,
        region: Option<&ClipRegion>,
        flags: u16,
        told: Option<[i32; 4]>,
    ) -> bool {
        let client = flags & RDW_FRAME == 0 && self.made_for_31(index);

        if !self.shows_for(index, client) {
            return false;
        }

        if flags & RDW_INVALIDATE != 0 {
            self.tell_lock(index, told, flags & RDW_FRAME != 0);
        }

        self.invalidate_through(Some(index), region, flags | RDW_CALLED);

        true
    }
}
