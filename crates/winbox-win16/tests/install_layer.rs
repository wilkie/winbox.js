//! An installer run into a layer (`kb/formats/layer.md`, "An installer
//! into a layer"), held to the oracle: `instlay` installs a program, and
//! the program it installed, `INSTLAYC.EXE`, reads back what it left, both
//! recorded in one DOSBox session (`oracle/probes/instlay.c`,
//! `instlay.child.c`).
//!
//! Here the installer runs on the base `WINBOX_BASE` chooses, its media --
//! itself and the program beside it in `C:\WINDOWS`, where the recorder
//! puts them -- placed on C: under an empty top, and writes what Windows
//! wrote. Its top's changes are made a layer over the base, the media
//! discarded (`Layer::installed`), and the installed program run alone on
//! the base and that layer reads back what it read back on Windows, record
//! for record. The TypeScript harness's twin is
//! `test/layers/install_test.ts`.

mod support;

use winbox_machine::MemoryDrive;
use winbox_win16::Stop;
use winbox_win16::layers::{Installed, LayerEntry, Made, base_name, install_into_layer};

use support::{Base, Setup, bundle, fixture_display, recorded, run_drive};

/// The installer's media, where the recorder puts them: itself, and the
/// program it installs, beside Windows; and `C:\ORACLE`, where the harness
/// keeps its records.
const MEDIA: [&str; 3] = ["WINDOWS\\INSTLAY.EXE", "WINDOWS\\INSTLAYC.EXE", "ORACLE"];

/// The stack's base, as a layer's `over` names it.
fn base_of() -> String {
    let display = fixture_display("instlay");

    match Base::chosen() {
        Base::Assets | Base::Layers => base_name(&bundle().expect("the asset bundle").id, &display),
        Base::Installed => format!("install:{display}"),
    }
}

/// The installer run over the base, its media placed under an empty top:
/// its records, why it stopped, and its top as a layer, the media dropped.
fn install() -> Option<(Stop, Vec<[String; 3]>, Installed)> {
    let mut setup = Setup::of("instlay")?;
    let now = winbox_machine::host_seconds();
    let mut before = setup.beneath.held();

    assert!(before.add_folder("ORACLE", now));

    // The installer where the recorder puts it, beside Windows, and the
    // program it installs from there.
    setup.program = "C:\\WINDOWS\\INSTLAY.EXE".to_string();
    assert!(before.add_file("WINDOWS\\INSTLAY.EXE", setup.bytes.clone(), now));

    for (path, bytes) in &setup.placed {
        if path != "INSTLAY.EXE" {
            assert!(before.add_file(path, bytes.clone(), now));
        }
    }

    let over = vec![base_of()];
    let (stop, records, system) = run_drive(setup, before.clone(), "instlay", |_| ());
    let media: Vec<String> = MEDIA.iter().map(|path| (*path).to_string()).collect();
    let installed = install_into_layer(
        &before,
        &system.files,
        'C',
        &media,
        over,
        Made {
            by: "WinBox probe harness".to_string(),
            version: None,
            from: Some("instlay".to_string()),
        },
    )
    .expect("the installer's layer");

    Some((stop, records, installed))
}

/// The program installed run alone on the base and the installer's layer,
/// started from where it was installed: its records.
fn installed_program(installed: &Installed) -> Option<(Stop, Vec<[String; 3]>)> {
    let mut setup = Setup::of("instlay")?;
    let now = winbox_machine::host_seconds();
    let mut c: MemoryDrive = setup.beneath.held();

    c.apply(&installed.layer.changes().expect("the layer's changes"));
    assert!(c.add_folder("ORACLE", now));
    setup.bytes = c
        .data("INSTLAY\\INSTLAYC.EXE")
        .expect("the program installed")
        .to_vec();
    setup.program = "C:\\INSTLAY\\INSTLAYC.EXE".to_string();
    setup.placed.clear();

    let (stop, records, _) = run_drive(setup, c, "instlay", |_| ());

    Some((stop, records))
}

/// Records as lines, for a difference that reads.
fn lines(records: &[[String; 3]]) -> Vec<String> {
    records
        .iter()
        .map(|[function, args, result]| format!("{function}({args}) = {result}"))
        .collect()
}

#[test]
fn an_installer_into_a_layer_and_the_program_it_installed() {
    let Some(recorded) = recorded("instlay") else {
        return;
    };
    let Some((stop, records, installed)) = install() else {
        eprintln!("instlay is not built: node scripts/oracle/build-probes.mjs instlay");
        return;
    };

    // The installer's session as Windows' was: its records, and those of
    // the program it started at its end.
    assert_eq!(stop, Stop::Ended, "the installer stopped");
    assert_eq!(lines(&records), lines(&recorded), "the installer's session");

    // Its layer: what it wrote, and nothing of the media's.
    let entries: Vec<String> = installed
        .layer
        .manifest
        .entries
        .iter()
        .map(|entry| match entry {
            LayerEntry::Removed { path } => format!("removed {path}"),
            LayerEntry::Folder { path, .. } => format!("folder {path}"),
            LayerEntry::File { path, .. } => format!("file {path}"),
        })
        .collect();

    assert_eq!(
        entries,
        [
            "removed WINDOWS\\SYSTEM\\SETUP.REG",
            "folder INSTLAY",
            "folder WINDOWS",
            "folder WINDOWS\\SYSTEM",
            "folder WINDOWS\\TEMP",
            "file INSTLAY\\INSTLAY.INI",
            "file INSTLAY\\INSTLAYC.EXE",
            "file INSTLAY\\README.TXT",
            "file WINDOWS\\INSTLAY.INI",
            "file WINDOWS\\SYSTEM\\INSTLAY.DLL",
            "file WINDOWS\\WIN.INI",
        ],
        "the installer's layer"
    );
    // Of the media, only the harness's records were written: `ORACLE`'s
    // own stamp moves where the run's first record is written in a later
    // second of the host's than the folder was made in.
    assert!(
        installed
            .dropped
            .iter()
            .any(|path| path == "ORACLE\\INSTLAY.OUT")
            && installed
                .dropped
                .iter()
                .all(|path| path == "ORACLE" || path == "ORACLE\\INSTLAY.OUT"),
        "what was dropped of the media: {:?}",
        installed.dropped
    );
    // What it wrote that names its media, kept as it wrote it.
    assert_eq!(
        installed
            .references
            .iter()
            .map(|reference| format!("{}: {}", reference.path, reference.line))
            .collect::<Vec<_>>(),
        ["WINDOWS\\WIN.INI: Media=C:\\WINDOWS\\INSTLAY.EXE"],
        "what names the media"
    );

    // The program installed, alone on the base and the layer, reads back
    // what it read back on Windows.
    let (stop, records) = installed_program(&installed).expect("instlay is built");
    let read_back: Vec<[String; 3]> = recorded
        .iter()
        .filter(|[function, ..]| function.starts_with("c."))
        .cloned()
        .collect();

    assert_eq!(stop, Stop::Ended, "the program installed stopped");
    assert_eq!(
        lines(&records),
        lines(&read_back),
        "the program installed, on the base and the layer"
    );
}
