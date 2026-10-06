//! The machine driven at random, as a person at the page might: Clock and
//! Notepad side by side, or two Notepads, and the mouse moved, pressed and
//! pressed twice over their captions, system menus, minimize and maximize
//! boxes, icons and the titles under them, with Alt+F4, Escape, Enter and a
//! few other keys between. Each seed is a run of its own, and whatever the
//! run comes to, nothing in it may panic.
//!
//! The host's time is the test's own, as in `sequences.rs`, so that a seed
//! runs the same however fast the host is, and a run that panics can be told
//! again from the events it was handed, and cut down to the fewest that
//! still panic. Two runs cut down so are kept as tests of their own.

use std::cell::{Cell, RefCell};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use winbox_machine::host_seconds;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;
use winbox_win16::windows::Placement;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
    /// Where the last panic was.
    static WHERE: RefCell<String> = const { RefCell::new(String::new()) };
}

/// The installation's files: each with its path on C:, a folder with none.
type Files = [(String, Option<Vec<u8>>)];

type Hook = Box<dyn Fn(&std::panic::PanicHookInfo<'_>) + Sync + Send>;

/// Panics kept quiet, each one's place kept for its message; the hook
/// there was before. `STRESS_TRACE` prints each panic's call stack.
fn quiet() -> Hook {
    let hook = std::panic::take_hook();

    std::panic::set_hook(Box::new(|info| {
        let at = info
            .location()
            .map(|at| format!("{}:{}", at.file(), at.line()))
            .unwrap_or_default();

        if std::env::var("STRESS_TRACE").is_ok() {
            eprintln!("{at}\n{}", std::backtrace::Backtrace::force_capture());
        }

        WHERE.with(|place| *place.borrow_mut() = at);
    }));
    hook
}

/// The host's time: on by a hundredth of a millisecond each time it is
/// read.
fn host_ms() -> f64 {
    NOW.with(|now| {
        now.set(now.get() + 0.01);
        now.get()
    })
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A host's folder read for drive C: at `dos`, every file in it, and its
/// folders' too, in the order of their names.
fn installation(folder: &Path, dos: &str, files: &mut Vec<(String, Option<Vec<u8>>)>) {
    let mut entries: Vec<_> = std::fs::read_dir(folder).unwrap().flatten().collect();

    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if path.is_dir() {
            files.push((named.clone(), None));
            installation(&path, &named, files);
        } else {
            files.push((named, Some(std::fs::read(&path).unwrap())));
        }
    }
}

/// The installation read once, or none where the oracle's build is not
/// here.
fn files() -> Option<Vec<(String, Option<Vec<u8>>)>> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/CLOCK.EXE").is_file()
        || !windows.join("WINDOWS/NOTEPAD.EXE").is_file()
    {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

    let mut files = Vec::new();

    installation(&windows, "", &mut files);
    Some(files)
}

/// One thing the page hands in, as it was handed.
#[derive(Debug, Clone, Copy)]
enum Event {
    /// The mouse: moved (0), pressed (1) or let go (2) at a point, with the
    /// buttons held after it; and whether a press is a double click's
    /// second.
    Pointer(u8, i16, i16, u8, bool),
    /// A key, down or up, with whether Alt is held.
    Key(bool, &'static str, &'static str, bool),
    /// A program started beside the rest.
    Start(&'static str),
    /// So many of the page's frames.
    Frames(u8),
}

impl Event {
    /// The event handed in; for frames, what the last came to.
    fn hand(self, session: &mut Session) -> State {
        match self {
            Event::Pointer(kind, x, y, buttons, double) => {
                session.pointer(pointer_of(kind, x, y, 0, buttons, double));
                State::Busy
            }
            Event::Key(down, code, name, alt) => {
                session.key(
                    down,
                    &Key {
                        code: code.to_string(),
                        key: name.to_string(),
                        repeat: false,
                        alt,
                    },
                );
                State::Busy
            }
            Event::Start(path) => {
                let _ = session.start(path);
                State::Busy
            }
            Event::Frames(count) => {
                let mut state = State::Busy;

                for frame in 0..count {
                    let slice = [4.0, 16.0, 12.0][usize::from(frame) % 3];

                    state = session.step(host_ms() + slice);

                    // The frame's slice gone by, and the time a run waits
                    // for, as the page's next frame comes when it is due.
                    NOW.with(|now| now.set(now.get() + slice));

                    if state == State::Idle {
                        let wake = session.wake_at();

                        NOW.with(|now| now.set(now.get().max(wake)));
                    }

                    session.take_calls(false);
                    session.take_exits();
                    session.take_sound();

                    if state == State::Stopped {
                        break;
                    }
                }

                state
            }
        }
    }
}

/// A seeded generator: xorshift.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    /// A place from `low` up to `high`, on the screen.
    fn between(&mut self, low: i32, high: i32, most: i32) -> i16 {
        let at = if high <= low {
            low
        } else {
            low + self.below((high - low) as u64) as i32
        };

        at.clamp(0, most - 1) as i16
    }
}

/// A fresh machine, Windows staying up, the installation on C:.
fn machine(files: &Files) -> Session {
    NOW.with(|now| now.set(0.0));

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: host_ms,
        wall: || 0,
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();

    for (path, data) in files {
        match data {
            Some(data) => assert!(session.add_file('C', path, data.clone(), host_seconds())),
            None => assert!(session.add_folder('C', path, host_seconds())),
        }
    }

    session
}

const CLOCK: &str = "C:\\WINDOWS\\CLOCK.EXE";
const NOTEPAD: &str = "C:\\WINDOWS\\NOTEPAD.EXE";

/// A point on one of a window's parts, chosen at random: an icon and the
/// title under it, or a window's system menu box, minimize box, maximize
/// box, caption, menu bar and the rest of it; or, `anywhere`, now and then
/// a point anywhere on the screen.
fn spot(random: &mut Random, window: (i32, i32, i32, i32, bool), anywhere: bool) -> (i16, i16) {
    let (left, top, width, height, icon) = window;
    let right = left + width;
    let middle = left + width / 2;
    let [x0, x1, y0, y1] = match (icon, random.below(if anywhere { 7 } else { 6 })) {
        (_, 6) => [0, 640, 0, 480],
        (true, 0..=2) => [middle - 20, middle + 20, top + height, top + height + 14],
        (false, 0) => [left + 4, left + 22, top + 4, top + 22],
        (false, 1) => [right - 44, right - 24, top + 4, top + 22],
        (false, 2) => [right - 23, right - 4, top + 4, top + 22],
        (false, 3) => [left + 24, right - 44, top + 4, top + 22],
        (false, 4) => [left, left + 120, top + 22, top + 140],
        _ => [left, right, top, top + height],
    };

    (random.between(x0, x1, 640), random.between(y0, y1, 480))
}

/// The next events, chosen at random over the windows at the top as they
/// show now, a few frames after them.
fn choose(session: &Session, random: &mut Random, programs: &[&'static str]) -> Vec<Event> {
    let shown: Vec<(i32, i32, i32, i32, bool)> = {
        let system = session.system();

        system
            .top_level()
            .into_iter()
            .filter_map(|index| system.windows[index].as_ref())
            .filter(|window| window.visible)
            .map(|window| {
                (
                    window.left,
                    window.top,
                    window.width,
                    window.height,
                    window.placement == Placement::Minimized,
                )
            })
            .collect()
    };
    let mut events = Vec::new();
    let roll = random.below(100);

    if shown.is_empty() || roll < 2 {
        events.push(Event::Start(
            programs[random.below(programs.len() as u64) as usize],
        ));
    } else if roll < 80 {
        let window = shown[random.below(shown.len() as u64) as usize];
        let (x, y) = spot(random, window, roll >= 72);

        events.push(Event::Pointer(0, x, y, 0, false));

        // Pressed twice, pressed and held a while, pressed once, or only
        // moved over.
        match random.below(4) {
            0 => events.extend([
                Event::Pointer(1, x, y, 1, false),
                Event::Pointer(2, x, y, 0, false),
                Event::Frames(1),
                Event::Pointer(1, x, y, 1, true),
                Event::Pointer(2, x, y, 0, false),
            ]),
            1 => events.extend([
                Event::Pointer(1, x, y, 1, false),
                Event::Frames(random.below(3) as u8),
                Event::Pointer(2, x, y, 0, false),
            ]),
            2 => events.extend([
                Event::Pointer(1, x, y, 1, false),
                Event::Pointer(2, x, y, 0, false),
            ]),
            _ => {}
        }
    } else {
        let keys: [(&str, &str, bool); 12] = [
            ("F4", "F4", true),
            ("F4", "F4", true),
            ("Escape", "Escape", false),
            ("Enter", "Enter", false),
            ("Space", " ", true),
            ("ArrowDown", "ArrowDown", false),
            ("ArrowUp", "ArrowUp", false),
            ("KeyN", "n", false),
            ("KeyR", "r", false),
            ("KeyC", "c", false),
            ("Tab", "Tab", true),
            ("Escape", "Escape", true),
        ];
        let (code, name, alt) = keys[random.below(keys.len() as u64) as usize];

        if alt {
            events.push(Event::Key(true, "AltLeft", "Alt", true));
        }

        events.push(Event::Key(true, code, name, alt));
        events.push(Event::Key(false, code, name, alt));

        if alt {
            events.push(Event::Key(false, "AltLeft", "Alt", false));
        }
    }

    events.push(Event::Frames(1 + random.below(6) as u8));
    events
}

/// How a run ended: the events it was handed, the panic if it came to one,
/// and why it stopped if it did.
struct Run {
    events: Vec<Event>,
    panic: Option<String>,
    stop: Option<String>,
}

/// A panic's message, and where it was.
fn message(payload: &Box<dyn std::any::Any + Send>) -> String {
    let at = WHERE.with(|place| place.borrow().clone());
    let text = payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_string())
        })
        .unwrap_or_default();

    format!("{text} at {at}")
}

