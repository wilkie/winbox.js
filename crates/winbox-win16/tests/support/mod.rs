//! What the tests that run the oracle's probes share: the probes run to
//! their end, how each is set up as the oracle ran it, and its records read
//! back.
#![allow(dead_code)]

pub mod layered;

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use winbox_machine::{FatVolume, HostDrive, HostLayer, IsoVolume, MemoryDrive, Volume};
use winbox_ne::Executable;
use winbox_win16::sys_error_box::BoxHand;
use winbox_win16::{Stop, System};

/// The files a probe that prints finds on its drive.
///
/// * `printing` finds winbox.js's own printer installed in `WIN.INI`: on
///   the VGA, where `vgaprint` recorded with Windows' PostScript driver.
/// * A probe of COMMDLG's print dialogs, recorded on the installation with
///   a printer (`vgaprint`), finds that printer's driver where Setup put it:
///   the dialogs load it by name and ask it for its DEVMODE and what it can
///   do. The probe writes the printer into `WIN.INI` itself (`prdlg.c`).
fn printers(probe: &str, beneath: &Beneath) -> Vec<(String, Vec<u8>)> {
    let mut placed = Vec::new();

    if probe == "printing"
        && let Some(text) = beneath.read("WINDOWS\\WIN.INI")
    {
        placed.push((
            "WINDOWS\\WIN.INI".to_string(),
            winbox_win16::printer::install_printer(&text),
        ));
    }

    let driver = root().join("oracle/build/drive-c-vgaprint/WINDOWS/SYSTEM/PSCRIPT.DRV");

    if [
        "prdlg", "chfontpr", "prdlgx", "pric", "prdoc", "prspool", "prabort", "prdraw", "prlpt",
        "prnote", "prtabs", "prmeta", "prband", "prblt", "prtt",
    ]
    .contains(&probe)
        && let Ok(bytes) = std::fs::read(driver)
    {
        placed.push(("WINDOWS\\SYSTEM\\PSCRIPT.DRV".to_string(), bytes));
    }

    placed
}

/// The folder a probe was built into -- the Win386 probes' own
/// (`build-probes.mjs`, `buildWin386`), or the rest's -- and its program's
/// bytes; `None` where it is not built.
fn built_in(upper: &str) -> Option<(PathBuf, Vec<u8>)> {
    ["oracle/build/win386", "oracle/build/probes"]
        .into_iter()
        .map(|folder| root().join(folder))
        .find_map(|folder| {
            let bytes = std::fs::read(folder.join(format!("{upper}.EXE"))).ok()?;

            Some((folder, bytes))
        })
}

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The folder of the recordings made in 386 enhanced mode, before a
/// fixture's name: `enhanced/dpmiver` is `dpmiver` recorded in that mode
/// (`record.mjs --mode enhanced`), replayed on a machine in it.
pub const ENHANCED: &str = "enhanced/";

/// The mode a fixture was recorded in, by its name, and its name without
/// the mode's folder.
pub fn mode_of(name: &str) -> (winbox_win16::Mode, &str) {
    name.strip_prefix(ENHANCED)
        .map_or((winbox_win16::Mode::Standard, name), |bare| {
            (winbox_win16::Mode::Enhanced, bare)
        })
}

/// A system made as a fixture was recorded: in its mode, and with a
/// coprocessor or without one.
fn system_for(name: &str) -> System {
    let mut system = System::new();

    system.mode = mode_of(name).0;
    system.coprocessor = coprocessor_of(name);
    system
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

/// Whether a fixture was recorded on a machine with a coprocessor, and is
/// replayed on one: not where its source says `coprocessor: false`
/// (`record.mjs`, `WITHOUT_COPROCESSOR`), its floating-point instructions
/// WIN87EM's emulator's.
pub fn coprocessor_of(name: &str) -> bool {
    std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|fixture| fixture["source"]["coprocessor"].as_bool())
        .unwrap_or(true)
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

/// The shell a preset keeps, its `[oracle shell]` section's `shell=`, as
/// `ini-preset.mjs`'s `presetShell` reads it.
pub fn preset_shell(sections: &[(String, Vec<(String, String)>)]) -> Option<&str> {
    sections
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("oracle shell"))
        .flat_map(|(_, keys)| keys)
        .find(|(key, _)| key.eq_ignore_ascii_case("shell"))
        .map(|(_, value)| value.as_str())
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
        if name.to_ascii_lowercase().starts_with("oracle ") {
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
/// them (`record.mjs --shoot ... --then`) and the replay presses them; and
/// where it clicks at a box that takes no key, as the recording clicked
/// (`click=XxY`): MCI's sequencer's warning, its OK at (410, 237)
/// (`oracle/build/screens/sndplay.png`).
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
    ("undefdl", &[&[Step::Key(VK_RETURN)]]),
    (
        "mbseb",
        &[
            &[Step::Key(VK_RETURN)],
            &[Step::Key(VK_RETURN)],
            &[Step::Key(VK_RETURN)],
            &[Step::Key(VK_RETURN)],
            &[Step::Key(VK_RETURN)],
            &[Step::Key(VK_RETURN)],
            &[Step::Key(VK_ESCAPE)],
        ],
    ),
];

pub const VK_TAB: u16 = 0x09;
pub const VK_RETURN: u16 = 0x0d;
pub const VK_ESCAPE: u16 = 0x1b;

// A hand at the box, as the survey has one.
pub use winbox_win16::survey::{Step, hand};

/// A probe run from `C:\`, its records written to `C:\ORACLE`: why it
/// stopped, and its records. `None` where it is not built.
pub fn run(name: &str) -> Option<(Stop, Vec<[String; 3]>)> {
    run_with(name, |system| system.box_hand = Some(box_hand(name)))
}

/// The hand at USER's boxes a whole run of the probe has (`BOX_KEYS`).
pub fn box_hand(name: &str) -> BoxHand {
    let (_, name) = mode_of(name);
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
    // where the whole runs have 30 seconds of the host's, in which it gets
    // that far.
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
    /// Where the program is started from, as DOS names it: the probe's
    /// own `C:\<NAME>.EXE`, unless a run says otherwise.
    pub program: String,
    /// What drive C: has beneath the run's own folder.
    pub beneath: Beneath,
    /// The files put on drive C:, by their paths there, with their bytes.
    pub placed: Vec<(String, Vec<u8>)>,
    /// The installation's files taken off drive C: before the probe
    /// starts, by their paths there: `VER.DLL`, for a run with WinBox's own
    /// alone.
    pub without: Vec<String>,
    /// The program `SYSTEM.INI`'s `shell=` names: the probe, as the
    /// recorder makes it, unless its preset keeps another (`[oracle
    /// shell]`, `pmshell`), which is then what is started.
    pub shell: String,
    /// Started as an install run is: Program Manager first, the shell,
    /// given the program as its command line, which it starts itself
    /// (`progman::start_shell`); the run over once every other task has
    /// ended.
    pub install: bool,
}

/// What drive C: has beneath it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Base {
    /// The oracle's installation of Windows for the display, as the probe
    /// was recorded on.
    Installed,
    /// The base the asset bundle (`oracle/build/assets`, `pnpm assets`)
    /// composes for the display, its modules the store behind it
    /// (`kb/topics/asset-bundle.md`).
    Assets,
    /// That base split into a stack of layers, with a decoy and its
    /// whiteout and files shadowed by the same bytes (`layered`), each
    /// materialised into the host's temporary folder and put together by
    /// `HostDrive::layered`; the bundle's modules the store behind it.
    Layers,
}

impl Base {
    /// What is beneath drive C: on a display: the installation's folder,
    /// or the bundle's base written into the host's temporary folder, or
    /// that base's layers, the bundle's store given to the system. None
    /// for the bundle's where it is not made.
    fn beneath(self, display: &str, system: &mut System) -> Option<Beneath> {
        Some(match self {
            Self::Installed if display == "vga" => {
                Beneath::Folder(root().join("oracle/build/drive-c"))
            }
            Self::Installed => {
                Beneath::Folder(root().join(format!("oracle/build/drive-c-{display}")))
            }
            Self::Assets => {
                let assets = bundle()?;
                let windows = assets
                    .base_in(&std::env::temp_dir().join("winbox-bases"), display)
                    .unwrap_or_else(|error| panic!("the asset bundle's base: {error}"));

                system.assets = Some(assets);
                Beneath::Folder(windows)
            }
            Self::Layers => {
                let assets = bundle()?;
                let stacked = layered::stacked(&assets, display);

                system.assets = Some(assets);
                Beneath::Layers(stacked)
            }
        })
    }

