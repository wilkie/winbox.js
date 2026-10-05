//! A run stepped, a deadline at a time, as a browser's frames step it
//! (`Engine::begin`, `EngineRun::step`), held to a run at once
//! (`Engine::run`): on a virtual clock the two must do the same to the
//! instruction, whatever the deadlines, so every call they make and every
//! pixel they leave on the screen are alike. The host's time is made up
//! here, a millisecond each time it is read, so that a deadline `k` on
//! gives the thread back every `k` slices or so.
//!
//! The oracle's probes are run as `probes.rs` runs them, where they are
//! built (`oracle/build/probes`); and a few of the corpus's programs as the
//! corpus's trace runs them, where they are there (`corpus/programs`).
//! Without either, these pass with nothing to check.

mod support;

use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use winbox_machine::{Clock, HostDrive};
use winbox_ne::Executable;
use winbox_win16::sys_error_box::{BoxHand, BoxInput};
use winbox_win16::{Engine, Pace, Step, Stop, System};

use support::{AGREEING, box_hand, root, run_on};

thread_local! {
    static HOST: Cell<f64> = const { Cell::new(0.0) };
}

/// The host's time as these runs give it: on by a millisecond each time
/// it is read.
fn host() -> f64 {
    HOST.with(|now| {
        let ms = now.get();

        now.set(ms + 1.0);
        ms
    })
}

/// How often the stepped runs give the thread back, in slices: at every
/// slice, and at counts that fall in no pattern with the program's.
const EVERY: [f64; 3] = [1.0, 7.0, 113.0];

/// What a run left: why it stopped, the instructions it ran, each call it
/// made, and its screen.
#[derive(Debug, PartialEq, Eq)]
struct Left {
    stop: Stop,
    instructions: u64,
    calls: Vec<String>,
    screen: (usize, usize, Vec<u32>),
}

impl Left {
    fn of(stop: Stop, mut system: System) -> Self {
        let calls = system
            .log
            .take()
            .unwrap_or_default()
            .iter()
            .map(|call| format!("{call:?}"))
            .collect();

        Self {
            stop,
            instructions: system.instructions,
            calls,
            screen: system.screen_rgb(),
        }
    }
}

/// The system run at once, as `Engine::run` runs it.
fn at_once(mut system: System, budget: u64, seconds: f64) -> Left {
    system.clock.set_host(host);

    let engine = Engine::new(system);
    let stop = engine.run(budget, seconds);

    Left::of(stop, engine.into_system())
}

/// The system run stepped, the thread given back every `every` slices:
/// what it left, and how many times it gave the thread back.
fn stepped(mut system: System, budget: u64, seconds: f64, every: f64) -> (Left, usize) {
    system.clock.set_host(host);

    let engine = Rc::new(Engine::new(system));

    engine.set_pace(Pace::Yielding);

    let mut run = engine.begin(budget, seconds);
    let mut steps = 0;
    let stop = loop {
        let deadline = HOST.with(Cell::get) + every;

        match run.step(deadline) {
            Step::Busy => steps += 1,
            Step::Idle { wake_at } => {
                panic!("a virtual clock waits for no host's time, yet waits until {wake_at}")
            }
            Step::Stopped(stop) => break stop,
        }
    };

    drop(run);

    let engine = Rc::try_unwrap(engine).expect("the engine, let go by its run");

    (Left::of(stop, engine.into_system()), steps)
}

/// The probes whose runs bring up USER's boxes, answered by the hand
/// `probes.rs` gives them: one that faults, and others.
const BOXES: [&str; 3] = ["fault", "minis3", "nullds"];

