//! The raster desktop's windows as winbox.js's `desktop.ts` keeps them:
//! their order, which of them shows where, which is active, and what each
//! is due to have drawn again -- its frame, its erase, its paint, and how
//! much of it. What is due is what decides the messages a program is sent;
//! the pixels themselves come with the screen, which is not ported yet, so
//! the drawing here -- a frame, the desktop's background -- draws nothing.
//!
//! A window's place in `System::z_order` is its place among the desktop's
//! windows, the topmost first; a pixel's owner is its window's index plus
//! one, nought for the desktop.

use crate::system::System;
use crate::windows::{Dirty, Placement, Window};

const WS_CLIPCHILDREN: u32 = 0x0200_0000;

/// A box's union with another.
fn union(a: [i32; 4], b: [i32; 4]) -> [i32; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}

/// The first window from `index` down, it before its children, that `due`
/// takes.
fn walk(system: &System, index: usize, due: &dyn Fn(&System, usize) -> bool) -> Option<usize> {
    if due(system, index) {
        return Some(index);
    }

    system
        .z_order
        .iter()
        .copied()
        .filter(|&child| system.shown(child).parent == Some(index))
        .find_map(|child| walk(system, child, due))
}

impl System {
    fn shown(&self, index: usize) -> &Window {
        self.windows[index]
            .as_ref()
            .expect("a window not destroyed")
    }

    fn shown_mut(&mut self, index: usize) -> &mut Window {
        self.windows[index]
            .as_mut()
            .expect("a window not destroyed")
    }

    /// A box due a paint, with a mark of its own.
    pub fn dirty_box(&mut self, area: [i32; 4]) -> Dirty {
        self.dirty_marks += 1;
        Dirty {
            area,
            mark: self.dirty_marks,
        }
    }

    /// Whether a window and every window it is in show: a window inside an
    /// icon does not.
    pub fn showing(&self, index: usize) -> bool {
        let mut at = Some(index);

        while let Some(window) = at {
            let shown = self.shown(window);

            if !shown.visible || (window != index && shown.placement == Placement::Minimized) {
                return false;
            }

            at = shown.parent;
        }

        true
    }

    /// Whether a window is `ancestor` or one of its children, however deep.
    pub fn within(&self, index: usize, ancestor: usize) -> bool {
        let mut at = Some(index);

        while let Some(window) = at {
            if window == ancestor {
                return true;
            }

            at = self.shown(window).parent;
        }

        false
    }

    /// Whether a window, or the window at the top it is in, is owned by
    /// another, at any remove.
    pub fn owned_within(&self, index: usize, owner: usize) -> bool {
        let mut top = index;

        while let Some(parent) = self.shown(top).parent {
            top = parent;
        }

        let mut at = self.shown(top).owner;

        while let Some(window) = at {
            if window == owner {
                return true;
            }

            at = self.shown(window).owner;
        }

        false
    }

    /// The window made active last, if it is still showing.
    pub fn active_window(&self) -> Option<usize> {
        self.z_order.iter().copied().find(|&index| {
            let shown = self.shown(index);

            shown.active && shown.visible
        })
    }

    /// The active window at the top: a document window inside one does not
    /// count.
    pub fn active_top(&self) -> Option<usize> {
        self.z_order.iter().copied().find(|&index| {
            let shown = self.shown(index);

            shown.active && shown.visible && shown.parent.is_none()
        })
    }

    /// A window made active or not: its caption follows the activation
    /// again.
    pub fn set_active(&mut self, index: usize, active: bool) {
        let shown = self.shown_mut(index);

        shown.active = active;
        shown.lit = None;
    }

    /// Where a window at the top goes among the windows: at the front of its
    /// kind, the topmost first.
    pub fn front_of(&self, index: usize) -> usize {
        if self.shown(index).topmost {
            return 0;
        }

        self.z_order
            .iter()
            .position(|&other| other == index || !self.shown(other).topmost)
            .unwrap_or(self.z_order.len())
    }

