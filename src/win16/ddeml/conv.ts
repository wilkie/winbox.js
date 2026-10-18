'use strict';

import { B, D, W } from '../commdlg/api.js';
import {
  D_CLASS_CLIENT,
  D_CLASS_HOLDING,
  D_CLASS_SERVER,
  D_CONTEXT,
  D_EMPTY,
  D_HINSTANCE,
  D_MONITORS,
  D_PROGMAN,
  D_SERIAL,
  D_XPARAMS,
  Dd,
  far,
  hi,
  lo,
  long,
  plus,
} from './core.js';
import { free as freeValue } from './data.js';
import {
  DMLERR_INVALIDPARAMETER,
  DMLERR_MEMORY_ERROR,
  DMLERR_NO_CONV_ESTABLISHED,
  DMLERR_SYS_ERROR,
  callback,
  convValid,
  eachChild,
  errorEach,
  instanceOf,
  le16,
  le32,
  runQueue,
} from './instance.js';
import {
  addCount,
  convNotice,
  convOf,
  deleteAtom,
  hszLength,
  linkNotice,
  setError,
} from './monitor.js';
import { abandonOne, clientDde, serverDde, transact } from './xact.js';

/**
 * DDEML's conversations: connecting (`DdeConnect`, `DdeConnectList`,
 * `DdeReconnect`, `6a68`, `INITENUM`, the frame's `6bf6` and the client's
 * acknowledgement `709c`), the conversations' windows, ending them (`4f9e`,
 * `50be`, `DdeDisconnect`, `DdeDisconnectList`), the posts kept for a full
 * queue (`5c58`, `5de4`), and the queries, as `DDEML.DLL` seg1 has them. As
 * `crates/winbox-win16/src/ddeml/conv.rs`.
 */

async function procedureOf(d: Dd, hwnd: number): Promise<number> {
  return d.windowLong(hwnd, 0xfffc);
}

async function defaultProc(d: Dd, hwnd: number, message: number, wparam: number, lparam: number) {
  return d.user('DefWindowProc', [W(hwnd), W(message), W(wparam), D(lparam)]);
}

/** `6a68`: a client conversation made and `WM_DDE_INITIATE` sent. */
export async function connectOne(
  d: Dd,
  instance: number,
  parent: number,
  target: number,
  service: number,
  topic: number,
  context: number
): Promise<number> {
  const hwnd = await d.createWindow(D_CLASS_CLIENT, 0x40000000, parent, d.near(instance));

  if (hwnd === 0) {
    return 0;
  }

  const conv = await d.windowLong(hwnd, 0);

  d.w16(plus(conv, 0xe), 3);
  d.w16(plus(conv, 0x10), 0);
  d.w32(plus(conv, 2), service);
  d.w16(plus(conv, 6), lo(service));
  d.w16(plus(conv, 8), topic);
  d.write(plus(conv, 0x24), d.read(context !== 0 ? context : d.near(D_CONTEXT), 16));

  if (target !== 0) {
    d.w16(plus(conv, 0x38), target);
    await d.send(target, 0x3e0, hwnd, long(lo(service), topic));
  } else {
    const state = [...le16(hwnd), ...le32(conv), ...le16(topic)];

    await d.user('EnumWindows', [D(d.exportAddress(38)), B(state)]);
  }

  if (d.r16(plus(conv, 0xe)) === 3) {
    await d.destroyWindow(hwnd);
    return 0;
  }

  d.w16(plus(conv, 0xe), 2);
  d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 1);
  return hwnd;
}

/** `INITENUM` (`6b8a`). */
export async function initEnum(d: Dd, hwnd: number, state: number): Promise<number> {
  let conv = d.r32(plus(state, 2));

  d.w16(plus(conv, 0x38), hwnd);
  await d.send(hwnd, 0x3e0, d.r16(state), long(d.r16(plus(conv, 2)), d.r16(plus(state, 6))));
  conv = d.r32(plus(state, 2));

  return d.r8(plus(conv, 0x20)) & 0x40 || d.r16(plus(conv, 0xe)) === 3 ? 1 : 0;
}

/** `DdeConnect` (`0aac`). */
export async function connect(d: Dd, id: number, service: number, topic: number, context: number) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (context !== 0 && d.r16(context) !== 0x10) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const hwnd = await connectOne(
    d,
    instance,
    d.i16(instance, 0x22),
    hi(service),
    lo(service),
    lo(topic),
    context
  );

  if (hwnd === 0) {
    await setError(d, instance, DMLERR_NO_CONV_ESTABLISHED);
  }

  return convOf(d, hwnd);
}

/** `6f74`: a server conversation made under the instance's holding window. */
async function makeServerConv(d: Dd, instance: number, context: number): Promise<number> {
  if (d.i16(instance, 0x14) === 0) {
    const holding = await d.createWindow(D_CLASS_HOLDING, 0x40000000, d.i16(instance, 0x22), 0);

    d.si16(instance, 0x14, holding);

    if (holding === 0) {
      await setError(d, instance, DMLERR_SYS_ERROR);
      return 0;
    }
  }

  const hwnd = await d.createWindow(
    D_CLASS_SERVER,
    0x40000000,
    d.i16(instance, 0x14),
    d.near(instance)
  );

  if (hwnd === 0) {
    await setError(d, instance, DMLERR_SYS_ERROR);
    return 0;
  }

  const conv = await d.windowLong(hwnd, 0);

  d.write(plus(conv, 0x24), d.read(context, 16));
  return hwnd;
}

