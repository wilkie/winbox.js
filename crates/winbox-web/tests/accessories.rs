//! Windows 3.1's own programs, from the installation, used as a person at
//! the page uses them: their menus by the mouse and the keys, their dialogs'
//! controls pressed and typed into, text typed, selected, cut and pasted
//! between programs, files saved, pictures drawn. Each session is held to
//! what shows -- the windows' texts, the screen -- and what was written.
//! Where one once failed, it says why.
//!
//! The host's time is the test's own, as in `moves.rs`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_web::session::{Made, Session, State, pointer_of};

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
}

fn host_ms() -> f64 {
    NOW.with(|now| {
        now.set(now.get() + 0.01);
        now.get()
    })
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A host's folder put on drive C: at `dos`, in the order of the names.
fn hold(session: &mut Session, folder: &Path, dos: &str) {
    let mut entries: Vec<_> = std::fs::read_dir(folder).unwrap().flatten().collect();

    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if path.is_dir() {
            assert!(session.add_folder('C', &named, 0));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), 0));
        }
    }
}

/// A fresh machine, Windows staying up, the installation on C:, and the
/// program named in `C:\WINDOWS` started; none where the oracle's build is
/// not here.
fn started(program: &str) -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS").join(program).is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

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
    hold(&mut session, &windows, "");
    session.mark_planned();
    start(&mut session, program);
    Some(session)
}

/// Another program of `C:\WINDOWS` started beside those running.
fn start(session: &mut Session, program: &str) {
    session.start(&format!("C:\\WINDOWS\\{program}")).unwrap();
    frames(session, 150);
}

/// So many of the page's frames.
fn frames(session: &mut Session, count: usize) {
    for frame in 0..count {
        let slice = [4.0, 16.0, 12.0][frame % 3];
        let state = session.step(host_ms() + slice);

        NOW.with(|now| now.set(now.get() + slice));

        if state == State::Idle {
            let wake = session.wake_at();

            NOW.with(|now| now.set(now.get().max(wake)));
        }

        session.take_calls(false);
        assert_ne!(state, State::Stopped, "{:?}", session.stop());
    }
}

/// The left button pressed and let go at a point of the screen, twice for
/// a double click, as the page gives it; and the run let take it.
fn click(session: &mut Session, x: i16, y: i16, double: bool) {
    session.pointer(pointer_of(0, x, y, 0, 0, false));

    for time in 0..if double { 2 } else { 1 } {
        session.pointer(pointer_of(1, x, y, 0, 1, time == 1));
        session.pointer(pointer_of(2, x, y, 0, 0, false));
    }

    frames(session, 60);
}

/// The first window shown with a title, or of a class.
fn shown(session: &Session, named: &str) -> Option<usize> {
    let system = session.system();

    system.windows.iter().position(|window| {
        window.as_ref().is_some_and(|window| {
            window.visible && (window.title == named || window.class == named)
        })
    })
}

/// The text of the control with an identifier in the window shown with a
/// title: an edit control's, a static's or a button's.
fn text_of(session: &Session, title: &str, id: u16) -> String {
    let parent = shown(session, title).unwrap_or_else(|| panic!("no window {title}"));
    let system = session.system();
    let window = system
        .windows
        .iter()
        .flatten()
        .find(|window| window.parent == Some(parent) && window.control_id == id)
        .unwrap_or_else(|| panic!("no control {id:x} in {title}"));

    window
        .control
        .as_ref()
        .map_or_else(|| window.title.clone(), |control| control.text.clone())
}

/// Control Panel's window, made empty, sets its scroll bar at each
/// `WM_SIZE` from a width that depends on the bar; the bar's frame change
/// sent another `WM_SIZE` though the client area had not changed, and it
/// went on until its stack ran out. USER sends `WM_SIZE` only where the
/// client area's size changed (`USER.EXE` seg7 `0fe6`, `122d`).
#[test]
fn control_panel_shows_its_applets_and_opens_one() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    assert!(shown(&session, "Control Panel").is_some());
    assert_eq!(
        text_of(&session, "Control Panel", 0x15),
        "Changes the Windows screen colors"
    );

    // Date & Time, its icon double-clicked.
    click(&mut session, 90, 117, true);
    frames(&mut session, 60);
    assert!(shown(&session, "Date & Time").is_some());
    assert_eq!(text_of(&session, "Date & Time", 0x2c2), "70");
}
