'use strict';

/**
 * The rest of the keyboard driver's exports: what it answers of the keyboard
 * and its tables, `ToAscii`, `OemKeyScan` and `GetKeyNameText`. **Read out
 * of `KEYBOARD.DRV`** (the US driver the installation has, `KBDUS`) and
 * **recorded** by `kbdrv`.
 *
 * The driver's state is kept in its data segment where the driver keeps it
 * (seg11), so that what a program can see of it -- a pointer, a table --
 * is where it is on Windows: its type `[0Ch]`, subtype `[0Fh]`, whether a
 * screen switch is allowed `[104h]`, the BIOS's keyboard procedure
 * `[108h]`, the Alt and numeric keypad state `ToAscii` keeps `[128h]` and
 * `[129h]`, the SysRq flags `[130h]`, what `Inquire` copies `[131h]` and the
 * function keys `[137h]`. USER enables the driver as Windows starts, which
 * reads the type (`NewTable`); here the state is laid out as the driver is
 * first called. As the Rust engine's `keyboard.rs`.
 *
 * Not followed: the BIOS's shift flags at 40:17h, which `ToAscii` sets from
 * the key-state table where it types nothing (seg10 `06c8`) and which
 * WinBox has no BIOS for; dead keys and the Caps Lock tables, which the US
 * layout has none of; a layout library (`keyboard.dll=`).
 */

import { OemToAnsi, translate } from './oem.js';
import { VkKeyScan } from './scan.js';
import {
  ANSI_TO_OEM,
  DEAD_NAME_CHARACTERS,
  DEAD_NAME_INDEX,
  DONT_CARE_FROM,
  DONT_CARE_TO,
  EXTENDED_NAME_INDEX,
  EXTENDED_NAME_SCANS,
  FUNCTION_KEYS,
  INQUIRE,
  KEY_NAMES,
  LAYOUT,
  OEM_TO_ANSI,
  PAD_DIGITS,
  PLAIN_NAME_INDEX,
  PLAIN_NAME_SCANS,
  SCAN_TO_VK,
  SHIFT_TABLES,
  TABLE_SEGMENT,
} from './tables.js';
import { MapVirtualKey } from './scan.js';
import { readProfile, toInteger } from '../kernel/profiles.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { globalPointer } from '../kernel/GlobalLock.js';

const TYPE = 0x0c;
const SUBTYPE = 0x0f;
const SWITCH = 0x104;
const BIOS_PROC = 0x108;
const ALT_TYPED = 0x128;
const PAD_KEY = 0x129;
const ENABLED = 0x12e;
const SYSREQ = 0x130;
const INQUIRE_AT = 0x131;
const KEYS = 0x137;

function core(system: any) {
  return system.machine.cpu.core;
}

/** The driver's data segment's selector. */
function data(system: any): number {
  return system._moduleData?.KEYBOARD ?? 0;
}

/**
 * The driver's state as USER leaves it once Windows has started: enabled
 * (`[12Eh]` FFh, seg10 `0a48`), the BIOS's INT 9 handler kept (`09f9`-
 * `0a02`), as DOS answers for it here, and the type read (`NewTable`).
 * The SysRq flags are 2: **recorded** by `kbdrv`; the driver itself only
 * sets them in `EnableKBSysReq`, and who calls it as Windows starts was
 * not found.
 */
async function started(system: any) {
  const segment = data(system);
  const memory = core(system);

  if (!segment || memory.read8(segment, ENABLED)) {
    return segment;
  }

  memory.write8(segment, ENABLED, 0xff);
  INQUIRE.forEach((byte, i) => memory.write8(segment, INQUIRE_AT + i, byte));
  memory.write8(segment, SWITCH, 1);
  memory.write8(segment, SYSREQ, 2);

  const idt = system.machine.idtSegment;

  memory.write16(segment, BIOS_PROC, idt ? memory.read16(idt, 9 * 4) : 0);
  memory.write16(segment, BIOS_PROC + 2, idt ? memory.read16(idt, 9 * 4 + 2) : 0);
  await newTable(system);

  return segment;
}

/**
 * The type read again (seg3 `00cd`-`0151`). One already known, 1 to 6, is
 * taken for 4; none -- as Windows starts -- is the BIOS's: 1, 3 on an AT
 * (model byte FCh), 4 with an enhanced keyboard (40:96h bit 4), which is
 * DOSBox's machine; then `SYSTEM.INI`'s `[keyboard]` `type=` where it has
 * one, unless that is past 4. The function keys are the type's.
 */
