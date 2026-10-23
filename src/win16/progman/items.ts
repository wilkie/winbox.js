'use strict';

import { B, D, W, buffer, stringOf } from '../commdlg/api.js';
import { cString, storeCommand } from '../../layers/groups.js';
import {
  type Pm,
  D_ACROSS,
  D_BORDER_X,
  D_BORDER_Y,
  D_CELL_X,
  D_CELL_Y,
  D_CREATING,
  D_DOWN,
  D_INSTANCE,
  D_SCROLLING,
  D_TITLE_FONT,
  D_TITLE_WRAP,
  bytesOf,
  latin,
  string,
} from './main.js';
import { type Loaded, group, keyOf, lock, placementBuffer, writable, write } from './loaded.js';

/**
 * A group's items: made from its file (seg4 `1735`), made by `AddItem`
 * (`CreateNewItem`, seg4 `105d`), placed (seg2 `1325`), taken out (seg4
 * `15a8`), and the group window's scroll bars made to fit them (seg2 `0b04`),
 * as `PROGMAN.EXE` does each. As `crates/winbox-win16/src/progman/items.rs`.
 *
 * `PROGMAN.EXE` keeps an item in memory as a structure of 16h bytes (seg4
 * `0f27`): the next, its slot, the instance of the program it started, its
 * icon's rectangle in the group's window and its title's. Its place is the
 * icon's top left, which saving writes to the file (seg4 `2518`) and a
 * group's text answers (seg7 `1337`).
 */

type Rect = [number, number, number, number];

/** An item in memory. */
export interface Item {
  /** `[+2]`: its slot in the group's table. */
  slot: number;
  /** `[+6]`: its icon's rectangle, left, top, right, bottom. */
  icon: Rect;
  /** `[+0Eh]`: its title's. */
  title: Rect;
}

/** A signed 16-bit number. */
const s16 = (value: number) => (value << 16) >> 16;

/** Half of a number as the file halves one: toward nought. */
const half = (value: number) => s16(Math.trunc(s16(value) / 2));

const word = (data: ArrayLike<number>, at: number) => (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);

const rectBytes = (rect: Rect) => rect.flatMap((value) => [value & 0xff, (value >> 8) & 0xff]);

const rectOf = (bytes: number[], at = 0): Rect =>
  [0, 2, 4, 6].map((offset) => s16(word(bytes, at + offset))) as Rect;

/** `UnionRect` or `IntersectRect` of two rectangles, by USER as the file calls it: the rectangle, and USER's answer. */
async function combined(pm: Pm, name: string, a: Rect, b: Rect): Promise<[Rect, boolean]> {
  const called = await pm.call('USER', name, [buffer(8), B(rectBytes(a)), B(rectBytes(b))]);

  return [rectOf(called.buffers[0]), (called.value & 0xffff) !== 0];
}

/** The metrics start-up keeps (seg3 `0a43`-`0aea`). */
function spacing(pm: Pm) {
  return {
    cellX: s16(pm.d16(D_CELL_X)),
    cellY: s16(pm.d16(D_CELL_Y)),
    borderX: s16(pm.d16(D_BORDER_X)),
    borderY: s16(pm.d16(D_BORDER_Y)),
    across: s16(pm.d16(D_ACROSS)),
    down: s16(pm.d16(D_DOWN)),
  };
}

type Spacing = ReturnType<typeof spacing>;

/** seg2 `1291`: the cell an icon at a place takes, its spacing wide and high, centred across on the icon, less the scroll positions. */
function cell(s: Spacing, x: number, y: number, h: number, v: number): Rect {
  const left = s16(half(s.cellX - s.across) - h + x);
  const top = s16(y - v);

  return [left, top, s16(left + s.across - 1), s16(top + s.down - 1)];
}

/** seg2 `12cc`: whether an item's cell meets the cell, those whose icon's left is -1 -- the one being placed -- passed over. */
async function overlaps(pm: Pm, items: Item[], wanted: Rect, h: number, v: number) {
  const s = spacing(pm);

  for (const item of items) {
    if (item.icon[0] === -1) {
      continue;
    }

    if (
      (await combined(pm, 'IntersectRect', cell(s, item.icon[0], item.icon[1], h, v), wanted))[1]
    ) {
      return true;
    }
  }

  return false;
}