    /// `WINBOX_BASE=assets`, the asset bundle's; `WINBOX_BASE=layers`, it
    /// in layers; else the installation.
    pub fn chosen() -> Self {
        match std::env::var("WINBOX_BASE").as_deref() {
            Ok("assets") => Self::Assets,
            Ok("layers") => Self::Layers,
            _ => Self::Installed,
        }
    }
}

/// What drive C: has beneath the run's own folder.
#[derive(Clone)]
pub enum Beneath {
    /// One folder of the host's: an installation, or the bundle's base.
    Folder(PathBuf),
    /// The bundle's base in layers.
    Layers(std::rc::Rc<layered::Stacked>),
}

impl Beneath {
    /// The layers `HostDrive::layered` puts beneath the run's folder, the
    /// highest first.
    pub fn lowers(&self) -> Vec<HostLayer> {
        match self {
            Self::Folder(folder) if folder.is_dir() => vec![HostLayer::new(folder.clone())],
            Self::Folder(_) => Vec::new(),
            Self::Layers(stacked) => stacked.lowers.clone(),
        }
    }

    /// A file beneath, by its DOS path beneath the drive's root, as the
    /// drive would read it.
    pub fn read(&self, path: &str) -> Option<Vec<u8>> {
        let parts: Vec<String> = path
            .split('\\')
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect();

        HostDrive::layered(PathBuf::new(), self.lowers()).read(&parts)
    }

    /// What is beneath held in memory, each file and folder stamped as
    /// it is: an installation's folder loaded once a thread (`installed`).
    pub fn held(&self) -> MemoryDrive {
        match self {
            Self::Folder(folder) if folder.is_dir() => installed(folder),
            Self::Folder(_) => MemoryDrive::new(),
            Self::Layers(stacked) => stacked.flat.drive(),
        }
    }
}

thread_local! {
    /// The asset bundle, read once a thread; none where it is not made.
    static BUNDLE: std::cell::OnceCell<Option<std::rc::Rc<winbox_win16::assets::Assets>>> =
        const { std::cell::OnceCell::new() };
}

/// The asset bundle `pnpm assets` unpacks into `oracle/build/assets`; none
/// where it is not made.
pub fn bundle() -> Option<std::rc::Rc<winbox_win16::assets::Assets>> {
    BUNDLE.with(|bundle| {
        bundle
            .get_or_init(|| {
                let folder = root().join("oracle/build/assets");

                folder.is_dir().then(|| {
                    std::rc::Rc::new(
                        winbox_win16::assets::Assets::open(&folder)
                            .unwrap_or_else(|error| panic!("the asset bundle: {error}")),
                    )
                })
            })
            .clone()
    })
}

impl Setup {
    /// A probe's run made ready, on the base `WINBOX_BASE` chooses; `None`
    /// where it is not built.
    pub fn of(name: &str) -> Option<Self> {
        let base = Base::chosen();
        let setup = Self::on(name, base);

        assert!(
            base == Base::Installed || bundle().is_some(),
            "WINBOX_BASE={base:?}, and no asset bundle in oracle/build/assets: `pnpm assets`"
        );
        setup
    }

