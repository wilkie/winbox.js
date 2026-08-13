'use strict';

import Helper from '../helper.js';

import { ALU } from '../../src/emulator/alu.js';

import { MockCPU } from './cpu_test.js';

describe('ALU', () => {
  beforeEach(function () {
    const cpu = MockCPU();
    this.alu = new ALU(cpu);
  });

  describe('.constructor', () => {
    it('should retain the given CPU', function () {
      const cpu = MockCPU();
      const alu = new ALU(cpu);
      expect(alu.cpu).toEqual(cpu);
    });
  });

  describe('#cpu', () => {
    it('should return the original CPU', function () {
      const cpu = MockCPU();
      const alu = new ALU(cpu);
      expect(alu.cpu).toEqual(cpu);
    });
  });

  describe('#toSigned8', () => {
    it('should not affect a positive value', function () {
      const value = Helper.randomInteger(0, 0x7f);
      expect(this.alu.toSigned8(value)).toEqual(value);
    });

    it('should return a negative value if signed 2s complement', function () {
      const value = Helper.randomInteger(0x80, 0xff);
      expect(this.alu.toSigned8(value)).toBeLessThan(0);
    });
  });

  describe('#toSigned16', () => {
    it('should not affect a positive value', function () {
      const value = Helper.randomInteger(0, 0x7fff);
      expect(this.alu.toSigned16(value)).toEqual(value);
    });

    it('should return a negative value if signed 2s complement', function () {
      const value = Helper.randomInteger(0x8000, 0xffff);
      expect(this.alu.toSigned16(value)).toBeLessThan(0);
    });
  });

  describe('#cbw8', () => {
    it('should not affect a positive 8-bit value', function () {
      const value = Helper.randomInteger(0, 0x7f);
      expect(this.alu.cbw8(value)).toEqual(value);
    });

    it('should sign extend a negative 8-bit value to 16 bits', function () {
      const value = Helper.randomInteger(0x80, 0xff);
      expect(this.alu.cbw8(value)).toBeGreaterThan(0x7fff);
    });

    it('should truncate value to an unsigned 16 bits', function () {
      const value = Helper.randomInteger(0x80, 0xff);
      expect(this.alu.cbw8(value)).toBeLessThan(0x10000);
    });

    it('should not set CPU flags', function () {
      const flags = this.alu.cpu.f;
      this.alu.cbw8(Helper.randomInteger(0, 0xff));
      expect(this.alu.cpu.f).toEqual(flags);
    });
  });

  describe('#cwd16', () => {
    it('should not affect a positive 16-bit value', function () {
      const value = Helper.randomInteger(0, 0x7fff);
      expect(this.alu.cwd16(value)).toEqual(value);
    });

    it('should sign extend a negative 16-bit value to 32 bits', function () {
      const value = Helper.randomInteger(0x8000, 0xffff);
      expect(this.alu.cwd16(value)).toBeGreaterThan(0x7ffffff);
    });

    it('should truncate value to an unsigned 32 bits', function () {
      const value = Helper.randomInteger(0x8000, 0xffff);
      expect(this.alu.cwd16(value)).toBeLessThan(0x100000000);
    });

    it('should not set CPU flags', function () {
      const flags = this.alu.cpu.f;
      this.alu.cwd16(Helper.randomInteger(0, 0xffff));
      expect(this.alu.cpu.f).toEqual(flags);
    });
  });

  describe('#add8', () => {
    it('should add two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3f);
      const b = Helper.randomInteger(0, 0x3f);
      expect(this.alu.add8(a, b)).toEqual(a + b);
    });

    it('should add two negative numbers', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      expect(this.alu.add8(a, b)).toEqual((a + b) & 0xff);
    });

    it('should detect positive overflow', function () {
      const a = Helper.randomInteger(0x40, 0x7f);
      const b = Helper.randomInteger(0x40, 0x7f);
      this.alu.add8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect negative overflow', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xc0);
      this.alu.add8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect carry', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0x80;
      const b = Helper.randomInteger(0x00, 0xff) | 0x80;
      this.alu.add8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should detect auxiliary carry', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0xf;
      const b = Helper.randomInteger(0x00, 0xff) | 0xf;
      this.alu.add8(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = (~a + 1) & 0xff;
      this.alu.add8(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x00, 0x20);
      const b = Helper.randomInteger(0x80, 0xd0);
      this.alu.add8(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.add8(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#add16', () => {
    it('should add two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3fff);
      const b = Helper.randomInteger(0, 0x3fff);
      expect(this.alu.add16(a, b)).toEqual(a + b);
    });

    it('should add two negative numbers', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      expect(this.alu.add16(a, b)).toEqual((a + b) & 0xffff);
    });

    it('should detect positive overflow', function () {
      const a = Helper.randomInteger(0x4000, 0x7fff);
      const b = Helper.randomInteger(0x4000, 0x7fff);
      this.alu.add16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect negative overflow', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xc000);
      this.alu.add16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect carry', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      const b = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      this.alu.add16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should detect auxiliary carry', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0xf;
      const b = Helper.randomInteger(0x0000, 0xffff) | 0xf;
      this.alu.add16(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = (~a + 1) & 0xffff;
      this.alu.add16(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x0000, 0x2000);
      const b = Helper.randomInteger(0x8000, 0xd000);
      this.alu.add16(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.add16(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#adc8', () => {
    it('should add two positive numbers without carry', function () {
      const a = Helper.randomInteger(0, 0x3f);
      const b = Helper.randomInteger(0, 0x3f);
      this.alu.cpu.flags.carry = false;
      expect(this.alu.adc8(a, b)).toEqual(a + b);
    });

    it('should add two negative numbers without carry', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      this.alu.cpu.flags.carry = false;
      expect(this.alu.adc8(a, b)).toEqual((a + b) & 0xff);
    });

    it('should add two positive numbers with carry', function () {
      const a = Helper.randomInteger(0, 0x3f);
      const b = Helper.randomInteger(0, 0x3f);
      this.alu.cpu.flags.carry = true;
      expect(this.alu.adc8(a, b)).toEqual(a + b + 1);
    });

    it('should add two negative numbers with carry', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      this.alu.cpu.flags.carry = true;
      expect(this.alu.adc8(a, b)).toEqual((a + b + 1) & 0xff);
    });

    it('should detect positive overflow', function () {
      const a = Helper.randomInteger(0x40, 0x7f);
      const b = Helper.randomInteger(0x40, 0x7f);
      this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect negative overflow', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect carry', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0x80;
      const b = Helper.randomInteger(0x00, 0xff) | 0x80;
      this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should detect auxiliary carry', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0xf;
      const b = Helper.randomInteger(0x00, 0xff) | 0xf;
      this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = (~a + 1) & 0xff;
      this.alu.cpu.flags.carry = false;
      this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x00, 0x20);
      const b = Helper.randomInteger(0x80, 0xd0);
      this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.adc8(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#adc16', () => {
    it('should add two positive numbers without carry', function () {
      const a = Helper.randomInteger(0, 0x3fff);
      const b = Helper.randomInteger(0, 0x3fff);
      this.alu.cpu.flags.carry = false;
      expect(this.alu.adc16(a, b)).toEqual(a + b);
    });

    it('should add two negative numbers without carry', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      this.alu.cpu.flags.carry = false;
      expect(this.alu.adc16(a, b)).toEqual((a + b) & 0xffff);
    });

    it('should add two positive numbers with carry', function () {
      const a = Helper.randomInteger(0, 0x3fff);
      const b = Helper.randomInteger(0, 0x3fff);
      this.alu.cpu.flags.carry = true;
      expect(this.alu.adc16(a, b)).toEqual(a + b + 1);
    });

    it('should add two negative numbers with carry', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      this.alu.cpu.flags.carry = true;
      expect(this.alu.adc16(a, b)).toEqual((a + b + 1) & 0xffff);
    });

    it('should detect positive overflow', function () {
      const a = Helper.randomInteger(0x4000, 0x7fff);
      const b = Helper.randomInteger(0x4000, 0x7fff);
      this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect negative overflow', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xc000);
      this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect carry', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      const b = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should detect auxiliary carry', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0xf;
      const b = Helper.randomInteger(0x0000, 0xffff) | 0xf;
      this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = (~a + 1) & 0xffff;
      this.alu.cpu.flags.carry = false;
      this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x0000, 0x2000);
      const b = Helper.randomInteger(0x8000, 0xd000);
      this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.adc16(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#sub8', () => {
    it('should subtract two positive numbers', function () {
      const a = Helper.randomInteger(0x3f, 0x6f);
      const b = Helper.randomInteger(0x00, 0x3f);
      expect(this.alu.sub8(a, b)).toEqual(a - b);
    });

    it('should subtract two negative numbers', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      expect(this.alu.sub8(a, b)).toEqual((a - b) & 0xff);
    });

    it('should detect positive overflow', function () {
      const a = Helper.randomInteger(0x40, 0x7f);
      const b = ~Helper.randomInteger(0x40, 0x7f) + 1;
      this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect negative overflow', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = ~Helper.randomInteger(0x80, 0xc0) + 1;
      this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect carry', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0x80;
      const b = ~(Helper.randomInteger(0x00, 0xff) | 0x80) + 1;
      this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should detect auxiliary carry', function () {
      // Borrowing out of bit 3 needs the minuend's low nibble to be smaller.
      const a = Helper.randomInteger(0x00, 0xff) & ~0xf;
      const b = Helper.randomInteger(0x01, 0x0f);
      this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = a;
      this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x00, 0x20);
      const b = ~Helper.randomInteger(0x80, 0xd0) + 1;
      this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.sub8(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#sub16', () => {
    it('should subtract two positive numbers', function () {
      const a = Helper.randomInteger(0x3fff, 0x6fff);
      const b = Helper.randomInteger(0x0000, 0x3fff);
      expect(this.alu.sub16(a, b)).toEqual(a - b);
    });

    it('should subtract two negative numbers', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      expect(this.alu.sub16(a, b)).toEqual((a - b) & 0xffff);
    });

    it('should detect positive overflow', function () {
      const a = Helper.randomInteger(0x4000, 0x7fff);
      const b = ~Helper.randomInteger(0x4000, 0x7fff) + 1;
      this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect negative overflow', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = ~Helper.randomInteger(0x8000, 0xc000) + 1;
      this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should detect carry', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      const b = ~(Helper.randomInteger(0x0000, 0xffff) | 0x8000) + 1;
      this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should detect auxiliary carry', function () {
      // Borrowing out of bit 3 needs the minuend's low nibble to be smaller.
      const a = Helper.randomInteger(0x0000, 0xffff) & ~0xf;
      const b = Helper.randomInteger(0x01, 0x0f);
      this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = a;
      this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x0000, 0x2000);
      const b = ~Helper.randomInteger(0x8000, 0xd000) + 1;
      this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.sub16(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#and8', () => {
    it('should and two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3f);
      const b = Helper.randomInteger(0, 0x3f);
      expect(this.alu.and8(a, b)).toEqual(a & b);
    });

    it('should and two negative numbers', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      expect(this.alu.and8(a, b)).toEqual(a & b);
    });

    it('should clear overflow flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.and8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(false);
    });

    it('should clear carry flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.and8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear auxiliary carry', function () {
      /* Undefined per the manual, and cleared by the part: confirmed against
       * every AND, OR, XOR and TEST vector in the 80286 suite.
       */
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.and8(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(false);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = ~a;
      this.alu.and8(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0x80;
      const b = Helper.randomInteger(0x00, 0xff) | 0x80;
      this.alu.and8(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.and8(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#and16', () => {
    it('should and two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3fff);
      const b = Helper.randomInteger(0, 0x3fff);
      expect(this.alu.and16(a, b)).toEqual(a & b);
    });

    it('should and two negative numbers', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      expect(this.alu.and16(a, b)).toEqual(a & b);
    });

    it('should clear overflow flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.and16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(false);
    });

    it('should clear carry flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.and16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear auxiliary carry', function () {
      /* Undefined per the manual, and cleared by the part: confirmed against
       * every AND, OR, XOR and TEST vector in the 80286 suite.
       */
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.and16(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(false);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = ~a;
      this.alu.and16(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      const b = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      this.alu.and16(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.and16(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#or8', () => {
    it('should or two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3f);
      const b = Helper.randomInteger(0, 0x3f);
      expect(this.alu.or8(a, b)).toEqual(a | b);
    });

    it('should or two negative numbers', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      expect(this.alu.or8(a, b)).toEqual(a | b);
    });

    it('should clear overflow flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.or8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(false);
    });

    it('should clear carry flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.or8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear auxiliary carry', function () {
      /* Undefined per the manual, and cleared by the part: confirmed against
       * every AND, OR, XOR and TEST vector in the 80286 suite.
       */
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.or8(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(false);
    });

    it('should detect zero', function () {
      const a = 0;
      const b = 0;
      this.alu.or8(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0x80;
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.or8(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.or8(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#or16', () => {
    it('should or two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3fff);
      const b = Helper.randomInteger(0, 0x3fff);
      expect(this.alu.or16(a, b)).toEqual(a | b);
    });

    it('should or two negative numbers', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      expect(this.alu.or16(a, b)).toEqual(a | b);
    });

    it('should clear overflow flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.or16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(false);
    });

    it('should clear carry flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.or16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear auxiliary carry', function () {
      /* Undefined per the manual, and cleared by the part: confirmed against
       * every AND, OR, XOR and TEST vector in the 80286 suite.
       */
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.or16(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(false);
    });

    it('should detect zero', function () {
      const a = 0;
      const b = 0;
      this.alu.or16(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.or16(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.or16(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#xor8', () => {
    it('should xor two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3f);
      const b = Helper.randomInteger(0, 0x3f);
      expect(this.alu.xor8(a, b)).toEqual(a ^ b);
    });

    it('should xor two negative numbers', function () {
      const a = Helper.randomInteger(0x80, 0xbf);
      const b = Helper.randomInteger(0x80, 0xbf);
      expect(this.alu.xor8(a, b)).toEqual(a ^ b);
    });

    it('should clear overflow flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.xor8(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(false);
    });

    it('should clear carry flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.xor8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear auxiliary carry', function () {
      /* Undefined per the manual, and cleared by the part: confirmed against
       * every AND, OR, XOR and TEST vector in the 80286 suite.
       */
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.xor8(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(false);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = a;
      this.alu.xor8(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0x80;
      const b = Helper.randomInteger(0x00, 0xff) & ~0x80;
      this.alu.xor8(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.xor8(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#xor16', () => {
    it('should xor two positive numbers', function () {
      const a = Helper.randomInteger(0, 0x3fff);
      const b = Helper.randomInteger(0, 0x3fff);
      expect(this.alu.xor16(a, b)).toEqual(a ^ b);
    });

    it('should xor two negative numbers', function () {
      const a = Helper.randomInteger(0x8000, 0xbfff);
      const b = Helper.randomInteger(0x8000, 0xbfff);
      expect(this.alu.xor16(a, b)).toEqual(a ^ b);
    });

    it('should clear overflow flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.xor16(a, b);
      expect(this.alu.cpu.flags.overflow).toBe(false);
    });

    it('should clear carry flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.xor16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear auxiliary carry', function () {
      /* Undefined per the manual, and cleared by the part: confirmed against
       * every AND, OR, XOR and TEST vector in the 80286 suite.
       */
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.xor16(a, b);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(false);
    });

    it('should detect zero', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = a;
      this.alu.xor16(a, b);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
      const b = Helper.randomInteger(0x0000, 0xffff) & ~0x8000;
      this.alu.xor16(a, b);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.xor16(a, b);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#neg8', () => {
    it('should negate a positive number', function () {
      const a = Helper.randomInteger(0, 0x7f);
      expect(this.alu.neg8(a)).toEqual((~a + 1) & 0xff);
    });

    it('should negate a negative number', function () {
      const a = Helper.randomInteger(0x80, 0xff);
      expect(this.alu.neg8(a)).toEqual((~a + 1) & 0xff);
    });

    it('should set carry for any non-zero input', function () {
      const a = Helper.randomInteger(0x01, 0xff);
      this.alu.neg8(a);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should clear carry for a zero input', function () {
      this.alu.neg8(0);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear zero flag for any non-zero input', function () {
      const a = Helper.randomInteger(0x01, 0xff);
      this.alu.neg8(a);
      expect(this.alu.cpu.flags.zero).toBe(false);
    });

    it('should set zero flag for a zero input', function () {
      this.alu.neg8(0);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });
  });

  describe('#neg16', () => {
    it('should negate a positive number', function () {
      const a = Helper.randomInteger(0, 0x7fff);
      expect(this.alu.neg16(a)).toEqual((~a + 1) & 0xffff);
    });

    it('should negate a negative number', function () {
      const a = Helper.randomInteger(0x8000, 0xffff);
      expect(this.alu.neg16(a)).toEqual((~a + 1) & 0xffff);
    });

    it('should set carry for any non-zero input', function () {
      const a = Helper.randomInteger(0x0001, 0xffff);
      this.alu.neg16(a);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should clear carry for a zero input', function () {
      this.alu.neg16(0);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should clear zero flag for any non-zero input', function () {
      const a = Helper.randomInteger(0x0001, 0xffff);
      this.alu.neg16(a);
      expect(this.alu.cpu.flags.zero).toBe(false);
    });

    it('should set zero flag for a zero input', function () {
      this.alu.neg16(0);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });
  });

  describe('#not8', () => {
    it('should complement an 8-bit value', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      expect(this.alu.not8(a)).toEqual(~a & 0xff);
    });

    it('should not set CPU flags', function () {
      const flags = this.alu.cpu.f;
      this.alu.not8(Helper.randomInteger(0, 0xff));
      expect(this.alu.cpu.f).toEqual(flags);
    });
  });

  describe('#not16', () => {
    it('should complement a 16-bit value', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      expect(this.alu.not16(a)).toEqual(~a & 0xffff);
    });

    it('should not set CPU flags', function () {
      const flags = this.alu.cpu.f;
      this.alu.not16(Helper.randomInteger(0, 0xffff));
      expect(this.alu.cpu.f).toEqual(flags);
    });
  });

  describe('#mul8', () => {
    it('should multiply two positive numbers', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x00, 0x7f);
      expect(this.alu.mul8(a, b)).toEqual(a * b);
    });

    it('should multiply two negative numbers as unsigned', function () {
      const a = Helper.randomInteger(0x80, 0xff);
      const b = Helper.randomInteger(0x80, 0xff);
      expect(this.alu.mul8(a, b)).toEqual(a * b);
    });

    it('should detect carry when product requires 9 bits', function () {
      const a = Helper.randomInteger(0x80, 0xff);
      const b = Helper.randomInteger(0x80, 0xff);
      this.alu.mul8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should clear carry when product requires only 8 bits', function () {
      const a = Helper.randomInteger(0x00, 0x20);
      const b = Helper.randomInteger(0x00, 0x03);
      this.alu.mul8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should set overflow to the carry flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.mul8(a, b);
      expect(this.alu.cpu.flags.carry).toEqual(this.alu.cpu.flags.overflow);
    });
  });

  describe('#mul16', () => {
    it('should multiply two positive numbers', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x0000, 0x7fff);
      expect(this.alu.mul16(a, b)).toEqual(a * b);
    });

    it('should multiply two negative numbers as unsigned', function () {
      const a = Helper.randomInteger(0x8000, 0xffff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      expect(this.alu.mul16(a, b)).toEqual((a * b) >>> 0);
    });

    it('should detect carry when product requires 17 bits', function () {
      const a = Helper.randomInteger(0x8000, 0xffff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      this.alu.mul16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should clear carry when product requires only 16 bits', function () {
      const a = Helper.randomInteger(0x0000, 0x2000);
      const b = Helper.randomInteger(0x0000, 0x0003);
      this.alu.mul16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should set overflow to the carry flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.mul16(a, b);
      expect(this.alu.cpu.flags.carry).toEqual(this.alu.cpu.flags.overflow);
    });
  });

  describe('#imul8', () => {
    it('should multiply two positive numbers', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x00, 0x7f);
      const result = this.alu.toSigned8(a) * this.alu.toSigned8(b);
      expect(this.alu.imul8(a, b)).toEqual((result >>> 0) & 0xffff);
    });

    it('should multiply two negative numbers', function () {
      const a = Helper.randomInteger(0x80, 0xff);
      const b = Helper.randomInteger(0x80, 0xff);
      const result = this.alu.toSigned8(a) * this.alu.toSigned8(b);
      expect(this.alu.imul8(a, b)).toEqual((result >>> 0) & 0xffff);
    });

    it('should multiply one negative with one positive number', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x80, 0xff);
      const result = this.alu.toSigned8(a) * this.alu.toSigned8(b);
      expect(this.alu.imul8(a, b)).toEqual((result >>> 0) & 0xffff);
    });

    it('should detect carry when product requires 9 bits', function () {
      const a = Helper.randomInteger(0x4f, 0x7f);
      const b = Helper.randomInteger(0x4f, 0x7f);
      this.alu.imul8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should clear carry when product requires only 8 bits', function () {
      const a = Helper.randomInteger(0x00, 0x20);
      const b = Helper.randomInteger(0x00, 0x03);
      this.alu.imul8(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should set overflow to the carry flag', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x00, 0xff);
      this.alu.imul8(a, b);
      expect(this.alu.cpu.flags.carry).toEqual(this.alu.cpu.flags.overflow);
    });
  });

  describe('#imul16', () => {
    it('should multiply two positive numbers', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x0000, 0x7fff);
      const result = this.alu.toSigned16(a) * this.alu.toSigned16(b);
      expect(this.alu.imul16(a, b)).toEqual(result >>> 0);
    });

    it('should multiply two negative numbers as unsigned', function () {
      const a = Helper.randomInteger(0x8000, 0xffff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      const result = this.alu.toSigned16(a) * this.alu.toSigned16(b);
      expect(this.alu.imul16(a, b)).toEqual(result >>> 0);
    });

    it('should multiply one negative with one positive number', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      const result = this.alu.toSigned16(a) * this.alu.toSigned16(b);
      expect(this.alu.imul16(a, b)).toEqual(result >>> 0);
    });

    it('should detect carry when product requires 17 bits', function () {
      const a = Helper.randomInteger(0x8000, 0xffff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      this.alu.imul16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(true);
    });

    it('should clear carry when product requires only 16 bits', function () {
      const a = Helper.randomInteger(0x0000, 0x2000);
      const b = Helper.randomInteger(0x0000, 0x0003);
      this.alu.imul16(a, b);
      expect(this.alu.cpu.flags.carry).toBe(false);
    });

    it('should set overflow to the carry flag', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const b = Helper.randomInteger(0x0000, 0xffff);
      this.alu.imul16(a, b);
      expect(this.alu.cpu.flags.carry).toEqual(this.alu.cpu.flags.overflow);
    });
  });

  describe('#div8', () => {
    it('should divide two positive numbers', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x00, 0x7f);
      const result = (a / b) | ((a % b) << 8);
      expect(this.alu.div8(a, b)).toEqual(result);
    });

    it('should divide two negative numbers as unsigned', function () {
      const a = Helper.randomInteger(0x80, 0xff);
      const b = Helper.randomInteger(0x80, 0xff);
      const result = (a / b) | ((a % b) << 8);
      expect(this.alu.div8(a, b)).toEqual(result);
    });

    it('should divide one negative and one positive number', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x80, 0xff);
      const result = (a / b) | ((a % b) << 8);
      expect(this.alu.div8(a, b)).toEqual(result);
    });
  });

  describe('#div16', () => {
    it('should divide two positive numbers', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x0000, 0x7fff);
      const result = (a / b) | ((a % b) << 16);
      expect(this.alu.div16(a, b)).toEqual(result);
    });

    it('should divide two negative numbers as unsigned', function () {
      const a = Helper.randomInteger(0x8000, 0xffff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      // The packed quotient and remainder come back unsigned.
      const result = ((a / b) | ((a % b) << 16)) >>> 0;
      expect(this.alu.div16(a, b)).toEqual(result);
    });

    it('should divide one negative and one positive number', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      const result = (a / b) | ((a % b) << 16);
      expect(this.alu.div16(a, b)).toEqual(result);
    });
  });

  describe('#idiv8', () => {
    it('should divide two positive numbers', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x00, 0x7f);
      const result = (a / b) | ((a % b) << 8);
      expect(this.alu.idiv8(a, b)).toEqual(result);
    });

    it('should divide two negative numbers', function () {
      /* The dividend is the whole of AX, so a negative dividend means a
       * negative 16-bit value, small enough that the quotient still fits a
       * byte. A quotient that does not fit faults rather than wrapping.
       */
      const a = 0xff00 + Helper.randomInteger(0x00, 0xff);
      const b = Helper.randomInteger(0x80, 0xff);
      const dividend = this.alu.toSigned16(a);
      const divisor = this.alu.toSigned8(b);
      const result = ((dividend / divisor) & 0xff) | (((dividend % divisor) & 0xff) << 8);
      expect(this.alu.idiv8(a, b)).toEqual(result >>> 0);
    });

    it('should divide one negative and one positive number', function () {
      const a = Helper.randomInteger(0x00, 0x7f);
      const b = Helper.randomInteger(0x80, 0xff);
      let result = this.alu.toSigned8(a) / this.alu.toSigned8(b);
      result = (result & 0xff) | (((this.alu.toSigned8(a) % this.alu.toSigned8(b)) & 0xff) << 8);
      expect(this.alu.idiv8(a, b)).toEqual(result);
    });
  });

  describe('#idiv16', () => {
    it('should divide two positive numbers', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x0000, 0x7fff);
      let result = (this.alu.toSigned16(a) / this.alu.toSigned16(b)) & 0xffff;
      result |= ((this.alu.toSigned16(a) % this.alu.toSigned16(b)) & 0xffff) << 16;
      expect(this.alu.idiv16(a, b)).toEqual(result >>> 0);
    });

    it('should divide two negative numbers', function () {
      // As in idiv8: the dividend is DX:AX and the quotient has to fit a word.
      const a = (0xffff0000 + Helper.randomInteger(0x0000, 0xffff)) >>> 0;
      const b = Helper.randomInteger(0x8000, 0xffff);
      const dividend = this.alu.toSigned32(a);
      const divisor = this.alu.toSigned16(b);
      let result = (dividend / divisor) & 0xffff;
      result |= ((dividend % divisor) & 0xffff) << 16;
      expect(this.alu.idiv16(a, b)).toEqual(result >>> 0);
    });

    it('should divide one negative and one positive number', function () {
      const a = Helper.randomInteger(0x0000, 0x7fff);
      const b = Helper.randomInteger(0x8000, 0xffff);
      let result = (this.alu.toSigned16(a) / this.alu.toSigned16(b)) & 0xffff;
      result |= ((this.alu.toSigned16(a) % this.alu.toSigned16(b)) & 0xffff) << 16;
      expect(this.alu.idiv16(a, b)).toEqual(result >>> 0);
    });
  });

  describe('#dec8', () => {
    it('should decrement a positive number', function () {
      const a = Helper.randomInteger(0x01, 0x7f);
      expect(this.alu.dec8(a)).toEqual(a - 1);
    });

    it('should decrement a negative number', function () {
      const a = Helper.randomInteger(0x81, 0xff);
      expect(this.alu.dec8(a)).toEqual(a - 1);
    });

    it('should detect overflow', function () {
      const a = 0x80;
      this.alu.dec8(a);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should not affect carry', function () {
      const flag = !!Helper.randomInteger(0, 1);
      this.alu.cpu.flags.carry = flag;
      const a = Helper.randomInteger(0x00, 0xff);
      this.alu.dec8(a);
      expect(this.alu.cpu.flags.carry).toEqual(flag);
    });

    it('should detect auxiliary carry', function () {
      // Decrementing borrows out of bit 3 only when the low nibble is zero.
      const a = Helper.randomInteger(0x00, 0xff) & ~0xf;
      this.alu.dec8(a);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = 0x01;
      this.alu.dec8(a);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x81, 0xff);
      this.alu.dec8(a);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.dec8(a);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#dec16', () => {
    it('should decrement a positive number', function () {
      const a = Helper.randomInteger(0x0001, 0x7fff);
      expect(this.alu.dec16(a)).toEqual(a - 1);
    });

    it('should decrement a negative number', function () {
      const a = Helper.randomInteger(0x8001, 0xffff);
      expect(this.alu.dec16(a)).toEqual(a - 1);
    });

    it('should detect overflow', function () {
      const a = 0x8000;
      this.alu.dec16(a);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should not affect carry', function () {
      const flag = !!Helper.randomInteger(0, 1);
      this.alu.cpu.flags.carry = flag;
      const a = Helper.randomInteger(0x0000, 0xffff);
      this.alu.dec16(a);
      expect(this.alu.cpu.flags.carry).toEqual(flag);
    });

    it('should detect auxiliary carry', function () {
      // Decrementing borrows out of bit 3 only when the low nibble is zero.
      const a = Helper.randomInteger(0x0000, 0xffff) & ~0xf;
      this.alu.dec16(a);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = 0x0001;
      this.alu.dec16(a);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x8001, 0xffff);
      this.alu.dec16(a);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.dec16(a);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#inc8', () => {
    it('should increment a positive number', function () {
      const a = Helper.randomInteger(0x00, 0x7e);
      expect(this.alu.inc8(a)).toEqual(a + 1);
    });

    it('should increment a negative number', function () {
      const a = Helper.randomInteger(0x80, 0xfe);
      expect(this.alu.inc8(a)).toEqual(a + 1);
    });

    it('should detect overflow', function () {
      const a = 0x7f;
      this.alu.inc8(a);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should not affect carry', function () {
      const flag = !!Helper.randomInteger(0, 1);
      this.alu.cpu.flags.carry = flag;
      const a = Helper.randomInteger(0x00, 0xff);
      this.alu.inc8(a);
      expect(this.alu.cpu.flags.carry).toEqual(flag);
    });

    it('should detect auxiliary carry', function () {
      const a = Helper.randomInteger(0x00, 0xff) | 0xf;
      this.alu.inc8(a);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = 0xff;
      this.alu.inc8(a);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x80, 0xfe);
      this.alu.inc8(a);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x00, 0xff);
      const result = this.alu.inc8(a);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });

  describe('#inc16', () => {
    it('should increment a positive number', function () {
      const a = Helper.randomInteger(0x0000, 0x7ffe);
      expect(this.alu.inc16(a)).toEqual(a + 1);
    });

    it('should increment a negative number', function () {
      const a = Helper.randomInteger(0x8000, 0xfffe);
      expect(this.alu.inc16(a)).toEqual(a + 1);
    });

    it('should detect overflow', function () {
      const a = 0x7fff;
      this.alu.inc16(a);
      expect(this.alu.cpu.flags.overflow).toBe(true);
    });

    it('should not affect carry', function () {
      const flag = !!Helper.randomInteger(0, 1);
      this.alu.cpu.flags.carry = flag;
      const a = Helper.randomInteger(0x0000, 0xffff);
      this.alu.inc16(a);
      expect(this.alu.cpu.flags.carry).toEqual(flag);
    });

    it('should detect auxiliary carry', function () {
      const a = Helper.randomInteger(0x0000, 0xffff) | 0xf;
      this.alu.inc16(a);
      expect(this.alu.cpu.flags.auxiliaryCarry).toBe(true);
    });

    it('should detect zero', function () {
      const a = 0xffff;
      this.alu.inc16(a);
      expect(this.alu.cpu.flags.zero).toBe(true);
    });

    it('should detect signed result', function () {
      const a = Helper.randomInteger(0x8000, 0xfffe);
      this.alu.inc16(a);
      expect(this.alu.cpu.flags.signed).toBe(true);
    });

    it('should detect 8-bit parity', function () {
      const a = Helper.randomInteger(0x0000, 0xffff);
      const result = this.alu.inc16(a);
      expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
    });
  });
});
