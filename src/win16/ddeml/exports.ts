'use strict';

import { LocalInit } from '../kernel/LocalInit.js';
import { Loader } from '../loader.js';
import { DDEML_NAME, DDEML_PATH, D_HINSTANCE, Dd, far } from './core.js';
import * as conv from './conv.js';
import * as data from './data.js';
import * as instance from './instance.js';
import * as monitor from './monitor.js';
import { DATA } from './resources.js';
import * as xact from './xact.js';

/**
 * `DDEML`'s exports, each its routine of `DDEML.DLL` (`instance.ts`,
 * `conv.ts`, `xact.ts`, `data.ts`, `monitor.ts`), DDEML's data made ready
 * first. As `crates/winbox-win16/src/ddeml/mod.rs`.
 */

/**
 * The local heap the file's entry makes (seg2 `0095`): `LocalInit` of its
 * data segment, sized as KERNEL sizes it, with nought for its start.
 */
const HEAP_START = 0x25f;
const HEAP_END = 0x225f;

/** DDEML's instance: the file's library's while the file is loaded, WinBox's own otherwise. */
function instanceHandle(system: any): number {
  const loader = system._modules.fromName(DDEML_NAME);

  if (loader instanceof Loader) {
    const handle = system._modules.handleFromPath((loader as any).path);
    const library = handle ? system.handles.resolve(handle) : null;

    if (library?.instance) {
      return library.instance;
    }
  }

  return system._modules.instanceFromPath(DDEML_PATH) ?? 0;
}

/** DDEML's data made as the file's is as it loads, the first time any export is called. */
function ready(system: any): Dd {
  const d = new Dd(system);

  if (!system._ddemlReady) {
    const selector = d.ds();

    system._ddemlReady = true;
    d.write(far(selector, 0), DATA);
    d.w16(far(selector, 0x170), selector);
    LocalInit.call(system, selector, HEAP_START, HEAP_END);
    d.w16(far(selector, D_HINSTANCE), instanceHandle(system));
  }

  return d;
}

/** `WEP` (seg2 `002c`): 1. */
export function WEP() {
  return 1;
}

export async function DdeInitialize(
  this: any,
  pid: number,
  callback: number,
  flags: number,
  reserved: number
) {
  return instance.initialize(ready(this), pid, callback, flags, reserved);
}

export async function DdeUninitialize(this: any, id: number) {
  return instance.uninitialize(ready(this), id);
}

export async function DdeConnectList(
  this: any,
  id: number,
  service: number,
  topic: number,
  list: number,
  context: number
) {
  return conv.connectList(ready(this), id, service, topic, list, context);
}

export async function DdeQueryNextServer(this: any, list: number, previous: number) {
  return conv.queryNextServer(ready(this), list, previous);
}

export async function DdeDisconnectList(this: any, list: number) {
  return conv.disconnectList(ready(this), list);
}

export async function DdeConnect(
  this: any,
  id: number,
  service: number,
  topic: number,
  context: number
) {
  return conv.connect(ready(this), id, service, topic, context);
}

export async function DdeDisconnect(this: any, hconv: number) {
  return conv.disconnect(ready(this), hconv);
}

export async function DdeQueryConvInfo(
  this: any,
  hconv: number,
  transaction: number,
  info: number
) {
  return conv.queryConvInfo(ready(this), hconv, transaction, info);
}

export async function DdeSetUserHandle(
  this: any,
  hconv: number,
  transaction: number,
  user: number
) {
  return conv.setUserHandle(ready(this), hconv, transaction, user);
}

export async function DdeClientTransaction(
  this: any,
  source: number,
  size: number,
  hconv: number,
  item: number,
  format: number,
  kind: number,
  timeout: number,
  result: number
) {
  return xact.clientTransaction(
    ready(this),
    source,
    size,
    hconv,
    item,
    format,
    kind,
    timeout,
    result
  );
}

export async function DdeAbandonTransaction(
  this: any,
  id: number,
  hconv: number,
  transaction: number
) {
  return xact.abandon(ready(this), id, hconv, transaction);
}

