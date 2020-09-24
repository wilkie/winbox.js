"use strict";

/**
 * This class represents the arithmetic logic unit of the CPU.
 */
export class ALU {
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

    adc8(a, b) {
        return this.add8(a, b, this._cpu._flags.carry ? 1 : 0);
    }

    adc16(a, b) {
        return this.add16(a, b, this._cpu._flags.carry ? 1 : 0);
    }

    sub8(a, b) {
        return this.add8(a, (~b) + 1);
    }

    sub16(a, b) {
        return this.add16(a, (~b) + 1);
    }

    sbb8(a, b) {
        return this.add8(a, (~b) + 1, this._cpu._flags.carry ? 1 : 0);
    }

    sbb16(a, b) {
        return this.add16(a, (~b) + 1, this._cpu._flags.carry ? 1 : 0);
    }

    and8(a, b) {
        a = (a & b) & 0xff;
        this._cpu._flags.overflow = false;
        this._cpu._flags.carry = false;
        this._cpu._flags.zero = a == 0;
        this._cpu._flags.signed = a >= 0x80;
        this._cpu._flags.parity = ALU.PARITY[a & 0xff];
        return a;
    }

    and16(a, b) {
        a = (a & b) & 0xffff;
        this._cpu._flags.overflow = false;
        this._cpu._flags.carry = false;
        this._cpu._flags.zero = a == 0;
        this._cpu._flags.signed = a >= 0x8000;
        this._cpu._flags.parity = ALU.PARITY[a & 0xff];
        return a;
    }

    or8(a, b) {
        a = (a | b) & 0xff;
        this._cpu._flags.overflow = false;
        this._cpu._flags.carry = false;
        this._cpu._flags.zero = a == 0;
        this._cpu._flags.signed = a >= 0x80;
        this._cpu._flags.parity = ALU.PARITY[a & 0xff];
        return a;
    }

    or16(a, b) {
        a = (a | b) & 0xffff;
        this._cpu._flags.overflow = false;
        this._cpu._flags.carry = false;
        this._cpu._flags.zero = a == 0;
        this._cpu._flags.signed = a >= 0x8000;
        this._cpu._flags.parity = ALU.PARITY[a & 0xff];
        return a;
    }

    xor8(a, b) {
        a = (a ^ b) & 0xff;
        this._cpu._flags.overflow = false;
        this._cpu._flags.carry = false;
        this._cpu._flags.zero = a == 0;
        this._cpu._flags.signed = a >= 0x80;
        this._cpu._flags.parity = ALU.PARITY[a & 0xff];
        return a;
    }

    xor16(a, b) {
        a = (a ^ b) & 0xffff;
        this._cpu._flags.overflow = false;
        this._cpu._flags.carry = false;
        this._cpu._flags.zero = a == 0;
        this._cpu._flags.signed = a >= 0x8000;
        this._cpu._flags.parity = ALU.PARITY[a & 0xff];
        return a;
    }

    neg8(a) {
        let result = this.sub8(0, a);
        this._cpu._flags.carry = a != 0;
        return result;
    }

    neg16(a) {
        let result = this.sub16(0, a);
        this._cpu._flags.carry = a != 0;
        return result;
    }

    not8(a) {
        return (~a) & 0xff;
    }

