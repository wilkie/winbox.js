//! A window dragged by its caption, as a person at the page drags one: the
//! move and size loop, then `SetWindowPos`. Windows takes the window's bits
//! with it (`swpbits`), so it shows at once, whole, where it was let go, and
//! what it uncovered shows what lies beneath: the desktop, or the window
//! under it, drawn again.
//!
//! The engine once painted a window moved only where it had been: what it
//! uncovered was made due in every window there -- the window moved too,
//! which overlapped its old place -- and the paint was held to that box, so
//! the part of its new place outside its old one was left as the screen had
//! it.
//!
//! The host's time is the test's own, as in `stress.rs`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_machine::host_seconds;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::survey::Screen;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
}

const NOTEPAD: &str = "C:\\WINDOWS\\NOTEPAD.EXE";
const CHARMAP: &str = "C:\\WINDOWS\\CHARMAP.EXE";

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
            assert!(session.add_folder('C', &named, host_seconds()));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), host_seconds()));
        }
    }
}

/// A fresh machine, Windows staying up, the installation on C:; none where
/// the oracle's build is not here.
fn machine() -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/NOTEPAD.EXE").is_file()
        || !windows.join("WINDOWS/CHARMAP.EXE").is_file()
    {
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
    Some(session)
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

/// The first window shown with `title`: its place, and its client area's,
/// on the screen, as left, top, right and bottom.
fn place(session: &Session, title: &str) -> ([i32; 4], [i32; 4]) {
    let system = session.system();
    let window = system
        .windows
        .iter()
        .flatten()
        .find(|window| window.visible && window.title == title)
        .unwrap_or_else(|| panic!("no window {title}"));

    (
        [
            window.left,
            window.top,
            window.left + window.width,
            window.top + window.height,
        ],
        [
            window.left + window.client.left,
            window.top + window.client.top,
            window.left + window.client.right,
            window.top + window.client.bottom,
        ],
    )
}

/// The screen's palette indices as they are, no cursor over them, and the
/// caret's rectangle on the screen while it is drawn, which blinks.
fn screen(session: &Session) -> (Screen, Option<[i32; 4]>) {
    let system = session.system();
    let caret = system
        .caret
        .caret
        .filter(|caret| caret.on)
        .and_then(|caret| {
            let window = system
                .windows
                .iter()
                .flatten()
                .find(|window| window.hwnd == caret.hwnd)?;
            let left = window.left + window.client.left + caret.x;
            let top = window.top + window.client.top + caret.y;

            Some([left, top, left + caret.width, top + caret.height])
        });

    (Screen::bare(&system).unwrap(), caret)
}

/// The caption pressed at `from`, dragged by `by` in ten steps, and let go.
fn drag(session: &mut Session, from: (i16, i16), by: (i16, i16)) {
    let (x, y) = from;

    session.pointer(pointer_of(0, x, y, 0, 0, false));
    session.pointer(pointer_of(1, x, y, 0, 1, false));
    frames(session, 4);

    for step in 1..=10 {
        session.pointer(pointer_of(
            0,
            x + by.0 * step / 10,
            y + by.1 * step / 10,
            0,
            1,
            false,
        ));
        frames(session, 2);
    }

    session.pointer(pointer_of(2, x + by.0, y + by.1, 0, 0, false));
    frames(session, 60);
}

fn inside([left, top, right, bottom]: [i32; 4], x: i32, y: i32) -> bool {
    x >= left && x < right && y >= top && y < bottom
}

/// The pixels of `area` on the screen, but those in `skip`, where `after`
/// does not show what `expected` says.
fn differing(
    after: &Screen,
    area: [i32; 4],
    skip: &[Option<[i32; 4]>],
    expected: impl Fn(i32, i32) -> u8,
) -> Vec<(i32, i32)> {
    let (width, height) = (after.width as i32, after.height as i32);
    let mut wrong = Vec::new();

    for y in area[1].max(0)..area[3].min(height) {
        for x in area[0].max(0)..area[2].min(width) {
            if skip.iter().flatten().any(|&rect| inside(rect, x, y)) {
                continue;
            }

            if after.indices[(y * width + x) as usize] != expected(x, y) {
                wrong.push((x, y));
            }
        }
    }

    wrong
}

#[test]
fn notepad_dragged_by_its_caption_shows_whole_where_it_was_let_go() {
    let Some(mut session) = machine() else {
        return;
    };

    session.start(NOTEPAD).unwrap();
    frames(&mut session, 250);

    let (was, _) = place(&session, "Notepad - (Untitled)");
    let (before, caret_before) = screen(&session);
    let desktop = before.indices[before.indices.len() - 1];
    let width = before.width as i32;

    drag(
        &mut session,
        ((was[0] + 60) as i16, (was[1] + 10) as i16),
        (70, 50),
    );

    let (now, _) = place(&session, "Notepad - (Untitled)");
    let (after, caret_after) = screen(&session);
    let shifted = caret_before.map(|[l, t, r, b]| [l + 70, t + 50, r + 70, b + 50]);

    assert_eq!(now, [was[0] + 70, was[1] + 50, was[2] + 70, was[3] + 50]);

    // At its new place, all of it as it was.
    let moved = differing(&after, now, &[shifted, caret_after], |x, y| {
        before.indices[((y - 50) * width + x - 70) as usize]
    });

    assert!(
        moved.is_empty(),
        "{} pixels of Notepad wrong, as {:?}",
        moved.len(),
        &moved[..moved.len().min(8)]
    );

    // Where it was and is no more, the desktop.
    let left_strip = [was[0], was[1], now[0], was[3]];
    let top_strip = [was[0], was[1], was[2], now[1]];

    for strip in [left_strip, top_strip] {
        let uncovered = differing(&after, strip, &[], |_, _| desktop);

        assert!(
            uncovered.is_empty(),
            "{} pixels uncovered not the desktop",
            uncovered.len()
        );
    }
}

#[test]
fn character_map_dragged_over_notepad_shows_notepad_again_beneath() {
    let Some(mut session) = machine() else {
        return;
    };

    session.start(NOTEPAD).unwrap();
    frames(&mut session, 250);

    let (notepad_place, notepad) = place(&session, "Notepad - (Untitled)");
    let (under, caret_under) = screen(&session);
    let width = under.width as i32;

    session.start(CHARMAP).unwrap();
    frames(&mut session, 250);

    let (was, _) = place(&session, "Character Map");
    let (before, caret_before) = screen(&session);
    let desktop = before.indices[before.indices.len() - 1];

    drag(
        &mut session,
        ((was[0] + 120) as i16, (was[1] + 10) as i16),
        (60, 40),
    );

    let (now, _) = place(&session, "Character Map");
    let (after, caret_after) = screen(&session);
    let shifted = caret_before.map(|[l, t, r, b]| [l + 60, t + 40, r + 60, b + 40]);

    assert_eq!(now, [was[0] + 60, was[1] + 40, was[2] + 60, was[3] + 40]);

    // At its new place, all of it as it was.
    let moved = differing(&after, now, &[shifted, caret_after], |x, y| {
        before.indices[((y - 40) * width + x - 60) as usize]
    });

    assert!(
        moved.is_empty(),
        "{} pixels of Character Map wrong, as {:?}",
        moved.len(),
        &moved[..moved.len().min(8)]
    );

    // Where it was and is no more: Notepad's client area as it was before
    // Character Map came over it, and the desktop beyond Notepad.
    let left_strip = [was[0], was[1], now[0], was[3]];
    let top_strip = [was[0], was[1], was[2], now[1]];

    for strip in [left_strip, top_strip] {
        let client = [
            strip[0].max(notepad[0]),
            strip[1].max(notepad[1]),
            strip[2].min(notepad[2]),
            strip[3].min(notepad[3]),
        ];
        let beneath = differing(&after, client, &[caret_under], |x, y| {
            under.indices[(y * width + x) as usize]
        });

        assert!(
            beneath.is_empty(),
            "{} pixels of Notepad wrong, as {:?}",
            beneath.len(),
            &beneath[..beneath.len().min(8)]
        );

        let off = differing(&after, strip, &[], |x, y| {
            if inside(notepad_place, x, y) {
                after.indices[(y * width + x) as usize]
            } else {
                desktop
            }
        });

        assert!(
            off.is_empty(),
            "{} pixels uncovered not the desktop",
            off.len()
        );
    }
}
