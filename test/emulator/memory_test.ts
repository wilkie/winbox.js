'use strict';

import { Memory } from '../../src/emulator/memory.js';

describe('Memory', () => {
  beforeEach(function () {});

  describe('.constructor', () => {
    // Memory used to preallocate a fixed 8192 segments. It now allocates
    // blocks on demand, so these assert the lazy behavior instead.
    it('should not allocate any blocks up front', function () {
      const memory = new Memory();
      expect(memory.blocks.length).toEqual(0);
    });

    it('should create empty blocks', function () {
      const memory = new Memory();
      expect(memory.blocks[0]).toBeUndefined();
    });
  });

  describe('.span', () => {
    it('keeps a range across blocks made apart in one piece, its bytes kept', function () {
      const memory = new Memory();

      memory.write8(0x1ffffe, 0x11);
      memory.write8(0x500000, 0x99);
      memory.write8(0x200001, 0x22);

      const span = memory.span(0x1ffffe, 4);

      expect(Array.from(span.bytes)).toEqual([0x11, 0, 0, 0x22]);

      span.bytes[2] = 0x33;
      memory.write8(0x1fffff, 0x44);

      expect(memory.read8(0x200000)).toEqual(0x33);
      expect(span.bytes[1]).toEqual(0x44);
      expect(memory.read8(0x500000)).toEqual(0x99);
    });

    it('takes its bytes again when the memory grows, and says so', function () {
      const memory = new Memory();
      const span = memory.span(0x10000, 2);
      let moves = 0;

      span.onMove = () => moves++;
      span.bytes[0] = 0x5a;

      for (let block = 1; block < 8; block++) {
        memory.write8(block * 0x100000, block);
      }

      expect(moves).toBeGreaterThan(0);
      expect(span.bytes[0]).toEqual(0x5a);
      span.bytes[1] = 0xa5;
      expect(memory.read8(0x10001)).toEqual(0xa5);
    });
  });
});
