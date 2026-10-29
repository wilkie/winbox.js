---
kind: topic
name: The tool helper library
summary: What TOOLHELP.DLL answers about Windows' tasks, modules, classes, heaps and stacks — how Windows' own library reads each from KERNEL's and USER's structures, what the thtask and thheap probes recorded of it, and how winbox.js, which has none of those structures, answers in their shapes.
probes: [thtask, thheap, sysheap]
---

`TOOLHELP.DLL` is how a debugger, a memory viewer or a task manager looks inside Windows 3.1. Windows' own file reads KERNEL's and USER's private structures directly. As it starts, it asks KERNEL for `ThHook`, ordinal 332, which points at KERNEL's head of the module chain, head of the task list, current task and table of selectors (`TOOLHELP.DLL` seg1 `022d`-`0269`). It asks `GlobalMasterHandle` for the global heap's arenas (seg1 `01e9`), and asks USER's `UserSeeUserDo`, ordinal 216, for the head of USER's class list. KERNEL's side of each, and of the hooks TOOLHELP's notifications use, is read out in [[topic:kernel-internals]] ([[fn:KERNEL.THHOOK]], [[fn:KERNEL.ToolHelpHook]], [[fn:KERNEL.HasGPHandler]]). winbox.js keeps its tasks, modules, heaps and classes in its own structures, so its TOOLHELP gives the same answers in the same shapes, read from those.

Every call checks the structure it is handed the same way. The pointer must not be nought, and `dwSize` must be exactly the structure's size with its high word nought, or the call answers FALSE and writes nothing (seg1 `0cb3`-`0cd0` for `TaskFirst`, and the same in each). `MemManInfo` alone checks no size. [[measured]] [[probe:thtask]] and [[probe:thheap]]: a size one off is refused for each structure.

## Tasks

`TaskFirst`, `TaskNext` and `TaskFindHandle` fill a `TASKENTRY` from a task's database (seg1 `0e69`-`0f19`):

| Field                                        | From                                                     |
| -------------------------------------------- | -------------------------------------------------------- |
| `hNext`                                      | TDB 0: the next task in KERNEL's list                    |
| `hTaskParent`                                | TDB 22h: the task that was running as it was made        |
| `wSS`, `wSP`                                 | TDB 4, 2: where its stack was as it was switched away    |
| `wcEvents`                                   | TDB 6: its events                                        |
| `hQueue`                                     | TDB 20h: its queue                                       |
| `wPSPOffset`                                 | TDB 60h: its prefix's selector                           |
| `hInst`, `hModule`                           | TDB 1Ch, 1Eh                                             |
| `szModule`                                   | TDB F2h: eight bytes of its module's name, then a nought |
| `wStackTop`, `wStackMinimum`, `wStackBottom` | words 0Ah, 0Ch and 0Eh of its stack's segment            |

[[measured]] [[probe:thtask]]: for the probe, its instance and module, SS one above the instance, the queue `GetTaskQueue` answers, the prefix `GetCurrentPDB` answers, and its name. The stack's words are those `InitTask` wrote, `EF6h`, `2E60h` and `2E60h` for that program. A program the probe started is its child (`hTaskParent`). The shell's own parent is a handle `IsTask` refuses, so the probe does not record it.

[[read out]] KERNEL's list is ordered by priority, lowest first. A task goes in before the first task whose priority is as high as its own or higher (`KRNL386.EXE` seg1 `843d`-`848b`). Each task KERNEL switches to is taken out and put back as though its priority were one more (seg1 `811e`-`812b`), so the task that has run most recently comes last among those of its priority. [[measured]] With the child waiting in its message loop, the walk gives the child first and the probe after. winbox.js keeps the list the same way (`src/win16/kernel/task-list.ts`).

`TaskGetCSIP` answers nought for the running task (seg1 `0d97`-`0dbd`). For another task it answers the CS:IP from the frame its switch left on the stack. [[measured]] That is not nought for the waiting child. winbox.js answers where the task gave up the processor.

`TerminateApp` ends a task (seg1 `26ea`-`27a0`). It switches to the task, sets TDB 18h's bit 1 for `NO_UAE_BOX`, and calls `FatalAppExit(0, NULL)`, which shows the "Application Error" box with "Closing current application." unless that bit is set and ends the task through `INT 21h` 4CFFh ([[fn:KERNEL.FatalAppExit]]). [[measured]] With `NO_UAE_BOX` on the child, the child is no task after and its window is gone. WinBox shows the box from the task that called, then ends the task as DOS's function 4Ch would, with code FFh.

`TaskSetCSIP` changes where a task goes on from: the CS and IP in the frame its switch left on its stack, exchanged for those given (seg1 `0d68`-`0d94`). `TaskSwitch` does so too, to TOOLHELP's own code that goes on to the place given, gives the task an event and runs it at once with `DirectedYield` (seg1 `0dc0`-`0e62`). [[measured]] [[probe:thswch]]: a program waiting in `GetMessage`, sent to a procedure of its own, goes there once it is posted a message; one giving the processor up with `Yield` goes there before `TaskSwitch` comes back. In WinBox the place is in the task's saved state: a task waiting in a call of the API goes on from it once that call comes back.

