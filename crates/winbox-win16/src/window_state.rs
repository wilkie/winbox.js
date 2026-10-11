//! `ShowWindow` on the raster desktop, as winbox.js's `window-state.ts`
//! shows and hides a window, and the messages of a change of active window
//! (`activation.ts`). How each looks is measured by the `sizing` probe;
//! what a window shown or hidden is sent, and in what order, by `showseq`.
//! A window minimized, or restored from an icon, is not shown here yet.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::Param;
use crate::position::client_flags;
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
const SWP_FRAMECHANGED: u16 = 0x0020;
const SWP_SHOWWINDOW: u16 = 0x0040;
const SWP_HIDEWINDOW: u16 = 0x0080;
const SWP_NOCLIENTSIZE: u16 = 0x0800;
const SWP_NOCLIENTMOVE: u16 = 0x1000;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;

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

/// What `deliver_activation` puts between the two windows' messages.
#[derive(Debug)]
pub enum Between {
    /// The family of a window shown, asked again as it is brought to the
    /// front.
    Ask {
        family: Vec<usize>,
        shown: usize,
        flags: u16,
    },
    /// A window pressed, brought to the front as `SetWindowPos` brings it:
    /// its family asked, and those of it that moved since `before` told
    /// (`alttab`).
    Front {
        family: Vec<usize>,
        shown: usize,
        before: Vec<Vec<usize>>,
    },
    /// After `SetWindowPos`: the window made active, where it is not then
    /// the first at the top -- a window it owns above it, or its icon's
    /// title -- brought to the front again, its family asked (`alttab`).
    Again,
}

