//! The oracle's replay: every recording in `oracle/fixtures` (the top level,
//! standard mode's, and `enhanced/`) one trial, its probe run whole once
//! and each function's records held to what Windows 3.1 recorded. A function
//! `support::KNOWN_GAPS` names is excused, and fails its trial the moment
//! every one of its records agrees, so the list only shrinks.
//!
//! A release-profile gate, its trials run in parallel: `cargo test --release
//! -p winbox-win16 --test conformance`; one picked out by its name, as
//! `cargo test --release -p winbox-win16 --test conformance -- prtt`. In the
//! debug profile, which plain `cargo test --workspace` runs, only `SAMPLE`
//! is run and the rest are ignored (`-- --include-ignored` runs them all).
//!
//! A run of every trial writes what it found into `kb/data/conformance.json`,
//! the report the knowledge base reads: each tracked fixture's probe,
//! display, Windows, records and its functions' counts, and its gaps. The
//! recordings in enhanced mode that `support::REPORTED_ENHANCED` does not
//! name are held but left out of it.

mod support;

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex};

use libtest_mimic::{Arguments, Failed, Trial};

use support::{
    ENHANCED, KNOWN_GAPS, STUBBED, UNBUILT, answers, fixtures, gap_of, recorded, root, run,
};

/// The fixtures plain `cargo test --workspace` replays in the debug
/// profile: a few that take moments, standard and enhanced, one with gaps,
/// one on another display and one with a box answered.
const SAMPLE: &[&str] = &[
    "about",
    "aboutdp",
    "segfree",
    "minis3",
    "maxwidth-ega",
    "enhanced/dpmiver",
    "enhanced/w386env",
];

/// A record's outcome: how the replay counts each record.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Agreed,
    Disagreed,
    /// A function a module answers with a stub (`STUBBED`).
    Unimplemented,
    /// A probe not built (`UNBUILT`).
    Unsupported,
}

/// One function's counts.
#[derive(Default)]
struct Counts {
    total: usize,
    agreed: usize,
    disagreed: usize,
    unimplemented: usize,
    unsupported: usize,
}

/// One fixture's line in the report.
struct Report {
    probe: String,
    display: Option<String>,
    windows: Option<String>,
    records: usize,
    functions: Vec<(String, Counts)>,
    gaps: Vec<(String, &'static str)>,
}

type Reports = Arc<Mutex<BTreeMap<String, Report>>>;

fn main() {
    let arguments = Arguments::from_args();
    let names = fixtures();
    let reports: Reports = Arc::default();
    let unknown: Vec<&str> = KNOWN_GAPS
        .iter()
        .map(|&(key, _)| key)
        .filter(|key| !gap_names_a_fixture(key, &names))
        .collect();

    assert!(
        unknown.is_empty() || names.is_empty(),
        "known gaps that name no fixture: {unknown:?}"
    );

    let trials = names
        .iter()
        .map(|name| {
            let reports = Arc::clone(&reports);
            let fixture = name.clone();

            Trial::test(name.clone(), move || hold(&fixture, &reports))
                .with_ignored_flag(cfg!(debug_assertions) && !SAMPLE.contains(&name.as_str()))
        })
        .collect();
    let conclusion = libtest_mimic::run(&arguments, trials);
    let reports = reports.lock().unwrap();

    // Every trial run: the report written, each trial's share merged.
    if !names.is_empty() && reports.len() == names.len() {
        let written = report_text(&reports);

        std::fs::write(root().join("kb/data/conformance.json"), written).unwrap();
    }

    conclusion.exit();
}

/// Whether a known gap's key names a fixture: by `<probe>:`,
/// `<probe>-<display>:`, `standard/<probe>:` or `enhanced/<probe>:`.
fn gap_names_a_fixture(key: &str, names: &[String]) -> bool {
    let Some((fixture, _)) = key.rsplit_once(':') else {
        return true;
    };
    let fixture = fixture.strip_prefix(support::STANDARD).unwrap_or(fixture);

    names.iter().any(|name| {
        name == fixture
            || name
                .strip_prefix(ENHANCED)
                .is_some_and(|bare| bare == fixture)
            || name
                .strip_prefix(ENHANCED)
                .unwrap_or(name)
                .split_once('-')
                .is_some_and(|(probe, _)| probe == fixture)
    })
}

/// One fixture replayed: its probe run whole, each function's records held
/// to the recording, and its line of the report kept.
#[allow(clippy::too_many_lines)]
fn hold(name: &str, reports: &Reports) -> Result<(), Failed> {
    let text = std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json")))
        .map_err(|error| format!("{name}: {error}"))?;
    let fixture: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("{name}: {error}"))?;
    let enhanced = name.starts_with(ENHANCED);
    let probe = fixture["probe"].as_str().unwrap_or_default().to_string();
    let display = fixture["display"].as_str().map(str::to_string);
    let shown = display.clone().unwrap_or_else(|| "vga".to_string());
    let recorded = recorded(name).ok_or_else(|| format!("{name}: no records"))?;
    let unbuilt = UNBUILT.iter().find(|&&(each, _)| each == name);
    let (outcomes, actual, stop) = if unbuilt.is_some() {
        (vec![Outcome::Unsupported; recorded.len()], Vec::new(), None)
    } else {
        let Some((stop, records)) = run(name) else {
            return Err(
                format!("{name}: its probe is not built, and UNBUILT does not name it").into(),
            );
        };
        let actual: Vec<Option<String>> = answers(&recorded, &records)
            .into_iter()
            .map(|answer| answer.map(str::to_string))
            .collect();
        let outcomes = recorded
            .iter()
            .zip(&actual)
            .map(|([function, _, result], answer)| {
                if STUBBED.contains(&function.as_str()) {
                    Outcome::Unimplemented
                } else if answer.as_deref() == Some(result.as_str()) {
                    Outcome::Agreed
                } else {
                    Outcome::Disagreed
                }
            })
            .collect();

        (outcomes, actual, Some(stop))
    };

