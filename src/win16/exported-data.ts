'use strict';

/**
 * An export that is data, not code: what a program finds at the address
 * `GetProcAddress` gives for it, or its import is bound to. Windows has
 * such entries where a module's table names a place in a segment that a
 * reader goes looking at rather than calls -- KERNEL's `THHOOK` in its data
 * (`KRNL386.EXE` seg4 `0218`), GDI's `FTrapping0` in its (`GDI.EXE` seg48
 * `02ef`), and each system module's `__GP`, a table in its code. Calling
 * one runs data, in Windows as in WinBox.
 *
 * Two kinds: bytes laid where the export's stub would be, in the module's
 * stubs' segment, as a table in code is (`stub`); or a place in the
 * module's own data segment (`offset`), the module's selector above it, with
 * `prepare` run as the address is first handed out, to lay out what is
 * there. As the Rust engine's `exported_data.rs`.
 */
export class ExportedData {
  constructor(
    readonly place: { stub: number[] } | { offset: number; prepare?: (system: any) => void }
  ) {}

  /** The bytes laid in the export's stub, if it is laid there. */
  get stubBytes(): number[] | null {
    return 'stub' in this.place ? this.place.stub : null;
  }

  /** Its offset in the module's data, if it is there. */
  get dataOffset(): number | null {
    return 'offset' in this.place ? this.place.offset : null;
  }
}

/**
 * The end of a `__GP` table: a selector of nought (`KRNL386.EXE` seg1
 * `4c72`-`4d36`, `HasGPHandler`'s walk). A table of four-word records --
 * a selector, the first and past-the-last offset of a range, the handler's
 * offset -- says where a module's own code takes a fault on a program's
 * pointer and how it goes on. WinBox's modules have no code of Windows' to
 * fault in: their tables hold the end alone, and `HasGPHandler` answers
 * nought for every address, as recorded by `kintrnl`.
 */
export const GP_TABLE_END = 0;

/** A module's `__GP`: an empty table, its end alone, in its stubs. */
export function emptyGpTable() {
  return new ExportedData({ stub: [GP_TABLE_END & 0xff, GP_TABLE_END >> 8] });
}