/** `6bf6`: a server instance's frame handed `WM_DDE_INITIATE`. */
export async function frameInitiate(
  d: Dd,
  instance: number,
  frame: number,
  client: number,
  app: number,
  topic: number
) {
  const flags = d.i16(instance, 0x1a);
  let own = false;

  if (flags & 0x2000) {
    return;
  }

  if (flags & 0x20 && d.arrayCount(d.i32(instance, 8)) === 0) {
    return;
  }

  const ddeml = (await procedureOf(d, client)) === d.exportAddress(28);
  let clientConv = 0;

  if (ddeml) {
    clientConv = await d.windowLong(client, 0);
    own = d.r16(clientConv) === instance;

    if (flags & 0x1000 && own) {
      return;
    }
  }

  if (app !== 0 && flags & 0x20) {
    const [key, saved] = d.key(le16(app));
    const found = await d.arrayFind(d.i32(instance, 8), 'first', key, false);

    d.release(saved);

    if (found === 0) {
      return;
    }
  }

  const wild = app === 0 || topic === 0;
  const context = ddeml ? plus(clientConv, 0x24) : 0;
  const selfFlag = own ? 1 : 0;
  const answer = await callback(
    d,
    instance,
    0,
    topic,
    app,
    0,
    wild ? 0x20e2 : 0x1062,
    0,
    context,
    selfFlag
  );

  if (answer === 0) {
    return;
  }

  let pairs: number;
  let saved: number | null = null;

  if (wild) {
    pairs = await d.globalLock(hi(answer));
  } else {
    const [at, sp] = d.reserve(16);

    d.write(at, [...le16(app), 0, 0, ...le16(topic), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    pairs = at;
    saved = sp;
  }

  const finish = () => {
    if (saved !== null) {
      d.release(saved);
    }
  };

  if ((await hszLength(d, d.r32(pairs))) !== 0) {
    for (;;) {
      if ((await hszLength(d, d.r32(plus(pairs, 4)))) === 0) {
        break;
      }

      const server = await makeServerConv(
        d,
        instance,
        ddeml ? plus(clientConv, 0x24) : d.near(D_CONTEXT)
      );

      if (server === 0) {
        finish();
        return;
      }

      const conv = await d.windowLong(server, 0);

      if (ddeml) {
        d.w32(plus(conv, 0xa), await convOf(d, client));
      } else {
        d.w16(plus(conv, 0xa), client);
        d.w16(plus(conv, 0xc), 0);
      }

      d.w16(plus(conv, 0x22), frame);
      d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 1);

      if (own) {
        d.w8(plus(conv, 0x21), d.r8(plus(conv, 0x21)) | 1);
        d.w8(plus(clientConv, 0x21), d.r8(plus(clientConv, 0x21)) | 1);
      }

      d.w16(plus(conv, 0xe), 2);
      d.w16(plus(conv, 2), app);
      d.w16(plus(conv, 4), 0);
      d.w16(plus(conv, 6), d.r16(pairs));
      d.w16(plus(conv, 8), d.r16(plus(pairs, 4)));

      if (d.d16(D_MONITORS) !== 0) {
        await convNotice(
          d,
          d.r16(conv),
          d.r16(plus(conv, 6)),
          d.r16(plus(conv, 8)),
          client,
          server,
          1
        );
      }

      await addCount(d, app);
      await addCount(d, d.r16(pairs));
      await addCount(d, d.r16(plus(pairs, 4)));
      await addCount(d, d.r16(pairs));
      await addCount(d, d.r16(plus(pairs, 4)));
      await d.send(client, 0x3e4, server, long(d.r16(pairs), d.r16(plus(pairs, 4))));

      const hconv = await convOf(d, server);

      await callback(
        d,
        instance,
        hconv,
        d.r32(plus(pairs, 4)),
        d.r32(pairs),
        0,
        0x8072,
        0,
        0,
        selfFlag
      );

      pairs = plus(pairs, 8);

      if ((await hszLength(d, d.r32(pairs))) === 0) {
        break;
      }
    }
  }

  finish();

  if (wild) {
    await d.globalUnlock(hi(answer));
    await freeValue(d, instance, answer, true);
  }
}

/** `699e`: a client conversation's 42h bytes made as its window is. */
async function clientCreate(d: Dd, instance: number, hwnd: number): Promise<number> {
  const conv = await d.alloc(d.i16(instance, 0x20), 0x42);

  if (conv === 0) {
    await setError(d, instance, DMLERR_MEMORY_ERROR);
    return 1;
  }

  await d.setWindowLong(hwnd, 0, conv);

  const serial = (d.d16(D_SERIAL) + 1) & 0xffff;

  d.sd16(D_SERIAL, serial);
  await d.setWindowWord(hwnd, 4, serial);
  d.w16(conv, instance);
  d.w16(plus(conv, 0xe), 0);
  d.w32(plus(conv, 0x16), d.near(D_XPARAMS));
  d.w16(plus(conv, 0x20), (d.i16(instance, 0x2c) & 1 ? 8 : 0) | 0x10);

  const parent = await d.getParent(hwnd);

  if ((await procedureOf(d, parent)) === d.exportAddress(32)) {
    d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 0x40);
  }

  d.w32(plus(conv, 0x3a), 0);

  const links = await d.listNew(d.i16(instance, 0x20), 0xe);

  d.w32(plus(conv, 0x3e), links);
  return links;
}

