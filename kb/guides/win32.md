---
kind: guide
name: Win32s, then Windows 95
summary: A design for Win32 programs on WinBox — Win32s first, as Windows 3.1 in 386 enhanced mode runs them, then Windows 95 — what each system is, what WinBox already has that carries over (the 386 core, DPMI, paging, USER and GDI), what is new (a PE loader, 32-bit modules, threads on the virtual clock, structured exceptions, virtual memory, the registry, long names, the 486 and Pentium instructions, VxDs as programs see them, DirectX), the size of the API by module, the phases, and the decisions still open.
---

This page is a design, not built. It follows [[guide:beyond-windows-31]], which sets the order of the systems, and the model of [[guide:enhanced-mode]]. Win32s was deferred by the owner on 2026-10-25 ([[topic:win32s]]); on 2026-11-15 the owner asked for designs that take WinBox past Windows 3.1, for archival and for play. How each system is recorded is [[guide:oracle-next]].

## What WinBox has that carries over

- **The processor.** The Rust core runs 32-bit operands and addresses, segments of 4 GiB, a 32-bit stack and linear addresses that wrap at 4 GiB ([[guide:enhanced-mode]], phase 4; [[topic:win386]]). It is held to the 80386's hardware vectors (`ARCHITECTURE.md`, "CPU accuracy"). It runs programs as the oracle's processor, DOSBox's at `cputype=auto`: the 486's `BSWAP`, `XADD`, `CMPXCHG`, `INVD`, `WBINVD` and `INVLPG`, `CPUID` as a 486DX and the Pentium's `RDTSC`, with EFLAGS' AC and ID ([[topic:the-processor]], "The oracle's processor"); the Pentium's `CMPXCHG8B` and MMX it does not have (below, "The processor").
- **Memory.** Four GiB of linear addresses, made a mebibyte at a time as each is first written (`ARCHITECTURE.md`, "Memory and the core boundary"); the set of present pages and the fault on a page not present ([[guide:paging]], phases 2 and 3).
- **DPMI and enhanced mode.** WIN386's DPMI answers, recorded and built ([[guide:enhanced-mode]], phase 3), which `W32SYS.DLL` and `WIN32S16.DLL` will ask of it.
- **USER, GDI and the raster.** Windows 3.1's window manager, messages, controls, dialogs, GDI and fonts, each measured against the oracle, over the 1,623 exports of Windows 3.1's sixteen modules (`kb/data/exports-3.1.json`).
- **The trap protocol.** A module's export is an eight-byte stub, `INT 80h` and `RETF imm16`, that stops the core and runs the export in Rust (`ARCHITECTURE.md`, "Taking control"). A 32-bit module needs the same stub in a 32-bit code segment, ending in a near `RET imm16` (`stdcall`), the arguments read off a flat stack.
- **The virtual clock.** Instructions at a fixed rate, each call charged what it was measured to cost ([[topic:timing]]); the scheduler runs tasks in slices of instructions and interrupt-time procedures between them (`ARCHITECTURE.md`, "The engine and its tasks").

## Win32s (phase 1)

### What it is