/// Events handed in on a fresh machine, each kept as it goes, until the run
/// stops or `next` has none left: how the run ended.
fn drive(files: &Files, mut next: impl FnMut(&Session) -> Option<Vec<Event>>) -> Run {
    let mut events = Vec::new();
    let mut session = machine(files);
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        while let Some(more) = next(&session) {
            for event in more {
                // Kept before it is handed in, so that the one a panic
                // comes in is told again with the rest.
                events.push(event);

                if event.hand(&mut session) == State::Stopped {
                    return;
                }
            }
        }
    }));
    let panic = outcome.err().map(|payload| message(&payload));
    let stop = if panic.is_none() {
        session.stop().map(|stop| format!("{stop:?}"))
    } else {
        None
    };

    Run {
        events,
        panic,
        stop,
    }
}

/// A seed's run: Clock and Notepad for an even seed, two Notepads for an
/// odd one, started; then `actions` chosen at random.
fn run(files: &Files, seed: u64, actions: usize) -> Run {
    let programs: &[&'static str] = if seed.is_multiple_of(2) {
        &[CLOCK, NOTEPAD]
    } else {
        &[NOTEPAD, NOTEPAD]
    };
    let mut random = Random(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let mut left = actions + 1;

    drive(files, |session| {
        left -= 1;

        if left == actions {
            let mut start: Vec<Event> = programs.iter().map(|&path| Event::Start(path)).collect();

            start.push(Event::Frames(250));
            return Some(start);
        }

        (left > 0).then(|| choose(session, &mut random, programs))
    })
}

/// Events told again on a fresh machine: the panic they come to, or else
/// why the run stopped, if it did.
fn replay(files: &Files, events: &[Event]) -> Option<String> {
    let mut all = Some(events.to_vec());
    let ran = drive(files, |_| all.take());

    ran.panic
        .or_else(|| ran.stop.map(|stop| format!("stopped, {stop}")))
}

/// The fewest events, a run of them taken away at a time, that still come
/// to the same end.
fn shrink(files: &Files, events: Vec<Event>, end: &str) -> Vec<Event> {
    let mut events = events;
    let mut chunk = events.len() / 2;

    while chunk >= 1 {
        let mut at = 0;

        while at < events.len() {
            let mut fewer = events.clone();

            fewer.drain(at..(at + chunk).min(events.len()));

            if replay(files, &fewer).as_deref() == Some(end) {
                events = fewer;
            } else {
                at += chunk;
            }
        }

        chunk /= 2;
    }

    events
}

/// Seeds `from..to`, run on as many threads as the host has: each that
/// panicked or stopped.
fn seeds(files: &Files, from: u64, to: u64, actions: usize) -> Vec<(u64, Run)> {
    let threads = std::thread::available_parallelism().map_or(4, usize::from);
    let next = AtomicU64::new(from);
    let ended = Mutex::new(Vec::new());

    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let seed = next.fetch_add(1, Ordering::Relaxed);

                    if seed >= to {
                        return;
                    }

                    let ran = run(files, seed, actions);

                    if ran.panic.is_some() || ran.stop.is_some() {
                        ended.lock().unwrap().push((seed, ran));
                    }
                }
            });
        }
    });

    let mut ended = ended.into_inner().unwrap();

    ended.sort_by_key(|(seed, _)| *seed);
    ended
}

