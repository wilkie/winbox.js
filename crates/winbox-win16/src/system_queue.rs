//! USER's system queue, as winbox.js's `system-queue.ts` keeps it: the
//! keyboard's and the mouse's input, one queue for every task, in the order
//! it was put in, given to a window only as a task takes it; and the hooks
//! it calls, the journal hooks, the keyboard hooks and the mouse hooks.
//!
//! **Read out** of `USER.EXE`.
//!
//! * `KEYBD_EVENT` and `MOUSE_EVENT` (seg1 `4b59`, `507a`) put each event
//!   in at the end (`4bd4`, `4d70`, `5480`): a message, `paramL` and
//!   `paramH`, the time, and the cursor. A key's message is `WM_KEYDOWN` or
//!   `WM_KEYUP`, or the system key's, as the keys held then make it; its
//!   `paramL` the virtual key and the scan code above it, its `paramH` the
//!   repeat count and 8000h for an extended key. A button's `paramL` and
//!   `paramH` are the point on the screen. The queue full, the event is
//!   lost and `DoBeep` sounds (`4d99`).
//! * A move is not put in until something else is, or a task looks
//!   (`4bf2`, `4d2d`, `833d`), and then over a move at the end of the
//!   queue: moves not yet taken become one.
//! * A look takes from the head (`2aa2`). Each event is given its window
//!   then: a key the window with the focus, or with none the active window,
//!   and then as a system key (`31a3`-`31db`); with neither, it is thrown
//!   away. The mouse is hit-tested (`2cdc`, `mouse_scan.rs`). An event for
//!   a window of another task ends the look: that task is woken to take it
//!   (`31df`, `2d2c`, `2b2d`). One the look's filter does not take is
//!   passed over, and the look goes on behind it (`3218`, `2e17`).
//! * Taken (`4e2d`), the event is handed to the journal record hooks, or
//!   told to the playback hooks as skipped; the key-state table that
//!   `GetKeyState` reads moves with it; and it leaves the queue.
//! * The keyboard hooks are called for a key after that, with `HC_ACTION`,
//!   or with `HC_NOREMOVE` for a look that leaves it (`32e5`); the mouse
//!   hooks for a button or a move before it (`2e75`). A hook that answers
//!   non-nought in AX throws the event away, taken or only looked at
//!   (`2c60`).
//! * While a journal playback hook is in, the queue is not read: the hook
//!   is asked for one event at a time (`827a`), and the keyboard and the
//!   mouse go on filling the queue for after it, all but the mouse's moves,
//!   which are lost (`50cc`).
//! * An event that is neither a key nor the mouse's -- one a playback hook
//!   plays back, or a driver puts in with `HARDWARE_EVENT` -- is the
//!   window's its extra information names, which played back is none, and
//!   so the active window's (`2b9d`-`2baa`, `2cc7`-`2cd9`); `WM_QUEUESYNC`
//!   the window its `paramL` names, or the active one (`2bb0`-`2bbe`). Its
//!   `wParam` is the extra information's high word, its `lParam` `paramH`
//!   and `paramL`. The look's filter not taking it ends the look (`2bf8`).
//!   It is handed to the hardware hooks after the journal hooks have it,
//!   `WM_QUEUESYNC` excepted (`2c0a`-`2c5b`).
//! * Where a keyboard hook is in as a key leaves the queue, taken or thrown
//!   away, the computer-based training hooks are told, `HCBT_KEYSKIPPED`
//!   (`3312`-`333b`, `2c93`-`2cb6`); where a mouse hook is in as a mouse
//!   event does, `HCBT_CLICKSKIPPED` (`2f84`-`2fa7`, `2c6c`-`2c8e`).
//!
//! **Recorded** by `sysq`, `jrnlrec`, `jrnlplay`, `inhook` and `hwhook`.

use winbox_cpu::{SP, SS};

use crate::call::Stop;
use crate::engine::Engine;
use crate::mouse_scan::{MouseInput, Outcome};
use crate::queue::{Filter, Message, WM_KEYDOWN, WM_KEYUP, WM_MOUSEMOVE, WM_SYSKEYDOWN};
use crate::system::System;

pub const WH_JOURNALRECORD: i16 = 0;
pub const WH_JOURNALPLAYBACK: i16 = 1;
pub const WH_KEYBOARD: i16 = 2;
pub const WH_CBT: i16 = 5;
pub const WH_MOUSE: i16 = 7;
pub const WH_HARDWARE: i16 = 8;

pub const HCBT_CLICKSKIPPED: i16 = 6;
pub const HCBT_KEYSKIPPED: i16 = 7;

/// What a computer-based training program plays back to know its events
/// are taken.
const WM_QUEUESYNC: u16 = 0x23;

pub const HC_ACTION: i16 = 0;
pub const HC_GETNEXT: i16 = 1;
pub const HC_SKIP: i16 = 2;
pub const HC_NOREMOVE: i16 = 3;
pub const HC_SYSMODALON: i16 = 4;
pub const HC_SYSMODALOFF: i16 = 5;

