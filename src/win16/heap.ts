'use strict';

/**
 * A local heap, kept as KERNEL keeps one: in the segment itself, its arenas,
 * its free list, its information and its handle tables all words of the
 * segment, where a program finds them. Each routine follows
 * `KRNL386.EXE`'s, step for step, and cites it: seg2 `28b7` (`LocalInit`),
 * seg1 `8a28`-`93cc` (the rest). As `crates/winbox-machine/src/local.rs`.
 *
 * **Arenas.** Each block has an arena before it: the previous arena's
 * address, with the block's flags in its two low bits -- 1 in use, 2
 * moveable -- and the next arena's. A fixed block's bytes follow those four;
 * a moveable block's arena holds its handle's address after them, and its
 * bytes start six bytes in. A free arena keeps its size and the previous and
 * next free arenas after its four (`+4`, `+6`, `+8`), the free list in the
 * order of the arenas. The first arena and the last are KERNEL's own, ten
 * bytes each, the free list's ends. A block's size is the next arena less
 * its bytes' start.
 *
 * **The information.** DS:6 points at it, in a block of KERNEL's own after
 * the first arena (`INFO`).
 *
 * **Handles.** A moveable block's handle is an entry of a handle table:
 * its block's address, its flags -- 40h discarded, the low four its discard
 * level -- and its lock count, four bytes. A table is a fixed block of the
 * heap: its count, its entries, and the next table's address. The free
 * entries are a list through their first words, their second FFFFh; the
 * last entry freed is given first.
 */

/** Offsets in the heap's information, which DS:6 points at (seg2 `2916`-`2938`). */
const INFO = {
  /** How many callers asked for `LMEM_NOCOMPACT`: no block is moved while it is not nought. */
  noCompact: 0x02,
  /** How many arenas there are. */
  arenas: 0x04,
  first: 0x06,
  last: 0x0a,
  /** Bytes the compaction counts its passes and discard levels in (`8f26`). */
  pass: 0x0e,
  level: 0x0f,
  /** The first handle table, and the first free handle. */
  tables: 0x14,
  freeHandle: 0x16,
  /** How many handles a table is made with: 32, `LocalHandleDelta`'s. */
  delta: 0x18,
  /** KERNEL's routine that makes a handle table (`8a41`), a near address. */
  tableProc: 0x1a,
  /** The notify procedure, a far address: KERNEL's own, `8de2`. */
  notify: 0x1e,
  /** The bytes the default notify procedure grows a heap by beyond the block: 200h. */
  extra: 0x24,
  /** The heap's span as `LocalInit` made it, which `LocalShrink` will not go below. */
  span: 0x26,
  /** `LH`. */
  signature: 0x28,
};

const LMEM_MOVEABLE = 0x0002;
const LMEM_NOCOMPACT = 0x0010;
const LMEM_ZEROINIT = 0x0040;
const LMEM_MODIFY = 0x0080;

/** A handle entry's flags: discarded. */
const DISCARDED = 0x40;

/** What `deref` finds behind a value (seg1 `8a83`). */
interface Found {
  /** The handle, or nought for a fixed block's pointer. */
  handle: number;
  /** The block's bytes' address; nought for none. */
  pointer: number;
  /** Its arena. */
  arena: number;
  /** For a handle, its lock count in the high byte and 40h for a discarded block; else nought. */
  state: number;
}

export class Heap {
  /** Where the heap's segment is in the machine's memory. */
  mirror: { memory: any; base: number } | null = null;

  /** The segment's bytes where there is no machine: a test's heap. */
  #own: Uint8Array | null = null;

  /** The descriptor index of its segment. */
  segment = 0;

  /** Whether the heap may grow: the local heap of a moveable data segment, or of a block of `GlobalAlloc`'s. */
  declare growable: boolean;

  /** Told the segment's new size when it grows or shrinks. */
  declare onGrow: ((end: number) => void) | undefined;

  declare _segmentSize: number | undefined;

  /* The segment's bytes. */

  read8(at: number): number {
    at &= 0xffff;

    if (this.mirror) {
      return this.mirror.memory.read8(this.mirror.base + at);
    }

    return (this.#own ??= new Uint8Array(0x10000))[at];
  }

  write8(at: number, value: number) {
    at &= 0xffff;

    if (this.mirror) {
      this.mirror.memory.write8(this.mirror.base + at, value & 0xff);
      return;
    }

    (this.#own ??= new Uint8Array(0x10000))[at] = value & 0xff;
  }

  read16(at: number): number {
    return this.read8(at) | (this.read8(at + 1) << 8);
  }

  write16(at: number, value: number) {
    this.write8(at, value);
    this.write8(at + 1, value >> 8);
  }

  /** Where the heap's information is: DS:6. */
  get info(): number {
    return this.read16(6);
  }

  #get(field: number) {
    return this.read16(this.info + field);
  }

  #set(field: number, value: number) {
    this.write16(this.info + field, value & 0xffff);
  }

  /**
   * A request's span rounded as KERNEL rounds one (seg1 `8a68`): ten bytes
   * at least, up to four; FFFCh for one that overflowed, `carry`.
   */
  static round(span: number, carry = false): number {
    let bx = carry || span > 0xffff ? 0xfffc : span;

    if (bx < 0xa) {
      bx = 0xa;
    }

    const dx = (bx + 3) & 0xfffc;

    return dx < bx ? 0xfffc : dx;
  }

