'use strict';

import {
  DOC_CLASS,
  DOC_FIRST,
  DOC_HANDLE,
  DOC_LAST,
  DOC_NAME,
  DOC_NEXT,
  DOC_PREVIOUS,
  DOC_SIGNATURE,
  DOC_SIZE,
  GMEM_DDESHARE,
  GMEM_MOVEABLE,
  GMEM_ZEROINIT,
  OBJ_NEXT,
  OLE_ERROR_ADDRESS,
  OLE_ERROR_HANDLE,
  OLE_ERROR_MEMORY,
  OLE_ERROR_NAME,
  OLE_ERROR_NOT_EMPTY,
  OLE_OK,
  Ole,
  plus,
} from './core.js';

/**
 * A client's documents: `OleRegisterClientDoc` and the calls on the handle
 * it gives (**recorded** by `olestat`, the block's words **measured** by
 * `olemem`). A document's handle is the far pointer to its block; the
 * blocks are kept in a list, each after the one registered before it. As
 * `crates/winbox-win16/src/olecli/docs.rs`.
 */

/** Whether a handle is a document's: its block can be read and starts `CD`. A string starting `CD` passes (`olestat`). */
export function isDoc(ole: Ole, doc: number): boolean {
  return doc !== 0 && ole.readable(doc, 2) && ole.r16(doc) === DOC_SIGNATURE;
}

/** Whether a string argument can be read, and is not empty. */
function named(ole: Ole, at: number): 'none' | 'empty' | 'named' {
  if (!at || !ole.readable(at)) {
    return 'none';
  }

  return ole.r8(at) === 0 ? 'empty' : 'named';
}

/**
 * `OleRegisterClientDoc(lpszClass, lpszDoc, reserved, lplhdoc)`: an empty
 * name `OLE_ERROR_NAME`, a NULL class, name or out pointer
 * `OLE_ERROR_ADDRESS`; else the document's name and class added as atoms,
 * its block allocated, and the block put last in the list. The same name
 * registered twice is two documents.
 */
export async function registerClientDoc(
  ole: Ole,
  klass: number,
  name: number,
  _reserved: number,
  out: number
) {
  const nameIs = named(ole, name);

  if (nameIs === 'empty') {
    return OLE_ERROR_NAME;
  }

  if (nameIs === 'none' || named(ole, klass) === 'none' || !out || !ole.readable(out, 4)) {
    return OLE_ERROR_ADDRESS;
  }

  const nameAtom = await ole.addAtom(name);
  const classAtom = await ole.addAtom(klass);
  const handle = await ole.globalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE, DOC_SIZE);

  if (!handle) {
    await ole.deleteAtom(nameAtom);
    await ole.deleteAtom(classAtom);
    return OLE_ERROR_MEMORY;
  }

  const doc = await ole.globalLock(handle);

  ole.w16(doc, DOC_SIGNATURE);
  ole.w16(plus(doc, DOC_CLASS), classAtom);
  ole.w16(plus(doc, DOC_NAME), nameAtom);
  ole.w16(plus(doc, DOC_HANDLE), handle);

  const state = ole.state();
  let last = state.firstDoc;

  if (!last) {
    state.firstDoc = doc;
  } else {
    while (ole.r32(plus(last, DOC_NEXT))) {
      last = ole.r32(plus(last, DOC_NEXT));
    }

    ole.w32(plus(last, DOC_NEXT), doc);
    ole.w32(plus(doc, DOC_PREVIOUS), last);
  }

  ole.w32(out, doc);
  return OLE_OK;
}

/**
 * `OleRevokeClientDoc(lhdoc)`: a handle that is not a document's
 * `OLE_ERROR_HANDLE`; one with objects still in it `OLE_ERROR_NOT_EMPTY`;
 * else taken out of the list, its atoms deleted, its block freed.
 */
export async function revokeClientDoc(ole: Ole, doc: number) {
  if (!isDoc(ole, doc)) {
    return OLE_ERROR_HANDLE;
  }

  if (ole.r32(plus(doc, DOC_FIRST)) || ole.r32(plus(doc, DOC_LAST))) {
    return OLE_ERROR_NOT_EMPTY;
  }

  const state = ole.state();
  const previous = ole.r32(plus(doc, DOC_PREVIOUS));
  const next = ole.r32(plus(doc, DOC_NEXT));

  if (previous) {
    ole.w32(plus(previous, DOC_NEXT), next);
  } else if (state.firstDoc === doc) {
    state.firstDoc = next;
  }

  if (next) {
    ole.w32(plus(next, DOC_PREVIOUS), previous);
  }

  const handle = ole.r16(plus(doc, DOC_HANDLE));

  await ole.deleteAtom(ole.r16(plus(doc, DOC_NAME)));
  await ole.deleteAtom(ole.r16(plus(doc, DOC_CLASS)));
  await ole.globalUnlock(handle);
  await ole.globalFree(handle);
  return OLE_OK;
}

/**
 * `OleRenameClientDoc(lhdoc, lpszNewName)`: the new name added as an atom;
 * the same atom as before let go once more, else the old one deleted and
 * the new kept.
 */
export async function renameClientDoc(ole: Ole, doc: number, name: number) {
  if (!isDoc(ole, doc)) {
    return OLE_ERROR_HANDLE;
  }

  if (named(ole, name) === 'none') {
    return OLE_ERROR_ADDRESS;
  }

  const atom = await ole.addAtom(name);
  const old = ole.r16(plus(doc, DOC_NAME));

  if (atom === old) {
    await ole.deleteAtom(atom);
    return OLE_OK;
  }

  await ole.deleteAtom(old);
  ole.w16(plus(doc, DOC_NAME), atom);
  return OLE_OK;
}

/** `OleSavedClientDoc` and `OleRevertClientDoc`: a document's, nothing to tell a static object. */
export function savedClientDoc(ole: Ole, doc: number) {
  return isDoc(ole, doc) ? OLE_OK : OLE_ERROR_HANDLE;
}

/**
 * `OleEnumObjects(lhdoc, lplpobj)`: the object after the one given, the
 * first for NULL, NULL after the last; `OLE_OK` each time.
 */
export function enumObjects(ole: Ole, doc: number, out: number) {
  if (!isDoc(ole, doc)) {
    return OLE_ERROR_HANDLE;
  }

  if (!out || !ole.readable(out, 4)) {
    return OLE_ERROR_ADDRESS;
  }

  const current = ole.r32(out);

  ole.w32(out, current ? ole.r32(plus(current, OBJ_NEXT)) : ole.r32(plus(doc, DOC_FIRST)));
  return OLE_OK;
}