export async function DdePostAdvise(this: any, id: number, topic: number, item: number) {
  return xact.postAdvise(ready(this), id, topic, item);
}

export async function DdeCreateDataHandle(
  this: any,
  id: number,
  source: number,
  size: number,
  offset: number,
  item: number,
  format: number,
  flags: number
) {
  return data.createDataHandle(ready(this), id, source, size, offset, item, format, flags);
}

export async function DdeAddData(
  this: any,
  handle: number,
  source: number,
  size: number,
  offset: number
) {
  return data.addData(ready(this), handle, source, size, offset);
}

export async function DdeGetData(
  this: any,
  handle: number,
  out: number,
  most: number,
  offset: number
) {
  return data.getData(ready(this), handle, out, most, offset);
}

export async function DdeAccessData(this: any, handle: number, size: number) {
  return data.accessData(ready(this), handle, size);
}

export async function DdeUnaccessData(this: any, handle: number) {
  return data.unaccessData(ready(this), handle);
}

export async function DdeFreeDataHandle(this: any, handle: number) {
  return data.freeDataHandle(ready(this), handle);
}

export async function DdeGetLastError(this: any, id: number) {
  return instance.getLastError(ready(this), id);
}

export async function DdeCreateStringHandle(this: any, id: number, string: number, page: number) {
  return instance.createStringHandle(ready(this), id, string, page & 0xffff);
}

export async function DdeFreeStringHandle(this: any, id: number, hsz: number) {
  return instance.freeStringHandle(ready(this), id, hsz);
}

export async function DdeQueryString(
  this: any,
  id: number,
  hsz: number,
  out: number,
  size: number,
  page: number
) {
  return instance.queryString(ready(this), id, hsz, out, size, page & 0xffff);
}

export async function DdeKeepStringHandle(this: any, id: number, hsz: number) {
  return instance.keepStringHandle(ready(this), id, hsz);
}

export async function DdeEnableCallback(this: any, id: number, hconv: number, command: number) {
  return instance.enableCallback(ready(this), id, hconv, command);
}

export async function DdeNameService(
  this: any,
  id: number,
  hsz: number,
  reserved: number,
  command: number
) {
  return instance.nameService(ready(this), id, hsz, reserved, command);
}

export async function CLIENTWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
) {
  return conv.clientProc(ready(this), hwnd, message, wparam, lparam);
}

export async function SERVERWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
) {
  return conv.serverProc(ready(this), hwnd, message, wparam, lparam);
}

export async function SUBFRAMEWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
) {
  return conv.subframeProc(ready(this), hwnd, message, wparam, lparam);
}

export async function DMGWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
) {
  return instance.dmgProc(ready(this), hwnd, message, wparam, lparam);
}

export async function CONVLISTWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
) {
  return conv.convlistProc(ready(this), hwnd, message, wparam, lparam);
}

export async function MONITORWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
) {
  return monitor.monitorProc(ready(this), hwnd, message, wparam, lparam);
}

export async function DDESENDHOOKPROC(this: any, code: number, wparam: number, lparam: number) {
  return monitor.sendHook(ready(this), code & 0xffff, wparam, lparam);
}

export async function DDEPOSTHOOKPROC(this: any, code: number, wparam: number, lparam: number) {
  return monitor.postHook(ready(this), code & 0xffff, wparam, lparam);
}

/** `DdeCmpStringHandles` (`1bb0`). */
export function DdeCmpStringHandles(hsz1: number, hsz2: number) {
  return instance.cmpStringHandles(hsz1, hsz2);
}

export async function DdeReconnect(this: any, hconv: number) {
  return conv.reconnect(ready(this), hconv);
}

export async function INITENUM(this: any, hwnd: number, state: number) {
  return conv.initEnum(ready(this), hwnd, state);
}

export async function TERMDLGPROC(this: any, hwnd: number, message: number, wparam: number) {
  return instance.termDlgProc(ready(this), hwnd, message, wparam);
}
