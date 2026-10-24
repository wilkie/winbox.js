'use strict';

import { B, D, W, buffer, stringOf } from '../commdlg/api.js';
import { GroupFile, type IconMetrics, cString, groupSum } from '../../layers/groups.js';
import {
  type Pm,
  bytesOf,
  D_CLIENT,
  D_CLOSING,
  D_CREATING,
  D_FRAME,
  D_INI_READ_ONLY,
  D_INSTANCE,
  D_LOADING,
  D_LOST_ICONS,
  D_NO_SAVE_SETTINGS,
  D_SAVE_ERRORS,
  INI,
  dosPath,
  latin,
  loadGroups,
  string,
} from './main.js';
import { type Item, extract, makeItems } from './items.js';

/**
 * The groups an instance has loaded, and what loads, unloads, makes, renames,
 * writes and deletes them, as `PROGMAN.EXE` seg4 does. As
 * `crates/winbox-win16/src/progman/loaded.rs`.
 *
 * `PROGMAN.EXE` keeps a group as a structure of 14h bytes in its data segment
 * (seg4 `1d8a`: the next, its MDI child, its block, its items, its file's
 * path, its number, whether its file is read-only, the file's time), linked
 * in the order loaded from `[13Ah]`, `[13Eh]` the last and `[13Ch]` the
 * current one; its window, a real MDI child of class `PMGroup`, holds the
 * structure in its word 0. WinBox's keeps the same fields here, by a key of
 * its own in place of the structure's address, the window holding the key;
 * the block is the group file's bytes as the model has them (`GroupFile`),
 * which `PROGMAN.EXE` keeps in a discardable global block and reads again
 * where it was discarded -- WinBox's is never discarded but where a change
 * fails (`157c`).
 */

/** A group loaded. */
export interface Loaded {
  /** `[si+2]`: its MDI child. */
  hwnd: number;
  /** `[si+0Ah]`: its number, `GroupN=`'s. */
  n: number;
  /** `[si+8]`: its file's path. */
  path: string;
  /** `[si+4]`: its block, null until it is read. */
  block: GroupFile | null;
  /** `[si+6]`: its items, in the order they lie in memory. */
  items: Item[];
  /** `[si]`: the next in the list from `[13Ah]`, by key; nought for none. */
  next: number;
  /** `[si+0Ch]`: its file read-only, as seg4 `0093` last found it. */
  readOnly: boolean;
}

/** An instance's groups. */
export interface Groups {
  /** Every group loaded, by key. */
  map: Map<number, Loaded>;
  /** `[13Ah]`: the first in the list; nought for none. */
  head: number;
  /** `[13Eh]`: the last linked, or nought for `[13Ah]` itself; it may name a group let go (seg4 `1f9a`). */
  tail: number;
  /** `[13Ch]`: the current group; nought for none. */
  current: number;
  /** The last key given. */
  keys: number;
  /** `[452h]`: `SYSTEM.INI`'s path, as start-up made it. */
  systemIni: string;
}

/** The list from `[13Ah]`, in its order: the keys. */
export function list(groups: Groups): number[] {
  const keys: number[] = [];
  let at = groups.head;

  while (at && !keys.includes(at)) {
    const group = groups.map.get(at);

    if (!group) {
      break;
    }

    keys.push(at);
    at = group.next;
  }

  return keys;
}

/**
 * A group linked after `[13Eh]` (seg4 `1f6a`-`1f74`): the list's first where
 * `[13Eh]` is `[13Ah]`, the next of the group it names, or nothing reachable
 * where that group was let go.
 */
function link(groups: Groups, key: number) {
  const group = groups.map.get(key);

  if (group) {
    group.next = 0;
  }

  if (groups.tail === 0) {
    groups.head = key;
  } else {
    const last = groups.map.get(groups.tail);

    if (last) {
      last.next = key;
    }
  }

  groups.tail = key;
}

/**
 * A group taken out of the list: the link that names it made to name its
 * next. The place of that link, a group's key or nought for `[13Ah]`; null
 * where no link names it.
 */
function unlink(groups: Groups, key: number): number | null {
  const group = groups.map.get(key);

  if (!group) {
    return null;
  }

  if (groups.head === key) {
    groups.head = group.next;
    return 0;
  }

  for (const [at, each] of groups.map) {
    if (each.next === key) {
      each.next = group.next;
      return at;
    }
  }

  return null;
}

