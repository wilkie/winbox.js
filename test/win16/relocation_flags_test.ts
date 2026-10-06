'use strict';

import { Machine } from '../../src/emulator/machine.js';
import { Linker } from '../../src/win16/linker.js';
import { relocationFlags } from '../../src/win16/loader.js';

/**
 * A relocation record's flags: its kind, and ADDITIVE (4) for any kind.
 * Catz's CATZ.WAD sets it on its imports by ordinal of CATZDLL's variables
 * (flags 5), and on OS fixups (7).
 */
describe('a relocation record', () => {
  it('is additive whatever its kind', function () {
    expect(relocationFlags(0)).toEqual({ type: 0, additive: false });
    expect(relocationFlags(1)).toEqual({ type: 1, additive: false });
    expect(relocationFlags(4)).toEqual({ type: 0, additive: true });
    expect(relocationFlags(5)).toEqual({ type: 1, additive: true });
    expect(relocationFlags(6)).toEqual({ type: 2, additive: true });
    expect(relocationFlags(7)).toEqual({ type: 3, additive: true });
  });

  it('adds an imported variable to the field in it the code names', function () {
    const machine = new Machine();
    const memory = machine.memory;
    const linker = new Linker(memory, null);
    const segment = 1;

    /* `mov [es:0x2],dx`: the selector's half of a far pointer that CATZDLL
     * keeps at 0x66 in its segment. */
    memory.write16((segment << 16) + 0x13c5, 0x0002);

    linker.writeRelocation16({ offset: 0x13c5, additive: true }, segment, 0x66);

    expect(memory.read16((segment << 16) + 0x13c5)).toBe(0x68);
  });
});
