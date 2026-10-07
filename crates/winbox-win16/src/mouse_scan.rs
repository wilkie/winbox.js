//! The mouse as USER's system queue gives it out, as winbox.js's
//! `mouse-scan.ts` does: each mouse message hit-tested as a look comes to
//! it, the window asked where the point is on it, and, as a press is taken,
//! the windows it is in told and the window asked whether to be made
//! active.
//!
//! **Read out** of `USER.EXE`.
//!
//! * The input is looked at only where the look's filter asks for some of
//!   it and the queue has some (seg1 `24bb`, `2509`): a filter's range asks
//!   for the mouse's moves where it holds `WM_MOUSEMOVE` or
//!   `WM_NCMOUSEMOVE`, for its buttons where it meets `WM_NCLBUTTONDOWN` to
//!   `WM_NCMBUTTONDBLCLK` or `WM_LBUTTONDOWN` to `WM_MBUTTONDBLCLK`, for the
//!   keys where it meets `WM_KEYDOWN` to `WM_SYSDEADCHAR` (`25e8`). Then
//!   each mouse message, in order, is hit-tested before the filter is held
//!   to it (`2d0c`, `2e0e`), until one is taken or looked at.
//! * The hit test (`71b9`): with the mouse captured, the capturing window
//!   and `HTCLIENT`. Else, from the desktop window down, front first: a
//!   hidden window, and one the point is not on, is passed over; a disabled
//!   child is passed over, its children with it; a disabled window at the
//!   top is `HTERROR` there and then; an icon is `HTCAPTION`. Where the
//!   point is in a window's client area, its children are looked at first,
//!   and the window itself after them. A window of another task is
//!   `HTCLIENT`, and its task is left to take the message, hit-testing it
//!   again. Any other window is sent `WM_NCHITTEST`, and answering
//!   `HTTRANSPARENT` it is passed over too, for its brothers behind it and
//!   then the window it is in.
//! * `HTERROR` and `HTNOWHERE` (`2ec5`): the window is sent `WM_SETCURSOR`
//!   and the message is thrown away, taken or only looked at.
//! * Not `HTCLIENT`, the message takes its non-client form, with the
//!   hit-test code for its `wParam` and the point on the screen (`2e03`);
//!   a press is a double click off the client area, or in it where the
//!   class has `CS_DBLCLKS` (`2d69`).
//! * Taken, with the mouse not captured (`2933`): a press is sent up from a
//!   child to each window it is in, as `WM_PARENTNOTIFY` with the mouse
//!   message and the point in that window's client area -- whatever
//!   `WS_EX_NOPARENTNOTIFY` says. Then a press on a window that is not the
//!   active one, in a window at the top that is not the desktop window, is
//!   sent `WM_MOUSEACTIVATE`, naming the window at the top, with the
//!   hit-test code and the mouse message: answered 0, `MA_ACTIVATE` or
//!   `MA_ACTIVATEANDEAT`, that window is made active, `WA_CLICKACTIVE` for a
//!   press in the client area and `WA_ACTIVE` for one off it (`29e6`,
//!   `38e4`, `377e`), and the press thrown away for `MA_ACTIVATEANDEAT`;
//!   `MA_NOACTIVATE` leaves it as it is; `MA_NOACTIVATEANDEAT` throws the
//!   press away. Then the window is sent `WM_SETCURSOR`, press or not,
//!   eaten or not.
//!
//! **Recorded** by `mousemsg`.

use crate::call::Stop;
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::Param;
use crate::queue::{Filter, Message, WM_MOUSEMOVE};
use crate::system::System;
use crate::windows::Placement;

const WM_SETCURSOR: u16 = 0x0020;
const WM_MOUSEACTIVATE: u16 = 0x0021;
const WM_NCHITTEST: u16 = 0x0084;
const WM_NCMOUSEMOVE: u16 = 0x00a0;
const WM_PARENTNOTIFY: u16 = 0x0210;

const HTTRANSPARENT: i16 = -1;
const HTNOWHERE: i16 = 0;
const HTCLIENT: i16 = 1;
const HTCAPTION: i16 = 2;
const HTERROR: i16 = -2;