/** Every instance's groups, by its instance. */
function store(pm: Pm): Map<number, Groups> {
  pm.system._progmanGroups ??= new Map();

  return pm.system._progmanGroups;
}

/** An instance's groups. */
export function groups(pm: Pm): Groups {
  const instance = (pm.ds - 1) & 0xffff;
  let found = store(pm).get(instance);

  if (!found) {
    found = { map: new Map(), head: 0, tail: 0, current: 0, keys: 0, systemIni: '' };
    store(pm).set(instance, found);
  }

  return found;
}

/** An instance's groups let go, as it ends. */
export function forget(pm: Pm) {
  store(pm).delete((pm.ds - 1) & 0xffff);
}

/** A group, where it is loaded. */
export const group = (pm: Pm, key: number) => groups(pm).map.get(key);

/** `GetWindowWord(hwnd, 0)`: the group a window holds. */
export async function keyOf(pm: Pm, hwnd: number) {
  return (await pm.user('GetWindowWord', [W(hwnd), W(0)])) & 0xffff;
}

/**
 * The MDI client's children that are groups' windows, from the top
 * (`GW_CHILD`, then `GW_HWNDNEXT`), those with an owner -- icons' titles --
 * passed over, as every walk of them does.
 */
export async function windowsTopDown(pm: Pm): Promise<number[]> {
  const found: number[] = [];
  let child = (await pm.user('GetWindow', [W(pm.d16(D_CLIENT)), W(5)])) & 0xffff;

  while (child) {
    if (!((await pm.user('GetWindow', [W(child), W(4)])) & 0xffff)) {
      found.push(child);
    }

    child = (await pm.user('GetWindow', [W(child), W(2)])) & 0xffff;
  }

  return found;
}

/**
 * The same from the bottom (`GW_CHILD`, `GW_HWNDLAST`, then `GW_HWNDPREV`), as
 * saving and the profile's groups walk them (seg4 `268f`-`26d8`,
 * `28e0`-`290b`).
 */
export async function windowsBottomUp(pm: Pm): Promise<number[]> {
  const found: number[] = [];
  const first = (await pm.user('GetWindow', [W(pm.d16(D_CLIENT)), W(5)])) & 0xffff;

  if (!first) {
    return found;
  }

  let child = (await pm.user('GetWindow', [W(first), W(1)])) & 0xffff;

  while (child) {
    if (!((await pm.user('GetWindow', [W(child), W(4)])) & 0xffff)) {
      found.push(child);
    }

    child = (await pm.user('GetWindow', [W(child), W(3)])) & 0xffff;
  }

  return found;
}

/** `PMGroup`, the groups' class (string 3). */
export const GROUP_CLASS = 'PMGroup';

const WM_MDICREATE = 0x220;
const WM_MDIDESTROY = 0x221;

const word = (data: Uint8Array, at: number) =>
  at + 1 < data.length ? data[at] | (data[at + 1] << 8) : 0;

const words = (values: number[]) => values.flatMap((value) => [value & 0xff, (value >> 8) & 0xff]);
const longs = (value: number) => words([value & 0xffff, value >>> 16]);

/**
 * `LoadGroup` (seg4 `1d4d`): a group loaded from its file as `n` -- the lowest
 * number no group in the list has where it is nought (`1d5c`, `1d21`). Its
 * structure made; its window made by `WM_MDICREATE` to the MDI client --
 * class `PMGroup`, no title, `CW_USEDEFAULT` each way, style 115h, the
 * structure its `lParam`, `[16h]` set meanwhile; its file read (`018a`) and
 * checked (`1c95`), else the window destroyed and nothing loaded; its title
 * the group's name; placed by `SetWindowPlacement` where the file's
 * `nCmdShow` is not nought, its icon at `ptMin`; its icons checked against
 * the display (`17ae`) and its items made (`1735`); linked last and made
 * current; `CalcChildScroll` of the client; and its file's read-only state
 * taken (`0093`). Its window, or nought.
 */
