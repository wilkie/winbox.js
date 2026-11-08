---
kind: guide
name: 386 enhanced mode
summary: A design for a second, separately measured mode of WinBox — Windows 3.1's 386 enhanced mode beside the standard mode the oracle and both engines run today — what a program can see of the difference, how the oracle records it, what WinBox has to build in phases, and the decisions still open.
---

This page is a design, in part built. The oracle's side is built: the recorder starts Windows in either mode, and what enhanced mode answers is recorded beside what standard mode answers. Phase 1, a machine's mode in both engines and both front ends, the first of phase 2's answers and phase 3, the DPMI host's functions, are built (2026-11-07); the rest is not. It follows the model of [[guide:launcher]].

The oracle's Windows and both engines run in standard mode (`win /s`): DOSX.EXE is the DPMI host and KRNL386.EXE the kernel. Some programs refuse to run there. Lode Runner: The Legend Returns' setup loads Sierra's `SMACKE16.DLL`, a WATCOM Win386 library. The Win386 supervisor asks DPMI's version (INT 31h function 0400h) and, unless BX's bit 0 says a 32-bit host, shows "Not running on a 386 DPMI implementation" and loads nothing. Real Windows 3.1 in standard mode refuses it the same way, on the owner's disc. Widget Workshop's `WIDGET.EXE` is a Win32 program and needs Win32s, which needs enhanced mode ([[topic:win32s]], [[topic:cd-rom]]). On 2026-11-07 the owner decided to plan 386 enhanced mode as a second mode, measured on its own, with this page first.

## The oracle in enhanced mode

[[measured]] DOSBox 0.74-3 runs Windows 3.1 in 386 enhanced mode with the settings the recorder already gives it. Only the command line changes: `win /3` for `win /s`.

