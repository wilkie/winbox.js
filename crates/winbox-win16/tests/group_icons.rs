//! An item's icon in a group file, held to the icon its program holds,
//! decoded as `ExtractIcon` decodes it for the display (`SHELL.DLL` seg10
//! `026e`-`0881`, `shell/programs.rs`): the icon Program Manager took with
//! `DumpIcon` (`USER.EXE` seg12 `01bb`) into the file. For the group files
//! the pm probes recorded whole, and the installation's own on each
//! display's drive of the oracle's (local; nothing held where not there).
//! The page-code cases are `test/run/group_icon_test.ts`'s.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;
use winbox_ne::{Executable, ResourceId};
use winbox_raster::device_palette::DevicePalette;
use winbox_raster::icon::{decode_icon, icon_entries, pick_icon};
use winbox_win16::display::{Display, mode};
use winbox_win16::groups::{Icon, Item, read_group};

const RT_ICON: u16 = 3;
const RT_GROUP_ICON: u16 = 14;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn build() -> PathBuf {
    root().join("oracle/build")
}

/// A probe's recorded files: `bytes` records `NAME@offset`, put together,
/// by name, each as long as its `size` record says.
fn recorded(probe: &str) -> Vec<(String, Vec<u8>)> {
    let text = std::fs::read_to_string(root().join(format!("oracle/fixtures/{probe}.json")))
        .expect("the fixture");
    let fixture: Value = serde_json::from_str(&text).expect("JSON");
    let records = fixture["records"].as_array().expect("records");
    let mut sizes = HashMap::new();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();

    for record in records {
        if record["function"] == "size" {
            let size = record["result"].as_str().map_or_else(
                || record["result"].as_u64().expect("a size") as usize,
                |text| text.parse().expect("a size"),
            );

            sizes.insert(record["args"].as_str().unwrap().to_string(), size);
        }
    }

    for record in records {
        if record["function"] == "bytes" {
            let args = record["args"].as_str().unwrap();
            let (name, offset) = args.rsplit_once('@').expect("NAME@offset");
            let at = usize::from_str_radix(offset, 16).unwrap();
            let hex = record["result"].as_str().unwrap();
            let bytes: Vec<u8> = (0..hex.len() / 2)
                .map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap())
                .collect();
            let index = files.iter().position(|(each, _)| each == name);
            let index = index.unwrap_or_else(|| {
                files.push((name.to_string(), vec![0; sizes[name]]));
                files.len() - 1
            });
            let data = &mut files[index].1;
            let room = data.len().saturating_sub(at);

            data[at..at + room.min(bytes.len())].copy_from_slice(&bytes[..room.min(bytes.len())]);
        }
    }

    files
}

/// A file of a Windows directory as `_lopen` from it finds the name, case
/// aside; none where not there.
fn found(windows: &Path, path: &str) -> Option<Vec<u8>> {
    let mut name = path;

    if name.len() > 1 && name.as_bytes()[1] == b':' {
        name = &name[2..];
    }

    if name.len() >= 9 && name[..9].eq_ignore_ascii_case("\\windows\\") {
        name = &name[9..];
    }

    let name = name.strip_prefix('\\').unwrap_or(name);
    let name = name.to_ascii_uppercase().replace('\\', "/");

    [windows.to_path_buf(), windows.join("SYSTEM")]
        .iter()
        .map(|folder| folder.join(&name))
        .find(|file| file.is_file())
        .and_then(|file| std::fs::read(file).ok())
}

fn resources(executable: &Executable, kind: u16) -> Vec<(Option<u16>, &[u8])> {
    executable
        .resources
        .iter()
        .filter(|each| matches!(each.id, ResourceId::Number(number) if number == kind))
        .flat_map(|each| each.entries.iter())
        .map(|entry| {
            let id = match entry.id {
                ResourceId::Number(number) => Some(number),
                ResourceId::Name(_) => None,
            };

            (id, executable.resource_bytes(entry))
        })
        .collect()
}

fn palette(display: &Display) -> DevicePalette {
    DevicePalette::for_display(
        display.colors,
        display.palette.as_deref() == Some("ega"),
        display.palette.as_deref() == Some("8514"),
    )
}

/// The icon of a program's file at an index, as `ExtractIcon` decodes it
/// for a display: the group icon resource, the one of its icons that fits,
/// decoded into the display's colours. Its mask and its picture's indices.
fn program_icon(bytes: &[u8], index: u16, display: &Display) -> Option<(Vec<u8>, Vec<u8>)> {
    let executable = Executable::parse(bytes.to_vec()).ok()?;
    let groups = resources(&executable, RT_GROUP_ICON);
    let (_, group) = groups.get(usize::from(index))?;
    let entry = pick_icon(&icon_entries(group), 32, display.colors)?;
    let icons = resources(&executable, RT_ICON);
    let (_, icon) = icons.iter().find(|(id, _)| *id == Some(entry.id))?;
    let decoded = decode_icon(icon, &mut palette(display));

    Some((decoded.and, decoded.xor))
}

