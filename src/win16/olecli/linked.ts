'use strict';

import { D, W, text } from '../commdlg/api.js';
import {
  CF_BITMAP,
  CF_DIB,
  CF_METAFILEPICT,
  DIB_DATA,
  GEN_CLASS,
  GEN_DATA,
  GEN_FORMAT,
  GEN_SIZE,
  MM_ANISOTROPIC,
  SMALL_BLOCK,
  SRCCOPY,
  GMEM_DDESHARE,
  GMEM_MOVEABLE,
  GMEM_ZEROINIT,
  type Kind,
  LE_BLOCK,
  OBJ_HEIGHT,
  OBJ_MAPPING,
  OBJ_VTBL,
  OBJ_TYPE,
  OBJ_UNKNOWN_FFFF,
  OBJ_WIDTH,
  OLE_ERROR_FORMAT,
  OLE_ERROR_GENERIC,
  OLE_ERROR_MEMORY,
  OLE_ERROR_NOT_EQUAL,
  OLE_ERROR_OBJECT,
  OLE_ERROR_STREAM,
  OLE_OK,
  OLERENDER_DRAW,
  OLERENDER_FORMAT,
  OLERENDER_NONE,
  OT_EMBEDDED,
  OT_LINK,
  Ole,
  SCRATCH,
  STREAM_VERSION,
  bytesOf,
  plus,
} from './core.js';
import { DOC_CLASS, DOC_NAME } from './core.js';
import { draw } from './draw.js';
import {
  BLOCK_OF,
  CLASS_OF,
  FORMAT_OF,
  querySize as staticSize,
  readOther,
  clone as cloneStatic,
  copyBlock,
  copyToClipboard as copyStatic,
  getData as getStaticData,
  queryBounds as staticBounds,
  readBlock,
  readStatic,
  release as releaseStatic,
  sameBlocks,
  saveToStream as saveStatic,
  staticFromClipboard,
} from './kinds.js';
import { freeObject, kindOf, newObject, vtblOf } from './objects.js';
import { get, getLong, put, putLong, putName } from './streams.js';

/**
 * Embedded and linked objects, WinBox's own: their blocks, their methods
 * (the `LE` exports, 200-230, and entries 1000-1005 of `OLECLI`'s), and the
 * DDE conversation each holds with its server, as OLE 1.0's protocol has a
 * client hold it -- `StdFileEditing` (the OLE 1.0 programmer's reference)
 * -- in the order and with the items, formats and data **recorded** by the
 * probe `oledde`, whose second program is a server that writes down each
 * message it is sent, and `olepbr`, Paintbrush. Nothing here is taken from
 * the code of `OLECLI.DLL`. As `crates/winbox-win16/src/olecli/linked.rs`.
 *
 * An object's conversation is a list of steps: each posts one message and
 * waits for the server's answer -- `WM_DDE_ACK`, the data asked for, or the
 * terminate answering ours -- in a window of `OLECLI`'s classes, then the
 * next is taken. While steps are left the object is busy
 * (`OleQueryReleaseStatus` answers `OLE_BUSY`); the last tells its client
 * `OLE_RELEASE`, with the error that stopped it and the method that began.
 */

// DDE's messages (dde.h).
const WM_DDE_INITIATE = 0x3e0;
const WM_DDE_TERMINATE = 0x3e1;
const WM_DDE_ADVISE = 0x3e2;
const WM_DDE_ACK = 0x3e4;
const WM_DDE_DATA = 0x3e5;
const WM_DDE_REQUEST = 0x3e6;
const WM_DDE_POKE = 0x3e7;
const WM_DDE_EXECUTE = 0x3e8;
const HWND_BROADCAST = 0xffff;

/** A `DDEACK`'s and a `DDEDATA`'s flags (dde.h). */
const ACK_POSITIVE = 0x8000;
const DATA_RESPONSE = 0x1000;
const DATA_RELEASE = 0x2000;
const DATA_ACK_REQ = 0x8000;
/** An advise's `fAckReq`: what `OLECLI` asks for (**recorded** by `oledde`, `8000`). */
const ADVISE_ACK_REQ = 0x8000;

/** `nCmdShow`s a server is launched with: shown where it is made or activated, hidden to give data (**recorded** by `oledde`'s `srv.start`). */
const SW_HIDE = 0;
const SW_SHOWNORMAL = 1;

/** `OLE_NOTIFICATION` (ole.h). */
export const OLE_CHANGED = 0;
export const OLE_SAVED = 1;
export const OLE_CLOSED = 2;
export const OLE_RELEASE = 5;

/** `OLE_RELEASE_METHOD` (ole.h). */
const OLE_DELETE = 1;
const OLE_RUN = 5;
const OLE_ACTIVATE = 6;
const OLE_UPDATE = 7;
const OLE_CLOSE = 8;
const OLE_RECONNECT = 9;
const OLE_SETDATA = 13;
const OLE_REQUESTDATA = 14;
const OLE_OTHER = 15;
const OLE_CREATE = 16;
const OLE_CREATELINKFROMFILE = 18;
const OLE_CREATEFROMFILE = 20;

/** `OLESTATUS` (ole.h) of the conversation. */
export const OLE_WAIT_FOR_RELEASE = 1;
export const OLE_BUSY = 2;
export const OLE_ERROR_BLANK = 7;
export const OLE_ERROR_NOT_OPEN = 34;
export const OLE_ERROR_LAUNCH = 35;
const OLE_ERROR_COMM = 36;
const OLE_ERROR_COMMAND = 38;
const OLE_ERROR_DOVERB = 40;
const OLE_ERROR_ADVISE_NATIVE = 41;
const OLE_ERROR_ADVISE_PICT = 42;
const OLE_ERROR_ADVISE_RENAME = 43;
const OLE_ERROR_POKE_NATIVE = 44;
const OLE_ERROR_REQUEST_NATIVE = 45;
const OLE_ERROR_REQUEST_PICT = 46;
const OLE_ERROR_NEW = 31;
const OLE_ERROR_EDIT = 32;

/** The registration database's root, `HKEY_CLASSES_ROOT` (shellapi.h). */
const HKEY_CLASSES_ROOT = 1;

/** Where in `OLECLI`'s data a class's name is put for `CreateWindow`, and a server's command line built. */
const CONV_CLASS = 0x0a80;
const COMMAND_LINE = 0x0b00;
const COMMAND_SIZE = 0x100;

/** A conversation an object holds: the system topic's or its document's. */
type Conv = 'system' | 'doc';

type Step =
  | { k: 'execute'; conv: Conv; text: number[]; error: number; handle?: number }
  | { k: 'initiate' }
  | { k: 'poke'; item: string; format: number; data: number[]; error: number; handle?: number }
  | { k: 'advise'; item: string; format: number; error: number; handle?: number }
  | { k: 'request'; item: string; format: number; error: number }
  | { k: 'terminate'; conv: Conv }
  | { k: 'reply'; conv: Conv }
  | { k: 'notify'; what: number }
  | { k: 'release'; method: number; free?: boolean; silent?: boolean };

/** What WinBox keeps of an embedded or linked object beside its block. */
export interface Le {
  type: number;
  klass: number[];
  /** A link's document, its file; an embedded object's, the name its server is given: the client's class, document and the object's name and number. */
  topic: number[];
  item: number[];
  native: number;
  picture: number;
  hostNames: number[] | null;
  dims: number[] | null;
  scheme: number[] | null;
  target: number[] | null;
  update: number;
  system: number;
  systemServer: number;
  doc: number;
  docServer: number;
  busy: boolean;
  error: number;
  method: number;
  queue: Step[];
  waiting: Step | null;
  link: number;
  blank: number;
  /** A Paintbrush object's picture, a DIB of its bitmap file's, drawn and measured but never saved. */
  view: number;
  /** Its class's atom: the class is spelled as the atom is (**measured** by `olenet`, a class saved as a document's class registered first spelled it). */
  classAtom: number;
  /** The rendering it was made with (ole.h's `OLEOPT_RENDER`): a picture, none, or a format's. */
  render: number;
  /** A link's network name, its document's share, and the drive's letter connected to it; none, nought. */
  network: number[];
  drive: number;
}

const str = (bytes: number[]) => String.fromCharCode(...bytes);

export function leOf(ole: Ole, object: number): Le | undefined {
  return ole.state().le.get(object >>> 0);
}

/** The formats OLE's protocol registers. */
function cf(ole: Ole, name: string) {
  return ole.state().formats[name] ?? 0;
}

/** Whether a format is a presentation's: a picture, a bitmap, a DIB. */
const isPicture = (format: number) =>
  format === CF_METAFILEPICT || format === CF_BITMAP || format === CF_DIB;

/** A word pair as a `LPARAM`. */
const long = (low: number, high: number) => (((high & 0xffff) << 16) | (low & 0xffff)) >>> 0;

// Objects.

/** An atom's name's bytes. */
async function atomText(ole: Ole, atom: number): Promise<number[]> {
  const at = ole.near(SCRATCH);

  if (!atom) {
    return [];
  }

  await ole.atomName(atom, at, 0x100);
  return ole.string(at);
}

/**
 * An embedded object's document as its server is told it: the client's
 * class, its document's file name without its path, the object's name and
 * its number, `OleDdeClient%OLEDDE.DOC%Obj1#001` (**recorded** by `oledde`,
 * each embedded object numbered as it is made, loaded, cloned or pasted;
 * links not).
 */
async function embeddedTopic(ole: Ole, doc: number, name: number[]): Promise<number[]> {
  const state = ole.state();
  const klass = await atomText(ole, ole.r16(plus(doc, DOC_CLASS)));
  const path = await atomText(ole, ole.r16(plus(doc, DOC_NAME)));
  let file = path;

  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === 0x5c || path[i] === 0x3a) {
      file = path.slice(i + 1);
      break;
    }
  }

  state.serial += 1;

  const number = String(state.serial).padStart(3, '0');

  return [...klass, 0x25, ...file, 0x25, ...name, 0x23, ...bytesOf(number)];
}

