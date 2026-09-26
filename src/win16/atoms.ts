'use strict';

import { copyText } from './user/control-classes.js';

/**
 * Atoms: strings kept in a table and named by a number, so that two programs
 * -- or two parts of one -- can pass the number and mean the string. USER
 * keeps one table for the whole system, the global atoms; KERNEL keeps one in
 * any data segment that asks, the local atoms. Both are the same code.
 *
 * **Read out of `KRNL386.EXE`** (seg1 `4944`, `4a80`, `4ab9`), and
 * **recorded** by the `atoms` probe:
 *
 * * **Integer atoms**: a pointer with nought for its segment names the atom
 *   its offset is, and a string `#` followed by digits the one its decimal
 *   value is, wrapping at 16 bits -- 1 to BFFFh, and anything else fails. A
 *   `#` followed by anything but digits is an ordinary string.
 * * **Strings** are 1 to 255 characters, compared without regard to case --
 *   `a` to `z`, and E0h to FEh but F7h, are their capitals -- and kept as
 *   first added. Adding one again counts it, and each delete counts it down,
 *   answering nought; at nought it is gone.
 * * **A string atom** is C000h or more. Its number is where its entry lies in
 *   the table's heap, a quarter of the offset; here they are counted up from
 *   C000h across every table -- two heaps put two tables' entries apart -- and
 *   a number given back is used again in its table.
 * * **The name**: `GetAtomName` with no room answers nought and writes
 *   nothing; otherwise the buffer is emptied first, and as much of the string
 *   as fits copied, the answer its length. An integer atom's is `#` and its
 *   digits -- the lowest ones, if there is not room for all -- and the answer
 *   one more than the digits.
 * * Deleting an integer atom answers nought. Deleting a string atom that is
 *   not there answers something else nought: KERNEL does not check it, and
 *   answers what was left in AX. Here, the atom.
 *
 * USER's global table and the clipboard formats and window messages
 * registered by name are separate: `GlobalFindAtom` finds none of those.
 */

interface Entry {
  text: string;
  count: number;
}

export class AtomTable {
  #byKey = new Map<string, number>();
  #byAtom = new Map<number, Entry>();
  #free: number[] = [];
  #numbers: { next: number };

  /** `numbers` is shared by every table, so that no two tables' atoms are the same number. */
  constructor(numbers: { next: number }) {
    this.#numbers = numbers;
  }

  /** Finds (0) or adds (1) a string's atom (seg1 `4944`). */
  #lookup(system: any, lpsz: number, mode: 0 | 1): number {
    const far = lpsz >>> 0;

    if (!(far >>> 16)) {
      const value = far & 0xffff;

      return value && value < 0xc000 ? value : 0;
    }

    const text = stringFrom(system, far);

    if (text.startsWith('#') && /^#[0-9]*$/.test(text)) {
      let value = 0;

      for (const digit of text.slice(1)) {
        value = (value * 10 + digit.charCodeAt(0) - 0x30) & 0xffff;
      }

      return value && value < 0xc000 ? value : 0;
    }

    if (!text.length || text.length > 255) {
      return 0;
    }

    const key = upper(text);
    const atom = this.#byKey.get(key);

    if (mode === 0) {
      return atom ?? 0;
    }

    if (atom) {
      this.#byAtom.get(atom)!.count++;
      return atom;
    }

    const made = this.#free.shift() ?? this.#numbers.next++;

    if (made > 0xffff) {
      return 0;
    }

    this.#byKey.set(key, made);
    this.#byAtom.set(made, { text, count: 1 });

