//! The clipboard: one for the system, opened by a window at a time, holding
//! a block for each format put on it, and a chain of viewers told when it
//! changes. winbox.js's `clipboard.ts`.
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

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

pub const CF_TEXT: u16 = 1;
const CF_BITMAP: u16 = 2;
const CF_OEMTEXT: u16 = 7;
const CF_PALETTE: u16 = 9;

const WM_RENDERFORMAT: u16 = 0x0305;
const WM_DESTROYCLIPBOARD: u16 = 0x0307;
const WM_DRAWCLIPBOARD: u16 = 0x0308;
const WM_CHANGECBCHAIN: u16 = 0x030d;

/// What a format holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Held {
    /// A block's handle.
    Data(u16),
    /// Nothing yet: its owner renders it when it is asked for.
    Rendered,
    /// Made from the other text format when it is asked for.
    Made,
}

/// The clipboard's state.
#[derive(Debug, Clone, Default)]
pub struct Clipboard {
    /// The window that has it open -- 0xFFFF for a task with none -- or
    /// nought.
    pub open: u16,
    pub owner: u16,
    pub viewer: u16,
    pub changed: bool,
    /// Each format and what it holds, in the order put on.
    pub formats: Vec<(u16, Held)>,
}

impl Clipboard {
    fn get(&self, format: u16) -> Option<Held> {
        self.formats
            .iter()
            .find(|(each, _)| *each == format)
            .map(|&(_, held)| held)
    }

    fn has(&self, format: u16) -> bool {
        self.get(format).is_some()
    }

    /// A format set: in its place if it was there, else after the rest.
    fn set(&mut self, format: u16, held: Held) {
        match self.formats.iter_mut().find(|(each, _)| *each == format) {
            Some(entry) => entry.1 = held,
            None => self.formats.push((format, held)),
        }
    }
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "OpenClipboard" => Implementation::Sync(open_clipboard),
        "CloseClipboard" => Implementation::Async(close_clipboard),
        "EmptyClipboard" => Implementation::Async(empty_clipboard),
        "SetClipboardData" => Implementation::Sync(set_clipboard_data),
        "GetClipboardData" => Implementation::Async(get_clipboard_data),
        "CountClipboardFormats" => Implementation::Sync(count_clipboard_formats),
        "EnumClipboardFormats" => Implementation::Sync(enum_clipboard_formats),
        "IsClipboardFormatAvailable" => Implementation::Sync(is_clipboard_format_available),
        "GetClipboardOwner" => Implementation::Sync(get_clipboard_owner),
        "GetOpenClipboardWindow" => Implementation::Sync(get_open_clipboard_window),
        "GetClipboardViewer" => Implementation::Sync(get_clipboard_viewer),
        "SetClipboardViewer" => Implementation::Async(set_clipboard_viewer),
        "ChangeClipboardChain" => Implementation::Async(change_clipboard_chain),
        _ => return None,
    })
}

impl System {
    /// Opened, for no other window having it open: whether it opened.
    pub(crate) fn open_clipboard(&mut self, hwnd: u16) -> bool {
        if self.controls.clipboard.open != 0 {
            return false;
        }

        self.controls.clipboard.open = if hwnd == 0 { 0xffff } else { hwnd };
        true
    }

    /// A format's data set while it is open: the handle given, or nought.
    pub(crate) fn set_clipboard_data(&mut self, format: u16, data: u16) -> u16 {
        if self.controls.clipboard.open == 0 {
            return 0;
        }

        self.controls.clipboard.set(
            format,
            if data == 0 {
                Held::Rendered
            } else {
                Held::Data(data)
            },
        );
        self.controls.clipboard.changed = true;
        data
    }

    /// A block of `GlobalAlloc`'s, `GMEM_MOVEABLE | GMEM_DDESHARE`, holding
    /// a string and its nought: its handle and where it is.
    pub(crate) fn text_block(&mut self, text: &[u8]) -> (u16, u32) {
        let Some(index) = self.global.allocate(
            &mut self.cpu.bus,
            &mut self.descriptors,
            text.len() as u32 + 1,
            0x2002,
        ) else {
            return (0, 0);
        };
        let far = u32::from(segment_selector(index)) << 16;
        let mut bytes = text.to_vec();

        bytes.push(0);
        self.write_far(far, &bytes);
        (winbox_machine::handle_for(index), far)
    }

