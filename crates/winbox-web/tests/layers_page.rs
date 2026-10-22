//! The page's C: from a stack of layers, on the Rust engine
//! (`kb/formats/layer.md`; `src/run/drive.ts`'s `planDrive` with a stack,
//! `src/run/engines/rust.ts`'s `#make`): the machine's drive filled as the
//! page fills it -- the base's folders, the files, then the folders the
//! layers make or stamp (`add_folder`) -- holds what the stack flattened
//! holds, marked as planned it tells nothing, and what a program writes on
//! a program's stack is told against that stack and put back on it.
//!
//! The plan is the TypeScript page's own, `test/run/stack-plan.json`, of
//! `test/layers/stack.json`'s first stack (`test/run/layers_test.ts`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::Value;
use winbox_machine::{Change, host_seconds, instant_ms};
use winbox_web::session::{Made, Session, State};
use winbox_win16::assets::{Assets, Composed, Placement, STAMP};
use winbox_win16::layers::{Flat, Layer, Made as LayerMade, flatten};
use winbox_win16::sha256::sha256_hex;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn json(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(root().join(path)).unwrap()).unwrap()
}

fn bytes(text: &Value) -> Vec<u8> {
    text.as_str().unwrap().chars().map(|c| c as u8).collect()
}

fn session() -> Session {
    Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: instant_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap()
}

/// The fixture's base, as `test/layers/layer_test.ts` composes it.
fn base(fixture: &Value) -> Composed {
    let base = &fixture["base"];

    Composed {
        directories: base["directories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| path.as_str().unwrap().to_string())
            .collect(),
        files: base["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| Placement {
                path: file[0].as_str().unwrap().to_string(),
                data: bytes(&file[1]),
                modified: file[2].as_i64().unwrap(),
            })
            .collect(),
    }
}

fn changes_of(fixture: &Value, name: &str) -> Vec<Change> {
    fixture["layers"][name]["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| {
            let path = change[1].as_str().unwrap().to_string();

            match change[0].as_str().unwrap() {
                "removed" => Change::Removed { path },
                "folder" => Change::Folder {
                    path,
                    modified: change[2].as_i64().unwrap(),
                },
                _ => Change::File {
                    path,
                    data: Rc::new(bytes(&change[2])),
                    modified: change[3].as_i64().unwrap(),
                },
            }
        })
        .collect()
}

/// The fixture's stack by its names, each layer's `over` the ids beneath.
fn stack(fixture: &Value, names: &[Value]) -> Vec<Layer> {
    let mut made: HashMap<String, Layer> = HashMap::new();
    let display = fixture["base"]["display"].as_str().unwrap();

    made.insert(
        "base".to_string(),
        Layer::base(
            &base(fixture),
            fixture["base"]["assets"].as_str().unwrap(),
            display,
        ),
    );

    for name in ["A", "B", "C", "D"] {
        let spec = &fixture["layers"][name];
        let over = spec["over"]
            .as_array()
            .unwrap()
            .iter()
            .map(|other| made[other.as_str().unwrap()].manifest.id.clone())
            .collect();
        let by: LayerMade = serde_json::from_value(spec["made"].clone()).unwrap();

        made.insert(
            name.to_string(),
            Layer::from_changes(&changes_of(fixture, name), over, by).unwrap(),
        );
    }

    names
        .iter()
        .map(|name| made[name.as_str().unwrap()].clone())
        .collect()
}

/// Everything on a drive told as changes from nothing, as a flattened
/// stack's lines.
fn lines(changes: &[Change]) -> Vec<String> {
    let mut folders = Vec::new();
    let mut files = Vec::new();

    for change in changes {
        match change {
            Change::Folder { path, modified } => folders.push(format!("folder {path} {modified}")),
            Change::File {
                path,
                data,
                modified,
            } => files.push(format!(
                "file {path} {} {} {modified}",
                sha256_hex(data),
                data.len()
            )),
            Change::Removed { path } => panic!("{path} removed from nothing"),
        }
    }

    let key = |line: &String| line.split(' ').nth(1).unwrap().to_string();

    folders.sort_by_key(key);
    files.sort_by_key(key);
    folders.into_iter().chain(files).collect()
}

