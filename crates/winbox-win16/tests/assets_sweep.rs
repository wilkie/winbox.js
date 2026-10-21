//! The fidelity sweep of the asset bundle's base: every probe run on the
//! oracle's installation and on the base the bundle composes for its
//! display, and each record the two runs write differently held to
//! `test/oracle/assets-differences.json`, where each has its reason
//! (`kb/topics/asset-bundle.md`). A difference it does not list fails, and
//! so does one it lists that no longer comes.
//!
//! Every probe twice is some minutes of a release build: the sweep runs
//! only with `ASSETS_SWEEP=1`, and the bundle (`pnpm assets`) and the
//! probes built.
//!
//! `ASSETS_SWEEP=1 cargo test --release -p winbox-win16 --test assets_sweep
//! -- --nocapture`; `ASSETS_SWEEP_PROBES=a,b` runs those alone, and
//! `ASSETS_SWEEP_OUT=file` writes every difference found there as JSON, and
//! `ASSETS_SWEEP_DUMP=DIR` every run's records.

mod support;

use std::collections::BTreeMap;
use std::fmt::Write as _;

use winbox_win16::Stop;

use support::{Base, Setup, box_hand, bundle, recorded, root, run_setup};

/// A probe's run on a base: why it stopped, and its records.
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

/// A record's key, `function(args)`, and what each run wrote for it, by
/// its occurrence: the installation's, the base's; `None` where that run
/// wrote it fewer times.
type Difference = (String, Option<String>, Option<String>);

/// The records two runs write differently, each occurrence of a call held
/// to the same occurrence in the other; and the stops, as the key `stop`,
/// where they differ.
fn differences(
    installed: &(Stop, Vec<[String; 3]>),
    assets: &(Stop, Vec<[String; 3]>),
) -> Vec<Difference> {
    let mut found = Vec::new();

    if installed.0 != assets.0 {
        found.push((
            "stop".to_string(),
            Some(format!("{:?}", installed.0)),
            Some(format!("{:?}", assets.0)),
        ));
    }

    let by_key = |records: &[[String; 3]]| {
        let mut keyed: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut order = Vec::new();

        for [function, args, result] in records {
            let key = format!("{function}({args})");

            if !keyed.contains_key(&key) {
                order.push(key.clone());
            }

            keyed.entry(key).or_default().push(result.clone());
        }

        (keyed, order)
    };
    let (theirs, mut order) = by_key(&installed.1);
    let (ours, more) = by_key(&assets.1);

    order.extend(more.into_iter().filter(|key| !theirs.contains_key(key)));

    for key in order {
        let empty = Vec::new();
        let (a, b) = (
            theirs.get(&key).unwrap_or(&empty),
            ours.get(&key).unwrap_or(&empty),
        );

        for at in 0..a.len().max(b.len()) {
            if a.get(at) != b.get(at) {
                found.push((key.clone(), a.get(at).cloned(), b.get(at).cloned()));
            }
        }
    }

    found
}

/// Whether a listed record matches a key: the key itself, or, ending in
/// `*`, every key it begins.
fn matches(listed: &str, key: &str) -> bool {
    match listed.strip_suffix('*') {
        Some(prefix) => key.starts_with(prefix),
        None => listed == key,
    }
}

/// Each probe named run on both bases, among threads, each with its own
/// systems and bundle: the records that differ, by probe. With
/// `ASSETS_SWEEP_DUMP=DIR`, each run's records are written there too,
/// `<probe>.installed.txt` and `<probe>.assets.txt`.
fn sweep(names: &[String]) -> BTreeMap<String, Vec<Difference>> {
    let queue = std::sync::Mutex::new(names.to_vec());
    let found = std::sync::Mutex::new(BTreeMap::new());
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));
    let dump = std::env::var("ASSETS_SWEEP_DUMP").ok();

    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                while let Some(name) = queue.lock().unwrap().pop() {
                    let (Some(installed), Some(assets)) = (
                        records_on(&name, Base::Installed),
                        records_on(&name, Base::Assets),
                    ) else {
                        continue;
                    };

                    if let Some(dump) = &dump {
                        for (base, run) in [("installed", &installed), ("assets", &assets)] {
                            let mut text = format!("stop {:?}\n", run.0);

                            for [function, args, result] in &run.1 {
                                let _ = writeln!(text, "{function}({args}) = {result}");
                            }

                            let _ = std::fs::write(format!("{dump}/{name}.{base}.txt"), text);
                        }
                    }

                    let differing = differences(&installed, &assets);

                    if !differing.is_empty() {
                        found.lock().unwrap().insert(name, differing);
                    }
                }
            });
        }
    });

    found.into_inner().unwrap()
}

#[test]
fn the_bundles_base_differs_only_where_listed() {
    if std::env::var("ASSETS_SWEEP").as_deref() != Ok("1") || bundle().is_none() {
        return;
    }

    let listed: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root().join("test/oracle/assets-differences.json")).unwrap(),
    )
    .unwrap();
    let only: Vec<String> = std::env::var("ASSETS_SWEEP_PROBES")
        .unwrap_or_default()
        .split(',')
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    let mut names: Vec<String> = std::fs::read_dir(root().join("oracle/fixtures"))
        .unwrap()
        .flatten()
        .filter_map(|entry| {
            let file = entry.file_name().to_string_lossy().into_owned();

            file.strip_suffix(".json").map(str::to_string)
        })
        .filter(|name| recorded(name).is_some())
        .filter(|name| only.is_empty() || only.contains(name))
        .collect();

    names.sort();

    let found = sweep(&names);

    if let Ok(out) = std::env::var("ASSETS_SWEEP_OUT") {
        let json: BTreeMap<_, Vec<_>> = found
            .iter()
            .map(|(name, differing)| {
                (
                    name,
                    differing
                        .iter()
                        .map(|(key, a, b)| serde_json::json!([key, a, b]))
                        .collect(),
                )
            })
            .collect();

        std::fs::write(out, serde_json::to_string_pretty(&json).unwrap()).unwrap();
    }

    let mut failures = Vec::new();
    let empty = serde_json::Map::new();
    let probes = listed["probes"].as_object().unwrap_or(&empty);

    for name in &names {
        let entries: Vec<(&str, Vec<&str>)> = probes
            .get(name)
            .and_then(|entries| entries.as_array())
            .into_iter()
            .flatten()
            .filter(|entry| {
                entry["engine"]
                    .as_str()
                    .is_none_or(|engine| engine == "rust")
            })
            .map(|entry| {
                (
                    entry["reason"].as_str().unwrap_or(""),
                    entry["records"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|record| record.as_str())
                        .collect(),
                )
            })
            .collect();
        let differing = found.get(name).map_or(&[][..], Vec::as_slice);

        for (key, a, b) in differing {
            if !entries
                .iter()
                .any(|(_, records)| records.iter().any(|listed| matches(listed, key)))
            {
                failures.push(format!(
                    "{name}: {key} differs, not listed: installation {a:?}, base {b:?}"
                ));
            }
        }

        for (reason, records) in &entries {
            for listed in records {
                if !differing.iter().any(|(key, ..)| matches(listed, key)) {
                    failures.push(format!(
                        "{name}: {listed} is listed ({reason}) and no longer differs"
                    ));
                }
            }
        }
    }

    for failure in &failures {
        println!("{failure}");
    }

    assert!(failures.is_empty(), "{} unexplained", failures.len());
}
