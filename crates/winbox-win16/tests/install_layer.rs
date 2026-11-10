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
//! for record.
//!
//! The installer's top's changes and the layer made of them are written to
//! `test/layers/instlay-layer.json` (`INSTLAY_WRITE=1`, on the installed
//! base), which `test/layers/install_test.ts` makes the layer of with the
//! page's own `installedLayer`, so that page code is held to this run.

mod support;

use std::fmt::Write as _;

use serde_json::{Value, json};
use winbox_machine::{Change, MemoryDrive};
use winbox_win16::Stop;
use winbox_win16::layers::{
    Installed, LayerEntry, Made, base_name, changes_seen, install_into_layer,
};

use support::{Base, Setup, bundle, fixture_display, recorded, root, run_drive};

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

/// What `install` gives: why the installer stopped, its records, its layer
/// and the changes it was made of.
type Install = (Stop, Vec<[String; 3]>, Installed, Vec<Change>);

/// The installer run over the base, its media placed under an empty top:
/// its records, why it stopped, its top as a layer, the media dropped, and
/// the top's changes.
fn install() -> Option<Install> {
    let mut setup = Setup::of("instlay")?;
    // Everything placed is stamped at the instant the machine's clock
    // starts from, not the host's: the probe's writes into `ORACLE` are
    // stamped by that clock, and a host second other than it would show
    // the folder as changed.
    let now = setup.system.epoch_ms / 1000;
    let mut before = setup.beneath.held();

    assert!(before.add_folder("ORACLE", now));

    // The installer where the recorder puts it, beside Windows, and the
    // program it installs from there.
    setup.program = "C:\\WINDOWS\\INSTLAY.EXE".to_string();
    setup.install = true;
    assert!(before.add_file("WINDOWS\\INSTLAY.EXE", setup.bytes.clone(), now));

    for (path, bytes) in &setup.placed {
        if path != "INSTLAY.EXE" {
            assert!(before.add_file(path, bytes.clone(), now));
        }
    }

    let over = vec![base_of()];
    let (stop, records, system) = run_drive(setup, before.clone(), "instlay", |_| ());
    let media: Vec<String> = MEDIA.iter().map(|path| (*path).to_string()).collect();
    let changes = changes_seen(&system.files, 'C', &before).expect("C: held in memory");
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

    Some((stop, records, installed, changes))
}

/// A change as `test/layers/instlay-layer.json` keeps it, as the page's
/// `Change` is: a file's bytes in hex.
fn change_json(change: &Change) -> Value {
    match change {
        Change::Removed { path } => json!({ "kind": "removed", "path": path }),
        Change::Folder { path, modified } => {
            json!({ "kind": "folder", "path": path, "modified": modified })
        }
        Change::File {
            path,
            data,
            modified,
        } => json!({
            "kind": "file",
            "path": path,
            "data": data.iter().fold(String::new(), |mut text, byte| {
                let _ = write!(text, "{byte:02x}");
                text
            }),
            "modified": modified,
        }),
    }
}

/// The fixture the page's test reads: written under `INSTLAY_WRITE`, else
/// held to this run. The run's stamps are its virtual clock's, the same
/// each time.
fn hold_fixture(changes: &[Change], installed: &Installed) {
    let path = root().join("test/layers/instlay-layer.json");
    let now = json!({
        "about": "The instlay installer's top's changes on the installed VGA base, and the layer the Rust engine made of them (Layer::installed: media WINDOWS\\INSTLAY.EXE, WINDOWS\\INSTLAYC.EXE, ORACLE). Written by crates/winbox-win16/tests/install_layer.rs with INSTLAY_WRITE=1; test/layers/install_test.ts makes the layer of the changes with the page's installedLayer and holds it to this one.",
        "media": MEDIA,
        "changes": changes.iter().map(change_json).collect::<Vec<_>>(),
        "manifest": installed.layer.manifest,
        "dropped": installed.dropped,
        "references": installed
            .references
            .iter()
            .map(|reference| json!({ "path": reference.path, "line": reference.line }))
            .collect::<Vec<_>>(),
    });

    if std::env::var_os("INSTLAY_WRITE").is_some() {
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&now).unwrap()),
        )
        .expect("the fixture written");
        return;
    }

    let kept: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("the fixture")).unwrap();

    assert!(
        now == kept,
        "{} differs: INSTLAY_WRITE=1 writes it",
        path.display()
    );
}

/// The program installed run alone on the base and the installer's layer,
/// started from where it was installed: its records.
fn installed_program(installed: &Installed) -> Option<(Stop, Vec<[String; 3]>)> {
    let mut setup = Setup::of("instlay")?;
    let now = setup.system.epoch_ms / 1000;
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
    let Some((stop, records, installed, changes)) = install() else {
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

    // Program Manager, the run's shell, writes `PROGMAN.INI`'s
    // `display.drv=` as it starts, a change only on the bundle's base, which
    // has no `PROGMAN.INI` (`kb/topics/program-manager-dde.md`).
    let mut expected = vec![
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
    ];

    if Base::chosen() != Base::Installed {
        expected.insert(9, "file WINDOWS\\PROGMAN.INI");
    }

    assert_eq!(entries, expected, "the installer's layer");
    // Of the media, only the harness's records were written.
    assert_eq!(
        installed.dropped,
        ["ORACLE\\INSTLAY.OUT"],
        "what was dropped of the media"
    );
    // What it wrote that names its media, kept as it wrote it.
    assert_eq!(
        installed
            .references
            .iter()
            .map(|reference| format!("{}: {}", reference.path, reference.line))
            .collect::<Vec<_>>(),
        ["WINDOWS\\WIN.INI: Media=C:\\WINDOWS\\INSTLAYC.EXE"],
        "what names the media"
    );

    if Base::chosen() == Base::Installed {
        hold_fixture(&changes, &installed);
    }

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
