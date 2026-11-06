'use strict';

import { FindResource } from '../kernel/FindResource.js';
import { FreeResource } from '../kernel/FreeResource.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { FreeLibrary, LoadLibrary } from '../kernel/LoadLibrary.js';
import { LoadResource } from '../kernel/LoadResource.js';
import { LockResource } from '../kernel/LockResource.js';
import { OpenFile } from '../kernel/OpenFile.js';
import { MMSYSTEM_STRINGS } from './strings.js';

/**
 * MCI's command tables: `mciLoadCommandResource` and
 * `mciFreeCommandResource`, and the tables MMSYSTEM loads itself. The twin
 * of `mmsystem/mci_tables.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg5 `2c30`-`307e`, `2f4c`, `20dd`-`210b`,
 * `2926`-`29cd`, `3095`); **recorded** by `mmcmd`:
 *
 * * A table is an `RCDATA` resource: commands, each a head (type 0), its
 *   keywords, and an end (3), the list ended by type 6; each entry a string,
 *   a doubleword and a word. Loading one counts its heads: with none, or no
 *   such resource, the answer is FFFFh.
 * * The resource is looked for first in a library named for it -- its name's
 *   first eight characters and `.mci`, if `OpenFile` finds such a file -- and
 *   then in the module given.
 * * Tables are numbered in a list of twenty: the first free place below the
 *   end, else the end. The first table ever loaded is MMSYSTEM's own `core`,
 *   loaded first whatever was asked for: it is table nought.
 * * Freeing nought, or a number at or past the end, answers nought; so does
 *   freeing a table an open device uses. Else the resource is let go -- the
 *   place is free whether it was used or not, so a table freed twice
 *   answers 1 twice -- and the end drawn in by one if it was the last.
 * * A device opened gets its type's table: the first with the device's type
 *   among them, else MMSYSTEM's resource named as its type is (`waveaudio`
 *   for 20Ah). Closing it frees that table before its driver is closed.
 *   `MCIWAVE` loads its own as it is loaded and frees it as it is freed;
 *   it is the device's custom table.
 *
 * WinBox's own modules have no resources: MMSYSTEM's tables and MCIWAVE's
 * are known by their names, as their files have them -- `CORE`,
 * `VIDEODISC`, `WAVEAUDIO`, `CDAUDIO`, `SEQUENCER`, `ANIMATION` and `OVERLAY`;
 * `MCIWAVE` -- each with commands. Their contents are not kept:
 * `mciSendString` reads no table here. Not followed: the core table
 * `mciSendString` loads as it first looks a command up, if no table was ever
 * loaded (seg5 `3095`).
 */

const TABLES_MOST = 20;
const RT_RCDATA = 10;
const OF_EXIST = 0x4000;

/** The tables WinBox's own modules have, by module. */
const OWN_TABLES: Record<string, string[]> = {
  MMSYSTEM: ['CORE', 'VIDEODISC', 'WAVEAUDIO', 'CDAUDIO', 'SEQUENCER', 'ANIMATION', 'OVERLAY'],
  MCIWAVE: ['MCIWAVE'],
};

interface Table {
  /** The resource's memory, nought for a free place; 1 for a table of WinBox's own. */
  resource: number;
  /** A table's library, `.mci`, kept even once freed, as MMSYSTEM keeps it. */
  library: number;
  /** The device type it is for, or nought. */
  type: number;
}

interface Tables {
  tables: Table[];
  core: boolean;
}

function tablesOf(system: any): Tables {
  return (system._mciTables ??= { tables: [], core: false });
}

/** Where a table comes from: a module of WinBox's own, by name, or a module's handle. */
export type Source = { own: string } | { handle: number };

/** A module's handle as a source: one of WinBox's own named, if it is. */
export function sourceOf(system: any, handle: number): Source {
  const item = handle ? system.handles.resolveModule(handle) : null;

  if (item && !item.loader && Array.isArray(item.exports) && item.name) {
    return { own: String(item.name).toUpperCase() };
  }

  return { handle };
}

