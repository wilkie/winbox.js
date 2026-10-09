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
    started_as(program, false, &[], &[])
}

/// A fresh machine as `started` makes one, and the sound card installed
/// as the page installs it where `sound` (`Session::install_sound`), with
/// the host's files named put in C:'s root -- the oracle's probes, with
/// the folder they write their records in -- and the changes a run before
/// made put back, as the page puts them back.
fn started_as(program: &str, sound: bool, files: &[&Path], changes: &[Change]) -> Option<Session> {
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

    // A probe's records' folder.
    if !files.is_empty() {
        assert!(session.add_folder('C', "ORACLE", 0));
    }

    for file in files {
        let name = file.file_name().unwrap().to_string_lossy().to_string();

        assert!(session.add_file('C', &name, std::fs::read(file).ok()?, 0));
    }

    session.mark_planned();

    for change in changes {
        match change {
            Change::File {
                path,
                data,
                modified,
            } => assert!(session.add_file('C', path, data.to_vec(), *modified)),
            Change::Folder { path, modified } => {
                session.add_folder('C', path, *modified);
            }
            Change::Removed { path } => {
                session.remove('C', path);
            }
        }
    }

    if sound {
        assert!(session.install_sound());
    }

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

/// The left button pressed at one point, the mouse moved with it held to
/// another, and let go there.
fn drag(session: &mut Session, from: (i16, i16), to: (i16, i16)) {
    session.pointer(pointer_of(0, from.0, from.1, 0, 0, false));
    session.pointer(pointer_of(1, from.0, from.1, 0, 1, false));
    frames(session, 10);

    for step in 1..=8 {
        let x = from.0 + (to.0 - from.0) * step / 8;
        let y = from.1 + (to.1 - from.1) * step / 8;

        session.pointer(pointer_of(0, x, y, 0, 1, false));
        frames(session, 4);
    }

    session.pointer(pointer_of(2, to.0, to.1, 0, 0, false));
    frames(session, 40);
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

/// Whether a folder was made on C:.
fn made_folder(session: &Session, path: &str) -> bool {
    session.changes('C').into_iter().any(
        |change| matches!(change, Change::Folder { path: at, .. } if at.eq_ignore_ascii_case(path)),
    )
}

/// The screen's colours inside a box, each a `0x00RRGGBB` word.
fn colours(session: &Session, left: usize, top: usize, right: usize, bottom: usize) -> Vec<u32> {
    let screen = session.shown();
    let width = 640;

    (top..bottom)
        .flat_map(|y| (left..right).map(move |x| y * width + x))
        .map(|at| screen.colours[usize::from(screen.indices[at])])
        .collect()
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

/// The identifier of the control with the focus.
fn focus_id(session: &Session) -> u16 {
    let system = session.system();

    system
        .focus
        .and_then(|focus| system.windows[focus].as_ref())
        .map_or(0, |window| window.control_id)
}

/// The height of the control with an identifier in the window shown with
/// a title.
fn height_of(session: &Session, title: &str, id: u16) -> i32 {
    let parent = shown(session, title).unwrap_or_else(|| panic!("no window {title}"));
    let system = session.system();

    system
        .windows
        .iter()
        .flatten()
        .find(|window| window.parent == Some(parent) && window.control_id == id)
        .map_or_else(
            || panic!("no control {id:x} in {title}"),
            |window| window.height,
        )
}

/// Control Panel's Date & Time, its icon double-clicked.
fn open_date_and_time(session: &mut Session) {
    click(session, 90, 117, true);
    frames(session, 60);
    assert!(shown(session, "Date & Time").is_some(), "no Date & Time");
}

/// Date & Time's fields are multi-line edit controls. Once the dialog
/// manager asks one with a message, it knows it is in a dialog and takes
/// Tab as the dialog's, moving to the next field (`USER.EXE` seg30 `1140`);
/// winbox.js typed a tab into it. Escape posts the dialog `WM_CLOSE`, its
/// Cancel (`10b6`); it did nothing. Its AM and PM list, made one dialog
/// unit square and then moved to its field's height, was 2 pixels high: its
/// rows were still the System font's 16 when it was sized, where
/// `WM_SETFONT` had made them Helv 8's 13 (seg38 `03c3`).
#[test]
fn control_panels_date_and_time_takes_tab_and_escape() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    open_date_and_time(&mut session);

    let list = height_of(&session, "Date & Time", 713);

    assert!(
        list > 2 && (list - 2) % 13 == 0,
        "AM and PM list {list} high"
    );

    let before = focus_id(&session);
    let text = text_of(&session, "Date & Time", before);

    press(&mut session, None, "Tab", "Tab");

    let after = focus_id(&session);

    assert_ne!(after, before, "Tab left the focus in {before}");
    assert_eq!(text_of(&session, "Date & Time", before), text);
    press(&mut session, None, "Escape", "Escape");
    assert!(
        shown(&session, "Date & Time").is_none(),
        "Escape left Date & Time"
    );
}

/// Notepad's Undo, which it greys unless its edit control answers
/// `EM_CANUNDO`; it stayed grey. What was typed is undone, and undone again
/// put back, with Alt and Backspace undoing as the control's own key
/// (`USER.EXE` seg26 `0794`, seg32 `0477`, seg30 `2307`).
#[test]
fn notepad_undoes_what_was_typed() {
    let Some(mut session) = started("NOTEPAD.EXE") else {
        return;
    };

    type_text(&mut session, "Hello Notepad");
    press(&mut session, Some("Alt"), "KeyE", "e");
    press(&mut session, None, "KeyU", "u");
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "");
    press(&mut session, Some("Alt"), "KeyE", "e");
    press(&mut session, None, "KeyU", "u");
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "Hello Notepad");
    press(&mut session, Some("Alt"), "Backspace", "Backspace");
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "");
}