const VK_SHIFT: usize = 0x10;
const VK_CONTROL: usize = 0x11;
const VK_MENU: usize = 0x12;
const VK_ESCAPE: u16 = 0x1b;
const VK_F10: u16 = 0x79;
const WM_MBUTTONDBLCLK: u16 = 0x0209;

/// An event as `EVENTMSG` holds it (`USER.EXE` seg1 `827a`, `4e2d`): the
/// message, `paramL`, `paramH` and the time; and whether it is a key's, and
/// whether the playback hooks gave it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Event {
    pub message: u16,
    pub param_l: u16,
    pub param_h: u16,
    pub time: u32,
    pub key: bool,
    pub played: bool,
}

impl Event {
    /// As `EVENTMSG` lays it out: ten bytes.
    fn bytes(self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(10);

        bytes.extend_from_slice(&self.message.to_le_bytes());
        bytes.extend_from_slice(&self.param_l.to_le_bytes());
        bytes.extend_from_slice(&self.param_h.to_le_bytes());
        bytes.extend_from_slice(&self.time.to_le_bytes());
        bytes
    }
}

/// What a look does with one event.
enum Considered {
    /// The message it is, handed over.
    Taken(Message),
    /// Not the filter's: passed over.
    Skip,
    /// Another task's: the look ends.
    Stop,
    /// Thrown away; the look goes on.
    Gone,
    /// To be looked at again.
    Again(Message),
    /// Taken meanwhile by a look the window made as it was asked.
    Lost,
}

/// What an input message was put in as. A key's message is as it was put
/// in, before it was made a system key for want of the focus (`jrnlrec`).
fn event_of(one: &Message) -> Event {
    if let Some(event) = one.event {
        return event;
    }

    if let Some(mouse) = one.mouse {
        return Event {
            message: mouse.kind,
            param_l: mouse.x as u16,
            param_h: mouse.y as u16,
            time: one.time,
            key: false,
            played: false,
        };
    }

    // A move made over no window, the desktop window's: the point on the
    // screen.
    Event {
        message: one.message,
        param_l: one.lparam as u16,
        param_h: (one.lparam >> 16) as u16,
        time: one.time,
        key: false,
        played: false,
    }
}

fn is_key(one: &Message) -> bool {
    one.event.is_some_and(|event| event.key)
}

fn is_played(one: &Message) -> bool {
    one.event.is_some_and(|event| event.played)
}

/// Whether an event is neither a key nor the mouse's: one played back
/// (`input_from`).
fn is_hardware(one: &Message) -> bool {
    one.mouse.is_none() && one.event.is_some_and(|event| !event.key)
}

/// The `MOUSEHOOKSTRUCT` the mouse hooks were handed for an event, as they
/// left it, and the message: what the computer-based training hooks are
/// told as the event leaves the queue (`Engine::click_skipped`).
type Skipped = Option<(u16, Vec<u8>)>;

impl System {
    /// Whether a journal playback hook is in: then the queue is not read.
    pub(crate) fn playing(&self) -> bool {
        self.has_hooks(WH_JOURNALPLAYBACK)
    }

    /// How long until the playback hooks' wait is over, if one is kept.
    pub(crate) fn playback_wait(&self) -> Option<f64> {
        if !self.playing() {
            return None;
        }

        self.playback_due
            .map(|due| due - self.clock.now(self.instructions))
    }

    /// The window made system-modal, if it is still there.
    pub(crate) fn sys_modal_window(&self) -> u16 {
        if self.sys_modal != 0 && self.window_named(self.sys_modal).is_some() {
            self.sys_modal
        } else {
            0
        }
    }

    /// Input put at the end of the system queue (`USER.EXE` seg1 `4c78`),
    /// and the task that would take it woken. A move put in over a move at
    /// the end of the queue, not yet taken, takes its place (`4d2d`): shown
    /// under the cursor just after it moved there, a window is the only one
    /// to hear of it (`setcur`).
    pub(crate) fn queue_input(&mut self, slot: Option<usize>, mut made: Message) {
        // Hardware input switched off with `EnableHardwareInput`: nothing
        // is put in (`USER.EXE` seg1 `4be3`; `lockinp`).
        if self.hardware_input == 0 {
            return;
        }

        let moves = |one: &Message| {
            !is_key(one) && one.mouse.map_or(one.message, |mouse| mouse.kind) == WM_MOUSEMOVE
        };

        // A press of a key the press at the end of the queue was of -- the
        // same virtual key and scan code, extended or not alike, and neither
        // a system key -- adds one to that one's repeat count rather than
        // going in (seg1 `4c54`-`4c71`; `keyrep`). The mouse's last move is
        // not yet in the queue then, but due (`4c78`): a move at the end,
        // not yet taken, is passed over to the press before it.
        if let Some(event) = made
            .event
            .filter(|event| event.key && event.message == WM_KEYDOWN)
        {
            let back = if self.input.back().is_some_and(moves) {
                2
            } else {
                1
            };
            let at = self.input.len().checked_sub(back);

            if let Some(pressed) = at.and_then(|at| self.input.get_mut(at))
                && let Some(before) = pressed.event.as_mut()
                && before.key
                && !before.played
                && before.message == WM_KEYDOWN
                && before.param_l == event.param_l
                && before.param_h & 0x8000 == event.param_h & 0x8000
            {
                before.param_h =
                    (before.param_h & 0x8000) | (before.param_h.wrapping_add(1) & 0x7fff);
                pressed.lparam =
                    (pressed.lparam & 0xffff_0000) | (pressed.lparam.wrapping_add(1) & 0xffff);

                if let Some(slot) = slot.or_else(|| self.current_slot()) {
                    self.signal_slot(slot);
                }

                return;
            }
        }

        self.message_serials += 1;
        made.serial = self.message_serials;

        if moves(&made) && self.input.back().is_some_and(moves) {
            self.input.pop_back();
        }

        self.input.push_back(made);

        if let Some(slot) = slot.or_else(|| self.current_slot()) {
            if let Some(queue) = self.queue_of(slot) {
                queue.changes |= crate::queue::queue_kind(made.message, true);
            }

            self.signal_slot(slot);
        }
    }

