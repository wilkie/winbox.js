//! USER's calls on the windows at the top and how they show: whether a
//! pop-up shows (`AnyPopUp`), a window's pop-ups hidden and shown again
//! (`ShowOwnedPopups`), and Help asked for (`WinHelp`).

use crate::call::{Answer, Args, Stop};
use crate::shell::{Text, text_argument};
use crate::system::System;

const HELP_QUIT: u16 = 0x0002;

/// Whether a pop-up shows: a visible top-level window that has an owner. A
/// program's own unowned overlapped window does not count, and an owned
/// pop-up does (`queries`); an unowned pop-up is not recorded. Nought with
/// no raster desktop. Asking makes the desktop, as asking the TypeScript
/// engine for its desktop makes it.
pub(super) fn any_popup(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if !system.raster() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asking_for_a_popup_makes_the_desktop() {
        let mut system = System::new();

        system.display = crate::display::mode("vga").expect("the display");
        assert_eq!(
            any_popup(&mut system, &mut Args::repeat(0)),
            Ok(Answer::Word(0))
        );
        assert!(system.icon_title_font.is_none());

        system.driver = Some(crate::icons::DriverResources::default());
        assert_eq!(
            any_popup(&mut system, &mut Args::repeat(0)),
            Ok(Answer::Word(0))
        );
        assert!(system.icon_title_font.is_some());
    }
}
