# Architecture

WinBox is a **high-level emulator**. It does not emulate a PC. It emulates
enough of a 286/386 to run a Win16 program's own machine code, and it takes
control the moment that program calls into the Windows API, where a JavaScript
implementation runs instead.

That split is the whole design:

```
   Guest program (real Win16 machine code)
        |
        |  far call into KERNEL/USER/GDI
        v
   Synthesized thunk segment  ......................  emulated x86
        |
        |  INT 0x80  -> trap
        v
   Win16 HLE layer (JavaScript)  ...................  native
        |
        |  argument marshalling off the guest stack
        v
   API implementation (JavaScript, often async)
        |
        |  may call back into guest code
        v
   Callback thunk -> CALLF -> guest WndProc -> INT 0x81
```

## Taking control

`ModuleManager` gives each Win16 module (KERNEL, USER, GDI, …) a real segment
of synthesized 16-bit code. Every exported ordinal gets an eight byte slot:

```asm
INT 0x80          ; CS identifies the module, IP identifies the ordinal
RETF imm16        ; pop the callee-cleaned arguments
```

A guest far-calls those slots believing they are the real libraries. Nothing
about the call is special from its point of view: it pushes arguments, does a
far call, and gets a result in AX/DX.

Offset 0 of the same segment is the callback thunk, used in the other
direction — when the host needs to run guest code (a window procedure, a dialog
procedure, an enumeration callback) and regain control when it returns:

```asm
CALLF seg:off     ; immediate patched by Scheduler#call before each use
INT 0x81          ; the callback returned
```

## The trap protocol

Interrupt dispatch is CPU behaviour: an interrupt pushes FLAGS, CS and IP and
vectors through the interrupt table, and guest code handles it. The exception
is the vectors the emulator claims for itself, which have to reach the host
instead. So the rule is: **a claimed vector latches for the host, everything
else dispatches in the guest.**

`CpuCoreHost#claimsInterrupt` answers which is which, backed by whatever has
been registered on `Machine#interrupts`. Today that is `0x1A`, `0x21` and
`0x31` for the DOS layer and `0x80` and `0x81` for the Win16 thunks.

For a claimed vector:

1. The guest executes `INT n`.
2. The core latches the vector on the CPU wrapper (`cpu.interrupt = n`) and
   returns. It does **not** vector through the IVT or IDT. CS:IP is left on the
   instruction after the `INT`, which is the `RETF` in the thunk.
3. `Scheduler#run` checks the latch after each `cpu.step()`, halts the task and
   breaks out of the frame loop.
4. It clears the latch and calls `machine.interrupts.dispatch(vector)`.
5. The handler returns `true` to resume immediately, a `Promise` to resume when
   it settles, or anything else to stay halted and resume itself later.

`Win16#syscallInvoke` takes the last option: it returns `false`, and
`Scheduler#interpretReturnValue` resumes the task once the API implementation
has produced a value for AX/DX.

An unclaimed vector instead dispatches the way the part would: push FLAGS, push
CS, push the return address, clear IF and TF, and load CS:IP from the four-byte
real-mode entry. Faults push the address of the offending instruction so it can
be restarted; traps such as `INT`, `INT3` and `INTO` push the address of the
instruction after. Protected-mode dispatch through IDT gates is not implemented
-- those vectors still latch -- because there are no protected-mode vectors
published to verify it against.

## Argument marshalling

There is no ABI helper. `Win16#syscallInvoke` reads arguments directly out of
the guest stack at `ss:sp`, using the export table's declared types to decide
how to interpret each slot: 16-bit values inline, `LPCSTR` read as a C string
through `translateAddress`, structures loaded via `Struct#loadFromMemory`,
variadics as a far pointer to the remaining stack.

This is why the CPU's registers and memory have to stay cheap to reach from
JavaScript, and why guest memory should live somewhere a JavaScript view can
address directly.

## The core boundary

Everything above the emulator is written against `src/emulator/cpu-core.ts`:

| Interface     | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `CpuCore16`   | The 286 surface. Implemented by `core/i286.ts`.            |
| `CpuCore`     | Adds 386 enhanced mode. Implemented by `core/i386.ts`.     |
| `CpuCoreHost` | What a core needs from its environment. Provided by `CPU`. |

`Machine#cpu` is typed, so the compiler checks both sides of the seam: a core
that fails to implement the contract, and host code that reaches for something
the contract does not promise.

### The four invariants

A replacement core must honour all four. They are documented in full in
`cpu-core.ts` and are tested in `test/emulator/cpu_core_conformance_test.ts`,
which any core must pass unchanged.

1. **Traps suspend at an instruction boundary.** The vector is latched and
   drained by the host between instructions; CS:IP, the stack and the segment
   registers are untouched.
