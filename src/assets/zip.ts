/**
 * Writes a zip archive of stored entries -- no compression -- as the asset
 * bundle is kept: `src/zip.ts`'s `readZip` reads it back, and an archive
 * of stored entries is the same bytes every time it is made from the same
 * files, which is what lets two builds be compared.
 *
 * Each entry: a local header, the name and the data; then the central
 * directory, an entry for each, and the end record. No extra fields, no
 * comments, names in ASCII.
 */

export interface StoredEntry {
  path: string;
  data: Uint8Array;
  /** The DOS time and date words. */
  time: number;
  date: number;
}

const TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

/** The CRC-32 zip keeps of each entry's data. */
export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function writeStoredZip(entries: StoredEntry[]): Uint8Array {
  const names = entries.map((entry) => Uint8Array.from(entry.path, (c) => c.charCodeAt(0) & 0xff));
  const crcs = entries.map((entry) => crc32(entry.data));
  const localSize = entries.reduce(
    (sum, entry, i) => sum + 30 + names[i].length + entry.data.length,
    0
  );
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;

  if (entries.length > 0xffff || out.length > 0xffffffff) {
    throw new Error('too many files for a zip archive without zip64');
  }

  entries.forEach((entry, i) => {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 10, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, entry.time, true);
    view.setUint16(at + 12, entry.date, true);
    view.setUint32(at + 14, crcs[i], true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, names[i].length, true);
    view.setUint16(at + 28, 0, true);
    out.set(names[i], at + 30);
    out.set(entry.data, at + 30 + names[i].length);
    at += 30 + names[i].length + entry.data.length;
  });

  const central = at;

  entries.forEach((entry, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 10, true);
    view.setUint16(at + 6, 10, true);
    view.setUint16(at + 8, 0, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, crcs[i], true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, names[i].length, true);
    view.setUint32(at + 42, offsets[i], true);
    out.set(names[i], at + 46);
    at += 46 + names[i].length;
  });

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - central, true);
  view.setUint32(at + 16, central, true);

  return out;
}
