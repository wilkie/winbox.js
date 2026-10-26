---
kind: topic
name: KERNEL's small calls
summary: KERNEL's calls about tasks, modules and selectors — its list of tasks and what each task's database keeps, a module found from any handle, selectors set straight in their descriptors — and the calls the retail Windows 3.1 makes do nothing, as the ktask probe recorded them.
probes: [ktask, thtask]
---

KERNEL keeps a database for each task and each module, and many of its small calls just read or write a word of one. Others write a descriptor directly, or do nothing at all in the retail build. Each is [[read out]] of `KRNL386.EXE` and recorded by [[probe:ktask]], which reaches each call by its ordinal through `GetProcAddress`. Both engines agree with all its records but one, KERNEL's own prefix.

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

winbox.js keeps these beside its own tasks (`src/win16/kernel/task-order.ts`, `crates/winbox-win16/src/task_order.rs`). It also gives a program's module a handle, as Windows does. [[measured]] [[probe:thtask]] finds the probe's own module by its handle and in the chain. Before this, winbox.js answered nought for a program's module. As on Windows, the handle is the selector of the module's database, so its low two bits are 3 (`modhand`). A program reads its module's header through it ([[probe:solodata]]). winbox.js's block holds the file's header, from its `NE` to the end of its entry table, and not the bits KERNEL sets in its flags. The block is let go with the program's last instance. A task's own handle still names no module ([[probe:modnum]]).

## Modules from handles

[[fn:KERNEL.GetExePtr]] finds the module of a module handle, of a task's instance, or of any block a module or a task owns (seg1 `4e78`-`4eff`). [[fn:KERNEL.IsSharedSelector]] answers whether that module is a library.

## Selectors

[[fn:KERNEL.SetSelectorBase]] and [[fn:KERNEL.SetSelectorLimit]] write straight into the descriptor through KERNEL's alias of the local table and check nothing (seg1 `2725`-`2798`). [[fn:KERNEL.SelectorAccessRights]] reads or sets the type and flags, masked with D01Eh, the setting done through DPMI. [[fn:KERNEL.AllocSelectorArray]] makes selectors one after another. [[fn:KERNEL.AllocAlias]] makes a code alias.

## Nothing, in the retail build

`EnableDos`, `DisableDos`, `EnableKernel`, `KbdRst`, `_DEBUGOUTPUT`, `K329` and `ValidateCodeSegments` are bare returns. `LogError` and `LogParamError` tell a debugger through `INT 41h` where one is there, and otherwise do nothing. `GetWinDebugInfo` and `SetWinDebugInfo` answer nought, `DiagQuery` answers nought, and `LimitEmsPages` and `GetCurPID` answer nought. `GetFreeMemInfo` answers FFFFFFFFh in standard mode. [[measured]] [[probe:ktask]] for those that answer anything. KERNEL's ordinals 77 to 80, `Reserved1` to `Reserved4`, hand on to USER's `AnsiNext`, `AnsiPrev`, `AnsiUpper` and `AnsiLower`. `Reserved5` compares two strings without regard to case.

## Not yet done

- KERNEL's own prefix in [[fn:KERNEL.GetCurrentPDB]]'s DX.
- A queue of nought before `InitApp`.
- `WaitEvent` taking an event that `PostEvent` gave.
- [[fn:KERNEL.FatalExit]] calling the procedure `FatalExitHook` set.
- `GlobalDosAlloc` and `GlobalDosFree`, which need DOS memory in the first megabyte. `LongPtrAdd`, `GetHeapSpaces`, `GetCodeHandle` and `GetCodeInfo`, `SwitchStackTo` and `SwitchStackBack`, `CallProcInstance`, `DebugBreak` and `GetLPErrMode` are still stubs. So are the resource handlers (`AllocResource`, `SetResourceHandler`, `DirectResAlloc`), and the internals only Windows' own parts call.
