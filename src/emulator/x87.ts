/**
 * The 387 floating-point unit, as a Windows 3.1 program on a 386 sees it.
 *
 * Written from Intel's description of the instruction set: the stack of eight
 * registers addressed from `TOP`, the status word's condition codes, the
 * control word's rounding, and every instruction of the 8087, 287 and 387 a
 * sixteen-bit program can issue. The instructions the 486 and later added --
 * `FCMOV`, `FCOMI`, `FISTTP` -- are not here.
 *
 * Values are held as sixty-four-bit doubles, not the unit's eighty-bit
 * extended precision, as DOSBox holds them. Everything a program stores or
 * loads converts exactly where a double can hold the value; an eighty-bit
 * value with more precision than a double is rounded to nearest on the way
 * in. Exceptions are recorded in the status word as the unit records masked
 * ones, and never raised: every program seen runs with the control word
 * `FINIT` leaves, all exceptions masked.
 */

const TAG_VALID = 0;
const TAG_ZERO = 1;
const TAG_SPECIAL = 2;
const TAG_EMPTY = 3;

const ROUND_DOWN = 1;
const ROUND_UP = 2;
const ROUND_CHOP = 3;

/* Status word bits. */
const IE = 0x0001;
const ZE = 0x0004;
const SF = 0x0040;
const C0 = 0x0100;
const C1 = 0x0200;
const C2 = 0x0400;
const C3 = 0x4000;
const B = 0x8000;

/** The "indefinite" NaN a masked invalid operation leaves. */
const INDEFINITE = NaN;

export class X87 {
  declare _cpu: any;
  declare registers: Float64Array;
  /** Whether each physical register is empty. */
  declare empty: boolean[];
  declare status: number;
  declare control: number;

  constructor(cpu) {
    this._cpu = cpu;
    this.registers = new Float64Array(8);
    this.empty = new Array(8).fill(true);
    this.reset();
  }

  get cpu() {
    return this._cpu;
  }

  /** `FINIT`: the control word `037Fh`, every exception masked, the stack empty. */
  reset() {
    this.control = 0x037f;
    this.status = 0;
    this.empty.fill(true);
  }

  get top() {
    return (this.status >> 11) & 7;
  }

  set top(value) {
    this.status = (this.status & ~0x3800) | ((value & 7) << 11);
  }

  get rounding() {
    return (this.control >> 10) & 3;
  }

