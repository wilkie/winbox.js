//! The clipboard: one for the system, opened by a window at a time, holding
//! a block for each format put on it, and a chain of viewers told when it
//! changes.
//!
//! **Recorded** by `clip`, with an owner, a viewer and a second viewer:
//!
//! * It opens for one window at a time: opened, another window's
//!   `OpenClipboard` answers nought. Closing it when it is not open answers
//!   nought, and so does `GetClipboardData`.
//! * `EmptyClipboard` makes the window that opened it the owner, and sends
//!   the owner before it `WM_DESTROYCLIPBOARD`.
//! * `SetClipboardData` answers the handle it was given. A format given no
//!   handle is rendered when it is asked for: its owner is sent
//!   `WM_RENDERFORMAT`, and puts the data on then.
//! * Closed, the clipboard makes `CF_OEMTEXT` from `CF_TEXT`, or `CF_TEXT`
//!   from `CF_OEMTEXT`, if it has one and not the other, listed after the
//!   formats put on: the text through the keyboard driver's tables when it
//!   is asked for. While it is open, only what was put on is there.
//!   `EnumClipboardFormats` lists them in the order they were put on.
//! * `SetClipboardViewer` sends the new viewer `WM_DRAWCLIPBOARD` and
//!   answers the one before, which it is to pass that message on to.
//!   Closing the clipboard sends the first viewer `WM_DRAWCLIPBOARD` if
//!   anything was put on or taken off, and not otherwise.
//! * `ChangeClipboardChain` sends the first viewer `WM_CHANGECBCHAIN`, the
//!   window leaving and the one after it, and answers what it answered.
//!
//! Documented, and not recorded: `EmptyClipboard` frees what was on it, a
//! bitmap or a palette with `DeleteObject` and anything else with
//! `GlobalFree`; an owner destroyed is not asked to render what it has not.

use winbox_machine::{handle_for, index_for, segment_selector};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

const CF_TEXT: u16 = 1;
const CF_BITMAP: u16 = 2;
const CF_OEMTEXT: u16 = 7;
const CF_PALETTE: u16 = 9;

const WM_RENDERFORMAT: u16 = 0x0305;
const WM_DESTROYCLIPBOARD: u16 = 0x0307;
const WM_DRAWCLIPBOARD: u16 = 0x0308;
const WM_CHANGECBCHAIN: u16 = 0x030d;

/// What a format on the clipboard holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Data {
    Handle(u16),
    /// None: its owner renders it when it is asked for.
    Owner,
    /// Made from the other text format when it is asked for.
    Made,
}

/// The clipboard.
#[derive(Debug, Clone, Default)]
pub struct Clipboard {
    /// The window that has it open, `FFFFh` for none named; nought for
    /// closed.
    open: u16,
    owner: u16,
    viewer: u16,
    changed: bool,
    /// Each format's data, in the order put on.
    formats: Vec<(u16, Data)>,
}

impl Clipboard {
    fn get(&self, format: u16) -> Option<Data> {
        self.formats
            .iter()
            .find(|&&(each, _)| each == format)
            .map(|&(_, data)| data)
    }

    /// A format's data set, where it was put on first if it was.
    fn set(&mut self, format: u16, data: Data) {
        match self.formats.iter_mut().find(|(each, _)| *each == format) {
            Some(entry) => entry.1 = data,
            None => self.formats.push((format, data)),
        }
    }
}

fn clipboard(system: &mut System) -> &mut Clipboard {
    &mut system.user_calls.clipboard
}

/// Whether it opened, for no other window having it open.
pub(super) fn open_clipboard(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let clipboard = clipboard(system);

    if clipboard.open != 0 {
        return Ok(Answer::Word(0));
    }

    clipboard.open = if hwnd == 0 { 0xffff } else { hwnd };
    Ok(Answer::Word(1))
}

/// Whether it was open: closed, each text format made from the other it
/// lacks, and the first viewer told, if anything changed.
pub(super) fn close_clipboard(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        let viewer = {
            let mut system = engine.system();
            let clipboard = clipboard(&mut system);

            if clipboard.open == 0 {
                return Ok(Answer::Word(0));
            }

            clipboard.open = 0;

            if !clipboard.changed {
                return Ok(Answer::Word(1));
            }

            clipboard.changed = false;

            let text = clipboard.get(CF_TEXT).is_some();
            let oem = clipboard.get(CF_OEMTEXT).is_some();

            if text && !oem {
                clipboard.set(CF_OEMTEXT, Data::Made);
            } else if oem && !text {
                clipboard.set(CF_TEXT, Data::Made);
            }

            clipboard.viewer
        };

        if viewer != 0 {
            engine
                .send_message(viewer, WM_DRAWCLIPBOARD, 0, &mut Param::Value(0))
                .await?;
        }

        Ok(Answer::Word(1))
    })
}

/// Whether it was open to be emptied: the owner before told, what was on
/// it freed, and the window that opened it the owner.
pub(super) fn empty_clipboard(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        let owner = {
            let mut system = engine.system();
            let clipboard = clipboard(&mut system);

            if clipboard.open == 0 {
                return Ok(Answer::Word(0));
            }

            clipboard.owner
        };

        if owner != 0 {
            engine
                .send_message(owner, WM_DESTROYCLIPBOARD, 0, &mut Param::Value(0))
                .await?;
        }

        let mut system = engine.system();
        let formats = std::mem::take(&mut clipboard(&mut system).formats);

        for (format, data) in formats {
            let Data::Handle(handle) = data else {
                continue;
            };

            if format == CF_BITMAP || format == CF_PALETTE {
                crate::gdi::objects::delete_object(&mut system, handle);
            } else {
                crate::memory::global_free(&mut system, &mut Args::repeat(handle))?;
            }
        }

        let clipboard = clipboard(&mut system);

        clipboard.owner = if clipboard.open == 0xffff {
            0
        } else {
            clipboard.open
        };
        clipboard.changed = true;
        Ok(Answer::Word(1))
    })
}

