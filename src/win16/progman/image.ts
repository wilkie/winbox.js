'use strict';

/**
 * The module WinBox's Program Manager runs as, made in memory: a program's
 * executable with no file behind it, so the task is made as `WinExec` makes
 * any program's -- its segments placed, its data segment its own instance,
 * its start-up run by the processor -- by the loader, the linker and
 * KERNEL's `InitTask` as they are. As
 * `crates/winbox-win16/src/progman/image.rs`; the two make the same bytes
 * (`progman_test.ts`).
 *
 * It is `PROGMAN`, "WinBox Program Manager", with Microsoft's header's
 * sizes: its data segment as large as `PROGMAN.EXE`'s (8A3h bytes, seg8), a
 * local heap of 200h and a stack of 17D0h, Windows 3.10, flags 0312h. Its
 * one code segment is a C program's start-up and nothing more: `InitTask`,
 * `WaitEvent(0)`, `InitApp(hInstance)`, then `WinMain` -- WinBox's
 * (`main.ts`), its far address in the data segment at `WINMAIN_SLOT`,
 * written as the module is loaded -- and DOS's function 4Ch with what
 * `WinMain` answered. A failed `InitTask` or `InitApp` ends it with 255.
 */

/** Where the data segment holds `WinMain`'s far address: past `PROGMAN.EXE`'s own data. */
export const WINMAIN_SLOT = 0x8a4;

/** The data segment's size: `PROGMAN.EXE`'s and the slot. */
const DATA_SIZE = 0x8a8;

const NAME = 'PROGMAN';
const DESCRIPTION = 'WinBox Program Manager';

/** The start-up, each call's far address `FFFF:0000` for the linker to fill. */
// prettier-ignore
const CODE = [
  0x9a, 0xff, 0xff, 0x00, 0x00, // 00 call far KERNEL.InitTask
  0x0b, 0xc0, // 05 or ax, ax
  0x74, 0x23, // 07 jz 2C
  0x57, // 09 push di       hInstance
  0x56, // 0A push si       hPrevInstance
  0x06, // 0B push es       lpCmdLine
  0x53, // 0C push bx
  0x52, // 0D push dx       nCmdShow
  0x33, 0xc0, // 0E xor ax, ax
  0x50, // 10 push ax
  0x9a, 0xff, 0xff, 0x00, 0x00, // 11 call far KERNEL.WaitEvent
  0x8b, 0xec, // 16 mov bp, sp
  0xff, 0x76, 0x08, // 18 push word [bp+8]  hInstance
  0x9a, 0xff, 0xff, 0x00, 0x00, // 1B call far USER.InitApp
  0x0b, 0xc0, // 20 or ax, ax
  0x74, 0x08, // 22 jz 2C
  0xff, 0x1e, 0xa4, 0x08, // 24 call far [WINMAIN_SLOT]
  0xb4, 0x4c, // 28 mov ah, 4Ch
  0xcd, 0x21, // 2A int 21h
  0xb8, 0xff, 0x4c, // 2C mov ax, 4CFFh
  0xcd, 0x21, // 2F int 21h
];

/** The imports: each far address's offset in the code, its module's number, its ordinal. */
const IMPORTS: [number, number, number][] = [
  [0x01, 1, 91], // KERNEL.InitTask
  [0x12, 1, 30], // KERNEL.WaitEvent
  [0x1c, 2, 5], // USER.InitApp
];

/** Where the NE header is, and the size of a sector (`1 << SHIFT`). */
const NE = 0x40;
const SHIFT = 4;

/** The executable's bytes. */
export function image(): Uint8Array {
  const bytes: number[] = new Array(NE + 0x40).fill(0);
  const put16 = (at: number, value: number) => {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >> 8) & 0xff;
  };
  const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const counted = (text: string) => {
    bytes.push(text.length);

    for (const character of text) {
      bytes.push(character.charCodeAt(0) & 0xff);
    }
  };
  const align = () => {
    const unit = 1 << SHIFT;

    while (bytes.length % unit) {
      bytes.push(0);
    }
  };

  /* The MZ header: its signature, a page of 40h bytes, a header of four
   * paragraphs, its relocations at 40h -- a Windows program's mark -- and
   * the NE header's place. */
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  put16(0x02, 0x40);
  put16(0x04, 1);
  put16(0x08, 4);
  put16(0x18, 0x40);
  put16(0x3c, NE);

  /* The tables after the NE header, each placed as it is written. */
  const segmentTable = bytes.length;

  bytes.push(...new Array(16).fill(0));

  const resident = bytes.length;

  counted(NAME);
  bytes.push(0, 0, 0);

  const references = bytes.length;

  bytes.push(1, 0, 8, 0);

  const imported = bytes.length;

  bytes.push(0);
  counted('KERNEL');
  counted('USER');

  const entries = bytes.length;

  bytes.push(0, 0);

  const nonresident = bytes.length;

  counted(DESCRIPTION);
  bytes.push(0, 0, 0);

  const nonresidentSize = bytes.length - nonresident;

  /* The code segment and its relocations: each a far address (3), an
   * import by ordinal (1). */
  align();

  const code = bytes.length;

  bytes.push(...CODE);
  word(IMPORTS.length);

  for (const [offset, module, ordinal] of IMPORTS) {
    bytes.push(3, 1);
    word(offset);
    word(module);
    word(ordinal);
  }

  /* The data segment: noughts. */
  align();

  const data = bytes.length;

  bytes.push(...new Array(DATA_SIZE).fill(0));

  const relative = (at: number) => at - NE;
  const header: [number, number][] = [
    [0x00, 0x454e],
    /* Linker 5.20, as PROGMAN.EXE's. */
    [0x02, 0x1405],
    [0x04, relative(entries)],
    [0x06, 2],
    [0x0c, 0x0312],
    /* The data segment, the second. */
    [0x0e, 2],
    [0x10, 0x0200],
    [0x12, 0x17d0],
    /* CS:IP 1:0000, SS:SP 2:0000. */
    [0x14, 0],
    [0x16, 1],
    [0x18, 0],
    [0x1a, 2],
    [0x1c, 2],
    [0x1e, 2],
    [0x20, nonresidentSize],
    [0x22, relative(segmentTable)],
    /* No resources: the resource table where the resident names are. */
    [0x24, relative(resident)],
    [0x26, relative(resident)],
    [0x28, relative(references)],
    [0x2a, relative(imported)],
    [0x2c, nonresident],
    [0x2e, 0],
    [0x32, SHIFT],
    /* Windows; its fonts proportional (08h), as PROGMAN.EXE's. */
    [0x36, 0x0802],
    [0x3e, 0x030a],
    [0x30, 0],
    [0x34, 0],
  ];

  for (const [at, value] of header) {
    put16(NE + at, value);
  }

  /* The segment table: each one's sector, length, flags and allocation.
   * Code: moveable, preloaded, with relocations, discardable (1D50h); data:
   * moveable, preloaded (0C51h), as PROGMAN.EXE's. */
  const sector = (at: number) => at >> SHIFT;
  const table = [
    sector(code),
    CODE.length,
    0x1d50,
    CODE.length,
    sector(data),
    DATA_SIZE,
    0x0c51,
    DATA_SIZE,
  ];

  table.forEach((value, index) => put16(segmentTable + 2 * index, value));

  return new Uint8Array(bytes);
}
