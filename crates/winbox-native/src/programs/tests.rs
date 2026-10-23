//! The store of programs and layers on the host's disk: kept and read
//! back, a stack refused on another display, a user's deletes kept from
//! run to run, and an installer run into a layer and the program run from
//! its stack.

use std::rc::Rc;

use winbox_machine::Body;
use winbox_win16::System;
use winbox_win16::layers::Layer;

use super::*;

/// A folder of the host's for a test, let go of after it.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "winbox-native-programs-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);

        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Files written beneath a folder, each stamped, by their DOS paths.
fn write_files(root: &Path, files: &[(&str, &[u8], i64)]) {
    for (path, data, modified) in files {
        let host = path
            .split('\\')
            .fold(root.to_path_buf(), |at, name| at.join(name));

        std::fs::create_dir_all(host.parent().unwrap()).unwrap();
        std::fs::write(&host, data).unwrap();
        set_written(&host, *modified).unwrap();
    }
}

/// A small installation's folder, as `--windows` names one.
fn installation(root: &Path) -> PathBuf {
    let folder = root.join("windows");

    write_files(
        &folder,
        &[
            ("WINDOWS\\WIN.INI", b"[windows]\r\n", 700_000_000),
            ("WINDOWS\\SYSTEM.INI", b"[boot]\r\n", 700_000_000),
            ("WINDOWS\\SYSTEM\\GDI.EXE", b"MZ", 700_000_000),
        ],
    );
    folder
}

fn parts(path: &str) -> Vec<String> {
    Files::parse(path).parts
}

#[test]
fn a_program_and_its_layers_are_kept_as_the_page_keeps_them() {
    let scratch = Scratch::new("kept");
    let store = Store::new(scratch.0.join("winbox"));
    let base = Base::of_folder(&installation(&scratch.0), "vga").unwrap();
    let mut program = Program::new("SimTower", &base);

    assert!(base.name().starts_with("folder:"));

    // The user's own files laid out as C: has them, as SimTower needs.
    let own = scratch.0.join("own");

    write_files(
        &own,
        &[
            ("WINDOWS\\SYSTEM\\WAVMIX16.DLL", b"MZ wavemix", 800_000_000),
            ("WINDOWS\\WAVEMIX.INI", b"[general]\r\n", 800_000_000),
            ("SIMTOWER\\SIMTOWER.EXE", b"MZ tower", 800_000_000),
            ("SIMTOWER\\SIMTOWER.INI", b"[sim]\r\n", 800_000_000),
        ],
    );

    let stack = store.stack(&base, &program).unwrap();
    let layer = layer_of_folder(&own, &stack).unwrap();

    // The folders the base has already are not the layer's; the stack's
    // own are.
    let lines: Vec<String> = layer
        .manifest
        .entries
        .iter()
        .map(LayerEntry::line)
        .collect();

    assert!(lines.iter().all(|line| !line.starts_with("folder WINDOWS")));
    assert!(
        lines
            .iter()
            .any(|line| line.starts_with("folder SIMTOWER "))
    );
    assert_eq!(layer.manifest.over, vec![base.name().to_string()]);
    assert_eq!(layer.manifest.made.by, MADE_BY);

    store.add_layer(&mut program, &stack, &layer).unwrap();

    assert_eq!(program.layers, vec![layer.manifest.id.clone()]);
    assert_eq!(program.exes, vec!["C:\\SIMTOWER\\SIMTOWER.EXE".to_string()]);

    // Read back as written: the program, the manifest as its zip has it,
    // and each blob by its hash.
    assert_eq!(store.program("SimTower").unwrap(), Some(program.clone()));
    assert_eq!(
        std::fs::read(
            store
                .root
                .join("layers")
                .join(format!("{}.json", layer.manifest.id))
        )
        .unwrap(),
        manifest_text(&layer.manifest).unwrap()
    );

    for (hash, data) in &layer.blobs {
        assert_eq!(
            std::fs::read(store.root.join("blobs").join(hash)).unwrap(),
            **data
        );
    }

    let again = store.layer(&layer.manifest.id).unwrap();

    assert_eq!(again.manifest, layer.manifest);
    assert_eq!(again.zip().unwrap(), layer.zip().unwrap());

    // Its exchange zip taken into another store, on the same base: the
    // same layer.
    let other = Store::new(scratch.0.join("other"));
    let mut copy = Program::new("SimTower", &base);
    let imported = Layer::from_zip(&layer.zip().unwrap()).unwrap();

    let beneath = other.stack(&base, &copy).unwrap();

    other.add_layer(&mut copy, &beneath, &imported).unwrap();
    assert_eq!(copy.layers, program.layers);

    // The stack materialised reads as the layer and the base.
    let stack = store.stack(&base, &program).unwrap();
    let drive = HostDrive::layered(scratch.0.join("top"), store.lowers(&base, &stack).unwrap());

    assert_eq!(
        drive.read(&parts("WINDOWS\\WAVEMIX.INI")).unwrap(),
        b"[general]\r\n"
    );
    assert_eq!(
        drive.read(&parts("WINDOWS\\WIN.INI")).unwrap(),
        b"[windows]\r\n"
    );
    assert_eq!(
        store
            .root
            .join(format!("layer-{}", winbox_win16::layers::stack_id(&stack))),
        drive.lowers()[0].path
    );

    // The same layer twice, and a name that cannot name a file, refused.
    assert!(store.add_layer(&mut program, &stack, &layer).is_err());
    assert!(store.program("a/b").is_err());
}

