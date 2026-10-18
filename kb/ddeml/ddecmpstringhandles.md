---
kind: function
module: DDEML
name: DdeCmpStringHandles
ordinal: 36
summary: Compares two string handles as numbers, -1, 0 or 1: the same string is the same atom, whatever its capitals.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange, atoms]
---

## Observed behaviour

- [[measured]] [[probe:ddemgmt]]: a handle with itself is 0. `Service` against `Zebra` was -1 and `Zebra` against `Service` 1, as their atoms ordered. A handle against nought is 1, nought against a handle -1.
- [[measured]] A handle with a high word of 1 against the same atom with none is 1, and the other way -1: the whole double word is compared.

## Nuances

- [[read out]] Nothing is looked up: no instance, no string (`DDEML.DLL` seg1 `1bb0`). Two strings that differ only in capitals are one atom ([[topic:atoms]]), so they compare 0; but the order of different strings is their atoms' order, not their letters'.

## Implementation

WinBox's own: `cmpStringHandles` in `src/win16/ddeml/instance.ts` and `cmp_string_handles` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. The two are compared as unsigned doublewords. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
