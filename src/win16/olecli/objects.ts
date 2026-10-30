'use strict';

import { W } from '../commdlg/api.js';
import { isDoc } from './docs.js';
import {
  DOC_FIRST,
  DOC_LAST,
  GMEM_MOVEABLE,
  GMEM_ZEROINIT,
  KINDS,
  type Kind,
  METHODS,
  type Method,
  MM_TEXT,
  OBJ_CLIENT,
  OBJ_DOC,
  OBJ_HANDLE,
  OBJ_MAPPING,
  OBJ_NAME,
  OBJ_NEXT,
  OBJ_PREVIOUS,
  OBJ_SIGNATURE,
  OBJ_SIGNATURE_LE,
  OBJ_TYPE,
  OBJ_UNKNOWN_FFFF,
  OBJ_VTBL,
  OLE_ERROR_MEMORY,
  OLE_ERROR_NAME,
  OLE_ERROR_OBJECT,
  OLE_ERROR_SIZE,
  OLE_OK,
  OT_STATIC,
  Ole,
  VTBL_AT,
  far,
  off,
  plus,
  sel,
  slot,
} from './core.js';

/**
 * What every object is, whatever its kind: its block, laid out as
 * `olemem` measured it, made and let go, put in its document's list, named,
 * and its methods found through its table. As
 * `crates/winbox-win16/src/olecli/objects.rs`.
 */

/** The far address of one of `OLECLI`'s exports, WinBox's stub, registered by `index.ts`. */
let addressOf: (system: any, ordinal: number) => number = () => 0;

export function registerAddress(address: (system: any, ordinal: number) => number) {
  addressOf = address;
}

export function exportAddress(ole: Ole, ordinal: number) {
  return addressOf(ole.system, ordinal);
}

/** A kind's method table, laid out in `OLECLI`'s data the first time one is wanted: each slot the far address of the export that is that method. */
export function vtblOf(ole: Ole, kind: Kind): number {
  const at = ole.near(VTBL_AT[kind]);

  if (!ole.r32(at)) {
    const table = KINDS[kind] as Record<string, number>;

    METHODS.forEach((method, index) => {
      ole.w32(plus(at, index * 4), exportAddress(ole, table[method]));
    });
  }

  return at;
}

/** Which of WinBox's kinds an object is, by its table; null for one not WinBox's. */
export function kindOf(ole: Ole, object: number): Kind | null {
  const table = ole.r32(plus(object, OBJ_VTBL));

  if (sel(table) !== ole.ds()) {
    return null;
  }

  for (const kind of Object.keys(VTBL_AT) as Kind[]) {
    if (VTBL_AT[kind] === off(table)) {
      return kind;
    }
  }

  return null;
}

/** Whether a pointer is an object's: its block can be read and has `LE` at its signature. */
export function isObject(ole: Ole, object: number): boolean {
  return (
    object !== 0 &&
    ole.readable(object, OBJ_SIGNATURE + 2) &&
    ole.r16(plus(object, OBJ_SIGNATURE)) === OBJ_SIGNATURE_LE
  );
}

/**
 * An object's block made: `size` bytes, its table, signature, handle,
 * client and document, its type static, its name added as an atom. Put
 * last in its document's list. Its far pointer, or nought.
 */
export async function newObject(
  ole: Ole,
  kind: Kind,
  size: number,
  client: number,
  doc: number,
  name: number
): Promise<number> {
  const handle = await ole.globalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size);

  if (!handle) {
    return 0;
  }

  const object = await ole.globalLock(handle);

  ole.w32(plus(object, OBJ_VTBL), vtblOf(ole, kind));
  ole.w16(plus(object, OBJ_SIGNATURE), OBJ_SIGNATURE_LE);
  ole.w16(plus(object, OBJ_HANDLE), handle);
  ole.w32(plus(object, OBJ_CLIENT), client);
  ole.w32(plus(object, OBJ_TYPE), OT_STATIC);
  ole.w16(plus(object, OBJ_MAPPING), MM_TEXT);
  ole.w16(plus(object, OBJ_UNKNOWN_FFFF), 0xffff);
  ole.w16(plus(object, OBJ_NAME), name ? await ole.addAtom(name) : 0);
  ole.w32(plus(object, OBJ_DOC), doc);
  link(ole, object, doc);
  return object;
}

/** An object put last in its document's list. */
function link(ole: Ole, object: number, doc: number) {
  /* A presentation an embedded or linked object holds is in no document. */
  if (!doc) {
    return;
  }

  const last = ole.r32(plus(doc, DOC_LAST));

  if (last) {
    ole.w32(plus(last, OBJ_NEXT), object);
    ole.w32(plus(object, OBJ_PREVIOUS), last);
  } else {
    ole.w32(plus(doc, DOC_FIRST), object);
  }

  ole.w32(plus(doc, DOC_LAST), object);
}