#[test]
fn a_stack_on_another_display_or_base_is_refused() {
    let scratch = Scratch::new("refused");
    let store = Store::new(scratch.0.join("winbox"));
    let windows = installation(&scratch.0);
    let vga = Base::of_folder(&windows, "vga").unwrap();
    let ega = Base::of_folder(&windows, "ega").unwrap();
    let program = Program::new("Game", &vga);

    let refusal = store.stack(&ega, &program).unwrap_err();

    assert!(refusal.contains("bound"), "{refusal}");

    // The installation changed: another base.
    write_files(&windows, &[("WINDOWS\\NEW.INI", b"", 700_000_000)]);

    let changed = Base::of_folder(&windows, "vga").unwrap();
    let refusal = store.stack(&changed, &program).unwrap_err();

    assert!(refusal.contains("base"), "{refusal}");

    // A layer made on one base is refused on another's stack.
    let own = scratch.0.join("own");

    write_files(&own, &[("GAME\\GAME.EXE", b"MZ", 800_000_000)]);

    let layer = layer_of_folder(&own, &store.stack(&vga, &program).unwrap()).unwrap();
    let mut elsewhere = Program::new("Elsewhere", &changed);
    let beneath = store.stack(&changed, &elsewhere).unwrap();
    let refusal = store
        .add_layer(&mut elsewhere, &beneath, &layer)
        .unwrap_err();

    assert!(refusal.contains("was made on"), "{refusal}");

    // On the asset bundle's base, the display is in the base's name.
    if let Ok(bundle) = Assets::open(&root().join("oracle/build/assets")) {
        let cache = scratch.0.join("cache");

        std::fs::create_dir_all(&cache).unwrap();

        let vga = Base::of_assets(&bundle, "vga", &cache).unwrap();
        let ega = Base::of_assets(&bundle, "ega", &cache).unwrap();
        let mut program = Program::new("Game", &vga);

        program.display = "ega".to_string();
        assert!(store.stack(&ega, &program).unwrap_err().contains("base"));
    }
}