    return made;
  }

  add(system: any, lpsz: number) {
    return this.#lookup(system, lpsz, 1);
  }

  find(system: any, lpsz: number) {
    return this.#lookup(system, lpsz, 0);
  }

  /** Deletes an atom by number: nought, or the atom for one not there (seg1 `4a80`). */
  delete(atom: number) {
    atom &= 0xffff;

    if (atom < 0xc000) {
      return 0;
    }

    const entry = this.#byAtom.get(atom);

    if (!entry) {
      return atom;
    }

    if (--entry.count <= 0) {
      this.#byKey.delete(upper(entry.text));
      this.#byAtom.delete(atom);
      this.#free.push(atom);
      this.#free.sort((a, b) => a - b);
    }

    return 0;
  }

  /** An atom's string into a buffer; its length (seg1 `4ab9`). */
  name(system: any, atom: number, far: number, size: number) {
    size = (size << 16) >> 16;
    atom &= 0xffff;

    if (!far || size === 0) {
      return 0;
    }

    copyText(system, '', far, 1);

    if (atom >= 0xc000) {
      const entry = this.#byAtom.get(atom);

      return entry ? copyText(system, entry.text, far, size) : 0;
    }

    if (size < 2 || !atom) {
      return 0;
    }

    const digits = String(atom).slice(-(size - 2) || undefined);
    const shown = size - 2 === 0 ? '' : digits;

    copyText(system, `#${shown}`, far, shown.length + 2);

    return shown.length + 1;
  }
}

/** A string at a far pointer, read through its selector -- at most 256 characters, enough to tell one too long. */
function stringFrom(system: any, far: number) {
  const core = system.machine.cpu.core;
  const segment = far >>> 16;
  let out = '';

  for (let at = far & 0xffff; out.length < 256; at = (at + 1) & 0xffff) {
    const c = core.read8(segment, at);

    if (!c) {
      break;
    }

    out += String.fromCharCode(c);
  }

  return out;
}

/** A string's capitals, as KERNEL compares atoms (seg1 `83e9`). */
function upper(text: string) {
  let out = '';

  for (const c of text) {
    const code = c.charCodeAt(0);
    const capital =
      (code >= 0x61 && code <= 0x7a) || (code >= 0xe0 && code <= 0xfe && code !== 0xf7) ? code - 0x20 : code;

    out += String.fromCharCode(capital);
  }

  return out;
}

function numbersOf(system: any): { next: number } {
  system._atomNumbers ??= { next: 0xc000 };

  return system._atomNumbers;
}

/** USER's table, the global atoms. */
export function globalAtoms(system: any): AtomTable {
  system._globalAtoms ??= new AtomTable(numbersOf(system));

  return system._globalAtoms;
}

/** The local atoms of the data segment a program is running with. */
export function localAtoms(system: any): AtomTable {
  const ds = system.machine.cpu.core.ds & 0xffff;

  system._localAtoms ??= new Map<number, AtomTable>();

  if (!system._localAtoms.has(ds)) {
    system._localAtoms.set(ds, new AtomTable(numbersOf(system)));
  }

  return system._localAtoms.get(ds);
}

export function GlobalAddAtom(this: any, lpsz: number) {
  return globalAtoms(this).add(this, lpsz);
}

export function GlobalFindAtom(this: any, lpsz: number) {
  return globalAtoms(this).find(this, lpsz);
}

/** Answers nought, deleted or not: USER's own, recorded by `atoms`. */
export function GlobalDeleteAtom(this: any, atom: number) {
  globalAtoms(this).delete(atom);

  return 0;
}

export function GlobalGetAtomName(this: any, atom: number, far: number, size: number) {
  return globalAtoms(this).name(this, atom, far, size);
}

export function AddAtom(this: any, lpsz: number) {
  return localAtoms(this).add(this, lpsz);
}

export function FindAtom(this: any, lpsz: number) {
  return localAtoms(this).find(this, lpsz);
}

export function DeleteAtom(this: any, atom: number) {
  return localAtoms(this).delete(atom);
}

export function GetAtomName(this: any, atom: number, far: number, size: number) {
  return localAtoms(this).name(this, atom, far, size);
}

/** A string atom's entry in its table, as an offset: four times it (seg1 `4aa3`). */
export function GetAtomHandle(this: any, atom: number) {
  atom &= 0xffff;

  return atom >= 0xc000 ? (atom << 2) & 0xffff : 0;
}

/** Makes a data segment's table: nothing to do here beyond having one (seg3 `041a`). */
export function InitAtomTable(this: any, _size: number) {
  localAtoms(this);

  return 1;
}
