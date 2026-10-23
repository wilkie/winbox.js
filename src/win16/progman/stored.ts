'use strict';

import { Executable } from '../../executable.js';
import { streamOf } from '../library.js';

/**
 * `PROGMAN.EXE`'s own file for WinBox's Program Manager, which is made in
 * memory with no resources: the installation's where C: has it, else the
 * asset bundle's store's (`options.assets`), as the kept modules' resources
 * are read (`kb/topics/asset-bundle.md`). Its icons are what items of DOS
 * programs and items whose program is not found show, by the owner's
 * decision of 2026-10-22 (`kb/topics/program-manager-dde.md`). As
 * `System::progman_kept` and SHELL's `progman_file` in the Rust engine.
 */

/** Where it says it is, and its file's name. */
const PATH = 'C:\\WINDOWS\\PROGMAN.EXE';
const FILE = 'PROGMAN.EXE';

/** Whether WinBox's Program Manager runs: its module's handle the kept module's (`startProgman`). */
export function progmanRunning(system: any): boolean {
  return !!system._progmanKept && system._modules?._handles?.[PATH] === system._progmanKept;
}

/** Whether a module is the one made in memory for WinBox's Program Manager. */
export function isProgman(system: any, module: any): boolean {
  return progmanRunning(system) && module?.executable?.path === PATH;
}

/** The file's bytes: C:'s, else the store's; none without either. */
async function bytesOf(system: any): Promise<Uint8Array | undefined> {
  const files = system.dos?.files;
  const handle = files ? await files.open(PATH) : null;

  if (handle) {
    try {
      const file = files.resolve(handle);

      return new Uint8Array(await file.read(0, file.size));
    } finally {
      files.close(handle);
    }
  }

  return system.assetModule?.(FILE);
}

/** The file, read once, for its resources; null without it. */
export async function progmanExecutable(system: any): Promise<any> {
  if (system._progmanResources === undefined) {
    const bytes = await bytesOf(system);
    let executable: any = null;

    if (bytes) {
      try {
        executable = new Executable('PROGMAN', PATH, streamOf(bytes));
        await executable.parse();
      } catch {
        executable = null;
      }
    }

    system._progmanResources = executable;
  }

  return system._progmanResources;
}

/**
 * While it runs, the file it says it is, which is on no drive, for
 * `ExtractIcon`: asked for by `C:\WINDOWS\PROGMAN.EXE`, `\WINDOWS\PROGMAN.EXE`
 * or the name alone, as `OpenFile` would find it in the Windows directory.
 */
export async function progmanFile(system: any, name: string): Promise<Uint8Array | undefined> {
  if (!progmanRunning(system)) {
    return undefined;
  }

  const upper = String(name).toUpperCase();

  if (![FILE, '\\WINDOWS\\PROGMAN.EXE', PATH].includes(upper)) {
    return undefined;
  }

  return bytesOf(system);
}
