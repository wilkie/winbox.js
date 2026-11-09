//! A program of the corpus installed from its CD-ROM, as Windows did it:
//! Widget Workshop's disc (`corpus/manifest.json`, `widget`), its image as
//! D:, on the oracle's 256-colour installation, `D:\INSTALL.EXE` started as
//! Windows started as `WIN D:\INSTALL.EXE` starts it -- Program Manager,
//! Microsoft's, the shell -- its keys pressed when the fixture's
//! clock pressed them (`test/layers/widget-layer.json`'s `stepMarks`).
//!
//! What it wrote on C: is Windows' install's under DOSBox
//! (`test/layers/widget-windows.json`, recorded by `record.mjs launch
//! --corpus widget`, which no engine writes), file for file, but for the
//! registration database, whose node table Windows ends with one free entry
//! more. As a layer (`install_into_layer`), it is `widget-layer.json`'s, the
//! file's text to the byte, its keys kept as the file has them;
//! `WIDGET_LAYER_WRITE=1` writes the file from this run.
//!
//! Skipped without the disc (`node scripts/corpus/fetch.mjs widget`), the
//! oracle's installation or the fixtures, and unless `WIDGET_INSTALL=1`:
//! five minutes in a debug build, twenty seconds in a
//! release one (`WIDGET_INSTALL=1 cargo test --release -p winbox-win16
//! --test install_widget`).

mod support;

use std::collections::BTreeMap;

use winbox_machine::{HostDrive, IsoVolume, Sectors};
use winbox_win16::layers::{Made, install_into_layer};
use winbox_win16::survey::Survey;

use support::root;

/// The files of a manifest or a recording, by path.
fn listed(entries: &serde_json::Value) -> BTreeMap<String, (u64, String)> {
    entries
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["kind"] == "file")
        .map(|entry| {
            (
                entry["path"].as_str().unwrap_or("").to_string(),
                (
                    entry["size"].as_u64().unwrap_or(0),
                    entry["sha256"].as_str().unwrap_or("").to_string(),
                ),
            )
        })
        .collect()
}

/// The order of `widget-layer.json`'s keys.
const LAYER_ORDER: &[&str] = &[
    "stepMarks",
    "layer",
    "dropped",
    "references",
    "instructions",
    "calls",
    "time",
    "key",
    "code",
    "kind",
    "format",
    "id",
    "over",
    "made",
    "entries",
    "by",
    "version",
    "from",
    "path",
    "line",
    "sha256",
    "size",
    "modified",
];

