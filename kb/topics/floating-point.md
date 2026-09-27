---
kind: topic
name: The floating-point unit
summary: How winbox.js runs the 387 instructions a Windows 3.1 program issues — on a coprocessor or through WIN87EM's emulator, as the machine has one or not — and the unit itself, from Intel's description, holding values in doubles as DOSBox does.
probes: [winflags]
---

A Windows 3.1 program built to use a coprocessor issues the 387's own instructions. Calculator does, for every number it shows. The recordings can't serve as the reference here: they come from Windows under DOSBox, whose FPU is a model that holds values in 64-bit doubles, not hardware. So winbox.js's FPU follows Intel's description of the instruction set, and a test assembles each instruction and runs it on the 386 core.

- [[documented]] Eight registers form a stack. `ST(i)` is the register `i` places below `TOP`, which is kept in bits 11 to 13 of the status word, so pushing lowers `TOP` and popping raises it. Every register operand is addressed from `TOP`, never by its physical number.
- [[documented]] With `ST(i)` as the destination, as `DC` and `DE` encode it, the subtraction and division come with their senses swapped. `DE E9` is `FSUBP ST(1),ST`, which is ST(1) − ST(0). `DE E1` is `FSUBRP ST(1),ST`, which is ST(0) − ST(1).
- [[documented]] Comparisons set `C3 C2 C0`: 000 when ST(0) is greater, 001 when it is less, 100 when they are equal, and 111 when either is a NaN. A program reads them with `FNSTSW AX`.
- [[documented]] `FIST`, `FRNDINT` and `FBSTP` round as the control word's bits 10 and 11 say: to nearest, with a half going to the even integer, or down, up, or toward zero. `FINIT` leaves the control word `037Fh`, which rounds to nearest and masks every exception. A value that doesn't fit is stored as the integer indefinite, the most negative integer of the size, with `IE` set.
- [[documented]] `FPREM` leaves the three low bits of its quotient in `C0`, `C3` and `C1`. `FXAM` classifies ST(0) in `C3 C2 C0` (zero, normal, infinity, NaN or empty) with its sign in `C1`.
- Held as doubles: an 80-bit value in memory loads and stores exactly whenever a double can hold it. One with more precision than that is rounded to nearest on the way in. Exceptions are recorded in the status word, as masked ones are, and never raised.

## With a coprocessor or without

A program built for floating point is written for the coprocessor. Each of its instructions comes with an `FWAIT` before it and an OS fixup, a relocation of its own kind. KERNEL applies the fixups as it loads the program, and what it writes depends on whether there is a coprocessor. winbox.js's machine has one by default, as the Windows the recordings are made on does, and the run page can take it away.

- [[measured]] [[probe:winflags]] finds a coprocessor on that Windows. `GetWinFlags` and `__WINFLAGS` carry it as 400h. See [[fn:KERNEL.GetWinFlags]].
- [[read out]] With a coprocessor, KERNEL makes each `FWAIT` a `NOP`, and the instruction runs on the unit (`KRNL386.EXE` seg1 `7536`, tables at `74f3`). Without one, it makes the instruction `INT 34h` to `3Bh`, one for each ESC opcode `D8h` to `DFh`. An instruction with a segment prefix becomes `INT 3Ch`, followed by a byte whose top two bits name the segment: DS, SS, CS or ES. A lone `FWAIT` becomes `INT 3Dh` either way. Every instruction keeps its length.
- [[read out]] WIN87EM's handlers carry the instruction out and return past it (`WIN87EM.DLL` seg1 `d0a`). They emulate the 8087's arithmetic, loads, stores, comparisons, constants and functions, and not `FNINIT`, `FNOP`, the environment, `FBLD`, `FBSTP`, `FXTRACT`, `FINCSTP`, `FDECSTP` or the 387's own instructions. Those are reported as unemulated. A stored status word has TOP as nought.
- [[read out]] An exception the program's control word leaves unmasked is reported by calling the procedure at `INT 3Eh`'s vector, with a code in AX. A denormal is always masked, and the stack's faults and unemulated instructions never are. A program sets that procedure through `__FPMATH` function 3, and Calculator's ends the program with the runtime's message.
- [[read out]] `__FPMATH`, called with its function in BX, starts and resets the unit. Its control word is 1332h, and the unit is given 1330h, with invalid operations and denormals unmasked. It sets and reads the control word, rounds, pops a long, reads and clears the gathered exceptions, counts the stack, and says whether there is a coprocessor. Calculator asks, and with a 387 uses `FSIN` and `FCOS` directly.
- winbox.js's WIN87EM carries each emulated instruction out on the processor's own unit. Not followed: WIN87EM's own arithmetic, whose rounding and NaNs may differ; its stack of fourteen values, where the unit has eight; and, with a coprocessor, exceptions the unit raises, since it never raises them.

## In winbox.js

`src/emulator/x87.ts` has the unit, and `test/emulator/x87_test.ts` has its instruction tests. `src/win16/win87em.ts` and `src/win16/win87em/emulator.ts` are WIN87EM, and `test/win16/win87em_test.ts` tests the fixups and the emulator. The machine's `coprocessor` option chooses. The first version indexed the physical registers where the 387 addresses them from `TOP`. It never read the control word's rounding, and it threw on most of the `D9`, `DB`, `DD` and `DF` groups. Calculator stopped at the first of those it reached.
