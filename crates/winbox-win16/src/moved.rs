//! A window moved, sized or put elsewhere in the order of windows as
//! `SetWindowPos` does it, as the TypeScript engine's `desktop.ts` does:
//! what it keeps of what it showed, and what is due a paint after.
//!
//! **Recorded** by `swpbits`, a pop-up moved over a window beneath it:
//!
//! * Moved, its bits go with it: the screen shows it at its new place at
//!   once, and it is sent nothing to paint -- not `WM_NCPAINT`, not
//!   `WM_ERASEBKGND`, not `WM_PAINT`. So is a window with a caption, and a
//!   child in its parent. What could not come with it -- what another
//!   window covered of it -- is due, and erased at once.
//! * With `SWP_NOCOPYBITS`, what of its new place already showed it is
//!   left as it is, and it is due everywhere else -- the copy going through
//!   the rectangle the call before left in USER's entry (`stale`).
//! * Sized, its client area's bits go with the client area, and the rest of
//!   the window is due; made smaller, nothing is. With `CS_HREDRAW` and a
//!   new width, or `CS_VREDRAW` and a new height, all of it is due. Moved
//!   only, the two styles change nothing.
//! * `MoveWindow` with `bRepaint` FALSE does the same as with TRUE.
//! * What it uncovered is due in the windows that show there now, and no
//!   more of them: one above it is not. A window at the top that was
//!   uncovered is sent `WM_NCPAINT` and `WM_ERASEBKGND` at once; a parent
//!   a child was moved in, `WM_ERASEBKGND` only. A parent without
//!   `WS_CLIPCHILDREN` is due where the child is due as well.
//! * The erases come before `WM_WINDOWPOSCHANGED`.
//!
//! **Recorded** by `swporder`, where `SetWindowPos` puts a window in the
//! order of windows:
//!
//! * `HWND_BOTTOM` puts it behind every other, a hidden one too, and a
//!   topmost window is topmost no more. A window given puts it right after
//!   that one, topmost if that one is.
//! * `HWND_TOPMOST` makes it topmost, in front of all; `HWND_NOTOPMOST`
//!   makes a topmost window not, in front of those that are not, and leaves
//!   any other where it is. A child is never topmost: given either, it is
//!   sent nothing.
//! * Made active -- without `SWP_NOACTIVATE` -- a window at the top comes
//!   to the top whatever it was asked: `HWND_TOP`, unless it was
//!   `HWND_TOPMOST`.
//! * `WM_WINDOWPOSCHANGING` carries the window it goes after as USER has
//!   worked it out: `HWND_TOP` for a window at the top that is not topmost
//!   is the last topmost window, USER's own `#32771`; `HWND_TOPMOST` is
//!   `HWND_TOP`; `HWND_NOTOPMOST` is the last topmost window, or for a
//!   window that is not topmost the one in front of it.
//! * Put after itself, it is sent nothing at all.
//! * `WM_WINDOWPOSCHANGED` follows only where its place in the order, or
//!   whether it is topmost, changed.
//! * What it uncovers of a window at the top is due there; among children
//!   without `WS_CLIPSIBLINGS`, which draw over one another, nothing is.

use winbox_raster::ClipRegion;

use crate::invalidate_through::{
    RDW_ALLCHILDREN, RDW_ERASE, RDW_FRAME, RDW_INVALIDATE, RDW_NOCHILDREN,
};
use crate::system::System;
use crate::window_vis::{DCX_CLIPSIBLINGS, DCX_WINDOW};

const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const WS_EX_TOPMOST: u32 = 0x0000_0008;
pub(crate) const SWP_NOSIZE: u16 = 0x0001;
pub(crate) const SWP_NOMOVE: u16 = 0x0002;
pub(crate) const SWP_NOZORDER: u16 = 0x0004;
pub(crate) const SWP_SHOWWINDOW: u16 = 0x0040;
pub(crate) const SWP_HIDEWINDOW: u16 = 0x0080;
const CS_VREDRAW: u16 = 0x0001;
const CS_HREDRAW: u16 = 0x0002;