/// The MIDI Mapper's current setup's number as the run left
/// `MIDIMAP.CFG`: the word at 6.
fn current_setup(session: &Session) -> Option<u16> {
    written(session, "WINDOWS\\SYSTEM\\MIDIMAP.CFG")
        .map(|bytes| u16::from_le_bytes([bytes[6], bytes[7]]))
}

/// The MIDI Mapper's dialog opened from Control Panel: its icon found by
/// the arrow keys, by the description Control Panel shows for it, and
/// opened with Enter.
fn open_midi_mapper(session: &mut Session) {
    for _ in 0..16 {
        if text_of(session, "Control Panel", 0x15)
            == "Selects a MIDI setup and changes MIDI settings"
        {
            break;
        }

        press(session, None, "ArrowRight", "ArrowRight");
    }

    assert_eq!(
        text_of(session, "Control Panel", 0x15),
        "Selects a MIDI setup and changes MIDI settings",
        "no MIDI Mapper icon"
    );
    press(session, None, "Enter", "Enter");
    frames(session, 100);
    assert!(shown(session, "MIDI Mapper").is_some(), "no MIDI Mapper");
}

/// A setup chosen in the open dialog's Name box, its list dropped with F4
/// and put away with F4 after the arrow key, and the dialog closed with
/// Enter.
fn choose_setup(session: &mut Session, arrow: &str, description: &str) {
    chord(session, "Alt", 'a');
    press(session, None, "F4", "F4");
    press(session, None, arrow, arrow);
    press(session, None, "F4", "F4");
    assert_eq!(text_of(session, "MIDI Mapper", 0x6e), description);
    press(session, None, "Enter", "Enter");
    frames(session, 100);
    assert!(
        shown(session, "MIDI Mapper").is_none(),
        "the MIDI Mapper stays"
    );
}

/// What the synthesizer is sent as `ADLIBMAP.EXE` plays through the
/// mapper, to its end, when it ends Windows: whether it was sent its note
/// on channel 13, three seconds after the probe opens the mapper, and its
/// note on channel 1 after that.
fn channels_heard(session: &mut Session) -> (bool, bool) {
    session.take_sound();
    session.start("C:\\ADLIBMAP.EXE").unwrap();

    let mut heard = Vec::new();

    for frame in 0..200_000 {
        let slice = [4.0, 16.0, 12.0][frame % 3];
        let state = session.step(host_ms() + slice);

        NOW.with(|now| now.set(now.get() + slice));

        if state == State::Idle {
            let wake = session.wake_at();

            NOW.with(|now| now.set(now.get().max(wake)));
        }

        session.take_calls(false);

        for sound in session.take_sound() {
            if let winbox_win16::audio::Sound::Midi { output, bytes, .. } = sound
                && output == winbox_win16::audio::MidiOutput::Synthesizer
            {
                heard.push(bytes);
            }
        }

        if state == State::Stopped {
            break;
        }
    }

    let note = |status: u8, key: u8| heard.iter().any(|bytes| bytes.starts_with(&[status, key]));

    (note(0x9c, 60), note(0x90, 62))
}

