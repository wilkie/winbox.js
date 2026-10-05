//! The accessibility tree the Rust engine makes, held to the TypeScript
//! engine's at the same places of the same runs
//! (`test/raster/accessible-trees`, which `accessible_parity_test.ts`
//! writes): Notepad with its menus open and closed, Clock, a dialog of
//! buttons, an edit control and the rest as the keyboard moves through it,
//! one of each of USER's controls, and a program of the corpus.
//!
//! Each file names what was run, for how long, and its places, as a
//! corpus's report names them (`stepMarks`): the survey presses the keys
//! there and keeps a tree at each other place (`call_marks.rs`), each to
//! be the TypeScript engine's to the character. A window's key is the
//! desktop's number for it in both, from the order the windows are made,
//! not a handle, so nothing is set aside before they are compared.
//!
//! Without the oracle's installation, the probes or the corpus's
//! programs, what is not here passes with nothing to check.

mod support;

use std::path::PathBuf;

use winbox_machine::MemoryDrive;
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::survey::{self, Survey};

use support::{Setup, installed, root};

/// The trees' files.
fn trees() -> PathBuf {
    root().join("test/raster/accessible-trees")
}

/// The system a file's run is made on, its drives mounted, and the
/// program's path and bytes; `None` where any of it is not here.
fn made(run: &serde_json::Value) -> Option<(System, String, Vec<u8>)> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.is_dir() {
        return None;
    }

    let now = winbox_machine::host_seconds();

    // A probe, as the probes run: from C:\, A: and Z: beside it.
    if let Some(probe) = run["probe"].as_str() {
        let mut setup = Setup::of(probe)?;
        let mut c = installed(&setup.windows);

        assert!(c.add_folder("ORACLE", now));

        for (path, bytes) in &setup.placed {
            assert!(c.add_file(path, bytes.clone(), now));
        }

        setup.system.files.mount('A', MemoryDrive::removable());
        setup.system.files.mount('C', c);
        setup.system.files.mount('Z', MemoryDrive::new());

        let path = format!("C:\\{}.EXE", setup.upper);

        return Some((setup.system, path, setup.bytes));
    }

    // A program of the installation's, or of the corpus's, in its own
    // folder, as the corpus's programs are put.
    let path = run["path"].as_str()?.to_string();
    let (bytes, folder) = if let Some(file) = run["windows"].as_str() {
        let bytes = std::fs::read(windows.join("WINDOWS").join(file)).ok()?;

        (vec![(file.to_string(), bytes)], None)
    } else {
        let folder = root().join("corpus/programs").join(run["corpus"].as_str()?);

        (Vec::new(), Some(folder))
    };
    let (home, name) = path.rsplit_once('\\')?;
    let home = home.strip_prefix("C:\\")?;
    let mut c = installed(&windows);
    let mut at = String::new();

    for part in home.split('\\') {
        at = if at.is_empty() {
            part.to_string()
        } else {
            format!("{at}\\{part}")
        };
        assert!(c.add_folder(&at, now));
    }

    for (file, data) in bytes {
        assert!(c.add_file(&format!("{home}\\{file}"), data, now));
    }

    if let Some(folder) = folder {
        for entry in std::fs::read_dir(folder).ok()?.flatten() {
            if entry.file_type().ok()?.is_file() {
                let file = entry.file_name().to_string_lossy().to_ascii_uppercase();

                assert!(c.add_file(
                    &format!("{home}\\{file}"),
                    std::fs::read(entry.path()).ok()?,
                    now
                ));
            }
        }
    }

    let data = c.data(&format!("{home}\\{name}"))?.to_vec();
    let mut system = System::new();

    system.files.mount('C', c);

    Some((system, path, data))
}

/// A file's run surveyed to its last place: the trees it kept.
fn kept(text: &str) -> Option<Vec<String>> {
    let file: serde_json::Value = serde_json::from_str(text).unwrap();
    let (mut system, path, bytes) = made(&file["run"])?;
    // As long as the TypeScript engine's run, whose frames may take it past
    // its seconds: to its last place, and half a second more.
    let last = file["stepMarks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|mark| mark["time"].as_f64())
        .fold(0.0, f64::max);
    let survey = Survey {
        seconds: file["seconds"].as_f64().unwrap().max(last / 1000.0) + 0.5,
        budget: 4_000_000_000,
        marks: Some(text.to_string()),
        ..Survey::default()
    };

    survey::start(&mut system, Executable::parse(bytes).unwrap(), &path).unwrap();

    let mut surveyed = survey.run(system);

    Some(std::mem::take(&mut surveyed.system.call_marks.trees))
}

#[test]
fn the_trees_are_the_typescript_engines() {
    let mut checked = 0;

    for entry in std::fs::read_dir(trees()).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let text = std::fs::read_to_string(entry.path()).unwrap();
        let file: serde_json::Value = serde_json::from_str(&text).unwrap();
        let Some(made) = kept(&text) else {
            continue;
        };
        let expected: Vec<&str> = file["trees"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tree| tree.as_str().unwrap())
            .collect();

        assert_eq!(made.len(), expected.len(), "{name}: the trees kept");

        for (at, (made, expected)) in made.iter().zip(&expected).enumerate() {
            assert_eq!(made, expected, "{name}: tree {at}");
        }

        checked += 1;
    }

    eprintln!("{checked} runs' trees checked");
}
