//! Control Panel's MIDI Mapper on WinBox's mapper: Windows' own applet, in
//! the installation's `MIDIMAP.DRV`, reached through WinBox's mapper's
//! `CPlApplet`.
//!
//! **How Control Panel finds it**, read out of `CONTROL.EXE`: it walks
//! USER's installable drivers with `GetNextDriver` and
//! `GND_FIRSTINSTANCEONLY`, and for each asks `GetDriverModuleHandle`, then
//! `GetModuleFileName` (seg1 `6f8`-`760`); each file is loaded with
//! `LoadLibrary` and asked `GetProcAddress` for `CPlApplet` (seg1
//! `4ff`-`5b2`), which is called `CPL_INIT`, then `CPL_GETCOUNT` (`5c7`-
//! `5ed`), then `CPL_NEWINQUIRE` for each applet, `CPL_INQUIRE` where that
//! does not fill in its 0F2h bytes (`367`-`3d6`), `CPL_DBLCLK` to open one
//! (`c8a`) and `CPL_EXIT` before `FreeLibrary` as Control Panel ends
//! (`eeb`-`f04`). With WinBox's mapper the `midimapper` driver, its module
//! is the one Control Panel loads and asks.
//!
//! **The applet** is `MIDIMAP.DRV`'s `CPlApplet` (seg1 `11f`): one applet
//! (`CPL_GETCOUNT` 1), "MIDI Mapp&er", which `CPL_NEWINQUIRE` fills in and
//! `CPL_INQUIRE` does not (nought). Its dialogs and strings are the
//! driver's resources, and it reads and writes `MIDIMAP.CFG` itself: a
//! copy in a temporary file while its dialog is up, copied back once it
//! closes with a change (seg1 `1be`-`349`), a setup chosen made current in
//! the header's word at 6 (seg3 `15fe`). WinBox's mapper loads the driver
//! as a library for that, at `CPL_INIT`, and passes it every message; it
//! lets it go at `CPL_EXIT`. Loaded as a library the driver is not a
//! driver: nothing opens it or sends it `DRV_LOAD`, its `LibEntry` keeps
//! its instance and makes its local heap (seg1 `0`-`27`), and MMSYSTEM
//! never learns of it, so the mapper programs open stays WinBox's. With no
//! `MIDIMAP.DRV` there is no applet: `CPL_INIT` answers nought and Control
//! Panel lets the module go.
//!
//! **What the two halves share.** In Windows the applet and the mapper are
//! one module with one data segment, and keep out of each other's way by
//! two of its words: the setup the open mapper holds (`[1D4h]`) and a count
//! of the applet's dialogs editing the setups (`[502h]`). The dialog,
//! opened while the mapper is open, says it may change nothing (string
//! `93h`) and makes no copy (seg3 `116a`, seg1 `1c4`-`214`); the mapper,
//! opened while the dialog edits, answers `MMSYSERR_ALLOCATED` (seg2
//! `12b`-`14c`). Here they are two modules, so WinBox's mapper writes its
//! own open into the loaded driver's word at `1D4h` while the dialog runs,
//! and reads the word at `502h` as it is opened. **Recorded** by `mapcpl`.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::handles::Object;
use crate::system::System;

const CPL_INIT: u16 = 1;
const CPL_DBLCLK: u16 = 5;
const CPL_EXIT: u16 = 7;

/// Where Windows' MIDI Mapper is: the system directory.
pub const FILE: &str = "C:\\WINDOWS\\SYSTEM\\MIDIMAP.DRV";

/// The words of `MIDIMAP`'s data segment the applet and the mapper share:
/// the open mapper's setup, and the applet's dialogs editing.
const HELD: u16 = 0x1d4;
const EDITING: u16 = 0x502;

/// `MIDIMAP.DRV` loaded for its applet: the library, its `CPlApplet`, and
/// how many times `CPL_INIT` has loaded it.
#[derive(Debug, Clone, Copy)]
struct Loaded {
    library: u16,
    procedure: u32,
    loads: u16,
}

