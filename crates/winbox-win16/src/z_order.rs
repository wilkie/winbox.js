//! Where `SetWindowPos` puts a window at the top among the windows, and the
//! windows of its owner's family it brings with it, as `USER.EXE`'s
//! `EndDeferWindowPos` works it out (seg7 `01fd`): the window to go after
//! and whether it is made topmost or not (`1400`), the windows made so with
//! it (`13be`), the list of its owner's family (`12af`, `14ae`, `1606`),
//! whether each already lies where it is asked to go (`1184`, from
//! `0e09`-`0e38` before anything moves and `0a63`-`0a96` as each is
//! placed), and each linked after the window it is to go after, topmost
//! changed as it is (`0b46`-`0b71`). **Recorded** by `zorder` and
//! `dlgfront`. The TypeScript engine's `z-order.ts`.
//!
//! The windows at the top are the desktop's, front first; an icon's title
//! is one of them, owned by its icon, from the time USER makes it (seg1
//! `6e25`). A window is named by its handle: `HWND_TOP` 0, `HWND_BOTTOM` 1.

use crate::system::System;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOZORDER: u16 = 0x0004;
const SWP_NOACTIVATE: u16 = 0x0010;
const SWP_NOOWNERZORDER: u16 = 0x0200;
const HWND_TOPMOST: u16 = 0xffff;
const HWND_NOTOPMOST: u16 = 0xfffe;
const WS_EX_TOPMOST: u32 = 0x0008;

/// One window of the list: where it is to go, and what became of it.
#[derive(Clone, Debug)]
pub(crate) struct ZEntry {
    pub member: usize,
    /// The window it goes after, as `WM_WINDOWPOSCHANGING` and `CHANGED`
    /// name it.
    pub after: u16,
    /// Left where it lay: `SWP_NOZORDER` given or added (`0e38`), or found
    /// in place (`0a7c`).
    pub stays: bool,
    /// Linked where it was to go (`0b46`-`0b62`).
    pub linked: bool,
}

/// A window's list, and the windows made topmost or not with it.
#[derive(Clone, Debug, Default)]
pub(crate) struct ZPlan {
    pub entries: Vec<ZEntry>,
    pub flip: Vec<usize>,
}

impl ZPlan {
    /// The entry of a window of the list.
    pub(crate) fn entry(&self, member: usize) -> Option<&ZEntry> {
        self.entries.iter().find(|entry| entry.member == member)
    }

    pub(crate) fn entry_mut(&mut self, member: usize) -> Option<&mut ZEntry> {
        self.entries.iter_mut().find(|entry| entry.member == member)
    }
}

impl System {
    /// The windows at the top, the front first (the desktop's list of
    /// children).
    fn z_siblings(&self) -> Vec<usize> {
        self.z_order
            .iter()
            .copied()
            .filter(|&other| {
                let window = self.shown(other);

                window.parent.is_none()
                    && window.title_of.is_none_or(|icon| {
                        self.windows[icon]
                            .as_ref()
                            .is_some_and(|icon| icon.title_asked)
                    })
            })
            .collect()
    }

    fn z_handle(&self, index: Option<usize>) -> u16 {
        index.map_or(0, |index| self.shown(index).hwnd)
    }

    fn z_named(&self, hwnd: u16) -> Option<usize> {
        if hwnd <= 1 {
            return None;
        }

        self.z_siblings()
            .into_iter()
            .find(|&other| self.shown(other).hwnd == hwnd)
    }

    /// The window it is owned by, as the window at the top that one is in
    /// (seg7 `173a`).
    fn z_owner(&self, index: usize) -> Option<usize> {
        let window = self.windows[index].as_ref()?;
        let mut at = window.owner.or(window.title_of)?;

        while let Some(parent) = self.windows[at].as_ref().and_then(|window| window.parent) {
            at = parent;
        }

        (at != index).then_some(at)
    }

    /// The windows at the top owned by one, front first (seg7 `177d`).
    fn z_owned_by(&self, owner: usize) -> Vec<usize> {
        self.z_siblings()
            .into_iter()
            .filter(|&other| self.z_owner(other) == Some(owner))
            .collect()
    }

