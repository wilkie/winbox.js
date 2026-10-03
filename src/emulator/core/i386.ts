'use strict';

import { I286 } from './i286.js';
import { InvalidInstruction, MemoryFault } from '../faults.js';
import { ALU } from '../alu.js';
import { X87 } from '../x87.js';
import { CpuCore } from '../cpu-core.js';

/**
 * This class represents the CPU emulation of an Intel 386.
 */
/** MOVS, CMPS, STOS, LODS and SCAS: see `executeString`. */
const STRINGS = new Set([0xa4, 0xa5, 0xa6, 0xa7, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf]);

/** One-byte opcodes the operand size does not change; see `execute`. */
const SIZELESS = new Set([
  0x00, 0x02, 0x04, 0x08, 0x0a, 0x0c, 0x10, 0x12, 0x14, 0x18, 0x1a, 0x1c, 0x20, 0x22, 0x24, 0x27,
  0x28, 0x2a, 0x2c, 0x2f, 0x30, 0x32, 0x34, 0x37, 0x38, 0x3a, 0x3c, 0x3f, 0x63, 0x70, 0x71, 0x72,
  0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f, 0x80, 0x82, 0x84,
  0x86, 0x88, 0x8a, 0x9b, 0x9e, 0x9f, 0xa0, 0xa2, 0xa8, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xc0, 0xc6, 0xd0, 0xd2, 0xd4, 0xd5, 0xd6, 0xd7, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe6, 0xeb,
  0xec, 0xee, 0xf5, 0xf6, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe,
]);

/**
 * Whether the LOCK prefix may come before an instruction: one that reads,
 * changes and writes back memory -- the ALU's forms with memory as their
 * destination, but for CMP; XCHG; NOT and NEG; INC and DEC; BTS, BTR and
 * BTC.
 */
function lockable(opcode: number, instruction: any) {
  if (instruction.offset === undefined) {
    return false;
  }

  const member = instruction.modifier;

  if (opcode < 0x40) {
    return (opcode & 0x7) <= 1 && (opcode & 0x38) !== 0x38;
  }

  switch (opcode) {
    case 0x80:
    case 0x81:
    case 0x82:
    case 0x83:
      return member !== 7;
    case 0x86:
    case 0x87:
    case 0x1ab:
    case 0x1b3:
    case 0x1bb:
      return true;
    case 0xf6:
    case 0xf7:
      return member === 2 || member === 3;
    case 0xfe:
    case 0xff:
      return member === 0 || member === 1;
    case 0x3ba:
      return member >= 5;
    default:
      return false;
  }
}

/** BT, BTS, BTR, BTC in both forms, and BSF and BSR: see `executeBits`. */
const BIT_OPCODES = new Set([0x1a3, 0x1ab, 0x1b3, 0x1bb, 0x3ba, 0x1bc, 0x1bd]);

export class I386 extends I286 implements CpuCore {
  declare _alu: any;
  declare _cr0: any;
  declare _cr1: any;
  declare _cr2: any;
  declare _cr3: any;
  declare _flags: any;
  declare _fpu: any;
  declare _ip: any;
  declare _memory: any;
  declare _registers: any;
  declare _segmentRegisters: any;
  declare _stackIndex: any;
  declare _stackTrace: any;
  declare _translationCache: any;
  declare static REGISTERS_G32: any;
  declare static REGISTERS_S: any;
  declare static REGISTER_EAX: any;
  declare static REGISTER_EBP: any;
  declare static REGISTER_EBX: any;
  declare static REGISTER_ECX: any;
  declare static REGISTER_EDI: any;
  declare static REGISTER_EDX: any;
  declare static REGISTER_ESI: any;
  declare static REGISTER_ESP: any;
  declare static REGISTER_FS: any;
  declare static REGISTER_GS: any;
  constructor(cpu, options = {}) {
    super(cpu, options);

    // Initialize the FPU co-processor
    this._fpu = new X87(this);

    // Extend the segment registers to account for FS and GS
    this._segmentRegisters.push(0);
    this._segmentRegisters.push(0);

    /* The last ten instructions' CS:IP, for a debugger: kept in two arrays
     * made once, as allocating a pair for every instruction cost time. */
    this._stackTrace = { cs: new Uint16Array(10), ip: new Uint32Array(10) };
    this._stackIndex = 0;
  }

  /**
   * Resets the CPU.
   */
  reset() {
    // Reset the 286 core as well
    super.reset();

    // i386 differences of i286 registers
    // MSW (cr0) is reset to 0 on the 386
    this.cr0 = 0;
  }

  /**
   * Retrieves the current privilege level.
   *
   * This is the first two bits of the current code segment (CS) value.
   */
  get cpl(): any {
    // Check for the Protection Enable bit
    if (this.cr0 & 0x1) {
      // If this is the case, we look at the GDT
      return 0x0;
    }

    // Otherwise we are already in ring 0
    return 0x0;
  }

  /**
   * Retrieves the register state.
   */
  get state(): any {
    return {
      cs: this.cs,
      ds: this.ds,
      es: this.es,
      ss: this.ss,
      fs: this.fs,
      gs: this.gs,
      eax: this.eax,
      ecx: this.ecx,
      edx: this.edx,
      ebx: this.ebx,
      esp: this.esp,
      ebp: this.ebp,
      esi: this.esi,
      edi: this.edi,
      ip: this.ip,
    };
  }

  set state(value: any) {
    this.cs = value.cs;
    this.ds = value.ds;
    this.es = value.es;
    this.ss = value.ss;
    this.fs = value.fs;
    this.gs = value.gs;
    this.eax = value.eax;
    this.ecx = value.ecx;
    this.edx = value.edx;
    this.ebx = value.ebx;
    this.esp = value.esp;
    this.ebp = value.ebp;
    this.esi = value.esi;
    this.edi = value.edi;
    this.ip = value.ip;
  }

  /**
   * Retrieves the current value of the EIP register.
   */
  get eip() {
    return this._ip;
  }

  /**
   * Sets the EIP register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set eip(value) {
    this._ip = value & 0xffffffff;
  }

  /**
   * Decodes the descriptor a selector names.
   *
   * A 386 descriptor is eight bytes, and every field the 286 defined stayed
   * where it was; the base and limit simply grew into the two bytes the 286
   * left reserved:
   *
   *   0-1  limit[15:0]
   *   2-3  base[15:0]
   *   4    base[23:16]
   *   5    P | DPL | S | type
   *   6    G | D/B | 0 | AVL | limit[19:16]
   *   7    base[31:24]
   *
   * The granularity bit scales the limit by 4 KiB. Every byte of the last page
   * is still addressable, so the low twelve bits come back set: a granular
   * limit of 1 covers offsets up to 0x1FFF, not up to 0x1000.
   *
   * Descriptors are cached on load rather than read per access, which is what
   * the part does -- editing a descriptor in the table has no effect until the
   * selector is loaded again.
   *
   * @param {number} segment - The selector to decode.
   * @returns {object} The descriptor it names.
   */
  retrieveDescriptor(segment) {
    const descriptor = this._translationCache[segment];
    if (descriptor) {
      return descriptor;
    }

    if (!(this.cr0 & 0x1)) {
      // Real mode: the selector is a paragraph number and a segment is 64 KiB.
      return {
        base: (segment & 0xffff) << 4,
        limit: 0xffff,
        lowLimit: 0,
        pastLimit: 0x10000,
        present: true,
        nullSelector: false,
        addressSize: false,
        dpl: 0,
        type: true,
        executable: false,
        growsDown: false,
        readWrite: true,
        accessed: true,
        flags: 0x93,
      };
    }

    if ((segment & 0xfffc) === 0) {
      /* The null selector loads without complaint -- it is how software parks
       * a segment register it is not using -- and faults on any attempt to
       * reach memory through it.
       */
      return {
        base: 0,
        limit: 0,
        lowLimit: 1,
        pastLimit: 0,
        present: false,
        nullSelector: true,
        addressSize: false,
        dpl: 0,
        type: true,
        executable: false,
        growsDown: false,
        readWrite: true,
        accessed: false,
        flags: 0x00,
      };
    }

    const local = (segment & 0x4) > 0;
    const index = segment >> 3;

    const tableBase = local ? this.ldtBase : this.gdtBase;
    const tableLimit = local ? this.ldtLimit : this.gdtLimit;

    /* A table limit is the offset of its last valid byte, so the last
     * descriptor that fits ends exactly on it.
     */
    if (index * 8 + 7 > tableLimit) {
      this.raiseInterrupt(this._instruction, 13, segment & 0xfffc);
      throw new MemoryFault();
    }

    const entry = tableBase + index * 8;

    let limit = this._memory.read16(entry);
    limit |= (this._memory.read8(entry + 6) & 0xf) << 16;

    let base = this._memory.read16(entry + 2);
    base |= this._memory.read8(entry + 4) << 16;
    base |= this._memory.read8(entry + 7) << 24;

    const access = this._memory.read8(entry + 5);
    const granularity = this._memory.read8(entry + 6);

    if (granularity & 0x80) {
      limit = (limit << 12) | 0xfff;
    }

    limit = limit >>> 0;

    /* Bit 2 only means expand-down in a data segment; in a code segment the
     * same bit says the segment is conforming.
     */
    const growsDown = (access & 0x1c) === 0x14;
    const present = (access & 0x80) > 0;

    /* The bounds every access is checked against, worked out once here so that
     * the check itself is two comparisons.
     *
     * An expand-down segment runs the other way: the limit is the last offset
     * *outside* it, and the segment reaches from there up to the top of
     * whichever address space the D/B bit selects. It is how a stack that grows
     * toward zero is given more room, by lowering its limit rather than raising
     * it.
     *
     * A segment that is not present gets bounds no offset can satisfy, so it
     * faults on use without needing a branch of its own.
     */
    let lowLimit = 0;
    let pastLimit = limit + 1;

    if (growsDown) {
      lowLimit = limit + 1;
      pastLimit = (granularity & 0x40 ? 0xffffffff : 0xffff) + 1;
    }

    if (!present) {
      lowLimit = 1;
      pastLimit = 0;
    }

    return {
      base: base >>> 0,
      limit: limit,
      lowLimit: lowLimit,
      pastLimit: pastLimit,
      present: present,
      nullSelector: false,
      addressSize: (granularity & 0x40) > 0,
      dpl: (access >> 5) & 0x3,
      type: (access & 0x10) > 0,
      executable: (access & 0x8) > 0,
      growsDown: growsDown,
      readWrite: (access & 0x2) > 0,
      accessed: (access & 0x1) > 0,
      flags: access,
      granularity: granularity,
    };
  }

  /**
   * A segment register loaded by an instruction, with the checks the part
   * makes as it loads one in protected mode: a data register takes the null
   * selector, or a data segment or readable code; anything else -- an empty
   * descriptor, a system one, code that cannot be read -- is `#GP` with the
   * selector, and a segment not present `#NP` (`#SS` for SS). SS takes only
   * writable data. A program that loads a selector that does not exist
   * faults here, as the `fault` probe's does on Windows.
   */
  loadSegmentRegister(index, value) {
    const selector = value & 0xffff;

    if (this.cr0 & 0x1 && index !== I386.REGISTER_CS) {
      const stack = index === I386.REGISTER_SS;

      if ((selector & 0xfffc) === 0) {
        if (stack) {
          this.raiseInterrupt(this._instruction, 13, 0);
          throw new MemoryFault();
        }
      } else {
        this._translationCache[selector] = undefined;

        const descriptor = this.retrieveDescriptor(selector);
        const unfit = stack
          ? !descriptor.type || descriptor.executable || !descriptor.readWrite
          : !descriptor.type || (descriptor.executable && !descriptor.readWrite);

        if (unfit) {
          this.raiseInterrupt(this._instruction, 13, selector & 0xfffc);
          throw new MemoryFault();
        }

        if (!descriptor.present) {
          this.raiseInterrupt(this._instruction, stack ? 12 : 11, selector & 0xfffc);
          throw new MemoryFault();
        }
      }
    }

    this.writeSegmentRegister(index, value);
  }

  /**
   * A selector's descriptor as the table holds it now, for `LAR`, `LSL`,
   * `VERR` and `VERW`, which report a selector they cannot use in the zero
   * flag instead of faulting: null for the null selector, or one past its
   * table's limit. The copy a segment register holds is not it -- a selector
   * freed since it was loaded is still loaded.
   */
  peekDescriptor(selector: number) {
    if (!(this.cr0 & 0x1) || (selector & 0xfffc) === 0) {
      return null;
    }

    const local = (selector & 0x4) > 0;
    const tableLimit = local ? this.ldtLimit : this.gdtLimit;

    if ((selector >> 3) * 8 + 7 > tableLimit) {
      return null;
    }

    const cached = this._translationCache[selector];

    this._translationCache[selector] = undefined;

    try {
      return this.retrieveDescriptor(selector);
    } finally {
      if (cached) {
        this._translationCache[selector] = cached;
      }
    }
  }

  /**
   * Raises the fault for an access that ran past its segment.
   *
   * Protected mode distinguishes cases real mode does not. A null selector is
   * `#GP(0)`; an access through `SS` is a stack fault rather than a general
   * protection fault; and a segment marked not present is `#NP`, though the
   * part raises that when the selector is loaded rather than when it is used,
   * which is a check we do not make yet.
   *
   * @param {number} segment - The selector the access was made through.
   */
  /**
   * Whether an access that faulted went through SS: the operand's own
   * segment register when the access is the operand's -- ES may hold what
   * SS does and still not be the stack -- and otherwise, a push or a pop,
   * by the selector.
   */
  throughStack(segment: number) {
    const operand = this._instruction;

    if (operand?.segmentName && operand.segment === segment) {
      return operand.segmentName === 'ss';
    }

    return segment === this.ss;
  }

