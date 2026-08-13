'use strict';

import { ALU } from '../alu.js';
import { I286 } from './i286.js';
import { CPU, InvalidInstruction } from '../cpu.js';
import { X87 } from '../x87.js';

/**
 * This class represents the CPU emulation of an Intel 386.
 */
export class I386 extends I286 {
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

    this._stackTrace = new Array(10);
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

  retrieveDescriptor(segment) {
    const descriptor = this._translationCache[segment];
    if (descriptor) {
      return descriptor;
    }

    if (!(this.cr0 & 0x1)) {
      return {
        base: segment << 4,
        limit: 0xffff,
        present: true,
        addressSize: false,
        dpl: 0,
      };
    }

    if (segment == 0x0) {
      // Null selector
      return {
        base: 0,
        limit: 0,
        present: true,
        addressSize: false,
        dpl: 0,
      };
    }

    const ldt = (segment >> 2) & 0x1;
    const iopl = segment & 0x3;
    const index = segment >> 3;

    //console.log("loading 32-bit selector", index, "from", (ldt ? "ldt" : "gdt"), "level", iopl);

    // Read selector
    const gdtBase = this.gdtBase + index * 8;
    const gdtMax = this.gdtBase + this.gdtLimit;

    //console.log("gdt", gdtBase.toString(16), gdtMax.toString(16));

    if (gdtBase + 8 >= gdtMax) {
      // Invalid Entry
      console.log('INVALID');
      throw 'F';
    }

    // 386 32-bit base address GDT entry
    let segmentLimit = this._memory.read16(gdtBase);
    segmentLimit |= (this._memory.read8(gdtBase + 6) & 0xf) << 16;

    // Acquire the base address of the segment
    let segmentBase = this._memory.read16(gdtBase + 2);
    segmentBase |= this._memory.read8(gdtBase + 4) << 16;
    segmentBase |= this._memory.read8(gdtBase + 7) << 24;

    // Determine the proper flags
    let gdtFlags = this._memory.read8(gdtBase + 5) & 0xff;
    gdtFlags |= this._memory.read8(gdtBase + 6) << 8;

    //console.log("descriptor:", "limit=", segmentLimit.toString(16), "offset=", segmentBase.toString(16), "flags=", gdtFlags.toString(16));

    if (gdtFlags & 0x40) {
      console.log('Default address size of 32');
    }

    return {
      base: segmentBase,
      limit: segmentLimit,
      present: (gdtFlags & 0x80) > 0,
      addressSize: (gdtFlags & 0x4000) > 0,
      dpl: (gdtFlags >> 13) & 0x3,
    };
  }

  computeBase(segment) {
    let base = this._translationCache[segment];

    if (base) {
      return base.base;
    }

    // Protected-mode Addressing
    if (this.cr0 & 0x1) {
      const descriptor = this.retrieveDescriptor(segment);
      base = descriptor.base;
    } else {
      base = super.computeBase(segment);
    }

    return base;
  }

  /**
   * Translates an address from the current segment and offset.
   */
  translateAddress(segment, offset) {
    // Rely on the i286 core for normal real addressing
    return super.translateAddress(segment, offset);
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
    this.esp -= 4;
    this.write32(this.ss, this.esp, value);
  }

  /**
   * Pops a 32-bit value from the stack.
   */
  pop32() {
    const ret = this.read32(this.ss, this.esp);
    this.esp = this.esp + 4;
    return ret;
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
    return this._memory.read32(this.translateAddress(segment, offset));
  }

  readSigned32(segment, offset) {
    return this._memory.readSigned32(this.translateAddress(segment, offset));
  }

  write32(segment, offset, value) {
    return this._memory.write32(this.translateAddress(segment, offset), value);
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

    // Write 16-bit word to memory at the effective address
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
      const modRM = this.read8(this.cs, this.ip);
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
        sib = this.read8(this.cs, this.ip);
        this.ip++;
      }

      // Read displacement
      // Displacement is 0 if (mod == 0)
      if (mod == 0 && rm == 5) {
        // In this particular case, the effective address is given
        // by the unsigned displacement and not computed.
        instruction.offset = this.read32(this.cs, this.ip);
        this.ip += 4;
      } else if (mod == 1) {
        // When mod is 1, the displacement is 1 byte sign-extended.
        // disp8[REG] where REG is given by the r/m tag.
        instruction.displacement = this.readSigned8(this.cs, this.ip);
        this.ip++;
      } else if (mod == 2) {
        // When mod is 2, the displacement is a 32-bit value.
        // disp32[REG] where REG is given by the r/m tag.
        instruction.displacement = this.readSigned32(this.cs, this.ip);
        this.ip += 4;
      } else if (mod == 3) {
        // No displacement. The register is the destination.
        instruction.operandRegister = rm;
      }

