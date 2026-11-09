//! One window at a time kept from drawing on the screen, as `USER.EXE`
//! keeps it (seg13 `2276`). **Read out**:
//!
//! * Locking answers 1; locking while a window is locked, and unlocking with
//!   none locked, nought (`22af`, `22e5`).
//! * The window locked and those in it have no visible region, unless asked
//!   with `DCX_LOCKWINDOWUPDATE` (seg1 `15c4`-`15df`; `window_vis`): drawing
//!   on them shows nothing. Locking and unlocking make their contexts stale
//!   (`22dd`, `2306`).
//! * USER keeps the lock as it keeps the bits a `CS_SAVEBITS` window saved
//!   (seg13 `1e72`, flag 2, no bits): the window's rectangle on the screen,
//!   and what of it is still as it was, all of it to start with. GDI keeps
//!   in every context the bounds of what is drawn, Windows' own, whatever
//!   shows; locking empties them (`1eaa`-`1ec3`), and USER takes them back
//!   from each of its contexts (seg1 `06ff`) as it lends one for another
//!   window (`8666`, `868f`), as a window is placed (seg7 `057a`) and as the
//!   window is unlocked (`22ee`). What a context drew counts where its
//!   window is the locked window's parent, the locked window, one in it with
//!   no window before it among its brothers over the drawing, or a window
//!   behind it with no window between them over the drawing -- not one in
//!   front, nor drawing with `DCX_LOCKWINDOWUPDATE` (seg1 `087b`); it is
//!   taken out of what is as it was (`079a`). So is what is made due in a
//!   window there (`3f41`-`3f7c`) and what a scroll moves (seg13 `159d`).
//! * As it locks, what the windows from the locked one back, and those in
//!   them, and its parent, were due within its rectangle is no longer due,
//!   and counts as drawn (seg13 `206b`).
//! * Unlocking makes due what was drawn over -- the rectangle less what is
//!   as it was -- through the desktop: in the windows that show there,
//!   erased (`2315`-`2374`, `0x85`). Where all of it was drawn over, the
//!   lock was let go then (`081c`), and unlocking makes everything due.
//!
//! **Recorded** by `lockupd` and `vislock`.

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Stop};
use crate::dc_entries::DCX_EMPTY;
use crate::handles::Object;
use crate::invalidate_through::{
    RDW_ALLCHILDREN, RDW_ERASE, RDW_INVALIDATE, Rect, cut, is_empty, region_of,
};
use crate::system::System;
use crate::windows::Placement;

const DCX_WINDOW: u32 = 0x0001;
const DCX_LOCKWINDOWUPDATE: u32 = 0x0400;
/// Windows' own bounds set (`gdi::bounds`).
const WINDOWS_SET: u16 = 1;

/// The window locked, as USER keeps it.
#[derive(Debug, Clone)]
pub struct Lock {
    pub hwnd: u16,
    /// The window, by its index.
    pub window: usize,
    /// The window's rectangle on the screen as it was locked, none where it
    /// was off it.
    pub rect: Option<Rect>,
    /// What of it is still as it was: none for all of it, until something
    /// is drawn.
    pub still: Option<ClipRegion>,
    /// All of it drawn over: the lock let go of its rectangle (`081c`).
    pub gone: bool,
}

/// One of USER's records of a rectangle kept as it was, the list at its
/// word 13Eh (seg13 `1e72`): the lock's (its flag 2), or the bits a
/// `CS_SAVEBITS` window saved, by its place in `saves` (`save_bits`). Each
/// is told what is drawn alike (seg1 `074e`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Record {
    Lock,
    Save(usize),
}

/// What a context of USER's is lent for.
enum Lent {
    Desktop,
    Window(usize),
}

/// `SubtractRect` (`USER.EXE` seg1 `20b8`): cut only where `b` spans the
/// whole of `a` one way.
pub(crate) fn subtract_rect(a: Rect, b: Rect) -> Rect {
    let mut r = a;

    if is_empty(cut(a, b)) {
        return r;
    }

    if b[1] <= a[1] && b[3] >= a[3] {
        if b[0] <= a[0] {
            r[0] = b[2].min(a[2]);
        } else if b[2] >= a[2] {
            r[2] = b[0].max(a[0]);
        }
    }

    if b[0] <= a[0] && b[2] >= a[2] {
        if b[1] <= a[1] {
            r[1] = b[3].min(a[3]);
        } else if b[3] >= a[3] {
            r[3] = b[1].max(a[1]);
        }
    }

    r
}