export async function load(pm: Pm, path: string, n: number): Promise<number> {
  const all = groups(pm);

  if (n === 0) {
    n = 1;

    while (list(all).some((key) => all.map.get(key)!.n === n)) {
      n = (n + 1) & 0xffff;
    }
  }

  all.keys = (all.keys + 1) & 0xffff || 1;

  const key = all.keys;

  all.map.set(key, { hwnd: 0, n, path, block: null, items: [], next: 0, readOnly: false });

  const [klass, saved] = pm.reserve([...bytesOf(GROUP_CLASS), 0]);
  const [title, inner] = pm.reserve([0]);
  const create = [
    ...longs(klass),
    ...longs(title),
    ...words([pm.d16(D_INSTANCE), 0x8000, 0x8000, 0x8000, 0x8000]),
    ...longs(0x115),
    ...longs(key),
  ];
  let hwnd: number;

  pm.sd16(D_CREATING, 1);

  try {
    hwnd =
      (
        await pm.call('USER', 'SendMessage', [
          W(pm.d16(D_CLIENT)),
          W(WM_MDICREATE),
          W(0),
          B(create),
        ])
      ).value & 0xffff;
  } finally {
    pm.release(inner);
    pm.release(saved);
    pm.sd16(D_CREATING, 0);
  }

  if (!hwnd) {
    all.map.delete(key);
    return 0;
  }

  all.map.get(key)!.hwnd = hwnd;
  pm.sd16(D_LOADING, 1);

  const block = await lock(pm, key);

  pm.sd16(D_LOADING, 0);

  if (!block || !valid(block.data)) {
    /* `1ece`: "invalid or damaged" (75), not shown; the window gone. */
    await destroy(pm, key, hwnd);
    return 0;
  }

  await pm.user('SetWindowText', [W(hwnd), string(cString(block.data, word(block.data, 0x16)))]);

  const show = word(block.data, 0x08);

  if (show) {
    await pm.user('SetWindowPlacement', [
      W(hwnd),
      B([
        0x16,
        0,
        1,
        0,
        ...words([show]),
        ...block.data.subarray(0x12, 0x16),
        0,
        0,
        0,
        0,
        ...block.data.subarray(0x0a, 0x12),
      ]),
    ]);
  }

  await displayCheck(pm, key);
  await makeItems(pm, key);
  link(all, key);
  all.current = key;
  await pm.user('CalcChildScroll', [W(pm.d16(D_CLIENT)), W(3)]);
  await writable(pm, key);

  return hwnd;
}

/** A group whose file could not be loaded let go: its window destroyed by `WM_MDIDESTROY`, and its structure (`1e97`-`1ebb`). */
async function destroy(pm: Pm, key: number, hwnd: number) {
  await pm.send(pm.d16(D_CLIENT), WM_MDIDESTROY, hwnd, 0);
  groups(pm).map.delete(key);
}

/** seg4 `1c95`: the file's slots, each empty or its six offsets within `cbGroup`; `cItems` not nought. */
function valid(data: Uint8Array) {
  const cbGroup = word(data, 6);
  const slots = word(data, 0x20);

  if (!slots) {
    return false;
  }

  for (let slot = 0; slot < slots; slot++) {
    const def = word(data, 0x22 + slot * 2);

    if (
      def &&
      (def > cbGroup ||
        [0x12, 0x14, 0x16, 0x0c, 0x0e, 0x10].some((field) => word(data, def + field) > cbGroup))
    ) {
      return false;
    }
  }

  return true;
}

/**
 * `LockGroup` (seg4 `018a`): the group's block, read from its file where it is
 * not in memory -- `_lopen` with `OF_SHARE_DENY_NONE`, its size by `_llseek`,
 * 24h bytes at least, `_lread` whole, `cbGroup` within it, its sum nought and
 * `PMCC` first. Null where it cannot be, the box the file shows for it not
 * shown (`02e4`-`0387`; the one that would offer to take its key out of
 * `PROGMAN.INI` answered as not taking it), and the window shown minimized
 * (`03d4`).
 *
 * Not followed: the file's time kept and compared as it is read again
 * (`01f1`-`0263`, 465h), as WinBox's block is never discarded.
 */
export async function lock(pm: Pm, key: number): Promise<GroupFile | null> {
  const found = group(pm, key);

  if (!found) {
    return null;
  }

  if (found.block) {
    return found.block;
  }

  const data = await readFile(pm, found.path);

  if (
    !data ||
    word(data, 6) > data.length ||
    groupSum(data) !== 0 ||
    String.fromCharCode(...data.subarray(0, 4)) !== 'PMCC'
  ) {
    await pm.user('ShowWindow', [W(found.hwnd), W(7)]);
    return null;
  }

  found.block = new GroupFile(data);

  return found.block;
}

