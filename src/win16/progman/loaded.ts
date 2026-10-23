'use strict';

import { D, W, text } from '../commdlg/api.js';
import { type Group, readGroup } from '../../layers/groups.js';
import { type Pm, bytesOf } from './main.js';

/**
 * The groups an instance has loaded, as the group model holds them
 * (`src/layers/groups.ts`): what Program Manager's DDE reads -- the group
 * list, a group's text, its items -- until its groups are windows of their
 * own. As `crates/winbox-win16/src/progman/loaded.rs`.
 *
 * `PROGMAN.EXE` keeps a group as a structure in its data segment (seg4
 * `1d8a`: the next, its MDI child, its block, its items, its file's path and
 * its number), the groups linked in the order they were loaded (`[13Ah]` the
 * first, `[13Eh]` the last) and `[13Ch]` the current one, and asks each child
 * window for its title, place and state. WinBox's has no group windows yet: a
 * group here is its number, path and model, in the order loaded, and its
 * window's state is what loading would have given it -- `SetWindowPlacement`
 * of the file's `nCmdShow` (seg4 `1f04`-`1f51`) -- with the last loaded
 * current (`1f78`) and on top.
 */

/** A group loaded. */
export interface Loaded {
  /** Its number, `GroupN=`'s. */
  n: number;
  /** Its file's path as `[Groups]` gives it (`[si+8]`). */
  path: string;
  group: Group;
}

/** An instance's groups. */
export interface Groups {
  /** In the order loaded (`[13Ah]`'s list). */
  list: Loaded[];
  /** `[13Ch]`, an index into `list`. */
  current: number | null;
}

/** Its window's title: the group's name (`1efd`). */
export const titleOf = (loaded: Loaded) => loaded.group.name;

/** Whether its window is an icon: the file's show command one that minimizes. */
export const iconic = (loaded: Loaded) => [2, 6, 7].includes(loaded.group.show);

/** Whether its window is maximized. */
export const zoomed = (loaded: Loaded) => loaded.group.show === 3;

/**
 * The groups as the MDI client's children are walked, the top first
 * (`GetWindow(client, GW_CHILD)`, then `GW_HWNDNEXT`): the last loaded on
 * top. Each with its index.
 */
export function topDown(groups: Groups): [number, Loaded][] {
  return groups.list.map((loaded, index) => [index, loaded] as [number, Loaded]).reverse();
}

/** Every instance's groups, by its instance. */
function store(pm: Pm): Map<number, Groups> {
  pm.system._progmanGroups ??= new Map();

  return pm.system._progmanGroups;
}

/** An instance's groups. */
export function groups(pm: Pm): Groups {
  const instance = (pm.ds - 1) & 0xffff;
  let groups = store(pm).get(instance);

  if (!groups) {
    groups = { list: [], current: null };
    store(pm).set(instance, groups);
  }

  return groups;
}

/** An instance's groups let go, as it ends. */
export function forget(pm: Pm) {
  store(pm).delete((pm.ds - 1) & 0xffff);
}

/**
 * A group loaded from its file (seg4 `1d4d`): its number, the lowest not
 * taken where it has none (`1d5c`-`1d6d`); its file read as seg4
 * `01d7`-`02b3` reads it -- `_lopen` with `OF_SHARE_DENY_NONE`, its size by
 * `_llseek` to its end, refused under 24h bytes, `_lread` whole into a global
 * block -- and taken as the model takes it (`readGroup`, which refuses what
 * the file's loader refuses). It becomes the last of the list and the current
 * group.
 *
 * Not yet: the boxes the file shows for a group it cannot load, its window,
 * its icons, and arranging it where `AutoArrange` is on (seg4 `177f`).
 */
export async function load(pm: Pm, n: number, path: string) {
  const list = groups(pm).list;

  if (n === 0) {
    n = 1;

    while (list.some((loaded) => loaded.n === n)) {
      n++;
    }
  }

  const data = await readFile(pm, path);

  if (!data) {
    return;
  }

  let group: Group;

  try {
    group = readGroup(data);
  } catch {
    return;
  }

  list.push({ n, path, group });
  groups(pm).current = list.length - 1;
}

/** A file's bytes, read as the group loader reads it; null where it cannot be opened or is too short to be a group. */
async function readFile(pm: Pm, path: string): Promise<Uint8Array | null> {
  const file = (await pm.kernel('_lopen', [text(bytesOf(path)), W(0x40)])) & 0xffff;

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
