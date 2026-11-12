//! The paging audit (`kb/guides/paging.md`, "The audit"): each of paging's
//! probes run in 386 enhanced mode as the replay runs it, but with the set
//! of present pages (`winbox_machine::Pages`) enforced -- an access by the
//! processor to a page the set does not hold given to the program's
//! handler for exception 0Eh as WIN386 gives it, error code 4 for a read
//! and 6 for a write -- and its records set beside Windows'. A record that
//! differs is either one of the cases named in [`CASES`], each with its
//! cause, or a failure. So every access a probe records that faulted in
//! Windows faults here, and every one that did not does not, but for the
//! named cases.
//!
//! An access with no handler of the program's to take it -- WinBox's own
//! code, a program's own before it puts one in -- is let through and
//! listed: the set must hold what WinBox keeps for itself.

#[path = "../../winbox-win16/tests/support/mod.rs"]
mod support;

use winbox_win16::dpmi::AuditMiss;

/// The probes audited. `pgcreg` is not: the core stops at its first `MOV`
/// from a control register, before it reaches anything.
const PROBES: &[&str] = &[
    "pgtouch", "pgbox", "pgwrite", "pgbig", "pglock", "pgheap", "pgw386", "pgfree",
];

/// The records that differ from Windows' with the set enforced, by
/// `probe:function:args` (`*` for every record of a function), each with
/// its cause.
const CASES: &[(&str, &str)] = &[
    // Where things lie: WinBox's own addresses, a descriptor index's 64 KiB
    // (the owner's decision of 2026-11-10), not KERNEL's heap or WIN386's.
    ("pgtouch:layout:*", LAYOUT),
    ("pgheap:layout:*", LAYOUT),
    ("pgfree:where:*", LAYOUT),
    ("pgfree:heap:GlobalAlloc 1 MiB", LAYOUT),
    // The page past a 0501h block of one byte: Windows had something else
    // given there (`pgtouch`'s 223 pages up to the second block, and the
    // block of 3001h bytes right after it), present and locked; WinBox's
    // block has its 64 KiB to itself, the page past it no one's.
    ("pgtouch:dpmi:0600h past the block", NEIGHBOUR),
    ("pgtouch:dpmi:0601h past the block", NEIGHBOUR),
    ("pgtouch:touch:past the block", NEIGHBOUR),
    ("pgtouch:touch:write past the block", NEIGHBOUR),
    ("pgwrite:write:past the block", NEIGHBOUR),
    ("pgtouch:scan:from the first block", NEIGHBOUR),
    ("pgtouch:scan:from the second block", NEIGHBOUR),
    ("pgtouch:scan:before the second block", NEIGHBOUR),
    (
        "pgtouch:touch:GlobalAlloc + 10000h",
        "a small block of KERNEL's lies in the first megabyte, every page around it present; 64 KiB past WinBox's is the next descriptor index's, given to nothing",
    ),
    (
        "pgtouch:touch:110000h",
        "110000h, just past the first megabyte in Windows, is in WinBox the segment of descriptor index 11h, one of WinBox's own modules' (`SYSTEM_FIRST`)",
    ),
    // FFFFF000h is WinBox's local descriptor table's last page, present.
    ("pgtouch:touch:FFFFF000h", OWN_TABLE),
    ("pgtouch:dpmi:0600h FFFFF000h", OWN_TABLE),
    ("pgtouch:dpmi:0601h FFFFF000h", OWN_TABLE),
    ("pgwrite:write:FFFFF000h", OWN_TABLE),
    (
        "pgwrite:rom:*",
        "the first megabyte's ROM: a write at C0000h and F0000h lands in WinBox, where DOSBox's machine keeps the ROM; not paging's",
    ),
    (
        "pgbig:time:*",
        "DOSBox's host's milliseconds, paging to WIN386.SWP",
    ),
    // `pgbox` has no handler of its own: KERNEL's box for a page fault is
    // phase 4's. The audit lets the read through and lists it, the read
    // Windows faulted on.
    ("pgbox:after read 1:AL", BOX),
    ("pgbox:after read 2:*", BOX),
    // A page of KERNEL's block read alone: present after the free in both,
    // but in Windows it reads a byte not nought, and in WinBox nought. Why
    // was not followed: the pages of 0501h's block read alone read nought
    // in both.
    ("pgfree:heap:after GlobalFree", READ_ALONE),
    ("pgfree:heap:after GlobalCompact", READ_ALONE),
    // 0503h growing a block: WIN386 grew it in place, the pages after it
    // free; WinBox moves a block that needs more pages, as `dpmigrw` found
    // WIN386 doing where they were not.
    ("pgfree:resize:12 pages moved", GROWN),
    ("pgfree:resize:base after 12 pages", GROWN),
];

