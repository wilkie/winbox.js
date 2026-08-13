"use strict";

import { Helper } from '../helper.js';

import { CPU } from '../../src/emulator/cpu.js';
import { Memory } from '../../src/emulator/memory.js';

/**
 * Creates a randomized and stubbed CPU instance.
 */
export function MockCPU(flags?) {
    const cpu = new CPU();

    // Stub #decode and #execute
    jest.spyOn(cpu, 'decode').mockReturnValue({});
    jest.spyOn(cpu, 'execute').mockReturnValue({});

    // Assign random flags to the CPU
    cpu.f = flags || Helper.randomInteger(0, 0xffff);

    // Assign random values to registers
    cpu.ax = Helper.randomInteger(0, 0xffff);
    cpu.bx = Helper.randomInteger(0, 0xffff);
    cpu.cx = Helper.randomInteger(0, 0xffff);
    cpu.dx = Helper.randomInteger(0, 0xffff);
    cpu.sp = Helper.randomInteger(0, 0xffff);
    cpu.bp = Helper.randomInteger(0, 0xffff);
    cpu.si = Helper.randomInteger(0, 0xffff);
    cpu.di = Helper.randomInteger(0, 0xffff);
    cpu.es = Helper.randomInteger(0, 0xffff);
    cpu.cs = Helper.randomInteger(0, 0xffff);
    cpu.ss = Helper.randomInteger(0, 0xffff);
    cpu.ds = Helper.randomInteger(0, 0xffff);

    // Assign random instruction pointer
    cpu.ip = Helper.randomInteger(0, 0xffff);
    return cpu;
}

export function writeImm8(offset) {
    const imm = Helper.randomInteger(0x00, 0xff);
    this.checkInstruction.immediate = imm;
    this.memory.write8(this.segment, offset, imm);
    return offset + 1;
}

export function writeImm16(offset) {
    const imm = Helper.randomInteger(0x00, 0xffff);
    this.checkInstruction.immediate = imm;
    this.memory.write16(this.segment, offset, imm);
    return offset + 2;
}

export function writeMemOperand8(value) {
    this.memory.allocate(this.checkInstruction.segment,
                         this.checkInstruction.offset + 2);
    this.memory.write8(this.checkInstruction.segment,
                       this.checkInstruction.offset, value);
}

export function writeMemOperand16(value) {
    this.memory.allocate(this.checkInstruction.segment,
                         this.checkInstruction.offset + 2);
    this.memory.write16(this.checkInstruction.segment,
                        this.checkInstruction.offset, value);
}