    /// The window at the end of its owners.
    fn z_head(&self, index: usize) -> usize {
        let mut seen = Vec::new();
        let mut head = index;

        while let Some(up) = self.z_owner(head) {
            if seen.contains(&up) {
                break;
            }

            seen.push(head);
            head = up;
        }

        head
    }

    /// Whether a window is owned under `head`, or is it (seg7 `1700`).
    fn z_in_family(&self, index: usize, head: usize) -> bool {
        let mut seen = Vec::new();
        let mut at = Some(index);

        while let Some(window) = at {
            if window == head {
                return true;
            }

            if seen.contains(&window) {
                break;
            }

            seen.push(window);
            at = self.z_owner(window);
        }

        false
    }

    /// The last of the topmost windows at the front, or none where the
    /// first is not topmost (seg7 `02c9`): where `HWND_TOP` puts a window
    /// that is not.
    pub(crate) fn z_last_topmost(&self) -> Option<usize> {
        let mut last = None;

        for other in self.z_siblings() {
            if !self.shown(other).topmost {
                break;
            }

            last = Some(other);
        }

        last
    }

    /// The window to go after, as USER works it out from what it was asked
    /// (seg7 `1400`), and whether the window is made topmost (1), topmost no
    /// more (2), or neither (0).
    fn z_resolve(&self, index: usize, after: u16, flags: u16) -> (u16, u8) {
        let tops = self.z_siblings();
        let before = || {
            let at = tops.iter().position(|&other| other == index);

            self.z_handle(at.and_then(|at| at.checked_sub(1)).map(|at| tops[at]))
        };
        let topmost = self.shown(index).topmost;
        // Made active, to the top, unless it is the active window or was
        // asked for HWND_TOPMOST or HWND_NOTOPMOST (`1401`-`141b`).
        let after = if flags & (SWP_NOZORDER | SWP_NOACTIVATE) == 0
            && after != HWND_TOPMOST
            && after != HWND_NOTOPMOST
            && self.active_top() != Some(index)
        {
            0
        } else {
            after
        };

        if flags & SWP_NOZORDER != 0 {
            return (after, 0);
        }

        match after {
            1 => (after, 2),
            // After the last topmost window, or where it is the last, after
            // the one in front of it; one that is not topmost, after the
            // one in front of it (`1436`-`145d`).
            HWND_NOTOPMOST if topmost => {
                let last = self.z_last_topmost();

                if last == Some(index) {
                    (before(), 2)
                } else {
                    (self.z_handle(last), 2)
                }
            }
            HWND_NOTOPMOST => (before(), 2),
            HWND_TOPMOST => (0, 1),
            0 if topmost => (0, 0),
            0 => (self.z_handle(self.z_last_topmost()), 0),
            // After a window: the last topmost leaves it as it was
            // (`1486`-`148d`); another topmost one makes it topmost, one
            // that is not, not.
            _ if self.z_handle(self.z_last_topmost()) == after => (after, 0),
            _ if self
                .z_named(after)
                .is_some_and(|other| self.shown(other).topmost) =>
            {
                (after, u8::from(!topmost))
            }
            _ => (after, if topmost { 2 } else { 0 }),
        }
    }

    /// The windows made topmost, or topmost no more, as the window is:
    /// made topmost, it and the windows owned under it; made not, the
    /// window at the end of its owners and every window owned under that
    /// (seg7 `137c`-`13a5`, `13be`). Those already so are left.
    fn z_flipped(&self, index: usize, change: u8) -> Vec<usize> {
        fn mark(
            system: &System,
            at: usize,
            want: bool,
            flip: &mut Vec<usize>,
            seen: &mut Vec<usize>,
        ) {
            if seen.contains(&at) {
                return;
            }

            seen.push(at);

            if system.shown(at).topmost != want {
                flip.push(at);
            }

            for owned in system.z_owned_by(at) {
                mark(system, owned, want, flip, seen);
            }
        }

        let mut flip = Vec::new();

        if change != 0 {
            let from = if change == 2 {
                self.z_head(index)
            } else {
                index
            };

            mark(self, from, change == 1, &mut flip, &mut Vec::new());
        }

        flip
    }

