---
kind: function
module: DDEML
name: DdeUnaccessData
ordinal: 18
summary: Unlocks the block DdeAccessData locked.
probes: [ddexact]
topics: [ddeml-transactions]
---

## Observed behaviour

- [[measured]] It answers 1.

## Nuances

- [[read out]] It calls `GlobalUnlock` on the block and answers 1 whatever that says (`DDEML.DLL` seg1 `192f`-`1938`).

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `1916`.

## Implementation

Not WinBox's own: both engines run `DDEML.DLL` from the installation.
