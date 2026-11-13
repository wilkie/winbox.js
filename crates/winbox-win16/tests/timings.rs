//! The faithful clock held to the recordings it is made from: each timing
//! probe recorded at a fixed 80,000 instructions a millisecond
//! (`oracle/fixtures/timings/*-c80000.json`) run on WinBox's faithful clock
//! (`Clock::faithful`), in its mode and on its display, and each of its
//! times set beside the recorded one (`kb/topics/timing.md`).
//!
//! Slow -- each probe times its calls for seconds of the clock, millions of
//! them -- so not run with the rest:
//! `cargo test --release -p winbox-win16 --test timings -- --ignored
//! --nocapture`, or one probe by its name after `--ignored`. Each figure
//! printed with how far it is from the recorded one; the file reads of
//! `hdtime` and `cdread` held to a bound each (`TIMED`), but those `KNOWN`;
//! the rest printed, not held: their small calls are charged the batch's
//! own loop over again, and some calls inside others twice.

mod support;

use std::fmt::Write as _;

use winbox_machine::Clock;

/// Each recording: its fixture, the probe's run as the support module
/// names it (its mode's folder before it, its display after it), and how
/// far each of its times may be from the recorded one, as a fraction.
const TIMED: &[(&str, &str, f64)] = &[
    ("hdtime-c80000", "hdtime", 0.05),
    ("hdtime-enhanced-c80000", "enhanced/hdtime", 0.12),
    ("cdread-c80000", "cdread", 0.05),
    ("cdread-enhanced-c80000", "enhanced/cdread", 0.12),
    ("callcost-c80000", "callcost", f64::INFINITY),
    ("callcost-vga256-c80000", "callcost-vga256", f64::INFINITY),
    ("twrcost-c80000", "twrcost-vga256", f64::INFINITY),
    ("twrcall-c80000", "twrcall-vga256", f64::INFINITY),
    ("wingcost-c80000", "wingcost-vga256", f64::INFINITY),
    ("wingxlat-c80000", "wingxlat-vga256", f64::INFINITY),
    ("viscost-c80000", "viscost", f64::INFINITY),
];

/// The rate the recordings were made at, instructions a millisecond.
const RATE: f64 = winbox_machine::FAITHFUL_INSTRUCTIONS_PER_MS;

/// Records left out of their recording's bound, with why
/// (`kb/topics/timing.md`, "Not yet done").
const KNOWN: &[(&str, &str)] = &[
    // `_hread`'s second piece comes straight after a first that ended
    // DOSBox's slice, and is cut sooner than a read alone.
    ("hdtime-c80000", "read hread,49152"),
    // An open and a close charged as `adlibgap` timed them, between the
    // two modes'.
    ("hdtime-c80000", "open "),
];

/// A record's time, as instructions at the recordings' rate: a `rate`'s
/// instructions a millisecond as it is, a `cost`'s nanoseconds a call, and
/// for the others the milliseconds over the times made -- the times, then
/// what else, and the milliseconds third. None for a record that is no
/// time.
fn time_of(record: &[String; 3]) -> Option<f64> {
    let fields: Vec<f64> = record[2]
        .split(',')
        .map(|field| field.parse().unwrap_or(f64::NAN))
        .collect();

    match record[0].as_str() {
        "rate" => fields.first().copied(),
        "cost" => fields.first().map(|ns| ns * RATE / 1e6),
        "kind" | "first" | "once" => None,
        _ if fields.len() >= 3 && fields[0] > 0.0 => Some(fields[2] / fields[0] * RATE),
        _ => None,
    }
}

/// The probe's records on the faithful clock, beside the recorded ones:
/// the function and arguments, the two times and how far apart, each
/// record of a time matched with the recorded one of its name in order.
fn compared(fixture: &str, run: &str) -> Vec<(String, f64, f64, f64)> {
    let recorded = support::recorded(&format!("timings/{fixture}")).expect("the recording");
    let (_, records, ()) = support::run_on(
        run,
        |system| system.clock = Clock::faithful(),
        |system| {
            (
                winbox_win16::Engine::new(system).run(u64::MAX / 4, 900.0),
                (),
            )
        },
    )
    .expect("the probe built");
    let mut taken = vec![false; records.len()];
    let mut rows = Vec::new();

    for want in &recorded {
        let Some(wanted) = time_of(want) else {
            continue;
        };
        let found = records
            .iter()
            .enumerate()
            .position(|(at, got)| !taken[at] && got[0] == want[0] && got[1] == want[1]);
        let name = format!("{} {}", want[0], want[1]);

        match found.and_then(|at| {
            taken[at] = true;
            time_of(&records[at])
        }) {
            Some(got) => rows.push((name, wanted, got, got / wanted - 1.0)),
            None => rows.push((name, wanted, f64::NAN, f64::NAN)),
        }
    }

    rows
}

fn held(fixture: &str, run: &str, bound: f64) {
    let rows = compared(fixture, run);
    let mut out = format!("{fixture} on the faithful clock:\n");
    let mut beyond = Vec::new();

    for (name, wanted, got, off) in &rows {
        let _ = writeln!(
            out,
            "  {name:<60} {wanted:>12.1} {got:>12.1} {:>+8.2}%",
            off * 100.0
        );

        let known = KNOWN.contains(&(fixture, name.as_str()));

        if off.is_nan() || (off.abs() > bound && !known) {
            beyond.push(name.clone());
        }
    }

    println!("{out}");
    assert!(
        beyond.is_empty(),
        "{fixture}: beyond {:.0}%: {beyond:?}",
        bound * 100.0
    );
}

macro_rules! timed {
    ($($test:ident => $at:expr),* $(,)?) => {
        $(
            #[test]
            #[ignore = "slow: seconds of the clock of millions of calls"]
            fn $test() {
                let (fixture, run, bound) = TIMED[$at];

                held(fixture, run, bound);
            }
        )*
    };
}

timed! {
    hdtime => 0,
    hdtime_enhanced => 1,
    cdread => 2,
    cdread_enhanced => 3,
    callcost => 4,
    callcost_vga256 => 5,
    twrcost => 6,
    twrcall => 7,
    wingcost => 8,
    wingxlat => 9,
    viscost => 10,
}