/** A file's bytes, read as the group loader reads it; null where it cannot be opened or is too short to be a group. */
async function readFile(pm: Pm, path: string): Promise<Uint8Array | null> {
  const file = (await pm.kernel('_lopen', [string(path), W(0x40)])) & 0xffff;

  if (file === 0xffff) {
    return null;
  }

  const size = (await pm.kernel('_llseek', [W(file), D(0), W(2)])) >>> 0;
  let data: Uint8Array | null = null;

  if (size >= 0x24 && size < 0x10000) {
    await pm.kernel('_llseek', [W(file), D(0), W(0)]);

    const memory = (await pm.kernel('GlobalAlloc', [W(0x42), D(size)])) & 0xffff;

    if (memory) {
      const at = (await pm.kernel('GlobalLock', [W(memory)])) >>> 0;
      const read = (await pm.kernel('_lread', [W(file), D(at), W(size)])) & 0xffff;

      if (read === size) {
        data = Uint8Array.from(pm.readFar(at, size));
      }

      await pm.kernel('GlobalUnlock', [W(memory)]);
      await pm.kernel('GlobalFree', [W(memory)]);
    }
  }

  await pm.kernel('_lclose', [W(file)]);

  return data;
}

/**
 * seg4 `0093`: whether the group's file may be written -- DOS 4300h's
 * attributes without the read-only bit (seg5 `0af7`), unless Program Manager
 * is closing (`[32h]`) -- kept as `[si+0Ch]`.
 */
export async function writable(pm: Pm, key: number): Promise<boolean> {
  const found = group(pm, key);

  if (!found) {
    return false;
  }

  const readOnly = (await isReadOnly(pm, found.path)) && !pm.d16(D_CLOSING);

  found.readOnly = readOnly;

  return !readOnly;
}

/** seg5 `0af7`: a file's read-only bit, by DOS 4300h on its OEM path; not read-only where DOS fails. */
async function isReadOnly(pm: Pm, path: string) {
  const { carry, ax } = await dosPath(pm, 0x4300, await oem(pm, path));

  return !carry && (ax & 1) !== 0;
}

/** A path made OEM, as `AnsiToOem` makes it. */
async function oem(pm: Pm, path: string) {
  return latin(stringOf(await pm.call('KEYBOARD', 'AnsiToOem', [string(path), buffer(0x80)]), 1));
}

/** A path made ANSI, as `OemToAnsi` makes it. */
async function ansi(pm: Pm, path: string) {
  return latin(stringOf(await pm.call('KEYBOARD', 'OemToAnsi', [string(path), buffer(0x80)]), 1));
}

/**
 * `WriteGroup` (seg4 `04a5`): nothing where the file is read-only; else the
 * block's sum set, the file opened for writing or made, made long enough
 * first where it is shorter -- a byte written at its new end -- the block
 * written from its start and the file ended there by a write of nought
 * bytes. Whether it was written; the boxes for what fails not shown, and the
 * block then let go.
 */
export async function write(pm: Pm, key: number): Promise<boolean> {
  const found = group(pm, key);

  if (!found || (await isReadOnly(pm, found.path)) || !found.block) {
    return false;
  }

  const bytes = found.block.bytes();
  let file = (await pm.kernel('_lopen', [string(found.path), W(1)])) & 0xffff;

  if (file === 0xffff) {
    file = (await pm.kernel('_lcreat', [string(found.path), W(0)])) & 0xffff;
  }

  if (file === 0xffff) {
    found.block = null;
    return false;
  }

  const length = bytes.length;
  const size = (await pm.kernel('_llseek', [W(file), D(0), W(2)])) >>> 0;
  let failed = false;

  if (size < length) {
    const at = (await pm.kernel('_llseek', [W(file), D(length - 1), W(0)])) >>> 0;

    if (
      ((at - length) & 0xffff) !== 0xffff ||
      ((await pm.kernel('_lwrite', [W(file), B([file & 0xff]), W(1)])) & 0xffff) !== 1
    ) {
      /* `05a9`: no room (153); the file put back as it was. */
      await pm.kernel('_llseek', [W(file), D(size), W(0)]);
      failed = true;
    }
  }

  if (!failed) {
    await pm.kernel('_llseek', [W(file), D(0), W(0)]);
    failed = (await writeBytes(pm, file, bytes)) !== (length & 0xffff);
  }

  await pm.kernel('_lwrite', [W(file), D(((pm.ds << 16) | 0x36) >>> 0), W(0)]);
  await pm.kernel('_lclose', [W(file)]);

  if (failed) {
    found.block = null;
    await pm.user('InvalidateRect', [W(found.hwnd), D(0), W(1)]);
  }

  return !failed;
}