async function newTable(system: any) {
  const segment = data(system);
  const memory = core(system);
  let type = memory.read8(segment, TYPE);

  if (type >= 1 && type <= 6) {
    type = 4;
  } else {
    const profile = await readProfile(system, 'SYSTEM.INI');
    const given = toInteger(profile.get('keyboard', 'type', false), 4) & 0xff;

    type = given || 4;

    if (type > 4) {
      memory.write8(segment, TYPE, 4);
      return;
    }
  }

  memory.write8(segment, TYPE, type);
  memory.write16(segment, KEYS, FUNCTION_KEYS[type - 1]);
}

/** What the keyboard is: six bytes copied to `lpInfo`, and 6 (seg10 `09b8`). */
export async function Inquire(this: any, lpInfo: number) {
  const segment = await started(this);
  const memory = core(this);

  for (let i = 0; i < 6; i++) {
    memory.write8(
      lpInfo >>> 16,
      ((lpInfo & 0xffff) + i) & 0xffff,
      memory.read8(segment, INQUIRE_AT + i)
    );
  }

  return 6;
}

/** The type read again, as `NewTable` does. What it leaves in AX is no answer. */
export async function NewTable(this: any) {
  await started(this);
  await newTable(this);
}

/**
 * The keyboard's type (0), its subtype (1), its function keys (2); nought
 * for anything else. Only the low byte is looked at (seg7 `000c`-`002a`).
 */
export async function GetKeyboardType(this: any, nTypeFlag: number) {
  const segment = await started(this);
  const memory = core(this);

  switch (nTypeFlag & 0xff) {
    case 0:
      return memory.read8(segment, TYPE);
    case 1:
      return memory.read8(segment, SUBTYPE);
    case 2:
      return memory.read16(segment, KEYS);
    default:
      return 0;
  }
}

/**
 * The typematic rate set on the keyboard's controller: the rate given, or
 * nought for -1, which sets nothing; -1 where the controller does not take
 * it (seg6 `002a`-`006a`). DOSBox's takes it: **recorded** by `kbdrv`.
 */
export async function SetSpeed(this: any, nRate: number) {
  await started(this);

  return (nRate & 0xffff) === 0xffff ? 0 : nRate & 0xffff;
}

/**
 * Whether a screen switch is allowed: the word's two bytes ORed together
 * kept, and the word answered with its low byte so (seg10 `095c`-`0961`).
 */
export async function ScreenSwitchEnable(this: any, fEnable: number) {
  const segment = await started(this);
  const word = fEnable & 0xffff;
  const low = (word & 0xff) | (word >> 8);

  core(this).write8(segment, SWITCH, low);

  return (word & 0xff00) | low;
}

/**
 * The SysRq flags: 1 sets bit 0, 2 clears it, 4 sets bit 1, 8 clears it,
 * in that order; the flags then (seg10 `0977`-`09a0`).
 */
export async function EnableKBSysReq(this: any, fSysReq: number) {
  const segment = await started(this);
  const memory = core(this);
  let flags = memory.read8(segment, SYSREQ);

  if (fSysReq & 1) flags |= 1;
  if (fSysReq & 2) flags &= ~1;
  if (fSysReq & 4) flags |= 2;
  if (fSysReq & 8) flags &= ~2;

  memory.write8(segment, SYSREQ, flags);

  return flags;
}

/** The BIOS's INT 9 handler the driver found as it was enabled (seg10 `0028`). */
export async function GetBIOSKeyProc(this: any) {
  const segment = await started(this);
  const memory = core(this);

  return ((memory.read16(segment, BIOS_PROC + 2) << 16) | memory.read16(segment, BIOS_PROC)) >>> 0;
}

/**
 * A selector of the segment the layout's tables are in: the driver's own
 * code segment 2, whose first 88h bytes are the tables (seg2 `0094`).
 * Here a block of WinBox's own holding them, made as it is first asked
 * for.
 */
export async function GetTableSeg(this: any) {
  await started(this);

  if (!this._keyboardTableSegment) {
    const block = GlobalAlloc.call(this, 0x0042, TABLE_SEGMENT.length);
    const far = globalPointer.call(this, block) >>> 0;
    const memory = core(this);

    TABLE_SEGMENT.forEach((byte, i) => memory.write8(far >>> 16, (far & 0xffff) + i, byte));
    this._keyboardTableSegment = far >>> 16;
  }

  return this._keyboardTableSegment;
}

/**
 * The character a key types, from its virtual key, its scan code (bit 15 set
 * for a key's release), the key-state table and flags (seg10 `0430`-
 * `06c5`). Answers 1 with the character in the byte at `lpChar`, or
 * nought. Shift, Ctrl and Alt are read from the table's 10h, 11h and 12h,
 * Caps Lock from 14h's bit 0.
 *
 * * A virtual key of nought types nothing.
 * * Alt with the numeric keypad's digits types a character by its number:
 *   each digit's key, by its scan code, makes `lpChar`'s byte ten times
 *   itself plus the digit, in a byte, answering nought; Alt's release
 *   answers 1, the number taken from the OEM character set but where it
 *   began with nought. Not with flag 1; flag 2 types nothing.
 * * A letter: small, capital with Shift, the other way with Caps Lock;
 *   with Ctrl its low five bits.
 * * The numeric keypad's digits without Ctrl or Alt.
 * * The rest from the layout's tables, Shift and Ctrl as `VkKeyScan` reads
 *   them; with Ctrl, a character with bit 7 set only with Shift too, its
 *   low five bits.
 *
 * Where nothing is typed, nought is written as a word.
 */
