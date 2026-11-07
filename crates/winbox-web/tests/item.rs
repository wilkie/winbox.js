//! A group's item started as the page's launcher starts it
//! (`Session::start_item`, `kb/guides/launcher.md`): the program given the
//! command line, current directory and show command Program Manager gives
//! it, first and beside a program running. The program is the `pmitem`
//! probe's own child, `PMITEMC.EXE`, which writes what it was given to
//! `C:\ORACLE\PMITEM.TXT`; each line is the one `pmitem` recorded under
//! Windows for the same item (`oracle/fixtures/pmitem.json`).

use std::path::{Path, PathBuf};

use winbox_machine::{host_seconds, instant_ms};
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
            assert!(session.add_folder('C', &named, host_seconds()));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), host_seconds()));
        }
    }
}

/// What the child has written.
fn log(session: &Session) -> String {
    session
        .system()
        .files
        .read_from("C:\\ORACLE", "PMITEM.TXT")
        .map(|(_, bytes)| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// The run stepped until the child has written `lines` lines, or ten
/// seconds of the host's pass.
fn step_until(session: &mut Session, lines: usize) {
    let deadline = instant_ms() + 10_000.0;

    while log(session).lines().count() < lines && instant_ms() < deadline {
        if session.step(instant_ms() + 10.0) == State::Stopped {
            break;
        }
    }
}

#[test]
fn items_are_given_their_command_line_directory_and_show_command() {
    let probes = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !probes.join("PMITEMC.EXE").is_file() || !windows.join("WINDOWS/WIN.INI").is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return;
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
    assert!(session.add_folder('C', "ORACLE", host_seconds()));
    assert!(session.add_folder('C', "ORACLE\\PMDIR", host_seconds()));
    assert!(session.add_file(
        'C',
        "WINDOWS\\PMITEMC.EXE",
        std::fs::read(probes.join("PMITEMC.EXE")).unwrap(),
        host_seconds()
    ));

    let child = "C:\\WINDOWS\\PMITEMC.EXE";

    // The first program of the run, then each beside it, as `pmitem`'s
    // items: its arguments, a working directory, the same in lower case
    // (the launcher makes it upper case, as Program Manager does), and
    // one minimized.
    session
        .start_item(child, "one two", "C:\\WINDOWS", 1)
        .unwrap();
    step_until(&mut session, 1);
    session
        .start_item(child, "dir", "C:\\ORACLE\\PMDIR", 1)
        .unwrap();
    step_until(&mut session, 2);
    session
        .start_item(child, "Low Case", "C:\\ORACLE\\PMDIR", 1)
        .unwrap();
    step_until(&mut session, 3);
    session.start_item(child, "min", "C:\\WINDOWS", 7).unwrap();
    step_until(&mut session, 4);

    assert_eq!(
        log(&session),
        "args=one two|cwd=C:\\WINDOWS|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=dir|cwd=C:\\ORACLE\\PMDIR|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=Low Case|cwd=C:\\ORACLE\\PMDIR|show=1|path=C:\\WINDOWS\\PMITEMC.EXE\r\n\
         args=min|cwd=C:\\WINDOWS|show=7|path=C:\\WINDOWS\\PMITEMC.EXE\r\n"
    );
}