/// The windows at the top whose title is `title`: whether each is active,
/// and whether it is an icon.
fn tops(session: &Session, title: &str) -> Vec<(bool, bool)> {
    let system = session.system();

    system
        .top_level()
        .into_iter()
        .filter_map(|index| system.windows[index].as_ref())
        .filter(|window| window.title == title && window.title_of.is_none())
        .map(|window| (window.active, window.placement == Placement::Minimized))
        .collect()
}

/// Whether an icon's title is active, or one is named by an icon though it
/// was destroyed.
fn titles_astray(session: &Session) -> bool {
    let system = session.system();

    system.windows.iter().flatten().any(|window| {
        (window.title_of.is_some() && window.active)
            || window
                .icon_title
                .is_some_and(|title| system.windows[title].is_none())
    })
}

/// Clock's icon's title pressed, with Notepad active, then Alt+F4, then
/// the icon pressed twice: the fewest of a random run's events that
/// panicked, cut down from seed 0's. The press made the title the active
/// window, as a press makes any window it lands on; Alt+F4 went to it, and
/// `DefWindowProc` destroyed it, its icon still naming it; and the icon,
/// restored, found its title destroyed (`a window not destroyed`). USER's
/// own procedure for an icon's title answers the mouse as a caption and
/// sends the press to the icon, and answers `WM_CLOSE` with nought
/// (`USER.EXE` seg1 `6ca0`; `def_window.rs`).
#[test]
fn an_icons_title_pressed_then_alt_f4_then_the_icon_restored() {
    let Some(files) = files() else {
        return;
    };
    let mut session = machine(&files);

    for event in [
        Event::Start(CLOCK),
        Event::Start(NOTEPAD),
        Event::Frames(250),
        // Clock's minimize box.
        Event::Pointer(1, 167, 14, 1, false),
        Event::Frames(1),
    ] {
        event.hand(&mut session);
    }

    assert_eq!(tops(&session, "Clock - 1/1"), [(true, true)]);

    // Its icon's title, then Alt+F4 as the page gives it after a press of
    // Alt it did not see.
    for event in [
        Event::Pointer(1, 45, 450, 1, false),
        Event::Key(true, "F4", "F4", true),
        Event::Frames(1),
    ] {
        event.hand(&mut session);
    }

    assert!(!titles_astray(&session));
    assert_eq!(tops(&session, "Clock - 1/1"), [(true, true)]);

    // The icon pressed twice: Clock restored.
    for event in [Event::Pointer(1, 31, 431, 1, true), Event::Frames(1)] {
        event.hand(&mut session);
    }

    assert_eq!(session.stop(), None);
    assert!(!titles_astray(&session));
    assert_eq!(tops(&session, "Clock"), [(true, false)]);
}