pub(crate) const HWND_TOP: u16 = 0;
pub(crate) const HWND_BOTTOM: u16 = 1;
pub(crate) const HWND_TOPMOST: u16 = 0xffff;
pub(crate) const HWND_NOTOPMOST: u16 = 0xfffe;

/// Where a window goes in the order of windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Insert {
    /// Where it is.
    Stay,
    /// In front of its brothers, the topmost first.
    Top,
    /// Behind every brother.
    Bottom,
    /// Right after a brother, by its index.
    After(usize),
    /// Topmost, in front of all.
    Topmost,
    /// Topmost no more, in front of those that are not.
    NotTopmost,
}

/// A window's place before it moved, and what it was due then, if part of
/// it: the region, whether it was to be erased, and what of it the walk
/// gave.
type Was = (
    [i32; 4],
    Option<(ClipRegion, bool, Option<Option<ClipRegion>>)>,
);

/// A window's place: left, top, right, bottom.
fn place_of(system: &System, index: usize) -> [i32; 4] {
    let shown = system.shown(index);

    [
        shown.left,
        shown.top,
        shown.left + shown.width,
        shown.top + shown.height,
    ]
}

/// A window's client area on the screen: left, top, right, bottom.
fn client_of(system: &System, index: usize) -> [i32; 4] {
    let shown = system.shown(index);

    [
        shown.left + shown.client.left,
        shown.top + shown.client.top,
        shown.left + shown.client.right,
        shown.top + shown.client.bottom,
    ]
}

/// Which of a window's old client area's bits `SetWindowPos` keeps, sized,
/// as its procedure answered `WM_NCCALCSIZE` (`position::calc_kept`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kept {
    /// None of them.
    Nothing,
    /// Those that go to `rect` on the screen, from `delta` away.
    Bits { rect: [i32; 4], delta: (i32, i32) },
}

/// A window of a list `SetWindowPos` places (`System::begin_placing`), one
/// of USER's entries.
#[derive(Debug, Clone)]
pub(crate) struct Placing {
    window: usize,
    /// Its visible region before anything of the list was placed
    /// (`USER.EXE` seg7 `09a0`).
    old: ClipRegion,
    was_visible: bool,
    /// Where it was, and whether it showed (`System::placing_key`).
    was_at: PlaceKey,
    /// Where its bits go, on the screen (the entry's +16h); none for its
    /// whole window.
    pub(crate) dest: Option<[i32; 4]>,
    /// How far its bits come.
    delta: (i32, i32),
    /// Due all of itself already, by its caller.
    whole: bool,
    /// Drawn by its caller already (`placing_skip`).
    skip: bool,
    /// What it was asked (`placing_flags`), none for moved or sized.
    pub(crate) flags: Option<u16>,
    /// More of the screen made due with it: an icon's title where it was
    /// and is.
    extra: Option<ClipRegion>,
}

/// Where a window is, to tell whether a list changed it: its place and
/// size, whether it is shown, and the windows in front of it among its
/// brothers.
type PlaceKey = ([i32; 4], bool, Vec<usize>);

/// The windows of a list being placed, and the screen as it was before
/// (`System::begin_placing`).
#[derive(Debug, Clone)]
pub struct PlacingList {
    entries: Vec<Placing>,
    screen: Vec<u8>,
    depth: u32,
}

/// Where two rectangles meet; empty where they do not.
fn cut(a: [i32; 4], b: [i32; 4]) -> [i32; 4] {
    [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ]
}