export function writeModRM(offset, reg) {
    let mod = Helper.randomInteger(0x0, 0x3);
    let rm = Helper.randomInteger(0x0, 0x7);

    if (this.checkInstruction.operandRegister !== undefined) {
        if (this.checkInstruction.operandRegister < 0) {
            // Ensure it is a memory operand
            mod = Helper.randomInteger(0x0, 0x2);
        }
        else {
            // Ensure it is the given register operand
            rm = this.checkInstruction.operandRegister;
            mod = 3;
        }
    }

    if (reg === undefined) {
        reg = Helper.randomInteger(0x0, 0x7);
    }

    const modRM = rm | (reg << 3) | (mod << 6);
    this.memory.write8(this.segment, offset, modRM);
    offset++;

    this.checkInstruction.displacement = 0;

    // Displacement is 0 if (mod == 0)
    if (mod == 0 && rm == 6) {
        this.checkInstruction.segment =
            this.checkInstruction.segment !== undefined ?
            this.checkInstruction.segment : (this.cpu.ds >> 3);
        this.checkInstruction.offset = Helper.randomInteger(0x0000, 0xffff);
        this.memory.write16(this.segment, offset, this.checkInstruction.offset);
        offset += 2;
    }
    else if (mod == 1) {
        this.checkInstruction.displacement = Helper.randomInteger(-128, 127);
        this.memory.write8(this.segment, offset, this.checkInstruction.displacement);
        offset++;
    }
    else if (mod == 2) {
        this.checkInstruction.displacement = Helper.randomInteger(-32768, 32767);
        this.memory.write16(this.segment, offset, this.checkInstruction.displacement);
        offset += 2;
    }
    else if (mod == 3) {
        // Register is the destination
        this.checkInstruction.operandRegister = rm;
    }

    // Effective address
    if ((this.checkInstruction.offset === undefined) && mod != 3) {
        switch (rm) {
            case 0:       // (BX) + (SI) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ds >> 3);
                this.checkInstruction.offset = this.cpu.bx + this.cpu.si
                    + this.checkInstruction.displacement;
                break;
            case 1:       // (BX) + (DI) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ds >> 3);
                this.checkInstruction.offset = this.cpu.bx + this.cpu.di
                    + this.checkInstruction.displacement;
                break;
            case 2:       // (BP) + (SI) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ss >> 3);
                this.checkInstruction.offset = this.cpu.bp + this.cpu.si
                    + this.checkInstruction.displacement;
                break;
            case 3:       // (BP) + (DI) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ss >> 3);
                this.checkInstruction.offset = this.cpu.bp + this.cpu.di
                    + this.checkInstruction.displacement;
                break;
            case 4:       // (SI) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ds >> 3);
                this.checkInstruction.offset = this.cpu.si
                    + this.checkInstruction.displacement;
                break;
            case 5:       // (DI) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ds >> 3);
                this.checkInstruction.offset = this.cpu.di
                    + this.checkInstruction.displacement;
                break;
            case 6:       // (BP) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ss >> 3);
                this.checkInstruction.offset = this.cpu.bp
                    + this.checkInstruction.displacement;
                break;
            case 7:       // (BX) + DISP
                this.checkInstruction.segment = this.checkInstruction.segment !== undefined ?
                    this.checkInstruction.segment : (this.cpu.ds >> 3);
                this.checkInstruction.offset = this.cpu.bx
                    + this.checkInstruction.displacement;
                break;
        }
    }

    if (this.checkInstruction.offset) {
        this.checkInstruction.offset &= 0xffff;
    }

    return offset;
}

export function assertInstruction() {
    expect(this.instruction.displacement)
      .toEqual(this.checkInstruction.displacement);
    expect(this.instruction.offset)
      .toEqual(this.checkInstruction.offset);
    expect(this.instruction.operandRegister)
      .toEqual(this.checkInstruction.operandRegister);
    expect(this.instruction.segment)
      .toEqual(this.checkInstruction.segment);
    expect(this.instruction.immediate)
      .toEqual(this.checkInstruction.immediate);
}

export function setup() {
    this.memory = new Memory();
    this.cpu = new CPU(this.memory);
    this.writeModRM = writeModRM.bind(this);
    this.writeImm8 = writeImm8.bind(this);
    this.writeImm16 = writeImm16.bind(this);
    this.writeMemOperand8 = writeMemOperand8.bind(this);
    this.writeMemOperand16 = writeMemOperand16.bind(this);
    this.assertInstruction = assertInstruction.bind(this);
    this.checkInstruction = {};
}

export function setupExecute() {
    this.cpu.ip = Helper.randomInteger(0x0, 0xf000);
    this.cpu.cs = Helper.randomInteger(0x1, 0x1fff) << 3 | 0x3;
    this.segment = this.cpu.cs >> 3;

    this.cpu.ax = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.bx = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.cx = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.dx = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.si = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.di = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.bp = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.sp = Helper.randomInteger(0x0000, 0xffff);

    this.cpu.ds = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.ss = Helper.randomInteger(0x0000, 0xffff);
    this.cpu.es = Helper.randomInteger(0x0000, 0xffff);

    // Fill in zeroes until the IP and then a few more
    this.memory.allocate(this.segment, this.cpu.ip + 16);
    this.instruction = {};
}