impl System {
    /// Whether a window shows, for USER (seg1 `1c5f`); the desktop, none,
    /// always.
    pub(crate) fn user_shows(&self, window: Option<usize>, client: bool) -> bool {
        let Some(index) = window else {
            return true;
        };
        let mut at = Some(index);

        while let Some(one) = at {
            let shown = self.shown(one);

            if !shown.visible || (one != index && shown.placement == Placement::Minimized) {
                return false;
            }

            at = shown.parent;
        }

        !(client && self.paints_icon(index))
    }

    /// Whether drawing in `window` (none, the desktop) over `rect` counts
    /// against the lock, and the part that does (seg1 `087b`).
    fn lock_counts(
        &self,
        lock: &Lock,
        saved: bool,
        window: Option<usize>,
        mut rect: Rect,
        flags: u32,
    ) -> Option<Rect> {
        let locked = lock.window;
        let lock_rect = lock.rect?;

        // Drawing with `DCX_LOCKWINDOWUPDATE` does not count against the
        // lock, and does against saved bits (`08a9`-`08b3`).
        if self.windows[locked].is_none()
            || !self.user_shows(window, flags & DCX_WINDOW == 0)
            || (flags & DCX_LOCKWINDOWUPDATE != 0 && !saved)
        {
            return None;
        }

        let within = |r: Rect| {
            let part = cut(r, lock_rect);

            (!is_empty(part)).then_some(part)
        };
        let locked_parent = self.shown(locked).parent;

        if locked_parent == window {
            return within(rect);
        }

        // The window, or the one it is in, among the locked window's
        // brothers.
        let window = window?;
        let mut at = Some(window);

        while let Some(one) = at {
            if self.shown(one).parent == locked_parent {
                break;
            }

            at = self.shown(one).parent;
        }

        let at = at?;

        // Taken out where a window between covers it one way across
        // (`20b8`).
        let between = |from: &[usize], stop: usize, rect: &mut Rect| {
            for &other in from {
                if other == stop {
                    break;
                }

                if self.shown(other).visible {
                    *rect = subtract_rect(*rect, self.window_rect(other));

                    if is_empty(*rect) {
                        return false;
                    }
                }
            }

            true
        };

        if at == locked {
            // The saving window's own drawing, and its children's, does not
            // count against what it saved (`08cd`-`08d7`).
            if saved {
                return None;
            }

            if window == locked {
                return within(rect);
            }

            let mut child = window;

            while let Some(parent) = self.shown(child).parent {
                if parent == locked {
                    break;
                }

                child = parent;
            }

            return if between(&self.windows_in(Some(locked)), child, &mut rect) {
                within(rect)
            } else {
                None
            };
        }

        let brothers = self.windows_in(locked_parent);
        let at_index = brothers.iter().position(|&one| one == at);
        let locked_index = brothers.iter().position(|&one| one == locked);

        // In front of the locked window, it does not count.
        if locked_index > at_index {
            return None;
        }

        let after = locked_index.map_or(0, |index| index + 1);

        if between(&brothers[after..], at, &mut rect) {
            within(rect)
        } else {
            None
        }
    }

    /// Drawing in `window` (none, the desktop) over a rectangle of the
    /// screen, told to the lock (seg1 `074e`, `079a`): what counts is no
    /// longer as it was. `flags` are the context's, `DCX_WINDOW` and
    /// `DCX_LOCKWINDOWUPDATE`.
    pub(crate) fn lock_touched(&mut self, window: Option<usize>, rect: Rect, flags: u32) {
        self.touch(Record::Lock, window, rect, flags);

        // Saved bits all drawn over are let go (`081c`, seg1 `0959`).
        let saving: Vec<usize> = self
            .user_calls
            .saves
            .iter()
            .map(|saved| saved.kept.window)
            .collect();

        for window_saved in saving {
            let Some(at) = self
                .user_calls
                .saves
                .iter()
                .position(|saved| saved.kept.window == window_saved)
            else {
                continue;
            };

            if self.touch(Record::Save(at), window, rect, flags) {
                self.discard_saved(window_saved);
            }
        }
    }