/** A scroll bar's position less its range's start. */
async function scrolled(pm: Pm, hwnd: number, bar: number) {
  const position = s16(await pm.user('GetScrollPos', [W(hwnd), W(bar)]));
  const range = await pm.call('USER', 'GetScrollRange', [W(hwnd), W(bar), buffer(2), buffer(2)]);

  return s16(position - s16(word(range.buffers[0], 0)));
}

/**
 * seg2 `1325`: an item's icon and title rectangles. At -1 across, the first
 * place where there is room: from half the spacing less half a cell and two
 * borders across, the top less the scroll positions, a spacing on each time,
 * a row down where the next would pass the client area's right -- the
 * restored window's rectangle where it is minimized -- until no other item's
 * cell meets its cell. The icon a cell's size at the place; its title as
 * `DrawText` measures the name in the icons' title font, a spacing less four
 * borders wide, wrapped where `IconTitleWrap` is on, two borders more each
 * way, centred beneath the icon.
 */
async function place(pm: Pm, key: number, item: Item, x: number, y: number, name: string) {
  const s = spacing(pm);
  const found = group(pm, key);

  if (!found) {
    return;
  }

  const hwnd = found.hwnd;

  if (x === -1) {
    const style = (await pm.user('GetWindowLong', [W(hwnd), W(0xfff0)])) >>> 0;
    let client: Rect;

    if (style & 0x20000000) {
      const placement = (
        await pm.call('USER', 'GetWindowPlacement', [W(hwnd), B(placementBuffer())])
      ).buffers[0];
      const normal = rectOf(placement, 0x0e);

      client = [0, 0, s16(normal[2] - normal[0]), s16(normal[3] - normal[1])];
    } else {
      client = rectOf((await pm.call('USER', 'GetClientRect', [W(hwnd), buffer(8)])).buffers[0]);
    }

    const h = style & 0x00100000 ? await scrolled(pm, hwnd, 0) : 0;
    const v = style & 0x00200000 ? await scrolled(pm, hwnd, 1) : 0;
    const first = s16(half(s.across - s.cellX) - h + s.borderX);

    x = first;
    y = s16(-v);
    item.icon[0] = -1;

    for (;;) {
      const wanted = cell(s, x, y, h, v);

      if (!(await overlaps(pm, group(pm, key)?.items ?? [], wanted, h, v))) {
        break;
      }

      if (s16(wanted[2] + s.across) > client[2]) {
        x = first;
        y = s16(y + s.down);
      } else {
        x = s16(x + s.across);
      }
    }
  }

  const icon: Rect = [x, y, s16(x + s.cellX), s16(y + s.cellY)];
  const dc = (await pm.user('GetDC', [W(hwnd)])) & 0xffff;
  const old =
    (await pm.call('GDI', 'SelectObject', [W(dc), W(pm.d16(D_TITLE_FONT))])).value & 0xffff;
  const flags = 0x0c10 | (pm.d16(D_TITLE_WRAP) ? 0 : 0x20);
  const measured = await pm.call('USER', 'DrawText', [
    W(dc),
    string(name),
    W(0xffff),
    B(rectBytes([0, 0, s16(s.across - s.borderX * 2), 0])),
    W(flags),
  ]);
  const title = rectOf(measured.buffers[1]);

  if (old) {
    await pm.call('GDI', 'SelectObject', [W(dc), W(old)]);
  }

  await pm.user('ReleaseDC', [W(hwnd), W(dc)]);
  title[2] = s16(title[2] + s.borderX * 2);
  title[3] = s16(title[3] + s.borderY * 2);

  const dx = s16(half(s.cellX) + half(title[0] - title[2]) + x);
  const dy = s16(y - s.borderY + s.cellY);

  item.icon = icon;
  item.title = [s16(title[0] + dx), s16(title[1] + dy), s16(title[2] + dx), s16(title[3] + dy)];
}

/**
 * seg2 `0863`: an item's icon and title invalidated in its group's window.
 *
 * Not followed: the gathering where `[16h]` is set (`[65Ch]`), for painting a
 * window that is never shown.
 */
