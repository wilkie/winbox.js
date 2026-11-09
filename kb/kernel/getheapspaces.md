---
kind: function
module: KERNEL
name: GetHeapSpaces
ordinal: 138
summary: The free room in a module's local heap and its most, as KERNEL counts them.
versions:
  '3.1': exact
probes: [ktask2]
records: [heap]
source: crates/winbox-win16/src/kernel_calls/code.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg2 `1e4d`-`1e98`. AX is the free bytes [[fn:KERNEL.LocalCountFree]] counts, plus what the segment could grow by: the count less the segment's size, as a word. DX is 64 KiB less one less where the heap's information is.
- [[measured]] [[probe:ktask2]]: for the probe's module, D22Eh and D26Fh, beside a free count of 3AEh.

## Implementation

`src/win16/kernel/code-calls.ts`, and the Rust engine's `crates/winbox-win16/src/kernel_calls/code.rs`.
