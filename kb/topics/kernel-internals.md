---
kind: topic
name: KERNEL's internal exports
summary: The map of KERNEL's exports that no SDK header declares — who imports each across the Windows installations and the corpus, what each does inside Windows 3.1 as read out of KRNL386.EXE, how they fit together by family, and whether WinBox should answer each, with a rough size.
---

KERNEL exports 233 entries in Windows 3.1. The SDK's headers declare 130 of them as functions a program calls; the other 103 are KERNEL's internals. Windows' own parts call them: USER, GDI, the drivers, WINOLDAP, TOOLHELP, Setup. Programs call them only where the SDK's start-up code or its assembler conventions put a call in (`InitTask`, `WaitEvent`, `DOS3Call`, the numbers such as `__AHINCR`). This page is their map. Each export has its own page, linked from the tables below, with its read-out, its callers and a recommendation.

## How the census was made

`scripts/kb/kernel-callers.mjs` reads every `NE` file under the folders it is given. It was run over the twelve installations under `oracle/build/drive-c*` and the corpus programs; it reads them and never runs them. For each file it takes the imports out of its relocation records, by ordinal and by name, through the module reference and imported names tables. It writes `kb/data/kernel-callers.json`: for each KERNEL export, the Windows files and the corpus files that import it. A file that imports `GetProcAddress` and holds an export's name as a string of its own is listed apart, as a hint. A lookup by ordinal through `GetProcAddress` leaves no name, so those callers come from the read-outs: TOOLHELP finds `THHOOK`, `ToolHelpHook`, `HasGPHandler` and `FatalExitHook` that way (TOOLHELP seg1 `0076`-`00f4`, `022d`-`0240`).

- 128 Windows `NE` files and 62 corpus `NE` files were read. The same file in several installations is counted once; no `NE` file differs between them. The virtual device drivers and `WIN386.EXE` are `LE` and `W3` files and import nothing from KERNEL. `WING32.DLL` is a `PE` file.
- **Documented** here means declared as a function in Open Watcom's headers for Windows 3.x (`h/win/*.h`, which follow the Windows 3.1 SDK's `windows.h`). The census records the header for each export (`declaredIn`). It is the only list of the SDK's functions the repository has. Earlier pages called a few undeclared calls documented (`GetLPErrMode`, `DefineHandleTable`, `OpenPathName` and others under [[topic:kernel-queries]]). They are counted as undeclared here, and settling each against the SDK's printed reference is left below.
- Of the 103 undeclared exports, 56 are imported by some file. The corpus imports only seven of them: [[fn:KERNEL.InitTask]] and [[fn:KERNEL.WaitEvent]] (all 37 programs, from the C start-up), [[fn:KERNEL.DOS3Call]] (14), [[fn:KERNEL.AllocCStoDSAlias]] (7), and the numbers `__WINFLAGS` (14), `__AHINCR` (13) and `__AHSHIFT` (11). No corpus program imports any of the 32 exports WinBox leaves as stubs.
- Of the 32 stubs, 12 are imported by Windows' own files: `ExitKernel`, `BUNNY_351`, `WriteOutProfiles`, `DiagOutput` and `K327` by USER (`K327` by GDI too); `GlobalMasterHandle` and `RegisterPtrace` by TOOLHELP; `DOSignal` and `CVWBreak` by KEYBOARD.DRV; `WinOldApCall` and `GetWinOldApHooks` by standard mode's WINOLDAP; `FlushCachedFileHandle` by Setup. Three more are taken by ordinal through `GetProcAddress`, all by TOOLHELP. The other seventeen have no caller outside KERNEL. Fourteen of the 32 were answered by the first pass; the last pass answered seventeen more (below), and the last, `EMSCopy`, is answered as the oracle runs it ([[probe:emspast]]).

## How the pieces fit together

