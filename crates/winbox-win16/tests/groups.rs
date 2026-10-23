//! Program Manager's groups (`src/groups.rs`, `kb/formats/grp.md`), held to
//! `test/layers/groups.json`, which `test/layers/groups_test.ts` holds the
//! TypeScript engine to as well: groups made by Program Manager's
//! operations, read into the model and written again byte for byte and
//! laid out afresh; commands stored and read back; `PROGMAN.INI` read as
//! start-up reads it and written as `CreateGroup` writes it; the groups of
//! a stack. And Program Manager's own files, as
//! `test/layers/groups_oracle_test.ts` reads them: the installation's on
//! each display's drive of the oracle's (local; skipped where it is not
//! there) and those the pm probes recorded whole.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::{Value, json};
use winbox_win16::groups::{
    Block, Extracted, Group, GroupFile, IconMetrics, IniWrite, NewItem, Placed, Placement,
    apply_ini_writes, command_of, delete_group_write, group_keys, groups_ini_writes, groups_of,
    read_group, store_command, write_group,
};
use winbox_win16::layers::{Flat, FlatFile};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture() -> Value {
    let path = root().join("test/layers/groups.json");

    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// A JSON string's characters as bytes, one to a character.
fn bytes(text: &Value) -> Vec<u8> {
    text.as_str().unwrap().chars().map(|c| c as u8).collect()
}

/// Bytes as a JSON string, a character to a byte.
fn text(bytes: &[u8]) -> Value {
    Value::String(bytes.iter().map(|&byte| char::from(byte)).collect())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut text, byte| {
        write!(text, "{byte:02x}").unwrap();
        text
    })
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
        .collect()
}

fn number(value: &Value) -> i64 {
    value.as_i64().unwrap()
}

/// A group's model as JSON both engines give alike.
fn summary(group: &Group) -> Value {
    let items: Vec<Value> = group
        .items
        .iter()
        .map(|item| {
            json!({
                "slot": item.slot,
                "name": text(&item.name),
                "command": text(&item.command),
                "directory": text(&item.directory),
                "stored": text(&item.stored),
                "programDirectory": item.program_directory.as_deref().map(text),
                "iconPath": text(&item.icon_path),
                "iconIndex": item.icon_index,
                "x": item.x,
                "y": item.y,
                "hotKey": item.hot_key,
                "minimized": item.minimized,
                "icon": item.icon.as_ref().map(|icon| json!({
                    "hotX": icon.hot_x,
                    "hotY": icon.hot_y,
                    "cx": icon.cx,
                    "cy": icon.cy,
                    "widthBytes": icon.width_bytes,
                    "planes": icon.planes,
                    "bitsPixel": icon.bits_pixel,
                    "and": hex(&icon.and),
                    "xor": hex(&icon.xor),
                    "header": icon.header.as_deref().map(hex),
                })),
            })
        })
        .collect();
    let layout = group.layout.as_ref().map(|layout| {
        layout
            .iter()
            .map(|block| match block {
                Block::Name => "name".to_string(),
                Block::Gap(bytes) => format!("gap {}", hex(bytes)),
                Block::Item { part, slot } => format!("{} {slot}", part.name()),
            })
            .collect::<Vec<_>>()
    });
    let tags = group.tags.as_ref().map(|tags| {
        tags.iter()
            .map(|tag| json!({ "id": tag.id, "item": tag.item, "data": tag.data.as_deref().map(hex) }))
            .collect::<Vec<_>>()
    });

    json!({
        "name": text(&group.name),
        "show": group.show,
        "rcNormal": group.rc_normal,
        "ptMin": group.pt_min,
        "cxIcon": group.cx_icon,
        "cyIcon": group.cy_icon,
        "bitsPixel": group.bits_pixel,
        "planes": group.planes,
        "reserved": group.reserved,
        "slots": group.slots,
        "items": items,
        "layout": layout,
        "tags": tags,
    })
}

fn metrics(value: &Value) -> IconMetrics {
    IconMetrics {
        cx: number(&value["cx"]) as u16,
        cy: number(&value["cy"]) as u16,
        bits_pixel: number(&value["bitsPixel"]) as u8,
        planes: number(&value["planes"]) as u8,
    }
}

