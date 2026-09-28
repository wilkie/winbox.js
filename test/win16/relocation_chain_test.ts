'use strict';

import { Machine } from '../../src/emulator/machine.js';
import { Linker } from '../../src/win16/linker.js';

/**
 * A chain of fixups: each site holds the offset of the next, the last FFFFh.
 * The Towers from HANOI of the corpus links 1152 sites in one.
 */
describe('a relocation chain', () => {
  it('is followed to its end however long it is', function () {
    const machine = new Machine();
    const memory = machine.memory;
    const linker = new Linker(memory, null);
    const segment = 1;
    const sites = 1500;

    for (let site = 0; site < sites; site++) {
      memory.write16((segment << 16) + site * 4, site === sites - 1 ? 0xffff : (site + 1) * 4);
    }

    linker.writeRelocation16({ offset: 0, additive: false }, segment, 0x1234);

    const left = [...Array(sites).keys()].filter(
      (site) => memory.read16((segment << 16) + site * 4) !== 0x1234
    );

    expect(left).toEqual([]);
  });
});