**Start-up and the end of a session.** KERNEL's loader binds a program's imports. One it cannot find is bound to [[fn:KERNEL.UndefDynlink]], so the program loads and fails only when it makes that call. The loader also fixes up the prologues of each code segment's exported functions with [[fn:KERNEL.PatchCodeHandle]]. A program's start-up calls [[fn:KERNEL.InitTask]] and then `WaitEvent`. For a task of a module with flag 08h, `LoadModule` calls the procedure [[fn:KERNEL.InitTask1]] keeps, which nothing sets. That flag is not the header's 08h: a program linked so was started with a procedure set, and it was not called ([[probe:kintrnl]]). [[fn:KERNEL.InitLib]] is a library start-up in registers that no library uses. At the other end, USER's `ExitWindows` calls [[fn:KERNEL.BUNNY_351]]. That makes unhandled faults go to a system debugger first. Then comes GDI's `Death` and last [[fn:KERNEL.ExitKernel]]: libraries' `WEP`s, the mouse, keyboard and timers off, the profiles written, then [[fn:KERNEL.DisableKernel]] to hand DOS back its vectors and prefixes, and DOS's exit or a restart.

**Tasks and their queues.** USER keeps each task's message queue and asks KERNEL for it and its data: `GetTaskQueue`, `SetTaskQueue`, `GetTaskQueueDS`/`ES`, `GetTaskDS`, `PostEvent`, `LockCurrentTask`, `SetTaskSignalProc`, `GetExpWinVer`, `GetAppCompatFlags`. WinBox answers all of these ([[topic:kernel-queries]]).

**WinOldAp and DOS sessions.** Standard mode's `WINOLDAP.MOD` runs a DOS program by swapping Windows out. Before it does, it asks [[fn:KERNEL.WinOldApCall]] to close the module files KERNEL holds open. Around the switch it calls every procedure in the chain [[fn:KERNEL.GetWinOldApHooks]] answers, which [[fn:KERNEL.RegisterWinOldApHook]] builds in standard mode only. The enhanced mode's `WINOA386.MOD` uses neither; WIN386 does that work. [[fn:KERNEL.IsWinOldApTask]] marks such a task for USER and the Task List.

**DOS hooks and signals.** KERNEL hooks `INT 21h` and reaches DOS through the vector it kept, at 3Ch of its code segment, which [[fn:KERNEL.GetSetKernelDOSProc]] exchanges. Its own `INT 21h` routine is what [[fn:KERNEL.DOS3Call]] and [[fn:KERNEL.NoHookDosCall]] call. Ctrl+Break comes from the keyboard driver as [[fn:KERNEL.DOSignal]]. That finds the focus window's task, through USER procedures KERNEL looked up as it started, and calls the handler the task set with [[fn:KERNEL.SetSigHandler]].

**Debugger and TOOLHELP hooks.** KERNEL tells of its events through one routine (seg1 `9a50`). With an event code in AX, it makes `INT 41h` for a system debugger such as WDEB386, then calls the [[fn:KERNEL.ToolHelpHook]] procedure, then the [[fn:KERNEL.RegisterPtrace]] one. TOOLHELP sets the first under Windows 3.1, the second under 3.0, and builds `NotifyRegister` and `InterruptRegister` on them. [[fn:KERNEL.DebugDefineSegment]] tells of each segment loaded; it is a near routine that only KERNEL can call. [[fn:KERNEL.CVWBreak]] is the debugger's break key, which TOOLHELP answers by planting `INT 3` at the interrupted instruction. [[fn:KERNEL.THHOOK]] is no function but the address of KERNEL's variables, from 218h of its data. TOOLHELP reads the module chain, the task chain, the running task and the selector table through it; [[fn:KERNEL.GlobalMasterHandle]] gives the heap's own block from the same place. [[fn:KERNEL.DiagOutput]] writes `BOOTLOG.TXT` lines while Windows logs its start.

**Faults and parameter errors.** USER, GDI and KERNEL check a program's pointers and handles in their own code. A check that fails jumps to [[fn:KERNEL.K327]], which reports the error (to a debugger, in the retail build) and makes the API return nought to its caller, or carries on for a warning. Where they touch memory a program passed, a fault is caught instead. KERNEL's fault handler asks [[fn:KERNEL.HasGPHandler]] whether the faulting module's `__GP` table names a handler for the address ([[fn:KERNEL.__GP]] is KERNEL's own table). Only system modules are trusted: GDI, USER, KERNEL, PENWIN, DISPLAY and MMSYSTEM. Faults that no table, TOOLHELP or debugger takes go to the routine `BUNNY_351` switches.

