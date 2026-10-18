---
kind: function
module: DDEML
name: DdeAccessData
ordinal: 17
summary: Locks a data handle's block and answers a far pointer to its data, past DDE's header, and its size.
versions:
  '3.1': exact
probes: [ddexact]
source: src/win16/ddeml/data.ts
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

WinBox's own: `accessData` in `src/win16/ddeml/data.ts` and `access_data` in `crates/winbox-win16/src/ddeml/data.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It answers `GlobalLock`'s pointer past the header. Both engines agree with [[probe:ddexact]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
