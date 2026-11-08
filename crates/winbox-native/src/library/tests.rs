//! The library: its folder, a program's record with its mode read back as
//! written, where its base was read from remembered, programs kept before
//! it told of and not moved; each kept program's groups as the launcher
//! lists them, over a stack of layers made from built-up group files, with
//! why an item cannot run; and an item run as `--launch` runs it, the
//! `pmitem` probe's child given what Program Manager gives it.

use std::rc::Rc;

use winbox_win16::assets::set_written;
use winbox_win16::groups::{GroupFile, IconMetrics, NewItem, store_command};

use super::*;
use crate::programs::layer_of_folder;

/// A folder of the host's for a test, let go of after it.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "winbox-native-library-{name}-{}",
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

/// Files written beneath a folder by their DOS paths, each stamped; an
/// empty path's last name a folder.
pub fn write_files(root: &Path, files: &[(&str, &[u8])]) {
    for (path, data) in files {
        let host = path
            .split('\\')
            .fold(root.to_path_buf(), |at, name| at.join(name));

        if path.ends_with('\\') {
            std::fs::create_dir_all(&host).unwrap();
            continue;
        }

        std::fs::create_dir_all(host.parent().unwrap()).unwrap();
        std::fs::write(&host, data).unwrap();
        set_written(&host, 800_000_000).unwrap();
    }
}

/// The least a file needs to be taken for a Windows program: an old
/// header whose `e_lfanew` points at `NE`.
pub fn new_executable() -> Vec<u8> {
    let mut bytes = vec![0u8; 0x48];

    bytes[..2].copy_from_slice(b"MZ");
    bytes[0x3c] = 0x40;
    bytes[0x40..0x42].copy_from_slice(b"NE");
    bytes
}

/// A DOS program: an old header alone.
pub fn dos_executable() -> Vec<u8> {
    let mut bytes = vec![0u8; 0x48];

    bytes[..2].copy_from_slice(b"MZ");
    bytes
}

/// A VGA icon, 32 by 32, four planes of a bit: each pixel `index` where
/// `opaque`, else the window's colour.
pub fn vga_icon(index: u8, opaque: bool) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let mut header = vec![0u8; 12];

    header[4] = 32;
    header[6] = 32;
    header[8] = 4;
    header[10] = 4;
    header[11] = 1;

    let and = vec![if opaque { 0 } else { 0xff }; 32 * 4];
    let mut xor = Vec::new();

    for _ in 0..32 {
        for plane in 0..4 {
            xor.extend([if index >> plane & 1 == 1 { 0xff } else { 0 }; 4]);
        }
    }

    (header, and, xor)
}

/// A group file made as Program Manager's `CreateGroup` and `AddItem`
/// make one (`GroupFile`), on the VGA, of items each a name, a command, a
/// working directory and whether it starts minimized.
pub fn group_file(name: &str, items: &[(&str, &str, &str, bool)]) -> Vec<u8> {
    let mut file = GroupFile::create(
        name.as_bytes(),
        IconMetrics {
            cx: 32,
            cy: 32,
            bits_pixel: 1,
            planes: 4,
        },
    );

    for (at, (name, command, directory, minimized)) in items.iter().enumerate() {
        let stored = store_command(
            command.as_bytes(),
            (!directory.is_empty()).then_some(directory.as_bytes()),
        );
        let (header, and, xor) = vga_icon(u8::try_from(at % 16).unwrap(), true);

        file.add_item(&NewItem {
            name: name.as_bytes().to_vec(),
            stored: stored.stored,
            icon_path: command.split(' ').next().unwrap().as_bytes().to_vec(),
            icon_index: 0,
            header,
            and,
            xor,
            x: 0,
            y: 0,
            hot_key: 0,
            minimized: *minimized,
            program_directory: stored.program_directory,
        })
        .unwrap();
    }

    file.bytes()
}