**Memory internals.** [[fn:KERNEL.K404]] and [[fn:KERNEL.K403]] read and write a global block's owner in its arena: word 12h of KRNL386's arena, word 1 of KRNL286's. Only KERNEL calls them. [[fn:KERNEL.EMSCopy]], [[fn:KERNEL.A20Proc]], [[fn:KERNEL.ReplaceInst]], [[fn:KERNEL.ValidateFreeSpaces]] and [[fn:KERNEL.SwapRecording]] are left from real mode or from the debugging build and do nothing in retail Windows 3.1. `SwapRecording` leaves the flag in AX and 167h in DX all the same. `EMSCopy`'s entry lies past the end of KERNEL's code once start-up is over. On a 386 a call to it would fault; DOSBox runs what lies there, the first routine of `MMSYSTEM`'s first code segment, `timeGetSystemTime` ([[probe:emscopy]], [[probe:emspast]]).

**Profiles and the file cache.** KERNEL holds `WIN.INI` and one private profile in memory and writes them back lazily: at a task switch, before a program's DOS call, at exit, and when asked with [[fn:KERNEL.WriteOutProfiles]]. It also keeps the files of the modules it loads open, in a small cache, closed one at a time by [[fn:KERNEL.FlushCachedFileHandle]] (Setup, before it replaces a file) or all at once by `WinOldApCall`.

## The named oddities

- **`BUNNY_351`** writes one word. It changes the routine for faults nobody handles from the Application Error path to the same path behind a system-debugger check, and USER calls it from `ExitWindows`. Without a debugger nothing changes. The name is in KERNEL's name table and says nothing of this.
- **`K327`** is the end of every parameter check in USER, GDI and KERNEL (`SwapRecording` among them). It takes a register convention: BX the code, CX:AX the value, a far return into the check. It is not a function a program could call.
- **`K403` and `K404`** set and get a block's owner. KERNEL uses the setter when it makes a task, to make the task's database its own owner.
- **`K329`** is a bare `RETF 6` ([[topic:kernel-queries]]), and `__GP` is a table of data.

## The map

Status is what WinBox does today: implemented, a retail no-op, its number for an exported constant, data at its address, or a stub that logs and pops the bytes the table declares. Of the last pass, (a) marks an export a program can observe, answered as Windows does; (b) one that is data; (c) one only Windows' own start-up, shutdown or code reaches, given the answer of a call. Recommendations are sized XS (one line in the engine), S (tens of lines), M (a structure or hook of WinBox's own to keep) and L. Callers name the importing files; corpus programs are counted. "(declared)" marks the two stubs that the SDK headers do declare.

### Start-up and end

| Ord | Export                        | Callers                                                              | WinBox         | Recommendation             |
| --- | ----------------------------- | -------------------------------------------------------------------- | -------------- | -------------------------- |
| 91  | [[fn:KERNEL.InitTask]]        | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 36 more; 37 corpus programs | implemented    | done                       |
| 141 | [[fn:KERNEL.InitTask1]]       | none                                                                 | implemented    | done                       |
| 116 | [[fn:KERNEL.InitLib]]         | none                                                                 | implemented    | done (a) ([[probe:kgaps]]) |
| 120 | [[fn:KERNEL.UndefDynLink]]    | KERNEL's loader                                                      | implemented    | done                       |
| 110 | [[fn:KERNEL.PatchCodeHandle]] | KERNEL's loader                                                      | implemented    | done (a) ([[probe:kgaps]]) |
| 2   | [[fn:KERNEL.ExitKernel]]      | USER.EXE                                                             | end of session | done (c), not measured     |
| 125 | [[fn:KERNEL.DisableKernel]]   | KERNEL (`ExitKernel`)                                                | retail no-op   | done (c), not measured     |
| 124 | [[fn:KERNEL.EnableKernel]]    | none                                                                 | retail no-op   | done                       |
| 41  | [[fn:KERNEL.EnableDos]]       | none                                                                 | retail no-op   | done                       |
| 42  | [[fn:KERNEL.DisableDos]]      | none                                                                 | retail no-op   | done                       |

