---
kind: function
module: KERNEL
name: FreeModule
ordinal: 46
summary: The same code as FreeLibrary -- a module's count let down by its instance or its module's handle.
versions:
  '3.1': exact
records: [usage]
probes: [modnum]
source: src/win16/kernel/LoadLibrary.ts
topics: [dynamic-link-libraries]
---

## Observed behaviour

- [[measured]] [[probe:modnum]] loads `MAIN.CPL` twice, counting 2, then calls `FreeModule`, found by its ordinal, with its instance: 1. Then with its module's handle: 0, and its name finds it no more.

## Inside Windows

- [[read out]] `FreeModule` (`KRNL386.EXE` seg2 `0176`) and [[fn:KERNEL.FreeLibrary]] (seg2 `018a`) are the same: each checks the handle (seg2 `02bb`) and goes on to seg2 `0cf2`, which finds the module with `GetExePtr` (seg1 `4e78`), so either an instance or a module's handle will do. What is left in AX is not an answer of its own.

## Implementation

Both engines give it [[fn:KERNEL.FreeLibrary]]'s code. Like `FreeLibrary`, it answers nothing.