/** An object taken out of its document's list. */
function unlink(ole: Ole, object: number) {
  const doc = ole.r32(plus(object, OBJ_DOC));
  const previous = ole.r32(plus(object, OBJ_PREVIOUS));
  const next = ole.r32(plus(object, OBJ_NEXT));

  if (previous) {
    ole.w32(plus(previous, OBJ_NEXT), next);
  } else if (doc) {
    ole.w32(plus(doc, DOC_FIRST), next);
  }

  if (next) {
    ole.w32(plus(next, OBJ_PREVIOUS), previous);
  } else if (doc) {
    ole.w32(plus(doc, DOC_LAST), previous);
  }
}

/** An object's block let go: out of its document, its name's atom deleted, the block freed. */
export async function freeObject(ole: Ole, object: number) {
  const handle = ole.r16(plus(object, OBJ_HANDLE));

  unlink(ole, object);
  await ole.deleteAtom(ole.r16(plus(object, OBJ_NAME)));
  await ole.globalUnlock(handle);
  await ole.globalFree(handle);
}

/** What an argument that should be a document is: `OLE_ERROR_HANDLE` if it is not one. */
export function docError(ole: Ole, doc: number) {
  return isDoc(ole, doc) ? OLE_OK : 18;
}

/** Whether an object's name, given to a call that makes one, is wrong: empty, `OLE_ERROR_NAME`. */
export function nameError(ole: Ole, name: number) {
  if (!name || !ole.readable(name)) {
    return 16;
  }

  return ole.r8(name) === 0 ? OLE_ERROR_NAME : OLE_OK;
}

/** Whether an out pointer can be written. */
export function writable(ole: Ole, at: number, n = 4) {
  return at !== 0 && ole.readable(at, n);
}

// The methods every kind shares, the `OBJ` exports (910-913).

/**
 * `OBJQUERYNAME` (910): the name's atom read into the buffer, at most the
 * count given, and the count set to the name's length; a count of nought
 * `OLE_ERROR_SIZE` (**recorded** by `olestat`).
 */
export async function queryName(ole: Ole, object: number, buffer: number, count: number) {
  const size = ole.r16(count);

  if (!size) {
    return OLE_ERROR_SIZE;
  }

  ole.w16(count, await ole.atomName(ole.r16(plus(object, OBJ_NAME)), buffer, size));
  return OLE_OK;
}

/** `OBJRENAME` (911): an empty name `OLE_ERROR_NAME`; else the old name's atom deleted and the new one's added. */
export async function rename(ole: Ole, object: number, name: number) {
  if (!name || !ole.readable(name)) {
    return 16;
  }

  if (ole.r8(name) === 0) {
    return OLE_ERROR_NAME;
  }

  await ole.deleteAtom(ole.r16(plus(object, OBJ_NAME)));
  ole.w16(plus(object, OBJ_NAME), await ole.addAtom(name));
  return OLE_OK;
}

/** `OBJQUERYTYPE` (912): the type, `OT_STATIC` for the static kinds. */
export function queryType(ole: Ole, object: number, out: number) {
  ole.w32(out, ole.r32(plus(object, OBJ_TYPE)));
  return OLE_OK;
}

/** The method in an object's table, by its slot: its far address. */
export function methodAt(ole: Ole, object: number, method: Method): number {
  const table = ole.r32(plus(object, OBJ_VTBL));

  return ole.r32(plus(table, slot(method) * 4));
}

/**
 * An object's method called through its table, as each `Ole` function
 * calls it: WinBox's own answered here, by the export the address is;
 * another's called far with the arguments as given.
 */
export async function callMethod(
  ole: Ole,
  object: number,
  method: Method,
  args: [number, number][]
): Promise<number> {
  const address = methodAt(ole, object, method);
  const ordinal = ownOrdinal(ole, address);

  if (ordinal) {
    return methodHook(ole, ordinal, [object, ...args.map(([value]) => value)]);
  }

  return ole.callFarTyped(address, [[object, 7], ...args]);
}

/** The ordinal of one of `OLECLI`'s stubs at a far address; nought for another. */
function ownOrdinal(ole: Ole, address: number): number {
  const first = exportAddress(ole, 1);

  if (!first || sel(address) !== sel(first)) {
    return 0;
  }

  const step = off(exportAddress(ole, 2)) - off(first);

  return step ? (off(address) - off(first)) / step + 1 : 0;
}

/** WinBox's own methods by their ordinal, registered by `index.ts`. */
let methodHook: (ole: Ole, ordinal: number, args: number[]) => Promise<number> = async () => 0;

export function registerMethods(
  hook: (ole: Ole, ordinal: number, args: number[]) => Promise<number>
) {
  methodHook = hook;
}

/** A word argument's place, for `callMethod`'s typed arguments. */
export const WORD = 3;
export const DWORD_ARG = 7;

export { OLE_ERROR_MEMORY, OLE_ERROR_OBJECT, W, far };