/// Control Panel's MIDI Mapper on the page's machine with the sound card:
/// Windows' own applet, `MIDIMAP.DRV`'s, through WinBox's mapper's
/// `CPlApplet`. Its icon is there; it opens on the setups, "Ad Lib
/// general" current as the card installs it; "Ad Lib" chosen and the
/// dialog closed, `MIDIMAP.CFG`'s current setup is its (7), and WinBox's
/// mapper follows: a General MIDI note on channel 1 goes nowhere, one on
/// channel 13 is played. The probe that plays them ends Windows; on a
/// machine made afresh with what that one wrote, as the page makes one,
/// "Ad Lib" is still current. Its Edit dialogs open on a setup, a patch
/// map and a key map. "Ad Lib general" chosen again (8), channel 1 is
/// played too.
#[test]
fn control_panels_midi_mapper_chooses_the_mappers_setup() {
    let probe = root().join("oracle/build/probes/ADLIBMAP.EXE");

    if !probe.is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return;
    }

    let Some(mut session) = started_as("CONTROL.EXE", true, &[&probe], &[]) else {
        return;
    };

    open_midi_mapper(&mut session);
    assert_eq!(text_of(&session, "MIDI Mapper", 0x6e), "General MIDI setup");
    choose_setup(&mut session, "ArrowUp", "Base-level setup");
    assert_eq!(current_setup(&session), Some(7));
    assert_eq!(channels_heard(&mut session), (true, false));

    let changes = session.changes('C');
    let mut session = started_as("CONTROL.EXE", true, &[&probe], &changes).unwrap();

    open_midi_mapper(&mut session);
    assert_eq!(text_of(&session, "MIDI Mapper", 0x6e), "Base-level setup");

    // The Edit dialogs: a setup's, a patch map's, a key map's.
    chord(&mut session, "Alt", 'e');
    assert!(
        shown(&session, "MIDI Setup: 'Ad Lib'").is_some(),
        "no setup dialog"
    );
    press(&mut session, None, "Escape", "Escape");
    assert!(shown(&session, "MIDI Setup: 'Ad Lib'").is_none());

    for (letter, title) in [('p', "MIDI Patch Map: '"), ('k', "MIDI Key Map: '")] {
        chord(&mut session, "Alt", letter);
        chord(&mut session, "Alt", 'e');

        let opened = session
            .system()
            .windows
            .iter()
            .flatten()
            .any(|window| window.visible && window.title.starts_with(title));

        assert!(opened, "no {title} dialog");
        press(&mut session, None, "Escape", "Escape");
    }

    chord(&mut session, "Alt", 's');
    choose_setup(&mut session, "ArrowDown", "General MIDI setup");
    assert_eq!(current_setup(&session), None, "the installed setup again");
    assert_eq!(channels_heard(&mut session), (true, true));
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

/// File Manager asks DOS how much room the drive has (`INT 21h` 36h)
/// before it copies; a drive held in memory answered `FFFFh`, as for no
/// drive, and File Manager said "Not enough disk space". A drive with no FAT
/// of its own answers as DOSBox answers for the folder it mounts as C:
/// (`diskfree`). It then makes the copy with function 6C00h, which was not
/// answered ("Invalid file handle"), and reads the file's stamp with 5700h
/// (`WINFILE.EXE` `1f785`, `1f879`).
#[test]
fn file_manager_copies_a_file() {
    let Some(mut session) = started("WINFILE.EXE") else {
        return;
    };

    click(&mut session, 300, 161, false);
    press(&mut session, None, "F8", "F8");
    frames(&mut session, 60);

    let from = text_of(&session, "Copy", 0x66);

    type_text(&mut session, "c:\\copy.hlp");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 200);

    let source = std::fs::read(
        root()
            .join("oracle/build/drive-c/WINDOWS")
            .join(from.trim()),
    )
    .unwrap();

    assert!(
        written(&session, "COPY.HLP").as_ref() == Some(&source),
        "{from} not copied: {:?}",
        session
            .system()
            .windows
            .iter()
            .flatten()
            .map(|window| window.title.as_str())
            .filter(|title| !title.is_empty())
            .collect::<Vec<_>>()
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

/// Write's Save As, whose hook sets no focus, takes it from USER as it is
/// made active with the focus elsewhere (`USER.EXE` seg1 `37a3`); the name
/// typed went to the document.
#[test]
fn write_saves_a_document_through_its_save_as_box() {
    let Some(mut session) = started("WRITE.EXE") else {
        return;
    };

    type_text(&mut session, "Hello Write");
    save_as(&mut session, "c:\\doc.wri");

    let saved = written(&session, "DOC.WRI").expect("no DOC.WRI");

    assert_eq!(&saved[..2], &[0x31, 0xbe]);
    assert!(saved.windows(11).any(|text| text == b"Hello Write"));
    assert!(shown(&session, "Write - DOC.WRI").is_some());
}

/// A document window's icon let go where it was pressed asks for its own
/// system menu with the hyphen (`USER.EXE` seg6 `1389`); asked with a
/// space, Program Manager's own menu came up, and took the second click.
#[test]
fn program_managers_group_icon_double_clicked_is_restored() {
    let Some(mut session) = started("PROGMAN.EXE") else {
        return;
    };
    let size = |session: &Session| {
        let at = shown(session, "Accessories").expect("no Accessories");
        let system = session.system();
        let window = system.windows[at].as_ref().unwrap();

        (window.width, window.height)
    };

    assert_eq!(size(&session), (36, 36));
    click(&mut session, 110, 325, true);
    assert!(size(&session).0 > 36, "{:?}", size(&session));
    // No menu came up over it.
    assert!(!menu_open(&session));
}

#[test]
fn file_manager_makes_a_directory() {
    let Some(mut session) = started("WINFILE.EXE") else {
        return;
    };

    press(&mut session, Some("Alt"), "KeyF", "f");
    press(&mut session, None, "KeyE", "e");
    frames(&mut session, 60);
    type_text(&mut session, "newdir");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 100);
    assert!(made_folder(&session, "WINDOWS\\NEWDIR"));
}