  /** ST(i)'s physical register. */
  #physical(i: number) {
    return (this.top + i) & 7;
  }

  st(i: number) {
    const at = this.#physical(i);

    if (this.empty[at]) {
      this.#invalid(true, false);
      return INDEFINITE;
    }

    return this.registers[at];
  }

  setSt(i: number, value: number) {
    const at = this.#physical(i);

    this.registers[at] = value;
    this.empty[at] = false;
  }

  push(value: number) {
    const top = (this.top - 1) & 7;

    if (!this.empty[top]) {
      /* Overflow: the stack fault, and the indefinite in its place. */
      this.#invalid(true, true);
      value = INDEFINITE;
    }

    this.top = top;
    this.registers[top] = value;
    this.empty[top] = false;
  }

  pop() {
    this.empty[this.top] = true;
    this.top = this.top + 1;
  }

  /** A masked invalid operation: `IE`, and for a stack fault `SF`, with `C1` saying which way. */
  #invalid(stack: boolean, overflow: boolean) {
    this.status |= IE;

    if (stack) {
      this.status |= SF;
      this.#flag(C1, overflow);
    }
  }

  #flag(bit: number, on: boolean) {
    this.status = on ? this.status | bit : this.status & ~bit;
  }

  #codes(c3: boolean, c2: boolean, c0: boolean) {
    this.#flag(C3, c3);
    this.#flag(C2, c2);
    this.#flag(C0, c0);
  }

  /* ---- memory ---- */

  #read(instruction, size: number) {
    const bytes = new Uint8Array(size);

    for (let at = 0; at < size; at++) {
      bytes[at] = this.cpu.read8(instruction.segment, (instruction.offset + at) & 0xffff);
    }

    return new DataView(bytes.buffer);
  }

  #write(instruction, bytes: Uint8Array, offset = 0) {
    for (let at = 0; at < bytes.length; at++) {
      this.cpu.write8(instruction.segment, (instruction.offset + offset + at) & 0xffff, bytes[at]);
    }
  }

  #writeView(instruction, size: number, fill: (view: DataView) => void, offset = 0) {
    const bytes = new Uint8Array(size);

    fill(new DataView(bytes.buffer));
    this.#write(instruction, bytes, offset);
  }

  readF32(instruction) {
    return this.#read(instruction, 4).getFloat32(0, true);
  }

  readF64(instruction) {
    return this.#read(instruction, 8).getFloat64(0, true);
  }

  readF80(instruction, offset = 0) {
    const view = this.#read({ ...instruction, offset: instruction.offset + offset }, 10);

    return fromExtended(view.getBigUint64(0, true), view.getUint16(8, true));
  }

  writeF80(instruction, value: number, offset = 0) {
    const { mantissa, signExponent } = toExtended(value);

    this.#writeView(
      instruction,
      10,
      (view) => {
        view.setBigUint64(0, mantissa, true);
        view.setUint16(8, signExponent, true);
      },
      offset
    );
  }

  /** A value rounded to an integer as the control word says. */
  roundInteger(value: number) {
    switch (this.rounding) {
      case ROUND_DOWN:
        return Math.floor(value);
      case ROUND_UP:
        return Math.ceil(value);
      case ROUND_CHOP:
        return Math.trunc(value);
      default:
        return roundEven(value);
    }
  }

  /** `FIST`: ST(0) as an integer of `bits`, or the integer indefinite -- the most negative -- when it does not fit. */
  #storeInteger(instruction, bits: 16 | 32 | 64) {
    const value = this.roundInteger(this.st(0));
    const limit = 2 ** (bits - 1);
    const fits = Number.isFinite(value) && value >= -limit && value < limit;

    if (!fits) {
      this.status |= IE;
    }

    this.#writeView(instruction, bits / 8, (view) => {
      if (bits === 16) {
        view.setInt16(0, fits ? value : -0x8000, true);
      } else if (bits === 32) {
        view.setInt32(0, fits ? value : -0x80000000, true);
      } else {
        view.setBigInt64(0, fits ? BigInt(value) : -(2n ** 63n), true);
      }
    });
  }

  /* ---- decoding ---- */

  decode(instruction) {
    instruction.opcode = this.cpu.read8(this.cpu.cs, this.cpu.ip);
    this.cpu.ip++;
    this.cpu.readModRM(instruction);

    return instruction;
  }

  execute(instruction) {
    const reg = instruction.modifier;
    const rm = instruction.operandRegister;
    const memory = rm === undefined;

    switch (instruction.opcode) {
      case 0xd8:
        this.#arithmetic(reg, 0, memory ? this.readF32(instruction) : this.st(rm), false);
        break;

      case 0xdc:
        if (memory) {
          this.#arithmetic(reg, 0, this.readF64(instruction), false);
        } else if (reg === 2 || reg === 3) {
          /* FCOM and FCOMP ST(i) again, by other names. */
          this.#arithmetic(reg, 0, this.st(rm), false);
        } else {
          /* ST(i) as the destination, and the subtraction and division with
           * their senses swapped, as the encoding has them. */
          this.#arithmetic(reg, rm, this.st(0), true);
        }
        break;

      case 0xda:
        if (memory) {
          this.#arithmetic(reg, 0, this.#read(instruction, 4).getInt32(0, true), false);
        } else if (reg === 5 && rm === 1) {
          this.#compare(this.st(0), this.st(1), true); // FUCOMPP
          this.pop();
          this.pop();
        } else {
          this.#undefined(instruction);
        }
        break;

      case 0xde:
        if (memory) {
          this.#arithmetic(reg, 0, this.#read(instruction, 2).getInt16(0, true), false);
        } else if (reg === 3) {
          if (rm !== 1) {
            this.#undefined(instruction);
            break;
          }

          this.#compare(this.st(0), this.st(1), false); // FCOMPP
          this.pop();
          this.pop();
        } else {
          this.#arithmetic(reg, rm, this.st(0), true);
          this.pop();
        }
        break;

      case 0xd9:
        this.#d9(instruction, reg, rm, memory);
        break;

      case 0xdb:
        this.#db(instruction, reg, rm, memory);
        break;

      case 0xdd:
        this.#dd(instruction, reg, rm, memory);
        break;

      case 0xdf:
        this.#df(instruction, reg, rm, memory);
        break;

      default:
        this.#undefined(instruction);
    }
  }

  #undefined(instruction) {
    throw new Error(
      `x87: no instruction ${instruction.opcode.toString(16)} /${instruction.modifier}` +
        (instruction.operandRegister !== undefined ? ` ST(${instruction.operandRegister})` : '')
    );
  }

  /**
   * The eight arithmetic operations and two comparisons of `D8`, `DC`, `DA`
   * and `DE`: `destination op= source` for add, multiply, subtract, reversed
   * subtract, divide and reversed divide, and `FCOM`/`FCOMP` against ST(0).
   * With `reversedEncoding` -- ST(i) as the destination -- the encoding's
   * subtraction and division come with their senses swapped.
   */
  #arithmetic(reg: number, destination: number, source: number, reversedEncoding: boolean) {
    const target = this.st(destination);

    switch (reg) {
      case 0:
        this.setSt(destination, target + source);
        break;
      case 1:
        this.setSt(destination, target * source);
        break;
      case 2:
        this.#compare(this.st(0), source, false);
        break;
      case 3:
        this.#compare(this.st(0), source, false);
        this.pop();
        break;
      case 4:
        this.setSt(destination, reversedEncoding ? source - target : target - source);
        break;
      case 5:
        this.setSt(destination, reversedEncoding ? target - source : source - target);
        break;
      case 6:
        this.#divide(
          destination,
          reversedEncoding ? source : target,
          reversedEncoding ? target : source
        );
        break;
      case 7:
        this.#divide(
          destination,
          reversedEncoding ? target : source,
          reversedEncoding ? source : target
        );
        break;
    }
  }

  #divide(destination: number, dividend: number, divisor: number) {
    if (divisor === 0 && Number.isFinite(dividend) && dividend !== 0) {
      this.status |= ZE;
    }

    this.setSt(destination, dividend / divisor);
  }

  /**
   * A comparison: `C3 C2 C0` 000 above, 001 below, 100 equal, 111 unordered.
   * `FCOM` finds any NaN invalid; `FUCOM` only a signalling one, which a
   * double cannot tell apart, so it never does.
   */
  #compare(a: number, b: number, unordered: boolean) {
    if (Number.isNaN(a) || Number.isNaN(b)) {
      if (!unordered) {
        this.status |= IE;
      }

      this.#codes(true, true, true);
    } else if (a > b) {
      this.#codes(false, false, false);
    } else if (a < b) {
      this.#codes(false, false, true);
    } else {
      this.#codes(true, false, false);
    }

    this.#flag(C1, false);
  }

  #d9(instruction, reg: number, rm: number, memory: boolean) {
    if (memory) {
      switch (reg) {
        case 0:
          this.push(this.readF32(instruction)); // FLD m32
          return;
        case 2:
          this.#writeView(instruction, 4, (view) => view.setFloat32(0, this.st(0), true)); // FST m32
          return;
        case 3:
          this.#writeView(instruction, 4, (view) => view.setFloat32(0, this.st(0), true)); // FSTP m32
          this.pop();
          return;
        case 4:
          this.#loadEnvironment(instruction); // FLDENV
          return;
        case 5:
          this.control = this.#read(instruction, 2).getUint16(0, true); // FLDCW
          return;
        case 6:
          this.#storeEnvironment(instruction); // FNSTENV
          return;
        case 7:
          this.#writeView(instruction, 2, (view) => view.setUint16(0, this.control, true)); // FNSTCW
          return;
      }

      this.#undefined(instruction);
    }

    switch (reg) {
      case 0: {
        const value = this.st(rm); // FLD ST(i)

        this.push(value);
        return;
      }

      case 1: {
        const a = this.#physical(0);
        const b = this.#physical(rm); // FXCH

        [this.registers[a], this.registers[b]] = [this.registers[b], this.registers[a]];
        [this.empty[a], this.empty[b]] = [this.empty[b], this.empty[a]];
        this.#flag(C1, false);
        return;
      }

      case 2:
        if (rm === 0) {
          return; // FNOP
        }
        break;

      case 3:
        this.setSt(rm, this.st(0)); // FSTP1, an alias of FSTP ST(i)
        this.pop();
        return;

      case 4:
        switch (rm) {
          case 0:
            this.setSt(0, -this.st(0)); // FCHS
            return;
          case 1:
            this.setSt(0, Math.abs(this.st(0))); // FABS
            return;
          case 4:
            this.#compare(this.st(0), 0, false); // FTST
            return;
          case 5:
            this.#examine(); // FXAM
            return;
        }
        break;

      case 5: {
        const constants = [1, Math.log2(10), Math.LOG2E, Math.PI, Math.log10(2), Math.LN2, 0];

        if (rm < 7) {
          this.push(constants[rm]); // FLD1 FLDL2T FLDL2E FLDPI FLDLG2 FLDLN2 FLDZ
          return;
        }
        break;
      }

      case 6:
        switch (rm) {
          case 0:
            this.setSt(0, 2 ** this.st(0) - 1); // F2XM1
            return;
          case 1:
            this.setSt(1, this.st(1) * Math.log2(this.st(0))); // FYL2X
            this.pop();
            return;
          case 2:
            this.#trigonometric(() => {
              this.setSt(0, Math.tan(this.st(0))); // FPTAN
              this.push(1);
            });
            return;
          case 3:
            this.setSt(1, Math.atan2(this.st(1), this.st(0))); // FPATAN
            this.pop();
            return;
          case 4:
            this.#extract(); // FXTRACT
            return;
          case 5:
            this.#remainder(true); // FPREM1
            return;
          case 6:
            this.top = this.top - 1; // FDECSTP
            return;
          case 7:
            this.top = this.top + 1; // FINCSTP
            return;
        }
        break;

      case 7:
        switch (rm) {
          case 0:
            this.#remainder(false); // FPREM
            return;
          case 1:
            this.setSt(1, this.st(1) * Math.log2(this.st(0) + 1)); // FYL2XP1
            this.pop();
            return;
          case 2: {
            const value = this.st(0); // FSQRT

            if (value < 0) {
              this.status |= IE;
            }

            this.setSt(0, Math.sqrt(value));
            return;
          }
          case 3:
            this.#trigonometric(() => {
              const value = this.st(0); // FSINCOS

              this.setSt(0, Math.sin(value));
              this.push(Math.cos(value));
            });
            return;
          case 4:
            this.setSt(0, this.roundInteger(this.st(0))); // FRNDINT
            return;
          case 5:
            this.setSt(0, this.st(0) * 2 ** Math.trunc(this.st(1))); // FSCALE
            return;
          case 6:
            this.#trigonometric(() => this.setSt(0, Math.sin(this.st(0)))); // FSIN
            return;
          case 7:
            this.#trigonometric(() => this.setSt(0, Math.cos(this.st(0)))); // FCOS
            return;
        }
        break;
    }

    this.#undefined(instruction);
  }

  /** The 387's sine, cosine and tangent: an operand of 2^63 or more is left as it is, with `C2` set. */
  #trigonometric(operation: () => void) {
    if (Math.abs(this.st(0)) >= 2 ** 63) {
      this.#flag(C2, true);
      return;
    }

    this.#flag(C2, false);
    operation();
  }

  /** `FXAM`: the kind of value in ST(0) in `C3 C2 C0`, its sign in `C1`. */
  #examine() {
    const at = this.#physical(0);
    const value = this.registers[at];

    this.#flag(C1, Object.is(value, -0) || value < 0);

    if (this.empty[at]) {
      this.#codes(true, false, true);
    } else if (Number.isNaN(value)) {
      this.#codes(false, false, true);
    } else if (!Number.isFinite(value)) {
      this.#codes(false, true, true);
    } else if (value === 0) {
      this.#codes(true, false, false);
    } else {
      this.#codes(false, true, false);
    }
  }

  /** `FXTRACT`: ST(0) split into its exponent, left in ST(1), and its significand, pushed. */
  #extract() {
    const value = this.st(0);

    if (value === 0) {
      this.status |= ZE;
      this.setSt(0, -Infinity);
      this.push(value);
      return;
    }

    const exponent = Math.floor(Math.log2(Math.abs(value)));
    let significand = value / 2 ** exponent;

    /* log2 can be a hair out at a power of two. */
    if (Math.abs(significand) >= 2) {
      significand /= 2;
      this.setSt(0, exponent + 1);
    } else if (Math.abs(significand) < 1) {
      significand *= 2;
      this.setSt(0, exponent - 1);
    } else {
      this.setSt(0, exponent);
    }

    this.push(significand);
  }

  /**
   * `FPREM` and `FPREM1`: ST(0) less a multiple of ST(1) -- the quotient
   * truncated, or rounded to nearest -- with the quotient's three low bits in
   * `C0`, `C3` and `C1`, and `C2` clear for a remainder that is complete.
   */
  #remainder(ieee: boolean) {
    const dividend = this.st(0);
    const divisor = this.st(1);

    if (divisor === 0 || !Number.isFinite(dividend)) {
      this.status |= IE;
      this.setSt(0, INDEFINITE);
      return;
    }

    const quotient = ieee ? roundEven(dividend / divisor) : Math.trunc(dividend / divisor);
    const remainder = ieee ? dividend - quotient * divisor : dividend % divisor;
    const q = Math.abs(quotient);

    this.setSt(0, remainder);
    this.#flag(C0, (q & 4) !== 0);
    this.#flag(C3, (q & 2) !== 0);
    this.#flag(C1, (q & 1) !== 0);
    this.#flag(C2, false);
  }

  #db(instruction, reg: number, rm: number, memory: boolean) {
    if (memory) {
      switch (reg) {
        case 0:
          this.push(this.#read(instruction, 4).getInt32(0, true)); // FILD m32
          return;
        case 2:
          this.#storeInteger(instruction, 32); // FIST m32
          return;
        case 3:
          this.#storeInteger(instruction, 32); // FISTP m32
          this.pop();
          return;
        case 5:
          this.push(this.readF80(instruction)); // FLD m80
          return;
        case 7:
          this.writeF80(instruction, this.st(0)); // FSTP m80
          this.pop();
          return;
      }

      this.#undefined(instruction);
    }

    if (reg === 4) {
      switch (rm) {
        case 0: // FENI, the 8087's; nothing on a 287 or 387
        case 1: // FDISI, likewise
        case 4: // FSETPM, the 287's; nothing on a 387
          return;
        case 2:
          this.status &= ~(0x00ff | B); // FNCLEX
          return;
        case 3:
          this.reset(); // FNINIT
          return;
      }
    }

    this.#undefined(instruction);
  }

  #dd(instruction, reg: number, rm: number, memory: boolean) {
    if (memory) {
      switch (reg) {
        case 0:
          this.push(this.readF64(instruction)); // FLD m64
          return;
        case 2:
          this.#writeView(instruction, 8, (view) => view.setFloat64(0, this.st(0), true)); // FST m64
          return;
        case 3:
          this.#writeView(instruction, 8, (view) => view.setFloat64(0, this.st(0), true)); // FSTP m64
          this.pop();
          return;
        case 4:
          this.#restore(instruction); // FRSTOR
          return;
        case 6:
          this.#save(instruction); // FNSAVE
          return;
        case 7:
          this.#writeView(instruction, 2, (view) => view.setUint16(0, this.status, true)); // FNSTSW m16
          return;
      }

      this.#undefined(instruction);
    }

    switch (reg) {
      case 0:
        this.empty[this.#physical(rm)] = true; // FFREE
        return;
      case 1: {
        const a = this.#physical(0);
        const b = this.#physical(rm); // FXCH4, an alias

        [this.registers[a], this.registers[b]] = [this.registers[b], this.registers[a]];
        [this.empty[a], this.empty[b]] = [this.empty[b], this.empty[a]];
        return;
      }
      case 2:
        this.setSt(rm, this.st(0)); // FST ST(i)
        return;
      case 3:
        this.setSt(rm, this.st(0)); // FSTP ST(i)
        this.pop();
        return;
      case 4:
        this.#compare(this.st(0), this.st(rm), true); // FUCOM
        return;
      case 5:
        this.#compare(this.st(0), this.st(rm), true); // FUCOMP
        this.pop();
        return;
    }

    this.#undefined(instruction);
  }

  #df(instruction, reg: number, rm: number, memory: boolean) {
    if (memory) {
      switch (reg) {
        case 0:
          this.push(this.#read(instruction, 2).getInt16(0, true)); // FILD m16
          return;
        case 2:
          this.#storeInteger(instruction, 16); // FIST m16
          return;
        case 3:
          this.#storeInteger(instruction, 16); // FISTP m16
          this.pop();
          return;
        case 4:
          this.push(this.#loadBcd(instruction)); // FBLD
          return;
        case 5:
          this.push(Number(this.#read(instruction, 8).getBigInt64(0, true))); // FILD m64
          return;
        case 6:
          this.#storeBcd(instruction); // FBSTP
          this.pop();
          return;
        case 7:
          this.#storeInteger(instruction, 64); // FISTP m64
          this.pop();
          return;
      }

      this.#undefined(instruction);
    }

    switch (reg) {
      case 0:
        this.empty[this.#physical(rm)] = true; // FFREEP, undocumented
        this.pop();
        return;
      case 4:
        if (rm === 0) {
          this.cpu.ax = this.status; // FNSTSW AX
          return;
        }
        break;
    }

    this.#undefined(instruction);
  }

  /** Eighteen packed decimal digits, the low byte first, and a sign byte. */
  #loadBcd(instruction) {
    const view = this.#read(instruction, 10);
    let value = 0;

    for (let at = 8; at >= 0; at--) {
      const byte = view.getUint8(at);

      value = value * 100 + (byte >> 4) * 10 + (byte & 0xf);
    }

    return view.getUint8(9) & 0x80 ? -value : value;
  }

  #storeBcd(instruction) {
    const value = this.roundInteger(this.st(0));
    const bytes = new Uint8Array(10);

    if (!Number.isFinite(value) || Math.abs(value) >= 1e18) {
      /* The packed decimal indefinite. */
      this.status |= IE;
      bytes.set([0, 0, 0, 0, 0, 0, 0, 0xc0, 0xff, 0xff]);
    } else {
      let digits = BigInt(Math.abs(value));

      for (let at = 0; at < 9; at++) {
        const low = Number(digits % 10n);

        digits /= 10n;
        const high = Number(digits % 10n);

        digits /= 10n;
        bytes[at] = (high << 4) | low;
      }

      bytes[9] = value < 0 || Object.is(value, -0) ? 0x80 : 0;
    }

    this.#write(instruction, bytes);
  }

  /** The tag word: two bits a physical register -- valid, zero, special or empty. */
  tagWord() {
    let word = 0;

    for (let at = 0; at < 8; at++) {
      const value = this.registers[at];
      const tag = this.empty[at]
        ? TAG_EMPTY
        : value === 0
          ? TAG_ZERO
          : !Number.isFinite(value) || isDenormal(value)
            ? TAG_SPECIAL
            : TAG_VALID;

      word |= tag << (2 * at);
    }

    return word;
  }

  /**
   * The environment, in the sixteen-bit form: the control, status and tag
   * words, then where the last instruction and its operand were, which are
   * not kept and are written as zeros. Fourteen bytes.
   */
  #storeEnvironment(instruction) {
    this.#writeView(instruction, 14, (view) => {
      view.setUint16(0, this.control, true);
      view.setUint16(2, this.status, true);
      view.setUint16(4, this.tagWord(), true);
    });
  }

  #loadEnvironment(instruction) {
    const view = this.#read(instruction, 6);
    const tags = view.getUint16(4, true);

    this.control = view.getUint16(0, true);
    this.status = view.getUint16(2, true);

    for (let at = 0; at < 8; at++) {
      this.empty[at] = ((tags >> (2 * at)) & 3) === TAG_EMPTY;
    }
  }

  /** `FNSAVE`: the environment, then ST(0) to ST(7) as ten bytes each; and then `FNINIT`. */
  #save(instruction) {
    this.#storeEnvironment(instruction);

    for (let i = 0; i < 8; i++) {
      this.writeF80(instruction, this.registers[this.#physical(i)], 14 + i * 10);
    }

    this.reset();
  }

  #restore(instruction) {
    this.#loadEnvironment(instruction);

    for (let i = 0; i < 8; i++) {
      this.registers[this.#physical(i)] = this.readF80(instruction, 14 + i * 10);
    }
  }
}