/** `7024`: a server conversation's 38h bytes made as its window is. */
async function serverCreate(d: Dd, instance: number, hwnd: number): Promise<number> {
  const conv = await d.alloc(d.i16(instance, 0x20), 0x38);

  if (conv === 0) {
    await setError(d, instance, DMLERR_MEMORY_ERROR);
    return 1;
  }

  d.w16(conv, instance);
  d.w16(plus(conv, 0xe), 0);
  d.w16(plus(conv, 0x20), d.i16(instance, 0x2c) & 1 ? 8 : 0);
  await d.setWindowLong(hwnd, 0, conv);

  const serial = (d.d16(D_SERIAL) + 1) & 0xffff;

  d.sd16(D_SERIAL, serial);
  await d.setWindowWord(hwnd, 4, serial);
  return 0;
}

/** `709c`: `WM_DDE_ACK` to a client conversation still connecting. */
async function clientAck(
  d: Dd,
  hwnd: number,
  conv: number,
  server: number,
  app: number,
  topic: number
) {
  const state = d.r16(plus(conv, 0xe));

  if (state === 3) {
    d.w16(plus(conv, 0xe), 4);

    if (d.d16(D_MONITORS) !== 0) {
      await convNotice(d, d.r16(conv), app, topic, hwnd, server, 1);
    }

    if ((await procedureOf(d, server)) === d.exportAddress(29)) {
      d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 4);
      d.w32(plus(conv, 0xa), await convOf(d, server));
    } else {
      d.w16(plus(conv, 0xa), server);
      d.w16(plus(conv, 0xc), 0);

      if (d.d16(D_PROGMAN) === app) {
        await addCount(d, app);
        await addCount(d, topic);
      }
    }

    d.w16(plus(conv, 6), app);
    d.w16(plus(conv, 8), topic);

    if (d.r16(plus(conv, 0x22)) === 0) {
      d.w16(plus(conv, 0x22), d.r16(plus(conv, 0x38)));
    }

    await addCount(d, d.r16(plus(conv, 2)));
    return;
  }

  if (state !== 4) {
    return;
  }

  const instance = d.r16(conv);
  const terminate =
    d.r16(plus(conv, 0xa)) === server || (await d.getParent(hwnd)) === d.i16(instance, 0x22);

  if (!terminate) {
    if ((await procedureOf(d, server)) !== d.exportAddress(29)) {
      await d.send(server, 0x3e1, hwnd, 0);

      const parent = await d.getParent(hwnd);

      await connectOne(d, instance, parent, d.r16(plus(conv, 0x38)), app, topic, plus(conv, 0x24));

      if (d.d16(D_PROGMAN) !== app) {
        await deleteAtom(d, app);
        await deleteAtom(d, topic);
      }

      return;
    }

    const parent = await d.getParent(hwnd);
    const made =
      (await d.user('CreateWindow', [
        D(d.near(D_CLASS_CLIENT)),
        D(d.near(D_EMPTY)),
        D(0x40000000),
        W(0),
        W(0),
        W(0),
        W(0),
        W(parent),
        W(0),
        W(d.d16(D_HINSTANCE)),
        D(d.near(instance)),
      ])) & 0xffff;

    if (made !== 0) {
      const other = await d.windowLong(made, 0);

      d.w16(plus(other, 0xe), 2);
      d.w16(plus(other, 0x10), 0);
      d.w16(plus(other, 6), app);
      d.w32(plus(other, 2), d.r32(plus(conv, 2)));
      await addCount(d, d.r16(plus(other, 2)));
      d.w16(plus(other, 8), topic);
      d.w32(plus(other, 0xa), await convOf(d, server));
      d.w16(plus(other, 0x22), d.r16(plus(conv, 0x38)));
      d.w8(plus(other, 0x20), d.r8(plus(other, 0x20)) | 5);

      if (d.d16(D_MONITORS) !== 0) {
        await convNotice(d, d.r16(other), app, topic, hwnd, server, 1);
      }

      await d.send(server, 0x46b, made, 0);
      return;
    }

    await setError(d, instance, DMLERR_SYS_ERROR);
  }

  await d.send(server, 0x3e1, hwnd, 0);
  await deleteAtom(d, app);
  await deleteAtom(d, topic);
}

/** 4CBh: whether a conversation is a client's, or its instance as a far pointer. */
function answerKind(d: Dd, conv: number, wparam: number, lparam: number, client: boolean) {
  const value = wparam === 0 ? (client ? 1 : 0) : wparam === 1 ? far(d.ds(), d.r16(conv)) : 0;

  if (lparam !== 0) {
    d.w32(lparam, value);
    return 1;
  }

  return value;
}