#[test]
fn what_a_program_deletes_stays_deleted_from_run_to_run() {
    let scratch = Scratch::new("whiteouts");
    let store = Store::new(scratch.0.join("winbox"));
    let base = Base::of_folder(&installation(&scratch.0), "vga").unwrap();
    let mut program = Program::new("Game", &base);
    let own = scratch.0.join("own");

    write_files(
        &own,
        &[
            ("GAME\\GAME.EXE", b"MZ", 800_000_000),
            ("GAME\\SCORES.DAT", b"scores", 800_000_000),
        ],
    );

    let stack = store.stack(&base, &program).unwrap();
    let layer = layer_of_folder(&own, &stack).unwrap();

    store.add_layer(&mut program, &stack, &layer).unwrap();

    let stack = store.stack(&base, &program).unwrap();
    let lowers = store.lowers(&base, &stack).unwrap();

    assert_eq!(store.user_layer(&program), UserLayer::New);

    // A run: the program deletes a file of its layer and one of the base,
    // and writes one.
    {
        let mut c = store.user_drive(&program, lowers.clone()).unwrap();

        assert!(c.unlink(&parts("GAME\\SCORES.DAT")));
        assert!(c.unlink(&parts("WINDOWS\\WIN.INI")));

        let Some(Body::Host(mut file)) = c.create(&parts("GAME\\SAVE.DAT")) else {
            panic!("a file made");
        };

        file.write(b"saved");
    }

    assert_eq!(store.user_layer(&program), UserLayer::Same);

    // The next run: still deleted, still written.
    let c = store.user_drive(&program, lowers.clone()).unwrap();

    assert!(c.entry(&parts("GAME\\SCORES.DAT")).is_none());
    assert!(c.entry(&parts("WINDOWS\\WIN.INI")).is_none());
    assert_eq!(c.read(&parts("GAME\\SAVE.DAT")).unwrap(), b"saved");
    assert!(c.entry(&parts("GAME\\GAME.EXE")).is_some());
    assert_eq!(
        std::fs::read_to_string(store.user("Game").join("removed")).unwrap(),
        "GAME\\SCORES.DAT\r\nWINDOWS\\WIN.INI\r\n"
    );

    // Without the file kept beside it, the layer's would be back.
    let forgetting = HostDrive::layered(store.user("Game").join("C"), lowers);

    assert!(forgetting.entry(&parts("GAME\\SCORES.DAT")).is_some());

    // The program's layers changed: the user's layer is of another stack,
    // and may be set aside.
    program.layers.push("another".to_string());
    assert!(matches!(store.user_layer(&program), UserLayer::Other(_)));

    let aside = store.set_user_aside("Game").unwrap();

    assert!(aside.join("C").join("GAME").join("SAVE.DAT").is_file());
    assert_eq!(store.user_layer(&program), UserLayer::New);
}

#[test]
fn a_drive_given_keeps_its_deletes_outside_it() {
    let scratch = Scratch::new("drive");
    let drive = scratch.0.join("drive");

    std::fs::create_dir_all(&drive).unwrap();

    let removed = drive_removed(&scratch.0.join("winbox"), &drive);

    assert!(!removed.starts_with(&drive));
    assert_eq!(removed, drive_removed(&scratch.0.join("winbox"), &drive));
    assert!(
        HostDrive::over(drive.clone(), installation(&scratch.0))
            .keeping_removed(removed)
            .is_ok()
    );
}

