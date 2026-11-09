---
kind: topic
name: DPMI's functions
summary: What a Windows program gets from INT 31h in each mode — standard mode's DOSX.EXE, read out function by function from its table, with its refusals, its no-ops and the faults that end Windows; 386 enhanced mode's WIN386, as the probes recorded it — and how WinBox answers each.
probes: [enhmode, dpmildt, dpmimem, dpmirm, dpmiexc, dpmigro, dpmigrw, dpminul, dpmiout]
---

A Windows program runs on a DPMI host, and can call it itself through INT 31h: the descriptor table, memory, interrupt vectors, exception handlers, calls into real mode and watchpoints. Standard mode's host is `DOSX.EXE`; 386 enhanced mode's is WIN386's virtual machine manager ([[guide:enhanced-mode]]). Few programs call it: KERNEL, which is WinBox, makes most of the calls a program needs. SimTower's 000Bh and 000Ch are the corpus's ([[topic:global-and-local-memory]], "Descriptors through DPMI"), and WATCOM's Win386 supervisor asks 0400h.

Every probe below was recorded in both modes (`record.mjs --mode enhanced`), and every function is answered by the machine's mode (`crates/winbox-win16/src/dpmi.rs`).

## DOSX's table

[[read out]] `DOSX.EXE`'s image starts 200h into the file. Its protected-mode segment lies at image 38C2h, and the offsets here are in it. INT 31h comes to the dispatcher at 2B56h, which walks a table at 2A80h (image 6342h) of function numbers and handlers, FFFFh at its end, and runs the handler with the caller's registers in a frame (189Fh-18FEh: AX at `[bp+12h]`, BX `[bp+0Ch]`, CX `[bp+10h]`, DX `[bp+0Eh]`, the flags `[bp+14h]`, ES `[bp+16h]`, DS `[bp+18h]`, the registers as they came again from `[bp+1Ah]`). A handler ends in one of three ways: 2B92h clears the carry; 2B8Ch sets it and leaves AX as it was; 2B87h sets it and makes AX nought. The way back (18FFh-194Ch) takes the frame's flags but keeps the caller's own interrupt and trap flags where they were set.

| Functions                                      | Handler                       | What DOSX does                                 |
| ---------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| 0000h-0003h, 0006h-000Dh                       | 2BA9h-2CE4h                   | answered (below)                               |
| 0004h, 0005h, 0600h-0603h, 0702h, 0703h, 0800h | 2B9Bh                         | carry clear, nothing done                      |
| 0604h                                          | 2B9Dh                         | BX nought, CX 1000h                            |
| 0100h-0102h                                    | 2CE7h, 2D26h, 2D34h           | answered (below)                               |
| 0200h-0205h                                    | 2D41h, 2D75h, 2D98h           | answered                                       |
| 0300h-0304h                                    | 2DB3h, 2E00h, 2E40h           | answered                                       |
| 0305h, 0306h, 0700h, 0701h, 0A00h              | 2B87h                         | refused, AX nought                             |
| 0400h                                          | 2FC1h                         | AX 005Ah, BX 000Ah, CL the processor, DX 0870h |
| 0500h-0503h                                    | 2F0Eh, 2F55h, 2F74h, 2F82h    | answered; 0503h faults (below)                 |
| 0900h-0902h                                    | 2FA1h                         | AL the interrupt flag                          |
| 0B00h-0B03h                                    | 3043h                         | the debug registers                            |
| anything else                                  | 0012h, from the word at 2B89h | DOSX's start-up code (below)                   |

[[read out]] A function not in the table leaves BX at 2B87h, and the dispatcher takes the handler from the word after, 2B89h: the second and third bytes of the refusing handler's first instruction, 0012h. That is DOSX's own start-up code, at the segment's start. [[measured]] [[probe:dpmiout]]: under DOSBox, 000Eh stops the emulator itself ("IRET:Illegal descriptor type 0"), and nothing of Windows runs again. WinBox ends the session there, as below.

## Windows ends