    /// A record of USER's, if it is kept.
    fn record(&self, which: Record) -> Option<&Lock> {
        match which {
            Record::Lock => self.user_calls.locked.as_ref(),
            Record::Save(at) => self.user_calls.saves.get(at).map(|saved| &saved.kept),
        }
    }

    /// One record told of drawing (seg1 `079a`): true where all of it is now
    /// drawn over.
    fn touch(&mut self, which: Record, window: Option<usize>, rect: Rect, flags: u32) -> bool {
        let Some(lock) = self.record(which) else {
            return false;
        };

        if lock.gone {
            return false;
        }

        let Some(lock_rect) = lock.rect else {
            return false;
        };
        let Some(part) =
            self.lock_counts(lock, matches!(which, Record::Save(_)), window, rect, flags)
        else {
            return false;
        };
        let lock = match which {
            Record::Lock => self.user_calls.locked.as_mut().expect("the lock"),
            Record::Save(at) => &mut self.user_calls.saves[at].kept,
        };
        let still = lock
            .still
            .take()
            .unwrap_or_else(|| region_of(lock_rect))
            .subtract(&region_of(part));

        lock.gone = still.kind() == 1;
        lock.still = Some(still);
        lock.gone
    }

    /// Whether USER keeps any record, the lock or saved bits (its word
    /// 13Eh).
    pub(crate) fn any_kept(&self) -> bool {
        self.user_calls.locked.is_some() || !self.user_calls.saves.is_empty()
    }

    /// What an entry is lent for: none for no window.
    fn entry_window(&self, at: usize) -> Option<Lent> {
        let hwnd = self.dc_entries.list[at].hwnd;

        if hwnd == 0 {
            return None;
        }

        match self.handles.resolve(hwnd) {
            Some(Object::Desktop) => Some(Lent::Desktop),
            _ => self.window_named(hwnd).map(Lent::Window),
        }
    }

    /// Windows' bounds taken back from an entry's context, by its place in
    /// the list, and emptied, and told to the lock cut to its window's
    /// rectangle (seg1 `06ff`).
    pub(crate) fn harvest(&mut self, at: usize) {
        let dc = self.dc_entries.list[at].dc;
        let bounds = &mut self.gdi.dcs[dc].bounds;

        if bounds.flags & WINDOWS_SET == 0 {
            return;
        }

        let drawn = bounds.windows;

        bounds.windows = crate::gdi::bounds::EMPTY;
        bounds.flags &= !WINDOWS_SET;

        let window = match self.entry_window(at) {
            Some(Lent::Window(index)) => Some(index),
            Some(Lent::Desktop) => None,
            None => return,
        };
        let within = match window {
            Some(index) => self.window_rect(index),
            None => [
                0,
                0,
                i32::from(self.display.width),
                i32::from(self.display.height),
            ],
        };
        let part = cut(drawn, within);

        if !is_empty(part) {
            let flags = self.dc_entries.list[at].flags;

            self.lock_touched(window, part, flags);
        }
    }

    /// Every context's bounds taken back, where a window is locked (seg1
    /// `06df`).
    pub(crate) fn harvest_all(&mut self) {
        if !self.any_kept() || self.dc_entries.list.is_empty() {
            return;
        }

        for at in 0..self.dc_entries.list.len() {
            if self.dc_entries.list[at].flags & DCX_EMPTY == 0 {
                self.harvest(at);
            }
        }
    }

