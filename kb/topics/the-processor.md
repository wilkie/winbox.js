---
kind: topic
name: The processor
summary: What winbox.js's 386 is tested against — the SingleStepTests suites captured from a real 80286 and 80386EX, every opcode under every prefix — what the 386's own tests showed about operand and address sizes, faults and the instructions programs for Windows 3.1 use, and the oracle's processor beyond it — DOSBox's 486 with a Pentium's RDTSC, its flags, CPUID and how programs tell processors apart.
probes: [seglim, cpu486]
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

## Segment checks in protected mode

The suites are of real mode, where every segment is 64 KiB from its selector times sixteen, so they say nothing of a descriptor's limit. Two of the 386's checks are taken from the manual:

- [[documented]] **A data segment that expands down** (Intel 80386 manual, expand-down data segments): its limit is the last offset _outside_ it, and its room runs from the limit + 1 to `FFFFh`, or to `FFFFFFFFh` with its B bit. An access at or below the limit, or one that runs past the top, is a general protection fault, 13, or a stack fault, 12, through SS, as an access past an ordinary limit is.
- [[documented]] **An instruction fetched past CS's limit** is a general protection fault with error code nought, before anything the instruction reaches. [[measured]] The 386's own tests hold it in real mode, where the limit is `FFFFh`: an instruction that starts at `FFF8h` and runs past it (`66 81 06 …` in `6681.0`, ten bytes) takes interrupt 13 with the instruction's own address pushed, and one that ends at `FFFFh` (`66 EA …`, eight bytes) runs.

[[measured]] [[probe:seglim]] made those segments under DOSBox, in standard mode, with INT 31h `000Ch`, and caught exceptions 0Dh and 0Ch with handlers of its own (INT 31h `0203h`). DOSBox 0.74 faults on none of them: a byte read at or below an expand-down segment's limit is read, a word at `FFFFh` without the B bit is read, an expand-down SS read below its limit is read, and code whose limit cuts `mov al, 5` in two runs it whole. The probe's control, an ordinary segment read one byte past its limit of `0FFFh`, is read too: DOSBox checks no segment's limit in protected mode, as [[probe:badptr]] found for KERNEL's pointer checks and [[fn:KERNEL.EMSCopy]] for a far call. Its records are no evidence of a 386's checks either way, and WinBox follows the manual, as it does for an ordinary limit. Where the probe's records differ, they are a known gap (`seglim:up16`, `down16`, `down32`, `fetch`, `stack`). The reads above the limit, which the manual and DOSBox agree are inside, are measured.

The core keeps a segment that expands down as its limit and a flag beside it, not as a second bound: a cached segment of 24 bytes rather than 16 made the benchmark 10 to 25% slower. An access through such a segment, or past an ordinary limit, is checked both ways off the common path, in a function of its own the compiler keeps cold (`outside`). [[measured]] So made, the benchmark ran no slower than before on 2026-11-09: in four interleaved rounds its medians were 6 to 19% faster, which is more likely the code's layout than the check. A fault in the fetch of the instruction's own bytes is noted (`fetched_past_limit`), and `fault_vector.rs` names it #GP(0) before looking at what the instruction reaches.

## The oracle's processor: the 486's instructions and CPUID

[[read out]] The recorder gives DOSBox 0.74-3 no `cputype` (`record.mjs` writes `core=auto` and `cycles` alone), so it runs at its default, `auto` (`src/dosbox.cpp` 483-485), which `src/cpu/cpu.cpp` makes `CPU_ARCHTYPE_MIXED`, FFh (2352-2355). Each of the normal core's checks of an instruction against the processor is `CPU_ArchitectureType < ...` (`core_normal/prefix_0f.h`, `prefix_66_0f.h`), and FFh is above them all: the 486's `BSWAP`, `XADD`, `CMPXCHG`, `INVD`, `WBINVD` and `INVLPG` and the Pentium's `RDTSC` run, `CPUID` answers as a 486DX (`CPU_CPUID`, 2010-2044), and `POPF` lets the ID bit through (`CPU_flag_id_toggle`, 2390-2391). Protected mode runs on the recompiling core, `core_dynrec` ([[topic:timing]]), which translates none of these but `INVLPG` and gives each to the normal core (`core_dynrec/decoder.h` 172-250, `core_dynrec.cpp` 273-279): what the normal core does is what a program sees.

So WinBox's core is two processors (`Model`, `crates/winbox-cpu/src/lib.rs`): `I386`, the 80386 of the hardware vectors, which stops at these instructions as it always has, and `Mixed`, DOSBox's, which the machine runs every program on (`i486.rs`).

[[measured]] [[probe:cpu486]] runs each at a program's privilege, 3, with the arithmetic flags all clear and then all set. Standard and 386 enhanced mode answer alike:

| Instruction                   | What it does                                                                                          | The flags              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| `BSWAP` of a double word      | its bytes reversed: `12345678h` is `78563412h`                                                        | as they were           |
| `BSWAP` of a word             | the word cleared, the high word kept: EAX `12345678h` is `12340000h`                                  | as they were           |
| `XADD`                        | the destination the sum, the source the destination as it was                                         | as they were           |
| `CMPXCHG`                     | equal: the source to the destination; unequal: the destination to AL, AX or EAX, and to memory again  | ZF alone, set if equal |
| `INVD`, `WBINVD`              | a general protection fault, error code nought, at the instruction                                     |                        |
| `CPUID`, EAX 0                | EAX 1, the highest leaf; EBX, EDX, ECX `GenuineIntel`                                                 |                        |
| `CPUID`, EAX 1                | EAX `0402h`, family 4, model 0, stepping 2; EBX and ECX nought; EDX 1, a coprocessor and nothing else |                        |
| `CPUID`, EAX 2 or `80000000h` | all four nought                                                                                       |                        |
| `RDTSC`                       | runs, and counts on between two reads                                                                 |                        |

