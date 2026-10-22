//! The page's machine on the asset bundle's base, as `src/run` makes it
//! (`planDrive` with the base, `add_folder`, `add_file`, `add_module`):
//! held in memory, it reports what the trace example's does with
//! `--assets`, the same base written into a host's folder and the bundle's
//! modules behind it -- the probe harness's and the native build's base.
//!
//! Skipped where the bundle (`pnpm assets`, `oracle/build/assets`) or the
//! probes are not made.

use std::path::{Path, PathBuf};
use std::rc::Rc;

use winbox_machine::{HostDrive, host_seconds, instant_ms};
use winbox_ne::Executable;
use winbox_web::session::{Made, Session};
use winbox_win16::assets::{Assets, STAMP};
use winbox_win16::survey::{self, Survey};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn asked() -> Survey {
    Survey {
        boxes: 3,
        screens: true,
        ..Survey::default()
    }
}

/// The trace example's survey with `--assets`: the probe copied into a
/// host's folder, as `C:\PROBES`, over the base written for the display.
fn traced(bundle: &Assets, probe: &Path, display: &str, run: &str) -> survey::Surveyed {
    let scratch =
        std::env::temp_dir().join(format!("winbox-web-assets-{run}-{}", std::process::id()));
    let drive = scratch.join("drive");
    let base = bundle.base_in(&scratch, display).unwrap();
    let asked = Survey {
        display: display.to_string(),
        ..asked()
    };
    let mut system = asked.system().unwrap();
    let name = probe.file_name().unwrap().to_string_lossy().to_string();

    std::fs::create_dir_all(drive.join("PROBES")).unwrap();
    std::fs::copy(probe, drive.join("PROBES").join(&name)).unwrap();
    system.files.mount('C', HostDrive::over(drive, base));
    system.assets = Some(Rc::new(bundle.clone()));
    survey::start(
        &mut system,
        Executable::parse(std::fs::read(probe).unwrap()).unwrap(),
        &format!("C:\\PROBES\\{name}"),
    )
    .unwrap();

    let surveyed = asked.run(system);

    std::fs::remove_dir_all(scratch).unwrap();
    surveyed
}

#[test]
fn the_pages_machine_on_the_bundles_base_reports_as_the_trace_does() {
    let probes = root().join("oracle/build/probes");
    let Ok(bundle) = Assets::open(&root().join("oracle/build/assets")) else {
        eprintln!("skipped: the asset bundle is not made");
        return;
    };

    for (probe, display) in [
        ("DRVRES", "vga"),
        ("CHROME", "vga"),
        ("ABOUT", "vga"),
        ("SYSDIRS", "vga"),
        ("FONTBOOT", "vga"),
        ("DRVRES", "ega"),
        ("DISKFREE", "vga"),
        ("DRVRES", "vga256"),
    ] {
        let file = probes.join(format!("{probe}.EXE"));

        if !file.is_file() || !bundle.displays.iter().any(|one| one == display) {
            continue;
        }

        let path = format!("C:\\PROBES\\{probe}.EXE");
        let traced = traced(&bundle, &file, display, &format!("{probe}-{display}"));
        let mut session = Session::new(Made {
            display,
            coprocessor: true,
            host: instant_ms,
            wall: host_seconds,
            epoch_ms: 0,
        })
        .unwrap();
        let composed = bundle.compose(display).unwrap();
        let now = host_seconds();

        for (name, bytes) in &bundle.modules {
            session.add_module(name, bytes.clone());
        }

        for folder in &composed.directories {
            assert!(session.add_folder('C', &folder.replace('/', "\\"), STAMP));
        }

        for file in &composed.files {
            assert!(session.add_file(
                'C',
                &file.path.replace('/', "\\"),
                file.data.clone(),
                file.modified
            ));
        }

        assert!(session.add_folder('C', "PROBES", now));
        assert!(session.add_file(
            'C',
            &format!("PROBES\\{probe}.EXE"),
            std::fs::read(&file).unwrap(),
            now
        ));
        session.mark_planned();

        let asked = Survey {
            display: display.to_string(),
            ..asked()
        };
        let report = session.survey(&asked, &path, None).unwrap();

        assert_eq!(report, traced.report, "{probe} on {display}");
        assert!(report.lines().count() > 5, "{probe}: {report}");

        let kept: Vec<_> = session.kept().iter().map(|kept| &kept.screen).collect();
        let screens: Vec<_> = traced.screens.iter().chain(&traced.boxes).collect();

        assert_eq!(kept, screens, "{probe} on {display}'s screens");
    }
}
