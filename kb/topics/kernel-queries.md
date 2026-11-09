---
kind: topic
name: KERNEL's small calls
summary: KERNEL's calls about tasks, modules and selectors — its list of tasks and what each task's database keeps, a module found from any handle, selectors set straight in their descriptors — and the calls the retail Windows 3.1 makes do nothing, as the ktask probe recorded them.
probes: [ktask, ktask2, thtask, kmore, kevent, reshand, kbreak, mmtaskc, gfreeal]
---

KERNEL keeps a database for each task and each module, and many of its small calls just read or write a word of one. Others write a descriptor directly, or do nothing at all in the retail build. Each is [[read out]] of `KRNL386.EXE` and recorded by [[probe:ktask]], which reaches each call by its ordinal through `GetProcAddress`. WinBox agrees with all its records but one, KERNEL's own prefix.

## The tasks

[[read out]] KERNEL chains its tasks' databases from the word at 226h of its data, by priority with the lowest first (seg1 `843d`-`848b`). A task made goes before the tasks of its priority already there. A task switched to is moved after the others of its priority (seg1 `811e`-`812b`), and [[fn:KERNEL.SetPriority]] moves a task the same way. [[fn:KERNEL.GetCurrentTask]] answers the head of this list in DX. TOOLHELP's `TaskFirst` walks it ([[topic:tool-helper]]).

A task's database holds what these calls read:

| TDB | What                                         | Calls                                                                                      |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 6   | events                                       | [[fn:KERNEL.PostEvent]], TOOLHELP's `wcEvents`                                             |
| 8   | priority, -32 to 15                          | [[fn:KERNEL.SetPriority]]                                                                  |
| 1Ah | the Windows version its program was made for | [[fn:KERNEL.GetExeVersion]]                                                                |
| 1Ch | its instance                                 | [[fn:KERNEL.GetTaskDS]]                                                                    |
| 20h | its queue                                    | [[fn:KERNEL.GetTaskQueue]], [[fn:KERNEL.SetTaskQueue]], `GetTaskQueueDS`, `GetTaskQueueES` |
| 22h | the task that made it                        | TOOLHELP's `hTaskParent`                                                                   |
| 4Eh | compatibility flags                          | [[fn:KERNEL.GetAppCompatFlags]]                                                            |
| 60h | its program segment prefix                   | [[fn:KERNEL.GetCurrentPDB]]                                                                |
| FAh | `TD`, which [[fn:KERNEL.IsTask]] checks      |                                                                                            |

winbox.js keeps these beside its own tasks (`crates/winbox-win16/src/task_order.rs`). It also gives a program's module a handle, as Windows does. [[measured]] [[probe:thtask]] finds the probe's own module by its handle and in the chain. Before this, winbox.js answered nought for a program's module. As on Windows, the handle is the selector of the module's database, so its low two bits are 3 (`modhand`). A program reads its module's header through it ([[probe:solodata]]). winbox.js's block holds the file's header, from its `NE` to the end of its entry table, and not the bits KERNEL sets in its flags. The block is let go with the program's last instance. A task's own handle still names no module ([[probe:modnum]]).

## Modules from handles

[[fn:KERNEL.GetExePtr]] finds the module of a module handle, of a task's instance, or of any block a module or a task owns (seg1 `4e78`-`4eff`). [[fn:KERNEL.IsSharedSelector]] answers whether that module is a library.

## Selectors

[[fn:KERNEL.SetSelectorBase]] and [[fn:KERNEL.SetSelectorLimit]] write straight into the descriptor through KERNEL's alias of the local table and check nothing (seg1 `2725`-`2798`). [[fn:KERNEL.SelectorAccessRights]] reads or sets the type and flags, masked with D01Eh, the setting done through DPMI. [[fn:KERNEL.AllocSelectorArray]] makes selectors one after another. [[fn:KERNEL.AllocAlias]] makes a code alias.

## Code segments and the heap

[[fn:KERNEL.GetCodeHandle]] follows a `MakeProcInstance` thunk to its procedure and answers the handle of the code segment it is in, its selector in DX (seg1 `48fa`-`4924`). [[fn:KERNEL.GetCodeInfo]] copies that segment's entry in its module's table, for an address or for a module's handle and a segment's number (seg1 `48bd`-`48f7`). [[fn:KERNEL.GetHeapSpaces]] counts a module's local heap as `LocalCountFree` does (seg2 `1e4d`-`1e98`). [[measured]] [[probe:ktask2]], which agrees with all its records.

[[fn:KERNEL.SetTaskSignalProc]] exchanges the procedure KERNEL signals for a task (TDB 2Ah). [[fn:KERNEL.SetSwapAreaSize]], [[fn:KERNEL.MemoryFreed]], [[fn:KERNEL.GetLastDiskChange]], [[fn:KERNEL.GlobalLRUOldest]] and [[fn:KERNEL.GlobalLRUNewest]] answer as KERNEL does where nothing is swapped or discarded. [[fn:KERNEL.NoHookDosCall]] is `Dos3Call`'s.

