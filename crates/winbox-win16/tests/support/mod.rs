//! What the tests that run the oracle's probes share: the probes run to
//! their end, how each is set up as the oracle ran it, and its records read
//! back.
#![allow(dead_code)]

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use winbox_machine::{HostDrive, MemoryDrive};
use winbox_ne::Executable;
use winbox_win16::sys_error_box::BoxHand;
use winbox_win16::{Stop, System};

/// The probes the Rust engine runs to their end, agreeing with Windows.
pub const AGREEING: &[&str] = &[
    "stackpos",
    "grealloc",
    "greuse",
    "memory",
    "glock",
    "localre",
    "mmtime",
    "mmdevs",
    "mcidevs",
    "mcifile",
    "sndplay",
    "drivers",
    "drvmsg",
    "registry",
    "shell2",
    "shlhook",
    "comms",
    "escapes-vga",
    "escapes-ega",
    "escapes-svga",
    "escapes-hercules",
    "enumobj-vga",
    "enumobj-ega",
    "enumobj-svga",
    "enumobj-hercules",
    "enumregs",
    "filecdr",
    "queries",
    "scrolls",
    "updrgn",
    "winhelp",
    "clip",
    "lockupd",
    "btnclick",
    "btnkeys",
    "altchild",
    "capdbl",
    "comboact",
    "titledis",
    "curerr",
    "mousemsg",
    "nchit-vga",
    "nchit-ega",
    "nchit-hercules",
    "btnmore",
    "sndplay-vgasound",
    "stockdel-vga",
    "stockdel-ega",
    "stockdel-hercules",
    "stockdel-svga",
    "search",
];

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A probe's records as Windows wrote them: function, arguments, result.
pub fn recorded(name: &str) -> Option<Vec<[String; 3]>> {
    let text = std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json"))).ok()?;
    let fixture: serde_json::Value = serde_json::from_str(&text).ok()?;
    let field =
        |record: &serde_json::Value, key: &str| record[key].as_str().unwrap_or("").to_string();

    Some(
        fixture["records"]
            .as_array()?
            .iter()
            .map(|record| {
                [
                    field(record, "function"),
                    field(record, "args"),
                    field(record, "result"),
                ]
            })
            .collect(),
    )
}

/// The probe's own records, as `recordsFrom` reads them: tab-separated,
/// escapes undone, notes left out.
pub fn records_of(text: &[u8]) -> Vec<[String; 3]> {
    let unescape = |field: &str| {
        let mut out = String::new();
        let mut chars = field.chars();

        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('t') => out.push('\t'),
                    Some('r') => out.push('\r'),
                    Some('n') => out.push('\n'),
                    Some(other) => out.push(other),
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }

        out
    };
    let text: String = text.iter().map(|&byte| char::from(byte)).collect();

    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split('\t').map(unescape);

            [
                fields.next().unwrap_or_default(),
                fields.next().unwrap_or_default(),
                fields.next().unwrap_or_default(),
            ]
        })
        .filter(|record| record[0] != "#")
        .collect()
}

/// The display a fixture was recorded on, as winbox.js names it: `vga`
/// where it says none.
pub fn fixture_display(name: &str) -> String {
    std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|fixture| fixture["display"].as_str().map(str::to_string))
        .unwrap_or_else(|| "vga".to_string())
}

/// The display the oracle's installation with a sound card is recorded on
/// (`--display vgasound`): the VGA, with the Sound Blaster 1.5 and Ad Lib
/// drivers.
pub const SOUND: &str = "vgasound";

/// The keys a whole run presses when a box of USER's own that lets no
/// program run comes up, one list for each box, as the recording pressed
/// them (`record.mjs --shoot ... --then`) and the TypeScript engine's
/// replay presses them; and where it clicks at a box that takes no key, as
/// the recording clicked (`click=XxY`): MCI's sequencer's warning, its OK at
/// (410, 237) (`oracle/build/screens/sndplay.png`).
pub const BOX_KEYS: &[(&str, &[&[Step]])] = &[
    ("fault", &[&[Step::Key(VK_RETURN)], &[Step::Key(VK_RETURN)]]),
    (
        "minis3",
        &[&[Step::Key(VK_RETURN)], &[Step::Key(VK_RETURN)]],
    ),
    (
        "nullds",
        &[&[Step::Key(VK_RETURN)], &[Step::Key(VK_RETURN)]],
    ),
    ("sndplay", &[&[Step::Click(410, 237)]]),
];

pub const VK_TAB: u16 = 0x09;
pub const VK_RETURN: u16 = 0x0d;

// A hand at the box, as the survey has one.
pub use winbox_win16::survey::{Step, hand};

/// A probe run from `C:\`, its records written to `C:\ORACLE`: why it
/// stopped, and its records. `None` where it is not built.
pub fn run(name: &str) -> Option<(Stop, Vec<[String; 3]>)> {
    run_with(name, |system| system.box_hand = Some(box_hand(name)))
}

