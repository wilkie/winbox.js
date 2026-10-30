'use strict';

import { Ole, far } from '../olecli/core.js';

/**
 * What WinBox's `OLESVR` stands on: `OLECLI`'s routines for guest memory
 * and for calls into KERNEL, USER and GDI (`olecli/core.ts`), with its own
 * data segment and its own state. As
 * `crates/winbox-win16/src/olesvr/core.rs`.
 *
 * Written from OLE 1.0's documented interface (`ole.h`, the OLE 1.0
 * programmer's reference: the server API and the DDE protocol) and from
 * what the probe `olesrv` measured under DOSBox; nothing here is taken
 * from the code of `OLESVR.DLL` (`kb/topics/ole.md`).
 */

export const NAME = 'OLESVR';
export const PATH = 'C:\\WINDOWS\\SYSTEM\\OLESVR.DLL';

/** `OLESTATUS` (ole.h). */
export const OLE_OK = 0;
export const OLE_WAIT_FOR_RELEASE = 1;
export const OLE_ERROR_ADDRESS = 16;
export const OLE_ERROR_HANDLE = 18;
export const OLE_ERROR_CLASS = 20;

/** `OleQueryServerVersion`'s answer, 1001h (**recorded** by `olesrv`). */
export const SERVER_VERSION = 0x1001;

/** `OLE_SERVER_USE` (ole.h): many instances, one document each; or one instance for every document. */
export const OLE_SERVER_MULTI = 0;

/** The notifications an object's client is told (ole.h). */
export const OLE_CHANGED = 0;
export const OLE_SAVED = 1;
export const OLE_CLOSED = 2;
export const OLE_RENAMED = 3;

/** DDE's messages (dde.h). */
export const WM_DDE_INITIATE = 0x3e0;
export const WM_DDE_TERMINATE = 0x3e1;
export const WM_DDE_ADVISE = 0x3e2;
export const WM_DDE_UNADVISE = 0x3e3;
export const WM_DDE_ACK = 0x3e4;
export const WM_DDE_DATA = 0x3e5;
export const WM_DDE_REQUEST = 0x3e6;
export const WM_DDE_POKE = 0x3e7;
export const WM_DDE_EXECUTE = 0x3e8;

/** A `WM_DDE_ACK`'s status: positive, and negative. */
export const ACK = 0x8000;
export const NACK = 0x0000;
/** A `DDEDATA`'s flags: an answer to a request, the client to free it; data advised, the client to free it (**recorded** by `olesrv`). */
export const DATA_RESPONSE = 0x3000;
export const DATA_ADVISED = 0x2000;
/** A `DDEADVISE`'s `fAckReq`. */
export const ADVISE_ACK_REQ = 0x8000;

export const CF_TEXT = 1;
export const CF_BITMAP = 2;
export const CF_METAFILEPICT = 3;
export const CF_PALETTE = 9;

export const GMEM_MOVEABLE = 0x0002;
export const GMEM_DDESHARE = 0x2000;
export const HKEY_CLASSES_ROOT = 1;
export const WS_CHILD = 0x40000000;

/**
 * Where WinBox's `OLESVR` keeps its own in its data segment, each laid
 * out here: the method table of the `OLECLIENT` it gives a server's
 * object (its one method, `CallBack`, a far pointer to `ITEMCALLBACK`);
 * the name of a window class as it is registered or a window made; the
 * strings and out-pointers a server's methods are given, each in a slot
 * of its own taken in turn; a `RECT` a document's dimensions are given
 * in; and the `OLECLIENT`s themselves, one for each object a server
 * gives, each a far pointer to the table.
 */
export const CLIENT_VTBL = 0x100;
export const CLASS_NAME = 0x180;
export const STRINGS = 0x200;
export const STRING_SLOTS = 8;
export const STRING_SIZE = 0x100;
export const OUTS = 0xa00;
export const OUT_SLOTS = 16;
export const RECT_AT = 0xa80;
/** Where a class's value in the registration database is read into, and its size. */
export const REG_VALUE = 0xb00;
export const REG_SIZE = 0xbfc;
export const CLIENTS = 0x1000;
export const CLIENT_SIZE = 4;
export const CLIENT_SLOTS = 0x400;