#[test]
fn paintbrush_draws_and_saves_its_picture() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    // Red, the filled ellipse, and one drawn.
    click(&mut session, 220, 372, false);
    click(&mut session, 48, 274, false);
    drag(&mut session, (350, 100), (450, 200));

    let red = colours(&session, 390, 140, 410, 160);

    assert!(red.iter().all(|&colour| colour == 0x00ff_0000), "{red:x?}");

    save_as(&mut session, "c:\\pic.bmp");
    assert_eq!(
        &written(&session, "PIC.BMP").expect("no PIC.BMP")[..2],
        b"BM"
    );
}

#[test]
fn character_map_copies_into_notepad() {
    let Some(mut session) = started("CHARMAP.EXE") else {
        return;
    };

    click(&mut session, 56, 135, true);
    assert_eq!(text_of(&session, "Character Map", 0x68), "a");
    click(&mut session, 586, 127, false);

    start(&mut session, "NOTEPAD.EXE");
    chord(&mut session, "Control", 'v');
    assert_eq!(edit_text(&session, "Notepad - (Untitled)"), "a");
}

#[test]
fn cardfile_adds_a_card_and_saves() {
    let Some(mut session) = started("CARDFILE.EXE") else {
        return;
    };

    press(&mut session, None, "F7", "F7");
    type_text(&mut session, "Zebra");
    press(&mut session, None, "Enter", "Enter");
    type_text(&mut session, "zebra body");
    assert_eq!(text_of(&session, "Cardfile - (Untitled)", 0xca), "2  Cards");

    save_as(&mut session, "c:\\cards.crd");

    let saved = written(&session, "CARDS.CRD").expect("no CARDS.CRD");

    assert_eq!(&saved[..3], b"MGC");
    assert!(saved.windows(5).any(|text| text == b"Zebra"));
    assert!(saved.windows(10).any(|text| text == b"zebra body"));
}

/// Notepad's Find box has its focus back in its field after the "Cannot
/// find" box over it, its text as it was. The box is made hidden and made
/// active as its button is given the focus (`USER.EXE` seg1 `3899`,
/// `3514`), so the Find box is told while its focus is still in its field,
/// keeps that, and has it back as the box goes, by `SetFocus` alone (seg25
/// `03e3`; `hidfocus`). Made active only as it showed, the box had the focus
/// already and the Find box kept none; given the focus as it was made
/// active again, it gave it to its first control as the dialog manager
/// does, its text selected, and what was typed next took the place of what
/// was to be found.
#[test]
fn notepads_find_box_has_its_focus_back_after_cannot_find() {
    let Some(mut session) = started("NOTEPAD.EXE") else {
        return;
    };

    type_text(&mut session, "abc");
    press(&mut session, Some("Alt"), "KeyS", "s");
    press(&mut session, None, "KeyF", "f");
    frames(&mut session, 40);
    type_text(&mut session, "xyz");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 60);
    assert!(
        session
            .system()
            .windows
            .iter()
            .flatten()
            .any(|window| window.visible && window.title.contains("Cannot find")),
        "no Cannot find box"
    );

    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 60);

    let find = shown(&session, "Find").expect("no Find box");
    let focus = session.system().focus.expect("no focus");

    {
        let system = session.system();
        let window = system.windows[focus].as_ref().expect("a window");

        assert_eq!((window.parent, window.control_id), (Some(find), 0x480));
    }

    type_text(&mut session, "q");
    assert_eq!(text_of(&session, "Find", 0x480), "xyzq");
}

