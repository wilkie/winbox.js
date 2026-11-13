//! The paging audit (`kb/guides/paging.md`, "The audit"): each of paging's
//! probes run in 386 enhanced mode as the replay runs it, the pages
//! enforced as the engine enforces them -- an access to a page not present
//! a page fault, given to the program's handler for exception 0Eh as
//! WIN386 gives it, error code 4 for a read and 6 for a write, or else to
//! KERNEL's boxes -- and its records set beside Windows'. A record that
//! differs is either one of the cases named in [`CASES`], each with its
//! kind and cause, or a failure. No case may be one where WinBox faults and
//! Windows does not (the owner's decisions of 2026-11-11): each is either
//! one where Windows faults and WinBox does not ([`Kind::Laxer`], checked
//! against Windows' record) or no fault either way.
//!
//! The `audit` feature adds a check of every access the processor makes
//! against the set, as a cross-check of the core's reach: an access it
//! stops goes to the program's handler for 0Eh, or with none is let
//! through and listed. With the core's fault in place it stops none.

#[path = "../../winbox-win16/tests/support/mod.rs"]
mod support;

use winbox_win16::dpmi::AuditMiss;

/// The probes audited.
const PROBES: &[&str] = &[
    "pgtouch", "pgbox", "pgwrite", "pgbig", "pglock", "pgheap", "pgw386", "pgfree", "pgcreg",
    "pgrom",
];

/// What a named case is. The owner's decisions of 2026-11-11: WinBox
/// faults only where Windows certainly does, so no case may be one where
/// WinBox faults and Windows does not; where Windows faults and WinBox,
/// treating memory its layout leaves unused as present, does not, the case
/// is named in the permitted direction.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// Windows faults, or refuses a lock, where WinBox does not.
    Laxer,
    /// No fault either way: where things lie, values, a lock refused.
    Other,
}

/// The records that differ from Windows', by `probe:function:args` (`*`
/// for every record of a function), each with its kind and cause.
const CASES: &[(&str, Kind, &str)] = &[
    // Where things lie: WinBox's own addresses, a descriptor index's 64 KiB
    // (the owner's decision of 2026-11-10), not KERNEL's heap or WIN386's.
    ("pgtouch:layout:*", Kind::Other, LAYOUT),
    ("pgheap:layout:*", Kind::Other, LAYOUT),
    ("pgfree:where:*", Kind::Other, LAYOUT),
    ("pgfree:heap:GlobalAlloc 1 MiB", Kind::Other, LAYOUT),
    // The page past a 0501h block of one byte: Windows had something else
    // given there, which 0600h locks; WinBox's block has its 64 KiB to
    // itself, the page past it committed to nothing, and 0600h refuses it.
    ("pgtouch:dpmi:0600h past the block", Kind::Other, NEIGHBOUR),
    ("pgtouch:dpmi:0601h past the block", Kind::Other, NEIGHBOUR),
    // Past a block's last page: memory WinBox's layout leaves unused,
    // present, where Windows has nothing there.
    ("pgtouch:scan:from the first block", Kind::Laxer, UNUSED),
    ("pgtouch:scan:from the second block", Kind::Laxer, UNUSED),
    ("pgtouch:scan:from a block of 3001h", Kind::Laxer, UNUSED),
    ("pglock:setup:pages from the block", Kind::Laxer, UNUSED),
    ("pgfree:free:after 0502h", Kind::Laxer, UNUSED),
    ("pgfree:resize:old base after 2 pages", Kind::Laxer, UNUSED),
    (
        "pgtouch:touch:far pointer as linear",
        Kind::Laxer,
        "the probe's far pointer taken as a linear address lands among WinBox's blocks, below 20000000h, memory WinBox's layout leaves unused or gives",
    ),
    (
        "pgtouch:touch:110000h",
        Kind::Laxer,
        "110000h, just past the first megabyte in Windows, is in WinBox the segment of descriptor index 11h, one of WinBox's own modules' (`SYSTEM_FIRST`)",
    ),
    // FFFFF000h is WinBox's own local descriptor table's last page, present.
    ("pgtouch:touch:FFFFF000h", Kind::Laxer, OWN_TABLE),
    ("pgtouch:dpmi:0600h FFFFF000h", Kind::Laxer, OWN_TABLE),
    ("pgtouch:dpmi:0601h FFFFF000h", Kind::Laxer, OWN_TABLE),
    ("pgwrite:write:FFFFF000h", Kind::Laxer, OWN_TABLE),
    // The first megabyte's ROM, read-only whole in WinBox as a PC's is (the
    // owner's decision of 2026-11-13); DOSBox's dynamic core leaves a page
    // writable once it has run code there.
    ("pgwrite:rom:FFFF0h read after", Kind::Other, ROM),
    ("pgrom:rom:F1FF0h", Kind::Other, ROM),
    ("pgrom:rom:FFFF0h", Kind::Other, ROM),
    (
        "pgbig:time:*",
        Kind::Other,
        "DOSBox's host's milliseconds, paging to WIN386.SWP",
    ),
    // A page of KERNEL's block read alone: present after the free in both,
    // but in Windows it reads a byte not nought, and in WinBox nought. Why
    // was not followed: the pages of 0501h's block read alone read nought
    // in both.
    ("pgfree:heap:after GlobalFree", Kind::Other, READ_ALONE),
    ("pgfree:heap:after GlobalCompact", Kind::Other, READ_ALONE),
    // 0503h growing a block: WIN386 grew it in place, the pages after it
    // free; WinBox moves a block that needs more pages, as `dpmigrw` found
    // WIN386 doing where they were not. Its page past the block is unused
    // memory in WinBox, present.
    ("pgfree:resize:12 pages moved", Kind::Other, GROWN),
    ("pgfree:resize:base after 12 pages", Kind::Laxer, GROWN),
];

const ROM: &str = "DOSBox's dynamic core leaves a ROM page writable once it has run code there; WinBox drops every write to the ROM, as the hardware does (the owner's decision of 2026-11-13)";
const LAYOUT: &str =
    "where things lie: WinBox's addresses are its own (descriptor index times 64 KiB)";
const NEIGHBOUR: &str = "the page past a 0501h block: another's in Windows, which 0600h locks; committed to nothing in WinBox, and refused";
const UNUSED: &str = "past a block's pages: memory WinBox's layout leaves unused, present (the owner's decision of 2026-11-11), where Windows has nothing";
const OWN_TABLE: &str =
    "FFFFF000h is WinBox's own local descriptor table, present, where Windows has nothing";
const READ_ALONE: &str = "a page of KERNEL's block read alone reads a byte not nought in Windows, nought in WinBox; not followed";
const GROWN: &str = "0503h grew the block in place in Windows, the pages after it free; WinBox moves it, and the page past it is unused memory, present";

/// A record's case, where it has one.
fn case_of(probe: &str, function: &str, args: &str) -> Option<(&'static str, Kind, &'static str)> {
    let exact = format!("{probe}:{function}:{args}");
    let any = format!("{probe}:{function}:*");

    CASES
        .iter()
        .find(|&&(key, _, _)| key == exact || key == any)
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
                Some((key, kind, cause)) => {
                    if kind == Kind::Laxer
                        && !["fault", "code=", "cf=1", "x"]
                            .iter()
                            .any(|mark| windows.contains(mark))
                    {
                        failures.push(format!(
                            "{key}: named as Windows faulting, but Windows {windows:?}"
                        ));
                    }

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
    for (key, _, _) in CASES {
        if !used.contains(key) {
            failures.push(format!("{key}: named, but the record agrees"));
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
