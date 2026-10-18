'use strict';

import { type Arg, type Called, D, W, api, buffer, text } from '../commdlg/api.js';
import { segmentSelector } from '../selectors.js';
import { DWORD, UINT } from '../types.js';

/**
 * What every routine of WinBox's `DDEML` stands on: its data segment and the
 * guest memory its structures live in, its calls into KERNEL and USER made as
 * `DDEML.DLL` makes them, and the little library of lists, arrays and queues
 * `DDEML.DLL` keeps them in (seg1 `2144`-`2d80`, `5eae`-`6114`,
 * `6118`-`62dc`, `7334`-`74d4`). As `crates/winbox-win16/src/ddeml/core.rs`.
 *
 * Every structure is where `DDEML.DLL` puts it and laid out as it lays it
 * out: the instances in DDEML's own local heap, everything of an instance's
 * in a local heap of 4 KB of its own in a global block, the queues each in a
 * global heap of their own. A far pointer is a number of selector and offset
 * as the code holds one.
 */

export const sel = (far: number) => (far >>> 16) & 0xffff;
export const off = (far: number) => far & 0xffff;
export const far = (selector: number, offset: number) =>
  (((selector & 0xffff) << 16) | (offset & 0xffff)) >>> 0;
/** A far pointer `n` bytes on, in its segment. */
export const plus = (at: number, n: number) => far(sel(at), off(at) + n);
export const lo = (value: number) => value & 0xffff;
export const hi = (value: number) => (value >>> 16) & 0xffff;
export const long = (low: number, high: number) => (((high & 0xffff) << 16) | (low & 0xffff)) >>> 0;

/** The comparisons the lists are searched with (`2278`, `22a0`, `22be`, `2518`). */
export type Cmp = 'dword' | 'first' | 'second' | 'link';

/** `NAME` and the data segment's selector, from `index.ts` without importing it. */
export const DDEML_NAME = 'DDEML';
export const DDEML_PATH = 'C:\\WINDOWS\\SYSTEM\\DDEML.DLL';

/** One of the calls made: `DDEML.DLL` as it runs. */
export class Dd {
  constructor(readonly system: any) {}

  get core(): any {
    return this.system.machine.cpu.core;
  }

  // DDEML's data segment.

  ds(): number {
    return this.system._moduleData?.[DDEML_NAME] ?? 0;
  }

  d16(at: number): number {
    return this.r16(far(this.ds(), at));
  }

  sd16(at: number, value: number) {
    this.w16(far(this.ds(), at), value);
  }

  near(at: number): number {
    return far(this.ds(), at);
  }

  // Guest memory.

  r8(at: number): number {
    return this.core.read8(sel(at), off(at)) & 0xff;
  }

  w8(at: number, value: number) {
    this.core.write8(sel(at), off(at), value & 0xff);
  }

  r16(at: number): number {
    return this.r8(at) | (this.r8(plus(at, 1)) << 8);
  }

  w16(at: number, value: number) {
    this.w8(at, value);
    this.w8(plus(at, 1), value >> 8);
  }

  r32(at: number): number {
    return (this.r16(at) | (this.r16(plus(at, 2)) << 16)) >>> 0;
  }

  w32(at: number, value: number) {
    this.w16(at, value & 0xffff);
    this.w16(plus(at, 2), (value >>> 16) & 0xffff);
  }

  read(at: number, n: number): number[] {
    return Array.from({ length: n }, (_, i) => this.r8(plus(at, i)));
  }

