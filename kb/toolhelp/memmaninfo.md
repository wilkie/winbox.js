---
kind: function
module: TOOLHELP
name: MemManInfo
ordinal: 72
summary: The memory manager's figures from DPMI, and a page of 1000h.
versions:
  '3.1': exact
probes: [thtask]
records: [memman]
source: crates/winbox-win16/src/toolhelp/misc.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `13f4`-`14a7`: DPMI's function 0500h into the structure from 4, with no check of `dwSize`.
- [[measured]] [[probe:thtask]]: TRUE, a page of 1000h, `dwSize` left nought.

## Nuances

- DOS's extender's figures belong to the machine. winbox.js answers each as FFFFFFFFh, which DPMI uses for a figure that is not known.

## Implementation

`src/win16/toolhelp/misc.ts`, and the Rust engine's `crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].
