//! The probes run with every drive held in memory, as a browser's page
//! runs them, against the same probes on the host's folders: the same
//! records, and the installation every run shares never changed.

mod support;

use support::{box_hand, installed, root, run, run_in_memory};

/// Probes that find, open, read and write files -- `FindFirst`, `OpenFile`,
/// `_lopen`, the profiles, the registration database, `WinExec`'s search,
/// TrueType's `.FOT` files -- and a couple that touch none.
const PROBES: &[&str] = &[
    "filecdr", "profile", "profnew", "devinfo", "diskmeta", "loadpath", "winexec", "sysdirs",
    "drivetyp", "fotmake", "registry", "shell2", "mcifile", "loadenv", "tasks2", "stackpos",
    "memory", "curdir",
];

#[test]
fn probes_on_drives_held_in_memory_agree_with_the_hosts() {
    let windows = root().join("oracle/build/drive-c");

    if !windows.is_dir() {
        return;
    }

    let mut differing = Vec::new();
    let mut ran = 0;

    for &name in PROBES {
        let Some((host_stop, host)) = run(name) else {
            continue;
        };
        let (memory_stop, memory, system) =
            run_in_memory(name, |system| system.box_hand = Some(box_hand(name))).unwrap();

        ran += 1;
        assert!(!host.is_empty(), "{name}: no records");

        if host_stop != memory_stop || host != memory {
            let first = host
                .iter()
                .zip(&memory)
                .position(|(a, b)| a != b)
                .unwrap_or(host.len().min(memory.len()));

            differing.push(format!(
                "{name}: {host_stop:?} / {memory_stop:?}, {} / {} records, first apart at {first}: \
                 {:?} / {:?}",
                host.len(),
                memory.len(),
                host.get(first),
                memory.get(first),
            ));
        }

        // What the run wrote of the installation's files is its own.
        if name == "registry" {
            let written = system.files.read_from("C:\\WINDOWS", "REG.DAT").unwrap().1;

            assert_ne!(
                written,
                std::fs::read(windows.join("WINDOWS").join("REG.DAT")).unwrap(),
                "registry: REG.DAT not written"
            );
        }
    }

    assert!(differing.is_empty(), "{}", differing.join("\n"));
    assert!(ran > 0, "no probe is built");

    // The installation every run shared, as the host's folder has it still.
    let installation = installed(&windows);

    for entry in walk(&windows) {
        let path = entry.strip_prefix(&windows).unwrap();
        let dos = path.to_string_lossy().replace('/', "\\");

        assert_eq!(
            installation.data(&dos).as_deref(),
            Some(&std::fs::read(&entry).unwrap()),
            "{dos}"
        );
    }
}

/// Every file under a folder.
fn walk(folder: &std::path::Path) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(folder)
        .unwrap()
        .flatten()
        .flat_map(|entry| {
            let path = entry.path();

            if path.is_dir() {
                walk(&path)
            } else {
                vec![path]
            }
        })
        .collect()
}