/// The hand at USER's boxes a whole run of the probe has (`BOX_KEYS`).
pub fn box_hand(name: &str) -> BoxHand {
    let probe = name.rsplit_once('-').map_or(name, |(probe, _)| probe);
    let boxes = BOX_KEYS
        .iter()
        .find(|&&(each, _)| each == probe)
        .map(|&(_, boxes)| boxes.iter().map(|steps| steps.to_vec()).collect())
        .unwrap_or_default();

    hand(boxes, |_| ()).0
}

/// How many probe runs this test binary has made, each its own drive.
pub static RUNS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// `run`, the system made ready by `prepare` before the probe starts.
pub fn run_with(name: &str, prepare: impl FnOnce(&mut System)) -> Option<(Stop, Vec<[String; 3]>)> {
    // As long as the heaviest probes take to end -- the outline faces' run
    // to 470 million instructions, some 160 seconds on the virtual clock --
    // where the TypeScript engine's whole runs have 30 seconds of the
    // host's, in which it gets that far.
    run_on(name, prepare, |system| {
        (
            winbox_win16::Engine::new(system).run(2_000_000_000, 300.0),
            (),
        )
    })
    .map(|(stop, records, ())| (stop, records))
}

/// A probe's run as the oracle ran it: the system on its display, the
/// installation its drive C: has beneath, and what is put on that drive.
pub struct Setup {
    pub system: System,
    /// The probe's name, upper case, as its files are named.
    pub upper: String,
    pub bytes: Vec<u8>,
    /// The installation's folder.
    pub windows: PathBuf,
    /// The files put on drive C:, by their paths there, with their bytes.
    pub placed: Vec<(String, Vec<u8>)>,
}

impl Setup {
    /// A probe's run made ready; `None` where it is not built.
    pub fn of(name: &str) -> Option<Self> {
        // A fixture named for a display is its probe run on that display;
        // another, on the display it was recorded on -- the VGA without one.
        let (probe, display) = match name.rsplit_once('-') {
            Some((probe, display))
                if winbox_win16::display::mode(display).is_some() || display == SOUND =>
            {
                (probe, display.to_string())
            }
            _ => (name, fixture_display(name)),
        };
        // One recorded on the installation with a sound card is run on the
        // VGA's with winbox.js's own sound driver installed.
        let sound = display == SOUND;
        let display = if sound { "vga".to_string() } else { display };
        let upper = probe.to_ascii_uppercase();
        let bytes = std::fs::read(root().join(format!("oracle/build/probes/{upper}.EXE"))).ok()?;

        let mut system = System::new();

        // The installation with a sound card is recorded at a fixed 3,000
        // cycles a millisecond, the survey's clock's rate: its calls are
        // charged the instructions Windows ran for them (`call_costs.rs`),
        // as its recordings' times have them.
        system.clock.measured_calls = sound;
        let display = match winbox_win16::display::mode(&display) {
            Some(mode) => {
                system.display = mode;
                display
            }
            None => "vga".to_string(),
        };

        // The probe on the drive, where the oracle ran it from.
        let mut placed = vec![(format!("{upper}.EXE"), bytes.clone())];

        // And what it brings, where the recorder puts it: beside Windows
        // (`build-probes.mjs`) -- its library, and the program it starts.
        for brought in [format!("{upper}D.DLL"), format!("{upper}C.EXE")] {
            if let Ok(bytes) = std::fs::read(root().join("oracle/build/probes").join(&brought)) {
                placed.push((format!("WINDOWS\\{brought}"), bytes));
            }
        }

        // The machine the oracle recorded on: A:, a floppy; C:, Windows
        // installed, its own files read and never written; Z:, DOSBox's.
        let windows = if display == "vga" {
            root().join("oracle/build/drive-c")
        } else {
            root().join(format!("oracle/build/drive-c-{display}"))
        };
        // A probe that prints finds winbox.js's own printer installed, as the
        // TypeScript engine's run installs it (`run-probe.ts`): on the VGA,
        // where `vgaprint` recorded with Windows' PostScript driver.
        if probe == "printing"
            && let Ok(text) = std::fs::read(windows.join("WINDOWS").join("WIN.INI"))
        {
            placed.push((
                "WINDOWS\\WIN.INI".to_string(),
                winbox_win16::printer::install_printer(&text),
            ));
        }

        // A probe recorded with Windows' Sound Blaster and Ad Lib drivers
        // finds winbox.js's own sound driver named in `SYSTEM.INI`'s
        // `[drivers]` in their place.
        if sound && let Ok(text) = std::fs::read(windows.join("WINDOWS").join("SYSTEM.INI")) {
            placed.push((
                "WINDOWS\\SYSTEM.INI".to_string(),
                winbox_win16::wbsound::install(&text),
            ));
        }

        Some(Self {
            system,
            upper,
            bytes,
            windows,
            placed,
        })
    }