### Tasks and queues

| Ord | Export                          | Callers                                                              | WinBox      | Recommendation |
| --- | ------------------------------- | -------------------------------------------------------------------- | ----------- | -------------- |
| 30  | [[fn:KERNEL.WaitEvent]]         | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 29 more; 37 corpus programs | implemented | done           |
| 31  | [[fn:KERNEL.PostEvent]]         | USER.EXE                                                             | implemented | done           |
| 32  | [[fn:KERNEL.SetPriority]]       | none                                                                 | implemented | done           |
| 33  | [[fn:KERNEL.LockCurrentTask]]   | USER.EXE                                                             | implemented | done           |
| 122 | [[fn:KERNEL.IsTaskLocked]]      | MMSYSTEM.DLL                                                         | implemented | done           |
| 34  | [[fn:KERNEL.SetTaskQueue]]      | USER.EXE                                                             | implemented | done           |
| 35  | [[fn:KERNEL.GetTaskQueue]]      | USER.EXE                                                             | implemented | done           |
| 118 | [[fn:KERNEL.GetTaskQueueDS]]    | USER.EXE                                                             | implemented | done           |
| 119 | [[fn:KERNEL.GetTaskQueueES]]    | USER.EXE                                                             | implemented | done           |
| 155 | [[fn:KERNEL.GetTaskDS]]         | USER.EXE                                                             | implemented | done           |
| 38  | [[fn:KERNEL.SetTaskSignalProc]] | USER.EXE                                                             | implemented | done           |
| 117 | [[fn:KERNEL.OldYield]]          | MMTASK.TSK, USER.EXE                                                 | implemented | done           |
| 105 | [[fn:KERNEL.GetExeVersion]]     | GDI.EXE, USER.EXE                                                    | implemented | done           |
| 167 | [[fn:KERNEL.GetExpWinVer]]      | GDI.EXE, USER.EXE                                                    | implemented | done           |
| 354 | [[fn:KERNEL.GetAppCompatFlags]] | COMM.DRV, GDI.EXE, PSCRIPT.DRV, USER.EXE                             | implemented | done           |
| 157 | [[fn:KERNEL.GetCurPID]]         | SHELL.DLL                                                            | implemented | done           |
| 53  | [[fn:KERNEL.CallProcInstance]]  | none                                                                 | implemented | done           |

### WinOldAp

| Ord | Export                             | Callers                             | WinBox      | Recommendation                  |
| --- | ---------------------------------- | ----------------------------------- | ----------- | ------------------------------- |
| 151 | [[fn:KERNEL.WinOldApCall]]         | WINOLDAP.MOD                        | implemented | done (a); KERNEL's prefix a gap |
| 343 | [[fn:KERNEL.RegisterWinOldApHook]] | none                                | implemented | done                            |
| 344 | [[fn:KERNEL.GetWinOldApHooks]]     | WINOLDAP.MOD                        | implemented | done                            |
| 158 | [[fn:KERNEL.IsWinOldApTask]]       | USER.EXE, WINOLDAP.MOD, TASKMAN.EXE | implemented | done                            |

### DOS hooks and signals

