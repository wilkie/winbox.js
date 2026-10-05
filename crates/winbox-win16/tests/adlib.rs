//! WinBox's synthesizer held to Windows' Ad Lib driver, write for write:
//! the probes that played MIDI to `MSADLIB.DRV` on the oracle's
//! installation with a sound card -- `adlibout` to the Ad Lib's device,
//! `adlibmap` through the MIDI Mapper, `adlibseq` through MCI's sequencer --
//! run on the Rust engine with WinBox's sound driver installed, and every
//! register write it made to the machine's FM chip compared with what
//! DOSBox's OPL was sent as Windows played them
//! (`oracle/fixtures/opl/<probe>-trace.json`), from Windows starting to its
//! ending (`kb/topics/adlib.md`).
//!
//! Their times are compared too, and printed: each write's millisecond
//! against DOSBox's, from the first note on.
#![allow(clippy::cast_precision_loss)]

mod support;

use winbox_win16::fm::Access;
use winbox_win16::{Engine, Stop, System};

use support::{root, run_on};

/// A register write: its time, in milliseconds, the register and value.
type Write = (f64, u8, u8);

/// The writes a log of the chip's ports holds: a register's number at an
/// even port, then its value at the odd one.
fn writes_of(accesses: impl Iterator<Item = (f64, u16, u8, bool)>) -> Vec<Write> {
    let mut register = 0u8;
    let mut writes = Vec::new();

    for (at, port, value, read) in accesses {
        match (read, port & 1) {
            (true, _) => {}
            (false, 0) => register = value,
            (false, _) => writes.push((at, register, value)),
        }
    }

    writes
}

/// What DOSBox's OPL was sent as a probe ran, from its traced build.
fn traced(probe: &str) -> Option<Vec<Write>> {
    let text =
        std::fs::read_to_string(root().join(format!("oracle/fixtures/opl/{probe}-trace.json")))
            .ok()?;
    let fixture: serde_json::Value = serde_json::from_str(&text).ok()?;

    Some(writes_of(fixture["trace"].as_array()?.iter().map(
        |access| {
            (
                access["ms"].as_f64().unwrap_or(0.0),
                access["port"].as_u64().unwrap_or(0) as u16,
                access["value"].as_u64().unwrap_or(0) as u8,
                access["op"] == "r",
            )
        },
    )))
}

/// The probe run with WinBox's sound driver, its chip's ports logged, and
/// Windows ending as it ends: the driver disabled (`DRV_DISABLE`), which
/// resets the chip, as Windows disables it. Why it stopped, its records,
/// and the writes.
fn played(probe: &str) -> Option<(Stop, Vec<[String; 3]>, Vec<Write>)> {
    run_on(
        &format!("{probe}-vgasound"),
        |system: &mut System| {
            system.fm.log = Some(Vec::new());

            // `adlibout` looks for the Ad Lib's device by its name.
            if probe == "adlibout" {
                system.sound_card.midi.synthesizer_name = Some("Ad Lib");
            }
        },
        |system| {
            let engine = Engine::new(system);
            let stop = engine.run(2_000_000_000, 300.0);
            let mut system = engine.into_system();

            winbox_win16::wbsound::driver_proc(&mut system, 0, 5);

            let log = system.fm.log.take().unwrap_or_default();

            (
                stop,
                writes_of(log.into_iter().map(
                    |Access {
                         at,
                         port,
                         value,
                         read,
                     }| (at, port, value, read),
                )),
            )
        },
    )
}

