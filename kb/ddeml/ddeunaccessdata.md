---
kind: function
module: DDEML
name: DdeUnaccessData
ordinal: 18
summary: Unlocks the block DdeAccessData locked.
versions:
  '3.1': exact
probes: [ddexact]
source: crates/winbox-win16/src/ddeml/mod.rs
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] It answers 1.

## Nuances

- [[read out]] It calls `GlobalUnlock` on the block and answers 1 whatever that says (`DDEML.DLL` seg1 `192f`-`1938`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1916`.

## Implementation

WinBox's own: `unaccess_data` in `crates/winbox-win16/src/ddeml/data.rs` follows `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is `GlobalUnlock` of the block. WinBox agrees with [[probe:ddexact]], with `DDEML.DLL` on the drive and without it (`crates/winbox-win16/tests/ddeml.rs`).
