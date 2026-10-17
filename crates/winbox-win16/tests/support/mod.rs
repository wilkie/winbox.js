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
    "mmio",
    "sndrec",
    "sndrec-vgasound",
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
    "selbmp",
    "btnmore",
    "sndplay-vgasound",
    "stockdel-vga",
    "stockdel-ega",
    "stockdel-hercules",
    "stockdel-svga",
    "search",
    "filedlg",
    "editdbl",
    "sllen",
    "menuenab",
    "mdisys",
    "hidfocus",
    "comboesc",
    "editundo",
    "mldlg",
    "mlfull",
    "lwrhuge",
    "accinit",
    "accsys",
    "openfile",
    "cardview",
    "altenter",
    "notepos",
    "ulcolour",
    "sysq",
    "jrnlrec",
    "jrnlplay",
    "inhook",
    "tasklist",
    "prtsc",
    "hotkey",
    "keyrep",
    "inlock",
    "sysparam",
    "drvres-vga",
    "drvres-ega",
    "drvres-hercules",
    "drvres-svga",
    "fontres",
    "dblrect",
    "deskwall-vga",
    "deskwall-ega",
    "deskwall-svga",
    "deskwall-hercules",
    "deskwall-vga256",
    "deskbrsh-ega",
    "deskbrsh-hercules",
    "swpframe",
    "titledbl",
    "minmax",
    "nccalc",
    "menuwnd",
    "enumfam-vga",
    "enumfam-ega",
    "enumfam-hercules",
    "enumfam-svga",
    "strcpyn",
    "editclip",
    "deskdeep-vga",
    "deskdeep-vga256",
    "alttab",
    "enddlg",
    "syschar",
    "mmiohi",
    "mmioext",
    "fontdef",
    "fontver-vga",
    "fontver-hercules",
    "fontboot-fonts",
    "fontboot-ttoff",
    "fontboot-ttonly",
    "sndbig",
    "inpost",
    "gmhook",
    "hwhook",
    "lockinp",
    "bcast",
    "bdrwidth",
    "langdrv",
    "spiboot-settings",
    "spiidle",
    "wavemix",
    "sysdlg",
    "dlgcode",
    "sysfilt",
    "cbthook",
    "sebhook",
    "ddexact",
    "postend",
    "associco",
    "dderaw",
    "ddemgmt",
    "profhold",
    "findrepl",
    "choosclr",
    "ftitle",
    "ofnerr",
    "ofnopen",
    "pmatom",
    "chfont",
    "chfont2",
    "prdlg",
    "prdlgx",
    "pric",
    "prdoc",
    "prspool",
    "prabort",
    "prdraw",
    "prlpt",
    "chfont3",
    "chfontpr",
    "lbtext",
];

/// The files a probe that prints finds on its drive, as the TypeScript
/// engine's run puts them (`run-probe.ts`).
///
/// * `printing` finds winbox.js's own printer installed in `WIN.INI`: on
///   the VGA, where `vgaprint` recorded with Windows' PostScript driver.
/// * A probe of COMMDLG's print dialogs, recorded on the installation with
///   a printer (`vgaprint`), finds that printer's driver where Setup put it:
///   the dialogs load it by name and ask it for its DEVMODE and what it can
///   do. The probe writes the printer into `WIN.INI` itself (`prdlg.c`).
fn printers(probe: &str, windows: &Path) -> Vec<(String, Vec<u8>)> {
    let mut placed = Vec::new();

    if probe == "printing"
        && let Ok(text) = std::fs::read(windows.join("WINDOWS").join("WIN.INI"))
    {
        placed.push((
            "WINDOWS\\WIN.INI".to_string(),
            winbox_win16::printer::install_printer(&text),
        ));
    }

    let driver = root().join("oracle/build/drive-c-vgaprint/WINDOWS/SYSTEM/PSCRIPT.DRV");

    if [
        "prdlg", "chfontpr", "prdlgx", "pric", "prdoc", "prspool", "prabort", "prdraw", "prlpt",
    ]
    .contains(&probe)
        && let Ok(bytes) = std::fs::read(driver)
    {
        placed.push(("WINDOWS\\SYSTEM\\PSCRIPT.DRV".to_string(), bytes));
    }

    placed
}

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

/// The MIDI Mapper setup a fixture was recorded with, where the recording
/// made one current that the installation's is not (`record.mjs
/// --midimap`, kept in its source).
pub fn midimap_of(name: &str) -> Option<String> {
    if !name.contains('-') {
        return None;
    }

    std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|fixture| fixture["source"]["midimap"].as_str().map(str::to_string))
}

/// The `WIN.INI` preset a fixture was recorded with (`record.mjs --ini`,
/// kept in its source): `oracle/probes/<probe>.<preset>.ini`.
pub fn ini_of(name: &str) -> Option<String> {
    if !name.contains('-') {
        return None;
    }

    std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|fixture| fixture["source"]["ini"].as_str().map(str::to_string))
}

