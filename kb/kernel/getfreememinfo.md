---
kind: function
module: KERNEL
name: GetFreeMemInfo
ordinal: 316
summary: The free pages DPMI counts where Windows runs with paging; FFFFFFFFh in standard mode.
versions:
  '3.1': exact
probes: [ktask]
records: [memory]
source: src/win16/kernel/retail.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `127e`-`12ad`: where bit 3 of the byte at 325h of KERNEL's data is set, the pages and free pages from DPMI's function 0500h. Otherwise FFFFFFFFh.
- [[measured]] [[probe:ktask]]: FFFFFFFFh, in standard mode.

## Implementation

`src/win16/kernel/retail.ts`, and the Rust engine's `kernel_calls/retail.rs`.