    let mut functions: BTreeMap<&str, Counts> = BTreeMap::new();

    for ([function, _, _], outcome) in recorded.iter().zip(&outcomes) {
        let counts = functions.entry(function.as_str()).or_default();

        counts.total += 1;

        match outcome {
            Outcome::Agreed => counts.agreed += 1,
            Outcome::Disagreed => counts.disagreed += 1,
            Outcome::Unimplemented => counts.unimplemented += 1,
            Outcome::Unsupported => counts.unsupported += 1,
        }
    }

    let mut failures = String::new();
    let mut gaps = Vec::new();
    // The gaps in the order the recording first names their functions.
    let mut first: Vec<&str> = Vec::new();

    for [function, _, _] in &recorded {
        if !first.contains(&function.as_str()) {
            first.push(function.as_str());
        }
    }

    for (&function, counts) in &functions {
        let gap = gap_of(enhanced, &probe, &shown, function);

        if let Some(reason) = gap {
            gaps.push((function.to_string(), reason));

            if counts.agreed == counts.total {
                let _ = writeln!(
                    failures,
                    "{function}: agrees in all {} records, yet a known gap names it ({reason}): take it off KNOWN_GAPS",
                    counts.total
                );
            }

            continue;
        }

        if counts.disagreed == 0 {
            continue;
        }

        let _ = writeln!(
            failures,
            "{function}: {} of {} records differ",
            counts.disagreed, counts.total
        );

        for (([_, args, result], answer), _) in recorded
            .iter()
            .zip(&actual)
            .zip(&outcomes)
            .filter(|((record, _), outcome)| {
                record[0] == function && **outcome == Outcome::Disagreed
            })
            .take(20)
        {
            let _ = writeln!(
                failures,
                "  {function}({args}): Windows {result:?}, WinBox {:?}",
                answer.as_deref().unwrap_or("(none)")
            );
        }
    }

    gaps.sort_by_key(|(function, _): &(String, &str)| {
        first.iter().position(|each| each == function)
    });

    let report = Report {
        probe,
        display,
        windows: fixture["source"]["windows"].as_str().map(str::to_string),
        records: recorded.len(),
        functions: functions
            .into_iter()
            .map(|(function, counts)| (function.to_string(), counts))
            .collect(),
        gaps,
    };

    reports.lock().unwrap().insert(name.to_string(), report);

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("{name}, stopped {stop:?}:\n{failures}").into())
    }
}

