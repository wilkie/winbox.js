'use strict';

import { Heap } from '../../src/win16/heap.js';
import { taskEnvironment } from '../../src/win16/task-environment.js';
import { RegisterWindowMessage } from '../../src/win16/user/RegisterWindowMessage.js';

/**
 * What a task starts with and asks for first, as the `environ`, `localgro`
 * and `regmsg` probes recorded it.
 */
describe('a task environment', () => {
  const text = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

  it('is the variables, a zero, a count of one and the kernel path', () => {
    const bytes = taskEnvironment('C:\\WINDOWS');

    expect(text(bytes)).toBe('windir=C:\\WINDOWS\0\0\x01\0C:\\WINDOWS\\SYSTEM\\KRNL386.EXE\0');
  });

  it('puts windir after the DOS host variables, where the count lands at 75', () => {
    const bytes = taskEnvironment('C:\\WINDOWS', [
      'PATH=Z:\\',
      'COMSPEC=Z:\\COMMAND.COM',
      'BLASTER=A220 I7 D1 H5 T6',
    ]);

    // The recording: the zero that ends the variables at 75, the count after it.
    expect(bytes[75]).toBe(0);
    expect(bytes[76] | (bytes[77] << 8)).toBe(1);
    expect(text(bytes.slice(0, 74)).split('\0')).toEqual([
      'PATH=Z:\\',
      'COMSPEC=Z:\\COMMAND.COM',
      'BLASTER=A220 I7 D1 H5 T6',
      'windir=C:\\WINDOWS',
    ]);
  });
});

describe('a local heap out of room', () => {
  const growable = (size: number) => {
    const heap = new Heap(size);

    heap.offset = 0x2000;
    heap.growable = true;

    return heap;
  };

  it('grows by the request and 544, rounded up to 32', () => {
    for (const [request, growth] of [
      [1000, 1568],
      [3072, 3616],
      [4096, 4640],
    ]) {
      const heap = growable(16);

      expect(heap.allocate(request)).not.toBeNull();
      expect(heap.byteLength - 16).toBe(growth);
    }
  });

  it('grows to 64K when that is enough, and fails with nothing grown when it is not', () => {
    // A growth past 64K, where 64K is still enough for the block.
    const heap = growable(56000);

    expect(heap.allocate(57000)).not.toBeNull();
    expect(heap.byteLength + heap.offset).toBe(0x10000);

    const before = heap.byteLength;

    expect(heap.allocate(4000)).toBeNull();
    expect(heap.byteLength).toBe(before);
  });

  it('does not grow a heap that may not', () => {
    const heap = new Heap(64);

    expect(heap.allocate(100)).toBeNull();
    expect(heap.byteLength).toBe(64);
  });
});

describe('RegisterWindowMessage', () => {
  it('gives one message a string, in any case, from 0xC000', () => {
    const system: any = {};
    const first = RegisterWindowMessage.call(system, 'commdlg_FindReplace');

    expect(first).toBeGreaterThanOrEqual(0xc000);
    expect(RegisterWindowMessage.call(system, 'commdlg_FindReplace')).toBe(first);
    expect(RegisterWindowMessage.call(system, 'COMMDLG_FINDREPLACE')).toBe(first);
    expect(RegisterWindowMessage.call(system, 'winbox_probe_message')).not.toBe(first);
  });
});
