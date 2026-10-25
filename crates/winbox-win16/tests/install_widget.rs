//! A program of the corpus installed from its CD-ROM, as Windows did it:
//! Widget Workshop's disc (`corpus/manifest.json`, `widget`), its image as
//! D:, on the oracle's 256-colour installation, `D:\INSTALL.EXE` started as
//! Windows started as `WIN D:\INSTALL.EXE` starts it -- Program Manager,
//! Microsoft's, the shell -- its keys pressed when the TypeScript engine's
//! clock pressed them (`test/layers/widget-layer.json`'s `stepMarks`).
//!
//! What it wrote on C: is the TypeScript engine's layer's files, byte for
//! byte (`test/layers/widget_test.ts`), and Windows' install's under DOSBox
//! (`test/layers/widget-windows.json`), but for the registration database,
//! whose node table Windows ends with one free entry more.
//!
//! Skipped without the disc (`node scripts/corpus/fetch.mjs widget`), the
//! oracle's installation or the fixtures, and unless `WIDGET_INSTALL=1`, as
//! `widget_test.ts` is: five minutes in a debug build, twenty seconds in a
//! release one (`WIDGET_INSTALL=1 cargo test --release -p winbox-win16
//! --test install_widget`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use winbox_machine::{HostDrive, IsoVolume, Sectors};
use winbox_win16::sha256::sha256_hex;
use winbox_win16::survey::Survey;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every file under a folder, by its DOS path, with its size and SHA-256.
fn files_of(folder: &Path, at: &str, into: &mut BTreeMap<String, (u64, String)>) {
    let mut entries: Vec<_> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .collect();

    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_ascii_uppercase();
        let path = if at.is_empty() {
            name
        } else {
            format!("{at}\\{name}")
        };

        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            files_of(&entry.path(), &path, into);
        } else {
            let bytes = std::fs::read(entry.path()).unwrap();

            into.insert(path, (bytes.len() as u64, sha256_hex(&bytes)));
        }
    }
}

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

#[test]
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

    let layer: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&layer).unwrap()).unwrap();
    let recorded: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&recorded).unwrap()).unwrap();
    let top = std::env::temp_dir().join(format!("winbox-widget-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&top);
    std::fs::create_dir_all(&top).unwrap();

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

    system
        .files
        .mount('C', HostDrive::over(top.clone(), windows));
    system.files.mount('D', disc);

    // The drives DOSBox gives the oracle's Windows beside C:: an empty
    // floppy drive and its own Z:, as the TypeScript engine's run has them.
    for (letter, removable) in [('A', true), ('Z', false)] {
        let folder = top.with_extension(letter.to_string());

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

    let mut written = BTreeMap::new();

    files_of(&top, "", &mut written);

    let ours = listed(&layer["layer"]["entries"]);
    let theirs = listed(&recorded["changes"]);
    let lines = |files: &BTreeMap<String, (u64, String)>, leave: &[&str]| {
        files
            .iter()
            .filter(|(path, _)| !leave.contains(&path.as_str()))
            .map(|(path, (size, hash))| format!("{path} {size} {hash}"))
            .collect::<Vec<_>>()
    };

    assert_eq!(
        lines(&written, &[]),
        lines(&ours, &[]),
        "the TypeScript engine's"
    );
    assert_eq!(
        lines(&written, &["WINDOWS\\REG.DAT"]),
        lines(&theirs, &["WINDOWS\\REG.DAT"]),
        "Windows' install's"
    );

    for letter in ['A', 'Z'] {
        let _ = std::fs::remove_dir_all(top.with_extension(letter.to_string()));
    }

    let _ = std::fs::remove_dir_all(&top);
}
