---
kind: topic
name: Self-loading programs
summary: Programs whose own loader, in their first segment, loads their other segments (NE flag 0800h) — how KRNL386.EXE boots the loader, the table it fills, the services it hands it, how it asks it for each segment, before the program starts and when a segment not present is touched, and what WinBox does the same way.
probes: [selfld, moddb]
---

A self-loading program has 0800h in its New Executable header's flags (at 0Ch, [[format:ne]]). KERNEL loads its first segment as any other and leaves the rest to the program: the segment starts with a table of the program's loader, which KERNEL fills with pointers to its own services and calls. Compressing linkers make such programs: of the 77 programs of the compatibility pass's catalog with the flag ([[guide:compatibility]]; 74 runs and 3 setups), 76 have SLR Systems' and Symantec's OPTLOADER in their first segment (`OPTLOADER - Copyright (C) 1993 SLR Systems`, `1993-95 Symantec Corporation`), Macromedia Director's projectors among them, and one Blinkinc's Shrinker. [[documented]] The Windows 3.1 SDK describes the table and the loader's procedures; what follows is read out of `KRNL386.EXE` (Windows 3.1) and recorded.

## The probes

- [[probe:selfld]] is a self-loading program of its own: `build-probes.mjs` gives a Watcom-linked probe 0800h in its flags (`PROBE_SELF_LOADING`), and the probe lays out the table itself at the start of its code segment, which nothing in that segment refers past (a reference to another segment is a relocation KERNEL applies as it loads segment 1, before the loader has loaded anything). Its loader gives each other segment a block of nothing and loads none; its segment-loading procedure reads a segment's bytes from the file. It notes what it was given in its code segment and reads it back as it runs. Recorded in both modes, the same.
- [[probe:moddb]] reads its own module's database, the header and tables KERNEL lays out in memory, which a self-loading program's loader reads and writes ("The module's database" below).

## Booting the loader

- [[read out]] `LoadModule` tests the flag twice. Where it is set, it gives the program's segments no blocks (seg2 `188c`, past `1f4a`, which gives a module's segments theirs) and, once the program's imports are loaded (`1923`), boots its loader (`19df`-`1a1a`): it opens the program's file through its cache of handles (seg1 `521c`), calls `1ea6` with the module's database and the file's handle, and flushes the handle from the cache, closing it (seg1 `52fc`). It goes on with the boot's answer as it would with the module's handle: an answer below 20h is an error, and the load fails with it (seg2 `1652`-`1658`). [[measured]] [[probe:selfld]]'s boot answering 1 was never started: no program window, Windows back at DOS.
- [[read out]] `1ea6` requires segment 1's flags in memory to have 10h and 40h (moveable and loaded at once, which a program's code segment that cannot be discarded has, "The module's database" below); clears 2, 4 and 400h (`1ec3`); loads it as any segment, relocations and all (seg1 `0970`, `LoadSegment`). It then takes a writable alias of the segment (seg1 `2615`) and requires its first word to be `A0` (3041h). Where it is not, the boot answers nought.
- [[read out]] KERNEL writes four far pointers into the table (`1eed`-`1f19`), then frees the alias and calls the table's word at 4 with the module's handle and the file's (`1f26`-`1f2c`), ES the segment, on its caller's stack.

| Offset | What                                                | Filled by                          |
| ------ | --------------------------------------------------- | ---------------------------------- |
| 00h    | `A0`, 3041h                                         | the program                        |
| 04h    | the boot procedure, `BootApp(hModule, hFile)`       | the program                        |
| 08h    | the segment loader, `LoadAppSeg(hModule, hFile, n)` | the program                        |
| 0Ch    | KERNEL's data, word 21Ah                            | KERNEL: the global heap's selector |
| 10h    | `MyAlloc(wFlags, wSize, wShift)`                    | KERNEL: seg1 `09b3`                |
| 14h    | `EntryAddrProc(hModule, wOrdinal)`                  | KERNEL: seg1 `0946`                |
| 18h    | the exit procedure                                  | the program; never called          |
| 24h    | `SetOwner(wHandle, hOwner)`                         | KERNEL: seg1 `7630`                |

