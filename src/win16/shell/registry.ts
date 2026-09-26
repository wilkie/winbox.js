'use strict';

import { ansiUpperByte } from '../user/ansi.js';

/**
 * The registration database: `REG.DAT`, as `SHELL.DLL` keeps it.
 *
 * **Read out of `SHELL.DLL`** (seg2, and seg7 for the writer), and of the
 * installation's own `REG.DAT`, every byte of which decodes as below.
 *
 * The file is a header of 20h bytes -- `SHCC3.10`, 20h, the node table's
 * offset and count, the text area's offset and size, the number of hash
 * buckets and the head of the free list -- then a table of 8-byte entries
 * and a text area. One index names three kinds of entry:
 *
 * * **Entry 0** is the root. **Entries 1 to the bucket count** are hash
 *   buckets, each the head of a circular chain of texts.
 * * **A key**: next sibling, first child, its name's text and its value's.
 * * **A text**: next in its bucket's chain, how many use it, its length, and
 *   where it is in the text area, just past a word that names the entry back.
 *   Names and values share texts: `txtfile` is `.txt`'s value, `.ini`'s, and
 *   a key's name.
 *
 * `HKEY_CLASSES_ROOT` is not the root but its child `.classes`. A key made is
 * put first among its parent's children, so they come newest first. A name
 * matches whatever case it was first stored in; a value matches exactly.
 *
 * Loaded when the first key is opened; written back, if anything changed,
 * when the last is closed. Every call opens and closes for itself, so a change
 * made with no key open reaches the disk at once.
 *
 * Not followed: `[embedding]` in `WIN.INI`, which SHELL copies in on the first
 * open and out on each write (seg2 `1730`, `18b4`); the order the text area is
 * compacted in, which is the entries' order here; the temporary file SHELL
 * writes and renames into place, where this writes `REG.DAT` directly; and
 * the discarding and re-reading of the database under memory pressure.
 */

export const ERROR_SUCCESS = 0;
export const ERROR_BADDB = 1;
export const ERROR_BADKEY = 2;
export const ERROR_CANTOPEN = 3;
export const ERROR_CANTREAD = 4;
export const ERROR_CANTWRITE = 5;
export const ERROR_OUTOFMEMORY = 6;
export const ERROR_INVALID_PARAMETER = 7;

export const HKEY_CLASSES_ROOT = 1;

const MAGIC = 'SHCC3.10';
const EMPTY_BUCKETS = 37;

type Entry = [number, number, number, number];

export class RegistryDatabase {
  entries: Entry[] = [];
  buckets = EMPTY_BUCKETS;
  freeHead = 0;
  texts = new Map<number, string>();
  dirty = false;

  /** An empty database: the root and its buckets, each chain empty (resource 100). */
  static empty() {
    const db = new RegistryDatabase();

    db.entries = [[0, 0, 0, 0]];

    for (let bucket = 1; bucket <= EMPTY_BUCKETS; bucket++) {
      db.entries.push([bucket, 0, 0, 0]);
    }

    return db;
  }