/// What WinBox's mapper keeps of the applet, and whether the mapper is
/// open, which the applet's dialog is told.
#[derive(Debug, Default)]
pub struct Applet {
    loaded: Option<Loaded>,
    /// WinBox's mapper is open.
    pub mapper_open: bool,
}

/// `CPlApplet(hwndCPl, uMsg, lParam1, lParam2)`: `MIDIMAP.DRV`'s answer.
pub fn cpl_applet(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (window, message, first, second) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        if message == CPL_INIT && !load(engine).await? {
            return Ok(Answer::Dword(0));
        }

        let Some(loaded) = engine.system().mapper_applet.loaded else {
            return Ok(Answer::Dword(0));
        };
        let held = message == CPL_DBLCLK && engine.system().mapper_applet.mapper_open;

        if held {
            set_word(&mut engine.system(), loaded.library, HELD, 1);
        }

        let args = [
            GuestArg::Word(window),
            GuestArg::Word(message),
            GuestArg::Long(first),
            GuestArg::Long(second),
        ];
        let answer = Box::pin(engine.call_with(loaded.procedure, &args, &[]))
            .await?
            .0;

        if held {
            set_word(&mut engine.system(), loaded.library, HELD, 0);
        }

        if message == CPL_EXIT || (message == CPL_INIT && answer == 0) {
            unload(engine).await?;
        }

        Ok(Answer::Dword(answer))
    })
}

/// `MIDIMAP.DRV` loaded, or loaded once more: false where it is not there
/// or has no applet.
async fn load(engine: &Engine) -> Result<bool, Stop> {
    let library = crate::modules_kernel::load_library_named(engine, FILE).await?;

    if library < 32 {
        return Ok(false);
    }

    let procedure = crate::modules_kernel::proc_named(&mut engine.system(), library, "CPlApplet");

    if procedure == 0 {
        crate::modules_kernel::free_library_handle(engine, library).await?;
        return Ok(false);
    }

    let mut system = engine.system();
    let loads = system.mapper_applet.loaded.map_or(0, |loaded| loaded.loads);

    system.mapper_applet.loaded = Some(Loaded {
        library,
        procedure,
        loads: loads + 1,
    });
    Ok(true)
}

/// `MIDIMAP.DRV` let go once, and forgotten once it has been let go as
/// often as it was loaded.
async fn unload(engine: &Engine) -> Result<(), Stop> {
    let Some(loaded) = engine.system().mapper_applet.loaded else {
        return Ok(());
    };

    engine.system().mapper_applet.loaded = (loaded.loads > 1).then_some(Loaded {
        loads: loaded.loads - 1,
        ..loaded
    });
    crate::modules_kernel::free_library_handle(engine, loaded.library).await
}

/// Whether the applet's dialog is editing the setups, by `MIDIMAP`'s own
/// count (`[502h]`), as its mapper's open asks (seg2 `132`).
pub fn editing(system: &System) -> bool {
    system
        .mapper_applet
        .loaded
        .and_then(|loaded| data_of(system, loaded.library))
        .is_some_and(|data| {
            let word = system.read_far(data | u32::from(EDITING), 2);

            u16::from_le_bytes([word[0], word[1]]) != 0
        })
}

/// A word of the loaded driver's data segment set.
fn set_word(system: &mut System, library: u16, at: u16, value: u16) {
    if let Some(data) = data_of(system, library) {
        system.write_far(data | u32::from(at), &value.to_le_bytes());
    }
}

/// The library's data segment, as a far pointer's selector.
fn data_of(system: &System, library: u16) -> Option<u32> {
    let Some(Object::Library(module)) = system.handles.resolve(library) else {
        return None;
    };
    let data = system.modules[module].data()?;

    Some(u32::from(winbox_machine::segment_selector(data)) << 16)
}