/** `_lwrite` of bytes from a global block of their own, as the file writes from its group's block: what was written. */
async function writeBytes(pm: Pm, file: number, bytes: Uint8Array) {
  const memory = (await pm.kernel('GlobalAlloc', [W(0x42), D(bytes.length)])) & 0xffff;

  if (!memory) {
    return 0;
  }

  const at = (await pm.kernel('GlobalLock', [W(memory)])) >>> 0;

  pm.writeFar(at, Array.from(bytes));

  const written = (await pm.kernel('_lwrite', [W(file), D(at), W(bytes.length)])) & 0xffff;

  await pm.kernel('GlobalUnlock', [W(memory)]);
  await pm.kernel('GlobalFree', [W(memory)]);

  return written;
}

/**
 * The screen's icon format and size: `GetDeviceCaps` `BITSPIXEL` and `PLANES`
 * of the screen's DC, `SM_CXICON` and `SM_CYICON` (seg4 `2214`-`225e`,
 * `1844`-`18a5`).
 */
async function metrics(pm: Pm): Promise<IconMetrics> {
  const dc = (await pm.user('GetDC', [W(0)])) & 0xffff;
  const bitsPixel = (await pm.call('GDI', 'GetDeviceCaps', [W(dc), W(12)])).value & 0xffff;
  const planes = (await pm.call('GDI', 'GetDeviceCaps', [W(dc), W(14)])).value & 0xffff;

  await pm.user('ReleaseDC', [W(0), W(dc)]);

  const cx = (await pm.user('GetSystemMetrics', [W(11)])) & 0xffff;
  const cy = (await pm.user('GetSystemMetrics', [W(12)])) & 0xffff;

  return { cx, cy, bitsPixel: bitsPixel & 0xff, planes: planes & 0xff };
}

/**
 * seg4 `17ae`: a group's icons made again where the display is not the one
 * they were made for -- `SYSTEM.INI`'s `[boot]` `display.drv=` not
 * `PROGMAN.INI`'s `[Settings]` `display.drv=` (`lstrcmp`), or the header's
 * icon format or size not the screen's: each item's icon extracted again from
 * its path (`GroupFile.refreshIcons`) and the file written where it may be.
 * An item left with no icon sets `[34h]`.
 */
async function displayCheck(pm: Pm, key: number) {
  const block = await lock(pm, key);

  if (!block) {
    return;
  }

  const display = await pm.profileString('Boot', 'display.drv', 0x81, groups(pm).systemIni);
  const mine = await pm.profileString('Settings', 'display.drv', 0x28, INI);
  const differs = ((await pm.user('lstrcmp', [string(display), string(mine)])) & 0xffff) !== 0;
  const screen = await metrics(pm);
  const data = block.data;
  const same =
    data[0x1c] === screen.bitsPixel &&
    data[0x1d] === screen.planes &&
    word(data, 0x18) === screen.cx &&
    word(data, 0x1a) === screen.cy;

  if (!differs && same) {
    return;
  }

  const slots: { def: number; path: string; index: number }[] = [];

  for (let slot = 0; slot < word(data, 0x20); slot++) {
    const def = block.def(slot);

    if (def) {
      slots.push({ def, path: cString(data, word(data, def + 0x16)), index: word(data, def + 4) });
    }
  }

  /* The icons extracted first, each as the refresh asks for it, then put in
   * the block in that order. */
  const extracted = [];

  for (const { path, index } of slots) {
    extracted.push(await extract(pm, path, index));
  }

  let next = 0;

  block.refreshIcons(screen, () => extracted[next++] ?? null);

  if (slots.some(({ def }) => word(block.data, def + 6) === 0)) {
    pm.sd16(D_LOST_ICONS, 1);
  }

  if (await writable(pm, key)) {
    await write(pm, key);
  }
}

/**
 * Unloading a group (seg4 `1f9a`): its window destroyed by `WM_MDIDESTROY`,
 * its block, path and items let go, and it taken out of the list -- but
 * `[13Eh]` left as it was, so where it was the last, the next group loaded is
 * linked to it and to nothing reachable (`2010`-`202f`;
 * `kb/topics/program-manager-dde.md`, Reload).
 */
