//! `PROGMAN`, WinBox's own Program Manager: a task with no file, started
//! only where a program starts `PROGMAN.EXE` -- `WinExec` or `LoadModule`
//! -- and no such file is found; an installation's own `PROGMAN.EXE` is
//! Microsoft's, and runs. Never in an ordinary run, a probe's or the
//! corpus's. As `src/win16/progman/`. The design: `kb/topics/program-manager-dde.md`,
//! "In winbox.js".
//!
//! It is two halves, as a program and the library it calls are:
//!
//! - the program, a module made in memory (`image.rs`): its start-up the
//!   processor runs, its data segment its instance, made a task by the
//!   loader, the linker and `InitTask` as any program is; and
//! - WinBox's code, kept as a module of its own whose stubs the program
//!   calls (`MODULE`): `WinMain`, and the frame's window procedure, which
//!   are `PROGMAN.EXE`'s read out (`main.rs`), calling USER and KERNEL as
//!   the file calls them (`commdlg/api.rs`).
//!
//! `GetModuleHandle("PROGMAN")` finds the program's module, whose handle
//! is the kept module's: a program WinBox loads from a file has none yet
//! (`kb/kernel/getmodulehandle.md`).

mod commands;
mod dde;
pub mod image;
mod loaded;
pub(crate) mod main;
mod parse;

use std::collections::BTreeMap;

use crate::call::{Implementation, Stop};
use crate::engine::Engine;
use crate::modules::{Export, Kept};
use crate::system::{STEP, System};

/// The module's name, and its file's.
pub const NAME: &str = "PROGMAN";
pub const FILE: &str = "PROGMAN.EXE";
/// Where it says it is: the Windows directory, where `WinExec` looks
/// second.
pub const PATH: &str = "C:\\WINDOWS\\PROGMAN.EXE";

/// What WinBox's Program Manager keeps outside its instances' data: each
/// instance's groups as loaded (`loaded.rs`), by its instance.
#[derive(Debug, Default)]
pub struct State {
    pub(crate) instances: BTreeMap<u16, loaded::Groups>,
}

/// WinBox's code as the program links to it.
pub static MODULE: Kept = Kept {
    name: NAME,
    path: PATH,
    fixed: false,
    exports: &[
        None,
        Some(Export {
            name: "WINMAIN",
            pops: 10,
            returns: 2,
            stub: false,
        }),
        Some(Export {
            name: "FRAMEWNDPROC",
            pops: 10,
            returns: 4,
            stub: false,
        }),
    ],
};

/// The ordinals of `MODULE`'s exports.
pub(crate) const WINMAIN: u16 = 1;
pub(crate) const FRAME_PROC: u16 = 2;

/// The function that answers an export.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WINMAIN" => Implementation::Async(main::win_main),
        "FRAMEWNDPROC" => Implementation::Async(main::frame_proc),
        _ => return None,
    })
}

/// Whether a program asked for by its path, found nowhere, is Program
/// Manager's: its file's name `PROGMAN.EXE`, in whatever folder.
pub(crate) fn wanted(path: &str) -> bool {
    path.rsplit(['\\', ':', '/'])
        .next()
        .is_some_and(|file| file.eq_ignore_ascii_case(FILE))
}

/// The far address of one of `MODULE`'s exports: its stub.
pub(crate) fn export_address(system: &mut System, ordinal: u16) -> u32 {
    let kept = system.keep_on_load(&MODULE);
    let stubs = system.stubs(kept);

    u32::from(winbox_machine::segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

impl Engine {
    /// Program Manager started as `WinExec` starts a program, with no file:
    /// WinBox's code kept (its stubs made), its program loaded from the
    /// image, linked, `WinMain`'s address written where the start-up calls
    /// it from, its module given the kept module's handle, and the task
    /// run until it waits for a message. Its instance.
    pub(crate) async fn start_progman(
        &self,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
    ) -> Result<u16, Stop> {
        let child = {
            let mut system = self.system();
            let kept = system.keep_on_load(&MODULE);
            let strings = strings.or_else(|| system.environment_block());
            let executable = winbox_ne::Executable::parse(image::image())
                .map_err(|_| Stop::Unsupported("Program Manager's image"))?;
            let child =
                match system.add_executable(executable, PATH, command_line, show, strings, true)? {
                    Ok(child) => child,
                    Err(error) => return Ok(error),
                };
            let program = system.scheduler.slots[child].program;
            let winmain = export_address(&mut system, WINMAIN);

            if let Some(data) = system.modules[program].data() {
                let at = (data as u32) << 16 | u32::from(image::WINMAIN_SLOT);

                system.cpu.bus.write(at, &winmain.to_le_bytes());
            }

            system.modules[program].handle = system.kept[kept].handle();
            child
        };

        self.run_started(child).await
    }
}
