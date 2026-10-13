---
kind: function
module: DDEML
name: DdeQueryNextServer
ordinal: 5
summary: The conversations of a list one by one, in the order of its window's children; nought after the last.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: the conversations of a list made by [[fn:DDEML.DdeConnectList]] came in the order they were made; of a list made again from an old one, in the order the old ones were moved in, the last moved first.
- [[measured]] A conversation that is not one, 00010001h, answered nought and `DMLERR_INVALIDPARAMETER`, 4006h.

## Nuances

- [[read out]] With no conversation, the list window's first child (`GW_CHILD`); after one, its next sibling (`GW_HWNDNEXT`), so long as that is a child of the list and not the first again (`DDEML.DLL` seg1 `099c`-`0a2c`). Each answered as `MAKELONG(` the window `,` its word 4 `)`.
- [[read out]] A list's handle that is not a list's sets `DMLERR_INVALIDPARAMETER` on every instance of the calling task (`095c`-`097a`).

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation, over winbox.js's own `GetWindow`; the order rests on where `CreateWindow` and [[fn:USER.SetParent]] link a child among its siblings.
