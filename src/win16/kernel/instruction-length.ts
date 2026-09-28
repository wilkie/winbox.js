'use strict';

/**
 * How long an instruction is, as KERNEL works it out to step over the one a
 * program faulted on when Ignore is chosen (`KRNL386.EXE` seg1 `a2f4`):
 * its prefixes, its opcode, and the operands its encoding says follow --
 * a ModR/M byte and its displacement, a SIB byte with 32-bit addressing,
 * an immediate or an address. 16-bit operands and addresses unless a prefix
 * says 32. `null` for what it does not know, which cannot be stepped over:
 * among them `mov` into CS or SS.
 */
export function instructionLength(read: (offset: number) => number): number | null {
  let at = 0;
  let operand32 = false;
  let address32 = false;

  for (;;) {
    const byte = read(at);

    if (byte === 0x66) {
      operand32 = !operand32;
    } else if (byte === 0x67) {
      address32 = !address32;
    } else if (![0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0xf0, 0xf2, 0xf3].includes(byte)) {
      break;
    }

    at++;

    if (at > 14) {
      return null;
    }
  }

  const word = operand32 ? 4 : 2;
  const address = address32 ? 4 : 2;
  const opcode = read(at++);

  /* The bytes a ModR/M byte brings: itself, a SIB byte, a displacement. */
  const modrm = () => {
    const byte = read(at++);
    const mod = byte >> 6;
    const rm = byte & 7;

    if (mod === 3) {
      return byte;
    }

    if (address32) {
      let base = rm;

      if (rm === 4) {
        base = read(at++) & 7;
      }

      at += mod === 1 ? 1 : mod === 2 ? 4 : mod === 0 && base === 5 ? 4 : 0;
    } else {
      at += mod === 1 ? 1 : mod === 2 ? 2 : mod === 0 && rm === 6 ? 2 : 0;
    }

    return byte;
  };

  if (opcode === 0x0f) {
    const second = read(at++);

    if (second >= 0x80 && second <= 0x8f) {
      return at + word;
    }

    if (
      (second >= 0x00 && second <= 0x03) ||
      (second >= 0x90 && second <= 0x9f) ||
      (second >= 0x20 && second <= 0x23) ||
      [
        0xa3, 0xa5, 0xab, 0xad, 0xaf, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xbb, 0xbc, 0xbd, 0xbe,
        0xbf,
      ].includes(second)
    ) {
      modrm();
      return at;
    }

    if (second === 0xa4 || second === 0xac || second === 0xba) {
      modrm();
      return at + 1;
    }

    if ([0x06, 0x08, 0x09, 0xa0, 0xa1, 0xa2, 0xa8, 0xa9].includes(second)) {
      return at;
    }

    return null;
  }

  /* The arithmetic rows: ModR/M forms, then AL and AX with an immediate. */
  if (opcode < 0x40 && (opcode & 7) < 6) {
    const form = opcode & 7;

    if (form < 4) {
      modrm();
      return at;
    }

    return at + (form === 4 ? 1 : word);
  }

  if (opcode === 0x8e) {
    const reg = (read(at) >> 3) & 7;

    if (reg === 1 || reg === 2 || reg > 5) {
      return null;
    }

    modrm();
    return at;
  }

  if (
    (opcode >= 0x84 && opcode <= 0x8f) ||
    [0x62, 0x63, 0xc4, 0xc5, 0xfe, 0xff].includes(opcode) ||
    (opcode >= 0xd0 && opcode <= 0xd3) ||
    (opcode >= 0xd8 && opcode <= 0xdf)
  ) {
    modrm();
    return at;
  }

  if (opcode === 0x69 || opcode === 0x81 || opcode === 0xc7) {
    modrm();
    return at + word;
  }

  if ([0x6b, 0x80, 0x82, 0x83, 0xc0, 0xc1, 0xc6].includes(opcode)) {
    modrm();
    return at + 1;
  }

  if (opcode === 0xf6 || opcode === 0xf7) {
    const reg = (read(at) >> 3) & 7;

    modrm();
    return at + (reg < 2 ? (opcode === 0xf6 ? 1 : word) : 0);
  }

  if (
    (opcode >= 0x70 && opcode <= 0x7f) ||
    (opcode >= 0xb0 && opcode <= 0xb7) ||
    (opcode >= 0xe0 && opcode <= 0xe7) ||
    [0x6a, 0xa8, 0xcd, 0xd4, 0xd5, 0xeb].includes(opcode)
  ) {
    return at + 1;
  }

  if ((opcode >= 0xb8 && opcode <= 0xbf) || [0x68, 0xa9, 0xe8, 0xe9].includes(opcode)) {
    return at + word;
  }

  if (opcode >= 0xa0 && opcode <= 0xa3) {
    return at + address;
  }

  if (opcode === 0x9a || opcode === 0xea) {
    return at + word + 2;
  }

  if (opcode === 0xc2 || opcode === 0xca) {
    return at + 2;
  }

  if (opcode === 0xc8) {
    return at + 3;
  }

  /* The rest take nothing after them. */
  return at;
}