/// How the writes' times agree with DOSBox's, each counted from the first
/// note on (a write of B0h-B8h keying a voice): how many fall in the same
/// millisecond, and the furthest apart.
fn timing(ours: &[Write], theirs: &[Write]) -> String {
    let first = |writes: &[Write]| {
        writes
            .iter()
            .find(|&&(_, register, value)| (0xb0..=0xb8).contains(&register) && value & 0x20 != 0)
            .map_or(0.0, |&(at, _, _)| at.floor())
    };
    let (ours_from, theirs_from) = (first(ours), first(theirs));
    let mut same = 0;
    let mut furthest = 0.0f64;
    let mut within = [0usize; 4];

    for (&(a, _, _), &(b, _, _)) in ours.iter().zip(theirs) {
        if a < ours_from || b < theirs_from {
            continue;
        }

        let a = (a - ours_from).floor();
        let b = (b - theirs_from).floor();
        let apart = (a - b).abs();

        same += usize::from(apart == 0.0);
        furthest = furthest.max(apart);

        for (at, limit) in [1.0, 10.0, 100.0, 1000.0].iter().enumerate() {
            within[at] += usize::from(apart <= *limit);
        }
    }

    let counted = ours.iter().filter(|&&(at, _, _)| at >= ours_from).count();

    // The writes in bursts, as DOSBox made them: a burst ends where more
    // than a millisecond passes before the next write. Each burst's length,
    // and the time from one burst's start to the next's, against DOSBox's.
    let mut starts = vec![0];

    for at in 1..theirs.len().min(ours.len()) {
        if theirs[at].0 - theirs[at - 1].0 > 1.0 {
            starts.push(at);
        }
    }

    let ends: Vec<usize> = starts
        .iter()
        .skip(1)
        .map(|&start| start - 1)
        .chain([theirs.len().min(ours.len()) - 1])
        .collect();
    let lengths = starts
        .iter()
        .zip(&ends)
        .filter(|&(&start, &end)| {
            let theirs = theirs[end].0 - theirs[start].0;
            let ours = ours[end].0 - ours[start].0;

            (theirs - ours).abs() <= 0.05
        })
        .count();
    let gaps: Vec<f64> = starts
        .windows(2)
        .map(|pair| {
            let theirs = theirs[pair[1]].0 - theirs[pair[0]].0;
            let ours = ours[pair[1]].0 - ours[pair[0]].0;

            (theirs - ours).abs()
        })
        .collect();
    let gaps_within = |limit: f64| gaps.iter().filter(|&&gap| gap <= limit).count();

    format!(
        "{same} of {counted} in DOSBox's millisecond from the first note; within 1, 10, 100, 1000 ms: {within:?}; furthest {furthest} ms. {} bursts, {lengths} as long as DOSBox's to 0.05 ms; of the {} gaps between them, {} within 1 ms of DOSBox's, {} within 5, {} within 20",
        starts.len(),
        gaps.len(),
        gaps_within(1.0),
        gaps_within(5.0),
        gaps_within(20.0),
    )
}

/// Every access of a probe's trace: its time, port, value, and whether it
/// was a read.
fn accesses(probe: &str) -> Option<Vec<(f64, u16, u8, bool)>> {
    let text =
        std::fs::read_to_string(root().join(format!("oracle/fixtures/opl/{probe}-trace.json")))
            .ok()?;
    let fixture: serde_json::Value = serde_json::from_str(&text).ok()?;

    Some(
        fixture["trace"]
            .as_array()?
            .iter()
            .map(|access| {
                (
                    access["ms"].as_f64().unwrap_or(0.0),
                    access["port"].as_u64().unwrap_or(0) as u16,
                    access["value"].as_u64().unwrap_or(0) as u8,
                    access["op"] == "r",
                )
            })
            .collect(),
    )
}

/// What the machine's FM chip sounds for a trace's accesses, each at its
/// time, made a millisecond at a time as the engine makes it (`fm.rs`),
/// until the millisecond `until`: the mixer's remainder `remain` as it
/// starts, and `slip` samples more made by the chip, and let go, as the
/// first note is struck (`REMAINS`).
fn sounded(trace: &[(f64, u16, u8, bool)], remain: u32, slip: usize, until: u64) -> Vec<i16> {
    let mut fm = winbox_win16::fm::Fm::new();
    let mut samples = Vec::new();
    let mut keep = |sound| {
        if let winbox_win16::audio::Sound::Fm { samples: some, .. } = sound {
            samples.extend(some);
        }
    };
    let mut register = 0;
    let mut slipped = slip == 0;

    fm.set_phase(remain);

    for &(at, port, value, read) in trace {
        if at >= until as f64 {
            break;
        }

        fm.make_until(at.floor() as u64, true, &mut keep);

        if read {
            fm.read(port, at);
            continue;
        }

        if port & 1 == 0 {
            register = value;
        } else if !slipped && (0xb0..=0xb8).contains(&register) && value & 0x20 != 0 {
            fm.adlib.generate(slip);
            slipped = true;
        }

        fm.write(port, value, at);
    }

    fm.make_until(until, true, &mut keep);
    samples
}

