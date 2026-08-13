'use strict';

/**
 * Raised when a divide cannot produce a representable quotient.
 *
 * The core turns this into interrupt 0. The flags the microcode leaves behind
 * are already applied by the time this is thrown, because a divide error on
 * this part is not a clean abort: the routine runs far enough to disturb them.
 */
export class DivideError {}

/**
 * This class represents the arithmetic logic unit of the CPU.
 */
export class ALU {
  declare _cpu: any;
  declare static PARITY: any;
  /**
   * Constructs a ALU for the given CPU.
   *
   * @param {CPU} cpu - The CPU this ALU is using.
   */
  constructor(cpu) {
    this._cpu = cpu;
  }

  /**
   * Returns the attached CPU.
   */
  get cpu() {
    return this._cpu;
  }

  /**
   * Returns the signed 8-bit value for the given unsigned value.
   *
   * @param {number} value - The unsigned value;
   *
   * @returns {number} The signed result.
   */
  toSigned8(value) {
    return value >= 0x80 ? value | ~0xff : value;
  }

  /**
   * Returns the signed 16-bit value for the given unsigned value.
   *
   * @param {number} value - The unsigned value;
   *
   * @returns {number} The signed result.
   */
  toSigned16(value) {
    return value >= 0x8000 ? value | ~0xffff : value;
  }

  /**
   * Returns the signed 32-bit value for the given unsigned value.
   *
   * @param {number} value - The unsigned value;
   *
   * @returns {number} The signed result.
   */
  toSigned32(value) {
    return value >= 0x80000000 ? value | ~0xffffffff : value;
  }

  /**
   * Returns the signed 64-bit value for the given unsigned value.
   *
   * @param {BigInt} value - The unsigned value;
   *
   * @returns {BigInt} The signed result.
   */
  toSigned64(value) {
    return value >= 0x8000000000000000n ? value | ~BigInt(0xffffffffffffffffn) : value;
  }

  /**
   * Executes an 8-bit CBW instruction.
   *
   * This returns a 16-bit unsigned value that is the sign-extended form of
   * the given unsigned 8-bit value.
   */
  cbw8(value) {
    value = this.toSigned8(value & 0xff);
    return value & 0xffff;
  }

  /**
   * Executes a 16-bit CWD instruction.
   *
   * This returns a 32-bit unsigned value that is the sign-extended form of
   * the given unsigned 16-bit value.
   */
  cwd16(value) {
    value = this.toSigned16(value & 0xffff);
    // The >>> forces the value to be unsigned
    return (value & 0xffffffff) >>> 0;
  }