    not16(a) {
        return (~a) & 0xffff;
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
    mul8(a, b) {
        let result = ((a & 0xff) * (b & 0xff)) & 0xffff;
        this._cpu._flags.carry = (result & 0xffffff00) != 0;
        this._cpu._flags.overflow = this._cpu._flags.carry;
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
        let result = (((a & 0xffff) * (b & 0xffff)) & 0xffffffff) >>> 0;
        this._cpu._flags.carry = (result & 0xffff0000) != 0;
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
        let result = (this.toSigned8(a) * this.toSigned8(b)) & 0xffff;
        this._cpu._flags.carry = (result & 0xff) != result
        this._cpu._flags.overflow = this._cpu._flags.carry;
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
        let result = ((this.toSigned16(a) * this.toSigned16(b)) >>> 0) & 0xffffffff;
        this._cpu._flags.carry = (result & 0xffff) != result
        this._cpu._flags.overflow = this._cpu._flags.carry;
        return result;
    }

    /**
     * Performs the 8-bit DIV unsigned division instruction.
     *
     * Divides two unsigned 8-bit values resulting in one unsigned 16-bit
     * quotient.
     *
     * This does not set any flags and leaves most undefined.
     *
     * @param {number} a - First argument.
     * @param {number} b - Second argument.
     *
     * @return {number} The unsigned result. The high half is the remainder.
     */
    div8(a, b) {
        return ((a & 0xff) / (b & 0xff)) & 0xff |
               ((((a & 0xff) % (b & 0xff)) & 0xff) << 8);
    }

    /**
     * Performs the 16-bit DIV unsigned division instruction.
     *
     * Divides two unsigned 16-bit values resulting in one unsigned 32-bit
     * quotient.
     *
     * This does not set any flags and leaves most undefined.
     *
     * @param {number} a - First argument.
     * @param {number} b - Second argument.
     *
     * @return {number} The unsigned result. The high half is the remainder.
     */
    div16(a, b) {
        let ret = ((a & 0xffff) / (b & 0xffff)) & 0xffff;
        if (this._cpu.ip == 0x52ff || this._cpu.ip == 0x52f8) {
            //console.log(this._cpu.ip.toString(16), "div equals 400", a, b, this._cpu.ip.toString(16));
        }
        return ((a & 0xffff) / (b & 0xffff)) & 0xffff |
               ((((a & 0xffff) % (b & 0xffff)) & 0xffff) << 16);
    }

    /**
     * Performs the 8-bit IDIV signed division instruction.
     *
     * Divides two signed 8-bit values resulting in one unsigned 16-bit
     * quotient.
     *
     * This does not set any flags and leaves most undefined.
     *
     * @param {number} a - First argument.
     * @param {number} b - Second argument.
     *
     * @return {number} The unsigned result. The high half is the remainder.
     */
    idiv8(a, b) {
        a = this.toSigned8(a);
        b = this.toSigned8(b);
        return ((a / b) & 0xff) | (((a % b) & 0xff) << 8);
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
        a = this.toSigned16(a);
        b = this.toSigned16(b);
        return (((a / b) & 0xffff) | (((a % b) & 0xffff) << 16)) >>> 0;
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
        let oldCarry = this.cpu.flags.carry;
        let result = this.sub8(a, 1);
        this.cpu.flags.carry = oldCarry;
        return result;
    }

    /**
     * Performs the 16-bit DEC instruction.
     *
     * This just performs an add with 1.
     *
     * @param {number} a - First argument.
     * @param {number} b - Second argument.
     *
     * @return {number} The unsigned result.
     */
    dec16(a) {
        let oldCarry = this.cpu.flags.carry;
        let result = this.sub16(a, 1);
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
        return this.add8(a, 1);
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
        return this.add16(a, 1);
    }

    ror8(a, b) {
        a &= 0xff;
        if (!(b & 0x7)) { // Some result (rotates around)
            if (b & 0x18) { // Rotates just once!
                this._cpu._flags.carry = (a >> 7) != 0;
                this._cpu._flags.overflow = ((a >> 7) ^ ((a >> 6) & 0x1)) != 0;
            }
            return a;
        }
        a = (a >> b) | (a << (8 - b));
        this._cpu._flags.carry = (a & 0x80) != 0;
        this._cpu._flags.overflow = ((a ^ (a << 1)) & 0x80) != 0;
        return a;
    }

    ror16(a, b) {
        a &= 0xffff;
        if (!(b & 0xf)) { // Some result (rotates around)
            if (b & 0x10) { // Rotates just once!
                this._cpu._flags.carry = (a >> 15) != 0;
                this._cpu._flags.overflow = ((a >> 15) ^ ((a >> 14) & 0x1)) != 0;
            }
            return a;
        }
        a = (a >> b) | (a << (16 - b));
        this._cpu._flags.carry = (a & 0x8000) != 0;
        this._cpu._flags.overflow = ((a ^ (a << 1)) & 0x8000) != 0;
        return a;
    }

    rol8(a, b) {
        a &= 0xff;
        if (!(b & 0x7)) { // Some result (rotates around)
            if (b & 0x18) { // Rotates just once!
                this._cpu._flags.carry = (a & 0x1) != 0;
                this._cpu._flags.overflow = ((a & 0x1) ^ ((a >> 7))) != 0;
            }
            return a;
        }
        b &= 0x7;
        a = (a << b) | (a >> (8 - b));
        this._cpu._flags.carry = (a & 0x1) != 0;
        this._cpu._flags.overflow = ((a & 0x1) ^ ((a >> 7))) != 0;
        return a;
    }

    rol16(a, b) {
        a &= 0xffff;
        if (!(b & 0xf)) { // Some result (rotates around)
            if (b & 0x10) { // Rotates just once!
                this._cpu._flags.carry = (a & 0x1) != 0;
                this._cpu._flags.overflow = ((a & 0x1) ^ ((a >> 15))) != 0;
            }
            return a;
        }
        b &= 0xf;
        a = (a << b) | (a >> (16 - b));
        this._cpu._flags.carry = (a & 0x1) != 0;
        this._cpu._flags.overflow = ((a & 0x1) ^ ((a >> 15))) != 0;
        return a;
    }

    rcl8(a, b) {
        if ((b % 9) == 0) {
            return a;
        }

        a &= 0xff;
        b %= 9;
        let result = (a << b) |
                     ((this._cpu._flags.carry ? 1 : 0) << (b - 1)) |
                     (a >> (9 - b));
        this._cpu._flags.carry = (a >> (16 - b)) & 0x1;
        this._cpu._flags.overflow = (this._cpu._flags.carry ? 1 : 0) ^ (result >> 7);
        return a & 0xff;
    }

    rcl16(a, b) {
        if ((b % 17) == 0) {
            return a;
        }

        a &= 0xffff;
        b %= 17;
        let result = (a << b) |
                     ((this._cpu._flags.carry ? 1 : 0) << (b - 1)) |
                     (a >> (17 - b));
        this._cpu._flags.carry = (a >> (16 - b)) & 0x1;
        this._cpu._flags.overflow = (this._cpu._flags.carry ? 1 : 0) ^ (result >> 15);
        return result & 0xffff;
    }

    rcr8(a, b) {
        if (b % 9 == 0) {
            return a;
        }

        a &= 0xff;
        b %= 9;
        let result = (a >> b) |
                     ((this._cpu._flags.carry ? 1 : 0) << (8 - b)) |
                     (a << (9 - b));

        this._cpu._flags.carry = ((a >> (b - 1)) & 0x1) != 0;
        this._cpu._flags.overflow = ((result ^ (result << 1)) & 0x80) != 0;

        return result & 0xff;
    }

    rcr16(a, b) {
        if (b % 17 == 0) {
            return a;
        }

        a &= 0xffff;
        b %= 17;
        let result = (a >> b) |
                     ((this._cpu._flags.carry ? 1 : 0) << (16 - b)) |
                     (a << (17 - b));

        this._cpu._flags.carry = ((a >> (b - 1)) & 0x1) != 0;
        this._cpu._flags.overflow = ((result ^ (result << 1)) & 0x8000) != 0;

        return result & 0xffff;
    }

    shl8(a, b) {
        let result = a <<= b;
        this._cpu._flags.overflow = ((result ^ a) & 0x80) != 0;
        this._cpu._flags.carry = ((a >> (8 - b)) & 0x1) != 0;
        if (b > 8) {
            this._cpu._flags.carry = false;
        }

        return result & 0xff;
    }

    shl16(a, b) {
        let result = a << b;
        this._cpu._flags.overflow = ((result ^ a) & 0x8000) != 0;
        this._cpu._flags.carry = ((a >> (16 - b)) & 0x1) != 0;
        if (b > 16) {
            this._cpu._flags.carry = false;
        }

        return result & 0xffff;
    }

    sar8(a, b) {
        if (b > 8) {
            b = 8;
        }

        let result = a >> b;
        if (a & 0x80) {
            result |= (0xff << (8 - b));
        }

        this._cpu._flags.carry = ((a >> (b - 1)) & 0x1) != 0;
        this._cpu._flags.overflow = false;
        return result & 0xff;
    }

    sar16(a, b) {
        if (b > 16) {
            b = 16;
        }

        let result = a >> b;
        if (a & 0x8000) {
            result |= (0xffff << (16 - b));
        }

        this._cpu._flags.carry = ((a >> (b - 1)) & 0x1) != 0;
        this._cpu._flags.overflow = false;
        return result & 0xffff;
    }

    shr8(a, b) {
        if (b == 0) {
            return a;
        }

        let result = a >> b;

        if ((b & 0x1f) == 1) {
            this._cpu._flags.overflow = a > 0x80;
        }
        else {
            this._cpu._flags.overflow = false;
        }

        this._cpu._flags.carry = ((a >> (b - 1)) & 0x1) != 0;

        return result & 0xff;
    }

    shr16(a, b) {
        if (b == 0) {
            return a;
        }

        let result = a >> b;

        if ((b & 0x1f) == 1) {
            this._cpu._flags.overflow = a > 0x8000;
        }
        else {
            this._cpu._flags.overflow = false;
        }

        this._cpu._flags.carry = ((a >> (b - 1)) & 0x1) != 0;

        return result & 0xffff;
    }
}

// Parity bit lookup table.
ALU.PARITY = [
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false,
    false,true,true,false,true,false,false,true,
    false,true,true,false,true,false,false,true,
    true,false,false,true,false,true,true,false
];