/// Whether a fixture's line belongs in the report: tracked by git, so that
/// a local recording stays out of a tracked file, and, in enhanced mode,
/// one `REPORTED_ENHANCED` names.
fn reported(name: &str, tracked: Option<&std::collections::HashSet<String>>) -> bool {
    let enhanced_kept = name
        .strip_prefix(ENHANCED)
        .is_none_or(|bare| support::REPORTED_ENHANCED.contains(&bare));

    enhanced_kept && tracked.is_none_or(|tracked| tracked.contains(name))
}

/// The fixtures git tracks, by name; none where git cannot say.
fn tracked() -> Option<std::collections::HashSet<String>> {
    let output = std::process::Command::new("git")
        .args(["ls-files", "oracle/fixtures"])
        .current_dir(root())
        .output()
        .ok()
        .filter(|output| output.status.success())?;

    Some(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|path| path.strip_prefix("oracle/fixtures/")?.strip_suffix(".json"))
            .map(str::to_string)
            .collect(),
    )
}

/// The report's text, as `JSON.stringify(report, null, 1)` writes it, its
/// fixtures and each one's functions in the order `localeCompare` sorts them.
fn report_text(reports: &BTreeMap<String, Report>) -> String {
    let tracked = tracked();
    let mut names: Vec<&String> = reports
        .keys()
        .filter(|name| reported(name, tracked.as_ref()))
        .collect();

    names.sort_by(|a, b| locale_order(a, b));

    let mut out = String::from("{");

    for (at, name) in names.iter().enumerate() {
        let report = &reports[*name];
        let mut functions: Vec<&(String, Counts)> = report.functions.iter().collect();
        let gaps = &report.gaps;

        functions.sort_by(|(a, _), (b, _)| locale_order(a, b));

        let _ = write!(
            out,
            "{}\n {}: {{\n  \"probe\": {},\n  \"display\": {},\n  \"windows\": {},\n  \"records\": {},\n  \"functions\": ",
            if at == 0 { "" } else { "," },
            quoted(name),
            quoted(&report.probe),
            report.display.as_deref().map_or("null".to_string(), quoted),
            report.windows.as_deref().map_or("null".to_string(), quoted),
            report.records,
        );

        if functions.is_empty() {
            out.push_str("{}");
        } else {
            out.push('{');

            for (at, (function, counts)) in functions.iter().enumerate() {
                let _ = write!(
                    out,
                    "{}\n   {}: {{\n    \"total\": {},\n    \"agreed\": {},\n    \"disagreed\": {},\n    \"unimplemented\": {},\n    \"unsupported\": {}\n   }}",
                    if at == 0 { "" } else { "," },
                    quoted(function),
                    counts.total,
                    counts.agreed,
                    counts.disagreed,
                    counts.unimplemented,
                    counts.unsupported,
                );
            }

            out.push_str("\n  }");
        }

        out.push_str(",\n  \"gaps\": ");

        if gaps.is_empty() {
            out.push_str("{}");
        } else {
            out.push('{');

            for (at, (function, reason)) in gaps.iter().enumerate() {
                let _ = write!(
                    out,
                    "{}\n   {}: {}",
                    if at == 0 { "" } else { "," },
                    quoted(function),
                    quoted(reason)
                );
            }

            out.push_str("\n  }");
        }

        out.push_str("\n }");
    }

    out.push_str("\n}\n");
    out
}

/// A string as `JSON.stringify` writes it.
fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap()
}

/// The order `String.prototype.localeCompare` gives the names the report
/// holds, as ICU's root collation orders their characters: spaces and
/// punctuation (`_ - : . / +`) before digits, digits before letters, a
/// letter's case only where nothing else differs, and then lower case
/// first, from the left.
fn locale_order(a: &str, b: &str) -> std::cmp::Ordering {
    fn primary(c: char) -> (u32, char) {
        let rank = " _-:./+".find(c).map_or_else(
            || {
                if c.is_ascii_digit() {
                    100
                } else if c.is_ascii_alphabetic() {
                    200
                } else {
                    300
                }
            },
            |at| at as u32,
        );

        (rank, c.to_ascii_lowercase())
    }

    a.chars()
        .map(primary)
        .cmp(b.chars().map(primary))
        .then_with(|| {
            a.chars()
                .map(|c| c.is_ascii_uppercase())
                .cmp(b.chars().map(|c| c.is_ascii_uppercase()))
        })
}