  write(at: number, bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) {
      this.w8(plus(at, i), bytes[i]);
    }
  }

  i16(instance: number, field: number): number {
    return this.d16((instance + field) & 0xffff);
  }

  si16(instance: number, field: number, value: number) {
    this.sd16((instance + field) & 0xffff, value);
  }

  i32(instance: number, field: number): number {
    return this.r32(this.near((instance + field) & 0xffff));
  }

  si32(instance: number, field: number, value: number) {
    this.w32(this.near((instance + field) & 0xffff), value);
  }

  // Calls into KERNEL, USER, GDI and KEYBOARD.

  async callB(module: string, name: string, args: Arg[]): Promise<Called> {
    return api(this.system, module, name, args);
  }

  async call(module: string, name: string, args: Arg[]): Promise<number> {
    return (await this.callB(module, name, args)).value >>> 0;
  }

  async user(name: string, args: Arg[]): Promise<number> {
    return this.call('USER', name, args);
  }

  async kernel(name: string, args: Arg[]): Promise<number> {
    return this.call('KERNEL', name, args);
  }

  /** A KERNEL call on the local heap of the segment in DS, made with DS that segment (`735c`). */
  async kernelIn(segment: number, name: string, args: Arg[]): Promise<number> {
    const saved = this.core.ds;

    this.core.ds = segment;

    try {
      return await this.kernel(name, args);
    } finally {
      this.core.ds = saved;
    }
  }

  async isWindow(hwnd: number): Promise<boolean> {
    return ((await this.user('IsWindow', [W(hwnd)])) & 0xffff) !== 0;
  }

  async windowWord(hwnd: number, index: number): Promise<number> {
    return (await this.user('GetWindowWord', [W(hwnd), W(index)])) & 0xffff;
  }

  async windowLong(hwnd: number, index: number): Promise<number> {
    return this.user('GetWindowLong', [W(hwnd), W(index)]);
  }

  async setWindowWord(hwnd: number, index: number, value: number): Promise<number> {
    return (await this.user('SetWindowWord', [W(hwnd), W(index), W(value)])) & 0xffff;
  }

  async setWindowLong(hwnd: number, index: number, value: number): Promise<number> {
    return this.user('SetWindowLong', [W(hwnd), W(index), D(value)]);
  }

  async getWindow(hwnd: number, command: number): Promise<number> {
    return (await this.user('GetWindow', [W(hwnd), W(command)])) & 0xffff;
  }

  async getParent(hwnd: number): Promise<number> {
    return (await this.user('GetParent', [W(hwnd)])) & 0xffff;
  }

  async setParent(hwnd: number, parent: number): Promise<number> {
    return (await this.user('SetParent', [W(hwnd), W(parent)])) & 0xffff;
  }

  async windowTask(hwnd: number): Promise<number> {
    return (await this.user('GetWindowTask', [W(hwnd)])) & 0xffff;
  }

  async currentTask(): Promise<number> {
    return (await this.kernel('GetCurrentTask', [])) & 0xffff;
  }

  async currentTime(): Promise<number> {
    return this.user('GetCurrentTime', []);
  }

  async send(hwnd: number, message: number, wparam: number, lparam: number): Promise<number> {
    return this.user('SendMessage', [W(hwnd), W(message), W(wparam), D(lparam)]);
  }

  async post(hwnd: number, message: number, wparam: number, lparam: number): Promise<number> {
    return (await this.user('PostMessage', [W(hwnd), W(message), W(wparam), D(lparam)])) & 0xffff;
  }

  async destroyWindow(hwnd: number): Promise<number> {
    return (await this.user('DestroyWindow', [W(hwnd)])) & 0xffff;
  }

  async setTimer(hwnd: number, id: number, elapse: number): Promise<number> {
    return (await this.user('SetTimer', [W(hwnd), W(id), W(elapse), D(0)])) & 0xffff;
  }

  async killTimer(hwnd: number, id: number): Promise<number> {
    return (await this.user('KillTimer', [W(hwnd), W(id)])) & 0xffff;
  }

  /** `CreateWindow(class, "", style, 0, 0, 0, 0, parent, 0, DDEML's instance, lpParam)`. */
  async createWindow(klass: number, style: number, parent: number, param: number): Promise<number> {
    const instance = this.d16(D_HINSTANCE);

    return (
      (await this.user('CreateWindow', [
        D(this.near(klass)),
        D(this.near(D_EMPTY)),
        D(style),
        W(0),
        W(0),
        W(0),
        W(0),
        W(parent),
        W(0),
        W(instance),
        D(param),
      ])) & 0xffff
    );
  }

  async globalAlloc(flags: number, size: number): Promise<number> {
    return (await this.kernel('GlobalAlloc', [W(flags), D(size)])) & 0xffff;
  }

  async globalLock(handle: number): Promise<number> {
    return this.kernel('GlobalLock', [W(handle)]);
  }

  async globalUnlock(handle: number): Promise<number> {
    return (await this.kernel('GlobalUnlock', [W(handle)])) & 0xffff;
  }

  async globalFree(handle: number): Promise<number> {
    return (await this.kernel('GlobalFree', [W(handle)])) & 0xffff;
  }

  async globalSize(handle: number): Promise<number> {
    return this.kernel('GlobalSize', [W(handle)]);
  }

  async addAtomText(bytes: number[]): Promise<number> {
    return (await this.user('GlobalAddAtom', [text(bytes)])) & 0xffff;
  }

  async addAtomAt(string: number): Promise<number> {
    return (await this.user('GlobalAddAtom', [D(string)])) & 0xffff;
  }

  async findAtomAt(string: number): Promise<number> {
    return (await this.user('GlobalFindAtom', [D(string)])) & 0xffff;
  }

  async deleteAtomRaw(atom: number): Promise<number> {
    return (await this.user('GlobalDeleteAtom', [W(atom)])) & 0xffff;
  }

  /** `GlobalGetAtomName(atom, buffer, size)` into a buffer of DDEML's stack. */
  async atomName(atom: number, size: number): Promise<[number, number[]]> {
    const called = await this.callB('USER', 'GlobalGetAtomName', [W(atom), buffer(size), W(size)]);
    const bytes = called.buffers[0] ?? [];
    const end = bytes.indexOf(0);

    return [called.value & 0xffff, end < 0 ? bytes.slice() : bytes.slice(0, end)];
  }

  async atomNameAt(atom: number, at: number, size: number): Promise<number> {
    return (await this.user('GlobalGetAtomName', [W(atom), D(at), W(size)])) & 0xffff;
  }

  // Space on DDEML's stack.

  /** `n` bytes taken below the stack: their far address, and the stack pointer to give back. */
  reserve(n: number): [number, number] {
    const saved = this.core.sp & 0xffff;
    const at = (saved - ((n + 1) & ~1)) & 0xffff;

    this.core.sp = at;
    return [far(this.core.ss, at), saved];
  }

  release(saved: number) {
    this.core.sp = saved;
  }

  /** A program's procedure called far with Pascal arguments and DDEML's DS (`58ef`). */
  async callFar(procedure: number, args: [number, number][]): Promise<number> {
    const answer = await this.system.scheduler.callProc(procedure >>> 0, args, { ds: this.ds() });

    return Number(answer ?? 0) >>> 0;
  }

  // The C library's memory (`7334`, `7396`, `2c66`).

  /** `2c66`: `size` bytes copied, across segments as huge pointers go. */
  copy(from: number, to: number, size: number) {
    let a = from;
    let b = to;
    let left = size >>> 0;

    while (left > 0) {
      const room = Math.min(0x10000 - off(a), 0x10000 - off(b));
      const count = Math.min(room, left);
      const bytes = this.read(a, count);

      this.write(b, bytes);
      a = this.huge(a, count);
      b = this.huge(b, count);
      left -= count;
    }
  }

  /** `7334`: a huge pointer `n` bytes on. */
  huge(at: number, n: number): number {
    const total = off(at) + (n >>> 0);

    return far(sel(at) + Math.floor(total / 0x10000) * 8, total & 0xffff);
  }

  // The heaps (`6118`-`62dc`).

  /** `6118`: a global heap of `size` bytes, its local heap made in it. */
  async heapCreate(size: number): Promise<number> {
    const handle = await this.globalAlloc(0x0002, size);

    if (handle === 0) {
      return 0;
    }

    const locked = await this.globalLock(handle);

    if (locked === 0) {
      await this.globalFree(handle);
      return 0;
    }

    const made =
      (await this.kernel('LocalInit', [W(hi(locked)), W(0), W((size - 1) & 0xffff)])) & 0xffff;

    await this.globalUnlock(handle);

    if (made === 0) {
      await this.globalFree(handle);
      return 0;
    }

    return handle;
  }

  /** `6182`: a heap freed, unless still locked. */
  async heapFree(handle: number): Promise<number> {
    if ((await this.globalUnlock(handle)) !== 0) {
      return handle;
    }

    return this.globalFree(handle);
  }

  private async heapLock(handle: number): Promise<number> {
    if (handle === this.ds()) {
      return handle;
    }

    return hi(await this.globalLock(handle));
  }

  private async heapUnlock(handle: number) {
    if (handle !== this.ds()) {
      await this.globalUnlock(handle);
    }
  }

  /** `6250`: `size` bytes of a heap, `LMEM_ZEROINIT`; a heap full calls `61a8` and tries again. */
  async alloc(handle: number, size: number): Promise<number> {
    const segment = await this.heapLock(handle);

    if (segment === 0) {
      return 0;
    }

    let block: number;

    for (;;) {
      block = (await this.kernelIn(segment, 'LocalAlloc', [W(0x40), W(size)])) & 0xffff;

      if (block !== 0 || (await heapFullHook(this, handle)) === 0) {
        break;
      }
    }

    await this.heapUnlock(handle);
    return block === 0 ? 0 : far(segment, block);
  }

  /** `62b6`: a block of a heap freed. */
  async free(block: number) {
    const handle = (await this.kernelIn(sel(block), 'LocalHandle', [W(off(block))])) & 0xffff;

    await this.kernelIn(sel(block), 'LocalFree', [W(handle)]);
  }

  // Lists.

  /** `2144`: a list's header. */
  async listNew(heap: number, size: number): Promise<number> {
    const header = await this.alloc(heap, 8);

    if (header === 0) {
      return 0;
    }

    this.w16(plus(header, 4), heap);
    this.w16(plus(header, 6), size);
    this.w32(header, 0);
    return header;
  }

  /** `218a`: every item freed, and the header. */
  async listFree(header: number) {
    if (header === 0) {
      return;
    }

    for (;;) {
      const first = this.r32(header);

      if (first === 0) {
        break;
      }

      await this.listRemove(header, first);
    }

    await this.free(header);
  }

  private compare(cmp: Cmp, item: number, key: number): boolean {
    switch (cmp) {
      case 'dword':
        return this.r32(key) === this.r32(item);
      case 'first':
        return this.r16(key) === this.r16(item);
      case 'second':
        return this.r16(plus(key, 2)) === this.r16(plus(item, 2));
      case 'link':
        return this.linkMatches(plus(item, -4), plus(key, -4));
    }
  }

  /** `2518`: an advise link against a key whose noughts match anything. */
  private linkMatches(item: number, key: number): boolean {
    for (const field of [6, 0xc, 4, 8]) {
      const wanted = this.r16(plus(key, field));

      if (wanted !== 0 && this.r16(plus(item, field)) !== wanted) {
        return false;
      }
    }

    return true;
  }

  /** `2212`: the first item whose data matches the key's data. */
  listFind(header: number, cmp: Cmp, key: number): number {
    if (header === 0) {
      return 0;
    }

    let item = this.r32(header);

    while (item !== 0) {
      if (this.compare(cmp, plus(item, 4), key)) {
        break;
      }

      item = this.r32(item);
    }

    return item;
  }

  /** `22de`: an item made, put last, or first with flag 1, or not linked with flag 2. */
  async listAdd(header: number, flags: number): Promise<number> {
    if (header === 0) {
      return 0;
    }

    const item = await this.alloc(
      this.r16(plus(header, 4)),
      (this.r16(plus(header, 6)) + 4) & 0xffff
    );

    if (item === 0 || flags & 2) {
      return item;
    }

    const first = this.r32(header);

    if (first !== 0 && (flags & 1) === 0) {
      let last = first;

      while (this.r32(last) !== 0) {
        last = this.r32(last);
      }

      this.w32(last, item);
      this.w32(item, 0);
    } else {
      this.w32(item, first);
      this.w32(header, item);
    }

    return item;
  }

  /** `2392`: an item taken out of its list and freed -- freed even when not found. */
  async listRemove(header: number, item: number): Promise<boolean> {
    if (header === 0 || item === 0) {
      return false;
    }

    const first = this.r32(header);

    if (first === 0) {
      return false;
    }

    if (first === item) {
      this.w32(header, this.r32(item));
    } else {
      let at = first;

      while (this.r32(at) !== item && this.r32(at) !== 0) {
        at = this.r32(at);
      }

      if (this.r32(at) !== 0) {
        this.w32(at, this.r32(item));
      }
    }

    await this.free(item);
    return true;
  }

  // Arrays.

  /** `28ec`: an array's header. */
  async arrayNew(heap: number, size: number, count: number): Promise<number> {
    const header = await this.alloc(heap, 0xc);

    if (header === 0) {
      return 0;
    }

    this.w32(header, 0);
    this.w16(plus(header, 4), heap);
    this.w16(plus(header, 6), (count * size + 8) & 0xffff);
    this.w16(plus(header, 8), count);
    this.w16(plus(header, 0xa), size);
    return header;
  }

  /** `2946`: every block freed, and the header. */
  async arrayFree(header: number) {
    if (header === 0) {
      return;
    }

    for (;;) {
      const first = this.r32(header);

      if (first === 0) {
        break;
      }

      await this.listRemove(header, first);
    }

    await this.free(header);
  }

  /** `2984`: how many items. */
  arrayCount(header: number): number {
    if (header === 0) {
      return 0;
    }

    let total = 0;
    let block = this.r32(header);

    while (block !== 0) {
      total = (total + this.r16(plus(block, 4))) & 0xffff;
      block = this.r32(block);
    }

    return total;
  }

  /** `29d8`: the first item matching the key, taken out with `remove`. */
  async arrayFind(header: number, cmp: Cmp | null, key: number, remove: boolean): Promise<number> {
    if (header === 0) {
      return 0;
    }

    const size = this.r16(plus(header, 0xa));
    let block = this.r32(header);

    while (block !== 0) {
      let item = plus(block, 8);

      for (let index = 0; index < this.r16(plus(block, 4)); index++) {
        const matched = cmp !== null && key !== 0 ? this.compare(cmp, item, key) : true;

        if (matched) {
          if (remove) {
            const count = (this.r16(plus(block, 4)) - 1) & 0xffff;

            this.w16(plus(block, 4), count);

            if (count === 0) {
              await this.listRemove(header, block);
            } else {
              const last = plus(block, 8 + size * count);

              this.write(item, this.read(last, size));
            }
          }

          return item;
        }

        item = plus(item, size);
      }

      block = this.r32(block);
    }

    return 0;
  }

  /** `2ac6`: an item put in: in the place of one matching (2), else where there is room (1). */
  async arrayAdd(header: number, item: number, cmp: Cmp | null): Promise<number> {
    if (header === 0) {
      return 0;
    }

    const size = this.r16(plus(header, 0xa));

    if (cmp !== null) {
      const found = await this.arrayFind(header, cmp, item, false);

      if (found !== 0) {
        this.write(found, this.read(item, size));
        return 2;
      }
    }

    let block = this.r32(header);

    while (block !== 0 && this.r16(plus(block, 4)) === this.r16(plus(header, 8))) {
      block = this.r32(block);
    }

    if (block === 0) {
      block = await this.listAdd(header, 0);

      if (block === 0) {
        return 0;
      }

      this.w16(plus(block, 4), 0);
    }

    const index = this.r16(plus(block, 4));

    this.w16(plus(block, 4), index + 1);
    this.write(plus(block, size * index + 8), this.read(item, size));
    return 1;
  }

  /** `2bba`: the first item taken out: its bytes, or null. */
  async arrayPop(header: number): Promise<number[] | null> {
    if (header === 0) {
      return null;
    }

    const block = this.r32(header);

    if (block === 0) {
      return null;
    }

    const size = this.r16(plus(header, 0xa));
    const first = plus(block, 8);
    const out = this.read(first, size);

    if (this.r16(plus(block, 4)) === 1) {
      await this.listRemove(header, block);
    } else {
      const count = (this.r16(plus(block, 4)) - 1) & 0xffff;

      this.w16(plus(block, 4), count);
      this.write(first, this.read(plus(first, size * count), size));
    }

    return out;
  }

  /** A key, or an item to put in, laid out below the stack with four bytes of room before it. */
  key(bytes: number[]): [number, number] {
    const [at, saved] = this.reserve(bytes.length + 4);

    this.write(plus(at, 4), bytes);
    return [plus(at, 4), saved];
  }

  // Queues.

  /** `5eae`: a queue of items of `size` bytes, in a heap of its own. */
  async queueNew(size: number): Promise<number> {
    const heap = await this.heapCreate(((size + 0xc) << 3) & 0xffff);

    if (heap === 0) {
      return 0;
    }

    const header = await this.alloc(heap, 0xc);

    if (header === 0) {
      await this.heapFree(heap);
      return 0;
    }

    this.write(header, [0, 0, 0, 0, size & 0xff, size >> 8, heap & 0xff, heap >> 8, 0, 0, 0, 0]);
    return header;
  }

  /** `5f18`: a queue freed, its heap and all. */
  async queueFree(header: number) {
    if (header !== 0) {
      await this.heapFree(this.r16(plus(header, 6)));
    }
  }

  /** `5f36`: an item put last, its serial the queue's next. */
  async queueAdd(header: number): Promise<number> {
    const item = await this.alloc(this.r16(plus(header, 6)), this.r16(plus(header, 4)));

    if (item === 0) {
      return 0;
    }

    if (this.r16(header) === 0) {
      this.w32(item, item);
      this.w32(plus(item, 4), item);
      this.w32(plus(header, 8), item);
    } else {
      const last = this.r32(plus(header, 8));
      const first = this.r32(last);

      this.w32(plus(item, 4), last);
      this.w32(item, first);
      this.w32(plus(first, 4), item);
      this.w32(last, item);
      this.w32(plus(header, 8), item);
    }

    this.w16(header, this.r16(header) + 1);

    const serial = (this.r16(plus(header, 2)) + 1) & 0xffff;

    this.w16(plus(header, 2), serial);
    this.w16(plus(item, 8), serial);
    return item;
  }

  /** `60a0`: nought the first, FFFF:FFFE the last, else the item whose serial is the high word. */
  queueItem(header: number, which: number): number {
    if (header === 0 || this.r32(plus(header, 8)) === 0) {
      return 0;
    }

    const last = this.r32(plus(header, 8));

    if (which === 0) {
      return this.r32(last);
    }

    if (which >>> 0 === 0xfffffffe) {
      return last;
    }

    const item = far(sel(header), lo(which));

    return this.r16(plus(item, 8)) === hi(which) ? item : 0;
  }

  /** An item's identifier: its offset and its serial. */
  queueId(item: number): number {
    return long(off(item), this.r16(plus(item, 8)));
  }

  /** `6004`: an item taken out and freed. */
  async queueRemove(header: number, which: number) {
    const item = this.queueItem(header, which);

    if (item === 0) {
      return;
    }

    const next = this.r32(item);
    const before = this.r32(plus(item, 4));

    this.w32(before, next);
    this.w32(plus(next, 4), before);

    if (this.r32(plus(header, 8)) === item) {
      this.w32(plus(header, 8), before);
    }

    const count = (this.r16(header) - 1) & 0xffff;

    this.w16(header, count);

    if (count === 0) {
      this.w32(plus(header, 8), 0);
    }

    await this.free(item);
  }

  /** `5b0c`: a block of `GMEM_DDESHARE`, at least a byte, its first two words given. */
  async share(size: number, first: number, second: number): Promise<number> {
    const handle = await this.globalAlloc(0x2000, size === 0 ? 1 : size);

    if (handle !== 0) {
      const at = await this.globalLock(handle);

      this.w16(at, first);
      this.w16(plus(at, 2), second);
      await this.globalUnlock(handle);
    }

    return handle;
  }

  /** The stub of one of DDEML's own exports, as USER calls it. */
  exportAddress(ordinal: number): number {
    const module = registered;

    if (!module) {
      return 0;
    }

    const info = this.system._modules.load(module).lookup(ordinal);

    return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
  }
}