/** 4CFh: `DdeEnableCallback`'s command kept in the status. */
async function enableCommand(d: Dd, conv: number, hwnd: number, command: number) {
  d.w16(plus(conv, 0x20), (d.r16(plus(conv, 0x20)) & ~0x88) | command);

  if (command === 0 || command & 0x80) {
    await repost(d, conv, hwnd);
  }
}

/** `CLIENTWNDPROC` (`4614`). */
export async function clientProc(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
): Promise<number> {
  const conv = await d.windowLong(hwnd, 0);

  switch (message) {
    case 1:
      return clientCreate(d, d.r16(lparam), hwnd);
    case 2: {
      if (d.r8(plus(conv, 0x20)) & 1) {
        d.w8(plus(conv, 0x21), d.r8(plus(conv, 0x21)) & ~0x20);
        await terminate(d, conv, 0, hwnd);
      }

      if (d.r8(plus(conv, 0x21)) & 0x40) {
        const owner = await d.getWindow(hwnd, 4);

        if (owner !== 0) {
          await d.post(owner, 0x4ce, 0x1000, 0);
        }
      }

      await d.queueFree(d.r32(plus(conv, 0x3a)));
      await d.queueFree(d.r32(plus(conv, 0x34)));
      await d.killTimer(hwnd, 4);
      await freeLinks(d, conv, hwnd);
      await d.listFree(d.r32(plus(conv, 0x3e)));

      if (d.r16(plus(conv, 0xe)) !== 3) {
        await deleteAtom(d, d.r16(plus(conv, 2)));
        await deleteAtom(d, d.r16(plus(conv, 6)));
        await deleteAtom(d, d.r16(plus(conv, 8)));
      }

      await d.free(conv);
      return defaultProc(d, hwnd, message, wparam, lparam);
    }
    case 0x113:
      if (wparam === 4) {
        await d.killTimer(hwnd, 4);
        await repost(d, conv, hwnd);
      } else if (wparam === 1) {
        const instance = d.r16(conv);

        d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 1);
      }

      return 0;
    case 0x3e1:
    case 0x4d1:
      await onTerminate(d, conv, wparam, hwnd);
      return 0;
    case 0x3e4:
    case 0x3e5:
      if (message === 0x3e4 && [3, 4].includes(d.r16(plus(conv, 0xe)))) {
        await clientAck(d, hwnd, conv, wparam, lo(lparam), hi(lparam));
        return 1;
      }

      await clientDde(d, conv, hwnd, message, wparam, hi(lparam), lo(lparam));
      return 0;
    case 0x4cb:
      return answerKind(d, conv, wparam, lparam, true);
    case 0x4ce:
      await terminate(d, conv, wparam, hwnd);
      return 0;
    case 0x4cf:
      await enableCommand(d, conv, hwnd, wparam);
      return 0;
    default:
      return defaultProc(d, hwnd, message, wparam, lparam);
  }
}

/** `SERVERWNDPROC` (`523a`). */
export async function serverProc(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
): Promise<number> {
  const conv = await d.windowLong(hwnd, 0);

  if ((message >= 0x3e2 && message <= 0x3e4) || (message >= 0x3e6 && message <= 0x3e8)) {
    await serverDde(d, conv, message, hwnd, wparam, lo(lparam), hi(lparam));
    return 0;
  }

  switch (message) {
    case 1:
      return serverCreate(d, d.r16(lparam), hwnd);
    case 2: {
      if (d.r8(plus(conv, 0x20)) & 1) {
        d.w8(plus(conv, 0x21), d.r8(plus(conv, 0x21)) & ~0x20);
        await terminate(d, conv, 0, hwnd);
      }

      if (d.r8(plus(conv, 0x21)) & 0x40) {
        await d.post(d.i16(d.r16(conv), 0x14), 0x4ce, 0x1000, 0);
      }

      await freeLinks(d, conv, hwnd);
      await deleteAtom(d, d.r16(plus(conv, 6)));
      await deleteAtom(d, d.r16(plus(conv, 2)));
      await deleteAtom(d, d.r16(plus(conv, 8)));
      await d.queueFree(d.r32(plus(conv, 0x34)));
      await d.killTimer(hwnd, 4);
      await d.free(conv);
      return defaultProc(d, hwnd, message, wparam, lparam);
    }
    case 0x113:
      if (wparam === 4) {
        await d.killTimer(hwnd, 4);
        await repost(d, conv, hwnd);
      } else if (wparam === 1) {
        const instance = d.r16(conv);

        d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 1);
      }

      return 0;
    case 0x3e1:
    case 0x4d1:
      await onTerminate(d, conv, wparam, hwnd);
      return 0;
    case 0x46b:
      d.w32(plus(conv, 0xa), await convOf(d, wparam));
      return 0;
    case 0x4cb:
      return answerKind(d, conv, wparam, lparam, false);
    case 0x4ce:
      await terminate(d, conv, wparam, hwnd);
      return 0;
    case 0x4cf:
      await enableCommand(d, conv, hwnd, wparam);
      return 0;
    default:
      return defaultProc(d, hwnd, message, wparam, lparam);
  }
}