const LAYOUT: &str =
    "where things lie: WinBox's addresses are its own (descriptor index times 64 KiB)";
const NEIGHBOUR: &str =
    "the page past a 0501h block: another's in Windows, no one's in WinBox's 64 KiB";
const OWN_TABLE: &str =
    "FFFFF000h is WinBox's own local descriptor table, present, where Windows has nothing";
const BOX: &str = "no handler of the program's: KERNEL's box for a page fault is phase 4's, and the audit lets the read through";
const READ_ALONE: &str = "a page of KERNEL's block read alone reads a byte not nought in Windows, nought in WinBox; not followed";
const GROWN: &str =
    "0503h grew the block in place in Windows, the pages after it free; WinBox moves it";

/// A record's case, where it has one.
fn case_of(probe: &str, function: &str, args: &str) -> Option<(&'static str, &'static str)> {
    let exact = format!("{probe}:{function}:{args}");
    let any = format!("{probe}:{function}:*");

    CASES
        .iter()
        .find(|&&(key, _)| key == exact || key == any)
        .copied()
}

/// A probe run with the set enforced from its start: its records and the
/// audit's stops.
fn audited(name: &str) -> Option<(Vec<[String; 3]>, Vec<AuditMiss>)> {
    let (_, records, misses) = support::run_on(
        name,
        |system| {
            system.box_hand = Some(support::box_hand(name));
            system.cpu.bus.audit_mut().on = true;
        },
        |system| {
            let engine = winbox_win16::Engine::new(system);
            let stop = engine.run(2_000_000_000, 300.0);
            let misses = engine.system().dpmi.audit.clone();

            (stop, misses)
        },
    )?;

    Some((records, misses))
}

#[test]
fn paging_probes_agree_with_the_set_enforced() {
    let mut failures = Vec::new();
    let mut used = std::collections::HashSet::new();

    for probe in PROBES {
        let name = format!("enhanced/{probe}");
        let Some(recorded) = support::recorded(&name) else {
            continue;
        };
        let Some((records, misses)) = audited(&name) else {
            eprintln!("{name}: not built");
            continue;
        };
        let answers = support::answers(&recorded, &records);
        let mut agree = 0;

        for ([function, args, windows], ours) in recorded.iter().zip(&answers) {
            if ours.is_some_and(|ours| ours == windows) {
                agree += 1;
                continue;
            }

            let ours = ours.unwrap_or("(none)");

            match case_of(probe, function, args) {
                Some((key, cause)) => {
                    used.insert(key);
                    eprintln!("{name}: {function} {args}: {ours:?}, Windows {windows:?}: {cause}");
                }
                None => failures.push(format!(
                    "{name}: {function} {args}: {ours:?}, Windows {windows:?}"
                )),
            }
        }

        eprintln!(
            "{name}: {agree} of {} records agree; {} stops",
            recorded.len(),
            misses.len()
        );

        for miss in &misses {
            eprintln!(
                "  {} {:08x} at {:04x}:{:04x}{}",
                if miss.write { "write" } else { "read" },
                miss.at,
                miss.cs,
                miss.ip,
                if miss.handled {
                    ", to the handler"
                } else {
                    ", let through"
                }
            );
        }
    }

    // A case no record needs any more is stale: the set has come to agree.
    for (key, _) in CASES {
        if !used.contains(key) {
            failures.push(format!("{key}: named, but the record agrees"));
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
