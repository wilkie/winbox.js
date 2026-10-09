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

/// What the FM chip makes of `log`'s accesses, each made at its time, a
/// millisecond at a time without a break, until the millisecond `until`.
fn made_without_a_break(log: &[winbox_win16::fm::Access], until: u64) -> Vec<i16> {
    let mut fm = winbox_win16::fm::Fm::new();
    let mut whole = Vec::new();
    let mut keep = |sound| {
        if let Sound::Fm { samples, .. } = sound {
            whole.extend(samples);
        }
    };

    for access in log {
        if access.at >= until as f64 {
            break;
        }

        fm.make_until(access.at.floor() as u64, true, &mut keep);

        if access.read {
            fm.read(access.port, access.at);
        } else {
            fm.write(access.port, access.value, access.at);
        }
    }

    fm.make_until(until, true, &mut keep);
    whole
}

/// The FM chip's sound as the page takes it is one stream: the pieces,
/// laid end to end, are what the chip makes of the same writes and reads
/// made a millisecond at a time without a break (`Fm::make_until`, as
/// `tests/adlib.rs` makes them to hold them to DOSBox's .wav), sample for
/// sample, none dropped and none made twice; each piece begins at the
/// millisecond the last ended; and no join steps further than the chip's
/// own sound steps from one sample to the next within a piece.
#[test]
fn the_fm_chip_stream_the_page_takes_is_unbroken() {
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
    assert!(session.add_file(
        'C',
        "ADLIBMAP.EXE",
        std::fs::read(probe).unwrap(),
        host_seconds()
    ));
    assert!(session.install_sound());
    session.system().fm.log = Some(Vec::new());
    session.start("C:\\ADLIBMAP.EXE").unwrap();

    let mut pieces: Vec<(f64, Vec<i16>)> = Vec::new();

    for _ in 0..1_000_000 {
        let state = session.step(f64::INFINITY);

        for sound in session.take_sound() {
            if let Sound::Fm { at, samples, .. } = sound {
                pieces.push((at, samples));
            }
        }

        // Two seconds of the probe's notes.
        let made: usize = pieces.iter().map(|(_, samples)| samples.len()).sum();

        if state == State::Stopped || made > 6 * 44_100 {
            break;
        }
    }

    let log = session.system().fm.log.take().unwrap();
    let taken: Vec<i16> = pieces
        .iter()
        .flat_map(|(_, samples)| samples.iter().copied())
        .collect();

    assert!(taken.len() > 44_100, "{} samples taken", taken.len());

    // Each piece begins where the last ended: its samples are the mixer's
    // ticks' from its first millisecond to the next piece's, DOSBox's 44.1
    // a millisecond to a 16,384th, from nought (`MixerTicks`).
    let before = |ms: f64| (ms as u64 * ((44_100 << 14) / 1000)) >> 14;

    for pair in pieces.windows(2) {
        let ((at, samples), (next, _)) = (&pair[0], &pair[1]);
        let between = before(*next) - before(*at);

        assert_eq!(
            samples.len() as u64,
            between,
            "the piece at {at} ms, the next at {next} ms"
        );
    }

    // The same accesses, made at their times without a break.
    let whole = made_without_a_break(&log, pieces[pieces.len() - 1].0 as u64 + 10);

    let equal = taken.iter().zip(&whole).take_while(|(a, b)| a == b).count();

    assert_eq!(
        equal,
        taken.len(),
        "{} of {} samples alike",
        equal,
        whole.len()
    );

    // No join steps further than the sound does within its pieces.
    let step = |a: i16, b: i16| (i32::from(b) - i32::from(a)).abs();
    let mut within = 0;
    let mut joins = 0;

    for (index, (_, samples)) in pieces.iter().enumerate() {
        within = samples
            .windows(2)
            .map(|pair| step(pair[0], pair[1]))
            .fold(within, i32::max);

        if let (Some(&first), Some((_, before))) =
            (samples.first(), index.checked_sub(1).map(|i| &pieces[i]))
        {
            joins = joins.max(step(*before.last().unwrap(), first));
        }
    }

    println!(
        "{} pieces, {} samples; the largest step within a piece {within}, at a join {joins}",
        pieces.len(),
        taken.len()
    );
    assert!(within > 0 && joins <= within);
}