/// Each probe the Rust engine runs to its end, and those that bring up
/// boxes, run at once and stepped: their records, their calls and their
/// screens alike.
#[test]
fn a_probe_stepped_runs_as_one_run_at_once() {
    for &name in AGREEING.iter().chain(&BOXES) {
        let budget = 2_000_000_000;
        let seconds = 300.0;
        let logged = |system: &mut System| {
            system.log = Some(Vec::new());
            system.box_hand = Some(box_hand(name));
        };
        let Some((_, records, whole)) = run_on(name, logged, |system| {
            let left = at_once(system, budget, seconds);

            (left.stop.clone(), left)
        }) else {
            continue;
        };

        for every in EVERY {
            let (_, stepped_records, (left, steps)) = run_on(name, logged, |system| {
                let stepped = stepped(system, budget, seconds, every);

                (stepped.0.stop.clone(), stepped)
            })
            .unwrap();

            assert!(
                steps > 0 || every > 1.0,
                "{name}: never gave the thread back"
            );
            eprintln!("{name}, every {every}: given back {steps} times");
            assert_eq!(stepped_records, records, "{name}, every {every}");
            assert!(
                left == whole,
                "{name}, every {every}: {}",
                differs(&left, &whole)
            );
        }
    }
}

/// Where two runs' leavings first differ.
fn differs(stepped: &Left, whole: &Left) -> String {
    if stepped.stop != whole.stop {
        return format!("stopped {:?}, not {:?}", stepped.stop, whole.stop);
    }

    if let Some(at) = (0..stepped.calls.len().max(whole.calls.len()))
        .find(|&at| stepped.calls.get(at) != whole.calls.get(at))
    {
        return format!(
            "call {at}: {:?}, not {:?}",
            stepped.calls.get(at),
            whole.calls.get(at)
        );
    }

    if stepped.instructions != whole.instructions {
        return format!(
            "{} instructions, not {}",
            stepped.instructions, whole.instructions
        );
    }

    "the screens differ".to_string()
}

/// The corpus's programs stepped: a game that runs on its own, one that
/// draws at random, one that faults, and others, each as the corpus's
/// trace runs it (`examples/trace.rs`) for three seconds of its clock.
const CORPUS: &[&str] = &["skifree", "tetwin", "trekwar", "invaders", "solwin"];

/// A program of the corpus's made ready as the corpus's trace makes it:
/// its folder on C:, beneath the oracle's Windows, and USER's boxes
/// answered with Enter, up to three of them. `None` where it is not here.
fn corpus_system(id: &str, drive: &Path) -> Option<System> {
    let text = std::fs::read_to_string(root().join("corpus/manifest.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    let program = manifest["programs"]
        .as_array()?
        .iter()
        .find(|program| program["id"] == id)?;
    let run = program["run"].as_str()?;
    let display = program["survey"]["display"].as_str().unwrap_or("vga");
    let folder = root().join("corpus/programs").join(id);
    let bytes = std::fs::read(folder.join(run)).ok()?;
    let windows = if display == "vga" {
        root().join("oracle/build/drive-c")
    } else {
        root().join(format!("oracle/build/drive-c-{display}"))
    };

    if !windows.is_dir() {
        return None;
    }

    let short: String = id.to_ascii_uppercase().chars().take(8).collect();
    let path = format!("C:\\CORPUS\\{short}\\{}", run.to_ascii_uppercase());

    copy_folder(&folder, &drive.join("CORPUS").join(&short));

    let mut system = System::new();

    system.display = winbox_win16::display::mode(display)?;
    system
        .files
        .mount('C', HostDrive::over(drive.to_path_buf(), windows));

    let (program, libraries) = system.load(Executable::parse(bytes).ok()?, &path);

    system.link(program);
    system.start(program, libraries, "").ok()?;
    system.log = Some(Vec::new());
    system.files.set_path(&format!("C:\\CORPUS\\{short}"));

    let mut left = 3;

    system.box_hand = Some(BoxHand(Box::new(move |_: &System, shown: bool| {
        (shown && left > 0).then(|| {
            left -= 1;
            BoxInput::Key(0x0d)
        })
    })));

    Some(system)
}

/// A folder copied, and every folder in it, as the trace copies one.
fn copy_folder(folder: &Path, at: &Path) {
    let _ = std::fs::create_dir_all(at);

    for entry in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        let to = at.join(entry.file_name());

        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            copy_folder(&entry.path(), &to);
        } else {
            let _ = std::fs::copy(entry.path(), to);
        }
    }
}

