// Much of this is thanks to documentation and the DOSBox implementation (GPLv2).

export class X87 {
  declare _control: any;
  declare _cpu: any;
  declare _flags: any;
  declare _registers: any;
  declare _tags: any;
  declare _view: any;
  declare round: any;
  declare writeRegister: any;
  declare static BIAS64: any;
  declare static BIAS80: any;
  declare static L2E: any;
  declare static L2T: any;
  declare static LG2: any;
  declare static LN2: any;
  declare static ROUND_CHOP: any;
  declare static ROUND_DOWN: any;
  declare static ROUND_NEAREST: any;
  declare static ROUND_UP: any;
  declare static TAG_EMPTY: any;
  declare static TAG_VALID: any;
  declare static TAG_WEIRD: any;
  declare static TAG_ZERO: any;
  constructor(cpu) {
    this._cpu = cpu;

    const bytes = new Uint8Array(16);
    this._view = new DataView(bytes.buffer);
    this._registers = new Array(9);

    this.reset(true);
  }

  /**
   * Returns the attached CPU.
   */
  get cpu() {
    return this._cpu;
  }

  get flags() {
    return this._flags;
  }

  set flags(value) {
    this._flags = value;
  }

  get tags() {
    return this._tags;
  }

  set tags(value) {
    this._tags = value;
  }

  get b() {
    return (this._flags & 0x8000) > 0;
  }

  set b(value: boolean | number) {
    if (value) {
      this._flags |= 0x8000;
    } else {
      this._flags &= ~0x8000;
    }
  }

  get c3() {
    return (this._flags & 0x4000) > 0;
  }

  set c3(value: boolean | number) {
    if (value) {
      this._flags |= 0x4000;
    } else {
      this._flags &= ~0x4000;
    }
  }

  get top() {
    return (this._flags >> 11) & 0x7;
  }

  set top(value) {
    this._flags &= ~(0x7 << 11);
    this._flags |= (value & 0x7) << 11;
  }

  get c2() {
    return (this._flags & 0x400) > 0;
  }

  set c2(value: boolean | number) {
    if (value) {
      this._flags |= 0x400;
    } else {
      this._flags &= ~0x400;
    }
  }

  get c1() {
    return (this._flags & 0x200) > 0;
  }

  set c1(value: boolean | number) {
    if (value) {
      this._flags |= 0x200;
    } else {
      this._flags &= ~0x200;
    }
  }

  get c0() {
    return (this._flags & 0x100) > 0;
  }

  set c0(value: boolean | number) {
    if (value) {
      this._flags |= 0x100;
    } else {
      this._flags &= ~0x100;
    }
  }

  get es() {
    return (this._flags & 0x80) > 0;
  }

  set es(value: boolean | number) {
    if (value) {
      this._flags |= 0x80;
    } else {
      this._flags &= ~0x80;
    }
  }

  get sf() {
    return (this._flags & 0x40) > 0;
  }

  set sf(value: boolean | number) {
    if (value) {
      this._flags |= 0x40;
    } else {
      this._flags &= ~0x40;
    }
  }

  get pe() {
    return (this._flags & 0x20) > 0;
  }

  set pe(value: boolean | number) {
    if (value) {
      this._flags |= 0x20;
    } else {
      this._flags &= ~0x20;
    }
  }

  get ue() {
    return (this._flags & 0x10) > 0;
  }

  set ue(value: boolean | number) {
    if (value) {
      this._flags |= 0x10;
    } else {
      this._flags &= ~0x10;
    }
  }

  get oe() {
    return (this._flags & 0x8) > 0;
  }

  set oe(value: boolean | number) {
    if (value) {
      this._flags |= 0x8;
    } else {
      this._flags &= ~0x8;
    }
  }

  get ze() {
    return (this._flags & 0x4) > 0;
  }

  set ze(value: boolean | number) {
    if (value) {
      this._flags |= 0x4;
    } else {
      this._flags &= ~0x4;
    }
  }

  get de() {
    return (this._flags & 0x2) > 0;
  }

  set de(value: boolean | number) {
    if (value) {
      this._flags |= 0x2;
    } else {
      this._flags &= ~0x2;
    }
  }

  get ie() {
    return (this._flags & 0x1) > 0;
  }

  set ie(value: boolean | number) {
    if (value) {
      this._flags |= 0x1;
    } else {
      this._flags &= ~0x1;
    }
  }

  get control() {
    return this._control;
  }

  set control(value) {
    this._control = value;
  }

  readTag(index) {
    return (this._tags >> (2 * index)) & 0x3;
  }

  writeTag(index, value) {
    this._tags &= ~(0x3 << (2 * index));
    this._tags |= (value & 0x3) << (2 * index);
  }

  readOperandF32(instruction) {
    if (instruction.operandRegister !== undefined) {
      return instruction.operandRegister;
    }

    // Read byte from memory at the effective address
    this.fld32(instruction.segment, instruction.offset, 8);
    return 8;
  }

