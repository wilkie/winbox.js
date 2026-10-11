'use strict';

/**
 * The characters GDI's table gives a Unicode value other than the ANSI
 * code's own, from GDI.EXE's last data segment at `067E`: 256 words, the
 * Unicode value of each ANSI code. 1Fh's word is nought, so no character
 * finds it.
 */
const OWN: Record<number, number> = {
  0x1f: 0x0000,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9f: 0x0178,
  0xb7: 0x2219,
};

/** The ANSI code of a Unicode value: the first in GDI's table to have it, or 1Fh for none. */
export function ansiOf(unicode: number) {
  for (let code = 0; code < 256; code++) {
    if ((OWN[code] ?? code) === unicode) {
      return code;
    }
  }

  return 0x1f;
}

/**
 * GDI's own: a string of Unicode words, ended by nought, made ANSI. Each
 * character is the code GDI's table gives its value, 1Fh where the table has
 * none, and the string is ended with nought; the answer is the bytes written,
 * the nought too (`GDI.EXE` seg1 `56a3`). Control Panel's Fonts names the
 * TrueType fonts it offers to add from their files' `name` tables so.
 */
export function UnicodeToAnsi(this: any, lpwszSource: number, lpszTarget: number) {
  const core = this.machine.cpu.core;
  const source = lpwszSource >>> 0;
  const target = lpszTarget >>> 0;
  let read = source & 0xffff;
  let written = target & 0xffff;

  for (;;) {
    const unicode =
      core.read8(source >>> 16, read) | (core.read8(source >>> 16, (read + 1) & 0xffff) << 8);

    read = (read + 2) & 0xffff;

    if (!unicode) {
      break;
    }

    core.write8(target >>> 16, written, ansiOf(unicode));
    written = (written + 1) & 0xffff;
  }

  core.write8(target >>> 16, written, 0);

  return ((written - (target & 0xffff)) & 0xffff) + 1;
}
