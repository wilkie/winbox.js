'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DATA,
  DATA_SIZE,
  TERM_DIALOG,
  XPARAMS_SELECTOR_AT,
  buildData,
} from '../../src/win16/ddeml/resources.js';

/**
 * DDEML's data and its dialog are laid out from named constants
 * (`src/win16/ddeml/resources.ts`), none of Windows' bytes in the source. Where the
 * oracle installation has `DDEML.DLL`, they are compared with the file's data
 * segment (seg3) and its `TERMDIALOG` resource; with no file, skipped. As
 * `crates/winbox-win16/src/ddeml/resources.rs`'s tests.
 */

const FILE = join(
  __dirname,
  '..',
  '..',
  'oracle',
  'build',
  'drive-c',
  'WINDOWS',
  'SYSTEM',
  'DDEML.DLL'
);

/** A segment's bytes in a 16 bit `NE` file: its sector, shifted by the alignment, and its length. */
function segment(bytes: Buffer, number: number): Buffer {
  const header = bytes.readUInt16LE(0x3c);
  const shift = bytes.readUInt16LE(header + 0x32);
  const table = header + bytes.readUInt16LE(header + 0x22);
  const entry = table + (number - 1) * 8;
  const sector = bytes.readUInt16LE(entry);
  const length = bytes.readUInt16LE(entry + 2);

  return bytes.subarray(sector << shift, (sector << shift) + length);
}

describe('DDEML data layout', () => {
  it('is the size of the data segment, with the segment relocation left to the loader', () => {
    expect(DATA.length).toBe(DATA_SIZE);
    expect(DATA[XPARAMS_SELECTOR_AT]).toBe(0xff);
    expect(DATA[XPARAMS_SELECTOR_AT + 1]).toBe(0xff);
    expect(Buffer.from(buildData()).equals(Buffer.from(DATA))).toBe(true);
  });

  (existsSync(FILE) ? it : it.skip)("is DDEML.DLL's data segment (seg3)", () => {
    const bytes = readFileSync(FILE);
    const seg3 = segment(bytes, 3);

    expect(seg3.length).toBe(DATA_SIZE);
    expect(Buffer.from(DATA).equals(seg3)).toBe(true);
  });

  (existsSync(FILE) ? it : it.skip)("is in DDEML.DLL's resource TERMDIALOG", () => {
    const bytes = readFileSync(FILE);

    expect(bytes.indexOf(Buffer.from(TERM_DIALOG))).toBeGreaterThan(0);
  });
});