    /// A probe's run made ready on a base; `None` where it is not built,
    /// or the base is the asset bundle's and there is none.
    pub fn on(name: &str, base: Base) -> Option<Self> {
        // A fixture named for a display is its probe run on that display;
        // another, on the display it was recorded on -- the VGA without one.
        // One recorded with the MIDI Mapper's current setup another
        // (`record.mjs --midimap`), named `<probe>-<setup>`, is its probe
        // run with that setup current (`midimap`).
        let midimap = midimap_of(name);
        let ini = ini_of(name);
        let (probe, display) = match (mode_of(name).1.rsplit_once('-'), &midimap) {
            (Some((probe, _)), _) if ini.is_some() => (probe, fixture_display(name)),
            (Some((probe, _)), Some(_)) => (probe, SOUND.to_string()),
            (Some((probe, display)), None)
                if winbox_win16::display::mode(display).is_some() || display == SOUND =>
            {
                (probe, display.to_string())
            }
            _ => (mode_of(name).1, fixture_display(name)),
        };
        // One recorded on the installation with a sound card is run on the
        // VGA's with winbox.js's own sound driver installed.
        let sound = display == SOUND;
        let display = if sound { "vga".to_string() } else { display };
        let upper = probe.to_ascii_uppercase();
        let (built, bytes) = built_in(&upper)?;

        let mut system = system_for(name);

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
            if let Ok(bytes) = std::fs::read(built.join(&brought)) {
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
        // Or, on the asset bundle's base, C: has that beneath it, and the
        // bundle's modules are the store behind it.
        let beneath = base.beneath(&display, &mut system)?;
        let mut bytes = bytes;
        let mut program = format!("C:\\{upper}.EXE");
        let mut shell = format!("{upper}.EXE");
        // A probe recorded with a `WIN.INI` preset (`record.mjs --ini`) finds
        // `WIN.INI` set as it says, and its copies made.
        if let Some(preset) = &ini
            && let Ok(text) =
                std::fs::read_to_string(root().join(format!("oracle/probes/{probe}.{preset}.ini")))
        {
            let sections = parse_preset(&text);
            let on_drive = |path: &str| {
                beneath.read(path.trim_start_matches("C:\\").trim_start_matches("c:\\"))
            };

            for (name, keys) in &sections {
                if !name.eq_ignore_ascii_case("oracle copy") {
                    continue;
                }

                for (to, from) in keys {
                    if let Some(bytes) = on_drive(from) {
                        let to = to.trim_start_matches("C:\\").trim_start_matches("c:\\");

                        placed.push((to.to_string(), bytes));
                    }
                }
            }

            if let Some(text) = beneath.read("WINDOWS\\WIN.INI") {
                placed.push(("WINDOWS\\WIN.INI".to_string(), merge_ini(&text, &sections)));
            }

            // A shell the preset keeps in the probe's place (`pmshell`):
            // started first, it starts the probe as `WIN.INI`'s `run=`
            // names it, from `C:\WINDOWS`, where the recorder puts it.
            if let Some(kept) = preset_shell(&sections) {
                let kept = kept.to_ascii_uppercase();

                placed.push((format!("WINDOWS\\{upper}.EXE"), bytes.clone()));
                bytes = beneath.read(&format!("WINDOWS\\{kept}"))?;
                program = format!("C:\\WINDOWS\\{kept}");
                shell = kept;
            }
        }

        placed.extend(printers(probe, &beneath));

        // A probe recorded with Windows' Sound Blaster and Ad Lib drivers
        // finds winbox.js's own sound driver named in `SYSTEM.INI`'s
        // `[drivers]` in their place, as the card they recorded: the Sound
        // Blaster 1.5's (`[wbsound.drv]`, `card=`), not WinBox's own. And
        // the MIDI Mapper's setups in `MIDIMAP.CFG` naming its devices, the
        // current one the installation's, "Ad Lib", but where the recording made
        // another current (`record.mjs --midimap` writes it in the file).
        if sound && let Some(text) = beneath.read("WINDOWS\\SYSTEM.INI") {
            let profile = winbox_win16::wbsound::Profile::SoundBlaster;

            placed.push((
                "WINDOWS\\SYSTEM.INI".to_string(),
                winbox_win16::wbsound::install_as(&text, profile),
            ));

            if let Some(bytes) = beneath.read("WINDOWS\\SYSTEM\\MIDIMAP.CFG") {
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
            program,
            upper,
            bytes,
            beneath,
            placed,
            without: Vec::new(),
            shell,
            install: false,
        })
    }

    /// The probe loaded and started from where `program` says, `C:\` its
    /// own, the system made ready by `prepare` first.
    fn start(mut self, prepare: impl FnOnce(&mut System)) -> System {
        if self.install {
            winbox_win16::progman::start_shell(&mut self.system, &self.program).unwrap();
        } else {
            let (program, libraries) = self
                .system
                .load(Executable::parse(self.bytes).unwrap(), &self.program);

            self.system.link(program);
            self.system.start(program, libraries, "").unwrap();
        }

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
    let drive = std::env::temp_dir().join(format!(
        "winbox-probe-{}-{}-{run}",
        name.replace('/', "-"),
        std::process::id()
    ));

    std::fs::create_dir_all(drive.join("C").join("ORACLE")).unwrap();
    name_the_shell(&mut setup.placed, &setup.beneath, &setup.shell);

    for (path, bytes) in &setup.placed {
        let to = path
            .split('\\')
            .fold(drive.join("C"), |folder, name| folder.join(name));

        std::fs::create_dir_all(to.parent().unwrap()).unwrap();
        std::fs::write(to, bytes).unwrap();
    }

    let c = HostDrive::layered(drive.join("C"), setup.beneath.lowers());

    std::fs::create_dir_all(drive.join("A")).unwrap();
    std::fs::create_dir_all(drive.join("Z")).unwrap();
    setup
        .system
        .files
        .mount('A', HostDrive::removable(drive.join("A")));
    setup.system.files.mount('C', c);

    for path in &setup.without {
        let mut parts: Vec<String> = path.split('\\').map(str::to_string).collect();
        let name = parts.pop().unwrap_or_default();

        setup.system.files.unlink('C', &parts, &name);
    }
    setup
        .system
        .files
        .mount('Z', HostDrive::new(drive.join("Z")));
    mount_images(&mut setup.system, &setup.upper.to_ascii_lowercase());

    let upper = setup.upper.clone();
    let (stop, made) = go(setup.start(prepare));
    let output = std::fs::read(drive.join("C").join("ORACLE").join(format!("{upper}.OUT")))
        .unwrap_or_default();

    std::fs::remove_dir_all(drive).unwrap();
    (stop, records_of(&output), made)
}
/// An image a probe's recording had mounted beside drive C, as its sidecar
/// names it: its drive, its file in `oracle/probes/images/`, and its kind,
/// `floppy`, `iso` or `hdd`; and the rest of its set, where several images
/// joined by commas are one drive's (`d: imgsw1.iso,imgsw2.iso iso`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mount {
    pub letter: char,
    pub image: String,
    pub kind: String,
    /// Every image of the drive's set, the first `image`.
    pub images: Vec<String>,
}

/// The images a probe's recording had mounted, as
/// `oracle/probes/<probe>.mounts` lists them and `record.mjs` reads them: a
/// line each, as `a:imgflop.img floppy`; `#` starts a comment.
pub fn mounts_of(probe: &str) -> Vec<Mount> {
    let Ok(text) = std::fs::read(root().join(format!("oracle/probes/{probe}.mounts"))) else {
        return Vec::new();
    };

    String::from_utf8_lossy(&text)
        .lines()
        .map(|line| line.split('#').next().unwrap_or("").trim())
        .filter(|line| !line.is_empty())
        .map(|line| {
            let spaced = line.replacen(':', ": ", 1);
            let words: Vec<&str> = spaced.split_whitespace().collect();

            match words[..] {
                [drive, images, kind]
                    if drive.len() == 2
                        && drive.starts_with(|letter: char| letter.is_ascii_alphabetic())
                        && drive.ends_with(':')
                        && ["floppy", "iso", "hdd"]
                            .contains(&kind.to_ascii_lowercase().as_str()) =>
                {
                    let images: Vec<String> = images.split(',').map(str::to_string).collect();

                    Mount {
                        letter: drive.chars().next().unwrap().to_ascii_uppercase(),
                        image: images[0].clone(),
                        kind: kind.to_ascii_lowercase(),
                        images,
                    }
                }
                _ => panic!("{probe}.mounts: cannot read {line:?}"),
            }
        })
        .collect()
}

/// An image as a drive: a FAT image, a floppy's or a hard disk's
/// (`FatVolume`), or a CD image (`IsoVolume`) -- a cue sheet's files found
/// beside it, as `record.mjs` copies them and DOSBox finds them
/// (`GetRealFileName`). A probe whose image is not mounted runs without
/// it, and its records differ.
fn image_volume(kind: &str, bytes: Vec<u8>) -> Option<Box<dyn Volume>> {
    match kind {
        "floppy" | "hdd" => FatVolume::new(bytes, kind == "floppy")
            .ok()
            .map(|volume| Box::new(volume) as Box<dyn Volume>),
        "iso" => IsoVolume::open(Box::new(bytes), &mut |name| {
            std::fs::read(root().join("oracle/probes/images").join(name))
                .ok()
                .map(|bytes| Box::new(bytes) as Box<dyn winbox_machine::Sectors>)
        })
        .ok()
        .map(|volume| Box::new(volume) as Box<dyn Volume>),
        _ => None,
    }
}

/// The disks of a drive's set not in it, by the drive, in the order they
/// come in.
type Sets = Vec<(char, std::collections::VecDeque<Box<dyn Volume>>)>;

thread_local! {
    /// Each drive's set for the run on this thread: what `swap_at_request`
    /// swaps.
    static SETS: RefCell<Sets> = RefCell::default();
}

/// The images a probe's recording had mounted, each mounted where it can
/// be (`image_volume`): a set's first in its drive, the rest kept to be
/// swapped in at the probe's request (`swap_at_request`).
fn mount_images(system: &mut System, probe: &str) {
    let mut sets = Vec::new();

    for mount in mounts_of(probe) {
        let mut volumes = std::collections::VecDeque::new();

        for image in &mount.images {
            let bytes = std::fs::read(root().join("oracle/probes/images").join(image))
                .unwrap_or_else(|error| panic!("{probe}.mounts: {image}: {error}"));

            if let Some(volume) = image_volume(&mount.kind, bytes) {
                volumes.push_back(volume);
            }
        }

        if let Some(first) = volumes.pop_front() {
            system.files.mount_boxed(mount.letter, first);
        }

        if !volumes.is_empty() {
            sets.push((mount.letter, volumes));
        }
    }

    if !sets.is_empty() {
        system.call_watch = Some(swap_at_request);
    }

    SETS.with(|kept| *kept.borrow_mut() = sets);
}

/// The next disk swapped into each drive with a set, as the recorder
/// presses DOSBox's swap key (`record.mjs`'s `runSwapping`): as the probe
/// writes a record of `swap` whose result is `request` -- at its `_lwrite`
/// of it, before the write is made. DOSBox's key puts the next disk in
/// every drive with a set, the last followed by the first
/// (`DriveManager::CycleAllDisks`); the probe waits for the disk, so where
/// the swap comes changes nothing it records.
fn swap_at_request(system: &mut System, module: &'static str, name: &'static str, args: u32) {
    if module != "KERNEL" || name != "_lwrite" {
        return;
    }

    // `_lwrite(hFile, lpBuffer, cbBuffer)`, Pascal: the count pushed last.
    let length = system.cpu.bus.read16(args);
    let buffer = u32::from(system.cpu.bus.read16(args + 2))
        | (u32::from(system.cpu.bus.read16(args + 4)) << 16);
    let record = system.read_far(buffer, usize::from(length));

    if !(record.starts_with(b"swap\t") && record.ends_with(b"\trequest\r\n")) {
        return;
    }

    SETS.with(|sets| {
        for (letter, set) in sets.borrow_mut().iter_mut() {
            if let Some(next) = set.pop_front()
                && let Some(out) = system.files.swap(*letter, next)
            {
                set.push_back(out);
            }
        }
    });
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
    let mut c = setup.beneath.held();

    assert!(c.add_folder("ORACLE", now));

    for (path, bytes) in &setup.placed {
        assert!(c.add_file(path, bytes.clone(), now));
    }

    setup.system.files.mount('A', MemoryDrive::removable());
    setup.system.files.mount('C', c);
    setup.system.files.mount('Z', MemoryDrive::new());
    mount_images(&mut setup.system, &setup.upper.to_ascii_lowercase());

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

/// `run_in_memory` on a drive C: of the run's own, held in memory, and the
/// program `setup` names started from it: what is placed is the run's to
/// put on `c` beforehand. Why it stopped, the records in
/// `C:\ORACLE\<output>.OUT`, and the system as it ended, its drives with
/// it. For a run whose drive is made of layers, or whose program is on it
/// already: an installer run into a layer and the program it installed
/// (`tests/install_layer.rs`).
pub fn run_drive(
    setup: Setup,
    c: MemoryDrive,
    output: &str,
    prepare: impl FnOnce(&mut System),
) -> (Stop, Vec<[String; 3]>, System) {
    let mut system = setup.system;

    system.files.mount('A', MemoryDrive::removable());
    system.files.mount('C', c);
    system.files.mount('Z', MemoryDrive::new());

    let setup = Setup { system, ..setup };
    let engine = winbox_win16::Engine::new(setup.start(prepare));
    let stop = engine.run(2_000_000_000, 300.0);
    let system = engine.into_system();
    let output = system
        .files
        .read_from(
            "C:\\ORACLE",
            &format!("{}.OUT", output.to_ascii_uppercase()),
        )
        .map(|(_, bytes)| bytes)
        .unwrap_or_default();

    (stop, records_of(&output), system)
}

/// The probe is Windows' shell, as the recorder makes it (`record.mjs`,
/// `setShell`): `SYSTEM.INI`'s `shell=` names it. Program Manager started
/// by a probe reads it, and is not the shell (`progdde`; `PROGMAN.EXE` seg3
/// `0b88`-`0c0a`).
fn name_the_shell(placed: &mut Vec<(String, Vec<u8>)>, beneath: &Beneath, shell: &str) {
    let at = placed
        .iter()
        .position(|(path, _)| path == "WINDOWS\\SYSTEM.INI");
    let text = match at {
        Some(at) => Some(placed[at].1.clone()),
        None => beneath.read("WINDOWS\\SYSTEM.INI"),
    };

    if let Some(text) = text {
        let shell = set_shell(&text, shell);

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

/// The asset bundle's modules as the store behind drive C, where a run on
/// the installation has none: for a run with `PROGMAN.EXE` taken off it,
/// WinBox's Program Manager's icons are the bundle's `PROGMAN.EXE`'s, as on
/// the bundle's base (the owner's decision of 2026-10-22,
/// `kb/topics/program-manager-dde.md`). The installation's own files are
/// still read first.
#[allow(dead_code)]
pub fn bundle_store(system: &mut System) {
    if system.assets.is_none() {
        system.assets = bundle();
    }
}

/// Every recording the replay holds, by its fixture's name: the top level
/// of `oracle/fixtures`, standard mode's, and `enhanced/`, 386 enhanced
/// mode's, each sorted. `fabricated/`, `screens/` and the rest are not
/// recordings of a probe's records.
pub fn fixtures() -> Vec<String> {
    let mut names = Vec::new();

    for folder in ["", ENHANCED] {
        let Ok(entries) = std::fs::read_dir(root().join("oracle/fixtures").join(folder)) else {
            continue;
        };
        let mut found: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.path().is_file())
            .filter_map(|entry| {
                let file = entry.file_name().to_string_lossy().into_owned();

                file.strip_suffix(".json")
                    .map(|name| format!("{folder}{name}"))
            })
            .collect();

        found.sort();
        names.extend(found);
    }

    names
}

/// What a whole run wrote for each record Windows wrote, in the
/// recording's order: the run's own occurrence of the record's function
/// and arguments, where the probe writes the same call more than once, else
/// the last it wrote; `None` where it never wrote that call.
pub fn answers<'a>(recorded: &[[String; 3]], records: &'a [[String; 3]]) -> Vec<Option<&'a str>> {
    let mut written: std::collections::HashMap<(&str, &str), Vec<&str>> =
        std::collections::HashMap::new();

    for [function, args, result] in records {
        written
            .entry((function.as_str(), args.as_str()))
            .or_default()
            .push(result.as_str());
    }

    let mut seen: std::collections::HashMap<(&str, &str), usize> = std::collections::HashMap::new();

    recorded
        .iter()
        .map(|[function, args, _]| {
            let key = (function.as_str(), args.as_str());
            let occurrence = seen.entry(key).or_default();
            let at = *occurrence;

            *occurrence += 1;
            written
                .get(&key)
                .and_then(|results| results.get(at).or(results.last()))
                .copied()
        })
        .collect()
}

/// The recordings in 386 enhanced mode whose records `kb/data/conformance.json`
/// carries. The rest are held by the replay as every fixture is, but left out of the report until the
/// knowledge base tells the two modes' records apart: it would count them
/// against pages measured in standard mode (the owner's decision of
/// 2026-11-08, `kb/guides/retire-typescript.md`).
pub const REPORTED_ENHANCED: &[&str] = &[
    "winflags", "dpmiver", "about", "enhmode", "freemem", "dpmildt", "dpmimem", "dpmirm",
    "dpmiexc", "dpmigro", "dpmigrw", "dpminul", "dpmiout", "w386ver", "w386env", "w386dpmi",
    "w386lib", "w386box",
];

/// Functions a module declares but answers with a stub: their records are
/// counted `unimplemented`, not as disagreeing.
pub const STUBBED: &[&str] = &[
    // WinG's halftone brushes: recorded by `wingapi`, their dither not
    // worked out, and `WinGCreateHalftoneBrush` makes none.
    "halftone-brush",
];

/// Fixtures whose probe is not built by `build-probes.mjs`, each with why:
/// their records are counted `unsupported`, and their trials pass with
/// nothing to check. Any other fixture whose probe is not built fails its
/// trial.
pub const UNBUILT: &[(&str, &str)] = &[];

/// A known gap's key for a recording in standard mode alone, where the
/// same probe's recording in enhanced mode agrees: `standard/<probe>:<function>`.
pub const STANDARD: &str = "standard/";

/// The known gap of a fixture's function, where it has one: by the
/// fixture's mode (`enhanced/<probe>:<function>`, or
/// `standard/<probe>:<function>`), its probe and display
/// (`<probe>-<display>:<function>`), its probe, or the function alone, as
/// `standard/<probe>:<function>` for standard mode alone.
pub fn gap_of(enhanced: bool, probe: &str, display: &str, function: &str) -> Option<&'static str> {
    let find = |key: String| {
        KNOWN_GAPS
            .iter()
            .find(|&&(each, _)| each == key)
            .map(|&(_, reason)| reason)
    };
    let mode = if enhanced { ENHANCED } else { STANDARD };

