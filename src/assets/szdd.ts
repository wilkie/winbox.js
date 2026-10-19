/**
 * Expands a file compressed by Microsoft's `COMPRESS` -- the `.??_` files
 * of the Windows 3.1 setup disks -- as `LZEXPAND.DLL`'s `LZCopy` does,
 * without a machine: the same read-out as `src/win16/lzexpand/lz.ts`
 * (`kb/formats/szdd.md`).
 *
 * - The header (seg8 `00aa`): fourteen bytes; the signature `SZDD` 88h F0h
 *   27h 33h compared as a string (seg8 `01a2`), so a nought in it ends it
 *   there and the file is not COMPRESS's; the algorithm `A`, and no other
 *   (-8, `LZERROR_UNKNOWNALG`); the name's lost last character; the
 *   expanded length.
 * - The decoder (seg9 `0000`), begun at the 14th byte with the ring all
 *   spaces but its last 16 bytes, which `GMEM_ZEROINIT` left nought, and
 *   written from FF0h: a flag byte whose bits from the lowest say literal
 *   (1) or pair (0); a pair the ring's place, its low eight bits then its
 *   top four in the second byte's high nibble, and the length less three
 *   in its low nibble.
 * - `LZCopy` (seg7 `00f4`) decodes until more than the length less one
 *   bytes are made, checked between items, or the input ends; a pair or a
 *   flag byte cut off by the end is -3, `LZERROR_READ`; and so is a total
 *   that is not the header's length.
 */

const SIGNATURE = [0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33];
const RING = 4096;
const KEPT = 16;

export interface Expanded {
  data: Uint8Array;
  /** The last character of the file's name, which `COMPRESS` replaced with `_`; nought for none. */
  last: number;
}

/** Whether a file is `COMPRESS`'s: its signature, compared as `lstrcmp` compares it. */
export function isSzdd(file: Uint8Array) {
  if (file.length < 14) {
    return false;
  }

  for (let i = 0; i < SIGNATURE.length; i++) {
    if (file[i] !== SIGNATURE[i]) {
      return false;
    }
  }

  return true;
}

/**
 * A compressed file's data, as `LZCopy` makes it. Throws, naming the
 * error `LZCopy` would answer, where it would fail.
 */
export function expandSzdd(file: Uint8Array): Expanded {
  if (!isSzdd(file)) {
    throw new Error('not a COMPRESS file: its header is not signed SZDD');
  }

  if (file[8] !== 0x41) {
    throw new Error(`compressed with algorithm ${file[8]}, not A (LZERROR_UNKNOWNALG)`);
  }

  const size = (file[10] | (file[11] << 8) | (file[12] << 16) | (file[13] << 24)) >>> 0;
  const limit = size - 1;
  const ring = new Uint8Array(RING).fill(0x20, 0, RING - KEPT);
  let ringAt = RING - KEPT;
  let out = new Uint8Array(Math.max(size, 16) + 32);
  let total = 0;
  let at = 14;

  const emit = (byte: number) => {
    if (total === out.length) {
      const bigger = new Uint8Array(out.length * 2);

      bigger.set(out);
      out = bigger;
    }

    out[total++] = byte;
    ring[ringAt] = byte;
    ringAt = (ringAt + 1) & (RING - 1);
  };

  let flags = 0;

  while (at < file.length) {
    if (total > limit) {
      break;
    }

    flags >>>= 1;

    if (!(flags & 0x100)) {
      flags = 0xff00 | file[at++];

      if (at >= file.length) {
        throw new Error('the stream ends after a flag byte (LZERROR_READ)');
      }
    }

    if (flags & 1) {
      emit(file[at++]);
    } else {
      if (at + 1 >= file.length) {
        throw new Error('the stream ends inside a pair (LZERROR_READ)');
      }

      const low = file[at++];
      const high = file[at++];
      const place = ((high & 0xf0) << 4) | low;
      const count = (high & 0x0f) + 3;

      for (let i = 0; i < count; i++) {
        emit(ring[(place + i) & (RING - 1)]);
      }
    }
  }

  if (total !== size) {
    throw new Error(`expanded to ${total} bytes, where the header says ${size} (LZERROR_READ)`);
  }

  return { data: out.slice(0, total), last: file[9] };
}

/**
 * The name a compressed file expands to, as Setup names it: the `_` that
 * ends it given back the header's last character, upper case.
 */
export function expandedName(name: string, last: number) {
  const upper = name.toUpperCase();

  if (!upper.endsWith('_') || last === 0) {
    return upper;
  }

  return upper.slice(0, -1) + String.fromCharCode(last).toUpperCase();
}
