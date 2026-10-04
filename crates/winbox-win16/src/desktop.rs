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
const WS_THICKFRAME: u32 = 0x0004_0000;

const SM_CXBORDER: i16 = 5;
const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;
const SM_CXICONSPACING: i16 = 38;
const SM_CYICONSPACING: i16 = 39;

/// USER's own class for an icon's title, and the room either side of its
/// text.
const ICON_TITLE_CLASS: &str = "#32772";
const ICON_TITLE_PAD: i32 = 2;
const SM_CYBORDER: i16 = 6;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;

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

            shown.active && shown.visible && shown.parent.is_none() && shown.title_of.is_none()
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

        self.owners = std::rc::Rc::new(owners);
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
        // A program's window's frame by `WM_NCPAINT`; an icon's title, which
        // has no window procedure, drawn now.
        if self.shown(index).paints_itself() {
            self.shown_mut(index).needs_nc_paint = true;
        } else {
            self.paint_frame(index);
        }

        let shown = self.shown_mut(index);

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
        let title = self.shown(index).icon_title;
        let family = self.take_out(|system, other| {
            system.within(other, index) || system.owned_within(other, index) || Some(other) == title
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

        self.title_shows(index);

        let shown = self.shown_mut(index);
        let drawn = shown.placement == Placement::Minimized && shown.icon.is_some();

        shown.needs_erase = !drawn;
        shown.needs_paint = !drawn;
    }

    /// An icon's title shows with its icon.
    fn title_shows(&mut self, index: usize) {
        if let Some(title) = self.shown(index).icon_title
            && !self.shown(title).visible
        {
            self.shown_mut(title).visible = true;
            self.own();
            self.paint_frame(title);
        }
    }

    /// A window shown where it lies, not brought to the top nor made active.
    pub fn show_in_place(&mut self, index: usize) {
        self.shown_mut(index).visible = true;
        self.own();
        self.paint_frame(index);
        self.title_shows(index);

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

        // A minimized window's title goes with it.
        if let Some(title) = self.shown_mut(index).icon_title.take() {
            self.destroy_title(title);
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
                        && shown.title_of.is_none()
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
            let shown = system.shown(index);

            shown.paints_itself()
                && shown.needs_paint
                && system.showing(index)
                && matches(system, index)
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

    /// A window moved or sized: its client area worked out again, its
    /// children moved as far as its client area did, and, if it shows,
    /// what it uncovered and it due again.
    pub fn place_window(
        &mut self,
        index: usize,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
    ) -> Result<(), crate::call::Stop> {
        let (was, origin) = {
            let shown = self.shown(index);

            (
                [
                    shown.left,
                    shown.top,
                    shown.left + shown.width,
                    shown.top + shown.height,
                ],
                (shown.left + shown.client.left, shown.top + shown.client.top),
            )
        };

        {
            let shown = self.shown_mut(index);

            shown.left = left;
            shown.top = top;
            shown.width = width;
            shown.height = height;
        }

        self.layout(index)?;

        // Its children keep their places in its client area, so they move as
        // far as that does.
        let (dx, dy) = {
            let shown = self.shown(index);

            (
                shown.left + shown.client.left - origin.0,
                shown.top + shown.client.top - origin.1,
            )
        };
        let family: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| other != index && self.within(other, index))
            .collect();

        if dx != 0 || dy != 0 {
            for &child in &family {
                let shown = self.shown_mut(child);

                shown.left += dx;
                shown.top += dy;
                self.layout(child)?;
            }
        }

        // An icon's title goes with it, below it.
        if self.shown(index).placement == Placement::Minimized {
            self.place_title(index)?;
        }

        if !self.shown(index).visible {
            return Ok(());
        }

        self.own();

        let now = {
            let shown = self.shown(index);

            [
                shown.left,
                shown.top,
                shown.left + shown.width,
                shown.top + shown.height,
            ]
        };

        if let Some(uncovered) = uncovered_by(was, now) {
            self.expose(uncovered);
        }

        self.due_whole(index);

        for child in family {
            if self.showing(child) {
                self.due_whole(child);
            }
        }

        Ok(())
    }

    /// A window's client area worked out again from its frame: an icon's
    /// title is all client area.
    fn layout(&mut self, index: usize) -> Result<(), crate::call::Stop> {
        let shown = self.shown(index);
        let client = if shown.title_of.is_some() {
            crate::windows::Rect {
                left: 0,
                top: 0,
                right: shown.width,
                bottom: shown.height,
            }
        } else {
            self.client_of(shown)?
        };

        self.shown_mut(index).client = client;
        Ok(())
    }

    /// What a window gone from a place uncovered: every window shown that
    /// overlaps it due there, its frame by `WM_NCPAINT` even where only its
    /// client area was uncovered (`uncovr2`).
    fn expose(&mut self, area: [i32; 4]) {
        self.paint_background();

        for index in self.z_order.clone() {
            let shown = self.shown(index);
            let overlaps = shown.left < area[2]
                && area[0] < shown.left + shown.width
                && shown.top < area[3]
                && area[1] < shown.top + shown.height;

            if shown.visible && overlaps {
                self.due_at(index, area);
            }
        }
    }

    /// A child brought above its siblings, its own children with it, and
    /// due where it now shows.
    pub fn raise(&mut self, index: usize) {
        let Some(parent) = self.shown(index).parent else {
            return;
        };
        let family = self.take_out(|system, other| system.within(other, index));
        let first = self
            .z_order
            .iter()
            .position(|&other| other != parent && self.within(other, parent));
        let at = first.unwrap_or_else(|| {
            self.z_order
                .iter()
                .position(|&other| other == parent)
                .unwrap_or(self.z_order.len())
        });

        self.z_order.splice(at..at, family.iter().copied());
        self.own();

        for member in family {
            if self.shown(member).visible {
                self.due_whole(member);
            }
        }
    }

    /// How far a frame of `style` reaches into a window on each side: left,
    /// top, right, bottom; a modal frame's, and with a menu bar of one row.
    pub fn frame_insets(
        &self,
        style: u32,
        modal: bool,
        menu: bool,
    ) -> Result<[i32; 4], crate::call::Stop> {
        let size = 1000;
        let window = Window {
            width: size,
            height: size,
            style,
            modal_frame: modal,
            bar: menu.then(|| vec![String::new()]),
            ..Window::default()
        };
        let client = self.client_of(&window)?;

        Ok([
            client.left,
            client.top,
            size - client.right,
            size - client.bottom,
        ])
    }

    /// A window maximized: its frame just off the screen's edges, as
    /// `WM_GETMINMAXINFO` offers it -- with a sizing frame a frame beyond the
    /// screen on every side, without one a border up and to the left and
    /// four more across and down (Flak Attack of the corpus) -- or a child
    /// filling its parent's client area, its frame just outside it
    /// (`USER.EXE` seg15 `16ef`). **Recorded** by `sizing` on four displays.
    pub fn maximize(&mut self, index: usize) -> Result<(), crate::call::Stop> {
        let (placement, place, style, parent) = {
            let shown = self.shown(index);

            (
                shown.placement,
                [shown.left, shown.top, shown.width, shown.height],
                shown.style,
                shown.parent,
            )
        };

        self.leave_icon(index);

        if placement == Placement::Normal {
            self.shown_mut(index).restore_rect = Some(place);
        }

        self.shown_mut(index).placement = Placement::Maximized;

        if let Some(parent) = parent {
            let insets = self.frame_insets(style & !0x0030_0000, false, false)?;
            let parent = self.shown(parent);
            let (left, top) = (
                parent.left + parent.client.left - insets[0],
                parent.top + parent.client.top - insets[1],
            );
            let (width, height) = (
                parent.client_width() + insets[0] + insets[2],
                parent.client_height() + insets[1] + insets[3],
            );

            return self.place_window(index, left, top, width, height);
        }

        let (width, height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );

        if style & WS_THICKFRAME == 0 {
            let (bx, by) = (self.metric(SM_CXBORDER), self.metric(SM_CYBORDER));

            return self.place_window(index, -bx, -by, width + 4 * bx, height + 4 * by);
        }

        let (cx, cy) = (self.metric(SM_CXFRAME), self.metric(SM_CYFRAME));

        self.place_window(index, -cx, -cy, width + 2 * cx, height + 2 * cy)
    }

    /// A maximized window put back where it was.
    pub fn restore(&mut self, index: usize) -> Result<(), crate::call::Stop> {
        let (placement, rect) = {
            let shown = self.shown(index);

            (shown.placement, shown.restore_rect)
        };
        let Some([left, top, width, height]) = rect.filter(|_| placement != Placement::Normal)
        else {
            return Ok(());
        };

        self.leave_icon(index);
        self.shown_mut(index).placement = Placement::Normal;
        self.place_window(index, left, top, width, height)
    }

    /// An icon's title made for a window: a window of USER's, of its own
    /// class `#32772`, which `SetWindowPos` can name (`showmin`), drawn by the
    /// desktop; just above its icon among the windows.
    fn make_title(&mut self, index: usize) -> usize {
        if self.handles.retrieve(ICON_TITLE_CLASS).is_none() {
            self.register_class(crate::classes::WindowClass {
                style: 0,
                proc: crate::classes::WndProc::Host(crate::classes::HostProc::DefWindow),
                cls_extra: 0,
                wnd_extra: 0,
                instance: 0,
                icon: 0,
                cursor: 0,
                background: 0,
                menu_name: None,
                name: ICON_TITLE_CLASS.to_string(),
                menu: 0,
                extra: Vec::new(),
            });
        }

        let title = self.windows.len();
        let text = self.shown(index).title.clone();

        self.windows.push(Some(Window {
            style: 0x8000_0000,
            title: text,
            class: ICON_TITLE_CLASS.to_string(),
            title_of: Some(index),
            ..Window::default()
        }));

        let at = self
            .z_order
            .iter()
            .position(|&other| other == index)
            .unwrap_or(0);

        self.z_order.insert(at, title);
        self.shown_mut(index).icon_title = Some(title);

        let hwnd = self
            .handles
            .allocate(
                crate::handles::Kind::Window,
                crate::handles::Object::Window(title),
            )
            .unwrap_or(0);

        self.shown_mut(title).hwnd = hwnd;
        title
    }

    /// An icon's title gone: its handle let go, and it off the desktop.
    pub fn destroy_title(&mut self, title: usize) {
        let hwnd = self.shown(title).hwnd;

        if hwnd != 0 {
            self.handles.free(hwnd);
            self.shown_mut(title).hwnd = 0;
        }

        if self.z_order.contains(&title) {
            self.take_away(title, true);
        }

        self.windows[title] = None;
    }

    /// A window's icon title taken away, as it stops being an icon.
    pub(crate) fn leave_icon(&mut self, index: usize) {
        if let Some(title) = self.shown_mut(index).icon_title.take() {
            self.destroy_title(title);
        }
    }

    /// An icon's title under it, as wide as its text in the icon title's
    /// font and a little more, centred.
    fn place_title(&mut self, index: usize) -> Result<(), crate::call::Stop> {
        let Some(title) = self.shown(index).icon_title else {
            return Ok(());
        };
        let (text, visible, left, top, width, height) = {
            let shown = self.shown(index);

            (
                shown.title.clone(),
                shown.visible,
                shown.left,
                shown.top,
                shown.width,
                shown.height,
            )
        };
        let Some(font) = self
            .title_font
            .clone()
            .or_else(|| self.desktop_font.clone())
        else {
            return Err(crate::call::Stop::Unsupported(
                "an icon's title before the raster desktop",
            ));
        };
        let bytes: Vec<u8> = text.chars().map(|c| c as u8).collect();
        let measured = font.measure(&bytes, winbox_raster::Measure::default()).0 as i32;
        let across = measured + 2 * ICON_TITLE_PAD;
        let down = crate::fonts::text_metrics(&font).height;

        {
            let shown = self.shown_mut(title);

            shown.title = text;
            shown.visible = visible;
        }

        self.place_window(
            title,
            left + (width >> 1) - (across >> 1),
            top + height,
            across,
            down,
        )
    }

    /// A window minimized to its icon: `SM_CXICON` and four square, in the
    /// first free slot of its parent's client area -- the screen's, for a
    /// top-level window -- with its title in a window of its own below it.
    ///
    /// **Read out of `USER.EXE`** (seg4 `0000`, called from seg6 `1bdb`):
    /// the slots are `SM_CXICONSPACING` by `SM_CYICONSPACING`, as many across
    /// as fit and at least one, filled from the bottom left, along, then up
    /// a row. The icon goes half a spacing less half an icon into its slot,
    /// at the slot's top. A slot is taken if a visible minimized sibling's
    /// slot, worked out the same way back from its icon, overlaps it. A
    /// place the icon was moved to is used instead (`iconclk`). **Recorded**
    /// by `sizing` for the first slot: (21, 408) on the VGA.
    pub fn minimize(&mut self, index: usize) -> Result<(), crate::call::Stop> {
        let (placement, place, parent) = {
            let shown = self.shown(index);

            (
                shown.placement,
                [shown.left, shown.top, shown.width, shown.height],
                shown.parent,
            )
        };

        if placement == Placement::Minimized {
            return Ok(());
        }

        if placement == Placement::Normal {
            self.shown_mut(index).restore_rect = Some(place);
        }

        self.shown_mut(index).placement = Placement::Minimized;

        let icon_wide = self.metric(SM_CXICON);
        let icon_high = self.metric(SM_CYICON);
        let slot_wide = self.metric(SM_CXICONSPACING);
        let slot_high = self.metric(SM_CYICONSPACING);
        let (origin_x, origin_y, wide, high) = match parent {
            Some(parent) => {
                let parent = self.shown(parent);

                (
                    parent.left + parent.client.left,
                    parent.top + parent.client.top,
                    parent.client_width(),
                    parent.client_height(),
                )
            }
            None => (
                0,
                0,
                i32::from(self.display.width),
                i32::from(self.display.height),
            ),
        };
        let across = (wide / slot_wide).max(1);
        let inset = (slot_wide >> 1) - (icon_wide >> 1);
        let taken: Vec<(i32, i32)> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| other != index)
            .map(|other| self.shown(other))
            .filter(|other| other.parent == parent)
            .filter(|other| {
                other.visible && other.placement == Placement::Minimized && other.title_of.is_none()
            })
            .map(|other| (other.left - inset, other.top))
            .collect();
        let slot_at = |slot: i32| {
            (
                origin_x + (slot % across) * slot_wide,
                origin_y + high - (slot / across + 1) * slot_high,
            )
        };
        let overlaps = |a: (i32, i32), b: (i32, i32)| {
            (a.0 - b.0).abs() < slot_wide && (a.1 - b.1).abs() < slot_high
        };
        let mut slot = 0;

        while taken.iter().any(|&other| overlaps(other, slot_at(slot))) {
            slot += 1;
        }

        let (left, top) = slot_at(slot);

        match self.shown(index).icon_place {
            Some((left, top)) => {
                self.place_window(index, left, top, icon_wide + 4, icon_high + 4)?;
            }
            None => self.place_window(index, left + inset, top, icon_wide + 4, icon_high + 4)?,
        }

        self.make_title(index);
        self.place_title(index)?;

        // With an icon, USER draws it; without one, the window is erased and
        // painted like any other (`icons`).
        let shown = self.shown_mut(index);
        let bare = shown.icon.is_none();

        shown.needs_erase = bare;
        shown.needs_paint = bare;
        Ok(())
    }

    /// A window put at the very bottom of the windows at the top, its icon's
    /// title just above it and its children with it, and shown there if
    /// `show` -- not made active (`showmin`).
    pub fn to_bottom(&mut self, index: usize, show: bool) {
        let title = self.shown(index).icon_title;
        let family =
            self.take_out(|system, other| system.within(other, index) || Some(other) == title);

        self.z_order.extend(
            family
                .iter()
                .copied()
                .filter(|&member| Some(member) == title),
        );
        self.z_order.extend(
            family
                .iter()
                .copied()
                .filter(|&member| Some(member) != title),
        );

        if !show {
            self.own();
            return;
        }

        self.shown_mut(index).visible = true;

        if let Some(title) = title {
            self.shown_mut(title).visible = true;
        }

        self.own();
        self.paint_frame(index);

        if let Some(title) = title {
            self.paint_frame(title);
        }

        let shown = self.shown_mut(index);

        shown.needs_erase = true;
        shown.needs_paint = true;
    }
}

/// What a window's move uncovered, as Windows invalidates it: the old place
/// less the new, where that is one rectangle; the old place otherwise.
fn uncovered_by(was: [i32; 4], now: [i32; 4]) -> Option<[i32; 4]> {
    let [l, t, r, b] = was;
    let [nl, nt, nr, nb] = now;

    if nl <= l && nt <= t && nr >= r && nb >= b {
        return None;
    }

    // Shrunk, or moved, along one side only.
    Some(if nl <= l && nr >= r && nt <= t && nb < b && nb > t {
        [l, nb, r, b]
    } else if nl <= l && nr >= r && nb >= b && nt > t && nt < b {
        [l, t, r, nt]
    } else if nt <= t && nb >= b && nl <= l && nr < r && nr > l {
        [nr, t, r, b]
    } else if nt <= t && nb >= b && nr >= r && nl > l && nl < r {
        [l, t, nl, b]
    } else {
        was
    })
}