export async function unload(pm: Pm, hwnd: number) {
  const key = await keyOf(pm, hwnd);

  await pm.send(pm.d16(D_CLIENT), WM_MDIDESTROY, hwnd, 0);
  unlink(groups(pm), key);
  groups(pm).map.delete(key);
}

/**
 * `DeleteGroup` (seg4 `23af`): its window destroyed, its file deleted (DOS 41h
 * on its OEM path, seg5 `0c1c`), its `GroupN=` written away, and it taken out
 * of the list, `[13Eh]` mended where it was the last and `[13Ch]` nought where
 * it was current. `Order=` is not written.
 */
export async function remove(pm: Pm, hwnd: number) {
  const key = await keyOf(pm, hwnd);
  const found = group(pm, key);

  if (!found) {
    return;
  }

  await pm.send(pm.d16(D_CLIENT), WM_MDIDESTROY, hwnd, 0);
  await dosPath(pm, 0x4100, await oem(pm, found.path));
  await pm.kernel('WritePrivateProfileString', [
    string('Groups'),
    string(`Group${(found.n << 16) >> 16}`),
    D(0),
    string(INI),
  ]);

  const all = groups(pm);
  const before = unlink(all, key);

  if (all.tail === key) {
    all.tail = before ?? 0;
  }

  if (all.current === key) {
    all.current = 0;
  }

  all.map.delete(key);
}

/** Renaming (seg4 `248b`): the window's title, and the block's name taken out and added again (`GroupFile.rename`), the file written. */
export async function rename(pm: Pm, hwnd: number, name: string) {
  const key = await keyOf(pm, hwnd);
  const block = await lock(pm, key);

  if (!block) {
    return;
  }

  await pm.user('SetWindowText', [W(hwnd), string(name)]);
  block.rename(name);
  await write(pm, key);
}

/**
 * A group file's name made from a group's name (seg4 `0ea5`): its first eight
 * letters and digits (`IsCharAlphaNumeric`) and `.GRP`, made one no file has
 * (`0d92`); empty where it has none.
 */
export async function fileName(pm: Pm, name: string): Promise<string> {
  let made = '';

  for (const character of name) {
    if (made.length >= 8) {
      break;
    }

    if ((await pm.user('IsCharAlphanumeric', [W(character.charCodeAt(0) & 0xff)])) & 0xffff) {
      made += character;
    }
  }

  return made ? unique(pm, `${made}.GRP`) : '';
}

/** `OpenFile` with `OF_EXIST | OF_SHARE_DENY_NONE`: the path it found, or null. */
async function exists(pm: Pm, path: string): Promise<string | null> {
  const called = await pm.call('KERNEL', 'OpenFile', [string(path), buffer(0x88), W(0x4040)]);

  return (called.value & 0xffff) === 0xffff ? null : cString(Uint8Array.from(called.buffers[1]), 8);
}

/**
 * seg4 `0d92`: while `OpenFile` finds the name, its eighth letter (or the
 * place of its dot, or its end) becomes `0`, the extension the found file's
 * kept after it, then `1` and on, `9` followed by `A`.
 */
async function unique(pm: Pm, name: string): Promise<string> {
  let place: number | null = null;
  let found: string | null;

  while ((found = await exists(pm, name)) !== null) {
    if (place !== null) {
      let code = name.charCodeAt(place) + 1;

      if (code === 0x3a) {
        code = 0x41;
      }

      name = name.slice(0, place) + String.fromCharCode(code) + name.slice(place + 1);
      continue;
    }

    let count = 0;
    let at: number | null = null;

    for (let index = 0; index < name.length; index++) {
      const character = name[index];

      if (character === '\\' || character === ':') {
        count = 0;
        at = null;
      } else if (character === '.') {
        at ??= index;
      } else if (at !== null) {
        /* past the place */
      } else if (count >= 7) {
        at = index;
      } else {
        count++;
      }
    }

    const cut = at ?? name.length;
    const dot = found.lastIndexOf('.');
    const extension = dot >= 0 && !/[\\:]/.test(found.slice(dot)) ? found.slice(dot) : '';

    name = `${name.slice(0, cut)}0${extension}`;
    place = cut;
  }

  return name;
}

