/**
 * Reads the files off a FAT12 floppy image: the Windows 3.1 setup disks, so
 * that the asset bundle can be made from them in a browser, where there is
 * no `mtools`.
 *
 * Read-only, and only what a DOS-formatted floppy has: the BIOS parameter
 * block in the boot sector, the first copy of the file allocation table, a
 * fixed root directory and folders below it. Long names, deleted entries
 * and the volume label are passed over.
 *
 * The boot sector's parameter block:
 *
 *    11  bytes per sector
 *    13  sectors per cluster
 *    14  reserved sectors, the boot sector among them
 *    16  how many copies of the FAT
 *    17  entries in the root directory
 *    19  sectors on the volume
 *    22  sectors per FAT
 *
 * A directory entry is 32 bytes: the name (8) and extension (3), the
 * attributes (11), the time (22) and date (24) of the last write, the first
 * cluster (26) and the size (28). A name whose first byte is nought ends the
 * directory; E5h is a deleted entry.
 */

export interface Fat12File {
  /** The path, folders and name joined with `/`, as DOS lists it: upper case, 8.3. */
  path: string;
  data: Uint8Array;
  /** The DOS time and date words of the directory entry. */
  time: number;
  date: number;
  attributes: number;
}

const ATTRIBUTE_VOLUME = 0x08;
const ATTRIBUTE_DIRECTORY = 0x10;

/** Every file on the image, folders walked, in the order the directories hold them. */
export function readFat12(image: Uint8Array): Fat12File[] {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);

  if (image.length < 512 || view.getUint16(510, true) !== 0xaa55) {
    throw new Error('not a floppy image: its first sector is not a boot sector');
  }

  const sectorSize = view.getUint16(11, true);
  const perCluster = image[13];
  const reserved = view.getUint16(14, true);
  const fats = image[16];
  const rootEntries = view.getUint16(17, true);
  const sectors = view.getUint16(19, true);
  const fatSectors = view.getUint16(22, true);

  if (![512, 1024, 2048, 4096].includes(sectorSize) || perCluster === 0 || fats === 0) {
    throw new Error('not a floppy image: its parameter block is not a FAT one');
  }

  const fatStart = reserved * sectorSize;
  const rootStart = fatStart + fats * fatSectors * sectorSize;
  const rootSize = rootEntries * 32;
  const dataStart = rootStart + Math.ceil(rootSize / sectorSize) * sectorSize;
  const clusterSize = perCluster * sectorSize;
  const clusters = Math.floor((sectors * sectorSize - dataStart) / clusterSize) + 2;

  if (clusters > 4085) {
    throw new Error('not a FAT12 volume: it has more clusters than twelve bits number');
  }

  /** The next cluster of a chain: twelve bits, packed two to three bytes. */
  const nextOf = (cluster: number) => {
    const at = fatStart + Math.floor((cluster * 3) / 2);
    const pair = image[at] | (image[at + 1] << 8);

    return cluster & 1 ? pair >> 4 : pair & 0xfff;
  };

  /** A chain's bytes, cut to `size` where a size is given. */
  const chain = (first: number, size?: number) => {
    const parts: Uint8Array[] = [];
    let total = 0;
    let cluster = first;

    for (let steps = 0; cluster >= 2 && cluster < 0xff0; steps++) {
      if (cluster >= clusters || steps > clusters) {
        throw new Error(`a cluster chain runs off the volume at cluster ${cluster}`);
      }

      const at = dataStart + (cluster - 2) * clusterSize;

      parts.push(image.subarray(at, at + clusterSize));
      total += clusterSize;

      if (size !== undefined && total >= size) {
        break;
      }

      cluster = nextOf(cluster);
    }

    const out = new Uint8Array(size ?? total);
    let at = 0;

    for (const part of parts) {
      const taken = part.subarray(0, Math.min(part.length, out.length - at));

      out.set(taken, at);
      at += taken.length;
    }

    if (at < out.length) {
      throw new Error(`a file's chain is shorter than its size`);
    }

    return out;
  };

  const files: Fat12File[] = [];

  const walk = (directory: Uint8Array, prefix: string, depth: number) => {
    if (depth > 16) {
      throw new Error('folders nested too deep: the volume is damaged');
    }

    for (let at = 0; at + 32 <= directory.length; at += 32) {
      const first = directory[at];

      if (first === 0) {
        break;
      }

      const attributes = directory[at + 11];

      if (first === 0xe5 || attributes & ATTRIBUTE_VOLUME) {
        continue;
      }

      const text = (from: number, to: number) =>
        String.fromCharCode(...directory.subarray(at + from, at + to)).trimEnd();
      const base = (first === 0x05 ? String.fromCharCode(0xe5) : text(0, 1)) + text(1, 8);
      const extension = text(8, 11);
      const name = extension ? `${base}.${extension}` : base;
      const cluster = directory[at + 26] | (directory[at + 27] << 8);
      const size =
        (directory[at + 28] |
          (directory[at + 29] << 8) |
          (directory[at + 30] << 16) |
          (directory[at + 31] << 24)) >>>
        0;

      if (attributes & ATTRIBUTE_DIRECTORY) {
        if (name !== '.' && name !== '..') {
          walk(chain(cluster), `${prefix}${name}/`, depth + 1);
        }

        continue;
      }

      files.push({
        path: `${prefix}${name}`,
        data: size === 0 ? new Uint8Array(0) : chain(cluster, size),
        time: directory[at + 22] | (directory[at + 23] << 8),
        date: directory[at + 24] | (directory[at + 25] << 8),
        attributes,
      });
    }
  };

  walk(image.subarray(rootStart, rootStart + rootSize), '', 0);

  return files;
}