  /**
   * Where `LocalInit` lays a heap from `start` to `end` out (seg2
   * `28e3`-`2957`): its first arena at `start`, rounded; then an arena of
   * the heap's own, four bytes and the 2Ah of its information; the free
   * block after that, rounded; and the last arena ten bytes short of `end`,
   * rounded down to four. Nothing where they do not fit.
   */
  static layout(start: number, end: number): { first: number; free: number; last: number } | null {
    const first = Heap.round(start);
    const arena = Heap.round(first + 0xa);

    if (arena >= end) {
      return null;
    }

    const free = Heap.round(arena + 4 + 0x2a);
    const last = (end - 0xa) & 0xfffc;

    return last > free ? { first, free, last } : null;
  }

  /**
   * `LocalInit` (seg2 `28e3`-`29b5`): the bytes from the information to
   * `end` made nought, the information written, DS:6 pointed at it, and the
   * four arenas made -- the first and the last, KERNEL's, the information's,
   * and one free block between. False where they do not fit.
   */
  init(start: number, end: number): boolean {
    const first = Heap.round(start);
    const arena = Heap.round(first + 0xa);
    const info = arena + 4;

    if (arena >= end) {
      return false;
    }

    for (let at = info, words = ((end - info) & 0xffff) >> 1; words > 0; words--, at += 2) {
      this.write16(at, 0);
    }

    const free = Heap.round(info + 0x2a);

    this.write8(info + INFO.delta, 0x20);
    this.write8(info + INFO.arenas, 4);
    this.write16(info + INFO.first, first);
    /* KERNEL's own notify procedure, `8de2` in its first code segment: its
     * offset; the segment, KERNEL's code, winbox.js has none of, and is
     * left nought. */
    this.write16(info + INFO.notify, 0x8de2);
    this.write16(info + INFO.tableProc, 0x8a41);
    this.write16(info + INFO.extra, 0x200);
    this.write16(info + INFO.signature, 0x484c);

    const last = (end - 0xa) & 0xfffc;

    if (last <= free) {
      return false;
    }

    this.write16(info + INFO.last, last);
    this.write16(6, info);

    this.write16(first, first + 1);
    this.write16(first + 2, arena);
    this.write16(first + 6, first);
    this.write16(first + 8, free);
    this.write16(first + 4, 0xa);

    this.write16(arena, first + 1);
    this.write16(arena + 2, free);

    this.write16(free, arena);
    this.write16(free + 2, last);
    this.write16(free + 6, first);
    this.write16(free + 8, last);
    this.write16(free + 4, last - free);

    this.write16(last + 2, last);
    this.write16(last, free + 1);
    this.write16(last + 6, free);
    this.write16(last + 8, last);
    this.write16(last + 4, 0xa);

    this.write16(info + INFO.span, last + 0xa - first);

    return true;
  }

  /* The free list. */

  /** An arena put in the free list after `after`, or where it falls by address (seg1 `9386`); its size set. */
  #insertFree(arena: number, after = 0) {
    let si = after;

    if (!si) {
      si = this.#get(INFO.first);

      for (let guard = 0; guard < 0x8000; guard++) {
        const next = this.read16(si + 8);

        if (arena < next) {
          break;
        }

        si = next;
      }
    }

    const di = this.read16(si + 8);