/// Whether a menu is open: a pop-up's window shows.
fn menu_open(session: &Session) -> bool {
    session
        .system()
        .windows
        .iter()
        .flatten()
        .any(|window| window.visible && window.popup.is_some())
}

/// A point in a window's system menu box: its top left, inside its sizing
/// frame.
fn system_box(session: &Session, title: &str) -> (i16, i16) {
    let at = shown(session, title).unwrap_or_else(|| panic!("no {title}"));
    let system = session.system();
    let window = system.windows[at].as_ref().unwrap();

    ((window.left + 12) as i16, (window.top + 12) as i16)
}

/// Program Manager's title.
fn progman_title(session: &Session) -> String {
    let at = shown(session, "Progman").expect("no Program Manager");

    session.system().windows[at].as_ref().unwrap().title.clone()
}

/// A group window's system menu, a document window's: opened by Alt and the
/// hyphen, by a click on its box, and by a click on a group's icon. None of
/// them opened it: the keys reached Program Manager's own menu, and a
/// child's box and icon asked for a menu USER had not given the child
/// (`USER.EXE` seg17 `00fe`, seg19 `04fb`, seg15 `0e48`; `mdisys`).
/// Maximized, its system menu is the first item of Program Manager's bar,
/// and the frame's title names it (seg20 `00fe`, seg15 `0000`).
#[test]
fn program_managers_group_system_menus_open() {
    let Some(mut session) = started("PROGMAN.EXE") else {
        return;
    };

    press(&mut session, Some("Alt"), "Minus", "-");
    assert!(menu_open(&session), "Alt and the hyphen opened nothing");
    press(&mut session, None, "Escape", "Escape");
    press(&mut session, None, "Escape", "Escape");
    assert!(!menu_open(&session));

    let (x, y) = system_box(&session, "Main");

    click(&mut session, x, y, false);
    assert!(menu_open(&session), "the box opened nothing");
    press(&mut session, None, "Escape", "Escape");
    press(&mut session, None, "Escape", "Escape");

    click(&mut session, 110, 325, false);
    assert!(menu_open(&session), "the icon opened nothing");
    press(&mut session, None, "Escape", "Escape");
    press(&mut session, None, "Escape", "Escape");
    assert!(!menu_open(&session));

    // Main maximized from its own system menu; then its menu is the bar's
    // first item, which Alt and the hyphen open, and Restore restores it.
    let main = shown(&session, "Main").expect("no Main");
    let hwnd = session.system().windows[main].as_ref().unwrap().hwnd;

    session.system().post_message(hwnd, 0x0112, 0xf030, 0);
    frames(&mut session, 60);
    assert_eq!(progman_title(&session), "Program Manager - [Main]");

    press(&mut session, Some("Alt"), "Minus", "-");
    assert!(
        menu_open(&session),
        "the maximized group's menu did not open"
    );
    press(&mut session, None, "KeyR", "r");
    frames(&mut session, 60);
    assert_eq!(progman_title(&session), "Program Manager");
}

/// Windows Help, opening Notepad's help, said "Unable to add button.": its
/// macros hand a button over by the handle `LocalHandle` finds for the
/// pointer of a block of its local heap, and `LocalHandle` answered nought
/// (`KRNL386.EXE` seg1 `8d6a`; `lochand`). Its seven `EnableMenuItem` calls
/// answering -1 are as in Windows: the commands are not in its menu
/// (`menuenab`).
#[test]
fn windows_help_opens_notepads_help_with_its_buttons() {
    let Some(mut session) = started("WINHELP.EXE") else {
        return;
    };

    press(&mut session, Some("Alt"), "KeyF", "f");
    press(&mut session, None, "KeyO", "o");
    frames(&mut session, 60);
    type_text(&mut session, "notepad.hlp");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 200);

    let system = session.system();
    let texts: Vec<String> = system
        .windows
        .iter()
        .flatten()
        .filter(|window| window.visible)
        .map(|window| window.title.clone())
        .collect();

    assert!(
        !texts.iter().any(|text| text == "Unable to add button."),
        "{texts:?}"
    );
    assert!(texts.iter().any(|text| text == "&Glossary"), "{texts:?}");
}
