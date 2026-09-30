---
kind: topic
name: The processor
summary: What winbox.js's 386 is tested against — the SingleStepTests suites captured from a real 80286 and 80386EX, every opcode under every prefix — and what the 386's own tests showed about operand and address sizes, faults and the instructions programs for Windows 3.1 use.
probes: []
---

Windows 3.1 runs on a 386 in enhanced mode, and programs made for it use the 386's instructions: 32-bit registers under the operand-size prefix, 32-bit addresses under the address-size prefix, and the instructions after 0Fh. winbox.js's processor is a 386, and it is held to two suites of tests captured from real parts by Daniel Balsom's ArduinoX86 board:

- **80286**: [SingleStepTests/80286](https://github.com/SingleStepTests/80286), from a Harris 80C286, in real mode: 326 opcodes, 250 tests of each sampled.
- **80386**: [SingleStepTests/80386](https://github.com/SingleStepTests/80386), from an Intel 386EX, in real mode: 941 files, one for each opcode under each combination of prefixes it takes, 100 tests of each sampled.

Each test is the part's whole state before one instruction and after it. The instruction's semantics are the same in protected mode, where Windows runs programs; what differs there is segment checks, which the Windows probes measure.

[[measured]] With I/O instructions and HLT set aside, winbox.js agrees with 91,537 of 91,600 of the 386's tests. I/O and HLT read the bus, which the harness does not model, and in a Windows program they are privileged anyway.

The 63 tests that still disagree fall into two groups:
- the flags a signed divide error leaves in the frame it pushes: IDIV only, about 4% of its errors (98 of the 2,500 tests of a byte's, 101 of a word's). They follow the 386's microcode, which divides differently from the 286's that winbox.js's model was fitted to. No program is likely to read them;
- the fetch of the test's own HALT past CS's limit.

[[measured]] **A byte shifted by more than 8.** SHL and SHR of a byte by a count, CL or an immediate, whose low five bits are 16 or 24, leave CF as a shift by 8 would: bit 0 for SHL, bit 7 for SHR. OF is CF for SHL and clear for SHR. By any other count above 8, CF is clear. That fits all 6,165 such tests of `D2.4`, `D2.5` and their address-size forms, and every test of `C0.4` to `C0.6` passes with it. winbox.js had cleared CF for every count above 8. The 286 does clear it, so its tests of these shifts are set aside.

## What the tests showed

Before the tests, the processor had been fixed an instruction at a time, as programs of the corpus stopped on them. That missed a great deal. Under the tests, it went from 73% of a first subset to 99.9% of the whole suite:

- **Prefixes.**
  - The FS and GS overrides were not decoded at all.
  - Under the address-size prefix, every instruction but the loops went to the 286's execute, which skipped the 386's own forms.
  - Each instruction now starts with its prefixes cleared. One that faulted, or finished early, left them on the next.
- **32-bit addresses.**
  - A 32-bit offset past a segment's limit faults; it does not wrap at 64 KiB.
  - `[disp32]` has DS for its segment, and EBP and ESP address SS.
  - A SIB byte with no index scales its base, as the part does, though the manuals do not say so.
- **Faults.**
  - In real mode, a stack access past its limit is a stack fault, 12, on the 386. On the 286 it is a general protection fault, 13. Which it is follows the segment register the access went through, not the selector's value.
  - LOCK is an undefined opcode on anything but a read-modify-write of memory; the 286 ignores it.
  - An instruction fetched past CS's limit faults before it runs.
- **Instructions the 386 added.**
  - SETcc, the near Jcc with a 32-bit displacement, PUSH and POP of FS and GS, MOVZX, and BT, BTS, BTR, BTC, BSF and BSR.
  - SHLD and SHRD in every form. [[measured]] A 16-bit count past 16 goes on shifting the source in, so SHLD's result is the source rotated left by the count less 16.
  - Group /6 of the shifts is SHL.
- **The operand-size prefix.**
  - 32-bit DIV and IDIV of EDX:EAX, with a divide error for a quotient that does not fit.
  - POPAD, PUSHAD, ENTER, LEAVE, IRETD, RETD and RETFD, and PUSH of a sign-extended byte.
  - MOV from a segment register to a register zero-extends it.
  - On a 16-bit stack, a double word is one access at SP, and one across the top of the segment faults. Only SP moves.
  - POP of a segment register reads a word but moves the stack by a double word.
- **Order.** In each of these, the part reads before it writes and commits the stack last, so a fault leaves the state as it was:
  - POP to memory, whose ESP-based address counts the pop;
  - LEAVE;
  - ENTER, which reads every display before it pushes;
  - IRETD and RETD, which check the EIP they return to against CS's limit before taking anything.
- **The 286's own forms.** IMUL r16's carry and overflow were set, then cleared. BOUND and SALC were missing.

Where the 286's tests disagree with the 386 the core is — LOCK, the real-mode stack fault, and a byte shifted by 16 or 24 — its oracle sets those tests aside. No 286 opcode fails more than before.

## Running them

```sh
node scripts/fetch-cpu-tests.mjs                 # the 286's tests
node scripts/fetch-cpu-tests.mjs --cpu 386 --all # the 386's, ~600 MiB
pnpm test:conformance                            # both, against their baselines
```

`test/conformance/oracle.ts` and `oracle386.ts` run them; `moo.ts` reads the suites' MOO files; the reports go to `test/conformance/report.md` and `report386.md`. A pass rate below its baseline fails the run.