/** The heads in a table's bytes: its commands. */
function commands(read: (at: number) => number) {
  let count = 0;

  for (let at = 0; ;) {
    while (read(at)) {
      at++;
    }

    const type = read(at + 5) | (read(at + 6) << 8);

    at += 7;

    if (type === 0) {
      count++;
    } else if (type === 6) {
      return count;
    }
  }
}

/** A table found in a module: its resource's memory, or nought. */
async function find(system: any, source: Source, name: string | number) {
  if ('own' in source) {
    const names = OWN_TABLES[source.own] ?? [];

    return typeof name === 'string' && names.includes(name.toUpperCase()) ? 1 : 0;
  }

  const found = FindResource.call(system, source.handle, name, RT_RCDATA);

  return found ? { found, module: source.handle } : 0;
}

/** A table loaded and numbered (seg5 `2d4c`): its number, or FFFFh. */
export async function loadTable(system: any, source: Source, name: string | number, type: number) {
  const state = tablesOf(system);

  if (!state.core) {
    state.core = true;

    if (!(typeof name === 'string' && name.toLowerCase() === 'core')) {
      await loadTable(system, { own: 'MMSYSTEM' }, 'core', 0);
    }
  }

  let library = 0;
  let found: number | { found: number; module: number } = 0;

  if (typeof name === 'string') {
    const file = `${name.slice(0, 8)}.mci`;
    const exists = await OpenFile.call(system, file, {}, OF_EXIST);

    if ((exists & 0xffff) !== 0xffff) {
      library = (await LoadLibrary.call(system, file)) & 0xffff;
      library = library < 0x20 ? 0 : library;

      if (library) {
        found = await find(system, { handle: library }, name);
      }
    }
  }

  if (!found) {
    found = await find(system, source, name);
  }

  if (!found) {
    return 0xffff;
  }

  let resource = 1;

  if (typeof found === 'object') {
    resource = (await LoadResource.call(system, found.module, found.found)) & 0xffff;

    if (!resource) {
      return 0xffff;
    }

    const far = LockResource.call(system, resource) >>> 0;

    if (!far) {
      FreeResource.call(system, resource);
      return 0xffff;
    }

    const core = system.machine.cpu.core;
    const count = commands((at) => core.read8(far >>> 16, ((far & 0xffff) + at) & 0xffff));

    GlobalUnlock.call(system, resource);

    if (!count) {
      FreeResource.call(system, resource);
      return 0xffff;
    }
  }

  return register(state, { resource, library, type: type & 0xffff });
}

/** A table put in the first free place below the end, else at the end (seg5 `2cee`). */
function register(state: Tables, table: Table) {
  const free = state.tables.findIndex((one) => !one.resource);

  if (free >= 0) {
    state.tables[free] = table;
    return free;
  }

  if (state.tables.length === TABLES_MOST) {
    return 0xffff;
  }

  state.tables.push(table);

  return state.tables.length - 1;
}

/**
 * A table let go (seg5 `2fb9`): nought for nought, one past the end, or one
 * a device uses -- `inUse` says which tables those are.
 */
export function freeTable(system: any, number: number, inUse: (table: number) => boolean) {
  const state = tablesOf(system);

  number &= 0xffff;

  if (!number || number >= state.tables.length || inUse(number)) {
    return 0;
  }

  const table = state.tables[number];
  const { resource, library } = table;

  state.tables[number] = { resource: 0, library, type: 0 };

  if (resource > 1) {
    FreeResource.call(system, resource);
  }

  if (library) {
    FreeLibrary.call(system, library);
  }

  if (number === state.tables.length - 1) {
    state.tables.pop();
  }

  return 1;
}

/**
 * A device type's table (seg5 `2f4c`): the first table with the type, else
 * MMSYSTEM's resource named as its type is, for the types MMSYSTEM names;
 * else FFFFh.
 */
export async function typeTable(system: any, type: number) {
  const found = tablesOf(system).tables.findIndex((table) => table.type === type);

  if (found >= 0) {
    return found;
  }

  if (type < 0x201 || type > 0x20b) {
    return 0xffff;
  }

  const name = (MMSYSTEM_STRINGS.get(type) ?? '').slice(0, 0x4f);

  return name.length ? loadTable(system, { own: 'MMSYSTEM' }, name, type) : 0xffff;
}
