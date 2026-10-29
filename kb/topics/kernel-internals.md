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
- Of the 32 stubs, 12 are imported by Windows' own files: `ExitKernel`, `BUNNY_351`, `WriteOutProfiles`, `DiagOutput` and `K327` by USER (`K327` by GDI too); `GlobalMasterHandle` and `RegisterPtrace` by TOOLHELP; `DOSignal` and `CVWBreak` by KEYBOARD.DRV; `WinOldApCall` and `GetWinOldApHooks` by standard mode's WINOLDAP; `FlushCachedFileHandle` by Setup. Three more are taken by ordinal through `GetProcAddress`, all by TOOLHELP. The other seventeen have no caller outside KERNEL.

## How the pieces fit together

**Start-up and the end of a session.** KERNEL's loader binds a program's imports. One it cannot find is bound to [[fn:KERNEL.UndefDynlink]], so the program loads and fails only when it makes that call. The loader also fixes up the prologues of each code segment's exported functions with [[fn:KERNEL.PatchCodeHandle]]. A program's start-up calls [[fn:KERNEL.InitTask]] and then `WaitEvent`. For a task of a module with flag 08h, `LoadModule` calls the procedure [[fn:KERNEL.InitTask1]] keeps, which nothing sets. [[fn:KERNEL.InitLib]] is a library start-up in registers that no library uses. At the other end, USER's `ExitWindows` calls [[fn:KERNEL.BUNNY_351]]. That makes unhandled faults go to a system debugger first. Then comes GDI's `Death` and last [[fn:KERNEL.ExitKernel]]: libraries' `WEP`s, the mouse, keyboard and timers off, the profiles written, then [[fn:KERNEL.DisableKernel]] to hand DOS back its vectors and prefixes, and DOS's exit or a restart.

**Tasks and their queues.** USER keeps each task's message queue and asks KERNEL for it and its data: `GetTaskQueue`, `SetTaskQueue`, `GetTaskQueueDS`/`ES`, `GetTaskDS`, `PostEvent`, `LockCurrentTask`, `SetTaskSignalProc`, `GetExpWinVer`, `GetAppCompatFlags`. WinBox answers all of these ([[topic:kernel-queries]]).

**WinOldAp and DOS sessions.** Standard mode's `WINOLDAP.MOD` runs a DOS program by swapping Windows out. Before it does, it asks [[fn:KERNEL.WinOldApCall]] to close the module files KERNEL holds open. Around the switch it calls every procedure in the chain [[fn:KERNEL.GetWinOldApHooks]] answers, which [[fn:KERNEL.RegisterWinOldApHook]] builds in standard mode only. The enhanced mode's `WINOA386.MOD` uses neither; WIN386 does that work. [[fn:KERNEL.IsWinOldApTask]] marks such a task for USER and the Task List.

**DOS hooks and signals.** KERNEL hooks `INT 21h` and reaches DOS through the vector it kept, at 3Ch of its code segment, which [[fn:KERNEL.GetSetKernelDOSProc]] exchanges. Its own `INT 21h` routine is what [[fn:KERNEL.DOS3Call]] and [[fn:KERNEL.NoHookDosCall]] call. Ctrl+Break comes from the keyboard driver as [[fn:KERNEL.DOSignal]]. That finds the focus window's task, through USER procedures KERNEL looked up as it started, and calls the handler the task set with [[fn:KERNEL.SetSigHandler]].

**Debugger and TOOLHELP hooks.** KERNEL tells of its events through one routine (seg1 `9a50`). With an event code in AX, it makes `INT 41h` for a system debugger such as WDEB386, then calls the [[fn:KERNEL.ToolHelpHook]] procedure, then the [[fn:KERNEL.RegisterPtrace]] one. TOOLHELP sets the first under Windows 3.1, the second under 3.0, and builds `NotifyRegister` and `InterruptRegister` on them. [[fn:KERNEL.DebugDefineSegment]] tells of each segment loaded; it is a near routine that only KERNEL can call. [[fn:KERNEL.CVWBreak]] is the debugger's break key, which TOOLHELP answers by planting `INT 3` at the interrupted instruction. [[fn:KERNEL.THHOOK]] is no function but the address of KERNEL's variables, from 218h of its data. TOOLHELP reads the module chain, the task chain, the running task and the selector table through it; [[fn:KERNEL.GlobalMasterHandle]] gives the heap's own block from the same place. [[fn:KERNEL.DiagOutput]] writes `BOOTLOG.TXT` lines while Windows logs its start.

