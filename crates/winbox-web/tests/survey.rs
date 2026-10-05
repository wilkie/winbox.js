//! A page's survey, its drives held in memory, reports what the trace
//! example's does on the host's folders: a probe, and the oracle's
//! installation beneath it, run both ways to the same report and the same
//! screens.

use std::path::{Path, PathBuf};

use winbox_machine::{HostDrive, host_seconds, instant_ms};
use winbox_ne::Executable;
use winbox_web::session::{Made, Session};
use winbox_win16::survey::{self, Survey};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// When a host's file or folder was last written, in seconds since 1970.
fn modified(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs() as i64)
}

/// A host's folder put on drive C: at `dos`, as the page puts it there:
/// each file and folder last written when the host's was, or at `at`.
fn hold(session: &mut Session, folder: &Path, dos: &str, at: Option<i64>) {
    for entry in std::fs::read_dir(folder).unwrap().flatten() {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());
        let when = at.unwrap_or_else(|| modified(&path));

        if path.is_dir() {
            assert!(session.add_folder('C', &named, when));
            hold(session, &path, &named, at);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), when));
        }
    }
}

/// A folder copied, as the trace example copies the program's.
fn copy_folder(folder: &Path, at: &Path) {
    std::fs::create_dir_all(at).unwrap();

    for entry in std::fs::read_dir(folder).unwrap().flatten() {
        let to = at.join(entry.file_name());

        if entry.file_type().unwrap().is_dir() {
            copy_folder(&entry.path(), &to);
        } else {
            std::fs::copy(entry.path(), to).unwrap();
        }
    }
}

/// The survey the corpus asks of the trace example, its screens kept.
fn asked() -> Survey {
    Survey {
        boxes: 3,
        screens: true,
        ..Survey::default()
    }
}

/// The trace example's survey: the program's folder copied onto a host's
/// folder, as `C:\PROBES`, over the installation.
fn traced(probes: &Path, windows: &Path, path: &str, run: &str) -> survey::Surveyed {
    let drive = std::env::temp_dir().join(format!("winbox-web-{run}-{}", std::process::id()));
    let asked = asked();
    let mut system = asked.system().unwrap();
    let file = probes.join(path.rsplit('\\').next().unwrap());

    copy_folder(probes, &drive.join("PROBES"));
    system
        .files
        .mount('C', HostDrive::over(drive.clone(), windows.to_path_buf()));
    survey::start(
        &mut system,
        Executable::parse(std::fs::read(file).unwrap()).unwrap(),
        path,
    )
    .unwrap();

    let surveyed = asked.run(system);

    std::fs::remove_dir_all(drive).unwrap();
    surveyed
}

#[test]
fn a_survey_in_memory_reports_as_the_trace_does() {
    let probes = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !probes.is_dir() || !windows.is_dir() {
        eprintln!("skipped: the oracle's build is not here");
        return;
    }

    for probe in ["STACKPOS", "FILECDR", "BTNCLICK"] {
        if !probes.join(format!("{probe}.EXE")).is_file() {
            continue;
        }

        let path = format!("C:\\PROBES\\{probe}.EXE");
        let traced = traced(&probes, &windows, &path, probe);
        let mut session = Session::new(Made {
            display: "vga",
            coprocessor: true,
            host: instant_ms,
            wall: host_seconds,
            epoch_ms: 0,
        })
        .unwrap();
        let now = host_seconds();

        hold(&mut session, &windows, "", None);
        assert!(session.add_folder('C', "PROBES", now));
        hold(&mut session, &probes, "PROBES", Some(now));

        let report = session.survey(&asked(), &path, None).unwrap();

        assert_eq!(report, traced.report, "{probe}");
        assert!(report.lines().count() > 5, "{probe}: {report}");

        let kept: Vec<_> = session.kept().iter().map(|kept| &kept.screen).collect();
        let screens: Vec<_> = traced.screens.iter().chain(&traced.boxes).collect();

        assert_eq!(kept, screens, "{probe}'s screens");
    }
}

#[test]
fn a_program_stepped_on_the_hosts_clock_is_shown_and_logged() {
    let probes = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !probes.join("STACKPOS.EXE").is_file() || !windows.is_dir() {
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

    hold(&mut session, &windows, "", None);
    assert!(session.add_file(
        'C',
        "STACKPOS.EXE",
        std::fs::read(probes.join("STACKPOS.EXE")).unwrap(),
        host_seconds()
    ));
    assert_eq!(
        session.step(f64::INFINITY),
        winbox_web::session::State::Waiting
    );
    session.start("C:\\STACKPOS.EXE").unwrap();

    let mut calls = String::new();
    let deadline = instant_ms() + 20_000.0;

    while session.stop().is_none() && instant_ms() < deadline {
        session.step(instant_ms() + 10.0);
        calls.push_str(&session.take_calls(false));
    }

    calls.push_str(&session.take_calls(false));

    assert!(calls.lines().count() > 5, "{calls}");
    assert!(calls.lines().all(|line| line.contains(" @")), "{calls}");

    let (width, height) = session.size();

    assert_eq!((width, height), (640, 480));
    assert_eq!(session.present().len(), width * height * 4);
    assert_eq!(session.shown().indices.len(), width * height);
}
