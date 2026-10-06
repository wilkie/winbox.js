//! A window moved, sized or put elsewhere in the order of windows as
//! `SetWindowPos` does it, as winbox.js's `desktop.ts` does: what it keeps
//! of what it showed, and what is due a paint after.
//!
//! **Recorded** by `swpbits`, a pop-up moved over a window beneath it:
//!
//! * Moved, its bits go with it: the screen shows it at its new place at
//!   once, and it is sent nothing to paint -- not `WM_NCPAINT`, not
//!   `WM_ERASEBKGND`, not `WM_PAINT`. So is a window with a caption, and a
//!   child in its parent. What could not come with it -- what another
//!   window covered of it -- is due, and erased at once.
//! * With `SWP_NOCOPYBITS` nothing is copied, and what of its new place
//!   already showed it is left as it is: it is due everywhere else.
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

use crate::system::System;

const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const WS_EX_TOPMOST: u32 = 0x0000_0008;
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

/// A window's place before it moved, and what it was due then, if
/// anything: the region, and whether it was to be erased.
type Was = ([i32; 4], Option<(ClipRegion, bool)>);

/// Rows of pixels, `(y, left, right)`, gathered a pixel at a time, row by
/// row.
#[derive(Debug, Default)]
struct Spans(Vec<(i32, i32, i32)>);

impl Spans {
    fn add(&mut self, x: i32, y: i32) {
        if let Some(last) = self.0.last_mut()
            && last.0 == y
            && last.2 == x
        {
            last.2 += 1;
            return;
        }

        self.0.push((y, x, x + 1));
    }

    fn region(&self) -> ClipRegion {
        ClipRegion::from_spans(&self.0)
    }
}

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

fn inside([left, top, right, bottom]: [i32; 4], x: i32, y: i32) -> bool {
    x >= left && x < right && y >= top && y < bottom
}