impl System {
    /// What `SetWindowPos` reports in `WM_WINDOWPOSCHANGING` as the window
    /// a window goes after, and where it goes; none for a request that does
    /// nothing at all. `activated` is whether it is made active.
    pub(crate) fn insert_for(
        &self,
        index: usize,
        after: u16,
        activated: bool,
    ) -> Option<(u16, Insert)> {
        let shown = self.shown(index);
        let child = shown.parent.is_some();
        let after = if activated && !child && after != HWND_TOPMOST {
            HWND_TOP
        } else {
            after
        };

        if after == shown.hwnd {
            return None;
        }

        // The last topmost window at the top but this one.
        let last_topmost = || {
            self.z_order
                .iter()
                .copied()
                .filter(|&other| {
                    let window = self.shown(other);

                    other != index && window.parent.is_none() && window.topmost
                })
                .last()
                .map_or(0, |other| self.shown(other).hwnd)
        };

        Some(match after {
            HWND_TOP if child || shown.topmost => (HWND_TOP, Insert::Top),
            HWND_TOP => (last_topmost(), Insert::Top),
            HWND_BOTTOM => (HWND_BOTTOM, Insert::Bottom),
            HWND_TOPMOST | HWND_NOTOPMOST if child => return None,
            HWND_TOPMOST => (HWND_TOP, Insert::Topmost),
            HWND_NOTOPMOST if shown.topmost => (last_topmost(), Insert::NotTopmost),
            HWND_NOTOPMOST => {
                // Left where it is, after the window in front of it.
                let at = self
                    .z_order
                    .iter()
                    .position(|&other| other == index)
                    .unwrap_or(0);
                let before = self.z_order[..at]
                    .iter()
                    .copied()
                    .rfind(|&other| self.shown(other).parent == shown.parent)
                    .map_or(0, |other| self.shown(other).hwnd);

                (before, Insert::Stay)
            }
            hwnd => match self.window_named(hwnd) {
                Some(other) if other != index && self.shown(other).parent == shown.parent => {
                    (hwnd, Insert::After(other))
                }
                _ => (hwnd, Insert::Stay),
            },
        })
    }

    /// A window put where `to` says among its brothers, its children with
    /// it; whether its place in the order, or whether it is topmost,
    /// changed. What it uncovers is due where it now shows.
    /// Whether a window already lies where it is asked to go, as USER
    /// looks before it moves it (`USER.EXE` seg7 `1184`): at the bottom,
    /// the last of its brothers; at the top, the first, or for one not
    /// topmost the first after the last topmost window; after a window,
    /// right after it, topmost as that one is. One made topmost, or topmost
    /// no more, does not. An icon's title is not counted as a brother:
    /// winbox.js keeps it just in front of its icon, where Windows keeps it
    /// among the topmost windows (`swpshow`: an icon brought to `HWND_TOP`
    /// goes after its own title, `#32772`, and is not where it was asked to
    /// go).
    pub(crate) fn lies_where_asked(&self, index: usize, to: Insert) -> bool {
        let shown = self.shown(index);
        let (parent, topmost) = (shown.parent, shown.topmost);
        let brothers: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| {
                let window = self.shown(other);

                window.parent == parent && window.title_of.is_none()
            })
            .collect();
        let at = brothers.iter().position(|&other| other == index);
        let before = at.and_then(|at| at.checked_sub(1)).map(|at| brothers[at]);
        let last_topmost = || {
            brothers
                .iter()
                .copied()
                .filter(|&other| other != index && self.shown(other).topmost)
                .last()
        };