/// A drive of a run's own, removed when it is let go.
struct Drive(PathBuf);

impl Drive {
    fn new(id: &str, run: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("winbox-stepped-{id}-{run}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);

        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Drive {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Each of the corpus's programs here, run at once and stepped: its calls
/// and its screen alike.
#[test]
fn a_program_stepped_runs_as_one_run_at_once() {
    // Three seconds of the survey's clock, and instructions enough for them.
    let (budget, seconds) = (18_000_000, 3.0);

    for id in CORPUS {
        let drive = Drive::new(id, "whole");
        let Some(system) = corpus_system(id, &drive.0) else {
            continue;
        };
        let whole = at_once(system, budget, seconds);

        drop(drive);

        for every in EVERY {
            let drive = Drive::new(id, &every.to_string());
            let system = corpus_system(id, &drive.0).unwrap();
            let (left, steps) = stepped(system, budget, seconds, every);

            assert!(steps > 0, "{id}: never gave the thread back");
            eprintln!(
                "{id}, every {every}: given back {steps} times, {} calls, {:?}",
                left.calls.len(),
                left.stop
            );
            assert!(
                left == whole,
                "{id}, every {every}: {}",
                differs(&left, &whole)
            );
        }
    }
}

/// Yielding on the host's own clock, a run stepped waits for the host's
/// time when nothing runs, and goes back to its caller to wait: a program
/// that faults, its boxes answered at the host's keyboard, ends as a run at
/// once ends it, with Windows' records.
#[test]
fn a_run_stepped_waits_for_the_hosts_time() {
    use std::collections::VecDeque;

    use winbox_win16::host::{Host, HostSlot};
    use winbox_win16::key_input::Key;

    /// Enter at each of USER's boxes, as `probes.rs`'s host presses it.
    struct EnterAtTheBox(usize);

    impl Host for EnterAtTheBox {
        fn frame(&mut self, system: &mut System) -> bool {
            if self.0 > 0 && system.modal_input.as_ref().is_some_and(VecDeque::is_empty) {
                let enter = Key {
                    code: "Enter".to_string(),
                    key: "Enter".to_string(),
                    repeat: false,
                    alt: false,
                };

                self.0 -= 1;
                system.key_event(true, &enter);
                system.key_event(false, &enter);
            }

            true
        }
    }

    let prepare = |system: &mut System| {
        system.clock = Clock::real();
        system.host = Some(HostSlot::new(Box::new(EnterAtTheBox(2))));
    };
    let Some((stop, records, idles)) = run_on("fault", prepare, |system| {
        let engine = Rc::new(Engine::new(system));

        engine.set_pace(Pace::Yielding);

        let mut run = engine.begin(2_000_000_000, 300.0);
        let mut idles = 0;
        let stop = loop {
            let clock = engine.system().clock.clone();

            match run.step(clock.host_ms() + 4.0) {
                Step::Busy => {}
                Step::Idle { wake_at } => {
                    assert!(wake_at.is_finite());
                    idles += 1;

                    // The page's frame: the host's time let pass.
                    while clock.host_ms() < wake_at {
                        std::hint::spin_loop();
                    }
                }
                Step::Stopped(stop) => break stop,
            }
        };

        (stop.clone(), (stop, idles))
    })
    .map(|(_, records, (stop, idles))| (stop, records, idles)) else {
        return;
    };

    assert_eq!(stop, Stop::Ended);
    assert!(idles > 0, "never waited for the host's time");
    assert_eq!(Some(records), support::recorded("fault"));
}
