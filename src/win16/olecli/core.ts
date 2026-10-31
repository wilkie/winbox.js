'use strict';

import { type Arg, type Called, D, W, api, text } from '../commdlg/api.js';
import { reaches } from '../kernel/bad-pointers.js';
import { DWORD } from '../types.js';

/**
 * What every routine of WinBox's `OLECLI` stands on: guest memory, the
 * calls it makes into KERNEL, USER and GDI (through `commdlg/api.ts`, as a
 * program's call reaches them, unlogged), its own data segment, and the
 * layouts of the blocks a program holds pointers to. As
 * `crates/winbox-win16/src/olecli/core.rs`.
 *
 * Written from OLE 1.0's documented interface (`ole.h`, the OLE 1.0
 * programmer's reference) and from what the probes measured under DOSBox:
 * `olestat` (answers, streams' bytes) and `olemem` (the blocks behind a
 * document's handle and an object's pointer, each method table, each
 * method called through its table). Nothing here is taken from the code of
 * `OLECLI.DLL`.
 */

export const sel = (far: number) => (far >>> 16) & 0xffff;
export const off = (far: number) => far & 0xffff;
export const far = (selector: number, offset: number) =>
  (((selector & 0xffff) << 16) | (offset & 0xffff)) >>> 0;
export const plus = (at: number, n: number) => far(sel(at), off(at) + n);
/** A word as a signed number. */
export const signed16 = (value: number) => ((value & 0xffff) << 16) >> 16;

export const NAME = 'OLECLI';
export const PATH = 'C:\\WINDOWS\\SYSTEM\\OLECLI.DLL';

/** `OLESTATUS` (ole.h). */
export const OLE_OK = 0;
export const OLE_ERROR_MEMORY = 4;
export const OLE_ERROR_STREAM = 5;
export const OLE_ERROR_STATIC = 6;
export const OLE_ERROR_DRAW = 8;
export const OLE_ERROR_FORMAT = 12;
export const OLE_ERROR_OBJECT = 13;
export const OLE_ERROR_PROTOCOL = 15;
export const OLE_ERROR_ADDRESS = 16;
export const OLE_ERROR_NOT_EQUAL = 17;
export const OLE_ERROR_HANDLE = 18;
export const OLE_ERROR_GENERIC = 19;
export const OLE_ERROR_CLASS = 20;
export const OLE_ERROR_NOT_EMPTY = 25;
export const OLE_ERROR_SIZE = 26;
export const OLE_ERROR_NAME = 29;
export const OLE_ERROR_STATIC_FROM_OTHER_OS = 55;

/** Object types (ole.h): what `OleQueryType` answers, and a stream's second doubleword. */
export const OT_LINK = 1;
export const OT_EMBEDDED = 2;
export const OT_STATIC = 3;

/** `OLEOPT_RENDER` (ole.h). */
export const OLERENDER_NONE = 0;
export const OLERENDER_DRAW = 1;
export const OLERENDER_FORMAT = 2;

/** `OleQueryClientVersion`'s answer: 1001h, **recorded** by `olestat`. */
export const CLIENT_VERSION = 0x1001;

/** A stream's first doubleword: OLE's version 0501h, and the system that wrote it, nought for Windows (**recorded** by `olestat`'s streams). */
export const STREAM_VERSION = 0x0501;

/** Clipboard formats. */
export const CF_BITMAP = 2;
export const CF_METAFILEPICT = 3;
export const CF_DIB = 8;

/** GDI's and KERNEL's numbers OLECLI's calls use. */
export const GMEM_MOVEABLE = 0x0002;
export const GMEM_ZEROINIT = 0x0040;
export const GMEM_DDESHARE = 0x2000;
export const TECHNOLOGY = 2;
export const DT_METAFILE = 5;
export const LOGPIXELSX = 88;
export const LOGPIXELSY = 90;
export const MM_TEXT = 1;
export const MM_ANISOTROPIC = 8;
export const SRCCOPY = 0x00cc0020;
export const DEFAULT_PALETTE = 15;