    /// The probe loaded and started from `C:\`, the system made ready by
    /// `prepare` first.
    fn start(mut self, prepare: impl FnOnce(&mut System)) -> System {
        let (program, libraries) = self.system.load(
            Executable::parse(self.bytes).unwrap(),
            &format!("C:\\{}.EXE", self.upper),
        );

        self.system.link(program);
        self.system.start(program, libraries, "").unwrap();
        prepare(&mut self.system);
        self.system
    }
}

/// `run_with`, the system made ready run by `go`: why it stopped, and what
/// else `go` makes of it; and the probe's records.
pub fn run_on<T>(
    name: &str,
    prepare: impl FnOnce(&mut System),
    go: impl FnOnce(System) -> (Stop, T),
) -> Option<(Stop, Vec<[String; 3]>, T)> {
    let mut setup = Setup::of(name)?;
    // A drive of the run's own: tests running at once may run one probe.
    let run = RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let drive =
        std::env::temp_dir().join(format!("winbox-probe-{name}-{}-{run}", std::process::id()));

    std::fs::create_dir_all(drive.join("C").join("ORACLE")).unwrap();

    for (path, bytes) in &setup.placed {
        let to = path
            .split('\\')
            .fold(drive.join("C"), |folder, name| folder.join(name));

        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::write(to, bytes).unwrap();
    }

    let c = if setup.windows.is_dir() {
        HostDrive::over(drive.join("C"), setup.windows.clone())
    } else {
        HostDrive::new(drive.join("C"))
    };

    std::fs::create_dir_all(drive.join("A")).unwrap();
    std::fs::create_dir_all(drive.join("Z")).unwrap();
    setup
        .system
        .files
        .mount('A', HostDrive::removable(drive.join("A")));
    setup.system.files.mount('C', c);
    setup
        .system
        .files
        .mount('Z', HostDrive::new(drive.join("Z")));

    let upper = setup.upper.clone();
    let (stop, made) = go(setup.start(prepare));
    let output = std::fs::read(drive.join("C").join("ORACLE").join(format!("{upper}.OUT")))
        .unwrap_or_default();

    std::fs::remove_dir_all(drive).unwrap();
    Some((stop, records_of(&output), made))
}

/// A host's folder held in memory, each file and folder last written when
/// the host's was.
pub fn held(folder: &Path) -> MemoryDrive {
    fn seconds(path: &Path) -> i64 {
        std::fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_secs() as i64)
    }

    fn add(drive: &mut MemoryDrive, folder: &Path, dos: &str) {
        for entry in std::fs::read_dir(folder).unwrap().flatten() {
            let path = entry.path();
            let dos = format!("{dos}\\{}", entry.file_name().to_string_lossy());

            if path.is_dir() {
                assert!(drive.add_folder(&dos, seconds(&path)));
                add(drive, &path, &dos);
            } else {
                assert!(drive.add_file(&dos, std::fs::read(&path).unwrap(), seconds(&path)));
            }
        }
    }

    let mut drive = MemoryDrive::new();

    add(&mut drive, folder, "");
    drive
}

thread_local! {
    /// The installations held in memory, by their folders: each loaded once
    /// a thread, each run's drive C: made from it sharing its files.
    static INSTALLED: RefCell<std::collections::HashMap<PathBuf, MemoryDrive>> =
        RefCell::default();
}

/// An installation's folder held in memory, as `held` holds it, loaded once
/// a thread: the drive every run made from it shares.
pub fn installed(folder: &Path) -> MemoryDrive {
    INSTALLED.with(|installed| {
        installed
            .borrow_mut()
            .entry(folder.to_path_buf())
            .or_insert_with(|| held(folder))
            .clone()
    })
}

/// `run_with`, every drive held in memory: C: made from the installation
/// held in memory (`installed`), A: and Z: empty. Why it stopped, its
/// records, and the system as it ended, its drives with it.
pub fn run_in_memory(
    name: &str,
    prepare: impl FnOnce(&mut System),
) -> Option<(Stop, Vec<[String; 3]>, System)> {
    let mut setup = Setup::of(name)?;
    let now = winbox_machine::host_seconds();
    let mut c = if setup.windows.is_dir() {
        installed(&setup.windows)
    } else {
        MemoryDrive::new()
    };

    assert!(c.add_folder("ORACLE", now));

    for (path, bytes) in &setup.placed {
        assert!(c.add_file(path, bytes.clone(), now));
    }

    setup.system.files.mount('A', MemoryDrive::removable());
    setup.system.files.mount('C', c);
    setup.system.files.mount('Z', MemoryDrive::new());

    let upper = setup.upper.clone();
    let engine = winbox_win16::Engine::new(setup.start(prepare));
    let stop = engine.run(2_000_000_000, 300.0);
    let system = engine.into_system();
    let output = system
        .files
        .read_from("C:\\ORACLE", &format!("{upper}.OUT"))
        .map(|(_, bytes)| bytes)
        .unwrap_or_default();

    Some((stop, records_of(&output), system))
}
