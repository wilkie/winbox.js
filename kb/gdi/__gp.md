---
kind: function
module: GDI
name: __GP
ordinal: 46
summary: GDI's table of fault handlers for its parameter checks, read by KERNEL when a fault in GDI is caught -- data, not a function; WinBox's is its end alone.
versions:
  '3.1': exact
probes: [ugaps]
records: [gp]
source: crates/winbox-win16/src/exported_data.rs
topics: [gdi-internals, kernel-internals]
---

## Observed behaviour

- [[measured]] [[probe:ugaps]]: `GetProcAddress` gives an address for it.

## Inside Windows

[[read out]] `GDI.EXE`'s ordinal 46 is seg1 `79f4`, the start of a table of entries in GDI's first code segment, each with segment relocations (seg1 `79f4`-`7a2c`): the ranges of GDI's code whose faults on a program's pointers are caught, and where to go. KERNEL's fault handler reads a system module's `__GP` table as [[fn:KERNEL.HasGPHandler]] tells.

## Callers

[[read out]] None imports it; KERNEL finds it by the module's ordinal 46.

## Implementation

**Implemented (b), data,** as KERNEL's [[fn:KERNEL.__GP]]: a table of its end alone, a selector of nought, laid where its stub would be (`crates/winbox-win16/src/exported_data.rs`). WinBox's GDI checks the pointers it is given in its own code. See [[topic:gdi-internals]].
