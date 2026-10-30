---
kind: function
module: USER
name: StringFunc
ordinal: 470
summary: Four of USER's string routines behind one entry, chosen by CX: AnsiNext, AnsiPrev, AnsiUpper and AnsiLower.
versions:
  '3.1': exact
probes: [strfunc]
records: [stringfunc]
source: src/win16/user/string-func.ts
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:strfunc]], called in registers: CX 1 answers the next character's address, the string's end at its nought, and pops 4 bytes; 2 the character before -- the start stays -- and pops 8; 3 and 4 convert the string in place, answering its address, or a character in the low word with the high word nought, and pop 4.

## Inside Windows

- [[read out]] `USER.EXE` seg11 `02e7`: `xchg bx,cx`, `dec bx`, `shl bx,1`, and a jump through the table at `02df`: `030e`, `AnsiNext`'s body; `02f1`, `AnsiPrev`'s; `0130` and `0135`, the tails of `AnsiUpper`'s and `AnsiLower`'s entries, which go to the language driver where one is loaded. Each pops its own arguments; the two bodies skip their exports' checks of a pointer. Another CX jumps through the words after the table.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

`src/win16/user/string-func.ts`; the Rust engine's `language_driver.rs` (`string_func`). Declared as popping nothing; the routine pops its arguments by moving the far return over them. Another CX is not followed: nothing is popped and the registers are left.
