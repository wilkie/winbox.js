//! WinBox's own Program Manager (`src/progman/`), started where a program
//! starts `PROGMAN.EXE` and there is none: `pmstart`, run with the file
//! removed from the installation and on the asset bundle's base, which has
//! none, is held to what Windows wrote with Microsoft's; and run with the
//! file, Microsoft's runs. As `test/win16/progman_test.ts`.

mod support;

use winbox_win16::Stop;

use support::{Base, Setup, box_hand, recorded, run_setup};

const PROBE: &str = "pmstart";

/// What it is not held to with Microsoft's: `GetModuleHandle` of a
/// program's name, which WinBox answers nought for a program loaded from
/// its file (`kb/kernel/getmodulehandle.md`).
const WITH_FILE: &[&str] = &["module"];

/// And with WinBox's: its frame is hidden, by the owner's decision; and it
/// does not yet save its settings as it closes.
const WITHOUT_FILE: &[&str] = &["visible", "saved"];

/// A run of the probe: how it stopped, its records, and whether a module
/// named `PROGMAN` was loaded from a file of that name -- Microsoft's.
fn run(setup: Setup) -> (Stop, Vec<[String; 3]>, bool) {
    run_setup(
        PROBE,
        setup,
        |system| system.box_hand = Some(box_hand(PROBE)),
        |system| {
            let engine = winbox_win16::Engine::new(system);
            let stop = engine.run(2_000_000_000, 300.0);
            let microsoft = engine.system().modules.iter().any(|module| {
                module.name == "PROGMAN"
                    && module.executable.description() != Some("WinBox Program Manager")
            });

            (stop, microsoft)
        },
    )
}

/// The records held to Windows', but those of the functions named.
fn check(records: Vec<[String; 3]>, gaps: &[&str]) {
    let Some(windows) = recorded(PROBE) else {
        return;
    };
    let keep = |record: &[String; 3]| !gaps.contains(&record[0].as_str());
    let ours: Vec<_> = records.into_iter().filter(keep).collect();
    let theirs: Vec<_> = windows.into_iter().filter(keep).collect();

    assert_eq!(ours, theirs, "{PROBE}");
}

#[test]
fn microsofts_runs_with_the_file() {
    let Some(setup) = Setup::on(PROBE, Base::Installed) else {
        return;
    };
    let (stop, records, microsoft) = run(setup);

    assert_eq!(stop, Stop::Ended);
    assert!(microsoft, "the installation's PROGMAN.EXE was not run");
    check(records, WITH_FILE);
}

#[test]
fn winboxs_runs_with_none() {
    let Some(mut setup) = Setup::on(PROBE, Base::Installed) else {
        return;
    };

    setup.without = vec!["WINDOWS\\PROGMAN.EXE".to_string()];

    let (stop, records, microsoft) = run(setup);

    assert_eq!(stop, Stop::Ended);
    assert!(!microsoft, "a file of PROGMAN's was loaded");

    // Its frame there, hidden, and every other record Windows'.
    assert!(
        records
            .iter()
            .any(|record| record[0] == "visible" && record[2] == "0"),
        "the frame was shown"
    );
    check(records, WITHOUT_FILE);
}

#[test]
fn winboxs_runs_on_the_bundles_base() {
    if support::bundle().is_none() {
        return;
    }

    let Some(setup) = Setup::on(PROBE, Base::Assets) else {
        return;
    };
    let (stop, records, microsoft) = run(setup);

    assert_eq!(stop, Stop::Ended);
    assert!(!microsoft, "a file of PROGMAN's was loaded");

    // The base has no PROGMAN.INI or group files to delete.
    let gaps: Vec<&str> = WITHOUT_FILE.iter().copied().chain(["delete"]).collect();

    check(records, &gaps);
}
