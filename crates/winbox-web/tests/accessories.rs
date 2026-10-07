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

use winbox_machine::Change;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;

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

fn key(code: &str, name: &str, alt: bool) -> Key {
    Key {
        code: code.to_string(),
        key: name.to_string(),
        repeat: false,
        alt,
    }
}

/// The key a character is typed with, what it types, and whether Shift is
/// held for it.
fn key_of(character: char) -> (String, String, bool) {
    match character {
        'a'..='z' => (
            format!("Key{}", character.to_ascii_uppercase()),
            character.to_string(),
            false,
        ),
        'A'..='Z' => (format!("Key{character}"), character.to_string(), true),
        '0'..='9' => (format!("Digit{character}"), character.to_string(), false),
        ' ' => ("Space".into(), " ".into(), false),
        '.' => ("Period".into(), ".".into(), false),
        '\\' => ("Backslash".into(), "\\".into(), false),
        ':' => ("Semicolon".into(), ":".into(), true),
        '*' => ("Digit8".into(), "*".into(), true),
        '+' => ("Equal".into(), "+".into(), true),
        '=' => ("Equal".into(), "=".into(), false),
        _ => panic!("no key for {character:?}"),
    }
}

/// Text typed, a key at a time.
fn type_text(session: &mut Session, text: &str) {
    for character in text.chars() {
        let (code, name, shift) = key_of(character);

        if shift {
            session.key(true, &key("ShiftLeft", "Shift", false));
        }

        session.key(true, &key(&code, &name, false));
        session.key(false, &key(&code, &name, false));

        if shift {
            session.key(false, &key("ShiftLeft", "Shift", false));
        }

        frames(session, 3);
    }

    frames(session, 20);
}

/// A key pressed and let go, with Control, Shift or Alt held where one is
/// named, and the run let take it.
fn press(session: &mut Session, held: Option<&str>, code: &str, name: &str) {
    let modifier = held.map(|held| match held {
        "Control" => ("ControlLeft", "Control"),
        "Shift" => ("ShiftLeft", "Shift"),
        _ => ("AltLeft", "Alt"),
    });
    let alt = held == Some("Alt");

    if let Some((code, name)) = modifier {
        session.key(true, &key(code, name, alt));
    }

    session.key(true, &key(code, name, alt));
    session.key(false, &key(code, name, alt));

    if let Some((code, name)) = modifier {
        session.key(false, &key(code, name, false));
    }

    frames(session, 40);
}