async function invalidate(pm: Pm, loaded: Loaded, item: Item | undefined) {
  if (!item) {
    return;
  }

  const [both] = await combined(pm, 'UnionRect', item.icon, item.title);

  if (!pm.d16(D_CREATING)) {
    await pm.user('InvalidateRect', [W(loaded.hwnd), B(rectBytes(both)), W(1)]);
  }
}

/**
 * seg4 `0f09`: an item put in memory for a slot, first or last in the group's
 * order, and placed where its file's place says (`1325`). Whether it was.
 */
async function made(pm: Pm, key: number, slot: number, first: boolean) {
  const block = await lock(pm, key);
  const found = group(pm, key);

  if (!block || !found) {
    return false;
  }

  const item: Item = { slot, icon: [0, 0, 0, 0], title: [0, 0, 0, 0] };

  if (first) {
    await invalidate(pm, found, found.items[0]);
    found.items.unshift(item);
  } else {
    found.items.push(item);
  }

  const def = block.def(slot);
  const data = block.data;

  await place(
    pm,
    key,
    item,
    s16(word(data, def)),
    s16(word(data, def + 2)),
    cString(data, word(data, def + 0x12))
  );
  await invalidate(pm, found, item);

  return true;
}

/**
 * seg4 `1735`: a group's items made from its slots, the last first, each put
 * first; then its scroll bars fitted (seg2 `0b04`) unless it is being made.
 *
 * Not followed: arranging them where `AutoArrange` is on (seg2 `1d87`).
 */
export async function makeItems(pm: Pm, key: number) {
  const block = await lock(pm, key);

  if (!block) {
    return;
  }

  for (let slot = word(block.data, 0x20) - 1; slot >= 0; slot--) {
    if (block.def(slot)) {
      await made(pm, key, slot, true);
    }
  }

  await fitted(pm, key);
}

/** After items change (seg7 `0728`-`0756`, seg4 `16f2`-`171a`, `177f`): the scroll bars fitted unless the group is being made; arranging where `AutoArrange` is on is not followed. */
export async function fitted(pm: Pm, key: number) {
  const found = group(pm, key);

  if (!pm.d16(D_CREATING) && found) {
    await scrollBars(pm, found.hwnd);
  }
}

/** A window's client rectangle were its style the one given (seg2 `0a9c`): the style set, its window rectangle in its own client's coordinates, `WM_NCCALCSIZE`. */
async function clientWith(pm: Pm, hwnd: number, style: number): Promise<Rect> {
  await pm.user('GetWindowLong', [W(hwnd), W(0xfff0)]);
  await pm.user('SetWindowLong', [W(hwnd), W(0xfff0), D(style)]);

  const rect = (await pm.call('USER', 'GetWindowRect', [W(hwnd), buffer(8)])).buffers[0];

  for (const at of [0, 4]) {
    const point = (await pm.call('USER', 'ScreenToClient', [W(hwnd), B(rect.slice(at, at + 4))]))
      .buffers[0];

    rect.splice(at, 4, ...point);
  }

  return rectOf(
    (await pm.call('USER', 'SendMessage', [W(hwnd), W(0x83), W(0), B(rect)])).buffers[0]
  );
}

/**
 * seg2 `0b04`: a group window's scroll bars made to fit its items, unless it
 * is an icon or this is already under way (`[15Ch]`). The items' extent --
 * each icon, and its title as wide as the icon -- its left less half a
 * cell's overhang and two borders; each bar added while the extent passes the
 * client area the style so far would leave; where the style changes, or a
 * bar's position is not nought or its range not the extent less the client
 * area, both positions made nought, both ranges set and the frame drawn
 * again.
 */