[[read out]] 0503h, resizing a block, never comes back. Its handler (2F82h) asks 25E1h, which finds the block (2927h) and asks 26C3h whether it can grow in place. 26C3h pushes ES, CX, DX and AX, and on every way out pops only three of them, so that CX, the new size's low word, lands in ES (2710h-2713h where the block cannot grow, 2723h-2725h where it can or shrinks). Unless that word is a selector, loading it faults inside DOSX; if it is one, `RET` takes a word of DOSX's stack for its address.

[[measured]] [[probe:dpmigro]] grows a block whose next is taken, and [[probe:dpmigrw]] one that is alone: each time the screen goes back to DOS with "Standard Mode: Fault in MS-DOS Extender.", `EC=2000` (the size's low word) and DOSX's CS:IP, `0053:2713` and `0053:2725`. Windows has ended. In [[probe:dpmigro]] a second program wrote a record every 200 ms until the call, and none after. [[probe:enhmode]]'s standard-mode recording ends at the same call. 0502h and 0101h given nought end Windows the same way, at 2734h (`EC=0A08`, [[probe:dpminul]]). In enhanced mode, WIN386 answers all of these.

WinBox ends the session where DOSX does: no task runs again (the Rust engine's run stops as ended), and the reason is kept (`Host::fault`). That is what a program can see: nothing more of Windows runs. A 0503h of an unknown handle is refused, AX as it was, before any of that.

## Descriptors: 0000h-000Dh

| Function                   | DOSX (standard mode), [[read out]]                                                                                                                                                                                    | WIN386 (enhanced mode), [[measured]]                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000h                      | the head of the list of free descriptors for one (1FDFh), a run for more (2002h); each data at nought with no limit, not yet accessed (`00 00 00 00 00 F2 00 00`); AX the first, its low bits 7                       | the same                                                                                                                                    |
| 0001h                      | a local selector given; its access byte and byte 6 emptied (208Dh); one DOSX keeps for 0002h and 000Dh, below 2A0h, refused after that; else back on the list's head; the caller's DS or ES nought where they held it | frees one freed already                                                                                                                     |
| 0002h                      | DOSX's own descriptor for the segment, if it has one (base, limit FFFFh, `F2h` or `F3h`; 20E7h); else one made so                                                                                                     | the same                                                                                                                                    |
| 0003h                      | 8                                                                                                                                                                                                                     | 8                                                                                                                                           |
| 0006h, 0007h, 0008h, 0009h | no selector checked; 0008h past FFFFFh in pages with the granularity bit; 0009h byte 5 CL and byte 6's top CH's                                                                                                       | its own selectors alone; 0008h refuses a limit past FFFFFh not ending in FFFh; 0009h a system descriptor or one of another privilege than 3 |
| 000Ah                      | the source passing `VERR` (2C73h); a copy made data, writable, its presence and privilege kept                                                                                                                        | an execute-only source too                                                                                                                  |
| 000Bh, 000Ch               | any selector whose index is below its table's end, FFEFh; selector nought and a global one read the local table's entry                                                                                               | its own selectors alone, within 186Fh; 000Ch refuses what 0009h refuses                                                                     |
| 000Dh                      | one of the first sixteen, free; marked with an access byte of 0Fh, its other bytes kept                                                                                                                               | the same sixteen; made data at nought                                                                                                       |

- [[measured]] [[probe:dpmildt]] makes and undoes each on descriptors of its own and records their bytes. The freed descriptor is given again by the next 0000h, in both modes. 0002h of 0040h answers KERNEL's `__0040H`, in both. A refusal leaves AX as it was, in both, except where the table says nought.
- **In WinBox** the descriptors are WinBox's own, from the list KERNEL's are given from (`GlobalAllocator`'s `take` and `give`, `Descriptors` in the Rust engine), the freed one first, as KERNEL's `AllocSelector` takes from the head of its list ([[topic:global-and-local-memory]], "Selectors given back"). WIN386's table is held to 186Fh, but for WinBox's selectors for the first megabyte, which lie at the top of WinBox's table and within Windows' first 30Eh ([[probe:kconst]]).

## Memory: 0100h-0102h, 0500h-0503h, 0600h-0800h

- [[measured]] 0100h is refused in both modes, AX 8 and BX nought: KERNEL holds conventional memory. 0102h is refused: DOSX with AX 8 and BX nought (2D34h); WIN386 with AX 7. 0101h of a selector that is no DOS block is refused, AX as it was ([[probe:dpmimem]]).
- [[read out]] 0500h: DOSX writes FFFFFFFFh to the 30h bytes, then the largest free block, the free pages twice and nought for the paging file (2F0Eh-2F52h). [[measured]] On DOSBox's 16 MB: `E347E0h` and E34h pages; WIN386's twelve fields with its paging file ([[guide:enhanced-mode]]). WinBox answers those figures as [[probe:enhmode]] found them.
- [[read out]] 0501h: DOSX's block lies after a header of 10h bytes in its arena, and a descriptor for it -- the size less one for its limit, FFFFh past 64 KiB or for nought bytes, data not yet accessed -- is its handle, in both SI and DI (2F55h, 24F5h). [[measured]] WIN386's block is on a page, has no descriptor, and nought bytes are refused ([[probe:dpmimem]]). In WinBox a block is a run of descriptors' 64 KiB; where DOSX's arena puts it is not followed, so its base's low bits differ.
- [[measured]] WIN386's 0503h keeps a block that needs no more pages and moves one that does ([[probe:dpmigrw]]).
- [[measured]] 0600h-0603h, 0702h and 0703h do nothing in both modes; 0604h answers 1000h. 0700h and 0701h are refused: DOSX with AX nought, WIN386 with AX as it was. 0800h gives an address back as it came in standard mode; WIN386 refuses one under a megabyte and maps one above it elsewhere ([[probe:dpmimem]]). [[inferred]] WinBox's memory is not paged, and answers the paging functions as the hosts do, with nothing behind them.

## Interrupts and exceptions: 0200h-0205h

- [[read out]] 0200h and 0201h read and write the real-mode vector, CX:DX. DOSX takes 50h-57h as 08h-0Fh, where it moved the interrupt controller (2D41h-2D4Eh). [[measured]] WIN386 does not ([[probe:dpmirm]]).
- [[read out]] DOSX keeps exception handlers for 0-10h (2D75h, 1E8Ch, 1EA1h) and refuses others; [[measured]] WIN386 for 0-1Fh. 0204h and 0205h take any vector (2D98h).
- [[measured]] [[probe:dpmiexc]] puts in a handler for exception 0 and divides by nought, and one for 0Dh and loads ES with FFF7h. In both modes the handler is called on another stack than the program's, under a far return to the host, with the error code (nought, and `FFF4h`), the CS:IP of the instruction that faulted, its flags, SS and SP; it moves IP on and returns, and the program goes on. The return address's privilege is 0 in standard mode -- DOSX gives `E0h:140Ch` (13FDh-1404h) -- and 3 in enhanced mode. A handler for INT 61h set with 0205h is called by `INT 61h`, and one for INT 21h that goes on to the one 0204h gave sees DOS's answer.
- **In WinBox** the host's own handlers -- what 0202h and 0204h answer before a program sets one -- are stubs in the host's code segment, selector E0h of the global table, in the first megabyte at DOSX's segment. A program's handler is called by the processor's fault or `INT` before WinBox's own; a vector's stub runs WinBox's answer, so a handler that goes on to it is answered as the program would have been. A program's exception handler going on to the host's is taken as WinBox takes the fault with none.

## Calls into real mode: 0300h-0304h

- [[read out]] 0300h-0302h copy the structure at ES:DI and CX words of the caller's stack (2DB3h-2DDDh), run real mode from them, write the structure back, and give the caller the real-mode flags with the carry clear (2DE6h-2DFDh). 0303h takes one of sixteen callbacks at 0E70h in DOSX's segment, three bytes apart (2E00h-2E3Dh), and 0304h frees one by its address, given or not (2E40h-2E66h). A callback called from real mode puts the real-mode registers into its structure, gives the procedure DS:SI for the real-mode stack and ES:DI for the structure, and calls it to return with `IRET` (2E6Ch-2EE2h).
- [[measured]] [[probe:dpmirm]]: DOS's version, the current drive and folder, `WIN.INI` opened, read and closed into DOS memory from `GlobalDosAlloc`, a missing file's error 2, and INT 12h, each through 0300h, in both modes. 0303h gives `0A09h:0E73h` first in standard mode -- 0E70h is taken -- and fifteen in all; WIN386 gives `FF06h:0AB7h` and on down by 10h, forty and more. The probe calls its own callback with 0301h, 0302h and through a real-mode vector set to it with 0300h: the procedure finds the caller's registers in its structure, interrupts off and a real-mode stack, and what it sets comes back to the caller.
- **In WinBox**, which runs no real-mode code: a call reaches a callback of the program's, by its address or by an interrupt whose vector is one; or an interrupt WinBox's own DOS or BIOS answers (21h, 12h, 1Ah, 2Fh), its vector as WinBox keeps it, answered as from real mode -- the segments as paragraphs in the first megabyte, DOS alone without KERNEL in front of it. Any other call stops the run as unsupported: real-mode code of a program's, which WinBox would need to run in the processor's real mode.

## The rest

- [[read out]] 0900h-0902h answer AL the caller's interrupt flag; DOSX sets the flag asked for in the frame (2FA1h-2FBEh), but its way back keeps the caller's own where it was set. [[measured]] In both modes, the flag stays on after 0900h ([[probe:dpmimem]]).
- [[read out]] 0B00h-0B03h keep four watchpoints in the debug registers (3043h-3290h): 0B00h takes the address in BX:CX, DL 1, 2 or 4 bytes and DH 0 to execute (one byte), 1 to write or 2 for either, and answers the first free one's number; 0B01h frees one, 0B02h tells whether it was reached, 0B03h forgets it was. DOSX's 0B02h tests the status bit the wrong way (31E9h-31F5h) and answers 1 for a watchpoint never reached. [[measured]] WIN386 answers nought; a fifth is refused in both ([[probe:dpmimem]]). WinBox's processor has no debug registers, and no watchpoint of its is ever reached.
- [[measured]] WIN386 answers 0305h with a state of 24h bytes and 0306h, refuses DPMI 1.0's 000Eh, 0210h, 0401h and 0504h with AX as it was, and answers 0E00h and 0E01h ([[probe:enhmode]], [[probe:dpmiout]]). WinBox gives 0305h's and 0306h's routines in its own code: the first does nothing, as there is no real-mode state to save; the second stops the run.

## Not yet done

- Real-mode code of a program's: 0300h-0302h into anything but a callback or an interrupt WinBox answers. The processors run real mode, but WinBox keeps nothing of DOS's or the BIOS's real-mode code in the first megabyte for a program's to call.
- WinBox's processor runs a task with its interrupt flag clear, where Windows runs it set: 0902h answers nought, and an exception handler's frame has the flag clear ([[probe:dpmimem]], [[probe:dpmiexc]]).
- WinBox's DOS says it is version 6.00 (INT 21h 30h, both engines); DOSBox's, beneath Windows, is 5.00 through 0300h and through KERNEL alike ([[probe:dpmirm]], [[probe:dpmiexc]]).
- 000Dh's sixteen descriptors are not kept free: WinBox gives the table's first descriptors to blocks, and 000Dh of one in use is refused ([[probe:dpmildt]], [[probe:enhmode]]).
- Where DOSX's arena and WIN386's put a block (0501h's base and handle), what WIN386's 0800h maps an address to, and the real-mode vectors' values, which are DOS's and the BIOS's.
- WIN386's table growing as KERNEL asks for more, and its callbacks' limit.
- Interrupts and exceptions as the hosts dispatch them in detail: whether a handler runs with interrupts off, an `INT` in protected mode reflected to real mode where no handler is set, and the hosts' own handlers for exceptions a program passes on (all but a general protection fault stop the run).
- 0000h of nought descriptors, which DOSX takes as one and then writes on through its whole table (2BD4h).
