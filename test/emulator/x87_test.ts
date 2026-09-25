'use strict';

import { Machine } from '../../src/emulator/machine.js';
import { fromExtended, roundEven, toExtended } from '../../src/emulator/x87.js';

/**
 * The 387, instruction by instruction, as Intel describes it: each case
 * assembles real encodings, runs them on the 386 core and reads the result
 * back from memory or AX.
 */

const CODE = 0x1000;
const DATA = 0x100;

function machine() {
  const m = new Machine();
  const core: any = m.cpu.core;

  core.cs = CODE;
  core.ip = 0;
  core.ss = 0x2000;
  core.sp = 0x1000;
  core.ds = CODE;

  return { cpu: m.cpu, core };
}

/** Runs instructions, each given as its bytes. */
function run(instructions: number[][], data: [number, number[]][] = []) {
  const { cpu, core } = machine();
  let at = 0;

  for (const [offset, bytes] of data) {
    bytes.forEach((byte, index) => core.write8(CODE, DATA + offset + index, byte));
  }

  for (const bytes of instructions) {
    for (const byte of bytes) {
      core.write8(CODE, at++, byte);
    }
  }

  for (let step = 0; step < instructions.length; step++) {
    cpu.step();
  }

  const bytes = (offset: number, length: number) =>
    Array.from({ length }, (_, index) => core.read8(CODE, DATA + offset + index));

  return {
    core,
    bytes,
    f64: (offset: number) =>
      new DataView(new Uint8Array(bytes(offset, 8)).buffer).getFloat64(0, true),
    i16: (offset: number) =>
      new DataView(new Uint8Array(bytes(offset, 2)).buffer).getInt16(0, true),
  };
}

const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const le64f = (value: number) => {
  const view = new DataView(new ArrayBuffer(8));

  view.setFloat64(0, value, true);
  return Array.from(new Uint8Array(view.buffer));
};

/* Memory operands at DATA + n, addressed [disp16]. */
const mem = (reg: number, offset: number) => [(reg << 3) | 6, ...le16(DATA + offset)];

const FLD1 = [0xd9, 0xe8];
const FLDZ = [0xd9, 0xee];
const FLDPI = [0xd9, 0xeb];
const FNSTSW_AX = [0xdf, 0xe0];
const fstp64 = (offset: number) => [0xdd, ...mem(3, offset)];
const fld64 = (offset: number) => [0xdd, ...mem(0, offset)];
const fild16 = (offset: number) => [0xdf, ...mem(0, offset)];
const fistp16 = (offset: number) => [0xdf, ...mem(3, offset)];
const fldcw = (offset: number) => [0xd9, ...mem(5, offset)];