    /// The window a key is for, as a look takes it (`USER.EXE` seg1
    /// `3188`-`31db`): the window with the focus; with none, the active
    /// window, and the key then a system key. F10 is always one (`3188`),
    /// and Escape with Control down (`3192`). None for neither: the key is
    /// thrown away (`31bb`).
    fn key_target(&self, one: &Message) -> Option<(u16, u16)> {
        let mut message = one.message;

        if one.wparam & 0xff == VK_F10 {
            message |= 4;
        }

        // Escape with Control down, as the key-state table has it (`3192`):
        // its press the queue takes for the Task List (`task_list.rs`), and
        // its release reaches the window a system key (`tasklist`).
        if one.wparam & 0xff == VK_ESCAPE && self.user_state.key_states[VK_CONTROL] & 0x80 != 0 {
            message |= 4;
        }

        let focus = self.focus.filter(|&index| self.windows[index].is_some());
        let index = focus.or_else(|| self.active_window())?;

        if focus.is_none() && (WM_KEYDOWN..=WM_KEYUP + 2).contains(&message) {
            message += 4;
        }

        let hwnd = self.windows[index].as_ref()?.hwnd;

        Some((hwnd, message))
    }

    /// A key's `lParam` as a look makes it from the event (`USER.EXE` seg1
    /// `3263`-`32db`): the repeat count; the scan code; 100h above it for
    /// an extended key; Alt down, as the key-state table says once the key
    /// has moved it; the key down before, as the table said before; and
    /// 8000h for a release. A key from the keyboard keeps what was put in
    /// with it.
    fn key_lparam(&self, one: &Message, was_down: bool) -> u32 {
        let Some(event) = one.event.filter(|event| event.played) else {
            return one.lparam;
        };
        let alt = self.user_state.key_states[VK_MENU] & 0x80 != 0;
        let up = one.message & 1 != 0;

        u32::from(event.param_h & 0x7fff)
            | u32::from(event.param_l >> 8) << 16
            | if event.param_h & 0x8000 != 0 {
                1 << 24
            } else {
                0
            }
            | if alt { 1 << 29 } else { 0 }
            | if was_down { 1 << 30 } else { 0 }
            | if up { 1 << 31 } else { 0 }
    }

    /// The `MK_` flags a mouse message played back carries, as a look makes
    /// them from the key-state table once the message has moved it
    /// (`USER.EXE` seg1 `2fb1`-`2ff5`): the buttons, Shift and Control.
    fn button_keys(&self, message: u16) -> u16 {
        let table = &self.user_state.key_states;
        let held = |key: usize| table[key] & 0x80 != 0;
        let mut keys = [
            (0x01, 0x01),
            (0x02, 0x02),
            (0x04, 0x10),
            (VK_SHIFT, 0x04),
            (VK_CONTROL, 0x08),
        ]
        .iter()
        .filter(|&&(key, _)| held(key))
        .fold(0, |keys, &(_, flag)| keys | flag);

        match message {
            0x201 => keys |= 0x01,
            0x202 => keys &= !0x01,
            0x204 => keys |= 0x02,
            0x205 => keys &= !0x02,
            0x207 => keys |= 0x10,
            0x208 => keys &= !0x10,
            _ => {}
        }

        keys
    }

    /// An event made input, as a look takes it: a key's message with its
    /// virtual key, which the look gives a window; the mouse's put in at
    /// its point, to be hit-tested.
    fn input_from(&self, event: Event) -> Message {
        let cursor = self.cursor_of();
        let mut made = Message {
            hwnd: 0,
            message: event.message,
            wparam: 0,
            lparam: 0,
            time: event.time,
            pt: cursor,
            serial: 0,
            mouse: None,
            event: Some(event),
        };

        if (WM_KEYDOWN..=WM_SYSKEYDOWN + 1).contains(&event.message) {
            made.event = Some(Event { key: true, ..event });
            made.wparam = event.param_l & 0xff;
            return made;
        }

        if (WM_MOUSEMOVE..=WM_MBUTTONDBLCLK).contains(&event.message) {
            let (x, y) = (event.param_l as i16, event.param_h as i16);
            let keys = self.button_keys(event.message);

            made.wparam = keys;
            made.lparam = u32::from(y as u16) << 16 | u32::from(x as u16);
            made.pt = (x, y);
            made.mouse = Some(MouseInput {
                x,
                y,
                kind: event.message,
                keys,
            });
            return made;
        }

        // Anything else is given its window as a look comes to it
        // (`hardware_target`); its `wParam` is the high word of its extra
        // information, which played back is nought (`2cd3`, `82e3`-`82e8`),
        // and its `lParam` `paramH` and `paramL` (`2bc6`-`2bcf`).
        made.lparam = u32::from(event.param_h) << 16 | u32::from(event.param_l);
        made
    }