/// `pmitem`'s items (`oracle/probes/pmitem.c`), as its `AddItem`s make
/// them, and one of a DOS program.
pub const PMITEM_ITEMS: [(&str, &str, &str, bool); 9] = [
    ("Args", "C:\\WINDOWS\\PMITEMC.EXE one two", "", false),
    (
        "Dir",
        "C:\\WINDOWS\\PMITEMC.EXE dir",
        "C:\\ORACLE\\PMDIR",
        false,
    ),
    (
        "Low",
        "c:\\windows\\pmitemc.exe Low Case",
        "c:\\oracle\\pmdir",
        false,
    ),
    ("Min", "C:\\WINDOWS\\PMITEMC.EXE min", "", true),
    ("Doc", "C:\\ORACLE\\PMITEM.PMI", "", false),
    ("Missing", "C:\\WINDOWS\\NOSUCH.EXE gone", "", false),
    ("Lonely", "C:\\ORACLE\\PMITEM.ZQX", "", false),
    ("Bad", "C:\\WINDOWS\\PMITEMC.EXE bad", "C:\\NOSUCH", false),
    ("Dos", "C:\\GAMES\\DOSPROG.EXE", "", false),
];

/// A small installation's folder, as `--windows` names one: its
/// `WIN.INI` opening `.PMI` files with the probe's child.
pub fn installation(root: &Path) -> PathBuf {
    let folder = root.join("windows");

    write_files(
        &folder,
        &[
            (
                "WINDOWS\\WIN.INI",
                b"[windows]\r\nPrograms=com exe bat pif\r\n[Extensions]\r\npmi=pmitemc.exe ^.pmi\r\n",
            ),
            ("WINDOWS\\SYSTEM.INI", b"[boot]\r\n"),
            ("WINDOWS\\SYSTEM\\GDI.EXE", &new_executable()),
        ],
    );
    folder
}

/// A program kept on the installation, its layer of the user's files:
/// `pmitem`'s group, its program, the folders and files its items name.
pub fn keep_pmitem(store: &Store, base: &Base, name: &str, group: &str) -> Program {
    let own = store.root.with_file_name(format!("own-{name}"));
    let ini = "[Settings]\r\n[Groups]\r\nGroup1=C:\\WINDOWS\\PMITEM.GRP\r\n";

    write_files(
        &own,
        &[
            ("WINDOWS\\PMITEMC.EXE", &new_executable()),
            ("WINDOWS\\PROGMAN.INI", ini.as_bytes()),
            ("WINDOWS\\PMITEM.GRP", &group_file(group, &PMITEM_ITEMS)),
            ("ORACLE\\PMDIR\\", b""),
            ("ORACLE\\PMITEM.PMI", b"a document"),
            ("ORACLE\\PMITEM.ZQX", b"a document of nothing's"),
            ("GAMES\\DOSPROG.EXE", &dos_executable()),
        ],
    );

    let mut program = Program::new(name, base);
    let stack = store.stack(base, &program).unwrap();
    let layer = layer_of_folder(&own, &stack).unwrap();

    store.add_layer(&mut program, &stack, &layer).unwrap();
    program
}

/// A group's label, and each item's name and why it cannot run.
type Listed = (String, Vec<(String, Option<String>)>);

fn names(groups: &[Group]) -> Vec<Listed> {
    groups
        .iter()
        .map(|group| {
            (
                group.label.clone(),
                group
                    .items
                    .iter()
                    .map(|item| (item.name(), item.reason.clone()))
                    .collect(),
            )
        })
        .collect()
}

#[test]
fn the_library_is_the_hosts_folder_for_data_or_the_one_given() {
    let given = Path::new("/somewhere/else");

    assert_eq!(folder(Some(given)), given);

    let default = default_folder();
    let last = default.file_name().unwrap().to_string_lossy().to_string();

    if cfg!(any(windows, target_os = "macos")) {
        assert_eq!(last, "WinBox");
    } else {
        assert_eq!(last, "winbox");
        assert!(
            default.ends_with(".local/share/winbox") || std::env::var_os("XDG_DATA_HOME").is_some(),
            "{}",
            default.display()
        );
    }
}