/** A callback's arguments, as `DDEML.DLL` pushes them (`58c5`). */
export function callbackArgs(
  kind: number,
  format: number,
  conv: number,
  hsz1: number,
  hsz2: number,
  data: number,
  data1: number,
  data2: number
): [number, number][] {
  return [
    [kind & 0xffff, UINT],
    [format & 0xffff, UINT],
    [conv >>> 0, DWORD],
    [hsz1 >>> 0, DWORD],
    [hsz2 >>> 0, DWORD],
    [data >>> 0, DWORD],
    [data1 >>> 0, DWORD],
    [data2 >>> 0, DWORD],
  ];
}

/** The module, registered by `index.ts` as it is read, for `exportAddress`. */
let registered: any = null;

export function registerDdeml(module: any) {
  registered = module;
}

/** `61a8`, registered by `monitor.ts`, so `alloc` reaches it without importing it. */
let heapFullHook: (d: Dd, heap: number) => Promise<number> = async () => 0;

export function registerHeapFull(hook: (d: Dd, heap: number) => Promise<number>) {
  heapFullHook = hook;
}

/** `7374`: the C library's `atol`: spaces and tabs skipped, a sign, decimal digits. */
export function atol(bytes: number[]): number {
  let at = 0;

  while (bytes[at] === 0x20 || bytes[at] === 0x09) {
    at++;
  }

  const negative = bytes[at] === 0x2d;

  if (bytes[at] === 0x2d || bytes[at] === 0x2b) {
    at++;
  }

  let value = 0;

  while (at < bytes.length && bytes[at] >= 0x30 && bytes[at] <= 0x39) {
    value = (Math.imul(value, 10) + (bytes[at] - 0x30)) >>> 0;
    at++;
  }

  return negative ? -value >>> 0 : value;
}

