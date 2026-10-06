'use strict';

import { Executable } from '../executable.js';
import { searchPlaces } from './kernel/search.js';
import { Loader } from './loader.js';
import { segmentSelector } from './selectors.js';
import { INT } from './types.js';

/**
 * A dynamic-link library loaded from the disk: `COMMDLG.DLL`, or a program's
 * own. Its segments are placed and its imports linked as a program's are,
 * and its entry point runs before the program that needs it starts.
 *
 * A module winbox.js keeps itself -- KERNEL, USER, GDI and the rest -- is
 * used in place of the file of that name. A module it keeps only as names
 * with nothing behind them is not: `COMMDLG` is Windows' own, and its file is
 * loaded instead.
 */
export class Library {
  declare executable: any;
  declare loader: any;
  /** The library's instance handle, as `LoadLibrary` answers it and its resources are found by. */
  declare instance: number;
  /** Its module's handle, as `GetModuleHandle` answers it: another number, for the same library. */
  declare module: number;
  /** Whether its entry point has run. */
  started = false;
  /** Its count, as `GetModuleUsage` answers it: a load or an import each. */
  usage = 1;
  /** The libraries it counted when it was loaded, to be let go with it. */
  brought: Library[] = [];

  constructor(executable: any, loader: any) {
    this.executable = executable;
    this.loader = loader;
  }

  get name() {
    return this.loader.name;
  }
}

/** Modules winbox.js has only as stubs: the file on the disk is used instead when there is one. */
const STUBS_ONLY = new Set(['COMMDLG']);

/** Whether a module is to be loaded from its file rather than taken from winbox.js. */
export function wantsFile(system: any, name: string) {
  const known = system._modules.fromName(name);

  return !known || (STUBS_ONLY.has(String(name).toUpperCase()) && !(known instanceof Loader));
}

/**
 * A library a module imports, found by its name with `.DLL` added where
 * KERNEL looks (`search.ts`): `beside` is the directory of the module whose
 * file is looked in fourth -- the program being started, or the task that
 * loads a library (**recorded** by `search`).
 */
async function findFile(system: any, name: string, beside: string | null) {
  return findIn(system, searchPlaces(system, beside), `${String(name).toUpperCase()}.DLL`);
}

/** A file found in the first of some directories that has it, by its name in any case. */
async function findIn(system: any, places: string[], file: string) {
  for (const place of places) {
    let entries: any[];

    try {
      entries = await system.files.list(place);
    } catch {
      continue;
    }

    const entry = entries.find((one: any) => String(one.name ?? '').toUpperCase() === file.toUpperCase());

    if (entry) {
      return { path: `${place.replace(/\\$/, '')}\\${String(entry.name).toUpperCase()}`, entry };
    }
  }

  return null;
}

/** The modules a module imports from, by name, in the order its relocations name them. */
function importNames(loader: any) {
  const names = new Set<string>();

  for (const segment of loader.segments) {
    for (const relocation of segment.relocations) {
      if (relocation.type === Loader.RELOCATION_IMPORT) {
        names.add(String(relocation.from).toUpperCase());
      }
    }
  }

  return names;
}

/**
 * The first library a program imports that is to come from its file and is
 * found nowhere KERNEL looks, if any: such a program is not started, and
 * `WinExec` answers 2 (**recorded** by `search`). Only the program's own
 * imports are looked at; a library's that is missing is not recorded.
 */
export async function missingLibrary(system: any, executable: any, beside: string | null) {
  const loader = new Loader(executable, system._globalAllocator);

  await loader.parseHeaders();

  for (const name of importNames(loader)) {
    if (libraryNamed(system, name) || !wantsFile(system, name)) {
      continue;
    }

    if (!(await findFile(system, name, beside))) {
      return name;
    }
  }

  return null;
}

/**
 * Loads the libraries a module imports that are to come from their files,
 * and theirs, each once: placed, registered under its name, and linked, in
 * the order their entry points are to run -- a library before the ones that
 * need it.
 */
