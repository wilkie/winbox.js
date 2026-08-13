'use strict';

import { Helper } from '../../helper.js';

import { ALU } from '../../../src/emulator/alu.js';
import { CPU } from '../../../src/emulator/cpu.js';
import { Memory } from '../../../src/emulator/memory.js';

import { setup, setupExecute } from '../cpu_test.js';

describe('CPU', () => {
  beforeEach(function () {
    setup.bind(this)();
  });

  describe('#execute', () => {
    beforeEach(function () {
      setupExecute.bind(this)();
    });

    describe('test eb,db', function () {
      it('should execute the instruction with register source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
        offset = this.writeImm8(offset);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister8(this.checkInstruction.operandRegister, a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and8).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0xf6);
        this.checkInstruction.operandRegister = -1;
        let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
        offset = this.writeImm8(offset);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = this.checkInstruction.immediate;

        this.writeMemOperand8(a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('test ew,dw', function () {
      it('should execute the instruction with register source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
        offset = this.writeImm16(offset);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and16).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0xf7);
        this.checkInstruction.operandRegister = -1;
        let offset = this.writeModRM(this.cpu.ip + 1, 0x0);
        offset = this.writeImm16(offset);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = this.checkInstruction.immediate;

        this.writeMemOperand16(a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and16).toHaveBeenCalledWith(a, b);
      });
    });

    describe('test AL,db', function () {
      it('should execute the instruction', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0xa8);
        const offset = this.writeImm8(this.cpu.ip + 1);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister8(CPU.REGISTER_AL, a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('test AX,db', function () {
      it('should execute the instruction', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0xa9);
        const offset = this.writeImm16(this.cpu.ip + 1);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister16(CPU.REGISTER_AX, a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and16).toHaveBeenCalledWith(a, b);
      });
    });

    describe('test eb,rb', function () {
      it('should execute the instruction with register source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0x84);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        const reg = Helper.randomInteger(0x0, 0x7);
        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        let a = Helper.randomInteger(0x00, 0xff);
        const b = Helper.randomInteger(0x00, 0xff);

        this.cpu.writeRegister8(this.checkInstruction.operandRegister, a);
        this.cpu.writeRegister8(reg, b);
        a = this.cpu.readRegister8(this.checkInstruction.operandRegister);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and8).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0x84);
        this.checkInstruction.operandRegister = -1;
        const reg = Helper.randomInteger(0x0, 0x7);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = Helper.randomInteger(0x00, 0xff);

        this.cpu.writeRegister8(reg, b);

        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        this.writeMemOperand8(a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('test ew,rw', function () {
      it('should execute the instruction with register source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0x85);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        const reg = Helper.randomInteger(0x0, 0x7);
        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        let a = Helper.randomInteger(0x0000, 0xffff);
        const b = Helper.randomInteger(0x0000, 0xffff);

        this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);
        this.cpu.writeRegister16(reg, b);
        a = this.cpu.readRegister16(this.checkInstruction.operandRegister);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and16).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.memory.write8(this.segment, this.cpu.ip + 0, 0x85);
        this.checkInstruction.operandRegister = -1;
        const reg = Helper.randomInteger(0x0, 0x7);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = Helper.randomInteger(0x0000, 0xffff);

        this.cpu.writeRegister16(reg, b);

        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        this.writeMemOperand16(a);

        // It should invoke the ALU 'and' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'and16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.and16).toHaveBeenCalledWith(a, b);
      });
    });
  });
});
