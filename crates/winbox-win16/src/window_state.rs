//! `ShowWindow` on the raster desktop, as winbox.js's `window-state.ts`
//! shows and hides a window, and the messages of a change of active window
//! (`activation.ts`). How each looks is measured by the `sizing` probe;
//! what a window shown or hidden is sent, and in what order, by `showseq`.
//! A window minimized, or restored from an icon, is not shown here yet.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::Param;
use crate::system::System;
use crate::windows::Placement;

pub const SW_HIDE: u16 = 0;
const SW_SHOWNORMAL: u16 = 1;
const SW_SHOWMINIMIZED: u16 = 2;
const SW_SHOWMAXIMIZED: u16 = 3;
const SW_SHOWNOACTIVATE: u16 = 4;
const SW_MINIMIZE: u16 = 6;
const SW_SHOWMINNOACTIVE: u16 = 7;
const SW_SHOWNA: u16 = 8;
const SW_RESTORE: u16 = 9;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOZORDER: u16 = 0x0004;
const SWP_NOACTIVATE: u16 = 0x0010;
const SWP_SHOWWINDOW: u16 = 0x0040;
const SWP_HIDEWINDOW: u16 = 0x0080;
const SWP_NOCLIENTSIZE: u16 = 0x0800;
const SWP_NOCLIENTMOVE: u16 = 0x1000;

const WM_SETVISIBLE: u16 = 0x0009;
const WM_QUERYOPEN: u16 = 0x0013;
const WM_GETTEXT: u16 = 0x000d;
const WM_SHOWWINDOW: u16 = 0x0018;
const WM_ACTIVATEAPP: u16 = 0x001c;
const WM_WINDOWPOSCHANGING: u16 = 0x0046;
const WM_WINDOWPOSCHANGED: u16 = 0x0047;
pub const WM_ACTIVATE: u16 = 0x0006;
pub const WM_NCACTIVATE: u16 = 0x0086;

const WA_INACTIVE: u16 = 0;
const WA_ACTIVE: u16 = 1;
const WA_CLICKACTIVE: u16 = 2;

/// A `WINDOWPOS`, as it is laid out: seven words.
fn window_pos(hwnd: u16, after: u16, place: [i32; 4], flags: u16) -> Vec<u8> {
    [hwnd, after]
        .into_iter()
        .chain(place.map(|value| value as u16))
        .chain(std::iter::once(flags))
        .flat_map(u16::to_le_bytes)
        .collect()
}

/// What `deliver_activation` puts between the two windows' messages: the
/// family of a window shown, asked again as it is brought to the front.
#[derive(Debug)]
pub struct Between {
    family: Vec<usize>,
    shown: usize,
    flags: u16,
}

impl System {
    /// The windows that come to the front with a window at the top: the
    /// owner it is under, if any, at the head, and every shown window that
    /// owner owns above it, as they lie; top first.
    fn family_of(&self, shown: usize) -> Vec<usize> {
        let mut head = shown;

        while let Some(owner) = self.windows[head].as_ref().and_then(|window| window.owner) {
            if self.windows[owner]
                .as_ref()
                .is_some_and(|window| window.parent.is_some())
            {
                break;
            }

            head = owner;
        }

        let owns = |window: usize| {
            let mut at = self.windows[window]
                .as_ref()
                .and_then(|window| window.owner);

            while let Some(owner) = at {
                if owner == head {
                    return true;
                }

                at = self.windows[owner].as_ref().and_then(|window| window.owner);
            }

            false
        };
        let mut members: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| {
                let window = self.windows[other].as_ref().expect("a window");

                window.parent.is_none() && other != shown && owns(other) && window.visible
            })
            .collect();

        if shown != head {
            members.push(shown);
        }

