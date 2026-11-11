---
kind: guide
name: Paging in 386 enhanced mode
summary: A design for the pages of 386 enhanced mode — which linear pages WIN386 has present for a program, what a reach of one that is not does, what DPMI's paging functions promise and WIN386 answers, what WinBox does instead, three designs with their costs, and the decisions still open.
---

This page is a design. Nothing on it is built. On 2026-11-10 the owner decided to plan paging before any of it is built. It follows [[guide:enhanced-mode]], whose phase 4 left it open, and the model of [[guide:launcher]].

The question it answers comes from [[probe:w386lib]]. Routine 2 of its Win386 library is given a far pointer to the caller's buffer as a `DLL_PTR`. Under WIN386 the program ends with the box "W386LIB caused a Page Fault in module <unknown> at 186F:2124", and the probe no longer calls it. Why is read out in [[topic:win386]], "Libraries": the supervisor passes the 16:16 pointer through unchanged, the 32-bit routine adds it to its flat segment's base, and the store reaches a page WIN386 has not given the program. WinBox has no pages, so the same store lands and the routine returns.

## What WIN386 pages, as a program sees it

### Where a task's memory lies

[[measured]] [[probe:pgtouch]] takes linear addresses from `GetSelectorBase` and from DPMI 0501h's BX:CX, on DOSBox's 16 MB machine:

| What                             | 386 enhanced mode                    | Standard mode                                |
| -------------------------------- | ------------------------------------ | -------------------------------------------- |
| The probe's data segment         | `0004FA00h`                          | `00054BC0h`                                  |
| The probe's code segment         | `00044520h`                          | `00040D40h`                                  |
| `GlobalAlloc(GMEM_FIXED, 10h)`   | `00011680h`                          | `00016EE0h`                                  |
| 0501h of 1 byte                  | `806B9000h`                          | `001CB810h`                                  |
| 0501h of 1 byte again            | `80798000h`, DF000h (223 pages) past | `001CB821h`, 11h past: the byte and a header |
| 0501h of 3001h bytes, just after | `80799000h`, the next page           | `001CB832h`                                  |

- In enhanced mode, a small program's segments and a small fixed block lie in the first megabyte: KERNEL's global heap begins in the virtual machine's conventional memory. A block from 0501h starts on a page, above 80000000h. Two blocks asked for one after the other need not be near each other. The second block of 1 byte was given one page, and the block of 3001h bytes the page right after it.
- In standard mode, DOSX gives 0501h's blocks one after another, each a 10h-byte header and then the size asked for, not rounded ([[topic:dpmi-functions]]).

### Which pages are present

[[measured]] [[probe:pgtouch]] puts in an exception 0Eh handler of its own (0203h) and reads a byte through a selector of its own, its base set (0007h) to each address. In enhanced mode:

- **No fault:** each 0501h block's first and last byte, and the page past the first block; the `GlobalAlloc` block and the pages 1000h and 10000h past it; 400h, the BIOS's data. A write to the first block and to the page past it also goes through.
- **A fault, error code 4,** the handler called once, the frame's CS:IP the read itself: the probe's far pointer to its own data, taken as a linear address, as a Win386 routine takes a `DLL_PTR`; 110000h, just past the first megabyte and its high memory area; 80000000h, C0000000h and FFFFF000h; and the base of the 3001h block after 0502h freed it. A freed `GlobalAlloc` block's page is still present: KERNEL keeps its heap.
- **How far the pages go.** From the second 1-byte block, 5 pages are read and the sixth faults: its own page and the 3001h block's four, then nothing. From the first block, 228 pages are read before a fault: the 223 pages up to the second block are present too, given to something else. The page before each block is present.
- **Guard pages.** None were found around 0501h's blocks: the block of 3001h bytes is the page after the block before it, and the page past the last block is the first that faults. A stack's guard page, if WIN386 makes one, was not looked for.

[[documented]] Error code 4 is the 80386's page fault code for a read at user privilege of a page not present: bit 0 clear (not present), bit 1 clear (a read), bit 2 set (user mode) (Intel's _80386 Programmer's Reference Manual_, "Page-Fault Exception", interrupt 14).

[[measured]] In standard mode the same probe faults nowhere: every address reads, and from each block 1024 pages read with no fault, the most it tries.

