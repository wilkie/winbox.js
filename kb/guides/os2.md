---
kind: guide
name: OS/2
summary: A design for OS/2 programs on WinBox — OS/2 1.x's 16-bit NE programs, which WinBox's NE reader, selectors and calling convention already fit, then OS/2 2.x and later's 32-bit LX programs, which need a new loader — the API by module and its size (DOSCALLS, the VIO, KBD and MOU calls, Presentation Manager's PMWIN and PMGPI), how much of WinBox's USER, GDI and raster carries over, Win-OS/2 and the DOS sessions, the phases, and the decisions still open.
---

This page is a design, not built. It follows [[guide:beyond-windows-31]], which puts OS/2 after Win32s and Windows 95, and the model of [[guide:enhanced-mode]]. How OS/2 is recorded is [[guide:oracle-next]].

## OS/2 1.x

### What it is

- [[documented]] OS/2 1.0 (1987) ran text-mode programs in protected mode on a 286; 1.1 (31 October 1988) added Presentation Manager ([OS/2 Museum, 1.1](https://www.os2museum.com/wp/os2-history/os2-1-1)).
- [[documented]] Its programs are New Executables, as Windows' are; the byte at 36h of the NE header names the target system: 1 OS/2, 2 Windows, 3 European DOS 4, 4 Windows 386, 5 BOSS; very old OS/2 1.0 and Windows 1 and 2 files may have nought there ([OSDev wiki, NE](https://wiki.osdev.org/NE)).
- [[documented]] "Family API" programs: `BIND` attaches a DOS emulation of part of the API (`API.LIB`) to an NE program, so the same file runs on OS/2 and on DOS; only NE programs can be bound, and only the family subset is emulated, some 80 to 90 functions ([EDM/2](https://www.edm2.com/index.php/Hints_for_writing_simple_programs_for_both_OS/2_and_DOS); [osFree](https://osfree.org/doku/en:docs:fapi:functions)).

### What carries over from WinBox

- **The file.** `winbox-ne` reads an NE header, its segments, relocations, entries, names and resources, and already reads the target byte (`target_os`, at 36h) and the OS/2 flags byte (`os2_flags`, 37h); nothing in `winbox-win16` reads the target byte today, so an OS/2 program is loaded as if it were a Windows one.
- **The processor and selectors.** A 1.x program is 16-bit protected-mode code with segments in a local descriptor table, as a Win16 program is; `winbox-machine`'s descriptors serve both.
- **The calling convention.** [[measured]] Open Watcom's OS/2 1.x headers declare `#define APIENTRY PASCAL FAR` (`h/os21x/os2def.h`, line 37, in the toolchain the oracle fetches): a far call, arguments pushed left to right, the callee popping them, as Windows' API is. The trap protocol's stub, `INT 80h` and `RETF imm16`, serves an OS/2 1.x export unchanged (`ARCHITECTURE.md`, "Taking control").
- **Huge segments.** `DosAllocHuge` and `DosGetHugeShift` (among `DOSCALLS`'s names, below) are the counterpart of KERNEL's `__AHSHIFT` and `__AHINCR`.

### What is new

- **The loader's meaning.** The same file read, but OS/2's loader: `DOSCALLS` imports (mostly by ordinal), OS/2's data segment rules, a program's threads, its session.
- [[inferred]] **Threads from 1.0.** `DosCreateThread` and the semaphores (`DosSemSet` and the rest) are among `DOSCALLS`'s names in OS/2 1.x's import library (below): a 16-bit OS/2 program may have preemptive threads, as a Windows 95 program may. The design of [[guide:win32]], "Processes and threads" (preemption at instruction counts on the virtual clock) is needed here first if OS/2 1.x comes before Windows 95.
- **Text-mode sessions.** `VIOCALLS`, `KBDCALLS` and `MOUCALLS` give a program a character screen, the keyboard and the mouse; WinBox has no text session. One would be a window of character cells, drawn with the raster's fonts.

## OS/2 2.x and later

- [[documented]] From OS/2 2.0 on, 32-bit programs are LX ("linear executable"), specified by IBM; its header is found through the MZ header's `e_lfanew`, as NE's and PE's are ([EDM/2, the LX specification](<https://www.edm2.com/index.php/IBM_OS/2_16/32-bit_Linear_eXecutable_Module_Format_(LX)_Specification>); revision 8, [PDF](https://ceionia.com/resources/le/OS2_OMF_and_LX_Object_Formats_Revision_8_199406.pdf)).
- [[inferred]] A 32-bit program is flat: one code and one data selector over the whole space, its objects at linear addresses in pages. A new loader: objects, pages, fixups, the entry table and resources of LX. WinBox reads no LE or LX file today; the LE files its Win32s inventory met (`W32S.386`, WinG's `DVA.386`) are virtual device drivers, which it does not run ([[topic:win32s]]).
- [[measured]] Open Watcom's OS/2 2.x headers declare `#define APIENTRY _System` and keep `APIENTRY16` as `_Far16 _Pascal` (`h/os2/os2def.h`, lines 99-104): a 32-bit program calls the system with the `_System` convention (arguments on the stack, the caller popping them), and still calls some 16-bit functions through 16:16 pointers. [[inferred]] A 32-bit stub ends with a near `RET`, the caller cleaning; the 16-bit calls need "thunks" between a flat address and a 16:16 one, which OS/2 makes by tiling: a selector for each 64 KiB of the first 512 MiB, its base the linear address. Both to be read out of OS/2's `DOSCALLS.DLL` before they are built.
- [[inferred]] Its memory, its threads and its exceptions are the same questions as Windows 95's ([[guide:win32]]): virtual memory with protections, preemptive threads on the virtual clock, exception handlers registered per thread.

## The API

### By module

[[measured]] The functions Open Watcom 2.0's import libraries for OS/2 name, by the module that exports them (`scripts/kb/watcom-imports.py`). The same script finds in its Windows 3.1 library KERNEL 237, USER 411 and GDI 283 against Windows 3.1's own 233, 413 and 283 ([[guide:win32]], "Size"): the libraries are close to the systems' export tables. For OS/2 they follow IBM's later toolkits, so for 1.x and 2.x they are an upper bound.

| Module                                          | What it is ([[inferred]] from its functions' names)                | OS/2 1.x (`lib286/os2/os2.lib`) | OS/2 2.x and later (`lib386/os2/os2386.lib`) |
| ----------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | -------------------------------------------- |
| `DOSCALLS`                                      | the kernel: files, memory, processes, threads, semaphores, modules | 145                             | 393                                          |
| `PMWIN`                                         | Presentation Manager's windows and messages                        | 320                             | 258                                          |
| `PMGPI`                                         | the Graphics Programming Interface                                 | 271                             | 290                                          |
| `PMSHAPI`                                       | the shell's: profiles, the program list                            | 48                              | 100                                          |
| `PMWP`                                          | the Workplace Shell                                                |                                 | 214                                          |
| `PMDRAG`, `PMCTLS`, `PMSPL`, `HELPMGR`          | drag and drop, controls, the spooler, help                         |                                 | 42, 6, 48, 21                                |
| `VIOCALLS`, `KBDCALLS`, `MOUCALLS`              | text screen, keyboard, mouse                                       | 76, 24, 27                      | 63, 20, 27                                   |
| `PMVIOP`                                        | text windows on PM                                                 | 30                              | 4                                            |
| `SESMGR`, `OS2SM`                               | sessions                                                           | 34, 45                          | 36                                           |
| `NAMPIPES`, `QUECALLS`                          | pipes and queues                                                   | 14, 8                           | 14, 16                                       |
| `MONCALLS`, `MSG`, `NLS`, `ANSICALL`, `BDCALLS` | the rest                                                           | 5, 3, 4, 3, —                   | 5, 9, 8, —, 11                               |
| **Total**                                       |                                                                    | **1,057**                       | **1,585**                                    |

[[measured]] By the same script, `DOSCALLS`, `PMWIN` and `PMGPI` alone are 736 functions in 1.x, against Windows 3.1's KERNEL, USER and GDI at 929 exports (`kb/data/exports-3.1.json`).

### Presentation Manager

- [[documented]] A window's origin, (0, 0), is its lower left corner, and y grows upward; a child window is placed from its parent's lower left; points and rectangles are `POINTL` and `RECTL`, of 32-bit coordinates ([EDM/2, PM Guide](https://www.edm2.com/index.php/PMGuide_-_Drawing_in_Windows); [The Old New Thing, 2021-05-25](https://devblogs.microsoft.com/oldnewthing/20210525-00/?p=105250)).
- [[measured]] Open Watcom's 1.x headers (`h/os21x/pmwin.h`, `pmgpi.h`) declare its model: `WinInitialize` gives an anchor block, `HAB`; a program makes its own message queue, `WinCreateMsgQueue(HAB, SHORT)`; it reads messages with `WinGetMsg(HAB, PQMSG, HWND, USHORT, USHORT)` and dispatches them with `WinDispatchMsg`; a window procedure is `MRESULT (PASCAL FAR *)(HWND, USHORT, MPARAM, MPARAM)`, its two parameters 32-bit (`MPARAM` is a far pointer) where Windows 3.1's `wParam` is 16; a frame's title bar is a child window of its own, `FID_TITLEBAR` 8003h; drawing is through a presentation space, `HPS`, from `WinBeginPaint` or `GpiCreatePS`.
- [[inferred]] **What carries over from WinBox.** The raster carries over: blits, raster operations, lines, curves, regions, bitmaps, palettes and the rasterised fonts (`winbox-raster`), with y turned over. USER's and GDI's semantics carry over little: PM's messages, its frame of child windows, its focus and activation, its presentation spaces, its fonts' selection and its coordinates are its own, and each is measured on the oracle before it is built, as Windows' were. The window manager's machinery (a tree of windows, queues, invalidation and painting, clipping) is the part worth sharing, beneath both.
- [[inferred]] **The Workplace Shell** (`PMWP`, 214 functions, built on IBM's SOM objects) is OS/2 2.x's desktop. Out of scope, as Windows 95's Explorer is ([[guide:win32]]): WinBox's launcher is its shell.

## Win-OS/2 and the DOS sessions

- [[documented]] OS/2 2.0 ran an almost unmodified Windows 3.0 in a DOS session, Win-OS/2; 2.1 (June 1993) brought it to 3.1; "seamless" windows used slightly modified Windows display drivers ([OS/2 Museum, 2.0](https://www.os2museum.com/wp/os2-history/os2-2-0/); IBM Redbook GG24-3731, [mirror](https://www.os2.kr/komh/os2books/gg243731/217_L3_MethodsofExecution.html)).
- [[inferred]] A Windows program for Win-OS/2 is a Windows 3.1 program: WinBox runs it as it is. What Win-OS/2 changes for a program (its seamless display driver, its clipboard and DDE shared with PM) is not in scope until a program is found that depends on it.
- [[inferred]] OS/2's DOS sessions (its virtual DOS machines) are out of scope, as Windows' are ([[guide:enhanced-mode]], "Out of scope: DOS sessions"): DOSBox runs DOS programs.

## Other projects

[[documented]] For reading, not for code: nothing of their behaviour is taken without the oracle's confirmation.

- **2ine** (Ryan C. Gordon), an OS/2 "emulator" for Linux that loads LX programs; its README says it works "barely. It runs some command line OS/2 apps"; zlib licence ([GitHub](https://github.com/icculus/2ine)).
- **osFree**, an OS/2-compatible system in progress, "deep in alpha", licences mixed ([GitHub](https://github.com/osfree-project), [status](https://osfree.org/doku/en:status)).
- **Odin**, Win32 on OS/2, the other direction (netlabs, [GitHub](https://github.com/netlabsorg/odin32)).

## The audience

[[measured]] archive.org has no OS/2 software collection; 1,342 software items name OS/2 (or eComStation or ArcaOS) in their subjects or titles, about 1,038 GB by archive.org's item sizes, derived files included (`catalog/other-systems.json`, 2026-11-16). Nine of them run in archive.org's DOSBox, so are DOS programs, not OS/2 ones ([[inferred]]). How many are OS/2 1.x programs, 2.x programs, or the system's own media is not counted: it needs the files' headers, as the Windows 3.x catalog's `needs` reads them ([[guide:compatibility]]).

## Phases

Each a branch of its own, merged when its gates pass, measured against the oracle.

| Phase | What                                                                                                                                                                                       | What it makes runnable                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 0     | The oracle: OS/2 1.3 and Warp in QEMU ([[guide:oracle-next]]); probes built by Open Watcom (`system os2`, `os2_pm`, `os2v2`, `os2v2_pm`)                                                   | nothing; the reference                                      |
| 1     | OS/2 1.x text programs: the NE loader's OS/2 meaning, `DOSCALLS` (files, memory, modules), `VIOCALLS`, `KBDCALLS`, `MOUCALLS` in a window of character cells; threads on the virtual clock | text-mode and Family API programs                           |
| 2     | Presentation Manager 1.x: `PMWIN` and `PMGPI`, 16-bit, over the shared window machinery and the raster                                                                                     | OS/2 1.1-1.3 PM programs                                    |
| 3     | The LX loader; 32-bit `DOSCALLS`; tiling and the 16-bit calls from 32-bit code                                                                                                             | OS/2 2.x text programs                                      |
| 4     | Presentation Manager 32-bit, with `PMSHAPI`, `PMDRAG`, `HELPMGR`, the spooler as needed                                                                                                    | OS/2 2.x to Warp 4 PM programs, without the Workplace Shell |

[[inferred]] **Sizes, against what WinBox took.** Phases 1 and 2 are about as many functions as Windows 3.1's three main modules (1,057 against 929, above), with less to measure first: the NE reader, the processor and the raster exist. Phases 3 and 4 are a second system again, of 1,585 functions, of which programs use a part, found from their imports once a catalog of OS/2 programs reads their headers.

## Open questions for the owner

1. **OS/2 at all, and when.** After Windows 95, as [[guide:beyond-windows-31]] recommends, or before it, as OS/2 1.x reuses more of today's engine?
2. **1.x or 2.x first.** 1.x reuses the NE reader and the 16-bit convention, and has fewer programs; 2.x and Warp have more and need the LX loader.
3. **The reference releases.** OS/2 1.3 (IBM or Microsoft), 2.1, Warp 3, Warp 4, and FixPaks, from the owner's media.
4. **A catalog of OS/2 programs.** Read the headers of archive.org's 1,342 items (fetching them, as the Windows 3.x catalog's first pass did), before choosing?
5. **The Workplace Shell** out of scope: agreed?

## Not yet done

Everything. Nothing of OS/2's own files is read out; the counts are Open Watcom's import libraries'.