  /** Reads a file, or answers the error SHELL gives for one it will not take. */
  static parse(bytes: Uint8Array): RegistryDatabase | number {
    if (bytes.length < 0x20) {
      return ERROR_CANTREAD;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = Array.from(bytes.subarray(0, 8), (b) => String.fromCharCode(b)).join('');

    if (magic !== MAGIC || view.getUint32(8, true) !== 0x20) {
      return ERROR_BADDB;
    }

    const nodeOffset = view.getUint32(12, true);
    const count = view.getUint32(16, true);
    const textOffset = view.getUint32(20, true);
    const textSize = view.getUint32(24, true);
    const db = new RegistryDatabase();

    db.buckets = view.getUint16(28, true);
    db.freeHead = view.getUint16(30, true);

    if (count >= 0x1fff || count <= db.buckets || nodeOffset + count * 8 > bytes.length) {
      return ERROR_BADDB;
    }

    for (let index = 0; index < count; index++) {
      const at = nodeOffset + index * 8;

      db.entries.push([
        view.getUint16(at, true),
        view.getUint16(at + 2, true),
        view.getUint16(at + 4, true),
        view.getUint16(at + 6, true),
      ]);
    }

    /* The texts are what the bucket chains hold. */
    for (let bucket = 1; bucket <= db.buckets; bucket++) {
      for (let id = db.entries[bucket][0]; id > db.buckets; id = db.entries[id]?.[0] ?? 0) {
        const [, , length, offset] = db.entries[id];

        if (offset + length > textSize || textOffset + offset + length > bytes.length) {
          return ERROR_BADDB;
        }

        let text = '';

        for (let i = 0; i < length; i++) {
          text += String.fromCharCode(bytes[textOffset + offset + i]);
        }

        db.texts.set(id, text);
      }
    }

    return db;
  }

  /** The file as SHELL writes it: the table at 20h, the texts packed after it. */
  serialize(): Uint8Array {
    const count = this.entries.length;
    const textOffset = 0x20 + count * 8;
    const pieces: number[] = [];
    const offsets = new Map<number, number>();

    for (const [id, text] of [...this.texts].sort((a, b) => a[0] - b[0])) {
      pieces.push((id * 2 + 1) & 0xff, ((id * 2 + 1) >> 8) & 0xff);
      offsets.set(id, pieces.length);

      for (const c of text) {
        pieces.push(c.charCodeAt(0) & 0xff);
      }
    }

    const bytes = new Uint8Array(textOffset + pieces.length);
    const view = new DataView(bytes.buffer);

    for (let i = 0; i < MAGIC.length; i++) {
      bytes[i] = MAGIC.charCodeAt(i);
    }

    view.setUint32(8, 0x20, true);
    view.setUint32(12, 0x20, true);
    view.setUint32(16, count, true);
    view.setUint32(20, textOffset, true);
    view.setUint32(24, pieces.length, true);
    view.setUint16(28, this.buckets, true);
    view.setUint16(30, this.freeHead, true);

    this.entries.forEach((entry, index) => {
      const at = 0x20 + index * 8;
      const out = this.texts.has(index)
        ? [entry[0], entry[1], this.texts.get(index)!.length, offsets.get(index)!]
        : entry;

      out.forEach((word, k) => view.setUint16(at + k * 2, word & 0xffff, true));
    });

    bytes.set(pieces, textOffset);

    return bytes;
  }

  textOf(id: number) {
    return id ? (this.texts.get(id) ?? null) : null;
  }

  /** A text's bucket (seg2 `063e`): its first 39 characters upper-cased, summed as signed bytes. */
  bucketOf(text: string) {
    let sum = 0;

    for (const c of text.slice(0, 39)) {
      const upper = ansiUpperByte(c.charCodeAt(0) & 0xff);

      sum += upper > 0x7f ? upper - 0x100 : upper;
    }

    return ((sum & 0xffff) % this.buckets) + 1;
  }

  /** An entry off the free list, or a new one, the table grown by 16 when it is empty. */
  #allocate() {
    if (!this.freeHead) {
      const first = this.entries.length;

      for (let i = 0; i < 16; i++) {
        this.entries.push([i < 15 ? first + i + 1 : 0, 0, 0, 0]);
      }

      this.freeHead = first;
    }

    const id = this.freeHead;

    this.freeHead = this.entries[id][0];
    this.entries[id] = [0, 0, 0, 0];

    return id;
  }

  #free(id: number) {
    this.entries[id] = [this.freeHead, 0, 0, 0];
    this.freeHead = id;
  }

  /** A text to use, shared if there is one -- by case for a name, exactly for a value. */
  useText(text: string, anyCase: boolean) {
    const bucket = this.bucketOf(text);

    for (let id = this.entries[bucket][0]; id > this.buckets; id = this.entries[id][0]) {
      const have = this.texts.get(id)!;

      if (have.length === text.length && (anyCase ? have.toUpperCase() === text.toUpperCase() : have === text)) {
        this.entries[id][1]++;
        return id;
      }
    }

    const id = this.#allocate();

    this.entries[id] = [this.entries[bucket][0], 1, text.length, 0];
    this.entries[bucket][0] = id;
    this.texts.set(id, text);

    return id;
  }

  /** A text no longer used by one more thing: gone, out of its chain, at nought. */
  releaseText(id: number) {
    if (!id || !this.texts.has(id)) {
      return;
    }

    if (--this.entries[id][1] > 0) {
      return;
    }

    const bucket = this.bucketOf(this.texts.get(id)!);
    let at = bucket;

    while (this.entries[at][0] !== id) {
      at = this.entries[at][0];
    }

    this.entries[at][0] = this.entries[id][0];
    this.texts.delete(id);
    this.#free(id);
  }

  childNamed(parent: number, name: string) {
    for (let child = this.entries[parent][1]; child; child = this.entries[child][0]) {
      if ((this.textOf(this.entries[child][2]) ?? '').toUpperCase() === name.toUpperCase()) {
        return child;
      }
    }

    return 0;
  }

  /** A child made first among its parent's (seg2 `08f4`). */
  makeChild(parent: number, name: string) {
    const id = this.#allocate();

    this.entries[id] = [this.entries[parent][1], 0, this.useText(name, true), 0];
    this.entries[parent][1] = id;
    this.dirty = true;

    return id;
  }

  /** A key and everything under it, gone. */
  removeTree(id: number) {
    for (let child = this.entries[id][1]; child; ) {
      const next = this.entries[child][0];

      this.removeTree(child);
      child = next;
    }

    this.releaseText(this.entries[id][2]);
    this.releaseText(this.entries[id][3]);
    this.#free(id);
  }
}
