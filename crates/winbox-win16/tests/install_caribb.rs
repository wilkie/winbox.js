//! A program of the corpus installed by its own installer into a layer
//! (`kb/formats/layer.md`, "An installer into a layer"): Caribbean
//! Treasure's SETUP.EXE, its media placed at `C:\CARIBB` on the asset
//! bundle's base for the VGA under an empty top, on the virtual clock, its
//! clicks and keys where the fixture's run made them
//! (`test/layers/caribb-layer.json`'s `stepMarks`). Its top's changes made a
//! layer over the base, the media dropped, are the fixture's layer, entry
//! for entry, stamps and all.
//! It runs as the page runs an installer, WinBox's Program Manager the
//! shell (`progman::start_shell`), so the layer holds the group the
//! installer asks it for.
//!
//! Skipped without the corpus's program, the bundle (`pnpm assets`) or the
//! fixture. The fixture is this run's, its text to the byte, the clicks
//! and keys it was given kept as it has them; `CARIBB_LAYER_WRITE=1` writes
//! it from the run.

mod support;

use std::path::PathBuf;

use winbox_machine::MemoryDrive;
use winbox_win16::assets::STAMP;
use winbox_win16::groups::{program_files, program_groups};
use winbox_win16::launch::{FlatFiles, KeptStack, launch_groups};
use winbox_win16::layers::{Layer, Made, base_name, flatten, install_into_layer};
use winbox_win16::survey::Survey;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A manifest's entries as lines, for a difference that reads.
fn lines(entries: &serde_json::Value) -> Vec<String> {
    entries
        .as_array()
        .into_iter()
        .flatten()
        .map(|entry| {
            format!(
                "{} {} {} {} {}",
                entry["kind"].as_str().unwrap_or(""),
                entry["path"].as_str().unwrap_or(""),
                entry["sha256"].as_str().unwrap_or(""),
                entry["size"],
                entry["modified"]
            )
        })
        .collect()
}

