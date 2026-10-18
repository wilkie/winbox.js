'use strict';

import { D_ARRAY_SENT, D_MONITORS, Dd, hi, lo, long, plus } from './core.js';
import { onTerminate, postDde } from './conv.js';
import { copyValue, free as freeValue, freeBlock, giveAway, make, prepare, wrap } from './data.js';
import {
  DMLERR_INVALIDPARAMETER,
  DMLERR_MEMORY_ERROR,
  DMLERR_NO_CONV_ESTABLISHED,
  callback,
  convValid,
  errorEach,
  instanceOf,
  le16,
  le32,
  modalLoop,
  queueCallback,
} from './instance.js';
import { addCount, convOf, deleteAtom, linkNotice, setError } from './monitor.js';

/**
 * DDEML's transactions: `DdeClientTransaction` and what it sends and waits
 * for (`3672`, `3886`, `4356`), the client's window's answers (`4866`,
 * `4b8e`, `4c6a`), the server's window turning messages into callbacks
 * (`3a68`) and their answers into replies (`3fa0`), advise links and
 * `DdePostAdvise` (`3e64`), and abandoning (`1bf0`, `1cb6`), as `DDEML.DLL`
 * seg1 has them. As `crates/winbox-win16/src/ddeml/xact.rs`.
 */

const DMLERR_NOTPROCESSED = 0x4009;
const DMLERR_POSTMSG_FAILED = 0x400c;
const DMLERR_SERVER_DIED = 0x400e;
const DMLERR_UNFOUND_QUEUE_ID = 0x4011;

function filter(d: Dd, kind: number): number {
  return d.r32(d.near(0xa6 + ((kind & 0xf0) >> 2)));
}

/** `DdeClientTransaction` (`1204`), its parameters laid out below the stack as its frame. */
export async function clientTransaction(
  d: Dd,
  data: number,
  size: number,
  hconv: number,
  item: number,
  format: number,
  kind: number,
  timeout: number,
  result: number
): Promise<number> {
  const [params, saved] = d.reserve(0x1c);

  d.w32(params, result);
  d.w32(plus(params, 4), timeout);
  d.w16(plus(params, 8), kind);
  d.w16(plus(params, 0xa), format);
  d.w32(plus(params, 0xc), item);
  d.w32(plus(params, 0x10), hconv);
  d.w32(plus(params, 0x14), size);
  d.w32(plus(params, 0x18), data);

  try {
    return await transactionBody(d, params);
  } finally {
    d.release(saved);
  }
}

async function transactionBody(d: Dd, params: number): Promise<number> {
  const hconv = d.r32(plus(params, 0x10));
  const kind = d.r16(plus(params, 8));
  const hwnd = lo(hconv);
  let proceed = false;
  let conv = 0;

  if (!(await convValid(d, hconv))) {
    await errorEach(d, DMLERR_INVALIDPARAMETER);
  } else {
    conv = await d.windowLong(hwnd, 0);

    const instance = d.r16(conv);

    d.si16(instance, 0x2a, 0);

    if ((d.r8(plus(conv, 0x20)) & 1) === 0) {
      await setError(d, instance, DMLERR_NO_CONV_ESTABLISHED);
    } else if ((d.r8(plus(conv, 0x20)) & 4) === 0) {
      proceed = true;
    } else {
      const server = await d.windowLong(d.r16(plus(conv, 0xa)), 0);

      if (server === 0) {
        await onTerminate(d, conv, d.r16(plus(conv, 0xa)), hwnd);
        await setError(d, instance, DMLERR_NO_CONV_ESTABLISHED);
      } else if ((filter(d, kind) & d.i32(d.r16(server), 0x1a)) >>> 0 !== 0) {
        await setError(d, instance, DMLERR_NOTPROCESSED);
      } else {
        proceed = true;
      }
    }
  }

  if (!proceed) {
    const data = d.r32(plus(params, 0x18));

    if (
      (kind === 0x4090 || kind === 0x4050) &&
      d.r32(plus(params, 0x14)) === 0xffffffff &&
      (lo(data) & 1) === 0
    ) {
      await d.free(data);
    }

    return 0;
  }

  const instance = d.r16(conv);
  const item = d.r32(plus(params, 0xc));
  const format = d.r16(plus(params, 0xa));
  let invalid: boolean;

  switch (kind) {
    case 0x103c:
      invalid = format === 0;
      break;
    case 0x1030:
    case 0x1034:
    case 0x1038:
    case 0x20b0:
    case 0x4050:
    case 0x4090: {
      if (kind === 0x4050 || kind === 0x4090) {
        const data = d.r32(plus(params, 0x18));
        let value: number;

        if (d.r32(plus(params, 0x14)) === 0xffffffff) {
          value = d.r32(plus(data, 2));

          if ((lo(value) & 1) === 0) {
            await d.free(data);
          }

          value = await prepare(d, conv, value);

          if (value === 0) {
            return 0;
          }
        } else {
          value = await make(d, instance, 0, format, lo(item), 0, d.r32(plus(params, 0x14)), data);

          if (value === 0) {
            await setError(d, instance, DMLERR_MEMORY_ERROR);
            return 0;
          }
        }

        d.w32(plus(params, 0x18), value);
      }

      invalid = (kind !== 0x4050 && item === 0) || (kind !== 0x4050 && format === 0);
      break;
    }
    case 0x8040:
      invalid = false;
      break;
    default:
      invalid = true;
  }

  if (invalid) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (d.r32(plus(params, 4)) === 0xffffffff) {
    return transact(d, conv, hwnd, params);
  }

  const answer = await transact(d, conv, hwnd, params);

  if (kind & 0x2000 && answer !== 0) {
    const [key, saved] = d.key(le32(answer));
    const added = await d.arrayAdd(d.i32(instance, 0xc), key, 'second');

    d.release(saved);

    if (added === 0) {
      await setError(d, instance, DMLERR_MEMORY_ERROR);
      return 0;
    }

    const record = await d.alloc(d.i16(instance, 0x20), 6);

    if (record !== 0) {
      d.w16(record, instance);
      d.w32(plus(record, 2), answer);
    } else {
      await setError(d, instance, DMLERR_MEMORY_ERROR);
    }

    return record;
  }

  return answer !== 0 ? 1 : 0;
}