impl System {
    /// The windows that come to the front with a window at the top: the
    /// owner it is under, if any, at the head, and every shown window that
    /// owner owns above it, as they lie; top first.
    pub(crate) fn family_of(&self, shown: usize) -> Vec<usize> {
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

    /// The windows at the top above a window at the top, the front first
    /// -- an icon's title, which goes with its icon, passed over
    /// (`showmin`): where it lies in the order, which a window hidden keeps
    /// (`mousemsg`), so that one shown again from behind another is moved
    /// though the window just above it is the same (`showseq`).
    pub(crate) fn above(&self, shown: usize) -> Vec<usize> {
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
        let at = tops.iter().position(|&other| other == shown).unwrap_or(0);

        tops[..at].to_vec()
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

    pub(crate) fn hwnd_of(&self, index: usize) -> u16 {
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
        let (from, to, click, for_focus) = {
            let mut system = self.system();
            let for_focus = std::mem::take(&mut system.activating_for_focus);
            let Some((from, click)) = system.pending_activation.take() else {
                return Ok(());
            };
            let to = system.active_top();

            (from, to, click, for_focus)
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
                self.between(between, to).await?;
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
            self.send_message(to_hwnd, WM_NCACTIVATE, 1, &mut Param::Value(other))
                .await?;
            self.send_message(
                to_hwnd,
                WM_ACTIVATE,
                if click { WA_CLICKACTIVE } else { WA_ACTIVE },
                &mut Param::Value(other),
            )
            .await?;

            self.focus_to_active(to, to_hwnd, to_min != 0, for_focus)
                .await?;

            // Counted, once the focus has moved (`USER.EXE` seg1 `37ee`,
            // `[112h]`): Alt and Tab's loop ends where the active window
            // changes under it.
            let mut system = self.system();

            system.switch.activations = system.switch.activations.wrapping_add(1);

            // And the time noted where none is (`37f2`-`3803`;
            // `screen_saver.rs`).
            system.note_activation();
        }

        // A focus left on a window gone is no focus. One in a window hidden
        // is the focus still: a window at the top made active hidden takes
        // it, as `DefWindowProc` gives it on `WM_ACTIVATE` (`hidfocus`).
        let mut system = self.system();

        if let Some(focus) = system.focus {
            let gone = !system.z_order.contains(&focus) || system.windows[focus].is_none();

            if gone {
                system.focus = None;
            }
        }

        Ok(())
    }

    /// A focus left in another window at the top moved to the window made
    /// active -- taken away, if it is minimized -- with `WM_KILLFOCUS` and
    /// `WM_SETFOCUS` (`USER.EXE` seg1 `37a3`-`37d4`, `3412`): a dialog that
    /// kept none and set none takes it so, and its `WM_SETFOCUS` gives it to
    /// its first control. Not as `SetFocus` makes a window active, which
    /// gives the focus itself (`3899`, which asks `3514` for none).
    async fn focus_to_active(
        &self,
        to: usize,
        to_hwnd: u16,
        minimized: bool,
        for_focus: bool,
    ) -> Result<(), Stop> {
        if for_focus {
            return Ok(());
        }

        let elsewhere = {
            let system = self.system();
            let mut top = system.focus;

            while let Some(parent) = top
                .and_then(|index| system.windows[index].as_ref())
                .and_then(|window| window.parent)
            {
                top = Some(parent);
            }

            top.is_some_and(|top| top != to) && system.window_named(to_hwnd).is_some()
        };

        if elsewhere {
            if minimized {
                self.focus_nothing().await?;
            } else {
                Box::pin(self.set_focus(to_hwnd)).await?;
            }
        }

        Ok(())
    }

    /// A window at the top made active as `SetFocus` makes it, to give the
    /// focus to a window in it (`USER.EXE` seg1 `3899`-`38a3`): brought to
    /// the front with the windows it brings, and asked again between the
    /// two windows' messages where that moved it. **Recorded** by
    /// `comboact`: a dropped list pressed while another window is active,
    /// that window is sent `WM_NCACTIVATE` and `WM_ACTIVATE`, the combo
    /// box's window `WM_WINDOWPOSCHANGING` with `SWP_NOSIZE | SWP_NOMOVE`,
    /// then its own two.
    pub(crate) async fn activate_for_focus(&self, top: usize) -> Result<(), Stop> {
        let (family, above_before) = {
            let mut system = self.system();
            let family = system.family_of(top);
            let above_before = system.above(top);

            system.activate(top);
            (family, above_before)
        };
        let moved = self.system().above(top) != above_before;
        let between = moved.then_some(Between::Ask {
            family,
            shown: top,
            flags: SWP_NOSIZE | SWP_NOMOVE,
        });

        self.system().activating_for_focus = true;
        self.deliver_activation(between).await
    }

    /// What goes between the two windows' messages, `to` the window made
    /// active.
    async fn between(&self, between: Between, to: usize) -> Result<(), Stop> {
        match between {
            Between::Ask {
                family,
                shown,
                flags,
            } => self.ask(&family, shown, flags, None).await.map(|_| ()),
            Between::Front {
                family,
                shown,
                before,
            } => self.bring_forward(&family, shown, &before).await,
            Between::Again => {
                let family = {
                    let system = self.system();
                    let first = system.z_order.iter().copied().find(|&other| {
                        system.windows[other].as_ref().is_some_and(|window| {
                            window.parent.is_none()
                                && window.visible
                                && window.switch_bits.is_none()
                                && window.popup.is_none()
                        })
                    });

                    (first != Some(to)).then(|| system.family_of(to))
                };

                match family {
                    Some(family) => self
                        .ask(&family, to, SWP_NOSIZE | SWP_NOMOVE, None)
                        .await
                        .map(|_| ()),
                    None => Ok(()),
                }
            }
        }
    }

    /// A window pressed brought to the front between the two windows'
    /// messages, as `SetWindowPos` would bring it: its family asked, and
    /// each of it that moved since `before` told, as a window pressed under
    /// another is (`alttab`). Nothing where none moved.
    async fn bring_forward(
        &self,
        family: &[usize],
        shown: usize,
        before: &[Vec<usize>],
    ) -> Result<(), Stop> {
        let moved: Vec<bool> = {
            let system = self.system();

            family
                .iter()
                .zip(before)
                .map(|(&member, was)| system.above(member) != *was)
                .collect()
        };

        if !moved.iter().any(|&one| one) {
            return Ok(());
        }

        self.ask(family, shown, SWP_NOSIZE | SWP_NOMOVE, None)
            .await?;

        for (&member, moved) in family.iter().zip(moved) {
            if !moved {
                continue;
            }

            let (hwnd, place) = {
                let system = self.system();
                let Some(window) = system.windows[member].as_ref() else {
                    continue;
                };

                (
                    window.hwnd,
                    [window.left, window.top, window.width, window.height],
                )
            };
            let flags = if member == shown {
                SWP_NOSIZE | SWP_NOMOVE
            } else {
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            } | SWP_NOCLIENTSIZE
                | SWP_NOCLIENTMOVE;

            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(hwnd, 0, place, flags)),
            )
            .await?;
        }

        Ok(())
    }

