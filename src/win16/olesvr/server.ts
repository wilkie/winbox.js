'use strict';

import { B, D, W, buffer, stringOf, text } from '../commdlg/api.js';
import { bytesOf, plus, signed16 } from '../olecli/core.js';
import { DWORD, UINT } from '../types.js';
import {
  ACK,
  ADVISE_ACK_REQ,
  CF_BITMAP,
  CF_METAFILEPICT,
  CF_PALETTE,
  CF_TEXT,
  CLASS_NAME,
  CLIENT_VTBL,
  DATA_ADVISED,
  DATA_RESPONSE,
  GMEM_DDESHARE,
  GMEM_MOVEABLE,
  HKEY_CLASSES_ROOT,
  NACK,
  OLE_CHANGED,
  OLE_CLOSED,
  OLE_ERROR_ADDRESS,
  OLE_ERROR_CLASS,
  OLE_ERROR_HANDLE,
  OLE_OK,
  OLE_RENAMED,
  OLE_SAVED,
  OLE_SERVER_MULTI,
  OLE_WAIT_FOR_RELEASE,
  RECT_AT,
  REG_SIZE,
  REG_VALUE,
  type Advise,
  type Server,
  type SvrDoc,
  type SvrObject,
  Svr,
  WM_DDE_ACK,
  WM_DDE_ADVISE,
  WM_DDE_DATA,
  WM_DDE_EXECUTE,
  WM_DDE_INITIATE,
  WM_DDE_POKE,
  WM_DDE_REQUEST,
  WM_DDE_TERMINATE,
  WM_DDE_UNADVISE,
  WS_CHILD,
} from './core.js';

/**
 * OLE 1.0's server library as WinBox's own: the server's side of the DDE
 * conversations a client's `OLECLI` holds with it, over the methods of the
 * server's `OLESERVER`, `OLESERVERDOC` and `OLEOBJECT` tables. Written from
 * OLE 1.0's documented interface and protocol and from what the probe
 * `olesrv` measured under DOSBox -- the messages on the wire and the
 * methods the server is called with, in their order -- not from the code
 * of `OLESVR.DLL` (`kb/topics/ole.md`). As
 * `crates/winbox-win16/src/olesvr/server.rs`.
 */

/** The methods of `OLESERVERVTBL`, `OLESERVERDOCVTBL` and `OLEOBJECTVTBL` (ole.h), by their slots. */
const SERVER = {
  Open: 0,
  Create: 1,
  CreateFromTemplate: 2,
  Edit: 3,
  Exit: 4,
  Release: 5,
  Execute: 6,
};
const DOC = {
  Save: 0,
  Close: 1,
  SetHostNames: 2,
  SetDocDimensions: 3,
  GetObject: 4,
  Release: 5,
  SetColorScheme: 6,
  Execute: 7,
};
const OBJECT = {
  QueryProtocol: 0,
  Release: 1,
  Show: 2,
  DoVerb: 3,
  GetData: 4,
  SetData: 5,
  SetTargetDevice: 6,
  SetBounds: 7,
  EnumFormats: 8,
  SetColorScheme: 9,
};

const FAR = DWORD;
const WORD = UINT;
const long = (low: number, high: number) => (((high & 0xffff) << 16) | (low & 0xffff)) >>> 0;
const lower = (bytes: number[]) =>
  bytes.map((byte) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte)).join(',');
const same = (a: number[], b: number[]) => lower(a) === lower(b);

/** A method of a table, called far: its answer, AX. */
async function method(svr: Svr, self: number, slot: number, args: [number, number][]) {
  const table = svr.r32(self);
  const procedure = svr.r32(plus(table, slot * 4));

  return (await svr.callFarTyped(procedure, [[self, FAR], ...args])) & 0xffff;
}

// What the library does as it starts.

/** The formats it registers, in its order (as WinBox runs `OLESVR.DLL`, each call it makes logged). */
const FORMATS = ['Native', 'Binary', 'ObjectLink', 'OwnerLink'];

/** The atoms it adds, in its order: the protocol's commands, topics, items and options. */
const ATOMS = [
  'StdExit',
  'StdNewDocument',
  'StdOpenDocument',
  'StdEditDocument',
  'StdNewfromTemplate',
  'StdCloseDocument',
  'StdShowItem',
  'StdDoVerbItem',
  'System',
  'OLEsystem',
  'StdDocumentName',
  'Protocols',
  'Topics',
  'Formats',
  'Status',
  'EditEnvItems',
  'True',
  'False',
  'Change',
  'Save',
  'Close',
];

/** Its window classes: a server's, a document's, an item's -- eight, eight and four bytes of window words, style nought. */
const CLASSES = [
  { name: 'SrvrWndClass', ordinal: 21, extra: 8 },
  { name: 'DocWndClass', ordinal: 22, extra: 8 },
  { name: 'ItemWndClass', ordinal: 23, extra: 4 },
];

function wndclass(procedure: number, extra: number, instance: number, name: number) {
  const words = [
    0,
    procedure & 0xffff,
    procedure >>> 16,
    0,
    extra,
    instance,
    0,
    0,
    0,
    0,
    0,
    name & 0xffff,
    name >>> 16,
  ];

  return words.flatMap((word) => [word & 0xff, (word >> 8) & 0xff]);
}