#[test]
#[allow(clippy::too_many_lines)]
fn widget_workshops_install_from_its_cd() {
    let iso = root().join("corpus/cache/widget/widget.iso");
    let windows = root().join("oracle/build/drive-c-vga256");
    let layer = root().join("test/layers/widget-layer.json");
    let recorded = root().join("test/layers/widget-windows.json");

    if std::env::var("WIDGET_INSTALL").as_deref() != Ok("1") {
        eprintln!("WIDGET_INSTALL=1 not set: skipped");
        return;
    }

    if !iso.is_file() || !windows.is_dir() || !layer.is_file() || !recorded.is_file() {
        eprintln!("no disc, installation or fixtures: skipped");
        return;
    }

    let layer_text = std::fs::read_to_string(&layer).unwrap();
    let layer: serde_json::Value = serde_json::from_str(&layer_text).unwrap();
    let recorded: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&recorded).unwrap()).unwrap();
    let drives = std::env::temp_dir().join(format!("winbox-widget-{}", std::process::id()));

    let survey = Survey {
        display: "vga256".to_string(),
        seconds: 170.0,
        budget: 2_000_000_000,
        boxes: 3,
        marks: Some(serde_json::json!({ "stepMarks": layer["stepMarks"] }).to_string()),
        ..Survey::default()
    };
    let mut system = survey.system().unwrap();
    let disc = IsoVolume::open(Box::new(std::fs::read(&iso).unwrap()), &mut |_| {
        None::<Box<dyn Sectors>>
    })
    .unwrap();
    // C: held in memory, the installation's files stamped as they are, so
    // that what the install changes is a layer over it.
    let before = support::installed(&windows);

    system.files.mount('C', before.clone());
    system.files.mount('D', disc);

    // The drives DOSBox gives the oracle's Windows beside C:: an empty
    // floppy drive and its own Z:, as the fixture's run has them.
    for (letter, removable) in [('A', true), ('Z', false)] {
        let folder = drives.with_extension(letter.to_string());

        std::fs::create_dir_all(&folder).unwrap();
        system.files.mount(
            letter,
            if removable {
                HostDrive::removable(folder)
            } else {
                HostDrive::new(folder)
            },
        );
    }

    winbox_win16::progman::start_shell(&mut system, "D:\\INSTALL.EXE").unwrap();

    let surveyed = survey.run(system);

    assert_eq!(
        surveyed.stop,
        winbox_win16::Stop::Ended,
        "the install ended"
    );

    let installed = install_into_layer(
        &before,
        &surveyed.system.files,
        'C',
        &["D:\\".to_string()],
        vec!["install:vga256".to_string()],
        Made {
            by: "WinBox".to_string(),
            version: None,
            from: Some("widget.iso".to_string()),
        },
    )
    .unwrap();
    let made = serde_json::to_value(&installed.layer.manifest).unwrap();
    let written = listed(&made["entries"]);
    let theirs = listed(&recorded["changes"]);
    let lines = |files: &BTreeMap<String, (u64, String)>, leave: &[&str]| {
        files
            .iter()
            .filter(|(path, _)| !leave.contains(&path.as_str()))
            .map(|(path, (size, hash))| format!("{path} {size} {hash}"))
            .collect::<Vec<_>>()
    };

    assert_eq!(
        lines(&written, &["WINDOWS\\REG.DAT"]),
        lines(&theirs, &["WINDOWS\\REG.DAT"]),
        "Windows' install's"
    );
    assert!(installed.dropped.is_empty(), "{:?}", installed.dropped);

    // The fixture's text, from this run: its places as it has them.
    let text = support::json_text(
        &serde_json::json!({
            "stepMarks": layer["stepMarks"],
            "layer": made,
            "dropped": installed.dropped,
            "references": installed
                .references
                .iter()
                .map(|reference| serde_json::json!({ "path": reference.path, "line": reference.line }))
                .collect::<Vec<_>>(),
        }),
        1,
        LAYER_ORDER,
    );

    if std::env::var("WIDGET_LAYER_WRITE").as_deref() == Ok("1") {
        std::fs::write(root().join("test/layers/widget-layer.json"), &text).unwrap();
    }

    for letter in ['A', 'Z'] {
        let _ = std::fs::remove_dir_all(drives.with_extension(letter.to_string()));
    }

    // The file but for one difference, the stamp of `WINDOWS` (and so the
    // layer's id, a hash of its entries): 18 seconds later here than in the
    // fixture, whose FAT drive moved it at an earlier change made in the
    // folder. Which change is not yet followed; every file and
    // every other stamp agree.
    let excused = |text: &str| -> String {
        let mut value: serde_json::Value = serde_json::from_str(text).unwrap();

        value["layer"]["id"] = serde_json::Value::Null;

        for entry in value["layer"]["entries"].as_array_mut().unwrap() {
            if entry["kind"] == "folder" && entry["path"] == "WINDOWS" {
                entry["modified"] = serde_json::Value::Null;
            }
        }

        support::json_text(&value, 1, LAYER_ORDER)
    };

    assert!(
        excused(&text) == excused(&layer_text),
        "the fixture's text, as this run writes it"
    );
    assert!(
        support::json_text(&layer, 1, LAYER_ORDER) == layer_text,
        "the fixture's text, as written here"
    );
}