    this.write16(arena + 8, di);
    this.write16(si + 8, arena);
    this.write16(arena + 6, si);
    this.write16(di + 6, arena);
    this.write16(arena + 4, this.read16(arena + 2) - arena);
  }

  /** An arena taken out of the free list (seg1 `93bc`). */
  #removeFree(arena: number) {
    const before = this.read16(arena + 6);
    const after = this.read16(arena + 8);

    this.write16(before + 8, after);
    this.write16(after + 6, before);
  }

  /**
   * The arena after `arena` joined to it (seg1 `923a`): taken out of the
   * free list if it was free, and `arena`'s size set if it is free. The
   * arena after the one joined.
   */
  #join(arena: number, next: number): number {
    this.#set(INFO.arenas, this.#get(INFO.arenas) - 1);

    const after = this.read16(next + 2);

    this.write16(after, (this.read16(after) & 3) | arena);
    this.write16(arena + 2, after);

    if (!(this.read16(next) & 1)) {
      this.#removeFree(next);
    }

    if (!(this.read16(arena) & 1)) {
      this.write16(arena + 4, after - arena);
    }

    return after;
  }

  /** Bytes made nought from `from` to `to` (seg1 `926f`), a word at a time. */
  #zero(from: number, to: number) {
    if (from >= to) {
      return;
    }

    for (let words = (to - from) >> 1, at = from; words > 0; words--, at += 2) {
      this.write16(at, 0);
    }
  }

  /**
   * A block's arena freed (seg1 `9347`): put in the free list, its flags
   * cleared, and joined to a free arena after it and before it. The handle
   * it held, for a moveable block; else nought.
   */
  #freeArena(arena: number): number {
    if (!arena) {
      return 0;
    }

    const held = this.read16(arena + 4);

    this.#insertFree(arena);

    const flags = this.read16(arena) & 3;

    this.write16(arena, this.read16(arena) ^ flags);

    const handle = flags & 2 ? held : 0;
    const next = this.read16(arena + 2);

    if (!(this.read16(next) & 1)) {
      this.#join(arena, next);
    }

    const before = this.read16(arena);

    if (!(this.read16(before) & 1)) {
      this.#join(before, arena);
    }

    return handle;
  }

  /* Placing a block. */

  /**
   * Splits the free arena `lower` at `upper` (seg1 `930b`-`9328`): `upper`
   * a new arena from there to where `lower` ended, put in the free list
   * after `lower`; `lower`'s size set.
   */
  #split(lower: number, upper: number) {
    const next = this.read16(lower + 2);

    this.write16(lower + 2, upper);
    this.write16(upper, lower);
    this.write16(upper + 2, next);
    this.write16(next, (this.read16(next) & 3) | upper);
    this.#set(INFO.arenas, this.#get(INFO.arenas) + 1);
    this.#insertFree(upper, lower);
    this.write16(lower + 4, upper - lower);
  }

  /**
   * A block of `size` bytes with `flags` (seg1 `9283`): a fixed one at the
   * bottom of the first free block it fits, walking up the free list; a
   * moveable one at the top of the last, walking down. A free block that
   * would keep too little is given whole: a fixed block's where 16 bytes or
   * less would be left, a moveable one's where less than 16. With no free
   * block that fits, the heap is compacted, and the block put in the
   * largest free block; failing that, the notify procedure is told, and
   * where it grew the heap, all is tried again. The block's bytes' address,
   * or nought.
   */
  #alloc(flags: number, size: number): number {
    for (;;) {
      const moveable = !!(flags & LMEM_MOVEABLE);
      const header = moveable ? 6 : 4;
      const dx = Heap.round(size + header, size + header > 0xffff);
      let bx = 0;

      if (!moveable) {
        let at = this.#get(INFO.first);

        for (let guard = 0; guard < 0x8000; guard++) {
          const next = this.read16(at + 8);

          if (next === at) {
            break;
          }

          at = next;

          if (dx <= this.read16(at + 4)) {
            bx = at;
            break;
          }
        }
      } else {
        let at = this.#get(INFO.last);

        for (let guard = 0; guard < 0x8000; guard++) {
          const before = this.read16(at + 6);

          if (before === at) {
            break;
          }

          at = before;

          if (dx <= this.read16(at + 4)) {
            bx = at;
            break;
          }
        }
      }

      if (!bx) {
        const { largest, best } = this.#compact(dx);

        if (largest < dx) {
          if (this.#outOfMemory(largest, dx)) {
            continue;
          }

          return 0;
        }

        bx = best;
      }

      let block: number;

      if (!moveable) {
        const upper = (bx + dx) & 0xffff;

        if (upper < ((this.read16(bx + 2) - 0x10) & 0xffff)) {
          this.#split(bx, upper);
        }

        block = bx;
      } else {
        const left = (this.read16(bx + 4) - dx) & 0xffff;

        if (left < 0x10) {
          block = bx;
        } else {
          block = (bx + left) & 0xffff;
          this.#split(bx, block);
        }
      }

      this.#removeFree(block);

      const pointer = (block + header) & 0xffff;

      this.write16(block, this.read16(block) | 1);

      if (flags & LMEM_ZEROINIT) {
        this.#zero(pointer, this.read16(block + 2));
      }

      return pointer;
    }
  }

  /**
   * The default notify procedure told the heap is out of room (seg1
   * `8de2`-`8e9d`): it refuses where the segment's size, less the largest
   * free block, with the block and 18h, passes 64 KiB; else it gives the
   * segment the block and 218h more, 200h of them the heap's own, no more
   * than FFF0h, by `GlobalReAlloc`, which rounds up to 32 bytes; and the
   * last arena moves to ten bytes short of the new end, at a four-byte
   * boundary, 64 KiB counting as FFFFh, the old last arena freed into the
   * free block before it. Whether it grew.
   */
  #outOfMemory(largest: number, needed: number): boolean {
    if (!this.growable) {
      return false;
    }

    const size = this.segmentSize;

    if (size >= 0x10000 || size - largest + needed + 0x18 > 0xffff) {
      return false;
    }

    let asked = size - largest + needed + 0x18 + this.#get(INFO.extra) + largest;

    if (asked > 0xfff0) {
      asked = 0xfff0;
    }

    const grown = Math.min((asked + 31) & ~31, 0x10000);
    const end = Math.min(grown, 0xffff);
    const bx = (end - 0xa) & 0xfffc;
    const si = this.#get(INFO.last);

    if (bx <= si) {
      return false;
    }

    this.segmentSize = grown;
    this.onGrow?.(grown);

    this.write16(bx + 2, bx);
    this.write16(bx, si | 1);
    this.write16(si + 2, bx);

    const before = this.read16(si + 6);

    this.write16(bx + 6, before);
    this.write16(bx + 8, bx);
    this.write16(bx + 4, 0xa);
    this.write16(before + 8, bx);
    this.#set(INFO.last, bx);
    this.#set(INFO.arenas, this.#get(INFO.arenas) + 1);
    this.#freeArena(si);

    return true;
  }

  /* Compaction. */

  /**
   * A block's bytes moved up into the free arena `free` (seg1 `8eae`): to
   * its top where it is the block's own next, or where the block and 16
   * bytes more fit; else to its bottom, taking it whole. The block's old
   * arena, its new arena, and the end of the free arena.
   */
  #move(arena: number, free: number) {
    const span = (this.read16(arena + 2) - arena) & 0xffff;
    const end = this.read16(free + 2);
    const after = (arena + span) & 0xffff;
    let to = end;

    if (after !== free && ((end - span - 0x10) & 0xffff) < free) {
      to = (free + span) & 0xffff;
    }

    const from = after;

    for (let words = span >> 1, step = 2; words > 0; words--, step += 2) {
      this.write16(to - step, this.read16(from - step));
    }

    return { old: arena, moved: (to - span) & 0xffff, end };
  }

  /**
   * The largest moveable, unlocked block below the free arena `free` that
   * fits in it (seg1 `8ee2`), looking at `count` arenas from `free` down;
   * nought for none. Of two the same size, the higher.
   */
  #fitting(free: number, count: number): number {
    const room = (this.read16(free + 2) - free) & 0xffff;
    let best = 0;
    let bx = free;

    for (; count > 0; count--) {
      const word = this.read16(bx);

      if (word & 1 && word & 2 && this.read8(this.read16(bx + 4) + 3) === 0) {
        const span = (this.read16(bx + 2) - bx) & 0xffff;

        if (span <= room && (!best || span + best > this.read16(best + 2))) {
          best = bx;
        }
      }

      bx = this.read16(bx) & 0xfffc;
    }

    return best;
  }

  /**
   * The next discardable handle of the level being discarded, after
   * `handle` (seg1 `3767`): one not free, not discarded, of the level in
   * the information, and not locked. `count` is how many entries are left
   * in the table being looked through, as the routine keeps it in CX.
   */
  #discardable(state: { handle: number; count: number }): boolean {
    let si = state.handle;
    let cx = state.count;
    const level = this.read8(this.info + INFO.level);

    if (si) {
      si += 4;
      cx--;
    } else {
      si = this.#get(INFO.tables);

      if (!si) {
        return false;
      }

      cx = this.read16(si);
      si += 2;
    }

    for (let guard = 0; guard < 0x10000; guard++) {
      if (cx === 0) {
        si = this.read16(si);

        if (!si) {
          state.handle = 0;
          return false;
        }

        cx = this.read16(si);
        si += 2;
        continue;
      }

      const word = this.read16(si + 2);

      if (
        word !== 0xffff &&
        (level === 0 || (!(word & DISCARDED) && (word & 0xf) === level && !(word >> 8)))
      ) {
        state.handle = si;
        state.count = cx;
        return true;
      }

      si += 4;
      cx--;
    }

    return false;
  }

  /**
   * The heap compacted for a block of `dx` bytes, its arena and all (seg1
   * `8f25`-`9024`). Walking down from the last arena, each free block is
   * filled from below, unless a caller asked for no compaction: the
   * moveable, unlocked block just below it slid up to its top, or else the
   * largest such block below that fits moved into it. Where the largest
   * free block is still too small, discardable blocks are discarded, the
   * highest level first, and the heap compacted again. The largest free
   * block's size and its arena.
   */
  #compact(dx: number): { largest: number; best: number } {
    const I = this.info;

    this.write16(I + INFO.pass, 0x1001);

    if (this.read16(I + INFO.noCompact) !== 0) {
      this.write8(I + INFO.pass, this.read8(I + INFO.pass) - 1);
    }

    for (;;) {
      let best = 0;
      let bx = this.read16(I + INFO.last);
      let cx = this.read16(I + INFO.arenas);

      do {
        const ax = this.read16(bx);

        if (ax & 1) {
          bx = ax & 0xfffc;
          continue;
        }

        /* `bx` is free. */
        if (this.read16(I + INFO.noCompact) === 0) {
          const below = ax;
          const slides = this.read8(below) & 2 && this.read8(this.read16(below + 4) + 3) === 0;

          if (slides) {
            this.#removeFree(bx);

            const { old, moved, end } = this.#move(below, bx);

            this.write16(moved, old | 3);
            this.write16(moved + 2, end);
            this.write16(end, (this.read16(end) & 3) | moved);
            this.write16(old + 2, moved);
            this.write8(old, this.read8(old) & 0xfc);
            this.#insertFree(old);
            this.write16(this.read16(moved + 4), moved + 6);

            /* Joined to a free block below, the walk goes on from the
             * arena after it, the block moved (`923a` leaves BX there). */
            bx = old;

            const before = this.read16(bx);

            if (!(this.read8(before) & 1)) {
              bx = this.#join(before, bx);
            }

            continue;
          }

          const found = this.#fitting(bx, cx);

          if (found) {
            const kept = this.read16(bx);

            this.#removeFree(bx);

            const { old, moved, end } = this.#move(found, bx);
            const split = bx !== moved;

            if (split) {
              this.write16(bx + 2, moved);
            }

            this.write16(moved, (split ? bx : kept) | 3);
            this.write16(moved + 2, end);
            this.write16(end, (this.read16(end) & 3) | moved);

            if (split) {
              this.#insertFree(bx);
              cx = (cx + 1) & 0xffff;
              this.#set(INFO.arenas, this.#get(INFO.arenas) + 1);
            }

            this.write16(this.read16(moved + 4), moved + 6);
            this.write8(old, this.read8(old) & 0xfd);

            const before = this.#get(INFO.arenas);

            this.#freeArena(old);
            cx = (cx - ((before - this.#get(INFO.arenas)) & 0xffff)) & 0xffff;
            bx = this.read16(moved) & 0xfffc;
            continue;
          }
        }

        /* The largest free block so far (`9006`). */
        if (best !== bx && !(this.read16(bx) & 1)) {
          if (!best || this.read16(bx + 2) > ((this.read16(best + 2) - best + bx) & 0xffff)) {
            best = bx;
          }
        }

        bx = this.read16(bx) & 0xfffc;
      } while ((cx = (cx - 1) & 0xffff) !== 0);

      /* `8f4a`: the largest, and whether to discard. */
      for (;;) {
        if (!best) {
          return { largest: 0, best: 0 };
        }

        const largest = (this.read16(best + 2) - best) & 0xffff;
        const pass = ((this.read8(I + INFO.pass) - 1) << 24) >> 24;

        this.write8(I + INFO.pass, pass);

        if (pass < 0 || largest >= dx) {
          return { largest, best };
        }

        const level = (this.read8(I + INFO.level) - 1) & 0xff;

        this.write8(I + INFO.level, level);

        if (level === 0) {
          continue;
        }

        this.write8(I + INFO.pass, this.read8(I + INFO.pass) + 1);

        const state = { handle: 0, count: 0 };

        while (this.#discardable(state)) {
          const handle = state.handle;

          this.#freeArena(this.read16(handle) - 6);
          this.write16(handle, 0);
          this.write8(handle + 2, this.read8(handle + 2) | DISCARDED);
          this.write8(I + INFO.pass, this.read8(I + INFO.pass) | 0x80);
        }

        if (this.read8(I + INFO.pass) & 0x80) {
          this.write8(I + INFO.pass, this.read8(I + INFO.pass) ^ 0x80);
          break;
        }
      }
    }
  }

  /* Handles. */

  /**
   * A handle table of `count` entries (seg1 `8a41`): a fixed block of the
   * heap, its count, the entries each linked to the next and marked free,
   * and the first table's address after them; put first in the list of
   * tables. Its first entry, or nought.
   */
  #table(count: number): number {
    const block = this.#alloc(0, ((count + 1) * 4) & 0xffff);

    if (!block) {
      return 0;
    }

    const I = this.info;
    const was = this.read16(I + INFO.tables);

    this.write16(I + INFO.tables, block);
    this.write16(block, count);

    let at = block + 2;

    for (let n = count; n > 0; n--, at += 4) {
      this.write16(at, at + 4);
      this.write16(at + 2, 0xffff);
    }

    this.write16(at - 4, 0);
    this.write16(at, was);

    return block + 2;
  }

  /**
   * A free handle (seg1 `370c`): the first of the free list, a table made
   * for more where it is empty; its flags and lock count nought, and its
   * word `word`. Nought where no table could be made.
   */
  #handle(word: number): number {
    const I = this.info;
    let bx = this.read16(I + INFO.freeHandle);

    if (!bx) {
      const count = this.read16(I + INFO.delta);

      if (!count) {
        return 0;
      }

      bx = this.#table(count);

      if (!bx) {
        return 0;
      }
    }

    this.write16(bx + 2, 0);

    const next = this.read16(bx);

    this.write16(bx, word);
    this.write16(I + INFO.freeHandle, next);

    return bx;
  }

  /** A handle given back (seg1 `373b`): first in the free list. FFFFh for one that was free; else nought. */
  #freeHandle(handle: number): number {
    if (!handle) {
      return 0;
    }

    const was = this.read16(handle + 2);

    this.write16(handle + 2, 0xffff);

    if (was === 0xffff) {
      return 0xffff;
    }

    const I = this.info;

    this.write16(handle, this.read16(I + INFO.freeHandle));
    this.write16(I + INFO.freeHandle, handle);

    return 0;
  }

  /**
   * What a value stands for (seg1 `8a83`, `3754`): a value with bit 1 clear
   * is a fixed block's pointer, its arena four bytes before it at a
   * four-byte boundary; one with bit 1 set is a handle, whose word is its
   * block's address unless the entry is free or discarded.
   */
  deref(value: number): Found {
    value &= 0xffff;

    if (!(value & 2)) {
      return { handle: 0, pointer: value, arena: value ? (value & 0xfffc) - 4 : 0, state: 0 };
    }

    const word = this.read16(value + 2);

    if (word === 0xffff) {
      return { handle: value, pointer: 0, arena: 0, state: 0 };
    }

    const state = (word & 0xff00) | (word & DISCARDED);
    const pointer = state & DISCARDED ? 0 : this.read16(value);

    return { handle: value, pointer, arena: pointer ? (pointer - 6) & 0xffff : 0, state };
  }

  /* The functions. */

  /**
   * `LocalAlloc` (seg1 `8ab6`): a fixed block's pointer, or a moveable
   * block's handle -- an entry of a handle table, the block's arena keeping
   * its address, its flags its discard level from the flags' high byte. A
   * moveable block of nought bytes is a handle standing for a discarded
   * block; a fixed one, nought. Nought where there is no room.
   */
  localAlloc(flags: number, size: number): number {
    const I = this.info;

    if (flags & LMEM_NOCOMPACT) {
      this.#set(INFO.noCompact, this.#get(INFO.noCompact) + 1);
    }

    let answer = 0;

    if (size === 0) {
      if (flags & LMEM_MOVEABLE) {
        const handle = this.#handle(LMEM_MOVEABLE);

        if (handle) {
          this.write16(handle, 0);
          this.write8(handle + 2, this.read8(handle + 2) | DISCARDED);
          answer = handle;
        }
      }
    } else if (flags & LMEM_MOVEABLE) {
      const handle = this.#handle(flags);

      if (handle) {
        const pointer = this.#alloc(flags, size);

        if (!pointer) {
          this.#freeHandle(handle);
        } else {
          this.write16(handle, pointer);
          this.write16(pointer - 2, handle);
          this.write8(pointer - 6, this.read8(pointer - 6) | 2);

          const level = (flags >> 8) & 0xf;

          if (level) {
            this.write8(handle + 2, level);
          }

          answer = handle;
        }
      }
    } else {
      answer = this.#alloc(flags, size);
    }

    if (flags & LMEM_NOCOMPACT) {
      this.write16(I + INFO.noCompact, this.read16(I + INFO.noCompact) - 1);
    }

    return answer;
  }

  /**
   * `LocalFree` (seg1 `8cc7`): the block freed, if there is one, and the
   * handle given back. Nought; FFFFh for a handle already free. Neither
   * a lock nor a value that is no block's is looked at.
   */
  localFree(value: number): number {
    const found = this.deref(value);
    const handle = found.pointer ? this.#freeArena(found.arena) : found.handle;

    return this.#freeHandle(handle);
  }

  /** `LocalSize` (seg1 `8cef`): the next arena less the block's address; nought for no block. */
  localSize(value: number): number {
    const found = this.deref(value);

    return found.pointer ? (this.read16(found.arena + 2) - found.pointer) & 0xffff : 0;
  }

  /** `LocalFlags` (seg1 `8d06`): a handle's flags in the high byte, its lock count in the low; nought for a fixed block. */
  localFlags(value: number): number {
    const found = this.deref(value);

    if (!found.handle) {
      return 0;
    }

    const word = this.read16(found.handle + 2);

    return ((word & 0xff) << 8) | (word >> 8);
  }

  /**
   * `LocalLock` (seg1 `8d1f`): a fixed block's pointer as it is; for a
   * handle, its count up, no further than FFh, and its word -- nought for
   * a discarded block, whose count is left.
   */
  localLock(value: number): number {
    value &= 0xffff;

    if (!(value & 2)) {
      return value;
    }

    if (!(this.read8(value + 2) & DISCARDED)) {
      const count = (this.read8(value + 3) + 1) & 0xff;

      if (count) {
        this.write8(value + 3, count);
      }
    }

    return this.read16(value);
  }

  /**
   * `LocalUnlock` (seg1 `8d43`): a handle's count down, and what is left;
   * nought for a fixed block, a discarded one, and a count of nought or FFh,
   * which is left.
   */
  localUnlock(value: number): number {
    value &= 0xffff;

    if (!(value & 2)) {
      return 0;
    }

    const word = this.read16(value + 2);

    if (word & DISCARDED) {
      return 0;
    }

    const count = ((word >> 8) - 1) & 0xff;

    if (count >= 0xfe) {
      return 0;
    }

    this.write8(value + 3, count);

    /* As a signed byte, `cbw`. */
    return count & 0x80 ? count | 0xff00 : count;
  }

  /**
   * `LocalHandle` (seg1 `8d6a`): a value with bit 1 clear as it is, a fixed
   * block's pointer being its handle; one with it set, the word before it,
   * a moveable block's handle in its arena, if that handle holds the
   * value; else nought.
   */
  localHandle(value: number): number {
    value &= 0xffff;

    if (!(value & 2)) {
      return value;
    }

    const handle = this.read16(value - 2);

    return this.read16(handle) === value ? handle : 0;
  }

  /** `LocalCompact` (seg1 `8d85`): the heap compacted for `wanted` bytes, and its largest free block less six; nought for none. */
  localCompact(wanted: number): number {
    const { largest } = this.#compact(Heap.round(wanted & 0xffff));

    return largest ? (largest - 6) & 0xffff : 0;
  }

  /** `LocalHandleDelta` (seg2 `2a0c`): how many handles a table is made with, set where a number is given. */
  localHandleDelta(delta: number): number {
    if (delta) {
      this.#set(INFO.delta, delta);
    }

    return this.#get(INFO.delta);
  }

  /**
   * `LocalReAlloc` (seg1 `8b4b`):
   *
   * * `LMEM_MODIFY` sets a handle's discard level, from the flags' high
   *   byte, and answers the value.
   * * A discarded block is given a block of the size again, moveable.
   * * Nought, with `LMEM_MOVEABLE`, discards an unlocked moveable block:
   *   its handle stays, standing for nothing. A fixed block is freed, and
   *   nought answered. Locked, or without the flag, it fails.
   * * A block that shrinks, or stays, keeps its place; what it leaves
   *   becomes free where more than 16 bytes would be. Its rounding is ten
   *   bytes at least from its address, up to four.
   * * A block that grows into the free block after it stays, the bytes it
   *   gains nought with `LMEM_ZEROINIT`.
   * * Else it moves: a moveable block, or a fixed one with
   *   `LMEM_MOVEABLE`; a locked one only with it. A new block is made,
   *   compacting or growing the heap as `LocalAlloc` does, and the bytes
   *   copied to it. A fixed block without the flag fails.
   *
   * The handle or pointer; nought for a failure.
   */
  localReAlloc(value: number, size: number, flags: number): number {
    const I = this.info;

    value &= 0xffff;
    size &= 0xffff;

    if (flags & LMEM_NOCOMPACT) {
      this.#set(INFO.noCompact, this.#get(INFO.noCompact) + 1);
    }

    const answer = this.#reAlloc(value, size, flags);

    if (flags & LMEM_NOCOMPACT) {
      this.write16(I + INFO.noCompact, this.read16(I + INFO.noCompact) - 1);
    }

    return answer;
  }

  #reAlloc(value: number, size: number, flags: number): number {
    const found = this.deref(value);

    if (!found.pointer) {
      if (!(found.state & DISCARDED)) {
        return value;
      }

      const pointer = this.#alloc(LMEM_MOVEABLE | flags, size);

      if (!pointer) {
        return 0;
      }

      this.write8(found.handle + 2, this.read8(found.handle + 2) ^ DISCARDED);

      return this.#rehandle(found.handle, pointer);
    }

    if (flags & LMEM_MODIFY) {
      if (found.handle) {
        this.write8(
          found.handle + 2,
          (this.read8(found.handle + 2) & 0xe0) | ((flags >> 8) & 0x1f)
        );
      }

      return value;
    }

    const arena = found.arena;
    const carry = found.pointer + Math.max(size, 0xa) > 0xffff;
    const end = Heap.round((found.pointer + Math.max(size, 0xa)) & 0xffff, carry);
    let next = this.read16(arena + 2);

    if (size === 0) {
      if (found.state || !(flags & LMEM_MOVEABLE)) {
        return 0;
      }

      const handle = this.#freeArena(arena);

      if (!handle) {
        return 0;
      }

      this.write16(handle, 0);
      this.write8(handle + 2, this.read8(handle + 2) | DISCARDED);

      return value;
    }

    if (end > next) {
      if (!(this.read16(next) & 1) && end <= this.read16(next + 2)) {
        const from = next;

        next = this.#join(arena, next);

        if (flags & LMEM_ZEROINIT) {
          this.#zero(from, next);
        }
      } else {
        return this.#moveTo(found, value, size, flags);
      }
    }

    /* `8bf3`: shrunk, or the same. */
    if (end + 0x10 > 0xffff || end + 0x10 >= next) {
      return value;
    }

    const after = this.read16(arena + 2);

    this.write16(arena + 2, end);
    this.write16(end, arena);

    let si = after;
    const kept = this.read16(si) & 3;

    this.write16(si, kept);

    if (kept) {
      this.#set(INFO.arenas, this.#get(INFO.arenas) + 1);
    } else {
      this.#removeFree(si);
      si = this.read16(si + 2);
      this.write16(si, this.read16(si) & 3);
    }

    this.write16(si, this.read16(si) | end);
    this.write16(end + 2, si);
    this.#insertFree(end);

    return value;
  }

  /** A block moved to a new one of `size` bytes (seg1 `8c56`-`8caf`): its handle or new pointer, nought for none. */
  #moveTo(found: Found, value: number, size: number, flags: number): number {
    if (found.state && !(flags & LMEM_MOVEABLE)) {
      return 0;
    }

    let kind = flags | LMEM_MOVEABLE;

    if (!(value & 2)) {
      if (!(flags & LMEM_MOVEABLE)) {
        return 0;
      }

      kind ^= LMEM_MOVEABLE;
    }

    const length = (this.read16(found.arena + 2) - found.pointer) & 0xffff;
    const pointer = this.#alloc(kind, size);

    if (!pointer) {
      return 0;
    }

    /* Where the block is now: the compaction may have moved it. */
    const now = this.deref(value);

    for (let words = length >> 1, step = 0; words > 0; words--, step += 2) {
      this.write16(pointer + step, this.read16(now.pointer + step));
    }

    const handle = this.#freeArena(now.arena);

    if (!handle) {
      return pointer;
    }

    return this.#rehandle(handle, pointer);
  }

  /** A handle given a moveable block (seg1 `8ca8`): the handle's word, the arena's flag and its link back. */
  #rehandle(handle: number, pointer: number): number {
    this.write16(handle, pointer);
    this.write8(pointer - 6, this.read8(pointer - 6) | 2);
    this.write16(pointer - 2, handle);

    return handle;
  }

  /**
   * `LocalShrink` (seg1 `8db0`, `9093`): the heap compacted, discardable
   * blocks discarded, and blocks from its top moved into free blocks below
   * where they fit, then its end brought down to the last block, no lower
   * than `wanted` or the span `LocalInit` gave it, and its segment shrunk
   * with it. The heap's span after, from its first arena to past its last.
   */
  localShrink(wanted: number): number {
    const I = this.info;
    let floor = wanted & 0xffff;

    if (this.read16(I + INFO.span) > floor) {
      floor = this.read16(I + INFO.span);
    }

    const span = () => (this.read16(I + INFO.last) + 0xa - this.read16(I + INFO.first)) & 0xffff;

    if (span() > floor) {
      this.#compact(0xfffc);

      let si = this.read16(I + INFO.last);

      for (let guard = 0; guard < 0x8000; guard++) {
        si = this.read16(si) & 0xfffc;

        const word = this.read16(si);
        let stop = false;

        if (!(word & 1)) {
          this.#removeFree(si);
          this.write16(si, this.read16(si) | 1);
        } else if (!(word & 2) || this.read8(this.read16(si + 4) + 3) !== 0) {
          si = this.read16(si + 2);
          stop = true;
        } else {
          const length = (this.read16(si + 2) - si) & 0xffff;
          let free = this.#largeEnough(length);

          /* Not found: the heap compacted once more, and looked again
           * (`90dd`-`90ef`). */
          if (!free) {
            this.#compact(0xfffc);
            free = this.#largeEnough(length);
          }

          if (!free) {
            si = this.read16(si + 2);
            stop = true;
          } else {
            this.#removeFree(free);

            if (((this.read16(free + 2) - length - 0x10) & 0xffff) >= free) {
              const upper = free + length;
              const after = this.read16(free + 2);

              this.write16(upper, free);
              this.write16(upper + 2, after);
              this.write16(free + 2, upper);
              this.write16(after, (this.read16(after) & 3) | upper);
              this.#insertFree(upper, this.read16(free + 6));
              this.#set(INFO.arenas, this.#get(INFO.arenas) + 1);
            }

            this.write16(free, this.read16(free) | (this.read16(si) & 3));

            for (let step = 4; step < length; step += 2) {
              this.write16(free + step, this.read16(si + step));
            }

            this.write16(this.read16(si + 4), free + 6);
            this.write16(si, (this.read16(si) & 0xfffc) | 1);
          }
        }

        if (!stop) {
          const end = (si + 0xa - this.read16(I + INFO.first)) & 0xffff;

          if (end > floor) {
            continue;
          }
        }

        this.#cut(si, floor);
        break;
      }
    }

    this.#compact(0xfffc);

    return span();
  }

  /** A free block of `length` bytes or more, looking down from the top (seg1 `91af`); nought for none. */
  #largeEnough(length: number): number {
    let bx = this.read16(this.#get(INFO.last) + 6);

    for (let guard = 0; guard < 0x8000; guard++) {
      if (bx === this.read16(bx + 6)) {
        return 0;
      }

      if (length <= this.read16(bx + 4)) {
        return bx;
      }

      bx = this.read16(bx + 6);
    }

    return 0;
  }

  /**
   * The heap ended at `si` (seg1 `91cb`-`9238`): a free block left below
   * the new last arena where the span it may keep has more than 16 bytes
   * of room past `si`, the last arena made there, and the segment shrunk to
   * ten bytes past it.
   */
  #cut(si: number, floor: number) {
    const I = this.info;
    const last = this.read16(I + INFO.last);

    if (si === last) {
      return;
    }

    let count = 0;

    for (let at = si, guard = 0; at !== last && guard < 0x8000; guard++) {
      count++;
      at = this.read16(at + 2);
    }

    this.#set(INFO.arenas, this.#get(INFO.arenas) - count);

    const end = (si - this.read16(I + INFO.first) + 0xa) & 0xffff;

    if (end <= floor && floor - end > 0x10) {
      const room = Heap.round(floor - end);
      const upper = si + room;

      this.write16(si + 2, upper);
      this.write16(si, this.read16(si) & 0xfffc);
      this.#insertFree(si);
      this.#set(INFO.arenas, this.#get(INFO.arenas) + 1);
      this.write16(upper, si);
      si = upper;
    }

    this.write16(si + 2, si);
    this.write16(si, (this.read16(si) & 0xfffc) | 1);
    this.write16(si + 4, this.read16(last + 4));

    const before = this.read16(last + 6);

    this.write16(si + 6, before);
    this.write16(before + 8, si);
    this.write16(si + 8, si);
    this.#set(INFO.last, si);

    /* `GlobalReAlloc` of the segment to ten bytes past the new last
     * arena (`9182`-`919a`), which rounds up to 32 bytes. */
    const size = Math.min((si + 0xa + 31) & ~31, 0x10000);

    this.segmentSize = size;
    this.onGrow?.(size);
  }

  /* What winbox.js's own code asks of a heap. */

  /** A block, as `LocalAlloc` makes one: its pointer or handle, or null. */
  allocate(size: number, options: any = {}) {
    const flags = (options.movable ? LMEM_MOVEABLE : 0) | (options.zeroInit ? LMEM_ZEROINIT : 0);
    const block = this.localAlloc(flags, size & 0xffff);

    return block || null;
  }

  /** A block freed, its handle with it. */
  free(value: number) {
    this.localFree(value);
  }

  /** The size of the block behind a handle or a pointer. */
  sizeOf(value: number) {
    return this.localSize(value);
  }

  /** The address a handle stands for -- nought for a discarded block -- or a pointer as it is; nothing counted. */
  resolve(value: number) {
    return value & 2 ? this.deref(value).pointer : value;
  }

  /** Whether a value is a handle: bit 1 set, as KERNEL tells them. */
  isHandle(value: number) {
    return !!(value & 2);
  }

  /** What `LocalHandle` answers. */
  handleOf(value: number) {
    return this.localHandle(value);
  }

  /** A block given a new size, as `LocalReAlloc` gives it: its handle or pointer, or null. */
  reallocate(value: number, size: number, movableFlag: boolean, zeroInit = false) {
    const flags = (movableFlag ? LMEM_MOVEABLE : 0) | (zeroInit ? LMEM_ZEROINIT : 0);

    return this.localReAlloc(value, size, flags) || null;
  }

  /** The largest free block, as the compaction answers it, without moving anything: its size, its arena and all. */
  largestFree() {
    const I = this.info;
    let largest = 0;
    let at = this.read16(I + INFO.first);

    for (let guard = 0; guard < 0x8000; guard++) {
      const next = this.read16(at + 8);

      if (next === at) {
        break;
      }

      at = next;

      if (at !== this.read16(I + INFO.last)) {
        largest = Math.max(largest, (this.read16(at + 2) - at) & 0xffff);
      }
    }

    return largest;
  }

  /** The heap's span, from its first arena to past its last. */
  get byteLength() {
    const I = this.info;

    return (this.read16(I + INFO.last) + 0xa - this.read16(I + INFO.first)) & 0xffff;
  }

  /**
   * The size of the segment the heap is in, as `GlobalSize` would answer
   * it, which its growth goes by: where nothing has said, what its last
   * arena's place makes it, ten bytes and a rounding past it.
   */
  get segmentSize() {
    return this._segmentSize ?? this.read16(this.info + INFO.last) + 12;
  }

  set segmentSize(value) {
    this._segmentSize = value;
  }
}

export default Heap;
