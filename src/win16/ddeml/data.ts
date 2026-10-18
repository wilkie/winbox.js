'use strict';

import { D, W, buffer } from '../commdlg/api.js';
import { D_ARRAY_OWNED, Dd, hi, lo, long, plus } from './core.js';
import {
  DMLERR_INVALIDPARAMETER,
  DMLERR_MEMORY_ERROR,
  instanceOf,
  le16,
  le32,
} from './instance.js';
import { setError } from './monitor.js';

/**
 * DDEML's data handles: a handle the application holds is a far pointer to
 * six bytes of its instance's heap -- the instance, the handle's flags, the
 * global block -- and DDEML passes the last two about as one value,
 * `MAKELONG(flags, block)`. The blocks are `GMEM_DDESHARE`, with DDE's header
 * where the handle has an item (`14e8`-`19a0`, `63c6`-`699c`). As
 * `crates/winbox-win16/src/ddeml/data.rs`.
 */

export const APPOWNED = 0x0001;
export const NO_HEADER = 0x0100;
export const IN_CALLBACK = 0x4000;
export const SENT = 0x8000;

/** `63c6`: a block made for data, kept in the instance's handles: the value. */
export async function make(
  d: Dd,
  instance: number,
  flagsIn: number,
  format: number,
  item: number,
  offsetIn: number,
  size: number,
  source: number
): Promise<number> {
  let flags = flagsIn;
  let offset = offsetIn >>> 0;

  if (item !== 0) {
    offset = (offset + 4) >>> 0;
  } else {
    flags |= NO_HEADER;
  }

  const status = flags & APPOWNED ? 0x8000 : 0x2000;
  const block = await d.share((offset + size) >>> 0, status, format);

  if (block === 0) {
    await setError(d, instance, DMLERR_MEMORY_ERROR);
    return 0;
  }

  const value = long(flags, block);
  let [key, saved] = d.key(le32(value));
  let kept = (await d.arrayAdd(d.i32(instance, 0xc), key, 'second')) !== 0;

  d.release(saved);

  if (kept && flags & APPOWNED) {
    [key, saved] = d.key([
      ...le16(block),
      ...le16(d.i16(instance, 0x1e)),
      ...le16(1),
      ...le16(flags),
    ]);
    kept = (await d.arrayAdd(d.i32(0, D_ARRAY_OWNED), key, 'first')) !== 0;
    d.release(saved);
  }

  if (!kept) {
    await d.globalFree(block);
    await setError(d, instance, DMLERR_MEMORY_ERROR);
    return 0;
  }

  if (source !== 0) {
    const at = await d.globalLock(block);

    d.copy(source, d.huge(at, offset), size);
  }

  return value;
}

/** `64c4`: a value let go, freed where it has `fRelease` or the application's count came to nought. */
export async function free(d: Dd, instance: number, value: number, own: boolean) {
  const flags = lo(value);
  const block = hi(value);
  let release = false;

  if (flags & APPOWNED) {
    const [key, saved] = d.key(le16(block));
    const owned = await d.arrayFind(d.i32(0, D_ARRAY_OWNED), 'first', key, false);

    if (owned !== 0) {
      if (own && d.r16(plus(owned, 2)) === d.i16(instance, 0x1e)) {
        d.release(saved);
        return;
      }

      const count = (d.r16(plus(owned, 4)) - 1) & 0xffff;

      d.w16(plus(owned, 4), count);

      if (count !== 0) {
        d.release(saved);
        return;
      }

      await d.arrayFind(d.i32(0, D_ARRAY_OWNED), 'first', key, true);
      release = true;
    }

    d.release(saved);
  }

  if (block === 0) {
    return;
  }

  const [key, saved] = d.key(le32(value));
  const found = await d.arrayFind(d.i32(instance, 0xc), 'second', key, true);

  d.release(saved);

  if (found === 0) {
    return;
  }

  let format = 0;

  if (flags & NO_HEADER) {
    release ||= (flags & APPOWNED) === 0;
  } else {
    const at = await d.globalLock(block);

    release ||= (d.r8(plus(at, 1)) & 0x20) !== 0;
    format = d.r16(plus(at, 2));
    await d.globalUnlock(block);
  }

  if (!release) {
    return;
  }

  if (flags & NO_HEADER) {
    await d.globalFree(block);
    return;
  }

  await freeBlock(d, block, format);
}

