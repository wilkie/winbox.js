//! The oracle's probes run on the Rust engine, their records held to what
//! Windows 3.1 recorded (`oracle/fixtures`). The probes are built into
//! `oracle/build/probes`, which a checkout does not have until they are
//! built; without them these pass with nothing to check.

use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::{Stop, System};

/// The probes the Rust engine runs to their end, agreeing with Windows.
const AGREEING: &[&str] = &[
    "stackpos", "grealloc", "greuse", "memory", "glock", "localre",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A probe's records as Windows wrote them: function, arguments, result.
fn recorded(name: &str) -> Option<Vec<[String; 3]>> {
    let text = std::fs::read_to_string(root().join(format!("oracle/fixtures/{name}.json"))).ok()?;
    let fixture: serde_json::Value = serde_json::from_str(&text).ok()?;
    let field =
        |record: &serde_json::Value, key: &str| record[key].as_str().unwrap_or("").to_string();

    Some(
        fixture["records"]
            .as_array()?
            .iter()
            .map(|record| {
                [
                    field(record, "function"),
                    field(record, "args"),
                    field(record, "result"),
                ]
            })
            .collect(),
    )
}

/// The probe's own records, as `recordsFrom` reads them: tab-separated,
/// escapes undone, notes left out.
fn records_of(text: &[u8]) -> Vec<[String; 3]> {
    let unescape = |field: &str| {
        let mut out = String::new();
        let mut chars = field.chars();

        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('t') => out.push('\t'),
                    Some('r') => out.push('\r'),
                    Some('n') => out.push('\n'),
                    Some(other) => out.push(other),
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }

        out
    };
    let text: String = text.iter().map(|&byte| char::from(byte)).collect();

    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut fields = line.split('\t').map(unescape);

            [
                fields.next().unwrap_or_default(),
                fields.next().unwrap_or_default(),
                fields.next().unwrap_or_default(),
            ]
        })
        .filter(|record| record[0] != "#")
        .collect()
}

/// A probe run from `C:\`, its records written to `C:\ORACLE`: why it
/// stopped, and its records. `None` where it is not built.
fn run(name: &str) -> Option<(Stop, Vec<[String; 3]>)> {
    let upper = name.to_ascii_uppercase();
    let bytes = std::fs::read(root().join(format!("oracle/build/probes/{upper}.EXE"))).ok()?;
    let drive = std::env::temp_dir().join(format!("winbox-probe-{name}-{}", std::process::id()));

    let mut system = System::new();

    std::fs::create_dir_all(drive.join("C").join("ORACLE")).unwrap();
    // The probe on the drive, where the oracle ran it from.
    std::fs::write(drive.join("C").join(format!("{upper}.EXE")), &bytes).unwrap();

    // The machine the oracle recorded on: A:, a floppy; C:, Windows
    // installed, its own files read and never written; Z:, DOSBox's.
    let windows = root().join("oracle/build/drive-c");
    let c = if windows.is_dir() {
        HostDrive::over(drive.join("C"), windows)
    } else {
        HostDrive::new(drive.join("C"))
    };

    std::fs::create_dir_all(drive.join("A")).unwrap();
    std::fs::create_dir_all(drive.join("Z")).unwrap();
    system
        .files
        .mount('A', HostDrive::removable(drive.join("A")));
    system.files.mount('C', c);
    system.files.mount('Z', HostDrive::new(drive.join("Z")));

    let (program, libraries) = system.load(
        Executable::parse(bytes).unwrap(),
        &format!("C:\\{upper}.EXE"),
    );

    system.link(program);
    system.start(program, libraries, "").unwrap();

    let stop = winbox_win16::Engine::new(system).run(200_000_000, 30.0);
    let output = std::fs::read(drive.join("C").join("ORACLE").join(format!("{upper}.OUT")))
        .unwrap_or_default();

    std::fs::remove_dir_all(drive).unwrap();
    Some((stop, records_of(&output)))
}

#[test]
fn probes_agree_with_windows() {
    for name in AGREEING {
        let Some((stop, records)) = run(name) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert_eq!(Some(records), recorded(name), "{name}");
    }
}

/// How many records of each probe the TypeScript engine agrees with
/// Windows on, from the knowledge base's conformance data.
fn typescript_agreed() -> std::collections::HashMap<String, u64> {
    let text = std::fs::read_to_string(root().join("kb/data/conformance.json")).unwrap_or_default();
    let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let mut agreed = std::collections::HashMap::new();

    if let Some(probes) = data.as_object() {
        for (name, probe) in probes {
            let count = probe["functions"].as_object().map_or(0, |functions| {
                functions
                    .values()
                    .filter_map(|f| f["agreed"].as_u64())
                    .sum()
            });

            agreed.insert(name.clone(), count);
        }
    }

    agreed
}

/// Every probe built, run, and how far each got, against the TypeScript
/// engine's agreement with Windows: `cargo test -p winbox-win16 --test
/// probes -- --ignored --nocapture`.
#[test]
#[ignore = "a survey, not a check"]
fn survey() {
    let typescript = typescript_agreed();
    let mut level = Vec::new();
    let mut behind = Vec::new();
    let mut ahead = Vec::new();
    let mut stops = std::collections::BTreeMap::<String, Vec<String>>::new();

    for entry in std::fs::read_dir(root().join("oracle/fixtures"))
        .unwrap()
        .flatten()
    {
        let file = entry.file_name().to_string_lossy().into_owned();
        let Some(name) = file.strip_suffix(".json") else {
            continue;
        };
        let Some(recorded) = recorded(name) else {
            continue;
        };
        let Some((stop, records)) = run(name) else {
            continue;
        };
        // As a whole run is replayed: each record's result found by its
        // function and arguments, the last written.
        let written: std::collections::HashMap<(&str, &str), &str> = records
            .iter()
            .map(|[function, args, result]| ((function.as_str(), args.as_str()), result.as_str()))
            .collect();
        let agreed = recorded
            .iter()
            .filter(|[function, args, result]| {
                written.get(&(function.as_str(), args.as_str())) == Some(&result.as_str())
            })
            .count() as u64;
        let theirs = typescript.get(name).copied().unwrap_or(0);

        if stop != Stop::Ended {
            stops
                .entry(format!("{stop:?}"))
                .or_default()
                .push(name.to_string());
        }

        match agreed.cmp(&theirs) {
            std::cmp::Ordering::Less if stop == Stop::Ended => {
                behind.push(format!("{name} {agreed}/{theirs}"));
            }
            std::cmp::Ordering::Less => {}
            std::cmp::Ordering::Equal => level.push(name.to_string()),
            std::cmp::Ordering::Greater => ahead.push(format!("{name} {agreed}/{theirs}")),
        }
    }

    let mut ranked: Vec<_> = stops.into_iter().collect();

    ranked.sort_by_key(|(_, names)| std::cmp::Reverse(names.len()));

    for (stop, names) in ranked {
        println!("{:4} {stop}: {}", names.len(), names.join(" "));
    }

    println!("ended behind the TypeScript engine: {}", behind.join(", "));
    println!("ahead of it: {}", ahead.join(", "));
    println!("level with it: {} -- {}", level.len(), level.join(" "));
}