  raiseSegmentFault(segment, offset?, size?) {
    let vector = 13;

    if (this.cr0 & 0x1) {
      const descriptor = this._translationCache[segment] ?? this.retrieveDescriptor(segment);

      if (!descriptor.present && !descriptor.nullSelector) {
        vector = 11;
      } else if (descriptor.present && this.throughStack(segment)) {
        vector = 12;
      }
    } else if (this.throughStack(segment)) {
      /* In real mode too, unlike the 286: an access through SS past its
       * limit is a stack fault (the 80386 suite's tests, which vector
       * through entry 12). */
      vector = 12;
    }

    this.raiseInterrupt(this._instruction, vector, 0);
    throw new MemoryFault(segment, offset, size);
  }

  get msw() {
    return this._cr0 & 0xffff;
  }

  set msw(value) {
    this._cr0 = (this.cr0 & 0xffff0000) | (value & 0xffff);
  }

  get cr0() {
    return this._cr0;
  }

  set cr0(value) {
    this._cr0 = value;
  }

  get cr1() {
    return this._cr1;
  }

  set cr1(value) {
    this._cr1 = value;
  }

  get cr2() {
    return this._cr2;
  }

  set cr2(value) {
    this._cr2 = value;
  }

  get cr3() {
    return this._cr3;
  }

  set cr3(value) {
    this._cr3 = value;
  }

  /**
   * Pushes a 32-bit value to the stack.
   */
  push32(value) {
    /* A 16-bit stack -- real mode's, or a segment without the B bit --
     * moves SP alone, wrapping within 64 KiB; the double word is one access
     * at SP, and one that runs past the limit is a stack fault (the 80386
     * suite's tests). */
    if (!this.stackIs32()) {
      const sp = (this.sp - 4) & 0xffff;

      this.write32(this.ss, sp, value);
      this.sp = sp;
      return;
    }

    this.esp -= 4;
    this.write32(this.ss, this.esp, value);
  }

  /** Whether the stack segment is 32-bit: its descriptor's B bit, in protected mode. */
  stackIs32() {
    return (
      (this.cr0 & 0x1) !== 0 &&
      !!(this._translationCache[this.ss] ?? this.retrieveDescriptor(this.ss)).addressSize
    );
  }

  /**
   * Pops a 32-bit value from the stack.
   */
  pop32() {
    if (!this.stackIs32()) {
      const sp = this.sp;
      const value = this.read32(this.ss, sp) >>> 0;

      this.sp = (sp + 4) & 0xffff;
      return value;
    }

    const ret = this.read32(this.ss, this.esp);
    this.esp = this.esp + 4;
    return ret;
  }

  /**
   * A segment register popped under the operand prefix: the part reads the
   * selector's word, and moves the stack by the double word.
   */
  popSelector32() {
    if (!this.stackIs32()) {
      const selector = this.read16(this.ss, this.sp);

      this.sp = (this.sp + 4) & 0xffff;
      return selector;
    }

    const selector = this.read16(this.ss, this.esp);

    this.esp = this.esp + 4;
    return selector;
  }

  /**
   * Reads the 32-bit register given by the register index.
   *
   * @param {number} index - The register index.
   *
   * @returns {number} The current register value.
   */
  readRegister32(index) {
    return this._registers[index];
  }

  /**
   * Writes an 8-bit value to the given register.
   *
   * @param {number} index - The register index.
   * @param {number} value - The value to write.
   */
  writeRegister8(index, value) {
    // Overrides to mask out the high-order bits
    let mask = 0xffffff00;
    value &= 0xff;

    if (index >= 4) {
      mask = 0xffff00ff;
      value <<= 8;
    }

    this._registers[index % 4] = ((this._registers[index % 4] & mask) >>> 0) | value;
  }

  /**
   * Write a 16-bit value to the given register.
   *
   * @param {number} index - The register index.
   * @param {number} value - The value to write.
   *
   * @returns {number} The current register value.
   */
  writeRegister16(index, value) {
    // Overrides to mask out the high-order bits
    value &= 0xffff;
    this._registers[index] = ((this._registers[index] & 0xffff0000) >>> 0) | value;
  }

  /**
   * Write a 32-bit value to the given register.
   *
   * @param {number} index - The register index.
   * @param {number} value - The value to write.
   *
   * @returns {number} The current register value.
   */
  writeRegister32(index, value) {
    value &= 0xffffffff;
    this._registers[index] = value >>> 0;
  }

  read32(segment, offset) {
    return this._memory.read32(this.translateAddress(segment, offset, 4));
  }

  readSigned32(segment, offset) {
    return this._memory.readSigned32(this.translateAddress(segment, offset, 4));
  }

  fetch32() {
    const at = this.codeAt(4);

    return at < 0 ? this.read32(this.cs, this.ip) : this._memory.read32(at);
  }

  fetchSigned32() {
    const at = this.codeAt(4);

    return at < 0 ? this.readSigned32(this.cs, this.ip) : this._memory.readSigned32(at);
  }

  write32(segment, offset, value) {
    return this._memory.write32(this.translateAddress(segment, offset, 4), value);
  }

  /**
   * Reads the 32-bit word operand value given in the instruction.
   *
   * This is referred to as 'ew' in the Intel CPU documentation. It requires
   * an operand override.
   *
   * @param {Object} instruction - The decoded instruction.
   *
   * @returns {number} The value.
   */
  readOperand32(instruction) {
    if (instruction.operandRegister !== undefined) {
      return this.readRegister32(instruction.operandRegister);
    }

    // Read 32-bit word from memory at the effective address
    return this.read32(instruction.segment, instruction.offset);
  }

  /**
   * Writes the 32-bit byte value to the operand given in the instruction.
   *
   * This is referred to as 'ew' in the Intel CPU documentation. It requires
   * an operand override.
   *
   * @param {Object} instruction - The decoded instruction.
   * @param {number} value - The value to write.
   */
  writeOperand32(instruction, value) {
    if (instruction.operandRegister !== undefined) {
      return this.writeRegister32(instruction.operandRegister, value);
    }

    // Write 32-bit word to memory at the effective address
    return this.write32(instruction.segment, instruction.offset, value);
  }

  /**
   * Retrieves the current value of the AX register.
   */
  get eax() {
    return this.readRegister32(I386.REGISTER_EAX);
  }

  /**
   * Sets the EAX register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set eax(value) {
    this.writeRegister32(I386.REGISTER_EAX, value);
  }

  /**
   * Retrieves the current value of the EBX register.
   */
  get ebx() {
    return this.readRegister32(I386.REGISTER_EBX);
  }

  /**
   * Sets the EBX register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set ebx(value) {
    this.writeRegister32(I386.REGISTER_EBX, value);
  }

  /**
   * Retrieves the current value of the ECX register.
   */
  get ecx() {
    return this.readRegister32(I386.REGISTER_ECX);
  }

  /**
   * Sets the ECX register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set ecx(value) {
    this.writeRegister32(I386.REGISTER_ECX, value);
  }

  /**
   * Retrieves the current value of the EDX register.
   */
  get edx() {
    return this.readRegister32(I386.REGISTER_EDX);
  }

  /**
   * Sets the EDX register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set edx(value) {
    this.writeRegister32(I386.REGISTER_EDX, value);
  }

  /**
   * Retrieves the current value of the ESP register.
   */
  get esp() {
    return this.readRegister32(I386.REGISTER_ESP);
  }

  /**
   * Sets the ESP register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set esp(value) {
    this.writeRegister32(I386.REGISTER_ESP, value);
  }

  /**
   * Retrieves the current value of the ESI register.
   */
  get esi() {
    return this.readRegister32(I386.REGISTER_ESI);
  }

  /**
   * Sets the ESI register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set esi(value) {
    this.writeRegister32(I386.REGISTER_ESI, value);
  }

  /**
   * Retrieves the current value of the EDI register.
   */
  get edi() {
    return this.readRegister32(I386.REGISTER_EDI);
  }

  /**
   * Sets the EDI register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set edi(value) {
    this.writeRegister32(I386.REGISTER_EDI, value);
  }

  /**
   * Retrieves the current value of the EBP register.
   */
  get ebp() {
    return this.readRegister32(I386.REGISTER_EBP);
  }

  /**
   * Sets the EBP register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set ebp(value) {
    this.writeRegister32(I386.REGISTER_EBP, value);
  }

  /**
   * Retrieves the current value of the FS register.
   */
  get fs() {
    return this.readSegmentRegister(I386.REGISTER_FS);
  }

  /**
   * Sets the FS register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set fs(value) {
    this.writeSegmentRegister(I386.REGISTER_FS, value);
  }

  /**
   * Retrieves the current value of the GS register.
   */
  get gs() {
    return this.readSegmentRegister(I386.REGISTER_GS);
  }

  /**
   * Sets the GS register to the given value.
   *
   * @param {number} value - The new value for this register.
   */
  set gs(value) {
    this.writeSegmentRegister(I386.REGISTER_GS, value);
  }

  /**
   * Reads the ModRM byte for decoding R-type instructions.
   */
  readModRM(instruction) {
    if (instruction.addressOverride) {
      // Read the 'ModRM' byte for a 32-bit address.
      // Then, it is followed by a possible immediate and displacement
      // field (via Intel docs.)
      const modRM = this.fetch8();
      this.ip++;

      // Top two bits are the 'mod' value.
      const mod = (modRM >> 6) & 0x3;

      // Middle three bits are the 'r' value.
      // (This could be an 'n' value depending on the opcode)
      // This picks a register.
      const r = (modRM >> 3) & 0x7;
      instruction.sourceRegister = r;
      instruction.modifier = r;

      // Bottom three bits are the 'r/m' value.
      // This could be a register if (mod == 3)
      // or indicate how the effective address is calculated.
      const rm = modRM & 0x7;

      // The displacement is 0 when the mod is 0 (except when r/m is 6)
      instruction.displacement = 0;

      let sib = undefined;
      if (mod != 3 && rm == 4) {
        // A SIB byte follows
        sib = this.fetch8();
        this.ip++;
      }

      /* A SIB byte whose base is 101b, with a mod of nought, has no base
       * register: a 32-bit displacement follows instead, as for r/m 101b.
       * Bubble Girl's engine jumps through a table so, `[ecx*2+disp32]`. */
      const noBase = sib !== undefined && mod == 0 && (sib & 0x7) == 5;

      if (noBase) {
        instruction.displacement = this.fetchSigned32();
        this.ip += 4;
      }

      // Read displacement
      // Displacement is 0 if (mod == 0)
      if (mod == 0 && rm == 5) {
        // In this particular case, the effective address is given
        // by the unsigned displacement and not computed.
        instruction.offset = this.fetch32();
        this.ip += 4;

        if (instruction.segment === undefined) {
          instruction.segment = this.ds;
          instruction.segmentName = 'ds';
        }
      } else if (mod == 1) {
        // When mod is 1, the displacement is 1 byte sign-extended.
        // disp8[REG] where REG is given by the r/m tag.
        instruction.displacement = this.fetchSigned8();
        this.ip++;
      } else if (mod == 2) {
        // When mod is 2, the displacement is a 32-bit value.
        // disp32[REG] where REG is given by the r/m tag.
        instruction.displacement = this.fetchSigned32();
        this.ip += 4;
      } else if (mod == 3) {
        // No displacement. The register is the destination.
        instruction.operandRegister = rm;
      }

      // Compute the effective address (if needed)
      if (instruction.offset === undefined && mod != 3) {
        /* The default segment is DS, or SS for an address based on ESP or
         * EBP, as for BP in 16-bit addressing. */
        if (instruction.segment === undefined) {
          const base = rm == 4 ? (noBase ? -1 : sib & 0x7) : rm;
          const stack = base == 4 || base == 5;

          instruction.segment = stack ? this.ss : this.ds;
          instruction.segmentName = stack ? 'ss' : 'ds';
        }

        switch (rm) {
          case 0: // EAX + DISP
            instruction.offset = this.eax + instruction.displacement;
            break;
          case 1: // ECX + DISP
            instruction.offset = this.ecx + instruction.displacement;
            break;
          case 2: // EDX + DISP
            instruction.offset = this.edx + instruction.displacement;
            break;
          case 3: // EBX + DISP
            instruction.offset = this.ebx + instruction.displacement;
            break;
          case 4: {
            // SIB + DISP
            const scale = 1 << (sib >> 6);
            const index = (sib >> 3) & 0x7;
            const base = sib & 0x7;

            const from = noBase ? 0 : this.readRegister32(base);

            /* POP to memory computes an address on ESP after the pop. */
            instruction.espBased = !noBase && base == 4;

            /* With no index, the 386 scales the base instead: the SIB
             * table's three rows for index 100b and a scale, which the
             * manuals list without comment, are what the part does (the
             * 80386 suite's tests). */
            if (index != 4) {
              instruction.offset =
                this.readRegister32(index) * scale + from + instruction.displacement;
            } else {
              instruction.offset = from * scale + instruction.displacement;
            }
            break;
          }
          case 5: // EBP + DISP
            instruction.offset = this.ebp + instruction.displacement;
            break;
          case 6: // ESI + DISP
            instruction.offset = this.esi + instruction.displacement;
            break;
          case 7: // EDI + DISP
            instruction.offset = this.edi + instruction.displacement;
            break;
        }

        /* A 32-bit address wraps at 4 GiB, not at 64 KiB: one past a
         * segment's limit faults (`translateAddress`). */
        instruction.offset = instruction.offset >>> 0;
      }
    } else {
      return super.readModRM(instruction);
    }
  }