/** `3672`: a transaction sent: asynchronously, or waited for in the modal loop. */
export async function transact(d: Dd, conv: number, hwnd: number, params: number): Promise<number> {
  const instance = d.r16(conv);

  if (d.r16(plus(conv, 0xe)) !== 2) {
    await setError(d, instance, DMLERR_SERVER_DIED);
    return 0;
  }

  if (d.r32(plus(params, 4)) === 0xffffffff) {
    if (d.r32(plus(conv, 0x3a)) === 0) {
      d.w32(plus(conv, 0x3a), await d.queueNew(0x38));
    }

    const queue = d.r32(plus(conv, 0x3a));
    const record = queue !== 0 ? await d.queueAdd(queue) : 0;

    if (record === 0) {
      await setError(d, instance, DMLERR_MEMORY_ERROR);
      return 0;
    }

    await addCount(d, d.r16(plus(params, 0xc)));

    const copy = plus(record, 0x1c);

    d.write(copy, d.read(params, 0x1c));
    d.w16(plus(record, 0xa), 2);
    d.w32(plus(record, 0x16), 0);
    d.w16(plus(record, 0xc), 0);
    d.w32(plus(record, 0x12), copy);
    d.w16(plus(record, 0x1a), 0);
    d.w32(copy, plus(record, 0x1a));

    const error = await send(d, d.r16(conv), plus(record, 0xa), d.r16(plus(conv, 0xa)), hwnd);

    d.w16(plus(record, 0xc), error);

    if (error === DMLERR_SERVER_DIED) {
      d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) & 0xfe);
      await deleteAtom(d, d.r16(plus(record, 0x28)));
      await d.queueRemove(d.r32(plus(conv, 0x3a)), d.queueId(record));
      await setError(d, d.r16(conv), DMLERR_SERVER_DIED);
      return 0;
    }

    const result = d.r32(params);

    if (result !== 0) {
      d.w32(result, long(lo(record), d.r16(plus(record, 8))));
    }

    return 1;
  }

  d.w32(plus(conv, 0x16), params);

  const error = await send(d, d.r16(conv), plus(conv, 0xe), d.r16(plus(conv, 0xa)), hwnd);

  await setError(d, d.r16(conv), error);

  if (error === DMLERR_SERVER_DIED) {
    return 0;
  }

  await modalLoop(d, d.r16(conv), d.r32(plus(params, 4)), hwnd);

  const answer = await finish(d, hwnd, plus(conv, 0xe), d.near((d.r16(conv) + 0x2a) & 0xffff));

  if (d.r16(plus(conv, 0xe)) === 1) {
    const kind = d.r16(plus(params, 8));
    const key = kind === 0x4050 ? d.r16(plus(params, 0x1a)) : d.r16(plus(params, 0xc));
    const [record, saved] = d.key([...le16(key), ...le16(kind)]);

    await d.arrayAdd(d.i32(0, D_ARRAY_SENT), record, null);
    d.release(saved);
    d.w16(plus(conv, 0xe), 2);
  }

  return answer;
}

