//! Notepad's File Open, COMMDLG.DLL's own dialog from the installation, used
//! as a person at the page uses it: a directory double-clicked to go into
//! it, a file clicked to take its name, the drives' list dropped and a drive
//! chosen, and the keyboard moving between the controls.
//!
//! None of it once answered but the file list: a press moved the focus
//! itself, as it was taken, without `WM_KILLFOCUS` or `WM_SETFOCUS`, so the
//! list box pressed found it had the focus already and told no one --
//! COMMDLG's directory list draws its selection only while it has the
//! focus -- and USER's own classes had no style, so no list box was sent
//! `WM_LBUTTONDBLCLK` and no directory could be gone into. USER registers
//! `ListBox` with `CS_DBLCLKS` (`USER.EXE` seg3 `171d`).
//!
//! Media Player's File Open is the same dialog with a hook of Media
//! Player's, which enables the file controls for the type of file chosen
//! from its own table of devices (`MPLAYER.EXE` seg2 `023c`). Media Player
//! is linked with a single data segment, and winbox.js left its exported
//! hook's prologue as `mov ax, ds` and gave it no thunk: called by
//! `COMMDLG`, it read `COMMDLG`'s data as its table, and disabled the
//! names, both lists and the drives, so that nothing in the dialog
//! answered a click. KERNEL counts every program as having multiple data
//! (`KRNL386.EXE` seg2 `17ee`); `solodata` and `mplopen` recorded it.
//!
//! The host's time is the test's own, as in `moves.rs`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_machine::host_seconds;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
}

/// Where Notepad is started, and so where the dialog opens: as the
/// TypeScript engine's test puts it (`test/win16/file_dialogs_test.ts`).
const NOTEPAD: &str = "C:\\CORPUS\\NOTEPAD\\NOTEPAD.EXE";

/// The dialog's controls (`COMMDLG.DLL`'s template): the file name, the
/// files, the directories, the directory's name and the drives.
const EDT1: u16 = 0x480;
const LST1: u16 = 0x460;
const LST2: u16 = 0x461;
const STC1: u16 = 0x440;
const CMB2: u16 = 0x471;

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

/// A fresh machine, Windows staying up, the installation on C: and Notepad
/// in a folder of its own, the root's folders those of the TypeScript
/// engine's drive: `CORPUS`, `ORACLE` and `WINDOWS`. Notepad started, and
/// its File Open dialog opened from the keyboard. None where the oracle's
/// build is not here.
fn opened() -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");
    let notepad = windows.join("WINDOWS/NOTEPAD.EXE");

    if !notepad.is_file() || !windows.join("WINDOWS/SYSTEM/COMMDLG.DLL").is_file() {
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

    for folder in ["\\CORPUS", "\\CORPUS\\NOTEPAD", "\\ORACLE"] {
        assert!(session.add_folder('C', folder, 0));
    }

    assert!(session.add_file('C', &NOTEPAD[2..], std::fs::read(notepad).unwrap(), 0));
    session.start(NOTEPAD).unwrap();
    frames(&mut session, 250);

    session.key(true, &key("AltLeft", "Alt", true));
    session.key(true, &key("KeyF", "f", true));
    session.key(false, &key("KeyF", "f", true));
    session.key(false, &key("AltLeft", "Alt", false));
    frames(&mut session, 30);
    press(&mut session, "KeyO", "o");
    frames(&mut session, 200);
    Some(session)
}

/// Where Media Player is started, and so where its dialog opens.
const MPLAYER: &str = "C:\\CORPUS\\MPLAYER\\MPLAYER.EXE";

/// Half a second of 440 Hz at 11,025 samples a second, as an 8-bit wave
/// file, as the page's test makes it (`e2e/run.spec.ts`).
fn tone() -> Vec<u8> {
    const COUNT: u32 = 5512;

    let mut data = Vec::new();

    data.extend_from_slice(b"RIFF");
    data.extend_from_slice(&(36 + COUNT).to_le_bytes());
    data.extend_from_slice(b"WAVEfmt ");
    data.extend_from_slice(&16_u32.to_le_bytes());
    data.extend_from_slice(&1_u16.to_le_bytes());
    data.extend_from_slice(&1_u16.to_le_bytes());
    data.extend_from_slice(&11025_u32.to_le_bytes());
    data.extend_from_slice(&11025_u32.to_le_bytes());
    data.extend_from_slice(&1_u16.to_le_bytes());
    data.extend_from_slice(&8_u16.to_le_bytes());
    data.extend_from_slice(b"data");
    data.extend_from_slice(&COUNT.to_le_bytes());

    for at in 0..COUNT {
        let wave = (2.0 * std::f64::consts::PI * 440.0 * f64::from(at) / 11025.0).sin();

        data.push((128.0 + 100.0 * wave).round() as u8);
    }

    data
}