  readOperandF64(instruction) {
    if (instruction.operandRegister !== undefined) {
      return instruction.operandRegister;
    }

    // Read byte from memory at the effective address
    this.fld64(instruction.segment, instruction.offset, 8);
    return 8;
  }

  readRegister64(index) {
    return this._registers[(this.top + index) & 0x7];
  }

  writeRegister64(index, value) {
    this._registers[(this.top + index) & 0x7] = value;
  }

  reset(clearRegisters = true) {
    // Clear registers and tags
    this._registers.forEach((_, i) => {
      if (clearRegisters) {
        this._registers[i] = 0;
      }
      this.writeTag(i, X87.TAG_EMPTY);
    });

    // Clear flags
    this.flags = 0;

    // Set control word to default
    this.control = 0x37f;
  }

  decode(instruction) {
    instruction.opcode = this.cpu.read8(this.cpu.cs, this.cpu.ip);
    this.cpu.ip++;

    switch (instruction.opcode) {
      case 0x9b: // FWAIT prefix
        instruction = this.decode(instruction);
        instruction.fwait = true;
        return instruction;

      case 0xd8:
      // FADD m32fp / FADD ST(0), ST(i)
      // FMUL m32fp / FMUL ST(0), ST(i)
      // FCOM m32fp / FCOM ST(i)
      // FCOMP m32fp / FCOMP ST(i)
      // FSUB m32fp / FSUB ST(0), ST(i)
      // FSUBR m32fp / FSUBR ST(0), ST(i)
      // FDIV m32fp / FDIV ST(0), ST(i)
      // FDIVR m32fp / FDIVR ST(0), ST(i)

      case 0xd9:
      // FLD m32fp / FLD ST(i)
      // -- / FXCH ST(0), ST(i)
      // FST m32fp / FNOP (0xd0)
      // FSTP m32fp / --
      // FLDENV m14/28byte / -- (0xe7) / -- (0xe6)
      //                   / FXAM (0xe5) / FTST (0xe4)
      //                   / -- (0xe3) / -- (0xe2)
      //                   / FABS (0xe1) / FCHS (0xe0)
      // FLDCW m2byte / -- (0xef) / FLDZ (0xee)
      //              / FLDLN2 (0xed) / FLDLG2 (0xec)
      //              / FLDPI (0xeb) / FLDL2E (0xea)
      //              / FLDL2T (0xe9) / FLD1 (0xe8)
      // FSTENV m14/28byte / FINCSTP (0xf7) / FDECSTP (0xf6)
      //                   / FPREM1 (0xf5) / -- (0xf3)
      //                   / FPATAN (0xf3) / FPTAN (0xf2)
      //                   / FYL2X (0xf1) / F2XM1 (0xf0)
      // FSTCW m2byte / FCOS (0xff) / FSIN (0xfe)
      //              / FSCALE (0xfd) / FRNDINT (0xfc)
      //              / FSINCOS (0xfb) / FSQRT (0xfa)
      //              / FYL2XP1 (0xf9) / FPREM (0xf8)

      case 0xda:
      // FIADD m32int / --
      // FIMUL m32int / --
      // FICOM m32int / --
      // FICOMP m32int / --
      // FISUB m32int / --
      // FISUBR m32int / FUCOMPP
      // FIDIV m32int / --
      // FIDIVR m32int / --

      case 0xdb:
      // FILD m32int / --
      // FISTTP m32int / --
      // FIST m32int / --
      // FISTP m32int / --
      // -- / FCLEX (0xe2) / FINIT (0xe3)
      // FLD m80fp / FUCOMI ST(0), ST(i)
      // -- / FCOMI ST(0), ST(i)
      // FSTP m80fp / --

      case 0xdc:
      // FADD m64fp / FADD ST(i), ST(0)
      // FMUL m64fp / FMUL ST(i), ST(0)
      // FCOM f64fp / --
      // FCOMP m64fp / --
      // FSUB m64fp / FSUBR ST(i), ST(0)
      // FSUBR m64fp / FSUB ST(i), ST(0)
      // FDIV m64fp / FDIVR ST(i), ST(0)
      // FDIVR m64fp / FDIV ST(i), ST(0)

      case 0xdd:
      // FLD m64fp / FFREE ST(i)
      // FISTTP m64int / --
      // FST m64fp / FST ST(i)
      // FSTP m64fp / FSTP ST(i)
      // FRSTOR m94/108byte / FUCOM ST(i)
      // -- / FUCOMP ST(i)
      // FSAVE m94/108byte / --
      // FSTSW m2byte / --

      case 0xde:
      // FIADD m16int / FADD ST(i), ST(0)
      // FIMUL m16int / FMUL ST(i), ST(0)
      // FICOM m16int / --
      // FICOMP m16int / FCOMPP (0xd9)
      // FISUB m16int / FSUBR ST(i), ST(0)
      // FISUBR m16int / FSUB ST(i), ST(0)
      // FIDIV m16int / FDIVR ST(i), ST(0)
      // FIDIVR m16int / FDIV ST(i), ST(0)

      case 0xdf:
        // FILD m16int / --
        // FISTTP m16int / --
        // FIST m16int / --
        // FISTP m16int / --
        // FBLD m80bcd / FNSTSW AX
        // FILD m64int / FUCOMIP ST(0), ST(i)
        // FBSTP m80bcd / FCOMIP ST(0), ST(i)
        // FISTP m64int / --
        this.cpu.readModRM(instruction);
        break;
    }

    return instruction;
  }

