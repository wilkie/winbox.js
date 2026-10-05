//! What a page hears of the FM chip: a program playing MIDI through the
//! MIDI Mapper to WinBox's synthesizer (`adlibmap`, the oracle's probe), on
//! a machine made as the page makes one with Sound ticked
//! (`Session::install_sound`), and the chip's samples taken as the page
//! takes them (`Session::take_sound`): 44,100 a second, a few milliseconds
//! at a time, each piece beginning where the last ended, and not silent.
//!
//! The page's clock is the host's; here the host's time runs on a little
//! each time it is read, so that the probe's waits of seconds pass in a
//! moment and the run is the same however fast the host is.
#![allow(clippy::cast_precision_loss, clippy::float_cmp)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use winbox_machine::host_seconds;
use winbox_web::session::{Made, Session, State};
use winbox_win16::audio::Sound;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The host's time in hundredths of a millisecond, a hundredth on each
/// time it is read.
static TICKS: AtomicU64 = AtomicU64::new(0);

#[allow(clippy::cast_precision_loss)]
fn quick_ms() -> f64 {
    TICKS.fetch_add(1, Ordering::Relaxed) as f64 / 100.0
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

#[test]
fn the_page_hears_the_fm_chip_as_midi_plays() {
    let probe = root().join("oracle/build/probes/ADLIBMAP.EXE");
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM.INI").is_file() || !probe.is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return;
    }

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: quick_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap();

    hold(&mut session, &windows, "");
    session.add_folder('C', "ORACLE", host_seconds());
    assert!(session.add_file(
        'C',
        "ADLIBMAP.EXE",
        std::fs::read(probe).unwrap(),
        host_seconds()
    ));
    assert!(session.install_sound());
    session.start("C:\\ADLIBMAP.EXE").unwrap();

    let mut pieces: Vec<(f64, f64, usize)> = Vec::new();
    let mut loudest = 0i16;

    for _ in 0..1_000_000 {
        let state = session.step(f64::INFINITY);

        for sound in session.take_sound() {
            if let Sound::Fm { at, rate, samples } = sound {
                loudest = loudest.max(
                    samples
                        .iter()
                        .map(|&sample| sample.saturating_abs())
                        .max()
                        .unwrap_or(0),
                );
                pieces.push((at, rate, samples.len()));
            }
        }

        if state == State::Stopped || (loudest > 1000 && pieces.len() > 100) {
            break;
        }
    }

    assert!(!pieces.is_empty(), "no FM chip's samples");
    assert!(loudest > 1000, "the FM chip's samples are silent");
    assert!(pieces.iter().all(|&(_, rate, _)| rate == 44_100.0));

    // Each piece of whole milliseconds, 44 or 45 samples each, beginning
    // where the last ended while the chip sounds.
    for pair in pieces.windows(2) {
        let ((at, _, count), (next, _, _)) = (pair[0], pair[1]);
        let ms = next - at;

        if ms <= 10.0 {
            assert!(
                (44.0 * ms..=45.0 * ms).contains(&(count as f64)),
                "{count} samples in {ms} ms"
            );
        }
    }
}