    /// The window an event that is neither a key nor the mouse's is for,
    /// as a look comes to it: `WM_QUEUESYNC`'s, the window its `paramL`
    /// names, or the active window (`USER.EXE` seg1 `2bb0`-`2bbe`); any
    /// other's, the window its extra information names -- the focus for 1
    /// -- which played back is none, and so the active window
    /// (`2b9d`-`2baa`, `2cc7`-`2cd0`).
    fn hardware_target(&self, one: &Message) -> u16 {
        let active = self.active_hwnd();

        if one.message == WM_QUEUESYNC && one.lparam & 0xffff != 0 {
            return one.lparam as u16;
        }

        active
    }

    /// What a key played back types, for `TranslateMessage`, which hands
    /// the keyboard driver's `ToAscii` the key-state table (`USER.EXE` seg1
    /// `26b6`-`26d9`): the US keyboard's, as `keybd_event` has it -- a
    /// letter shifted or not, a control character with Control down, the
    /// digits, Space and the keys that type a control character.
    fn typed_played(&mut self, message: &Message) {
        if message.message != WM_KEYDOWN && message.message != WM_SYSKEYDOWN {
            return;
        }

        let table = &self.user_state.key_states;
        let held = |key: usize| table[key] & 0x80 != 0;
        let key = message.wparam & 0xff;
        let typed = match key {
            0x41..=0x5a if held(VK_CONTROL) => Some(key as u8 & 0x1f),
            0x41..=0x5a if held(VK_SHIFT) => Some(key as u8),
            0x41..=0x5a => Some(key as u8 + 0x20),
            0x30..=0x39 | 0x20 | 0x08 | 0x09 | 0x0d | 0x1b => Some(key as u8),
            0xbd if held(VK_SHIFT) => Some(b'_'),
            0xbd => Some(b'-'),
            _ => None,
        };

        match typed {
            Some(typed) => {
                self.user_state.typed.insert(key, typed);
            }
            None => {
                self.user_state.typed.remove(&key);
            }
        }
    }

    /// Whether a window is another task's: a look that comes to its event
    /// ends there, and that task is woken to take it.
    fn elsewhere(&mut self, hwnd: u16) -> bool {
        if self.mine(hwnd) {
            return false;
        }

        if let Some(slot) = self.window_slot(hwnd).or_else(|| self.lone_slot()) {
            self.signal_slot(slot);
        }

        true
    }
}

impl Engine {
    /// A chain called with a structure of USER's for its `LPARAM`, laid on
    /// the stack below the caller's, as USER passes one of its own frame
    /// (`USER.EXE` seg1 `2c4d`, `2eb6`, `82d5`): what the hooks answered,
    /// and the structure as they left it.
    async fn call_hooks_with(
        &self,
        kind: i16,
        code: i16,
        wparam: u16,
        structure: &[u8],
    ) -> Result<(u32, Vec<u8>), Stop> {
        let (sp, at, far) = {
            let mut system = self.system();
            let cpu = &mut system.cpu;
            let sp = cpu.regs[SP];
            let stack = cpu.segments[SS].base;
            let selector = cpu.segments[SS].selector;

            cpu.regs[SP] = sp.wrapping_sub((structure.len() as u16 + 1) & !1);

            let at = cpu.regs[SP];

            cpu.bus.write(stack + u32::from(at), structure);
            (sp, at, u32::from(selector) << 16 | u32::from(at))
        };
        let answer = self.call_hooks(kind, code, wparam, far).await;
        let mut system = self.system();
        let cpu = &mut system.cpu;
        let stack = cpu.segments[SS].base;
        let bytes = cpu.bus.read(stack + u32::from(at), structure.len());

        cpu.regs[SP] = sp;
        Ok((answer?, bytes))
    }

    /// An event taken from the queue (`USER.EXE` seg1 `4e2d`): told to the
    /// playback hooks as skipped, a move played back putting the cursor at
    /// its point (`4e5c`); or else handed to the record hooks with
    /// `HC_ACTION`. Not while a window is system-modal (`4e42`).
    async fn event_taken(&self, one: &Message) -> Result<(), Stop> {
        let (modal, recording) = {
            let system = self.system();

            (
                system.sys_modal_window() != 0,
                system.has_hooks(WH_JOURNALRECORD),
            )
        };

        if modal {
            return Ok(());
        }

        let event = event_of(one);

        if event.played {
            self.call_hooks(WH_JOURNALPLAYBACK, HC_SKIP, 0, 0).await?;

            if event.message == WM_MOUSEMOVE {
                self.system().cursor_pos = Some((event.param_l as i16, event.param_h as i16));
            }

            return Ok(());
        }

        if recording {
            self.call_hooks_with(WH_JOURNALRECORD, HC_ACTION, 0, &event.bytes())
                .await?;
        }

        Ok(())
    }