// DDEML's data, as `DDEML.DLL`'s data segment lays it out (seg3).

export const D_HINSTANCE = 0x16;
export const D_HEAP = 0x18;
export const D_INSTANCES = 0x1a;
export const D_ARRAY_OWNED = 0x1c;
export const D_ARRAY_SENT = 0x20;
export const D_SERIAL = 0x24;
export const D_CONTEXT = 0x26;
export const D_EMPTY = 0x36;
export const D_MONITORS = 0x38;
export const D_HOOK = 0x3a;
export const D_CLASS_FRAME = 0x3e;
export const D_CLASS_DMG = 0x48;
export const D_CLASS_CLIENT = 0x52;
export const D_CLASS_SERVER = 0x62;
export const D_CLASS_MONITOR = 0x72;
export const D_CLASS_HOLDING = 0x82;
export const D_PROGMAN = 0xa4;
export const D_TEXT_3000 = 0xe6;
export const D_TEXT_SHUTDOWN = 0xeb;
export const D_TEXT_DDEML = 0xfb;
export const D_TEXT_30000 = 0x101;
export const D_TEXT_RETRY = 0x107;
export const D_TEXT_PROGMAN = 0x122;
export const D_WHO = 0x13e;
export const D_MADE_ME = 0x142;
export const D_TEXT_STAAB = 0x14b;
export const D_XPARAMS = 0x16e;
export const D_RETRY = 0x240;
export const D_SHUTDOWN = 0x244;
export const D_PROFILE = 0x248;

export { buffer };
