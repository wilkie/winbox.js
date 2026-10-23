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
const SW_SHOW: u16 = 5;
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
const SWP_NOREDRAW: u16 = 0x0008;
const SWP_FRAMECHANGED: u16 = 0x0020;
const SWP_SHOWWINDOW: u16 = 0x0040;
const SWP_HIDEWINDOW: u16 = 0x0080;
const SWP_NOCLIENTSIZE: u16 = 0x0800;
const SWP_NOCLIENTMOVE: u16 = 0x1000;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;

const CS_SAVEBITS: u16 = 0x0800;

const WM_SETVISIBLE: u16 = 0x0009;
const WM_CHILDACTIVATE: u16 = 0x0022;
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
    /// `ActivateWindow`'s bringing to the front (`activate_window`): the
    /// family asked, whether or not it moved, each after the one before --
    /// the first after none for the system-modal window, `front` -- and
    /// those of it that moved from `order_before`, the windows at the top as
    /// they lay, told -- the window made active only where it showed,
    /// `told`.
    Activate {
        family: Vec<usize>,
        shown: usize,
        order_before: Vec<usize>,
        front: bool,
        told: bool,
    },
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

    /// The windows `ActivateWindow` brings to the front with a window at the
    /// top: as `family_of`, with the windows the head owns that are hidden
    /// among them (`enddlg`: an owner made active again asks the hidden
    /// dialog it owns).
    pub(crate) fn activation_family(&self, shown: usize) -> Vec<usize> {
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

                window.parent.is_none()
                    && window.title_of.is_none()
                    && other != head
                    && (other == shown || owns(other))
            })
            .collect();

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

