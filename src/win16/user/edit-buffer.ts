'use strict';

import { segmentSelector } from '../selectors.js';

/**
 * An edit control's memory in the program's own local heap.
 *
 * **Read out of `USER.EXE`**: the edit control runs with DS set to the
 * instance handle it was made with, so what it allocates is in that
 * instance's local heap -- a program's, or a library's (seg1 `27a7`). At
 * `WM_NCCREATE` it takes its own data, 62h bytes (`LMEM_ZEROINIT`); a
 * multi-line one a table of widths, 200h bytes; and the text, a moveable
 * block of 20h noughts (seg27 `0056`, `0114`). A multi-line one's line starts
 * follow at `WM_CREATE`, four bytes (seg31 `010d`). All of it is freed at
 * `WM_NCDESTROY`, the text by whichever handle it has then (seg27 `01d6`).
 *
 * A multi-line control hands its text out with `EM_GETHANDLE`, null ended
 * (seg30 `247c`), and takes another with `EM_SETHANDLE`, whose text is read
 * to its null and whose block is sized to the text and 20h more; the old
 * block is not freed (seg32 `018f`). Notepad reads a file this way: it grows
 * the handle it was given, reads into it and gives it back.
 *
 * USER keeps the text in the block all the time, growing it by what is typed
 * and 20h, and shrinking it to the text and 10h when more than 20h is spare
 * (seg26 `05c4`, `0841`). Here a multi-line control's text is written to the
 * block whenever it changes and when it is handed out, the block grown then
 * to the text and 20h if it is too small. Not followed: the shrinking; a
 * single-line control's text, written only when it is handed out; the line
 * starts' block, which keeps its first size; and a dialog's edit control
 * without `DS_LOCALEDIT`, whose heap USER makes in a block of its own (seg24
 * `0337`), which keeps no block at all.
 */

const EDIT_DATA = 0x62;
const WIDTHS = 0x200;
const TEXT = 0x20;
const LINE_STARTS = 4;

export interface EditBuffer {
  selector: number;
  data: number;
  widths: number;
  text: number;
  lines: number;
}

/** The data segment an instance handle stands for: a program's or a library's. */
export function instanceSelector(system: any, hinst: number) {
  const owner = system.handles.resolve(hinst);
  const loader = owner?.loader;

  if (!loader?.ds) {
    return 0;
  }

  /* Through the loader's map, a program's as a library's: a second
   * program's segments are not at the descriptors its numbers name. */
  return segmentSelector(loader.translate(loader.ds) ?? loader.ds);
}

function heapOf(system: any, buffer: EditBuffer) {
  return system.allocator.heapOf(buffer.selector >> 3);
}

/** Takes an edit control's memory in its instance's heap, where it has one. */
export function createEditBuffer(system: any, control: any, hinst: number, multiline: boolean) {
  const selector = instanceSelector(system, hinst);
  const heap = selector ? system.allocator.heapOf(selector >> 3) : null;

  if (!heap) {
    return;
  }

  const buffer: EditBuffer = {
    selector,
    data: heap.allocate(EDIT_DATA, { zeroInit: true }) ?? 0,
    widths: multiline ? (heap.allocate(WIDTHS, { movable: true, zeroInit: true }) ?? 0) : 0,
    text: heap.allocate(TEXT, { movable: true, zeroInit: true }) ?? 0,
    lines: multiline ? (heap.allocate(LINE_STARTS, { zeroInit: true }) ?? 0) : 0,
  };

  control.buffer = buffer;
}

/** Frees an edit control's memory. */
export function freeEditBuffer(system: any, control: any) {
  const buffer: EditBuffer | undefined = control.buffer;

  if (!buffer) {
    return;
  }

  const heap = heapOf(system, buffer);

  for (const block of [buffer.text, buffer.lines, buffer.widths, buffer.data]) {
    if (block && heap?.sizeOf(block)) {
      heap.free(block);
    }
  }

  control.buffer = undefined;
}

/** `EM_GETHANDLE`: the text written to its block and ended with a nought. */
export function textHandle(system: any, control: any) {
  const buffer: EditBuffer | undefined = control.buffer;
  const heap = buffer ? heapOf(system, buffer) : null;

  if (!buffer || !heap || !buffer.text) {
    return 0;
  }

  const text: string = control.text ?? '';

  if (heap.sizeOf(buffer.text) <= text.length) {
    heap.reallocate(buffer.text, text.length + TEXT, true);
  }

  const core = system.machine.cpu.core;
  const at = heap.resolve(buffer.text);

  for (let i = 0; i < text.length; i++) {
    core.write8(buffer.selector, (at + i) & 0xffff, text.charCodeAt(i) & 0xff);
  }

  core.write8(buffer.selector, (at + text.length) & 0xffff, 0);

  return buffer.text;
}

/**
 * The text written to its block, as `textHandle` writes it, and where the
 * block is: the far pointer USER passes a word-break procedure, the block
 * locked in its heap (seg26 `0370`). Nought where the control keeps none.
 */
export function textPointer(system: any, control: any) {
  const handle = textHandle(system, control);
  const buffer: EditBuffer | undefined = control.buffer;
  const heap = buffer ? heapOf(system, buffer) : null;

  if (!handle || !buffer || !heap) {
    return 0;
  }

  return ((buffer.selector << 16) | (heap.resolve(handle) & 0xffff)) >>> 0;
}

/**
 * `EM_SETHANDLE`: the block taken as the text, read to its nought, and sized
 * to it and 20h more. Answers the text.
 */
export function adoptHandle(system: any, control: any, handle: number) {
  const buffer: EditBuffer | undefined = control.buffer;
  const heap = buffer ? heapOf(system, buffer) : null;

  if (!buffer || !heap) {
    return null;
  }

  buffer.text = handle;

  const size = heap.sizeOf(handle);
  const core = system.machine.cpu.core;
  const at = heap.resolve(handle);
  let text = '';

  for (let i = 0; i < size; i++) {
    const byte = core.read8(buffer.selector, (at + i) & 0xffff);

    if (!byte) {
      break;
    }

    text += String.fromCharCode(byte);
  }

  heap.reallocate(handle, text.length + TEXT, false);

  return text;
}