### What a fault on a page not present does

[[documented]] The processor raises interrupt 14 with an error code and puts the linear address in CR2. `MOV` to or from a control register is privileged: at any privilege but 0 it is a general protection fault. A program at ring 3 cannot read CR2 or CR3 itself (Intel's _80386 Programmer's Reference Manual_, `MOV`, "Move to/from Special Registers").

[[read out]] **WIN386's handler.** `WIN386.EXE` is a `W3` file: a directory of 29 `LE` modules at 6800h, the first named `WIN386`, which is the virtual machine manager. Its object 1, from file offset 0A800h, is 12E14h bytes of 32-bit code and data. The offsets below are within it, its fixups applied:

- `743c`-`7546` takes the fault. It keeps five double words on its stack: CR2 (`745c`), the page's number, its page table entry, the virtual machine, and flags. It finds the page directory's entry through CR3 (`7451`-`7466`). With no page table there it sets flag 1 (`74c7`). With a page table, it reads the entry. An entry not present has a type in its bits 9-11, and that type picks a handler from a table at `10b00` (`749e`-`74b8`), called between two VMM services (07h and 08h). Types 0 and 1 go to `10b8`, which makes the page present if the page lies within the pageable range the pager keeps (`10d2`-`10e5`) and its record says it has been given; otherwise it fails. Types 2, 3 and 4 always fail with flag 8 (`7561`). Type 7 goes to a handler for the page by its number (`7568`), and types 5 and 6 to `1164` and `4e2c`. An entry that is present but faulted (`7546`) sets flag 8 unless its type is 7.
- When nothing made the page present (`74d8`-`7540`), flag 40h is set where a count the manager keeps at `fdec` is not nought. Otherwise flag 80h or 100h is set, by bit 5 of the first double word of the virtual machine's block. A chain of handlers is asked in turn (`7504`-`751c`, the list at `10afc`, empty in the file). If none takes the fault, it goes on through one of three vectors, by the same tests, with ESI 38h, which is 0Eh times 4. The vectors at `fdf8`, `fe00` and `fe04` are nought in the file and set as WIN386 runs. Another path (`761f`-`762f`) goes on through the vectors at `fdf4` and `fdfc` the same way with 34h, 0Dh times 4.
- [[inferred]] The count at `fdec` is the manager's own faults, and bit 5 is a virtual machine running in protected mode, so 80h is a fault of a protected-mode program and 100h one in V86 mode. The five double words, their flags (1, 8, 10h, 20h, 40h, 80h, 100h), the types and the chain match the Windows 3.1 DDK's invalid page fault structure, page types and `Hook_Invalid_Page_Fault`. Those names are recalled from the DDK, not read from a copy here. That a fault in a protected-mode program goes to the program's own exception 0Eh handler is what [[probe:pgtouch]] measures.

[[read out]] **KERNEL's handler.** As it starts, `KRNL386.EXE` puts in exception handlers with DPMI 0203h, keeping each one before it (seg1 `af86`-`b00f`). It puts in 0Bh at `5fde`, 0Dh at `5fa2`, 06h at `5fb1`, 0Ch at `5f93` and 0Eh at `5fc0`. Each pushes the handler it replaced and the offset of its fault's name in KERNEL's data. 0Eh's is `07F0h`, "a Page Fault", among "a General Protection Fault", "a Stack Fault", "an Illegal Instruction", "a Not Present Fault" and "an Application Fault". Each then goes to `5f75` and `5e1b`. A fault in code of a ring-3 local selector takes the path a general protection fault takes to KERNEL's boxes (`5e28`, the first box at `9ff7`; WinBox's `fault.rs`), with that name. A fault anywhere else goes on to the handler KERNEL replaced (`5f87`-`5f8a`). That is the "W386LIB caused a Page Fault in module <unknown> at 186F:2124" of [[probe:w386lib]]: 186Fh is the supervisor's 32-bit code selector, in no module.

