//! `OLECLI` is WinBox's own (`src/olecli/`): its probes write what Windows
//! wrote with `OLECLI.DLL` on the drive -- each import of an export linked
//! to WinBox's stub -- and with no `OLECLI.DLL` on the drive at all. As
//! `test/win16/olecli_test.ts`.

mod support;

use winbox_win16::Stop;

use support::{Setup, box_hand, recorded, run_setup};

/// The probes of `OLECLI`.
const PROBES: &[&str] = &["olestat", "olemem"];

/// A probe run, with or without `OLECLI.DLL` on the drive: how it stopped,
/// its records, and whether a library named `OLECLI` was loaded from a
/// file.
fn run_probe(name: &str, without: bool) -> Option<(Stop, Vec<[String; 3]>, bool)> {
    let mut setup = Setup::of(name)?;

    if without {
        setup.without = vec!["WINDOWS\\SYSTEM\\OLECLI.DLL".to_string()];
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
                .any(|module| module.name == "OLECLI");

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
        let Some((stop, records, loaded)) = run_probe(name, false) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert!(loaded, "{name}: OLECLI.DLL was not loaded beside WinBox's");
        check(name, &records);
    }
}

#[test]
fn probes_agree_with_no_file() {
    for name in PROBES {
        let Some((stop, records, loaded)) = run_probe(name, true) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert!(!loaded, "{name}: a file of OLECLI's was loaded");
        check(name, &records);
    }
}
