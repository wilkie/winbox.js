//! COMMDLG's Font dialog, `ChooseFont`, as Windows 3.1's own programs open
//! it -- Write's Character ▸ Fonts, Paintbrush's Text ▸ Fonts, File
//! Manager's Options ▸ Font and Clock's Settings ▸ Set Font -- used as a
//! person at the page uses it, with `COMMDLG.DLL` on the drive and without
//! it, when WinBox's own `ChooseFont` runs alone. As
//! `test/win16/font_accessories_test.ts`.
//!
//! The host's time is the test's own, as in `accessories.rs`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_machine::Change;
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

/// A fresh machine, Windows staying up, the installation on C: -- without
/// `COMMDLG.DLL` where `without` -- and the program named in `C:\WINDOWS`
/// started; none where the oracle's build is not here.
fn started(program: &str, without: bool) -> Option<Session> {
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

    if without {
        session.remove('C', "WINDOWS\\SYSTEM\\COMMDLG.DLL");
    }

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

/// The key a character is typed with, and what it types.
fn key_of(character: char) -> (String, String) {
    match character {
        'a'..='z' => (
            format!("Key{}", character.to_ascii_uppercase()),
            character.to_string(),
        ),
        '0'..='9' => (format!("Digit{character}"), character.to_string()),
        ' ' => ("Space".into(), " ".into()),
        '.' => ("Period".into(), ".".into()),
        '\\' => ("Backslash".into(), "\\".into()),
        _ => panic!("no key for {character:?}"),
    }
}

/// Text typed, a key at a time.
fn type_text(session: &mut Session, text: &str) {
    for character in text.chars() {
        let (code, name) = key_of(character);

        session.key(true, &key(&code, &name, false));
        session.key(false, &key(&code, &name, false));
        frames(session, 3);
    }

    frames(session, 20);
}

/// A key pressed and let go, with Alt held where asked, and the run let
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

/// A letter pressed with Alt held, or alone.
fn letter(session: &mut Session, alt: bool, character: char) {
    let (code, name) = key_of(character);

    press(session, alt, &code, &name);
}

/// The texts of the Font dialog's three boxes -- the face, the style and
/// the size -- or none with no dialog of that title.
fn boxes(session: &Session, title: &str) -> Option<Vec<String>> {
    let system = session.system();
    let dialog = system.windows.iter().position(|window| {
        window.as_ref().is_some_and(|window| {
            window.visible && window.title == title && window.parent.is_none()
        })
    })?;

    Some(
        system
            .windows
            .iter()
            .flatten()
            .filter(|window| {
                window.class.eq_ignore_ascii_case("edit")
                    && window
                        .parent
                        .and_then(|combo| system.windows.get(combo)?.as_ref())
                        .is_some_and(|combo| combo.parent == Some(dialog))
            })
            .map(|window| {
                window
                    .control
                    .as_ref()
                    .map_or_else(|| window.title.clone(), |control| control.text.clone())
            })
            .collect(),
    )
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

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(ToString::to_string).collect()
}

/// Write's Character ▸ Fonts with COMMDLG.DLL on the drive: WinBox's own
/// `ChooseFont`, the face typed whole and chosen (`CBN_EDITUPDATE` and
/// COMMDLG's posted 5F5h), OK, and the text typed after it saved in that
/// face.
#[test]
fn writes_fonts_chooses_a_face_and_saves_the_text_in_it() {
    let Some(mut session) = started("WRITE.EXE", false) else {
        return;
    };

    letter(&mut session, true, 'c');
    letter(&mut session, false, 'f');
    frames(&mut session, 60);
    assert_eq!(
        boxes(&session, "Font"),
        Some(strings(&["Arial", "Regular", "10"]))
    );
    letter(&mut session, true, 'f');
    type_text(&mut session, "times new roman");
    frames(&mut session, 60);
    assert_eq!(
        boxes(&session, "Font"),
        Some(strings(&["Times New Roman", "Regular", "10"]))
    );
    press(&mut session, false, "Enter", "Enter");
    frames(&mut session, 60);
    assert_eq!(boxes(&session, "Font"), None);
    type_text(&mut session, "hello");
    letter(&mut session, true, 'f');
    letter(&mut session, false, 'a');
    frames(&mut session, 60);
    type_text(&mut session, "\\doc.wri");
    press(&mut session, false, "Enter", "Enter");
    frames(&mut session, 100);

    let saved = written(&session, "DOC.WRI").expect("no DOC.WRI");

    assert!(saved.windows(15).any(|text| text == b"Times New Roman"));
    assert!(saved.windows(5).any(|text| text == b"hello"));
}

/// A program's font chosen with no COMMDLG.DLL on the drive -- WinBox's
/// `ChooseFont` alone, its template, strings and pictures its own -- and
/// the dialog opened again showing what the program kept.
fn chooses_without_commdlg(program: &str, menu: char, face: &str, before: &[&str], after: &[&str]) {
    let Some(mut session) = started(program, true) else {
        return;
    };

    letter(&mut session, true, menu);
    letter(&mut session, false, 'f');
    frames(&mut session, 60);
    assert_eq!(boxes(&session, "Font"), Some(strings(before)));
    letter(&mut session, true, 'f');
    type_text(&mut session, face);
    frames(&mut session, 60);
    assert_eq!(
        boxes(&session, "Font").and_then(|boxes| boxes.first().cloned()),
        Some(after[0].to_string())
    );
    press(&mut session, false, "Enter", "Enter");
    frames(&mut session, 60);
    assert_eq!(boxes(&session, "Font"), None);
    letter(&mut session, true, menu);
    letter(&mut session, false, 'f');
    frames(&mut session, 60);
    assert_eq!(boxes(&session, "Font"), Some(strings(after)));
    press(&mut session, false, "Escape", "Escape");
    frames(&mut session, 60);
    assert_eq!(boxes(&session, "Font"), None);
}

#[test]
fn paintbrushs_fonts_work_with_no_commdlg_file() {
    chooses_without_commdlg(
        "PBRUSH.EXE",
        't',
        "arial",
        &["System", "Bold", "12"],
        &["Arial", "Bold", "12"],
    );
}

#[test]
fn file_managers_font_works_with_no_commdlg_file() {
    chooses_without_commdlg(
        "WINFILE.EXE",
        'o',
        "courier new",
        &["MS Sans Serif", "Regular", "8"],
        &["Courier New", "Regular", "8"],
    );
}

#[test]
fn clocks_set_font_works_with_no_commdlg_file() {
    chooses_without_commdlg(
        "CLOCK.EXE",
        's',
        "times new roman",
        &["Arial", "Regular", "16"],
        &["Times New Roman", "Regular", "16"],
    );
}