/** An object's block made, embedded or linked, and what WinBox keeps of it. */
async function newLe(
  ole: Ole,
  type: number,
  client: number,
  doc: number,
  name: number,
  klass: number[],
  topic: number[] | null,
  item: number[],
  atom = 0
): Promise<number> {
  const object = await newObject(ole, 'le', LE_BLOCK, client, doc, name);

  if (!object) {
    return 0;
  }

  ole.w32(plus(object, OBJ_TYPE), type);
  ole.w16(plus(object, OBJ_MAPPING), 0);
  ole.w16(plus(object, OBJ_UNKNOWN_FFFF), 0);

  /* A class's atom given is the object's own, let go with it (**measured**
   * by `olehnd`'s `atom` records: `DefLoadFromStream`'s object takes the
   * atom it is given); else it adds one. */
  const classAtom = atom || (await ole.addAtomText(klass));
  const spelled = await atomText(ole, classAtom);

  ole.state().le.set(object >>> 0, {
    type,
    klass: spelled.length ? spelled : klass,
    classAtom,
    render: OLERENDER_DRAW,
    network: [],
    drive: 0,
    topic: topic ?? (await embeddedTopic(ole, doc, ole.string(name))),
    item,
    native: 0,
    picture: 0,
    hostNames: null,
    dims: null,
    scheme: null,
    target: null,
    update: 0,
    system: 0,
    systemServer: 0,
    doc: 0,
    docServer: 0,
    busy: false,
    error: 0,
    method: 0,
    queue: [],
    waiting: null,
    link: 0,
    blank: 0,
    view: 0,
  });
  return object;
}

/** Its presentation set: a picture, a bitmap or a DIB of its own, its bounds the object's. */
function setPicture(ole: Ole, object: number, le: Le, picture: number) {
  le.picture = picture;
  ole.state().owners.set(picture >>> 0, object >>> 0);
  ole.w32(plus(object, OBJ_WIDTH), ole.r32(plus(picture, OBJ_WIDTH)));
  ole.w32(plus(object, OBJ_HEIGHT), ole.r32(plus(picture, OBJ_HEIGHT)));
}

async function dropPicture(ole: Ole, le: Le) {
  if (le.picture) {
    ole.state().owners.delete(le.picture >>> 0);
    await releaseStatic(ole, kindOf(ole, le.picture) ?? 'mf', le.picture);
    le.picture = 0;
  }
}

/**
 * Whether an object is of the class `PBrush`, Paintbrush's: one `OLECLI`
 * keeps no picture of, its `Native` a bitmap file it draws itself -- only
 * `Native` advised and asked for, no presentation in its stream but a
 * link's `Native`, its bounds its bitmap's at its pixels to a metre, its
 * picture made as it is asked for (**recorded** by `olepbd`, whose server
 * is registered as `PBrush`, and `olepbr`, Paintbrush's own).
 */
export const isPBrush = (le: Le) => str(le.klass).toLowerCase() === 'pbrush';

/** A Paintbrush object's bitmap file: an embedded one's `Native`, a link's presentation's data. */
function bitmapFile(ole: Ole, le: Le): number {
  if (le.type === OT_EMBEDDED) {
    return le.native;
  }

  return le.picture && kindOf(ole, le.picture) === 'gen' ? ole.r16(plus(le.picture, GEN_DATA)) : 0;
}

/** A Paintbrush object's picture made again from its bitmap file: the DIB after the file's header, its bounds the object's. */
async function refreshView(ole: Ole, object: number, le: Le) {
  if (le.view) {
    ole.state().owners.delete(le.view >>> 0);
    await releaseStatic(ole, 'dib', le.view);
    le.view = 0;
  }

  const file = bitmapFile(ole, le);

  if (!file) {
    return;
  }

  const size = await ole.globalSize(file);
  const dib = await ole.globalAlloc(GMEM_MOVEABLE, size - BITMAP_FILE_HEADER);
  const from = await ole.globalLock(file);
  const into = await ole.globalLock(dib);

  ole.copy(plus(from, BITMAP_FILE_HEADER), into, size - BITMAP_FILE_HEADER);
  await ole.globalUnlock(dib);
  await ole.globalUnlock(file);

  const view = await pictureFrom(ole, object, CF_DIB, dib);

  await ole.globalFree(dib);

  if (view) {
    le.view = view;
    /* Its block keeps no bounds of it (**measured** by `oleemb`'s `obj` of `bare`). */
    ole.state().owners.set(view >>> 0, object >>> 0);
  }
}

/** A bitmap file's header, `BITMAPFILEHEADER`'s fourteen bytes. */
const BITMAP_FILE_HEADER = 14;

/** `OLE_WARN_DELETE_DATA` (ole.h): data made for the caller, the caller's to let go (**recorded** by `olepbd`, a Paintbrush object's picture). */
const OLE_WARN_DELETE_DATA = 1000;

/**
 * A Paintbrush object's picture made for its caller: a metafile that
 * stretches its DIB over its pixels, in a `METAFILEPICT` of
 * `MM_ANISOTROPIC` and its bounds.
 */
async function pictureOfView(ole: Ole, le: Le): Promise<number> {
  const dib = ole.r16(plus(le.view, DIB_DATA));
  const info = await ole.globalLock(dib);
  const width = ole.r16(plus(info, 4));
  const height = ole.r16(plus(info, 8));
  const bits = ole.r16(plus(info, 14));
  const used = ole.r32(plus(info, 32));
  const colours = used || (bits <= 8 ? 1 << bits : 0);
  const meta = (await ole.gdi('CreateMetafile', [D(0)])) & 0xffff;

  await ole.gdi('SetWindowOrg', [W(meta), W(0), W(0)]);
  await ole.gdi('SetWindowExt', [W(meta), W(width), W(height)]);
  await ole.gdi('StretchDIBits', [
    W(meta),
    W(0),
    W(0),
    W(width),
    W(height),
    W(0),
    W(0),
    W(width),
    W(height),
    D(plus(info, ole.r32(info) + colours * 4)),
    D(info),
    W(0),
    D(SRCCOPY),
  ]);
  await ole.globalUnlock(dib);

  const metafile = (await ole.gdi('CloseMetafile', [W(meta)])) & 0xffff;
  const handle = await ole.globalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 8);
  const at = await ole.globalLock(handle);

  ole.w16(at, MM_ANISOTROPIC);
  ole.w16(plus(at, 2), ole.r32(plus(le.view, OBJ_WIDTH)));
  ole.w16(plus(at, 4), -ole.r32(plus(le.view, OBJ_HEIGHT)));
  ole.w16(plus(at, 6), metafile);
  await ole.globalUnlock(handle);
  return handle;
}

/** A link's presentation of its class's `Native`: an object of another class's, its data the block given. */
async function nativePicture(ole: Ole, object: number, le: Le, block: number): Promise<number> {
  const picture = await newObject(ole, 'gen', SMALL_BLOCK, ole.r32(plus(object, 8)), 0, 0);

  if (!picture) {
    return 0;
  }

  ole.w16(plus(picture, GEN_FORMAT), cf(ole, 'Native'));
  ole.w16(plus(picture, GEN_CLASS), await ole.addAtomText(le.klass));
  ole.w32(plus(picture, GEN_SIZE), await ole.globalSize(block));
  ole.w16(plus(picture, GEN_DATA), block);
  return picture;
}

/** A presentation made from a handle of its format, its data copied: its pointer, or nought. */
async function pictureFrom(ole: Ole, object: number, format: number, handle: number) {
  const kind: Record<number, Exclude<Kind, 'gen' | 'le' | 'pb'>> = {
    [CF_METAFILEPICT]: 'mf',
    [CF_BITMAP]: 'bm',
    [CF_DIB]: 'dib',
  };
  const out = ole.near(SCRATCH + 0xf0);
  const client = ole.r32(plus(object, 8));

  ole.w32(out, 0);

  if ((await staticFromClipboard(ole, kind[format], handle, client, 0, 0, out)) !== OLE_OK) {
    return 0;
  }

  return ole.r32(out);
}

/** Everything an object holds let go, then its block. */
async function freeLe(ole: Ole, object: number, le: Le) {
  for (const handle of [le.native, le.link, le.blank]) {
    if (handle) {
      await ole.globalFree(handle);
    }
  }

  await dropPicture(ole, le);

  if (le.view) {
    ole.state().owners.delete(le.view >>> 0);
    await releaseStatic(ole, 'dib', le.view);
  }

  for (const hwnd of [le.system, le.doc]) {
    if (hwnd) {
      await ole.user('DestroyWindow', [W(hwnd)]);
    }
  }

  await ole.deleteAtom(le.classAtom);
  ole.state().le.delete(object >>> 0);
  await freeObject(ole, object);
  await releaseHook(ole, object);
}

/** What lets go of an object's handler as the object goes (`handlers.ts`), registered there. */
let releaseHook: (ole: Ole, object: number) => Promise<void> = async () => {};

export function registerRelease(hook: (ole: Ole, object: number) => Promise<void>) {
  releaseHook = hook;
}

// The client told.

/** Its client's `CallBack` called with a notification about it. */
async function tell(ole: Ole, object: number, what: number) {
  const client = ole.r32(plus(object, 8));
  const callback = ole.r32(ole.r32(client));

  return ole.callFarTyped(callback, [
    [client, 7],
    [what, 3],
    [object, 7],
  ]);
}

// Servers and conversations.

/** The server's command line the registration database gives a class: `class\protocol\StdFileEditing\server`. */
async function serverOf(ole: Ole, klass: number[]): Promise<number[] | null> {
  const key = [...klass, ...bytesOf('\\protocol\\StdFileEditing\\server')];
  const at = ole.near(COMMAND_LINE);
  const size = ole.near(SCRATCH + 0xfc);

  ole.w32(size, COMMAND_SIZE);

  const found = await ole.call('SHELL', 'RegQueryValue', [
    D(HKEY_CLASSES_ROOT),
    text(key),
    D(at),
    D(size),
  ]);

  return found === 0 ? ole.string(at) : null;
}

/** Whether the registration database has a class. */
export async function classKnown(ole: Ole, klass: number): Promise<boolean> {
  const at = ole.near(COMMAND_LINE);
  const size = ole.near(SCRATCH + 0xfc);

  ole.w32(size, COMMAND_SIZE);

  return (
    (await ole.call('SHELL', 'RegQueryValue', [D(HKEY_CLASSES_ROOT), D(klass), D(at), D(size)])) ===
    0
  );
}

/**
 * A class's server started: its command line, `-Embedding` and the file it
 * is to open, if any (`C:\ORACLE\OLEDDEC.EXE -Embedding ` for an embedded
 * object, the link's file after it; **recorded** by `oledde`'s
 * `srv.start`), by `WinExec`. Whether it started.
 */