/** `3886`: a transaction's message posted, its state set: the error, or nought. */
async function send(d: Dd, instance: number, state: number, partner: number, hwnd: number) {
  const params = d.r32(plus(state, 8));
  let high = d.r16(plus(params, 0xc));
  let low: number;
  let free = 0;
  const format = d.r16(plus(params, 0xa));
  const kind = d.r16(plus(params, 8));
  let message: number;

  switch (kind) {
    case 0x103c:
    case 0x1030:
    case 0x1034:
    case 0x1038: {
      message = 0x3e2;

      const options = (((((kind & 0xfe) | 2) << 4) & 0xff) << 8) & 0xffff;
      const block = await d.share(4, options, format);

      if (block === 0) {
        d.w16(state, 2);
        return DMLERR_MEMORY_ERROR;
      }

      free = block;
      low = block;
      d.w16(plus(params, 0x18), 0);
      d.w16(plus(params, 0x1a), block);
      d.w16(state, 0xb);
      break;
    }
    case 0x20b0:
      message = 0x3e6;
      await addCount(d, high);
      low = format;
      d.w16(state, 5);
      break;
    case 0x4050: {
      message = 0x3e8;

      const value = d.r32(plus(params, 0x18));

      high = hi(value);

      if ((lo(value) & 1) === 0) {
        free = hi(value);
      }

      low = 0;
      d.w16(state, 9);
      break;
    }
    case 0x4090: {
      message = 0x3e7;

      const value = d.r32(plus(params, 0x18));

      low = hi(value);

      if ((lo(value) & 1) === 0) {
        free = hi(value);
      }

      d.w16(state, 7);
      await giveAway(d, instance, value);
      break;
    }
    case 0x8040:
      message = 0x3e3;
      low = format;
      d.w16(state, 0xc);
      break;
    default:
      return DMLERR_INVALIDPARAMETER;
  }

  if (await d.isWindow(partner)) {
    const conv = await d.windowLong(hwnd, 0);

    if ((await postDde(d, conv, message, hwnd, high, low)) === 0) {
      d.w16(state, 2);

      if (free !== 0) {
        await freeBlock(d, free, d.r16(plus(d.r32(plus(state, 8)), 0xa)));
      }

      return DMLERR_POSTMSG_FAILED;
    }

    return 0;
  }

  d.w16(state, 0);

  if (free !== 0) {
    await freeBlock(d, free, d.r16(plus(d.r32(plus(state, 8)), 0xa)));
  }

  return DMLERR_SERVER_DIED;
}

/** `4356`: what a transaction came to, by its state. */
export async function finish(d: Dd, hwnd: number, state: number, error: number): Promise<number> {
  if (d.r16(state) === 1) {
    return 0;
  }

  const conv = await d.windowLong(hwnd, 0);
  const params = d.r32(plus(state, 8));
  const kind = d.r16(plus(params, 8));
  const fail = (code: number) => {
    if (d.r16(error) === 0) {
      d.w16(error, code);
    }

    d.w16(state, 1);
  };
  const done = () => {
    d.w16(state, 2);
    d.w32(plus(state, 0xc), 1);
  };

  switch (kind) {
    case 0x103c:
    case 0x1030:
    case 0x1034:
    case 0x1038: {
      if (d.r16(state) !== 0xd) {
        fail(0x4000);
        return 0;
      }

      const options = (((d.r8(plus(params, 8)) & 0xfc) << 4) & 0xff) << 8;
      const made = await addLink(
        d,
        d.r32(plus(conv, 0x3e)),
        hwnd,
        0,
        d.r16(plus(params, 0xc)),
        options,
        d.r16(plus(params, 0xa))
      );

      if (made === 0) {
        d.w16(state, 1);
        await setError(d, d.r16(conv), DMLERR_MEMORY_ERROR);
        return 0;
      }

      d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 2);

      if (d.d16(D_MONITORS) !== 0) {
        const client = await convOf(d, hwnd);

        await linkNotice(
          d,
          d.r16(conv),
          1,
          d.r8(plus(params, 8)) & 4,
          d.r16(plus(conv, 6)),
          d.r16(plus(conv, 8)),
          d.r32(plus(params, 0xc)),
          d.r16(plus(params, 0xa)),
          0,
          d.r32(plus(conv, 0xa)),
          client
        );
      }

      done();
      return 1;
    }
    case 0x20b0:
      if (d.r16(state) !== 6) {
        fail(0x4002);
        return 0;
      }

      d.w16(state, 2);
      return d.r32(plus(state, 0xc));
    case 0x4050:
      if (d.r16(state) === 0xa) {
        done();
        return 1;
      }

      fail(0x4005);
      return 0;
    case 0x4090:
      if (d.r16(state) === 8) {
        done();
        return 1;
      }

      fail(0x400b);
      return 0;
    case 0x8040: {
      if (d.r16(state) !== 0xe) {
        fail(0x4010);
        return 0;
      }

      const left = await removeLinks(
        d,
        d.r32(plus(conv, 0x3e)),
        0,
        0,
        d.r16(plus(params, 0xc)),
        d.r16(plus(params, 0xa))
      );

      if (left === 0) {
        d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) & 0xfd);
      }

      if (d.d16(D_MONITORS) !== 0) {
        const client = await convOf(d, hwnd);

        await linkNotice(
          d,
          d.r16(conv),
          0,
          d.r8(plus(params, 8)) & 4,
          d.r16(plus(conv, 6)),
          d.r16(plus(conv, 8)),
          d.r32(plus(params, 0xc)),
          d.r16(plus(params, 0xa)),
          0,
          d.r32(plus(conv, 0xa)),
          client
        );
      }

      done();
      return 1;
    }
    default:
      d.w16(state, 1);
      return 0;
  }
}