    /// The next event from the playback hooks, asked for with `HC_GETNEXT`
    /// and an `EVENTMSG` whose time is now (`USER.EXE` seg1 `827a`): the
    /// event, or none where the hook asks for a wait first. The wait is
    /// kept, and the look's task woken when it has passed (`72c6`,
    /// `7336`); asked again, the hook answers what is left of it.
    async fn played_event(&self) -> Result<Option<Message>, Stop> {
        let now = {
            let system = self.system();

            system.clock.now(system.instructions)
        };
        let asked = Event {
            message: 0,
            param_l: 0,
            param_h: 0,
            time: now as u32,
            key: false,
            played: true,
        };
        let (answer, bytes) = self
            .call_hooks_with(WH_JOURNALPLAYBACK, HC_GETNEXT, 0, &asked.bytes())
            .await?;
        let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
        let event = Event {
            message: word(0),
            param_l: word(2),
            param_h: word(4),
            time: u32::from(word(6)) | u32::from(word(8)) << 16,
            key: false,
            played: true,
        };
        let mut system = self.system();

        if answer != 0 {
            system.playback_due = Some(now + f64::from(answer));
            return Ok(None);
        }

        system.playback_due = None;
        Ok(Some(system.input_from(event)))
    }

    /// The keyboard hooks asked about a key a look has come to (`USER.EXE`
    /// seg1 `32e5`, `8112`): `HC_ACTION` as it is taken, `HC_NOREMOVE` as
    /// it is only looked at, the virtual key, and the `lParam` it goes
    /// with. Whether a hook answered non-nought in AX: the key is thrown
    /// away.
    async fn keyboard_hook(&self, remove: bool, key: u16, lparam: u32) -> Result<bool, Stop> {
        {
            let system = self.system();

            if system.sys_modal_window() != 0 || !system.has_hooks(WH_KEYBOARD) {
                return Ok(false);
            }
        }

        let code = if remove { HC_ACTION } else { HC_NOREMOVE };

        Ok(self.call_hooks(WH_KEYBOARD, code, key, lparam).await? & 0xffff != 0)
    }

    /// The mouse hooks asked about a mouse message a look has come to
    /// (`USER.EXE` seg1 `2e75`-`2ebe`): `HC_ACTION` or `HC_NOREMOVE`, the
    /// message as it is then, and a `MOUSEHOOKSTRUCT` -- the point on the
    /// screen, the window, the hit-test code and the extra information.
    /// Whether a hook answered non-nought in AX: the message is thrown
    /// away. With a mouse hook in, the computer-based training hooks are
    /// told as the event leaves the queue, a window system-modal or not
    /// (seg1 `2e80`): what they are told, the structure as the hooks left
    /// it (`click_skipped`).
    #[allow(clippy::too_many_arguments)]
    async fn mouse_hook(
        &self,
        remove: bool,
        message: u16,
        x: i16,
        y: i16,
        hwnd: u16,
        hit: i16,
    ) -> Result<(bool, Skipped), Stop> {
        let modal = {
            let system = self.system();

            if !system.has_hooks(WH_MOUSE) {
                return Ok((false, None));
            }

            system.sys_modal_window() != 0
        };

        let mut structure = Vec::with_capacity(12);

        structure.extend_from_slice(&x.to_le_bytes());
        structure.extend_from_slice(&y.to_le_bytes());
        structure.extend_from_slice(&hwnd.to_le_bytes());
        structure.extend_from_slice(&hit.to_le_bytes());
        structure.extend_from_slice(&0u32.to_le_bytes());

        if modal {
            return Ok((false, Some((message, structure))));
        }

        let code = if remove { HC_ACTION } else { HC_NOREMOVE };
        let (answer, left) = self
            .call_hooks_with(WH_MOUSE, code, message, &structure)
            .await?;

        Ok((answer & 0xffff != 0, Some((message, left))))
    }

    /// The computer-based training hooks told a mouse event has left the
    /// queue where a mouse hook was in as the look came to it
    /// (`mouse_hook`): `HCBT_CLICKSKIPPED`, the message, and the
    /// `MOUSEHOOKSTRUCT` the mouse hooks were handed, as they left it
    /// (`USER.EXE` seg1 `2f8a`-`2fa7`, `2c6c`-`2c8e`; `hwhook`).
    async fn click_skipped(&self, skipped: Skipped) -> Result<(), Stop> {
        if let Some((message, structure)) = skipped
            && self.system().has_hooks(WH_CBT)
        {
            self.call_hooks_with(WH_CBT, HCBT_CLICKSKIPPED, message, &structure)
                .await?;
        }

        Ok(())
    }