/// An icon's title pressed twice, as its icon would be: the window
/// restored, the title gone with the icon (`USER.EXE` seg1 `6dc2`).
#[test]
fn an_icons_title_pressed_twice_restores_its_window() {
    let Some(files) = files() else {
        return;
    };
    let mut session = machine(&files);

    for event in [
        Event::Start(CLOCK),
        Event::Start(NOTEPAD),
        Event::Frames(250),
        // Clock's minimize box, pressed and let go.
        Event::Pointer(1, 167, 14, 1, false),
        Event::Pointer(2, 167, 14, 0, false),
        Event::Frames(4),
    ] {
        event.hand(&mut session);
    }

    let title = {
        let system = session.system();

        system
            .windows
            .iter()
            .flatten()
            .find(|window| window.title_of.is_some())
            .map(|window| {
                (
                    window.left + window.width / 2,
                    window.top + window.height / 2,
                )
            })
    };
    let Some((x, y)) = title else {
        panic!("no icon's title: {:?}", tops(&session, "Clock - 1/1"));
    };
    let (x, y) = (x as i16, y as i16);

    for event in [
        Event::Pointer(1, x, y, 1, false),
        Event::Pointer(2, x, y, 0, false),
        Event::Frames(1),
        Event::Pointer(1, x, y, 1, true),
        Event::Pointer(2, x, y, 0, false),
        Event::Frames(4),
    ] {
        event.hand(&mut session);
    }

    assert_eq!(session.stop(), None);
    assert!(!titles_astray(&session));
    assert_eq!(tops(&session, "Clock"), [(true, false)]);
    assert!(
        !session
            .system()
            .windows
            .iter()
            .flatten()
            .any(|window| window.title_of.is_some())
    );
}

