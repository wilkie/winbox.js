//! `VER` and `LZEXPAND` are WinBox's own (`src/ver/`, `src/lzexpand/`):
//! their probes write what Windows wrote with no `VER.DLL` or
//! `LZEXPAND.DLL` on the drive at all, as they do with the files there
//! (`probes.rs`, `AGREEING`). As `test/win16/ver_lzexpand_test.ts`.

mod support;

use winbox_win16::Stop;

use support::{Setup, box_hand, recorded, run, run_setup};

/// With the files there: each import of an export of theirs is linked to
/// WinBox's stub, and the probes write what Windows wrote.
#[test]
fn probes_agree_with_the_files() {
    for name in ["lzfiles", "verinfo", "verinst"] {
        let Some((stop, records)) = run(name) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert_eq!(Some(records), recorded(name), "{name}");
    }
}

#[test]
fn probes_agree_with_no_files() {
    for name in ["lzfiles", "verinfo", "verinst"] {
        let Some(mut setup) = Setup::of(name) else {
            continue;
        };

        setup.without = vec![
            "WINDOWS\\SYSTEM\\VER.DLL".to_string(),
            "WINDOWS\\SYSTEM\\LZEXPAND.DLL".to_string(),
        ];

        let (stop, records, loaded) = run_setup(
            name,
            setup,
            |system| system.box_hand = Some(box_hand(name)),
            |system| {
                let loaded = system
                    .modules
                    .iter()
                    .any(|module| module.name == "VER" || module.name == "LZEXPAND");

                (
                    winbox_win16::Engine::new(system).run(2_000_000_000, 300.0),
                    loaded,
                )
            },
        );

        assert_eq!(stop, Stop::Ended, "{name}");
        assert!(!loaded, "{name}: a file of VER's or LZEXPAND's was loaded");
        assert_eq!(Some(records), recorded(name), "{name}");
    }
}