**Faults and parameter errors.** USER, GDI and KERNEL check a program's pointers and handles in their own code. A check that fails jumps to [[fn:KERNEL.K327]], which reports the error (to a debugger, in the retail build) and makes the API return nought to its caller, or carries on for a warning. Where they touch memory a program passed, a fault is caught instead. KERNEL's fault handler asks [[fn:KERNEL.HasGPHandler]] whether the faulting module's `__GP` table names a handler for the address ([[fn:KERNEL.__GP]] is KERNEL's own table). Only system modules are trusted: GDI, USER, KERNEL, PENWIN, DISPLAY and MMSYSTEM. Faults that no table, TOOLHELP or debugger takes go to the routine `BUNNY_351` switches.

**Memory internals.** [[fn:KERNEL.K404]] and [[fn:KERNEL.K403]] read and write a global block's owner in its arena: word 12h of KRNL386's arena, word 1 of KRNL286's. Only KERNEL calls them. [[fn:KERNEL.EMSCopy]], [[fn:KERNEL.A20Proc]], [[fn:KERNEL.ReplaceInst]], [[fn:KERNEL.ValidateFreeSpaces]] and [[fn:KERNEL.SwapRecording]] are left from real mode or from the debugging build and do nothing in retail Windows 3.1.

**Profiles and the file cache.** KERNEL holds `WIN.INI` and one private profile in memory and writes them back lazily: at a task switch, before a program's DOS call, at exit, and when asked with [[fn:KERNEL.WriteOutProfiles]]. It also keeps the files of the modules it loads open, in a small cache, closed one at a time by [[fn:KERNEL.FlushCachedFileHandle]] (Setup, before it replaces a file) or all at once by `WinOldApCall`.

## The named oddities

- **`BUNNY_351`** writes one word. It changes the routine for faults nobody handles from the Application Error path to the same path behind a system-debugger check, and USER calls it from `ExitWindows`. Without a debugger nothing changes. The name is in KERNEL's name table and says nothing of this.
- **`K327`** is the end of every parameter check in USER, GDI and KERNEL (`SwapRecording` among them). It takes a register convention: BX the code, CX:AX the value, a far return into the check. It is not a function a program could call.
- **`K403` and `K404`** set and get a block's owner. KERNEL uses the setter when it makes a task, to make the task's database its own owner.
- **`K329`** is a bare `RETF 6` ([[topic:kernel-queries]]), and `__GP` is a table of data.

## The map

