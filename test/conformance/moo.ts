/**
 * A reader for MOO, the chunked binary format the SingleStepTests suites are
 * published in: https://github.com/dbalsom/moo, `doc/moo_format_v1.md`.
 *
 * Only what the oracle uses is read -- each test's name, bytes, initial and
 * final registers and RAM, the masks for what the part leaves undefined, and
 * its hash -- and every other chunk is skipped by its length, as the format
 * asks of a reader.
 */

import { gunzipSync } from 'node:zlib';

/** The 32-bit register file's order in `RG32` and `RM32` chunks. */
const REGISTERS32 = [
  'cr0',
  'cr3',
  'eax',
  'ebx',
  'ecx',
  'edx',
  'esi',
  'edi',
  'ebp',
  'esp',
  'cs',
  'ds',
  'es',
  'fs',
  'gs',
  'ss',
  'eip',
  'eflags',
  'dr6',
  'dr7',
] as const;

export type Register32 = (typeof REGISTERS32)[number];

export interface MooState {
  regs: Partial<Record<Register32, number>>;
  /** Masks for what is undefined: compare only the bits a mask keeps. */
  masks: Partial<Record<Register32, number>>;
  ram: [number, number][];
}

export interface MooTest {
  index: number;
  name: string;
  bytes: number[];
  initial: MooState;
  final: MooState;
  hash: string;
}

export interface MooFile {
  cpu: string;
  /** Masks every test in the file shares. */
  masks: Partial<Record<Register32, number>>;
  tests: MooTest[];
}

/** Each chunk in a range: its type, and where its payload lies. */
function* chunks(view: DataView, start: number, end: number) {
  let at = start;

  while (at + 8 <= end) {
    const type = String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3)
    );
    const length = view.getUint32(at + 4, true);

    yield { type, start: at + 8, end: at + 8 + length };
    at += 8 + length;
  }
}

/** A masked register list: `RG32` or `RM32`. */
function registers(view: DataView, start: number) {
  const present = view.getUint32(start, true);
  const out: Partial<Record<Register32, number>> = {};
  let at = start + 4;

  REGISTERS32.forEach((name, bit) => {
    if (present & (1 << bit)) {
      out[name] = view.getUint32(at, true);
      at += 4;
    }
  });

  return out;
}

function state(view: DataView, start: number, end: number): MooState {
  const result: MooState = { regs: {}, masks: {}, ram: [] };

  for (const chunk of chunks(view, start, end)) {
    if (chunk.type === 'RG32') {
      result.regs = registers(view, chunk.start);
    } else if (chunk.type === 'RM32') {
      result.masks = registers(view, chunk.start);
    } else if (chunk.type === 'RAM ') {
      const count = view.getUint32(chunk.start, true);

      for (let entry = 0; entry < count; entry++) {
        const at = chunk.start + 4 + entry * 5;

        result.ram.push([view.getUint32(at, true), view.getUint8(at + 4)]);
      }
    }
  }

  return result;
}

/** A length-prefixed run of bytes, as `NAME` and `BYTS` hold. */
function prefixed(view: DataView, start: number) {
  const length = view.getUint32(start, true);

  return Array.from({ length }, (_, at) => view.getUint8(start + 4 + at));
}

/** Parses a MOO file, gzipped or not. */
export function parseMoo(data: Uint8Array): MooFile {
  const bytes = data[0] === 0x1f && data[1] === 0x8b ? new Uint8Array(gunzipSync(data)) : data;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const file: MooFile = { cpu: '', masks: {}, tests: [] };

  for (const chunk of chunks(view, 0, view.byteLength)) {
    if (chunk.type === 'MOO ') {
      file.cpu = String.fromCharCode(
        ...Array.from({ length: 4 }, (_, at) => view.getUint8(chunk.start + 8 + at))
      );
    } else if (chunk.type === 'RM32') {
      file.masks = registers(view, chunk.start);
    } else if (chunk.type === 'TEST') {
      const test: MooTest = {
        index: view.getUint32(chunk.start, true),
        name: '',
        bytes: [],
        initial: { regs: {}, masks: {}, ram: [] },
        final: { regs: {}, masks: {}, ram: [] },
        hash: '',
      };

      for (const part of chunks(view, chunk.start + 4, chunk.end)) {
        if (part.type === 'NAME') {
          test.name = String.fromCharCode(...prefixed(view, part.start));
        } else if (part.type === 'BYTS') {
          test.bytes = prefixed(view, part.start);
        } else if (part.type === 'INIT') {
          test.initial = state(view, part.start, part.end);
        } else if (part.type === 'FINA') {
          test.final = state(view, part.start, part.end);
        } else if (part.type === 'HASH') {
          test.hash = Array.from({ length: part.end - part.start }, (_, at) =>
            view
              .getUint8(part.start + at)
              .toString(16)
              .padStart(2, '0')
          ).join('');
        }
      }

      file.tests.push(test);
    }
  }

  return file;
}