        members.sort_by_key(|member| self.z_order.iter().position(|other| other == member));
        members.retain(|&member| member != head);
        members.push(head);
        members
    }

    /// The window at the top just above a window at the top, or none -- an
    /// icon's title, which goes with its icon, passed over (`showmin`).
    fn above(&self, shown: usize) -> Option<usize> {
        let tops: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_none() && window.title_of.is_none())
            })
            .collect();
        let at = tops.iter().position(|&other| other == shown)?;

        at.checked_sub(1).map(|above| tops[above])
    }

    /// The window a window at the top goes after: the last of those it goes
    /// below.
    fn insert_after(&self, shown: usize) -> u16 {
        let at = self.front_of(shown);

        self.z_order[..at]
            .iter()
            .copied()
            .rfind(|&other| {
                other != shown
                    && self.windows[other]
                        .as_ref()
                        .is_some_and(|window| window.parent.is_none())
            })
            .map_or(0, |other| {
                self.windows[other].as_ref().map_or(0, |window| window.hwnd)
            })
    }

    fn hwnd_of(&self, index: usize) -> u16 {
        self.windows[index].as_ref().map_or(0, |window| window.hwnd)
    }

    fn place_key(&self, index: usize) -> (i32, i32, i32, i32, Placement) {
        let window = self.windows[index].as_ref().expect("a window");

        (
            window.left,
            window.top,
            window.width,
            window.height,
            window.placement,
        )
    }
}

impl System {
    /// A child made visible: its parent, shown and painting over its
    /// children, due a paint where the child now lies.
    fn child_shown(&mut self, index: usize) {
        let window = self.windows[index].as_ref().expect("a window");
        let Some(parent) = window.parent else {
            return;
        };
        let area = [
            window.left,
            window.top,
            window.left + window.width,
            window.top + window.height,
        ];
        let mut at = Some(parent);

        while let Some(shown) = at {
            let shown = self.windows[shown].as_ref().expect("a window");

            if !shown.visible {
                return;
            }

            at = shown.parent;
        }

        let (style, needs_paint, was, quiet) = {
            let parent = self.windows[parent].as_ref().expect("a window");

            (
                parent.style,
                parent.needs_paint,
                parent.dirty,
                parent.quiet_dirty,
            )
        };

        if style & 0x0200_0000 != 0 {
            return;
        }

        // What it was due: nothing (`None` here), a box, or all of it.
        let was = if needs_paint {
            was.map(Some)
        } else {
            Some(None)
        };
        let union = |a: [i32; 4]| {
            [
                a[0].min(area[0]),
                a[1].min(area[1]),
                a[2].max(area[2]),
                a[3].max(area[3]),
            ]
        };

        match was {
            Some(box_was) if box_was.is_none_or(|was| quiet == Some(was.mark)) => {
                let dirty = self.dirty_box(box_was.map_or(area, |was| union(was.area)));
                let parent = self.windows[parent].as_mut().expect("a window");

                parent.dirty = Some(dirty);
                parent.quiet_dirty = Some(dirty.mark);
            }
            Some(Some(was)) => {
                let dirty = self.dirty_box(union(was.area));

                self.windows[parent].as_mut().expect("a window").dirty = Some(dirty);
            }
            _ => {}
        }

        let parent = self.windows[parent].as_mut().expect("a window");

        parent.needs_paint = true;
        parent.needs_erase = true;
    }
}