  /**
   * Executes an 8-bit ADD instruction.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   * @param {number} c - Carry.
   *
   * @return {number} The result.
   */
  add8(a, b, c = 0) {
    let result = (a + b + c) & 0x1ff;
    this._cpu._flags.carry = result > 0xff;
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    result &= 0xff;
    this._cpu._flags.overflow = ((result ^ a) & (result ^ b) & 0x80) != 0;
    a = result;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  /**
   * Executes a 16-bit ADD instruction.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   * @param {number} c - Carry.
   *
   * @return {number} The result.
   */
  add16(a, b, c = 0) {
    let result = (a + b + c) & 0x1ffff;
    this._cpu._flags.carry = result > 0xffff;
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    result &= 0xffff;
    this._cpu._flags.overflow = ((result ^ a) & (result ^ b) & 0x8000) != 0;
    a = result;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x8000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  /**
   * Executes a 32-bit ADD instruction.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   * @param {number} c - Carry.
   *
   * @return {number} The result.
   */
  add32(a, b, c = 0) {
    let result = (a + b + c) & 0x1ffffffff;
    this._cpu._flags.carry = result > 0xffffffff;
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    result &= 0xffffffff;
    result = result >>> 0;
    this._cpu._flags.overflow = ((result ^ a) & (result ^ b) & 0x80000000) != 0;
    a = result;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80000000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  adc8(a, b) {
    return this.add8(a, b, this._cpu._flags.carry ? 1 : 0);
  }

  adc16(a, b) {
    return this.add16(a, b, this._cpu._flags.carry ? 1 : 0);
  }

  adc32(a, b) {
    return this.add32(a, b, this._cpu._flags.carry ? 1 : 0);
  }

  sub8(a, b) {
    const result = this.add8(a, ~b + 1);

    /* AF is the borrow out of bit 3. Delegating to add() computes it from the
     * negated operand, which is not the same thing, so derive it from the
     * operands the caller actually passed.
     */
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    this._cpu._flags.overflow = ((a ^ b) & (a ^ result) & 0x80) != 0;

    return result;
  }

  sub16(a, b) {
    const result = this.add16(a, ~b + 1);

    /* AF is the borrow out of bit 3. Delegating to add() computes it from the
     * negated operand, which is not the same thing, so derive it from the
     * operands the caller actually passed.
     */
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    this._cpu._flags.overflow = ((a ^ b) & (a ^ result) & 0x8000) != 0;

    return result;
  }

  sub32(a, b) {
    const result = this.add32(a, ~b + 1);

    /* AF is the borrow out of bit 3. Delegating to add() computes it from the
     * negated operand, which is not the same thing, so derive it from the
     * operands the caller actually passed.
     */
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    this._cpu._flags.overflow = ((a ^ b) & (a ^ result) & 0x80000000) != 0;

    return result;
  }

  sbb8(a, b) {
    // a - b - borrow. Passing the borrow to add() would have added it.
    const borrow = this._cpu._flags.carry ? 1 : 0;
    const result = this.add8(a, ~(b + borrow) + 1);

    // AF is the borrow out of bit 3, from the operands as given.
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    this._cpu._flags.overflow = ((a ^ b) & (a ^ result) & 0x80) != 0;

    return result;
  }

  sbb16(a, b) {
    // a - b - borrow. Passing the borrow to add() would have added it.
    const borrow = this._cpu._flags.carry ? 1 : 0;
    const result = this.add16(a, ~(b + borrow) + 1);

    // AF is the borrow out of bit 3, from the operands as given.
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    this._cpu._flags.overflow = ((a ^ b) & (a ^ result) & 0x8000) != 0;

    return result;
  }

  sbb32(a, b) {
    // a - b - borrow. Passing the borrow to add() would have added it.
    const borrow = this._cpu._flags.carry ? 1 : 0;
    const result = this.add32(a, ~(b + borrow) + 1);

    // AF is the borrow out of bit 3, from the operands as given.
    this._cpu._flags.auxiliaryCarry = ((a ^ b ^ result) & 0x10) != 0;
    this._cpu._flags.overflow = ((a ^ b) & (a ^ result) & 0x80000000) != 0;

    return result;
  }

  and8(a, b) {
    a = a & b & 0xff;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  and16(a, b) {
    a = a & b & 0xffff;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x8000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  and32(a, b) {
    a = (a & b & 0xffffffff) >>> 0;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80000000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  or8(a, b) {
    a = (a | b) & 0xff;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  or16(a, b) {
    a = (a | b) & 0xffff;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x8000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  or32(a, b) {
    a = ((a | b) & 0xffffffff) >>> 0;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80000000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  xor8(a, b) {
    a = (a ^ b) & 0xff;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  xor16(a, b) {
    a = (a ^ b) & 0xffff;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x8000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  xor32(a, b) {
    a = ((a ^ b) & 0xffffffff) >>> 0;
    this._cpu._flags.overflow = false;
    this._cpu._flags.carry = false;
    // Documented as undefined; the hardware clears it.
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.zero = a == 0;
    this._cpu._flags.signed = a >= 0x80000000;
    this._cpu._flags.parity = ALU.PARITY[a & 0xff];
    return a;
  }

  neg8(a) {
    const result = this.sub8(0, a);
    this._cpu._flags.carry = a != 0;
    return result;
  }

  neg16(a) {
    const result = this.sub16(0, a);
    this._cpu._flags.carry = a != 0;
    return result;
  }

  neg32(a) {
    const result = this.sub32(0, a);
    this._cpu._flags.carry = a != 0;
    return result;
  }

  not8(a) {
    return ~a & 0xff;
  }

  not16(a) {
    return ~a & 0xffff;
  }

  not32(a) {
    return (~a & 0xffffffff) >>> 0;
  }

  /**
   * Performs the 8-bit MUL unsigned multiplication instruction.
   *
   * Multiplies two unsigned 8-bit values resulting in one unsigned 16-bit
   * product.
   *
   * Carry and overflow flags are cleared if high half is a sign-extension
   * of the lower half. They are set otherwise.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */

  /**
   * Applies the status flags the multiply and divide instructions leave behind.
   *
   * Intel documents SF, ZF, AF and PF as undefined for these instructions. The
   * hardware is consistent: SF, ZF and PF describe the *high* half of the
   * result -- AH for the byte forms, DX for the word forms -- and AF is always
   * set. This matches every MUL, IMUL, DIV and IDIV vector in the 80286 suite.
   *
   * @param {number} high - The high half of the result.
   * @param {number} sign - The sign bit mask for that half.
   */
  applyWideResultFlags(high, sign) {
    this._cpu._flags.zero = high == 0;
    this._cpu._flags.signed = (high & sign) != 0;
    this._cpu._flags.parity = ALU.PARITY[high & 0xff];
    this._cpu._flags.auxiliaryCarry = true;
  }

  /**
   * Applies SF, ZF and PF for an 8-bit result.
   */
  applyResultFlags8(result) {
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];
  }

  /**
   * Performs the DAA instruction.
   *
   * Turns the result of adding two packed BCD bytes back into packed BCD, by
   * carrying each nibble that has gone past nine.
   *
   * @param {number} al - The AL register.
   *
   * @return {number} The adjusted AL.
   */
  daa(al) {
    const before = al & 0xff;
    const carryBefore = this._cpu._flags.carry;
    let result = before;

    if ((before & 0x0f) > 9 || this._cpu._flags.auxiliaryCarry) {
      result = result + 6;
      this._cpu._flags.auxiliaryCarry = true;
    } else {
      this._cpu._flags.auxiliaryCarry = false;
    }

    if (before > 0x99 || carryBefore) {
      result = result + 0x60;
      this._cpu._flags.carry = true;
    } else {
      this._cpu._flags.carry = false;
    }

    result &= 0xff;

    // Undefined by the manual: set when the adjustment carried the value from
    // positive to negative.
    this._cpu._flags.overflow = (result & 0x80) != 0 && (before & 0x80) == 0;
    this.applyResultFlags8(result);

    return result;
  }

  /**
   * Performs the DAS instruction.
   *
   * The subtraction counterpart of DAA: each nibble that has borrowed is
   * brought back into packed BCD range.
   *
   * @param {number} al - The AL register.
   *
   * @return {number} The adjusted AL.
   */
  das(al) {
    const before = al & 0xff;
    const carryBefore = this._cpu._flags.carry;
    let result = before;
    let carry = false;

    if ((before & 0x0f) > 9 || this._cpu._flags.auxiliaryCarry) {
      // The low adjustment can borrow, and that borrow survives into CF.
      carry = carryBefore || result - 6 < 0;
      result = result - 6;
      this._cpu._flags.auxiliaryCarry = true;
    } else {
      this._cpu._flags.auxiliaryCarry = false;
    }

    if (before > 0x99 || carryBefore) {
      result = result - 0x60;
      carry = true;
    }

    this._cpu._flags.carry = carry;
    result &= 0xff;

    // The mirror of DAA: set when the adjustment carried the value from
    // negative to positive.
    this._cpu._flags.overflow = (result & 0x80) == 0 && (before & 0x80) != 0;
    this.applyResultFlags8(result);

    return result;
  }

  /**
   * Performs the AAA instruction.
   *
   * Adjusts AX after adding two unpacked BCD digits, carrying into AH when the
   * low nibble has gone past nine.
   *
   * @param {number} ax - The AX register.
   *
   * @return {number} The adjusted AX.
   */
  aaa(ax) {
    const before = ax & 0xff;
    let result = ax & 0xffff;

    if ((result & 0x0f) > 9 || this._cpu._flags.auxiliaryCarry) {
      // AX as a whole, so the carry out of AL reaches AH.
      result = (result + 0x106) & 0xffff;
      this._cpu._flags.auxiliaryCarry = true;
      this._cpu._flags.carry = true;
    } else {
      this._cpu._flags.auxiliaryCarry = false;
      this._cpu._flags.carry = false;
    }

    /* SF, ZF and PF describe AL before it is masked down to one digit, and OF
     * -- undefined by the manual -- follows the same sign-flip rule as DAA.
     */
    this._cpu._flags.overflow = (result & 0x80) != 0 && (before & 0x80) == 0;
    this.applyResultFlags8(result & 0xff);
    result &= 0xff0f;

    return result;
  }

  /**
   * Performs the AAS instruction.
   *
   * The subtraction counterpart of AAA.
   *
   * @param {number} ax - The AX register.
   *
   * @return {number} The adjusted AX.
   */
  aas(ax) {
    const before = ax & 0xff;
    let result = ax & 0xffff;

    if ((result & 0x0f) > 9 || this._cpu._flags.auxiliaryCarry) {
      // AX as a whole, so the borrow out of AL reaches AH.
      result = (result - 0x106) & 0xffff;
      this._cpu._flags.auxiliaryCarry = true;
      this._cpu._flags.carry = true;
    } else {
      this._cpu._flags.auxiliaryCarry = false;
      this._cpu._flags.carry = false;
    }

    /* SF, ZF and PF describe AL before it is masked down to one digit, and OF
     * -- undefined by the manual -- follows the same sign-flip rule as DAS.
     */
    this._cpu._flags.overflow = (result & 0x80) == 0 && (before & 0x80) != 0;
    this.applyResultFlags8(result & 0xff);
    result &= 0xff0f;

    return result;
  }

  /**
   * Performs the AAM instruction.
   *
   * Splits AL into two unpacked BCD digits, quotient in AH and remainder in
   * AL. The base is an immediate, which is ten for actual BCD but may be
   * anything; a base of zero is a divide error and is the caller's to raise.
   *
   * @param {number} ax - The AX register.
   * @param {number} base - The immediate base.
   *
   * @return {number} The adjusted AX.
   */
  aam(ax, base) {
    const al = ax & 0xff;
    const divisor = base & 0xff;
    const high = Math.floor(al / divisor) & 0xff;
    const low = (al % divisor) & 0xff;

    // Undefined by the manual; the hardware clears all three.
    this._cpu._flags.overflow = false;
    this._cpu._flags.auxiliaryCarry = false;
    this._cpu._flags.carry = false;
    this.applyResultFlags8(low);

    return ((high << 8) | low) & 0xffff;
  }

  /**
   * Performs the AAD instruction.
   *
   * Folds the two unpacked BCD digits in AX back into AL, ready for a divide.
   *
   * @param {number} ax - The AX register.
   * @param {number} base - The immediate base.
   *
   * @return {number} The adjusted AX.
   */
  aad(ax, base) {
    const al = ax & 0xff;
    const ah = (ax >> 8) & 0xff;
    const addend = (ah * (base & 0xff)) & 0xff;
    const sum = al + addend;
    const result = sum & 0xff;

    /* The microcode multiplies and then adds; CF and AF come from that add.
     * OF is not computed at all -- it is assigned from CF, the same way the
     * divides do it.
     */
    this._cpu._flags.carry = sum > 0xff;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this._cpu._flags.auxiliaryCarry = ((al ^ addend ^ result) & 0x10) != 0;
    this.applyResultFlags8(result);

    return result;
  }

  mul8(a, b) {
    const result = ((a & 0xff) * (b & 0xff)) & 0xffff;
    this._cpu._flags.carry = (result & 0xff00) != 0;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags((result >>> 8) & 0xff, 0x80);
    return result;
  }

  /**
   * Performs the 16-bit MUL unsigned multiplication instruction.
   *
   * Multiplies two unsigned 16-bit values resulting in one unsigned 32-bit
   * product.
   *
   * Carry and overflow flags are cleared if high half is a sign-extension
   * of the lower half. They are set otherwise.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  mul16(a, b) {
    const result = (a & 0xffff) * (b & 0xffff);
    this._cpu._flags.carry = result > 0xffff;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags(Math.floor(result / 0x10000) & 0xffff, 0x8000);
    return result >>> 0;
  }

  /**
   * Performs the 32-bit MUL unsigned multiplication instruction.
   *
   * Multiplies two unsigned 32-bit values resulting in one unsigned 64-bit
   * product as a BigInt.
   *
   * Carry and overflow flags are cleared if high half is a sign-extension
   * of the lower half. They are set otherwise.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {BigInt} The unsigned result.
   */
  mul32(a, b) {
    a = BigInt(a);
    b = BigInt(b);
    const result = (a & 0xffffffffn) * (b & 0xffffffffn);
    this._cpu._flags.carry = (result & 0xffffffff00000000n) != 0n;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    return result;
  }

  /**
   * Performs the 8-bit IMUL signed multiplication instruction.
   *
   * Multiplies two signed 8-bit values resulting in one unsigned 16-bit
   * product.
   *
   * Carry and overflow flags are cleared if high half is a sign-extension
   * of the lower half. They are set otherwise.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  imul8(a, b) {
    const product = this.toSigned8(a) * this.toSigned8(b);
    const result = product & 0xffff;

    // CF and OF report that the result does not fit in the low half, which is
    // to say that the low half no longer sign-extends to the whole product.
    this._cpu._flags.carry = this.toSigned8(result & 0xff) != product;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags((result >>> 8) & 0xff, 0x80);

    return result;
  }

  /**
   * Performs the 16-bit IMUL signed multiplication instruction.
   *
   * Multiplies two signed 16-bit values resulting in one unsigned 32-bit
   * product.
   *
   * Carry and overflow flags are cleared if high half is a sign-extension
   * of the lower half. They are set otherwise.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  imul16(a, b) {
    const product = this.toSigned16(a) * this.toSigned16(b);
    const result = product >>> 0;

    this._cpu._flags.carry = this.toSigned16(result & 0xffff) != product;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags((result >>> 16) & 0xffff, 0x8000);

    return result;
  }

  /**
   * Performs the 32-bit IMUL signed multiplication instruction.
   *
   * Multiplies two signed 32-bit values resulting in one unsigned 64-bit
   * product.
   *
   * Carry and overflow flags are cleared if high half is a sign-extension
   * of the lower half. They are set otherwise.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  imul32(a, b) {
    const result =
      (BigInt(this.toSigned32(a)) * BigInt(this.toSigned32(b))) & BigInt(0xffffffffffffffffn);
    this._cpu._flags.carry = (result & 0xffffffffn) != result;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    return result;
  }

  /**
   * Performs the 8-bit DIV unsigned division instruction.
   *
   * Divides one unsigned 16-bit value with the given 8-bit value resulting in
   * one unsigned 16-bit quotient.
   *
   * This does not set any flags and leaves most undefined.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result. The high half is the remainder.
   */
  div8(a, b) {
    const dividend = a & 0xffff;
    const divisor = b & 0xff;

    /* A quotient wider than the destination -- which includes every divide by
     * zero -- faults. The routine has already run by then, so the flags it
     * disturbed are reproduced before raising.
     */
    if (dividend >= divisor << 8) {
      const scaled = (divisor << 8) & 0xffff;
      let accumulator = dividend >= scaled ? ((dividend - scaled) | 1) & 0xffff : dividend;

      for (let step = 0; step < 6; step++) {
        accumulator =
          accumulator << 1 >= scaled || (accumulator & 0x8000) > 0
            ? (((accumulator << 1) - scaled) | 1) & 0xffff
            : (accumulator << 1) & 0xffff;
      }

      // The routine ends on a compare, and that is what the flags describe.
      this.sub8((accumulator & 0x7fff) >> 7, divisor);

      throw new DivideError();
    }

    const quotient = Math.floor(dividend / divisor) & 0xff;
    const remainder = (dividend % divisor) & 0xff;
    const result = ((remainder << 8) | quotient) & 0xffff;

    /* CF and OF are documented as undefined. What survives is the compare from
     * the last step of the non-restoring division the microcode performs. If
     * that step subtracted -- which is exactly what the low quotient bit
     * records -- undo it before comparing. OF ends up equal to CF.
     */
    const compared = result & 1 ? (((result & ~1) + (divisor << 8)) & 0xffff) >>> 8 : remainder;

    this._cpu._flags.carry = compared < divisor;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags(remainder, 0x80);

    return result;
  }

  /**
   * Performs the 16-bit DIV unsigned division instruction.
   *
   * Divides one unsigned 32-bit value with an unsigned 16-bit value resulting
   * in one unsigned 32-bit quotient.
   *
   * This does not set any flags and leaves most undefined.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result. The high half is the remainder.
   */
  div16(a, b) {
    const dividend = (a & 0xffffffff) >>> 0;
    const divisor = b & 0xffff;

    if (dividend >= divisor * 0x10000) {
      const scaled = divisor * 0x10000;

      /* The running value is 32 bits wide, which is where JavaScript's
       * arithmetic gets in the way twice: the bitwise operators are signed, so
       * `| 1` turns anything at or above 2^31 negative, and the remainder
       * operator keeps the sign of its left operand, so a negative intermediate
       * stays negative instead of wrapping. Both are done explicitly here.
       */
      const wrap = (value) => ((value % 0x100000000) + 0x100000000) % 0x100000000;
      const setLowBit = (value) => value + 1 - (value % 2);

      let accumulator = dividend >= scaled ? setLowBit(dividend - scaled) : dividend;

      for (let step = 0; step < 14; step++) {
        const shifted = wrap(accumulator * 2);
        accumulator =
          shifted >= scaled || accumulator >= 0x80000000
            ? setLowBit(wrap(shifted - scaled))
            : shifted;
      }

      this.sub16(Math.floor((accumulator % 0x80000000) / 0x8000), divisor);

      throw new DivideError();
    }

    const quotient = Math.floor(dividend / divisor) & 0xffff;
    const remainder = (dividend % divisor) & 0xffff;

    // The same undo-and-compare as div8, over DX:AX rather than AH:AL.
    const combined = ((quotient & ~1) | ((remainder << 16) >>> 0)) >>> 0;
    const compared = quotient & 1 ? ((combined + ((divisor << 16) >>> 0)) >>> 0) >>> 16 : remainder;

    this._cpu._flags.carry = compared < divisor;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags(remainder, 0x8000);

    return ((remainder << 16) | quotient) >>> 0;
  }

  /**
   * Performs the 32-bit DIV unsigned division instruction.
   *
   * Divides one 64-bit value by an unsigned 32-bit value resulting in one
   * unsigned 64-bit quotient represented as a BigInt.
   *
   * This does not set any flags and leaves most undefined.
   *
   * @param {BigInt} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {BigInt} The unsigned result. The high half is the remainder.
   */
  div32(a, b) {
    b = BigInt(b);
    const result =
      (((a & 0xffffffffffffffffn) / (b & 0xffffffffn)) & 0xffffffffn) |
      ((((a & 0xffffffffffffffffn) % (b & 0xffffffffn)) & 0xffffffffn) << 32n);

    return result;
  }

  /**
   * Performs the 8-bit IDIV signed division instruction.
   *
   * Divides one signed 16-bit value with the given signed 8-bit value
   * resulting in one unsigned 16-bit quotient.
   *
   * This does not set any flags and leaves most undefined.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result. The high half is the remainder.
   */
  idiv8(a, b) {
    const ax = a & 0xffff;
    const divisor = b & 0xff;
    const negativeDividend = (ax & 0x8000) != 0;
    const magnitude = ((divisor & 0x80) != 0 ? ~divisor + 1 : divisor) & 0xff;

    this._cpu._flags.auxiliaryCarry = true;

    /* The signed routine works from the one's complement of a negative
     * dividend, and detects overflow against the divisor's magnitude shifted
     * into place. Divide by zero lands here too.
     */
    if (((negativeDividend ? ~ax : ax) & 0xffff) >= magnitude << 7) {
      /* The division is performed the long way, because the answer determines
       * whether this faults at all: a quotient of exactly -128 is let through.
       */
      let accumulator = (negativeDividend ? ~ax : ax) & 0xffff;
      const scaled = (magnitude << 8) - 1;

      for (let step = 0; step < 8; step++) {
        accumulator = (accumulator * 2) & 0xffff;
        accumulator = accumulator - (accumulator > scaled ? scaled : 0);
      }

      let remainder = (accumulator >> 8) & 0xff;
      let quotient = accumulator & 0xff;

      /* Both the status value and CF read the remainder as it stands here,
       * before the adjustments below. They disagree about whose sign matters:
       * the status follows the dividend, CF follows the divisor.
       */
      let status = (negativeDividend ? ~remainder : remainder) & 0xff;
      const compared = (((divisor & 0x80) != 0 ? ~remainder : remainder) & 0xff) < divisor;

      this._cpu._flags.carry = compared;
      this._cpu._flags.overflow = compared;

      if (negativeDividend) {
        remainder = (remainder + 1) & 0xff;
      }

      if (remainder == magnitude) {
        remainder = 0;
        quotient = (quotient + 1) & 0xff;
        status = 0;
      }

      if (negativeDividend) {
        remainder = (~remainder + 1) & 0xff;
      }

      this._cpu._flags.zero = status == 0;
      this._cpu._flags.signed = (status & 0x80) != 0;
      this._cpu._flags.parity = ALU.PARITY[status];

      if ((ax & 0x8000) >> 8 != (divisor & 0x80)) {
        quotient = (~quotient + 1) & 0xff;

        /* The part allows a quotient of exactly -128 through rather than
         * faulting, which is a documented quirk rather than a rounding rule.
         */
        if (quotient != 0x80) {
          throw new DivideError();
        }
      } else {
        throw new DivideError();
      }

      return ((remainder << 8) | quotient) & 0xffff;
    }

    const dividend = this.toSigned16(ax);
    const signedDivisor = this.toSigned8(divisor);
    const remainder = (dividend % signedDivisor) & 0xff;

    /* The signed routine ends on a signed compare of the remainder against the
     * divisor, rather than the unsigned undo-and-compare that DIV performs.
     */
    this._cpu._flags.carry = this.toSigned8(remainder) < signedDivisor;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags(remainder, 0x80);

    return (((dividend / signedDivisor) & 0xff) | (remainder << 8)) >>> 0;
  }

  /**
   * Performs the 16-bit IDIV signed division instruction.
   *
   * Divides two signed 16-bit values resulting in one unsigned 32-bit
   * quotient.
   *
   * This does not set any flags and leaves most undefined.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result. The high half is the remainder.
   */
  idiv16(a, b) {
    const dxax = (a & 0xffffffff) >>> 0;
    const divisor = b & 0xffff;
    const negativeDividend = (dxax & 0x80000000) != 0;
    const magnitude = ((divisor & 0x8000) != 0 ? ~divisor + 1 : divisor) & 0xffff;

    this._cpu._flags.auxiliaryCarry = true;

    // The 16-bit mirror of idiv8, including the quotient of -0x8000 quirk.
    if ((negativeDividend ? ~dxax : dxax) >>> 0 >= magnitude * 0x8000) {
      let accumulator = (negativeDividend ? ~dxax : dxax) >>> 0;
      const scaled = magnitude * 0x10000 - 1;

      for (let step = 0; step < 16; step++) {
        accumulator = (accumulator * 2) % 0x100000000;
        accumulator = accumulator - (accumulator > scaled ? scaled : 0);
      }

      let remainder = Math.floor(accumulator / 0x10000) & 0xffff;
      let quotient = accumulator & 0xffff;

      // As in idiv8: read before the adjustments, and the two disagree on sign.
      let status = (negativeDividend ? ~remainder : remainder) & 0xffff;
      const compared = (((divisor & 0x8000) != 0 ? ~remainder : remainder) & 0xffff) < divisor;

      this._cpu._flags.carry = compared;
      this._cpu._flags.overflow = compared;

      if (negativeDividend) {
        remainder = (remainder + 1) & 0xffff;
      }

      if (remainder == magnitude) {
        remainder = 0;
        quotient = (quotient + 1) & 0xffff;
        status = 0;
      }

      if (negativeDividend) {
        remainder = (~remainder + 1) & 0xffff;
      }

      this._cpu._flags.zero = status == 0;
      this._cpu._flags.signed = (status & 0x8000) != 0;
      this._cpu._flags.parity = ALU.PARITY[status & 0xff];

      if (((dxax & 0x80000000) != 0) != ((divisor & 0x8000) != 0)) {
        quotient = (~quotient + 1) & 0xffff;

        if (quotient != 0x8000) {
          throw new DivideError();
        }
      } else {
        throw new DivideError();
      }

      return ((remainder << 16) | quotient) >>> 0;
    }

    const dividend = this.toSigned32(dxax);
    const signedDivisor = this.toSigned16(divisor);
    const remainder = (dividend % signedDivisor) & 0xffff;

    this._cpu._flags.carry = this.toSigned16(remainder) < signedDivisor;
    this._cpu._flags.overflow = this._cpu._flags.carry;
    this.applyWideResultFlags(remainder, 0x8000);

    return (((dividend / signedDivisor) & 0xffff) | (remainder << 16)) >>> 0;
  }

  /**
   * Performs the 32-bit IDIV signed division instruction.
   *
   * Divides one signed 64-bit value with the given signed 32-bit value
   * resulting in one unsigned 64-bit quotient represented as a BigInt.
   *
   * This does not set any flags and leaves most undefined.
   *
   * @param {BigInt} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {BigInt} The unsigned result. The high half is the remainder.
   */
  idiv32(a, b) {
    const x = BigInt(this.toSigned64(a));
    const y = BigInt(this.toSigned32(b));
    return ((x / y) & 0xffffffffn) | (((x % y) & 0xffffffffn) << 32n);
  }

  /**
   * Performs the 8-bit DEC instruction.
   *
   * This just performs an add with -1.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  dec8(a) {
    const oldCarry = this.cpu.flags.carry;
    const result = this.sub8(a, 1);
    this.cpu.flags.carry = oldCarry;
    return result;
  }

  /**
   * Performs the 16-bit DEC instruction.
   *
   * This just performs an add with -1.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  dec16(a) {
    const oldCarry = this.cpu.flags.carry;
    const result = this.sub16(a, 1);
    this.cpu.flags.carry = oldCarry;
    return result;
  }

  /**
   * Performs the 32-bit DEC instruction.
   *
   * This just performs an add with -1.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  dec32(a) {
    const oldCarry = this.cpu.flags.carry;
    const result = this.sub32(a, 1);
    this.cpu.flags.carry = oldCarry;
    return result;
  }

  /**
   * Performs the 8-bit INC instruction.
   *
   * This just performs an add with 1.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  inc8(a) {
    // INC leaves CF alone, the same way DEC does.
    const carry = this._cpu._flags.carry;
    const result = this.add8(a, 1);
    this._cpu._flags.carry = carry;

    return result;
  }

  /**
   * Performs the 16-bit INC instruction.
   *
   * This just performs an add with 1.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  inc16(a) {
    // INC leaves CF alone, the same way DEC does.
    const carry = this._cpu._flags.carry;
    const result = this.add16(a, 1);
    this._cpu._flags.carry = carry;

    return result;
  }

  /**
   * Performs the 32-bit INC instruction.
   *
   * This just performs an add with 1.
   *
   * @param {number} a - First argument.
   * @param {number} b - Second argument.
   *
   * @return {number} The unsigned result.
   */
  inc32(a) {
    // INC leaves CF alone, the same way DEC does.
    const carry = this._cpu._flags.carry;
    const result = this.add32(a, 1);
    this._cpu._flags.carry = carry;

    return result;
  }

  /**
   * Performs the 8-bit ROR instruction.
   *
   * OF is the exclusive-or of the top two bits of the result. SF, ZF, PF and
   * AF are untouched.
   */
  ror8(a, b) {
    const count = b & 0x1f;
    const value = a & 0xff;

    if (count == 0) {
      return value;
    }

    const amount = count % 8;
    const result = amount == 0 ? value : ((value >>> amount) | (value << (8 - amount))) & 0xff;

    this._cpu._flags.carry = (result & 0x80) != 0;
    this._cpu._flags.overflow = ((result & 0x80) != 0) != ((result & (0x80 >>> 1)) != 0);

    return result;
  }

  /**
   * Performs the 16-bit ROR instruction.
   *
   * OF is the exclusive-or of the top two bits of the result. SF, ZF, PF and
   * AF are untouched.
   */
  ror16(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffff;

    if (count == 0) {
      return value;
    }

    const amount = count % 16;
    const result = amount == 0 ? value : ((value >>> amount) | (value << (16 - amount))) & 0xffff;

    this._cpu._flags.carry = (result & 0x8000) != 0;
    this._cpu._flags.overflow = ((result & 0x8000) != 0) != ((result & (0x8000 >>> 1)) != 0);

    return result;
  }

  /**
   * Performs the 32-bit ROR instruction.
   *
   * OF is the exclusive-or of the top two bits of the result. SF, ZF, PF and
   * AF are untouched.
   */
  ror32(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffffffff;

    if (count == 0) {
      return value;
    }

    const amount = count % 32;
    const result =
      amount == 0 ? value : ((value >>> amount) | (value << (32 - amount))) & 0xffffffff;

    this._cpu._flags.carry = (result & 0x80000000) != 0;
    this._cpu._flags.overflow =
      ((result & 0x80000000) != 0) != ((result & (0x80000000 >>> 1)) != 0);

    return result;
  }

  /**
   * Performs the 8-bit ROL instruction.
   *
   * Rotates touch CF and OF and nothing else: SF, ZF, PF and AF keep whatever
   * they held before.
   */
  rol8(a, b) {
    const count = b & 0x1f;
    const value = a & 0xff;

    if (count == 0) {
      return value;
    }

    const amount = count % 8;
    const result = amount == 0 ? value : ((value << amount) | (value >>> (8 - amount))) & 0xff;

    this._cpu._flags.carry = (result & 0x1) != 0;
    this._cpu._flags.overflow = ((result & 0x80) != 0) != ((result & 0x1) != 0);

    return result;
  }

  /**
   * Performs the 16-bit ROL instruction.
   *
   * Rotates touch CF and OF and nothing else: SF, ZF, PF and AF keep whatever
   * they held before.
   */
  rol16(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffff;

    if (count == 0) {
      return value;
    }

    const amount = count % 16;
    const result = amount == 0 ? value : ((value << amount) | (value >>> (16 - amount))) & 0xffff;

    this._cpu._flags.carry = (result & 0x1) != 0;
    this._cpu._flags.overflow = ((result & 0x8000) != 0) != ((result & 0x1) != 0);

    return result;
  }

  /**
   * Performs the 32-bit ROL instruction.
   *
   * Rotates touch CF and OF and nothing else: SF, ZF, PF and AF keep whatever
   * they held before.
   */
  rol32(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffffffff;

    if (count == 0) {
      return value;
    }

    const amount = count % 32;
    const result =
      amount == 0 ? value : ((value << amount) | (value >>> (32 - amount))) & 0xffffffff;

    this._cpu._flags.carry = (result & 0x1) != 0;
    this._cpu._flags.overflow = ((result & 0x80000000) != 0) != ((result & 0x1) != 0);

    return result;
  }

  /**
   * Performs the 8-bit RCL instruction.
   *
   * CF takes part in the rotation, making it 9 bits wide, so the
   * count wraps at 9 rather than 8.
   */
  rcl8(a, b) {
    const rotations = b & 0x1f;
    const count = rotations % 9;
    let result = a & 0xff;

    if (rotations == 0) {
      // Only a zero count leaves the flags alone; a whole
      // rotation is an identity that still writes CF and OF.
      return result;
    }

    let carry = this._cpu._flags.carry ? 1 : 0;

    for (let step = 0; step < count; step++) {
      const top = (result & 0x80) != 0 ? 1 : 0;
      result = (((result << 1) & 0xff) | carry) >>> 0;
      carry = top;
    }

    this._cpu._flags.carry = carry != 0;
    this._cpu._flags.overflow = ((result & 0x80) != 0) != (carry != 0);

    return result;
  }

  /**
   * Performs the 16-bit RCL instruction.
   *
   * CF takes part in the rotation, making it 17 bits wide, so the
   * count wraps at 17 rather than 16.
   */
  rcl16(a, b) {
    const rotations = b & 0x1f;
    const count = rotations % 17;
    let result = a & 0xffff;

    if (rotations == 0) {
      // Only a zero count leaves the flags alone; a whole
      // rotation is an identity that still writes CF and OF.
      return result;
    }

    let carry = this._cpu._flags.carry ? 1 : 0;

    for (let step = 0; step < count; step++) {
      const top = (result & 0x8000) != 0 ? 1 : 0;
      result = (((result << 1) & 0xffff) | carry) >>> 0;
      carry = top;
    }

    this._cpu._flags.carry = carry != 0;
    this._cpu._flags.overflow = ((result & 0x8000) != 0) != (carry != 0);

    return result;
  }

  /**
   * Performs the 32-bit RCL instruction.
   *
   * CF takes part in the rotation, making it 33 bits wide, so the
   * count wraps at 33 rather than 32.
   */
  rcl32(a, b) {
    const rotations = b & 0x1f;
    const count = rotations % 33;
    let result = a & 0xffffffff;

    if (rotations == 0) {
      // Only a zero count leaves the flags alone; a whole
      // rotation is an identity that still writes CF and OF.
      return result;
    }

    let carry = this._cpu._flags.carry ? 1 : 0;

    for (let step = 0; step < count; step++) {
      const top = (result & 0x80000000) != 0 ? 1 : 0;
      result = (((result << 1) & 0xffffffff) | carry) >>> 0;
      carry = top;
    }

    this._cpu._flags.carry = carry != 0;
    this._cpu._flags.overflow = ((result & 0x80000000) != 0) != (carry != 0);

    return result;
  }

  /**
   * Performs the 8-bit RCR instruction.
   *
   * CF takes part in the rotation, making it 9 bits wide. OF is
   * the exclusive-or of the top two bits of the result.
   */
  rcr8(a, b) {
    const rotations = b & 0x1f;
    const count = rotations % 9;
    let result = a & 0xff;

    if (rotations == 0) {
      // Only a zero count leaves the flags alone; a whole
      // rotation is an identity that still writes CF and OF.
      return result;
    }

    let carry = this._cpu._flags.carry ? 1 : 0;

    for (let step = 0; step < count; step++) {
      const bottom = result & 0x1;
      result = ((result >>> 1) | (carry != 0 ? 0x80 : 0)) >>> 0;
      carry = bottom;
    }

    this._cpu._flags.carry = carry != 0;
    this._cpu._flags.overflow = ((result & 0x80) != 0) != ((result & (0x80 >>> 1)) != 0);

    return result;
  }

  /**
   * Performs the 16-bit RCR instruction.
   *
   * CF takes part in the rotation, making it 17 bits wide. OF is
   * the exclusive-or of the top two bits of the result.
   */
  rcr16(a, b) {
    const rotations = b & 0x1f;
    const count = rotations % 17;
    let result = a & 0xffff;

    if (rotations == 0) {
      // Only a zero count leaves the flags alone; a whole
      // rotation is an identity that still writes CF and OF.
      return result;
    }

    let carry = this._cpu._flags.carry ? 1 : 0;

    for (let step = 0; step < count; step++) {
      const bottom = result & 0x1;
      result = ((result >>> 1) | (carry != 0 ? 0x8000 : 0)) >>> 0;
      carry = bottom;
    }

    this._cpu._flags.carry = carry != 0;
    this._cpu._flags.overflow = ((result & 0x8000) != 0) != ((result & (0x8000 >>> 1)) != 0);

    return result;
  }

  /**
   * Performs the 32-bit RCR instruction.
   *
   * CF takes part in the rotation, making it 33 bits wide. OF is
   * the exclusive-or of the top two bits of the result.
   */
  rcr32(a, b) {
    const rotations = b & 0x1f;
    const count = rotations % 33;
    let result = a & 0xffffffff;

    if (rotations == 0) {
      // Only a zero count leaves the flags alone; a whole
      // rotation is an identity that still writes CF and OF.
      return result;
    }

    let carry = this._cpu._flags.carry ? 1 : 0;

    for (let step = 0; step < count; step++) {
      const bottom = result & 0x1;
      result = ((result >>> 1) | (carry != 0 ? 0x80000000 : 0)) >>> 0;
      carry = bottom;
    }

    this._cpu._flags.carry = carry != 0;
    this._cpu._flags.overflow =
      ((result & 0x80000000) != 0) != ((result & (0x80000000 >>> 1)) != 0);

    return result;
  }

  /**
   * Performs the 8-bit SHL/SAL instruction.
   *
   * CF is the last bit shifted out, OF is the sign of the result exclusive-or
   * CF, and AF -- documented as undefined -- follows bit 4 of the result on
   * real hardware.
   */
  shl8(a, b) {
    // The 286 masks the shift count to five bits.
    const count = b & 0x1f;
    const value = a & 0xff;

    if (count == 0) {
      // A zero count leaves every flag alone.
      return value;
    }

    const result = count < 8 ? (value << count) & 0xff : 0;

    this._cpu._flags.carry = count <= 8 ? ((value >>> (8 - count)) & 0x1) != 0 : false;
    this._cpu._flags.overflow = ((result & 0x80) != 0) != this._cpu._flags.carry;
    this._cpu._flags.auxiliaryCarry = (result & 0x10) != 0;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 16-bit SHL/SAL instruction.
   *
   * CF is the last bit shifted out, OF is the sign of the result exclusive-or
   * CF, and AF -- documented as undefined -- follows bit 4 of the result on
   * real hardware.
   */
  shl16(a, b) {
    // The 286 masks the shift count to five bits.
    const count = b & 0x1f;
    const value = a & 0xffff;

    if (count == 0) {
      // A zero count leaves every flag alone.
      return value;
    }

    const result = count < 16 ? (value << count) & 0xffff : 0;

    this._cpu._flags.carry = count <= 16 ? ((value >>> (16 - count)) & 0x1) != 0 : false;
    this._cpu._flags.overflow = ((result & 0x8000) != 0) != this._cpu._flags.carry;
    this._cpu._flags.auxiliaryCarry = (result & 0x10) != 0;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x8000) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 32-bit SHL/SAL instruction.
   *
   * CF is the last bit shifted out, OF is the sign of the result exclusive-or
   * CF, and AF -- documented as undefined -- follows bit 4 of the result on
   * real hardware.
   */
  shl32(a, b) {
    // The 286 masks the shift count to five bits.
    const count = b & 0x1f;
    const value = a & 0xffffffff;

    if (count == 0) {
      // A zero count leaves every flag alone.
      return value;
    }

    const result = count < 32 ? (value << count) & 0xffffffff : 0;

    this._cpu._flags.carry = count <= 32 ? ((value >>> (32 - count)) & 0x1) != 0 : false;
    this._cpu._flags.overflow = ((result & 0x80000000) != 0) != this._cpu._flags.carry;
    this._cpu._flags.auxiliaryCarry = (result & 0x10) != 0;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80000000) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  shl64(a: bigint, b: bigint) {
    const result = a << b;
    this._cpu._flags.overflow = ((result ^ a) & 0x8000000000000000n) != 0n;
    this._cpu._flags.carry = ((a >> (32n - b)) & 0x1n) != 0n;
    if (b > 64) {
      this._cpu._flags.carry = false;
    }

    this._cpu._flags.signed = result >= 0x8000000000000000n;

    return result & 0xffffffffffffffffn;
  }

  /**
   * Performs the 8-bit SAR instruction.
   *
   * The sign is replicated, so a count at or past the width leaves all ones or
   * all zeroes. OF is cleared, and AF -- documented as undefined -- is always
   * set on real hardware.
   */
  sar8(a, b) {
    const count = b & 0x1f;
    const value = a & 0xff;

    if (count == 0) {
      return value;
    }

    const signed = this.toSigned8(value);
    const distance = Math.min(count, 8 - 1);
    const result = (signed >> distance) & 0xff;

    this._cpu._flags.carry = ((signed >> Math.min(count - 1, 8 - 1)) & 0x1) != 0;
    this._cpu._flags.overflow = false;
    this._cpu._flags.auxiliaryCarry = true;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 16-bit SAR instruction.
   *
   * The sign is replicated, so a count at or past the width leaves all ones or
   * all zeroes. OF is cleared, and AF -- documented as undefined -- is always
   * set on real hardware.
   */
  sar16(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffff;

    if (count == 0) {
      return value;
    }

    const signed = this.toSigned16(value);
    const distance = Math.min(count, 16 - 1);
    const result = (signed >> distance) & 0xffff;

    this._cpu._flags.carry = ((signed >> Math.min(count - 1, 16 - 1)) & 0x1) != 0;
    this._cpu._flags.overflow = false;
    this._cpu._flags.auxiliaryCarry = true;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x8000) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 32-bit SAR instruction.
   *
   * The sign is replicated, so a count at or past the width leaves all ones or
   * all zeroes. OF is cleared, and AF -- documented as undefined -- is always
   * set on real hardware.
   */
  sar32(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffffffff;

    if (count == 0) {
      return value;
    }

    const signed = this.toSigned32(value);
    const distance = Math.min(count, 32 - 1);
    const result = (signed >> distance) & 0xffffffff;

    this._cpu._flags.carry = ((signed >> Math.min(count - 1, 32 - 1)) & 0x1) != 0;
    this._cpu._flags.overflow = false;
    this._cpu._flags.auxiliaryCarry = true;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80000000) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 8-bit SHR instruction.
   *
   * OF is the sign of the original value, and AF -- documented as undefined --
   * is always set on real hardware.
   */
  shr8(a, b) {
    const count = b & 0x1f;
    const value = a & 0xff;

    if (count == 0) {
      return value;
    }

    const result = count < 8 ? (value >>> count) & 0xff : 0;

    this._cpu._flags.carry = count <= 8 ? ((value >>> (count - 1)) & 0x1) != 0 : false;
    // OF is only meaningful for a single-bit shift; hardware clears it beyond.
    this._cpu._flags.overflow = count == 1 && (value & 0x80) != 0;
    this._cpu._flags.auxiliaryCarry = true;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 16-bit SHR instruction.
   *
   * OF is the sign of the original value, and AF -- documented as undefined --
   * is always set on real hardware.
   */
  shr16(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffff;

    if (count == 0) {
      return value;
    }

    const result = count < 16 ? (value >>> count) & 0xffff : 0;

    this._cpu._flags.carry = count <= 16 ? ((value >>> (count - 1)) & 0x1) != 0 : false;
    // OF is only meaningful for a single-bit shift; hardware clears it beyond.
    this._cpu._flags.overflow = count == 1 && (value & 0x8000) != 0;
    this._cpu._flags.auxiliaryCarry = true;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x8000) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  /**
   * Performs the 32-bit SHR instruction.
   *
   * OF is the sign of the original value, and AF -- documented as undefined --
   * is always set on real hardware.
   */
  shr32(a, b) {
    const count = b & 0x1f;
    const value = a & 0xffffffff;

    if (count == 0) {
      return value;
    }

    const result = count < 32 ? (value >>> count) & 0xffffffff : 0;

    this._cpu._flags.carry = count <= 32 ? ((value >>> (count - 1)) & 0x1) != 0 : false;
    // OF is only meaningful for a single-bit shift; hardware clears it beyond.
    this._cpu._flags.overflow = count == 1 && (value & 0x80000000) != 0;
    this._cpu._flags.auxiliaryCarry = true;
    this._cpu._flags.zero = result == 0;
    this._cpu._flags.signed = (result & 0x80000000) != 0;
    this._cpu._flags.parity = ALU.PARITY[result & 0xff];

    return result;
  }

  shr64(a: bigint, b: bigint) {
    if (b == 0n) {
      return a;
    }

    const result = a >> b;

    if ((b & 0x1fn) == 1n) {
      this._cpu._flags.overflow = a > 0x8000000000000000n;
    } else {
      this._cpu._flags.overflow = false;
    }

    this._cpu._flags.carry = ((a >> (b - 1n)) & 0x1n) != 0n;
    this._cpu._flags.signed = result >= 0x8000000000000000n;

    return result & 0xffffffffffffffffn;
  }
}

/**
 * Parity bit lookup table.
 *
 * x86 sets PF when the low byte of the result has an *even* number of set
 * bits. The table this replaced was inverted for all 256 entries, so every
 * instruction that touches PF reported the opposite of the hardware. Computing
 * it removes the possibility of that class of mistake.
 */
ALU.PARITY = Array.from({ length: 256 }, (_, byte) => {
  let bits = 0;

  for (let position = 0; position < 8; position++) {
    bits += (byte >> position) & 1;
  }

  return bits % 2 === 0;
});
