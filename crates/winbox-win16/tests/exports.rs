//! The knowledge base's export tables, `kb/data/winbox-exports.json`, as
//! the Rust engine links them: each module the knowledge base publishes,
//! and by ordinal each export's name, the bytes of arguments it pops and
//! whether anything but the module's stub answers it -- a function
//! (`call::implementation`), one of KERNEL's constants or a place in the
//! module's data. The tables are `kept.rs`'s.
//!
//! The knowledge base's build (`scripts/kb/exports.ts`) and the pre-commit
//! hook read the file, so neither runs the engine. This test fails where the
//! committed file differs from what the tables say, and writes it afresh
//! with `EXPORTS_UPDATE=1`.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use winbox_win16::Kept;
use winbox_win16::call::{Answered, answered};

/// The modules the knowledge base publishes, in the order its index lists
/// them: the three the system is built on first, then the libraries in the
/// order a Windows 3.1 installation carries them, and WinG, the 1994
/// add-on (`exports.ts` marks it one).
const MODULES: [&str; 17] = [
    "KERNEL", "USER", "GDI", "KEYBOARD", "SYSTEM", "SOUND", "COMMDLG", "SHELL", "MMSYSTEM",
    "TOOLHELP", "VER", "LZEXPAND", "DDEML", "OLECLI", "OLESVR", "WIN87EM", "WING",
];

/// An entry a module's table keeps only to hold an ordinal's place, named
/// so: it declares no arguments, whatever `pops` says.
const PLACEHOLDER: &str = "unknown";

fn path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../kb/data/winbox-exports.json")
}

/// The tables as the knowledge base reads them, one export to a line.
fn tables() -> String {
    let mut out = String::from("{\n \"modules\": [\n");

    for (index, name) in MODULES.iter().enumerate() {
        let kept = Kept::any_named(name).unwrap_or_else(|| panic!("{name} kept"));
        let exports: Vec<String> = kept
            .exports
            .iter()
            .enumerate()
            .filter_map(|(ordinal, export)| Some((ordinal, export.as_ref()?)))
            .map(|(ordinal, export)| {
                let ordinal = u16::try_from(ordinal).expect("an ordinal");
                let kind = answered(kept.name, ordinal, export.name);
                let (kind_name, bytes) = match kind {
                    Answered::Constant => ("constant", None),
                    Answered::Data => ("data", None),
                    Answered::Function | Answered::Stub => (
                        "function",
                        (export.name != PLACEHOLDER).then_some(export.pops),
                    ),
                };
                format!(
                    "{{\"ordinal\": {ordinal}, \"name\": {}, \"argumentBytes\": {}, \
                     \"implemented\": {}, \"kind\": \"{kind_name}\"}}",
                    serde_json::to_string(export.name).expect("a name"),
                    bytes.map_or_else(|| "null".to_owned(), |bytes| bytes.to_string()),
                    kind != Answered::Stub,
                )
            })
            .collect();

        let _ = write!(
            out,
            "  {{\n   \"name\": {},\n   \"path\": {},\n   \"exports\": [\n    {}\n   ]\n  }}{}\n",
            serde_json::to_string(kept.name).expect("a name"),
            serde_json::to_string(kept.path).expect("a path"),
            exports.join(",\n    "),
            if index + 1 < MODULES.len() { "," } else { "" }
        );
    }

    out.push_str(" ]\n}\n");
    out
}

#[test]
fn the_knowledge_bases_export_tables_are_kept_rs() {
    let written = tables();
    let path = path();

    if std::env::var("EXPORTS_UPDATE").as_deref() == Ok("1") {
        std::fs::write(&path, &written).expect("kb/data/winbox-exports.json written");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_default();

    assert!(
        committed == written,
        "kb/data/winbox-exports.json is not what kept.rs and the engine say; \
         write it again with EXPORTS_UPDATE=1 cargo test -p winbox-win16 --test exports"
    );
}