/// Two Notepads, one minimized with its Save As box up, and that one
/// ended: the fewest of a random run's events that panicked, cut down from
/// seed 286's once icons' titles answered the mouse as USER's do. The task
/// ended with the focus on a window it had destroyed, the next window's
/// activation still to send its messages, and taking its last windows away
/// looked for the focus inside them (`a window not destroyed`).
#[test]
fn a_task_ending_with_the_focus_on_a_window_it_destroyed() {
    let Some(files) = files() else {
        return;
    };
    let events = [
        Event::Start(CLOCK),
        Event::Start(NOTEPAD),
        Event::Frames(250),
        Event::Pointer(1, 622, 41, 1, false),
        Event::Start(NOTEPAD),
        Event::Frames(2),
        Event::Pointer(1, 618, 48, 1, false),
        Event::Frames(3),
        Event::Key(true, "KeyC", "c", false),
        Event::Pointer(1, 616, 6, 1, false),
        Event::Frames(5),
        Event::Pointer(1, 36, 445, 1, false),
        Event::Frames(1),
        Event::Pointer(2, 36, 445, 0, false),
        Event::Pointer(2, 48, 441, 0, false),
        Event::Frames(5),
        Event::Key(true, "Enter", "Enter", false),
        Event::Frames(1),
        Event::Pointer(1, 626, 14, 1, false),
        Event::Frames(3),
        Event::Pointer(1, 30, 444, 1, false),
        Event::Pointer(2, 30, 444, 0, false),
        Event::Pointer(1, 561, 342, 1, false),
        Event::Pointer(2, 561, 342, 0, false),
        Event::Frames(3),
        Event::Pointer(1, 228, 397, 1, false),
        Event::Pointer(1, 215, 461, 1, false),
        Event::Pointer(1, 545, 241, 1, true),
        Event::Frames(3),
        Event::Key(true, "KeyN", "n", false),
        Event::Key(true, "Enter", "Enter", false),
        Event::Frames(4),
    ];
    let hook = quiet();
    let end = replay(&files, &events);

    std::panic::set_hook(hook);
    assert_eq!(end, None);
}