| Ord | Export                            | Callers                                                              | WinBox       | Recommendation               |
| --- | --------------------------------- | -------------------------------------------------------------------- | ------------ | ---------------------------- |
| 139 | [[fn:KERNEL.DoSignal]]            | KEYBOARD.DRV                                                         | implemented  | done (a); DS a gap           |
| 140 | [[fn:KERNEL.SetSigHandler]]       | none                                                                 | implemented  | done (a) ([[probe:kgaps]])   |
| 311 | [[fn:KERNEL.GetSetKernelDosProc]] | none                                                                 | implemented  | done (a); first answer a gap |
| 101 | [[fn:KERNEL.NoHookDosCall]]       | GDI.EXE, SYSTEM.DRV                                                  | implemented  | done                         |
| 102 | [[fn:KERNEL.Dos3Call]]            | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 34 more; 14 corpus programs | implemented  | done                         |
| 103 | [[fn:KERNEL.NetBiosCall]]         | none                                                                 | implemented  | done                         |
| 130 | [[fn:KERNEL.FileCdr]]             | USER.EXE, WINFILE.EXE                                                | implemented  | done                         |
| 99  | [[fn:KERNEL.GetLPErrMode]]        | none                                                                 | implemented  | done                         |
| 98  | [[fn:KERNEL.GetLastDiskChange]]   | none                                                                 | implemented  | done                         |
| 75  | [[fn:KERNEL.OpenPathName]]        | none                                                                 | implemented  | done                         |
| 76  | [[fn:KERNEL.DeletePathName]]      | PRINTMAN.EXE, GDI.EXE                                                | implemented  | done                         |
| 123 | [[fn:KERNEL.KbdRst]]              | KEYBOARD.DRV                                                         | retail no-op | done                         |

### Debugger and TOOLHELP

| Ord | Export                           | Callers                                 | WinBox       | Recommendation                  |
| --- | -------------------------------- | --------------------------------------- | ------------ | ------------------------------- |
| 332 | [[fn:KERNEL.ThHook]]             | TOOLHELP (by ordinal, `GetProcAddress`) | data         | done (b); 220h, 22Eh, 230h gaps |
| 341 | [[fn:KERNEL.ToolHelpHook]]       | TOOLHELP (by ordinal, `GetProcAddress`) | implemented  | done (a), never called          |
| 202 | [[fn:KERNEL.RegisterPtrace]]     | TOOLHELP.DLL                            | implemented  | done                            |
| 205 | [[fn:KERNEL.CVWBreak]]           | KEYBOARD.DRV                            | retail no-op | done (c) ([[probe:kgaps]])      |
| 314 | [[fn:KERNEL.DebugDefineSegment]] | KERNEL (near)                           | retail no-op | done (c), not measured          |
| 318 | [[fn:KERNEL.FatalExitHook]]      | none                                    | implemented  | done                            |
| 328 | [[fn:KERNEL._DEBUGOUTPUT]]       | none                                    | retail no-op | done                            |
| 329 | [[fn:KERNEL.K329]]               | none                                    | retail no-op | done                            |
| 339 | [[fn:KERNEL.DiagQuery]]          | none                                    | implemented  | done                            |
| 340 | [[fn:KERNEL.DiagOutput]]         | USER.EXE                                | retail no-op | done                            |

### Faults and parameter errors

| Ord | Export                     | Callers                                         | WinBox       | Recommendation             |
| --- | -------------------------- | ----------------------------------------------- | ------------ | -------------------------- |
| 327 | [[fn:KERNEL.K327]]         | GDI.EXE, USER.EXE                               | implemented  | done (a) ([[probe:kgaps]]) |
| 338 | [[fn:KERNEL.HasGPHandler]] | TOOLHELP (by ordinal, `GetProcAddress`); KERNEL | implemented  | done                       |
| 342 | [[fn:KERNEL.__GP]]         | KERNEL (`HasGPHandler`)                         | data         | done (b), an empty table   |
| 351 | [[fn:KERNEL.BUNNY_351]]    | USER.EXE                                        | retail no-op | done                       |

### Memory and selectors

