//! `COMMDLG`, the common dialogs, made WinBox's own a function at a time.
//! As `src/win16/commdlg/`.
//!
//! **How a call reaches it.** `COMMDLG` is one of the modules WinBox keeps
//! (`kept.rs`), and its file is loaded beside it when there is one:
//!
//! * With `COMMDLG.DLL` on the drive, a program that imports `COMMDLG`, or
//!   loads it by its name or its whole path, gets the file's library, as
//!   on Windows -- its module handle, its instance, its count, its entry
//!   point, which registers its messages. But each import of an export
//!   WinBox answers is linked to WinBox's stub for that ordinal, not to the
//!   file's entry (`linker.rs`), and `GetProcAddress` answers the stub
//!   (`modules_kernel.rs`). The other exports are the file's code.
//! * With none, the program links to WinBox's stubs throughout: an export
//!   WinBox answers is answered, one it does not yet answers nought, as
//!   every stub does. `LoadLibrary` finds it by its file's name whether or
//!   not the file is there, and the messages its entry point would have
//!   registered are registered as it loads (`start`).
//!
//! The extended error is one word for both: the file's own, while the file
//! is loaded, and WinBox's otherwise (`set_error`).
//!
//! **Adding a function** -- the registration point, one entry per export:
//!
//! 1. Write it in a file of this module, with the signature every call has
//!    (`call::Sync` or `call::Async`).
//! 2. Add its arm to `implementation` below, by the export's name.
//! 3. In the TypeScript engine, put its function in place of
//!    `CommDlg.stub` at its ordinal in `src/win16/commdlg/index.ts`, with
//!    its arguments' types and its answer's.
//! 4. Write `kept.rs` again (`npm run rust:modules`): the export is then no
//!    longer a stub there, and `tests::ours_agree` checks the two engines
//!    answer the same exports.

mod api;
mod file_command;
pub mod file_dialogs;
mod file_init;
mod file_lists;
mod file_ok;
pub mod parse;
mod pictures;
pub mod resources;

mod choose_color;
mod choose_font;
mod colour_math;
mod find_replace;
mod guest_calls;
mod templates;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::modules::Kept;
use crate::system::{STEP, System};

/// The module's name, and its file's.
pub const NAME: &str = "COMMDLG";

/// The function that answers an export WinBox has made its own: the
/// registration point. Every export not here is the file's while it is
/// loaded, and a stub without it.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "CommDlgExtendedError" => Implementation::Sync(comm_dlg_extended_error),
        "ChooseColor" => Implementation::Async(choose_color::choose_color),
        "ColorDlgProc" => Implementation::Async(choose_color::color_dlg_proc),
        "FindText" => Implementation::Async(find_replace::find_text),
        "ReplaceText" => Implementation::Async(find_replace::replace_text),
        "FindTextDlgProc" => Implementation::Async(find_replace::find_text_dlg_proc),
        "ReplaceTextDlgProc" => Implementation::Async(find_replace::replace_text_dlg_proc),
        "WantArrows" => Implementation::Async(choose_color::want_arrows),
        "GetFileTitle" => Implementation::Sync(parse::get_file_title),
        "GetOpenFileName" => Implementation::Async(file_dialogs::get_open_file_name),
        "GetSaveFileName" => Implementation::Async(file_dialogs::get_save_file_name),
        "FileOpenDlgProc" => Implementation::Async(file_init::file_open_dlg_proc),
        "FileSaveDlgProc" => Implementation::Async(file_init::file_save_dlg_proc),
        "dwLBSubclass" => Implementation::Async(file_init::dw_lb_subclass),
        "dwOKSubclass" => Implementation::Async(file_init::dw_ok_subclass),
        "ChooseFont" => Implementation::Async(choose_font::choose_font),
        "FormatCharDlgProc" => Implementation::Async(choose_font::format_char_dlg_proc),
        "FontStyleEnumProc" => Implementation::Async(choose_font::font_style_enum_proc),
        "FontFamilyEnumProc" => Implementation::Async(choose_font::font_family_enum_proc),
        _ => return None,
    })
}

/// Whether WinBox answers an ordinal of `COMMDLG`'s.
pub(crate) fn ours(ordinal: u16) -> bool {
    Kept::named(NAME)
        .and_then(|kept| kept.export(ordinal))
        .is_some_and(|export| implementation(export.name).is_some())
}

/// What an import of an ordinal of a module loaded from its file links to,
/// and what `GetProcAddress` answers for it, where it is not the file's
/// entry: WinBox's stub, for an export of `COMMDLG` WinBox answers. Its
/// segment's descriptor index and offset.
pub(crate) fn redirect(system: &mut System, module: usize, ordinal: u16) -> Option<(usize, u16)> {
    if !system.modules[module].name.eq_ignore_ascii_case(NAME) || !ours(ordinal) {
        return None;
    }

    let kept = system.kept_named(NAME)?;

    Some((system.stubs(kept), STEP * (ordinal + 1)))
}