/** seg4 `2044`: a path given to `CreateGroup` with its spaces made `_`, and `.GRP` added where its last name has no dot. */
function givenPath(path: string) {
  const made = path.replace(/ /g, '_');
  let dot = false;

  for (const character of made) {
    if (character === '.') {
      dot = true;
    } else if (character === ':' || character === '\\') {
      dot = false;
    }
  }

  return dot ? made : `${made}.GRP`;
}

/**
 * `CreateGroup`'s making of a group (seg4 `210e`): refused at forty groups'
 * windows (`214e`); given a path, a file there loaded under the name unless a
 * group has it already (`20be`), else made there; given none, made in a file
 * named from the name (`0ea5`). A file is made as a new group's block
 * (`2178`-`22b4`), its path by `OpenFile`'s `OF_PARSE`, `_lcreat` and
 * `_lwrite` whole; then loaded (`1d4d`), renamed to the name (`248b`), and
 * `PROGMAN.INI`'s groups written (`2662`) whether or not it loaded. Its
 * window, or nought.
 */
export async function create(pm: Pm, name: string, given: string): Promise<number> {
  if ((await windowsTopDown(pm)).length >= 40) {
    return 0;
  }

  let path: string;

  if (given) {
    path = givenPath(given);

    const found = await exists(pm, path);

    if (found !== null) {
      const full = await ansi(pm, found);

      return (await loadedFrom(pm, full)) ? 0 : made(pm, name, full);
    }
  } else {
    path = await fileName(pm, name);
  }

  const block = GroupFile.create(name, await metrics(pm));
  const bytes = block.bytes();
  const parsed = await pm.call('KERNEL', 'OpenFile', [string(path), buffer(0x88), W(0x100)]);

  if ((parsed.value & 0xffff) === 0xffff) {
    return 0;
  }

  const full = await ansi(pm, cString(Uint8Array.from(parsed.buffers[1]), 8));
  const file = (await pm.kernel('_lcreat', [string(full), W(0)])) & 0xffff;

  if (file === 0xffff) {
    return 0;
  }

  const written = await writeBytes(pm, file, bytes);

  await pm.kernel('_lclose', [W(file)]);

  if (written !== (bytes.length & 0xffff)) {
    return 0;
  }

  return made(pm, name, full);
}

/** seg4 `20be`: whether a group's window has a group whose path is this one (`lstrcmpi`). */
async function loadedFrom(pm: Pm, path: string) {
  for (const hwnd of await windowsTopDown(pm)) {
    const found = group(pm, await keyOf(pm, hwnd));

    if (found && ((await pm.user('lstrcmpi', [string(path), string(found.path)])) & 0xffff) === 0) {
      return true;
    }
  }

  return false;
}

/** seg4 `2353`-`23a0`: a group's file loaded, renamed where a name is given, and the profile's groups written. */
async function made(pm: Pm, name: string, path: string) {
  pm.sd16(D_SAVE_ERRORS, 0);
  pm.sd16(D_LOST_ICONS, 0);

  const hwnd = await load(pm, path, 0);

  if (hwnd && name) {
    await rename(pm, hwnd, name);
  }

  await writeProfile(pm);

  return hwnd;
}

/**
 * `PROGMAN.INI`'s groups (seg4 `2662`-`2826`): the groups' windows from the
 * bottom up, each one's path -- one made from its name where it has none
 * (`0ea5`) -- through `OpenFile`'s `OF_PARSE`, made ANSI and written as
 * `[Groups]` `GroupN=`, a space and N added to `Order=`, a 41st stopping it;
 * then `[Settings]` `Order=`; nothing at all where the client has no child.
 */
export async function writeProfile(pm: Pm) {
  let order = '';
  let count = 0;

  /* With no child at all, nothing is written, `Order=` neither
   * (`2695`-`26a2`). */
  if (!((await pm.user('GetWindow', [W(pm.d16(D_CLIENT)), W(5)])) & 0xffff)) {
    return;
  }

  for (const hwnd of await windowsBottomUp(pm)) {
    if (count > 40) {
      await pm.user('MessageBeep', [W(0)]);
      break;
    }

    const key = await keyOf(pm, hwnd);
    const found = group(pm, key);

    if (!found) {
      continue;
    }

    if (!found.path) {
      const block = await lock(pm, key);

      if (!block) {
        continue;
      }

      const path = await fileName(pm, cString(block.data, word(block.data, 0x16)));

      if (!path) {
        await pm.user('MessageBeep', [W(0)]);
        continue;
      }

      found.path = path;
    }

    const parsed = await pm.call('KERNEL', 'OpenFile', [
      string(found.path),
      buffer(0x88),
      W(0x100),
    ]);

    if ((parsed.value << 16) >> 16 >= 0) {
      const full = await ansi(pm, cString(Uint8Array.from(parsed.buffers[1]), 8));
      const n = (found.n << 16) >> 16;

      order += ` ${n}`;
      await pm.kernel('WritePrivateProfileString', [
        string('Groups'),
        string(`Group${n}`),
        string(full),
        string(INI),
      ]);
      count++;
    } else {
      await pm.user('MessageBeep', [W(0)]);
    }
  }

  await pm.kernel('WritePrivateProfileString', [
    string('Settings'),
    string('Order'),
    string(order),
    string(INI),
  ]);
}

