'use strict';

import Helper from '../helper.js';

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
});