/// One of the fixture's icons: its header, AND and XOR.
fn icon(fixture: &Value, name: &Value) -> [Vec<u8>; 3] {
    let icon = &fixture["icons"][name.as_str().unwrap()];

    ["header", "and", "xor"].map(|part| unhex(icon[part].as_str().unwrap()))
}

fn new_item(fixture: &Value, item: &Value, name: Vec<u8>) -> NewItem {
    let directory = (!item["directory"].is_null()).then(|| bytes(&item["directory"]));
    let stored = store_command(&bytes(&item["command"]), directory.as_deref());
    let [header, and, xor] = icon(fixture, &item["icon"]);

    NewItem {
        name,
        stored: stored.stored,
        icon_path: bytes(&item["iconPath"]),
        icon_index: number(&item["iconIndex"]) as u16,
        header,
        and,
        xor,
        x: number(&item["x"]) as i16,
        y: number(&item["y"]) as i16,
        hot_key: number(&item["hotKey"]) as u16,
        minimized: item["minimized"].as_bool().unwrap(),
        program_directory: stored.program_directory,
    }
}

/// A script's group made, and each step's answer.
fn run(fixture: &Value, script: &Value) -> (Vec<u8>, Vec<Value>) {
    let mut file = GroupFile::new(&[]);
    let mut results = Vec::new();

    for step in script["steps"].as_array().unwrap() {
        let answer = |result: Result<u16, u16>| match result {
            Ok(slot) => json!({ "slot": slot }),
            Err(error) => json!({ "error": error }),
        };

        results.push(match step[0].as_str().unwrap() {
            "create" => {
                file = GroupFile::create(&bytes(&step[1]), metrics(&step[2]));
                Value::Null
            }
            "add" => answer(file.add_item(&new_item(fixture, &step[1], bytes(&step[1]["name"])))),
            "fill" => {
                for count in 0..number(&step[1]) {
                    let mut name = bytes(&step[2]["name"]);

                    name.extend_from_slice(format!(" {count}").as_bytes());
                    file.add_item(&new_item(fixture, &step[2], name)).ok();
                }

                Value::Null
            }
            "delete" => {
                file.delete_item(number(&step[1]) as u16);
                Value::Null
            }
            "rename" => {
                file.rename(&bytes(&step[1]));
                Value::Null
            }
            "save" => {
                let placement = Placement {
                    show: number(&step[1]["show"]) as u16,
                    rc_normal: [0, 1, 2, 3].map(|at| number(&step[1]["rcNormal"][at]) as i16),
                    pt_min: [0, 1].map(|at| number(&step[1]["ptMin"][at]) as i16),
                };
                let items: Vec<Placed> = step[2]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| Placed {
                        slot: number(&item["slot"]) as u16,
                        x: number(&item["x"]) as i16,
                        y: number(&item["y"]) as i16,
                    })
                    .collect();

                json!(file.save(placement, &items))
            }
            _ => {
                let mut icons = step[2].as_array().unwrap().iter();

                file.refresh_icons(metrics(&step[1]), |_, _| {
                    let next = icons.next().unwrap();

                    (!next.is_null()).then(|| {
                        let [header, and, xor] = icon(fixture, &next["icon"]);

                        Extracted {
                            icon_index: number(&next["iconIndex"]) as u16,
                            header,
                            and,
                            xor,
                        }
                    })
                });
                Value::Null
            }
        });
    }

    (file.bytes(), results)
}

fn script_bytes(fixture: &Value, name: &str) -> Vec<u8> {
    let scripts = fixture["scripts"].as_array().unwrap();
    let script = scripts
        .iter()
        .find(|script| script["name"] == name)
        .unwrap();

    run(fixture, script).0
}