| Ord | Export                                      | Callers                                                   | WinBox       | Recommendation                                    |
| --- | ------------------------------------------- | --------------------------------------------------------- | ------------ | ------------------------------------------------- |
| 28  | [[fn:KERNEL.GlobalMasterHandle]]            | TOOLHELP.DLL                                              | implemented  | done (a); no arenas laid out                      |
| 200 | [[fn:KERNEL.ValidateFreeSpaces]] (declared) | none                                                      | retail no-op | done                                              |
| 160 | [[fn:KERNEL.EMSCopy]]                       | none                                                      | implemented  | done: MMSYSTEM's code past it ([[probe:emspast]]) |
| 165 | [[fn:KERNEL.A20Proc]]                       | none                                                      | retail no-op | done                                              |
| 403 | [[fn:KERNEL.K403]]                          | KERNEL                                                    | implemented  | done ([[probe:kowner]])                           |
| 404 | [[fn:KERNEL.K404]]                          | KERNEL                                                    | implemented  | done ([[probe:kowner]])                           |
| 201 | [[fn:KERNEL.ReplaceInst]]                   | none                                                      | retail no-op | done                                              |
| 204 | [[fn:KERNEL.SwapRecording]] (declared)      | none                                                      | implemented  | done                                              |
| 159 | [[fn:KERNEL.GlobalHandleNoRIP]]             | MMSYSTEM.DLL                                              | implemented  | done                                              |
| 14  | [[fn:KERNEL.LocalNotify]]                   | none                                                      | implemented  | done                                              |
| 26  | [[fn:KERNEL.GlobalFreeAll]]                 | none                                                      | implemented  | done                                              |
| 161 | [[fn:KERNEL.LocalCountFree]]                | GDI.EXE, MMSYSTEM.DLL, USER.EXE                           | implemented  | done                                              |
| 162 | [[fn:KERNEL.LocalHeapSize]]                 | GDI.EXE, MMSYSTEM.DLL, USER.EXE                           | implemented  | done                                              |
| 310 | [[fn:KERNEL.LocalHandleDelta]]              | none                                                      | implemented  | done                                              |
| 138 | [[fn:KERNEL.GetHeapSpaces]]                 | USER.EXE                                                  | implemented  | done                                              |
| 126 | [[fn:KERNEL.MemoryFreed]]                   | none                                                      | implemented  | done                                              |
| 316 | [[fn:KERNEL.GetFreeMemInfo]]                | none                                                      | implemented  | done                                              |
| 168 | [[fn:KERNEL.DirectResAlloc]]                | SHELL.DLL, USER.EXE, WINHELP.EXE                          | implemented  | done                                              |
| 170 | [[fn:KERNEL.AllocCSToDSAlias]]              | 8514.DRV, COMM.DRV, EGA.DRV and 8 more; 7 corpus programs | implemented  | done                                              |
| 172 | [[fn:KERNEL.AllocAlias]]                    | none                                                      | implemented  | done                                              |
| 206 | [[fn:KERNEL.AllocSelectorArray]]            | WING.DLL, WINGDIB.DRV                                     | implemented  | done                                              |
| 196 | [[fn:KERNEL.SelectorAccessRights]]          | none                                                      | implemented  | done                                              |
| 180 | [[fn:KERNEL.LONGPTRADD]]                    | GDI.EXE, WINFILE.EXE                                      | implemented  | done                                              |
| 345 | [[fn:KERNEL.IsSharedSelector]]              | none                                                      | implemented  | done                                              |
| 133 | [[fn:KERNEL.GetExePtr]]                     | 8514.DRV, EGA.DRV, SUPERVGA.DRV and 2 more                | implemented  | done                                              |
| 323 | [[fn:KERNEL.IsRomModule]]                   | PROGMAN.EXE                                               | implemented  | done                                              |
| 326 | [[fn:KERNEL.IsRomFile]]                     | none                                                      | implemented  | done                                              |
| 94  | [[fn:KERNEL.DefineHandleTable]]             | none                                                      | implemented  | done                                              |

### Profiles and file cache

| Ord | Export                              | Callers   | WinBox       | Recommendation |
| --- | ----------------------------------- | --------- | ------------ | -------------- |
| 315 | [[fn:KERNEL.WriteOutProfiles]]      | USER.EXE  | implemented  | done           |
| 319 | [[fn:KERNEL.FlushCachedFileHandle]] | SETUP.EXE | retail no-op | done           |

### Exported numbers

