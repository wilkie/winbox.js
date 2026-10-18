---
kind: function
module: DDEML
name: DdeKeepStringHandle
ordinal: 24
summary: Adds a count to a string handle's atom, so that it outlives one more DdeFreeStringHandle.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/instance.ts
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

WinBox's own: `keepStringHandle` in `src/win16/ddeml/instance.ts` and `keep_string_handle` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The count is added by `GlobalAddAtom` of the atom's name, as `2e18` adds it. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
