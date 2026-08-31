/**
 * Reading a sixteen bit `NE` executable well enough to disassemble one function.
 *
 * A linear sweep through a code segment does not survive contact with the data
 * a compiler leaves between functions: `ndisasm` resynchronises after it and
 * every address afterwards is a guess. Recursive descent does survive, because
 * it only ever decodes from a place something branches to.
 *
 * What it needs is somewhere to start. This takes those from the file itself --
 * the entry table, which lists every exported function as a segment and an
 * offset, and the relocation records, whose internal references are the targets
 * of every far call the linker had to fix up. Between them they name most of
 * the function entries in a segment without guessing at any.
 */

import { readFileSync } from 'node:fs';

/** The header, the segment table, and where each segment's bytes are. */
export function readNE(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = view.getUint16(0x3c, true);

  if (bytes.toString('latin1', at, at + 2) !== 'NE') {
    throw new Error(`${path} is not an NE image`);
  }

  const shift = view.getUint16(at + 0x32, true);
  const unit = 1 << shift;
  const count = view.getUint16(at + 0x1c, true);
  const table = at + view.getUint16(at + 0x22, true);

  const segments = [];

  for (let i = 0; i < count; i++) {
    const e = table + i * 8;
    const sector = view.getUint16(e, true);
    const length = view.getUint16(e + 2, true);
    const flags = view.getUint16(e + 4, true);

    segments.push({
      number: i + 1,
      at: sector * unit,
      length,
      flags,
      data: flags & 1 ? 'data' : 'code',
      relocated: Boolean(flags & 0x0100),
    });
  }

  return { bytes, view, header: at, segments };
}

/**
 * A segment's relocation records.
 *
 * They sit immediately after the segment's bytes: a count, then eight bytes
 * each. Only the internal references matter here, and of those only the ones
 * naming a fixed segment -- a movable one names an entry-table ordinal instead,
 * which is resolved separately.
 */
export function relocationsOf({ view }, segment) {
  if (!segment.relocated) {
    return [];
  }

  const at = segment.at + segment.length;
  const count = view.getUint16(at, true);
  const out = [];

  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 8;

    out.push({
      source: view.getUint8(e),
      flags: view.getUint8(e + 1),
      offset: view.getUint16(e + 2, true),
      segment: view.getUint8(e + 4),
      target: view.getUint16(e + 6, true),
    });
  }

  return out;
}

/** Every exported function, as a segment and an offset into it. */
export function entriesOf({ view, header }) {
  const at = header + view.getUint16(header + 0x04, true);
  const end = at + view.getUint16(header + 0x06, true);
  const out = [];

  let p = at;
  let ordinal = 1;

  while (p < end) {
    const count = view.getUint8(p);
    const kind = view.getUint8(p + 1);

    if (count === 0) {
      break;
    }

    p += 2;

    if (kind === 0) {
      // A gap in the numbering, taking up no space.
      ordinal += count;
      continue;
    }

    for (let i = 0; i < count; i++) {
      if (kind === 0xff) {
        // Movable: flags, an int 3Fh, then the segment and offset.
        out.push({ ordinal, segment: view.getUint8(p + 3), offset: view.getUint16(p + 4, true) });
        p += 6;
      } else {
        // Fixed, in the segment the bundle names.
        out.push({ ordinal, segment: kind, offset: view.getUint16(p + 1, true) });
        p += 3;
      }

      ordinal++;
    }
  }

  return out;
}