/// A fresh machine as `opened` makes it, with WinBox's sound card, Media
/// Player in a folder of its own and a sound in `C:\SOUNDS`. Media Player
/// started, and its File Open opened from the keyboard. None where the
/// oracle's build is not here.
fn media_player() -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");
    let mplayer = windows.join("WINDOWS/MPLAYER.EXE");

    if !mplayer.is_file() || !windows.join("WINDOWS/SYSTEM/COMMDLG.DLL").is_file() {
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

    for folder in ["\\CORPUS", "\\CORPUS\\MPLAYER", "\\ORACLE", "\\SOUNDS"] {
        assert!(session.add_folder('C', folder, 0));
    }

    assert!(session.add_file('C', "\\SOUNDS\\TONE.WAV", tone(), 0));
    assert!(session.add_file('C', &MPLAYER[2..], std::fs::read(mplayer).unwrap(), 0));
    assert!(session.install_sound());
    session.start(MPLAYER).unwrap();
    frames(&mut session, 250);

    session.key(true, &key("AltLeft", "Alt", true));
    session.key(true, &key("KeyF", "f", true));
    session.key(false, &key("KeyF", "f", true));
    session.key(false, &key("AltLeft", "Alt", false));
    frames(&mut session, 30);
    press(&mut session, "KeyO", "o");
    frames(&mut session, 200);
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

fn key(code: &str, name: &str, alt: bool) -> Key {
    Key {
        code: code.to_string(),
        key: name.to_string(),
        repeat: false,
        alt,
    }
}

/// A key pressed and let go, and the run let take it.
fn press(session: &mut Session, code: &str, name: &str) {
    session.key(true, &key(code, name, false));
    session.key(false, &key(code, name, false));
    frames(session, 40);
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

/// The window shown of the dialog's with a control's identifier, by its
/// index.
fn control(session: &Session, id: u16) -> Option<usize> {
    let system = session.system();
    let dialog = system.windows.iter().position(|window| {
        window
            .as_ref()
            .is_some_and(|window| window.visible && window.title == "Open")
    })?;

    system.windows.iter().position(|window| {
        window
            .as_ref()
            .is_some_and(|window| window.parent == Some(dialog) && window.control_id == id)
    })
}

/// A control's text: an edit control's, or a static's.
fn text(session: &Session, id: u16) -> String {
    let at = control(session, id).expect("the control");
    let system = session.system();
    let window = system.windows[at].as_ref().unwrap();

    window
        .control
        .as_ref()
        .map_or_else(|| window.title.clone(), |control| control.text.clone())
}

/// A list box's items.
fn items(session: &Session, id: u16) -> Vec<String> {
    let at = control(session, id).expect("the list");
    let system = session.system();

    system.windows[at]
        .as_ref()
        .unwrap()
        .control
        .as_ref()
        .unwrap()
        .items
        .clone()
}

/// Whether the window with the focus is the list, and whether the list was
/// told so (`WM_SETFOCUS`).
fn focused(session: &Session, id: u16) -> (bool, bool) {
    let at = control(session, id).expect("the list");
    let system = session.system();
    let told = system.windows[at]
        .as_ref()
        .unwrap()
        .control
        .as_ref()
        .and_then(|control| control.list.as_ref())
        .is_some_and(|list| list.focused);

    (system.focus == Some(at), told)
}

/// The middle of a row of a list box, its rows `height` high.
fn row(session: &Session, id: u16, item: usize, height: i32) -> (i16, i16) {
    let at = control(session, id).expect("the list");
    let system = session.system();
    let window = system.windows[at].as_ref().unwrap();
    let x = window.left + window.client.left + 30;
    let y = window.top + window.client.top + height * item as i32 + height / 2;

    (x as i16, y as i16)
}

/// A directory of the list, gone into by a double click on it.
fn into(session: &mut Session, name: &str) {
    let item = items(session, LST2)
        .iter()
        .position(|item| item == name)
        .unwrap_or_else(|| panic!("no {name} in {:?}", items(session, LST2)));
    let (x, y) = row(session, LST2, item, 16);

    click(session, x, y, true);
}

/// Whether a control of the dialog's is enabled.
fn enabled(session: &Session, id: u16) -> bool {
    const WS_DISABLED: u32 = 0x0800_0000;

    let at = control(session, id).expect("the control");

    session.system().windows[at].as_ref().unwrap().style & WS_DISABLED == 0
}

/// Whether a window of a class shows.
fn showing(session: &Session, class: &str) -> bool {
    session
        .system()
        .windows
        .iter()
        .flatten()
        .any(|window| window.visible && window.class == class)
}

#[test]
fn a_directory_double_clicked_is_gone_into_and_a_file_clicked_is_opened() {
    let Some(mut session) = opened() else {
        return;
    };

    assert_eq!(text(&session, STC1), "c:\\corpus\\notepad");
    assert_eq!(items(&session, LST2), ["C:\\", "CORPUS", "NOTEPAD"]);
    assert!(items(&session, LST1).is_empty());

    into(&mut session, "C:\\");
    assert_eq!(text(&session, STC1), "c:\\");
    assert_eq!(
        items(&session, LST2),
        ["C:\\", "CORPUS", "ORACLE", "WINDOWS"]
    );
    // Pressed, the list took the focus, and was told so.
    assert_eq!(focused(&session, LST2), (true, true));

    into(&mut session, "WINDOWS");
    assert_eq!(text(&session, STC1), "c:\\windows");
    assert_eq!(items(&session, LST1), ["BOOTLOG.TXT", "SETUP.TXT"]);

    // A file clicked gives the edit its name.
    let (x, y) = row(&session, LST1, 1, 13);

    click(&mut session, x, y, false);
    assert_eq!(text(&session, EDT1), "setup.txt");

    press(&mut session, "Enter", "Enter");
    frames(&mut session, 100);
    assert!(control(&session, LST1).is_none(), "the dialog is still up");
    assert!(
        session
            .system()
            .windows
            .iter()
            .flatten()
            .any(|window| window.visible && window.title == "Notepad - SETUP.TXT")
    );
}

#[test]
fn the_keys_move_between_the_controls_and_go_into_a_directory() {
    let Some(mut session) = opened() else {
        return;
    };

    // From the file name, to the files, to the directories.
    press(&mut session, "Tab", "Tab");
    assert_eq!(focused(&session, LST1), (true, true));
    press(&mut session, "Tab", "Tab");
    assert_eq!(focused(&session, LST2), (true, true));

    // Up from `notepad` to `corpus`, and Enter goes into it.
    press(&mut session, "ArrowUp", "ArrowUp");
    press(&mut session, "Enter", "Enter");
    assert_eq!(text(&session, STC1), "c:\\corpus");
    assert_eq!(items(&session, LST2), ["C:\\", "CORPUS", "NOTEPAD"]);
    assert!(control(&session, LST1).is_some(), "the dialog was closed");
}

#[test]
fn the_drives_list_drops_and_a_drive_is_chosen_from_it() {
    let Some(mut session) = opened() else {
        return;
    };

    into(&mut session, "C:\\");
    assert_eq!(text(&session, STC1), "c:\\");

    // The button at the drives' right, pressed: the list drops below.
    let (x, y) = {
        let at = control(&session, CMB2).expect("the drives");
        let system = session.system();
        let window = system.windows[at].as_ref().unwrap();

        (
            (window.left + window.width - 8) as i16,
            (window.top + window.height / 2) as i16,
        )
    };

    click(&mut session, x, y, false);

    let (left, top) = session
        .system()
        .windows
        .iter()
        .flatten()
        .find(|window| window.visible && window.class == "ComboLBox")
        .map(|window| (window.left, window.top))
        .expect("the drives' list dropped");

    // `c:` chosen: the list goes, and the directory is C:'s current one,
    // where COMMDLG went as it went into the root.
    click(&mut session, (left + 30) as i16, (top + 8) as i16, false);
    assert!(!showing(&session, "ComboLBox"));
    assert_eq!(text(&session, STC1), "c:\\");
    assert_eq!(
        items(&session, LST2),
        ["C:\\", "CORPUS", "ORACLE", "WINDOWS"]
    );
}

#[test]
fn media_players_dialog_goes_into_a_directory_and_opens_a_sound() {
    let Some(mut session) = media_player() else {
        return;
    };

    // Media Player's hook has left the controls enabled for all files, its
    // types' list's choice as it opens (`mplopen`).
    for id in [0x442, EDT1, LST1, LST2, STC1, CMB2] {
        assert!(enabled(&session, id), "{id:x} is disabled");
    }

    assert_eq!(text(&session, STC1), "c:\\corpus\\mplayer");
    assert_eq!(items(&session, LST2), ["C:\\", "CORPUS", "MPLAYER"]);

    into(&mut session, "C:\\");
    assert_eq!(focused(&session, LST2), (true, true));
    into(&mut session, "SOUNDS");
    assert_eq!(text(&session, STC1), "c:\\sounds");
    assert_eq!(items(&session, LST1), ["TONE.WAV"]);

    let (x, y) = row(&session, LST1, 0, 13);

    click(&mut session, x, y, false);
    assert_eq!(text(&session, EDT1), "tone.wav");

    press(&mut session, "Enter", "Enter");
    frames(&mut session, 200);
    assert!(control(&session, LST1).is_none(), "the dialog is still up");
    assert!(
        session
            .system()
            .windows
            .iter()
            .flatten()
            .any(|window| window.visible && window.title == "Media Player - TONE.WAV (stopped)")
    );
}

#[test]
fn media_players_dialog_takes_the_keys() {
    let Some(mut session) = media_player() else {
        return;
    };

    // From the file name, to the files, to the directories.
    press(&mut session, "Tab", "Tab");
    assert_eq!(focused(&session, LST1), (true, true));
    press(&mut session, "Tab", "Tab");
    assert_eq!(focused(&session, LST2), (true, true));

    // Up from `mplayer` to `corpus`, and Enter goes into it.
    press(&mut session, "ArrowUp", "ArrowUp");
    press(&mut session, "Enter", "Enter");
    assert_eq!(text(&session, STC1), "c:\\corpus");
    assert!(control(&session, LST1).is_some(), "the dialog was closed");
}
