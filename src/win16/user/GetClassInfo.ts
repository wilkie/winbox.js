'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { LoadCursor } from './cursor-api.js';
import { procToken } from './window-words.js';
import { dialogClass } from './dialogs.js';
import { systemClass } from './control-classes.js';

/**
 * What a class was registered with, written into a program's `WNDCLASS`.
 * **Recorded** by `classinf`:
 *
 * * Asked with an instance, the classes that instance registered; the name
 *   matches in any case. USER's own are not found this way.
 * * Asked with no instance, USER's own: each with its style and window
 *   bytes, its procedure, USER's instance, a cursor, and no icon, brush or
 *   menu. A program's own is not found this way.
 * * The class's name is the pointer that was passed in.
 * * It answers the class's atom: a string's, C000h or above, for a class
 *   named by a string, and 8002h for dialogs'.
 *
 * Not recorded, and not answered here: USER's classes beyond the controls
 * and dialogs.
 */

/** The cursors USER's classes have: the arrow, and the I-beam for an edit control (documented). */
const IDC_ARROW = 32512;
const IDC_IBEAM = 32513;

/** USER's own classes, as `GetClassInfo` answers them: style and window extra bytes. */
const USER_CLASSES: Record<string, { style: number; wndExtra: number; cursor: number }> = {
  BUTTON: { style: 0x8b, wndExtra: 3, cursor: IDC_ARROW },
  EDIT: { style: 0x88, wndExtra: 6, cursor: IDC_IBEAM },
  STATIC: { style: 0x80, wndExtra: 6, cursor: IDC_ARROW },
  LISTBOX: { style: 0x88, wndExtra: 2, cursor: IDC_ARROW },
  SCROLLBAR: { style: 0x8b, wndExtra: 10, cursor: IDC_ARROW },
  COMBOBOX: { style: 0x88, wndExtra: 2, cursor: IDC_ARROW },
  '#32770': { style: 0x2808, wndExtra: 30, cursor: IDC_ARROW },
};

/** A class's atom: 8002h for dialogs', and one of USER's string atoms, the same each time, for the rest. */
function classAtom(system: any, name: string) {
  if (name === '#32770') {
    return 0x8002;
  }

  system._classAtoms ??= new Map<string, number>();

  if (!system._classAtoms.has(name)) {
    system._classAtoms.set(name, 0xc000 + system._classAtoms.size + 0x100);
  }

  return system._classAtoms.get(name);
}

/** A string kept where a program can read it, for a menu's name. */
function stringFor(system: any, text: string) {
  const far = globalPointer.call(system, GlobalAlloc.call(system, 0x42, text.length + 1)) >>> 0;
  const core = system.machine.cpu.core;

  for (let at = 0; at <= text.length; at++) {
    core.write8(far >>> 16, (far & 0xffff) + at, at < text.length ? text.charCodeAt(at) & 0xff : 0);
  }

  return far;
}

export async function GetClassInfo(this: any, hInstance: number, lpszClassName: any, lpwc: number) {
  if (lpszClassName === null || lpszClassName === undefined || !lpwc) {
    return 0;
  }

  /* The name as it was passed: a string, or a number for an atom. */
  const pointer =
    typeof lpszClassName === 'number'
      ? lpszClassName & 0xffff
      : (((lpszClassName.segment ?? 0) << 16) | (lpszClassName.offset ?? 0)) >>> 0;
  const name =
    typeof lpszClassName === 'number'
      ? lpszClassName === 0x8002
        ? '#32770'
        : `#${lpszClassName}`
      : String(lpszClassName).toUpperCase();

  const fields: number[] = [];

  if (!(hInstance & 0xffff)) {
    const own = USER_CLASSES[name];

    if (!own) {
      return 0;
    }

    const windowClass = name === '#32770' ? dialogClass(this) : systemClass(this, name);
    const cursor = await LoadCursor.call(this, 0, own.cursor);

    fields.push(
      own.style,
      procToken(this, windowClass?.lpfnWndProc),
      0,
      own.wndExtra,
      this.modules.instanceFromPath(this.modules.fromName('USER')?.path) || 1,
      0,
      cursor,
      0,
      0
    );
  } else {
    const windowClass = this.handles.retrieve(name);

    if (
      !windowClass ||
      !windowClass.hInstance ||
      (windowClass.hInstance & 0xffff) !== (hInstance & 0xffff)
    ) {
      return 0;
    }

    const menu = windowClass.lpszMenuName;

    fields.push(
      windowClass.style ?? 0,
      procToken(this, windowClass.lpfnWndProc),
      windowClass.cbClsExtra ?? 0,
      windowClass.cbWndExtra ?? 0,
      windowClass.hInstance,
      windowClass.hIcon ?? 0,
      windowClass.hCursor ?? 0,
      windowClass.hbrBackground ?? 0,
      typeof menu === 'number' ? menu & 0xffff : menu ? stringFor(this, String(menu)) : 0
    );
  }

  /* style, lpfnWndProc, cbClsExtra, cbWndExtra, hInstance, hIcon, hCursor,
   * hbrBackground, lpszMenuName, lpszClassName: 26 bytes. */
  const core = this.machine.cpu.core;
  const segment = lpwc >>> 16;
  let at = lpwc & 0xffff;
  const word = (value: number) => {
    core.write16(segment, at, value & 0xffff);
    at += 2;
  };
  const long = (value: number) => {
    word(value);
    word(value >>> 16);
  };

  word(fields[0]);
  long(fields[1]);
  word(fields[2]);
  word(fields[3]);
  word(fields[4]);
  word(fields[5]);
  word(fields[6]);
  word(fields[7]);
  long(fields[8]);
  long(pointer);

  return classAtom(this, name);
}