export async function loadLibrariesFor(
  system: any,
  loader: any,
  beside: string | null,
  order: Library[] = [],
  brought: Library[] = []
) {
  for (const name of importNames(loader)) {
    /* A library already loaded from its file is counted once more. */
    const already = libraryNamed(system, name);

    if (already) {
      already.usage++;
      brought.push(already);
      continue;
    }

    if (!wantsFile(system, name)) {
      continue;
    }

    const found = await findFile(system, name, beside);

    if (!found) {
      continue;
    }

    brought.push(await loadFound(system, name, found, beside, order));
  }

  return order;
}

/** A library read from its file, placed, registered and linked, its own imports first; added to `order`. */
async function loadFound(
  system: any,
  name: string,
  found: { path: string; entry: any },
  beside: string | null,
  order: Library[]
) {
  {
    const bytes = new Uint8Array(await found.entry.read(0, found.entry.size));
    const executable: any = new Executable(name, found.path, streamOf(bytes));

    await executable.parse();

    const library = new Library(executable, new Loader(executable, system._globalAllocator));

    await library.loader.parse();
    library.instance = system.handles.allocate(library);
    library.module = system.handles.alias(library);

    /* The data segment KERNEL allocates: its minimum allocation (64K for
     * none) and two bytes, its stack and its heap, in paragraphs
     * (`KRNL386.EXE` seg1 `7660`). Its heap is put at the end of it. */
    const header = executable.neHeader;
    const data = library.loader.segments[library.loader.ds - 1];

    if (data) {
      const size = (data.minAllocation || 0x10000) + 2 + header.initialStackSize + header.initialLocalHeapSize;

      system.allocator.setSegmentSize(library.loader.translate(library.loader.ds), (size + 15) & ~15);

      /* A moveable data segment's heap grows when a request does not fit, as
       * a program's does (see `Heap.grow`): `COMMDLG.DLL`'s heap of 400h
       * bytes is asked for 40Dh as its Open dialog starts. */
      if (data.movable) {
        (system._growable ??= new Set()).add(library.loader.translate(library.loader.ds));
      }
    }

    patchPrologues(system, library);
    system._modules.register(library.loader, library.module);

    await loadLibrariesFor(system, library.loader, beside, order, library.brought);
    system._linker.link(library);
    order.push(library);

    return library;
  }
}

/**
 * A library a program loads itself, as `LoadLibrary` does. **Recorded** by
 * the `sysdirs` probe: a name alone is found in the system directory, and a
 * name is not given `.DLL` -- `COMMDLG` is not found; a file not there
 * answers 2, a directory not there 3, and a file that is not a program 20;
 * a library already loaded answers the same handle again.
 *
 * A name alone is looked for where KERNEL looks (`search.ts`), the
 * directory of the task's program fourth: **recorded** by `search`. The
 * library's entry point runs at once, after those of the libraries it needs.
 */