  /**
   * Decodes the next instruction.
   */
  decode(instruction) {
    /* The instruction in flight, for a fault raised from inside an access
     * (see `I286.decode`). */
    this._instruction = instruction;

    if (
      instruction.segment === undefined &&
      !instruction.operandOverride &&
      !instruction.addressOverride
    ) {
      this._stackTrace.cs[this._stackIndex] = this.cs;
      this._stackTrace.ip[this._stackIndex] = this.ip;
      this._stackIndex = (this._stackIndex + 1) % 10;

      /* Built only when it is logged: a string every instruction cost 10 to
       * 15% of the core's speed (`pnpm bench`). */
      if (this._options.logInstructions) {
        this.debug(this.cs.toString(16) + ':' + this.ip.toString(16));
      }
    }

    /* The code segment's descriptor, for the instruction's bytes and for
     * whether it is 32-bit code. */
    this._code = this._translationCache[this.cs] ?? null;

    if (
      instruction.addressOverride === undefined &&
      (this._code ?? this.retrieveDescriptor(this.cs)).addressSize
    ) {
      this.debug('Address+Operand Override!!');
      instruction.addressOverride = true;
      instruction.operandOverride = true;
    }

    /* Where the instruction begins, prefixes included. Prefixes decode
     * recursively and each pass moves `ip` along, so this is captured once and
     * is what a fault pushes: the address a handler would restart from.
     */
    if (instruction.startIp === undefined) {
      instruction.startCs = this.cs;
      instruction.startIp = this.ip;
    }

    instruction.cs = this.cs;
    instruction.ip = this.ip;
    instruction.subOpcode = 0;

    // Read a 8-bit byte from memory at the current instruction pointer
    instruction.opcode = this.fetch8();
    this.ip++;

    // Decode possible two-byte opcodes
    switch (instruction.opcode) {
      /* MOV to and from a memory offset: 32 bits of it under the
       * address-size prefix. */
      case 0xa0:
      case 0xa1:
      case 0xa2:
      case 0xa3:
        if (instruction.addressOverride) {
          instruction.immediate = this.fetch32() >>> 0;
          this.ip += 4;
          return instruction;
        }
        break;

      case 0x64: // FS Override Prefix
        instruction.segment = this.fs;
        instruction.segmentName = 'fs';
        return this.decode(instruction);

      case 0x65: // GS Override Prefix
        instruction.segment = this.gs;
        instruction.segmentName = 'gs';
        return this.decode(instruction);

      case 0x0f: {
        // Possible near JMP
        // Read the next byte
        const subCode = this.fetch8();

        switch (subCode) {
          case 0xa4: // SHLD
            // Read 8-bit immediate
            instruction.opcode = 0x300;
            instruction.subOpcode = subCode;

            // Consume that byte
            this.ip++;
            break;

          case 0xac: // SHRD
            // Read 8-bit immediate
            instruction.opcode = 0x300;
            instruction.subOpcode = subCode;

            // Consume that byte
            this.ip++;
            break;

          case 0xba: // BT / BTS / BTR / BTC ew,db
            instruction.opcode = 0x300;
            instruction.subOpcode = subCode;
            this.ip++;
            break;

          case 0x90: // SETO eb
          case 0x91: // SETNO
          case 0x92: // SETB
          case 0x93: // SETAE
          case 0x94: // SETE
          case 0x95: // SETNE
          case 0x96: // SETBE
          case 0x97: // SETA
          case 0x98: // SETS
          case 0x99: // SETNS
          case 0x9a: // SETP
          case 0x9b: // SETNP
          case 0x9c: // SETL
          case 0x9d: // SETGE
          case 0x9e: // SETLE
          case 0x9f: // SETG
          case 0xa5: // SHLD ew,rw,CL
          case 0xad: // SHRD ew,rw,CL
            instruction.opcode = 0x100;
            instruction.subOpcode = subCode;
            this.ip++;
            break;

          case 0xa0: // PUSH FS
          case 0xa1: // POP FS
          case 0xa8: // PUSH GS
          case 0xa9: // POP GS
            instruction.opcode = 0x500;
            instruction.subOpcode = subCode;
            this.ip++;
            break;

          case 0xa3: // BT ew,rw
          case 0xab: // BTS ew,rw
          case 0xb3: // BTR ew,rw
          case 0xbb: // BTC ew,rw
          case 0xbc: // BSF rw,ew
          case 0xbd: // BSR rw,ew
            instruction.opcode = 0x100;
            instruction.subOpcode = subCode;
            this.ip++;
            break;

          case 0x80: // near JO
          case 0x81: // near JNO
          case 0x82: // near JB
          case 0x83: // near JAE
          case 0x84: // near JE
          case 0x85: // near JNE
          case 0x86: // near JNA
          case 0x87: // near JA
          case 0x88: // near JS
          case 0x89: // near JNS
          case 0x8a: // near JP
          case 0x8b: // near JPO
          case 0x8c: // near JL
          case 0x8d: // near JGE
          case 0x8e: // near JLE
          case 0x8f: // near JG
            // Read 16/32-bit immediate
            instruction.opcode = 0x400;
            instruction.subOpcode = subCode;

            // Consume that byte
            this.ip++;
            break;

          case 0x20: // MOV rw,crw
          case 0x22: // MOV crw,rw
          case 0xaf: // IMUL rw,mw
          case 0xb2: // LSS
          case 0xb4: // LFS
          case 0xb5: // LGS
          case 0xbe: // MOVSX mb/rw
          case 0xbf: // MOVSX mw/rw
          case 0xb6: // MOVZX mb/rw
          case 0xb7: // MOVZX mw/rw
            instruction.opcode = 0x100;
            instruction.subOpcode = subCode;

            // Consume that byte
            this.ip++;
            break;
        }

        break;
      }
    }

    if (instruction.operandOverride) {
      // Decode wide instructions using the operand prefix
      switch (instruction.opcode) {
        // Word argument instructions
        case 0x05: // ADD EAX,dw
        case 0x0d: // OR EAX,dw
        case 0x15: // ADC EAX,dw
        case 0x1d: // SBB EAX,dw (Integer Subtraction With Borrow)
        case 0x25: // AND EAX,dw
        case 0x2d: // SUB EAX,dw
        case 0x35: // XOR EAX,dw
        case 0x3d: // CMP EAX,dw
        case 0x68: // PUSH dw
        case 0xa9: // TEST EAX,dw
        case 0xb8: // MOV EAX,dw
        case 0xb9: // MOV ECX,dw
        case 0xba: // MOV EDX,dw
        case 0xbb: // MOV EBX,dw
        case 0xbc: // MOV ESP,dw
        case 0xbd: // MOV EBP,dw
        case 0xbe: // MOV ESI,dw
        case 0xbf: // MOV EDI,dw
        case 0xc2: // RET dw
        case 0xca: // RET far dw
        case 0xe8: // CALL cw
        case 0xe9: // JMP cw
          instruction.immediate = this.fetch32();
          this.ip += 4;
          break;

        // Double-word argument instructions
        case 0x9a: // CALL far cd
        case 0xea: // JMP far cd
          instruction.immediate = this.fetch32();
          this.ip += 4;

          instruction.targetCS = this.fetch16();
          this.ip += 2;
          break;

        /* The operand- and address-size prefixes switch from the code
         * segment's size; given again they change nothing, rather than
         * switching back -- Intel's manual has one prefix of each group as
         * all that is of use. (The 80386 suite repeats neither.) */
        case 0x66: // Operand Override
          if (!instruction.operandPrefixed) {
            instruction.operandPrefixed = true;
            instruction.operandOverride = !instruction.operandOverride;
          }
          instruction = this.decode(instruction);
          break;

        case 0x67: // Address-Size Override
          if (!instruction.addressPrefixed) {
            instruction.addressPrefixed = true;
            instruction.addressOverride = !instruction.addressOverride;
          }
          instruction = this.decode(instruction);
          break;

        /* F7h: TEST (/0, and its alias /1) takes a 32-bit immediate under the
         * operand prefix, which the 286's decode would read as 16 bits and
         * leave two bytes of to run as an instruction. The rest of the
         * group take none, and the 286's decode is right for them. */
        case 0xf7: {
          const reg = (this.fetch8() >> 3) & 7;

          if (reg > 1) {
            this.ip--;
            return super.decode(instruction);
          }

          instruction.subOpcode = 0xf7;
          instruction.opcode = 0x400;
          this.readModRM(instruction);
          instruction.immediate = this.fetch32();
          this.ip += 4;
          break;
        }

        // R-Type + 32-bit immediate
        case 0x69: // IMUL rw,ew,dw
        case 0x81: // ADC ew,dw / ADD ew,dw / AND ew,dw / CMP ew,dw /
        // OR ew,dw / SBB ew,dw / SUB ew,dw / XOR ew,dw
        case 0xc7: // MOV ew,dw
        case 0x400: // Special case for R-Type options of two-byte opcodes
          /* A near Jcc has no ModRM: its 32-bit displacement follows. */
          if (instruction.subOpcode < 0x80 || instruction.subOpcode > 0x8f) {
            this.readModRM(instruction);
          }

          instruction.immediate = this.fetch32();
          this.ip += 4;
          break;

        // R-Type, 8-bit immediate
        case 0x6b: // IMUL rw,db / IMUL rw,ew,db
        case 0x300: // Special cases
          this.readModRM(instruction);

          instruction.immediate = this.fetch8();
          this.ip++;
          break;

        case 0xff:
        case 0x100: // R-Type without immediate
          this.readModRM(instruction);
          break;

        case 0x500: // Two-byte, and nothing after
          break;

        case 0xd8:
        case 0xd9:
        case 0xda:
        case 0xdb:
        case 0xdc:
        case 0xdd:
        case 0xde:
        case 0xdf:
          // X87 instructions
          this.ip--;
          return this._fpu.decode(instruction);

        default:
          this.ip--;
          // Fall back to the i286 core
          return super.decode(instruction);
      }
    } else {
      switch (instruction.opcode) {
        case 0x400: // R-Type + 16-bit immediate
          // Read 16 signed immediate
          instruction.immediate = this.fetch16();
          this.ip += 2;
          break;

        case 0x200: // 8-bit immediate
          instruction.immediate = this.fetch8();
          this.ip++;
          break;

        case 0x500: // Two-byte, and nothing after
          break;

        /* A ModRM and an 8-bit immediate: BT's group and the double
         * shifts, without the operand prefix. */
        case 0x300:
          this.readModRM(instruction);
          instruction.immediate = this.fetch8();
          this.ip++;
          break;

        case 0x100: // R-Type without immediate
          this.readModRM(instruction);
          break;

        // As in the first table: given again, redundant.
        case 0x66: // Operand Override
          if (!instruction.operandPrefixed) {
            instruction.operandPrefixed = true;
            instruction.operandOverride = !instruction.operandOverride;
          }
          instruction = this.decode(instruction);
          break;

        case 0x67: // Address-Size Override
          if (!instruction.addressPrefixed) {
            instruction.addressPrefixed = true;
            instruction.addressOverride = !instruction.addressOverride;
          }
          instruction = this.decode(instruction);
          break;

        case 0xd8:
        case 0xd9:
        case 0xda:
        case 0xdb:
        case 0xdc:
        case 0xdd:
        case 0xde:
        case 0xdf:
          // X87 instructions
          this.ip--;
          return this._fpu.decode(instruction);

        default:
          this.ip--;

          // Fall back to the i286 core
          return super.decode(instruction);
      }
    }

    return instruction;
  }

  /**
   * Executes the instruction.
   */
  /**
   * A string instruction under the address-size prefix: ESI and EDI for its
   * addresses and ECX for its count, of bytes, words or, with the operand
   * prefix, double words. Each step leaves the registers where it took
   * them, so a fault part of the way through restarts from there.
   */
  executeString(instruction, opcode: number) {
    const width = (opcode & 1) === 0 ? 1 : instruction.operandOverride ? 4 : 2;
    const step = this._flags.direction ? -width : width;
    const source = instruction.segment ?? this.ds;
    const read = (segment: number, offset: number) =>
      width === 1
        ? this.read8(segment, offset)
        : width === 2
          ? this.read16(segment, offset)
          : this.read32(segment, offset) >>> 0;
    const write = (segment: number, offset: number, value: number) =>
      width === 1
        ? this.write8(segment, offset, value)
        : width === 2
          ? this.write16(segment, offset, value)
          : this.write32(segment, offset, value);
    const accumulator = () => (width === 1 ? this.al : width === 2 ? this.ax : this.eax >>> 0);
    const compare = (a: number, b: number) =>
      width === 1
        ? this._alu.sub8(a, b)
        : width === 2
          ? this._alu.sub16(a, b)
          : this._alu.sub32(a, b);
    const repeat = instruction.repeat;
    const compares = opcode === 0xa6 || opcode === 0xa7 || opcode === 0xae || opcode === 0xaf;

    while (!repeat || this.ecx >>> 0 !== 0) {
      const esi = this.esi >>> 0;
      const edi = this.edi >>> 0;

      switch (opcode) {
        case 0xa4:
        case 0xa5:
          write(this.es, edi, read(source, esi));
          this.esi = (esi + step) >>> 0;
          this.edi = (edi + step) >>> 0;
          break;
        case 0xa6:
        case 0xa7:
          compare(read(source, esi), read(this.es, edi));
          this.esi = (esi + step) >>> 0;
          this.edi = (edi + step) >>> 0;
          break;
        case 0xaa:
        case 0xab:
          write(this.es, edi, accumulator());
          this.edi = (edi + step) >>> 0;
          break;
        case 0xac:
        case 0xad: {
          const value = read(source, esi);

          if (width === 1) {
            this.al = value;
          } else if (width === 2) {
            this.ax = value;
          } else {
            this.eax = value;
          }

          this.esi = (esi + step) >>> 0;
          break;
        }
        default:
          // SCAS
          compare(accumulator(), read(this.es, edi));
          this.edi = (edi + step) >>> 0;
          break;
      }

      if (!repeat) {
        break;
      }

      this.ecx = ((this.ecx >>> 0) - 1) >>> 0;

      if (
        compares &&
        (instruction.repeatE ? !this._flags.zero : instruction.repeatNE && this._flags.zero)
      ) {
        break;
      }
    }
  }