/// A preset's sections, each with its keys and values in order, as
/// `scripts/oracle/ini-preset.mjs` reads them.
pub fn parse_preset(text: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut sections: Vec<(String, Vec<(String, String)>)> = Vec::new();

    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with(';') {
            continue;
        }

        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            sections.push((name.to_string(), Vec::new()));
            continue;
        }

        if let (Some((_, keys)), Some((key, value))) = (sections.last_mut(), line.split_once('='))
            && !key.trim().is_empty()
        {
            keys.push((key.trim().to_string(), value.trim().to_string()));
        }
    }

    sections
}

/// `WIN.INI`'s text with a preset's sections set in it, as
/// `ini-preset.mjs` sets them: each key's line in its section replaced,
/// else written after the section's last line that is not blank, else the
/// section added at the end; `[oracle copy]` left out.
pub fn merge_ini(text: &[u8], sections: &[(String, Vec<(String, String)>)]) -> Vec<u8> {
    let text: String = text.iter().map(|&byte| char::from(byte)).collect();
    let mut lines: Vec<String> = text
        .split('\n')
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();

    if lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }

    for (name, keys) in sections {
        if name.eq_ignore_ascii_case("oracle copy") {
            continue;
        }

        for (key, value) in keys {
            let wanted = format!("[{}]", name.to_lowercase());
            let Some(header) = lines
                .iter()
                .position(|line| line.trim().to_lowercase() == wanted)
            else {
                lines.push(format!("[{name}]"));
                lines.push(format!("{key}={value}"));
                continue;
            };
            let mut end = header + 1;

            while end < lines.len() && !lines[end].trim().starts_with('[') {
                end += 1;
            }

            let existing = lines[header + 1..end].iter().position(|line| {
                line.split('=')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .eq_ignore_ascii_case(key)
            });

            if let Some(at) = existing {
                lines[header + 1 + at] = format!("{key}={value}");
            } else {
                let mut last = end;

                while last > header + 1 && lines[last - 1].trim().is_empty() {
                    last -= 1;
                }

                lines.insert(last, format!("{key}={value}"));
            }
        }
    }

    let mut joined = lines.join("\r\n");

    joined.push_str("\r\n");
    joined.chars().map(|ch| ch as u8).collect()
}

