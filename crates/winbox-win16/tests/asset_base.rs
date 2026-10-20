//! The engine started from the asset bundle alone: drive C: has beneath it
//! the base the bundle composes for the display, and the kept modules'
//! files -- `USER.EXE`, `SHELL.DLL`, the display drivers -- come from its
//! store (`System.assets`). The probes that read what the bundle keeps --
//! the display driver's resources (`drvres`), USER's drawing of a window's
//! frame with the driver's bitmaps and the profiles' colours (`chrome`),
//! the fonts GDI loads from the profiles (`fontboot`) and SHELL's About box
//! with its logo (`about`) -- write the same records on it as on the
//! oracle's installation, and those are Windows' own.
//!
//! The bundle is made by `pnpm assets` into `oracle/build/assets`; without
//! it, or the probes, there is nothing to compare.

mod support;

use winbox_win16::Stop;
use winbox_win16::assets::Assets;

use support::{Base, Setup, box_hand, bundle, recorded, run_setup};

/// The probes, each on the displays it was recorded on.
const PROBES: [&str; 12] = [
    "drvres-vga",
    "drvres-ega",
    "drvres-hercules",
    "drvres-svga",
    "chrome-vga",
    "chrome-ega",
    "chrome-hercules",
    "chrome-svga",
    "fontboot-fonts",
    "fontboot-ttoff",
    "fontboot-ttonly",
    "about",
];

fn records_on(name: &str, base: Base) -> Option<(Stop, Vec<[String; 3]>)> {
    let setup = Setup::on(name, base)?;
    let (stop, records, ()) = run_setup(
        name,
        setup,
        |system| system.box_hand = Some(box_hand(name)),
        |system| {
            (
                winbox_win16::Engine::new(system).run(2_000_000_000, 300.0),
                (),
            )
        },
    );

    Some((stop, records))
}

#[test]
fn the_bundles_base_gives_what_the_installation_gives() {
    if bundle().is_none() {
        return;
    }

    for name in PROBES {
        let (Some(installed), Some(assets)) = (
            records_on(name, Base::Installed),
            records_on(name, Base::Assets),
        ) else {
            continue;
        };

        assert_eq!(assets.0, Stop::Ended, "{name}");
        assert_eq!(assets, installed, "{name}");
        assert_eq!(Some(assets.1), recorded(name), "{name}");
    }
}

/// SHELL's logo, as the About box draws it, on a base: each pixel's index;
/// nothing without a logo, and none where the probe is not built.
fn logo_on(name: &str, base: Base) -> Option<Vec<u8>> {
    let setup = Setup::on(name, base)?;
    let (_, _, logo) = run_setup(
        name,
        setup,
        |_| (),
        |mut system| {
            let logo =
                winbox_win16::shell::about::logo(&mut system).map_or_else(Vec::new, |logo| {
                    let pixels = &logo.pixels;

                    (0..pixels.height())
                        .flat_map(|y| (0..pixels.width()).map(move |x| (x, y)))
                        .map(|(x, y)| pixels.index_at(x, y).unwrap_or(0))
                        .collect()
                });

            (Stop::Ended, logo)
        },
    );

    Some(logo)
}

/// The About box's logo, which no probe's record holds, read from the
/// bundle's `SHELL.DLL` as from the installation's, on each display.
#[test]
fn the_logo_is_read_from_the_bundles_shell() {
    if bundle().is_none() {
        return;
    }

    for name in ["drvres-vga", "drvres-ega", "drvres-hercules", "drvres-svga"] {
        let Some(installed) = logo_on(name, Base::Installed) else {
            continue;
        };

        assert!(!installed.is_empty(), "{name}");
        assert_eq!(logo_on(name, Base::Assets).unwrap(), installed, "{name}");
    }
}

/// The bundle read from `winbox-assets.zip`, a zip of stored entries, is
/// the bundle read from the folder it was unpacked into.
#[test]
fn the_zip_is_the_folder() {
    let Some(folder) = bundle() else {
        return;
    };
    let zip = Assets::open(&support::root().join("oracle/build/winbox-assets.zip")).unwrap();

    assert_eq!(zip.id, folder.id);
    assert_eq!(zip.displays, folder.displays);
    assert_eq!(zip.modules, folder.modules);
    assert_eq!(
        zip.pool.keys().collect::<Vec<_>>(),
        folder.pool.keys().collect::<Vec<_>>()
    );

    for (name, file) in &zip.pool {
        let theirs = &folder.pool[name];

        assert_eq!(
            (&file.data, file.date, file.time),
            (&theirs.data, theirs.date, theirs.time),
            "{name}"
        );
    }

    assert!(zip.module("vga.drv").is_some());
    assert!(Assets::from_zip(b"not a zip archive, not one bit of it").is_err());
}
