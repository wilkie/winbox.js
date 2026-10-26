'use strict';

/**
 * Reading and writing TOOLHELP's structures in a program's memory, and the
 * check every one of its calls makes of the structure it is handed: not
 * nought, and its `dwSize` exactly the structure's size, its high word
 * nought (`TOOLHELP.DLL` seg1 `0cb3`-`0cd0` for `TaskFirst`, and the same
 * in each).
 */
export class Far {
  readonly segment: number;
  readonly offset: number;

  constructor(
    readonly system: any,
    far: number
  ) {
    this.segment = (far >>> 16) & 0xffff;
    this.offset = far & 0xffff;
  }

  get core() {
    return this.system.machine.cpu.core;
  }

  at(delta: number) {
    return (this.offset + delta) & 0xffff;
  }

  read8(delta: number) {
    return this.core.read8(this.segment, this.at(delta)) & 0xff;
  }

  read16(delta: number) {
    return this.core.read16(this.segment, this.at(delta)) & 0xffff;
  }

  read32(delta: number) {
    return ((this.read16(delta + 2) << 16) | this.read16(delta)) >>> 0;
  }

  write8(delta: number, value: number) {
    this.core.write8(this.segment, this.at(delta), value & 0xff);
  }

  write16(delta: number, value: number) {
    this.core.write16(this.segment, this.at(delta), value & 0xffff);
  }

  write32(delta: number, value: number) {
    this.write16(delta, value);
    this.write16(delta + 2, value >>> 16);
  }

  /** A string of up to `length` bytes written, then a nought. */
  writeString(delta: number, text: string, length: number) {
    const bytes = Array.from(String(text).slice(0, length), (each) => each.charCodeAt(0) & 0xff);

    bytes.forEach((byte, index) => this.write8(delta + index, byte));
    this.write8(delta + bytes.length, 0);
  }
}

/** The structure handed in, where it is one of `size` bytes as its `dwSize` says. */
export function structure(system: any, far: number, size: number): Far | null {
  if (!far) {
    return null;
  }

  const view = new Far(system, far);

  return view.read16(0) === size && view.read16(2) === 0 ? view : null;
}
