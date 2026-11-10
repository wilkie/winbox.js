---
kind: function
module: KERNEL
name: FindResource
ordinal: 60
summary: A module's resource by its name or number and its type's, through the module's old-style name table first where a name is asked, then the resource table; its handle, or nought.
versions:
  '3.1': exact
probes: [nametab, findres]
source: crates/winbox-win16/src/resources.rs
topics: [win386]
---

## Observed behaviour

- [[measured]] [[probe:nametab]] loads a library whose name table (`RT_NAMETABLE`, type 15, resource 1) gives the name `PALT` to type 7F01h, and asks it for resources by every mix of names and numbers. What each found, by the tag the resource holds:
  - Resource 2720h of type `PALT`, as `DOGZDLL.DLL` asks for its palette, is type 7F01h's 2720h. So is 2810h, whose entry has two bytes of nought past its names. `palt` and `Palt` find it too.
  - 2721h of `PALT`, which no entry names, is not type 7F01h's 2721h: it is the 2721h of the type the resource table itself names `PALT`.
  - 2811h of `PALT` finds nothing where the entry's id is A811h, with its high bit; A811h asked finds 7F01h's 2811h.
  - `SECOND` of `PALT`, or `second` of `palt`, is the 2812h an entry names so. `NAME1` of `PALT`, which no entry holds, is the resource table's own `PALT` type's `NAME1`.
  - 2900h of `NOHI`, whose entry's type is 7F02h without its high bit, is the 2900h of the resource table's own type `NOHI`, not type 7F02h's.
  - `BYNUM` of type 7F03h, whose entry's type is 7F03h, is its resource 5. `VIANUM` of 7F04h, whose entry's type is FF04h, finds nothing; of FF04h it is 7F04h's 7. `SECOND` of 7F01h finds nothing: that entry's type is FF01h.
  - Two entries naming `DUP`: the first's resource.
  - `#10016` of `PALT`, 2720h of `#32513`, and `#10016` of `#32513` all find 7F01h's 2720h. `10016` of `PALT`, plain digits, finds nothing.
  - 2722h of `PALT`, `NOSUCH` of `PALT` and 2720h of `NOSUCH` find nothing.
- [[measured]] The program's own table is resource 2 of type 15, not 1: 2720h of `PALT` finds nothing there, though 2720h of type 7F01h is found.
- [[measured]] `SizeofResource`, `LoadResource` and `LockResource` of what was found are those of the resource found, as for any other ([[fn:KERNEL.SizeofResource]]).
- [[measured]] [[probe:findres]]: the same resource found twice is the same handle.

## Nuances

- [[read out]] A name table is asked only for a name. With both the type and the resource numbers -- `MAKEINTRESOURCE` or `#` and digits -- the resource table is read alone.
- [[read out]] An entry is taken only for the pair asked: a type it names with a resource it does not hold leaves both names as they were, and they are compared with the resource table's own names.
- [[read out]] A word of an entry is taken for the number its name stands for only where its high bit is set; one without, as the `NOHI` entry's type, leaves the name. A number asked is compared with the entry's word as it is, so a plain resource number never matches an id written with its high bit, and a type asked by number matches only an entry whose type word lacks the high bit.
- [[read out]] Names in the name table are compared without regard to case; names in the resource table are compared with the name asked put in upper case, against the table's as it is (resource compilers write them in upper case).

## Inside Windows

- [[read out]] `KRNL386.EXE` seg3 `0008` is the export, which checks its pointers and jumps to `0bb3`. `0bb3` calls `0964` to number the type and the resource, then walks the resource table: the first type whose word is the number (high bit set, `0aa8`-`0ab6`), or, for a name, whose name matches (`0af9`); in that type alone the first resource that matches the same way (`0c19`-`0c44`); else nought (`0c46`).
- [[read out]] `0964`: `0ac0` makes a number of each argument -- its offset where its segment is nought, `#` and digits read in a word, else nought. Where the type is a name, or the type a number and the resource a name (`0980`-`098f`), the module's resource table is searched for a type whose word is 800Fh (`09ab`-`09c9`); with none, nothing is numbered. The table is resource 1 of type 15, found by `0bb3` itself with both as numbers (`09d6`-`09e7`; the first entry's handle where it is loaded already), loaded and locked (seg1 `8928`, `8755`).
- [[read out]] `0a1b`-`0a88` walks the entries: each is a word of its length, the type's word at +2, the resource's at +4, the type's name from +6 to its nought and the resource's name straight after it to its own. A type asked by number is compared with the word at +2 as it is (`0a1f`), a name with the type's name by KERNEL's ordinal 87 (`0a34`, seg1 `838e`, which lowers A to Z, and C0h to DEh but D7h under a flag of KERNEL's); then a number with the word at +4, a name with the resource's name, its place found with `lstrlen` (`0a60`-`0a74`). The next entry is the length on (`0a7f`); a length word of nought ends the walk.
- [[read out]] `0a8a`-`0a9e`: the matching entry's type word replaces the type only where its high bit is set, and its id word the resource likewise. Without a resource asked (`SetResourceHandler`, `0b64`), the first entry of the type gives its word, high bit or not (`0a4b`-`0a55`).
- [[read out]] `0af9`: a resource table name is compared as long as its length byte says, each character asked put in upper case (seg1 `09af`, `83e9`: a to z, E0h to FEh but F7h) and compared with the table's; the name asked must end there. A numbered entry is never a name's.

## Implementation

`find_in` in `crates/winbox-win16/src/resources.rs` numbers the type and the resource as `0964` does (`numbered`), from the entries `winbox-ne` reads from resource 1 of type 15 (`Executable::name_table`, `name_entries`), and finds the resource as `0bb3` does (`locate`, `matches`). USER's resources -- dialogs, menus, bitmaps, accelerators (`find_by`) -- and `SetResourceHandler` go the same way. Before, WinBox gave each numbered type and resource the name the first table's entry gave it and matched either; it found resources Windows does not ([[probe:nametab]]: 2721h, 2811h, 2900h of `NOHI`, `VIANUM` of 7F04h, `SECOND` of 7F01h, `10016` and the program's table at resource 2), and matched a name with a number written in decimal.

Not yet done: the name table's comparison of C0h-DEh, which turns on a flag of KERNEL's not read out; WinBox compares A to Z alone.