/** A `WINDOWPLACEMENT` to be filled: its length, 16h. */
export const placementBuffer = () => [0x16, ...new Array(0x15).fill(0)];

/**
 * `ExitProgman(1)` and `WM_CLOSE`'s saving (seg4 `2845`): nothing with
 * `NoSaveSettings`; else `Window=` from the frame's `GetWindowPlacement`, a
 * show command of 7 written as 1; the profile's groups unless `[1Eh]`; and
 * each group from the bottom up given its window's place and its items'
 * (`2518`) and its file written.
 *
 * Not followed: the hourglass cursor shown meanwhile.
 */
export async function save(pm: Pm) {
  if (pm.d16(D_NO_SAVE_SETTINGS)) {
    return;
  }

  pm.sd16(D_SAVE_ERRORS, 0);

  const placement = (
    await pm.call('USER', 'GetWindowPlacement', [W(pm.d16(D_FRAME)), B(placementBuffer())])
  ).buffers[0];
  const at = (offset: number) => ((placement[offset] | (placement[offset + 1] << 8)) << 16) >> 16;
  const show = at(4) === 7 ? 1 : at(4);

  await pm.kernel('WritePrivateProfileString', [
    string('Settings'),
    string('Window'),
    string(`${at(0x0e)} ${at(0x10)} ${at(0x12)} ${at(0x14)} ${show}`),
    string(INI),
  ]);

  if (!pm.d16(D_INI_READ_ONLY)) {
    await writeProfile(pm);
  }

  for (const hwnd of await windowsBottomUp(pm)) {
    await saveGroup(pm, hwnd);
    await write(pm, await keyOf(pm, hwnd));
  }
}

/**
 * seg4 `2518`: a group's window's place into its block -- `nCmdShow`,
 * `rcNormal` and `ptMin` from `GetWindowPlacement` -- and each item's, the
 * slots made the window's order (`GroupFile.save`).
 */
async function saveGroup(pm: Pm, hwnd: number) {
  const key = await keyOf(pm, hwnd);
  const block = await lock(pm, key);

  if (!block) {
    return;
  }

  const placement = (await pm.call('USER', 'GetWindowPlacement', [W(hwnd), B(placementBuffer())]))
    .buffers[0];
  const at = (offset: number) => ((placement[offset] | (placement[offset + 1] << 8)) << 16) >> 16;
  const found = group(pm, key);

  if (!found) {
    return;
  }

  const slots = block.save(
    {
      show: at(4) & 0xffff,
      rcNormal: [at(0x0e), at(0x10), at(0x12), at(0x14)],
      ptMin: [at(6), at(8)],
    },
    found.items.map((item) => ({ slot: item.slot, x: item.icon[0], y: item.icon[1] }))
  );

  found.items.forEach((item, index) => {
    item.slot = slots[index];
  });
}

/**
 * The Reload command with no group (seg7 `09b3`-`0a1f`): the MDI client
 * hidden, the frame validated, each group unloaded, the groups loaded again
 * from `PROGMAN.INI` (seg3 `0809`) and the client shown.
 */
export async function reloadAll(pm: Pm) {
  await pm.user('ShowWindow', [W(pm.d16(D_CLIENT)), W(0)]);
  await pm.user('ValidateRect', [W(pm.d16(D_FRAME)), D(0)]);

  for (;;) {
    const [first] = await windowsTopDown(pm);

    if (first === undefined) {
      break;
    }

    await unload(pm, first);
  }

  await loadGroups(pm, groups(pm).systemIni);
  await pm.user('ShowWindow', [W(pm.d16(D_CLIENT)), W(5)]);
}
