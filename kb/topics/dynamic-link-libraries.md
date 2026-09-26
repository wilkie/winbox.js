---
kind: topic
name: Dynamic-link libraries
summary: How Windows 3.1's KERNEL loads a program's DLLs — the data segment it gives one, the local heap its entry point asks for, the registers it starts with, and the prologues it patches — read out of KRNL386.EXE and COMMDLG.DLL.
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

## LocalInit with no start

- [[read out]] `LocalInit` given a start of nought takes its end as the heap's size, and puts the heap at the end of the segment, ending a byte short of the segment's size as `GlobalSize` gives it. A size of 64K or more counts as FFFFh. A start below 10 is moved to 10, as the segment's first ten bytes are the instance's header (seg2 `28b7`).
- [[measured]] The segment it is given is a selector, as a program has one. winbox.js took it as a descriptor index before, which its own loader had passed. `COMMDLG`'s heap was then made for a segment nothing used, and its first `LocalAlloc` answered nothing.

## Patched prologues

- [[read out]] When KERNEL loads a code segment, it looks at each of its entries in the entry table whose third byte is `nop` (seg1 `7bac`):
  - `push ds; pop ax` (`1E 58`) becomes `mov ax, ds` (`8C D8`);
  - an entry flagged as using the module's shared data then becomes `mov ax, <data segment's selector>`, so an exported function of a library finds its own data rather than its caller's;
  - in a program with multiple data, an exported entry becomes three `nop`s, and its data segment comes from `MakeProcInstance`.
- [[measured]] Without this, `COMMDLG`'s `FindText` read Notepad's data as its own and asked for its dialog with a handle that was nothing.

## Constants

- [[read out]] Some of KERNEL's exports are numbers rather than functions, written where the program reads them: `__AHSHIFT` 3, `__AHINCR` 8, and `__WINFLAGS`, which is what `GetWinFlags` answers. `COMMDLG`'s entry point reads `__WINFLAGS` and takes another path when bit 15 is set.
- [[measured]] The executable's entry table has bundles of such constants. winbox.js did not read past their entries, and so misread every entry after them.

## Window properties

- [[documented]] `COMMDLG` keeps each of its dialogs' data in a window property, `SetProp` with the atom A000h. `SetProp`, `GetProp` and `RemoveProp` keep a handle under a name or an atom for each window.

## Not yet done

- `LoadLibrary`, `GetProcAddress` and `FreeLibrary`, for a library a program loads itself.
- Loading a segment only when it is first called.
- Patching a program's own prologues.
- A library's resources beyond its dialogs.

## In winbox.js

- `src/win16/library.ts` finds, places, patches and links a library.
- `Win16.startLibraries` runs the entry points from `InitTask`.
- `src/win16/user/props.ts` holds the window properties.