    /// The family listed from `node`: each window it owns, front to back,
    /// with the windows it owns before it, and `node` last; the branch the
    /// window moved is in where it was asked among them (seg7
    /// `1606`-`16f8`, `15d7`).
    fn z_listed(
        &self,
        node: usize,
        window: Option<usize>,
        after: u16,
        seen: &mut Vec<usize>,
        out: &mut Vec<usize>,
    ) {
        if seen.contains(&node) {
            return;
        }

        seen.push(node);

        let mut branch = window;

        while let Some(at) = branch {
            if self.z_owner(at) == Some(node) {
                break;
            }

            branch = self.z_owner(at);
        }

        let tops = self.z_siblings();
        // Whether the place asked lies in front of `at` (`15d7`).
        let in_front = |at: usize| {
            after == 0
                || (after != 1
                    && !tops
                        .iter()
                        .skip_while(|&&other| other != at)
                        .any(|&other| self.shown(other).hwnd == after))
        };
        let mut done = false;

        for at in self.z_owned_by(node) {
            if let Some(branch) = branch
                && !done
                && in_front(at)
            {
                self.z_listed(branch, window, after, seen, out);
                done = true;
            }

            if Some(at) != branch {
                self.z_listed(at, None, 0, seen, out);
            }
        }

        if let Some(branch) = branch
            && !done
        {
            self.z_listed(branch, window, after, seen, out);
        }

        out.push(node);
    }

    /// A window at the top's list, asked to go after `asked` with `flags`:
    /// the windows of its owner's family it brings, each to go after the
    /// one before, and the windows made topmost or not with it.
    pub(crate) fn plan_z_order(&self, index: usize, asked: u16, flags: u16) -> ZPlan {
        let (after, change) = self.z_resolve(index, asked, flags);
        let flip = self.z_flipped(index, change);
        let alone = |stays: bool| ZPlan {
            entries: vec![ZEntry {
                member: index,
                after,
                stays,
                linked: false,
            }],
            flip: flip.clone(),
        };

        // Nothing brought: not put elsewhere, `SWP_NOOWNERZORDER`, or a
        // window owned by none that owns none (`14c1`-`14f7`).
        if flags & (SWP_NOZORDER | SWP_NOOWNERZORDER) != 0 || self.user_calls.in_sys_error_box {
            return alone(flags & SWP_NOZORDER != 0);
        }

        let owned = self.z_owned_by(index);
        let owner_top = self.z_owner(index);

        if owner_top.is_none() && owned.is_empty() {
            return alone(false);
        }

        let head = self.z_head(index);
        let tops = self.z_siblings();
        let mut place = after;

        if after == 1 {
            // At the bottom: after the last window not of the family; with
            // none, where it lies (`151b`-`1548`).
            for &other in &tops {
                if !self.z_in_family(other, head) {
                    place = self.shown(other).hwnd;
                }
            }

            if place == 1 {
                return alone(true);
            }
        } else if after != 0
            && let Some(other) = self.z_named(after)
            && self.z_in_family(other, head)
        {
            // After a window of its own family: one that owns nothing, with
            // its owner at or behind that window, goes there alone
            // (`158b`-`159c`); else the family stays where its first window
            // lies, after the last window in front of it (`15a2`-`15c4`).
            if owned.is_empty()
                && tops
                    .iter()
                    .skip_while(|&&one| one != other)
                    .any(|&one| Some(one) == owner_top)
            {
                return alone(false);
            }

            place = 0;

            for &one in &tops {
                if self.z_in_family(one, head) {
                    break;
                }

                place = self.shown(one).hwnd;
            }
        }

        let mut members = Vec::new();

        self.z_listed(head, Some(index), after, &mut Vec::new(), &mut members);

        ZPlan {
            entries: members
                .iter()
                .enumerate()
                .map(|(at, &member)| ZEntry {
                    member,
                    after: if at == 0 {
                        place
                    } else {
                        self.shown(members[at - 1]).hwnd
                    },
                    stays: false,
                    linked: false,
                })
                .collect(),
            flip,
        }
    }