- **The settings.** `machine=svga_s3` (the VGA installation's), `memsize=16`, `core=auto`, `cycles=max`, and the installation's `SYSTEM.INI` as Setup wrote it. Its `[386Enh]` section names `display=*vddvga`, `keyboard=*vkd`, `mouse=*vmd`, `network=*dosnet,*vnetbios`, `ebios=*ebios`, the timer API device `device=vtdapi.386`, 22 more `device=` lines (`*vpicd`, `*vtd`, `*reboot`, `*vdmad`, `*vsd`, `*v86mmgr`, `*pageswap`, `*dosmgr`, `*vmpoll`, `*wshell`, `*BLOCKDEV`, `*PAGEFILE`, `*vfd`, `*parity`, `*biosxlat`, `*vcd`, `*vmcpd`, `*combuff`, `*cdpscsi` and the rest), `PagingFile=C:\WINDOWS\WIN386.SWP` and `MaxPagingFileSize=61440`. Setup copied `WIN386.EXE`, `WINOA386.MOD`, `VGA.3GR` and `VTDAPI.386` with the rest, so nothing has to be installed.
- **The settings that do not matter.** [[probe:dpmiver]] recorded the same three answers under each of: `core=normal`, `dynamic` and `simple`; `cputype=386` and `pentium_slow`; `memsize=2`, `4`, `32` and `63`; `cycles=fixed 3000` and `fixed 80000`; and five runs more of the defaults. `cputype=386_prefetch` did not start Windows. Even `cputype=386` leaves the processor a 486 to Windows: CL 4 and `WF_CPU486`.
- **How long it takes.** A small probe takes about two seconds from DOSBox's start to its fixture, as in standard mode.
- **The recorder.** `record.mjs --mode enhanced` starts `win /3`. The fixture's source says `host: "dosbox, 386 enhanced mode"` and `mode: "enhanced"`. Standard mode stays the default, and every recording made without `--mode` is made as before.

### Where the recordings go

A recording in enhanced mode is `oracle/fixtures/enhanced/<fixture>.json`, under the same name its standard-mode recording has at the top level. That leaves every existing fixture and test as it was:

- the TypeScript replay reads the top level alone (`loadFixtures`, `test/oracle/replay.ts`), as it already leaves out `fabricated/`, so no enhanced recording is replayed or counted in `kb/data/conformance.json`;
- the Rust engine reads a fixture by its name (`tests/support/mod.rs`), and names none under `enhanced/`;
- a probe's slugs (`--display`, `--ini`, `--midimap`) are kept: `--mode enhanced --display ega` writes `enhanced/devcaps-ega.json`.

Phase 1, below, is where the replay learns to read them.

### What every probe shows in the other mode

[[measured]] Every probe with a plain VGA fixture was recorded again in enhanced mode, one at a time under the oracle's lock, and its records set beside the standard-mode fixture. That was 437 probes.

- **427 finished, and 407 of them answered exactly as in standard mode.** Of the 427 probes' 61,548 records, 3,261 differ, all in 20 probes. Window management, messages, dialogs, controls, GDI's drawing and text, fonts, profiles, files, DDE, the clipboard and the multimedia devices did not move.
- **20 answered differently.** By what differs:
  - _The mode itself:_ [[probe:winflags]] and [[probe:kconst]]'s `__WINFLAGS` (`0C29h`); [[probe:about]]'s mode line, "386 Enhanced Mode"; and [[probe:enhmode]].
  - _Memory:_ [[probe:freemem]] (`GetFreeSpace` 58,328K, `GlobalCompact` 16,320K) and [[probe:galimit]], where blocks of FE0000h and FF0000h bytes are given that standard mode refuses.
  - _Timers:_ [[probe:mmtime]]'s `timeBeginPeriod`, `timeEndPeriod` and `timeKillEvent` answer nought where standard mode answers 97 (`TIMERR_NOCANDO`), the VTDAPI path of `TIMER.DRV`; [[probe:sysdrv]]'s `CreateSystemTimer` handles start at 30h, not 38h, a system timer fewer in use; [[probe:thtask]]'s timer count.
  - _KERNEL's WinOldAp hooks:_ [[probe:kintrnl]]'s `RegisterWinOldApHook` and `GetWinOldApHooks` answer nought and keep no list in enhanced mode.
  - _Selectors:_ [[probe:selalias]]'s `AllocSelector(0)` gives no access rights (`F2h` in standard mode); [[probe:kconst]]'s selectors for the BIOS and the adapters' memory lie in the opposite order.
  - _Where things are:_ the numbers of selectors and stack offsets, not their meaning, in [[probe:environ]], [[probe:kmore]], [[probe:gcycle]], [[probe:gfresh]], [[probe:segfree]], [[probe:stack]] (3,110 of its 3,650 records are the stack's offsets and what lies under it), [[probe:prttrot]] and [[probe:mmmisc]]'s interrupt stack; [[probe:loadenv]]'s environment as the task sees it.
- **10 did not finish.** Eight stop at a box of Windows' own and need the keys the recorder is given for them in standard mode (`--shoot`, `--then`), which the sweep did not give: [[probe:cbteat]], [[probe:dbghook]], [[probe:fault]], [[probe:ktask]], [[probe:mbseb]], [[probe:openfile]], [[probe:sebhook]], [[probe:undefdl]]. [[probe:emscopy]] and [[probe:emspast]], which call into the code KERNEL cuts from its first segment, stopped DOSBox itself with an internal error in enhanced mode.

The 23 recordings that differ or are cited here are committed under `oracle/fixtures/enhanced/`. The 406 that equal their standard ones are not: equal is all they say.

## What a program can see

The two modes run the same KERNEL, USER, GDI and drivers. What a program can tell apart is listed here, each with where it was found.

### Windows' own answers

| Question                                                         | Standard mode                                               | 386 enhanced mode                                                                                                                                                                                            | Evidence                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `GetWinFlags`                                                    | `0419h`: `WF_PMODE`, `WF_STANDARD`, `WF_CPU486`, `WF_80x87` | `0C29h`: `WF_PMODE`, `WF_ENHANCED`, `WF_CPU486`, `WF_80x87`, `WF_PAGING`                                                                                                                                     | [[measured]] [[probe:winflags]], [[probe:dpmiver]] |
| INT 2Fh 1600h                                                    | AX left `1600h`                                             | AX `0A03h`: Windows 3.10                                                                                                                                                                                     | [[measured]] [[probe:dpmiver]]                     |
| INT 2Fh 160Ah                                                    | AX, BX, CX left                                             | AX, BX, CX left: not answered to a Windows program in either mode                                                                                                                                            | [[measured]] [[probe:enhmode]]                     |
| INT 2Fh 1683h, the virtual machine                               | AX and BX left                                              | AX `1600h`, BX 1: the system virtual machine                                                                                                                                                                 | [[measured]] [[probe:enhmode]]                     |
| INT 2Fh 1686h                                                    | AX 0: protected mode                                        | AX 0                                                                                                                                                                                                         | [[measured]] [[probe:enhmode]]                     |
| INT 2Fh 1684h, a device's entry point                            | none for any device                                         | an entry point for VPICD, VTD, Reboot, VDD, VMD, VKD, VCD, SHELL, PageFile and VTDAPI; none for VMM, VDMAD, V86MMGR, PageSwap, Parity, VSD, BlockDev, VMCPD, EBIOS, BIOSXlat, DOSMGR, VMPoll, VFD or VPOWERD | [[measured]] [[probe:enhmode]], 24 devices asked   |
| KERNEL's file                                                    | `KRNL386.EXE`                                               | `KRNL386.EXE`                                                                                                                                                                                                | [[measured]] [[probe:enhmode]]                     |
| The selector increment, `__AHINCR` and `__AHSHIFT`               | 8, 3                                                        | 8, 3                                                                                                                                                                                                         | [[measured]] [[probe:enhmode]]                     |
| A program's privilege level, its code's and data's access rights | ring 3, `FBh` and `F3h`                                     | the same                                                                                                                                                                                                     | [[measured]] [[probe:enhmode]]                     |

### KERNEL

[[read out]] One `KRNL386.EXE` serves both modes, and it learns which it is in once, as it starts:

- It enters protected mode through whichever host is there, by INT 2Fh 1687h, the DPMI host's mode switch, DOSX's or WIN386's. It refuses a processor below a 386 and takes `WF_CPU386` or `WF_CPU486` from the CL the host gives (`KRNL386.EXE` seg1 `c347`-`c363`). It then asks INT 2Fh 168Ah for the "MS-DOS" extensions and, through their entry point with AX 100h, for a selector of the descriptor table itself, which it keeps at `[cs:32h]` (`c3a0`-`c3c7`).
- It asks INT 2Fh 1600h: AL 3 is enhanced mode, and KERNEL sets bit 0 of its byte `[327h]` and `WF_PMODE|WF_ENHANCED` (21h) in its flags; anything else is standard mode, bit 5 of `[328h]` and `WF_PMODE|WF_STANDARD` (11h) (seg1 `aa76`-`aa90`).
- It names WinOldAp, the module that runs a DOS program, by the mode: `WINOLDAP.MOD` in standard mode, `WINOA386.MOD` in enhanced (seg1 `aa9f`-`aaaf`, the names at data `0DE8h` and `0DF4h`). Loading a DOS program then goes another way in each (seg2 `0506`-`0529`, not read further).

[[read out]] After that, KERNEL tests the mode in a handful of places:

- **The descriptor table grows in enhanced mode only.** When KERNEL's count of free selectors falls under 100h and the table's limit is at most F000h, it asks DPMI function 0000h for 100h descriptors more (seg1 `1ed4`-`1f0d`). In standard mode the table keeps the size DOSX gave it.
- **The free pages, with paging.** With `WF_PAGING`, every 32nd pass of its idle loop, KERNEL reads DPMI function 0500h's free pages (seg1 `80c2`-`80d0`, `8281`-`8295`). Without paging, it calls another routine with 1F4h (seg1 `b4eb`-`b4fc`, not read further).
- **The reboot device.** KERNEL asks INT 2Fh 1684h for device 9, the reboot device, and gives it a procedure of its own with AX 201h (seg1 `a577`-`a5a9`). Only enhanced mode has the device ([[probe:enhmode]]). [[fn:KERNEL.ExitKernel]] uses the same device to restart the machine.
- **Idle.** KERNEL's idle loop calls INT 28h and INT 2Fh 1689h in both modes (seg1 `80d6`-`80e5`).

### The DPMI host

The DPMI host is DOSX in standard mode and WIN386's virtual machine manager in enhanced mode. Both say version 0.90.

[[read out]] DOSX dispatches INT 31h through a table of function numbers and handlers (`DOSX.EXE`, the table at 6342h in its image, which starts 200h into the file; the dispatcher at 641Ah). Its functions:

- **Answered:** 0000h-0003h, 0006h-000Dh, 0100h-0102h, 0200h-0205h, 0300h-0304h, 0400h, 0500h-0503h, 0900h-0902h and 0B00h-0B03h.
- **Carry clear, nothing done:** 0004h and 0005h (0.9's undocumented lock and unlock of a selector), 0600h-0603h (locking: nothing pages), 0702h and 0703h, and 0800h. With no paging, a physical address is already the linear one, so 0800h gives BX:CX back as it came. 0604h answers a page of 1000h bytes.
- **Refused, AX nought and the carry set:** 0305h, 0306h, 0700h, 0701h and 0A00h.
- **Anything else** is not in the table. The dispatcher then takes its handler from the word at 2B89h of its own segment. That word lies inside the refusing handler's first instruction, 0012h, which is DOSX's own start-up code ([[read out]]). [[measured]] DOSX never returns from DPMI 1.0's 000Eh: under DOSBox the emulator itself stops ([[probe:dpmiout]]).
- **What ends Windows.** 0503h faults inside DOSX whatever the block, and so do 0502h and 0101h given nought: Windows goes back to DOS with "Standard Mode: Fault in MS-DOS Extender." ([[read out]] and [[measured]], [[topic:dpmi-functions]], "Windows ends").

[[measured]] [[probe:enhmode]] calls each function with harmless arguments, in both modes:

- **The same in both:** 0000h-000Ah, 000Dh, 0100h (refused, AX 8, in both: KERNEL holds conventional memory), 0200h-0205h, 0300h (DOS's version, 5, through a real-mode INT 21h), 0303h, 0304h, 0400h's AX and DX, 0500h's carry, 0501h, 0502h, 0600h-0604h, 0702h, 0703h, 0900h-0902h (interrupts on, AL 1), and 0B02h of a watchpoint never set (carry, AX left).
- **Different:**
  - 0400h: BX `000Ah` (bit 1, real-mode reflection; bit 3) against `0005h` (bit 0, a 32-bit host; bit 2, virtual memory) ([[probe:dpmiver]]).
  - 0305h and 0306h: refused against answered; enhanced mode's state buffer is 24h bytes.
  - 000Dh's descriptor freed with 0001h: refused, AX 1, in standard mode.
  - 0800h at A0000h: carry clear in standard mode, refused in enhanced, where memory under a megabyte cannot be mapped.
  - 0A00h "MS-DOS": AX nought in standard mode, AX left in enhanced.
  - 0503h, a page made two: standard mode never returns from it, as the probe's last record shows: DOSX faults and Windows ends ([[topic:dpmi-functions]]). Enhanced mode answers it.
  - DPMI 1.0's 000Eh, 0210h, 0401h and 0504h: carry set and AX left in enhanced mode. 0E00h, the coprocessor's state, is answered.
- **What 0500h says** (in pages of 4K, with DOSBox's 16 MB): standard mode has a largest block of `E347E0h` bytes, E34h free pages and no paging file, and its other fields `FFFFFFFFh`. Enhanced mode has a largest block of `3868000h` bytes (about 56 MB), F6Dh physical pages and 39FCh pages of paging file: WIN386's temporary swap file.

### Memory

- [[measured]] [[fn:KERNEL.GetFreeSpace]] answers 15,082K in standard mode and 58,324K in enhanced mode on the same 16 MB machine ([[probe:enhmode]]). [[fn:KERNEL.GlobalAlloc]] gives blocks of 1, 4 and 8 MB in both modes. A block of 15 MB is refused in standard mode and given in enhanced, from virtual memory.
- [[measured]] The selector arithmetic is the same: `__AHINCR` 8 and `__AHSHIFT` 3 in both ([[probe:enhmode]]).

### 32-bit programs

Under Windows 3.1, a 32-bit program is a 16-bit program that brings a 32-bit runtime of its own: WATCOM's Win386 supervisor, or Win32s.

- [[measured]] **A Win386 program in each mode.** The probe `oracle/probes/win386/w386ver.c` is built with Open Watcom's 386 compiler and bound to the Win386 supervisor (`wcc386 -bt=windows`, `wlink system win386`, `wbind`). In enhanced mode it runs: its pointers are 4 bytes, it sees `GetWinFlags` `0C29h`, and the C library gives it a block of 2 MB. In standard mode it shows the box "Open Watcom Win386", "Not running on a 386 DPMI implementation", and stops there. That is the box Lode Runner's setup shows.
- [[inferred]] The supervisor needs, beyond 0400h's bit 0, what a 32-bit program asks of its host: code and data selectors of 32-bit default size with limits past 64K, memory from 0501h, and a 32-bit stack. The rest is to be measured from the supervisor's own calls (phase 4).

### The other modules

[[read out]] Every place a module of the installation reads `__WINFLAGS` or calls `GetWinFlags` and then tests `WF_ENHANCED` (20h) or `WF_STANDARD` (10h):

- **USER.** Its start-up, at its entry point (seg3 `0000`-`0058`), in enhanced mode calls an import with 0Fh and keeps the SHELL device's entry point from INT 2Fh 1684h with BX 17h at `[18Ch]`. The task switcher's Alt+Tab calls seg1 `1799` with 1 in enhanced mode (seg23 `0946`; [[topic:task-list]]). `IsUserIdle`'s path through seg1 `33c8` tests the mode as well ([[fn:USER.IsUserIdle]]).
- **GDI.** `FinalGDIInit` (seg2 `012e`) does more in enhanced mode, with `WF_PMODE` (`0142`-`0170`, not read further).
- **TIMER.DRV.** Its enable and disable (seg1 `0014`, `0036`, `005d`) and its message entry (seg2 `00a4`, a second table at 1ECh+18h) take routines of their own in enhanced mode. Its strings include the complaint that `device=VTDAPI.386` is not in `[386Enh]`.
- **COMM.DRV.** It tests the mode at seg2 `044b`, `058c` and `0705`, and reads `COMnBase` and `COMnIrq` from `SYSTEM.INI`'s `[386Enh]`, which Control Panel's Ports applet (`MAIN.CPL`) writes.
- **MMSYSTEM.** It calls seg1 `02bd` in standard mode only (seg1 `0046`), and seg6 `0014` tests the mode. Its interrupt stacks are standard mode's ([[topic:multimedia-services]]).
- **TOOLHELP, WINOLDAP, WINVER, CPWIN386.** TOOLHELP at seg1 `0295` and `2dd3`; standard mode's WinOldAp at seg1 `320f` and `3275`; WINVER's mode line; Control Panel's 386 Enhanced applet, which appears only in enhanced mode ([[fn:KERNEL.GetWinFlags]]; [[topic:about-boxes]]).
- **The display.** The display driver is the same `VGA.DRV`. Enhanced mode adds `*vddvga` beneath it and uses the grabber `VGA.3GR` for DOS sessions, where standard mode uses `VGACOLOR.2GR` (`SYSTEM.INI`'s `[boot]`).

## What WinBox has to build

Before phase 1, WinBox answered as standard mode does, and as only part of standard mode. Its DPMI answered 000Bh, 000Ch and 0400h ([[probe:dpmiver]]), and every other INT 31h function left the registers as they were, until phase 3. Each phase below is a branch of its own, merged when its gates pass, and measured against recordings in its mode.

### Phase 0: the oracle (done, 2026-11-07)

`record.mjs --mode enhanced`, the fixtures under `oracle/fixtures/enhanced/`, [[probe:enhmode]] recorded in both modes, and the sweep of every plain VGA probe above. Nothing in either engine changed.

### Phase 1: a machine's mode (done, 2026-11-07)

- **The switch.** A machine is made in standard or in enhanced mode, standard by default. In the TypeScript engine it is the machine's option `mode`, `'standard'` or `'enhanced'` (`WindowsMode`, `src/emulator/machine.ts`); in the Rust engine `System`'s field `mode`, a `Mode` (`crates/winbox-win16/src/system.rs`). The page's Rust engine sets it with `Machine.set_mode` (`Session::set_mode`) before anything has started.
- **On the page.** The Machine panel has a Mode, "Standard mode" or "386 enhanced mode", for the machine shown; choosing one makes the machine afresh, as a display does (`setMode`, `src/run/page/actions.ts`). A kept program records the mode it was installed or kept in, `KeptProgram.mode` (`src/run/store.ts`); a record with none, as every one kept before, is standard mode's, and the store's version is unchanged. A kept program runs only on a machine of its base, display and mode (`programOf`): opened, or chosen in the launcher, it is made a machine in its mode; in the other mode, the machine's C: is the base alone, and the kept program is listed with its mode, `instlay (386 enhanced mode)`.
- **Natively.** `--mode standard|enhanced`. A program kept by `--install` or `--layer-from` records the mode it was made in, `mode` in its record (`crates/winbox-native/src/programs.rs`, the page's field), standard where a record has none; `--program` runs it in that mode, and refuses another, as it refuses another display. A launcher or a library that runs a kept program passes nothing more than `--program NAME`: the record's mode is used. To install in enhanced mode, it passes `--mode enhanced` with `--install`.
- **The replay.** A recording in `oracle/fixtures/enhanced/` is replayed on a machine in enhanced mode, under its folder's name: `enhanced/<name>` in `kb/data/conformance.json`, in the conformance suite's test names, in `KNOWN_GAPS` (`enhanced/<probe>:<function>` before `<probe>:<function>`) and in the Rust engine's `AGREEING`. The Rust survey reads every one of the 23. The TypeScript replay reads those `ENHANCED` names (`test/oracle/replay.ts`): every fixture it loads is held to agreement or a known gap, so the rest wait for the phase that makes them agree.
- **Measured:** nothing a standard-mode machine answers changed but INT 2Fh 1686h (below); the corpus is unchanged.

**Registered.** `enhanced/winflags`, `enhanced/dpmiver` and `enhanced/about` agree whole in both engines. `enhanced/freemem` agrees but for `GetFreeSpace`, as in standard mode (the program's own segments). [[probe:enhmode]] is run whole in both modes: in standard mode 92 of its 99 records agree, in enhanced 89 of 106, in both engines; what is left is 000Dh's descriptors, DOS's version and the interrupt flag (phase 3, below), the segments' limits and `GetFreeSpace` as above, and in enhanced mode WIN386's devices. [[probe:galimit]] in enhanced mode agrees but for three records (KERNEL's descriptor table growing, [[topic:global-and-local-memory]], "How much there is"), and `kconst` but for the order of the first megabyte's selectors. Those two are not registered in the TypeScript replay yet: the knowledge base's pages hold every fixture of a probe to their "exact", and those pages were measured in standard mode.

### Phase 2: the answers that follow the mode

`GetWinFlags` and `__WINFLAGS`; INT 2Fh 1600h, 1683h and 1686h; 1684h for the devices WinBox will have, and none for the rest; DPMI 0400h's BX; KERNEL's choice of WinOldAp; `GetFreeSpace`, `GlobalCompact` and `GlobalAlloc`'s limit, with enhanced mode's numbers from [[probe:enhmode]] and `galimit` recorded in enhanced mode, kept as standard mode's are ([[topic:global-and-local-memory]], "How much there is"). Then the modules' branches above, one at a time, each read further and recorded before it is followed: TIMER's VTDAPI path, USER's SHELL device, MMSYSTEM's stacks and COMM's ports.

- **Measured by:** [[probe:dpmiver]], [[probe:winflags]] and [[probe:enhmode]] in both modes, then the sweep's other differing probes one by one: [[probe:freemem]] and [[probe:galimit]] for memory, [[probe:mmtime]] and [[probe:sysdrv]] for TIMER, [[probe:kintrnl]] for WinOldAp's hooks, [[probe:selalias]] for `AllocSelector`. Where only selector numbers and stack offsets differ, WinBox follows them only if a program is found to depend on them.

**The first answers (done, 2026-11-07),** in both engines, by the machine's mode:

- `GetWinFlags` and `__WINFLAGS`: `0C29h` in enhanced mode, `WF_ENHANCED|WF_PAGING` for `WF_STANDARD`, the coprocessor's bit still the machine's (`winFlags`, `System::win_flags`). What reads them follows: the About box's mode line ([[probe:about]]), and MMSYSTEM's stacks, whose read-out branches on `WF_ENHANCED` already ([[topic:multimedia-services]]).
- INT 2Fh: 1600h AX `0A03h` and 1683h AX `1600h`, BX 1, in enhanced mode, left in standard mode; 1686h AX nought in both modes, as [[probe:enhmode]] recorded in both (before, WinBox left it); 1684h none for every device, as WinBox has none of WIN386's; 160Ah left (`multiplexInterrupt`, `multiplex_interrupt`).
- DPMI 0400h: BX `0005h` in enhanced mode, `000Ah` in standard.
- `GetFreeSpace`, `GlobalCompact` and `GlobalAlloc`'s room: enhanced mode's figures (`Figures::ENHANCED`, `memory-model.ts`), and `GlobalReAlloc`'s FEh selectors for a block that moves ([[topic:global-and-local-memory]], "How much there is").
- KERNEL's choice of WinOldAp has nothing to follow: WinBox loads neither, as it runs no DOS session.

### Phase 3: the DPMI host's functions (done, 2026-11-07)

DPMI 0.9's functions, each as its mode's host answers it: DOSX's table in standard mode, with its refusals, its no-ops and the faults that end Windows, and WIN386's answers in enhanced. Most of them are the same in both, so this phase serves standard mode as much as enhanced. Today's programs reach DPMI through KERNEL, which WinBox is, so few call INT 31h themselves. SimTower's 000Bh and 000Ch are the exception, and the Win386 supervisor is the next.

- **Built,** in both engines, by the machine's mode (`src/dos/dpmi.ts`, `crates/winbox-win16/src/dpmi.rs`): every function of DOSX's table as its handler does it, read out, and every function WIN386 was recorded answering, as recorded ([[topic:dpmi-functions]]). Descriptors come from the list KERNEL's come from. A program's exception handlers and protected-mode vectors are called by the processor's faults and `INT`s before WinBox's own, on the host's stack, returning to stubs of the host's code; a call into real mode reaches a callback of the program's or an interrupt WinBox's DOS or BIOS answers. Where DOSX faults, the session ends.
- **Measured by:** [[probe:enhmode]] whole in both modes, and [[probe:dpmildt]], [[probe:dpmimem]], [[probe:dpmirm]], [[probe:dpmiexc]], [[probe:dpmigro]], [[probe:dpmigrw]], [[probe:dpminul]] and [[probe:dpmiout]], each recorded in both modes and replayed whole in both engines. The last four agree whole; the rest but for what the topic's "Not yet done" names. The corpus is unchanged: SimTower's 000Bh and 000Ch are answered as before.
- [[inferred]] WinBox's memory is not paged. Locking, page attributes and the paging file's size are answered as the hosts answer them, without a pager behind them, as WinBox's other machine figures are.

### Phase 4: 32-bit programs (Win386 first)

What the Win386 supervisor and the programs it runs need, measured one call at a time with the Win386 probe:

1. **Build support.** `build-probes.mjs` builds `oracle/probes/win386/*.c` with `wcc386` and binds each with `wbind`. `fetch-toolchain.mjs` extracts `binw/win386.ext`, `binw/w386dll.ext` and `lib386/` with the rest, all in the Open Watcom 2.0 package it already fetches.
2. **The supervisor's calls.** Trace the supervisor's INT 31h calls under the oracle's enhanced mode: each probe records what it asks and is answered, before WinBox answers any.
3. **The processor.**
   - 32-bit code segments (the D bit) run in both cores today, as SimTower's row copier needs ([[topic:global-and-local-memory]], "Descriptors through DPMI").
   - A 32-bit stack segment (the B bit) runs in the TypeScript core (`stackIs32`, `src/emulator/core/i386.ts`). The Rust core leaves such a stack to its host (`descriptor`, `crates/winbox-cpu/src/lib.rs`), and natively that load is a fault. The Rust core needs it, held to the hardware vectors as the rest is.
   - Limits past 64K with the granularity bit run in both cores.
4. **A library as well as a program.** `SMACKE16.DLL` is a Win386 library (`w386dll.ext`). Lode Runner's setup is the corpus case, on the owner's disc, which is not committed.
5. **Win32s** after that, a project of its own ([[topic:win32s]]): `W32SYS.DLL` refuses anything but enhanced mode with virtual memory.

### Out of scope: DOS sessions

Running a DOS program in a window, or full screen, is what enhanced mode is best known for. It is WIN386's virtual 8086 machines, with `WINOA386.MOD`, the grabbers and every virtual device behind them. This design leaves it out:

- WinBox is not an emulator of a PC that Windows boots on. It is Windows' API, with a processor for programs' own code. A DOS session needs a whole virtual PC beneath it: V86 mode, paging, every virtual device, and DOS itself, unprotected.
- No corpus program needs one. Where a Windows program starts a DOS program, WinBox says so, as the launcher does today ([[guide:launcher]], "Not yet done").
- DOSBox already runs DOS programs, faithfully. A host can run one beside WinBox.

What a Windows program sees as it starts one is the edge of a DOS session, and that is in scope. [[measured]] [[probe:winexpe]] answers the same in both modes: `WinExec` of a Win32 file, which starts its DOS stub, answers an instance. Which WinOldAp runs it differs (`WINOLDAP.MOD`, `WINOA386.MOD`), and so do KERNEL's WinOldAp hooks ([[probe:kintrnl]]).

## The corpus and the probes

- Every probe recorded in standard mode stays as it is, and stays the reference for standard-mode machines. An enhanced-mode recording sits beside it, under `enhanced/`, and is held to agreement only by a machine in enhanced mode.
- The corpus runs in standard mode, as now. A program of the corpus is surveyed in enhanced mode as well once phase 2 is merged, with its reports in a folder of their own, as `corpus/reports/windows` keeps the oracle's. The two modes' runs are not compared with each other: each is compared with its own recording.
- The kb says which mode a measurement is from wherever the two differ. Where a page says only "measured", it means standard mode.

## The owner's decisions

Decided on 2026-11-07:

1. **Where enhanced-mode recordings are kept.** In `oracle/fixtures/enhanced/<fixture>.json`, which no replay reads until phase 1.
2. **The sweep's identical recordings are recorded again when phase 1 needs them.** Only the 23 that differ or are cited are committed now (1.1 MB). The other 406 (16 MB) are not; the oracle records them again in about an hour.
3. **A machine's mode is chosen per install.** It is kept with the install, as its display is ([[guide:launcher]]), so one install's machine can run enhanced while another's runs standard.
4. **Standard mode's DPMI is DOSX's, exactly** (phase 3). It answers DOSX's refusals and no-ops as DOSX does, including the 0503h that never returns. It is not a subset of WIN386's host.
5. **DOS sessions are out of scope.**

## Not yet done

Phase 2 after its first answers, and phase 4. What phase 3 leaves is in [[topic:dpmi-functions]], "Not yet done": real-mode code of a program's, the interrupt flag and DOS's version (which are not DPMI's), 000Dh's descriptors, and where the hosts keep blocks.

- Phase 2's other differing probes: [[probe:kintrnl]]'s WinOldAp hooks (nought and no list in enhanced mode), [[probe:selalias]]'s `AllocSelector(0)`, [[probe:mmtime]], [[probe:sysdrv]] and [[probe:thtask]]'s TIMER, USER's SHELL device, COMM's ports. Each is read further and recorded before it is followed.
- KERNEL's descriptor table growing in enhanced mode (seg1 `1ed4`-`1f0d`), the 1000h [[probe:galimit]] shows, and the first megabyte's selectors in enhanced mode's order ([[probe:kconst]]). Both wait on WinBox's selectors being KERNEL's, or on a program that depends on them; `enhanced/galimit` and `enhanced/kconst` are replayed by the TypeScript engine once the knowledge base tells the modes' records apart.
- The largest block and `GlobalCompact`'s figure in enhanced mode before their limit are taken from DPMI 0500h's largest block ([[inferred]]); no call shows them below FF0000h.
- The corpus is not yet surveyed in enhanced mode.

- What KERNEL does with a DOS program in each mode (`KRNL386.EXE` seg2 `0506`-`0529`), and the routine it calls without paging (seg1 `b4eb`), are not read further. Nor are GDI's `FinalGDIInit`, TOOLHELP's or COMM's branches.
- WIN386's own INT 31h dispatcher is not read out: what it answers is what the probes measured ([[topic:dpmi-functions]]).
- INT 2Fh 160Ah is not answered to a protected-mode program in either mode. Whether it is answered in real mode was not recorded.
- The Win386 probe's source is committed, but it is built by hand until phase 4's build support is added. Its standard-mode run, which stops at the supervisor's box, is a screen, not a fixture.
- `cputype=386_prefetch` did not start Windows in enhanced mode. Why is not known; no recording needs it.
