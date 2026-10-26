//! WinBox's own `MMTASK` (`src/mmsystem/mmtask.rs`), started where
//! `mmTaskCreate` starts `MMTASK.TSK` and there is none: `mmtaskc`, run
//! with the file removed from the installation, is held to what Windows
//! wrote with Microsoft's; and run with the file, Microsoft's runs. The
//! image is the TypeScript engine's, byte for byte. As
//! `test/win16/mmtask_test.ts`.

mod support;

use winbox_win16::Stop;

use support::{Base, Setup, recorded, run_setup};

const PROBE: &str = "mmtaskc";

/// The image's digest and size, as the TypeScript engine's test has them.
const IMAGE_SHA256: &str = "bc45e530211a3418a9f161dda8852690f903c3d2bec1b7da794de944e4e76a50";
const IMAGE_SIZE: usize = 272;

/// A run of the probe: how it stopped, its records, and whether a module
/// named `MMTASK` was loaded from Microsoft's file.
fn run(setup: Setup) -> (Stop, Vec<[String; 3]>, bool) {
    run_setup(
        PROBE,
        setup,
        |_| {},
        |system| {
            let engine = winbox_win16::Engine::new(system);
            let stop = engine.run(2_000_000_000, 300.0);
            let microsoft = engine.system().modules.iter().any(|module| {
                module.name == "MMTASK"
                    && module.executable.description() != Some("WinBox multimedia task")
            });

            (stop, microsoft)
        },
    )
}

#[test]
fn is_the_image_the_typescript_engine_makes() {
    let bytes = winbox_win16::mmsystem::mmtask::image();
    let digest = winbox_win16::sha256::sha256_hex(&bytes);

    assert_eq!((bytes.len(), digest.as_str()), (IMAGE_SIZE, IMAGE_SHA256));
}

#[test]
fn microsofts_runs_with_the_file() {
    let Some(setup) = Setup::on(PROBE, Base::Installed) else {
        return;
    };
    let (stop, records, microsoft) = run(setup);

    assert_eq!(stop, Stop::Ended);
    assert!(microsoft, "the installation's MMTASK.TSK was not run");
    assert_eq!(Some(records), recorded(PROBE));
}

#[test]
fn winboxs_runs_with_none() {
    let Some(mut setup) = Setup::on(PROBE, Base::Installed) else {
        return;
    };

    setup.without = vec!["WINDOWS\\SYSTEM\\MMTASK.TSK".to_string()];

    let (stop, records, microsoft) = run(setup);

    assert_eq!(stop, Stop::Ended);
    assert!(!microsoft, "a file of MMTASK's was loaded");
    assert_eq!(Some(records), recorded(PROBE));
}