async function launch(ole: Ole, le: Le, show: number, file: boolean): Promise<boolean> {
  const server = await serverOf(ole, le.klass);

  if (!server) {
    return false;
  }

  const line = [...server, ...bytesOf(' -Embedding '), ...(file ? le.topic : [])];

  return ((await ole.kernel('WinExec', [text(line), W(show)])) & 0xffff) >= 32;
}

/** A window of one of `OLECLI`'s classes for a conversation, the object in its window words. */
async function convWindow(ole: Ole, klass: string, object: number): Promise<number> {
  const at = ole.near(CONV_CLASS);

  ole.write(at, [...bytesOf(klass), 0]);

  const hwnd =
    (await ole.user('CreateWindow', [
      D(at),
      text([]),
      D(0),
      W(0),
      W(0),
      W(0),
      W(0),
      W(0),
      W(0),
      W(ole.state().instance),
      D(0),
    ])) & 0xffff;

  if (hwnd) {
    await ole.user('SetWindowLong', [W(hwnd), W(0), D(object)]);
  }

  return hwnd;
}

/**
 * `WM_DDE_INITIATE` sent to every top-level window on a class and a topic,
 * from a window of ours: the first server that answers, or nought. The
 * atoms named are deleted once it returns; those of the answer as it comes.
 */
async function initiate(ole: Ole, hwnd: number, app: number[], topic: number[]): Promise<number> {
  const state = ole.state();
  const aApp = await ole.addAtomText(app);
  const aTopic = await ole.addAtomText(topic);

  state.initiating = { hwnd, server: 0 };
  await ole.user('SendMessage', [
    W(HWND_BROADCAST),
    W(WM_DDE_INITIATE),
    W(hwnd),
    D(long(aApp, aTopic)),
  ]);

  const server = state.initiating.server;

  state.initiating = null;
  await ole.deleteAtom(aApp);
  await ole.deleteAtom(aTopic);
  return server;
}

/**
 * The server's system topic reached: `OLEsystem`, then `System`; where
 * none answers and a server may be started, the class's server launched
 * and both asked again (**recorded** by `oledde`: a running server is
 * asked without a launch).
 */
async function connectSystem(ole: Ole, object: number, le: Le, show: number | null) {
  const hwnd = await convWindow(ole, 'OleSrvrWndClass', object);

  for (const attempt of [0, 1]) {
    for (const topic of ['OLEsystem', 'System']) {
      const server = await initiate(ole, hwnd, le.klass, bytesOf(topic));

      if (server) {
        le.system = hwnd;
        le.systemServer = server;
        return true;
      }
    }

    if (attempt === 0 && (show === null || !(await launch(ole, le, show, false)))) {
      break;
    }
  }

  await ole.user('DestroyWindow', [W(hwnd)]);
  return false;
}

/** The object's document reached as a topic of its class; for a link, its server launched with its file where none answers. */
async function connectDoc(ole: Ole, object: number, le: Le, show: number | null) {
  const hwnd = await convWindow(ole, 'OleDocWndClass', object);

  for (const attempt of [0, 1]) {
    const server = await initiate(ole, hwnd, le.klass, le.topic);

    if (server) {
      le.doc = hwnd;
      le.docServer = server;
      return true;
    }

    if (attempt === 0 && (show === null || !(await launch(ole, le, show, true)))) {
      break;
    }
  }

  await ole.user('DestroyWindow', [W(hwnd)]);
  return false;
}

const serverOfConv = (le: Le, conv: Conv) => (conv === 'system' ? le.systemServer : le.docServer);
const windowOfConv = (le: Le, conv: Conv) => (conv === 'system' ? le.system : le.doc);

async function post(ole: Ole, to: number, message: number, from: number, lparam: number) {
  return (await ole.user('PostMessage', [W(to), W(message), W(from), D(lparam)])) & 0xffff;
}

/** A conversation's window let go, the conversation forgotten. */
async function endConv(ole: Ole, le: Le, conv: Conv) {
  const hwnd = windowOfConv(le, conv);

  if (conv === 'system') {
    le.system = 0;
    le.systemServer = 0;
  } else {
    le.doc = 0;
    le.docServer = 0;
  }

  if (hwnd) {
    await ole.user('DestroyWindow', [W(hwnd)]);
  }
}

/** A block of `GMEM_DDESHARE` holding bytes: its handle. */
async function sharedBlock(ole: Ole, bytes: number[]): Promise<number> {
  const handle = await ole.globalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, bytes.length);
  const at = await ole.globalLock(handle);

  ole.write(at, bytes);
  await ole.globalUnlock(handle);
  return handle;
}

const word = (value: number) => [value & 0xff, (value >> 8) & 0xff];

// Steps.

/** A conversation begun: the object busy until its steps are done. */
async function begin(ole: Ole, object: number, le: Le, steps: Step[]) {
  le.busy = true;
  le.error = 0;
  le.queue = steps;
  le.waiting = null;
  await advance(ole, object, le);
}

/** The steps taken until one waits for its server, or none is left. */
async function advance(ole: Ole, object: number, le: Le) {
  while (!le.waiting && le.queue.length && ole.state().le.get(object >>> 0) === le) {
    const step = le.queue.shift()!;

    if (le.error && !['terminate', 'reply', 'release'].includes(step.k)) {
      continue;
    }

    await take(ole, object, le, step);
  }
}

async function take(ole: Ole, object: number, le: Le, step: Step) {
  switch (step.k) {
    case 'execute': {
      const handle = await sharedBlock(ole, [...step.text, 0]);

      step.handle = handle;

      if (
        !(await post(
          ole,
          serverOfConv(le, step.conv),
          WM_DDE_EXECUTE,
          windowOfConv(le, step.conv),
          long(0, handle)
        ))
      ) {
        await ole.globalFree(handle);
        le.error = step.error;
        return;
      }

      le.waiting = step;
      return;
    }

    case 'initiate':
      if (!(await connectDoc(ole, object, le, null))) {
        le.error = OLE_ERROR_COMM;
      }

      return;

    case 'poke': {
      const handle = await sharedBlock(ole, [...word(0), ...word(step.format), ...step.data]);
      const atom = await ole.addAtomText(bytesOf(step.item));

      step.handle = handle;

      if (!(await post(ole, le.docServer, WM_DDE_POKE, le.doc, long(handle, atom)))) {
        await ole.globalFree(handle);
        await ole.deleteAtom(atom);
        le.error = step.error;
        return;
      }

      le.waiting = step;
      return;
    }

    case 'advise': {
      const handle = await sharedBlock(ole, [...word(ADVISE_ACK_REQ), ...word(step.format)]);
      const atom = await ole.addAtomText(bytesOf(step.item));

      step.handle = handle;

      if (!(await post(ole, le.docServer, WM_DDE_ADVISE, le.doc, long(handle, atom)))) {
        await ole.globalFree(handle);
        await ole.deleteAtom(atom);
        le.error = step.error;
        return;
      }

      le.waiting = step;
      return;
    }

    case 'request': {
      const atom = await ole.addAtomText(bytesOf(step.item));

      if (!(await post(ole, le.docServer, WM_DDE_REQUEST, le.doc, long(step.format, atom)))) {
        await ole.deleteAtom(atom);
        le.error = step.error;
        return;
      }

      le.waiting = step;
      return;
    }

    case 'terminate':
      if (!windowOfConv(le, step.conv)) {
        return;
      }

      if (
        !(await post(
          ole,
          serverOfConv(le, step.conv),
          WM_DDE_TERMINATE,
          windowOfConv(le, step.conv),
          0
        ))
      ) {
        await endConv(ole, le, step.conv);
        return;
      }

      le.waiting = step;
      return;

    case 'reply':
      if (windowOfConv(le, step.conv)) {
        await post(
          ole,
          serverOfConv(le, step.conv),
          WM_DDE_TERMINATE,
          windowOfConv(le, step.conv),
          0
        );
        await endConv(ole, le, step.conv);
      }

      return;

    case 'notify':
      await tell(ole, object, step.what);
      return;

    case 'release':
      le.busy = false;
      le.method = step.method;

      if (!step.silent) {
        await tell(ole, object, OLE_RELEASE);
      }

      le.error = 0;

      if (step.free) {
        await freeLe(ole, object, le);
      }

      return;
  }
}

/** A step's answer come: the step done, and the next taken. */
async function stepDone(ole: Ole, object: number, le: Le, error: number) {
  if (error) {
    le.error = error;
  }

  le.waiting = null;
  await advance(ole, object, le);
}

// Data the server gives.

/**
 * Data come from the server in a format: `Native` kept as the object's (a
 * block of what came, its size the block's less the `DDEDATA` header's
 * four bytes); a picture, a bitmap or a DIB made the object's presentation.
 */
async function store(ole: Ole, object: number, le: Le, format: number, hData: number) {
  const at = await ole.globalLock(hData);
  const size = (await ole.globalSize(hData)) - 4;

  if (format === cf(ole, 'Native')) {
    const handle = await ole.globalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, size);
    const into = await ole.globalLock(handle);

    ole.copy(plus(at, 4), into, size);
    await ole.globalUnlock(handle);

    if (le.type === OT_LINK) {
      const picture = await nativePicture(ole, object, le, handle);

      if (picture) {
        await dropPicture(ole, le);
        setPicture(ole, object, le, picture);
      }
    } else {
      if (le.native) {
        await ole.globalFree(le.native);
      }

      le.native = handle;
    }

    if (kindOf(ole, object) === 'pb') {
      await refreshView(ole, object, le);
    }
  } else if (isPicture(format)) {
    const handle = ole.r16(plus(at, 4));
    const picture = await pictureFrom(ole, object, format, handle);

    if (picture) {
      await dropPicture(ole, le);
      setPicture(ole, object, le, picture);
    }
  }

  await ole.globalUnlock(hData);
}

/** What a server's data held let go: its picture's metafile, its block, the data's block. */
async function freeData(ole: Ole, format: number, hData: number) {
  const at = await ole.globalLock(hData);

  if (format === CF_METAFILEPICT) {
    const picture = ole.r16(plus(at, 4));
    const inside = await ole.globalLock(picture);

    await ole.gdi('DeleteMetafile', [W(ole.r16(plus(inside, 6)))]);
    await ole.globalUnlock(picture);
    await ole.globalFree(picture);
  } else if (format === CF_BITMAP) {
    await ole.gdi('DeleteObject', [W(ole.r16(plus(at, 4)))]);
  } else if (format === CF_DIB) {
    await ole.globalFree(ole.r16(plus(at, 4)));
  }

  await ole.globalUnlock(hData);
  await ole.globalFree(hData);
}