const MA_ACTIVATEANDEAT: i16 = 2;
const MA_NOACTIVATEANDEAT: i16 = 4;

const CS_DBLCLKS: u16 = 0x0008;
const WS_CHILD: u32 = 0x4000_0000;
const WS_POPUP: u32 = 0x8000_0000;
const WS_DISABLED: u32 = 0x0800_0000;

const QS_KEY: u16 = 0x01;
const QS_MOUSEMOVE: u16 = 0x02;
const QS_MOUSEBUTTON: u16 = 0x04;

/// How the mouse is captured (`USER.EXE` seg1 `28cd`, the kind at `10e`):
/// by `SetCapture`, its messages in the client area; by USER's own loops,
/// which move and size windows and run menus, in their client form at the
/// point on the screen, a menu's presses twice a double click whatever the
/// class (seg1 `2df1`, `2d7c`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CaptureKind {
    #[default]
    Set,
    Loop,
    Menu,
}

/// The mouse as it was put in: where on the screen, which message, and the
/// buttons down.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MouseInput {
    pub x: i16,
    pub y: i16,
    /// The mouse message in its client form: `WM_MOUSEMOVE`, or a button's
    /// press or release.
    pub kind: u16,
    /// A press the mouse made the second of a double click.
    pub double: bool,
    /// The `MK_` flags, for a message in the client area.
    pub keys: u16,
}

/// A mouse message hit-tested: the window it is for, its form, and the
/// hit-test code.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Resolved {
    index: usize,
    pub hwnd: u16,
    pub message: u16,
    pub wparam: u16,
    pub lparam: u32,
    hit: i16,
}

/// What a look does with a mouse message it comes to.
pub(crate) enum Outcome {
    /// A message for a window of this task, in the form it takes.
    Resolved(Resolved),
    /// To be thrown away, its window told.
    Refused { hwnd: u16, hit: i16 },
    /// Another task's, or the desktop window's, handed on to that task's
    /// queue.
    Elsewhere,
}

/// Whether a range, as a look's filter gives it, meets another (seg1
/// `2652`).
fn meets(first: u16, last: u16, low: u16, high: u16) -> bool {
    if first <= last {
        high >= first && low <= last
    } else {
        low > first || high < last
    }
}

/// What kinds of input a look's filter asks for, as `QS_` bits (seg1
/// `25e8`).
fn filter_kinds(filter: Filter) -> u16 {
    let (first, last) = (filter.first, filter.last);

    if first == 0 && last == 0 {
        return QS_KEY | QS_MOUSEMOVE | QS_MOUSEBUTTON;
    }

    let mut kinds = 0;

    if meets(first, last, WM_MOUSEMOVE, WM_MOUSEMOVE)
        || meets(first, last, WM_NCMOUSEMOVE, WM_NCMOUSEMOVE)
    {
        kinds |= QS_MOUSEMOVE;
    }

    if meets(first, last, 0x00a1, 0x00a9) || meets(first, last, 0x0201, 0x0209) {
        kinds |= QS_MOUSEBUTTON;
    }

    if meets(first, last, 0x0100, 0x0107) {
        kinds |= QS_KEY;
    }

    kinds
}

fn signed(value: u32) -> i16 {
    value as u16 as i16
}

fn packed(x: i32, y: i32) -> u32 {
    (y as u32 & 0xffff) << 16 | (x as u32 & 0xffff)
}

impl System {
    /// Whether a look looks at the input at all (seg1 `24bb`): the kinds
    /// its filter asks for, of those the running task's queue holds.
    pub(crate) fn looks_at_input(&self, filter: Filter) -> bool {
        let Some(task) = self.task.as_ref() else {
            return false;
        };
        let held = task.queue.input.iter().fold(0, |kinds, one| {
            let kind = one.mouse.map_or(one.message, |mouse| mouse.kind);

            kinds
                | if (0x100..=0x108).contains(&kind) {
                    QS_KEY
                } else if kind == WM_MOUSEMOVE || kind == WM_NCMOUSEMOVE {
                    QS_MOUSEMOVE
                } else {
                    QS_MOUSEBUTTON
                }
        });

        filter_kinds(filter) & held != 0
    }