    /// Each of a family asked, as `SetWindowPos` asks, from the top down,
    /// after the one above it: the window shown with `how`, the rest
    /// neither sized, moved nor made active (`showseq`).
    async fn ask(
        &self,
        family: &[usize],
        shown: usize,
        how: u16,
        mut zoom: Option<[i32; 4]>,
    ) -> Result<Option<[i32; 4]>, Stop> {
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

            let place = zoom.filter(|_| member == shown);
            let mut structure =
                Param::Struct(window_pos(hwnd, after, place.unwrap_or([0; 4]), flags));

            self.send_message(hwnd, WM_WINDOWPOSCHANGING, 0, &mut structure)
                .await?;

            // As the window procedure, or `DefWindowProc`, left it.
            if let (Some(_), Param::Struct(bytes)) = (place, &structure) {
                let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

                zoom = Some([word(4), word(6), word(8), word(10)]);
            }

            after = hwnd;
        }

        Ok(zoom)
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
        let (was, parent, placement, active, child) = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");

            (
                window.visible,
                window.parent,
                window.placement,
                window.active,
                // A child of the desktop window, as a combo box's list
                // dropped down is (`comboact`), is a child still.
                window.parent.is_some() || window.style & (WS_CHILD | WS_POPUP) == WS_CHILD,
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
            || self.gone(index)
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

            // Told its place and size so, it is owed none when it is next
            // shown (`alttab`: restored later, it is sent `WM_SIZE` once).
            // One made minimized, then shown, is told them again
            // (`showmin`).
            if let Some(window) = self.system().windows[index].as_mut() {
                window.owes_size = false;
            }
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

        if hiding || child {
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

        // Maximized, it is asked `WM_GETMINMAXINFO` and put where that
        // answers, `ptMaxSize` at `ptMaxPosition`, in one `SetWindowPos` with
        // `SWP_FRAMECHANGED` -- and `SWP_SHOWWINDOW` where it was hidden --
        // whose `WM_WINDOWPOSCHANGING` `DefWindowProc` holds to the tracking
        // sizes (`USER.EXE` seg6 `1ca1`-`1d16`, `1d3d`-`1d81`; `minmax`).
        let zooming = show == SW_SHOWMAXIMIZED && placement != Placement::Maximized;

        if zooming {
            flags = (flags & !(SWP_NOSIZE | SWP_NOMOVE)) | SWP_FRAMECHANGED;

            if was {
                flags &= !SWP_SHOWWINDOW;
            }
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

        // A window minimized that has the focus in it loses it first: to its
        // parent, or to none at the top (`USER.EXE` seg6 `1bfa`-`1c25`).
        let minimizing = matches!(show, SW_SHOWMINIMIZED | SW_MINIMIZE | SW_SHOWMINNOACTIVE)
            && placement != Placement::Minimized;

        if minimizing {
            let focused_parent = {
                let system = self.system();

                system
                    .focus
                    .filter(|&focus| system.within(focus, index))
                    .map(|_| parent.map_or(0, |parent| system.hwnd_of(parent)))
            };

            match focused_parent {
                Some(0) => {
                    self.focus_nothing().await?;
                }
                Some(parent) => {
                    Box::pin(self.set_focus(parent)).await?;
                }
                None => {}
            }

            if self.gone(index) {
                return Ok(was);
            }
        }

        if changes && told {
            let shows = u16::from(!hiding);

            self.send_message(hwnd, WM_SHOWWINDOW, shows, &mut Param::Value(0))
                .await?;
            self.send_message(hwnd, WM_SETVISIBLE, shows, &mut Param::Value(0))
                .await?;
        }

        let mut zoom = None;

        if zooming {
            let style = self.system().windows[index]
                .as_ref()
                .map_or(0, |window| window.style);
            let info = self.ask_min_max(hwnd, style).await?;
            let ([cx, cy], [x, y]) = ([info[1].0, info[1].1], [info[2].0, info[2].1]);

            zoom = self
                .ask(&family, index, flags, Some([x, y, cx, cy]))
                .await?;

            if let Some([x, y, cx, cy]) = zoom {
                let ([client, _, _], _) =
                    self.calc_size(hwnd, index, [x, y, x + cx, y + cy]).await?;

                self.system().answer_client(
                    index,
                    cx,
                    cy,
                    crate::windows::Rect {
                        left: client[0] - x,
                        top: client[1] - y,
                        right: client[2] - x,
                        bottom: client[3] - y,
                    },
                )?;
            }
        } else if changes {
            self.ask(&family, index, flags, None).await?;
        }

        let client_before = self.system().client_in_parent(index);

        // Destroyed by what it was sent: `ShowWindow` goes no further, and
        // answers what it was (`USER.EXE` seg14 `0ce6`-`0cf2`, and after
        // each later message, `0d1e`, `0d4c`, `0dac`, `0dca`).
        if self.gone(index) {
            return Ok(was);
        }

        let (before, above_before) = {
            let mut system = self.system();
            let before = system.place_key(index);
            let above_before: Vec<Vec<usize>> =
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
                    let to = zoom.map(|[x, y, cx, cy]| {
                        let origin = system.origin_of(index);

                        [x + origin.0, y + origin.1, cx.max(0), cy.max(0)]
                    });

                    system.maximize_to(index, to)?;
                    system.show(index);
                }
                SW_SHOWNORMAL | SW_RESTORE => {
                    system.restore(index)?;
                    system.hide_owned(index, false);
                    system.show(index);
                }
                SW_SHOWNOACTIVATE => system.show_in_place(index),
                SW_SHOWNA => system.show_on_top(index),
                // Shown already, nothing of it is due but what it came to
                // show of itself: Clock's `SW_SHOW` after its frame changed
                // has it painted once (`swpframe`).
                _ if was => system.show_with(index, false),
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
            .then(|| Between::Ask {
                family: family.clone(),
                shown: index,
                flags: SWP_NOSIZE | SWP_NOMOVE,
            });

        self.deliver_activation(between).await?;

        if self.gone(index) {
            return Ok(was);
        }

        let moved = self.system().place_key(index) != before;

        // An icon restored is asked and told with its place and size, its
        // frame changed (`alttab`: flags 20h, then 24h), `DefWindowProc`
        // telling it its place and then its size from the second
        // (`iconclk`).
        if moved && !hiding && from_icon {
            const SWP_FRAMECHANGED: u16 = 0x0020;

            let place = {
                let system = self.system();
                let window = system.windows[index].as_ref().expect("a window");
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

                [x, y, window.width, window.height]
            };

            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGING,
                0,
                &mut Param::Struct(window_pos(hwnd, 0, place, SWP_FRAMECHANGED)),
            )
            .await?;
            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(hwnd, 0, place, SWP_NOZORDER | SWP_FRAMECHANGED)),
            )
            .await?;
        } else if moved && !hiding && zoom.is_none() {
            self.notify_size(hwnd, index).await?;
        }

