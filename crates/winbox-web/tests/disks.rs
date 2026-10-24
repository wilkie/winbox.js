//! Disk and disc images on the page's drives (`Session::add_disk`), as its
//! Drives strip mounts them (`kb/topics/drives-and-disks.md`, "The page's
//! drives"): a set's first disk in its drive, the others put in in turn or
//! the drive emptied, what programs write to a floppy kept in its overlay
//! and given back as a new image, the image itself never written; and a
//! program run from a drive of images, that drive current.
//!
//! The images are the oracle's committed ones (`oracle/probes/images/`);
//! the programs that read them, the probes `imgflop` and `imgcd`, run where
//! the oracle's build is here.

use std::path::{Path, PathBuf};

use winbox_machine::{Files, host_seconds, instant_ms};
use winbox_web::session::{DiskKind, Made, Session, State};
use winbox_win16::Stop;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn image(name: &str) -> Vec<u8> {
    std::fs::read(root().join("oracle/probes/images").join(name)).unwrap()
}

fn session() -> Session {
    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: instant_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();
    session
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

/// A machine with the installation on C: and the probes named in
/// `C:\ORACLE`; none where the oracle's build is not here.
fn machine(programs: &[&str]) -> Option<Session> {
    let probes = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM/USER.EXE").is_file()
        || programs.iter().any(|name| !probes.join(name).is_file())
    {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

    let mut session = session();

    hold(&mut session, &windows, "");
    session.add_folder('C', "ORACLE", host_seconds());

    for name in programs {
        assert!(session.add_file(
            'C',
            &format!("ORACLE\\{name}"),
            std::fs::read(probes.join(name)).unwrap(),
            host_seconds()
        ));
    }

    Some(session)
}

/// The run stepped until every program has ended -- the probes end
/// Windows as they finish -- or ten seconds of the host's pass.
fn run_out(session: &mut Session) -> State {
    let deadline = instant_ms() + 10_000.0;

    loop {
        let state = session.step(instant_ms() + 10.0);

        session.take_calls(false);

        if matches!(state, State::Stopped | State::Waiting) || instant_ms() > deadline {
            return state;
        }
    }
}

/// A file as the programs have left it, by its folder and name.
fn file(session: &Session, folder: &str, name: &str) -> String {
    session
        .system()
        .files
        .read_from(folder, name)
        .map(|(_, bytes)| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

#[test]
fn a_set_is_of_one_kind_c_is_the_pages_and_a_hard_disk_is_alone() {
    let mut session = session();

    session.drive('C');

    assert_eq!(
        session.add_disk('A', image("imgflop.img"), DiskKind::Floppy),
        Ok(0)
    );
    assert_eq!(
        session.add_disk('a', image("imgwrite.img"), DiskKind::Floppy),
        Ok(1)
    );
    assert!(
        session
            .add_disk('A', image("imgcd.iso"), DiskKind::Iso)
            .is_err()
    );
    assert!(
        session
            .add_disk('C', image("imgcd.iso"), DiskKind::Iso)
            .is_err()
    );
    assert_eq!(
        session.add_disk('E', image("imgcd.iso"), DiskKind::Iso),
        Ok(0)
    );
    assert!(
        session
            .add_disk('D', image("imgcd.iso"), DiskKind::Floppy)
            .is_err(),
        "a disc is no FAT image"
    );
    assert_eq!(
        session.add_disk('D', image("imghdd.img"), DiskKind::Hdd),
        Ok(0)
    );
    assert!(
        session
            .add_disk('D', image("imghdd.img"), DiskKind::Hdd)
            .is_err()
    );
    assert!(
        session.insert_disk('D', 0).is_err(),
        "a hard disk is not swapped"
    );
    assert!(
        session.eject_disk('D').is_err(),
        "a hard disk is not taken out"
    );
    assert!(session.insert_disk('A', 2).is_err());

    // Before a program starts the set is the page's alone: swapped and
    // emptied, and nothing written.
    assert_eq!(session.insert_disk('A', 1), Ok(()));
    assert_eq!(session.eject_disk('A'), Ok(()));
    assert!(!session.disk_changed('A', 0));
    assert_eq!(session.disk_image('A', 1), Some(image("imgwrite.img")));
    assert_eq!(session.disk_image('E', 0), None, "a disc is not written");
    assert!(session.remove_disks('E'));
    assert!(!session.remove_disks('E'));
}

#[test]
fn a_probe_reads_the_floppy_and_the_disc_and_writes_the_floppys_overlay_alone() {
    let Some(mut session) = machine(&["IMGFLOP.EXE", "IMGCD.EXE"]) else {
        return;
    };
    let floppy = image("imgflop.img");

    session
        .add_disk('A', floppy.clone(), DiskKind::Floppy)
        .unwrap();
    session
        .add_disk('A', image("imgwrite.img"), DiskKind::Floppy)
        .unwrap();
    session
        .add_disk('D', image("imgcd.iso"), DiskKind::Iso)
        .unwrap();

    session.start("C:\\ORACLE\\IMGFLOP.EXE").unwrap();
    assert_eq!(run_out(&mut session), State::Stopped);
    assert_eq!(session.stop(), Some(&Stop::Ended));

    let records = file(&session, "C:\\ORACLE", "IMGFLOP.OUT");

    assert!(
        records.contains("A: 0\tREADME.TXT 20 39 1a85 30e4"),
        "{records}"
    );

    // What it wrote is the overlay's: the image given back as written
    // differs from the one mounted, which is as it was.
    assert!(session.disk_changed('A', 0));
    assert_ne!(session.disk_image('A', 0).unwrap(), floppy);
    assert!(!session.disk_changed('A', 1));

    // Swapped while Windows is up: the other disk in A:, the first kept
    // out of the drive as it was written, and put back so.
    let written = session.disk_image('A', 0).unwrap();

    session.insert_disk('A', 1).unwrap();
    assert!(session.system().files.read_from("A:\\", "NOEXT").is_some());
    assert_eq!(session.disk_image('A', 0).unwrap(), written);
    session.eject_disk('A').unwrap();
    assert!(!session.system().files.has_disk('A'));
    session.insert_disk('A', 0).unwrap();
    assert!(
        session
            .system()
            .files
            .read_from("A:\\", "README.TXT")
            .is_some()
    );

    // Taken away, the drive is no more.
    assert!(session.remove_disks('D'));
    assert!(!session.system().files.mounted('D'));

    // The disc, read by its probe on a machine of its own.
    let mut session = machine(&["IMGCD.EXE"]).unwrap();

    session
        .add_disk('D', image("imgcd.iso"), DiskKind::Iso)
        .unwrap();
    session.start("C:\\ORACLE\\IMGCD.EXE").unwrap();
    assert_eq!(run_out(&mut session), State::Stopped);

    let records = file(&session, "C:\\ORACLE", "IMGCD.OUT");

    assert!(records.contains("D: 0\tA_VERY_L.TEX"), "{records}");
}

#[test]
fn a_program_on_a_floppy_runs_from_it_its_drive_current() {
    let probes = root().join("oracle/build/probes");
    let Ok(program) = std::fs::read(probes.join("IMGFLOP.EXE")) else {
        eprintln!("skipped: the oracle's build is not here");
        return;
    };
    let Some(mut session) = machine(&[]) else {
        return;
    };

    // The probe put on a floppy, in a folder, as DOS would write it.
    let mut drive = Files::new();

    drive.mount(
        'A',
        winbox_machine::FatVolume::new(image("imgwrite.img"), true).unwrap(),
    );
    assert!(drive.make_directory('A', &[String::new()], "PROBE"));

    let handle = drive.create("A:\\PROBE\\IMGFLOP.EXE").unwrap();

    drive.resolve(handle).unwrap().write(&program);
    drive.close(handle);

    session
        .add_disk('A', drive.image('A').unwrap(), DiskKind::Floppy)
        .unwrap();
    session.start("A:\\PROBE\\IMGFLOP.EXE").unwrap();
    assert_eq!(session.system().files.drive, 'A');
    assert_eq!(session.system().files.current('A'), "A:\\PROBE\\");
    assert_eq!(run_out(&mut session), State::Stopped);
    assert_eq!(session.stop(), Some(&Stop::Ended));
    assert!(file(&session, "C:\\ORACLE", "IMGFLOP.OUT").contains("A: 0\t"));
}

#[test]
fn a_cue_sheet_is_a_disc_its_files_found_by_the_page() {
    let mut session = session();
    let files = |name: &str| {
        std::fs::read(root().join("oracle/probes/images").join(name))
            .ok()
            .map(|bytes| Box::new(bytes) as Box<dyn winbox_machine::Sectors>)
    };

    // Refused, and the file named, where the page has not its files.
    let refused = session
        .add_image(
            'D',
            Box::new(image("imgtrk.cue")),
            DiskKind::Iso,
            &mut |_| None,
        )
        .unwrap_err();

    assert!(refused.contains("line 4: imgcd.bin not found"), "{refused}");
    assert_eq!(
        session.add_image(
            'D',
            Box::new(image("imgtrk.cue")),
            DiskKind::Iso,
            &mut |name| { files(name) }
        ),
        Ok(0)
    );

    // A raw image alone is a disc too.
    assert_eq!(
        session.add_disk('E', image("imgcd.bin"), DiskKind::Iso),
        Ok(0)
    );
}
