import { FIRST_MEGABYTE, FIRST_MEGABYTE_SELECTORS } from '../win16/global-allocator.js';

/**
 * The DPMI host a Windows program finds behind INT 31h: standard mode's
 * DOSX.EXE, or 386 enhanced mode's WIN386 (`kb/topics/dpmi-functions.md`,
 * `kb/guides/enhanced-mode.md`). Each function is answered as the
 * machine's mode's host answers it; the Rust engine's `dpmi.rs` is its twin.
 *
 * Standard mode is DOSX's table, read out (`DOSX.EXE`, its image 200h into
 * the file; the protected-mode segment from image 38C2h, offsets below in
 * it): the dispatcher at 2B56h-2B86h walks the table at 2A80h (image
 * 6342h) of function numbers and handlers, and runs the handler with the
 * caller's registers in a frame (189Fh-18FEh; AX at [bp+12h], BX [bp+0Ch],
 * CX [bp+10h], DX [bp+0Eh], the flags [bp+14h], ES [bp+16h], DS
 * [bp+18h]). A handler answers through 2B92h, the carry cleared; 2B8Ch,
 * the carry set and AX as it was; or 2B87h, the carry set and AX nought.
 * Enhanced mode's answers are WIN386's as the probes recorded them
 * (`enhmode`, `dpmildt`, `dpmimem`, `dpmirm`, `dpmiexc`, `dpmigrw`,
 * `dpminul`, `dpmiout`, in `oracle/fixtures/enhanced/`): its dispatcher is
 * not read out, and a refusal there leaves AX as it was.
 */

/** 0400h: DOSX's answer (`DOSX.EXE` 2FC1h): version 0.90. **Recorded** by `dpmiver`. */
export const DPMI_VERSION = 0x005a;
export const DPMI_FLAGS = 0x000a;

/**
 * What 386 enhanced mode's host, WIN386, answers in BX for 0400h: 0005h,
 * bit 0 a 32-bit host and bit 2 virtual memory, where DOSX answers 000Ah;
 * AX, CL and DX as DOSX's, CH left. **Recorded** by `dpmiver` in
 * enhanced mode (`enhanced/dpmiver`).
 */
export const DPMI_FLAGS_ENHANCED = 0x0005;
export const DPMI_PROCESSOR = 4;
export const DPMI_PIC_BASES = 0x0870;

/**
 * The last byte DOSX's local descriptor table reaches: 000Bh and 000Ch
 * answer a selector whose index times eight is below it (`DOSX.EXE`
 * 2CA2h-2CB1h, `LSL` of the table's own selector). **Recorded** by
 * `dpmildt`: FFEFh the highest answered.
 */
export const DOSX_TABLE_LIMIT = 0xffef;

/**
 * WIN386's, as `dpmildt` found it in enhanced mode: 186Fh the highest
 * selector 000Bh answers. KERNEL grows the table as it runs short (not
 * followed); WinBox holds every selector to this one.
 */
export const WIN386_TABLE_LIMIT = 0x186f;

/**
 * DOSX's segment in conventional memory, where its real-mode code is and
 * its callbacks are: CX of 0303h, **recorded** by `dpmirm` (0A09h). WinBox
 * keeps the host's own code and stacks there, in the first megabyte below
 * where `GlobalDosAlloc` gives (`DOS_FIRST`).
 */
export const HOST_SEGMENT = 0x0a09;
const HOST_LINEAR = (FIRST_MEGABYTE + HOST_SEGMENT * 16) >>> 0;

/**
 * The host's code selector a handler returns to: DOSX gives an exception
 * handler E0h:140Ch to return to (`DOSX.EXE` 13FDh-1404h), **recorded** as
 * of privilege 0 by `dpmiexc`; WIN386's, of privilege 3, is not otherwise
 * recorded, and WinBox's is the same descriptor's with privilege 3. In the
 * global table, where WinBox keeps nothing else there.
 */
const HOST_CODE_INDEX = 0x1c;
const HOST_STACK_INDEX = 0x1d;
/** The global-table descriptors a call into real mode loads DS, ES, FS and GS with. */
const SCRATCH_INDICES = [0x10, 0x11, 0x12, 0x13];

/** Where in the host's code segment each stub is. */
const EXCEPTION_DEFAULTS = 0x1133; // + 3 * n: the handlers 0202h answers first (DOSX's table is at 1133h)
const EXCEPTION_RETURN = 0x140c; // where an exception handler returns (DOSX 13FDh)
const VECTOR_DEFAULTS = 0x2000; // + 4 * vector: INT vector; IRET, what 0204h answers first
const CALLBACK_RETURN = 0x2ee3; // where a callback's procedure returns (DOSX 2EE3h)
const REAL_CALL = 0x3100; // + 4 * depth: INT vector; INT 31h, a real-mode interrupt WinBox answers
const STATE_SAVE = 0x3200; // 0305h's routine in enhanced mode: RETF
const RAW_SWITCH = 0x3204; // 0306h's in enhanced mode: INT 31h, which WinBox does not follow

/** The host's protected-mode stack, its top, and the real-mode one's. */
const HOST_STACK_OFFSET = 0x4000;
const HOST_STACK_TOP = 0x2000;
const REAL_STACK_TOP = 0x7000;
/** What a callback finds as its return address on the real-mode stack. */
const REAL_RETURN = 0x0e40;

/**
 * DOSX's real-mode callbacks: 16, at 0E70h on and three bytes apart
 * (`DOSX.EXE` 2E00h-2E3Dh; the stubs at image 4A58h). The first was
 * **recorded** taken already (`dpmirm`: 0E73h first given, fifteen in all).
 */
const DOSX_CALLBACKS = 16;
const DOSX_CALLBACK_FIRST = 0x0e70;
const DOSX_CALLBACKS_TAKEN = 1;

/** WIN386's: in segment FF06h, from 0AB7h down by 10h, the last freed given first (`dpmirm`). */
const WIN386_CALLBACK_SEGMENT = 0xff06;
const WIN386_CALLBACK_FIRST = 0x0ab7;

/**
 * 0500h's twelve doublewords as `enhmode` found them, on DOSBox's 16 MB:
 * DOSX writes FFFFFFFFh to the buffer's 30h bytes, then the largest block,
 * the free pages twice and nought for the paging file (`DOSX.EXE`
 * 2F0Eh-2F52h); WIN386's figures, in enhanced mode, every field.
 */
const FREE_STANDARD = { largest: 0xe347e0, pages: 0xe34 };
const FREE_ENHANCED = [
  0x03868000, 0x3868, 0x0e7f, 0x39fc, 0x0e86, 0x0d80, 0x0f6d, 0x3869, 0x39fc, 0xffffffff,
  0xffffffff, 0xffffffff,
];

/** The text DOSX writes as Windows ends at a fault in its own code (`dpmigro`, `dpminul`). */
export const DOSX_FAULT = 'Standard Mode: Fault in MS-DOS Extender.';

/** The interrupts WinBox's DOS and BIOS answer, which 0300h can reach. */
const ANSWERED = new Set([0x12, 0x1a, 0x21, 0x2f]);

const INTERRUPT = 0x0200;
const TRAP = 0x0100;

type Context = {
  eax: number;
  ebx: number;
  ecx: number;
  edx: number;
  esi: number;
  edi: number;
  ebp: number;
  flags: number;
  ip: number;
  cs: number;
  ds: number;
  es: number;
  ss: number;
  sp: number;
  fs: number;
  gs: number;
};

/** A call into real mode in progress: what it returns to. */
type RealCall = {
  caller: Context;
  struct: number;
  stackIndex?: number;
  segments?: number[];
};

type Callback = { proc: [number, number]; struct: [number, number]; offset: number };

