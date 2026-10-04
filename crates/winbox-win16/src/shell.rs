//! The Windows 3.1 Shell API Library, `SHELL.DLL`, as winbox.js keeps it.
//!
//! The ordinals and names are the installation's own export table
//! (`kept.rs`). Only what a program has been seen to need is more than a
//! stub: Notepad imports `DragAcceptFiles`, `DragQueryFile`, `DragFinish`
//! and `ShellAbout`, and calls the first while it starts; the accessories'
//! About boxes are `ShellAbout`'s. The registration database is
//! `shell/registry.rs` and `shell/reg_api.rs`; finding and starting
//! programs and their icons, `shell/programs.rs`; the shell hook,
//! `shell/shell_hook.rs`.
//!
//! Not here yet: `ShellAbout`, which shows a dialog box, and the dialog
//! boxes are not in the Rust engine; it stops. SHELL's strings and its
//! About box's template, which only `ShellAbout` uses, wait with it.

pub mod programs;
pub mod reg_api;
pub mod registry;
pub mod shell_hook;

use std::collections::HashSet;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

/// What SHELL keeps between calls.
#[derive(Debug, Clone, Default)]
pub struct Shell {
    pub registry: reg_api::Registry,
    pub hook: shell_hook::ShellHook,
    /// The windows marked as taking files dropped on them. The TypeScript
    /// engine marks the window itself; nothing reads the mark there either.
    pub accepts_files: HashSet<u16>,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "RegOpenKey" => Implementation::Sync(reg_api::reg_open_key),
        "RegCreateKey" => Implementation::Sync(reg_api::reg_create_key),
        "RegCloseKey" => Implementation::Sync(reg_api::reg_close_key),
        "RegDeleteKey" => Implementation::Sync(reg_api::reg_delete_key),
        "RegSetValue" => Implementation::Sync(reg_api::reg_set_value),
        "RegQueryValue" => Implementation::Sync(reg_api::reg_query_value),
        "RegEnumKey" => Implementation::Sync(reg_api::reg_enum_key),
        "DragAcceptFiles" => Implementation::Sync(drag_accept_files),
        "ShellExecute" => Implementation::Sync(programs::shell_execute),
        "FindExecutable" => Implementation::Sync(programs::find_executable),
        "ShellAbout" => Implementation::Sync(shell_about),
        "ExtractIcon" => Implementation::Sync(programs::extract_icon),
        "DoEnvironmentSubst" => Implementation::Sync(programs::do_environment_subst),
        "FindEnvironmentString" => Implementation::Sync(programs::find_environment_string),
        "RegisterShellHook" => Implementation::Sync(shell_hook::register_shell_hook),
        "ShellHookProc" => Implementation::Async(shell_hook::shell_hook_proc),
        _ => return None,
    })
}

/// A string argument as the TypeScript engine reads one: none for a null
/// pointer, a number where the segment is nought; a string that cannot be
/// read to its nought turns the call away, answering nought (**recorded**
/// by `badarg`).
pub(crate) enum Text {
    Null,
    Number(u16),
    Read(Vec<u8>),
    Refused,
}

pub(crate) fn text_argument(system: &System, far: u32) -> Text {
    match (far >> 16, far & 0xffff) {
        (0, 0) => Text::Null,
        (0, number) => Text::Number(number as u16),
        _ if !system.readable_string(far) => Text::Refused,
        _ => Text::Read(system.argument_string(far)),
    }
}

/// Whether a window takes files dropped on it: the window is marked, and
/// File Manager sends one that is `WM_DROPFILES` when files are dropped on
/// it. Nothing here drops files yet, so the mark is all there is.
#[allow(clippy::unnecessary_wraps)]
fn drag_accept_files(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let accept = args.word(system);

    let window = matches!(
        crate::window_queries::is_window(system, &mut Args::repeat(hwnd)),
        Ok(Answer::Word(1))
    );

    if window {
        if accept == 0 {
            system.shell.accepts_files.remove(&hwnd);
        } else {
            system.shell.accepts_files.insert(hwnd);
        }
    }

    Ok(Answer::Nothing)
}

/// SHELL's About box, which is a dialog box: not in the Rust engine yet.
fn shell_about(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Err(Stop::Unsupported("ShellAbout's dialog box"))
}