// Advise links.

/** `26ea`: the first link matching, nought matching anything. */
export function findLink(
  d: Dd,
  list: number,
  hwnd: number,
  topic: number,
  item: number,
  format: number
): number {
  const [key, saved] = d.key([...le16(item), ...le16(topic), ...le16(format), 0, 0, ...le16(hwnd)]);
  const found = d.listFind(list, 'link', key);

  d.release(saved);
  return found;
}

/** `261a`: a link made, or the one there given these options. */
export async function addLink(
  d: Dd,
  list: number,
  hwnd: number,
  topic: number,
  item: number,
  options: number,
  format: number
): Promise<number> {
  if (item === 0) {
    return 1;
  }

  let link = findLink(d, list, hwnd, topic, item, format);

  if (link === 0) {
    await addCount(d, item);
    link = await d.listAdd(list, 1);
  }

  if (link !== 0) {
    d.w16(plus(link, 4), item);
    d.w16(plus(link, 6), topic);
    d.w16(plus(link, 8), format);
    d.w16(plus(link, 0xa), options);
    d.w16(plus(link, 0xc), hwnd);
  }

  return lo(link);
}

/** `269e`: every link matching ended: whether any link is left. */
export async function removeLinks(
  d: Dd,
  list: number,
  hwnd: number,
  topic: number,
  item: number,
  format: number
): Promise<number> {
  for (;;) {
    const link = findLink(d, list, hwnd, topic, item, format);

    if (link === 0) {
      break;
    }

    await deleteAtom(d, d.r16(plus(link, 4)));
    await d.listRemove(list, link);
  }

  return d.r16(list);
}

/** `2720`: the next link after `link` with this window, topic and item. */
function nextLink(d: Dd, link: number, hwnd: number, topic: number, item: number): number {
  let at = link;

  for (;;) {
    at = d.r32(at);

    if (
      at === 0 ||
      ((hwnd === 0 || d.r16(plus(at, 0xc)) === hwnd) &&
        (topic === 0 || d.r16(plus(at, 6)) === topic) &&
        (item === 0 || d.r16(plus(at, 4)) === item))
    ) {
      return at;
    }
  }
}

/** `25ae`: how many later links have the same window, topic, item and format. */
function laterLinks(d: Dd, link: number): number {
  let count = 0;
  let at = d.r32(link);

  while (at !== 0) {
    const matched = [6, 0xc, 4, 8].every((field) => {
      const wanted = d.r16(plus(link, field));

      return wanted === 0 || d.r16(plus(at, field)) === wanted;
    });

    if (matched) {
      count++;
    }

    at = d.r32(at);
  }

  return count;
}

/** `DdePostAdvise` (`1118`). */
export async function postAdvise(d: Dd, id: number, topic: number, item: number) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (d.i16(instance, 0x1a) & 0x10) {
    await setError(d, instance, 0x4004);
    return 0;
  }

  let link = findLink(d, d.i32(instance, 0x32), 0, lo(topic), lo(item), 0);

  while (link !== 0) {
    const hwnd = d.r16(plus(link, 0xc));
    const conv = await d.windowLong(hwnd, 0);

    if (d.r8(plus(link, 0xa)) & 0x80) {
      d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) | 0x40);
    } else if (d.r8(plus(link, 0xb)) & 0x40) {
      await addCount(d, d.r16(plus(link, 4)));
      await postDde(d, conv, 0x3e5, hwnd, d.r16(plus(link, 4)), 0);
    } else {
      await adviseRequest(d, hwnd, conv, link, laterLinks(d, link));
    }

    link = nextLink(d, link, 0, lo(topic), lo(item));
  }

  return 1;
}