#[test]
fn media_are_read_from_a_zip_and_names_are_held_to_dos() {
    use winbox_win16::assets::{StoredEntry, write_stored_zip};

    let zip = write_stored_zip(&[
        StoredEntry {
            path: "SETUP.EXE",
            data: b"MZ",
            date: 0x186a,
            time: 0x1940,
        },
        StoredEntry {
            path: "DISK1/DATA.CAB",
            data: b"data",
            date: 0x186a,
            time: 0x1940,
        },
    ])
    .unwrap();
    let tree = zip_tree(&zip, "GAME").unwrap();
    let lines: Vec<String> = everything(&tree)
        .iter()
        .map(|change| match change {
            Change::Folder { path, modified } => format!("folder {path} {modified}"),
            Change::File { path, modified, .. } => format!("file {path} {modified}"),
            Change::Removed { path } => format!("removed {path}"),
        })
        .collect();

    assert_eq!(
        lines,
        [
            format!("folder GAME {STAMP}"),
            "folder GAME\\DISK1 700197000".to_string(),
            "file GAME\\DISK1\\DATA.CAB 700197000".to_string(),
            "file GAME\\SETUP.EXE 700197000".to_string(),
        ]
    );

    let deflated = {
        // One entry, deflated, as zip tools write them.
        let data = b"deflated deflated deflated".to_vec();
        let packed = miniz_oxide::deflate::compress_to_vec(&data, 6);
        let crc = winbox_win16::assets::crc32(&data);
        let name = b"README.TXT";
        let mut zip = Vec::new();
        let header = |zip: &mut Vec<u8>, central: bool| {
            zip.extend_from_slice(if central {
                &[0x50, 0x4b, 0x01, 0x02, 20, 0]
            } else {
                &[0x50, 0x4b, 0x03, 0x04]
            });
            zip.extend_from_slice(&[20, 0, 0, 0, 8, 0, 0x40, 0x19, 0x6a, 0x18]);
            zip.extend_from_slice(&crc.to_le_bytes());
            zip.extend_from_slice(&(packed.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(data.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
            zip.extend_from_slice(&[0, 0]);

            if central {
                zip.extend_from_slice(&[0; 10]);
                zip.extend_from_slice(&0u32.to_le_bytes());
            }

            zip.extend_from_slice(name);
        };

        header(&mut zip, false);
        zip.extend_from_slice(&packed);

        let directory = zip.len() as u32;

        header(&mut zip, true);

        let size = zip.len() as u32 - directory;

        zip.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0]);
        zip.extend_from_slice(&size.to_le_bytes());
        zip.extend_from_slice(&directory.to_le_bytes());
        zip.extend_from_slice(&[0, 0]);
        zip
    };
    let tree = zip_tree(&deflated, "").unwrap();

    assert_eq!(
        tree.data("README.TXT").unwrap().as_slice(),
        b"deflated deflated deflated"
    );

    // A long name is refused, not shortened.
    let scratch = Scratch::new("names");

    write_files(&scratch.0, &[("Long Name.txt", b"", 800_000_000)]);
    assert!(host_tree(&scratch.0, "").unwrap_err().contains("DOS name"));
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A program run on a drive C: to its end, on the virtual clock, as the
/// probe harnesses run one: the system as it ended.
fn run_on(system: System, c: HostDrive, path: &str) -> System {
    let mut system = system;
    let bytes = c.read(&parts(path)).expect("the program on C:");

    system.files.mount('C', c);

    let executable = winbox_ne::Executable::parse(bytes).unwrap();
    let (program, libraries) = system.load(executable, path);

    system.link(program);
    system.start(program, libraries, "").unwrap();

    if let Some((folder, _)) = path.rsplit_once('\\') {
        system.files.set_path(folder);
    }

    let engine = winbox_win16::Engine::new(system);

    engine.run(2_000_000_000, 300.0);
    engine.into_system()
}

#[test]
#[allow(clippy::too_many_lines)]
fn an_installer_run_into_a_layer_and_the_program_run_from_its_stack() {
    let probes = root().join("oracle/build/probes");
    let (Ok(bundle), Ok(installer), Ok(child)) = (
        Assets::open(&root().join("oracle/build/assets")),
        std::fs::read(probes.join("INSTLAY.EXE")),
        std::fs::read(probes.join("INSTLAYC.EXE")),
    ) else {
        eprintln!("skipped: the asset bundle, or the instlay probe, is not made");
        return;
    };
    let bundle = Rc::new(bundle);
    let scratch = Scratch::new("install");
    let store = Store::new(scratch.0.join("winbox"));

    std::fs::create_dir_all(&store.root).unwrap();

    let base = Base::of_assets(&bundle, "vga", &store.root).unwrap();
    let mut program = Program::new("Instlay", &base);
    let system = || {
        let mut system = System::new();

        system.display = winbox_win16::display::mode("vga").unwrap();
        system.assets = Some(Rc::clone(&bundle));
        system
    };

    // The folder the probe writes its records in, `C:\ORACLE`, is the
    // user's own, a layer beneath the installer's: the probe harnesses
    // count it among their media, and an installer's own folder is not the
    // media's.
    let own = scratch.0.join("own");

    std::fs::create_dir_all(own.join("ORACLE")).unwrap();

    let stack = store.stack(&base, &program).unwrap();
    let layer = layer_of_folder(&own, &stack).unwrap();

    store.add_layer(&mut program, &stack, &layer).unwrap();

    // Installing: the probe, as an installer, run from its media at
    // C:\WBSETUP over the base, with the program it installs beside it.
    let media = scratch.0.join("media");

    write_files(
        &media,
        &[
            ("INSTLAY.EXE", &installer, 800_000_000),
            ("INSTLAYC.EXE", &child, 800_000_000),
        ],
    );

    let stack = store.stack(&base, &program).unwrap();
    let lowers = store.lowers(&base, &stack).unwrap();
    let staging = store.stage("Instlay", &media, Some("instlay.exe")).unwrap();

    assert_eq!(staging.media, "WBSETUP");
    assert_eq!(staging.setup, "C:\\WBSETUP\\INSTLAY.EXE");

    let ended = run_on(
        system(),
        staging.drive(lowers.clone()).unwrap(),
        &staging.setup,
    );

    drop(ended);

    let kept = installed(&staging, &stack, lowers)
        .unwrap()
        .expect("the installer left something");

    staging.discard();

    // What the installer wrote, and nothing of the media: not the setup
    // files, nor their folder. The same entries the probe harnesses keep
    // for `instlay` (`crates/winbox-win16/tests/install_layer.rs`), apart
    // from the probe's records in the user's `C:\ORACLE`, which the harness
    // drops as part of its media. The stamps are this run's own, so the id
    // is not the harness's; the entries and the bytes are.
    let layer = &kept.layer;
    let entries: Vec<String> = layer
        .manifest
        .entries
        .iter()
        .map(|entry| match entry {
            LayerEntry::Removed { path } => format!("removed {path}"),
            LayerEntry::Folder { path, .. } => format!("folder {path}"),
            LayerEntry::File { path, .. } => format!("file {path}"),
        })
        .filter(|entry| !entry.ends_with("ORACLE") && !entry.contains("ORACLE\\"))
        .collect();

    assert_eq!(
        entries,
        [
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
        ]
    );
    assert!(
        layer
            .manifest
            .entries
            .iter()
            .all(|entry| !entry.path().starts_with("WBSETUP"))
    );
    assert_eq!(
        layer.manifest.made.from.as_deref(),
        Some("C:\\WBSETUP\\INSTLAY.EXE")
    );
    assert_eq!(
        layer
            .blobs
            .get(&sha256_hex(&child))
            .map(|bytes| bytes.to_vec()),
        Some(child.clone()),
        "the program it installed, byte for byte"
    );

    // The media dropped, and what the installer wrote that names them told.
    assert!(
        kept.dropped
            .iter()
            .all(|path| path == "WBSETUP" || path.starts_with("WBSETUP\\")),
        "dropped: {:?}",
        kept.dropped
    );
    assert_eq!(
        kept.references
            .iter()
            .map(|reference| format!("{}: {}", reference.path, reference.line))
            .collect::<Vec<_>>(),
        ["WINDOWS\\WIN.INI: Media=C:\\WBSETUP\\INSTLAYC.EXE"]
    );

    store.add_layer(&mut program, &stack, layer).unwrap();
    assert_eq!(program.exes, ["C:\\INSTLAY\\INSTLAYC.EXE"]);

    // The program installed, run from its stack: its records go in the
    // user's layer, and the layers stay as kept.
    let program = store.program("Instlay").unwrap().unwrap();
    let stack = store.stack(&base, &program).unwrap();
    let lowers = store.lowers(&base, &stack).unwrap();
    let ended = run_on(
        system(),
        store.user_drive(&program, lowers.clone()).unwrap(),
        &program.exes[0],
    );

    drop(ended);

    let written = store
        .user("Instlay")
        .join("C")
        .join("ORACLE")
        .join("INSTLAY.OUT");
    let records = String::from_utf8_lossy(&std::fs::read(&written).unwrap()).to_string();

    // The installer's records were kept in the layer (`C:\ORACLE` is not
    // the media's) and the program it started read back in them; run
    // again from the stack it appends its own, and the folders it lists
    // have the stamps they are given on the base, not README.TXT's.
    assert_eq!(records.matches("c.module\t").count(), 2, "{records}");
    assert!(
        records.ends_with("c.stamp\tC:\\\\INSTLAY\tother\r\nc.stamp\tC:\\\\WINDOWS\tother\r\nc.stamp\tC:\\\\WINDOWS\\\\SYSTEM\tother\r\nc.stamp\tC:\\\\WINDOWS\\\\TEMP\tother\r\nc.stamp\tC:\\\\WINDOWS\\\\SYSTEM\\\\MIDIMAP.CFG\tother\r\n"),
        "{records}"
    );
    assert_eq!(
        store.layer(&layer.manifest.id).unwrap().manifest,
        layer.manifest
    );
}
