//! Prints what `winbox-ne` reads of each file named on standard input, a
//! line each, in the form `test/scratch` compares with winbox.js's own
//! reading.

use std::io::{self, BufRead, Write};

use winbox_ne::{EntryPoint, Executable, ResourceId, Target};

#[allow(clippy::too_many_lines)]
fn main() {
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in io::stdin().lock().lines() {
        let path = line.expect("a path");

        if path.is_empty() {
            continue;
        }

        writeln!(out, "file {path}").unwrap();

        let bytes = std::fs::read(&path).expect("the file");
        let Ok(exe) = Executable::parse(bytes) else {
            writeln!(out, "not-ne").unwrap();
            continue;
        };
        let h = &exe.header;

        writeln!(
            out,
            "header cs={} ip={} ss={} sp={} ds={} flags={} heap={} stack={} segs={}",
            h.entry_cs,
            h.entry_ip,
            h.stack_ss,
            h.stack_sp,
            h.auto_data_segment,
            h.flags,
            h.initial_heap_size,
            h.initial_stack_size,
            h.segment_count
        )
        .unwrap();

        for (index, s) in exe.segments.iter().enumerate() {
            writeln!(
                out,
                "seg {} offset={} length={} min={} data={} movable={} preload={} writable={} iterated={}",
                index + 1,
                s.offset,
                s.length,
                s.min_allocation,
                s.data(),
                s.movable(),
                s.preload(),
                s.writable(),
                s.iterated()
            )
            .unwrap();

            for r in &s.relocations {
                let target = match &r.target {
                    Target::Internal { segment, offset } => format!("internal {segment}:{offset}"),
                    Target::Ordinal(ordinal) => format!("ordinal {ordinal}"),
                    Target::ImportOrdinal { module, ordinal } => {
                        format!("importordinal {module}.{ordinal}")
                    }
                    Target::ImportName {
                        module,
                        name_offset,
                        procedure,
                    } => format!("importname {module}.{procedure}@{name_offset}"),
                    Target::OsFixup(kind) => format!("osfixup {kind}"),
                };

                writeln!(
                    out,
                    "  rel at={} type={} additive={} {target}",
                    r.offset, r.address_type, r.additive
                )
                .unwrap();
            }
        }

        for (ordinal, entry) in exe.entry_points.iter().enumerate().skip(1) {
            let (kind, flags) = match *entry {
                EntryPoint::Unused => ("unused".to_string(), 0),
                EntryPoint::Movable {
                    segment,
                    offset,
                    flags,
                } => (format!("movable {segment}:{offset}"), flags),
                EntryPoint::Fixed {
                    segment,
                    offset,
                    flags,
                } => (format!("fixed {segment}:{offset}"), flags),
                EntryPoint::Constant { value, flags } => (format!("constant {value}"), flags),
            };

            writeln!(out, "entry {ordinal} {kind} flags={flags}").unwrap();
        }

        for name in &exe.resident_names {
            writeln!(out, "resident {} {}", name.name, name.ordinal).unwrap();
        }

        for name in &exe.nonresident_names {
            writeln!(out, "nonresident {} {}", name.name, name.ordinal).unwrap();
        }

        for module in &exe.module_references {
            writeln!(out, "module {module}").unwrap();
        }

        for kind in &exe.resources {
            let id = match &kind.id {
                ResourceId::Number(number) => number.to_string(),
                ResourceId::Name(_) => "?".to_string(),
            };

            writeln!(
                out,
                "restype {id} name={} count={}",
                kind.name.clone().unwrap_or_default(),
                kind.entries.len()
            )
            .unwrap();

            for r in &kind.entries {
                let id = match &r.id {
                    ResourceId::Number(number) => number.to_string(),
                    ResourceId::Name(name) => name.clone(),
                };

                writeln!(
                    out,
                    "  res {id} offset={} length={} flags={} name={}",
                    r.offset,
                    r.length,
                    r.flags,
                    r.name.clone().unwrap_or_default()
                )
                .unwrap();
            }
        }
    }
}
