//! The MIDI sequencer's warning, "This file may not play correctly with the
//! default MIDI setup.": the box `MCISEQ.DRV` shows as a file is first
//! played through the MIDI Mapper. **Read out** of `MCISEQ.DRV` (seg2
//! `16b2`-`1794`, its dialog procedure seg2 `1676`, its dialog 100) and
//! **recorded** by `sndplay` on the installation with a sound card, which
//! the recorder answered by clicking OK (`oracle/build/screens/sndplay.png`):
//!
//! * It is shown when the sequencer opens its port to play, the port is the
//!   mapper, the box has not been shown for this device since it was
//!   opened, and the file does not carry Microsoft's mark that it was made
//!   for the default setup (`sequencer.rs`); and not if `SYSTEM.INI` has
//!   `disablewarning=true` in `[mciseq.drv]`, compared without regard to
//!   case.
//! * Its owner is the active window if that is a window of the task that
//!   opened the device, else none.
//! * Its procedure answers TRUE to every command and FALSE to everything
//!   else, and only OK's command ends the box, with whether "Don't display
//!   this warning in future." is checked: it answers `WM_INITDIALOG` FALSE,
//!   so no control has the focus, and Enter and Escape do nothing. Checked,
//!   `disablewarning=true` is written.
//!
//! Its template is winbox.js's own, as winbox.js keeps `MCISEQ`: made to
//! match the Windows 3.1 the recordings are made on (`MCISEQ.DRV`'s dialog
//! 100). A run with no one at it has the host's hand (`BoxHand`), asked as
//! the box comes up, as USER's system error box asks it.
//!
//! Not yet: winbox.js's push buttons take no click of the mouse -- USER's
//! button procedure is not read out, in either engine -- so a click at OK,
//! as the recorder clicked, does not yet end the box, and a run with no one
//! at it waits there until its time is up.

use crate::call::{Args, Stop};
use crate::dialog_template::{DialogTemplate, parse_dialog_template};
use crate::dialogs::DialogProc;
use crate::engine::Engine;
use crate::messages::Param;
use crate::sys_error_box::BoxInput;

/// `MCISEQ`'s dialog 100.
const WARNING_DIALOG: &str = concat!(
    "c001c8800390004b00b400540000004d4944492053657175656e636572000800",
    "4d532053616e732053657269660006000a00aa001800ffff0000005082546869",
    "732066696c65206d6179206e6f7420706c617920636f72726563746c79207769",
    "7468207468652064656661756c74204d4944492073657475702e000006002800",
    "aa000a006600030001508026446f6e277420646973706c617920746869732077",
    "61726e696e6720696e206675747572652e00004600400028000e000100010001",
    "50804f4b0000",
);

/// The check box, "Don't display this warning in future."
const ID_DONT_WARN: u16 = 0x66;
const IDOK: u16 = 1;

const WM_COMMAND: u16 = 0x0111;
const WM_KEYDOWN: u16 = 0x0100;
const WM_KEYUP: u16 = 0x0101;
const BM_GETCHECK: u16 = 0x0400;
const SW_SHOWNORMAL: u16 = 1;

/// The box's template, read as a dialog resource is read.
fn template() -> DialogTemplate {
    let bytes: Vec<u8> = (0..WARNING_DIALOG.len() / 2)
        .map(|at| u8::from_str_radix(&WARNING_DIALOG[at * 2..at * 2 + 2], 16).unwrap_or(0))
        .collect();

    parse_dialog_template(|at| bytes.get(at as usize).copied().unwrap_or(0))
}

/// The box's procedure (seg2 `1676`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WarningProc;

