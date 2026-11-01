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
 * what the probes `olesrv` and `oleitem` measured under DOSBox; where a
 * read-out of `OLESVR.DLL` settled what no probe could, it is described
 * in prose and cited (`kb/topics/ole.md`).
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
/** A `DDEADVISE`'s `fAckReq`, and its `fDeferUpd`. */
export const ADVISE_ACK_REQ = 0x8000;
export const ADVISE_DEFER = 0x4000;

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
 * in; what a client asked of an item, one block for each client of each
 * item, a word naming it kept as the client's property on the item's
 * window; and the records a server's and a document's window words point
 * at.
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

/**
 * What a client asked of an item, as `OLESVR.DLL` keeps it: a block of
 * 0Eh bytes in its data segment, named by a word that is the datum of the
 * client's property on the item's window (**recorded** by `oleitem`: a
 * handle, not the client's window). Its fields, by the file's use of them
 * (read out, `OLESVR.DLL` seg3 `26d4`-`270f`, `2d74`-`2e73`): the client's
 * window; whether it advised native data; the one other format it advised,
 * the last; the times it advised, a bit for each (`Change` 0, `Save` 1,
 * `Close` 2); whether it wants data with them (an advise without
 * `fDeferUpd`), the last advise's say; a target device's block and whether
 * it is new, which WinBox keeps by the document instead (`SvrDoc.target`).
 * WinBox's blocks are slots of 10h bytes from `INFOS`, each named by its
 * offset: below 2000h, where no window's handle is, as the file's local
 * handles are none.
 */
export const INFOS = 0x1000;
export const INFO_SIZE = 0x10;
export const INFO_SLOTS = 0x100;
export const INFO_CLIENT = 0;
export const INFO_NATIVE = 2;
export const INFO_FORMAT = 4;
export const INFO_WHENS = 6;
export const INFO_DATA = 8;
/** The times an item is advised for, by their bits in `INFO_WHENS`. */
export const WHENS: Record<string, number> = { Change: 0, Save: 1, Close: 2 };

/** The records a server's and a document's window words point at: the program's `LPOLESERVER` or `LPOLESERVERDOC`, each in a slot of 4 bytes. */
export const RECORDS = 0x6000;
export const RECORD_SIZE = 4;
export const RECORD_SLOTS = 0x400;

/**
 * An item's block, the `OLECLIENT` its object is given, as `OLESVR.DLL`
 * lays it out (**recorded** by `oleitem`, an item window's words pointing
 * at it): a block of 10h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT |
 * GMEM_DDESHARE`, locked; the client's method table; the object; the
 * block's handle; the item's atom, nought for the document itself; the
 * item's window.
 */
export const ITEM_SIZE = 0x10;
export const ITEM_VTBL = 0;
export const ITEM_OBJECT = 4;
export const ITEM_HANDLE = 8;
export const ITEM_ATOM = 0xa;
export const ITEM_HWND = 0xc;
export const GMEM_ZEROINIT = 0x0040;

/** An item's window, its document's, and a server's: their classes' names and their windows' texts (**recorded** by `oleitem`). */
export const ITEM_TEXT = 'ITEM';
export const DOC_TEXT = 'Doc';

/** `OLE_ERROR_CANT_UPDATE_CLIENT` (ole.h): an embedded document saved where no client was sent its data. */
export const OLE_ERROR_CANT_UPDATE_CLIENT = 52;

/** `FINDITEMWND`'s requests, the high word of its `LPARAM` (read out, `OLESVR.DLL` seg3 `22c9`-`22d8`). */
export const FIND_ITEM = 1;
export const FORGET_CLIENT = 2;
export const DESTROY_ITEM = 3;
export const TELL_SAVED = 4;

/** WinBox's `OLESVR`'s exports it hands USER as procedures, by ordinal. */
export const SENDDATAMSG = 24;
export const FINDITEMWND = 25;
export const TERMINATECLIENTS = 27;
export const TERMINATEDOCCLIENTS = 28;
export const DELETECLIENTINFO = 29;
export const SENDRENAMEMSG = 30;
export const ENUMFORTERMINATE = 31;

