'use strict';

import { GetExePtr } from '../kernel/module-calls.js';
import { User } from '../user.js';
import { structure } from './structures.js';

/** `CLASSENTRY`'s size. */
const CLASSENTRY = 0x108;

/** `szClassName`'s room: what TOOLHELP asks `GetAtomName` for, 255. */
const NAME_LENGTH = 255;

/**
 * USER's own classes, as its list of classes ends: the newest first.
 * **Recorded** by `thtask`, after the classes programs registered (and
 * MMSYSTEM's, `#42`): USER registers the menu's first, `#32768`, and its
 * icons' titles' last, `#32772`. winbox.js answers for these without
 * registering them, or registers one as it is first asked for, so they are
 * given here as USER has them.
 */
export const USER_CLASSES = [
  '#32772',
  '#32771',
  '#32769',
  'MDIClient',
  'ComboBox',
  'ComboLBox',
  'ScrollBar',
  'ListBox',
  'Edit',
  '#32770',
  'Static',
  'Button',
  '#32768',
];

/**
 * The classes in USER's list, the newest first: those programs registered,
 * by their atoms, and then USER's own. Each its module -- which TOOLHELP
 * calls its instance, class 14h -- and its name. A class whose module has
 * gone is gone from USER's list, which lets a module's classes go with it;
 * winbox.js keeps them, and leaves them out here. One winbox.js registers
 * itself, with no instance -- MMSYSTEM's hidden window's, `#42`
 * (`user-windows.ts`) -- is listed with none.
 */
export function classList(system: any): { instance: number; name: string }[] {
  const own = new Set(USER_CLASSES.map((name) => name.toUpperCase()));
  const registered = Object.entries(system.handles._handles ?? {})
    .map(([handle, entry]: [string, any]) => ({ handle: Number(handle), item: entry?.instance }))
    .filter(
      ({ item }) =>
        item &&
        typeof item === 'object' &&
        'lpszClassName' in item &&
        'lpfnWndProc' in item &&
        !own.has(String(item.lpszClassName).toUpperCase())
    )
    .sort((a, b) => b.handle - a.handle)
    .map(({ item }) => ({
      given: item.hInstance & 0xffff,
      instance: GetExePtr.call(system, item.hInstance & 0xffff) & 0xffff,
      name: String(item.lpszClassName),
    }))
    .filter(({ given, instance }) => !given || instance)
    .map(({ instance, name }) => ({ instance, name }));
  const user = system.modules.handleFromPath(User.path) ?? 0;

  return [...registered, ...USER_CLASSES.map((name) => ({ instance: user & 0xffff, name }))];
}

/**
 * A `CLASSENTRY` filled for the class at a place in the list, as
 * `TOOLHELP.DLL` seg1 `296a`-`29c1` fills it from USER's class: its
 * module (14h), its name (`GetAtomName` of its atom, 4), and the next
 * class (0). The next is the place of the next here, from 1; nought after
 * the last.
 */
function fill(system: any, far: number, place: number) {
  const entry = structure(system, far, CLASSENTRY);
  const list = classList(system);
  const found = list[place - 1];

  if (!entry || !found) {
    return 0;
  }

  entry.write16(0x04, found.instance);
  entry.writeString(0x06, found.name, NAME_LENGTH);
  entry.write16(0x106, place < list.length ? place + 1 : 0);

  return 1;
}

/** The first class in USER's list, filled in (`TOOLHELP.DLL` seg1 `28b0`). */
export function ClassFirst(this: any, lpce: number) {
  return fill(this, lpce, 1);
}

/** The class after the one filled in, from its `wNext` (seg1 `2925`); FALSE after the last. */
export function ClassNext(this: any, lpce: number) {
  const entry = structure(this, lpce, CLASSENTRY);
  const next = entry?.read16(0x106) ?? 0;

  return next ? fill(this, lpce, next) : 0;
}
