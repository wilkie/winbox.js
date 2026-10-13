---
kind: function
module: DDEML
name: DdeFreeStringHandle
ordinal: 22
summary: Takes one count off a string handle's atom; the atom goes with its last count.
probes: [ddemgmt, ddeleft]
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

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation. winbox.js's `GlobalDeleteAtom` answers nought for an atom already gone, so the third free in [[probe:ddeleft]] answers TRUE: a known gap ([[topic:dynamic-data-exchange]]).
