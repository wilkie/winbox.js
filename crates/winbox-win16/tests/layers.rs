//! The layer format (`kb/formats/layer.md`), held to
//! `test/layers/stack.json`, which `test/layers/layer_test.ts` holds the
//! TypeScript engine to as well: the same ids, the same flattened listing
//! and the same zip bytes -- the hashes the TypeScript engine took from
//! `crypto.subtle`, which WinBox's own sha256 must give too. And a stack
//! materialised into folders of the host's and put together by
//! `HostDrive::layered` lists and reads as the flattened stack does.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::Value;
use winbox_machine::{Change, Files, HostDrive, MemoryDrive};
use winbox_win16::assets::{Composed, Placement};
use winbox_win16::layers::{
    Layer, Made, flatten, layer_id, materialise_stack, stack_id, stack_refusal,
};
use winbox_win16::sha256::sha256_hex;

fn fixture() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test/layers/stack.json");

    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn bytes(text: &Value) -> Vec<u8> {
    text.as_str().unwrap().chars().map(|c| c as u8).collect()
}

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

/// Every layer of the fixture, by name, each `over` named by the ids it
/// names.
fn layers(fixture: &Value) -> BTreeMap<String, Layer> {
    let mut made = BTreeMap::new();
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
        let made_by: Made = serde_json::from_value(spec["made"].clone()).unwrap();
        let layer = Layer::from_changes(&changes_of(fixture, name), over, made_by).unwrap();

        made.insert(name.to_string(), layer);
    }

    made
}

fn stack(made: &BTreeMap<String, Layer>, names: &Value) -> Vec<Layer> {
    names
        .as_array()
        .unwrap()
        .iter()
        .map(|name| made[name.as_str().unwrap()].clone())
        .collect()
}

#[test]
fn the_same_ids_listing_and_zips_as_the_typescript_engine() {
    let fixture = fixture();
    let expected = &fixture["expected"];
    let made = layers(&fixture);

    for (name, layer) in &made {
        assert_eq!(
            layer.manifest.id,
            expected["ids"][name].as_str().unwrap(),
            "{name}'s id"
        );

        if name != "base" {
            assert_eq!(
                sha256_hex(&layer.zip().unwrap()),
                expected["zips"][name].as_str().unwrap(),
                "{name}'s zip"
            );
        }
    }

    let flat = flatten(&stack(&made, &fixture["stacks"][0]["layers"])).unwrap();
    let lines: Vec<&str> = expected["flat"]
        .as_array()
        .unwrap()
        .iter()
        .map(|line| line.as_str().unwrap())
        .collect();

    assert_eq!(flat.lines(), lines);
}

#[test]
fn stacks_are_refused_as_the_fixture_says() {
    let fixture = fixture();
    let made = layers(&fixture);

    for spec in fixture["stacks"].as_array().unwrap() {
        let layers = stack(&made, &spec["layers"]);
        let manifests: Vec<_> = layers.iter().map(|layer| &layer.manifest).collect();
        let refusal = stack_refusal(&manifests);

        match spec["refused"].as_str() {
            Some(why) => {
                assert!(refusal.as_deref().unwrap().contains(why), "{refusal:?}");
                assert!(flatten(&layers).unwrap_err().contains(why));
            }
            None => assert_eq!(refusal, None),
        }
    }

    let mut other = made["base"].manifest.clone();

    other.id = "base:fixture:ega".to_string();
    assert!(
        stack_refusal(&[&other, &made["A"].manifest])
            .unwrap()
            .contains("was made on")
    );
}