    /// Whether a window already lies where its entry asks (seg7 `1184`): at
    /// the bottom, the last; at the top, the first; after a window, right
    /// after it. Asked to go after a window topmost where it is not to be,
    /// or not where it is, it is to go after the last topmost window
    /// instead, and the entry says so (`11ad`-`11d8`); it is the last
    /// topmost itself, it lies there.
    pub(crate) fn z_lies_where(&self, entry: &mut ZEntry, flip: &[usize]) -> bool {
        let window = entry.member;
        let tops = self.z_siblings();
        let at = tops.iter().position(|&other| other == window);

        match entry.after {
            1 => return at.is_some_and(|at| at + 1 == tops.len()),
            0 => return at == Some(0),
            _ => {}
        }

        let wanted = self.shown(window).topmost != flip.contains(&window);

        if self
            .z_named(entry.after)
            .is_some_and(|other| self.shown(other).topmost)
            != wanted
        {
            let last = self.z_last_topmost();

            if last == Some(window) {
                return true;
            }

            entry.after = self.z_handle(last);
        }

        match at {
            Some(at) if at > 0 => self.shown(tops[at - 1]).hwnd == entry.after,
            _ => false,
        }
    }

    /// Before anything moves, each entry that lies where it is asked while
    /// every one before it did is left where it is (seg7 `0e09`-`0e38`);
    /// one made topmost or not breaks the run. Answers whether the run is
    /// still unbroken.
    pub(crate) fn z_stay_run(&self, plan: &mut ZPlan, mut unbroken: bool) -> bool {
        for at in 0..plan.entries.len() {
            if plan.entries[at].stays || !unbroken {
                continue;
            }

            unbroken = false;

            let member = plan.entries[at].member;

            if !plan.flip.contains(&member) {
                let mut entry = plan.entries[at].clone();

                if self.z_lies_where(&mut entry, &plan.flip) {
                    unbroken = true;
                    entry.stays = true;
                }

                plan.entries[at] = entry;
            }
        }

        unbroken
    }

    /// Each entry placed, in the list's order (seg7 `0a4f`-`0b71`): one
    /// left where it is passed over; one only put elsewhere -- its family,
    /// or the window itself asked for nothing else (`placed_only`) -- that
    /// lies where it is asked is left there; any other is linked after the
    /// window it is to go after, and made topmost or not as marked.
    pub(crate) fn z_place(&mut self, plan: &mut ZPlan, window: usize, placed_only: bool) {
        for at in 0..plan.entries.len() {
            let mut entry = plan.entries[at].clone();

            if entry.stays {
                continue;
            }

            if (entry.member != window || placed_only)
                && !plan.flip.contains(&entry.member)
                && self.z_lies_where(&mut entry, &plan.flip)
            {
                entry.stays = true;
                plan.entries[at] = entry;
                continue;
            }

            self.z_link_after(entry.member, entry.after);
            entry.linked = true;

            if plan.flip.contains(&entry.member) {
                let shown = self.shown_mut(entry.member);

                shown.topmost = !shown.topmost;

                if shown.topmost {
                    shown.ex_style |= WS_EX_TOPMOST;
                } else {
                    shown.ex_style &= !WS_EX_TOPMOST;
                }
            }

            plan.entries[at] = entry;
        }
    }

    /// A window at the top, its children with it, linked after the window
    /// named among the windows at the top: `HWND_TOP` (0) first,
    /// `HWND_BOTTOM` (1) last (`USER.EXE` seg2 `0972`, `093f`).
    fn z_link_after(&mut self, index: usize, after: u16) {
        let family = self.take_out(|system, other| system.within(other, index));
        let other = if after > 1 {
            self.z_order.iter().position(|&one| {
                let window = self.shown(one);

                window.parent.is_none() && window.hwnd == after
            })
        } else {
            None
        };
        let at = if after == 1 {
            self.z_order.len()
        } else {
            other.map_or(0, |at| at + 1)
        };

        self.z_order.splice(at..at, family);
    }
}

/// The flags a family member is asked and told with.
pub(crate) const FAMILY_FLAGS: u16 = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;