export async function ToAscii(
  this: any,
  wVirtKey: number,
  wScanCode: number,
  lpKeyState: number,
  lpChar: number,
  wFlags: number
) {
  const segment = await started(this);
  const memory = core(this);
  const charSegment = lpChar >>> 16;
  const charOffset = lpChar & 0xffff;
  const key = (at: number) =>
    memory.read8(lpKeyState >>> 16, ((lpKeyState & 0xffff) + at) & 0xffff);
  const charByte = () => memory.read8(charSegment, charOffset);
  const writeWord = (value: number) => memory.write16(charSegment, charOffset, value);
  const nothing = () => {
    writeWord(0);
    return 0;
  };
  const typed = (character: number) => {
    memory.write8(charSegment, charOffset, character & 0xff);
    return 1;
  };
  const vk = wVirtKey & 0xffff;
  const scan = wScanCode & 0xffff;
  const al = vk & 0xff;

  if (vk === 0) {
    return nothing();
  }

  if (scan & 0x8000) {
    if (al === 0x12) {
      memory.write8(segment, PAD_KEY, 0);

      const pending = memory.read8(segment, ALT_TYPED);

      memory.write8(segment, ALT_TYPED, 0);

      if (charByte() === 0) {
        return nothing();
      }

      if (pending === 0) {
        await OemToAnsi.call(this, lpChar, lpChar);
      }

      return 1;
    }

    if ((scan & 0xff) === memory.read8(segment, PAD_KEY)) {
      memory.write8(segment, PAD_KEY, 0);
    }

    return 0;
  }

  if (al === 0x12) {
    writeWord(0);
    memory.write8(segment, ALT_TYPED, 0);
  }

  let shift = (key(0x10) & 0x80 ? 1 : 0) + (key(0x11) & 0x80 ? 2 : 0) + (key(0x12) & 0x80 ? 4 : 0);

  if (shift === 4 || shift === 5) {
    const code = scan & 0xff;
    const digit = code >= 0x47 && code <= 0x52 ? PAD_DIGITS[code - 0x47] : 0xff;

    if (!(wFlags & 1) && digit !== 0xff) {
      if (wFlags & 2) {
        return nothing();
      }

      const last = memory.read8(segment, PAD_KEY);

      memory.write8(segment, PAD_KEY, code);

      if (last === code) {
        return 0;
      }

      const old = charByte();
      const value = (((old * 10) & 0xff) + digit) & 0xff;

      writeWord(value);

      if (value === old) {
        memory.write8(segment, ALT_TYPED, 1);
      }

      return 0;
    }

    shift &= 3;
  }

  let pair: [number, number];

  if (shift <= 3 && al >= 0x41 && al <= 0x5a) {
    if (shift >= 2) {
      return typed(al & 0x1f);
    }

    pair = [al + 0x20, al];
  } else if (al >= 0x60 && al <= 0x69) {
    return shift <= 1 ? typed((al + 0xd0) & 0xff) : nothing();
  } else {
    const table = SHIFT_TABLES[shift];
    const layout = table === 0xff ? undefined : LAYOUT[table >> 1];
    const index = layout ? layout.keys.indexOf(al) : -1;

    if (!layout || index < 0) {
      return nothing();
    }

    if (shift > 1) {
      const character = layout.characters[index];

      if (shift === 2) {
        return character & 0x80 ? nothing() : typed(character);
      }

      if (shift === 3) {
        return character & 0x80 ? typed(character & 0x1f) : nothing();
      }

      return typed(character);
    }

    pair = [layout.characters[index * 2], layout.characters[index * 2 + 1]];
  }

  let character = shift ? pair[1] : pair[0];

  if (key(0x14) & 1 && al >= 0x41 && al <= 0x5a) {
    character = character === pair[0] ? pair[1] : pair[0];
  }

  return character === 0xff ? nothing() : typed(character);
}

/**
 * The scan code and shift state that type an OEM character: the scan code in
 * the low word, the shifts in the high -- 2 Shift, 4 Ctrl -- or -1 (seg4
 * `000c`-`00b6`). A capital is its letter with Shift; a small letter its
 * capital's; space, Enter, Tab and Backspace their own keys; 01h to 1Ah
 * Ctrl and a letter; from 80h up the ANSI character that one is, where it
 * comes back the same, typed as `VkKeyScan` finds it -- as is anything else,
 * except with Alt. The scan code is the first in the driver's table whose
 * virtual key that is, of its first 3Ah.
 */
