//! The oracle's probes run on the Rust engine, their records held to what
//! Windows 3.1 recorded (`oracle/fixtures`). The probes are built into
//! `oracle/build/probes`, which a checkout does not have until they are
//! built; without them these pass with nothing to check.

use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::{Stop, System};

/// The probes the Rust engine runs to their end, agreeing with Windows.
const AGREEING: &[&str] = &["stackpos"];

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

    std::fs::create_dir_all(drive.join("ORACLE")).unwrap();

    let mut system = System::new();

    system.files.mount(
        'C',
        HostDrive {
            root: drive.clone(),
        },
    );

    let (program, libraries) = system.load(
        Executable::parse(bytes).unwrap(),
        &format!("C:\\{upper}.EXE"),
        &mut |_| None,
    );

    system.link(program);
    system.start(program, libraries, "").unwrap();

    let stop = system.run(200_000_000);
    let output =
        std::fs::read(drive.join("ORACLE").join(format!("{upper}.OUT"))).unwrap_or_default();

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

/// Every probe built, run, and how far each got: `cargo test -p
/// winbox-win16 --test probes -- --ignored --nocapture`.
#[test]
#[ignore = "a survey, not a check"]
fn survey() {
    let mut agreeing = 0;
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

        if stop == Stop::Ended && records == recorded {
            agreeing += 1;
            println!("agrees: {name}");
        } else {
            stops
                .entry(format!("{stop:?}"))
                .or_default()
                .push(name.to_string());
        }
    }

    let mut ranked: Vec<_> = stops.into_iter().collect();

    ranked.sort_by_key(|(_, names)| std::cmp::Reverse(names.len()));

    for (stop, names) in ranked {
        println!("{:4} {stop}: {}", names.len(), names.join(" "));
    }

    println!("{agreeing} agree");
}