  /** Whether a condition, 0 to 15 as a Jcc's or a SETcc's low nibble, holds. */
  holds(condition: number) {
    const f = this._flags;
    let result: boolean;

    switch (condition >> 1) {
      case 0:
        result = f.overflow;
        break;
      case 1:
        result = f.carry;
        break;
      case 2:
        result = f.zero;
        break;
      case 3:
        result = f.carry || f.zero;
        break;
      case 4:
        result = f.signed;
        break;
      case 5:
        result = f.parity;
        break;
      case 6:
        result = f.signed !== f.overflow;
        break;
      default:
        result = f.zero || f.signed !== f.overflow;
        break;
    }

    return condition & 1 ? !result : !!result;
  }

  /**
   * The 386's conditional sets, its near jumps with a 32-bit displacement,
   * FS and GS pushed and popped, and SHLD and SHRD by CL. Whether it was
   * one of them.
   */
  executeConditional(instruction, opcode: number) {
    const wide = !!instruction.operandOverride;

    if (opcode >= 0x190 && opcode <= 0x19f) {
      this.writeOperand8(instruction, this.holds(opcode & 0xf) ? 1 : 0);
      return true;
    }

    if (wide && opcode >= 0x480 && opcode <= 0x48f) {
      if (this.holds(opcode & 0xf)) {
        const target = (this.ip + instruction.immediate) >>> 0;

        /* Past CS's limit the jump is a general protection fault. */
        if (target > 0xffff) {
          this.raiseInterrupt(instruction, 13, 0);
          return true;
        }

        this.ip = target;
      }

      return true;
    }

    switch (opcode) {
      case 0x5a0: // PUSH FS
      case 0x5a8: // PUSH GS
        if (wide) {
          this.push32(opcode === 0x5a0 ? this.fs : this.gs);
        } else {
          this.push16(opcode === 0x5a0 ? this.fs : this.gs);
        }
        return true;

      case 0x5a1: // POP FS
      case 0x5a9: {
        // POP GS
        const selector = wide ? this.popSelector32() : this.pop16();

        if (opcode === 0x5a1) {
          this.fs = selector;
        } else {
          this.gs = selector;
        }
        return true;
      }

      case 0x1a5: // SHLD ew,rw,CL
      case 0x1ad: // SHRD ew,rw,CL
      case 0x3a4: // SHLD ew,rw,ib
      case 0x3ac: // SHRD ew,rw,ib
        this.executeDoubleShift(instruction, opcode, wide);
        return true;

      default:
        return false;
    }
  }

  /**
   * SHLD and SHRD: the operand shifted by a count modulo 32, the bits coming
   * in from the register. A count of nought changes nothing, flags included.
   */
  executeDoubleShift(instruction, opcode: number, wide: boolean) {
    const bits = wide ? 32 : 16;
    const count =
      ((opcode & 0xff) === 0xa5 || (opcode & 0xff) === 0xad ? this.cl : instruction.immediate) &
      0x1f;

    /* The operand is read whatever the count: a count of nought changes
     * nothing, but an operand past its segment's limit faults all the
     * same. */
    if (!count) {
      if (wide) {
        this.readOperand32(instruction);
      } else {
        this.readOperand16(instruction);
      }

      return;
    }

    const left = (opcode & 0xff) === 0xa4 || (opcode & 0xff) === 0xa5;
    const size = BigInt(bits);
    const mask = (1n << size) - 1n;
    const destination = BigInt(
      wide ? this.readOperand32(instruction) >>> 0 : this.readOperand16(instruction)
    );
    const source = BigInt(
      wide
        ? this.readRegister32(instruction.sourceRegister) >>> 0
        : this.readRegister16(instruction.sourceRegister)
    );
    const shift = BigInt(count);
    let result: bigint;
    let carry: boolean;

    /* The part shifts three operands' worth -- the destination and the
     * source twice -- so that a 16-bit count past 16 goes on into the
     * source again: SHLD's result is then the source rotated left by the
     * count less 16 (the 80386 suite's tests). For the 32-bit forms the
     * count never passes the width. */
    if (left) {
      const triple = (destination << (size * 2n)) | (source << size) | source;

      result = ((triple << shift) >> (size * 2n)) & mask;
      carry = ((triple >> (size * 3n - shift)) & 1n) === 1n;
    } else {
      const triple = (source << (size * 2n)) | (source << size) | destination;

      result = (triple >> shift) & mask;
      carry = ((triple >> (shift - 1n)) & 1n) === 1n;
    }

    const value = Number(result);
    const sign = wide ? 0x80000000 : 0x8000;
    const before = Number(destination);

    if (wide) {
      this.writeOperand32(instruction, value >>> 0);
    } else {
      this.writeOperand16(instruction, value & 0xffff);
    }

    this._flags.carry = carry;
    this._flags.zero = value === 0;
    this._flags.signed = (value & sign) !== 0;
    this._flags.parity = ALU.PARITY[value & 0xff];
    /* The sign changed, as for a shift of one. */
    this._flags.overflow = ((value ^ before) & sign) !== 0;
  }