- [[documented]] "A set of DLLs and a VxD" that runs Win32 programs on Windows 3.1 (Microsoft KB Q83520, [archived](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/83/520.HTM)). Some functions run in 32-bit code directly, "like memory management"; others, "particularly GDI and User", are thunked to the 16-bit modules, at "no more than 10 percent" slower (same article). Functions it does not support are stubs that answer `ERROR_NOT_IMPLEMENTED` (same).
- [[documented]] The VxD, `W32S.386`, runs at ring 0: exceptions, the coprocessor's emulation and memory. A Win32 program may not call INT 21h or the BIOS itself; the VxD gives Win32 entry points for them, and calling a VxD directly is not supported (KB Q105760, [archived](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/105/760.HTM)).
- [[documented]] Its versions: 1.10 with Windows NT 3.1 (July 1993), the last 1.30c (February 1996) ([Wikipedia](https://en.wikipedia.org/wiki/Win32s)). 1.30, 1.30a and 1.30c are builds 1.2.159, 1.2.166 and 1.2.172 (KB Q125014, [archived](https://techshelps.github.io/MSDN/KB/Source/win32sdk/q125014.htm)). [[inferred]] WinWorld reports 1.30 to 1.30c crashing on some emulators, 1.25a recommended there ([WinWorld](https://winworldpc.com/product/win32s)).
- [[read out]] Its files, from Win32s 1.25 on Widget Workshop's disc ([[topic:win32s]]): `W32SCOMB.DLL` exports 2,123 names, among them the functions of `KERNEL32`, `USER32`, `GDI32`, `ADVAPI32` and `NTDLL`, of which there are no files of their own; `W32SKRNL.DLL` 96; twelve thinner PE libraries (`WINMM` 163, `SHELL32` 108, `COMDLG32` 27 and the rest); the 16-bit `WIN32S16.DLL` (270 ordinals) and `W32SYS.DLL` (27), which start a PE program; and `W32S.386`. The installed 16-bit modules import 759 functions of Windows 3.1's own; WinBox had 593 of them when the page was written.

### What it does not do

[[documented]] KB Q131896, Win32s' limits from 1.25a to 1.30c ([archived](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/131/896.HTM)):

- No threads of a program's own; scheduling is not preemptive, as Windows 3.1's is not. A DLL's thread-local slots are shared by every process.
- A 32-bit process is started only from 16-bit code (`WinExec`, INT 21h 4Bh); `CreateProcess` takes only the `DEBUG_*` flags.
- A private message's `wParam` is cut to 16 bits; child windows' and resources' identifiers are 16-bit; `PostMessage` and `PeekMessage` do not thunk structures.
- An edit control's text is in the 16-bit local heap, under 64 KiB. No Bézier curves, paths or transforms in GDI. File times to two seconds.
- No general way to call a 16-bit DLL but the Universal Thunk: `UTRegister` and `UTUnRegister`, exported by `KERNEL32` (KB Q125710, [archived](https://techshelps.github.io/MSDN/KB/Source/win32sdk/q125710.htm)); a call from 16-bit into 32-bit code through it needs 10 KiB of stack (Q131896).
- [[documented]] No asynchronous file I/O, and not the newer serial functions ([Wikipedia](https://en.wikipedia.org/wiki/Win32s)).

### Its memory

- [[documented]] Every 16-bit and Win32 program runs in one address space, shared, without preemption (Q83520, Q105760).
- [[inferred]] So a PE image cannot count on its preferred base and must carry relocations: Wikipedia says a Win32s program "must contain relocation information" ([Wikipedia](https://en.wikipedia.org/wiki/Win32s)); no Microsoft page found says so. To be read out of `W32SKRNL.DLL`'s loader.
- [[inferred]] Where Win32s puts an image, its heaps and its stack, in linear addresses, is WIN386's memory as [[guide:paging]] measured it, given out by `W32S.386`. A probe records it.

### Two ways to run it

- **(a) Microsoft's Win32s on WinBox's Windows 3.1.** The user's own `W32SCOMB.DLL`, `W32SKRNL.DLL`, `WIN32S16.DLL` and `W32SYS.DLL` run as code on WinBox's KERNEL, USER and GDI, as a Win386 program's supervisor does today ([[topic:win386]]). WinBox would answer `W32S.386`'s services, which are read out first. It needs Win32s' files on disk, against the rule that a module works with no Windows file ([[guide:without-windows]]).
- **(b) WinBox's own Win32 modules.** `KERNEL32`, `USER32`, `GDI32` and the rest as modules WinBox keeps, stubs in a 32-bit segment, each export in Rust calling the same Rust that answers the 16-bit export: `USER32.CreateWindowExA` is `USER.CreateWindowEx` with 32-bit arguments, and its Win32s differences (the 16-bit `wParam`, the identifiers) applied where it is measured to make them. No file of Win32s is needed, and nothing is thunked down through 16-bit code.

[[inferred]] **Recommended: (b),** recorded against (a) on the oracle: Win32s installed on the oracle's Windows 3.1 is the reference, and WinBox's own modules are held to it, as COMMDLG is held to Windows' ([[guide:without-windows]], "WinBox's own COMMDLG"). What a Win32s program can see of Win32s' internals (`WIN32S16`'s exports, `GetWin32sInfo` of `W32SYS`, which version 1.1 added, KB Q125014) is answered as recorded.

### What WinBox has to build for it

- **A PE loader.** A crate beside `winbox-ne`: the headers, sections, base relocations, imports by name and ordinal, exports, resources (a PE's resource tree, not the NE's table) and the TLS directory. The resources feed the same resource code USER and GDI read today.
- **A Win32 process in WinBox's Windows 3.1.** A flat code and data selector of 4 GiB, as the Win386 supervisor makes ([[topic:win386]]); the program's stack; its image in linear memory; a task for it in the scheduler, as a Win16 task is. `WinExec` of a PE file starts it where WinBox today starts its DOS stub ([[probe:winexpe]]).
- **The 32-bit stubs and arguments.** The trap protocol with near `stdcall` returns; `Args` reading 32-bit words; strings `A` (and the few `W` Win32s has); structures laid out 32-bit.
- **The modules,** by what programs import (below, "Size").
- **What it makes runnable.** [[measured]] The catalog's 19 items whose needs say Win32s (`catalog/other-systems.json`, from `catalog/results.json`): 3 whose program is a PE file, and 16 that carry Win32s' files in their download; 11 games and 8 applications. Widget Workshop, whose six PE files need 399 functions, every one among Win32s' exports ([[topic:win32s]]). FreeCell, which Win32s installs.

### What DOSBox can record of it today

- [[measured]] The oracle's DOSBox runs Windows 3.1 in 386 enhanced mode, with paging (`GetWinFlags` `0C29h`, `WF_PAGING`) and a paging file of WIN386's own ([[guide:enhanced-mode]]). `W32SYS.DLL`'s first two conditions, enhanced mode and virtual memory, are met.
- [[read out]] Win32s' setup stops unless `SHARE.EXE` is loaded ([[topic:win32s]], `32SINST.MST`). [[inferred]] DOSBox 0.74-3's own DOS has no `SHARE`; whether the check passes, or a `SHARE.EXE` of the owner's MS-DOS must be loaded first, is the first trial ([[guide:oracle-next]], "What must be tried first").
- [[measured]] The toolchain already fetched links `system win32s`: Open Watcom's "Win32s (Windows 3.x)", with `KERNEL32`, `USER32`, `GDI32`, `WINMM`, `LZ32`, `VERSION` and Win32s' other libraries ([[guide:oracle-next]], "A probe's run"). A Win32s probe is a PE program built the way the Win386 probes are built apart, recorded with `--mode enhanced`.

## Windows 95

### Its Win32 layer

- [[documented]] "Most 32-bit USER and GDI functions thunk to 16-bit USER and GDI"; nothing of `KERNEL32` thunks down to `KRNL386`, but the call to the Win16 loader when a Win32 process starts a Win16 one (KB Q125867, [archived](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/125/867.HTM)).
- [[documented]] The Win16Mutex: a Win32 thread holds it only inside a thunked call; a Win16 program takes it in `GetMessage` and `PeekMessage` and gives it up when it yields; programs may not touch it (Q125867). System code thunks down through the undocumented `QT_Thunk` (Matt Pietrek, [Dr. Dobb's, 1996](https://jacobfilipp.com/DrDobbs/articles/DDJ/1996/9614/9614c/9614c.htm)).
- [[documented]] Three kinds of thunk: flat thunks (Windows 95 only, both ways, built with the thunk compiler); generic thunks (Windows NT and 95, 16 to 32 through `LoadLibraryEx32W`, `GetProcAddress32W` and `CallProc32W`); universal thunks (Win32s only) (KB Q125710).

**What that means for WinBox.** [[inferred]] Windows 95's `USER.EXE` and `GDI.EXE` are 16-bit modules of version 4.0, with the new look, new messages and new exports, under both the Win16 programs and `USER32`/`GDI32`. WinBox's USER and GDI are Windows 3.1's, measured against 3.1. They carry over as machinery (the window manager, the queues, the DCs, the raster, the fonts), but their behaviour on Windows 95 is a second set of answers, measured on the second oracle, as enhanced mode's are a second set beside standard mode's. As with Win32s, `USER32` and `GDI32` would be WinBox's own, calling the same Rust as `USER` and `GDI`, not thunks through 16-bit code; the Win16Mutex shows to a program only as who runs when, which the scheduler decides.

### Win16 programs on Windows 95, as a mode

- [[documented]] `GetVersion` answers 3.95 to a Win16 program, because many programs read the version wrongly ([The Old New Thing, 2004-02-13](https://devblogs.microsoft.com/oldnewthing/20040213-00/?p=40633); KB Q131371, [archived](https://techshelps.github.io/MSDN/KB/Source/win16sdk/q131371.htm)).
- [[documented]] For a 16-bit module whose expected version (NE offset 3Eh) is below 4.0, the kernel looks for compatibility strings ([The Old New Thing, 2024-11-19](https://devblogs.microsoft.com/oldnewthing/20241119-00/?p=110543)). Dialogs of programs marked 4.0 or later get the 3D look (`DS_3DLOOK`); 3.x programs must ask for it ([Win32 SDK, version differences](https://techshelps.github.io/MSDN/WINBASE/devdoc/live/pdwbase/win95/verdiff_0xmb.htm)).
- [[documented]] Long names through INT 21h 71xxh; a DOS that does not have them answers carry with AX 7100h, and the program falls back to the old call ([Win32 SDK, long file names](https://techshelps.github.io/MSDN/WINBASE/devdoc/live/pdwbase/win95/lfn_912r.htm)).
- [[inferred]] **The proposal.** A machine's system, beside its mode: Windows 3.1 in standard mode, Windows 3.1 in 386 enhanced mode, Windows 95. Chosen per install and kept with it, as the mode is (owner's decision 3 of [[guide:enhanced-mode]]). A Win16 program runs on a Windows 95 machine with Windows 95's answers where they are recorded to differ, and 3.1's elsewhere. Fixtures in `oracle/fixtures/win95/`, replayed only on such a machine.

### Processes and threads

- [[documented]] A Win32 program on Windows 95 has its own address space and preemptive threads; Win16 programs share one space and take turns under the Win16Mutex (Q125867, and KB Q125691 below).
- [[inferred]] **Threads on the virtual clock.** WinBox runs one host thread and the guest's code as a future (`ARCHITECTURE.md`). Guest threads would be that again, one future each: the scheduler preempts a thread after a quantum counted in instructions on the virtual clock, at the rate the oracle measures for a timeslice, and at any wait. Interleavings are then the same on every run, which the replay and the corpus need. They will not be the oracle's: a real scheduler's interleaving depends on its interrupts. Probes measure outcomes (what a wait answers, which thread a message reaches), not interleavings, and a program that depends on a race is followed as SimTower's clock was ([[topic:timing]]).
- Synchronisation objects (events, mutexes, semaphores, critical sections), `WaitForSingleObject` and `WaitForMultipleObjects`, thread-local storage, and the Win16Mutex as a lock the scheduler holds for a Win16 task.

### Memory, exceptions, the registry and names

- [[documented]] **The address space** (KB Q125691, [archived](https://techshelps.github.io/MSDN/KB/Source/win32sdk/q125691.htm)): 0-4 MB kept for DOS and Windows 3.1, no Win32 code or allocation there; 4 MB to 2 GB private to a process; 2-3 GB shared, holding mapped files, 16-bit components and `USER32`, `GDI32` and `KERNEL32`; 3-4 GB the system's, VMM and the VxDs. File mappings are in the shared gigabyte (KB Q125713).
- [[inferred]] **Virtual memory.** `VirtualAlloc`'s reserve, commit and protection need pages with protections and a fault that a program's handler can see. [[guide:paging]]'s set of present pages is the start; its design (b), page tables and CR3, becomes the one that pays here, as a process's private range changes with the process.
- [[inferred]] **Structured exceptions.** The chain at FS:0 in the thread's information block, so FS a selector of the thread's own; the core's faults (divide, `#GP`, the page fault) dispatched to it by `KERNEL32` with the unwinding as Windows 95 does it. Recorded by probes that fault on purpose, as [[probe:dpmiexc]] does for DPMI.
- [[inferred]] **The registry.** `SYSTEM.DAT` and `USER.DAT`, not Windows 3.1's `REG.DAT` (which WinBox makes from the bundle today, [[topic:asset-bundle]]). A new store, with `ADVAPI32`'s `Reg*` and the 16-bit `SHELL`'s, made per install from what Setup writes, as the profiles are.
- [[inferred]] **Long names.** The host drive's layers keep names as the host has them ([[guide:without-windows]], "Drives from layers"); long names and their 8.3 aliases need a rule for the alias, measured on the oracle (Windows 95's VFAT).

### The processor

- [[inferred]] Windows 95 needs a 386DX; programs of its period use the 486's `BSWAP`, `CMPXCHG` and `XADD`, the Pentium's `CPUID`, `RDTSC` and `CMPXCHG8B`, and MMX. [[measured]] The first five are in WinBox's core as DOSBox runs them, its flags after `XADD` and `CMPXCHG` its own, not a 486's ([[probe:cpu486]]; [[topic:the-processor]]). `CMPXCHG8B` and MMX are not, and DOSBox 0.74 has neither: they wait for a Windows 95 oracle that has them. No hardware vectors of the 486 or the Pentium exist (SingleStepTests' suites end at the 80386).
- [[inferred]] `CPUID` names a processor: which one WinBox claims is a choice, and the oracle's emulated processor (QEMU's `-cpu pentium`, [[guide:oracle-next]]) is the reference. [[measured]] Under Windows 3.1 WinBox claims DOSBox's: `GenuineIntel`, family 4, model 0, stepping 2, a coprocessor ([[probe:cpu486]]). Windows 3.1's KERNEL already reports a 486 (`WF_CPU486`) from what DOSBox gives ([[guide:enhanced-mode]]).

### VxDs, as a program sees them

- [[documented]] A Win32 program reaches `VWIN32.VXD` by `CreateFile("\\.\vwin32")` and `DeviceIoControl`: `VWIN32_DIOC_DOS_IOCTL` (1, INT 21h 4400h-4411h), INT 25h and 26h, `DOS_INT13` (4), `DOS_DRIVEINFO` (6, OSR2 on) ([Win32 SDK](https://techshelps.github.io/MSDN/WINBASE/devdoc/live/pdwbase/win95/devio_2b1v.htm)).
- [[documented]] `KERNEL32` of Windows 95 has 100 exports by ordinal only (1 to 101, 50 left out): `VxDCall0` to `VxDCall8` (1-9), `GlobalAlloc16`, `WOWCallback16` (54), `QT_ThunkPrime` (90), `_EnterSysLevel` (97) ([Geoff Chappell](https://www.geoffchappell.com/studies/windows/win32/kernel32/history/ords40.htm)).
- [[inferred]] WinBox has no VxDs, as it has none of WIN386's ([[guide:enhanced-mode]]: INT 2Fh 1684h answers none). Each device a program opens is answered as Windows 95 answers it, measured; a game's copy protection that reads a disc's sectors through `VWIN32` is one such.

### DirectX

- [[inferred]] DirectDraw, DirectSound and DirectInput export few functions each (below) and give programs COM interfaces: their size is in the interfaces' methods, not in exports. DirectDraw's surfaces, their locks and flips, and the palette are a display model of their own over `winbox-raster`; DirectSound's buffers over the sound WinBox has. Direct3D is a phase of its own, last.

## Size

[[measured]] What can be counted without a file of Windows 95's: the functions Open Watcom 2.0's import libraries name by module (`scripts/kb/watcom-imports.py`, which reads their OMF import records). They are Windows NT's later names, up to Vista's, so for Windows 95 they are an upper bound. Calibrated on Windows 3.1, the same script finds in Open Watcom's `windows.lib` KERNEL 237, USER 411 and GDI 283, against Windows 3.1's own exports 233, 413 and 283 (`kb/data/exports-3.1.json`).

| Module     | Open Watcom's import library (NT, later) | Win32s 1.25's export ([[topic:win32s]])                                | Widget Workshop imports |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| `KERNEL32` | 1,116                                    | in `W32SCOMB.DLL`'s 2,123, with `USER32`, `GDI32`, `ADVAPI32`, `NTDLL` | 90                      |
| `USER32`   | 664                                      | (as above)                                                             | 159                     |
| `GDI32`    | 418                                      | (as above)                                                             | 112                     |
| `ADVAPI32` | 512                                      | (as above)                                                             | 7                       |
| `SHELL32`  | 247                                      | 108                                                                    | 3                       |
| `COMCTL32` | 114                                      | none                                                                   |                         |
| `COMDLG32` | 21                                       | 27                                                                     | 5                       |
| `WINMM`    | 164                                      | 163                                                                    | 20                      |
| `VERSION`  | 14                                       | 11                                                                     |                         |
| `LZ32`     | 12                                       | 13                                                                     | 3                       |
| `OLE32`    | 202                                      | none in 1.25                                                           |                         |
| `OLEAUT32` | 378                                      | none in 1.25                                                           |                         |
| `DDRAW`    | 7                                        |                                                                        |                         |
| `DSOUND`   | 10                                       |                                                                        |                         |
| `DINPUT`   | 3                                        |                                                                        |                         |

- [[inferred]] Programs use a small part: Widget Workshop, a large MFC program, needs 399 functions in all. The work is driven by what the catalog's programs import, as the Win16 modules' was.
- **Counting Windows 95's own, without committing it.** A script reads the export tables of the owner's Windows 95 files where they lie, outside the repository (as `scripts/kb/win32s-inventory.py` read Win32s'), and writes names, ordinals and counts to `kb/data/`, as `kb/data/win32s-imports.json` and `exports-3.1.json` are. No byte of a file is kept.

## Phases

Each phase a branch of its own, merged when its gates pass, measured against the oracle in its system.

| Phase | What                                                                                                                                                                                                                                           | What it makes runnable                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0     | Win32s on the oracle: the install as a layer over the enhanced-mode Windows, `system win32s` probes, recorded with `--mode enhanced`                                                                                                           | nothing; the reference                                                              |
| 1     | A PE loader; the Win32 process and its task; 32-bit stubs; `KERNEL32` (memory, files, modules, resources), `USER32`, `GDI32`, `ADVAPI32`'s registry, `WINMM`, `COMDLG32`, `SHELL32`, `LZ32`, `VERSION`, as Win32s answers; the Universal Thunk | the catalog's 3 PE programs and the 16 that bring Win32s; Widget Workshop; FreeCell |
| 2     | The Pentium's `CMPXCHG8B` and MMX, and `CPUID` as Windows 95's oracle answers (the 486's and `RDTSC` done, as DOSBox's)                                                                                                                        | Win32s programs that use them; ahead of Windows 95                                  |
| 3     | The Windows 95 oracle ([[guide:oracle-next]]); Win16 probes recorded on it                                                                                                                                                                     | nothing; the reference                                                              |
| 4     | Windows 95 as a system for Win16 programs: `GetVersion` 3.95, long names, the compatibility strings, USER's and GDI's 4.0 answers where they differ                                                                                            | Win16 programs as they run on Windows 95                                            |
| 5     | Win32 on Windows 95: processes, threads on the virtual clock, synchronisation, virtual memory, structured exceptions, the registry, `COMCTL32`                                                                                                 | Win32 programs of 1995-1997 that need no DirectX                                    |
| 6     | DirectDraw, DirectSound, DirectInput                                                                                                                                                                                                           | most games of the period                                                            |
| 7     | Direct3D                                                                                                                                                                                                                                       | 3D games                                                                            |

The shell (Explorer, the taskbar) is left out, as Program Manager is kept small today: WinBox runs programs, and its launcher is its shell ([[guide:launcher]]).

## Open questions for the owner

1. **Win32s' design.** WinBox's own Win32 modules, held to Win32s on the oracle ((b), recommended), or Microsoft's Win32s files run on WinBox ((a))?
2. **Which Win32s.** 1.25 (on Widget Workshop's disc, inventoried) or 1.30c, the last, reported to crash on some emulators?
3. **A system as a third axis.** A machine is Windows 3.1 standard, 3.1 enhanced or Windows 95, chosen per install, with fixtures per system: agreed?
4. **Windows 95's reference release.** Retail or OSR2 (with [[guide:oracle-next]]'s question 2).
5. **Threads.** Preemption at instruction counts on the virtual clock, deterministic and not the oracle's interleaving: agreed?
6. **What `CPUID` says.** Which processor WinBox claims to a Win32 program.
7. **DirectX and Direct3D.** In scope for play, or archival of applications first?

## Not yet done

Everything: no phase is begun. The questions to read out first are `W32SKRNL.DLL`'s loader (where an image goes, whether relocations are required), `W32S.386`'s services, and how an import of `KERNEL32.DLL` reaches `W32SCOMB.DLL` ([[topic:win32s]], "Not yet done").