impl System {
    /// Which of a family brought up moves, each taken in turn after the
    /// window it was asked to go after, from the windows at the top as they
    /// lay: one that lies there already, by then, does not.
    fn moved_in_turn(&self, family: &[usize], asked: &[u16], order_before: &[usize]) -> Vec<bool> {
        let mut order = order_before.to_vec();

        family
            .iter()
            .zip(asked)
            .map(|(&member, &wanted)| {
                let Some(at) = order.iter().position(|&other| other == member) else {
                    return false;
                };
                let lies = if at > 0 {
                    self.hwnd_of(order[at - 1])
                } else {
                    0
                };

                if lies == wanted {
                    return false;
                }

                order.remove(at);

                let to = if wanted == 0 {
                    0
                } else {
                    order
                        .iter()
                        .position(|&other| self.hwnd_of(other) == wanted)
                        .map_or(0, |at| at + 1)
                };

                order.insert(to, member);
                true
            })
            .collect()
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
    /// `WM_ACTIVATEAPP` to each window at the top of a task, front to back.
    async fn tell_task(&self, task: u16, active: u16, other: u16) -> Result<(), Stop> {
        let windows: Vec<u16> = {
            let system = self.system();

            system
                .top_level_hwnds()
                .into_iter()
                .filter(|&hwnd| {
                    system
                        .window_named(hwnd)
                        .and_then(|index| system.windows[index].as_ref())
                        .is_some_and(|window| window.task == task)
                })
                .collect()
        };

        for hwnd in windows {
            if self.system().window_named(hwnd).is_some() {
                self.send_message(
                    hwnd,
                    WM_ACTIVATEAPP,
                    active,
                    &mut Param::Value(u32::from(other)),
                )
                .await?;
            }
        }

        Ok(())
    }

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

                // The task told it is no longer active, as USER notes the
                // task apart from the window (seg1 `36b3`): a dialog with no
                // owner ended leaves no window active, and the window made
                // active after it, of the same task, is told nothing of its
                // task (`enddlg`).
                (
                    from.map_or(0, |from| system.hwnd_of(from)),
                    system.hwnd_of(to),
                    if from.is_some() {
                        task(from)
                    } else {
                        system.active_task.unwrap_or(0)
                    },
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
            }

            if let Some(between) = between {
                self.between(between, to).await?;
            }

            // The task changed, every window at the top of each task is
            // told, front to back, hidden ones too: the task losing it with
            // 0 and the other task, then the task gaining it with 1 and the
            // task before, nought for none (`USER.EXE` seg1 `36b3`-`371c`,
            // the windows enumerated by `6556`, each sent by `3452`).
            // **Recorded** by `sysdlg`.
            if (from_hwnd == 0 && from_task == 0) || from_task != to_task {
                if from_task != 0 {
                    self.tell_task(from_task, 0, to_task).await?;
                }

                self.system().active_task = Some(to_task);
                self.tell_task(to_task, 1, from_task).await?;

                // Gone meanwhile, it is made active no further (`3729`).
                if self.system().window_named(to_hwnd).is_none() {
                    return Ok(());
                }
            }

            self.system().active_task = Some(to_task);

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
            // changes under it. And the time noted where none is (`37f2`-
            // `3803`; `screen_saver.rs`).
            self.system().note_activation();
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
                Box::pin(self.change_focus(to_hwnd)).await?;
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
    /// The computer-based training hooks asked before a window at the top
    /// is made active, `HCBT_ACTIVATE`, the window and a
    /// `CBTACTIVATESTRUCT`: whether a press makes it active, and the window
    /// active now. What they answered; non-nought in AX, nothing changes
    /// (`USER.EXE` seg1 `3558`-`3582`; **recorded** by `cbthook`).
    pub(crate) async fn ask_activate(&self, top: usize, mouse: u16) -> Result<u32, Stop> {
        let (hwnd, active) = {
            let system = self.system();
            let hwnd = system.windows[top].as_ref().map_or(0, |window| window.hwnd);
            let active = system
                .active_top()
                .and_then(|active| system.windows[active].as_ref())
                .map_or(0, |window| window.hwnd);

            (hwnd, active)
        };
        let structure = [mouse, active]
            .iter()
            .flat_map(|word| word.to_le_bytes())
            .collect::<Vec<u8>>();

        Ok(self
            .ask_cbt_with(crate::hooks::HCBT_ACTIVATE, hwnd, &structure)
            .await?
            .0)
    }

    pub(crate) async fn activate_for_focus(&self, top: usize) -> Result<bool, Stop> {
        self.activate_window(top, true, true).await
    }

    /// A window at the top made active, as USER's `ActivateWindow` makes it
    /// (`USER.EXE` seg1 `3514`): the window active before told, then, where
    /// the first window that shows at the top is not this one -- always,
    /// for one hidden -- brought to the front with the windows it brings
    /// (`3674`-`3697`), then told itself. Each of them is asked with
    /// `WM_WINDOWPOSCHANGING`, the windows it owns first, hidden ones too,
    /// then it, with `SWP_NOSIZE | SWP_NOMOVE` and the rest `SWP_NOACTIVATE`
    /// besides; and told with `WM_WINDOWPOSCHANGED` where that moved it
    /// among the others. **Recorded** by `comboact` and `enddlg`.
    /// `for_focus`: `SetFocus`'s activation, which gives the focus itself
    /// (`3899`); otherwise a focus left in another window at the top is
    /// moved to this one (`37a3`). `whole`: a window that shows is due
    /// whole, as `SetActiveWindow`, `SetFocus` and `EndDialog` have it
    /// (`hooks`: the owner of a dialog ended is painted again); otherwise
    /// only what it uncovers of itself, as a window made active as another
    /// is destroyed (`uncover`: the window under one destroyed is erased
    /// once). The computer-based training hooks are asked first,
    /// `HCBT_ACTIVATE`, the window and a `CBTACTIVATESTRUCT`: whether a press
    /// made it active, and the window active now; non-nought in AX, nothing
    /// changes, and the answer is false (`3558`-`3582`; **recorded** by
    /// `cbthook`).
    pub(crate) async fn activate_window(
        &self,
        top: usize,
        for_focus: bool,
        whole: bool,
    ) -> Result<bool, Stop> {
        if self.system().active_top() == Some(top) {
            return Ok(true);
        }

        // Refused while a window is system modal and this is not it, unless
        // the running task is the system-modal window's (`USER.EXE` seg1
        // `3531`-`354c`), before the hooks are asked. **Recorded** by
        // `sysdlg`: the program whose dialog is system modal makes its
        // other window active with `SetActiveWindow`.
        {
            let system = self.system();
            let sys_modal = system.sys_modal_window();

            if sys_modal != 0
                && system.hwnd_of(top) != sys_modal
                && system
                    .window_named(sys_modal)
                    .and_then(|index| system.windows[index].as_ref())
                    .is_some_and(|window| window.task != system.task_handle)
            {
                return Ok(false);
            }
        }

        if self.ask_activate(top, 0).await? & 0xffff != 0 {
            return Ok(false);
        }

        let between = {
            let mut system = self.system();

            if system.active_top() == Some(top) {
                return Ok(true);
            }

            let sys_modal = system.sys_modal_window();
            let top_hwnd = system.hwnd_of(top);

            let first = system.z_order.iter().copied().find(|&other| {
                system.windows[other]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_none() && window.visible)
            });
            let mut family = if first == Some(top) {
                Vec::new()
            } else {
                system.activation_family(top)
            };
            let order_before: Vec<usize> = system
                .z_order
                .iter()
                .copied()
                .filter(|&other| {
                    system.windows[other]
                        .as_ref()
                        .is_some_and(|window| window.parent.is_none() && window.title_of.is_none())
                })
                .collect();
            // The system-modal window goes to the very front, before the
            // topmost windows too, and is asked to go after none.
            // **Recorded** by `sysdlg`.
            let front = sys_modal != 0 && top_hwnd == sys_modal;
            let shown = system.windows[top]
                .as_ref()
                .is_some_and(|window| window.visible);

            if first == Some(top) {
                system.activate_in_place(top, whole);
            } else if !whole && shown {
                system.show_with(top, false);
            } else {
                system.activate(top, front);
            }

            if for_focus {
                system.activating_for_focus = true;
            }

            family.sort_by_key(|member| system.z_order.iter().position(|other| other == member));

            (!family.is_empty()).then_some(Between::Activate {
                family,
                shown: top,
                order_before,
                front,
                told: shown,
            })
        };

        self.deliver_activation(between).await?;
        Ok(true)
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
            } => self.bring_forward(&family, shown, &before, false).await,
            Between::Activate {
                family,
                shown,
                order_before,
                front,
                told,
            } => {
                self.bring_up_activated(&family, shown, &order_before, front, told)
                    .await
            }
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

