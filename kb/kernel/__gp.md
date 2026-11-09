---
kind: function
module: KERNEL
name: __GP
ordinal: 342
summary: KERNEL's own table of the parts of its code that handle a general protection fault: data, not a function. WinBox's is its end alone, as it has no code of Windows' to fault in.
versions:
  '3.1': exact
probes: [ugaps]
records: [gp]
source: crates/winbox-win16/src/exported_data.rs
topics: [kernel-internals, exported-constants]
---

## Observed behaviour

- [[read out]] The entry is in KERNEL's code segment, `KRNL386.EXE` seg1 `a820` (`KRNL286.EXE` seg1 `97d0`). What is there is a table of words, not code. It holds records of four words: a selector, filled in by the loader's relocations; the first offset of a range; the offset past its end; and the offset of the code that handles a fault in that range. For example, seg1 `a820` holds F7h, 101h and 103h. The table ends at a selector of nought.
- [[read out]] [[fn:KERNEL.HasGPHandler]] reads such a table. It looks for an export named `__GP` in the module that owns the faulting code, and trusts the table only for `GDI`, `USER`, `KERNEL`, `PENWIN`, `DISPLAY` and `MMSYSTEM`. `USER.EXE` exports its own `__GP` at ordinal 484 and `GDI.EXE` at ordinal 46 (`kb/data/exports-3.1.json`).
- [[inferred]] The ranges are the places where KERNEL, USER and GDI touch memory a program passed them and might fault. The handler is the code that turns a fault there into an error return rather than an Application Error.
- [[measured]] [[probe:ugaps]]: `GetProcAddress` gives an address for it.

## Callers

- Nothing imports it. KERNEL finds it by name through [[fn:KERNEL.HasGPHandler]] (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (b), data.** In both engines the export is data laid where its stub would be (`exported-data.ts`, `exported_data.rs`): a table of its end alone, a selector of nought. WinBox's KERNEL has no code of Windows' to fault in, and [[fn:KERNEL.HasGPHandler]] answers nought for every address, as recorded by [[probe:kintrnl]]. See [[topic:kernel-internals]].