    fn within_window(&self, index: usize, x: i32, y: i32) -> bool {
        let window = self.windows[index].as_ref().expect("a window");

        x >= window.left
            && x < window.left + window.width
            && y >= window.top
            && y < window.top + window.height
    }

    fn in_client(&self, index: usize, x: i32, y: i32) -> bool {
        let window = self.windows[index].as_ref().expect("a window");
        let client = window.client;

        x >= window.left + client.left
            && x < window.left + client.right
            && y >= window.top + client.top
            && y < window.top + client.bottom
    }

    /// A child, as USER tells one: `WS_CHILD` without `WS_POPUP`.
    fn child_styled(&self, index: usize) -> bool {
        self.windows[index]
            .as_ref()
            .is_some_and(|window| window.style & (WS_CHILD | WS_POPUP) == WS_CHILD)
    }

    /// The window the scan comes to first in one the point is on: where the
    /// point is in its client area and not an icon's, the first of its
    /// children shown under the point, and so on down.
    fn descend(&self, index: usize, x: i32, y: i32) -> usize {
        let window = self.windows[index].as_ref().expect("a window");

        if window.placement == Placement::Minimized || !self.in_client(index, x, y) {
            return index;
        }

        let child = self.z_order.iter().copied().find(|&other| {
            self.windows[other].as_ref().is_some_and(|one| {
                one.parent == Some(index)
                    && one.hwnd != 0
                    && one.visible
                    && self.within_window(other, x, y)
            })
        });

        child.map_or(index, |child| self.descend(child, x, y))
    }

    /// The window the scan comes to after one it passed over: the next of
    /// its brothers behind it that is shown under the point, or else the
    /// window it is in -- none, the desktop's, past the windows at the top.
    fn beneath(&self, index: usize, x: i32, y: i32) -> Option<usize> {
        let parent = self.windows[index].as_ref().expect("a window").parent;
        let brothers: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_some_and(|one| one.parent == parent && one.hwnd != 0)
            })
            .collect();
        let at = brothers.iter().position(|&one| one == index);

        for &other in &brothers[at.map_or(brothers.len(), |at| at + 1)..] {
            let shown = self.windows[other].as_ref().expect("a window").visible;

            if shown && self.within_window(other, x, y) {
                return Some(self.descend(other, x, y));
            }
        }

        parent
    }

    /// The outermost disabled window a window is, or is in.
    fn disabled_around(&self, index: usize) -> Option<usize> {
        let mut found = None;
        let mut at = Some(index);

        while let Some(window) = at.and_then(|at| self.windows[at].as_ref().map(|w| (at, w))) {
            if window.1.style & WS_DISABLED != 0 {
                found = Some(window.0);
            }

            at = window.1.parent;
        }

        found
    }
}

impl Engine {
    /// The window under the point and the part of it the point is on, as
    /// USER's hit test finds them (seg1 `71b9`): `WM_NCHITTEST` sent to the
    /// windows of the running task it comes to. With it, whether the window
    /// is another task's.
    async fn scan_hit(&self, x: i32, y: i32) -> Result<Option<(usize, i16, bool)>, Stop> {
        let mut candidate = self.system().window_at(x, y);

        while let Some(index) = candidate {
            let (disabled, minimized, mine, hwnd) = {
                let system = self.system();
                let window = system.windows[index].as_ref().expect("a window");

                (
                    system.disabled_around(index),
                    window.placement == Placement::Minimized || window.title_of.is_some(),
                    system.mine(window.hwnd),
                    window.hwnd,
                )
            };

            if let Some(disabled) = disabled {
                let system = self.system();

                if !system.child_styled(disabled) {
                    return Ok(Some((disabled, HTERROR, false)));
                }

                candidate = system.beneath(disabled, x, y);
                continue;
            }

            // An icon is all caption, and so is its title, whose procedure
            // answers `WM_NCHITTEST` so (seg1 `6dbd`).
            if minimized {
                return Ok(Some((index, HTCAPTION, false)));
            }

            if !mine {
                return Ok(Some((index, HTCLIENT, true)));
            }

            let hit = signed(
                self.send_message(hwnd, WM_NCHITTEST, 0, &mut Param::Value(packed(x, y)))
                    .await?,
            );

            if hit != HTTRANSPARENT {
                return Ok(Some((index, hit, false)));
            }

            candidate = self.system().beneath(index, x, y);
        }

        Ok(None)
    }