- **The flags are DOSBox's, not a 486's.** [[documented]] A 486 sets all six as `ADD` after `XADD` and as `CMP` after `CMPXCHG`. [[read out]] DOSBox's `XADD` touches no flag, and its `CMPXCHG` sets ZF alone over the flags as they were (`prefix_0f.h` 359-411 and 575-590, `prefix_66_0f.h` 238-263 and 434-440). `BSWAP` of a word is undefined on a 486; DOSBox clears it (`BSWAPW`, `cpu/instructions.h` 959-960). WinBox does as the oracle does.
- **EFLAGS' AC and ID.** [[measured]] Both can be set and cleared with `POPFD`, and `PUSHFD` shows nothing else above bit 15 (DOSBox pushes EFLAGS less VM and RF, `cpu.cpp` 225). A word's `PUSHF` and `POPF` keeps AC and clears ID: DOSBox's `CPU_SetFlags` loads the ID bit whatever the mask, and a word popped has it clear (172-176, 211-213). [[read out]] `IRET` of a word in protected mode loads EFLAGS under its whole mask, AC and ID cleared (919, 968); WinBox does so, not measured.
- **INVLPG.** [[read out]] The normal core raises a general protection fault for it above ring 0 and an undefined opcode for its register form (`prefix_0f.h` 91-94, 110-112). The recompiling core translates it, and above ring 0 stops the emulator ("DynrecCore: illegal option in invlpg nonpriviledged", `core_dynrec/decoder_opcodes.h` 990-994; its register form `dyn_grp7_2`, 1021). [[measured]] A probe's `INVLPG` ended DOSBox in both modes, nothing after it recorded, so no recording can hold it. WinBox raises the normal core's faults, which the 80486 manual has too.

### Telling processors apart

[[documented]] A program learns which processor it has from EFLAGS: a 386 cannot set AC; a 486 that cannot set ID has no `CPUID`; else `CPUID` names it. [[measured]] Under the oracle a program finds a 486DX with `CPUID`, Intel's, family 4, with a coprocessor, and `RDTSC` runs on it though `CPUID` sets no time-stamp bit (EDX bit 4). WinBox answers the same.

### RDTSC

[[read out]] DOSBox's counter is its time in milliseconds since it started, with their fraction, times its cycles a millisecond (`PIC_FullIndex()*CPU_CycleMax`, `prefix_0f.h` 228-234). With `cycles=max` that rate is the host's: [[measured]] [[probe:cpu486]] saw 10^4 to 10^5 a millisecond of `GetTickCount` from one recording to the next, so its record says only that it is a thousand or more ([[topic:timing]]). WinBox's is its clock's (`Clock::time_stamp`, `crates/winbox-machine`): the milliseconds times the clock's rate -- on a virtual clock the instructions run, those charged for calls and the milliseconds skipped at the rate, 3,000 a millisecond on the survey's clock -- and on the host's own time its milliseconds times 3,000. Within a slice of the run it counts on by one an instruction (`Cpu::time_stamp`).

### No hardware vectors

SingleStepTests has suites of the 8088, 8086, V20, 80186, 80286 and 80386 and none of the 486 (the organisation's repositories, 2026-11-15), and the 80386's suite has no test of these opcodes, which the part does not have. The `Mixed` model is held to the probe's records and to the unit tests that carry them (`tests/units.rs`, `the_oracles_486`); the vectors run on `I386` as before.

## Running them

```sh
node scripts/fetch-cpu-tests.mjs                 # the 286's tests
node scripts/fetch-cpu-tests.mjs --cpu 386 --all # the 386's, ~600 MiB
pnpm test:conformance                            # both, against their baselines
```

`crates/winbox-cpu/tests/conformance.rs` runs them, reading the 80386's MOO files. A pass rate below its baseline fails the run.

## Speed

`pnpm bench` runs four loops for two seconds each, in real mode and in protected mode under descriptors the size of a Win16 program's segments: arithmetic on registers alone, loads and stores, pushes and pops, and arithmetic against memory the way compiled code does it. On the machine it was last run on, 2026-09-29, the core ran them at 1.3 to 2.5 million instructions a second.

- Protected mode, with every access checked against its segment's limit, runs as fast as real mode, within the benchmark's noise. The checks cost nothing measurable.
- The time goes into decoding and dispatching each instruction, not into reaching memory. Building a debugging string for every instruction, logged or not, cost 10 to 15% of the speed; it is now built only when instructions are logged.
- That is slower than a 16 MHz 386SX. What would make it faster is the decoder, not memory access; that is not started.
- [[measured]] The 486's instructions, the `Model` and EFLAGS' high word cost nothing measurable (2026-11-15): in five interleaved rounds against the core before them, every workload's median was 0.2 to 5.5% faster, within the benchmark's noise. They sit off the common path, in arms of the two-byte decode taken only for their opcodes.

## Not yet done

- `CMPXCHG8B`, the Pentium's (`0F C7`), and MMX: DOSBox 0.74 has neither, so the oracle answers an undefined opcode, which is not recorded.
- `IRET`'s clearing of AC and ID is read out of DOSBox, not recorded; nor is whether Windows' task switches keep a program's AC and ID (WinBox keeps one EFLAGS high word for the machine).
- `INVLPG` at a program's privilege cannot be recorded (above).
