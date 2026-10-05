//! Several programs on the one machine, as the page runs them: the first
//! started, then others started beside it while the run goes on, as
//! Program Manager starts them (`Session::launch`). Each runs, makes its
//! windows and is logged; a second instance of a program is given the
//! first as its previous one, as `WinExec` gives it (`winexec`); each that
//! ends is told; and the run goes on until the last has ended.
//!
//! The programs are the `winexec` probe's own child, `WINEXECC.EXE`, which
//! writes what `WinMain` was given to `C:\ORACLE\CHILD.TXT`, and the
//! installation's Clock, where the oracle's build is here.

use std::path::{Path, PathBuf};

use winbox_machine::{host_seconds, instant_ms, segment_selector};
use winbox_web::session::{Made, Session, State};
use winbox_win16::key_input::Key;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A host's folder put on drive C: at `dos`, every file in it, and its
/// folders' too.
fn hold(session: &mut Session, folder: &Path, dos: &str) {
    for entry in std::fs::read_dir(folder).unwrap().flatten() {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if path.is_dir() {
            assert!(session.add_folder('C', &named, host_seconds()));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), host_seconds()));
        }
    }
}

/// A key as the page gives it.
fn key(code: &str, key: &str, alt: bool) -> Key {
    Key {
        code: code.to_string(),
        key: key.to_string(),
        repeat: false,
        alt,
    }
}

/// Alt+F4, as the page's keyboard gives it: to the active window.
fn alt_f4(session: &Session) {
    session.key(true, &key("AltLeft", "Alt", true));
    session.key(true, &key("F4", "F4", true));
    session.key(false, &key("F4", "F4", true));
    session.key(false, &key("AltLeft", "Alt", false));
}

/// The run stepped until `done` says so, or the run stops, or ten seconds
/// of the host's pass; the calls taken meanwhile kept in `calls`. What the
/// last step came to.
fn step_until(
    session: &mut Session,
    calls: &mut String,
    mut done: impl FnMut(&mut Session) -> bool,
) -> State {
    let deadline = instant_ms() + 10_000.0;

    loop {
        let state = session.step(instant_ms() + 10.0);

        calls.push_str(&session.take_calls(false));

        if state == State::Stopped || done(session) || instant_ms() > deadline {
            return state;
        }
    }
}

/// What the children have written.
fn child_log(session: &Session) -> String {
    session
        .system()
        .files
        .read_from("C:\\ORACLE", "CHILD.TXT")
        .map(|(_, bytes)| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// How many windows of USER's the tree has under a name.
fn named(session: &Session, name: &str) -> usize {
    session
        .accessible_tree()
        .matches(&format!("\"name\":\"{name}\""))
        .count()
}

/// The previous instance a task was given, by its handle.
fn previous_of(session: &Session, handle: u16) -> Option<u16> {
    let system = session.system();
    let slot = system.slot_of(handle)?;

    if system.scheduler.current == Some(slot) {
        return system.task.as_ref().map(|task| task.previous);
    }

    system.scheduler.slots[slot]
        .saved
        .as_ref()
        .and_then(|saved| saved.task.as_ref())
        .map(|task| task.previous)
}

/// The modules whose code the calls logged were made from: each by its
/// place among the modules, and its path.
fn callers(session: &Session, calls: &str) -> Vec<String> {
    let system = session.system();
    let mut names: Vec<String> = calls
        .lines()
        .filter_map(|line| {
            let at = line.rsplit_once(" @")?.1;
            let selector = u16::from_str_radix(at.split(':').next()?, 16).ok()?;

            system
                .modules
                .iter()
                .enumerate()
                .find(|(_, module)| {
                    module
                        .segments
                        .iter()
                        .any(|&segment| segment_selector(segment) == selector)
                })
                .map(|(index, module)| format!("{index} {}", module.path))
        })
        .collect();

    names.sort();
    names.dedup();
    names
}

#[test]
fn programs_started_beside_one_another_run_until_the_last_ends() {
    let probes = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !probes.join("WINEXECC.EXE").is_file() || !windows.join("WINDOWS/CLOCK.EXE").is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return;
    }

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: instant_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap();

    hold(&mut session, &windows, "");
    assert!(session.add_folder('C', "ORACLE", host_seconds()));
    assert!(session.add_file(
        'C',
        "ORACLE\\WINEXECC.EXE",
        std::fs::read(probes.join("WINEXECC.EXE")).unwrap(),
        host_seconds()
    ));

    let child = "C:\\ORACLE\\WINEXECC.EXE";
    let clock = "C:\\WINDOWS\\CLOCK.EXE";
    let mut calls = String::new();

    // Not yet started, nothing is launched beside it.
    assert!(session.launch(child).is_err());

    // The first, as before: its window made, and its first message taken.
    session.start(child).unwrap();
    step_until(&mut session, &mut calls, |session| {
        child_log(session).lines().count() >= 3
    });

    let first = {
        let system = session.system();

        system.scheduler.slots[0].handle
    };

    // Another program, beside it.
    let clock_task = session.launch(clock).unwrap();

    assert_ne!(clock_task, first);
    step_until(&mut session, &mut calls, |session| {
        named(session, "Clock") > 0
    });
    assert_eq!(named(&session, "Clock"), 1);
    assert_eq!(previous_of(&session, clock_task), Some(0));

    // The first program again, by `start` as the page asks: a second
    // instance, given the first as its previous one.
    session.start(child).unwrap();

    let second = session.system().scheduler.slots.last().unwrap().handle;

    assert_eq!(previous_of(&session, second), Some(first));
    step_until(&mut session, &mut calls, |session| {
        child_log(session).lines().count() >= 6 && named(session, "Child") == 2
    });

    assert_eq!(named(&session, "Child"), 2);
    assert_eq!(named(&session, "Clock"), 1);
    assert_eq!(session.system().task_count(), 3);

    // Each logged: its calls made from its own code.
    let from = callers(&session, &calls);

    assert!(from.iter().any(|name| name.ends_with(clock)), "{from:?}");
    assert_eq!(
        from.iter().filter(|name| name.ends_with(child)).count(),
        2,
        "{from:?}"
    );

    // Each closed in turn from the keyboard: each that ends with others
    // left is told, and the run goes on until the last has ended.
    let mut exits = Vec::new();
    let mut state = State::Busy;

    for left in (0..3).rev() {
        alt_f4(&session);
        state = step_until(&mut session, &mut calls, |session| {
            left > 0 && session.system().task_count() == left
        });
        exits.extend(session.take_exits());
    }

    assert_eq!(state, State::Stopped, "{}", session.accessible_tree());
    assert_eq!(
        session.stop(),
        Some(&winbox_win16::Stop::Ended),
        "{exits:?}"
    );
    assert_eq!(exits, [0, 0]);
    assert_eq!(session.exit_code(), Some(0));
    assert!(session.launch(child).is_err());

    // The children's lines, as `winexec` recorded them under Windows, each
    // given what Program Manager gives a program: no arguments, shown
    // normally.
    assert_eq!(
        child_log(&session),
        "winmain cmd=[] show=1 previous=no\r\nwindow\r\nfirst message\r\n\
         winmain cmd=[] show=1 previous=yes\r\nwindow\r\nfirst message\r\n\
         exit\r\nexit\r\n"
    );
}