impl Engine {
    /// The messages of a change of active window, sent once the desktop has
    /// made it. **Recorded** by the `activate` probe: the window losing the
    /// activation gets `WM_NCACTIVATE` with 0, then `WM_ACTIVATE` with
    /// `WA_INACTIVE`; then the window gaining it `WM_ACTIVATEAPP` with 1 when
    /// nothing of its task was active, `WM_NCACTIVATE` with 1, then
    /// `WM_ACTIVATE`. Each names the other window in its `lParam`'s low
    /// word, and nought where there is none. A window made active that was
    /// not yet at the front is put there between the two (`showseq`).
    pub async fn deliver_activation(&self, between: Option<Between>) -> Result<(), Stop> {
        let (from, to) = {
            let mut system = self.system();
            let Some((from, _)) = system.pending_activation.take() else {
                return Ok(());
            };
            let to = system.z_order.iter().copied().find(|&index| {
                let window = system.windows[index].as_ref().expect("a window");

                window.active && window.visible && window.parent.is_none()
            });

            (from, to)
        };

        if let Some(to) = to.filter(|&to| Some(to) != from) {
            let (from_hwnd, to_hwnd, from_task, to_task, from_min, to_min) = {
                let system = self.system();
                let minimized = |index: Option<usize>| {
                    index
                        .and_then(|index| system.windows[index].as_ref())
                        .map_or(0, |window| {
                            if window.placement == Placement::Minimized {
                                0x0020_0000
                            } else {
                                0
                            }
                        })
                };
                let task = |index: Option<usize>| {
                    index
                        .and_then(|index| system.windows[index].as_ref())
                        .map_or(0, |window| window.task)
                };

                (
                    from.map_or(0, |from| system.hwnd_of(from)),
                    system.hwnd_of(to),
                    task(from),
                    task(Some(to)),
                    minimized(from),
                    minimized(Some(to)),
                )
            };

            if from_hwnd != 0 {
                let other = from_min | u32::from(to_hwnd);

                self.send_message(from_hwnd, WM_NCACTIVATE, 0, &mut Param::Value(other))
                    .await?;
                self.send_message(
                    from_hwnd,
                    WM_ACTIVATE,
                    WA_INACTIVE,
                    &mut Param::Value(other),
                )
                .await?;

                if from_task != to_task {
                    self.send_message(
                        from_hwnd,
                        WM_ACTIVATEAPP,
                        0,
                        &mut Param::Value(u32::from(to_task)),
                    )
                    .await?;
                }
            }

            if let Some(between) = between {
                self.ask(&between.family, between.shown, between.flags)
                    .await?;
            }

            if from_hwnd == 0 || from_task != to_task {
                self.send_message(
                    to_hwnd,
                    WM_ACTIVATEAPP,
                    1,
                    &mut Param::Value(u32::from(from_task)),
                )
                .await?;
            }

            let other = to_min | u32::from(from_hwnd);
            let click = false;

            self.send_message(to_hwnd, WM_NCACTIVATE, 1, &mut Param::Value(other))
                .await?;
            self.send_message(
                to_hwnd,
                WM_ACTIVATE,
                if click { WA_CLICKACTIVE } else { WA_ACTIVE },
                &mut Param::Value(other),
            )
            .await?;
        }

        // A focus left on a window no longer shown, by a window procedure
        // that took none, is no focus.
        let mut system = self.system();

        if let Some(focus) = system.focus {
            let gone = !system.z_order.contains(&focus)
                || system.windows[focus]
                    .as_ref()
                    .is_none_or(|window| !window.visible);

            if gone {
                system.focus = None;
            }
        }

        Ok(())
    }

    /// Each of a family asked, as `SetWindowPos` asks, from the top down,
    /// after the one above it: the window shown with `how`, the rest
    /// neither sized, moved nor made active (`showseq`).
    async fn ask(&self, family: &[usize], shown: usize, how: u16) -> Result<(), Stop> {
        let mut after = {
            let system = self.system();

            if how & SWP_NOZORDER != 0 {
                0
            } else {
                system.insert_after(family[0])
            }
        };

        for &member in family {
            let hwnd = self.system().hwnd_of(member);
            let flags = if member == shown {
                how
            } else {
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            };

            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGING,
                0,
                &mut Param::Struct(window_pos(hwnd, after, [0; 4], flags)),
            )
            .await?;
            after = hwnd;
        }

