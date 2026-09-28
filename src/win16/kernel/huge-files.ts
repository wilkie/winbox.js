'use strict';

import { File } from '../../file-system.js';
import { Kernel } from '../kernel.js';

/**
 * `_lread` and `_lwrite` for more than a segment: a count of up to 2 GB, and
 * a huge pointer, whose bytes run on through the selectors after its own,
 * eight apart (documented). A huge block's selectors reach memory one after
 * another here, so its bytes are where they are for a far pointer too. The
 * Caribbean installer of the corpus reads its whole archive this way.
 */
export async function _hread(this: any, hf: number, hpBuffer: number, cbBuffer: number) {
  const file = this.dos.files.resolve(hf);
  const count = cbBuffer >>> 0;

  if (!file || !(file instanceof File) || count > 0x7fffffff) {
    return Kernel.HFILE_ERROR;
  }

  const data = await file.read(file.position, count);

  file.position += data.byteLength;

  const address = this.machine.cpu.core.translateAddress(
    (hpBuffer >>> 16) & 0xffff,
    hpBuffer & 0xffff
  );

  this.machine.memory.write(address, new DataView(data));

  return data.byteLength;
}

export async function _hwrite(this: any, hf: number, hpBuffer: number, cbBuffer: number) {
  const file = this.dos.files.resolve(hf);
  const count = cbBuffer >>> 0;

  if (!file || !(file instanceof File) || count > 0x7fffffff) {
    return Kernel.HFILE_ERROR;
  }

  const address = this.machine.cpu.core.translateAddress(
    (hpBuffer >>> 16) & 0xffff,
    hpBuffer & 0xffff
  );
  const bytes = new Uint8Array(count);

  for (let index = 0; index < count; index++) {
    bytes[index] = this.machine.memory.read8(address + index);
  }

  const written = await file.write(file.position, bytes);

  file.position += written;

  return written;
}

/** Bytes copied from one huge pointer to another, overlapping or not (documented). */
export function hmemcpy(this: any, hpvDest: number, hpvSource: number, cbCopy: number) {
  const core = this.machine.cpu.core;
  const to = core.translateAddress((hpvDest >>> 16) & 0xffff, hpvDest & 0xffff);
  const from = core.translateAddress((hpvSource >>> 16) & 0xffff, hpvSource & 0xffff);
  const count = cbCopy >>> 0;
  const bytes = new Uint8Array(count);

  for (let index = 0; index < count; index++) {
    bytes[index] = this.machine.memory.read8(from + index);
  }

  for (let index = 0; index < count; index++) {
    this.machine.memory.write8(to + index, bytes[index]);
  }
}