/**
 * A client document's block, `GMEM_MOVEABLE | GMEM_ZEROINIT |
 * GMEM_DDESHARE`, 18h bytes, its handle the far pointer to it (**measured**
 * by `olemem`, word by word): the signature `CD`, the first and last of its
 * objects, the class's and the document's atoms, the block's own handle,
 * and the documents before and after it, each a far pointer.
 */
export const DOC_SIZE = 0x18;
export const DOC_SIGNATURE = 0x4443;
export const DOC_FIRST = 2;
export const DOC_LAST = 6;
export const DOC_CLASS = 10;
export const DOC_NAME = 12;
export const DOC_HANDLE = 14;
export const DOC_PREVIOUS = 16;
export const DOC_NEXT = 20;

/**
 * An object's block, `GMEM_MOVEABLE | GMEM_ZEROINIT`, the far pointer to it
 * the `LPOLEOBJECT` (**measured** by `olemem`): its method table, as
 * `OLEOBJECT` has it (ole.h); the signature `LE`; its block's handle; its
 * client; its type; its width and height in `MM_HIMETRIC`, the height
 * negative; a word 8 for a picture and 1 for the others; a word FFFFh; its
 * name's atom; its document; the objects before and after it in the
 * document; and from 30h what its kind keeps.
 */
export const OBJ_VTBL = 0;
export const OBJ_SIGNATURE = 4;
export const OBJ_HANDLE = 6;
export const OBJ_CLIENT = 8;
export const OBJ_TYPE = 12;
export const OBJ_WIDTH = 16;
export const OBJ_HEIGHT = 20;
export const OBJ_MAPPING = 24;
export const OBJ_UNKNOWN_FFFF = 28;
export const OBJ_NAME = 30;
export const OBJ_DOC = 32;
export const OBJ_PREVIOUS = 36;
export const OBJ_NEXT = 40;
export const OBJ_SIGNATURE_LE = 0x454c;
/** Each kind's part (**measured** by `olemem`): a picture's size, its `METAFILEPICT`'s mode, extents and metafile, and the `METAFILEPICT` `OleGetData` handed out. */
export const MF_SIZE = 0x30;
export const MF_MM = 0x34;
export const MF_XEXT = 0x36;
export const MF_YEXT = 0x38;
export const MF_METAFILE = 0x3a;
export const MF_PICTURE = 0x3c;
export const MF_BLOCK = 0x48;
/** A bitmap's size (its `BITMAP`'s 14 bytes and its bits), width, height and bitmap. */
export const BM_SIZE = 0x30;
export const BM_WIDTH = 0x34;
export const BM_HEIGHT = 0x36;
export const BM_BITMAP = 0x38;
/** A DIB's size (its block's) and its block. */
export const DIB_SIZE = 0x30;
export const DIB_DATA = 0x38;
/** Another class's object: its format, its class's atom, its data's size and its data. */
export const GEN_FORMAT = 0x30;
export const GEN_CLASS = 0x32;
export const GEN_SIZE = 0x34;
export const GEN_DATA = 0x38;
export const SMALL_BLOCK = 0x3a;
/** An embedded or linked object's block: A0h bytes (**measured** by `oleemb`'s `block` records); WinBox keeps the rest of what it holds beside it (`linked.ts`). */
export const LE_BLOCK = 0xa0;

/**
 * The 39 methods of `OLEOBJECTVTBL`, in ole.h's order: an object's table
 * holds a far pointer to each.
 */
export const METHODS = [
  'QueryProtocol',
  'Release',
  'Show',
  'DoVerb',
  'GetData',
  'SetData',
  'SetTargetDevice',
  'SetBounds',
  'EnumFormats',
  'SetColorScheme',
  'Delete',
  'SetHostNames',
  'SaveToStream',
  'Clone',
  'CopyFromLink',
  'Equal',
  'CopyToClipboard',
  'Draw',
  'Activate',
  'Execute',
  'Close',
  'Update',
  'Reconnect',
  'ObjectConvert',
  'GetLinkUpdateOptions',
  'SetLinkUpdateOptions',
  'Rename',
  'QueryName',
  'QueryType',
  'QueryBounds',
  'QuerySize',
  'QueryOpen',
  'QueryOutOfDate',
  'QueryReleaseStatus',
  'QueryReleaseError',
  'QueryReleaseMethod',
  'RequestData',
  'ObjectLong',
  'ChangeData',
] as const;