export async function loadLibrary(system: any, file: string, beside: string | null) {
  const text = String(file ?? '');
  const slash = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'), text.lastIndexOf(':'));
  const name = text.slice(slash + 1);

  /* A module winbox.js keeps itself -- USER, MMSYSTEM, the timer and MCI
   * drivers -- is found by its file's name, whether or not the file is
   * there: no such file is shipped. */
  const kept = keptModule(system, name);

  if (kept) {
    return system._modules.instanceFromPath(kept.path) ?? 2;
  }

  /* A module already loaded is found by its name, the file's before the
   * dot, whatever follows it or goes before: `GDI.`, `GDI`, `GDI.DLL` and
   * `C:\WINDOWS\SYSTEM\GDI.EXE` are all GDI (`loadname`). The Visual
   * Basic runtime asks for `GDI.`. */
  const moduleName = name.split('.')[0];
  const named = moduleName ? system._modules.fromName(moduleName) : null;

  if (named && !wantsFile(system, moduleName.toUpperCase())) {
    const library = libraryNamed(system, moduleName);

    if (library) {
      library.usage++;
      return library.instance;
    }

    if (!(named instanceof Loader)) {
      const instance = system._modules.instanceFromPath(named.path);

      if (instance) {
        return instance;
      }
    }
  }
  let places: string[];

  if (slash >= 0) {
    const directory = text.slice(0, slash + (text[slash] === ':' ? 1 : 0)) || '\\';

    places = [directory];
  } else {
    places = searchPlaces(system, beside);
  }

  let found: { path: string; entry: any } | null = null;
  let directoryFound = false;

  for (const place of places) {
    let entries: any[];

    try {
      entries = await system.files.list(place);
    } catch {
      continue;
    }

    directoryFound = true;

    const entry = entries.find((one: any) => String(one.name ?? '').toUpperCase() === name.toUpperCase());

    if (entry) {
      found = { path: `${place.replace(/\\$/, '')}\\${String(entry.name).toUpperCase()}`, entry };
      break;
    }
  }

  if (!found) {
    return slash >= 0 && !directoryFound ? 3 : 2;
  }

  /* Already loaded: the same handle, counted once more. A module winbox.js
   * has only as stubs is registered under its file's path too, and is not
   * its file: WinHelp loads `C:\WINDOWS\SYSTEM\COMMDLG.DLL` by that path,
   * and was given the stubs. */
  const baseName = name.replace(/\.[^.]*$/, '').toUpperCase();
  const known =
    STUBS_ONLY.has(baseName) && wantsFile(system, baseName)
      ? null
      : system._modules.handleFromPath(found.path);

  if (known) {
    const already = system.handles.resolve(known);

    if (already instanceof Library) {
      already.usage++;

      return already.instance;
    }

    return known;
  }

  /* Not a program: no new-format header. */
  const head = new Uint8Array(await found.entry.read(0, Math.min(found.entry.size, 0x40)));
  const at = head[0x3c] | (head[0x3d] << 8);
  const signature = at + 2 <= found.entry.size ? new Uint8Array(await found.entry.read(at, 2)) : null;

  if (head[0] !== 0x4d || head[1] !== 0x5a || !signature || signature[0] !== 0x4e || signature[1] !== 0x45) {
    return 20;
  }

  const order: Library[] = [];
  const library = await loadFound(system, name.replace(/\.[^.]*$/, '').toUpperCase(), found, beside, order);

  await system.startLibraries({ libraries: order });

  return library.instance;
}

/** A module winbox.js keeps itself whose file has this name, if there is one. */
function keptModule(system: any, file: string) {
  const wanted = file.toUpperCase();

  for (const module of Object.values(system._modules._modules ?? {}) as any[]) {
    if (module instanceof Loader || wantsFile(system, module.name)) {
      continue;
    }

    if (String(module.path ?? '').split('\\').pop()!.toUpperCase() === wanted) {
      return module;
    }
  }

  return null;
}

/** The library loaded from its file under a module name, if there is one. */
function libraryNamed(system: any, name: string): Library | null {
  const loader = system._modules.fromName(name);
  const handle = loader instanceof Loader ? system._modules.handleFromPath(loader.path) : null;
  const library = handle ? system.handles.resolve(handle) : null;

  return library instanceof Library ? library : null;
}

/**
 * A library let go, as `FreeLibrary` does. **Recorded** by the `freelib`
 * probe: each load and each import counts, each free counts down, and at
 * nought the library goes -- its name is found no more -- and so do the
 * libraries it brought, counted down in their turn.
 *
 * As it goes its `WEP` runs, if it has one, told the library alone is going
 * (`WEP_FREE_DLL`, nought); documented, not recorded. Not followed: its
 * memory is not given back.
 */