/// A .wav's 16-bit stereo samples, left and right.
fn wav(path: &std::path::Path) -> Option<Vec<[i16; 2]>> {
    let bytes = std::fs::read(path).ok()?;
    let data = bytes.windows(4).position(|window| window == b"data")? + 8;

    Some(
        bytes[data..]
            .chunks_exact(4)
            .map(|frame| {
                [
                    i16::from_le_bytes([frame[0], frame[1]]),
                    i16::from_le_bytes([frame[2], frame[3]]),
                ]
            })
            .collect(),
    )
}

/// Ours against the .wav's, each from its first sound: how many samples are
/// compared, how many are equal, and how many from the first are equal in
/// a row.
fn alike(ours: &[i16], theirs: &[i16]) -> (usize, usize, usize) {
    let first = |samples: &[i16]| samples.iter().position(|&sample| sample != 0);
    let (Some(made), Some(heard)) = (first(ours), first(theirs)) else {
        return (0, 0, 0);
    };
    let (ours, theirs) = (&ours[made..], &theirs[heard..]);
    let compared = ours.len().min(theirs.len());
    let pairs = || ours.iter().zip(theirs);

    if std::env::var_os("WINBOX_WAV_DEBUG").is_some() {
        let at = pairs().take_while(|(a, b)| a == b).count();
        let from = at.saturating_sub(4);

        println!("  made from {made}, heard from {heard}; at {at}:");
        println!("    ours   {:?}", &ours[from..(at + 40).min(compared)]);
        println!("    theirs {:?}", &theirs[from..(at + 40).min(compared)]);
    }

    (
        compared,
        pairs().filter(|(a, b)| a == b).count(),
        pairs().take_while(|(a, b)| a == b).count(),
    )
}

/// Where DOSBox's mixer was in its pattern of 44 and 45 samples a
/// millisecond as each recording began (`MixerTicks`'s remainder, under
/// 16,384): found by `WINBOX_WAV_SEARCH=1`, which tries every remainder
/// over the recording's first seconds and keeps the one that gives the
/// most samples equal from the first; and how many samples more DOSBox's
/// chip had made by the first note (none found to help: see the test).
const REMAINS: [(&str, u32, usize); 3] = [
    ("adlibout", 12423, 0),
    ("adlibmap", 16383, 0),
    ("adlibseq", 7359, 0),
];