## Modules

`ModuleFirst`, `ModuleNext`, `ModuleFindName` and `ModuleFindHandle` fill a `MODULEENTRY` from a module's database (seg1 `0bd7`-`0ca7`). The name comes from its resident names, the count from NE 2, the path from its file's details at NE 0Ah, and the next module from NE 6. [[measured]] KERNEL comes first. `ModuleFindName` finds `USER`, with `C:\WINDOWS\SYSTEM\USER.EXE`, but not `user`: TOOLHELP compares the names with USER's `lstrcmp` (seg1 `0b65`). Which modules come after KERNEL, and in what order, depends on the installation. On the oracle's Windows, TOOLHELP, MMSYSTEM and TIMER were loaded after the probe. winbox.js's own modules are there from the start, in the order it keeps them, followed by the modules loaded from files.

## Classes

`ClassFirst` and `ClassNext` walk USER's class list (seg1 `28b0`-`29c1`): its module (class 14h, which TOOLHELP calls its instance), its name (`GetAtomName` of class 4) and the next class (class 0). [[measured]] The newest class comes first: the probe's class, MMSYSTEM's `#42`, then USER's own, `#32772 #32771 #32769 MDIClient ComboBox ComboLBox ScrollBar ListBox Edit #32770 Static Button #32768`. winbox.js answers for USER's classes without registering them, so it lists them after the classes programs registered, as USER lists them. MMSYSTEM's `#42`, which WinBox registers itself with no instance, is listed with none, where it stands.

## The heaps

`GlobalEntryHandle`, `GlobalEntryModule`, `GlobalFirst` and `GlobalNext` fill a `GLOBALENTRY` from a block's arena (seg1 `060f`-`06cc`). The arena gives the address, size, handle, lock counts, flags and owner. A block whose owner is a prefix (`CD 20`) is given as its task, with `GF_PDB_OWNER` set. The type comes from seg1 `14f7`-`168d`:

- A block owned by FFFFh is a sentinel (9), by 0Ah the global heap's own (10), above FFF8h KERNEL's (8), and by nought free (7).
- A block with the data flag is the module's `GT_DGROUP` (1), or else `GT_DATA` (2).
- A task's database is `GT_TASK` (4), and a module's own block `GT_MODULE` (6).
- A block in its owner's segment table is `GT_CODE` (3), with its segment's number, whether it holds code or data. A block in the resource table is `GT_RESOURCE` (5), with its type.

[[measured]] [[probe:thheap]]: a block of 100 bytes is 80h with `GF_PDB_OWNER`, owned by the task, type nought, locked or not. A shared block is owned by the module. The data segment is `GT_DGROUP` with segment 2, the data flag 4 and a local heap. The code segment is `GT_CODE` with segment 1. The walk begins and ends with a sentinel. winbox.js's walk holds its modules' segments and its blocks in the order of their descriptors, then its tasks and modules, between two sentinels. It has no free blocks and no list of the least recently used, so `GlobalFirst` refuses those walks.

`LocalInfo`, `LocalFirst` and `LocalNext` read a local heap where KERNEL keeps it, in the segment itself (seg1 `0744`-`07e9`, `0a4f`-`0a8d`). winbox.js keeps its local heaps there as KERNEL does, so its TOOLHELP reads the same words. [[measured]] [[probe:thheap]]: the probe's heap, entry by entry. USER's and GDI's heaps are given heap types 1 and 2, but winbox.js keeps those modules' objects in itself and their segments hold no heap.

## The rest

- `StackTraceCSIPFirst` takes the registers it is given. `StackTraceNext` follows BP: the BP before, then IP and CS (seg1 `1138`-`11cb`). An odd BP marks a far frame. Otherwise a word after IP that is a code selector of the program's privilege, whose limit reaches IP, marks a far frame, and anything else a near one. [[measured]] [[probe:thtask]].
- `MemoryRead` and `MemoryWrite` reach through any selector or handle, to the block's size and the selector's limit. They write a code segment through a data alias. [[measured]] [[probe:thtask]].
- `TimerCount` gives `timeGetTime` if MMSYSTEM was loaded as TOOLHELP started. Otherwise it gives `GetTickCount` plus the milliseconds since the last tick, from the timer chip (seg1 `2dae`-`2eb8`). [[measured]] On the oracle's Windows it took the second path.
- `MemManInfo` copies DPMI's function 0500h and sets a page size of 1000h (seg1 `13f4`-`14a7`). The figures belong to the machine.

## Not yet done

- A task waiting for a message, sent elsewhere by `TaskSwitch`: Windows runs it there at once; WinBox once a message comes.
- The types of USER's and GDI's local blocks, and resources' global blocks.
- Telling a notification procedure what happens (`NotifyRegister`).
