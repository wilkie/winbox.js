---
kind: topic
name: The floating-point unit
summary: How winbox.js runs the 387 instructions a Windows 3.1 program issues — the stack addressed from TOP, the condition codes and the control word's rounding — from Intel's description, holding values in doubles as DOSBox does.
probes: []
---

A Windows 3.1 program built to use a coprocessor issues the 387's own instructions. Calculator does, for every number it shows. The recordings can't serve as the reference here: they come from Windows under DOSBox, whose FPU is a model that holds values in 64-bit doubles, not hardware. So winbox.js's FPU follows Intel's description of the instruction set, and a test assembles each instruction and runs it on the 386 core.

- [[documented]] Eight registers form a stack. `ST(i)` is the register `i` places below `TOP`, which is kept in bits 11 to 13 of the status word, so pushing lowers `TOP` and popping raises it. Every register operand is addressed from `TOP`, never by its physical number.
- [[documented]] With `ST(i)` as the destination, as `DC` and `DE` encode it, the subtraction and division come with their senses swapped. `DE E9` is `FSUBP ST(1),ST`, which is ST(1) − ST(0). `DE E1` is `FSUBRP ST(1),ST`, which is ST(0) − ST(1).
- [[documented]] Comparisons set `C3 C2 C0`: 000 when ST(0) is greater, 001 when it is less, 100 when they are equal, and 111 when either is a NaN. A program reads them with `FNSTSW AX`.
- [[documented]] `FIST`, `FRNDINT` and `FBSTP` round as the control word's bits 10 and 11 say: to nearest, with a half going to the even integer, or down, up, or toward zero. `FINIT` leaves the control word `037Fh`, which rounds to nearest and masks every exception. A value that doesn't fit is stored as the integer indefinite, the most negative integer of the size, with `IE` set.
- [[documented]] `FPREM` leaves the three low bits of its quotient in `C0`, `C3` and `C1`. `FXAM` classifies ST(0) in `C3 C2 C0` (zero, normal, infinity, NaN or empty) with its sign in `C1`.
- Held as doubles: an 80-bit value in memory loads and stores exactly whenever a double can hold it. One with more precision than that is rounded to nearest on the way in. Exceptions are recorded in the status word, as masked ones are, and never raised.

## In winbox.js

`src/emulator/x87.ts` has the unit, and `test/emulator/x87_test.ts` has its instruction tests. The first version indexed the physical registers where the 387 addresses them from `TOP`. It never read the control word's rounding, and it threw on most of the `D9`, `DB`, `DD` and `DF` groups. Calculator stopped at the first of those it reached.