## Nothing, in the retail build

The exports no SDK header declares, and who calls each, are mapped in [[topic:kernel-internals]].

`EnableDos`, `DisableDos`, `EnableKernel`, `KbdRst`, `_DEBUGOUTPUT`, `K329` and `ValidateCodeSegments` are bare returns. `LogError` and `LogParamError` tell a debugger through `INT 41h` where one is there, and otherwise do nothing. `GetWinDebugInfo` and `SetWinDebugInfo` answer nought, `DiagQuery` answers nought, and `LimitEmsPages` and `GetCurPID` answer nought. `GetFreeMemInfo` answers FFFFFFFFh in standard mode. [[measured]] [[probe:ktask]] for those that answer anything. KERNEL's ordinals 77 to 80, `Reserved1` to `Reserved4`, hand on to USER's `AnsiNext`, `AnsiPrev`, `AnsiUpper` and `AnsiLower`. `Reserved5` compares two strings without regard to case.

## Events

A task's database counts its events at 6. [[fn:KERNEL.PostEvent]] counts one up; [[fn:KERNEL.WaitEvent]] takes one, or gives the processor up until one comes (seg1 `7ca8`-`7cfc`). `LoadModule` gives a task it makes one (seg2 `1383`), which a program's start-up takes. [[measured]] [[probe:kevent]].

## The rest of the documented calls

[[measured]] [[probe:kmore]], which agrees whole:

- [[fn:KERNEL.GetLPErrMode]] answers a far pointer to the byte at 32Ah of KERNEL's data, one while KERNEL passes a program's DOS call on.
- [[fn:KERNEL.LONGPTRADD]] moves a pointer on by moving its selector's base, and each of a block's selectors after it.
- [[fn:KERNEL.NetBiosCall]] is `INT 5Ch`, which with no network changes nothing.
- [[fn:KERNEL.DefineHandleTable]] keeps a table of handles in the task's data segment, its entries cleared.
- [[fn:KERNEL.GlobalDosAlloc]] gives a fixed block in the first megabyte, its selector and real-mode segment; [[fn:KERNEL.GlobalDosFree]] frees one. WinBox gives them from segment 16D2h, where Windows gave the first, one after another.
- [[fn:KERNEL.CallProcInstance]] jumps to a procedure as a `MakeProcInstance` thunk does, ES:BX the instance and the procedure.
- [[fn:KERNEL.SwitchStackTo]] and [[fn:KERNEL.SwitchStackBack]] move the stack into a segment of the program's own, the caller's frame copied, and back.
- [[fn:KERNEL.OpenPathName]] and [[fn:KERNEL.DeletePathName]] open or delete a file as named, or else in each of PATH's directories.
- [[fn:KERNEL.GlobalFreeAll]] frees every block a task owns, not those it made with `GMEM_SHARE` ([[probe:gfreeal]]).
- [[fn:KERNEL.DebugBreak]] is `INT 3`, which with no debugger goes on ([[probe:kbreak]]). [[fn:KERNEL.OldYield]] gives the processor up with no look at USER's queue.
- [[fn:KERNEL.FatalExit]] is, in the retail build, [[fn:KERNEL.FatalAppExit]] with KERNEL's own text: USER's Application Error box, then the task ended. The hook [[fn:KERNEL.FatalExitHook]] keeps is never called.

## Resource handlers

Each type of a module's resources has a handler, which [[fn:KERNEL.LoadResource]] and [[fn:KERNEL.LockResource]] call to load one: KERNEL's own (seg1 `88c8`) until [[fn:KERNEL.SetResourceHandler]] sets another. A handler makes the resource's block with [[fn:KERNEL.AllocResource]] or [[fn:KERNEL.DirectResAlloc]]. A discardable resource is loaded only as it is locked. [[measured]] [[probe:reshand]]. A module's icons and cursors have USER's handlers, which [[fn:USER.SignalProc]] sets as the module is loaded and which make the resource USER's own block ([[probe:iconhand]]). WinBox calls a program's handler, and loads at once with its own.

## Not yet done

- KERNEL's own prefix in [[fn:KERNEL.GetCurrentPDB]]'s DX.
- A queue of nought before `InitApp`.
- A discardable resource loaded with KERNEL's own handler: Windows leaves it discarded until it is locked; WinBox loads it at once. USER's own loads of menus and dialogs read the resource with no handler.
- `GlobalMasterHandle` and the other stubs among KERNEL's internals: their read-outs and what to do with each are in [[topic:kernel-internals]].
- Windows' own blocks in the first megabyte, between those `GlobalDosAlloc` gives.
