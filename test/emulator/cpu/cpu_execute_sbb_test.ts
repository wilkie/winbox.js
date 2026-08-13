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

    describe('sbb eb,rb', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x18);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        const reg = Helper.randomInteger(0x0, 0x7);
        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        let a = Helper.randomInteger(0x00, 0xff);
        const b = Helper.randomInteger(0x00, 0xff);

        this.cpu.writeRegister8(this.checkInstruction.operandRegister, a);
        this.cpu.writeRegister8(reg, b);
        a = this.cpu.readRegister8(this.checkInstruction.operandRegister);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x18);
        this.checkInstruction.operandRegister = -1;
        const reg = Helper.randomInteger(0x0, 0x7);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = Helper.randomInteger(0x00, 0xff);

        this.cpu.writeRegister8(reg, b);

        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        this.writeMemOperand8(a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb rb,eb', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x1a);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        const reg = Helper.randomInteger(0x0, 0x7);
        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        const a = Helper.randomInteger(0x00, 0xff);
        let b = Helper.randomInteger(0x00, 0xff);

        this.cpu.writeRegister8(this.checkInstruction.operandRegister, b);
        this.cpu.writeRegister8(reg, a);
        b = this.cpu.readRegister8(this.checkInstruction.operandRegister);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x1a);
        this.checkInstruction.operandRegister = -1;
        const reg = Helper.randomInteger(0x0, 0x7);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = Helper.randomInteger(0x00, 0xff);

        this.cpu.writeRegister8(reg, a);

        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        this.writeMemOperand8(b);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb AL,db', function () {
      it('should execute the instruction', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x1c);
        const offset = this.writeImm8(this.cpu.ip + 1);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister8(CPU.REGISTER_AL, a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb AX,db', function () {
      it('should execute the instruction', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x1d);
        const offset = this.writeImm16(this.cpu.ip + 1);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister16(CPU.REGISTER_AX, a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb ew,dw', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x81);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
        offset = this.writeImm16(offset);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x81);
        this.checkInstruction.operandRegister = -1;
        let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
        offset = this.writeImm16(offset);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = this.checkInstruction.immediate;

        this.writeMemOperand16(a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb ew,db', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x83);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
        offset = this.writeImm8(offset);

        const a = Helper.randomInteger(0x0000, 0xffff);

        /* The byte immediate is sign-extended to the operand width before it
         * reaches the ALU, so that is what the call is expected to carry.
         */
        const b = (((this.checkInstruction.immediate << 24) >> 24) & 0xffff) >>> 0;

        this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x83);
        this.checkInstruction.operandRegister = -1;
        let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
        offset = this.writeImm8(offset);

        const a = Helper.randomInteger(0x0000, 0xffff);

        /* The byte immediate is sign-extended to the operand width before it
         * reaches the ALU, so that is what the call is expected to carry.
         */
        const b = (((this.checkInstruction.immediate << 24) >> 24) & 0xffff) >>> 0;

        this.writeMemOperand16(a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb eb,db', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x80);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
        offset = this.writeImm8(offset);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = this.checkInstruction.immediate;

        this.cpu.writeRegister8(this.checkInstruction.operandRegister, a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x80);
        this.checkInstruction.operandRegister = -1;
        let offset = this.writeModRM(this.cpu.ip + 1, 0x3);
        offset = this.writeImm8(offset);

        const a = Helper.randomInteger(0x00, 0xff);
        const b = this.checkInstruction.immediate;

        this.writeMemOperand8(a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb8');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb8).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb ew,rw', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x19);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        const reg = Helper.randomInteger(0x0, 0x7);
        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        let a = Helper.randomInteger(0x0000, 0xffff);
        const b = Helper.randomInteger(0x0000, 0xffff);

        this.cpu.writeRegister16(this.checkInstruction.operandRegister, a);
        this.cpu.writeRegister16(reg, b);
        a = this.cpu.readRegister16(this.checkInstruction.operandRegister);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x19);
        this.checkInstruction.operandRegister = -1;
        const reg = Helper.randomInteger(0x0, 0x7);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = Helper.randomInteger(0x0000, 0xffff);

        this.cpu.writeRegister16(reg, b);

        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        this.writeMemOperand16(a);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });
    });

    describe('sbb rw,ew', function () {
      it('should execute the instruction with register source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x1b);
        this.checkInstruction.operandRegister = Helper.randomInteger(0x0, 0x7);
        const reg = Helper.randomInteger(0x0, 0x7);
        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        const a = Helper.randomInteger(0x0000, 0xffff);
        let b = Helper.randomInteger(0x0000, 0xffff);

        this.cpu.writeRegister16(this.checkInstruction.operandRegister, b);
        this.cpu.writeRegister16(reg, a);
        b = this.cpu.readRegister16(this.checkInstruction.operandRegister);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });

      it('should execute the instruction with memory source', function () {
        this.cpu.write8(this.segment, this.cpu.ip + 0, 0x1b);
        this.checkInstruction.operandRegister = -1;
        const reg = Helper.randomInteger(0x0, 0x7);

        const a = Helper.randomInteger(0x0000, 0xffff);
        const b = Helper.randomInteger(0x0000, 0xffff);

        this.cpu.writeRegister16(reg, a);

        const offset = this.writeModRM(this.cpu.ip + 1, reg);

        this.writeMemOperand16(b);

        // It should invoke the ALU 'sbb' operation with the appropriate
        // arguments.
        const spy = jest.spyOn(ALU.prototype, 'sbb16');

        this.instruction = this.cpu.decode(this.instruction);
        this.cpu.execute(this.instruction);

        expect(this.cpu.alu.sbb16).toHaveBeenCalledWith(a, b);
      });
    });
  });
});