    /// The computer-based training hooks told a key has left the queue
    /// where a keyboard hook is in: `HCBT_KEYSKIPPED`, the virtual key and
    /// the key's `lParam` (`USER.EXE` seg1 `3318`-`3336`, `2c93`-`2cb1`;
    /// `hwhook`).
    async fn key_skipped(&self, key: u16, lparam: u32) -> Result<(), Stop> {
        if self.system().has_hooks(WH_CBT) {
            self.call_hooks(WH_CBT, HCBT_KEYSKIPPED, key, lparam)
                .await?;
        }

        Ok(())
    }

    /// The hardware hooks asked about an event that is neither a key nor
    /// the mouse's, `WM_QUEUESYNC` excepted (`USER.EXE` seg1 `2c18`-`2c5b`):
    /// `HC_ACTION` as it is taken, `HC_NOREMOVE` as it is only looked at,
    /// nought, and a `HARDWAREHOOKSTRUCT` -- the window, the message, its
    /// `wParam` and `lParam`. Whether a hook answered non-nought in AX: the
    /// event is thrown away (`2c60`; `hwhook`).
    async fn hardware_hook(&self, remove: bool, made: &Message) -> Result<bool, Stop> {
        if made.message == WM_QUEUESYNC || !self.system().has_hooks(WH_HARDWARE) {
            return Ok(false);
        }

        let mut structure = Vec::with_capacity(10);

        structure.extend_from_slice(&made.hwnd.to_le_bytes());
        structure.extend_from_slice(&made.message.to_le_bytes());
        structure.extend_from_slice(&made.wparam.to_le_bytes());
        structure.extend_from_slice(&made.lparam.to_le_bytes());

        let code = if remove { HC_ACTION } else { HC_NOREMOVE };
        let (answer, _) = self
            .call_hooks_with(WH_HARDWARE, code, 0, &structure)
            .await?;

        Ok(answer & 0xffff != 0)
    }

    /// An event leaving the queue, as it is taken or thrown away (seg1
    /// `4e2d`): handed to the journal hooks, and the key-state table moved.
    pub(crate) async fn leave(&self, one: &Message, made: &Message) -> Result<(), Stop> {
        self.system()
            .input
            .retain(|each| is_played(one) || each.serial != one.serial);
        self.event_taken(one).await?;

        let mut system = self.system();

        match one.mouse {
            Some(mouse) => system.note_button(mouse.kind),
            None => system.note_key(made),
        }

        Ok(())
    }

    /// Whether an event is still in the queue, as a look left it.
    fn queued(&self, one: &Message) -> bool {
        is_played(one)
            || self
                .system()
                .input
                .iter()
                .any(|each| each.serial == one.serial)
    }

