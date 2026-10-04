//! The oracle's probes run on the Rust engine, their records held to what
//! Windows 3.1 recorded (`oracle/fixtures`). The probes are built into
//! `oracle/build/probes`, which a checkout does not have until they are
//! built; without them these pass with nothing to check.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::sys_error_box::{BoxHand, BoxInput};
use winbox_win16::{Stop, System};

/// The probes the Rust engine runs to their end, agreeing with Windows.
const AGREEING: &[&str] = &[
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
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A probe's records as Windows wrote them: function, arguments, result.
fn recorded(name: &str) -> Option<Vec<[String; 3]>> {
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
fn records_of(text: &[u8]) -> Vec<[String; 3]> {
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
fn fixture_display(name: &str) -> String {
    std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|fixture| fixture["display"].as_str().map(str::to_string))
        .unwrap_or_else(|| "vga".to_string())
}

/// The keys a whole run presses when a box of USER's own that lets no
/// program run comes up, one list for each box, as the recording pressed
/// them (`record.mjs --shoot ... --then`) and the TypeScript engine's
/// replay presses them.
const BOX_KEYS: &[(&str, &[&[u16]])] = &[
    ("fault", &[&[VK_RETURN], &[VK_RETURN]]),
    ("minis3", &[&[VK_RETURN], &[VK_RETURN]]),
    ("nullds", &[&[VK_RETURN], &[VK_RETURN]]),
];

const VK_TAB: u16 = 0x09;
const VK_RETURN: u16 = 0x0d;

/// A step of a hand at the box: a key pressed and released, or the screen
/// taken.
#[derive(Debug, Clone, Copy)]
enum Step {
    Key(u16),
    Shoot,
}

/// A hand that, as each box comes up, takes the screen and then does the
/// next list of steps in turn; the screens taken, as `shoot` makes of them.
fn hand<T: 'static>(
    boxes: Vec<Vec<Step>>,
    shoot: impl Fn(&System) -> T + 'static,
) -> (BoxHand, Rc<RefCell<Vec<T>>>) {
    let shots = Rc::new(RefCell::new(Vec::new()));
    let taken = Rc::clone(&shots);
    let mut boxes: VecDeque<Vec<Step>> = boxes.into();
    let mut steps = VecDeque::new();

    let hand = BoxHand(Box::new(move |system: &System, shown: bool| {
        if shown {
            steps = boxes.pop_front().unwrap_or_default().into();
            taken.borrow_mut().push(shoot(system));
        }

        loop {
            match steps.pop_front()? {
                Step::Key(key) => return Some(BoxInput::Key(key)),
                Step::Shoot => taken.borrow_mut().push(shoot(system)),
            }
        }
    }));

    (hand, shots)
}

/// A probe run from `C:\`, its records written to `C:\ORACLE`: why it
/// stopped, and its records. `None` where it is not built.
fn run(name: &str) -> Option<(Stop, Vec<[String; 3]>)> {
    let probe = name.rsplit_once('-').map_or(name, |(probe, _)| probe);
    let boxes = BOX_KEYS
        .iter()
        .find(|&&(each, _)| each == probe)
        .map(|&(_, boxes)| {
            boxes
                .iter()
                .map(|keys| keys.iter().map(|&key| Step::Key(key)).collect())
                .collect()
        })
        .unwrap_or_default();

    run_with(name, |system| system.box_hand = Some(hand(boxes, |_| ()).0))
}

/// `run`, the system made ready by `prepare` before the probe starts.
fn run_with(name: &str, prepare: impl FnOnce(&mut System)) -> Option<(Stop, Vec<[String; 3]>)> {
    // A fixture named for a display is its probe run on that display;
    // another, on the display it was recorded on -- the VGA without one.
    let (probe, display) = match name.rsplit_once('-') {
        Some((probe, display)) if winbox_win16::display::mode(display).is_some() => {
            (probe, display.to_string())
        }
        _ => (name, fixture_display(name)),
    };
    let upper = probe.to_ascii_uppercase();
    let bytes = std::fs::read(root().join(format!("oracle/build/probes/{upper}.EXE"))).ok()?;
    let drive = std::env::temp_dir().join(format!("winbox-probe-{name}-{}", std::process::id()));

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

    // As long as the heaviest probes take to end -- the outline faces' run
    // to 470 million instructions, some 160 seconds on the virtual clock --
    // where the TypeScript engine's whole runs have 30 seconds of the
    // host's, in which it gets that far.
    let stop = winbox_win16::Engine::new(system).run(2_000_000_000, 300.0);
    let output = std::fs::read(drive.join("C").join("ORACLE").join(format!("{upper}.OUT")))
        .unwrap_or_default();

    std::fs::remove_dir_all(drive).unwrap();
    Some((stop, records_of(&output)))
}

#[test]
fn probes_agree_with_windows() {
    for name in AGREEING {
        let Some((stop, records)) = run(name) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert_eq!(Some(records), recorded(name), "{name}");
    }
}

/// How many records of each probe the TypeScript engine agrees with
/// Windows on, from the knowledge base's conformance data.
fn typescript_agreed() -> std::collections::HashMap<String, u64> {
    let text = std::fs::read_to_string(root().join("kb/data/conformance.json")).unwrap_or_default();
    let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let mut agreed = std::collections::HashMap::new();

    if let Some(probes) = data.as_object() {
        for (name, probe) in probes {
            let count = probe["functions"].as_object().map_or(0, |functions| {
                functions
                    .values()
                    .filter_map(|f| f["agreed"].as_u64())
                    .sum()
            });

            agreed.insert(name.clone(), count);
        }
    }

    agreed
}

/// Every probe built, run, and how far each got, against the TypeScript
/// engine's agreement with Windows: `cargo test -p winbox-win16 --test
/// probes -- --ignored --nocapture`.
#[test]
#[ignore = "a survey, not a check"]
fn survey() {
    let typescript = typescript_agreed();
    let mut level = Vec::new();
    let mut behind = Vec::new();
    let mut ahead = Vec::new();
    let mut stops = std::collections::BTreeMap::<String, Vec<String>>::new();

    for entry in std::fs::read_dir(root().join("oracle/fixtures"))
        .unwrap()
        .flatten()
    {
        let file = entry.file_name().to_string_lossy().into_owned();
        let Some(name) = file.strip_suffix(".json") else {
            continue;
        };
        let Some(recorded) = recorded(name) else {
            continue;
        };
        let Some((stop, records)) = run(name) else {
            continue;
        };
        // As a whole run is replayed: each record's result found by its
        // function and arguments, the last written.
        let written: std::collections::HashMap<(&str, &str), &str> = records
            .iter()
            .map(|[function, args, result]| ((function.as_str(), args.as_str()), result.as_str()))
            .collect();
        let agreed = recorded
            .iter()
            .filter(|[function, args, result]| {
                written.get(&(function.as_str(), args.as_str())) == Some(&result.as_str())
            })
            .count() as u64;
        let theirs = typescript.get(name).copied().unwrap_or(0);

        if stop != Stop::Ended {
            stops
                .entry(format!("{stop:?}"))
                .or_default()
                .push(name.to_string());
        }

        match agreed.cmp(&theirs) {
            std::cmp::Ordering::Less if stop == Stop::Ended => {
                behind.push(format!("{name} {agreed}/{theirs}"));
            }
            std::cmp::Ordering::Less => {}
            std::cmp::Ordering::Equal => level.push(name.to_string()),
            std::cmp::Ordering::Greater => ahead.push(format!("{name} {agreed}/{theirs}")),
        }
    }

    let mut ranked: Vec<_> = stops.into_iter().collect();

    ranked.sort_by_key(|(_, names)| std::cmp::Reverse(names.len()));

    for (stop, names) in ranked {
        println!("{:4} {stop}: {}", names.len(), names.join(" "));
    }

    println!("ended behind the TypeScript engine: {}", behind.join(", "));
    println!("ahead of it: {}", ahead.join(", "));
    println!("level with it: {} -- {}", level.len(), level.join(" "));
}

/// The sixteen colours, and the letter each is written as
/// (`screen-rows.mjs`).
const COLOURS: [(char, [u8; 3]); 16] = [
    ('#', [0, 0, 0]),
    ('m', [170, 0, 0]),
    ('d', [0, 170, 0]),
    ('y', [170, 170, 0]),
    ('n', [0, 0, 170]),
    ('p', [170, 0, 170]),
    ('t', [0, 170, 170]),
    ('s', [192, 192, 192]),
    ('g', [128, 128, 128]),
    ('r', [255, 0, 0]),
    ('l', [0, 255, 0]),
    ('Y', [255, 255, 0]),
    ('b', [0, 0, 255]),
    ('P', [255, 0, 255]),
    ('c', [0, 255, 255]),
    ('.', [255, 255, 255]),
];

fn letter_of(colour: [u8; 3]) -> char {
    let distance = |other: [u8; 3]| -> i32 {
        (0..3)
            .map(|at| (i32::from(other[at]) - i32::from(colour[at])).pow(2))
            .sum()
    };

    COLOURS
        .iter()
        .min_by_key(|&&(_, each)| distance(each))
        .map_or('#', |&(letter, _)| letter)
}

/// Windows' rows, run-length encoded, spelled out.
fn expand(row: &str) -> String {
    let mut out = String::new();
    let mut chars = row.chars().peekable();

    while let Some(letter) = chars.next() {
        let mut count = String::new();

        while let Some(digit) = chars.next_if(char::is_ascii_digit) {
            count.push(digit);
        }

        let times = if count.is_empty() {
            1
        } else {
            count.parse().unwrap()
        };

        out.extend(std::iter::repeat_n(letter, times));
    }

    out
}

/// Whether a point is in a rectangle, where there is one.
fn within(area: Option<[i32; 4]>, x: i32, y: i32) -> bool {
    area.is_some_and(|[l, t, r, b]| x >= l && x < r && y >= t && y < b)
}

fn rect_of(value: &serde_json::Value) -> Option<[i32; 4]> {
    let at = |index: usize| value.get(index)?.as_i64().map(|n| n as i32);

    Some([at(0)?, at(1)?, at(2)?, at(3)?])
}

/// A box's screen taken under DOSBox (`oracle/fixtures/screens/fault.json`),
/// as rows of letters, its mask blanked.
fn recorded_shot(screens: &serde_json::Value, name: &str) -> Vec<String> {
    let shot = &screens["shots"][name];
    let [left, top, _, _] = rect_of(&screens["box"]).unwrap();
    let mask = rect_of(&shot["mask"]);

    shot["rows"]
        .as_array()
        .unwrap()
        .iter()
        .zip(top..)
        .map(|(row, y)| {
            expand(row.as_str().unwrap())
                .chars()
                .zip(left..)
                .map(|(letter, x)| if within(mask, x, y) { '?' } else { letter })
                .collect()
        })
        .collect()
}

/// The box's rectangle of the screen as it is now, as rows of letters.
fn shot_of(system: &System, area: [i32; 4]) -> Vec<String> {
    let screen = system.screen.as_ref().expect("a screen");
    let palette = screen.device_palette.borrow();

    (area[1]..area[3])
        .map(|y| {
            (area[0]..area[2])
                .map(|x| {
                    let index = screen.index_at(x, y).unwrap_or(0);

                    letter_of(palette.colours[usize::from(index)])
                })
                .collect()
        })
        .collect()
}

/// A shot taken here, with a mask blanked as the recording's is.
fn masked(rows: &[String], area: [i32; 4], mask: Option<[i32; 4]>) -> Vec<String> {
    rows.iter()
        .zip(area[1]..)
        .map(|(row, y)| {
            row.chars()
                .zip(area[0]..)
                .map(|(letter, x)| if within(mask, x, y) { '?' } else { letter })
                .collect()
        })
        .collect()
}

/// A program that faults, run whole: the `fault` probe starts one that
/// loads a selector that does not exist, and KERNEL's boxes come up. They
/// were recorded as the screen itself, taken under DOSBox, and answered
/// with the keys a person would press; here the same keys are pressed, the
/// screen is taken at the same moments, and the box is compared pixel for
/// pixel, each as the nearest of the sixteen colours.
#[test]
fn a_program_that_faults() {
    let Ok(text) = std::fs::read_to_string(root().join("oracle/fixtures/screens/fault.json"))
    else {
        return;
    };
    let screens: serde_json::Value = serde_json::from_str(&text).unwrap();
    let area = rect_of(&screens["box"]).unwrap();
    let first_mask = rect_of(&screens["shots"]["first"]["mask"]);

    // Enter, Enter: the first box closed, then Application Error.
    let (made, shots) = hand(
        vec![vec![Step::Key(VK_RETURN)], vec![Step::Key(VK_RETURN)]],
        move |system| shot_of(system, area),
    );
    let Some((stop, records)) = run_with("fault", |system| system.box_hand = Some(made)) else {
        return;
    };

    {
        let shots = shots.borrow();

        assert_eq!(stop, Stop::Ended);
        assert_eq!(shots.len(), 2);
        assert_eq!(
            masked(&shots[0], area, first_mask),
            recorded_shot(&screens, "first")
        );
        assert_eq!(shots[1], recorded_shot(&screens, "second"));
        assert_eq!(Some(records), recorded("fault"));
    }

    // Tab, Enter: Ignore, and the program goes on.
    let (made, shots) = hand(
        vec![vec![Step::Key(VK_TAB), Step::Shoot, Step::Key(VK_RETURN)]],
        move |system| shot_of(system, area),
    );
    let (_, records) = run_with("fault", |system| system.box_hand = Some(made)).unwrap();
    let shots = shots.borrow();
    let field = |record: &serde_json::Value, key: &str| record[key].as_str().unwrap().to_string();
    let wanted: Vec<[String; 3]> = screens["runs"]["Tab, Enter"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| {
            [
                field(record, "function"),
                field(record, "args"),
                field(record, "result"),
            ]
        })
        .collect();

    assert_eq!(shots.len(), 2);
    assert_eq!(shots[1], recorded_shot(&screens, "first, after Tab"));
    assert_eq!(records, wanted);
}
