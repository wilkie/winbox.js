'use strict';

import { Memory } from '../../src/emulator/memory.js';

/** A segment whose byte at each offset is the offset's low byte, and which keeps what is written. */
function handler() {
  const written = new Map<number, number>();

  return {
    written,
    read8: (offset: number) => written.get(offset) ?? offset & 0xff,
    write8: (offset: number, value: number) => void written.set(offset, value),
  };
}

describe('a segment given to a handler', () => {
  it('answers its reads from the handler, at every width', function () {
    const memory = new Memory();

    memory.mapHandler(0x21, handler());

    expect(memory.read8(0x210010)).toEqual(0x10);
    expect(memory.read16(0x210010)).toEqual(0x1110);
    expect(memory.read32(0x210010)).toEqual(0x13121110);
    expect(memory.readSigned8(0x2100f0)).toEqual(-16);
  });

  it('gives its writes to the handler', function () {
    const memory = new Memory();
    const segment = handler();

    memory.mapHandler(0x21, segment);
    memory.write16(0x210100, 0xbeef);

    expect(segment.written.get(0x100)).toEqual(0xef);
    expect(segment.written.get(0x101)).toEqual(0xbe);
    expect(memory.read16(0x210100)).toEqual(0xbeef);
  });

  it('leaves the other segments of its block as they were', function () {
    const memory = new Memory();

    memory.write16(0x220004, 0x1234);
    memory.mapHandler(0x21, handler());

    expect(memory.read16(0x220004)).toEqual(0x1234);
    memory.write8(0x220006, 0x77);
    expect(memory.read8(0x220006)).toEqual(0x77);
  });

  it('is read and written in bulk a byte at a time', function () {
    const memory = new Memory();
    const segment = handler();

    memory.mapHandler(0x21, segment);
    memory.write(0x210200, new DataView(new Uint8Array([1, 2, 3]).buffer));

    expect([...new Uint8Array(memory.read(0x210200, 4))]).toEqual([1, 2, 3, 0x03]);
  });

  it('is kept as noughts again once taken back', function () {
    const memory = new Memory();

    memory.mapHandler(0x21, handler());
    memory.unmapHandler(0x21);

    expect(memory.read8(0x210010)).toEqual(0);
  });
});
