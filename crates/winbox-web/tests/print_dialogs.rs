//! COMMDLG's Print Setup dialog, as Windows' own programs open it:
//! Notepad's and Paintbrush's File menu's Print Setup..., with the printer
//! the `vgaprint` installation has -- an `Apple LaserWriter Plus` on `LPT1:`
//! with Windows' PostScript driver -- put on the drive and in `WIN.INI`, as
//! `prdlg` writes it. Each is run with `COMMDLG.DLL` on the drive, where the
//! dialog's code is WinBox's own, and with none, where everything is. As
//! `test/win16/print_dialogs_test.ts`.
//!
//! The host's time is the test's own, as in `moves.rs`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_web::session::{Made, Session, State};
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

const COMMDLG: &str = "\\WINDOWS\\SYSTEM\\COMMDLG.DLL";

/// The sizes the PostScript driver names, as COMMDLG names them.
const SIZES: [&str; 7] = [
    "Letter 8 1/2 x 11 in",
    "Letter Small 8 1/2 x 11 in",
    "Legal 8 1/2 x 14 in",
    "A4 210 x 297 mm",
    "A4 Small 210 x 297 mm",
    "B5 182 x 257 mm",
    "Note 8 1/2 x 11 in",
];

/// A host's folder put on drive C: at `dos`, in the order of the names,
/// but for the files `without` names, and with `WIN.INI` given the printer.
fn hold(session: &mut Session, folder: &Path, dos: &str, without: &[&str]) {
    let mut entries: Vec<_> = std::fs::read_dir(folder).unwrap().flatten().collect();

    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if without.iter().any(|gone| gone.eq_ignore_ascii_case(&named)) {
            continue;
        }

        if path.is_dir() {
            assert!(session.add_folder('C', &named, 0));
            hold(session, &path, &named, without);
        } else if named.eq_ignore_ascii_case("\\WINDOWS\\WIN.INI") {
            let text = String::from_utf8_lossy(&std::fs::read(&path).unwrap()).into_owned();

            assert!(session.add_file('C', &named, with_printer(&text).into_bytes(), 0));
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), 0));
        }
    }
}

/// `WIN.INI` with the printer, as `prdlg.c` writes it: the default, and
/// its line of `[devices]`.
fn with_printer(text: &str) -> String {
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if line.to_ascii_lowercase().starts_with("device=") {
                "device=Apple LaserWriter Plus,pscript,LPT1:".to_string()
            } else {
                line.to_string()
            }
        })
        .collect();

    lines.push("[devices]".to_string());
    lines.push("Apple LaserWriter Plus=pscript,LPT1:".to_string());
    lines.join("\r\n") + "\r\n"
}

