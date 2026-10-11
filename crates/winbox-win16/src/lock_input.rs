//! Locking the input to one window, as a debugger does: `LockInput`, and
//! the `LockMyTask` and `EnableHardwareInput` it is built on, with KERNEL's
//! `LockCurrentTask` beneath; as winbox.js's `lock-input.ts` has them.
//! **Read out** of `USER.EXE` seg1, and **recorded** by `lockinp`.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::system::System;

const WS_CHILD: u32 = 0x4000_0000;
const WS_POPUP: u32 = 0x8000_0000;

/// What `LockInput` keeps while it has the input locked, in the 1Ch bytes
/// it takes from USER's heap (`USER.EXE` seg1 `49b9`-`4a6c`).
#[derive(Debug, Clone)]
pub struct Kept {
    focus: Option<usize>,
    active: Option<usize>,
    capture: u16,
    sys_modal: u16,
    clip: Option<[i16; 4]>,
    hardware: u16,
}

impl System {
    /// KERNEL's locked task, the running one or none (`KRNL286.EXE` seg1
    /// `79d9`-`79f0`): while one is locked, no other is switched to
    /// (`grant`). The task locked now.
    pub(crate) fn lock_current_task(&mut self, lock: u16) -> u16 {
        self.scheduler.locked = if lock != 0 { self.task_handle } else { 0 };
        self.scheduler.locked
    }

    /// The running task locked, or let go, unless `LockInput` has the
    /// input locked (`USER.EXE` seg1 `6eea`-`6f24`, the word at `102h` of
    /// USER's data): KERNEL's `LockCurrentTask`; the word at `0DEh` set, so
    /// each look of the task's is made without yielding (`look_flags`);
    /// and, locking, the input let go by whatever task held it
    /// (`6f0c`-`6f1b`).
    pub(crate) fn lock_my_task_to(&mut self, lock: u16) {
        if self.locked_input.is_some() {
            return;
        }

        self.lock_current_task(lock);
        self.lock_my_task = lock;

        if lock != 0 {
            self.input_mark = 0;
            self.input_lock = None;
        }
    }

    /// A look's flags, `PM_NOYIELD` added where the task has locked itself
    /// with `LockMyTask` (`USER.EXE` seg1 `245b`-`2462`; `gmhook`).
    pub(crate) fn look_flags(&self, flags: u16) -> u16 {
        flags | if self.lock_my_task != 0 { 2 } else { 0 }
    }

    /// The window at the top a window is in: itself, unless a child
    /// (`USER.EXE` seg2 `0ab8`).
    fn top_window_of(&self, mut index: usize) -> usize {
        while let Some(window) = self.windows[index].as_ref()
            && window.style & (WS_CHILD | WS_POPUP) == WS_CHILD
            && let Some(parent) = window.parent
        {
            index = parent;
        }

        index
    }

    /// USER's active window made another without a word to either: its
    /// caption left drawn as it was (`USER.EXE` seg1 `4a10`-`4a1a`,
    /// `4a93`-`4a9c`).
    fn make_active(&mut self, target: Option<usize>) {
        let was = self.active_top();

        if was == target {
            return;
        }

        for (index, active) in [(was, false), (target, true)] {
            if let Some(index) = index {
                let shown = self.shown_mut(index);
                let lit = shown.lit.unwrap_or(shown.active);

                shown.active = active;
                shown.lit = Some(lit);
            }
        }
    }

    /// The cursor held in a rectangle, or let go with none, as
    /// `ClipCursor` holds it.
    fn clip_cursor_to(&mut self, clip: Option<[i16; 4]>) -> Result<(), Stop> {
        self.cursor_clip = clip;
        self.raster();

        let cursor = self.cursor_of();
        let held = self.held_point(cursor);

        if held != cursor {
            self.put_cursor(held)?;
        }

        Ok(())
    }
}