        match to {
            Insert::Stay => true,
            Insert::Bottom => at.is_some_and(|at| at + 1 == brothers.len()),
            Insert::Top if parent.is_some() || topmost => before.is_none(),
            Insert::Top => before == last_topmost(),
            Insert::Topmost => topmost && before.is_none(),
            Insert::NotTopmost => !topmost,
            Insert::After(other) => before == Some(other) && self.shown(other).topmost == topmost,
        }
    }

    pub(crate) fn reorder(&mut self, index: usize, to: Insert) -> bool {
        let parent = self.shown(index).parent;
        let order = self.z_order.clone();
        let topmost = self.shown(index).topmost;

        if to == Insert::Stay {
            return false;
        }

        // Drawn as `SetWindowPos` draws its list (`end_placing`): what it
        // uncovers due where it now shows -- children that draw over their
        // brothers, without `WS_CLIPSIBLINGS`, show as much as before, and
        // nothing is.
        self.begin_placing(&[index]);
        self.placing_flags(index, SWP_NOMOVE | SWP_NOSIZE);

        match to {
            Insert::Stay => {}
            Insert::Top | Insert::Topmost | Insert::NotTopmost => {
                if parent.is_none() {
                    match to {
                        Insert::Topmost => self.set_topmost(index, true),
                        Insert::NotTopmost => self.set_topmost(index, false),
                        _ => {}
                    }
                }

                self.put_in_front(index);
            }
            Insert::Bottom => {
                if parent.is_none() {
                    self.set_topmost(index, false);
                }

                let family = self.take_out(|system, other| system.within(other, index));
                let at = parent
                    .and_then(|parent| self.z_order.iter().position(|&other| other == parent))
                    .unwrap_or(self.z_order.len());

                self.z_order.splice(at..at, family);
            }
            Insert::After(other) => {
                if parent.is_none() {
                    let other_topmost = self.shown(other).topmost;

                    self.set_topmost(index, other_topmost);
                }

                let family = self.take_out(|system, member| system.within(member, index));
                let at = self
                    .z_order
                    .iter()
                    .position(|&member| member == other)
                    .map_or(self.z_order.len(), |at| at + 1);

                self.z_order.splice(at..at, family);
            }
        }

        // A hidden window made topmost where it lies is not moved
        // (`sysdlg`: a system-modal dialog, at the front, hidden, is asked
        // and not told).
        let changed =
            self.z_order != order || (self.shown(index).topmost != topmost && self.showing(index));

        self.end_placing(Some(false));

        changed
    }

    /// A window made topmost or not, its extended style with it, as
    /// `GetWindowLong` reads it (`swporder`).
    fn set_topmost(&mut self, index: usize, topmost: bool) {
        let shown = self.shown_mut(index);

        shown.topmost = topmost;

        if topmost {
            shown.ex_style |= WS_EX_TOPMOST;
        } else {
            shown.ex_style &= !WS_EX_TOPMOST;
        }
    }

    /// A window and its children put in front of its brothers, nothing
    /// drawn: a child in front of its parent's other children, and a window
    /// at the top in front of those of its kind, the topmost first.
    fn put_in_front(&mut self, index: usize) {
        let parent = self.shown(index).parent;
        let family = self.take_out(|system, other| system.within(other, index));
        let at = match parent {
            Some(parent) => self
                .z_order
                .iter()
                .position(|&other| other != parent && self.within(other, parent))
                .or_else(|| self.z_order.iter().position(|&other| other == parent))
                .unwrap_or(self.z_order.len()),
            None => self.front_of(index),
        };

        self.z_order.splice(at..at, family);
    }

    /// A window moved or sized as `SetWindowPos` places it, as one window of
    /// its list (`begin_placing`, `end_placing`): its update region, and its
    /// children's, moved with it; where its bits go and how far they come
    /// worked out as seg7 `0e8f`-`1166` does -- with `nccalc` false, moved
    /// alone, the whole window, or with `SWP_NOCOPYBITS` the rectangle
    /// `stale` the entry kept from the call before; with `nccalc`, nowhere
    /// with `SWP_NOCOPYBITS` or to be drawn again, else the client area as
    /// `WM_NCCALCSIZE` kept it, `kept` (`nccalc`). The rectangle it went by
    /// is answered, for the entry. Drawn with the list (`end_placing`). The
    /// TypeScript engine's `moveWithBits`.
    #[allow(clippy::too_many_lines, clippy::too_many_arguments)]
    pub(crate) fn move_with_bits(
        &mut self,
        index: usize,
        place: [i32; 4],
        copy: bool,
        kept: Option<Kept>,
        all_shown: Option<bool>,
        nccalc: bool,
        stale: [i32; 4],
    ) -> Result<[i32; 4], crate::call::Stop> {
        let [left, top, width, height] = place;

        self.begin_placing(&[index]);

        let at = self.entry_of(index);
        let (old_width, old_height) = {
            let shown = self.shown(index);

            (shown.width, shown.height)
        };
        let old_client = client_of(self, index);
        let old_place = place_of(self, index);
        // The window and its children, whose update regions go with them
        // (seg7 `0b1a`-`0b41`, seg2 `0a1d`); one due all over stays so.
        let members: Vec<usize> = std::iter::once(index)
            .chain(
                self.z_order
                    .iter()
                    .copied()
                    .filter(|&other| other != index && self.within(other, index)),
            )
            .collect();
        let was: Vec<Was> = members
            .iter()
            .map(|&member| {
                let shown = self.shown(member);
                let due = (shown.needs_paint && shown.dirty.is_some()).then(|| {
                    (
                        self.update_region(member),
                        shown.needs_erase,
                        shown.walked.clone(),
                    )
                });

                (place_of(self, member), due)
            })
            .collect();
        let title = self.shown(index).icon_title;
        let title_was = title.map(|title| place_of(self, title));

        let relocated = self.relocate(index, left, top, width, height);

        if let Err(stop) = relocated {
            self.end_placing(all_shown);
            return Err(stop);
        }

        for (k, &member) in members.iter().enumerate() {
            if let Some((region, erase, walked)) = &was[k].1 {
                let now = place_of(self, member);
                let (mx, my) = (now[0] - was[k].0[0], now[1] - was[k].0[1]);

                self.set_update_of(member, region.offset(mx, my), *erase);
                self.shown_mut(member).walked = walked
                    .as_ref()
                    .map(|walked| walked.as_ref().map(|region| region.offset(mx, my)));
            }
        }

        let sized = width != old_width || height != old_height;
        let class_style = self.class_style(index);
        let redraw = match kept {
            Some(kept) => kept == Kept::Nothing,
            None => {
                (class_style & CS_HREDRAW != 0 && width != old_width)
                    || (class_style & CS_VREDRAW != 0 && height != old_height)
            }
        };
        let new_client = client_of(self, index);
        // Where the bits go and how far they come (seg7 `0e8f`-`1166`).
        let mut dest = [0; 4];
        let mut delta = (left - old_place[0], top - old_place[1]);

        if !nccalc {
            dest = if copy { place_of(self, index) } else { stale };
        } else if copy && !redraw {
            if let Some(Kept::Bits { rect, delta: by }) = kept {
                delta = by;
                dest = cut(rect, new_client);
            } else if sized {
                delta = (new_client[0] - old_client[0], new_client[1] - old_client[1]);
                dest = cut(
                    new_client,
                    [
                        old_client[0] + delta.0,
                        old_client[1] + delta.1,
                        old_client[2] + delta.0,
                        old_client[3] + delta.1,
                    ],
                );
            } else {
                dest = place_of(self, index);
            }
        }

        // An icon's title, a window of its own, is made due where it was and
        // is.
        let extra = match (title, title_was) {
            (Some(title), Some(title_was)) => {
                let title_now = place_of(self, title);

                Some(
                    ClipRegion::rect(title_was[0], title_was[1], title_was[2], title_was[3]).union(
                        &ClipRegion::rect(title_now[0], title_now[1], title_now[2], title_now[3]),
                    ),
                )
            }
            _ => None,
        };

        if let Some(list) = self.placing.as_mut() {
            let entry = &mut list.entries[at];

            entry.dest = Some(dest);
            entry.delta = delta;

            if let Some(extra) = extra {
                entry.extra = Some(match entry.extra.take() {
                    Some(more) => more.union(&extra),
                    None => extra,
                });
            }
        }

        self.end_placing(all_shown);

        Ok(dest)
    }

    /// The windows `SetWindowPos` is placing, as one list (`USER.EXE` seg7
    /// `0526`), until `end_placing`: each window's visible region as it
    /// was, taken before anything of the list is placed (`09a0`); and the
    /// screen as it was, for the bits a `CS_SAVEBITS` window saves as it is
    /// shown (`0b75`-`0bde`). Lists begun within a list are of it. Every
    /// context's bounds are taken back first for the records USER keeps
    /// (`057a`). The TypeScript engine's `beginPlacing`.
    pub(crate) fn begin_placing(&mut self, windows: &[usize]) {
        if let Some(list) = self.placing.as_mut() {
            list.depth += 1;
        } else {
            if self.any_kept() {
                self.harvest_all();
            }

            let screen = self.screen_bitmap().indices.borrow().clone();

            self.placing = Some(PlacingList {
                entries: Vec::new(),
                screen,
                depth: 1,
            });
        }

        for &window in windows {
            self.entry_of(window);
        }
    }

    /// A window's entry in the list, by its place, its region as it was
    /// taken as it is first named.
    fn entry_of(&mut self, window: usize) -> usize {
        if let Some(at) = self
            .placing
            .as_ref()
            .and_then(|list| list.entries.iter().position(|entry| entry.window == window))
        {
            return at;
        }

        let old = if self.showing(window) {
            self.placed_region(window)
        } else {
            ClipRegion::EMPTY
        };
        let was_visible = self.shown(window).visible;
        let was_at = self.placing_key(window);
        let list = self.placing.as_mut().expect("a list being placed");

        list.entries.push(Placing {
            window,
            old,
            was_visible,
            was_at,
            dest: None,
            delta: (0, 0),
            whole: false,
            skip: false,
            flags: None,
            extra: None,
        });

        list.entries.len() - 1
    }

    /// Where a window is, to tell whether the list changed it (`PlaceKey`).
    fn placing_key(&self, window: usize) -> PlaceKey {
        let shown = self.shown(window);
        let parent = shown.parent;
        let front = self
            .z_order
            .iter()
            .copied()
            .take_while(|&other| other != window)
            .filter(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_some_and(|one| one.parent == parent)
            })
            .collect();

        (
            [shown.left, shown.top, shown.width, shown.height],
            shown.visible,
            front,
        )
    }

    /// A window of the list, named so where a list is being placed.
    pub(crate) fn placing_entry(&mut self, window: usize) -> Option<&mut Placing> {
        self.placing.as_ref()?;

        let at = self.entry_of(window);

        self.placing.as_mut().map(|list| &mut list.entries[at])
    }

    /// What a window of the list was asked, `SWP_` flags: where none are
    /// given, moved or sized. The bits it kept are let go by them
    /// (`088f`-`08b3`).
    pub(crate) fn placing_flags(&mut self, window: usize, flags: u16) {
        if let Some(entry) = self.placing_entry(window) {
            entry.flags = Some(flags);
        }
    }

    /// A window of the list drawn by its caller already: nothing more for
    /// it here.
    pub(crate) fn placing_skip(&mut self, window: usize) {
        if let Some(entry) = self.placing_entry(window) {
            entry.skip = true;
        }
    }

    /// A window of the list due all of itself by its caller, as a window
    /// shown by `ShowWindow` is: not made due again through itself.
    pub(crate) fn placed_whole(&mut self, window: usize) {
        if let Some(entry) = self.placing_entry(window) {
            entry.whole = true;
        }
    }

    /// The list drawn as `SetWindowPos` draws it once every window of it is
    /// placed (`USER.EXE` seg7 `0526`), at the end of the outermost list.
    /// **Read out**, window by window in the list's order (`05c4`-`092e`):
    ///
    /// * Nothing at all where the parent of the first window does not show
    ///   (`0557`-`0560`).
    /// * A window shown with `CS_SAVEBITS` keeps the bits beneath it first,
    ///   as it is placed (`0b75`-`0bde`; `save_bits`).
    /// * Its visible region as it is now (`05e0`); what is copied
    ///   (`060b`-`0705`): where its bits go (`dest`), moved back by how far
    ///   they come, within its old region, **less what the windows before it
    ///   copied** -- taken where its bits come from, which those copies may
    ///   have drawn over (`066e`-`068c`) -- moved on, less its update region
    ///   and its parents' up to one with `WS_CLIPCHILDREN` (none at all
    ///   where one is due all over), within its new region. Nothing where
    ///   either region is empty or it is due all over. Blitted from the
    ///   screen as it is, the windows before it copied already
    ///   (`0713`-`0768`).
    /// * A window that kept bits, and showed where it does not now, has them
    ///   put back there; what is left due is that, with all of its new
    ///   region (`076d`-`07f3`), and what was copied counts only outside it.
    ///   Else what is due is its old region and its new together
    ///   (`07f5`-`0828`).
    /// * **Less what every window so far copied** (`082a`-`088c`).
    /// * The bits a window kept let go where it was placed otherwise than
    ///   shown, or than with nothing but `SWP_NOZORDER | SWP_NOMOVE |
    ///   SWP_NOSIZE` (`088f`-`08b3`; `placing_flags`).
    /// * A window nothing of which was copied, that shows now, due all over
    ///   through itself, frame and all (`08de`-`08f0`, 485h).
    /// * What is due gathered (`08f5`-`092a`), and made due once through the
    ///   parent of the first window (`0939`-`0958`): `RDW_NOCHILDREN` where
    ///   every window was shown and is of a program made before 3.10
    ///   (`all_shown`; counted by the windows themselves where not given),
    ///   else `RDW_ALLCHILDREN`.
    ///
    /// The TypeScript engine's `endPlacing`.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn end_placing(&mut self, all_shown: Option<bool>) {
        let Some(list) = self.placing.as_mut() else {
            return;
        };

        list.depth -= 1;

        if list.depth > 0 {
            return;
        }

        let list = self.placing.take().expect("a list being placed");

        self.own();

        let parent = list
            .entries
            .first()
            .and_then(|entry| self.windows[entry.window].as_ref())
            .and_then(|shown| shown.parent);

        if list.entries.is_empty() || parent.is_some_and(|parent| !self.showing(parent)) {
            return;
        }

        // A window destroyed while the list was placed -- an icon's title
        // going with its icon -- shows nowhere now.
        let exists = |system: &Self, index: usize| system.windows[index].is_some();

        // Kept as each is shown, the screen as it was (`0b75`-`0bde`).
        for entry in &list.entries {
            if !entry.was_visible
                && exists(self, entry.window)
                && self.z_order.contains(&entry.window)
                && self.shown(entry.window).visible
            {
                self.save_under(entry.window, &list.screen);
            }
        }

        let all_shown = if let Some(all_shown) = all_shown {
            all_shown
        } else {
            let mut every = true;

            for entry in &list.entries {
                every = every
                    && !entry.was_visible
                    && exists(self, entry.window)
                    && self.shown(entry.window).visible
                    && !self.made_for_31(entry.window);
            }

            every
        };
        let (screen_width, screen_height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );
        let screen = self.screen_bitmap();
        let mut copied_so_far: Option<ClipRegion> = None;
        let mut gathered: Option<ClipRegion> = None;

        for entry in &list.entries {
            // Nothing done to it -- not moved, sized, shown, hidden nor put
            // elsewhere among its brothers -- it is passed over (seg7
            // `0a4f`-`0a96`: its flags against 1807h, or against 1803h where
            // it lies where it was asked, `1184`, marked `SWP_NOREDRAW`;
            // `05c7`).
            let index = entry.window;
            let alive = exists(self, index);

            if entry.skip || (alive && entry.was_at == self.placing_key(index)) {
                continue;
            }

            let old = &entry.old;
            let delta = entry.delta;
            let now = if alive && self.z_order.contains(&index) && self.showing(index) {
                self.placed_region(index)
            } else {
                ClipRegion::EMPTY
            };
            let dest = match entry.dest {
                Some(dest) => dest,
                None if alive => place_of(self, index),
                None => [0; 4],
            };
            let (old_shows, now_shows) = (old.kind() > 1, now.kind() > 1);
            let due_all = alive && {
                let shown = self.shown(index);

                shown.needs_paint && shown.dirty.is_none()
            };

            // What is copied (`060b`-`0705`).
            let mut copied: Option<ClipRegion> = None;

            if dest[0] < dest[2] && dest[1] < dest[3] && old_shows && now_shows && !due_all {
                let mut part = ClipRegion::rect(
                    dest[0] - delta.0,
                    dest[1] - delta.1,
                    dest[2] - delta.0,
                    dest[3] - delta.1,
                )
                .intersect(old);

                if part.kind() > 1
                    && let Some(so_far) = &copied_so_far
                {
                    part = part.subtract(so_far);
                }

                let mut part = (part.kind() > 1).then(|| part.offset(delta.0, delta.1));
                let mut up = Some(index);

                while let Some(window) = up {
                    let Some(left_over) = part.take() else {
                        break;
                    };
                    let shown = self.shown(window);
                    let next = if !shown.needs_paint {
                        Some(left_over)
                    } else if shown.dirty.is_some() {
                        Some(left_over.subtract(&self.update_region(window)))
                    } else {
                        None
                    };

                    part = next.filter(|part| part.kind() > 1);
                    up = shown
                        .parent
                        .filter(|&parent| self.shown(parent).style & WS_CLIPCHILDREN == 0);
                }

                copied = part
                    .map(|part| part.intersect(&now))
                    .filter(|copied| copied.kind() > 1);
            }

            // Blitted from the screen as it is (`0727`-`0768`).
            if let Some(copied) = &copied
                && delta != (0, 0)
            {
                let bits = screen.indices.borrow().clone();

                for band in &copied.bands {
                    for y in band.top.max(0)..band.bottom.min(screen_height) {
                        for &(span_left, span_right) in &band.spans {
                            for x in span_left.max(0)..span_right.min(screen_width) {
                                let (fx, fy) = (x - delta.0, y - delta.1);

                                if fx >= 0 && fy >= 0 && fx < screen_width && fy < screen_height {
                                    screen.put(x, y, bits[(fy * screen_width + fx) as usize]);
                                }
                            }
                        }
                    }
                }
            }

            let nothing_copied = copied.is_none();

            // What is due: put back where it kept bits (`076d`-`07f3`), else
            // its old region and its new together (`07f5`-`0828`).
            let uncovered = if !old_shows {
                ClipRegion::EMPTY
            } else if now_shows {
                old.subtract(&now)
            } else {
                old.clone()
            };
            let mut due: Option<ClipRegion> = None;

            if alive && self.has_saved(index) && old_shows && uncovered.kind() > 1 {
                let (still_due, region) = self.restore_under(index, &uncovered);

                if still_due || now_shows {
                    let made = if now_shows {
                        region.union(&now)
                    } else {
                        region
                    };

                    if let Some(part) = copied.take() {
                        let part = part.subtract(&made);

                        copied = Some(if part.kind() <= 1 {
                            ClipRegion::EMPTY
                        } else {
                            part
                        });
                    }

                    due = Some(made);
                }
            } else if old_shows || now_shows {
                due = Some(if !old_shows {
                    now.clone()
                } else if !now_shows {
                    old.clone()
                } else {
                    old.union(&now)
                });
            }

            if let Some(copied) = &copied {
                copied_so_far = Some(match copied_so_far.take() {
                    Some(so_far) => so_far.union(copied),
                    None => copied.clone(),
                });
            }

            if let (Some(made), Some(so_far)) = (due.as_mut(), &copied_so_far) {
                *made = made.subtract(so_far);
            }

            if let (Some(made), Some(extra)) = (due.as_mut(), &entry.extra) {
                *made = made.union(extra);
            }

            // Placed otherwise than shown, or than with nothing but
            // `SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE`, the bits it kept are
            // let go (`088f`-`08b3`).
            let flags = entry.flags.unwrap_or(0);

            if alive
                && self.has_saved(index)
                && flags & SWP_SHOWWINDOW == 0
                && flags & 0x87 != SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE
            {
                self.discard_saved(index);
            }

            let Some(due) = due.filter(|due| due.kind() > 1) else {
                continue;
            };

            if nothing_copied && now_shows && !entry.whole {
                self.invalidate_through(
                    Some(index),
                    None,
                    RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN,
                );
            }

            gathered = Some(match gathered.take() {
                Some(more) => more.union(&due),
                None => due,
            });
        }

        if let Some(gathered) = gathered.filter(|gathered| gathered.kind() > 1) {
            self.invalidate_through(
                parent,
                Some(&gathered),
                RDW_INVALIDATE
                    | RDW_ERASE
                    | if all_shown {
                        RDW_NOCHILDREN
                    } else {
                        RDW_ALLCHILDREN
                    },
            );
        }
    }

    /// A window's visible region as `SetWindowPos` works it out before and
    /// after it places it (`USER.EXE` seg7 `0c19`): nothing for a window
    /// hidden, else USER's rule for its whole window, with
    /// `DCX_CLIPSIBLINGS` where it has `WS_CLIPSIBLINGS` (seg1 `1582`).
    pub(crate) fn placed_region(&self, index: usize) -> ClipRegion {
        let shown = self.shown(index);

        if !shown.visible {
            return ClipRegion::EMPTY;
        }

        let flags = DCX_WINDOW
            | if shown.style & WS_CLIPSIBLINGS != 0 {
                DCX_CLIPSIBLINGS
            } else {
                0
            };

        self.window_region(index, index, flags)
    }
}