/** `65b8`: a value made ready to post, marked sent and kept in the instance's handles. */
export async function prepare(d: Dd, conv: number, valueIn: number): Promise<number> {
  const flags = lo(valueIn);
  const local = (d.r8(plus(conv, 0x20)) & 4) !== 0;
  let value = valueIn >>> 0;

  if ((!local && flags & APPOWNED) || (flags & IN_CALLBACK && (flags & APPOWNED) === 0)) {
    value = await copyValue(d, d.r16(conv), hi(value), flags);
  }

  value = (value | SENT) >>> 0;

  const instance = d.r16(conv);
  const [key, saved] = d.key(le32(value));

  await d.arrayAdd(d.i32(instance, 0xc), key, 'second');
  d.release(saved);
  return value;
}

/** `6610`: a value given away out of the instance's handles, but the application's. */
export async function giveAway(d: Dd, instance: number, value: number) {
  if ((lo(value) & APPOWNED) === 0) {
    const [key, saved] = d.key(le32(value));

    await d.arrayFind(d.i32(instance, 0xc), 'second', key, true);
    d.release(saved);
  }
}

/** `6636`: a block received made a read-only value kept in the instance's handles. */
export async function wrap(
  d: Dd,
  instance: number,
  block: number,
  flagsIn: number
): Promise<number> {
  if (block === 0) {
    return 0;
  }

  let flags = flagsIn;
  const [key, saved] = d.key(le16(block));
  const owned = await d.arrayFind(d.i32(0, D_ARRAY_OWNED), 'first', key, false);

  d.release(saved);

  if (owned !== 0) {
    flags |= d.r16(plus(owned, 6));
    d.w16(plus(owned, 4), d.r16(plus(owned, 4)) + 1);
  }

  const at = await d.globalLock(block);

  if ((d.r8(plus(at, 1)) & 0x20) === 0) {
    flags |= APPOWNED;
  }

  await d.globalUnlock(block);

  const value = long(flags | SENT, block);
  const [k2, s2] = d.key(le32(value));

  await d.arrayAdd(d.i32(instance, 0xc), k2, 'second');
  d.release(s2);
  return value;
}

/** `66c2`: a block copied into a new one of `GMEM_DDESHARE`. */
async function copyBlock(d: Dd, block: number): Promise<number> {
  const size = await d.globalSize(block);
  const from = await d.globalLock(block);

  if (from === 0) {
    return 0;
  }

  const copy = await d.globalAlloc(0x2000, size);
  const to = await d.globalLock(copy);

  d.copy(from, to, size);
  await d.globalUnlock(copy);
  return copy;
}

/** `671e`: a bitmap copied, through two memory contexts compatible with the instance's window's. */
async function copyBitmap(d: Dd, bitmap: number, instance: number): Promise<number> {
  const called = await d.callB('GDI', 'GetObject', [W(bitmap), W(0xe), buffer(0xe)]);

  if ((called.value & 0xffff) === 0) {
    return 0;
  }

  const object = called.buffers[0];
  const width = object[2] | (object[3] << 8);
  const height = object[4] | (object[5] << 8);
  const window = d.i16(instance, 0x22);
  const dc = (await d.user('GetDC', [W(window)])) & 0xffff;

  if (dc === 0) {
    return 0;
  }

  let made = 0;
  const from = (await d.call('GDI', 'CreateCompatibleDC', [W(dc)])) & 0xffff;

  if (from !== 0) {
    const to = (await d.call('GDI', 'CreateCompatibleDC', [W(dc)])) & 0xffff;

    if (to !== 0) {
      const oldFrom = (await d.call('GDI', 'SelectObject', [W(from), W(bitmap)])) & 0xffff;

      made =
        (await d.call('GDI', 'CreateCompatibleBitmap', [W(from), W(width), W(height)])) & 0xffff;

      if (made !== 0) {
        const oldTo = (await d.call('GDI', 'SelectObject', [W(to), W(made)])) & 0xffff;

        await d.call('GDI', 'BitBlt', [
          W(to),
          W(0),
          W(0),
          W(width),
          W(height),
          W(from),
          W(0),
          W(0),
          D(0x00cc0020),
        ]);
        await d.call('GDI', 'SelectObject', [W(from), W(oldFrom)]);
        await d.call('GDI', 'SelectObject', [W(to), W(oldTo)]);
      }

      await d.call('GDI', 'DeleteDC', [W(to)]);
    }

    await d.call('GDI', 'DeleteDC', [W(from)]);
  }

  await d.user('ReleaseDC', [W(window), W(dc)]);
  return made;
}