    /// What a look does with one event (`take_input`).
    #[allow(clippy::too_many_lines)]
    async fn consider(
        &self,
        one: Message,
        remove: bool,
        filter: Filter,
    ) -> Result<Considered, Stop> {
        // Input noted at the event's time, as the look reads it (`USER.EXE`
        // seg1 `2b7f`, `3090`, `317b`; `screen_saver.rs`).
        self.system().note_input(Some(one.time));

        if is_key(&one) {
            // Control and Escape, Print Screen and the hot keys, taken by
            // the queue for itself as the look comes to them
            // (`task_list.rs`).
            if self.queue_takes_key(&one).await? {
                return Ok(Considered::Gone);
            }

            let target = self.system().key_target(&one);
            let Some((hwnd, message)) = target else {
                self.leave(&one, &one).await?;
                return Ok(Considered::Gone);
            };

            {
                let mut system = self.system();

                // A window outside the system-modal window's: passed over,
                // left for after it (seg1 `3204`-`3235`; `keyrep`).
                let sys_modal = system.sys_modal_window();

                if sys_modal != 0 && hwnd != sys_modal && !system.is_child_of(sys_modal, hwnd) {
                    return Ok(Considered::Skip);
                }

                if system.elsewhere(hwnd) {
                    return Ok(Considered::Stop);
                }

                if !filter.matches(&system, hwnd, message) {
                    return Ok(Considered::Skip);
                }
            }

            let key = one.wparam & 0xff;
            let was_down = self.system().user_state.key_states[usize::from(key)] & 0x80 != 0;
            let mut made = Message {
                hwnd,
                message,
                serial: 0,
                mouse: None,
                event: None,
                ..one
            };

            if remove {
                self.leave(&one, &made).await?;
            }

            made.lparam = self.system().key_lparam(&one, was_down);

            // A keyboard hook in, the computer-based training hooks are told
            // as the key leaves the queue, taken or thrown away (seg1
            // `32f0`, `3312`-`333b`, `2c93`-`2cb6`; not while a box of
            // USER's own is up, `32de`, which winbox.js does not keep).
            let hooked = self.system().has_hooks(WH_KEYBOARD);

            if self.keyboard_hook(remove, key, made.lparam).await? {
                if !remove {
                    self.leave(&one, &made).await?;
                }

                if hooked {
                    self.key_skipped(key, made.lparam).await?;
                }

                return Ok(Considered::Gone);
            }

            if remove && hooked {
                self.key_skipped(key, made.lparam).await?;
            }

            if remove && is_played(&one) {
                self.system().typed_played(&made);
            }

            return Ok(Considered::Taken(made));
        }

        // Neither a key nor the mouse's: the window it is for found now; the
        // filter not taking it ends the look (seg1 `2bc6`-`2bff`); taken, it
        // is handed to the journal hooks and then the hardware hooks, which
        // may throw it away (`2c0a`-`2c60`).
        if is_hardware(&one) {
            let made = {
                let mut system = self.system();
                let hwnd = system.hardware_target(&one);

                if system.elsewhere(hwnd) || !filter.matches(&system, hwnd, one.message) {
                    return Ok(Considered::Stop);
                }

                Message {
                    hwnd,
                    serial: 0,
                    event: None,
                    ..one
                }
            };

            if remove {
                self.leave(&one, &one).await?;
            }

            if self.hardware_hook(remove, &made).await? {
                if !remove {
                    self.leave(&one, &one).await?;
                }

                return Ok(Considered::Gone);
            }

            return Ok(Considered::Taken(made));
        }

        if one.mouse.is_none() {
            {
                let mut system = self.system();

                if system.elsewhere(one.hwnd) {
                    return Ok(Considered::Stop);
                }

                if !filter.matches(&system, one.hwnd, one.message) {
                    return Ok(Considered::Skip);
                }
            }

            if remove {
                self.leave(&one, &one).await?;

                // A move over no window, the desktop window's: the arrow.
                self.system().ask_for_cursor(&one);
            }

            return Ok(Considered::Taken(Message {
                serial: 0,
                event: None,
                ..one
            }));
        }

        let outcome = self.resolve_mouse(&one).await?;

        if !self.queued(&one) {
            return Ok(Considered::Lost);
        }

        let mouse = one.mouse.expect("the mouse's");
        let resolved = match outcome {
            Outcome::Again(made) => return Ok(Considered::Again(made)),
            Outcome::Gone => return Ok(Considered::Gone),
            Outcome::Elsewhere(slot) => {
                if let Some(slot) = slot {
                    self.system().signal_slot(slot);
                }

                return Ok(Considered::Stop);
            }
            Outcome::Refused { hwnd, hit } => {
                // In its non-client form, `HTERROR` its `wParam` (seg1
                // `2e03`).
                let kind = mouse.kind - 0x160;

                if !filter.matches(&self.system(), hwnd, kind) {
                    return Ok(Considered::Skip);
                }

                let (_, skipped) = self
                    .mouse_hook(remove, kind, mouse.x, mouse.y, hwnd, hit)
                    .await?;
                self.leave(&one, &one).await?;
                self.refuse_mouse(&one, hwnd, hit).await?;
                self.click_skipped(skipped).await?;
                return Ok(Considered::Gone);
            }
            // A button over no window, the desktop window's: handed to the
            // hooks and taken as any, the desktop not made active (seg1
            // `2998`).
            Outcome::Desktop {
                hwnd,
                message,
                wparam,
                lparam,
                clicks,
            } => {
                if !filter.matches(&self.system(), hwnd, message) {
                    return Ok(Considered::Skip);
                }

                let (eaten, skipped) = self
                    .mouse_hook(remove, message, mouse.x, mouse.y, hwnd, 1)
                    .await?;

                if eaten {
                    self.leave(&one, &one).await?;
                    self.click_skipped(skipped).await?;
                    return Ok(Considered::Gone);
                }

                if remove {
                    self.system().note_click(&one, hwnd, clicks);
                    self.leave(&one, &one).await?;
                    self.click_skipped(skipped).await?;
                }

                return Ok(Considered::Taken(Message {
                    hwnd,
                    message,
                    wparam,
                    lparam,
                    serial: 0,
                    mouse: None,
                    event: None,
                    ..one
                }));
            }
            Outcome::Resolved(resolved) => resolved,
        };

        if !filter.matches(&self.system(), resolved.hwnd, resolved.message) {
            return Ok(Considered::Skip);
        }

        let (eaten, skipped) = self
            .mouse_hook(
                remove,
                resolved.message,
                mouse.x,
                mouse.y,
                resolved.hwnd,
                resolved.hit,
            )
            .await?;

        if eaten {
            self.leave(&one, &one).await?;
            self.click_skipped(skipped).await?;
            return Ok(Considered::Gone);
        }

        let made = Message {
            hwnd: resolved.hwnd,
            message: resolved.message,
            wparam: resolved.wparam,
            lparam: resolved.lparam,
            serial: 0,
            mouse: None,
            event: None,
            ..one
        };

        if !remove {
            return Ok(Considered::Taken(made));
        }

        let at = {
            let mut system = self.system();
            let at = system
                .input
                .iter()
                .position(|each| each.serial == one.serial);

            if let Some(at) = at
                && !is_played(&one)
            {
                system.input.remove(at);
            }

            system.note_button(mouse.kind);
            system.note_click(&one, resolved.hwnd, resolved.clicks);
            at
        };
        let answer = self.mouse_taken(&one, resolved).await?;

        // Looked at again, its window at the top disabled as it was made
        // active (seg1 `2f6b`): back where it was, not yet taken.
        if answer == 2 {
            if !is_played(&one) {
                let mut system = self.system();
                let place = at.unwrap_or(0).min(system.input.len());

                system.input.insert(place, one);
            }

            return Ok(Considered::Again(one));
        }

        self.event_taken(&one).await?;

        // Taken or thrown away, as the window asked (seg1 `2f77`-`2fa7`,
        // `2c60`).
        self.click_skipped(skipped).await?;

        // Thrown away.
        if answer == 1 {
            return Ok(Considered::Gone);
        }

        Ok(Considered::Taken(made))
    }

