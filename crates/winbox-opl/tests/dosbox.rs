//! The port against DOSBox: every script in tests/vectors must give the
//! number of values and the hash that DOSBox 0.74-3's own dbopl.cpp and
//! Adlib module gave for it, as recorded in tests/vectors/expected.txt by
//! dosbox-harness/regenerate.sh.

mod common;

use std::fs;
use std::path::Path;

#[test]
fn every_script_matches_dosbox() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/vectors");
    let expected = fs::read_to_string(dir.join("expected.txt")).expect("expected.txt");
    let mut scripts = 0;
    let mut values = 0;
    let mut failures = Vec::new();
    for line in expected
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        let mut words = line.split_whitespace();
        let name = words.next().expect("a name");
        let count: usize = words.next().expect("a count").parse().expect("a number");
        let hash = u64::from_str_radix(words.next().expect("a hash"), 16).expect("hex");
        let script = fs::read_to_string(dir.join(format!("{name}.txt"))).expect("the script");
        let out = common::script::run(&script);
        let got = common::script::fnv1a(&out);
        if out.len() != count || got != hash {
            failures.push(format!(
                "{name}: {} values hashing {got:016x}, DOSBox gave {count} hashing {hash:016x}",
                out.len()
            ));
        }
        scripts += 1;
        values += out.len();
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(scripts > 0);
    println!("{scripts} scripts, {values} values, all as DOSBox gives them");
}