/**
 * The registrations made once a session, as a program first calls it:
 * its formats, atoms and classes, and the table of the `OLECLIENT` it
 * gives each object, `ITEMCALLBACK` its one method.
 */
export async function start(svr: Svr, address: (ordinal: number) => number, instance: number) {
  const state = svr.svr();

  if (state.started) {
    return;
  }

  state.started = true;
  state.instance = instance;

  for (const name of ATOMS) {
    state.atoms[name] = await svr.addAtomText(bytesOf(name));
  }

  for (const name of FORMATS) {
    state.formats[name] =
      (await svr.user('RegisterClipboardFormat', [text(bytesOf(name))])) & 0xffff;
  }

  for (const kind of CLASSES) {
    const at = svr.near(CLASS_NAME);

    svr.write(at, [...bytesOf(kind.name), 0]);
    await svr.user('RegisterClass', [B(wndclass(address(kind.ordinal), kind.extra, instance, at))]);
  }

  svr.w32(svr.near(CLIENT_VTBL), address(26));
}

// Windows and messages.

async function makeWindow(svr: Svr, klass: string, style: number, parent: number) {
  const at = svr.near(CLASS_NAME);

  svr.write(at, [...bytesOf(klass), 0]);
  return (
    (await svr.user('CreateWindow', [
      D(at),
      text([]),
      D(style),
      W(0),
      W(0),
      W(0),
      W(0),
      W(parent),
      W(0),
      W(svr.svr().instance),
      D(0),
    ])) & 0xffff
  );
}

async function post(svr: Svr, to: number, message: number, from: number, lParam: number) {
  await svr.user('PostMessage', [W(to), W(message), W(from), D(lParam)]);
}

async function atomText(svr: Svr, atom: number): Promise<number[]> {
  if (!atom) {
    return [];
  }

  return stringOf(await svr.callB('USER', 'GlobalGetAtomName', [W(atom), buffer(256), W(256)]));
}

/** A block of `GMEM_DDESHARE` holding bytes: its handle. */
async function shared(svr: Svr, bytes: number[]): Promise<number> {
  const handle = await svr.globalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, bytes.length);
  const at = await svr.globalLock(handle);

  svr.write(at, bytes);
  await svr.globalUnlock(handle);
  return handle;
}

/** A block's bytes, as many as its size. */
async function blockBytes(svr: Svr, handle: number, skip = 0): Promise<number[]> {
  const size = await svr.globalSize(handle);
  const at = await svr.globalLock(handle);
  const bytes = at ? svr.read(svr.huge(at, skip), Math.max(size - skip, 0)) : [];

  await svr.globalUnlock(handle);
  return bytes;
}

const word = (value: number) => [value & 0xff, (value >> 8) & 0xff];

// The protocol's commands.

interface Command {
  name: number[];
  args: number[][];
}

/**
 * An execute's commands, each `[name(args)]`, an argument quoted or not,
 * separated by commas; null where the text is not so.
 */
function parse(bytes: number[]): Command[] | null {
  const commands: Command[] = [];
  let i = 0;
  const space = () => {
    while (bytes[i] === 0x20) i++;
  };

  space();

  if (bytes[i] !== 0x5b) {
    return null;
  }

  while (i < bytes.length) {
    space();

    if (bytes[i] !== 0x5b) {
      return null;
    }

    i++;

    const name: number[] = [];

    while (i < bytes.length && ![0x28, 0x5d].includes(bytes[i])) name.push(bytes[i++]);

    const args: number[][] = [];

    if (bytes[i] === 0x28) {
      i++;

      for (;;) {
        space();

        const arg: number[] = [];

        if (bytes[i] === 0x22) {
          i++;

          while (i < bytes.length && bytes[i] !== 0x22) arg.push(bytes[i++]);

          i++;
        } else {
          while (i < bytes.length && ![0x2c, 0x29].includes(bytes[i])) arg.push(bytes[i++]);

          while (arg.length && arg[arg.length - 1] === 0x20) arg.pop();
        }

        args.push(arg);
        space();

        if (bytes[i] === 0x2c) {
          i++;
          continue;
        }

        if (bytes[i] !== 0x29) {
          return null;
        }

        i++;
        break;
      }
    }

    space();

    if (bytes[i] !== 0x5d) {
      return null;
    }

    i++;
    commands.push({ name: name.filter((byte) => byte !== 0x20), args });
    space();
  }

  return commands;
}

const isStd = (command: Command) => lower(command.name.slice(0, 3)) === lower(bytesOf('Std'));
const named = (command: Command, name: string) => same(command.name, bytesOf(name));

/** An argument as a truth: `TRUE` or `FALSE`, else a number. */
function truth(arg: number[] | undefined): number {
  if (!arg) {
    return 0;
  }

  if (same(arg, bytesOf('TRUE'))) {
    return 1;
  }

  if (same(arg, bytesOf('FALSE'))) {
    return 0;
  }

  return Number.parseInt(String.fromCharCode(...arg), 10) || 0;
}