/// How long after the chip first sounds a run of `probe` (`ADLIBGM.EXE`,
/// say) first sounds loud, in the machine's milliseconds, on a machine
/// made as the page makes one with Sound ticked and `SYSTEM.INI` as
/// `install` makes it; none within `seconds`.
fn first_loud(probe: &str, install: impl FnOnce(&mut Session), seconds: f64) -> Option<f64> {
    let file = root().join("oracle/build/probes").join(probe);
    let windows = root().join("oracle/build/drive-c");
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
    assert!(session.add_file('C', probe, std::fs::read(file).unwrap(), host_seconds()));
    install(&mut session);
    session.start(&format!("C:\\{probe}")).unwrap();

    let mut first = None;

    for _ in 0..1_000_000 {
        let state = session.step(f64::INFINITY);

        for sound in session.take_sound() {
            if let Sound::Fm { at, samples, .. } = sound {
                let from = *first.get_or_insert(at);

                if samples.iter().any(|&sample| sample.saturating_abs() > 1000) {
                    return Some(at - from);
                }

                if at - from > seconds * 1000.0 {
                    return None;
                }
            }
        }

        if state == State::Stopped {
            break;
        }
    }

    None
}

/// The MIDI Mapper on the page's machine: the page installs the
/// installation's own setup with the card, "Ad Lib", Windows' default,
/// current in `MIDIMAP.CFG` (`wbsound::install_setups`): channels 13 to 16
/// to the synthesizer, the base-level arrangement of a MIDI file written
/// for Windows 3.1. The oracle's `adlibmap`, whose first note is on
/// channel 13, is heard as it plays it, three seconds after it opens the
/// mapper, which sounds the chip as it resets it; `adlibgm`'s first, on
/// General MIDI's channel 1, goes nowhere, and nothing is heard until its
/// note on channel 16, some eight seconds on.
///
/// With "Ad Lib general" made current, as Control Panel's MIDI Mapper
/// makes it (the header's word at 6, its number, 8), `adlibgm`'s channel 1
/// is heard three seconds on.
#[test]
fn the_page_hears_the_base_level_setup_through_the_mapper() {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM.INI").is_file()
        || !root().join("oracle/build/probes/ADLIBGM.EXE").is_file()
        || !root().join("oracle/build/probes/ADLIBMAP.EXE").is_file()
    {
        eprintln!("skipped: the oracle's build is not here");
        return;
    }

    let installed = |session: &mut Session| assert!(session.install_sound());
    let channel_13 = first_loud("ADLIBMAP.EXE", installed, 30.0).expect("channel 13 is heard");

    assert!(
        (2900.0..3500.0).contains(&channel_13),
        "first heard at {channel_13} ms"
    );

    let base_level = first_loud("ADLIBGM.EXE", installed, 30.0).expect("channel 16 is heard");

    assert!(base_level > 7000.0, "first heard at {base_level} ms");

    let setups = std::fs::read(windows.join("WINDOWS/SYSTEM/MIDIMAP.CFG")).unwrap();
    let mut general = winbox_win16::wbsound::install_setups(&setups).unwrap();

    general[6..8].copy_from_slice(&8u16.to_le_bytes());
    assert_eq!(
        winbox_win16::wbmapper::setups::from_file(
            &general,
            winbox_win16::wbmapper::setups::Wanted::Current
        )
        .unwrap()
        .name,
        winbox_win16::wbmapper::setups::GENERAL_MIDI
    );

    let general = first_loud(
        "ADLIBGM.EXE",
        |session| {
            assert!(session.install_sound());
            assert!(session.add_file('C', "WINDOWS\\SYSTEM\\MIDIMAP.CFG", general, host_seconds()));
        },
        30.0,
    )
    .expect("General MIDI's channel 1 is heard");

    println!(
        "first heard: Ad Lib {channel_13} ms (adlibmap), {base_level} ms (adlibgm); \
         Ad Lib general {general} ms"
    );
    assert!(
        (2900.0..3500.0).contains(&general),
        "first heard at {general} ms"
    );
}