        Ok(())
    }

    /// A window shown, hidden or brought forward on the raster desktop; its
    /// answer, whether it was visible before. `told` is whether it is sent
    /// `WM_SHOWWINDOW` -- not when `DestroyWindow` hides it.
    #[allow(clippy::too_many_lines)]
    pub async fn show_raster(
        &self,
        hwnd: u16,
        index: usize,
        show: u16,
        told: bool,
        made: bool,
    ) -> Result<bool, Stop> {
        let (was, parent, placement, active) = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");

            (
                window.visible,
                window.parent,
                window.placement,
                window.active,
            )
        };

        // An icon restored is asked first, and stays one if its window says
        // no (`iconclk`).
        let from_icon = show == SW_RESTORE && placement == Placement::Minimized;
        let active_icon = from_icon && active;

        if from_icon
            && self
                .send_message(hwnd, WM_QUERYOPEN, 0, &mut Param::Value(0))
                .await?
                == 0
        {
            return Ok(was);
        }

        // A hidden window minimized and not made active is not told it
        // shows: it is put among the icons, at the bottom, in one move
        // (`showmin`).
        if show == SW_SHOWMINNOACTIVE && !was && parent.is_none() {
            self.minimize_to_bottom(hwnd, index, true).await?;
            self.title_shown(hwnd, index, false).await?;
            self.system().nudge()?;
            return Ok(false);
        }

        let hiding = show == SW_HIDE;
        let changes = if hiding { was } else { !was };

        // A window shown or hidden is told so twice, then asked, as
        // `SetWindowPos` asks: a child, or a window hidden, keeps its place
        // among its siblings and is not made active.
        let mut flags = SWP_NOSIZE
            | SWP_NOMOVE
            | if hiding {
                SWP_HIDEWINDOW
            } else {
                SWP_SHOWWINDOW
            };

        if hiding || parent.is_some() {
            flags |= SWP_NOZORDER | SWP_NOACTIVATE;
        }

        // Shown and not made active: where it lies with `SW_SHOWNOACTIVATE`,
        // brought to the front with `SW_SHOWNA` (`showsq2`).
        if matches!(show, SW_SHOWNOACTIVATE | SW_SHOWNA | SW_SHOWMINNOACTIVE) {
            flags |= SWP_NOACTIVATE;
        }

        if show == SW_SHOWNOACTIVATE {
            flags |= SWP_NOZORDER;
        }

        let (family, inserts) = {
            let system = self.system();
            let family = if flags & SWP_NOZORDER != 0 {
                vec![index]
            } else {
                system.family_of(index)
            };
            let mut inserts = Vec::with_capacity(family.len());
            let mut after = if flags & SWP_NOZORDER != 0 {
                0
            } else {
                system.insert_after(family[0])
            };

            for &member in &family {
                inserts.push(after);
                after = system.hwnd_of(member);
            }

            (family, inserts)
        };

        if changes {
            if told {
                let shows = u16::from(!hiding);

                self.send_message(hwnd, WM_SHOWWINDOW, shows, &mut Param::Value(0))
                    .await?;
                self.send_message(hwnd, WM_SETVISIBLE, shows, &mut Param::Value(0))
                    .await?;
            }

            self.ask(&family, index, flags).await?;
        }

        let (before, above_before) = {
            let mut system = self.system();
            let before = system.place_key(index);
            let above_before: Vec<Option<usize>> =
                family.iter().map(|&member| system.above(member)).collect();

            match show {
                SW_HIDE => system.hide(index),
                // The windows it owns hidden with it; and a window not
                // active, minimized with `SW_MINIMIZE`, keeps its place
                // (`owners`).
                SW_SHOWMINIMIZED | SW_MINIMIZE | SW_SHOWMINNOACTIVE => {
                    system.hide_owned(index, true);
                    system.minimize(index)?;

                    let active = system.windows[index]
                        .as_ref()
                        .is_some_and(|window| window.active);

                    if show == SW_MINIMIZE && was && !active {
                        system.show_in_place(index);
                    } else {
                        system.show(index);
                    }
                }
                SW_SHOWMAXIMIZED => {
                    system.maximize(index)?;
                    system.show(index);
                }
                SW_SHOWNORMAL | SW_RESTORE => {
                    system.restore(index)?;
                    system.hide_owned(index, false);
                    system.show(index);
                }
                SW_SHOWNOACTIVATE => system.show_in_place(index),
                SW_SHOWNA => system.show_on_top(index),
                _ => system.show(index),
            }

            (before, above_before)
        };

        // A window shown active: its messages, and the focus they move; put
        // at the front between them if it was not there yet with the
        // windows it brings, asked again (`showseq`).
        let at_front_already = {
            let system = self.system();
            let at = family.iter().position(|&member| member == index);

            at.is_some_and(|at| system.above(index) == above_before[at])
        };
        let between = (changes
            && !hiding
            && flags & SWP_NOACTIVATE == 0
            && !at_front_already
            && family.len() > 1)
            .then(|| Between {
                family: family.clone(),
                shown: index,
                flags: SWP_NOSIZE | SWP_NOMOVE,
            });

        self.deliver_activation(between).await?;

        let moved = self.system().place_key(index) != before;

        // An icon restored is told its place and then its size, as
        // `WM_WINDOWPOSCHANGED` tells them, and made active again if it
        // was: it had no focus as an icon (`iconclk`).
        if moved && !hiding && from_icon {
            self.window_pos_changed(hwnd, index, 0).await?;
        } else if moved && !hiding {
            self.notify_size(hwnd, index).await?;
        }

        if active_icon
            && self.system().windows[index]
                .as_ref()
                .is_some_and(|window| window.active)
        {
            self.send_message(hwnd, WM_ACTIVATE, WA_ACTIVE, &mut Param::Value(0))
                .await?;
        }

        // Shown, all of it is due, whatever part was before.
        if changes && !hiding {
            let mut system = self.system();
            let window = system.windows[index].as_mut().expect("a window");

            window.needs_nc_paint = true;
            window.dirty = None;
        }

        // A child made visible: its parent is due a paint where it now lies,
        // unless the parent leaves its children out of its own painting
        // (`showseq`); the box remembered as due only for this, so that
        // `about_to_paint` knows it for one (`tutor`).
        if made && changes && !hiding {
            self.system().child_shown(index);
        }

        self.erase_due().await?;

        if changes {
            for (at, &member) in family.iter().enumerate() {
                let (member_hwnd, place, how) = {
                    let system = self.system();
                    let window = system.windows[member].as_ref().expect("a window");
                    let how = if member == index {
                        flags
                    } else {
                        SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
                    };
                    // Not moved among its siblings after all: said so.
                    let still = how & SWP_NOZORDER == 0 && system.above(member) == above_before[at];
                    let (x, y) = match window
                        .parent
                        .and_then(|parent| system.windows[parent].as_ref())
                    {
                        Some(parent) => (
                            window.left - parent.left - parent.client.left,
                            window.top - parent.top - parent.client.top,
                        ),
                        None => (window.left, window.top),
                    };

                    (
                        window.hwnd,
                        [x, y, window.width, window.height],
                        how | SWP_NOCLIENTSIZE
                            | SWP_NOCLIENTMOVE
                            | if still { SWP_NOZORDER } else { 0 },
                    )
                };

                self.send_message(
                    member_hwnd,
                    WM_WINDOWPOSCHANGED,
                    0,
                    &mut Param::Struct(window_pos(member_hwnd, inserts[at], place, how)),
                )
                .await?;
            }
        }

        // What an overlapped window was owed since it was made, told the
        // first time it shows: its size, then its place (`showseq`).
        let owes = !hiding && {
            let mut system = self.system();
            let window = system.windows[index].as_mut().expect("a window");

            std::mem::take(&mut window.owes_size)
        };

        if owes {
            self.notify_size(hwnd, index).await?;
        }

        let minimized = self.system().windows[index]
            .as_ref()
            .is_some_and(|window| window.placement == Placement::Minimized);

        if changes && !hiding && minimized {
            self.title_shown(hwnd, index, flags & SWP_NOACTIVATE == 0)
                .await?;
        }

        self.system().nudge()?;
        Ok(was)
    }

    /// An icon's title made and shown: its window asked for its text, 80
    /// characters, as the title is made and again as it is drawn; and, when
    /// the icon was not made active, the icon asked to go after its title,
    /// which it already does -- nothing more is sent (`showmin`).
    async fn title_shown(&self, hwnd: u16, index: usize, activated: bool) -> Result<(), Stop> {
        self.send_message(hwnd, WM_GETTEXT, 0x50, &mut Param::Struct(vec![0; 80]))
            .await?;

        let title = {
            let system = self.system();

            system.windows[index]
                .as_ref()
                .and_then(|window| window.icon_title)
                .map_or(0, |title| system.hwnd_of(title))
        };

        if !activated && title != 0 {
            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGING,
                0,
                &mut Param::Struct(window_pos(
                    hwnd,
                    title,
                    [0; 4],
                    SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
                )),
            )
            .await?;
        }

        self.send_message(hwnd, WM_GETTEXT, 0x50, &mut Param::Struct(vec![0; 80]))
            .await?;
        Ok(())
    }

    /// A window minimized to the first free place among the icons and put
    /// at the very bottom, after the last window there, **recorded** by
    /// `showmin`: `WM_WINDOWPOSCHANGING` with its place, `WM_GETMINMAXINFO`,
    /// `WM_NCCALCSIZE` with the icon's rectangle, then `WM_WINDOWPOSCHANGED`,
    /// from which `DefWindowProc` tells it its place and size. Shown, its
    /// flags say so, and it is drawn before it is told; hidden, as a window
    /// made minimized is, it is not drawn.
    pub async fn minimize_to_bottom(
        &self,
        hwnd: u16,
        index: usize,
        show: bool,
    ) -> Result<(), Stop> {
        const SWP_FRAMECHANGED: u16 = 0x0020;
        const SWP_NOCOPYBITS: u16 = 0x0100;
        const SWP_NOREDRAW: u16 = 0x0008;
        const WM_GETMINMAXINFO: u16 = 0x0024;

        let (after, old, old_client, style, place) = {
            let mut system = self.system();
            let tops: Vec<usize> = system
                .z_order
                .iter()
                .copied()
                .filter(|&other| {
                    let window = system.windows[other].as_ref().expect("a window");

                    window.parent.is_none() && other != index && window.title_of != Some(index)
                })
                .collect();
            let after = tops.last().map_or(0, |&other| system.hwnd_of(other));
            let window = system.windows[index].as_ref().expect("a window");
            let old = [
                window.left,
                window.top,
                window.left + window.width,
                window.top + window.height,
            ];
            let old_client = [
                window.left + window.client.left,
                window.top + window.client.top,
                window.left + window.client.left + window.client_width(),
                window.top + window.client.top + window.client_height(),
            ];
            let style = window.style;

            system.minimize(index)?;

            let window = system.windows[index].as_ref().expect("a window");

            (
                after,
                old,
                old_client,
                style,
                [window.left, window.top, window.width, window.height],
            )
        };
        let flags = SWP_NOACTIVATE
            | SWP_FRAMECHANGED
            | SWP_NOCOPYBITS
            | if show { SWP_SHOWWINDOW } else { 0 };

        self.send_message(
            hwnd,
            WM_WINDOWPOSCHANGING,
            0,
            &mut Param::Struct(window_pos(hwnd, after, place, flags)),
        )
        .await?;

        let info = self.system().min_max_info(style);

        self.send_message(hwnd, WM_GETMINMAXINFO, 0, &mut Param::Struct(info))
            .await?;

        let mut params: Vec<u8> = [
            place[0],
            place[1],
            place[0] + place[2],
            place[1] + place[3],
            old[0],
            old[1],
            old[2],
            old[3],
            old_client[0],
            old_client[1],
            old_client[2],
            old_client[3],
        ]
        .iter()
        .flat_map(|&value| (value as u16).to_le_bytes())
        .collect();

        params.extend(0u32.to_le_bytes());
        self.send_message(
            hwnd,
            crate::messages::WM_NCCALCSIZE,
            1,
            &mut Param::Struct(params),
        )
        .await?;
        self.system().to_bottom(index, show);

        if show {
            {
                let mut system = self.system();
                let window = system.windows[index].as_mut().expect("a window");

                window.needs_nc_paint = true;
                window.dirty = None;
            }

            self.erase_due().await?;
        }

        let flags = if show { flags } else { flags | SWP_NOREDRAW };

        self.send_message(
            hwnd,
            WM_WINDOWPOSCHANGED,
            0,
            &mut Param::Struct(window_pos(hwnd, after, place, flags)),
        )
        .await?;
        Ok(())
    }
}

/// A window shown, hidden or brought forward; whether it was visible
/// before. Nought for a handle that is no window of the desktop's.
pub fn show_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, show, index) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let show = args.word(&system);

            match system.handles.resolve(hwnd) {
                Some(Object::Window(index)) if system.windows[index].is_some() => {
                    (hwnd, show, index)
                }
                _ => return Ok(Answer::Word(0)),
            }
        };
        let was = engine.show_raster(hwnd, index, show, true, false).await?;

        Ok(Answer::Word(u16::from(was)))
    })
}
