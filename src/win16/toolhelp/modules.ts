'use strict';

import { GetModuleHandle } from '../kernel/GetModuleHandle.js';
import { GetModuleUsage } from '../kernel/LoadLibrary.js';
import { structure } from './structures.js';

/** `MODULEENTRY`'s size. */
const MODULEENTRY = 0x114;

/** `szModule`'s room, a nought after it. */
const NAME_LENGTH = 9;

/** `szExePath`'s room, a nought after it. */
const PATH_LENGTH = 255;

/**
 * The modules, in the order KERNEL chains their databases from its first,
 * `hExeHead` -- KERNEL's own first (**recorded** by `thtask`) -- each by
 * its handle, name and file: winbox.js's own in the order it keeps them,
 * then those loaded from their files, in the order they were loaded. A
 * module of winbox.js's own that `GetModuleHandle` does not find is not
 * loaded, and not in the chain.
 */
export function moduleChain(system: any): { handle: number; name: string; path: string }[] {
  const chain: { handle: number; name: string; path: string }[] = [];
  const seen = new Set<number>();

  for (const module of Object.values(system.modules._modules ?? {}) as any[]) {
    const name = String(module?.name ?? '').toUpperCase();
    const handle = name ? GetModuleHandle.call(system, name) & 0xffff : 0;

    if (handle && !seen.has(handle)) {
      seen.add(handle);
      chain.push({ handle, name, path: String(module.path ?? '') });
    }
  }

  return chain;
}

/**
 * A `MODULEENTRY` filled for a module, as `TOOLHELP.DLL` seg1 `0bd7`-
 * `0ca7` fills it from the module's database: its name from its resident
 * names (the first entry), its handle, its count (2), the path of its file
 * (from the file's details at 0Ah), and the next module (6). FALSE for a
 * handle that is no module's.
 */
function fill(system: any, far: number, handle: number) {
  const entry = structure(system, far, MODULEENTRY);
  const chain = moduleChain(system);
  const at = chain.findIndex((module) => module.handle === (handle & 0xffff));

  if (!entry || at < 0) {
    return 0;
  }

  const module = chain[at];

  entry.writeString(0x04, module.name, NAME_LENGTH);
  entry.write16(0x0e, module.handle);
  entry.write16(0x10, GetModuleUsage.call(system, module.handle));
  entry.writeString(0x12, module.path, PATH_LENGTH);
  entry.write16(0x112, chain[at + 1]?.handle ?? 0);

  return 1;
}

/** KERNEL's module, the chain's first, filled in (`TOOLHELP.DLL` seg1 `0a90`). */
export function ModuleFirst(this: any, lpme: number) {
  return fill(this, lpme, moduleChain(this)[0]?.handle ?? 0);
}

/** The module after the one filled in, from its `wNext` (seg1 `0ad9`); FALSE after the last. */
export function ModuleNext(this: any, lpme: number) {
  const entry = structure(this, lpme, MODULEENTRY);
  const next = entry?.read16(0x112) ?? 0;

  return next ? fill(this, lpme, next) : 0;
}

/**
 * The module of a name, filled in, and its handle: the chain walked from
 * the first, each name held to the one given as USER's `lstrcmp` holds
 * them, so case counts (seg1 `0b15`-`0b87`). **Recorded** by `thtask`:
 * `USER` is found, `user` is not. Nought where none is.
 */
export function ModuleFindName(this: any, lpme: number, lpszName: any) {
  if (!structure(this, lpme, MODULEENTRY) || lpszName === null || lpszName === undefined) {
    return 0;
  }

  const wanted = String(lpszName);
  const found = moduleChain(this).find((module) => module.name === wanted);

  return found && fill(this, lpme, found.handle) ? found.handle : 0;
}

/** A module's entry by its handle, and the handle; nought for nought or no module (seg1 `0b8c`). */
export function ModuleFindHandle(this: any, lpme: number, hModule: number) {
  const handle = hModule & 0xffff;

  return handle && fill(this, lpme, handle) ? handle : 0;
}