| Ord | Export                   | Callers                                                                 | WinBox     | Recommendation |
| --- | ------------------------ | ----------------------------------------------------------------------- | ---------- | -------------- |
| 113 | [[fn:KERNEL.__AHSHIFT]]  | CARDFILE.EXE, CLIPBRD.EXE, PACKAGER.EXE and 16 more; 11 corpus programs | its number | done           |
| 114 | [[fn:KERNEL.__AHINCR]]   | PACKAGER.EXE, PRINTMAN.EXE, SETUP.EXE and 29 more; 13 corpus programs   | its number | done           |
| 173 | [[fn:KERNEL.__ROMBIOS]]  | KEYBOARD.DRV, SYSTEM.DRV, WINFILE.EXE                                   | its number | done           |
| 174 | [[fn:KERNEL.__A000H]]    | EGA.DRV, SUPERVGA.DRV, SVGA256.DRV and 3 more                           | its number | done           |
| 178 | [[fn:KERNEL.__WINFLAGS]] | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 57 more; 14 corpus programs    | its number | done           |
| 179 | [[fn:KERNEL.__D000H]]    | none                                                                    | its number | done           |
| 181 | [[fn:KERNEL.__B000H]]    | none                                                                    | its number | done           |
| 182 | [[fn:KERNEL.__B800H]]    | HERCULES.DRV                                                            | its number | done           |
| 183 | [[fn:KERNEL.__0000H]]    | none                                                                    | its number | done           |
| 190 | [[fn:KERNEL.__E000H]]    | none                                                                    | its number | done           |
| 193 | [[fn:KERNEL.__0040H]]    | COMM.DRV, SYSTEM.DRV                                                    | its number | done           |
| 194 | [[fn:KERNEL.__F000H]]    | COMM.DRV                                                                | its number | done           |
| 195 | [[fn:KERNEL.__C000H]]    | WING.DLL                                                                | its number | done           |

### USER's string calls

| Ord | Export                  | Callers | WinBox      | Recommendation |
| --- | ----------------------- | ------- | ----------- | -------------- |
| 77  | [[fn:KERNEL.Reserved1]] | GDI.EXE | implemented | done           |
| 78  | [[fn:KERNEL.Reserved2]] | GDI.EXE | implemented | done           |
| 79  | [[fn:KERNEL.Reserved3]] | none    | implemented | done           |
| 80  | [[fn:KERNEL.Reserved4]] | none    | implemented | done           |
| 87  | [[fn:KERNEL.Reserved5]] | GDI.EXE | implemented | done           |

## Recommendations, ranked

1. **[[fn:KERNEL.UndefDynlink]], as Windows does: done.** WinBox's linkers bind every import they cannot resolve to it, and it ends the program with `Call to Undefined Dynalink` through `FatalAppExit`'s box ([[probe:undefdl]]). KERNEL's and USER's placeholder entries, at ordinals Windows does not export, were taken out of their tables for it, so `GetProcAddress` of those answers nought as in Windows.
2. **[[fn:KERNEL.RegisterWinOldApHook]] and [[fn:KERNEL.GetWinOldApHooks]], as Windows does: done.** The chain is kept in the callers' records and never called ([[probe:kintrnl]]).
3. **The no-ops: done, but for `EMSCopy`.** `FlushCachedFileHandle`, `DiagOutput`, `BUNNY_351`, `ValidateFreeSpaces`, `A20Proc` and `ReplaceInst` are retail no-ops. Four leave something in AX, which the census's pages had missed: `WriteOutProfiles` leaves KERNEL's data selector; `RegisterPtrace` and `InitTask1` leave the pointer's selector; `SwapRecording` leaves the flag, with 167h in DX ([[probe:kintrnl]]). `EMSCopy` is not a no-op: its entry is past the end of KERNEL's code (below).
4. **[[fn:KERNEL.HasGPHandler]], a fixed nought: done.** Nought is what the read-out gives for any address whose module is not one of the six system names or has no `__GP` table ([[probe:kintrnl]]).
5. **[[fn:KERNEL.K404]] and [[fn:KERNEL.K403]]: done.** [[probe:kowner]] recorded what a program is told -- the module for its segments, its database and a `GMEM_SHARE` block, the prefix for a block it allocated, the task for its database, nought for the prefix itself -- and WinBox answers it from WinBox's own record of each block.
6. **The last of them, by [[probe:kgaps]] and [[probe:ugaps]]: done.**
   - (a) [[fn:KERNEL.SetSigHandler]] and [[fn:KERNEL.DOSignal]] keep a task's action and handler in WinBox's record of it and call the handler of the focus window's task; [[fn:KERNEL.InitLib]] makes the heap from CX; [[fn:KERNEL.PatchCodeHandle]] answers the handle and its selector, the loader having patched the prologues; [[fn:KERNEL.WinOldApCall]] answers its registers; [[fn:KERNEL.ToolHelpHook]] and [[fn:KERNEL.GetSetKernelDOSProc]] exchange their procedures; [[fn:KERNEL.K327]] unwinds a parameter check's frame; [[fn:KERNEL.GlobalMasterHandle]] answers a fixed block of KERNEL's.
   - (b) [[fn:KERNEL.THHOOK]] is KERNEL's data at 218h, its words written as each call returns; [[fn:KERNEL.__GP]] is a table of its end alone, as USER's and GDI's are.
   - (c) [[fn:KERNEL.ExitKernel]] ends WinBox's session; [[fn:KERNEL.DisableKernel]], [[fn:KERNEL.DebugDefineSegment]] and [[fn:KERNEL.CVWBreak]] return, popping what their own returns pop.