/** `3e64`: a hot link's data asked of the server, `XTYP_ADVREQ`, and posted. */
export async function adviseRequest(
  d: Dd,
  hwnd: number,
  conv: number,
  link: number,
  count: number
) {
  const hconv = await convOf(d, hwnd);
  const answer = await callback(
    d,
    d.r16(conv),
    hconv,
    d.r16(plus(conv, 8)),
    d.r16(plus(link, 4)),
    d.r16(plus(link, 8)),
    0x2022,
    0,
    count & 0xffff,
    0
  );

  if (answer === 0) {
    return;
  }

  let value = await prepare(d, conv, answer);

  d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) & 0xbf);

  if (d.r8(plus(link, 0xb)) & 0x80) {
    d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) | 0x80);

    let at = await d.globalLock(hi(value));

    if ((d.r8(plus(at, 1)) & 0x80) === 0) {
      if (lo(value) & 1) {
        const old = hi(value);

        value = await copyValue(d, d.r16(conv), old, lo(value));
        await d.globalUnlock(old);
        at = await d.globalLock(hi(value));
      }

      d.w8(plus(at, 1), d.r8(plus(at, 1)) | 0x80);
    }

    await d.globalUnlock(hi(value));
  }

  const instance = d.r16(conv);
  const [key, saved] = d.key(le32(value));

  await d.arrayFind(d.i32(instance, 0xc), 'second', key, true);
  d.release(saved);
  await addCount(d, d.r16(plus(link, 4)));
  await postDde(d, conv, 0x3e5, hwnd, d.r16(plus(link, 4)), hi(value));
}

/** `3fa0`: a callback's answer as the reply its message wants. */
export async function reply(d: Dd, item: number, answerIn: number) {
  const kind = d.r16(plus(item, 0x12));

  if ((kind & 0xfc00) === 0x8000 && kind !== 0x8040 && kind !== 0x8080) {
    return;
  }

  const window = d.r16(plus(item, 4));
  let answer = answerIn >>> 0;

  if (!(await d.isWindow(window))) {
    if (d.r8(plus(item, 0x13)) & 0x20 && answer !== 0 && answer !== 0xffffffff) {
      await freeValue(d, d.r16(plus(item, 0x26)), answer, true);
    }

    return;
  }

  const conv = await d.windowLong(window, 0);
  const instance = d.r16(conv);

  switch (d.r16(plus(item, 0x20))) {
    case 0:
      if (kind === 0x8080) {
        await deleteAtom(d, d.r16(plus(item, 0xc)));
        await freeValue(d, instance, d.r32(plus(item, 0x14)), true);
        await d.queueRemove(d.r32(plus(conv, 0x3a)), d.r32(plus(item, 0x18)));
      }

      break;
    case 0x3e2: {
      let status = 0;

      if (lo(answer) !== 0) {
        const made = await addLink(
          d,
          d.i32(instance, 0x32),
          window,
          d.r16(plus(conv, 8)),
          d.r16(plus(item, 0xc)),
          (d.r8(plus(item, 0x23)) & 0xc0) << 8,
          d.r16(plus(item, 0x10))
        );

        if (made === 0) {
          await setError(d, instance, DMLERR_MEMORY_ERROR);
        } else {
          if (d.d16(D_MONITORS) !== 0) {
            await linkNotice(
              d,
              instance,
              1,
              (d.r8(plus(item, 0x23)) & 0x40) << 8,
              d.r16(plus(conv, 6)),
              d.r16(plus(conv, 8)),
              d.r32(plus(item, 0xc)),
              d.r16(plus(item, 0x10)),
              1,
              d.r32(plus(item, 4)),
              d.r32(plus(conv, 0xa))
            );
          }

          d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 2);
          status = 0x8000;
        }

        const options = d.r16(plus(item, 0x28));

        await d.globalUnlock(options);
        await d.globalFree(options);
      }

      await postDde(d, conv, 0x3e4, window, d.r16(plus(item, 0xc)), status);
      break;
    }
    case 0x3e3:
      if (d.r16(plus(item, 0x24)) !== 0) {
        await postDde(d, conv, 0x3e4, window, d.r16(plus(item, 0x1c)), 0x8000);
      }

      break;
    case 0x3e5: {
      let status = lo(answer) & 0xc00f;

      if (status & 0x4000) {
        status &= 0x7fff;
      }

      const flags = d.r8(plus(item, 0x23));

      if (
        d.r16(plus(item, 0x16)) !== 0 &&
        flags & 0x20 &&
        ((status & 0x8000) === 0 || (flags & 0x80) === 0)
      ) {
        await freeValue(d, instance, d.r32(plus(item, 0x14)), true);
      }

      if (d.r8(plus(item, 0x23)) & 0x80) {
        await postDde(d, conv, 0x3e4, window, d.r16(plus(item, 0xc)), status);
      } else if (d.r16(plus(item, 0xc)) !== 0) {
        await d.deleteAtomRaw(d.r16(plus(item, 0xc)));
      }

      break;
    }
    case 0x3e6: {
      let message: number;
      let low: number;

      if (hi(answer) !== 0) {
        answer = await prepare(d, conv, answer);

        const at = await d.globalLock(hi(answer));
        const status = ((d.r8(plus(item, 0x23)) << 8) & 0x9000) | 0x1000;

        d.w16(at, d.r16(at) | status);
        await d.globalUnlock(hi(answer));
        await giveAway(d, instance, answer);
        message = 0x3e5;
        low = hi(answer);
      } else {
        message = 0x3e4;
        low = lo(answer) & 0x4000;
      }

      const posted = await postDde(d, conv, message, window, d.r16(plus(item, 0xc)), low);

      if (posted === 0 && message === 0x3e5) {
        await freeValue(d, instance, answer, true);
      }

      break;
    }
    case 0x3e7: {
      if (lo(answer) & 0x8000) {
        await freeValue(d, instance, d.r32(plus(item, 0x14)), true);
      } else {
        await d.arrayFind(d.i32(instance, 0xc), 'second', plus(item, 0x14), true);
      }

      const posted = await postDde(
        d,
        conv,
        0x3e4,
        window,
        d.r16(plus(item, 0xc)),
        lo(answer) & 0xc00f
      );

      if (posted === 0 && (lo(answer) & 0x8000) === 0) {
        await freeBlock(d, hi(answer), d.r16(plus(item, 0x10)));
      }

      break;
    }
    case 0x3e8:
      await postDde(d, conv, 0x3e4, window, d.r16(plus(item, 0x16)), lo(answer) & 0xc00f);
      break;
  }
}

