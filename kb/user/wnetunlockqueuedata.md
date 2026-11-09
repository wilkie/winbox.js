---
kind: function
module: USER
name: WNetUnlockQueueData
ordinal: 511
summary: A network queue's data unlocked: with no network driver, WN_NOT_SUPPORTED.
versions:
  '3.1': exact
probes: [wnetall]
records: [ok]
topics: [small-queries]
source: crates/winbox-win16/src/wnet.rs
---

## Observed behaviour

- [[measured]] [[probe:wnetall]]: 1, `WN_NOT_SUPPORTED`, with arguments it takes, on the oracle's Windows, which has no network.

## Inside Windows

- [[read out]] `USER.EXE` seg22: its arguments checked first -- lpszQueue -- a pointer by touching it, a window by its class's signature; one that fails answers 4 (`WN_BAD_POINTER`), or 5 (`WN_BAD_VALUE`) where a window is checked, and KERNEL is told (`HandleParamError`). Then the network driver's function, from the table USER filled as Windows started; with no network driver, 1, `WN_NOT_SUPPORTED` (seg22 `0770`-`0790`).

## Implementation

`crates/winbox-win16/src/user_misc.rs`. The checks are not followed: a call with good arguments is answered.
