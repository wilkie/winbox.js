//! What programs write kept, as the page keeps it: the drive's changes
//! against the drive as planned (`Session::changes`), told as the program
//! leaves them and put back on a machine made afresh, which tells them
//! the same before any program has run, and whose programs find them.
//!
//! The program is the oracle's `strings` probe, which writes what it found
//! to `C:\ORACLE\STRINGS.OUT`, where the oracle's build is here.

use std::path::{Path, PathBuf};

use winbox_machine::{Change, host_seconds, instant_ms};
use winbox_web::session::{Made, Session, State};

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
            assert!(session.add_folder('C', &named, 0));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), 0));
        }
    }
}

/// A machine as the page makes one: the installation on C:, the probe put
/// in `C:\ORACLE`, the drive marked as planned, and what was kept put
/// back, as the page puts it back.
fn machine(probe: &[u8], kept: &[Change]) -> Session {
    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: instant_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();
    hold(&mut session, &root().join("oracle/build/drive-c"), "");
    assert!(session.add_file('C', "ORACLE\\STRINGS.EXE", probe.to_vec(), 0));
    session.mark_planned();

    for change in kept {
        match change {
            Change::Removed { path } => assert!(session.remove('C', path)),
            Change::Folder { path, modified } => assert!(session.add_folder('C', path, *modified)),
            Change::File {
                path,
                data,
                modified,
            } => assert!(session.add_file('C', path, data.to_vec(), *modified)),
        }
    }

    session
}

/// The run stepped until the program has ended -- the run waits for the
/// next, or is over -- or ten seconds of the host's pass.
fn finish(session: &mut Session) {
    let deadline = instant_ms() + 10_000.0;

    loop {
        let state = session.step(instant_ms() + 10.0);

        session.take_calls(false);

        if matches!(state, State::Stopped | State::Waiting) || instant_ms() > deadline {
            return;
        }
    }
}

#[test]
fn what_a_program_writes_is_told_and_put_back() {
    let path = root().join("oracle/build/probes/STRINGS.EXE");
    let installed = root().join("oracle/build/drive-c/WINDOWS/SYSTEM/USER.EXE");
    let (true, Ok(probe)) = (installed.is_file(), std::fs::read(&path)) else {
        eprintln!("skipped: the oracle's build is not here");
        return;
    };

    let mut session = machine(&probe, &[]);

    // Nothing written before a program has run.
    assert_eq!(session.changes('C'), []);
    session.start("C:\\ORACLE\\STRINGS.EXE").unwrap();
    finish(&mut session);

    let changes = session.changes('C');
    let Some(Change::File { data, .. }) = changes
        .iter()
        .find(|change| change.path() == "ORACLE\\STRINGS.OUT")
    else {
        panic!("no STRINGS.OUT told: {changes:?}");
    };

    assert!(!data.is_empty());

    // The probe's own folder was planned: what it made in it is told, and
    // the folder, written then.
    assert!(changes.iter().all(|change| matches!(
        change,
        Change::File { path, .. } if path == "ORACLE\\STRINGS.OUT"
    ) || matches!(
        change,
        Change::Folder { path, .. } if path == "ORACLE"
    )));

    // Put back on a machine made afresh, they are told the same before any
    // program runs, and the next program finds the file as it was left.
    let mut again = machine(&probe, &changes);

    assert_eq!(again.changes('C'), changes);
    again.start("C:\\ORACLE\\STRINGS.EXE").unwrap();
    assert_eq!(
        again
            .system()
            .files
            .read_from("C:\\ORACLE", "STRINGS.OUT")
            .map(|(_, bytes)| bytes),
        Some(data.to_vec())
    );
    assert_eq!(again.changes('C'), changes);
}