describe('the x87', () => {
  it('adds on the stack, addressing registers from its top', () => {
    const r = run([FLD1, FLDPI, [0xde, 0xc1], fstp64(0)]);

    expect(r.f64(0)).toBeCloseTo(1 + Math.PI, 15);
  });

  it('subtracts and divides, the popping forms with their senses', () => {
    // 10, 4: FSUBP ST(1),ST gives 10 - 4; 2 then FDIVP ST(1),ST gives 6 / 2.
    const r = run(
      [fild16(0), fild16(2), [0xde, 0xe9], fild16(4), [0xde, 0xf9], fstp64(8)],
      [
        [0, le16(10)],
        [2, le16(4)],
        [4, le16(2)],
      ]
    );

    expect(r.f64(8)).toBe(3);
  });

  it('reverses the subtraction for FSUBRP and FSUBR ST(i),ST', () => {
    // 10, 4: FSUBRP ST(1),ST is 4 - 10.
    const r = run(
      [fild16(0), fild16(2), [0xde, 0xe1], fstp64(8)],
      [
        [0, le16(10)],
        [2, le16(4)],
      ]
    );

    expect(r.f64(8)).toBe(-6);
  });

  it('compares into C3, C2 and C0, read with FNSTSW AX', () => {
    const below = run([FLD1, FLDZ, [0xd8, 0xd1], FNSTSW_AX]);
    const equal = run([FLD1, FLD1, [0xd8, 0xd1], FNSTSW_AX]);
    const above = run([FLDZ, FLD1, [0xd8, 0xd1], FNSTSW_AX]);

    expect(below.core.ax & 0x4500).toBe(0x0100);
    expect(equal.core.ax & 0x4500).toBe(0x4000);
    expect(above.core.ax & 0x4500).toBe(0x0000);
  });

  it('keeps TOP in the status word', () => {
    const r = run([FLD1, FLD1, FNSTSW_AX]);

    expect((r.core.ax >> 11) & 7).toBe(6);
  });

  it('starts with the control word 037Fh', () => {
    const r = run([[0xd9, ...mem(7, 0)]]);

    expect(r.bytes(0, 2)).toEqual([0x7f, 0x03]);
  });

  it('rounds an integer store as the control word says', () => {
    const store = (control: number, value: number) =>
      run(
        [fldcw(0), fld64(8), fistp16(16)],
        [
          [0, le16(control)],
          [8, le64f(value)],
        ]
      ).i16(16);

    expect(store(0x037f, 2.5)).toBe(2); // to nearest, a half to even
    expect(store(0x037f, 3.5)).toBe(4);
    expect(store(0x0f7f, 2.7)).toBe(2); // chop
    expect(store(0x0f7f, -2.7)).toBe(-2);
    expect(store(0x077f, -2.2)).toBe(-3); // down
  });

  it('stores the integer indefinite for what does not fit', () => {
    const r = run([fld64(8), fistp16(16)], [[8, le64f(70000)]]);

    expect(r.bytes(16, 2)).toEqual([0x00, 0x80]);
  });

  it('negates and takes the absolute value', () => {
    const r = run([fild16(0), [0xd9, 0xe1], [0xd9, 0xe0], fistp16(2)], [[0, le16(-5 & 0xffff)]]);

    expect(r.i16(2)).toBe(-5);
  });

  it('exchanges ST(0) with ST(i)', () => {
    const r = run([FLD1, FLDZ, [0xd9, 0xc9], fstp64(0)]);

    expect(r.f64(0)).toBe(1);
  });

  it('loads and stores the eighty-bit format exactly', () => {
    // 1.5: significand C000 0000 0000 0000, exponent 3FFFh.
    const onePointFive = [0, 0, 0, 0, 0, 0, 0, 0xc0, 0xff, 0x3f];
    const r = run(
      [[0xdb, ...mem(5, 0)], [0xd9, 0xc0], [0xdb, ...mem(7, 16)], fstp64(32)],
      [[0, onePointFive]]
    );

    expect(r.f64(32)).toBe(1.5);
    expect(r.bytes(16, 10)).toEqual(onePointFive);
  });

  it('stores and loads packed decimal', () => {
    const r = run(
      [fild16(0), [0xdf, ...mem(6, 16)], [0xdf, ...mem(4, 16)], fstp64(32)],
      [[0, le16(-1234 & 0xffff)]]
    );

    expect(r.bytes(16, 10)).toEqual([0x34, 0x12, 0, 0, 0, 0, 0, 0, 0, 0x80]);
    expect(r.f64(32)).toBe(-1234);
  });

  it('takes a partial remainder, the quotient in C0, C3 and C1', () => {
    // 17 by 5: 2, the quotient 3 -- C0 0, C3 1, C1 1.
    const r = run(
      [fild16(0), fild16(2), [0xd9, 0xf8], FNSTSW_AX, fstp64(8)],
      [
        [0, le16(5)],
        [2, le16(17)],
      ]
    );

    expect(r.f64(8)).toBe(2);
    expect(r.core.ax & 0x4700).toBe(0x4200);
  });

  it('examines: zero, a normal number, an empty register', () => {
    const zero = run([FLDZ, [0xd9, 0xe5], FNSTSW_AX]);
    const normal = run([FLD1, [0xd9, 0xe5], FNSTSW_AX]);
    const empty = run([[0xd9, 0xe5], FNSTSW_AX]);

    expect(zero.core.ax & 0x4500).toBe(0x4000);
    expect(normal.core.ax & 0x4500).toBe(0x0400);
    expect(empty.core.ax & 0x4500).toBe(0x4100);
  });

  it('saves and restores the whole unit', () => {
    const r = run([
      FLDPI,
      FLD1,
      [0xdd, ...mem(6, 0)],
      FNSTSW_AX,
      [0xdd, ...mem(4, 0)],
      [0xde, 0xc1],
      fstp64(120),
    ]);

    expect(r.core.ax & 0x3800).toBe(0); // FNSAVE leaves the unit as FNINIT does
    expect(r.f64(120)).toBeCloseTo(Math.PI + 1, 15);
  });
});

describe('the eighty-bit format', () => {
  it('round-trips doubles, denormals and the specials', () => {
    for (const value of [1, -2.5, Math.PI, 1e300, 5e-324, 0, -0, Infinity, -Infinity]) {
      const { mantissa, signExponent } = toExtended(value);

      expect(Object.is(fromExtended(mantissa, signExponent), value)).toBe(true);
    }

    const nan = toExtended(NaN);

    expect(Number.isNaN(fromExtended(nan.mantissa, nan.signExponent))).toBe(true);
  });

  it('rounds a half to the even integer', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(roundEven)).toEqual([0, 2, 2, -0, -2, 2, 3]);
  });
});