    /// Where a global block is, as `GlobalLock` gives it, its lock count
    /// left as it is; nought for none.
    pub(crate) fn lock_block(&mut self, handle: u16) -> u32 {
        self.global_pointer(handle)
    }

    fn free_block(&mut self, handle: u16) {
        let mut args = Args::repeat(handle);

        let _ = crate::memory::global_free(self, &mut args);
    }
}

impl Engine {
    /// Closed: the text format it lacks made from the other, and the first
    /// viewer told if anything changed. Whether it was open.
    pub(crate) async fn close_clipboard(&self) -> Result<bool, Stop> {
        let viewer = {
            let mut system = self.system();
            let clipboard = &mut system.controls.clipboard;

            if clipboard.open == 0 {
                return Ok(false);
            }

            clipboard.open = 0;

            if !clipboard.changed {
                return Ok(true);
            }

            clipboard.changed = false;

            if clipboard.has(CF_TEXT) && !clipboard.has(CF_OEMTEXT) {
                clipboard.set(CF_OEMTEXT, Held::Made);
            } else if clipboard.has(CF_OEMTEXT) && !clipboard.has(CF_TEXT) {
                clipboard.set(CF_TEXT, Held::Made);
            }

            clipboard.viewer
        };

        if viewer != 0 {
            self.send_message(viewer, WM_DRAWCLIPBOARD, 0, &mut Param::Value(0))
                .await?;
        }

        Ok(true)
    }

    /// Emptied while it is open: the owner before told, what was on it
    /// freed, and the window that opened it the owner. Whether it was open.
    pub(crate) async fn empty_clipboard(&self) -> Result<bool, Stop> {
        let owner = {
            let system = self.system();

            if system.controls.clipboard.open == 0 {
                return Ok(false);
            }

            system.controls.clipboard.owner
        };

        if owner != 0 {
            self.send_message(owner, WM_DESTROYCLIPBOARD, 0, &mut Param::Value(0))
                .await?;
        }

        let mut system = self.system();
        let formats = std::mem::take(&mut system.controls.clipboard.formats);

        for (format, held) in formats {
            let Held::Data(handle) = held else {
                continue;
            };

            if format == CF_BITMAP || format == CF_PALETTE {
                crate::gdi::objects::delete_object(&mut system, handle);
            } else {
                system.free_block(handle);
            }
        }

        let open = system.controls.clipboard.open;

        system.controls.clipboard.owner = if open == 0xffff { 0 } else { open };
        system.controls.clipboard.changed = true;
        Ok(true)
    }

    /// A format's data, rendered by its owner if it had none, or made from
    /// the other text format; nought for none, or while it is closed.
    pub(crate) async fn get_clipboard_data(&self, format: u16) -> Result<u16, Stop> {
        let (held, owner) = {
            let system = self.system();
            let clipboard = &system.controls.clipboard;

            if clipboard.open == 0 {
                return Ok(0);
            }

            let Some(held) = clipboard.get(format) else {
                return Ok(0);
            };

            (held, clipboard.owner)
        };

        if held == Held::Rendered && owner != 0 {
            self.send_message(owner, WM_RENDERFORMAT, format, &mut Param::Value(0))
                .await?;
        }

        if self.system().controls.clipboard.get(format) == Some(Held::Made) {
            let made = Box::pin(self.made_text(format)).await?;

            self.system()
                .controls
                .clipboard
                .set(format, Held::Data(made));
        }

        Ok(match self.system().controls.clipboard.get(format) {
            Some(Held::Data(handle)) => handle,
            _ => 0,
        })
    }