    /// What a look does with a mouse message it comes to (`resolveMouse`).
    pub(crate) async fn resolve_mouse(&self, message: &Message) -> Result<Outcome, Stop> {
        let mouse = message.mouse.expect("the mouse's");
        let (x, y) = (i32::from(mouse.x), i32::from(mouse.y));
        let (capture, capture_kind) = {
            let system = self.system();
            let capture = system
                .capture
                .filter(|&index| system.windows[index].is_some())
                .map(|index| {
                    let hwnd = system.windows[index].as_ref().expect("a window").hwnd;

                    (index, HTCLIENT, !system.mine(hwnd))
                });

            (
                capture,
                if capture.is_some() {
                    system.capture_kind
                } else {
                    CaptureKind::Set
                },
            )
        };
        let found = match capture {
            Some(found) => Some(found),
            None => self.scan_hit(x, y).await?,
        };

        if found.is_none_or(|(_, _, other)| other) {
            // Over no window, the desktop window's: a move makes the cursor
            // the arrow as its task takes it; a button over no window is no
            // one's.
            let mut system = self.system();
            let hwnd = match found {
                Some((index, _, _)) => system.windows[index].as_ref().expect("a window").hwnd,
                None => system.handles.lookup(Object::Desktop).unwrap_or(0),
            };

            if let Some(task) = system.task.as_mut() {
                task.queue.input.retain(|one| one.serial != message.serial);
            }

            let handed = if found.is_none() {
                (mouse.kind == WM_MOUSEMOVE).then_some(Message {
                    hwnd,
                    message: WM_MOUSEMOVE,
                    wparam: 0,
                    lparam: packed(x, y),
                    mouse: None,
                    ..*message
                })
            } else {
                Some(Message { hwnd, ..*message })
            };

            if let Some(handed) = handed
                && hwnd != 0
                && let Some(slot) = system.window_slot(hwnd).or_else(|| system.lone_slot())
                && let Some(queue) = system.queue_of(slot)
            {
                queue.push(handed, true);
                system.signal_slot(slot);
            }

            return Ok(Outcome::Elsewhere);
        }

        let (index, hit, _) = found.expect("a window");
        let system = self.system();
        let window = system.windows[index].as_ref().expect("a window");

        if hit == HTERROR || hit == HTNOWHERE {
            return Ok(Outcome::Refused {
                hwnd: window.hwnd,
                hit,
            });
        }

        let client = hit == HTCLIENT;
        let mut message = mouse.kind;

        // A press is a double click off the client area, or in it for a
        // class that asks for them, or in a menu's loop (seg1 `2d69`).
        if mouse.double
            && (!client
                || capture_kind == CaptureKind::Menu
                || system.class_style(index) & CS_DBLCLKS != 0)
        {
            message += 2;
        }

        // The non-client forms are the client ones moved down by 160h.
        if !client {
            message -= WM_MOUSEMOVE - WM_NCMOUSEMOVE;
        }

        // In the client area, as the window's; off it, and taken by a loop
        // of USER's, as the screen's (seg1 `2e21`, `2e0e`).
        let (px, py) = if client && capture_kind == CaptureKind::Set {
            (
                x - window.left - window.client.left,
                y - window.top - window.client.top,
            )
        } else {
            (x, y)
        };

        Ok(Outcome::Resolved(Resolved {
            index,
            hwnd: window.hwnd,
            message,
            wparam: if client { mouse.keys } else { hit as u16 },
            lparam: packed(px, py),
            hit,
        }))
    }