#[test]
fn a_layer_is_its_changes_and_its_zip() {
    let fixture = fixture();
    let made = layers(&fixture);

    for name in ["A", "B", "C", "D"] {
        let layer = &made[name];
        let back = Layer::from_zip(&layer.zip().unwrap()).unwrap();

        assert_eq!(back.manifest, layer.manifest);
        assert_eq!(
            back.blobs.keys().collect::<Vec<_>>(),
            layer.blobs.keys().collect::<Vec<_>>()
        );

        let mut given: Vec<String> = changes_of(&fixture, name)
            .iter()
            .map(|change| format!("{change:?}"))
            .collect();
        let mut again: Vec<String> = layer
            .changes()
            .unwrap()
            .iter()
            .map(|change| format!("{change:?}"))
            .collect();

        given.sort();
        again.sort();
        assert_eq!(again, given);

        let mut reversed = layer.manifest.entries.clone();

        reversed.reverse();
        assert_eq!(layer_id(&reversed).unwrap(), layer.manifest.id);
    }

    // Two files of the same bytes: one blob.
    assert_eq!(made["B"].blobs.len(), 2);

    let mut zip = made["B"].zip().unwrap();
    let at = zip.windows(5).position(|bytes| bytes == b"saved").unwrap();

    zip[at] = b'S';
    assert!(Layer::from_zip(&zip).is_err());
    assert_eq!(
        layer_id(&[]).unwrap(),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

/// Everything on C:, as DOS lists it: each entry's name, attributes, a
/// file's size and bytes, and its stamp. The root's own stamp, which its
/// `.` and `..` and a top-level folder's `..` carry, is the host folder's
/// or none on a `MemoryDrive`, and is not measured: not compared; nor a
/// folder's size, which a host's folder has and a drive in memory's not.
fn tree(files: &Files) -> Vec<String> {
    fn walk(files: &Files, parts: &mut Vec<String>, out: &mut Vec<String>) {
        let folder = parts.join("\\");

        for entry in files.list('C', parts).unwrap() {
            let root = (entry.name == ".." && parts.len() <= 2)
                || (entry.name == "." && folder.is_empty());
            let stamp = if root {
                "root".to_string()
            } else {
                format!("{:?}", entry.modified)
            };
            let is_folder = entry.attributes & 0x10 != 0;
            let what = if is_folder {
                String::new()
            } else {
                let (_, bytes) = files
                    .read_from(&format!("C:\\{folder}"), &entry.name)
                    .unwrap();

                format!("{} {bytes:?}", entry.size)
            };

            out.push(format!(
                "{folder}\\{} {:02x} {stamp} {what}",
                entry.name, entry.attributes
            ));

            if is_folder && entry.name != "." && entry.name != ".." {
                parts.push(entry.name);
                walk(files, parts, out);
                parts.pop();
            }
        }
    }

    let mut out = Vec::new();

    walk(files, &mut vec![String::new()], &mut out);
    out
}

fn mounted(drive: impl winbox_machine::Volume + 'static) -> Files {
    let mut files = Files::new();

    files.mount('C', drive);
    files
}

/// A folder of the host's for a test, let go of after it.
struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_materialised_stack_shows_what_the_flattened_one_holds() {
    let fixture = fixture();
    let made = layers(&fixture);
    let layers = stack(&made, &fixture["stacks"][0]["layers"]);

    // The page's way: each layer's changes put on a drive made afresh.
    let mut applied = MemoryDrive::new();

    for layer in &layers {
        applied.apply(&layer.changes().unwrap());
    }

    let flat = flatten(&layers).unwrap();
    let expected = tree(&mounted(applied));

    assert_eq!(tree(&mounted(flat.drive())), expected, "flattened");

    let scratch =
        Scratch(std::env::temp_dir().join(format!("winbox-layers-{}", std::process::id())));
    let cache = scratch.0.join("cache");
    let top = scratch.0.join("top");

    std::fs::create_dir_all(&cache).unwrap();
    std::fs::create_dir_all(&top).unwrap();

    let lowers = materialise_stack(&layers, &cache).unwrap();

    assert!(cache.join(format!("layer-{}", stack_id(&layers))).is_dir());
    assert_eq!(
        tree(&mounted(HostDrive::layered(top.clone(), lowers))),
        expected,
        "materialised"
    );

    // Made once: a second time takes the folders as they are.
    let again = materialise_stack(&layers, &cache).unwrap();

    assert_eq!(std::fs::read_dir(&cache).unwrap().count(), layers.len());
    assert_eq!(
        tree(&mounted(HostDrive::layered(top, again))),
        expected,
        "materialised again"
    );
}