// The window procedures.

/**
 * `DOCWNDPROC` (100) and `SRVRWNDPROC` (101): a conversation's window,
 * a document's or a server's system topic's. What its server posts it is
 * the answer the object's step waits for, or the server telling it its
 * object changed, was saved or closed.
 */
export async function convProc(
  ole: Ole,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  if (message < WM_DDE_INITIATE || message > WM_DDE_EXECUTE) {
    return ole.user('DefWindowProc', [W(hwnd), W(message), W(wParam), D(lParam)]);
  }

  const state = ole.state();
  const low = lParam & 0xffff;
  const high = (lParam >>> 16) & 0xffff;

  if (message === WM_DDE_ACK && state.initiating?.hwnd === hwnd) {
    if (!state.initiating.server) {
      state.initiating.server = wParam;
    }

    await ole.deleteAtom(low);
    await ole.deleteAtom(high);
    return 0;
  }

  const lock = state.locks.get(hwnd);

  if (lock) {
    if (message === WM_DDE_TERMINATE) {
      state.locks.delete(hwnd);
      await ole.user('DestroyWindow', [W(hwnd)]);
    }

    return 0;
  }

  const object = (await ole.user('GetWindowLong', [W(hwnd), W(0)])) >>> 0;
  const le = leOf(ole, object);
  const conv: Conv | null = !le
    ? null
    : hwnd === le.system
      ? 'system'
      : hwnd === le.doc
        ? 'doc'
        : null;

  if (!le || !conv) {
    if (message === WM_DDE_TERMINATE) {
      await ole.user('DestroyWindow', [W(hwnd)]);
    }

    return 0;
  }

  if (message === WM_DDE_ACK) {
    await acked(ole, object, le, low, high);
  } else if (message === WM_DDE_DATA) {
    await data(ole, object, le, conv, low, high);
  } else if (message === WM_DDE_TERMINATE) {
    await terminated(ole, object, le, conv);
  }

  return 0;
}

/** `WM_DDE_ACK`: the step waiting answered, its blocks and atom let go. */
async function acked(ole: Ole, object: number, le: Le, status: number, high: number) {
  const step = le.waiting;

  if (!step) {
    await ole.deleteAtom(high);
    return;
  }

  const positive = (status & ACK_POSITIVE) !== 0;

  switch (step.k) {
    case 'execute':
      await ole.globalFree(step.handle!);
      return stepDone(ole, object, le, positive ? 0 : step.error);

    case 'poke':
      await ole.globalFree(step.handle!);
      await ole.deleteAtom(high);
      return stepDone(ole, object, le, positive ? 0 : step.error);

    case 'advise':
      if (!positive) {
        await ole.globalFree(step.handle!);
      }

      await ole.deleteAtom(high);
      return stepDone(ole, object, le, positive ? 0 : step.error);

    case 'request':
      await ole.deleteAtom(high);
      return stepDone(ole, object, le, positive ? 0 : step.error);

    default:
      await ole.deleteAtom(high);
  }
}

/**
 * `WM_DDE_DATA`: data asked for by the step waiting; or an item the server
 * was advised on -- `/Save` and `/Close` of an embedded object's, a link's
 * item and `StdDocumentName` -- each format kept, acknowledged where it
 * asks (but not as the server closes, `/Close`), and its client told once
 * its presentation comes: `OLE_SAVED` for `/Save`, else `OLE_CHANGED`.
 * Data of none (`hData` nought) is a change told with nothing to keep
 * (**recorded** by `oledde`).
 */
async function data(ole: Ole, object: number, le: Le, conv: Conv, hData: number, atom: number) {
  const server = serverOfConv(le, conv);
  const hwnd = windowOfConv(le, conv);
  const at = hData ? await ole.globalLock(hData) : 0;
  const flags = at ? ole.r16(at) : 0;
  const format = at ? ole.r16(plus(at, 2)) : 0;

  if (hData) {
    await ole.globalUnlock(hData);
  }

  const step = le.waiting;

  if (step?.k === 'request' && flags & DATA_RESPONSE) {
    await store(ole, object, le, format, hData);

    if (flags & DATA_ACK_REQ) {
      await post(ole, server, WM_DDE_ACK, hwnd, long(ACK_POSITIVE, atom));
    } else {
      await ole.deleteAtom(atom);
    }

    if (flags & DATA_RELEASE) {
      await freeData(ole, format, hData);
    }

    return stepDone(ole, object, le, 0);
  }

  const name = str(await atomText(ole, atom));
  const when = name.includes('/') ? name.slice(name.indexOf('/') + 1).toLowerCase() : '';

  if (!hData) {
    await ole.deleteAtom(atom);
    await tell(ole, object, OLE_CHANGED);
    return;
  }

  await store(ole, object, le, format, hData);

  if (flags & DATA_ACK_REQ && when !== 'close') {
    await post(ole, server, WM_DDE_ACK, hwnd, long(ACK_POSITIVE, atom));
  } else {
    await ole.deleteAtom(atom);
  }

  if (flags & DATA_RELEASE) {
    await freeData(ole, format, hData);
  }

  if (format === notified(ole, le)) {
    await tell(ole, object, when === 'save' ? OLE_SAVED : OLE_CHANGED);
  }
}

/** The format whose coming tells the client: the picture's, or a Paintbrush object's `Native`. */
const notified = (ole: Ole, le: Le) => (isPBrush(le) ? cf(ole, 'Native') : CF_METAFILEPICT);

/**
 * `WM_DDE_TERMINATE`: the answer to the step's own, its window let go; or
 * the server ending the conversation. An embedded object's document so
 * ended tells its client `OLE_CLOSED`, then closes as `OleClose` does --
 * `[StdCloseDocument]`, its terminate answered, the system topic's ended
 * -- busy until done but telling no release; a link's is answered and
 * forgotten (**recorded** by `oledde`'s `server close`).
 */
async function terminated(ole: Ole, object: number, le: Le, conv: Conv) {
  const step = le.waiting;

  if (step?.k === 'terminate' && step.conv === conv) {
    await endConv(ole, le, conv);
    return stepDone(ole, object, le, 0);
  }

  if (conv === 'doc' && le.type === OT_EMBEDDED && !le.busy) {
    await tell(ole, object, OLE_CLOSED);
    await begin(ole, object, le, [
      { k: 'execute', conv: 'doc', text: bytesOf('[StdCloseDocument]'), error: OLE_ERROR_COMMAND },
      { k: 'reply', conv: 'doc' },
      { k: 'terminate', conv: 'system' },
      { k: 'release', method: OLE_CLOSE, silent: true },
    ]);
    return;
  }

  await post(ole, serverOfConv(le, conv), WM_DDE_TERMINATE, windowOfConv(le, conv), 0);
  await endConv(ole, le, conv);
}

// What each conversation is.

const quote = (bytes: number[]) => [0x22, ...bytes, 0x22];
const bool = (value: number) => bytesOf(value ? 'TRUE' : 'FALSE');

/** The formats an embedded object is advised on, each on `/Save` and `/Close`: `Native` and a picture (**recorded** by `oledde`, drawn). */
function embeddedAdvises(ole: Ole, le: Le): Step[] {
  const steps: Step[] = [];

  for (const when of ['/Save', '/Close']) {
    steps.push({
      k: 'advise',
      item: when,
      format: cf(ole, 'Native'),
      error: OLE_ERROR_ADVISE_NATIVE,
    });

    /* A Paintbrush object's picture is its own (`isPBrush`). */
    if (!isPBrush(le)) {
      steps.push({
        k: 'advise',
        item: when,
        format: CF_METAFILEPICT,
        error: OLE_ERROR_ADVISE_PICT,
      });
    }
  }

  return steps;
}

/** What an embedded object's data is asked for in: `Native`, then a picture but for Paintbrush's. */
function embeddedRequests(ole: Ole, le: Le): Step[] {
  const steps: Step[] = [
    { k: 'request', item: '', format: cf(ole, 'Native'), error: OLE_ERROR_REQUEST_NATIVE },
  ];

  if (!isPBrush(le)) {
    steps.push({ k: 'request', item: '', format: CF_METAFILEPICT, error: OLE_ERROR_REQUEST_PICT });
  }

  return steps;
}

/** The format a link's item is advised on and asked for: a picture, or a Paintbrush link's `Native`. */
const linkFormat = (ole: Ole, le: Le) => (isPBrush(le) ? cf(ole, 'Native') : CF_METAFILEPICT);

/** A link's item advised in a picture and `StdDocumentName` in `Binary`, then its picture asked for and its client told it changed. */
function linkAdvises(ole: Ole, le: Le): Step[] {
  const item = str(le.item);

  return [
    { k: 'advise', item, format: linkFormat(ole, le), error: OLE_ERROR_ADVISE_PICT },
    {
      k: 'advise',
      item: 'StdDocumentName',
      format: cf(ole, 'Binary'),
      error: OLE_ERROR_ADVISE_RENAME,
    },
    { k: 'request', item, format: linkFormat(ole, le), error: OLE_ERROR_REQUEST_PICT },
    { k: 'notify', what: OLE_CHANGED },
  ];
}

/** What an embedded object's server is given as it is opened to edit: its data, then what its client set (**recorded** by `oledde`, in this order). */
function edits(ole: Ole, le: Le, data: number[] | null): Step[] {
  const steps: Step[] = [];
  const binary = cf(ole, 'Binary');

  if (data) {
    steps.push({
      k: 'poke',
      item: '',
      format: cf(ole, 'Native'),
      data,
      error: OLE_ERROR_POKE_NATIVE,
    });
  }

  for (const [item, bytes] of [
    ['StdHostNames', le.hostNames],
    ['StdTargetDevice', le.target],
    ['StdDocDimensions', le.dims],
    ['StdColorScheme', le.scheme],
  ] as const) {
    if (bytes) {
      steps.push({ k: 'poke', item, format: binary, data: bytes, error: OLE_ERROR_POKE_NATIVE });
    }
  }

  return steps;
}

/** A block's bytes. */
async function blockBytes(ole: Ole, handle: number): Promise<number[]> {
  const size = await ole.globalSize(handle);
  const at = await ole.globalLock(handle);
  const bytes = ole.read(at, size);

  await ole.globalUnlock(handle);
  return bytes;
}