/** One object a server's document gave, by its item: its window holds its clients. */
export interface SvrObject {
  item: number[];
  /** The `LPOLEOBJECT` its document gave. */
  object: number;
  /** The `LPOLECLIENT` WinBox gave for it: its item's block, locked. */
  client: number;
  /** The block's handle, and the item's atom (nought for the document itself). */
  handle: number;
  atom: number;
  /** The item's window, `ItemWndClass`, its document's child. */
  hwnd: number;
  /** Whether the target device poked to its document has been given it. */
  targeted: boolean;
  /** The clients' windows of the conversations it was given in. */
  convs: number[];
}

/** A document: its window is its handle, `LHSERVERDOC`. */
export interface SvrDoc {
  hwnd: number;
  server: number;
  name: number[];
  /** The `LPOLESERVERDOC`. */
  doc: number;
  /** Its window words' record. */
  record: number;
  /** The clients' windows of its conversations. */
  convs: number[];
  objects: SvrObject[];
  /** The conversations that advised `StdDocumentName`. */
  named: number[];
  /** A target device poked, its bytes; given each object before its first data. */
  target: number[] | null;
  /** Made by `StdNewDocument`, `StdEditDocument` or `StdNewFromTemplate`, and not renamed since. */
  embedded: boolean;
  /** Revoked, waiting for its conversations to end. */
  revoking: boolean;
}

/** A server: its window is its handle, `LHSERVER`. */
export interface Server {
  hwnd: number;
  klass: number[];
  /** The `LPOLESERVER`. */
  pointer: number;
  /** Its window words' record. */
  record: number;
  multi: boolean;
  /** A document just made for a client, which has not yet begun a conversation: its server is not let go meanwhile. */
  fresh: boolean;
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
  /** The next string slot and out slot to take. */
  nextString: number;
  nextOut: number;
  /** The clients' blocks in use, and those to take again. */
  infos: Set<number>;
  freeInfos: number[];
  nextInfo: number;
  freeRecords: number[];
  nextRecord: number;
  /** The conversations WinBox ended and waits to hear end, as `window:client`. */
  terminating: Set<string>;
  /** What `SENDDATAMSG` sends: the time's bit, the object, and whether any client was sent it. */
  when: number;
  object: number;
  sent: boolean;
  /** The window `FINDITEMWND` found. */
  found: number;
  /** Whether every object saved was sent to a client (`OleSavedServerDoc`). */
  saved: boolean;
  /** Whether `DELETECLIENTINFO` ends a client's conversation with the document: set as an item is let go. */
  ending: boolean;
  /** The item whose clients `ENUMFORTERMINATE` leaves be. */
  spared: number;
  /** Its exports' far addresses, by ordinal, as it hands them USER. */
  procs: Record<number, number>;
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
    infos: new Set(),
    freeInfos: [],
    nextInfo: 0,
    freeRecords: [],
    nextRecord: 0,
    terminating: new Set(),
    when: 0,
    object: 0,
    sent: false,
    found: 0,
    saved: false,
    ending: false,
    spared: 0,
    procs: {},
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

  /** A client's block for an item, cleared: the word naming it. */
  newInfo(): number {
    const state = this.svr();
    const slot = state.freeInfos.shift() ?? state.nextInfo++ % INFO_SLOTS;
    const handle = INFOS + slot * INFO_SIZE;

    this.write(this.near(handle), new Array(INFO_SIZE).fill(0));
    state.infos.add(handle);
    return handle;
  }

  /** Whether a word names a client's block in use. */
  isInfo(handle: number): boolean {
    return this.svr().infos.has(handle & 0xffff);
  }

  info(handle: number, field: number): number {
    return this.r16(this.near((handle & 0xffff) + field));
  }

  setInfo(handle: number, field: number, value: number) {
    this.w16(this.near((handle & 0xffff) + field), value);
  }

  freeInfo(handle: number) {
    const state = this.svr();

    if (state.infos.delete(handle & 0xffff)) {
      state.freeInfos.push(((handle & 0xffff) - INFOS) / INFO_SIZE);
    }
  }

  /** A record for a window's words, holding a program's pointer: its far pointer. */
  newRecord(pointer: number): number {
    const state = this.svr();
    const slot = state.freeRecords.shift() ?? state.nextRecord++ % RECORD_SLOTS;
    const at = this.near(RECORDS + slot * RECORD_SIZE);

    this.w32(at, pointer);
    return at;
  }

  freeRecord(at: number) {
    this.w32(at, 0);
    this.svr().freeRecords.push(((at & 0xffff) - RECORDS) / RECORD_SIZE);
  }
}

export { far };