/// The fixture's stack, flattened.
fn stack(fixture: &Value) -> Flat {
    let mut files: Vec<FlatFile> = fixture["stack"]["files"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(path, content)| {
            let mut data = if content.is_string() {
                bytes(content)
            } else {
                script_bytes(fixture, content["script"].as_str().unwrap())
            };

            if let Some(damage) = content.get("damage") {
                data[number(damage) as usize] ^= 0xff;
            }

            FlatFile {
                path: path.clone(),
                sha256: String::new(),
                size: data.len() as u64,
                modified: 0,
                data: Rc::new(data),
            }
        })
        .collect();

    files.sort_by(|one, other| one.path.cmp(&other.path));
    Flat {
        folders: Vec::new(),
        files,
    }
}

fn writes_json(writes: &[IniWrite]) -> Value {
    Value::Array(
        writes
            .iter()
            .map(|write| {
                json!([
                    text(&write.section),
                    text(&write.entry),
                    write.value.as_deref().map(text)
                ])
            })
            .collect(),
    )
}

fn scripts(fixture: &Value) -> Vec<Value> {
    fixture["scripts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|script| {
            let (data, results) = run(fixture, script);
            let group = read_group(&data).unwrap();
            let fresh = Group {
                layout: None,
                tags: None,
                ..group.clone()
            };

            json!({
                "name": script["name"],
                "results": results,
                "bytes": hex(&data),
                "model": summary(&group),
                "again": hex(&write_group(&group).unwrap()),
                "fresh": hex(&write_group(&fresh).unwrap()),
            })
        })
        .collect()
}

#[test]
fn scripts_make_read_and_write_groups_as_the_fixture_has_them() {
    let fixture = fixture();
    let now = scripts(&fixture);
    let expected = fixture["expected"]["scripts"].as_array().unwrap();

    assert_eq!(now.len(), expected.len());

    for (now, expected) in now.iter().zip(expected) {
        let name = &now["name"];

        assert_eq!(now["results"], expected["results"], "{name}: results");
        assert_eq!(now["bytes"], expected["bytes"], "{name}: bytes");
        assert_eq!(now["again"], now["bytes"], "{name}: written again");
        assert_eq!(now["model"], expected["model"], "{name}: model");
        assert_eq!(now["fresh"], expected["fresh"], "{name}: laid out afresh");
    }
}

#[test]
fn commands_are_stored_and_read_back() {
    let fixture = fixture();
    let now: Vec<Value> = fixture["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let directory = (!case[1].is_null()).then(|| bytes(&case[1]));
            let stored = store_command(&bytes(&case[0]), directory.as_deref());
            let (command, directory) = command_of(&stored.stored, Some(&stored.program_directory));

            json!({
                "stored": text(&stored.stored),
                "programDirectory": text(&stored.program_directory),
                "command": text(&command),
                "directory": text(&directory),
            })
        })
        .collect();

    assert_eq!(Value::Array(now), fixture["expected"]["commands"]);
}

