//! Program Manager told by DDE, as an installer tells it, through WinBox's
//! own DDEML: Program Manager running, and a program -- the oracle's
//! `DDEINST.EXE` -- connecting to `PROGMAN` and sending `[CreateGroup]`, two
//! `[AddItem]`s and `[ShowGroup]`. The group's window shows, its file holds
//! its two items, and `PROGMAN.INI` names the file, with `DDEML.DLL` on the
//! drive and with none. As `test/win16/ddeml_test.ts`'s `ddeinst`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_machine::Change;
use winbox_web::session::{Made, Session, State};

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

/// Whether a window of this title is shown.
fn shown(session: &Session, title: &str) -> bool {
    session
        .system()
        .windows
        .iter()
        .flatten()
        .any(|window| window.visible && window.title == title)
}

/// A file as the run left it, where it wrote it.
fn written(session: &Session, path: &str) -> Option<String> {
    session
        .changes('C')
        .into_iter()
        .find_map(|change| match change {
            Change::File { path: at, data, .. } if at.eq_ignore_ascii_case(path) => {
                Some(String::from_utf8_lossy(&data).into_owned())
            }
            _ => None,
        })
}

/// The session: Program Manager started, then the installer.
fn installs(without: bool) {
    let windows = root().join("oracle/build/drive-c");
    let installer = root().join("oracle/build/probes/DDEINST.EXE");

    if !windows.join("WINDOWS").join("PROGMAN.EXE").is_file() || !installer.is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return;
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
    assert!(session.add_folder('C', "\\ORACLE", 0));
    assert!(session.add_file(
        'C',
        "\\WINDOWS\\DDEINST.EXE",
        std::fs::read(&installer).unwrap(),
        0
    ));
    session.mark_planned();

    if without {
        assert!(session.remove('C', "WINDOWS\\SYSTEM\\DDEML.DLL"));
    }

    session.start("C:\\WINDOWS\\PROGMAN.EXE").unwrap();
    frames(&mut session, 300);
    assert!(shown(&session, "Program Manager"));
    session.start("C:\\WINDOWS\\DDEINST.EXE").unwrap();

    // The installer runs to its end, which, as the oracle's programs do,
    // ends Windows (`probe.h`): the group's window is looked for as it runs.
    let mut seen = false;

    for _ in 0..2000 {
        let state = session.step(host_ms() + 10.0);

        seen |= shown(&session, "WinBox Games");

        if state == State::Stopped {
            break;
        }
    }

    assert_eq!(session.stop(), Some(&winbox_win16::Stop::Ended));
    assert!(seen, "the group's window");

    let group = written(&session, "WINDOWS\\WINBOXGA.GRP").unwrap_or_default();

    assert!(
        group.contains("Solitaire") && group.contains("Minesweeper"),
        "{group}"
    );

    let ini = written(&session, "WINDOWS\\PROGMAN.INI").unwrap_or_default();

    assert!(ini.contains("WINBOXGA.GRP"), "{ini}");

    let report = written(&session, "ORACLE\\DDEINST.OUT").unwrap_or_default();

    assert!(report.contains("1,0,8000"), "{report}");

    // With no file, no library of DDEML's was loaded from one.
    if without {
        assert!(
            !session
                .system()
                .modules
                .iter()
                .any(|module| module.name == "DDEML")
        );
    }
}

#[test]
fn an_installer_makes_its_group_through_winboxs_ddeml_with_the_file() {
    installs(false);
}

#[test]
fn an_installer_makes_its_group_through_winboxs_ddeml_with_no_file() {
    installs(true);
}
