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

function run(bytes: number[], edi: number, before: (core: any) => void = () => {}) {
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
  before(core);
  cpu.step();

  return core;
}

/** Runs one instruction and answers DI after. */
function core16(bytes: number[], di: number) {
  return run(bytes, di).readRegister16(EDI);
}

describe('the 386 extensions without the prefix', () => {
  it('zero-extends a byte into a word register', function () {
    // movzx di, byte [0x100], the byte F0h
    const core = run([0x0f, 0xb6, 0x3e, 0x00, 0x01], 0x12345678, (core) =>
      core.write8(core.ds, 0x100, 0xf0)
    );

    expect(core.readRegister32(EDI) >>> 0).toEqual(0x123400f0);
    expect(core.ip).toEqual(5);
  });

  it('exchanges EAX with a double-word register, and does nothing with itself', function () {
    // xchg eax, edi
    const core = run([0x66, 0x97], 0x12345678, (core) => core.writeRegister32(0, 0xcafef00d));

    expect(core.readRegister32(EDI) >>> 0).toEqual(0xcafef00d);
    expect(core.readRegister32(0) >>> 0).toEqual(0x12345678);
    expect(run([0x66, 0x90], 0).ip).toEqual(2);
  });

  it('moves a word into a word register, leaving the high word', function () {
    // movsx di, word [0x100], the word 8001h
    const core = run([0x0f, 0xbf, 0x3e, 0x00, 0x01], 0x12345678, (core) =>
      core.write16(core.ds, 0x100, 0x8001)
    );

    expect(core.readRegister32(EDI) >>> 0).toEqual(0x12348001);
  });
});

describe('the bit instructions', () => {
  it('tests a bit given in the instruction', function () {
    // bt word [0x100], 4
    const core = run([0x0f, 0xba, 0x26, 0x00, 0x01, 0x04], 0, (core) =>
      core.write16(core.ds, 0x100, 0x0010)
    );

    expect(core.flags.carry).toEqual(true);
    expect(core.ip).toEqual(6);
  });

  it('sets, clears and turns over a bit', function () {
    // bts di, 3 ; the bit number modulo sixteen
    expect(core16([0x0f, 0xba, 0xef, 0x13], 0x0000) & 0xffff).toEqual(0x0008);
    // btr di, 0
    expect(core16([0x0f, 0xba, 0xf7, 0x00], 0x00ff) & 0xffff).toEqual(0x00fe);
    // btc di, 15
    expect(core16([0x0f, 0xba, 0xff, 0x0f], 0x0000) & 0xffff).toEqual(0x8000);
  });

  it('reaches past a memory operand with a bit number in a register', function () {
    // bts word [0x100], di with di = 17: the word after, its bit 1
    const core = run([0x0f, 0xab, 0x3e, 0x00, 0x01], 17);

    expect(core.read16(core.ds, 0x102)).toEqual(0x0002);
    expect(core.read16(core.ds, 0x100)).toEqual(0);
  });

  it('finds the lowest and the highest bit set', function () {
    // bsf di, word [0x100] ; bsr
    const low = run([0x0f, 0xbc, 0x3e, 0x00, 0x01], 0, (core) =>
      core.write16(core.ds, 0x100, 0x0a0)
    );
    const high = run([0x0f, 0xbd, 0x3e, 0x00, 0x01], 0, (core) =>
      core.write16(core.ds, 0x100, 0x0a0)
    );
    const none = run([0x0f, 0xbc, 0x3e, 0x00, 0x01], 0x1234, (core) =>
      core.write16(core.ds, 0x100, 0)
    );

    expect(low.readRegister16(EDI)).toEqual(5);
    expect(high.readRegister16(EDI)).toEqual(7);
    expect(none.flags.zero).toEqual(true);
    expect(none.readRegister16(EDI)).toEqual(0x1234);
  });
});

describe('32-bit addressing', () => {
  it('reads a scaled index with no base and a 32-bit displacement', function () {
    // jmp [cs:ecx*2 + 0x10], ecx = 1: the word at 0x12
    const machine = new Machine();
    const core = machine.cpu.core;

    core.cs = 0x1000;
    core.ip = 0;
    core.ss = 0x2000;
    core.sp = 0x1000;
    core.ds = 0x1000;
    [0x67, 0x2e, 0xff, 0x24, 0x4d, 0x10, 0x00, 0x00, 0x00].forEach((byte, at) =>
      core.write8(core.cs, at, byte)
    );
    core.write16(core.cs, 0x12, 0x4321);
    core.writeRegister32(1, 1);
    machine.cpu.step();

    expect(core.ip.toString(16)).toEqual('4321');
  });

  it('addresses the stack segment by default through EBP', function () {
    // mov ax, [ebp+4]
    const machine = new Machine();
    const core = machine.cpu.core;

    core.cs = 0x1000;
    core.ip = 0;
    core.ss = 0x2000;
    core.sp = 0x1000;
    core.ds = 0x1000;
    [0x67, 0x8b, 0x45, 0x04].forEach((byte, at) => core.write8(core.cs, at, byte));
    core.write16(core.ss, 0x14, 0xbeef);
    core.write16(core.ds, 0x14, 0x1111);
    core.writeRegister32(5, 0x10);
    machine.cpu.step();

    expect(core.ax.toString(16)).toEqual('beef');
  });
});

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