    /// The oldest input the filter takes, as USER's system queue gives it
    /// out: looked at only where the filter asks for some of what there
    /// is; each event given its window as the look comes to it -- a key the
    /// window with the focus then, the mouse hit-tested, the window asked
    /// -- and the filter held to the message it then is; one taken handed
    /// to the journal hooks and told to the windows it is in, and the
    /// window asked to be made active and for the cursor, before it is
    /// handed over. An event for another task's window ends the look, and
    /// that task is woken to take it. While a journal playback hook plays,
    /// the events are the hook's, one at a time.
    pub(crate) async fn take_input(
        &self,
        remove: bool,
        filter: Filter,
    ) -> Result<Option<Message>, Stop> {
        if self.system().task.is_none() {
            return Ok(None);
        }

        let taken = self.read_input(remove, filter).await?;
        let mut system = self.system();

        if taken.is_none() {
            if system.input_lock == Some(system.task_handle) {
                system.input_lock = None;
            }

            return Ok(None);
        }

        // Handed over, taken or only looked at, the input is what the task
        // took last, and the last marked for it (seg1 `303f`, `3058`).
        system.input_mark = crate::queue::INPUT_MARK;

        if let Some(task) = system.task.as_mut() {
            task.queue.taken_mark = crate::queue::INPUT_MARK;
        }

        Ok(taken)
    }

    async fn read_input(&self, remove: bool, filter: Filter) -> Result<Option<Message>, Stop> {
        // While a journal playback hook plays, the hook's events, one at a
        // time (seg1 `827a`): one passed over ends the look.
        if self.system().playing() {
            if crate::mouse_scan::filter_kinds(filter) == 0 || !self.system().holds_input(remove) {
                return Ok(None);
            }

            loop {
                let Some(mut one) = self.played_event().await? else {
                    return Ok(None);
                };

                loop {
                    match Box::pin(self.consider(one, remove, filter)).await? {
                        Considered::Taken(made) => return Ok(Some(made)),
                        Considered::Again(made) => one = made,
                        Considered::Gone => break,
                        _ => return Ok(None),
                    }
                }

                // Thrown away, the look goes on: with the hook taken out as
                // it was told the event was skipped, at the queue (seg1
                // `2cbb`, `829a`; `hwhook`).
                if !self.system().playing() {
                    break;
                }
            }
        }

        if !self.system().looks_at_input(filter) || !self.system().holds_input(remove) {
            return Ok(None);
        }

        let mut at = 0;

        loop {
            let Some(mut one) = self.system().input.get(at).copied() else {
                return Ok(None);
            };

            loop {
                match Box::pin(self.consider(one, remove, filter)).await? {
                    Considered::Taken(made) => return Ok(Some(made)),
                    Considered::Skip => {
                        at = self
                            .system()
                            .input
                            .iter()
                            .position(|each| each.serial == one.serial)
                            .map_or(at, |now| now + 1);
                        break;
                    }
                    Considered::Stop => return Ok(None),
                    // Thrown away: the look goes on from where it was.
                    Considered::Gone => {
                        let system = self.system();

                        at = system
                            .input
                            .iter()
                            .position(|each| each.serial == one.serial)
                            .unwrap_or_else(|| at.min(system.input.len()));
                        break;
                    }
                    // To be looked at again, where it is.
                    Considered::Again(made) => one = made,
                    Considered::Lost => {
                        at = 0;
                        break;
                    }
                }
            }
        }
    }
}

impl System {
    /// One task at a time reads the input (seg1 `2ab9`-`2ae0`): the first
    /// to come to it holds it, at `0F4h`, and another's look finds none
    /// meanwhile; the look that holds it notes whether it only looks
    /// (`106h`). A look of the holder's that finds nothing for it lets it
    /// go (`2b06`-`2b15`; `take_input`), and the task whose event ended it
    /// is woken (`elsewhere`). Recorded by `inlock`: a program yielding as
    /// it handles a click keeps the key after it from the program with the
    /// focus until it looks again. Whether this task holds it now.
    pub(crate) fn holds_input(&mut self, remove: bool) -> bool {
        let me = self.task_handle;

        if let Some(lock) = self.input_lock
            && lock != me
            && self
                .slot_of(lock)
                .is_some_and(|slot| !self.scheduler.slots[slot].ended)
        {
            return false;
        }

        self.input_lock = Some(me);
        self.input_first = !remove;
        true
    }

    /// Whether any hook of a kind is in.
    pub(crate) fn has_hooks(&self, kind: i16) -> bool {
        self.hooks
            .iter()
            .any(|(each, chain)| *each == kind && !chain.is_empty())
    }
}
