//! What the tests that run the oracle's probes share: the probes run to
//! their end, how each is set up as the oracle ran it, and its records read
//! back.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;
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
    "btnmore",
    "sndplay-vgasound",
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

/// `run_with`, the system made ready run by `go`: why it stopped, and what
/// else `go` makes of it; and the probe's records.
pub fn run_on<T>(
    name: &str,
    prepare: impl FnOnce(&mut System),
    go: impl FnOnce(System) -> (Stop, T),
) -> Option<(Stop, Vec<[String; 3]>, T)> {
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
    // A drive of the run's own: tests running at once may run one probe.
    let run = RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let drive =
        std::env::temp_dir().join(format!("winbox-probe-{name}-{}-{run}", std::process::id()));

    let mut system = System::new();
    let display = match winbox_win16::display::mode(&display) {
        Some(mode) => {
            system.display = mode;
            display
        }
        None => "vga".to_string(),
    };

    std::fs::create_dir_all(drive.join("C").join("ORACLE")).unwrap();
    // The probe on the drive, where the oracle ran it from.
    std::fs::write(drive.join("C").join(format!("{upper}.EXE")), &bytes).unwrap();
    // And what it brings, where the recorder puts it: beside Windows
    // (`build-probes.mjs`) -- its library, and the program it starts.
    for brought in [format!("{upper}D.DLL"), format!("{upper}C.EXE")] {
        if let Ok(bytes) = std::fs::read(root().join("oracle/build/probes").join(&brought)) {
            std::fs::create_dir_all(drive.join("C").join("WINDOWS")).unwrap();
            std::fs::write(drive.join("C").join("WINDOWS").join(brought), bytes).unwrap();
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
        std::fs::create_dir_all(drive.join("C").join("WINDOWS")).unwrap();
        std::fs::write(
            drive.join("C").join("WINDOWS").join("WIN.INI"),
            winbox_win16::printer::install_printer(&text),
        )
        .unwrap();
    }

    // A probe recorded with Windows' Sound Blaster and Ad Lib drivers finds
    // winbox.js's own sound driver named in `SYSTEM.INI`'s `[drivers]` in
    // their place.
    if sound && let Ok(text) = std::fs::read(windows.join("WINDOWS").join("SYSTEM.INI")) {
        std::fs::create_dir_all(drive.join("C").join("WINDOWS")).unwrap();
        std::fs::write(
            drive.join("C").join("WINDOWS").join("SYSTEM.INI"),
            winbox_win16::wbsound::install(&text),
        )
        .unwrap();
    }

    let c = if windows.is_dir() {
        HostDrive::over(drive.join("C"), windows)
    } else {
        HostDrive::new(drive.join("C"))
    };

    std::fs::create_dir_all(drive.join("A")).unwrap();
    std::fs::create_dir_all(drive.join("Z")).unwrap();
    system
        .files
        .mount('A', HostDrive::removable(drive.join("A")));
    system.files.mount('C', c);
    system.files.mount('Z', HostDrive::new(drive.join("Z")));

    let (program, libraries) = system.load(
        Executable::parse(bytes).unwrap(),
        &format!("C:\\{upper}.EXE"),
    );

    system.link(program);
    system.start(program, libraries, "").unwrap();
    prepare(&mut system);

    let (stop, made) = go(system);
    let output = std::fs::read(drive.join("C").join("ORACLE").join(format!("{upper}.OUT")))
        .unwrap_or_default();

    std::fs::remove_dir_all(drive).unwrap();
    Some((stop, records_of(&output), made))
}