export async function OemKeyScan(this: any, wOemChar: number) {
  await started(this);

  let character = wOemChar & 0xff;
  let shifts = 0;
  let viaScan = false;

  if (character >= 0x80) {
    const ansi = translate(OEM_TO_ANSI, character);

    if (ansi < 0x80 || translate(ANSI_TO_OEM, ansi) !== character) {
      return 0xffffffff;
    }

    character = ansi;
    viaScan = true;
  } else if (character >= 0x41 && character <= 0x5a) {
    shifts = 2;
  } else if (character === 0x20 || character === 0x0d || character === 0x09 || character === 0x08) {
    // their own keys
  } else if (character >= 0x61 && character <= 0x7a) {
    character -= 0x20;
  } else if (character !== 0x0a && character >= 0x01 && character <= 0x1a) {
    character += 0x40;
    shifts = 4;
  } else {
    viaScan = true;
  }

  if (viaScan) {
    const found = await VkKeyScan.call(this, character);

    if (found === 0xffff || (found >> 8) & 4) {
      return 0xffffffff;
    }

    shifts = ((found >> 8) << 1) & 0xff;
    character = found & 0xff;
  }

  const scan = SCAN_TO_VK.subarray(0, 0x3a).indexOf(character);

  return scan < 0 ? 0xffffffff : ((shifts << 16) | scan) >>> 0;
}

/**
 * A key's name, from the scan code in `lParam`'s bits 16-23, bit 24 the
 * extended keys' and bit 25 "don't care" which Shift, Ctrl or Alt (seg9
 * `0311`-`040c`). A key that types a printable character, of those the
 * scan codes up to 35h and 56h type, is that character; any other is
 * named from the driver's list, plain or extended. At most `nSize` bytes
 * with the null are written; the answer is how many were copied, and where
 * the name did not fit, `nSize`. Nought for a key with no name, or a size
 * under 1.
 */
export async function GetKeyNameText(this: any, lParam: number, lpBuffer: number, nSize: number) {
  await started(this);

  const memory = core(this);
  const size = (nSize << 16) >> 16;

  if (size < 1) {
    return 0;
  }

  const code = (lParam >>> 16) & 0xff;
  /* Bit 25 is looked for in the high byte of what was last in AX: the
   * flags, but for a dead key its character's high byte (`039b`). */
  let flags = (lParam >>> 24) & 0xff;
  let index = -1;

  if (code === 0x56 || code < 0x35 || (code === 0x35 && !(flags & 1))) {
    const vk = MapVirtualKey.call(this, code, 1) & 0xff;

    if (vk) {
      const typed = MapVirtualKey.call(this, vk, 2);

      if (typed & 0x8000) {
        flags = (typed >> 8) & 0xff;
        index = lookup(DEAD_NAME_CHARACTERS, DEAD_NAME_INDEX, typed & 0xff);

        if (index < 0) {
          return 0;
        }
      } else if ((typed & 0xff) > 0x20) {
        memory.write8(lpBuffer >>> 16, lpBuffer & 0xffff, typed & 0xff);
        memory.write8(lpBuffer >>> 16, ((lpBuffer & 0xffff) + 1) & 0xffff, 0);

        return 1;
      }
    }
  }

  if (index < 0) {
    index =
      (lParam >>> 24) & 1
        ? lookup(EXTENDED_NAME_SCANS, EXTENDED_NAME_INDEX, code)
        : lookup(PLAIN_NAME_SCANS, PLAIN_NAME_INDEX, code);

    if (index < 0) {
      return 0;
    }
  }

  if (flags & 2) {
    const other = lookup(DONT_CARE_FROM, DONT_CARE_TO, index);

    if (other >= 0) {
      index = other;
    }
  }

  const name = KEY_NAMES[index] ?? '';
  let copied = 0;

  for (let at = 0; ; at++) {
    if (at === size) {
      memory.write8(lpBuffer >>> 16, ((lpBuffer & 0xffff) + at - 1) & 0xffff, 0);
      return copied;
    }

    const byte = at < name.length ? name.charCodeAt(at) : 0;

    memory.write8(lpBuffer >>> 16, ((lpBuffer & 0xffff) + at) & 0xffff, byte);

    if (!byte) {
      return copied;
    }

    copied++;
  }
}

/** A byte's partner in a pair of tables: `to`'s byte where `from` has it first, or -1. */
function lookup(from: Uint8Array, to: Uint8Array, byte: number) {
  const at = from.indexOf(byte);

  return at < 0 ? -1 : to[at];
}