export type Method = (typeof METHODS)[number];

export const slot = (method: Method) => METHODS.indexOf(method);

/**
 * Each kind's table, as the ordinal of the `OLECLI` export each method is
 * (**measured** by `olemem`, the address in each slot found by
 * `GetProcAddress`): the methods that refuse are the `ERR` exports, 700
 * on; 1026 to 1030 are entries of `OLECLI`'s with no name.
 */
const COMMON = {
  QueryProtocol: 712,
  Show: 701,
  DoVerb: 1029,
  SetTargetDevice: 704,
  SetBounds: 705,
  SetColorScheme: 1028,
  SetHostNames: 703,
  CopyFromLink: 706,
  Activate: 708,
  Execute: 717,
  Close: 709,
  Update: 710,
  Reconnect: 711,
  ObjectConvert: 714,
  GetLinkUpdateOptions: 715,
  SetLinkUpdateOptions: 716,
  Rename: 911,
  QueryName: 910,
  QueryType: 912,
  QuerySize: 913,
  QueryOpen: 707,
  QueryOutOfDate: 713,
  QueryReleaseStatus: 1027,
  QueryReleaseError: 1027,
  QueryReleaseMethod: 1027,
  RequestData: 1026,
  ObjectLong: 718,
};

/** A static kind's own methods, at its hundred: 300 a picture's, 400 a bitmap's, 500 a DIB's. */
const ownMethods = (base: number) => ({
  Release: base,
  Delete: base,
  GetData: base + 1,
  SaveToStream: base + 2,
  Clone: base + 3,
  Equal: base + 4,
  CopyToClipboard: base + 5,
  QueryBounds: base + 7,
  Draw: base + 8,
  EnumFormats: base + 9,
  ChangeData: base + 10,
  SetData: 702,
});

/**
 * An embedded or linked object's table: the `LE` exports, 200 on, and the
 * unnamed entries 1000-1005 (**measured** by `oleemb`'s `vtbl` records).
 */
const LE_TABLE = {
  QueryProtocol: 221,
  Release: 200,
  Show: 201,
  DoVerb: 1005,
  GetData: 202,
  SetData: 203,
  SetTargetDevice: 205,
  SetBounds: 206,
  EnumFormats: 220,
  SetColorScheme: 1004,
  Delete: 200,
  SetHostNames: 204,
  SaveToStream: 207,
  Clone: 208,
  CopyFromLink: 209,
  Equal: 210,
  CopyToClipboard: 211,
  Draw: 214,
  Activate: 216,
  Execute: 228,
  Close: 225,
  Update: 218,
  Reconnect: 219,
  ObjectConvert: 223,
  GetLinkUpdateOptions: 226,
  SetLinkUpdateOptions: 227,
  Rename: 911,
  QueryName: 910,
  QueryType: 212,
  QueryBounds: 213,
  QuerySize: 913,
  QueryOpen: 215,
  QueryOutOfDate: 222,
  QueryReleaseStatus: 1003,
  QueryReleaseError: 1002,
  QueryReleaseMethod: 1001,
  RequestData: 1000,
  ObjectLong: 229,
  ChangeData: 224,
};

/**
 * Paintbrush's table: an embedded or linked object's with five methods of
 * the `PB` exports in their slots -- `GetData` 811, `EnumFormats` 810,
 * `CopyToClipboard` 807, `Draw` 805, `QueryBounds` 806 (**measured** by
 * `olehnd`'s and `oleemb`'s `vtbl` records). `OLECLI`'s handler of the
 * class `PBrush` gives it an object with no picture, or whose presentation
 * is of another format than a picture's (`handlers.ts`).
 */
const PB_TABLE = {
  ...LE_TABLE,
  GetData: 811,
  EnumFormats: 810,
  CopyToClipboard: 807,
  Draw: 805,
  QueryBounds: 806,
};