describe('CPU', () => {
    beforeEach(function() {
        setup.bind(this)();
    });

    describe('.constructor', () => {
        // it should set the registers to 0
        // it should set flags to 0
        // it should retain the memory instance
    });

    describe('#decode', () => {
        beforeEach(function() {
            setupExecute.bind(this)();
        });

        it ('should decode the lgdt instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0f);
            this.memory.write8(this.segment, this.cpu.ip + 1, 0x01);
            const offset = this.writeModRM(this.cpu.ip + 2, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();

            expect(this.instruction.opcode).toEqual(0x100);
            expect(this.instruction.subOpcode).toEqual(0xf);
        });

        it ('should decode the `test eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();

            expect(this.instruction.opcode).toEqual(0x200);
            expect(this.instruction.subOpcode).toEqual(0xf6);
        });

        it ('should decode the `test ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();

            expect(this.instruction.opcode).toEqual(0x400);
            expect(this.instruction.subOpcode).toEqual(0xf7);
        });

        it ('should decode the `push es` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x06);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x06);
        });

        it ('should decode the `pop es` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x07);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x07);
        });

        it ('should decode the `push cs` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0e);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x0e);
        });

        it ('should decode the `push ss` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x16);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x16);
        });

        it ('should decode the `pop ss` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x17);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x17);
        });

        it ('should decode the `push ds` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x1e);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x1e);
        });

        it ('should decode the `pop ds` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x1f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x1f);
        });

        it ('should decode the `daa` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x27);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x27);
        });

        it ('should decode the `das` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x2f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x2f);
        });

        it ('should decode the `aaa` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x37);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x37);
        });

        it ('should decode the `aas` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x3f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x3f);
        });

        it ('should decode the `inc ax` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x40);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x40);
        });

        it ('should decode the `inc cx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x41);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x41);
        });

        it ('should decode the `inc dx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x42);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x42);
        });

        it ('should decode the `inc bx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x43);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x43);
        });

        it ('should decode the `inc sp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x44);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x44);
        });

        it ('should decode the `inc bp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x45);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x45);
        });

        it ('should decode the `inc si` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x46);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x46);
        });

        it ('should decode the `inc di` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x47);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x47);
        });

        it ('should decode the `dec ax` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x48);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x48);
        });

        it ('should decode the `dec cx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x49);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x49);
        });

        it ('should decode the `dec dx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x4a);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x4a);
        });

        it ('should decode the `dec bx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x4b);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x4b);
        });

        it ('should decode the `dec sp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x4c);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x4c);
        });

        it ('should decode the `dec bp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x4d);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x4d);
        });

        it ('should decode the `dec si` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x4e);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x4e);
        });

        it ('should decode the `dec di` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x4f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x4f);
        });

        it ('should decode the `push ax` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x50);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x50);
        });

        it ('should decode the `push cx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x51);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x51);
        });

        it ('should decode the `push dx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x52);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x52);
        });

        it ('should decode the `push bx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x53);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x53);
        });

        it ('should decode the `push sp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x54);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x54);
        });

        it ('should decode the `push bp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x55);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x55);
        });

        it ('should decode the `push si` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x56);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x56);
        });

        it ('should decode the `push di` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x57);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x57);
        });

        it ('should decode the `pop ax` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x58);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x58);
        });

        it ('should decode the `pop cx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x59);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x59);
        });

        it ('should decode the `pop dx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x5a);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x5a);
        });

        it ('should decode the `pop bx` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x5b);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x5b);
        });

        it ('should decode the `pop sp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x5c);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x5c);
        });

        it ('should decode the `pop bp` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x5d);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x5d);
        });

        it ('should decode the `pop si` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x5e);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x5e);
        });

        it ('should decode the `pop di` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x5f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x5f);
        });

        it ('should decode the `pusha` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x60);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x60);
        });

        it ('should decode the `popa` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x61);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x61);
        });

        it ('should decode the `ins eb,DX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x6c);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x6c);
        });

        it ('should decode the `outs DX,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x6e);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x6e);
        });

        it ('should decode the `ins ew,DX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x6d);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x6d);
        });

        it ('should decode the `outs DX,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x6f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x6f);
        });

        it ('should decode the `nop` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x90);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x90);
        });

        it ('should decode the `xchg AX,CX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x91);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x91);
        });

        it ('should decode the `xchg AX,DX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x92);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x92);
        });

        it ('should decode the `xchg AX,BX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x93);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x93);
        });

        it ('should decode the `xchg AX,SP` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x94);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x94);
        });

        it ('should decode the `xchg AX,BP` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x95);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x95);
        });

        it ('should decode the `xchg AX,SI` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x96);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x96);
        });

        it ('should decode the `xchg AX,DI` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x97);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x97);
        });

        it ('should decode the `cbw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x98);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x98);
        });

        it ('should decode the `cwd` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x99);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x99);
        });

        it ('should decode the `wait` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x9b);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x9b);
        });

        it ('should decode the `pushf` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x9c);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x9c);
        });

        it ('should decode the `popf` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x9d);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x9d);
        });

        it ('should decode the `sahf` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x9e);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x9e);
        });

        it ('should decode the `lahf` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x9f);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x9f);
        });

        it ('should decode the `movs mb,mb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa4);
        });

        it ('should decode the `movs mw,mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa5);
        });

        it ('should decode the `cmpsb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa6);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa6);
        });

        it ('should decode the `cmpsw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa7);
        });

        it ('should decode the `stos mb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xaa);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xaa);
        });

        it ('should decode the `stos mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xab);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xab);
        });

        it ('should decode the `lods mb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xac);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xac);
        });

        it ('should decode the `lods mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xad);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xad);
        });

        it ('should decode the `scas mb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xae);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xae);
        });

        it ('should decode the `scas mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xaf);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xaf);
        });

        it ('should decode the `ret` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc3);
        });

        it ('should decode the `leave` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc9);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc9);
        });

        it ('should decode the `ret far` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xcb);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xcb);
        });

        it ('should decode the `int 0x3` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xcc);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xcc);
        });

        it ('should decode the `into` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xce);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xce);
        });

        it ('should decode the `iret` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xcf);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xcf);
        });

        it ('should decode the `xlat mb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd7);
        });

        it ('should decode the `in AL,DX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xec);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xec);
        });

        it ('should decode the `in AX,DX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xed);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xed);
        });

        it ('should decode the `out DX,AL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xee);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xee);
        });

        it ('should decode the `out DX,AX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xef);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xef);
        });

        it ('should decode the `halt` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf4);
        });

        it ('should decode the `cmc` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf5);
        });

        it ('should decode the `clc` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf8);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf8);
        });

        it ('should decode the `stc` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf9);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf9);
        });

        it ('should decode the `cli` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfa);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfa);
        });

        it ('should decode the `cli` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfa);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfa);
        });

        it ('should decode the `sti` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfb);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfb);
        });

        it ('should decode the `cld` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfc);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfc);
        });

        it ('should decode the `std` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfd);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfd);
        });

        it ('should decode the `add AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x04);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x04);
        });

        it ('should decode the `or AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0c);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x0c);
        });

        it ('should decode the `clts` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0f);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x0f);
        });

        it ('should decode the `adc AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x14);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x14);
        });

        it ('should decode the `sbb AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x1c);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x1c);
        });

        it ('should decode the `and AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x24);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x24);
        });

        it ('should decode the `sub AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x2c);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x2c);
        });

        it ('should decode the `xor AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x34);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x34);
        });

        it ('should decode the `cmp AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x3c);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x3c);
        });

        it ('should decode the `push db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x6a);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x6a);
        });

        it ('should decode the `jo cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x70);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x70);
        });

        it ('should decode the `jno cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x71);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x71);
        });

        it ('should decode the `jb cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x72);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x72);
        });

        it ('should decode the `jae cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x73);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x73);
        });

        it ('should decode the `je cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x74);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x74);
        });

        it ('should decode the `jne cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x75);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x75);
        });

        it ('should decode the `jbe cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x76);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x76);
        });

        it ('should decode the `ja cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x77);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x77);
        });

        it ('should decode the `js cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x78);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x78);
        });

        it ('should decode the `jns cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x79);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x79);
        });

        it ('should decode the `jp cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x7a);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x7a);
        });

        it ('should decode the `jnp cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x7b);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x7b);
        });

        it ('should decode the `jl cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x7c);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x7c);
        });

        it ('should decode the `jge cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x7d);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x7d);
        });

        it ('should decode the `jle cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x7e);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x7e);
        });

        it ('should decode the `jg cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x7f);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x7f);
        });

        it ('should decode the `test AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa8);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa8);
        });

        it ('should decode the `mov AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb0);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb0);
        });

        it ('should decode the `mov CL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb1);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb1);
        });

        it ('should decode the `mov DL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb2);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb2);
        });

        it ('should decode the `mov BL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb3);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb3);
        });

        it ('should decode the `mov AH,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb4);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb4);
        });

        it ('should decode the `mov CH,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb5);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb5);
        });

        it ('should decode the `mov DH,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb6);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb6);
        });

        it ('should decode the `mov BH,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb7);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb7);
        });

        it ('should decode the `int db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xcd);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xcd);
        });

        it ('should decode the `aam` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd4);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd4);
        });

        it ('should decode the `aad` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd5);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd5);
        });

        it ('should decode the `loopne cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe0);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe0);
        });

        it ('should decode the `loope cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe1);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe1);
        });

        it ('should decode the `loop cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe2);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe2);
        });

        it ('should decode the `jcxz cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe3);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe3);
        });

        it ('should decode the `in AL,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe4);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe4);
        });

        it ('should decode the `in AX,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe5);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe5);
        });

        it ('should decode the `out db,AL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe6);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe6);
        });

        it ('should decode the `out db,AX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe7);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe7);
        });

        it ('should decode the `jmp cb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xeb);
            const offset = this.writeImm8(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xeb);
        });

        it ('should decode the `add AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x05);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x05);
        });

        it ('should decode the `or AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0d);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x0d);
        });

        it ('should decode the `adc AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x15);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x15);
        });

        it ('should decode the `sbb AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x1d);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x1d);
        });

        it ('should decode the `and AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x25);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x25);
        });

        it ('should decode the `sub AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x2d);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x2d);
        });

        it ('should decode the `xor AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x35);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x35);
        });

        it ('should decode the `cmp AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x3d);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x3d);
        });

        it ('should decode the `push dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x68);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x68);
        });

        it ('should decode the `mov AL,xb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa0);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa0);
        });

        it ('should decode the `mov AX,xw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa1);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa1);
        });

        it ('should decode the `mov xb,AL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa2);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa2);
        });

        it ('should decode the `mov xw,AX` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa3);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa3);
        });

        it ('should decode the `test AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xa9);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xa9);
        });

        it ('should decode the `mov AX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb8);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb8);
        });

        it ('should decode the `mov CX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xb9);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xb9);
        });

        it ('should decode the `mov DX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xba);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xba);
        });

        it ('should decode the `mov BX,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xbb);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xbb);
        });

        it ('should decode the `mov SP,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xbc);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xbc);
        });

        it ('should decode the `mov BP,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xbd);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xbd);
        });

        it ('should decode the `mov SI,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xbe);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xbe);
        });

        it ('should decode the `mov DI,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xbf);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xbf);
        });

        it ('should decode the `ret dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc2);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc2);
        });

        it ('should decode the `ret far dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xca);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xca);
        });

        it ('should decode the `call cw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe8);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe8);
        });

        it ('should decode the `jmp cw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xe9);
            const offset = this.writeImm16(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xe9);
        });

        it ('should decode the `enter dw,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc8);
            let offset = this.writeImm16(this.cpu.ip + 1);
            const imm = this.checkInstruction.immediate;
            offset = this.writeImm8(offset);
            this.checkInstruction.level = this.checkInstruction.immediate;
            this.checkInstruction.immediate = imm;
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc8);
            expect(this.instruction.level).toEqual(this.checkInstruction.level);
        });

        it ('should decode the `call far cd` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x9a);
            let offset = this.writeImm16(this.cpu.ip + 1);
            const imm = this.checkInstruction.immediate;
            offset = this.writeImm16(offset);
            this.checkInstruction.targetCS = this.checkInstruction.immediate;
            this.checkInstruction.immediate = imm;
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x9a);
        });

        it ('should decode the `jmp far cd` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xea);
            let offset = this.writeImm16(this.cpu.ip + 1);
            const imm = this.checkInstruction.immediate;
            offset = this.writeImm16(offset);
            this.checkInstruction.targetCS = this.checkInstruction.immediate;
            this.checkInstruction.immediate = imm;
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xea);
        });

        it ('should decode the `imul rw,ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x69);
            let offset = this.writeModRM(this.cpu.ip + 1);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x69);
        });

        it ('should decode the `add ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `or ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `adc ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `sbb ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `and ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `sub ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `xor ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x6);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `cmp ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x81);
        });

        it ('should decode the `mov ew,dw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc7);
            let offset = this.writeModRM(this.cpu.ip + 1);
            offset = this.writeImm16(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc7);
        });

        it ('should decode the `imul rw,ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x6b);
            let offset = this.writeModRM(this.cpu.ip + 1);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x6b);
        });

        it ('should decode the `add eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `or eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `adc eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `sbb eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `and eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `sub eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `xor eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x6);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `cmp eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x80);
        });

        it ('should decode the `add ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x83);
        });

        it ('should decode the `adc ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x83);
        });

        it ('should decode the `sbb ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x83);
        });

        it ('should decode the `sub ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x83);
        });

        it ('should decode the `cmp ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x83);
        });

        it ('should decode the `rol eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `ror eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `rcl eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `rcr eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `sal eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `shr eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `sar eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc0);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc0);
        });

        it ('should decode the `rol ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `ror ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `rcl ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `rcr ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `sal ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `shr ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `sar ew,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc1);
            let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc1);
        });

        it ('should decode the `mov eb,db` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc6);
            let offset = this.writeModRM(this.cpu.ip + 1);
            offset = this.writeImm8(offset);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc6);
        });

        it ('should decode the `add eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x00);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x00);
        });

        it ('should decode the `add ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x01);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x01);
        });

        it ('should decode the `add rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x02);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x02);
        });

        it ('should decode the `add rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x03);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x03);
        });

        it ('should decode the `or eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x08);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x08);
        });

        it ('should decode the `or ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x09);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x09);
        });

        it ('should decode the `or rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0a);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x0a);
        });

        it ('should decode the `or rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x0b);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x0b);
        });

        it ('should decode the `adc eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x10);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x10);
        });

        it ('should decode the `adc ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x11);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x11);
        });

        it ('should decode the `adc rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x12);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x12);
        });

        it ('should decode the `adc rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x13);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x13);
        });

        it ('should decode the `sbb eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x18);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x18);
        });

        it ('should decode the `sbb ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x19);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x19);
        });

        it ('should decode the `sbb rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x1a);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x1a);
        });

        it ('should decode the `sbb rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x1b);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x1b);
        });

        it ('should decode the `and eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x20);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x20);
        });

        it ('should decode the `and ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x21);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x21);
        });

        it ('should decode the `and rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x22);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x22);
        });

        it ('should decode the `and rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x23);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x23);
        });

        it ('should decode the `sub eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x28);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x28);
        });

        it ('should decode the `sub ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x29);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x29);
        });

        it ('should decode the `sub rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x2a);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x2a);
        });

        it ('should decode the `sub rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x2b);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x2b);
        });

        it ('should decode the `xor eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x30);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x30);
        });

        it ('should decode the `xor ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x31);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x31);
        });

        it ('should decode the `xor rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x32);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x32);
        });

        it ('should decode the `xor rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x33);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x33);
        });

        it ('should decode the `cmp eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x38);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x38);
        });

        it ('should decode the `cmp ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x39);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x39);
        });

        it ('should decode the `cmp rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x3a);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x3a);
        });

        it ('should decode the `cmp rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x3b);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x3b);
        });

        it ('should decode the `bound rw,md` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x62);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x62);
        });

        it ('should decode the `arpl ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x63);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x63);
        });

        it ('should decode the `test eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x84);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x84);
        });

        it ('should decode the `test ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x85);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x85);
        });

        it ('should decode the `xchg eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x86);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x86);
        });

        it ('should decode the `xchg eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x87);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x87);
        });

        it ('should decode the `mov eb,rb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x88);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x88);
        });

        it ('should decode the `mov ew,rw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x89);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x89);
        });

        it ('should decode the `mov rb,eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8a);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8a);
        });

        it ('should decode the `mov rw,ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8b);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8b);
        });

        it ('should decode the `mov ew,ES` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8c);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x00);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8c);
        });

        it ('should decode the `mov ew,CS` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8c);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x01);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8c);
        });

        it ('should decode the `mov ew,SS` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8c);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x02);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8c);
        });

        it ('should decode the `mov ew,DS` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8c);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x03);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8c);
        });

        it ('should decode the `lea` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8d);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8d);
        });

        it ('should decode the `mov ES,mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8e);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x00);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8e);
        });

        it ('should decode the `mov CS,mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8e);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x01);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8e);
        });

        it ('should decode the `mov SS,mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8e);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x02);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8e);
        });

        it ('should decode the `mov DS,mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8e);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x03);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8e);
        });

        it ('should decode the `pop mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0x8f);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0x8f);
        });

        it ('should decode the `les rw,ed` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc4);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc4);
        });

        it ('should decode the `lds rw,ed` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xc5);
            const offset = this.writeModRM(this.cpu.ip + 1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xc5);
        });

        it ('should decode the `rol eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `ror eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `rcl eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `rcr eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `sal eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `shr eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `sar eb,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd0);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd0);
        });

        it ('should decode the `rol ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `ror ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `rcl ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `rcr ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `sal ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `shr ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `sar ew,1` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd1);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd1);
        });

        it ('should decode the `rol eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `ror eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `rcl eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `rcr eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `sal eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `shr eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `sar eb,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd2);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd2);
        });

        it ('should decode the `rol ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `ror ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `rcl ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `rcr ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `sal ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `shr ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `sar ew,CL` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xd3);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xd3);
        });

        it ('should decode the `not eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf6);
        });

        it ('should decode the `neg eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf6);
        });

        it ('should decode the `mul eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf6);
        });

        it ('should decode the `imul eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf6);
        });

        it ('should decode the `div eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x6);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf6);
        });

        it ('should decode the `idiv eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf6);
        });

        it ('should decode the `not ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf7);
        });

        it ('should decode the `neg ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf7);
        });

        it ('should decode the `mul ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf7);
        });

        it ('should decode the `imul ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf7);
        });

        it ('should decode the `div ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x6);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf7);
        });

        it ('should decode the `idiv ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x7);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xf7);
        });

        it ('should decode the `inc eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfe);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfe);
        });

        it ('should decode the `dec eb` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xfe);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xfe);
        });

        it ('should decode the `inc ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x0);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });

        it ('should decode the `dec ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x1);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });

        it ('should decode the `call ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x2);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });

        it ('should decode the `call far ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x3);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });

        it ('should decode the `jmp ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x4);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });

        it ('should decode the `jmp far ew` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x5);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });

        it ('should decode the `push mw` instruction', function() {
            this.memory.write8(this.segment, this.cpu.ip + 0, 0xff);
            const offset = this.writeModRM(this.cpu.ip + 1, 0x6);
            this.instruction = this.cpu.decode(this.instruction);
            this.assertInstruction();
            expect(this.instruction.opcode).toEqual(0xff);
        });
    });
});