export async function scrollBars(pm: Pm, hwnd: number) {
  if (pm.d16(D_SCROLLING) || (await pm.user('IsIconic', [W(hwnd)])) & 0xffff) {
    return;
  }

  pm.sd16(D_SCROLLING, 1);

  const s = spacing(pm);
  const items = group(pm, await keyOf(pm, hwnd))?.items ?? [];
  let extent: Rect = [0, 0, 0, 0];

  if (items.length) {
    for (const item of items) {
      [extent] = await combined(pm, 'UnionRect', extent, item.icon);
      [extent] = await combined(pm, 'UnionRect', extent, [
        item.icon[0],
        item.title[1],
        item.icon[2],
        item.title[3],
      ]);
    }

    if (extent[2] !== extent[0]) {
      extent[0] = s16(extent[0] + half(s.cellX - s.across) - s.borderX);
    }
  }

  const original = (await pm.user('GetWindowLong', [W(hwnd), W(0xfff0)])) >>> 0;
  let style = (original & ~0x00300000) >>> 0;
  let client: Rect;

  for (;;) {
    const before = style;

    client = await clientWith(pm, hwnd, style);

    if (extent[0] < client[0] || extent[2] > client[2]) {
      style = (style | 0x00100000) >>> 0;
    }

    if (extent[1] < client[1] || extent[3] > client[3]) {
      style = (style | 0x00200000) >>> 0;
    }

    if (style === before) {
      break;
    }
  }

  if (style === original && !(style & 0x00300000)) {
    pm.sd16(D_SCROLLING, 0);
    return;
  }

  const [range] = await combined(pm, 'UnionRect', client, extent);

  range[2] = s16(range[2] + client[0] - client[2]);
  range[3] = s16(range[3] + client[1] - client[3]);

  let set = style !== original;

  for (const [bar, flag, low, high] of [
    [0, 0x00100000, range[0], range[2]],
    [1, 0x00200000, range[1], range[3]],
  ]) {
    if (set || !(style & flag)) {
      continue;
    }

    if ((await pm.user('GetScrollPos', [W(hwnd), W(bar)])) & 0xffff) {
      set = true;
      continue;
    }

    const called = await pm.call('USER', 'GetScrollRange', [W(hwnd), W(bar), buffer(2), buffer(2)]);

    if (s16(word(called.buffers[0], 0)) !== low || s16(word(called.buffers[1], 0)) !== high) {
      set = true;
    }
  }

  if (set) {
    for (const bar of [0, 1]) {
      await pm.user('SetScrollPos', [W(hwnd), W(bar), W(0), W(0)]);
    }

    for (const [bar, low, high] of [
      [0, range[0], range[2]],
      [1, range[1], range[3]],
    ]) {
      await pm.user('SetScrollRange', [W(hwnd), W(bar), W(low), W(high), W(0)]);
    }

    await pm.user('SetWindowPos', [W(hwnd), W(0), W(0), W(0), W(0), W(0), W(0x37)]);
  }

  pm.sd16(D_SCROLLING, 0);
}

/** seg6 `0162`: a path's parts as far as its first space: where its file's name begins, and its last dot where that is within the name. */
function pathParts(path: string): [number, number | null] {
  let file = 0;
  let dot: number | null = null;

  for (let index = 0; index < path.length; index++) {
    const character = path[index];

    if (character === '\0' || character === ' ') {
      break;
    }

    if (character === '\\' || character === ':') {
      file = index + 1;
    } else if (character === '.') {
      dot = index;
    }
  }

  return [file, dot !== null && dot >= file ? dot : null];
}

/** seg6 `01ef`: `.exe` added where the path, to its first space, has no extension and there is room. */
export function withExe(path: string, size: number) {
  return pathParts(path)[1] === null && path.length + 3 < size ? `${path}.exe` : path;
}

/** seg6 `0130`: a string cut at its first space. */
const firstWord = (value: string) => value.split(' ')[0];

/** `DoEnvironmentSubst` of a string in a buffer of 81h, as the file does. */
async function substituted(pm: Pm, value: string) {
  const bytes = [...bytesOf(value), ...new Array(0x81).fill(0)].slice(0, 0x81);

  return latin(stringOf(await pm.call('SHELL', 'DoEnvironmentSubst', [B(bytes), W(0x81)]), 0));
}

/** An icon extracted: the index written back and `DumpIcon`'s three blocks. */
export interface Extracted {
  iconIndex: number;
  header: Uint8Array;
  and: Uint8Array;
  xor: Uint8Array;
}