2. **A trap may suspend the guest indefinitely.** API implementations are
   frequently async. A core that must run to completion, or cannot be re-entered
   exactly where it stopped, will not work.
3. **Execution re-enters from the host.** Host and guest frames interleave to
   arbitrary depth. There is no single linear instruction stream.
4. **Guest code is modified while it runs.** The callback thunk's `CALLF`
   immediate is patched before every use. A core that caches decoded
   instructions or compiles basic blocks must invalidate on writes to guest
   code — this is the constraint most likely to be missed by a recompiling
   core, and it fails as callbacks dispatching to the wrong procedure.

## Presentation

Windows, controls and menus are real DOM elements, not canvas draws — that is
what makes the environment reachable by a screen reader and usable with a
keyboard. Canvas is used where Windows 3.1 semantics require raster operations:
the desktop's dithered background, bitmap fonts, and GDI surfaces.

## Known gaps

Found while formalizing the boundary; recorded here rather than fixed silently.

**Where the 286 and the 386 differ.** The emulator is a 386, and for the HLE it
can be assumed to be a 386 already in protected mode. The conformance corpus is
an 80286 in real mode, so it is an oracle for the instruction semantics the two
parts share and for nothing else. The audit found four places that are
part-specific, and only one of them is a behaviour the two parts disagree on:

| Behaviour                                            | Status                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POPF`/`IRET` clearing FLAGS bits 12-15 in real mode | Diverges. The 386 is understood to permit IOPL and NT. Left as the measured 286 behaviour |
| Shift counts masked to five bits                     | Shared by both parts; the comment naming the 286 is about provenance, not divergence      |
| Undefined flags for the multiplies and divides       | Measured on a 286. Unverifiable for the 386 without a corpus                              |
| The `IDIV` quotient of -128 the part lets through    | Described as a bug in the reference. Unknown on a 386                                     |

The `POPF` divergence is deliberately not "corrected" to the 386 answer. The
branch is real-mode only and the HLE never reaches it, nothing published can
verify the 386 behaviour, and changing it would trade a measured behaviour for
an assumed one across five hundred passing vectors. It is marked in the source.

**What being a 386 in protected mode actually implies** is a different and
larger list, none of it reachable by the corpus:

- Segment limits are not enforced in protected mode. The `#GP` rule for an
  operand running past its segment is real-mode only, because there the limit
  is always 64 KiB; a descriptor's limit can be anything up to four gigabytes.
- A null selector loads as present with a zero limit, so using one does not
  fault the way it should.
- `cpl` is hard-wired to zero on the 386 core, so no DPL or RPL check can ever
  fire.
- The descriptor cache is loaded when a selector is loaded and is never
  invalidated otherwise, which matches the hardware. What it means is that the
  Win16 allocator must reload selectors after moving a segment, and that has
  not been checked.

The emulator unit suite passes in full. It spent a long time not doing so --
3,787 of its 3,823 tests failed -- because it had been written against an
earlier shape of the emulator: a segmented `Memory`, registers on the `CPU`
wrapper, and register index constants the wrapper never exposed. All of that
had since moved into the execution core. The suite now addresses memory
through the core, so tests and instructions translate addresses identically in
whatever mode the core is in.

- **`CpuState` omits FLAGS.** `Scheduler#call` snapshots state before entering
  a callback and restores it afterwards, so a callback's flag results leak back
  into the interrupted code. Survivable because flags are caller-saved by
  convention. Covered by a `.failing` conformance test.
- **`SIDT` reads a field that is never assigned.** `core/i286.ts` writes
  `this.idt` for `SIDT`, but nothing sets it, and the protected-mode table
  lives in `idtBase`/`idtLimit`. `SIDT` should also store six bytes (limit word
  plus base), not a single 16-bit operand.
- **The real-mode interrupt path in `raiseInterrupt` is unreachable.** Everything
  after the latch is dead code. If real-mode vectoring is ever needed, it needs
  writing rather than enabling.

## CPU accuracy

Accuracy is measured, not estimated. `pnpm test:conformance` runs our core
against instruction tests captured from a real 80286 and reports a per-opcode
pass rate; see the Testing section of the README for how to fetch the vectors.

Across all **326** instruction forms the suite publishes, **96.4%** of vectors
pass and 284 forms pass completely.

The target is a 386 with a 286 mode, so where the two parts differ the 386
behaviour is the correct one and the 80286 corpus is only an oracle where they
agree. That distinction has not yet been audited; see the known gaps.

Of what remains, the great majority is instructions never decoded at all:

| Family                     | Forms | Vectors |
| -------------------------- | ----- | ------- |
| Port I/O (`IN`, `OUT`)     | 4     | 1000    |
| String I/O (`INS`, `OUTS`) | 4     | 967     |
| `HLT`, `SALC`              | 2     | 500     |
| `BOUND`                    | 1     | 250     |

