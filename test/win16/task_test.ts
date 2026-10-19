'use strict';

import { Heap } from '../../src/win16/heap.js';
import { Task } from '../../src/win16/task.js';
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
  /* `localgro`'s heap: 1,024 bytes at the end of a data segment of 12,160,
   * as `LocalInit` with a start of nought lays it (`Heap.init`). */
  const localgro = () => {
    const heap = new Heap();

    expect(heap.init(12160 - 1 - 1024, 12160 - 1)).toBe(true);
    heap.segmentSize = 12160;
    heap.growable = true;

    return heap;
  };

  it("lays the heap out as LocalInit does, KERNEL's arenas before the blocks and after", () => {
    expect(Heap.layout(12160 - 1 - 1024, 12160 - 1)).toEqual({
      first: 0x2b80,
      free: 0x2bbc,
      last: 0x2f74,
    });
    // DDEML's instance heap: `LocalInit(segment, 0, 0FFFh)` in a block of 1000h.
    expect(Heap.layout(0, 0xfff)).toEqual({ first: 0xc, free: 0x48, last: 0xff4 });
  });

  it('grows as localgro recorded, block by block, and to no more than 65,312 there', () => {
    const heap = localgro();
    const sizes = [1000, 1000, 1000, 3072, ...Array(12).fill(4096)];
    const recorded = [
      [0x2bc0, 13728],
      [0x2fac, 13728],
      [0x3398, 15296],
      [0x3784, 18912],
      [0x4388, 23552],
      [0x538c, 28192],
      [0x6390, 32832],
      [0x7394, 37472],
      [0x8398, 42112],
      [0x939c, 42112],
      [0xa3a0, 46752],
      [0xb3a4, 51392],
      [0xc3a8, 56032],
      [0xd3ac, 60672],
      [0xe3b0, 65312],
      [0, 65312],
    ];

    expect(sizes.map((size) => [heap.allocate(size) ?? 0, heap.segmentSize])).toEqual(recorded);
  });

  it('gives a free block whole where 16 bytes or less would be left', () => {
    /* A free block of 52 and 16 bytes, from 13Ch to its last arena. */
    const heap = new Heap();

    expect(heap.init(0x100, 0x13c + 52 + 16 + 0xa)).toBe(true);

    const block = heap.allocate(0x2e);

    expect(heap.sizeOf(block)).toBe(0x30 + 16);
    expect(heap.allocate(1)).toBeNull();
  });

  it('does not grow a heap that may not', () => {
    const heap = new Heap();

    expect(heap.init(0x10, 0x100)).toBe(true);
    expect(heap.allocate(0x100)).toBeNull();
    expect(heap.byteLength).toBe(0xee);
  });

  it("keeps a moveable block's handle in a table of 32, the block at the top (lheapseg)", () => {
    const heap = new Heap();

    expect(heap.init(0x10, 0x820)).toBe(true);

    const first = heap.localAlloc(2, 49);
    const second = heap.localAlloc(2, 49);

    /* The table a fixed block at the bottom of the free block, its entries
     * from two bytes in; the block under the last arena. */
    expect([first, second]).toEqual([0x52, 0x56]);
    expect(heap.read16(first)).toBe(0x814 - 0x38 + 6);
    expect(heap.localHandle(heap.read16(first))).toBe(first);
    expect(heap.localHandle(first)).toBe(0);
    expect(heap.localFree(first)).toBe(0);
    expect(heap.localSize(first)).toBe(0);
    expect(heap.localAlloc(2, 8)).toBe(first);
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

describe("a task's queue", () => {
  it('gives what was posted before the input already waiting', async () => {
    const task: any = new Task(null, null);

    task.push({ message: 'WM_SYSKEYUP F' }, true);
    task.push({ message: 'WM_SYSKEYUP Alt' }, true);
    task.push({ message: 'WM_SYSCHAR f' });

    expect(task.peek().message).toBe('WM_SYSCHAR f');
    expect((await task.pull()).message).toBe('WM_SYSCHAR f');
    expect((await task.pull()).message).toBe('WM_SYSKEYUP F');
    expect((await task.pull()).message).toBe('WM_SYSKEYUP Alt');
  });
});