/// The handle given, or nought where the clipboard is not open.
pub(super) fn set_clipboard_data(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let format = args.word(system);
    let handle = args.word(system);
    let clipboard = clipboard(system);

    if clipboard.open == 0 {
        return Ok(Answer::Word(0));
    }

    clipboard.set(
        format,
        if handle == 0 {
            Data::Owner
        } else {
            Data::Handle(handle)
        },
    );
    clipboard.changed = true;
    Ok(Answer::Word(handle))
}

/// A format's data, rendered by its owner if it had none, or nought.
pub(super) fn get_clipboard_data(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let format = args.word(&engine.system());

        Ok(Answer::Word(clipboard_data(engine, format).await?))
    })
}

async fn clipboard_data(engine: &Engine, format: u16) -> Result<u16, Stop> {
    let (data, owner) = {
        let mut system = engine.system();
        let clipboard = clipboard(&mut system);

        match clipboard.get(format) {
            Some(data) if clipboard.open != 0 => (data, clipboard.owner),
            _ => return Ok(0),
        }
    };

    if data == Data::Owner && owner != 0 {
        engine
            .send_message(owner, WM_RENDERFORMAT, format, &mut Param::Value(0))
            .await?;
    }

    if clipboard(&mut engine.system()).get(format) == Some(Data::Made) {
        let made = Box::pin(made_text(engine, format)).await?;

        clipboard(&mut engine.system()).set(format, Data::Handle(made));
    }

    Ok(match clipboard(&mut engine.system()).get(format) {
        Some(Data::Handle(handle)) => handle,
        _ => 0,
    })
}

/// One text format made from the other, in a block of its own.
async fn made_text(engine: &Engine, format: u16) -> Result<u16, Stop> {
    let to_oem = format == CF_OEMTEXT;
    let source = clipboard_data(engine, if to_oem { CF_TEXT } else { CF_OEMTEXT }).await?;
    let mut held = engine.system();
    let system = &mut *held;

    if source == 0 {
        return Ok(0);
    }

    let from = match crate::memory::global_lock(system, &mut Args::repeat(source))? {
        Answer::Dword(far) if far != 0 => far,
        _ => return Ok(0),
    };

    let mut length: u32 = 0;

    while length < 0xffff
        && system.read_far((from & 0xffff_0000) | ((from + length) & 0xffff), 1)[0] != 0
    {
        length += 1;
    }

    let Some(index) = system.global.allocate(
        &mut system.cpu.bus,
        &mut system.descriptors,
        length + 1,
        0x2002,
    ) else {
        return Ok(0);
    };
    let made = handle_for(index);
    let to = u32::from(segment_selector(index_for(made))) << 16;

    crate::keyboard::translate_string(system, to_oem, from, to);
    Ok(made)
}

/// How many formats are on it.
pub(super) fn count_clipboard_formats(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(clipboard(system).formats.len() as u16))
}

/// The format after the one given, the first for nought; nought after the
/// last, for one not there, or where the clipboard is not open.
pub(super) fn enum_clipboard_formats(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let format = args.word(system);
    let clipboard = clipboard(system);

    if clipboard.open == 0 {
        return Ok(Answer::Word(0));
    }

    let order: Vec<u16> = clipboard.formats.iter().map(|&(each, _)| each).collect();

    if format == 0 {
        return Ok(Answer::Word(order.first().copied().unwrap_or(0)));
    }

    Ok(Answer::Word(
        order
            .iter()
            .position(|&each| each == format)
            .and_then(|at| order.get(at + 1).copied())
            .unwrap_or(0),
    ))
}

/// Whether a format is on it.
pub(super) fn is_clipboard_format_available(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let format = args.word(system);

    Ok(Answer::Word(u16::from(
        clipboard(system).get(format).is_some(),
    )))
}

/// The window that emptied it last.
pub(super) fn get_clipboard_owner(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(clipboard(system).owner))
}

/// The window that has it open.
pub(super) fn get_open_clipboard_window(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let open = clipboard(system).open;

    Ok(Answer::Word(if open == 0xffff { 0 } else { open }))
}

/// The first viewer.
pub(super) fn get_clipboard_viewer(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(clipboard(system).viewer))
}

/// The viewer before, to pass its messages on to: the new one told.
pub(super) fn set_clipboard_viewer(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, before) = {
            let mut system = engine.system();
            let hwnd = args.word(&system);
            let clipboard = clipboard(&mut system);
            let before = clipboard.viewer;

            clipboard.viewer = hwnd;
            (hwnd, before)
        };

        if hwnd != 0 {
            engine
                .send_message(hwnd, WM_DRAWCLIPBOARD, 0, &mut Param::Value(0))
                .await?;
        }

        Ok(Answer::Word(before))
    })
}

/// What the first viewer answered `WM_CHANGECBCHAIN`: told the window
/// leaving and the one after it, and the one after made the first if the
/// first is leaving.
pub(super) fn change_clipboard_chain(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (remove, next, first) = {
            let mut system = engine.system();
            let remove = args.word(&system);
            let next = args.word(&system);

            (remove, next, clipboard(&mut system).viewer)
        };

        if first == 0 {
            return Ok(Answer::Word(0));
        }

        let answer = engine
            .send_message(
                first,
                WM_CHANGECBCHAIN,
                remove,
                &mut Param::Value(u32::from(next)),
            )
            .await?;

        if first == remove {
            clipboard(&mut engine.system()).viewer = next;
        }

        Ok(Answer::Word(answer as u16))
    })
}