/** `3a68`: a DDE message to a server conversation made a queued callback. */
export async function serverDde(
  d: Dd,
  conv: number,
  message: number,
  hwnd: number,
  client: number,
  low: number,
  high: number
) {
  if (d.r16(plus(conv, 0xa)) !== client || (d.r8(plus(conv, 0x20)) & 1) === 0) {
    return;
  }

  const instance = d.r16(conv);
  let data = 0;
  let format = 0;
  let status = 0;
  let handle = 0;
  let kind: number;

  switch (message) {
    case 0x3e2: {
      kind = 0x1030;

      const at = await d.globalLock(low);

      format = d.r16(plus(at, 2));
      status = d.r16(at);
      handle = low;
      break;
    }
    case 0x3e3: {
      const links = d.i32(instance, 0x32);
      let link = findLink(d, links, hwnd, 0, high, low);

      if (link === 0) {
        await postDde(d, conv, 0x3e4, hwnd, high, 0);
        return;
      }

      const firstFormat = d.r16(plus(link, 8));
      const firstItem = d.r16(plus(link, 4));

      if (d.d16(D_MONITORS) !== 0) {
        await linkNotice(
          d,
          instance,
          0,
          0,
          d.r16(plus(conv, 6)),
          d.r16(plus(conv, 8)),
          firstItem,
          firstFormat,
          1,
          await convOf(d, hwnd),
          d.r32(plus(conv, 0xa))
        );
      }

      let left = await removeLinks(d, links, hwnd, 0, firstItem, firstFormat);

      for (;;) {
        if (left === 0) {
          d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) & 0xfd);
          break;
        }

        link = findLink(d, links, hwnd, 0, high, low);

        if (link === 0) {
          break;
        }

        if (d.d16(D_MONITORS) !== 0) {
          await linkNotice(
            d,
            instance,
            0,
            0,
            d.r16(plus(conv, 6)),
            d.r16(plus(conv, 8)),
            d.r16(plus(link, 4)),
            d.r16(plus(link, 8)),
            1,
            await convOf(d, hwnd),
            d.r32(plus(conv, 0xa))
          );
        }

        await queueCallback(
          d,
          conv,
          await convOf(d, hwnd),
          d.r16(plus(conv, 8)),
          d.r16(plus(link, 4)),
          d.r16(plus(link, 8)),
          0x8040,
          0,
          0,
          0,
          message,
          0,
          0,
          0
        );

        const item = d.r16(plus(link, 4));
        const itemFormat = d.r16(plus(link, 8));

        left = await removeLinks(d, links, hwnd, 0, item, itemFormat);
      }

      await queueCallback(
        d,
        conv,
        await convOf(d, hwnd),
        d.r16(plus(conv, 8)),
        firstItem,
        firstFormat,
        0x8040,
        0,
        0,
        high,
        message,
        0,
        d.r16(plus(conv, 0xa)),
        0
      );
      return;
    }
    case 0x3e4: {
      const link = findLink(d, d.i32(instance, 0x32), hwnd, 0, high, 0);

      if (link !== 0 && d.r8(plus(link, 0xb)) & 0x80) {
        d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) & 0x7f);

        if (d.r8(plus(link, 0xa)) & 0x40) {
          await adviseRequest(d, hwnd, conv, link, 0xffff);
          return;
        }
      }

      if (high !== 0) {
        await d.deleteAtomRaw(high);
      }

      return;
    }
    case 0x3e6:
      kind = 0x20b0;
      format = low;
      break;
    case 0x3e7: {
      kind = 0x4090;

      const at = await d.globalLock(low);

      format = d.r16(plus(at, 2));
      status = d.r16(at);
      data = await wrap(d, instance, low, 0x4000);
      break;
    }
    case 0x3e8:
      kind = 0x4050;
      data = long(0xc100, high);
      break;
    default:
      return;
  }

  const hconv = await convOf(d, hwnd);

  await queueCallback(
    d,
    conv,
    hconv,
    d.r16(plus(conv, 8)),
    kind === 0x4050 ? 0 : high,
    format,
    kind,
    data,
    0,
    0,
    message,
    status,
    d.r16(plus(conv, 0xa)),
    handle
  );
}