/// Hardware input switched on or off, the word at `46h` of USER's segment
/// 44 exchanged for the one given (`USER.EXE` seg1 `4f36`-`4f45`): answers
/// what it was, 1 at first. While it is nought, the keyboard's and the
/// mouse's events are not put in the system queue (`4be3`;
/// `queue_input`), and are lost (`lockinp`).
pub fn enable_hardware_input(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let on = args.word(system);

    Ok(Answer::Word(std::mem::replace(
        &mut system.hardware_input,
        on,
    )))
}

/// `LockMyTask` (`System::lock_my_task_to`).
pub fn lock_my_task(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let lock = args.word(system);

    system.lock_my_task_to(lock);
    Ok(Answer::Nothing)
}

/// KERNEL's `LockCurrentTask`, answering the task locked now
/// (`System::lock_current_task`).
pub fn lock_current_task(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let lock = args.word(system);

    Ok(Answer::Word(system.lock_current_task(lock)))
}

/// The task `LockCurrentTask` locked, or nought (`KRNL286.EXE` seg1
/// `79f3`). **Recorded** by `lockinp`.
pub fn is_task_locked(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.scheduler.locked))
}

/// Locks the input to one window, or lets it go (`USER.EXE` seg1
/// `4983`-`4af8`), as `lock-input.ts` has it: nought where the handle
/// given first is not nought; to lock, where it is locked already or the
/// window is none or a child; to let go, where it is not locked.
///
/// Locking, USER locks the running task (`LockMyTask`), so no other runs;
/// then keeps, and sets, without a message to any window: the focus and
/// the active window, both the window given; the capture, let go; the
/// system-modal window, the window given; the cursor's clip, the screen;
/// and the hardware input, switched on. Letting go puts each back, and
/// lets the task go. The words of a menu's and a dialog box's loops, and
/// the flag of a box of USER's own, which USER keeps and puts back too,
/// winbox.js keeps none of; nor does it give the desktop window to the
/// window's task, as USER does as it locks (seg8 `08c4`).
pub fn lock_input(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (reserved, hwnd, lock) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.word(&system))
        };

        if reserved != 0 {
            return Ok(Answer::Word(0));
        }

        if lock == 0 {
            let Some(kept) = engine.system().locked_input.clone() else {
                return Ok(Answer::Word(0));
            };

            {
                let mut system = engine.system();
                let there = |index: Option<usize>| {
                    index.filter(|&index| system.windows.get(index).is_some_and(Option::is_some))
                };
                let (focus, active) = (there(kept.focus), there(kept.active));

                system.clip_cursor_to(kept.clip)?;
                system.focus = focus;
                system.make_active(active);
            }

            engine.set_sys_modal(kept.sys_modal).await?;

            let mut system = engine.system();

            match system.window_named(kept.capture) {
                Some(index) if system.raster() => {
                    system.capture = Some(index);
                    system.capture_kind = crate::mouse_scan::CaptureKind::Set;
                }
                _ => {
                    if system.raster() {
                        system.let_go_capture();
                    }
                }
            }

            system.hardware_input = kept.hardware;
            system.locked_input = None;
            system.lock_my_task_to(0);
            return Ok(Answer::Word(1));
        }

        let sys_modal = {
            let mut system = engine.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };

            if system.locked_input.is_some() || system.top_window_of(index) != index {
                return Ok(Answer::Word(0));
            }

            system.lock_my_task_to(1);
            system.raster();

            let capture = system
                .capture
                .and_then(|capture| system.windows[capture].as_ref())
                .map_or(0, |window| window.hwnd);
            let focus = system.focus;
            let active = system.active_top();

            system.focus = Some(index);
            system.make_active(Some(index));
            system.let_go_capture();
            system.locked_input = Some(Kept {
                focus,
                active,
                capture,
                sys_modal: 0,
                clip: None,
                hardware: 1,
            });
            system.sys_modal_window()
        };

        engine.set_sys_modal(hwnd).await?;

        let mut system = engine.system();
        let clip = system.cursor_clip;

        system.clip_cursor_to(None)?;

        let hardware = std::mem::replace(&mut system.hardware_input, 1);

        if let Some(kept) = system.locked_input.as_mut() {
            kept.sys_modal = sys_modal;
            kept.clip = clip;
            kept.hardware = hardware;
        }

        Ok(Answer::Word(1))
    })
}