  /**
   * Instructions whose double-word forms, under the operand prefix, the
   * decode and execute tables below do not have: a segment register pushed
   * or popped as a double word, DEC of a double-word register, XCHG, LEA,
   * POP to memory, PUSHFD and POPFD, LES and LDS of a 32-bit offset, and
   * LEAVE. Whether it was one of them.
   */
  executeWide(instruction, opcode: number) {
    switch (opcode) {
      case 0x06: // PUSH ES
      case 0x0e: // PUSH CS
      case 0x16: // PUSH SS
      case 0x1e: // PUSH DS
        this.push32(this.readSegmentRegister((opcode >> 3) & 3));
        return true;

      case 0x07: // POP ES
        this.es = this.popSelector32();
        return true;

      case 0x17: // POP SS
        this.ss = this.popSelector32();
        return true;

      case 0x1f: // POP DS
        this.ds = this.popSelector32();
        return true;

      case 0x48: // DEC EAX
      case 0x49:
      case 0x4a:
      case 0x4b:
      case 0x4c:
      case 0x4d:
      case 0x4e:
      case 0x4f: {
        const register = opcode - 0x48;

        this.writeRegister32(register, this._alu.dec32(this.readRegister32(register)));
        return true;
      }

      case 0x87: {
        // XCHG ed,rd
        const held = this.readOperand32(instruction);

        this.writeOperand32(instruction, this.readRegister32(instruction.sourceRegister));
        this.writeRegister32(instruction.sourceRegister, held);
        return true;
      }

      case 0x8d: // LEA rd
        if (instruction.offset === undefined) {
          this.raiseUndefinedOpcode(instruction);
          return true;
        }

        this.writeRegister32(instruction.sourceRegister, instruction.offset >>> 0);
        return true;

      case 0x8f: // POP md
        this.popToMemory(instruction, 4);
        return true;

      case 0x60: {
        // PUSHAD
        const esp = this.esp >>> 0;

        for (const register of [0, 1, 2, 3]) {
          this.push32(this.readRegister32(register));
        }

        this.push32(esp);

        for (const register of [5, 6, 7]) {
          this.push32(this.readRegister32(register));
        }

        return true;
      }

      case 0x61: {
        // POPAD: ESP's slot popped and passed over
        for (const register of [7, 6, 5]) {
          this.writeRegister32(register, this.pop32());
        }

        /* ESP's slot is passed over, but for its upper half, which the part
         * takes when the stack is 16-bit and moves SP alone. */
        const slot = this.pop32();

        if (!this.stackIs32()) {
          this.esp = ((slot & 0xffff0000) | this.sp) >>> 0;
        }

        for (const register of [3, 2, 1, 0]) {
          this.writeRegister32(register, this.pop32());
        }

        return true;
      }

      case 0x6a: // PUSH db, sign-extended to a double word
        this.push32(((instruction.immediate << 24) >> 24) >>> 0);
        return true;

      case 0x8c:
        /* A segment register to a register is zero-extended to its double
         * word; to memory, a word is written. */
        if (instruction.modifier > 5) {
          this.raiseUndefinedOpcode(instruction);
        } else if (instruction.operandRegister !== undefined) {
          this.writeRegister32(
            instruction.operandRegister,
            this.readSegmentRegister(instruction.modifier) & 0xffff
          );
        } else {
          this.writeOperand16(instruction, this.readSegmentRegister(instruction.modifier));
        }
        return true;

      case 0x9c: // PUSHFD
        this.push32(this.f & 0xffff);
        return true;

      case 0x9d: // POPFD
        this.loadFlags(this.pop32() & 0xffff);
        return true;

      case 0xc4: // LES rd,m16:32
      case 0xc5: {
        // LDS rd,m16:32
        if (instruction.offset === undefined) {
          this.raiseUndefinedOpcode(instruction);
          return true;
        }

        const offset = this.read32(instruction.segment, instruction.offset);
        const selector = this.read16(instruction.segment, instruction.offset + 4);

        if (opcode == 0xc4) {
          this.es = selector;
        } else {
          this.ds = selector;
        }

        this.writeRegister32(instruction.sourceRegister, offset);
        return true;
      }

      case 0xc8:
        // ENTER dw,db with double words
        this.executeEnter(instruction, 4);
        return true;

      case 0xcf: {
        // IRETD
        /* Read before any is taken: an EIP past CS's limit is a general
         * protection fault with the stack as it was (the 80386 suite's
         * tests). */
        const wide32 = this.stackIs32();
        const top = wide32 ? this.esp >>> 0 : this.sp;
        const at = (step: number) => (wide32 ? (top + step) >>> 0 : (top + step) & 0xffff);
        const eip = this.read32(this.ss, at(0)) >>> 0;
        const selector = this.read32(this.ss, at(4)) & 0xffff;
        const flags = this.read32(this.ss, at(8)) & 0xffff;

        if (eip > 0xffff) {
          this.raiseInterrupt(instruction, 13, 0);
          return true;
        }

        if (wide32) {
          this.esp = at(12);
        } else {
          this.sp = at(12);
        }

        this.ip = eip;
        this.cs = selector;
        this.loadFlags(flags);
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * ENTER: the frame pointer pushed, the enclosing frames' pointers copied
   * -- read, all of them, before anything is pushed, so that one that
   * cannot be read faults with the stack as it was (the 80386 suite's
   * tests) -- the new frame's pointer, and room for the locals. On a
   * 16-bit stack the whole of EBP takes the frame, under the operand
   * prefix.
   */
  executeEnter(instruction, size: number) {
    const level = instruction.level & 0x1f;
    const wide32 = this.stackIs32();
    const base = wide32 ? this.ebp >>> 0 : this.bp;
    const displays: number[] = [];

    for (let display = 1; display < level; display++) {
      const at = wide32 ? (base - display * size) >>> 0 : (base - display * size) & 0xffff;

      displays.push(size === 4 ? this.read32(this.ss, at) >>> 0 : this.read16(this.ss, at));
    }

    /* Pushed through a stack pointer of its own, committed at the end:
     * a push that faults -- a double word across the top of a 16-bit
     * stack -- leaves SP and BP as they were (the 80386 suite's tests). */
    let top = wide32 ? this.esp >>> 0 : this.sp;
    const push = (value: number) => {
      top = wide32 ? (top - size) >>> 0 : (top - size) & 0xffff;

      if (size === 4) {
        this.write32(this.ss, top, value);
      } else {
        this.write16(this.ss, top, value);
      }
    };

    push(size === 4 ? this.readRegister32(I386.REGISTER_EBP) : this.bp);

    const frame = top;

    for (const value of displays) {
      push(value);
    }

    if (level > 0) {
      push(frame);
    }

    if (size === 4) {
      this.writeRegister32(I386.REGISTER_EBP, frame);
    } else {
      this.bp = frame;
    }

    if (wide32) {
      this.esp = (top - instruction.immediate) >>> 0;
    } else {
      this.sp = (top - instruction.immediate) & 0xffff;
    }
  }

  /**
   * POP to memory: an undefined opcode for any register field but 0; and
   * an address based on ESP computed with ESP as the pop leaves it, as the
   * part does it.
   */
  popToMemory(instruction, size: number) {
    if (instruction.modifier != 0) {
      this.raiseUndefinedOpcode(instruction);
      return;
    }

    /* Read, written, and only then taken off the stack: a destination that
     * faults leaves the stack as it was. */
    const wide32 = this.stackIs32();
    const top = wide32 ? this.esp >>> 0 : this.sp;
    const value = size === 4 ? this.read32(this.ss, top) >>> 0 : this.read16(this.ss, top);
    const after = wide32 ? (top + size) >>> 0 : (top + size) & 0xffff;

    if (instruction.espBased) {
      instruction.offset = (instruction.offset + size) >>> 0;

      if (!instruction.addressOverride) {
        instruction.offset &= 0xffff;
      }
    }

    const commit = () => {
      if (wide32) {
        this.esp = after;
      } else {
        this.sp = after;
      }
    };

    /* To a register the stack moves first, so that POP SP takes the value
     * popped; to memory, last. */
    if (instruction.operandRegister !== undefined) {
      commit();
    }

    if (size === 4) {
      this.writeOperand32(instruction, value);
    } else {
      this.writeOperand16(instruction, value);
    }

    if (instruction.operandRegister === undefined) {
      commit();
    }
  }

  /**
   * BOUND: an index checked against a pair of bounds in memory, signed; out
   * of them, the bound range exception, 5. A register for the bounds is an
   * undefined opcode.
   */
  executeBound(instruction) {
    if (instruction.offset === undefined) {
      this.raiseUndefinedOpcode(instruction);
      return;
    }

    const wide = !!instruction.operandOverride;
    const index = wide
      ? this.readRegister32(instruction.sourceRegister) | 0
      : (this.readRegister16(instruction.sourceRegister) << 16) >> 16;
    const lower = wide
      ? this.read32(instruction.segment, instruction.offset) | 0
      : (this.read16(instruction.segment, instruction.offset) << 16) >> 16;
    const upper = wide
      ? this.read32(instruction.segment, instruction.offset + 4) | 0
      : (this.read16(instruction.segment, instruction.offset + 2) << 16) >> 16;

    if (index < lower || index > upper) {
      this.raiseInterrupt(instruction, 5);
    }
  }

  /**
   * The 386's bit instructions, of a word or, with the operand prefix, a
   * double word: BT, BTS, BTR and BTC test a bit into CF and leave it,
   * set it, clear it or turn it over; BSF and BSR find the lowest or the
   * highest bit set, ZF set when there is none and the register then left
   * as it was. A bit number in a register reaches past a memory operand,
   * whole words or double words at a time, and signed; an immediate one,
   * and any one on a register, is taken modulo the operand's size.
   */
  executeBits(instruction, opcode: number) {
    const wide = !!instruction.operandOverride;
    const bits = wide ? 32 : 16;
    const read = () => (wide ? this.readOperand32(instruction) : this.readOperand16(instruction));

    if (opcode === 0x1bc || opcode === 0x1bd) {
      const value = read() >>> 0;

      this._flags.zero = value === 0;

      if (value) {
        const index = opcode === 0x1bc ? 31 - Math.clz32(value & -value) : 31 - Math.clz32(value);

        if (wide) {
          this.writeRegister32(instruction.sourceRegister, index);
        } else {
          this.writeRegister16(instruction.sourceRegister, index);
        }
      }

      return;
    }

    const kind =
      opcode === 0x3ba ? instruction.modifier - 4 : [0x1a3, 0x1ab, 0x1b3, 0x1bb].indexOf(opcode);
    let bit: number;

    if (opcode === 0x3ba) {
      bit = instruction.immediate & (bits - 1);
    } else {
      const number = wide
        ? this.readRegister32(instruction.sourceRegister) | 0
        : (this.readRegister16(instruction.sourceRegister) << 16) >> 16;

      bit = number & (bits - 1);

      if (instruction.operandRegister === undefined) {
        const step = Math.floor(number / bits) * (bits / 8);
        const mask = instruction.addressOverride ? 0xffffffff : 0xffff;

        instruction.offset = ((instruction.offset + step) & mask) >>> 0;
      }
    }

    if (kind < 0 || kind > 3) {
      return;
    }

    const value = read() >>> 0;
    const mask = (1 << bit) >>> 0;

    this._flags.carry = (value & mask) !== 0;

    if (kind === 0) {
      return;
    }

    const result = (kind === 1 ? value | mask : kind === 2 ? value & ~mask : value ^ mask) >>> 0;

    if (wide) {
      this.writeOperand32(instruction, result);
    } else {
      this.writeOperand16(instruction, result & 0xffff);
    }
  }

  execute(instruction) {
    // Get the internal opcode
    const opcode = instruction.opcode | instruction.subOpcode;

    /* LOCK only on a read-modify-write of memory; anywhere else it is an
     * undefined opcode (the 80386 suite's tests). */
    if (instruction.lock && !lockable(opcode, instruction)) {
      this.raiseUndefinedOpcode(instruction);
      return;
    }

    if (BIT_OPCODES.has(opcode)) {
      this.executeBits(instruction, opcode);
      return;
    }

    if (instruction.operandOverride) {
      /* The operand size does not change what these do: byte operands,
       * AL, short jumps, the flags, the loops (which the address size
       * governs). Under the prefix they are what they are without it. */
      if (SIZELESS.has(opcode)) {
        instruction.operandOverride = false;
      } else if (this.executeWide(instruction, opcode)) {
        return;
      }
    }

    if (opcode === 0x62) {
      this.executeBound(instruction);
      return;
    }

    /* SALC: AL all ones for a carry, nought otherwise. */
    if (opcode === 0xd6) {
      this.al = this._flags.carry ? 0xff : 0;
      return;
    }

    if (opcode === 0xc8 && !instruction.operandOverride) {
      this.executeEnter(instruction, 2);
      return;
    }

    /* MOV of an immediate has register field 0 alone, and MOV from a
     * segment register six of them: anything else is an undefined opcode. */
    if (
      ((opcode === 0xc6 || opcode === 0xc7) && instruction.modifier !== 0) ||
      (opcode === 0x8c && instruction.modifier > 5)
    ) {
      this.raiseUndefinedOpcode(instruction);
      return;
    }

    /* LEAVE reads the saved frame pointer before it moves the stack: one
     * that cannot be read faults with SP as it was. */
    if (opcode === 0xc9) {
      const wide32 = this.stackIs32();
      const frame = wide32 ? this.ebp >>> 0 : this.bp;
      const saved = instruction.operandOverride
        ? this.read32(this.ss, frame) >>> 0
        : this.read16(this.ss, frame);
      const size = instruction.operandOverride ? 4 : 2;

      if (wide32) {
        this.esp = (frame + size) >>> 0;
      } else {
        this.sp = (frame + size) & 0xffff;
      }

      if (instruction.operandOverride) {
        this.writeRegister32(I386.REGISTER_EBP, saved);
      } else {
        this.bp = saved;
      }
      return;
    }

    /* RETD and RETFD read what they return to first: an EIP past CS's
     * limit is a general protection fault with the stack as it was. */
    if (
      instruction.operandOverride &&
      (opcode === 0xc2 || opcode === 0xc3 || opcode === 0xca || opcode === 0xcb)
    ) {
      const wide32 = this.stackIs32();
      const top = wide32 ? this.esp >>> 0 : this.sp;
      const at = (step: number) => (wide32 ? (top + step) >>> 0 : (top + step) & 0xffff);
      const far = opcode === 0xca || opcode === 0xcb;
      const eip = this.read32(this.ss, at(0)) >>> 0;
      const selector = far ? this.read32(this.ss, at(4)) & 0xffff : 0;

      if (eip > 0xffff) {
        this.raiseInterrupt(instruction, 13, 0);
        return;
      }

      const release =
        (far ? 8 : 4) + (opcode === 0xc2 || opcode === 0xca ? instruction.immediate & 0xffff : 0);

      if (wide32) {
        this.esp = (top + release) >>> 0;
      } else {
        this.sp = (top + release) & 0xffff;
      }

      this.ip = eip;

      if (far) {
        this.cs = selector;
      }
      return;
    }

    if (opcode === 0x8f && !instruction.operandOverride) {
      this.popToMemory(instruction, 2);
      return;
    }

    if (instruction.addressOverride && STRINGS.has(opcode)) {
      this.executeString(instruction, opcode);
      return;
    }

    if (this.executeConditional(instruction, opcode)) {
      return;
    }

    /* XCHG EAX with a double-word register; with EAX itself, 90h, a NOP --
     * which Bubble Girl's engine pads its code with under the prefix. */
    if (instruction.operandOverride && opcode >= 0x90 && opcode <= 0x97) {
      const other = opcode - 0x90;
      const eax = this.readRegister32(0);

      this.writeRegister32(0, this.readRegister32(other));
      this.writeRegister32(other, eax);
      return;
    }

    // Some placeholder values
    let operation = null;
    let shiftAmount = null;

    // Execute the opcode
    if (instruction.operandOverride) {
      // Decode wide instructions using the operand prefix
      switch (opcode) {
        case 0x01: // ADD ew,rw
          operation = operation || this._alu.add32.bind(this._alu);
        case 0x09: // OR ew,rw
          operation = operation || this._alu.or32.bind(this._alu);
        case 0x11: // ADC ew,rw
          operation = operation || this._alu.adc32.bind(this._alu);
        case 0x19: // SBB ew,rw (Integer Subtraction With Borrow)
          operation = operation || this._alu.sbb32.bind(this._alu);
        case 0x21: // AND ew,rw
          operation = operation || this._alu.and32.bind(this._alu);
        case 0x29: // SUB ew,rw
          operation = operation || this._alu.sub32.bind(this._alu);
        case 0x31: // XOR ew,rw
          operation = operation || this._alu.xor32.bind(this._alu);

          this.debug(
            [
              ['add', 'adc', 'and', 'xor'],
              ['or ', 'sbb', 'sub', 'unk'],
            ][(opcode & 0xf) == 0x9 ? 1 : 0][opcode >> 4] + '32 ew,rw'
          );

          this.writeOperand32(
            instruction,
            operation(
              this.readOperand32(instruction),
              this.readRegister32(instruction.sourceRegister)
            )
          );
          break;

        case 0x03: // ADD rw,ew
          operation = operation || this._alu.add32.bind(this._alu);
        case 0x0b: // OR rw,ew
          operation = operation || this._alu.or32.bind(this._alu);
        case 0x13: // ADC rw,ew
          operation = operation || this._alu.adc32.bind(this._alu);
        case 0x1b: // SBB rw,ew (Integer Subtraction With Borrow)
          operation = operation || this._alu.sbb32.bind(this._alu);
        case 0x23: // AND rw,ew
          operation = operation || this._alu.and32.bind(this._alu);
        case 0x2b: // SUB rw,ew
          operation = operation || this._alu.sub32.bind(this._alu);
        case 0x33: // XOR rw,ew
          operation = operation || this._alu.xor32.bind(this._alu);

          this.debug(
            [
              ['add', 'adc', 'and', 'xor'],
              ['or ', 'sbb', 'sub', 'unk'],
            ][(opcode & 0xf) == 0xb ? 1 : 0][opcode >> 4] + '32 rw,ew'
          );

          this.writeRegister32(
            instruction.sourceRegister,
            operation(
              this.readRegister32(instruction.sourceRegister),
              this.readOperand32(instruction)
            )
          );
          break;

        case 0x05: // ADD EAX,dw
          operation = operation || this._alu.add32.bind(this._alu);
        case 0x0d: // OR EAX,dw
          operation = operation || this._alu.or32.bind(this._alu);
        case 0x15: // ADC EAX,dw
          operation = operation || this._alu.adc32.bind(this._alu);
        case 0x1d: // SBB EAX,dw (Integer Subtraction With Borrow)
          operation = operation || this._alu.sbb32.bind(this._alu);
        case 0x25: // AND EAX,dw
          operation = operation || this._alu.and32.bind(this._alu);
        case 0x2d: // SUB EAX,dw
          operation = operation || this._alu.sub32.bind(this._alu);
        case 0x35: // XOR EAX,dw
          operation = operation || this._alu.xor32.bind(this._alu);

          //console.log([['add', 'adc', 'and', 'xor'],
          //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0xd ? 1 : 0][opcode >> 4] + '   EAX,dw');

          this.writeRegister32(
            I386.REGISTER_EAX,
            operation(this.readRegister32(I386.REGISTER_EAX), instruction.immediate)
          );
          break;

        case 0x39: // CMP ew,rw
          operation = operation || this._alu.sub32.bind(this._alu);
        case 0x85: // TEST ew,rw / TEST rw,ew
          operation = operation || this._alu.and32.bind(this._alu);

          //console.log((opcode == 0x39 ? 'cmp-' : 'test') + '32 ew,rw', instruction.segment.toString(16), instruction.offset.toString(16), this.readOperand32(instruction).toString(16), this.readRegister32(instruction.sourceRegister).toString(16));

          operation(
            this.readOperand32(instruction),
            this.readRegister32(instruction.sourceRegister)
          );
          break;

        case 0x3b: // CMP rw,ew
          this.debug('cmp32  rw,ew');
          this._alu.sub32(
            this.readRegister32(instruction.sourceRegister),
            this.readOperand32(instruction)
          );

          break;

        case 0x3d: // CMP EAX,dw
          operation = operation || this._alu.sub32.bind(this._alu);
        case 0xa9: // TEST EAX,dw
          operation = operation || this._alu.and32.bind(this._alu);

          //console.log((opcode == 0x3d ? 'cmp ' : 'test') + '   EAX,dw');

          operation(this.readRegister32(I386.REGISTER_EAX), instruction.immediate);
          break;

        case 0x40: // INC AX
        case 0x41: // INC CX
        case 0x42: // INC DX
        case 0x43: // INC BX
        case 0x44: // INC SP
        case 0x45: // INC BP
        case 0x46: // INC SI
        case 0x47: {
          // INC DI
          //console.log('inc    +ER  ');
          const incDestination = opcode - 0x40;

          this.writeRegister32(
            incDestination,
            this._alu.inc32(this.readRegister32(incDestination))
          );
          break;
        }

        case 0x50: // PUSH AX
        case 0x51: // PUSH CX
        case 0x52: // PUSH DX
        case 0x53: // PUSH BX
        case 0x54: // PUSH SP
        case 0x55: // PUSH BP
        case 0x56: // PUSH SI
        case 0x57: {
          // PUSH DI
          //console.log('push32 +R   ');
          const pushDestination = opcode - 0x50;

          this.push32(this.readRegister32(pushDestination));
          break;
        }

        case 0x58: // POP AX
        case 0x59: // POP CX
        case 0x5a: // POP DX
        case 0x5b: // POP BX
        case 0x5c: // POP SP
        case 0x5d: // POP BP
        case 0x5e: // POP SI
        case 0x5f: {
          // POP DI
          const popDestination = opcode - 0x58;
          //console.log('pop32  ' + I386.REGISTERS_G32[popDestination]);

          this.writeRegister32(popDestination, this.pop32());
          break;
        }

        case 0x60: {
          // PUSHAD
          //console.log('pushad      ');
          const esp = this.esp;
          this.push32(this.eax);
          this.push32(this.ecx);
          this.push32(this.edx);
          this.push32(this.ebx);
          this.push32(esp);
          this.push32(this.ebp);
          this.push32(this.esi);
          this.push32(this.edi);
          break;
        }

        case 0x4f7: // TEST ed,dd: F7 /0 and its alias /1, decoded with a 32-bit immediate
          this._alu.and32(this.readOperand32(instruction), instruction.immediate);
          break;

        case 0x98: // CWDE: AX sign-extended into EAX
          this.eax = ((this.ax << 16) >> 16) >>> 0;
          break;

        case 0x99: // CDQ: EAX's sign into every bit of EDX
          this.edx = this.eax & 0x80000000 ? 0xffffffff : 0;
          break;

        case 0x61: // POPAD
          //console.log('popad       ');
          this.edi = this.pop32();
          this.esi = this.pop32();
          this.ebp = this.pop32();
          this.pop32(); // Discard preserved ESP
          this.ebx = this.pop32();
          this.edx = this.pop32();
          this.ecx = this.pop32();
          this.eax = this.pop32();
          break;

        case 0x68: // PUSH dw
          //console.log('push32 dw   ');
          this.push32(instruction.immediate);
          break;

        case 0x69: // IMUL rw,ew,dw
          {
            /* The low half kept; `imul32` sets the flags. */
            const imulResult = this._alu.imul32(
              this.readOperand32(instruction),
              this._alu.toSigned32(instruction.immediate)
            );

            this.writeRegister32(instruction.sourceRegister, Number(imulResult & 0xffffffffn));
          }
          break;

        case 0x6a: // PUSH db
          //console.log('push32 db   ');
          this.push32(instruction.immediate);
          break;

        case 0x6b: //IMUL rw,ew,db
          {
            const imulResult = this._alu.imul32(
              this.readOperand32(instruction),
              this._alu.toSigned8(instruction.immediate)
            );

            /* The low half kept; `imul32` sets the flags. */
            this.writeRegister32(instruction.sourceRegister, Number(imulResult & 0xffffffffn));
          }
          break;

        case 0x81: // ADC ew,dw / ADD ew,dw / AND ew,dw / CMP ew,dw /
        // OR ew,dw / SBB ew,dw / SUB ew,dw / XOR ew,dw
        case 0x83: // ADC ew,db / ADD ew,db / CMP ew,db / SBB ew,db /
          // SUB ew,db
          /* 83h's byte sign-extended to 32 bits: the 286's decode extends
           * it to 16 only, and `cmp edi, -1` compared with FFFFh. Slam! of
           * the corpus loops for ever on that. 81h's immediate is 32 bits
           * already, and stays as it is: sign-extending its low byte made
           * `add ecx, 2998h` add FFFFFF98h (Bubble Girl's engine). */
          if (opcode === 0x83) {
            instruction.immediate = ((instruction.immediate << 24) >> 24) >>> 0;
          }

          switch (instruction.modifier) {
            case 0x0: // ADD ew,dw
              operation = operation || this._alu.add32.bind(this._alu);
            case 0x1: // OR ew,dw
              operation = operation || this._alu.or32.bind(this._alu);
            case 0x2: // ADC ew,dw
              operation = operation || this._alu.adc32.bind(this._alu);
            case 0x3: // SBB ew,dw
              operation = operation || this._alu.sbb32.bind(this._alu);
            case 0x4: // AND ew,dw
              operation = operation || this._alu.and32.bind(this._alu);
            case 0x5: // SUB ew,dw
              operation = operation || this._alu.sub32.bind(this._alu);
            case 0x6: // XOR ew,dw
              operation = operation || this._alu.xor32.bind(this._alu);

              //console.log(['add', 'or ', 'adc', 'sbb',
              //             'and', 'sub', 'xor', 'unk'][instruction.modifier] + '32 ew,dw');

              this.writeOperand32(
                instruction,
                operation(this.readOperand32(instruction), instruction.immediate)
              );
              break;

            case 0x7: // CMP ew,dw
              //console.log('cmp32   ew,dw', instruction.operandRegister, this.readOperand32(instruction).toString(16), instruction.immediate.toString(16));
              this._alu.sub32(this.readOperand32(instruction), instruction.immediate);
              break;
          }

          break;

        case 0x89: // MOV ew,rw
          //console.log('mov32  ew,rw');
          this.writeOperand32(instruction, this.readRegister32(instruction.sourceRegister));
          break;

        case 0x8b: // MOV rw,ew
          this.debug('mov32  rw,ew');
          this.writeRegister32(instruction.sourceRegister, this.readOperand32(instruction));
          break;

        case 0x8c: {
          // MOV ew,ES / MOV ew,CS / MOV ew,SS / MOV ew,DS / MOV ew,FS / MOV ew,GS
          //console.log('mov    ew,+S');
          const movSource = instruction.modifier;
          if (movSource >= 6) {
            // Invalid
            throw new InvalidInstruction(instruction, () => {
              this.raiseUndefinedOpcode(instruction);
            });
          }

          //console.log("writing from segment", movSource, this._segmentRegisters[movSource], "to", instruction);
          this.writeOperand16(instruction, this.readSegmentRegister(movSource));
          break;
        }

        case 0x8e: {
          // MOV ES,mw / MOV ES,rw / MOV SS,mw / MOV SS,rw /
          // MOV DS,mw / MOV DS,rw / MOV FS,rw / MOV GS,rw
          //console.log('mov    +S,rm');
          const movDestination = instruction.modifier;
          //console.log(instruction, movDestination, this.readOperand16(instruction));
          if (movDestination >= 6 || movDestination == 1) {
            // Invalid
            throw new InvalidInstruction(instruction, () => {
              this.raiseUndefinedOpcode(instruction);
            });
          }
          this.loadSegmentRegister(movDestination, this.readOperand16(instruction));
          break;
        }

        case 0xa1: // MOV EAX,xw
          this.debug('mov    EAX,xw');
          this.writeRegister32(
            I386.REGISTER_EAX,
            this.read32(instruction.segment ?? this.ds, instruction.immediate)
          );
          break;

        case 0xa3: // MOV xw,EAX
          this.debug('mov    xw,EAX');
          this.write32(instruction.segment ?? this.ds, instruction.immediate, this.eax);
          break;

        case 0xa4: // MOVS mb,mb / MOVSB
        case 0xa5: // MOVS mw,mw / MOVSW
          //console.log('movs32 mb/mw');
          while (!instruction.repeat || this.cx != 0) {
            // No segment overrides are allowed.
            if (instruction.opcode == 0xa4) {
              //console.log("MOVS WRITE", this.es, this.di, instruction.segment ?? this.ds, this.si, this.read8(instruction.segment ?? this.ds, this.si));
              this.write8(
                this.es,
                instruction.addressOverride ? this.edi : this.di,
                this.read8(
                  instruction.segment ?? this.ds,
                  instruction.addressOverride ? this.esi : this.si
                )
              );
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -1 : 1;
                this.esi += this._flags.direction ? -1 : 1;
              } else {
                this.di += this._flags.direction ? -1 : 1;
                this.si += this._flags.direction ? -1 : 1;
              }
            } else {
              this.write32(
                this.es,
                instruction.addressOverride ? this.edi : this.di,
                this.read32(
                  instruction.segment ?? this.ds,
                  instruction.addressOverride ? this.esi : this.si
                )
              );
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -4 : 4;
                this.esi += this._flags.direction ? -4 : 4;
              } else {
                this.di += this._flags.direction ? -4 : 4;
                this.si += this._flags.direction ? -4 : 4;
              }
            }

            if (instruction.repeat) {
              this.cx--;
            } else {
              break;
            }
          }
          break;

        case 0x9a: // CALL far cd
          // Push CS
          this.push16(0);
          this.push16(this.cs);

          // Push IP
          this.push16(0);
          this.push16(this.ip);

          this.ip = instruction.immediate;
          this.cs = instruction.targetCS;
          //console.log('callf32 cd   ', this.ip.toString(16));
          break;

        case 0xa6: // CMPSB (Compare String Bytes)
        case 0xa7: // CMPSW (Compare String Words)
          //console.log('cmps32 mb/mw');
          while (!instruction.repeat || this.cx != 0) {
            // No segment overrides are allowed. (but we allow them??)
            if (instruction.opcode == 0xa6) {
              this._alu.sub8(
                this.read8(
                  instruction.segment ?? this.ds,
                  instruction.addressOverride ? this.esi : this.si
                ),
                instruction.addressOverride
                  ? this.read8(this.es, this.edi)
                  : this.read8(this.es, this.di)
              );
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -1 : 1;
                this.esi += this._flags.direction ? -1 : 1;
              } else {
                this.di += this._flags.direction ? -1 : 1;
                this.si += this._flags.direction ? -1 : 1;
              }
            } else {
              this._alu.sub32(
                this.read32(
                  instruction.segment ?? this.ds,
                  instruction.addressOverride ? this.esi : this.si
                ),
                this.read32(this.es, instruction.addressOverride ? this.edi : this.di)
              );
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -4 : 4;
                this.esi += this._flags.direction ? -4 : 4;
              } else {
                this.di += this._flags.direction ? -4 : 4;
                this.si += this._flags.direction ? -4 : 4;
              }
            }

            if (instruction.repeat) {
              this.cx--;

              if (instruction.repeatNE && this._flags.zero) {
                break;
              } else if (instruction.repeatE && !this._flags.zero) {
                break;
              }
            } else {
              break;
            }
          }
          break;

        case 0xaa: // STOS mb / STOSB (Store String Data)
        case 0xab: // STOS mw / STOSW (Store String Data)
          //console.log('stos32 mb/mw');
          while (!instruction.repeat || (instruction.addressOverride ? this.ecx : this.cx) != 0) {
            // No segment overrides are allowed.
            if (instruction.opcode == 0xaa) {
              this.write8(this.es, instruction.addressOverride ? this.edi : this.di, this.al);
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -1 : 1;
              } else {
                this.di += this._flags.direction ? -1 : 1;
              }
            } else {
              this.write32(this.es, instruction.addressOverride ? this.edi : this.di, this.eax);
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -4 : 4;
              } else {
                this.di += this._flags.direction ? -4 : 4;
              }
            }

            if (instruction.repeat) {
              if (instruction.addressOverride) {
                this.ecx--;
              } else {
                this.cx--;
              }
            } else {
              break;
            }
          }
          break;