    /// What a window was due within the lock's rectangle no longer due, and
    /// counted as drawn; then the windows in it, with `deep` (seg13 `206b`):
    /// false where all of the rectangle was taken.
    pub(crate) fn take_due(
        &mut self,
        which: Record,
        lock_rect: Rect,
        index: usize,
        deep: bool,
    ) -> bool {
        if self.shown(index).needs_paint {
            let due = self.update_region(index);
            let mut area = if self.shown(index).dirty.is_some() {
                let bounds = due.bounds();

                [bounds.left, bounds.top, bounds.right, bounds.bottom]
            } else {
                self.window_rect(index)
            };

            // Shown, and cut to the client areas it is in (seg1 `8bb3`).
            let mut visible = self.shown(index).visible;
            let mut up = self.shown(index).parent;

            while visible && let Some(parent) = up {
                let shown = self.shown(parent);

                if !shown.visible || shown.placement == Placement::Minimized {
                    visible = false;
                } else {
                    area = cut(area, self.client_rect(parent));
                }

                up = shown.parent;
            }

            if visible && !is_empty(area) {
                // `RDW_VALIDATE | RDW_NOCHILDREN` of the lock's rectangle.
                self.set_update_of(index, due.subtract(&region_of(lock_rect)), false);

                if !self.shown(index).needs_paint {
                    self.shown_mut(index).needs_erase = false;
                }

                // Told to this record alone (seg13 `20e1`, seg1 `079a`).
                if self.touch(which, Some(index), area, DCX_WINDOW) {
                    if let Record::Save(at) = which {
                        let window = self.user_calls.saves[at].kept.window;

                        self.discard_saved(window);
                    }

                    return false;
                }
            }
        }

        if deep {
            for child in self.windows_in(Some(index)) {
                if !self.take_due(which, lock_rect, child, true) {
                    return false;
                }
            }
        }

        true
    }

    /// What a window is made due, told to the records USER keeps
    /// (`USER.EXE` seg1 `3f41`-`3f7c`): the rectangle given, in its client
    /// area's terms, or all, within its client area -- within its whole
    /// window with `frame`, `RDW_FRAME` (`3edd`-`3efc`; `rdwmore`).
    pub(crate) fn tell_lock(&mut self, index: usize, rect: Option<Rect>, frame: bool) {
        if !self.any_kept() {
            return;
        }

        let shown = self.shown(index);
        let left = shown.left + shown.client.left;
        let top = shown.top + shown.client.top;
        let (width, height) = (shown.client_width(), shown.client_height());
        let within = if frame {
            self.window_rect(index)
        } else {
            [left, top, left + width, top + height]
        };
        let told = match rect {
            Some(rect) => cut(
                [rect[0] + left, rect[1] + top, rect[2] + left, rect[3] + top],
                within,
            ),
            None => within,
        };

        if told[0] < told[2] && told[1] < told[3] {
            self.lock_touched(Some(index), told, 0);
        }
    }

    /// What is made due of the desktop told to the records USER keeps, as
    /// `tell_lock` tells a window's (`USER.EXE` seg1 `3f41`-`3f7c`): the box
    /// given, or all, within the screen, the desktop window's client area.
    pub(crate) fn tell_desktop(&mut self, rect: Option<Rect>) {
        if !self.any_kept() {
            return;
        }

        let screen = [
            0,
            0,
            i32::from(self.display.width),
            i32::from(self.display.height),
        ];
        let told = rect.map_or(screen, |rect| cut(rect, screen));

        if told[0] < told[2] && told[1] < told[3] {
            self.lock_touched(None, told, 0);
        }
    }
}

