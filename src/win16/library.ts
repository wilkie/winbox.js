'use strict';

import { Executable } from '../executable.js';
import { Loader } from './loader.js';
import { segmentSelector } from './selectors.js';

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
  /** Whether its entry point has run. */
  started = false;

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

/** Where a library is looked for: beside the program, then Windows' system directory, then Windows'. */
async function findFile(system: any, name: string, beside: string | null) {
  const file = `${String(name).toUpperCase()}.DLL`;
  const places = [beside, 'C:\\WINDOWS\\SYSTEM', 'C:\\WINDOWS'].filter(Boolean) as string[];

  for (const place of places) {
    let entries: any[] = [];

    try {
      entries = await system.files.list(place);
    } catch {
      continue;
    }

    const entry = entries.find((one: any) => String(one.name ?? '').toUpperCase() === file);

    if (entry) {
      return { path: `${place}\\${file}`, entry };
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
export async function loadLibrariesFor(system: any, loader: any, beside: string | null, order: Library[] = []) {
  const names = new Set<string>();

  for (const segment of loader.segments) {
    for (const relocation of segment.relocations) {
      if (relocation.type === Loader.RELOCATION_IMPORT) {
        names.add(String(relocation.from).toUpperCase());
      }
    }
  }

  for (const name of names) {
    if (!wantsFile(system, name)) {
      continue;
    }

    const found = await findFile(system, name, beside);

    if (!found) {
      continue;
    }

    const bytes = new Uint8Array(await found.entry.read(0, found.entry.size));
    const executable: any = new Executable(name, found.path, streamOf(bytes));

    await executable.parse();

    const library = new Library(executable, new Loader(executable, system._globalAllocator));

    await library.loader.parse();
    library.instance = system.handles.allocate(library);

    /* The data segment KERNEL allocates: its minimum allocation (64K for
     * none) and two bytes, its stack and its heap, in paragraphs
     * (`KRNL386.EXE` seg1 `7660`). Its heap is put at the end of it. */
    const header = executable.neHeader;
    const data = library.loader.segments[library.loader.ds - 1];

    if (data) {
      const size = (data.minAllocation || 0x10000) + 2 + header.initialStackSize + header.initialLocalHeapSize;

      system.allocator.setSegmentSize(library.loader.translate(library.loader.ds), (size + 15) & ~15);
    }

    patchPrologues(system, library);
    system._modules.register(library.loader, library.instance);

    await loadLibrariesFor(system, library.loader, beside, order);
    system._linker.link(library);
    order.push(library);
  }

  return order;
}

/** A file's bytes as the stream an `Executable` reads. */
function streamOf(bytes: Uint8Array) {
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
 * * an exported entry of a module with multiple data would become three
 *   `nop`s, its data segment coming from `MakeProcInstance`: not done here,
 *   as only libraries are patched, and a library has single data.
 *
 * A module with no data segment is not patched at all.
 */
function patchPrologues(system: any, library: Library) {
  const loader = library.loader;

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

    if (entry.flags & 0x02) {
      memory.write8(at, 0xb8);
      memory.write8(at + 1, dgroup & 0xff);
      memory.write8(at + 2, dgroup >> 8);
    }
  }
}