    find(format!("{mode}{probe}:{function}"))
        .or_else(|| find(format!("{probe}-{display}:{function}")))
        .or_else(|| find(format!("{probe}:{function}")))
        .or_else(|| find(function.to_string()))
}

/// Recorded behaviour the Rust engine is known not to reproduce, by
/// `probe:function`, `probe-display:function` for one display of a probe
/// recorded on several, `enhanced/probe:function` for a recording in 386
/// enhanced mode, or `standard/probe:function` for one in standard mode
/// alone; each with what is short. A gap's function that agrees in
/// every record fails its trial, so the list only shrinks. The first part
/// is the gaps of the probes the replay first held, with their reasons; the
/// second, the records that passed with no adapter and the enhanced
/// recordings that were not replayed, named when the Rust replay took them
/// over (the owner's decision of 2026-11-08,
/// `kb/guides/retire-typescript.md`).
pub const KNOWN_GAPS: &[(&str, &str)] = &[
    // `segfree` names each selector by the one before it with the same
    // descriptor. A task's handle is its task database's selector in Windows
    // and a number of WinBox's own here, so three records that name it
    // differ: the first run's database freed (`p1`), the second run's handle
    // (`c2.task`), and its database freed (`b1`). WinBox takes a descriptor
    // for the database in its place, so every other selector around it is
    // given as Windows gives it (`Win16.load`).
    (
        "segfree:between",
        "a task's handle is not its task database's selector: 1 of 8 records",
    ),
    (
        "segfree:child",
        "a task's handle is not its task database's selector: 2 of 26 records",
    ),
    // `popmax`'s pop-up made `WS_CAPTION | WS_MINIMIZE`: `CreateWindow`
    // minimizes it as it does an overlapped one (`USER.EXE` seg8 `0843`-`0861`
    // asks nothing of the kind of window), and its first `WM_SIZE` is the whole
    // window's, as an icon's client area is; winbox.js minimizes only an
    // overlapped window as it is made.
    (
        "popmax:minlog",
        "a pop-up made WS_MINIMIZE is not minimized as it is made",
    ),
    (
        "popmax:minrects",
        "a pop-up made WS_MINIMIZE is not minimized as it is made",
    ),
    // `solodata` reads its module's flags from the header KERNEL keeps in
    // memory, at the module handle's offset 0Ch: 243h, bit 1 set by KERNEL on
    // a program linked with one data segment (`KRNL386.EXE` seg2 `17ee`).
    // winbox.js's database holds the file's header, which reads 201h. What
    // the bit does -- the prologue and the thunk -- agrees.
    (
        "solodata:flags",
        "the module's database holds its file's header, not the bits KERNEL sets in its flags",
    ),
    // DOSBox's C:, where the oracle's Windows ran, is a folder of the host's,
    // whose room is the fixed "512,127,16383,4031" `MOUNT` gives one; its Z:
    // is its own, "512,127,16513,0" (`drive_virtual.cpp`). winbox.js's C:, a
    // FAT16 volume, answers the folder's figures too; it has no Z:. A:, B:
    // and the numbers past Z: agree. And
    // function 1Ch, which winbox.js does not answer: under DOSBox it gives a
    // drive's geometry without the room, and DS:BX a selector of DOSX's own
    // over the media byte, F8h for C: (`diskfree`).
    (
        "diskfree:space",
        "there is no Z: here, DOSBox's own drive, 512,127,16513,0",
    ),
    ("diskfree:allocation", "DOS function 1Ch is not answered"),
    ("diskfree:segment", "DOS function 1Ch is not answered"),
    ("diskfree:media", "DOS function 1Ch is not answered"),
    // GlobalReAlloc growing a block past one allocated after it moves it in
    // Windows, its selector the same; winbox.js gives each selector a 64 KiB
    // place of its own and grows a block where it is. And FS, which no 16-bit
    // code of Windows loads, comes back from the call nought, reaching linear
    // nought, as from a trip to real mode (`segreg`, recorded in standard
    // mode); winbox.js's calls leave FS alone. One record each.
    (
        "segreg:moved",
        "a block grown past the next moves in Windows, its selector kept; winbox.js grows it where it is, one record",
    ),
    (
        "segreg:selector",
        "FS comes back from GlobalReAlloc nought in Windows, as from a trip to real mode; winbox.js leaves it, one record",
    ),
    (
        "segreg:fs",
        "FS comes back from GlobalReAlloc reaching linear nought in Windows; winbox.js leaves it holding the block, one record",
    ),
    // A program's first blocks, asked for without GMEM_ZEROINIT, hold what
    // Windows' memory held before -- in the recording, 3,869 of 4,096 bytes
    // and 7,415 and 6,673 of 8,448 are not nought (`gfresh`). That is the
    // state of the machine Windows ran on, not anything Windows does, and
    // winbox.js's memory starts as nought. Three records.
    (
        "gfresh:fresh",
        "a fresh block holds what Windows' memory held before, leftovers of the machine's earlier use; winbox.js's memory starts as nought, three records",
    ),
    // A block freed is room for the next, as in Windows (`gcycle`'s `cycle`
    // and `after` agree); but how many blocks there is room for at once is
    // Windows' selectors less those its own modules and the shell hold, 7,680
    // of 1 KiB, where winbox.js's own hold fewer and it gives 8,084.
    (
        "gcycle:hold",
        "blocks freed are given again, as in Windows, but how many fit at once follows the selectors Windows' own modules hold, which are not modelled",
    ),
    // A procedure given EnumTaskWindows without `MakeProcInstance`, which
    // USER calls with AX 1 (seg1 `1ad0`): its prologue, patched to three
    // `nop`s, takes the null selector 1 for its data segment. DOSBox, which
    // the recording was made under, lets memory be reached through it and
    // the procedure records nothing; a real processor faults, and winbox.js
    // follows the processor and ends the program (`nullds`). The probe makes
    // these calls last.
    (
        "minis3:tasks",
        "a procedure run with the null selector for its data segment faults here, as a real processor does; DOSBox lets it through",
    ),
    // The same, measured on its own: DOSBox runs the procedure with the null
    // selector for its data segment, four times; a real processor faults on
    // its first read, and winbox.js ends the program there.
    (
        "nullds:answer",
        "a procedure run with the null selector for its data segment faults here, as a real processor does; DOSBox lets it through",
    ),
    // KERNEL's pointer checks answer by touching the memory and catching the
    // fault. DOSBox raises none for the null selector, an offset past a
    // segment's limit, or a write to code, and they answered 0 there; a real
    // processor faults, and winbox.js answers 1, for all 12 (`bad-pointers.ts`).
    (
        "badptr:fault",
        "12 checks answer 1 where a real processor faults on the null selector, a limit or a write to code; DOSBox raises no fault and answered 0",
    ),
    // What RegisterClass answers: 1 for the probe, a program made for Windows
    // 3.0. Windows 3.1 is documented to answer the class's atom, which may be
    // what a program made for 3.1 gets; not changed until that is measured.
    (
        "classinf:register",
        "RegisterClass answers 1 for a program made for 3.0, which is not followed yet",
    ),
    // CreatePolyPolygonRgn of three polygons: GDI hands its builder the count of
    // polygons where the count of points goes (`GDI.EXE` seg24 `02e5`), and
    // what it makes of that is not read out; winbox.js makes their union. One
    // polygon and two, which make no region, agree.
    (
        "regions:polypolygon",
        "three polygons make what GDI's builder makes of a count of three points, not yet read out",
    ),
    // `WM_MEASUREITEM`'s item number for a list box of fixed heights, which
    // USER never sets (`USER.EXE` seg38 `0272`): what was left on its stack --
    // 2567 on the VGA, 2287 on the others -- which nothing can work out. Every
    // other field agrees.
    (
        "listbox:measure",
        "the item number is whatever was left on the stack; every other field agrees",
    ),
    // The combo box's two `WM_MEASUREITEM`s, one for its field and one for
    // its list: USER leaves the field's width and the list's item number unset
    // (`USER.EXE` seg34 `02ac`, seg38 `0278`), so each carries what was on the
    // stack -- 879, and 2567 -- which nothing can work out. Every other field
    // agrees.
    (
        "combobox:measure",
        "the field's width and the list's item number are whatever was left on the stack",
    ),
    // The numbers `RegisterWindowMessage` gives. Everything that relates them
    // agrees -- at least 0xC000, the same for a string in any case, another for
    // another string -- but Windows' first was 0xC40E, after whatever was
    // registered before the probe ran, and its next eight more, which follows
    // from how USER lays out its table. Neither is modelled; these count up
    // from 0xC000 by one.
    (
        "regmsg:register",
        "message numbers count from 0xC000 by one; Windows gave 0xC40E, then eight more",
    ),
    // A task's blocks of global memory are freed as it ends, and a block of
    // `GMEM_DDESHARE` -- the module's whose code allocated it
    // (`KRNL386.EXE` seg1 `0d12`-`0d2a`) -- as the module's last instance ends.
    // winbox.js frees neither: 5 of `ddeleft`'s 12 records, every one taken
    // after a program ended.
    (
        "ddeleft:owned",
        "no global memory is freed as its task or module ends",
    ),
    // An atom deleted once more than it was added: KERNEL looks up the string
    // its freed entry held and answers what was left in AX (seg1 `4a80`),
    // which depends on what the local heap wrote over the freed entry.
    // winbox.js keeps no heap for the atoms, and answers nought: 1 record,
    // where Windows' freed entry still held the string.
    (
        "ddeleft:DdeFreeStringHandle",
        "an atom deleted once too often answers nought",
    ),
    // KERNEL's own notify procedure is `8de2` in KERNEL's first code
    // segment; `LocalNotify` answers it as `LocalInit` left it. WinBox has
    // no such segment, and keeps the offset with the segment nought: 1
    // record of `locinfo`'s.
    (
        "locinfo:notifyseg",
        "KERNEL's notify procedure's segment, its code's, which WinBox has none of",
    ),
    // `winexpe`'s `WinExec` of a Win32 program: Windows starts it as a DOS
    // program, its stub, in a DOS session (WINOLDAP), and answers that
    // instance; WinBox has no DOS sessions and answers `LoadModule`'s 21
    // (1 record).
    (
        "winexpe:exec",
        "Windows starts a file that is no Windows program in a DOS session, which WinBox has not got",
    ),
    // `GetCurrentPDB`'s DX is the word at 220h of KERNEL's data: the prefix
    // DOS made for KERNEL as WIN.COM started it (`KRNL386.EXE` seg3 `0252`).
    // WinBox's KERNEL was started by no DOS and has no prefix (1 record).
    (
        "ktask:kernelpsp",
        "KERNEL's own prefix, which DOS made for it, is not there in WinBox",
    ),
    // USER's and GDI's local heaps, which TOOLHELP walks: WinBox keeps their
    // objects in itself, and their data segments hold no heap (2 records).
    (
        "thheap:lsystem",
        "USER's and GDI's data segments hold no local heap in WinBox",
    ),
    (
        "strfunc:seeuser",
        "UserSeeUserDo works on USER's own data segment, which in WinBox holds no local heap and none of USER's words (as thheap:lsystem)",
    ),
    (
        "userproc:classproc",
        "WinBox registers USER's own classes #32768 to #32772 only on the raster desktop, with procedures of its own that no address of USER's names, and gives the desktop's none",
    ),
    // `ttqmap`'s fonts asked for under `MM_LOMETRIC`: Windows realises a
    // font's height in the device context's units; both engines take it as
    // pixels, so the widths, the pairs' amounts and the outline metrics are
    // a larger font's (`kb/topics/truetype-queries.md`). `GetFontData`
    // agrees.
    (
        "ttqmap:kern",
        "a font's height under a mapping mode is taken as pixels",
    ),
    (
        "ttqmap:abc",
        "a font's height under a mapping mode is taken as pixels",
    ),
    (
        "ttqmap:otm",
        "a font's height under a mapping mode is taken as pixels",
    ),
    // EMSCopy's entry, seg1 `a940`, is past the limit KERNEL leaves its first
    // code segment once started (`KRNL386.EXE` seg1 `b565`-`b573`); DOSBox runs
    // what lies past it, MMSYSTEM's first code segment (`emspast`), and WinBox
    // answers the call as that does. Where the block lies, and its bytes, are
    // the global heap's and the file's.
    (
        "emscopy:entry",
        "WinBox's EMSCopy is an export it answers, within its stubs' segment",
    ),
    (
        "emspast:entry",
        "WinBox's EMSCopy is an export it answers, within its stubs' segment",
    ),
    (
        "emspast:block",
        "WinBox's EMSCopy lies in its stubs' segment, not past KERNEL's code",
    ),
    (
        "emspast:bytes",
        "the bytes past KERNEL's code are MMSYSTEM.DLL's, and WinBox's MMSYSTEM is its own",
    ),
    // `oleitem` calls DELETECLIENTINFO on Item3's window with the second
    // conversation's property: Windows' GetProp no longer finds it, yet its
    // EnumProps still lists it. USER's RemoveProp (seg13 `1057`-`1147`) and
    // EnumProps (seg13 `114a`-`120f`), read out, give no cause; WinBox's
    // lists it no more. One record.
    (
        "oleitem:props",
        "a property DELETECLIENTINFO took away is still listed by Windows' EnumProps",
    ),
    // KERNEL's own prefix, THHOOK's 220h and WinOldApCall(1)'s DX, is each
    // task's prefix's parent in Windows (`kgaps`); WinBox keeps no prefix of
    // KERNEL's, and a task's prefix has no parent.
    ("kgaps:kernelpdb", "WinBox keeps no prefix of KERNEL's own"),
    // DoSignal calls a task's handler with DS its database (`KRNL386.EXE`
    // seg1 `6154`-`6158`); WinBox's task handles are no selectors.
    (
        "kgaps:dosignalds",
        "WinBox's task handles are not selectors of a task database",
    ),
    // GetSetKernelDOSProc's first answer is the INT 21h vector KERNEL found
    // beneath it, a DPMI host's; WinBox has nothing beneath its KERNEL.
    (
        "kgaps:dosprocold",
        "WinBox has no INT 21h vector beneath its KERNEL",
    ),
    // GDISeeGDIDo's 1, 2 and 3 are KERNEL's local heap calls on GDI's data
    // segment; WinBox's GDI segment holds no local heap, as
    // USER's does not for UserSeeUserDo.
    (
        "ugaps:seegdiheap",
        "WinBox's GDI segment holds no local heap",
    ),
    // The PostScript driver names a face it downloads by the global atom it
    // adds for the face's key, which starts with a selector
    // (`PSCRIPT.DRV` seg9 `0ba3`, `170a`): WinBox numbers global atoms from
    // C000h and gives other selectors (`kb/topics/atoms.md`). Every glyph and
    // the document's size agree.
    (
        "prtt:line",
        "the downloaded face's name is a global atom, and its key a selector",
    ),
    // `kb/gdi/enginegetglyphbmp.md`: slanted Wingdings' E9h, a column wider
    // on the left in Windows, one of the 52 (and of `prttrot`'s glyphs).
    (
        "prtteng:EngineGetGlyphBmp",
        "the box of a glyph GDI's engine slants, at one size",
    ),
    (
        "prttrot:EngineGetGlyphBmp",
        "the box of a glyph GDI's engine slants, at one size",
    ),
    // `rledib` stretches a compressed DIB through a bitmap GDI makes of the
    // DIB's size (`GDI.EXE` seg11 `12ca`-`12f9`), whose pixels the stream
    // leaves are as that bitmap's memory was before -- what GDI's heap held
    // there. WinBox's bitmap starts nought.
    (
        "rledib:leftover",
        "the pixels a compressed DIB's stream leaves unset in GDI's own bitmap are what its memory held",
    ),
    (
        "gdidmdrw-vga256:dibget",
        "the driver reads the probe's null translation table, which DOSBox reads as its real-mode vectors",
    ),
    (
        "gdidmdrw-vga256:dibset",
        "the driver matches a DIB of 24 bits through the probe's null translation table, which DOSBox reads as its real-mode vectors",
    ),
    // `prttrot` reads GDI's TrueType scaler's own memory with `TOOLHELP` after
    // each glyph -- the read-out behind `kb/gdi/enginegetglyphbmp.md` -- and
    // WinBox's engine keeps no such memory; its glyphs agree.
    (
        "prttrot:gdi data",
        "GDI's data segment, which the probe finds in the global heap",
    ),
    (
        "prttrot:scaler",
        "where GDI's TrueType scaler keeps its context, which WinBox has not",
    ),
    (
        "prttrot:bytes",
        "GDI's TrueType scaler's own memory, which WinBox has not",
    ),
    (
        "prttrot:element",
        "the scaler's glyph element, which WinBox has not",
    ),
    // `kb/gdi/enginegetglyphbmp.md`: of the glyphs GDI's engine slants,
    // Symbol's corner comes with a fraction across and Wingdings' E9h has its
    // arrowhead's tip rescued a column or a row past WinBox's box; a few
    // others differ by a pixel.
    (
        "prttslt:EngineGetGlyphBmp",
        "the corner and box of a glyph GDI's engine slants",
    ),
    (
        "prttslt:row",
        "a pixel or a column of a glyph GDI's engine slants",
    ),
    // `enhmode` calls DPMI's functions with harmless arguments, in both modes,
    // and WinBox answers each as DOSX or WIN386 does (`kb/topics/
    // dpmi-functions.md`) but for three things that are not DPMI's: 000Dh of
    // one of the table's first sixteen descriptors, which WinBox gives to
    // blocks; DOS's version, through 0300h, 6.00 in WinBox and 5.00 beneath
    // Windows on DOSBox; and the interrupt flag 0902h reads, which WinBox's
    // processor keeps clear for a task and Windows' set.
    (
        "enhmode:dpmi",
        "000Dh's descriptors, DOS's version and the interrupt flag, not DPMI's",
    ),
    // Its `kernel` records: `GetFreeSpace`, which tells every program what
    // `galimit` was told (`kb/topics/global-and-local-memory.md`, "How much
    // there is"). Its code and data segments' limits agree (`dslimit`).
    (
        "enhmode:kernel",
        "GetFreeSpace less the program's own segments",
    ),
    // In enhanced mode, INT 2Fh 1684h gives an entry point for ten of WIN386's
    // devices; WinBox has none of them yet, and answers none for each.
    (
        "enhanced/enhmode:vxd",
        "WIN386's devices' entry points, which WinBox has none of",
    ),
    // The DPMI host's probes (`kb/topics/dpmi-functions.md`, "Not yet
    // done"): what lies outside DPMI -- DOS's version, 6.00 in WinBox and
    // 5.00 beneath Windows on DOSBox; the interrupt flag, which WinBox's
    // processor keeps clear for a task and Windows' set -- and where the
    // hosts keep what WinBox keeps in its own places.
    (
        "dpmildt:specific",
        "000Dh's sixteen descriptors, which WinBox gives to blocks",
    ),
    (
        "enhanced/dpmildt:table",
        "the highest selector 000Bh answers: WinBox's first megabyte's at its table's top",
    ),
    (
        "dpmimem:block",
        "where DOSX's arena puts a block, and WIN386's handles",
    ),
    (
        "dpmimem:interrupts",
        "the interrupt flag, which WinBox's processor keeps clear for a task",
    ),
    (
        "enhanced/dpmimem:page",
        "where WIN386 maps a physical address",
    ),
    (
        "dpmirm:dos",
        "DOS's version, 6.00 in WinBox and 5.00 beneath Windows on DOSBox",
    ),
    (
        "dpmirm:stack",
        "DOS's version, 6.00 in WinBox and 5.00 beneath Windows on DOSBox",
    ),
    (
        "enhanced/dpmirm:vector",
        "the real-mode vectors' values, DOS's and the BIOS's",
    ),
    (
        "dpmiexc:divide",
        "the faulting code's interrupt flag, which WinBox's processor keeps clear",
    ),
    (
        "dpmiexc:protection",
        "the faulting code's interrupt flag, which WinBox's processor keeps clear",
    ),
    (
        "dpmiexc:vector",
        "DOS's version through INT 21h, 6.00 in WinBox and 5.00 on DOSBox",
    ),
    //
    // The records that passed with no adapter, and the recordings in
    // enhanced mode that were not replayed, held by the Rust replay from
    // 2026-11-08: what each differs in, and why where it is
    // known (`kb/guides/retire-typescript.md`, "Not yet done").
    //
    // `adlibout` and `adlibgap` open the Ad Lib's own device, found by its
    // name, "Ad Lib". WinBox's own sound driver stands in for the
    // recording's Sound Blaster and Ad Lib drivers, and its synthesizer is
    // "WinBox MIDI Synthesizer" (as `mididev`'s capabilities), so the probe
    // finds none (`device`: 65535) and writes nothing more.
    // `tests/adlib.rs` runs both with the synthesizer named "Ad Lib", and
    // their writes to the chip agree with DOSBox's, write for write
    // (`kb/topics/adlib.md`).
    (
        "adlibout:device",
        "the probe finds the Ad Lib by its name, which WinBox's own synthesizer does not have",
    ),
    (
        "adlibout:open",
        "the probe finds no Ad Lib by its name, and opens nothing",
    ),
    (
        "adlibout:close",
        "the probe finds no Ad Lib by its name, and closes nothing",
    ),
    (
        "adlibout:capture",
        "the probe finds no Ad Lib by its name, and captures nothing",
    ),
    (
        "adlibout:send",
        "the probe finds no Ad Lib by its name, and sends nothing",
    ),
    (
        "adlibout:at",
        "the probe finds no Ad Lib by its name, and times nothing",
    ),
    (
        "adlibgap:device",
        "the probe finds the Ad Lib by its name, which WinBox's own synthesizer does not have",
    ),
    (
        "adlibgap:open",
        "the probe finds no Ad Lib by its name, and opens nothing",
    ),
    (
        "adlibgap:capture",
        "the probe finds no Ad Lib by its name, and captures nothing",
    ),
    (
        "adlibgap:part",
        "the probe finds no Ad Lib by its name, and times nothing",
    ),
    // The times of the messages sent through the MIDI Mapper, by
    // `timeGetTime`: a millisecond either way of Windows' in 66 of 87
    // records (72 with "Ad Lib general" current), and 115 of `adlibgm`'s
    // 129. `kb/topics/adlib.md` has them agreeing 81 times in 86 with the
    // calls charged as Windows ran them; the millisecond either way is
    // where `TIMER.DRV`'s count ticks over, whose phase against WinBox's
    // clock is not known (inferred).
    (
        "adlibmap:at",
        "a message's time by timeGetTime, a millisecond either way of Windows'",
    ),
    (
        "adlibgm:at",
        "a message's time by timeGetTime, a millisecond either way of Windows'",
    ),
    // MCI's sequencer: opening it took Windows 143 ms, loading
    // `MCISEQ.DRV`, which WinBox does not charge; and after its first play
    // `timeGetTime` went back 28 ms and more, `TIMER.DRV`'s count across
    // the sequencer's `timeBeginPeriod` and `timeEndPeriod`, not read out
    // (`kb/topics/adlib.md`, "Not matched"). 6 of 7 records.
    (
        "adlibseq:at",
        "the sequencer's open is not charged, and TIMER.DRV's count across its periods is not read out",
    ),
    // A play of a MIDI file from 0 to 250 waited for: 500 ms by
    // `timeGetTime` in Windows, 600 here. 1 of 5 records; not yet
    // investigated.
    (
        "seqlen:took",
        "a play to 250 waited for takes 600 ms here and 500 in Windows: not yet investigated",
    ),
    // A play's notification, in tenths of a second: 19 in Windows, 18
    // here, played to its end and resumed to its end. 2 of 6 records; not
    // yet investigated.
    (
        "mciplay:wait",
        "a play's notification comes a tenth of a second early: not yet investigated",
    ),
    // The devices' capabilities are WinBox's own sound driver's -- its
    // manufacturer, products, version and names, "WinBox ..." -- standing
    // in for the recording's Sound Blaster 1.5 and Ad Lib drivers.
    (
        "mididev:caps",
        "the capabilities are WinBox's own sound driver's, its names and numbers",
    ),
    (
        "wavedev:caps",
        "the capabilities are WinBox's own sound driver's, its names and numbers",
    ),
    // `waveOutOpen` of the device while it is open: Windows' Sound
    // Blaster driver answers 4, MMSYSERR_ALLOCATED; WinBox's own driver
    // 11, MMSYSERR_INVALPARAM. 1 of 3 records; not yet investigated.
    (
        "wavedev:open",
        "a device opened again answers 11 here, where Windows' driver answers 4: not yet investigated",
    ),
    // `environ` reads its own environment: DOSBox's `PATH`, `COMSPEC` and
    // `BLASTER` before `windir`, in Windows; WinBox's environment holds
    // `windir` alone, by the owner's decision (2026-11-09): WinBox has no
    // Z: and no COMMAND.COM for them to name. And the program was started from `C:\WINDOWS` by the
    // recorder, from `C:\` here; its prefix's selector is WinBox's.
    (
        "environ:variable",
        "WinBox's environment holds windir alone, not DOSBox's PATH, COMSPEC and BLASTER (the owner's decision, 2026-11-09)",
    ),
    (
        "environ:count",
        "WinBox's environment holds windir alone, so the count's place differs",
    ),
    (
        "environ:module",
        "the recorder started the probe from C:\\WINDOWS, the replay from C:\\",
    ),
    (
        "environ:pdb",
        "the task's prefix is at another selector in WinBox",
    ),
    // `GetFreeSpace`, 1K under Windows': WinBox's machine holds what
    // `galimit` was told as it started, and `freemem`'s own segments are
    // 420h bytes smaller than `galimit`'s (`kb/kernel/getfreespace.md`).
    (
        "freemem:free",
        "GetFreeSpace is 1K under Windows', galimit's figure less freemem's segments",
    ),
    (
        "enhanced/freemem:free",
        "GetFreeSpace is 1K under Windows', galimit's figure less freemem's segments",
    ),
    // `nullds`: as `nullds:answer`, the procedure run with the null
    // selector for its data segment faults here and the program ends, so
    // its last records are not written.
    (
        "nullds:calls",
        "the program ends at the null selector's fault, before it writes this",
    ),
    (
        "nullds:counter",
        "the program ends at the null selector's fault, before it writes this",
    ),
    (
        "nullds:ds",
        "the program ends at the null selector's fault, before it writes this",
    ),
    (
        "nullds:read",
        "the program ends at the null selector's fault, before it writes this",
    ),
    // The TrueType scaler's own memory, read through TOOLHELP's walk of
    // the global heap (`GlobalFirst`, `GlobalNext`, `MemoryRead`): GDI's
    // blocks and the scaler's buffers, which WinBox's engine does not
    // keep, and a global heap of 39 blocks where Windows' had some 230.
    // Instruments, as `prttrot`'s are (`prttrot:bytes`).
    (
        "scalemem:census",
        "the global heap's blocks, which in WinBox are not Windows' own modules'",
    ),
    (
        "scalemem:block",
        "the global heap's blocks, which in WinBox are not Windows' own modules'",
    ),
    (
        "scalemem:bytes",
        "GDI's TrueType scaler's own memory, which WinBox has not",
    ),
    (
        "groundsc:census",
        "the global heap's blocks, which in WinBox are not Windows' own modules'",
    ),
    (
        "groundsc:bytes",
        "GDI's TrueType scaler's own memory, which WinBox has not",
    ),
    (
        "scalepts:census",
        "the global heap's blocks, which in WinBox are not Windows' own modules'",
    ),
    (
        "scalepts:hunt",
        "GDI's TrueType scaler's own memory, which WinBox has not",
    ),
    (
        "scalepts:where",
        "GDI's TrueType scaler's own memory, which WinBox has not",
    ),
    (
        "scalepts:window",
        "GDI's TrueType scaler's own memory, which WinBox has not",
    ),
    // `stack` reads what the scaler left on the probe's stack below where
    // it was called (`kb/topics/synthetic-italic.md`): what lies there is
    // GDI's scaler's working memory, which WinBox's engine does not leave.
    // And in standard mode the stack pointer at the call, 264Eh in
    // Windows and 2C4Eh here, 600h apart, where enhanced mode's agree: not
    // yet investigated.
    (
        "stack:residue",
        "GDI's TrueType scaler's working memory, left on the caller's stack, which WinBox has not",
    ),
    (
        "standard/stack:stack",
        "the stack pointer at the call, 600h above Windows' in standard mode: not yet investigated",
    ),
    // In enhanced mode (`kb/guides/enhanced-mode.md`, "What every probe
    // shows in the other mode", and its "Not yet done").
    (
        "enhanced/kconst:order",
        "the first megabyte's selectors in enhanced mode's order",
    ),
    (
        "enhanced/galimit:alloc",
        "KERNEL's descriptor table growing by 1000h in enhanced mode",
    ),
    (
        "enhanced/galimit:free",
        "KERNEL's descriptor table growing by 1000h in enhanced mode",
    ),
    (
        "enhanced/galimit:largest",
        "KERNEL's descriptor table growing by 1000h in enhanced mode",
    ),
    (
        "enhanced/kmore:dos",
        "where a selector lies in enhanced mode, its number not its meaning",
    ),
    (
        "enhanced/selalias:rights",
        "AllocSelector(0) gives no access rights in enhanced mode",
    ),
    (
        "enhanced/loadenv:env",
        "the environment as the task sees it in enhanced mode",
    ),
    ("enhanced/thtask:timer", "TIMER's count in enhanced mode"),
    (
        "enhanced/sysdrv:timer",
        "CreateSystemTimer's handles start at 30h in enhanced mode, a system timer fewer in use",
    ),
    (
        "enhanced/mmtime:kill",
        "TIMER.DRV's VTDAPI path in enhanced mode answers nought, not 97",
    ),
    (
        "enhanced/mmtime:period",
        "TIMER.DRV's VTDAPI path in enhanced mode answers nought, not 97",
    ),
    (
        "enhanced/kintrnl:winoldap",
        "KERNEL's WinOldAp hooks answer nought and keep no list in enhanced mode",
    ),
    // WIN87EM's own arithmetic records the precision exception, 20h, in its
    // status word, where an `FSQRT` or `FISTP` rounds; WinBox's emulator
    // runs on the processor's unit, which holds doubles and records none.
    (
        "fpemu:word",
        "the precision exception WIN87EM's arithmetic records, the unit not: 1 of 2 records",
    ),
    // `seglim`: DOSBox 0.74 checks no segment's limit in protected mode, an
    // ordinary one's (`up16`) or one that expands down, nor CS's for a
    // fetch. WinBox's processor faults as the Intel 80386 manual has it
    // (`kb/topics/the-processor.md`, "Segment checks in protected mode").
    (
        "seglim:up16",
        "DOSBox reads past a limit, where the 80386 faults: 1 of 4 records",
    ),
    (
        "seglim:down16",
        "DOSBox reads at and below an expand-down segment's limit, and a word across FFFFh, where the 80386 faults",
    ),
    (
        "seglim:down32",
        "DOSBox reads at an expand-down segment's limit, where the 80386 faults",
    ),
    (
        "seglim:fetch",
        "DOSBox runs code past CS's limit, where the 80386 raises #GP(0)",
    ),
    (
        "seglim:stack",
        "DOSBox reads below an expand-down SS's limit, where the 80386 raises #SS",
    ),
];

