/**
 * The contract between the Windows 3.1 HLE layer and whatever executes x86.
 *
 * WinBox is a high-level emulator: it does not emulate a PC. It emulates just
 * enough of a 286/386 to run a Win16 program's own code, and it takes control
 * whenever that program calls into the Windows API. Everything above this file
 * (`win16.ts`, the scheduler, every API implementation) is written against the
 * interfaces declared here, and nothing else. Anything that satisfies
 * {@link CpuCore} can be dropped in underneath: the interpreter in
 * `core/i286.ts` and `core/i386.ts` today, a WebAssembly core later.
 *
 * ## How control is taken
 *
 * `ModuleManager` synthesizes a real code segment for each Win16 module. Every
 * exported ordinal gets an eight byte slot holding:
 *
 * ```asm
 * INT 0x80          ; trap: CS identifies the module, IP identifies the ordinal
 * RETF imm16        ; pop the callee-cleaned arguments
 * ```
 *
 * A guest program far-calls those slots believing they are KERNEL, USER or
 * GDI. The trap hands control to `Win16#syscallInvoke`, which reads the
 * arguments straight off the guest stack and runs a JavaScript implementation
 * in their place.
 *
 * Offset 0 of the same segment holds the callback thunk, which lets the host
 * call *into* guest code (window procedures, dialog procedures, enumeration
 * callbacks) and trap the return:
 *
 * ```asm
 * CALLF seg:off     ; immediate patched by Scheduler#call before each use
 * INT 0x81          ; trap: the callback returned
 * ```
 *
 * ## The four invariants
 *
 * A replacement core must honour all of these. They are not obvious, and a
 * core that violates any one of them cannot run this HLE layer.
 *
 * 1. **Traps suspend execution at an instruction boundary.** `INT n` latches
 *    the vector via {@link CpuCoreHost.interrupt} and returns; it does *not*
 *    vector through the IVT or IDT. CS:IP is left pointing at the instruction
 *    after the `INT`, which is the `RETF` in the thunk. The host drains the
 *    latch between instructions and dispatches to a {@link TrapHandler}.
 *
 * 2. **A trap may suspend the guest for an arbitrary length of time.** API
 *    implementations are frequently `async` -- they await disk reads, font
 *    loading, or user input. A handler returning a `Promise` leaves the guest
 *    halted until it settles, which may be many frames later. A core that must
 *    run to completion, or that cannot be re-entered at the exact point it
 *    stopped, will not work here.
 *
 * 3. **Execution re-enters from the host.** `Scheduler#call` pushes the
 *    current {@link CpuState}, points CS:IP at the callback thunk, and resumes.
 *    The guest code it reaches may itself call the API, trap, suspend, and call
 *    back again. Host and guest frames interleave to arbitrary depth, so the
 *    core cannot assume a single linear instruction stream.
 *
 * 4. **Guest code is modified while it runs.** `Scheduler#call` patches the
 *    `CALLF` immediate in the callback thunk immediately before transferring
 *    control, so the same four bytes hold a different target on every call.
 *    A core that caches decoded instructions or compiles basic blocks *must*
 *    invalidate on writes to guest code. This is the constraint most likely to
 *    be missed by a recompiling core, and it will fail in a way that looks like
 *    a callback dispatching to the wrong window procedure.
 *
 * ## Direct state visibility
 *
 * Argument marshalling is not done through an ABI helper: `Win16#syscallInvoke`
 * reads `ss:sp` directly, walks structures with `translateAddress`, and pulls C
 * strings out of guest memory. Register and memory access therefore has to stay
 * cheap to reach from JavaScript. For a core backed by WebAssembly, that means
 * guest memory should live in the module's linear memory, with this interface
 * implemented as a thin view over it rather than as a copying boundary.
 *
 * ## Known gap
 *
 * {@link CpuState} does not currently capture FLAGS. The snapshot that
 * `Scheduler#call` takes before entering a callback, and restores afterwards,
 * therefore lets the callback's flag results leak back into the interrupted
 * code. This is survivable because flags are caller-saved by convention, but a
 * new core should carry flags in its state snapshot.
 */

/** A protected-mode selector, or a segment value when in real mode. */
export type Selector = number;

/** An address after segment translation, into the flat physical space. */
export type PhysicalAddress = number;

/** An x86 interrupt vector. The HLE layer claims 0x80 and 0x81. */
export type TrapVector = number;

/**
 * What a {@link TrapHandler} tells the scheduler to do with the halted guest.
 *
 * * `true` resumes immediately.
 * * A `Promise` resumes when it settles, if it resolves truthy.
 * * Anything else leaves the guest halted, and the handler takes on the
 *   responsibility of resuming it later. `Win16#syscallInvoke` returns `false`
 *   for this reason: it resumes from `Scheduler#interpretReturnValue` once the
 *   API implementation has produced a value to put in AX/DX.
 */
export type TrapDisposition = boolean | void | Promise<boolean>;

/** Handles a trapped interrupt vector. Registered on `Machine#interrupts`. */
export type TrapHandler = (data?: unknown) => TrapDisposition;

/** The decoded FLAGS register. */
export interface Flags {
  overflow: boolean;
  signed: boolean;
  parity: boolean;
  zero: boolean;
  auxiliaryCarry: boolean;
  carry: boolean;
  trap: boolean;
  direction: boolean;
  interruptEnable: boolean;
  nestedTask: boolean;
  iopl: number;
}