fn union(a: [i32; 4], b: [i32; 4]) -> [i32; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
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
    pub(crate) fn reorder(&mut self, index: usize, to: Insert) -> bool {
        let parent = self.shown(index).parent;
        let order = self.z_order.clone();
        let topmost = self.shown(index).topmost;
        let before = std::rc::Rc::clone(&self.owners);

        match to {
            Insert::Stay => return false,
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

        let changed = self.z_order != order || self.shown(index).topmost != topmost;

        if changed && self.showing(index) {
            self.own();

            // Children that draw over their brothers are not drawn again
            // for being put in front of them or behind.
            let except: Vec<usize> = match parent {
                Some(parent) => self
                    .z_order
                    .iter()
                    .copied()
                    .filter(|&other| {
                        let mut at = other;

                        while let Some(up) = self.shown(at).parent {
                            if up == parent {
                                return self.shown(at).style & WS_CLIPSIBLINGS == 0;
                            }

                            at = up;
                        }

                        false
                    })
                    .collect(),
                None => Vec::new(),
            };

            self.gained(&before, &except);
        }

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

    /// A window moved or sized as `SetWindowPos` moves it: its bits, and
    /// its children's, taken with it unless `copy` is false; what did not
    /// come with it due, and what it uncovered due in the windows that show
    /// there now.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn move_with_bits(
        &mut self,
        index: usize,
        place: [i32; 4],
        copy: bool,
    ) -> Result<(), crate::call::Stop> {
        let [left, top, width, height] = place;

        if !self.showing(index) {
            return self.place_window(index, left, top, width, height);
        }

        // Before: who showed where, what the screen showed, and each of the
        // family's place and what it was due.
        let before = std::rc::Rc::clone(&self.owners);
        let screen = self.screen_bitmap();
        let bits = screen.indices.borrow().clone();
        let (old_width, old_height) = {
            let shown = self.shown(index);

            (shown.width, shown.height)
        };
        let old_client = client_of(self, index);
        // The window first, then its children, then an icon's title.
        let mut members: Vec<usize> = std::iter::once(index)
            .chain(
                self.z_order
                    .iter()
                    .copied()
                    .filter(|&other| other != index && self.within(other, index)),
            )
            .collect();

        if let Some(title) = self.shown(index).icon_title {
            members.push(title);
        }

        let was: Vec<Was> = members
            .iter()
            .map(|&member| {
                let due = self
                    .shown(member)
                    .needs_paint
                    .then(|| (self.update_region(member), self.shown(member).needs_erase));

                (place_of(self, member), due)
            })
            .collect();

        self.relocate(index, left, top, width, height)?;
        self.own();

        let sized = width != old_width || height != old_height;
        let style = self.class_style(index);
        let redraw = (style & CS_HREDRAW != 0 && width != old_width)
            || (style & CS_VREDRAW != 0 && height != old_height);
        let new_client = client_of(self, index);
        // How far the bits go: with the window, or sized, with its client
        // area; without copying, nowhere.
        let delta = if !copy {
            (0, 0)
        } else if sized {
            (new_client[0] - old_client[0], new_client[1] - old_client[1])
        } else {
            (left - was[0].0[0], top - was[0].0[1])
        };
        let (screen_width, screen_height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );
        let area = members
            .iter()
            .zip(&was)
            .fold(None, |area: Option<[i32; 4]>, (&member, (old, _))| {
                let both = union(*old, place_of(self, member));

                Some(area.map_or(both, |area| union(area, both)))
            })
            .unwrap_or_default();
        let ids: Vec<u16> = members.iter().map(|&member| (member + 1) as u16).collect();
        let mut invalid: Vec<Spans> = members.iter().map(|_| Spans::default()).collect();
        let mut vacated: Vec<(usize, Spans)> = Vec::new();
        let mut desktop: Option<[i32; 4]> = None;

        for y in area[1].max(0)..area[3].min(screen_height) {
            for x in area[0].max(0)..area[2].min(screen_width) {
                let at = (y * screen_width + x) as usize;
                let now = self.owners[at];
                let then = before.get(at).copied().unwrap_or(0);

                if let Some(k) = ids.iter().position(|&id| id == now) {
                    let (fx, fy) = (x - delta.0, y - delta.1);
                    let from = (fy * screen_width + fx) as usize;
                    let valid = !redraw
                        && fx >= 0
                        && fy >= 0
                        && fx < screen_width
                        && fy < screen_height
                        && before.get(from).copied() == Some(now)
                        && (!sized
                            || members[k] != index
                            || inside(new_client, x, y) && inside(old_client, fx, fy))
                        && !was[k]
                            .1
                            .as_ref()
                            .is_some_and(|(due, _)| due.contains(fx, fy));

                    if !valid {
                        invalid[k].add(x, y);
                    } else if delta != (0, 0) {
                        screen.put(x, y, bits[from]);
                    }
                } else if then != 0 && ids.contains(&then) {
                    if now == 0 {
                        let pixel = [x, y, x + 1, y + 1];

                        desktop = Some(desktop.map_or(pixel, |box_| union(box_, pixel)));
                    } else {
                        let other = usize::from(now) - 1;

                        if let Some((_, spans)) =
                            vacated.iter_mut().find(|(window, _)| *window == other)
                        {
                            spans.add(x, y);
                        } else {
                            let mut spans = Spans::default();

                            spans.add(x, y);
                            vacated.push((other, spans));
                        }
                    }
                }
            }
        }

        // The family: due where its bits did not come with it, and where it
        // was due before, which goes with it.
        let mut not_copied = ClipRegion::EMPTY;

        for (k, &member) in members.iter().enumerate() {
            let region = invalid[k].region();
            let moved = {
                let now = place_of(self, member);

                (now[0] - was[k].0[0], now[1] - was[k].0[1])
            };
            let (due, erase) = match &was[k].1 {
                Some((due, erase)) => (
                    region.union(&due.offset(moved.0, moved.1)),
                    *erase || region.kind() > 1,
                ),
                None => (region.clone(), true),
            };

            not_copied = not_copied.union(&region);

            {
                let shown = self.shown_mut(member);

                shown.needs_paint = false;
                shown.needs_erase = false;
                shown.dirty = None;
                shown.dirty_shape = None;
                shown.quiet_dirty = None;
            }

            if due.kind() <= 1 {
                continue;
            }

            if self.showing(member) {
                if self.shown(member).paints_itself() {
                    self.shown_mut(member).needs_nc_paint = true;
                }

                self.paint_frame(member);
            }

            let client = client_of(self, member);
            let part = due.intersect(&ClipRegion::rect(
                client[0], client[1], client[2], client[3],
            ));

            self.set_update_of(member, part, erase);
        }

        // What it uncovered: the desktop there drawn again, and each window
        // that shows there now due there.
        if let Some(area) = desktop {
            self.paint_background_in(area);
        }

        let parent = self.shown(index).parent;

        for (other, spans) in vacated {
            if self.windows[other].is_some() {
                let frame = parent.is_none() || !self.within(index, other);

                self.due_region(other, &spans.region(), frame);
            }
        }

        // A parent that paints over its children is due where the child is.
        let mut child = index;

        while let Some(up) = self.shown(child).parent {
            if self.shown(up).style & WS_CLIPCHILDREN != 0 || not_copied.kind() <= 1 {
                break;
            }

            self.due_region(up, &not_copied, false);
            child = up;
        }

        Ok(())
    }

    /// A window due a paint where `region` is, added to what it was due;
    /// its frame by `WM_NCPAINT` with `frame`, and an icon's title, which
    /// has no window procedure, drawn now.
    fn due_region(&mut self, index: usize, region: &ClipRegion, frame: bool) {
        if !self.shown(index).paints_itself() {
            self.paint_frame(index);
        } else if frame {
            self.shown_mut(index).needs_nc_paint = true;
        }

        let client = client_of(self, index);
        let part = region.intersect(&ClipRegion::rect(
            client[0], client[1], client[2], client[3],
        ));

        if part.kind() <= 1 {
            return;
        }

        let shown = self.shown(index);

        // Due all of it already, it stays so.
        if shown.needs_paint && shown.dirty.is_none() {
            self.shown_mut(index).needs_erase = true;
            return;
        }

        let due = if shown.needs_paint {
            self.update_region(index).union(&part)
        } else {
            part
        };

        self.set_update_of(index, due, true);
    }
}
