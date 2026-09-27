---
kind: topic
name: Dynamic-link libraries
summary: How Windows 3.1's KERNEL loads a program's DLLs — the data segment it gives one, the local heap its entry point asks for, the registers it starts with, and the prologues it patches — read out of KRNL386.EXE and COMMDLG.DLL.
probes: [sysdirs, freelib, wndds, loadpath]
---

A program can import from a module winbox.js does not keep itself, such as `COMMDLG.DLL`, the common dialogs, or a program's own DLL. winbox.js then loads the file from the disk the way KERNEL does. Notepad's Find dialog is `COMMDLG.DLL` running, not a copy of it.

## Loading

- [[read out]] Before a module runs, KERNEL loads each module it imports that is not loaded yet. It looks for the file by the name, with `.DLL` added, and loads that file's imports the same way (`KRNL386.EXE` seg2 `1923`). A chain is started from the bottom up: a library before the ones that need it, and siblings in the order the importer lists them.
- [[read out]] A library's data segment is its minimum allocation (64K for none), plus two bytes, plus its stack and its local heap, rounded up to a paragraph (seg1 `7660`). The file's length does not size it.
- [[read out]] **When the entry point runs.** A library loaded for a new program has its entry point run inside that program's `InitTask`, on the program's stack, before `InitTask` returns (seg2 `2632`). A library loaded at any other time runs its entry point at once. The entry point is called with:
  - DS and DX: the data segment;
  - DI: the instance handle;
  - CX: the local heap's size from the header;
  - ES:SI: 0:0, no command line;
  - AX: 1.

  It answers nought for a failure.
- [[read out]] `COMMDLG.DLL`'s entry point is the usual one. It calls `LocalInit(DS, 0, CX)`, then its `LibMain`, which registers its window messages, measures the screen and makes a memory device context.

## Names

- [[documented]] A module's name is the first entry of its resident-name table, not its file's name. Paintbrush's program is `PBRUSH.EXE` but its module is `PbrushX`, and `PBRUSH` is the name of its library, `PBRUSH.DLL`.
- [[measured]] winbox.js read no resident names from a program on the disk, and fell back to its file's name. Paintbrush's program then took `PBRUSH` for itself, and the library was never loaded.
- [[documented]] An import names its function by ordinal or by name. A name is kept in the importer's imported-names table, and the library's resident and nonresident name tables give its ordinal. The first entry of each table is the module's name or its description, not a function.
- [[measured]] Paintbrush imports all of `PBRUSH.DLL`'s functions by name. winbox.js linked only imports by ordinal, and its first call to `VCREATEBITMAP` went to where the unfilled relocation pointed, 0000:1C20.
- [[fn:KERNEL.GetProcAddress]] finds a library's function by name or by number in the same tables.

## Loading a library by name

- [[measured]] [[probe:sysdirs]]: [[fn:KERNEL.LoadLibrary]] finds a name alone, `MAIN.CPL`, in the system directory, and a full path where it says. It adds no `.DLL`: `COMMDLG` is not found, though `COMMDLG.DLL` is. A library loaded again answers the same handle.
- [[measured]] What it answers when it fails, with Windows' own box for a missing file turned off by `SetErrorMode`: 2 for a file that is not there, 3 for a directory that is not there, and 20 for a file that is not a program, `WIN.INI`.
- [[documented]] A name alone is looked for in the current directory, the Windows directory, the system directory and the program's directory, in that order. The library's entry point runs at once, after those of the libraries it needs. winbox.js does both, unmeasured.
- [[measured]] [[fn:KERNEL.GetSystemDirectory]] and [[fn:KERNEL.GetWindowsDirectory]] answer the path's length, `C:\WINDOWS\SYSTEM` and `C:\WINDOWS`, when it fits with its 0. When it does not, they leave the buffer alone and answer the size it would need, one more than the length.
- [[measured]] Control Panel asks for its applets as `MAIN.CPL` and the rest in the system directory, and loads each with `LoadLibrary`. `GetSystemDirectory` was a stub answering 0, so it looked for `\MAIN.CPL`, and said it could not find its components.

## Counting and letting go

[[probe:freelib]] loads Control Panel's `MAIN.CPL` twice, frees it twice, and loads and frees it again. It watches `COMMDLG`, which `MAIN.CPL` imports and the probe does not. winbox.js runs the probe whole on a copy of the installation's drive, and every one of its 12 records agrees.

- [[measured]] [[fn:KERNEL.GetModuleUsage]] counts each load: 1, then 2, with the same handle both times. [[fn:KERNEL.FreeLibrary]] counts down, and at nought the library goes: its name is found no more. Loaded again, it counts 1.
- [[measured]] `COMMDLG` is not loaded before, comes with `MAIN.CPL` counting 1, and goes when `MAIN.CPL` goes. A library's imports are counted as loads, and let go with it.
- [[measured]] [[fn:KERNEL.GetModuleHandle]] finds `MAIN.CPL` by its module name, `MAINCPL`, and by its file's name with the extension, `MAIN.CPL`. Its file's name without the extension, `MAIN`, finds nothing.
- [[measured]] `GetModuleHandle` answers the module, not the instance `LoadLibrary` gave: the two are different numbers for one library. winbox.js gives a library loaded from its file both, and either finds it. [[probe:drvmsg]] tells them apart through [fn:USER.GetDriverModuleHandle] ([[topic:installable-drivers]]).
- [[documented]] As a library goes, its `WEP` runs, told that the library alone is going. winbox.js does this; it is not recorded.
- [[measured]] Control Panel frees each applet library once it has asked it for its applets. All twelve still show.

