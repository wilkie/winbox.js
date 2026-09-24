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
| `0x0c`                    | flags; `0x8000` marks a library                                   |
| `0x1c`                    | the number of segments, and at `0x22` the segment table           |
| `0x20`                    | the length of the non-resident name table                         |
| `0x24`                    | the resource table                                                |
| `0x26`                    | the resident name table                                           |
| `0x28`, `0x2a`            | the module reference and imported name tables                     |
| `0x2c`                    | the non-resident name table, as an offset into the **file**       |
| `0x32`                    | the alignment shift segments and resources are counted in         |
| `0x3e`                    | the Windows version expected                                      |

## Exports: entries and names

- [[documented]] An export exists when the **entry table** has an entry for its ordinal. Its name, if it has one, is in the resident or the non-resident **name table**: a length byte, the name, and a word of ordinal. The first entry of each table is not an export: the resident one is the module's name, the non-resident one its description, both at ordinal nought.
- [[measured]] In Windows 3.1's own libraries the two do not always agree. COMMDLG exports 48 ordinals and names 26; across the sixteen libraries the knowledge base surveys, 156 exports have no name at all and can only be imported by number.
- [[measured]] A program imports a system function by ordinal, so an ordinal is not a detail an implementation may choose: winbox.js builds one thunk per ordinal, and a table entry at the wrong ordinal is a call that reaches the wrong function. Each module's page lists every place winbox.js's tables disagree with the binaries.
- [[measured]] `KRNL286.EXE` and `KRNL386.EXE` export exactly the same ordinals.

## Relocations

[[documented]] A segment's relocations name each place to patch once; the other places for the same target are chained through the patched words themselves, from the one the record names to a word of `0xffff`.

## Resources

[[documented]] The resource table starts with the alignment shift, then a run of types, each with its count and its entries — offset and length in units of that shift, flags, and an id, which is a number with the top bit set or an offset to a length-prefixed name. The [[format:fot]] is two resources and nothing else.
