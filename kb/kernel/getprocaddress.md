---
kind: function
module: KERNEL
name: GetProcAddress
ordinal: 50
summary: A procedure's address in a module, by its name, by `#` and the digits of its ordinal, or by its ordinal in the pointer's offset with nought in its segment.
versions:
  '3.1': exact
probes: [procnum, w386lib]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [dynamic-link-libraries, win386]
---

## Observed behaviour

- [[measured]] [[probe:procnum]] asks KERNEL, USER and GDI as Windows keeps them, and COMMDLG loaded from its file, for names of `#` and digits, and compares each address with the one each ordinal gives asked for by number. Every module answers alike:
  - `#1`, `#01`, `#0001` and `#65537` are ordinal 1; `#9` is 9; `#113` and `#178` are KERNEL's `__AHSHIFT` and `__WINFLAGS` ([[topic:exported-constants]]).
  - `#0`, `#00`, `#65536` and `#32768` find nothing; `#32769` is ordinal 1 and `#32770` ordinal 2, as 32769 asked for by number is ordinal 1.
  - `#`, `#1x`, `#x1`, `# 1`, `#+1`, `#-1`, `#1 `, `#1#`, `##1` and `1` find nothing: they are names, and no module has them.
  - `#` and 130 noughts and a 5 finds nothing; with a 7 at its 127th character, it is ordinal 7.
  - An ordinal past a module's last, or one its entry table leaves empty (GDI's 113 and 178), finds nothing, by `#` or by number.
- [[measured]] COMMDLG's `GETOPENFILENAME` and `GetOpenFileName` both find ordinal 1. [[probe:w386lib]]: a WATCOM Win386 library's `Win386LibEntry`, which it keeps in mixed case, is found by neither spelling, and by its ordinal ([[topic:win386]]).

## Inside Windows

- [[read out]] `KRNL386.EXE` seg2 `073f`: a name whose segment is nought is its ordinal; else the name is copied to the stack with its length in a byte, no more than 127 characters (`0706`-`073c`, CX 7Fh), and seg1 `50a2` finds its ordinal. An ordinal of nought answers nought (`07a2`); any other, its entry's address (seg1 `4fe7`).
- [[read out]] seg1 `50b3`-`511c`: a name whose first character is `#` is read as decimal digits, one for each character after it of the 127 copied, the number kept in a word as it is made (`MUL` of the word by ten, the high word dropped); the first that is not a digit (`SUB AL,30h` and above 9) sends the whole name to the name tables, `#` and all. A `#` alone reads the nought the copy ends with, and is a name. The tables are not looked at for a number, so it holds for every module.
- [[read out]] seg1 `50ca`-`50fc` compares a name with each of the module's names, the resident table then the nonresident, upper-casing the name asked for character by character (`83e9`) and comparing it with the name as the module keeps it.
- [[read out]] seg1 `4fe7`: an entry is found by the ordinal's low 15 bits (`4ff2`, `AND CX,7FFFh`); nought, or one outside every bundle of the entry table, answers nought (`4ffe`-`5026`).

## Implementation

`get_proc_address` in `crates/winbox-win16/src/modules_kernel.rs` reads a name of `#` and digits as KERNEL does (`ordinal_written`), and takes an ordinal's low 15 bits (`ORDINAL_BITS`) for a module loaded from its file and for one WinBox keeps. A kept module's table holds a placeholder at each ordinal Windows' own file leaves empty (`modules::PLACEHOLDER`, compared with each module's file); it finds nothing. A name is compared as KERNEL compares it (`Executable::ordinal_found`); a kept module's names, which are Windows' own, without regard to case.