        // The active window restored from an icon is given the focus, then
        // told it is active again: it had no focus as an icon (`alttab`,
        // `iconclk`).
        if active_icon
            && self.system().windows[index]
                .as_ref()
                .is_some_and(|window| window.active)
        {
            Box::pin(self.set_focus(hwnd)).await?;
            self.send_message(hwnd, WM_ACTIVATE, WA_ACTIVE, &mut Param::Value(0))
                .await?;
        }

        if self.gone(index) {
            return Ok(was);
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

        if changes || zoom.is_some() {
            for (at, &member) in family.iter().enumerate() {
                let (member_hwnd, place, how) = {
                    let system = self.system();
                    // One of them destroyed by what the others were sent
                    // is told nothing more.
                    let Some(window) = system.windows[member].as_ref() else {
                        continue;
                    };
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

                    // Maximized, what of its client area stayed as it was,
                    // said so, from which `DefWindowProc` tells it it moved
                    // and was sized (seg7 `0fcf`, `0fe6`, `11fc`-`1250`).
                    let client = if member == index && zoom.is_some() {
                        client_flags(client_before, system.client_in_parent(member))
                    } else {
                        SWP_NOCLIENTSIZE | SWP_NOCLIENTMOVE
                    };

                    (
                        window.hwnd,
                        [x, y, window.width, window.height],
                        how | client | if still { SWP_NOZORDER } else { 0 },
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

        if self.gone(index) {
            return Ok(was);
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

        // A window at the top minimized so gives the activation to another
        // (`USER.EXE` seg6 `1d96`), brought to the front between the two
        // windows' messages where that moves it (`minact`).
        if show == SW_MINIMIZE && minimizing && parent.is_none() && minimized {
            let next = self.system().next_after_minimize(index);

            if let Some(next) = next.filter(|&next| next != index) {
                let (family, above_before) = {
                    let mut system = self.system();
                    let family = system.family_of(next);
                    let above_before = system.above(next);

                    system.show_with(next, false);
                    (family, above_before)
                };
                let moved = self.system().above(next) != above_before;
                let between = moved.then_some(Between::Ask {
                    family,
                    shown: next,
                    flags: SWP_NOSIZE | SWP_NOMOVE,
                });

                self.deliver_activation(between).await?;

                if self.gone(index) {
                    return Ok(was);
                }
            }
        }

        if changes && !hiding && minimized {
            self.title_shown(hwnd, index, flags & SWP_NOACTIVATE == 0)
                .await?;
        }

        self.system().nudge()?;
        Ok(was)
    }

    /// Whether a window has been destroyed.
    fn gone(&self, index: usize) -> bool {
        self.system().windows[index].is_none()
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
    /// `showmin`: `WM_WINDOWPOSCHANGING` with its place -- for which
    /// `DefWindowProc` asks `WM_GETMINMAXINFO` --
    /// `WM_NCCALCSIZE` with the icon's rectangle, then `WM_WINDOWPOSCHANGED`,
    /// from which `DefWindowProc` tells it its place and size. Shown, its
    /// flags say so, and it is drawn before it is told; hidden, as a window
    /// made minimized is, it is not drawn.
    #[allow(clippy::too_many_lines)]
    pub async fn minimize_to_bottom(
        &self,
        hwnd: u16,
        index: usize,
        show: bool,
    ) -> Result<(), Stop> {
        const SWP_NOCOPYBITS: u16 = 0x0100;
        const SWP_NOREDRAW: u16 = 0x0008;

        let (after, old, old_client, place) = {
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
            system.minimize(index)?;

            let window = system.windows[index].as_ref().expect("a window");

            (
                after,
                old,
                old_client,
                [window.left, window.top, window.width, window.height],
            )
        };
        let flags = SWP_NOACTIVATE
            | SWP_FRAMECHANGED
            | SWP_NOCOPYBITS
            | if show { SWP_SHOWWINDOW } else { 0 };
        let mut structure = Param::Struct(window_pos(hwnd, after, place, flags));

        // For which `DefWindowProc` asks `WM_GETMINMAXINFO`, and holds the
        // icon to the reserved size it answers: a window without a minimize
        // box answering 50 by 50 is an icon so big (`minmax`).
        self.send_message(hwnd, WM_WINDOWPOSCHANGING, 0, &mut structure)
            .await?;

        let place = match &structure {
            Param::Struct(bytes) => {
                let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));
                let asked = [word(4), word(6), word(8), word(10)];

                if asked == place {
                    place
                } else {
                    let mut system = self.system();

                    system.place_window(
                        index,
                        asked[0],
                        asked[1],
                        asked[2].max(0),
                        asked[3].max(0),
                    )?;

                    let window = system.windows[index].as_ref().expect("a window");

                    [window.left, window.top, window.width, window.height]
                }
            }
            Param::Value(_) => place,
        };

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

/// A window shown as `ShowWindow` shows it: whether it was visible before;
/// nought for a handle that is no window of the desktop's.
async fn show_named(engine: &Engine, hwnd: u16, show: u16) -> Result<u16, Stop> {
    let index = match engine.system().handles.resolve(hwnd) {
        Some(Object::Window(index)) if engine.system().windows[index].is_some() => index,
        _ => return Ok(0),
    };

    Ok(u16::from(
        engine.show_raster(hwnd, index, show, true, false).await?,
    ))
}

/// A window minimized: despite its name, `CloseWindow` destroys nothing.
pub fn close_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());

        show_named(engine, hwnd, SW_MINIMIZE).await?;
        Ok(Answer::Nothing)
    })
}

/// A minimized window opened again, shown as `SW_SHOWNORMAL` shows it.
pub fn open_icon(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());

        Ok(Answer::Word(show_named(engine, hwnd, SW_SHOWNORMAL).await?))
    })
}
/// The corner of a window's parent's client area, which a child's placement
/// is counted from; the screen's for a window at the top.
fn placement_origin(system: &System, index: usize) -> (i32, i32) {
    system.windows[index]
        .as_ref()
        .and_then(|window| window.parent)
        .and_then(|parent| system.windows[parent].as_ref())
        .map_or((0, 0), |parent| {
            (
                parent.left + parent.client.left,
                parent.top + parent.client.top,
            )
        })
}