/// Libraries of the corpus's programs a probe uses, by the probe, as
/// `record.mjs`'s `FROM_CORPUS` names them: SimTower's mixer.
pub const FROM_CORPUS: &[(&str, &str)] = &[("wavemix", "simtower/WAVMIX16.DLL")];

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
    (
        "openfile",
        &[&[Step::Key(VK_RETURN)], &[Step::Key(VK_RETURN)]],
    ),
    ("sebhook", &[&[Step::Key(VK_RETURN)]]),
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
        // One recorded with the MIDI Mapper's current setup another
        // (`record.mjs --midimap`), named `<probe>-<setup>`, is its probe
        // run with that setup current (`midimap`).
        let midimap = midimap_of(name);
        let ini = ini_of(name);
        let (probe, display) = match (name.rsplit_once('-'), &midimap) {
            (Some((probe, _)), _) if ini.is_some() => (probe, fixture_display(name)),
            (Some((probe, _)), Some(_)) => (probe, SOUND.to_string()),
            (Some((probe, display)), None)
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

        // And a library of a program of the corpus it uses, in Windows'
        // system folder, as the recorder puts it (`record.mjs`,
        // `FROM_CORPUS`); not run where the corpus does not have it.
        for &(user, file) in FROM_CORPUS {
            if user == probe {
                let bytes = std::fs::read(root().join("corpus/programs").join(file)).ok()?;
                let name = file.rsplit('/').next().unwrap_or(file);

                placed.push((format!("WINDOWS\\SYSTEM\\{name}"), bytes));
            }
        }

        // The machine the oracle recorded on: A:, a floppy; C:, Windows
        // installed, its own files read and never written; Z:, DOSBox's.
        let windows = if display == "vga" {
            root().join("oracle/build/drive-c")
        } else {
            root().join(format!("oracle/build/drive-c-{display}"))
        };
        // A probe recorded with a `WIN.INI` preset (`record.mjs --ini`) finds
        // `WIN.INI` set as it says, and its copies made.
        if let Some(preset) = &ini
            && let Ok(text) =
                std::fs::read_to_string(root().join(format!("oracle/probes/{probe}.{preset}.ini")))
        {
            let sections = parse_preset(&text);
            let on_drive = |path: &str| {
                path.trim_start_matches("C:\\")
                    .trim_start_matches("c:\\")
                    .split('\\')
                    .fold(windows.clone(), |folder, name| folder.join(name))
            };

            for (name, keys) in &sections {
                if !name.eq_ignore_ascii_case("oracle copy") {
                    continue;
                }

                for (to, from) in keys {
                    if let Ok(bytes) = std::fs::read(on_drive(from)) {
                        let to = to.trim_start_matches("C:\\").trim_start_matches("c:\\");

                        placed.push((to.to_string(), bytes));
                    }
                }
            }

            if let Ok(text) = std::fs::read(windows.join("WINDOWS").join("WIN.INI")) {
                placed.push(("WINDOWS\\WIN.INI".to_string(), merge_ini(&text, &sections)));
            }
        }

        placed.extend(printers(probe, &windows));

        // A probe recorded with Windows' Sound Blaster and Ad Lib drivers
        // finds winbox.js's own sound driver named in `SYSTEM.INI`'s
        // `[drivers]` in their place, as the card they recorded: the Sound
        // Blaster 1.5's (`[wbsound.drv]`, `card=`), not WinBox's own. And
        // the MIDI Mapper's setups in `MIDIMAP.CFG` naming its devices, the
        // current one the installation's, "Ad Lib", but where the recording made
        // another current (`record.mjs --midimap` writes it in the file).
        if sound && let Ok(text) = std::fs::read(windows.join("WINDOWS").join("SYSTEM.INI")) {
            let profile = winbox_win16::wbsound::Profile::SoundBlaster;

            placed.push((
                "WINDOWS\\SYSTEM.INI".to_string(),
                winbox_win16::wbsound::install_as(&text, profile),
            ));

            if let Ok(bytes) = std::fs::read(windows.join("WINDOWS/SYSTEM/MIDIMAP.CFG")) {
                let installed = match &midimap {
                    Some(setup) => winbox_win16::wbmapper::setups::install(&bytes, setup),
                    None => winbox_win16::wbsound::install_setups(&bytes),
                };

                if let Some(installed) = installed {
                    placed.push(("WINDOWS\\SYSTEM\\MIDIMAP.CFG".to_string(), installed));
                }
            }
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
    Some(run_setup(name, Setup::of(name)?, prepare, go))
}

/// `run_on`, the probe's run made ready as `setup` has it.
pub fn run_setup<T>(
    name: &str,
    mut setup: Setup,
    prepare: impl FnOnce(&mut System),
    go: impl FnOnce(System) -> (Stop, T),
) -> (Stop, Vec<[String; 3]>, T) {
    // A drive of the run's own: tests running at once may run one probe.
    let run = RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let drive =
        std::env::temp_dir().join(format!("winbox-probe-{name}-{}-{run}", std::process::id()));

    std::fs::create_dir_all(drive.join("C").join("ORACLE")).unwrap();
    name_the_shell(&mut setup.placed, &setup.windows, &setup.upper);

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
    (stop, records_of(&output), made)
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

/// The probe is Windows' shell, as the recorder makes it (`record.mjs`,
/// `setShell`): `SYSTEM.INI`'s `shell=` names it. Program Manager started
/// by a probe reads it, and is not the shell (`progdde`; `PROGMAN.EXE` seg3
/// `0b88`-`0c0a`).
fn name_the_shell(placed: &mut Vec<(String, Vec<u8>)>, windows: &Path, upper: &str) {
    let at = placed
        .iter()
        .position(|(path, _)| path == "WINDOWS\\SYSTEM.INI");
    let text = match at {
        Some(at) => Some(placed[at].1.clone()),
        None => std::fs::read(windows.join("WINDOWS").join("SYSTEM.INI")).ok(),
    };

    if let Some(text) = text {
        let shell = set_shell(&text, &format!("{upper}.EXE"));

        match at {
            Some(at) => placed[at].1 = shell,
            None => placed.push(("WINDOWS\\SYSTEM.INI".to_string(), shell)),
        }
    }
}

/// `SYSTEM.INI` with its first `shell=` line naming a program instead, as
/// `record.mjs`'s `setShell` writes it: the rest of the line, up to its
/// carriage return, replaced.
fn set_shell(text: &[u8], program: &str) -> Vec<u8> {
    let mut at = 0;

    while at < text.len() {
        let end = text[at..]
            .iter()
            .position(|&byte| byte == b'\n')
            .map_or(text.len(), |found| at + found + 1);

        if text[at..end].len() >= 6 && text[at..at + 6].eq_ignore_ascii_case(b"shell=") {
            let stop = text[at..end]
                .iter()
                .position(|&byte| byte == b'\r' || byte == b'\n')
                .map_or(end, |found| at + found);
            let mut out = text[..at].to_vec();

            out.extend_from_slice(b"shell=");
            out.extend_from_slice(program.as_bytes());
            out.extend_from_slice(&text[stop..]);
            return out;
        }

        at = end;
    }

    text.to_vec()
}
