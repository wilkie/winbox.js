//! USER's calls on the windows at the top and how they show: whether a
//! pop-up shows (`AnyPopUp`), a window's pop-ups hidden and shown again
//! (`ShowOwnedPopups`), one window kept from drawing (`LockWindowUpdate`),
//! and Help asked for (`WinHelp`).

use crate::call::{Answer, Args, Stop};
use crate::shell::{Text, text_argument};
use crate::system::System;

const HELP_QUIT: u16 = 0x0002;

/// Whether a pop-up shows: a visible top-level window that has an owner. A
/// program's own unowned overlapped window does not count, and an owned
/// pop-up does (`queries`); an unowned pop-up is not recorded. Nought with
/// no raster desktop.
pub(super) fn any_popup(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    // Without the desktop made there is no window to show: asked without
    // making it.
    if system.driver.is_none() {
        return Ok(Answer::Word(0));
    }

    let any = system.z_order.iter().any(|&index| {
        system.windows[index].as_ref().is_some_and(|window| {
            window.parent.is_none()
                && window.title_of.is_none()
                && window.visible
                && window.owner.is_some()
        })
    });

    Ok(Answer::Word(u16::from(any)))
}

/// The pop-ups a window owns hidden, or shown again (`userwin`).
pub(super) fn show_owned_popups(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let show = args.word(system);

    if hwnd != 0
        && let Some(index) = system.window_named(hwnd)
    {
        system.hide_owned(index, show == 0);
    }

    Ok(Answer::Nothing)
}

/// Asks Windows Help to show a help file, or tells it the help is no longer
/// needed.
///
/// Measured by the `winhelp` probe: with Help not running, `HELP_QUIT`
/// succeeds -- there is nothing to close -- and Notepad, which asks it as it
/// closes, does not close when it fails. Anything else would start
/// `WINHELP.EXE`, which starting another program is not yet done for, and
/// fails. A file's name that cannot be read turns the call away.
pub(super) fn win_help(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _hwnd = args.word(system);
    let file = args.dword(system);
    let command = args.word(system);
    let _data = args.dword(system);

    if matches!(text_argument(system, file), Text::Refused) {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(u16::from(command == HELP_QUIT)))
}

/// One window at a time kept from drawing on the screen. **Recorded** by
/// `lockupd`:
///
/// * Locking answers 1; locking while a window is locked, the same one or
///   another, answers nought, and so does unlocking with none locked.
/// * What a device context from `GetDC` draws on the locked window does not
///   show, and nothing is made invalid while it is locked.
/// * Unlocking makes invalid what was drawn -- its rectangle, not the whole
///   window -- and it is painted as any invalid part is.
///
/// The TypeScript engine gives `GetDC` of the locked window a bitmap of its
/// own, the client area's size, which keeps the rectangle drawn on. That
/// device context is not one this engine's `GetDC` can give yet, so `GetDC`
/// of the locked window stops (`get_dc.rs`); with nothing drawn, unlocking
/// makes nothing invalid.
pub(super) fn lock_window_update(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    if hwnd != 0 {
        if system.user_calls.locked.is_some() || system.window_named(hwnd).is_none() {
            return Ok(Answer::Word(0));
        }

        system.user_calls.locked = Some(hwnd);
        return Ok(Answer::Word(1));
    }

    if system.user_calls.locked.take().is_none() {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(1))
}