/** `[StdDoVerbItem("item",verb,show,!focus)]`: the fourth is TRUE where the focus is not to be taken (**recorded** by `oledde`). */
function doVerb(le: Le, verb: number, show: number, focus: number): number[] {
  return [
    ...bytesOf('[StdDoVerbItem('),
    ...quote(le.item),
    0x2c,
    ...bytesOf(String(verb & 0xffff)),
    0x2c,
    ...bool(show),
    0x2c,
    ...bool(!focus ? 1 : 0),
    ...bytesOf(')]'),
  ];
}

// Making them.

/**
 * `OleCreate` with `StdFileEditing`: an embedded object of the class, its
 * server reached or launched shown, then `[StdNewDocument("class","doc")]`
 * on its system topic, its document's conversation begun, `/Save` and
 * `/Close` advised, `[StdShowItem("")]`; released `OLE_CREATE`. A server
 * that cannot be started is `OLE_ERROR_LAUNCH`.
 */
export async function create(
  ole: Ole,
  client: number,
  klass: number[],
  doc: number,
  name: number,
  out: number,
  activate: boolean,
  render = OLERENDER_DRAW,
  template: number[] | null = null
) {
  const object = await newLe(ole, OT_EMBEDDED, client, doc, name, klass, null, []);

  if (!object) {
    return OLE_ERROR_MEMORY;
  }

  const le = leOf(ole, object)!;

  le.render = render;
  ole.w32(out, object);

  if (!activate) {
    return OLE_OK;
  }

  if (!(await connectSystem(ole, object, le, SW_SHOWNORMAL))) {
    await freeLe(ole, object, le);
    ole.w32(out, 0);
    return OLE_ERROR_LAUNCH;
  }

  /* From a template, the documented `StdNewFromTemplate` with the
   * template's file (the OLE 1.0 programmer's reference; `unrecorded` on
   * the client's side, the server's measured by `olesrv`). */
  const command = template
    ? [
        ...bytesOf('[StdNewFromTemplate('),
        ...quote(le.klass),
        0x2c,
        ...quote(le.topic),
        0x2c,
        ...quote(template),
        ...bytesOf(')]'),
      ]
    : [
        ...bytesOf('[StdNewDocument('),
        ...quote(le.klass),
        0x2c,
        ...quote(le.topic),
        ...bytesOf(')]'),
      ];

  await begin(ole, object, le, [
    {
      k: 'execute',
      conv: 'system',
      text: command,
      error: OLE_ERROR_NEW,
    },
    { k: 'initiate' },
    ...embeddedAdvises(ole, le),
    { k: 'execute', conv: 'doc', text: bytesOf('[StdShowItem("")]'), error: OLE_ERROR_COMMAND },
    { k: 'release', method: OLE_CREATE },
  ]);
  return OLE_WAIT_FOR_RELEASE;
}

/**
 * `OleCreateFromFile` and `OleCreateLinkFromFile` with `StdFileEditing`:
 * the file's document reached as a topic of the class, its server launched
 * hidden with the file where none answers; an embedded object asks for
 * its `Native` and its picture, a link advises its item and
 * `StdDocumentName` and asks for its picture; its client told it changed,
 * the conversation ended; released `OLE_CREATEFROMFILE` or
 * `OLE_CREATELINKFROMFILE` (**recorded** by `oledde`).
 */
export async function createFromFile(
  ole: Ole,
  client: number,
  klass: number,
  file: number,
  item: number,
  doc: number,
  name: number,
  out: number,
  linked: boolean,
  render = OLERENDER_DRAW
) {
  const object = await newLe(
    ole,
    linked ? OT_LINK : OT_EMBEDDED,
    client,
    doc,
    name,
    ole.string(klass),
    ole.string(file),
    linked && item ? ole.string(item) : []
  );

  if (!object) {
    return OLE_ERROR_MEMORY;
  }

  const le = leOf(ole, object)!;

  le.render = render;

  /* An embedded object's server is told the file; the object is numbered
   * only once it is reached (**measured** by `olehnd`: one whose server
   * cannot be started takes no number). */
  const connected = await connectDoc(ole, object, le, SW_HIDE);

  if (!connected) {
    await freeLe(ole, object, le);
    return OLE_ERROR_LAUNCH;
  }

  if (!linked) {
    le.topic = await embeddedTopic(ole, doc, ole.string(name));
  }

  ole.w32(out, object);

  const steps: Step[] = linked
    ? linkAdvises(ole, le)
    : [...embeddedRequests(ole, le), { k: 'notify', what: OLE_CHANGED }];

  await begin(ole, object, le, [
    ...steps,
    { k: 'terminate', conv: 'doc' },
    { k: 'release', method: linked ? OLE_CREATELINKFROMFILE : OLE_CREATEFROMFILE },
  ]);

  return OLE_WAIT_FOR_RELEASE;
}

/** The class `OwnerLink` or `ObjectLink` on the clipboard names; null for none. */
export async function clipClass(ole: Ole, linked: boolean): Promise<number[] | null> {
  const owner =
    (await ole.user('GetClipboardData', [W(cf(ole, linked ? 'ObjectLink' : 'OwnerLink'))])) &
    0xffff;

  return owner ? (await linkParts(ole, owner))[0] : null;
}

/** A clipboard's block of `OwnerLink` or `ObjectLink`: its class, document and item. */
async function linkParts(ole: Ole, handle: number): Promise<[number[], number[], number[]]> {
  const at = await ole.globalLock(handle);
  const klass = ole.string(at);
  const doc = ole.string(plus(at, klass.length + 1));
  const item = ole.string(plus(at, klass.length + doc.length + 2));

  await ole.globalUnlock(handle);
  return [klass, doc, item];
}

/**
 * `DefCreateFromClip` and `DefCreateLinkFromClip` (`OleCreateFromClip` and
 * `OleCreateLinkFromClip` with `StdFileEditing`): an embedded object of
 * `OwnerLink`'s class and item with the clipboard's `Native`, or a link to
 * `ObjectLink`'s document and item; each with the clipboard's first
 * picture, none where it is to render none, or the format it is to render
 * -- its class's `Native` a presentation of that format. No server is asked
 * (**recorded** by `oledde`'s `clip`, **measured** by `olehnd`'s `clip
 * none`; Paintbrush's handler asks a link for `Native` and an embedded
 * object for none, `OLECLI.DLL` seg7 `00ac`-`0176`).
 */
export async function fromClip(
  ole: Ole,
  client: number,
  doc: number,
  name: number,
  out: number,
  linked: boolean,
  render = OLERENDER_DRAW,
  format = 0
) {
  const owner =
    (await ole.user('GetClipboardData', [W(cf(ole, linked ? 'ObjectLink' : 'OwnerLink'))])) &
    0xffff;

  if (!owner) {
    return OLE_ERROR_FORMAT;
  }

  const [klass, file, item] = await linkParts(ole, owner);
  const object = await newLe(
    ole,
    linked ? OT_LINK : OT_EMBEDDED,
    client,
    doc,
    name,
    klass,
    linked ? file : null,
    item
  );

  if (!object) {
    return OLE_ERROR_MEMORY;
  }

  const le = leOf(ole, object)!;

  le.render = render;

  if (!linked) {
    const native = (await ole.user('GetClipboardData', [W(cf(ole, 'Native'))])) & 0xffff;

    if (native) {
      le.native = await copyBlock(ole, native);
    }
  }

  let each = 0;

  if (render === OLERENDER_FORMAT) {
    each = format & 0xffff;
  } else if (render !== OLERENDER_NONE) {
    for (;;) {
      each = (await ole.user('EnumClipboardFormats', [W(each)])) & 0xffff;

      if (!each || isPicture(each)) {
        break;
      }
    }
  }

  if (each) {
    const handle = (await ole.user('GetClipboardData', [W(each)])) & 0xffff;
    const picture = !handle
      ? 0
      : each === cf(ole, 'Native')
        ? await nativePicture(ole, object, le, await copyBlock(ole, handle))
        : isPicture(each)
          ? await pictureFrom(ole, object, each, handle)
          : 0;

    if (picture) {
      setPicture(ole, object, le, picture);
    }
  }

  ole.w32(out, object);
  return OLE_OK;
}

// Streams.

/** A length and a string, or a length of nought for none. */
async function putString(ole: Ole, stream: number, bytes: number[]) {
  return bytes.length ? putName(ole, stream, bytes) : putLong(ole, stream, 0);
}

async function getString(ole: Ole, stream: number): Promise<number[] | null> {
  const length = await getLong(ole, stream);

  if (length === null || length > 0x100) {
    return null;
  }

  if (!length) {
    return [];
  }

  const at = ole.near(SCRATCH);

  return (await get(ole, stream, at, length)) ? ole.string(at) : null;
}

/**
 * `LESAVETOSTREAM` (207): 0501h, the type, the class, the document and the
 * item -- an embedded object's none -- then an embedded object's `Native`,
 * its size and bytes, or a link's network name (none), a doubleword nought
 * and its update option; then its presentation as a static object's is
 * written but of type 5, or 0501h and nought for none (**recorded** by
 * `oledde` and `olepbr`).
 */
export async function saveToStream(ole: Ole, object: number, stream: number) {
  const le = leOf(ole, object)!;
  const embedded = le.type === OT_EMBEDDED;
  let ok =
    (await putLong(ole, stream, STREAM_VERSION)) &&
    (await putLong(ole, stream, le.type)) &&
    (await putName(ole, stream, le.klass)) &&
    (await putString(ole, stream, embedded ? [] : le.topic)) &&
    (await putString(ole, stream, le.item));

  if (ok && embedded) {
    const size = le.native ? await ole.globalSize(le.native) : 0;

    ok = await putLong(ole, stream, size);

    if (ok && size) {
      const at = await ole.globalLock(le.native);

      ok = await put(ole, stream, at, size);
      await ole.globalUnlock(le.native);
    }
  } else if (ok) {
    ok =
      (await putString(ole, stream, le.network)) &&
      (await putLong(ole, stream, 0)) &&
      (await putLong(ole, stream, le.update));
  }

  if (!ok) {
    return OLE_ERROR_STREAM;
  }

  if (!le.picture) {
    return (await putLong(ole, stream, STREAM_VERSION)) && (await putLong(ole, stream, 0))
      ? OLE_OK
      : OLE_ERROR_STREAM;
  }

  return saveStatic(ole, kindOf(ole, le.picture) ?? 'mf', le.picture, stream, PRESENTATION);
}

