"use strict";

import Helper from '../helper.js';

import { ALU } from '../../src/emulator/alu.js';

import { MockCPU } from './cpu_test.js';

describe('ALU', () => {
    beforeEach(function() {
        let cpu = MockCPU();
        this.alu = new ALU(cpu);
    });

    describe('.constructor', () => {
        it('should retain the given CPU', function() {
            let cpu = MockCPU();
            let alu = new ALU(cpu);
            expect(alu.cpu).toEqual(cpu);
        });
    });

    describe('#cpu', () => {
        it ('should return the original CPU', function() {
            let cpu = MockCPU();
            let alu = new ALU(cpu);
            expect(alu.cpu).toEqual(cpu);
        });
    });

    describe('#toSigned8', () => {
        it ('should not affect a positive value', function() {
            let value = Helper.randomInteger(0, 0x7f);
            expect(this.alu.toSigned8(value)).toEqual(value);
        });

        it ('should return a negative value if signed 2s complement', function() {
            let value = Helper.randomInteger(0x80, 0xff);
            expect(this.alu.toSigned8(value)).toBeLessThan(0);
        });
    });

    describe('#toSigned16', () => {
        it ('should not affect a positive value', function() {
            let value = Helper.randomInteger(0, 0x7fff);
            expect(this.alu.toSigned16(value)).toEqual(value);
        });

        it ('should return a negative value if signed 2s complement', function() {
            let value = Helper.randomInteger(0x8000, 0xffff);
            expect(this.alu.toSigned16(value)).toBeLessThan(0);
        });
    });

    describe('#cbw8', () => {
        it ('should not affect a positive 8-bit value', function() {
            let value = Helper.randomInteger(0, 0x7f);
            expect(this.alu.cbw8(value)).toEqual(value);
        });

        it ('should sign extend a negative 8-bit value to 16 bits', function() {
            let value = Helper.randomInteger(0x80, 0xff);
            expect(this.alu.cbw8(value)).toBeGreaterThan(0x7fff);
        });

        it ('should truncate value to an unsigned 16 bits', function() {
            let value = Helper.randomInteger(0x80, 0xff);
            expect(this.alu.cbw8(value)).toBeLessThan(0x10000);
        });

        it ('should not set CPU flags', function() {
            let flags = this.alu.cpu.f;
            this.alu.cbw8(Helper.randomInteger(0, 0xff));
            expect(this.alu.cpu.f).toEqual(flags);
        });
    });

    describe('#cwd16', () => {
        it ('should not affect a positive 16-bit value', function() {
            let value = Helper.randomInteger(0, 0x7fff);
            expect(this.alu.cwd16(value)).toEqual(value);
        });

        it ('should sign extend a negative 16-bit value to 32 bits', function() {
            let value = Helper.randomInteger(0x8000, 0xffff);
            expect(this.alu.cwd16(value)).toBeGreaterThan(0x7ffffff);
        });

        it ('should truncate value to an unsigned 32 bits', function() {
            let value = Helper.randomInteger(0x8000, 0xffff);
            expect(this.alu.cwd16(value)).toBeLessThan(0x100000000);
        });

        it ('should not set CPU flags', function() {
            let flags = this.alu.cpu.f;
            this.alu.cwd16(Helper.randomInteger(0, 0xffff));
            expect(this.alu.cpu.f).toEqual(flags);
        });
    });

    describe('#add8', () => {
        it ('should add two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3f);
            let b = Helper.randomInteger(0, 0x3f);
            expect(this.alu.add8(a, b)).toEqual(a + b);
        });

        it ('should add two negative numbers', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            expect(this.alu.add8(a, b)).toEqual((a + b) & 0xff);
        });

        it ('should detect positive overflow', function() {
            let a = Helper.randomInteger(0x40, 0x7f);
            let b = Helper.randomInteger(0x40, 0x7f);
            this.alu.add8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect negative overflow', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xc0);
            this.alu.add8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect carry', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0x80;
            let b = Helper.randomInteger(0x00, 0xff) | 0x80;
            this.alu.add8(a, b);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should detect auxiliary carry', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0xf;
            let b = Helper.randomInteger(0x00, 0xff) | 0xf;
            this.alu.add8(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toBeTrue();
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = (~a + 1) & 0xff;
            this.alu.add8(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x00, 0x20);
            let b = Helper.randomInteger(0x80, 0xd0);
            this.alu.add8(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            let result = this.alu.add8(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#add16', () => {
        it ('should add two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3fff);
            let b = Helper.randomInteger(0, 0x3fff);
            expect(this.alu.add16(a, b)).toEqual(a + b);
        });

        it ('should add two negative numbers', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            expect(this.alu.add16(a, b)).toEqual((a + b) & 0xffff);
        });

        it ('should detect positive overflow', function() {
            let a = Helper.randomInteger(0x4000, 0x7fff);
            let b = Helper.randomInteger(0x4000, 0x7fff);
            this.alu.add16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect negative overflow', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xc000);
            this.alu.add16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect carry', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            let b = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            this.alu.add16(a, b);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should detect auxiliary carry', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0xf;
            let b = Helper.randomInteger(0x0000, 0xffff) | 0xf;
            this.alu.add16(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toBeTrue();
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = (~a + 1) & 0xffff;
            this.alu.add16(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x0000, 0x2000);
            let b = Helper.randomInteger(0x8000, 0xd000);
            this.alu.add16(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            let result = this.alu.add16(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#adc8', () => {
        it ('should add two positive numbers without carry', function() {
            let a = Helper.randomInteger(0, 0x3f);
            let b = Helper.randomInteger(0, 0x3f);
            this.alu.cpu.flags.carry = false;
            expect(this.alu.adc8(a, b)).toEqual(a + b);
        });

        it ('should add two negative numbers without carry', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            this.alu.cpu.flags.carry = false;
            expect(this.alu.adc8(a, b)).toEqual((a + b) & 0xff);
        });

        it ('should add two positive numbers with carry', function() {
            let a = Helper.randomInteger(0, 0x3f);
            let b = Helper.randomInteger(0, 0x3f);
            this.alu.cpu.flags.carry = true;
            expect(this.alu.adc8(a, b)).toEqual(a + b + 1);
        });

        it ('should add two negative numbers with carry', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            this.alu.cpu.flags.carry = true;
            expect(this.alu.adc8(a, b)).toEqual((a + b + 1) & 0xff);
        });

        it ('should detect positive overflow', function() {
            let a = Helper.randomInteger(0x40, 0x7f);
            let b = Helper.randomInteger(0x40, 0x7f);
            this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect negative overflow', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect carry', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0x80;
            let b = Helper.randomInteger(0x00, 0xff) | 0x80;
            this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should detect auxiliary carry', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0xf;
            let b = Helper.randomInteger(0x00, 0xff) | 0xf;
            this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toBeTrue();
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = (~a + 1) & 0xff;
            this.alu.cpu.flags.carry = false;
            this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x00, 0x20);
            let b = Helper.randomInteger(0x80, 0xd0);
            this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            let result = this.alu.adc8(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#adc16', () => {
        it ('should add two positive numbers without carry', function() {
            let a = Helper.randomInteger(0, 0x3fff);
            let b = Helper.randomInteger(0, 0x3fff);
            this.alu.cpu.flags.carry = false;
            expect(this.alu.adc16(a, b)).toEqual(a + b);
        });

        it ('should add two negative numbers without carry', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            this.alu.cpu.flags.carry = false;
            expect(this.alu.adc16(a, b)).toEqual((a + b) & 0xffff);
        });

        it ('should add two positive numbers with carry', function() {
            let a = Helper.randomInteger(0, 0x3fff);
            let b = Helper.randomInteger(0, 0x3fff);
            this.alu.cpu.flags.carry = true;
            expect(this.alu.adc16(a, b)).toEqual(a + b + 1);
        });

        it ('should add two negative numbers with carry', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            this.alu.cpu.flags.carry = true;
            expect(this.alu.adc16(a, b)).toEqual((a + b + 1) & 0xffff);
        });

        it ('should detect positive overflow', function() {
            let a = Helper.randomInteger(0x4000, 0x7fff);
            let b = Helper.randomInteger(0x4000, 0x7fff);
            this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect negative overflow', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xc000);
            this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect carry', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            let b = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should detect auxiliary carry', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0xf;
            let b = Helper.randomInteger(0x0000, 0xffff) | 0xf;
            this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toBeTrue();
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = (~a + 1) & 0xffff;
            this.alu.cpu.flags.carry = false;
            this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x0000, 0x2000);
            let b = Helper.randomInteger(0x8000, 0xd000);
            this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            let result = this.alu.adc16(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#sub8', () => {
        it ('should subtract two positive numbers', function() {
            let a = Helper.randomInteger(0x3f, 0x6f);
            let b = Helper.randomInteger(0x00, 0x3f);
            expect(this.alu.sub8(a, b)).toEqual(a - b);
        });

        it ('should subtract two negative numbers', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            expect(this.alu.sub8(a, b)).toEqual((a - b) & 0xff);
        });

        it ('should detect positive overflow', function() {
            let a = Helper.randomInteger(0x40, 0x7f);
            let b = ~Helper.randomInteger(0x40, 0x7f) + 1;
            this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect negative overflow', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = ~Helper.randomInteger(0x80, 0xc0) + 1;
            this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect carry', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0x80;
            let b = ~(Helper.randomInteger(0x00, 0xff) | 0x80) + 1;
            this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should detect auxiliary carry', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0xf;
            let b = ~(Helper.randomInteger(0x00, 0xff) | 0xf) + 1;
            this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toBeTrue();
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = a;
            this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x00, 0x20);
            let b = ~Helper.randomInteger(0x80, 0xd0) + 1;
            this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            let result = this.alu.sub8(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#sub16', () => {
        it ('should subtract two positive numbers', function() {
            let a = Helper.randomInteger(0x3fff, 0x6fff);
            let b = Helper.randomInteger(0x0000, 0x3fff);
            expect(this.alu.sub16(a, b)).toEqual(a - b);
        });

        it ('should subtract two negative numbers', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            expect(this.alu.sub16(a, b)).toEqual((a - b) & 0xffff);
        });

        it ('should detect positive overflow', function() {
            let a = Helper.randomInteger(0x4000, 0x7fff);
            let b = ~Helper.randomInteger(0x4000, 0x7fff) + 1;
            this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect negative overflow', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = ~Helper.randomInteger(0x8000, 0xc000) + 1;
            this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeTrue();
        });

        it ('should detect carry', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            let b = ~(Helper.randomInteger(0x0000, 0xffff) | 0x8000) + 1;
            this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should detect auxiliary carry', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0xf;
            let b = ~(Helper.randomInteger(0x0000, 0xffff) | 0xf) + 1;
            this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toBeTrue();
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = a;
            this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x0000, 0x2000);
            let b = ~Helper.randomInteger(0x8000, 0xd000) + 1;
            this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            let result = this.alu.sub16(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#and8', () => {
        it ('should and two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3f);
            let b = Helper.randomInteger(0, 0x3f);
            expect(this.alu.and8(a, b)).toEqual(a & b);
        });

        it ('should and two negative numbers', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            expect(this.alu.and8(a, b)).toEqual(a & b);
        });

        it ('should clear overflow flag', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.and8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeFalse();
        });

        it ('should clear carry flag', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.and8(a, b);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should not set auxiliary carry', function() {
            let flag = this.alu.cpu.flags.auxiliaryCarry;
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.and8(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toEqual(flag);
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = ~a;
            this.alu.and8(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0x80;
            let b = Helper.randomInteger(0x00, 0xff) | 0x80;
            this.alu.and8(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            let result = this.alu.and8(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#and16', () => {
        it ('should and two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3fff);
            let b = Helper.randomInteger(0, 0x3fff);
            expect(this.alu.and16(a, b)).toEqual(a & b);
        });

        it ('should and two negative numbers', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            expect(this.alu.and16(a, b)).toEqual(a & b);
        });

        it ('should clear overflow flag', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.and16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeFalse();
        });

        it ('should clear carry flag', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.and16(a, b);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should not set auxiliary carry', function() {
            let flag = this.alu.cpu.flags.auxiliaryCarry;
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.and16(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toEqual(flag);
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = ~a;
            this.alu.and16(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            let b = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            this.alu.and16(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            let result = this.alu.and16(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#or8', () => {
        it ('should or two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3f);
            let b = Helper.randomInteger(0, 0x3f);
            expect(this.alu.or8(a, b)).toEqual(a | b);
        });

        it ('should or two negative numbers', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            expect(this.alu.or8(a, b)).toEqual(a | b);
        });

        it ('should clear overflow flag', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.or8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeFalse();
        });

        it ('should clear carry flag', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.or8(a, b);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should not set auxiliary carry', function() {
            let flag = this.alu.cpu.flags.auxiliaryCarry;
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.or8(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toEqual(flag);
        });

        it ('should detect zero', function() {
            let a = 0;
            let b = 0;
            this.alu.or8(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0x80;
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.or8(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            let result = this.alu.or8(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#or16', () => {
        it ('should or two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3fff);
            let b = Helper.randomInteger(0, 0x3fff);
            expect(this.alu.or16(a, b)).toEqual(a | b);
        });

        it ('should or two negative numbers', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            expect(this.alu.or16(a, b)).toEqual(a | b);
        });

        it ('should clear overflow flag', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.or16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeFalse();
        });

        it ('should clear carry flag', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.or16(a, b);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should not set auxiliary carry', function() {
            let flag = this.alu.cpu.flags.auxiliaryCarry;
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.or16(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toEqual(flag);
        });

        it ('should detect zero', function() {
            let a = 0;
            let b = 0;
            this.alu.or16(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.or16(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            let result = this.alu.or16(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#xor8', () => {
        it ('should xor two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3f);
            let b = Helper.randomInteger(0, 0x3f);
            expect(this.alu.xor8(a, b)).toEqual(a ^ b);
        });

        it ('should xor two negative numbers', function() {
            let a = Helper.randomInteger(0x80, 0xbf);
            let b = Helper.randomInteger(0x80, 0xbf);
            expect(this.alu.xor8(a, b)).toEqual(a ^ b);
        });

        it ('should clear overflow flag', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.xor8(a, b);
            expect(this.alu.cpu.flags.overflow).toBeFalse();
        });

        it ('should clear carry flag', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.xor8(a, b);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should not set auxiliary carry', function() {
            let flag = this.alu.cpu.flags.auxiliaryCarry;
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            this.alu.xor8(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toEqual(flag);
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = a;
            this.alu.xor8(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x00, 0xff) | 0x80;
            let b = Helper.randomInteger(0x00, 0xff) & ~0x80;
            this.alu.xor8(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            let b = Helper.randomInteger(0x00, 0xff);
            let result = this.alu.xor8(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#xor16', () => {
        it ('should xor two positive numbers', function() {
            let a = Helper.randomInteger(0, 0x3fff);
            let b = Helper.randomInteger(0, 0x3fff);
            expect(this.alu.xor16(a, b)).toEqual(a ^ b);
        });

        it ('should xor two negative numbers', function() {
            let a = Helper.randomInteger(0x8000, 0xbfff);
            let b = Helper.randomInteger(0x8000, 0xbfff);
            expect(this.alu.xor16(a, b)).toEqual(a ^ b);
        });

        it ('should clear overflow flag', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.xor16(a, b);
            expect(this.alu.cpu.flags.overflow).toBeFalse();
        });

        it ('should clear carry flag', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.xor16(a, b);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should not set auxiliary carry', function() {
            let flag = this.alu.cpu.flags.auxiliaryCarry;
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            this.alu.xor16(a, b);
            expect(this.alu.cpu.flags.auxiliaryCarry).toEqual(flag);
        });

        it ('should detect zero', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = a;
            this.alu.xor16(a, b);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });

        it ('should detect signed result', function() {
            let a = Helper.randomInteger(0x0000, 0xffff) | 0x8000;
            let b = Helper.randomInteger(0x0000, 0xffff) & ~0x8000;
            this.alu.xor16(a, b);
            expect(this.alu.cpu.flags.signed).toBeTrue();
        });

        it ('should detect 8-bit parity', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            let b = Helper.randomInteger(0x0000, 0xffff);
            let result = this.alu.xor16(a, b);
            expect(this.alu.cpu.flags.parity).toEqual(ALU.PARITY[result & 0xff]);
        });
    });

    describe('#neg8', () => {
        it ('should negate a positive number', function() {
            let a = Helper.randomInteger(0, 0x7f);
            expect(this.alu.neg8(a)).toEqual((~a + 1) & 0xff);
        });

        it ('should negate a negative number', function() {
            let a = Helper.randomInteger(0x80, 0xff);
            expect(this.alu.neg8(a)).toEqual((~a + 1) & 0xff);
        });

        it ('should set carry for any non-zero input', function() {
            let a = Helper.randomInteger(0x01, 0xff);
            this.alu.neg8(a);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should clear carry for a zero input', function() {
            this.alu.neg8(0);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should clear zero flag for any non-zero input', function() {
            let a = Helper.randomInteger(0x01, 0xff);
            this.alu.neg8(a);
            expect(this.alu.cpu.flags.zero).toBeFalse();
        });

        it ('should set zero flag for a zero input', function() {
            this.alu.neg8(0);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });
    });

    describe('#neg16', () => {
        it ('should negate a positive number', function() {
            let a = Helper.randomInteger(0, 0x7fff);
            expect(this.alu.neg16(a)).toEqual((~a + 1) & 0xffff);
        });

        it ('should negate a negative number', function() {
            let a = Helper.randomInteger(0x8000, 0xffff);
            expect(this.alu.neg16(a)).toEqual((~a + 1) & 0xffff);
        });

        it ('should set carry for any non-zero input', function() {
            let a = Helper.randomInteger(0x0001, 0xffff);
            this.alu.neg16(a);
            expect(this.alu.cpu.flags.carry).toBeTrue();
        });

        it ('should clear carry for a zero input', function() {
            this.alu.neg16(0);
            expect(this.alu.cpu.flags.carry).toBeFalse();
        });

        it ('should clear zero flag for any non-zero input', function() {
            let a = Helper.randomInteger(0x0001, 0xffff);
            this.alu.neg16(a);
            expect(this.alu.cpu.flags.zero).toBeFalse();
        });

        it ('should set zero flag for a zero input', function() {
            this.alu.neg16(0);
            expect(this.alu.cpu.flags.zero).toBeTrue();
        });
    });

    describe('#not8', () => {
        it ('should complement an 8-bit value', function() {
            let a = Helper.randomInteger(0x00, 0xff);
            expect(this.alu.not8(a)).toEqual(~a & 0xff);
        });

        it ('should not set CPU flags', function() {
            let flags = this.alu.cpu.f;
            this.alu.not8(Helper.randomInteger(0, 0xff));
            expect(this.alu.cpu.f).toEqual(flags);
        });
    });

    describe('#not16', () => {
        it ('should complement a 16-bit value', function() {
            let a = Helper.randomInteger(0x0000, 0xffff);
            expect(this.alu.not16(a)).toEqual(~a & 0xffff);
        });

        it ('should not set CPU flags', function() {
            let flags = this.alu.cpu.f;
            this.alu.not16(Helper.randomInteger(0, 0xffff));
            expect(this.alu.cpu.f).toEqual(flags);
        });
    });
});