- [[measured]] [[probe:selfld]]: the boot is called once, with the module's handle and an open file's handle (a seek from where it is answered), ES the first segment; the pointer at 0Ch is to offset 21Ah, a word holding the selector `GlobalMasterHandle` answers; the other three are written, all in one segment. Segment 1's flags as the boot finds them are 4156h, where a program's first segment that is not self-loading has 4556h ([[probe:moddb]]): 400h is left cleared.

## KERNEL's services

- [[read out]] `MyAlloc` (seg1 `4f33`) asks `GlobalAlloc` (`0d2f`) for `wSize` shifted left `wShift` times, with flags from the segment's: discardable (100h) for a discardable segment, and 8 more for discardable code; 4 for data; moveable (2) for a moveable segment; 200h for one of a type. It answers the block's selector in AX and its handle in DX; for a moveable block the selector is `GlobalHandle`'s (`0ede`), which is nought where the block has no memory. [[measured]] [[probe:selfld]]: a block of nothing answers nought and the handle. [[read out]] A moveable block of nothing is a handle with no memory (seg1 `40ab`), its selector not present.
- [[read out]] `EntryAddrProc` (seg1 `4fe7`) walks the module's entry table in memory, its ordinal's top bit dropped: a constant answers FFFFh and its number; an entry in a segment its segment's handle with the low bit set, and the offset, or nought where the segment has no handle. Only a fixed segment not yet given its block is loaded (`5057`-`5067`). [[measured]] [[probe:selfld]]: for USER's ordinal 1 it answers what `GetProcAddress` does. OPTLOADER resolves the program's imports through it.
- [[read out]] `SetOwner` (seg1 `7630`) makes the module the owner of a block, which KERNEL keeps in the descriptor of a block with no memory. KERNEL's handler of a segment not present finds the module by that owner.

## Loading a segment

- [[read out]] `LoadSegment` (seg1 `76d1`) of segment 1 of such a program loads it as any; of another, answers its handle where its flags in memory have 4 (loaded, `7749`-`776d`), and otherwise calls `75be`: the table's word at 8 with the module's handle, the file's handle it was given and the segment's number. Where that answers nought, KERNEL opens the file again from the database's path (`OpenFile` with `OF_REOPEN | OF_PROMPT | OF_CANCEL | OF_VERIFY`), asks once more with that handle and closes it (`75f3`-`7626`).
- [[read out]] The program starts as any other: its data segment, then its entry point's and its stack's segments, each by `LoadSegment` (seg2 `13e8`-`140a`, `0ae3`, `0b14`), which asks the program's loader for any its boot left unloaded. [[measured]] [[probe:selfld]], whose boot loads nothing: its loader is asked for the data segment with no file's handle (FFFFh), and the entry point's segment, the first, is not asked for.
- [[read out]] A segment touched while it has no memory faults (0Bh). KERNEL's handler of the fault (seg1 `5fde`, set at `af9b`-`afa3`, the DPMI host's before it kept to go on to) takes it only from a program's code (CS of the local table, at privilege 3) for a selector of the local table; finds the block's owner -- the module `SetOwner` named -- and the segment in its table whose handle is the selector's (`601f`-`6051`); and calls `LoadSegment` with no file's handle (`609a`-`609e`, `60c3`), then returns to run the instruction again. Any other it passes on. [[measured]] [[probe:selfld]]: its far variable's segment, never asked for, is read through its handle's selector, and the loader is asked for it with FFFFh; the read answers its value, 1234h.
- [[read out]] Deleting the module calls `1f43` where the flag is set (seg2 `0ca0`-`0caa`), and `1f43` does nothing (`push bp; mov bp, sp; leave; ret 2`): Windows 3.1 never calls the table's exit procedure. [[measured]] [[probe:selfld]]'s exit procedure writes a record if it is called; none is written.

