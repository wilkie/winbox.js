//! USER's calls that hand a program's procedure each window in turn, and
//! the last active pop-up, as winbox.js's `enumerate.ts` has them. **Read
//! out of `USER.EXE`** and **recorded** by `minis3`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{AX, DS, ES, SS};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::system::System;

impl System {
    /// The windows at the top, front to back.
    fn top_level_hwnds(&self) -> Vec<u16> {
        self.z_order
            .iter()
            .filter_map(|&index| self.windows[index].as_ref())
            .filter(|window| {
                window.parent.is_none() && window.hwnd != 0 && window.title_of.is_none()
            })
            .map(|window| window.hwnd)
            .collect()
    }

    /// A window's children, and theirs, depth first: each, then its own,
    /// then the next.
    fn descendants(&self, index: usize) -> Vec<u16> {
        let mut out = Vec::new();

        for &child in &self.z_order {
            let Some(window) = self.windows[child].as_ref() else {
                continue;
            };

            if window.parent == Some(index) && window.hwnd != 0 && window.title_of.is_none() {
                out.push(window.hwnd);
                out.extend(self.descendants(child));
            }
        }

        out
    }

    /// The window that owns one: the parent a pop-up was made with.
    fn owner_of(&self, hwnd: u16) -> u16 {
        let Some(window) = self
            .window_named(hwnd)
            .and_then(|index| self.windows[index].as_ref())
        else {
            return 0;
        };

        if window.parent.is_some() {
            return 0;
        }

        let owner = window.parent_given;

        if owner != 0 && self.handles.resolve(owner).is_some() {
            owner
        } else {
            0
        }
    }

    /// A window made active: the root of its owners remembers it (seg1
    /// `3740`).
    pub fn note_active_popup(&mut self, index: usize) {
        let hwnd = self.windows[index].as_ref().map_or(0, |window| window.hwnd);

        if hwnd == 0 {
            return;
        }

        let mut root = hwnd;
        let mut owner = self.owner_of(root);

        while owner != 0 {
            root = owner;
            owner = self.owner_of(owner);
        }

        if let Some(window) = self
            .window_named(root)
            .and_then(|at| self.windows[at].as_mut())
        {
            window.last_active_popup = hwnd;
        }
    }

    /// A window destroyed: its owner, if it remembers it, remembers itself
    /// (seg8 `0caa`).
    pub fn forget_active_popup(&mut self, hwnd: u16) {
        let owner = self.owner_of(hwnd);

        if let Some(window) = self
            .window_named(owner)
            .and_then(|at| self.windows[at].as_mut())
            && window.last_active_popup == hwnd
        {
            window.last_active_popup = owner;
        }
    }
}

impl Engine {
    /// A program's procedure called with a window and `lParam`, AX, DS and
    /// ES the stack's, as USER calls one (seg1 `6525`); `ax` where it sets
    /// AX its own way. Its answer's low word.
    async fn call_back(
        &self,
        proc: u32,
        hwnd: u16,
        lparam: u32,
        ax: Option<u16>,
    ) -> Result<u16, Stop> {
        let stack = self.system().cpu.segments[SS].selector;
        let args = [GuestArg::Word(hwnd), GuestArg::Long(lparam)];
        let registers = [
            Register::Word(AX, ax.unwrap_or(stack)),
            Register::Segment(DS, stack),
            Register::Segment(ES, stack),
        ];

        Ok(self.call_with(proc, &args, &registers).await?.0 as u16)
    }

    /// Each of a list of windows handed to a procedure, until it answers
    /// nought (seg1 `6556`): the list taken first, a window destroyed
    /// meanwhile passed over, and the procedure's last answer answered, 1
    /// to start with. `task` passes over another task's windows, answering
    /// 1, and calls with AX 1 (seg1 `1ab3`).
    async fn each(
        &self,
        hwnds: Vec<u16>,
        proc: u32,
        lparam: u32,
        task: Option<u16>,
    ) -> Result<u16, Stop> {
        let mut answer = 1;

        for hwnd in hwnds {
            let (exists, of) = {
                let system = self.system();
                let index = system.window_named(hwnd);

                (
                    system.handles.resolve(hwnd).is_some(),
                    index
                        .and_then(|index| system.windows[index].as_ref())
                        .map_or(0, |window| window.task),
                )
            };

            if !exists {
                continue;
            }

            answer = match task {
                Some(task) if of != task => 1,
                Some(_) => self.call_back(proc, hwnd, lparam, Some(1)).await?,
                None => self.call_back(proc, hwnd, lparam, None).await?,
            };

            if answer == 0 {
                break;
            }
        }

        Ok(answer)
    }
}

/// Each window at the top, front to back.
pub fn enum_windows(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (proc, lparam, hwnds) = {
            let mut system = engine.system();
            let proc = args.dword(&system);
            let lparam = args.dword(&system);

            system.raster();
            (proc, lparam, system.top_level_hwnds())
        };

        Ok(Answer::Word(engine.each(hwnds, proc, lparam, None).await?))
    })
}

/// Each of a window's children, and theirs, depth first; nought for a
/// window with none (seg1 `657c`).
pub fn enum_child_windows(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (proc, lparam, hwnds) = {
            let system = engine.system();
            let parent = args.word(&system);
            let proc = args.dword(&system);
            let lparam = args.dword(&system);
            let Some(index) = system.window_named(parent) else {
                return Ok(Answer::Word(0));
            };

            (proc, lparam, system.descendants(index))
        };

        if hwnds.is_empty() {
            return Ok(Answer::Word(0));
        }

        Ok(Answer::Word(engine.each(hwnds, proc, lparam, None).await?))
    })
}

/// Each window at the top a task's, the procedure called with AX 1, so
/// that one that takes its data segment from AX finds none.
pub fn enum_task_windows(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (task, proc, lparam, hwnds) = {
            let mut system = engine.system();
            let task = args.word(&system);
            let proc = args.dword(&system);
            let lparam = args.dword(&system);

            system.raster();
            (task, proc, lparam, system.top_level_hwnds())
        };

        Ok(Answer::Word(
            engine.each(hwnds, proc, lparam, Some(task)).await?,
        ))
    })
}

/// The owned window last active of a window's, or the window itself
/// (seg2 `09a0`).
pub fn get_last_active_popup(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    if system.handles.resolve(hwnd).is_none() {
        return Ok(Answer::Word(0));
    }

    let last = system
        .window_named(hwnd)
        .and_then(|index| system.windows[index].as_ref())
        .map_or(0, |window| window.last_active_popup);

    Ok(Answer::Word(if last == 0 { hwnd } else { last }))
}