#[test]
#[allow(clippy::too_many_lines)]
fn caribbean_treasures_installer_into_a_layer() {
    let media = root().join("corpus/programs/caribb");
    let fixture = root().join("test/layers/caribb-layer.json");
    let bundle = root().join("oracle/build/assets");

    if !media.join("SETUP.EXE").is_file() || !fixture.is_file() || !bundle.is_dir() {
        eprintln!("no corpus program caribb, fixture or asset bundle: skipped");
        return;
    }

    let fixture_text = std::fs::read_to_string(&fixture).unwrap();
    let fixture: serde_json::Value = serde_json::from_str(&fixture_text).unwrap();
    let assets = std::rc::Rc::new(winbox_win16::assets::Assets::open(&bundle).unwrap());
    let composed = assets.compose("vga").unwrap();
    let base = Layer::base(&composed, &assets.id, "vga");
    let mut before: MemoryDrive = flatten(std::slice::from_ref(&base)).unwrap().drive();
    let mut names: Vec<String> = std::fs::read_dir(&media)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();

    names.sort();

    for name in &names {
        assert!(before.add_file(
            &format!("CARIBB\\{}", name.to_ascii_uppercase()),
            std::fs::read(media.join(name)).unwrap(),
            STAMP,
        ));
    }

    // The fixture's clicks and keys, each when its clock came to it: the
    // installer waits for each, in a box or a dialog, and the instructions
    // to there part by a few dozen between runs, which a mark held to its
    // instruction would wait on for ever.
    let mut marks = fixture["stepMarks"].clone();

    for mark in marks.as_array_mut().into_iter().flatten() {
        mark["instructions"] = 0.into();
        mark["calls"] = 0.into();
    }

    let survey = Survey {
        seconds: 400.0,
        budget: 20_000_000_000,
        boxes: 3,
        marks: Some(serde_json::json!({ "stepMarks": marks }).to_string()),
        ..Survey::default()
    };
    let mut system = survey.system().unwrap();

    system.assets = Some(assets.clone());
    system.files.mount('A', MemoryDrive::removable());
    system.files.mount('C', before.clone());
    system.files.mount('Z', MemoryDrive::new());

    // Run as the page runs an installer: Program Manager the shell, first,
    // starting it.
    winbox_win16::progman::start_shell(&mut system, "C:\\CARIBB\\SETUP.EXE").unwrap();

    let surveyed = survey.run(system);
    let installed = install_into_layer(
        &before,
        &surveyed.system.files,
        'C',
        &["CARIBB".to_string()],
        vec![base_name(&assets.id, "vga")],
        Made {
            by: "WinBox".to_string(),
            version: None,
            from: Some("CARIBB.ZIP".to_string()),
        },
    )
    .unwrap();

    // The installer ended, once Enter was pressed on its last page,
    // Program Manager, the shell, alone left.
    assert_eq!(
        surveyed.stop,
        winbox_win16::Stop::Ended,
        "the installer stopped"
    );
    assert!(surveyed.system.shell_alone(), "the shell alone left");
    let made = serde_json::to_value(&installed.layer.manifest).unwrap();

    // The group the installer asked Program Manager for, in the layer.
    let paths: Vec<&str> = made["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["path"].as_str())
        .collect();

    assert!(paths.contains(&"WINDOWS\\PROGMAN.INI"), "{paths:?}");
    assert!(paths.contains(&"WINDOWS\\GAMES.GRP"), "{paths:?}");

    assert_eq!(
        lines(&made["entries"]),
        lines(&fixture["layer"]["entries"]),
        "the layer's entries, as the fixture's"
    );
    assert_eq!(made, fixture["layer"], "the layer, as the fixture's");
    assert_group(&installed.layer);

    // The fixture's text, from this run: its places as it has them.
    let written = support::json_text(
        &serde_json::json!({
            "stepMarks": fixture["stepMarks"],
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

    if std::env::var("CARIBB_LAYER_WRITE").as_deref() == Ok("1") {
        std::fs::write(root().join("test/layers/caribb-layer.json"), &written).unwrap();
    }

    assert!(
        written == fixture_text,
        "the fixture's text, as this run writes it"
    );
    assert!(installed.dropped.is_empty(), "{:?}", installed.dropped);
    assert!(
        installed.references.is_empty(),
        "{:?}",
        installed.references
    );
}

/// The order of an installed layer's fixture's keys: the run's places, its layer's manifest
/// (`kb/formats/layer.md`) and what was dropped and referred to.
const LAYER_ORDER: &[&str] = &[
    "stepMarks",
    "layer",
    "dropped",
    "references",
    "calls",
    "instructions",
    "time",
    "pointer",
    "key",
    "code",
    "kind",
    "x",
    "y",
    "button",
    "buttons",
    "double",
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

/// The group as the page and `--list` show it under the program kept:
/// its file the layer's, its item as the fixture reads it.
fn assert_group(layer: &Layer) {
    let flat = program_files(std::slice::from_ref(layer)).unwrap();
    let groups = program_groups(|path| {
        flat.files
            .iter()
            .find(|file| file.path == path)
            .map(|file| file.data.as_slice())
    });
    let text = |bytes: &[u8]| {
        bytes
            .iter()
            .map(|&byte| char::from(byte))
            .collect::<String>()
    };

    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].file.as_deref(), Some("WINDOWS\\GAMES.GRP"));

    let group = groups[0].group.as_ref().expect("the group loads");

    assert_eq!(text(&group.name), "Games");
    assert_eq!(
        group
            .items
            .iter()
            .map(|item| [text(&item.name), text(&item.command), text(&item.directory)])
            .collect::<Vec<_>>(),
        [[
            "Caribbean Treasure".to_string(),
            "c:\\windows\\games\\carrib.exe".to_string(),
            "c:\\windows\\games".to_string()
        ]]
    );

    // And as the launcher lists it (`launch.rs`): the item run as File Open
    // runs it, the game found in its own directory.
    let own = layer
        .manifest
        .entries
        .iter()
        .map(|entry| entry.path().to_string());
    let files = FlatFiles::new(&flat, own);
    let launched = launch_groups(&[KeptStack {
        name: b"Caribbean Treasure".to_vec(),
        files: &files,
        exes: Vec::new(),
        path: Vec::new(),
    }]);

    assert_eq!(
        launched
            .iter()
            .map(|one| (
                text(&one.name),
                one.winbox,
                one.items
                    .iter()
                    .map(|item| (
                        text(&item.name),
                        item.run.program.as_deref().map(text),
                        text(&item.run.directory),
                        item.run.show
                    ))
                    .collect::<Vec<_>>()
            ))
            .collect::<Vec<_>>(),
        [(
            "Games".to_string(),
            false,
            vec![(
                "Caribbean Treasure".to_string(),
                Some("C:\\WINDOWS\\GAMES\\CARRIB.EXE".to_string()),
                "C:\\WINDOWS\\GAMES".to_string(),
                1
            )]
        )]
    );
}