      // Compute the effective address (if needed)
      if (instruction.offset === undefined && mod != 3) {
        // The default segment for real addressing is DS
        if (instruction.segment === undefined) {
          instruction.segment = this.ds;
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
          case 4: // SIB + DISP
            const scale = 1 << (sib >> 6);
            const index = (sib >> 3) & 0x7;
            const base = sib & 0x7;

            if (index != 4) {
              instruction.offset =
                this.readRegister32(index) * scale +
                this.readRegister32(base) +
                instruction.displacement;
            } else {
              instruction.offset = this.readRegister32(base) + instruction.displacement;
            }
            break;
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

        // Address calculation overflows without applause.
        if (instruction.offset) {
          instruction.offset &= 0xffff;
        }
      }
    } else {
      return super.readModRM(instruction);
    }
  }

  /**
   * Decodes the next instruction.
   */
  decode(instruction) {
    if (
      instruction.segment === undefined &&
      !instruction.operandOverride &&
      !instruction.addressOverride
    ) {
      this._stackTrace[this._stackIndex] = [this.cs, this.ip];
      this._stackIndex = (this._stackIndex + 1) % 10;
      //console.log(this.cs.toString(16) + ":" + this.ip.toString(16));
      this.debug(this.cs.toString(16) + ':' + this.ip.toString(16));
    }

    if (instruction.addressOverride === undefined && this.retrieveDescriptor(this.cs).addressSize) {
      console.log('Address+Operand Override!!');
      instruction.addressOverride = true;
      instruction.operandOverride = true;
    }

    instruction.cs = this.cs;
    instruction.ip = this.ip;
    instruction.subOpcode = 0;

    // Read a 8-bit byte from memory at the current instruction pointer
    instruction.opcode = this.read8(this.cs, this.ip);
    this.ip++;

    // Decode possible two-byte opcodes
    switch (instruction.opcode) {
      case 0x0f: // Possible near JMP
        // Read the next byte
        const subCode = this.read8(this.cs, this.ip);

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

    // Number of immediate bytes to read (to be determined)
    const immediateBytes = 0;

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
        case 0xa0: // MOV AL,xb
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
          instruction.immediate = this.read32(this.cs, this.ip);
          this.ip += 4;
          break;

        // Double-word argument instructions
        case 0x9a: // CALL far cd
        case 0xea: // JMP far cd
          instruction.immediate = this.read32(this.cs, this.ip);
          this.ip += 4;

          instruction.targetCS = this.read16(this.cs, this.ip);
          this.ip += 2;
          break;

        case 0x66: // Operand Override
          instruction.operandOverride = !instruction.operandOverride;
          instruction = this.decode(instruction);
          break;

        case 0x67: // Address-Size Override
          //console.log("address override!");
          instruction.addressOverride = !instruction.addressOverride;
          instruction = this.decode(instruction);
          break;

        // R-Type + 32-bit immediate
        case 0x69: // IMUL rw,ew,dw
        case 0x81: // ADC ew,dw / ADD ew,dw / AND ew,dw / CMP ew,dw /
        // OR ew,dw / SBB ew,dw / SUB ew,dw / XOR ew,dw
        case 0xc7: // MOV ew,dw
        case 0x400: // Special case for R-Type options of two-byte opcodes
          this.readModRM(instruction);

          instruction.immediate = this.read32(this.cs, this.ip);
          this.ip += 4;
          break;

        // R-Type, 8-bit immediate
        case 0x6b: // IMUL rw,db / IMUL rw,ew,db
        case 0x300: // Special cases
          this.readModRM(instruction);

          instruction.immediate = this.read8(this.cs, this.ip);
          this.ip++;
          break;

        case 0xff:
        case 0x100: // R-Type without immediate
          this.readModRM(instruction);
          break;

        case 0x9b:
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
          instruction.immediate = this.read16(this.cs, this.ip);
          this.ip += 2;
          break;

        case 0x200: // 8-bit immediate
          instruction.immediate = this.read8(this.cs, this.ip);
          this.ip++;
          break;

        case 0x100: // R-Type without immediate
          this.readModRM(instruction);
          break;

        case 0x66: // Operand Override
          //console.log("operand override!");
          instruction.operandOverride = !instruction.operandOverride;
          instruction = this.decode(instruction);
          break;

        case 0x67: // Address-Size Override
          //console.log("address override!");
          instruction.addressOverride = !instruction.addressOverride;
          instruction = this.decode(instruction);
          break;

        case 0x9b:
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
  execute(instruction) {
    // Get the internal opcode
    const opcode = instruction.opcode | instruction.subOpcode;

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
        case 0x47: // INC DI
          //console.log('inc    +ER  ');
          const incDestination = opcode - 0x40;

          this.writeRegister32(
            incDestination,
            this._alu.inc32(this.readRegister32(incDestination))
          );
          break;

        case 0x50: // PUSH AX
        case 0x51: // PUSH CX
        case 0x52: // PUSH DX
        case 0x53: // PUSH BX
        case 0x54: // PUSH SP
        case 0x55: // PUSH BP
        case 0x56: // PUSH SI
        case 0x57: // PUSH DI
          //console.log('push32 +R   ');
          const pushDestination = opcode - 0x50;

          this.push32(this.readRegister32(pushDestination));
          break;

        case 0x58: // POP AX
        case 0x59: // POP CX
        case 0x5a: // POP DX
        case 0x5b: // POP BX
        case 0x5c: // POP SP
        case 0x5d: // POP BP
        case 0x5e: // POP SI
        case 0x5f: // POP DI
          const popDestination = opcode - 0x58;
          //console.log('pop32  ' + I386.REGISTERS_G32[popDestination]);

          this.writeRegister32(popDestination, this.pop32());
          break;

        case 0x60: // PUSHAD
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
            const imulResult = this._alu.imul32(
              this.readOperand32(instruction),
              this._alu.toSigned32(instruction.immediate)
            );

            if (this._alu.toSigned32(imulResult) != this._alu.toSigned32(imulResult & 0xffffffff)) {
              this.flags.carry = true;
              this.flags.overflow = true;
            } else {
              this.flags.carry = false;
              this.flags.overflow = false;
            }

            this.writeRegister32(instruction.sourceRegister, imulResult);
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

            if (
              this._alu.toSigned32(Number(imulResult)) !=
              this._alu.toSigned32(Number(imulResult) & 0xffffffff)
            ) {
              this.flags.carry = true;
              this.flags.overflow = true;
            } else {
              this.flags.carry = false;
              this.flags.overflow = false;
            }

            this.writeRegister32(instruction.sourceRegister, Number(imulResult & 0xffffffffn));
          }
          break;

        case 0x81: // ADC ew,dw / ADD ew,dw / AND ew,dw / CMP ew,dw /
        // OR ew,dw / SBB ew,dw / SUB ew,dw / XOR ew,dw
        case 0x83: // ADC ew,db / ADD ew,db / CMP ew,db / SBB ew,db /
          // SUB ew,db
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

        case 0x8c: // MOV ew,ES / MOV ew,CS / MOV ew,SS / MOV ew,DS / MOV ew,FS / MOV ew,GS
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

        case 0x8e: // MOV ES,mw / MOV ES,rw / MOV SS,mw / MOV SS,rw /
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
          this.writeSegmentRegister(movDestination, this.readOperand16(instruction));
          break;

        case 0xa1: // MOV EAX,xw
          this.debug('mov    EAX,xw');
          this.writeRegister32(
            I386.REGISTER_EAX,
            this.read32(instruction.segment || this.ds, instruction.immediate)
          );
          break;

        case 0xa3: // MOV xw,EAX
          this.debug('mov    xw,EAX');
          this.write32(instruction.segment || this.ds, instruction.immediate, this.eax);
          break;

        case 0xa4: // MOVS mb,mb / MOVSB
        case 0xa5: // MOVS mw,mw / MOVSW
          //console.log('movs32 mb/mw');
          while (!instruction.repeat || this.cx != 0) {
            // No segment overrides are allowed.
            if (instruction.opcode == 0xa4) {
              //console.log("MOVS WRITE", this.es, this.di, instruction.segment || this.ds, this.si, this.read8(instruction.segment || this.ds, this.si));
              this.write8(
                this.es,
                instruction.addressOverride ? this.edi : this.di,
                this.read8(
                  instruction.segment || this.ds,
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
                  instruction.segment || this.ds,
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
                  instruction.segment || this.ds,
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
                  instruction.segment || this.ds,
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
                instruction.segment || this.ds,
                instruction.addressOverride ? this.esi : this.si
              );
              if (instruction.addressOverride) {
                this.esi += this._flags.direction ? -1 : 1;
              } else {
                this.si += this._flags.direction ? -1 : 1;
              }
            } else {
              this.eax = this.read32(
                instruction.segment || this.ds,
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
        case 0xbf: // MOV EDI,dw
          //console.log('mov    +ER,dw', instruction.immediate.toString(16));
          const movWordDestination = opcode - 0xb8;
          this.writeRegister32(movWordDestination, instruction.immediate);
          break;

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

        case 0x9b:
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

        case 0xf7: // DIV ew / IDIV ew / IMUL ew / MUL ew /
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
            case 0x4: // MUL ew
              //console.log('mul32  ew   ');
              const mulResult = this._alu.mul32(this.eax, aluWordOperand);
              this.edx = Number((mulResult >> 32n) & 0xffffffffn);
              this.eax = Number(mulResult & 0xffffffffn);
              break;
            case 0x5: // IMUL ew
              //console.log('imul32 ew   ');
              const imulResult = this._alu.imul32(this.eax, aluWordOperand);
              this.edx = Number((imulResult >> 32n) & 0xffffffffn);
              this.eax = Number(imulResult & 0xffffffffn);
              break;
            case 0x6: // DIV ew
              //console.log('div32  ew   ');
              const divOperand = (BigInt(this.edx) << 32n) | BigInt(this.eax);
              const divResult = this._alu.div32(divOperand, aluWordOperand);
              this.edx = Number((divResult >> 32n) & 0xffffffffn);
              this.eax = Number(divResult & 0xffffffffn);
              break;
            case 0x7: // IDIV ew
              //console.log('idiv32 ew   ');
              const idivResult = this._alu.idiv32(this.eax, aluWordOperand);
              this.edx = Number((idivResult >> 32n) & 0xffffffffn);
              this.eax = Number(idivResult & 0xffffffffn);
              break;
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
            let imulResult = this._alu.imul32(
              this.readOperand32(instruction),
              this.readRegister32(instruction.sourceRegister)
            );

            imulResult = Number(imulResult & 0xffffffffn);

            if (this._alu.toSigned32(imulResult) != this._alu.toSigned32(imulResult & 0xffff)) {
              this.flags.carry = true;
              this.flags.overflow = true;
            } else {
              this.flags.carry = false;
              this.flags.overflow = false;
            }

            this.writeRegister32(instruction.sourceRegister, imulResult);
          }
          break;

        case 0x1b2: // LSS
        case 0x1b4: // LFS
        case 0x1b5: // LGS
          if (instruction.segment === undefined) {
            throw new InvalidInstruction(instruction);
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

        case 0x3a4: // SHLD r/m32, r32, imm8
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

        case 0x3ac: // SHRD r/m32, r32, imm8
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

        default:
          // Unknown
          console.log('error: executing unknown opcode', instruction);
          throw new InvalidInstruction(instruction);
      }
    } else if (instruction.addressOverride) {
      // Decode wide instructions using the address prefix
      switch (instruction.opcode) {
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

        case 0x9b:
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
        case 0x8c: // MOV ew,ES / MOV ew,CS / MOV ew,SS / MOV ew,DS / MOV ew,FS / MOV ew,GS
          //console.log('mov    ew,+S');
          const movSource = instruction.modifier;
          if (movSource >= 6) {
            // Invalid
            throw new InvalidInstruction(instruction);
          }

          //console.log("writing from segment", movSource, this._segmentRegisters[movSource], "to", instruction);
          this.writeOperand16(instruction, this.readSegmentRegister(movSource));
          break;

        case 0x8e: // MOV ES,mw / MOV ES,rw / MOV SS,mw / MOV SS,rw /
          // MOV DS,mw / MOV DS,rw / MOV FS,rw / MOV GS,rw
          //console.log('mov    +S,rm');
          const movDestination = instruction.modifier;
          if (movDestination >= 6 || movDestination == 1) {
            // Invalid
            throw new InvalidInstruction(instruction, () => {
              this.raiseUndefinedOpcode(instruction);
            });
          }
          this.writeSegmentRegister(movDestination, this.readOperand16(instruction));
          break;

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
          if (instruction.segment === undefined) {
            throw new InvalidInstruction(instruction);
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

        case 0x1bf: // MOVSX mw,mw
          // Sign extends word to double-word
          //console.log("movsx mw", this._alu.toSigned16(this.readOperand16(instruction)));
          this.writeRegister32(
            instruction.sourceRegister,
            this._alu.toSigned16(this.readOperand16(instruction))
          );
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
        case 0x48f: // JG near cb / JNLE cb
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

        case 0x9b:
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
