'use strict';

import { B, D, W, buffer, stringOf, text } from '../commdlg/api.js';
import { bytesOf, plus, signed16 } from '../olecli/core.js';
import { DWORD, UINT } from '../types.js';
import {
  ACK,
  ADVISE_ACK_REQ,
  ADVISE_DEFER,
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
  DELETECLIENTINFO,
  DESTROY_ITEM,
  DOC_TEXT,
  ENUMFORTERMINATE,
  FIND_ITEM,
  FINDITEMWND,
  FORGET_CLIENT,
  GMEM_ZEROINIT,
  INFO_CLIENT,
  INFO_DATA,
  INFO_FORMAT,
  INFO_NATIVE,
  INFO_WHENS,
  ITEM_ATOM,
  ITEM_HANDLE,
  ITEM_HWND,
  ITEM_OBJECT,
  ITEM_SIZE,
  ITEM_TEXT,
  ITEM_VTBL,
  OLE_ERROR_CANT_UPDATE_CLIENT,
  SENDDATAMSG,
  SENDRENAMEMSG,
  TELL_SAVED,
  TERMINATECLIENTS,
  TERMINATEDOCCLIENTS,
  WHENS,
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
 * OLE 1.0's documented interface and protocol and from what the probes
 * `olesrv` and `oleitem` measured under DOSBox -- the messages on the
 * wire, the methods the server is called with, in their order, and the
 * windows and properties a client's conversation leaves -- not from the
 * code of `OLESVR.DLL` (`kb/topics/ole.md`). Where a read-out of the file
 * settled what no probe could -- which of its internal procedures does
 * what, and the fields of what it keeps -- it is cited and described.
 *
 * Its clients are kept as the file keeps them: each conversation as a
 * property of its server's or document's window, named `@` and the
 * client's window in four hex digits; each object as a window of
 * `ItemWndClass` beneath its document's, its words the `OLECLIENT` the
 * object was given; and what each client asked of an item as that
 * client's property on the item's window. USER's `EnumProps` and
 * `EnumChildWindows` walk them, calling the internal exports as the file
 * does. As `crates/winbox-win16/src/olesvr/server.rs`.
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

  for (const ordinal of [
    SENDDATAMSG,
    FINDITEMWND,
    TERMINATECLIENTS,
    TERMINATEDOCCLIENTS,
    DELETECLIENTINFO,
    SENDRENAMEMSG,
    ENUMFORTERMINATE,
  ]) {
    state.procs[ordinal] = address(ordinal);
  }
}

// Windows and messages.