    /// `ActivateWindow`'s family brought to the front (`activate_window`):
    /// the first asked goes after the window it now lies after -- the last
    /// topmost, USER's own hidden `#32771` -- and the rest each after the
    /// one before; each then moved in turn after the window it was asked
    /// to go after, and told only where it did not lie there already, one
    /// coming after a window of its family moved before it lying there by
    /// then. A window made active hidden is not told, nor, for the
    /// system-modal window, any of them (`enddlg`: an owner minimized is
    /// told); one told goes after the window it was asked to, and one
    /// hidden is told `SWP_NOREDRAW` as well (seg7 `0df5`-`0e05`).
    /// **Recorded** by `sysdlg`.
    async fn bring_up_activated(
        &self,
        family: &[usize],
        shown: usize,
        order_before: &[usize],
        front: bool,
        told: bool,
    ) -> Result<(), Stop> {
        let mut after = if front {
            0
        } else {
            let system = self.system();
            let at = system
                .z_order
                .iter()
                .position(|&other| other == family[0])
                .unwrap_or(0);

            system.z_order[..at]
                .iter()
                .copied()
                .rfind(|&other| {
                    system.windows[other]
                        .as_ref()
                        .is_some_and(|window| window.parent.is_none())
                })
                .map_or(0, |other| system.hwnd_of(other))
        };
        let mut asked = Vec::with_capacity(family.len());

        for &member in family {
            let hwnd = self.system().hwnd_of(member);
            let flags = if member == shown {
                SWP_NOSIZE | SWP_NOMOVE
            } else {
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            };

            asked.push(after);
            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGING,
                0,
                &mut Param::Struct(window_pos(hwnd, after, [0, 0, 0, 0], flags)),
            )
            .await?;
            after = hwnd;
        }

        if front {
            return Ok(());
        }

        let moved = self.system().moved_in_turn(family, &asked, order_before);

