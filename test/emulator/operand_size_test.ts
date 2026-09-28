'use strict';

import { Machine } from '../../src/emulator/machine.js';

/**
 * Immediates under the operand-size prefix.
 *
 * Found by Slam! of the corpus, whose 32-bit arithmetic looped for ever: a
 * byte immediate is sign-extended to the whole 32 bits, and TEST's immediate
 * is 32 bits wide rather than 16.
 */

const EDI = 7;

function run(bytes: number[], edi: number) {
  const machine = new Machine();
  const cpu = machine.cpu;
  const core = cpu.core;

  core.cs = 0x1000;
  core.ip = 0x0000;
  core.ss = 0x2000;
  core.sp = 0x1000;
  core.ds = 0x1000;

  bytes.forEach((byte, index) => core.write8(core.cs, index, byte));
  core.writeRegister32(EDI, edi);
  cpu.step();

  return core;
}

describe('32-bit operands', () => {
  it('sign-extends the byte of 83h to 32 bits', function () {
    // cmp edi, -1
    const core = run([0x66, 0x83, 0xff, 0xff], 0xffffffff);

    expect(core.flags.zero).toEqual(true);
    expect(core.ip).toEqual(4);
  });

  it('reads a 32-bit immediate for TEST', function () {
    // test edi, 0x80000000
    const core = run([0x66, 0xf7, 0xc7, 0x00, 0x00, 0x00, 0x80], 0x80000000);

    expect(core.flags.zero).toEqual(false);
    expect(core.ip).toEqual(7);
  });

  it('leaves the rest of F7h to the 16-bit decode', function () {
    // not edi
    const core = run([0x66, 0xf7, 0xd7], 0x0000ffff);

    expect(core.ip).toEqual(3);
  });
});