    /// The windows `pick` takes, taken out of the order, as they lay.
    fn take_out(&mut self, pick: impl Fn(&Self, usize) -> bool) -> Vec<usize> {
        let taken: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| pick(self, other))
            .collect();

        self.z_order.retain(|other| !taken.contains(other));
        taken
    }

    /// Which window each pixel of the screen shows, worked out again, and
    /// each window's place cut to its ancestors' client areas.
    pub fn own(&mut self) {
        let (width, height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );
        let mut owners = vec![0u16; (width * height) as usize];

        for &index in self.z_order.iter().rev() {
            if !self.showing(index) {
                continue;
            }

            let shown = self.shown(index);
            let mut left = shown.left.max(0);
            let mut top = shown.top.max(0);
            let mut right = (shown.left + shown.width).min(width);
            let mut bottom = (shown.top + shown.height).min(height);
            let mut at = shown.parent;

            while let Some(parent) = at {
                let parent = self.shown(parent);

                left = left.max(parent.left + parent.client.left);
                top = top.max(parent.top + parent.client.top);
                right = right.min(parent.left + parent.client.right);
                bottom = bottom.min(parent.top + parent.client.bottom);
                at = parent.parent;
            }

            let id = (index + 1) as u16;

            for y in top..bottom {
                if right > left {
                    let row = (y * width) as usize;

                    owners[row + left as usize..row + right as usize].fill(id);
                }
            }

            self.windows[index]
                .as_mut()
                .expect("a window not destroyed")
                .clip_rect = [left, top, right, bottom];
        }

        self.owners = owners;
    }

    /// A window due its frame and a paint where `area` is, added to what it
    /// was due already, or all of it where all of it was.
    fn due_at(&mut self, index: usize, area: [i32; 4]) {
        let (needs_paint, was) = {
            let shown = self.shown(index);

            (shown.needs_paint, shown.dirty)
        };
        let dirty = if needs_paint {
            was.map(|was| self.dirty_box(union(was.area, area)))
        } else {
            Some(self.dirty_box(area))
        };
        let shown = self.shown_mut(index);

        shown.needs_nc_paint = true;
        shown.dirty = dirty;
        shown.needs_erase = true;
        shown.needs_paint = true;
    }

    /// The areas of the screen each window has come to show since `before`,
    /// by window, in the order the TypeScript engine's map keeps them: the
    /// order each was first met, row by row.
    fn areas_since(
        &self,
        before: &[u16],
        within: Option<[i32; 4]>,
        counts: impl Fn(u16, u16) -> bool,
    ) -> Vec<(usize, [i32; 4])> {
        let width = i32::from(self.display.width);
        let height = i32::from(self.display.height);
        let [left, top, right, bottom] = within.unwrap_or([0, 0, width, height]);
        let mut areas: Vec<(usize, [i32; 4])> = Vec::new();

        for y in top.max(0)..bottom.min(height) {
            for x in left.max(0)..right.min(width) {
                let at = (y * width + x) as usize;
                let now = self.owners[at];

                if now == 0 || !counts(now, before.get(at).copied().unwrap_or(0)) {
                    continue;
                }

                let index = usize::from(now) - 1;

                match areas.iter_mut().find(|(window, _)| *window == index) {
                    Some((_, area)) => *area = union(*area, [x, y, x + 1, y + 1]),
                    None => areas.push((index, [x, y, x + 1, y + 1])),
                }
            }
        }

        areas
    }

    /// Every window that came to show where it had been covered, but those
    /// `except`, due its frame and a paint there.
    fn gained(&mut self, before: &[u16], except: &[usize]) {
        let skip: Vec<u16> = except.iter().map(|&index| (index + 1) as u16).collect();
        let areas = self.areas_since(before, None, |now, was| now != was && !skip.contains(&now));

        for (index, area) in areas {
            if self.windows[index].is_some() {
                self.due_at(index, area);
            }
        }
    }

    /// What a window gone from where it lay uncovered: each window that
    /// shows there now due there, and each parent of it that does not leave
    /// its children out of its own painting.
    fn expose_owned(&mut self, gone: usize, before: &[u16]) {
        self.paint_background();

        let ids: Vec<u16> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| self.within(other, gone))
            .chain(std::iter::once(gone))
            .map(|index| (index + 1) as u16)
            .collect();
        let shown = self.shown(gone);
        let place = [
            shown.left,
            shown.top,
            shown.left + shown.width,
            shown.top + shown.height,
        ];
        let areas = self.areas_since(before, Some(place), |_, was| ids.contains(&was));

        for (index, area) in areas {
            if self.windows[index].is_none() {
                continue;
            }

            self.due_at(index, area);

            let mut child = index;

            while let Some(parent) = self.shown(child).parent {
                if self.shown(parent).style & WS_CLIPCHILDREN != 0 {
                    break;
                }

                self.due_at(parent, area);
                child = parent;
            }
        }
    }

    /// A window's frame drawn: not yet, the screen not being here.
    pub fn paint_frame(&mut self, _index: usize) {}

    /// The desktop's own background drawn: not yet, as `paint_frame`.
    pub fn paint_background(&mut self) {}

    /// A window, its frame, children and all, due everything.
    fn due_whole(&mut self, index: usize) {
        self.paint_frame(index);

        let shown = self.shown_mut(index);

        shown.needs_erase = true;
        shown.needs_paint = true;
    }

    /// Shows a window, on top, and makes it the active one: its frame
    /// painted, and its client area left to be erased and painted when it
    /// is asked. A child only shows, where it lies.
    pub fn show(&mut self, index: usize) {
        if self.shown(index).parent.is_some() {
            self.shown_mut(index).visible = true;
            self.own();
            self.due_whole(index);

            // Its own children show with it.
            for other in self.z_order.clone() {
                if other != index && self.shown(other).visible && self.within(other, index) {
                    self.due_whole(other);
                }
            }

            return;
        }

        let was = self.active_window();
        let was_top = self.active_top();
        let shown_before = self.owners.clone();

        // To the top, and its children with it, as they were; the windows it
        // owns above it, in their order (`owners`).
        let family = self.take_out(|system, other| {
            system.within(other, index) || system.owned_within(other, index)
        });
        let owned_first: Vec<usize> = family
            .iter()
            .copied()
            .filter(|&member| !self.within(member, index))
            .chain(
                family
                    .iter()
                    .copied()
                    .filter(|&member| self.within(member, index)),
            )
            .collect();

        // An owned window brings the window that owns it up beneath it, with
        // the rest of what that one owns, as they were (`showseq`).
        let mut head = index;

        while let Some(owner) = self.shown(head).owner {
            if self.shown(owner).parent.is_some() {
                break;
            }

            head = owner;
        }

        let owners = if head == index {
            Vec::new()
        } else {
            self.take_out(|system, other| {
                !owned_first.contains(&other)
                    && (system.within(other, head) || system.owned_within(other, head))
            })
        };
        let beneath = owners
            .iter()
            .copied()
            .filter(|&member| !self.within(member, head))
            .chain(
                owners
                    .iter()
                    .copied()
                    .filter(|&member| self.within(member, head)),
            );
        let at = self.front_of(index);
        let placed: Vec<usize> = owned_first.iter().copied().chain(beneath).collect();

        self.z_order.splice(at..at, placed);
        self.shown_mut(index).visible = true;
        self.set_active(index, true);

        if let Some(was) = was.filter(|&was| was != index) {
            self.set_active(was, false);
        }

        // Its messages are to be sent; the focus moves with them.
        if was_top != Some(index) && self.pending_activation.is_none() {
            self.pending_activation = Some((was_top, false));
        }

        self.own();

        let mine: Vec<usize> = std::iter::once(index)
            .chain(
                family
                    .iter()
                    .copied()
                    .filter(|&member| self.within(member, index)),
            )
            .collect();

        self.gained(&shown_before, &mine);

        if let Some(was) = was.filter(|&was| was != index) {
            self.paint_frame(was);
        }

        self.paint_frame(index);

        // Its children show with it; an icon USER draws itself.
        for &child in &family {
            if child != index && self.within(child, index) && self.showing(child) {
                let icon = {
                    let shown = self.shown(child);

                    shown.placement == Placement::Minimized && shown.icon.is_some()
                };

                self.paint_frame(child);

                let shown = self.shown_mut(child);

                shown.needs_erase = !icon;
                shown.needs_paint = !icon;
            }
        }

        let shown = self.shown_mut(index);
        let drawn = shown.placement == Placement::Minimized && shown.icon.is_some();

        shown.needs_erase = !drawn;
        shown.needs_paint = !drawn;
    }

    /// A window shown where it lies, not brought to the top nor made active.
    pub fn show_in_place(&mut self, index: usize) {
        self.shown_mut(index).visible = true;
        self.own();
        self.paint_frame(index);

        let shown = self.shown_mut(index);
        let drawn = shown.placement == Placement::Minimized && shown.icon.is_some();

        shown.needs_erase = !drawn;
        shown.needs_paint = !drawn;
    }

    /// A window shown at the front of its kind, with its children, not
    /// made active (`SW_SHOWNA`).
    pub fn show_on_top(&mut self, index: usize) {
        let family = self.take_out(|system, other| system.within(other, index));
        let at = self.front_of(index);

        self.z_order.splice(at..at, family);
        self.shown_mut(index).visible = true;
        self.own();
        self.due_whole(index);
    }

    /// The windows a window owns, hidden as it is minimized and shown again
    /// as it is restored (`owners`).
    pub fn hide_owned(&mut self, index: usize, hide: bool) {
        for other in self.z_order.clone() {
            if self.shown(other).parent.is_some() || !self.owned_within(other, index) {
                continue;
            }

            if hide && self.shown(other).visible {
                {
                    let shown = self.shown_mut(other);

                    shown.hidden_with_owner = true;
                    shown.visible = false;
                }
                self.set_active(other, false);

                let before = self.owners.clone();

                self.own();
                self.expose_owned(other, &before);
            } else if !hide && self.shown(other).hidden_with_owner {
                {
                    let shown = self.shown_mut(other);

                    shown.hidden_with_owner = false;
                    shown.visible = true;
                }
                self.own();
                self.due_whole(other);
            }
        }
    }

    /// A window hidden: to the bottom, its children with it and kept.
    pub fn hide(&mut self, index: usize) {
        if !self.shown(index).visible {
            return;
        }

        let family = self.take_out(|system, other| system.within(other, index));

        self.z_order.extend(family);
        self.take_away(index, false);
    }

    /// A window taken off the screen, and with `remove` out of the desktop's
    /// windows with its children; otherwise it and they are kept, hidden.
    /// The next window down becomes the active one, as when a window closes
    /// -- or, for one destroyed, its owner, when it is still to be seen
    /// (`actnext`).
    pub fn take_away(&mut self, index: usize, remove: bool) {
        let (visible, active, owner, destroying) = {
            let shown = self.shown(index);

            (shown.visible, shown.active, shown.owner, shown.destroying)
        };
        let owner = owner.filter(|_| remove || destroying);
        let next = if visible && active {
            match owner {
                Some(owner)
                    if self.shown(owner).visible
                        && self.z_order.contains(&owner)
                        && !self.within(owner, index) =>
                {
                    Some(owner)
                }
                _ => self.z_order.iter().copied().find(|&other| {
                    let shown = self.shown(other);

                    other != index
                        && shown.visible
                        && shown.parent.is_none()
                        && !self.within(other, index)
                }),
            }
        } else {
            None
        };

        // A focus inside it goes, unless another window is activated, whose
        // messages move it.
        if next.is_none() && self.focus.is_some_and(|focus| self.within(focus, index)) {
            self.focus = None;
        }

        // Its children go first, with nothing to paint again: it covers them.
        if remove {
            for child in self.z_order.clone() {
                if self.shown(child).parent == Some(index) {
                    self.z_order.retain(|&other| other != child);
                    self.shown_mut(child).visible = false;
                }
            }

            self.z_order.retain(|&other| other != index);
        }

        if !visible {
            return;
        }

        self.shown_mut(index).visible = false;
        self.set_active(index, false);

        let before = self.owners.clone();

        self.own();
        self.expose_owned(index, &before);

        if active && let Some(next) = next {
            self.set_active(next, true);

            if self.pending_activation.is_none() {
                self.pending_activation = Some((Some(index), false));
            }

            self.paint_frame(next);
        }
    }

    /// The first window due a paint that `matches` takes: the windows at the
    /// top from the front back, each before its children (`showseq`), made
    /// ready to paint.
    pub fn unpainted_where(&mut self, matches: impl Fn(&Self, usize) -> bool) -> Option<usize> {
        if !self
            .z_order
            .iter()
            .any(|&index| self.shown(index).needs_paint)
        {
            return None;
        }

        let due = |system: &Self, index: usize| {
            system.shown(index).needs_paint && system.showing(index) && matches(system, index)
        };

        let found = self
            .z_order
            .iter()
            .copied()
            .filter(|&index| self.shown(index).parent.is_none())
            .find_map(|index| walk(self, index, &due))?;

        self.about_to_paint(found);
        Some(found)
    }

    /// A window about to be sent `WM_PAINT`: for one without
    /// `WS_CLIPCHILDREN`, which paints over its children, its children
    /// where it is due made due again after it.
    pub fn about_to_paint(&mut self, index: usize) {
        if self.shown(index).needs_frame {
            self.shown_mut(index).needs_frame = false;
            self.paint_frame(index);
        }

        let (dirty, quiet, shape, style) = {
            let shown = self.shown(index);
            let dirty = shown.dirty;
            let quiet = dirty.is_some_and(|dirty| shown.quiet_dirty == Some(dirty.mark));
            let shape = match (dirty, &shown.dirty_shape) {
                (Some(dirty), Some((shape, mark))) if *mark == dirty.mark => Some(shape.clone()),
                _ => None,
            };

            (dirty.map(|dirty| dirty.area), quiet, shape, shown.style)
        };

        {
            let shown = self.shown_mut(index);

            shown.paint_shape = shape;
            shown.dirty = None;
            shown.dirty_shape = None;
            shown.quiet_dirty = None;
            shown.paint_clip = dirty;
        }

        if style & WS_CLIPCHILDREN != 0 || quiet {
            return;
        }

        for other in self.z_order.clone() {
            let place = {
                let shown = self.shown(other);

                [
                    shown.left,
                    shown.top,
                    shown.left + shown.width,
                    shown.top + shown.height,
                ]
            };
            let inside = dirty.is_none_or(|dirty| {
                place[0] < dirty[2]
                    && dirty[0] < place[2]
                    && place[1] < dirty[3]
                    && dirty[1] < place[3]
            });

            if other == index || !inside || !self.within(other, index) || !self.showing(other) {
                continue;
            }

            // Due where the parent is, added to what it was due already.
            let part = dirty.map(|dirty| {
                [
                    dirty[0].max(place[0]),
                    dirty[1].max(place[1]),
                    dirty[2].min(place[2]),
                    dirty[3].min(place[3]),
                ]
            });
            let (needs_paint, was) = {
                let shown = self.shown(other);

                (shown.needs_paint, shown.dirty)
            };
            let dirty = match part {
                None => None,
                Some(part) if !needs_paint => Some(self.dirty_box(part)),
                Some(part) => was.map(|was| self.dirty_box(union(was.area, part))),
            };
            let shown = self.shown_mut(other);

            shown.dirty = dirty;
            shown.needs_erase = true;
            shown.needs_paint = true;

            // A program's window's frame by `WM_NCPAINT` in its `BeginPaint`
            // (`showseq`).
            shown.needs_nc_paint = true;
        }
    }
}