/// Fifty seeds of sixty choices each: none panics. A run may stop where
/// the engine says it cannot go on (`Stop::Unsupported`): those are told.
#[test]
fn random_clicks_over_clock_and_notepads_never_panic() {
    let Some(files) = files() else {
        return;
    };
    let hook = quiet();
    let ended = seeds(&files, 0, 50, 60);

    std::panic::set_hook(hook);

    for (seed, ran) in &ended {
        if let Some(stop) = &ran.stop {
            eprintln!("seed {seed} stopped: {stop}");
        }
    }

    let panics: Vec<String> = ended
        .iter()
        .filter_map(|(seed, ran)| {
            ran.panic
                .as_ref()
                .map(|panic| format!("seed {seed}: {panic}"))
        })
        .collect();

    assert!(panics.is_empty(), "{panics:#?}");
}

/// Many more seeds, each kind of end cut down to the fewest events that
/// still come to it, and printed: `STRESS_SEEDS=from..to` (0..400),
/// `STRESS_ACTIONS=n` (120). Runs that stop count as well as those that
/// panic.
#[test]
#[ignore = "hundreds of seeds; run by hand"]
fn random_clicks_many_seeds_cut_down() {
    let Some(files) = files() else {
        return;
    };
    let range = std::env::var("STRESS_SEEDS").unwrap_or_else(|_| "0..400".to_string());
    let (from, to) = range.split_once("..").unwrap();
    let actions = std::env::var("STRESS_ACTIONS")
        .ok()
        .and_then(|actions| actions.parse().ok())
        .unwrap_or(120);
    let hook = quiet();
    let ended = seeds(&files, from.parse().unwrap(), to.parse().unwrap(), actions);
    let mut kinds: Vec<String> = Vec::new();

    for (seed, ran) in &ended {
        let end = ran
            .panic
            .clone()
            .or_else(|| ran.stop.as_ref().map(|stop| format!("stopped, {stop}")))
            .unwrap();

        eprintln!("seed {seed}: {end} after {} events", ran.events.len());

        if kinds.contains(&end) {
            continue;
        }

        kinds.push(end.clone());

        let fewest = shrink(&files, ran.events.clone(), &end);

        eprintln!("seed {seed} cut down to {} events:", fewest.len());

        for event in &fewest {
            eprintln!("  {event:?}");
        }
    }

    std::panic::set_hook(hook);
    assert!(
        ended.is_empty(),
        "{} seeds panicked or stopped",
        ended.len()
    );
}

/// Notepad started with a letter typed, and its Save As box brought up from
/// the File menu with Alt+F and A.
fn save_as(files: &Files) -> Session {
    let mut session = machine(files);

    for event in [
        Event::Start(NOTEPAD),
        Event::Frames(250),
        Event::Key(true, "KeyN", "n", false),
        Event::Key(false, "KeyN", "n", false),
        Event::Frames(4),
        Event::Key(true, "AltLeft", "Alt", true),
        Event::Key(true, "KeyF", "f", true),
        Event::Key(false, "KeyF", "f", true),
        Event::Key(false, "AltLeft", "Alt", false),
        Event::Frames(4),
        Event::Key(true, "KeyA", "a", false),
        Event::Key(false, "KeyA", "a", false),
        Event::Frames(40),
    ] {
        event.hand(&mut session);
    }

    session
}