/// The far address of an export of `COMMDLG`'s that WinBox answers -- its
/// stub, which USER calls as it calls any procedure of a program's, and
/// which lands in `implementation`'s function. COMMDLG hands out its own
/// exports so: `FileOpenDlgProc` to `DialogBoxIndirectParam`
/// (`COMMDLG.DLL` seg2 `0c2d`), `dwLBSubclass` to `SetWindowLong` (seg2
/// `18be`). Nought for an ordinal it does not answer.
pub(crate) fn proc_address(system: &mut System, ordinal: u16) -> u32 {
    let Some(kept) = system.kept_named(NAME).filter(|_| ours(ordinal)) else {
        return 0;
    };
    let stubs = system.stubs(kept);

    u32::from(winbox_machine::segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

/// `COMMDLG`'s instance, which its dialogs are made with (`[2CAh]`, its
/// entry point's `hInstance`, seg7 `016e`): the file's library's while the
/// file is loaded, WinBox's own otherwise.
pub(crate) fn instance(system: &System) -> u16 {
    if let Some(library) = system.module_named(NAME) {
        return system.modules[library].instance;
    }

    system
        .kept_named(NAME)
        .map_or(0, |kept| system.kept[kept].instance())
}

/// `COMMDLG`'s data segment's selector, which DS holds as it calls a hook:
/// the file's while it is loaded, WinBox's own otherwise.
pub(crate) fn data_selector(system: &System) -> u16 {
    if let Some(data) = system
        .module_named(NAME)
        .and_then(|library| system.modules[library].data())
    {
        return winbox_machine::segment_selector(data);
    }

    system.kept_named(NAME).map_or(0, |kept| {
        winbox_machine::segment_selector(system.kept[kept].data)
    })
}

/// A program's hook called as `COMMDLG` calls one: `hook(hwnd, message,
/// wParam, lParam)`, a far Pascal call, with `COMMDLG`'s own data segment
/// in DS (`COMMDLG.DLL` seg2 `42f4`, `call far [es:bx+40h]`; seg2 `4331`,
/// `call far [4Ah]`) -- a hook finds its program's data only through its
/// `MakeProcInstance` thunk. Its answer, AX: a hook answers a `BOOL`.
pub(crate) async fn call_hook(
    engine: &Engine,
    hook: u32,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    let ds = data_selector(&engine.system());
    let answer = engine
        .call_with(
            hook,
            &[
                GuestArg::Word(hwnd),
                GuestArg::Word(message),
                GuestArg::Word(wparam),
                GuestArg::Long(lparam),
            ],
            &[Register::Segment(winbox_cpu::DS, ds)],
        )
        .await?
        .0;

    Ok(answer as u16)
}

/// A hook called as `call_hook` calls one, its `lParam` a far pointer to a
/// string laid out below the stack, as COMMDLG gives one of its own
/// buffers: `SHAREVISTRING`'s path (seg2 `1e67`, `2c9f`).
pub(crate) async fn call_hook_text(
    engine: &Engine,
    hook: u32,
    hwnd: u16,
    message: u16,
    wparam: u16,
    text: &[u8],
) -> Result<u16, Stop> {
    let ds = data_selector(&engine.system());
    let mut bytes = text.to_vec();

    bytes.push(0);

    let answer = engine
        .call_with(
            hook,
            &[
                GuestArg::Word(hwnd),
                GuestArg::Word(message),
                GuestArg::Word(wparam),
                GuestArg::Struct(bytes),
            ],
            &[Register::Segment(winbox_cpu::DS, ds)],
        )
        .await?
        .0;

    Ok(answer as u16)
}

/// The cursor while `COMMDLG` works: the hourglass, `busy`, or the arrow
/// (entry 32, `COMMDLG.DLL` seg2 `08e2`): `SetCursor(LoadCursor(0,
/// IDC_WAIT))` or `IDC_ARROW`. Nothing while its Open or Save dialog is
/// being made (`[0CACh]`, seg2 `4354`). Not followed: the `ShowCursor`
/// it adds where `GetSystemMetrics(SM_MOUSEPRESENT)` answered nought as it
/// loaded (seg7 `00e3`, seg2 `08fc`); WinBox always has a mouse.
pub(crate) fn wait_cursor(system: &mut System, busy: bool) {
    const IDC_ARROW: u16 = 32512;
    const IDC_WAIT: u16 = 32514;

    if system.commdlg.initialising {
        return;
    }

    system.raster();

    let cursor =
        crate::icons::standard_cursor_handle(system, if busy { IDC_WAIT } else { IDC_ARROW });

    system.cursor = Some(cursor);
}

/// The messages `COMMDLG`'s entry point registers, in its order:
/// `COMMDLG.DLL` seg7 `010b` to `014c`, then, once it has made its memory
/// device context, seg7 `0208`. A program finds them by the same names
/// (`commdlg.h`'s `LBSELCHSTRING`, `SHAREVISTRING`, `FILEOKSTRING`,
/// `COLOROKSTRING`, `SETRGBSTRING`, `HELPMSGSTRING`).
pub const MESSAGES: [&str; 6] = [
    "commdlg_LBSelChangedNotify",
    "commdlg_ShareViolation",
    "commdlg_FileNameOK",
    "commdlg_ColorOK",
    "commdlg_SetRGBColor",
    "commdlg_help",
];

/// `COMMDLG` loaded with no file of its own: its messages registered, as
/// the file's entry point registers them. A message registered again keeps
/// its number, so this is the same each time it loads.
///
/// Not followed: the memory device context the entry point makes and keeps
/// (seg7 `01a1` to `0203`).
pub(crate) fn start(system: &mut System) {
    for name in MESSAGES {
        crate::user::register_message(system, name.to_string());
    }
}

/// A message of `COMMDLG`'s by its name (`MESSAGES`), its number as its
/// entry point registered it.
pub(crate) fn message(system: &mut System, name: &str) -> u16 {
    crate::user::register_message(system, name.to_string())
}

/// What `COMMDLG` keeps of its own.
#[derive(Debug, Default, Clone)]
pub struct State {
    /// What `CommDlgExtendedError` answers, while the file is not loaded.
    pub error: u32,
    /// Whether an Open or Save dialog is being made: no cursor is set
    /// (`[0CACh]`, `COMMDLG.DLL` seg2 `4354`).
    pub initialising: bool,
    /// The last number put under a Find, Replace or Color dialog's
    /// property A000h (`guest_calls::next_number`).
    pub(crate) next: u16,
    /// What the Find and Replace dialogs keep (`find_replace.rs`).
    pub(crate) find: find_replace::FindGlobals,
    /// What the Color dialog keeps (`choose_color.rs`).
    pub(crate) colour: choose_color::ColourGlobals,
    /// What the Font dialog keeps (`choose_font.rs`).
    pub(crate) font: choose_font::FontGlobals,
    /// What the file boxes keep (`file_dialogs.rs`).
    pub files: file_dialogs::Shared,
}

/// Where the loaded file keeps its extended error, as a far pointer: the
/// doubleword its `CommDlgExtendedError` reads, `mov ax, [2CCh]; mov dx,
/// [2CEh]` in `COMMDLG.DLL` (seg6 `01f1`). Found in the entry's code, so
/// that a file of another version is read where it reads.
fn file_error(system: &System) -> Option<u32> {
    let library = system.module_named(NAME)?;
    let module = &system.modules[library];
    let ordinal = module.executable.ordinal_of("CommDlgExtendedError");
    let (segment, offset) = module.lookup(ordinal)?;
    let data = module.data()?;
    let code = system.read_far(
        u32::from(winbox_machine::segment_selector(segment)) << 16 | u32::from(offset),
        24,
    );
    let at = code
        .windows(3)
        .position(|bytes| bytes == [0x8e, 0xd8, 0xa1])?;
    let word = u16::from_le_bytes([*code.get(at + 3)?, *code.get(at + 4)?]);

    Some(u32::from(winbox_machine::segment_selector(data)) << 16 | u32::from(word))
}

/// `COMMDLG`'s extended error set, where `CommDlgExtendedError` finds it.
pub(crate) fn set_error(system: &mut System, code: u32) {
    match file_error(system) {
        Some(far) => system.write_far(far, &code.to_le_bytes()),
        None => system.commdlg.error = code,
    }
}

/// `COMMDLG`'s extended error, wherever it is kept.
pub(crate) fn error(system: &System) -> u32 {
    match file_error(system) {
        Some(far) => {
            let bytes = system.read_far(far, 4);

            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        }
        None => system.commdlg.error,
    }
}

/// The error the last of `COMMDLG`'s functions left: nought for none
/// (`COMMDLG.DLL` seg6 `01e7`).
#[allow(clippy::unnecessary_wraps)]
fn comm_dlg_extended_error(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(error(system)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each export WinBox answers here is one the TypeScript engine
    /// answers, and no other: its table is `kept.rs`'s.
    #[test]
    fn ours_agree() {
        let kept = Kept::named(NAME).expect("COMMDLG kept");

        for export in kept.exports.iter().flatten() {
            assert_eq!(
                implementation(export.name).is_some(),
                !export.stub,
                "{} answered by one engine only",
                export.name
            );
        }
    }

    #[test]
    fn the_extended_error_is_ours() {
        assert!(ours(26));
    }
}