/** A presentation's type in a stream. */
const PRESENTATION = 5;

/** A stream's class's name, read after its version and type: `OleLoadFromStream` reads it before it finds the class's handler. */
export async function getClass(ole: Ole, stream: number): Promise<number[] | null> {
  const klass = await getString(ole, stream);

  return klass && klass.length ? klass : null;
}

/**
 * `DefLoadFromStream`: an embedded (2) or linked (1) object of the class
 * given, the stream read on from after its class's name -- what
 * `LESAVETOSTREAM` writes read back. An embedded object is numbered as it
 * is loaded.
 */
export async function load(
  ole: Ole,
  stream: number,
  type: number,
  client: number,
  doc: number,
  name: number,
  out: number,
  klass: number[],
  atom = 0
) {
  const topic = await getString(ole, stream);
  const item = topic && (await getString(ole, stream));

  if (!klass.length || !topic || !item) {
    await ole.deleteAtom(atom);
    return OLE_ERROR_STREAM;
  }

  const object = await newLe(
    ole,
    type,
    client,
    doc,
    name,
    klass,
    type === OT_LINK ? topic : null,
    item,
    atom
  );

  if (!object) {
    return OLE_ERROR_MEMORY;
  }

  const le = leOf(ole, object)!;
  const failed = async () => {
    await freeLe(ole, object, le);
    return OLE_ERROR_STREAM;
  };

  if (type === OT_EMBEDDED) {
    const size = await getLong(ole, stream);

    if (size === null) {
      return failed();
    }

    if (size) {
      le.native = await readBlock(ole, stream, size);

      if (!le.native) {
        return failed();
      }
    }
  } else {
    const network = await getString(ole, stream);
    const reserved = network && (await getLong(ole, stream));
    const update = reserved !== null && network ? await getLong(ole, stream) : null;

    if (update === null) {
      return failed();
    }

    le.update = update & 0xffff;
    le.network = network!;
  }

  const version = await getLong(ole, stream);
  const kind = version === null ? null : await getLong(ole, stream);

  if (kind === null) {
    return failed();
  }

  if (kind) {
    const named = await getString(ole, stream);

    if (!named || !named.length) {
      return failed();
    }

    const which =
      (Object.keys(CLASS_OF) as Exclude<Kind, 'gen' | 'le' | 'pb'>[]).find(
        (each) => CLASS_OF[each] === str(named)
      ) ?? 'gen';
    const picture = await newObject(ole, which, BLOCK_OF[which], ole.r32(plus(object, 8)), 0, 0);
    const read = !picture
      ? OLE_ERROR_MEMORY
      : which === 'gen'
        ? await readOther(ole, picture, stream, await ole.addAtomText(named))
        : await readStatic(ole, which, picture, stream);

    if (read !== OLE_OK) {
      if (picture) {
        await releaseStatic(ole, which, picture);
      }

      return failed();
    }

    setPicture(ole, object, le, picture);
  }

  ole.w32(out, object);
  return OLE_OK;
}

// The methods.

/** `OBJQUERYSIZE` (913) of one: what `LESAVETOSTREAM` would write; an embedded object with no data `OLE_ERROR_BLANK` (**recorded** by `oledde`). */
export async function querySize(ole: Ole, object: number, out: number) {
  const le = leOf(ole, object)!;
  const string = (bytes: number[]) => 4 + (bytes.length ? bytes.length + 1 : 0);

  if (le.type === OT_EMBEDDED && !le.native) {
    ole.w32(out, 0);
    return OLE_ERROR_BLANK;
  }

  let size =
    8 + string(le.klass) + string(le.type === OT_EMBEDDED ? [] : le.topic) + string(le.item);

  size += le.type === OT_EMBEDDED ? 4 + (await ole.globalSize(le.native)) : string(le.network) + 8;
  size += 8;

  if (le.picture) {
    /* Its presentation's as a static object's stream, less what is said before it. */
    const at = ole.near(SCRATCH + 0xf0);

    await staticSize(ole, kindOf(ole, le.picture) ?? 'mf', le.picture, at);
    size += ole.r32(at) - 8;
  }

  ole.w32(out, size >>> 0);
  return OLE_OK;
}

/** Noughts written to a rectangle, and `OLE_ERROR_BLANK`: a presentation's bounds where there is none. */
function noBounds(ole: Ole, rect: number) {
  for (let i = 0; i < 8; i += 2) {
    ole.w16(plus(rect, i), 0);
  }

  return OLE_ERROR_BLANK;
}

/** `LEQUERYBOUNDS` (213): its presentation's; none `OLE_ERROR_BLANK`, noughts written. */
function queryBounds(ole: Ole, object: number, rect: number) {
  const le = leOf(ole, object)!;

  if (!le.picture) {
    return noBounds(ole, rect);
  }

  return staticBounds(ole, kindOf(ole, le.picture) ?? 'mf', le.picture, rect);
}

/**
 * The formats it gives, in `OleEnumFormats`' order: `Native` and
 * `OwnerLink`, or `ObjectLink`, then its presentation's -- a picture where
 * it has none yet, nothing where it was made to render none (**measured**
 * by `olehnd`'s `clip none` and `le invisible none`).
 */
function formats(ole: Ole, le: Le): number[] {
  const picture = le.picture
    ? [FORMAT_OF[(kindOf(ole, le.picture) ?? 'mf') as 'mf'] ?? CF_METAFILEPICT]
    : le.render === OLERENDER_NONE
      ? []
      : [CF_METAFILEPICT];

  if (le.type === OT_EMBEDDED) {
    return [cf(ole, 'Native'), cf(ole, 'OwnerLink'), ...picture];
  }

  return [cf(ole, 'ObjectLink'), ...picture];
}

/** The format after the one given in a list, nought after the last; the first for nought. */
function nextFormat(list: number[], format: number) {
  if (!format) {
    return list[0] ?? 0;
  }

  const at = list.indexOf(format & 0xffff);

  return at >= 0 && at + 1 < list.length ? list[at + 1] : 0;
}

function enumFormat(ole: Ole, object: number, format: number) {
  return nextFormat(formats(ole, leOf(ole, object)!), format);
}

/** `OwnerLink`'s or `ObjectLink`'s bytes: its class, document and item, each with its nought, and a nought. */
function linkBytes(le: Le): number[] {
  return [...le.klass, 0, ...le.topic, 0, ...le.item, 0, 0];
}

/** `Native`, `OwnerLink` or `ObjectLink`, as every embedded or linked object gives them; null for another format. */
async function ownData(ole: Ole, le: Le, format: number, out: number): Promise<number | null> {
  if (format === cf(ole, 'Native') && le.type === OT_EMBEDDED) {
    if (!le.native) {
      return OLE_ERROR_FORMAT;
    }

    ole.w16(out, le.native);
    return OLE_OK;
  }

  if (format === cf(ole, le.type === OT_EMBEDDED ? 'OwnerLink' : 'ObjectLink')) {
    if (le.link) {
      await ole.globalFree(le.link);
    }

    le.link = await sharedBlock(ole, linkBytes(le));
    ole.w16(out, le.link);
    return OLE_OK;
  }

  return null;
}

/**
 * `LEGETDATA` (202): `Native` where it has some, else `OLE_ERROR_FORMAT`;
 * `OwnerLink` or `ObjectLink` made of its class, document and item; its
 * presentation's; a picture where it has none, an empty `METAFILEPICT`
 * (**recorded** by `oledde`).
 */
async function getData(ole: Ole, object: number, format: number, out: number) {
  const le = leOf(ole, object)!;

  format &= 0xffff;

  const own = await ownData(ole, le, format, out);

  if (own !== null) {
    return own;
  }

  if (le.picture) {
    return getStaticData(ole, kindOf(ole, le.picture) ?? 'mf', le.picture, format, out);
  }

  if (format !== CF_METAFILEPICT) {
    return OLE_ERROR_FORMAT;
  }

  if (!le.blank) {
    le.blank = await ole.globalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 8);
  }

  ole.w16(out, le.blank);
  return OLE_OK;
}

/** `Native` and `OwnerLink` put on the clipboard, as every embedded or linked object puts them. */
async function copyOwn(ole: Ole, le: Le) {
  if (le.type === OT_EMBEDDED && le.native) {
    await ole.user('SetClipboardData', [W(cf(ole, 'Native')), W(await copyBlock(ole, le.native))]);
  }

  await ole.user('SetClipboardData', [
    W(cf(ole, 'OwnerLink')),
    W(await sharedBlock(ole, linkBytes(le))),
  ]);
}

/** `LECOPY` (211): its data put on the clipboard: `Native`, `OwnerLink` and its presentation; a link's `OwnerLink` and presentation (**recorded** by `oledde`). */
async function copyToClipboard(ole: Ole, object: number) {
  const le = leOf(ole, object)!;

  await copyOwn(ole, le);

  if (le.picture) {
    await copyStatic(ole, kindOf(ole, le.picture) ?? 'mf', le.picture);
  }

  return OLE_OK;
}

// Paintbrush's methods, the `PB` exports its table holds in five slots.

/** `PBQUERYBOUNDS` (806): its bitmap's at its pixels to a metre; none `OLE_ERROR_BLANK`, noughts written (**recorded** by `olepbd`, **measured** by `olehnd`). */
function pbQueryBounds(ole: Ole, object: number, rect: number) {
  const le = leOf(ole, object)!;

  return le.view ? staticBounds(ole, 'dib', le.view, rect) : noBounds(ole, rect);
}

/**
 * `PBENUMFORMATS` (810): `Native`, `OwnerLink` and a picture; a link's
 * `ObjectLink`, its `Native` where its presentation is that, and a picture
 * (**measured** by `olehnd`'s `link native` and `link none`).
 */
function pbEnumFormats(ole: Ole, object: number, format: number) {
  const le = leOf(ole, object)!;
  const list =
    le.type === OT_EMBEDDED
      ? [cf(ole, 'Native'), cf(ole, 'OwnerLink'), CF_METAFILEPICT]
      : [cf(ole, 'ObjectLink'), ...(le.picture ? [cf(ole, 'Native')] : []), CF_METAFILEPICT];

  return nextFormat(list, format);
}