[[measured]] **A program's own handler.** [[probe:pgtouch]]: WIN386 takes 0203h for 0Eh, and its handler is called for each fault above with error code 4, the frame's CS:IP the read that faulted. Moving IP past the read goes on, as [[probe:dpmiexc]] measured for exceptions 0 and 0Dh. [[documented]] DPMI 0.9's exception frame has the error code, CS:IP, the flags and SS:SP, but not the linear address: a 0.9 client cannot tell which page faulted. DPMI 1.0's frame adds CR2, and WIN386 is 0.9 ([[probe:dpmiver]]).

### What DPMI promises about pages

[[documented]] DPMI 0.9 (Intel's DOS Protected Mode Interface specification):

- **0500h** fills a 30h-byte structure. Only its first double word, the largest free block in bytes, is promised. The rest are the most unlocked and locked pages, the linear space, the unlocked, free and physical pages, the free linear space and the paging file's size, in pages, or FFFFFFFFh where the host does not know them.
- **0501h** allocates and commits a block of linear memory, answering its linear address in BX:CX and a handle in SI:DI; the address need not be on a page. **0502h** frees it. **0503h** resizes it and may move it. The memory is pageable unless locked.
- **0600h** locks a linear region (BX:CX, its size SI:DI) and **0601h** unlocks it, counting locks per page. **0602h** and **0603h** mark a real-mode region pageable and relock it. **0604h** answers the page size. **0702h** marks pages as candidates to be paged out, and **0703h** discards their contents. All are advisory where the host does not page.
- DPMI 1.0 adds **0504h** (a linear block, committed or not, at an address asked for), **0505h** (resize it), **0506h** and **0507h** (read and set each page's attributes: committed, read-only, accessed and dirty), **0508h** and **0509h** (map device or conventional memory into a block). These are what would let a program ask for pages that are not present on purpose.

[[read out]] **WIN386's answers** (the virtual machine manager's object 1 again):

- INT 31h's dispatcher (`a73e`-`a74f`) takes AH: past 0Eh is refused, and the rest go through a table of 15 handlers at `12da0`. A refusal (`a756`) sets the client's carry and leaves AX as it came; success (`a75c`) clears it. 0400h's handler (`b687`) answers AX 5Ah and BX 5.
- **AH 05h** (`b6f3`): AL past 3 is refused, so 0504h-0509h are. 0500h (`b70b`-`b770`) writes the free pages times 1000h, the free pages, the lockable pages (VMM service 59h), five figures of service 6Fh, the paging file's pages (a service of device 7), and three FFFFFFFFh. 0501h (`b775`-`b7e0`) rounds the size up to pages and calls VMM service 53h with the pages, type nought, the virtual machine and no other flag. That is a block of pages given whole, not locked, not zeroed, with its linear address in BX:CX and the service's handle in SI:DI, kept in a list of the virtual machine's. Nought pages is refused. 0502h (`b7f7`-`b83f`) finds the handle in that list and frees it (service 55h). 0503h (`b840`-`b8ac`) calls service 54h, which may move the block.
- **AH 06h** (`b8c9`): AL past 4 is refused. 0604h (`b98e`) answers BX nought and CX 1000h. 0600h and 0601h (`b8d7`-`b926`) count the pages from the one holding BX:CX to the one holding the last byte and call service 63h or 64h with them, refusing where it answers nought. 0602h and 0603h (`b92b`-`b98c`) take only the pages wholly inside the region, through service 65h twice, with flags 200h and 800h or 400h and 1000h.
- [[inferred]] By their arguments, services 53h, 54h, 55h, 59h, 63h, 64h and 6Fh are the DDK's `_PageAllocate`, `_PageReAllocate`, `_PageFree`, `_GetFreePageCount`, `_LinPageLock`, `_LinPageUnLock` and `_GetDemandPageInfo`. The numbers are read out; the names are not.

[[measured]] [[probe:pgtouch]], in enhanced mode: 0504h-0509h each set the carry and leave AX. 0600h and 0601h of the first block's page, of the page past it, and of 80000000h, which is not present, answer with the carry clear. Of FFFFF000h, with SI:DI 1000h, they are refused. [[inferred]] Its last byte's page, 0FFFFFh pages on, wraps to page nought, so the count comes out less than nothing. [[probe:dpmimem]] and [[probe:enhmode]] recorded the rest: 0500h's figures, 0501h's blocks on a page, 0602h, 0603h, 0702h and 0703h answered ([[guide:enhanced-mode]], "The DPMI host").

### What could not be read in reasonable time

- The names of WIN386's services. The numbers are read out; the names, and which device service 0 of device 7 is, come from the DDK as recalled ([[inferred]] above).
- Where `_PageAllocate` puts a block in linear space. [[probe:pgtouch]] measures where it did; the placing itself (service 53h's body) was not followed.
- The pager's own path (`10b8`'s `357c`, which reads a page back from `WIN386.SWP`), what the types 5, 6 and 7 handlers do, and what `9470` in KERNEL does with a fault outside a program's code.
- Which devices hook invalid page faults (the chain at `10afc` is filled as WIN386 runs) and what the vectors at `fdf8`-`fe04` are set to. That a program's handler is reached is measured, not read.
- Whether any page table or page directory is mapped where ring 3 can read it. The handler reaches them through a mapping of physical memory kept at `bdd0`, which was not looked for from a program.

### The probes that would measure the rest

Each is recorded in both modes unless it says otherwise, under the oracle's lock, as [[probe:pgtouch]] is.

- `pgbox`: a 16-bit program reads a page that is not present with no handler of its own. What is recorded is KERNEL's boxes, the first one's Ignore, and what the second one names (`--shoot`, `--then`). In standard mode nothing faults and no box shows.
- `pgwrite`: a write to a page that is not present (error code 6), and a write through a selector based in the first megabyte's ROM.
- `pgcreg`: `MOV EAX,CR0`, `CR2` and `CR3` at ring 3, under a 0Dh handler of the program's own, and `SMSW`. Whether WIN386 raises the general protection fault the 80386 manual says, or emulates the instruction.
- `pgbig`: 0501h blocks past the machine's 16 MB, touched page by page. Whether every page is present (committed, then paged out to `WIN386.SWP`), and how long a page read back takes ([[topic:timing]]).
- `pglock`: 0600h-0603h over ranges partly present, nested locks and unlocks, and 0702h and 0703h followed by a read.
- `pgheap`: `GlobalAlloc` of blocks of 64 KiB and more, `GlobalFree` and `GlobalCompact`, and whether KERNEL gives the pages of its heap back (0502h): a stale linear alias's read after.
- `pgw386`, enhanced mode only: [[probe:w386lib]]'s routine 2 called, its Page Fault box read and answered, so the `DLL_PTR` case is a record rather than a screen.

## What WinBox does now

- [[read out]] **Memory is made as it is written** (`crates/winbox-machine/src/memory.rs`). The machine has 4 GiB of linear addresses in blocks of 1 MiB, each made the first time anything in it is written. A block never written reads as garbage of its address. The processor reaches it through `Bus`, whose `None` stops the run for the host (`Exit::Host`), and that is only for a stretch the host makes as it is read.
- **Linear addresses are WinBox's own** (`crates/winbox-machine/src/descriptors.rs`). The segment a descriptor index names is the 64 KiB from the index times 64 KiB. A block from the global heap, or 0501h's in either mode, is a run of those (`dpmi_allocate_block`, `crates/winbox-win16/src/dpmi.rs`). The first megabyte the selectors reach is at `FFE00000h`, the global table at `FFFEF000h` and the local table at `FFFF0000h`. [[probe:pgtouch]]'s layout differs in every address, in both modes, as a known gap.
- **No page tables, no CR3, no vector 14** (`crates/winbox-cpu/src/lib.rs`). A linear address is a segment's base plus the offset, once the offset is checked against the limit (`linear_sized`, and `outside` off the common path for an offset past the limit or a segment that expands down). The core keeps CR0's PE bit (`protected`) and the machine status word for `SMSW` (`msw`), and nothing else of the control registers. It raises vector 13 for a limit; the host raises the rest (`fault_vector.rs`).
- **The host's faults.** A fault the processor stops at goes to a program's DPMI exception handler for it, where there is one (`dpmi_fault`, `crates/winbox-win16/src/run.rs`), with error code nought for any vector but 12 and 13. Otherwise only a general protection fault goes on to KERNEL's boxes (`crates/winbox-win16/src/fault.rs`); any other stops the run.
- **DPMI's paging functions are answered with no pager behind them**, as each host answers them: 0600h-0603h, 0702h and 0703h with the carry clear, 0604h 1000h, 0504h and the rest of DPMI 1.0's refused ([[topic:dpmi-functions]]).

[[measured]] So [[probe:pgtouch]] in enhanced mode finds no fault anywhere in WinBox, and 1024 pages from every block. Its `touch`, `scan` and `layout` are known gaps. Its `dpmi` is a known gap too, for 0600h and 0601h of FFFFF000h, which WinBox answers.

## Designs

What follows is enhanced mode's alone (below, "Standard mode").

### (a) A set of present pages, checked off the fast path

The DPMI host keeps which linear pages are present: the first megabyte and its high memory area, each block's pages from the global heap, 0501h and the modules' segments, and what WinBox keeps for itself (the descriptor tables, the first megabyte's copy at `FFE00000h`, the host's stack and code). The core asks the set only where it already leaves the fast path.

- **No check on each access.** Each segment register's cache already compares every offset with one bound, `past_limit`, and goes to `outside` when it is passed. A second bound can be kept beside it: one past the last offset whose page, counted from the base, is present without a gap (`past_present`). That bound is the smaller of the limit and the first page that is not present, worked out as the segment is loaded and again whenever the set changes. An access below it is as fast as now. One past it goes to `outside`, which asks the set and faults with vector 14 or goes on. This is so for a 32-bit flat segment too. A Win386 program's flat segments have their base at its image's block, so its code, stack and image lie below the bound. Only an access past the first gap (its later blocks, or a `DLL_PTR` added in) takes the slower path, and pays a lookup.
- **The fault** carries an error code (bits 0-2 as the 80386 sets them) and the linear address. The host gives vector 14 to a program's 0203h handler with that code, else KERNEL's boxes with "a Page Fault" (seg1 `5fc0`). `fault.rs` extends to it.
- **The grain.** Pages of 4 KiB, as WIN386's are, or WinBox's tiles of 64 KiB: a descriptor index whose segment is given is present whole. Pages are stricter than Windows wherever WIN386 happened to put something next to a block ([[probe:pgtouch]]'s page past the first block reads, because something else is there). Tiles are laxer: a read just past a block's pages but inside its tile does not fault. Both fault for [[probe:w386lib]]'s `DLL_PTR`: its 16:16 pointer taken as an offset lands far past anything given.
- **What it makes WinBox match.** [[probe:w386lib]]'s routine 2 and its box. [[probe:pgtouch]]'s `touch` records, and its `scan` records where the layout lets them. A program that probes memory by catching exception 0Eh, as some extenders' memory tests do.
- **Speed.** [[measured]] A prototype, not committed: `Bus` wrappers around WinBox's `Memory`, run by `winbox-cpu`'s bench workloads in protected mode, 2026-11-10 on the development machine with other work running (load average about 14), five runs of 2 seconds each, medians. A present-page bitmap asked on every access, the instruction fetches included, cost 13% on register arithmetic, 11% on loads and stores, 33% on pushes and pops and 17% on compiled code's mix. Asked only past `past_present`, the common path is the one there now: the same compare, so nothing to measure until a program crosses the bound.
- **What it touches.** `winbox-machine` (the set, beside `Memory`); `winbox-cpu` (`Segment` gains the bound, `descriptor` works it out through a `Bus` question whose default answers "everything", so the hardware vectors and `VecBus` are unchanged, `outside` raises vector 14, and the core keeps the error code and address for the host); `winbox-win16` (0501h-0503h, `GlobalAlloc` and its kin, module loading and freeing keep the set; `dpmi_fault` passes the error code; `fault.rs` names the fault).

Phases, each a branch of its own measured against recordings:

1. **The probes** above, recorded in both modes.
2. **The set, kept but not enforced.** In enhanced mode only, with a check in the replay and the corpus that no access of WinBox's own or a program's lands outside it where Windows' did not fault. This finds what WinBox keeps in linear memory that the set left out.
3. **The bound and the fault.** `past_present` in the core, vector 14 with its code, a program's handler; the hardware vectors and the bench before and after.
4. **KERNEL's box** for a page fault, then [[probe:w386lib]]'s routine 2 called again, and its `pgw386` record.

### (b) Page tables and CR3

The machine gets page tables, CR3 and a translation for every access, as the 80386 does.

- **What a program could see of them.** Nothing measured or read shows a Windows program reading CR3 or a page table. At ring 3, `MOV` from a control register is a general protection fault ([[documented]], above). DPMI 0.9 has no function that answers a page's frame or entry, and WIN386 refuses 1.0's 0506h. What tables would add over (a) is aliasing, two linear pages on one frame, which WIN386 does make: the first megabyte's pages, and 0800h's mappings of physical memory. A program sees that only as the same bytes at two addresses, which WinBox can give without tables.
- **Speed.** [[measured]] The same prototype with a flat table of 2^20 entries, looked up on every access: 11% on register arithmetic, 18% on loads and stores, 29% on pushes and pops and 20% on the mix. A real 80386's two-level walk behind a cache of translations, flushed when a mapping changes, would cost more.
- **What it touches.** Every access in the core, the descriptor reads, the host's every read and write of a program's memory (each a translation), and 0800h. Its phases would be (a)'s with the translation in place of the set.
- Not recommended: it costs on every instruction for nothing a program can see beyond (a).

### (c) Others

- **(c1) WIN386's layout.** Blocks placed where WIN386 places them: KERNEL's heap from the virtual machine's conventional memory, 0501h's blocks a page apart above 80000000h. That would make [[probe:pgtouch]]'s `layout` and `scan` agree, and a page grain exact. It is a change to how every selector's base is found (index times 64 KiB today) and to every place that assumes it. It is large, and nothing yet depends on where blocks lie. It can come after (a), if a program is found to depend on it.
- **(c2) Nothing.** Leave paging as a named gap: [[probe:w386lib]]'s routine 2 not called, [[probe:pgtouch]]'s records known gaps. It costs nothing, and only programs that are wrong under Windows behave differently: a program that faults under Windows runs on in WinBox.

## Standard mode

Nothing changes. [[read out]] DOSX has no pager: 0600h-0603h answer with nothing done, 0604h answers 1000h, and 0800h answers the address it was given, the linear address being the physical one ([[topic:dpmi-functions]]). [[measured]] [[probe:pgtouch]] in standard mode faults nowhere: past every block, at 110000h, 80000000h, C0000000h and FFFFF000h, through a far pointer taken as linear, and in a freed block. In (a) the set is not kept in standard mode, and every segment's bound is its limit, as now.

## Recommendation

Design (a), at the grain of WinBox's tiles first, in the four phases above, and only after phase 1's probes. It is the only design that makes [[probe:w386lib]]'s routine 2 fault as Windows does without a cost on the common path: the bound rides on the limit compare the core already makes. It matches what a program can see, the fault and its error code, and not what it cannot see, the tables. A page grain and WIN386's layout (c1) can follow if a program is found to need them. Until a program of the corpus or the owner's needs paging, (c2) is a fair place to stop after phase 1.

## Questions for the owner

1. **When.** Build (a) now, or record phase 1's probes and leave the fault a named gap until a program needs it? The one case known is a probe's own routine.
2. **The grain.** Tiles of 64 KiB, which never fault where a block's segment is, or pages of 4 KiB, which fault just past a block where WIN386 may have put something else and not fault?
3. **The layout.** Keep WinBox's addresses (index times 64 KiB) and hold [[probe:pgtouch]]'s `layout` as a known gap, or plan (c1)?
4. **WinBox's own code.** Where KERNEL or USER, which are WinBox's, read or write a program's pointer into a page that is not present, Windows' own code would fault inside its module. Should WinBox raise that fault, naming the module as Windows would, or answer as it does now?

## Not yet done

- Every design and phase above; the probes `pgbox`, `pgwrite`, `pgcreg`, `pgbig`, `pglock`, `pgheap` and `pgw386`.
- What "could not be read in reasonable time", above: WIN386's service names, `_PageAllocate`'s placing, the pager's path, the fault chain's members, and whether ring 3 can reach a page table.
- `KRNL386.EXE`'s "Segment Load Failure" (`0826h`), pushed at seg1 `5fcf`-`5fd9` by code none of the 0203h calls names, and "a Divide by Zero" (`07BAh`), which none of the handlers KERNEL puts in names.