/**
 * A snapshot of execution state, taken so the host can re-enter guest code and
 * restore what it interrupted.
 *
 * The shape is core-specific -- the 16-bit core stores `ax` where the 32-bit
 * core stores `eax` -- so the host must treat this as opaque and only ever
 * round-trip it through the core instance that produced it.
 */
export interface CpuState {
  readonly [field: string]: unknown;
}

/**
 * What a core needs from its environment.
 *
 * The `CPU` wrapper in `cpu.ts` provides this today. A WebAssembly core would
 * be handed the same two things: somewhere to put memory, and somewhere to
 * report a trap.
 */
export interface CpuCoreHost {
  /** Physical memory, indexed by translated address. */
  readonly memory: unknown;

  /**
   * The pending trap vector, or `null`. The core sets this from `INT` and
   * returns; the host drains it between instructions. See invariant 1.
   */
  interrupt: TrapVector | null;
}

/**
 * The 16-bit execution surface, as implemented by the 286 core.
 *
 * Every member here is reached by the HLE layer or required to drive
 * execution. It is deliberately small: the goal is that a replacement core has
 * a short, checkable list of things to provide.
 */
export interface CpuCore16 {
  /* --- General registers --------------------------------------------- */

  ax: number;
  bx: number;
  cx: number;
  dx: number;
  si: number;
  di: number;
  bp: number;
  sp: number;
  ip: number;

  al: number;
  ah: number;
  bl: number;
  bh: number;
  cl: number;
  ch: number;
  dl: number;
  dh: number;

  /* --- Segment registers ---------------------------------------------- */

  cs: Selector;
  ds: Selector;
  es: Selector;
  ss: Selector;

  /* --- Flags ----------------------------------------------------------- */

  /** The packed FLAGS word. */
  f: number;

  /** FLAGS, decoded. Read by the HLE layer to report status back to callers. */
  readonly flags: Flags;

  /* --- Mode and descriptor tables -------------------------------------- */

  /** Machine Status Word. Bit 0 selects protected mode. */
  msw: number;

  gdtBase: number;
  gdtLimit: number;
  ldtBase: number;
  ldtLimit: number;
  idtBase: number;
  idtLimit: number;

  /** Current privilege level. */
  readonly cpl: number;

  /* --- Indexed register access ----------------------------------------- */

  /* Indices follow the ModR/M register encoding, so these are what a decoder
   * and the argument marshaller both use.
   */

  readRegister8(index: number): number;
  writeRegister8(index: number, value: number): void;
  readRegister16(index: number): number;
  writeRegister16(index: number, value: number): void;
  readSegmentRegister(index: number): Selector;
  writeSegmentRegister(index: number, value: Selector): void;

  /* --- Segmented memory access ------------------------------------------ */

  /** Resolves `selector:offset` through the descriptor tables. */
  translateAddress(selector: Selector, offset: number): PhysicalAddress;

  read8(selector: Selector, offset: number): number;
  read16(selector: Selector, offset: number, littleEndian?: boolean): number;
  readSigned8(selector: Selector, offset: number): number;
  readSigned16(selector: Selector, offset: number, littleEndian?: boolean): number;

  write8(selector: Selector, offset: number, value: number): void;
  write16(selector: Selector, offset: number, value: number, littleEndian?: boolean): void;

  /* --- Stack ------------------------------------------------------------ */

  push8(value: number): void;
  pop8(): number;
  push16(value: number): void;
  pop16(): number;

  /* --- Execution -------------------------------------------------------- */

  /** Decodes at CS:IP, advancing IP past the instruction. */
  decode(instruction: unknown): unknown;

  /** Executes a decoded instruction. May latch a trap; see invariant 1. */
  execute(instruction: unknown): unknown;

  /** Returns the core to power-on state. */
  reset(): void;

  /**
   * Execution state, for suspending and re-entering. See invariants 2 and 3,
   * and the note about FLAGS above.
   */
  state: CpuState;

  /** The memory this core reads and writes. */
  readonly memory: unknown;
}

/**
 * The full surface a replacement core must implement: 286 protected mode plus
 * the 386 enhanced mode additions.
 *
 * Windows 3.1 standard mode needs only {@link CpuCore16}, but most of the
 * software worth running assumes 386 enhanced mode, so this is the target.
 */
export interface CpuCore extends CpuCore16 {
  /* --- 32-bit general registers ----------------------------------------- */

  eax: number;
  ebx: number;
  ecx: number;
  edx: number;
  esi: number;
  edi: number;
  ebp: number;
  esp: number;
  eip: number;

  /* --- Additional segment registers -------------------------------------- */

  fs: Selector;
  gs: Selector;

  /* --- Control registers -------------------------------------------------- */

  cr0: number;
  cr1: number;
  cr2: number;
  cr3: number;

  /* --- 32-bit access ------------------------------------------------------ */

  readRegister32(index: number): number;
  writeRegister32(index: number, value: number): void;

  read32(selector: Selector, offset: number, littleEndian?: boolean): number;
  readSigned32(selector: Selector, offset: number, littleEndian?: boolean): number;
  write32(selector: Selector, offset: number, value: number, littleEndian?: boolean): void;

  push32(value: number): void;
  pop32(): number;
}
