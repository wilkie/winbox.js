//! `DDEML` is WinBox's own (`src/ddeml/`): its probes write what Windows
//! wrote with `DDEML.DLL` on the drive -- each import of an export linked to
//! WinBox's stub -- and with no `DDEML.DLL` on the drive at all. As
//! `test/win16/ddeml_test.ts`.

mod support;

use winbox_win16::Stop;

use support::{Setup, box_hand, recorded, run_setup};

/// The probes that talk through DDEML, each with the records it does not
/// yet agree on, as `test/oracle/replay.ts`'s `KNOWN_GAPS` has them.
const PROBES: &[(&str, &[&str])] = &[
    ("ddexact", &[]),
    ("ddemgmt", &[]),
    ("pmatom", &[]),
    ("ddeleft", &["owned", "DdeFreeStringHandle"]),
    ("progdde", &["files"]),
    ("ddeinst", &[]),
    ("ddefail", &[]),
    ("ddemon", &[]),
    ("ddeterm", &[]),
    ("ddelist", &[]),
    ("ddenest", &[]),
    ("ddeheap", &[]),
];

/// A probe run, with or without `DDEML.DLL` on the drive: how it stopped,
/// its records, and whether a library named `DDEML` was loaded from a file.
fn run_probe(name: &str, without: bool) -> Option<(Stop, Vec<[String; 3]>, bool)> {
    let mut setup = Setup::of(name)?;

    if without {
        setup.without = vec!["WINDOWS\\SYSTEM\\DDEML.DLL".to_string()];
    }

    let (stop, records, loaded) = run_setup(
        name,
        setup,
        |system| system.box_hand = Some(box_hand(name)),
        |system| {
            let engine = winbox_win16::Engine::new(system);
            let stop = engine.run(2_000_000_000, 300.0);
            let loaded = engine
                .system()
                .modules
                .iter()
                .any(|module| module.name == "DDEML");

            (stop, loaded)
        },
    );

    Some((stop, records, loaded))
}

/// The records held to Windows', but those of the functions named.
fn check(name: &str, records: Vec<[String; 3]>, gaps: &[&str]) {
    let Some(windows) = recorded(name) else {
        return;
    };
    let keep = |record: &[String; 3]| !gaps.contains(&record[0].as_str());
    let ours: Vec<_> = records.into_iter().filter(keep).collect();
    let theirs: Vec<_> = windows.into_iter().filter(keep).collect();

    assert_eq!(ours, theirs, "{name}");
}

#[test]
fn probes_agree_with_the_file() {
    for &(name, gaps) in PROBES {
        let Some((stop, records, _)) = run_probe(name, false) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        check(name, records, gaps);
    }
}

#[test]
fn probes_agree_with_no_file() {
    for &(name, gaps) in PROBES {
        let Some((stop, records, loaded)) = run_probe(name, true) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert!(!loaded, "{name}: a file of DDEML's was loaded");
        check(name, records, gaps);
    }
}