/** Rounded to the nearest integer, a half to the even one. */
export function roundEven(value: number) {
  const rounded = Math.round(value);

  return Math.abs(value % 1) === 0.5 ? 2 * Math.round(value / 2) : rounded;
}

function isDenormal(value: number) {
  return value !== 0 && Math.abs(value) < 2 ** -1022;
}

/**
 * A double as the unit's eighty-bit extended format: a sixty-four-bit
 * significand with its integer bit explicit, and a sign and fifteen-bit
 * exponent biased by 16383.
 */
export function toExtended(value: number) {
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;

  if (Number.isNaN(value)) {
    return { mantissa: 0xc000000000000000n, signExponent: 0xffff };
  }

  if (!Number.isFinite(value)) {
    return { mantissa: 0x8000000000000000n, signExponent: sign | 0x7fff };
  }

  if (value === 0) {
    return { mantissa: 0n, signExponent: sign };
  }

  const view = new DataView(new ArrayBuffer(8));

  view.setFloat64(0, Math.abs(value));

  const bits = view.getBigUint64(0);
  let exponent = Number(bits >> 52n);
  let significand = bits & 0xfffffffffffffn;

  if (exponent === 0) {
    /* A denormal double is normal in the extended format. */
    exponent = 1;

    while (!(significand & 0x10000000000000n)) {
      significand <<= 1n;
      exponent--;
    }
  } else {
    significand |= 0x10000000000000n;
  }

  return {
    mantissa: significand << 11n,
    signExponent: sign | (exponent - 1023 + 16383),
  };
}

/** The extended format as a double, rounded to nearest where it has more precision. */
export function fromExtended(mantissa: bigint, signExponent: number) {
  const sign = signExponent & 0x8000 ? -1 : 1;
  const exponent = signExponent & 0x7fff;

  if (exponent === 0x7fff) {
    return (mantissa & 0x7fffffffffffffffn) === 0n ? sign * Infinity : NaN;
  }

  if (mantissa === 0n) {
    return sign * 0;
  }

  /* The significand as a number -- rounded to 53 bits -- scaled in two steps,
   * so that neither overflows on its own. */
  const power = exponent - 16383 - 63;
  const half = Math.trunc(power / 2);

  return sign * Number(mantissa) * 2 ** half * 2 ** (power - half);
}