    /// One text format made from the other, in a block of its own.
    async fn made_text(&self, format: u16) -> Result<u16, Stop> {
        let to_oem = format == CF_OEMTEXT;
        let source = self
            .get_clipboard_data(if to_oem { CF_TEXT } else { CF_OEMTEXT })
            .await?;
        let mut system = self.system();
        let from = if source == 0 {
            0
        } else {
            system.lock_block(source)
        };

        if from == 0 {
            return Ok(0);
        }

        let length = system.read_string(from).len().min(0xffff);
        let (made, to) = system.text_block(&vec![0; length]);

        if to != 0 {
            crate::keyboard::translate_string(&mut system, to_oem, from, to);
        }

        Ok(made)
    }
}

fn open_clipboard(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(u16::from(system.open_clipboard(hwnd))))
}

fn close_clipboard(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move { Ok(Answer::Word(u16::from(engine.close_clipboard().await?))) })
}

fn empty_clipboard(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move { Ok(Answer::Word(u16::from(engine.empty_clipboard().await?))) })
}

fn set_clipboard_data(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let format = args.word(system);
    let data = args.word(system);

    Ok(Answer::Word(system.set_clipboard_data(format, data)))
}

fn get_clipboard_data(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let format = args.word(&engine.system());

        Ok(Answer::Word(engine.get_clipboard_data(format).await?))
    })
}

/// How many formats are on it.
fn count_clipboard_formats(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.controls.clipboard.formats.len() as u16))
}

/// The format after the one given, nought for the first; nought after the
/// last, and while it is closed.
fn enum_clipboard_formats(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let format = args.word(system);
    let clipboard = &system.controls.clipboard;

    if clipboard.open == 0 {
        return Ok(Answer::Word(0));
    }

    let order: Vec<u16> = clipboard
        .formats
        .iter()
        .map(|&(format, _)| format)
        .collect();

    Ok(Answer::Word(if format == 0 {
        order.first().copied().unwrap_or(0)
    } else {
        order
            .iter()
            .position(|&each| each == format)
            .and_then(|at| order.get(at + 1))
            .copied()
            .unwrap_or(0)
    }))
}

/// Whether a format is on it.
fn is_clipboard_format_available(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let format = args.word(system);

    Ok(Answer::Word(u16::from(
        system.controls.clipboard.has(format),
    )))
}

/// The window that emptied it last.
fn get_clipboard_owner(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.controls.clipboard.owner))
}

/// The window that has it open.
fn get_open_clipboard_window(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let open = system.controls.clipboard.open;

    Ok(Answer::Word(if open == 0xffff { 0 } else { open }))
}

/// The first viewer.
fn get_clipboard_viewer(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.controls.clipboard.viewer))
}

/// The viewer before, to pass its messages on to; the new one sent
/// `WM_DRAWCLIPBOARD`.
fn set_clipboard_viewer(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, before) = {
            let mut system = engine.system();
            let hwnd = args.word(&system);

            (
                hwnd,
                std::mem::replace(&mut system.controls.clipboard.viewer, hwnd),
            )
        };

        if hwnd != 0 {
            engine
                .send_message(hwnd, WM_DRAWCLIPBOARD, 0, &mut Param::Value(0))
                .await?;
        }

        Ok(Answer::Word(before))
    })
}

/// What the first viewer answered `WM_CHANGECBCHAIN`, told of the window
/// leaving and the one after it.
fn change_clipboard_chain(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (remove, next, first) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                system.controls.clipboard.viewer,
            )
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
            engine.system().controls.clipboard.viewer = next;
        }

        Ok(Answer::Word(answer as u16))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_format_set_again_keeps_its_place() {
        let mut clipboard = Clipboard::default();

        clipboard.set(CF_TEXT, Held::Data(1));
        clipboard.set(CF_BITMAP, Held::Rendered);
        clipboard.set(CF_TEXT, Held::Data(2));

        assert_eq!(
            clipboard.formats,
            vec![(CF_TEXT, Held::Data(2)), (CF_BITMAP, Held::Rendered)]
        );
    }

    #[test]
    fn opens_for_one_window_at_a_time() {
        let mut system = System::new();

        assert!(system.open_clipboard(0x2040));
        assert!(!system.open_clipboard(0x2050));
    }
}