/** `4b8e`: whether a message answers the transaction in this state, a data block locked to see. */
async function matches(d: Dd, state: number, high: number, low: number, message: number) {
  const params = d.r32(plus(state, 8));

  if (message === 0x3e5) {
    if (d.r16(state) !== 5) {
      return false;
    }

    const at = await d.globalLock(low);

    if (at === 0) {
      return false;
    }

    const matched =
      (d.r8(plus(at, 1)) & 0x10) !== 0 &&
      d.r16(plus(at, 2)) === d.r16(plus(params, 0xa)) &&
      high === d.r16(plus(params, 0xc));

    await d.globalUnlock(low);
    return matched;
  }

  switch (d.r16(state)) {
    case 5:
    case 7:
    case 0xb:
    case 0xc:
      return message === 0x3e4 && high === d.r16(plus(params, 0xc));
    case 9:
      return message === 0x3e4 && high === d.r16(plus(params, 0x1a));
    default:
      return false;
  }
}

/** `4866`: `WM_DDE_ACK` or `WM_DDE_DATA` to a client conversation. */
export async function clientDde(
  d: Dd,
  conv: number,
  hwnd: number,
  message: number,
  server: number,
  high: number,
  low: number
): Promise<number> {
  const instance = d.r16(conv);
  const state = plus(conv, 0xe);

  if (await matches(d, state, high, low, message)) {
    const error = d.near((instance + 0x2a) & 0xffff);

    if (
      (await answerTransaction(d, error, message, high, low, state, conv, hwnd)) !== 0 &&
      d.i16(instance, 0x28) !== 0
    ) {
      d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 0x80);
    }

    return 1;
  }

  const queue = d.r32(plus(conv, 0x3a));

  if (queue !== 0 && d.r32(plus(queue, 8)) !== 0) {
    let record = d.r32(plus(queue, 8));
    let count = d.r16(queue);

    while (count !== 0) {
      record = d.r32(record);

      if (await matches(d, plus(record, 0xa), high, low, message)) {
        const recordState = plus(record, 0xa);

        if (
          (await answerTransaction(
            d,
            plus(record, 0xc),
            message,
            high,
            low,
            recordState,
            conv,
            hwnd
          )) === 0
        ) {
          return 0;
        }

        await finish(d, hwnd, recordState, plus(record, 0xc));
        d.si16(instance, 0x2a, d.r16(plus(record, 0xc)));

        const hconv = await convOf(d, hwnd);
        const params = d.r32(plus(record, 0x12));

        await queueCallback(
          d,
          conv,
          hconv,
          d.r16(plus(conv, 8)),
          d.r32(plus(params, 0xc)),
          d.r16(plus(params, 0xa)),
          0x8080,
          d.r32(plus(record, 0x16)),
          long(lo(record), d.r16(plus(record, 8))),
          d.r16(plus(record, 0x1a)),
          0,
          0,
          server,
          0
        );
        return 1;
      }

      count--;
    }
  }

  if (message !== 0x3e5) {
    const [key, saved] = d.key(le16(high));
    const sent = await d.arrayFind(d.i32(0, D_ARRAY_SENT), 'first', key, true);

    d.release(saved);

    if (sent !== 0 && d.r16(plus(sent, 2)) === 0x4050) {
      await d.globalFree(high);
    } else if (high !== 0) {
      await d.deleteAtomRaw(high);
    }

    return 0;
  }

  const item = high;
  let format: number;
  let status: number;
  let locked: boolean;

  if (low !== 0) {
    const at = await d.globalLock(low);

    format = d.r16(plus(at, 2));
    status = d.r16(at);
    await d.globalUnlock(low);
    locked = at !== 0;
  } else {
    const link = findLink(d, d.r32(plus(conv, 0x3e)), 0, 0, item, 0);

    format = link !== 0 ? d.r16(plus(link, 8)) : 0;
    status = 0x8000;
    locked = false;
  }

  if (status & 0x1000) {
    if (status & 0x8000) {
      await postDde(d, conv, 0x3e4, hwnd, item, 0x8000);
    }

    await freeBlock(d, low, format);

    if (item !== 0) {
      await d.deleteAtomRaw(item);
    }

    return 0;
  }

  const hconv = await convOf(d, hwnd);
  const given = locked ? status : 0;
  const value = await wrap(d, instance, low, 0x4000);

  await queueCallback(
    d,
    conv,
    hconv,
    d.r16(plus(conv, 8)),
    item,
    format,
    0x4010,
    value,
    0,
    0,
    message,
    given,
    d.r16(plus(conv, 0xa)),
    0
  );
  return 1;
}