pub(super) fn lock_window_update(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    if hwnd != 0 {
        let Some(window) = system.window_named(hwnd) else {
            return Ok(Answer::Word(0));
        };

        if system.user_calls.locked.is_some() {
            return Ok(Answer::Word(0));
        }

        // Windows' bounds emptied in every context (`1eaa`-`1ec3`) -- taken
        // back for the records kept, where USER keeps any (`1e9c`-`1ea8`).
        system.dc_entries_made();
        system.harvest_all();

        for at in 0..system.dc_entries.list.len() {
            let dc = system.dc_entries.list[at].dc;
            let bounds = &mut system.gdi.dcs[dc].bounds;

            bounds.windows = crate::gdi::bounds::EMPTY;
            bounds.flags &= !WINDOWS_SET;
        }

        let screen = [
            0,
            0,
            i32::from(system.display.width),
            i32::from(system.display.height),
        ];
        let rect = cut(system.window_rect(window), screen);
        let rect = (!is_empty(rect)).then_some(rect);

        system.user_calls.locked = Some(Lock {
            hwnd,
            window,
            rect,
            still: None,
            gone: false,
        });

        // What was due there, from the window back (`2028`-`2063`).
        if let Some(rect) = rect {
            let parent = system.shown(window).parent;

            if let Some(parent) = parent {
                system.take_due(Record::Lock, rect, parent, false);
            }

            let brothers = system.windows_in(parent);
            let from = brothers
                .iter()
                .position(|&one| one == window)
                .unwrap_or(brothers.len());

            for &brother in &brothers[from..] {
                if !system.take_due(Record::Lock, rect, brother, true) {
                    break;
                }
            }
        }

        system.make_stale(hwnd, 1);
        return Ok(Answer::Word(1));
    }

    if system.user_calls.locked.is_none() {
        return Ok(Answer::Word(0));
    }

    system.harvest_all();

    let lock = system.user_calls.locked.take().expect("the lock");

    system.make_stale(lock.hwnd, 1);

    let flags = RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN;

    match (lock.rect, &lock.still) {
        (None, _) => system.invalidate_through(None, None, flags),
        _ if lock.gone => system.invalidate_through(None, None, flags),
        (Some(rect), Some(still)) => {
            let drawn = region_of(rect).subtract(still);

            if drawn.kind() > 1 {
                system.invalidate_through(None, Some(&drawn), flags);
            }
        }
        (Some(_), None) => {}
    }

    Ok(Answer::Word(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handles::Kind;
    use crate::windows::{Rect as Sides, Window};

    /// A system on the VGA display with one window shown, its client area
    /// 40 by 30 at (10, 20) on the screen: its handle.
    fn with_window(system: &mut System) -> u16 {
        system.display = crate::display::mode("vga").expect("the display");
        system.windows.push(Some(Window {
            left: 5,
            top: 10,
            width: 50,
            height: 40,
            visible: true,
            style: 0x0400_0000,
            client: Sides {
                left: 5,
                top: 10,
                right: 45,
                bottom: 40,
            },
            ..Window::default()
        }));
        system.z_order.push(0);

        let hwnd = system
            .handles
            .allocate(Kind::Window, Object::Window(0))
            .expect("a handle");

        system.windows[0].as_mut().expect("the window").hwnd = hwnd;
        hwnd
    }

    fn lock(system: &mut System, hwnd: u16) -> Answer {
        lock_window_update(system, &mut Args::repeat(hwnd)).expect("an answer")
    }

    #[test]
    fn one_window_at_a_time_and_none_unlocked_twice() {
        let mut system = System::new();
        let hwnd = with_window(&mut system);

        assert_eq!(lock(&mut system, 0), Answer::Word(0));
        assert_eq!(lock(&mut system, hwnd.wrapping_add(4)), Answer::Word(0));
        assert_eq!(lock(&mut system, hwnd), Answer::Word(1));
        assert_eq!(lock(&mut system, hwnd), Answer::Word(0));
        assert_eq!(lock(&mut system, 0), Answer::Word(1));
        assert_eq!(lock(&mut system, 0), Answer::Word(0));
    }

    #[test]
    fn subtract_rect_cuts_only_across() {
        assert_eq!(subtract_rect([0, 0, 10, 10], [0, 0, 4, 10]), [4, 0, 10, 10]);
        assert_eq!(
            subtract_rect([0, 0, 10, 10], [6, -1, 12, 11]),
            [0, 0, 6, 10]
        );
        assert_eq!(subtract_rect([0, 0, 10, 10], [2, 2, 4, 4]), [0, 0, 10, 10]);
    }

    #[test]
    fn unlocking_makes_due_what_was_drawn_over_and_no_more() {
        let mut system = System::new();
        let hwnd = with_window(&mut system);

        assert_eq!(lock(&mut system, hwnd), Answer::Word(1));
        system.tell_lock(0, Some([2, 3, 6, 8]), false);
        assert!(!system.windows[0].as_ref().expect("the window").needs_paint);
        assert_eq!(lock(&mut system, 0), Answer::Word(1));

        let window = system.windows[0].as_ref().expect("the window");

        assert!(window.needs_paint);
        assert!(window.needs_erase);
        assert_eq!(
            window.dirty.map(|dirty| dirty.area),
            Some([2 + 10, 3 + 20, 6 + 10, 8 + 20])
        );
    }

    #[test]
    fn nothing_drawn_makes_nothing_due() {
        let mut system = System::new();
        let hwnd = with_window(&mut system);

        assert_eq!(lock(&mut system, hwnd), Answer::Word(1));
        assert_eq!(lock(&mut system, 0), Answer::Word(1));
        assert!(!system.windows[0].as_ref().expect("the window").needs_paint);
    }
}
