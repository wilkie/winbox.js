'use strict';

import { OLE_ERROR_STREAM, OLE_OK, Ole, SCRATCH, plus } from './core.js';

/**
 * A program's `OLESTREAM`: its table's `Get` and `Put`, called far with the
 * stream, a far pointer and a count, each answering the bytes it moved
 * (ole.h). What `OLECLI` reads and writes is a field at a time
 * (**recorded** by `olestat`, each `Put`'s count). As
 * `crates/winbox-win16/src/olecli/streams.rs`.
 */

/** `Put`: `count` bytes from a far pointer; whether all went. */
export async function put(ole: Ole, stream: number, from: number, count: number): Promise<boolean> {
  const table = ole.r32(stream);
  const answer = await ole.callFar(ole.r32(plus(table, 4)), [stream, from, count]);

  return answer === count >>> 0;
}

/** `Get`: `count` bytes to a far pointer; whether all came. */
export async function get(ole: Ole, stream: number, to: number, count: number): Promise<boolean> {
  const table = ole.r32(stream);
  const answer = await ole.callFar(ole.r32(table), [stream, to, count]);

  return answer === count >>> 0;
}

/** A doubleword written, from `OLECLI`'s scratch. */
export async function putLong(ole: Ole, stream: number, value: number) {
  const at = ole.near(SCRATCH);

  ole.w32(at, value >>> 0);
  return put(ole, stream, at, 4);
}

/** Bytes written, from `OLECLI`'s scratch. */
export async function putBytes(ole: Ole, stream: number, bytes: number[]) {
  const at = ole.near(SCRATCH);

  ole.write(at, bytes);
  return put(ole, stream, at, bytes.length);
}

/** A doubleword read; null where the stream gave fewer than four bytes. */
export async function getLong(ole: Ole, stream: number): Promise<number | null> {
  const at = ole.near(SCRATCH);

  return (await get(ole, stream, at, 4)) ? ole.r32(at) : null;
}

/** Bytes read into `OLECLI`'s scratch; null where fewer came. */
export async function getBytes(ole: Ole, stream: number, count: number): Promise<number[] | null> {
  const at = ole.near(SCRATCH);

  return (await get(ole, stream, at, count)) ? ole.read(at, count) : null;
}

/** A length and a string with its nought, as a stream holds a class's name. */
export async function putName(ole: Ole, stream: number, name: number[]) {
  return (
    (await putLong(ole, stream, name.length + 1)) && (await putBytes(ole, stream, [...name, 0]))
  );
}

export { OLE_ERROR_STREAM, OLE_OK };
