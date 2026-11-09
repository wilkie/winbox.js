//! The launcher's list (`src/launch.rs`), held to `test/layers/launch.json`,
//! which `test/layers/launch_test.ts` holds the page's launcher code
//! to as well: synthetic stacks, their files in hexadecimal.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use winbox_win16::launch::{KeptStack, Kind, LaunchGroup, StackFiles, launch_groups};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
        .collect()
}

/// Bytes as a JSON string, a character to a byte.
fn text(bytes: &[u8]) -> Value {
    Value::String(bytes.iter().map(|&b| char::from(b)).collect())
}

fn bytes(value: &Value) -> Vec<u8> {
    value.as_str().unwrap().chars().map(|c| c as u8).collect()
}

/// A stack's files as the fixture gives them: each file, the folders
/// above them, and those its own layers carry.
struct Held {
    files: BTreeMap<String, Vec<u8>>,
    folders: BTreeSet<String>,
    own: BTreeSet<String>,
}

impl Held {
    fn of(input: &Value) -> Self {
        let files: BTreeMap<String, Vec<u8>> = input["files"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(path, data)| (path.clone(), unhex(data.as_str().unwrap())))
            .collect();
        let mut folders = BTreeSet::new();

        for path in files.keys() {
            let parts: Vec<&str> = path.split('\\').collect();

            for at in 1..parts.len() {
                folders.insert(parts[..at].join("\\"));
            }
        }

        let own = input["own"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| path.as_str().unwrap().to_string())
            .collect();

        Self {
            files,
            folders,
            own,
        }
    }
}

impl StackFiles for Held {
    fn read(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }

    fn kind(&self, path: &str) -> Option<Kind> {
        if self.files.contains_key(path) {
            Some(Kind::File)
        } else if self.folders.contains(path) {
            Some(Kind::Folder)
        } else {
            None
        }
    }

    fn own(&self, path: &str) -> bool {
        self.own.contains(path)
    }
}

fn plain(groups: &[LaunchGroup]) -> Value {
    Value::Array(
        groups
            .iter()
            .map(|one| {
                json!({
                    "install": text(&one.install),
                    "name": text(&one.name),
                    "winbox": one.winbox,
                    "file": one.file,
                    "refusal": one.refusal,
                    "items": one.items.iter().map(|item| json!({
                        "name": text(&item.name),
                        "command": text(&item.command),
                        "directory": text(&item.directory),
                        "iconPath": text(&item.icon_path),
                        "iconIndex": item.icon_index,
                        "hotKey": item.hot_key,
                        "minimized": item.minimized,
                        "run": {
                            "file": text(&item.run.file),
                            "parameters": text(&item.run.parameters),
                            "directory": text(&item.run.directory),
                            "show": item.run.show,
                            "directoryThere": item.run.directory_there,
                            "program": item.run.program.as_deref().map(text),
                            "commandLine": text(&item.run.command_line),
                            "error": item.run.error,
                            "missing": item.run.missing.as_deref().map(text),
                            "reason": item.run.reason,
                        },
                    })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}

#[test]
fn the_launchers_list_is_the_fixtures() {
    let fixture: Value = serde_json::from_str(
        &std::fs::read_to_string(root().join("test/layers/launch.json")).unwrap(),
    )
    .unwrap();
    let inputs = fixture["stacks"].as_array().unwrap();
    let held: Vec<Held> = inputs.iter().map(Held::of).collect();
    let stacks: Vec<KeptStack<'_>> = inputs
        .iter()
        .zip(&held)
        .map(|(input, files)| KeptStack {
            name: bytes(&input["name"]),
            files,
            exes: input["exes"]
                .as_array()
                .unwrap()
                .iter()
                .map(bytes)
                .collect(),
            path: input["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(bytes)
                .collect(),
        })
        .collect();

    assert_eq!(plain(&launch_groups(&stacks)), fixture["expected"]);
}