export const KINDS = {
  le: LE_TABLE,
  pb: PB_TABLE,
  mf: { ...COMMON, ...ownMethods(300) },
  bm: { ...COMMON, ...ownMethods(400) },
  dib: { ...COMMON, ...ownMethods(500) },
  gen: {
    ...COMMON,
    Release: 600,
    Delete: 600,
    GetData: 601,
    SetData: 602,
    SaveToStream: 603,
    Clone: 604,
    Equal: 605,
    CopyToClipboard: 606,
    QueryBounds: 608,
    Draw: 609,
    EnumFormats: 610,
    ChangeData: 611,
    QueryType: 1030,
  },
} as const;

export type Kind = keyof typeof KINDS;

/**
 * Where WinBox's `OLECLI` keeps its own in its data segment: the kinds'
 * method tables, a scratch area for what it hands a stream, and the name a
 * stream last gave a format.
 */
export const VTBL_AT: Record<Kind, number> = {
  mf: 0x100,
  bm: 0x200,
  dib: 0x300,
  gen: 0x400,
  le: 0x500,
  pb: 0x600,
};
export const SCRATCH = 0x800;
export const FORMAT_NAME = 0x900;
/** How much of a format's name a stream may give: as much as `GetClipboardFormatName` is asked for, 100h. */
export const FORMAT_NAME_SIZE = 0x100;

/** WinBox's `OLECLI` as it runs: memory, calls, its data. */
export class Ole {
  constructor(readonly system: any) {}

  get core(): any {
    return this.system.machine.cpu.core;
  }

  /** `OLECLI`'s data segment's selector. */
  ds(): number {
    return this.system._moduleData?.[NAME] ?? 0;
  }

  near(at: number): number {
    return far(this.ds(), at);
  }

  state(): OleState {
    return (this.system._olecli ??= newState());
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
    return Array.from({ length: n }, (_, i) => this.r8(this.huge(at, i)));
  }

  write(at: number, bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) {
      this.w8(this.huge(at, i), bytes[i]);
    }
  }

  /** A huge pointer `n` bytes on: 64K on is the next selector but one (`__AHINCR`, 8). */
  huge(at: number, n: number): number {
    const total = off(at) + (n >>> 0);

    return far(sel(at) + Math.floor(total / 0x10000) * 8, total & 0xffff);
  }

  /** A string at a far pointer, without its nought. */
  string(at: number): number[] {
    const out: number[] = [];

    for (let i = 0; i < 0x10000; i++) {
      const byte = this.r8(plus(at, i));

      if (!byte) {
        break;
      }

      out.push(byte);
    }

    return out;
  }

  /** Whether a byte can be read at a far pointer: the selector loads and the offset is within its limit. */
  readable(at: number, n = 1): boolean {
    return (
      sel(at) !== 0 &&
      reaches(this.core, sel(at), off(at)) &&
      reaches(this.core, sel(at), off(at) + n - 1)
    );
  }

  // Calls into KERNEL, USER and GDI.

  async callB(module: string, name: string, args: Arg[]): Promise<Called> {
    return api(this.system, module, name, args);
  }

  async call(module: string, name: string, args: Arg[]): Promise<number> {
    return (await this.callB(module, name, args)).value >>> 0;
  }

  async kernel(name: string, args: Arg[]): Promise<number> {
    return this.call('KERNEL', name, args);
  }

  async user(name: string, args: Arg[]): Promise<number> {
    return this.call('USER', name, args);
  }

  async gdi(name: string, args: Arg[]): Promise<number> {
    return this.call('GDI', name, args);
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

  async addAtom(at: number): Promise<number> {
    return (await this.user('GlobalAddAtom', [D(at)])) & 0xffff;
  }

  async addAtomText(bytes: number[]): Promise<number> {
    return (await this.user('GlobalAddAtom', [text(bytes)])) & 0xffff;
  }

  async deleteAtom(atom: number): Promise<number> {
    return (await this.user('GlobalDeleteAtom', [W(atom)])) & 0xffff;
  }

  async atomName(atom: number, to: number, size: number): Promise<number> {
    return (await this.user('GlobalGetAtomName', [W(atom), D(to), W(size)])) & 0xffff;
  }

  async lstrcmpi(a: number, b: number[]): Promise<number> {
    return signed16(await this.user('lstrcmpi', [D(a), text(b)]));
  }

  async getDC(): Promise<number> {
    return (await this.user('GetDC', [W(0)])) & 0xffff;
  }

  async releaseDC(dc: number) {
    await this.user('ReleaseDC', [W(0), W(dc)]);
  }

  async deviceCaps(dc: number, index: number): Promise<number> {
    return signed16(await this.gdi('GetDeviceCaps', [W(dc), W(index)]));
  }

  async mulDiv(a: number, b: number, c: number): Promise<number> {
    return signed16(await this.gdi('MulDiv', [W(a), W(b), W(c)]));
  }

  /** A program's procedure called far, its arguments doublewords, with `OLECLI`'s DS: its answer, DX:AX. */
  async callFar(procedure: number, args: number[]): Promise<number> {
    const answer = await this.system.scheduler.callProc(
      procedure >>> 0,
      args.map((arg) => [arg >>> 0, DWORD]),
      { ds: this.ds() }
    );

    return Number(answer ?? 0) >>> 0;
  }

  /** A program's procedure called far with words and doublewords as given: its answer, AX. */
  async callFarTyped(procedure: number, args: [number, number][]): Promise<number> {
    const answer = await this.system.scheduler.callProc(procedure >>> 0, args, { ds: this.ds() });

    return Number(answer ?? 0) >>> 0;
  }

  /** `count` bytes copied between far pointers, across 64K as huge pointers go. */
  copy(from: number, to: number, count: number) {
    this.write(to, this.read(from, count));
  }
}