        case 0xac: // LODS mb / LODSB (Load String Operand)
        case 0xad: // LODS mw / LODSW (Load String Operand)
          //console.log('lods32 mb/mw');
          while (!instruction.repeat || (instruction.addressOverride ? this.ecx : this.cx) != 0) {
            if (instruction.opcode == 0xac) {
              this.al = this.read8(
                instruction.segment ?? this.ds,
                instruction.addressOverride ? this.esi : this.si
              );
              if (instruction.addressOverride) {
                this.esi += this._flags.direction ? -1 : 1;
              } else {
                this.si += this._flags.direction ? -1 : 1;
              }
            } else {
              this.eax = this.read32(
                instruction.segment ?? this.ds,
                instruction.addressOverride ? this.esi : this.si
              );
              if (instruction.addressOverride) {
                this.esi += this._flags.direction ? -4 : 4;
              } else {
                this.si += this._flags.direction ? -4 : 4;
              }
            }

            if (instruction.repeat) {
              if (instruction.addressOverride) {
                this.ecx--;
              } else {
                this.cx--;
              }
            } else {
              break;
            }
          }
          break;

        case 0xae: // SCAS mb / SCASB (Compare String Data)
        case 0xaf: // SCAS mw / SCASW (Compare String Data)
          //console.log('scas32 mb/mw');
          while (!instruction.repeat || (instruction.addressOverride ? this.ecx : this.cx) != 0) {
            // No segment overrides are allowed.
            if (instruction.opcode == 0xae) {
              this._alu.sub8(
                this.al,
                this.read8(this.es, instruction.addressOverride ? this.edi : this.di)
              );
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -1 : 1;
              } else {
                this.di += this._flags.direction ? -1 : 1;
              }
            } else {
              this._alu.sub32(
                this.eax,
                this.read32(this.es, instruction.addressOverride ? this.edi : this.di)
              );
              if (instruction.addressOverride) {
                this.edi += this._flags.direction ? -4 : 4;
              } else {
                this.di += this._flags.direction ? -4 : 4;
              }
            }