export async function freeLibrary(system: any, handle: number) {
  const library = system.handles.resolve(handle);

  if (!(library instanceof Library) || library.usage <= 0) {
    return;
  }

  library.usage--;

  if (library.usage > 0) {
    return;
  }

  const ordinal = library.started ? library.loader.ordinalOf?.('WEP') : 0;
  const info = ordinal ? library.loader.lookup(ordinal) : null;

  if (info && info.segment !== undefined && system.scheduler?.callProc) {
    await system.scheduler.callProc(((segmentSelector(info.segment) << 16) | info.offset) >>> 0, [[0, INT]]);
  }

  system._modules.unregister(library.loader);
  system.handles.free(library.instance);
  system.handles.free(library.module);

  for (const other of library.brought) {
    await freeLibrary(system, other.instance);
  }
}

/**
 * The libraries a program brought, let go as its task ends, as
 * `FreeLibrary` lets one go: each counted down, and one at nought gone --
 * its name and its file found no more -- and those it brought in their
 * turn. **Recorded** by `search`: a program's library, loaded as it started,
 * is found again from its file as the program starts next time. Not
 * followed: the `WEP` of one going, which would be called with the task
 * already ended.
 */
export function releaseLibraries(system: any, libraries: Library[]) {
  for (const library of libraries) {
    if (library.usage <= 0) {
      continue;
    }

    library.usage--;

    if (library.usage > 0) {
      continue;
    }

    const brought = library.brought;

    library.brought = [];
    system._modules.unregister(library.loader);
    system.handles.free(library.instance);
    system.handles.free(library.module);
    releaseLibraries(system, brought);
  }
}

/** A file's bytes as the stream an `Executable` reads. */
export function streamOf(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    byteLength: bytes.byteLength,
    size: bytes.byteLength,
    read8: async (at: number) => view.getUint8(at),
    read16: async (at: number, little = true) => view.getUint16(at, little),
    read32: async (at: number, little = true) => view.getUint32(at, little),
    read: async (at: number, length: number) => bytes.slice(at, at + length).buffer,
  };
}

/**
 * The prologues of a library's entry points, patched as KERNEL patches them
 * when it loads a code segment (`KRNL386.EXE` seg1 `7bac`). For each entry of
 * the entry table in a code segment whose third byte is `nop`:
 *
 * * `push ds; pop ax` (`1E 58`) becomes `mov ax, ds` (`8C D8`);
 * * then `mov ax, ds` becomes `mov ax, <data segment's selector>` for an
 *   entry flagged as using shared data (bit 1), so an exported function of a
 *   library finds its own data, not its caller's;
 * * an exported entry of a module with multiple data -- a program --
 *   becomes three `nop`s, its data segment coming from AX: from
 *   `MakeProcInstance`'s thunk, or from USER, which calls a window procedure
 *   with its instance's in AX.
 *
 * A module with no data segment is not patched at all.
 */
export function patchPrologues(system: any, library: { loader: any; executable: any }) {
  const loader = library.loader;
  const multiple = (library.executable.neHeader?.flags & 3) === 2;

  if (!loader.ds) {
    return;
  }

  const memory = system.machine.memory;
  const dgroup = segmentSelector(loader.translate(loader.ds));

  for (const entry of library.executable.entryPoints ?? []) {
    if (!entry || entry.constant || !entry.segment || !loader.segments[entry.segment - 1]?.code) {
      continue;
    }

    const at = (loader.translate(entry.segment) << 16) + entry.offset;

    if (memory.read8(at + 2) !== 0x90) {
      continue;
    }

    if (memory.read8(at) === 0x1e && memory.read8(at + 1) === 0x58) {
      memory.write8(at, 0x8c);
      memory.write8(at + 1, 0xd8);
    }

    if (memory.read8(at) !== 0x8c || memory.read8(at + 1) !== 0xd8) {
      continue;
    }

    if (multiple && entry.exported) {
      memory.write8(at, 0x90);
      memory.write8(at + 1, 0x90);
      continue;
    }

    if (entry.flags & 0x02) {
      memory.write8(at, 0xb8);
      memory.write8(at + 1, dgroup & 0xff);
      memory.write8(at + 2, dgroup >> 8);
    }
  }
}
