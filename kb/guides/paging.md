---
kind: guide
name: Paging in 386 enhanced mode
summary: A design for the pages of 386 enhanced mode — which linear pages WIN386 has present for a program, what a reach of one that is not does and what KERNEL shows for it, what DPMI's paging functions promise and WIN386 answers, what WinBox does instead, three designs with their costs, and the decisions still open.
---

This page is a design, built in phases. On 2026-11-10 the owner decided to plan paging before any of it is built; phase 1's probes are recorded (below, "What phase 1's probes measured"). Phase 2, the set of present pages kept but not enforced, is built (below, "Phase 2: the set of present pages"). Phase 3 is built: which pages of a block the processor has reached (below, "Phase 3: first touch"), then the fault in 386 enhanced mode, with KERNEL's boxes (below, "The fault"). It follows [[guide:enhanced-mode]], whose phase 4 left it open, and the model of [[guide:launcher]].

The question it answers comes from [[probe:w386lib]]. Routine 2 of its Win386 library is given a far pointer to the caller's buffer as a `DLL_PTR`. Under WIN386 the program ends with KERNEL's box "W386LIB caused a Page Fault in module <unknown>186F:2124" (the recorder's screen), and the probe no longer calls it; [[probe:pgw386]] calls the same routine and records it. Why is read out in [[topic:win386]], "Libraries": the supervisor passes the 16:16 pointer through unchanged, the 32-bit routine adds it to its flat segment's base, and the store reaches a page WIN386 has not given the program. WinBox has no pages, so the same store lands and the routine returns.

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

- `743c`-`7546` takes the fault. It keeps five double words on its stack: CR2 (`745c`), the page's number, its page table entry, the virtual machine, and flags. It finds the page directory's entry through CR3 (`7451`-`7466`). With no page table there it sets flag 1 (`74c7`). With a page table, it reads the entry. An entry not present has a type in its bits 9-11, and that type picks a handler from a table at `10b00` (`749e`-`74b8`), called between two VMM services (07h and 08h). Types 0 and 1 go to `10b8`. It fails (flag 20h) if it is already inside itself, and fails if the address lies outside a range kept at `be2c`-`be30` (`10d2`-`10e5`) or the page's 16-byte record has bit 2 of its byte 0Ah set. Otherwise, with bit 0 of the record set, it writes the entry present from the record (`1132`-`1159`); with it clear, it calls `357c` and sets the record's low three bits (`1106`-`1118`), failing with flag 10h where `357c` fails. Types 2, 3 and 4 always fail with flag 8 (`7561`). Type 7 goes to a handler for the page by its number (`7568`), and types 5 and 6 to `1164` and `4e2c`. An entry that is present but faulted (`7546`) sets flag 8 unless its type is 7.
- When nothing made the page present (`74d8`-`7540`), flag 40h is set where a count the manager keeps at `fdec` is not nought. Otherwise flag 80h or 100h is set, by bit 5 of the first double word of the virtual machine's block. A chain of handlers is asked in turn (`7504`-`751c`, the list at `10afc`, empty in the file). If none takes the fault, it goes on through one of three vectors, by the same tests, with ESI 38h, which is 0Eh times 4. The vectors at `fdf8`, `fe00` and `fe04` are nought in the file and set as WIN386 runs. Another path (`761f`-`762f`) goes on through the vectors at `fdf4` and `fdfc` the same way with 34h, 0Dh times 4.
- [[inferred]] The count at `fdec` is the manager's own faults, and bit 5 is a virtual machine running in protected mode, so 80h is a fault of a protected-mode program and 100h one in V86 mode. The five double words, their flags (1, 8, 10h, 20h, 40h, 80h, 100h), the types and the chain match the Windows 3.1 DDK's invalid page fault structure, page types and `Hook_Invalid_Page_Fault`. Those names are recalled from the DDK, not read from a copy here. That a fault in a protected-mode program goes to the program's own exception 0Eh handler is what [[probe:pgtouch]] measures.

[[read out]] **KERNEL's handler.** As it starts, `KRNL386.EXE` puts in exception handlers with DPMI 0203h, keeping each one before it (seg1 `af86`-`b00f`). It puts in 0Bh at `5fde`, 0Dh at `5fa2`, 06h at `5fb1`, 0Ch at `5f93` and 0Eh at `5fc0`. Each pushes the handler it replaced and the offset of its fault's name in KERNEL's data. 0Eh's is `07F0h`, "a Page Fault", among "a General Protection Fault", "a Stack Fault", "an Illegal Instruction", "a Not Present Fault" and "an Application Fault". Each then goes to `5f75` and `5e1b`. A fault in code of a ring-3 local selector takes the path a general protection fault takes to KERNEL's boxes (`5e28`, the first box at `9ff7`; WinBox's `fault.rs`), with that name. A fault anywhere else goes on to the handler KERNEL replaced (`5f87`-`5f8a`). That is the "W386LIB caused a Page Fault in module <unknown>186F:2124" of [[probe:w386lib]]: 186Fh is the supervisor's 32-bit code selector, in no module. [[measured]] [[probe:pgbox]] and [[probe:pgw386]] record both paths (below).

[[measured]] **A program's own handler.** [[probe:pgtouch]]: WIN386 takes 0203h for 0Eh, and its handler is called for each fault above with error code 4, the frame's CS:IP the read that faulted. Moving IP past the read goes on, as [[probe:dpmiexc]] measured for exceptions 0 and 0Dh. [[documented]] DPMI 0.9's exception frame has the error code, CS:IP, the flags and SS:SP, but not the linear address: a 0.9 client cannot tell which page faulted. DPMI 1.0's frame adds CR2, and WIN386 is 0.9 ([[probe:dpmiver]]).

### What DPMI promises about pages

[[documented]] The DOS Protected Mode Interface specification, version 0.9:

- **0500h** fills a 30h-byte structure. Only its first double word, the largest free block in bytes, is promised. The rest are the most unlocked and locked pages, the linear space, the unlocked, free and physical pages, the free linear space and the paging file's size, in pages, or FFFFFFFFh where the host does not know them.
- **0501h** allocates and commits a block of linear memory, answering its linear address in BX:CX and a handle in SI:DI; the address need not be on a page. **0502h** frees it. **0503h** resizes it and may move it. The memory is pageable unless locked.
- **0600h** locks a linear region (BX:CX, its size SI:DI) and **0601h** unlocks it, counting locks per page. **0602h** and **0603h** mark a real-mode region pageable and relock it. **0604h** answers the page size. **0702h** marks pages as candidates to be paged out, and **0703h** discards their contents. All are advisory where the host does not page.
- DPMI 1.0 adds **0504h** (a linear block, committed or not, at an address asked for), **0505h** (resize it), **0506h** and **0507h** (read and set each page's attributes: committed, read-only, accessed and dirty), **0508h** and **0509h** (map device or conventional memory into a block). These are what would let a program ask for pages that are not present on purpose.

[[read out]] **WIN386's answers** (the virtual machine manager's object 1 again):

