---
kind: function
module: DDEML
name: DdeQueryNextServer
ordinal: 5
summary: The conversations of a list one by one, in the order of its window's children; nought after the last.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: the conversations of a list made by [[fn:DDEML.DdeConnectList]] came in the order they were made; of a list made again from an old one, in the order the old ones were moved in, the last moved first.
- [[measured]] A conversation that is not one, 00010001h, answered nought and `DMLERR_INVALIDPARAMETER`, 4006h.

## Nuances

- [[read out]] With no conversation, the list window's first child (`GW_CHILD`); after one, its next sibling (`GW_HWNDNEXT`), so long as that is a child of the list and not the first again (`DDEML.DLL` seg1 `099c`-`0a2c`). Each answered as `MAKELONG(` the window `,` its word 4 `)`.
- [[read out]] A list's handle that is not a list's sets `DMLERR_INVALIDPARAMETER` on every instance of the calling task (`095c`-`097a`).

## Implementation

WinBox's own: `queryNextServer` in `src/win16/ddeml/conv.ts` and `query_next_server` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It walks the list's children with [[fn:USER.GetWindow]], as the file does. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
