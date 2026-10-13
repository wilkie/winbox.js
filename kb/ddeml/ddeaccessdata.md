---
kind: function
module: DDEML
name: DdeAccessData
ordinal: 17
summary: Locks a data handle's block and answers a far pointer to its data, past DDE's header, and its size.
probes: [ddexact]
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] For `abcdefgh` made with an item it answers a pointer to `abcdef…` and a size of 28.

## Nuances

- [[read out]] The pointer is `GlobalLock`'s plus four, or plus nought for a block with no header; the size is `GlobalSize`'s less the same (`DDEML.DLL` seg1 `18bb`-`18f9`).
- [[measured]] It answers a far pointer. Open Watcom's header declares a near one, which keeps only the offset; the probe calls it through a pointer to a function answering a far one.
- [[read out]] It does not check that the handle is the application's or writable.

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `188a`.

## Implementation

Not WinBox's own: both engines run `DDEML.DLL` from the installation.
