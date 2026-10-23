//! WinBox's own Program Manager's DDE (`src/progman/dde.rs`): the probes
//! that talk to Program Manager, run with `PROGMAN.EXE` taken off the
//! installation so that WinBox's answers, held to what Windows wrote with
//! Microsoft's. As `test/win16/progman_dde_test.ts`.
//!
//! What a command changes -- a group made, an item added, a file written --
//! is not done yet, so every record that hangs on it is left out, each
//! named with why; the rest are held, in order.

mod support;

use winbox_win16::Stop;

use support::{Setup, box_hand, recorded, run_setup};

/// The probes held.
const PROBES: &[&str] = &["progdde", "pmraw", "pmatom", "ddeinst", "pmsyntax"];

/// The records left out of each probe, with why, shared with the
/// TypeScript engine's test (`test/win16/progman-dde-gaps.json`): a
/// function's name leaves out all of its records, `function(args)` those
/// with those arguments, and `function(args)#n` the nth of them.
fn gaps_of(name: &str) -> Vec<String> {
    let path = support::root().join("test/win16/progman-dde-gaps.json");
    let text = std::fs::read_to_string(path).expect("the gaps");
    let gaps: serde_json::Value = serde_json::from_str(&text).expect("JSON");

    gaps[name]
        .as_object()
        .map(|gaps| gaps.keys().cloned().collect())
        .unwrap_or_default()
}

/// The records not left out, as `function(args) = result` lines.
fn held(records: &[[String; 3]], gaps: &[String]) -> Vec<String> {
    let mut seen = std::collections::BTreeMap::<String, usize>::new();

    records
        .iter()
        .filter(|record| {
            let call = format!("{}({})", record[0], record[1]);
            let count = seen.entry(call.clone()).or_default();

            *count += 1;

            let nth = format!("{call}#{count}");

            !gaps
                .iter()
                .any(|gap| *gap == record[0] || *gap == call || *gap == nth)
        })
        .map(|record| format!("{}({}) = {}", record[0], record[1], record[2]))
        .collect()
}

/// A probe run with no `PROGMAN.EXE`: how it stopped, its records, and
/// whether a module named `PROGMAN` was loaded from a file.
fn run_probe(name: &str) -> Option<(Stop, Vec<[String; 3]>, bool)> {
    let mut setup = Setup::of(name)?;

    setup.without = vec!["WINDOWS\\PROGMAN.EXE".to_string()];

    Some(run_setup(
        name,
        setup,
        |system| system.box_hand = Some(box_hand(name)),
        |system| {
            let engine = winbox_win16::Engine::new(system);
            let stop = engine.run(2_000_000_000, 300.0);
            let microsoft = engine.system().modules.iter().any(|module| {
                module.name == "PROGMAN"
                    && module.executable.description() != Some("WinBox Program Manager")
            });

            (stop, microsoft)
        },
    ))
}

#[test]
fn probes_agree_with_winboxs() {
    for &name in PROBES {
        let Some((stop, records, microsoft)) = run_probe(name) else {
            continue;
        };
        let Some(windows) = recorded(name) else {
            continue;
        };
        let gaps = gaps_of(name);

        assert_eq!(stop, Stop::Ended, "{name}");
        assert!(!microsoft, "{name}: a file of PROGMAN's was loaded");
        assert_eq!(held(&records, &gaps), held(&windows, &gaps), "{name}");
    }
}

/// Every record, ours beside Windows', for finding what differs:
/// `PROGMAN_DDE=<probe> cargo test --test progman_dde -- --ignored --nocapture`.
#[test]
#[ignore = "a tool: prints a probe's records beside Windows'"]
fn show() {
    let Ok(name) = std::env::var("PROGMAN_DDE") else {
        return;
    };
    let (stop, records, microsoft) = run_probe(&name).expect("built");
    let windows = recorded(&name).expect("recorded");
    let gaps = gaps_of(&name);
    let ours = held(&records, &gaps);
    let theirs = held(&windows, &gaps);

    println!(
        "stop {stop:?} microsoft {microsoft}: {} of {} held",
        theirs.len(),
        windows.len()
    );

    for index in 0..ours.len().max(theirs.len()) {
        let ours = ours.get(index).map_or("-", String::as_str);
        let theirs = theirs.get(index).map_or("-", String::as_str);

        if ours == theirs {
            println!("   {theirs}");
        } else {
            println!("!! {theirs}\n   ours {ours}");
        }
    }
}