/**
 * `PBGETDATA` (811): what every object gives; a link's `Native`, its
 * presentation's; a picture made from the bitmap for the caller to let go,
 * `OLE_WARN_DELETE_DATA`; none, `OLE_ERROR_MEMORY` (**recorded** by
 * `olepbd` and `olepbr`, **measured** by `olehnd`).
 */
async function pbGetData(ole: Ole, object: number, format: number, out: number) {
  const le = leOf(ole, object)!;

  format &= 0xffff;

  const own = await ownData(ole, le, format, out);

  if (own !== null) {
    return own;
  }

  if (format === cf(ole, 'Native') && le.picture) {
    ole.w16(out, ole.r16(plus(le.picture, GEN_DATA)));
    return OLE_OK;
  }

  if (format !== CF_METAFILEPICT) {
    return OLE_ERROR_FORMAT;
  }

  if (!le.view) {
    return OLE_ERROR_MEMORY;
  }

  ole.w16(out, await pictureOfView(ole, le));
  return OLE_WARN_DELETE_DATA;
}

/** `PBCOPYTOCLIPBOARD` (807): `Native` and `OwnerLink`, and a picture made from the bitmap (**measured** by `olehnd`). */
async function pbCopyToClipboard(ole: Ole, object: number) {
  const le = leOf(ole, object)!;

  await copyOwn(ole, le);

  if (le.view) {
    await ole.user('SetClipboardData', [W(CF_METAFILEPICT), W(await pictureOfView(ole, le))]);
  }

  return OLE_OK;
}

/** `PBDRAW` (805): its bitmap drawn; none `OLE_ERROR_BLANK`. */
function pbDraw(ole: Ole, object: number, dc: number, bounds: number, window: number) {
  const le = leOf(ole, object)!;

  return le.view ? draw(ole, 'dib', le.view, dc, bounds, window) : OLE_ERROR_BLANK;
}

/** Paintbrush's methods by ordinal. */
export const PB_METHODS: Record<number, (ole: Ole, args: number[]) => Promise<number> | number> = {
  805: (ole, [object, dc, bounds, window]) => pbDraw(ole, object, dc, bounds, window),
  806: (ole, [object, rect]) => pbQueryBounds(ole, object, rect),
  807: (ole, [object]) => pbCopyToClipboard(ole, object),
  810: (ole, [object, format]) => pbEnumFormats(ole, object, format),
  811: (ole, [object, format, out]) => pbGetData(ole, object, format, out),
};

/**
 * An object `OLECLI`'s handler of `PBrush` made, given Paintbrush's table
 * where it has no picture -- no presentation, or one of another format,
 * its class's `Native` -- and its picture made from its bitmap (**read
 * out**: `OLECLI.DLL` seg7 `052a`, the routine each `Pb` export calls after
 * its default, and seg7 `09ae`, which tells a presentation that is no
 * picture by its `QueryType`'s `OLE_ERROR_GENERIC`; the table it gives is
 * the object's with five methods changed, **measured** by `olehnd`).
 */
export async function pbTable(ole: Ole, object: number) {
  const le = leOf(ole, object);

  if (!le || (le.picture && kindOf(ole, le.picture) !== 'gen')) {
    return;
  }

  ole.w32(plus(object, OBJ_VTBL), vtblOf(ole, 'pb'));
  await refreshView(ole, object, le);
}

/** `LECLONE` (208): another of the same in the document given, numbered anew, its data and presentation copied. */
async function clone(
  ole: Ole,
  object: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  const le = leOf(ole, object)!;
  const copy = await newLe(
    ole,
    le.type,
    client,
    doc,
    name,
    le.klass,
    le.type === OT_LINK ? le.topic : null,
    le.item
  );

  if (!copy) {
    return OLE_ERROR_MEMORY;
  }

  const made = leOf(ole, copy)!;

  made.update = le.update;
  made.hostNames = le.hostNames;
  made.dims = le.dims;
  made.scheme = le.scheme;
  made.target = le.target;

  if (le.native) {
    made.native = await copyBlock(ole, le.native);
  }

  if (le.picture) {
    const at = ole.near(SCRATCH + 0xf0);

    if (
      (await cloneStatic(ole, kindOf(ole, le.picture) ?? 'mf', le.picture, client, 0, 0, at)) ===
      OLE_OK
    ) {
      setPicture(ole, copy, made, ole.r32(at));
    }
  }

  made.render = le.render;
  made.network = le.network;
  made.drive = le.drive;

  /* The copy holds its original's table: Paintbrush's, its picture made again. */
  if (kindOf(ole, object) === 'pb') {
    ole.w32(plus(copy, OBJ_VTBL), vtblOf(ole, 'pb'));
    await refreshView(ole, copy, made);
  }

  ole.w32(out, copy);
  return OLE_OK;
}

/** `LEEQUAL` (210): the same type, class, item and document, and an embedded object's `Native` the same (**recorded** by `oledde`: a clone equal, an embedded object and a link not). */
async function equal(ole: Ole, a: number, b: number) {
  const one = leOf(ole, a)!;
  const other = leOf(ole, b);
  const same = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);

  if (
    !other ||
    one.type !== other.type ||
    !same(one.klass, other.klass) ||
    !same(one.item, other.item) ||
    (one.type === OT_LINK && !same(one.topic, other.topic))
  ) {
    return OLE_ERROR_NOT_EQUAL;
  }

  if (one.type === OT_EMBEDDED && one.native && other.native) {
    return sameBlocks(ole, one.native, other.native);
  }

  return one.native || other.native ? OLE_ERROR_NOT_EQUAL : OLE_OK;
}

/** Whether the object talks with its server: open. */
const open = (le: Le) => le.doc !== 0;

/**
 * `LERELEASE` (200), its `Delete` too: one not open let go at once; an
 * open one closed first -- `[StdCloseDocument]`, its conversations ended
 * -- its client told `OLE_RELEASE`, `OLE_DELETE`, and then let go
 * (**recorded** by `oledde`).
 */
async function release(ole: Ole, object: number) {
  const le = leOf(ole, object)!;

  if (le.busy) {
    return OLE_BUSY;
  }

  if (!open(le)) {
    await freeLe(ole, object, le);
    return OLE_OK;
  }

  await begin(ole, object, le, [...closing(le), { k: 'release', method: OLE_DELETE, free: true }]);
  return OLE_WAIT_FOR_RELEASE;
}

/** Closing: an embedded object's `[StdCloseDocument]`, then each conversation ended. */
function closing(le: Le): Step[] {
  return le.type === OT_EMBEDDED
    ? [
        {
          k: 'execute',
          conv: 'doc',
          text: bytesOf('[StdCloseDocument]'),
          error: OLE_ERROR_COMMAND,
        },
        { k: 'terminate', conv: 'doc' },
        { k: 'terminate', conv: 'system' },
      ]
    : [{ k: 'terminate', conv: 'doc' }];
}

/** `LECLOSE` (225): one not open `OLE_OK`; else closed, released `OLE_CLOSE`. */
async function close(ole: Ole, object: number) {
  const le = leOf(ole, object)!;

  if (le.busy) {
    return OLE_BUSY;
  }

  if (!open(le)) {
    return OLE_OK;
  }

  await begin(ole, object, le, [...closing(le), { k: 'release', method: OLE_CLOSE }]);
  return OLE_WAIT_FOR_RELEASE;
}

/**
 * `LEACTIVATE` (216) and `DoVerb` (1005): open, `[StdDoVerbItem(...)]`
 * released `OLE_RUN`. An embedded object not open: its server reached or
 * launched shown, `[StdEditDocument("doc")]`, its document's conversation
 * begun, its `Native` and what its client set poked, advised as at its
 * making, the verb; a link: its file's document reached or its server
 * launched shown with it, advised and its picture asked for, the verb.
 * Released `OLE_ACTIVATE` (**recorded** by `oledde`).
 */
async function activate(ole: Ole, object: number, verb: number, show: number, focus: number) {
  const le = leOf(ole, object)!;
  const verbStep: Step = {
    k: 'execute',
    conv: 'doc',
    text: doVerb(le, verb, show, focus),
    error: OLE_ERROR_DOVERB,
  };

  if (le.busy) {
    return OLE_BUSY;
  }

  if (open(le)) {
    await begin(ole, object, le, [verbStep, { k: 'release', method: OLE_RUN }]);
    return OLE_WAIT_FOR_RELEASE;
  }

  if (le.type === OT_LINK) {
    if (!(await connectDoc(ole, object, le, SW_SHOWNORMAL))) {
      return OLE_ERROR_LAUNCH;
    }

    await begin(ole, object, le, [
      ...linkAdvises(ole, le),
      verbStep,
      { k: 'release', method: OLE_ACTIVATE },
    ]);
    return OLE_WAIT_FOR_RELEASE;
  }

  if (!(await connectSystem(ole, object, le, SW_SHOWNORMAL))) {
    return OLE_ERROR_LAUNCH;
  }

  const native = le.native ? await blockBytes(ole, le.native) : null;

  await begin(ole, object, le, [
    {
      k: 'execute',
      conv: 'system',
      text: [...bytesOf('[StdEditDocument('), ...quote(le.topic), ...bytesOf(')]')],
      error: OLE_ERROR_EDIT,
    },
    { k: 'initiate' },
    ...edits(ole, le, native),
    ...embeddedAdvises(ole, le),
    verbStep,
    { k: 'release', method: OLE_ACTIVATE },
  ]);
  return OLE_WAIT_FOR_RELEASE;
}

/** A poke while open, released `OLE_OTHER`; kept for the next opening either way. */
async function setAndPoke(
  ole: Ole,
  object: number,
  le: Le,
  item: string,
  bytes: number[],
  method = OLE_OTHER,
  format?: number
) {
  if (!open(le)) {
    return OLE_OK;
  }

  if (le.busy) {
    return OLE_BUSY;
  }

  await begin(ole, object, le, [
    {
      k: 'poke',
      item,
      format: format ?? cf(ole, 'Binary'),
      data: bytes,
      error: OLE_ERROR_POKE_NATIVE,
    },
    { k: 'release', method },
  ]);
  return OLE_WAIT_FOR_RELEASE;
}

