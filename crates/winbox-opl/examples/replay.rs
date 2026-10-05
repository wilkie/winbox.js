//! Runs a test script (see dosbox-harness/harness.cpp) against the port
//! and writes every value it produces to standard output as little-endian
//! 32-bit integers, as the harness does, for comparing the two in detail:
//!
//! ```text
//! cargo run -p winbox-opl --example replay -- tests/vectors/rhythm.txt > rust.bin
//! ```

#[path = "../tests/common/script.rs"]
mod script;

use std::io::Write;

fn main() {
    let path = std::env::args().nth(1).expect("a script");
    let text = std::fs::read_to_string(path).expect("the script");
    let out = script::run(&text);
    eprintln!("{} values, FNV-1a {:016x}", out.len(), script::fnv1a(&out));
    let bytes: Vec<u8> = out.iter().flat_map(|v| v.to_le_bytes()).collect();
    std::io::stdout()
        .write_all(&bytes)
        .expect("standard output");
}
