//! `DestroyWindow`, as winbox.js destroys a window: the windows it owns
//! first, then it and everything under it, each told as it goes.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::{Param, WM_NCDESTROY, WM_PARENTNOTIFY};
use crate::system::System;

pub const WM_DESTROY: u16 = 0x0002;

impl System {
    /// The window a handle names, if it is one not destroyed.
    fn window_index(&self, hwnd: u16) -> Option<usize> {
        match self.handles.resolve(hwnd) {
            Some(Object::Window(index)) if self.windows[index].is_some() => Some(index),
            _ => None,
        }
    }

    /// The windows, front to back, that `pick` takes.
    fn windows_where(&self, pick: impl Fn(&crate::windows::Window) -> bool) -> Vec<u16> {
        self.z_order
            .iter()
            .filter_map(|&index| self.windows[index].as_ref())
            .filter(|window| pick(window))
            .map(|window| window.hwnd)
            .collect()
    }

    /// A window gone that has the focus: nothing has it. USER takes the
    /// focus off each window `DestroyWindow` destroys, to its parent or, for
    /// a window at the top, to none (`USER.EXE` seg8 `09e1`, `0a17`, calling
    /// seg2 `090a`-`0928`); a pop-up menu's window is destroyed so too.
    /// Here the activation's messages move the focus as a window is taken
    /// away; where nothing moved it -- a pop-up menu's window given it by a
    /// press while no menu had the mouse, or a window of a task ending --
    /// it is let go, so that it never names a window that is gone.
    pub(crate) fn lose_focus(&mut self, index: usize) {
        if self.focus == Some(index) {
            self.focus = None;
        }
    }

    /// A window, and everything under it, the window first.
    fn tree_of(&self, index: usize) -> Vec<u16> {
        let mut tree = vec![self.windows[index].as_ref().map_or(0, |window| window.hwnd)];

        for child in self.windows_where(|other| other.parent == Some(index)) {
            if let Some(child) = self.window_index(child) {
                tree.extend(self.tree_of(child));
            }
        }

        tree
    }

    /// A window gone: its timers stopped, the block its name was copied
    /// into freed, off the desktop, and its handle free.
    fn forget(&mut self, hwnd: u16) {
        self.kill_timers_of(hwnd);

        let Some(index) = self.window_index(hwnd) else {
            self.handles.free(hwnd);
            return;
        };
        let block = self.windows[index]
            .as_ref()
            .map_or(0, |window| window.name_block);

        if block != 0 {
            crate::memory::global_free(self, &mut Args::repeat(block)).expect("GlobalFree answers");
        }

        // Off the desktop, as `Desktop.destroy` takes a window away.
        // It is no longer shown by then: nothing is uncovered.
        if let Some(window) = self.windows[index].as_mut() {
            window.visible = false;
        }

        // A minimized window's title goes with it.
        self.leave_icon(index);

        if self.z_order.contains(&index) {
            self.take_away(index, true);
        }

        self.lose_focus(index);
        self.windows[index] = None;
        self.handles.free(hwnd);
    }
}

impl Engine {
    /// A window destroyed: what it owns, then a child's parent told, then
    /// `WM_DESTROY` to it and what is under it, `WM_NCDESTROY` the other
    /// way, the window last. Whether it was a window.
    pub async fn destroy_window(&self, hwnd: u16) -> Result<bool, Stop> {
        let (index, owned) = {
            let system = self.system();
            let Some(index) = system.window_index(hwnd) else {
                return Ok(false);
            };

            (
                index,
                system.windows_where(|other| other.owner == Some(index)),
            )
        };

        self.system().forget_active_popup(hwnd);

        // The windows it owns first, then it (documented; `owners`).
        for owned in owned {
            Box::pin(self.destroy_window(owned)).await?;
        }

        let (tree, parent) = {
            let system = self.system();
            let parent = system.windows[index]
                .as_ref()
                .and_then(|window| window.parent)
                .and_then(|parent| system.windows[parent].as_ref())
                .map(|parent| parent.hwnd);

            (system.tree_of(index), parent)
        };

        // A child tells its parent it is going.
        if let Some(parent) = parent {
            self.send_message(
                parent,
                WM_PARENTNOTIFY,
                WM_DESTROY,
                &mut Param::Value(u32::from(hwnd)),
            )
            .await?;
        }

        // Off the screen first, which makes another window the active one,
        // with its messages -- to this window too -- before `WM_DESTROY`:
        // its owner, for a window destroyed (`actnext`). Hidden as
        // `SetWindowPos` hides it, not told with `WM_SHOWWINDOW` (`showseq`).
        let visible = {
            let mut system = self.system();
            let window = system.windows[index].as_mut().expect("a window");

            window.destroying = true;
            window.visible
        };

        if visible {
            self.show_raster(hwnd, index, crate::window_state::SW_HIDE, false, false)
                .await?;
        } else {
            self.erase_due().await?;
            self.deliver_activation(None).await?;
        }

        // The shell hooks are told of a window `CreateWindow` told them of,
        // before its `WM_DESTROY` (`shlhook`).
        let shell = self.system().windows[index]
            .as_ref()
            .is_some_and(|window| window.shell_window);

        if shell {
            self.call_hooks(
                crate::hooks::WH_SHELL,
                crate::hooks::HSHELL_WINDOWDESTROYED as i16,
                hwnd,
                0,
            )
            .await?;
        }

        for &each in &tree {
            self.send_message(each, WM_DESTROY, 0, &mut Param::Value(0))
                .await?;
        }

        for &each in tree.iter().rev() {
            self.send_message(each, WM_NCDESTROY, 0, &mut Param::Value(0))
                .await?;
            self.system().forget(each);
        }

        Ok(true)
    }
}

/// A window destroyed; FALSE for a handle that is no window's, the
/// desktop's among them.
pub fn destroy_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());

        Ok(Answer::Word(u16::from(engine.destroy_window(hwnd).await?)))
    })
}
