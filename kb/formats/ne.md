---
kind: format
name: NE executables and libraries
summary: The New Executable format of Windows 3.1's programs, libraries and drivers — the parts winbox.js reads, and what reading the system's own files showed.
---

Every Windows 3.1 program, library, driver and font resource is an NE file: an MS-DOS stub followed by a header at the offset `e_lfanew` gives (`0x3c`). The format is documented; this page records what winbox.js and the knowledge base rely on, and what the system's files turned out to hold.

## The header fields read here

| Offset from the NE header | Field                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| `0x04`                    | the entry table, relative to the header, and at `0x06` its length |
| `0x0c`                    | flags; `0x8000` marks a library, `0x0800` a self-loading program  |
| `0x1c`                    | the number of segments, and at `0x22` the segment table           |
| `0x20`                    | the length of the non-resident name table                         |
| `0x24`                    | the resource table                                                |
| `0x26`                    | the resident name table                                           |
| `0x28`, `0x2a`            | the module reference and imported name tables                     |
| `0x2c`                    | the non-resident name table, as an offset into the **file**       |
| `0x32`                    | the alignment shift segments and resources are counted in         |
| `0x3e`                    | the Windows version expected                                      |

## Self-loading programs

[[read out]] A program whose flags have `0x0800` loads its own segments: KERNEL loads segment 1 alone (`KRNL386.EXE` seg2 `188c`, `1ea6`), which must start with the loader's table -- `A0` (`3041h`), then far pointers to the program's boot procedure (at 4) and segment loader (at 8), places KERNEL fills with its own services (0Ch, 10h, 14h, 24h), and the program's exit procedure (18h), which Windows 3.1 never calls. Segment 1 can refer to no other segment: its relocations are applied before the loader has loaded anything. The table, the services and when KERNEL calls the loader are [[topic:self-loading]]. [[measured]] [[probe:selfld]] is such a program, its table laid out by Watcom at its code segment's start and the flag set by `build-probes.mjs`.

## In memory

[[read out]] KERNEL does not keep the file's header as it is: it lays out a module's database from it (seg2 `0d66`), the segment table at 40h with ten bytes an entry (the file's eight and the segment's handle), the entry table made bundles, the module references made handles, and the file's path at the end. [[measured]] [[probe:moddb]] reads its own. The layout is in [[topic:self-loading]], "The module's database".

## Exports: entries and names

- [[documented]] An export exists when the **entry table** has an entry for its ordinal. Its name, if it has one, is in the resident or the non-resident **name table**: a length byte, the name, and a word of ordinal. The first entry of each table is not an export: the resident one is the module's name, the non-resident one its description, both at ordinal nought.
- [[measured]] In Windows 3.1's own libraries the two do not always agree. COMMDLG exports 48 ordinals and names 26; across the sixteen libraries the knowledge base surveys, 156 exports have no name at all and can only be imported by number.
- [[measured]] A program imports a system function by ordinal, so an ordinal is not a detail an implementation may choose: winbox.js builds one thunk per ordinal, and a table entry at the wrong ordinal is a call that reaches the wrong function. Each module's page lists every place winbox.js's tables disagree with the binaries.
- [[measured]] `KRNL286.EXE` and `KRNL386.EXE` export exactly the same ordinals.

## Relocations

[[documented]] A segment's relocations name each place to patch once; the other places for the same target are chained through the patched words themselves, from the one the record names to a word of `0xffff`.

## Iterated segments

[[measured]] A segment whose flags have bit 3 set is stored as iterated records. Each record is a word of repeats, a word of length, and that many bytes. The segment is the records spelled out until its length in the file is used up. Championship Slots of the corpus stores its data segment this way: 1060h bytes in the file make 10FEh. Copied as it lies, the segment's far pointers land in the middle of its strings, and the program faults calling through one.

## Resources

[[documented]] The resource table starts with the alignment shift, then a run of types, each with its count and its entries — offset and length in units of that shift, flags, and an id, which is a number with the top bit set or an offset to a length-prefixed name. The [[format:fot]] is two resources and nothing else.

### The name table

[[read out]] An old-style name table is resource 1 of type 15 (`RT_NAMETABLE`), which KERNEL finds by number (`KRNL386.EXE` seg3 `09ab`-`09e7`); a table of another number is not read ([[probe:nametab]]). Each entry is a word of its length, a word of a type, a word of a resource's id, then the type's name ended by a nought and the resource's name ended by one, either empty -- nothing between the words and the names. The length steps to the next entry, so bytes past the names are skipped; a length of nought ends the table. A word with its high bit set is the number its name stands for; one without is not taken (seg3 `0a8a`-`0a9e`). `DOGZDLL.DLL`'s two entries are twelve bytes each: type FF01h, ids 2720h and 2810h (no high bit), `PALT` and an empty name. Modern resource compilers write no such table; `build-probes.mjs` lays one out from named constants (`NAME_TABLES`). How [[fn:KERNEL.FindResource]] uses it is on its page.