/// The FM chip's sound held to DOSBox's: the writes and reads of each
/// probe's trace made at their times, and the samples made of them held
/// to the .wav DOSBox captured in the same run
/// (`oracle/build/captures/<probe>-traced`), its first sound lined up with
/// ours, at the mixer's phase found for it (`REMAINS`). Without the
/// captures, there is nothing to hold it to.
///
/// Each is equal sample for sample from its first sound until its first
/// drum that sounds the chip's noise (the snare, the cymbal or the hi-hat):
/// `adlibseq`'s .wav whole, `adlibout`'s first 112,105 samples, `adlibmap`'s
/// first 80,574. The noise generator and the chip's vibrato and tremolo
/// run on by every sample the chip makes, and before a capture starts
/// DOSBox nudges its mixer's ticks to follow the host's sound card, so it
/// made a number of samples no recording tells before the first note; the
/// noise is then elsewhere in its sequence. Held here: each the same from
/// its first sound for a second at least.
#[test]
#[ignore = "some seconds of the chip's sound made three times over: cargo test --release -p winbox-win16 --test adlib -- --ignored"]
fn the_chip_sounds_as_dosbox_captured_it() {
    let mut failed = Vec::new();

    for (probe, remain, slip) in REMAINS {
        let (Some(trace), Some(captured)) = (
            accesses(probe),
            wav(&root().join(format!(
                "oracle/build/captures/{probe}-traced/krnl386_000.wav"
            ))),
        ) else {
            continue;
        };
        let mono = captured.iter().all(|&[left, right]| left == right);
        let left: Vec<i16> = captured.iter().map(|&[left, _]| left).collect();
        let until = trace.last().map_or(0.0, |access| access.0) as u64 + 40_000;
        let (remain, slip) = if std::env::var_os("WINBOX_WAV_SEARCH").is_some() {
            search(&trace, &left, remain)
        } else {
            (remain, slip)
        };
        let began = std::time::Instant::now();
        let ours = sounded(&trace, remain, slip, until);
        let took = began.elapsed().as_secs_f64();
        let (compared, equal, leading) = alike(&ours, &left);

        println!(
            "{probe}: {equal} of {compared} samples equal to the .wav's ({:.4}%), the first {leading} in a row, the mixer's remainder {remain}, slip {slip}; {} samples made in {took:.2} s, {:.0} a second; the .wav {}",
            100.0 * equal as f64 / compared.max(1) as f64,
            ours.len(),
            ours.len() as f64 / took,
            if mono {
                "mono, left and right the same"
            } else {
                "stereo"
            }
        );

        failed.extend((!mono).then(|| format!("{probe}: the .wav's channels differ")));
        failed.extend(
            (leading < 44_100).then(|| {
                format!("{probe}: only the first {leading} samples equal, not a second's")
            }),
        );
    }

    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

/// The mixer's remainder, and the chip's slip, that make the most samples
/// equal from the first, over the first twenty seconds of the trace: where
/// `remain` is nought, every 64th remainder tried, then each around the
/// best; then each slip up to `WINBOX_WAV_SLIPS` (none unless set).
fn search(trace: &[(f64, u16, u8, bool)], theirs: &[i16], remain: u32) -> (u32, usize) {
    let until = std::env::var("WINBOX_WAV_WINDOW")
        .ok()
        .and_then(|window| window.parse().ok())
        .unwrap_or(20_000)
        + trace.first().map_or(0.0, |access| access.0) as u64;
    let score = |remain: u32, slip: usize| alike(&sounded(trace, remain, slip, until), theirs).2;
    let remain = if remain == 0 {
        let coarse = (0..16_384)
            .step_by(64)
            .max_by_key(|&remain| score(remain, 0))
            .unwrap_or(0);

        (coarse.saturating_sub(64)..(coarse + 64).min(16_384))
            .max_by_key(|&remain| score(remain, 0))
            .unwrap_or(coarse)
    } else {
        remain
    };
    let slips: usize = std::env::var("WINBOX_WAV_SLIPS")
        .ok()
        .and_then(|slips| slips.parse().ok())
        .unwrap_or(0);
    let slip = (0..=slips)
        .max_by_key(|&slip| score(remain, slip))
        .unwrap_or(0);

    println!(
        "  remainder {remain}, slip {slip}: {} in a row",
        score(remain, slip)
    );
    (remain, slip)
}

fn hex(writes: &[Write]) -> String {
    writes
        .iter()
        .map(|&(_, register, value)| format!("{register:02x}={value:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn the_synthesizer_writes_what_msadlib_wrote() {
    for probe in ["adlibout", "adlibmap", "adlibseq"] {
        let (Some(theirs), Some((stop, _, ours))) = (traced(probe), played(probe)) else {
            continue;
        };
        let same = ours
            .iter()
            .zip(&theirs)
            .take_while(|(a, b)| (a.1, a.2) == (b.1, b.2))
            .count();

        println!(
            "{probe}: {stop:?}, {same} of {} traced writes made in order (WinBox made {}); {}",
            theirs.len(),
            ours.len(),
            timing(&ours, &theirs)
        );

        let from = same.saturating_sub(4);

        assert!(
            same == theirs.len() && ours.len() == theirs.len(),
            "{probe}: after {same} writes\n  DOSBox: {}\n  WinBox: {}",
            hex(&theirs[from..(same + 8).min(theirs.len())]),
            hex(&ours[from..(same + 8).min(ours.len())]),
        );
    }
}
