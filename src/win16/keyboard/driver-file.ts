'use strict';

/**
 * Segments of the keyboard driver on the disk, `KEYBOARD.DRV`, for the
 * tables its calls read: each as the file holds it, before the driver has run.
 */

/**
 * Reads segments of the driver by their numbers, counted from 1. `null` when
 * the driver is not there or is not a file this can read.
 */
export async function driverSegments(
  system: any,
  numbers: number[]
): Promise<Map<number, Uint8Array> | null> {
  const files = system.dos?.files;
  const handle = files ? await files.open('C:\\WINDOWS\\SYSTEM\\KEYBOARD.DRV') : null;
  const file = handle ? files.resolve(handle) : null;

  if (!file) {
    return null;
  }

  const read = async (offset: number, length: number) =>
    new Uint8Array(await file.read(offset, length));

  try {
    const mz = new DataView((await read(0, 0x40)).buffer);
    const ne = mz.getUint32(0x3c, true);
    const header = new DataView((await read(ne, 0x40)).buffer);
    const table = ne + header.getUint16(0x22, true);
    const shift = header.getUint16(0x32, true);
    const segments = new Map<number, Uint8Array>();

    for (const number of numbers) {
      const entry = new DataView((await read(table + (number - 1) * 8, 8)).buffer);
      const base = entry.getUint16(0, true) << shift;
      const length = entry.getUint16(2, true) || 0x10000;

      segments.set(number, await read(base, length));
    }

    return segments;
  } catch {
    return null;
  } finally {
    files.close(handle);
  }
}