/** One object a server's document gave, by its item. */
export interface SvrObject {
  item: number[];
  /** The `LPOLEOBJECT` its document gave. */
  object: number;
  /** The `LPOLECLIENT` WinBox gave for it. */
  client: number;
  /** Whether the target device poked to its document has been given it. */
  targeted: boolean;
  /** The clients' windows of the conversations it was given in. */
  convs: number[];
}

/** What one conversation advised of one object: its formats in the order first advised, and when. */
export interface Advise {
  conv: number;
  object: SvrObject;
  formats: number[];
  whens: Set<string>;
}

/** A document: its window is its handle, `LHSERVERDOC`. */
export interface SvrDoc {
  hwnd: number;
  server: number;
  name: number[];
  /** The `LPOLESERVERDOC`. */
  doc: number;
  /** The clients' windows of its conversations. */
  convs: number[];
  objects: SvrObject[];
  advises: Advise[];
  /** The conversations that advised `StdDocumentName`. */
  named: number[];
  /** A target device poked, its bytes; given each object before its first data. */
  target: number[] | null;
  /** Revoked, waiting for its conversations to end. */
  revoking: boolean;
}

/** A server: its window is its handle, `LHSERVER`. */
export interface Server {
  hwnd: number;
  klass: number[];
  /** The `LPOLESERVER`. */
  pointer: number;
  multi: boolean;
  /** Its documents' windows, in the order made. */
  docs: number[];
  /** The clients' windows of its system conversations. */
  convs: number[];
  blocked: boolean;
  /** Messages posted while blocked: window, message, wParam, lParam. */
  queue: [number, number, number, number][];
  /** Revoked, waiting for its conversations to end. */
  revoking: boolean;
}

/** What WinBox's `OLESVR` keeps beside guest memory. */
export interface SvrState {
  started: boolean;
  instance: number;
  formats: Record<string, number>;
  atoms: Record<string, number>;
  servers: Map<number, Server>;
  docs: Map<number, SvrDoc>;
  /** Each object by its `OLECLIENT`'s far pointer. */
  clients: Map<number, { doc: number; object: SvrObject }>;
  /** The next string slot, out slot and client slot to take. */
  nextString: number;
  nextOut: number;
  freeClients: number[];
  nextClient: number;
  /** The conversations WinBox ended and waits to hear end, as `window:client`. */
  terminating: Set<string>;
}

function newState(): SvrState {
  return {
    started: false,
    instance: 0,
    formats: {},
    atoms: {},
    servers: new Map(),
    docs: new Map(),
    clients: new Map(),
    nextString: 0,
    nextOut: 0,
    freeClients: [],
    nextClient: 0,
    terminating: new Set(),
  };
}

/** WinBox's `OLESVR` as it runs. */
export class Svr extends Ole {
  /** `OLESVR`'s data segment's selector. */
  ds(): number {
    return this.system._moduleData?.[NAME] ?? 0;
  }

  svr(): SvrState {
    return (this.system._olesvr ??= newState());
  }

  /** A string written into the next of the slots for a method's arguments: its far pointer. */
  stringArg(bytes: number[]): number {
    const state = this.svr();
    const at = this.near(STRINGS + (state.nextString % STRING_SLOTS) * STRING_SIZE);

    state.nextString++;
    this.write(at, [...bytes.slice(0, STRING_SIZE - 1), 0]);
    return at;
  }

  /** The next of the slots a method writes a far pointer into, cleared: its far pointer. */
  outArg(): number {
    const state = this.svr();
    const at = this.near(OUTS + (state.nextOut % OUT_SLOTS) * 4);

    state.nextOut++;
    this.w32(at, 0);
    return at;
  }

  /** An `OLECLIENT` for an object, its table WinBox's: its far pointer. */
  newClient(): number {
    const state = this.svr();
    const slot = state.freeClients.shift() ?? state.nextClient++ % CLIENT_SLOTS;
    const at = this.near(CLIENTS + slot * CLIENT_SIZE);

    this.w32(at, this.near(CLIENT_VTBL));
    return at;
  }

  freeClient(client: number) {
    this.svr().clients.delete(client);
    this.svr().freeClients.push(((client & 0xffff) - CLIENTS) / CLIENT_SIZE);
  }
}

export { far };
