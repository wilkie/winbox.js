//! A group's window procedure, `GROUPWNDPROC` (seg2 `19b2`), as
//! `PROGMAN.EXE`'s answers what a hidden group's window is sent.
//!
//! WinBox's groups are real MDI children of its MDI client, the frame
//! hidden by the owner's decision, so USER places, minimizes, maximizes,
//! restores and activates them as it does Microsoft's. What only a shown
//! window is sent -- painting, the mouse, keys, files dropped on it -- is
//! left to `DefMDIChildProc`.

use super::items;
use super::loaded;
use super::main::{self, Pm, R};
use crate::call::{Answer, Args, Later};
use crate::commdlg::api::{self, Arg};
use crate::engine::Engine;

const WM_CREATE: u16 = 0x01;
const WM_SIZE: u16 = 0x05;
const WM_CLOSE: u16 = 0x10;
const WM_SYSCOMMAND: u16 = 0x112;
const WM_MDIACTIVATE: u16 = 0x222;
const SC_MINIMIZE: u16 = 0xf020;
const SC_MAXIMIZE: u16 = 0xf030;
const SC_RESTORE: u16 = 0xf120;
const SIZE_MINIMIZED: u16 = 1;

/// The window procedure.
pub(crate) fn group_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };
        let instance = api::word(
            engine,
            "USER",
            "GetWindowWord",
            &[Arg::W(hwnd), Arg::W(0xfffa)],
        )
        .await?;
        let pm = Pm::new(engine, instance);

        Ok(Answer::Dword(
            group_message(&pm, hwnd, message, wparam, lparam).await?,
        ))
    })
}

async fn default(pm: &Pm<'_>, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
    pm.user(
        "DefMDIChildProc",
        &[
            Arg::W(hwnd),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await
}

async fn group_message(pm: &Pm<'_>, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
    match message {
        // `1a68`: the group, the `MDICREATESTRUCT`'s `lParam`, kept in the
        // window's word; files may be dropped on it (`DragAcceptFiles`);
        // and it given the focus.
        WM_CREATE => {
            let mdi = {
                let system = pm.e.system();
                let at = system.read_far(lparam, 4);
                let far = u32::from_le_bytes([at[0], at[1], at[2], at[3]]);
                let key = system.read_far(far.wrapping_add(0x16), 2);

                u16::from_le_bytes([key[0], key[1]])
            };

            pm.user("SetWindowWord", &[Arg::W(hwnd), Arg::W(0), Arg::W(mdi)])
                .await?;
            pm.call("SHELL", "DragAcceptFiles", &[Arg::W(hwnd), Arg::W(1)])
                .await?;
            pm.user("SetFocus", &[Arg::W(hwnd)]).await?;
            Ok(0)
        }
        // `1cf6`: `DefMDIChildProc`'s, and the scroll bars fitted unless
        // it was minimized or is being made. Arranging where `AutoArrange`
        // is on is not followed.
        WM_SIZE => {
            let answer = default(pm, hwnd, message, wparam, lparam).await?;

            if wparam != SIZE_MINIMIZED
                && pm.d16(main::D_CREATING) == 0
                && pm.d16(main::D_AUTO_ARRANGE) == 0
            {
                items::scroll_bars(pm, hwnd).await?;
            }

            Ok(answer)
        }
        // `1bb7`: a group is closed by minimizing it.
        WM_CLOSE => {
            pm.send(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0).await?;
            Ok(0)
        }
        // `1bcc`: restoring, the group's file read where it is not in
        // memory, nothing where it cannot be; restoring and maximizing
        // invalidate it, and maximizing takes its scroll bars away first.
        WM_SYSCOMMAND => {
            if wparam == SC_RESTORE {
                let key = loaded::key_of(pm, hwnd).await?;

                if loaded::lock(pm, key).await?.is_none() {
                    return Ok(0);
                }
            }

            if wparam == SC_MAXIMIZE || wparam == SC_RESTORE {
                pm.user("InvalidateRect", &[Arg::W(hwnd), Arg::D(0), Arg::W(0)])
                    .await?;
            }

            if wparam == SC_MAXIMIZE {
                let style = pm
                    .user("GetWindowLong", &[Arg::W(hwnd), Arg::W(0xfff0)])
                    .await?;

                pm.user(
                    "SetWindowLong",
                    &[Arg::W(hwnd), Arg::W(0xfff0), Arg::D(style & !0x0030_0000)],
                )
                .await?;
            }

            default(pm, hwnd, message, wparam, lparam).await
        }
        // `1d43`: the current group follows the active window, while there
        // is one: none where nothing is activated, else the one activated
        // as this one is deactivated; one activated takes the focus.
        WM_MDIACTIVATE => {
            let current = loaded::with(pm, |groups| groups.current);
            let activated = lparam as u16;

            if current != 0 {
                if activated == 0 {
                    loaded::change(pm, |groups| groups.current = 0);
                } else if wparam == 0 {
                    let key = loaded::key_of(pm, activated).await?;

                    loaded::change(pm, |groups| groups.current = key);
                } else {
                    pm.user("SetFocus", &[Arg::W(hwnd)]).await?;
                }
            }

            default(pm, hwnd, message, wparam, lparam).await
        }
        _ => default(pm, hwnd, message, wparam, lparam).await,
    }
}