#[test]
fn progman_ini_is_read_as_start_up_reads_it() {
    let fixture = fixture();
    let now: Vec<Value> = fixture["inis"]
        .as_array()
        .unwrap()
        .iter()
        .map(|ini| {
            let keys = group_keys(&bytes(ini));

            json!({
                "order": text(&keys.order),
                "keys": keys.keys.iter().map(|key| json!({
                    "key": text(&key.key),
                    "n": key.n,
                    "path": text(&key.path),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();

    assert_eq!(Value::Array(now), fixture["expected"]["inis"]);
}

#[test]
fn progman_ini_is_written_as_create_group_and_delete_group_write_it() {
    let fixture = fixture();
    let now: Vec<Value> = fixture["writes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let groups: Vec<(u16, Vec<u8>)> = case["groups"]
                .as_array()
                .unwrap()
                .iter()
                .map(|group| (number(&group["n"]) as u16, bytes(&group["path"])))
                .collect();
            let mut writes = groups_ini_writes(&groups);

            writes.extend(
                case["deleted"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|n| delete_group_write(number(n) as u16)),
            );

            json!({ "writes": writes_json(&writes), "ini": text(&apply_ini_writes(&bytes(&case["ini"]), &writes)) })
        })
        .collect();

    assert_eq!(Value::Array(now), fixture["expected"]["writes"]);
}

#[test]
fn a_stacks_groups_are_those_start_up_would_load() {
    let fixture = fixture();
    let now: Vec<Value> = groups_of(&stack(&fixture))
        .groups
        .iter()
        .map(|group| {
            json!({
                "key": text(&group.key.key),
                "n": group.key.n,
                "path": text(&group.key.path),
                "file": group.file,
                "refusal": group.refusal,
                "name": group.group.as_ref().map(|group| text(&group.name)),
                "items": group.group.as_ref().map(|group| {
                    group.items.iter().map(|item| text(&item.name)).collect::<Vec<_>>()
                }),
            })
        })
        .collect();

    assert_eq!(Value::Array(now), fixture["expected"]["stack"]);
}

/// The Windows directories of the oracle's display installations.
fn drives() -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root().join("oracle/build")) else {
        return Vec::new();
    };
    let mut drives: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("drive-c"))
        .map(|entry| entry.path().join("WINDOWS"))
        .filter(|windows| windows.join("PROGMAN.INI").exists())
        .collect();

    drives.sort();
    drives
}

/// Read, written again and written as `WriteGroup` writes the block: the
/// same bytes.
fn round_trip(data: &[u8]) {
    let group = read_group(data).unwrap();

    assert!(group.layout.is_some());
    assert_eq!(hex(&write_group(&group).unwrap()), hex(data));
    assert_eq!(hex(&GroupFile::new(data).bytes()), hex(data));
}

#[test]
fn the_installations_groups_on_each_display_round_trip() {
    let drives = drives();

    if drives.is_empty() {
        eprintln!("skipped: no oracle drives");
        return;
    }

    let mut checked = 0;

    for windows in &drives {
        for name in ["MAIN.GRP", "ACCESSOR.GRP", "STARTUP.GRP", "GAMES.GRP"] {
            if let Ok(data) = std::fs::read(windows.join(name)) {
                round_trip(&data);
                checked += 1;
            }
        }

        let ini = std::fs::read(windows.join("PROGMAN.INI")).unwrap();
        let keys: Vec<Vec<u8>> = group_keys(&ini)
            .keys
            .into_iter()
            .map(|key| key.key)
            .collect();

        assert_eq!(
            keys,
            [b"GROUP2".to_vec(), b"GROUP3".to_vec(), b"GROUP1".to_vec()]
        );
    }

    assert!(checked >= drives.len() * 3);
}

/// A probe's recorded files: `bytes` records `NAME@offset`, put together,
/// by name.
fn recorded(probe: &str) -> BTreeMap<String, Vec<u8>> {
    let Ok(text) = std::fs::read_to_string(root().join(format!("oracle/fixtures/{probe}.json")))
    else {
        return BTreeMap::new();
    };
    let fixture: Value = serde_json::from_str(&text).unwrap();
    let records = fixture["records"].as_array().unwrap();
    let mut files = BTreeMap::new();

    for record in records.iter().filter(|record| record["function"] == "size") {
        let size: usize = record["result"].as_str().unwrap().parse().unwrap_or(0);

        files.insert(record["args"].as_str().unwrap().to_string(), vec![0; size]);
    }

    for record in records
        .iter()
        .filter(|record| record["function"] == "bytes")
    {
        let (name, offset) = record["args"].as_str().unwrap().rsplit_once('@').unwrap();
        let offset = usize::from_str_radix(offset, 16).unwrap();
        let data = files.get_mut(name).unwrap();
        let chunk = unhex(record["result"].as_str().unwrap());
        let end = data.len().min(offset + chunk.len());

        data[offset..end].copy_from_slice(&chunk[..end - offset]);
    }

    files.retain(|name, _| {
        records
            .iter()
            .any(|record| record["args"].as_str() == Some(&format!("{name}@0")))
    });
    files
}

/// The items of a group as `CreateNewItem` was given them, in the order
/// their ITEMDEFs lie.
fn added(group: &Group, data: &[u8]) -> Vec<NewItem> {
    let def = |slot: u16| {
        u16::from_le_bytes([
            data[0x22 + usize::from(slot) * 2],
            data[0x23 + usize::from(slot) * 2],
        ])
    };
    let mut items: Vec<_> = group.items.iter().collect();

    items.sort_by_key(|item| def(item.slot));
    items
        .into_iter()
        .map(|item| {
            let icon = item.icon.as_ref().unwrap();
            let mut header = Vec::new();

            for value in [icon.hot_x, icon.hot_y, icon.cx, icon.cy, icon.width_bytes] {
                header.extend_from_slice(&value.to_le_bytes());
            }

            header.extend_from_slice(&[icon.planes, icon.bits_pixel]);

            NewItem {
                name: item.name.clone(),
                stored: item.stored.clone(),
                icon_path: item.icon_path.clone(),
                icon_index: item.icon_index,
                header,
                and: icon.and.clone(),
                xor: icon.xor.clone(),
                x: item.x,
                y: item.y,
                hot_key: item.hot_key,
                minimized: item.minimized,
                program_directory: item.program_directory.clone().unwrap_or_default(),
            }
        })
        .collect()
}

#[test]
fn the_pm_probes_group_files_round_trip() {
    for probe in ["pmbare-vga", "pmbare-ega", "pmfiles", "pmsyntax"] {
        for data in recorded(probe).values() {
            round_trip(data);
        }
    }
}

#[test]
fn pmbare_groups_are_made_again_as_create_group_and_add_item_make_them() {
    for probe in ["pmbare-vga", "pmbare-ega"] {
        let files = recorded(probe);

        if files.is_empty() {
            continue;
        }

        for name in ["WINBOXGA.GRP", "GAMES.GRP", "ROWS.GRP"] {
            let data = &files[name];
            let group = read_group(data).unwrap();
            let mut made = GroupFile::create(
                &group.name,
                IconMetrics {
                    cx: group.cx_icon,
                    cy: group.cy_icon,
                    bits_pixel: group.bits_pixel,
                    planes: group.planes,
                },
            );

            for item in added(&group, data) {
                made.add_item(&item).unwrap();
            }

            assert_eq!(hex(&made.bytes()), hex(data), "{probe} {name}");
        }

        let before = &files["WINBOXGA.GRP"];
        let saved = read_group(&files["WINBOXGA.GRP after"]).unwrap();
        let old = read_group(before).unwrap();
        let items: Vec<Placed> = saved
            .items
            .iter()
            .map(|item| Placed {
                slot: old
                    .items
                    .iter()
                    .find(|one| one.name == item.name)
                    .unwrap()
                    .slot,
                x: item.x,
                y: item.y,
            })
            .collect();
        let mut file = GroupFile::new(before);

        file.save(
            Placement {
                show: saved.show,
                rc_normal: saved.rc_normal,
                pt_min: saved.pt_min,
            },
            &items,
        );
        assert_eq!(
            hex(&file.bytes()),
            hex(&files["WINBOXGA.GRP after"]),
            "{probe} saved"
        );
    }
}

#[test]
fn pmfiles_main_grp_has_its_icons_made_again_for_another_display_driver() {
    let files = recorded("pmfiles");

    if files.is_empty() {
        return;
    }

    let before = &files["MAIN.GRP before"];
    let after = &files["MAIN.GRP after"];
    let old = read_group(before).unwrap();
    let mut file = GroupFile::new(before);

    assert_ne!(before, after);
    file.refresh_icons(
        IconMetrics {
            cx: old.cx_icon,
            cy: old.cy_icon,
            bits_pixel: old.bits_pixel,
            planes: old.planes,
        },
        |icon_path, icon_index| {
            let item = old
                .items
                .iter()
                .find(|one| one.icon_path == icon_path && one.icon_index == icon_index)
                .unwrap();
            let made = added(
                &Group {
                    items: vec![item.clone()],
                    ..old.clone()
                },
                before,
            )
            .remove(0);

            Some(Extracted {
                icon_index,
                header: made.header,
                and: made.and,
                xor: made.xor,
            })
        },
    );
    assert_eq!(hex(&file.bytes()), hex(after));
}
