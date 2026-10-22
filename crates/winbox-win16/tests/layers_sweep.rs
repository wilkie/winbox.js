//! The layered base (`WINBOX_BASE=layers`, `support/layered.rs`): the
//! asset bundle's base split into a stack of layers -- with a decoy and its
//! whiteout, and files shadowed by the same bytes -- materialised into
//! folders of the host's and put together by `HostDrive::layered`, under
//! each run's own folder. The oracle's C: is one DOSBox folder, so the
//! layering must never show: every probe writes on the layers exactly what
//! it writes on the same base in one folder (`WINBOX_BASE=assets`), record
//! for record, and stops as it stops there.
//!
//! The drive itself, and a handful of probes that list, open, search and
//! write files, are held to that on every run. Every probe is some minutes
//! of a release build: the sweep runs only with `LAYERS_SWEEP=1`, and the
//! bundle (`pnpm assets`) and the probes built.
//!
//! `LAYERS_SWEEP=1 cargo test --release -p winbox-win16 --test layers_sweep
//! -- --nocapture`; `LAYERS_SWEEP_PROBES=a,b` runs those fixtures alone.

mod support;

use std::path::PathBuf;

use winbox_machine::{HostDrive, Volume};
use winbox_win16::Stop;

use support::layered;
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

/// Where a probe's run on the layers differs from its run on the base in
/// one folder: how it stopped, or its first record that differs; none
/// where they are the same -- and, `written`, where both wrote something --
/// or the probe is not built.
fn difference(name: &str, written: bool) -> Option<String> {
    let assets = records_on(name, Base::Assets)?;
    let layers = records_on(name, Base::Layers)?;

    if assets.0 != layers.0 {
        return Some(format!(
            "{name}: stopped {:?} on the folder, {:?} on the layers",
            assets.0, layers.0
        ));
    }

    if written && assets.1.is_empty() {
        return Some(format!("{name}: no records on the folder"));
    }

    let at =
        (0..assets.1.len().max(layers.1.len())).find(|&at| assets.1.get(at) != layers.1.get(at))?;

    Some(format!(
        "{name}: record {at}, {:?} on the folder, {:?} on the layers ({} and {} records)",
        assets.1.get(at),
        layers.1.get(at),
        assets.1.len(),
        layers.1.len()
    ))
}

/// Each probe named run on both, among threads: what differs.
fn sweep(names: &[String], written: bool) -> Vec<String> {
    let queue = std::sync::Mutex::new(names.to_vec());
    let found = std::sync::Mutex::new(Vec::new());
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));

    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                while let Some(name) = queue.lock().unwrap().pop() {
                    if let Some(differing) = difference(&name, written) {
                        found.lock().unwrap().push(differing);
                    }
                }
            });
        }
    });

    let mut found = found.into_inner().unwrap();

    found.sort();
    found
}

/// Every entry of a drive beneath a folder, by its DOS path, with its
/// entry as a search gives it, and each file's bytes: what a program can
/// see of it.
fn listing(drive: &HostDrive) -> Vec<String> {
    fn walk(drive: &HostDrive, parts: &mut Vec<String>, out: &mut Vec<String>) {
        let mut children = drive.children(parts).unwrap();

        children.sort_by(|one, other| one.name.cmp(&other.name));

        for entry in children {
            parts.push(entry.name.clone());

            let path = parts.join("\\");

            if entry.attributes & 0x10 != 0 {
                out.push(format!("{path} {entry:?}"));
                walk(drive, parts, out);
            } else {
                let bytes = drive.read(parts).unwrap();

                out.push(format!(
                    "{path} {:?} {}",
                    entry,
                    winbox_win16::sha256::sha256_hex(&bytes)
                ));
            }

            parts.pop();
        }
    }

    let mut out = Vec::new();

    walk(drive, &mut Vec::new(), &mut out);
    out
}

/// The layered base, on each display the bundle composes, lists and reads
/// as the bundle's base in one folder does, stamps and all: the decoy
/// nowhere, the shadowed files once.
#[test]
fn the_layers_list_as_the_folder_does() {
    let Some(assets) = bundle() else {
        return;
    };

    for display in &assets.displays {
        let folder = assets
            .base_in(&std::env::temp_dir().join("winbox-bases"), display)
            .unwrap();
        let stacked = layered::stacked(&assets, display);
        let layers = HostDrive::layered(PathBuf::new(), stacked.lowers.clone());

        let (ours, theirs) = (listing(&layers), listing(&HostDrive::new(folder)));
        let only = |one: &[String], other: &[String]| {
            one.iter()
                .filter(|line| !other.contains(line))
                .cloned()
                .collect::<Vec<_>>()
        };

        assert_eq!(stacked.lowers.len(), 7, "{display}");
        assert!(!theirs.is_empty(), "{display}");
        assert_eq!(
            (only(&ours, &theirs), only(&theirs, &ours)),
            (Vec::new(), Vec::new()),
            "{display}: on the layers alone, in the folder alone"
        );
        assert_eq!(ours, theirs, "{display}");
    }
}

/// Probes that list folders, open, search, find and write files, and read
/// and write the profiles, each the same on the layers as in one folder.
#[test]
fn the_file_probes_see_one_folder() {
    if bundle().is_none() {
        return;
    }

    let names: Vec<String> = [
        "dirorder", "filecdr", "openfile", "profile", "loadpath", "verinst",
    ]
    .iter()
    .filter(|name| recorded(name).is_some())
    .map(|name| (*name).to_string())
    .collect();
    let found = sweep(&names, true);

    assert!(found.is_empty(), "{}", found.join("\n"));
}

#[test]
fn every_probe_sees_one_folder() {
    if std::env::var("LAYERS_SWEEP").as_deref() != Ok("1") || bundle().is_none() {
        return;
    }

    let only: Vec<String> = std::env::var("LAYERS_SWEEP_PROBES")
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

    let started = std::time::Instant::now();
    let found = sweep(&names, false);

    println!(
        "{} fixtures on the layers and the folder in {:.0?}: {} differ",
        names.len(),
        started.elapsed(),
        found.len()
    );

    for differing in &found {
        println!("{differing}");
    }

    assert!(found.is_empty(), "{} differ", found.len());
}