/** `SUBFRAMEWNDPROC` (`5480`). */
export async function subframeProc(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
): Promise<number> {
  if (message === 1) {
    return d.setWindowWord(hwnd, 0, d.r16(lparam));
  }

  if (message === 0x3e0) {
    const instance = await d.windowWord(hwnd, 0);

    await frameInitiate(d, instance, hwnd, wparam, lo(lparam), hi(lparam));
    return 0;
  }

  return defaultProc(d, hwnd, message, wparam, lparam);
}

/** `CONVLISTWNDPROC` (`5758`). */
export async function convlistProc(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
): Promise<number> {
  switch (message) {
    case 1: {
      await d.setWindowWord(hwnd, 6, 0);

      const serial = (d.d16(D_SERIAL) + 1) & 0xffff;

      d.sd16(D_SERIAL, serial);
      await d.setWindowWord(hwnd, 4, serial);
      return d.setWindowWord(hwnd, 0, d.r16(lparam));
    }
    case 0x4ce:
      if (wparam === 0x2000) {
        await d.setWindowWord(hwnd, 6, 0x2000);
        await eachChild(d, hwnd, 0x4ce, 0x6000, 0, false);
      }

      if (
        (wparam === 0x1000 || wparam === 0x2000) &&
        (await d.windowWord(hwnd, 6)) === 0x2000 &&
        (await d.getWindow(hwnd, 5)) === 0
      ) {
        await d.destroyWindow(hwnd);
      }

      return 0;
    case 0x4cf:
      await eachChild(d, hwnd, 0x4cf, wparam, lparam, false);
      return 0;
    default:
      return defaultProc(d, hwnd, message, wparam, lparam);
  }
}

function sides(d: Dd, conv: number, hwnd: number): [number, number] {
  const partner = d.r16(plus(conv, 0xa));

  return d.r8(plus(conv, 0x20)) & 0x10 ? [hwnd, partner] : [partner, hwnd];
}

/** `4f9e`: a conversation ended from this side. */
export async function terminate(d: Dd, conv: number, flags: number, hwnd: number) {
  const instance = d.r16(conv);

  if (d.i16(instance, 0x28) === hwnd) {
    d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 2);
    await d.post(hwnd, 0x4ce, flags, conv);
    return;
  }

  if (d.d16(D_MONITORS) !== 0) {
    const [client, server] = sides(d, conv, hwnd);

    await convNotice(d, instance, d.r16(plus(conv, 6)), d.r16(plus(conv, 8)), client, server, 0);
  }

  d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) | flags);

  if (d.r8(plus(conv, 0x20)) & 1) {
    if (d.r8(plus(conv, 0x20)) & 0x10) {
      await abandonOne(d, hwnd, instance, 0);
    }

    await freeLinks(d, conv, hwnd);

    if (await d.isWindow(d.r16(plus(conv, 0xa)))) {
      await postDde(d, conv, 0x3e1, hwnd, 0, 0);
      d.si16(instance, 2, d.i16(instance, 2) + 1);
      d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) ^ 0x8001);
    }

    d.w16(plus(conv, 0xe), 0);
  }

  if (!(await d.isWindow(d.r16(plus(conv, 0xa))))) {
    d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) ^ 0x21);
  }

  if ((d.r16(plus(conv, 0x20)) & 0x2021) === 0x2020) {
    await d.destroyWindow(hwnd);
  }
}

/** `50be`: `WM_DDE_TERMINATE` from the partner. */
export async function onTerminate(d: Dd, conv: number, partner: number, hwnd: number) {
  if (d.r16(plus(conv, 0xa)) !== partner) {
    return;
  }

  const instance = d.r16(conv);

  if (d.i16(instance, 0x28) === hwnd) {
    d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 2);
    await d.post(hwnd, 0x4d1, partner, 0);
    return;
  }

  if (d.r8(plus(conv, 0x20)) & 1) {
    if (d.r8(plus(conv, 0x20)) & 0x10) {
      await abandonOne(d, hwnd, instance, 0);
    }

    await runQueue(d, instance);
    d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) ^ 0x2021);

    if (d.d16(D_MONITORS) !== 0) {
      const [client, server] = sides(d, conv, hwnd);

      await convNotice(d, instance, d.r16(plus(conv, 6)), d.r16(plus(conv, 8)), client, server, 0);
    }

    if (await d.isWindow(d.r16(plus(conv, 0xa)))) {
      await postDde(d, conv, 0x3e1, hwnd, 0, 0);
    }

    const hconv = await convOf(d, hwnd);
    const own = d.r16(plus(conv, 0x20)) & 0x100 ? 1 : 0;

    await callback(d, instance, hconv, 0, 0, 0, 0x80c2, 0, 0, own);
    d.w16(plus(conv, 0xe), 0);
    await freeLinks(d, conv, hwnd);
  } else if (d.r8(plus(conv, 0x21)) & 0x80) {
    d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) ^ 0x8020);
    d.si16(instance, 2, d.i16(instance, 2) - 1);
  }

  if ((d.r16(plus(conv, 0x20)) & 0x2020) === 0x2020) {
    await d.destroyWindow(hwnd);
  }
}

