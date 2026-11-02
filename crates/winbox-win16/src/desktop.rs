//! The raster desktop's windows as winbox.js's `desktop.ts` keeps them:
//! their order, which of them shows where, which is active, and what each
//! is due to have drawn again -- its frame, its erase, its paint, and how
//! much of it. What is due is what decides the messages a program is sent;
//! what the desktop draws itself -- a frame, an icon, the desktop's
//! background -- is drawn by `desktop_paint.rs`.
//!
//! A window's place in `System::z_order` is its place among the desktop's
//! windows, the topmost first; a pixel's owner is its window's index plus
//! one, nought for the desktop.

use winbox_raster::ClipRegion;

use crate::moved::{SWP_HIDEWINDOW, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW};
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
pub(crate) const ICON_TITLE_CLASS: &str = "#32772";
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
    pub(crate) fn shown(&self, index: usize) -> &Window {
        self.windows[index]
            .as_ref()
            .expect("a window not destroyed")
    }

    pub(crate) fn shown_mut(&mut self, index: usize) -> &mut Window {
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

    /// The window made active last: a window at the top, shown or hidden,
    /// or a document window shown in it. USER's active window is a word of
    /// its own, which nothing in its activation asks the window's showing of
    /// (`USER.EXE` seg1 `3514`; `GetActiveWindow`, `818d`, answers it as it
    /// is): a window hidden is made active by `SetFocus` (`hidfocus`), and
    /// stays active when it is hidden and nothing else can be.
    pub fn active_window(&self) -> Option<usize> {
        self.z_order.iter().copied().find(|&index| {
            let shown = self.shown(index);

            shown.active && (shown.visible || shown.parent.is_none())
        })
    }

    /// The active window at the top, shown or hidden: a document window
    /// inside one does not count.
    pub fn active_top(&self) -> Option<usize> {
        self.z_order.iter().copied().find(|&index| {
            let shown = self.shown(index);

            shown.active && shown.parent.is_none()
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
    /// kind, the topmost first -- after the last topmost window and its
    /// children, whatever lies among them (`sysdlg`: with a system-modal
    /// dialog made active at the very front and made topmost there, a
    /// window made active goes after USER's topmost `#32771`, the last of
    /// them).
    pub fn front_of(&self, index: usize) -> usize {
        if self.shown(index).topmost {
            return 0;
        }

        let top_of = |mut other: usize| {
            while let Some(parent) = self.shown(other).parent {
                other = parent;
            }

            other
        };
        let mut at = 0;

        for (place, &other) in self.z_order.iter().enumerate() {
            let top = top_of(other);

            if other != index && top != index && self.shown(top).topmost {
                at = place + 1;
            }
        }

        at
    }

    /// The windows `pick` takes, taken out of the order, as they lay.
    pub(crate) fn take_out(&mut self, pick: impl Fn(&Self, usize) -> bool) -> Vec<usize> {
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
            // A pop-up menu's shadow leaves its two outer corners to what
            // is beneath.
            let corners: Vec<(usize, u16)> = if shown.popup.is_some() {
                [
                    (shown.left + shown.width - 1, shown.top),
                    (shown.left, shown.top + shown.height - 1),
                ]
                .into_iter()
                .filter(|&(x, y)| x >= 0 && y >= 0 && x < width && y < height)
                .map(|(x, y)| {
                    let at = (y * width + x) as usize;

                    (at, owners[at])
                })
                .collect()
            } else {
                Vec::new()
            };

            for y in top..bottom {
                if right > left {
                    let row = (y * width) as usize;

                    owners[row + left as usize..row + right as usize].fill(id);
                }
            }

            for (at, beneath) in corners {
                owners[at] = beneath;
            }

            self.windows[index]
                .as_mut()
                .expect("a window not destroyed")
                .clip_rect = [left, top, right, bottom];
        }

        self.owners = std::rc::Rc::new(owners);

        // USER's device context entries the change makes stale
        // (`dc_entries`).
        self.windows_changed();
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

    /// What a window gone from where it lay uncovered: each window that
    /// shows there now due there, and each parent of it that does not leave
    /// its children out of its own painting.
    pub(crate) fn expose_owned(&mut self, gone: usize, before: &[u16]) {
        let place = {
            let shown = self.shown(gone);

            [
                shown.left,
                shown.top,
                shown.left + shown.width,
                shown.top + shown.height,
            ]
        };

        self.paint_background_in(place);

        let ids: Vec<u16> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| self.within(other, gone))
            .chain(std::iter::once(gone))
            .map(|index| (index + 1) as u16)
            .collect();
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

    /// A window, its frame, children and all, due everything: whatever
    /// part of it was due before is forgotten, all of it is due now. A box
    /// left from before would hold the paint to it -- a window moved with
    /// one painted only where it had been (`swpbits`).
    fn due_whole(&mut self, index: usize) {
        self.paint_frame(index);

        let shown = self.shown_mut(index);

        shown.dirty = None;
        shown.dirty_shape = None;
        shown.quiet_dirty = None;
        shown.needs_erase = true;
        shown.needs_paint = true;
    }

    /// Shows a window, on top, and makes it the active one: its frame
    /// painted, and its client area left to be erased and painted when it
    /// is asked. A child only shows, where it lies.
    pub fn show(&mut self, index: usize) {
        self.show_with(index, true);
    }

    /// A child shown as `SetWindowPos` shows it (`placed_shown`): its own
    /// children show with it. `all_shown`: every window of the call was
    /// shown.
    pub(crate) fn show_child(&mut self, index: usize, all_shown: bool) {
        self.begin_placing(&[index]);
        self.shown_mut(index).visible = true;
        self.end_placing(Some(all_shown));
    }

    /// A window shown as `SetWindowPos` shows it: a child as
    /// `show_child`, a window at the top as `show`.
    pub(crate) fn show_placed(&mut self, index: usize, all_shown: bool) {
        if self.shown(index).parent.is_some() {
            self.show_child(index, all_shown);
        } else {
            self.show_with(index, true);
        }
    }

    /// A window shown and made active as `show` does it; with `whole`, all
    /// of it due a paint, else only what it came to show of itself where it
    /// was covered, as a window already shown is made active by
    /// `SetWindowPos` (`swporder`: brought up from beneath one window, it is
    /// sent `WM_PAINT` for that window's place, and already at the top,
    /// nothing).
    #[allow(clippy::too_many_lines)]
    pub fn show_with(&mut self, index: usize, whole: bool) {
        if self.shown(index).parent.is_some() {
            self.show_child(index, true);
            return;
        }

        // Drawn as `SetWindowPos` draws its list: the window, and the
        // windows brought up with it (`bring_up`), each where it shows now
        // and did not (`end_placing`).
        self.begin_placing(&[index]);

        let flags = if self.shown(index).visible {
            SWP_NOMOVE | SWP_NOSIZE
        } else {
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
        };

        self.placing_flags(index, flags);

        if let Some(title) = self.shown_title(index)
            && !self.shown(title).visible
        {
            self.placed_whole(title);
        }

        let was = self.active_window();
        let was_top = self.active_top();
        let family = self.bring_up(index, false);
        self.shown_mut(index).visible = true;
        self.set_active(index, true);
        self.note_active_popup(index);

        if let Some(was) = was.filter(|&was| was != index) {
            self.set_active(was, false);
        }

        // Its messages are to be sent; the focus moves with them.
        if was_top != Some(index) {
            self.previous_active = was_top;

            if self.pending_activation.is_none() {
                self.pending_activation = Some((was_top, false));
            }
        }

        self.own();

        if let Some(was) = was.filter(|&was| was != index) {
            self.paint_frame(was);
        }

        self.paint_frame(index);

        if !whole {
            self.title_shows(index);
            self.end_placing(None);
            return;
        }

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
        self.placed_whole(index);
        self.end_placing(None);
    }

    /// A window at the top brought to the front of the windows, its children
    /// with it, as they were; the windows it owns above it, in their order
    /// (`owners`); and the window that owns it, with the rest that one owns,
    /// beneath it (`showseq`). Answers what moved with it of its own.
    fn bring_up(&mut self, index: usize, absolute: bool) -> Vec<usize> {
        let title = self.shown(index).icon_title;

        // The windows at the top it brings, and the family of the window
        // that owns it, are of the list being placed, as they were
        // (`end_placing`).
        if self.placing.is_some() {
            let mut head = index;

            while let Some(owner) = self.shown(head).owner {
                if self.shown(owner).parent.is_some() {
                    break;
                }

                head = owner;
            }

            let head_title = self.shown(head).icon_title;
            let members: Vec<usize> = self
                .z_order
                .iter()
                .copied()
                .filter(|&other| {
                    self.shown(other).parent.is_none()
                        && (self.within(other, index)
                            || self.owned_within(other, index)
                            || Some(other) == title
                            || (head != index
                                && (self.owned_within(other, head)
                                    || other == head
                                    || Some(other) == head_title)))
                })
                .collect();

            for member in members {
                if let Some(entry) = self.placing_entry(member) {
                    entry.flags.get_or_insert(SWP_NOMOVE | SWP_NOSIZE);
                }
            }
        }
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

        // `absolute`: the window, with what it owns, goes to the very front;
        // its owner's family stays where it lay (`sysdlg`: the owner of a
        // system-modal dialog made active, asked to go after it, is not
        // moved).
        if absolute {
            self.z_order.splice(0..0, owned_first);
            return family;
        }

        let owners = if head == index {
            Vec::new()
        } else {
            let head_title = self.shown(head).icon_title;

            self.take_out(|system, other| {
                !owned_first.contains(&other)
                    && (system.within(other, head)
                        || system.owned_within(other, head)
                        || Some(other) == head_title)
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

        family
    }

    /// A window at the top made the active one, hidden as it is: `SetFocus`
    /// on a window inside it, or `SetActiveWindow`, makes it so, and nothing
    /// in the activation asks whether it shows (`USER.EXE` seg1 `3899`,
    /// `38c5`, `3514`; `hidfocus`). It is brought to the top as a window that
    /// shows is, no window that shows being above it (`3674`-`3697`), and the
    /// window that was active is drawn inactive. A window that shows is
    /// shown.
    pub fn activate(&mut self, index: usize, absolute: bool) {
        if self.shown(index).visible || self.shown(index).parent.is_some() {
            self.show(index);
            return;
        }

        let was = self.active_window();
        let was_top = self.active_top();

        // `absolute`: made active by USER's `ActivateWindow` as the
        // system-modal window, it goes to the very front, before the topmost
        // windows too. **Recorded** by `sysdlg`.
        self.bring_up(index, absolute);
        self.set_active(index, true);
        self.note_active_popup(index);

        if let Some(was) = was.filter(|&was| was != index) {
            self.set_active(was, false);
            self.paint_frame(was);
        }

        if was_top != Some(index) {
            self.previous_active = was_top;

            if self.pending_activation.is_none() {
                self.pending_activation = Some((was_top, false));
            }
        }
    }

    /// An icon's title shows with its icon.
    fn title_shows(&mut self, index: usize) {
        if let Some(title) = self.shown_title(index)
            && !self.shown(title).visible
        {
            self.shown_mut(title).visible = true;
            self.own();
            self.paint_frame(title);
        }
    }

    /// A window at the top that is the first that shows made active where
    /// it lies: `ActivateWindow` brings nothing to the front then
    /// (`USER.EXE` seg1 `3674`-`3697`). **Recorded** by `sysdlg`: a dialog
    /// made active again over the dialog it ran ends, its owner's other
    /// windows are not moved. `whole`: it is due whole, as a window shown.
    pub fn activate_in_place(&mut self, index: usize, whole: bool) {
        let was = self.active_window();
        let was_top = self.active_top();

        self.set_active(index, true);
        self.note_active_popup(index);

        if let Some(was) = was.filter(|&was| was != index) {
            self.set_active(was, false);
            self.paint_frame(was);
        }

        if whole {
            self.due_whole(index);
        } else {
            self.paint_frame(index);
        }

        if was_top != Some(index) {
            self.previous_active = was_top;

            if self.pending_activation.is_none() {
                self.pending_activation = Some((was_top, false));
            }
        }
    }

    /// A window shown where it lies, not brought to the top nor made active.
    pub fn show_in_place(&mut self, index: usize) {
        // Drawn as `SetWindowPos` draws its list (`end_placing`).
        self.begin_placing(&[index]);

        let flags = SWP_NOMOVE
            | SWP_NOSIZE
            | SWP_NOZORDER
            | if self.shown(index).visible {
                0
            } else {
                SWP_SHOWWINDOW
            };

        self.placing_flags(index, flags);
        self.placed_whole(index);

        if let Some(title) = self.shown_title(index)
            && !self.shown(title).visible
        {
            self.placed_whole(title);
        }

        self.shown_mut(index).visible = true;
        self.own();
        self.paint_frame(index);
        self.title_shows(index);

        let drawn = {
            let shown = self.shown(index);

            shown.placement == Placement::Minimized && shown.icon.is_some()
        };

        // Shown, it is due all over through itself, frame and all, the
        // windows in it too (`USER.EXE` seg7 `08de`-`08f0`): a child shown
        // while it was hidden was due nothing (`0557`; `swpunc`).
        if !drawn {
            self.invalidate_through(
                Some(index),
                None,
                crate::invalidate_through::RDW_INVALIDATE
                    | crate::invalidate_through::RDW_ERASE
                    | crate::invalidate_through::RDW_FRAME
                    | crate::invalidate_through::RDW_ALLCHILDREN,
            );
        }

        let shown = self.shown_mut(index);

        shown.needs_erase = !drawn;
        shown.needs_paint = !drawn;
        self.end_placing(None);
    }

    /// A window shown at the front of its kind, with its children, not
    /// made active (`SW_SHOWNA`).
    pub fn show_on_top(&mut self, index: usize) {
        // Drawn as `SetWindowPos` draws its list (`end_placing`).
        self.begin_placing(&[index]);

        let flags = SWP_NOMOVE
            | SWP_NOSIZE
            | if self.shown(index).visible {
                0
            } else {
                SWP_SHOWWINDOW
            };

        self.placing_flags(index, flags);
        self.placed_whole(index);

        let family = self.take_out(|system, other| system.within(other, index));
        let at = self.front_of(index);

        self.z_order.splice(at..at, family);
        self.shown_mut(index).visible = true;
        self.own();
        self.due_whole(index);
        self.end_placing(None);
    }

    /// The windows a window owns, hidden as it is minimized and shown again
    /// as it is restored (`owners`).
    pub fn hide_owned(&mut self, index: usize, hide: bool) {
        for other in self.z_order.clone() {
            if self.shown(other).parent.is_some() || !self.owned_within(other, index) {
                continue;
            }

            // Drawn as `SetWindowPos` draws its list (`end_placing`).
            if hide && self.shown(other).visible {
                self.begin_placing(&[other]);
                self.placing_flags(
                    other,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_HIDEWINDOW,
                );

                {
                    let shown = self.shown_mut(other);

                    shown.hidden_with_owner = true;
                    shown.visible = false;
                }
                self.set_active(other, false);
                self.own();
                self.end_placing(Some(false));
            } else if !hide && self.shown(other).hidden_with_owner {
                self.begin_placing(&[other]);
                self.placing_flags(
                    other,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW,
                );
                self.placed_whole(other);

                {
                    let shown = self.shown_mut(other);

                    shown.hidden_with_owner = false;
                    shown.visible = true;
                }
                self.own();
                self.due_whole(other);
                self.end_placing(None);
            }
        }
    }

    /// A window hidden: left where it lies in the order of windows, its
    /// children with it and kept -- hidden, not gone, and not moved
    /// (`mousemsg`: hidden at the top, in the middle or among a window's
    /// children, it stays there, and shown again with `SW_SHOWNOACTIVATE`
    /// it shows there).
    pub fn hide(&mut self, index: usize) {
        self.hide_with(index, true);
    }

    /// A window hidden as `hide` hides it; without `activate_next` the
    /// active window hidden stays active, as `SetWindowPos` leaves it: only
    /// `ShowWindow` and `DestroyWindow` ask for another (`USER.EXE` seg14
    /// `0dc2`, seg8 `0bb7`). A window hidden already, destroyed while it is
    /// active, gives the activation to another as one that shows does (seg8
    /// `0b86`-`0bb7`).
    pub fn hide_with(&mut self, index: usize, activate_next: bool) {
        if !self.shown(index).visible {
            if self.shown(index).destroying && self.shown(index).active {
                self.take_away_with(index, false, activate_next);
            }

            return;
        }

        // A minimized window's title is hidden with it, and kept:
        // `ShowWindow` of an icon shows or hides its title with it
        // (`USER.EXE` seg14 `0de0`-`0def`, seg1 `6e25`).
        if let Some(title) = self.shown(index).icon_title
            && self.shown(title).visible
        {
            self.hide_with(title, false);
        }

        self.take_away_with(index, false, activate_next);
    }

    /// A window taken off the screen, and with `remove` out of the desktop's
    /// windows with its children; otherwise it and they are kept, hidden.
    pub fn take_away(&mut self, index: usize, remove: bool) {
        self.take_away_with(index, remove, true);
    }

    /// A window taken away as `take_away` takes it. The active window
    /// hidden by `ShowWindow`, or destroyed, shown or not, gives the
    /// activation to another, where one can take it (see `next_active`),
    /// unless `activate_next` is false. With none, a window destroyed leaves
    /// none active, and one hidden stays active, hidden (`USER.EXE` seg8
    /// `0bb7`-`0bc0`, seg14 `0dc2`).
    fn take_away_with(&mut self, index: usize, remove: bool, activate_next: bool) {
        // USER's device context entries of it and the windows within it let
        // go as it is destroyed (`dc_entries`).
        if remove {
            let gone: Vec<u16> = self
                .z_order
                .iter()
                .copied()
                .filter(|&other| self.windows[other].is_some() && self.within(other, index))
                .filter_map(|other| self.windows[other].as_ref().map(|window| window.hwnd))
                .collect();

            for hwnd in gone {
                self.window_destroyed(hwnd);
            }
        }

        // Its menu, open, has no window any more to end it.
        if self.menu_loop.owner == Some(index) {
            self.menu_loop.owner = None;
        }

        let (visible, was_active, destroying) = {
            let shown = self.shown(index);

            (
                shown.visible,
                shown.active && shown.parent.is_none() && shown.title_of.is_none(),
                remove || shown.destroying,
            )
        };
        let next = if was_active && activate_next {
            self.next_active(index, destroying)
        } else {
            None
        };
        // Hidden, it is drawn as `SetWindowPos` hides it (`end_placing`):
        // what showed of it made due through its parent, the windows in it
        // too, or the bits it saved put back.
        if visible {
            self.begin_placing(&[index]);
            self.placing_flags(
                index,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_HIDEWINDOW,
            );
        }

        // A focus left on a window destroyed is no focus, as `show_raster`
        // has it: a task's windows are taken away one after another as it
        // ends, and the activation that was to move the focus off one of
        // them has had no time to send its messages.
        if self
            .focus
            .is_some_and(|focus| self.windows[focus].is_none())
        {
            self.focus = None;
        }

        // A focus inside a window destroyed goes, unless another window is
        // activated, whose messages move it. One inside a window hidden
        // stays there: `SetWindowPos` moves no focus, and `ShowWindow` moves
        // it only off the window itself (`USER.EXE` seg2 `090a`;
        // `show_raster`). **Recorded** by `enddlg`: a dialog hidden by
        // `EndDialog` keeps the focus `EndDialog` gave it, and its owner made
        // active takes it from the dialog.
        if remove && next.is_none() && self.focus.is_some_and(|focus| self.within(focus, index)) {
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

            // Nor the window active before it (seg8 `0cc8`).
            if self.previous_active == Some(index) {
                self.previous_active = None;
            }
        }

        if visible {
            self.shown_mut(index).visible = false;

            // A document window's caption is drawn inactive.
            if !was_active {
                self.set_active(index, false);
            }

            self.own();
            self.end_placing(Some(false));
        }

        if remove {
            self.discard_within(index);
        }

        if let Some(next) = next {
            self.set_active(index, false);
            self.set_active(next, true);
            self.note_active_popup(next);
            self.previous_active = (!remove).then_some(index);

            if self.pending_activation.is_none() {
                self.pending_activation = Some((Some(index), false));
            }

            self.paint_frame(next);
        } else if destroying {
            self.set_active(index, false);

            if was_active {
                self.active_task = None;
            }
        }
    }

    /// A window at the top brought up with the family it heads, not made
    /// active: the windows it owns above it, its owner beneath
    /// (`bring_up`). Whether the order changed.
    pub fn bring_family_up(&mut self, index: usize) -> bool {
        let order = self.z_order.clone();

        // Drawn as `SetWindowPos` draws its list (`end_placing`).
        self.begin_placing(&[]);
        self.bring_up(index, false);
        self.own();
        self.end_placing(Some(false));

        self.z_order != order
    }

    /// The window a window at the top destroyed makes active (seg8
    /// `0b95`-`0bb7`).
    pub fn next_active_of(&self, index: usize) -> Option<usize> {
        self.next_active(index, true)
    }

    /// No window active and none with the focus, told nothing: the active
    /// window destroyed with none to take it (seg8 `0bc0`-`0bcb`), or a
    /// dialog with no owner ended (seg25 `262c`). The task that was active
    /// is still noted where a dialog ended (`keep_task`), not where a
    /// window went.
    pub fn leave_none_active(&mut self, index: usize, keep_task: bool) {
        self.set_active(index, false);
        self.focus = None;

        if !keep_task {
            self.active_task = None;
        }
    }

    /// The window USER makes active as a window at the top is minimized with
    /// `SW_MINIMIZE`, or none (`USER.EXE` seg6 `1d96`-`1e11`): the window
    /// active before, if it shows, is enabled and is no icon; else the
    /// first that is from the window after the last of those kept on top
    /// (seg7 `02c9`), or after the first window, to the back -- else, as a
    /// window hidden, the next that can take it (`next_active`, which seg1
    /// `38e4` is asked with 3 for). The look asks only that a window shows,
    /// is enabled and is no icon (`1de3`-`1df3`), so an icon's title that
    /// shows is one: made active, it makes its icon active (`minact`: A
    /// minimized with B an icon gives the activation to B's title first).
    /// `next_active` passes titles over (`34dc`).
    pub fn next_after_minimize(&self, index: usize) -> Option<usize> {
        const WS_DISABLED: u32 = 0x0800_0000;

        let suits = |other: usize| {
            self.windows[other].as_ref().is_some_and(|shown| {
                shown.parent.is_none()
                    && shown.visible
                    && shown.style & WS_DISABLED == 0
                    && shown.placement != Placement::Minimized
            }) && self.z_order.contains(&other)
        };
        let tops: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| self.shown(other).parent.is_none())
            .collect();
        let kept_on_top = tops
            .iter()
            .take_while(|&&other| self.shown(other).topmost)
            .count();
        let from = kept_on_top.saturating_sub(1);
        let start = match self.previous_active {
            Some(previous) if suits(previous) => return Some(previous),
            Some(_) => from + 1,
            None => from,
        };

        tops.iter()
            .skip(start)
            .copied()
            .find(|&other| suits(other))
            .or_else(|| self.next_active(index, false))
    }

    /// The window USER makes active as the active window is hidden by
    /// `ShowWindow` or destroyed, or none (`USER.EXE` seg1 `38e4`, called
    /// with 2 and its owner for a pop-up destroyed that has one, seg8
    /// `0b95`, and with 3 and the window otherwise, and by `ShowWindow`). A
    /// window can take it that is still one, shows, is enabled, and is not
    /// an icon's title (`34dc`). Asked in turn:
    ///
    /// * a destroyed pop-up's owner (`392b`);
    /// * a pop-up's owner (`3934`);
    /// * the window active before this one (`395c`);
    /// * the next window that can take it after this one, in the order of
    ///   the windows at the top with each followed by those it owns, round
    ///   to the first (seg13 `0f2b`, `0edd`, `0eb2`) -- or its owned window
    ///   last active, where that can (`3984`-`3994`). Bago's dictionary
    ///   pop-up gives it back to the window that owns it, not to its egg
    ///   timer (`actnext`).
    fn next_active(&self, index: usize, destroying: bool) -> Option<usize> {
        const WS_DISABLED: u32 = 0x0800_0000;
        const WS_POPUP: u32 = 0x8000_0000;

        let can = |other: Option<usize>| -> Option<usize> {
            let other = other?;
            let shown = self.windows[other].as_ref()?;

            (other != index
                && self.z_order.contains(&other)
                && shown.visible
                && shown.style & WS_DISABLED == 0
                && shown.title_of.is_none()
                && !self.within(other, index)
                && !(destroying && self.owned_within(other, index)))
            .then_some(other)
        };
        let popup = |other: usize| self.shown(other).style & WS_POPUP != 0;
        let mut from = index;

        if destroying
            && popup(index)
            && let Some(owner) = self.shown(index).owner
        {
            if let Some(owner) = can(Some(owner)) {
                return Some(owner);
            }

            from = owner;
        }

        if popup(from)
            && let Some(owner) = can(self.shown(from).owner)
        {
            return Some(owner);
        }

        if let Some(previous) = can(self.previous_active) {
            return Some(previous);
        }

        // The windows at the top, as USER walks them: those `owner` owns
        // after `after`, or from the first.
        let tops: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| self.shown(other).parent.is_none())
            .collect();
        let owned_by = |owner: Option<usize>, after: Option<usize>| {
            let start = after
                .and_then(|after| tops.iter().position(|&other| other == after))
                .map_or(0, |at| at + 1);

            tops[start.min(tops.len())..]
                .iter()
                .copied()
                .find(|&other| self.shown(other).owner == owner)
        };
        let following = |at: usize| {
            let mut owner = Some(at);
            let mut after = None;

            loop {
                let found = owned_by(owner, after);

                if found.is_some() {
                    return found;
                }

                let Some(up) = owner else {
                    return owned_by(None, None);
                };

                after = Some(up);
                owner = self.shown(up).owner;
            }
        };
        let mut at = following(from);
        let mut steps = 0;

        while let Some(here) = at.filter(|&here| here != from && steps <= tops.len()) {
            if here != index
                && let Some(here) = can(Some(here))
            {
                let last = self.shown(here).last_active_popup;
                let last = can(self.window_named(last).filter(|_| last != 0));

                return Some(last.unwrap_or(here));
            }

            at = following(here);
            steps += 1;
        }

        None
    }

    /// A region of the desktop itself made due (`invalidate_through`).
    pub(crate) fn background_due_in(&mut self, region: &ClipRegion) {
        if region.kind() > 1 {
            self.background_region = Some(match self.background_region.take() {
                Some(due) => due.union(region),
                None => region.clone(),
            });
        }
    }

    /// The desktop itself drawn where it is due, now, nothing of it due
    /// after.
    pub(crate) fn paint_background_due(&mut self) {
        if let Some(region) = self.background_region.take() {
            self.paint_background_region(&region);
        }
    }

    /// The desktop itself drawn in a region of the screen, where no window
    /// shows.
    pub(crate) fn paint_background_region(&mut self, region: &ClipRegion) {
        for band in &region.bands {
            for &(span_left, span_right) in &band.spans {
                self.paint_background_in([span_left, band.top, span_right, band.bottom]);
            }
        }
    }

    /// The first window due a paint that `matches` takes: the windows at the
    /// top from the front back, each before its children (`showseq`), made
    /// ready to paint.
    pub fn unpainted_where(&mut self, matches: impl Fn(&Self, usize) -> bool) -> Option<usize> {
        self.paint_background_due();

        // The desktop drawn again first, and what it draws itself.
        if self.background_due {
            self.background_due = false;
            self.paint_background();

            for index in self.z_order.clone() {
                let shown = self.shown_mut(index);

                if !shown.paints_itself() && shown.needs_frame {
                    shown.needs_frame = false;
                    self.paint_frame(index);
                }
            }
        }

        if !self.z_order.iter().any(|&index| {
            let shown = self.shown(index);

            shown.needs_paint || shown.internal_paint || shown.title_due
        }) {
            return None;
        }

        // Due where it has an update region or a paint of its own
        // (`USER.EXE` seg1 `77d1`-`77db`); an icon's title invalidated is
        // painted as its own window is, by its own procedure
        // (`paint_title`).
        let due = |system: &Self, index: usize| {
            let shown = system.shown(index);

            ((shown.paints_itself() && (shown.needs_paint || shown.internal_paint))
                || (shown.title_of.is_some() && shown.title_due))
                && system.showing(index)
                && matches(system, index)
        };

        let found = self
            .z_order
            .iter()
            .copied()
            .filter(|&index| self.shown(index).parent.is_none())
            .find_map(|index| walk(self, index, &due))?;

        if self.shown(found).title_of.is_none() {
            self.about_to_paint(found);
        }

        Some(found)
    }

    /// A window's frame drawn again first if its parent painted over it;
    /// then its paint of its own taken as its `WM_PAINT` is (`USER.EXE`
    /// seg1 `7864`-`786a`, `4469`-`446f`): true where it had no update
    /// region, `BeginPaint`'s region then empty (`7640`) -- nothing of it is
    /// painted, and nothing of the windows in it made due.
    fn take_internal_paint(&mut self, index: usize) -> bool {
        if self.shown(index).needs_frame {
            self.shown_mut(index).needs_frame = false;
            self.paint_frame(index);
        }

        let internal = std::mem::take(&mut self.shown_mut(index).internal_paint);

        if !internal || self.shown(index).needs_paint {
            return false;
        }

        let shown = self.shown_mut(index);

        shown.paint_shape = Some(ClipRegion::EMPTY);
        shown.paint_clip = None;
        shown.walked = None;
        true
    }

    /// A window about to be sent `WM_PAINT`: for one without
    /// `WS_CLIPCHILDREN`, which paints over its children, its children
    /// where it is due made due again after it.
    pub fn about_to_paint(&mut self, index: usize) {
        // Another task's making it due looked at as its `WM_PAINT` is taken
        // (`USER.EXE` seg1 `787a`, `4483`).
        self.shown_mut(index).other_task = false;

        if self.take_internal_paint(index) {
            return;
        }

        let (mut dirty, quiet, mut shape, style, walked) = {
            let shown = self.shown(index);
            let dirty = shown.dirty;
            let quiet = dirty.is_some_and(|dirty| shown.quiet_dirty == Some(dirty.mark));
            let shape = match (dirty, &shown.dirty_shape) {
                (Some(dirty), Some((shape, mark))) if *mark == dirty.mark => Some(shape.clone()),
                _ => None,
            };

            (
                dirty.map(|dirty| dirty.area),
                quiet,
                shape,
                shown.style,
                shown.walked.clone(),
            )
        };
        let due = walked.as_ref().map(|_| self.update_region(index));

        {
            let shown = self.shown_mut(index);

            shown.paint_shape.clone_from(&shape);
            shown.dirty = None;
            shown.dirty_shape = None;
            shown.quiet_dirty = None;
            shown.paint_clip = dirty;
            shown.walked = None;
        }

        // Nor where USER's invalidation walk made it due, which made them
        // due as Windows makes them (`invalidate_through`): only where
        // something else did.
        if let (Some(walked), Some(due)) = (walked, due) {
            let left = walked.map_or(ClipRegion::EMPTY, |walked| due.subtract(&walked));
            let bounds = left.bounds();

            dirty = Some([bounds.left, bounds.top, bounds.right, bounds.bottom]);
            shape = Some(left);
        }

        if style & WS_CLIPCHILDREN != 0
            || quiet
            || shape.as_ref().is_some_and(|shape| shape.kind() <= 1)
        {
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
            if other == index || !self.within(other, index) || !self.showing(other) {
                continue;
            }

            // Where it is due as a region, only where the region is: the
            // place a child was moved from is due in its parent, and the
            // child at its new place is not, though the box of what was
            // uncovered reaches over it (`swpbits`).
            let part = match (&shape, dirty) {
                (_, None) => Some(None),
                (Some(shape), Some(_)) => {
                    let part =
                        shape.intersect(&ClipRegion::rect(place[0], place[1], place[2], place[3]));

                    (part.kind() > 1).then(|| {
                        let bounds = part.bounds();

                        Some([bounds.left, bounds.top, bounds.right, bounds.bottom])
                    })
                }
                (None, Some(dirty)) => (place[0] < dirty[2]
                    && dirty[0] < place[2]
                    && place[1] < dirty[3]
                    && dirty[1] < place[3])
                    .then_some(Some([
                        dirty[0].max(place[0]),
                        dirty[1].max(place[1]),
                        dirty[2].min(place[2]),
                        dirty[3].min(place[3]),
                    ])),
            };

            let Some(part) = part else {
                continue;
            };

            // Due where the parent is, added to what it was due already.
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
            // (`showseq`); a control of USER's, which paints itself, and an
            // icon's title, which has no window procedure, as it paints.
            if shown.hwnd != 0 && shown.control.is_none() {
                shown.needs_nc_paint = true;
            } else {
                shown.needs_frame = true;
            }
        }
    }

    /// A window moved or sized as `SetWindowPos` places it, `flags` the
    /// `SWP_` flags its caller in Windows gives -- every caller does,
    /// through `SetWindowPos` (`USER.EXE` seg7 `02f4`) or `MoveWindow`,
    /// which is `SetWindowPos` with `SWP_NOZORDER | SWP_NOACTIVATE`,
    /// `SWP_NOREDRAW` besides without a repaint (seg7 `0000`-`0061`).
    ///
    /// Of a list being placed -- a window minimized, maximized or
    /// restored, as `MinMaximize` places it with one `SetWindowPos` (seg6
    /// `1d56`-`1d81`) -- it is moved now and drawn as the list is drawn
    /// (`end_placing`): its old region and its new, nothing of its bits
    /// copied, as `SWP_NOCOPYBITS` has it for an icon made or restored
    /// (`1c59`, `1cd9`).
    ///
    /// Otherwise it is one window's list: moved or sized, as
    /// `move_with_bits` places it, its bits copied unless `SWP_NOCOPYBITS`,
    /// `WM_NCCALCSIZE`'s keeping of its client area where a size or
    /// `SWP_FRAMECHANGED` is given (seg7 `0e8f`-`0ea1`); not moved nor
    /// sized, its frame changed in place with `SWP_FRAMECHANGED`, as
    /// `SetWindowPos` draws it (`frame_changed`), and nothing else.
    /// `SWP_NOREDRAW` draws as without it (`swpbits`). A window hidden is
    /// only moved. The TypeScript engine's `place`.
    pub fn place_window(
        &mut self,
        index: usize,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
        flags: u16,
    ) -> Result<(), crate::call::Stop> {
        if self.placing.is_some() {
            self.placing_entry(index);
            self.relocate(index, left, top, width, height)?;

            if let Some(entry) = self.placing_entry(index) {
                entry.dest = Some([0, 0, 0, 0]);
            }

            return Ok(());
        }

        if !self.shown(index).visible {
            self.relocate(index, left, top, width, height)?;
            return Ok(());
        }

        let unchanged = {
            let shown = self.shown(index);

            [shown.left, shown.top, shown.width, shown.height] == [left, top, width, height]
        };

        if !unchanged {
            self.move_with_bits(
                index,
                [left, top, width, height],
                flags & crate::moved::SWP_NOCOPYBITS == 0,
                None,
                None,
                flags & SWP_NOSIZE == 0 || flags & crate::moved::SWP_FRAMECHANGED != 0,
                [0; 4],
            )?;
        } else if flags & crate::moved::SWP_FRAMECHANGED != 0 {
            self.begin_placing(&[index]);
            self.placing_flags(index, flags);

            let changed = self.frame_changed(index);

            self.end_placing(None);
            changed?;
            self.frame_due(index);
        }

        Ok(())
    }

    /// A window being made moved or laid out again, nothing drawn:
    /// `CreateWindow` shows a window only once `WM_CREATE` is answered
    /// (`USER.EXE` seg8 `0843`-`0861`), and what a class's own making does
    /// to its place and style before then -- a combo box's, a dialog's
    /// frame, an MDI client's scroll bars -- goes through no
    /// `SetWindowPos`. The TypeScript engine's `placeMade`.
    pub fn place_made(
        &mut self,
        index: usize,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
    ) -> Result<(), crate::call::Stop> {
        self.relocate(index, left, top, width, height)?;
        Ok(())
    }

    /// A window put at a new place and size, nothing drawn: its client area
    /// worked out again, its children moved as far as its client area did,
    /// and an icon's title with it. Where it was, and its children.
    pub(crate) fn relocate(
        &mut self,
        index: usize,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
    ) -> Result<([i32; 4], Vec<usize>), crate::call::Stop> {
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

        Ok((was, family))
    }

    /// The client area a window's procedure answered `WM_NCCALCSIZE` with,
    /// for the size it is to have, relative to its corner: kept where it is
    /// not what `DefWindowProc` makes, for the next time the window is laid
    /// out (`nccalc`).
    pub(crate) fn answer_client(
        &mut self,
        index: usize,
        width: i32,
        height: i32,
        client: crate::windows::Rect,
    ) -> Result<(), crate::call::Stop> {
        let mut window = self.shown(index).clone();

        window.width = width;
        window.height = height;

        let made = self.client_of(&window)?;
        let answer = (made != client
            && window.placement != Placement::Minimized
            && window.title_of.is_none())
        .then_some(crate::windows::ClientAnswer {
            client,
            width,
            height,
            style: window.style,
        });

        self.shown_mut(index).client_answer = answer;
        Ok(())
    }

    /// A window's client area worked out again from its frame: an icon's
    /// title is all client area.
    fn layout(&mut self, index: usize) -> Result<(), crate::call::Stop> {
        let shown = self.shown(index);
        let answer = shown.client_answer.filter(|answer| {
            answer.width == shown.width
                && answer.height == shown.height
                && answer.style == shown.style
                && shown.placement != Placement::Minimized
                && shown.title_of.is_none()
        });
        let client = if let Some(answer) = answer {
            answer.client
        } else if shown.title_of.is_some() {
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

    /// A window's children moved with its pixels by a scroll, as `USER.EXE`
    /// seg2 `0a1d` moves them: each child whose rectangle meets `rect` (any,
    /// for none), its rectangles and what it is due moved, and then its own
    /// children the same way, by the same rectangle. Nothing is drawn or
    /// sent; the screen's owners are worked out again after. The
    /// TypeScript engine's `Desktop.scrollChildren`.
    pub(crate) fn scroll_children_by(
        &mut self,
        parent: usize,
        (dx, dy): (i32, i32),
        rect: Option<[i32; 4]>,
    ) -> Result<(), crate::call::Stop> {
        self.shift_children(parent, (dx, dy), rect)?;
        self.own();
        Ok(())
    }

    fn shift_children(
        &mut self,
        of: usize,
        (dx, dy): (i32, i32),
        rect: Option<[i32; 4]>,
    ) -> Result<(), crate::call::Stop> {
        for child in self.windows_in(Some(of)) {
            let place = self.window_rect(child);

            if let Some(rect) = rect
                && !(rect[0].max(place[0]) < rect[2].min(place[2])
                    && rect[1].max(place[1]) < rect[3].min(place[3]))
            {
                continue;
            }

            {
                let shown = self.shown_mut(child);

                shown.left += dx;
                shown.top += dy;
            }

            self.layout(child)?;

            let shown = self.shown(child);

            if shown.needs_paint && shown.dirty.is_some() {
                let erase = shown.needs_erase;
                let shape = self.update_region(child).offset(dx, dy);

                self.set_update_of(child, shape, erase);
            }

            self.shift_children(child, (dx, dy), rect)?;
        }

        Ok(())
    }

    /// A window given a region of the screen as USER's invalidation gives
    /// it (`USER.EXE` seg1 `4202`; `invalidate_through`): all of itself for
    /// none, else the region added to what it is due, whole, not cut to the
    /// window -- `GetUpdateRect` cuts its box to the client area. One due
    /// all of itself stays so. Marked to be erased with `erase`, its frame
    /// drawn with `frame`; a window USER draws itself has its frame drawn
    /// now. The TypeScript engine's `Desktop.dueThrough`.
    pub(crate) fn due_through(
        &mut self,
        index: usize,
        region: Option<&ClipRegion>,
        erase: bool,
        frame: bool,
    ) {
        // A control of USER's draws its frame as it paints, as
        // `about_to_paint` has it: it has no `WM_NCPAINT` of a program's to
        // draw it.
        if !self.shown(index).paints_itself() {
            self.paint_frame(index);
        } else if frame && self.shown(index).control.is_some() {
            self.shown_mut(index).needs_frame = true;
        } else if frame {
            self.shown_mut(index).needs_nc_paint = true;
        }

        let shown = self.shown(index);

        // What of it the walk made due, which has made the windows in it
        // due itself: `about_to_paint` does not make them due there again.
        let walked = match (shown.needs_paint.then_some(&shown.walked), region) {
            (_, None) | (Some(Some(None)), _) => None,
            (Some(Some(Some(was))), Some(region)) => Some(was.union(region)),
            (_, Some(region)) => Some(region.clone()),
        };

        if shown.needs_paint && shown.dirty.is_none() {
            let shown = self.shown_mut(index);

            shown.needs_erase |= erase;
            shown.walked = Some(walked);
            return;
        }

        let Some(region) = region else {
            let shown = self.shown_mut(index);

            shown.dirty = None;
            shown.dirty_shape = None;
            shown.needs_paint = true;
            shown.needs_erase |= erase;
            shown.walked = Some(walked);
            return;
        };

        let due = if shown.needs_paint {
            self.update_region(index).union(region)
        } else {
            region.clone()
        };

        self.set_update_of(index, due, erase);
        self.shown_mut(index).walked = Some(walked);
    }

    /// A window validated as USER's invalidation walk validates it
    /// (`USER.EXE` seg1 `4309`-`43e6`): all of it for none, else what it is
    /// due less the region. All of a window whose frame is still to be
    /// drawn is its client area (`4353`-`4369`), and all it was due then
    /// the whole window (`4371`-`43a6`): what it was due of its frame
    /// stays, outside its client area. The TypeScript engine's
    /// `Desktop.validThrough`.
    pub(crate) fn valid_through(&mut self, index: usize, region: Option<&ClipRegion>) {
        let shown = self.shown(index);

        if !shown.needs_paint {
            return;
        }

        let client = ClipRegion::rect(
            shown.left + shown.client.left,
            shown.top + shown.client.top,
            shown.left + shown.client.right,
            shown.top + shown.client.bottom,
        );
        let region = match region {
            Some(region) => region.clone(),
            None if shown.needs_nc_paint => client.clone(),
            None => {
                self.set_update_of(index, ClipRegion::EMPTY, false);
                return;
            }
        };
        let due = if shown.dirty.is_some() {
            self.update_region(index)
        } else if shown.needs_nc_paint {
            ClipRegion::rect(
                shown.left,
                shown.top,
                shown.left + shown.width,
                shown.top + shown.height,
            )
        } else {
            client
        };

        self.set_update_of(index, due.subtract(&region), false);
    }

    /// What a window gone from a place uncovered: every window shown that
    /// overlaps it due there, its frame by `WM_NCPAINT` even where only its
    /// client area was uncovered (`uncovr2`).
    pub(crate) fn expose(&mut self, area: [i32; 4]) {
        self.paint_background_in(area);

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

    /// Everything to be drawn again, as after the system colours change:
    /// nothing is drawn at once. **Recorded** by `syscol`: the desktop shows
    /// its new colour once a program takes its messages, and each window is
    /// sent `WM_PAINT`, its frame drawn by `WM_NCPAINT` in `BeginPaint`
    /// before its `WM_ERASEBKGND`.
    pub fn repaint_all(&mut self) {
        self.repaint_all_frames(true);
    }

    /// Everything to be drawn again, the frames too only with `frames`:
    /// `RepaintScreen` leaves them.
    pub fn repaint_all_frames(&mut self, frames: bool) {
        self.background_due = true;

        for index in self.z_order.clone().into_iter().rev() {
            if !self.showing(index) {
                continue;
            }

            let shown = self.shown_mut(index);

            if shown.paints_itself() {
                shown.needs_nc_paint |= frames;
                shown.dirty = None;
                shown.needs_erase = true;
                shown.needs_paint = true;
            } else {
                // An icon's title, which has no window procedure: with the
                // desktop.
                shown.needs_frame = true;
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
        self.maximize_to(index, None)
    }

    /// A window maximized, to a place and size on the screen where one is
    /// given: where `WM_GETMINMAXINFO` and `WM_WINDOWPOSCHANGING` left it
    /// (`minmax`).
    pub fn maximize_to(
        &mut self,
        index: usize,
        to: Option<[i32; 4]>,
    ) -> Result<(), crate::call::Stop> {
        let (placement, place, style, parent) = {
            let shown = self.shown(index);

            (
                shown.placement,
                [shown.left, shown.top, shown.width, shown.height],
                shown.style,
                shown.parent,
            )
        };

        // Placed as `MinMaximize` places it: `SWP_FRAMECHANGED`, and
        // `SWP_NOCOPYBITS` from an icon (`USER.EXE` seg6 `1cd9`, `1d39`).
        let flags = min_max_flags(placement);

        self.keep_icon_place(index);
        self.leave_icon(index);

        if placement == Placement::Normal {
            self.shown_mut(index).restore_rect = Some(place);
        }

        self.shown_mut(index).placement = Placement::Maximized;

        if let Some([left, top, width, height]) = to {
            return self.place_window(index, left, top, width, height, flags);
        }

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

            return self.place_window(index, left, top, width, height, flags);
        }

        let (width, height) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );

        if style & WS_THICKFRAME == 0 {
            let (bx, by) = (self.metric(SM_CXBORDER), self.metric(SM_CYBORDER));

            return self.place_window(index, -bx, -by, width + 4 * bx, height + 4 * by, flags);
        }

        let (cx, cy) = (self.metric(SM_CXFRAME), self.metric(SM_CYFRAME));

        self.place_window(index, -cx, -cy, width + 2 * cx, height + 2 * cy, flags)
    }

    /// A minimized or maximized window no longer one, where it lies: an
    /// icon's title hidden, its placement normal again; the place it had
    /// before, for its caller to put it at (`MinMaximize`, `USER.EXE` seg6
    /// `1cdd`-`1d39`). `None` where it was neither. The TypeScript engine's
    /// `leaveToNormal`.
    pub(crate) fn leave_to_normal(
        &mut self,
        index: usize,
    ) -> Result<Option<[i32; 4]>, crate::call::Stop> {
        let (placement, rect) = {
            let shown = self.shown(index);

            (shown.placement, shown.restore_rect)
        };
        let Some(rect) = rect.filter(|_| placement != Placement::Normal) else {
            return Ok(None);
        };

        self.keep_icon_place(index);
        self.leave_icon(index);
        self.shown_mut(index).placement = Placement::Normal;
        self.layout(index)?;
        Ok(Some(rect))
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

        // As `MinMaximize` places it (seg6 `1cd9`, `1d39`).
        let flags = min_max_flags(placement);

        self.keep_icon_place(index);
        self.leave_icon(index);
        self.shown_mut(index).placement = Placement::Normal;
        self.place_window(index, left, top, width, height, flags)
    }

    /// An icon's title made for a window: a window of USER's, of its own
    /// class `#32772`, which `SetWindowPos` can name (`showmin`), drawn by the
    /// desktop; just above its icon among the windows.
    fn make_title(&mut self, index: usize) -> usize {
        if self.handles.retrieve(ICON_TITLE_CLASS).is_none() {
            self.register_class(crate::classes::WindowClass {
                style: 0,
                proc: crate::classes::WndProc::Host(crate::classes::HostProc::DefWindow(
                    ICON_TITLE_CLASS.to_string(),
                )),
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
        let (text, task) = {
            let shown = self.shown(index);

            (shown.title.clone(), shown.task)
        };

        // USER makes it with `CreateWindow` as the window is minimized
        // (`USER.EXE` seg1 `6ab8`), so its messages go to the queue of the
        // task minimizing it -- here, the icon's own: a press on it is the
        // icon's task's to take.
        self.windows.push(Some(Window {
            style: 0x8000_0000,
            title: text,
            class: ICON_TITLE_CLASS.to_string(),
            title_of: Some(index),
            task,
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

        self.lose_focus(title);
        self.windows[title] = None;
    }

    /// Where an icon was, kept as it stops being one: **recorded** by
    /// `intpos`, whose window restored answers the point its icon was at.
    fn keep_icon_place(&mut self, index: usize) {
        let shown = self.shown_mut(index);

        if shown.placement == Placement::Minimized {
            shown.icon_was = Some((shown.left, shown.top));
        }

        // And where it was maximized, kept as it stops being so
        // (`wplace`).
        if shown.placement == Placement::Maximized {
            shown.max_was = Some((shown.left, shown.top));
        }
    }

    /// An icon's title hidden as its window stops being an icon, and kept,
    /// where it lies among the windows, for the next time it is one: USER
    /// hides it with `ShowWindow(SW_HIDE)` (`USER.EXE` seg6 `1cdd`-`1ce0`,
    /// seg1 `6e25`-`6e9e`) and keeps it in the window's own record until
    /// the window is destroyed (`minact`). The TypeScript engine's
    /// `#leaveIcon`.
    pub(crate) fn leave_icon(&mut self, index: usize) {
        if let Some(title) = self.shown(index).icon_title
            && self.shown(title).visible
        {
            self.hide_with(title, false);
        }
    }

    /// A window's icon title while it is an icon: the title kept hidden
    /// otherwise is none. The TypeScript engine's `shownTitle`.
    pub(crate) fn shown_title(&self, index: usize) -> Option<usize> {
        let shown = self.shown(index);

        shown
            .icon_title
            .filter(|_| shown.placement == Placement::Minimized)
    }

    /// A window's icon title taken away with it, as it is destroyed.
    pub(crate) fn drop_icon_title(&mut self, index: usize) {
        if let Some(title) = self.shown_mut(index).icon_title.take() {
            self.destroy_title(title);
        }

        // A title destroyed on its own -- its task ended, or a program
        // destroyed it -- is its icon's no more.
        if let Some(icon) = self.shown(index).title_of
            && let Some(icon) = self.windows[icon].as_mut()
            && icon.icon_title == Some(index)
        {
            icon.icon_title = None;
        }
    }

    /// An icon's title under it, centred, as `USER.EXE` places it (seg1
    /// `6c14`): its text measured (`6b43`) -- its trailing spaces dropped,
    /// all but the first -- with `DrawText`'s `DT_CALCRECT`, broken into
    /// lines no wider than `SM_CXICONSPACING` less two borders where
    /// wrapping is on, a word wider than that on a line of its own; the
    /// window as high as the lines and as wide as the widest and four
    /// borders, half that less half the icon to the left of the icon's
    /// middle. A title of nothing is measured as the whole width and one
    /// line (`6be4`). **Recorded** by `ictwrap`.
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
        let letters = crate::frame::Lettering::of(font);
        let border = self.metric(SM_CXBORDER);
        let limit = self.metric(SM_CXICONSPACING) - 2 * border;
        let mut bytes = crate::desktop_paint::icon_title_text(&text);
        let (wide, down) = if bytes.is_empty() {
            (limit, letters.height)
        } else {
            let mut at = bytes.len() - 1;

            while at != 0 && bytes[at] == b' ' {
                bytes.pop();
                at -= 1;
            }

            let ops = crate::desktop_paint::TitleOps::measuring(&letters);
            let format = self.icon_title_format();
            let (wide, down) = crate::draw_text::calc_plain(
                self,
                &ops,
                &bytes,
                i64::from(limit),
                format,
                i64::from(letters.average),
            )?;

            (wide as i32, down as i32)
        };
        let across = wide + 4 * border;

        {
            let shown = self.shown_mut(title);

            shown.title = text;
            shown.visible = visible;
        }

        // `ShowIconTitle` places it with `SWP_NOACTIVATE` where it is not
        // the window after its icon already, else nothing but the place
        // (`USER.EXE` seg1 `6d75`-`6db6`).
        self.place_window(
            title,
            left + (width >> 1) - (wide >> 1) - 2 * border,
            top + height,
            across,
            down,
            crate::moved::SWP_NOACTIVATE,
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

        self.keep_icon_place(index);

        if placement == Placement::Normal {
            self.shown_mut(index).restore_rect = Some(place);
        }

        // Whether it was maximized, which it is again when it is restored
        // (`USER.EXE` seg6 `1c2a`-`1c3c`, the window's record's flag 2).
        self.shown_mut(index).maximized_before = placement == Placement::Maximized;
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

        let (left, top) = self.shown(index).icon_place.unwrap_or((left + inset, top));

        self.place_window(
            index,
            left,
            top,
            icon_wide + 4,
            icon_high + 4,
            crate::moved::MINIMIZE_FLAGS,
        )?;

        // Its title made the first time, and kept after (`leave_icon`);
        // put just before it, as `ShowIconTitle` puts it after the window
        // before its icon (`USER.EXE` seg1 `6e69`-`6e85`).
        match self.shown(index).icon_title {
            Some(title) => {
                self.z_order.retain(|&other| other != title);

                let at = self
                    .z_order
                    .iter()
                    .position(|&other| other == index)
                    .unwrap_or(0);

                self.z_order.insert(at, title);
            }
            None => {
                self.make_title(index);
            }
        }

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
    pub fn to_bottom(&mut self, index: usize, show: bool, after: Option<usize>) {
        let title = self.shown(index).icon_title;
        let family =
            self.take_out(|system, other| system.within(other, index) || Some(other) == title);
        let ordered: Vec<usize> = family
            .iter()
            .copied()
            .filter(|&member| Some(member) == title)
            .chain(
                family
                    .iter()
                    .copied()
                    .filter(|&member| Some(member) != title),
            )
            .collect();

        // `after`: put after that window instead, as `MinMaximize` puts an
        // icon after the last of its brothers beneath it owned as it is
        // (`USER.EXE` seg6 `1e58`).
        match after.and_then(|after| self.z_order.iter().position(|&other| other == after)) {
            Some(at) => {
                self.z_order.splice(at + 1..=at, ordered);
            }
            None => self.z_order.extend(ordered),
        }

        // Of a list being placed, it is drawn as the list is
        // (`end_placing`).
        if self.placing.is_some() {
            if show {
                self.shown_mut(index).visible = true;

                if let Some(title) = title {
                    self.shown_mut(title).visible = true;
                }
            }

            return;
        }

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
/// What `MinMaximize` maximizes or restores a window with:
/// `SWP_FRAMECHANGED`, and `SWP_NOCOPYBITS` from an icon (`USER.EXE` seg6
/// `1cd9`, `1d39`).
fn min_max_flags(placement: Placement) -> u16 {
    crate::moved::SWP_FRAMECHANGED
        | if placement == Placement::Minimized {
            crate::moved::SWP_NOCOPYBITS
        } else {
            0
        }
}