            if (instruction.repeat) {
              if (instruction.addressOverride) {
                this.ecx--;
              } else {
                this.cx--;
              }

              if (instruction.repeatNE && this._flags.zero) {
                break;
              } else if (instruction.repeatE && !this._flags.zero) {
                break;
              }
            } else {
              break;
            }
          }
          break;

        case 0xb8: // MOV EAX,dw
        case 0xb9: // MOV ECX,dw
        case 0xba: // MOV EDX,dw
        case 0xbb: // MOV EBX,dw
        case 0xbc: // MOV ESP,dw
        case 0xbd: // MOV EBP,dw
        case 0xbe: // MOV ESI,dw
        case 0xbf: {
          // MOV EDI,dw
          //console.log('mov    +ER,dw', instruction.immediate.toString(16));
          const movWordDestination = opcode - 0xb8;
          this.writeRegister32(movWordDestination, instruction.immediate);
          break;
        }

        case 0xc1: // RCL ew,db / RCR ew,db / ROL ew,db / ROR ew,db /
          // SAL ew,db / SAR ew,db / SHL ew,db / SHR ew,db
          shiftAmount = shiftAmount == null ? instruction.immediate : shiftAmount;
        case 0xd1: // RCL ew,1 / RCR ew,1 / ROL ew,1 / ROR ew,1 /
          // SAL ew,1 / SAR ew,1 / SHL ew,1 / SHR ew,1
          shiftAmount = shiftAmount == null ? 1 : shiftAmount;
        case 0xd3: // RCL ew,CL / RCR ew,CL / ROL ew,CL / ROR ew,CL /
          // SAL ew,CL / SAR ew,CL / SHL ew,CL / SHR ew,CL
          shiftAmount = shiftAmount == null ? this.readRegister8(I286.REGISTER_CL) : shiftAmount;
          //console.log('shiftd ew/..');

          switch (instruction.modifier) {
            case 0x0: // ROL ew,shamt (Rotate 32-bit Ew left)
              operation = operation || this._alu.rol32.bind(this._alu);
            case 0x1: // ROR ew,shamt (Rotate 32-bit Ew right)
              operation = operation || this._alu.ror32.bind(this._alu);
            case 0x2: // RCL ew,shamt (Rotate 33-bits (CF,Ew) left)
              operation = operation || this._alu.rcl32.bind(this._alu);
            case 0x3: // RCR ew,shamt (Rotate 33-bits (CF,Ew) right)
              operation = operation || this._alu.rcr32.bind(this._alu);
            case 0x4: // SAL ew,shamt / SHL ew,shamt
            case 0x6: // the same, as the part runs /6 (the 80386 suite's tests)
              operation = operation || this._alu.shl32.bind(this._alu);
            case 0x5: // SHR ew,shamt
              operation = operation || this._alu.shr32.bind(this._alu);
            case 0x7: // SAR ew,shamt
              operation = operation || this._alu.sar32.bind(this._alu);
              break;
            default:
              // Invalid
              throw new InvalidInstruction(instruction);
          }

          this.writeOperand32(instruction, operation(this.readOperand32(instruction), shiftAmount));
          break;

        case 0xc2: // RET dw
          //console.log('ret32  dw   ', this.ax);
          this.ip = this.pop16();
          this.pop16();
          this.sp = this.sp + instruction.immediate;
          break;

        case 0xc3: // RET
          //console.log('ret32       ', this.ax);
          this.ip = this.pop16();
          this.pop16();
          break;

        case 0xc4: // LES rw,ed (Load EA dword into DS/rw)
        case 0xc5: // LDS rw,ed (Load EA dword into DS/rw)
          if (instruction.segment === undefined) {
            throw new InvalidInstruction(instruction);
          }

          this.writeRegister32(instruction.sourceRegister, this.readOperand32(instruction));

          if (opcode == 0xc4) {
            //console.log('les32  rw,eb');
            this.es = this.read16(instruction.segment, instruction.offset + 4);
          } else {
            //console.log('lds32  rw,eb');
            this.ds = this.read16(instruction.segment, instruction.offset + 4);
          }
          break;

        case 0xc7: // MOV ew,dw
          //console.log('mov32  ew,dw', instruction.immediate.toString(16), instruction.segment, this.di, instruction.offset);
          this.writeOperand32(instruction, instruction.immediate);
          break;

        case 0xca: // RET far dw
          //console.log('retf32 dw   ', this.ax);
          this.ip = this.pop16();
          this.pop16();
          this.cs = this.pop16();
          this.pop16();
          this.sp = this.sp + instruction.immediate;
          break;

        case 0xcb: // RET far
          //console.log('retf32      ', this.ax);
          this.ip = this.pop16();
          this.pop16();
          this.cs = this.pop16();
          this.pop16();
          //console.log('sp:', this.sp.toString(16));
          break;

        case 0xd8:
        case 0xd9:
        case 0xda:
        case 0xdb:
        case 0xdc:
        case 0xdd:
        case 0xde:
        case 0xdf:
          // X87 instructions
          this._fpu.execute(instruction);
          break;

        case 0xe8: // CALL cw
          //console.log('call32 cw   ');
          // Push EIP
          this.push16(0);
          this.push16(this.ip);

          this.ip += instruction.immediate;
          break;

        case 0xe9: // JMP cw
          //console.log('jmp32  cw');
          this.ip += this._alu.toSigned32(instruction.immediate);
          break;

        case 0xea: // JMP far cd
          //console.log('jmpf32 cd   ');
          this.ip = instruction.immediate;
          this.cs = instruction.targetCS;
          break;

        case 0xf7:
          {
            // DIV ew / IDIV ew / IMUL ew / MUL ew /
            // NEG ew / NOT ew
            const aluWordOperand = this.readOperand32(instruction);
            switch (instruction.modifier) {
              case 0x0: // TEST (not possible)
              case 0x1: // Also not implemented
                throw new InvalidInstruction(instruction);
              case 0x2: // NOT ew
                //console.log('not32  ew   ');
                this.writeOperand32(instruction, this._alu.not32(aluWordOperand));
                break;
              case 0x3: // NEG ew
                //console.log('neg32  ew   ');
                this.writeOperand32(instruction, this._alu.neg32(aluWordOperand));
                break;
              case 0x4: {
                // MUL ew
                //console.log('mul32  ew   ');
                const mulResult = this._alu.mul32(this.eax, aluWordOperand);
                this.edx = Number((mulResult >> 32n) & 0xffffffffn);
                this.eax = Number(mulResult & 0xffffffffn);
                break;
              }
              case 0x5: {
                // IMUL ew
                //console.log('imul32 ew   ');
                const imulResult = this._alu.imul32(this.eax, aluWordOperand);
                this.edx = Number((imulResult >> 32n) & 0xffffffffn);
                this.eax = Number(imulResult & 0xffffffffn);
                break;
              }
              case 0x6:
              case 0x7: {
                /* DIV and IDIV of EDX:EAX, the quotient to EAX and the
                 * remainder, with the dividend's sign, to EDX. A divisor of
                 * nought, or a quotient that does not fit, is a divide
                 * error, the registers left as they were. */
                const signed = instruction.modifier === 0x7;
                const high = BigInt(this.edx >>> 0);
                const pair = (high << 32n) | BigInt(this.eax >>> 0);
                const dividend = signed ? BigInt.asIntN(64, pair) : pair;
                const divisor = signed ? BigInt(aluWordOperand | 0) : BigInt(aluWordOperand >>> 0);

                if (divisor === 0n) {
                  this.raiseInterrupt(instruction, 0);
                  break;
                }

                const quotient = dividend / divisor;
                const fits = signed
                  ? quotient >= -0x80000000n && quotient <= 0x7fffffffn
                  : quotient <= 0xffffffffn;

                if (!fits) {
                  this.raiseInterrupt(instruction, 0);
                  break;
                }

                this.eax = Number(BigInt.asUintN(32, quotient));
                this.edx = Number(BigInt.asUintN(32, dividend % divisor));
                break;
              }
            }
          }
          break;

        case 0xff: // CALL ew / CALL far ed / DEC ew / INC ew /
          // JMP ew / JMP far ed / PUSH mw
          switch (instruction.modifier) {
            case 0x0: // INC ew
              //console.log('inc32  ew');
              operation = operation || this._alu.inc32.bind(this._alu);
            case 0x1: // DEC ew
              //console.log('dec32  ew');
              operation = operation || this._alu.dec32.bind(this._alu);

              this.writeOperand32(instruction, operation(this.readOperand32(instruction)));
              break;

            case 0x2: // CALL ew
              // Push EIP
              this.push16(0);
              this.push16(this.ip);

              // Set EIP to the given operand
              this.ip = this.readOperand32(instruction);
              //console.log('bp:', this.bp.toString(16));
              //console.log('call32 ew', this.ip.toString(16));
              break;

            case 0x3: // CALL far ed
              //console.log('callf32 ed');
              if (instruction.segment === undefined) {
                throw new InvalidInstruction(instruction);
              }

              // Push CS
              this.push16(0);
              this.push16(this.cs);

              // Push EIP
              this.push16(0);
              this.push16(this.ip);

              // Set IP to the given operand
              this.ip = this.read32(instruction.segment, instruction.offset);
              // Set CS as well
              this.cs = this.read16(instruction.segment, instruction.offset + 4);
              //console.log('callf32 ed', this.cs.toString(16), ':', this.ip.toString(16));

              // Set CS to the following word
              this.cs = this.read16(instruction.segment, instruction.offset + 4);
              break;

            case 0x4: // JMP ew
              //console.log('jmp    ew');
              // Just set EIP
              this.ip = this.readOperand32(instruction);
              break;

            case 0x5: // JMP far ed
              //console.log('jmpf   ed');
              //console.log(instruction);
              //console.log(this.memory);
              if (!instruction.segment) {
                throw new InvalidInstruction(instruction);
              }

              // Set IP to the given operand
              this.ip = this.readOperand32(instruction);

              // Set CS to the following word
              this.cs = this.read16(instruction.segment, instruction.offset + 4);
              break;

            case 0x6: // PUSH mw
              //console.log('push32 mw', this.ss.toString(16), this.sp.toString(16), instruction.segment.toString(16), instruction.offset.toString(16), this._memory.read32(this.translateAddress(instruction.segment, instruction.offset)).toString(16), this._memory.read16(this.translateAddress(instruction.segment, instruction.offset)).toString(16));
              this.push32(this.readOperand32(instruction));
              break;

            case 0x7: // Invalid
              throw new InvalidInstruction(instruction);
              break;
          }
          break;

        case 0x101: // SGDT / SIDT / LIDT / LGDT / LMSW / SMSW
          switch (instruction.modifier) {
            case 0: // SGDT m
              break;

            case 1: // SIDT m
              break;

            case 2: // LGDT m
              //console.log("lgdt32");

              if (this.cpl == 0) {
                // Read 16-bit word from memory at the effective address
                this.gdtLimit = this.read16(instruction.segment, instruction.offset);
                // Read 32-bit word from memory that follows for the base
                this.gdtBase = this.read32(instruction.segment, instruction.offset + 2);
              } else {
                // Fire #GP(0)
                this.raiseInterrupt(instruction, 13, 0);
              }
              break;

            case 3: // LIDT m
              //console.log("lidt32");

              if (this.cpl == 0) {
                // Read 16-bit word from memory at the effective address
                this.idtLimit = this.read16(instruction.segment, instruction.offset);
                // Read 32-bit word from memory that follows for the base
                this.idtBase = this.read32(instruction.segment, instruction.offset + 2);
              } else {
                // Fire #GP(0)
                this.raiseInterrupt(instruction, 13, 0);
              }
              break;
          }
          break;

        case 0x1af: // IMUL rw,mw
          {
            /* The low half kept; `imul32` sets the flags. */
            const imulResult = this._alu.imul32(
              this.readOperand32(instruction),
              this.readRegister32(instruction.sourceRegister)
            );

            this.writeRegister32(instruction.sourceRegister, Number(imulResult & 0xffffffffn));
          }
          break;

        case 0x1b2: // LSS
        case 0x1b4: // LFS
        case 0x1b5: // LGS
          /* A far pointer comes from memory: a register is an undefined
           * opcode. */
          if (instruction.offset === undefined) {
            this.raiseUndefinedOpcode(instruction);
            break;
          }

          this.writeRegister32(instruction.sourceRegister, this.readOperand32(instruction));

          if (opcode == 0x1b2) {
            //console.log('lss32  rw,eb', this.read32(instruction.segment, instruction.offset + 4).toString(16));
            this.ss = this.read16(instruction.segment, instruction.offset + 4);
          } else if (opcode == 0x1b4) {
            //console.log('lfs32  rw,eb');
            this.fs = this.read16(instruction.segment, instruction.offset + 4);
          } else {
            //console.log('lgs32  rw,eb');
            this.gs = this.read16(instruction.segment, instruction.offset + 4);
          }
          break;

        case 0x1b6: // MOVSZ mb,ew
          // Zero extends byte to r32
          //console.log("movsz", this.readOperand8(instruction));
          this.writeRegister32(instruction.sourceRegister, this.readOperand8(instruction));
          break;

        case 0x1b7: // MOVSZ mw,mw
          // Zero extends word to double-word
          //console.log("movsz", this.readOperand16(instruction));
          this.writeRegister32(instruction.sourceRegister, this.readOperand16(instruction));
          break;

        case 0x1be: // MOVSX mb,ew
          // Sign extends byte to r32
          //console.log("movsx", this._alu.toSigned8(this.readOperand8(instruction)));
          this.writeRegister32(
            instruction.sourceRegister,
            this._alu.toSigned8(this.readOperand8(instruction))
          );
          break;

        case 0x1bf: // MOVSX mw,mw
          // Sign extends word to double-word
          //console.log("movsx", this._alu.toSigned16(this.readOperand16(instruction)));
          this.writeRegister32(
            instruction.sourceRegister,
            this._alu.toSigned16(this.readOperand16(instruction))
          );
          break;

        case 0x3a4: {
          // SHLD r/m32, r32, imm8
          // Form 64bit value from the two given registers
          // The destination operand is the low word and the
          // source register is the high word
          // The immediate is the number of bits to shift right.
          const shldLow = this.readOperand32(instruction);
          const shldHigh = this.readRegister32(instruction.sourceRegister);
          const shldCombined = (BigInt(shldHigh) << 32n) | BigInt(shldLow);
          const shldResult = this._alu.shl64(shldCombined, BigInt(instruction.immediate));
          //console.log("SHLD", shldCombined, instruction.immediate, shldResult);
          this.writeOperand32(instruction, Number(shldResult & 0xffffffffn));
          break;
        }

        case 0x3ac: {
          // SHRD r/m32, r32, imm8
          // Form 64bit value from the two given registers
          // The destination operand is the low word and the
          // source register is the high word
          // The immediate is the number of bits to shift right.
          const shrdLow = this.readOperand32(instruction);
          const shrdHigh = this.readRegister32(instruction.sourceRegister);
          const shrdCombined = (BigInt(shrdHigh) << 32n) | BigInt(shrdLow);
          const shrdResult = this._alu.shr64(shrdCombined, BigInt(instruction.immediate));
          //console.log("SHRD", shrdCombined, instruction.immediate, shrdResult);
          this.writeOperand32(instruction, Number(shrdResult & 0xffffffffn));
          break;
        }

        default:
          // Unknown
          console.log('error: executing unknown opcode', instruction);
          throw new InvalidInstruction(instruction);
      }
    } else if (
      instruction.addressOverride &&
      ((opcode >= 0xe0 && opcode <= 0xe3) || opcode === 0xd7)
    ) {
      /* What the address size changes of itself: the loops count ECX, and
       * XLAT adds AL to EBX. Every other instruction takes it through its
       * operand's address, and runs as it would without the prefix -- the
       * 386's own forms included. (The 80386 suite's XLAT tests under the
       * prefix keep EBX's high word nought, so they cannot tell EBX from
       * BX; Intel's manual has EBX.) */
      switch (instruction.opcode) {
        case 0xd7: // XLAT mb / XLATB
          this.al = this.read8(instruction.segment ?? this.ds, ((this.ebx >>> 0) + this.al) >>> 0);
          break;

        case 0xe0: // LOOPNE cb / LOOPNZ cb
          //console.log("loopne cb");
          this.ecx--;

          if (this.ecx != 0 && !this._flags.zero) {
            this.ip += this._alu.toSigned8(instruction.immediate);
          }
          break;

        case 0xe1: // LOOPE cb / LOOPZ cb
          //console.log("loope  cb");
          this.ecx--;

          if (this.ecx != 0 && this._flags.zero) {
            this.ip += this._alu.toSigned8(instruction.immediate);
          }
          break;

        case 0xe2: // LOOP cb
          //console.log("loop   cb   cx=", this.cx.toString(16));
          this.ecx--;

          if (this.ecx != 0) {
            this.ip += this._alu.toSigned8(instruction.immediate);
          }
          break;

        case 0xe3: // JECXZ cb
          //console.log('jecxz  cb   ecx=', this.ecx);
          if (this.ecx == 0) {
            this.ip += this._alu.toSigned8(instruction.immediate);
          }
          break;

        case 0xd8:
        case 0xd9:
        case 0xda:
        case 0xdb:
        case 0xdc:
        case 0xdd:
        case 0xde:
        case 0xdf:
          // X87 instructions
          this._fpu.execute(instruction);
          break;

        default:
          // Fall back to the i286 core
          super.execute(instruction);
          break;
      }
    } else {
      // Execute the opcode
      switch (opcode) {
        case 0x8c: {
          // MOV ew,ES / MOV ew,CS / MOV ew,SS / MOV ew,DS / MOV ew,FS / MOV ew,GS
          //console.log('mov    ew,+S');
          const movSource = instruction.modifier;
          if (movSource >= 6) {
            // Invalid
            throw new InvalidInstruction(instruction);
          }

          //console.log("writing from segment", movSource, this._segmentRegisters[movSource], "to", instruction);
          this.writeOperand16(instruction, this.readSegmentRegister(movSource));
          break;
        }

        case 0x8e: {
          // MOV ES,mw / MOV ES,rw / MOV SS,mw / MOV SS,rw /
          // MOV DS,mw / MOV DS,rw / MOV FS,rw / MOV GS,rw
          //console.log('mov    +S,rm');
          const movDestination = instruction.modifier;
          if (movDestination >= 6 || movDestination == 1) {
            // Invalid
            throw new InvalidInstruction(instruction, () => {
              this.raiseUndefinedOpcode(instruction);
            });
          }
          this.loadSegmentRegister(movDestination, this.readOperand16(instruction));
          break;
        }

        case 0x120: // MOV rw, crw
          if (this.cpl == 0x0) {
            switch (instruction.sourceRegister) {
              case 0:
                //console.log("mov    rw,cr0");
                this.writeRegister32(instruction.operandRegister, this.cr0);
                break;

              case 1:
                //console.log("mov    rw,cr1");
                this.writeRegister32(instruction.operandRegister, this.cr1);
                break;

              case 3:
                //console.log("mov    rw,cr3");
                this.writeRegister32(instruction.operandRegister, this.cr3);
                break;

              default:
                throw new InvalidInstruction(instruction);
            }
          } else {
            // Fire #GP(0)
            this.raiseInterrupt(instruction, 13, 0);
          }
          break;

        case 0x122: // MOV crw, rw
          if (this.cpl == 0x0) {
            switch (instruction.sourceRegister) {
              case 0:
                //console.log("mov    cr0,rw");
                this.cr0 = this.readRegister32(instruction.operandRegister);
                break;

              case 1:
                //console.log("mov    cr1,rw");
                this.cr1 = this.readRegister32(instruction.operandRegister);
                break;

              case 3:
                //console.log("mov    cr3,rw");
                this.cr3 = this.readRegister32(instruction.operandRegister);
                break;

              default:
                throw new InvalidInstruction(instruction);
            }
          } else {
            // Fire #GP(0)
            this.raiseInterrupt(instruction, 13, 0);
          }
          break;

        case 0x1b2: // LSS
        case 0x1b4: // LFS
        case 0x1b5: // LGS
          /* A far pointer comes from memory: a register is an undefined
           * opcode. */
          if (instruction.offset === undefined) {
            this.raiseUndefinedOpcode(instruction);
            break;
          }

          this.writeRegister16(instruction.sourceRegister, this.readOperand16(instruction));

          if (opcode == 0x1b2) {
            //console.log('lss    rw,eb');
            this.ss = this.read16(instruction.segment, instruction.offset + 2);
          } else if (opcode == 0x1b4) {
            //console.log('lfs    rw,eb');
            this.fs = this.read16(instruction.segment, instruction.offset + 2);
          } else {
            //console.log('lgs    rw,eb');
            this.gs = this.read16(instruction.segment, instruction.offset + 2);
          }
          break;

        case 0x1be: // MOVSX mb,ew
          // Sign extends byte to r16
          //console.log("movsx mb", this._alu.toSigned8(this.readOperand8(instruction)));
          this.writeRegister16(
            instruction.sourceRegister,
            this._alu.toSigned8(this.readOperand8(instruction))
          );
          break;

        /* A word to a word register is a move: the register's high word, as
         * the 386 leaves it, is left alone. */
        case 0x1bf: // MOVSX rw,mw
        case 0x1b7: // MOVZX rw,mw
          this.writeRegister16(instruction.sourceRegister, this.readOperand16(instruction));
          break;

        /* Bubble Girl of the corpus, built for the 386, runs these without the
         * operand prefix. */
        case 0x1b6: // MOVZX rw,mb
          this.writeRegister16(instruction.sourceRegister, this.readOperand8(instruction));
          break;

        case 0x480: // JO near cb
        case 0x481: // JNO near cb
        case 0x482: // JB near cb / JC cb / JNAE cb
        case 0x483: // JAE near cb / JNB cb / JNC cb
        case 0x484: // JE near cb / JZ cb
        case 0x485: // JNE near cb / JNZ cb
        case 0x486: // JBE near cb / JNA cb
        case 0x487: // JA near cb / JNBE cb
        case 0x488: // JS near cb
        case 0x489: // JNS near cb
        case 0x48a: // JP near cb / JPE cb
        case 0x48b: // JNP near cb / JPO cb
        case 0x48c: // JL near cb / JNGE cb
        case 0x48d: // JGE near cb / JNL cb
        case 0x48e: // JLE near cb / JNG cb
        case 0x48f: {
          // JG near cb / JNLE cb
          let jump = false;

          switch (opcode) {
            case 0x480: // near JO
              //console.log('jo     near cw/cd');
              jump = this._flags.overflow;
              break;

            case 0x481: // JNO
              //console.log('jno    near cw/cd');
              jump = !this._flags.overflow;
              break;

            case 0x482: // JB
              //console.log('jb     near cw/cd');
              jump = this._flags.carry;
              break;

            case 0x483: // JAE
              //console.log('jae    near cw/cd');
              jump = !this._flags.carry;
              break;

            case 0x484: // JE
              //console.log('je     near cw/cd');
              jump = this._flags.zero;
              break;

            case 0x485: // JNE
              //console.log('jne    near cw/cd');
              jump = !this._flags.zero;
              break;

            case 0x486: // JBE
              //console.log('jbe    near cw/cd');
              jump = this._flags.carry || this._flags.zero;
              break;

            case 0x487: // JA
              //console.log('ja     near cw/cd');
              jump = !this._flags.carry && !this._flags.zero;
              break;

            case 0x488: // JS
              //console.log('js     near cw/cd');
              jump = this._flags.signed;
              break;

            case 0x489: // JNS
              //console.log('jns    near cw/cd');
              jump = !this._flags.signed;
              break;

            case 0x48a: // JP
              //console.log('jp     near cw/cd');
              jump = this._flags.parity;
              break;

            case 0x48b: // JPO
              //console.log('jpo    near cw/cd');
              jump = !this._flags.parity;
              break;

            case 0x48c: // JL
              //console.log('jl     near cw/cd');
              jump = this._flags.signed != this._flags.overflow;
              break;

            case 0x48d: // JGE
              //console.log('jge    near cw/cd');
              jump = this._flags.signed == this._flags.overflow;
              break;

            case 0x48e: // JLE
              //console.log('jle    near cw/cd');
              jump = this._flags.zero || this._flags.signed != this._flags.overflow;
              break;

            case 0x48f: // JG
              //console.log('jg     near cw/cd');
              jump = !this._flags.zero && this._flags.signed == this._flags.overflow;
              break;
          }

          if (jump) {
            // Perform the jump
            this.ip += this._alu.toSigned16(instruction.immediate);
          }

          break;
        }

        case 0xd8:
        case 0xd9:
        case 0xda:
        case 0xdb:
        case 0xdc:
        case 0xdd:
        case 0xde:
        case 0xdf:
          // X87 instructions
          this._fpu.execute(instruction);
          break;

        default:
          // Fall back to the i286 core
          super.execute(instruction);
          break;
      }
    }

    // Reset prefix flags
    instruction.lock = false;
    instruction.repeat = false;
    instruction.repeatE = false;
    instruction.repeatNE = false;
    instruction.operandOverride = undefined;
    instruction.addressOverride = undefined;

    // Reset instruction parameters
    instruction.segment = undefined;
    instruction.offset = undefined;
    instruction.operandRegister = undefined;
  }
}

// Register index values for 386 32-bit segment registers.
I386.REGISTER_FS = 4;
I386.REGISTER_GS = 5;

// Register index values for general 32-bit registers.
I386.REGISTER_EAX = 0;
I386.REGISTER_ECX = 1;
I386.REGISTER_EDX = 2;
I386.REGISTER_EBX = 3;
I386.REGISTER_ESP = 4;
I386.REGISTER_EBP = 5;
I386.REGISTER_ESI = 6;
I386.REGISTER_EDI = 7;

// Register names for 32-bit registers
I386.REGISTERS_G32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
I386.REGISTERS_S = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];

export default I386;