/** `5c58`: a DDE message posted to the partner, or kept to post again. */
export async function postDde(
  d: Dd,
  conv: number,
  message: number,
  wparam: number,
  high: number,
  low: number
): Promise<number> {
  if (!(await d.isWindow(d.r16(plus(conv, 0xa))))) {
    return 0;
  }

  const lparam = long(low, high);
  let queue = d.r32(plus(conv, 0x34));

  if (queue !== 0 && d.r16(queue) !== 0) {
    if (message === 0x3e1) {
      await d.queueFree(queue);
      d.w32(plus(conv, 0x34), 0);
    } else {
      const item = await d.queueAdd(queue);

      if (item === 0) {
        await setError(d, d.r16(conv), DMLERR_MEMORY_ERROR);
        return 0;
      }

      d.w16(plus(item, 8), message);
      d.w32(plus(item, 0xc), lparam);
    }
  }

  queue = d.r32(plus(conv, 0x34));

  if (queue !== 0 && d.r16(queue) !== 0) {
    return repost(d, conv, wparam);
  }

  let tries = 0;
  const task = await d.windowTask(wparam);

  for (;;) {
    if ((await d.post(d.r16(plus(conv, 0xa)), message, wparam, lparam)) !== 0) {
      return 1;
    }

    if (!(await d.isWindow(d.r16(plus(conv, 0xa))))) {
      return 0;
    }

    if ((await d.windowTask(d.r16(plus(conv, 0xa)))) !== task) {
      await d.kernel('Yield', []);
    }

    const tried = tries;

    tries++;

    if (tried > 3) {
      break;
    }
  }

  if (d.r32(plus(conv, 0x34)) === 0) {
    d.w32(plus(conv, 0x34), await d.queueNew(0x10));
  }

  queue = d.r32(plus(conv, 0x34));

  const item = queue !== 0 ? await d.queueAdd(queue) : 0;

  if (item === 0) {
    await setError(d, d.r16(conv), DMLERR_MEMORY_ERROR);
    return 0;
  }

  d.w16(plus(item, 8), message);
  d.w32(plus(item, 0xc), lparam);
  return 1;
}

/** `5de4`: the posts kept tried again in order. */
export async function repost(d: Dd, conv: number, hwnd: number): Promise<number> {
  for (;;) {
    const queue = d.r32(plus(conv, 0x34));

    if (queue === 0 || d.r16(queue) === 0) {
      return 1;
    }

    const item = d.queueItem(queue, 0);

    if (
      (await d.post(d.r16(plus(conv, 0xa)), d.r16(plus(item, 8)), hwnd, d.r32(plus(item, 0xc)))) !==
      0
    ) {
      await d.queueRemove(queue, 0);
      continue;
    }

    if (!(await d.isWindow(d.r16(plus(conv, 0xa))))) {
      await d.queueFree(queue);
      d.w32(plus(conv, 0x34), 0);
      return 0;
    }

    await d.setTimer(hwnd, 4, 200);
    return 1;
  }
}

/** `277a`: a conversation's advise links of a window freed. */
export async function freeLinks(d: Dd, conv: number, hwnd: number) {
  const client = (d.r8(plus(conv, 0x20)) & 0x10) !== 0;
  const list = client ? d.r32(plus(conv, 0x3e)) : d.i32(d.r16(conv), 0x32);
  let link = d.r32(list);

  while (link !== 0) {
    const next = d.r32(link);

    if (d.r16(plus(link, 0xc)) === hwnd) {
      if (d.d16(D_MONITORS) !== 0) {
        let convServer: number;
        let convClient: number;

        if (client) {
          convServer = d.r32(plus(conv, 0xa));
          convClient = await convOf(d, hwnd);
        } else {
          convServer = await convOf(d, hwnd);
          convClient = d.r32(plus(conv, 0xa));
        }

        await linkNotice(
          d,
          d.r16(conv),
          0,
          (d.r8(plus(link, 0xb)) << 8) & 0x4000,
          d.r16(plus(conv, 6)),
          d.r16(plus(conv, 8)),
          d.r16(plus(link, 4)),
          d.r16(plus(link, 8)),
          client ? 0 : 1,
          convServer,
          convClient
        );
      }

      await deleteAtom(d, d.r16(plus(link, 4)));
      await d.listRemove(list, link);
    }

    link = next;
  }
}

/** `DdeDisconnect` (`0b4a`). */
export async function disconnect(d: Dd, hconv: number) {
  if (!(await convValid(d, hconv))) {
    await errorEach(d, DMLERR_NO_CONV_ESTABLISHED);
    return 0;
  }

  const conv = await d.windowLong(lo(hconv), 0);
  const instance = d.r16(conv);

  if (d.i16(instance, 0x2e) !== 0) {
    if ((await d.post(lo(hconv), 0x4ce, 0x2000, conv)) === 0) {
      await setError(d, instance, DMLERR_SYS_ERROR);
      return 0;
    }

    return 1;
  }

  await terminate(d, conv, 0x2000, lo(hconv));
  return 1;
}

