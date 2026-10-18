---
kind: function
module: DDEML
name: DdeFreeStringHandle
ordinal: 22
summary: Takes one count off a string handle's atom; the atom goes with its last count.
versions:
  '3.1': partial
probes: [ddemgmt, ddeleft]
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange, atoms]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: a handle made once and kept once was still found after one free and gone after two, each free answering TRUE.
- [[measured]] [[probe:ddeleft]]: freed a third time it answered FALSE.
- [[measured]] A handle of nought answers TRUE. An id whose serial is not the instance's answers FALSE.
- [[measured]] A monitor is told `MH_DELETE`, then 7, the atom deleted.

## Nuances

- [[read out]] It answers what [[fn:USER.GlobalDeleteAtom]] says, turned round: TRUE where that answered nought (`DDEML.DLL` seg1 `2ddc`). An atom already gone is not checked by KERNEL, which answers what was left in AX (`KRNL386.EXE` seg1 `4a80`): nonzero where the freed entry still held its string, and so FALSE here; nought where the local heap had written over it ([[topic:atoms]]).
- [[read out]] The handle is taken out of the instance's list, one entry of it (`1a94`).

## Inside Windows

[[read out]] Seg1 `1a40`: the instance checked and its last error cleared; `MH_DELETE` to the monitors; the handle out of the instance's list; the atom deleted (`2ddc`, telling the monitors 7).

## Implementation

WinBox's own: `freeStringHandle` in `src/win16/ddeml/instance.ts` and `free_string_handle` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is `GlobalDeleteAtom`, told to the monitors first. [[probe:ddeleft]]'s gap is KERNEL's: an atom deleted once too often answers nought in WinBox. Both engines agree with [[probe:ddemgmt]], and with [[probe:ddeleft]] but for that gap, with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