async function commandText(svr: Svr, handle: number): Promise<number[]> {
  const at = await svr.globalLock(handle);
  const bytes = at ? svr.string(at) : [];

  await svr.globalUnlock(handle);
  return bytes;
}

// Servers and documents.

const serverOf = (svr: Svr, handle: number) => svr.svr().servers.get(handle & 0xffff);
const docOf = (svr: Svr, handle: number) => svr.svr().docs.get(handle & 0xffff);

/** `OleRegisterServer`: a class of the registration database's served, its window made. */
export async function registerServer(
  svr: Svr,
  klass: number,
  server: number,
  out: number,
  _instance: number,
  use: number
) {
  const name = svr.string(klass);
  const value = svr.near(REG_VALUE);
  const size = svr.near(REG_SIZE);

  svr.w32(size, 0x80);

  if (
    (await svr.call('SHELL', 'RegQueryValue', [
      D(HKEY_CLASSES_ROOT),
      text(name),
      D(value),
      D(size),
    ])) !== 0
  ) {
    return OLE_ERROR_CLASS;
  }

  const hwnd = await makeWindow(svr, 'SrvrWndClass', 0, 0);

  svr.svr().servers.set(hwnd, {
    hwnd,
    klass: name,
    pointer: server,
    multi: (use & 0xffff) === OLE_SERVER_MULTI,
    docs: [],
    convs: [],
    blocked: false,
    queue: [],
    revoking: false,
  });
  svr.w32(out, hwnd);
  return OLE_OK;
}

/** A document's window made, the document kept as the server's. */
async function newDoc(svr: Svr, server: Server, name: number[]): Promise<SvrDoc> {
  const hwnd = await makeWindow(svr, 'DocWndClass', WS_CHILD, server.hwnd);
  const doc: SvrDoc = {
    hwnd,
    server: server.hwnd,
    name,
    doc: 0,
    convs: [],
    objects: [],
    advises: [],
    named: [],
    target: null,
    revoking: false,
  };

  return doc;
}

function keepDoc(svr: Svr, server: Server, doc: SvrDoc) {
  svr.svr().docs.set(doc.hwnd, doc);
  server.docs.push(doc.hwnd);
}

