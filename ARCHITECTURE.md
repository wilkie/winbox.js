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
- **The emulator suite is nondeterministic.** Tests draw operands from
  `Helper.randomInteger` with no seed, so the set of failures changes between
  runs and a failure cannot be reproduced from the report alone. `ALU #div16
should divide two negative numbers as unsigned` will pass or fail depending on
  the values drawn. Any accuracy work needs a seeded generator first, so a
  baseline means something and a regression is attributable.
