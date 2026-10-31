//! `OLESVR` is WinBox's own (`src/olesvr/`): its probes write what Windows
//! wrote with `OLESVR.DLL` on the drive -- each import of an export linked
//! to WinBox's stub -- and with no `OLESVR.DLL` on the drive at all; and
//! Paintbrush's with neither `OLESVR.DLL` nor `OLECLI.DLL`. As
//! `test/win16/olesvr_test.ts`.

mod support;

use winbox_win16::Stop;

use support::{Setup, box_hand, recorded, run_setup};

const OLESVR_DLL: &str = "WINDOWS\\SYSTEM\\OLESVR.DLL";

/// The probes of `OLESVR`.
const PROBES: &[&str] = &["olesrv", "olepbr"];

/// A probe run, with or without `OLESVR.DLL` on the drive: how it stopped,
/// its records, and whether a library named `OLESVR` was loaded from a
/// file.
fn run_probe(name: &str, without: &[&str]) -> Option<(Stop, Vec<[String; 3]>, bool)> {
    let mut setup = Setup::of(name)?;

    setup.without = without.iter().map(|file| (*file).to_string()).collect();

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
                .any(|module| module.name == "OLESVR");

            (stop, loaded)
        },
    );

    Some((stop, records, loaded))
}

fn check(name: &str, records: &[[String; 3]]) {
    let Some(windows) = recorded(name) else {
        return;
    };

    assert_eq!(records, &windows[..], "{name}");
}

#[test]
fn probes_agree_with_the_file() {
    for name in PROBES {
        let Some((stop, records, loaded)) = run_probe(name, &[]) else {
            continue;
        };

        // Its library is let go as its server ends.
        let _ = loaded;
        assert_eq!(stop, Stop::Ended, "{name}");
        check(name, &records);
    }
}

#[test]
fn probes_agree_with_no_file() {
    for name in PROBES {
        let Some((stop, records, loaded)) = run_probe(name, &[OLESVR_DLL]) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert!(!loaded, "{name}: a file of OLESVR's was loaded");
        check(name, &records);
    }
}

/// Paintbrush serving its picture to a client with neither library's file
/// on the drive: WinBox's `OLESVR` to WinBox's `OLECLI`.
#[test]
fn paintbrush_agrees_with_neither_file() {
    let Some((stop, records, _)) =
        run_probe("olepbr", &[OLESVR_DLL, "WINDOWS\\SYSTEM\\OLECLI.DLL"])
    else {
        return;
    };

    assert_eq!(stop, Stop::Ended, "olepbr");
    check("olepbr", &records);
}
