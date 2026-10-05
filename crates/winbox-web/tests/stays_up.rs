//! Windows staying up once the last program has ended, as the page keeps
//! it (`Session::stay_up`), as the TypeScript engine's `Win16` stays: the
//! last program ends as the others do, its windows taken away, its code
//! told -- 255 for one that faulted -- and the next runs on the same
//! machine. And each program in a directory of its own, as KERNEL keeps one
//! in each task's database (`curdir`).
//!
//! The programs are the oracle's own: `winexec`'s child, `WINEXECC.EXE`,
//! which writes what `WinMain` was given to `C:\ORACLE\CHILD.TXT`;
//! `fault`'s, `FAULTC.EXE`, which faults when it is told `WM_USER`; and
//! `curdir`'s, `CURDIRC.EXE`, which writes its directory to
//! `C:\ORACLE\CURDIR.TXT` as it starts, changes to `C:\ORACLE\CB`, and for
//! each `WM_USER`.

use std::path::{Path, PathBuf};

use winbox_machine::{host_seconds, instant_ms};
use winbox_web::session::{Made, Session, State};
use winbox_win16::key_input::Key;

const WM_CLOSE: u16 = 0x0010;
const WM_USER: u16 = 0x0400;

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

/// A machine as the page makes one, Windows staying up, the installation
/// on C: and the probes' programs named put in `C:\ORACLE`; none where the
/// oracle's build is not here.
fn machine(programs: &[&str]) -> Option<Session> {
    let probes = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM/USER.EXE").is_file()
        || programs.iter().any(|name| !probes.join(name).is_file())
    {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: instant_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();
    hold(&mut session, &windows, "");
    session.add_folder('C', "ORACLE", host_seconds());

    for name in programs {
        assert!(session.add_file(
            'C',
            &format!("ORACLE\\{name}"),
            std::fs::read(probes.join(name)).unwrap(),
            host_seconds()
        ));
    }

    Some(session)
}

/// The run stepped until `done` says so, or the run stops or waits for a
/// program, or ten seconds of the host's pass. What the last step came to.
fn step_until(session: &mut Session, mut done: impl FnMut(&mut Session) -> bool) -> State {
    let deadline = instant_ms() + 10_000.0;

    loop {
        let state = session.step(instant_ms() + 10.0);

        session.take_calls(false);

        if matches!(state, State::Stopped | State::Waiting)
            || done(session)
            || instant_ms() > deadline
        {
            return state;
        }
    }
}

/// A file on C:, as the programs have left it.
fn file(session: &Session, folder: &str, name: &str) -> String {
    session
        .system()
        .files
        .read_from(folder, name)
        .map(|(_, bytes)| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// A window at the top, by its title, of those USER has.
fn window(session: &Session, title: &str) -> Option<u16> {
    let system = session.system();

    system
        .top_level()
        .into_iter()
        .filter_map(|index| system.windows[index].as_ref())
        .find(|window| window.title == title)
        .map(|window| window.hwnd)
}

/// A key pressed and let go, as the page's keyboard gives it.
fn press(session: &Session, code: &str) {
    let key = Key {
        code: code.to_string(),
        key: code.to_string(),
        repeat: false,
        alt: false,
    };

    session.key(true, &key);
    session.key(false, &key);
}

#[test]
fn the_last_program_ends_as_the_others_do_and_the_next_runs_on_the_same_machine() {
    let Some(mut session) = machine(&["WINEXECC.EXE"]) else {
        return;
    };
    let child = "C:\\ORACLE\\WINEXECC.EXE";

    // Before any program, the machine waits for one.
    assert_eq!(session.step(instant_ms() + 10.0), State::Waiting);

    session.start(child).unwrap();
    step_until(&mut session, |session| window(session, "Child").is_some());

    let shown = window(&session, "Child").expect("the program's window");

    // Closed, as its window's close is asked for: it ends, the last, and
    // its window is taken away; the machine waits for the next.
    session.system().post_message(shown, WM_CLOSE, 0, 0);

    let state = step_until(&mut session, |_| false);

    assert_eq!(state, State::Waiting);
    assert_eq!(session.stop(), None);
    assert_eq!(session.take_exits(), [0]);
    assert_eq!(window(&session, "Child"), None);
    assert!(
        !session.accessible_tree().contains("\"name\":\"Child\""),
        "{}",
        session.accessible_tree()
    );
    assert_eq!(session.system().task_count(), 0);

    // Waiting, it stays waiting.
    assert_eq!(session.step(instant_ms() + 10.0), State::Waiting);

    // Run again: on the same machine -- what the first wrote is there, and
    // the second writes after it -- and with no previous instance, the
    // first having ended.
    session.start(child).unwrap();
    step_until(&mut session, |session| window(session, "Child").is_some());

    assert!(window(&session, "Child").is_some());
    assert_eq!(session.system().task_count(), 1);
    assert_eq!(session.system().scheduler.slots.len(), 2);
    assert_eq!(
        file(&session, "C:\\ORACLE", "CHILD.TXT"),
        "winmain cmd=[] show=1 previous=no\r\nwindow\r\nfirst message\r\nexit\r\n\
         winmain cmd=[] show=1 previous=no\r\nwindow\r\nfirst message\r\n"
    );

    let shown = window(&session, "Child").unwrap();

    session.system().post_message(shown, WM_CLOSE, 0, 0);
    assert_eq!(step_until(&mut session, |_| false), State::Waiting);
    assert_eq!(session.take_exits(), [0]);
}

#[test]
fn the_last_program_faulting_ends_with_255() {
    let Some(mut session) = machine(&["FAULTC.EXE"]) else {
        return;
    };

    session.start("C:\\ORACLE\\FAULTC.EXE").unwrap();
    step_until(&mut session, |session| {
        window(session, "Faulting").is_some()
    });

    let shown = window(&session, "Faulting").expect("the program's window");

    // Told WM_USER, it faults: KERNEL's first box, then Application Error,
    // each answered with Enter, its default Close (`fault`).
    session.system().post_message(shown, WM_USER, 0, 0);

    let deadline = instant_ms() + 10_000.0;
    let mut exits = Vec::new();

    while exits.is_empty() && instant_ms() < deadline {
        let state = session.step(instant_ms() + 10.0);
        session.take_calls(false);
        exits.extend(session.take_exits());

        if state == State::Stopped {
            break;
        }

        // Each box, once up, answered: Enter before it comes goes to the
        // program's window, which makes nothing of it.
        if state == State::Idle {
            press(&session, "Enter");
        }
    }

    assert_eq!(exits, [255], "{:?}", session.stop());
    assert_eq!(step_until(&mut session, |_| false), State::Waiting);
    assert_eq!(session.stop(), None);
    assert_eq!(window(&session, "Faulting"), None);
}

#[test]
fn each_program_keeps_its_own_directory() {
    let Some(mut session) = machine(&["CURDIRC.EXE", "WINEXECC.EXE"]) else {
        return;
    };

    session.add_folder('C', "ORACLE\\CB", host_seconds());
    session.add_folder('C', "OTHER", host_seconds());
    session.add_file(
        'C',
        "OTHER\\WINEXECC.EXE",
        std::fs::read(root().join("oracle/build/probes/WINEXECC.EXE")).unwrap(),
        host_seconds(),
    );

    // The first, in its own folder; it changes to CB.
    session.start("C:\\ORACLE\\CURDIRC.EXE").unwrap();
    step_until(&mut session, |session| {
        file(session, "C:\\ORACLE", "CURDIR.TXT").lines().count() >= 2
    });

    // Another started from another folder, as Program Manager starts it:
    // in its own, which is not the first's.
    session.start("C:\\OTHER\\WINEXECC.EXE").unwrap();
    step_until(&mut session, |session| {
        file(session, "C:\\ORACLE", "CHILD.TXT").lines().count() >= 3
    });

    // The first, told WM_USER, is in the directory it changed to still.
    let shown = window(&session, "Child");
    let first = {
        let system = session.system();

        system
            .top_level()
            .into_iter()
            .filter_map(|index| system.windows[index].as_ref())
            .find(|window| window.class.eq_ignore_ascii_case("CurDirChild"))
            .map(|window| window.hwnd)
    };

    assert!(shown.is_some());
    session
        .system()
        .post_message(first.expect("the first's window"), WM_USER, 1, 0);
    step_until(&mut session, |session| {
        file(session, "C:\\ORACLE", "CURDIR.TXT").lines().count() >= 3
    });

    assert_eq!(
        file(&session, "C:\\ORACLE", "CURDIR.TXT"),
        "winmain cwd=C:\\ORACLE\r\nchanged cwd=C:\\ORACLE\\CB\r\ngot 1 cwd=C:\\ORACLE\\CB\r\n"
    );
}
