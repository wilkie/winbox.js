---
kind: function
module: DDEML
name: DdeKeepStringHandle
ordinal: 24
summary: Adds a count to a string handle's atom, so that it outlives one more DdeFreeStringHandle.
probes: [ddemgmt]
topics: [dynamic-data-exchange, atoms]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: it answers the atom itself, not TRUE: the value `GlobalAddAtom` answered, which [[fn:USER.GlobalFindAtom]] finds for the string.
- [[measured]] A handle made and kept is found after one [[fn:DDEML.DdeFreeStringHandle]], and gone after two.
- [[measured]] A monitor is told `MH_KEEP`, then 6, a count added.
- [[measured]] An id whose serial is not the instance's answers FALSE.

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1aac`: the instance checked and its last error cleared; `MH_KEEP` to the monitors; the handle added to the instance's list again; the count added (`2e18`): [[fn:USER.GlobalGetAtomName]] into 255 bytes and [[fn:USER.GlobalAddAtom]] of the name, whose answer is the function's -- nought for an atom that is gone.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation, over winbox.js's own atoms.