/// The window's normal place -- its parent's client coordinates for a
/// child -- set, then shown as `showCmd` says: a window shown maximized or
/// minimized comes back to that place when restored. Documented, not
/// measured; Program Manager places its group windows so.
pub fn set_window_placement(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };
        let (index, show, rect) = {
            let system = engine.system();
            let Some(index) = system.window_named(hwnd).filter(|_| far != 0) else {
                return Ok(Answer::Word(0));
            };
            let bytes = system.read_far(far, 22);
            let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));
            let show = u16::from_le_bytes([bytes[4], bytes[5]]);
            let rect = [word(14), word(16), word(18), word(20)];

            (index, show, rect)
        };
        let [left, top, right, bottom] = rect;
        let (width, height) = (right - left, bottom - top);
        let normal = engine.system().windows[index]
            .as_ref()
            .is_some_and(|window| window.placement == Placement::Normal);

        if normal {
            engine
                .position_raster(
                    hwnd,
                    index,
                    0,
                    left as i16,
                    top as i16,
                    width as i16,
                    height as i16,
                    crate::position::SWP_NOZORDER | crate::position::SWP_NOACTIVATE,
                )
                .await?;
        } else {
            let mut system = engine.system();
            let (x, y) = placement_origin(&system, index);

            if let Some(window) = system.windows[index].as_mut() {
                window.restore_rect = Some([left + x, top + y, width, height]);
            }
        }

        engine.show_raster(hwnd, index, show, true, false).await?;
        Ok(Answer::Word(1))
    })
}

/// The window's normal place and how it shows now: its place if it is
/// neither minimized nor maximized, else where it is to be restored to.
pub fn get_window_placement(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let Some(index) = system.window_named(hwnd).filter(|_| far != 0) else {
        return Ok(Answer::Word(0));
    };
    let (x, y) = placement_origin(system, index);
    let window = system.windows[index].as_ref().expect("a window");
    let [left, top, width, height] = match window.restore_rect {
        Some(rect) if window.placement != Placement::Normal => rect,
        _ => [window.left, window.top, window.width, window.height],
    };
    let show = match window.placement {
        Placement::Maximized => SW_SHOWMAXIMIZED,
        Placement::Minimized => SW_SHOWMINIMIZED,
        Placement::Normal => SW_SHOWNORMAL,
    };
    let mut bytes = Vec::with_capacity(22);

    for word in [22, 0, show] {
        bytes.extend_from_slice(&word.to_le_bytes());
    }

    for value in [
        -1,
        -1,
        -1,
        -1,
        left - x,
        top - y,
        left - x + width,
        top - y + height,
    ] {
        bytes.extend_from_slice(&(value as i16).to_le_bytes());
    }

    system.write_far(far, &bytes);
    Ok(Answer::Word(1))
}