- INT 31h's dispatcher (`a73e`-`a74f`) takes AH: past 0Eh is refused, and the rest go through a table of 15 handlers at `12da0`. A refusal (`a756`) sets the client's carry and leaves AX as it came; success (`a75c`) clears it. 0400h's handler (`b687`) answers AX 5Ah and BX 5.
- **AH 05h** (`b6f3`): AL past 3 is refused, so 0504h-0509h are. 0500h (`b70b`-`b770`) writes the free pages times 1000h, the free pages, the lockable pages (VMM service 59h), five figures of service 6Fh, the paging file's pages (a service of device 7), and three FFFFFFFFh. 0501h (`b775`-`b7e0`) rounds the size up to pages and calls VMM service 53h with the pages, type nought, the virtual machine and no other flag. It answers the block's linear address in BX:CX, always on a page, and the service's handle in SI:DI, which it also keeps in a list (services 88h, 9Dh and 9Eh, not followed). Nought pages is refused. 0502h (`b7f7`-`b83f`) finds the handle in that list and frees it (service 55h). 0503h (`b840`-`b8ac`) calls service 54h with the pages and answers the address and handle it gives back, which may be new.
- **AH 06h** (`b8c9`): AL past 4 is refused. 0604h (`b98e`) answers BX nought and CX 1000h. 0600h and 0601h (`b8d7`-`b926`) count the pages from the one holding BX:CX to the one holding the last byte and call service 63h or 64h with them, refusing where it answers nought. 0602h and 0603h (`b92b`-`b98c`) take only the pages wholly inside the region, through service 65h twice, with flags 200h and 800h or 400h and 1000h.
- [[inferred]] By their arguments, services 53h, 54h, 55h, 59h, 63h, 64h and 6Fh are the DDK's `_PageAllocate`, `_PageReAllocate`, `_PageFree`, `_GetFreePageCount`, `_LinPageLock`, `_LinPageUnLock` and `_GetDemandPageInfo`. The numbers are read out; the names are not.

[[measured]] [[probe:pgtouch]], in enhanced mode: 0504h-0509h each set the carry and leave AX. 0600h and 0601h of the first block's page, of the page past it, and of 80000000h, which is not present, answer with the carry clear. Of FFFFF000h, with SI:DI 1000h, they are refused. The count there is one page, FFFFFh (`b8f1`-`b8fd`), so service 63h refuses that page where it took 80000000h's; why was not followed. [[probe:dpmimem]] and [[probe:enhmode]] recorded the rest: 0500h's figures, 0501h's blocks on a page, 0602h, 0603h, 0702h and 0703h answered ([[guide:enhanced-mode]], "The DPMI host").

### What could not be read in reasonable time

- The names of WIN386's services. The numbers are read out; the names, and which device service 0 of device 7 is, come from the DDK as recalled ([[inferred]] above).
- Where `_PageAllocate` puts a block in linear space. [[probe:pgtouch]] measures where it did; the placing itself (service 53h's body) was not followed.
- The pager's own path (`10b8`'s call to `357c`, made where bit 0 of the page's record is clear), what the types 5, 6 and 7 handlers do, and what `9470` in KERNEL does with a fault outside a program's code.
- Which devices hook invalid page faults (the chain at `10afc` is filled as WIN386 runs) and what the vectors at `fdf8`-`fe04` are set to. That a program's handler is reached is measured, not read.
- Whether any page table or page directory is mapped where ring 3 can read it. The handler reaches them through a mapping of physical memory kept at `bdd0`, which was not looked for from a program.

### What phase 1's probes measured

Each was recorded in 386 enhanced mode and in standard mode, under the oracle's lock, as [[probe:pgtouch]] is, but [[probe:pgw386]], in enhanced mode alone. A program's own handler (0203h) for 0Eh, and for 0Dh and 06h where it says so, notes each fault's vector, error code and CS:IP, and moves IP past the instruction (`oracle/probes/pgreach.h`). Standard mode faults nowhere in any of them: DOSX has no pager.

**[[probe:pgbox]], KERNEL's boxes.** [[measured]] A program with no handler of its own reads a byte at 80000000h (`mov al,es:[bx]`, 3 bytes). In enhanced mode KERNEL shows its first box, as for a general protection fault ([[topic:application-errors]]): the caption the module's name, `PGBOXC`, the same three lines, Close with the focus and Ignore. **Ignore** steps over the read: the program goes on, its window there, and AL is the 5Ah it held before. A second read brings the first box again; **Close** goes on to the second box:

> Application Error
>
> PGBOXC caused a Page Fault in
> module PGBOXC.EXE at 0001:0028.

with one button, Close. 0001:0028 is the read, `26 8A 07` at offset 28h of the program's first segment. After Close the program has ended: its window is gone and [[fn:KERNEL.GetModuleUsage]] answers nought. In standard mode both reads go on and read nought, and no box shows. The boxes were recorded as the screen (`record.mjs --shoot posted:3 --then Tab,Return:8 --then Return:4 --then Return:4`); the records are the program's.

**[[probe:pgw386]], a `DLL_PTR` in a Win386 library.** [[measured]] A 16-bit program calls [[probe:w386lib]]'s routine 2 (`Fill`, the same source, in a library of its own, `PGW386D.DLL`) with a far pointer to its buffer. The routine's store faults in the supervisor's 32-bit code, and KERNEL shows **no first box**: no Ignore is offered. Its one box, Close in the middle:

> Application Error
>
> PGW386 caused a Page Fault in
> module <unknown>186F:20A4
> PGW386 will close.

No `at` and no full stop after the module, and a third line the box of [[probe:pgbox]] does not have; [[probe:w386lib]]'s screen says the same with `W386LIB` and `186F:2124`. After Close the program has ended, and with it Windows, the probe being the shell: its last record is the call. Why KERNEL offers no Ignore, and builds the text so, for a fault in a selector of no module was not read out (`9ff7`'s tests, [[topic:application-errors]]). The probe is built as [[probe:w386lib]] is, a 16-bit program with its Win386 library in `oracle/build/win386`: the fault is in the library's 32-bit code, not the caller's.

**[[probe:pgwrite]], writes.** [[measured]] In enhanced mode a write at 80000000h, C0000000h and FFFFF000h calls the handler for 0Eh once, with error code 6 (a write at user privilege of a page not present), CS:IP the write; a read of 80000000h after still faults, with code 4: a write does not make a page present. A write to a 0501h block's page and to the page past it goes through. Writes to the first megabyte's ROM do not fault in either mode: at C0000h (the video BIOS) and F0000h the byte read after is the byte before; at FFFF0h it is the byte written, in both modes alike, so that is DOSBox's machine, not WIN386.

