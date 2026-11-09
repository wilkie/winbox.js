---
kind: topic
name: KERNEL's constants
summary: The exports of KERNEL that are numbers rather than functions — __AHSHIFT, __AHINCR, __WINFLAGS and the selectors for the first megabyte's fixed places — what they are, how the loader writes them and how GetProcAddress answers them, as the kconst probe recorded them.
probes: [kconst, winflags]
---

Thirteen of KERNEL's exports are not functions. Each is an entry of segment FEh in `KRNL386.EXE`'s entry table, its offset the number: a program imports one as it imports a function, and the loader writes the number where the program reads it.

## The numbers

| Ordinal | Name         | In the file | What a program gets                          |
| ------- | ------------ | ----------- | -------------------------------------------- |
| 113     | `__AHSHIFT`  | 3           | 3: a huge pointer's selector steps by 1 << 3 |
| 114     | `__AHINCR`   | 8           | 8, the step itself                           |
| 178     | `__WINFLAGS` | 1           | what [[fn:KERNEL.GetWinFlags]] answers       |
| 183     | `__0000H`    | 0000h       | a selector for the first 64 KiB              |
| 193     | `__0040H`    | 0040h       | a selector for the BIOS's data, at 400h      |
| 174     | `__A000H`    | A000h       | a selector for A0000h                        |
| 181     | `__B000H`    | B000h       | a selector for B0000h                        |
| 182     | `__B800H`    | B800h       | a selector for B8000h                        |
| 195     | `__C000H`    | C000h       | a selector for C0000h                        |
| 179     | `__D000H`    | D000h       | a selector for D0000h                        |
| 190     | `__E000H`    | E000h       | a selector for E0000h                        |
| 194     | `__F000H`    | F000h       | a selector for F0000h                        |
| 173     | `__ROMBIOS`  | F000h       | the same selector as `__F000H`               |

[[read out]] The file holds the real-mode paragraph for each selector and 1 for `__WINFLAGS`; KERNEL puts the protected-mode values in as it starts.

[[measured]] [[probe:kconst]]: `__AHSHIFT` 3, `__AHINCR` 8, `__WINFLAGS` 419h. Each selector is in the local table at privilege 3, a data segment of 64 KiB (limit FFFFh) that is writable and not yet accessed (`LAR` F200h), its base its paragraph times 16 from `__0000H`'s, which is nought. `__ROMBIOS` is the same selector as `__F000H`. From the lowest number up they are `__E000H`, `__D000H`, `__C000H`, `__B800H`, `__B000H`, `__A000H`, `__F000H`, `__0040H` and `__0000H`, each 8 above the one before. The first recording kept the numbers themselves, 227h up to 267h. Which selectors these are depends on the allocator, so the probe now records only how they relate to each other.

## How a program gets them

- [[read out]] KERNEL answers any entry as DX:AX, and for segment FEh that is FFFFh:the number (`KRNL386.EXE` seg1 `502c`-`502f`). [[measured]] [[probe:kconst]]: so [[fn:KERNEL.GetProcAddress]] answers FFFF0003h for `__AHSHIFT`.
- [[read out]] The loader writes that same FFFFh:number down an import's chain (seg1 `748d`-`74ef`): the number at an offset fixup, FFFFh at a selector fixup, both at a far pointer, and the number's low byte added at a byte fixup. A byte fixup is always added where it is, never a chain (seg1 `74b9`). TOOLHELP adds `__AHINCR` to a byte this way.

## Inside winbox.js

The first megabyte is not at linear nought in winbox.js. A program's segments take one 64 KiB of linear memory per descriptor index from index 1, so A0000h is index 0Ah's segment. The memory these selectors reach is a megabyte of its own at FFE00000h, just below the global table. Selector 40h, DOS's extender's selector for the BIOS's data, reaches 400h of the same megabyte, as `__0040H` does. Nothing is written there. A program reads the machine's memory through them, as it does on Windows: no ROM BIOS and no video memory, since winbox.js draws the screen itself.

The selectors are the nine indices of the local table below the interrupt descriptor table's, 0FFDh, in Windows' order: 7FA7h for `__E000H` up to 7FE7h for `__0000H`. No block reaches them. The table's last indices stay empty: Windows' local table is smaller, and probes count on 0FFF7h faulting ([[probe:fault]], [[probe:badptr]]). `GetSelectorBase` answers where they really are, FFE00000h and up. Only the distances between them are Windows'.

The table entries are `ExportedConstant`s, and the Rust engine's `kernel_constant` (`crates/winbox-win16/src/linker.rs`) holds the same values. The knowledge base counts a constant as implemented when its table entry gives the number, and shows it as a constant, not a function with argument bytes.

## `__GP`

KERNEL's ordinal 342, `__GP`, is not a constant. It is a table in KERNEL's own code segment (`KRNL386.EXE` seg1 `a820`) that lists the parts of KERNEL's code that handle a general protection fault, and `HasGPHandler` reads it. A module can export a `__GP` of its own for the same purpose. winbox.js has no KERNEL code for it to describe, so the entry is named and left. See [[fn:KERNEL.__GP]].

## Not yet done

- What the first megabyte holds: the BIOS's data area, the ROM BIOS's machine and date bytes at F000:FFF5h-FFFEh, and video memory. All of it reads as never-written memory.
- `__GP` and `HasGPHandler`.