/// JSON as `JSON.stringify(value, null, indent)` writes it, for a file the
/// Rust tests write: each object's keys
/// in the order `order` gives them, a key it does not name after those in
/// the order of the value's own map, and a newline at the end.
pub fn json_text(value: &serde_json::Value, indent: usize, order: &[&str]) -> String {
    fn write(
        out: &mut String,
        value: &serde_json::Value,
        depth: usize,
        indent: usize,
        order: &[&str],
    ) {
        let pad = |depth: usize| " ".repeat(depth * indent);

        match value {
            serde_json::Value::Array(items) if !items.is_empty() => {
                out.push('[');

                for (at, item) in items.iter().enumerate() {
                    out.push_str(if at == 0 { "\n" } else { ",\n" });
                    out.push_str(&pad(depth + 1));
                    write(out, item, depth + 1, indent, order);
                }

                out.push('\n');
                out.push_str(&pad(depth));
                out.push(']');
            }
            serde_json::Value::Object(map) if !map.is_empty() => {
                let mut keys: Vec<&String> = map.keys().collect();

                keys.sort_by_key(|key| {
                    order
                        .iter()
                        .position(|each| each == key)
                        .unwrap_or(order.len())
                });
                out.push('{');

                for (at, key) in keys.into_iter().enumerate() {
                    out.push_str(if at == 0 { "\n" } else { ",\n" });
                    out.push_str(&pad(depth + 1));
                    out.push_str(&serde_json::to_string(key).unwrap());
                    out.push_str(": ");
                    write(out, &map[key], depth + 1, indent, order);
                }

                out.push('\n');
                out.push_str(&pad(depth));
                out.push('}');
            }
            other => out.push_str(&serde_json::to_string(other).unwrap()),
        }
    }

    let mut out = String::new();

    write(&mut out, value, 0, indent, order);
    out.push('\n');
    out
}