/** `LESETHOSTNAMES` (204): the two names kept, after two offsets to them, and poked as `StdHostNames` while open (**recorded** by `oledde`). */
async function setHostNames(ole: Ole, object: number, client: number, doc: number) {
  const le = leOf(ole, object)!;

  /* A link's server is not told host names: `OLE_ERROR_OBJECT` (**measured** by `oleemb`). */
  if (le.type === OT_LINK) {
    return OLE_ERROR_OBJECT;
  }

  const first = ole.string(client);
  const second = ole.string(doc);

  le.hostNames = [...word(0), ...word(first.length + 1), ...first, 0, ...second, 0];
  return setAndPoke(ole, object, le, 'StdHostNames', le.hostNames);
}

/** `LESETBOUNDS` (206): its width and height, twice, kept and poked as `StdDocDimensions` (**recorded** by `oledde`: `0,0,1500,-750` poked as 1500, 750, 1500, 750). */
async function setBounds(ole: Ole, object: number, rect: number) {
  const le = leOf(ole, object)!;
  const left = ole.r16(rect);
  const top = ole.r16(plus(rect, 2));
  const right = ole.r16(plus(rect, 4));
  const bottom = ole.r16(plus(rect, 6));
  const width = (right - left) & 0xffff;
  const height = (top - bottom) & 0xffff;

  le.dims = [...word(width), ...word(height), ...word(width), ...word(height)];
  return setAndPoke(ole, object, le, 'StdDocDimensions', le.dims);
}

/** `SetColorScheme` (1004): the `LOGPALETTE`, kept and poked as `StdColorScheme`. */
async function setColorScheme(ole: Ole, object: number, palette: number) {
  const le = leOf(ole, object)!;
  const count = ole.r16(plus(palette, 2));

  le.scheme = ole.read(palette, 4 + count * 4);
  return setAndPoke(ole, object, le, 'StdColorScheme', le.scheme);
}

/** `LESETTARGETDEVICE` (205): the block's bytes, kept and poked as `StdTargetDevice`. */
async function setTargetDevice(ole: Ole, object: number, device: number) {
  const le = leOf(ole, object)!;

  le.target = await blockBytes(ole, device);
  return setAndPoke(ole, object, le, 'StdTargetDevice', le.target);
}

/** `LESETDATA` (203): `Native` copied in, its client told it changed, and poked while open, released `OLE_SETDATA` (**recorded** by `oledde`). */
async function setData(ole: Ole, object: number, format: number, handle: number) {
  const le = leOf(ole, object)!;

  if ((format & 0xffff) !== cf(ole, 'Native')) {
    return OLE_ERROR_FORMAT;
  }

  if (le.busy) {
    return OLE_BUSY;
  }

  const copy = await copyBlock(ole, handle);

  if (le.native) {
    await ole.globalFree(le.native);
  }

  le.native = copy;

  if (kindOf(ole, object) === 'pb') {
    await refreshView(ole, object, le);
  }

  await tell(ole, object, OLE_CHANGED);
  return setAndPoke(
    ole,
    object,
    le,
    '',
    await blockBytes(ole, handle),
    OLE_SETDATA,
    cf(ole, 'Native')
  );
}

/** `LEEXECUTE` (228): the commands sent on its document, a copy of them, released `OLE_OTHER`. */
async function execute(ole: Ole, object: number, commands: number) {
  const le = leOf(ole, object)!;

  if (!open(le)) {
    return OLE_ERROR_NOT_OPEN;
  }

  if (le.busy) {
    return OLE_BUSY;
  }

  const at = await ole.globalLock(commands);
  const command = ole.string(at);

  await ole.globalUnlock(commands);
  await begin(ole, object, le, [
    { k: 'execute', conv: 'doc', text: command, error: OLE_ERROR_COMMAND },
    { k: 'release', method: OLE_OTHER },
  ]);
  return OLE_WAIT_FOR_RELEASE;
}

/** `LEUPDATE` (218): open, `Native` and a picture asked for, or a link's item's; its client told it changed; released `OLE_UPDATE`. */
async function update(ole: Ole, object: number) {
  const le = leOf(ole, object)!;

  if (le.busy) {
    return OLE_BUSY;
  }

  if (!open(le)) {
    return OLE_OK;
  }

  const steps: Step[] =
    le.type === OT_EMBEDDED
      ? embeddedRequests(ole, le)
      : [
          {
            k: 'request',
            item: str(le.item),
            format: linkFormat(ole, le),
            error: OLE_ERROR_REQUEST_PICT,
          },
        ];

  await begin(ole, object, le, [
    ...steps,
    { k: 'notify', what: OLE_CHANGED },
    { k: 'release', method: OLE_UPDATE },
  ]);
  return OLE_WAIT_FOR_RELEASE;
}

/** `RequestData` (1000): open, the format asked for, its client told it changed; released `OLE_REQUESTDATA`; refused, `OLE_ERROR_REQUEST_PICT` (**recorded** by `oledde`, `CF_TEXT`). */
async function requestData(ole: Ole, object: number, format: number) {
  const le = leOf(ole, object)!;

  if (!open(le)) {
    return OLE_ERROR_NOT_OPEN;
  }

  if (le.busy) {
    return OLE_BUSY;
  }

  const native = (format & 0xffff) === cf(ole, 'Native');

  await begin(ole, object, le, [
    {
      k: 'request',
      item: le.type === OT_LINK ? str(le.item) : '',
      format: format & 0xffff,
      error: native ? OLE_ERROR_REQUEST_NATIVE : OLE_ERROR_REQUEST_PICT,
    },
    { k: 'notify', what: OLE_CHANGED },
    { k: 'release', method: OLE_REQUESTDATA },
  ]);
  return OLE_WAIT_FOR_RELEASE;
}

/** `LERECONNECT` (219): a link not open connected to a server that has its document, without launching one: advised, its picture asked for; released `OLE_RECONNECT`. None answering, `OLE_OK` (**recorded** by `oledde`). */
async function reconnect(ole: Ole, object: number) {
  const le = leOf(ole, object)!;

  if (le.type !== OT_LINK || open(le)) {
    return OLE_OK;
  }

  if (le.busy) {
    return OLE_BUSY;
  }

  if (!(await connectDoc(ole, object, le, null))) {
    return OLE_OK;
  }

  await begin(ole, object, le, [...linkAdvises(ole, le), { k: 'release', method: OLE_RECONNECT }]);
  return OLE_WAIT_FOR_RELEASE;
}

/**
 * `OleLockServer` of an embedded object: its class's server reached on
 * its system topic, or launched hidden; the handle given is that
 * conversation's window (**recorded** by `oledde`).
 */
export async function lockServer(ole: Ole, object: number, out: number) {
  const le = leOf(ole, object)!;
  const system = le.system;
  const server = le.systemServer;

  if (!(await connectSystem(ole, object, le, SW_HIDE))) {
    return OLE_ERROR_LAUNCH;
  }

  const hwnd = le.system;

  ole.state().locks.set(hwnd, { server: le.systemServer });
  le.system = system;
  le.systemServer = server;
  ole.w32(out, hwnd);
  return OLE_OK;
}

/** `OleUnlockServer`: its conversation ended, the window let go as the server answers. */
export async function unlockServer(ole: Ole, handle: number) {
  const lock = ole.state().locks.get(handle & 0xffff);

  if (!lock) {
    return null;
  }

  await post(ole, lock.server, WM_DDE_TERMINATE, handle & 0xffff, 0);
  return OLE_WAIT_FOR_RELEASE;
}

/** The methods of the `LE` exports and the unnamed entries an embedded or linked object's table holds, by ordinal. */
export const LE_METHODS: Record<number, (ole: Ole, args: number[]) => Promise<number> | number> = {
  200: (ole, [object]) => release(ole, object),
  202: (ole, [object, format, out]) => getData(ole, object, format, out),
  203: (ole, [object, format, handle]) => setData(ole, object, format, handle),
  204: (ole, [object, client, doc]) => setHostNames(ole, object, client, doc),
  205: (ole, [object, device]) => setTargetDevice(ole, object, device),
  206: (ole, [object, rect]) => setBounds(ole, object, rect),
  207: (ole, [object, stream]) => saveToStream(ole, object, stream),
  208: (ole, [object, client, doc, name, out]) => clone(ole, object, client, doc, name, out),
  210: (ole, [a, b]) => equal(ole, a, b),
  211: (ole, [object]) => copyToClipboard(ole, object),
  212: (ole, [object, out]) => {
    ole.w32(out, leOf(ole, object)!.type);
    return OLE_OK;
  },
  213: (ole, [object, rect]) => queryBounds(ole, object, rect),
  214: (ole, [object, dc, bounds, window]) => {
    const le = leOf(ole, object)!;

    return le.picture
      ? draw(ole, kindOf(ole, le.picture) ?? 'mf', le.picture, dc, bounds, window)
      : OLE_ERROR_BLANK;
  },
  215: (ole, [object]) => (open(leOf(ole, object)!) ? OLE_OK : OLE_ERROR_NOT_OPEN),
  216: (ole, [object, verb, show, focus]) => activate(ole, object, verb, show, focus),
  218: (ole, [object]) => update(ole, object),
  219: (ole, [object]) => reconnect(ole, object),
  220: (ole, [object, format]) => enumFormat(ole, object, format),
  221: () => 0,
  222: () => OLE_OK,
  225: (ole, [object]) => close(ole, object),
  226: (ole, [object, out]) => {
    const le = leOf(ole, object)!;

    if (le.type !== OT_LINK) {
      return OLE_ERROR_OBJECT;
    }

    ole.w16(out, le.update);
    return OLE_OK;
  },
  227: (ole, [object, option]) => {
    const le = leOf(ole, object)!;

    if (le.type !== OT_LINK) {
      return OLE_ERROR_OBJECT;
    }

    le.update = option & 0xffff;
    return OLE_OK;
  },
  228: (ole, [object, commands]) => execute(ole, object, commands),
  201: () => OLE_ERROR_GENERIC,
  209: () => OLE_ERROR_GENERIC,
  223: () => OLE_ERROR_GENERIC,
  224: () => OLE_ERROR_GENERIC,
  229: () => OLE_ERROR_GENERIC,
  1000: (ole, [object, format]) => requestData(ole, object, format),
  1001: (ole, [object]) => leOf(ole, object)!.method,
  1002: (ole, [object]) => leOf(ole, object)!.error,
  1003: (ole, [object]) => (leOf(ole, object)!.busy ? OLE_BUSY : OLE_OK),
  1004: (ole, [object, palette]) => setColorScheme(ole, object, palette),
  1005: (ole, [object, verb, show, focus]) => activate(ole, object, verb, show, focus),
};

export { OLE_ERROR_MEMORY };
