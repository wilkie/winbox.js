"use strict";

import { Helper } from '../../helper.js';

import { ALU } from '../../../src/emulator/alu.js';
import { CPU } from '../../../src/emulator/cpu.js';
import { Memory } from '../../../src/emulator/memory.js';

import { setup, setupExecute } from '../cpu_test.js';

describe('CPU', () => {
    beforeEach(function() {
        setup.bind(this)();
    });

    describe('#execute', () => {
        beforeEach(function() {
            setupExecute.bind(this)();
        });

        describe('cmp eb,db', function() {
            it ('should execute the instruction with register source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
                this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
                let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
                offset = this.writeImm8(offset);

                let a = Helper.randomInteger(0x00, 0xff);
                let b = this.checkInstruction.immediate;

                this.cpu.writeRegister8(this.checkInstruction.operandRegister, a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub8').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub8).toHaveBeenCalledWith(a, b);
            });

            it ('should execute the instruction with memory source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x80);
                this.checkInstruction.operandRegister = -1;
                let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
                offset = this.writeImm8(offset);

                let a = Helper.randomInteger(0x00, 0xff);
                let b = this.checkInstruction.immediate;

                this.writeMemOperand8(a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub8').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub8).toHaveBeenCalledWith(a, b);
            });
        });

        describe('cmp ew,dw', function() {
            it ('should execute the instruction with register source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
                this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
                let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
                offset = this.writeImm16(offset);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = this.checkInstruction.immediate;

                this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });

            it ('should execute the instruction with memory source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x81);
                this.checkInstruction.operandRegister = -1;
                let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
                offset = this.writeImm16(offset);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = this.checkInstruction.immediate;

                this.writeMemOperand16(a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });
        });

        describe('cmp ew,db', function() {
            it ('should execute the instruction with register source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
                this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
                let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
                offset = this.writeImm8(offset);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = this.checkInstruction.immediate;

                this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });

            it ('should execute the instruction with memory source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x83);
                this.checkInstruction.operandRegister = -1;
                let offset = this.writeModRM(this.cpu.ip + 1, 0x7);
                offset = this.writeImm8(offset);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = this.checkInstruction.immediate;

                this.writeMemOperand16(a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });
        });

        describe('cmp AL,db', function() {
            it ('should execute the instruction', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x3c);
                let offset = this.writeImm8(this.cpu.ip + 1);

                let a = Helper.randomInteger(0x00, 0xff);
                let b = this.checkInstruction.immediate;

                this.cpu.writeRegister8(CPU.REGISTER_AL, a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub8').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub8).toHaveBeenCalledWith(a, b);
            });
        });

        describe('cmp AX,db', function() {
            it ('should execute the instruction', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x3d);
                let offset = this.writeImm16(this.cpu.ip + 1);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = this.checkInstruction.immediate;

                this.cpu.writeRegister16(CPU.REGISTER_AX, a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });
        });

        describe('cmp eb,rb', function() {
            it ('should execute the instruction with register source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x38);
                this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
                let reg = Helper.randomInteger(0x0, 0x7);
                let offset = this.writeModRM(this.cpu.ip + 1, reg);

                let a = Helper.randomInteger(0x00, 0xff);
                let b = Helper.randomInteger(0x00, 0xff);

                this.cpu.writeRegister8(this.checkInstruction.operandRegister, a);
                this.cpu.writeRegister8(reg, b);
                a = this.cpu.readRegister8(this.checkInstruction.operandRegister);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub8').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub8).toHaveBeenCalledWith(a, b);
            });

            it ('should execute the instruction with memory source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x38);
                this.checkInstruction.operandRegister = -1;
                let reg = Helper.randomInteger(0x0, 0x7);

                let a = Helper.randomInteger(0x00, 0xff);
                let b = Helper.randomInteger(0x00, 0xff);

                this.cpu.writeRegister8(reg, b);

                let offset = this.writeModRM(this.cpu.ip + 1, reg);

                this.writeMemOperand8(a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub8').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub8).toHaveBeenCalledWith(a, b);
            });
        });

        describe('cmp ew,rw', function() {
            it ('should execute the instruction with register source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x39);
                this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
                let reg = Helper.randomInteger(0x0, 0x7);
                let offset = this.writeModRM(this.cpu.ip + 1, reg);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = Helper.randomInteger(0x0000, 0xffff);

                this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);
                this.cpu.writeRegister16(reg, b);
                a = this.cpu.readRegister16(this.checkInstruction.operandRegister);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });

            it ('should execute the instruction with memory source', function() {
                this.memory.write8(this.segment, this.cpu.ip + 0, 0x39);
                this.checkInstruction.operandRegister = -1;
                let reg = Helper.randomInteger(0x0, 0x7);

                let a = Helper.randomInteger(0x0000, 0xffff);
                let b = Helper.randomInteger(0x0000, 0xffff);

                this.cpu.writeRegister16(reg, b);

                let offset = this.writeModRM(this.cpu.ip + 1, reg);

                this.writeMemOperand16(a);

                // It should invoke the ALU 'sub' operation with the appropriate
                // arguments.
                let spy = spyOn(ALU.prototype, 'sub16').and.callThrough();

                this.instruction = this.cpu.decode(this.instruction);
                this.cpu.execute(this.instruction)

                expect(this.cpu.alu.sub16).toHaveBeenCalledWith(a, b);
            });
        });
    });
});