/** What WinBox's `OLECLI` keeps beside guest memory. */
export interface OleState {
  /** The first client document, its far pointer; nought for none. */
  firstDoc: number;
  /** The formats and atoms registered as the library starts. */
  formats: Record<string, number>;
  atoms: Record<string, number>;
  /** Whether the start-up's registrations are made. */
  started: boolean;
  /** `GetStockObject(DEFAULT_PALETTE)`, once asked for. */
  defaultPalette: number;
  /** The library's instance: its windows' (`start.ts`). */
  instance: number;
  /** Embedded and linked objects, by their far pointers (`linked.ts`). */
  le: Map<number, any>;
  /** Each presentation's object, by the presentation's far pointer. */
  owners: Map<number, number>;
  /** The number the last embedded object was given. */
  serial: number;
  /** The window a `WM_DDE_INITIATE` is sent from while it is, and the first server that answered. */
  initiating: { hwnd: number; server: number } | null;
  /** Servers locked, by the window of the conversation that holds each. */
  locks: Map<number, { server: number }>;
  /** Object handlers loaded, by their index, from 1 (`handlers.ts`). */
  handlers: (Handler | null)[];
  /** The handler whose objects are all let go, freed when another's are or a document is revoked; nought for none. */
  pending: number;
  /** Each object made through a handler: the handler's index. */
  handlerOf: Map<number, number>;
  /** Whether an `Ole` function that makes an object from the clipboard is under way: what its defaults read. */
  clipping: boolean;
  /** `DllCreate` called for `OleCreateInvisible` by a handler with no `DllCreateInvisible`: whether to activate; null for none. */
  invisible: boolean | null;
  /** The share the network dialog connects, a far pointer to its name. */
  connecting: number;
}

/** A handler of a class's objects, as `handlers.ts` keeps it. */
export interface Handler {
  /** The class's name, lower case, and its atom. */
  klass: string;
  atom: number;
  library: number;
  /** How many of its objects there are. */
  count: number;
  /** Its eight `Dll` exports' far addresses, `DllCreateInvisible`'s nought where it has none. */
  procs: number[];
}

function newState(): OleState {
  return {
    firstDoc: 0,
    formats: {},
    atoms: {},
    started: false,
    defaultPalette: 0,
    instance: 0,
    le: new Map(),
    owners: new Map(),
    serial: 0,
    initiating: null,
    locks: new Map(),
    handlers: [],
    pending: 0,
    handlerOf: new Map(),
    clipping: false,
    invisible: null,
    connecting: 0,
  };
}

/** A string's bytes. */
export const bytesOf = (value: string) => Array.from(value, (c) => c.charCodeAt(0) & 0xff);
