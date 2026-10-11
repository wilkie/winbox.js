'use strict';

import { hasDirectory, searchFile } from '../kernel/search.js';
import { fontFile } from '../font-file.js';
import { streamOf } from '../library.js';

/**
 * `AddFontResource` and `RemoveFontResource`: a font file added to GDI's
 * font table and taken away. Read out of `GDI.EXE` and recorded by
 * `fontres`; see `kb/topics/font-resources.md`. GDI tells no window: the
 * program that adds a font sends `WM_FONTCHANGE` itself, as Control Panel's
 * Fonts does.
 */

/** A file's bytes by its path, or null where there is none. */
async function read(system: any, path: string): Promise<Uint8Array | null> {
  const handle = await system.dos.files.open(path);
  const file =
    handle === null || handle === undefined || handle < 0 ? null : system.dos.files.resolve(handle);

  if (!file) {
    return null;
  }

  const bytes = new Uint8Array(await file.read(0, file.size));

  system.dos.files.close(handle);

  return bytes;
}

/** A file found as `LoadLibrary` finds one (seg2 `0b96`): by its path, or a name alone where KERNEL looks. */
async function found(
  system: any,
  name: string
): Promise<{ path: string; bytes: Uint8Array } | null> {
  if (!name) {
    return null;
  }

  let path = name;

  if (!hasDirectory(name)) {
    const searched: any = await searchFile(system, name, null);

    if (!searched.path) {
      return null;
    }

    path = searched.path;
  }

  const bytes = await read(system, path);

  return bytes ? { path, bytes } : null;
}

/**
 * What a font is named by: a file's name, or a module's handle in a far
 * pointer whose selector is nought (seg2 `0e46`) -- a library's file. Null
 * where GDI's check fails: a handle of nought or none of a library's, or a
 * name over 255 characters (seg2 `0e70`, `0e79`).
 */
function named(system: any, lpszFilename: any): { file: string } | { handle: string } | null {
  if (typeof lpszFilename === 'number') {
    const library = lpszFilename ? system.handles.resolve(lpszFilename) : null;
    const path = library?.loader?.executable?.path ?? library?.executable?.path;

    return path ? { handle: String(path) } : null;
  }

  const text = String(lpszFilename ?? '');

  return text.length < 0x100 ? { file: text } : null;
}

/**
 * The **AddFontResource** function adds a font file to GDI's table: a
 * raster or vector `.FON`, or a TrueType `.FOT` stub, whose `.TTF` it
 * names.
 *
 * @param {Types.LPCSTR} lpszFilename - The file, or a library's handle with
 *                                      a selector of nought.
 * @return {Types.INT} The fonts its `FONTDIR` lists -- added, or added
 *                     before and counted once more -- or 0.
 */
export async function AddFontResource(this: any, lpszFilename) {
  const name = named(this, lpszFilename);

  if (!name) {
    return 0;
  }

  const file = await found(this, 'file' in name ? name.file : name.handle);

  if (!file) {
    return 0;
  }

  const beside = file.path.includes('\\') ? file.path.slice(0, file.path.lastIndexOf('\\')) : '';

  /* The `.TTF` a stub names, where it is: the system directory, Windows', or
   * beside the stub. */
  const ttf = async (ttfName: string) => {
    for (const folder of ['C:\\WINDOWS\\SYSTEM', 'C:\\WINDOWS', beside]) {
      const bytes = folder ? await read(this, `${folder}\\${ttfName}`) : null;

      if (bytes) {
        return Object.assign(streamOf(bytes), { name: ttfName });
      }
    }

    return null;
  };

  return this.fonts.addResource(file.path, file.bytes, ttf);
}

/**
 * The **RemoveFontResource** function takes away one add of a font file:
 * the file goes once its last add is taken away.
 *
 * @param {Types.LPCSTR} lpszFilename - The file as it was added, its name
 *                                      alone, or a library's handle with a
 *                                      selector of nought.
 * @return {Types.BOOL} Whether a font was taken away.
 */
export async function RemoveFontResource(this: any, lpszFilename) {
  const name = named(this, lpszFilename);

  if (!name) {
    return 0;
  }

  if ('handle' in name) {
    /* A handle's module, by its name. */
    const file = await found(this, name.handle);
    const module = file ? fontFile(file.bytes)?.module : null;

    return module && this.fonts.removeResource(module, null) ? 1 : 0;
  }

  const file = await found(this, name.file);

  return this.fonts.removeResource(name.file, file?.bytes ?? null) ? 1 : 0;
}