The rest is around 140 vectors spread thinly over the string, stack and
segment-register moves, all of it the segment-limit rule below reaching paths
that do not go through the operand helpers.

### Faults

A memory operand whose bytes run past the end of its segment raises `#GP`.
Real-mode segments are 64 KiB, and the parts from the 286 onwards fault where
the 8086 wrapped the offset silently.

Two details of that are easy to get wrong and are worth stating, because both
read the same in prose and differ by thousands of vectors:

- It is `#GP` even for an operand addressed through SS. `#SS` belongs to the
  stack operations proper, not to data that merely defaults to the stack
  segment, which is what `[bp+si]` is.
- The check is per access, not per operand. A far pointer read at offset
  0xFFFE does **not** fault: the offset word is read at 0xFFFE and the segment
  word comes from offset 0, wrapping inside the segment. Only an individual
  16-bit access that straddles the end faults, so 0xFFFD faults on its second
  word and 0xFFFE does not.

### Flag behaviour the manuals call undefined

Compatibility means matching the part, including where Intel documents nothing.
These rules were measured against the hardware vectors -- each holds for 100% of
the tests for the instructions listed -- and are why the flag failure count went
from 11,841 to 323:

| Instruction                  | Flag           | Behaviour                                                                    |
| ---------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `AND`, `OR`, `XOR`, `TEST`   | AF             | Always cleared                                                               |
| `SHL`/`SAL`                  | AF             | Bit 4 of the result                                                          |
| `SHR`, `SAR`                 | AF             | Always set                                                                   |
| `SHR`                        | OF             | Only meaningful for a count of 1; cleared beyond                             |
| `MUL`, `IMUL`, `DIV`, `IDIV` | SF, ZF, PF     | Describe the _high_ half of the result: AH for byte forms, DX for word forms |
| `MUL`, `IMUL`, `DIV`, `IDIV` | AF             | Always set                                                                   |
| `ROL`, `ROR`, `RCL`, `RCR`   | SF, ZF, PF, AF | Untouched                                                                    |

### Bugs the vectors caught that a reading would not

Several of these were invisible to inspection and to the unit suite, and only
appeared as a handful of failures out of thousands:

- `instruction.segment || this.ds` treated a segment override of **zero** as no
  override at all, silently falling back to the default segment. Segment 0 is
  perfectly legal, so any string operation or memory access under an override
  in a zero segment read from the wrong place. Twenty-five sites, now `??`.
- `CALL SP` pushed the return address before reading its target, so it jumped
  to the stack pointer as the push had left it, two bytes low.
- `JMP FAR m16:16` rejected the instruction outright unless a segment override
  was present, rather than defaulting to DS.
- `SUB` and `SBB` computed OF, like AF before it, from the negated operand.
- `DAS` dropped the borrow out of its first adjustment, which belongs in CF.
- `83 /r` sign-extended its immediate into a negative JavaScript number rather
  than the 16-bit operand it represents, so CF was computed against the wrong
  range for every negative immediate. `ADD`/`SUB`/`CMP` on a word with a byte
  immediate is about as common as instructions get, and 42% of its vectors
  failed.
- `ENTER` decremented `this.instruction.level`, which is an undeclared field
  rather than the decoded instruction, so every nested-level `ENTER` threw.
  Behind that, it never allocated the frame: `ENTER imm16, imm8` ends with
  `SP = SP - imm16`, and the immediate was decoded and then unused.
- `IMUL` with an immediate recomputed CF and OF after the ALU had already set
  them, comparing a 32-bit product against a 16-bit sign extension of itself.
  The right answer was there and was being discarded.
- `0x82` was not decoded at all. It is an undocumented alias of `0x80`, the
  byte-operand ALU group with a byte immediate, and assemblers of the era
  emitted it. Two case labels, 2,000 vectors.
- `POPF` and `IRET` let the popped word set IOPL and NT. On the 286 in real
  mode the top four bits of FLAGS are always clear after a pop -- a divergence
  from the 8086, where they read as one -- and the existing ring-0 guard never
  fired because real mode reports CPL 0. Both now share a `loadFlags` path.
  The protected-mode half of that path is unverified: the published corpus is
  real mode only.
- FLAGS bit 1 is reserved and reads as one; the packed word omitted it, so
  `PUSHF` stored and `LAHF` loaded a value two low. Flag comparisons were
  unaffected, which is why it survived so long -- the oracle masks that bit out
  deliberately, since the core does not model it. Only instructions that
  _store_ the word rather than test it could see the difference.

The `DIV`/`IDIV` and `AAD` flag rules, and the `CALL SP` ordering, came from
the `machinery` reference implementation, which passes the same suite.
