'use strict';

/**
 * The resources of an NE executable -- a program, a library or a driver -- as
 * its resource table lists them: each one's type, its id or name, and its bytes.
 * See `kb/formats/ne.md`.
 */
export interface Resource {
  type: number;

  /** A numeric id, the top bit already cleared, or `null` for a named one. */
  id: number | null;
  name: string | null;
  data: Uint8Array;
}

export const RT_BITMAP = 2;

export function resourcesOf(bytes: Uint8Array): Resource[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = view.getUint32(0x3c, true);

  if (view.getUint16(header, true) !== 0x454e) {
    throw new Error('not an NE executable');
  }

  const table = header + view.getUint16(header + 0x24, true);
  const shift = view.getUint16(table, true);
  const resources: Resource[] = [];
  let at = table + 2;

  const nameAt = (offset: number) => {
    const length = bytes[table + offset];
    return Array.from(bytes.subarray(table + offset + 1, table + offset + 1 + length), (byte) =>
      String.fromCharCode(byte)
    ).join('');
  };

  for (;;) {
    const type = view.getUint16(at, true);

    if (!type) {
      break;
    }

    const count = view.getUint16(at + 2, true);
    at += 8;

    for (let index = 0; index < count; index++) {
      const offset = view.getUint16(at, true) << shift;
      const length = view.getUint16(at + 2, true) << shift;
      const id = view.getUint16(at + 6, true);

      resources.push({
        type: type & 0x8000 ? type & 0x7fff : -1,
        id: id & 0x8000 ? id & 0x7fff : null,
        name: id & 0x8000 ? null : nameAt(id),
        data: bytes.subarray(offset, offset + length),
      });

      at += 12;
    }
  }

  return resources;
}