/**
 * An icon as `CreateNewItem` and the display check take one (seg4
 * `11ac`-`122c`, `195c`-`19e1`): the path's environment variables put in,
 * `.exe` added and cut at its first space; `ExtractAssociatedIcon` with the
 * index, `LockResource` and `DumpIcon`; the icon's header, AND and XOR planes
 * copied, the index written back; and the icon let go. Null where
 * `ExtractAssociatedIcon` has none.
 */
export async function extract(pm: Pm, path: string, index: number): Promise<Extracted | null> {
  const bytes = [...bytesOf(firstWord(withExe(await substituted(pm, path), 0x81)))];

  bytes.push(...new Array(0x81 - bytes.length).fill(0));

  const called = await pm.call('SHELL', 'ExtractAssociatedIcon', [
    W(pm.d16(D_INSTANCE)),
    B(bytes.slice(0, 0x81)),
    B([index & 0xff, (index >> 8) & 0xff]),
  ]);
  const icon = called.value & 0xffff;
  const written = word(called.buffers[1], 0);

  if (!icon) {
    return null;
  }

  const at = (await pm.kernel('LockResource', [W(icon)])) >>> 0;
  const dumped = await pm.call('USER', 'DumpIcon', [D(at), buffer(2), buffer(4), buffer(4)]);
  const far = (bytes: number[]) => ((word(bytes, 2) << 16) | word(bytes, 0)) >>> 0;
  const extracted: Extracted = {
    iconIndex: written,
    header: Uint8Array.from(pm.readFar(at, word(dumped.buffers[0], 0))),
    and: Uint8Array.from(pm.readFar(far(dumped.buffers[1]), dumped.value & 0xffff)),
    xor: Uint8Array.from(pm.readFar(far(dumped.buffers[2]), dumped.value >>> 16)),
  };

  await pm.kernel('GlobalUnlock', [W(icon)]);
  await pm.user('DestroyIcon', [W(icon)]);

  return extracted;
}

/** What `AddItem` gives `CreateNewItem` (seg7 `06ed`-`071c`). */
export interface Adding {
  name: string;
  command: string;
  iconPath: string;
  directory: string;
  hotKey: number;
  minimized: boolean;
  iconIndex: number;
  place: [number, number] | null;
  first: boolean;
}

/**
 * `CreateNewItem` (seg4 `105d`): nothing where the group's file is read-only;
 * the icon extracted; the item put in the block (`GroupFile.addItem`: its
 * slot, `ITEMDEF`, name, the command stored with the directory
 * (`storeCommand`), icon path, the icon, its place as given or -1, -1, and its
 * tags); then put in memory and placed (`0f09`), its place written into its
 * `ITEMDEF`, and the file written. Where any of it fails the block is let go,
 * to be read again from the file (`157c`-`1589`). Whether it was made.
 *
 * Not followed: an icon `ExtractAssociatedIcon` gives none of, which the file
 * reads at nought -- here the item is not made.
 */
export async function create(pm: Pm, hwnd: number, adding: Adding): Promise<boolean> {
  const key = await keyOf(pm, hwnd);
  const stored = storeCommand(adding.command, adding.directory);

  if (!group(pm, key) || !(await writable(pm, key))) {
    return false;
  }

  const icon = await extract(pm, adding.iconPath, adding.iconIndex);

  if (!icon) {
    return false;
  }

  const block = await lock(pm, key);

  if (!block) {
    return false;
  }

  const [x, y] = adding.place ?? [-1, -1];
  const added = block.addItem({
    name: adding.name,
    stored: stored.stored,
    iconPath: adding.iconPath,
    iconIndex: icon.iconIndex,
    header: icon.header,
    and: icon.and,
    xor: icon.xor,
    x,
    y,
    hotKey: adding.hotKey,
    minimized: adding.minimized,
    programDirectory: stored.programDirectory,
  });

  if ('error' in added) {
    discard(pm, key);
    return false;
  }

  const slot = added.slot;

  if (!(await made(pm, key, slot, adding.first))) {
    discard(pm, key);
    return false;
  }

  const found = group(pm, key);
  const item = found?.items.find((each) => each.slot === slot);

  if (found?.block && item) {
    const def = found.block.def(slot);

    found.block.setWord(def, item.icon[0] & 0xffff);
    found.block.setWord(def + 2, item.icon[1] & 0xffff);

    if (await write(pm, key)) {
      return true;
    }
  }

  await forgetItem(pm, key, slot);
  discard(pm, key);

  return false;
}