/** `OleRegisterServerDoc`: a document the server opened itself. */
export async function registerServerDoc(
  svr: Svr,
  handle: number,
  name: number,
  docPointer: number,
  out: number
) {
  const server = serverOf(svr, handle);

  if (!server || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  const doc = await newDoc(svr, server, svr.string(name));

  doc.doc = docPointer;
  keepDoc(svr, server, doc);
  svr.w32(out, doc.hwnd);
  return OLE_OK;
}

/** A document let go: its `Release` called, its window destroyed; its server's, if it waits. */
async function releaseDoc(svr: Svr, doc: SvrDoc) {
  const state = svr.svr();
  const server = state.servers.get(doc.server);

  state.docs.delete(doc.hwnd);

  if (server) {
    server.docs = server.docs.filter((hwnd) => hwnd !== doc.hwnd);
  }

  await method(svr, doc.doc, DOC.Release, []);
  await svr.user('DestroyWindow', [W(doc.hwnd)]);

  if (server?.revoking) {
    await finishServer(svr, server);
  }
}

/** An object let go: its `Release` called, its client and advises forgotten. */
async function releaseObject(svr: Svr, doc: SvrDoc, object: SvrObject) {
  doc.objects = doc.objects.filter((each) => each !== object);
  doc.advises = doc.advises.filter((advise) => advise.object !== object);
  svr.freeClient(object.client);
  await method(svr, object.object, OBJECT.Release, []);
}

/**
 * A document revoked: each object let go in the order given, each of its
 * conversations ended; let go itself at once where it has none, else as
 * the last ends (**recorded** by `olesrv`).
 */
async function revokeDoc(svr: Svr, doc: SvrDoc): Promise<number> {
  for (const object of [...doc.objects]) {
    await releaseObject(svr, doc, object);
  }

  doc.revoking = true;

  if (!doc.convs.length) {
    await releaseDoc(svr, doc);
    return OLE_OK;
  }

  for (const conv of doc.convs) {
    await post(svr, conv, WM_DDE_TERMINATE, doc.hwnd, 0);
  }

  return OLE_WAIT_FOR_RELEASE;
}

/** `OleRevokeServerDoc`. */
export async function revokeServerDoc(svr: Svr, handle: number) {
  const doc = docOf(svr, handle);

  if (!doc || handle >>> 16 || doc.revoking) {
    return OLE_ERROR_HANDLE;
  }

  return revokeDoc(svr, doc);
}

/** A server let go once nothing of it is left: its `Release`, its window. */
async function finishServer(svr: Svr, server: Server) {
  if (server.convs.length || server.docs.length || !svr.svr().servers.has(server.hwnd)) {
    return;
  }

  svr.svr().servers.delete(server.hwnd);
  await method(svr, server.pointer, SERVER.Release, []);
  await svr.user('DestroyWindow', [W(server.hwnd)]);
}

/**
 * `OleRevokeServer`: each document revoked in the order made, each system
 * conversation ended; the server let go at once where nothing is left,
 * else as the last conversation ends (**recorded** by `olesrv`).
 */
export async function revokeServer(svr: Svr, handle: number) {
  const server = serverOf(svr, handle);

  if (!server || handle >>> 16 || server.revoking) {
    return OLE_ERROR_HANDLE;
  }

  for (const hwnd of [...server.docs]) {
    const doc = docOf(svr, hwnd);

    if (doc && !doc.revoking) {
      await revokeDoc(svr, doc);
    }
  }

  server.revoking = true;

  if (!server.convs.length && !server.docs.length) {
    await finishServer(svr, server);
    return OLE_OK;
  }

  for (const conv of server.convs) {
    await post(svr, conv, WM_DDE_TERMINATE, server.hwnd, 0);
  }

  return OLE_WAIT_FOR_RELEASE;
}

/** `OleBlockServer`: what clients post queued until it is unblocked. */
export function blockServer(svr: Svr, handle: number) {
  const server = serverOf(svr, handle);

  if (!server || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  server.blocked = true;
  return OLE_OK;
}

/**
 * `OleUnblockServer`: the first message queued handled, and whether more
 * wait; with none left the server is no longer blocked (**recorded** by
 * `olesrv`: a message posted after it is answered at once).
 */
export async function unblockServer(svr: Svr, handle: number, out: number) {
  const server = serverOf(svr, handle);

  if (!server || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  const next = server.queue.shift();

  if (!server.queue.length) {
    server.blocked = false;
  }

  if (next) {
    await handle_(svr, ...next);
  }

  if (out) {
    svr.w16(out, server.queue.length ? 1 : 0);
  }

  return OLE_OK;
}

/** `OleRenameServerDoc`: its name changed, and told to each conversation that advised `StdDocumentName`. */
export async function renameServerDoc(svr: Svr, handle: number, name: number) {
  const doc = docOf(svr, handle);

  if (!doc || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  doc.name = svr.string(name);
  await tellName(svr, doc, doc.name);
  return OLE_OK;
}

/** `OleRevertServerDoc`: nothing seen (**recorded** by `olesrv`). */
export function revertServerDoc(svr: Svr, handle: number) {
  return docOf(svr, handle) && !(handle >>> 16) ? OLE_OK : OLE_ERROR_HANDLE;
}

/** `OleSavedServerDoc`: each object's `/Save` advises told, in the order the objects were given. */
export async function savedServerDoc(svr: Svr, handle: number) {
  const doc = docOf(svr, handle);

  if (!doc || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  for (const object of [...doc.objects]) {
    await tell(svr, doc, object, 'Save');
  }

  return OLE_OK;
}

/**
 * `OleRevokeObject`: the object let go, and each conversation it was
 * given in ended (**recorded** by `olesrv`); a pointer that is no
 * object's `OLECLIENT`, `OLE_ERROR_ADDRESS`.
 */
export async function revokeObject(svr: Svr, client: number) {
  const found = svr.svr().clients.get(client >>> 0);
  const doc = found && docOf(svr, found.doc);

  if (!found || !doc) {
    return OLE_ERROR_ADDRESS;
  }

  const convs = doc.advises.filter((a) => a.object === found.object).map((a) => a.conv);
  const given = [...new Set([...found.object.convs, ...convs])];

  await releaseObject(svr, doc, found.object);

  for (const conv of given) {
    if (doc.convs.includes(conv)) {
      await post(svr, conv, WM_DDE_TERMINATE, doc.hwnd, 0);
      svr.svr().terminating.add(`${doc.hwnd}:${conv}`);
    }
  }

  return OLE_OK;
}

/**
 * `ITEMCALLBACK`, the method of the `OLECLIENT` an object is given: what
 * its server tells of it sent to the conversations that advised it.
 */
export async function itemCallback(svr: Svr, client: number, what: number, _object: number) {
  const found = svr.svr().clients.get(client >>> 0);
  const doc = found && docOf(svr, found.doc);

  if (!found || !doc) {
    return OLE_OK;
  }

  if (what === OLE_CHANGED) {
    await tell(svr, doc, found.object, 'Change');
  } else if (what === OLE_SAVED) {
    await tell(svr, doc, found.object, 'Save');
  } else if (what === OLE_CLOSED) {
    await tell(svr, doc, found.object, 'Close');
  } else if (what === OLE_RENAMED) {
    const link = svr.svr().formats.ObjectLink;

    if (await enumerates(svr, found.object, link)) {
      const handle = await getData(svr, doc, found.object, link);

      if (handle) {
        const bytes = await blockBytes(svr, handle);
        const first = bytes.indexOf(0);
        const rest = bytes.slice(first + 1);
        const name = rest.slice(0, Math.max(rest.indexOf(0), 0));

        await svr.globalFree(handle);
        doc.name = name;
        await tellName(svr, doc, name);
      }
    }
  }

  return OLE_OK;
}

/** A document's name sent to each conversation that advised `StdDocumentName`: `Binary`, the name and its nought. */
async function tellName(svr: Svr, doc: SvrDoc, name: number[]) {
  for (const conv of doc.named) {
    const block = await shared(svr, [
      ...word(DATA_ADVISED),
      ...word(svr.svr().formats.Binary),
      ...name,
      0,
    ]);
    const atom = await svr.addAtomText(bytesOf('StdDocumentName'));

    await post(svr, conv, WM_DDE_DATA, doc.hwnd, long(block, atom));
  }
}

/**
 * What a conversation advised of an object for a time -- `Change`, `Save`
 * or `Close` -- sent: every format it advised of the object, each asked of
 * it in turn, the item named as it was advised (**recorded** by
 * `olesrv`: an item advised for a change in two formats and for a save in
 * one is sent in both when saved).
 */
async function tell(svr: Svr, doc: SvrDoc, object: SvrObject, when: string) {
  for (const advise of doc.advises.filter((a) => a.object === object && a.whens.has(when))) {
    for (const format of advise.formats) {
      const data = await dataBlock(svr, doc, object, format, DATA_ADVISED);

      if (!data) {
        continue;
      }

      const item = when === 'Change' ? object.item : [...object.item, 0x2f, ...bytesOf(when)];
      const atom = await svr.addAtomText(item);

      await post(svr, advise.conv, WM_DDE_DATA, doc.hwnd, long(data, atom));
    }
  }
}

// What a server's object is asked.

/** An object of a document by its item, asked for once (**recorded** by `olesrv`); null where its document refuses. */
async function objectOf(svr: Svr, doc: SvrDoc, item: number[], conv: number) {
  let object = doc.objects.find((each) => same(each.item, item));

  if (!object) {
    const client = svr.newClient();
    const out = svr.outArg();
    const status = await method(svr, doc.doc, DOC.GetObject, [
      [svr.stringArg(item), FAR],
      [out, FAR],
      [client, FAR],
    ]);

    if (status !== OLE_OK || !svr.r32(out)) {
      svr.freeClient(client);
      return null;
    }

    object = { item, object: svr.r32(out), client, targeted: false, convs: [] };
    doc.objects.push(object);
    svr.svr().clients.set(client, { doc: doc.hwnd, object });
  }

  if (!object.convs.includes(conv)) {
    object.convs.push(conv);
  }

  return object;
}

/** Whether an object enumerates a format: its formats asked from the first until it is found or they end. */
async function enumerates(svr: Svr, object: SvrObject, format: number) {
  let at = 0;

  for (let i = 0; i < 0x100; i++) {
    at = await method(svr, object.object, OBJECT.EnumFormats, [[at, WORD]]);

    if (!at) {
      return false;
    }

    if (at === format) {
      return true;
    }
  }

  return false;
}

/** An object's data in a format: the handle it gave, or nought. The target device poked given it first, once. */
async function getData(svr: Svr, doc: SvrDoc, object: SvrObject, format: number) {
  if (doc.target && !object.targeted) {
    object.targeted = true;
    await method(svr, object.object, OBJECT.SetTargetDevice, [
      [await shared(svr, doc.target), WORD],
    ]);
  }

  const out = svr.outArg();
  const status = await method(svr, object.object, OBJECT.GetData, [
    [format, WORD],
    [out, FAR],
  ]);

  return status === OLE_OK ? svr.r16(out) : 0;
}

/** Formats whose data is a handle, handed on: a picture, a bitmap, a palette. */
const BY_HANDLE = [CF_METAFILEPICT, CF_BITMAP, CF_PALETTE];

/** A `DDEDATA` block of an object's data in a format, with the flags given; nought where it gives none. */
async function dataBlock(svr: Svr, doc: SvrDoc, object: SvrObject, format: number, flags: number) {
  const handle = await getData(svr, doc, object, format);

  if (!handle) {
    return 0;
  }

  if (BY_HANDLE.includes(format)) {
    return shared(svr, [...word(flags), ...word(format), ...word(handle)]);
  }

  const bytes = await blockBytes(svr, handle);

  await svr.globalFree(handle);
  return shared(svr, [...word(flags), ...word(format), ...bytes]);
}

// The windows' procedures.

/** `SRVRWNDPROC` (21): a server's window, its system conversations and its documents' initiates. */
export async function srvrWndProc(
  svr: Svr,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const server = svr.svr().servers.get(hwnd);

  if (!server || message < WM_DDE_INITIATE || message > WM_DDE_EXECUTE) {
    return svr.user('DefWindowProc', [W(hwnd), W(message), W(wParam), D(lParam)]);
  }

  if (message === WM_DDE_INITIATE) {
    await initiated(svr, server, wParam, lParam & 0xffff, lParam >>> 16);
    return 0;
  }

  if (server.blocked) {
    server.queue.push([hwnd, message, wParam, lParam]);
    return 0;
  }

  await handle_(svr, hwnd, message, wParam, lParam);
  return 0;
}

/** `DOCWNDPROC` (22): a document's window, its conversations. */
export async function docWndProc(
  svr: Svr,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const doc = svr.svr().docs.get(hwnd);
  const server = doc && svr.svr().servers.get(doc.server);

  if (!doc || message <= WM_DDE_INITIATE || message > WM_DDE_EXECUTE) {
    return svr.user('DefWindowProc', [W(hwnd), W(message), W(wParam), D(lParam)]);
  }

  if (server?.blocked) {
    server.queue.push([hwnd, message, wParam, lParam]);
    return 0;
  }

  await handle_(svr, hwnd, message, wParam, lParam);
  return 0;
}

/**
 * `WM_DDE_INITIATE` broadcast, which only a top-level window is sent: the
 * class's system topic answered by its server's window, `OLEsystem` and
 * not `System`, and only where it may take a document -- a server of
 * `OLE_SERVER_MULTI` with one takes no more; a document's name by the
 * document's window (**recorded** by `olesrv`).
 */
async function initiated(svr: Svr, server: Server, client: number, app: number, topic: number) {
  const appName = await atomText(svr, app);
  const topicName = await atomText(svr, topic);

  if (server.revoking || (app && !same(appName, server.klass))) {
    return;
  }

  let from = 0;

  if (same(topicName, bytesOf('OLEsystem'))) {
    if (!server.multi || !server.docs.length) {
      from = server.hwnd;
      server.convs.push(client);
    }
  } else {
    const doc = server.docs
      .map((hwnd) => docOf(svr, hwnd))
      .find((each) => each && !each.revoking && same(each.name, topicName));

    if (doc) {
      from = doc.hwnd;
      doc.convs.push(client);
    }
  }

  if (from) {
    const a = await svr.addAtomText(server.klass);
    const t = await svr.addAtomText(topicName);

    await svr.user('SendMessage', [W(client), W(WM_DDE_ACK), W(from), D(long(a, t))]);
  }
}

/** A message a client posted to a server's or a document's window, handled. */
async function handle_(svr: Svr, hwnd: number, message: number, wParam: number, lParam: number) {
  const server = svr.svr().servers.get(hwnd);
  const doc = svr.svr().docs.get(hwnd);
  const low = lParam & 0xffff;
  const high = lParam >>> 16;

  if (message === WM_DDE_TERMINATE) {
    await terminated(svr, hwnd, wParam);
  } else if (server) {
    if (message === WM_DDE_EXECUTE) {
      await systemExecute(svr, server, wParam, high);
    } else if (message === WM_DDE_REQUEST) {
      await systemRequest(svr, server, wParam, low, high);
    }
  } else if (doc) {
    if (message === WM_DDE_EXECUTE) {
      await docExecute(svr, doc, wParam, high);
    } else if (message === WM_DDE_REQUEST) {
      await docRequest(svr, doc, wParam, low, high);
    } else if (message === WM_DDE_ADVISE) {
      await docAdvise(svr, doc, wParam, low, high);
    } else if (message === WM_DDE_UNADVISE) {
      await docUnadvise(svr, doc, wParam, low, high);
    } else if (message === WM_DDE_POKE) {
      await docPoke(svr, doc, wParam, low, high);
    }
  }
}

/** A client's `WM_DDE_TERMINATE`: answered unless it answers WinBox's, the conversation forgotten. */
async function terminated(svr: Svr, hwnd: number, client: number) {
  const key = `${hwnd}:${client}`;
  const server = svr.svr().servers.get(hwnd);
  const doc = svr.svr().docs.get(hwnd);

  if (!svr.svr().terminating.delete(key) && !server?.revoking && !doc?.revoking) {
    await post(svr, client, WM_DDE_TERMINATE, hwnd, 0);
  }

  if (server) {
    server.convs = server.convs.filter((conv) => conv !== client);

    if (server.revoking) {
      await finishServer(svr, server);
    }
  }

  if (doc) {
    doc.convs = doc.convs.filter((conv) => conv !== client);
    doc.advises = doc.advises.filter((advise) => advise.conv !== client);
    doc.named = doc.named.filter((conv) => conv !== client);

    if (doc.revoking && !doc.convs.length) {
      await releaseDoc(svr, doc);
    }
  }
}

async function ack(svr: Svr, to: number, from: number, status: number, high: number) {
  await post(svr, to, WM_DDE_ACK, from, long(status, high));
}

/**
 * An execute on the system topic: `StdNewDocument(class,doc)`,
 * `StdEditDocument(doc)`, `StdOpenDocument(doc)`,
 * `StdNewFromTemplate(class,doc,template)` -- a document made by the
 * server's method, refused where it may take none -- and `StdExit`; any
 * other `Std` command, or text not in brackets, refused; anything else the
 * server's `Execute`, its answer the acknowledgement's (**recorded** by
 * `olesrv`).
 */
async function systemExecute(svr: Svr, server: Server, client: number, commands: number) {
  const parsed = parse(await commandText(svr, commands));
  let ok = false;

  if (parsed?.length && !isStd(parsed[0])) {
    ok = (await method(svr, server.pointer, SERVER.Execute, [[commands, WORD]])) === OLE_OK;
  } else if (parsed?.length === 1) {
    ok = await systemCommand(svr, server, parsed[0]);
  }

  await ack(svr, client, server.hwnd, ok ? ACK : NACK, commands);
}

async function systemCommand(svr: Svr, server: Server, command: Command): Promise<boolean> {
  const { args } = command;

  if (named(command, 'StdExit') && !args.length) {
    return (await method(svr, server.pointer, SERVER.Exit, [])) === OLE_OK;
  }

  const shape: [string, number, number][] = [
    ['StdNewDocument', 2, SERVER.Create],
    ['StdEditDocument', 1, SERVER.Edit],
    ['StdOpenDocument', 1, SERVER.Open],
    ['StdNewFromTemplate', 3, SERVER.CreateFromTemplate],
  ];
  const found = shape.find(([name, count]) => named(command, name) && args.length === count);

  if (!found || (server.multi && server.docs.length)) {
    return false;
  }

  const [, , slot] = found;
  const docName = slot === SERVER.Open || slot === SERVER.Edit ? args[0] : args[1];
  const doc = await newDoc(svr, server, docName);
  const out = svr.outArg();
  const strings =
    slot === SERVER.Open ? [args[0]] : slot === SERVER.Edit ? [server.klass, args[0]] : args;
  const status = await method(svr, server.pointer, slot, [
    [doc.hwnd, FAR],
    ...strings.map((bytes): [number, number] => [svr.stringArg(bytes), FAR]),
    [out, FAR],
  ]);

  if (status !== OLE_OK || !svr.r32(out)) {
    await svr.user('DestroyWindow', [W(doc.hwnd)]);
    return false;
  }

  doc.doc = svr.r32(out);
  keepDoc(svr, server, doc);
  return true;
}

/** What the system topic answers: its topics, the formats, its status (**recorded** by `olesrv`); any other item acknowledged with no data. */
const SYSTEM_ITEMS: [string, string][] = [
  ['Topics', 'Doc'],
  ['Formats', 'Picture\tBitmap'],
  ['Status', 'Ready'],
];

async function systemRequest(
  svr: Svr,
  server: Server,
  client: number,
  format: number,
  item: number
) {
  const name = await atomText(svr, item);
  const answer = SYSTEM_ITEMS.find(([each]) => same(name, bytesOf(each)));

  if (!answer) {
    await ack(svr, client, server.hwnd, ACK, item);
    return;
  }

  const block = await shared(svr, [
    ...word(DATA_RESPONSE),
    ...word(format || CF_TEXT),
    ...bytesOf(answer[1]),
    0,
  ]);

  await post(svr, client, WM_DDE_DATA, server.hwnd, long(block, item));
}

/**
 * An execute on a document's topic: `StdShowItem(item[,focus])` -- the
 * object's `Show`, told to take the focus unless asked not to --,
 * `StdDoVerbItem(item,verb,show,focus)` -- its `DoVerb`, the focus as
 * `StdShowItem` turns it -- and `StdCloseDocument`, acknowledged before
 * the document's `Close`; anything else the document's `Execute`
 * (**recorded** by `olesrv`).
 */
async function docExecute(svr: Svr, doc: SvrDoc, client: number, commands: number) {
  const parsed = parse(await commandText(svr, commands));
  const command = parsed?.length === 1 ? parsed[0] : null;
  let status = OLE_OK;

  if (command && named(command, 'StdCloseDocument')) {
    await ack(svr, client, doc.hwnd, ACK, commands);
    await method(svr, doc.doc, DOC.Close, []);
    return;
  }

  if (command && named(command, 'StdShowItem') && command.args.length >= 1) {
    const object = await objectOf(svr, doc, command.args[0], client);

    status = object
      ? await method(svr, object.object, OBJECT.Show, [[truth(command.args[1]) ? 0 : 1, WORD]])
      : 1;
  } else if (command && named(command, 'StdDoVerbItem') && command.args.length >= 1) {
    const object = await objectOf(svr, doc, command.args[0], client);
    const [, verb, show, focus] = command.args;

    status = object
      ? await method(svr, object.object, OBJECT.DoVerb, [
          [truth(verb), WORD],
          [truth(show), WORD],
          [truth(focus) ? 0 : 1, WORD],
        ])
      : 1;
  } else {
    status = await method(svr, doc.doc, DOC.Execute, [[commands, WORD]]);
  }

  await ack(svr, client, doc.hwnd, status === OLE_OK ? ACK : NACK, commands);
}

/** An item of a document, as advised: its name, and when -- `Change` where it names none. */
function itemWhen(name: number[]): [number[], string] {
  const slash = name.lastIndexOf(0x2f);

  if (slash < 0) {
    return [name, 'Change'];
  }

  return [name.slice(0, slash), String.fromCharCode(...name.slice(slash + 1))];
}

/**
 * A request of a document's item: its object's formats enumerated until
 * the one asked for, its data in `DDEDATA` as an answer; refused where the
 * document has no such item or it no such format (**recorded** by
 * `olesrv`).
 */
async function docRequest(svr: Svr, doc: SvrDoc, client: number, format: number, item: number) {
  const object = await objectOf(svr, doc, await atomText(svr, item), client);
  const block =
    object && (await enumerates(svr, object, format))
      ? await dataBlock(svr, doc, object, format, DATA_RESPONSE)
      : 0;

  if (!block) {
    await ack(svr, client, doc.hwnd, NACK, item);
    return;
  }

  await post(svr, client, WM_DDE_DATA, doc.hwnd, long(block, item));
}

/**
 * An advise of a document's item: `StdDocumentName` kept; else the
 * object's formats enumerated until the one advised, and the format and
 * when kept. Acknowledged only where the advise asks its data be
 * acknowledged (**recorded** by `olesrv`: an advise without `fAckReq` is
 * answered with nothing); refused where there is no such item.
 */
async function docAdvise(svr: Svr, doc: SvrDoc, client: number, options: number, item: number) {
  const name = await atomText(svr, item);
  const at = await svr.globalLock(options);
  const flags = at ? svr.r16(at) : 0;
  const format = at ? svr.r16(plus(at, 2)) : 0;

  await svr.globalUnlock(options);

  if (same(name, bytesOf('StdDocumentName'))) {
    if (!doc.named.includes(client)) {
      doc.named.push(client);
    }
  } else {
    const [base, when] = itemWhen(name);
    const object = await objectOf(svr, doc, base, client);

    if (!object || !(await enumerates(svr, object, format))) {
      await ack(svr, client, doc.hwnd, NACK, item);
      return;
    }

    let advise: Advise | undefined = doc.advises.find(
      (each) => each.conv === client && each.object === object
    );

    if (!advise) {
      advise = { conv: client, object, formats: [], whens: new Set() };
      doc.advises.push(advise);
    }

    if (!advise.formats.includes(format)) {
      advise.formats.push(format);
    }

    advise.whens.add(when);
  }

  await svr.globalFree(options);

  if (flags & ADVISE_ACK_REQ) {
    await ack(svr, client, doc.hwnd, ACK, item);
  } else {
    await svr.deleteAtom(item);
  }
}

/** An unadvise: the format, or every format where it names none, no longer sent. */
async function docUnadvise(svr: Svr, doc: SvrDoc, client: number, format: number, item: number) {
  const name = await atomText(svr, item);

  if (same(name, bytesOf('StdDocumentName'))) {
    doc.named = doc.named.filter((conv) => conv !== client);
  } else {
    const [base] = itemWhen(name);

    for (const advise of doc.advises) {
      if (advise.conv === client && same(advise.object.item, base)) {
        advise.formats = format ? advise.formats.filter((each) => each !== format) : [];

        if (!format) {
          advise.whens.clear();
        }
      }
    }
  }

  await ack(svr, client, doc.hwnd, ACK, item);
}

/**
 * A poke of a document's item: `StdHostNames` the document's
 * `SetHostNames`, `StdDocDimensions` its `SetDocDimensions` -- the first
 * width and height as a rectangle from nought, the height its top --,
 * `StdColorScheme` its `SetColorScheme`, `StdTargetDevice` kept for each
 * object's first data; any other item its object's `SetData`, a block of
 * the data alone (**recorded** by `olesrv`).
 */
async function docPoke(svr: Svr, doc: SvrDoc, client: number, data: number, item: number) {
  const name = await atomText(svr, item);
  const at = await svr.globalLock(data);
  const flags = at ? svr.r16(at) : 0;
  const format = at ? svr.r16(plus(at, 2)) : 0;
  const value = plus(at, 4);
  const size = Math.max((await svr.globalSize(data)) - 4, 0);
  let status = OLE_OK;

  if (same(name, bytesOf('StdHostNames'))) {
    status = await method(svr, doc.doc, DOC.SetHostNames, [
      [plus(value, 4 + svr.r16(value)), FAR],
      [plus(value, 4 + svr.r16(plus(value, 2))), FAR],
    ]);
  } else if (same(name, bytesOf('StdDocDimensions'))) {
    const rect = svr.near(RECT_AT);
    const width = signed16(svr.r16(value));
    const height = signed16(svr.r16(plus(value, 2)));

    svr.write(rect, [...word(0), ...word(height), ...word(width), ...word(0)]);
    status = await method(svr, doc.doc, DOC.SetDocDimensions, [[rect, FAR]]);
  } else if (same(name, bytesOf('StdColorScheme'))) {
    status = await method(svr, doc.doc, DOC.SetColorScheme, [[value, FAR]]);
  } else if (same(name, bytesOf('StdTargetDevice'))) {
    doc.target = svr.read(value, size);

    for (const object of doc.objects) {
      object.targeted = false;
    }
  } else {
    const object = await objectOf(svr, doc, name, client);

    if (object) {
      const copy = BY_HANDLE.includes(format)
        ? svr.r16(value)
        : await shared(svr, svr.read(value, size));

      status = await method(svr, object.object, OBJECT.SetData, [
        [format, WORD],
        [copy, WORD],
      ]);
    } else {
      status = 1;
    }
  }

  await svr.globalUnlock(data);

  if (status === OLE_OK && flags & 0x2000) {
    await svr.globalFree(data);
  }

  await ack(svr, client, doc.hwnd, status === OLE_OK ? ACK : NACK, item);
}
