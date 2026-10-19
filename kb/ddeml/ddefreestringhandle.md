---
kind: function
module: DDEML
name: DdeFreeStringHandle
ordinal: 22
summary: Takes one count off a string handle's atom; the atom goes with its last count.
versions:
  '3.1': partial
probes: [ddemgmt, ddeleft, ddehsz]
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange, atoms]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: a handle made once and kept once was still found after one free and gone after two, each free answering TRUE.
- [[measured]] [[probe:ddeleft]]: freed a third time it answered FALSE.
- [[measured]] A handle of nought answers TRUE. An id whose serial is not the instance's answers FALSE.
- [[measured]] A monitor is told `MH_DELETE`, then 7, the atom deleted.
- [[measured]] [[probe:ddehsz]]: an id of nought answers FALSE and deletes nothing. [[fn:DDEML.DdeGetLastError]] of nought then answers 4003h, `DMLERR_DLL_NOT_INITIALIZED`.
- [[measured]] An id whose serial is not the instance's leaves the instance's last error as it was: 4006h, set before by a code page DDEML does not take, was still there after. The instance's own id clears it, and its error is nought after.
- [[measured]] The handle's high word is not looked at: a handle with 1234h there freed the atom. An integer atom, 5, answers TRUE.
- [[measured]] A handle one instance made can be freed by another instance of the same program, answering TRUE and taking a count off the atom. The instance that made it still deletes it once more as it ends with [[fn:DDEML.DdeUninitialize]]: an atom this program held one count of was gone after.
- [[measured]] An instance ending deletes each handle it made or kept and has not freed: made twice and freed once, made once and kept once, the atom lost one count and two as it ended. Made twice and freed twice, it lost none.

## Nuances

- [[read out]] It answers what [[fn:USER.GlobalDeleteAtom]] says, turned round: TRUE where that answered nought (`DDEML.DLL` seg1 `2ddc`). An atom already gone is not checked by KERNEL, which answers what was left in AX (`KRNL386.EXE` seg1 `4a80`): nonzero where the freed entry still held its string, and so FALSE here; nought where the local heap had written over it ([[topic:atoms]]). An integer atom KERNEL deletes by answering nought.
- [[read out]] The handle is taken out of the instance's array of the handles it made or kept, one entry of it, where it is there at all (`1a94`, `29d8`). That array is what `DdeUninitialize` deletes again. The atom is deleted whether or not the instance had it.
- [[read out]] The instance is the id's low word, and its serial, at 30h of it, must be the high word, before anything is done (`1a59`-`1a65`). So a wrong id sets no error and clears none.

## Inside Windows

[[read out]] Seg1 `1a40`: the instance checked (`1a59`-`1a65`) and its last error cleared (`1a67`); `MH_DELETE` to the monitors (`1a6c`-`1a7e`); one entry of the handle out of the instance's array at 10h (`1a81`-`1a94`); the atom deleted (`2ddc`, telling the monitors 7, and answering 1 for a handle of nought).

## Implementation

WinBox's own: `freeStringHandle` in `src/win16/ddeml/instance.ts` and `free_string_handle` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is `GlobalDeleteAtom`, told to the monitors first. [[probe:ddeleft]]'s gap is KERNEL's: an atom deleted once too often answers nought in WinBox. Both engines agree with [[probe:ddemgmt]] and [[probe:ddehsz]], and with [[probe:ddeleft]] but for that gap, with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