    /// A message thrown away as `HTERROR` or `HTNOWHERE`: its window told
    /// (seg1 `2ef8`).
    pub(crate) async fn refuse_mouse(
        &self,
        message: &Message,
        hwnd: u16,
        hit: i16,
    ) -> Result<(), Stop> {
        let kind = message.mouse.map_or(message.message, |mouse| mouse.kind);

        self.send_message(
            hwnd,
            WM_SETCURSOR,
            hwnd,
            &mut Param::Value(u32::from(kind) << 16 | u32::from(hit as u16)),
        )
        .await?;
        Ok(())
    }

    /// A mouse message taken, before it is handed over (seg1 `2933`): a
    /// press told to the windows it is in and the window asked whether to
    /// be made active, and the window asked for the cursor. Answers 0 to
    /// hand it over, 1 to throw it away, 2 to look at it again: the window
    /// at the top disabled as it was made active.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn mouse_taken(
        &self,
        message: &Message,
        resolved: Resolved,
    ) -> Result<u8, Stop> {
        let mouse = message.mouse.expect("the mouse's");

        if self.system().capture.is_some() {
            return Ok(0);
        }

        let Resolved {
            index, hwnd, hit, ..
        } = resolved;
        let press = matches!(mouse.kind, 0x0201 | 0x0204 | 0x0207);
        let mut top = Some(index);

        if press {
            let mut at = index;

            while self.system().child_styled(at) {
                // A child of the desktop window, as a combo box's list
                // dropped down is (`comboact`): told to the desktop window,
                // which does nothing.
                let parent = {
                    let system = self.system();

                    system.windows[at].as_ref().and_then(|window| window.parent)
                };
                let Some(parent) = parent else {
                    top = None;
                    break;
                };
                let (to, point) = {
                    let system = self.system();
                    let window = system.windows[parent].as_ref().expect("a window");

                    (
                        window.hwnd,
                        packed(
                            i32::from(mouse.x) - window.left - window.client.left,
                            i32::from(mouse.y) - window.top - window.client.top,
                        ),
                    )
                };

                self.send_message(to, WM_PARENTNOTIFY, mouse.kind, &mut Param::Value(point))
                    .await?;
                at = parent;
                top = Some(at);
            }
        }

        let mut answer = 0;
        let active = self.system().active_hwnd();

        if press
            && let Some(top) = top
            && hwnd != active
        {
            let top_hwnd = self.system().hwnd_of(top);
            let asked = signed(
                self.send_message(
                    hwnd,
                    WM_MOUSEACTIVATE,
                    top_hwnd,
                    &mut Param::Value(u32::from(mouse.kind) << 16 | u32::from(hit as u16)),
                )
                .await?,
            );

            if (0..=MA_ACTIVATEANDEAT).contains(&asked) {
                let activate = {
                    let system = self.system();

                    system.windows[top]
                        .as_ref()
                        .is_some_and(|window| !window.active)
                };

                if activate {
                    {
                        let mut system = self.system();

                        system.show(top);

                        // `WA_CLICKACTIVE` for a press in the client area,
                        // `WA_ACTIVE` for one off it (seg1 `29d9`, `377e`).
                        if let Some((_, click)) = system.pending_activation.as_mut() {
                            *click = hit == HTCLIENT;
                        }
                    }

                    self.deliver_activation(None).await?;
                    self.system().wake();
                }

                let disabled = self.system().windows[top]
                    .as_ref()
                    .is_some_and(|window| window.style & WS_DISABLED != 0);

                answer = if disabled {
                    2
                } else {
                    u8::from(asked == MA_ACTIVATEANDEAT)
                };
            } else if asked == MA_NOACTIVATEANDEAT {
                answer = 1;
            }
        }

        // The press moves no focus here: the window pressed takes it, as a
        // control does as it takes the press (`listbox.rs`, `edit.rs`), with
        // `WM_KILLFOCUS` to the window that had it and `WM_SETFOCUS` to
        // itself. COMMDLG's directory list draws its selection only while
        // it has the focus, and only those messages tell it so.
        self.send_message(
            hwnd,
            WM_SETCURSOR,
            hwnd,
            &mut Param::Value(u32::from(mouse.kind) << 16 | u32::from(hit as u16)),
        )
        .await?;

        Ok(answer)
    }

    /// The oldest input the filter takes, as USER's system queue gives it
    /// out: looked at only where the filter asks for some of what there
    /// is; each mouse message hit-tested as the look comes to it, the
    /// window asked, and the filter held to the message it then is; one
    /// taken told to the windows it is in, and the window asked to be made
    /// active and for the cursor, before it is handed over.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn take_input(
        &self,
        remove: bool,
        filter: Filter,
    ) -> Result<Option<Message>, Stop> {
        if !self.system().looks_at_input(filter) {
            return Ok(None);
        }

        let mut at = 0;

        loop {
            let Some(one) = self
                .system()
                .task
                .as_ref()
                .and_then(|task| task.queue.input.get(at).copied())
            else {
                return Ok(None);
            };
            let place = |engine: &Self| {
                engine.system().task.as_ref().and_then(|task| {
                    task.queue
                        .input
                        .iter()
                        .position(|other| other.serial == one.serial)
                })
            };

            if one.mouse.is_none() {
                let matched = {
                    let system = self.system();

                    filter.matches(&system, one.hwnd, one.message)
                };

                if !matched {
                    at += 1;
                    continue;
                }

                if remove {
                    {
                        let mut system = self.system();

                        if let Some(task) = system.task.as_mut() {
                            task.queue.input.remove(at);
                        }

                        system.note_key(&one);

                        // A move over no window, the desktop window's: the
                        // arrow.
                        system.ask_for_cursor(&one);
                    }
                }

                return Ok(Some(one));
            }

            let outcome = self.resolve_mouse(&one).await?;

            // The queue as it is after the window was asked, which may have
            // looked at it too.
            let now = place(self);

            let resolved = match outcome {
                Outcome::Elsewhere => continue,
                _ if now.is_none() => {
                    at = 0;
                    continue;
                }
                Outcome::Refused { hwnd, hit } => {
                    at = now.expect("in the queue");

                    // In its non-client form, `HTERROR` its `wParam` (seg1
                    // `2e03`).
                    let kind = one.mouse.map_or(0, |mouse| mouse.kind) - 0x160;
                    let matched = {
                        let system = self.system();

                        filter.matches(&system, hwnd, kind)
                    };

                    if !matched {
                        at += 1;
                        continue;
                    }

                    if let Some(task) = self.system().task.as_mut() {
                        task.queue.input.remove(at);
                    }

                    self.refuse_mouse(&one, hwnd, hit).await?;
                    continue;
                }
                Outcome::Resolved(resolved) => resolved,
            };

            at = now.expect("in the queue");

            let matched = {
                let system = self.system();

                filter.matches(&system, resolved.hwnd, resolved.message)
            };

            if !matched {
                at += 1;
                continue;
            }

            let made = Message {
                hwnd: resolved.hwnd,
                message: resolved.message,
                wparam: resolved.wparam,
                lparam: resolved.lparam,
                mouse: None,
                ..one
            };

            if !remove {
                return Ok(Some(made));
            }

            {
                let mut system = self.system();

                if let Some(task) = system.task.as_mut() {
                    task.queue.input.remove(at);
                }

                system.note_key(&made);
            }

            let answer = self.mouse_taken(&one, resolved).await?;
            let length = self
                .system()
                .task
                .as_ref()
                .map_or(0, |task| task.queue.input.len());

            at = at.min(length);

            // Thrown away; or looked at again, its window at the top
            // disabled as it was made active (seg1 `2f6b`).
            match answer {
                1 => {}
                2 => {
                    if let Some(task) = self.system().task.as_mut() {
                        task.queue.input.insert(at, one);
                    }
                }
                _ => return Ok(Some(made)),
            }
        }
    }
}