/// The icon's pixels as indices, as the page reads `DumpIcon`'s bits
/// (`src/run/group-icon.ts`, `iconIndices`): the AND plane a bit a pixel,
/// `widthBytes` a row; the XOR plane each row its planes in turn, each a
/// whole word; plane `p` bit `p` of the index.
fn icon_indices(icon: &Icon) -> Option<(Vec<u8>, Vec<u8>)> {
    let (width, height) = (usize::from(icon.cx), usize::from(icon.cy));
    let width_bytes = usize::from(icon.width_bytes);
    let planes = usize::from(icon.planes.max(1));
    let bits = usize::from(icon.bits_pixel.max(1));
    let picture_row = ((width * bits + 15) >> 3) & !1;

    if width == 0
        || height == 0
        || icon.and.len() < height * width_bytes
        || icon.xor.len() < height * planes * picture_row
    {
        return None;
    }

    let mut and = vec![0; width * height];
    let mut xor = vec![0; width * height];

    for row in 0..height {
        for column in 0..width {
            let at = row * width + column;

            and[at] = (icon.and[row * width_bytes + (column >> 3)] >> (7 - (column & 7))) & 1;

            let mut index = 0;

            for plane in 0..planes {
                let bit = column * bits;
                let byte = icon.xor[(row * planes + plane) * picture_row + (bit >> 3)];
                let value = (byte >> (8 - bits - (bit & 7))) & ((1u16 << bits) - 1) as u8;

                index |= value << (plane * bits);
            }

            xor[at] = index;
        }
    }

    Some((and, xor))
}

/// Each item's icon held to its program's, where its icon's file is there;
/// how many were.
fn hold_items(items: &[Item], windows: &Path, display_name: &str) -> usize {
    let display = mode(display_name).expect("a display");
    let depth = DevicePalette::depth_of(display.colors);
    let mut held = 0;

    for item in items {
        let path: String = item
            .icon_path
            .iter()
            .map(|&byte| char::from(byte))
            .collect();
        let file = (!path.is_empty()).then(|| found(windows, &path)).flatten();
        let expected = file
            .filter(|file| file.first() == Some(&0x4d))
            .and_then(|file| program_icon(&file, item.icon_index, &display));

        // A group made on another display, not yet loaded on this one,
        // holds the other's format: Program Manager makes its icons again
        // as it loads it (seg4 `17ae`).
        let (Some(icon), Some(expected)) = (&item.icon, expected) else {
            continue;
        };

        if icon.planes * icon.bits_pixel != depth {
            continue;
        }

        let name: String = item.name.iter().map(|&byte| char::from(byte)).collect();

        assert_eq!(
            (name.as_str(), icon_indices(icon).expect("its bits")),
            (name.as_str(), expected),
            "{display_name}"
        );
        held += 1;
    }

    held
}

#[test]
fn is_each_programs_own_icon_in_the_groups_the_pm_probes_recorded() {
    if !build().join("drive-c/WINDOWS/PROGMAN.EXE").exists() {
        return;
    }

    let mut held = 0;

    for (probe, display, drive) in [
        ("pmbare-vga", "vga", "drive-c"),
        ("pmbare-ega", "ega", "drive-c-ega"),
        ("pmfiles", "vga", "drive-c"),
    ] {
        for (name, data) in recorded(probe) {
            let group = read_group(&data).expect("a group");

            assert!(group.items.iter().all(|item| {
                item.icon
                    .as_ref()
                    .is_some_and(|icon| icon_indices(icon).is_some())
            }));
            held += hold_items(&group.items, &build().join(drive).join("WINDOWS"), display);
            assert!(name.contains("GRP"), "{name}");
        }
    }

    assert!(held > 10, "{held}");
}

#[test]
fn is_each_programs_own_icon_in_the_installations_groups_on_each_display() {
    if !build().join("drive-c/WINDOWS/PROGMAN.EXE").exists() {
        return;
    }

    let drives = [
        ("drive-c", "vga"),
        ("drive-c-ega", "ega"),
        ("drive-c-hercules", "hercules"),
        ("drive-c-svga", "svga"),
        ("drive-c-vga256", "vga256"),
        ("drive-c-8514", "8514"),
        ("drive-c-xga256", "xga256"),
    ];
    let mut held: Vec<(&str, usize)> = Vec::new();

    for (drive, display) in drives {
        let windows = build().join(drive).join("WINDOWS");
        let mut count = None;

        for name in ["MAIN.GRP", "ACCESSOR.GRP", "STARTUP.GRP"] {
            if let Ok(bytes) = std::fs::read(windows.join(name)) {
                let group = read_group(&bytes).expect("a group");

                *count.get_or_insert(0) += hold_items(&group.items, &windows, display);
            }
        }

        if let Some(count) = count {
            held.push((display, count));
        }
    }

    // The 8514/A's and the XGA's installations hold the VGA's format.
    assert_eq!(
        held,
        [
            ("vga", 20),
            ("ega", 20),
            ("hercules", 20),
            ("svga", 20),
            ("vga256", 20),
            ("8514", 0),
            ("xga256", 0),
        ]
    );
}