**[[probe:pgrom]], the first megabyte's ROM page by page.** [[measured]] At FF0h of each page from C0000h to FF000h, the byte read, its complement written and the byte read again, in both modes: C0000h-C7FFFh keep no write; C8000h-EFFFFh keep every one; of F0000h-FFFFFh, F1000h and FF000h keep a write in both modes, FE000h in standard mode alone, and the rest none. No write faults. [[read out]] DOSBox 0.74-3 makes C0000h-C7FFFh and F0000h-FFFFFh ROM (`src/hardware/memory.cpp` 576-583), and its ROM's page handler drops a write (`ROMPageHandler`, 105-119). Its dynamic core for x86-64, `core_dynrec`, puts a handler of its own on a page where it has run code, and that handler writes the page as any other (`src/cpu/core_dynrec/cache.h` 143-147); the core for 32-bit x86 checks for ROM there (`core_dyn_x86/cache.h` 111), this one does not. [[inferred]] The pages that keep a write are those holding code DOSBox runs: F1000h its callbacks (`CB_SOFFSET`, `include/callback.h` 39), FF000h the timer's handler at F000h:FEA5h (`include/bios.h` 106), FE000h the keyboard's at F000h:E987h (107), which in enhanced mode the dynamic core had not run. It is DOSBox's machine, not a PC's ROM.

**[[probe:pgcreg]], the control registers.** [[measured]] The probe runs at privilege 3 in both modes. In standard mode `MOV EAX,CR0`, `CR2` and `CR3` each raise exception 0Dh with error code nought, CS:IP the instruction, as the 80386 manual says. In enhanced mode **none of them reaches the program's handlers** (0Dh, 06h or 0Eh), and EAX is left as it was (5A5A5A5Ah): the instruction is passed over with nothing read. `SMSW AX` runs in both: 0001h in standard mode (PE), 000Bh in enhanced mode (PE, MP and TS).
[[read out]] **WIN386's handler.** `WIN386.EXE`'s virtual machine manager, object 1 (offsets as above). The gate for 0Dh (`5eb8`) goes through the common entry (`5ca1`), which, for a fault in protected mode, jumps through a table at `ff88`. The manager's start-up (object 2, `155a9`-`155b4`) puts `75e8` in its entry for 0Dh and keeps the one before at `fdfc`. `75e8` reads the bytes at CS:EIP and goes by a table at `10ee0`, one entry a first byte. The prefixes (26h, 2Eh, 36h, 3Eh, 64h-67h, F0h, F2h, F3h; `7635`-`768d`) are each noted and passed, EIP moved past them. 0Fh goes to `76ae`: for a second byte of 20h to 23h, `MOV` to or from a control or debug register, it adds 3 to EIP and returns (`76cc`), nothing read or written; for 06h it runs `CLTS` and adds 2 (`76d1`). Anything else -- 24h and 26h, the test registers, among it -- takes the prefixes back off EIP (`760f`-`761d`) and goes on to the handler kept at `fdfc` (`762f`), which gives the fault to the program's handler for it (`afcd`). So the probe's three `MOV`s are stepped over, as recorded.

**[[probe:pgbig]], more than the machine.** [[measured]] In enhanced mode 0500h answers a largest free block of 57,760 KiB, 3,718 free pages (14.5 MiB) and a paging file's size. A block of 24 MiB from 0501h is given, and each of its 6,144 pages is written and read back with no fault, every page holding its byte: committed whole, the pages past what is free paged out to the swap file and back. 0500h's largest block is then 33,184 KiB, 24,576 less. In standard mode 24 MiB is refused (AX kept); the largest block, 14,544 KiB, is given and every page reads back. How long a page takes is in [[topic:timing]], "Paging".

**[[probe:pglock]], locks and hints.** [[measured]] In enhanced mode a 0501h block of 2000h bytes has its two pages present and the third faults (code 4). 0600h and 0601h of the block are answered; of a range from its last page into the page past it, and of that page alone, refused, carry set and AX kept. Of 80000000h, not present either, they are answered, as [[probe:pgtouch]] found, and a read after the lock still faults: a lock does not make a page present. Two locks and three unlocks of one page are all answered: an unlock past the count is not refused. 0602h and 0603h of a block from `GlobalDosAlloc` are answered. After 0702h, and after 0703h, a read of the block's page does not fault and finds the byte written before. In standard mode every call is answered and nothing faults.

**[[probe:pgheap]], KERNEL's heap.** [[measured]] In enhanced mode `GlobalAlloc` of 64 KiB and 128 KiB gives blocks in the first megabyte (about `00052B80h`, 64 KiB apart), and of 1 MiB a block at `80798000h`, on a page above 80000000h, where 0501h's blocks lie. Each block's bytes are read through a selector of the probe's own based at its address. After `GlobalFree` of all three and `GlobalCompact(-1)`, the two small blocks' pages are all present and keep their bytes: KERNEL keeps its heap. Of the 1 MiB block's 256 pages, 253 fault (code 4): KERNEL gave them back. The three that read, and keep their bytes, are pages 1, 128 and 255, three of the four pages the probe had read before the free through the same selector; the first page, also read before, faults. Why is read out below ("The freed block's pages"). In standard mode nothing faults.

## Phase 2: the set of present pages

Built on 2026-11-11, in enhanced mode, following the owner's decisions of that day (below). WinBox keeps which of its linear pages WIN386 would have present, as blocks are given and freed, and checks no access against it. Only DPMI 0500h, 0600h and 0601h answer by it.

### The freed block's pages

[[read out]] `WIN386.EXE`'s virtual machine manager, object 1, its service table at `106ac` (the manager's device block at `10a74`). Service 55h, `_PageFree` by the DDK's name as recalled, is `30eb`. It finds the block's first page record and its count and calls `31e6`, which runs over the block's pages (`323a`-`3294`), 16 bytes of record a page:

- `323a`-`323d` writes nought (`stosd`) through EDI, which `3226`-`3234` set to the first page's page table entry.
- `323f` then sets EDI to the page's record for the call to `39de`, which takes the record off a list and keeps EDI. From the second page on, the `stosd` lands in the record before, not the page table.
- Each record is cleared and marked free (`3246`-`3269`: its second double word 40000h, so bit 2 of its byte 0Ah), and a page with a frame gives it back (`3270`-`327d`).
- After the loop the page tables are flushed (`3296`-`3299`, `MOV CR3`).

So the first page's entry is cleared, and every other page keeps the entry it had. WIN386 gives a page a frame the first time it is reached, by a read or a write (`10b8`, `357c`): its entry is then present. A page given a frame stays present after the free, its bytes there until the frame is given to another page. A page never reached has no entry present. Its fault goes to `10b8`, which refuses it, the record being marked free (`10d2`-`10e5`), and the program's handler gets it.

[[measured]] [[probe:pgfree]] in enhanced mode:

- **0502h.** A block of 16 pages: pages 0, 2, 5 and 9 written, 7 and 11 read alone, the rest untouched. After 0502h, pages 2, 5 and 9 read their bytes, 7 and 11 read nought, and page 0, the untouched pages and the page past the block fault.
- **`GlobalFree`.** `GlobalAlloc` of 1 MiB gives a block at `80798000h`. With pages 0, 2 and 5 written and 7 read alone, `GlobalFree` alone gives the pages back as 0502h does: 253 of the 256 fault, pages 2, 5 and 7 read. `GlobalCompact(-1)` after changes nothing. [[read out]] KERNEL's one call to 0502h frees a block of its heap (`KRNL386.EXE` seg1 `351a`-`3538`); which path from `GlobalFree` reaches it was not followed.
- **0503h's shrink.** A block of 8 pages, each written, cut to 2: page 2, the first cut off, faults; pages 3 to 7 still read. [[inferred]] `_PageReAllocate` (service 54h, `2c04`, not followed) frees the pages it cuts off as `_PageFree` frees a block.

That is [[probe:pgheap]]'s three pages: 1, 128 and 255 were written and read, page 0 too, but page 0 is the one whose entry is cleared.

[[inferred]] This is WIN386's, not DOSBox's machine: DOSBox keeps its translations until `MOV CR3` (`src/cpu/paging.cpp`, `PAGING_ClearTLB`), and WIN386 loads CR3 after the loop, so what reads is what the page tables say. A real 80386 would read the same.

### The set's rules

`crates/winbox-machine/src/pages.rs`, kept beside the memory. A page is 4 KiB. A page is present in WinBox where the matching page of the block Windows would have given is: page _n_ of WinBox's block, counted from its base at its descriptor index times 64 KiB, stands for page _n_ of Windows' block, counted from its base on a page.

- **The first megabyte** and its high memory area, at linear nought ([[probe:pgtouch]]: 400h reads, 110000h faults), and WinBox's copy of it at `FFE00000h`, are present from the start.
- **WinBox's own tables**, from the global table at `FFFEF000h` to the top of the 4 GiB, are present.
- **Memory WinBox's layout leaves unused** is present: every page of its blocks' addresses, up to `20000000h`, that no freed block has dropped -- a descriptor's slot given to nothing, the rest of a block's 64 KiB (the owner's decision of 2026-11-11). Past `20000000h` nothing is present but the copy of the first megabyte and the tables.
- **A segment mapped** (a module's, or a block of KERNEL's heap in the first megabyte) is present over its 64 KiB, and stays present when freed. KERNEL keeps its heap, and the first megabyte is always present ([[probe:pgtouch]], [[probe:pgheap]]: a freed small block reads).
- **A block with pages of its own** has its pages present and committed, and the rest of its 64 KiB committed to nothing: present still, as memory WinBox's layout leaves unused (the owner's decision of 2026-11-11, below), though in Windows the page past it faults ([[probe:pglock]]: two pages read, the third faults). It is committed whole ([[probe:pgbig]]). Such a block is DPMI 0501h's, or a block of KERNEL's of more than 256 KiB. [[measured]] [[probe:pgfree]]: `GlobalAlloc` of 192 and 256 KiB gave blocks at `00045B40h`, of 384, 512 and 768 KiB at `80798000h`. [[read out]] KERNEL grows its heap with 0501h (seg1 `397e`: the size asked for, or 20000h for less than 10000h, on a page) only where no free block holds the size, so the true bound is the first megabyte's room at the time. 257 to 383 KiB were not measured.
- **A block freed** with pages of its own (0502h, `GlobalFree`, or the pages 0503h cuts off) loses its first page and every page never reached. It keeps the rest.
- **0503h growing** a block gives the new pages. A block WinBox moves is freed at the old base and given at the new.
- **Reached** is seen as the processor first reaches each page, a read or a write (phase 3, below). In enhanced mode each page of a block with pages of its own starts unreached.

The set is recorded in either mode, as the mode is chosen after the machine is made; only enhanced mode asks it.

### What answers by it

- **0600h and 0601h.** [[read out]] `_LinPageLock` (service 63h, `1337`) and `_LinPageUnLock` (64h, `1651`) call `190d`, which refuses the range where any page's record is marked free (`1922`-`1930`) before it counts a lock. Outside the pageable memory the services answer by other tests: a range at `bd94` answered with nothing done (`1386`-`139c`), and the first megabyte's pages (`1438`). WinBox refuses a range holding a page of its blocks' addresses (110000h up to `20000000h`) not committed to a block, the carry set and AX kept, and answers any other. [[measured]] [[probe:pglock]] now agrees whole: the page past a block refused, 80000000h answered. [[probe:pgfree]]: a freed block's pages are refused, those that still read too.
- **0500h.** [[measured]] The largest free block shrinks as 0501h gives blocks and grows back as they are freed. Writing the pages does not move it. [[probe:pgbig]]: 57,760 KiB, then 33,184 with 24 MiB given. [[probe:pgfree]]: 57,760, then 56,736 with 1 MiB given, the same with its pages written, and 57,760 after 0502h; the free pages stay 3,718 throughout. [[read out]] WIN386's 0500h writes the free pages times 1000h and the free pages as its first two double words (`b70b`-`b770`): WinBox takes each block's pages from both. DOSX's largest block shrinks by each block and its 10h-byte header ([[probe:pgbig]] in standard mode: 14,545 KiB, then 1 KiB with 14,544 KiB given). KERNEL's own blocks with pages of their own, which KERNEL asks 0501h for, are not counted: no probe measured them.

### The audit

`crates/winbox-audit/tests/paging.rs` runs the paging probes in enhanced mode, as the replay runs them, with the set enforced. An access by the processor to a page the set does not hold is taken as WIN386 takes it. The access goes to the program's handler for exception 0Eh, error code 4 for a read and 6 for a write, CS:IP the instruction. Without a handler, the access is let through and listed. The check is built only with the `audit` feature, which only that crate's test turns on. The probes' records are then set beside Windows'. Each one that differs is a named case with its cause, or the test fails; a named case no record needs fails it too. Since 2026-11-13 [[probe:pgcreg]] and [[probe:pgrom]] are run too, and agree whole.

[[measured]] On 2026-11-11, with phase 2's fingerprints, 157 of the eight probes' 203 records agreed with Windows': [[probe:pglock]] (26 of 26) and [[probe:pgw386]] (3 of 3) whole; [[probe:pgheap]] 41 of 45, [[probe:pgbig]] 11 of 14, [[probe:pgwrite]] 15 of 19, [[probe:pgbox]] 5 of 8, [[probe:pgtouch]] 35 of 54 and [[probe:pgfree]] 21 of 34. [[probe:pgheap]]'s freed block agrees page for page: pages 1, 128 and 255 read, the other 253 fault. The audit stopped 803 accesses, all but two given to a probe's handler. The two let through are [[probe:pgbox]]'s read of 80000000h, which Windows took to KERNEL's box, and [[probe:pgw386]]'s store in the supervisor's 32-bit code, which Windows took to its Page Fault box.

Every access Windows faulted on stops in the audit, and no access WinBox makes for itself was outside the set. The records that differ, each with its cause:

| Records                                                                                                                         | Cause                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pgtouch`'s `layout` (7), `pgheap`'s `layout` (4), `pgfree`'s `where` (5) and its 1 MiB block's base                            | Where things lie: WinBox's addresses are its own (the owner's decision of 2026-11-10).                                                                                                                              |
| `pgtouch`: 0600h and 0601h, a read and a write past the first block, and three of its `scan`; `pgwrite`: a write past the block | The page past a 0501h block of one byte: in Windows another's, present and lockable (the 223 pages up to the second block, the 3001h block right after it); in WinBox the rest of the block's own 64 KiB, no one's. |
| `pgtouch`: GlobalAlloc + 10000h                                                                                                 | A small block of KERNEL's lies in the first megabyte, every page around it present; 64 KiB past WinBox's is the next descriptor index's, given to nothing.                                                          |
| `pgtouch`: 110000h                                                                                                              | Just past the first megabyte in Windows; in WinBox descriptor index 11h's segment, one of WinBox's own modules'.                                                                                                    |
| `pgtouch`: a read, 0600h and 0601h of FFFFF000h; `pgwrite`: a write there                                                       | WinBox's own local descriptor table's last page, present, where Windows has nothing. The probe's write lands in WinBox's table.                                                                                     |
| `pgfree`: page 7 after `GlobalFree` and after `GlobalCompact`                                                                   | Present in both since phase 3; Windows reads a byte not nought there, WinBox nought. Not followed.                                                                                                                  |
| `pgfree`: 0503h growing to 12 pages, and its pages after                                                                        | WIN386 grew the block in place, the pages after it free; WinBox moves a block that needs more pages.                                                                                                                |
| `pgbox`: AL after the first read, and the second read's end                                                                     | No handler of the program's: KERNEL's box for a page fault is phase 4's. The audit lets the read through.                                                                                                           |
| `pgbig`'s `time` (3)                                                                                                            | Not paging's: DOSBox's host's milliseconds. (`pgwrite`'s `rom` (2), the first megabyte's ROM, agree since 2026-11-13.)                                                                                              |

### What it costs

- **The processor.** Nothing of the set is on the access path: the check is the audit's, built only with its feature. `winbox-cpu` is unchanged. [[measured]] Its bench, three runs before and after on 2026-11-11 (load average 3 to 14, other work running), medians in instructions a millisecond, real and protected mode: register arithmetic 39,404 and 41,233 before, 40,280 and 39,606 after; loads and stores 38,044 and 36,224, then 35,023 and 36,744; pushes and pops 69,608 and 73,328, then 72,773 and 72,556; the mix 41,237 and 40,661, then 39,355 and 40,645. Each pair is within the bench's own spread of several percent.
- **The replay, the survey and the corpus.** The set is kept in every run, the audit's check built out. The Rust replay agrees as before, but where phase 2 meant it to move: [[probe:pglock]]'s locks and [[probe:pgbig]]'s 0500h in both modes now agree, and [[probe:pgtouch]]'s 0600h and 0601h past its first block are now refused. The probe survey ends with none behind, and the corpus's reports are unchanged.

## Phase 3: first touch

Built on 2026-11-11, following the owner's decisions of that day (below, "Phase 3"). Phase 2 could not see a page that was only read, or written with the bytes it held, and took a page's changed bytes for its being reached. WinBox now sees the first access to each page of a block, as WIN386's pager does when it gives the page a frame (`10b8`, `357c`).

### The bound

- **The pages.** `crates/winbox-machine/src/pages.rs` keeps a bit for each page of a live block with pages of its own (0501h's, KERNEL's of more than 256 KiB) not yet reached. In enhanced mode each starts set; in standard mode none is, and every page counts as reached. A freed block keeps present the pages reached but its first (`Pages::freed`, `_PageFree` as read out above).
- **The segment's reach.** The core's cache of a segment register (`Segment`, `crates/winbox-cpu/src/lib.rs`) keeps the limit and, beside it, a reach: one past the last offset the common path lets through, the limit's end or less where a page that must be asked of lies below it. The common path compares an access's end with the reach, as it compared it with the limit before: the same one compare. The cache stays sixteen bytes: the limit and the reach are 32-bit last and one-past offsets, the reach at most `FFFFFFFFh`, and a segment with no room (the null selector, one not present) is kept as one that expands down from `FFFFFFFFh`, as every access through a segment that expands down already went off the common path.
- **The cold path.** An access past the reach goes to `outside`, as an access past the limit did. Past the limit it is the fault it was. Inside it, the bus is asked (`Bus::reach`): its pages are taken as reached, and the access runs. A page's cost is one access off the common path.
- **Widening again.** The bus keeps a count moved by every page reached, given or freed (`Bus::epoch`). As each run starts (`Cpu::run`, every 500 instructions of WinBox's slices), where the count has moved the core works out every segment's reach again (`Bus::reached`). A page reached in a run is asked of until the run ends; a segment loaded works its reach out as it is loaded; segments a task switch puts back are worked out again at the next run (`segments_set`). The core's own default bus answers that every page is reached, so the hardware vectors and the bench run as before.
- **Segments over a block, and flat ones.** `Bus::reached` looks only at blocks with unreached pages, a word of 64 pages at a time, and wraps round 4 GiB as linear addresses do. A segment over a block's whole span is cut at the block's first unreached page and widened as the pages are reached in order. A Win386 program's flat segments, of 4 GiB from its image's block ([[topic:win386]]), are cut at the first unreached page above their base: below it every access is on the common path. A page reached past an unreached one is asked of on each access until the gap is reached too: one call and two bits looked at.

[[measured]] **What it costs**, 2026-11-11 on the development machine, against the commit before (`2c3a14a4`), built alike:

- **The core's bench** (`cargo run --release -p winbox-cpu --example bench`), the two run side by side five times, each workload's median: 5% to 30% faster in each of the eight, real and protected mode; `perf stat`, which load does not move, 248 and 249 host instructions an emulated instruction before, 247 and 246 after. The bench's bus is the core's own, all reached: what it measures is the common path, its compare of 32 bits where it was of 64.
- **The corpus and Win386.** The corpus's 38 programs (`target/release/examples/corpus`), the two builds one after the other, twice: 105.3 and 102.3 seconds before, 102.9 and 98.0 after, its screens alike in each. The replay's run of [[probe:w386eip]] in enhanced mode, best of three: 0.110 and 0.117 seconds before, 0.120 and 0.112 after; [[probe:pgbig]], whose 24 MiB block's 6,144 pages are each first reached through the cold path, 0.195 and 0.191 before, 0.184 and 0.176 after. Each within its own spread.

### The audit after first touch

[[measured]] 160 of the eight probes' 203 records agree with Windows', 157 before: [[probe:pgfree]] 24 of 34 (21 before), the rest as before. The pages read alone (7 and 11 after 0502h) and written with the bytes they held (page 5 after 0503h's shrink, pages 1 and 2 of the freed block of four) now agree. One case changed its cause: page 7 of KERNEL's 1 MiB block, read alone, is present after `GlobalFree` in both, but reads a byte not nought in Windows and nought in WinBox; why was not followed, the pages of a 0501h block read alone reading nought in both. The audit stopped 796 accesses, all but the two of phase 2 given to a probe's handler.

### The fault

Built on 2026-11-11 after the owner's decision of that day that enforcement treats memory WinBox's layout leaves unused as present (below, "Phase 3"), in 386 enhanced mode alone (`System::enforce_pages`, each slice).

- **Where WinBox faults:** a freed block's pages by the `_PageFree` rule (its first page, and each never reached), and addresses beyond anything given: `20000000h` up to the copy of the first megabyte at `FFE00000h`, and from its end to the tables. 80000000h and C0000000h fault; FFFFF000h, WinBox's own local table, does not.
- **The core.** `Pages::enforce` cuts each segment's reach at its first page not present as well as at its first unreached page; `Bus::reach` answers false for a page not present, and the core raises vector 14 with the address kept as CR2 and the error code 4 for a read, 6 for a write (`Cpu::cr2`, `Cpu::page_error`), the instruction undone and restartable.
- **A program's handler.** `dpmi_fault` gives vector 14 to the program's 0203h handler with that error code, as `dpmi_exception` gives any other.
- **KERNEL's boxes.** Without a handler the fault takes the general protection fault's path (`fault.rs`), named "a Page Fault" (seg1 `5fc0`, `07F0h`): the first box with Close and Ignore, Ignore stepping over the access, then "Application Error". [[measured]] [[probe:pgbox]] agrees whole in enhanced mode: Ignore, AL left 5Ah, the second read's first box, Close, and "PGBOXC caused a Page Fault in module PGBOXC.EXE at 0001:0028". A fault in 32-bit code in a selector of no module's, a Win386 supervisor's, gets no first box and the three lines [[probe:pgw386]] recorded; in WinBox [[probe:pgw386]]'s store lands below `20000000h`, in memory WinBox's layout leaves unused, so the box is not reached by it, and its records agree as before, the replay holding only those before Windows' box.
- **WinBox's own KERNEL and USER.** `System::read_far`, `write_far`, `read_string` and `copy_text` reach each byte of a program's pointer as Windows' code would (`System::host_reaches`): a page of a block is taken as reached, and a page not present is a page fault, its read nought and its write not made. The fault is raised as the call returns, at the call's place in WinBox's module (its stub's selector and offset, WinBox's own addresses), with no first box: there is no instruction of Windows' to step over. What each costs: one look at two bits a byte, enhanced mode or not. Not checked: the readers of a call's arguments, which read the program's own stack, and the host's direct reads and writes of `cpu.bus`, 179 in 42 files (`dpmi.rs` 43, `win87em.rs` 11, `keyboard.rs` 9, `kernel_calls/catch_throw.rs` 9, `menu_api.rs` 8, `kernel.rs` 8 and fewer elsewhere), which were not sorted into those that take a program's pointer and those of WinBox's own tables and stacks.

[[measured]] **What it costs**, against the commit before phase 3 (`2c3a14a4`), 2026-11-11: the corpus's 38 programs 98.2 and 96.8 seconds before, 97.5 and 93.7 after, its screens alike; [[probe:w386eip]] in enhanced mode, best of three, five times, 0.105 to 0.112 seconds before and 0.108 to 0.115 after; [[probe:pgbig]] 0.190 and 0.196 before, 0.186 and 0.176 after. Each within its own spread.

[[measured]] **The audit with the fault**, 2026-11-11: 163 of the eight probes' 203 records agree. [[probe:pgbox]] (8 of 8), [[probe:pglock]] (25 of 26), [[probe:pgw386]] (3 of 3), [[probe:pgheap]] 41 of 45 (its freed 1 MiB block page for page), [[probe:pgwrite]] 16 of 19, [[probe:pgbig]] 11 of 14, [[probe:pgtouch]] 37 of 54 and [[probe:pgfree]] 22 of 34. **No record has WinBox faulting where Windows does not.** The test checks each case it names as Windows' fault against Windows' record (`crates/winbox-audit/tests/paging.rs`, `Kind::Laxer`). Where Windows faults and WinBox does not:

- the pages past a block, memory WinBox's layout leaves unused: [[probe:pgtouch]]'s three `scan`s, [[probe:pglock]]'s page past its block, [[probe:pgfree]]'s page past its freed block, past the block 0503h cut, and past the block 0503h grew;
- 110000h, a module's segment of WinBox's; the probe's far pointer taken as a linear address, below `20000000h`;
- FFFFF000h, WinBox's own table: a read, a write, 0600h and 0601h.

Neither way a fault: where things lie (`layout`, `where`); 0600h and 0601h of the page past [[probe:pgtouch]]'s first block, refused in WinBox, the page committed to nothing, and answered in Windows, another's; page 7 of KERNEL's 1 MiB block read alone (nought in WinBox, another byte in Windows); 0503h's move; DOSBox's milliseconds. (ROM writes, named here on 2026-11-11, agree since 2026-11-13.)

## What changes in the plan

- **KERNEL's box for a page fault** is the general protection fault's path ([[probe:pgbox]]): the first box with Ignore, which steps over the instruction, then "Application Error" naming "a Page Fault", the module and segment:offset. `fault.rs` extends to it with the name, as design (a) supposed.
- **A fault in a Win386 supervisor's 32-bit code** ([[probe:pgw386]]) gets no first box and a text of its own ("module <unknown>186F:20A4", then "PGW386 will close."). Phase 4's box for [[probe:w386lib]]'s routine 2 is that one, not the first box's path. This page and [[topic:win386]] quoted it with an `at` it does not have.
- **`MOV` from a control register at ring 3 is not a fault a program sees in enhanced mode** ([[probe:pgcreg]]): WIN386 passes over it. In standard mode it is exception 0Dh. Since 2026-11-13 WinBox's core faults on it at privilege 3 and the host does as each mode does (below). Design (b)'s point holds, more strongly: a program reads nothing of CR2 or CR3.
- **Tiles of 64 KiB and a freed block.** A freed block of 1 MiB from KERNEL's heap faults in Windows, so the set of design (a) must drop a freed block's tiles, as 0502h's. But three of its pages still read in Windows: with the tiles dropped, a stale alias to such a block faults in WinBox where Windows, for those pages, does not. That is a place where tiles would fault where Windows does not, against the aim of the owner's second decision. Tiles cannot match a freed block; pages can (the owner's decisions of 2026-11-11, and phase 2's rule above).
- **Locks.** WIN386 refuses 0600h and 0601h of a range that reaches a page not present past a block ([[probe:pglock]]). At a tile's grain WinBox could not refuse them, the page past a 2000h block lying in its tile. Phase 2 refuses them at the page's grain.
- **Commitment.** A 0501h block is present whole however big ([[probe:pgbig]]): the set needs no notion of memory running out. 0500h's largest free block shrinks as blocks are given; phase 2 makes WinBox's shrink too.
- **ROM.** Writes to C0000h and F0000h are dropped without a fault, in both modes. That is a gap of the first megabyte, not of paging; since 2026-11-13 WinBox drops them (below).

## What WinBox does now

- [[read out]] **Memory is made as it is written** (`crates/winbox-machine/src/memory.rs`). The machine has 4 GiB of linear addresses in blocks of 1 MiB, each made the first time anything in it is written. A block never written reads as garbage of its address. The processor reaches it through `Bus`, whose `None` stops the run for the host (`Exit::Host`), and that is only for a stretch the host makes as it is read.
- **Linear addresses are WinBox's own** (`crates/winbox-machine/src/descriptors.rs`). The segment a descriptor index names is the 64 KiB from the index times 64 KiB. A block from the global heap, or 0501h's in either mode, is a run of those (`dpmi_allocate_block`, `crates/winbox-win16/src/dpmi.rs`). The first megabyte the selectors reach is at `FFE00000h`, the global table at `FFFEF000h` and the local table at `FFFF0000h`. [[probe:pgtouch]]'s layout differs in every address, in both modes, as a known gap.
- **No page tables, no CR3** (`crates/winbox-cpu/src/lib.rs`); vector 14 for a page not present in 386 enhanced mode (phase 3, above). A linear address is a segment's base plus the offset, once the offset is checked against the segment's reach (`linear_sized`, and `outside` off the common path for an offset past the reach or a segment that expands down, which checks the limit and asks the bus of the pages). The core keeps CR0's PE bit (`protected`) and the machine status word for `SMSW` (`msw`): 0001h in standard mode, 000Bh in enhanced mode, as [[probe:pgcreg]] read them. It raises vector 13 for a limit; the host raises the rest (`fault_vector.rs`).
- **`MOV` to or from a control, debug or test register** (`0F 20h`-`24h`, `26h`) is a general protection fault, error code nought, in protected mode at any privilege but 0, as the 80386 manual has it (`special_move`, `crates/winbox-cpu/src/lib.rs`, off the common path); in real mode or at privilege 0 it stops the run for the host as before. In standard mode the fault goes to the program's handler for 0Dh, or KERNEL's box. In enhanced mode the host does as WIN386's `75e8` does (above): for 20h to 23h it passes over the instruction, its prefixes, two opcode bytes and ModR/M byte, before any handler (`win386_passes_over`, `fault_vector.rs`); 24h and 26h go to the program's handler as in standard mode. [[probe:pgcreg]] agrees whole in both modes.
- **The first megabyte's ROM** keeps no write the processor makes (`set_rom`, `crates/winbox-machine/src/memory.rs`): the pages [[probe:pgrom]] measured, C0000h-C7FFFh and F0000h-FFFFFh but F1000h, FF000h and, in standard mode, FE000h (`rom_pages`, `crates/winbox-win16/src/task.rs`). It holds at linear nought, where a program's own selector based in the first megabyte reaches it, and at WinBox's copy at `FFE00000h`, where KERNEL's selectors for its fixed places do. The engine's own writes (`Memory::write8` and the rest) land in both. The check is off the common path: the processor's write reaches `Bus::write8` or `write16` of `Memory`, which asked before whether the address was the host's range; now it asks one comparison, whether the address lies in the stretch from `FFEC0000h` round to `100000h`, and only there looks at the host's range and the ROM's pages. [[measured]] At linear nought WinBox's layout has segments of its own: descriptor index 0Ch, SOUND's module database, from C0000h, and 0Fh, WIN87EM's data segment, F0000h-FFFFFh. The engine writes them; in the whole replay no write by the processor reached either ROM range but [[probe:pgwrite]]'s and [[probe:pgrom]]'s. WinBox's own data in the copy (the BIOS's data, DOSX's segment at `0A09h`) lies outside the ROM. [[probe:pgwrite]]'s `rom` and [[probe:pgrom]] agree in both modes.
- **The host's faults.** A fault the processor stops at goes to a program's DPMI exception handler for it, where there is one (`dpmi_fault`, `crates/winbox-win16/src/run.rs`), with error code nought for any vector but 12, 13 and 14. Otherwise a general protection fault or a page fault goes on to KERNEL's boxes (`crates/winbox-win16/src/fault.rs`); any other stops the run.
- **DPMI's paging functions are answered with no pager behind them**, as each host answers them: 0602h, 0603h, 0702h and 0703h with the carry clear, 0604h 1000h, and 0504h-0509h refused in enhanced mode as WIN386 refuses them ([[topic:dpmi-functions]]). In enhanced mode 0600h and 0601h are refused where the set has a page of WinBox's blocks not committed, and answered otherwise; 0500h's largest free block is less by the blocks given (above, "What answers by it").
- **The set of present pages** is kept beside the memory (phase 2, above). The core's segments are cut short of the pages of a block not yet reached, and an access to one goes off the common path, which marks it reached, or in 386 enhanced mode faults on a page not present (phase 3, above).

[[measured]] So in enhanced mode [[probe:pgbox]], [[probe:pgheap]]'s freed block and [[probe:pgfree]]'s locks agree since phase 3, and [[probe:pglock]]'s locks and [[probe:pgbig]]'s 0500h since phase 2. Known gaps: [[probe:pgtouch]]'s `touch`, `scan`, `dpmi` and `layout`, [[probe:pgwrite]]'s write of FFFFF000h, [[probe:pglock]]'s page past its block, and [[probe:pgfree]]'s pages past its blocks and its 0503h. [[probe:pgcreg]], and [[probe:pgwrite]]'s ROM writes, agree since 2026-11-13. [[probe:pgw386]] agrees, the replay holding only the records Windows wrote before its box; in WinBox the routine's store lands and the program goes on. In standard mode nothing faults, as before.

## Designs

What follows is enhanced mode's alone (below, "Standard mode").

### (a) A set of present pages, checked off the fast path

The DPMI host keeps which linear pages are present: the first megabyte and its high memory area, each block's pages from the global heap, 0501h and the modules' segments, and what WinBox keeps for itself (the descriptor tables, the first megabyte's copy at `FFE00000h`, the host's stack and code). The core asks the set only where it already leaves the fast path.

- **No check on each access.** Each segment register's cache already compares every offset with one bound, `past_limit`, and goes to `outside` when it is passed. A second bound can be kept beside it: one past the last offset whose page, counted from the base, is present without a gap (`past_present`). That bound is the smaller of the limit and the first page that is not present, worked out as the segment is loaded and again whenever the set changes. An access below it is as fast as now. One past it goes to `outside`, which asks the set and faults with vector 14 or goes on. This is so for a 32-bit flat segment too. A Win386 program's flat segments have their base at its image's block, so its code, stack and image lie below the bound. Only an access past the first gap (its later blocks, or a `DLL_PTR` added in) takes the slower path, and pays a lookup.
- **The fault** carries an error code (bits 0-2 as the 80386 sets them) and the linear address. The host gives vector 14 to a program's 0203h handler with that code, else KERNEL's boxes with "a Page Fault" (seg1 `5fc0`). `fault.rs` extends to it.
- **The grain.** Pages of 4 KiB, as WIN386's are (the owner's decision of 2026-11-11), or WinBox's tiles of 64 KiB: a descriptor index whose segment is given is present whole. Pages are stricter than Windows wherever WIN386 happened to put something next to a block ([[probe:pgtouch]]'s page past the first block reads, because something else is there). Tiles are laxer: a read just past a block's pages but inside its tile does not fault. Both fault for [[probe:w386lib]]'s `DLL_PTR`: its 16:16 pointer taken as an offset lands far past anything given.
- **What it makes WinBox match.** [[probe:w386lib]]'s routine 2 and its box. [[probe:pgtouch]]'s `touch` records, and its `scan` records where the layout lets them. A program that probes memory by catching exception 0Eh.
- **Speed.** [[measured]] A prototype, not committed: `Bus` wrappers around WinBox's `Memory`, run by `winbox-cpu`'s bench workloads in protected mode, 2026-11-10 on the development machine with other work running (load average about 14), five runs of 2 seconds each, medians. A present-page bitmap asked on every access, the instruction fetches included, cost 13% on register arithmetic, 11% on loads and stores, 33% on pushes and pops and 17% on compiled code's mix. Asked only past `past_present`, the common path is the one there now: the same compare, so nothing to measure until a program crosses the bound.
- **What it touches.** `winbox-machine` (the set, beside `Memory`); `winbox-cpu` (`Segment` gains the bound, `descriptor` works it out through a `Bus` question whose default answers "everything", so the hardware vectors and `VecBus` are unchanged, `outside` raises vector 14, and the core keeps the error code and address for the host); `winbox-win16` (0501h-0503h, `GlobalAlloc` and its kin, module loading and freeing keep the set; `dpmi_fault` passes the error code; `fault.rs` names the fault).

Phases, each a branch of its own measured against recordings:

1. **The probes** above, recorded in both modes. Done (above, "What phase 1's probes measured").
2. **The set, kept but not enforced.** In enhanced mode only, with a check in the replay and the corpus that no access of WinBox's own or a program's lands outside it where Windows' did not fault. This finds what WinBox keeps in linear memory that the set left out. Done (above, "Phase 2: the set of present pages").
3. **The bound and the fault.** `past_present` in the core, vector 14 with its code, a program's handler; the hardware vectors and the bench before and after.
4. **KERNEL's box** for a page fault, then [[probe:w386lib]]'s routine 2 called again, and its `pgw386` record.

### (b) Page tables and CR3

The machine gets page tables, CR3 and a translation for every access, as the 80386 does.

- **What a program could see of them.** Nothing measured or read shows a Windows program reading CR3 or a page table. At ring 3, `MOV` from a control register is a general protection fault ([[documented]], above). DPMI 0.9 has no function that answers a page's frame or entry, and WIN386 refuses 1.0's 0506h. What tables would add over (a) is aliasing, two linear pages on one frame, as 0800h's mappings of physical memory make. A program sees that only as the same bytes at two addresses, which WinBox can give without tables.
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

## The owner's decisions (2026-11-10)

1. **When.** Phase 1's probes now; the fault stays a named gap until a program needs it.
2. **The grain.** Tiles of 64 KiB, so that WinBox never faults where Windows would not.
3. **The layout.** WinBox keeps its own addresses (index times 64 KiB); [[probe:pgtouch]]'s `layout` is a known gap.
4. **WinBox's own code.** When it is built, WinBox's KERNEL and USER raise the fault where Windows' own code would touch a page that is not present, naming the module as Windows would.

## The owner's decisions (2026-11-11)

These revise decision 2 of 2026-11-10.

1. **The grain is pages of 4 KiB**, not tiles of 64 KiB: [[probe:pgheap]] showed tiles cannot match a freed block.
2. **WinBox keeps its own layout** (decision 3 of 2026-11-10 stands). The set maps onto WinBox's addresses.
3. **Phase 3** (the fault in the core, KERNEL's boxes) follows only when phase 2's audit is clean.

## The owner's decisions (2026-11-11, phase 3)

1. **Phase 3 is first-touch tracking, then enforcement.**
2. **Enforce only when the audit has no case where WinBox would fault and Windows would not.** Cases where WinBox does not fault but Windows does, from the layout, may stay named.
3. **WinBox's own KERNEL and USER code fault where Windows' code would** (decision 4 of 2026-11-10).
4. **Enforcement treats memory that WinBox's layout leaves unused as present**: the rest of a block's 64 KiB past its pages, and descriptor slots given to nothing. So WinBox faults only where Windows certainly does: a freed block's pages by the `_PageFree` rule, and addresses beyond anything given (80000000h and up where no block lies, C0000000h, FFFFF000h if it is not WinBox's own table, and the like). Cases where Windows faults and WinBox does not become named gaps, in the permitted direction.

## Not yet done

- The host's direct reads and writes of a program's memory through `cpu.bus` (179), and the readers of a call's arguments, are not checked against the pages (above, "The fault"). Where in KERNEL's and USER's own segments Windows' code faults, for the box's segment and offset, was not read out: WinBox names its stub's.
- [[probe:pgw386]]'s store does not fault in WinBox: the Win386 supervisor's box is built as recorded but no probe reaches it in WinBox.
- Page 7 of KERNEL's 1 MiB block, read alone, reading a byte not nought in Windows ([[probe:pgfree]]).
- A block of KERNEL's that `GlobalReAlloc` moves: WinBox gives the new block's pages unreached and copies the bytes as the host, which reaches nothing; what KERNEL and WIN386 do (0503h, or a copy by KERNEL's code) was not read out. Nor whether `GMEM_ZEROINIT` reaches every page of a block with pages of its own.
- Why KERNEL offers no first box, and words its text as it does, for a fault in a Win386 supervisor's 32-bit code ([[probe:pgw386]]); what the range at `bd94` that `_LinPageLock` answers for holds, 80000000h among it ([[probe:pglock]]).
- Where KERNEL puts a block of 257 to 383 KiB, and the first megabyte's free room as the true bound; and whether KERNEL's blocks with pages of their own make 0500h's largest free block less.
- Which path from `GlobalFree` reaches KERNEL's 0502h (`351a`).
- `MOV` to or from a test register (24h, 26h) and `CLTS` at privilege 3, which no probe ran: WinBox gives the first to the program's handler in both modes, as `75e8` does in enhanced mode, and runs `CLTS` as nothing, where the 80386 would fault in standard mode.
- Which ROM pages hold code DOSBox's dynamic core has run is DOSBox's state at the time ([[probe:pgrom]]): WinBox keeps the pages measured, not the cause.
- A stack's guard page, which no probe looked for.
- What "could not be read in reasonable time", above: WIN386's service names, `_PageAllocate`'s placing, the pager's path, the fault chain's members, and whether ring 3 can reach a page table.
- `KRNL386.EXE`'s "Segment Load Failure" (`0826h`), pushed at seg1 `5fcf`-`5fd9` by code none of the 0203h calls names, and "a Divide by Zero" (`07BAh`), which none of the handlers KERNEL puts in names.