  execute(instruction) {
    switch (instruction.opcode) {
      case 0xd8:
        switch (instruction.modifier) {
          case 0: // FADD m32fp / FADD ST(0), ST(i)
            this.fadd(0, this.readOperandF32(instruction));
            break;

          case 1: // FMUL m32fp / FMUL ST(0), ST(i)
            this.fmul(0, this.readOperandF32(instruction));
            break;

          case 2: // FCOM m32fp / FCOM ST(i)
            this.fcom(0, this.readOperandF32(instruction));
            break;

          case 3: // FCOMP m32fp / FCOMP ST(i)
            this.fcom(0, this.readOperandF32(instruction));
            this.fpop();
            break;

          case 4: // FSUB m32fp / FSUB ST(0), ST(i)
            this.fsub(0, this.readOperandF32(instruction));
            break;

          case 5: // FSUBR m32fp / FSUBR ST(0), ST(i)
            this.fsubr(0, this.readOperandF32(instruction));
            break;

          case 6: // FDIV m32fp / FDIV ST(0), ST(i)
            this.fdiv(0, this.readOperandF32(instruction));
            break;

          case 7: // FDIVR m32fp / FDIVR ST(0), ST(i)
            this.fdivr(0, this.readOperandF32(instruction));
            break;
        }
        break;

      case 0xd9:
        switch (instruction.modifier) {
          case 0: // FLD m32fp / FLD ST(i)
            const index = this.readOperandF32(instruction);
            this.fpush(this._registers[index]);
            break;

          case 1: // -- / FXCH ST(0), ST(i)
            if (instruction.operandRegister !== undefined) {
              this.fxch(0, instruction.operandRegister);
            } else {
              // Invalid
              throw 'Invalid d9/1';
            }
            break;

          case 2: // FST m32fp / FNOP (0xd0)
            if (instruction.operandRegister !== undefined) {
              // FNOP only when the mod/rm byte is 0xd0
              // Therefore, when operand register is 0x0
            } else {
              this.fst32(instruction.segment, instruction.offset);
            }
            break;

          case 3: // FSTP m32fp / --
            if (instruction.operandRegister !== undefined) {
              // Invalid
              throw 'Invalid d9/3';
            } else {
              this.fst32(instruction.segment, instruction.offset);
              this.fpop();
            }
            break;

          case 4: // FLDENV m14/28byte / -- (0xe7) / -- (0xe6)
            //                   / FXAM (0xe5) / FTST (0xe4)
            //                   / -- (0xe3) / -- (0xe2)
            //                   / FABS (0xe1) / FCHS (0xe0)
            throw 'Invalid d9/4';
            break;

          case 5: // FLDCW m2byte / -- (0xef) / FLDZ (0xee)
            //              / FLDLN2 (0xed) / FLDLG2 (0xec)
            //              / FLDPI (0xeb) / FLDL2E (0xea)
            //              / FLDL2T (0xe9) / FLD1 (0xe8)
            throw 'Invalid d9/5';
            break;

          case 6: // FSTENV m14/28byte / FINCSTP (0xf7) / FDECSTP (0xf6)
            //                   / FPREM1 (0xf5) / -- (0xf3)
            //                   / FPATAN (0xf3) / FPTAN (0xf2)
            //                   / FYL2X (0xf1) / F2XM1 (0xf0)
            throw 'Invalid d9/6';
            break;

          case 7: // FSTCW m2byte / FCOS (0xff) / FSIN (0xfe)
            //              / FSCALE (0xfd) / FRNDINT (0xfc)
            //              / FSINCOS (0xfb) / FSQRT (0xfa)
            //              / FYL2XP1 (0xf9) / FPREM (0xf8)
            throw 'Invalid d9/7';
            break;
        }
        break;

      case 0xda:
        switch (instruction.modifier) {
          case 0: // FIADD m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/0';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fadd(0, 8);
            }
            break;

          case 1: // FIMUL m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/1';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fmul(0, 8);
            }
            break;

          case 2: // FICOM m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/2';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fcom(0, 8);
            }
            break;