type Block = { index: number; count: number; size: number; base: number };

export class DPMI {
  declare _dos: any;
  declare _machine: any;

  /** Exception handlers set by 0203h, by number: [selector, offset]. */
  exceptions = new Map<number, [number, number]>();
  /** Protected-mode vectors set by 0205h. */
  vectors = new Map<number, [number, number]>();
  /** The real-mode callbacks given: standard mode's by slot, enhanced mode's by offset. */
  callbacks = new Map<number, Callback>();
  #freedCallbacks: number[] = [];
  #nextCallback = WIN386_CALLBACK_FIRST;
  /** The memory blocks 0501h gave, by handle. */
  blocks = new Map<number, Block>();
  /** The watchpoints 0B00h set, by handle. */
  watchpoints: (number | null)[] = [null, null, null, null];
  /** The descriptors given by 0002h and 000Dh, which DOSX keeps in its own part of the table. */
  #own = new Set<number>();
  /** The descriptors freed through 0001h and not given again, which WIN386 answers for no more. */
  #hostFreed = new Set<number>();
  /** Calls into real mode in progress, the latest last. */
  #calls: RealCall[] = [];
  /** The host stack's top under each exception or callback in progress. */
  #stackTops: number[] = [];
  #ready = false;
  /** The real-mode vectors of the interrupts WinBox answers, as the host first found them. */
  #answeredVectors = new Map<number, number>();

  constructor(dos) {
    this._dos = dos;
    this._machine = dos._machine;
  }

  get enhanced() {
    return this._machine.mode === 'enhanced';
  }

  get core() {
    return this._machine.cpu.core;
  }

  get memory() {
    return this._machine.memory;
  }

  /** KERNEL's list of selectors, which WinBox's is (`GlobalAllocator`). */
  get allocator() {
    return this._dos.win16?._globalAllocator;
  }

  /** The host's code selector, as a handler is given it. */
  get hostCode() {
    return (HOST_CODE_INDEX << 3) | (this.enhanced ? 3 : 0);
  }

  get hostStack() {
    return (HOST_STACK_INDEX << 3) | 3;
  }

  isHostCode(selector: number) {
    return (selector & 0xfff8) === HOST_CODE_INDEX << 3;
  }

  /**
   * Whether an `INT` at CS:IP is the host's call into real mode for 0300h,
   * which DOS answers alone; the host's vectors' own stubs go to WinBox's
   * answer as a program's `INT` does.
   */
  isRealCall(cs: number, ip: number) {
    return this.isHostCode(cs) && ip >= REAL_CALL && ip < REAL_CALL + 0x100;
  }

  // --- the machine's state ---

  #context(): Context {
    const core = this.core;