/** `DdeReconnect` (`0be0`). */
export async function reconnect(d: Dd, hconv: number) {
  if (!(await convValid(d, hconv))) {
    await errorEach(d, DMLERR_NO_CONV_ESTABLISHED);
    return 0;
  }

  const hwnd = lo(hconv);
  const conv = await d.windowLong(hwnd, 0);
  const instance = d.r16(conv);

  d.si16(instance, 0x2a, 0);

  if ((d.r8(plus(conv, 0x20)) & 0x10) === 0) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const made = await connectOne(
    d,
    instance,
    d.i16(instance, 0x22),
    d.r16(plus(conv, 0x22)),
    d.r16(plus(conv, 6)),
    d.r16(plus(conv, 8)),
    plus(conv, 0x24)
  );

  if (made === 0) {
    await setError(d, instance, DMLERR_NO_CONV_ESTABLISHED);
    return 0;
  }

  if (d.r8(plus(conv, 0x20)) & 0x40) {
    await d.setParent(made, await d.getParent(hwnd));
  }

  if (d.r8(plus(conv, 0x20)) & 2) {
    let link = d.r32(d.r32(plus(conv, 0x3e)));

    while (link !== 0) {
      const next = d.r32(link);

      if (d.r16(plus(link, 0xc)) === hwnd) {
        const [params, saved] = d.reserve(0x20);
        const partner = await convOf(d, made);

        d.w32(params, plus(params, 0x1c));
        d.w32(plus(params, 4), 0xffffffff);
        d.w16(plus(params, 8), (d.r8(plus(link, 0xa)) & 0xc) | 0x1030);
        d.w16(plus(params, 0xa), d.r16(plus(link, 8)));
        d.w32(plus(params, 0xc), d.r16(plus(link, 4)));
        d.w32(plus(params, 0x10), partner);
        d.w32(plus(params, 0x14), 0);
        d.w32(plus(params, 0x18), 0);
        await transact(d, await d.windowLong(made, 0), made, params);
        d.release(saved);
      }

      link = next;
    }
  }

  return convOf(d, made);
}

/** `DdeQueryConvInfo` (`0dac`). */
export async function queryConvInfo(d: Dd, hconv: number, transaction: number, info: number) {
  const hwnd = lo(hconv);
  const conv = (await convValid(d, hconv)) ? await d.windowLong(hwnd, 0) : 0;

  if (conv === 0) {
    await errorEach(d, DMLERR_NO_CONV_ESTABLISHED);
    return 0;
  }

  const instance = d.r16(conv);

  d.si16(instance, 0x2a, 0);

  const client = (await d.send(hwnd, 0x4cb, 0, 0)) & 0xffff;
  let state = plus(conv, 0xe);

  if (transaction >>> 0 !== 0xffffffff && client !== 0) {
    const queue = d.r32(plus(conv, 0x3a));
    const item = queue !== 0 ? d.queueItem(queue, transaction) : 0;

    if (item === 0) {
      await setError(d, instance, 0x4011);
      return 0;
    }

    state = plus(item, 0xa);
  }

  const bytes = new Array(0x3a).fill(0);
  const put16 = (at: number, value: number) => {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >> 8) & 0xff;
  };
  const put32 = (at: number, value: number) => {
    put16(at, value & 0xffff);
    put16(at + 2, (value >>> 16) & 0xffff);
  };

  put32(0, 0x3a);

  const connected =
    (await d.isWindow(d.r16(plus(conv, 0xa)))) && (d.r8(plus(conv, 0x20)) & 5) === 5;

  put32(8, connected ? d.r32(plus(conv, 0xa)) : 0);
  put32(0xc, client !== 0 ? d.r16(plus(conv, 6)) : 0);
  put32(0x10, d.r32(plus(conv, 2)));
  put32(0x14, d.r16(plus(conv, 8)));
  put16(0x20, d.r16(plus(conv, 0x20)));
  d.read(plus(conv, 0x24), 16).forEach((byte, i) => (bytes[0x2a + i] = byte));

  if (client !== 0) {
    const params = d.r32(plus(state, 8));

    put32(4, d.r32(plus(state, 4)));
    put32(0x18, d.r32(plus(params, 0xc)));
    put16(0x1c, d.r16(plus(params, 0xa)));
    put16(0x1e, d.r16(plus(params, 8)));
    put16(0x22, d.r16(state));
    put16(0x24, d.r16(plus(state, 2)));
  } else {
    put32(4, d.r32(plus(conv, 0x12)));
    put16(0x22, d.r16(plus(conv, 0xe)));
    put16(0x24, d.i16(instance, 0x2a));
  }

  let list = 0;

  if (d.r8(plus(conv, 0x20)) & 0x40) {
    const parent = await d.getParent(hwnd);

    if (await d.isWindow(parent)) {
      const tag = await d.windowWord(await d.getParent(hwnd), 4);

      list = long(await d.getParent(hwnd), tag);
    }
  }

  put32(0x26, list);

  const size = Math.min(d.r16(info), 0x3a);

  d.write(info, bytes.slice(0, size));
  d.w32(info, size);
  return size;
}