          case 3: // FICOMP m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/3';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fcom(0, 8);
              this.fpop();
            }
            break;

          case 4: // FISUB m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/4';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fsub(0, 8);
            }
            break;

          case 5: // FISUBR m32int / FUCOMPP
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/5';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fsubr(0, 8);
            }
            break;

          case 6: // FIDIV m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/6';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fdiv(0, 8);
            }
            break;

          case 7: // FIDIVR m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid da/7';
            } else {
              this._registers[8] = this.cpu.readOperand32(instruction);
              this.fdivr(0, 8);
            }
            break;
        }
        break;

      case 0xdb:
        switch (instruction.modifier) {
          case 0: // FILD m32int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid db/0';
            } else {
              this.fpush(this.cpu.readOperand32(instruction));
            }
            break;

          case 1: // FISTTP m32int / --
            // TODO
            throw 'Invalid db/1';
            break;

          case 2: // FIST m32int / --
            // TODO
            throw 'Invalid db/2';
            break;

          case 3: // FISTP m32int / --
            // TODO
            throw 'Invalid db/3';
            break;

          case 4: // -- / FCLEX (0xe2) / FINIT (0xe3)
            if (instruction.operandRegister !== undefined) {
              if (instruction.operandRegister == 0x2) {
                // FCLEX
                this.fclex();
              } else if (instruction.operandRegister == 0x3) {
                // FINIT
                this.reset(false);
              } else {
                throw 'Invalid db/4r';
              }
            } else {
              throw 'Invalid db/4m';
            }
            break;

          case 5: // FLD m80fp / FUCOMI ST(0), ST(i)
            if (instruction.operandRegister !== undefined) {
            } else {
              this.fld80(instruction.segment, instruction.offset, 8);
              this.fpush(this._registers[8]);
            }
            break;

          case 6: // -- / FCOMI ST(0), ST(i)
            if (instruction.operandRegister !== undefined) {
              // TODO
              throw 'Invalid db/6';
            } else {
              throw 'Invalid db/6m';
            }
            break;

          case 7: // FSTP m80fp / --
            throw 'Invalid db/7';
            break;
        }
        break;

      case 0xdc:
        switch (instruction.modifier) {
          case 0: // FADD m64fp / FADD ST(i), ST(0)
            this.fadd(0, this.readOperandF64(instruction));
            break;

          case 1: // FMUL m64fp / FMUL ST(i), ST(0)
            this.fmul(0, this.readOperandF64(instruction));
            break;

          case 2: // FCOM f64fp / --
            throw 'Invalid dc/2';
            break;

          case 3: // FCOMP m64fp / --
            throw 'Invalid dc/3';
            break;

          case 4: // FSUB m64fp / FSUBR ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fsubr(0, this.readOperandF64(instruction));
            } else {
              this.fsub(0, this.readOperandF64(instruction));
            }
            break;

          case 5: // FSUBR m64fp / FSUB ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fsub(0, this.readOperandF64(instruction));
            } else {
              this.fsubr(0, this.readOperandF64(instruction));
            }
            break;

          case 6: // FDIV m64fp / FDIVR ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fdivr(0, this.readOperandF64(instruction));
            } else {
              this.fdiv(0, this.readOperandF64(instruction));
            }
            break;

          case 7: // FDIVR m64fp / FDIV ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fdiv(0, this.readOperandF64(instruction));
            } else {
              this.fdivr(0, this.readOperandF64(instruction));
            }
            break;
        }
        break;

      case 0xdd:
        switch (instruction.modifier) {
          case 0: // FLD m64fp / FFREE ST(i)
            if (instruction.operandRegister !== undefined) {
              // TODO FFREE
              throw 'Invalid dd/0';
            } else {
              const index = this.readOperandF64(instruction);
              this.fpush(this._registers[index]);
            }
            break;

          case 1: // FISTTP m64int / --
            // TODO
            throw 'Invalid dd/1';
            break;

          case 2: // FST m64fp / FST ST(i)
            // TODO
            throw 'Invalid dd/2';
            break;

          case 3: // FSTP m64fp / FSTP ST(i)
            if (instruction.operandRegister !== undefined) {
              this.writeRegister64(instruction.operandRegister, this.readRegister64(0));
            } else {
              this.fst64(instruction.segment, instruction.offset);
            }
            this.fpop();
            break;

          case 4: // FRSTOR m94/108byte / FUCOM ST(i)
            if (instruction.operandRegister !== undefined) {
              this.fucom(0, instruction.operandRegister);
            } else {
              this.frstor(
                instruction.operandOverride ? 32 : 16,
                instruction.segment,
                instruction.offset
              );
            }
            break;

          case 5: // -- / FUCOMP ST(i)
            if (instruction.operandRegister !== undefined) {
              this.fucom(0, instruction.operandRegister);
              this.fpop();
            } else {
              throw 'Invalid dd/5m';
            }
            break;

          case 6: // FSAVE m94/108byte / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid dd/6';
            } else {
              this.fsave(
                instruction.operandOverride ? 32 : 16,
                instruction.segment,
                instruction.offset
              );
            }
            break;

          case 7: // FSTSW m2byte / --
            // TODO
            throw 'Invalid dd/7';
            break;
        }
        break;

      case 0xde:
        switch (instruction.modifier) {
          case 0: // FIADD m16int / FADDP ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fadd(instruction.operandRegister, 0);
              this.fpop();
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fadd(0, 8);
            }
            break;

          case 1: // FIMUL m16int / FMULP ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fmul(instruction.operandRegister, 0);
              this.fpop();
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fmul(0, 8);
            }
            break;

          case 2: // FICOM m16int / --
            if (instruction.operandRegister !== undefined) {
              throw 'Invalid de/2';
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fcom(0, 8);
            }
            break;

          case 3: // FICOMP m16int / FCOMPP (0xd9)
            if (instruction.operandRegister !== undefined) {
              if (instruction.operandRegister == 0x1) {
                // FCOMPP
                this.fcom(0, 1);
                this.fpop();
              } else {
                throw 'Invalid de/3';
              }
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fcom(0, 8);
            }
            this.fpop();
            break;

          case 4: // FISUB m16int / FSUBRP ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fsubr(instruction.operandRegister, 0);
              this.fpop();
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fsub(0, 8);
            }
            break;

          case 5: // FISUBR m16int / FSUBP ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fsub(instruction.operandRegister, 0);
              this.fpop();
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fsubr(0, 8);
            }
            break;

          case 6: // FIDIV m16int / FDIVRP ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fdivr(instruction.operandRegister, 0);
              this.fpop();
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fdiv(0, 8);
            }
            break;

          case 7: // FIDIVR m16int / FDIVP ST(i), ST(0)
            if (instruction.operandRegister !== undefined) {
              this.fdiv(instruction.operandRegister, 0);
              this.fpop();
            } else {
              this._registers[8] = this.cpu.readOperand16(instruction);
              this.fdivr(0, 8);
            }
            break;
        }
        break;

      case 0xdf:
        switch (instruction.modifier) {
          case 0: // FILD m16int / --
            this.fpush(this.cpu.readOperand16(instruction));
            break;

          case 1: // FISTTP m16int / --
            throw 'Invalid df/1';
            break;

          case 2: // FIST m16int / --
            throw 'Invalid df/2';
            break;

          case 3: // FISTP m16int / --
            throw 'Invalid df/3';
            break;

          case 4: // FBLD m80bcd / FNSTSW AX
            throw 'Invalid df/4';
            break;

          case 5: // FILD m64int / FUCOMIP ST(0), ST(i)
            throw 'Invalid df/5';
            break;

          case 6: // FBSTP m80bcd / FCOMIP ST(0), ST(i)
            throw 'Invalid df/6';
            break;

          case 7: // FISTP m64int / --
            throw 'Invalid df/7';
            break;
        }
        break;

      default:
        // Unknown
        throw 'HELLO FPU ERROR';
        break;
    }

    // Reset prefix flags
    instruction.fwait = false;
  }

  int32ToFloat32(value) {
    this._view.setUint32(0, value);
    return this._view.getFloat32(0);
  }

  float32ToInt32(value) {
    this._view.setFloat32(0, value);
    return this._view.getUint32(0);
  }

  int64ToFloat64(value) {
    this._view.setBigInt64(0, value);
    return this._view.getFloat64(0);
  }

  float64ToInt64(value) {
    this._view.setFloat64(0, value);
    return this._view.getBigInt64(0);
  }

  fpush(value) {
    this.top--;
    if (this.readTag(this.top) != X87.TAG_EMPTY) {
      // Stack overflow
      console.log('x87: Stack Overflow');
    }
    this.writeTag(this.top, X87.TAG_VALID); // Valid
    this.writeRegister64(0, value);
  }

  fpop() {
    this.writeTag(this.top, X87.TAG_EMPTY); // Empty
    this.top++;
  }

  fld32(segment, offset, index) {
    const addr = this.cpu.translateAddress(segment, offset);
    const int32 = this.cpu.memory.read32(addr);
    this._registers[index] = this.int32ToFloat32(int32);
  }

  fld64(segment, offset, index) {
    const addr = this.cpu.translateAddress(segment, offset);
    const int64 = this.cpu.memory.read64(addr);
    this._registers[index] = this.int64ToFloat64(int64);
  }

  fld80(segment, offset, index) {
    // We convert an 80-bit IEEE 754 value to a 64-bit one.
    // We do not implement a true 80-bit FPU (same as DOSBox)

    const addr = this.cpu.translateAddress(segment, offset);
    const mantissa80 = this.cpu.memory.read64(addr);
    const extra = this.cpu.memory.read16(addr + 8);

    // Convert the 80-bit bias to 64-bit bias
    const exp80 = extra & 0x7fff;
    let exp64 = exp80 - X87.BIAS80;

    // Truncate the bias to 10-bit 2's complement
    if (exp64 < 0) {
      exp64 = -(-exp64 & 0x3ff);
    } else {
      exp64 = exp64 & 0x3ff;
    }

    // Add the bias to get the final 11-bit exponent
    exp64 += X87.BIAS64;

    // Now, we get the 52-bit mantissa from the 63-bit mantissa
    // We truncate the most-significant bit of the mantissa since that
    // is the normalized integer representing 1.0 which is implied in
    // 64-bit and 32-bit IEEE 754 representations.
    let mantissa64 = (mantissa80 >> 11n) & 0xfffffffffffffn;
    const sign = extra & 0x8000 ? 0x8000000000000000n : 0n;

    // INF is when the exp80 is the maximum value and mantissa is 0
    // The top bit of the mantissa is the normalized integer '1'
    // This needs to exist, otherwise the number is denormalized
    if (mantissa80 == 0x8000000000000000n && (extra & 0x7fff) == 0x7fff) {
      exp64 = 0x3ff;
      mantissa64 = 0x0n;
    }

    // Combine to form a 64-bit IEEE 754 representation.
    // SIGN:1 | EXP:11 | MANTISSA:52
    const value = sign | (BigInt(exp64) << 52n) | mantissa64;

    // Convert to the actual float.
    this._registers[index] = this.int64ToFloat64(value);
  }

  fldi16(segment, offset, index) {
    this._registers[index] = this.cpu.read16(segment, offset);
  }

  fldi32(segment, offset, index) {
    this._registers[index] = this.cpu.read32(segment, offset);
  }

  fldi64(segment, offset, index) {
    const addr = this.cpu.translateAddress(segment, offset);
    this._registers[index] = this.cpu.memory.read64(addr);
  }

  fbld(segment, offset, index) {
    let value = 0;
    let base = 1;

    for (let i = 0; i < 9; i++) {
      const b = this.cpu.read8(segment, offset);
      offset++;
      value += (b & 0xf) * base;
      base *= 10;
      value += ((b >> 4) & 0xf) * base;
      base *= 10;
    }

    // Interpret last byte
    const b = this.cpu.read8(segment, offset);
    value += (b & 0xf) * base;
    if (b & 0x80) {
      value *= -1.0;
    }

    // Write
    this._registers[index] = value;
  }

  fst32(segment, offset) {
    const ST0 = this.readRegister64(0);
    const value = this.float32ToInt32(ST0);
    this.cpu.memory.write32(this.cpu.translateAddress(segment, offset), value);
  }

  fst64(segment, offset) {
    const ST0 = this.readRegister64(0);
    const value = this.float64ToInt64(ST0);
    this.cpu.memory.write64(this.cpu.translateAddress(segment, offset), value);
  }

  fst80(segment, offset, value) {
    const int64 = this.float64ToInt64(value);

    const sign64 = Number(int64 >> 63n);
    const exp64 = Number(int64 >> 52n) & 0x7ff;
    const mantissa64 = int64 & 0xfffffffffffffn;

    // Convert the 52-bit mantissa to a 63-bit mantissa
    let mantissa80 = mantissa64 << 11n;
    let exp80 = exp64;

    // Convert the 64-bit exponent to an 80-bit exponent
    if (value != 0) {
      // If it is not representing 0.0, add the 1.0 integer part
      mantissa80 |= 0x8000000000000000n;

      // Subtract the 64-bit bias and add back the 80-bit bias
      exp80 += X87.BIAS80 - X87.BIAS64;
    }

    const extra = (sign64 << 15) | exp80;

    const addr = this.cpu.translateAddress(segment, offset);
    this.cpu.memory.write64(addr, mantissa80);
    this.cpu.memory.write16(addr + 8, extra);
  }

  fsti16(segment, offset) {
    const value = this.fround(this.readRegister64(0));
    this.cpu.memory.write16(this.cpu.translateAddress(segment, offset), value);
  }

  fsti32(segment, offset) {
    const value = this.fround(this.readRegister64(0));
    this.cpu.memory.write32(this.cpu.translateAddress(segment, offset), value);
  }

  fsti64(segment, offset) {
    const value = this.fround(this.readRegister64(0));
    this.cpu.memory.write64(this.cpu.translateAddress(segment, offset), value);
  }

  fbst(segment, offset) {
    // TODO
    throw 'fbst not implemented';
  }

  fadd(a, b) {
    this._registers[a] += this._registers[b];
  }

  fsin() {
    this.writeRegister64(0, Math.sin(this.readRegister64(0)));
    this.c2 = 0;
  }

  fsincos() {
    const ST0 = this.readRegister64(0);
    this.writeRegister64(0, Math.sin(ST0));
    this.fpush(Math.cos(ST0));
    this.c2 = 0;
  }

  fcos() {
    this.writeRegister64(0, Math.cos(this.readRegister64(0)));
    this.c2 = 0;
  }

  fsqrt() {
    this.writeRegister64(0, Math.sqrt(this.readRegister64(0)));
  }

  fpatan() {
    const ST0 = this.readRegister64(0);
    const ST1 = this.readRegister64(1);
    this.writeRegister64(1, Math.atan2(ST1, ST0));
    this.fpop();
  }

  fptan() {
    this.writeRegister64(0, Math.tan(this.readRegister64(0)));
    this.fpush(1.0);
    this.c2 = 0;
  }

  fdiv(a, b) {
    this._registers[a] /= this._registers[b];
  }

  fdivr(a, b) {
    this._registers[a] = this._registers[b] / this._registers[a];
  }

  fmul(a, b) {
    this._registers[a] *= this._registers[b];
  }

  fsub(a, b) {
    this._registers[a] = this._registers[a] - this._registers[b];
  }

  fsubr(a, b) {
    this._registers[a] = this._registers[b] - this._registers[a];
  }

  fxch(a, b) {
    const tag = this.readTag(a);
    const reg = this._registers[a];
    this.writeTag(a, this.readTag(b));
    this._registers[a] = this._registers[b];
    this.writeTag(b, tag);
    this._registers[b] = reg;
  }

  fst(a, b) {
    this.writeTag(b, this.readTag(a));
    this._registers[b] = this._registers[a];
  }

  fcom(a, b) {
    if (
      (this.readTag(a) != X87.TAG_VALID && this.readTag(a) != X87.TAG_ZERO) ||
      (this.readTag(b) != X87.TAG_VALID && this.readTag(b) != X87.TAG_ZERO)
    ) {
      // Invalid
      this.c3 = 1;
      this.c2 = 1;
      this.c0 = 1;
    } else if (this._registers[a] == this._registers[b]) {
      // ST[A} == ST[B]
      this.c3 = 1;
      this.c2 = 0;
      this.c0 = 0;
    } else if (this._registers[a] < this._registers[b]) {
      // ST[A} < ST[B]
      this.c3 = 0;
      this.c2 = 0;
      this.c0 = 1;
    } else {
      // ST[A} > ST[B]
      this.c3 = 0;
      this.c2 = 0;
      this.c0 = 0;
    }
  }

  fucom(a, b) {
    // The same as fcom (just as DOSBox does)
    this.fcom(a, b);
  }

  frndint() {
    this.writeRegister64(0, this.fround(this.readRegister64(0)));
  }

  fclex() {
    this.control &= 0x7f00;
  }

  fround(value) {
    switch (this.round) {
      case X87.ROUND_NEAREST:
        value = Math.round(value);
        break;

      case X87.ROUND_DOWN:
        value = Math.floor(value);
        break;

      case X87.ROUND_UP:
        value = Math.ceil(value);
        break;

      case X87.ROUND_CHOP:
      default:
        // TODO: more accurate magnitude check?
        value = Math.round(value);
        break;
    }

    return value;
  }

  fprem() {
    // Q <- Math.floor(ST(0) / ST(1))
    // rem <- ST(0) - (Q * ST(1))
    // TODO: can this handle integers greater than 32 bits?
    const ST0 = this.readRegister64(0);
    const ST1 = this.readRegister64(1);
    const Q = Math.floor(ST0 / ST1);
    const rem = ST0 - Q * ST1;
    this.writeRegister64(0, rem);

    this.c0 = Q & 0x4;
    this.c3 = Q & 0x2;
    this.c1 = Q & 0x1;
    this.c2 = 0;
  }

  fprem1() {
    // Q <- Math.round(ST(0) / ST(1))
    // rem <- ST(0) - (Q * ST(1))
    // TODO: can this handle integers greater than 32 bits?
    const ST0 = this.readRegister64(0);
    const ST1 = this.readRegister64(1);
    const Q = Math.round(ST0 / ST1);
    const rem = ST0 - Q * ST1;
    this.writeRegister64(0, rem);

    this.c0 = Q & 0x4;
    this.c3 = Q & 0x2;
    this.c1 = Q & 0x1;
    this.c2 = 0;
  }

  fxam() {
    // Determine the size value
    const ST0 = this.readRegister64(0);
    const intValue = this.float64ToInt64(ST0);
    if (intValue & 0x8000000000000000n) {
      this.c1 = 1;
    } else {
      this.c1 = 0;
    }

    // Determine if it is empty
    if (this.readTag(this.top) == 0x11) {
      this.c3 = 1;
      this.c2 = 0;
      this.c0 = 1;
    }

    // Determine if it is zero / normalized
    if (ST0 == 0.0) {
      // Zero
      this.c3 = 1;
      this.c2 = 0;
      this.c0 = 0;
    } else {
      // Normal finite number
      this.c3 = 0;
      this.c2 = 1;
      this.c0 = 0;
    }

    if (isNaN(ST0)) {
      this.c3 = 0;
      this.c2 = 0;
      this.c0 = 1;
    }

    if (isNaN(ST0)) {
      this.c3 = 0;
      this.c2 = 0;
      this.c0 = 1;
    } else if (!isFinite(ST0)) {
      this.c3 = 0;
      this.c2 = 1;
      this.c0 = 1;
    }
  }

  f2xm1() {
    const ST0 = this.readRegister64(0);
    const value = Math.pow(2.0, ST0 - 1);
    this.writeRegister64(0, value);
  }

  fyl2x() {
    const ST0 = this.readRegister64(0);
    const ST1 = this.readRegister64(1);
    const value = ST1 * (Math.log(ST0) / Math.log(2.0));
    this.writeRegister64(1, value);
    this.fpop();
  }

  fyl2xp1() {
    const ST0 = this.readRegister64(0);
    const ST1 = this.readRegister64(1);
    const value = ST1 * (Math.log(ST0 + 1.0) / Math.log(2.0));
    this.writeRegister64(1, value);
    this.fpop();
  }

  fscale() {
    let ST0 = this.readRegister64(0);
    const ST1 = this.readRegister64(1);
    ST0 *= Math.pow(2.0, Math.round(ST1));
    this.writeRegister(0, ST0);
  }

  fstenv(size, segment, offset) {
    if (size == 16) {
      this.cpu.write16(segment, offset, this.control);
      this.cpu.write16(segment, offset + 2, this.flags);
      this.cpu.write16(segment, offset + 4, this.tags);
    } else {
      this.cpu.write32(segment, offset, this.control);
      this.cpu.write32(segment, offset + 4, this.flags);
      this.cpu.write32(segment, offset + 8, this.tags);
    }
  }

  fldenv(size, segment, offset) {
    if (size == 16) {
      this.control = this.cpu.read16(segment, offset);
      this.flags = this.cpu.read16(segment, offset + 2);
      this.tags = this.cpu.read16(segment, offset + 4);
    } else {
      this.control = this.cpu.read32(segment, offset) & 0xffff;
      this.flags = this.cpu.read32(segment, offset + 4) & 0xffff;
      this.tags = this.cpu.read32(segment, offset + 8) & 0xffff;
    }
  }

  fsave(size, segment, offset) {
    this.fstenv(size, segment, offset);
    offset += size == 16 ? 14 : 28;
    for (let i = 0; i < 8; i++) {
      this.fst80(segment, offset, this.readRegister64(i));
      offset += 10;
    }
    this.reset(false);
  }

  frstor(size, segment, offset) {
    this.fldenv(size, segment, offset);
    offset += size == 16 ? 14 : 28;
    for (let i = 0; i < 8; i++) {
      this.fld80(segment, offset, i);
      offset += 10;
    }
  }

  fxtract() {
    const ST0 = this.readRegister64(0);
    const int64 = this.float64ToInt64(ST0);
    const exp64 = int64 & BigInt(0x7ff0000000000000n);
    const exp80 = Number(exp64 >> 52n) - X87.BIAS64;

    const mantissa = ST0 / Math.pow(2.0, exp80);

    this.writeRegister64(0, exp80);
    this.fpush(mantissa);
  }

  fchs() {
    this.writeRegister64(0, -1.0 * this.readRegister64(0));
  }

  fabs() {
    this.writeRegister64(0, Math.abs(this.readRegister64(0)));
  }

  ftst() {
    this._registers[8] = 0.0;
    this.fcom(this.top, 8);
  }

  fld1() {
    this.fpush(1.0);
  }

  fldl2t() {
    this.fpush(X87.L2T);
  }

  fldl2e() {
    this.fpush(X87.L2E);
  }

  fldpi() {
    this.fpush(Math.PI);
  }

  fldlg2() {
    this.fpush(X87.LG2);
  }

  fldln2() {
    this.fpush(X87.LN2);
  }

  fldz() {
    this.fpush(0.0);
    this.writeTag(this.top, X87.TAG_ZERO);
  }
}

X87.TAG_VALID = 0x0;
X87.TAG_ZERO = 0x1;
X87.TAG_WEIRD = 0x2;
X87.TAG_EMPTY = 0x3;

X87.ROUND_NEAREST = 0x0;
X87.ROUND_DOWN = 0x1;
X87.ROUND_UP = 0x2;
X87.ROUND_CHOP = 0x3;

X87.L2E = 1.4426950408889634;
X87.L2T = 3.321928094887362;
X87.LN2 = 0.6931471805599453;
X87.LG2 = 0.3010299956639812;

X87.BIAS80 = 16383;
X87.BIAS64 = 1023;
