---
kind: function
module: KERNEL
name: THHOOK
ordinal: 332
summary: Not a function — the address of KERNEL's own variables at 218h of its data, the global heap, the chains of modules, prefixes and tasks, the running task and the selector table, exported so that TOOLHELP finds them in any build.
versions:
  '3.1': partial
probes: [kgaps]
records: [thhook, kernelpdb]
source: src/win16/kernel/thhook.ts
topics: [kernel-internals, tool-helper]
---

## Observed behaviour

- [[read out]] The entry is in KERNEL's data segment, `KRNL386.EXE` seg4 `0218` and `KRNL286.EXE` seg4 `0218`, not in code. `GetProcAddress` for it answers a far pointer to KERNEL's data at 218h. Calling it would run data.
- [[read out]] What is there, from KERNEL's own use of each word:

| Offset | What                                                                                   | Where KERNEL uses it                                                     |
| ------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 218h   | the handle of the global heap's own block                                              | [[fn:KERNEL.GlobalMasterHandle]]'s AX                                    |
| 21Ah   | the selector of that block, in which the arenas are                                    | `GlobalMasterHandle`'s DX; seg1 `0ef6`                                   |
| 21Ch   | the first module database; each links to the next by its word 6                        | [[fn:KERNEL.ExitKernel]]'s walk, seg2 `0b88`-`0b9e`                      |
| 220h   | KERNEL's own program segment prefix                                                    | [[fn:KERNEL.DisableKernel]], [[fn:KERNEL.FlushCachedFileHandle]]         |
| 222h   | the first prefix of the chain of them; each links on by its word 42h                   | [[fn:KERNEL.DisableKernel]], seg1 `9d05`-`9d22`                          |
| 226h   | the first task database, in priority order                                             | the scheduler; [[topic:kernel-queries]]                                  |
| 228h   | the running task's database                                                            | everywhere: [[fn:KERNEL.GetCurrentTask]], [[fn:KERNEL.SetSigHandler]], … |
| 22Ah   | the task `LoadModule` is making                                                        | seg2 `1374`                                                              |
| 22Eh   | the length of the selector table, in four-byte entries (one per eight selector values) | seg1 `2991`                                                              |
| 230h   | the linear address of that table, each entry the linear address of a selector's arena  | seg1 `299d`-`29a3`, [[fn:KERNEL.K404]]                                   |

- [[read out]] TOOLHELP reads them through it, in Windows 3.1 only. When `GetVersion` answers 3.10 (0A03h), its start-up takes the far address of KERNEL's ordinal 332 with `GetProcAddress`. It keeps that address +4, +0Eh, +10h, +16h and +18h, which are the words at 21Ch, 226h, 228h, 22Eh and 230h, as the places it reads the module chain, the task chain, the running task and the selector table from (TOOLHELP seg1 `022d`-`0266`). For Windows 3.0, which has no `THHOOK`, it uses fixed offsets in KERNEL's data instead (14h, 1Eh, 20h, 324h, 326h; seg1 `026b`-`0293`).
- [[measured]] [[probe:kgaps]]: the address is KERNEL's data selector and 218h. There: [[fn:KERNEL.GlobalMasterHandle]]'s pair; `GetModuleHandle("KERNEL")`; the parent of the probe's prefix; the probe's own prefix, the newest; the probe's task as the first and the running one; nought for a task being made.

## Callers

- [[read out]] `TOOLHELP.DLL`, by ordinal through `GetProcAddress` (above). Nothing imports it, and no file holds its name (`kb/data/kernel-callers.json`).

## Implementation

**Implemented (b), data.** `THHOOK` is an export that is data in both engines (`exported-data.ts`, `exported_data.rs`): `GetProcAddress` and an import of it give KERNEL's data selector and 218h, and the words from 218h to 22Bh are laid out as the address is first handed out and again as each call returns, since a task switches only inside a call (`kernel/thhook.ts`, `kernel_calls/thhook.rs`): the heap's own block, KERNEL's module, the newest task's prefix, the head of the task chain, the running task, nought.

## Not yet done

- 220h, KERNEL's own prefix (`kgaps:kernelpdb`, a known gap): WinBox keeps none and writes nought.
- 22Eh and 230h, the selector table: WinBox has none and writes nothing there.
- The chains behind the words -- module databases linked by word 6, prefixes by word 42h, the master block's arenas -- as KERNEL lays them out.