#[test]
fn a_record_keeps_its_mode_and_where_its_base_was_read_from() {
    let scratch = Scratch::new("record");
    let store = Store::new(scratch.0.join("library"));
    let base = Base::of_folder(&installation(&scratch.0), "vga").unwrap();
    let mut program = keep_pmitem(&store, &base, "Pmitem", "PMItem");

    // Kept, the record says its mode: standard, where none was asked.
    let text = std::fs::read_to_string(store.root.join("programs").join("Pmitem.json")).unwrap();
    let record: serde_json::Value = serde_json::from_str(&text).unwrap();

    assert_eq!(record["mode"], "standard");
    assert_eq!(record["display"], "vga");
    assert_eq!(record["layers"].as_array().unwrap().len(), 1);
    assert_eq!(
        store.program("Pmitem").unwrap().unwrap(),
        program,
        "read back as written"
    );

    // Another mode, as the enhanced mode's `--mode` will keep one, read
    // back; a record of before, without one, is standard.
    program.mode = "enhanced".to_string();
    store.put_program(&program).unwrap();
    assert_eq!(store.program("Pmitem").unwrap().unwrap().mode, "enhanced");

    let mut older = record.clone();

    older.as_object_mut().unwrap().remove("mode");
    std::fs::write(
        store.root.join("programs").join("Older.json"),
        serde_json::to_vec(&{
            let mut older = older;

            older["name"] = "Older".into();
            older
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(store.program("Older").unwrap().unwrap().mode, STANDARD);

    // Where its base was read from, remembered, and read back.
    assert!(bases(&store).is_empty());
    remember_base(&store, base.name(), &Source::Windows(base.folder.clone())).unwrap();

    let known = bases(&store);

    assert_eq!(known.len(), 1);
    assert_eq!(
        known[base.name()],
        Source::Windows(std::fs::canonicalize(&base.folder).unwrap())
    );

    let text = std::fs::read_to_string(store.root.join("bases.json")).unwrap();

    assert!(text.contains("\"windows\""), "{text}");
}

#[test]
fn programs_kept_before_the_library_are_told_of_not_moved() {
    let scratch = Scratch::new("earlier");
    let cache = scratch.0.join("cache");
    let store = Store::new(scratch.0.join("library"));

    assert_eq!(earlier(&store, &cache), None);

    write_files(&cache, &[("programs\\Skifree.json", b"{}")]);

    let note = earlier(&store, &cache).unwrap();

    assert!(
        note.starts_with("Skifree kept before the library"),
        "{note}"
    );
    assert!(note.contains("--library"), "{note}");
    assert!(
        cache.join("programs").join("Skifree.json").is_file(),
        "nothing moved"
    );

    // Once the library has its own, nothing is said.
    write_files(&store.root, &[("programs\\Other.json", b"{}")]);
    assert_eq!(earlier(&store, &cache), None);
}

#[test]
#[allow(clippy::too_many_lines)]
fn a_programs_groups_are_listed_over_its_stack_with_why_an_item_cannot_run() {
    let scratch = Scratch::new("groups");
    let store = Store::new(scratch.0.join("library"));
    let base = Base::of_folder(&installation(&scratch.0), "vga").unwrap();

    remember_base(&store, base.name(), &Source::Windows(base.folder.clone())).unwrap();

    let pmitem = keep_pmitem(&store, &base, "Pmitem", "PMItem");
    let cache = scratch.0.join("cache");
    let mut reader = Reader::new(&store, cache.clone(), None);
    let groups = reader.groups(&pmitem).unwrap();
    let windows = "needs NOSUCH.EXE, which is not in this Windows".to_string();

    assert_eq!(
        names(&groups),
        [(
            "PMItem".to_string(),
            vec![
                ("Args".to_string(), None),
                ("Dir".to_string(), None),
                ("Low".to_string(), None),
                ("Min".to_string(), None),
                ("Doc".to_string(), None),
                ("Missing".to_string(), Some(windows)),
                (
                    "Lonely".to_string(),
                    Some("nothing in this Windows opens .ZQX files".to_string())
                ),
                ("Bad".to_string(), None),
                (
                    "Dos".to_string(),
                    Some(
                        "C:\\GAMES\\DOSPROG.EXE is a DOS program, which is not run here"
                            .to_string()
                    )
                ),
            ]
        )]
    );
    assert_eq!(groups[0].note, None);

    // What each is started with, as the page's launcher starts it.
    let start = |name: &str| start_of(find(&groups, name, None).unwrap());

    assert_eq!(
        start("Args").unwrap(),
        Start {
            path: "C:\\WINDOWS\\PMITEMC.EXE".to_string(),
            command_line: "one two".to_string(),
            directory: WINDOWS.to_string(),
            show: 1,
            directory_missing: false,
        }
    );
    assert_eq!(start("low").unwrap().directory, "C:\\ORACLE\\PMDIR");
    assert_eq!(start("Min").unwrap().show, 7);
    assert_eq!(start("Doc").unwrap().command_line, "C:\\ORACLE\\PMITEM.pmi");

    let bad = start("Bad").unwrap();

    assert!(bad.directory_missing);
    assert_eq!(bad.directory, WINDOWS);
    assert_eq!(
        start("Missing").unwrap_err(),
        "Missing cannot be run: needs NOSUCH.EXE, which is not in this Windows."
    );

    // Each item's icon from its group file's bits.
    let icon = groups[0].items[1].icon.as_ref().unwrap();

    assert_eq!(
        (icon.cx, icon.cy, icon.planes, icon.bits_pixel),
        (32, 32, 4, 1)
    );

    // A second install with a group of the same name, and a program kept
    // loose: every group, in the programs' order (by name), the two of one
    // name labelled with their installs'; the loose program's WinBox's own.
    keep_pmitem(&store, &base, "Second", "PMItem");

    let loose_files = scratch.0.join("loose");

    write_files(&loose_files, &[("SKI\\SKI.EXE", &new_executable())]);

    let mut loose = Program::new("Skifree", &base);
    let stack = store.stack(&base, &loose).unwrap();

    store
        .add_layer(
            &mut loose,
            &stack,
            &layer_of_folder(&loose_files, &stack).unwrap(),
        )
        .unwrap();

    let mut reader = Reader::new(&store, cache.clone(), None);
    let (listed, empty) = reader.launcher();

    assert_eq!(empty, None);
    assert_eq!(
        listed
            .iter()
            .map(|group| (group.label.as_str(), group.items.len()))
            .collect::<Vec<_>>(),
        [
            ("PMItem (Pmitem)", 9),
            ("PMItem (Second)", 9),
            ("Skifree", 1)
        ]
    );
    assert_eq!(listed[2].items[0].name(), "Ski");
    assert_eq!(
        start_of(&listed[2].items[0]).unwrap().path,
        "C:\\SKI\\SKI.EXE"
    );
    // Two groups of one install with an item of the same name: which is
    // named.
    let mut two = vec![listed[0].clone(), listed[0].clone()];

    two[1].name = "Other".to_string();
    assert_eq!(
        find(&two, "Args", None).unwrap_err(),
        "Args is in the groups Other, PMItem: name one with --group"
    );
    assert!(std::ptr::eq(
        find(&two, "Args", Some("other")).unwrap(),
        &raw const two[1].items[0]
    ));

    // Without its base, every item is shown, none run.
    std::fs::remove_file(store.root.join("bases.json")).unwrap();

    let mut reader = Reader::new(&store, cache.clone(), None);
    let groups = reader.groups(&pmitem).unwrap();

    assert_eq!(groups[0].items.len(), 9);
    assert!(groups[0].items.iter().all(
        |item| item.reason.as_deref() == Some("Pmitem was made on a Windows that is not here")
    ));

    // Given on the command line, it is used.
    let mut reader = Reader::new(
        &store,
        cache.clone(),
        Some(Source::Windows(base.folder.clone())),
    );

    assert_eq!(reader.groups(&pmitem).unwrap()[0].items[0].reason, None);

    // A program kept for enhanced mode is not run by this build.
    let mut enhanced = pmitem.clone();

    enhanced.mode = "enhanced".to_string();

    let groups = reader.groups(&enhanced).unwrap();

    assert_eq!(
        groups[0].items[0].reason.as_deref(),
        Some("Pmitem was kept for Windows' enhanced mode, which this build does not run")
    );

    reader.modes = true;
    assert_eq!(reader.groups(&enhanced).unwrap()[0].items[0].reason, None);

    // With nothing kept, the launcher says how to keep one.
    let empty_store = Store::new(scratch.0.join("empty"));

    let (none, said) = Reader::new(&empty_store, cache, None).launcher();

    assert!(none.is_empty());
    assert_eq!(said.as_deref(), Some(EMPTY));
}

#[test]
fn an_item_is_found_by_its_name_and_its_groups() {
    let scratch = Scratch::new("find");
    let store = Store::new(scratch.0.join("library"));
    let base = Base::of_folder(&installation(&scratch.0), "vga").unwrap();
    let program = keep_pmitem(&store, &base, "Pmitem", "PMItem");
    let mut reader = Reader::new(
        &store,
        scratch.0.join("cache"),
        Some(Source::Windows(base.folder.clone())),
    );
    let groups = reader.groups(&program).unwrap();

    assert_eq!(find(&groups, "dIr", None).unwrap().name(), "Dir");
    assert_eq!(find(&groups, "Dir", Some("pmitem")).unwrap().name(), "Dir");
    assert!(
        find(&groups, "Dir", Some("Games"))
            .unwrap_err()
            .starts_with("no item Dir in a group Games; its items: PMItem: Args, PMItem: Dir")
    );
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// What the probe's child has written, a line each run.
fn written(store: &Store, name: &str) -> String {
    std::fs::read_to_string(store.user(name).join("C").join("ORACLE").join("PMITEM.TXT"))
        .unwrap_or_default()
}

#[test]
fn an_item_is_run_given_what_program_manager_gives_it() {
    let probes = root().join("oracle/build/probes");
    let (Ok(bundle), Ok(child)) = (
        Assets::open(&root().join("oracle/build/assets")),
        std::fs::read(probes.join("PMITEMC.EXE")),
    ) else {
        eprintln!("skipped: the asset bundle, or the pmitem probe, is not made");
        return;
    };
    let bundle = Rc::new(bundle);
    let scratch = Scratch::new("launch");
    let store = Store::new(scratch.0.join("library"));
    let cache = scratch.0.join("cache");
    let base = Base::of_assets(&bundle, "vga", &cache).unwrap();
    let own = scratch.0.join("own");
    let ini = "[Settings]\r\n[Groups]\r\nGroup1=C:\\WINDOWS\\PMITEM.GRP\r\n";

    write_files(
        &own,
        &[
            ("WINDOWS\\PMITEMC.EXE", &child),
            ("WINDOWS\\PROGMAN.INI", ini.as_bytes()),
            ("WINDOWS\\PMITEM.GRP", &group_file("PMItem", &PMITEM_ITEMS)),
            ("ORACLE\\PMDIR\\", b""),
        ],
    );

    let mut program = Program::new("Pmitem", &base);
    let stack = store.stack(&base, &program).unwrap();

    store
        .add_layer(
            &mut program,
            &stack,
            &layer_of_folder(&own, &stack).unwrap(),
        )
        .unwrap();

    let mut reader = Reader::new(&store, cache, None);

    reader.known(&program, base.clone());

    let groups = reader.groups(&program).unwrap();
    let stack = store.stack(&base, &program).unwrap();
    let lowers = store.lowers(&base, &stack).unwrap();

    // Each item a run of its own, a process of its own as `--launch` makes
    // one, on the program's C: -- its user's layer over its stack -- as
    // `pmitem` recorded each under Windows (`oracle/fixtures/pmitem.json`).
    for item in ["Args", "Dir", "Low", "Min", "Bad"] {
        let start = start_of(find(&groups, item, None).unwrap()).unwrap();
        let mut system = winbox_win16::System::new();

        system.display = winbox_win16::display::mode("vga").unwrap();
        system.assets = Some(Rc::clone(&bundle));
        system
            .files
            .mount('C', store.user_drive(&program, lowers.clone()).unwrap());
        start_item(&mut system, &start).unwrap();

        let engine = winbox_win16::Engine::new(system);
        let stop = engine.run(2_000_000_000, 300.0);

        assert_eq!(stop, winbox_win16::Stop::Ended, "{item}");
    }

    assert_eq!(
        written(&store, "Pmitem"),
        "args=one two|cwd=C:\\WINDOWS|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=dir|cwd=C:\\ORACLE\\PMDIR|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=Low Case|cwd=C:\\ORACLE\\PMDIR|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=min|cwd=C:\\WINDOWS|show=7|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=bad|cwd=C:\\WINDOWS|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n"
    );
}