/** The block let go, to be read again from the file (`GlobalReAlloc` to nought). */
function discard(pm: Pm, key: number) {
  const found = group(pm, key);

  if (found) {
    found.block = null;
  }
}

/** seg4 `0000`: an item taken out of memory: it invalidated, and the next where it was the first. */
async function forgetItem(pm: Pm, key: number, slot: number) {
  const found = group(pm, key);
  const at = found ? found.items.findIndex((item) => item.slot === slot) : -1;

  if (!found || at < 0) {
    return;
  }

  await invalidate(pm, found, found.items[at]);

  if (at === 0) {
    await invalidate(pm, found, found.items[1]);
  }

  found.items.splice(at, 1);
}

/**
 * seg4 `15a8`: an item deleted: where the file may be written, its blocks and
 * tags taken out (`GroupFile.deleteItem`), it taken out of memory, the scroll
 * bars fitted and the file written.
 */
export async function remove(pm: Pm, key: number, slot: number) {
  const found = group(pm, key);

  if (!found) {
    return;
  }

  if (!(await writable(pm, key))) {
    await invalidate(
      pm,
      found,
      found.items.find((item) => item.slot === slot)
    );
    return;
  }

  found.block?.deleteItem(slot);
  await forgetItem(pm, key, slot);
  await fitted(pm, key);
  await write(pm, key);
}

/**
 * seg5 `00ed`: an item's name from its command: the file's name after the
 * last `\`, to the last dot or the end, 40 characters at most -- the cut a
 * nought written into the command -- made upper case and then all but its
 * first letter lower (`AnsiUpper`, `AnsiLower`). The name, and the command as
 * it is left.
 */
export async function nameOf(pm: Pm, command: string): Promise<[string, string]> {
  const file = command.lastIndexOf('\\') + 1;
  const dot = command.lastIndexOf('.');
  let name = dot >= file ? command.slice(file, dot) : command.slice(file);

  if (name.length > 40) {
    name = name.slice(0, 40);

    if (file + 40 < command.length) {
      command = command.slice(0, file + 40);
    }
  }

  name = latin(stringOf(await pm.call('USER', 'AnsiUpper', [string(name)]), 0));

  if (name.length > 1) {
    name =
      name[0] + latin(stringOf(await pm.call('USER', 'AnsiLower', [string(name.slice(1))]), 0));
  }

  return [name, command];
}

/**
 * seg6 `0398`: an item's directory from its command: the command's path to
 * its first space, but its file's name and the `\` before it -- kept for a
 * root -- and nothing for a network path or a command with no path.
 */
export function directoryOf(command: string) {
  const [file] = pathParts(command);

  if (command.startsWith('\\\\') || file === 0) {
    return '';
  }

  return (file <= 3 && command[1] === ':') || file === 1
    ? command.slice(0, file)
    : command.slice(0, file - 1);
}

/**
 * `AddItem`'s defaults, after its arguments are read (seg7 `04ba`-`069d`): the
 * command's environment variables put in and cut at its first space for
 * finding its program; the directory's, where it is given; else the command's
 * directory; and with no icon path, `FindExecutable`'s answer for the command
 * in that directory.
 */
export async function defaults(pm: Pm, adding: Adding, givenDirectory: boolean) {
  const program = firstWord(await substituted(pm, adding.command));
  let directory = givenDirectory ? firstWord(await substituted(pm, adding.directory)) : '';

  if (!adding.directory) {
    adding.directory = directoryOf(adding.command);
    directory = adding.directory;
  }

  if (!adding.iconPath) {
    adding.iconPath = latin(
      stringOf(
        await pm.call('SHELL', 'FindExecutable', [
          string(program),
          string(directory),
          buffer(0x81),
        ]),
        2
      )
    );
  }
}