async function makeWindow(svr: Svr, klass: string, title: string, style: number, parent: number) {
  const at = svr.near(CLASS_NAME);

  svr.write(at, [...bytesOf(klass), 0]);
  return (
    (await svr.user('CreateWindow', [
      D(at),
      text(bytesOf(title)),
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

// What it keeps on windows.

/** A client's property's name on a window of OLESVR's: `@` and its window in four hex digits, capitals (read out, seg3 `358c`-`35e6`). */
function propName(client: number): number[] {
  return bytesOf(`@${(client & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`);
}

async function setProp(svr: Svr, hwnd: number, client: number, data: number) {
  return svr.user('SetProp', [W(hwnd), text(propName(client)), W(data)]);
}

async function getProp(svr: Svr, hwnd: number, client: number) {
  return (await svr.user('GetProp', [W(hwnd), text(propName(client))])) & 0xffff;
}

async function removeProp(svr: Svr, hwnd: number, client: number) {
  return svr.user('RemoveProp', [W(hwnd), text(propName(client))]);
}

/** A window's properties each handed one of OLESVR's procedures, as the file walks them. */
async function eachProp(svr: Svr, hwnd: number, ordinal: number) {
  await svr.user('EnumProps', [W(hwnd), D(svr.svr().procs[ordinal])]);
}

/** A document's items each handed `FINDITEMWND`, with a request and its word. */
async function eachItem(svr: Svr, doc: SvrDoc, request: number, value: number) {
  await svr.user('EnumChildWindows', [
    W(doc.hwnd),
    D(svr.svr().procs[FINDITEMWND]),
    D(long(value, request)),
  ]);
}

async function isWindow(svr: Svr, hwnd: number) {
  return (hwnd & 0xffff) !== 0 && (await svr.user('IsWindow', [W(hwnd)])) !== 0;
}

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

  const hwnd = await makeWindow(svr, 'SrvrWndClass', '', 0, 0);
  const record = svr.newRecord(server);

  await svr.user('SetWindowLong', [W(hwnd), W(0), D(record)]);
  svr.svr().servers.set(hwnd, {
    hwnd,
    klass: name,
    pointer: server,
    record,
    multi: (use & 0xffff) === OLE_SERVER_MULTI,
    fresh: false,
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
  const hwnd = await makeWindow(svr, 'DocWndClass', DOC_TEXT, WS_CHILD, server.hwnd);
  const record = svr.newRecord(0);

  await svr.user('SetWindowLong', [W(hwnd), W(0), D(record)]);

  return {
    hwnd,
    server: server.hwnd,
    name,
    doc: 0,
    record,
    convs: [],
    objects: [],
    named: [],
    target: null,
    embedded: false,
    revoking: false,
  };
}

/** A document's pointer kept, and in its window words' record. */
function docPointer(svr: Svr, doc: SvrDoc, pointer: number) {
  doc.doc = pointer;
  svr.w32(doc.record, pointer);
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
  pointer: number,
  out: number
) {
  const server = serverOf(svr, handle);

  if (!server || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  const doc = await newDoc(svr, server, svr.string(name));

  docPointer(svr, doc, pointer);
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
  svr.freeRecord(doc.record);

  if (server?.revoking) {
    await finishServer(svr, server);
  } else if (server) {
    await releaseIdle(svr, server);
  }
}

/**
 * An object let go, its item with it (read out, seg3 `2164`-`222b`): its
 * `Release`; the item's atom deleted; its window's words cleared; each
 * client's property handed `DELETECLIENTINFO`; its window destroyed; its
 * block unlocked and freed.
 */
async function releaseObject(svr: Svr, doc: SvrDoc, object: SvrObject) {
  const state = svr.svr();

  doc.objects = doc.objects.filter((each) => each !== object);
  state.clients.delete(object.client);
  await method(svr, object.object, OBJECT.Release, []);

  if (object.atom) {
    await svr.deleteAtom(object.atom);
  }

  await svr.user('SetWindowLong', [W(object.hwnd), W(0), D(0)]);
  state.ending = false;
  await eachProp(svr, object.hwnd, DELETECLIENTINFO);
  await svr.user('DestroyWindow', [W(object.hwnd)]);
  await svr.globalUnlock(object.handle);
  await svr.globalFree(object.handle);
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

/**
 * A server no client is connected to told so by its `Release`, as a
 * client ends its last conversation or a document goes (read out, seg3
 * `1024`-`108b`, called from `0969`, `1636` and `18ce`): unless a document
 * was just made for a client that has yet to begin its conversation, or
 * a system conversation or any document's is left. The server stays
 * registered (**recorded** by `oleitem`: its `Release` as the system
 * conversation ends, and again at `OleRevokeServer`).
 */
async function releaseIdle(svr: Svr, server: Server) {
  if (server.fresh) {
    server.fresh = false;
    return;
  }

  if (server.convs.length) {
    return;
  }

  for (const hwnd of server.docs) {
    if (docOf(svr, hwnd)?.convs.length) {
      return;
    }
  }

  await method(svr, server.pointer, SERVER.Release, []);
}

/** A server let go once nothing of it is left: its `Release`, its window. */
async function finishServer(svr: Svr, server: Server) {
  if (server.convs.length || server.docs.length || !svr.svr().servers.has(server.hwnd)) {
    return;
  }

  svr.svr().servers.delete(server.hwnd);
  await method(svr, server.pointer, SERVER.Release, []);
  await svr.user('DestroyWindow', [W(server.hwnd)]);
  svr.freeRecord(server.record);
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
  doc.embedded = false;
  await tellName(svr, doc, doc.name);
  return OLE_OK;
}

/** `OleRevertServerDoc`: nothing seen (**recorded** by `olesrv`). */
export function revertServerDoc(svr: Svr, handle: number) {
  return docOf(svr, handle) && !(handle >>> 16) ? OLE_OK : OLE_ERROR_HANDLE;
}

/**
 * `OleSavedServerDoc`: each item with an object handed `FINDITEMWND` to
 * be told saved, in the order made (read out, seg3 `14ba`-`1525`); an
 * embedded document one of whose objects no client was sent at a save
 * answers `OLE_ERROR_CANT_UPDATE_CLIENT` (**recorded** by `oleitem`).
 */
export async function savedServerDoc(svr: Svr, handle: number) {
  const doc = docOf(svr, handle);

  if (!doc || handle >>> 16) {
    return OLE_ERROR_HANDLE;
  }

  svr.svr().saved = true;
  await eachItem(svr, doc, TELL_SAVED, 0);

  return doc.embedded && !svr.svr().saved ? OLE_ERROR_CANT_UPDATE_CLIENT : OLE_OK;
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

  const given = [...found.object.convs];

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
 * its server tells of it sent to the clients that advised it -- its
 * item's properties each handed `SENDDATAMSG` with the time (read out,
 * seg3 `2c04`-`2c4e`). A save that reached no client of an embedded
 * document answers `OLE_ERROR_CANT_UPDATE_CLIENT` (**recorded** by
 * `oleitem`).
 */
export async function itemCallback(svr: Svr, client: number, what: number, _object: number) {
  const found = svr.svr().clients.get(client >>> 0);
  const doc = found && docOf(svr, found.doc);

  if (!found || !doc) {
    return OLE_OK;
  }

  if (what === OLE_CHANGED || what === OLE_SAVED || what === OLE_CLOSED) {
    const state = svr.svr();
    const when = what === OLE_CHANGED ? 'Change' : what === OLE_SAVED ? 'Save' : 'Close';

    state.when = WHENS[when];
    state.object = found.object.object;
    state.sent = false;
    await eachProp(svr, found.object.hwnd, SENDDATAMSG);

    if (what === OLE_SAVED && doc.embedded && !state.sent) {
      return OLE_ERROR_CANT_UPDATE_CLIENT;
    }
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
        doc.embedded = false;
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

/** An item's name as data is sent of it at a time: the item, and `/Save` or `/Close` after it. */
function itemAt(item: number[], when: number): number[] {
  const name = Object.keys(WHENS).find((each) => WHENS[each] === when) ?? 'Change';

  return when === WHENS.Change ? item : [...item, 0x2f, ...bytesOf(name)];
}

// What a server's object is asked.

/** An item's window found by its atom, `FINDITEMWND` handed each (read out, seg3 `1f00`-`1f38`): its object, or none. */
async function findItem(svr: Svr, doc: SvrDoc, item: number[]) {
  const atom = item.length ? (await svr.user('GlobalFindAtom', [text(item)])) & 0xffff : 0;
  const state = svr.svr();

  state.found = 0;
  await eachItem(svr, doc, FIND_ITEM, atom);
  return doc.objects.find((each) => each.hwnd === state.found) ?? null;
}

/**
 * An item made: its block, `GMEM_MOVEABLE | GMEM_ZEROINIT |
 * GMEM_DDESHARE`, locked; the item's atom; the block given its document's
 * `GetObject` as the object's `OLECLIENT`; then its window, its words the
 * block (read out, seg3 `1feb`-`2108`; **recorded** by `oleitem`). Null
 * where the document gives no object.
 */
async function newItem(svr: Svr, doc: SvrDoc, item: number[]) {
  const handle = await svr.globalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE, ITEM_SIZE);
  const client = handle ? await svr.globalLock(handle) : 0;

  if (!client) {
    return null;
  }

  const atom = item.length ? await svr.addAtomText(item) : 0;

  svr.w32(plus(client, ITEM_VTBL), svr.near(CLIENT_VTBL));
  svr.w16(plus(client, ITEM_HANDLE), handle);
  svr.w16(plus(client, ITEM_ATOM), atom);

  const out = svr.outArg();
  const status = await method(svr, doc.doc, DOC.GetObject, [
    [svr.stringArg(item), FAR],
    [out, FAR],
    [client, FAR],
  ]);

  if (status !== OLE_OK || !svr.r32(out)) {
    if (atom) {
      await svr.deleteAtom(atom);
    }

    await svr.globalUnlock(handle);
    await svr.globalFree(handle);
    return null;
  }

  svr.w32(plus(client, ITEM_OBJECT), svr.r32(out));

  const hwnd = await makeWindow(svr, 'ItemWndClass', ITEM_TEXT, WS_CHILD, doc.hwnd);

  svr.w16(plus(client, ITEM_HWND), hwnd);
  await svr.user('SetWindowLong', [W(hwnd), W(0), D(client)]);

  const object: SvrObject = {
    item,
    object: svr.r32(out),
    client,
    handle,
    atom,
    hwnd,
    targeted: false,
    convs: [],
  };

  doc.objects.push(object);
  svr.svr().clients.set(client, { doc: doc.hwnd, object });
  return object;
}

/** An object of a document by its item, asked for once (**recorded** by `olesrv`); null where its document refuses. */
async function objectOf(svr: Svr, doc: SvrDoc, item: number[], conv: number) {
  const object = (await findItem(svr, doc, item)) ?? (await newItem(svr, doc, item));

  if (object && !object.convs.includes(conv)) {
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
 * `OLE_SERVER_MULTI` with one, or with a system conversation already,
 * takes no more; a document's name by the document's window (**recorded**
 * by `olesrv` and `oleitem`). The conversation kept as the client's
 * property of the window that answered, its datum the client's window.
 */
async function initiated(svr: Svr, server: Server, client: number, app: number, topic: number) {
  const appName = await atomText(svr, app);
  const topicName = await atomText(svr, topic);

  if (server.revoking || (app && !same(appName, server.klass))) {
    return;
  }

  let from = 0;

  if (same(topicName, bytesOf('OLEsystem'))) {
    if (!server.multi || (!server.docs.length && !server.convs.length)) {
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
    server.fresh = false;
    await setProp(svr, from, client, client);
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
    if (server.convs.includes(client)) {
      await removeProp(svr, hwnd, client);
    }

    const was = server.convs.includes(client);

    server.convs = server.convs.filter((conv) => conv !== client);

    if (server.revoking) {
      await finishServer(svr, server);
    } else if (was) {
      await releaseIdle(svr, server);
    }
  }

  if (doc) {
    if (doc.convs.includes(client)) {
      await removeProp(svr, hwnd, client);
      await eachItem(svr, doc, FORGET_CLIENT, client);
    }

    const was = doc.convs.includes(client);
    const owner = svr.svr().servers.get(doc.server);

    doc.convs = doc.convs.filter((conv) => conv !== client);
    doc.named = doc.named.filter((conv) => conv !== client);

    if (doc.revoking && !doc.convs.length) {
      await releaseDoc(svr, doc);
    } else if (!doc.revoking && was && owner && !owner.revoking) {
      await releaseIdle(svr, owner);
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
    svr.freeRecord(doc.record);
    return false;
  }

  docPointer(svr, doc, svr.r32(out));
  /* Made for a client to embed, not opened from a file (read out, seg3
   * `0dda`-`0e0d`): what `OleSavedServerDoc` and a save hold it to. */
  doc.embedded = slot !== SERVER.Open;
  keepDoc(svr, server, doc);
  server.fresh = true;
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
 * What a client advised of an item, kept in its block, the datum of its
 * property on the item's window (read out, seg3 `26a9`-`2735`): native
 * data marked, any other format in place of the last; the time's bit
 * added; whether data goes with it, as the advise asks. The property set
 * again, last of the window's (**recorded** by `oleitem`: native data is
 * sent first, then the one other format last advised).
 */
async function advised(
  svr: Svr,
  object: SvrObject,
  client: number,
  format: number,
  flags: number,
  when: string
) {
  let info = await getProp(svr, object.hwnd, client);

  if (!svr.isInfo(info)) {
    info = svr.newInfo();
  }

  svr.setInfo(info, INFO_CLIENT, client);

  if (format === svr.svr().formats.Native) {
    svr.setInfo(info, INFO_NATIVE, 1);
  } else {
    svr.setInfo(info, INFO_FORMAT, format);
  }

  if (when in WHENS) {
    svr.setInfo(info, INFO_WHENS, svr.info(info, INFO_WHENS) | (1 << WHENS[when]));
  }

  svr.setInfo(info, INFO_DATA, flags & ADVISE_DEFER ? 0 : 1);
  await removeProp(svr, object.hwnd, client);
  await setProp(svr, object.hwnd, client, info);
}

/**
 * An advise of a document's item: `StdDocumentName` kept; else the
 * object's formats enumerated until the one advised, and what was asked
 * kept on the item's window (`advised`). Acknowledged only where the
 * advise asks its data be acknowledged (**recorded** by `olesrv`: an
 * advise without `fAckReq` is answered with nothing); refused where there
 * is no such item.
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

    await advised(svr, object, client, format, flags, when);
  }

  await svr.globalFree(options);

  if (flags & ADVISE_ACK_REQ) {
    await ack(svr, client, doc.hwnd, ACK, item);
  } else {
    await svr.deleteAtom(item);
  }
}

/**
 * An unadvise (read out, seg3 `24bc`-`2586`): of the document itself, the
 * client forgotten by every item, `FINDITEMWND` handed each; of an item,
 * the time's bit taken from the client's block, whatever the format --
 * its property stays (**recorded** by `oleitem`: native data is no longer
 * sent once another format is unadvised).
 */
async function docUnadvise(svr: Svr, doc: SvrDoc, client: number, _format: number, item: number) {
  const name = await atomText(svr, item);

  if (same(name, bytesOf('StdDocumentName'))) {
    doc.named = doc.named.filter((conv) => conv !== client);
  } else if (!name.length) {
    await eachItem(svr, doc, FORGET_CLIENT, client);
  } else {
    const [base, when] = itemWhen(name);
    const object = await findItem(svr, doc, base);
    const info = object ? await getProp(svr, object.hwnd, client) : 0;

    if (svr.isInfo(info) && when in WHENS) {
      svr.setInfo(info, INFO_WHENS, svr.info(info, INFO_WHENS) & ~(1 << WHENS[when]));
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

// The procedures it hands USER, its internal exports.

/**
 * `SENDDATAMSG` (24), for `EnumProps` of an item's window: one client's
 * data sent where it advised the time `ITEMCALLBACK` tells (read out, seg3
 * `2d3c`-`2edc`) -- native data first where it asked for it, then the one
 * other format, each asked of the object for that client; a deferred
 * advise's sent with no data. From the document's window, the item named
 * at its time. A word that names no client's block, or a client gone,
 * sends nothing (**recorded** by `oleitem`). Always 1.
 */
export async function sendDataMsg(svr: Svr, hwnd: number, _name: number, info: number) {
  const state = svr.svr();

  if (!svr.isInfo(info)) {
    return 1;
  }

  const client = svr.info(info, INFO_CLIENT);

  if (!(await isWindow(svr, client)) || !(svr.info(info, INFO_WHENS) & (1 << state.when))) {
    return 1;
  }

  state.sent = true;

  const found = [...state.clients.values()].find((each) => each.object.hwnd === (hwnd & 0xffff));
  const doc = found && docOf(svr, found.doc);

  if (!found || !doc) {
    return 1;
  }

  const formats = [
    ...(svr.info(info, INFO_NATIVE) ? [state.formats.Native] : []),
    ...(svr.info(info, INFO_FORMAT) ? [svr.info(info, INFO_FORMAT)] : []),
  ];

  for (const format of formats) {
    const data = svr.info(info, INFO_DATA)
      ? await dataBlock(svr, doc, found.object, format, DATA_ADVISED)
      : 0;

    if (svr.info(info, INFO_DATA) && !data) {
      return 1;
    }

    const atom = await svr.addAtomText(itemAt(found.object.item, state.when));

    await post(svr, client, WM_DDE_DATA, doc.hwnd, long(data, atom));
  }

  return 1;
}

/**
 * `FINDITEMWND` (25), for `EnumChildWindows` of a document's window: the
 * high word of its `LPARAM` the request, the low its word (read out, seg3
 * `22ac`-`236e`): 1 finds the item whose atom it is, answering nought
 * there to stop; 2 forgets a client, its block freed and its property
 * taken away; 3 lets the item go; 4 tells the item's object saved, noting
 * a save that reached no client. Otherwise 1 (**recorded** by `oleitem`).
 */
export async function findItemWnd(svr: Svr, hwnd: number, lParam: number) {
  const state = svr.svr();
  const value = lParam & 0xffff;
  const request = lParam >>> 16;
  const found = [...state.clients.values()].find((each) => each.object.hwnd === (hwnd & 0xffff));
  const doc = found && docOf(svr, found.doc);

  if (request === FIND_ITEM) {
    if (found && found.object.atom === value) {
      state.found = hwnd & 0xffff;
      return 0;
    }
  } else if (request === FORGET_CLIENT) {
    const info = await getProp(svr, hwnd, value);

    if (info) {
      svr.freeInfo(info);
      await removeProp(svr, hwnd, value);
    }
  } else if (request === DESTROY_ITEM) {
    if (found && doc) {
      await releaseObject(svr, doc, found.object);
    }
  } else if (request === TELL_SAVED) {
    if (found && found.object.object) {
      const answer = await itemCallback(svr, found.object.client, OLE_SAVED, found.object.object);

      if (answer === OLE_ERROR_CANT_UPDATE_CLIENT) {
        state.saved = false;
      }
    }
  }

  return 1;
}

/** A client's conversation ended from a window of OLESVR's, where the client's window is one: whether it was posted. */
async function endConversation(svr: Svr, hwnd: number, client: number) {
  if (!(await isWindow(svr, client))) {
    return false;
  }

  await post(svr, client, WM_DDE_TERMINATE, hwnd, 0);
  return true;
}

/**
 * `TERMINATECLIENTS` (27) and `TERMINATEDOCCLIENTS` (28), for `EnumProps`
 * of a server's and a document's window: the client the datum names sent
 * `WM_DDE_TERMINATE` from the window where it is a window (read out, seg3
 * `0752`-`079e`, `1554`-`15a0`; **recorded** by `oleitem`). Its answer is
 * taken as a client's own terminate, and answered. Always 1.
 */
export async function terminateClients(svr: Svr, hwnd: number, _name: number, client: number) {
  await endConversation(svr, hwnd, client);
  return 1;
}

/**
 * `DELETECLIENTINFO` (29), for `EnumProps` of an item's window: the
 * client's block freed -- its conversation with the document ended first
 * where the item is let go so -- and the property taken away (read out,
 * seg3 `222e`-`22a9`; **recorded** by `oleitem`). Always 1.
 */
export async function deleteClientInfo(svr: Svr, hwnd: number, name: number, info: number) {
  if (svr.isInfo(info)) {
    if (svr.svr().ending) {
      const parent = (await svr.user('GetParent', [W(hwnd)])) & 0xffff;

      await terminateClients(svr, parent, 0, svr.info(info, INFO_CLIENT));
    }

    svr.freeInfo(info);
  }

  await svr.user('RemoveProp', [W(hwnd), D(name)]);
  return 1;
}

/**
 * `SENDRENAMEMSG` (30), for `EnumProps`: the document's name sent to the
 * client a block names, `Binary` under `StdDocumentName`, from the
 * window's parent (read out, seg3 `2cbc`-`2d39`). A word that names no
 * block sends nothing (**recorded** by `oleitem`). Always 1.
 */
export async function sendRenameMsg(svr: Svr, hwnd: number, _name: number, info: number) {
  if (!svr.isInfo(info)) {
    return 1;
  }

  const parent = (await svr.user('GetParent', [W(hwnd)])) & 0xffff;
  const doc = docOf(svr, parent);

  if (doc) {
    const block = await shared(svr, [
      ...word(DATA_ADVISED),
      ...word(svr.svr().formats.Binary),
      ...doc.name,
      0,
    ]);
    const atom = await svr.addAtomText(bytesOf('StdDocumentName'));

    await post(svr, svr.info(info, INFO_CLIENT), WM_DDE_DATA, parent, long(block, atom));
  }

  return 1;
}

/**
 * `ENUMFORTERMINATE` (31), for `EnumProps` of a document's window: the
 * client the datum names sent `WM_DDE_TERMINATE` from the document,
 * unless it is a client of the item set aside (read out, seg3
 * `2c5e`-`2cb8`; **recorded** by `oleitem`). Always 1.
 */
export async function enumForTerminate(svr: Svr, hwnd: number, _name: number, client: number) {
  const spared = svr.svr().spared;

  if (!spared || !(await getProp(svr, spared, client))) {
    await endConversation(svr, hwnd, client);
  }

  return 1;
}
