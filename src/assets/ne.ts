/**
 * A Windows (NE) executable with its code and data taken out: every
 * segment's bytes in the file, and the relocation records that follow a
 * segment, made nought where they are. Everything else stays at its own
 * offset -- the DOS stub, the NE header, the segment, resource, name,
 * module and entry tables, and the resources' data -- so the file reads as
 * the whole one does for its resources: the same table, the same entries in
 * the same order, and the same bytes for each.
 *
 * That is what the asset bundle keeps of `USER.EXE`, `SHELL.DLL` and the
 * display drivers: WinBox reads their icons, cursors, bitmaps and `OEMBIN`
 * resources, and never runs them.
 *
 * The header (at the offset the DOS header's word at 3Ch gives):
 *
 *    1Ch  segments
 *    22h  the segment table's offset, from the header
 *    32h  the shift of the file's sector unit
 *
 * A segment table entry is eight bytes: the sector of its data (nought for
 * none), its length in the file (nought for 64K), its flags (100h: it has
 * relocations), and its size in memory. A segment's relocations follow its
 * data: a count word, then eight bytes each.
 */

const RELOCATIONS = 0x0100;

/** Where a file's segments are: each segment's data, and its relocations. */
export function segmentSpans(file: Uint8Array): { start: number; end: number }[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);

  if (file.length < 0x40 || file[0] !== 0x4d || file[1] !== 0x5a) {
    throw new Error('not an executable: no MZ header');
  }

  const header = view.getUint32(0x3c, true);

  if (header + 0x40 > file.length || file[header] !== 0x4e || file[header + 1] !== 0x45) {
    throw new Error('not a Windows executable: no NE header');
  }

  const count = view.getUint16(header + 0x1c, true);
  const table = header + view.getUint16(header + 0x22, true);
  const shift = view.getUint16(header + 0x32, true) || 9;
  const spans: { start: number; end: number }[] = [];

  for (let i = 0; i < count; i++) {
    const entry = table + i * 8;
    const sector = view.getUint16(entry, true);
    const length = view.getUint16(entry + 2, true) || 0x10000;
    const flags = view.getUint16(entry + 4, true);

    if (sector === 0) {
      continue;
    }

    const start = sector * 2 ** shift;
    let end = start + length;

    if (end > file.length) {
      throw new Error(`segment ${i + 1} runs past the file's end`);
    }

    if (flags & RELOCATIONS) {
      const records = view.getUint16(end, true);

      end += 2 + records * 8;

      if (end > file.length) {
        throw new Error(`segment ${i + 1}'s relocations run past the file's end`);
      }
    }

    spans.push({ start, end });
  }

  return spans;
}

/** A copy of the file, every segment's bytes and relocations nought. */
export function zeroSegments(file: Uint8Array) {
  const out = file.slice();

  for (const { start, end } of segmentSpans(file)) {
    out.fill(0, start, end);
  }

  return out;
}
