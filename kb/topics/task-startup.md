---
kind: topic
name: Starting a program
summary: What a Windows 3.1 task is handed when it starts — its DOS environment and the path inside it, which the C runtime reads before WinMain — and what a program asks USER for before it opens a window, as Notepad needed them.
probes: [environ, regmsg]
---

Before a program's `WinMain` runs, its C runtime's start-up code has run: it calls [[fn:KERNEL.InitTask]], saves and replaces interrupt vector 0 for divide errors, and builds `argv` and `envp` from the DOS environment. Notepad stopped at exactly this point in winbox.js. It never got to its first call after `InitTask`, because what it read there was not what Windows gives.

## The environment

- [[measured]] [[probe:environ]] reads its own environment through [[fn:KERNEL.GetDOSEnvironment]]. The environment starts at offset 0 of a selector, and the word at `2Ch` of the task's PSP ([[fn:KERNEL.GetCurrentPDB]]) is that same selector.
- [[measured]] The variables come first, each one ending in a zero. Recorded under DOSBox, they were `PATH=Z:\`, `COMSPEC=Z:\COMMAND.COM` and `BLASTER=A220 I7 D1 H5 T6`, which are the DOS host's, then `windir=C:\WINDOWS`. The last is Windows' own: lower case, and after everything the host had.
- [[measured]] A second zero ends the variables. It was at offset 75, and the word after it is 1: the count that DOS 3 and later put before a program's path.
- [[measured]] The path after the count is `C:\WINDOWS\SYSTEM\KRNL386.EXE`, not the program's own. [[fn:KERNEL.GetModuleFileName]] gave `C:\WINDOWS\ENVIRON.EXE` for the same task. Every task inherits the environment DOS gave the kernel, path and all.
- [[documented]] A C runtime finds `argv[0]` there. Notepad's walks forward to the first two zeros in a row, skips the count and copies the string after it. An environment without that layout sends the copy past the end of its segment.

## Registered messages

- [[measured]] [[probe:regmsg]] registers four strings with [[fn:USER.RegisterWindowMessage]]. The first gets a number at or above `0xC000`. The same string again gets the same number, and so does the same string in another case. Another string gets another number.
- [[measured]] USER keeps these strings apart from the global atom table. `GlobalFindAtom` does not find a registered string, and `GlobalGetAtomName` gives no name for its number.
- [[measured]] The numbers themselves are not reproducible: Windows gave `0xC40E` for the first, then eight more for the next. Both depend on what was registered before the probe ran and on how USER lays out its table.
- Notepad registers the Find dialog's message before it opens its window, and quits if that fails.

## In winbox.js

`taskEnvironment` in `src/win16/task-environment.ts` builds the environment. winbox.js has no DOS shell under Windows to lend it variables, so `windir` is the only one. The kernel's path is `C:\WINDOWS\SYSTEM\KRNL386.EXE`, as recorded. `RegisterWindowMessage` counts up from `0xC000` by one, which is the known gap in its conformance. The environment's other records depend on the DOS host and have no replay. `test/win16/task_test.ts` holds the layout, the local heap's growth ([[topic:global-and-local-memory]]) and the message rules.

Two more things Notepad needed before it could open a window. It imports `SHELL.DLL` and `KEYBOARD.DRV`, and calls `DragAcceptFiles` early. Both are now modules in winbox.js, with the ordinals and names of the installation's own export tables. Only `DragAcceptFiles` does anything; the rest are stubs, and the trace marks them.