/** `4c6a`: an answer that matched a transaction taken. Whether it is an answer. */
async function answerTransaction(
  d: Dd,
  error: number,
  message: number,
  high: number,
  low: number,
  state: number,
  conv: number,
  hwnd: number
): Promise<number> {
  const params = d.r32(plus(state, 8));

  d.w16(plus(state, 0x10), 0);

  if (message === 0x3e4) {
    if (d.r16(state) === 9 || (low & 0x8000) === 0) {
      await freeValue(d, d.r16(conv), d.r32(plus(params, 0x18)), true);
    }

    const result = d.r32(params);

    if (result !== 0) {
      d.w16(result, low);
    }

    const current = d.r16(state);

    if (![5, 7, 9, 0xb, 0xc].includes(current)) {
      return 1;
    }

    if (low & 0x8000) {
      const next: Record<number, number> = { 7: 8, 9: 0xa, 0xb: 0xd, 0xc: 0xe };

      if (current === 5) {
        return 0;
      }

      d.w16(state, next[current]);
      return 1;
    }

    const block = d.r16(plus(params, 0x1a));

    d.w16(error, DMLERR_NOTPROCESSED);

    if (low & 0x4000) {
      d.w16(error, 0x4001);
    }

    if (current === 7) {
      const at = await d.globalLock(block);

      if (at !== 0 && d.r8(plus(at, 1)) & 0x20) {
        await freeBlock(d, block, d.r16(plus(at, 2)));
      }
    } else if (current === 0xb) {
      await d.globalFree(block);
    }

    d.w16(state, 1);
    return 1;
  }

  if (message === 0x3e5) {
    if (![5, 0xb].includes(d.r16(state))) {
      return 0;
    }

    d.w16(state, 6);

    const at = await d.globalLock(low);

    if (at === 0) {
      return 1;
    }

    const value =
      (d.r8(plus(at, 1)) & 0x20) === 0
        ? await copyValue(d, d.r16(conv), low, 0)
        : await wrap(d, d.r16(conv), low, 0);

    d.w32(plus(state, 0xc), value);

    if (d.r8(plus(at, 1)) & 0x80) {
      await postDde(d, conv, 0x3e4, hwnd, high, 0x8000);
    } else if (high !== 0) {
      await d.deleteAtomRaw(high);
    }

    return 1;
  }

  return 0;
}

/** `DdeAbandonTransaction` (`1bf0`). */
export async function abandon(d: Dd, id: number, hconv: number, transaction: number) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if ((hconv !== 0 && !(await convValid(d, hconv))) || transaction >>> 0 === 0xffffffff) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  if (hconv !== 0) {
    return abandonOne(d, lo(hconv), instance, transaction);
  }

  let child = await d.getWindow(d.i16(instance, 0x22), 5);

  if (child === 0) {
    return 1;
  }

  const last = await d.getWindow(child, 1);

  for (;;) {
    await abandonOne(d, child, instance, transaction);

    if (child === last) {
      return 1;
    }

    child = await d.getWindow(child, 2);
  }
}

/** `1cb6`: one transaction of a conversation abandoned -- every one, for nought. */
export async function abandonOne(d: Dd, hwnd: number, instance: number, transaction: number) {
  const conv = await d.windowLong(hwnd, 0);

  for (;;) {
    const record = d.queueItem(d.r32(plus(conv, 0x3a)), transaction);

    if (record === 0) {
      if (transaction !== 0) {
        await setError(d, instance, DMLERR_UNFOUND_QUEUE_ID);
        return 0;
      }

      return 1;
    }

    if (d.r32(plus(record, 0x16)) !== 0) {
      const found = await d.arrayFind(d.i32(instance, 0xc), 'second', plus(record, 0x16), false);

      if (found === 0) {
        const params = d.r32(plus(record, 0x12));

        await freeBlock(d, d.r16(plus(record, 0x16)), d.r16(plus(params, 0xa)));
      }
    }

    await deleteAtom(d, d.r16(plus(record, 0x28)));
    await d.queueRemove(d.r32(plus(conv, 0x3a)), d.queueId(record));

    if (transaction !== 0) {
      return 1;
    }
  }
}