7. **[[fn:KERNEL.EMSCopy]]: done.** [[probe:emspast]] found the block past KERNEL's code: `MMSYSTEM`'s code segment 1, whose first routine is `timeGetSystemTime` (`MMSYSTEM.DLL` seg1 `0000`-`0026`). DOSBox checks no offset against a code segment's limit and runs it; WinBox answers `EMSCopy` as that routine. On a 386 the call is a general protection fault, which KERNEL's handler (seg1 `5fa2`, `5e1b`, `5c80`) turns into "Application Error" and the program's end; WinBox follows the oracle.

## Not yet done

- Each read-out is from `KRNL386.EXE`, with its `KRNL286.EXE` offset. [[probe:undefdl]], [[probe:kintrnl]] and [[probe:emscopy]] record the first four recommendations. [[probe:kowner]] records `K404` and `K403`. [[probe:kgaps]] records the last pass's.
- Where `EMSCopy`'s entry is: [[probe:emscopy]]'s `entry` and [[probe:emspast]]'s `entry`, `block` and `bytes` are known gaps. WinBox lays out no KERNEL code segment cut at A940h, and its `MMSYSTEM` is its own.
- The procedures `RegisterPtrace` and `ToolHelpHook` set are never called in WinBox, since it tells no debugger of KERNEL's events, nor is the one `GetSetKernelDOSProc` sets.
- KERNEL's own prefix, which `THHOOK`'s 220h and `WinOldApCall(1)` give and every task's prefix names as its parent (`kgaps:kernelpdb`); DS the task's database for a `DoSignal` handler (`kgaps:dosignalds`); `GetSetKernelDOSProc`'s first answer (`kgaps:dosprocold`).
- The global heap's header and arenas in `GlobalMasterHandle`'s block, the selector table at `THHOOK`'s 22Eh and 230h, and the module and prefix chains behind its words, laid out as KERNEL lays them.
- Ctrl+Break from WinBox's keyboard calling `DoSignal`, and `CVWBreak`'s popped word loaded into the flags.
- Which undeclared exports the SDK's printed reference documents all the same (`DOS3Call`, `NetBIOSCall`, `AllocCStoDSAlias`, `DefineHandleTable`, `GetLPErrMode` and others). The census goes by the headers alone.
- The words at 251h-257h of KERNEL's data that `WinOldApCall(0)` answers: no code of KERNEL's writes them.
- What a module's flag 08h stands for, which decides whether `LoadModule` calls `InitTask1`'s procedure. It is not the header's 08h, the flag `option protmode` sets ([[probe:kintrnl]]).
- The event codes `ToolHelpHook` and `RegisterPtrace` procedures are called with, beyond 40h, 50h and 63h.