/** `67fc`: a value's block copied, `fRelease` set in the copy and its objects copied with it. */
export async function copyValue(d: Dd, instance: number, block: number, flags: number) {
  if (block === 0) {
    return long(flags, block);
  }

  const copy = await copyBlock(d, block);

  if (copy === 0) {
    return 0;
  }

  if ((flags & NO_HEADER) === 0) {
    const at = await d.globalLock(copy);

    if (at !== 0) {
      d.w8(plus(at, 1), d.r8(plus(at, 1)) | 0x20);

      switch (d.r16(plus(at, 2))) {
        case 2:
        case 0x82:
          d.w16(plus(at, 4), await copyBitmap(d, d.r16(plus(at, 4)), instance));
          break;
        case 3:
        case 0x83: {
          const picture = await copyBlock(d, d.r16(plus(at, 4)));

          d.w16(plus(at, 4), picture);

          if (picture !== 0) {
            const inner = await d.globalLock(picture);

            if (inner !== 0) {
              const metafile =
                (await d.call('GDI', 'CopyMetaFile', [W(d.r16(plus(inner, 6))), D(0)])) & 0xffff;

              d.w16(plus(inner, 6), metafile);
              await d.globalUnlock(picture);
            }

            await d.globalUnlock(picture);
          }

          break;
        }
        case 8:
          d.w16(plus(at, 4), await copyBlock(d, d.r16(plus(at, 4))));
          break;
      }

      await d.globalUnlock(copy);
    }
  }

  const value = long(flags & 0xbffe, copy);
  const [key, saved] = d.key(le32(value));

  await d.arrayAdd(d.i32(instance, 0xc), key, null);
  d.release(saved);
  return value;
}

/** `691a`: a block freed, the object of a bitmap, a DIB or a metafile picture deleted first. */
export async function freeBlock(d: Dd, block: number, format: number) {
  const at = await d.globalLock(block);

  if (at === 0) {
    return;
  }

  switch (format) {
    case 2:
    case 8:
    case 0x82:
      await d.call('GDI', 'DeleteObject', [W(d.r16(plus(at, 4)))]);
      break;
    case 3:
    case 0x83: {
      const picture = d.r16(plus(at, 4));
      const inner = await d.globalLock(picture);

      if (inner !== 0) {
        await d.call('GDI', 'DeleteObject', [W(d.r16(plus(inner, 6)))]);
      }

      await d.globalUnlock(picture);
      await d.globalFree(picture);
      break;
    }
  }

  await d.globalFree(block);
}

/** `DdeCreateDataHandle` (`14e8`). */
export async function createDataHandle(
  d: Dd,
  id: number,
  source: number,
  size: number,
  offset: number,
  item: number,
  format: number,
  flags: number
) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (flags & 0xfffe) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const value = await make(d, instance, flags, format, lo(item), offset, size, source);

  if (value === 0) {
    return 0;
  }

  const record = await d.alloc(d.i16(instance, 0x20), 6);

  if (record !== 0) {
    d.w16(record, instance);
    d.w32(plus(record, 2), value);
  }

  return record;
}