/// A letter pressed with a modifier held.
fn chord(session: &mut Session, held: &str, letter: char) {
    let (code, name, _) = key_of(letter);

    press(session, Some(held), &code, &name);
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

/// The text of the first edit control in the window shown with a title.
fn edit_text(session: &Session, title: &str) -> String {
    let parent = shown(session, title).unwrap_or_else(|| panic!("no window {title}"));
    let system = session.system();

    system
        .windows
        .iter()
        .flatten()
        .find(|window| window.parent == Some(parent) && window.class.eq_ignore_ascii_case("edit"))
        .and_then(|window| window.control.as_ref())
        .map(|control| control.text.clone())
        .unwrap_or_default()
}

/// A file's bytes as a program left it on C:, where it wrote one.
fn written(session: &Session, path: &str) -> Option<Vec<u8>> {
    session
        .changes('C')
        .into_iter()
        .find_map(|change| match change {
            Change::File { path: at, data, .. } if at.eq_ignore_ascii_case(path) => {
                Some(data.to_vec())
            }
            _ => None,
        })
}

/// Saved as `path` through a common Save As box opened by its menu's keys.
fn save_as(session: &mut Session, path: &str) {
    press(session, Some("Alt"), "KeyF", "f");
    press(session, None, "KeyA", "a");
    frames(session, 60);
    assert!(shown(session, "Save As").is_some(), "no Save As box");
    type_text(session, path);
    press(session, None, "Enter", "Enter");
    frames(session, 100);
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

/// File Manager reads each drive's boot sector with `INT 25h`, which
/// stopped the run (`WINFILE.EXE` seg6 `09e3`).
#[test]
fn file_manager_opens() {
    let Some(session) = started("WINFILE.EXE") else {
        return;
    };

    assert!(shown(&session, "File Manager").is_some());
}

/// File Manager's tree finds the directory it opened in by its item's data
/// (`LB_SELECTSTRING` without strings, `USER.EXE` seg35 `1f1f`); it found
/// none, and its window was named `\*.*`.
#[test]
fn file_managers_tree_selects_its_directory() {
    let Some(session) = started("WINFILE.EXE") else {
        return;
    };

    assert!(shown(&session, "C:\\WINDOWS\\*.*").is_some());
}

/// File Manager's message filter answers in AX, DX left as it was; read as
/// a long, every key in its Copy box was taken as filtered (`USER.EXE` seg1
/// `80f0`).
#[test]
fn file_managers_copy_box_takes_the_keys() {
    let Some(mut session) = started("WINFILE.EXE") else {
        return;
    };

    click(&mut session, 300, 161, false);
    press(&mut session, None, "F8", "F8");
    frames(&mut session, 60);
    type_text(&mut session, "c:\\copy.hlp");
    assert_eq!(text_of(&session, "Copy", 0x67), "c:\\copy.hlp");
}

/// File Manager reads its Copy box's From field into a buffer sized by
/// `EM_LINELENGTH`, which a single-line control answers with its text's
/// length (`sllen`); answering nought, the file to copy was cut short.
#[test]
fn file_managers_copy_box_reads_its_from_field_whole() {
    let Some(mut session) = started("WINFILE.EXE") else {
        return;
    };

    click(&mut session, 300, 161, false);
    press(&mut session, None, "F8", "F8");
    frames(&mut session, 60);
    type_text(&mut session, "c:\\copy.hlp");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 100);
    assert!(
        !session
            .system()
            .windows
            .iter()
            .flatten()
            .any(|window| window.title.contains("Cannot find file")),
        "the From field was read short"
    );
}

/// A letter typed with Control is a control character (`KEYBOARD.DRV`
/// seg10 `05b2`): Calculator copies and pastes on Control and C and V.
#[test]
fn calculator_adds_and_copies_its_sum_with_the_control_keys() {
    let Some(mut session) = started("CALC.EXE") else {
        return;
    };

    // 12 + 34 = by the mouse on its keys.
    for (x, y) in [
        (226, 307),
        (268, 307),
        (352, 343),
        (310, 307),
        (226, 271),
        (394, 343),
    ] {
        click(&mut session, x, y, false);
    }

    assert_eq!(text_of(&session, "Calculator", 0x19e), " 46.");

    // 7 * 6 = typed.
    type_text(&mut session, "7*6=");
    assert_eq!(text_of(&session, "Calculator", 0x19e), " 42.");

    // Copied, cleared, pasted.
    chord(&mut session, "Control", 'c');
    press(&mut session, None, "Escape", "Escape");
    assert_eq!(text_of(&session, "Calculator", 0x19e), " 0.");
    chord(&mut session, "Control", 'v');
    assert_eq!(text_of(&session, "Calculator", 0x19e), " 42.");
}

/// Notepad saves from the block its edit control handed it, which held
/// noughts: the text is kept there as it changes (`USER.EXE` seg26 `05c4`).
#[test]
fn notepad_saves_what_was_typed() {
    let Some(mut session) = started("NOTEPAD.EXE") else {
        return;
    };

    type_text(&mut session, "Hello Notepad");
    save_as(&mut session, "c:\\typed.txt");
    assert_eq!(
        written(&session, "TYPED.TXT").as_deref(),
        Some(&b"Hello Notepad"[..])
    );
    assert!(shown(&session, "Notepad - typed.txt").is_some());
}

/// Control or Shift with Insert or Delete, and the characters Control and
/// C, V and X type, copy, paste and cut in an edit control (`USER.EXE`
/// seg28 `0a93`, `0959`).
#[test]
fn edit_controls_copy_cut_and_paste_with_the_keys() {
    let Some(mut session) = started("NOTEPAD.EXE") else {
        return;
    };

    type_text(&mut session, "abc");

    // Copied with Control and Insert, pasted with Shift and Insert.
    press(&mut session, Some("Shift"), "Home", "Home");
    press(&mut session, Some("Control"), "Insert", "Insert");
    press(&mut session, None, "End", "End");
    press(&mut session, Some("Shift"), "Insert", "Insert");
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "abcabc");

    // Cut with Shift and Delete, and pasted back twice.
    press(&mut session, Some("Shift"), "Home", "Home");
    press(&mut session, Some("Shift"), "Delete", "Delete");
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "");
    press(&mut session, Some("Shift"), "Insert", "Insert");
    press(&mut session, Some("Shift"), "Insert", "Insert");
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "abcabcabcabc");

    // Control and V in the Find box's field, which has no accelerators.
    press(&mut session, Some("Alt"), "KeyS", "s");
    press(&mut session, None, "KeyF", "f");
    frames(&mut session, 40);
    chord(&mut session, "Control", 'v');
    assert_eq!(text_of(&session, "Find", 0x480), "abcabc");
}