#[test]
fn the_pages_drive_from_a_stack_holds_the_stack_flattened() {
    let fixture = json("test/layers/stack.json");
    let plan = json("test/run/stack-plan.json");
    let layers = stack(&fixture, plan["stack"].as_array().unwrap());
    let flat: Flat = flatten(&layers).unwrap();

    // Every blob of the stack, by its hash, as the page has them.
    let blobs: HashMap<String, Vec<u8>> = layers
        .iter()
        .flat_map(|layer| layer.blobs.iter())
        .map(|(hash, data)| (hash.clone(), data.to_vec()))
        .collect();
    let mut session = session();

    for folder in plan["folders"].as_array().unwrap() {
        assert!(session.add_folder(
            'C',
            folder[0].as_str().unwrap(),
            folder[1].as_i64().unwrap()
        ));
    }

    for placement in plan["placements"].as_array().unwrap() {
        assert!(session.add_file(
            'C',
            placement[0].as_str().unwrap(),
            blobs[placement[1].as_str().unwrap()].clone(),
            placement[2].as_i64().unwrap()
        ));
    }

    for folder in plan["stamps"].as_array().unwrap() {
        assert!(session.add_folder(
            'C',
            folder[0].as_str().unwrap(),
            folder[1].as_i64().unwrap()
        ));
    }

    // Before it is marked, the drive is told against nothing: all of it.
    assert_eq!(lines(&session.changes('C')), flat.lines());
    assert_eq!(
        flat.lines(),
        fixture["expected"]["flat"]
            .as_array()
            .unwrap()
            .iter()
            .map(|line| line.as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    );

    // Marked as planned, nothing; a program's user layer put back, it.
    session.mark_planned();
    assert_eq!(session.changes('C'), []);

    let user = [
        Change::Folder {
            path: "GAME".to_string(),
            modified: 825_638_400,
        },
        Change::File {
            path: "GAME\\SAVE3.DAT".to_string(),
            data: Rc::new(b"saved".to_vec()),
            modified: 825_638_400,
        },
    ];

    for change in &user {
        match change {
            Change::Folder { path, modified } => assert!(session.add_folder('C', path, *modified)),
            Change::File {
                path,
                data,
                modified,
            } => assert!(session.add_file('C', path, data.to_vec(), *modified)),
            Change::Removed { .. } => unreachable!(),
        }
    }

    assert_eq!(session.changes('C'), user);
}

/// The run stepped until the program has ended, or ten seconds of the
/// host's pass.
fn finish(session: &mut Session) {
    let deadline = instant_ms() + 10_000.0;

    loop {
        let state = session.step(instant_ms() + 10.0);

        session.take_calls(false);

        if matches!(state, State::Stopped | State::Waiting) || instant_ms() > deadline {
            return;
        }
    }
}

/// A machine as the page makes one for a kept program on the bundle's
/// base: the base's folders and files, the program's layer -- its archive
/// laid at `C:\ORACLE`, the folder at the page's stamp (`programLayer`) --
/// marked as planned, and its user layer put back.
fn program_machine(bundle: &Assets, layer: &Layer, kept: &[Change]) -> Session {
    let mut session = session();
    let composed = bundle.compose("vga").unwrap();

    session.stay_up();

    for (name, bytes) in &bundle.modules {
        session.add_module(name, bytes.clone());
    }

    for folder in &composed.directories {
        assert!(session.add_folder('C', &folder.replace('/', "\\"), STAMP));
    }

    for file in &composed.files {
        assert!(session.add_file(
            'C',
            &file.path.replace('/', "\\"),
            file.data.clone(),
            file.modified
        ));
    }

    for change in layer.changes().unwrap() {
        if let Change::File {
            path,
            data,
            modified,
        } = change
        {
            assert!(session.add_file('C', &path, data.to_vec(), modified));
        }
    }

    for change in layer.changes().unwrap() {
        if let Change::Folder { path, modified } = change {
            assert!(session.add_folder('C', &path, modified));
        }
    }

    session.mark_planned();

    for change in kept {
        match change {
            Change::Removed { path } => assert!(session.remove('C', path)),
            Change::Folder { path, modified } => assert!(session.add_folder('C', path, *modified)),
            Change::File {
                path,
                data,
                modified,
            } => assert!(session.add_file('C', path, data.to_vec(), *modified)),
        }
    }

    session
}

#[test]
fn what_a_kept_program_writes_is_told_against_its_stack_and_put_back() {
    let probe = root().join("oracle/build/probes/STRINGS.EXE");
    let (Ok(bundle), Ok(probe)) = (
        Assets::open(&root().join("oracle/build/assets")),
        std::fs::read(&probe),
    ) else {
        eprintln!("skipped: the asset bundle, or the strings probe, is not made");
        return;
    };

    // The archive `oracle.zip` dropped, kept as a layer over nothing.
    let layer = Layer::from_changes(
        &[
            Change::Folder {
                path: "ORACLE".to_string(),
                modified: STAMP,
            },
            Change::File {
                path: "ORACLE\\STRINGS.EXE".to_string(),
                data: Rc::new(probe),
                modified: STAMP,
            },
        ],
        Vec::new(),
        LayerMade {
            by: "WinBox run page".to_string(),
            version: None,
            from: Some("oracle.zip".to_string()),
        },
    )
    .unwrap();
    let mut session = program_machine(&bundle, &layer, &[]);

    assert_eq!(session.changes('C'), []);
    session.start("C:\\ORACLE\\STRINGS.EXE").unwrap();
    finish(&mut session);

    // Only what it wrote: the layer's folder, written then, and its file.
    let changes = session.changes('C');

    assert!(
        changes
            .iter()
            .any(|change| change.path() == "ORACLE\\STRINGS.OUT"),
        "{changes:?}"
    );
    assert!(changes.iter().all(|change| matches!(
        change,
        Change::File { path, .. } if path == "ORACLE\\STRINGS.OUT"
    ) || matches!(
        change,
        Change::Folder { path, .. } if path == "ORACLE"
    )));

    // Kept, and put back on the same stack made afresh: told the same.
    let again = program_machine(&bundle, &layer, &changes);

    assert_eq!(again.changes('C'), changes);
}
