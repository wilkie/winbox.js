---
kind: function
module: USER
name: UserSeeUserDo
ordinal: 216
summary: A request on USER's own data segment: LocalAlloc, LocalFree or LocalCompact in USER's heap, or one of two of USER's words.
versions:
  '3.1': partial
probes: [strfunc]
records: [seeuser]
source: crates/winbox-win16/src/user_internals.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:strfunc]]: request 1 (16 bytes, `LMEM_FIXED`) answers a handle, 2 of it nought, 3 non-nought, 4 and 5 non-nought, and requests 0 and 6 answer -1 in DX:AX.

## Inside Windows

- [[read out]] `USER.EXE` seg41 `181e`-`186c`: three arguments, the request, a word and a double word (8 bytes); USER's data segment in DS; by the request: 1 `LocalAlloc` of the word's flags and the double word's low word's bytes; 2 `LocalFree` of the word; 3 `LocalCompact` of the low word; 4 the word at 1C4h; 5 the word at F2h -- the head of USER's list of classes, as SignalProc's loop at seg1 `0a66` walks it; each answered in AX with DX nought. Any other request answers -1 in DX and AX.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

`src/win16/user/internals.ts`; `crates/winbox-win16/src/user_internals.rs`. WinBox keeps USER's objects in itself, and its USER's data segment holds no local heap and none of USER's words: the heap's requests answer what WinBox's KERNEL answers for a segment with no heap (nought, the handle back, nought), and 4 and 5 read noughts. A known gap of [[probe:strfunc]], with TOOLHELP's view of USER's heap ([[topic:tool-helper]]).