## The module's database

[[read out]] KERNEL lays a module's header out in memory as it reads it (seg2 `0d66`-`1264`): the header's 40h bytes, then the segment table at 40h, ten bytes an entry -- the file's eight and the segment's handle -- then the resource table, the resident names (the module's name upper case), the module references (made the imported modules' handles, `1923`-`19b6`), the imported names, the entry table made bundles of five-byte entries, and the description of the file `OpenFile` filled, its path last. A self-loading program's loader reads the segment table and writes each segment's handle and flags into it. [[measured]] [[probe:moddb]] reads its own: each header word, each table at the offset the read-out gives, the flags, the bundles and the file's description as laid out there. `module_database.rs` lays it out so, for every module WinBox loads from a file.

## In WinBox

`self_load.rs`, `module_database.rs`, `loader.rs`:

- A self-loading program is placed with its first segment alone, relocated; its database's module references are its imports (its relocations past the first segment are its loader's to read).
- The boot runs as the task starts, before its entry point: WinBox's first program has no caller to boot it on, so it runs on a stack of its own, a block of 2000h bytes freed after. KERNEL's pointers are written into the table, the boot procedure is called with the module's handle and the file opened for the call, its answer below 20h ending the run; then the data segment's, the entry point's and the stack's segments are asked for with FFFFh where they are not loaded, and the task's registers are set at the entry point.
- `MyAlloc`, `EntryAddrProc` and `SetOwner` are KERNEL's own procedures at ordinals past its exports, in its stubs (`DEFAULT_ORDINAL` and on): no program imports them.
- `GlobalAlloc` of a moveable block of nothing makes its selector not present (`winbox_machine::GlobalHeap`), and its first size makes it present again.
- A fault on a selector not present, or a far call, jump or return into one, which the core takes as a fetch past CS's limit, is taken as KERNEL's handler takes it: the block's owner's segment table is searched for its handle, the loader asked for the segment with FFFFh, and the instruction run again with the segment registers that hold the selector read afresh.

## The compatibility pass's 74

[[measured]] Before: every one stopped at its first instructions, its segments never loaded. After, run by `scripts/catalog/pass.mjs` as the pass runs them (sound installed, standard mode): every program's loader boots, and every one loads its segments, the demand loads among them, and runs its own code. 69 then stop at the same place, a General Protection Fault reading word 1Ch of `MMSYSTEM`'s module database through the handle `GetModuleHandle("MMSYSTEM")` answers, after `waveOutOpen`: the program walks the segment table of MMSYSTEM's database, which WinBox's own MMSYSTEM, a module kept with no file, does not have. The rest: 4 `running` (one OPTLOADER build's games and screen savers), 1 `idle` (Chinese Solitaire, a Shrinker-loaded Visual Basic program, at the runtime's "Sub or Function not defined"), and 3 setups that are self-loading programs themselves: two at the same MMSYSTEM read, the third run to a box of its own, "Demo Install: ISPACE.DLL is faulty". Before, the setups had stopped at an opcode the core does not run (`Unimplemented(15)`, `Unimplemented(99)`) and a General Protection Fault at 0000:0000.

## Not yet done

- A kept module's database: WinBox's own modules with no file (MMSYSTEM among them) have a blank one, where 69 of the 74 read MMSYSTEM's segment table.
- A second instance of a self-loading program: KERNEL boots the loader only as it loads the module; WinBox loads a module for each instance and would boot it again.
- Word 6 of a module's database, the next module's handle in KERNEL's chain from its head at 21Ch: WinBox keeps no chain ([[probe:moddb]]'s `next`). The database's usage count is written once, as 1, and not kept with the module's.
- The retry of a segment's load with the file opened again where the loader answers nought is followed here; no probe has made the loader fail.
- `KRNL286.EXE`'s loader is not read out.
- The linker's resource-flag fixes for a file of linker version below 5 (seg2 `10f4`-`1144`) are not followed in the database's layout.