    return {
      eax: core.eax >>> 0,
      ebx: core.ebx >>> 0,
      ecx: core.ecx >>> 0,
      edx: core.edx >>> 0,
      esi: core.esi >>> 0,
      edi: core.edi >>> 0,
      ebp: core.ebp >>> 0,
      flags: core.f,
      ip: core.ip,
      cs: core.cs,
      ds: core.ds,
      es: core.es,
      ss: core.ss,
      sp: core.sp,
      fs: core.fs ?? 0,
      gs: core.gs ?? 0,
    };
  }

  #restore(context: Context) {
    const core = this.core;

    core.eax = context.eax;
    core.ebx = context.ebx;
    core.ecx = context.ecx;
    core.edx = context.edx;
    core.esi = context.esi;
    core.edi = context.edi;
    core.ebp = context.ebp;
    core.f = context.flags;
    core.ds = context.ds;
    core.es = context.es;
    if ('fs' in core) {
      core.fs = context.fs;
      core.gs = context.gs;
    }
    core.ss = context.ss;
    core.sp = context.sp;
    core.cs = context.cs;
    core.ip = context.ip;
  }

  /** A descriptor of the global table written, and forgotten where the processor keeps it. */
  #global(index: number, base: number, limit: number, access: number) {
    const at = this.core.gdtBase + index * 8;

    this.#describe(at, base, limit, access);
    this.#forget(index << 3);
  }

  #describe(at: number, base: number, limit: number, access: number) {
    const memory = this.memory;

    memory.write16(at, limit & 0xffff);
    memory.write16(at + 2, base & 0xffff);
    memory.write8(at + 4, (base >>> 16) & 0xff);
    memory.write8(at + 5, access);
    memory.write8(at + 6, (limit >>> 16) & 0x0f);
    memory.write8(at + 7, (base >>> 24) & 0xff);
  }

  #forget(selector: number) {
    const cache = this.core._translationCache;

    if (cache) {
      for (let rpl = 0; rpl < 8; rpl++) {
        cache[(selector & ~7) | rpl] = undefined;
      }
    }
  }

  /**
   * The host's code and stack, made as a program first needs them: its
   * stubs -- for each exception, `INT 31h`; for each vector, `INT n` and
   * `IRET`; where a handler returns, `INT 31h` -- in the first megabyte at
   * the host's segment, and two descriptors of the global table for them.
   */
  #host() {
    if (this.#ready) {
      return;
    }

    this.#ready = true;
    this.#global(HOST_CODE_INDEX, HOST_LINEAR, 0xffff, 0xfb);
    this.#global(HOST_STACK_INDEX, HOST_LINEAR + HOST_STACK_OFFSET, HOST_STACK_TOP - 1, 0xf3);

    const memory = this.memory;
    const code = (offset: number, bytes: number[]) =>
      bytes.forEach((byte, at) => memory.write8(HOST_LINEAR + offset + at, byte));

    for (let number = 0; number < 0x20; number++) {
      code(EXCEPTION_DEFAULTS + 3 * number, [0xcd, 0x31, 0x90]);
    }

    for (let vector = 0; vector < 0x100; vector++) {
      code(VECTOR_DEFAULTS + 4 * vector, [0xcd, vector, 0xcf, 0x90]);
    }

    code(EXCEPTION_RETURN, [0xcd, 0x31]);
    code(CALLBACK_RETURN, [0xcd, 0x31]);
    code(STATE_SAVE, [0xcb]);
    code(RAW_SWITCH, [0xcd, 0x31]);

    for (const vector of ANSWERED) {
      this.#answeredVectors.set(vector, memory.read32(FIRST_MEGABYTE + vector * 4) >>> 0);
    }
  }

  // --- the descriptors ---

  #entry(selector: number) {
    return this.core.ldtBase + (selector >> 3) * 8;
  }

  #used(index: number) {
    return !!this.allocator?.used(index);
  }

  /**
   * Whether WIN386 answers for a selector: of the local table, within it,
   * and not freed through 0001h (`dpmildt` in enhanced mode: nought, a
   * global selector, one freed and one past 186Fh refused). KERNEL holds
   * every other descriptor of the table, its free ones too. WinBox's
   * selectors for the first megabyte, at the top of its table, are within
   * Windows' (`kconst`: 227h-267h).
   */
  #valid(selector: number) {
    const index = selector >> 3;
    const firstMegabyte = FIRST_MEGABYTE_SELECTORS.some(([, each]) => each === index);

    return (
      (selector & 4) !== 0 &&
      index > 0 &&
      !this.#hostFreed.has(index) &&
      ((selector & 0xfff8) + 7 <= WIN386_TABLE_LIMIT || firstMegabyte)
    );
  }

  /** A descriptor's eight bytes written, as the processor will read them. */
  #write(selector: number, bytes: number[]) {
    const at = this.#entry(selector);

    bytes.forEach((byte, offset) => this.memory.write8(at + offset, byte & 0xff));
    this.#forget(selector);
  }

  /** A descriptor given out by the host. */
  #given(index: number) {
    this.allocator.claim(index);
    this.#hostFreed.delete(index);
  }

  #read(selector: number) {
    const at = this.#entry(selector);

    return Array.from({ length: 8 }, (_, offset) => this.memory.read8(at + offset));
  }

  /** A descriptor given out and written: data at nought, no limit, not yet accessed (F2h). */
  #fresh(index: number) {
    this.#given(index);
    this.#write(index << 3, [0, 0, 0, 0, 0, 0xf2, 0, 0]);
  }

  // --- answering ---

  #ok() {
    this.core.flags.carry = false;
    return true;
  }

  /** Refused: the carry set, AX the error where one is given, else as it was. */
  #refuse(ax?: number) {
    if (ax !== undefined) {
      this.core.ax = ax;
    }

    this.core.flags.carry = true;
    return true;
  }

  /**
   * Windows ends: DOSX faults in its own code, writes `DOSX_FAULT` and goes
   * back to DOS (`dpmigro`, `dpminul`; `dpmiout` stops DOSBox itself). No
   * task runs again, as none does on Windows.
   */
  #fault(why: string) {
    const win16 = this._dos.win16;

    this.hostFault = `${DOSX_FAULT} (${why})`;
    win16?.scheduler?.task?.end?.();
    win16?.scheduler?.stop?.();
    return false;
  }

  /** What ended Windows, where the host did. */
  declare hostFault: string | undefined;

  /**
   * INT 31h, or a stub of the host's reached: true where the task goes on.
   */
  invoke() {
    const core = this.core;

    if (this.isHostCode(core.cs)) {
      return this.#returned((core.ip - 2) & 0xffff);
    }

    const ax = core.ax;

    if (ax === 0x0400) {
      core.ax = DPMI_VERSION;
      core.bx = this.enhanced ? DPMI_FLAGS_ENHANCED : DPMI_FLAGS;
      core.cl = DPMI_PROCESSOR;
      core.dx = DPMI_PIC_BASES;
      return this.#ok();
    }

    return this.enhanced ? this.#win386(ax) : this.#dosx(ax);
  }

  /** DOSX's table (`DOSX.EXE` 2A80h, image 6342h). */
  #dosx(ax: number) {
    const core = this.core;

    switch (ax) {
      case 0x0000:
        return this.#allocate(core.cx);
      case 0x0001:
        return this.#freeDescriptor(core.bx);
      case 0x0002:
        return this.#segment(core.bx);
      case 0x0003:
        core.ax = 8; // 2C1Bh
        return this.#ok();
      case 0x0004:
      case 0x0005:
        return this.#ok(); // 2B9Bh: lock and unlock, nothing done
      case 0x0006:
        return this.#getBase(core.bx);
      case 0x0007:
        return this.#setBase(core.bx);
      case 0x0008:
        return this.#setLimit(core.bx);
      case 0x0009:
        return this.#setRights(core.bx);
      case 0x000a:
        return this.#alias(core.bx);
      case 0x000b:
      case 0x000c:
        return this.#descriptor(ax, core.bx);
      case 0x000d:
        return this.#specific(core.bx);
      case 0x0100:
        // 2CE7h: DOS gives nothing, KERNEL holding conventional memory.
        core.bx = 0;
        return this.#refuse(8);
      case 0x0101:
        // 2D26h: 24E1h frees it as a block; nought faults in DOSX (25ABh, 2734h).
        return core.dx === 0 ? this.#fault('0101h of nought') : this.#refuse();
      case 0x0102:
        core.bx = 0; // 2D34h
        return this.#refuse(8);
      case 0x0200:
      case 0x0201:
        return this.#realVector(core.al === 0, core.bl);
      case 0x0202:
      case 0x0203:
        return this.#exception(ax === 0x0202, core.bl, 0x10);
      case 0x0204:
      case 0x0205:
        return this.#vector(ax === 0x0204, core.bl);
      case 0x0300:
      case 0x0301:
      case 0x0302:
        return this.#realCall(ax);
      case 0x0303:
        return this.#allocateCallback();
      case 0x0304:
        return this.#freeCallback(core.cx, core.dx);
      case 0x0305:
      case 0x0306:
        return this.#refuse(0); // 2B87h
      case 0x0500:
        return this.#freeInformation();
      case 0x0501:
        return this.#allocateBlock();
      case 0x0502:
        return this.#freeBlock();
      case 0x0503:
        return this.#resizeBlock();
      case 0x0600:
      case 0x0601:
      case 0x0602:
      case 0x0603:
      case 0x0702:
      case 0x0703:
      case 0x0800:
        return this.#ok(); // 2B9Bh: nothing pages; 0800h's address already linear
      case 0x0604:
        core.bx = 0; // 2B9Dh
        core.cx = 0x1000;
        return this.#ok();
      case 0x0700:
      case 0x0701:
      case 0x0a00:
        return this.#refuse(0); // 2B87h
      case 0x0900:
      case 0x0901:
      case 0x0902:
        return this.#interruptState();
      case 0x0b00:
      case 0x0b01:
      case 0x0b02:
      case 0x0b03:
        return this.#watchpoint(ax);
      default:
        /* Not in the table: the dispatcher takes the word at 2B89h, inside
         * the refusing handler's first instruction, for a handler, 0012h,
         * DOSX's own start-up code (2B6Bh-2B86h). Under DOSBox, the
         * emulator itself stops (`dpmiout`). */
        return this.#fault(`function ${ax.toString(16).padStart(4, '0')}h`);
    }
  }

  /** WIN386's answers, as recorded. */
  #win386(ax: number) {
    const core = this.core;

    switch (ax) {
      case 0x0000:
        return this.#allocate(core.cx);
      case 0x0001:
        return this.#freeDescriptor(core.bx);
      case 0x0002:
        return this.#segment(core.bx);
      case 0x0003:
        core.ax = 8;
        return this.#ok();
      case 0x0004:
      case 0x0005:
        return this.#ok();
      case 0x0006:
        return this.#valid(core.bx) ? this.#getBase(core.bx) : this.#refuse();
      case 0x0007:
        return this.#valid(core.bx) ? this.#setBase(core.bx) : this.#refuse();
      case 0x0008: {
        const limit = ((core.cx << 16) | core.dx) >>> 0;

        if (!this.#valid(core.bx) || (limit > 0xfffff && (limit & 0xfff) !== 0xfff)) {
          return this.#refuse();
        }

        return this.#setLimit(core.bx);
      }
      case 0x0009:
        if (!this.#valid(core.bx) || !this.#fitRights(core.cl)) {
          return this.#refuse();
        }

        return this.#setRights(core.bx);
      case 0x000a:
        return this.#valid(core.bx) ? this.#alias(core.bx) : this.#refuse();
      case 0x000b:
      case 0x000c:
        return this.#descriptor(ax, core.bx);
      case 0x000d:
        return this.#specific(core.bx);
      case 0x0100:
        core.bx = 0;
        return this.#refuse(8);
      case 0x0101:
        return this.#refuse();
      case 0x0102:
        return this.#refuse(7);
      case 0x0200:
      case 0x0201:
        return this.#realVector(core.al === 0, core.bl);
      case 0x0202:
      case 0x0203:
        return this.#exception(ax === 0x0202, core.bl, 0x1f);
      case 0x0204:
      case 0x0205:
        return this.#vector(ax === 0x0204, core.bl);
      case 0x0300:
      case 0x0301:
      case 0x0302:
        return this.#realCall(ax);
      case 0x0303:
        return this.#allocateCallback();
      case 0x0304:
        return this.#freeCallback(core.cx, core.dx);
      case 0x0305:
        /* The state to save in 24h bytes (`enhmode`), and routines that save
         * it: WinBox has no real-mode state to save, and its own do
         * nothing. */
        this.#host();
        core.ax = 0x24;
        core.bx = HOST_SEGMENT;
        core.cx = STATE_SAVE;
        core.si = this.hostCode;
        core.di = STATE_SAVE;
        return this.#ok();
      case 0x0306:
        this.#host();
        core.bx = HOST_SEGMENT;
        core.cx = RAW_SWITCH;
        core.si = this.hostCode;
        core.di = RAW_SWITCH;
        return this.#ok();
      case 0x0500:
        return this.#freeInformation();
      case 0x0501:
        return this.#allocateBlock();
      case 0x0502:
        return this.#freeBlock();
      case 0x0503:
        return this.#resizeBlock();
      case 0x0600:
      case 0x0601:
      case 0x0602:
      case 0x0603:
      case 0x0702:
      case 0x0703:
        return this.#ok();
      case 0x0604:
        core.bx = 0;
        core.cx = 0x1000;
        return this.#ok();
      case 0x0800:
        // Memory under a megabyte is not mapped (`dpmimem`).
        return ((core.bx << 16) | core.cx) >>> 0 < 0x100000 ? this.#refuse() : this.#ok();
      case 0x0900:
      case 0x0901:
      case 0x0902:
        return this.#interruptState();
      case 0x0b00:
      case 0x0b01:
      case 0x0b02:
      case 0x0b03:
        return this.#watchpoint(ax);
      case 0x0e00:
      case 0x0e01:
        return this.#ok(); // answered (`enhmode`, `dpmiout`); AX not recorded
      default:
        // DPMI 1.0's and anything else (`enhmode`: 000Eh, 0210h, 0401h, 0504h).
        return this.#refuse();
    }
  }

  // --- 0000h-000Dh ---

  /**
   * 0000h: `count` descriptors, data at nought with no limit, not yet
   * accessed (`DOSX.EXE` 2BA9h-2BD6h, each written by 2146h): one the head
   * of the list of free ones (1FDFh), the last given back first
   * (**recorded**, `dpmildt`); more, a run of free ones (2002h). DOSX takes
   * nought for one, and then writes on through its whole table (2BD4h),
   * which WinBox does not follow. KERNEL's list is the one WinBox keeps.
   */
  #allocate(count: number) {
    const allocator = this.allocator;
    const index = count <= 1 ? allocator.take(1) : allocator.find(1, count);

    if (index < 0) {
      return this.#refuse(0);
    }

    for (let at = index; at < index + Math.max(count, 1); at++) {
      this.#fresh(at);
    }

    this.core.ax = (index << 3) | 7;
    return this.#ok();
  }

  /**
   * 0001h. DOSX (2BDAh-2C06h): a selector of the local table, given, its
   * access byte and byte 6 emptied (208Dh); one of the part DOSX keeps for
   * 0002h and 000Dh refused after that, AX as it was; else back on the
   * list. The caller's DS and ES nought where they held it. WIN386 frees
   * what it is given, and answers a selector freed already
   * (**recorded**, `dpmildt`).
   */
  #freeDescriptor(selector: number) {
    const index = selector >> 3;
    const core = this.core;

    if (!(selector & 4) || index === 0) {
      return this.#refuse();
    }

    if (this.enhanced && this.#hostFreed.has(index)) {
      return this.#ok();
    }

    if (!this.#used(index)) {
      return this.#refuse();
    }

    if (!this.enhanced && this.#own.has(index)) {
      const at = this.#entry(selector);

      this.memory.write16(at + 5, 0);
      this.#forget(selector);
      this.allocator.claim(index, false);
      this.#own.delete(index);
      return this.#refuse();
    }

    this.#own.delete(index);
    this.allocator.give(index);
    this.#hostFreed.add(index);

    if (!this.enhanced) {
      if ((core.ds & 0xfffc) === (selector & 0xfffc)) {
        core.ds = 0;
      }

      if ((core.es & 0xfffc) === (selector & 0xfffc)) {
        core.es = 0;
      }
    }

    return this.#ok();
  }

  /**
   * 0002h: a selector for a real-mode segment. DOSX (2C08h, 1F7Fh) answers
   * one of its own part of the table already for the segment -- its base
   * the segment's, its limit FFFFh, data not yet accessed or accessed
   * (20E7h) -- else makes one so (219Dh). KERNEL's selectors for the first
   * megabyte are such (**recorded**, `dpmildt`: 0040h's is `__0040H`).
   */
  #segment(paragraph: number) {
    const base = (FIRST_MEGABYTE + paragraph * 16) >>> 0;
    const candidates = [...FIRST_MEGABYTE_SELECTORS.map(([, index]) => index), ...this.#own];

    for (const index of candidates) {
      const bytes = this.#read(index << 3);
      const at = (bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[7] << 24)) >>> 0;

      if (
        this.#used(index) &&
        at === base &&
        bytes[0] === 0xff &&
        bytes[1] === 0xff &&
        ((bytes[5] ^ 0xf2) & 0xfe) === 0
      ) {
        this.core.ax = (index << 3) | 7;
        return this.#ok();
      }
    }

    const index = this.allocator.take(1);

    if (index < 0) {
      return this.#refuse();
    }

    this.#given(index);
    this.#own.add(index);
    this.#write(index << 3, [
      0xff,
      0xff,
      base & 0xff,
      (base >>> 8) & 0xff,
      (base >>> 16) & 0xff,
      0xf2,
      0,
      base >>> 24,
    ]);
    this.core.ax = (index << 3) | 7;
    return this.#ok();
  }

  /** 0006h: the base in CX:DX, from the table's entry as it is (2C23h, 1F23h). */
  #getBase(selector: number) {
    const bytes = this.#read(selector);

    this.core.cx = bytes[4] | (bytes[7] << 8);
    this.core.dx = bytes[2] | (bytes[3] << 8);
    return this.#ok();
  }

  /** 0007h: the base from CX:DX (2C31h, 1F3Dh). */
  #setBase(selector: number) {
    const at = this.#entry(selector);
    const { cx, dx } = this.core;

    this.memory.write16(at + 2, dx);
    this.memory.write8(at + 4, cx & 0xff);
    this.memory.write8(at + 7, cx >> 8);
    this.#forget(selector);
    return this.#ok();
  }

  /**
   * 0008h: the limit from CX:DX (2C3Bh-2C66h): byte 6 kept but its
   * granularity and the limit's top; past FFFFFh, the limit in pages and the
   * granularity bit set. Nothing is checked.
   */
  #setLimit(selector: number) {
    const at = this.#entry(selector);
    let { cx, dx } = this.core;
    let flags = this.memory.read8(at + 6) & 0x70;

    if (cx & 0xfff0) {
      dx = ((dx >>> 12) | (cx << 4)) & 0xffff;
      cx >>>= 12;
      flags |= 0x80;
    }

    this.memory.write16(at, dx);
    this.memory.write8(at + 6, flags | (cx & 0x0f));
    this.#forget(selector);
    return this.#ok();
  }

  /** WIN386's 0009h: a segment, not a system descriptor, of privilege 3 (`dpmildt`). */
  #fitRights(access: number) {
    return (access & 0x10) !== 0 && ((access >> 5) & 3) === 3;
  }

  /** 0009h: the access byte CL, byte 6's top CH's (2C69h, 1F57h). */
  #setRights(selector: number) {
    const at = this.#entry(selector);
    const { cl, ch } = this.core;

    this.memory.write8(at + 5, cl);
    this.memory.write8(at + 6, (this.memory.read8(at + 6) & 0x0f) | (ch & 0xf0));
    this.#forget(selector);
    return this.#ok();
  }

  /**
   * Whether `VERR` passes a selector at privilege 3, as DOSX's 000Ah asks
   * (2C73h): within its table, a segment, data or readable code, of
   * privilege 3 unless conforming.
   */
  #readable(selector: number) {
    const index = selector >> 3;

    if ((selector & 0xfffc) === 0 || !(selector & 4) || index * 8 + 7 > this.core.ldtLimit) {
      return false;
    }

    const access = this.#read(selector)[5];

    if (!(access & 0x10) || (access & 0x0a) === 0x08) {
      return false;
    }

    return (access & 0x0c) === 0x0c || ((access >> 5) & 3) === 3;
  }

  /**
   * 000Ah: a data descriptor for the same memory (2C71h-2C9Ch): the source
   * one `VERR` passes (WIN386 takes an execute-only one too), a descriptor
   * from the list, its bytes copied (2123h) and its type made data,
   * writable, not yet accessed, its presence and privilege kept.
   */
  #alias(selector: number) {
    if (!this.enhanced && !this.#readable(selector)) {
      return this.#refuse();
    }

    if ((selector & 0xfffc) === 0) {
      return this.#refuse();
    }

    const index = this.allocator.take(1);

    if (index < 0) {
      return this.#refuse();
    }

    const bytes = this.#read(selector);

    bytes[5] = (bytes[5] & 0xe0) | 0x12;
    this.#given(index);
    this.#write(index << 3, bytes);
    this.core.ax = (index << 3) | 7;
    return this.#ok();
  }

  /**
   * 000Bh and 000Ch: the eight bytes to and from ES:DI, for a selector
   * within the table (2CA2h-2CD7h; DOSX takes the table bit as set, and
   * selector nought for the table's first entry). WIN386 answers its own
   * selectors alone, and takes no system descriptor nor one of another
   * privilege than 3 (**recorded**, `dpmildt`).
   */
  #descriptor(ax: number, selector: number) {
    const core = this.core;

    if (this.enhanced ? !this.#valid(selector) : (selector & 0xfff8) >= DOSX_TABLE_LIMIT) {
      return this.#refuse();
    }

    const address = core.translateAddress(core.es, core.di);
    const memory = this.memory;

    if (ax === 0x000b) {
      this.#read(selector).forEach((byte, at) => memory.write8(address + at, byte));
      return this.#ok();
    }

    const bytes = Array.from({ length: 8 }, (_, at) => memory.read8(address + at));

    if (this.enhanced && !this.#fitRights(bytes[5])) {
      return this.#refuse();
    }

    this.#write(selector, bytes);
    return this.#ok();
  }

  /**
   * 000Dh: one of the table's first sixteen descriptors, free (1F9Eh):
   * DOSX marks it given with an access byte of 0Fh and keeps its other
   * bytes; WIN386 makes it data at nought (**recorded**, `dpmildt`).
   */
  #specific(selector: number) {
    const index = selector >> 3;

    if (!(selector & 4) || index === 0 || index > 0x0f || this.#used(index)) {
      return this.#refuse();
    }

    if (this.enhanced) {
      this.#fresh(index);
      return this.#ok();
    }

    this.#given(index);
    this.#own.add(index);
    this.memory.write8(this.#entry(selector) + 5, 0x0f);
    this.#forget(selector);
    return this.#ok();
  }

  // --- 0200h-0205h ---

  /**
   * 0200h and 0201h: a real-mode vector, CX:DX, in the first megabyte's
   * table. DOSX takes 50h-57h for 08h-0Fh (2D41h-2D4Eh), where it moved
   * the interrupt controller; WIN386 does not (`dpmirm`).
   */
  #realVector(get: boolean, vector: number) {
    const core = this.core;

    this.#host();
    const number = !this.enhanced && vector >= 0x50 && vector <= 0x57 ? vector - 0x48 : vector;
    const at = FIRST_MEGABYTE + number * 4;

    if (get) {
      core.dx = this.memory.read16(at);
      core.cx = this.memory.read16(at + 2);
    } else {
      this.memory.write16(at, core.dx);
      this.memory.write16(at + 2, core.cx);
    }

    return this.#ok();
  }

  /** An exception handler, or the host's own while none is set. */
  exceptionHandler(number: number): [number, number] {
    return this.exceptions.get(number) ?? [this.hostCode, EXCEPTION_DEFAULTS + 3 * number];
  }

  /** A protected-mode vector, or the host's own while none is set. */
  vectorHandler(vector: number): [number, number] {
    return this.vectors.get(vector) ?? [this.hostCode, VECTOR_DEFAULTS + 4 * vector];
  }

  /**
   * 0202h and 0203h: an exception's handler, CX:DX; DOSX keeps 0-10h
   * (2D75h, 1E8Ch, 1EA1h), WIN386 0-1Fh (`dpmiexc`).
   */
  #exception(get: boolean, number: number, most: number) {
    const core = this.core;

    if (number > most) {
      return this.#refuse();
    }

    this.#host();

    if (get) {
      [core.cx, core.dx] = this.exceptionHandler(number);
    } else if (this.isHostCode(core.cx) && core.dx === EXCEPTION_DEFAULTS + 3 * number) {
      this.exceptions.delete(number);
    } else {
      this.exceptions.set(number, [core.cx, core.dx]);
    }

    return this.#ok();
  }

  /** 0204h and 0205h: a protected-mode vector, CX:DX, any of 256 (2D98h, 1E30h, 1E57h). */
  #vector(get: boolean, vector: number) {
    const core = this.core;

    this.#host();

    if (get) {
      [core.cx, core.dx] = this.vectorHandler(vector);
    } else if (this.isHostCode(core.cx) && core.dx === VECTOR_DEFAULTS + 4 * vector) {
      this.vectors.delete(vector);
    } else {
      this.vectors.set(vector, [core.cx, core.dx]);
    }

    return this.#ok();
  }

  /** Whether the host takes a vector from the processor: a program's handler is set for it. */
  claims(vector: number) {
    return this.vectors.has(vector) || (vector < 0x20 && this.exceptions.has(vector));
  }

  /**
   * An interrupt or a fault, before WinBox's own handler for it: a
   * program's handler for it called, as the host calls it. True where it
   * was; undefined where WinBox's own takes it.
   */
  intercept(vector: number) {
    const cpu = this._machine.cpu;
    const core = this.core;
    const fault = cpu.interruptFault;

    if (fault && vector < 0x20 && this.exceptions.has(vector)) {
      /* From the instruction that faulted, as the processor restarts it. */
      core.cs = fault.cs ?? core.cs;
      core.ip = fault.ip ?? core.ip;
      this.#raise(vector, fault.code ?? 0);
      return true;
    }

    if (!fault && this.vectors.has(vector) && !this.isHostCode(core.cs)) {
      const [cs, ip] = this.vectors.get(vector)!;

      core.push16(core.f);
      core.push16(core.cs);
      core.push16(core.ip);
      core.cs = cs;
      core.ip = ip;
      return true;
    }

    return undefined;
  }

  /**
   * A fault given to the program's handler, as the host calls one: on the
   * host's stack, under a far return to the host, the error code, IP, CS,
   * the flags, SP and SS of the instruction that faulted (**recorded**,
   * `dpmiexc`: the frame the caller's, the stack another).
   */
  #raise(number: number, code: number) {
    const core = this.core;

    this.#host();

    const top = this.#stackTops.length
      ? this.#stackTops[this.#stackTops.length - 1]
      : HOST_STACK_TOP;
    const frame = [
      core.ss,
      core.sp,
      core.f,
      core.cs,
      core.ip,
      code,
      this.hostCode,
      EXCEPTION_RETURN,
    ];
    const [cs, ip] = this.exceptions.get(number)!;

    core.ss = this.hostStack;
    core.sp = top;

    for (const word of frame) {
      core.push16(word);
    }

    this.#stackTops.push(core.sp);
    core.cs = cs;
    core.ip = ip;
  }

  // --- the host's stubs ---

  /** A stub of the host's reached, by where its INT 31h is. */
  #returned(at: number) {
    const core = this.core;

    if (at === EXCEPTION_RETURN) {
      /* The handler has taken its return address: the frame left as it
       * left it, the faulting code goes on from it. */
      const frame = Array.from({ length: 6 }, () => core.pop16());

      this.#stackTops.pop();
      core.cs = frame[2];
      core.ip = frame[1];
      core.f = frame[3];
      core.ss = frame[5];
      core.sp = frame[4];
      return true;
    }

    if (at >= EXCEPTION_DEFAULTS && at < EXCEPTION_DEFAULTS + 3 * 0x20) {
      return this.#passedOn((at - EXCEPTION_DEFAULTS) / 3);
    }

    if (at === CALLBACK_RETURN) {
      return this.#callbackReturned();
    }

    if (at >= REAL_CALL && at < REAL_CALL + 0x100) {
      return this.#realReturned();
    }

    if (at === RAW_SWITCH) {
      throw new Error("DPMI: WIN386's raw mode switch, which WinBox does not follow");
    }

    throw new Error(`DPMI: the host's code reached at ${at.toString(16)}h`);
  }

  /**
   * A program's exception handler going on to the host's, with the frame
   * it was given: the fault taken as WinBox takes it with no handler of a
   * program's, from where the frame says it was.
   */
  #passedOn(number: number) {
    const core = this.core;
    const frame = Array.from({ length: 8 }, () => core.pop16());

    this.#stackTops.pop();
    core.cs = frame[4];
    core.ip = frame[3];
    core.f = frame[5];
    core.ss = frame[7];
    core.sp = frame[6];

    if (number === 0x0d) {
      return this._dos.win16?.applicationFault?.(0x0d) ?? false;
    }

    throw new Error(`DPMI: exception ${number.toString(16)}h passed on to the host`);
  }

  // --- 0300h-0304h ---

  /** The structure's words and doublewords, at its linear address. */
  #struct(at: number) {
    const memory = this.memory;
    const dword = (offset: number) => memory.read32(at + offset) >>> 0;
    const word = (offset: number) => memory.read16(at + offset);

    return {
      edi: dword(0x00),
      esi: dword(0x04),
      ebp: dword(0x08),
      ebx: dword(0x10),
      edx: dword(0x14),
      ecx: dword(0x18),
      eax: dword(0x1c),
      flags: word(0x20),
      es: word(0x22),
      ds: word(0x24),
      fs: word(0x26),
      gs: word(0x28),
      ip: word(0x2a),
      cs: word(0x2c),
      sp: word(0x2e),
      ss: word(0x30),
    };
  }

  /** The callback a real-mode address is, if it is one. */
  #callbackAt(segment: number, offset: number) {
    if (this.enhanced) {
      return segment === WIN386_CALLBACK_SEGMENT ? this.callbacks.get(offset) : undefined;
    }

    if (segment !== HOST_SEGMENT || offset < DOSX_CALLBACK_FIRST) {
      return undefined;
    }

    const slot = (offset - DOSX_CALLBACK_FIRST) / 3;

    return Number.isInteger(slot) ? this.callbacks.get(slot) : undefined;
  }

  /**
   * 0300h, 0301h and 0302h, with the structure at ES:DI (DOSX 2DB3h-2DFDh:
   * the structure and CX words of the caller's stack taken, real mode run
   * from them, the structure written back, the caller's flags the real
   * mode's but the carry, clear). WinBox runs no real-mode code: a call
   * reaches a callback of the program's, through its address or an
   * interrupt whose vector is one; or an interrupt WinBox's DOS or BIOS
   * answers, its vector as WinBox keeps it -- as the host first found it --
   * answered as from real mode.
   */
  #realCall(ax: number) {
    const core = this.core;
    const struct = core.translateAddress(core.es, core.di);
    const regs = this.#struct(struct);
    let target: [number, number];

    this.#host();

    if (ax === 0x0300) {
      const at = FIRST_MEGABYTE + core.bl * 4;

      target = [this.memory.read16(at + 2), this.memory.read16(at)];
    } else {
      target = [regs.cs, regs.ip];
    }

    const callback = this.#callbackAt(target[0], target[1]);

    if (callback) {
      return this.#callCallback(callback, struct, regs, ax !== 0x0301);
    }

    /* Its vector as WinBox keeps it: no program has set it since. */
    if (
      ax === 0x0300 &&
      ANSWERED.has(core.bl) &&
      ((target[0] << 16) | target[1]) >>> 0 === this.#answeredVectors.get(core.bl)
    ) {
      return this.#callAnswered(core.bl, struct, regs);
    }

    throw new Error(
      `DPMI: a call into real-mode code at ${target[0].toString(16)}:${target[1].toString(16)}, which WinBox does not run`
    );
  }

  /** The real-mode segments' bases, in descriptors of the global table, for an interrupt WinBox answers. */
  #callAnswered(vector: number, struct: number, regs: any) {
    const core = this.core;
    const caller = this.#context();
    const depth = this.#calls.length;
    const segments = [regs.es, regs.ds, regs.fs, regs.gs];

    this.#host();
    segments.forEach((paragraph, at) =>
      this.#global(SCRATCH_INDICES[at], FIRST_MEGABYTE + paragraph * 16, 0xffff, 0xf3)
    );
    this.#calls.push({ caller, struct, segments });

    const stub = REAL_CALL + 4 * depth;

    [0xcd, vector, 0xcd, 0x31].forEach((byte, at) =>
      this.memory.write8(HOST_LINEAR + stub + at, byte)
    );

    core.eax = regs.eax;
    core.ebx = regs.ebx;
    core.ecx = regs.ecx;
    core.edx = regs.edx;
    core.esi = regs.esi;
    core.edi = regs.edi;
    core.ebp = regs.ebp;
    core.f = (regs.flags & ~(INTERRUPT | TRAP)) | (caller.flags & (INTERRUPT | TRAP));
    core.es = (SCRATCH_INDICES[0] << 3) | 3;
    core.ds = (SCRATCH_INDICES[1] << 3) | 3;
    if ('fs' in core) {
      core.fs = (SCRATCH_INDICES[2] << 3) | 3;
      core.gs = (SCRATCH_INDICES[3] << 3) | 3;
    }
    core.ss = this.hostStack;
    core.sp = this.#stackTops.length ? this.#stackTops[this.#stackTops.length - 1] : HOST_STACK_TOP;
    core.cs = this.hostCode;
    core.ip = stub;
    return true;
  }

  /** A real-mode segment register's value again, from the selector WinBox answered with. */
  #paragraph(selector: number, scratch: number, given: number) {
    if ((selector & 0xfff8) === scratch << 3) {
      return given;
    }

    const base = this.core.translateAddress(selector, 0) - FIRST_MEGABYTE;

    return base >= 0 && base < 0x100000 ? (base >>> 4) & 0xffff : given;
  }

  /** The interrupt answered: its registers into the structure, the caller on. */
  #realReturned() {
    const call = this.#calls.pop()!;
    const core = this.core;
    const memory = this.memory;
    const at = call.struct;
    const [es, ds, fs, gs] = call.segments!;

    memory.write32(at + 0x00, core.edi);
    memory.write32(at + 0x04, core.esi);
    memory.write32(at + 0x08, core.ebp);
    memory.write32(at + 0x10, core.ebx);
    memory.write32(at + 0x14, core.edx);
    memory.write32(at + 0x18, core.ecx);
    memory.write32(at + 0x1c, core.eax);
    memory.write16(at + 0x20, core.f & 0xffff);
    memory.write16(at + 0x22, this.#paragraph(core.es, SCRATCH_INDICES[0], es));
    memory.write16(at + 0x24, this.#paragraph(core.ds, SCRATCH_INDICES[1], ds));
    if ('fs' in core) {
      memory.write16(at + 0x26, this.#paragraph(core.fs, SCRATCH_INDICES[2], fs));
      memory.write16(at + 0x28, this.#paragraph(core.gs, SCRATCH_INDICES[3], gs));
    }

    return this.#callerOn(call, memory.read16(at + 0x20));
  }

  /**
   * The caller of 0300h-0302h goes on after its INT 31h: its registers as
   * they were, its flags the real mode's, the carry clear, its interrupt
   * and trap flags kept (DOSX 2DE7h, 2B92h, 1932h-193Dh).
   */
  #callerOn(call: RealCall, flags: number) {
    this.#restore(call.caller);
    this.core.f = (flags & 0xbffe) | (call.caller.flags & (INTERRUPT | TRAP));
    return true;
  }

  /**
   * A callback called from real mode (DOSX 2E6Ch-2EE2h): the real-mode
   * registers into the structure given to 0303h, a selector for the
   * real-mode stack in DS and its offset in SI, the structure in ES:DI,
   * interrupts off (**recorded**, `dpmirm`), and the procedure called with
   * an interrupt's return to the host.
   */
  #callCallback(callback: Callback, struct: number, regs: any, interrupt: boolean) {
    const core = this.core;
    const memory = this.memory;
    const caller = this.#context();
    let ss = regs.ss;
    let sp = regs.sp;

    this.#host();

    if (ss === 0 && sp === 0) {
      ss = HOST_SEGMENT;
      sp = REAL_STACK_TOP - 0x40 * this.#calls.length;
    }

    const push = (word: number) => {
      sp = (sp - 2) & 0xffff;
      memory.write16(FIRST_MEGABYTE + ss * 16 + sp, word);
    };

    if (interrupt) {
      push(regs.flags);
    }

    push(HOST_SEGMENT);
    push(REAL_RETURN);

    const target = core.translateAddress(callback.struct[0], callback.struct[1]);
    const words: [number, number][] = [
      [0x00, regs.edi],
      [0x04, regs.esi],
      [0x08, regs.ebp],
      [0x10, regs.ebx],
      [0x14, regs.edx],
      [0x18, regs.ecx],
      [0x1c, regs.eax],
      [0x20, regs.flags],
      [0x22, regs.es],
      [0x24, regs.ds],
      [0x2e, sp],
      [0x30, ss],
    ];

    for (const [offset, value] of words) {
      memory.write16(target + offset, value & 0xffff);
    }

    const index = this.allocator.take(1);

    if (index < 0) {
      throw new Error("DPMI: no descriptor for a callback's real-mode stack");
    }

    this.allocator.claim(index);
    this.#write(index << 3, [
      0xff,
      0xff,
      (FIRST_MEGABYTE + ss * 16) & 0xff,
      ((FIRST_MEGABYTE + ss * 16) >>> 8) & 0xff,
      ((FIRST_MEGABYTE + ss * 16) >>> 16) & 0xff,
      0xf2,
      0,
      (FIRST_MEGABYTE + ss * 16) >>> 24,
    ]);
    this.#calls.push({ caller, struct, stackIndex: index });

    const top = this.#stackTops.length
      ? this.#stackTops[this.#stackTops.length - 1]
      : HOST_STACK_TOP;
    const flags = caller.flags & ~(INTERRUPT | TRAP);

    core.ss = this.hostStack;
    core.sp = top;
    core.push16(flags);
    core.push16(this.hostCode);
    core.push16(CALLBACK_RETURN);
    this.#stackTops.push(core.sp);
    core.f = flags;
    core.ds = (index << 3) | 7;
    core.si = sp;
    core.es = callback.struct[0];
    core.di = callback.struct[1];
    core.cs = callback.proc[0];
    core.ip = callback.proc[1];
    return true;
  }

  /**
   * The callback's procedure returned: its structure is what real mode
   * goes on with. Back at the return it was given, the real-mode call is
   * done, and its registers are the caller's structure's -- its CS:IP and
   * SS:SP as they were (DOSX 2EE3h-2F09h, 2DE6h-2DFDh).
   */
  #callbackReturned() {
    const call = this.#calls.pop()!;
    const memory = this.memory;
    /* ES:DI as the procedure returned, as DOSX copies from them (2EF4h-2F05h). */
    const from = this.core.translateAddress(this.core.es, this.core.di);
    const regs = this.#struct(from);

    this.#stackTops.pop();
    this.allocator.give(call.stackIndex!);

    if (regs.cs !== HOST_SEGMENT || regs.ip !== REAL_RETURN) {
      throw new Error(
        `DPMI: a callback returning to real-mode code at ${regs.cs.toString(16)}:${regs.ip.toString(16)}, which WinBox does not run`
      );
    }

    for (let offset = 0; offset < 0x2a; offset += 2) {
      memory.write16(call.struct + offset, memory.read16(from + offset));
    }

    return this.#callerOn(call, regs.flags);
  }

  /**
   * 0303h: a callback to DS:SI, with ES:DI its structure. DOSX's sixteen
   * (2E00h-2E3Dh): the first free, CX its segment, DX 0E70h and three
   * bytes a slot; WIN386's, in its own segment (`dpmirm`).
   */
  #allocateCallback() {
    const core = this.core;
    const callback: Callback = {
      proc: [core.ds, core.si],
      struct: [core.es, core.di],
      offset: 0,
    };

    if (this.enhanced) {
      const offset = this.#freedCallbacks.pop() ?? this.#nextCallback;

      if (offset === this.#nextCallback) {
        this.#nextCallback -= 0x10;
      }

      this.callbacks.set(offset, { ...callback, offset });
      core.cx = WIN386_CALLBACK_SEGMENT;
      core.dx = offset;
      return this.#ok();
    }

    for (let slot = DOSX_CALLBACKS_TAKEN; slot < DOSX_CALLBACKS; slot++) {
      if (!this.callbacks.has(slot)) {
        this.callbacks.set(slot, { ...callback, offset: DOSX_CALLBACK_FIRST + 3 * slot });
        core.cx = HOST_SEGMENT;
        core.dx = DOSX_CALLBACK_FIRST + 3 * slot;
        return this.#ok();
      }
    }

    return this.#refuse();
  }

  /**
   * 0304h. DOSX (2E40h-2E66h) takes a slot's address, whether or not it
   * was given; WIN386 one it gave (`dpmirm`).
   */
  #freeCallback(segment: number, offset: number) {
    if (this.enhanced) {
      if (segment !== WIN386_CALLBACK_SEGMENT || !this.callbacks.has(offset)) {
        return this.#refuse();
      }

      this.callbacks.delete(offset);
      this.#freedCallbacks.push(offset);
      return this.#ok();
    }

    const slot = Math.floor((offset - DOSX_CALLBACK_FIRST) / 3);

    if (segment !== HOST_SEGMENT || offset < DOSX_CALLBACK_FIRST || slot >= DOSX_CALLBACKS) {
      return this.#refuse();
    }

    this.callbacks.delete(slot);
    return this.#ok();
  }

  // --- 0500h-0503h ---

  /** 0500h: the free memory's figures at ES:DI. */
  #freeInformation() {
    const core = this.core;
    const at = core.translateAddress(core.es, core.di);
    const memory = this.memory;

    if (this.enhanced) {
      FREE_ENHANCED.forEach((value, index) => memory.write32(at + 4 * index, value));
    } else {
      for (let offset = 0; offset < 0x30; offset++) {
        memory.write8(at + offset, 0xff);
      }

      memory.write32(at + 0x00, FREE_STANDARD.largest);
      memory.write32(at + 0x14, FREE_STANDARD.pages);
      memory.write32(at + 0x1c, FREE_STANDARD.pages);
      memory.write32(at + 0x20, 0);
    }

    return this.#ok();
  }

  /**
   * 0501h: a block of BX:CX bytes. DOSX's (2F55h, 24F5h): after a header of
   * 10h bytes, nought bytes given too, with one descriptor for it, its
   * limit the size less one or FFFFh past 64 KiB, data not yet accessed,
   * whose selector is the handle in SI and DI (**recorded**, `dpmimem`).
   * WIN386's on a page, with no descriptor; nought refused. Either refuses
   * more than the largest block 0500h names. In WinBox a block is a run of
   * descriptors' 64 KiB.
   */
  #allocateBlock() {
    const core = this.core;
    const size = ((core.bx << 16) | core.cx) >>> 0;
    const largest = this.enhanced ? FREE_ENHANCED[0] : FREE_STANDARD.largest;

    if ((this.enhanced && size === 0) || size > largest) {
      return this.#refuse();
    }

    const header = this.enhanced ? 0 : 0x10;
    const count = Math.max(1, Math.ceil((size + header) / 0x10000));
    const index = this.allocator.find(1, count);

    if (index < 0) {
      return this.#refuse();
    }

    for (let at = index; at < index + count; at++) {
      this.allocator.claim(at);
    }

    const base = ((index << 16) + header) >>> 0;
    const block: Block = { index, count, size, base };
    let handle: number;

    if (this.enhanced) {
      /* WIN386's handles are its own (`dpmimem`: no selector); WinBox's,
       * the block's first index times eight in SI, a selector of no table. */
      handle = ((index << 3) << 16) >>> 0;
    } else {
      const limit = size === 0 || size > 0x10000 ? 0xffff : size - 1;

      this.#write(index << 3, [
        limit & 0xff,
        limit >> 8,
        base & 0xff,
        (base >>> 8) & 0xff,
        (base >>> 16) & 0xff,
        0xf2,
        0,
        base >>> 24,
      ]);
      handle = (((index << 3) | 7) * 0x10001) >>> 0;
    }

    this.blocks.set(handle, block);
    core.bx = base >>> 16;
    core.cx = base & 0xffff;
    core.si = handle >>> 16;
    core.di = handle & 0xffff;
    return this.#ok();
  }

  /** The block a handle names: DOSX's by SI alone. */
  #blockOf(): [number, Block | undefined] {
    const core = this.core;

    if (this.enhanced) {
      const handle = ((core.si << 16) | core.di) >>> 0;

      return [handle, this.blocks.get(handle)];
    }

    const handle = (core.si * 0x10001) >>> 0;

    return [handle, this.blocks.get(handle)];
  }

  #release(block: Block) {
    for (let at = block.index; at < block.index + block.count; at++) {
      if (this.enhanced || at !== block.index) {
        this.allocator.claim(at, false);
      } else {
        this.allocator.release(at);
      }
    }
  }

  /**
   * 0502h: the block freed (2F74h, 25ABh). DOSX given nought goes through
   * its arena from a header at nought and faults (2734h; **recorded**,
   * `dpminul`); an unknown handle is refused, AX as it was.
   */
  #freeBlock() {
    const core = this.core;

    if (!this.enhanced && core.si === 0) {
      return this.#fault('0502h of nought');
    }

    const [handle, block] = this.#blockOf();

    if (!block) {
      return this.#refuse();
    }

    this.#release(block);
    this.blocks.delete(handle);
    return this.#ok();
  }

  /**
   * 0503h: the block made BX:CX bytes. DOSX's 25E1h finds the block (2927h)
   * and asks 26C3h whether it grows in place; 26C3h pushes ES, CX, DX and
   * AX and pops but three, CX into ES, on every way out (2710h-2713h,
   * 2723h-2725h): a fault in DOSX for any size whose low word is no
   * selector, and a return to nowhere for one that is. **Recorded**,
   * `dpmigro` and `dpmigrw`: "Standard Mode: Fault in MS-DOS Extender",
   * EC the size's low word, and Windows ends. An unknown handle is
   * refused first. WIN386 moves a block that needs more pages and keeps one
   * that does not (`dpmimem`, `dpmigrw`).
   */
  #resizeBlock() {
    const core = this.core;
    const size = ((core.bx << 16) | core.cx) >>> 0;
    const [handle, block] = this.#blockOf();

    if (!this.enhanced) {
      if (core.si === 0 || block) {
        return this.#fault(`0503h, EC=${core.cx.toString(16).padStart(4, '0').toUpperCase()}`);
      }

      return this.#refuse();
    }

    if (!block || size === 0 || size > FREE_ENHANCED[0]) {
      return this.#refuse();
    }

    const pages = (bytes: number) => Math.ceil(bytes / 0x1000);

    if (pages(size) > pages(block.size)) {
      const count = Math.max(1, Math.ceil(size / 0x10000));
      const index = this.allocator.find(1, count);

      if (index < 0) {
        return this.#refuse();
      }

      for (let at = index; at < index + count; at++) {
        this.allocator.claim(at);
      }

      const base = (index << 16) >>> 0;

      for (let at = 0; at < Math.min(block.size, size); at++) {
        this.memory.write8(base + at, this.memory.read8(block.base + at));
      }
      this.#release(block);
      block.index = index;
      block.count = count;
      block.base = base;
    }

    block.size = size;
    this.blocks.set(handle, block);
    core.bx = block.base >>> 16;
    core.cx = block.base & 0xffff;
    return this.#ok();
  }

  // --- 0900h-0902h, 0B00h-0B03h ---

  /**
   * 0900h-0902h: AL the caller's interrupt flag. DOSX sets the flag asked
   * in the frame's (2FA1h-2FBEh), but its way back keeps the caller's own
   * interrupt flag where it was set (1932h-193Dh): both hosts leave it
   * (**recorded**, `dpmimem`).
   */
  #interruptState() {
    const core = this.core;

    core.al = core.flags.interruptEnable ? 1 : 0;
    return this.#ok();
  }

  /**
   * 0B00h-0B03h: four watchpoints, by the debug registers (DOSX
   * 3043h-322Bh): 0B00h takes BX:CX's address, DL bytes, 1, 2 or 4, and DH
   * the kind, 0 executing (one byte), 1 writing, 2 either; BX the first
   * free one's number. 0B01h frees one, 0B02h tells in AX whether it was
   * reached, 0B03h forgets that it was. Refused, AX as it was: a number
   * not given, a size or kind out of range, none free. DOSX's 0B02h tests
   * the debug status's bit the wrong way (31E9h-31F5h), and answers 1 for
   * a watchpoint never reached; WIN386 nought (`dpmimem`). WinBox's
   * processor has no debug registers: no watchpoint is ever reached.
   */
  #watchpoint(ax: number) {
    const core = this.core;

    if (ax === 0x0b00) {
      const kind = core.dh;
      const size = kind === 0 ? 1 : core.dl;

      if (![1, 2, 4].includes(size) || kind > 2) {
        return this.#refuse();
      }

      const free = this.watchpoints.indexOf(null);

      if (free < 0) {
        return this.#refuse();
      }

      this.watchpoints[free] = ((core.bx << 16) | core.cx) >>> 0;
      core.bx = free;
      return this.#ok();
    }

    const number = core.bx;

    if (number >= 4 || this.watchpoints[number] === null) {
      return this.#refuse();
    }

    if (ax === 0x0b01) {
      this.watchpoints[number] = null;
    } else if (ax === 0x0b02) {
      core.ax = this.enhanced ? 0 : 1;
    }

    return this.#ok();
  }
}
