'use strict';

/**
 * Reads the files out of a zip archive: what a person drops on the demo page
 * to give it programs to run, or their own Windows installation.
 *
 * Only what archives of 1990s software use: entries stored or deflated, found
 * through the central directory. Deflate is the platform's own
 * `DecompressionStream`, which browsers and Node both provide, so nothing is
 * vendored. Zip64, encryption and the other compression methods are refused by
 * name rather than read wrongly.
 */

export interface ZipEntry {
  /** The path inside the archive, with `/` between its parts. */
  path: string;
  data: Uint8Array;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** Inflates raw deflate data with the platform's decompressor. */
async function inflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A name as the archive holds it: UTF-8 when the entry says so, and otherwise
 * the old DOS code page, read here byte for byte, which keeps plain ASCII
 * names -- nearly every name of the era -- exactly as they were.
 */
function nameOf(bytes: Uint8Array, utf8: boolean) {
  return utf8
    ? new TextDecoder().decode(bytes)
    : Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

/** Every file in the archive, directories left out. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /* The end record is the last thing in the file, followed only by a comment
   * of up to 65,535 bytes, so it is found by looking backwards. */
  let end = -1;

  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }

  if (end < 0) {
    throw new Error('not a zip archive: it has no end of central directory record');
  }

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  if (count === 0xffff || at === 0xffffffff) {
    throw new Error('this is a zip64 archive, which is not read here');
  }

  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== DIRECTORY_ENTRY) {
      throw new Error(`the central directory is damaged at entry ${index + 1}`);
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = nameOf(bytes.subarray(at + 46, at + 46 + nameLength), (flags & 0x0800) !== 0);

    at += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith('/')) {
      continue;
    }

    if (flags & 0x0001) {
      throw new Error(`${path} is encrypted, which is not read here`);
    }

    if (view.getUint32(local, true) !== LOCAL_HEADER) {
      throw new Error(`${path}: its local header is not where the directory says`);
    }

    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);

    let data: Uint8Array;

    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = await inflate(raw);
    } else {
      throw new Error(`${path} is compressed with method ${method}, which is not read here`);
    }

    if (data.length !== size) {
      throw new Error(`${path} came out ${data.length} bytes, where the archive says ${size}`);
    }

    entries.push({ path, data });
  }

  return entries;
}