/** `DdeSetUserHandle` (`1020`). */
export async function setUserHandle(d: Dd, hconv: number, transaction: number, user: number) {
  if (!(await convValid(d, hconv))) {
    await errorEach(d, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const hwnd = lo(hconv);
  const conv = await d.windowLong(hwnd, 0);
  const instance = d.r16(conv);

  d.si16(instance, 0x2a, 0);

  if (conv === 0) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  let state = plus(conv, 0xe);

  if (transaction >>> 0 !== 0xffffffff) {
    if ((await d.send(hwnd, 0x4cb, 0, 0)) === 0) {
      await setError(d, instance, DMLERR_INVALIDPARAMETER);
      return 0;
    }

    const queue = d.r32(plus(conv, 0x3a));
    const item = queue !== 0 ? d.queueItem(queue, transaction) : 0;

    if (item === 0) {
      await setError(d, instance, 0x4011);
      return 0;
    }

    state = plus(item, 0xa);
  }

  d.w32(plus(state, 4), user);
  return 1;
}

/** `DdeConnectList` (`068a`). */
export async function connectList(
  d: Dd,
  id: number,
  service: number,
  topic: number,
  old: number,
  context: number
) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (old !== 0 && !(await convValid(d, old))) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const oldList = lo(old);

  if (oldList !== 0) {
    let child = await d.getWindow(oldList, 5);

    while (child !== 0) {
      const next = await d.getWindow(child, 2);
      const conv = await d.windowLong(child, 0);

      if ((d.r8(plus(conv, 0x20)) & 1) === 0) {
        await d.setParent(child, d.i16(instance, 0x22));
        await terminate(d, conv, 0x2000, child);
      }

      child = next;
    }
  }

  const list = await d.createWindow(
    D_CLASS_HOLDING,
    0x40000000,
    d.i16(instance, 0x22),
    d.near(instance)
  );

  if (list === 0) {
    await setError(d, instance, DMLERR_SYS_ERROR);
    return 0;
  }

  const made = await connectOne(d, instance, list, hi(service), lo(service), lo(topic), context);

  if (made === 0) {
    if (oldList !== 0 && (await d.getWindow(oldList, 5)) === 0) {
      await d.send(oldList, 0x4ce, 0x2000, 0);
      await setError(d, instance, DMLERR_NO_CONV_ESTABLISHED);
      return 0;
    }

    return old >>> 0;
  }

  if (oldList !== 0) {
    let child = await d.getWindow(oldList, 5);

    while (child !== 0) {
      const conv = await d.windowLong(child, 0);
      const task = await d.windowTask(d.r16(plus(conv, 0xa)));
      let fresh = await d.getWindow(list, 5);
      const last = await d.getWindow(fresh, 1);

      while (fresh !== 0) {
        const next = fresh === last ? 0 : await d.getWindow(fresh, 2);
        const other = await d.windowLong(fresh, 0);
        const otherTask = await d.windowTask(d.r16(plus(other, 0xa)));

        if (
          d.r16(plus(conv, 6)) === d.r16(plus(other, 6)) &&
          d.r16(plus(conv, 8)) === d.r16(plus(other, 8)) &&
          task === otherTask
        ) {
          await d.setParent(fresh, d.i16(instance, 0x22));
          await terminate(d, await d.windowLong(fresh, 0), 0x2000, fresh);
        }

        fresh = next;
      }

      let next = await d.getWindow(child, 2);

      if (next !== 0 && (await d.getParent(next)) !== oldList) {
        next = 0;
      }

      await d.setParent(child, list);
      child = next;
    }

    await d.send(oldList, 0x4ce, 0x2000, 0);
  }

  if ((await d.getWindow(list, 5)) === 0) {
    await d.send(list, 0x4ce, 0x2000, 0);
    await setError(d, instance, DMLERR_NO_CONV_ESTABLISHED);
    return 0;
  }

  return convOf(d, list);
}

/** `DdeQueryNextServer` (`0948`). */
export async function queryNextServer(d: Dd, list: number, previous: number) {
  if (!(await convValid(d, list))) {
    await errorEach(d, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const hwnd = lo(list);
  const instance = await d.windowWord(hwnd, 0);

  d.si16(instance, 0x2a, 0);

  if (previous === 0) {
    if (!(await d.isWindow(await d.getWindow(hwnd, 5)))) {
      return 0;
    }

    const first = await d.getWindow(hwnd, 5);
    const tag = await d.windowWord(await d.getWindow(hwnd, 5), 4);

    return long(first, tag);
  }

  if (!(await convValid(d, previous))) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const next = await d.getWindow(lo(previous), 2);

  if (next === 0) {
    return 0;
  }

  const parent = await d.getParent(next);

  if (parent !== hwnd || (await d.getWindow(parent, 5)) === next) {
    return 0;
  }

  return convOf(d, next);
}

/** `DdeDisconnectList` (`0a46`). */
export async function disconnectList(d: Dd, list: number) {
  if (!(await convValid(d, list))) {
    await errorEach(d, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const instance = await d.windowWord(lo(list), 0);

  d.si16(instance, 0x2a, 0);
  await d.send(lo(list), 0x4ce, 0x2000, 0);
  return 1;
}