        for ((&member, moved), &wanted) in family.iter().zip(moved).zip(&asked) {
            if !moved || (member == shown && !told) {
                continue;
            }

            let (hwnd, place, visible) = {
                let system = self.system();
                let Some(window) = system.windows[member].as_ref() else {
                    continue;
                };

                (
                    window.hwnd,
                    [window.left, window.top, window.width, window.height],
                    window.visible,
                )
            };
            let flags = if member == shown {
                SWP_NOSIZE | SWP_NOMOVE
            } else {
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            } | if visible { 0 } else { SWP_NOREDRAW }
                | SWP_NOCLIENTSIZE
                | SWP_NOCLIENTMOVE;

            self.send_message(
                hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(hwnd, wanted, place, flags)),
            )
            .await?;
        }

        Ok(())
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
        always: bool,
    ) -> Result<(), Stop> {
        let moved: Vec<bool> = {
            let system = self.system();

            family
                .iter()
                .zip(before)
                .map(|(&member, was)| system.above(member) != *was)
                .collect()
        };

        if !always && !moved.iter().any(|&one| one) {
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

        // Minimized, maximized, or restored from either: the computer-based
        // training hooks asked first, `HCBT_MINMAX`, the window and the
        // command as `ShowWindow` was given it; non-nought in AX, nothing
        // changes (`USER.EXE` seg14 `0c29`-`0c8d`, seg6 `1ad2`-`1af5`;
        // **recorded** by `cbthook`).
        if (matches!(show, 2 | 3 | 6 | 7)
            || matches!(show, 1 | 4 | 9)
                && matches!(placement, Placement::Minimized | Placement::Maximized))
            && self
                .ask_cbt(crate::hooks::HCBT_MINMAX, hwnd, u32::from(show))
                .await?
                & 0xffff
                != 0
        {
            return Ok(was);
        }

        // Minimized, maximized, or restored from either, as `MinMaximize`
        // does it (`USER.EXE` seg14 `0c67`-`0c92`, seg6 `1a72`):
        // `SW_SHOWNOACTIVATE` of a window minimized or maximized restores
        // it, not made active where a window is (`1b3d`-`1b48`, `1c61`).
        let min_max = matches!(show, 2 | 3 | 6 | 7)
            || matches!(show, 1 | 4 | 9)
                && matches!(placement, Placement::Minimized | Placement::Maximized);
        let restoring_quietly = show == SW_SHOWNOACTIVATE && min_max;
        let show = if restoring_quietly { SW_RESTORE } else { show };

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

        // A child minimized, maximized or restored so goes where
        // `MinMaximize` puts it, and is made active, but with
        // `SW_SHOWNOACTIVATE`; minimized with `SW_MINIMIZE` or
        // `SW_SHOWMINNOACTIVE` it stays where it lies (seg6 `1b3d`-`1b81`,
        // `1c66`; `pmgroups`).
        if hiding || child && (!min_max || matches!(show, SW_MINIMIZE | SW_SHOWMINNOACTIVE)) {
            flags |= SWP_NOZORDER | SWP_NOACTIVATE;
        }

        if restoring_quietly && self.system().active_hwnd() != 0 {
            flags |= SWP_NOACTIVATE;
        }

        // Shown and not made active: where it lies with `SW_SHOWNOACTIVATE`,
        // brought to the front with `SW_SHOWNA` (`showsq2`).
        if matches!(show, SW_SHOWNOACTIVATE | SW_SHOWNA | SW_SHOWMINNOACTIVE) {
            flags |= SWP_NOACTIVATE;
        }

        if show == SW_SHOWNOACTIVATE {
            flags |= SWP_NOZORDER;
        }

        // A window at the top whose class saves the bits under it, as the
        // dialog class's does, is made active before it shows, with
        // `SW_SHOWNORMAL` or `SW_SHOW`, and then shown where it is, not made
        // active again (`USER.EXE` seg14 `0d01`-`0d2b`: the class's style,
        // `CS_SAVEBITS`, then seg1 `38e4` with 1, then `SWP_NOZORDER |
        // SWP_NOACTIVATE`). **Recorded** by `enddlg`: a dialog made active
        // hidden, as `DialogBox` makes it, is shown with flags 57h, and
        // nothing else is moved.
        if matches!(show, SW_SHOWNORMAL | SW_SHOW)
            && !child
            && self.system().class_style(index) & CS_SAVEBITS != 0
        {
            self.activate_window(index, false, true).await?;

            if self.gone(index) {
                return Ok(was);
            }

            flags |= SWP_NOZORDER | SWP_NOACTIVATE;
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
                    self.set_focus_nothing().await?;
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

                    // A child minimized with `SW_MINIMIZE` or
                    // `SW_SHOWMINNOACTIVE` goes after the last of the
                    // brothers beneath it owned as it is, before the first
                    // not topmost as it is, and stays where it is with none
                    // (seg6 `1b70`-`1b7d`, `1e58`-`1e89`; `pmgroups`).
                    if child && matches!(show, SW_MINIMIZE | SW_SHOWMINNOACTIVE) {
                        let last = {
                            let window = system.windows[index].as_ref().expect("a window");
                            let (owner, topmost) = (window.owner, window.topmost);
                            let order = system.siblings(index);

                            order
                                .iter()
                                .skip_while(|&&other| other != index)
                                .skip(1)
                                .copied()
                                .take_while(|&other| {
                                    system.windows[other]
                                        .as_ref()
                                        .is_some_and(|other| other.topmost == topmost)
                                })
                                .filter(|&other| {
                                    system.windows[other]
                                        .as_ref()
                                        .is_some_and(|other| other.owner == owner)
                                })
                                .last()
                        };

                        if let Some(last) = last {
                            system.reorder(index, crate::moved::Insert::After(last));
                        }
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

                    // Made active hidden first, as for a class with
                    // `CS_SAVEBITS`, it is shown with `SWP_NOZORDER` where
                    // `ActivateWindow` put it (`sysdlg`: a system-modal
                    // dialog stays at the very front).
                    let active = system.windows[index]
                        .as_ref()
                        .is_some_and(|window| window.active && window.parent.is_none());

                    if flags & SWP_NOZORDER != 0 && active {
                        system.show_in_place(index);
                    } else {
                        system.show(index);
                    }
                }
                SW_SHOWNOACTIVATE => system.show_in_place(index),
                // A child is shown where it lies: `ShowWindow` gives a
                // child `SWP_NOZORDER` (`USER.EXE` seg14 `0cf5`-`0cff`,
                // `0d2b`; `pmgroups`).
                SW_SHOWNA if child => system.show_in_place(index),
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

        // A child moved so without `SWP_NOACTIVATE` is sent
        // `WM_CHILDACTIVATE`, as `SetWindowPos` sends it the first window of
        // its list without that flag: an MDI child is made the active one
        // (seg7 `0ca3`-`0ce6`, `0260`-`026f`, `0382`-`03a6`; `pmgroups`).
        if child && min_max && flags & SWP_NOACTIVATE == 0 {
            self.send_message(hwnd, WM_CHILDACTIVATE, 0, &mut Param::Value(0))
                .await?;

            if self.gone(index) {
                return Ok(was);
            }
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
                    // Not moved among its siblings after all: said so
                    // (`showseq`) -- for the window shown; one of its family
                    // not moved is not told (`sysdlg`: an owned pop-up made
                    // shown over its owner at the front, the owner asked and
                    // not told).
                    let still = how & SWP_NOZORDER == 0 && system.above(member) == above_before[at];

                    if still && member != index {
                        continue;
                    }

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
            let next = self
                .system()
                .next_after_minimize(index)
                .filter(|&next| next != index);
            // Made active as `ActivateWindow` makes one: the
            // computer-based training hooks asked first (`activate_window`;
            // **recorded** by `cbthook`).
            let next = match next {
                Some(next) if self.ask_activate(next, 0).await? as u16 == 0 => Some(next),
                _ => None,
            };

            if let Some(next) = next {
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

        if minimized {
            self.title_made(hwnd, index).await?;
        }

        if changes && !hiding && minimized {
            self.title_shown(hwnd, index, flags & SWP_NOACTIVATE == 0)
                .await?;
        }

        // Hidden, a window that has the focus itself gives it to its parent,
        // or a window at the top to none, once another window has been made
        // active; a focus in a window inside it stays there (`USER.EXE`
        // seg14 `0dd4`, seg2 `090a`).
        if hiding && told {
            let parent = {
                let system = self.system();

                (system.focus == Some(index)).then(|| parent.map(|parent| system.hwnd_of(parent)))
            };

            match parent {
                Some(Some(parent)) if parent != 0 => {
                    Box::pin(self.set_focus(parent)).await?;
                }
                Some(_) => {
                    self.focus_nothing().await?;
                }
                None => {}
            }
        }

        self.system().nudge()?;
        Ok(was)
    }

    /// Whether a window has been destroyed.
    fn gone(&self, index: usize) -> bool {
        self.system().windows[index].is_none()
    }

    /// USER makes an icon's title with `CreateWindow` the first time the
    /// window is minimized, and keeps it, hidden, while the window is
    /// restored (`USER.EXE` seg1 `6ab8`): the computer-based training hooks
    /// are asked then, `HCBT_CREATEWND`, with its `CREATESTRUCT` -- class
    /// `#32772`, no name, `WS_POPUP`, at nought, nought, one by one, the
    /// window its parent, its instance the window's (`6afc`-`6b20`).
    /// **Recorded** by `cbthook`: asked as the window is first minimized,
    /// not as it is again. winbox.js makes the title again each time, and
    /// asks only the first. What a hook answers is not followed: Windows
    /// would take the title apart as it takes any window refused
    /// (`cbteat`).
    async fn title_made(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let (title, instance) = {
            let mut system = self.system();
            let Some(window) = system.windows[index].as_mut() else {
                return Ok(());
            };

            if window.title_asked {
                return Ok(());
            }

            let (title, instance) = (window.icon_title, window.instance);
            let Some(title) = title.and_then(|title| system.windows[title].as_ref()) else {
                return Ok(());
            };
            let title = title.hwnd;

            if title == 0 {
                return Ok(());
            }

            if let Some(window) = system.windows[index].as_mut() {
                window.title_asked = true;
            }

            (title, instance)
        };
        let mut create = Vec::with_capacity(34);

        create.extend_from_slice(&0u32.to_le_bytes());
        create.extend_from_slice(&instance.to_le_bytes());
        create.extend_from_slice(&0u16.to_le_bytes());
        create.extend_from_slice(&hwnd.to_le_bytes());

        for value in [1u16, 1, 0, 0] {
            create.extend_from_slice(&value.to_le_bytes());
        }

        create.extend_from_slice(&0x8000_0000u32.to_le_bytes());
        create.extend_from_slice(&0u32.to_le_bytes());
        create.extend_from_slice(&0x8004u32.to_le_bytes());
        create.extend_from_slice(&0u32.to_le_bytes());
        self.ask_cbt_create(title, &create).await?;
        Ok(())
    }

    /// An icon's title made and shown: its window asked for its text, 80
    /// characters, as the title is made and again as it is drawn; and, when
    /// the icon was not made active, the icon asked to go after its title,
    /// which it already does -- nothing more is sent (`showmin`).
    async fn title_shown(&self, hwnd: u16, index: usize, activated: bool) -> Result<(), Stop> {
        self.title_made(hwnd, index).await?;

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
            let mut system = engine.system();
            let Some(index) = system.window_named(hwnd).filter(|_| far != 0) else {
                return Ok(Answer::Word(0));
            };
            let bytes = system.read_far(far, 22);
            let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));
            let show = u16::from_le_bytes([bytes[4], bytes[5]]);
            let rect = [word(14), word(16), word(18), word(20)];

            // `WPF_SETMINPOSITION`: its icon goes at `ptMinPosition`, in its
            // parent's client area, as Program Manager places a group's
            // icon where its file says (`PROGMAN.EXE` seg4 `1f04`-`1f51`;
            // `pmraw`, `pmfiles`).
            if word(2) & 1 != 0 {
                let (x, y) = placement_origin(&system, index);

                if let Some(window) = system.windows[index].as_mut() {
                    window.icon_place = Some((word(6) + x, word(8) + y));
                }
            }

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