impl WarningProc {
    /// OK's command ends the box with whether the check box is checked;
    /// every command answers 1 (seg2 `1690`-`16a8`), any other message
    /// nought.
    pub(crate) async fn answer(
        self,
        engine: &Engine,
        hwnd: u16,
        message: u16,
        wparam: u16,
    ) -> Result<u32, Stop> {
        if message != WM_COMMAND {
            return Ok(0);
        }

        if wparam != IDOK {
            return Ok(1);
        }

        let item = engine.system().dlg_item(hwnd, ID_DONT_WARN);
        let checked = if item == 0 {
            0
        } else {
            engine
                .send_message(item, BM_GETCHECK, 0, &mut Param::Value(0))
                .await?
        };

        engine.end_dialog(hwnd, checked as i16).await?;
        Ok(1)
    }
}

/// Whether `SYSTEM.INI` says the warning is not to be shown.
pub fn disabled(system: &mut crate::system::System) -> bool {
    system
        .read_profile(b"SYSTEM.INI")
        .get(b"mciseq.drv", b"disablewarning", true)
        .is_some_and(|value| value.eq_ignore_ascii_case(b"true"))
}

/// The box shown and run until OK ends it: what it ended with, nonzero
/// where the check box was checked, or -1 where it could not be made, as
/// `DialogBox` answers. Its owner is the active window where that is a
/// window of `creator`'s, the task that opened the device, as
/// `mciGetCreatorTask` gives it (seg2 `1747`-`1765`).
pub async fn warn(engine: &Engine, creator: u16) -> Result<i16, Stop> {
    let owner = {
        let mut system = engine.system();
        let active = match crate::position::get_active_window(&mut system, &mut Args::repeat(0))? {
            crate::call::Answer::Word(hwnd) => hwnd,
            _ => 0,
        };
        let task =
            match crate::window_queries::get_window_task(&mut system, &mut Args::repeat(active))? {
                crate::call::Answer::Word(task) => task,
                _ => 0,
            };

        if active != 0 && task == creator {
            active
        } else {
            0
        }
    };
    let hwnd = engine
        .create_dialog(
            0,
            &template(),
            owner,
            DialogProc::SeqWarning(WarningProc),
            0,
            true,
        )
        .await?;

    if hwnd == 0 {
        return Ok(-1);
    }

    engine.show(hwnd, SW_SHOWNORMAL).await?;
    hand_at(engine, hwnd);
    engine.run_modal(hwnd, owner).await
}

/// What the host's hand does at the box, as it comes up: the mouse as the
/// pointer is moved and pressed, a key pressed and released at the window
/// with the focus, or at the box.
fn hand_at(engine: &Engine, hwnd: u16) {
    let mut shown = true;

    loop {
        let mut system = engine.system();
        let Some(input) = system.hand(shown) else {
            return;
        };

        shown = false;

        match input {
            BoxInput::Pointer(pointer) => system.pointer_event(pointer),
            BoxInput::Key(key) => {
                let to = system
                    .focus
                    .and_then(|index| system.windows[index].as_ref())
                    .map_or(hwnd, |window| window.hwnd);

                system.post_input(to, WM_KEYDOWN, key, 1);
                system.post_input(to, WM_KEYUP, key, 0xc000_0001);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The template is `MCISEQ`'s dialog 100: its caption, the text, the
    /// check box and OK.
    #[test]
    fn the_template_is_the_sequencers_warning() {
        let template = template();

        assert_eq!(template.caption, "MIDI Sequencer");
        assert_eq!(template.items.len(), 3);
        assert!(template.items.iter().any(|item| item.id == ID_DONT_WARN));
        assert!(template.items.iter().any(|item| item.id == IDOK));
    }

    /// **Read out** (seg2 `1676`-`16ae`): a command other than OK's is
    /// answered TRUE and ends nothing; any other message, FALSE.
    #[test]
    fn every_command_is_answered_true() {
        let engine = crate::mmsystem::device_tests::machine();

        assert_eq!(
            engine.run_now(WarningProc.answer(&engine, 0, WM_COMMAND, 2)),
            Ok(1)
        );
        assert_eq!(
            engine.run_now(WarningProc.answer(&engine, 0, 0x110, 0)),
            Ok(0)
        );
    }
}