Status is what WinBox does today: implemented, a retail no-op, its number for an exported constant, or a stub that logs and pops the bytes the table declares. Recommendations are sized XS (one line in each engine), S (tens of lines), M (a structure or hook of WinBox's own to keep) and L. Callers name the importing files; corpus programs are counted. "(declared)" marks the two stubs that the SDK headers do declare.

### Start-up and end

| Ord | Export                        | Callers                                                              | WinBox       | Recommendation            |
| --- | ----------------------------- | -------------------------------------------------------------------- | ------------ | ------------------------- |
| 91  | [[fn:KERNEL.InitTask]]        | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 36 more; 37 corpus programs | implemented  | done                      |
| 141 | [[fn:KERNEL.InitTask1]]       | none                                                                 | stub         | no-op (in effect)         |
| 116 | [[fn:KERNEL.InitLib]]         | none                                                                 | stub         | as Windows, if wanted (S) |
| 120 | [[fn:KERNEL.UndefDynLink]]    | KERNEL's loader                                                      | stub         | **as Windows (S-M)**      |
| 110 | [[fn:KERNEL.PatchCodeHandle]] | KERNEL's loader                                                      | stub         | not needed                |
| 2   | [[fn:KERNEL.ExitKernel]]      | USER.EXE                                                             | stub         | not needed                |
| 125 | [[fn:KERNEL.DisableKernel]]   | KERNEL (`ExitKernel`)                                                | stub         | not applicable            |
| 124 | [[fn:KERNEL.EnableKernel]]    | none                                                                 | retail no-op | done                      |
| 41  | [[fn:KERNEL.EnableDos]]       | none                                                                 | retail no-op | done                      |
| 42  | [[fn:KERNEL.DisableDos]]      | none                                                                 | retail no-op | done                      |

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

| Ord | Export                             | Callers                             | WinBox      | Recommendation                     |
| --- | ---------------------------------- | ----------------------------------- | ----------- | ---------------------------------- |
| 151 | [[fn:KERNEL.WinOldApCall]]         | WINOLDAP.MOD                        | stub        | not applicable                     |
| 343 | [[fn:KERNEL.RegisterWinOldApHook]] | none                                | stub        | **as Windows, the chain (S)**      |
| 344 | [[fn:KERNEL.GetWinOldApHooks]]     | WINOLDAP.MOD                        | stub        | **with RegisterWinOldApHook (XS)** |
| 158 | [[fn:KERNEL.IsWinOldApTask]]       | USER.EXE, WINOLDAP.MOD, TASKMAN.EXE | implemented | done                               |

### DOS hooks and signals

| Ord | Export                            | Callers                                                              | WinBox       | Recommendation          |
| --- | --------------------------------- | -------------------------------------------------------------------- | ------------ | ----------------------- |
| 139 | [[fn:KERNEL.DoSignal]]            | KEYBOARD.DRV                                                         | stub         | with SetSigHandler (S)  |
| 140 | [[fn:KERNEL.SetSigHandler]]       | none                                                                 | stub         | as Windows, if used (S) |
| 311 | [[fn:KERNEL.GetSetKernelDosProc]] | none                                                                 | stub         | not applicable          |
| 101 | [[fn:KERNEL.NoHookDosCall]]       | GDI.EXE, SYSTEM.DRV                                                  | implemented  | done                    |
| 102 | [[fn:KERNEL.Dos3Call]]            | CALC.EXE, CALENDAR.EXE, CARDFILE.EXE and 34 more; 14 corpus programs | implemented  | done                    |
| 103 | [[fn:KERNEL.NetBiosCall]]         | none                                                                 | implemented  | done                    |
| 130 | [[fn:KERNEL.FileCdr]]             | USER.EXE, WINFILE.EXE                                                | implemented  | done                    |
| 99  | [[fn:KERNEL.GetLPErrMode]]        | none                                                                 | implemented  | done                    |
| 98  | [[fn:KERNEL.GetLastDiskChange]]   | none                                                                 | implemented  | done                    |
| 75  | [[fn:KERNEL.OpenPathName]]        | none                                                                 | implemented  | done                    |
| 76  | [[fn:KERNEL.DeletePathName]]      | PRINTMAN.EXE, GDI.EXE                                                | implemented  | done                    |
| 123 | [[fn:KERNEL.KbdRst]]              | KEYBOARD.DRV                                                         | retail no-op | done                    |

### Debugger and TOOLHELP

| Ord | Export                           | Callers                                 | WinBox       | Recommendation                       |
| --- | -------------------------------- | --------------------------------------- | ------------ | ------------------------------------ |
| 332 | [[fn:KERNEL.ThHook]]             | TOOLHELP (by ordinal, `GetProcAddress`) | stub         | data, only if a reader appears (M-L) |
| 341 | [[fn:KERNEL.ToolHelpHook]]       | TOOLHELP (by ordinal, `GetProcAddress`) | stub         | not needed (M)                       |
| 202 | [[fn:KERNEL.RegisterPtrace]]     | TOOLHELP.DLL                            | stub         | no-op (XS)                           |
| 205 | [[fn:KERNEL.CVWBreak]]           | KEYBOARD.DRV                            | stub         | not applicable                       |
| 314 | [[fn:KERNEL.DebugDefineSegment]] | KERNEL (near)                           | stub         | not applicable                       |
| 318 | [[fn:KERNEL.FatalExitHook]]      | none                                    | implemented  | done                                 |
| 328 | [[fn:KERNEL._DEBUGOUTPUT]]       | none                                    | retail no-op | done                                 |
| 329 | [[fn:KERNEL.K329]]               | none                                    | retail no-op | done                                 |
| 339 | [[fn:KERNEL.DiagQuery]]          | none                                    | implemented  | done                                 |
| 340 | [[fn:KERNEL.DiagOutput]]         | USER.EXE                                | stub         | no-op (XS)                           |

### Faults and parameter errors

| Ord | Export                     | Callers                                         | WinBox | Recommendation            |
| --- | -------------------------- | ----------------------------------------------- | ------ | ------------------------- |
| 327 | [[fn:KERNEL.K327]]         | GDI.EXE, USER.EXE                               | stub   | not needed (S)            |
| 338 | [[fn:KERNEL.HasGPHandler]] | TOOLHELP (by ordinal, `GetProcAddress`); KERNEL | stub   | fixed answer, nought (XS) |
| 342 | [[fn:KERNEL.__GP]]         | KERNEL (`HasGPHandler`)                         | stub   | not applicable            |
| 351 | [[fn:KERNEL.BUNNY_351]]    | USER.EXE                                        | stub   | no-op (XS)                |

### Memory and selectors

| Ord | Export                                      | Callers                                                   | WinBox      | Recommendation                  |
| --- | ------------------------------------------- | --------------------------------------------------------- | ----------- | ------------------------------- |
| 28  | [[fn:KERNEL.GlobalMasterHandle]]            | TOOLHELP.DLL                                              | stub        | not needed; with THHOOK (M)     |
| 200 | [[fn:KERNEL.ValidateFreeSpaces]] (declared) | none                                                      | stub        | no-op (XS)                      |
| 160 | [[fn:KERNEL.EMSCopy]]                       | none                                                      | stub        | no-op (XS)                      |
| 165 | [[fn:KERNEL.A20Proc]]                       | none                                                      | stub        | no-op (XS)                      |
| 403 | [[fn:KERNEL.K403]]                          | KERNEL                                                    | stub        | with K404, after a probe (S)    |
| 404 | [[fn:KERNEL.K404]]                          | KERNEL                                                    | stub        | fixed answer, after a probe (S) |
| 201 | [[fn:KERNEL.ReplaceInst]]                   | none                                                      | stub        | no-op (XS)                      |
| 204 | [[fn:KERNEL.SwapRecording]] (declared)      | none                                                      | stub        | no-op (XS)                      |
| 159 | [[fn:KERNEL.GlobalHandleNoRIP]]             | MMSYSTEM.DLL                                              | implemented | done                            |
| 14  | [[fn:KERNEL.LocalNotify]]                   | none                                                      | implemented | done                            |
| 26  | [[fn:KERNEL.GlobalFreeAll]]                 | none                                                      | implemented | done                            |
| 161 | [[fn:KERNEL.LocalCountFree]]                | GDI.EXE, MMSYSTEM.DLL, USER.EXE                           | implemented | done                            |
| 162 | [[fn:KERNEL.LocalHeapSize]]                 | GDI.EXE, MMSYSTEM.DLL, USER.EXE                           | implemented | done                            |
| 310 | [[fn:KERNEL.LocalHandleDelta]]              | none                                                      | implemented | done                            |
| 138 | [[fn:KERNEL.GetHeapSpaces]]                 | USER.EXE                                                  | implemented | done                            |
| 126 | [[fn:KERNEL.MemoryFreed]]                   | none                                                      | implemented | done                            |
| 316 | [[fn:KERNEL.GetFreeMemInfo]]                | none                                                      | implemented | done                            |
| 168 | [[fn:KERNEL.DirectResAlloc]]                | SHELL.DLL, USER.EXE, WINHELP.EXE                          | implemented | done                            |
| 170 | [[fn:KERNEL.AllocCSToDSAlias]]              | 8514.DRV, COMM.DRV, EGA.DRV and 8 more; 7 corpus programs | implemented | done                            |
| 172 | [[fn:KERNEL.AllocAlias]]                    | none                                                      | implemented | done                            |
| 206 | [[fn:KERNEL.AllocSelectorArray]]            | WING.DLL, WINGDIB.DRV                                     | implemented | done                            |
| 196 | [[fn:KERNEL.SelectorAccessRights]]          | none                                                      | implemented | done                            |
| 180 | [[fn:KERNEL.LONGPTRADD]]                    | GDI.EXE, WINFILE.EXE                                      | implemented | done                            |
| 345 | [[fn:KERNEL.IsSharedSelector]]              | none                                                      | implemented | done                            |
| 133 | [[fn:KERNEL.GetExePtr]]                     | 8514.DRV, EGA.DRV, SUPERVGA.DRV and 2 more                | implemented | done                            |
| 323 | [[fn:KERNEL.IsRomModule]]                   | PROGMAN.EXE                                               | implemented | done                            |
| 326 | [[fn:KERNEL.IsRomFile]]                     | none                                                      | implemented | done                            |
| 94  | [[fn:KERNEL.DefineHandleTable]]             | none                                                      | implemented | done                            |

### Profiles and file cache

| Ord | Export                              | Callers   | WinBox | Recommendation |
| --- | ----------------------------------- | --------- | ------ | -------------- |
| 315 | [[fn:KERNEL.WriteOutProfiles]]      | USER.EXE  | stub   | no-op (XS)     |
| 319 | [[fn:KERNEL.FlushCachedFileHandle]] | SETUP.EXE | stub   | no-op (XS)     |

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

1. **[[fn:KERNEL.UndefDynlink]], as Windows does (S-M).** Bind every import the linker cannot resolve to it, and have it end the program with `Call to Undefined Dynalink`. Today both engines leave such a relocation unwritten, so a program that imports something missing jumps to a wild address. This is the one item that changes what an ordinary program can see.
2. **[[fn:KERNEL.RegisterWinOldApHook]] and [[fn:KERNEL.GetWinOldApHooks]], as Windows does (S).** WinBox reports standard mode, where Windows keeps the chain and answers 1. Keep it, never calling it.
3. **The exact no-ops (XS each):** `WriteOutProfiles`, `FlushCachedFileHandle`, `DiagOutput`, `BUNNY_351`, `RegisterPtrace`, `ValidateFreeSpaces`, `SwapRecording`, `EMSCopy`, `A20Proc`, `ReplaceInst`, `InitTask1`. Each pops what Windows pops and changes nothing a program can see in WinBox. Moving them to the retail no-ops only removes the stub's log line.
4. **[[fn:KERNEL.HasGPHandler]], a fixed nought (XS).** No WinBox module has a `__GP` table.
5. **[[fn:KERNEL.K404]] and [[fn:KERNEL.K403]], after a probe (S).** WinBox knows each block's owner, so the answer is a lookup; a probe should record what a program is told first.
6. **[[fn:KERNEL.SetSigHandler]] with [[fn:KERNEL.DOSignal]], if a program is found that sets a handler (S).**
7. **[[fn:KERNEL.InitLib]], as Windows does, if wanted (S).**
8. **[[fn:KERNEL.THHOOK]] with [[fn:KERNEL.GlobalMasterHandle]], only if a debugger or memory viewer turns up that reads them (M-L).**
9. Not needed or not applicable: `ExitKernel`, `DisableKernel`, `PatchCodeHandle`, `K327`, `ToolHelpHook`, `CVWBreak`, `DebugDefineSegment`, `GetSetKernelDOSProc`, `WinOldApCall`, `__GP`. Each belongs to a part of Windows WinBox replaces (USER, GDI, the loader, TOOLHELP, WINOLDAP) or to a DOS, debugger or keyboard beneath it that WinBox does not have.

## Not yet done

- No probe was written for these. Each read-out is from `KRNL386.EXE`, with its `KRNL286.EXE` offset. Probes worth making first: an import of a missing ordinal (the load, and the message when called); `K404` of a program's own blocks; `RegisterWinOldApHook`'s answer and the link it writes; `THHOOK`'s address and its words against `GetCurrentTask`.
- Which undeclared exports the SDK's printed reference documents all the same (`DOS3Call`, `NetBIOSCall`, `AllocCStoDSAlias`, `DefineHandleTable`, `GetLPErrMode` and others). The census goes by the headers alone.
- The words at 251h-257h of KERNEL's data that `WinOldApCall(0)` answers: no code of KERNEL's writes them.
- What a module's flag 08h stands for, which decides whether `LoadModule` calls `InitTask1`'s procedure.
- The event codes `ToolHelpHook` and `RegisterPtrace` procedures are called with, beyond 40h, 50h and 63h.
- Whether WinBox's loader patches exported prologues as [[fn:KERNEL.PatchCodeHandle]] does.
