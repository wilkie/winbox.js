---
kind: function
module: KERNEL
name: THHOOK
ordinal: 332
summary: Not a function — the address of KERNEL's own variables at 218h of its data, the global heap, the chains of modules, prefixes and tasks, the running task and the selector table, exported so that TOOLHELP finds them in any build.
versions:
  '3.1': partial
probes: [kgaps, seltab]
records: [thhook, kernelpdb, count, entry]
source: crates/winbox-win16/src/exported_data.rs
topics: [kernel-internals, tool-helper]
---

## Observed behaviour

- [[read out]] The entry is in KERNEL's data segment, `KRNL386.EXE` seg4 `0218` and `KRNL286.EXE` seg4 `0218`, not in code. `GetProcAddress` for it answers a far pointer to KERNEL's data at 218h. Calling it would run data.
- [[read out]] What is there, from KERNEL's own use of each word:

| Offset | What                                                                                     | Where KERNEL uses it                                                     |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 218h   | the handle of the global heap's own block                                                | [[fn:KERNEL.GlobalMasterHandle]]'s AX                                    |
| 21Ah   | the selector of that block, in which the arenas are                                      | `GlobalMasterHandle`'s DX; seg1 `0ef6`                                   |
| 21Ch   | the first module database; each links to the next by its word 6                          | [[fn:KERNEL.ExitKernel]]'s walk, seg2 `0b88`-`0b9e`                      |
| 220h   | KERNEL's own program segment prefix                                                      | [[fn:KERNEL.DisableKernel]], [[fn:KERNEL.FlushCachedFileHandle]]         |
| 222h   | the first prefix of the chain of them; each links on by its word 42h                     | [[fn:KERNEL.DisableKernel]], seg1 `9d05`-`9d22`                          |
| 226h   | the first task database, in priority order                                               | the scheduler; [[topic:kernel-queries]]                                  |
| 228h   | the running task's database                                                              | everywhere: [[fn:KERNEL.GetCurrentTask]], [[fn:KERNEL.SetSigHandler]], … |
| 22Ah   | the task `LoadModule` is making                                                          | seg2 `1374`                                                              |
| 22Eh   | the length of the selector table in bytes, four for each eight selector values           | seg1 `2991`, `be75`                                                      |
| 230h   | where that table is in the global heap's own block (21Ah), each entry a selector's arena | seg1 `299d`-`29a3`, `be98`, [[fn:KERNEL.K404]]                           |

- [[read out]] TOOLHELP reads them through it, in Windows 3.1 only. When `GetVersion` answers 3.10 (0A03h), its start-up takes the far address of KERNEL's ordinal 332 with `GetProcAddress`. It keeps that address +4, +0Eh, +10h, +16h and +18h, which are the words at 21Ch, 226h, 228h, 22Eh and 230h, as the places it reads the module chain, the task chain, the running task and the selector table from (TOOLHELP seg1 `022d`-`0266`). For Windows 3.0, which has no `THHOOK`, it uses fixed offsets in KERNEL's data instead (14h, 1Eh, 20h, 324h, 326h; seg1 `026b`-`0293`).
- [[read out]] **The selector table** (`KRNL386.EXE` seg1). KERNEL finds a selector's arena at the table's offset selector ÷ 2 with its low three bits cleared, nought where that is past 22Eh (`297c`-`29a3`), and writes it there as it makes the arena (`293d`-`295f`). Both read and write through DS, the heap's own block: an entry is the arena's offset in that block, and the table's place is an offset in it too. As Windows starts (`be25`-`bf4c`), KERNEL asks DPMI 0500h how much memory there is: the table's length is 4000h, or 8000h where the unlocked pages (word 10h of the answer) are 100h or more, rounded up to 20h (`be2b`-`be75`); its place is 80h, the block's header, past room for the arenas of the largest free block ÷ 128, rounded up to 20h and no less than 8000h (`be5b`-`be98`). The block, the header, the arenas and the table, is taken of DPMI with 0501h (`beb3`), its selector's limit its end (`bef6`), and the table made noughts (`bf35`-`bf4c`). A selector past the table's end is given back as soon as it is taken (`1f16`-`1f3e`).
- [[measured]] [[probe:seltab]], in both modes: 22Eh is 8000h; 230h is 1D7C0h in standard mode and 728E0h in enhanced mode, the block's limit 257BFh and 7A8DFh, so the table ends the block. Counted as Director's projectors count them (below), the entries that are not nought are fewer than 7000; one more for a block allocated, of one selector or of two (128 KiB), one less when it is freed, none for `AllocSelector`'s selector; nought for a block's second selector and for a freed block's. An entry is a multiple of 20h, an offset in the heap's own block; the arena there holds at 08h the block's base, at 0Ch its size (`GlobalSize`), at 10h its handle, at 12h its owner -- the module for a program's segments, its prefix for a block of `GlobalAlloc`'s, FFFDh for the heap's own block -- at 14h and 15h its lock counts, at 16h its flags, 4 for a data segment. TOOLHELP reads the same words of an arena, with the next arena's offset at 0, the last naming itself (`TOOLHELP.DLL` seg1 `060f`-`06b1`).
- [[measured]] [[probe:kgaps]]: the address is KERNEL's data selector and 218h. There: [[fn:KERNEL.GlobalMasterHandle]]'s pair; `GetModuleHandle("KERNEL")`; the parent of the probe's prefix; the probe's own prefix, the newest; the probe's task as the first and the running one; nought for a task being made.