/// The first window shown whose title or class is `named`: its place and
/// size, whether it is active, and its placement.
fn shown(session: &Session, named: &str) -> Option<(i32, i32, i32, i32, bool, Placement)> {
    let system = session.system();

    system
        .windows
        .iter()
        .flatten()
        .find(|window| window.visible && (window.title == named || window.class == named))
        .map(|window| {
            (
                window.left,
                window.top,
                window.width,
                window.height,
                window.active,
                window.placement,
            )
        })
}

/// The classes of the windows that are active.
fn active_classes(session: &Session) -> Vec<String> {
    let system = session.system();

    system
        .windows
        .iter()
        .flatten()
        .filter(|window| window.active)
        .map(|window| window.class.clone())
        .collect()
}

/// Notepad's Save As box's caption pressed twice: it stays as it is. A
/// random run maximized it, though it has no maximize box: `DefWindowProc`
/// took any double click on a caption for `SC_MAXIMIZE`. USER sends
/// `SC_MAXIMIZE` only for a window with a maximize box, `SC_RESTORE` for
/// one maximized or an icon, and nothing for any other (`USER.EXE` seg1
/// `0221`-`0238`; `capdbl`).
#[test]
fn the_save_as_boxs_caption_pressed_twice_stays_as_it_is() {
    let Some(files) = files() else {
        return;
    };
    let mut session = save_as(&files);
    let before = shown(&session, "Save As").expect("the Save As box");
    let (x, y) = ((before.0 + 60) as i16, (before.1 + 10) as i16);

    for event in [
        Event::Pointer(0, x, y, 0, false),
        Event::Pointer(1, x, y, 1, false),
        Event::Pointer(2, x, y, 0, false),
        Event::Frames(1),
        Event::Pointer(1, x, y, 1, true),
        Event::Pointer(2, x, y, 0, false),
        Event::Frames(10),
    ] {
        event.hand(&mut session);
    }

    assert_eq!(session.stop(), None);
    assert_eq!(shown(&session, "Save As"), Some(before));
}

/// The Save As box's list of file types dropped down with its button, and
/// a row of it pressed: the box stays the active window, and the list goes
/// away when the button is let go. A random run made the list the active
/// window: the press made any window at the top it landed on active. The
/// list is a child of the desktop window, which a press never makes active,
/// and its press gives the focus to the combo box (`USER.EXE` seg1 `2998`,
/// seg35 `133d`; `comboact`).
#[test]
fn a_combo_boxs_list_pressed_is_never_the_active_window() {
    let Some(files) = files() else {
        return;
    };
    let mut session = save_as(&files);
    let combo = {
        let system = session.system();

        system
            .windows
            .iter()
            .flatten()
            .find(|window| window.visible && window.class.eq_ignore_ascii_case("combobox"))
            .map(|window| (window.left, window.top, window.width, window.height))
    };
    let (left, top, width, height) = combo.expect("a combo box");
    let (x, y) = ((left + width - 6) as i16, (top + height / 2) as i16);

    for event in [
        Event::Pointer(0, x, y, 0, false),
        Event::Pointer(1, x, y, 1, false),
        Event::Pointer(2, x, y, 0, false),
        Event::Frames(10),
    ] {
        event.hand(&mut session);
    }

    let (left, top, width, _, active, _) = shown(&session, "ComboLBox").expect("the list dropped");

    assert!(!active);

    let (x, y) = ((left + width / 2) as i16, (top + 20) as i16);

    for event in [
        Event::Pointer(0, x, y, 0, false),
        Event::Pointer(1, x, y, 1, false),
        Event::Frames(3),
    ] {
        event.hand(&mut session);
    }

    assert_eq!(active_classes(&session), ["#32770"]);

    for event in [Event::Pointer(2, x, y, 0, false), Event::Frames(10)] {
        event.hand(&mut session);
    }

    assert_eq!(session.stop(), None);
    assert_eq!(shown(&session, "ComboLBox"), None);
    assert_eq!(active_classes(&session), ["#32770"]);
}