/** `DdeAddData` (`1598`). */
export async function addData(
  d: Dd,
  handle: number,
  source: number,
  size: number,
  offsetIn: number
) {
  const instance = d.r16(handle);
  let value = d.r32(plus(handle, 2));

  d.si16(instance, 0x2a, 0);

  let bad = hi(value) === 0 || (lo(value) & SENT) !== 0;

  if (!bad) {
    const [key, saved] = d.key(le32(value));
    const found = await d.arrayFind(d.i32(instance, 0xc), 'second', key, false);

    d.release(saved);
    bad = found === 0 || (d.r8(plus(found, 1)) & 0x80) !== 0;
  }

  if (bad) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  let offset = offsetIn >>> 0;

  if ((lo(value) & NO_HEADER) === 0) {
    offset = (offset + 4) >>> 0;
  }

  const block = hi(value);
  const current = await d.globalSize(block);
  const needed = (offset + size) >>> 0;

  if (needed > current) {
    let grown = (await d.kernel('GlobalReAlloc', [W(block), D(needed), W(2)])) & 0xffff;

    if (grown === 0) {
      grown = await d.globalAlloc(0x2002, needed);

      if (grown === 0) {
        await setError(d, instance, DMLERR_MEMORY_ERROR);
        return 0;
      }

      const from = await d.globalLock(block);
      const to = await d.globalLock(grown);

      d.copy(from, to, await d.globalSize(block));
      await d.globalFree(block);
    }

    if (grown !== block) {
      let [key, saved] = d.key(le32(value));
      const found = await d.arrayFind(d.i32(instance, 0xc), 'second', key, true);

      d.release(saved);

      if (found !== 0) {
        [key, saved] = d.key(le16(block));

        const owned = await d.arrayFind(d.i32(0, D_ARRAY_OWNED), 'first', key, false);
        let storedFlags = 0;

        if (owned !== 0) {
          storedFlags = d.r16(plus(owned, 6));

          const record = [
            ...le16(grown),
            ...le16(d.r16(plus(owned, 2))),
            ...le16(d.r16(plus(owned, 4))),
            ...le16(storedFlags),
          ];

          await d.arrayFind(d.i32(0, D_ARRAY_OWNED), 'first', key, true);

          const [r, s] = d.key(record);

          await d.arrayAdd(d.i32(0, D_ARRAY_OWNED), r, null);
          d.release(s);
        }

        d.release(saved);

        const [r, s] = d.key(le32(long(storedFlags, grown)));

        await d.arrayAdd(d.i32(instance, 0xc), r, 'second');
        d.release(s);
      }

      value = long(lo(value), grown);
    }
  }

  if (source !== 0) {
    const at = await d.globalLock(hi(value));

    d.copy(source, d.huge(at, offset), size);
  }

  d.w32(plus(handle, 2), value);
  return handle;
}

/** `DdeGetData` (`17a8`). */
export async function getData(d: Dd, handle: number, out: number, most: number, offsetIn: number) {
  const instance = d.r16(handle);
  const value = d.r32(plus(handle, 2));

  d.si16(instance, 0x2a, 0);

  const size = await d.globalSize(hi(value));
  const header = (lo(value) & NO_HEADER) === 0;
  let offset = offsetIn >>> 0;

  if (header) {
    offset = (offset + 4) >>> 0;
  }

  if (offset >= size) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const count = Math.min(size - offset, most >>> 0);

  if (out === 0) {
    return header ? (size - 4) >>> 0 : size;
  }

  const at = await d.globalLock(hi(value));

  d.copy(d.huge(at, offset), out, count);
  return count;
}

/** `DdeAccessData` (`188a`). */
export async function accessData(d: Dd, handle: number, size: number) {
  const instance = d.r16(handle);
  const value = d.r32(plus(handle, 2));

  d.si16(instance, 0x2a, 0);

  if (hi(value) === 0) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const skip = lo(value) & NO_HEADER ? 0 : 4;

  if (size !== 0) {
    d.w32(size, ((await d.globalSize(hi(value))) - skip) >>> 0);
  }

  return plus(await d.globalLock(hi(value)), skip);
}

/** `DdeUnaccessData` (`1916`). */
export async function unaccessData(d: Dd, handle: number) {
  d.si16(d.r16(handle), 0x2a, 0);
  await d.globalUnlock(d.r16(plus(handle, 4)));
  return 1;
}

/** `DdeFreeDataHandle` (`1946`): a handle handed to a callback is left. */
export async function freeDataHandle(d: Dd, handle: number) {
  if (handle === 0) {
    return 1;
  }

  d.si16(d.r16(handle), 0x2a, 0);

  if ((d.r8(plus(handle, 3)) & 0x40) === 0) {
    await free(d, d.r16(handle), d.r32(plus(handle, 2)), false);
    await d.free(handle);
  }

  return 1;
}