## Callers

- [[read out]] `TOOLHELP.DLL`, by ordinal through `GetProcAddress` (above). Nothing imports it, and no file holds its name (`kb/data/kernel-callers.json`).
- [[read out]] Macromedia Director's projectors (`SPR_W31.EXE`, the catalog's 19 Shockwave items; `NAMES.EXE`, `START31.EXE`) find it by name, `GetProcAddress(GetModuleHandle("KERNEL"), "THHOOK")`, and count the selector table's entries that are not nought, through a selector of their own given the heap's block's base plus 230h and the length at 22Eh, as the selectors in use. They do so only where `GetWinFlags` has `WF_ENHANCED` and `GetVersion` is not 3.0 (the program's code at its load's 064F:021E and 05CF:147F-1490); in standard mode they start from nought. They count up as they take selectors and down as they free them, and while the count, as an unsigned word, is 7000 or more (1B58h), take no memory of the heap but what purging their own blocks frees: a count gone below nought fails a movie's load with "Not enough memory to load the movie" (03E7:02FE-0366, 093F:54AA, 064F:016E). Read in WinBox, not run on Windows (the programs are the catalog's, run only in WinBox).

## Implementation

**Implemented (b), data.** `THHOOK` is an export that is data (`crates/winbox-win16/src/exported_data.rs`): `GetProcAddress` and an import of it give KERNEL's data selector and 218h, and the words from 218h to 233h are laid out as the address is first handed out and again as each call returns, since a task switches only inside a call (`crates/winbox-win16/src/kernel_calls/thhook.rs`): the heap's own block, KERNEL's module, the newest task's prefix, the head of the task chain, the running task, nought, the table's length and place.

The heap's own block ([[fn:KERNEL.GlobalMasterHandle]]) runs to the table's end, at the place [[probe:seltab]] recorded in each mode (named constants, with the read-out's reckoning). Its bytes are kept out of what WinBox counts as held, as Windows takes the block of DPMI apart from the heap. The arenas and the table are laid out from WinBox's blocks as TOOLHELP sees them, again after a call whenever the heap's blocks, its tasks or its modules have changed: an arena of 20h bytes for each block, in the order of their selectors, from 80h on, with the words above, and the entry of each block's first selector its arena's offset.

## Not yet done

- 220h, KERNEL's own prefix (`kgaps:kernelpdb`, a known gap): WinBox keeps none and writes nought.
- The heap's header (the block's first 80h bytes), an arena's word at 4 and its bytes past 16h, and the free blocks' and sentinels' arenas: not laid out. The arenas are WinBox's blocks in the order of their selectors, not of their addresses in Windows' heap.
- The table's place from WinBox's own figure of the largest free block: WinBox has the oracle's machine's, recorded.
- The chains behind the words -- module databases linked by word 6, prefixes by word 42h -- as KERNEL lays them out.
