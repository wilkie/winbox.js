---
kind: function
module: KERNEL
name: HasGPHandler
ordinal: 338
summary: Whether a general protection fault at an address is one that USER, GDI, KERNEL or a few other system modules handle themselves. It answers the handler's offset from that module's __GP table, or nought.
topics: [kernel-internals, application-errors, tool-helper]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `4c72`-`4d36` (`KRNL286.EXE` seg1 `4512`). Its argument is a far address, the faulting CS:IP, four bytes popped.
  1. The owner of CS ([[fn:KERNEL.K404]]'s routine) must be a valid selector whose segment is present and which holds a module database (`NE`). If not, it answers nought (`4c78`-`4c98`).
  2. The module's name, the first entry of its resident names (word 26h), must be one in KERNEL's list at AA0h of its data: `GDI`, `USER`, `KERNEL`, `PENWIN`, `DISPLAY`, `MMSYSTEM` (`4c9b`-`4cc6`). No other module's table is trusted.
  3. It looks in the same resident names for an entry named `__GP` and finds the address of its ordinal (seg1 `4fe7`, as `GetProcAddress` finds one) (`4cc8`-`4cfd`).
  4. That address must be a present segment. The table there is records of four words: a selector, a first offset, an offset past the last, and the offset of the handler. It ends at a selector of nought. The first record for CS whose range holds IP gives the answer, the handler's offset; none gives nought (`4cff`-`4d30`).
- [[read out]] KERNEL's own fault handler asks it first. If it answers, the handler pushes the faulting CS and IP on the faulting stack and resumes at the handler's offset in the same segment (seg1 `5e3e`-`5e66`). Only otherwise are TOOLHELP, a debugger and the Application Error box told. See [[fn:KERNEL.__GP]] for KERNEL's own table.
- Not yet measured.

## Callers

- [[read out]] KERNEL's fault handler (seg1 `5e46`).
- [[read out]] `TOOLHELP.DLL` looks it up with `GetProcAddress(GetModuleHandle("KERNEL"), 338)` as it starts (TOOLHELP seg1 `00b2`-`00c2`) and calls it from its fault handling (seg1 `23a3`-`23b5`), so that a program's `InterruptRegister` callback does not see the faults these modules handle themselves.
- No file imports it by ordinal or by name (`kb/data/kernel-callers.json`; a lookup by ordinal leaves no name for the census to find).

## Implementation

A stub in both engines. WinBox's USER, GDI and KERNEL are its own and take no faults to recover from, and its TOOLHELP is its own.

**Recommendation: implement as a fixed answer, nought.** No module of WinBox's has a `__GP` table, so nought is what Windows would answer for any address WinBox's own code can fault at. A program that calls it, a debugger perhaps, then learns nothing is handled. That is one line in each engine. See [[topic:kernel-internals]].