/// A fresh machine, Windows staying up, the installation on C: with the
/// printer and its driver but for the files `without` names, and the
/// program named in `C:\WINDOWS` started; none where the oracle's build is
/// not here.
fn started(program: &str, without: &[&str]) -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");
    let driver = root().join("oracle/build/drive-c-vgaprint/WINDOWS/SYSTEM/PSCRIPT.DRV");

    if !windows.join("WINDOWS").join(program).is_file() || !driver.is_file() {
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
    hold(&mut session, &windows, "", without);
    assert!(session.add_file(
        'C',
        "\\WINDOWS\\SYSTEM\\PSCRIPT.DRV",
        std::fs::read(driver).ok()?,
        0
    ));
    session.mark_planned();
    session.start(&format!("C:\\WINDOWS\\{program}")).unwrap();
    frames(&mut session, 150);
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

/// A key pressed and let go, with Alt held where `alt`, and the run let
/// take it.
fn press(session: &mut Session, alt: bool, code: &str, name: &str) {
    if alt {
        session.key(true, &key("AltLeft", "Alt", true));
    }

    session.key(true, &key(code, name, alt));
    session.key(false, &key(code, name, alt));

    if alt {
        session.key(false, &key("AltLeft", "Alt", false));
    }

    frames(session, 40);
}

/// The first window shown with a title.
fn shown(session: &Session, named: &str) -> Option<usize> {
    let system = session.system();

    system.windows.iter().position(|window| {
        window.as_ref().is_some_and(|window| {
            window.visible && window.parent.is_none() && window.title == named
        })
    })
}

/// A control of the dialog as it shows: its text, its check, a combo box's
/// items.
#[derive(Debug, Clone, Default)]
struct Shown {
    text: String,
    checked: u16,
    items: Vec<String>,
}

/// The control with an identifier in the window shown with a title.
fn control(session: &Session, title: &str, id: u16) -> Shown {
    let parent = shown(session, title).unwrap_or_else(|| panic!("no window {title}"));
    let system = session.system();
    let window = system
        .windows
        .iter()
        .flatten()
        .find(|window| window.parent == Some(parent) && window.control_id == id)
        .unwrap_or_else(|| panic!("no control {id:x} in {title}"));
    let control = window.control.as_ref().expect("a control");
    // A combo box's items are its list's, a window of its own.
    let items = if window.class.eq_ignore_ascii_case("combobox") {
        system
            .windows
            .iter()
            .flatten()
            .filter_map(|list| list.control.as_ref())
            .find(|list| list.combo_hwnd == window.hwnd && !list.items.is_empty())
            .map(|list| list.items.clone())
            .unwrap_or_default()
    } else {
        control.items.clone()
    };

    Shown {
        text: control.text.clone(),
        checked: control.checked,
        items,
    }
}

/// Print Setup opened from the File menu by its keys.
fn open_setup(session: &mut Session) {
    press(session, true, "KeyF", "f");
    press(session, false, "KeyR", "r");
    frames(session, 60);
}

/// What Print Setup showed first, for the default printer on `LPT1:`.
fn check_first(session: &Session) {
    assert_eq!(
        control(session, "Print Setup", 0x440).text,
        "(currently Apple LaserWriter Plus on LPT1:)"
    );
    assert_eq!(control(session, "Print Setup", 0x422).checked, 1);
    assert_eq!(control(session, "Print Setup", 0x423).checked, 0);
    assert_eq!(
        control(session, "Print Setup", 0x470).items,
        ["Apple LaserWriter Plus on LPT1:"]
    );
    assert_eq!(control(session, "Print Setup", 0x420).checked, 1);
    assert_eq!(control(session, "Print Setup", 0x471).items, SIZES);
    assert_eq!(
        control(session, "Print Setup", 0x472).items,
        ["Upper Tray", "Manual Feed"]
    );
}

/// A program's Print Setup opened, Landscape chosen and OK pressed, then
/// opened again: Landscape is kept, as the program gives back the
/// `DEVMODE` Print Setup left.
fn setup_twice(program: &str, without: &[&str]) {
    let Some(mut session) = started(program, without) else {
        return;
    };

    open_setup(&mut session);
    assert_eq!(
        session.system().module_named("COMMDLG").is_some(),
        without.is_empty(),
        "COMMDLG's file loaded"
    );
    check_first(&session);
    press(&mut session, true, "KeyL", "l");
    press(&mut session, false, "Enter", "Enter");
    frames(&mut session, 60);
    assert!(
        shown(&session, "Print Setup").is_none(),
        "Print Setup stays"
    );
    open_setup(&mut session);
    assert_eq!(control(&session, "Print Setup", 0x421).checked, 1);
    assert_eq!(control(&session, "Print Setup", 0x420).checked, 0);
    press(&mut session, false, "Escape", "Escape");
    frames(&mut session, 60);
    assert!(
        shown(&session, "Print Setup").is_none(),
        "Print Setup stays"
    );
}

#[test]
fn notepads_print_setup_keeps_its_landscape() {
    setup_twice("NOTEPAD.EXE", &[]);
}

#[test]
fn notepads_print_setup_works_with_no_commdlg_file() {
    setup_twice("NOTEPAD.EXE", &[COMMDLG]);
}

#[test]
fn paintbrushs_print_setup_keeps_its_landscape() {
    setup_twice("PBRUSH.EXE", &[]);
}

#[test]
fn paintbrushs_print_setup_works_with_no_commdlg_file() {
    setup_twice("PBRUSH.EXE", &[COMMDLG]);
}