## Libraries winbox.js keeps itself

- KERNEL, USER, GDI, KEYBOARD, SHELL, MMSYSTEM, SOUND, WIN87EM and TOOLHELP are winbox.js's own, and their files are not loaded. Their export tables -- the ordinals, names and argument sizes -- are the installation's files', held to them by a test.
- [[read out]] `TOOLHELP.DLL` walks KERNEL's private structures: its start-up asks `GlobalMasterHandle` for the global heap's arena, and loads what it answers as a selector. winbox.js's KERNEL has no such arena, so TOOLHELP is kept among its own. `NotifyRegister` and `InterruptRegister`, which Object Packager and Dr. Watson use, keep what they are given and answer TRUE. Nothing is notified, and no fault passed on, yet.
- `COMMDLG` is Windows' own: winbox.js keeps only its names, and loads `COMMDLG.DLL` from the installation, whether a program imports it or loads it. [[measured]] [[probe:loadpath]] loads it by its whole path, as WinHelp does, and records what its `GetFileTitle` makes of `C:\DIR\FILE.TXT`: `FILE.TXT`. winbox.js once answered such a load with its names, whose `GetFileTitle` did nothing, and WinHelp's File Open and Print Setup did nothing either.

## LocalInit with no start

- [[read out]] `LocalInit` given a start of nought takes its end as the heap's size, and puts the heap at the end of the segment, ending a byte short of the segment's size as `GlobalSize` gives it. A size of 64K or more counts as FFFFh. A start below 10 is moved to 10, as the segment's first ten bytes are the instance's header (seg2 `28b7`).
- [[measured]] The segment it is given is a selector, as a program has one. winbox.js took it as a descriptor index before, which its own loader had passed. `COMMDLG`'s heap was then made for a segment nothing used, and its first `LocalAlloc` answered nothing.
- [[read out]] A library's data segment is moveable, like a program's, so its heap grows the segment when a block does not fit ([[topic:global-and-local-memory]]). `COMMDLG`'s Open dialog asks for 1,037 bytes at once from a heap with less room than that. winbox.js grew only a program's heap before, and the dialog stopped.

## Patched prologues

- [[read out]] When KERNEL loads a code segment, it looks at each of its entries in the entry table whose third byte is `nop` (seg1 `7bac`):
  - `push ds; pop ax` (`1E 58`) becomes `mov ax, ds` (`8C D8`);
  - an entry flagged as using the module's shared data then becomes `mov ax, <data segment's selector>`, so an exported function of a library finds its own data rather than its caller's;
  - in a program with multiple data, an exported entry becomes three `nop`s, and its data segment comes from `MakeProcInstance`.
- [[measured]] Without this, `COMMDLG`'s `FindText` read Notepad's data as its own and asked for its dialog with a handle that was nothing.

## A window procedure's data segment

- [[read out]] USER calls a window procedure with DS and ES set to the stack's segment and AX set to the window's instance with its low bit set. This holds for `DispatchMessage` (seg1 `27ad`) and `SendMessage` (seg1 `3aa3`) alike. A program's stack is in its own data segment, so its procedure finds its own data whoever dispatched the message, and whether its prologue takes DS as it comes or loads it from AX.
- [[measured]] [[probe:wndds]] gives a program's window procedure a message four ways: dispatched by the program itself, sent from a library, dispatched from a library's own loop, and passed through `CallWindowProc` from a library. It records that DS is the stack's segment each time, and that one of the program's globals reads as the program set it.
- [[measured]] winbox.js left DS as its caller had it. When `COMMDLG`'s File Open dialog dispatched a paint to Calendar's window, Calendar read its background brush from `COMMDLG`'s data, got nought, and faulted in `FillRect`. Every Control Panel applet stopped the same way.

## Constants

- [[read out]] Some of KERNEL's exports are numbers rather than functions, written where the program reads them: `__AHSHIFT` 3, `__AHINCR` 8, and `__WINFLAGS`, which is what `GetWinFlags` answers. `COMMDLG`'s entry point reads `__WINFLAGS` and takes another path when bit 15 is set.
- [[measured]] The executable's entry table has bundles of such constants. winbox.js did not read past their entries, and so misread every entry after them.

## Window properties

- [[documented]] `COMMDLG` keeps each of its dialogs' data in a window property, `SetProp` with the atom A000h. `SetProp`, `GetProp` and `RemoveProp` keep a handle under a name or an atom for each window.

## Not yet done

- A freed library's memory is not given back.
- The `load` records of [[probe:sysdirs]] are not replayed: a replay runs no program's code, and loading a library runs its entry point.
- Loading a segment only when it is first called.
- Patching a program's own prologues.
- A library's resources beyond its dialogs.

## In winbox.js

- `src/win16/library.ts` finds, places, patches and links a library.
- `Win16.startLibraries` runs the entry points from `InitTask`.
- `src/win16/user/props.ts` holds the window properties.
