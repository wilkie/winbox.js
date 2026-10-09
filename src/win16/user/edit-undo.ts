'use strict';

import { type EditState } from './edit.js';

/**
 * What an edit control keeps to undo, for both kinds of control, read out of
 * `USER.EXE`'s shared edit code (segment 26) and **recorded** by `editundo`
 * in a single-line control, a multi-line one that scrolls down and one that
 * does not.
 *
 * The control keeps one record (seg26, the control's data from 3Ch):
 *
 * * what kind it is: nothing, an insertion (1), a deletion (2) or both (3);
 * * the text taken out, in a global block, where it was and how long;
 * * where the text put in starts and ends.
 *
 * The control's own insertion (seg26 `05c4`) and deletion (`0841`) keep it
 * as they change the text. Setting the text, `EM_REPLACESEL` and
 * `EM_EMPTYUNDOBUFFER` throw it away, and so does `EM_SETHANDLE`. Moving the
 * caret or the selection does not.
 *
 * Throwing it away (`059f`) clears its kind and frees the text taken out,
 * and leaves where that was: an undo afterwards of an insertion alone moves
 * a single-line control's caret back there (seg29 `0277`). **Recorded**:
 * "abcdef", a deletion at 1, the text set again and "XY" typed at its end,
 * then undone, leaves the caret at 1.
 */
export interface UndoRecord {
  /** 0 nothing, 1 an insertion, 2 a deletion, 3 both. */
  kind: number;
  /** The text taken out, or none. */
  deleted: string | null;
  ichDeleted: number;
  cchDeleted: number;
  insStart: number;
  insEnd: number;
}

export const UNDO_INSERT = 1;
export const UNDO_DELETE = 2;

/** The control's record: nothing to undo, made with its places at -1 (seg27 `01a3`). */
export function undoOf(edit: EditState): UndoRecord {
  edit.undo ??= { kind: 0, deleted: null, ichDeleted: -1, cchDeleted: 0, insStart: -1, insEnd: -1 };

  return edit.undo;
}

/** Thrown away (seg26 `059f`): the kind cleared and the text taken out let go, its place kept. */
export function emptyUndo(edit: EditState) {
  const undo = undoOf(edit);

  undo.kind = 0;
  undo.deleted = null;
}

/** Whether there is anything to undo (`EM_CANUNDO`, seg26 `0e85`). */
export function canUndo(edit: EditState) {
  return undoOf(edit).kind !== 0 ? 1 : 0;
}

/**
 * `count` characters put in at `caret` (seg26 `0794`-`0822`). With nothing
 * kept, it is an insertion. Straight after the last insertion it makes that
 * longer: a run typed is undone whole. Anywhere else it starts again,
 * keeping the text taken out only where it was taken from this very place,
 * as when typing over a selection: then it is both.
 */
export function noteInsert(edit: EditState, caret: number, count: number) {
  const undo = undoOf(edit);

  if (count <= 0) {
    return;
  }

  if (undo.kind === 0) {
    undo.kind = UNDO_INSERT;
    undo.insStart = caret;
    undo.insEnd = caret + count;
    return;
  }

  if (undo.kind & UNDO_INSERT && undo.insEnd === caret) {
    undo.insEnd += count;
    return;
  }

  if (!(undo.kind & UNDO_INSERT) && undo.kind !== UNDO_DELETE) {
    return;
  }

  if (undo.ichDeleted !== caret) {
    undo.deleted = null;
    undo.ichDeleted = -1;
    undo.kind &= ~UNDO_DELETE;
  }

  undo.insStart = caret;
  undo.insEnd = caret + count;
  undo.kind |= UNDO_INSERT;
}

/**
 * `start` to `end` of `text` taken out (seg26 `0861`-`09a3`). A deletion
 * alone kept grows by one that ends where it was taken, put before it --
 * backspaces in a run -- or that starts there, put after it -- Deletes.
 * Anything else, or anything kept with an insertion, is let go, and this
 * is kept on its own.
 */
export function noteDelete(edit: EditState, text: string, start: number, end: number) {
  const undo = undoOf(edit);
  const taken = text.slice(start, end);

  if (end <= start) {
    return;
  }

  if (undo.kind === UNDO_DELETE && undo.deleted !== null) {
    if (undo.ichDeleted === end) {
      undo.deleted = taken + undo.deleted;
      undo.ichDeleted = start;
      undo.cchDeleted += taken.length;
      return;
    }

    if (undo.ichDeleted === start) {
      undo.deleted += taken;
      undo.cchDeleted += taken.length;
      return;
    }
  }

  if (undo.kind !== 0) {
    undo.kind = 0;
    undo.insStart = undo.insEnd = -1;
    undo.deleted = null;
    undo.ichDeleted = -1;
    undo.cchDeleted = 0;
  }

  undo.kind = UNDO_DELETE;
  undo.ichDeleted = start;
  undo.cchDeleted = taken.length;
  undo.deleted = taken;
}

/**
 * Before a multi-line control that neither scrolls down nor has a scroll bar
 * down puts text in (seg30 `06d1`-`071d`): an insertion or a deletion kept
 * alone is let go and every place made nought, so it keeps only what this
 * puts in. Such a control undoes a character at a time, and typing over a
 * selection undoes only what was typed. **Recorded** by `editundo` in such a
 * control: "abc" typed, undone, leaves "ab".
 */
export function forgetBeforeInsert(edit: EditState) {
  const undo = undoOf(edit);

  if (undo.kind === UNDO_INSERT || undo.kind === UNDO_DELETE) {
    undo.kind = 0;
    undo.deleted = null;
    undo.ichDeleted = 0;
    undo.cchDeleted = 0;
    undo.insStart = 0;
    undo.insEnd = 0;
  }
}

/**
 * The record taken for an undo (seg29 `0201`, seg32 `0477`): what was taken
 * out and where, and whether there was any, cleared from the control's; and
 * whether what remains is an insertion alone, made nothing.
 */
export function takeUndo(edit: EditState) {
  const undo = undoOf(edit);
  const taken = {
    deleted: undo.deleted,
    hadDelete: (undo.kind & UNDO_DELETE) !== 0,
    ichDeleted: undo.ichDeleted,
    cchDeleted: undo.cchDeleted,
    inserted: false,
    insStart: undo.insStart,
    insEnd: undo.insEnd,
  };

  undo.deleted = null;
  undo.cchDeleted = 0;
  undo.ichDeleted = -1;
  undo.kind &= ~UNDO_DELETE;

  if (undo.kind === UNDO_INSERT) {
    undo.kind = 0;
    taken.inserted = true;
  }

  return taken;
}
