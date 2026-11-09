---
kind: function
module: KERNEL
name: DeletePathName
ordinal: 76
summary: A file deleted as named, or else in each of PATH's directories, as OpenPathName does with DOS's 41h.
versions:
  '3.1': exact
probes: [kmore]
records: [path]
source: crates/winbox-win16/src/kernel_calls/more.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `04b6`-`04bd`: 4100h is put under the path on the stack, and `OpenPathName` follows.
- [[measured]] [[probe:kmore]]: a file there deleted answers DOS's AX, 4100h; again, FFFFh.

## Implementation

`src/win16/kernel/more-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/more.rs`.
